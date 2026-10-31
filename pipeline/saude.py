"""Saúde: tabelas do painel de saúde (gold/saude) a partir dos microdados do DATASUS em Parquet (saude_micro.py).

Lê --micro (padrão: SAUDE_MICRO ou E:/finbra/micro/saude/dbc), com os .dbc convertidos um para um, e a população
dos zips do IBGE/SVS em --brutos (padrão: SAUDE_BRUTOS ou E:/finbra/brutos/saude). Município é o de residência,
com 6 dígitos (o SIM e o SINASC usam 7 até 2005); o código de 7 dígitos vem da população.

gold/saude/populacao.parquet   ano × município: população residente (estimativas da SVS/MS, 2000 em diante) e
                               as faixas usadas nas taxas (menores de 1 ano, 0–4, mulheres de 10–49, 30–69, 60+)
gold/saude/obitos.parquet      ano × município: óbitos não fetais do SIM (arquivos DORES de cada UF; o DOBR,
                               que repete o Brasil inteiro, fica de fora) por sexo, idade (infantis, neonatais,
                               pós-neonatais, menores de 5), grupos de causa (CID-10, causa básica) e capítulos
gold/saude/obitos_fetais.parquet  ano × município: óbitos fetais (DOFET)
gold/saude/municipios.parquet  as quatro acima juntas, com nome e UF do município (a tabela que o site lê);
                               códigos fora do cadastro (município ignorado) ficam com a UF do prefixo e
                               entram só nos totais da UF e do Brasil
gold/saude/nascimentos.parquet ano × município da mãe: nascidos vivos do SINASC (1996_/Dados/DNRES de cada UF;
                               DNBR repete o Brasil e DNEX são mães residentes no exterior) com peso, duração da
                               gestação, tipo de parto, consultas de pré-natal e idade da mãe; cada indicador leva
                               o número de registros com a informação preenchida, que é o denominador da proporção

Uso:
    py pipeline/saude.py
"""
import argparse
import json
import os
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa

from config import GOLD, SILVER

GOLD_S = GOLD / "saude"

# idade do SIM: 1º dígito é a unidade (0 minutos, 1 horas, 2 dias, 3 meses, 4 anos, 5 = 100 + anos, 9 ignorada)
UNIDADE = "TRY_CAST(left(IDADE, 1) AS INTEGER)"
VALOR = "TRY_CAST(substr(IDADE, 2) AS INTEGER)"
ANOS = f"CASE WHEN {UNIDADE} IN (0, 1, 2, 3) THEN 0 WHEN {UNIDADE} = 4 THEN {VALOR} WHEN {UNIDADE} = 5 THEN 100 + {VALOR} END"
DIAS = f"CASE WHEN {UNIDADE} IN (0, 1) THEN 0 WHEN {UNIDADE} = 2 THEN {VALOR} END"  # só abaixo de 1 mês
# causa básica sem ponto (ex.: I219); comparações pelos 3 primeiros caracteres
C3 = "left(upper(CAUSABAS), 3)"
CAPITULOS = [  # (número, primeira, última) da CID-10
    (1, "A00", "B99"), (2, "C00", "D48"), (3, "D50", "D89"), (4, "E00", "E90"), (5, "F00", "F99"), (6, "G00", "G99"),
    (7, "H00", "H59"), (8, "H60", "H95"), (9, "I00", "I99"), (10, "J00", "J99"), (11, "K00", "K93"), (12, "L00", "L99"),
    (13, "M00", "M99"), (14, "N00", "N99"), (15, "O00", "O99"), (16, "P00", "P96"), (17, "Q00", "Q99"),
    (18, "R00", "R99"), (19, "S00", "T98"), (20, "V01", "Y98"), (21, "Z00", "Z99"), (22, "U00", "U99"),
]
entre = lambda a, b: f"{C3} BETWEEN '{a}' AND '{b}'"
GRUPOS = {
    # morte materna: O00–O95 e O98–O99 (sem O96–O97, tardias e sequelas), A34 e, na gestação, os demais da
    # definição do Ministério ficam para a investigação; aqui, a contagem direta pela causa básica
    "maternos": f"({entre('O00', 'O95')} OR {entre('O98', 'O99')} OR {C3} = 'A34')",
    "externas": entre("V01", "Y98"),
    "transito": entre("V01", "V89"),
    "homicidios": f"({entre('X85', 'Y09')} OR {entre('Y35', 'Y36')})",
    "suicidios": entre("X60", "X84"),
    "mal_definidas": entre("R00", "R99"),
    "covid": f"(upper(CAUSABAS) IN ('B342', 'U071', 'U072') AND ano >= 2020)",
    "circulatorio": entre("I00", "I99"),
    "neoplasias": entre("C00", "D48"),
    "respiratorio": entre("J00", "J99"),
    # doenças crônicas não transmissíveis entre 30 e 69 anos (indicador do Plano de DCNT e ODS 3.4)
    "dcnt_30_69": f"(({entre('I00', 'I99')} OR {entre('C00', 'C97')} OR {entre('J30', 'J98')} OR {entre('E10', 'E14')}) AND idade_anos BETWEEN 30 AND 69)",
}


