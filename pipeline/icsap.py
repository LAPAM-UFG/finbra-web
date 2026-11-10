"""ICSAP: internações por condições sensíveis à atenção primária (SIH/SUS), pela Lista Brasileira da Portaria SAS/MS nº 221/2008.

Referência: https://bvsms.saude.gov.br/bvs/saudelegis/sas/2008/prt0221_17_04_2008.html (19 grupos de causas, CID-10).
Método do indicador: Alfradique et al., Cad. Saúde Pública 25(6), 2009, e a ficha do PROADESS/Fiocruz
(https://proadess.fiocruz.br/?pag=fic&cod=B11&tab=1).

Regras de classificação (diagnóstico principal da AIH, DIAG_PRINC do SIH, sem ponto, ex.: N390):
    - o código é normalizado (maiúsculas, sem espaços); vazio ou ausente nunca é ICSAP;
    - entrada da lista com 3 caracteres (ex.: "A33 a A35", "J45"): vale para qualquer subcategoria da categoria, e também
      para o diagnóstico registrado só com a categoria;
    - entrada com subcategoria (4 caracteres, ex.: "G00.0", "J15.3", "E10.0 a E10.1"): o diagnóstico precisa trazer a
      subcategoria e ela precisa estar dentro do intervalo; "N39" sem a subcategoria NÃO entra (a lista só tem N39.0);
    - cada código pertence a no máximo um grupo (conferido nos testes).

Indicadores (por ano de competência da AIH e município de residência, como nas demais colunas int_*):
    icsap_int   internações por ICSAP (numerador);
    icsap_base  internações SUS de residentes (AIH tipo 1) exceto partos (CID-10 O80–O84): denominador da proporção, como na
                ficha do PROADESS ("internações hospitalares de residentes financiadas pelo SUS, excluídas as internações por
                partos, CID-10 O80–O84"); a taxa por 10 mil habitantes usa a população residente (gold/saude/populacao);
    icsap_g01…icsap_g19  internações por grupo da lista.
Em UF e Brasil somam-se numeradores e denominadores antes de calcular taxas e proporções (feito no site).
Município e ano sem nenhuma AIH não têm linha: o site mostra "sem registro", nunca zero; zero só existe onde há AIH e nenhuma é ICSAP.

Uso (só gera dados candidatos numa pasta separada; não toca o gold nem o R2):
    py pipeline/icsap.py candidato --saida E:/finbra/candidato_icsap \\
        --micro E:/finbra/micro/saude/dbc --base E:/finbra/data/gold
"""
import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import duckdb

ICSAP_ANOS = (2008, 2025)  # os mesmos do SIH no painel; 2026 fica de fora até fechar
PARTO = ("O80", "O84")  # partos: fora do denominador da proporção

GRUPOS = {
    1: "Doenças preveníveis por imunização e condições sensíveis",
    2: "Gastroenterites infecciosas e complicações",
    3: "Anemia",
    4: "Deficiências nutricionais",
    5: "Infecções de ouvido, nariz e garganta",
    6: "Pneumonias bacterianas",
    7: "Asma",
    8: "Doenças pulmonares",
    9: "Hipertensão",
    10: "Angina",
    11: "Insuficiência cardíaca",
    12: "Doenças cerebrovasculares",
    13: "Diabetes mellitus",
    14: "Epilepsias",
    15: "Infecção no rim e trato urinário",
    16: "Infecção da pele e tecido subcutâneo",
    17: "Doença inflamatória dos órgãos pélvicos femininos",
    18: "Úlcera gastrointestinal",
    19: "Doenças relacionadas ao pré-natal e parto",
}

# Anexo da Portaria SAS/MS nº 221/2008, na grafia da lista (com ponto): "X00", "X00.0" ou intervalo "X00 a X02", "X00.0 a X00.3"
LISTA: list[tuple[int, list[str]]] = [
    (1, ["A37", "A36", "A33 a A35", "B26", "B06", "B05", "A95", "B16", "G00.0", "A17.0", "A19",
         "A15.0 a A15.3", "A16.0 a A16.2", "A15.4 a A15.9", "A16.3 a A16.9", "A17.1 a A17.9", "A18", "I00 a I02", "A51 a A53", "B50 a B54", "B77"]),
    (2, ["E86", "A00 a A09"]),
    (3, ["D50"]),
    (4, ["E40 a E46", "E50 a E64"]),
    (5, ["H66", "J00", "J01", "J02", "J03", "J06", "J31"]),
    (6, ["J13", "J14", "J15.3", "J15.4", "J15.8", "J15.9", "J18.1"]),
    (7, ["J45", "J46"]),
    (8, ["J20", "J21", "J40", "J41", "J42", "J43", "J47", "J44"]),
    (9, ["I10", "I11"]),
    (10, ["I20"]),
    (11, ["I50", "J81"]),
    (12, ["I63 a I67", "I69", "G45 a G46"]),
    (13, ["E10.0", "E10.1", "E11.0", "E11.1", "E12.0", "E12.1", "E13.0", "E13.1", "E14.0", "E14.1",  # com coma ou cetoacidose
          "E10.2 a E10.8", "E11.2 a E11.8", "E12.2 a E12.8", "E13.2 a E13.8", "E14.2 a E14.8",  # com complicações
          "E10.9", "E11.9", "E12.9", "E13.9", "E14.9"]),  # sem complicações específicas
    (14, ["G40", "G41"]),
    (15, ["N10", "N11", "N12", "N30", "N34", "N39.0"]),
    (16, ["A46", "L01", "L02", "L03", "L04", "L08"]),
    (17, ["N70", "N71", "N72", "N73", "N75", "N76"]),
    (18, ["K25 a K28", "K92.0", "K92.1", "K92.2"]),
    (19, ["O23", "A50", "P35.0"]),
]

