"""Lista as contas do plano de contas que ainda não têm tradução para o inglês no site.

Uso: py pipeline/contas_sem_traducao.py
As traduções ficam em web/src/traducoes/contas.en.json (descrição em português -> inglês).
"""
import json
from pathlib import Path

import duckdb

from config import SILVER

RAIZ = Path(__file__).resolve().parent.parent
CONTAS = SILVER / 'contas'
TRADUCOES = RAIZ / 'web' / 'src' / 'traducoes' / 'contas.en.json'


def main():
    traduzidas = json.loads(TRADUCOES.read_text(encoding='utf-8'))
    linhas = duckdb.connect().execute(
        f"SELECT DISTINCT anexo, descricao FROM '{CONTAS.as_posix()}/*.parquet' ORDER BY anexo, descricao"
    ).fetchall()
    faltam = [(anexo, d) for anexo, d in linhas if d not in traduzidas]
    for anexo, d in faltam:
        print(f'{anexo}\t{d}')
    print(f'{len(faltam)} de {len(linhas)} contas sem tradução')


if __name__ == '__main__':
    main()
