"""Bronze → silver: nomes padronizados e árvore de contas por segmento do código.

Saídas (data/silver):
  dca/exercicio=YYYY.parquet  um valor por (ente, anexo, coluna, chave), como o ente informou
  contas/exercicio=YYYY.parquet  árvore de contas do exercício (chave, pai, nível, descrição)

A chave da conta é o código sem os segmentos zerados do final, com o prefixo da
fonte: 'RO1.0.0.0.00.0.0' → 'RO1', 'RO1.7.1.8.01.2.0' → 'RO1.7.1.8.01.2'. Assim o
pai é sempre o código sem o último segmento (o 5º segmento tem 2 dígitos, e é por
isso que zerar dígito a dígito, como no notebook antigo, ligava irmãos como pai e
filho). Anexos I-E e I-G não têm código: a chave vem do texto (função 'F04',
subfunção 'F04.122', 'FU04 - Demais Subfunções' → 'F04.999').

Cada linha guarda o valor que o ente informou naquele nó, sem somar folhas.
Quando um ente informa uma conta mas não o pai dela, o pai é criado com a soma dos
filhos (sintetico = true), para que todo nível da árvore exista para todo ente.

Uso:
    py pipeline/silver.py               # todos os exercícios da bronze
    py pipeline/silver.py --anos 2022
"""
import argparse
import re

import duckdb
import pandas as pd

from config import BRONZE, SILVER

# Nomes de coluna que mudaram ao longo dos anos → nome atual
COLUNAS = {
    "Receitas Realizadas": "Receitas Brutas Realizadas",
    "Inscrição de RP Não Processados": "Inscrição de Restos a Pagar Não Processados",
    "Inscrição de RP Processados": "Inscrição de Restos a Pagar Processados",
}

SQL_LINHAS = r"""
WITH b AS (
    SELECT exercicio, cod_ibge, uf, populacao, cod_conta, conta, valor,
           CASE WHEN anexo LIKE 'DCA-%' THEN 'DCA' ELSE 'QDCC' END AS formato,
           regexp_replace(anexo, '^(DCA-)?Anexo ', '') AS anexo,
           CASE WHEN regexp_matches(coluna, '^\d{2}/\d{2}/\d{4}$') THEN 'Saldo em 31/12'
                ELSE coalesce(m.novo, coluna) END AS coluna
    FROM read_parquet(?) LEFT JOIN mapa_colunas m ON m.antigo = coluna
),
c AS (
    SELECT *,
        CASE WHEN anexo NOT IN ('I-E', 'I-G') THEN cod_conta
             WHEN regexp_matches(conta, '^\d{2}\.\d{3}\b') THEN 'F' || substr(conta, 1, 6)
             WHEN regexp_matches(conta, '^\d{2}\b') THEN 'F' || substr(conta, 1, 2)
             WHEN regexp_matches(conta, '^FU\d{2}\b') THEN 'F' || substr(conta, 3, 2) || '.999'
             WHEN conta ILIKE '%exceto intra%' THEN 'TotalExcetoIntra'
             WHEN conta ILIKE '%intra%' THEN 'TotalIntra'
             ELSE cod_conta END AS cod
    FROM b
),
p AS (
    SELECT *, regexp_extract(cod, '^([A-Z]*)(\d[\d.]*)([A-Z]*)$', ['pre', 'num', 'suf']) AS r FROM c
)
SELECT exercicio, cod_ibge, uf, populacao, formato, anexo, coluna, conta, valor,
       CASE WHEN r.num = '' THEN 'total' WHEN r.suf <> '' THEN 'atributo' ELSE 'conta' END AS tipo,
       CASE WHEN r.num = '' THEN cod
            ELSE r.pre || regexp_replace(r.num, '(\.0+)+$', '') || CASE WHEN r.suf <> '' THEN '#' || r.suf ELSE '' END
       END AS chave
FROM p
"""


def limpar_descricao(conta):
    d = re.sub(r"^(FU\d{2}|[\d.]+)\s*-?\s*", "", conta).strip()
    return d.replace(" ¿ ", " – ").replace("¿", '"').replace(" ", " ")


def pai_estrutural(chave):
    """'RO1.7.1.8.01.2' → 'RO1.7.1.8.01'; 'F04.122' → 'F04'; raiz → None."""
    base, _, suf = chave.partition("#")
    m = re.match(r"^([A-Z]*)(.*)$", base)
    pre, segs = m.group(1), m.group(2).split(".")
    while len(segs) > 1:
        segs = segs[:-1]
        while len(segs) > 1 and set(segs[-1]) == {"0"}:
            segs = segs[:-1]
        yield pre + ".".join(segs) + (f"#{suf}" if suf else "")


PREFIXOS = {"RO": "1", "RI": "2", "DO": "1", "DI": "2"}  # orçamentárias antes das intra


def ordem(chave):
    base = chave.partition("#")[0]
    pre, num = re.match(r"^([A-Z]*)(.*)$", base).groups()
    if not num:  # linhas de total vão para o fim
        return "~" + chave
    return PREFIXOS.get(pre, pre) + ".".join(s.zfill(3) for s in num.split(".")) + chave.partition("#")[2]


