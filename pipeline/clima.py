"""Clima por município e mês: médias areais das grades CHIRPS (chuva) e ERA5-Land (temperatura e outras) dentro de cada município.

Entrada (HD externo, baixada por clima_baixar.py e clima_era5.py): E:/finbra/brutos/clima/{malha,chirps,era5}.
Saída: silver/clima/chirps.parquet e silver/clima/era5.parquet (cod, ano, mes, variavel, valor); o gold sai de gold_clima().

Método: a malha municipal do IBGE (2022) é rasterizada numa grade 5 vezes mais fina que a do CHIRPS (0,01°) e cada célula
fina é atribuída ao seu município; o peso de um município em cada pixel da grade original é a fração de células finas dele
naquele pixel. O valor do município é a média ponderada dos pixels com dado. Município sem nenhum pixel com dado no mês
fica sem linha (nunca zero). As duas lagoas (Mirim e dos Patos) ficam de fora.
"""
import argparse
import calendar
import json
import os
import re
import shutil
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


RES_ERA5 = 0.1  # grau; ERA5-Land
MAX_DIST_MAR = 0.25  # grau: município sem pixel de terra usa o pixel de terra mais próximo só se estiver a até ~28 km
# variável do arquivo ERA5-Land: (nome publicado, conversão da média mensal por dia para a unidade final)
# os acumulados (evaporação) vêm em metros por dia e negativos quando o fluxo é para cima; a radiação, em J/m² por dia
ERA5 = {
    "t2m": ("temperatura_c", lambda x, d: x - 273.15),
    "d2m": ("orvalho_c", lambda x, d: x - 273.15),
    "swvl1": ("umid_solo_pct", lambda x, d: np.clip(x, 0, None) * 100),
    "e": ("evap_mm", lambda x, d: -x * 1000 * d),
    # "pev" (evaporação potencial) fica de fora: no ERA5-Land passa de 50 mm/dia na seca do Cerrado, valor sem sentido físico
    "ssrd": ("radiacao_wm2", lambda x, d: x / 86400),
}


# No produto mensal do ERA5-Land, de 09/2022 a 02/2024 os acumulados (evaporação e radiação) vêm com cerca de 0,37 do valor esperado
# (mesmo fator nas duas variáveis; já está no arquivo baixado, em todo o Brasil). O ECMWF documenta o defeito (ERA5-Land data
# documentation: https://confluence.ecmwf.int/spaces/CKB/pages/140385202/ERA5-Land%2Bdata%2Bdocumentation) e informa que o produto
# mensal NÃO será republicado; a alternativa oficial é o produto monthly_averaged_reanalysis_by_hour_of_day às 00h, só para
# total_evaporation (e) e surface_solar_radiation_downwards (ssrd) nesses meses. Não mude o MENSAL global (t2m, d2m e solo passariam a
# ser a média de um único horário), não interpole e não libere os meses defeituosos. Até a recuperação ser baixada à parte, comparada
# com os meses vizinhos e validada em cópia, esses 18 meses saem das duas variáveis e os anos 2022–2024 ficam sem total anual.
ACUMULADOS = {"evap_mm", "radiacao_wm2"}
# Antes de 1979 (trecho retroativo do ERA5, anterior aos satélites) a série nacional dá saltos sem sentido físico, como 24,4 →
# 25,6 → 24,4 °C em 1960–1962; só se publica de 1979 em diante (os brutos ficam no disco).
ERA5_ANO_DE = 1979
ACUMULADO_SUSPEITO = (202209, 202402)


def _abrir_era5(arq):
    import xarray as xr
    ds = xr.open_dataset(arq)
    if "expver" in ds.dims:  # meses recentes trazem duas versões (ERA5 e ERA5T): fica a que tem dado
        ds = ds.sel(expver=ds.expver.values[0]).combine_first(ds.sel(expver=ds.expver.values[1]))
    return ds


def ordem_arquivos_era5(arqs) -> list:
    """Anuais (AAAA.nc) primeiro e os arquivos por mês (AAAA-MM.nc, que o coletor atual não gera mais) depois: com drop_duplicates(keep="last") o
    mês mais específico vence, e um anual antigo nunca sobrescreve um mês revisado (por nome, "2026-03.nc" ordenaria ANTES de "2026.nc")."""
    return sorted(arqs, key=lambda p: ("-" in Path(p).stem, Path(p).name))


