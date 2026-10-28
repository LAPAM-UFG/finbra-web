"""Resumo de saúde e educação para as páginas do painel: gold/saude_educacao.parquet.

Uma linha por ente e ano, com os indicadores mais usados do SIOPE (educação) e do SIOPS (saúde), lidos de
gold/siope/indicadores.parquet, gold/siope/gerais.parquet e gold/siops/indicadores.parquet. Pequeno (~2 MB),
é carregado inteiro no navegador, como o da LRF. As tabelas completas continuam em gold/siope e gold/siops.

Os códigos dos indicadores do SIOPE mudam de sentido entre anos (o 3.5 de 2021 não é o de 2020), por isso
cada coluna é achada pelo texto do indicador. O SIOPS só tem municípios.

Ficam de fora indicadores que a fonte deixou de calcular ou quase nunca preenche: pessoal e capital em % do
MDE (0 em quase todos os municípios desde 2021), alimentação escolar (0 em ~60% todo ano) e as subfunções
do SIOPS (só até 2015). Todos continuam nas tabelas completas.

Zero que é falha de cálculo vira vazio: nenhum ente tem 0% da despesa total em educação, e 0% no ensino
fundamental (25% dos municípios em 2020) vem junto com 0% nas demais etapas; nesses casos a composição
por etapa fica vazia.

Uso (siope.py e siops.py chamam no fim do gold):
    py pipeline/saude_educacao.py
"""
import duckdb

from config import GOLD

SAIDA = GOLD / "saude_educacao.parquet"

# coluna, padrão do texto do indicador (ILIKE)
SIOPE = [
    ("mde_pct", "Percentual de aplicação das receitas de impostos e transferências vinculadas à educação em MDE%"),
    ("fundeb_remuneracao_pct", "Percentual de aplicação %FUNDEB na remuneração dos profissionais%"),
    ("educacao_despesa_pct", "Percentual das despesas em educação em relação às despesas de todas as áreas"),
    ("infantil_pct", "Percentual das despesas com educação infantil em relação à despesa total com educação"),
    ("fundamental_pct", "Percentual das despesas com ensino fundamental em relação à despesa total com educação"),
    ("medio_pct", "Percentual das despesas com ensino médio em relação à despesa total com educação"),
    ("aluno_basica", "Investimento educacional por aluno da educação básica"),
    ("aluno_infantil", "Investimento educacional por aluno da educação infantil"),
    ("aluno_fundamental", "Investimento educacional por aluno do ensino fundamental"),
    ("professores_aluno", "Despesa com professores por aluno da educação básica"),
]

# coluna, código em gold/siops/indicadores.parquet
SIOPS = [
    ("saude_pct", "3.2"),
    ("saude_hab", "2.1"),
    ("saude_proprios_hab", "d_recursos_proprios_hab"),
    ("sus_hab", "r_transf_sus_hab"),
    ("saude_total", "d_total"),
    ("saude_proprios", "d_recursos_proprios"),
    ("sus_receita", "r_transf_sus"),
    ("saude_pessoal_pct", "2.2"),
    ("saude_medicamentos_pct", "2.3"),
    ("saude_terceiros_pct", "2.4"),
    ("saude_investimentos_pct", "2.5"),
    ("sus_despesa_pct", "3.1"),
    ("populacao_siops", "populacao"),
]


def gerar_resumo(con):
    ind_e, gerais, ind_s = GOLD / "siope" / "indicadores.parquet", GOLD / "siope" / "gerais.parquet", GOLD / "siops" / "indicadores.parquet"
    if not (ind_e.exists() and gerais.exists() and ind_s.exists()):
        return
    educacao = ",\n".join(f"max(valor) FILTER (WHERE indicador ILIKE '{p}') AS {c}" for c, p in SIOPE)
    saude = ",\n".join(f"max(valor) FILTER (WHERE codigo = '{k}') AS {c}" for c, k in SIOPS)
    con.execute(f"""COPY (
        WITH e AS (
            SELECT ano, cod_ibge, any_value(uf) AS uf, any_value(esfera) AS esfera, {educacao}
            FROM '{ind_e.as_posix()}' GROUP BY ano, cod_ibge),
        g AS (
            SELECT ano, cod_ibge, max(populacao) AS populacao_siope, max(educacao_liquidada) AS educacao_liquidada,
                   max(despesa_liquidada) AS despesa_liquidada
            FROM '{gerais.as_posix()}' GROUP BY ano, cod_ibge),
        s AS (
            SELECT ano, cod_ibge, any_value(uf) AS uf, {saude} FROM '{ind_s.as_posix()}' GROUP BY ano, cod_ibge)
        SELECT ano, cod_ibge, coalesce(e.uf, s.uf) AS uf, coalesce(e.esfera, 'M') AS esfera,
               e.* EXCLUDE (ano, cod_ibge, uf, esfera)
                   REPLACE (nullif(educacao_despesa_pct, 0) AS educacao_despesa_pct,
                            CASE WHEN fundamental_pct > 0 OR esfera <> 'M' THEN infantil_pct END AS infantil_pct,
                            CASE WHEN fundamental_pct > 0 OR esfera <> 'M' THEN fundamental_pct END AS fundamental_pct,
                            CASE WHEN fundamental_pct > 0 OR esfera <> 'M' THEN medio_pct END AS medio_pct),
               g.* EXCLUDE (ano, cod_ibge), s.* EXCLUDE (ano, cod_ibge, uf)
        FROM e LEFT JOIN g USING (ano, cod_ibge) FULL JOIN s USING (ano, cod_ibge)
        ORDER BY ano, cod_ibge) TO '{SAIDA.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
    n = con.execute(f"SELECT count(*), count(DISTINCT cod_ibge), min(ano), max(ano) FROM '{SAIDA.as_posix()}'").fetchone()
    print(f"gold/saude_educacao.parquet: {n[0]} linhas, {n[1]} entes, {n[2]}–{n[3]}")


if __name__ == "__main__":
    gerar_resumo(duckdb.connect())
