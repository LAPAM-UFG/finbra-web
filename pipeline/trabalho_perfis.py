"""Perfis agregados da RAIS (raça/cor, escolaridade, tipo de vínculo e vínculo MTE) por município, UF e Brasil.

Gera, para cada ano, um Parquet pequeno com os números já prontos do painel de mercado de trabalho, no lugar de
consultar os microdados no navegador:

    <saida>/gold/trabalho/perfis/ano=AAAA.parquet   uma linha por escopo × variável × código
    <saida>/gold/trabalho/perfis/indice.json         anos, arquivos, tamanhos, hashes, universo e conciliação
    <saida>/gold/manifesto.json                      manifesto CANDIDATO (cópia do de --base + fontes.rais_perfis)

Colunas do Parquet: ano INTEGER, escopo VARCHAR (município '5208707', UF 'GO' ou Brasil 'BR'), variavel VARCHAR
('raca_cor', 'escolaridade', 'tipo_vinculo', 'vinculo_mte' ou 'total'), codigo VARCHAR, vinculos BIGINT e total BIGINT
(vínculos ativos do escopo, repetido em todas as linhas, para os percentuais e a auditoria). Ordenado por escopo,
variavel, codigo, com row groups de 2048 linhas (leituras por Range de um município, UF ou do Brasil).

Universo (idêntico ao painel atual): ativo_31_12 = 1, somente municípios presentes em gold/trabalho/municipios.parquet
do mesmo ano (micro.municipio, 6 dígitos = gold.cod_ibge // 10). UF e Brasil somam ESSES municípios; vínculos de
município ignorado ou fora do gold não entram (ficam contados no índice, em "fora_do_gold"). Os UFs lidos são os do
indice.json dos microdados, nunca uma lista presumida.

Códigos observados são preservados: campo vazio vira '_ausente' (nunca 0, 'branca', ensino completo ou CLT), códigos
fora do dicionário continuam presentes e raça/cor 9 ('não identificada') fica separada do vazio. Nada é suprimido nem
arredondado. Só aparecem as categorias observadas no escopo: ausente = 0 quando total > 0 (nenhum zero é inventado);
o município sem vínculos ativos tem a linha variavel='total' com 0. A soma de TODAS as categorias de cada variável
(com ignorados e '_ausente') é igual ao total do escopo.

vinculo_mte é o agrupamento estatístico da nota técnica da RAIS 2023 (MTE), a mesma regra de web/src/dados.ts
(VINCULO_MTE): 1 = tipo_vinculo 10, 15, 20, 25, 60, 65, 70, 75; 2 = 30, 31, 35, 96, 97 (estatutários, inclusive contratos
por lei estadual ou municipal); 3 = demais códigos; NULL fica à parte. Não é o regime jurídico do vínculo; o
tipo_vinculo detalhado é mantido. Escolaridade: 9 = superior completo, 10 = mestrado, 11 = doutorado; o cartão atual
"superior completo" soma 9 + 10 + 11 (dados.ts: escolaridade >= 9).

Para cada município e ano, a contagem dos microdados tem de ser igual a gold.empregos; qualquer diferença interrompe a
execução sem ajustar números. O arquivo do ano só ganha o nome final depois de validado (contra o gold e as somas);
anos já validados são retomados (hash, assinatura da origem e revalidação), nunca arquivos parciais. As origens são
só leitura: o destino é recusado se for igual, estiver dentro ou for ancestral de --micro ou --base.

VERSÃO 2 (padrão do CLI; --versao 1 regera o formato antigo): grava em <saida>/gold/trabalho/perfis_v2/ (ano=AAAA.parquet e
indice.json, versao 2), sem tocar nos arquivos da versão 1 (gold/trabalho/perfis). Acrescenta, em TODA linha (inclusive
total/total), a remuneração de DEZEMBRO nominal em R$ (BRL, rem_dezembro_nom) com as mesmas regras do painel (trabalho.py):

    massa_dez_centavos     BIGINT nullable  soma EXATA, em centavos inteiros, de rem_dezembro_nom > 0 dos vínculos ativos do grupo
    n_rem_dez              BIGINT           quantos vínculos ativos têm rem_dezembro_nom > 0 (0 e negativo não contam)
    remuneracao_media_dez  DOUBLE nullable  massa_dez_centavos / 100 / vinculos: todos os vínculos ativos do GRUPO no denominador,
                                            inclusive quem não tem remuneração válida

Sem nenhum valor positivo: massa e média são NULL (nunca R$ 0,00) e n_rem_dez = 0; grupo sem vínculos: média NULL. UF e
Brasil somam numeradores e denominadores dos municípios, nunca médias. Cada município é conciliado com o gold:
empregos e n_rem_dez exatos; massa em centavos contra round(gold.massa_dez * 100), com tolerância de no máximo 2 centavos só
para o ruído de ponto flutuante do gold legado (o maior desvio fica registrado, o dado não é ajustado); acima disso, a
execução para. Categoria não observada não ganha média inventada.

Uso:
    py pipeline/trabalho_perfis.py --micro E:/finbra/micro --base E:/finbra/data \\
        --saida E:/finbra/candidato_remuneracao_rais_20261112 --anos 2010 2011 ... 2025
"""
import argparse
import copy
import hashlib
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

VERSAO = 1
VERSAO_2 = 2
TOLERANCIA_CENTAVOS = 2  # só ruído de ponto flutuante do gold legado; acima disso a conciliação para
AUSENTE = "_ausente"
VARIAVEIS = ("raca_cor", "escolaridade", "tipo_vinculo", "vinculo_mte")
ROW_GROUP = 2048

# mesma regra de web/src/dados.ts (VINCULO_MTE)
CLT = (10, 15, 20, 25, 60, 65, 70, 75)
ESTATUTARIOS = (30, 31, 35, 96, 97)
VINCULO_MTE_SQL = (f"CASE WHEN tipo_vinculo IN ({', '.join(map(str, CLT))}) THEN '1' "
                   f"WHEN tipo_vinculo IN ({', '.join(map(str, ESTATUTARIOS))}) THEN '2' "
                   f"WHEN tipo_vinculo IS NOT NULL THEN '3' END")

NOTA_MTE = ("https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais/rais-2023/"
            "nota-tecnica-rais-2023_11-12-2024.pdf (pp. 4-5)")


class ErroPerfis(Exception):
    """Falha de contrato (destino, índice, conciliação ou validação): a execução para."""


class ErroDestino(ErroPerfis):
    pass


class ErroConciliacao(ErroPerfis):
    pass


# --------------------------------------------------------------------------- destinos

def _norm(p) -> str:
    return os.path.normcase(os.path.realpath(os.fspath(p)))


