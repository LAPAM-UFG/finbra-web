"""Baixa o ERA5-Land (Copernicus CDS) para o Brasil: médias mensais e estatísticas diárias, em NetCDF.

Saída (HD externo): E:/finbra/brutos/clima/era5/mensal/AAAA.nc e, em diario/<media|tmax|tmin>/, AAAA-MM.nc (MM = primeiro mês do
bloco de meses de cada pedido: o limite de custo do CDS obriga a repartir o ano). A pasta media traz temperatura, orvalho, umidade
do solo e vento u e v. Retomável: o que já está no disco é pulado.

Credenciais: CDSAPI_URL e CDSAPI_KEY no .env (conta gratuita no Climate Data Store, licença do ERA5-Land aceita).
Os valores do mensal são as médias do dia (acumulados em "por dia"); a conversão para unidades finais fica em clima.py.

Uso: python clima_era5.py [mensal] [diario] [--desde 1950] [--ate 2026] [--conexoes 3]
"""
import argparse
import calendar
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BRUTOS = Path(os.environ.get("CLIMA_BRUTOS", "E:/finbra/brutos/clima")) / "era5"
AREA = [6, -74, -34, -28]  # N, O, S, L: Brasil inclusive Fernando de Noronha e Trindade

MENSAL = ["2m_temperature", "2m_dewpoint_temperature", "volumetric_soil_water_layer_1",
          "total_evaporation", "potential_evaporation", "surface_solar_radiation_downwards"]
# (nome da pasta, variáveis, estatística) do conjunto diário; o CDS só publica média, mínima e máxima de variáveis de estado
DIARIO = [("media", ["2m_temperature", "2m_dewpoint_temperature", "volumetric_soil_water_layer_1",
                     "10m_u_component_of_wind", "10m_v_component_of_wind"], "daily_mean"),
          ("tmax", ["2m_temperature"], "daily_maximum"),
          ("tmin", ["2m_temperature"], "daily_minimum")]


def carregar_env() -> None:
    arq = RAIZ / ".env"
    if arq.exists():
        for linha in arq.read_text(encoding="utf-8").splitlines():
            if "=" in linha and not linha.lstrip().startswith("#"):
                k, v = linha.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def log(msg: str) -> None:
    print(f"{datetime.now():%H:%M:%S} {msg}", flush=True)


def cliente():
    import cdsapi
    return cdsapi.Client(url=os.environ["CDSAPI_URL"], key=os.environ["CDSAPI_KEY"], quiet=True, progress=False)


_trava = threading.Lock()
_ultimo_envio = [0.0]
ESPACO_S = 30  # o CDS rejeita pedidos que chegam juntos: um envio a cada 30 s, no mínimo


def _vez() -> None:
    """Bloqueia até passarem ESPACO_S segundos desde o envio anterior (de qualquer conexão)."""
    with _trava:
        espera = _ultimo_envio[0] + ESPACO_S - time.time()
        if espera > 0:
            time.sleep(espera)
        _ultimo_envio[0] = time.time()


def pedir(conjunto: str, pedido: dict, alvo: Path, tentativas: int = 4, rejeicoes: int = 40) -> bool:
    """Baixa para `alvo` (via .parte). False se o CDS recusar o pedido de forma definitiva (dado indisponível ou grande demais).
    O CDS rejeita (HTTP 400, estado "rejected") o pedido que passa do limite de pedidos simultâneos da conta: espera e repete."""
    alvo.parent.mkdir(parents=True, exist_ok=True)
    parte = alvo.with_suffix(".parte")
    t = r = 0
    while t < tentativas and r < rejeicoes:
        try:
            _vez()
            cliente().retrieve(conjunto, {**pedido, "area": AREA, "data_format": "netcdf", "download_format": "unarchived"}, str(parte))
            parte.replace(alvo)
            return True
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            parte.unlink(missing_ok=True)
            baixo = msg.lower()
            if any(s in baixo for s in ("too large", "cost limits", "not available", "invalid", "none of the data", "no data",
                                         "may not be available", "reject")) and "400 client error" not in baixo:
                log(f"  recusado ({alvo.name}): {msg[:160]}")
                return False
            if "400 client error" in baixo:  # fila cheia: espera uma vaga
                r += 1
                time.sleep(120)
                continue
            t += 1
            log(f"  falha ({alvo.name}) tentativa {t}/{tentativas}: {msg[:120]}")
            time.sleep(30 * t)
    log(f"  desisti de {alvo.name}")
    return False


