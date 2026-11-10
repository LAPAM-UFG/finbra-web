"""Testes da classificação ICSAP (Portaria SAS/MS nº 221/2008). Não precisa de dados.

Uso:
    py pipeline/testes_icsap.py
"""
import itertools
import string
import sys

import duckdb

import icsap as m

falhas = []


def teste(nome, ok, detalhe=""):
    print(f"{'ok ' if ok else 'FALHOU'}  {nome}{'' if ok else f' — {detalhe}'}")
    if not ok:
        falhas.append(nome)


G = m.grupo_do_diagnostico


def confere(grupo, sim, nao):
    for c in sim:
        teste(f"{c} é ICSAP do grupo {grupo}", G(c) == grupo, G(c))
    for c in nao:
        teste(f"{c} não é ICSAP", G(c) is None, G(c))


teste("19 grupos, cada um com ao menos uma regra", sorted({g for g, _, _ in m.REGRAS}) == list(range(1, 20)) == sorted(m.GRUPOS))
# limites de intervalos de 3 caracteres e categorias vizinhas
confere(1, ["A33", "A34", "A35", "A36", "A37", "A330", "A359", "I00", "I02", "I029", "A51", "A53", "B50", "B54", "B77", "B779"], ["A32", "A38", "A94", "A96", "I03", "I99", "A54", "B49", "B55", "B76", "B78", "B15", "B17"])
# tuberculose: A15–A19 com subcategoria; A17.0 (meningite tuberculosa) e A17.1–A17.9; A18 e A19 inteiras
confere(1, ["A150", "A153", "A154", "A159", "A160", "A169", "A170", "A171", "A179", "A18", "A180", "A19", "A199"], ["A14", "A20", "A15", "A16", "A17"])
confere(1, ["G000"], ["G001", "G009", "G00", "G01"])  # só a meningite por Haemophilus
confere(2, ["E86", "E860", "A00", "A09", "A099", "A050"], ["E85", "E87", "A10"])
confere(3, ["D50", "D509"], ["D49", "D51"])
confere(4, ["E40", "E46", "E469", "E50", "E64", "E649"], ["E39", "E47", "E49", "E65"])
confere(5, ["H66", "H669", "J00", "J01", "J02", "J03", "J06", "J069", "J31", "J310"], ["H65", "H67", "J04", "J05", "J30", "J32"])
# pneumonias: só as subcategorias listadas
confere(6, ["J13", "J139", "J14", "J153", "J154", "J158", "J159", "J181"], ["J12", "J15", "J150", "J151", "J152", "J155", "J156", "J157", "J180", "J182", "J189", "J17", "J19"])
confere(7, ["J45", "J450", "J46"], ["J48", "J49"])
confere(8, ["J20", "J21", "J40", "J41", "J42", "J43", "J44", "J449", "J47"], ["J22", "J39", "J48"])
confere(9, ["I10", "I109", "I11", "I119"], ["I09", "I12", "I13"])
confere(10, ["I20", "I209"], ["I19", "I21", "I25"])
confere(11, ["I50", "I509", "J81"], ["I49", "I51", "J80", "J82"])
confere(12, ["I63", "I64", "I65", "I66", "I67", "I69", "G45", "G46", "I679", "G459"], ["I62", "I68", "I70", "G44", "G47"])
# diabetes: E10–E14 com subcategoria 0–9 (e só com ela)
confere(13, [f"E1{d}{s}" for d in range(0, 5) for s in range(0, 10)], ["E10", "E11", "E14", "E09", "E099", "E15", "E150", "E16"])
confere(14, ["G40", "G41", "G419"], ["G39", "G42", "G43"])
# infecção urinária: N39.0 sim, N39 sem subcategoria e N39.1–N39.9 não
confere(15, ["N10", "N11", "N12", "N30", "N300", "N34", "N340", "N390"], ["N39", "N391", "N392", "N398", "N399", "N13", "N20", "N31", "N35"])
confere(16, ["A46", "L01", "L02", "L03", "L04", "L08", "L080"], ["A47", "L00", "L05", "L06", "L07", "L09"])
confere(17, ["N70", "N71", "N72", "N73", "N75", "N76", "N739"], ["N69", "N74", "N77"])
# úlcera: K25–K28 inteiros; K92.0–K92.2 sim, K92.3 em diante e K92 sem subcategoria não
confere(18, ["K25", "K250", "K26", "K27", "K28", "K289", "K920", "K921", "K922"], ["K24", "K29", "K923", "K928", "K929", "K92", "K91", "K93"])
confere(19, ["O23", "O230", "O239", "A50", "A500", "A509", "P350"], ["O22", "O24", "P351", "P359", "P35", "P34"])
# diagnósticos ausentes ou malformados
confere(None, [], [None, "", " ", "   ", "A", "A3", "-", "9999", "Z00", "I21"])
teste("minúsculas e espaços são normalizados", G(" j45 ") == 7 and G("n390") == 15 and G("k92.1") is None, (G(" j45 "), G("n390"), G("k92.1")))
# partos (denominador)
for c in ["O80", "O84", "O800", "O849", "o82", " O83 "]:
    teste(f"{c!r} é parto (fora do denominador)", m.eh_parto(c))
