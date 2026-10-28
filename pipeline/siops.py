"""Saúde: SIOPS (Ministério da Saúde) → silver/siops e gold/siops.

Série histórica de indicadores municipais do SIOPS, pelo TABNET do DATASUS (siops-asp.datasus.gov.br), uma
consulta por UF e ano, com os 31 indicadores de uma vez. É o nível que a fonte publica para todos os municípios:
o detalhamento linha a linha da declaração só existe em relatórios por município.

No TABNET, "..." é dado não disponível (fica nulo) e "-" é zero. Os indicadores por subfunção (atenção
básica, hospitalar, vigilâncias…) só são publicados até cerca de 2018; depois a fonte traz "...".

silver/siops/ano=AAAA/uf=XX.parquet   um arquivo por consulta; o que já existe não é baixado de novo
gold/siops/indicadores.parquet        ano × município × indicador (cod_ibge de 7 dígitos), com a unidade

Uso:
    py pipeline/siops.py                  # 2013 até o último ano publicado, o que faltar
    py pipeline/siops.py --anos 2000-2025 --refazer
"""
import argparse
import html
import json
import re
import time
import urllib.parse
from datetime import date, datetime, timezone

import duckdb
import requests

from config import GOLD, PRIMEIRO_ANO, SILVER, UF_POR_CODIGO
from saude_educacao import gerar_resumo

TABNET = "http://siops-asp.datasus.gov.br/CGI/tabcgi.exe?SIOPS/serhist/municipio/indic{uf}.def"
SILVER_S = SILVER / "siops"
GOLD_S = GOLD / "siops"
UFS = sorted(u for u in UF_POR_CODIGO.values() if u != "DF")  # o DF não tem série municipal

# valores do formulário do TABNET (Incremento) → código, rótulo legível e unidade
INDICADORES = [
    ("População", "populacao", "População", "habitantes"),
    ("1.1_%R.Líquida_Total", "1.1", "Receita de impostos líquida / receita total", "%"),
    ("1.2_%Transf._Intergov._líquidas", "1.2", "Transferências intergovernamentais líquidas / receita total", "%"),
    ("1.3_%Transf._para_a_Saúde_(SUS)", "1.3", "Transferências para a saúde (SUS) / total de transferências", "%"),
    ("1.4_%Transf._União_p/_Saúde", "1.4", "Transferências da União para a saúde / transferências para a saúde", "%"),
    ("1.5_%Transf._da_União_p/_(SUS)", "1.5", "Transferências da União para a saúde (SUS) / transferências da União", "%"),
    ("1.6_%R.Imp._Transf.Const.Legais", "1.6", "Receita de impostos e transferências constitucionais e legais / receita total", "%"),
    ("2.1_%D.Total/_Hab", "2.1", "Despesa total com saúde por habitante", "R$/hab"),
    ("2.2_%D.Pessoal/D.Total", "2.2", "Despesa com pessoal / despesa total com saúde", "%"),
    ("2.3_%D.com_Medicamentos", "2.3", "Despesa com medicamentos / despesa total com saúde", "%"),
    ("2.4_%D.Serv.Terc/D.Total", "2.4", "Despesa com serviços de terceiros (pessoa jurídica) / despesa total com saúde", "%"),
    ("2.5_%D.Invest/D.Total", "2.5", "Despesa com investimentos / despesa total com saúde", "%"),
    ("2.10\tSUBFUNÇÕES_ADMINISTRATIVAS", "2.10", "Subfunções administrativas / despesa total com saúde", "%"),
    ("2.20\tSUBFUNÇÕES_VINCULADAS", "2.20", "Subfunções vinculadas / despesa total com saúde", "%"),
    ("2.21\tAtenção_Básica", "2.21", "Atenção básica / despesa total com saúde", "%"),
    ("2.22_Assis._Hosp._e_Ambulat.", "2.22", "Assistência hospitalar e ambulatorial / despesa total com saúde", "%"),
    ("2.23_Sup._Profilático_Terap.", "2.23", "Suporte profilático e terapêutico / despesa total com saúde", "%"),
    ("2.24_Vigilância_Sanitária", "2.24", "Vigilância sanitária / despesa total com saúde", "%"),
    ("2.25_Vigilância_Epidemiológica", "2.25", "Vigilância epidemiológica / despesa total com saúde", "%"),
    ("2.26_Alimentação_e_Nutrição", "2.26", "Alimentação e nutrição / despesa total com saúde", "%"),
    ("2.30_INFORMAÇÕES_COMPLEMENTARES", "2.30", "Informações complementares / despesa total com saúde", "%"),
    ("3.1_%Transf.SUS/D.Total", "3.1", "Transferências do SUS / despesa total com saúde", "%"),
    ("3.2_%R.Próprios_em_Saúde-EC_29", "3.2", "Receita própria aplicada em saúde (EC 29 / LC 141; mínimo de 15%)", "%"),
    ("R.Impostos_e_Transf.Const", "r_impostos_transf", "Receita de impostos e transferências constitucionais", "R$"),
    ("R.Transf.SUS", "r_transf_sus", "Receita de transferências do SUS", "R$"),
    ("R.Transf.SUS/Hab", "r_transf_sus_hab", "Receita de transferências do SUS por habitante", "R$/hab"),
    ("D.Pessoal", "d_pessoal", "Despesa com pessoal na saúde", "R$"),
    ("D.R.Próprios", "d_recursos_proprios", "Despesa com saúde com recursos próprios", "R$"),
    ("D.R.Próprios_em_Saúde/Hab", "d_recursos_proprios_hab", "Despesa com recursos próprios em saúde por habitante", "R$/hab"),
    ("D.Total_Saúde", "d_total", "Despesa total com saúde", "R$"),
]


