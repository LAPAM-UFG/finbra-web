"""Transferências às famílias a partir das fontes oficiais → data/silver.

  bolsa_familia_mensal/AAAAMM.parquet  pagamentos de um mês somados por município (Portal da
                                       Transparência, arquivos em lote, sem chave): famílias
                                       (NIS distintos), parcelas e valor, com o programa do mês
  siafi_ibge.csv (em pipeline/)        correspondência código SIAFI → código IBGE, versionada
  inss_municipios.parquet              benefícios do INSS emitidos em dezembro, por município
                                       (Ministério da Previdência, planilha anual)

Definições: famílias = beneficiários distintos (NIS) pagos em dezembro; valor = soma das parcelas
pagas nos 12 meses do ano; INSS = quantidade de benefícios previdenciários emitidos em dezembro (sem
os assistenciais), também aposentadorias e pensões. O programa muda ao longo do tempo: Bolsa Família
até nov/2021, Auxílio Brasil de nov/2021 a fev/2023 (em nov/2021 os dois), Novo Bolsa Família a partir
de mar/2023.

Os arquivos baixados (~300 MB por mês) ficam numa pasta temporária fora do projeto e são apagados
depois de somados; só o agregado mensal vai para a silver. Meses já agregados não são baixados de novo.

Uso:
    py pipeline/familias.py --anos 2022 2023 2024 2025     # carga dos anos
    py pipeline/familias.py --atualizar                     # só os meses que faltam até o mais recente
"""
import argparse
import csv
import difflib
import re
import shutil
import tempfile
import time
import unicodedata
import zipfile
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

import duckdb
import pandas as pd
import requests

from config import SILVER

PORTAL = "https://portaldatransparencia.gov.br/download-de-dados"
PREVIDENCIA = "https://www.gov.br/previdencia/pt-br/assuntos/previdencia-social/arquivos/ben_municipios_especie_{ano}.xlsx"
CABECALHO = {"User-Agent": "Mozilla/5.0 (compatible; LAPAM-finbra/1.0; +https://github.com/LAPAM-UFG/finbra-web)"}
MENSAL = SILVER / "bolsa_familia_mensal"
MAPA = Path(__file__).resolve().parent / "siafi_ibge.csv"
PRIMEIRO_ANO = 2013  # primeiro exercício das contas fiscais (SICONFI)


def programas(aaaamm: int) -> list[tuple[str, str]]:
    """(conjunto no Portal, nome do programa) do mês. Em nov/2021 pagaram os dois programas."""
    if aaaamm <= 202110:
        return [("bolsa-familia-pagamentos", "Bolsa Família")]
    if aaaamm == 202111:
        return [("bolsa-familia-pagamentos", "Bolsa Família"), ("auxilio-brasil", "Auxílio Brasil")]
    if aaaamm <= 202302:
        return [("auxilio-brasil", "Auxílio Brasil")]
    return [("novo-bolsa-familia", "Novo Bolsa Família")]


class PortalIndisponivel(RuntimeError):
    """O Portal respondeu com a página de instabilidade (ou falhou) em todas as tentativas."""


def baixar(url: str, destino: Path, tentativas: int = 6) -> bool:
    """Baixa em blocos; False se o arquivo não existe (403/404 = mês ainda não publicado).

    Quando o Portal está instável, ele redireciona para uma página HTML de erro (landpage.cgu.gov.br)
    com status 200; isso conta como falha e é tentado de novo, com espera crescente (até ~1 h no total).
    """
    for n in range(tentativas):
        try:
            with requests.get(url, headers=CABECALHO, stream=True, timeout=600) as r:
                if r.status_code in (403, 404):
                    return False
                r.raise_for_status()
                if "html" in r.headers.get("Content-Type", "") or "landpage" in r.url:
                    raise requests.RequestException(f"Portal indisponível ({r.url})")
                with open(destino, "wb") as f:
                    for bloco in r.iter_content(1 << 20):
                        f.write(bloco)
            if not zipfile.is_zipfile(destino):
                raise requests.RequestException("o arquivo recebido não é um zip")
            return True
        except requests.RequestException as e:
            espera = 60 * 2 ** n  # 1, 2, 4, 8, 16, 32 min
            print(f"  falhou ({e}); nova tentativa em {espera // 60} min", flush=True)
            time.sleep(espera)
    raise PortalIndisponivel(url)


