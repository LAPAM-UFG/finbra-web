"""Testes da cobertura vacinal (vacinacao_baixar.py e vacinacao.py).

Parte 1 não precisa de dados (usa páginas sintéticas); a parte 2 reconcilia com valores oficiais conhecidos e com a soma
hierárquica, lendo os brutos e o candidato se existirem (senão, avisa que pulou).

Uso:
    py pipeline/testes_vacinacao.py
"""
import gzip
import json
import os
import sys
import tempfile
from pathlib import Path

import duckdb

import vacinacao as v
import vacinacao_baixar as b

falhas = []


def teste(nome, ok, detalhe=""):
    print(f"{'ok ' if ok else 'FALHOU'}  {nome}{'' if ok else f' — {detalhe}'}")
    if not ok:
        falhas.append(nome)


def levanta(fn, exc=Exception):
    try:
        fn()
    except exc:
        return True
    except Exception:  # outro tipo de erro não vale
        return False
    return False


# ------------------------------------------------------------------------------------------------ identificadores e método
teste("identificador sem acento nem símbolo", v.identificador("Tríplice Viral - 1° Dose") == "triplice_viral_1_dose")
teste("identificador distingue < de <=", v.identificador("Hepatite B (< 30 dias)") != v.identificador("Hepatite B (<= 30 dias)"))
ROTULOS = ["BCG", "DTP (1° Reforço)", "Hepatite B (<= 1 dia)", "Hepatite B (<= 2 dias)", "Hepatite B (<= 30 dias)", "Hepatite B (< 30 dias)", "Meningo C",
           "Meningocócica Conjugada", "Pneumo 10", "Pneumocócica Conjugada", "Polio Injetável (VIP)", "Poliomielite", "Varicela", "Varicela - 2° dose"]
teste("identificadores dos rótulos conhecidos são únicos", len({v.identificador(r) for r in ROTULOS}) == len(ROTULOS))
teste("rótulos de nomes parecidos não são emendados", v.identificador("Meningo C") != v.identificador("Meningocócica Conjugada")
      and v.identificador("Pneumo 10") != v.identificador("Pneumocócica Conjugada"))
teste("colisão de identificadores é recusada", levanta(lambda: v.validar_unicidade_de_ids({2020: {"Pólio", "Polio"}}), v.ErroDeIntegridade))
teste("método até 2022 é por tipo de dose", v.metodo_do_ano(2015) == v.metodo_do_ano(2022) == "tipo_de_dose")
teste("método a partir de 2023 é por indivíduo", v.metodo_do_ano(2023) == v.metodo_do_ano(2025) == "individuo")

# ---------------------------------------------------------------------------------------------------------------- metas
teste("meta de BCG e rotavírus é 90%", v.meta_do("bcg", 2024) == 0.90 and v.meta_do("rotavirus", 2016) == 0.90)
teste("meta de penta, tríplice viral D1 e poliomielite é 95%", all(v.meta_do(i, 2024) == 0.95 for i in ("penta_dtp_hepb_hib", "triplice_viral_1_dose", "poliomielite")))
teste("metas de 95% confirmadas pelas NT 87/91 para 2023–2025", all(v.meta_do(v.identificador(r), ano) == 0.95
      for ano in (2023, 2024, 2025) for r in ("Hepatite B (<= 30 dias)", "Febre Amarela", "Febre Amarela (Reforço)",
      "DTP (1° Reforço)", "DTP (2° Reforço)", "Varicela", "Varicela - 2° dose", "Tríplice Viral - 2° Dose", "Hepatite A Infantil",
      "Meningocócica Conjugada (1° Reforço)", "Pneumocócica Conjugada (1° Reforço)", "Poliomielite (1° Reforço)", "Poliomielite (2° Reforço)")))
teste("oportunidade de hepatite B não recebe meta de cobertura", all(v.meta_do(v.identificador(r), ano) is None
      for ano in (2015, 2022, 2023, 2025) for r in ("Hepatite B (<= 1 dia)", "Hepatite B (<= 2 dias)")))
teste("metas atuais não são projetadas sobre períodos/rótulos históricos incertos", all(v.meta_do(v.identificador(r), ano) is None
      for ano in (2015, 2022) for r in ("Febre Amarela", "DTP (1° Reforço)", "Hepatite B (< 30 dias)", "Polio Injetável (VIP)", "Tríplice Viral - 2° Dose")))
