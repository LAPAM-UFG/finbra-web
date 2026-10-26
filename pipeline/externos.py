"""Fontes complementares ao SICONFI → data/silver.

  ibge_pib.parquet       PIB e valor adicionado por setor (IBGE/SIDRA, tabela 5938)
  ipca.parquet           IPCA anual dez/dez (Banco Central, série SGS 433)

Bolsa Família e INSS vêm das fontes oficiais, em familias.py.

Uso:
    py pipeline/externos.py
"""
import time

import pandas as pd
import requests

try:  # o servidor do IBGE não envia o certificado intermediário; o repositório do SO resolve
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

from config import SILVER

SIDRA = "https://servicodados.ibge.gov.br/api/v3/agregados/5938"
VARIAVEIS_PIB = {  # mil reais
    "37": "pib", "543": "impostos_produtos", "498": "vab_total", "513": "vab_agropecuaria",
    "517": "vab_industria", "6575": "vab_servicos", "525": "vab_adm_publica",
}
BCB_IPCA = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.433/dados"


def get_json(url, **params):
    for tentativa in range(5):
        try:
            r = requests.get(url, params=params, timeout=300)
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            print(f"  falhou ({e}); nova tentativa")
            time.sleep(10 * (tentativa + 1))
    raise RuntimeError(url)


def pib():
    periodos = [p["id"] for p in get_json(f"{SIDRA}/periodos") if int(p["id"]) >= 2010]
    linhas = []
    for ano in periodos:  # um ano por chamada: ~39 mil valores
        dados = get_json(f"{SIDRA}/periodos/{ano}/variaveis/{'|'.join(VARIAVEIS_PIB)}",
                         localidades="N6[all]")
        for var in dados:
            nome = VARIAVEIS_PIB[var["id"]]
            for serie in var["resultados"][0]["series"]:
                valor = serie["serie"][ano]
                linhas.append((int(ano), int(serie["localidade"]["id"]), nome,
                               float(valor) * 1000 if valor not in ("-", "...", "X", None) else None))
        print(f"  PIB {ano} ok")
    df = (pd.DataFrame(linhas, columns=["exercicio", "cod_ibge", "variavel", "valor"])
          .pivot_table(index=["exercicio", "cod_ibge"], columns="variavel", values="valor").reset_index())
    df.columns.name = None
    return df


def ipca():
    serie = pd.DataFrame(get_json(BCB_IPCA, formato="json", dataInicial="01/01/2010"))
    serie["data"] = pd.to_datetime(serie["data"], dayfirst=True)
    serie["fator"] = 1 + serie["valor"].astype(float) / 100
    anual = serie.groupby(serie["data"].dt.year).agg(fator=("fator", "prod"), meses=("fator", "size"))
    anual = anual.reset_index(names="exercicio")
    anual["ipca_pct"] = (anual["fator"] - 1) * 100
    anual["completo"] = anual["meses"] == 12
    # índice acumulado (dez/2009 = 1): deflacionar para a base B é valor * indice[B] / indice[ano]
    anual["indice"] = anual["fator"].cumprod()
    return anual[["exercicio", "ipca_pct", "indice", "completo", "meses"]]


def main():
    SILVER.mkdir(parents=True, exist_ok=True)

    for nome, funcao, arquivo in (("IPCA (Banco Central)", ipca, "ipca.parquet"),
                                  ("PIB municipal (IBGE)", pib, "ibge_pib.parquet")):
        print(f"{nome}...")
        try:
            funcao().to_parquet(SILVER / arquivo, index=False)
        except Exception as e:  # fonte fora do ar: mantém a versão anterior, se houver
            if not (SILVER / arquivo).exists():
                raise
            print(f"  AVISO: {nome} indisponível ({e}); mantido o {arquivo} anterior.")
    print("ok")


if __name__ == "__main__":
    main()
