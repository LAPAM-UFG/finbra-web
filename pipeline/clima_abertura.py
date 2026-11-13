"""Pacote de abertura do painel de clima: os resumos JÁ publicados (gold/clima/painel.parquet), empacotados para o navegador abrir
SEM DuckDB-WASM e sem baixar arquivos financeiros. Nenhum número é recalculado: cada valor é copiado do painel.parquet.

Uso:  py pipeline/clima_abertura.py --base <raiz-com-gold> --saida <pasta-candidata> [--substituir]

  --base    raiz com gold/clima/{painel,territorio,catalogo}.parquet e gold/manifesto.json (ex.: E:/finbra/data). SOMENTE LEITURA:
            a saída não pode ser a base, estar dentro dela nem conter a base (conferido antes de qualquer mkdir).
  --saida   pasta candidata. Recebe gold/clima/abertura_<hash>.ndjson, gold/clima/abertura_indice_<hash>.json e uma CÓPIA do
            manifesto com fontes.clima.abertura. Os demais arquivos e o manifesto da base não são tocados.

Formato (versão 1):
  abertura_<sha12>.ndjson   uma linha UTF-8 por grupo (BR, sigla da UF, código IBGE de 7 dígitos), terminada em "\\n":
                            {"g": <grupo>, "s": <sha12 do pacote>, "r": [[valores na ordem de `colunas` do índice], ...]}
                            (uma linha de r por variável, com as seis variáveis do catálogo, ordenadas por variável)
  abertura_indice_<h>.json  versão, snapshot (sha12 do pacote), colunas, catalogo, territorios [[cod, nome, uf]], grupos (chaves, na
                            ordem do arquivo) e tamanhos (bytes UTF-8 de cada linha, "\\n" incluído): o offset de cada grupo é a soma dos
                            tamanhos anteriores. O navegador lê o índice e UM Range por grupo.
Os nomes levam o hash do conteúdo: objetos imutáveis, sem mistura de snapshots. Ausência vira null, nunca zero.
Um município sem linha no painel (grade não o cobre) simplesmente não tem grupo: o site mostra "sem dados", sem inventar nada.
"""
import argparse
import copy
import hashlib
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb

VERSAO = 1
ORIGENS = ("painel", "territorio", "catalogo")
COLUNAS_PAINEL = (
    "grupo", "variavel", "ano_de", "ano_ate", "n_anos", "anos_lacuna", "ate", "valor", "normal", "anomalia_pct", "anomalia",
    "parcial_meses", "parcial_valor", "parcial_normal", "parcial_anomalia_pct", "parcial_anomalia",
    "acum_fim", "acum3_cob", "acum3_valor", "acum3_normal", "acum6_cob", "acum6_valor", "acum6_normal",
    "acum12_cob", "acum12_valor", "acum12_normal",
)
COLUNAS = COLUNAS_PAINEL[2:]  # o grupo vai na chave da linha; a variável é a primeira coluna de cada linha de r
COLUNAS_LINHA = ("variavel",) + COLUNAS
COLUNAS_CATALOGO = ("variavel", "rotulo", "unidade", "resumo_anual", "fonte", "anomalia", "ano_de", "ano_ate", "ate")
PADRAO_ARQ = "abertura_{}.ndjson"
PADRAO_IDX = "abertura_indice_{}.json"


def sha_arquivo(caminho) -> str:
    h = hashlib.sha256()
    with Path(caminho).open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def lit(caminho) -> str:
    return "'" + Path(caminho).as_posix().replace("'", "''") + "'"


def validar_destinos(base: Path, saida: Path, substituir: bool) -> None:
    """Falha ANTES de qualquer mkdir ou escrita: a saída não toca a base e não substitui nada sem --substituir."""
    b, s = base.resolve(), saida.resolve()
    g = s / "gold"
    c = g / "clima"
    for alvo in (s, g, c, g / "manifesto.json"):
        t = alvo.resolve()
        if t == b or t.is_relative_to(b) or b.is_relative_to(t):
            raise ValueError(f"destino sobre a base (somente leitura): {t}")
    if c.exists() and any(p.is_symlink() for p in (s, g, c)):
        raise ValueError("a saída não pode passar por links simbólicos")
    if not substituir and (g / "manifesto.json").exists():
        raise ValueError(f"destino já existe (use --substituir só em pasta candidata): {g / 'manifesto.json'}")


