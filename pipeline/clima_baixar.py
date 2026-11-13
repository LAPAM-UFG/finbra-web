"""Baixa os dados brutos do painel de clima para o HD externo (E:/finbra/brutos/clima).

  chirps/   chuva mensal CHIRPS v3 (UCSB/CHC), grade de 0,05° para a América Latina, 1981 até o último mês publicado
  malha/    malha municipal do IBGE (BR_Municipios_2022.zip), para agregar as grades por município

Retoma de onde parou. Arquivo antigo com o tamanho certo é pulado. Os meses recentes do CHIRPS (últimos JANELA_RECENTE meses,
preliminares) podem ser revisados sem mudar de tamanho: por isso são conferidos também pelo Last-Modified e pelo ETag que o
servidor informa, guardados em AAAA.MM.tif.meta.json; sem esse registro, são baixados de novo uma vez. O download vai para
.parte, só entra se for um TIFF do tamanho anunciado e, quando o conteúdo muda, o arquivo anterior fica em .anterior.
Uso: python pipeline/clima_baixar.py [--so-malha] [--so-chirps]
"""
import argparse
import json
import os
import re
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import requests

BRUTOS = Path(os.environ.get("CLIMA_BRUTOS", "E:/finbra/brutos/clima"))
CHIRPS = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/latam/tifs/"
MALHA = "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Brasil/BR/BR_Municipios_2022.zip"
JANELA_RECENTE = 6  # meses


def recente(nome: str, hoje: date | None = None, janela: int = JANELA_RECENTE) -> bool:
    """O arquivo mensal do CHIRPS (chirps-v3.0.AAAA.MM.tif) é dos últimos `janela` meses: pode ser preliminar e revisado."""
    m = re.search(r"\.(\d{4})\.(\d{2})\.tif$", nome)
    if not m:
        return False
    hoje = hoje or date.today()
    return int(m[1]) * 12 + int(m[2]) - 1 >= hoje.year * 12 + hoje.month - 1 - janela


def meta_de(destino: Path) -> Path:
    return destino.with_name(destino.name + ".meta.json")


def ler_meta(destino: Path) -> dict | None:
    try:
        return json.loads(meta_de(destino).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def gravar_meta(destino: Path, remota: dict) -> None:
    parcial = meta_de(destino).with_suffix(".json.parcial")
    parcial.write_text(json.dumps({"tamanho": remota.get("tamanho"), "modificado": remota.get("modificado"), "etag": remota.get("etag")}, indent=1), encoding="utf-8")
    os.replace(parcial, meta_de(destino))


def meta_remota(cabecalhos) -> dict:
    return {"tamanho": int(cabecalhos.get("content-length", 0) or 0), "modificado": cabecalhos.get("last-modified"), "etag": cabecalhos.get("etag")}


def decidir(destino: Path, remota: dict, nome: str, hoje: date | None = None) -> str:
    """'pular' ou 'baixar'. Antigo: pelo tamanho. Recente: pelo tamanho e pela versão (Last-Modified/ETag) registrada no último download."""
    if not destino.exists():
        return "baixar"
    tam = remota.get("tamanho") or 0
    if tam and destino.stat().st_size != tam:
        return "baixar"
    if not recente(nome, hoje):
        return "pular" if tam else "baixar"
    reg = ler_meta(destino)
    if reg is None:
        return "baixar"  # versão desconhecida de um mês que pode ter sido revisado
    for campo in ("modificado", "etag"):
        if remota.get(campo) and reg.get(campo) != remota.get(campo):
            return "baixar"
    return "pular"


def cabecalho_tiff_valido(caminho: Path) -> bool:
    try:
        with caminho.open("rb") as f:
            return f.read(4) in (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")
    except OSError:
        return False


def trocar(destino: Path, resposta, tam: int, remota: dict, validar_tiff: bool = True) -> bool:
    """Grava a resposta em .parte, confere tamanho e (para .tif) o cabeçalho e só então instala sobre o destino. O destino NUNCA é movido
    antes: o anterior é preservado por CÓPIA (.anterior, só quando o conteúdo muda) e a instalação é um único os.replace(.parte, destino).
    False (download incompleto ou inválido) deixa destino e registro como estavam; uma exceção na leitura da resposta ou na troca final
    também apaga o temporário e deixa destino e registro intactos (a exceção segue para quem chamou)."""
    tmp = destino.with_suffix(destino.suffix + ".parte")
    try:
        with open(tmp, "wb") as f:
            for bloco in resposta.iter_content(1 << 20):
                f.write(bloco)
        if tam and tmp.stat().st_size != tam:
            tmp.unlink(missing_ok=True)
            return False
        if validar_tiff and destino.suffix == ".tif" and not cabecalho_tiff_valido(tmp):
            tmp.unlink(missing_ok=True)
            return False
        if destino.exists() and destino.read_bytes() != tmp.read_bytes():
            shutil.copy2(destino, destino.with_name(destino.name + ".anterior"))
        os.replace(tmp, destino)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    if destino.suffix == ".tif":
        gravar_meta(destino, remota)
    return True


def baixar(url: str, destino: Path) -> str:
    destino.parent.mkdir(parents=True, exist_ok=True)
    erro = ""
    for tentativa in range(6):
        try:
            cab = requests.head(url, allow_redirects=True, timeout=60).headers
            remota = meta_remota(cab)
            if decidir(destino, remota, destino.name) == "pular":
                return "pulado"
            with requests.get(url, stream=True, timeout=120) as r:
                r.raise_for_status()
                if trocar(destino, r, remota["tamanho"], remota):
                    return "baixado"
            raise OSError("download incompleto ou inválido")
        except (requests.RequestException, OSError) as e:
            erro = str(e)[:80]
            time.sleep(10 * (tentativa + 1))
    return f"ERRO {erro}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--so-malha", action="store_true")
    ap.add_argument("--so-chirps", action="store_true")
    a = ap.parse_args()
    if not a.so_chirps:
        print("malha:", baixar(MALHA, BRUTOS / "malha" / "BR_Municipios_2022.zip"), flush=True)
    if not a.so_malha:
        html = requests.get(CHIRPS, timeout=60).text
        nomes = sorted(set(re.findall(r'href="(chirps-v3\.0\.\d{4}\.\d{2}\.tif)"', html)))
        print(f"CHIRPS: {len(nomes)} arquivos ({nomes[0]} a {nomes[-1]})", flush=True)
        with ThreadPoolExecutor(2) as ex:
            res = list(ex.map(lambda n: (n, baixar(CHIRPS + n, BRUTOS / "chirps" / n)), nomes))
        erros = [(n, r) for n, r in res if r.startswith("ERRO")]
        print(f"CHIRPS: {sum(r == 'baixado' for _, r in res)} baixados, {sum(r == 'pulado' for _, r in res)} já havia, {len(erros)} com erro", flush=True)
        for n, r in erros:
            print("  ", n, r)
        if erros:
            sys.exit(1)


if __name__ == "__main__":
    main()
