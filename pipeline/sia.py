"""SIA/SUS (produção ambulatorial): agrega os .dbc do grupo PA, um arquivo de cada vez, sem converter tudo para Parquet.

Cada .dbc de --brutos (padrão: SAUDE_BRUTOS ou E:/finbra/brutos/saude), em SIASUS/200801_/Dados/PAUFAAMM[x].dbc, é lido
(saude_micro.ler_dbf), somado pelo DuckDB e gravado em --saida (padrão: SAUDE_MICRO ou E:/finbra/micro/saude/sia) como
AAAA/PAUFAAMM[x].parquet, e o DBF temporário é apagado. Os microdados completos (cerca de 214 GB em .dbc, mais de 1 TB
em texto) nunca ficam em disco: o que se guarda é o agregado por arquivo, com as linhas abaixo.

Um arquivo = um mês de apresentação (PA_MVM) de uma UF (ou parte dela: a, b, c). O ano é o de PA_MVM (competência de
apresentação), o mesmo critério do arquivo; atendimentos de meses anteriores apresentados depois entram no ano da apresentação.

Linhas do agregado (todas as medidas são somas, recombináveis em qualquer agrupamento; médias = soma ÷ contagem):
    ano, municipio (do estabelecimento, 6 dígitos), proc (procedimento, 10 dígitos), cbo (ocupação do profissional),
    registros, qtd_pro, qtd_apr (quantidade produzida e aprovada), val_pro, val_apr (valor produzido e aprovado, R$ nominais),
    qtd_apr_fora, val_apr_fora (parte aprovada de pacientes que moram em outro município que o do estabelecimento)

Só arquivos completos entram (o downloader grava .parte até terminar). Rodar de novo só faz o que falta; --refazer refaz tudo.

Uso:
    py pipeline/sia.py                       # agrega o que já foi baixado e ainda não foi agregado
    py pipeline/sia.py --uf GO --anos 2019-2025
    py pipeline/sia.py --refazer
"""
import argparse
import os
import re
import sys
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import duckdb
import pyreaddbc

sys.path.insert(0, str(Path(__file__).parent))
from saude_micro import ler_dbf  # noqa: E402

PADRAO = re.compile(r"^PA([A-Z]{2})(\d{2})(\d{2})([a-z]?)\.dbc$", re.I)
SQL = """
    SELECT TRY_CAST(left(PA_MVM, 4) AS INTEGER) AS ano, TRY_CAST(PA_UFMUN AS INTEGER) AS municipio, PA_PROC_ID AS proc,
           PA_CBOCOD AS cbo, count(*) AS registros,
           sum(TRY_CAST(PA_QTDPRO AS DOUBLE)) AS qtd_pro, sum(TRY_CAST(PA_QTDAPR AS DOUBLE)) AS qtd_apr,
           sum(TRY_CAST(PA_VALPRO AS DOUBLE)) AS val_pro, sum(TRY_CAST(PA_VALAPR AS DOUBLE)) AS val_apr,
           sum(TRY_CAST(PA_QTDAPR AS DOUBLE)) FILTER (WHERE TRY_CAST(PA_MUNPCN AS INTEGER) <> TRY_CAST(PA_UFMUN AS INTEGER)
                                                      AND TRY_CAST(PA_MUNPCN AS INTEGER) BETWEEN 110000 AND 539999) AS qtd_apr_fora,
           sum(TRY_CAST(PA_VALAPR AS DOUBLE)) FILTER (WHERE TRY_CAST(PA_MUNPCN AS INTEGER) <> TRY_CAST(PA_UFMUN AS INTEGER)
                                                      AND TRY_CAST(PA_MUNPCN AS INTEGER) BETWEEN 110000 AND 539999) AS val_apr_fora
    FROM t GROUP BY ALL"""


def agregar(dbc: str, saida: str) -> tuple[str, int, float, str | None]:
    """Agrega um .dbc. Devolve (nome, linhas de entrada, segundos, erro)."""
    arq, destino = Path(dbc), Path(saida)
    t0 = time.time()
    try:
        with tempfile.TemporaryDirectory() as tmp:
            dbf = Path(tmp) / "x.dbf"
            pyreaddbc.dbc2dbf(str(arq), str(dbf))
            tab = ler_dbf(dbf)
            n = tab.num_rows
            dbf.unlink()
            con = duckdb.connect()
            con.register("t", tab)
            destino.parent.mkdir(parents=True, exist_ok=True)
            parcial = destino.with_suffix(".tmp")
            con.execute(f"COPY ({SQL}) TO '{parcial.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
            con.close()
        parcial.replace(destino)
        return arq.name, n, time.time() - t0, None
    except Exception as e:  # noqa: BLE001 - um arquivo ruim não derruba os outros
        return arq.name, 0, time.time() - t0, f"{type(e).__name__}: {e}"


def anos_de(texto: str | None):
    if not texto:
        return None
    r = set()
    for parte in texto.split(","):
        a, _, b = parte.partition("-")
        r.update(range(int(a), int(b or a) + 1))
    return r


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--brutos", default=os.environ.get("SAUDE_BRUTOS", "E:/finbra/brutos/saude"))
    p.add_argument("--saida", default=os.environ.get("SAUDE_MICRO", "E:/finbra/micro/saude").rstrip("/\\").removesuffix("/dbc") + "/sia")
    p.add_argument("--uf", nargs="*", help="siglas (ex.: GO MG); padrão: todas")
    p.add_argument("--anos", help="ex.: 2019-2025 ou 2024")
    p.add_argument("--processos", type=int, default=3, help="arquivos em paralelo (os de SP chegam a vários GB em memória)")
    p.add_argument("--refazer", action="store_true")
    a = p.parse_args()
    pasta = Path(a.brutos) / "SIASUS" / "200801_" / "Dados"
    saida = Path(a.saida)
    anos = anos_de(a.anos)
    ufs = {u.upper() for u in a.uf} if a.uf else None
    fila = []
    for f in sorted(pasta.glob("PA*.dbc")):
        m = PADRAO.match(f.name)
        if not m:
            continue
        uf, aa = m.group(1).upper(), 2000 + int(m.group(2))
        if (ufs and uf not in ufs) or (anos and aa not in anos):
            continue
        destino = saida / str(aa) / f"{f.stem}.parquet"
        if destino.exists() and not a.refazer and destino.stat().st_mtime >= f.stat().st_mtime:
            continue
        fila.append((str(f), str(destino)))
    print(f"{len(fila)} arquivos para agregar", flush=True)
    if not fila:
        return
    inicio, linhas, erros = time.time(), 0, []
    with ProcessPoolExecutor(a.processos) as ex:
        futuros = [ex.submit(agregar, d, s) for d, s in fila]
        for i, fut in enumerate(as_completed(futuros), 1):
            nome, n, seg, erro = fut.result()
            linhas += n
            if erro:
                erros.append((nome, erro))
                print(f"ERRO {nome}: {erro}", flush=True)
            if i % 25 == 0 or i == len(futuros):
                print(f"{i}/{len(futuros)} arquivos · {linhas / 1e6:.0f} milhões de linhas lidas · {(time.time() - inicio) / 60:.1f} min", flush=True)
    print(f"concluído: {len(fila) - len(erros)} agregados, {len(erros)} erros", flush=True)
    sys.exit(1 if erros else 0)


if __name__ == "__main__":
    main()
