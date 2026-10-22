"""Testes de consistência do pipeline. Sai com código 1 se algum falhar.

1. Árvore x total oficial: em cada ente/anexo/coluna, as raízes da árvore somam a
   linha de total que o próprio ente declarou (I-C: TotalReceitas; I-D e I-F:
   TotalDespesas; I-E e I-G: total exceto intra-orçamentárias).
2. Balanço (I-AB): Ativo = Passivo + Patrimônio Líquido.
3. Indicadores x painel de pesquisa (.dta), quando houver: FPM, IPTU, ISS, ITBI.

Grava data/gold/validacao.csv (o site mostra na página de qualidade dos dados).

Uso:
    py pipeline/validate.py [--dta "E:/.../FINBRA/Revenue"]
"""
import argparse
import sys
from pathlib import Path

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


def arvore_x_total(con):
    casos = arvore_casos(con)
    divergentes = casos[(casos.raiz - casos.total).abs() > TOLERANCIA]
    divergentes.to_csv(GOLD / "validacao_divergencias.csv", index=False)
    casos["ok"] = (casos.raiz - casos.total).abs() <= TOLERANCIA
    return (casos.groupby(["exercicio", "anexo"], as_index=False)
            .agg(casos=("ok", "size"), ok=("ok", "sum"))
            .assign(teste="arvore x total")[["teste", "exercicio", "anexo", "casos", "ok"]])


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
        SELECT exercicio, anexo, cod_ibge, coluna, raiz.v AS raiz, tot.v AS total
        FROM raiz JOIN tot USING (exercicio, cod_ibge, anexo, coluna)
        ORDER BY ALL
    """).df()


def balanco(con):
    return con.execute(f"""
        WITH b AS (
            SELECT exercicio, cod_ibge,
                   sum(valor) FILTER (chave = 'P1') AS ativo,
                   sum(valor) FILTER (chave = 'P2') AS passivo_pl
            FROM dca WHERE anexo = 'I-AB' AND coluna = 'Saldo em 31/12' GROUP BY ALL)
        SELECT 'ativo = passivo + PL' AS teste, exercicio, 'I-AB' AS anexo, count(*) AS casos,
               sum((abs(ativo - passivo_pl) <= {TOLERANCIA})::INT) AS ok
        FROM b WHERE ativo IS NOT NULL AND passivo_pl IS NOT NULL GROUP BY ALL ORDER BY ALL
    """).df()


def contra_pesquisa(pasta_dta):
    pasta = Path(pasta_dta)
    ind = pd.read_parquet(GOLD / "indicadores.parquet")
    ind = ind[ind.esfera == "M"].assign(mun=lambda d: d.cod_ibge // 10)
    fpm = pd.read_stata(pasta / "fpm_2013-2022.dta").rename(columns={"year": "exercicio"})
    trib = pd.read_stata(pasta / "iptu_2013-2022.dta").rename(columns={"year": "exercicio"})
    ref = fpm.merge(trib, on=["mun", "exercicio"], how="outer")
    ref["exercicio"] = ref["exercicio"].astype(int)
    ref = ref.rename(columns={"fpm": "ref_fpm", "IPTU": "ref_iptu", "ISS": "ref_iss", "ITBI": "ref_itbi"})
    m = ind.merge(ref, on=["mun", "exercicio"])
    saida = []
    for nosso in ("fpm", "iptu", "iss", "itbi"):
        deles = f"ref_{nosso}"
        for ano, g in m.groupby("exercicio"):
            g = g.dropna(subset=[deles])
            ok = ((g[nosso].fillna(0) - g[deles]).abs() <= TOLERANCIA).sum()
            saida.append((f"{nosso} x pesquisa", ano, "I-C", len(g), int(ok)))
    return pd.DataFrame(saida, columns=["teste", "exercicio", "anexo", "casos", "ok"])


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dta")
    args = p.parse_args()
    con = duckdb.connect()
    con.execute(f"CREATE VIEW dca AS SELECT * FROM '{SILVER.as_posix()}/dca/*.parquet'")
    con.execute(f"CREATE VIEW contas AS SELECT * FROM '{SILVER.as_posix()}/contas/*.parquet'")

    partes = [arvore_x_total(con), balanco(con)]
    if args.dta:
        partes.append(contra_pesquisa(args.dta))
    r = pd.concat(partes, ignore_index=True)
    r["pct_ok"] = (100 * r.ok / r.casos).round(2)
    GOLD.mkdir(parents=True, exist_ok=True)
    r.to_csv(GOLD / "validacao.csv", index=False)

    pd.set_option("display.width", 200)
    print(r.to_string(index=False))
    estruturais = r[~r.teste.str.endswith("pesquisa")]
    divergencia = 1 - estruturais.ok / estruturais.casos
    falhas = estruturais[divergencia > MAX_DIVERGENCIA_FONTE]
    da_fonte = int((estruturais.casos - estruturais.ok).sum())
    if da_fonte and falhas.empty:
        print(f"\n{da_fonte} casos isolados em que o total declarado pelo ente não fecha com as próprias contas "
              f"(ver {GOLD / 'validacao_divergencias.csv'}).")
    if not falhas.empty:
        print(f"\n{len(falhas)} grupos com divergência acima de {MAX_DIVERGENCIA_FONTE:.2%}: provável erro no pipeline.")
        sys.exit(1)


if __name__ == "__main__":
    main()
