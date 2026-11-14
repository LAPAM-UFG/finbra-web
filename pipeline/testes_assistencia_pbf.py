"""Testes de pipeline/assistencia_pbf.py com XLSX sintéticos e um servidor HTTP local: parser por rótulo, competência pelo título, quarentena das
quantidades por tipo, totais separados, zero x null, UF/duplicatas, proteção dos destinos, cache/atomicidade/tentativas e limite de 2 downloads.
Uso:  py pipeline/testes_assistencia_pbf.py
"""
import http.server
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import duckdb

sys.path.insert(0, str(Path(__file__).resolve().parent))
import assistencia_pbf as ab  # noqa: E402

CABECALHO_MUN = ["UF", "MUNICÍPIO", "IBGE"]
ROTULOS = ["Etimativa de Pobreza 2024", "Famílias Atendidas", "Famílias Atendidas em pagamento", "Valor Benefício Renda de Cidadania",
           "Valor Benefício Complementar", "Valor Benefício Primeira Infância PBF", "Valor Benefício Variável familiar - Gestante",
           "Valor Benefício Variável Familiar - Nutriz", "Valor Benefício Variável Familiar - Criança", "Valor Benefício Variável Familiar - Adolescente",
           "Total de Recursos Transferidos", "Percentual de Cobertura do PBF", "Valor Médio Programa Bolsa Família (1)", "Famílias em Regra de Proteção",
           "Famílias em Regra de Proteção em pagamento", "Valor em Regra de Proteção", "Benefício Médio para as famílias em Regra de Proteção", "Famílias Canceladas"]
TIPOS = ["Total de Benefícios Renda de Cidadania", "Total de Benefícios Complementares", "Total de Benefícios Primeira Infância PBF",
         "Total de Benefícios Variáveis Familiares - Gestante", "Total de Benefícios Variáveis Familiares - Nutriz",
         "Total de Benefícios Variáveis Familiares - Criança", "Total de Benefícios Variáveis Familiares - Adolescente"]
LETRAS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def celula(ref, v):
    if v is None:
        return ""
    if isinstance(v, str):
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(v)}</t></is></c>'
    return f'<c r="{ref}"><v>{v!r}</v></c>'


def aba(linhas):
    xml = "".join(f'<row r="{i}">' + "".join(celula(f"{LETRAS[j]}{i}", v) for j, v in enumerate(l) if v is not None) + "</row>" for i, l in enumerate(linhas, 1))
    return f'<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>{xml}</sheetData></worksheet>'


def xlsx(caminho: Path, titulo="JUNHO 2026", fonte="Fonte: Folha de Pagamentos do Programa Bolsa Família, jun/26", muns=None, uf="PR", extras=(),
         oculta_mes="Informações sobre o Programa Bolsa Família  - MARÇO 2025", titulo_tipos=None):
    """Planilha no desenho real: título nas linhas 1-8, cabeçalho em duas linhas (UF/MUNICÍPIO/IBGE e rótulos), municípios depois; aba de tipos e aba
    oculta antiga (que NUNCA pode ser lida)."""
    muns = muns if muns is not None else [(4100103, "ABATIA", 567, 421), (4100202, "ADRIANOPOLIS", 487, 0), (4100301, "AGUDOS DO SUL", None, 300)]
    mun = [[None, "Ministério"], [None, "Secretaria"], [], [None, f"Informações sobre o Programa Bolsa Família  - {titulo}"], [], [None, "Data de confecção do relatório: 10/06/2026"],
           [None, None, None, None, 3, 4],
           [None, "UF", "MUNICÍPIO", "IBGE", "Programa Bolsa Família"], [None, None, None, None] + ROTULOS]
    for ibge, nome, est, fam in muns:
        v = [None, uf, nome, float(ibge), est, fam, fam, 1000.0, 500.0, 0, 0.0, 0.0, 10.0, 0.0, 1510.0, (fam / est if est else None), 700.5, 5, 4, 77.0, 19.25, 2]
        mun.append(v)
    mun += list(extras)
    tip = [["Ministério"], [], [f"Total de benefícios por tipos da nova cesta do Programa Bolsa Família, {titulo_tipos or titulo}"], [fonte], [],
           ["Região", "UF", "Ibge", "Município"] + TIPOS, [None, None, None, None, 9, 9, 9, 9, 9, 9, 9]]
    for ibge, nome, est, fam in muns:
        tip.append(["Sul", uf, float(ibge), nome, 10, 20, 30, 0, None, 60, 70])
    antiga = [["rótulo velho"], ["IBGE", "familias_pbf_atendidas"], [9999999.0, 1.0], [titulo and oculta_mes]]
    pacote = {
        "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        "xl/workbook.xml": '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                           'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                           '<sheet name="Municipio" sheetId="1" r:id="rId1"/><sheet name="Tipos de beneficios " sheetId="2" r:id="rId2"/>'
                           '<sheet name="rel_beneficios_ibge_202503all" sheetId="3" state="hidden" r:id="rId3"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                      '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="x" Target="worksheets/sheet2.xml"/>'
                                      '<Relationship Id="rId3" Type="x" Target="worksheets/sheet3.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": aba(mun), "xl/worksheets/sheet2.xml": aba(tip), "xl/worksheets/sheet3.xml": aba(antiga),
    }
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        for k, v in pacote.items():
            z.writestr(k, v)
    return caminho


