"""Educação: SIOPE (FNDE) → silver/siope e gold/siope.

API OData do FNDE (Olinda), uma consulta por tabela, ano e UF:
https://www.fnde.gov.br/olinda-ide/servico/DADOS_ABERTOS_SIOPE/versao/v1/odata
Até 2016 a declaração é anual e fica no período 1; de 2017 em diante é bimestral e o ano fechado é o
período 6 (o período 1 de 2017 em diante é só o 1º bimestre). Os municípios vêm com o código IBGE de
6 dígitos; o estado, sem código (TIPO 'Estadual').

Tabelas, no nível mais detalhado que a fonte publica:
  indicadores      indicador declarado (25% em MDE, FUNDEB, gasto por aluno…)
  despesas         etapa de ensino × item da despesa × fonte de recursos × fase (dotação, empenho, liquidação, pagamento)
  receitas         item de receita × coluna (previsão, realização)
  despesas_funcao  subfunção da educação × fase
  gerais           totais da declaração (receita e despesa totais e da educação, população); sem os dados dos responsáveis
  remuneracao      a fonte traz cada profissional por escola, com o nome. Aqui só agregado: município × categoria ×
                   situação × tipo de categoria, com número de pessoas e de vínculos e estatísticas da remuneração
                   por pessoa (média, mediana, quartis) só em grupos de 5 ou mais pessoas. Por padrão, só dezembro (--meses).

silver/siope/<tabela>/ano=AAAA/uf=XX.parquet   uma consulta cada; o que já existe não é baixado de novo
gold/siope/<tabela>.parquet                    tudo junto, com cod_ibge de 7 dígitos, ordenado por cod_ibge

Uso:
    py pipeline/siope.py                       # 2013 até o ano anterior ao atual, o que faltar
    py pipeline/siope.py --anos 2024 --refazer
    py pipeline/siope.py --meses 1-12          # remuneração de todos os meses (lento: ~7 min por mês)
    py pipeline/siope.py --so-gold
"""
import argparse
import json
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path

import duckdb
import requests

from config import GOLD, PRIMEIRO_ANO, SILVER, UF_POR_CODIGO
from saude_educacao import gerar_resumo

API = "https://www.fnde.gov.br/olinda-ide/servico/DADOS_ABERTOS_SIOPE/versao/v1/odata"
SILVER_E = SILVER / "siope"
GOLD_E = GOLD / "siope"
UFS = sorted(UF_POR_CODIGO.values())
CODIGO_UF = {uf: cod for cod, uf in UF_POR_CODIGO.items()}
MIN_GRUPO = 5  # profissionais por grupo para mostrar estatísticas de salário

# recurso da API e campos pedidos ($select): só o necessário, sem nomes de pessoas nem contatos
TABELAS = {
    "indicadores": ("Indicadores_Siope", "TIPO,COD_MUNI,COD_INDI,COD_EXIB,NOM_INDI,COD_GRUP,NOM_GRUP_INDI,VAL_INDI"),
    "despesas": ("Despesas_Siope", "TIPO,COD_MUNI,NOM_PAST,COD_PAST,COD_SUBF,TIP_PASTA,COD_EXIB_FORMATADO,COD_FONTE,NOM_ITEM,IDN_CLAS,NOM_COLU,NUM_NIVE,NUM_ORDE,VAL_DECL"),
    "receitas": ("Receita_Siope", "TIPO,COD_MUNI,COD_EXIB_FORMATADO,NOM_ITEM,IDN_CLAS,NOM_COLU,NUM_NIVE,NUM_ORDE,VAL_DECL"),
    "despesas_funcao": ("Despesas_Funcao_Educacao_Siope", "TIPO,COD_MUNI,NUM_ORDE,DES_SUBF,VAL_DESP_EMPE,VAL_DESP_LIQU,VAL_DESP_PAGA"),
    "gerais": ("Dados_Gerais_Siope", "TIPO,COD_MUNI,NUM_POPU,DAT_DECL,VAL_RECE_PREV_ATUA,VAL_RECE_REAL,VAL_DESP_DOTA_ATUA,VAL_DESP_EMPE,VAL_DESP_LIQU,"
               "VAL_DESP_PAGA,VL_DESP_DOTA_ATUA_EDU,VL_DESP_EMPE_EDU,VL_DESP_LIQU_EDU,VL_DESP_PAGA_EDU,IDN_TIPO_DECL,IDN_DECL_RETI"),
}
# O nome e a escola só servem para juntar as linhas de cada pessoa em memória; não são gravados.
REMUNERACAO = ("Remuneracao_Siope", "TIPO,COD_MUNI,NO_PROFISSIONAL,CO_ESCOLA,NO_CATEGORIA_PROFISSIONAL,DS_SITUACAO_PROFISSIONAL,"
               "TP_CATEGORIA,NU_CARGA_HORARIA,VL_SALARIO,VL_OUTROS")

