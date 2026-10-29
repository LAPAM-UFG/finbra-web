"""Conferência independente das cinco perguntas de auditoria da IA ("Pergunte aos dados").

Recalcula cada resultado direto nas camadas de origem, sem as tabelas que a IA consulta (gold/indicadores,
trab_*, cubos rais_uf/rais_mun) e sem o SQL que ela escreveu:

  A  FPM nos municípios de Goiás, 2013–2025: silver/dca conta a conta, com os códigos do FPM escritos aqui para
     cada ementário (não a busca por descrição do gold.py), e a conferência de que a conta-mãe não soma com as
     subcontas; população de silver/populacao; exclusões da política de alertas (gold/alertas, a regra do painel).
  B  Enfermeiros (CBO 2235xx) no Brasil, 2015–2025: microdados da RAIS vínculo a vínculo.
  C  Novo CAGED em Goiás, jan–ago de 2025 e 2026: silver/trabalho/caged (movimentações MOV, FOR e EXC por
     competência, antes da agregação do painel).
  D  Goiânia, 2024: SIOPS (silver/siops, como veio do TABNET) e função Saúde da DCA (silver/dca, anexo I-E).
  E  PIB per capita × remuneração média de dezembro nos municípios de Goiás: PIB de silver/ibge_pib, população
     de silver/populacao e remuneração dos microdados da RAIS; o ano é o último comum às duas fontes.

Com o arquivo da auditoria (gerado por IA_AUDITORIA=arquivo.json npm test, em web/), compara cada número
de referência com as células dos resultados das consultas da IA no mesmo período e escreve a tabela
indicador | plataforma | conferência | diferença | diagnóstico.

Uso:
    py pipeline/auditoria_ia.py --saida referencia.json [--plataforma auditoria.json] [--relatorio comparacao.md]
"""
import argparse
import json
import math
from pathlib import Path

import duckdb

from config import GOLD, SILVER

MICRO = Path("D:/LVBERNARDELLI/finbra_micro/silver/trabalho/micro")
BRUTA = "Receitas Brutas Realizadas"
# FPM por ementário: contas irmãs que somam o fundo, ou a conta-mãe (2022 em diante); nunca mãe + filhas
FPM = {
    **{a: ["RO1.7.2.1.01.02"] for a in (2013, 2014)},
    **{a: ["RO1.7.2.1.01.02", "RO1.7.2.1.01.03", "RO1.7.2.1.01.04"] for a in (2015, 2016, 2017)},
    **{a: ["RO1.7.1.8.01.2", "RO1.7.1.8.01.3", "RO1.7.1.8.01.4"] for a in (2018, 2019, 2020, 2021)},
    **{a: ["RO1.7.1.1.51"] for a in (2022, 2023, 2024, 2025)},
}


def conectar():
    con = duckdb.connect()
    con.execute("SET enable_progress_bar = false")
    return con


def linhas(con, sql):
    r = con.execute(sql)
    cols = [d[0] for d in r.description]
    return [dict(zip(cols, x)) for x in r.fetchall()]


def ipca(con):
    m = json.loads((GOLD / "manifesto.json").read_text(encoding="utf-8"))
    idx = {r["exercicio"]: r["indice"] for r in linhas(con, f"SELECT exercicio, indice FROM '{SILVER.as_posix()}/ipca.parquet'")}
    return m["base_ipca"], idx


