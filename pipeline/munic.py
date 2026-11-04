"""MUNIC (Pesquisa de Informações Básicas Municipais) e ESTADIC (estaduais) do IBGE: respostas por município/UF e edição.

Entrada (HD externo): E:/finbra/brutos/munic/*.zip|xlsx e E:/finbra/brutos/estadic/*.zip|xlsx, baixados de
https://ftp.ibge.gov.br/Perfil_Municipios/ e https://ftp.ibge.gov.br/Perfil_Estados/. Cada edição é uma planilha larga (uma aba por
tema, uma coluna por pergunta, cabeçalho com o código da variável) mais a aba "Dicionário", que dá o enunciado de cada código.

Saída (gold/munic/):
  catalogo.parquet     uma linha por pergunta e edição: tema, subtema, enunciado completo, tipo e cobertura
  respostas.parquet    pesquisa, ano, cod (município de 7 dígitos ou UF de 2), var, valor_txt, valor_num, valida (só respostas dadas)
  agregados.parquet    por edição, pergunta, recorte (Brasil, UF, faixa de porte) e resposta: quantos territórios (e soma e média)
  territorio.parquet   território × edição: nome, UF, região, população e faixa de porte (a mesma regra em todas as edições)
  comparaveis.parquet  perguntas de edições diferentes com o mesmo enunciado (agrupamento automático, a revisar)

Regras: a aba do prefeito e a de estrutura política ficam de fora (nome, partido e perfil de uma pessoa identificável); perguntas
de nome, e-mail, telefone ou endereço e as de texto livre (muitas respostas distintas) também. Resposta em branco não vira linha: o
município que não respondeu fica sem valor (NULL), nunca zero. "Não informou", "Recusa" e afins são mantidos como resposta de texto e
marcados em valida = false para não entrarem nos percentuais.
"""
import argparse
import json
import os
import re
import tempfile
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from config import GOLD, UF_POR_CODIGO
from leitor_planilha import Planilha

GOLD_M = GOLD / "munic"
BRUTOS = Path(os.environ.get("MUNIC_BRUTOS", "E:/finbra/brutos"))

ABAS_FORA = re.compile(r"dicion|notas|vari[aá]veis? externas?|prefeit|estrutura pol", re.I)
ROTULO_PESSOAL = re.compile(r"\bnome\b|e-?mail|telefone|\bfax\b|endere[cç]o|\bcpf\b|\bcnpj\b|\bsite\b|\bhome ?page\b", re.I)
# colunas de identificação do território que vêm antes das perguntas nas edições recentes
COLUNAS_TERRITORIO = {"codmun", "uf", "cod uf", "coduf", "mun", "popmun", "popuf", "faixa_pop", "faixa_populacao", "regiao", "região",
                      "sigla uf", "nome uf", "cod_uf", "sigla", "nome"}
# respostas que dizem "sem resposta válida" (ficam na base, mas fora dos percentuais)
SEM_RESPOSTA = re.compile(r"^(\(?\*+\)?\s*)?(n[aã]o (informou|informad[oa]|soube.*|sabe.*|aplic[aá]vel|respondeu)|recusa|ignorad[oa]|sem informa[cç][aã]o|-+|\.+|x)$", re.I)
# perfil de uma pessoa identificável (gestor, secretário, titular do órgão): sexo, idade, cor ou raça, escolaridade, formação
PERFIL_PESSOA = re.compile(r"perfil d[oa]s? (gestor|titular|dirigente|secret|respons|prefeit)|"
                           r"(sexo|idade|cor ou ra[çc]a|escolaridade|forma[cç][aã]o)\s+d[oa](\(a\))?s?\s+(\(a\)\s*)?(gestor|titular|dirigente|secret|respons|prefeit)", re.I)
MAX_TEXTOS_DISTINTOS = 60
# distrito estadual com código de município que a base de população da saúde não tem
SEM_CADASTRO = {2605459: ("Fernando de Noronha", "PE")}
FAIXAS = [(5000, "Até 5.000"), (10000, "5.001 a 10.000"), (20000, "10.001 a 20.000"), (50000, "20.001 a 50.000"),
          (100000, "50.001 a 100.000"), (500000, "100.001 a 500.000"), (float("inf"), "Mais de 500.000")]


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def limpar(s) -> str:
    return re.sub(r"\s+", " ", str(s)).strip()