def _dentro(filho: str, pai: str) -> bool:
    try:
        return os.path.commonpath([filho, pai]) == pai
    except ValueError:  # discos diferentes
        return False


def validar_destino(alvo, origens) -> Path:
    """Recusa alvo igual, dentro ou ancestral de uma origem (links, '..' e maiúsculas resolvidos). Chamar ANTES de criar/escrever."""
    a = _norm(alvo)
    for o in origens:
        n = _norm(o)
        if a == n or _dentro(a, n) or _dentro(n, a):
            raise ErroDestino(f"destino recusado ({alvo}): coincide com a origem {o} ou está dentro/acima dela")
        if os.path.exists(alvo) and os.path.exists(o) and os.path.samefile(alvo, o):
            raise ErroDestino(f"destino recusado ({alvo}): é o mesmo item da origem {o}")
    return Path(os.path.realpath(os.fspath(alvo)))


def _pasta(versao: int) -> str:
    return "perfis_v2" if versao == VERSAO_2 else "perfis"


def caminhos_saida(saida, versao: int = 1) -> dict:
    perfis = Path(saida) / "gold" / "trabalho" / _pasta(versao)
    return {"perfis": perfis, "indice": perfis / "indice.json",
            "manifesto": Path(saida) / "gold" / "manifesto.json", "tmp_duckdb": Path(saida) / "_tmp_duckdb"}


def arquivo_ano(perfis: Path, ano: int) -> Path:
    return perfis / f"ano={ano}.parquet"


# --------------------------------------------------------------------------- utilidades

def _lit(p) -> str:
    """Literal SQL de caminho (COPY ... TO não aceita parâmetro)."""
    return "'" + Path(p).as_posix().replace("'", "''") + "'"


def _sha256(p) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _gravar_json(caminho: Path, obj) -> None:
    tmp = caminho.with_name(caminho.name + ".parcial")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, caminho)


def conectar(threads: int = 4, memoria: str = "8GB", temp: Path | None = None):
    cfg = {"threads": int(threads), "memory_limit": memoria}
    if temp is not None:
        cfg["temp_directory"] = Path(temp).as_posix()
    return duckdb.connect(":memory:", config=cfg)


def arquivos_micro(micro: Path, indice_micro: dict, ano: int) -> list[Path]:
    """Os arquivos do ano segundo o indice.json real dos microdados (nunca uma lista de UFs presumida)."""
    ufs = (indice_micro.get("rais_vinculos") or {}).get(str(ano))
    if not ufs:
        raise ErroPerfis(f"ano {ano} não consta em rais_vinculos do indice.json dos microdados")
    base = Path(micro) / "silver" / "trabalho" / "micro" / "rais_vinculos" / f"ano={ano}"
    arqs = [base / f"uf={int(u):02d}.parquet" for u in ufs]
    faltam = [a.name for a in arqs if not a.is_file()]
    if faltam:
        raise ErroPerfis(f"ano {ano}: arquivos do índice ausentes em {base}: {faltam}")
    return arqs


def assinatura_origem(arqs: list[Path], gold_municipios: Path) -> dict:
    """Identifica a origem usada (nome, tamanho, mtime) sem ler o conteúdo: muda se algum arquivo mudar."""
    linhas = []
    for a in list(arqs) + [Path(gold_municipios)]:
        s = a.stat()
        linhas.append(f"{a.name}:{s.st_size}:{s.st_mtime_ns}")
    return {"arquivos": len(arqs), "bytes": sum(a.stat().st_size for a in arqs),
            "sha256": hashlib.sha256("\n".join(linhas).encode()).hexdigest()}


# --------------------------------------------------------------------------- agregação

def _carregar_gold(con, gold_municipios, ano: int, versao: int = 1) -> int:
    """Tabela gm (cod7, mun6, uf, empregos [+ massa_dez, n_rem_dez na versão 2]) do ano; recusa gold vazio, duplicado ou sem UF válida."""
    extra = ""
    if versao == VERSAO_2:
        cols = {r[0] for r in con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [Path(gold_municipios).as_posix()]).fetchall()}
        faltam = {"massa_dez", "n_rem_dez"} - cols
        if faltam:
            raise ErroPerfis(f"gold de municípios sem as colunas {sorted(faltam)}")
        extra = ", massa_dez, n_rem_dez"
    con.execute("DROP TABLE IF EXISTS gm")
    con.execute(f"""CREATE TEMP TABLE gm AS
                   SELECT cod_ibge::BIGINT AS cod7, (cod_ibge // 10)::BIGINT AS mun6, uf, empregos{extra}
                   FROM read_parquet(?) WHERE ano = ?""", [Path(gold_municipios).as_posix(), ano])
    n, nulos, dup, ruins = con.execute("""
        SELECT count(*), count(*) FILTER (cod7 IS NULL), count(*) - count(DISTINCT mun6),
               count(*) FILTER (uf IS NULL OR NOT regexp_matches(uf, '^[A-Z]{2}$') OR uf = 'BR')
        FROM gm""").fetchone()
    if n == 0:
        raise ErroPerfis(f"gold de municípios sem linhas para {ano}")
    if nulos or dup or ruins:
        raise ErroPerfis(f"gold {ano}: cod_ibge nulo={nulos}, município (6 dígitos) repetido={dup}, UF inválida={ruins}")
    return n


def _ler_micro(con, arqs: list[Path], versao: int = 1) -> None:
    """Uma leitura estreita por arquivo (município, raça, escolaridade, vínculo; só ativos); acumula em `base`.

    Versão 2 lê também rem_dezembro_nom, que tem de ser DECIMAL(p, 2): a massa é somada em centavos inteiros (exata)."""
    con.execute("DROP TABLE IF EXISTS base")
    con.execute("""CREATE TEMP TABLE base (mun6 BIGINT, raca_cor INTEGER, escolaridade INTEGER,
                   tipo_vinculo INTEGER, n BIGINT, massa BIGINT, n_rem BIGINT)""")
    for a in arqs:
        if versao != VERSAO_2:
            con.execute("""INSERT INTO base
                           SELECT municipio, raca_cor, escolaridade, tipo_vinculo, count(*), NULL::BIGINT, 0
                           FROM read_parquet(?) WHERE ativo_31_12 = 1 GROUP BY ALL""", [a.as_posix()])
            continue
        tipo = {r[0]: r[1] for r in con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [a.as_posix()]).fetchall()}.get("rem_dezembro_nom")
        if not tipo or not re.fullmatch(r"DECIMAL\(\d+,\s*2\)", tipo):
            raise ErroPerfis(f"{a.name}: rem_dezembro_nom é {tipo}, esperado DECIMAL(p,2): a massa em centavos não seria exata")
        con.execute("""INSERT INTO base
                       SELECT municipio, raca_cor, escolaridade, tipo_vinculo, count(*),
                              (sum((rem_dezembro_nom * 100)::BIGINT) FILTER (WHERE rem_dezembro_nom > 0))::BIGINT,
                              count(*) FILTER (WHERE rem_dezembro_nom > 0)
                       FROM read_parquet(?) WHERE ativo_31_12 = 1 GROUP BY ALL""", [a.as_posix()])