def pergunta_a(con):
    s = SILVER.as_posix()
    base, idx = ipca(con)
    con.execute("CREATE TEMP TABLE fpm_contas (exercicio INTEGER, chave VARCHAR)")
    con.executemany("INSERT INTO fpm_contas VALUES (?, ?)", [(a, c) for a, cs in FPM.items() for c in cs])
    con.execute(f"""CREATE TEMP TABLE mun AS SELECT cod_ibge FROM '{s}/entes.parquet' WHERE esfera = 'M' AND uf = 'GO'""")
    con.execute(f"""CREATE TEMP TABLE dca_go AS SELECT d.* FROM '{s}/dca/*.parquet' d JOIN mun USING (cod_ibge)
                    WHERE d.anexo = 'I-C' AND d.coluna = '{BRUTA}'""")
    # 2022+: a conta-mãe do FPM contra a soma das subcontas, ente a ente
    maes = linhas(con, """
        SELECT exercicio, count(*) AS entes,
               count(*) FILTER (mae IS NULL AND filhas IS NOT NULL) AS so_filhas,
               count(*) FILTER (abs(mae - filhas) > 1) AS mae_difere
        FROM (SELECT exercicio, cod_ibge,
                     sum(valor) FILTER (chave = 'RO1.7.1.1.51') AS mae,
                     sum(valor) FILTER (starts_with(chave, 'RO1.7.1.1.51.')) AS filhas
              FROM dca_go WHERE exercicio >= 2022 GROUP BY ALL) GROUP BY 1 ORDER BY 1""")
    excl = f"(SELECT exercicio, cod_ibge FROM '{GOLD.as_posix()}/alertas.parquet' WHERE exclui AND dominio = 'receita')"
    por_ente = f"""
        SELECT p.exercicio, p.cod_ibge, p.populacao,
               (SELECT sum(valor) FROM dca_go d WHERE d.exercicio = p.exercicio AND d.cod_ibge = p.cod_ibge AND d.chave = 'TotalReceitas') AS receita_bruta,
               (SELECT sum(valor) FROM dca_go d WHERE d.exercicio = p.exercicio AND d.cod_ibge = p.cod_ibge AND d.chave = 'RO1') AS rc,
               (SELECT sum(d.valor) FROM dca_go d JOIN fpm_contas f USING (exercicio, chave)
                 WHERE d.exercicio = p.exercicio AND d.cod_ibge = p.cod_ibge) AS fpm,
               EXISTS (SELECT 1 FROM {excl} x WHERE x.exercicio = p.exercicio AND x.cod_ibge = p.cod_ibge) AS excluido
        FROM '{s}/populacao/*.parquet' p JOIN mun USING (cod_ibge)"""
    anos = linhas(con, f"""
        WITH e AS ({por_ente}),
        u AS (SELECT * FROM e WHERE receita_bruta > 0 AND NOT excluido AND fpm IS NOT NULL AND rc > 0)
        SELECT e.exercicio AS ano, count(*) AS municipios,
               count(*) FILTER (e.receita_bruta > 0) AS com_receita,
               count(*) FILTER (e.excluido) AS excluidos,
               (SELECT count(*) FROM u WHERE u.exercicio = e.exercicio) AS usados,
               (SELECT sum(fpm) FROM u WHERE u.exercicio = e.exercicio) AS fpm,
               (SELECT sum(rc) FROM u WHERE u.exercicio = e.exercicio) AS receita_corrente,
               (SELECT sum(populacao) FROM u WHERE u.exercicio = e.exercicio) AS populacao,
               (SELECT 100 * sum(fpm) / sum(rc) FROM u WHERE u.exercicio = e.exercicio) AS razao_dos_totais_pct,
               (SELECT 100 * avg(fpm / rc) FROM u WHERE u.exercicio = e.exercicio) AS media_das_razoes_pct,
               (SELECT 100 * median(fpm / rc) FROM u WHERE u.exercicio = e.exercicio) AS mediana_das_razoes_pct,
               (SELECT sum(fpm) / sum(populacao) FROM u WHERE u.exercicio = e.exercicio) AS fpm_per_capita,
               (SELECT sum(rc) / sum(populacao) FROM u WHERE u.exercicio = e.exercicio) AS rc_per_capita,
               -- declarado: todos os que têm receita, sem a política de exclusão
               (SELECT 100 * sum(fpm) / sum(rc) FROM e x WHERE x.exercicio = e.exercicio AND x.receita_bruta > 0 AND x.fpm IS NOT NULL AND x.rc > 0) AS razao_declarada_pct
        FROM e GROUP BY 1 ORDER BY 1""")
    for r in anos:
        f = idx[base] / idx[r["ano"]]
        r["fpm_real"] = r["fpm"] * f if r["fpm"] is not None else None
        r["fpm_real_mi"] = r["fpm_real"] / 1e6 if r["fpm_real"] is not None else None
        r["rc_real_mi"] = r["receita_corrente"] * f / 1e6 if r["receita_corrente"] is not None else None
        r["fpm_per_capita_real"] = r["fpm_per_capita"] * f if r["fpm_per_capita"] is not None else None
        r["deflator"] = f
    return {"base_ipca": base, "anos": anos, "conta_mae_vs_subcontas": maes}