_ENTRADA = re.compile(r"^([A-Z]\d{2}(?:\.\d)?)(?: a ([A-Z]\d{2}(?:\.\d)?))?$")


def _sem_ponto(c: str) -> str:
    return c.replace(".", "")


def regras() -> list[tuple[int, str, str]]:
    """Entradas da lista como (grupo, primeiro, último) sem ponto; 3 ou 4 caracteres (mesmo tamanho nos dois extremos)."""
    saida = []
    for grupo, entradas in LISTA:
        for e in entradas:
            m = _ENTRADA.match(e)
            if not m:
                raise ValueError(f"entrada inválida na lista de ICSAP: {e!r}")
            lo, hi = _sem_ponto(m.group(1)), _sem_ponto(m.group(2) or m.group(1))
            if len(lo) != len(hi) or lo > hi:
                raise ValueError(f"intervalo inválido na lista de ICSAP: {e!r}")
            saida.append((grupo, lo, hi))
    return saida


REGRAS = regras()


def normalizar(diag) -> str:
    return "" if diag is None else str(diag).strip().upper()


def grupo_do_diagnostico(diag) -> int | None:
    """Grupo da lista (1–19) do diagnóstico principal, ou None se não for ICSAP. Implementação direta, usada nos testes e na conferência."""
    d = normalizar(diag)
    achados = {g for g, lo, hi in REGRAS if len(d) >= len(lo) and lo <= d[:len(lo)] <= hi}
    if len(achados) > 1:
        raise ValueError(f"{d} cai em mais de um grupo: {sorted(achados)}")
    return achados.pop() if achados else None


def eh_parto(diag) -> bool:
    d = normalizar(diag)
    return len(d) >= 3 and PARTO[0] <= d[:3] <= PARTO[1]


def sql_grupo(coluna: str = "DIAG_PRINC") -> str:
    """Expressão SQL (DuckDB) que devolve o grupo (1–19) ou NULL, a partir das mesmas regras."""
    d = f"upper(trim({coluna}))"
    casos = []
    for g, lo, hi in REGRAS:
        n = len(lo)
        casos.append(f"WHEN length({d}) >= {n} AND left({d}, {n}) BETWEEN '{lo}' AND '{hi}' THEN {g}")
    return "CASE " + " ".join(casos) + " END"


