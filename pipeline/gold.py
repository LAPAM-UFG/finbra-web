"""Silver → gold: tabelas prontas para o site.

  indicadores.parquet  um registro por ente e exercício: receitas, FPM, impostos,
                       despesas, PIB, população, faixa populacional e dados de pesquisa
  ipca.parquet         índice acumulado do IPCA (para valores reais em qualquer base)
  faixas.parquet       faixas populacionais (as mesmas do Power BI)

As contas que mudaram de código entre os ementários (até 2017, 2018–2021, 2022+)
são achadas pela descrição; fica só o nó mais alto que casar, para não somar pai e
filho. As que não mudaram usam a chave.

Uso:
    py pipeline/gold.py
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd

from config import GOLD, SILVER

BRUTA = "Receitas Brutas Realizadas"

# Receitas por descrição (o código mudou entre ementários)
POR_DESCRICAO = {
    # "do Municípios": grafia do ementário na cota de 1% de dezembro (2018–2021); sem ela a parcela ficava de fora
    "fpm": r"Fundo de Participação dos? Municípios",
    "icms": r"^Cota-Parte do (ICMS|Imposto sobre Operações Relativas à Circulação)",
    "ipva": r"^Cota-Parte do (IPVA|Imposto sobre a Propriedade de Veículos)",
    "iptu": r"^Imposto sobre a Propriedade Predial e Territorial Urbana",
    "iss": r"^Imposto sobre Serviços de Qualquer Natureza",
    "itbi": r"^Impostos? sobre (a )?Transmissão .{0,3}Inter Vivos",
}

# (anexo, coluna, chave) estáveis entre os anos
POR_CHAVE = {
    "receita_bruta": ("I-C", BRUTA, "TotalReceitas"),
    "receita_corrente": ("I-C", BRUTA, "RO1"),
    "receita_capital": ("I-C", BRUTA, "RO2"),
    "receita_impostos_taxas": ("I-C", BRUTA, "RO1.1"),
    "transferencias_correntes": ("I-C", BRUTA, "RO1.7"),
    "despesa_empenhada": ("I-D", "Despesas Empenhadas", "TotalDespesas"),
    "despesa_liquidada": ("I-D", "Despesas Liquidadas", "TotalDespesas"),
    "despesa_paga": ("I-D", "Despesas Pagas", "TotalDespesas"),
    "despesa_pessoal": ("I-D", "Despesas Empenhadas", "DO3.1"),
    "investimentos": ("I-D", "Despesas Empenhadas", "DO4.4"),
    "despesa_saude": ("I-E", "Despesas Empenhadas", "F10"),
    "despesa_educacao": ("I-E", "Despesas Empenhadas", "F12"),
    # saúde e educação nos outros estágios: para comparar com o SIOPS e o SIOPE sem presumir o estágio
    "despesa_saude_liquidada": ("I-E", "Despesas Liquidadas", "F10"),
    "despesa_saude_paga": ("I-E", "Despesas Pagas", "F10"),
    "despesa_educacao_liquidada": ("I-E", "Despesas Liquidadas", "F12"),
    "despesa_educacao_paga": ("I-E", "Despesas Pagas", "F12"),
    # I-E: as funções somam a despesa exceto intraorçamentária; é a base de saúde e educação
    "despesa_empenhada_sem_intra": ("I-E", "Despesas Empenhadas", "TotalExcetoIntra"),
    "despesa_liquidada_sem_intra": ("I-E", "Despesas Liquidadas", "TotalExcetoIntra"),
    "despesa_paga_sem_intra": ("I-E", "Despesas Pagas", "TotalExcetoIntra"),
    "despesa_intra": ("I-E", "Despesas Empenhadas", "TotalIntra"),
    "ativo": ("I-AB", "Saldo em 31/12", "P1"),
    "patrimonio_liquido": ("I-AB", "Saldo em 31/12", "P2.3"),
}

# Faixas populacionais do Power BI (limite superior exclusivo)
FAIXAS = [5_000, 10_000, 20_000, 30_000, 50_000, 80_000, 100_000, 150_000, 200_000, 300_000,
          400_000, 500_000, 750_000, 1_000_000, 1_500_000, 2_000_000, 3_000_000]


def tabela_faixas():
    linhas, inicio = [], 0
    for i, fim in enumerate(FAIXAS + [None], 1):
        rotulo = f"{inicio:,} a {fim - 1:,}".replace(",", ".") if fim else f"{inicio:,} ou mais".replace(",", ".")
        linhas.append((i, f"Grupo {i}", rotulo, inicio, fim))
        inicio = fim
    return pd.DataFrame(linhas, columns=["grupo", "nome", "faixa", "pop_min", "pop_max"])


# Política de valores atípicos (documentada no site, página Qualidade e fontes).
LIMITE_ATIPICO = 5        # suspeita: valor real mais de 5x acima ou abaixo da mediana real do próprio ente
MIN_OBSERVACOES = 5       # anos com valor positivo exigidos para a mediana ser comparável
LIMITE_INCONSISTENCIA = 10  # inconsistência objetiva: > 10x a mediana real E acima do PIB do município no ano
REVISOES = Path(__file__).resolve().parent / "alertas_revisados.csv"

# Domínio de cada anexo: um alerta de receita só afeta as contas de receita, e vice-versa
DOMINIO_ANEXO = {"I-C": "receita", "I-D": "despesa", "I-E": "despesa", "I-F": "despesa", "I-G": "despesa"}


def gerar_alertas(con):
    """Sinalizações por ente, exercício e indicador (receita bruta e despesa empenhada).

    Categorias (exclui = sai dos agregados de UF, Brasil, faixas e rankings):
      ausente        DCA sem o total (nulo ou ≤ 0): não é dado utilizável, fica fora das bases
      suspeita       razão em relação à mediana real do ente fora de [1/5, 5]: só sinalização, continua
                     nos agregados (pode ser crescimento legítimo: royalties, receitas extraordinárias)
      inconsistente  razão > 10 e valor acima do PIB municipal do mesmo ano (regra objetiva): exclui
      validado       revisado manualmente como legítimo (alertas_revisados.csv): não exclui
      confirmado     erro confirmado por revisão manual, com evidência registrada: exclui

    A comparação é do ente com ele mesmo, em R$ de preços constantes (IPCA), para que a
    inflação acumulada não pareça crescimento. Só o domínio do indicador é afetado: um alerta
    de receita não tira a despesa do mesmo ente-ano dos agregados.
    """
    g, s = GOLD.as_posix(), SILVER.as_posix()
    base = con.execute(f"SELECT max(exercicio) FROM '{s}/ipca.parquet' WHERE completo").fetchone()[0]
    con.execute("CREATE OR REPLACE TABLE revisoes (cod_ibge BIGINT, exercicio BIGINT, indicador VARCHAR, "
                "categoria VARCHAR, evidencia VARCHAR, fonte VARCHAR, revisado_em VARCHAR)")
    if REVISOES.exists():
        rev = pd.read_csv(REVISOES, dtype=str).fillna("")
        rev = rev[rev.categoria.isin(["validado", "confirmado"])]
    if REVISOES.exists() and len(rev):
        con.executemany("INSERT INTO revisoes VALUES (?, ?, ?, ?, ?, ?, ?)",
                        [(int(r.cod_ibge), int(r.exercicio), r.indicador, r.categoria, r.evidencia, r.fonte, r.revisado_em)
                         for r in rev.itertuples()])
    con.execute(f"""
        COPY (
            WITH i AS (
                SELECT exercicio, cod_ibge, nome, uf, esfera, pib, 'receita_bruta' AS indicador, 'receita' AS dominio,
                       receita_bruta AS valor
                FROM '{g}/indicadores.parquet'
                UNION ALL
                SELECT exercicio, cod_ibge, nome, uf, esfera, pib, 'despesa_empenhada', 'despesa', despesa_empenhada
                FROM '{g}/indicadores.parquet'),
            r AS (
                SELECT i.*, i.valor * b.indice / p.indice AS valor_real
                FROM i JOIN '{s}/ipca.parquet' p USING (exercicio)
                CROSS JOIN (SELECT indice FROM '{s}/ipca.parquet' WHERE exercicio = {base}) b),
            m AS (SELECT cod_ibge, indicador, median(valor_real) FILTER (valor_real > 0) AS mediana_real,
                         count(*) FILTER (valor_real > 0) AS n_obs
                  FROM r GROUP BY ALL),
            c AS (
                SELECT r.*, m.mediana_real, m.n_obs, r.valor_real / m.mediana_real AS razao,
                       CASE WHEN coalesce(r.valor, 0) <= 0 THEN 'ausente'
                            WHEN r.valor_real / m.mediana_real > {LIMITE_INCONSISTENCIA} AND r.pib > 0 AND r.valor > r.pib
                                 THEN 'inconsistente'
                            ELSE 'suspeita' END AS estatistica
                FROM r JOIN m USING (cod_ibge, indicador)
                WHERE coalesce(r.valor, 0) <= 0
                   OR (m.n_obs >= {MIN_OBSERVACOES}
                       AND (r.valor_real / m.mediana_real > {LIMITE_ATIPICO} OR r.valor_real / m.mediana_real < 1.0 / {LIMITE_ATIPICO})))
            SELECT c.exercicio, c.cod_ibge, c.nome, c.uf, c.esfera, c.indicador, c.dominio, c.valor, c.valor_real,
                   c.mediana_real, c.razao, c.n_obs, c.pib,
                   coalesce(v.categoria, c.estatistica) AS categoria,
                   CASE WHEN c.estatistica = 'ausente' THEN 'não declarado'
                        WHEN c.razao > 1 THEN 'muito acima do habitual' ELSE 'muito abaixo do habitual' END AS motivo,
                   CASE coalesce(v.categoria, c.estatistica)
                        WHEN 'ausente' THEN 'total do indicador nulo ou ≤ 0 na DCA'
                        WHEN 'inconsistente' THEN 'valor real > {LIMITE_INCONSISTENCIA}× a mediana real do ente e acima do PIB municipal do ano'
                        WHEN 'suspeita' THEN 'valor real fora de 1/{LIMITE_ATIPICO} a {LIMITE_ATIPICO}× a mediana real do ente (mín. {MIN_OBSERVACOES} anos)'
                        ELSE 'revisão manual' END AS regra,
                   v.evidencia, v.fonte, v.revisado_em,
                   coalesce(v.categoria, c.estatistica) IN ('inconsistente', 'confirmado') AS exclui
            FROM c LEFT JOIN revisoes v USING (cod_ibge, exercicio, indicador)
            ORDER BY exercicio, cod_ibge, indicador
        ) TO '{g}/alertas.parquet' (FORMAT parquet)
    """)
    for cat, n, entes in con.execute(f"SELECT categoria, count(*), count(DISTINCT (exercicio, cod_ibge)) "
                                     f"FROM '{g}/alertas.parquet' GROUP BY 1 ORDER BY 1").fetchall():
        print(f"alertas: {cat}: {n} registros em {entes} ente-anos")


def gerar_web(con):
    """Tabelas que o site lê direto do R2, no navegador (DuckDB-WASM).

    O navegador faz uma leitura por vez e cada ida ao R2 custa ~250 ms, então o que importa é
    o número de requisições: cada consulta do site deve caber em um arquivo e em poucos blocos.

    entes/uf=XX.parquet  valores de cada ente em todos os anos, um arquivo por UF, ordenado por ente
                         (árvore e série histórica de um ente)
    arvore.parquet       soma de cada conta por escopo (Brasil e UFs), esfera e tratamento, todos os anos
                         (árvore e série de UF/Brasil). tratamento 'filtrado' (o que o site usa) tira as
                         inconsistências e erros confirmados (alertas.parquet, exclui = true) só no domínio
                         do alerta (receita: I-C; despesa: I-D a I-G); 'declarado' soma todas as declarações
                         com dados no domínio, para medir o impacto das exclusões
    escopos.parquet      população e número de entes de cada escopo, domínio e tratamento, com o
                         universo do cadastro, os ausentes e os excluídos
    manifesto.json       exercícios, colunas por anexo, base do IPCA, fontes e mapeamento dos indicadores
    """
    s, g = SILVER.as_posix(), GOLD.as_posix()
    # Entes com dados utilizáveis em cada domínio: o mesmo conjunto entra no numerador (soma das
    # contas) e no denominador (população), para o per capita agregado ser um quociente coerente.
    con.execute(f"""
        CREATE OR REPLACE TABLE validos AS
        WITH ind AS (SELECT * FROM '{g}/indicadores.parquet'),
        patrimonio AS (SELECT DISTINCT exercicio, cod_ibge FROM '{s}/dca/*.parquet' WHERE anexo IN ('I-AB', 'I-HI')),
        dom AS (
            SELECT exercicio, cod_ibge, 'receita' AS dominio FROM ind WHERE receita_bruta > 0
            UNION ALL SELECT exercicio, cod_ibge, 'despesa' FROM ind WHERE despesa_empenhada > 0
            UNION ALL SELECT exercicio, cod_ibge, 'patrimonio' FROM patrimonio),
        trat AS (
            SELECT *, 'declarado' AS tratamento FROM dom
            UNION ALL
            SELECT *, 'filtrado' FROM dom
            WHERE NOT EXISTS (SELECT 1 FROM '{g}/alertas.parquet' a
                              WHERE a.exclui AND a.exercicio = dom.exercicio AND a.cod_ibge = dom.cod_ibge
                                AND a.dominio = dom.dominio))
        SELECT t.*, p.populacao, e.uf, e.esfera
        FROM trat t JOIN '{s}/populacao/*.parquet' p USING (exercicio, cod_ibge)
        JOIN '{s}/entes.parquet' e USING (cod_ibge)
    """)
    anos = [r[0] for r in con.execute("SELECT DISTINCT exercicio FROM validos ORDER BY 1").fetchall()]
    dominio_anexo = " ".join(f"WHEN '{a}' THEN '{d}'" for a, d in DOMINIO_ANEXO.items())

    con.execute(f"""
        COPY (
            WITH d AS (
                SELECT d.exercicio, d.anexo, d.coluna, d.chave, d.valor, v.uf, v.esfera, v.tratamento
                FROM '{s}/dca/*.parquet' d
                JOIN validos v ON v.exercicio = d.exercicio AND v.cod_ibge = d.cod_ibge
                              AND v.dominio = CASE d.anexo {dominio_anexo} ELSE 'patrimonio' END)
            SELECT escopo, esfera, tratamento, anexo, coluna, chave, exercicio::SMALLINT AS exercicio,
                   sum(valor) AS valor, count(*)::INTEGER AS entes
            FROM (SELECT *, 'BR' AS escopo FROM d
                  UNION ALL
                  SELECT *, uf AS escopo FROM d WHERE esfera = 'M')
            GROUP BY ALL
            ORDER BY escopo, esfera, tratamento, anexo, coluna, chave, exercicio
        ) TO '{g}/arvore.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)
    """)

    (GOLD / "entes").mkdir(exist_ok=True)
    ufs = [r[0] for r in con.execute(f"SELECT DISTINCT uf FROM '{s}/entes.parquet' WHERE uf IS NOT NULL ORDER BY 1").fetchall()]
    for uf in ufs:
        con.execute(f"""
            COPY (
                SELECT d.cod_ibge, d.exercicio::SMALLINT AS exercicio, d.anexo, d.coluna, d.chave,
                       d.valor, d.sintetico
                FROM '{s}/dca/*.parquet' d JOIN '{s}/entes.parquet' e USING (cod_ibge)
                WHERE e.uf = '{uf}' AND d.tipo <> 'atributo'
                ORDER BY d.cod_ibge, d.exercicio, d.anexo, d.coluna, d.chave
            ) TO '{g}/entes/uf={uf}.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)
        """)

    colunas = {}
    for ano, anexo, coluna in con.execute(f"""
            SELECT exercicio, anexo, coluna FROM '{s}/dca/*.parquet'
            GROUP BY ALL ORDER BY exercicio, anexo, count(*) DESC""").fetchall():
        colunas.setdefault(str(ano), {}).setdefault(anexo, []).append(coluna)

    # Universo esperado: entes do cadastro do SICONFI (o cadastro é o atual; municípios criados
    # depois de 2013 aparecem no universo de todos os anos). Brasília consta como município,
    # mas as contas do DF são declaradas pelo ente Distrito Federal.
    con.execute(f"""
        COPY (
            WITH v AS (
                SELECT exercicio, 'BR' AS escopo, esfera, dominio, tratamento, populacao, cod_ibge FROM validos
                UNION ALL
                SELECT exercicio, uf, esfera, dominio, tratamento, populacao, cod_ibge FROM validos WHERE esfera = 'M'),
            cad AS (
                SELECT 'BR' AS escopo, esfera, count(*) AS esperados FROM '{s}/entes.parquet' GROUP BY ALL
                UNION ALL
                SELECT uf, esfera, count(*) FROM '{s}/entes.parquet' WHERE esfera = 'M' GROUP BY ALL),
            agg AS (
                SELECT exercicio, escopo, esfera, dominio, tratamento, sum(populacao) AS populacao,
                       count(*)::INTEGER AS entes, count(*) FILTER (coalesce(populacao, 0) <= 0)::INTEGER AS sem_populacao
                FROM v GROUP BY ALL)
            SELECT a.*, c.esperados::INTEGER AS esperados,
                   (d.entes - a.entes)::INTEGER AS excluidos,
                   (c.esperados - d.entes)::INTEGER AS sem_dados
            FROM agg a
            JOIN agg d ON d.exercicio = a.exercicio AND d.escopo = a.escopo AND d.esfera = a.esfera
                      AND d.dominio = a.dominio AND d.tratamento = 'declarado'
            LEFT JOIN cad c ON c.escopo = a.escopo AND c.esfera = a.esfera
            ORDER BY ALL
        ) TO '{g}/escopos.parquet' (FORMAT parquet)
    """)
    base = con.execute(f"SELECT max(exercicio) FROM '{s}/ipca.parquet' WHERE completo").fetchone()[0]
    ultimo_ipca = con.execute(f"SELECT exercicio, meses FROM '{s}/ipca.parquet' ORDER BY exercicio DESC LIMIT 1").fetchone()
    manifesto = {
        "gerado_em": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "anos": anos,
        "base_ipca": base,
        "ipca_ultimo": {"exercicio": ultimo_ipca[0], "meses": ultimo_ipca[1]},
        "colunas": colunas,
        "fontes": fontes(con),
        "mapa_indicadores": mapa_indicadores(con),
        "politica_alertas": {
            "limite_suspeita": LIMITE_ATIPICO, "min_observacoes": MIN_OBSERVACOES,
            "limite_inconsistencia": LIMITE_INCONSISTENCIA, "precos": f"IPCA, R$ de {base}",
        },
    }
    (GOLD / "manifesto.json").write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")
    tamanho = (GOLD / "arvore.parquet").stat().st_size / 1e6
    por_uf = sum(f.stat().st_size for f in (GOLD / "entes").glob("*.parquet")) / 1e6
    print(f"web: árvore agregada ({tamanho:.1f} MB), entes por UF ({len(ufs)} arquivos, {por_uf:.0f} MB), "
          f"escopos e manifesto")


def tabela_familias(con):
    """Bolsa Família e INSS por município e ano, das fontes oficiais (familias.py).

    bolsa_familia_familias  famílias pagas em dezembro          bolsa_familia_valor  total pago no ano
    inss_beneficios         benefícios previdenciários emitidos em dezembro (sem os assistenciais)
    O valor anual só entra com os 12 meses agregados e sem meses de Auxílio Brasil (os arquivos dele
    não trazem o Benefício Extraordinário); o programa e a fonte vão junto. Anos sem planilha do INSS
    ficam vazios.
    """
    s = SILVER.as_posix()
    mensal = SILVER / "bolsa_familia_mensal"
    if mensal.exists() and any(mensal.glob("*.parquet")):
        bf = f"""
            WITH m AS (SELECT m.*, k.cod_ibge, m.aaaamm // 100 AS exercicio, m.aaaamm % 100 AS mes
                       FROM '{mensal.as_posix()}/*.parquet' m
                       JOIN read_csv('{(Path(__file__).resolve().parent / "siafi_ibge.csv").as_posix()}', all_varchar=true) k
                         ON k.uf = m.uf AND k.siafi = m.siafi)
            SELECT cod_ibge::BIGINT // 10 AS cod_ibge6, exercicio,
                   sum(familias) FILTER (mes = 12) AS familias, sum(valor) AS valor,
                   count(DISTINCT mes) AS meses, string_agg(DISTINCT programa, ' + ' ORDER BY programa) AS programa
            FROM m GROUP BY ALL"""
    else:
        bf = "SELECT NULL::BIGINT AS cod_ibge6, NULL::BIGINT AS exercicio, NULL::DOUBLE AS familias, NULL::DOUBLE AS valor, NULL::BIGINT AS meses, NULL::VARCHAR AS programa WHERE false"
    inss = (f"SELECT cod_ibge // 10 AS cod_ibge6, exercicio, previdenciarios, aposentadorias, pensoes FROM '{s}/inss_municipios.parquet'"
            if (SILVER / "inss_municipios.parquet").exists()
            else "SELECT NULL::BIGINT AS cod_ibge6, NULL::BIGINT AS exercicio, NULL::DOUBLE AS previdenciarios, NULL::DOUBLE AS aposentadorias, NULL::DOUBLE AS pensoes WHERE false")
    con.execute(f"""
        CREATE OR REPLACE TABLE familias AS
        WITH bf AS ({bf}), inss AS ({inss}),
        bolsa AS (
            -- valor anual só com 12 meses e sem meses de Auxílio Brasil: os arquivos dele trazem só o benefício
            -- regular, sem o Benefício Extraordinário que completava o mínimo (R$ 400; R$ 600 desde ago/2022)
            SELECT cod_ibge6, exercicio, familias,
                   CASE WHEN meses = 12 AND programa NOT LIKE '%Auxílio Brasil%' THEN valor END AS valor, programa,
                   'Portal da Transparência (CGU), pagamentos' AS fonte
            FROM bf),
        beneficios AS (SELECT *, 'Ministério da Previdência, benefícios emitidos por município' AS fonte FROM inss)
        SELECT cod_ibge6, exercicio,
               b.familias AS bolsa_familia_familias, b.valor AS bolsa_familia_valor,
               b.programa AS bolsa_familia_programa, b.fonte AS bolsa_familia_fonte,
               i.previdenciarios AS inss_beneficios, i.aposentadorias AS inss_aposentadorias,
               i.pensoes AS inss_pensoes, i.fonte AS inss_fonte
        FROM bolsa b FULL JOIN beneficios i USING (cod_ibge6, exercicio)
    """)
    for fonte, anos in con.execute("""SELECT bolsa_familia_fonte, list(DISTINCT exercicio ORDER BY exercicio)
                                      FROM familias WHERE bolsa_familia_fonte IS NOT NULL GROUP BY 1""").fetchall():
        print(f"bolsa família: {fonte}: {anos}")


def _quando(caminho: Path) -> str | None:
    arquivos = [caminho] if caminho.is_file() else list(caminho.glob("*.parquet"))
    if not arquivos:
        return None
    return datetime.fromtimestamp(max(a.stat().st_mtime for a in arquivos), timezone.utc).isoformat(timespec="seconds")


def fontes(con):
    """Cobertura e data de processamento de cada base, para a página de fontes."""
    s = SILVER.as_posix()
    dca = con.execute(f"SELECT min(exercicio), max(exercicio) FROM '{s}/dca/*.parquet'").fetchone()
    pib = con.execute(f"SELECT min(exercicio), max(exercicio), max(exercicio) FILTER (vab_servicos IS NOT NULL) "
                      f"FROM '{s}/ibge_pib.parquet'").fetchone()
    ipca = con.execute(f"SELECT exercicio, meses FROM '{s}/ipca.parquet' ORDER BY exercicio DESC LIMIT 1").fetchone()
    bf = con.execute("SELECT min(exercicio), max(exercicio) FROM familias WHERE bolsa_familia_fonte LIKE 'Portal%'").fetchone()
    inss = con.execute("SELECT min(exercicio), max(exercicio) FROM familias WHERE inss_fonte LIKE 'Ministério%'").fetchone()
    mensal = SILVER / "bolsa_familia_mensal"
    ultimo_mes = max((int(a.stem) for a in mensal.glob("*.parquet")), default=None) if mensal.exists() else None
    return {
        "siconfi": {"anos": [dca[0], dca[1]], "processado_em": _quando(SILVER / "dca"),
                    "url": "https://apidatalake.tesouro.gov.br/docs/siconfi/"},
        "ibge_pib": {"anos": [pib[0], pib[1]], "setorial_ate": pib[2], "processado_em": _quando(SILVER / "ibge_pib.parquet"),
                     "url": "https://sidra.ibge.gov.br/tabela/5938"},
        "ipca": {"ultimo": ipca[0], "meses": ipca[1], "processado_em": _quando(SILVER / "ipca.parquet"),
                 "url": "https://www3.bcb.gov.br/sgspub/consultarvalores/telaCvsSelecionarSeries.paint?codigoSerie=433"},
        "bolsa_familia": {"anos": [bf[0], bf[1]] if bf[0] else None, "ultimo_mes": ultimo_mes,
                          "processado_em": _quando(mensal) if mensal.exists() else None,
                          "url": "https://portaldatransparencia.gov.br/download-de-dados/novo-bolsa-familia"},
        "inss": {"anos": [inss[0], inss[1]] if inss[0] else None,
                 "exercicios": [r[0] for r in con.execute(
                     "SELECT DISTINCT exercicio FROM familias WHERE inss_fonte IS NOT NULL ORDER BY 1").fetchall()],
                 "processado_em": _quando(SILVER / "inss_municipios.parquet"),
                 "url": "https://www.gov.br/previdencia/pt-br/assuntos/previdencia-social/emitidos-municipios-2023"},
        **fonte_lrf(con),
        **fonte_trabalho(con),
        **fonte_educacao_saude(con),
    }


def fonte_educacao_saude(con):
    """SIOPE e SIOPS (siope.py e siops.py): anos disponíveis; vazio se ainda não processados."""
    from siope import fonte_siope
    from siops import fonte_siops

    return {**fonte_siope(con), **fonte_siops(con)}


def fonte_trabalho(con):
    """RAIS e Novo CAGED (trabalho.py): anos e meses disponíveis; vazio se ainda não processados."""
    pasta = GOLD / "trabalho"
    saida = {}
    if (pasta / "municipios.parquet").exists():
        anos = [r[0] for r in con.execute(
            f"SELECT DISTINCT ano FROM '{(pasta / 'municipios.parquet').as_posix()}' ORDER BY 1").fetchall()]
        saida["rais"] = {"anos": anos, "processado_em": _quando(pasta / "municipios.parquet"),
                         "url": "ftp://ftp.mtps.gov.br/pdet/microdados/RAIS/"}
    if (pasta / "caged_uf.parquet").exists():
        de, ate = con.execute(f"SELECT min(competencia), max(competencia) FROM '{(pasta / 'caged_uf.parquet').as_posix()}'").fetchone()
        saida["caged"] = {"de": de, "ate": ate, "processado_em": _quando(pasta / "caged_uf.parquet"),
                          "url": "ftp://ftp.mtps.gov.br/pdet/microdados/NOVO%20CAGED/"}
    # consulta personalizada (microdados.py): anos com as tabelas pré-somadas da RAIS
    anos_cubo = sorted(int(p.stem[4:]) for p in (pasta / "cubo_uf").glob("ano=*.parquet"))
    if anos_cubo:
        saida["rais_micro"] = {"anos": anos_cubo, "processado_em": _quando(pasta / "cubo_uf" / f"ano={anos_cubo[-1]}.parquet")}
    return saida


def fonte_lrf(con):
    """RREO e RGF (lrf.py): exercícios e entes com cada relatório; vazio se ainda não processados.

    Só entram os exercícios com relatório de pelo menos 90% dos entes: uma extração parcial (amostra de
    teste, carga interrompida) não é anunciada no manifesto, que é o que o site e a IA leem."""
    arquivo = GOLD / "lrf.parquet"
    if not arquivo.exists():
        return {}
    esperados = con.execute(f"SELECT count(*) FROM '{SILVER.as_posix()}/entes.parquet' WHERE esfera IN ('M', 'E', 'D')").fetchone()[0]
    por_ano = con.execute(f"""SELECT exercicio, count(rreo_tipo)::INTEGER, count(rgf_tipo)::INTEGER
                              FROM '{arquivo.as_posix()}' GROUP BY 1
                              HAVING count(*) FILTER (rreo_tipo IS NOT NULL OR rgf_tipo IS NOT NULL) >= 0.9 * {esperados}
                              ORDER BY 1""").fetchall()
    if not por_ano:
        return {}
    return {"siconfi_lrf": {"anos": [por_ano[0][0], por_ano[-1][0]] if por_ano else None,
                            "exercicios": [r[0] for r in por_ano],
                            "entes": {str(r[0]): {"rreo": r[1], "rgf": r[2]} for r in por_ano},
                            "processado_em": _quando(arquivo),
                            "url": "https://apidatalake.tesouro.gov.br/docs/siconfi/"}}


def mapa_indicadores(con):
    """Conta usada por indicador em cada período (os códigos mudaram em 2018 e 2022)."""
    linhas = con.execute("""
        SELECT indicador, chave, any_value(descricao) AS descricao, min(exercicio) AS de, max(exercicio) AS ate
        FROM topo GROUP BY indicador, chave ORDER BY indicador, de, chave
    """).fetchall()
    mapa = {}
    for ind, chave, desc, de, ate in linhas:
        mapa.setdefault(ind, []).append({"chave": chave, "descricao": desc, "de": de, "ate": ate})
    for ind, (anexo, coluna, chave) in POR_CHAVE.items():
        mapa[ind] = [{"anexo": anexo, "coluna": coluna, "chave": chave}]
    return mapa


def main():
    GOLD.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    s = SILVER.as_posix()
    con.execute(f"CREATE VIEW dca AS SELECT * FROM '{s}/dca/*.parquet'")
    con.execute(f"CREATE VIEW contas AS SELECT * FROM '{s}/contas/*.parquet'")

    # Tabelas auxiliares nativas do DuckDB: registrar DataFrames do pandas (con.register)
    # trava o processo em consultas grandes e paralelas (erro de GIL no duckdb-python).
    faixas = tabela_faixas()
    con.execute("CREATE TABLE regras (indicador VARCHAR, regex VARCHAR)")
    con.executemany("INSERT INTO regras VALUES (?, ?)", list(POR_DESCRICAO.items()))
    con.execute("CREATE TABLE chaves (indicador VARCHAR, anexo VARCHAR, coluna VARCHAR, chave VARCHAR)")
    con.executemany("INSERT INTO chaves VALUES (?, ?, ?, ?)", [(k, *v) for k, v in POR_CHAVE.items()])
    con.execute("CREATE TABLE faixas (grupo INTEGER, nome VARCHAR, faixa VARCHAR, pop_min BIGINT, pop_max BIGINT)")
    con.executemany("INSERT INTO faixas VALUES (?, ?, ?, ?, ?)",
                    [tuple(None if pd.isna(v) else v for v in r) for r in faixas.itertuples(index=False)])

    # Só o nó mais alto de cada indicador (ex.: a conta do FPM, e não ela e as subcontas de cota
    # mensal e extraordinária), para não somar pai e filhos.
    con.execute("""
        CREATE TABLE topo AS
        WITH casadas AS (
            SELECT c.exercicio, c.chave, c.descricao, r.indicador
            FROM contas c JOIN regras r ON regexp_matches(c.descricao, r.regex, 'i')
            WHERE c.anexo = 'I-C' AND c.chave LIKE 'RO%'
        )
        SELECT * FROM casadas a
        WHERE NOT EXISTS (SELECT 1 FROM casadas b
                          WHERE b.exercicio = a.exercicio AND b.indicador = a.indicador
                            AND starts_with(a.chave, b.chave || '.'))
    """)
    # Deduções: as colunas de dedução são reduções da receita por definição. Alguns entes as
    # declaram com sinal negativo; usar o valor absoluto evita aplicar o sinal duas vezes na
    # receita líquida (o validate.py conta esses casos).
    con.execute(f"""
        CREATE TABLE longo AS
        SELECT d.exercicio, d.cod_ibge, t.indicador, sum(d.valor) AS valor
        FROM dca d JOIN topo t USING (exercicio, chave)
        WHERE d.anexo = 'I-C' AND d.coluna = '{BRUTA}'
        GROUP BY ALL
        UNION ALL
        SELECT d.exercicio, d.cod_ibge, k.indicador, sum(d.valor)
        FROM dca d JOIN chaves k USING (anexo, coluna, chave)
        GROUP BY ALL
        UNION ALL
        SELECT exercicio, cod_ibge, 'deducoes', sum(abs(valor))
        FROM dca WHERE anexo = 'I-C' AND chave = 'TotalReceitas' AND coluna <> '{BRUTA}'
        GROUP BY ALL
    """)
    indicadores = list(POR_DESCRICAO) + list(POR_CHAVE) + ["deducoes"]
    colunas = ", ".join(f"sum(valor) FILTER (indicador = '{i}') AS {i}" for i in indicadores)
    con.execute(f"CREATE TABLE largo AS SELECT exercicio, cod_ibge, {colunas} FROM longo GROUP BY ALL")

    tabela_familias(con)
    con.execute(f"""
        COPY (
            SELECT p.exercicio, p.cod_ibge, e.nome, e.uf, e.regiao, e.esfera, e.capital, p.populacao,
                   f.grupo AS faixa_grupo, i.* EXCLUDE (exercicio, cod_ibge),
                   i.receita_bruta - coalesce(i.deducoes, 0) AS receita_liquida,
                   g.pib, g.vab_agropecuaria, g.vab_industria, g.vab_servicos, g.vab_adm_publica,
                   t.* EXCLUDE (exercicio, cod_ibge6)
            FROM '{s}/populacao/*.parquet' p
            JOIN '{s}/entes.parquet' e USING (cod_ibge)
            LEFT JOIN largo i USING (exercicio, cod_ibge)
            LEFT JOIN faixas f ON e.esfera = 'M' AND p.populacao >= f.pop_min
                               AND (f.pop_max IS NULL OR p.populacao < f.pop_max)
            LEFT JOIN '{s}/ibge_pib.parquet' g USING (exercicio, cod_ibge)
            -- transferências às famílias: municípios e o DF (que recebe os pagamentos registrados em Brasília)
            LEFT JOIN familias t ON t.exercicio = p.exercicio
                                 AND t.cod_ibge6 = CASE WHEN e.esfera = 'D' THEN 530010 ELSE p.cod_ibge // 10 END
                                 AND e.esfera IN ('M', 'D')
            ORDER BY p.cod_ibge, p.exercicio
        ) TO '{GOLD.as_posix()}/indicadores.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)
    """)
    gerar_alertas(con)
    gerar_web(con)
    con.execute(f"COPY (SELECT * FROM '{s}/ipca.parquet') TO '{GOLD.as_posix()}/ipca.parquet' (FORMAT parquet)")
    faixas.to_parquet(GOLD / "faixas.parquet", index=False)

    n, anos = con.execute(f"SELECT count(*), list(DISTINCT exercicio ORDER BY exercicio) "
                          f"FROM '{GOLD.as_posix()}/indicadores.parquet'").fetchone()
    print(f"indicadores: {n:,} registros | exercícios {anos}")


if __name__ == "__main__":
    main()