def xlsx_variante(caminho: Path, titulo="Informações sobre o Programa Bolsa Família - novembro de 2025", grupos=True, aba_unica=True, uf="PR"):
    """Layout de 2025: duas famílias de colunas com o mesmo rótulo 'Famílias Atendidas' (PBF e Auxílio Gás), uma única aba visível ('Planilha1')
    e, opcionalmente, sem a linha de grupos (como 2025-02 de várias UFs e 2025-07)."""
    rot = ["Etimativa de Pobreza 2024", "Famílias Atendidas", "Valor Benefício Renda de Cidadania", "Total de Recursos Transferidos",
           "Percentual de Cobertura do PBF", "Famílias em Regra de Proteção", "Famílias Atendidas", "Recursos Transferidos", "Valor  Programa Auxílio Gás dos Brasileiros"]
    cab_grupo = [None, None, None, None, "Programa Bolsa Família", None, None, None, None, None, "Programa Auxílio Gás dos Brasileiros"] if grupos else []
    cab = [None, "UF", "MUNICÍPIO", "IBGE"] + rot
    dados = [[None, uf, "ABATIA", 4100103.0, 567.0, 439.0, 148603.0, 284192.0, 0.7743, 126.0, 83.0, 8964.0, 108.0],
             [None, uf, "ADRIANOPOLIS", 4100202.0, 487.0, 0.0, 0.0, 0.0, 0.0, 0.0, 22.0, 2376.0, 108.0]]
    linhas = [[None, titulo], [None, "Fonte: Folha de Pagamentos do Programa Bolsa Família, nov/25"], [None, "Data de confecção do relatório: 07/11/2025"], []]
    if cab_grupo:
        linhas.append(cab_grupo)
    linhas += [cab] + dados
    nome = "Planilha1" if aba_unica else "Municipio"
    pacote = {
        "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        "xl/workbook.xml": '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                           f'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{nome}" sheetId="1" r:id="rId1"/></sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                                      '<Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>',
        "xl/worksheets/sheet1.xml": aba(linhas),
    }
    caminho.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        for k, v in pacote.items():
            z.writestr(k, v)
    return caminho