def numero(v: str):
    v = v.strip()
    if v in ("...", "..", ""):
        return None  # não disponível na fonte
    if v == "-":
        return 0.0
    return float(v.replace(".", "").replace(",", "."))


def consultar(uf: str, ano: int) -> list[tuple]:
    pares = [("Linha", "Municípios"), ("Coluna", "--Não-Ativa--")] + [("Incremento", v) for v, *_ in INDICADORES]
    pares += [("Arquivos", f"indmun{ano % 100:02d}.dbf"), ("SMunicípio", "TODAS_AS_CATEGORIAS__"), ("formato", "prn"), ("mostre", "Mostra")]
    for tentativa in range(4):
        try:
            r = requests.post(TABNET.format(uf=uf), data=urllib.parse.urlencode(pares, encoding="latin-1"),
                              headers={"Content-Type": "application/x-www-form-urlencoded"}, timeout=300)
            r.raise_for_status()
            break
        except requests.RequestException:
            if tentativa == 3:
                raise
            time.sleep(10 * (tentativa + 1))
    r.encoding = "latin-1"
    texto = html.unescape(re.sub(r"<[^>]+>", "", r.text))
    linhas = [l for l in texto.splitlines() if l.startswith('"')]
    if not linhas:
        return []  # ano ainda não publicado para a UF
    cabecalho = [c.strip('"').replace("\t", " ") for c in linhas[0].split(";")]
    # cada coluna do resultado pelo rótulo do formulário (com espaços no lugar de _ e tabulações)
    rotulos = {v.replace("_", " ").replace("\t", " "): codigo for v, codigo, *_ in INDICADORES}
    codigos = [rotulos.get(c) for c in cabecalho[1:]]
    saida = []
    for l in linhas[1:]:
        partes = l.split(";")
        nome = partes[0].strip('"')
        m = re.match(r"(\d{6}) ", nome)
        if not m:
            continue  # linha "Total"
        for codigo, v in zip(codigos, partes[1:]):
            if codigo:
                saida.append((ano, uf, int(m.group(1)), codigo, numero(v)))
    return saida