def pergunta_b(con):
    base, idx = ipca(con)
    arquivos = [f"{MICRO.as_posix()}/rais_vinculos/ano={a}/*.parquet" for a in range(2015, 2026)]
    con.execute(f"""CREATE TEMP TABLE enf AS SELECT ano, cbo, sexo, ativo_31_12, rem_dezembro_nom::DOUBLE AS rem
                    FROM read_parquet({arquivos}, hive_partitioning = true) WHERE starts_with(cbo, '2235')""")
    codigos = linhas(con, f"""SELECT e.cbo, d.descricao, count(*) FILTER (ativo_31_12 = 1) AS ativos
                              FROM enf e LEFT JOIN '{GOLD.as_posix()}/trabalho/dicionario.parquet' d ON d.variavel = 'cbo' AND d.codigo = e.cbo
                              GROUP BY ALL ORDER BY 1""")
    anos = linhas(con, """
        SELECT ano, count(*) FILTER (ativo_31_12 = 1) AS ativos,
               count(*) FILTER (ativo_31_12 = 1 AND sexo = 2) AS ativos_mulheres,
               count(*) FILTER (ativo_31_12 = 1 AND sexo NOT IN (1, 2)) AS ativos_sem_sexo,
               count(*) AS vinculos_no_ano,
               count(*) FILTER (ativo_31_12 = 1 AND rem > 0) AS n_rem,
               count(*) FILTER (ativo_31_12 = 1 AND (rem IS NULL OR rem <= 0)) AS ativos_sem_rem,
               sum(rem) FILTER (ativo_31_12 = 1 AND rem > 0) / count(*) FILTER (ativo_31_12 = 1 AND rem > 0) AS rem_media,
               sum(rem) FILTER (ativo_31_12 = 1 AND rem > 0 AND sexo = 2) / count(*) FILTER (ativo_31_12 = 1 AND rem > 0 AND sexo = 2) AS rem_media_mulheres,
               sum(rem) FILTER (ativo_31_12 = 1 AND rem > 0 AND sexo = 1) / count(*) FILTER (ativo_31_12 = 1 AND rem > 0 AND sexo = 1) AS rem_media_homens,
               median(rem) FILTER (ativo_31_12 = 1 AND rem > 0) AS rem_mediana,
               -- erro comum: média que inclui zeros e nulos como zero
               avg(coalesce(rem, 0)) FILTER (ativo_31_12 = 1) AS rem_media_com_zeros
        FROM enf GROUP BY 1 ORDER BY 1""")
    for r in anos:
        f = idx[base] / idx[r["ano"]]
        r["participacao_feminina_pct"] = 100 * r["ativos_mulheres"] / r["ativos"]
        r["rem_media_real"] = r["rem_media"] * f
        r["rem_media_mulheres_real"] = r["rem_media_mulheres"] * f
        r["rem_media_homens_real"] = r["rem_media_homens"] * f
        r["diferenca_mulheres_homens"] = r["rem_media_mulheres"] - r["rem_media_homens"]
        r["diferenca_mulheres_homens_real"] = r["diferenca_mulheres_homens"] * f
        r["razao_mulheres_homens_pct"] = 100 * (r["rem_media_mulheres"] / r["rem_media_homens"] - 1)
        r["deflator"] = f
    return {"base_ipca": base, "codigos_cbo": codigos, "anos": anos}