periodo = lambda ano: 1 if ano <= 2016 else 6  # noqa: E731


def baixar(recurso: str, campos: str, parametros: dict, destino: Path):
    """Uma consulta da API, gravada em JSON (as respostas passam de 200 MB: vão para o disco, não para a memória)."""
    nomes = ",".join(f"{k}=@{k}" for k in parametros)
    valores = "&".join(f"@{k}={v!r}" if isinstance(v, str) else f"@{k}={v}" for k, v in parametros.items())
    url = f"{API}/{recurso}({nomes})?{valores}&$select={campos}&$format=json"
    for tentativa in range(4):
        try:
            with requests.get(url.replace("'", "%27"), stream=True, timeout=(30, 900)) as r:
                r.raise_for_status()
                with open(destino, "wb") as f:
                    for parte in r.iter_content(1 << 20):
                        f.write(parte)
            return
        except requests.RequestException as e:
            if tentativa == 3:
                raise
            print(f"  nova tentativa ({e.__class__.__name__}) {recurso} {parametros}")
            time.sleep(10 * (tentativa + 1))


def ler(con, arquivo: Path):
    """Linhas da resposta OData (lista 'value') como tabela do DuckDB; resposta vazia = tabela sem linhas."""
    con.execute(f"""CREATE OR REPLACE TEMP TABLE r AS
        SELECT unnest(value, recursive := true) FROM read_json('{arquivo.as_posix()}', maximum_object_size = 2000000000)""")


def uma(tabela: str, ano: int, uf: str, refazer: bool) -> str:
    saida = SILVER_E / tabela / f"ano={ano}" / f"uf={uf}.parquet"
    if saida.exists() and not refazer:
        return "já"
    saida.parent.mkdir(parents=True, exist_ok=True)
    recurso, campos = TABELAS[tabela]
    con = duckdb.connect()
    with tempfile.TemporaryDirectory() as tmp:
        arq = Path(tmp) / "r.json"
        baixar(recurso, campos, {"Ano_Consulta": ano, "Num_Peri": periodo(ano), "Sig_UF": uf}, arq)
        try:
            ler(con, arq)
        except duckdb.Error:
            # sem linhas: a lista 'value' vem vazia e o unnest não tem colunas
            con.execute("CREATE OR REPLACE TEMP TABLE r AS SELECT NULL::VARCHAR AS TIPO WHERE false")
        con.execute(f"COPY (SELECT {ano} AS ano, '{uf}' AS uf, * FROM r) TO '{saida.as_posix()}' (FORMAT parquet, COMPRESSION zstd)")
        n = con.execute("SELECT count(*) FROM r").fetchone()[0]
    return f"{n} linhas"