class Parser(unittest.TestCase):
    def setUp(self):
        self.t = Path(tempfile.mkdtemp(prefix="pbf_t_"))

    def test_leitura_por_rotulo_e_nulos(self):
        p = ab.ler_planilha(xlsx(self.t / "a.xlsx"), 2026, "06", "PR")
        self.assertEqual(p["competencia"], 202606)
        self.assertEqual(p["data_confeccao"], "2026-06-10")
        self.assertEqual(len(p["linhas"]), 3)
        r = {x["cod_ibge"]: x for x in p["linhas"]}
        self.assertEqual(r[4100103]["familias_atendidas"], 421)
        self.assertIsInstance(r[4100103]["familias_atendidas"], int)
        self.assertEqual(r[4100202]["familias_atendidas"], 0)  # zero expresso continua 0
        self.assertEqual(r[4100202]["valor_variavel_gestante"], 0)
        self.assertIsNone(r[4100301]["estimativa_pobreza"])  # célula vazia continua null
        self.assertIsNone(r[4100301]["cobertura_planilha"])
        self.assertEqual(r[4100103]["valor_total_planilha"], 1510)
        self.assertEqual(r[4100103]["valor_soma_componentes"], 1510)  # soma derivada dos sete componentes
        self.assertEqual(p["ano_estimativa_pobreza"], 2024)
        self.assertEqual(p["rotulos_nao_mapeados"], [])

    def test_competencia_vem_do_titulo_nao_do_nome(self):
        arq = xlsx(self.t / "b.xlsx", titulo="MAIO 2026", titulo_tipos="MAIO 2026")
        with self.assertRaises(ab.ArquivoInvalido) as e:
            ab.ler_planilha(arq, 2026, "06", "PR")
        self.assertIn("202605", str(e.exception))

    def test_aba_oculta_antiga_nao_e_lida(self):
        p = ab.ler_planilha(xlsx(self.t / "c.xlsx"), 2026, "06", "PR")
        self.assertNotIn(9999999, [r["cod_ibge"] for r in p["linhas"]])
        self.assertEqual(p["aba"], "Municipio")

    def test_quarentena_quando_fonte_de_outro_mes(self):
        p = ab.ler_planilha(xlsx(self.t / "d.xlsx", fonte="Fonte: Folha de Pagamentos do Programa Bolsa Família, ago/25"), 2026, "06", "PR")
        self.assertTrue(p["tipos_info"]["estado"].startswith("quarentena"))
        self.assertEqual(p["tipos_info"]["fonte_competencia"], 202508)
        self.assertTrue(all(r["qtd_beneficios_renda_cidadania"] is None for r in p["linhas"]))
        self.assertEqual(len(p["quarentena"]), 3)
        self.assertEqual(p["quarentena"][0]["qtd_beneficios_renda_cidadania"], 10)

    def test_quantidades_validadas_quando_fonte_confere(self):
        p = ab.ler_planilha(xlsx(self.t / "e.xlsx"), 2026, "06", "PR")
        self.assertEqual(p["tipos_info"]["estado"], "validado")
        r = {x["cod_ibge"]: x for x in p["linhas"]}
        self.assertEqual(r[4100103]["qtd_beneficios_renda_cidadania"], 10)
        self.assertEqual(r[4100103]["qtd_beneficios_variavel_gestante"], 0)  # zero real
        self.assertIsNone(r[4100103]["qtd_beneficios_variavel_nutriz"])  # vazio = null
        self.assertIsNone(p["quarentena"])

    def test_totais_ficam_separados_dos_municipios(self):
        linha = [None, "PR", "TOTAL PR", None, 1.0, 2.0, 2.0]
        p = ab.ler_planilha(xlsx(self.t / "f.xlsx", extras=[linha]), 2026, "06", "PR")
        self.assertEqual(len(p["linhas"]), 3)
        self.assertEqual(len(p["totais"]), 1)
        self.assertEqual(p["totais"][0]["valores"]["familias_atendidas"], 2.0)

    def test_uf_divergente_e_duplicata_rejeitam(self):
        with self.assertRaises(ab.ArquivoInvalido):
            ab.ler_planilha(xlsx(self.t / "g.xlsx"), 2026, "06", "SC")
        with self.assertRaises(ab.ArquivoInvalido) as e:
            ab.ler_planilha(xlsx(self.t / "h.xlsx", muns=[(4100103, "A", 1, 1), (4100103, "A2", 1, 1)]), 2026, "06", "PR")
        self.assertIn("duplicados", str(e.exception))
        with self.assertRaises(ab.ArquivoInvalido):  # prefixo do IBGE (35 = SP) num arquivo PR
            ab.ler_planilha(xlsx(self.t / "i.xlsx", muns=[(3500105, "X", 1, 1)]), 2026, "06", "PR")

    def test_normalizacao_de_rotulos(self):
        self.assertEqual(ab.norm("Valor Médio Programa Bolsa Família (1)"), "valor medio programa bolsa familia")
        self.assertEqual(ab.norm("Etimativa de Pobreza 2024"), "etimativa de pobreza 2024")
        self.assertEqual(ab.norm("Fonte: Folha, ago/25"), "fonte folha ago 25")

    def test_dois_blocos_com_o_mesmo_rotulo_e_aba_unica(self):
        for grupos in (True, False):  # com e sem a linha de grupos
            p = ab.ler_planilha(xlsx_variante(self.t / f"v{grupos}.xlsx", grupos=grupos), 2025, "11", "PR")
            r = {x["cod_ibge"]: x for x in p["linhas"]}
            self.assertEqual(p["aba"], "Planilha1")
            self.assertEqual(r[4100103]["familias_atendidas"], 439)  # o bloco principal, não o do gás
            self.assertEqual(r[4100103]["gas_familias_atendidas"], 83)
            self.assertEqual(r[4100103]["gas_valor_transferido"], 8964)
            self.assertEqual(r[4100202]["gas_familias_atendidas"], 22)
            self.assertEqual(r[4100202]["familias_atendidas"], 0)
            self.assertEqual(p["programa"], "Bolsa Familia")
            self.assertEqual(p["fonte_municipio_competencia"], 202511)
            self.assertEqual(p["tipos_info"]["estado"], "aba ausente")
            self.assertEqual(p["rotulos_nao_mapeados"], [])
            self.assertEqual(p["grupos_inferidos"], not grupos)
            self.assertEqual(p["verificacoes"]["cobertura_divergente_n"], 0)  # 0,7743 arredondado a 4 casas é aceito

    def test_titulo_mm_aaaa_das_abas_de_tipos(self):
        self.assertEqual(ab.competencia_do_titulo([(5, {"A": "Total de benefícios por tipos da nova cesta do Programa Bolsa Família, 07/2024"})], 9)[0], 202407)
        self.assertEqual(ab.competencia_do_titulo([(1, {"A": "Informações sobre o Programa Bolsa Família  - JUNHO 2026"}),
                                                   (2, {"A": "Data de confecção do relatório: 10/06/2026"})], 9)[0], 202606)
        # nota de rodapé com outra data não vira competência
        self.assertEqual(ab.competencia_do_titulo([(1, {"A": "Informações sobre o Programa Auxílio Brasil - FEVEREIRO 2023"}),
                                                   (2, {"A": "* A partir de fevereiro de 2023, e o Benefício de junho de 2023"})], 9)[0], 202302)

    def test_parquet_por_competencia_e_esquema(self):
        saida = self.t / "cand"
        xlsx(ab.caminho_xlsx(saida, 2026, "06", "PR"))
        arq = ab.caminho_xlsx(saida, 2026, "06", "PR")
        import hashlib
        sha = hashlib.sha256(arq.read_bytes()).hexdigest()
        cat = {"arquivos": {"2026-06-PR": {"estado": "baixado", "tipo": "uf", "ano": 2026, "mes": "06", "uf_arquivo": "PR", "sha256": sha,
                                           "caminho": str(arq.relative_to(saida)).replace("\\", "/")}}, "pastas": {}}
        ab.gravar_json(saida, saida / "landing/assistencia/pbf/catalogo_aquisicao.json", cat)
        res = ab.normalizar(saida)
        pq = saida / "silver/assistencia/pbf/pbf_202606.parquet"
        self.assertTrue(pq.exists())
        con = duckdb.connect()
        cols = [r[0] for r in con.execute(f"DESCRIBE SELECT * FROM '{pq.as_posix()}'").fetchall()]
        self.assertEqual(cols, ab.COLUNAS_SILVER)
        self.assertEqual(con.execute(f"SELECT count(*), sum(familias_atendidas) FROM '{pq.as_posix()}'").fetchone(), (3, 421 + 0 + 300))
        self.assertTrue((saida / "landing/assistencia/pbf/catalogo.json").exists())
        self.assertEqual(res["competencias"]["202606"]["ufs_sem_arquivo"], [u for u in ab.UFS if u != "PR"])
        self.assertEqual(res["competencias"]["202606"]["duplicados_entre_ufs"], 0)
        self.assertFalse((saida / "silver/assistencia/pbf/quarentena").exists())
        json.loads((saida / "landing/assistencia/pbf/catalogo.json").read_text(encoding="utf-8"))


