"""RREO e RGF (fechamento do ano): landing → silver/lrf e gold/lrf.parquet.

silver/lrf/exercicio=AAAA.parquet  todas as linhas dos dois relatórios, como a API publica, ordenadas
                                   por ente (o site lê só o trecho de um ente, por Range)
gold/lrf.parquet                   indicadores da LRF por ente e exercício (uma linha por ente-ano):

  rcl, rcl_ajustada           Receita Corrente Líquida (RGF, anexo 1); a ajustada é a base dos limites
  despesa_pessoal             Despesa Total com Pessoal do Executivo (DTP, RGF anexo 1)
  pessoal_rcl_pct             DTP em % da RCL ajustada, como declarado
  pessoal_limite_pct          limite máximo do Executivo (54% municípios, 49% estados, salvo exceções)
  divida_consolidada, dcl     Dívida Consolidada e Dívida Consolidada Líquida (RGF anexo 2, fim do ano)
  dcl_rcl_pct                 DCL em % da RCL ajustada (limite do Senado: 120% municípios, 200% estados)
  resultado_primario          resultado primário do ano (RREO anexo 14; sem RPPS, acima da linha, quando houver)
  meta_primario               meta de resultado primário da LDO
  resultado_nominal
  saude_valor, saude_pct      ações e serviços públicos de saúde: valor e % aplicado (mínimo 15% municípios, 12% estados)
  mde_valor, mde_pct          manutenção e desenvolvimento do ensino: valor e % aplicado (mínimo 25%)
  fundeb_pct                  % do FUNDEB na remuneração dos profissionais da educação (mínimo 70%; 60% até 2020)
  rreo_tipo, rgf_tipo         demonstrativo entregue (completo ou simplificado) e periodicidade do RGF

Os percentuais são os declarados pelo ente; nos agregados, o site recalcula como soma ÷ soma.

Uso:  py pipeline/lrf.py
"""
import json
import os

import duckdb

from config import GOLD, LANDING, SILVER

COLUNAS = {
    "exercicio": "INTEGER", "cod_ibge": "BIGINT", "periodo": "INTEGER", "periodicidade": "VARCHAR",
    "demonstrativo": "VARCHAR", "tipo_demonstrativo": "VARCHAR", "populacao": "BIGINT", "anexo": "VARCHAR",
    "rotulo": "VARCHAR", "coluna": "VARCHAR", "cod_conta": "VARCHAR", "conta": "VARCHAR", "valor": "DOUBLE",
}


def anos_disponiveis():
    anos = set()
    for rel in ("rreo", "rgf"):
        for pasta in (LANDING / rel).glob("exercicio=*"):
            if any(pasta.glob("*.ndjson.gz")):
                anos.add(int(pasta.name.split("=")[1]))
    return sorted(anos)


def gerar_silver(con, ano):
    colunas = "{" + ", ".join(f"'{k}': '{v}'" for k, v in COLUNAS.items()) + "}"
    partes = []
    for rel in ("rreo", "rgf"):
        pasta = LANDING / rel / f"exercicio={ano}"
        if any(pasta.glob("*.ndjson.gz")):
            # ordem: posição da linha na resposta da API (a ordem do relatório), para o site montar o anexo
            partes.append(f"""
                SELECT '{rel.upper()}' AS relatorio, row_number() OVER (PARTITION BY filename) AS ordem, *
                FROM read_json('{pasta.as_posix()}/*.ndjson.gz', format='newline_delimited',
                               columns={colunas}, filename=true)""")
    destino = SILVER / "lrf" / f"exercicio={ano}.parquet"
    destino.parent.mkdir(parents=True, exist_ok=True)
    con.execute("SET preserve_insertion_order = true")
    novo = f"""
        SELECT exercicio, cod_ibge::INTEGER AS cod_ibge, relatorio,
               coalesce(tipo_demonstrativo, demonstrativo, relatorio) AS tipo_demonstrativo,
               periodo, periodicidade, populacao, anexo, ordem::INTEGER AS ordem, rotulo, coluna, cod_conta, conta, valor
        FROM ({' UNION ALL '.join(partes)})"""
    # na atualização mensal a landing só tem os entes que faltavam: os demais vêm da silver anterior
    antigo = (f"""UNION ALL SELECT * FROM '{destino.as_posix()}' a
                  WHERE NOT EXISTS (SELECT 1 FROM novo n WHERE n.relatorio = a.relatorio AND n.cod_ibge = a.cod_ibge)"""
              if destino.exists() else "")
    temporario = destino.with_suffix(".tmp")
    con.execute(f"""
        COPY (
            WITH novo AS ({novo})
            SELECT * FROM (SELECT * FROM novo {antigo})
            ORDER BY cod_ibge, relatorio, anexo, ordem
        ) TO '{temporario.as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 50000)""")
    os.replace(temporario, destino)
    n = con.execute(f"SELECT count(*), count(DISTINCT cod_ibge) FROM '{destino.as_posix()}'").fetchone()
    print(f"silver/lrf {ano}: {n[0]:,} linhas de {n[1]:,} entes")


