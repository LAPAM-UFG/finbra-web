"""Silver → gold: tabelas prontas para o site.

  indicadores.parquet  um registro por ente e exercício: receitas, FPM, impostos,
                       despesas, PIB, população, faixa populacional e dados de pesquisa
  ipca.parquet         índice acumulado do IPCA (para valores reais em qualquer base)
  faixas.parquet       faixas populacionais (as mesmas do Power BI)

As contas que mudaram de código entre os ementários (até 2017, 2018–2021, 2022+)
são achadas pela descrição; fica só o nó mais alto que casar, para não somar pai e
filho. As que não mudaram usam a chave.

Uso:
    py pipeline/gold.py
"""
import duckdb
import pandas as pd

from config import GOLD, SILVER

BRUTA = "Receitas Brutas Realizadas"

# Receitas por descrição (o código mudou entre ementários)
POR_DESCRICAO = {
    "fpm": r"Fundo de Participação dos Municípios",
    "icms": r"^Cota-Parte do (ICMS|Imposto sobre Operações Relativas à Circulação)",
    "ipva": r"^Cota-Parte do (IPVA|Imposto sobre a Propriedade de Veículos)",
    "iptu": r"^Imposto sobre a Propriedade Predial e Territorial Urbana",
    "iss": r"^Imposto sobre Serviços de Qualquer Natureza",
    "itbi": r"^Impostos? sobre (a )?Transmissão .{0,3}Inter Vivos",
}

# (anexo, coluna, chave) estáveis entre os anos
POR_CHAVE = {
    "receita_bruta": ("I-C", BRUTA, "TotalReceitas"),
    "receita_corrente": ("I-C", BRUTA, "RO1"),
    "receita_capital": ("I-C", BRUTA, "RO2"),
    "receita_impostos_taxas": ("I-C", BRUTA, "RO1.1"),
    "transferencias_correntes": ("I-C", BRUTA, "RO1.7"),
    "despesa_empenhada": ("I-D", "Despesas Empenhadas", "TotalDespesas"),
    "despesa_liquidada": ("I-D", "Despesas Liquidadas", "TotalDespesas"),
    "despesa_paga": ("I-D", "Despesas Pagas", "TotalDespesas"),
    "despesa_pessoal": ("I-D", "Despesas Empenhadas", "DO3.1"),
    "investimentos": ("I-D", "Despesas Empenhadas", "DO4.4"),
    "despesa_saude": ("I-E", "Despesas Empenhadas", "F10"),
    "despesa_educacao": ("I-E", "Despesas Empenhadas", "F12"),
    "ativo": ("I-AB", "Saldo em 31/12", "P1"),
    "patrimonio_liquido": ("I-AB", "Saldo em 31/12", "P2.3"),
}

# Faixas populacionais do Power BI (limite superior exclusivo)
FAIXAS = [5_000, 10_000, 20_000, 30_000, 50_000, 80_000, 100_000, 150_000, 200_000, 300_000,
          400_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000]


def tabela_faixas():
    linhas, inicio = [], 0
    for i, fim in enumerate(FAIXAS + [None], 1):
        rotulo = f"{inicio:,} a {fim - 1:,}".replace(",", ".") if fim else f"{inicio:,} ou mais".replace(",", ".")
        linhas.append((i, f"Grupo {i}", rotulo, inicio, fim))
        inicio = fim
    return pd.DataFrame(linhas, columns=["grupo", "nome", "faixa", "pop_min", "pop_max"])


LIMITE_ATIPICO = 5  # vezes acima ou abaixo da mediana do próprio ente


def gerar_alertas(con):
    """Ente-anos com declaração atípica, que os agregados (UF, Brasil, rankings) deixam de fora.

    A comparação é do ente com ele mesmo ao longo dos anos: assim municípios com receita
    per capita alta e estável (royalties, mineração) não são marcados, mas um valor
    digitado errado (ex.: São João de Meriti declarou R$ 366 bi em 2023) é. Também entra
    o ente que entregou a DCA sem receitas ou sem despesas no ano.
    """
    con.execute(f"""
        COPY (
            WITH i AS (
                SELECT exercicio, cod_ibge, nome, uf, esfera, 'receita_bruta' AS indicador, receita_bruta AS valor
                FROM '{GOLD.as_posix()}/indicadores.parquet'
                UNION ALL
                SELECT exercicio, cod_ibge, nome, uf, esfera, 'despesa_empenhada', despesa_empenhada
                FROM '{GOLD.as_posix()}/indicadores.parquet'),
            m AS (SELECT cod_ibge, indicador, median(valor) FILTER (valor > 0) AS mediana FROM i GROUP BY ALL)
            SELECT i.exercicio, i.cod_ibge, i.nome, i.uf, i.esfera, i.indicador, i.valor, m.mediana,
                   i.valor / m.mediana AS razao,
                   CASE WHEN coalesce(i.valor, 0) <= 0 THEN 'não declarado'
                        WHEN i.valor / m.mediana > {LIMITE_ATIPICO} THEN 'muito acima do habitual'
                        ELSE 'muito abaixo do habitual' END AS motivo
            FROM i JOIN m USING (cod_ibge, indicador)
            WHERE m.mediana IS NOT NULL
              AND (coalesce(i.valor, 0) <= 0
                   OR i.valor / m.mediana > {LIMITE_ATIPICO} OR i.valor / m.mediana < 1.0 / {LIMITE_ATIPICO})
            ORDER BY exercicio, cod_ibge, indicador
        ) TO '{GOLD.as_posix()}/alertas.parquet' (FORMAT parquet)
    """)
    n, entes = con.execute(f"SELECT count(*), count(DISTINCT (exercicio, cod_ibge)) "
                           f"FROM '{GOLD.as_posix()}/alertas.parquet'").fetchone()
    print(f"alertas: {n} registros em {entes} ente-anos (fora dos agregados)")