teste("ano fora do lote e rótulo desconhecido não herdam meta", v.meta_do("bcg", 2026) is None and v.meta_do("desconhecido", 2024) is None)

# ----------------------------------------------------------------------------------------------------------- normalização
def reg(num, den, cob, ano=2024):
    return {"ano": ano, "nivel": "MUNICIPIO", "codigo": "520870", "rotulo": "Goiânia", "uf": "GO", "imunobiologico": "BCG",
            "numerador": num, "denominador": den, "cobertura_fonte": cob, "texto_cobertura": ""}


n = v.normalizar(reg(12918, 17937, 0.7201873222946981))
teste("cobertura é razão: 0,72 = 72% (sem multiplicar por 100)", abs(n["cobertura"] - 0.7201873) < 1e-6 and n["status"] == "ok")
n = v.normalizar(reg(18302, 17937, 18302 / 17937))
teste("percentual acima de 100% é preservado", n["cobertura"] > 1 and n["status"] == "ok")
n = v.normalizar(reg(0, 120, 0.0))
teste("numerador zero com denominador positivo é zero verdadeiro", n["cobertura"] == 0.0 and n["status"] == "ok")
n = v.normalizar(reg(5, 0, v.SENTINELA))
teste("sentinela 0,0000001 com base zero não vira cobertura", n["cobertura"] is None and n["status"] == "denominador_zero" and n["cobertura_fonte"] == v.SENTINELA)
n = v.normalizar(reg(0, 0, 0.0))
teste("denominador zero (numerador zero) não é calculável", n["cobertura"] is None and n["status"] == "denominador_zero")
n = v.normalizar(reg(None, None, None))
teste("célula ausente não é zero", n["cobertura"] is None and n["status"] == "sem_valor")
n = v.normalizar(reg(50, 100, 0.8))
teste("cobertura da fonte divergente do numerador ÷ denominador é recalculada e sinalizada", n["cobertura"] == 0.5 and n["status"] == "recalculada")
teste("método acompanha o ano", v.normalizar(reg(1, 2, 0.5, 2022))["metodo"] == "tipo_de_dose" and v.normalizar(reg(1, 2, 0.5, 2023))["metodo"] == "individuo")
teste("contagem não inteira é recusada", levanta(lambda: v._inteiro(1.5), v.ErroDeIntegridade) and v._inteiro(3.0) == 3 and v._inteiro(None) is None)
teste("NaN é ausência", v.numero({"qNum": "NaN"}) is None and v.numero({"qNum": float("nan")}) is None and v.numero({"qNum": 0}) == 0)

# --------------------------------------------------------------------------------------------------------- classificação
C = v.classificar
teste("Brasil", C(("Brasil", "Totais", "", "", "", "")) == ("BR", "BR", "Brasil"))
teste("região", C(("Brasil", "Centro-Oeste", "Totais", "", "", "")) == ("REGIAO", "Centro-Oeste", "Centro-Oeste"))
teste("UF", C(("Brasil", "Centro-Oeste", "GO", "Totais", "", ""))[:2] == ("UF", "GO"))
teste("macrorregião", C(("Brasil", "Centro-Oeste", "GO", "5206 - MACRORREGIAO SUDOESTE", "Totais", ""))[:2] == ("MACRO", "5206"))
teste("região de saúde leva a macro no código (a mesma região repete-se sob macros diferentes)",
      C(("Brasil", "Norte", "RO", "1101 - A", "11003 - CENTRAL", "Totais"))[1] == "1101:11003"
      and C(("Brasil", "Norte", "RO", "1102 - B", "11003 - CENTRAL", "Totais"))[1] == "1102:11003")
teste("município", C(("Brasil", "Centro-Oeste", "GO", "5206 - M", "52015 - R", "520870 - Goiânia")) == ("MUNICIPIO", "520870", "Goiânia"))
teste("totalizador com níveis preenchidos abaixo é recusado", levanta(lambda: C(("Brasil", "Totais", "", "GO", "", "")), ValueError))
teste("município sem código de 6 dígitos é recusado", levanta(lambda: C(("Brasil", "Centro-Oeste", "GO", "5206 - M", "52015 - R", "Goiânia")), ValueError))