def agregar_icsap(con: duckdb.DuckDBPyConnection, micro: Path, saida: Path) -> None:
    """Lê os RD*.parquet do SIH (os mesmos filtros de saude.internacoes: AIH tipo 1, 2008–2025, município de residência) e grava icsap.parquet."""
    rd = micro / "SIHSUS" / "200801_" / "Dados"
    de, ate = ICSAP_ANOS
    grupos = ",\n".join(f"count(*) FILTER (WHERE grupo = {g}) AS icsap_g{g:02d}" for g in GRUPOS)
    con.execute(f"""
        CREATE OR REPLACE TABLE sih_icsap AS
        SELECT TRY_CAST(ANO_CMPT AS INTEGER) AS ano, TRY_CAST(MUNIC_RES AS INTEGER) AS municipio,
               {sql_grupo('DIAG_PRINC')} AS grupo,
               (length(upper(trim(DIAG_PRINC))) >= 3 AND left(upper(trim(DIAG_PRINC)), 3) BETWEEN '{PARTO[0]}' AND '{PARTO[1]}') AS parto
        FROM read_parquet('{rd.as_posix()}/RD*.parquet')
        WHERE IDENT = '1' AND TRY_CAST(ANO_CMPT AS INTEGER) BETWEEN {de} AND {ate}""")
    con.execute(f"""
        CREATE OR REPLACE TABLE icsap AS
        SELECT ano, municipio, municipio // 10000 AS uf,
               count(*) FILTER (WHERE grupo IS NOT NULL) AS icsap_int,
               count(*) FILTER (WHERE NOT coalesce(parto, false)) AS icsap_base,
               {grupos}
        FROM sih_icsap WHERE municipio IS NOT NULL GROUP BY ano, municipio ORDER BY 1, 2""")
    con.execute(f"COPY icsap TO '{(saida / 'icsap.parquet').as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
    con.execute("DROP TABLE sih_icsap")


def fonte_icsap(con: duckdb.DuckDBPyConnection, arquivo: Path) -> dict:
    """Entrada do manifesto (fontes.icsap): anos com ICSAP e a referência da lista."""
    a = arquivo.as_posix()
    anos = [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{a}' WHERE icsap_int IS NOT NULL ORDER BY 1").fetchall()]
    quando = datetime.fromtimestamp(arquivo.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    return {"anos": anos, "processado_em": quando, "url": "https://bvsms.saude.gov.br/bvs/saudelegis/sas/2008/prt0221_17_04_2008.html"}


def validar_destinos(base: Path, saida: Path) -> None:
    """Recusa, antes de qualquer escrita, uma --saida cujos destinos efetivos (saida/gold/..., saida/cobertura_icsap.csv) caiam sobre
    o gold de origem ou dentro dele: a gravação acontece em saida/gold, então --saida E:/finbra/data com --base E:/finbra/data/gold
    chegaria ao gold original mesmo sem --saida estar dentro de --base. Compara caminhos já resolvidos (.., links e barras)."""
    base, saida = base.resolve(), saida.resolve()
    destino = saida / "gold"

    def dentro(a: Path, b: Path) -> bool:  # a é b ou está dentro de b
        return a == b or b in a.parents

    gravacoes = [destino / "saude" / "icsap.parquet", destino / "saude" / "municipios.parquet", destino / "manifesto.json", saida / "cobertura_icsap.csv"]
    origens = [base / "saude" / "municipios.parquet", base / "manifesto.json"]
    if dentro(destino, base) or dentro(base, destino) or dentro(saida, base):
        raise ValueError(f"destino inválido: {destino} coincide com o gold de origem {base}, está dentro dele ou o contém; --saida precisa ser uma pasta separada")
    if {g.resolve() for g in gravacoes} & {o.resolve() for o in origens}:
        raise ValueError("destino inválido: uma das gravações cai sobre um arquivo de origem")


def candidato(micro: Path, base: Path, saida: Path) -> None:
    """Gera, em --saida, os arquivos que a publicação precisaria (sem tocar --base):
        gold/saude/icsap.parquet       ano × município de residência (arquivo novo)
        gold/saude/municipios.parquet  o publicado mais as colunas icsap_* (as demais colunas, idênticas)
        gold/manifesto.json            o publicado mais fontes.icsap
        cobertura_icsap.csv            conferência: municípios com AIH por ano
    """
    validar_destinos(base, saida)  # antes de qualquer mkdir ou escrita
    destino = saida / "gold" / "saude"
    destino.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order = false")
    agregar_icsap(con, micro, destino)
    pub = (base / "saude" / "municipios.parquet").as_posix()
    novo = (destino / "municipios.parquet").as_posix()
    con.execute(f"""
        COPY (SELECT m.*, i.* EXCLUDE (ano, municipio, uf)
              FROM '{pub}' m LEFT JOIN '{(destino / 'icsap.parquet').as_posix()}' i ON i.ano = m.ano AND i.municipio = m.municipio
              ORDER BY m.ano, m.municipio) TO '{novo}' (FORMAT parquet, COMPRESSION zstd)""")
    manifesto = json.loads((base / "manifesto.json").read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {})["icsap"] = fonte_icsap(con, destino / "icsap.parquet")
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (saida / "gold" / "manifesto.json").write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")
    con.execute(f"""
        COPY (SELECT ano, count(*) AS municipios_com_aih, count(*) FILTER (WHERE icsap_int = 0) AS municipios_sem_icsap,
                     sum(icsap_int) AS icsap_int, sum(icsap_base) AS icsap_base
              FROM '{(destino / 'icsap.parquet').as_posix()}' WHERE municipio // 10000 BETWEEN 11 AND 53 GROUP BY ano ORDER BY ano)
        TO '{(saida / 'cobertura_icsap.csv').as_posix()}' (HEADER, DELIMITER ',')""")
    print("candidato gerado em", saida)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("acao", choices=["candidato"])
    p.add_argument("--micro", default="E:/finbra/micro/saude/dbc")
    p.add_argument("--base", default="E:/finbra/data/gold", help="gold publicado (somente leitura)")
    p.add_argument("--saida", required=True)
    a = p.parse_args()
    try:
        candidato(Path(a.micro), Path(a.base), Path(a.saida))
    except ValueError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