def _conciliar(con, ano: int, versao: int = 1) -> dict:
    """micro = gold.empregos em CADA município do gold; qualquer diferença (ou empregos nulo) interrompe.

    Versão 2 concilia também n_rem_dez (exato) e a massa em centavos (round(gold.massa_dez * 100), tolerância de
    TOLERANCIA_CENTAVOS; o maior desvio é registrado e o dado não é ajustado)."""
    gold_v2 = ", g.massa_dez, g.n_rem_dez" if versao == VERSAO_2 else ""
    con.execute(f"""CREATE OR REPLACE TEMP TABLE conc AS
                   SELECT g.cod7, g.uf, g.empregos{gold_v2}, coalesce(sum(b.n), 0)::BIGINT AS micro,
                          sum(b.massa)::BIGINT AS massa, coalesce(sum(b.n_rem), 0)::BIGINT AS n_rem
                   FROM gm g LEFT JOIN base b ON b.mun6 = g.mun6 GROUP BY ALL""")
    dif = con.execute("""SELECT cod7, empregos, micro FROM conc
                         WHERE empregos IS DISTINCT FROM micro::DOUBLE ORDER BY cod7""").fetchall()
    if dif:
        amostra = "; ".join(f"{c}: micro={m} gold={e}" for c, e, m in dif[:10])
        raise ErroConciliacao(f"{ano}: {len(dif)} município(s) com contagem diferente do gold.empregos ({amostra})")
    muns, total = con.execute("SELECT count(*), sum(micro)::BIGINT FROM conc").fetchone()
    fora, fora_n = con.execute("""SELECT coalesce(sum(n), 0)::BIGINT, count(DISTINCT mun6) FROM base
                                  WHERE mun6 IS NULL OR mun6 NOT IN (SELECT mun6 FROM gm)""").fetchone()
    saida = {"municipios": muns, "divergencias": 0, "total_br": total,
             "fora_do_gold": {"vinculos_ativos": fora, "codigos_municipio": fora_n}}
    if versao == VERSAO_2:
        nulos = con.execute("""SELECT cod7 FROM conc WHERE massa_dez < 0
            OR (massa_dez IS NULL AND massa IS NOT NULL)
            OR (massa_dez IS NOT NULL AND massa_dez <> 0 AND massa IS NULL)""").fetchall()
        if nulos:
            raise ErroConciliacao(f"{ano}: massa ausente ou inválida no gold não equivale a arredondamento ({nulos[:10]})")
        dif = con.execute("""SELECT cod7, n_rem_dez, n_rem FROM conc WHERE n_rem_dez IS DISTINCT FROM n_rem::DOUBLE ORDER BY cod7""").fetchall()
        if dif:
            amostra = "; ".join(f"{c}: micro={m} gold={e}" for c, e, m in dif[:10])
            raise ErroConciliacao(f"{ano}: {len(dif)} município(s) com n_rem_dez diferente do gold ({amostra})")
        desvios = con.execute("""SELECT cod7, abs(coalesce(round(massa_dez * 100)::BIGINT, 0) - coalesce(massa, 0)) AS d,
                                        massa, massa_dez FROM conc ORDER BY d DESC, cod7""").fetchall()
        maior = desvios[0][1] if desvios else 0
        if maior > TOLERANCIA_CENTAVOS:
            ruins = [x for x in desvios if x[1] > TOLERANCIA_CENTAVOS]
            amostra = "; ".join(f"{c}: micro={m} centavos, gold={g} R$ (desvio {d})" for c, d, m, g in ruins[:10])
            raise ErroConciliacao(f"{ano}: {len(ruins)} município(s) com massa de dezembro acima da tolerância de "
                                  f"{TOLERANCIA_CENTAVOS} centavos ({amostra})")
        massa_br, n_br = con.execute("SELECT sum(massa)::BIGINT, sum(n_rem)::BIGINT FROM conc").fetchone()
        saida["n_rem_dez"] = {"divergencias": 0, "total_br": n_br}
        saida["massa_dez"] = {"contra": "round(gold.massa_dez * 100), em centavos", "tolerancia_centavos": TOLERANCIA_CENTAVOS,
                              "maior_desvio_centavos": maior, "municipios_com_desvio": sum(1 for x in desvios if x[1] > 0),
                              "total_br_centavos": massa_br}
    return saida


def _montar(con, ano: int, versao: int = 1) -> None:
    """Tabela `saida_ano` com municípios, UFs e Brasil, a partir de `base` e `gm` (UF e BR somam os municípios).

    Versão 2: massa e n_rem_dez somam como os vínculos (numeradores e denominadores, nunca médias); a média é calculada
    por linha como massa ÷ 100 ÷ vínculos do grupo (NULL sem massa ou sem vínculos)."""
    con.execute("""CREATE OR REPLACE TEMP TABLE bg AS
                   SELECT g.cod7, g.uf, b.raca_cor, b.escolaridade, b.tipo_vinculo, b.n, b.massa, b.n_rem
                   FROM base b JOIN gm g ON g.mun6 = b.mun6""")
    ausente = f"'{AUSENTE}'"
    dims = {"raca_cor": "raca_cor::VARCHAR", "escolaridade": "escolaridade::VARCHAR", "tipo_vinculo": "tipo_vinculo::VARCHAR",
            "vinculo_mte": VINCULO_MTE_SQL}
    partes = ["SELECT cod7::VARCHAR AS escopo, uf, 'total' AS variavel, 'total' AS codigo, micro AS vinculos, massa, n_rem FROM conc"]
    for v, expr in dims.items():
        partes.append(f"SELECT cod7::VARCHAR, uf, '{v}', coalesce({expr}, {ausente}), sum(n), sum(massa)::BIGINT, sum(n_rem) FROM bg GROUP BY ALL")
    con.execute("CREATE OR REPLACE TEMP TABLE mun_long AS " + " UNION ALL ".join(partes))
    con.execute("""CREATE OR REPLACE TEMP TABLE longo AS
        SELECT escopo, variavel, codigo, vinculos, massa, n_rem FROM mun_long
        UNION ALL SELECT uf, variavel, codigo, sum(vinculos), sum(massa)::BIGINT, sum(n_rem) FROM mun_long GROUP BY uf, variavel, codigo
        UNION ALL SELECT 'BR', variavel, codigo, sum(vinculos), sum(massa)::BIGINT, sum(n_rem) FROM mun_long GROUP BY variavel, codigo""")
    if versao == VERSAO_2:
        con.execute(f"""CREATE OR REPLACE TEMP TABLE saida_ano AS
            SELECT {int(ano)}::INTEGER AS ano, l.escopo, l.variavel, l.codigo, l.vinculos::BIGINT AS vinculos, t.vinculos::BIGINT AS total,
                   l.massa::BIGINT AS massa_dez_centavos, l.n_rem::BIGINT AS n_rem_dez,
                   CASE WHEN l.massa IS NOT NULL AND l.vinculos > 0 THEN l.massa::DOUBLE / 100.0 / l.vinculos END AS remuneracao_media_dez
            FROM longo l JOIN (SELECT escopo, vinculos FROM longo WHERE variavel = 'total') t USING (escopo)""")
    else:
        con.execute(f"""CREATE OR REPLACE TEMP TABLE saida_ano AS
            SELECT {int(ano)}::INTEGER AS ano, l.escopo, l.variavel, l.codigo, l.vinculos::BIGINT AS vinculos, t.vinculos::BIGINT AS total
            FROM longo l JOIN (SELECT escopo, vinculos FROM longo WHERE variavel = 'total') t USING (escopo)""")


