"""Roda as camadas depois da extração: bronze → silver → externos → gold → validação.

Uso:
    py pipeline/processar.py
    py pipeline/processar.py --anos 2024 2025 --sem-externos
    py pipeline/processar.py --dta "E:/.../FINBRA/Revenue"   # inclui o painel de pesquisa
"""
import argparse
import os
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def rodar(script, *args):
    print(f"\n=== {script} {' '.join(args)}", flush=True)
    r = subprocess.run([sys.executable, str(AQUI / script), *args])
    if r.returncode:
        sys.exit(r.returncode)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--anos", nargs="+", help="só estes exercícios na bronze/silver")
    p.add_argument("--sem-externos", action="store_true", help="não rebaixa IBGE/IPCA")
    p.add_argument("--dta", default=os.environ.get("LAPAM_DTA"),
                   help="pasta com os .dta do painel de pesquisa (ou variável LAPAM_DTA); opcional")
    args = p.parse_args()

    anos = ["--anos", *args.anos] if args.anos else []
    dta = ["--dta", args.dta] if args.dta else []
    rodar("bronze.py", *anos)
    rodar("silver.py", *anos)
    if not args.sem_externos:
        rodar("externos.py", *dta)
    rodar("gold.py")
    rodar("validate.py", *dta)


if __name__ == "__main__":
    main()