def tirar_nota(s: str) -> str:
    """Remove notas de rodapé no fim do enunciado: '(1)', '(2) (3)'."""
    return re.sub(r"(\s*\(\d+\))+\s*$", "", s).strip()


def tirar_numeracao(s: str) -> str:
    return re.sub(r"^\d+(\.\d+)*\.?\s*", "", s).strip()


def edicoes() -> list[dict]:
    """Arquivos a ler: [{pesquisa, ano, modulo, arquivo}]. As tabelas publicadas de 2001 e 2002 não têm base por município."""
    saida = []
    for pesquisa in ("munic", "estadic"):
        for f in sorted((BRUTOS / pesquisa).glob("*")):
            m = re.match(r"^(\d{4})_", f.name)
            if not m or f.suffix.lower() not in (".zip", ".xls", ".xlsx"):
                continue
            if pesquisa == "munic" and int(m.group(1)) <= 2002:
                continue
            saida.append({"pesquisa": pesquisa, "ano": int(m.group(1)), "modulo": "AS" if "_AS_" in f.name else "", "arquivo": f})
    return saida


def abrir(ed: dict, tmp: Path) -> Planilha:
    f = ed["arquivo"]
    if f.suffix.lower() == ".zip":
        with zipfile.ZipFile(f) as z:
            nome = next(i.filename for i in z.infolist() if i.filename.lower().endswith((".xls", ".xlsx")))
            destino = tmp / f"{ed['pesquisa']}{ed['ano']}{ed['modulo']}{Path(nome).suffix.lower()}"
            destino.write_bytes(z.read(nome))
        f = destino
    return Planilha(f)


def ler_dicionario(pl: Planilha, codigos: set[str]) -> dict[str, dict]:
    """Código da variável → {tema, subtema, rotulo}. O dicionário é uma lista com recuo: seções numeradas, subtítulos e perguntas
    (as perguntas trazem o código numa coluna à direita); as perguntas filhas ficam mais à direita que a pergunta-mãe."""
    aba = next(a for a in pl.abas if a.lower().startswith("dic"))
    tema = subtema = ""
    pilha: list[tuple[int, str]] = []
    achado: dict[str, dict] = {}
    for linha in pl.linhas(aba):
        cel = [(i, limpar(c)) for i, c in enumerate(linha) if limpar(c) != ""]
        if not cel:
            continue
        cods = [c.lower() for _, c in cel if c.lower() in codigos]
        textos = [(i, c) for i, c in cel if c.lower() not in codigos and not isinstance(linha[i], float)
                  and not re.match(r"^(vari[aá]vel|t[ií]tulo link|subt[ií]tulo link)", c, re.I)]
        if not textos:
            continue
        col, rot = textos[0]
        if rot.lower().startswith(("fonte", "*", "nota")):
            continue
        if not cods:
            if re.match(r"^\d+\.\s*\S", rot):
                tema, subtema, pilha = tirar_numeracao(rot), "", []
            else:
                subtema, pilha = tirar_numeracao(rot), []
            continue
        rot = tirar_nota(rot)
        while pilha and pilha[-1][0] >= col:
            pilha.pop()
        caminho = ([subtema] if subtema and not rot.startswith(subtema) else []) + [r for _, r in pilha if not r.startswith(subtema)] + [rot]
        pilha.append((col, rot))
        for c in cods:
            achado.setdefault(c, {"tema": tema, "subtema": subtema, "rotulo": " › ".join(caminho)})
    return achado


def dv_ibge(cod6: int) -> int:
    """Dígito verificador do código de município do IBGE (pesos 1 e 2 alternados, soma dos algarismos dos produtos)."""
    soma = 0
    for i, ch in enumerate(f"{cod6:06d}"):
        p = int(ch) * (1 if i % 2 == 0 else 2)
        soma += p // 10 + p % 10
    return (10 - soma % 10) % 10