# ------------------------------------------------------------------------------------------------------- plano de páginas
for linhas, colunas in ((6164, 66), (6164, 42), (10, 3), (1, 66), (6164, 1)):
    plano = b.plano_paginas(linhas, colunas)
    teste(f"plano {linhas}×{colunas}: cobre todas as linhas, sem sobreposição, ≤ 10 mil células",
          sum(h for _, h in plano) == linhas and [t for t, _ in plano] == sorted({t for t, _ in plano})
          and all(h * colunas <= 10000 for _, h in plano) and plano[0][0] == 0 and all(plano[i][0] + plano[i][1] == plano[i + 1][0] for i in range(len(plano) - 1)))
teste("cubo vazio é recusado", levanta(lambda: b.plano_paginas(5, 0), ValueError))

# ------------------------------------------------------------------------------------------------ destinos protegidos
tmp = Path(tempfile.mkdtemp(prefix="vac_teste_"))
teste("brutos fora de …/brutos/vacinacao são recusados", levanta(lambda: b.validar_raiz(tmp / "qualquer"), ValueError))
teste("brutos dentro do gold são recusados", levanta(lambda: b.validar_raiz(tmp / "gold" / "brutos" / "vacinacao"), ValueError))
teste("brutos …/brutos/vacinacao são aceitos", b.validar_raiz(tmp / "brutos" / "vacinacao") == (tmp / "brutos" / "vacinacao").resolve())
base = tmp / "data" / "gold"
base.mkdir(parents=True)
teste("candidato sobre o gold publicado é recusado", levanta(lambda: v.validar_destinos(base, base), ValueError))
teste("candidato dentro do gold publicado é recusado", levanta(lambda: v.validar_destinos(base, base / "novo"), ValueError))
teste("candidato que contém o gold publicado é recusado", levanta(lambda: v.validar_destinos(base, tmp), ValueError))
teste("candidato na pasta de dados (silver, landing…) é recusado", levanta(lambda: v.validar_destinos(base, tmp / "data"), ValueError))
teste("candidato em brutos é recusado", levanta(lambda: v.validar_destinos(base, tmp / "brutos" / "x"), ValueError))
teste("candidato em pasta própria é aceito", v.validar_destinos(base, tmp / "candidato") is None)

# ----------------------------------------------------------------------------------------- leitura de páginas sintéticas
COLS = [("BCG", "Cobertura Vacinal (%)"), ("BCG", "Numerador"), ("BCG", "Denominador"), ("Febre Amarela", "Cobertura Vacinal (%)"),
        ("Febre Amarela", "Numerador"), ("Febre Amarela", "Denominador")]


def no(texto, tipo="N", elem=0, filhos=None):
    return {"qText": texto, "qType": tipo, "qElemNo": elem, "qSubNodes": filhos or []}


def cel(x):
    return {"qText": "x" if x is not None else "-", "qNum": "NaN" if x is None else x, "qType": "V"}


def topo():
    return [no(i, "N", k, [no(m, "P", j) for j, m in enumerate(("Cobertura Vacinal (%)", "Numerador", "Denominador"))]) for k, i in enumerate(("BCG", "Febre Amarela"))]


def pagina(folhas, dados):
    """folhas: lista de caminhos de 6 (texto, tipo, elem); monta a árvore de qLeft."""
    raiz = []
    for caminho in folhas:
        nivel = raiz
        for texto, tipo, elem in caminho:
            alvo = next((x for x in nivel if x["qElemNo"] == elem and x["qText"] == texto and x["qType"] == tipo), None)
            if alvo is None:
                alvo = no(texto, tipo, elem)
                nivel.append(alvo)
            nivel = alvo["qSubNodes"]
    return {"qLeft": raiz, "qTop": topo(), "qData": dados, "qArea": {}}


def escrever(raiz, ano, paginas, plano, completo=True, corromper=False):
    pasta = raiz / str(ano)
    pasta.mkdir(parents=True)
    mf = {"ano": ano, "completo": completo, "cubo": {"linhas": sum(h for _, h in plano), "colunas": 6}, "plano": plano, "paginas": {}}
    for i, pg in enumerate(paginas):
        bruto = json.dumps(pg, ensure_ascii=False).encode()
        with gzip.open(pasta / f"pagina_{i:04d}.json.gz", "wb") as f:
            f.write(bruto if not corromper else bruto + b" ")
        mf["paginas"][f"{i:04d}"] = {"sha256": b.sha256(bruto), "bytes": len(bruto)}
    (pasta / "manifesto.json").write_text(json.dumps(mf), encoding="utf-8")


