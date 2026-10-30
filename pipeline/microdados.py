"""Microdados da RAIS e do Novo CAGED em Parquet: uma linha por vínculo, estabelecimento ou movimentação.

Os arquivos públicos do PDET não identificam pessoas nem empresas (sem CPF, PIS, nome ou CNPJ): a unidade
é o vínculo, e quem tem dois empregos aparece em duas linhas. Todas as colunas são mantidas, com nomes
padronizados entre os anos (os de 2023 mudaram) e códigos como números; CNAE e CBO ficam como texto com os
zeros à esquerda. Códigos de "ignorado" (99, 999, 999997…) ficam como vieram, conforme o dicionário do PDET.

A saída fica no HD externo, em --saida (padrão: TRABALHO_MICRO ou E:/finbra/micro), com os
mesmos caminhos que terá no R2:

silver/trabalho/micro/rais_vinculos/ano=AAAA/uf=NN.parquet   todos os vínculos do ano (ativos ou não em 31/12),
                                                             ordenados por município, CNAE e CBO
silver/trabalho/micro/rais_estab/ano=AAAA/uf=NN.parquet      todos os estabelecimentos declarantes
silver/trabalho/micro/caged/arquivo=AAAAMM/TIPO.parquet      movimentações do arquivo do mês (MOV no prazo,
                                                             FOR fora do prazo, EXC exclusões), por UF e município

NN é o código IBGE da UF (0 quando o município é ignorado). Um ano só aparece quando termina inteiro: é
montado em ano=AAAA.tmp e renomeado no fim.

Uso:
    py pipeline/microdados.py                  # processa o que houver nos brutos e ainda não estiver na saída
    py pipeline/microdados.py --so rais --anos 2023
    py pipeline/microdados.py --refazer
"""
import argparse
import os
import re
import shutil
import tempfile
from pathlib import Path

import duckdb

from config import GOLD
from trabalho import completo, descompactar, ler_csv, remotos

