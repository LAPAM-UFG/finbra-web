"""Mercado de trabalho: RAIS (vínculos e estabelecimentos) e Novo CAGED → silver/trabalho e gold/trabalho.

Os microdados brutos (PDET/Ministério do Trabalho, ~3,5 GB compactados por ano da RAIS e ~50 MB por mês
do CAGED) ficam fora do projeto e do Dropbox, na pasta --brutos (padrão: TRABALHO_BRUTOS ou
D:/LVBERNARDELLI/finbra_brutos), com a estrutura rais/AAAA/*.7z e caged/AAAAMM/*.7z.
Cada arquivo é descompactado numa pasta temporária, somado com o DuckDB e apagado em seguida.

silver/trabalho/rais_vinculos/ano=AAAA.parquet   vínculos ativos em 31/12 por município, divisão CNAE,
                                                 grande setor, sexo, escolaridade superior e faixa de idade
silver/trabalho/rais_estab/ano=AAAA.parquet      estabelecimentos com vínculo ativo por município, divisão e tamanho
silver/trabalho/caged/AAAAMM_TIPO.parquet        movimentações por competência, município, seção e sexo
                                                 (TIPO: MOV no prazo, FOR fora do prazo, EXC exclusões)

gold/trabalho/municipios.parquet   ano × município: empregos, perfil, setores, remuneração, estabelecimentos
gold/trabalho/setores.parquet      ano × município × divisão CNAE (ordenado por município, para leitura por Range)
gold/trabalho/setores_uf.parquet   ano × UF/Brasil × divisão CNAE
gold/trabalho/caged.parquet        competência × município: admissões, desligamentos, saldo (série "com ajustes":
                                   no prazo + fora do prazo − exclusões, pela competência da movimentação)
gold/trabalho/caged_uf.parquet     competência × UF/Brasil × seção CNAE
gold/trabalho/cnae.parquet         nomes das seções e divisões da CNAE 2.0 (IBGE)
gold/trabalho/dicionario.parquet   nomes dos códigos dos microdados (de dicionario_trabalho.csv, montado a partir
                                   dos layouts do PDET: CBO, CNAE, afastamento, desligamento, vínculo…)

Uso:
    py pipeline/trabalho.py                    # processa o que houver nos brutos e ainda não está na silver
    py pipeline/trabalho.py --refazer          # reprocessa tudo
    py pipeline/trabalho.py --so-gold
"""
import argparse
import os
import re
import shutil
import subprocess
import tempfile
import unicodedata
from pathlib import Path

import duckdb
import requests

from config import GOLD, SILVER

SILVER_T = SILVER / "trabalho"
GOLD_T = GOLD / "trabalho"
SETE_ZIP = shutil.which("7z") or r"C:\Program Files\7-Zip\7z.exe"

# grandes setores a partir da divisão da CNAE 2.0, que existe em todos os anos (o subsetor do IBGE falta
# na RAIS de 2013): indústria inclui extrativa, energia e saneamento; administração pública é a divisão 84
GRANDE_SETOR = """CASE WHEN TRY_CAST(divisao AS INTEGER) BETWEEN 1 AND 3 THEN 'agropecuaria'
    WHEN TRY_CAST(divisao AS INTEGER) BETWEEN 5 AND 39 THEN 'industria'
    WHEN TRY_CAST(divisao AS INTEGER) BETWEEN 41 AND 43 THEN 'construcao'
    WHEN TRY_CAST(divisao AS INTEGER) BETWEEN 45 AND 47 THEN 'comercio'
    WHEN TRY_CAST(divisao AS INTEGER) = 84 THEN 'adm_publica'
    WHEN TRY_CAST(divisao AS INTEGER) BETWEEN 49 AND 99 THEN 'servicos' ELSE 'ignorado' END"""
SETORES = ["agropecuaria", "industria", "construcao", "comercio", "servicos", "adm_publica"]


