"""Testes das regras da camada gold (rodar depois do gold.py). Sai com código 1 se algum falhar.

Uso:
    py pipeline/testes.py
"""
import json
import sys
from pathlib import Path

import duckdb

from config import GOLD, SILVER

g, s = GOLD.as_posix(), SILVER.as_posix()
con = duckdb.connect()
um = lambda sql: con.execute(sql).fetchone()[0]  # noqa: E731
falhas = []


def teste(nome, ok, detalhe=""):
    print(f"{'ok ' if ok else 'FALHOU'}  {nome}{'' if ok else f' — {detalhe}'}")
    if not ok:
        falhas.append(nome)


# Sinalizações
cats = {r[0] for r in con.execute(f"SELECT DISTINCT categoria FROM '{g}/alertas.parquet'").fetchall()}
teste("categorias de alerta conhecidas", cats <= {"ausente", "suspeita", "inconsistente", "validado", "confirmado"}, cats)
teste("só inconsistências e erros confirmados saem dos totais (suspeitas ficam)",
      um(f"SELECT count(*) FROM '{g}/alertas.parquet' WHERE exclui <> (categoria IN ('inconsistente', 'confirmado'))") == 0)
teste("suspeitas exigem o mínimo de anos na mediana",
      um(f"SELECT count(*) FROM '{g}/alertas.parquet' WHERE categoria = 'suspeita' AND n_obs < 5") == 0)
teste("inconsistência exige razão > 10 e valor acima do PIB",
      um(f"SELECT count(*) FROM '{g}/alertas.parquet' WHERE categoria = 'inconsistente' AND NOT (razao > 10 AND valor > pib)") == 0)
teste("a comparação usa valores reais (mediana_real preenchida)",
      um(f"SELECT count(*) FROM '{g}/alertas.parquet' WHERE categoria = 'suspeita' AND mediana_real IS NULL") == 0)

# Receita líquida e deduções
teste("receita líquida nunca maior que a bruta",
      um(f"SELECT count(*) FROM '{g}/indicadores.parquet' WHERE receita_liquida > receita_bruta + 0.01") == 0)
teste("deduções não negativas",
      um(f"SELECT count(*) FROM '{g}/indicadores.parquet' WHERE deducoes < 0") == 0)

# Cobertura e populações
teste("declarados + sem dados = universo do cadastro",
      um(f"SELECT count(*) FROM '{g}/escopos.parquet' WHERE tratamento = 'declarado' AND entes + sem_dados <> esperados") == 0)
teste("filtrado = declarado − excluídos",
      um(f"""SELECT count(*) FROM '{g}/escopos.parquet' f JOIN '{g}/escopos.parquet' d
             USING (exercicio, escopo, esfera, dominio)
             WHERE f.tratamento = 'filtrado' AND d.tratamento = 'declarado' AND f.entes <> d.entes - f.excluidos""") == 0)
teste("patrimônio nunca é excluído pelo filtro",
      um(f"SELECT count(*) FROM '{g}/escopos.parquet' WHERE dominio = 'patrimonio' AND excluidos <> 0") == 0)

# Árvore agregada: a visão filtrada não supera a declarada no total da receita bruta (nas colunas de
# dedução pode superar: a árvore mostra os valores como declarados, e alguns entes os declaram negativos)
teste("árvore: receita bruta filtrada ≤ declarada",
      um(f"""SELECT count(*) FROM '{g}/arvore.parquet' f JOIN '{g}/arvore.parquet' d
             USING (escopo, esfera, anexo, coluna, chave, exercicio)
             WHERE f.tratamento = 'filtrado' AND d.tratamento = 'declarado' AND f.anexo = 'I-C'
               AND f.coluna = 'Receitas Brutas Realizadas' AND f.chave = 'TotalReceitas' AND f.valor > d.valor + 1""") == 0)
teste("árvore: total de receitas filtrado = soma dos indicadores elegíveis (Brasil, municípios, 2025)",
      abs(um(f"""SELECT valor FROM '{g}/arvore.parquet' WHERE escopo = 'BR' AND esfera = 'M' AND tratamento = 'filtrado'
                 AND anexo = 'I-C' AND coluna = 'Receitas Brutas Realizadas' AND chave = 'TotalReceitas' AND exercicio = 2025""")
          - um(f"""SELECT sum(receita_bruta) FROM '{g}/indicadores.parquet' i WHERE esfera = 'M' AND exercicio = 2025
                   AND receita_bruta > 0 AND NOT EXISTS (SELECT 1 FROM '{g}/alertas.parquet' a WHERE a.exclui
                     AND a.dominio = 'receita' AND a.exercicio = i.exercicio AND a.cod_ibge = i.cod_ibge)""")) < 1)