# indicador -> (relatório, anexo, padrão de cod_conta, padrão de coluna). Vários padrões por indicador:
# vale o primeiro que existir no ente-ano (os nomes mudaram ao longo dos anos e entre as versões).
INDICADORES = {
    "rcl": [("RGF", "RGF-Anexo 01", "ReceitaCorrenteLiquidaLimiteLegal", "Valor"),
            ("RGF", "RGF-Anexo 02", "RGF2ReceitaCorrenteLiquida", "Até o %"),
            ("RREO", "RREO-Anexo 14", "ReceitaCorrenteLiquidaDemonstrativoSimplificado", "Até o Bimestre")],
    "rcl_ajustada": [("RGF", "RGF-Anexo 01", "ReceitaCorrenteLiquidaAjustada", "Valor")],
    "despesa_pessoal": [("RGF", "RGF-Anexo 01", "DespesaComPessoalTotal", "Valor")],
    "pessoal_rcl_pct": [("RGF", "RGF-Anexo 01", "DespesaComPessoalTotal", "% sobre a RCL%")],
    "pessoal_limite_pct": [("RGF", "RGF-Anexo 01", "LimiteMaximoDespesaComPessoalTotal", "% sobre a RCL%")],
    "divida_consolidada": [("RGF", "RGF-Anexo 02", "DividaConsolidada", "Até o 3º Quadrimestre"),
                           ("RGF", "RGF-Anexo 02", "DividaConsolidada", "Até o 2º Semestre")],
    "dcl": [("RGF", "RGF-Anexo 02", "DividaConsolidadaLiquida", "Até o 3º Quadrimestre"),
            ("RGF", "RGF-Anexo 02", "DividaConsolidadaLiquida", "Até o 2º Semestre")],
    "dcl_rcl_pct": [("RGF", "RGF-Anexo 02", "PercentualDaDCLSobreARCL", "Até o 3º Quadrimestre"),
                    ("RGF", "RGF-Anexo 02", "PercentualDaDCLSobreARCL", "Até o 2º Semestre")],
    "resultado_primario": [("RREO", "RREO-Anexo 14", "ResultadoPrimarioAcimaDaLinhaSemRPPS%", "Resultado Apurado%"),
                           ("RREO", "RREO-Anexo 14", "ResultadoPrimario%", "Resultado Apurado%")],
    "meta_primario": [("RREO", "RREO-Anexo 14", "ResultadoPrimarioAcimaDaLinhaSemRPPS%", "Meta Fixada%"),
                      ("RREO", "RREO-Anexo 14", "ResultadoPrimario%", "Meta Fixada%")],
    "resultado_nominal": [("RREO", "RREO-Anexo 14", "ResultadoNominalAbaixoDaLinhaSemRPPS%", "Resultado Apurado%"),
                          ("RREO", "RREO-Anexo 14", "ResultadoNominal%", "Resultado Apurado%")],
    "saude_valor": [("RREO", "RREO-Anexo 14", "AplicacaoTotalDasDespesasComAcoesEServicosPublicosDeSaude", "Valor Apurado%")],
    "saude_pct": [("RREO", "RREO-Anexo 14", "AplicacaoTotalDasDespesasComAcoesEServicosPublicosDeSaude", "% Aplicado%")],
    "mde_valor": [("RREO", "RREO-Anexo 14", "MinimoAnualDasReceitasDeImpostosNaManutencaoEDesenvolvimentoDoEnsino%", "Valor Apurado%")],
    "mde_pct": [("RREO", "RREO-Anexo 14", "MinimoAnualDasReceitasDeImpostosNaManutencaoEDesenvolvimentoDoEnsino%", "% Aplicado%")],
    "fundeb_pct": [("RREO", "RREO-Anexo 14", "MinimoAnualDoFUNDEBNaRemuneracao%", "% Aplicado%")],
}


