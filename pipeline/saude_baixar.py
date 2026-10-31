"""Saúde: baixa os microdados do DATASUS (ftp.datasus.gov.br/dissemin/publicos) para o HD externo.

Os arquivos ficam em --brutos (padrão: SAUDE_BRUTOS ou E:/finbra/brutos/saude), com a mesma estrutura de
pastas do FTP (ex.: SIM/CID10/DORES/DOGO2024.dbc). Só os formatos de origem: .dbc (DBF compactado do DATASUS),
os .csv do SISCAN, as populações do IBGE/SVS (.zip e .dbf) e os auxiliares (.zip/.rar com layouts e
tabelas de apoio). Ficam de fora as cópias do SIH em
XML, DBF, CSV e DuckDB (as mesmas internações dos .dbc), o SIA (≈ 440 GB) e o PNI antigo.

Um arquivo já baixado com o mesmo tamanho do FTP não é baixado de novo; cada um é gravado como .parte e
renomeado no fim, para uma queda no meio não deixar arquivo truncado com o nome certo.

Uso:
    py pipeline/saude_baixar.py                      # todos os sistemas abaixo
    py pipeline/saude_baixar.py --sistemas SIM SINASC
    py pipeline/saude_baixar.py --listar             # só mostra o que falta baixar
"""
import argparse
import ftplib
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

HOST = "ftp.datasus.gov.br"
RAIZ = "/dissemin/publicos"
# pastas de cada sistema (relativas a RAIZ) e o que entra delas
PASTAS = {
    "SIM": ["SIM/CID10/DORES", "SIM/CID10/DOFET", "SIM/CID10/TAB", "SIM/CID9/DORES", "SIM/CID9/DOFET",
            "SIM/PRELIM/DORES", "SIM/PRELIM/DOFET"],
    "SINASC": ["SINASC/1994_1995/Dados/DNRES", "SINASC/1996_/Dados/DNRES", "SINASC/ANT/DNRES", "SINASC/NOV/DNRES",
               "SINASC/PRELIM/DNRES"],
    "SIH": ["SIHSUS/199201_200712/Dados", "SIHSUS/200801_/Dados", "SIHSUS/200801_/Auxiliar"],
    "CNES": ["CNES/200508_/Dados", "CNES/200508_/Auxiliar"],
    "SINAN": ["SINAN/DADOS/FINAIS", "SINAN/DADOS/PRELIM", "SINAN/AUXILIAR", "SINAN/DOCS"],
    "CIHA": ["CIHA/201101_/Dados", "CIHA/201101_/Auxiliar"],
    "SISCAN": ["SISCAN/SISCAN", "SISCAN/SISCOLO4/Dados", "SISCAN/SISMAMA/Dados", "SISCAN"],
    "SISPRENATAL": ["SISPRENATAL/201201_/Dados"],
    "ONCOLOGIA": ["painel_oncologia/Dados"],
    "RESP": ["RESP"],
    # população para as taxas: estimativas da SVS/MS por município, sexo e faixa etária, censos e projeções
    "POPULACAO": ["IBGE/POPSVS", "IBGE/POP", "IBGE/censo", "IBGE/projpop"],
}
# na raiz do SISCAN entram só os arquivos soltos (as subpastas já estão acima)
SO_ARQUIVOS_SOLTOS = {"SISCAN"}
EXTENSOES = {".dbc", ".dbf", ".csv", ".zip", ".rar"}
LINHA_DOS = re.compile(r"^\d\d-\d\d-\d\d\s+\d\d:\d\d[AP]M\s+(<DIR>|\d+)\s+(.+)$")


def conectar() -> ftplib.FTP:
    f = ftplib.FTP(HOST, timeout=180)
    f.login()
    f.encoding = "latin-1"
    return f


def listar(f: ftplib.FTP, caminho: str) -> list[tuple[str, int | None]]:
    linhas: list[str] = []
    f.retrlines(f"LIST {caminho}", linhas.append)
    itens = []
    for l in linhas:
        m = LINHA_DOS.match(l.strip())
        if m:
            itens.append((m.group(2), None if m.group(1) == "<DIR>" else int(m.group(1))))
    return itens