def era5() -> None:
    from affine import Affine

    arqs = ordem_arquivos_era5((BRUTOS / "era5" / "mensal").glob("*.nc"))
    if not arqs:
        raise SystemExit("sem arquivos do ERA5-Land: rode clima_era5.py mensal")
    g = malha()
    ds0 = _abrir_era5(arqs[0])
    lat, lon = ds0.latitude.values, ds0.longitude.values
    h = RES_ERA5 / 2
    w = pesos(g, Affine(RES_ERA5, 0, lon[0] - h, 0, -RES_ERA5, lat[0] + h), len(lon), len(lat))
    # município que só tem pixel de mar (o ERA5-Land só tem terra): pixel de terra mais próximo, se bem perto
    terra = np.isfinite(ds0["t2m"].isel(valid_time=0).values)
    m0 = media_por_municipio(w, terra.astype("float64") * np.where(terra, 1.0, np.nan), len(g))
    sem = np.flatnonzero(~np.isfinite(m0))
    extra = []
    if len(sem):
        li, co = np.nonzero(terra)
        cen = g.geometry.iloc[sem].representative_point()
        for i, x, y in zip(sem, cen.x.values, cen.y.values):
            d = np.hypot(lon[co] - x, lat[li] - y)
            k = int(d.argmin())
            if d[k] <= MAX_DIST_MAR:
                extra.append({"pixel": int(li[k]) * len(lon) + int(co[k]), "mun": int(i), "n": FATOR * FATOR})
        w = pd.concat([w, pd.DataFrame(extra, columns=["pixel", "mun", "n"])], ignore_index=True)
    sem_dado = len(sem) - len(extra)
    print(f"malha: {len(g)} municípios; {len(sem)} sem pixel de terra ({len(extra)} usam o pixel de terra mais próximo, {sem_dado} ficam sem dado)")
    cods = g.CD_MUN.astype(np.int64).values
    saida = []
    for arq in arqs:
        ds = _abrir_era5(arq)
        assert len(ds.latitude) == len(lat) and len(ds.longitude) == len(lon), f"grade diferente em {arq.name}"
        tempos = pd.to_datetime(ds.valid_time.values)
        for v, (nome, conv) in ERA5.items():
            if v not in ds:
                continue
            x = ds[v].values.astype("float64")
            for k, t in enumerate(tempos):
                if t.year < ERA5_ANO_DE:
                    continue
                if nome in ACUMULADOS and ACUMULADO_SUSPEITO[0] <= t.year * 100 + t.month <= ACUMULADO_SUSPEITO[1]:
                    continue
                m = media_por_municipio(w, conv(x[k], calendar.monthrange(t.year, t.month)[1]), len(g))
                ok = np.isfinite(m)
                saida.append(pd.DataFrame({"cod": cods[ok], "ano": t.year, "mes": t.month, "variavel": nome, "valor": m[ok].astype("float32")}))
        print(f"  {arq.name}", flush=True)
    df = pd.concat(saida, ignore_index=True).drop_duplicates(["cod", "ano", "mes", "variavel"], keep="last")
    escrever(df, SILVER_C / "era5.parquet")
    print(f"silver/clima/era5.parquet: {len(df):,} linhas, {df.cod.nunique()} municípios, {df.ano.min()}-{df.ano.max()}, variáveis {sorted(df.variavel.unique())}")


ERA5_FONTE = "ERA5-Land (Copernicus/ECMWF)"
# variável: (rótulo, unidade, como o ano resume os 12 meses, fonte, anomalia: 'pct' relativa à normal ou 'abs' diferença)
VARIAVEIS = {
    "chuva_mm": ("Chuva", "mm", "soma", "CHIRPS v3 (UCSB/CHC)", "pct"),
    "temperatura_c": ("Temperatura do ar a 2 m", "°C", "media", ERA5_FONTE, "abs"),
    "orvalho_c": ("Ponto de orvalho a 2 m", "°C", "media", ERA5_FONTE, "abs"),
    "umid_solo_pct": ("Umidade do solo (0–7 cm)", "%", "media", ERA5_FONTE, "abs"),
    "evap_mm": ("Evaporação total", "mm", "soma", ERA5_FONTE, "pct"),
    "radiacao_wm2": ("Radiação solar incidente", "W/m²", "media", ERA5_FONTE, "abs"),
}
NORMAL_DE, NORMAL_ATE = 1991, 2020  # período da normal climatológica (padrão da OMM)
REGIAO = {"1": "Norte", "2": "Nordeste", "3": "Sudeste", "4": "Sul", "5": "Centro-Oeste"}


