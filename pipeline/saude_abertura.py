"""Pacote de abertura do painel de saúde (/datasus): as séries JÁ publicadas, empacotadas para o navegador mostrar os indicadores,
as contagens e a despesa do SIOPS SEM DuckDB-WASM e sem baixar arquivos financeiros. Nenhum Parquet é alterado ou recalculado: o pacote
reproduz, com as mesmas expressões SQL das rotas do site (saude_serie, entes, saude_colunas e a projeção de se_ente/se_grupo), o que o motor
devolveria.

Uso:  py pipeline/saude_abertura.py --base <raiz-com-gold> --saida <pasta-candidata> [--substituir]

  --base    raiz com gold/saude/municipios.parquet, gold/saude_educacao.parquet, silver/entes.parquet, gold/indicadores.parquet,
            gold/ipca.parquet e gold/manifesto.json (ex.: E:/finbra/data). SOMENTE LEITURA: a saída não pode ser a base, estar dentro
            dela nem conter a base (conferido antes de qualquer mkdir).
  --saida   pasta candidata. Recebe gold/saude/abertura_<sha12>.ndjson, gold/saude/abertura_indice_<sha12>.json e uma CÓPIA do manifesto
            com aberturas.saude e gerado_em novo. Os demais arquivos e o manifesto da base não são tocados.

Formato (versão 1):
  abertura_<sha12 do conteúdo>.ndjson   uma linha UTF-8 por grupo, terminada em "\\n". Grupo = "BR", sigla da UF, ou código do ente (7 dígitos;
        o DF tem DUAS chaves: 5300108 só com a série de saúde e 53 só com o SIOPS, como as rotas atuais):
        {"g": <grupo>, "s": <snapshot>, "a": [anos], "m": [municípios por ano], "r": [[valores na ordem de `serie` do índice], ...],
         "p": [[ano, saude_hab, saude_proprios_hab], ...]}
        a/m/r = saude_serie (soma das contagens por ano; null continua null e zero real continua 0); p = SIOPS (despesa por habitante em
        reais do ano-base do IPCA, valor * indice_base / indice_ano, como o motor; BR e UF só dos municípios, soma ÷ soma, nunca média).
  abertura_indice_<sha12>.json          versão, snapshot, gerado_em (o do manifesto novo), base_ipca, hashes das cinco origens, colunas
        (saude_colunas), serie (colunas de `r`), entes (cadastro idêntico à rota `entes`), aliases, grupos e tamanhos (bytes UTF-8 de cada
        linha, "\\n" incluído): o offset de cada grupo é a soma dos tamanhos anteriores. O navegador lê o índice e UM Range por recorte.
Os nomes levam o hash do conteúdo: objetos imutáveis. O manifesto só anuncia o pacote para o MESMO gerado_em: qualquer atualização posterior
do manifesto sem regerar este pacote faz o site voltar ao motor (correção antes da velocidade). Gere este pacote POR ÚLTIMO.
"""
import argparse
import copy
import hashlib
import json
import math
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from clima_abertura import eh_link, lit, sha_arquivo, validar_finais

VERSAO = 1
ORIGENS = {
    "municipios": "gold/saude/municipios.parquet",
    "saude_educacao": "gold/saude_educacao.parquet",
    "entes": "silver/entes.parquet",
    "indicadores": "gold/indicadores.parquet",
    "ipca": "gold/ipca.parquet",
}
UFS = "AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO".split()
CHAVES_SAUDE = ("ano", "cod_ibge", "municipio", "nome", "uf")  # = CHAVES_SAUDE de dados.ts
SE_REAIS = ("aluno_basica", "aluno_infantil", "aluno_fundamental", "professores_aluno", "educacao_liquidada", "despesa_liquidada",
            "saude_hab", "saude_proprios_hab", "sus_hab", "saude_total", "saude_proprios", "sus_receita")  # = SE_REAIS de dados.ts
ALIASES = {"saude": {"53": "5300108"}}  # saude_serie mapeia ente=53 para o município de Brasília; se_ente usa 53 como está
PADRAO_ARQ = "abertura_{}.ndjson"
PADRAO_IDX = "abertura_indice_{}.json"
LOTE = 2000