def cod_territorio(v) -> int | None:
    try:
        n = int(float(v))
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def processar_edicao(ed: dict, tmp: Path, mun6a7: dict[int, int]):
    """Lê uma edição: devolve (catálogo, respostas em colunas, território)."""
    pl = abrir(ed, tmp)
    cabs: dict[str, list[str]] = {}
    for a in pl.abas:
        if not re.match(r"dicion|notas", a, re.I):
            cabs[a] = [limpar(c) for c in next(pl.linhas(a), [])]
    # colunas de identificação que se repetem em todas as abas (nome, população, classe de porte) não são perguntas
    em_abas: dict[str, int] = {}
    for cab in cabs.values():
        for c in set(x.lower() for x in cab[1:] if x):
            em_abas[c] = em_abas.get(c, 0) + 1
    vistos: set[str] = set()
    dic = ler_dicionario(pl, {c.lower() for cab in cabs.values() for c in cab[1:] if c})
    ano, pesq, modulo = ed["ano"], ed["pesquisa"], ed["modulo"]
    cat: list[dict] = []
    resp: dict[str, list] = {"cod": [], "var": [], "txt": [], "num": [], "valida": []}
    terr: dict[int, dict] = {}

    def novo_cod(linha):
        n = cod_territorio(linha[0]) if linha else None
        if n is None:
            return None
        if pesq == "munic":
            # as edições até 2013 trazem o código de 6 dígitos: o de 7 vem do cadastro ou do dígito verificador
            if n < 1_000_000:
                return mun6a7.get(n) or (n * 10 + dv_ibge(n) if 110_000 <= n <= 539_999 else None)
            return n if n <= 5_400_000 else None
        return n if 10 <= n <= 53 else None

    for aba, cab in cabs.items():
        dados = list(pl.linhas(aba))[1:]
        cods = [novo_cod(l) for l in dados]
        validos = [i for i, c in enumerate(cods) if c is not None]
        for j, nome in enumerate(cab):
            n = nome.lower()
            if n in ("popmun", "popuf", "pop"):
                for i in validos:
                    v = dados[i][j] if j < len(dados[i]) else ""
                    terr.setdefault(cods[i], {})["pop"] = v if isinstance(v, float) else None
            elif n in ("regiao", "região"):
                for i in validos:
                    v = dados[i][j] if j < len(dados[i]) else ""
                    terr.setdefault(cods[i], {})["regiao"] = limpar(v).split(" - ")[-1] or None
        if ABAS_FORA.search(aba):
            continue
        for j, nome in enumerate(cab):
            if j == 0 or not nome or nome.lower() in COLUNAS_TERRITORIO or nome.lower() not in dic:
                continue
            if em_abas[nome.lower()] >= 3 or nome.lower() in vistos:
                continue  # repetida em várias abas: identificação do território, ou a mesma variável já lida
            vistos.add(nome.lower())
            info = dic[nome.lower()]
            if ROTULO_PESSOAL.search(info["rotulo"]) or PERFIL_PESSOA.search(info["rotulo"]):
                continue
            var = f"{modulo}:{nome}" if modulo else nome
            vals = [(cods[i], dados[i][j] if j < len(dados[i]) else "") for i in validos]
            vals = [(c, v) for c, v in vals if not (isinstance(v, str) and limpar(v) == "") and v != ""]
            if not vals:
                continue
            n_num = sum(isinstance(v, float) for _, v in vals)
            if len({limpar(v) for _, v in vals if isinstance(v, str)}) > MAX_TEXTOS_DISTINTOS and n_num < len(vals) / 2:
                continue  # texto livre: não entra
            tipo = "numerica" if n_num >= 0.9 * len(vals) else "categorica"
            n_validas = 0
            for c, v in vals:
                if isinstance(v, float):
                    t, x, ok = None, v, True
                else:
                    t, x = limpar(v), None
                    ok = not SEM_RESPOSTA.match(t)
                resp["cod"].append(c); resp["var"].append(var); resp["txt"].append(t); resp["num"].append(x); resp["valida"].append(ok)
                n_validas += ok
            cat.append({"pesquisa": pesq, "ano": ano, "var": var, "aba": aba, **info, "tipo": tipo, "n_respostas": len(vals),
                        "n_validas": n_validas, "n_territorios": len(validos)})
    pl.fechar()
    return cat, resp, terr