def agregar_mes(aaaamm: int, temporario: Path) -> bool:
    """Baixa o mês (um arquivo por programa), soma por município e grava bolsa_familia_mensal/AAAAMM.parquet."""
    pasta = Path(tempfile.mkdtemp(prefix=f"bf_{aaaamm}_", dir=temporario))
    try:
        selects = []
        for i, (conjunto, nome) in enumerate(programas(aaaamm)):
            arq = pasta / f"{i}.zip"
            if not baixar(f"{PORTAL}/{conjunto}/{aaaamm}", arq):
                return False
            with zipfile.ZipFile(arq) as z:
                membro = next(n for n in z.namelist() if n.lower().endswith(".csv"))
                z.extract(membro, pasta)
            arq.unlink()
            selects.append(f"""
                SELECT {aaaamm} AS aaaamm, '{nome}' AS programa, "UF" AS uf,
                       "CÓDIGO MUNICÍPIO SIAFI" AS siafi, any_value("NOME MUNICÍPIO") AS nome_portal,
                       count(DISTINCT "NIS FAVORECIDO") AS familias, count(*) AS parcelas,
                       sum(replace(replace("VALOR PARCELA", '.', ''), ',', '.')::DOUBLE) AS valor
                FROM read_csv('{(pasta / membro).as_posix()}', delim=';', header=true, encoding='latin-1', all_varchar=true)
                GROUP BY ALL""")
            time.sleep(3)
        MENSAL.mkdir(parents=True, exist_ok=True)
        duckdb.connect().execute(f"""COPY ({' UNION ALL '.join(selects)})
                                      TO '{(MENSAL / f"{aaaamm}.parquet").as_posix()}' (FORMAT parquet)""")
        return True
    finally:
        shutil.rmtree(pasta, ignore_errors=True)


# Municípios que mudaram de nome: o Portal ainda usa o nome antigo (uf, código SIAFI) → código IBGE.
# Fernando de Noronha (PE, SIAFI 3001) é distrito estadual, sem DCA própria: fica sem correspondência.
MANUAIS = {
    ("RN", "1805"): 2410306,  # Serra Caiada (ex-Presidente Juscelino)
    ("PB", "0522"): 2513968,  # São Domingos (ex-São Domingos de Pombal)
    ("TO", "9691"): 1720499,  # São Valério (ex-São Valério da Natividade)
    ("RN", "1625"): 2401305,  # Campo Grande (ex-Augusto Severo)
    ("PB", "2209"): 2515401,  # São Vicente do Seridó (ex-Seridó)
    ("RN", "1703"): 2405306,  # Boa Saúde (ex-Januário Cicco)
    ("TO", "0345"): 1708254,  # Tabocão (ex-Fortaleza do Tabocão)
}


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().upper()
    return " ".join(re.sub(r"[^A-Z0-9 ]", " ", s).split())


def atualizar_mapa():
    """Correspondência SIAFI → IBGE: nome exato (normalizado) na UF e, se não houver, o mais parecido
    na UF (registrado como 'similaridade', para revisão). Linhas já existentes no CSV são mantidas."""
    existentes = {}
    if MAPA.exists():
        with open(MAPA, encoding="utf-8", newline="") as f:
            existentes = {(r["uf"], r["siafi"]): r for r in csv.DictReader(f)}
    portal = duckdb.connect().execute(
        f"SELECT DISTINCT uf, siafi, any_value(nome_portal) FROM '{MENSAL.as_posix()}/*.parquet' GROUP BY 1, 2").fetchall()
    entes = pd.read_parquet(SILVER / "entes.parquet")
    entes = entes[entes.esfera == "M"]
    por_uf = {uf: {_norm(n): (int(c), n) for c, n in zip(g.cod_ibge, g.nome)} for uf, g in entes.groupby("uf")}
    for uf, siafi, nome in portal:
        if (uf, siafi) in existentes:
            continue
        opcoes = por_uf.get(uf, {})
        alvo = _norm(nome)
        if (uf, siafi) in MANUAIS:
            cod = MANUAIS[(uf, siafi)]
            oficial = next((n for c, n in opcoes.values() if c == cod), "")
            metodo, sim = "manual (mudança de nome)", ""
        elif alvo in opcoes:
            cod, oficial = opcoes[alvo]
            metodo, sim = "nome exato", 1.0
        else:
            melhor = difflib.get_close_matches(alvo, list(opcoes), n=1, cutoff=0.75)
            if not melhor:
                print(f"  SEM CORRESPONDÊNCIA: {uf} {siafi} {nome}")
                continue
            cod, oficial = opcoes[melhor[0]]
            metodo, sim = "similaridade", round(difflib.SequenceMatcher(None, alvo, melhor[0]).ratio(), 3)
        existentes[(uf, siafi)] = {"uf": uf, "siafi": siafi, "nome_portal": nome, "cod_ibge": cod,
                                   "nome_ibge": oficial, "metodo": metodo, "similaridade": sim}
    with open(MAPA, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["uf", "siafi", "nome_portal", "cod_ibge", "nome_ibge", "metodo", "similaridade"])
        w.writeheader()
        for k in sorted(existentes):
            w.writerow(existentes[k])
    sim = sum(1 for r in existentes.values() if r["metodo"] == "similaridade")
    print(f"mapa SIAFI→IBGE: {len(existentes)} municípios ({sim} por similaridade, revisar em {MAPA.name})")


