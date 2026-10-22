"""Extração da DCA (anexos I-AB a I-HI) pela API SICONFI → data/landing.

Uma chamada /dca por ente e exercício traz os 7 anexos. Com o limite de 1 req/s,
cada exercício leva ~1h45 para todos os entes. A execução é retomável: cada ente
é gravado num arquivo próprio (escrita atômica) e os já baixados são pulados.

Uso:
    py pipeline/extract.py --anos 2013-2025
    py pipeline/extract.py --anos 2024 2025 --atualizar        # rebaixa (retificações)
    py pipeline/extract.py --anos 2022 --entes 4106902 3550308
    py pipeline/extract.py --anos 2024 2025 --uf PR                # amostra rápida (~7 min por ano)
"""
import argparse
import gzip
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

import requests

from config import API_BASE, ESFERAS, INTERVALO_MIN, LANDING, LOGS, PRIMEIRO_ANO, UF_POR_CODIGO

log = logging.getLogger("extract")


class ClienteSiconfi:
    """GET com limite de taxa, novas tentativas com espera exponencial e paginação."""

    def __init__(self):
        self.sessao = requests.Session()
        self.sessao.headers["User-Agent"] = "lapam-finbra-pipeline"
        self._ultima = 0.0

    def get(self, endpoint, **params):
        erro = None
        for tentativa in range(8):
            espera = self._ultima + INTERVALO_MIN - time.monotonic()
            if espera > 0:
                time.sleep(espera)
            self._ultima = time.monotonic()
            try:
                r = self.sessao.get(f"{API_BASE}/{endpoint}", params=params, timeout=180)
                if r.status_code == 200:
                    return r.json()
                erro = f"HTTP {r.status_code}: {r.text[:200]}"
                if 400 <= r.status_code < 500 and r.status_code != 429:
                    break  # erro de requisição: repetir não resolve
            except (requests.RequestException, ValueError) as e:
                erro = repr(e)
            pausa = min(300, 5 * 2 ** tentativa)
            log.warning("%s %s falhou (%s); nova tentativa em %ss", endpoint, params, erro, pausa)
            time.sleep(pausa)
        raise RuntimeError(f"{endpoint} {params}: {erro}")

    def paginado(self, endpoint, **params):
        itens, offset = [], 0
        while True:
            pagina = self.get(endpoint, offset=offset, **params)
            itens += pagina["items"]
            if not pagina.get("hasMore"):
                return itens
            offset += pagina["limit"]


def gravar_ndjson_gz(caminho, itens):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(caminho.suffix + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        for item in itens:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")
    os.replace(tmp, caminho)


def carregar_entes(cliente, esferas):
    itens = cliente.paginado("entes")
    gravar_ndjson_gz(LANDING / "entes.ndjson.gz", itens)
    return sorted((e for e in itens if e["esfera"] in esferas), key=lambda e: e["cod_ibge"])


def arquivo_dca(ano, cod_ibge):
    return LANDING / "dca" / f"exercicio={ano}" / f"{cod_ibge}.ndjson.gz"


def extrair_ano(cliente, ano, entes, atualizar):
    pendentes = [e for e in entes if atualizar or not arquivo_dca(ano, e["cod_ibge"]).exists()]
    log.info("Exercício %s: %s entes pendentes de %s", ano, len(pendentes), len(entes))
    inicio, vazios = time.monotonic(), 0
    for i, ente in enumerate(pendentes, 1):
        itens = cliente.paginado("dca", an_exercicio=ano, id_ente=ente["cod_ibge"])
        vazios += not itens
        gravar_ndjson_gz(arquivo_dca(ano, ente["cod_ibge"]), itens)
        if i % 100 == 0 or i == len(pendentes):
            ritmo = (time.monotonic() - inicio) / i
            log.info("  %s: %s/%s (%s sem dados) | restam ~%.0f min",
                     ano, i, len(pendentes), vazios, ritmo * (len(pendentes) - i) / 60)


def parse_anos(valores):
    anos = set()
    for v in valores:
        a, _, b = v.partition("-")
        anos.update(range(int(a), int(b or a) + 1))
    return sorted(anos, reverse=True)  # mais recentes primeiro


def main():
    ano_atual = datetime.now(timezone.utc).year
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--anos", nargs="+", default=[f"{PRIMEIRO_ANO}-{ano_atual - 1}"])
    p.add_argument("--entes", nargs="+", type=int, help="códigos IBGE (padrão: todos)")
    p.add_argument("--uf", nargs="+", help="só os entes destas UFs (ex.: PR SC)")
    p.add_argument("--esferas", default="".join(ESFERAS), help="M, E, D (padrão: MED)")
    p.add_argument("--atualizar", action="store_true", help="rebaixa mesmo se já existir")
    args = p.parse_args()

    LOGS.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(sys.stdout),
                                  logging.FileHandler(LOGS / "extract.log", encoding="utf-8")])

    cliente = ClienteSiconfi()
    entes = carregar_entes(cliente, set(args.esferas.upper()))
    if args.entes:
        entes = [e for e in entes if e["cod_ibge"] in set(args.entes)]
    if args.uf:
        ufs = {u.upper() for u in args.uf}
        entes = [e for e in entes if UF_POR_CODIGO.get(e["cod_ibge"], e["uf"]) in ufs]
    for ano in parse_anos(args.anos):
        extrair_ano(cliente, ano, entes, args.atualizar)
    log.info("Extração concluída.")


if __name__ == "__main__":
    main()