def conectar() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order = false")
    return con


def populacao(con, brutos: Path):
    """Estimativas da SVS/MS (IBGE/POPSVS/POPSBRAA.zip): município (7 dígitos) × sexo × idade simples (0–80+)."""
    # importado aqui: o gold.py lê fonte_saude deste módulo sem precisar do pyreaddbc
    from saude_micro import ler_dbf

    partes = []
    with tempfile.TemporaryDirectory() as tmp:
        for z in sorted((brutos / "IBGE" / "POPSVS").glob("*.zip")):
            with zipfile.ZipFile(z) as arq:
                for nome in arq.namelist():
                    if nome.lower().endswith(".dbf"):
                        arq.extract(nome, tmp)
                        t = ler_dbf(Path(tmp) / nome)
                        # os nomes das colunas vêm em minúsculas em alguns anos (2025)
                        partes.append(t.rename_columns([c.upper() for c in t.column_names]))
    con.register("pop_bruta", pa.concat_tables(partes, promote_options="default"))
    con.execute(f"""
        CREATE OR REPLACE TABLE populacao AS
        WITH p AS (SELECT TRY_CAST(ANO AS INTEGER) AS ano, TRY_CAST(COD_MUN AS INTEGER) AS cod_ibge, SEXO AS sexo,
                          TRY_CAST(IDADE AS INTEGER) AS idade, TRY_CAST(POP AS BIGINT) AS pop FROM pop_bruta)
        SELECT ano, cod_ibge, cod_ibge // 10 AS municipio, cod_ibge // 100000 AS uf,
               sum(pop) AS populacao,
               sum(pop) FILTER (WHERE sexo = '1') AS pop_homens,
               sum(pop) FILTER (WHERE sexo = '2') AS pop_mulheres,
               sum(pop) FILTER (WHERE idade = 0) AS pop_menor_1,
               sum(pop) FILTER (WHERE idade <= 4) AS pop_0_4,
               sum(pop) FILTER (WHERE idade BETWEEN 30 AND 69) AS pop_30_69,
               sum(pop) FILTER (WHERE idade >= 60) AS pop_60_mais,
               sum(pop) FILTER (WHERE sexo = '2' AND idade BETWEEN 10 AND 49) AS pop_mulheres_10_49
        FROM p GROUP BY ALL ORDER BY ano, cod_ibge""")
    con.execute(f"COPY populacao TO '{GOLD_S / 'populacao.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("populacao:", con.sql("SELECT min(ano), max(ano), count(*), sum(populacao) FILTER (WHERE ano = 2024) FROM populacao").fetchall()[0])


def obitos(con, micro: Path):
    sim = micro / "SIM" / "CID10"
    capitulos = ",\n".join(f"count(*) FILTER (WHERE {C3} BETWEEN '{a}' AND '{b}') AS cap{n:02d}" for n, a, b in CAPITULOS)
    grupos = ",\n".join(f"count(*) FILTER (WHERE {cond}) AS {nome}" for nome, cond in GRUPOS.items())
    con.execute(f"""
        CREATE OR REPLACE TABLE obitos AS
        WITH d AS (
            SELECT TRY_CAST(regexp_extract(filename, 'DO[A-Z]{{2}}(\\d{{4}})\\.parquet$', 1) AS INTEGER) AS ano,
                   TRY_CAST(left(CODMUNRES, 6) AS INTEGER) AS municipio, SEXO, IDADE, CAUSABAS
            FROM read_parquet('{sim / 'DORES'}/DO*.parquet', filename = true, union_by_name = true)
            WHERE NOT regexp_matches(filename, 'DOBR\\d{{4}}\\.parquet$')),
        e AS (SELECT *, {ANOS} AS idade_anos, {DIAS} AS idade_dias, {UNIDADE} AS unidade FROM d)
        SELECT ano, municipio, municipio // 10000 AS uf,
               count(*) AS obitos,
               count(*) FILTER (WHERE SEXO IN ('1', 'M')) AS obitos_homens,
               count(*) FILTER (WHERE SEXO IN ('2', 'F')) AS obitos_mulheres,
               count(*) FILTER (WHERE unidade IN (0, 1, 2, 3)) AS infantis,
               count(*) FILTER (WHERE idade_dias < 28 OR unidade IN (0, 1)) AS neonatais,
               count(*) FILTER (WHERE idade_dias < 7 OR unidade IN (0, 1)) AS neonatais_precoces,
               count(*) FILTER (WHERE (unidade = 2 AND idade_dias >= 28) OR unidade = 3) AS pos_neonatais,
               count(*) FILTER (WHERE idade_anos < 5) AS menores_5,
               count(*) FILTER (WHERE idade_anos >= 60) AS idosos_60_mais,
               count(*) FILTER (WHERE idade_anos IS NULL) AS idade_ignorada,
               {grupos},
               {capitulos}
        FROM e WHERE ano IS NOT NULL GROUP BY ALL ORDER BY ano, municipio""")
    con.execute(f"COPY obitos TO '{GOLD_S / 'obitos.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("obitos:", con.sql("SELECT ano, sum(obitos), sum(infantis), sum(maternos) FROM obitos WHERE ano IN (2019, 2021, 2024) GROUP BY 1 ORDER BY 1").fetchall())

    # óbitos fetais: um arquivo nacional por ano (DOFETAA)
    con.execute(f"""
        CREATE OR REPLACE TABLE obitos_fetais AS
        SELECT (CASE WHEN a < 50 THEN 2000 + a ELSE 1900 + a END) AS ano, municipio, municipio // 10000 AS uf, count(*) AS obitos_fetais
        FROM (SELECT TRY_CAST(regexp_extract(filename, 'DOFET(\\d{{2}})\\.parquet$', 1) AS INTEGER) AS a,
                     TRY_CAST(left(CODMUNRES, 6) AS INTEGER) AS municipio
              FROM read_parquet('{sim / 'DOFET'}/DOFET*.parquet', filename = true, union_by_name = true))
        WHERE a IS NOT NULL GROUP BY ALL ORDER BY ano, municipio""")
    con.execute(f"COPY obitos_fetais TO '{GOLD_S / 'obitos_fetais.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("obitos_fetais:", con.sql("SELECT min(ano), max(ano), sum(obitos_fetais) FILTER (WHERE ano = 2019) FROM obitos_fetais").fetchall()[0])


def nascimentos(con, micro: Path):
    sinasc = micro / "SINASC" / "1996_" / "Dados" / "DNRES"
    con.execute(f"""
        CREATE OR REPLACE TABLE nascimentos AS
        WITH n AS (
            SELECT TRY_CAST(regexp_extract(filename, 'DN[A-Z]{{2}}(\\d{{4}})\\.parquet$', 1) AS INTEGER) AS ano,
                   TRY_CAST(left(CODMUNRES, 6) AS INTEGER) AS municipio,
                   TRY_CAST(PESO AS INTEGER) AS peso, GESTACAO AS gestacao, PARTO AS parto, CONSULTAS AS consultas,
                   TRY_CAST(IDADEMAE AS INTEGER) AS idade_mae
            FROM read_parquet('{sinasc}/DN*.parquet', filename = true, union_by_name = true)
            WHERE NOT regexp_matches(filename, 'DN(BR|EX)\\d{{4}}\\.parquet$'))
        SELECT ano, municipio, municipio // 10000 AS uf,
               count(*) AS nascidos,
               count(*) FILTER (WHERE peso > 0 AND peso < 2500) AS baixo_peso,
               count(*) FILTER (WHERE peso > 0 AND peso < 9999) AS peso_informado,
               -- gestação em categorias (1: < 22 semanas … 4: 32–36; 5: 37–41; 6: 42 ou mais)
               count(*) FILTER (WHERE gestacao IN ('1', '2', '3', '4')) AS prematuros,
               count(*) FILTER (WHERE gestacao IN ('1', '2', '3', '4', '5', '6')) AS gestacao_informada,
               count(*) FILTER (WHERE parto = '2') AS cesareos,
               count(*) FILTER (WHERE parto IN ('1', '2')) AS parto_informado,
               -- consultas de pré-natal (1: nenhuma, 2: 1–3, 3: 4–6, 4: 7 ou mais)
               count(*) FILTER (WHERE consultas = '4') AS consultas_7_mais,
               count(*) FILTER (WHERE consultas = '1') AS sem_consulta,
               count(*) FILTER (WHERE consultas IN ('1', '2', '3', '4')) AS consultas_informadas,
               count(*) FILTER (WHERE idade_mae BETWEEN 10 AND 19) AS maes_10_19,
               count(*) FILTER (WHERE idade_mae BETWEEN 35 AND 60) AS maes_35_mais,
               count(*) FILTER (WHERE idade_mae BETWEEN 10 AND 60) AS idade_mae_informada
        FROM n WHERE ano IS NOT NULL GROUP BY ALL ORDER BY ano, municipio""")
    con.execute(f"COPY nascimentos TO '{GOLD_S / 'nascimentos.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("nascimentos:", con.sql("""SELECT ano, sum(nascidos), round(100 * sum(baixo_peso) / sum(peso_informado), 2),
        round(100 * sum(cesareos) / sum(parto_informado), 2) FROM nascimentos WHERE ano IN (2019, 2024) GROUP BY 1 ORDER BY 1""").fetchall())


def municipios(con):
    """Uma linha por ano e município de residência com população, óbitos, óbitos fetais e nascimentos."""
    s = SILVER.as_posix()
    con.execute(f"""
        CREATE OR REPLACE TABLE municipios AS
        WITH muni AS (SELECT cod_ibge, cod_ibge // 10 AS municipio, nome, uf FROM '{s}/entes.parquet' WHERE esfera = 'M'),
             estados AS (SELECT cod_ibge AS cod, uf FROM '{s}/entes.parquet' WHERE esfera IN ('E', 'D')),
             pop AS (SELECT * EXCLUDE (cod_ibge, uf) FROM populacao),
             chaves AS (SELECT ano, municipio FROM pop UNION SELECT ano, municipio FROM obitos
                        UNION SELECT ano, municipio FROM nascimentos UNION SELECT ano, municipio FROM obitos_fetais)
        SELECT k.ano, m.cod_ibge, k.municipio, coalesce(m.nome, 'Município ignorado') AS nome,
               coalesce(m.uf, e.uf) AS uf,
               p.* EXCLUDE (ano, municipio),
               o.* EXCLUDE (ano, municipio, uf),
               f.obitos_fetais,
               n.* EXCLUDE (ano, municipio, uf)
        FROM chaves k
        LEFT JOIN muni m ON m.municipio = k.municipio
        LEFT JOIN estados e ON e.cod = k.municipio // 10000
        LEFT JOIN pop p ON p.ano = k.ano AND p.municipio = k.municipio
        LEFT JOIN obitos o ON o.ano = k.ano AND o.municipio = k.municipio
        LEFT JOIN obitos_fetais f ON f.ano = k.ano AND f.municipio = k.municipio
        LEFT JOIN nascimentos n ON n.ano = k.ano AND n.municipio = k.municipio
        WHERE k.municipio IS NOT NULL
        ORDER BY k.ano, k.municipio""")
    con.execute(f"COPY municipios TO '{GOLD_S / 'municipios.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("municipios:", con.sql("""SELECT count(*), count(*) FILTER (WHERE cod_ibge IS NULL), count(*) FILTER (WHERE uf IS NULL),
        sum(obitos) FILTER (WHERE uf IS NULL) FROM municipios""").fetchall()[0])


def fonte_saude(con) -> dict:
    """Anos do SIM, do SINASC e da população no gold/saude; vazio se ainda não processados."""
    arq = GOLD / "saude" / "municipios.parquet"
    if not arq.exists():
        return {}
    a = arq.as_posix()
    anos = lambda col: [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{a}' WHERE {col} IS NOT NULL ORDER BY 1").fetchall()]
    quando = datetime.fromtimestamp(arq.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    return {
        "sim": {"anos": anos("obitos"), "processado_em": quando, "url": "https://datasus.saude.gov.br/transferencia-de-arquivos/"},
        "sinasc": {"anos": anos("nascidos"), "processado_em": quando, "url": "https://datasus.saude.gov.br/transferencia-de-arquivos/"},
        "populacao_svs": {"anos": anos("populacao"), "processado_em": quando,
                          "url": "ftp://ftp.datasus.gov.br/dissemin/publicos/IBGE/POPSVS/"},
    }


def atualizar_manifesto(con):
    caminho = GOLD / "manifesto.json"
    if not caminho.exists():
        return
    manifesto = json.loads(caminho.read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {}).update(fonte_saude(con))
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    caminho.write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--micro", default=os.environ.get("SAUDE_MICRO", "E:/finbra/micro/saude/dbc"))
    p.add_argument("--brutos", default=os.environ.get("SAUDE_BRUTOS", "E:/finbra/brutos/saude"))
    a = p.parse_args()
    GOLD_S.mkdir(parents=True, exist_ok=True)
    con = conectar()
    populacao(con, Path(a.brutos))
    obitos(con, Path(a.micro))
    nascimentos(con, Path(a.micro))
    municipios(con)
    atualizar_manifesto(con)
    # conferência: mortalidade infantil do Brasil (por mil nascidos vivos)
    print("mortalidade infantil (‰):", con.sql("""SELECT o.ano, round(1000 * sum(o.infantis) / any_value(n.n), 2)
        FROM obitos o JOIN (SELECT ano, sum(nascidos) AS n FROM nascimentos GROUP BY 1) n USING (ano)
        WHERE o.ano IN (2010, 2019, 2023) GROUP BY 1 ORDER BY 1""").fetchall())


if __name__ == "__main__":
    main()
