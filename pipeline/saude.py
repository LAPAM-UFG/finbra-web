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

gold/saude/internacoes.parquet   ano × município de residência: internações do SIH/SUS (AIH reduzida, IDENT = 1: as AIH de
                               longa permanência, IDENT = 5, são continuação e não contam), por ano de competência
                               (2008–2025; 2026 fica de fora até fechar), com as que ocorreram em outro município,
                               valor pago (nominal e em reais de 2025 pelo IPCA), dias de permanência, óbitos
                               hospitalares, faixas etárias e capítulos da CID-10 do diagnóstico principal
gold/saude/internacoes_atend.parquet  ano × município do hospital: internações atendidas e as de residentes de outros
                               municípios (quem recebe pacientes)
                               Ambas entram em municipios.parquet (colunas int_*)

gold/saude/cnes.parquet        ano × município do estabelecimento: retrato de dezembro do CNES (2006–2025) com estabelecimentos
                               (total, com vínculo SUS, hospitais e unidades básicas), leitos (existentes, SUS e por tipo)
                               e profissionais (médicos, enfermeiros e dentistas, de 2007 em diante, cada pessoa uma só vez no
                               município do vínculo de maior carga horária; cnes_medicos_no_municipio conta quem atua em
                               cada município e superconta nos totais). Os arquivos de profissionais trazem nome e CPF: só as
                               contagens por município saem do HD; entra em municipios.parquet (colunas cnes_*)

gold/saude/sinan.parquet       ano × município de residência: agravos de notificação do SINAN (arquivos finais, ano do arquivo):
                               dengue (casos prováveis, confirmados, graves e óbitos), chikungunya (notificações e
                               confirmados), tuberculose (casos novos, até 2019 nestes arquivos), hanseníase (casos novos)
                               e violência interpessoal/autoprovocada (notificações); entra em municipios.parquet (sinan_*)

gold/saude/siscan.parquet      ano × município de residência: exames do SISCAN (controle do câncer do colo do útero e da mama,
                               2014–2025; 2013, primeiro ano do sistema, tem só 135 mil exames e fica de fora): citopatológicos do colo (total, mulheres de 25 a 64 anos, alterados), mamografias
                               (total e mulheres de 50 a 69 anos) e exames histopatológicos do colo e da mama; entra em
                               municipios.parquet (siscan_*). Só contagens; o arquivo por exame sai do HD externo
gold/saude/oncologia.parquet   ano de diagnóstico × município de residência: Painel de Oncologia (diagnósticos de câncer, CID-10 C,
                               2019–2025; antes o painel cobria bem menos casos) com os que iniciaram tratamento e os que iniciaram em
                               até 60 dias do diagnóstico; entra em municipios.parquet (onco_*)
gold/saude/resp.parquet        ano da notificação × município de residência: RESP (microcefalia e alterações do sistema nervoso
                               central, 2015–2024): notificações válidas, confirmadas e óbitos entre as confirmadas (resp_*)

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
               sum(pop) FILTER (WHERE sexo = '2' AND idade BETWEEN 10 AND 49) AS pop_mulheres_10_49,
               sum(pop) FILTER (WHERE sexo = '2' AND idade BETWEEN 25 AND 64) AS pop_mulheres_25_64,
               sum(pop) FILTER (WHERE sexo = '2' AND idade BETWEEN 50 AND 69) AS pop_mulheres_50_69
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


SIH_ANOS = (2008, 2025)
# idade em anos do SIH: COD_IDADE 2 = dias, 3 = meses, 4 = anos, 5 = 100 anos ou mais
SIH_IDADE = "CASE WHEN COD_IDADE IN ('0', '1', '2', '3') THEN 0 WHEN COD_IDADE = '4' THEN TRY_CAST(IDADE AS INTEGER) WHEN COD_IDADE = '5' THEN 100 + TRY_CAST(IDADE AS INTEGER) END"


