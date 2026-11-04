"""Leitura de planilhas .xls (xlrd) e .xlsx (zip + XML, sem openpyxl), uma aba por vez, linha a linha.

Cada linha sai como lista de valores: float para números e str para texto; célula vazia é ''.
"""
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _coluna(ref: str) -> int:
    n = 0
    for ch in re.match(r"[A-Z]+", ref).group(0):
        n = n * 26 + ord(ch) - 64
    return n - 1


class Planilha:
    """Abre o arquivo e entrega os nomes das abas e as linhas de cada uma."""

    def __init__(self, arquivo: Path):
        self.arquivo = Path(arquivo)
        self.xlsx = self.arquivo.suffix.lower() == ".xlsx"
        if self.xlsx:
            self._z = zipfile.ZipFile(self.arquivo)
            self._textos = []
            if "xl/sharedStrings.xml" in self._z.namelist():
                for si in ET.parse(self._z.open("xl/sharedStrings.xml")).getroot().findall(f"{NS}si"):
                    self._textos.append("".join(t.text or "" for t in si.iter(f"{NS}t")))
            livro = ET.parse(self._z.open("xl/workbook.xml")).getroot()
            rels = {r.get("Id"): r.get("Target") for r in ET.parse(self._z.open("xl/_rels/workbook.xml.rels")).getroot()}
            self._abas = {s.get("name"): "xl/" + rels[s.get(f"{NS_REL}id")].lstrip("/").replace("xl/", "", 1)
                          for s in livro.find(f"{NS}sheets")}
        else:
            import xlrd

            self._livro = xlrd.open_workbook(self.arquivo, on_demand=True)
            self._abas = {n: n for n in self._livro.sheet_names()}

    def fechar(self):
        if self.xlsx:
            self._z.close()
        else:
            self._livro.release_resources()

    @property
    def abas(self) -> list[str]:
        return list(self._abas)

    def linhas(self, aba: str):
        if not self.xlsx:
            folha = self._livro.sheet_by_name(aba)
            for i in range(folha.nrows):
                yield folha.row_values(i)
            self._livro.unload_sheet(aba)
            return
        for _, el in ET.iterparse(self._z.open(self._abas[aba]), events=("end",)):
            if el.tag != f"{NS}row":
                continue
            linha: dict[int, object] = {}
            for c in el.findall(f"{NS}c"):
                v, t = c.find(f"{NS}v"), c.get("t")
                if t == "inlineStr":
                    val: object = "".join(x.text or "" for x in c.iter(f"{NS}t"))
                elif v is None or v.text is None:
                    continue
                elif t == "s":
                    val = self._textos[int(v.text)]
                elif t in ("str", "b", "e"):
                    val = v.text
                else:
                    val = float(v.text)
                linha[_coluna(c.get("r"))] = val
            el.clear()
            yield [linha.get(i, "") for i in range(max(linha) + 1)] if linha else []