class Destinos(unittest.TestCase):
    def setUp(self):
        self.t = Path(tempfile.mkdtemp(prefix="pbf_d_"))

    def test_rejeita_origem_ancestral_descendente(self):
        origem = self.t / "base"
        origem.mkdir()
        for s in (origem, origem / "x", self.t):
            with self.assertRaises(ValueError):
                ab.validar_saida(s, proibidos=(origem,))
        ab.validar_saida(self.t / "outra", proibidos=(origem,))
        with self.assertRaises(ValueError):
            ab.validar_saida(Path("E:/finbra/data"))
        with self.assertRaises(ValueError):
            ab.validar_saida(Path("E:/finbra"))  # ancestral da base
        with self.assertRaises(ValueError):
            ab.validar_saida(Path(ab.PROIBIDOS[2]) / "dados")  # dentro do repositório de código

    def test_alvo_so_nas_duas_pastas_autorizadas(self):
        s = ab.validar_saida(self.t / "cand", proibidos=())
        ab.validar_alvo(s, s / "landing/assistencia/pbf/xlsx/a.xlsx")
        ab.validar_alvo(s, s / "silver/assistencia/pbf/pbf_202606.parquet")
        for ruim in ("landing/assistencia/bpc/a.csv", "gold/x.json", "silver/assistencia/pbf/../../../x"):
            with self.assertRaises(ValueError):
                ab.validar_alvo(s, s / ruim)

    def test_rejeita_juncao(self):
        real = self.t / "real"
        real.mkdir()
        elo = self.t / "elo"
        r = subprocess.run(["cmd", "/c", "mklink", "/J", str(elo), str(real)], capture_output=True)
        if r.returncode != 0 or not elo.exists():
            self.skipTest("junção não pôde ser criada neste ambiente")
        with self.assertRaises(ValueError):
            ab.validar_saida(elo / "cand", proibidos=())
        s = ab.validar_saida(self.t / "cand", proibidos=())
        (s / "landing/assistencia").mkdir(parents=True)
        subprocess.run(["cmd", "/c", "mklink", "/J", str(s / "landing/assistencia/pbf"), str(real)], capture_output=True)
        if (s / "landing/assistencia/pbf").exists():
            with self.assertRaises(ValueError):
                ab.gravar_atomico(s, s / "landing/assistencia/pbf/x.json", b"{}")
            self.assertFalse((real / "x.json").exists())

    def test_escrita_atomica_nao_deixa_temporario(self):
        s = ab.validar_saida(self.t / "cand", proibidos=())
        ab.gravar_json(s, s / "landing/assistencia/pbf/c.json", {"ç": 1})
        self.assertEqual(sorted(p.name for p in (s / "landing/assistencia/pbf").iterdir()), ["c.json"])
        self.assertIn("ç", (s / "landing/assistencia/pbf/c.json").read_text(encoding="utf-8"))


