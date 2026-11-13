"""Baixa o ERA5-Land (Copernicus CDS) para o Brasil: médias mensais e estatísticas diárias, em NetCDF.

Saída (HD externo): E:/finbra/brutos/clima/era5/mensal/AAAA.nc e, em diario/<media|tmax|tmin>/, AAAA-MM.nc (MM = primeiro mês do
bloco de meses de cada pedido: o limite de custo do CDS obriga a repartir o ano). A pasta media traz temperatura, orvalho, umidade
do solo e vento u e v (o CDS entrega um ZIP de NetCDF mesmo com a extensão .nc: quem lê precisa detectar o formato).

Retomável sem congelar o período aberto. Cada arquivo tem um registro AAAA.nc.json ao lado (identidade do pedido, meses que o
arquivo traz e data do download):
  - ausente                                   -> baixa;
  - pedido diferente do registrado             -> baixa (outro conjunto, variáveis, área ou formato);
  - período aberto (últimos JANELA_PRELIMINAR meses, ERA5T preliminar, ou meses que o CDS ainda não publicou)
                                               -> baixa de novo para conferir meses novos e revisões;
  - fechado e igual                            -> pula;
  - arquivo antigo sem registro (legado)       -> pula só se fechado e com todos os meses pedidos; senão baixa.
O download novo vai para AAAA.nc.novo, é validado (formato, meses pedidos e fechados presentes, nenhum mês a menos que o arquivo
atual) e só então troca o atual, que fica guardado como AAAA.nc.anterior-AAAAMMDD. Se a validação ou o download falhar, o arquivo
atual não é tocado. Se o conteúdo novo for idêntico (SHA-256), nada é trocado.

Credenciais: CDSAPI_URL e CDSAPI_KEY no .env (conta gratuita no Climate Data Store, licença do ERA5-Land aceita).
Os valores do mensal são as médias do dia (acumulados em "por dia"); a conversão para unidades finais fica em clima.py.

Defeito conhecido do produto mensal (documentado pelo ECMWF, sem republicação): de 09/2022 a 02/2024 os acumulados (evaporação e
radiação) vêm com cerca de 37% do valor. Para recuperá-los, use o produto monthly_averaged_reanalysis_by_hour_of_day às 00h SÓ para
total_evaporation e surface_solar_radiation_downwards nesses meses, em pasta separada (não troque o MENSAL global: as demais
variáveis passariam a ser a média de um horário). Essa recuperação é feita à parte; este script não a faz.

Uso: python clima_era5.py [mensal] [diario] [--desde 1950] [--ate 2026] [--conexoes 3]
"""
import argparse
import calendar
import hashlib
import json
import os
import shutil
import tempfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
BRUTOS = Path(os.environ.get("CLIMA_BRUTOS", "E:/finbra/brutos/clima")) / "era5"
AREA = [6, -74, -34, -28]  # N, O, S, L: Brasil inclusive Fernando de Noronha e Trindade
JANELA_PRELIMINAR = 4  # meses: o que ficou dentro desta janela (ou no futuro) é preliminar e é conferido a cada execução

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


def completar(pedido: dict) -> dict:
    """O pedido como vai ao CDS (e como entra na identidade do arquivo)."""
    return {**pedido, "area": AREA, "data_format": "netcdf", "download_format": "unarchived"}


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
            cliente().retrieve(conjunto, completar(pedido), str(parte))
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


# ---------------- cache com identidade, período aberto e troca segura ----------------