ARQUIVOS_GOLD = ("mensal", "anual", "normal", "agregado", "territorio", "catalogo")


def validar_silver(silver: Path | None = None) -> dict:
    """Confere os DOIS silver antes de qualquer escrita: gold parcial (só chuva, ou só ERA5) não é gerado em silêncio.
    Exige as colunas, as seis variáveis, nenhum valor nulo ou não finito, nenhuma chave repetida, meses de 1 a 12, nenhum mês
    defeituoso do ERA5 (09/2022–02/2024 de evaporação e radiação) nem anterior a 1979, e cobertura de municípios parecida entre as
    variáveis. Levanta ValueError com todos os problemas; devolve o resumo (municípios e último mês por variável)."""
    import duckdb

    silver = silver or SILVER_C
    problemas: list[str] = []
    arqs = {"chirps": silver / "chirps.parquet", "era5": silver / "era5.parquet"}
    for nome, arq in arqs.items():
        if not arq.exists():
            problemas.append(f"falta silver/clima/{arq.name} (rode 'clima.py {nome}'): o gold sairia incompleto")
    if problemas:
        raise ValueError("; ".join(problemas))
    con = duckdb.connect()
    try:
        esperadas = {"chuva_mm"} | {nome for nome, _ in ERA5.values()}
        resumo: dict[str, dict] = {}
        for nome, arq in arqs.items():
            lit = arq.as_posix().replace("'", "''")
            cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet('{lit}')").fetchall()]
            if cols != ["cod", "ano", "mes", "variavel", "valor"]:
                problemas.append(f"{arq.name}: colunas inesperadas {cols}")
                continue
            if con.execute(f"SELECT count(*) FROM read_parquet('{lit}')").fetchone()[0] == 0:
                problemas.append(f"{arq.name}: vazio")
                continue
            n_ruins = con.execute(f"SELECT count(*) FROM read_parquet('{lit}') WHERE valor IS NULL OR NOT isfinite(valor) OR mes NOT BETWEEN 1 AND 12 OR cod IS NULL OR ano IS NULL").fetchone()[0]
            if n_ruins:
                problemas.append(f"{arq.name}: {n_ruins} linhas com valor nulo/não finito, mês fora de 1–12 ou chave nula")
            dup = con.execute(f"SELECT count(*) FROM (SELECT 1 FROM read_parquet('{lit}') GROUP BY cod, ano, mes, variavel HAVING count(*) > 1)").fetchone()[0]
            if dup:
                problemas.append(f"{arq.name}: {dup} chaves (cod, ano, mes, variavel) repetidas")
            for v, n_cod, ate in con.execute(f"SELECT variavel, count(DISTINCT cod), max(ano * 100 + mes) FROM read_parquet('{lit}') GROUP BY variavel").fetchall():
                resumo[v] = {"municipios": n_cod, "ate": ate}
            if nome == "era5":
                d0, d1 = ACUMULADO_SUSPEITO
                n_def = con.execute(f"SELECT count(*) FROM read_parquet('{lit}') WHERE variavel IN ('evap_mm', 'radiacao_wm2') AND ano * 100 + mes BETWEEN {d0} AND {d1}").fetchone()[0]
                if n_def:
                    problemas.append(f"{arq.name}: {n_def} linhas de evap/radiação em {d0}–{d1} (meses defeituosos do ECMWF devem ficar de fora)")
                n_ant = con.execute(f"SELECT count(*) FROM read_parquet('{lit}') WHERE ano < {ERA5_ANO_DE}").fetchone()[0]
                if n_ant:
                    problemas.append(f"{arq.name}: {n_ant} linhas anteriores a {ERA5_ANO_DE}")
        faltam = esperadas - set(resumo)
        if faltam:
            problemas.append(f"variáveis ausentes nos silver: {sorted(faltam)}")
        if resumo:
            maior = max(r["municipios"] for r in resumo.values())
            for v, r in sorted(resumo.items()):
                if r["municipios"] < 0.95 * maior:
                    problemas.append(f"{v}: só {r['municipios']} municípios (a maior cobertura tem {maior}): silver parcial")
    finally:
        con.close()
    if problemas:
        raise ValueError("; ".join(problemas))
    return resumo


