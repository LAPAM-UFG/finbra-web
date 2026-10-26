"""Extração do RREO e do RGF (fechamento do ano) pela API SICONFI → data/landing.

Por ente e exercício, duas chamadas:
  RREO  6º bimestre (valores acumulados do ano), todos os anexos que a API publica
        (os anexos 8, educação, e 12, saúde, vêm do SIOPE e do SIOPS e não estão na API)
  RGF   último período do Poder Executivo: 3º quadrimestre ou, para quem publica por
        semestre, 2º semestre
Municípios pequenos podem entregar as versões simplificadas (RREO Simplificado, RGF Simplificado),
que a API trata como outro tipo de demonstrativo; as variantes são tentadas em ordem (VARIANTES) e a
usada fica gravada em cada linha (tipo_demonstrativo).

A API só tem esses relatórios a partir de 2015 e só aceita um ente por chamada; com o limite
de 1 req/s, cada exercício leva ~3,5 h. A execução é retomável: cada resposta é gravada num
arquivo próprio (inclusive as vazias, de quem não entregou) e as já baixadas são puladas.

Uso:
    py pipeline/extract_lrf.py                              # 2015 até o ano anterior
    py pipeline/extract_lrf.py --anos 2024 2025 --atualizar  # rebaixa (retificações)
    py pipeline/extract_lrf.py --anos 2024 --uf GO           # amostra rápida
    py pipeline/extract_lrf.py --anos 2024 2025 --faltantes  # atualização mensal: só quem falta na silver
"""
import argparse
import gzip
import json
import logging
import sys
import time
from datetime import datetime, timezone

from config import ESFERAS, LANDING, LOGS, SILVER, UF_POR_CODIGO
from extract import ClienteSiconfi, gravar_ndjson_gz, parse_anos

log = logging.getLogger("extract_lrf")

PRIMEIRO_ANO_LRF = 2015


def arquivo(relatorio, ano, cod_ibge):
    return LANDING / relatorio / f"exercicio={ano}" / f"{cod_ibge}.ndjson.gz"


def carregar_entes(cliente, esferas):
    """Lista de entes já gravada pelo extract.py; baixa de novo só se não existir."""
    caminho = LANDING / "entes.ndjson.gz"
    if caminho.exists():
        with gzip.open(caminho, "rt", encoding="utf-8") as f:
            itens = [json.loads(linha) for linha in f]
    else:
        itens = cliente.paginado("entes")
        gravar_ndjson_gz(caminho, itens)
    return sorted((e for e in itens if e["esfera"] in esferas), key=lambda e: e["cod_ibge"])


# Variantes do fechamento do ano, na ordem em que são tentadas. Municípios com menos de 50 mil
# habitantes podem publicar as versões simplificadas (e o RGF por semestre).
VARIANTES = {
    "rreo": [dict(nr_periodo=6, co_tipo_demonstrativo="RREO"),
             dict(nr_periodo=6, co_tipo_demonstrativo="RREO Simplificado")],
    "rgf": [dict(in_periodicidade="Q", nr_periodo=3, co_tipo_demonstrativo="RGF", co_poder="E"),
            dict(in_periodicidade="S", nr_periodo=2, co_tipo_demonstrativo="RGF Simplificado", co_poder="E"),
            dict(in_periodicidade="S", nr_periodo=2, co_tipo_demonstrativo="RGF", co_poder="E"),
            dict(in_periodicidade="Q", nr_periodo=3, co_tipo_demonstrativo="RGF Simplificado", co_poder="E")],
}
# variante que deu certo por (relatório, ente): nos anos seguintes ela é tentada primeiro
ultima_variante = {}


def baixar(cliente, relatorio, ano, ente):
    """Itens do fechamento do ano, com o tipo de demonstrativo e a periodicidade gravados em cada um."""
    variantes = VARIANTES[relatorio]
    preferida = ultima_variante.get((relatorio, ente), 0)
    for i in [preferida] + [j for j in range(len(variantes)) if j != preferida]:
        v = variantes[i]
        itens = cliente.paginado(relatorio, an_exercicio=ano, id_ente=ente, **v)
        if itens:
            ultima_variante[(relatorio, ente)] = i
            for item in itens:
                item.setdefault("demonstrativo", v["co_tipo_demonstrativo"])
                item["tipo_demonstrativo"] = v["co_tipo_demonstrativo"]
            return itens
    return []


def ja_na_silver(ano):
    """{(relatório, ente)} que já têm linhas em silver/lrf (vindas do R2 na atualização mensal)."""
    caminho = SILVER / "lrf" / f"exercicio={ano}.parquet"
    if not caminho.exists():
        return set()
    import duckdb
    linhas = duckdb.connect().execute(
        f"SELECT DISTINCT lower(relatorio), cod_ibge FROM '{caminho.as_posix()}'").fetchall()
    return {(r, int(c)) for r, c in linhas}


def extrair_ano(cliente, ano, entes, atualizar, faltantes=False):
    presentes = ja_na_silver(ano) if faltantes else set()
    for relatorio in ("rreo", "rgf"):
        pendentes = [e for e in entes if atualizar or not (arquivo(relatorio, ano, e["cod_ibge"]).exists()
                                                           or (relatorio, e["cod_ibge"]) in presentes)]
        log.info("%s %s: %s entes pendentes de %s", relatorio.upper(), ano, len(pendentes), len(entes))
        inicio, vazios = time.monotonic(), 0
        for i, ente in enumerate(pendentes, 1):
            itens = baixar(cliente, relatorio, ano, ente["cod_ibge"])
            vazios += not itens
            gravar_ndjson_gz(arquivo(relatorio, ano, ente["cod_ibge"]), itens)
            if i % 200 == 0 or i == len(pendentes):
                ritmo = (time.monotonic() - inicio) / i
                log.info("  %s %s: %s/%s (%s sem dados) | restam ~%.0f min", relatorio.upper(), ano,
                         i, len(pendentes), vazios, ritmo * (len(pendentes) - i) / 60)


def main():
    ano_atual = datetime.now(timezone.utc).year
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--anos", nargs="+", default=[f"{PRIMEIRO_ANO_LRF}-{ano_atual - 1}"])
    p.add_argument("--entes", nargs="+", type=int, help="códigos IBGE (padrão: todos)")
    p.add_argument("--uf", nargs="+", help="só os entes destas UFs (ex.: PR SC)")
    p.add_argument("--esferas", default="".join(ESFERAS), help="M, E, D (padrão: MED)")
    p.add_argument("--atualizar", action="store_true", help="rebaixa mesmo se já existir")
    p.add_argument("--faltantes", action="store_true",
                   help="só os entes sem o relatório em silver/lrf (atualização mensal, sem a landing local)")
    args = p.parse_args()

    LOGS.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(sys.stdout),
                                  logging.FileHandler(LOGS / "extract_lrf.log", encoding="utf-8")])

    cliente = ClienteSiconfi()
    entes = carregar_entes(cliente, set(args.esferas.upper()))
    if args.entes:
        entes = [e for e in entes if e["cod_ibge"] in set(args.entes)]
    if args.uf:
        ufs = {u.upper() for u in args.uf}
        entes = [e for e in entes if UF_POR_CODIGO.get(e["cod_ibge"], e["uf"]) in ufs]
    for ano in parse_anos(args.anos):
        if ano >= PRIMEIRO_ANO_LRF:
            extrair_ano(cliente, ano, entes, args.atualizar, args.faltantes)
    log.info("Extração concluída.")


if __name__ == "__main__":
    main()