E = ("", "E", -4)
BR = [("Brasil", "N", 0), ("Totais", "T", -1), E, E, E, E]
UFGO = [("Brasil", "N", 0), ("Centro-Oeste", "N", 4), ("GO", "N", 25), ("Totais", "T", -1), E, E]
M1 = [("Brasil", "N", 0), ("Centro-Oeste", "N", 4), ("GO", "N", 25), ("5206 - MACRO", "N", 7), ("52015 - REG", "N", 9), ("520870 - Goiânia", "N", 100)]
# a segunda página começa no meio da árvore: os ancestrais voltam sem texto (só o número do elemento)
M2 = [("", "N", 0), ("", "N", 4), ("", "N", 25), ("", "N", 7), ("", "N", 9), ("520013 - Acreúna", "N", 101)]
linha1 = [cel(1.05), cel(105), cel(100), cel(None), cel(None), cel(None)]
linha_go = [cel(0.8), cel(80), cel(100), cel(0.5), cel(5), cel(10)]
linha_m1 = [cel(0.72), cel(72), cel(100), cel(0), cel(0), cel(8)]
linha_m2 = [cel(v.SENTINELA), cel(3), cel(0), cel(None), cel(None), cel(None)]
r1 = tmp / "ok" / "brutos" / "vacinacao"
escrever(r1, 2024, [pagina([BR, UFGO], [linha1, linha_go]), pagina([M1], [linha_m1]), pagina([M2], [linha_m2])], [(0, 2), (2, 1), (3, 1)])
lido = v.ler_ano(r1, 2024)
por = {(x["nivel"], x["codigo"], x["imunobiologico"]): x for x in lido["registros"]}
teste("lê Brasil, UF e municípios; ancestrais cortados pela paginação voltam pelo número do elemento", ("BR", "BR", "BCG") in por and ("UF", "GO", "BCG") in por
      and ("MUNICIPIO", "520870", "BCG") in por and ("MUNICIPIO", "520013", "BCG") in por and por[("MUNICIPIO", "520013", "BCG")]["uf"] == "GO")
teste("célula ausente (NaN) gera ausência, não linha com zero", ("BR", "BR", "Febre Amarela") not in por and ("MUNICIPIO", "520013", "Febre Amarela") not in por)
teste("zero verdadeiro de numerador é guardado", por[("MUNICIPIO", "520870", "Febre Amarela")]["numerador"] == 0)
teste("valores guardados exatamente como a fonte entrega", por[("UF", "GO", "BCG")]["numerador"] == 80 and por[("UF", "GO", "BCG")]["denominador"] == 100)
teste("auditoria conta as linhas do cubo", lido["auditoria"]["linhas_cubo"] == 4 and lido["auditoria"]["registros"] == len(lido["registros"]))

r2 = tmp / "corrompido" / "brutos" / "vacinacao"
escrever(r2, 2024, [pagina([BR, UFGO], [linha1, linha_go])], [(0, 2)], corromper=True)
teste("página que não confere com o hash é recusada", levanta(lambda: v.ler_ano(r2, 2024), v.ErroDeIntegridade))
r3 = tmp / "incompleto" / "brutos" / "vacinacao"
escrever(r3, 2024, [pagina([BR, UFGO], [linha1, linha_go])], [(0, 2)], completo=False)
teste("captura incompleta é recusada", levanta(lambda: v.ler_ano(r3, 2024), v.ErroDeIntegridade))
r4 = tmp / "outro_ano" / "brutos" / "vacinacao"
escrever(r4, 2024, [pagina([BR, UFGO], [linha1, linha_go])], [(0, 2)])
mf4 = json.loads((r4 / "2024" / "manifesto.json").read_text())
mf4["ano"] = 2023
(r4 / "2024" / "manifesto.json").write_text(json.dumps(mf4))
teste("manifesto de outro ano é recusado", levanta(lambda: v.ler_ano(r4, 2024), v.ErroDeIntegridade))
r5 = tmp / "duplicado" / "brutos" / "vacinacao"
escrever(r5, 2024, [pagina([BR, BR], [linha1, linha1])], [(0, 2)])
teste("linha duplicada é recusada", levanta(lambda: v.ler_ano(r5, 2024), v.ErroDeIntegridade))
r6 = tmp / "linhas" / "brutos" / "vacinacao"
escrever(r6, 2024, [pagina([BR, UFGO], [linha1, linha_go])], [(0, 2)])
mf6 = json.loads((r6 / "2024" / "manifesto.json").read_text())
mf6["cubo"]["linhas"] = 3
(r6 / "2024" / "manifesto.json").write_text(json.dumps(mf6))
teste("menos linhas lidas que o cubo declara é recusado", levanta(lambda: v.ler_ano(r6, 2024), v.ErroDeIntegridade))
r7 = tmp / "uf" / "brutos" / "vacinacao"
errada = [("Brasil", "N", 0), ("Centro-Oeste", "N", 4), ("MT", "N", 26), ("5206 - MACRO", "N", 7), ("52015 - REG", "N", 9), ("520870 - Goiânia", "N", 100)]
escrever(r7, 2024, [pagina([errada], [linha_m1])], [(0, 1)])
teste("município sob a UF errada é recusado", levanta(lambda: v.ler_ano(r7, 2024), v.ErroDeIntegridade))