def baixar(anos: list[int], refazer: bool):
    con = duckdb.connect()
    for ano in anos:
        for uf in UFS:
            arq = SILVER_S / f"ano={ano}" / f"uf={uf}.parquet"
            if arq.exists() and not refazer:
                continue
            linhas = consultar(uf, ano)
            if not linhas:
                print(f"{ano} {uf}: sem dados")
                continue
            arq.parent.mkdir(parents=True, exist_ok=True)
            con.execute("CREATE OR REPLACE TEMP TABLE t (ano INTEGER, uf VARCHAR, cod_muni INTEGER, codigo VARCHAR, valor DOUBLE)")
            con.executemany("INSERT INTO t VALUES (?, ?, ?, ?, ?)", linhas)
            con.execute(f"COPY t TO '{arq.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
            print(f"{ano} {uf}: {len({x[2] for x in linhas})} municípios", flush=True)


def gerar_gold(con):
    if not any(SILVER_S.glob("*/*.parquet")):
        return
    GOLD_S.mkdir(parents=True, exist_ok=True)
    con.execute("CREATE OR REPLACE TABLE ind AS SELECT * FROM (VALUES "
                + ",".join("(" + ", ".join("'" + x.replace("'", "''") + "'" for x in (c, r, u)) + ")" for _, c, r, u in INDICADORES)
                + ") t(codigo, indicador, unidade)")
    entes = (SILVER / "entes.parquet").as_posix()
    con.execute(f"""CREATE OR REPLACE TEMP TABLE g AS
        SELECT s.ano, e.cod_ibge, s.uf, s.codigo, i.indicador, i.unidade, s.valor
        FROM read_parquet('{SILVER_S.as_posix()}/*/*.parquet', hive_partitioning = false) s
        JOIN ind i USING (codigo)
        LEFT JOIN '{entes}' e ON e.esfera = 'M' AND e.cod_ibge // 10 = s.cod_muni""")
    perdidas = con.execute("SELECT count(DISTINCT (uf, ano, cod_ibge)) FROM g WHERE cod_ibge IS NULL").fetchone()[0]
    con.execute(f"COPY (SELECT * FROM g WHERE cod_ibge IS NOT NULL ORDER BY cod_ibge, ano, codigo) TO '{(GOLD_S / 'indicadores.parquet').as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)")
    n = con.execute("SELECT count(*), count(DISTINCT cod_ibge), min(ano), max(ano) FROM g WHERE cod_ibge IS NOT NULL").fetchone()
    print(f"gold/siops/indicadores.parquet: {n[0]} valores, {n[1]} municípios, {n[2]}–{n[3]}"
          + (f" ({perdidas} município-ano sem código no cadastro)" if perdidas else ""))
    gerar_resumo(con)
    atualizar_manifesto(con)


def fonte_siops(con) -> dict:
    arq = GOLD_S / "indicadores.parquet"
    if not arq.exists():
        return {}
    anos = [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{arq.as_posix()}' ORDER BY 1").fetchall()]
    quando = datetime.fromtimestamp(arq.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    return {"siops": {"anos": anos, "processado_em": quando,
                      "url": "http://siops-asp.datasus.gov.br/cgi/siops/serhist/MUNICIPIO/indicadores.HTM"}}


def atualizar_manifesto(con):
    caminho = GOLD / "manifesto.json"
    if not caminho.exists():
        return
    manifesto = json.loads(caminho.read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {}).update(fonte_siops(con))
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    caminho.write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--anos", default=f"{PRIMEIRO_ANO}-{date.today().year - 1}")
    p.add_argument("--refazer", action="store_true")
    p.add_argument("--so-gold", action="store_true")
    args = p.parse_args()
    a, _, b = args.anos.partition("-")
    if not args.so_gold:
        baixar(list(range(int(a), int(b or a) + 1)), args.refazer)
    gerar_gold(duckdb.connect())


if __name__ == "__main__":
    main()