def main():
    GOLD.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    s = SILVER.as_posix()
    con.execute(f"CREATE VIEW dca AS SELECT * FROM '{s}/dca/*.parquet'")
    con.execute(f"CREATE VIEW contas AS SELECT * FROM '{s}/contas/*.parquet'")

    # Tabelas auxiliares nativas do DuckDB: registrar DataFrames do pandas (con.register)
    # trava o processo em consultas grandes e paralelas (erro de GIL no duckdb-python).
    faixas = tabela_faixas()
    con.execute("CREATE TABLE regras (indicador VARCHAR, regex VARCHAR)")
    con.executemany("INSERT INTO regras VALUES (?, ?)", list(POR_DESCRICAO.items()))
    con.execute("CREATE TABLE chaves (indicador VARCHAR, anexo VARCHAR, coluna VARCHAR, chave VARCHAR)")
    con.executemany("INSERT INTO chaves VALUES (?, ?, ?, ?)", [(k, *v) for k, v in POR_CHAVE.items()])
    con.execute("CREATE TABLE faixas (grupo INTEGER, nome VARCHAR, faixa VARCHAR, pop_min BIGINT, pop_max BIGINT)")
    con.executemany("INSERT INTO faixas VALUES (?, ?, ?, ?, ?)",
                    [tuple(None if pd.isna(v) else v for v in r) for r in faixas.itertuples(index=False)])

    con.execute(f"""
        CREATE TABLE longo AS
        WITH casadas AS (
            SELECT c.exercicio, c.chave, r.indicador
            FROM contas c JOIN regras r ON regexp_matches(c.descricao, r.regex, 'i')
            WHERE c.anexo = 'I-C' AND c.chave LIKE 'RO%'
        ),
        topo AS (  -- só o nó mais alto de cada indicador
            SELECT * FROM casadas a
            WHERE NOT EXISTS (SELECT 1 FROM casadas b
                              WHERE b.exercicio = a.exercicio AND b.indicador = a.indicador
                                AND starts_with(a.chave, b.chave || '.'))
        )
        SELECT d.exercicio, d.cod_ibge, t.indicador, sum(d.valor) AS valor
        FROM dca d JOIN topo t USING (exercicio, chave)
        WHERE d.anexo = 'I-C' AND d.coluna = '{BRUTA}'
        GROUP BY ALL
        UNION ALL
        SELECT d.exercicio, d.cod_ibge, k.indicador, sum(d.valor)
        FROM dca d JOIN chaves k USING (anexo, coluna, chave)
        GROUP BY ALL
        UNION ALL
        SELECT exercicio, cod_ibge, 'deducoes', sum(valor)
        FROM dca WHERE anexo = 'I-C' AND chave = 'TotalReceitas' AND coluna <> '{BRUTA}'
        GROUP BY ALL
    """)
    indicadores = list(POR_DESCRICAO) + list(POR_CHAVE) + ["deducoes"]
    colunas = ", ".join(f"sum(valor) FILTER (indicador = '{i}') AS {i}" for i in indicadores)
    con.execute(f"CREATE TABLE largo AS SELECT exercicio, cod_ibge, {colunas} FROM longo GROUP BY ALL")

    con.execute(f"""
        COPY (
            SELECT p.exercicio, p.cod_ibge, e.nome, e.uf, e.regiao, e.esfera, e.capital, p.populacao,
                   f.grupo AS faixa_grupo, i.* EXCLUDE (exercicio, cod_ibge),
                   i.receita_bruta - coalesce(i.deducoes, 0) AS receita_liquida,
                   g.pib, g.vab_agropecuaria, g.vab_industria, g.vab_servicos, g.vab_adm_publica,
                   q.* EXCLUDE (exercicio, cod_ibge6)
            FROM '{s}/populacao/*.parquet' p
            JOIN '{s}/entes.parquet' e USING (cod_ibge)
            LEFT JOIN largo i USING (exercicio, cod_ibge)
            LEFT JOIN faixas f ON e.esfera = 'M' AND p.populacao >= f.pop_min
                               AND (f.pop_max IS NULL OR p.populacao < f.pop_max)
            LEFT JOIN '{s}/ibge_pib.parquet' g USING (exercicio, cod_ibge)
            LEFT JOIN '{s}/pesquisa.parquet' q ON q.exercicio = p.exercicio AND q.cod_ibge6 = p.cod_ibge // 10
                                               AND e.esfera = 'M'
            ORDER BY p.exercicio, p.cod_ibge
        ) TO '{GOLD.as_posix()}/indicadores.parquet' (FORMAT parquet, COMPRESSION zstd)
    """)
    gerar_alertas(con)
    con.execute(f"COPY (SELECT * FROM '{s}/ipca.parquet') TO '{GOLD.as_posix()}/ipca.parquet' (FORMAT parquet)")
    faixas.to_parquet(GOLD / "faixas.parquet", index=False)

    n, anos = con.execute(f"SELECT count(*), list(DISTINCT exercicio ORDER BY exercicio) "
                          f"FROM '{GOLD.as_posix()}/indicadores.parquet'").fetchone()
    print(f"indicadores: {n:,} registros | exercícios {anos}")


if __name__ == "__main__":
    main()
