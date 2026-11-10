"""Captura da cobertura vacinal oficial por residência (InfoMS / PNI, Qlik Sense público), ano a ano, com cache e rastreabilidade.

Fonte: https://infoms.saude.gov.br/extensions/SEIDIGI_DEMAS_VACINACAO_CALENDARIO_NACIONAL_COBERTURA_RESIDENCIA/index.html
Aplicativo Qlik c39051de-3ffe-47af-a43a-ae74f14be34f, objeto cGQKsZ (tabela dinâmica "Export Geral / Baixar Dados Completos"):
linhas Brasil → Região → UF → Macrorregião de Saúde → Região de Saúde → Município; colunas imunobiológico × (cobertura, numerador,
denominador). Acesso público e anônimo (cookie de sessão + token CSRF + WebSocket), sem login e sem contornar restrição alguma.

Como funciona:
    - um ano por extração: seleciona o campo Ano (valor numérico) e lê o cubo pivô em páginas de, no máximo, 10 mil células
      (GetHyperCubePivotData), todas as colunas de cada vez;
    - cada página é gravada como está (JSON comprimido) em  <brutos>/<ano>/pagina_NNNN.json.gz, e o manifesto do ano
      (<brutos>/<ano>/manifesto.json) guarda URL, app, objeto, ano, data da captura, tamanho do cubo, cabeçalhos e o SHA-256 de cada página;
    - o que já está em cache (página com hash conferido) não é pedido de novo; ano completo não abre conexão alguma;
    - no máximo 1 conexão por vez (limite combinado: 2); pausa entre as requisições.

Uso (só grava na pasta de brutos da vacinação):
    py pipeline/vacinacao_baixar.py --anos 2015-2025
"""
import argparse
import base64
import gzip
import hashlib
import http.cookiejar
import json
import os
import socket
import ssl
import struct
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOST = "infoms.saude.gov.br"
PAGINA = "/extensions/SEIDIGI_DEMAS_VACINACAO_CALENDARIO_NACIONAL_COBERTURA_RESIDENCIA/index.html"
URL_FONTE = "https://" + HOST + PAGINA
APP_ID = "c39051de-3ffe-47af-a43a-ae74f14be34f"
OBJETO = "cGQKsZ"
ANOS = (2015, 2025)  # 2026 está em andamento: fica de fora desta entrega anual
CELULAS_POR_PAGINA = 9900  # a API limita a 10 mil células por requisição
PAUSA = 0.25
BRUTOS_PADRAO = Path("E:/finbra/brutos/vacinacao")


def validar_raiz(raiz: Path) -> Path:
    """Recusa gravar fora de uma pasta de brutos da vacinação (…/brutos/vacinacao) ou dentro dos dados publicados e dos microdados."""
    r = raiz.resolve()
    partes = [p.lower() for p in r.parts]
    if partes[-2:] != ["brutos", "vacinacao"] and not os.environ.get("VACINACAO_BRUTOS_TESTE"):
        raise ValueError(f"destino inválido: {r} não é uma pasta …/brutos/vacinacao")
    for proibido in ("gold", "silver", "landing", "bronze", "micro"):
        if proibido in partes:
            raise ValueError(f"destino inválido: {r} está dentro de uma pasta de dados ({proibido})")
    return r


def destino_em_raiz(raiz_resolvida: Path, destino: Path) -> Path:
    """Resolve o destino efetivo e recusa links que escapem da raiz permitida já resolvida."""
    efetivo = destino.resolve()
    if efetivo != raiz_resolvida and raiz_resolvida not in efetivo.parents:
        raise ValueError(f"destino inválido: {destino} resolve para {efetivo}, fora de {raiz_resolvida}")
    return efetivo


def validar_arquivos_ano(raiz: Path, pasta: Path, quantidade: int) -> None:
    """Preflight de todas as escritas, inclusive temporários, antes de criar a pasta."""
    for nome in ["manifesto.json", *(f"pagina_{i:04d}.json.gz" for i in range(quantidade))]:
        destino_em_raiz(raiz, pasta / nome)
        destino_em_raiz(raiz, pasta / (nome + ".tmp"))


def gravar_atomico(raiz: Path, arquivo: Path, conteudo: bytes) -> None:
    """Só substitui o cache após concluir a escrita num temporário igualmente protegido."""
    destino = destino_em_raiz(raiz, arquivo)
    temporario = destino_em_raiz(raiz, arquivo.with_name(arquivo.name + ".tmp"))
    temporario.write_bytes(conteudo)
    temporario.replace(destino)