def gerar_gold(con):
    """Uma linha por ente-ano; cada indicador pega o primeiro padrão que existir (prioridade)."""
    regras = ", ".join(
        f"('{ind}', {p}, '{rel}', '{anexo}', '{conta}', '{coluna}')"
        for ind, padroes in INDICADORES.items()
        for p, (rel, anexo, conta, coluna) in enumerate(padroes))
    con.execute(f"CREATE OR REPLACE TEMP TABLE regras(indicador, prioridade, relatorio, anexo, conta, coluna) AS VALUES {regras}")
    pivo = ", ".join(f"arg_min(valor, prioridade) FILTER (indicador = '{i}') AS {i}" for i in INDICADORES)
    s = (SILVER / "lrf").as_posix()
    con.execute(f"""
        COPY (
            WITH achados AS (
                SELECT l.exercicio, l.cod_ibge, r.indicador, r.prioridade,
                       -- se a mesma conta aparece mais de uma vez no padrão, vale a primeira em ordem alfabética
                       arg_min(l.valor, l.cod_conta || l.coluna) AS valor
                FROM '{s}/*.parquet' l
                JOIN regras r ON l.relatorio = r.relatorio AND l.anexo = r.anexo
                             AND l.cod_conta LIKE r.conta AND l.coluna ILIKE r.coluna
                WHERE l.valor IS NOT NULL
                GROUP BY ALL
            ),
            tipos AS (
                SELECT exercicio, cod_ibge, max(populacao) AS populacao_lrf,
                       any_value(tipo_demonstrativo) FILTER (relatorio = 'RREO') AS rreo_tipo,
                       any_value(tipo_demonstrativo || ' (' || periodicidade || ')') FILTER (relatorio = 'RGF') AS rgf_tipo
                FROM '{s}/*.parquet' GROUP BY ALL
            )
            SELECT t.exercicio, t.cod_ibge, e.nome, e.uf, e.regiao, e.esfera, t.populacao_lrf AS populacao,
                   t.rreo_tipo, t.rgf_tipo, i.* EXCLUDE (exercicio, cod_ibge)
            FROM tipos t
            JOIN '{SILVER.as_posix()}/entes.parquet' e USING (cod_ibge)
            LEFT JOIN (SELECT exercicio, cod_ibge, {pivo} FROM achados GROUP BY ALL) i USING (exercicio, cod_ibge)
            ORDER BY cod_ibge, exercicio
        ) TO '{GOLD.as_posix()}/lrf.parquet' (FORMAT parquet, COMPRESSION zstd)""")
    resumo = con.execute(f"""
        SELECT exercicio, count(*) AS entes, count(rcl) AS rcl, count(pessoal_rcl_pct) AS pessoal,
               count(dcl_rcl_pct) AS dcl, count(resultado_primario) AS primario, count(saude_pct) AS saude, count(mde_pct) AS mde
        FROM '{GOLD.as_posix()}/lrf.parquet' GROUP BY 1 ORDER BY 1""").fetchall()
    print("gold/lrf: exercício, entes, e quantos têm RCL, pessoal, DCL, primário, saúde, MDE")
    for r in resumo:
        print("  ", r)


def main():
    con = duckdb.connect()
    anos = anos_disponiveis()
    if not anos:
        print("lrf: sem dados em data/landing/rreo e rgf (rode extract_lrf.py)")
        return
    for ano in anos:
        gerar_silver(con, ano)
    gerar_gold(con)
    atualizar_manifesto(con)


def atualizar_manifesto(con):
    """Grava a cobertura do RREO/RGF no manifesto (o gold.py faz o mesmo ao gerar o manifesto inteiro)."""
    from gold import fonte_lrf

    caminho = GOLD / "manifesto.json"
    if not caminho.exists():
        return
    manifesto = json.loads(caminho.read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {}).update(fonte_lrf(con))
    caminho.write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