class Servidor(http.server.ThreadingHTTPServer):
    pass


def iniciar(arquivos: dict, falhas: dict):
    estado = {"ativos": 0, "pico": 0, "pedidos": [], "falhas": dict(falhas), "lock": threading.Lock()}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            with estado["lock"]:
                estado["ativos"] += 1
                estado["pico"] = max(estado["pico"], estado["ativos"])
                estado["pedidos"].append((self.path, self.headers.get("If-None-Match")))
            try:
                time.sleep(0.05)
                n = estado["falhas"].get(self.path, 0)
                if n > 0:
                    estado["falhas"][self.path] = n - 1
                    self.send_response(503)
                    self.end_headers()
                    return
                if self.path not in arquivos:
                    self.send_response(404)
                    self.end_headers()
                    return
                corpo = arquivos[self.path]
                if self.headers.get("If-None-Match") == '"v1"':
                    self.send_response(304)
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header("Content-Length", str(len(corpo)))
                self.send_header("ETag", '"v1"')
                self.end_headers()
                self.wfile.write(corpo)
            finally:
                with estado["lock"]:
                    estado["ativos"] -= 1

    srv = Servidor(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, estado


class Rede(unittest.TestCase):
    def setUp(self):
        self.t = Path(tempfile.mkdtemp(prefix="pbf_r_"))
        self.s = ab.validar_saida(self.t / "cand", proibidos=())
        base = self.t / "origem.xlsx"
        xlsx(base)
        self.bom = base.read_bytes()
        self._tentativas, self._timeout = ab.TENTATIVAS, ab.time.sleep
        ab.time.sleep = lambda s: None

    def tearDown(self):
        ab.time.sleep = self._timeout

    def _rodar(self, arquivos, falhas=None, anos=(2026, 2026), ufs=("PR", "SC")):
        srv, est = iniciar(arquivos, falhas or {})
        ab.BASE_URL = f"http://127.0.0.1:{srv.server_address[1]}/"
        try:
            return ab.baixar(self.s, list(range(anos[0], anos[1] + 1)), list(ufs)), est
        finally:
            srv.shutdown()
            srv.server_close()

    def test_catalogo_cache_404_retry_e_dois_simultaneos(self):
        pasta = b'<a href="relatorio_pbf_06_2026_pr.xlsx">pr</a> <a href="relatorio_pbf_06_2026_origem.xlsx">o</a>'
        arqs = {"/2026/junho/": pasta, "/2026/junho/relatorio_pbf_06_2026_pr.xlsx": self.bom, "/2026/junho/relatorio_pbf_06_2026_origem.xlsx": self.bom,
                "/2026/junho/relatorio_pbf_06_2026_sc.xlsx": self.bom}
        cat, est = self._rodar(arqs, {"/2026/junho/relatorio_pbf_06_2026_pr.xlsx": 2})
        self.assertLessEqual(est["pico"], 2)
        a = cat["arquivos"]
        self.assertEqual(a["2026-06-PR"]["estado"], "baixado")  # 503 duas vezes e sucesso depois
        self.assertEqual(a["2026-06-PR"]["tentativas"], 3)
        self.assertTrue(a["2026-06-PR"]["listado_no_html"])
        self.assertFalse(a["2026-06-SC"]["listado_no_html"])  # existe mas a listagem omitiu
        self.assertEqual(a["2026-06-SC"]["estado"], "baixado")
        self.assertEqual(a["2026-06-ORIGEM"]["tipo"], "extra")
        self.assertEqual(cat["pastas"]["2026-07"]["status_http"], 404)
        self.assertNotIn("2026-07-PR", a)  # pasta inexistente: nenhum mês presumido
        self.assertEqual(len(a["2026-06-PR"]["sha256"]), 64)
        self.assertEqual(a["2026-06-PR"]["bytes"], len(self.bom))
        self.assertEqual(sorted(p.name for p in (self.s / "landing/assistencia/pbf/xlsx/2026/06").iterdir()),
                         ["relatorio_pbf_06_2026_origem.xlsx", "relatorio_pbf_06_2026_pr.xlsx", "relatorio_pbf_06_2026_sc.xlsx"])
        # segunda rodada: ETag → 304 → cache, sem rebaixar
        cat2, est2 = self._rodar(arqs)
        self.assertEqual(cat2["arquivos"]["2026-06-PR"]["estado"], "cache")
        self.assertEqual(cat2["arquivos"]["2026-06-PR"]["sha256"], a["2026-06-PR"]["sha256"])

    def test_arquivo_corrompido_nao_vira_final(self):
        arqs = {"/2026/junho/": b"", "/2026/junho/relatorio_pbf_06_2026_pr.xlsx": b"nao e um zip"}
        cat, _ = self._rodar(arqs, ufs=("PR",))
        self.assertEqual(cat["arquivos"]["2026-06-PR"]["estado"], "erro")
        self.assertFalse(ab.caminho_xlsx(self.s, 2026, "06", "PR").exists())
        self.assertEqual([p for p in (self.s / "landing/assistencia/pbf/xlsx/2026/06").glob("*")] if (self.s / "landing/assistencia/pbf/xlsx/2026/06").exists() else [], [])


if __name__ == "__main__":
    original = ab.BASE_URL
    try:
        unittest.main(verbosity=2)
    finally:
        ab.BASE_URL = original