def arvore(linhas):
    """Árvore de contas do exercício: pai = ancestral mais próximo que exista no anexo."""
    contas = (linhas.groupby(["anexo", "chave", "tipo"])["conta"]
              .agg(lambda s: s.value_counts().index[0]).reset_index())
    saida = []
    for anexo, g in contas.groupby("anexo"):
        existentes = set(g.loc[g.tipo != "total", "chave"])
        for row in g.itertuples():
            pai = None
            if row.tipo != "total":
                pai = next((a for a in pai_estrutural(row.chave) if a in existentes), None)
            saida.append((anexo, row.chave, row.tipo, pai, limpar_descricao(row.conta), ordem(row.chave)))
    df = pd.DataFrame(saida, columns=["anexo", "chave", "tipo", "chave_pai", "descricao", "ordem"])
    pais = dict(zip(zip(df.anexo, df.chave), df.chave_pai))

    def nivel(anexo, chave):
        n = 1
        while (chave := pais.get((anexo, chave))):
            n += 1
        return n

    df["nivel"] = [nivel(a, c) for a, c in zip(df.anexo, df.chave)]
    return df


def gerar_ano(con, arquivo):
    ano = int(arquivo.stem.split("=")[1])
    linhas = con.execute(SQL_LINHAS, [arquivo.as_posix()]).df()

    duplicadas = linhas.duplicated(["cod_ibge", "anexo", "coluna", "chave"]).sum()
    contas = arvore(linhas)
    contas.insert(0, "exercicio", ano)

    fato = (linhas.groupby(["exercicio", "cod_ibge", "anexo", "formato", "coluna", "tipo", "chave"],
                           as_index=False)["valor"].sum())
    fato["sintetico"] = False

    # Pais ausentes: cria a partir da soma dos filhos, de baixo para cima
    pai_de = contas.set_index(["anexo", "chave"])["chave_pai"]
    nivel_de = contas.set_index(["anexo", "chave"])["nivel"]
    criados = []
    contas_fato = fato[fato.tipo == "conta"]
    for nv in sorted(contas.nivel.unique(), reverse=True):
        idx = pd.MultiIndex.from_arrays([contas_fato.anexo, contas_fato.chave])
        no_nivel = contas_fato[nivel_de.reindex(idx).to_numpy() == nv].copy()
        if no_nivel.empty:
            continue
        no_nivel["chave_pai"] = pai_de.reindex(pd.MultiIndex.from_arrays([no_nivel.anexo, no_nivel.chave])).to_numpy()
        no_nivel = no_nivel.dropna(subset=["chave_pai"])
        chaves = ["exercicio", "cod_ibge", "anexo", "formato", "coluna"]
        existentes = contas_fato[chaves + ["chave"]].rename(columns={"chave": "chave_pai"})
        faltando = no_nivel.merge(existentes, on=chaves + ["chave_pai"], how="left", indicator=True)
        faltando = faltando[faltando["_merge"] == "left_only"]
        if faltando.empty:
            continue
        novos = (faltando.groupby(chaves + ["chave_pai"], as_index=False)["valor"].sum()
                 .rename(columns={"chave_pai": "chave"}).assign(tipo="conta", sintetico=True))
        criados.append(novos)
        contas_fato = pd.concat([contas_fato, novos], ignore_index=True)
    if criados:
        fato = pd.concat([fato] + criados, ignore_index=True)

    for nome, df in (("dca", fato), ("contas", contas)):
        destino = SILVER / nome / f"exercicio={ano}.parquet"
        destino.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(destino, index=False, compression="zstd", compression_level=9)

    pop = linhas.groupby(["exercicio", "cod_ibge"], as_index=False).agg(uf=("uf", "first"), populacao=("populacao", "max"))
    destino = SILVER / "populacao" / f"exercicio={ano}.parquet"
    destino.parent.mkdir(parents=True, exist_ok=True)
    pop.to_parquet(destino, index=False)

    n_sint = int(fato.sintetico.sum())
    print(f"{ano}: {len(fato):,} linhas | {fato.cod_ibge.nunique()} entes | "
          f"{len(contas):,} contas na árvore | {n_sint:,} pais criados | {duplicadas:,} chaves repetidas somadas")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--anos", nargs="+", type=int)
    args = p.parse_args()

    con = duckdb.connect()
    # tabela nativa: DataFrames registrados (con.register) travam o duckdb-python em consultas grandes
    con.execute("CREATE TABLE mapa_colunas (antigo VARCHAR, novo VARCHAR)")
    con.executemany("INSERT INTO mapa_colunas VALUES (?, ?)", list(COLUNAS.items()))
    arquivos = sorted((BRONZE / "dca").glob("exercicio=*.parquet"))
    if args.anos:
        arquivos = [a for a in arquivos if int(a.stem.split("=")[1]) in args.anos]
    for arquivo in arquivos:
        gerar_ano(con, arquivo)

    entes = BRONZE / "entes.parquet"
    con.execute(f"""COPY (SELECT cod_ibge, ente AS nome, uf, regiao, esfera, trim(capital) = '1' AS capital, cnpj
                          FROM '{entes.as_posix()}')
                    TO '{(SILVER / "entes.parquet").as_posix()}' (FORMAT parquet)""")


if __name__ == "__main__":
    main()