def internacoes(con, micro: Path):
    """SIH/SUS: internações por município de residência (internacoes) e do hospital (internacoes_atend)."""
    rd = micro / "SIHSUS" / "200801_" / "Dados"
    c3 = "left(upper(DIAG_PRINC), 3)"
    capitulos = ",\n".join(f"count(*) FILTER (WHERE {c3} BETWEEN '{a}' AND '{b}') AS int_cap{n:02d}" for n, a, b in CAPITULOS)
    ipca = (GOLD / "ipca.parquet").as_posix()
    de, ate = SIH_ANOS
    con.execute(f"""
        CREATE OR REPLACE TABLE sih AS
        SELECT TRY_CAST(ANO_CMPT AS INTEGER) AS ano, TRY_CAST(MUNIC_RES AS INTEGER) AS residencia, TRY_CAST(MUNIC_MOV AS INTEGER) AS hospital,
               TRY_CAST(VAL_TOT AS DOUBLE) AS valor, TRY_CAST(DIAS_PERM AS INTEGER) AS dias, MORTE, DIAG_PRINC,
               {SIH_IDADE} AS idade_anos
        FROM read_parquet('{rd}/RD*.parquet')
        WHERE IDENT = '1' AND TRY_CAST(ANO_CMPT AS INTEGER) BETWEEN {de} AND {ate}""")
    con.execute(f"""
        CREATE OR REPLACE TABLE internacoes AS
        SELECT s.ano, s.residencia AS municipio, s.residencia // 10000 AS uf,
               count(*) AS int_total,
               count(*) FILTER (WHERE s.hospital <> s.residencia) AS int_fora,
               sum(s.valor) AS int_valor,
               sum(s.valor) * any_value(i.fator_real) AS int_valor_real,
               sum(s.dias) AS int_dias,
               count(*) FILTER (WHERE s.MORTE = '1') AS int_obitos,
               count(*) FILTER (WHERE s.idade_anos < 5) AS int_menores_5,
               count(*) FILTER (WHERE s.idade_anos >= 60) AS int_60_mais,
               {capitulos.replace('DIAG_PRINC', 's.DIAG_PRINC')}
        FROM sih s LEFT JOIN '{ipca}' i ON i.exercicio = s.ano
        WHERE s.residencia IS NOT NULL GROUP BY s.ano, s.residencia ORDER BY 1, 2""")
    con.execute(f"COPY internacoes TO '{GOLD_S / 'internacoes.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    con.execute(f"""
        CREATE OR REPLACE TABLE internacoes_atend AS
        SELECT s.ano, s.hospital AS municipio, s.hospital // 10000 AS uf,
               count(*) AS int_atendidas,
               count(*) FILTER (WHERE s.residencia <> s.hospital) AS int_atendidas_de_fora,
               sum(s.valor) * any_value(i.fator_real) AS int_atendidas_valor_real
        FROM sih s LEFT JOIN '{ipca}' i ON i.exercicio = s.ano
        WHERE s.hospital IS NOT NULL GROUP BY s.ano, s.hospital ORDER BY 1, 2""")
    con.execute(f"COPY internacoes_atend TO '{GOLD_S / 'internacoes_atend.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("internacoes:", con.sql("""SELECT ano, sum(int_total), round(sum(int_valor_real) / 1e9, 2), round(100.0 * sum(int_fora) / sum(int_total), 1),
        round(100.0 * sum(int_obitos) / sum(int_total), 2) FROM internacoes WHERE ano IN (2008, 2019, 2020, 2025) GROUP BY 1 ORDER BY 1""").fetchall())
    con.execute("DROP TABLE sih")


SIA_ANOS = (2008, 2025)  # 2026 fica de fora até fechar o ano
# grupos de procedimentos da tabela do SUS (2 primeiros dígitos de PA_PROC_ID)
GRUPOS_SIA = {1: "promocao", 2: "diagnostico", 3: "clinicos", 4: "cirurgicos", 5: "transplantes", 6: "medicamentos", 7: "orteses", 8: "complementares"}


def ambulatorial(con, sia: Path, saida: Path | None = None):
    """SIA/SUS: produção ambulatorial por município do estabelecimento (sia.py agrega os .dbc do grupo PA).

    ambulatorial: ano × município, com registros, quantidade e valor aprovados (nominal e em reais de 2025 pelo IPCA), a parte
    de pacientes de outros municípios e, por grupo de procedimento, quantidade e valor real; entra em municipios.parquet (amb_*).
    ambulatorial_subgrupo: ano × município × subgrupo (4 dígitos do procedimento), para o detalhe da IA.
    Valores aprovados seguem a tabela do SUS (não são o custo do serviço); a quantidade é de procedimentos, não de pessoas.
    Sem agregados em --sia, cria as tabelas vazias (o painel segue sem as colunas amb_*)."""
    saida = saida or GOLD_S
    ipca = (GOLD / "ipca.parquet").as_posix()
    de, ate = SIA_ANOS
    arquivos = list(sia.glob("*/*.parquet"))
    colunas_grupo = ",\n".join(
        f"sum(qtd_apr) FILTER (WHERE grupo = {g}) AS amb_{n}_qtd, sum(val_apr) FILTER (WHERE grupo = {g}) * any_value(i.fator_real) AS amb_{n}_valor_real"
        for g, n in GRUPOS_SIA.items())
    if not arquivos:
        con.execute("CREATE OR REPLACE TABLE ambulatorial (ano INTEGER, municipio INTEGER, uf INTEGER, amb_registros BIGINT)")
        con.execute("CREATE OR REPLACE TABLE ambulatorial_subgrupo (ano INTEGER, municipio INTEGER, subgrupo VARCHAR)")
        return
    con.execute(f"""
        CREATE OR REPLACE TABLE sia AS
        SELECT ano, municipio, proc, TRY_CAST(left(proc, 2) AS INTEGER) AS grupo, left(proc, 4) AS subgrupo,
               registros, qtd_apr, val_apr, qtd_apr_fora, val_apr_fora
        FROM read_parquet('{sia.as_posix()}/*/*.parquet') WHERE ano BETWEEN {de} AND {ate} AND municipio IS NOT NULL""")
    con.execute(f"""
        CREATE OR REPLACE TABLE ambulatorial AS
        SELECT s.ano, s.municipio, s.municipio // 10000 AS uf,
               sum(s.registros) AS amb_registros, sum(s.qtd_apr) AS amb_qtd,
               sum(s.val_apr) AS amb_valor, sum(s.val_apr) * any_value(i.fator_real) AS amb_valor_real,
               coalesce(sum(s.qtd_apr_fora), 0) AS amb_qtd_fora, coalesce(sum(s.val_apr_fora), 0) * any_value(i.fator_real) AS amb_valor_fora_real,
               {colunas_grupo.replace('grupo', 's.grupo').replace('qtd_apr)', 's.qtd_apr)').replace('val_apr)', 's.val_apr)')}
        FROM sia s LEFT JOIN '{ipca}' i ON i.exercicio = s.ano
        GROUP BY s.ano, s.municipio ORDER BY 1, 2""")
    con.execute(f"COPY ambulatorial TO '{saida / 'ambulatorial.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    con.execute(f"""
        CREATE OR REPLACE TABLE ambulatorial_subgrupo AS
        SELECT s.ano, s.municipio, s.subgrupo, sum(s.registros) AS registros, sum(s.qtd_apr) AS qtd, sum(s.val_apr) AS valor,
               sum(s.val_apr) * any_value(i.fator_real) AS valor_real
        FROM sia s LEFT JOIN '{ipca}' i ON i.exercicio = s.ano
        GROUP BY s.ano, s.municipio, s.subgrupo ORDER BY 1, 2, 3""")
    con.execute(f"COPY ambulatorial_subgrupo TO '{saida / 'ambulatorial_subgrupo.parquet'}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)")
    print("ambulatorial:", con.sql("""SELECT ano, sum(amb_qtd), round(sum(amb_valor_real) / 1e9, 2), count(DISTINCT municipio)
        FROM ambulatorial WHERE ano IN (2008, 2019, 2020, 2025) GROUP BY 1 ORDER BY 1""").fetchall())
    con.execute("DROP TABLE sia")


CNES_ANOS = (2006, 2025)


def cnes(con, micro: Path):
    """CNES, retrato de dezembro: estabelecimentos (ST), leitos (LT) e profissionais (PF) por município do estabelecimento."""
    base = micro / "CNES" / "200508_" / "Dados"
    de, ate = CNES_ANOS

    def ler(tipo, colunas):
        # o ano vem do nome do arquivo (AAMM; só dezembro foi convertido): STGO2412 -> 2024
        return f"""SELECT 2000 + TRY_CAST(regexp_extract(filename, '{tipo}[A-Z]{{2}}(\\d{{2}})12\\.parquet$', 1) AS INTEGER) AS ano,
                   TRY_CAST(left(CODUFMUN, 6) AS INTEGER) AS municipio, {colunas}
            FROM read_parquet('{base / tipo}/{tipo}*12.parquet', filename = true, union_by_name = true)"""

    # estabelecimentos: TP_UNID pela tabela oficial do CNES (01 posto, 02 centro de saúde/UBS, 05 hospital geral, 07 hospital
    # especializado); VINC_SUS = 1: atende pelo SUS
    st = ler("ST", "CNES, TP_UNID, VINC_SUS")
    lt = ler("LT", "TP_LEITO, TRY_CAST(QT_EXIST AS INTEGER) AS exist, TRY_CAST(QT_SUS AS INTEGER) AS sus, TRY_CAST(QT_NSUS AS INTEGER) AS nsus")
    pf = ler("PF", "CBO, CNS_PROF, PROF_SUS, HORAOUTR, HORAHOSP, HORA_AMB")
    con.execute(f"""
        CREATE OR REPLACE TABLE cnes AS
        WITH est AS (
            SELECT ano, municipio, count(DISTINCT CNES) AS cnes_estab,
                   count(DISTINCT CNES) FILTER (WHERE VINC_SUS = '1') AS cnes_estab_sus,
                   count(DISTINCT CNES) FILTER (WHERE TP_UNID IN ('05', '07')) AS cnes_hospitais,
                   count(DISTINCT CNES) FILTER (WHERE TP_UNID IN ('01', '02')) AS cnes_ubs
            FROM ({st}) GROUP BY ano, municipio),
        lei AS (
            SELECT ano, municipio, sum(exist) AS cnes_leitos, sum(sus) AS cnes_leitos_sus, sum(nsus) AS cnes_leitos_nao_sus,
                   sum(exist) FILTER (WHERE TP_LEITO = '1') AS cnes_leitos_cirurgicos, sum(exist) FILTER (WHERE TP_LEITO = '2') AS cnes_leitos_clinicos,
                   sum(exist) FILTER (WHERE TP_LEITO = '3') AS cnes_leitos_complementares, sum(exist) FILTER (WHERE TP_LEITO = '4') AS cnes_leitos_obstetricos,
                   sum(exist) FILTER (WHERE TP_LEITO = '5') AS cnes_leitos_pediatricos, sum(exist) FILTER (WHERE TP_LEITO = '6') AS cnes_leitos_outras,
                   sum(exist) FILTER (WHERE TP_LEITO = '7') AS cnes_leitos_hospital_dia
            FROM ({lt}) GROUP BY ano, municipio),
        -- profissionais: médicos (CBO 225 e 2231), enfermeiros (2235) e dentistas (2232). Só de 2007 em diante: em 2006 o campo
        -- CBO ainda não segue a CBO 2002 (nenhum médico é reconhecido). Uma linha de PF é um vínculo com um estabelecimento.
        vin AS (
            SELECT ano, municipio, CNS_PROF, PROF_SUS,
                   coalesce(TRY_CAST(HORAOUTR AS INTEGER), 0) + coalesce(TRY_CAST(HORAHOSP AS INTEGER), 0) + coalesce(TRY_CAST(HORA_AMB AS INTEGER), 0) AS horas,
                   CASE WHEN CBO LIKE '225%' OR CBO LIKE '2231%' THEN 'm' WHEN CBO LIKE '2235%' THEN 'e' WHEN CBO LIKE '2232%' THEN 'd' END AS grupo
            FROM ({pf}) WHERE ano >= 2007),
        -- pessoa × município (CNS): a mesma pessoa pode atuar em mais de um município
        pessoa AS (
            SELECT ano, municipio, grupo, CNS_PROF, sum(horas) AS horas, max(PROF_SUS) AS sus
            FROM vin WHERE grupo IS NOT NULL AND CNS_PROF IS NOT NULL GROUP BY ALL),
        -- cada pessoa uma só vez no ano: no município do vínculo de maior carga horária (empate: menor código). Assim as somas
        -- por UF e Brasil são pessoas distintas, sem contar duas vezes quem atua em mais de um município
        princ AS (
            SELECT * EXCLUDE (n) FROM (
                SELECT *, row_number() OVER (PARTITION BY ano, grupo, CNS_PROF ORDER BY horas DESC, municipio) AS n FROM pessoa) WHERE n = 1),
        pro AS (
            SELECT ano, municipio,
                   count(*) FILTER (WHERE grupo = 'm') AS cnes_medicos,
                   count(*) FILTER (WHERE grupo = 'm' AND sus = '1') AS cnes_medicos_sus,
                   count(*) FILTER (WHERE grupo = 'e') AS cnes_enfermeiros,
                   count(*) FILTER (WHERE grupo = 'd') AS cnes_dentistas
            FROM princ GROUP BY ano, municipio),
        -- a contagem "por município" (quem atua nele, onde quer que more ou tenha o vínculo principal) e os vínculos
        pro_mun AS (SELECT ano, municipio, count(*) FILTER (WHERE grupo = 'm') AS cnes_medicos_no_municipio FROM pessoa GROUP BY ano, municipio),
        vinc AS (SELECT ano, municipio, count(*) FILTER (WHERE grupo = 'm') AS cnes_medicos_vinculos FROM vin GROUP BY ano, municipio),
        chaves AS (SELECT ano, municipio FROM est UNION SELECT ano, municipio FROM lei UNION SELECT ano, municipio FROM pro
                   UNION SELECT ano, municipio FROM pro_mun UNION SELECT ano, municipio FROM vinc)
        SELECT k.ano, k.municipio, k.municipio // 10000 AS uf,
               e.* EXCLUDE (ano, municipio), l.* EXCLUDE (ano, municipio), p.* EXCLUDE (ano, municipio),
               m.* EXCLUDE (ano, municipio), v.* EXCLUDE (ano, municipio)
        FROM chaves k LEFT JOIN est e USING (ano, municipio) LEFT JOIN lei l USING (ano, municipio) LEFT JOIN pro p USING (ano, municipio)
             LEFT JOIN pro_mun m USING (ano, municipio) LEFT JOIN vinc v USING (ano, municipio)
        WHERE k.ano BETWEEN {de} AND {ate} AND k.municipio IS NOT NULL ORDER BY 1, 2""")
    con.execute(f"COPY cnes TO '{GOLD_S / 'cnes.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("cnes:", con.sql("""SELECT ano, sum(cnes_estab), sum(cnes_leitos), sum(cnes_leitos_sus), sum(cnes_medicos), sum(cnes_enfermeiros)
        FROM cnes WHERE ano IN (2006, 2015, 2019, 2025) GROUP BY 1 ORDER BY 1""").fetchall())


# agravos do SINAN (arquivos finais DATASUS, um por agravo e ano): coluna e regra de cada medida
SINAN_AGRAVOS = {
    "DENG": ("dengue", 2000), "CHIK": ("chikungunya", 2014), "TUBE": ("tuberculose", 2001), "HANS": ("hanseníase", 2001), "VIOL": ("violência", 2009),
}
# dengue: os arquivos públicos já trazem só os casos não descartados (casos prováveis). Confirmados: dengue clássica, com complicações,
# FHD e SCD (1 a 4, anos antigos) e dengue, com sinais de alarme e grave (10 a 12). Graves: FHD, SCD e dengue grave (3, 4, 12).
# Óbito: EVOLUCAO = 2 (óbito pelo agravo) entre os confirmados. Chikungunya: 13 = confirmado (os arquivos trazem também os descartados).
# Tuberculose: TRATAMENTO = 1 (caso novo, sem recidiva, reingresso, transferência nem pós-óbito). Hanseníase: MODOENTR = 1 (caso novo).
SINAN_CONF_DENGUE = "('1', '2', '3', '4', '10', '11', '12')"


def sinan(con, micro: Path):
    """SINAN: agravos selecionados por município de residência (ID_MN_RESI) e ano do arquivo."""
    base = micro / "SINAN" / "DADOS" / "FINAIS"

    def ler(cod, extra=""):
        return f"""SELECT 2000 + TRY_CAST(regexp_extract(filename, '{cod}BR(\\d{{2}})\\.parquet$', 1) AS INTEGER) AS ano,
                   TRY_CAST(left(ID_MN_RESI, 6) AS INTEGER) AS municipio {extra}
            FROM read_parquet('{base}/{cod}BR*.parquet', filename = true, union_by_name = true)"""

    conf = SINAN_CONF_DENGUE
    con.execute(f"""
        CREATE OR REPLACE TABLE sinan AS
        WITH deng AS (
            SELECT ano, municipio, count(*) AS sinan_dengue_provaveis,
                   count(*) FILTER (WHERE CLASSI_FIN IN {conf}) AS sinan_dengue_confirmados,
                   count(*) FILTER (WHERE CLASSI_FIN IN ('3', '4', '12')) AS sinan_dengue_graves,
                   count(*) FILTER (WHERE CLASSI_FIN IN {conf} AND EVOLUCAO = '2') AS sinan_dengue_obitos
            FROM ({ler('DENG', ', CLASSI_FIN, EVOLUCAO')}) GROUP BY ano, municipio),
        chik AS (
            SELECT ano, municipio, count(*) AS sinan_chik_notificacoes, count(*) FILTER (WHERE CLASSI_FIN = '13') AS sinan_chik_confirmados
            FROM ({ler('CHIK', ', CLASSI_FIN')}) GROUP BY ano, municipio),
        tube AS (
            SELECT ano, municipio, count(*) FILTER (WHERE TRATAMENTO = '1') AS sinan_tb_casos_novos
            FROM ({ler('TUBE', ', TRATAMENTO')}) GROUP BY ano, municipio),
        hans AS (
            SELECT ano, municipio, count(*) FILTER (WHERE MODOENTR = '1') AS sinan_hans_casos_novos
            FROM ({ler('HANS', ', MODOENTR')}) GROUP BY ano, municipio),
        viol AS (
            SELECT ano, municipio, count(*) AS sinan_viol_notificacoes FROM ({ler('VIOL')}) GROUP BY ano, municipio),
        chaves AS (SELECT ano, municipio FROM deng UNION SELECT ano, municipio FROM chik UNION SELECT ano, municipio FROM tube
                   UNION SELECT ano, municipio FROM hans UNION SELECT ano, municipio FROM viol),
        j AS (
            SELECT k.ano, k.municipio, k.municipio // 10000 AS uf, d.* EXCLUDE (ano, municipio), c.* EXCLUDE (ano, municipio),
                   t.* EXCLUDE (ano, municipio), h.* EXCLUDE (ano, municipio), v.* EXCLUDE (ano, municipio)
            FROM chaves k LEFT JOIN deng d USING (ano, municipio) LEFT JOIN chik c USING (ano, municipio) LEFT JOIN tube t USING (ano, municipio)
                 LEFT JOIN hans h USING (ano, municipio) LEFT JOIN viol v USING (ano, municipio)
            WHERE k.municipio IS NOT NULL AND k.ano BETWEEN 2000 AND 2025)
        -- agravo ausente do ano (arquivo inexistente ou sem a coluna) fica nulo, nunca zero: sem nenhum registro no país, não há dado
        SELECT ano, municipio, uf,
               {', '.join(f"CASE WHEN sum({c}) OVER (PARTITION BY ano) > 0 THEN {c} END AS {c}" for c in SINAN_COLUNAS)}
        FROM j ORDER BY ano, municipio""")
    con.execute(f"COPY sinan TO '{GOLD_S / 'sinan.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("sinan:", con.sql("""SELECT ano, sum(sinan_dengue_provaveis), sum(sinan_dengue_confirmados), sum(sinan_dengue_obitos), sum(sinan_tb_casos_novos),
        sum(sinan_hans_casos_novos), sum(sinan_viol_notificacoes) FROM sinan WHERE ano IN (2009, 2015, 2019, 2023, 2024) GROUP BY 1 ORDER BY 1""").fetchall())


SINAN_COLUNAS = ["sinan_dengue_provaveis", "sinan_dengue_confirmados", "sinan_dengue_graves", "sinan_dengue_obitos",
                 "sinan_chik_notificacoes", "sinan_chik_confirmados", "sinan_tb_casos_novos", "sinan_hans_casos_novos", "sinan_viol_notificacoes"]


SISCAN_COLUNAS = ["siscan_cito", "siscan_cito_25_64", "siscan_cito_alterados", "siscan_mamografias", "siscan_mamo_50_69",
                   "siscan_histo_colo", "siscan_histo_mama"]


def siscan(con, brutos: Path):
    """SISCAN (CSV por exame, residência do paciente): um arquivo por tipo de exame e ano. Os *_PACNT repetem os mesmos exames
    por paciente e ficam de fora. O ano é o do arquivo, conferido com a coluna de ano do próprio exame."""
    base = brutos / "SISCAN" / "SISCAN"
    def ler(arq):
        # o separador muda entre anos (2013 usa vírgula, os demais ponto e vírgula)
        with open(base / arq, encoding="utf-8") as f:
            sep = ";" if ";" in f.readline() else ","
        return f"read_csv('{(base / arq).as_posix()}', delim = '{sep}', header = true, all_varchar = true)"

    partes = []
    for ano in range(2014, 2026):
        cito, mamo = base / f"SISCAN_CITO_COLO_{ano}.csv", base / f"SISCAN_MAMOGRAFIA_{ano}.csv"
        hc, hm = base / f"SISCAN_HISTO_COLO_{ano}.csv", base / f"SISCAN_HISTO_MAMA_{ano}.csv"
        if not (cito.exists() and mamo.exists() and hc.exists() and hm.exists()):
            continue
        idade = lambda col: f"TRY_CAST({col} AS INTEGER)"
        t = con.execute(f"""
            WITH c AS (
                SELECT TRY_CAST(CO_MUN_RESIDENCIA AS INTEGER) AS municipio,
                       count(*) AS siscan_cito,
                       count(*) FILTER (WHERE SG_SEXO = 'F' AND {idade('CO_IDADE_PACIENTE')} BETWEEN 25 AND 64) AS siscan_cito_25_64,
                       count(*) FILTER (WHERE NU_EXAME_ALTERADO = '1') AS siscan_cito_alterados,
                       count(*) FILTER (WHERE CO_ANO_LIBERACAO != '{ano}') AS fora_ano_c
                FROM {ler(cito.name)} GROUP BY 1),
            m AS (
                SELECT TRY_CAST(CO_MUN_RESIDENCIA AS INTEGER) AS municipio,
                       count(*) AS siscan_mamografias,
                       count(*) FILTER (WHERE SG_SEXO = 'F' AND {idade('CO_IDADE_PACIENTE')} BETWEEN 50 AND 69) AS siscan_mamo_50_69,
                       count(*) FILTER (WHERE NU_ANO_COMPETENCIA != '{ano}') AS fora_ano_m
                FROM {ler(mamo.name)} GROUP BY 1),
            hc AS (SELECT TRY_CAST(CO_MUN_RESIDENCIA AS INTEGER) AS municipio, count(*) AS siscan_histo_colo FROM {ler(hc.name)} GROUP BY 1),
            hm AS (SELECT TRY_CAST(CO_MUN_RESIDENCIA AS INTEGER) AS municipio, count(*) AS siscan_histo_mama FROM {ler(hm.name)} GROUP BY 1),
            chaves AS (SELECT municipio FROM c UNION SELECT municipio FROM m UNION SELECT municipio FROM hc UNION SELECT municipio FROM hm)
            SELECT {ano} AS ano, k.municipio, k.municipio // 10000 AS uf, c.* EXCLUDE (municipio), m.* EXCLUDE (municipio),
                   hc.siscan_histo_colo, hm.siscan_histo_mama
            FROM chaves k LEFT JOIN c USING (municipio) LEFT JOIN m USING (municipio) LEFT JOIN hc USING (municipio) LEFT JOIN hm USING (municipio)
            WHERE k.municipio IS NOT NULL""").to_arrow_table()
        fora = (sum(x or 0 for x in t["fora_ano_c"].to_pylist()), sum(x or 0 for x in t["fora_ano_m"].to_pylist()))
        print(f"siscan {ano}: {t.num_rows} municípios; exames com ano diferente do arquivo (colo, mama): {fora}", flush=True)
        partes.append(t.drop(["fora_ano_c", "fora_ano_m"]))
    con.register("siscan_bruto", pa.concat_tables(partes, promote_options="default"))
    con.execute(f"""
        CREATE OR REPLACE TABLE siscan AS
        SELECT ano, municipio, uf, {', '.join(SISCAN_COLUNAS)} FROM siscan_bruto ORDER BY ano, municipio""")
    con.execute(f"COPY siscan TO '{GOLD_S / 'siscan.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("siscan:", con.sql("""SELECT ano, sum(siscan_cito), sum(siscan_cito_25_64), sum(siscan_mamografias), sum(siscan_mamo_50_69),
        sum(siscan_histo_colo), sum(siscan_histo_mama) FROM siscan GROUP BY 1 ORDER BY 1""").fetchall())


ONCO_COLUNAS = ["onco_casos", "onco_tratados", "onco_trat_validos", "onco_trat_60d"]


def oncologia(con, micro: Path):
    """Painel de Oncologia (POBR): um registro por diagnóstico de câncer (CID-10 C na causa do diagnóstico). Até 2017 o painel
    trazia pouco mais de 180 mil casos por ano e de 2018 em diante passou a incluir os diagnósticos sem tratamento registrado
    (460 mil em 2019): a série só é comparável a partir de 2019. O tempo até o tratamento sai das datas (diagnóstico e primeiro
    tratamento); datas de tratamento anteriores ao diagnóstico não entram no tempo. 2026 está incompleto e fica de fora."""
    base = micro / "painel_oncologia" / "Dados"
    con.execute(f"""
        CREATE OR REPLACE TABLE oncologia AS
        WITH c AS (
            SELECT TRY_CAST(ANO_DIAGN AS INTEGER) AS ano, TRY_CAST(MUN_RESID AS INTEGER) AS municipio,
                   TRY_STRPTIME(DT_DIAG, '%d/%m/%Y') AS dt_diag, TRY_STRPTIME(DT_TRAT, '%d/%m/%Y') AS dt_trat
            FROM read_parquet('{base}/POBR*.parquet', union_by_name = true)
            WHERE DIAG_DETH LIKE 'C%')
        SELECT ano, municipio, municipio // 10000 AS uf,
               count(*) AS onco_casos,
               count(*) FILTER (WHERE dt_trat IS NOT NULL) AS onco_tratados,
               count(*) FILTER (WHERE dt_trat >= dt_diag) AS onco_trat_validos,
               count(*) FILTER (WHERE date_diff('day', dt_diag, dt_trat) BETWEEN 0 AND 60) AS onco_trat_60d
        FROM c WHERE ano BETWEEN 2019 AND 2025 AND municipio IS NOT NULL GROUP BY ano, municipio ORDER BY ano, municipio""")
    con.execute(f"COPY oncologia TO '{GOLD_S / 'oncologia.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("oncologia:", con.sql("""SELECT ano, sum(onco_casos), sum(onco_tratados), sum(onco_trat_validos), sum(onco_trat_60d)
        FROM oncologia GROUP BY 1 ORDER BY 1""").fetchall())


RESP_COLUNAS = ["resp_notificacoes", "resp_confirmadas", "resp_obitos"]


def resp(con, micro: Path):
    """RESP (microcefalia e alterações do SNC): os RESPBR{aa} são o Brasil inteiro por ano de notificação (os de cada UF repetem os
    mesmos registros). Excluídas (CLASSIFIN = 6, as mesmas com STATUS_NOT = 3, inativas) não contam como notificação."""
    base = micro / "RESP" / "DADOS"
    con.execute(f"""
        CREATE OR REPLACE TABLE resp AS
        SELECT TRY_CAST(ANO_NOT AS INTEGER) AS ano, TRY_CAST(CODMUNRES AS INTEGER) AS municipio, TRY_CAST(CODMUNRES AS INTEGER) // 10000 AS uf,
               count(*) AS resp_notificacoes,
               count(*) FILTER (WHERE CLASSIFIN = '1') AS resp_confirmadas,
               count(*) FILTER (WHERE CLASSIFIN = '1' AND ST_OBITO = '1') AS resp_obitos
        FROM read_parquet('{base}/RESPBR[0-9][0-9].parquet', union_by_name = true)
        WHERE coalesce(CLASSIFIN, '') != '6' AND TRY_CAST(CODMUNRES AS INTEGER) IS NOT NULL
        GROUP BY 1, 2 ORDER BY 1, 2""")
    con.execute(f"COPY resp TO '{GOLD_S / 'resp.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("resp:", con.sql("SELECT ano, sum(resp_notificacoes), sum(resp_confirmadas), sum(resp_obitos) FROM resp GROUP BY 1 ORDER BY 1").fetchall())


def atencao_primaria(con, brutos: Path, saida: Path | None = None):
    """Atenção primária (relatórios públicos da APS, baixados por aps.py): cobertura por município.

    aps_cobertura: mês × município (serie ab, jan/2008 a dez/2020, metodologia antiga; aps, jan/2021 em diante; acs, agentes
    comunitários, jan/2008 em diante). As séries ab e aps NÃO são comparáveis: a portaria mudou a população coberta e a
    capacidade das equipes. atencao_primaria: ano × município com o valor de dezembro de cada série (colunas ab_*, aps_*,
    acs_*), que entra em municipios.parquet. A cobertura da série aps não é limitada a 100% (equipes acima da população).
    Sem os arquivos de aps.py, cria as tabelas vazias."""
    saida = saida or GOLD_S
    base = brutos / "aps"
    num = lambda c: f"TRY_CAST(replace({c}, ',', '') AS DOUBLE)"
    leitura = lambda serie, cols: (
        f"read_json('{base.as_posix()}/{serie}/*.json', format='array', records=true, maximum_object_size=67108864, "
        f"columns={{{', '.join(f'{c}: ' + chr(39) + 'VARCHAR' + chr(39) for c in cols)}}})")
    if not any((base / x).is_dir() for x in ("ab", "aps", "acs")):
        con.execute("CREATE OR REPLACE TABLE aps_cobertura (serie VARCHAR, ano INTEGER, mes INTEGER, municipio INTEGER)")
        con.execute("CREATE OR REPLACE TABLE atencao_primaria (ano INTEGER, municipio INTEGER)")
        return
    # nuComp vem como AAAAMM (ab, acs) ou MM/AAAA (aps)
    ano = "TRY_CAST(CASE WHEN nuComp LIKE '%/%' THEN right(nuComp, 4) ELSE left(nuComp, 4) END AS INTEGER)"
    mes = "TRY_CAST(CASE WHEN nuComp LIKE '%/%' THEN left(nuComp, 2) ELSE right(nuComp, 2) END AS INTEGER)"
    partes = []
    if (base / "ab").is_dir():
        partes.append(f"""SELECT 'ab' AS serie, {ano} AS ano, {mes} AS mes, TRY_CAST(coMunicipioIbge AS INTEGER) AS municipio,
               {num('pcCoberturaAb')} AS cobertura, {num('pcCoberturaSf')} AS cobertura_sf, {num('qtEsf')} AS equipes_esf,
               NULL::DOUBLE AS equipes_eap, {num('qtPopulacao')} AS populacao, NULL::DOUBLE AS capacidade, NULL::DOUBLE AS agentes
               FROM {leitura('ab', ['nuComp', 'coMunicipioIbge', 'pcCoberturaAb', 'pcCoberturaSf', 'qtEsf', 'qtPopulacao'])}""")
    if (base / "aps").is_dir():
        partes.append(f"""SELECT 'aps', {ano}, {mes}, TRY_CAST(coMunicipioIbge AS INTEGER),
               {num('qtCobertura')}, NULL::DOUBLE, {num('qtEsf')}, coalesce({num('qtEap30')}, 0) + coalesce({num('qtEap20')}, 0),
               {num('qtPopulacao')}, {num('qtCapacidadeEquipe')}, NULL::DOUBLE
               FROM {leitura('aps', ['nuComp', 'coMunicipioIbge', 'qtCobertura', 'qtEsf', 'qtEap30', 'qtEap20', 'qtPopulacao', 'qtCapacidadeEquipe'])}""")
    if (base / "acs").is_dir():
        partes.append(f"""SELECT 'acs', {ano}, {mes}, TRY_CAST(coMunicipioIbge AS INTEGER),
               {num('pcCoberturaAcsAb')}, NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE, {num('qtPopulacao')}, NULL::DOUBLE, {num('qtAcsAtivoAb')}
               FROM {leitura('acs', ['nuComp', 'coMunicipioIbge', 'pcCoberturaAcsAb', 'qtPopulacao', 'qtAcsAtivoAb'])}""")
    con.execute("CREATE OR REPLACE TABLE aps_cobertura AS SELECT * FROM (" + " UNION ALL ".join(partes) +
                ") WHERE municipio IS NOT NULL AND ano IS NOT NULL ORDER BY serie, ano, mes, municipio")
    con.execute(f"COPY aps_cobertura TO '{saida / 'aps_cobertura.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    # valor de dezembro de cada ano (a cobertura de um ano é a do fim dele, como o CNES)
    con.execute("""
        CREATE OR REPLACE TABLE atencao_primaria AS
        SELECT ano, municipio,
               max(cobertura) FILTER (WHERE serie = 'ab') AS ab_cobertura, max(cobertura_sf) FILTER (WHERE serie = 'ab') AS ab_cobertura_sf,
               max(equipes_esf) FILTER (WHERE serie = 'ab') AS ab_equipes_esf, max(populacao) FILTER (WHERE serie = 'ab') AS ab_populacao,
               max(cobertura) FILTER (WHERE serie = 'aps') AS aps_cobertura, max(equipes_esf) FILTER (WHERE serie = 'aps') AS aps_equipes_esf,
               max(equipes_eap) FILTER (WHERE serie = 'aps') AS aps_equipes_eap, max(capacidade) FILTER (WHERE serie = 'aps') AS aps_capacidade,
               max(populacao) FILTER (WHERE serie = 'aps') AS aps_populacao,
               max(cobertura) FILTER (WHERE serie = 'acs') AS acs_cobertura, max(agentes) FILTER (WHERE serie = 'acs') AS acs_agentes,
               max(populacao) FILTER (WHERE serie = 'acs') AS acs_populacao
        FROM aps_cobertura WHERE mes = 12 GROUP BY ano, municipio ORDER BY ano, municipio""")
    print("atencao_primaria:", con.sql("""SELECT ano, count(*), round(avg(ab_cobertura), 1), round(avg(aps_cobertura), 1), round(avg(acs_cobertura), 1)
        FROM atencao_primaria WHERE ano IN (2008, 2015, 2020, 2021, 2025) GROUP BY 1 ORDER BY 1""").fetchall())


def municipios(con):
    """Uma linha por ano e município de residência com população, óbitos, óbitos fetais e nascimentos."""
    s = SILVER.as_posix()
    con.execute(f"""
        CREATE OR REPLACE TABLE municipios AS
        WITH muni AS (SELECT cod_ibge, cod_ibge // 10 AS municipio, nome, uf FROM '{s}/entes.parquet' WHERE esfera = 'M'),
             estados AS (SELECT cod_ibge AS cod, uf FROM '{s}/entes.parquet' WHERE esfera IN ('E', 'D')),
             pop AS (SELECT * EXCLUDE (cod_ibge, uf) FROM populacao),
             chaves AS (SELECT ano, municipio FROM pop UNION SELECT ano, municipio FROM obitos
                        UNION SELECT ano, municipio FROM nascimentos UNION SELECT ano, municipio FROM obitos_fetais
                        UNION SELECT ano, municipio FROM internacoes UNION SELECT ano, municipio FROM internacoes_atend
                        UNION SELECT ano, municipio FROM cnes UNION SELECT ano, municipio FROM sinan
                        UNION SELECT ano, municipio FROM siscan UNION SELECT ano, municipio FROM oncologia UNION SELECT ano, municipio FROM resp
                        UNION SELECT ano, municipio FROM ambulatorial UNION SELECT ano, municipio FROM atencao_primaria)
        SELECT k.ano, m.cod_ibge, k.municipio, coalesce(m.nome, 'Município ignorado') AS nome,
               coalesce(m.uf, e.uf) AS uf,
               p.* EXCLUDE (ano, municipio),
               o.* EXCLUDE (ano, municipio, uf),
               f.obitos_fetais,
               n.* EXCLUDE (ano, municipio, uf),
               h.* EXCLUDE (ano, municipio, uf),
               a.* EXCLUDE (ano, municipio, uf),
               c.* EXCLUDE (ano, municipio, uf),
               z.* EXCLUDE (ano, municipio, uf),
               sc.* EXCLUDE (ano, municipio, uf),
               oc.* EXCLUDE (ano, municipio, uf),
               rp.* EXCLUDE (ano, municipio, uf),
               am.* EXCLUDE (ano, municipio, uf),
               ap.* EXCLUDE (ano, municipio)
        FROM chaves k
        LEFT JOIN muni m ON m.municipio = k.municipio
        LEFT JOIN estados e ON e.cod = k.municipio // 10000
        LEFT JOIN pop p ON p.ano = k.ano AND p.municipio = k.municipio
        LEFT JOIN obitos o ON o.ano = k.ano AND o.municipio = k.municipio
        LEFT JOIN obitos_fetais f ON f.ano = k.ano AND f.municipio = k.municipio
        LEFT JOIN nascimentos n ON n.ano = k.ano AND n.municipio = k.municipio
        LEFT JOIN internacoes h ON h.ano = k.ano AND h.municipio = k.municipio
        LEFT JOIN internacoes_atend a ON a.ano = k.ano AND a.municipio = k.municipio
        LEFT JOIN cnes c ON c.ano = k.ano AND c.municipio = k.municipio
        LEFT JOIN sinan z ON z.ano = k.ano AND z.municipio = k.municipio
        LEFT JOIN siscan sc ON sc.ano = k.ano AND sc.municipio = k.municipio
        LEFT JOIN oncologia oc ON oc.ano = k.ano AND oc.municipio = k.municipio
        LEFT JOIN resp rp ON rp.ano = k.ano AND rp.municipio = k.municipio
        LEFT JOIN ambulatorial am ON am.ano = k.ano AND am.municipio = k.municipio
        LEFT JOIN atencao_primaria ap ON ap.ano = k.ano AND ap.municipio = k.municipio
        WHERE k.municipio IS NOT NULL
        ORDER BY k.ano, k.municipio""")
    con.execute(f"COPY municipios TO '{GOLD_S / 'municipios.parquet'}' (FORMAT parquet, COMPRESSION zstd)")
    print("municipios:", con.sql("""SELECT count(*), count(*) FILTER (WHERE cod_ibge IS NULL), count(*) FILTER (WHERE uf IS NULL),
        sum(obitos) FILTER (WHERE uf IS NULL) FROM municipios""").fetchall()[0])


def fonte_saude(con) -> dict:
    """Anos do SIM, do SINASC, do SIH e da população no gold/saude; vazio se ainda não processados."""
    arq = GOLD / "saude" / "municipios.parquet"
    if not arq.exists():
        return {}
    a = arq.as_posix()
    anos = lambda col: [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{a}' WHERE {col} IS NOT NULL ORDER BY 1").fetchall()]
    quando = datetime.fromtimestamp(arq.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    colunas = {r[0] for r in con.execute(f"DESCRIBE SELECT * FROM '{a}'").fetchall()}
    sih = {"sih": {"anos": anos("int_total"), "processado_em": quando, "url": "https://datasus.saude.gov.br/transferencia-de-arquivos/"}} if "int_total" in colunas else {}
    cnes_f = {"cnes": {"anos": anos("cnes_estab"), "processado_em": quando, "url": "https://datasus.saude.gov.br/transferencia-de-arquivos/"}} if "cnes_estab" in colunas else {}
    sinan_f = {}
    if "sinan_dengue_provaveis" in colunas:
        # anos de cada agravo (as coberturas diferem: dengue 2000+, chikungunya 2014+, tuberculose até 2019, violência 2009+)
        agravos = {nome: anos(col) for nome, col in (("dengue", "sinan_dengue_provaveis"), ("chikungunya", "sinan_chik_notificacoes"), ("tuberculose", "sinan_tb_casos_novos"),
                                                     ("hanseniase", "sinan_hans_casos_novos"), ("violencia", "sinan_viol_notificacoes"))}
        sinan_f = {"sinan": {"anos": sorted({a for v in agravos.values() for a in v}), "agravos": {k: [v[0], v[-1]] for k, v in agravos.items() if v},
                             "processado_em": quando, "url": "https://datasus.saude.gov.br/transferencia-de-arquivos/"}}
    # SISCAN, oncologia e RESP: os anos são os das linhas com a coluna preenchida (fora da cobertura, NULL, nunca zero)
    outros = {}
    for chave, col, url in (("siscan", "siscan_cito", "https://datasus.saude.gov.br/transferencia-de-arquivos/"),
                            ("oncologia", "onco_casos", "https://datasus.saude.gov.br/transferencia-de-arquivos/"),
                            ("resp", "resp_notificacoes", "https://datasus.saude.gov.br/transferencia-de-arquivos/")):
        if col in colunas:
            outros[chave] = {"anos": anos(col), "processado_em": quando, "url": url}
    sia_f = {"sia": {"anos": anos("amb_registros"), "processado_em": quando, "url": "https://datasus.saude.gov.br/transferencia-de-arquivos/"}} if "amb_registros" in colunas else {}
    aps_f = {}
    if "aps_cobertura" in colunas or "ab_cobertura" in colunas:
        series = {nome: anos(col) for nome, col in (("ab", "ab_cobertura"), ("aps", "aps_cobertura"), ("acs", "acs_cobertura")) if col in colunas}
        aps_f = {"aps": {"anos": sorted({a for v in series.values() for a in v}), "series": {k: [v[0], v[-1]] for k, v in series.items() if v},
                         "processado_em": quando, "url": "https://relatorioaps.saude.gov.br/"}}
    return {
        **sih,
        **sia_f,
        **aps_f,
        **cnes_f,
        **sinan_f,
        **outros,
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
    internacoes(con, Path(a.micro))
    cnes(con, Path(a.micro))
    sinan(con, Path(a.micro))
    siscan(con, Path(a.brutos))
    oncologia(con, Path(a.micro))
    resp(con, Path(a.micro))
    ambulatorial(con, Path(os.environ.get("SAUDE_SIA", Path(a.micro).parent / "sia")))
    atencao_primaria(con, Path(a.brutos))
    municipios(con)
    atualizar_manifesto(con)
    # conferência: mortalidade infantil do Brasil (por mil nascidos vivos)
    print("mortalidade infantil (‰):", con.sql("""SELECT o.ano, round(1000 * sum(o.infantis) / any_value(n.n), 2)
        FROM obitos o JOIN (SELECT ano, sum(nascidos) AS n FROM nascimentos GROUP BY 1) n USING (ano)
        WHERE o.ano IN (2010, 2019, 2023) GROUP BY 1 ORDER BY 1""").fetchall())


if __name__ == "__main__":
    main()