# a mesma região de saúde sob duas macrorregiões não é duplicata
RO1 = [("Brasil", "N", 0), ("Norte", "N", 1), ("RO", "N", 2), ("1101 - A", "N", 3), ("11003 - CENTRAL", "N", 4), ("Totais", "T", -1)]
RO2 = [("Brasil", "N", 0), ("Norte", "N", 1), ("RO", "N", 2), ("1102 - B", "N", 5), ("11003 - CENTRAL", "N", 4), ("Totais", "T", -1)]
r8 = tmp / "regiao" / "brutos" / "vacinacao"
escrever(r8, 2015, [pagina([RO1, RO2], [linha1, linha1])], [(0, 2)])
teste("região de saúde repetida sob duas macros é aceita (código com a macro)", len(v.ler_ano(r8, 2015)["registros"]) == 2)

# captura em cache não abre conexão
def sem_conexao():
    raise AssertionError("abriu conexão para um ano completo e íntegro")


r9 = tmp / "cache" / "brutos" / "vacinacao"
escrever(r9, 2024, [pagina([BR, UFGO], [linha1, linha_go])], [(0, 2)])
try:
    mf = b.baixar_ano(2024, r9, sessao_fn=sem_conexao)
    teste("ano completo em cache não abre conexão", mf["completo"] is True)
except AssertionError as e:
    teste("ano completo em cache não abre conexão", False, str(e))

# ----------------------------------------------------------------------- manifesto e catálogo (sintéticos)
con = duckdb.connect()
con.execute("CREATE TABLE t AS SELECT * FROM (VALUES (2015), (2016), (2022), (2023), (2025)) x(ano)")
arq = tmp / "vacinacao.parquet"
con.execute(f"COPY t TO '{arq.as_posix()}' (FORMAT parquet)")
f = v.fonte_vacinacao(con, arq)
teste("fonte no manifesto: anos e métodos separados", f["anos"] == [2015, 2016, 2022, 2023, 2025] and f["metodos"] == {"tipo_de_dose": [2015, 2022], "individuo": [2023, 2025]} and f["url"].startswith("https://infoms."))