class Sessao:
    """Sessão pública do Qlik Sense: cookie + token CSRF + WebSocket (somente biblioteca padrão)."""

    def __init__(self, timeout: int = 90):
        jar = http.cookiejar.CookieJar()
        op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        op.open(URL_FONTE, timeout=30).read()
        r = op.open("https://" + HOST + "/qps/csrftoken", timeout=30)
        token = r.headers["qlik-csrf-token"]
        r.read()
        self.s = ssl.create_default_context().wrap_socket(socket.create_connection((HOST, 443), timeout=timeout), server_hostname=HOST)
        chave = base64.b64encode(os.urandom(16)).decode()
        cookie = "; ".join(c.name + "=" + c.value for c in jar)
        self.s.sendall(("GET /app/" + APP_ID + "?qlik-csrf-token=" + urllib.parse.quote(token) + " HTTP/1.1\r\nHost: " + HOST
                        + "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nUser-Agent: Mozilla/5.0\r\nSec-WebSocket-Key: " + chave
                        + "\r\nSec-WebSocket-Version: 13\r\nOrigin: https://" + HOST + "\r\nCookie: " + cookie + "\r\n\r\n").encode())
        b = b""
        while b"\r\n\r\n" not in b:
            b += self.s.recv(1)
        if not b.startswith(b"HTTP/1.1 101"):
            raise RuntimeError("WebSocket recusado; acesso público não estabelecido")
        self.n = 0

    def _exato(self, n: int) -> bytes:
        b = b""
        while len(b) < n:
            c = self.s.recv(n - len(b))
            if not c:
                raise ConnectionError("conexão encerrada")
            b += c
        return b

    def _enviar(self, obj, opcode: int = 1):
        raw = json.dumps(obj).encode() if opcode == 1 else obj
        m = os.urandom(4)
        n = len(raw)
        cab = bytes([128 | opcode, 128 | (n if n < 126 else 126)]) + (struct.pack(">H", n) if n >= 126 else b"")
        self.s.sendall(cab + m + bytes(v ^ m[i % 4] for i, v in enumerate(raw)))

    def _receber(self):
        saida = b""
        while True:
            a, b = self._exato(2)
            n = b & 127
            if n == 126:
                n = struct.unpack(">H", self._exato(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._exato(8))[0]
            mask = self._exato(4) if b & 128 else None
            p = self._exato(n)
            if mask:
                p = bytes(v ^ mask[i % 4] for i, v in enumerate(p))
            if a & 15 == 9:
                self._enviar(p, 10)
                continue
            if a & 15 == 8:
                raise ConnectionError("quadro de encerramento")
            saida += p
            if a & 128:
                return json.loads(saida)

    def chamar(self, handle: int, metodo: str, params: list):
        self.n += 1
        self._enviar({"jsonrpc": "2.0", "id": self.n, "handle": handle, "method": metodo, "params": params})
        while True:
            r = self._receber()
            if r.get("id") == self.n:
                if "error" in r:
                    raise RuntimeError(f"{metodo}: {r['error']}")
                return r["result"]

    def fechar(self):
        try:
            self.s.close()
        except OSError:
            pass


def abrir_ano(sessao: Sessao, ano: int) -> tuple[int, dict]:
    """Abre o app, seleciona o ano (número, não texto) e devolve (handle do objeto, layout do cubo)."""
    h = sessao.chamar(-1, "OpenDoc", [APP_ID])["qReturn"]["qHandle"]
    fh = sessao.chamar(h, "GetField", ["Ano"])["qReturn"]["qHandle"]
    if sessao.chamar(fh, "SelectValues", [[{"qNumber": ano, "qIsNumeric": True}], False, False]).get("qReturn") is not True:
        raise RuntimeError(f"seleção do ano {ano} não aplicada")
    oh = sessao.chamar(h, "GetObject", [OBJETO])["qReturn"]["qHandle"]
    return oh, sessao.chamar(oh, "GetLayout", [])["qLayout"]


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def ler_pagina(arquivo: Path) -> bytes:
    with gzip.open(arquivo, "rb") as f:
        return f.read()


def plano_paginas(linhas: int, colunas: int) -> list[tuple[int, int]]:
    """[(topo, altura)] cobrindo todas as linhas com todas as colunas e no máximo CELULAS_POR_PAGINA células por página."""
    if colunas <= 0 or linhas < 0:
        raise ValueError("cubo vazio ou inválido")
    altura = max(1, CELULAS_POR_PAGINA // colunas)
    return [(t, min(altura, linhas - t)) for t in range(0, linhas, altura)]


def pagina_valida(manifesto: dict, i: int, arquivo: Path) -> bool:
    esperado = manifesto.get("paginas", {}).get(f"{i:04d}")
    if not esperado or not arquivo.exists():
        return False
    try:
        bruto = ler_pagina(arquivo)
        return len(bruto) == esperado.get("bytes") and sha256(bruto) == esperado.get("sha256")
    except (OSError, EOFError):
        return False


def baixar_ano(ano: int, raiz: Path, sessao_fn=Sessao) -> dict:
    """Captura (ou completa) o ano em raiz/<ano>. Devolve o manifesto. Ano já completo e íntegro não abre conexão."""
    raiz = validar_raiz(raiz)
    pasta = destino_em_raiz(raiz, raiz / str(ano))
    validar_arquivos_ano(raiz, pasta, 0)
    caminho = destino_em_raiz(raiz, pasta / "manifesto.json")
    manifesto = json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else {}
    plano = manifesto.get("plano")
    validar_arquivos_ano(raiz, pasta, len(plano or []))
    if plano and manifesto.get("completo") and all(pagina_valida(manifesto, i, pasta / f"pagina_{i:04d}.json.gz") for i in range(len(plano))):
        print(f"{ano}: em cache ({len(plano)} páginas)")
        return manifesto
    sessao = sessao_fn()
    try:
        oh, layout = abrir_ano(sessao, ano)
        cubo = layout["qHyperCube"]
        linhas, colunas = cubo["qSize"]["qcy"], cubo["qSize"]["qcx"]
        plano = plano_paginas(linhas, colunas)
        validar_arquivos_ano(raiz, pasta, len(plano))
        novo = {"fonte": "InfoMS/PNI, cobertura vacinal por residência", "url": URL_FONTE, "app": APP_ID, "objeto": OBJETO, "ano": ano,
                "cubo": {"linhas": linhas, "colunas": colunas, "dimensoes": [d.get("qFallbackTitle") for d in cubo["qDimensionInfo"]],
                         "medidas": [m.get("qFallbackTitle") for m in cubo["qMeasureInfo"]]},
                "plano": plano, "paginas": {}, "completo": False}
        if manifesto.get("cubo") and manifesto["cubo"] != novo["cubo"]:
            print(f"{ano}: o cubo mudou desde a captura anterior; refazendo as páginas")
            manifesto = {}
        manifesto = {**novo, "paginas": manifesto.get("paginas", {}), "iniciado_em": manifesto.get("iniciado_em") or datetime.now(timezone.utc).isoformat(timespec="seconds")}
        pasta.mkdir(parents=True, exist_ok=True)
        for i, (topo, altura) in enumerate(plano):
            arquivo = pasta / f"pagina_{i:04d}.json.gz"
            if pagina_valida(manifesto, i, arquivo):
                continue
            time.sleep(PAUSA)
            pg = sessao.chamar(oh, "GetHyperCubePivotData", ["/qHyperCubeDef", [{"qTop": topo, "qLeft": 0, "qHeight": altura, "qWidth": colunas}]])["qDataPages"][0]
            bruto = json.dumps(pg, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            gravar_atomico(raiz, arquivo, gzip.compress(bruto, compresslevel=6, mtime=0))
            manifesto["paginas"][f"{i:04d}"] = {"topo": topo, "altura": altura, "sha256": sha256(bruto), "bytes": len(bruto),
                                                "capturada_em": datetime.now(timezone.utc).isoformat(timespec="seconds")}
            gravar_atomico(raiz, caminho, json.dumps(manifesto, ensure_ascii=False, indent=1).encode("utf-8"))  # retomável
            print(f"{ano}: página {i + 1}/{len(plano)}", flush=True)
        manifesto["completo"] = True
        manifesto["concluido_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        gravar_atomico(raiz, caminho, json.dumps(manifesto, ensure_ascii=False, indent=1).encode("utf-8"))
        return manifesto
    finally:
        sessao.fechar()


def faixa(texto: str) -> list[int]:
    a, _, b = texto.partition("-")
    return list(range(int(a), int(b or a) + 1))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--anos", default=f"{ANOS[0]}-{ANOS[1]}", help="ex.: 2015-2025 ou 2024")
    p.add_argument("--brutos", default=str(BRUTOS_PADRAO))
    a = p.parse_args()
    anos = faixa(a.anos)
    if not all(ANOS[0] <= x <= ANOS[1] for x in anos):
        sys.exit(f"anos fora de {ANOS[0]}–{ANOS[1]}")
    try:
        for ano in anos:
            baixar_ano(ano, Path(a.brutos))
    except ValueError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
