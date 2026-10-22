"""Fontes complementares ao SICONFI → data/silver.

  ibge_pib.parquet       PIB e valor adicionado por setor (IBGE/SIDRA, tabela 5938)
  ipca.parquet           IPCA anual dez/dez (Banco Central, série SGS 433)
  pesquisa.parquet       painel estático da pesquisa LAPAM (.dta): área, distância,
                         região metropolitana, Bolsa Família, benefícios INSS, renda/Gini

Uso:
    py pipeline/externos.py
    py pipeline/externos.py --dta "E:/Estudos e Projetos/LAPAM/FINBRA/Revenue"
"""
import argparse
import time
from pathlib import Path

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


def pesquisa(pasta_dta):
    d = pd.read_stata(Path(pasta_dta) / "base_unificada_final.dta", convert_categoricals=False)
    colunas = {
        "mun": "cod_ibge6", "year": "exercicio", "área": "area_km2", "distance": "distancia_capital_km",
        "Metropolitan": "metropolitana", "Main_Activity": "atividade_principal",
        "n_of_families": "bolsa_familia_familias", "total_value": "bolsa_familia_valor",
        "TotaldeAposentadorias": "inss_aposentadorias", "pension": "inss_pensoes",
        "assistance": "inss_assistenciais", "total": "inss_beneficios",
        "n_workers": "trabalhadores_amostra", "income_hour": "renda_hora", "gini": "gini",
    }
    d = d[list(colunas)].rename(columns=colunas)
    d = d[d["exercicio"].between(2013, 2022) & d["cod_ibge6"].notna()].copy()
    d["exercicio"] = d["exercicio"].astype(int)
    d["cod_ibge6"] = d["cod_ibge6"].astype(int)
    return d


def pesquisa_vazia():
    inteiros = {"cod_ibge6": "int64", "exercicio": "int64"}
    texto = {"atividade_principal": "object"}
    reais = ["area_km2", "distancia_capital_km", "metropolitana", "bolsa_familia_familias", "bolsa_familia_valor",
             "inss_aposentadorias", "inss_pensoes", "inss_assistenciais", "inss_beneficios",
             "trabalhadores_amostra", "renda_hora", "gini"]
    tipos = {**inteiros, **texto, **{c: "float64" for c in reais}}
    return pd.DataFrame({c: pd.Series(dtype=t) for c, t in tipos.items()})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dta", help="pasta com base_unificada_final.dta (opcional)")
    args = p.parse_args()
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
    if args.dta:
        print("Painel de pesquisa (.dta)...")
        pesquisa(args.dta).to_parquet(SILVER / "pesquisa.parquet", index=False)
    elif not (SILVER / "pesquisa.parquet").exists():
        # sem os .dta (não estão no repositório): tabela vazia, as colunas ficam nulas no site
        print("Painel de pesquisa ausente: criando tabela vazia.")
        pesquisa_vazia().to_parquet(SILVER / "pesquisa.parquet", index=False)
    print("ok")


if __name__ == "__main__":
    main()