def identidade(conjunto: str, pedido: dict) -> str:
    """Impressão digital do pedido completo: mudar conjunto, variáveis, meses, área ou formato muda a identidade."""
    canon = json.dumps({"conjunto": conjunto, "pedido": completar(pedido)}, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()


def meses_do_pedido(pedido: dict) -> list[tuple[int, int]]:
    anos = pedido["year"] if isinstance(pedido["year"], list) else [pedido["year"]]
    return [(int(a), int(m)) for a in anos for m in pedido["month"]]


def _indice(ano: int, mes: int) -> int:
    return ano * 12 + mes - 1


def periodo_aberto(meses: list[tuple[int, int]], hoje: date | None = None, janela: int = JANELA_PRELIMINAR) -> bool:
    """Algum mês pedido está nos últimos `janela` meses (preliminares) ou ainda não aconteceu."""
    hoje = hoje or date.today()
    limite = _indice(hoje.year, hoje.month) - janela
    return any(_indice(a, m) >= limite for a, m in meses)


# nomes curtos do arquivo NetCDF para cada variável do pedido ao CDS (o arquivo pode trazer o nome curto ou o longo)
NOMES_CURTOS = {
    "2m_temperature": "t2m", "2m_dewpoint_temperature": "d2m", "volumetric_soil_water_layer_1": "swvl1", "total_evaporation": "e",
    "potential_evaporation": "pev", "surface_solar_radiation_downwards": "ssrd", "10m_u_component_of_wind": "u10", "10m_v_component_of_wind": "v10",
}


def nome_canonico(nome: str) -> str:
    n = str(nome).strip().lower()
    return NOMES_CURTOS.get(n, n)


def variaveis_pedidas(pedido: dict) -> set[str]:
    v = pedido["variable"]
    return {nome_canonico(x) for x in ([v] if isinstance(v, str) else v)}


def eh_diario(pedido: dict) -> bool:
    return "day" in pedido or "daily_statistic" in pedido


def datas_pedidas(pedido: dict) -> set[date]:
    """Datas que o pedido pode devolver: diário = cada dia válido pelo calendário (dia 31 de abril não existe); mensal = o dia 1 de cada mês."""
    if not eh_diario(pedido):
        return {date(a, m, 1) for a, m in meses_do_pedido(pedido)}
    dias = pedido["day"] if isinstance(pedido["day"], list) else [pedido["day"]]
    saida: set[date] = set()
    for a, m in meses_do_pedido(pedido):
        ultimo = calendar.monthrange(a, m)[1]
        saida |= {date(a, m, int(d)) for d in dias if 1 <= int(d) <= ultimo}
    return saida


def _chave(d: date, diario: bool):
    return d if diario else (d.year, d.month)


def _fechado(d: date, hoje: date) -> bool:
    return _indice(d.year, d.month) < _indice(hoje.year, hoje.month) - JANELA_PRELIMINAR


def _nome_seguro(nome: str, i: int) -> str | None:
    base = Path(str(nome).replace("\\", "/")).name
    if base in ("", ".", "..") or not base.lower().endswith(".nc"):
        return None
    return f"{i}_{''.join(c if c.isalnum() or c in '._-' else '_' for c in base)}"


def _ler_metadados(caminho: Path, dados: dict, grades: list) -> None:
    import pandas as pd
    import xarray as xr
    with xr.open_dataset(caminho) as ds:
        eixo = next((c for c in ("valid_time", "time") if c in ds.coords), None)
        if eixo is None:
            raise ValueError("sem eixo de tempo")
        lat = next((c for c in ("latitude", "lat") if c in ds.coords), None)
        lon = next((c for c in ("longitude", "lon") if c in ds.coords), None)
        if lat is None or lon is None or ds[lat].size == 0 or ds[lon].size == 0:
            raise ValueError("sem coordenadas de latitude/longitude")
        grades.append((int(ds[lat].size), int(ds[lon].size)))
        datas = {t.date() for t in pd.to_datetime(ds[eixo].values)}  # só a coordenada de tempo: nenhum array de dados é lido
        for nome, var in ds.data_vars.items():
            if eixo in var.dims and {lat, lon} <= set(var.dims):
                dados.setdefault(nome_canonico(nome), set()).update(datas)


def inspecionar(caminho: Path) -> dict | None:
    """Metadados de um NetCDF ou de um ZIP com VÁRIOS NetCDF (o CDS entrega ZIP no diário): {'vars': {nome_curto: {datas}}, 'grade': (nlat, nlon)}.
    Lê todos os membros e todas as variáveis, só as coordenadas; os membros são extraídos com o nome-base (sem caminhos) em temporário.
    None se algo não puder ser lido, faltar coordenada ou os membros tiverem grades diferentes."""
    dados: dict[str, set[date]] = {}
    grades: list = []
    try:
        if zipfile.is_zipfile(caminho):
            with zipfile.ZipFile(caminho) as z, tempfile.TemporaryDirectory() as tmp:
                lidos = 0
                for i, info in enumerate(z.infolist()):
                    nome = _nome_seguro(info.filename, i)
                    if nome is None or info.is_dir():
                        continue
                    alvo = Path(tmp) / nome
                    with z.open(info) as origem, alvo.open("wb") as destino:
                        shutil.copyfileobj(origem, destino)
                    _ler_metadados(alvo, dados, grades)
                    alvo.unlink()
                    lidos += 1
                if not lidos:
                    return None
        else:
            _ler_metadados(Path(caminho), dados, grades)
    except Exception:  # noqa: BLE001 - ilegível, truncado, sem coordenadas
        return None
    if not dados or len(set(grades)) != 1:
        return None
    return {"vars": dados, "grade": grades[0]}


def meses_do_arquivo(caminho: Path) -> set[tuple[int, int]] | None:
    """Meses com dado em TODAS as variáveis do arquivo (interseção); None se ilegível."""
    insp = inspecionar(caminho)
    if insp is None:
        return None
    conjuntos = [{(d.year, d.month) for d in ds} for ds in insp["vars"].values()]
    return set.intersection(*conjuntos)


def problemas_de_cobertura(insp: dict, pedido: dict, hoje: date, exigir_fechado: bool = True) -> list[str]:
    """O arquivo traz, para CADA variável pedida, todas as datas fechadas do pedido e nada fora do pedido."""
    problemas: list[str] = []
    diario = eh_diario(pedido)
    esperadas = datas_pedidas(pedido)
    chaves_esperadas = {_chave(d, diario) for d in esperadas}
    fechadas = {_chave(d, diario) for d in esperadas if _fechado(d, hoje)}
    pedidas = variaveis_pedidas(pedido)
    faltam_vars = pedidas - set(insp["vars"])
    if faltam_vars:
        problemas.append(f"faltam variáveis pedidas: {sorted(faltam_vars)}")
    for v in sorted(pedidas & set(insp["vars"])):
        tem = {_chave(d, diario) for d in insp["vars"][v]}
        fora = tem - chaves_esperadas
        if fora:
            problemas.append(f"{v}: traz datas que não foram pedidas: {sorted(map(str, fora))[:3]}")
        if exigir_fechado:
            falta = fechadas - tem
            if falta:
                problemas.append(f"{v}: faltam {len(falta)} datas fechadas (ex.: {sorted(map(str, falta))[:3]})")
    return problemas


def registro_de(alvo: Path) -> Path:
    return alvo.with_name(alvo.name + ".json")


def ler_registro(alvo: Path) -> dict | None:
    try:
        return json.loads(registro_de(alvo).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def sha(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def decidir(alvo: Path, conjunto: str, pedido: dict, hoje: date | None = None) -> tuple[str, str]:
    """('baixar' | 'manter', motivo). Não escreve nada. O registro só vale se o arquivo ainda for o que ele descreve (tamanho e SHA-256)."""
    if not alvo.exists():
        return "baixar", "ausente"
    hoje = hoje or date.today()
    aberto = periodo_aberto(meses_do_pedido(pedido), hoje)
    reg = ler_registro(alvo)
    if reg is not None:
        if reg.get("identidade") != identidade(conjunto, pedido):
            return "baixar", "o pedido mudou (conjunto, variáveis, meses, área ou formato)"
        if reg.get("bytes") != alvo.stat().st_size or reg.get("sha256") != sha(alvo):
            return "baixar", "o arquivo diverge do registro (truncado ou alterado)"
        return ("baixar", "período aberto: conferir meses novos e revisões") if aberto else ("manter", "fechado e idêntico ao registrado")
    # arquivo antigo, sem registro: a identidade é desconhecida
    if aberto:
        return "baixar", "arquivo sem registro e período aberto"
    insp = inspecionar(alvo)
    if insp is None:
        return "baixar", "arquivo ilegível"
    problemas = problemas_de_cobertura(insp, pedido, hoje)
    if problemas:
        return "baixar", f"arquivo sem registro e incompleto: {problemas[0]}"
    return "manter", "arquivo sem registro, fechado, com todas as variáveis e datas pedidas"


def validar_novo(novo: Path, antigo: Path | None, pedido: dict, hoje: date | None = None) -> tuple[bool, str]:
    """O arquivo novo é legível, tem as coordenadas, TODAS as variáveis pedidas, todas as datas fechadas por variável, nada fora do pedido,
    a mesma grade do atual e nenhuma data (de nenhuma variável) a menos que o atual."""
    hoje = hoje or date.today()
    insp = inspecionar(novo)
    if insp is None:
        return False, "arquivo novo ilegível, vazio ou sem coordenadas"
    problemas = problemas_de_cobertura(insp, pedido, hoje)
    if problemas:
        return False, "; ".join(problemas[:3])
    if antigo is not None and antigo.exists():
        velho = inspecionar(antigo)
        if velho is not None:
            if velho["grade"] != insp["grade"]:
                return False, f"grade diferente da do arquivo atual: {insp['grade']} contra {velho['grade']}"
            for v, datas in velho["vars"].items():
                if v not in insp["vars"]:
                    return False, f"perderia a variável {v}, que o arquivo atual tem"
                perdidas = datas - insp["vars"][v]
                if perdidas:
                    return False, f"perderia {len(perdidas)} datas de {v} que o arquivo atual tem (ex.: {sorted(map(str, perdidas))[:3]})"
    return True, "ok"


def _gravar_registro(alvo: Path, conjunto: str, pedido: dict, hoje: date) -> None:
    insp = inspecionar(alvo) or {"vars": {}}
    reg = {"identidade": identidade(conjunto, pedido), "conjunto": conjunto, "pedido": completar(pedido), "sha256": sha(alvo),
           "bytes": alvo.stat().st_size, "variaveis": sorted(insp["vars"]),
           "meses": sorted({f"{d.year}-{d.month:02d}" for ds in insp["vars"].values() for d in ds}), "baixado_em": hoje.isoformat(),
           "periodo_aberto": periodo_aberto(meses_do_pedido(pedido), hoje)}
    parcial = registro_de(alvo).with_suffix(".json.parcial")
    parcial.write_text(json.dumps(reg, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(parcial, registro_de(alvo))


def baixar_seguro(conjunto: str, pedido: dict, alvo: Path, baixar=None, hoje: date | None = None) -> str:
    """Baixa para um arquivo temporário, valida e só então instala sobre `alvo`. O atual NUNCA é movido antes: o backup é uma CÓPIA
    (.anterior-AAAAMMDD) e a instalação é um único os.replace(novo, alvo); se falhar, o atual segue no lugar e o temporário é apagado.
    Devolve 'baixado', 'igual' (conteúdo idêntico, nada trocado), 'rejeitado: <motivo>' ou 'falhou'."""
    baixar = baixar or pedir
    hoje = hoje or date.today()
    novo = alvo.with_name(alvo.name + ".novo")
    novo.unlink(missing_ok=True)
    try:
        if not baixar(conjunto, pedido, novo):
            novo.unlink(missing_ok=True)
            return "falhou"
        ok, motivo = validar_novo(novo, alvo if alvo.exists() else None, pedido, hoje)
        if not ok:
            novo.unlink(missing_ok=True)
            return f"rejeitado: {motivo}"
        backup = None
        if alvo.exists():
            if sha(novo) == sha(alvo):
                novo.unlink(missing_ok=True)
                _gravar_registro(alvo, conjunto, pedido, hoje)
                return "igual"
            backup = alvo.with_name(f"{alvo.name}.anterior-{hoje:%Y%m%d}")
            n = 1
            while backup.exists():
                n += 1
                backup = alvo.with_name(f"{alvo.name}.anterior-{hoje:%Y%m%d}-{n}")
            shutil.copy2(alvo, backup)
        try:
            os.replace(novo, alvo)
        except OSError:
            novo.unlink(missing_ok=True)
            if backup is not None:
                backup.unlink(missing_ok=True)  # o atual nunca saiu do lugar: o backup é só uma cópia
            return "falhou"
    except Exception:  # noqa: BLE001 - qualquer erro inesperado: o atual fica, o temporário some
        novo.unlink(missing_ok=True)
        raise
    _gravar_registro(alvo, conjunto, pedido, hoje)
    return "baixado"


def obter(conjunto: str, pedido: dict, alvo: Path, baixar=None, hoje: date | None = None) -> str:
    """decidir() + baixar_seguro(): o que o mensal() e o diario() chamam."""
    acao, motivo = decidir(alvo, conjunto, pedido, hoje)
    if acao == "manter":
        return "mantido"
    status = baixar_seguro(conjunto, pedido, alvo, baixar, hoje)
    log(f"  {alvo.name}: {status} ({motivo})")
    return status


def mensal(ano: int, hoje: date | None = None) -> None:
    """Ano fechado: pede os 12 meses. Ano corrente: só meses encerrados; tenta do último mês encerrado para trás (o CDS publica com atraso e
    recusa o que ainda não existe) até uma tentativa válida; cada tentativa passa pela mesma validação e troca segura, e a falha de todas
    preserva o arquivo atual. Não há arquivos AAAA-MM.nc: um único AAAA.nc por ano."""
    hoje = hoje or date.today()
    if ano > hoje.year:
        return
    ultimo = 12 if ano < hoje.year else hoje.month - 1
    if ultimo < 1:  # janeiro: o ano corrente ainda não tem média de mês completo
        return
    base = {"product_type": "monthly_averaged_reanalysis", "variable": MENSAL, "year": [str(ano)], "time": ["00:00"]}
    alvo = BRUTOS / "mensal" / f"{ano}.nc"
    atual = max((m for a, m in (meses_do_arquivo(alvo) or set()) if a == ano), default=0) if alvo.exists() else 0
    for k in range(ultimo, max(atual, 1) - 1, -1):  # abaixo da cobertura atual não há o que ampliar
        pedido = {**base, "month": [f"{m:02d}" for m in range(1, k + 1)]}
        status = obter("reanalysis-era5-land-monthly-means", pedido, alvo, hoje=hoje)
        if status in ("baixado", "igual", "mantido"):
            if status != "mantido":
                log(f"mensal {ano} ok (até o mês {k})")
            return
        # recusado, falhou ou rejeitado: tenta um mês a menos (o mais recente pode não estar publicado)
    log(f"mensal {ano}: nenhuma tentativa válida; {'arquivo atual preservado' if alvo.exists() else 'sem arquivo'}")


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


def diario(ano: int, nome: str, variaveis: list[str], estat: str, meses: list[int], hoje: date | None = None) -> None:
    """Um pedido (um bloco de meses) do conjunto diário; o arquivo leva o primeiro mês do bloco no nome."""
    hoje = hoje or date.today()
    alvo = BRUTOS / "diario" / nome / f"{ano}-{meses[0]:02d}.nc"
    if ano == hoje.year:
        meses = [m for m in meses if m <= hoje.month]  # sem meses futuros no pedido
        if not meses:
            return
    pedido = {"variable": variaveis, "year": str(ano), "month": [f"{m:02d}" for m in meses], "day": [f"{d:02d}" for d in range(1, 32)],
              "daily_statistic": estat, "time_zone": "utc-03:00", "frequency": "1_hourly"}
    status = obter("derived-era5-land-daily-statistics", pedido, alvo, hoje=hoje)
    if status in ("baixado", "igual"):
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
    anos = range(a.ate, a.desde - 1, -1)  # do mais recente ao mais antigo
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