def remuneracao(ano: int, mes: int, uf: str, refazer: bool) -> str:
    """
    Remuneração de um mês, já agregada: nenhum nome nem salário individual chega ao disco.

    A API traz uma linha por profissional, escola e categoria, e repete vínculos: linhas iguais em pessoa,
    escola, categoria, situação, carga e remuneração (às vezes só com a parcela do FUNDEB repartida, campo
    que não baixamos) contam uma vez (Andirá/PR, dez/2024: 493 linhas, 276 vínculos, 244 pessoas). Os
    vínculos da mesma pessoa na mesma categoria e situação são somados (carga e salário), e as
    estatísticas são por pessoa.
    """
    saida = SILVER_E / "remuneracao" / f"ano={ano}" / f"mes={mes:02d}" / f"uf={uf}.parquet"
    if saida.exists() and not refazer:
        return "já"
    saida.parent.mkdir(parents=True, exist_ok=True)
    recurso, campos = REMUNERACAO
    con = duckdb.connect()
    with tempfile.TemporaryDirectory() as tmp:
        arq = Path(tmp) / "r.json"
        baixar(recurso, campos, {"Ano_Declaracao": ano, "Num_Peri": periodo(ano), "Mes_Exercicio": mes, "Sig_UF": uf}, arq)
        try:
            ler(con, arq)
            n = con.execute("SELECT count(*) FROM r").fetchone()[0]
        except duckdb.Error:
            n = 0
        if n:
            so_grupo = lambda expr: f"CASE WHEN count(*) >= {MIN_GRUPO} THEN {expr} END"  # noqa: E731
            con.execute(f"""COPY (
                WITH pessoa AS (
                    SELECT TIPO, COD_MUNI, NO_CATEGORIA_PROFISSIONAL, DS_SITUACAO_PROFISSIONAL, TP_CATEGORIA,
                           count(*) AS vinculos,
                           sum(TRY_CAST(NU_CARGA_HORARIA AS DOUBLE)) AS carga, sum(TRY_CAST(VL_SALARIO AS DOUBLE)) AS salario,
                           sum(TRY_CAST(VL_OUTROS AS DOUBLE)) AS outros
                    FROM (SELECT DISTINCT * FROM r)
                    GROUP BY TIPO, COD_MUNI, NO_PROFISSIONAL, NO_CATEGORIA_PROFISSIONAL, DS_SITUACAO_PROFISSIONAL, TP_CATEGORIA)
                SELECT {ano} AS ano, {mes} AS mes, '{uf}' AS uf, TIPO AS tipo, COD_MUNI AS cod_muni,
                       NO_CATEGORIA_PROFISSIONAL AS categoria, DS_SITUACAO_PROFISSIONAL AS situacao, TP_CATEGORIA AS tipo_categoria,
                       count(*)::INTEGER AS profissionais, sum(vinculos)::INTEGER AS vinculos,
                       {so_grupo('avg(carga)')} AS carga_horaria_media,
                       {so_grupo('avg(salario)')} AS salario_medio,
                       {so_grupo('quantile_cont(salario, 0.25)')} AS salario_p25,
                       {so_grupo('median(salario)')} AS salario_mediana,
                       {so_grupo('quantile_cont(salario, 0.75)')} AS salario_p75,
                       {so_grupo('avg(outros)')} AS outros_medio
                FROM pessoa GROUP BY ALL) TO '{saida.as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
        else:
            con.execute(f"COPY (SELECT {ano} AS ano, {mes} AS mes, '{uf}' AS uf WHERE false) TO '{saida.as_posix()}' (FORMAT parquet)")
    return f"{n} profissionais"


def baixar_tudo(anos: list[int], meses: list[int], refazer: bool, paralelo: int):
    tarefas = [("tabela", t, a, uf, None) for a in anos for t in TABELAS for uf in UFS]
    tarefas += [("rem", "remuneracao", a, uf, m) for a in anos if a >= 2019 for m in meses for uf in UFS]
    feitas = 0
    with ThreadPoolExecutor(paralelo) as ex:
        futuros = {ex.submit(uma if tipo == "tabela" else remuneracao, *((t, a, uf, refazer) if tipo == "tabela" else (a, m, uf, refazer))):
                   (t, a, uf, m) for tipo, t, a, uf, m in tarefas}
        for f in as_completed(futuros):
            t, a, uf, m = futuros[f]
            feitas += 1
            try:
                r = f.result()
                if r != "já":
                    print(f"[{feitas}/{len(tarefas)}] {t} {a}{f'/{m:02d}' if m else ''} {uf}: {r}", flush=True)
            except Exception as e:  # noqa: BLE001 — a próxima execução tenta de novo o que faltou
                print(f"[{feitas}/{len(tarefas)}] FALHOU {t} {a} {uf} {m or ''}: {e}", flush=True)


# ---------------- gold ----------------

def gerar_gold(con):
    GOLD_E.mkdir(parents=True, exist_ok=True)
    s = SILVER_E.as_posix()
    con.execute(f"CREATE OR REPLACE TABLE entes AS SELECT cod_ibge, esfera FROM '{(SILVER / 'entes.parquet').as_posix()}'")
    con.execute("CREATE OR REPLACE TABLE ufs AS SELECT * FROM (VALUES " + ",".join(f"('{u}', {c})" for u, c in CODIGO_UF.items()) + ") t(uf, uf_cod)")
    # cod_ibge de 7 dígitos (municípios pelo código de 6; estado pelo código da UF; DF = 53) e esfera
    base = lambda tabela: f"""(SELECT t.*, CASE WHEN t.uf = 'DF' THEN 53 WHEN t.TIPO = 'Estadual' THEN u.uf_cod ELSE m.cod_ibge END AS cod_ibge,
                                 CASE WHEN t.uf = 'DF' THEN 'D' WHEN t.TIPO = 'Estadual' THEN 'E' ELSE 'M' END AS esfera
                          FROM read_parquet('{s}/{tabela}/*/*.parquet', union_by_name = true) t
                          JOIN ufs u USING (uf)
                          LEFT JOIN entes m ON m.esfera = 'M' AND m.cod_ibge // 10 = t.COD_MUNI)"""
    num = lambda c: f"TRY_CAST(replace({c}, ',', '.') AS DOUBLE)"  # noqa: E731
    consultas = {
        "indicadores": f"""SELECT ano, cod_ibge, uf, esfera, COD_INDI AS cod_indicador, COD_EXIB AS codigo, NOM_GRUP_INDI AS grupo,
                               trim(NOM_INDI) AS indicador, {num('VAL_INDI')} AS valor FROM {base('indicadores')}""",
        "despesas": f"""SELECT ano, cod_ibge, uf, esfera, trim(NOM_PAST) AS etapa, COD_PAST AS cod_etapa, COD_SUBF AS subfuncao, TIP_PASTA AS tipo_etapa,
                            COD_EXIB_FORMATADO AS codigo, COD_FONTE AS fonte, trim(NOM_ITEM) AS item, IDN_CLAS AS classe, NOM_COLU AS fase,
                            NUM_NIVE::INTEGER AS nivel, NUM_ORDE::INTEGER AS ordem, {num('VAL_DECL')} AS valor FROM {base('despesas')}""",
        "receitas": f"""SELECT ano, cod_ibge, uf, esfera, COD_EXIB_FORMATADO AS codigo, trim(NOM_ITEM) AS item, IDN_CLAS AS classe, NOM_COLU AS coluna,
                            NUM_NIVE::INTEGER AS nivel, NUM_ORDE::INTEGER AS ordem, {num('VAL_DECL')} AS valor FROM {base('receitas')}""",
        "despesas_funcao": f"""SELECT ano, cod_ibge, uf, esfera, NUM_ORDE::INTEGER AS ordem, trim(DES_SUBF) AS subfuncao,
                            {num('VAL_DESP_EMPE::VARCHAR')} AS empenhada, {num('VAL_DESP_LIQU::VARCHAR')} AS liquidada,
                            {num('VAL_DESP_PAGA::VARCHAR')} AS paga FROM {base('despesas_funcao')}""",
        "gerais": f"""SELECT ano, cod_ibge, uf, esfera, NUM_POPU AS populacao, DAT_DECL AS data_declaracao,
                            {num('VAL_RECE_PREV_ATUA::VARCHAR')} AS receita_prevista, {num('VAL_RECE_REAL::VARCHAR')} AS receita_realizada,
                            {num('VAL_DESP_DOTA_ATUA::VARCHAR')} AS despesa_dotacao, {num('VAL_DESP_EMPE::VARCHAR')} AS despesa_empenhada,
                            {num('VAL_DESP_LIQU::VARCHAR')} AS despesa_liquidada, {num('VAL_DESP_PAGA::VARCHAR')} AS despesa_paga,
                            {num('VL_DESP_DOTA_ATUA_EDU::VARCHAR')} AS educacao_dotacao, {num('VL_DESP_EMPE_EDU::VARCHAR')} AS educacao_empenhada,
                            {num('VL_DESP_LIQU_EDU::VARCHAR')} AS educacao_liquidada, {num('VL_DESP_PAGA_EDU::VARCHAR')} AS educacao_paga,
                            IDN_TIPO_DECL AS tipo_declaracao, IDN_DECL_RETI AS retificadora FROM {base('gerais')}""",
    }
    for nome, sql in consultas.items():
        if not any((SILVER_E / nome).glob("*/*.parquet")):
            continue
        # linhas sem município identificado (código ausente no cadastro) ficam de fora e são contadas
        con.execute(f"CREATE OR REPLACE TEMP TABLE g AS {sql}")
        perdidas = con.execute("SELECT count(*) FROM g WHERE cod_ibge IS NULL").fetchone()[0]
        con.execute(f"COPY (SELECT * FROM g WHERE cod_ibge IS NOT NULL ORDER BY cod_ibge, ano) TO '{(GOLD_E / f'{nome}.parquet').as_posix()}' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)")
        n = con.execute("SELECT count(*) FROM g").fetchone()[0]
        print(f"gold/siope/{nome}.parquet: {n - perdidas} linhas{f' ({perdidas} sem município no cadastro)' if perdidas else ''}")
    rem = SILVER_E / "remuneracao"
    if any(rem.glob("*/*/*.parquet")):
        con.execute(f"""COPY (SELECT r.ano, r.mes, CASE WHEN r.uf = 'DF' THEN 53 WHEN r.tipo = 'Estadual' THEN u.uf_cod ELSE m.cod_ibge END AS cod_ibge, r.uf,
                                     CASE WHEN r.uf = 'DF' THEN 'D' WHEN r.tipo = 'Estadual' THEN 'E' ELSE 'M' END AS esfera,
                                     categoria, situacao, tipo_categoria, profissionais, vinculos, carga_horaria_media, salario_medio, salario_p25,
                                     salario_mediana, salario_p75, outros_medio
                              FROM read_parquet('{rem.as_posix()}/*/*/*.parquet', union_by_name = true) r JOIN ufs u USING (uf)
                              LEFT JOIN entes m ON m.esfera = 'M' AND m.cod_ibge // 10 = r.cod_muni
                              WHERE r.categoria IS NOT NULL ORDER BY 3, 1, 2)
                     TO '{(GOLD_E / 'remuneracao.parquet').as_posix()}' (FORMAT parquet, COMPRESSION zstd)""")
        print("gold/siope/remuneracao.parquet:", con.execute(f"SELECT count(*) FROM '{(GOLD_E / 'remuneracao.parquet').as_posix()}'").fetchone()[0], "linhas")
    gerar_resumo(con)
    atualizar_manifesto(con)


def fonte_siope(con) -> dict:
    """Anos com indicadores e com remuneração, para o manifesto (gold.py chama a mesma função)."""
    arq = GOLD_E / "indicadores.parquet"
    if not arq.exists():
        return {}
    anos = [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{arq.as_posix()}' ORDER BY 1").fetchall()]
    rem = GOLD_E / "remuneracao.parquet"
    meses = con.execute(f"SELECT DISTINCT ano * 100 + mes FROM '{rem.as_posix()}' ORDER BY 1").fetchall() if rem.exists() else []
    quando = datetime.fromtimestamp(arq.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    return {"siope": {"anos": anos, "remuneracao": [m[0] for m in meses], "processado_em": quando,
                      "url": "https://www.fnde.gov.br/olinda-ide/servico/DADOS_ABERTOS_SIOPE/versao/v1/odata"}}


def atualizar_manifesto(con):
    caminho = GOLD / "manifesto.json"
    if not caminho.exists():
        return
    manifesto = json.loads(caminho.read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {}).update(fonte_siope(con))
    # o site põe gerado_em no caminho dos arquivos: sem mudar, o navegador usaria o cache antigo
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    caminho.write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")


def intervalo(texto: str) -> list[int]:
    a, _, b = texto.partition("-")
    return list(range(int(a), int(b or a) + 1))


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--anos", default=f"{PRIMEIRO_ANO}-{date.today().year - 1}")
    p.add_argument("--meses", default="12", help="meses da remuneração (ex.: 12 ou 1-12)")
    p.add_argument("--refazer", action="store_true")
    p.add_argument("--so-gold", action="store_true")
    p.add_argument("--paralelo", type=int, default=4, help="consultas simultâneas à API")
    args = p.parse_args()
    if not args.so_gold:
        baixar_tudo(intervalo(args.anos), intervalo(args.meses), args.refazer, args.paralelo)
    gerar_gold(duckdb.connect())


if __name__ == "__main__":
    main()
