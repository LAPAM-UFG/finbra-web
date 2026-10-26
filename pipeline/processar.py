"""Roda as camadas depois da extração: bronze → silver → externos → famílias → gold → validação → testes.

Uso:
    py pipeline/processar.py
    py pipeline/processar.py --anos 2024 2025 --sem-externos
"""
import argparse
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
    p.add_argument("--sem-externos", action="store_true", help="não rebaixa IBGE/IPCA, Bolsa Família e INSS")
    args = p.parse_args()

    anos = ["--anos", *args.anos] if args.anos else []
    rodar("bronze.py", *anos)
    rodar("silver.py", *anos)
    if not args.sem_externos:
        rodar("externos.py")
        rodar("familias.py", "--atualizar")  # só os meses e anos ainda não agregados
    rodar("gold.py")
    rodar("validate.py")
    rodar("testes.py")


if __name__ == "__main__":
    main()