def validar_destinos(base: Path, saida: Path, substituir: bool) -> None:
    """Falha ANTES de qualquer mkdir ou escrita: a saída não toca a base e não substitui nada sem --substituir."""
    b, s = base.resolve(), saida.resolve()
    g = s / "gold"
    c = g / "saude"
    for alvo in (s, g, c, g / "manifesto.json"):
        t = alvo.resolve()
        if t == b or t.is_relative_to(b) or b.is_relative_to(t):
            raise ValueError(f"destino sobre a base (somente leitura): {t}")
    if c.exists() and any(eh_link(p) for p in (s, g, c)):
        raise ValueError("a saída não pode passar por links simbólicos")
    if not substituir and (g / "manifesto.json").exists():
        raise ValueError(f"destino já existe (use --substituir só em pasta candidata): {g / 'manifesto.json'}")


def serializar(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def num(v):
    """Número JSON: inteiro quando o valor é inteiro (o mesmo Number no JavaScript), -0 preservado; None continua None."""
    if v is None:
        return None
    if isinstance(v, float):
        if not math.isfinite(v):
            raise ValueError("valor não finito na origem")
        if v.is_integer() and abs(v) < 1e15 and not (v == 0 and math.copysign(1, v) < 0):
            return int(v)
    return v


def chave_grupo(g: str) -> tuple:
    """BR primeiro, depois as UFs (siglas), depois os entes por código: ordem estável e verificável."""
    return (0, g) if g == "BR" else (1, g) if g.isalpha() else (2, int(g))


def lotes(cur):
    while True:
        bloco = cur.fetchmany(LOTE)
        if not bloco:
            return
        yield from bloco


def agrupar(linhas, n_chave: int):
    """(chave, [linhas]) de uma sequência já ordenada pela chave; uma chave de cada vez, sem juntar o resultado inteiro."""
    atual, acc = object(), []
    for r in linhas:
        k = r[:n_chave]
        if k != atual:
            if acc:
                yield atual, acc
            atual, acc = k, []
        acc.append(r)
    if acc:
        yield atual, acc


def abrir() -> duckdb.DuckDBPyConnection:
    # uma thread: a soma dos DOUBLE segue a ordem do arquivo, como no motor do navegador (uma thread só)
    return duckdb.connect(config={"threads": 1})


def colunas_da_tabela(con, caminho: Path) -> list[str]:
    cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM read_parquet({lit(caminho)})").fetchall()]
    if len(set(cols)) != len(cols) or any(k not in cols for k in CHAVES_SAUDE):
        raise ValueError("municipios.parquet sem as colunas-chave esperadas")
    return cols


def sql_serie(caminho: Path, grupo: str) -> tuple[str, int]:
    """Mesma expressão de saude_serie (dados.ts) agrupando por BR, UF ou município; devolve (sql, nº de colunas de chave)."""
    soma = f"sum(COLUMNS(* EXCLUDE ({', '.join(CHAVES_SAUDE)})))::DOUBLE"
    f = f"read_parquet({lit(caminho)}) m"
    if grupo == "BR":
        return f"SELECT ano, count(cod_ibge)::INTEGER AS municipios, {soma} FROM {f} GROUP BY ano ORDER BY ano", 0
    if grupo == "UF":
        ufs = ", ".join(f"'{u}'" for u in UFS)
        return (f"SELECT uf, ano, count(cod_ibge)::INTEGER AS municipios, {soma} FROM {f} WHERE uf IN ({ufs}) GROUP BY uf, ano ORDER BY uf, ano", 1)
    return (f"SELECT cod_ibge, ano, count(cod_ibge)::INTEGER AS municipios, {soma} FROM {f} WHERE cod_ibge IS NOT NULL "
            f"GROUP BY cod_ibge, ano ORDER BY cod_ibge, ano", 1)


def criar_se(con, base: Path, base_ipca: int) -> None:
    """A tabela `se` do motor (tabelaSaudeEducacao em dados.ts): colunas em reais corrigidas por indice_base / indice_ano."""
    reais = ", ".join(f"s.{c} * b.indice / i.indice AS {c}" for c in SE_REAIS)
    con.execute(
        f"""CREATE TEMP TABLE se AS
            SELECT s.* REPLACE ({reais}), CASE WHEN s.ano >= 2021 THEN 70 ELSE 60 END AS min_fundeb
            FROM read_parquet({lit(base / ORIGENS['saude_educacao'])}) s
            LEFT JOIN (SELECT * FROM read_parquet({lit(base / ORIGENS['ipca'])})) i ON i.exercicio = s.ano
            CROSS JOIN (SELECT indice FROM read_parquet({lit(base / ORIGENS['ipca'])}) WHERE exercicio = {int(base_ipca)}) b""")


def por_hab(v: str, pop: str) -> str:
    return f"sum({v}) FILTER ({v} IS NOT NULL AND {pop} > 0) / sum({pop}) FILTER ({v} IS NOT NULL AND {pop} > 0)"  # = porHab de se_grupo


def siops_grupos(con) -> tuple[dict, dict, list]:
    """SIOPS: por ente (se_ente), por UF e Brasil só dos municípios (se_grupo com esfera M). Os três campos que o painel usa."""
    campos = f"{por_hab('saude_total', 'populacao_siops')} AS saude_hab, {por_hab('saude_proprios', 'populacao_siops')} AS saude_proprios_hab"
    ente: dict[str, list] = {}
    for cod, ano, h, p in con.execute("SELECT cod_ibge, ano, saude_hab, saude_proprios_hab FROM se ORDER BY cod_ibge, ano").fetchall():
        linhas = ente.setdefault(str(cod), [])
        if linhas and linhas[-1][0] == ano:
            raise ValueError(f"ente {cod} com o ano {ano} repetido em saude_educacao")
        linhas.append([int(ano), num(h), num(p)])
    ufs = ", ".join(f"'{u}'" for u in UFS)
    uf: dict[str, list] = {}
    for u, ano, h, p in con.execute(
            f"SELECT s.uf, ano, {campos} FROM se s WHERE s.esfera = 'M' AND s.uf IN ({ufs}) GROUP BY s.uf, ano ORDER BY s.uf, ano").fetchall():
        uf.setdefault(u, []).append([int(ano), num(h), num(p)])
    br = [[int(a), num(h), num(p)] for a, h, p in con.execute(f"SELECT ano, {campos} FROM se s WHERE s.esfera = 'M' GROUP BY ano ORDER BY ano").fetchall()]
    return ente, uf, br


SQL_ENTES = """SELECT e.cod_ibge, e.nome, e.uf, e.esfera, e.capital FROM read_parquet({entes}) e
               WHERE e.esfera <> 'U' AND EXISTS (SELECT 1 FROM read_parquet({ind}) i WHERE i.cod_ibge = e.cod_ibge)
               ORDER BY e.esfera DESC, e.uf, e.nome, e.cod_ibge"""  # a rota `entes` (dados.ts) com o código só como desempate determinístico


def cadastro(con, base: Path) -> list:
    linhas = con.execute(SQL_ENTES.format(entes=lit(base / ORIGENS["entes"]), ind=lit(base / ORIGENS["indicadores"]))).fetchall()
    if not linhas:
        raise ValueError("cadastro de entes vazio")
    return [[int(c), n, u, e, k] for c, n, u, e, k in linhas]


def snapshot_de(origem: dict, base_ipca: int) -> str:
    return hashlib.sha256(serializar({"versao": VERSAO, "origem": origem, "base_ipca": base_ipca}).encode("utf-8")).hexdigest()[:12]


def gerar_linhas(base: Path, base_ipca: int, snap: str, spool, progresso=None):
    """Escreve o NDJSON em `spool` (arquivo temporário FORA da base e da saída), um grupo de cada vez, e devolve
    (grupos, tamanhos, sha256, bytes, colunas, serie, entes)."""
    con = abrir()
    try:
        mun = base / ORIGENS["municipios"]
        colunas = colunas_da_tabela(con, mun)
        serie = [c for c in colunas if c not in CHAVES_SAUDE]
        criar_se(con, base, base_ipca)
        s_ente, s_uf, s_br = siops_grupos(con)
        entes = cadastro(con, base)

        def fonte(grupo):
            sql, nk = sql_serie(mun, grupo)
            cur = con.execute(sql)
            nomes = [d[0] for d in cur.description][nk + 2:]
            if nomes != serie:
                raise ValueError("as colunas somadas diferem das do arquivo")
            for k, linhas in agrupar(lotes(cur), nk):
                yield (k[0] if nk else "BR"), [r[nk:] for r in linhas]

        def montar(g, saude, siops):
            return {"g": g, "s": snap, "a": [int(r[0]) for r in saude], "m": [int(r[1]) for r in saude],
                    "r": [[num(v) for v in r[2:]] for r in saude], "p": siops}

        h, grupos, tamanhos, total = hashlib.sha256(), [], [], 0

        def escrever(obj):
            nonlocal total
            b = (serializar(obj) + "\n").encode("utf-8")
            spool.write(b)
            h.update(b)
            grupos.append(obj["g"])
            tamanhos.append(len(b))
            total += len(b)
            if progresso and len(grupos) % 1000 == 0:
                progresso(f"{len(grupos)} grupos, {total / 1e6:.1f} MB")

        for g, s in fonte("BR"):
            escrever(montar("BR", s, s_br))
        saude_uf = dict(fonte("UF"))
        for u in UFS:
            if u not in saude_uf:
                raise ValueError(f"UF {u} sem linhas em municipios.parquet")
            escrever(montar(u, saude_uf[u], s_uf.get(u, [])))
        # municípios (saúde) e entes (SIOPS): uma linha por código na união, em ordem crescente; os dois lados são lidos em ordem
        cods_saude = {r[0] for r in con.execute(f"SELECT DISTINCT cod_ibge FROM read_parquet({lit(mun)}) WHERE cod_ibge IS NOT NULL").fetchall()}
        ordem = sorted(cods_saude | {int(k) for k in s_ente})
        it = fonte("MUN")
        atual = next(it, None)
        for cod in ordem:
            saude = []
            if atual is not None and int(atual[0]) == cod:
                saude = atual[1]
                atual = next(it, None)
            escrever(montar(str(cod), saude, s_ente.get(str(cod), [])))
        if atual is not None:
            raise ValueError("município fora da ordem de empacotamento")
        spool.flush()
        return grupos, tamanhos, h.hexdigest(), total, colunas, serie, entes
    finally:
        con.close()


def decodificar_grupo(dados: bytes, g: str, snapshot: str, n_serie: int) -> dict:
    """Valida uma linha como o navegador."""
    if not dados.endswith(b"\n"):
        raise ValueError(f"linha do grupo {g} sem fim de linha")
    o = json.loads(dados.decode("utf-8"))
    if o["g"] != g or o["s"] != snapshot:
        raise ValueError(f"linha do grupo {g} não corresponde ao índice")
    if not (len(o["a"]) == len(o["m"]) == len(o["r"])) or any(len(r) != n_serie for r in o["r"]):
        raise ValueError(f"série do grupo {g} malformada")
    if any(len(p) != 3 for p in o["p"]):
        raise ValueError(f"SIOPS do grupo {g} malformado")
    return o


def igual(a, b, tol: float) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return math.isclose(float(a), float(b), rel_tol=tol, abs_tol=tol) if tol else float(a) == float(b)


def conferir(base: Path, spool: Path, indice: dict, base_ipca: int) -> dict:
    """Validação INTEGRAL contra a origem, por um caminho independente do SQL do gerador: as linhas brutas são lidas e somadas em Python.
    Município: igualdade exata (null≠0). UF e Brasil: soma na ordem do Python, tolerância relativa de 1e-9 só para ponto flutuante."""
    snap, grupos, tamanhos = indice["snapshot"], indice["grupos"], indice["tamanhos"]
    serie = indice["serie"]
    pos, off = {}, 0
    for g, n in zip(grupos, tamanhos):
        pos[g] = (off, n)
        off += n
    if off != spool.stat().st_size or len(pos) != len(grupos):
        raise ValueError("tamanhos do índice não fecham com o pacote")
    cache: dict = {}
    with spool.open("rb") as f:
        def lido(g):
            if g not in cache:
                o, n = pos[g]
                f.seek(o)
                cache[g] = decodificar_grupo(f.read(n), g, snap, len(serie))
                if len(cache) > 50:
                    cache.pop(next(iter(cache)))
            return cache[g]

        con = abrir()
        try:
            colunas = indice["colunas"]
            if [c for c in colunas if c not in CHAVES_SAUDE] != serie:
                raise ValueError("colunas do índice diferem do arquivo")
            ix = {c: i for i, c in enumerate(colunas)}
            vi = [ix[c] for c in serie]
            acc_br: dict = {}
            acc_uf: dict = {}
            n_mun = checadas = 0

            def somar(acc, chave, linha, tem_cod):
                a = acc.setdefault(chave, {"m": 0, "v": [None] * len(vi)})
                a["m"] += 1 if tem_cod else 0
                v = a["v"]
                for k, i in enumerate(vi):
                    x = linha[i]
                    if x is not None:
                        v[k] = x if v[k] is None else v[k] + x

            vistos = set()
            # A ordem por município mantém seu grupo no cache durante todos os anos: evita decodificar
            # a mesma série inteira a cada linha de um Parquet ordenado primeiro por ano.
            cur = con.execute(f"SELECT {', '.join(colunas)} FROM read_parquet({lit(base / ORIGENS['municipios'])}) ORDER BY cod_ibge, ano")
            for r in lotes(cur):
                ano, cod, uf = r[ix["ano"]], r[ix["cod_ibge"]], r[ix["uf"]]
                somar(acc_br, ano, r, cod is not None)
                if uf in UFS:
                    somar(acc_uf, (uf, ano), r, cod is not None)
                if cod is None:
                    continue
                if (cod, ano) in vistos:
                    raise ValueError(f"município {cod} com o ano {ano} repetido na origem")
                vistos.add((cod, ano))
                o = lido(str(cod))
                if ano not in o["a"]:
                    raise ValueError(f"município {cod}/{ano} ausente do pacote")
                k = o["a"].index(ano)
                if o["m"][k] != 1 or any(not igual(r[i], o["r"][k][j], 0) for j, i in enumerate(vi)):
                    raise ValueError(f"município {cod}/{ano} difere da origem")
                n_mun += 1
                checadas += len(vi)
            vistos.clear()
            if sum(len(lido(g)["a"]) for g in grupos if g.isdigit()) != n_mun:
                raise ValueError("o pacote tem anos de município que a origem não tem")
            anos_br = sorted(acc_br)
            o = lido("BR")
            if o["a"] != anos_br:
                raise ValueError("anos do Brasil diferem da origem")
            for k, ano in enumerate(anos_br):
                if o["m"][k] != acc_br[ano]["m"] or any(not igual(acc_br[ano]["v"][j], o["r"][k][j], 1e-9) for j in range(len(vi))):
                    raise ValueError(f"Brasil/{ano} difere da origem")
                checadas += len(vi)
            for u in UFS:
                anos_u = sorted(a for (x, a) in acc_uf if x == u)
                o = lido(u)
                if o["a"] != anos_u:
                    raise ValueError(f"anos da UF {u} diferem da origem")
                for k, ano in enumerate(anos_u):
                    a = acc_uf[(u, ano)]
                    if o["m"][k] != a["m"] or any(not igual(a["v"][j], o["r"][k][j], 1e-9) for j in range(len(vi))):
                        raise ValueError(f"UF {u}/{ano} difere da origem")
                    checadas += len(vi)
            # SIOPS: valores brutos deflacionados em Python; o ente em igualdade exata, as agregações UF/BR com tolerância
            ipca = dict(con.execute(f"SELECT exercicio, indice FROM read_parquet({lit(base / ORIGENS['ipca'])})").fetchall())
            b = ipca[base_ipca]
            reais = {c: i for i, c in enumerate(SE_REAIS)}
            cur = con.execute(f"SELECT ano, cod_ibge, uf, esfera, saude_total, saude_proprios, populacao_siops, saude_hab, saude_proprios_hab "
                              f"FROM read_parquet({lit(base / ORIGENS['saude_educacao'])}) ORDER BY cod_ibge, ano")
            defl = lambda v, ano: None if v is None or ipca.get(ano) is None else v * b / ipca[ano]  # noqa: E731
            grp: dict = {}
            n_se = 0
            for ano, cod, uf, esf, total, proprios, pop, hab, prop_hab in lotes(cur):
                o = lido(str(cod))
                ps = {p[0]: p for p in o["p"]}
                p = ps.get(ano)
                if p is None or not igual(defl(hab, ano), p[1], 1e-12) or not igual(defl(prop_hab, ano), p[2], 1e-12):
                    raise ValueError(f"SIOPS do ente {cod}/{ano} difere da origem")
                n_se += 1
                if esf == "M":
                    for chave in ("BR", uf):
                        g = grp.setdefault((chave, ano), {"t": 0.0, "pt": 0.0, "pr": 0.0, "pp": 0.0, "nt": 0, "np": 0})
                        d = defl(total, ano)
                        if d is not None and pop is not None and pop > 0:
                            g["t"] += d
                            g["pt"] += pop
                            g["nt"] += 1
                        d = defl(proprios, ano)
                        if d is not None and pop is not None and pop > 0:
                            g["pr"] += d
                            g["pp"] += pop
                            g["np"] += 1
            if sum(len(lido(g)["p"]) for g in grupos if g.isdigit()) != n_se:
                raise ValueError("o pacote tem anos de SIOPS por ente que a origem não tem")
            for chave in ["BR"] + UFS:
                esperados = sorted(a for (c, a) in grp if c == chave)
                o = lido(chave)
                if [p[0] for p in o["p"]] != esperados:
                    raise ValueError(f"anos de SIOPS de {chave} diferem da origem")
                for p in o["p"]:
                    g = grp[(chave, p[0])]
                    if not igual(g["t"] / g["pt"] if g["nt"] else None, p[1], 1e-9) or not igual(g["pr"] / g["pp"] if g["np"] else None, p[2], 1e-9):
                        raise ValueError(f"SIOPS de {chave}/{p[0]} difere da origem")
            # cadastro: mesmos entes e campos que a rota `entes`, na mesma ordem
            bruto = con.execute(f"SELECT cod_ibge, nome, uf, esfera, capital FROM read_parquet({lit(base / ORIGENS['entes'])})").fetchall()
            tem = {r[0] for r in con.execute(f"SELECT DISTINCT cod_ibge FROM read_parquet({lit(base / ORIGENS['indicadores'])})").fetchall()}
            esperado = [[int(c), n, u, e, k] for c, n, u, e, k in bruto if e != "U" and c in tem]
            if any(x[1] is None or x[2] is None for x in esperado):
                raise ValueError("cadastro com nome ou UF nulo: a ordem não é verificável")
            esperado.sort(key=lambda x: (x[2], x[1].encode("utf-8"), x[0]))
            esperado.sort(key=lambda x: x[3], reverse=True)
            if esperado != indice["entes"]:
                raise ValueError("cadastro de entes difere da rota entes")
        finally:
            con.close()
    return {"celulas_saude": checadas, "anos_municipais": n_mun, "anos_siops_ente": n_se, "entes": len(indice["entes"]), "grupos": len(grupos)}


def preparar_temporario(destino: Path, fonte) -> Path:
    """Temporário EXCLUSIVO e aleatório ao lado do destino (O_EXCL: nunca segue um link existente)."""
    fd, nome = tempfile.mkstemp(dir=destino.parent, prefix=destino.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            if isinstance(fonte, (bytes, bytearray)):
                f.write(fonte)
            else:
                with Path(fonte).open("rb") as src:
                    shutil.copyfileobj(src, f, 1 << 20)
    except BaseException:
        Path(nome).unlink(missing_ok=True)
        raise
    return Path(nome)


def publicar(itens: list) -> None:
    """Escreve todos os temporários antes de trocar qualquer destino. Se algo falhar, os temporários saem, os objetos NOVOS já trocados
    (que não existiam antes) são removidos um a um e os destinos antigos ficam intactos: a saída anterior continua válida."""
    temporarios: list = []
    criados: list = []
    try:
        for destino, fonte in itens:
            temporarios.append((preparar_temporario(destino, fonte), destino))
        for tmp, destino in temporarios:
            novo = not destino.exists()
            os.replace(tmp, destino)
            if novo:
                criados.append(destino)
    except BaseException:
        for tmp, _ in temporarios:
            tmp.unlink(missing_ok=True)
        for destino in criados:
            destino.unlink(missing_ok=True)
        raise


def gerar(base, saida, substituir: bool = False, progresso=None) -> dict:
    base, saida = Path(base), Path(saida)
    validar_destinos(base, saida, substituir)
    faltam = [k for k, c in ORIGENS.items() if not (base / c).is_file()]
    mpath = base / "gold" / "manifesto.json"
    if faltam or not mpath.is_file():
        raise ValueError(f"base incompleta (precisa de {faltam or 'gold/manifesto.json'})")
    manifesto = json.loads(mpath.read_text(encoding="utf-8"))
    base_ipca = manifesto.get("base_ipca")
    if not isinstance(base_ipca, int) or not isinstance(manifesto.get("gerado_em"), str):
        raise ValueError("o manifesto da base não tem base_ipca e gerado_em")
    origem = {k: sha_arquivo(base / c) for k, c in ORIGENS.items()}
    snap = snapshot_de(origem, base_ipca)
    fd, nome = tempfile.mkstemp(prefix="saude_abertura_", suffix=".spool")
    spool = Path(nome)
    try:
        sr = spool.resolve()
        if sr.is_relative_to(base.resolve()) or sr.is_relative_to(saida.resolve()):
            raise ValueError("a pasta temporária do sistema está dentro da base ou da saída")
        with os.fdopen(fd, "wb") as f:
            grupos, tamanhos, h, total, colunas, serie, entes = gerar_linhas(base, base_ipca, snap, f, progresso)
        if len(grupos) != len(set(grupos)) or sorted(grupos, key=chave_grupo) != grupos:
            raise ValueError("grupos fora de ordem ou repetidos")
        agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
        if agora == manifesto["gerado_em"]:
            raise ValueError("gerado_em igual ao do manifesto da base: aguarde um segundo")
        nome_arq = PADRAO_ARQ.format(h[:12])
        indice = {
            "versao": VERSAO, "snapshot": snap, "arquivo": nome_arq, "sha256": h, "bytes": total, "gerado_em": agora, "base_ipca": base_ipca,
            "origem": origem, "colunas": colunas, "serie": serie, "siops": ["saude_hab", "saude_proprios_hab"], "aliases": ALIASES,
            "entes": entes, "grupos": grupos, "tamanhos": tamanhos,
        }
        if progresso:
            progresso("conferindo contra a origem")
        resumo = conferir(base, spool, indice, base_ipca)
        if any(sha_arquivo(base / c) != origem[k] for k, c in ORIGENS.items()):
            raise ValueError("a origem mudou durante a geração; nada foi anunciado")
        corpo_indice = serializar(indice).encode("utf-8")
        hi = hashlib.sha256(corpo_indice).hexdigest()
        out = saida / "gold" / "saude"
        nome_idx = PADRAO_IDX.format(hi[:12])
        finais = [out / nome_arq, out / nome_idx, saida / "gold" / "manifesto.json"]
        validar_finais(base, saida, finais)  # antes de qualquer mkdir ou escrita
        # objetos imutáveis: mesmo nome só com o mesmo conteúdo
        if finais[0].exists() and sha_arquivo(finais[0]) != h:
            raise ValueError(f"{finais[0].name} já existe com outro conteúdo: objetos imutáveis não são sobrescritos")
        if finais[1].exists() and finais[1].read_bytes() != corpo_indice:
            raise ValueError(f"{finais[1].name} já existe com outro conteúdo: objetos imutáveis não são sobrescritos")
        novo = copy.deepcopy(manifesto)
        novo["gerado_em"] = agora  # a versão dos URLs HTTP vem daqui: invalida o cache anterior
        anuncio = {
            "versao": VERSAO, "indice": f"gold/saude/{nome_idx}", "indice_sha256": hi, "indice_bytes": len(corpo_indice),
            "arquivo": f"gold/saude/{nome_arq}", "sha256": h, "bytes": total, "snapshot": snap, "grupos": len(grupos),
            "gerado_em": agora, "origem": origem, "processado_em": agora,
        }
        novo["aberturas"] = {**(manifesto.get("aberturas") or {}), "saude": anuncio}
        out.mkdir(parents=True, exist_ok=True)
        validar_finais(base, saida, finais)  # de novo, já com as pastas criadas
        itens = [(finais[1], corpo_indice)]
        if not (finais[0].exists() and finais[0].stat().st_size == total):
            itens.insert(0, (finais[0], spool))
        # o manifesto é o último: só anuncia o pacote depois de os dois objetos estarem no lugar
        publicar(itens + [(finais[2], json.dumps(novo, ensure_ascii=False, indent=1).encode("utf-8"))])
        return {**anuncio, "conferido": resumo}
    finally:
        spool.unlink(missing_ok=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--substituir", action="store_true", help="permite sobrescrever o manifesto de uma saída candidata anterior")
    a = ap.parse_args()
    print(json.dumps(gerar(a.base, a.saida, a.substituir, lambda m: print(m, file=sys.stderr, flush=True)), ensure_ascii=False))


if __name__ == "__main__":
    main()
