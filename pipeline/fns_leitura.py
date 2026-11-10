"""FNS (repasses fundo a fundo): leitura exata dos arquivos anuais "REPASSE-FAF-COM-POPULACAO" do Portal do FNS.

Fonte: https://portalfns.saude.gov.br/downloads/ (um arquivo por ano, 2002–2025). Os brutos ficam em E:/finbra/brutos/fns
(fns_baixar.py). Este módulo só lê e interpreta células; as regras de destinatário e os agregados estão em fns.py.

Os arquivos mudam de forma ao longo dos anos (CSV em cp1252 com vírgula e aspas; CSV em UTF-8 com BOM e ponto e vírgula; XLSX em 2025;
ESTRATÉGIA com e sem acento; datas d/m/aaaa, d/m/aa e série do Excel). Tudo vira dicionários de TEXTO bruto com os mesmos campos;
valores e datas são interpretados à parte (parse_decimal, parse_data), com erro explícito para o que for ambíguo.
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterator

CAMPOS = ("bloco", "grupo", "estrategia", "uf", "municipio", "cod_ibge6", "qt_populacao", "nu_ano_referencia_ibge", "cnpj",
          "entidade", "banco", "agencia", "conta", "tp_repasse", "tp_repasse_estado", "st_faf", "st_hu", "dt_ultima_liberacao",
          "vl_bruto", "vl_liquido", "vl_saldo_conta", "dt_saldo_conta")
CABECALHO = {"CO_MUNICIPIO_IBGE": "cod_ibge6", **{c.upper(): c for c in CAMPOS}}


def sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normalizar_cabecalho(h: str) -> str:
    return sem_acento(h.replace("\ufeff", "").strip()).upper()


def decodificar(dados: bytes) -> tuple[str, str]:
    """Texto e codificação: UTF-8 (com ou sem BOM) se for válido; senão cp1252 (os arquivos antigos). Nada é substituído em silêncio."""
    try:
        return dados.decode("utf-8-sig"), "utf-8"
    except UnicodeDecodeError:
        return dados.decode("cp1252", errors="strict"), "cp1252"


def _mapa_cabecalho(nomes, caminho) -> list[str | None]:
    cab = [CABECALHO.get(normalizar_cabecalho(h)) for h in nomes]
    faltam = [c for c in CAMPOS if c not in cab]
    if faltam:
        raise ValueError(f"{caminho}: colunas ausentes {faltam}")
    return cab


def ler_csv(caminho: Path) -> tuple[Iterator[dict[str, str]], dict]:
    texto, cod = decodificar(Path(caminho).read_bytes())
    primeira = texto.split("\n", 1)[0]
    delim = ";" if primeira.count(";") > primeira.count(",") else ","
    leitor = csv.reader(io.StringIO(texto, newline=""), delimiter=delim)
    cab = _mapa_cabecalho(next(leitor), caminho)

    def linhas():
        for r in leitor:
            if not r or all(not x.strip() for x in r):
                continue
            yield {c: (r[i] if i < len(r) else "") for i, c in enumerate(cab) if c}

    return linhas(), {"codificacao": cod, "delimitador": delim, "serie_excel": False}


NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _col(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


def ler_xlsx(caminho: Path) -> tuple[Iterator[dict[str, str]], dict]:
    """Primeira aba do .xlsx com o TEXTO de cada célula como está no XML (números sem passar por float).
    Datas do Excel saem como o número de série; parse_data(..., serie=True) as converte."""
    z = zipfile.ZipFile(caminho)
    textos = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.parse(z.open("xl/sharedStrings.xml")).getroot().findall(f"{NS}si"):
            textos.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
    livro = ET.parse(z.open("xl/workbook.xml")).getroot()
    rels = {r.get("Id"): r.get("Target") for r in ET.parse(z.open("xl/_rels/workbook.xml.rels")).getroot()}
    abas = [(s.get("name"), "xl/" + rels[s.get(f"{NS_REL}id")].lstrip("/").replace("xl/", "", 1)) for s in livro.find(f"{NS}sheets")]
    nome, arq = abas[0]

    def celulas():
        for _, el in ET.iterparse(z.open(arq), events=("end",)):
            if el.tag != f"{NS}row":
                continue
            linha = {}
            for c in el.findall(f"{NS}c"):
                v, t = c.find(f"{NS}v"), c.get("t")
                if t == "inlineStr":
                    val = "".join(x.text or "" for x in c.iter(f"{NS}t"))
                elif v is None or v.text is None:
                    continue
                elif t == "s":
                    val = textos[int(v.text)]
                else:
                    val = v.text
                linha[_col(c.get("r"))] = val
            el.clear()
            yield linha

    it = celulas()
    cab_linha = next(it)
    cab = dict(zip(cab_linha.keys(), _mapa_cabecalho(list(cab_linha.values()), caminho)))

    def linhas():
        for r in it:
            if not r or all(not str(x).strip() for x in r.values()):
                continue
            yield {c: r.get(i, "") for i, c in cab.items() if c}

    return linhas(), {"codificacao": "xlsx", "delimitador": None, "aba": nome, "serie_excel": True}


def ler_arquivo(caminho: Path):
    return ler_xlsx(caminho) if Path(caminho).suffix.lower() == ".xlsx" else ler_csv(caminho)


_NUM = re.compile(r"^[+-]?\d+([.]\d+)?([eE][+-]?\d+)?$")


def parse_decimal(texto: str | None) -> Decimal | None:
    """Valor monetário exato. Vazio → None (ausente, não zero).
    Com vírgula: vírgula decimal e pontos de milhar ('1.234,56' → 1234.56). Sem vírgula: ponto decimal (como no XLSX).
    Ambíguo ou fora do formato (várias vírgulas, vários pontos sem vírgula, ponto depois da vírgula, letras) → ValueError."""
    if texto is None:
        return None
    s = str(texto).strip().replace("R$", "").replace("\xa0", "").replace(" ", "")
    if s == "":
        return None
    if "," in s:
        if s.count(",") > 1 or (s.count(".") and s.rfind(".") > s.rfind(",")):
            raise ValueError(f"valor ambíguo: {texto!r}")
        s = s.replace(".", "").replace(",", ".")
    elif s.count(".") > 1:
        raise ValueError(f"valor ambíguo: {texto!r}")
    if not _NUM.match(s):
        raise ValueError(f"valor inválido: {texto!r}")
    try:
        return Decimal(s)
    except InvalidOperation as e:
        raise ValueError(f"valor inválido: {texto!r}") from e


def parse_data(texto: str | None, serie: bool = False) -> date | None:
    """Data. Aceita d/m/aaaa, d/m/aa (aa → 20aa), aaaa-mm-dd e, com serie=True, a série do Excel. Vazio → None; outro formato → ValueError."""
    if texto is None or str(texto).strip() == "":
        return None
    s = str(texto).strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})(\s.*)?$", s)
    if m:
        a = int(m.group(3))
        return date(a if len(m.group(3)) == 4 else 2000 + a, int(m.group(2)), int(m.group(1)))
    if re.match(r"^\d{4}-\d{2}-\d{2}", s):
        return date.fromisoformat(s[:10])
    if serie and re.match(r"^\d+([.]\d+)?$", s):
        return date(1899, 12, 30) + timedelta(days=int(float(s)))
    raise ValueError(f"data inválida: {texto!r}")