def arquivos(f: ftplib.FTP, pasta: str, recursivo: bool) -> list[tuple[str, int]]:
    """(caminho relativo a RAIZ, tamanho) dos arquivos da pasta; a pasta-raiz do sistema não desce nas subpastas."""
    r = []
    for nome, tam in listar(f, f"{RAIZ}/{pasta}"):
        if tam is None:
            if recursivo:
                r += arquivos(f, f"{pasta}/{nome}", True)
        elif Path(nome).suffix.lower() in EXTENSOES:
            r.append((f"{pasta}/{nome}", tam))
    return r


# uma conexão por thread, reaproveitada entre os arquivos (o CNES tem dezenas de milhares de arquivos pequenos,
# e abrir uma conexão para cada um tomava mais tempo que a transferência)
_local = threading.local()


def _conexao(nova: bool = False) -> ftplib.FTP:
    if nova or getattr(_local, "ftp", None) is None:
        if getattr(_local, "ftp", None) is not None:
            try:
                _local.ftp.close()
            except Exception:
                pass
        _local.ftp = conectar()
    return _local.ftp


def baixar(rel: str, tam: int, destino: Path, tentativas: int = 5) -> int:
    alvo = destino / rel
    alvo.parent.mkdir(parents=True, exist_ok=True)
    parte = alvo.with_name(alvo.name + ".parte")
    for t in range(tentativas):
        try:
            f = _conexao(nova=t > 0)
            with open(parte, "wb") as saida:
                f.retrbinary(f"RETR {RAIZ}/{rel}", saida.write, blocksize=1 << 20)
            if parte.stat().st_size != tam:
                raise IOError(f"tamanho {parte.stat().st_size} ≠ {tam}")
            os.replace(parte, alvo)
            return tam
        except Exception as e:
            if t == tentativas - 1:
                print(f"FALHA {rel}: {e}", flush=True)
                return 0
            time.sleep(10 * (t + 1))
    return 0


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--brutos", default=os.environ.get("SAUDE_BRUTOS", "E:/finbra/brutos/saude"))
    p.add_argument("--sistemas", nargs="*", default=list(PASTAS))
    p.add_argument("--paralelo", type=int, default=4, help="downloads simultâneos")
    p.add_argument("--listar", action="store_true")
    a = p.parse_args()
    destino = Path(a.brutos)
    f = conectar()
    fila: list[tuple[str, int]] = []
    for s in a.sistemas:
        lista = []
        for pasta in PASTAS[s]:
            lista += arquivos(f, pasta, recursivo=pasta not in SO_ARQUIVOS_SOLTOS)
        faltam = [(r, t) for r, t in lista if not ((destino / r).exists() and (destino / r).stat().st_size == t)]
        print(f"{s}: {len(lista)} arquivos, {sum(t for _, t in lista) / 1e9:.1f} GB; faltam {len(faltam)} "
              f"({sum(t for _, t in faltam) / 1e9:.1f} GB)", flush=True)
        fila += faltam
    f.quit()
    if a.listar or not fila:
        return
    total, feito, inicio = sum(t for _, t in fila), 0, time.time()
    with ThreadPoolExecutor(a.paralelo) as ex:
        futuros = [ex.submit(baixar, r, t, destino) for r, t in fila]
        for i, fut in enumerate(as_completed(futuros), 1):
            feito += fut.result()
            if i % 200 == 0 or i == len(futuros):
                s = time.time() - inicio
                print(f"{i}/{len(futuros)} arquivos · {feito / 1e9:.1f} de {total / 1e9:.1f} GB · "
                      f"{feito / 1e6 / max(s, 1):.1f} MB/s", flush=True)
    falhas = [r for r, t in fila if not ((destino / r).exists() and (destino / r).stat().st_size == t)]
    print(f"concluído: {len(fila) - len(falhas)} baixados, {len(falhas)} falhas", flush=True)
    sys.exit(1 if falhas else 0)


if __name__ == "__main__":
    main()