def _destino_seguro(saida: Path) -> None:
    """Confere destinos efetivos, inclusive links em gold/clima, antes de criar/escrever algo."""
    g = saida / "gold"
    alvos = [saida, g, g / "clima", g / "clima.novo", g / "manifesto.json"]
    for pasta in (g / "clima", g / "clima.novo"):
        alvos.extend(pasta / f"{nome}.parquet" for nome in ARQUIVOS_GOLD)
    for alvo in alvos:
        destino = alvo.resolve()
        for origem in (GOLD.resolve(), SILVER_C.resolve()):
            if destino == origem or destino.is_relative_to(origem) or origem.is_relative_to(destino):
                raise ValueError(f"a saída candidata não pode tocar os dados de origem: {destino}")


def gold_clima(saida: Path | str | None = None, substituir: bool = False) -> None:
    """gold/clima: mensal (município × mês), anual (com normal e anomalia), normal (por mês), agregado (Brasil e UF, ponderado
    pela área), territorio e catalogo; atualiza fontes.clima no manifesto.

    Antes de escrever, confere os dois silver (validar_silver). Os arquivos são gerados num diretório de preparo (clima.novo), lidos
    de volta e só então colocados no lugar, um a um e por troca atômica; o manifesto vai por último, e fontes.clima é reescrito sem o
    campo `painel` (o resumo leve de clima_painel.py precisa ser gerado de novo para esta versão).
    Com `saida`, tudo vai para <saida>/gold/clima e <saida>/gold/manifesto.json (cópia): o gold real não é tocado."""
    import duckdb

    resumo_silver = validar_silver()  # nada é criado nem escrito antes disto
    if saida is not None:
        saida = Path(saida)
        _destino_seguro(saida)
        destino = saida / "gold" / "clima"
        manifesto_destino = saida / "gold" / "manifesto.json"
        if not substituir and (destino.exists() and any(destino.iterdir()) or manifesto_destino.exists()):
            raise ValueError(f"a saída candidata já tem arquivos de clima ou manifesto (use --substituir): {saida}")
    else:
        destino = GOLD_C
        manifesto_destino = GOLD / "manifesto.json"
    preparo = destino.with_name(destino.name + ".novo")
    if preparo.exists():
        raise ValueError(f"sobra de uma geração interrompida em {preparo}: confira e apague à mão antes de gerar de novo")
    arqs = [SILVER_C / "chirps.parquet", SILVER_C / "era5.parquet"]
    g = malha()
    terr = pd.DataFrame({"cod": g.CD_MUN.astype("int64"), "nome": g.NM_MUN, "uf": g.SIGLA_UF, "area_km2": g.AREA_KM2.astype("float64")})
    terr["regiao"] = g.CD_MUN.str[0].map(REGIAO)
    preparo.mkdir(parents=True)
    con = duckdb.connect()
    try:
        con.register("terr", pa.Table.from_pandas(terr, preserve_index=False))
        con.register("agr", pa.Table.from_pandas(pd.DataFrame(
            [{"variavel": v, "agregacao": a, "tipo": tp} for v, (_, _, a, _, tp) in VARIAVEIS.items()]), preserve_index=False))
        con.execute("CREATE TABLE m AS " + " UNION ALL ".join(f"SELECT * FROM read_parquet('{a.as_posix()}')" for a in arqs))

        def d(nome: str) -> str:
            return (preparo / nome).as_posix()
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
                              CASE WHEN g.tipo = 'pct' AND n.normal > 0 THEN a.valor / n.normal - 1 END AS anomalia_pct,
                              CASE WHEN g.tipo = 'abs' THEN a.valor - n.normal END AS anomalia
                       FROM anual a JOIN agr g USING (variavel) LEFT JOIN normal_anual n USING (cod, variavel)
                       ORDER BY a.variavel, a.cod, a.ano) TO '{d('anual.parquet')}' {cp}""")
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
                CASE WHEN t.tipo = 'pct' AND n.normal > 0 THEN g.valor / n.normal - 1 END AS anomalia_pct,
                CASE WHEN t.tipo = 'abs' THEN g.valor - n.normal END AS anomalia
              FROM agregado g
              JOIN agr t USING (variavel)
              LEFT JOIN (SELECT grupo, mes, variavel, avg(valor) AS normal FROM agregado
                         WHERE ano BETWEEN {NORMAL_DE} AND {NORMAL_ATE} GROUP BY ALL) n USING (grupo, mes, variavel)
              ORDER BY g.variavel, g.grupo, g.ano, g.mes) TO '{d('agregado.parquet')}' {cp}""")
        con.execute(f"COPY (SELECT cod, nome, uf, regiao, area_km2 FROM terr ORDER BY cod) TO '{d('territorio.parquet')}' {cp}")
        existentes = {r[0] for r in con.execute("SELECT DISTINCT variavel FROM m").fetchall()}
        faixa = {v: (a, b, c) for v, a, b, c in con.execute(
            "SELECT a.variavel, min(a.ano), max(a.ano), (SELECT max(ano * 100 + mes) FROM m WHERE m.variavel = a.variavel) FROM anual a GROUP BY a.variavel").fetchall()}
        cat = pd.DataFrame([{"variavel": v, "rotulo": r, "unidade": u, "resumo_anual": a, "fonte": f, "anomalia": tp,
                             "ano_de": faixa[v][0], "ano_ate": faixa[v][1], "ate": faixa[v][2]}
                            for v, (r, u, a, f, tp) in VARIAVEIS.items() if v in existentes])
        con.register("cat", pa.Table.from_pandas(cat, preserve_index=False))
        con.execute(f"COPY cat TO '{d('catalogo.parquet')}' {cp}")
        info = con.execute("SELECT min(ano), max(ano), max(ano * 100 + mes) FROM m").fetchone()
        # conferência do que foi gravado, antes de tocar o destino: seis arquivos legíveis, o mensal inteiro e as seis variáveis
        linhas = {n: con.execute(f"SELECT count(*) FROM read_parquet('{(preparo / (n + '.parquet')).as_posix()}')").fetchone()[0] for n in ARQUIVOS_GOLD}
        if any(v == 0 for v in linhas.values()):
            raise ValueError(f"arquivo vazio na geração: {linhas}")
        if linhas["mensal"] != con.execute("SELECT count(*) FROM m").fetchone()[0]:
            raise ValueError("o mensal gerado não tem todas as linhas do silver")
        if set(cat.variavel) != set(resumo_silver):
            raise ValueError(f"catálogo com variáveis diferentes das do silver: {sorted(set(cat.variavel) ^ set(resumo_silver))}")
        total = linhas
    except Exception:
        con.close()
        shutil.rmtree(preparo, ignore_errors=True)  # só o diretório de preparo desta execução; o destino não foi tocado
        raise
    # tudo validado: coloca no lugar, arquivo por arquivo (troca atômica); o manifesto por último
    destino.mkdir(parents=True, exist_ok=True)
    for n in ARQUIVOS_GOLD:
        os.replace(preparo / f"{n}.parquet", destino / f"{n}.parquet")
    preparo.rmdir()
    origem_manifesto = GOLD / "manifesto.json"
    if origem_manifesto.exists():
        man = json.loads(origem_manifesto.read_text(encoding="utf-8"))
        man.setdefault("fontes", {})["clima"] = {
            "anos": [info[0], info[1]], "ate": info[2], "variaveis": cat.variavel.tolist(), "normal": [NORMAL_DE, NORMAL_ATE],
            "processado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "url": "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/latam/tifs/",
            "fontes": sorted({f for _, (_, _, _, f, _) in VARIAVEIS.items()})}
        man["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        manifesto_destino.parent.mkdir(parents=True, exist_ok=True)
        parcial = manifesto_destino.with_name(manifesto_destino.name + ".parcial")
        parcial.write_text(json.dumps(man, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(parcial, manifesto_destino)
    for arq in sorted(destino.glob("*.parquet")):
        print(f"gold/clima/{arq.name}: {total[arq.stem]:,} linhas, {arq.stat().st_size / 1e6:.1f} MB")
    con.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("etapa", choices=["chirps", "era5", "gold"])
    ap.add_argument("--saida", help="só para 'gold': pasta candidata (recebe gold/clima e uma cópia do manifesto); o gold real não é tocado")
    ap.add_argument("--substituir", action="store_true", help="só para 'gold' com --saida: permite sobrescrever uma saída candidata anterior")
    a = ap.parse_args()
    if a.etapa == "gold":
        gold_clima(a.saida, a.substituir)
    else:
        {"chirps": chirps, "era5": era5}[a.etapa]()