def mensal(ano: int) -> None:
    alvo = BRUTOS / "mensal" / f"{ano}.nc"
    if alvo.exists():
        return
    base = {"product_type": "monthly_averaged_reanalysis", "variable": MENSAL, "year": [str(ano)], "time": ["00:00"]}
    if pedir("reanalysis-era5-land-monthly-means", {**base, "month": [f"{m:02d}" for m in range(1, 13)]}, alvo):
        log(f"mensal {ano} ok")
        return
    # ano corrente (ou incompleto): um mês por vez, o que o CDS já publicou
    for m in range(1, 13):
        parc = BRUTOS / "mensal" / f"{ano}-{m:02d}.nc"
        if not parc.exists():
            if not pedir("reanalysis-era5-land-monthly-means", {**base, "month": [f"{m:02d}"]}, parc):
                break
    log(f"mensal {ano} (por mês)")


LIMITE_CUSTO = 400  # o CDS recusa pedido do conjunto diário com variáveis × dias acima disso


def blocos(ano: int, n_variaveis: int) -> list[list[int]]:
    """Meses consecutivos agrupados em pedidos que cabem no limite de custo (variáveis × dias do período)."""
    saida, atual, custo = [], [], 0
    for m in range(1, 13):
        d = calendar.monthrange(ano, m)[1] * n_variaveis
        if atual and custo + d > LIMITE_CUSTO:
            saida.append(atual)
            atual, custo = [], 0
        atual.append(m)
        custo += d
    return saida + [atual]


def diario(ano: int, nome: str, variaveis: list[str], estat: str, meses: list[int]) -> None:
    """Um pedido (um bloco de meses) do conjunto diário; o arquivo leva o primeiro mês do bloco no nome."""
    alvo = BRUTOS / "diario" / nome / f"{ano}-{meses[0]:02d}.nc"
    if alvo.exists():
        return
    pedido = {"variable": variaveis, "year": str(ano), "month": [f"{m:02d}" for m in meses], "day": [f"{d:02d}" for d in range(1, 32)],
              "daily_statistic": estat, "time_zone": "utc-03:00", "frequency": "1_hourly"}
    if pedir("derived-era5-land-daily-statistics", pedido, alvo):
        log(f"diário {nome} {ano} meses {meses[0]}-{meses[-1]} ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("partes", nargs="*", choices=["mensal", "diario"])
    ap.add_argument("--desde", type=int, default=1950)
    ap.add_argument("--ate", type=int, default=datetime.now().year)
    ap.add_argument("--conexoes", type=int, default=3)
    a = ap.parse_args()
    carregar_env()
    a.partes = a.partes or ["mensal", "diario"]
    anos =range(a.ate, a.desde - 1, -1)  # do mais recente ao mais antigo
    tarefas = []
    if "mensal" in a.partes:
        tarefas += [(mensal, (y,)) for y in anos]
    if "diario" in a.partes:
        # 1981 em diante primeiro (período do CHIRPS e da normal); os anos anteriores depois
        ordem = sorted(anos, key=lambda y: (y < 1981, -y))
        tarefas += [(diario, (y, nome, v, s, b)) for y in ordem for nome, v, s in DIARIO for b in blocos(y, len(v))]
    log(f"{len(tarefas)} pedidos, {a.conexoes} conexões")
    with ThreadPoolExecutor(a.conexoes) as ex:
        for f in [ex.submit(fn, *args) for fn, args in tarefas]:
            f.result()
    log("fim")


if __name__ == "__main__":
    main()