for c in ["O79", "O85", "O23", "O230", "O60", "A50", "", None, "O8"]:
    teste(f"{c!r} não é parto", not m.eh_parto(c))
teste("O23 (ICSAP, grupo 19) fica no denominador", m.grupo_do_diagnostico("O23") == 19 and not m.eh_parto("O23"))
# nenhum código em mais de um grupo (levanta ValueError se acontecer)
letras = string.ascii_uppercase
try:
    codigos = [f"{l}{n:02d}" for l in letras for n in range(100)] + [f"{l}{n:02d}{s}" for l in letras for n in range(100) for s in range(10)]
    por_grupo = {g: 0 for g in m.GRUPOS}
    for c in codigos:
        g = G(c)
        if g:
            por_grupo[g] += 1
    teste("nenhum código cai em dois grupos", True)
    teste("todos os grupos recebem códigos", all(por_grupo.values()), por_grupo)
except ValueError as e:
    teste("nenhum código cai em dois grupos", False, e)
# o SQL dá o mesmo grupo que a função Python, inclusive para entradas estranhas
con = duckdb.connect()
amostra = codigos + [None, "", " ", "a", "j45", " N390", "n39", "K92", "O23 ", "I69X", "E10 ", "123"]
con.execute("CREATE TABLE t (d VARCHAR)")
con.executemany("INSERT INTO t VALUES (?)", [(c,) for c in amostra])
sql = dict(con.execute(f"SELECT d, {m.sql_grupo('d')} FROM t WHERE d IS NOT NULL").fetchall())
difs = [(c, sql[c], G(c)) for c in set(amostra) if c is not None and sql.get(c) != G(c)]
teste("SQL e Python concordam em todos os códigos testados", not difs, difs[:5])
teste("diagnóstico nulo dá NULL no SQL", con.execute(f"SELECT {m.sql_grupo('NULL::VARCHAR')}").fetchone()[0] is None)

# destinos da gravação: a proteção olha os destinos efetivos (saida/gold/...), não só a --saida
import hashlib
import subprocess
import tempfile
from pathlib import Path


def fotografia(raiz: Path):
    """Todos os caminhos (pastas e arquivos) sob a raiz, com tamanho e hash dos arquivos."""
    out = {}
    for q in sorted(raiz.rglob("*")):
        out[q.relative_to(raiz).as_posix()] = None if q.is_dir() else (q.stat().st_size, hashlib.md5(q.read_bytes()).hexdigest())
    return out


with tempfile.TemporaryDirectory() as tmp:
    tmp = Path(tmp).resolve()
    base = tmp / "data" / "gold"
    (base / "saude").mkdir(parents=True)
    duckdb.connect().execute(f"COPY (SELECT 2024 AS ano, 510183 AS municipio, 1 AS populacao) TO '{(base / 'saude' / 'municipios.parquet').as_posix()}' (FORMAT parquet)")
    (base / "manifesto.json").write_text('{"fontes": {}, "gerado_em": "x"}', encoding="utf-8")
    antes = fotografia(tmp)
    inexistente = tmp / "micro_que_nao_existe"  # se a validação falhasse, o erro viria daqui (ou, pior, a gravação já teria ocorrido)
    casos = {
        "--saida E:/finbra/data com --base E:/finbra/data/gold (destino efetivo = o gold de origem)": tmp / "data",
        "--saida igual ao gold de origem": base,
        "--saida dentro do gold de origem": base / "saude",
        "--saida com ../ que volta ao pai do gold": tmp / "data" / "gold" / ".." / "gold" / "..",
        "--saida que é o próprio gold por caminho relativo ao pai": tmp / "data" / "x" / "..",
    }
    for nome, saida in casos.items():
        try:
            m.candidato(inexistente, base, saida)
            recusou = False
        except ValueError:
            recusou = True
        teste(f"recusa {nome}", recusou)
        teste(f"  e a origem fica intacta, sem pasta ou arquivo novo ({nome})", fotografia(tmp) == antes)
    # pela linha de comando: sai com erro e não escreve nada
    r = subprocess.run([sys.executable, str(Path(m.__file__).resolve()), "candidato", "--saida", str(tmp / "data"), "--base", str(base), "--micro", str(inexistente)],
                       capture_output=True, text=True, encoding="utf-8")
    teste("CLI recusa --saida que alcança o gold de origem (saída diferente de 0)", r.returncode != 0 and "destino inválido" in (r.stderr + r.stdout), (r.returncode, r.stderr[-200:]))
    teste("  e a origem segue intacta depois da CLI", fotografia(tmp) == antes)
    # uma pasta separada passa na validação (e a validação em si não cria nada)
    for ok_saida in (tmp / "candidato", tmp / "outra" / "pasta"):
        try:
            m.validar_destinos(base, ok_saida)
            passou = True
        except ValueError as e:
            passou = False
        teste(f"aceita uma pasta separada ({ok_saida.name})", passou)
    teste("a validação não criou nada", fotografia(tmp) == antes)

print(f"{len(codigos)} códigos de 3 e 4 caracteres varridos; por grupo: {por_grupo}")
if falhas:
    print(f"\n{len(falhas)} teste(s) falharam")
    sys.exit(1)
print("\ntodos os testes passaram")