COLUNAS_V1 = {"ano": "INTEGER", "escopo": "VARCHAR", "variavel": "VARCHAR", "codigo": "VARCHAR", "vinculos": "BIGINT", "total": "BIGINT"}
COLUNAS_V2 = {**COLUNAS_V1, "massa_dez_centavos": "BIGINT", "n_rem_dez": "BIGINT", "remuneracao_media_dez": "DOUBLE"}


def validar_arquivo(con, caminho: Path, ano: int, gold_municipios, versao: int = 1) -> dict:
    """Valida o Parquet escrito contra o gold e as somas. Devolve o resumo; levanta ErroPerfis se algo não fechar."""
    caminho = Path(caminho)
    esperado = COLUNAS_V2 if versao == VERSAO_2 else COLUNAS_V1
    cols = {r[0]: r[1] for r in con.execute("DESCRIBE SELECT * FROM read_parquet(?)", [caminho.as_posix()]).fetchall()}
    if cols != esperado:
        raise ErroPerfis(f"{caminho.name}: colunas {cols} diferentes de {esperado}")
    _carregar_gold(con, gold_municipios, ano, versao)
    con.execute("CREATE OR REPLACE TEMP TABLE arq AS SELECT * FROM read_parquet(?)", [caminho.as_posix()])
    q = lambda sql: con.execute(sql).fetchone()[0]  # noqa: E731
    problemas = []
    if q(f"SELECT count(*) FROM arq WHERE ano <> {int(ano)} OR ano IS NULL"):
        problemas.append("linhas com ano diferente")
    if q("SELECT count(*) FROM arq WHERE escopo IS NULL OR variavel IS NULL OR codigo IS NULL OR vinculos IS NULL OR total IS NULL"):
        problemas.append("valores nulos")
    if q("SELECT count(*) FROM arq WHERE vinculos < 0 OR total < 0"):
        problemas.append("contagem negativa")
    if q("SELECT count(*) FROM (SELECT 1 FROM arq GROUP BY escopo, variavel, codigo HAVING count(*) > 1)"):
        problemas.append("linhas duplicadas")
    if q(f"SELECT count(*) FROM arq WHERE variavel NOT IN ('total', {', '.join(repr(v) for v in VARIAVEIS)})"):
        problemas.append("variável desconhecida")
    # total do escopo: linha 'total' única e igual à coluna total em todas as linhas
    if q("""SELECT count(*) FROM arq a JOIN (SELECT escopo, vinculos AS t FROM arq WHERE variavel = 'total' AND codigo = 'total') t
            USING (escopo) WHERE a.total <> t.t"""):
        problemas.append("coluna total diferente da linha 'total'")
    if q("SELECT count(*) FROM (SELECT DISTINCT escopo FROM arq) e WHERE escopo NOT IN (SELECT escopo FROM arq WHERE variavel = 'total')"):
        problemas.append("escopo sem linha 'total'")
    # soma de TODAS as categorias = total, para cada variável com linhas
    if q("""SELECT count(*) FROM (SELECT escopo, variavel, sum(vinculos) AS s, any_value(total) AS t FROM arq
            WHERE variavel <> 'total' GROUP BY escopo, variavel) WHERE s <> t"""):
        problemas.append("soma das categorias diferente do total")
    # escopo com total > 0 precisa ter todas as 4 variáveis
    if q("""SELECT count(*) FROM (SELECT escopo FROM arq WHERE total > 0 GROUP BY escopo HAVING count(DISTINCT variavel) <> 5)"""):
        problemas.append("escopo com total > 0 sem alguma variável")
    # escopos: exatamente municípios do gold + UFs do gold + BR; município = gold.empregos; UF e BR = soma
    esc_arq = {r[0] for r in con.execute("SELECT DISTINCT escopo FROM arq").fetchall()}
    esc_gold = {str(r[0]) for r in con.execute("SELECT cod7 FROM gm").fetchall()}
    esc_gold |= {r[0] for r in con.execute("SELECT DISTINCT uf FROM gm").fetchall()} | {"BR"}
    if esc_arq != esc_gold:
        problemas.append(f"escopos diferentes do gold (a mais: {sorted(esc_arq - esc_gold)[:5]}, a menos: {sorted(esc_gold - esc_arq)[:5]})")
    if q("""SELECT count(*) FROM gm g JOIN (SELECT escopo, vinculos FROM arq WHERE variavel = 'total') t ON t.escopo = g.cod7::VARCHAR
            WHERE g.empregos IS DISTINCT FROM t.vinculos::DOUBLE"""):
        problemas.append("município diferente do gold.empregos")
    if q("""SELECT count(*) FROM (SELECT uf, sum(cod_t) AS s FROM (SELECT g.uf, t.vinculos AS cod_t FROM gm g
            JOIN (SELECT escopo, vinculos FROM arq WHERE variavel = 'total') t ON t.escopo = g.cod7::VARCHAR) GROUP BY uf) u
            JOIN (SELECT escopo, vinculos FROM arq WHERE variavel = 'total') t ON t.escopo = u.uf WHERE t.vinculos <> u.s"""):
        problemas.append("UF diferente da soma dos municípios")
    # cada categoria de UF e de BR = soma das categorias dos municípios
    if q("""SELECT count(*) FROM (
              SELECT g.uf AS escopo, a.variavel, a.codigo, sum(a.vinculos) AS s FROM arq a JOIN gm g ON a.escopo = g.cod7::VARCHAR
              GROUP BY ALL) m
            FULL JOIN (SELECT escopo, variavel, codigo, vinculos FROM arq WHERE length(escopo) = 2 AND escopo <> 'BR') u
              USING (escopo, variavel, codigo) WHERE m.s IS DISTINCT FROM u.vinculos"""):
        problemas.append("categoria de UF diferente da soma dos municípios")
    if q("""SELECT count(*) FROM (SELECT variavel, codigo, sum(vinculos) AS s FROM arq WHERE length(escopo) = 2 AND escopo <> 'BR' GROUP BY ALL) m
            FULL JOIN (SELECT variavel, codigo, vinculos FROM arq WHERE escopo = 'BR') b USING (variavel, codigo)
            WHERE m.s IS DISTINCT FROM b.vinculos"""):
        problemas.append("categoria do Brasil diferente da soma das UFs")
    extra = _validar_remuneracao(con, q, problemas) if versao == VERSAO_2 else {}
    if problemas:
        raise ErroPerfis(f"{caminho.name} não validado: " + "; ".join(problemas))
    ausentes = {v: q(f"SELECT coalesce(sum(vinculos), 0) FROM arq WHERE escopo = 'BR' AND variavel = '{v}' AND codigo = '{AUSENTE}'")
                for v in VARIAVEIS}
    return {"linhas": q("SELECT count(*) FROM arq"), "municipios": q("SELECT count(*) FROM gm"),
            "ufs": q("SELECT count(DISTINCT uf) FROM gm"), "total_br": q("SELECT vinculos FROM arq WHERE escopo = 'BR' AND variavel = 'total'"),
            "ausentes_br": ausentes, **extra}


