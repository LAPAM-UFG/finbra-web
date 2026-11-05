"""Clima por município e mês: médias areais das grades CHIRPS (chuva) e ERA5-Land (temperatura e outras) dentro de cada município.

Entrada (HD externo, baixada por clima_baixar.py e clima_era5.py): E:/finbra/brutos/clima/{malha,chirps,era5}.
Saída: silver/clima/chirps.parquet e silver/clima/era5.parquet (cod, ano, mes, variavel, valor); o gold sai de gold_clima().

Método: a malha municipal do IBGE (2022) é rasterizada numa grade 5 vezes mais fina que a do CHIRPS (0,01°) e cada célula
fina é atribuída ao seu município; o peso de um município em cada pixel da grade original é a fração de células finas dele
naquele pixel. O valor do município é a média ponderada dos pixels com dado. Município sem nenhum pixel com dado no mês
fica sem linha (nunca zero). As duas lagoas (Mirim e dos Patos) ficam de fora.
"""
import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from config import DATA, GOLD

BRUTOS = Path(__import__("os").environ.get("CLIMA_BRUTOS", "E:/finbra/brutos/clima"))
SILVER_C = DATA / "silver" / "clima"
GOLD_C = GOLD / "clima"
LAGOAS = {"4300001", "4300002"}
FATOR = 5  # células finas por pixel da grade original, em cada eixo


def malha() -> "gpd.GeoDataFrame":
    import geopandas as gpd
    g = gpd.read_file(f"zip://{(BRUTOS / 'malha' / 'BR_Municipios_2022.zip').as_posix()}")
    g = g[~g.CD_MUN.isin(LAGOAS)].reset_index(drop=True)
    return g