def pergunta_c(con):
    c = (SILVER / "trabalho" / "caged").as_posix()
    meses = linhas(con, f"""
        SELECT competencia,
               sum(CASE WHEN tipo = 'EXC' THEN -admissoes ELSE admissoes END) AS admissoes,
               sum(CASE WHEN tipo = 'EXC' THEN -desligamentos ELSE desligamentos END) AS desligamentos,
               sum(CASE WHEN tipo = 'EXC' THEN -saldo ELSE saldo END) AS saldo,
               sum(saldo) FILTER (tipo = 'MOV') AS saldo_so_no_prazo
        FROM read_parquet('{c}/*.parquet')
        WHERE municipio // 10000 = 52 AND (competencia BETWEEN 202501 AND 202508 OR competencia BETWEEN 202601 AND 202608)
        GROUP BY 1 ORDER BY 1""")
    acum = {}
    for r in meses:
        a = r["competencia"] // 100
        acum[a] = acum.get(a, 0) + r["saldo"]
        r["saldo_acumulado"] = acum[a]
    ultima = linhas(con, f"SELECT max(competencia) AS c FROM read_parquet('{c}/*.parquet') WHERE tipo = 'MOV'")[0]["c"]
    tot = {a: {k: sum(r[k] for r in meses if r["competencia"] // 100 == a) for k in ("admissoes", "desligamentos", "saldo")} for a in (2025, 2026)}
    return {"ultima_competencia": ultima, "meses": meses, "totais_jan_ago": tot,
            "variacao_saldo_abs": tot[2026]["saldo"] - tot[2025]["saldo"]}


def pergunta_d(con):
    s = SILVER.as_posix()
    siops = linhas(con, f"SELECT codigo, valor FROM '{s}/siops/ano=2024/uf=GO.parquet' WHERE cod_muni = 520870 ORDER BY codigo")
    dca = linhas(con, f"""SELECT coluna, chave, sum(valor) AS valor FROM '{s}/dca/exercicio=2024.parquet'
                          WHERE cod_ibge = 5208707 AND anexo = 'I-E' AND chave IN ('F10', 'TotalExcetoIntra', 'TotalIntra')
                          GROUP BY ALL ORDER BY 2, 1""")
    # a saúde intraorçamentária (se declarada) aparece numa chave própria da função 10 nas linhas Intra
    intra = linhas(con, f"""SELECT d.coluna, d.chave, c.descricao, d.valor FROM '{s}/dca/exercicio=2024.parquet' d
                            LEFT JOIN '{s}/contas/exercicio=2024.parquet' c ON c.anexo = d.anexo AND c.chave = d.chave
                            WHERE d.cod_ibge = 5208707 AND d.anexo = 'I-E' AND d.chave LIKE 'FI10%' ORDER BY 2, 1""")
    v = {r["codigo"]: r["valor"] for r in siops}
    f10 = {r["coluna"]: r["valor"] for r in dca if r["chave"] == "F10"}
    comp = {col: {"dca_f10": x, "siops_d_total": v.get("d_total"), "diferenca": (v.get("d_total") or 0) - x,
                  "diferenca_pct": 100 * ((v.get("d_total") or 0) / x - 1)} for col, x in f10.items()}
    return {"siops": siops, "dca": dca, "dca_intra_saude": intra, "comparacao": comp,
            "d_total_por_hab_recalculado": v["d_total"] / v["populacao"]}


def pergunta_e(con):
    s = SILVER.as_posix()
    ano = linhas(con, f"""SELECT max(exercicio) AS a FROM '{s}/ibge_pib.parquet' WHERE pib IS NOT NULL
                          AND exercicio IN (SELECT DISTINCT ano FROM read_parquet('{MICRO.as_posix()}/rais_vinculos/*/uf=52.parquet', hive_partitioning = true))""")[0]["a"]
    con.execute(f"""CREATE TEMP TABLE e AS
        WITH mun AS (SELECT cod_ibge FROM '{s}/entes.parquet' WHERE esfera = 'M' AND uf = 'GO'),
        pib AS (SELECT cod_ibge, pib FROM '{s}/ibge_pib.parquet' WHERE exercicio = {ano}),
        pop AS (SELECT cod_ibge, populacao FROM '{s}/populacao/exercicio={ano}.parquet'),
        rais AS (SELECT municipio, count(*) FILTER (ativo_31_12 = 1) AS empregos,
                        sum(rem_dezembro_nom::DOUBLE) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0) AS massa,
                        count(*) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0) AS n_rem
                 FROM '{MICRO.as_posix()}/rais_vinculos/ano={ano}/uf=52.parquet' GROUP BY 1)
        SELECT m.cod_ibge, pib.pib, pop.populacao, pib.pib / pop.populacao AS pib_per_capita,
               r.empregos, r.n_rem, r.massa / r.n_rem AS rem_media_dez
        FROM mun m LEFT JOIN pib USING (cod_ibge) LEFT JOIN pop USING (cod_ibge) LEFT JOIN rais r ON r.municipio = m.cod_ibge // 10""")
    cont = linhas(con, """SELECT count(*) AS municipios, count(DISTINCT cod_ibge) AS distintos,
                                 count(pib) AS com_pib, count(populacao) AS com_populacao, count(rem_media_dez) AS com_rais,
                                 count(*) FILTER (pib_per_capita IS NOT NULL AND rem_media_dez IS NOT NULL) AS pares,
                                 corr(pib_per_capita, rem_media_dez) AS pearson,
                                 corr(ln(pib_per_capita), ln(rem_media_dez)) AS pearson_log
                          FROM e""")[0]
    # Spearman: correlação de Pearson dos postos
    spear = linhas(con, """WITH p AS (SELECT * FROM e WHERE pib_per_capita IS NOT NULL AND rem_media_dez IS NOT NULL),
                           r AS (SELECT rank() OVER (ORDER BY pib_per_capita) AS a, rank() OVER (ORDER BY rem_media_dez) AS b FROM p)
                           SELECT corr(a, b) AS spearman FROM r""")[0]
    cont["spearman"] = spear["spearman"]
    rais_2025 = linhas(con, f"SELECT count(*) AS n FROM '{s}/ibge_pib.parquet' WHERE exercicio = 2025 AND pib IS NOT NULL")[0]["n"]
    return {"ano_comum": ano, "pib_2025_municipios": rais_2025, "estatisticas": cont,
            "municipios": linhas(con, "SELECT * FROM e ORDER BY cod_ibge")}


def referencia():
    con = conectar()
    return {"A": pergunta_a(con), "B": pergunta_b(con), "C": pergunta_c(con), "D": pergunta_d(con), "E": pergunta_e(con)}


# ---------------- comparação com a plataforma ----------------

def numero(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def achar(plataforma, periodo, valor, tol):
    """A célula mais próxima de valor entre os resultados das consultas da IA, nas linhas do período (ou em
    todas, se periodo for None). Devolve (valor, consulta, coluna) ou None."""
    melhor = None
    for c in plataforma.get("consultas", []):
        cols = c.get("colunas") or []
        for linha in c.get("linhas") or []:
            vals = [linha.get(k) if isinstance(linha, dict) else linha[i] for i, k in enumerate(cols)]
            if periodo is not None and not any(str(v) == str(periodo) for v in vals):
                continue
            for k, v in zip(cols, vals):
                x = numero(v)
                if x is None or (periodo is not None and str(v) == str(periodo)):
                    continue
                d = abs(x - valor) / max(1.0, abs(valor))
                if melhor is None or d < melhor[0]:
                    melhor = (d, x, c.get("id"), k)
    if melhor is None:
        return None
    # longe demais (mais de 2%): a plataforma não apresentou esse número, o que é diferente de divergir dele
    estado = "confere" if melhor[0] <= tol else "divergente" if melhor[0] <= 0.02 else "não apresentado"
    return {"valor": melhor[1], "consulta": melhor[2], "coluna": melhor[3], "estado": estado}


# indicador → (função que tira a lista [(período, valor)] da referência, tolerância relativa)
CONTAGEM, DINHEIRO, RAZAO = 0.0, 1e-6, 1e-4
COMPARAR = {
    "A": [
        ("municípios usados", lambda r: [(x["ano"], x["usados"]) for x in r["anos"]], CONTAGEM),
        ("FPM (R$ nominais)", lambda r: [(x["ano"], x["fpm"]) for x in r["anos"]], DINHEIRO),
        ("receita corrente (R$ nominais)", lambda r: [(x["ano"], x["receita_corrente"]) for x in r["anos"]], DINHEIRO),
        ("FPM (R$ milhões de dez/2025)", lambda r: [(x["ano"], x["fpm_real_mi"]) for x in r["anos"]], RAZAO),
        ("receita corrente (R$ milhões de dez/2025)", lambda r: [(x["ano"], x["rc_real_mi"]) for x in r["anos"]], RAZAO),
        ("FPM ÷ receita corrente, razão dos totais (%)", lambda r: [(x["ano"], x["razao_dos_totais_pct"]) for x in r["anos"]], RAZAO),
        ("média das razões municipais (%)", lambda r: [(x["ano"], x["media_das_razoes_pct"]) for x in r["anos"]], RAZAO),
        ("FPM per capita (R$ nominais)", lambda r: [(x["ano"], x["fpm_per_capita"]) for x in r["anos"]], RAZAO),
        ("FPM per capita (R$ reais)", lambda r: [(x["ano"], x["fpm_per_capita_real"]) for x in r["anos"]], RAZAO),
        ("receita corrente per capita (R$ nominais)", lambda r: [(x["ano"], x["rc_per_capita"]) for x in r["anos"]], RAZAO),
    ],
    "B": [
        ("vínculos ativos em 31/12", lambda r: [(x["ano"], x["ativos"]) for x in r["anos"]], CONTAGEM),
        ("vínculos ativos de mulheres", lambda r: [(x["ano"], x["ativos_mulheres"]) for x in r["anos"]], CONTAGEM),
        ("participação feminina (%)", lambda r: [(x["ano"], x["participacao_feminina_pct"]) for x in r["anos"]], RAZAO),
        ("remuneração média de dezembro (R$ nominais)", lambda r: [(x["ano"], x["rem_media"]) for x in r["anos"]], RAZAO),
        ("remuneração média de dezembro (R$ reais)", lambda r: [(x["ano"], x["rem_media_real"]) for x in r["anos"]], RAZAO),
        ("remuneração média, mulheres (R$ nominais)", lambda r: [(x["ano"], x["rem_media_mulheres"]) for x in r["anos"]], RAZAO),
        ("remuneração média, homens (R$ nominais)", lambda r: [(x["ano"], x["rem_media_homens"]) for x in r["anos"]], RAZAO),
        ("diferença mulheres − homens (R$ nominais)", lambda r: [(x["ano"], x["diferenca_mulheres_homens"]) for x in r["anos"]], RAZAO),
        ("mulheres ÷ homens − 1 (%)", lambda r: [(x["ano"], x["razao_mulheres_homens_pct"]) for x in r["anos"]], RAZAO),
    ],
    "C": [
        ("admissões", lambda r: [(x["competencia"], x["admissoes"]) for x in r["meses"]], CONTAGEM),
        ("desligamentos", lambda r: [(x["competencia"], x["desligamentos"]) for x in r["meses"]], CONTAGEM),
        ("saldo mensal", lambda r: [(x["competencia"], x["saldo"]) for x in r["meses"]], CONTAGEM),
        ("saldo acumulado no ano", lambda r: [(x["competencia"], x["saldo_acumulado"]) for x in r["meses"]], CONTAGEM),
        ("saldo jan–ago (total)", lambda r: [(None, r["totais_jan_ago"]["2025"]["saldo"] if "2025" in r["totais_jan_ago"] else r["totais_jan_ago"][2025]["saldo"]),
                                            (None, r["totais_jan_ago"]["2026"]["saldo"] if "2026" in r["totais_jan_ago"] else r["totais_jan_ago"][2026]["saldo"])], CONTAGEM),
    ],
    "D": [
        ("SIOPS despesa total com saúde (R$)", lambda r: [(None, next(x["valor"] for x in r["siops"] if x["codigo"] == "d_total"))], DINHEIRO),
        ("SIOPS despesa total com saúde por habitante", lambda r: [(None, next(x["valor"] for x in r["siops"] if x["codigo"] == "2.1"))], 1e-3),
        ("SIOPS receita própria aplicada (EC 29, %)", lambda r: [(None, next(x["valor"] for x in r["siops"] if x["codigo"] == "3.2"))], 1e-3),
        ("DCA função 10, empenhada (R$)", lambda r: [(None, r["comparacao"].get("Despesas Empenhadas", {}).get("dca_f10"))], DINHEIRO),
        ("DCA função 10, liquidada (R$)", lambda r: [(None, r["comparacao"].get("Despesas Liquidadas", {}).get("dca_f10"))], DINHEIRO),
        ("DCA função 10, paga (R$)", lambda r: [(None, r["comparacao"].get("Despesas Pagas", {}).get("dca_f10"))], DINHEIRO),
    ],
    "E": [
        ("municípios no cruzamento", lambda r: [(None, r["estatisticas"]["pares"])], CONTAGEM),
        ("correlação de Pearson", lambda r: [(None, r["estatisticas"]["pearson"])], 1e-3),
        ("correlação de Spearman", lambda r: [(None, r["estatisticas"]["spearman"])], 1e-3),
    ],
}


def comparar(ref, plataforma):
    saida = []
    for reg in plataforma:
        q = reg["id"].split("-")[0]
        for nome, tirar, tol in COMPARAR.get(q, []):
            try:
                pares = tirar(ref[q])
            except (KeyError, StopIteration):
                continue
            for per, v in pares:
                if v is None:
                    continue
                a = achar(reg, per, v, tol)
                saida.append({"pergunta": reg["id"], "indicador": nome, "periodo": per, "conferencia": v,
                              "plataforma": a and a["valor"], "onde": a and f'{a["consulta"]}.{a["coluna"]}',
                              "diferenca": a and a["valor"] - v, "estado": a["estado"] if a else "não apresentado"})
    return saida


def relatorio(linhas_cmp):
    fmt = lambda v: "–" if v is None else (f"{v:,.4f}" if isinstance(v, float) and abs(v) < 1000 else f"{v:,.2f}" if isinstance(v, float) else f"{v:,}")
    out = ["| pergunta | indicador | período | plataforma | conferência | diferença | onde | diagnóstico |", "|---|---|---|---|---|---|---|---|"]
    for r in linhas_cmp:
        out.append(f'| {r["pergunta"]} | {r["indicador"]} | {r["periodo"] or ""} | {fmt(r["plataforma"])} | {fmt(r["conferencia"])} | '
                   f'{fmt(r["diferenca"]) if r["estado"] != "não apresentado" else "–"} | {r["onde"] if r["estado"] != "não apresentado" else "–"} | {r["estado"]} |')
    return "\n".join(out)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--saida", required=True)
    p.add_argument("--plataforma")
    p.add_argument("--relatorio")
    p.add_argument("--so", help="perguntas, ex.: A,C")
    a = p.parse_args()
    caminho = Path(a.saida)
    if caminho.exists() and a.plataforma and not a.so:
        ref = json.loads(caminho.read_text(encoding="utf-8"))
    else:
        con = conectar()
        fns = {"A": pergunta_a, "B": pergunta_b, "C": pergunta_c, "D": pergunta_d, "E": pergunta_e}
        ref = json.loads(caminho.read_text(encoding="utf-8")) if caminho.exists() else {}
        for q in (a.so.split(",") if a.so else fns):
            ref[q] = fns[q](con)
            print(f"{q}: calculada", flush=True)
        caminho.write_text(json.dumps(ref, ensure_ascii=False, indent=1, default=float), encoding="utf-8")
    if a.plataforma:
        cmp = comparar(ref, json.loads(Path(a.plataforma).read_text(encoding="utf-8")))
        texto = relatorio(cmp)
        if a.relatorio:
            Path(a.relatorio).write_text(texto, encoding="utf-8")
        print(texto)


if __name__ == "__main__":
    main()
