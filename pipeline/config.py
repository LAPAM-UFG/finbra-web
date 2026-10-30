import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# no computador do laboratório os dados ficam no HD externo (DATA_DIR=E:/finbra/data); no GitHub, em data/
DATA = Path(os.environ.get("DATA_DIR") or ROOT / "data")
LANDING = DATA / "landing"   # respostas cruas da API (ndjson.gz), fora do git
BRONZE = DATA / "bronze"     # Parquet fiel à fonte, um arquivo por exercício
SILVER = DATA / "silver"     # normalizado + hierarquia de contas
GOLD = DATA / "gold"         # agregados consumidos pelo site
LOGS = DATA / "logs"

API_BASE = "https://apidatalake.tesouro.gov.br/ords/siconfi/tt"
INTERVALO_MIN = 1.05         # a API aceita no máximo 1 requisição por segundo
PRIMEIRO_ANO = 2013
ESFERAS = ("M", "E", "D")    # municípios, estados e DF (a União fica de fora)

# UF dos estados e do DF pelo código IBGE (a lista /entes da API traz "BR" para eles)
UF_POR_CODIGO = {
    11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE",
    24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP",
    41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF",
}