def _validar_remuneracao(con, q, problemas: list) -> dict:
    """Verificações da versão 2 sobre a tabela `arq` (massa, n_rem_dez e média) contra o gold e as somas."""
    total = "(SELECT escopo, vinculos AS tv, coalesce(massa_dez_centavos, 0) AS tm, n_rem_dez AS tn FROM arq WHERE variavel = 'total' AND codigo = 'total')"
    if q("SELECT count(*) FROM arq WHERE n_rem_dez IS NULL OR n_rem_dez < 0"):
        problemas.append("n_rem_dez nulo ou negativo")
    if q("SELECT count(*) FROM arq WHERE n_rem_dez > vinculos"):
        problemas.append("n_rem_dez maior que os vínculos")
    # nulidade coerente: massa NULL exatamente quando ninguém tem valor positivo; todo valor positivo vale ao menos 1 centavo
    if q("SELECT count(*) FROM arq WHERE (massa_dez_centavos IS NULL) <> (n_rem_dez = 0)"):
        problemas.append("massa nula incoerente com n_rem_dez")
    if q("SELECT count(*) FROM arq WHERE massa_dez_centavos < n_rem_dez OR massa_dez_centavos < 0"):
        problemas.append("massa menor que 1 centavo por valor informado")
    # média = massa ÷ 100 ÷ todos os vínculos do grupo; NULL sem massa ou sem vínculos (nunca R$ 0,00)
    if q("""SELECT count(*) FROM arq WHERE (remuneracao_media_dez IS NULL) <> (massa_dez_centavos IS NULL OR vinculos = 0)
              OR abs(remuneracao_media_dez - massa_dez_centavos / 100.0 / vinculos) > 1e-9 * greatest(1, abs(remuneracao_media_dez))"""):
        problemas.append("média diferente de massa ÷ vínculos do grupo")
    # massas e n_rem_dez de TODAS as categorias somam ao total de cada variável
    if q(f"""SELECT count(*) FROM (SELECT escopo, variavel, sum(coalesce(massa_dez_centavos, 0)) AS sm, sum(n_rem_dez) AS sn FROM arq
             WHERE variavel <> 'total' GROUP BY escopo, variavel) c JOIN {total} t USING (escopo) WHERE c.sm <> t.tm OR c.sn <> t.tn"""):
        problemas.append("massa ou n_rem_dez das categorias diferente do total")
    # UF e Brasil, categoria por categoria: somas de numeradores e denominadores
    if q("""SELECT count(*) FROM (SELECT g.uf AS escopo, a.variavel, a.codigo, sum(coalesce(a.massa_dez_centavos, 0)) AS sm, sum(a.n_rem_dez) AS sn
                                  FROM arq a JOIN gm g ON a.escopo = g.cod7::VARCHAR GROUP BY ALL) m
            JOIN (SELECT escopo, variavel, codigo, coalesce(massa_dez_centavos, 0) AS sm, n_rem_dez AS sn FROM arq
                  WHERE length(escopo) = 2 AND escopo <> 'BR') u USING (escopo, variavel, codigo) WHERE m.sm <> u.sm OR m.sn <> u.sn"""):
        problemas.append("massa ou n_rem_dez de categoria da UF diferente da soma dos municípios")
    if q("""SELECT count(*) FROM (SELECT variavel, codigo, sum(coalesce(massa_dez_centavos, 0)) AS sm, sum(n_rem_dez) AS sn FROM arq
                                  WHERE length(escopo) = 2 AND escopo <> 'BR' GROUP BY ALL) m
            JOIN (SELECT variavel, codigo, coalesce(massa_dez_centavos, 0) AS sm, n_rem_dez AS sn FROM arq WHERE escopo = 'BR') b
              USING (variavel, codigo) WHERE m.sm <> b.sm OR m.sn <> b.sn"""):
        problemas.append("massa ou n_rem_dez de categoria do Brasil diferente da soma das UFs")
    # município contra o gold: n_rem_dez exato; massa em centavos com a tolerância do ruído de ponto flutuante
    if q("""SELECT count(*) FROM gm g JOIN arq a ON a.escopo = g.cod7::VARCHAR AND a.variavel = 'total'
        WHERE g.massa_dez < 0 OR (g.massa_dez IS NULL AND a.massa_dez_centavos IS NOT NULL)
           OR (g.massa_dez IS NOT NULL AND g.massa_dez <> 0 AND a.massa_dez_centavos IS NULL)"""):
        problemas.append("nulidade ou sinal da massa de município diferente do gold")
    if q(f"""SELECT count(*) FROM gm g JOIN {total} t ON t.escopo = g.cod7::VARCHAR WHERE g.n_rem_dez IS DISTINCT FROM t.tn::DOUBLE"""):
        problemas.append("n_rem_dez de município diferente do gold")
    maior, com_desvio = con.execute(f"""SELECT coalesce(max(abs(coalesce(round(g.massa_dez * 100)::BIGINT, 0) - t.tm)), 0),
                                              count(*) FILTER (abs(coalesce(round(g.massa_dez * 100)::BIGINT, 0) - t.tm) > 0)
                                       FROM gm g JOIN {total} t ON t.escopo = g.cod7::VARCHAR""").fetchone()
    if maior > TOLERANCIA_CENTAVOS:
        problemas.append(f"massa de município diferente do gold.massa_dez (maior desvio {maior} centavos)")
    return {"massa_br_centavos": q("SELECT massa_dez_centavos FROM arq WHERE escopo = 'BR' AND variavel = 'total'"),
            "n_rem_dez_br": q("SELECT n_rem_dez FROM arq WHERE escopo = 'BR' AND variavel = 'total'"),
            "maior_desvio_centavos": maior, "municipios_com_desvio": com_desvio}


