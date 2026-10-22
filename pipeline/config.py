from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
LANDING = DATA / "landing"   # respostas cruas da API (ndjson.gz), fora do git
BRONZE = DATA / "bronze"     # Parquet fiel à fonte, um arquivo por exercício
SILVER = DATA / "silver"     # normalizado + hierarquia de contas
GOLD = DATA / "gold"         # agregados consumidos pelo site
LOGS = DATA / "logs"

API_BASE = "https://apidatalake.tesouro.gov.br/ords/siconfi/tt"
INTERVALO_MIN = 1.05         # a API aceita no máximo 1 requisição por segundo
PRIMEIRO_ANO = 2013
ESFERAS = ("M", "E", "D")    # municípios, estados e DF (a União fica de fora)
