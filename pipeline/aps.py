"""Atenção primária (relatórios públicos da APS, Ministério da Saúde): cobertura por município e mês.

A API pública de relatorioaps.saude.gov.br (a mesma que o site consulta, sem login) devolve, por município e competência:
    cobertura/ab   cobertura da atenção básica, metodologia antiga (jan/2008 a dez/2020)
    cobertura/aps  cobertura da atenção primária, metodologia atual (jan/2021 em diante; só há dados até o fechamento)
    cobertura/acs  cobertura de agentes comunitários de saúde (jan/2008 em diante)
As séries ab e aps NÃO são comparáveis (a portaria mudou o cálculo da população coberta e a capacidade das equipes).

Baixa um mês de cada vez (todos os municípios numa só chamada), grava o JSON bruto em --brutos (padrão: SAUDE_BRUTOS/aps ou
E:/finbra/brutos/saude/aps) e só repete o que falta. Os meses sem dados (o fechamento ainda não saiu) ficam de fora.

Uso:
    py pipeline/aps.py baixar                       # as três séries
    py pipeline/aps.py baixar --series aps --de 202401 --ate 202412
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://relatorioaps-prd.saude.gov.br"
SERIES = {"ab": (200801, 202012), "aps": (202101, 203012), "acs": (200801, 203012)}


def meses(de: int, ate: int):
    a, m = divmod(de, 100)
    fim_a, fim_m = divmod(ate, 100)
    while (a, m) <= (fim_a, fim_m):
        yield a * 100 + m
        m += 1
        if m > 12:
            a, m = a + 1, 1


def pedir(serie: str, comp: int, tentativas: int = 6) -> list:
    url = f"{API}/cobertura/{serie}?" + urllib.parse.urlencode(
        {"unidadeGeografica": "MUNICIPIO", "nuCompInicio": comp, "nuCompFim": comp})
    for t in range(tentativas):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "lapam-finbra"}), timeout=180) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if t == tentativas - 1:
                raise RuntimeError(f"{serie} {comp}: {e}") from e
            time.sleep(min(10 * (t + 1), 60))
    return []


def baixar(brutos: Path, series: list[str], de: int | None, ate: int | None):
    ja, novos, vazios = 0, 0, 0
    for serie in series:
        ini, fim = SERIES[serie]
        ini, fim = max(ini, de or ini), min(fim, ate or fim)
        vazios_seguidos = 0
        for comp in meses(ini, fim):
            destino = brutos / serie / f"{comp}.json"
            if destino.exists():
                ja += 1
                continue
            dados = pedir(serie, comp)
            if not dados:
                vazios += 1
                vazios_seguidos += 1
                if vazios_seguidos >= 3 and fim >= 203000:  # passou do último mês fechado
                    break
                continue
            vazios_seguidos = 0
            destino.parent.mkdir(parents=True, exist_ok=True)
            parcial = destino.with_suffix(".tmp")
            parcial.write_text(json.dumps(dados, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            parcial.replace(destino)
            novos += 1
            print(f"{serie} {comp}: {len(dados)} municípios", flush=True)
    print(f"concluído: {novos} baixados, {ja} já existiam, {vazios} sem dados")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("acao", choices=["baixar"])
    p.add_argument("--brutos", default=str(Path(os.environ.get("SAUDE_BRUTOS", "E:/finbra/brutos/saude")) / "aps"))
    p.add_argument("--series", nargs="+", choices=list(SERIES), default=list(SERIES))
    p.add_argument("--de", type=int, help="AAAAMM")
    p.add_argument("--ate", type=int, help="AAAAMM")
    a = p.parse_args()
    baixar(Path(a.brutos), a.series, a.de, a.ate)


if __name__ == "__main__":
    sys.exit(main())
