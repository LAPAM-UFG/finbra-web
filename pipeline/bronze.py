"""Landing (ndjson.gz por ente) → bronze (Parquet zstd por exercício).

A bronze é fiel à API: mesmas colunas e valores, só com tipos definidos.
Gera também data/bronze/cobertura.csv (entes com dados por exercício e anexo).

Uso:
    py pipeline/bronze.py               # todos os exercícios presentes no landing
    py pipeline/bronze.py --anos 2022
"""
import argparse

import duckdb

from config import BRONZE, LANDING

COLUNAS = {
    "exercicio": "SMALLINT", "instituicao": "VARCHAR", "cod_ibge": "INTEGER", "uf": "VARCHAR",
    "anexo": "VARCHAR", "rotulo": "VARCHAR", "coluna": "VARCHAR", "cod_conta": "VARCHAR",
    "conta": "VARCHAR", "valor": "DOUBLE", "populacao": "INTEGER",
}


def caminho(p):
    return p.as_posix().replace("'", "''")


def gerar_ano(con, pasta):
    ano = int(pasta.name.split("=")[1])
    destino = BRONZE / "dca" / f"exercicio={ano}.parquet"
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(".tmp")
    colunas = "{" + ", ".join(f"'{k}': '{v}'" for k, v in COLUNAS.items()) + "}"
    con.execute(f"""
        COPY (
            SELECT {", ".join(COLUNAS)}
            FROM read_json('{caminho(pasta)}/*.ndjson.gz', format='newline_delimited',
                           compression='gzip', columns={colunas})
            ORDER BY cod_ibge, anexo, coluna, cod_conta
        ) TO '{caminho(tmp)}' (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9)
    """)
    tmp.replace(destino)
    n_arquivos = len(list(pasta.glob("*.ndjson.gz")))
    linhas, entes = con.execute(
        f"SELECT count(*), count(DISTINCT cod_ibge) FROM '{caminho(destino)}'").fetchone()
    print(f"{ano}: {linhas:,} linhas | {entes} entes com dados de {n_arquivos} consultados "
          f"| {destino.stat().st_size / 1e6:.1f} MB")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--anos", nargs="+", type=int)
    args = p.parse_args()

    con = duckdb.connect()
    pastas = sorted((LANDING / "dca").glob("exercicio=*"))
    if args.anos:
        pastas = [x for x in pastas if int(x.name.split("=")[1]) in args.anos]
    for pasta in pastas:
        gerar_ano(con, pasta)

    con.execute(f"""
        COPY (SELECT * FROM read_json('{caminho(LANDING)}/entes.ndjson.gz', format='newline_delimited',
                                      compression='gzip'))
        TO '{caminho(BRONZE)}/entes.parquet' (FORMAT parquet, COMPRESSION zstd)
    """)
    con.execute(f"""
        COPY (
            SELECT exercicio, regexp_replace(anexo, '^DCA-', '') AS anexo,
                   count(DISTINCT cod_ibge) AS entes, count(*) AS linhas
            FROM '{caminho(BRONZE)}/dca/*.parquet' GROUP BY ALL ORDER BY ALL
        ) TO '{caminho(BRONZE)}/cobertura.csv' (HEADER)
    """)


if __name__ == "__main__":
    main()
