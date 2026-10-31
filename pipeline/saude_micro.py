"""Saúde: converte os microdados do DATASUS (.dbc baixados por saude_baixar.py) em Parquet, um para um.

Cada .dbc de --brutos (padrão: SAUDE_BRUTOS ou E:/finbra/brutos/saude) vira um .parquet no mesmo caminho em
--saida (padrão: SAUDE_MICRO ou E:/finbra/micro/saude/dbc), com todas as colunas como texto, exatamente como no
arquivo (sem espaços nas pontas; vazio vira nulo). Tipos, códigos e junções ficam para o passo seguinte
(saude.py), que lê estes arquivos. O .dbc é um DBF compactado (PKWare DCL): o pyreaddbc o descompacta numa
pasta temporária e o DBF é lido de uma vez, com numpy, pelo tamanho fixo dos registros.

Um .parquet só é gravado quando a conversão termina (nome .tmp até lá) e não é refeito se for mais novo que o
.dbc. Os arquivos do FTP não identificam pessoas pelo nome, com exceção de campos do CNES (profissionais) que
o painel nunca publica linha a linha.

Uso:
    py pipeline/saude_micro.py                       # converte o que falta, em paralelo
    py pipeline/saude_micro.py --sistemas SIM SINASC  # pastas do primeiro nível de --brutos
    py pipeline/saude_micro.py --refazer
"""
import argparse
import os
import struct
import tempfile
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.parquet as pq
import pyreaddbc


def ler_dbf(caminho: Path) -> pa.Table:
    """DBF inteiro numa tabela Arrow de textos. Registros apagados (marca '*') ficam de fora."""
    dados = caminho.read_bytes()
    n, cab, tam_reg = struct.unpack("<IHH", dados[4:12])
    campos, pos = [], 32
    while pos < cab - 1 and dados[pos] != 0x0D:
        d = dados[pos:pos + 32]
        campos.append((d[:11].split(b"\0")[0].decode("latin-1").strip(), d[16]))
        pos += 32
    # nomes repetidos (acontece em arquivos antigos) ganham sufixo
    vistos: dict[str, int] = {}
    nomes = []
    for nome, _ in campos:
        vistos[nome] = vistos.get(nome, 0) + 1
        nomes.append(nome if vistos[nome] == 1 else f"{nome}_{vistos[nome]}")
    dtype = np.dtype([("_apagado", "S1")] + [(f"c{i}", f"S{t}") for i, (_, t) in enumerate(campos)])
    if dtype.itemsize != tam_reg:
        raise ValueError(f"registro de {tam_reg} bytes, campos somam {dtype.itemsize}")
    n = min(n, (len(dados) - cab) // tam_reg)
    regs = np.frombuffer(dados, dtype=dtype, count=n, offset=cab)
    regs = regs[regs["_apagado"] != b"*"]
    colunas = {}
    for i, (nome, (_, t)) in enumerate(zip(nomes, campos)):
        col = np.ascontiguousarray(regs[f"c{i}"])
        bytes_ = col.view(np.uint8)
        if (bytes_ > 127).any():  # texto com acento (latin-1): decodifica só esta coluna
            arr = pa.array(np.char.decode(col, "latin-1"), pa.string())
        else:
            fixo = pa.FixedSizeBinaryArray.from_buffers(pa.binary(t), len(col), [None, pa.py_buffer(bytes_)])
            arr = fixo.cast(pa.binary()).cast(pa.string())
        arr = pc.utf8_trim(arr, " \0")
        colunas[nome] = pc.if_else(pc.equal(arr, ""), pa.scalar(None, pa.string()), arr)
    return pa.table(colunas)


def converter(dbc: str, saida: str) -> tuple[str, int, str | None]:
    alvo = Path(saida)
    tmp = alvo.with_suffix(".tmp")
    try:
        with tempfile.TemporaryDirectory() as pasta:
            dbf = Path(pasta) / "x.dbf"
            pyreaddbc.dbc2dbf(dbc, str(dbf))
            tab = ler_dbf(dbf)
        alvo.parent.mkdir(parents=True, exist_ok=True)
        pq.write_table(tab, tmp, compression="zstd", row_group_size=500_000)
        os.replace(tmp, alvo)
        return dbc, tab.num_rows, None
    except Exception as e:
        tmp.unlink(missing_ok=True)
        return dbc, 0, f"{type(e).__name__}: {e}"


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--brutos", default=os.environ.get("SAUDE_BRUTOS", "E:/finbra/brutos/saude"))
    p.add_argument("--saida", default=os.environ.get("SAUDE_MICRO", "E:/finbra/micro/saude/dbc"))
    p.add_argument("--sistemas", nargs="*")
    p.add_argument("--processos", type=int, default=max(1, (os.cpu_count() or 2) - 2))
    p.add_argument("--refazer", action="store_true")
    a = p.parse_args()
    brutos, saida = Path(a.brutos), Path(a.saida)
    pastas = [brutos / s for s in a.sistemas] if a.sistemas else [brutos]
    fila = []
    for pasta in pastas:
        for dbc in pasta.rglob("*"):
            if dbc.suffix.lower() != ".dbc":
                continue
            alvo = (saida / dbc.relative_to(brutos)).with_suffix(".parquet")
            if a.refazer or not alvo.exists() or alvo.stat().st_mtime < dbc.stat().st_mtime:
                fila.append((str(dbc), str(alvo)))
    # os maiores primeiro, para o paralelismo não terminar esperando um arquivo grande
    fila.sort(key=lambda x: -Path(x[0]).stat().st_size)
    print(f"{len(fila)} arquivos para converter ({sum(Path(d).stat().st_size for d, _ in fila) / 1e9:.1f} GB em .dbc)", flush=True)
    inicio, linhas, falhas = time.time(), 0, []
    with ProcessPoolExecutor(a.processos) as ex:
        futuros = [ex.submit(converter, d, s) for d, s in fila]
        for i, f in enumerate(as_completed(futuros), 1):
            dbc, n, erro = f.result()
            linhas += n
            if erro:
                falhas.append(dbc)
                print(f"FALHA {dbc}: {erro}", flush=True)
            if i % 500 == 0 or i == len(futuros):
                print(f"{i}/{len(futuros)} arquivos · {linhas:,} linhas · {time.time() - inicio:.0f} s", flush=True)
    print(f"concluído: {len(fila) - len(falhas)} convertidos, {len(falhas)} falhas", flush=True)


if __name__ == "__main__":
    main()