def gerar_ano(con, arqs_micro: list[Path], gold_municipios, ano: int, destino: Path, origens=(), versao: int = 1) -> dict:
    """Gera e valida o Parquet de um ano; o nome final só existe se tudo fechar. Devolve o registro do índice."""
    destino = Path(destino)
    validar_destino(destino, origens)
    tmp = destino.with_name(destino.name + ".parcial")
    validar_destino(tmp, origens)
    destino.parent.mkdir(parents=True, exist_ok=True)
    if tmp.exists():
        tmp.unlink()
    _carregar_gold(con, gold_municipios, ano, versao)
    _ler_micro(con, arqs_micro, versao)
    conc = _conciliar(con, ano, versao)
    _montar(con, ano, versao)
    con.execute(f"""COPY (SELECT * FROM saida_ano ORDER BY escopo, variavel, codigo)
                    TO {_lit(tmp)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE {ROW_GROUP})""")
    try:
        resumo = validar_arquivo(con, tmp, ano, gold_municipios, versao)
        if resumo["total_br"] != conc["total_br"]:
            raise ErroPerfis(f"{ano}: total do Brasil no arquivo ({resumo['total_br']}) diferente da conciliação ({conc['total_br']})")
        if versao == VERSAO_2 and (resumo["massa_br_centavos"] != conc["massa_dez"]["total_br_centavos"]
                                   or resumo["n_rem_dez_br"] != conc["n_rem_dez"]["total_br"]):
            raise ErroPerfis(f"{ano}: massa ou n_rem_dez do Brasil no arquivo diferente da conciliação")
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    sha, tam = _sha256(tmp), tmp.stat().st_size
    os.replace(tmp, destino)
    contra = "gold/trabalho/municipios.parquet (empregos)" if versao != VERSAO_2 else "gold/trabalho/municipios.parquet (empregos, n_rem_dez, massa_dez)"
    reg = {"arquivo": destino.name, "bytes": tam, "sha256": sha, "linhas": resumo["linhas"], "municipios": resumo["municipios"],
           "ufs": resumo["ufs"], "total_br": resumo["total_br"], "ausentes_br": resumo["ausentes_br"],
           "conciliacao": {"contra": contra, **conc}, "gerado_em": _agora()}
    if versao == VERSAO_2:
        reg.update({"massa_br_centavos": resumo["massa_br_centavos"], "n_rem_dez_br": resumo["n_rem_dez_br"]})
    return reg


# --------------------------------------------------------------------------- índice e manifesto

def universo() -> dict:
    return {
        "filtro": "ativo_31_12 = 1 (vínculos ativos em 31/12)",
        "municipios": "somente os presentes em gold/trabalho/municipios.parquet do mesmo ano; "
                      "micro.municipio (6 dígitos) = gold.cod_ibge // 10",
        "geografia_ignorada": "fora: município ignorado ou ausente do gold não entra em nenhum escopo "
                              "(contado em fora_do_gold por ano)",
        "uf_e_brasil": "somas dos municípios do gold; nunca média de percentuais",
        "escopos": {"municipio": "código IBGE de 7 dígitos (ex.: '5208707')", "uf": "sigla (ex.: 'GO')", "brasil": "'BR'"},
        "conciliacao": "para cada município e ano, contagem dos microdados = gold.empregos (sem ajuste)",
    }


def dimensoes() -> dict:
    return {
        "raca_cor": {"codigos": "raca_cor da RAIS como observado; 9 = não identificada (separada de vazio)",
                     "ausente": AUSENTE},
        "escolaridade": {"codigos": "escolaridade da RAIS como observada; 9 = superior completo, 10 = mestrado, 11 = doutorado",
                         "ausente": AUSENTE,
                         "equivalencia": "o cartão 'superior completo' do painel soma 9 + 10 + 11 (escolaridade >= 9)"},
        "tipo_vinculo": {"codigos": "tipo_vinculo detalhado da RAIS como observado", "ausente": AUSENTE},
        "vinculo_mte": {"codigos": {"1": "tipo_vinculo 10, 15, 20, 25, 60, 65, 70, 75 (celetista)",
                                    "2": "30, 31, 35, 96, 97 (estatutário, inclui contratos por lei estadual ou municipal)",
                                    "3": "demais códigos (outros; aprendizes ficam aqui)"},
                        "ausente": AUSENTE,
                        "natureza": "agrupamento estatístico da nota técnica da RAIS 2023, não regime jurídico",
                        "fonte": NOTA_MTE, "regra": "web/src/dados.ts (VINCULO_MTE)"},
        "total": {"codigos": "'total' = vínculos ativos do escopo"},
    }


def remuneracao_doc() -> dict:
    """Documentação dos campos de remuneração da versão 2 (vai para o índice e para fontes.rais_perfis do manifesto)."""
    return {
        "referencia": "remuneração NOMINAL de DEZEMBRO (rem_dezembro_nom) dos vínculos ativos em 31/12, em reais (BRL), sem correção pela inflação",
        "campos": {
            "massa_dez_centavos": "BIGINT nullable: soma exata, em centavos inteiros, das remunerações de dezembro maiores que zero; NULL se ninguém tem valor positivo (nunca R$ 0,00)",
            "n_rem_dez": "BIGINT: vínculos ativos com remuneração de dezembro maior que zero",
            "remuneracao_media_dez": "DOUBLE nullable, em R$: massa_dez_centavos / 100 / vinculos; NULL sem massa ou sem vínculos",
        },
        "formula": "remuneracao_media_dez = (massa_dez_centavos / 100) / vinculos, com TODOS os vínculos ativos do grupo no denominador, "
                   "inclusive quem não tem remuneração válida (regra do painel, trabalho.py; a média fica abaixo do salário de quem tem o valor)",
        "positivos": "só rem_dezembro_nom > 0 entra em massa_dez_centavos e n_rem_dez; zero e negativo não são valor informado, mas o vínculo permanece no denominador",
        "ausentes": "valor vazio, zero ou negativo conta como sem remuneração válida: n_rem_dez menor que vinculos mede quantos",
        "agregacao": "UF e Brasil somam vínculos, massa e n_rem_dez dos municípios e a média é recalculada; nunca média de médias",
        "categorias": "só as observadas no escopo têm linha; categoria não observada não tem média (nem 0)",
        "total": "a linha variavel='total', codigo='total' traz a massa, n_rem_dez e média do escopo inteiro",
        "conciliacao": "por município: vínculos e n_rem_dez iguais ao gold; massa igual a round(gold.massa_dez * 100) com tolerância de "
                       f"{TOLERANCIA_CENTAVOS} centavos só para ruído de ponto flutuante; maior desvio registrado no índice",
    }