# FPM: só a conta mais alta de cada período, e com a cota de 1% de dezembro em 2018–2021
mapa = json.loads((GOLD / "manifesto.json").read_text(encoding="utf-8"))["mapa_indicadores"]["fpm"]
chaves = {(m["chave"], m["de"], m["ate"]) for m in mapa}
teste("FPM 2018–2021 inclui a cota de dezembro (RO1.7.1.8.01.3)", ("RO1.7.1.8.01.3", 2018, 2021) in chaves, chaves)
teste("FPM sem conta-mãe e subconta ao mesmo tempo",
      not any(a != b and a.startswith(b + ".") and da <= ab and db <= aa
              for a, da, aa in chaves for b, db, ab in chaves))

# Ausência não vira zero
teste("Goiás (município) 2024: FPM nulo na gold (ausente na declaração)",
      um(f"SELECT fpm IS NULL FROM '{g}/indicadores.parquet' WHERE cod_ibge = 5208905 AND exercicio = 2024"))

# Transferências às famílias: só fontes oficiais
ind = f"'{g}/indicadores.parquet'"
teste("Bolsa Família e INSS só de fontes oficiais (nada do painel .dta)",
      um(f"""SELECT count(*) FROM {ind} WHERE bolsa_familia_fonte NOT LIKE 'Portal%' OR inss_fonte NOT LIKE 'Ministério%'""") == 0)
teste("gold sem colunas do painel .dta",
      not ({r[0] for r in con.execute(f"DESCRIBE SELECT * FROM {ind}").fetchall()}
           & {"area_km2", "distancia_capital_km", "gini", "renda_hora", "atividade_principal"}))
mensal = SILVER / "bolsa_familia_mensal"
if mensal.exists() and any(mensal.glob("*.parquet")):
    teste("mapa SIAFI→IBGE cobre todos os municípios dos pagamentos (exceto Fernando de Noronha)",
          um(f"""SELECT count(*) FROM (SELECT DISTINCT uf, siafi FROM '{mensal.as_posix()}/*.parquet') m
                 WHERE NOT EXISTS (SELECT 1 FROM read_csv('{(Path(__file__).resolve().parent / "siafi_ibge.csv").as_posix()}', all_varchar=true) k
                                   WHERE k.uf = m.uf AND k.siafi = m.siafi) AND m.siafi <> '3001'""") == 0)
    teste("valor anual oficial só com os 12 meses",
          um(f"""SELECT count(*) FROM {ind} i WHERE bolsa_familia_fonte LIKE 'Portal%' AND bolsa_familia_valor IS NOT NULL
                 AND (SELECT count(DISTINCT aaaamm) FROM '{mensal.as_posix()}/*.parquet' WHERE aaaamm // 100 = i.exercicio) < 12""") == 0)
    teste("famílias oficiais presentes nos municípios em dezembro",
          (um(f"SELECT count(*) FROM {ind} WHERE esfera = 'M' AND bolsa_familia_fonte LIKE 'Portal%' AND bolsa_familia_familias > 0") or 0) > 5000)
if (SILVER / "inss_municipios.parquet").exists():
    teste("INSS oficial: planilha com todos os municípios em cada ano",
          um(f"SELECT min(c) FROM (SELECT count(previdenciarios) c FROM '{s}/inss_municipios.parquet' GROUP BY exercicio)") == 5570)
    teste("INSS oficial chega a ≥ 99% dos municípios presentes na gold em cada ano com planilha",
          (um(f"""SELECT min(com / total) FROM (SELECT count(inss_beneficios) * 1.0 AS com, count(*) AS total FROM {ind}
                  WHERE esfera = 'M' AND exercicio IN (SELECT DISTINCT exercicio FROM '{s}/inss_municipios.parquet')
                  GROUP BY exercicio)""") or 0) >= 0.99)
    teste("anos sem planilha do INSS ficam vazios (sem preencher)",
          um(f"""SELECT count(*) FROM {ind} WHERE inss_beneficios IS NOT NULL
                 AND exercicio NOT IN (SELECT DISTINCT exercicio FROM '{s}/inss_municipios.parquet')""") == 0)