# ---------------- INSS (planilhas anuais da Previdência) ----------------

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def _linhas_xlsx(z: zipfile.ZipFile, folha: str, textos: list[str]):
    for row in ET.fromstring(z.read(folha)).find("m:sheetData", NS).findall("m:row", NS):
        vals = []
        for c in row.findall("m:c", NS):
            v = c.find("m:v", NS)
            s = v.text if v is not None else ""
            vals.append(textos[int(s)] if c.get("t") == "s" and s else s)
        # o código IBGE está na 1ª coluna (até 2021) ou na 2ª (2022+); as colunas de valores são as mesmas
        for i in (0, 1):
            if len(vals) > 12 and re.fullmatch(r"\d{7}", vals[i] or ""):
                yield int(vals[i]), vals[2:]
                break


def inss(anos: list[int], temporario: Path):
    """Benefícios emitidos em dezembro, por município, de cada ano com planilha publicada."""
    saida = []
    for ano in anos:
        arq = Path(tempfile.mkdtemp(dir=temporario)) / f"{ano}.xlsx"
        if not baixar(PREVIDENCIA.format(ano=ano), arq):
            print(f"  INSS {ano}: planilha não publicada")
            continue
        with zipfile.ZipFile(arq) as z:
            textos = ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"]))
                      for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS)]
            for cod, v in _linhas_xlsx(z, "xl/worksheets/sheet1.xml", textos):
                num = lambda i: float(v[i - 2]) if v[i - 2] not in ("", None) else None  # noqa: E731
                saida.append((ano, cod, num(3), num(7), num(10), num(11), num(12)))
        shutil.rmtree(arq.parent, ignore_errors=True)
        print(f"  INSS {ano} ok")
    if not saida:
        return
    novo = pd.DataFrame(saida, columns=["exercicio", "cod_ibge", "aposentadorias", "pensoes",
                                        "previdenciarios", "assistenciais", "total"])
    destino = SILVER / "inss_municipios.parquet"
    if destino.exists():
        antigo = pd.read_parquet(destino)
        novo = pd.concat([antigo[~antigo.exercicio.isin(novo.exercicio.unique())], novo], ignore_index=True)
    novo.sort_values(["exercicio", "cod_ibge"]).to_parquet(destino, index=False)


def meses_desejados(anos: list[int] | None) -> list[int]:
    hoje = date.today()
    ultimo = hoje.year * 100 + hoje.month
    anos = anos or list(range(PRIMEIRO_ANO, hoje.year + 1))
    return [a * 100 + m for a in anos for m in range(1, 13) if a * 100 + m < ultimo]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--anos", nargs="+", type=int, help=f"exercícios (padrão: {PRIMEIRO_ANO} até o atual)")
    p.add_argument("--atualizar", action="store_true", help="só os meses ainda não agregados")
    p.add_argument("--sem-inss", action="store_true")
    p.add_argument("--temporario", default=tempfile.gettempdir(), help="pasta para os downloads (fora do projeto)")
    args = p.parse_args()
    temporario = Path(args.temporario)

    feitos = {int(a.stem) for a in MENSAL.glob("*.parquet")} if MENSAL.exists() else set()
    for aaaamm in meses_desejados(args.anos):
        if args.atualizar and aaaamm in feitos:
            continue
        inicio = time.time()
        try:
            novo = agregar_mes(aaaamm, temporario)
        except PortalIndisponivel:
            # os meses já agregados ficam; --atualizar retoma daqui na próxima execução
            print(f"Bolsa Família {aaaamm}: Portal da Transparência indisponível; parando a carga. "
                  "Rode de novo com --atualizar mais tarde.", flush=True)
            break
        if novo:
            nomes = " + ".join(n for _, n in programas(aaaamm))
            print(f"Bolsa Família {aaaamm} ({nomes}) ok em {time.time() - inicio:.0f} s", flush=True)
        else:
            print(f"Bolsa Família {aaaamm}: ainda não publicado", flush=True)
        time.sleep(3)  # sem pressa com o servidor do Portal
    if MENSAL.exists() and any(MENSAL.glob("*.parquet")):
        atualizar_mapa()
    if not args.sem_inss:
        anos = args.anos or list(range(PRIMEIRO_ANO, date.today().year))
        faltam = anos
        destino = SILVER / "inss_municipios.parquet"
        if args.atualizar and destino.exists():
            tem = set(pd.read_parquet(destino).exercicio.unique())
            faltam = [a for a in anos if a not in tem]
        if faltam:
            inss(faltam, temporario)


if __name__ == "__main__":
    main()