def eh_link(p: Path) -> bool:
    """Link simbólico ou junção (Windows): nenhum caminho de saída pode passar por um."""
    return p.is_symlink() or (hasattr(os.path, "isjunction") and os.path.isjunction(p))


def validar_finais(base: Path, saida: Path, finais: list[Path]) -> None:
    """Depois de calcular os nomes e ANTES de qualquer mkdir/escrita: cada arquivo final (e, portanto, o temporário exclusivo criado ao lado
    dele) tem de ficar DENTRO da saída, fora da base, sem link/junção em nenhum trecho existente do caminho nem no próprio arquivo."""
    b, s = base.resolve(), saida.resolve()
    for alvo in finais:
        t = alvo.resolve()
        if t == b or t.is_relative_to(b) or b.is_relative_to(t):
            raise ValueError(f"destino final alcança a base (somente leitura): {alvo} -> {t}")
        if not t.is_relative_to(s):
            raise ValueError(f"destino final escapa da saída: {alvo} -> {t}")
        for trecho in (alvo, *alvo.parents):
            if eh_link(trecho):
                raise ValueError(f"link ou junção no caminho de saída: {trecho}")
            if trecho == saida:
                break


def chave_grupo(g: str) -> tuple:
    """BR primeiro, depois as UFs (siglas), depois os municípios por código: ordem estável e verificável."""
    return (0, g) if g == "BR" else (1, g) if g.isalpha() else (2, int(g))


def valor_json(v):
    if isinstance(v, float) and not math.isfinite(v):
        raise ValueError("valor não finito no painel")
    return v


def ler_tabela(con, caminho, colunas):
    cols = ", ".join(colunas)
    return con.execute(f"SELECT {cols} FROM read_parquet({lit(caminho)})").fetchall()


def montar(c: Path):
    """(linhas NDJSON sem o snapshot, por grupo; catálogo; territórios). Tudo vem dos parquet publicados."""
    con = duckdb.connect(config={"threads": 2})
    try:
        painel = ler_tabela(con, c / "painel.parquet", COLUNAS_PAINEL)
        cat = ler_tabela(con, c / "catalogo.parquet", COLUNAS_CATALOGO)
        terr = ler_tabela(con, c / "territorio.parquet", ("cod", "nome", "uf"))
    finally:
        con.close()
    if not painel or not cat or not terr:
        raise ValueError("painel, catálogo ou territórios vazios")
    por_grupo: dict[str, list] = {}
    for linha in painel:
        g = str(linha[0])
        por_grupo.setdefault(g, []).append([linha[1]] + [valor_json(v) for v in linha[2:]])
    for g, linhas in por_grupo.items():
        linhas.sort(key=lambda r: r[0])
        if len({r[0] for r in linhas}) != len(linhas):
            raise ValueError(f"variável duplicada no grupo {g}")
    catalogo = [dict(zip(COLUNAS_CATALOGO, r)) for r in cat]
    catalogo.sort(key=lambda r: (r["variavel"] != "chuva_mm", r["rotulo"]))
    territorios = [[int(r[0]), r[1], r[2]] for r in terr]
    territorios.sort(key=lambda r: (r[1], r[0]))
    return por_grupo, catalogo, territorios