def normalizar(nome: str) -> str:
    """'Ind Vínculo Ativo 31/12 - Código' → 'ind_vinculo_ativo_31_12' (os nomes mudaram em 2023)."""
    nome = re.sub(r"\s*-\s*c[óo]digo\s*$", "", nome.strip().strip('"'), flags=re.I)
    nome = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", nome).strip("_")


def coluna(cols: dict, *opcoes, obrigatoria=True):
    """Nome original da coluna cujo nome normalizado é uma das opções."""
    for o in opcoes:
        if o in cols:
            return f'"{cols[o]}"'
    if obrigatoria:
        raise KeyError(f"nenhuma das colunas {opcoes} em {sorted(cols)}")
    return "NULL"


FTP = "ftp.mtps.gov.br"
_listas: dict[str, dict[str, int]] = {}


def remotos(caminho: str) -> dict[str, int]:
    """{arquivo: tamanho} de uma pasta do FTP do PDET (listagem no formato DOS), em cache."""
    if caminho not in _listas:
        from ftplib import FTP as Cliente
        linhas: list[str] = []
        with Cliente(FTP, timeout=120, encoding="latin-1") as ftp:
            ftp.login()
            ftp.dir(caminho, linhas.append)
        _listas[caminho] = {m.group(2).strip(): int(m.group(1))
                            for m in (re.match(r"^\S+\s+\S+\s+(\d+)\s+(.+)$", l) for l in linhas) if m}
    return _listas[caminho]


def completo(locais: list[Path], caminho_remoto: str, conferir: bool) -> bool:
    """Todos os .7z da pasta remota estão aqui, com o tamanho exato (o download terminou)."""
    if not conferir:
        return bool(locais)
    esperados = {n: t for n, t in remotos(caminho_remoto).items() if n.lower().endswith(".7z")}
    tem = {a.name: a.stat().st_size for a in locais}
    return bool(esperados) and all(tem.get(n) == t for n, t in esperados.items())


def descompactar(arquivo: Path, pasta: Path) -> Path:
    subprocess.run([SETE_ZIP, "e", "-y", f"-o{pasta}", str(arquivo)], check=True, stdout=subprocess.DEVNULL)
    membros = [p for p in pasta.iterdir() if p.is_file()]
    if len(membros) != 1:
        raise RuntimeError(f"{arquivo.name}: esperado 1 arquivo, vieram {[m.name for m in membros]}")
    return membros[0]


def ler_csv(con, caminho: Path, encoding: str):
    """Relação do DuckDB com tudo como texto e o mapa {nome normalizado: nome original}."""
    with open(caminho, encoding=encoding, errors="replace") as f:
        cab = f.readline()
    delim = ";" if cab.count(";") > cab.count(",") else ","
    rel = (f"read_csv('{caminho.as_posix()}', delim='{delim}', quote='\"', header=true, all_varchar=true, "
           f"encoding='{'latin-1' if encoding == 'latin-1' else 'utf-8'}', ignore_errors=true, strict_mode=false)")
    nomes = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {rel}").fetchall()]
    return rel, {normalizar(n): n for n in nomes}


def num(expr):
    """Texto da RAIS/CAGED ('0000001090,26', '1186.48', ' 44') → DOUBLE."""
    return f"TRY_CAST(replace(trim({expr}), ',', '.') AS DOUBLE)"


def inteiro(expr):
    return f"TRY_CAST(trim({expr}) AS INTEGER)"


# ---------------- RAIS ----------------