def ler_indice(perfis: Path, versao: int = 1) -> dict:
    """Índice existente, ou vazio se ausente/ilegível/de outra versão (nada é confiado sem revalidação; V1 nunca vale como V2)."""
    try:
        d = json.loads((Path(perfis) / "indice.json").read_text(encoding="utf-8"))
        if d.get("versao") == versao and isinstance(d.get("arquivos"), dict):
            return d
    except (OSError, ValueError):
        pass
    return {"arquivos": {}}


def _colunas_doc(versao: int) -> dict:
    colunas = {"ano": "INTEGER", "escopo": "VARCHAR", "variavel": "VARCHAR", "codigo": "VARCHAR",
               "vinculos": "BIGINT", "total": "BIGINT (vínculos ativos do escopo, repetido)"}
    if versao == VERSAO_2:
        colunas.update({"massa_dez_centavos": "BIGINT nullable", "n_rem_dez": "BIGINT", "remuneracao_media_dez": "DOUBLE nullable (R$)"})
    return colunas


def montar_indice(arquivos: dict, versao: int = 1) -> dict:
    anos = sorted(int(a) for a in arquivos)
    indice = {
        "versao": versao, "gerado_em": _agora(), "gerador": "pipeline/trabalho_perfis.py",
        "anos": anos,
        "colunas": _colunas_doc(versao),
        "ordenacao": "escopo, variavel, codigo", "row_group": ROW_GROUP, "compressao": "zstd",
        "variaveis": list(VARIAVEIS) + ["total"], "ausente": AUSENTE,
        "universo": universo(), "dimensoes": dimensoes(),
        "zeros": "categorias não observadas no escopo não têm linha (equivalem a 0 vínculos quando total > 0, sem média); nada é preenchido ou suprimido",
        "arquivos": {str(a): arquivos[str(a)] for a in anos},
    }
    if versao == VERSAO_2:
        indice["remuneracao"] = remuneracao_doc()
        indice["tolerancia_massa_centavos"] = TOLERANCIA_CENTAVOS
        indice["maior_desvio_centavos"] = max((r.get("conciliacao", {}).get("massa_dez", {}).get("maior_desvio_centavos", 0) for r in arquivos.values()), default=0)
    return indice


def fonte_perfis(perfis, verificar_hash: bool = True, versao: int = 1) -> dict:
    """Entrada fontes.rais_perfis do manifesto, a partir do indice.json e dos arquivos presentes e conferidos.

    Usada pelo gerador (manifesto candidato) e por gold.fonte_trabalho (regeneração normal do manifesto). Devolve {}
    se não há índice; só anuncia anos cujo arquivo existe com o tamanho (e hash) do índice. A versão 2 (perfis_v2)
    traz também a documentação da remuneração; a 1 (perfis) é só contagens."""
    perfis = Path(perfis)
    ind = ler_indice(perfis, versao)
    ok = {}
    for ano, reg in sorted(ind["arquivos"].items()):
        f = perfis / str(reg.get("arquivo", ""))
        if not f.is_file() or f.stat().st_size != reg.get("bytes"):
            continue
        if verificar_hash and _sha256(f) != reg.get("sha256"):
            continue
        ok[int(ano)] = reg
    if not ok:
        return {}
    anos = sorted(ok)
    pasta = _pasta(versao)
    entrada = {
        "versao": versao,
        "anos": anos,
        "arquivos": f"gold/trabalho/{pasta}/ano={{ano}}.parquet",
        "indice": f"gold/trabalho/{pasta}/indice.json",
        "variaveis": list(VARIAVEIS) + ["total"],
        "universo": ind.get("universo") or universo(),
        "dimensoes": ind.get("dimensoes") or dimensoes(),
        "total_br": {str(a): ok[a]["total_br"] for a in anos},
        "bytes": sum(ok[a]["bytes"] for a in anos),
        "processado_em": ind.get("gerado_em"),
    }
    if versao == VERSAO_2:
        entrada["colunas"] = _colunas_doc(VERSAO_2)
        entrada["remuneracao"] = ind.get("remuneracao") or remuneracao_doc()
        entrada["maior_desvio_massa_centavos"] = max(
            (ok[a].get("conciliacao", {}).get("massa_dez", {}).get("maior_desvio_centavos", 0) for a in anos), default=0)
    return {"rais_perfis": entrada}


def _fallback_v1(entrada: dict | None) -> dict | None:
    """Forma resumida da fonte V1 (anos, arquivos, índice) para o frontend usar nos anos que a V2 ainda não tem."""
    if not isinstance(entrada, dict) or not entrada.get("anos") or not isinstance(entrada.get("arquivos"), str):
        return None
    if entrada.get("versao", 1) != VERSAO:
        return None
    anos = [a for a in entrada["anos"] if isinstance(a, int)]
    return {"anos": anos, "arquivos": entrada["arquivos"], "indice": entrada.get("indice")} if anos else None


def fonte_perfis_trabalho(pasta_trabalho) -> dict:
    """fontes.rais_perfis de uma regeneração normal do manifesto: prefere a V2 validada (perfis_v2) e, se há V1 válida,
    a leva como fallback_v1 (anos que só a V1 tem); sem V2 válida, preserva a V1 como estava."""
    pasta = Path(pasta_trabalho)
    v1 = fonte_perfis(pasta / "perfis", versao=VERSAO)
    v2 = fonte_perfis(pasta / "perfis_v2", versao=VERSAO_2)
    if not v2:
        return v1
    fb = _fallback_v1(v1.get("rais_perfis")) if v1 else None
    if fb:
        v2["rais_perfis"]["fallback_v1"] = fb
    return v2


