"""Testes do pipeline do FNS (repasses fundo a fundo): leitura, valores, destinatários, DF, duplicidades, agregação, população, IPCA e ausência.
Os testes sintéticos não precisam dos dados reais; a conferência com os arquivos originais roda só se o candidato e os brutos existirem
(--real é implícito quando existem; use --sem-real para pular).

Uso:
    py pipeline/testes_fns.py
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from datetime import date
from decimal import Decimal
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
import fns as m  # noqa: E402
import fns_baixar  # noqa: E402
import fns_leitura as lei  # noqa: E402

falhas = []
executados = 0


def teste(nome, ok, detalhe=""):
    global executados
    executados += 1
    print(f"{'ok ' if ok else 'FALHOU'}  {nome}{'' if ok else f' — {detalhe}'}")
    if not ok:
        falhas.append(nome)


def levanta(f, *a):
    try:
        f(*a)
    except ValueError:
        return True
    return False


# ---------- valores e datas ----------
D = lei.parse_decimal
teste("vírgula decimal", D("8237,04") == Decimal("8237.04"))
teste("milhar com ponto e vírgula decimal", D("1.234.567,89") == Decimal("1234567.89"))
teste("inteiro sem separador", D("255000") == Decimal("255000"))
teste("ponto decimal do XLSX", D("25239.31") == Decimal("25239.31"))
teste("notação científica do XLSX", D("7.0000000000000007E-2") == Decimal("7.0000000000000007E-2"))
teste("negativo", D("-1,5") == Decimal("-1.5"))
teste("vazio é ausente (None), não zero", D("") is None and D("   ") is None and D(None) is None)
teste("R$ e espaços são ignorados", D("R$ 10,50") == Decimal("10.50"))
teste("vários pontos sem vírgula são ambíguos", levanta(D, "1.234.567"))
teste("duas vírgulas são ambíguas", levanta(D, "1,234,56"))
teste("ponto depois da vírgula é ambíguo", levanta(D, "1,234.56"))
teste("texto não é valor", levanta(D, "abc") and levanta(D, "-") and levanta(D, "12,3x"))
teste("exatidão: 0,1 + 0,2 == 0,3", D("0,1") + D("0,2") == Decimal("0.3"))
teste("centavos aceita ruído de ponto flutuante", m.centavos(Decimal("25239.309999999998")) == Decimal("25239.31"))
teste("centavos recusa fração real de centavo", levanta(m.centavos, Decimal("10.005")))
P = lei.parse_data
teste("data d/m/aaaa", P("8/07/2010") == date(2010, 7, 8))
teste("data d/m/aa vira 20aa", P("28/12/22") == date(2022, 12, 28))
teste("data ISO com hora", P("2023-12-28 00:00:00.000") == date(2023, 12, 28))
teste("série do Excel (46022 = 31/12/2025)", P("46022", serie=True) == date(2025, 12, 31))
teste("número solto sem série do Excel é inválido", levanta(P, "46022"))
teste("data vazia é None", P("") is None)
teste("data inválida levanta erro", levanta(P, "31/02/2020"))

# ---------- classificação dos destinatários ----------
CAD = frozenset({355030, 120001, 530010, 431490, 150475})


def linha(**k):
    r = {c: "" for c in lei.CAMPOS}
    r.update(uf="SP", municipio="SAO PAULO", cod_ibge6="355030", cnpj="46392130000118", entidade="FUNDO MUNICIPAL DE SAUDE", tp_repasse="MUNICIPAL",
           tp_repasse_estado="N", st_faf="S", st_hu="N", bloco="B", grupo="G", estrategia="E", banco="001", agencia="1", conta="1",
           vl_bruto="100,00", vl_liquido="90,00", dt_ultima_liberacao="1/02/2018")
    r.update(k)
    return r


def cls(**k):
    r = linha(**k)
    cod = int(r["cod_ibge6"]) if r["cod_ibge6"].isdigit() else None
    return m.classificar(r, r["tp_repasse"].strip().upper(), cod, CAD)


teste("MUNICIPAL em município do cadastro entra", cls() == ("municipal", None))
teste("ESTADUAL em município (fundo estadual em SP) fica de fora", cls(tp_repasse="ESTADUAL", tp_repasse_estado="S", entidade="FUNDO ESTADUAL DE SAUDE") == ("excluido", "estadual"))
teste("o nome 'MUNICIPIO DE ASSIS BRASIL' classificado ESTADUAL não é reclassificado pelo nome",
      cls(tp_repasse="ESTADUAL", tp_repasse_estado="S", uf="AC", cod_ibge6="120001", entidade="MUNICIPIO DE ASSIS BRASIL") == ("excluido", "estadual"))
teste("o nome 'FUNDO ESTADUAL' classificado MUNICIPAL também não é reclassificado", cls(entidade="FUNDO ESTADUAL DE SAUDE") == ("municipal", None))
teste("a localização não define o destinatário (ESTADUAL numa capital continua estadual)", cls(tp_repasse="ESTADUAL", tp_repasse_estado="S", cod_ibge6="431490", uf="RS")[0] == "excluido")
DF = dict(uf="DF", municipio="BRASILIA", cod_ibge6="530010", tp_repasse="ESTADUAL", tp_repasse_estado="S")
teste("DF: Secretaria de Saúde (CNPJ comprovado) entra como distrital", cls(**DF, cnpj="00394700000108") == ("distrital", None))
teste("DF: Fundo de Saúde (CNPJ comprovado) entra como distrital", cls(**DF, cnpj="12116247000157") == ("distrital", None))
teste("DF: Fundo histórico (RAG2009, CNPJ comprovado) entra como distrital", cls(**DF, cnpj="00394700000299") == ("distrital", None))
teste("DF: outro CNPJ em Brasília fica de fora", cls(**DF, cnpj="99999999000199") == ("excluido", "df_destinatario_nao_comprovado"))
teste("DF: CNPJ comprovado com UF diferente de DF não entra como distrital", cls(**{**DF, "uf": "GO"}, cnpj="12116247000157")[0] != "distrital")
teste("DF: linha MUNICIPAL em Brasília com CNPJ não comprovado fica de fora", cls(uf="DF", cod_ibge6="530010", cnpj="99999999000199")[0] == "excluido")
teste("tp_repasse desconhecido vai para a quarentena", cls(tp_repasse="OUTRO")[0] == "quarentena")
teste("tp_repasse vazio vai para a quarentena", cls(tp_repasse="")[0] == "quarentena")
teste("flags conflitantes (MUNICIPAL com TP_REPASSE_ESTADO=S) vão para a quarentena", cls(tp_repasse_estado="S")[0] == "quarentena")
teste("flags conflitantes (ESTADUAL com TP_REPASSE_ESTADO=N) vão para a quarentena", cls(tp_repasse="ESTADUAL", tp_repasse_estado="N")[0] == "quarentena")
teste("ST_FAF diferente de S vai para a quarentena", cls(st_faf="N")[0] == "quarentena")
teste("município fora do cadastro vai para a quarentena", cls(cod_ibge6="999999")[0] == "quarentena")
teste("código com menos de 6 dígitos vai para a quarentena", cls(cod_ibge6="3550")[0] == "quarentena")
teste("UF que não bate com o código vai para a quarentena", cls(uf="RJ")[0] == "quarentena")
teste("CNPJ do DF é texto com zeros: os três documentados têm 14 dígitos", all(len(c) == 14 and isinstance(c, str) for c in m.DF_CNPJ) and set(m.DF_CNPJ) == {"00394700000108", "00394700000299", "12116247000157"})

# ---------- arquivos sintéticos ----------
CAB = ["BLOCO", "GRUPO", "ESTRATÉGIA", "UF", "MUNICIPIO", "CO_MUNICIPIO_IBGE", "QT_POPULACAO", "NU_ANO_REFERENCIA_IBGE", "CNPJ", "ENTIDADE", "BANCO", "AGENCIA",
       "CONTA", "TP_REPASSE", "TP_REPASSE_ESTADO", "ST_FAF", "ST_HU", "DT_ULTIMA_LIBERACAO", "VL_BRUTO", "VL_LIQUIDO", "VL_SALDO_CONTA", "DT_SALDO_CONTA"]


def csv_linha(r, delim):
    return delim.join('"' + r[c] + '"' for c in lei.CAMPOS)


def escrever_csv(caminho, linhas, delim=",", enc="cp1252", bom=False, cabecalho=None):
    cab = cabecalho or CAB
    txt = delim.join(f'"{h}"' for h in cab) + "\n" + "\n".join(csv_linha(r, delim) for r in linhas) + "\n"
    caminho.write_bytes((b"\xef\xbb\xbf" if bom else b"") + txt.encode(enc))


def escrever_xlsx(caminho, linhas):
    """XLSX mínimo: textos como strings compartilhadas e números/datas como números (como no arquivo do FNS)."""
    textos, sheet = [], []

    def cel(ref, v, numero=False):
        if numero:
            return f'<c r="{ref}"><v>{v}</v></c>'
        if v not in textos:
            textos.append(v)
        return f'<c r="{ref}" t="s"><v>{textos.index(v)}</v></c>'

    letras = "ABCDEFGHIJKLMNOPQRSTUV"
    sheet.append("<row>" + "".join(cel(f"{letras[i]}1", h) for i, h in enumerate(CAB)) + "</row>")
    numericos = {"cod_ibge6", "qt_populacao", "nu_ano_referencia_ibge", "dt_ultima_liberacao", "vl_bruto", "vl_liquido", "vl_saldo_conta", "dt_saldo_conta"}
    for n, r in enumerate(linhas, 2):
        cels = []
        for i, c in enumerate(lei.CAMPOS):
            v = r[c]
            if v == "":
                continue
            cels.append(cel(f"{letras[i]}{n}", v, numero=c in numericos and v.replace(".", "").replace("E-", "").replace("-", "").isdigit()))
        sheet.append("<row>" + "".join(cels) + "</row>")
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    with zipfile.ZipFile(caminho, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {ns} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>')
        z.writestr("xl/sharedStrings.xml", f"<sst {ns}>" + "".join(f"<si><t>{t.replace('&', '&amp;')}</t></si>" for t in textos) + "</sst>")
        z.writestr("xl/worksheets/sheet1.xml", f"<worksheet {ns}><sheetData>" + "".join(sheet) + "</sheetData></worksheet>")


with tempfile.TemporaryDirectory() as tmp_:
    tmp = Path(tmp_)
    # --- leitura: três formatos
    a = tmp / "a.csv"
    escrever_csv(a, [linha(entidade="MUNICÍPIO DE SÃO PAULO")], enc="cp1252")
    it, info = lei.ler_arquivo(a)
    r = next(it)
    it.close()
    teste("CSV cp1252 com vírgula: codificação e acentos", info["codificacao"] == "cp1252" and info["delimitador"] == "," and r["entidade"] == "MUNICÍPIO DE SÃO PAULO", (info, r["entidade"]))
    b = tmp / "b.csv"
    escrever_csv(b, [linha(entidade="MUNICÍPIO DE SÃO PAULO")], delim=";", enc="utf-8", bom=True, cabecalho=[h.replace("É", "E") for h in CAB])
    it, info = lei.ler_arquivo(b)
    r = next(it)
    teste("CSV UTF-8 com BOM, ponto e vírgula e ESTRATEGIA sem acento", info["codificacao"] == "utf-8" and info["delimitador"] == ";" and r["entidade"] == "MUNICÍPIO DE SÃO PAULO" and r["cnpj"] == "46392130000118", (info, r))
    teste("o CNPJ com zeros à esquerda é preservado como texto", next(lei.ler_arquivo((escrever_csv(tmp / "z.csv", [linha(cnpj="00394700000108")]), tmp / "z.csv")[1])[0])["cnpj"] == "00394700000108")
    x = tmp / "c.xlsx"
    escrever_xlsx(x, [linha(vl_bruto="25239.309999999998", vl_liquido="25239.31", dt_ultima_liberacao="46022", cnpj="00394700000108")])
    it, info = lei.ler_arquivo(x)
    r = next(it)
    it.close()
    teste("XLSX: texto bruto do número (sem float) e CNPJ como texto", r["vl_bruto"] == "25239.309999999998" and r["cnpj"] == "00394700000108" and info["serie_excel"], r)

    # --- processar_arquivo: duplicidades, valores, saldo, ruído, classes
    base = [
        linha(conta="1", estrategia="E1", vl_bruto="1.000,10", vl_liquido="900,05", vl_saldo_conta="123456789,00"),
        linha(conta="1", estrategia="E2", vl_bruto="10,00", vl_liquido="9,00", vl_saldo_conta="123456789,00"),   # saldo repetido: nunca soma
        linha(conta="2", estrategia="E1", vl_bruto="5,00", vl_liquido="5,00"),                                       # duplicada exata (2 cópias)
        linha(conta="2", estrategia="E1", vl_bruto="5,00", vl_liquido="5,00"),
        linha(conta="3", estrategia="E1", vl_bruto="7,00", vl_liquido="7,00"),                                       # mesma chave, valores diferentes
        linha(conta="3", estrategia="E1", vl_bruto="8,00", vl_liquido="8,00"),
        linha(conta="4", estrategia="E1", vl_bruto="abc", vl_liquido="1,00"),                                        # valor inválido
        linha(conta="5", estrategia="E1", vl_bruto="", vl_liquido="1,00"),                                           # valor ausente
        linha(conta="6", estrategia="E1", vl_bruto="1,005", vl_liquido="1,005"),                                     # fração de centavo
        linha(conta="7", estrategia="E1", tp_repasse="ESTADUAL", tp_repasse_estado="S", vl_bruto="1000,00", vl_liquido="1000,00"),   # estadual
        linha(conta="8", estrategia="E1", cod_ibge6="530010", uf="DF", tp_repasse="ESTADUAL", tp_repasse_estado="S", cnpj="12116247000157", vl_bruto="50,00", vl_liquido="40,00"),
        linha(conta="9", estrategia="E1", cod_ibge6="530010", uf="DF", tp_repasse="ESTADUAL", tp_repasse_estado="S", cnpj="99999999000199", vl_bruto="60,00", vl_liquido="60,00"),
        linha(conta="11", estrategia="E1", cod_ibge6="530010", uf="DF", tp_repasse="ESTADUAL", tp_repasse_estado="S", cnpj="00394700000299", vl_bruto="20,00", vl_liquido="15,00"),
        # a mesma conta e estratégia como MUNICIPAL e ESTADUAL: cada linha segue a sua classe, sem quarentena (e auditadas)
        linha(conta="10", estrategia="E1", cod_ibge6="120001", uf="AC", vl_bruto="20,00", vl_liquido="20,00"),
        linha(conta="10", estrategia="E1", cod_ibge6="120001", uf="AC", tp_repasse="ESTADUAL", tp_repasse_estado="S", vl_bruto="30,00", vl_liquido="30,00"),
    ]
    arq = tmp / "ano.csv"
    escrever_csv(arq, base)
    res = m.processar_arquivo(2018, str(arq), CAD)
    motivos = sorted(q["motivo"].split(":")[0] for q in res["quarentena"])
    teste("linhas completas duplicadas: todas as cópias em quarentena", motivos.count("duplicada_exata") == 2, motivos)
    teste("mesma chave na mesma classe com valores diferentes: todas as cópias em quarentena", motivos.count("chave_de_conta_repetida") == 2, motivos)
    teste("valor inválido, ausente e fração de centavo vão para a quarentena", motivos.count("valor") == 3, motivos)
    teste("a mesma conta em classes diferentes não é duplicidade", not any(q["conta"] == "10" for q in res["quarentena"]))
    teste("o conflito de classe é auditado (2 linhas)", len(res["conflitos"]) == 2 and {c["tp_repasse"] for c in res["conflitos"]} == {"MUNICIPAL", "ESTADUAL"}, res["conflitos"])
    agg = res["agg"]
    sp = [v for (cod, classe, *_), v in agg.items() if cod == 355030]
    teste("agregado de SP: só as linhas boas (1.010,10 bruto; 909,05 líquido)", sum(v[0] for v in sp) == Decimal("1010.10") and sum(v[1] for v in sp) == Decimal("909.05"), sp)
    teste("VL_SALDO_CONTA nunca entra nos agregados", all(v[0] < Decimal("100000000") for v in agg.values()))
    teste("DF comprovado (Fundo atual e histórico) entra como distrital", agg.get((530010, "distrital", "B", "G", "E1"), [0])[0] == Decimal("70.00"), agg)
    teste("DF histórico acrescenta seu valor líquido ao agregado", agg[(530010, "distrital", "B", "G", "E1")][1] == Decimal("55.00"))
    teste("DF não comprovado fica em excluídos", res["excl"].get(("ESTADUAL", "df_destinatario_nao_comprovado"), [0])[0] == 1)
    teste("estadual fica em excluídos com os valores", res["excl"][("ESTADUAL", "estadual")][2] == Decimal("1030.00"), res["excl"])
    teste("contagem fecha: lidas = incluídas + excluídas + quarentena", res["cont"]["linhas_arquivo"] == res["cont"].get("incluidas_municipal", 0) + res["cont"].get("incluidas_distrital", 0)
          + res["cont"].get("excluidas", 0) + res["cont"].get("quarentena", 0), res["cont"])
    xr = tmp / "ruido.xlsx"
    escrever_xlsx(xr, [linha(vl_bruto="25239.309999999998", vl_liquido="25239.309999999998", dt_ultima_liberacao="45671"), linha(conta="2", vl_bruto="1.005", vl_liquido="1")])
    rr = m.processar_arquivo(2025, str(xr), CAD)
    teste("XLSX: 25239.309999999998 vira 25239,31 e 1.005 vai para a quarentena",
          sum(v[1] for v in rr["agg"].values()) == Decimal("25239.31") and [q["motivo"].split(":")[0] for q in rr["quarentena"]] == ["valor"], (rr["agg"], rr["quarentena"]))

    # --- candidato sintético completo: população, IPCA, ausência, DF, manifesto, imutabilidade da origem
    gold = tmp / "gold"
    (gold / "saude").mkdir(parents=True)
    con = duckdb.connect()
    anos_pop = [2003, 2005, 2006, 2007]
    muns = [(1200013, 120001, 12, "Acrelândia", "AC"), (3550308, 355030, 35, "São Paulo", "SP"), (5300108, 530010, 53, "Brasília", "DF"), (4314902, 431490, 43, "Porto Alegre", "RS")]
    pop = [(a, c, mu, mu // 10000, float(1000 * (i + 1) + a), 1.0) for a in anos_pop for i, (c, mu, _, _, _) in enumerate(muns)]
    con.execute("CREATE TABLE p (ano INTEGER, cod_ibge INTEGER, municipio INTEGER, uf INTEGER, populacao DOUBLE, pop_homens DOUBLE)")
    con.executemany("INSERT INTO p VALUES (?,?,?,?,?,?)", pop)
    con.execute(f"COPY p TO '{(gold / 'saude' / 'populacao.parquet').as_posix()}' (FORMAT parquet)")
    con.execute("CREATE TABLE mu (ano INTEGER, cod_ibge INTEGER, municipio INTEGER, nome VARCHAR, uf VARCHAR)")
    con.executemany("INSERT INTO mu VALUES (?,?,?,?,?)", [(2025, c, mu, nome, uf) for c, mu, _, nome, uf in muns])
    con.execute(f"COPY mu TO '{(gold / 'saude' / 'municipios.parquet').as_posix()}' (FORMAT parquet)")
    con.execute("CREATE TABLE ip (exercicio INTEGER, fator_real DOUBLE)")
    con.executemany("INSERT INTO ip VALUES (?,?)", [(2006, 3.0), (2007, 2.5), (2025, 1.0)])
    con.execute(f"COPY ip TO '{(gold / 'ipca.parquet').as_posix()}' (FORMAT parquet)")
    (gold / "manifesto.json").write_text(json.dumps({"gerado_em": "antes", "anos": [2013], "fontes": {"sih": {"anos": [2008]}}}), encoding="utf-8")
    brutos = tmp / "brutos" / "fns"
    brutos.mkdir(parents=True)
    # 2003: sem IPCA (real fica NULL); AC com repasse, SP sem repasse (ausente, não zero); 2006: com IPCA; 2007 só o DF
    escrever_csv(brutos / "fns_faf_2003.csv", [linha(cod_ibge6="120001", uf="AC", vl_bruto="100,50", vl_liquido="90,25"), linha(cod_ibge6="120001", uf="AC", conta="2", vl_bruto="10,00", vl_liquido="9,75", estrategia="E2")])
    escrever_csv(brutos / "fns_faf_2005.csv", [linha(cod_ibge6="120001", uf="AC")])
    escrever_csv(brutos / "fns_faf_2006.csv", [linha(cod_ibge6="355030", vl_bruto="200,00", vl_liquido="150,00", qt_populacao="999999999"), linha(cod_ibge6="530010", uf="DF", tp_repasse="ESTADUAL", tp_repasse_estado="S", cnpj="00394700000108", vl_bruto="80,00", vl_liquido="70,00"),
                                                     linha(cod_ibge6="431490", uf="RS", conta="77", vl_bruto="1,00", vl_liquido="1,00")])
    escrever_csv(brutos / "fns_faf_2007.csv", [linha(cod_ibge6="530010", uf="DF", tp_repasse="ESTADUAL", tp_repasse_estado="S", cnpj="12116247000157", vl_bruto="500", vl_liquido="400", dt_ultima_liberacao="31/12/2007")])
    inventario = {str(ano): {"arquivo": fns_baixar.nome_arquivo(ano), "bytes": (brutos / fns_baixar.nome_arquivo(ano)).stat().st_size,
                           "sha256": hashlib.sha256((brutos / fns_baixar.nome_arquivo(ano)).read_bytes()).hexdigest(),
                           "url": fns_baixar.URLS[ano]} for ano in anos_pop}
    (brutos / "_fontes.json").write_text(json.dumps(inventario), encoding="utf-8")
    fotografia = lambda pasta: {str(p.relative_to(pasta)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(pasta.rglob("*")) if p.is_file()}
    antes = fotografia(gold)
    saida = tmp / "candidato"
    # Fixtures pequenas: executor com uma thread evita reexecutar este script ao fazer spawn no Windows.
    with patch.object(m, "ProcessPoolExecutor", lambda _: ThreadPoolExecutor(1)):
        r = m.candidato(gold, brutos, saida, anos=(2003, 2005, 2006, 2007), permitido=saida)
    teste("o gold de origem fica intacto", fotografia(gold) == antes)
    c = duckdb.connect()
    mp = (saida / "gold" / "saude" / "fns_municipios.parquet").as_posix()
    q = lambda sql: c.execute(sql.replace("MUN", f"'{mp}'")).fetchall()
    teste("uma linha por município e ano (população uma só vez)", q("SELECT count(*) - count(DISTINCT (ano, municipio)) FROM MUN")[0][0] == 0)
    teste("todos os municípios do cadastro aparecem em todos os anos com população", q("SELECT count(*) FROM MUN")[0][0] == 16)
    teste("município sem repasse no ano: bruto e líquido NULL, não zero", q("SELECT bruto, liquido, linhas FROM MUN WHERE ano = 2003 AND municipio = 355030")[0] == (None, None, None))
    teste("AC 2003: soma exata dos centavos", q("SELECT bruto, liquido, linhas FROM MUN WHERE ano = 2003 AND municipio = 120001")[0] == (110.5, 100.0, 2), q("SELECT * FROM MUN WHERE ano = 2003 AND uf = 'AC'"))
    teste("população é a da SVS/MS, nunca a QT_POPULACAO do arquivo", q("SELECT populacao FROM MUN WHERE ano = 2006 AND municipio = 355030")[0][0] == 2006 + 2000, q("SELECT populacao FROM MUN WHERE ano = 2006 AND municipio = 355030"))
    teste("antes de 2006 o líquido real é NULL (IPCA começa em 2006)", q("SELECT count(liquido_real) FROM MUN WHERE ano < 2006")[0][0] == 0)
    teste("de 2006 em diante, real = líquido × fator do ano", q("SELECT liquido_real FROM MUN WHERE ano = 2006 AND municipio = 355030")[0][0] == 450.0 and q("SELECT liquido_real FROM MUN WHERE ano = 2007 AND municipio = 530010")[0][0] == 1000.0,
      q("SELECT ano, municipio, liquido, liquido_real FROM MUN WHERE ano >= 2006 AND liquido IS NOT NULL"))
    teste("DF vira destino distrital, UF DF e código 5300108", q("SELECT destino, uf, cod_ibge, liquido FROM MUN WHERE ano = 2006 AND municipio = 530010")[0] == ("distrital", "DF", 5300108, 70.0))
    teste("2007 em CSV: DF pelo CNPJ do Fundo", q("SELECT liquido FROM MUN WHERE ano = 2007 AND municipio = 530010")[0][0] == 400.0)
    comp = (saida / "gold" / "saude" / "fns_composicao.parquet").as_posix()
    teste("composição: soma bate com os municípios", c.execute(f"SELECT round(sum(liquido), 2) FROM '{comp}'").fetchone()[0] == c.execute(f"SELECT round(sum(liquido), 2) FROM '{mp}'").fetchone()[0])
    teste("composição guarda os rótulos da fonte", set(x[0] for x in c.execute(f"SELECT DISTINCT estrategia FROM '{comp}' WHERE ano = 2003").fetchall()) == {"E", "E2"})
    anos_p = (saida / "gold" / "saude" / "fns_anos.parquet").as_posix()
    teste("fns_anos: linhas lidas = incluídas + excluídas + quarentena em todos os anos", c.execute(f"SELECT count(*) FROM '{anos_p}' WHERE linhas_arquivo <> linhas_municipais + linhas_distritais + linhas_excluidas + linhas_quarentena").fetchone()[0] == 0)
    man = json.loads((saida / "gold" / "manifesto.json").read_text(encoding="utf-8"))
    pub = json.loads((gold / "manifesto.json").read_text(encoding="utf-8"))
    mudou = {k for k in set(man) | set(pub) if man.get(k) != pub.get(k)}
    teste("manifesto: só fontes e gerado_em mudam", mudou == {"fontes", "gerado_em"}, mudou)
    teste("manifesto: as demais fontes continuam e fns é acrescentada", man["fontes"]["sih"] == {"anos": [2008]} and set(man["fontes"]) == {"sih", "fns"}, man["fontes"].keys())
    f = man["fontes"]["fns"]
    teste("manifesto fns: anos, anos com valor real, URLs e hashes por arquivo", f["anos"] == [2003, 2005, 2006, 2007] and f["anos_reais"] == [2006, 2007] and f["arquivos"]["2006"]["linhas"] == 3, f["anos_reais"])
    teste("auditoria gravada", all((saida / "auditoria" / n).exists() for n in ("quarentena_fns.csv", "excluidos_fns.csv", "auditoria_destinatarios.csv", "conflitos_classificacao.csv", "df_destinatarios.csv", "fns_fontes.json")))
    # --- reexecutar não muda o gold de origem e gera o mesmo resultado
    conteudo = lambda: c.execute(f"SELECT * FROM '{mp}' ORDER BY ano, municipio").fetchall()
    antes_c = conteudo()
    with patch.object(m, "ProcessPoolExecutor", lambda _: ThreadPoolExecutor(1)):
        m.candidato(gold, brutos, saida, anos=(2003, 2005, 2006, 2007), permitido=saida)
    teste("reexecução idempotente (mesmo conteúdo) e origem intacta", conteudo() == antes_c and fotografia(gold) == antes)

    # --- proteção dos destinos
    def recusa(base_, saida_, brutos_, permitido_=None):
        try:
            m.validar_destinos(base_, saida_, brutos_, permitido_ or saida_)
            return False
        except ValueError:
            return True

    teste("recusa saída igual ao gold de origem", recusa(gold, gold, brutos))
    teste("recusa saída dentro do gold de origem", recusa(gold, gold / "candidato", brutos))
    teste("recusa saída que contém o gold de origem", recusa(gold, tmp, brutos))
    teste("recusa saída igual ou dentro dos brutos", recusa(gold, brutos, brutos) and recusa(gold, brutos / "x", brutos))
    teste("recusa saída diferente da pasta de candidatos permitida", recusa(gold, tmp / "outra", brutos, tmp / "candidato"))
    teste("recusa via .. que volta ao gold", recusa(gold, gold / "saude" / "..", brutos))
    teste("aceita a pasta de candidatos separada", not recusa(gold, tmp / "novo", brutos))
    teste("a validação não criou nada", not (tmp / "novo").exists())
    ant = fotografia(gold)
    ex = subprocess.run([sys.executable, "-I", "-X", "utf8", str(Path(m.__file__).resolve()), "candidato", "--base", str(gold), "--brutos", str(tmp)], capture_output=True, text=True, encoding="utf-8", cwd=tmp)
    teste("CLI sem brutos: sai com erro e o gold de origem segue intacto", ex.returncode != 0 and fotografia(gold) == ant, (ex.returncode, ex.stderr[-200:]))
    # downloads: destinos dos brutos
    for ruim in (gold, tmp / "brutos", tmp / "data" / "brutos" / "fns", tmp / "gold" / "brutos" / "fns", Path("E:/finbra/data/gold/fns"), tmp / "fns"):
        teste(f"downloader recusa {'/'.join(ruim.parts[-3:])}", levanta(fns_baixar.validar_pasta, ruim))
    teste("downloader aceita .../brutos/fns", fns_baixar.validar_pasta(Path("E:/finbra/brutos/fns")).name == "fns")
    teste("catálogo: 24 URLs, 2002–2025, sem 2026", sorted(fns_baixar.URLS) == list(range(2002, 2026)) and all(u.startswith("https://portalfns.saude.gov.br/") for u in fns_baixar.URLS.values()))

# ---------- conferência com os arquivos originais (dados reais) ----------
sem_real = "--sem-real" in sys.argv
candidato_real = Path(os.environ.get("FNS_CANDIDATO", str(m.CANDIDATO)))
cand = candidato_real / "gold" / "saude"
if not sem_real and (cand / "fns_municipios.parquet").exists() and (m.BRUTOS / "_fontes.json").exists():
    print("\n--- conferência com os arquivos originais ---")
    c = duckdb.connect()
    M = (cand / "fns_municipios.parquet").as_posix()
    A = (cand / "fns_anos.parquet").as_posix()
    C = (cand / "fns_composicao.parquet").as_posix()
    # independente do pipeline: o DuckDB lê cada CSV por conta própria (valores em texto, vírgula decimal), soma por regra e compara
    # (2025 é XLSX e é conferido pela soma das células do XML, abaixo)
    def total_csv(ano):
        arq = (m.BRUTOS / f"fns_faf_{ano}.csv").as_posix()
        delim = ";" if ano >= 2022 else ","
        enc = "utf-8" if ano >= 2023 else "latin-1"   # cp1252 ≈ latin-1 para as colunas usadas
        sql = f"""
            SELECT sum(CAST(replace(replace(vl_liquido, '.', ''), ',', '.') AS DECIMAL(24,6))) FILTER (WHERE TP_REPASSE = 'MUNICIPAL' AND CO_MUNICIPIO_IBGE <> '530010'),
                   sum(CAST(replace(replace(vl_liquido, '.', ''), ',', '.') AS DECIMAL(24,6))) FILTER (WHERE CNPJ IN ('00394700000108', '00394700000299', '12116247000157') AND UF = 'DF' AND CO_MUNICIPIO_IBGE = '530010'),
                   count(*)
            FROM read_csv('{arq}', delim='{delim}', header=true, all_varchar=true, encoding='{enc}', quote='"')"""
        return c.execute(sql.replace("vl_liquido", "VL_LIQUIDO")).fetchone()
    for ano in (2002, 2003, 2006, 2010, 2018, 2022, 2024):
        mun_ref, df_ref, n_ref = total_csv(ano)
        mun_gold = c.execute(f"SELECT sum(liquido) FROM '{M}' WHERE ano = {ano} AND destino = 'municipal'").fetchone()[0]
        df_gold = c.execute(f"SELECT sum(liquido) FROM '{M}' WHERE ano = {ano} AND destino = 'distrital'").fetchone()[0]
        q_liq = c.execute(f"SELECT linhas_arquivo, linhas_quarentena FROM '{A}' WHERE ano = {ano}").fetchone()
        # a quarentena (poucas linhas) é descontada pelo valor das próprias linhas
        import csv as _csv
        qv = Decimal(0)
        qdf = Decimal(0)
        with open(candidato_real / "auditoria" / "quarentena_fns.csv", encoding="utf-8-sig", newline="") as fh:
            for row in _csv.DictReader(fh, delimiter=";"):
                if int(row["ano"]) == ano and row["tp_repasse"].upper() == "MUNICIPAL" and row["cod_ibge6"] != "530010":
                    qv += lei.parse_decimal(row["vl_liquido"])
        dm = (Decimal(str(mun_ref or 0)) - qv) - Decimal(str(mun_gold or 0))
        teste(f"{ano}: líquido municipal do agregado = arquivo original (menos a quarentena); diferença R$ {dm}", abs(dm) < Decimal("0.05"), (mun_ref, qv, mun_gold))
        dd = Decimal(str(df_ref or 0)) - Decimal(str(df_gold or 0))
        teste(f"{ano}: líquido do DF comprovado = arquivo original; diferença R$ {dd}", abs(dd) < Decimal("0.05"), (df_ref, df_gold))
        teste(f"{ano}: linhas do arquivo = {n_ref}", q_liq[0] == n_ref, (q_liq, n_ref))
        comp_liq = c.execute(f"SELECT sum(liquido) FROM '{C}' WHERE ano = {ano}").fetchone()[0]
        teste(f"{ano}: composição soma o mesmo que os municípios", abs(comp_liq - (mun_gold + (df_gold or 0))) < 0.5, (comp_liq, mun_gold, df_gold))
    # 2025 (XLSX): soma das células de VL_LIQUIDO das linhas MUNICIPAL, lida direto do XML (sem o leitor do pipeline)
    import re as _re
    from fns_baixar import nome_arquivo

    with zipfile.ZipFile(m.BRUTOS / nome_arquivo(2025)) as z:
        textos = [_re.sub(r"<[^>]+>", "", s) for s in _re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode("utf-8"), flags=_re.S)]
        xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    soma = Decimal(0)
    n_lin = 0
    for linha_xml in _re.findall(r"<row [^>]*>(.*?)</row>", xml, flags=_re.S)[1:]:
        cels = dict(_re.findall(r'<c r="([A-Z]+)\d+"[^>]*>\s*<v>([^<]*)</v>', linha_xml))
        n_lin += 1
        tp = textos[int(cels["N"])] if "N" in cels else ""
        if tp == "MUNICIPAL" and cels.get("F") != "530010":
            soma += Decimal(cels["T"])
    gold_2025 = Decimal(str(c.execute(f"SELECT sum(liquido) FROM '{M}' WHERE ano = 2025 AND destino = 'municipal'").fetchone()[0]))
    teste(f"2025 (XLSX): líquido municipal do agregado = soma das células do XML; diferença R$ {soma - gold_2025}", abs(soma - gold_2025) < Decimal("1.00"), (soma, gold_2025))
    teste("2025 (XLSX): linhas do XML = linhas do arquivo no agregado", c.execute(f"SELECT linhas_arquivo FROM '{A}' WHERE ano = 2025").fetchone()[0] == n_lin)
    teste("24 anos, 2002–2025", c.execute(f"SELECT list(ano ORDER BY ano) FROM '{A}'").fetchone()[0] == list(range(2002, 2026)))
    teste("município x ano único e população uma vez por linha", c.execute(f"SELECT count(*) - count(DISTINCT (ano, municipio)) FROM '{M}'").fetchone()[0] == 0)
    teste("nenhum zero fabricado: líquido NULL onde não há linhas", c.execute(f"SELECT count(*) FROM '{M}' WHERE (linhas IS NULL) <> (liquido IS NULL)").fetchone()[0] == 0)
    teste("real só de 2006 em diante", c.execute(f"SELECT count(*) FROM '{M}' WHERE (ano < 2006 AND liquido_real IS NOT NULL) OR (ano >= 2006 AND liquido IS NOT NULL AND liquido_real IS NULL)").fetchone()[0] == 0)

print()
if falhas:
    print(f"{len(falhas)} teste(s) falharam: {falhas}")
    sys.exit(1)
print(f"todos os {executados} testes passaram")