def rais_vinculos(con, txt: Path, ano: int):
    rel, c = ler_csv(con, txt, "latin-1")
    ativo = coluna(c, "ind_vinculo_ativo_31_12", "vinculo_ativo_31_12")
    return f"""
        SELECT {ano} AS ano, {inteiro(coluna(c, 'municipio'))} AS municipio,
               lpad(regexp_replace(trim({coluna(c, 'cnae_2_0_classe')}), '[^0-9]', '', 'g'), 5, '0')[1:2] AS divisao,
               {inteiro(coluna(c, 'sexo', 'sexo_trabalhador'))} AS sexo,
               {inteiro(coluna(c, 'escolaridade_apos_2005'))} >= 9 AS superior,
               {inteiro(coluna(c, 'idade'))} AS idade,
               {num(coluna(c, 'vl_rem_dezembro_nom', 'vl_remun_dezembro_nom'))} AS rem_dez,
               {num(coluna(c, 'vl_rem_media_nom', 'vl_remun_media_nom'))} AS rem_media
        FROM {rel}
        WHERE {inteiro(ativo)} = 1"""


def rais_estab(con, txt: Path, ano: int):
    rel, c = ler_csv(con, txt, "latin-1")
    return f"""
        SELECT {ano} AS ano, {inteiro(coluna(c, 'municipio'))} AS municipio,
               lpad(regexp_replace(trim({coluna(c, 'cnae_2_0_classe')}), '[^0-9]', '', 'g'), 5, '0')[1:2] AS divisao,
               {inteiro(coluna(c, 'tamanho_estabelecimento'))} AS tamanho,
               {inteiro(coluna(c, 'qtd_vinculos_ativos'))} AS vinculos
        FROM {rel}"""


