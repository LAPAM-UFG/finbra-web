"""Testes de consistência do pipeline. Sai com código 1 se algum falhar.

1. Árvore x total oficial: em cada ente/anexo/coluna, as raízes da árvore somam a
   linha de total que o próprio ente declarou (I-C: TotalReceitas; I-D e I-F:
   TotalDespesas; I-E e I-G: total exceto intra-orçamentárias).
2. Balanço (I-AB): Ativo = Passivo + Patrimônio Líquido.
3. Sinal das deduções (informativo): total de uma coluna de dedução declarado negativo.

Grava data/gold/validacao.csv (resumo por teste, exercício e anexo, que o site mostra na página
de qualidade) e data/gold/validacao_divergencias.csv (cada caso reprovado, para consulta).

Uso:
    py pipeline/validate.py
"""
import sys

import duckdb
import pandas as pd

from config import GOLD, SILVER

TOLERANCIA = 1.0  # R$
# Alguns entes declaram totais que não fecham com as próprias contas (ex.: reclassificação
# entre despesa normal e intra sem informar a conta-mãe; em 2013, formato QDCC com
# subfunções incompletas: ~0,4% no I-E). Abaixo desta fração por grupo, a divergência é
# tratada como da fonte: registrada para auditoria, sem falhar o pipeline. Erro de
# pipeline aparece muito acima disso (o bug de hierarquia do painel antigo dava 21%).
MAX_DIVERGENCIA_FONTE = 0.01


def arvore_casos(con):
    return con.execute("""
        WITH f AS (SELECT * FROM dca), c AS (SELECT * FROM contas),
        raiz AS (
            SELECT f.exercicio, f.cod_ibge, f.anexo, f.coluna, sum(f.valor) v
            FROM f JOIN c USING (exercicio, anexo, chave)
            WHERE c.chave_pai IS NULL AND f.tipo = 'conta' AND f.chave NOT LIKE 'DI%'
            GROUP BY ALL),
        tot AS (
            SELECT exercicio, cod_ibge, anexo, coluna, sum(valor) v FROM f
            WHERE (anexo = 'I-C' AND chave = 'TotalReceitas')
               OR (anexo IN ('I-D', 'I-F') AND chave = 'TotalDespesas')
               OR (anexo IN ('I-E', 'I-G') AND chave = 'TotalExcetoIntra')
            GROUP BY ALL)
        SELECT 'arvore x total' AS teste, exercicio, anexo, cod_ibge, coluna, raiz.v AS calculado, tot.v AS declarado
        FROM raiz JOIN tot USING (exercicio, cod_ibge, anexo, coluna)
        ORDER BY ALL
    """).df()


def balanco_casos(con):
    return con.execute("""
        SELECT 'ativo = passivo + PL' AS teste, exercicio, 'I-AB' AS anexo, cod_ibge, 'Saldo em 31/12' AS coluna,
               sum(valor) FILTER (chave = 'P1') AS calculado, sum(valor) FILTER (chave = 'P2') AS declarado
        FROM dca WHERE anexo = 'I-AB' AND coluna = 'Saldo em 31/12' GROUP BY ALL
        HAVING calculado IS NOT NULL AND declarado IS NOT NULL
    """).df()


def resumir(casos, tipo):
    casos = casos.assign(diferenca=lambda d: d.calculado - d.declarado)
    casos["ok"] = casos.diferenca.abs() <= TOLERANCIA
    resumo = (casos.groupby(["teste", "exercicio", "anexo"], as_index=False)
              .agg(casos=("ok", "size"), ok=("ok", "sum"),
                   maior_divergencia=("diferenca", lambda s: float(s.abs().max()))))
    resumo["tipo"] = tipo
    resumo["tolerancia"] = TOLERANCIA
    return resumo, casos[~casos.ok]


def sinal_deducoes(con):
    """Informativo: colunas de dedução com total negativo (o gold usa o valor absoluto)."""
    casos = con.execute("""
        SELECT 'sinal das deduções' AS teste, exercicio, anexo, cod_ibge, coluna, valor AS calculado, NULL::DOUBLE AS declarado
        FROM dca WHERE anexo = 'I-C' AND chave = 'TotalReceitas' AND coluna <> 'Receitas Brutas Realizadas'
    """).df()
    casos["ok"] = casos.calculado >= 0
    resumo = (casos.groupby(["teste", "exercicio", "anexo"], as_index=False)
              .agg(casos=("ok", "size"), ok=("ok", "sum"),
                   maior_divergencia=("calculado", lambda s: float((-s[s < 0]).max()) if (s < 0).any() else 0.0)))
    resumo["tipo"] = "informativo"
    resumo["tolerancia"] = 0.0
    return resumo, casos[~casos.ok].assign(diferenca=lambda d: d.calculado)


def main():
    con = duckdb.connect()
    con.execute(f"CREATE VIEW dca AS SELECT * FROM '{SILVER.as_posix()}/dca/*.parquet'")
    con.execute(f"CREATE VIEW contas AS SELECT * FROM '{SILVER.as_posix()}/contas/*.parquet'")

    partes, divergencias = [], []
    for casos, tipo in ((arvore_casos(con), "estrutural"), (balanco_casos(con), "estrutural")):
        resumo, div = resumir(casos, tipo)
        partes.append(resumo)
        divergencias.append(div)
    resumo, div = sinal_deducoes(con)
    partes.append(resumo)
    divergencias.append(div)

    r = pd.concat(partes, ignore_index=True)
    r["reprovados"] = r.casos - r.ok
    r["pct_ok"] = 100 * r.ok / r.casos
    GOLD.mkdir(parents=True, exist_ok=True)
    r.to_csv(GOLD / "validacao.csv", index=False)
    colunas = ["teste", "exercicio", "anexo", "cod_ibge", "coluna", "calculado", "declarado", "diferenca"]
    pd.concat(divergencias, ignore_index=True)[colunas].to_csv(GOLD / "validacao_divergencias.csv", index=False)

    pd.set_option("display.width", 200)
    print(r.to_string(index=False))
    estruturais = r[r.tipo == "estrutural"]
    divergencia = estruturais.reprovados / estruturais.casos
    falhas = estruturais[divergencia > MAX_DIVERGENCIA_FONTE]
    da_fonte = int(estruturais.reprovados.sum())
    if da_fonte and falhas.empty:
        print(f"\n{da_fonte} casos isolados em que o total declarado pelo ente não fecha com as próprias contas "
              f"(ver {GOLD / 'validacao_divergencias.csv'}).")
    if not falhas.empty:
        print(f"\n{len(falhas)} grupos com divergência acima de {MAX_DIVERGENCIA_FONTE:.2%}: provável erro no pipeline.")
        sys.exit(1)


if __name__ == "__main__":
    main()