def serializar(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def empacotar(por_grupo: dict):
    """Corpo do NDJSON em duas passagens: o hash do conteúdo (sem snapshot) define o snapshot de 12 hex, que entra em cada linha."""
    chaves = sorted(por_grupo, key=chave_grupo)
    base = hashlib.sha256()
    for g in chaves:
        base.update((serializar({"g": g, "r": por_grupo[g]}) + "\n").encode("utf-8"))
    snap = base.hexdigest()[:12]
    linhas = [(serializar({"g": g, "s": snap, "r": por_grupo[g]}) + "\n").encode("utf-8") for g in chaves]
    return snap, chaves, linhas


def decodificar(dados: bytes, indice: dict) -> dict:
    """Lê o pacote como o navegador: offsets pelos tamanhos UTF-8 do índice, linha a linha, com todas as guardas."""
    saida, off = {}, 0
    if sum(indice["tamanhos"]) != len(dados):
        raise ValueError("tamanho total do pacote diverge do índice")
    for g, n in zip(indice["grupos"], indice["tamanhos"]):
        trecho = dados[off:off + n]
        off += n
        if not trecho.endswith(b"\n"):
            raise ValueError(f"linha do grupo {g} sem fim de linha")
        o = json.loads(trecho.decode("utf-8"))
        if o["g"] != g or o["s"] != indice["snapshot"]:
            raise ValueError(f"linha do grupo {g} não corresponde ao índice")
        saida[g] = o["r"]
    return saida


def conferir(c: Path, dados: bytes, indice: dict) -> dict:
    """O pacote tem de reproduzir o painel.parquet publicado: mesmos grupos, variáveis, valores e nulos."""
    con = duckdb.connect(config={"threads": 2})
    try:
        origem = ler_tabela(con, c / "painel.parquet", COLUNAS_PAINEL)
        terr = ler_tabela(con, c / "territorio.parquet", ("cod", "nome", "uf"))
    finally:
        con.close()
    lido = decodificar(dados, indice)
    esperado: dict[str, dict] = {}
    for linha in origem:
        esperado.setdefault(str(linha[0]), {})[linha[1]] = list(linha[2:])
    if set(lido) != set(esperado):
        raise ValueError("grupos do pacote diferem dos do painel publicado")
    linhas = 0
    for g, vars_ in esperado.items():
        got = {r[0]: r[1:] for r in lido[g]}
        if set(got) != set(vars_):
            raise ValueError(f"variáveis do grupo {g} diferem do painel")
        for v, vals in vars_.items():
            if len(got[v]) != len(vals) or any((a is None) != (b is None) or (a is not None and a != b) for a, b in zip(got[v], vals)):
                raise ValueError(f"valores do grupo {g}/{v} diferem do painel")
            linhas += 1
    if len(indice["territorios"]) != len(terr) or {t[0] for t in indice["territorios"]} != {int(t[0]) for t in terr}:
        raise ValueError("territórios do índice diferem do publicado")
    return {"linhas": linhas, "grupos": len(lido)}


def preparar_temporario(caminho: Path, dados: bytes) -> Path:
    """Temporário EXCLUSIVO e aleatório ao lado do destino (O_EXCL: nunca segue um link existente); só então os destinos são trocados."""
    fd, nome = tempfile.mkstemp(dir=caminho.parent, prefix=caminho.name + ".", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(dados)
    except BaseException:
        Path(nome).unlink(missing_ok=True)
        raise
    return Path(nome)


def publicar_arquivos(itens: list[tuple[Path, bytes]]) -> None:
    """Escreve todos os temporários antes de trocar qualquer destino; se algo falhar, os temporários saem e os destinos antigos ficam intactos."""
    temporarios: list[tuple[Path, Path]] = []
    try:
        for destino, dados in itens:
            temporarios.append((preparar_temporario(destino, dados), destino))
        for tmp, destino in temporarios:
            os.replace(tmp, destino)
    except BaseException:
        for tmp, _ in temporarios:
            tmp.unlink(missing_ok=True)
        raise


def gerar(base, saida, substituir: bool = False) -> dict:
    base, saida = Path(base), Path(saida)
    validar_destinos(base, saida, substituir)
    c = base / "gold" / "clima"
    faltam = [n for n in ORIGENS if not (c / f"{n}.parquet").exists()]
    mpath = base / "gold" / "manifesto.json"
    if faltam or not mpath.exists():
        raise ValueError(f"base incompleta (precisa de gold/clima/{faltam or 'painel, territorio, catalogo'} e do manifesto)")
    manifesto = json.loads(mpath.read_text(encoding="utf-8"))
    clima = manifesto.get("fontes", {}).get("clima")
    painel_meta = (clima or {}).get("painel")
    if not clima or not painel_meta:
        raise ValueError("o manifesto da base não anuncia fontes.clima.painel: gere antes pipeline/clima_painel.py")
    origem = {n: sha_arquivo(c / f"{n}.parquet") for n in ORIGENS}
    if painel_meta.get("sha256") != origem["painel"] or painel_meta.get("ate") != clima.get("ate"):
        raise ValueError("painel.parquet não corresponde ao que o manifesto anuncia (hash ou último mês)")
    por_grupo, catalogo, territorios = montar(c)
    snap, chaves, linhas = empacotar(por_grupo)
    dados = b"".join(linhas)
    h = hashlib.sha256(dados).hexdigest()
    indice = {
        "versao": VERSAO, "snapshot": snap, "arquivo": PADRAO_ARQ.format(snap), "sha256": h, "bytes": len(dados),
        "ate": clima["ate"], "anos": clima.get("anos"), "normal": clima.get("normal"), "processado_em": clima.get("processado_em"),
        "origem": origem, "colunas": list(COLUNAS_LINHA), "catalogo": catalogo, "territorios": territorios,
        "grupos": chaves, "tamanhos": [len(x) for x in linhas],
    }
    conferir(c, dados, indice)
    if any(sha_arquivo(c / f"{n}.parquet") != x for n, x in origem.items()):
        raise ValueError("a origem mudou durante a geração; nada foi anunciado")
    corpo_indice = (serializar(indice)).encode("utf-8")
    hi = hashlib.sha256(corpo_indice).hexdigest()
    out = saida / "gold" / "clima"
    nome_arq, nome_idx = indice["arquivo"], PADRAO_IDX.format(hi[:12])
    finais = [out / nome_arq, out / nome_idx, saida / "gold" / "manifesto.json"]
    validar_finais(base, saida, finais)  # antes de qualquer mkdir ou escrita
    # objetos imutáveis: mesmo nome só com o mesmo conteúdo
    for destino, conteudo in ((finais[0], dados), (finais[1], corpo_indice)):
        if destino.exists() and destino.read_bytes() != conteudo:
            raise ValueError(f"{destino.name} já existe com outro conteúdo: objetos imutáveis não são sobrescritos")
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    novo = copy.deepcopy(manifesto)
    novo["gerado_em"] = agora  # a versão dos URLs HTTP vem daqui: invalida o cache anterior
    novo["fontes"]["clima"]["abertura"] = {
        "versao": VERSAO, "indice": f"gold/clima/{nome_idx}", "indice_sha256": hi, "indice_bytes": len(corpo_indice),
        "arquivo": f"gold/clima/{nome_arq}", "sha256": h, "bytes": len(dados), "snapshot": snap, "grupos": len(chaves),
        "ate": clima["ate"], "painel_sha256": origem["painel"], "processado_em": agora,
    }
    out.mkdir(parents=True, exist_ok=True)
    validar_finais(base, saida, finais)  # de novo, já com as pastas criadas
    # o manifesto é o último: só anuncia o pacote depois de os dois objetos estarem no lugar
    publicar_arquivos([(finais[0], dados), (finais[1], corpo_indice), (finais[2], json.dumps(novo, ensure_ascii=False, indent=1).encode("utf-8"))])
    return novo["fontes"]["clima"]["abertura"]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--substituir", action="store_true", help="permite sobrescrever o manifesto de uma saída candidata anterior")
    a = ap.parse_args()
    print(json.dumps(gerar(a.base, a.saida, a.substituir), ensure_ascii=False))


if __name__ == "__main__":
    main()