# --------------------------------------------------------------------- reconciliação com os dados oficiais (se existirem)
CAND = Path(os.environ.get("VACINACAO_CANDIDATO", "E:/finbra/candidato_vacinacao_20261110")) / "gold" / "saude"
if (CAND / "vacinacao.parquet").exists():
    m, t, c = (CAND / "vacinacao.parquet").as_posix(), (CAND / "vacinacao_territorios.parquet").as_posix(), (CAND / "vacinacao_catalogo.parquet").as_posix()
    q = lambda sql: con.execute(sql).fetchall()
    oficial = [  # (ano, território, numerador, denominador, cobertura em %), BCG, residência
        (2024, "mun", 520870, 12918, 17937, 72.0187), (2024, "UF", "GO", 77422, 88862, 87.1261), (2024, "BR", "BR", 2365381, 2389271, 99.0001),
        (2015, "mun", 520870, 24227, 21983, 110.2079), (2025, "mun", 520870, 18302, 17937, 102.0349)]
    for ano, nivel, cod, num, den, pct in oficial:
        if nivel == "mun":
            r = q(f"SELECT numerador, denominador, cobertura, metodo FROM '{m}' WHERE ano={ano} AND municipio={cod} AND imunobiologico='bcg'")
        else:
            r = q(f"SELECT numerador, denominador, cobertura, metodo FROM '{t}' WHERE ano={ano} AND nivel='{nivel}' AND codigo='{cod}' AND imunobiologico='bcg'")
        teste(f"oficial BCG {ano} {cod}: {num}/{den} = {pct}%", len(r) == 1 and r[0][0] == num and r[0][1] == den and abs(100 * r[0][2] - pct) < 5e-5, r)
    teste("Goiânia (6 dígitos 520870) resolve para o IBGE de 7 dígitos 5208707", q(f"SELECT DISTINCT cod_ibge FROM '{m}' WHERE municipio=520870") == [(5208707,)])
    teste("dois anos de métodos distintos nunca na mesma linha de método",
          q(f"SELECT count(*) FROM '{m}' WHERE (ano<=2022) <> (metodo='tipo_de_dose')") == [(0,)])
    teste("sem duplicatas em ano × município × imunobiológico", q(f"SELECT count(*) FROM (SELECT 1 FROM '{m}' GROUP BY ano, municipio, imunobiologico HAVING count(*)>1)") == [(0,)])
    teste("sem duplicatas em ano × território × imunobiológico", q(f"SELECT count(*) FROM (SELECT 1 FROM '{t}' GROUP BY ano, nivel, codigo, imunobiologico HAVING count(*)>1)") == [(0,)])
    teste("só Brasil, região e UF no arquivo de territórios", q(f"SELECT list(DISTINCT nivel ORDER BY nivel) FROM '{t}'") == [(["BR", "REGIAO", "UF"],)])
    teste("denominador zero nunca tem cobertura", q(f"SELECT count(*) FROM '{m}' WHERE coalesce(denominador,0)=0 AND cobertura IS NOT NULL") == [(0,)])
    teste("cobertura positiva sempre bate com numerador ÷ denominador", q(f"SELECT count(*) FROM '{m}' WHERE cobertura IS NOT NULL AND abs(cobertura - numerador::DOUBLE/denominador) > 1e-6*greatest(1,cobertura)") == [(0,)])
    teste("percentuais acima de 100% existem e foram preservados", q(f"SELECT max(cobertura) > 1.2 FROM '{m}'") == [(True,)])
    teste("o ano 2026 não entra", q(f"SELECT max(ano) FROM '{m}'") == [(2025,)] and q(f"SELECT min(ano) FROM '{m}'") == [(2015,)])
    # UF = soma dos municípios; Brasil = soma das UFs (numeradores e denominadores oficiais)
    teste("totalizador da UF = soma dos municípios (numerador e denominador)", q(f"""
        SELECT count(*) FROM '{t}' u JOIN (SELECT ano, uf, imunobiologico, sum(numerador) n, sum(denominador) d FROM '{m}' GROUP BY ALL) s USING (ano, uf, imunobiologico)
        WHERE u.nivel='UF' AND (u.numerador<>s.n OR u.denominador<>s.d)""") == [(0,)])
    teste("Brasil = soma das UFs", q(f"""
        SELECT count(*) FROM '{t}' b JOIN (SELECT ano, imunobiologico, sum(numerador) n, sum(denominador) d FROM '{t}' WHERE nivel='UF' GROUP BY ALL) s USING (ano, imunobiologico)
        WHERE b.nivel='BR' AND (b.numerador<>s.n OR b.denominador<>s.d)""") == [(0,)])
    teste("catálogo varia por ano: 14 em 2015, 22 em 2023, 21 em 2025", [q(f"SELECT count(*) FROM '{c}' WHERE ano={a}")[0][0] for a in (2015, 2023, 2025)] == [14, 22, 21])
    teste("catálogo: metas confirmadas desde 2023 estão presentes", q(f"SELECT count(*) FROM '{c}' WHERE ano>=2023 AND imunobiologico IN ('hepatite_b_le_30_dias','febre_amarela','hepatite_a_infantil','triplice_viral_2_dose','varicela','dtp_1_reforco') AND meta IS DISTINCT FROM 0.95") == [(0,)])
    teste("catálogo: oportunidade e febre amarela histórica sem meta inferida", q(f"SELECT count(*) FROM '{c}' WHERE meta IS NOT NULL AND (imunobiologico IN ('hepatite_b_le_1_dia','hepatite_b_le_2_dias') OR (ano<=2022 AND imunobiologico='febre_amarela'))") == [(0,)])
    teste("municípios ignorados do cadastro ficam com o código original", q(f"SELECT count(*) FROM '{m}' WHERE cod_ibge IS NULL AND municipio IS NULL") == [(0,)])
else:
    print("pulou  reconciliação com os dados oficiais (candidato ausente em", CAND, ")")

print()
if falhas:
    print(f"{len(falhas)} FALHA(S):", *falhas, sep="\n  ")
    sys.exit(1)
print("todos os testes passaram")