# (nome padronizado, tipo, nomes normalizados nos arquivos de cada época)
VINCULOS = [
    ("municipio", "INTEGER", ["municipio"]),
    ("municipio_trab", "INTEGER", ["mun_trab", "municipio_trab"]),
    ("cnae_classe", "CNAE5", ["cnae_2_0_classe"]),
    ("cnae_subclasse", "CNAE7", ["cnae_2_0_subclasse"]),
    ("cbo", "CBO", ["cbo_ocupacao_2002", "cbo_2002_ocupacao"]),
    ("ativo_31_12", "TINYINT", ["vinculo_ativo_31_12", "ind_vinculo_ativo_31_12"]),
    ("tipo_vinculo", "SMALLINT", ["tipo_vinculo"]),
    ("mes_admissao", "TINYINT", ["mes_admissao"]),
    ("tipo_admissao", "TINYINT", ["tipo_admissao", "tipo_admissao_trabalhador"]),
    ("mes_desligamento", "TINYINT", ["mes_desligamento"]),
    ("motivo_desligamento", "SMALLINT", ["motivo_desligamento"]),
    ("causa_afastamento_1", "SMALLINT", ["causa_afastamento_1"]),
    ("causa_afastamento_2", "SMALLINT", ["causa_afastamento_2"]),
    ("causa_afastamento_3", "SMALLINT", ["causa_afastamento_3"]),
    ("dias_afastamento", "SMALLINT", ["qtd_dias_afastamento"]),
    ("sexo", "TINYINT", ["sexo_trabalhador", "sexo"]),
    ("idade", "SMALLINT", ["idade"]),
    ("escolaridade", "TINYINT", ["escolaridade_apos_2005"]),
    ("raca_cor", "TINYINT", ["raca_cor"]),
    ("deficiente", "TINYINT", ["ind_portador_defic"]),
    ("tipo_deficiencia", "TINYINT", ["tipo_defic", "tipo_deficiencia"]),
    ("nacionalidade", "SMALLINT", ["nacionalidade"]),
    ("ano_chegada_brasil", "SMALLINT", ["ano_chegada_brasil"]),
    ("horas_contratadas", "SMALLINT", ["qtd_hora_contr"]),
    ("tempo_emprego", "DECIMAL(7,1)", ["tempo_emprego"]),
    ("rem_dezembro_nom", "DECIMAL(14,2)", ["vl_remun_dezembro_nom", "vl_rem_dezembro_nom"]),
    ("rem_dezembro_sm", "DECIMAL(10,2)", ["vl_remun_dezembro_sm", "vl_rem_dezembro_sm"]),
    ("rem_media_nom", "DECIMAL(14,2)", ["vl_remun_media_nom", "vl_rem_media_nom"]),
    ("rem_media_sm", "DECIMAL(10,2)", ["vl_remun_media_sm", "vl_rem_media_sm"]),
    *[(f"rem_{m}", "DECIMAL(14,2)", [f"vl_rem_{m}_cc", f"vl_rem_{m}_sc"])  # mês a mês, desde 2015
      for m in ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro"]],
    ("salario_contratual", "DECIMAL(14,2)", ["vl_salario_contratual"]),  # só 2018
    ("tipo_salario", "TINYINT", ["tipo_salario"]),  # só 2018
    ("ind_intermitente", "TINYINT", ["ind_trab_intermitente", "ind_trabalho_intermitente"]),
    ("ind_parcial", "TINYINT", ["ind_trab_parcial", "ind_trabalho_parcial"]),
    ("ind_vinculo_abandonado", "TINYINT", ["ind_vinculo_abandonado"]),  # desde 2023
    ("categoria_trabalhador", "SMALLINT", ["categoria_trabalhador"]),  # desde 2023
    ("faixa_etaria", "TINYINT", ["faixa_etaria"]),
    ("faixa_hora_contratada", "TINYINT", ["faixa_hora_contrat"]),
    ("faixa_rem_dezembro_sm", "TINYINT", ["faixa_remun_dezem_sm", "faixa_rem_dez_sm"]),
    ("faixa_rem_media_sm", "TINYINT", ["faixa_remun_media_sm", "faixa_rem_media_sm"]),
    ("faixa_tempo_emprego", "TINYINT", ["faixa_tempo_emprego"]),
    ("natureza_juridica", "SMALLINT", ["natureza_juridica"]),
    ("tamanho_estab", "TINYINT", ["tamanho_estabelecimento"]),
    ("tipo_estab", "TINYINT", ["tipo_estab", "tipo_estabelecimento"]),  # a 2ª coluna "Tipo Estab" é o nome
    ("ind_cei_vinculado", "TINYINT", ["ind_cei_vinculado"]),
    ("ind_simples", "TINYINT", ["ind_simples", "ind_estabelecimento_participante_simples"]),
    ("ibge_subsetor", "SMALLINT", ["ibge_subsetor"]),
    ("cnae95_classe", "CNAE5", ["cnae_95_classe"]),
    ("bairros_sp", "INTEGER", ["bairros_sp"]),
    ("bairros_fortaleza", "INTEGER", ["bairros_fortaleza"]),
    ("bairros_rj", "INTEGER", ["bairros_rj"]),
    ("distritos_sp", "INTEGER", ["distritos_sp"]),
    ("regiao_adm_df", "INTEGER", ["regioes_adm_df", "regiao_adm_df"]),
]

ESTAB = [
    ("municipio", "INTEGER", ["municipio"]),
    ("cnae_classe", "CNAE5", ["cnae_2_0_classe"]),
    ("cnae_subclasse", "CNAE7", ["cnae_2_0_subclasse"]),
    ("qtd_vinculos_ativos", "INTEGER", ["qtd_vinculos_ativos"]),
    ("qtd_vinculos_clt", "INTEGER", ["qtd_vinculos_clt"]),
    ("qtd_vinculos_estatutarios", "INTEGER", ["qtd_vinculos_estatutarios"]),
    ("ind_atividade_ano", "TINYINT", ["ind_atividade_ano"]),
    ("ind_rais_negativa", "TINYINT", ["ind_rais_negativa"]),
    ("ind_pat", "TINYINT", ["ind_estab_participa_pat", "ind_estab_participante_pat"]),
    ("ind_simples", "TINYINT", ["ind_simples", "ind_estab_participante_simples"]),
    ("ind_cei_vinculado", "TINYINT", ["ind_cei_vinculado"]),
    ("natureza_juridica", "SMALLINT", ["natureza_juridica"]),
    ("tamanho_estab", "TINYINT", ["tamanho_estabelecimento"]),
    ("tipo_estab", "TINYINT", ["tipo_estab", "tipo_estabelecimento"]),
    ("ibge_subsetor", "SMALLINT", ["ibge_subsetor"]),
    ("cnae95_classe", "CNAE5", ["cnae_95_classe"]),
    ("cep", "INTEGER", ["cep_estab"]),
    ("bairros_sp", "INTEGER", ["bairros_sp"]),
    ("bairros_fortaleza", "INTEGER", ["bairros_fortaleza"]),
    ("bairros_rj", "INTEGER", ["bairros_rj"]),
    ("distritos_sp", "INTEGER", ["distritos_sp"]),
    ("regiao_adm_df", "INTEGER", ["regioes_adm_df", "regiao_adm_df"]),
]

CAGED = [
    ("competencia_mov", "INTEGER", ["competenciamov"]),
    ("regiao", "TINYINT", ["regiao"]),
    ("uf", "TINYINT", ["uf"]),
    ("municipio", "INTEGER", ["municipio"]),
    ("secao", "TEXTO", ["secao"]),
    ("cnae_subclasse", "CNAE7", ["subclasse"]),
    ("saldo_movimentacao", "TINYINT", ["saldomovimentacao"]),
    ("tipo_movimentacao", "SMALLINT", ["tipomovimentacao"]),
    ("cbo", "CBO", ["cbo2002ocupacao"]),
    ("categoria", "SMALLINT", ["categoria"]),
    ("grau_instrucao", "TINYINT", ["graudeinstrucao"]),
    ("idade", "SMALLINT", ["idade"]),
    ("horas_contratuais", "DECIMAL(6,2)", ["horascontratuais"]),
    ("raca_cor", "TINYINT", ["racacor"]),
    ("sexo", "TINYINT", ["sexo"]),
    ("tipo_empregador", "TINYINT", ["tipoempregador"]),
    ("tipo_estab", "TINYINT", ["tipoestabelecimento"]),
    ("tipo_deficiencia", "TINYINT", ["tipodedeficiencia"]),
    ("ind_intermitente", "TINYINT", ["indtrabintermitente"]),
    ("ind_parcial", "TINYINT", ["indtrabparcial"]),
    ("salario", "DECIMAL(14,2)", ["salario"]),
    ("tam_estab_jan", "TINYINT", ["tamestabjan"]),
    ("ind_aprendiz", "TINYINT", ["indicadoraprendiz"]),
    ("origem_informacao", "TINYINT", ["origemdainformacao"]),
    ("competencia_dec", "INTEGER", ["competenciadec"]),
    ("competencia_exc", "INTEGER", ["competenciaexc"]),  # só EXC
    ("ind_exclusao", "TINYINT", ["indicadordeexclusao"]),  # só EXC
    ("ind_fora_prazo", "TINYINT", ["indicadordeforadoprazo"]),
    ("unidade_salario", "TINYINT", ["unidadesalariocodigo"]),
    ("valor_salario_fixo", "DECIMAL(14,2)", ["valorsalariofixo"]),
]


def expressao(cols: dict, tipo: str, aliases: list[str]) -> str:
    """Expressão SQL que converte a coluna de texto ao tipo padronizado (NULL se a coluna não existe no ano)."""
    origem = next((cols[a] for a in aliases if a in cols), None)
    alvo = {"CNAE5": "VARCHAR", "CNAE7": "VARCHAR", "CBO": "VARCHAR", "TEXTO": "VARCHAR"}.get(tipo, tipo)
    if origem is None:
        return f"NULL::{alvo}"
    x = f'trim("{origem}")'
    if tipo == "TEXTO":
        return f"nullif({x}, '')"
    if tipo in ("CNAE5", "CNAE7", "CBO"):
        # só dígitos; '{ñ class}', '-1' e vazios viram NULL. Em alguns anos a coluna de classe traz a
        # subclasse (7 dígitos): a classe são os 5 primeiros
        tamanho = {"CNAE5": 5, "CNAE7": 7, "CBO": 6}[tipo]
        if tipo == "CNAE5":
            return f"""CASE WHEN NOT regexp_full_match({x}, '[0-9]+') THEN NULL
                            WHEN length({x}) >= 6 THEN lpad({x}, 7, '0')[1:5] ELSE lpad({x}, 5, '0') END"""
        return f"CASE WHEN regexp_full_match({x}, '[0-9]+') THEN lpad({x}, {tamanho}, '0') END"
    if tipo.startswith("DECIMAL"):
        return f"TRY_CAST(replace({x}, ',', '.') AS {tipo})"
    return f"TRY_CAST({x} AS {tipo})"


def selecao(con, txt: Path, encoding: str, colunas) -> str:
    rel, cols = ler_csv(con, txt, encoding)
    campos = ",\n               ".join(f"{expressao(cols, t, a)} AS {n}" for n, t, a in colunas)
    return f"SELECT {campos}\n        FROM {rel}"


def montar_ano(con, partes: list[Path], destino: Path, ano: int, ordem: str):
    """Junta as partes (cada uma já dividida por UF) num arquivo por UF, ordenado para leituras por Range."""
    tmp = destino.with_name(destino.name + ".tmp")
    shutil.rmtree(tmp, ignore_errors=True)
    tmp.mkdir(parents=True)
    ufs = sorted({p.name.split("=")[1] for parte in partes for p in parte.glob("uf=*")}, key=int)
    for uf in ufs:
        arquivos = ", ".join(f"'{a.as_posix()}'" for parte in partes for a in (parte / f"uf={uf}").glob("*.parquet"))
        con.execute(f"""COPY (SELECT {ano}::SMALLINT AS ano, {uf}::TINYINT AS uf, *
                              FROM read_parquet([{arquivos}], hive_partitioning = false) ORDER BY {ordem})
                        TO '{(tmp / f"uf={uf}.parquet").as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)""")
    shutil.rmtree(destino, ignore_errors=True)
    tmp.rename(destino)


def partir_por_uf(con, sql: str, pasta: Path):
    con.execute(f"""COPY (SELECT coalesce(municipio // 10000, 0)::TINYINT AS uf, * FROM ({sql}))
                    TO '{pasta.as_posix()}' (FORMAT parquet, PARTITION_BY (uf), COMPRESSION zstd)""")


def processar_rais(con, brutos: Path, saida: Path, anos, refazer: bool, conferir: bool):
    for pasta_ano in sorted((brutos / "rais").glob("[0-9][0-9][0-9][0-9]")):
        ano = int(pasta_ano.name)
        if anos and ano not in anos:
            continue
        destino_v = saida / "rais_vinculos" / f"ano={ano}"
        destino_e = saida / "rais_estab" / f"ano={ano}"
        if destino_v.exists() and destino_e.exists() and not refazer:
            continue
        arquivos = sorted(pasta_ano.glob("*.7z"))
        if not completo(arquivos, f"/pdet/microdados/RAIS/{ano}/", conferir):
            print(f"RAIS {ano}: download incompleto, fica para depois", flush=True)
            continue
        estab = [a for a in arquivos if "ESTAB" in a.name.upper() or a.name.upper().startswith("ESTB")]
        # o arquivo _NI (UF não identificada) fica de fora, como no painel: os totais batem com os oficiais sem ele
        vinc = [a for a in arquivos if a not in estab and "_NI" not in a.name.upper()]
        with tempfile.TemporaryDirectory(dir=brutos) as tmp:
            partes = []
            for i, arq in enumerate(vinc):
                pasta = Path(tmp) / f"txt{i}"
                pasta.mkdir()
                txt = descompactar(arq, pasta)
                partes.append(Path(tmp) / f"v{i}")
                partir_por_uf(con, selecao(con, txt, "latin-1", VINCULOS), partes[-1])
                shutil.rmtree(pasta)
                print(f"  RAIS {ano} {arq.name}: lido", flush=True)
            montar_ano(con, partes, destino_v, ano, "municipio, cnae_subclasse, cbo")
            partes = []
            for i, arq in enumerate(estab):
                pasta = Path(tmp) / f"etxt{i}"
                pasta.mkdir()
                txt = descompactar(arq, pasta)
                partes.append(Path(tmp) / f"e{i}")
                partir_por_uf(con, selecao(con, txt, "latin-1", ESTAB), partes[-1])
                shutil.rmtree(pasta)
            montar_ano(con, partes, destino_e, ano, "municipio, cnae_subclasse")
        n, ativos = con.execute(f"SELECT count(*), count(*) FILTER (ativo_31_12 = 1) FROM '{destino_v.as_posix()}/*.parquet'").fetchone()
        tamanho = sum(p.stat().st_size for p in destino_v.glob("*.parquet")) / 1e9
        print(f"RAIS {ano}: {n:,.0f} vínculos ({ativos:,.0f} ativos em 31/12), {tamanho:.2f} GB", flush=True)


def processar_caged(con, brutos: Path, saida: Path, anos, refazer: bool, conferir: bool):
    for arq in sorted((brutos / "caged").glob("*/CAGED*.7z")):
        m = re.match(r"CAGED(MOV|FOR|EXC)(\d{6})", arq.name.upper())
        if not m:
            continue
        tipo, aaaamm = m.groups()
        if anos and int(aaaamm[:4]) not in anos:
            continue
        destino = saida / "caged" / f"arquivo={aaaamm}" / f"{tipo}.parquet"
        if destino.exists() and not refazer:
            continue
        if conferir and remotos(f"/pdet/microdados/NOVO CAGED/{aaaamm[:4]}/{aaaamm}/").get(arq.name) != arq.stat().st_size:
            continue  # ainda baixando
        destino.parent.mkdir(parents=True, exist_ok=True)
        tmp_saida = destino.with_suffix(".tmp")
        with tempfile.TemporaryDirectory(dir=brutos) as tmp:
            txt = descompactar(arq, Path(tmp))
            con.execute(f"""COPY (SELECT {aaaamm} AS arquivo, '{tipo}' AS tipo, *
                                  FROM ({selecao(con, txt, "utf-8", CAGED)})
                                  ORDER BY uf, municipio, cnae_subclasse, cbo)
                            TO '{tmp_saida.as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)""")
        tmp_saida.replace(destino)
        print(f"  CAGED {aaaamm} {tipo}: ok", flush=True)


# situação no ano e afastamento, iguais aos da consulta do site (web/src/dados.ts)
SITUACAO = "CASE WHEN ativo_31_12 = 1 THEN 1 WHEN motivo_desligamento > 0 THEN 2 ELSE 3 END"
AFASTADO = "coalesce(causa_afastamento_1 BETWEEN 10 AND 90, false)"
MEDIDAS = f"""count(*) AS vinculos, count(*) FILTER (escolaridade >= 9) AS superior,
    sum(dias_afastamento) FILTER ({AFASTADO}) AS dias_afastamento,
    sum(rem_dezembro_nom) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0)::DOUBLE AS rem_dez_soma,
    count(*) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0) AS rem_dez_n,
    sum(rem_media_nom) FILTER (rem_media_nom > 0)::DOUBLE AS rem_media_soma, count(*) FILTER (rem_media_nom > 0) AS rem_media_n,
    sum(horas_contratadas) FILTER (horas_contratadas > 0) AS horas_soma, count(*) FILTER (horas_contratadas > 0) AS horas_n,
    sum(idade) AS idade_soma, count(idade) AS idade_n"""


def gerar_cubos(con, saida: Path, gold: Path, anos, refazer: bool):
    """Tabelas pré-somadas da RAIS para o site na web (os microdados ficam só no computador):

    gold/trabalho/cubo_uf/ano=AAAA.parquet    UF × classe CNAE × CBO × sexo × situação × afastamento
    gold/trabalho/cubo_mun/ano=AAAA.parquet   município × divisão CNAE × grande grupo CBO × sexo × situação × afastamento

    Somas e contagens (médias = soma ÷ contagem em qualquer agrupamento); ordenadas por UF ou município,
    para a leitura por Range trazer só o trecho do recorte.
    """
    for pasta in sorted((saida / "rais_vinculos").glob("ano=[0-9][0-9][0-9][0-9]")):
        ano = int(pasta.name[4:])
        if anos and ano not in anos:
            continue
        cubos = {"cubo_uf": ("uf, cnae_classe, cbo, sexo, situacao, afastado", "uf, cnae_classe, cbo"),
                 "cubo_mun": ("municipio, cnae_classe[1:2] AS cnae_divisao, cbo[1:1] AS cbo_grande_grupo, sexo, situacao, afastado",
                              "municipio, cnae_divisao, cbo_grande_grupo")}
        for nome, (dims, ordem) in cubos.items():
            destino = gold / nome / f"ano={ano}.parquet"
            if destino.exists() and not refazer:
                continue
            destino.parent.mkdir(parents=True, exist_ok=True)
            tmp = destino.with_suffix(".tmp")
            con.execute(f"""COPY (SELECT {ano}::SMALLINT AS ano, {dims}, {MEDIDAS}
                                  FROM (SELECT *, ({SITUACAO})::TINYINT AS situacao, {AFASTADO} AS afastado
                                        FROM '{pasta.as_posix()}/*.parquet')
                                  GROUP BY ALL ORDER BY {ordem})
                            TO '{tmp.as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)""")
            tmp.replace(destino)
            print(f"  {nome} {ano}: {destino.stat().st_size / 1e6:.0f} MB", flush=True)
    escrever_indice(saida)
    from trabalho import atualizar_manifesto
    atualizar_manifesto(con)  # anos da consulta personalizada (fontes.rais_micro)


def escrever_indice(saida: Path):
    """indice.json ao lado dos microdados: {"rais_vinculos": {"2013": [11, 12, …]}}, para o navegador montar a
    tabela da IA sem listar a pasta (por HTTP não há listagem). Só anos completos (pastas sem .tmp)."""
    import json
    indice = {}
    for tabela in ("rais_vinculos", "rais_estab"):
        indice[tabela] = {p.name[4:]: sorted(int(a.stem[3:]) for a in p.glob("uf=*.parquet"))
                          for p in sorted((saida / tabela).glob("ano=[0-9][0-9][0-9][0-9]"))}
    (saida / "indice.json").write_text(json.dumps(indice), encoding="utf-8")


def anos_de(texto: str | None):
    if not texto:
        return None
    anos = set()
    for parte in texto.split(","):
        a, _, b = parte.partition("-")
        anos.update(range(int(a), int(b or a) + 1))
    return anos


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--brutos", default=os.environ.get("TRABALHO_BRUTOS", "E:/finbra/brutos"))
    p.add_argument("--saida", default=os.environ.get("TRABALHO_MICRO", "E:/finbra/micro"))
    p.add_argument("--so", choices=["rais", "caged", "cubos"])
    p.add_argument("--anos", help="ex.: 2023 ou 2013-2016,2020")
    p.add_argument("--refazer", action="store_true")
    p.add_argument("--sem-conferir", action="store_true", help="não confere os tamanhos no FTP")
    args = p.parse_args()
    brutos = Path(args.brutos)
    saida = Path(args.saida) / "silver" / "trabalho" / "micro"
    con = duckdb.connect()
    con.execute("SET memory_limit = '16GB'")
    con.execute("SET preserve_insertion_order = false")
    con.execute(f"SET temp_directory = '{(brutos / 'duckdb_tmp').as_posix()}'")
    anos = anos_de(args.anos)
    if args.so in (None, "rais"):
        processar_rais(con, brutos, saida, anos, args.refazer, not args.sem_conferir)
    if args.so in (None, "caged"):
        processar_caged(con, brutos, saida, anos, args.refazer, not args.sem_conferir)
    if args.so in (None, "rais", "cubos"):
        gerar_cubos(con, saida, GOLD / "trabalho", anos, args.refazer)


if __name__ == "__main__":
    main()