lrf = f"'{(GOLD / 'lrf.parquet').as_posix()}'"
if (GOLD / "lrf.parquet").exists():
    teste("LRF: uma linha por ente e exercício",
          um(f"SELECT count(*) - count(DISTINCT (exercicio, cod_ibge)) FROM {lrf}") == 0)
    teste("LRF: só a partir de 2015 (a API não tem RREO/RGF antes)", um(f"SELECT min(exercicio) FROM {lrf}") >= 2015)
    teste("LRF: percentuais de pessoal em pontos, entre 0 e 100 (no máximo 0,5% fora, erros de declaração)",
          (um(f"""SELECT count(*) FILTER (pessoal_rcl_pct < 0 OR pessoal_rcl_pct > 100) * 1.0 / greatest(count(pessoal_rcl_pct), 1)
                  FROM {lrf}""") or 0) <= 0.005)
    teste("LRF: limite de pessoal declarado é 54 (municípios) ou 49 (estados) na grande maioria",
          (um(f"""SELECT count(*) FILTER (pessoal_limite_pct IN (54, 49, 48.6, 60)) * 1.0 / greatest(count(pessoal_limite_pct), 1)
                  FROM {lrf}""") or 0) >= 0.95)
    teste("LRF: DTP ÷ RCL ajustada confere com o percentual declarado (±0,5 p.p.)",
          (um(f"""SELECT count(*) FILTER (abs(100 * despesa_pessoal / rcl_ajustada - pessoal_rcl_pct) > 0.5) * 1.0
                         / greatest(count(*), 1)
                  FROM {lrf} WHERE rcl_ajustada > 0 AND despesa_pessoal IS NOT NULL AND pessoal_rcl_pct IS NOT NULL""") or 0) <= 0.02)
    teste("LRF: todo ente-ano tem ao menos um dos relatórios",
          um(f"SELECT count(*) FROM {lrf} WHERE rreo_tipo IS NULL AND rgf_tipo IS NULL") == 0)

# População: a declarada na DCA (populacao) e a de referência do IBGE (populacao_ibge) são colunas distintas
if (SILVER / "ibge_populacao.parquet").exists():
    ind = f"'{g}/indicadores.parquet'"
    teste("população do IBGE em todos os entes com população declarada",
          um(f"SELECT count(*) FROM {ind} WHERE populacao IS NOT NULL AND populacao_ibge IS NULL") == 0)
    teste("população do IBGE é a do próprio ano (só 2023, sem publicação, usa o Censo 2022)",
          um(f"""SELECT count(*) FROM {ind} WHERE populacao_ibge_ano <> exercicio
                 AND NOT (exercicio = 2023 AND populacao_ibge_ano = 2022)""") == 0)
    teste("PIB per capita = PIB ÷ população do IBGE",
          um(f"SELECT count(*) FROM {ind} WHERE abs(pib_per_capita - pib / populacao_ibge) > 1e-6") == 0)
if (GOLD / "despesa_funcao.parquet").exists():
    teste("despesa por função: uma linha por ente, exercício e função",
          um(f"""SELECT count(*) FROM (SELECT exercicio, cod_ibge, funcao_cod FROM '{g}/despesa_funcao.parquet'
                 GROUP BY ALL HAVING count(*) > 1)""") == 0)
    teste("função 04 da tabela de funções = indicadores.despesa_administracao",
          um(f"""SELECT count(*) FROM '{g}/despesa_funcao.parquet' f JOIN '{g}/indicadores.parquet' i USING (exercicio, cod_ibge)
                 WHERE f.funcao_cod = 'F04' AND f.empenhada IS DISTINCT FROM i.despesa_administracao""") == 0)

m = json.loads((GOLD / "manifesto.json").read_text(encoding="utf-8"))
teste("manifesto com fontes, mapeamento e política", all(k in m for k in ("fontes", "mapa_indicadores", "politica_alertas", "ipca_ultimo")))

print(f"\n{len(falhas)} falha(s)")
sys.exit(1 if falhas else 0)
