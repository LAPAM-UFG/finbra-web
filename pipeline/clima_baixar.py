"""Baixa os dados brutos do painel de clima para o HD externo (E:/finbra/brutos/clima).

  chirps/   chuva mensal CHIRPS v3 (UCSB/CHC), grade de 0,05° para a América Latina, 1981 até o último mês publicado
  malha/    malha municipal do IBGE (BR_Municipios_2022.zip), para agregar as grades por município

Retoma de onde parou: arquivo já baixado com o tamanho certo é pulado.
Uso: python pipeline/clima_baixar.py [--so-malha] [--so-chirps]
"""
import argparse
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

BRUTOS = Path(os.environ.get("CLIMA_BRUTOS", "E:/finbra/brutos/clima"))
CHIRPS = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/latam/tifs/"
MALHA = "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Brasil/BR/BR_Municipios_2022.zip"


def baixar(url: str, destino: Path) -> str:
    destino.parent.mkdir(parents=True, exist_ok=True)
    for tentativa in range(6):
        try:
            tam = int(requests.head(url, allow_redirects=True, timeout=60).headers.get("content-length", 0))
            if tam and destino.exists() and destino.stat().st_size == tam:
                return "pulado"
            tmp = destino.with_suffix(destino.suffix + ".parte")
            with requests.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                with open(tmp, "wb") as f:
                    for bloco in r.iter_content(1 << 20):
                        f.write(bloco)
            if tam and tmp.stat().st_size != tam:
                raise OSError(f"tamanho {tmp.stat().st_size} != {tam}")
            tmp.replace(destino)
            return "baixado"
        except (requests.RequestException, OSError) as e:
            erro = str(e)[:80]
            time.sleep(10 * (tentativa + 1))
    return f"ERRO {erro}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--so-malha", action="store_true")
    ap.add_argument("--so-chirps", action="store_true")
    a = ap.parse_args()
    if not a.so_chirps:
        print("malha:", baixar(MALHA, BRUTOS / "malha" / "BR_Municipios_2022.zip"), flush=True)
    if not a.so_malha:
        html = requests.get(CHIRPS, timeout=60).text
        nomes = sorted(set(re.findall(r'href="(chirps-v3\.0\.\d{4}\.\d{2}\.tif)"', html)))
        print(f"CHIRPS: {len(nomes)} arquivos ({nomes[0]} a {nomes[-1]})", flush=True)
        with ThreadPoolExecutor(2) as ex:
            res = list(ex.map(lambda n: (n, baixar(CHIRPS + n, BRUTOS / "chirps" / n)), nomes))
        erros = [(n, r) for n, r in res if r.startswith("ERRO")]
        print(f"CHIRPS: {sum(r == 'baixado' for _, r in res)} baixados, {sum(r == 'pulado' for _, r in res)} já havia, {len(erros)} com erro", flush=True)
        for n, r in erros:
            print("  ", n, r)
        if erros:
            sys.exit(1)


if __name__ == "__main__":
    main()