def processar_rais(con, brutos: Path, refazer: bool, conferir: bool = True):
    for pasta_ano in sorted((brutos / "rais").glob("[0-9][0-9][0-9][0-9]")):
        ano = int(pasta_ano.name)
        arquivos = sorted(pasta_ano.glob("*.7z"))
        if not completo(arquivos, f"/pdet/microdados/RAIS/{ano}/", conferir):
            print(f"RAIS {ano}: download incompleto, fica para depois", flush=True)
            continue
        estab = [a for a in arquivos if "ESTAB" in a.name.upper() or a.name.upper().startswith("ESTB")]
        vinc = [a for a in arquivos if a not in estab and "_NI" not in a.name.upper()]
        destino_v = SILVER_T / "rais_vinculos" / f"ano={ano}.parquet"
        destino_e = SILVER_T / "rais_estab" / f"ano={ano}.parquet"
        if destino_v.exists() and destino_e.exists() and not refazer:
            continue
        partes = []
        with tempfile.TemporaryDirectory(dir=brutos) as tmp:
            for i, arq in enumerate(vinc):
                pasta = Path(tmp) / f"v{i}"
                pasta.mkdir()
                txt = descompactar(arq, pasta)
                parte = Path(tmp) / f"v{i}.parquet"
                con.execute(f"""
                    COPY (
                        SELECT ano, municipio, divisao, {GRANDE_SETOR} AS grande_setor, sexo, coalesce(superior, false) AS superior,
                               CASE WHEN idade < 25 THEN 'ate24' WHEN idade < 50 THEN '25a49' ELSE '50mais' END AS faixa_idade,
                               count(*) AS vinculos,
                               sum(rem_dez) FILTER (rem_dez > 0) AS rem_dez_soma, count(*) FILTER (rem_dez > 0) AS rem_dez_n,
                               sum(rem_media) FILTER (rem_media > 0) AS rem_media_soma, count(*) FILTER (rem_media > 0) AS rem_media_n
                        FROM ({rais_vinculos(con, txt, ano)}) GROUP BY ALL
                    ) TO '{parte.as_posix()}' (FORMAT parquet)""")
                shutil.rmtree(pasta)
                partes.append(parte)
                print(f"  RAIS {ano} {arq.name}: ok", flush=True)
            destino_v.parent.mkdir(parents=True, exist_ok=True)
            lista = ", ".join(f"'{p.as_posix()}'" for p in partes)
            con.execute(f"""COPY (SELECT ano, municipio, divisao, grande_setor, sexo, superior, faixa_idade,
                                         sum(vinculos) AS vinculos, sum(rem_dez_soma) AS rem_dez_soma, sum(rem_dez_n) AS rem_dez_n,
                                         sum(rem_media_soma) AS rem_media_soma, sum(rem_media_n) AS rem_media_n
                                  FROM read_parquet([{lista}]) GROUP BY ALL)
                            TO '{destino_v.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
            for arq in estab:
                pasta = Path(tmp) / "e"
                pasta.mkdir()
                txt = descompactar(arq, pasta)
                destino_e.parent.mkdir(parents=True, exist_ok=True)
                con.execute(f"""COPY (SELECT ano, municipio, divisao, tamanho, count(*) FILTER (vinculos > 0) AS estabelecimentos,
                                             sum(vinculos) AS vinculos
                                      FROM ({rais_estab(con, txt, ano)}) GROUP BY ALL)
                                TO '{destino_e.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
                shutil.rmtree(pasta)
        total = con.execute(f"SELECT sum(vinculos) FROM '{destino_v.as_posix()}'").fetchone()[0]
        print(f"RAIS {ano}: {total:,.0f} vínculos ativos em 31/12", flush=True)


# ---------------- Novo CAGED ----------------

def salario_minimo(con):
    """Salário mínimo mensal (Banco Central, SGS 1619), para filtrar salários de admissão absurdos."""
    r = requests.get("https://api.bcb.gov.br/dados/serie/bcdata.sgs.1619/dados?formato=json&dataInicial=01/01/2019",
                     timeout=60)
    r.raise_for_status()
    linhas = [(int(d["data"][6:10]) * 100 + int(d["data"][3:5]), float(d["valor"])) for d in r.json()]
    con.execute("CREATE OR REPLACE TEMP TABLE salario_minimo(aaaamm INTEGER, valor DOUBLE)")
    con.executemany("INSERT INTO salario_minimo VALUES (?, ?)", linhas)
    # meses ainda sem valor na série repetem o último
    ultimo, valor = max(linhas)
    a, m = divmod(ultimo, 100)
    extras = []
    for _ in range(24):
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
        extras.append((a * 100 + m, valor))
    con.executemany("INSERT INTO salario_minimo VALUES (?, ?)", extras)


def processar_caged(con, brutos: Path, refazer: bool, conferir: bool = True):
    destino = SILVER_T / "caged"
    destino.mkdir(parents=True, exist_ok=True)
    salario_minimo(con)
    for arq in sorted((brutos / "caged").glob("*/CAGED*.7z")):
        m = re.match(r"CAGED(MOV|FOR|EXC)(\d{6})", arq.name.upper())
        if not m:
            continue
        tipo, aaaamm = m.groups()
        saida = destino / f"{aaaamm}_{tipo}.parquet"
        if saida.exists() and not refazer:
            continue
        if conferir and remotos(f"/pdet/microdados/NOVO CAGED/{aaaamm[:4]}/{aaaamm}/").get(arq.name) != arq.stat().st_size:
            continue  # ainda baixando
        with tempfile.TemporaryDirectory(dir=brutos) as tmp:
            txt = descompactar(arq, Path(tmp))
            rel, c = ler_csv(con, txt, "utf-8")
            competencia = inteiro(coluna(c, "competenciamov"))
            con.execute(f"""
                COPY (
                    SELECT '{tipo}' AS tipo, {aaaamm} AS arquivo, competencia, municipio, secao, sexo,
                           count(*) FILTER (s = 1) AS admissoes, count(*) FILTER (s = -1) AS desligamentos,
                           sum(s) AS saldo,
                           -- salário de admissão só entre 0,3 e 150 salários mínimos da competência (fora disso,
                           -- erros de digitação como R$ 0,01 ou R$ 10 milhões)
                           sum(sal) FILTER (s = 1 AND sal BETWEEN 0.3 * sm.valor AND 150 * sm.valor) AS salario_adm_soma,
                           count(*) FILTER (s = 1 AND sal BETWEEN 0.3 * sm.valor AND 150 * sm.valor) AS salario_adm_n
                    FROM (SELECT {competencia} AS competencia, {inteiro(coluna(c, 'municipio'))} AS municipio,
                                 trim({coluna(c, 'secao')}) AS secao, {inteiro(coluna(c, 'sexo'))} AS sexo,
                                 {inteiro(coluna(c, 'saldomovimentacao'))} AS s, {num(coluna(c, 'salario', 'valorsalariofixo'))} AS sal
                          FROM {rel}) x
                    LEFT JOIN salario_minimo sm ON sm.aaaamm = x.competencia
                    GROUP BY ALL
                ) TO '{saida.as_posix()}' (FORMAT parquet)""")
        print(f"  CAGED {aaaamm} {tipo}: ok", flush=True)


# ---------------- gold ----------------

def cnae(con):
    """Nomes das seções e divisões da CNAE 2.0, da API de classificações do IBGE (uma vez)."""
    destino = GOLD_T / "cnae.parquet"
    if destino.exists():
        return
    linhas = []
    for d in requests.get("https://servicodados.ibge.gov.br/api/v2/cnae/divisoes", timeout=60).json():
        linhas.append((d["id"], d["descricao"].strip(), d["secao"]["id"], d["secao"]["descricao"].strip()))
    con.execute("CREATE OR REPLACE TEMP TABLE cnae_t(divisao VARCHAR, divisao_nome VARCHAR, secao VARCHAR, secao_nome VARCHAR)")
    con.executemany("INSERT INTO cnae_t VALUES (?, ?, ?, ?)", linhas)
    GOLD_T.mkdir(parents=True, exist_ok=True)
    con.execute(f"COPY cnae_t TO '{destino.as_posix()}' (FORMAT parquet)")


def gerar_gold(con):
    GOLD_T.mkdir(parents=True, exist_ok=True)
    s, g = SILVER_T.as_posix(), GOLD_T.as_posix()
    # RAIS usa o código IBGE de 6 dígitos; Brasília (530010) é o Distrito Federal
    con.execute(f"""CREATE OR REPLACE TEMP TABLE muni AS
                    SELECT cod_ibge, cod_ibge // 10 AS municipio, nome, uf, regiao FROM '{SILVER.as_posix()}/entes.parquet'
                    WHERE esfera = 'M'""")
    # UF pelo prefixo do código, para movimentações em códigos fora do cadastro (Fernando de Noronha, 260545);
    # o código 999999 (município ignorado) não tem UF e entra só no total do Brasil
    con.execute(f"""CREATE OR REPLACE TEMP TABLE estados AS
                    SELECT cod_ibge AS cod, uf FROM '{SILVER.as_posix()}/entes.parquet' WHERE esfera IN ('E', 'D')""")
    com_uf = lambda rel, cod: f"""(SELECT x.*, coalesce(m.uf, u.uf) AS uf_
                                   FROM {rel} x LEFT JOIN muni m ON m.municipio = x.{cod}
                                   LEFT JOIN estados u ON u.cod = x.{cod} // 10000)"""
    if any((SILVER_T / "rais_vinculos").glob("*.parquet")):
        setores = ", ".join(f"sum(vinculos) FILTER (grande_setor = '{x}') AS empregos_{x}" for x in SETORES)
        con.execute(f"""
            COPY (
                WITH v AS (
                    SELECT ano, municipio, sum(vinculos) AS empregos,
                           sum(vinculos) FILTER (sexo = 2) AS mulheres, sum(vinculos) FILTER (superior) AS superior,
                           sum(vinculos) FILTER (faixa_idade = 'ate24') AS ate24, sum(vinculos) FILTER (faixa_idade = '50mais') AS de50mais,
                           {setores},
                           -- massa e número de vínculos com remuneração em dezembro: o site faz a média
                           -- ponderada de qualquer grupo como soma das massas ÷ soma dos vínculos
                           sum(rem_dez_soma) AS massa_dez, sum(rem_dez_n) AS n_rem_dez,
                           sum(rem_dez_soma) FILTER (sexo = 2) AS massa_dez_mulheres, sum(rem_dez_n) FILTER (sexo = 2) AS n_rem_dez_mulheres,
                           sum(rem_dez_soma) FILTER (sexo = 1) AS massa_dez_homens, sum(rem_dez_n) FILTER (sexo = 1) AS n_rem_dez_homens
                    FROM '{s}/rais_vinculos/*.parquet' GROUP BY ALL),
                e AS (SELECT ano, municipio, sum(estabelecimentos) AS estabelecimentos FROM '{s}/rais_estab/*.parquet' GROUP BY ALL)
                SELECT v.ano, m.cod_ibge, m.nome, m.uf, m.regiao, i.populacao, v.* EXCLUDE (ano, municipio), e.estabelecimentos
                FROM v JOIN muni m USING (municipio)
                LEFT JOIN e USING (ano, municipio)
                -- população do painel de finanças; Brasília usa a do ente Distrito Federal (53)
                LEFT JOIN '{GOLD.as_posix()}/indicadores.parquet' i
                       ON i.exercicio = v.ano AND i.cod_ibge = CASE WHEN m.cod_ibge = 5300108 THEN 53 ELSE m.cod_ibge END
                ORDER BY m.cod_ibge, v.ano
            ) TO '{g}/municipios.parquet' (FORMAT parquet, COMPRESSION zstd)""")
        con.execute(f"""
            COPY (
                SELECT v.ano, m.cod_ibge, v.divisao, sum(vinculos) AS empregos,
                       sum(rem_dez_soma) / nullif(sum(rem_dez_n), 0) AS remuneracao_media_dez
                FROM '{s}/rais_vinculos/*.parquet' v JOIN muni m USING (municipio)
                GROUP BY ALL ORDER BY m.cod_ibge, v.ano, v.divisao
            ) TO '{g}/setores.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)""")
        con.execute(f"""
            COPY (
                SELECT * FROM (
                    SELECT v.ano, CASE WHEN grouping(v.uf_) = 1 THEN 'BR' ELSE v.uf_ END AS escopo, v.divisao, sum(vinculos) AS empregos,
                           sum(rem_dez_soma) / nullif(sum(rem_dez_n), 0) AS remuneracao_media_dez
                    FROM {com_uf(f"'{s}/rais_vinculos/*.parquet'", 'municipio')} v
                    GROUP BY GROUPING SETS ((v.ano, v.uf_, v.divisao), (v.ano, v.divisao)))
                WHERE escopo IS NOT NULL ORDER BY ALL
            ) TO '{g}/setores_uf.parquet' (FORMAT parquet, COMPRESSION zstd)""")
        print("gold/trabalho: municipios, setores e setores_uf")
    if any((SILVER_T / "caged").glob("*.parquet")):
        # série com ajustes: no prazo + fora do prazo − exclusões, todos pela competência da movimentação
        ajuste = f"""SELECT competencia, municipio, secao, sexo,
                            sum(CASE WHEN tipo = 'EXC' THEN -admissoes ELSE admissoes END) AS admissoes,
                            sum(CASE WHEN tipo = 'EXC' THEN -desligamentos ELSE desligamentos END) AS desligamentos,
                            sum(CASE WHEN tipo = 'EXC' THEN -saldo ELSE saldo END) AS saldo,
                            sum(salario_adm_soma) FILTER (tipo <> 'EXC') AS salario_adm_soma,
                            sum(salario_adm_n) FILTER (tipo <> 'EXC') AS salario_adm_n
                     FROM '{s}/caged/*.parquet' GROUP BY ALL"""
        con.execute(f"""
            COPY (
                SELECT a.competencia, m.cod_ibge, sum(admissoes) AS admissoes, sum(desligamentos) AS desligamentos,
                       sum(saldo) AS saldo, sum(salario_adm_soma) / nullif(sum(salario_adm_n), 0) AS salario_medio_admissao
                FROM ({ajuste}) a JOIN muni m USING (municipio)
                GROUP BY ALL ORDER BY m.cod_ibge, a.competencia
            ) TO '{g}/caged.parquet' (FORMAT parquet, COMPRESSION zstd)""")
        con.execute(f"""
            COPY (
                SELECT a.competencia // 100 AS ano, m.cod_ibge, count(DISTINCT a.competencia) AS meses,
                       sum(admissoes) AS admissoes, sum(desligamentos) AS desligamentos, sum(saldo) AS saldo
                FROM ({ajuste}) a JOIN muni m USING (municipio)
                GROUP BY ALL ORDER BY m.cod_ibge, ano
            ) TO '{g}/caged_anual.parquet' (FORMAT parquet, COMPRESSION zstd)""")
        con.execute(f"""
            COPY (
                SELECT * FROM (
                    SELECT a.competencia, CASE WHEN grouping(a.uf_) = 1 THEN 'BR' ELSE a.uf_ END AS escopo,
                           CASE WHEN grouping(a.secao) = 1 THEN 'TOTAL' ELSE coalesce(nullif(a.secao, ''), '?') END AS secao,
                           sum(admissoes) AS admissoes, sum(desligamentos) AS desligamentos, sum(saldo) AS saldo,
                           sum(salario_adm_soma) / nullif(sum(salario_adm_n), 0) AS salario_medio_admissao
                    FROM {com_uf(f"({ajuste})", 'municipio')} a
                    GROUP BY GROUPING SETS ((a.competencia, a.uf_, a.secao), (a.competencia, a.secao), (a.competencia, a.uf_), (a.competencia)))
                WHERE escopo IS NOT NULL ORDER BY ALL
            ) TO '{g}/caged_uf.parquet' (FORMAT parquet, COMPRESSION zstd)""")
        print("gold/trabalho: caged, caged_anual e caged_uf")
    cnae(con)
    # nomes dos códigos dos microdados (CBO, CNAE, afastamento, desligamento…), para a consulta personalizada
    con.execute(f"""COPY (SELECT * FROM read_csv('{(Path(__file__).parent / "dicionario_trabalho.csv").as_posix()}',
                                                 header=true, delim=',', quote='"', all_varchar=true) ORDER BY variavel, codigo)
                    TO '{g}/dicionario.parquet' (FORMAT parquet, COMPRESSION zstd)""")
    atualizar_manifesto(con)


def atualizar_manifesto(con):
    """Grava os anos da RAIS e os meses do CAGED no manifesto (o gold.py faz o mesmo ao gerá-lo inteiro)."""
    import json
    from gold import fonte_trabalho

    caminho = GOLD / "manifesto.json"
    if not caminho.exists():
        return
    from datetime import datetime, timezone

    manifesto = json.loads(caminho.read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {}).update(fonte_trabalho(con))
    # o site põe gerado_em no caminho dos arquivos (/dados/v/<versão>/): sem mudar, o navegador usaria o cache antigo
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    caminho.write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--brutos", default=os.environ.get("TRABALHO_BRUTOS", "D:/LVBERNARDELLI/finbra_brutos"))
    p.add_argument("--refazer", action="store_true")
    p.add_argument("--so-gold", action="store_true")
    p.add_argument("--sem-conferir", action="store_true", help="não confere os tamanhos no FTP (pastas de teste)")
    args = p.parse_args()
    con = duckdb.connect()
    con.execute("SET memory_limit = '6GB'")
    if not args.so_gold:
        brutos = Path(args.brutos)
        processar_rais(con, brutos, args.refazer, not args.sem_conferir)
        processar_caged(con, brutos, args.refazer, not args.sem_conferir)
    gerar_gold(con)


if __name__ == "__main__":
    main()
