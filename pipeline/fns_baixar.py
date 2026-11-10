"""FNS (repasses fundo a fundo): baixa os arquivos anuais "REPASSE-FAF-COM-POPULACAO" do Portal do FNS.

Catálogo oficial: https://portalfns.saude.gov.br/downloads/ (2002–2025; o 2026 é parcial, acumulado até julho, e fica fora).
Cada arquivo é gravado como .parte e só vira o nome final ao terminar; arquivo já baixado e conferido é reutilizado.
O registro (_fontes.json, na pasta dos brutos) guarda, por ano: URL pedida e final, bytes, SHA-256, data do download, Last-Modified.
No máximo 2 downloads simultâneos. Destino fixo: E:/finbra/brutos/fns (outra pasta só com --brutos, nunca dentro do gold).

Uso:
    py pipeline/fns_baixar.py              # baixa o que falta
    py pipeline/fns_baixar.py --refazer    # baixa de novo tudo
"""
import argparse
import hashlib
import json
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

BRUTOS = Path("E:/finbra/brutos/fns")
BASE = "https://portalfns.saude.gov.br"
U = BASE + "/wp-content/uploads/"
ANOS = tuple(range(2002, 2026))
# URLs do catálogo (a ordem e as variações de nome são as do portal)
URLS = {a: f"{U}2021/12/REPASSE-FAF-COM-POPULACAO-{a}.csv" for a in range(2002, 2021)}
URLS.update({
    2021: U + "2022/01/REPASSE-FAF-COM-POPULACAO-2021-1.csv",
    2022: U + "2023/01/REPASSE-FAF-COM-POPULACAO-v4-2022.csv",
    # 2023 e 2024: o catálogo aponta para páginas idg_download que redirecionam para o arquivo
    2023: BASE + "/idg_download/repasse-faf-com-populacao-2023-acumulado-ate-dezembro-csv/",
    2024: BASE + "/idg_download/repasse-faf-com-populacao-2024/",
    2025: U + "2026/01/REPASSE-FAF-COM-POPULACAO-2025.xlsx",
})
UA = "finbra-web/pesquisa (download de dados abertos do FNS)"


def validar_pasta(pasta: Path) -> Path:
    """Os brutos só vão para uma pasta 'fns' dentro de uma pasta 'brutos', nunca para o gold, silver ou micro."""
    p = pasta.resolve()
    partes = [x.lower() for x in p.parts]
    if p.name.lower() != "fns" or "brutos" not in partes or any(x in partes for x in ("gold", "silver", "bronze", "micro", "data")):
        raise ValueError(f"destino inválido para os brutos do FNS: {p} (esperado .../brutos/fns)")
    # Inclui os temporários: uma pasta válida não torna seguro um arquivo que seja um link para fora dela.
    alvos = [p / "_fontes.json", p / "_fontes.json.tmp"]
    for ano in ANOS:
        arquivo = p / nome_arquivo(ano)
        alvos.extend((arquivo, arquivo.with_suffix(arquivo.suffix + ".parte")))
    if any(a.resolve().parent != p for a in alvos):
        raise ValueError(f"destino inválido: arquivo ou temporário dos brutos aponta para fora de {p}")
    return p


def extensao(url: str) -> str:
    return ".xlsx" if url.lower().endswith(".xlsx") else ".csv"


def nome_arquivo(ano: int) -> str:
    return f"fns_faf_{ano}{extensao(URLS[ano])}"


def sha256(caminho: Path) -> str:
    h = hashlib.sha256()
    with caminho.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def verificar_arquivo(caminho: Path, registro: dict) -> None:
    """Confere o conteúdo efetivo contra a captura registrada; nunca reaproveita apenas pela existência do arquivo."""
    tamanho, digest = registro.get("bytes"), registro.get("sha256")
    if not isinstance(tamanho, int) or tamanho <= 0 or not isinstance(digest, str) or len(digest) != 64:
        raise ValueError(f"inventário ausente ou incompleto: {caminho.name}; refaça o download com --refazer")
    if not caminho.is_file():
        raise ValueError(f"arquivo bruto ausente: {caminho}")
    if caminho.stat().st_size != tamanho or sha256(caminho) != digest:
        raise ValueError(f"conteúdo diverge do inventário (bytes/SHA-256): {caminho}; refaça o download com --refazer")


def baixar_um(ano: int, pasta: Path, refazer: bool, registro: dict | None = None) -> dict:
    destino = pasta / nome_arquivo(ano)
    if destino.exists() and not refazer:
        try:
            verificar_arquivo(destino, registro or {})
        except ValueError as e:
            return {"ano": ano, "erro": str(e)}
        return {"ano": ano, "reutilizado": True}
    parte = destino.with_suffix(destino.suffix + ".parte")
    req = urllib.request.Request(URLS[ano], headers={"User-Agent": UA})
    for tentativa in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r, parte.open("wb") as f:
                final, mod = r.geturl(), r.headers.get("Last-Modified")
                tamanho_esperado = r.headers.get("Content-Length")
                while bloco := r.read(1 << 20):
                    f.write(bloco)
            if tamanho_esperado is not None and parte.stat().st_size != int(tamanho_esperado):
                raise ValueError("download incompleto: tamanho difere do Content-Length")
            break
        except Exception as e:  # noqa: BLE001
            if tentativa == 2:
                parte.unlink(missing_ok=True)
                return {"ano": ano, "erro": f"{type(e).__name__}: {e}"}
            time.sleep(3 * (tentativa + 1))
    parte.replace(destino)
    return {"ano": ano, "arquivo": destino.name, "url": URLS[ano], "url_final": final, "bytes": destino.stat().st_size,
            "sha256": sha256(destino), "last_modified": mod, "baixado_em": datetime.now(timezone.utc).isoformat(timespec="seconds")}


def baixar(pasta: Path = BRUTOS, refazer: bool = False) -> dict:
    pasta = validar_pasta(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    registro_arq = pasta / "_fontes.json"
    registro = json.loads(registro_arq.read_text(encoding="utf-8")) if registro_arq.exists() else {}
    erros = []

    def salvar_registro():
        tmp = registro_arq.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(registro, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
        tmp.replace(registro_arq)

    with ThreadPoolExecutor(2) as ex:
        for r in ex.map(lambda a: baixar_um(a, pasta, refazer, registro.get(str(a), {})), ANOS):
            if r.get("erro"):
                print(f"ERRO {r['ano']}: {r['erro']}", flush=True)
                erros.append(f"{r['ano']}: {r['erro']}")
            elif not r.get("reutilizado"):
                registro[str(r["ano"])] = {k: v for k, v in r.items() if k != "ano"}
                salvar_registro()
                print(f"{r['ano']}: {r['bytes'] / 1e6:.1f} MB", flush=True)
    if erros:
        # Um inventário antigo não transforma um --refazer malsucedido em sucesso.
        raise ValueError("download/conferência do FNS falhou: " + "; ".join(erros))
    return registro


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--brutos", default=str(BRUTOS))
    p.add_argument("--refazer", action="store_true")
    a = p.parse_args()
    try:
        r = baixar(Path(a.brutos), a.refazer)
    except ValueError as e:
        sys.exit(str(e))
    faltam = [x for x in ANOS if str(x) not in r]
    print("faltam:", faltam or "nenhum")
    sys.exit(1 if faltam else 0)


if __name__ == "__main__":
    main()