def dimensao_municipios(con) -> tuple[dict[int, int], dict[int, tuple]]:
    """Código de 6 → 7 dígitos, nome e UF, a partir da base de população da saúde (a mesma do restante do site)."""
    arq = GOLD / "saude" / "municipios.parquet"
    linhas = con.execute(f"SELECT DISTINCT municipio, cod_ibge, nome, uf FROM '{arq.as_posix()}' WHERE cod_ibge IS NOT NULL").fetchall()
    return {m: c for m, c, _, _ in linhas}, {c: (n, u) for _, c, n, u in linhas}


def faixa(pop) -> str | None:
    return None if pop is None else next(r for lim, r in FAIXAS if pop <= lim)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--so", choices=["munic", "estadic"], help="processar só esta pesquisa")
    a = p.parse_args()
    GOLD_M.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute("SET preserve_insertion_order = false")
    mun6a7, nomes = dimensao_municipios(con)
    arq_pop = (GOLD / "saude" / "municipios.parquet").as_posix()
    pop_svs = {(ano, c): pop for ano, c, pop in con.execute(
        f"SELECT ano, cod_ibge, populacao FROM '{arq_pop}' WHERE populacao IS NOT NULL AND cod_ibge IS NOT NULL").fetchall()}
    anos_pop = sorted({k[0] for k in pop_svs})
    catalogo: list[dict] = []
    extra: dict[tuple, dict] = {}
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        partes = []
        for ed in edicoes():
            if a.so and ed["pesquisa"] != a.so:
                continue
            cat, resp, terr = processar_edicao(ed, tmp, mun6a7)
            n = len(resp["cod"])
            print(f"{ed['pesquisa']} {ed['ano']}{ed['modulo']}: {len(cat)} perguntas, {n} respostas, {len(terr)} territórios com metadados", flush=True)
            catalogo += cat
            for cod, d in terr.items():
                extra[(ed["pesquisa"], ed["ano"], cod)] = d
            if n:
                tab = pa.table({"pesquisa": [ed["pesquisa"]] * n, "ano": [ed["ano"]] * n, "cod": resp["cod"], "var": resp["var"],
                                "valor_txt": resp["txt"], "valor_num": resp["num"], "valida": resp["valida"]},
                               schema=pa.schema([("pesquisa", pa.string()), ("ano", pa.int16()), ("cod", pa.int32()), ("var", pa.string()),
                                                 ("valor_txt", pa.string()), ("valor_num", pa.float64()), ("valida", pa.bool_())]))
                arq = tmp / f"p{len(partes)}.parquet"
                pq.write_table(tab, arq, compression="zstd")
                partes.append(arq)
        if not partes:
            raise SystemExit("nenhuma edição lida")
        lista = ", ".join(f"'{x.as_posix()}'" for x in partes)
        con.execute(f"CREATE TABLE respostas AS SELECT * FROM read_parquet([{lista}])")
    con.register("cat_py", pa.Table.from_pylist(catalogo))
    con.execute("CREATE TABLE catalogo AS SELECT * FROM cat_py ORDER BY pesquisa, ano, aba, var")

    # território: nome, UF e porte (população da edição, quando a planilha traz; senão a da SVS do ano mais próximo)
    rows = []
    for pesq, ano, cod in con.execute("SELECT DISTINCT pesquisa, ano, cod FROM respostas").fetchall():
        e = extra.get((pesq, ano, cod), {})
        if pesq == "munic":
            nome, uf = nomes.get(cod) or SEM_CADASTRO.get(cod, (None, UF_POR_CODIGO.get(cod // 100000)))
            pop = e.get("pop") or pop_svs.get((min(anos_pop, key=lambda y: abs(y - ano)), cod))
            rows.append({"pesquisa": pesq, "ano": int(ano), "cod": int(cod), "nome": nome, "uf": uf, "regiao": e.get("regiao"),
                         "populacao": pop, "faixa": faixa(pop)})
        else:
            sigla = UF_POR_CODIGO.get(cod)
            rows.append({"pesquisa": pesq, "ano": int(ano), "cod": int(cod), "nome": sigla, "uf": sigla, "regiao": e.get("regiao"),
                         "populacao": e.get("pop"), "faixa": None})
    con.register("terr_py", pa.Table.from_pylist(rows))
    con.execute("CREATE TABLE territorio AS SELECT * FROM terr_py ORDER BY pesquisa, ano, cod")

    destino = lambda nome: (GOLD_M / nome).as_posix()
    con.execute(f"""COPY (SELECT * FROM respostas ORDER BY pesquisa, ano, var, cod) TO '{destino('respostas.parquet')}'
                    (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 200000)""")
    con.execute(f"COPY catalogo TO '{destino('catalogo.parquet')}' (FORMAT parquet, COMPRESSION zstd)")
    con.execute(f"COPY territorio TO '{destino('territorio.parquet')}' (FORMAT parquet, COMPRESSION zstd)")

    # agregados por Brasil, UF e faixa de porte: a base do painel
    con.execute("""CREATE TABLE agregados AS
        WITH r AS (SELECT r.pesquisa, r.ano, r.var, r.valor_txt, r.valor_num, r.valida, t.uf, t.faixa
                   FROM respostas r JOIN territorio t USING (pesquisa, ano, cod))
        SELECT pesquisa, ano, var, 'brasil' AS corte, 'BR' AS grupo, valor_txt, valida, count(*) AS n, sum(valor_num) AS soma, avg(valor_num) AS media
        FROM r GROUP BY ALL
        UNION ALL
        SELECT pesquisa, ano, var, 'uf', uf, valor_txt, valida, count(*), sum(valor_num), avg(valor_num) FROM r WHERE uf IS NOT NULL GROUP BY ALL
        UNION ALL
        SELECT pesquisa, ano, var, 'faixa', faixa, valor_txt, valida, count(*), sum(valor_num), avg(valor_num) FROM r WHERE faixa IS NOT NULL GROUP BY ALL""")
    con.execute(f"COPY (SELECT * FROM agregados ORDER BY pesquisa, ano, var, corte, grupo) TO '{destino('agregados.parquet')}' (FORMAT parquet, COMPRESSION zstd)")

    def chave(s):
        s = re.sub(r"\(.*?\)", " ", sem_acento(s).lower())
        return re.sub(r"\s+", " ", re.sub(r"[^a-z ]+", " ", s)).strip()
    grupos: dict[tuple, list] = {}
    for c in catalogo:
        grupos.setdefault((c["pesquisa"], chave(c["rotulo"])), []).append(c)
    comp = []
    for i, itens in enumerate(g for k, g in grupos.items() if k[1] and len({x["ano"] for x in g}) >= 2):
        for x in itens:
            comp.append({"grupo": f"{x['pesquisa']}-{i + 1}", "pesquisa": x["pesquisa"], "ano": x["ano"], "var": x["var"],
                         "rotulo": itens[0]["rotulo"], "tipo": x["tipo"]})
    con.register("comp_py", pa.Table.from_pylist(comp))
    con.execute(f"COPY (SELECT * FROM comp_py ORDER BY grupo, ano) TO '{destino('comparaveis.parquet')}' (FORMAT parquet, COMPRESSION zstd)")
    print("catálogo:", con.sql("SELECT pesquisa, count(DISTINCT ano), count(*) FROM catalogo GROUP BY 1").fetchall())
    print("respostas:", con.sql("SELECT pesquisa, count(*) FROM respostas GROUP BY 1").fetchall())
    print("grupos comparáveis:", len({c["grupo"] for c in comp}))
    atualizar_manifesto(con)


def fonte_munic(con) -> dict:
    arq = GOLD_M / "catalogo.parquet"
    if not arq.exists():
        return {}
    quando = datetime.fromtimestamp(arq.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    saida = {}
    for pesq, url in (("munic", "https://ftp.ibge.gov.br/Perfil_Municipios/"), ("estadic", "https://ftp.ibge.gov.br/Perfil_Estados/")):
        anos = [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{arq.as_posix()}' WHERE pesquisa = ? ORDER BY 1", [pesq]).fetchall()]
        if anos:
            saida[pesq] = {"anos": anos, "processado_em": quando, "url": url}
    return saida


def atualizar_manifesto(con):
    caminho = GOLD / "manifesto.json"
    if not caminho.exists():
        return
    manifesto = json.loads(caminho.read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {}).update(fonte_munic(con))
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    caminho.write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