def pesos(g, transform, largura: int, altura: int) -> pd.DataFrame:
    """Tabela (pixel, mun, peso) para uma grade regular com `transform` (pixel quadrado, origem no canto superior esquerdo)."""
    from affine import Affine
    from rasterio import features

    res = transform.a
    fino = Affine(res / FATOR, 0, transform.c, 0, -res / FATOR, transform.f)
    # janela da grade que cobre o Brasil
    x0, y0, x1, y1 = g.total_bounds
    c0 = max(int(np.floor((x0 - transform.c) / res)), 0)
    c1 = min(int(np.ceil((x1 - transform.c) / res)), largura)
    r0 = max(int(np.floor((transform.f - y1) / res)), 0)
    r1 = min(int(np.ceil((transform.f - y0) / res)), altura)
    jan = Affine(res / FATOR, 0, transform.c + c0 * res, 0, -res / FATOR, transform.f - r0 * res)
    shp = [(geom, i + 1) for i, geom in enumerate(g.geometry)]
    ids = features.rasterize(shp, out_shape=((r1 - r0) * FATOR, (c1 - c0) * FATOR), transform=jan, fill=0, dtype="int32")
    linhas, colunas = np.nonzero(ids)
    mun = ids[linhas, colunas]
    pix = (linhas // FATOR + r0).astype(np.int64) * largura + (colunas // FATOR + c0)
    chave = pix * 8192 + mun
    u, n = np.unique(chave, return_counts=True)
    df = pd.DataFrame({"pixel": u // 8192, "mun": (u % 8192).astype(np.int32) - 1, "n": n})
    # município pequeno demais para a grade fina: usa o pixel que contém o centroide
    sem = sorted(set(range(len(g))) - set(df.mun))
    if sem:
        cen = g.geometry.iloc[sem].representative_point()
        col = np.floor((cen.x.values - transform.c) / res).astype(np.int64)
        lin = np.floor((transform.f - cen.y.values) / res).astype(np.int64)
        dentro = (col >= 0) & (col < largura) & (lin >= 0) & (lin < altura)
        extra = pd.DataFrame({"pixel": lin[dentro] * largura + col[dentro], "mun": np.array(sem)[dentro].astype(np.int32), "n": FATOR * FATOR})
        df = pd.concat([df, extra], ignore_index=True)
    return df[["pixel", "mun", "n"]]


def media_por_municipio(w: pd.DataFrame, valores: np.ndarray, n_mun: int) -> np.ndarray:
    """Média ponderada por município; NaN onde nenhum pixel tem dado."""
    v = valores.ravel()[w.pixel.values]
    ok = np.isfinite(v)
    soma = np.bincount(w.mun.values[ok], weights=(v[ok] * w.n.values[ok]), minlength=n_mun)
    peso = np.bincount(w.mun.values[ok], weights=w.n.values[ok], minlength=n_mun)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(peso > 0, soma / peso, np.nan)


def escrever(df: pd.DataFrame, destino: Path) -> None:
    destino.parent.mkdir(parents=True, exist_ok=True)
    t = pa.Table.from_pandas(df, preserve_index=False)
    pq.write_table(t, destino, compression="zstd")


def chirps() -> None:
    import rasterio

    arquivos = sorted((BRUTOS / "chirps").glob("chirps-v3.0.*.tif"))
    if not arquivos:
        raise SystemExit("sem arquivos do CHIRPS: rode clima_baixar.py")
    g = malha()
    with rasterio.open(arquivos[0]) as s:
        w = pesos(g, s.transform, s.width, s.height)
    cobertos = w.mun.nunique()
    print(f"malha: {len(g)} municípios; {cobertos} com pixel na grade ({len(g) - cobertos} fora da grade); {len(w)} pares pixel×município")
    cods = g.CD_MUN.astype(np.int64).values
    saida = []
    for a in arquivos:
        ano, mes = map(int, re.search(r"\.(\d{4})\.(\d{2})\.tif$", a.name).groups())
        with rasterio.open(a) as s:
            x = s.read(1).astype("float64")
        x[x < -9000] = np.nan
        m = media_por_municipio(w, x, len(g))
        ok = np.isfinite(m)
        saida.append(pd.DataFrame({"cod": cods[ok], "ano": ano, "mes": mes, "variavel": "chuva_mm", "valor": m[ok].astype("float32")}))
    df = pd.concat(saida, ignore_index=True)
    escrever(df, SILVER_C / "chirps.parquet")
    print(f"silver/clima/chirps.parquet: {len(df):,} linhas, {df.cod.nunique()} municípios, {df.ano.min()}-{df.ano.max()}")


# variável: (rótulo, unidade, como o ano resume os 12 meses, fonte)
VARIAVEIS = {
    "chuva_mm": ("Chuva", "mm", "soma", "CHIRPS v3 (UCSB/CHC)"),
}
NORMAL_DE, NORMAL_ATE = 1991, 2020  # período da normal climatológica (padrão da OMM)
REGIAO = {"1": "Norte", "2": "Nordeste", "3": "Sudeste", "4": "Sul", "5": "Centro-Oeste"}


def gold_clima() -> None:
    """gold/clima: mensal (município × mês), anual (com normal e anomalia), normal (por mês), agregado (Brasil e UF, ponderado
    pela área), territorio e catalogo; atualiza fontes.clima no manifesto."""
    import duckdb

    arqs = [a for a in (SILVER_C / "chirps.parquet", SILVER_C / "era5.parquet") if a.exists()]
    if not arqs:
        raise SystemExit("sem silver/clima: rode as etapas de agregação")
    GOLD_C.mkdir(parents=True, exist_ok=True)
    g = malha()
    terr = pd.DataFrame({"cod": g.CD_MUN.astype("int64"), "nome": g.NM_MUN, "uf": g.SIGLA_UF, "area_km2": g.AREA_KM2.astype("float64")})
    terr["regiao"] = g.CD_MUN.str[0].map(REGIAO)
    con = duckdb.connect()
    con.register("terr", pa.Table.from_pandas(terr, preserve_index=False))
    con.register("agr", pa.Table.from_pandas(pd.DataFrame(
        [{"variavel": v, "agregacao": a} for v, (_, _, a, _) in VARIAVEIS.items()]), preserve_index=False))
    con.execute("CREATE TABLE m AS " + " UNION ALL ".join(f"SELECT * FROM read_parquet('{a.as_posix()}')" for a in arqs))

    def d(nome: str) -> str:
        return (GOLD_C / nome).as_posix()
    cp = "(FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)"
    con.execute(f"COPY (SELECT cod, ano, mes, variavel, valor FROM m ORDER BY variavel, cod, ano, mes) TO '{d('mensal.parquet')}' {cp}")
    # normal por município e mês: só onde há ao menos 25 dos 30 anos
    con.execute(f"""CREATE TABLE normal AS SELECT cod, mes, variavel, avg(valor) AS normal, count(*) AS n_anos
        FROM m WHERE ano BETWEEN {NORMAL_DE} AND {NORMAL_ATE} GROUP BY ALL HAVING count(*) >= 25""")
    con.execute(f"COPY (SELECT cod, mes, variavel, normal FROM normal ORDER BY variavel, cod, mes) TO '{d('normal.parquet')}' {cp}")
    # anual: só anos completos (12 meses); soma (chuva) ou média (temperatura) conforme a variável
    con.execute("""CREATE TABLE anual AS
        SELECT m.cod, m.ano, m.variavel, CASE WHEN a.agregacao = 'soma' THEN sum(m.valor) ELSE avg(m.valor) END AS valor
        FROM m JOIN agr a USING (variavel) GROUP BY m.cod, m.ano, m.variavel, a.agregacao HAVING count(*) = 12""")
    con.execute("""CREATE TABLE normal_anual AS
        SELECT n.cod, n.variavel, CASE WHEN a.agregacao = 'soma' THEN sum(n.normal) ELSE avg(n.normal) END AS normal
        FROM normal n JOIN agr a USING (variavel) GROUP BY n.cod, n.variavel, a.agregacao HAVING count(*) = 12""")
    con.execute(f"""COPY (SELECT a.cod, a.ano, a.variavel, a.valor, n.normal,
                          CASE WHEN a.variavel = 'chuva_mm' AND n.normal > 0 THEN a.valor / n.normal - 1 END AS anomalia_pct,
                          CASE WHEN a.variavel <> 'chuva_mm' THEN a.valor - n.normal END AS anomalia
                   FROM anual a LEFT JOIN normal_anual n USING (cod, variavel) ORDER BY a.variavel, a.cod, a.ano)
                   TO '{d('anual.parquet')}' {cp}""")
    # Brasil e UF, ponderados pela área do município; mes = 0 é o ano inteiro
    con.execute("CREATE TABLE mu AS SELECT m.*, t.uf, t.area_km2 FROM m JOIN terr t USING (cod)")
    con.execute("""CREATE TABLE agregado_mes AS
        SELECT 'BR' AS grupo, ano, mes, variavel, sum(valor * area_km2) / sum(area_km2) AS valor FROM mu GROUP BY ALL
        UNION ALL SELECT uf, ano, mes, variavel, sum(valor * area_km2) / sum(area_km2) FROM mu GROUP BY ALL""")
    con.execute("""CREATE TABLE agregado AS
        SELECT * FROM agregado_mes
        UNION ALL
        SELECT g.grupo, g.ano, 0, g.variavel, CASE WHEN a.agregacao = 'soma' THEN sum(g.valor) ELSE avg(g.valor) END
        FROM agregado_mes g JOIN agr a USING (variavel) GROUP BY g.grupo, g.ano, g.variavel, a.agregacao HAVING count(*) = 12""")
    con.execute(f"""COPY (SELECT g.grupo, g.ano, g.mes, g.variavel, g.valor,
            CASE WHEN g.variavel = 'chuva_mm' AND n.normal > 0 THEN g.valor / n.normal - 1 END AS anomalia_pct
          FROM agregado g
          LEFT JOIN (SELECT grupo, mes, variavel, avg(valor) AS normal FROM agregado
                     WHERE ano BETWEEN {NORMAL_DE} AND {NORMAL_ATE} GROUP BY ALL) n USING (grupo, mes, variavel)
          ORDER BY g.variavel, g.grupo, g.ano, g.mes) TO '{d('agregado.parquet')}' {cp}""")
    con.execute(f"COPY (SELECT cod, nome, uf, regiao, area_km2 FROM terr ORDER BY cod) TO '{d('territorio.parquet')}' {cp}")
    existentes = {r[0] for r in con.execute("SELECT DISTINCT variavel FROM m").fetchall()}
    cat = pd.DataFrame([{"variavel": v, "rotulo": r, "unidade": u, "resumo_anual": a, "fonte": f}
                        for v, (r, u, a, f) in VARIAVEIS.items() if v in existentes])
    con.register("cat", pa.Table.from_pandas(cat, preserve_index=False))
    con.execute(f"COPY cat TO '{d('catalogo.parquet')}' {cp}")
    info = con.execute("SELECT min(ano), max(ano), max(ano * 100 + mes) FROM m").fetchone()
    caminho = GOLD / "manifesto.json"
    if caminho.exists():
        man = json.loads(caminho.read_text(encoding="utf-8"))
        man.setdefault("fontes", {})["clima"] = {
            "anos": [info[0], info[1]], "ate": info[2], "variaveis": cat.variavel.tolist(), "normal": [NORMAL_DE, NORMAL_ATE],
            "processado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "url": "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/latam/tifs/"}
        man["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        caminho.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
    for arq in sorted(GOLD_C.glob("*.parquet")):
        n = con.execute(f"SELECT count(*) FROM '{arq.as_posix()}'").fetchone()[0]
        print(f"gold/clima/{arq.name}: {n:,} linhas, {arq.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("etapa", choices=["chirps", "gold"])
    a = ap.parse_args()
    {"chirps": chirps, "gold": gold_clima}[a.etapa]()