def manifesto_candidato(base: Path, saida: Path, perfis: Path, origens=(), versao: int = 1) -> Path:
    """Copia base/gold/manifesto.json (sem alterá-lo) para saida/gold/manifesto.json com fontes.rais_perfis e gerado_em novos.

    Na versão 2, a entrada V1 que o manifesto de --base já tem vira fallback_v1 (anos e caminhos), para os anos que a V2 não cobre."""
    fonte = fonte_perfis(perfis, versao=versao)
    if not fonte:
        raise ErroPerfis("sem anos validados no índice: manifesto candidato não gerado")
    origem = Path(base) / "gold" / "manifesto.json"
    manifesto = json.loads(origem.read_text(encoding="utf-8"))
    if not isinstance(manifesto.get("fontes"), dict):
        raise ErroPerfis(f"{origem} sem o objeto 'fontes'")
    novo = copy.deepcopy(manifesto)
    if versao == VERSAO_2:
        existente = manifesto["fontes"].get("rais_perfis")
        fb = (_fallback_v1(existente) if isinstance(existente, dict) and existente.get("versao", 1) == VERSAO
              else (existente or {}).get("fallback_v1") if isinstance(existente, dict) else None)
        if fb:
            fonte["rais_perfis"]["fallback_v1"] = fb
    novo["fontes"].update(fonte)
    novo["gerado_em"] = _agora()
    destino = caminhos_saida(saida)["manifesto"]
    validar_destino(destino, origens)
    validar_destino(destino.with_name(destino.name + ".parcial"), origens)
    _gravar_json(destino, novo)
    return destino


# --------------------------------------------------------------------------- execução

def executar(micro, base, saida, anos, threads: int = 4, memoria: str = "8GB", refazer: bool = False, log=print, versao: int = VERSAO_2) -> dict:
    micro, base, saida = Path(micro), Path(base), Path(saida)
    origens = [micro, base]
    for o in origens:
        if not o.is_dir():
            raise ErroPerfis(f"origem não encontrada: {o}")
    anos = sorted(set(int(a) for a in anos))
    if not anos:
        raise ErroPerfis("nenhum ano informado")
    if versao not in (VERSAO, VERSAO_2):
        raise ErroPerfis(f"versão {versao} desconhecida")
    c = caminhos_saida(saida, versao)
    # TODOS os destinos são validados antes de qualquer mkdir ou escrita
    if saida.is_file():
        raise ErroDestino(f"{saida} é um arquivo")
    for alvo in [saida, c["perfis"], c["indice"], c["indice"].with_name("indice.json.parcial"), c["manifesto"],
                 c["manifesto"].with_name("manifesto.json.parcial"), c["tmp_duckdb"]] + \
                [arquivo_ano(c["perfis"], a) for a in anos] + [arquivo_ano(c["perfis"], a).with_name(f"ano={a}.parquet.parcial") for a in anos]:
        validar_destino(alvo, origens)
    gold_mun = base / "gold" / "trabalho" / "municipios.parquet"
    indice_micro_p = micro / "silver" / "trabalho" / "micro" / "indice.json"
    for f in (gold_mun, indice_micro_p):
        if not f.is_file():
            raise ErroPerfis(f"origem não encontrada: {f}")
    indice_micro = json.loads(indice_micro_p.read_text(encoding="utf-8"))
    plano = {a: arquivos_micro(micro, indice_micro, a) for a in anos}  # falha cedo, antes de escrever

    c["perfis"].mkdir(parents=True, exist_ok=True)
    c["tmp_duckdb"].mkdir(parents=True, exist_ok=True)
    arquivos = dict(ler_indice(c["perfis"], versao)["arquivos"])
    con = conectar(threads, memoria, c["tmp_duckdb"])
    try:
        for ano in anos:
            destino = arquivo_ano(c["perfis"], ano)
            assin = assinatura_origem(plano[ano], gold_mun)
            reg = arquivos.get(str(ano))
            if reg and not refazer and _reaproveitavel(con, reg, destino, ano, gold_mun, assin, versao):
                log(f"{ano}: já validado, mantido")
                continue
            arquivos.pop(str(ano), None)  # nunca anuncia ano em refazimento
            _gravar_json(c["indice"], montar_indice(arquivos, versao))
            log(f"{ano}: gerando a partir de {len(plano[ano])} arquivo(s)")
            reg = gerar_ano(con, plano[ano], gold_mun, ano, destino, origens, versao)
            reg["origem"] = assin
            arquivos[str(ano)] = reg
            _gravar_json(c["indice"], montar_indice(arquivos, versao))
            log(f"{ano}: ok — {reg['linhas']} linhas, {reg['bytes']} bytes, total BR {reg['total_br']}")
    finally:
        con.close()
        shutil.rmtree(c["tmp_duckdb"], ignore_errors=True)
    _gravar_json(c["indice"], montar_indice(arquivos, versao))
    manifesto = manifesto_candidato(base, saida, c["perfis"], origens, versao) if (base / "gold" / "manifesto.json").is_file() else None
    log(f"índice: {c['indice']}" + (f"; manifesto candidato: {manifesto}" if manifesto else "; sem manifesto de --base: não gerado"))
    return {"anos": sorted(int(a) for a in arquivos), "indice": c["indice"], "manifesto": manifesto}


def _reaproveitavel(con, reg, destino: Path, ano: int, gold_mun, assin, versao: int = 1) -> bool:
    """Ano do índice só é reaproveitado se arquivo, hash, origem e validação conferem."""
    try:
        if reg.get("origem") != assin or not destino.is_file() or destino.stat().st_size != reg.get("bytes"):
            return False
        if _sha256(destino) != reg.get("sha256"):
            return False
        return validar_arquivo(con, destino, ano, gold_mun, versao)["total_br"] == reg.get("total_br")
    except (ErroPerfis, duckdb.Error, OSError):
        return False


def _anos(valores) -> list[int]:
    saida = []
    for v in valores:
        for p in str(v).split(","):
            if p.strip():
                saida.append(int(p))
    return saida


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--micro", required=True, help="raiz dos microdados (contém silver/trabalho/micro/...), somente leitura")
    p.add_argument("--base", required=True, help="raiz dos dados (contém gold/trabalho/municipios.parquet e gold/manifesto.json), somente leitura")
    p.add_argument("--saida", required=True, help="pasta candidata (nunca dentro nem acima de --micro/--base)")
    p.add_argument("--anos", nargs="+", required=True, help="anos separados por espaço ou vírgula")
    p.add_argument("--threads", type=int, default=4)
    p.add_argument("--memoria", default="8GB", help="limite de memória do DuckDB (padrão 8GB; excedente vai para disco em saida/_tmp_duckdb)")
    p.add_argument("--refazer", action="store_true", help="regera os anos pedidos mesmo já validados (só dentro de --saida)")
    p.add_argument("--versao", type=int, choices=(1, 2), default=2, help="2 (padrão): perfis_v2 com remuneração; 1: formato antigo (perfis, só contagens)")
    a = p.parse_args(argv)
    try:
        executar(a.micro, a.base, a.saida, _anos(a.anos), a.threads, a.memoria, a.refazer, versao=a.versao)
    except (ErroPerfis, duckdb.Error) as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
