"""FNS (repasses federais fundo a fundo): regras de destinatário, quarentena e agregados do painel Saúde → Financiamento federal.

Fonte: Portal do FNS, https://portalfns.saude.gov.br/downloads/ ("REPASSE-FAF-COM-POPULACAO", um arquivo por ano, 2002–2025; o 2026
é parcial, acumulado até julho, e fica fora). Baixar: fns_baixar.py. Ler as células: fns_leitura.py.

Universo: repasses classificados pelo próprio FNS para destinatários MUNICIPAIS (TP_REPASSE = MUNICIPAL), mais o Distrito Federal.
    - A localização (UF, município) não define o destinatário: linhas de São Paulo incluem fundo estadual e, em 2002, a entidade
      MUNICIPIO DE ASSIS BRASIL vem classificada ESTADUAL. A regra é TP_REPASSE, explícita; o nome da entidade nunca decide
      (auditoria_destinatarios.csv só lista os nomes que parecem contradizer a classificação).
    - Distrito Federal: o FNS o classifica ESTADUAL. Entram só os destinatários históricos comprovados (CNPJ 00394700000108, Secretaria
      de Saúde, 00394700000299, Fundo de Saúde histórico, e 12116247000157, Fundo de Saúde do DF) com UF = DF e código 530010.
      Outros destinatários em Brasília não entram. O CNPJ histórico consta do Relatório Anual de Gestão de 2009, página 5:
      https://info.saude.df.gov.br/wp-content/uploads/2022/08/Relatorio-Anual-de-Gestao-2009.pdf
      Contrato de Repasse nº 904651/2020 (reforma do HRAN), que identifica o Fundo e a Secretaria como destinatários distritais:
      https://www.saude.df.gov.br/documents/37101/0/Contrato-de-Repasse-no-904651-2020-REFORMA-HRAN-ala-de-queimados-novo.pdf
    - Período: o ano do arquivo. DT_ULTIMA_LIBERACAO é só a data da última liberação da conta (não dá série mensal).
    - Valores: texto → Decimal exato, arredondado a centavos só quando a diferença é ruído de ponto flutuante do XLSX (< 0,0001);
      fração real de centavo → quarentena. VL_BRUTO e VL_LIQUIDO são somados; VL_SALDO_CONTA é estoque da conta e nunca é somado.
    - Quarentena (fora dos agregados, com o motivo): valor ausente ou inválido, tipo de repasse desconhecido, flags conflitantes
      (TP_REPASSE_ESTADO/ST_FAF), município fora do cadastro ou UF que não bate com o código, linhas completas duplicadas e chaves
      de conta repetidas na mesma classe (todas as cópias, porque não há como saber qual vale).
    - A mesma conta e estratégia aparece às vezes com TP_REPASSE diferentes (ex.: o fundo de um município em linhas MUNICIPAL e ESTADUAL):
      cada linha segue a sua classificação, e os casos ficam em conflitos_classificacao.csv.
    - População dos arquivos (QT_POPULACAO, de 2021): NÃO é usada. A taxa per capita usa a população anual da SVS/MS
      (gold/saude/populacao.parquet), uma vez por município e ano.
    - O valor real (R$ de 2025) usa o IPCA existente (gold/ipca.parquet), que só começa em 2006: antes disso fica NULL.
    - Composição (BLOCO, GRUPO, ESTRATÉGIA): os rótulos são os da fonte em cada ano, retrospectivamente atualizados pelo FNS e sem
      equivalência garantida entre anos (Nota Informativa sobre a Portaria GM/MS nº 828/2020: https://portalfns.saude.gov.br/wp-content/uploads/2020/06/Nota-Informativa-sobre-a-Portaria-GMMS-n%C2%BA-828-2020.pdf).
    - Perspectiva: o que o FNS repassou. Não se soma à receita (SICONFI) nem à despesa (SIOPS) do mesmo fluxo.

Saídas do candidato (em E:/finbra/candidato_fns_20261110, nunca no gold publicado):
    gold/saude/fns_municipios.parquet  ano × município (todos os do cadastro; sem repasse = NULL, nunca zero): bruto, líquido,
                                       líquido real, população SVS/MS do ano, linhas
    gold/saude/fns_composicao.parquet  ano × município × bloco × grupo × estratégia (rótulos da fonte)
    gold/saude/fns_anos.parquet        por ano: arquivo, URL, SHA-256, linhas lidas/incluídas/excluídas/em quarentena e valores
    gold/manifesto.json                o publicado + fontes.fns
    auditoria/                         fontes (JSON), quarentena, excluídos e destinatários suspeitos (CSV)

Uso:
    py pipeline/fns.py candidato [--base E:/finbra/data/gold] [--brutos E:/finbra/brutos/fns]
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from config import UF_POR_CODIGO  # noqa: E402
from fns_leitura import CAMPOS, ler_arquivo, parse_data, parse_decimal  # noqa: E402
from fns_baixar import nome_arquivo, verificar_arquivo  # noqa: E402

ANOS = tuple(range(2002, 2026))
BRUTOS = Path("E:/finbra/brutos/fns")
CANDIDATO = Path("E:/finbra/candidato_fns_20261110")
BASE = Path("E:/finbra/data/gold")
DF_CNPJ = {"00394700000108": "Secretaria de Saúde do DF", "00394700000299": "Fundo de Saúde do DF (histórico)",
           "12116247000157": "Fundo de Saúde do DF"}
DF_COD = 530010
CATALOGO = "https://portalfns.saude.gov.br/downloads/"
NOTA_828 = "https://portalfns.saude.gov.br/wp-content/uploads/2020/06/Nota-Informativa-sobre-a-Portaria-GMMS-n%C2%BA-828-2020.pdf"
DF_DOC = "https://www.saude.df.gov.br/documents/37101/0/Contrato-de-Repasse-no-904651-2020-REFORMA-HRAN-ala-de-queimados-novo.pdf/5a1d087d-619b-bb50-06a4-847244954a05?t=1651503244521"
DF_DOC_HISTORICO = "https://info.saude.df.gov.br/wp-content/uploads/2022/08/Relatorio-Anual-de-Gestao-2009.pdf"
TOLERANCIA = Decimal("0.0001")
CENTAVO = Decimal("0.01")
UF_SIGLA = {c: s for c, s in UF_POR_CODIGO.items()}
# combinações esperadas de flags por tipo de repasse (TP_REPASSE → TP_REPASSE_ESTADO); ST_FAF é sempre 'S' (repasse fundo a fundo)
FLAGS_ESPERADAS = {"MUNICIPAL": "N", "ESTADUAL": "S"}
PARECE_MUNICIPAL = re.compile(r"\b(MUNICIPIO|MUNICIPAL|PREFEITURA|SECRETARIA MUNICIPAL)\b")
PARECE_ESTADUAL = re.compile(r"\b(ESTADO|ESTADUAL|SECRETARIA DE ESTADO|SECRETARIA ESTADUAL)\b")


def centavos(v: Decimal) -> Decimal:
    """Arredonda a centavos aceitando só ruído de ponto flutuante (o XLSX guarda 25239.31 como 25239.309999999998)."""
    q = v.quantize(CENTAVO, rounding=ROUND_HALF_EVEN)
    if abs(v - q) > TOLERANCIA:
        raise ValueError(f"fração de centavo: {v}")
    return q


def classificar(r: dict, tipo: str, cod: int | None, cadastro: frozenset[int]) -> tuple[str, str | None]:
    """('municipal'|'distrital'|'excluido'|'quarentena', motivo). Decide só por TP_REPASSE, pela UF/código e, para o DF, pelo CNPJ da lista."""
    uf = r["uf"].strip().upper()
    cnpj = r["cnpj"].strip()
    if tipo not in FLAGS_ESPERADAS:
        return "quarentena", f"tp_repasse_desconhecido:{tipo or 'vazio'}"
    if r["tp_repasse_estado"].strip().upper() != FLAGS_ESPERADAS[tipo] or r["st_faf"].strip().upper() != "S":
        return "quarentena", f"flags_conflitantes:{tipo}/{r['tp_repasse_estado'].strip()}/{r['st_faf'].strip()}"
    if uf == "DF" or cod == DF_COD:
        if uf == "DF" and cod == DF_COD and cnpj in DF_CNPJ:
            return "distrital", None
        return "excluido", "df_destinatario_nao_comprovado"
    if tipo == "ESTADUAL":
        return "excluido", "estadual"
    if cod is None or cod not in cadastro:
        return "quarentena", "municipio_fora_do_cadastro"
    if UF_SIGLA.get(cod // 10000) != uf:
        return "quarentena", f"uf_diverge_do_codigo:{uf}/{cod // 10000}"
    return "municipal", None


def processar_arquivo(ano: int, caminho: str, cadastro: frozenset[int]) -> dict:
    """Lê um arquivo anual e devolve agregados exatos (Decimal), contadores de auditoria e as linhas em quarentena."""
    caminho = Path(caminho)
    it, info = ler_arquivo(caminho)
    serie = info["serie_excel"]
    agg: dict = {}
    excl = defaultdict(lambda: [0, Decimal(0), Decimal(0)])
    quarentena: list[dict] = []
    dest_suspeitos = defaultdict(lambda: [0, Decimal(0)])
    cont = Counter()
    vistas: dict = {}   # linha completa → [números das linhas]; chave da conta → [números]
    chaves: dict = {}
    entre_classes: dict = {}   # mesma conta e estratégia com TP_REPASSE diferentes (o FNS classifica as duas linhas de modos distintos)
    df_aud = defaultdict(lambda: [0, Decimal(0)])
    candidatas: list = []
    identidades: dict[int, tuple[str, str]] = {}
    n = 0
    for n, r in enumerate(it, 1):
        cont["linhas_arquivo"] += 1
        bruto_t, liq_t = r["vl_bruto"].strip(), r["vl_liquido"].strip()
        completa = tuple(r[c] for c in CAMPOS)
        vistas.setdefault(completa, []).append(n)
        base_chave = (r["cnpj"], r["bloco"], r["grupo"], r["estrategia"], r["banco"], r["agencia"], r["conta"])
        chaves.setdefault(base_chave + (r["tp_repasse"].strip().upper(),), []).append(n)
        entre_classes.setdefault(base_chave, []).append((n, r["tp_repasse"].strip().upper(), r))
        try:
            bruto, liq = parse_decimal(bruto_t), parse_decimal(liq_t)
            if bruto is None or liq is None:
                raise ValueError("valor ausente")
            bruto, liq = centavos(bruto), centavos(liq)
        except ValueError as e:
            quarentena.append({"ano": ano, "linha": n, "motivo": f"valor:{e}", **r})
            cont["quarentena"] += 1
            continue
        try:
            data = parse_data(r["dt_ultima_liberacao"], serie)
            if data is None:
                cont["liberacao_vazia"] += 1
            elif data.year != ano:
                cont["liberacao_fora_do_ano"] += 1
        except ValueError:
            cont["liberacao_invalida"] += 1
        tipo = r["tp_repasse"].strip().upper()
        cod_txt = r["cod_ibge6"].strip()
        cod = int(cod_txt) if cod_txt.isdigit() and len(cod_txt) == 6 else None
        classe, motivo = classificar(r, tipo, cod, cadastro)
        if r["uf"].strip().upper() == "DF" or cod == DF_COD:
            d = df_aud[(r["uf"], r["cod_ibge6"], r["cnpj"], r["entidade"], tipo, "incluído" if classe == "distrital" else "fora")]
            d[0] += 1; d[1] += liq
        if classe == "quarentena":
            quarentena.append({"ano": ano, "linha": n, "motivo": motivo, **r})
            cont["quarentena"] += 1
            continue
        nome = sem_acento_maiusculo(r["entidade"])
        if classe == "excluido":
            e = excl[(tipo, motivo)]
            e[0] += 1; e[1] += bruto; e[2] += liq
            cont["excluidas"] += 1
            if motivo == "estadual" and PARECE_MUNICIPAL.search(nome):
                s = dest_suspeitos[("ESTADUAL com nome de município", r["uf"], r["cnpj"], r["entidade"])]
                s[0] += 1; s[1] += liq
            continue
        if classe == "municipal" and PARECE_ESTADUAL.search(nome):
            s = dest_suspeitos[("MUNICIPAL com nome de estado", r["uf"], r["cnpj"], r["entidade"])]
            s[0] += 1; s[1] += liq
        candidatas.append((n, classe, cod, r["bloco"].strip(), r["grupo"].strip(), r["estrategia"].strip(), bruto, liq, r))
    # duplicidades: nenhuma cópia entra (não há como saber qual vale). Linha completa repetida ou chave de conta repetida.
    ruins = {}
    for k, v in vistas.items():
        if len(v) > 1:
            for x in v:
                ruins[x] = "duplicada_exata"
    for k, v in chaves.items():
        if len(v) > 1:
            for x in v:
                ruins.setdefault(x, "chave_de_conta_repetida")
    for (linha, classe, cod, bloco, grupo, estr, bruto, liq, r) in candidatas:
        if linha in ruins:
            quarentena.append({"ano": ano, "linha": linha, "motivo": ruins[linha], **r})
            cont["quarentena"] += 1
            cont["duplicidade"] += 1
            continue
        a = agg.setdefault((cod, classe, bloco, grupo, estr), [Decimal(0), Decimal(0), 0])
        a[0] += bruto; a[1] += liq; a[2] += 1
        identidades[cod] = (r["municipio"].strip(), r["uf"].strip().upper())
        cont["incluidas_" + classe] += 1
    conflitos = []
    for k, v in entre_classes.items():
        if len({x[1] for x in v}) > 1:
            for (linha, tp, r) in v:
                conflitos.append({"ano": ano, "linha": linha, "tp_repasse": tp, "uf": r["uf"], "municipio": r["municipio"], "cnpj": r["cnpj"],
                                  "entidade": r["entidade"], "estrategia": r["estrategia"], "conta": r["conta"], "vl_bruto": r["vl_bruto"], "vl_liquido": r["vl_liquido"]})
    cont["linhas_com_conflito_de_classe"] = len(conflitos)
    return {"ano": ano, "info": info, "agg": agg, "excl": {k: v for k, v in excl.items()}, "quarentena": quarentena,
            "suspeitos": {k: v for k, v in dest_suspeitos.items()}, "conflitos": conflitos,
            "df": {k: tuple(v) for k, v in df_aud.items()}, "cont": dict(cont), "linhas": n, "identidades": identidades}


def sem_acento_maiusculo(s: str) -> str:
    from fns_leitura import sem_acento

    return sem_acento(s).upper()


def validar_destinos(base: Path, saida: Path, brutos: Path, permitido: Path = CANDIDATO) -> None:
    """Recusa, antes de qualquer escrita, uma saída que não seja a pasta de candidatos, que coincida com o gold publicado ou os brutos,
    ou que os contenha/esteja dentro deles. Compara caminhos já resolvidos (.., links e barras)."""
    base, saida, brutos, permitido = (Path(p).resolve() for p in (base, saida, brutos, permitido))

    def dentro(a: Path, b: Path) -> bool:
        return a == b or b in a.parents

    if saida != permitido:
        raise ValueError(f"destino inválido: {saida}; os candidatos do FNS só podem ser gravados em {permitido}")
    for nome, o in (("o gold publicado", base), ("os brutos", brutos)):
        if dentro(saida, o) or dentro(o, saida):
            raise ValueError(f"destino inválido: {saida} coincide com {nome} ({o}), está dentro dele ou o contém")
    gravacoes = [saida / "gold", saida / "gold" / "saude", saida / "auditoria"]
    gravacoes += [saida / "gold" / "saude" / f"fns_{x}.parquet" for x in ("municipios", "composicao", "anos")]
    jsons = [saida / "gold" / "manifesto.json", saida / "auditoria" / "fns_fontes.json"]
    csvs = [saida / "auditoria" / f"{n}.csv" for n in ("quarentena_fns", "excluidos_fns", "auditoria_destinatarios",
            "conflitos_classificacao", "df_destinatarios")]
    gravacoes += jsons + [p.with_suffix(p.suffix + ".tmp") for p in jsons] + csvs + [p.with_suffix(".tmp") for p in csvs]
    origens = [base / "saude" / "populacao.parquet", base / "saude" / "municipios.parquet", base / "ipca.parquet", base / "manifesto.json",
               brutos / "_fontes.json", *(brutos / nome_arquivo(ano) for ano in ANOS)]
    fontes_resolvidas = {o.resolve() for o in origens}
    for destino in gravacoes:
        d = destino.resolve()
        if not dentro(d, saida) or any(dentro(d, o) or dentro(o, d) for o in (base, brutos)) or d in fontes_resolvidas:
            raise ValueError(f"destino inválido: {destino} resolve para {d}, fora do candidato ou sobre uma origem")


def cadastro_municipios(base: Path) -> tuple[frozenset[int], dict[int, tuple[int, str, str]]]:
    """Códigos de 6 dígitos válidos (cadastro de municípios da população SVS/MS) e, por código, (cod_ibge 7 dígitos, nome, UF) do painel."""
    import duckdb

    con = duckdb.connect()
    # O cadastro de Saúde não traz Fernando de Noronha. O código completo existe na população: jamais inventar o dígito.
    nomes = {r[0]: (r[1], r[2], r[3] or UF_SIGLA[r[0] // 10000]) for r in con.execute(f"""
        WITH p AS (SELECT municipio, arg_max(cod_ibge, ano) AS cod_ibge
                   FROM '{(base / 'saude' / 'populacao.parquet').as_posix()}' GROUP BY municipio),
             n AS (SELECT municipio, arg_max(cod_ibge, ano) AS cod_ibge, arg_max(nome, ano) AS nome, arg_max(uf, ano) AS uf
                   FROM '{(base / 'saude' / 'municipios.parquet').as_posix()}' WHERE cod_ibge IS NOT NULL GROUP BY municipio)
        SELECT p.municipio, coalesce(n.cod_ibge, p.cod_ibge), n.nome, n.uf FROM p LEFT JOIN n USING(municipio)
    """).fetchall()}
    cods = frozenset(nomes)
    return cods, nomes


def agregar(resultados: list[dict], base: Path, saida_saude: Path, fontes: dict) -> None:
    """Grava fns_municipios, fns_composicao e fns_anos a partir dos resultados exatos de cada ano."""
    import duckdb
    import pyarrow as pa

    cods, nomes = cadastro_municipios(base)
    # O nome que falta no cadastro vem do arquivo oficial do FNS mais recente, preservando a unidade territorial.
    for res in sorted(resultados, key=lambda x: x["ano"], reverse=True):
        for cod, (nome, uf) in res.get("identidades", {}).items():
            if cod in nomes and not nomes[cod][1]:
                nomes[cod] = (nomes[cod][0], nome, uf)
    comp = []
    anos = []
    for res in sorted(resultados, key=lambda x: x["ano"]):
        ano = res["ano"]
        liq_total = Decimal(0)
        bruto_total = Decimal(0)
        por_mun: dict = defaultdict(lambda: [Decimal(0), Decimal(0), 0, "municipal"])
        for (cod, classe, bloco, grupo, estr), (b, l, k) in res["agg"].items():
            comp.append((ano, cod, bloco, grupo, estr, float(b), float(l), k))
            m = por_mun[cod]
            m[0] += b; m[1] += l; m[2] += k; m[3] = classe
            bruto_total += b; liq_total += l
        res["por_mun"] = {c: tuple(v) for c, v in por_mun.items()}
        c = res["cont"]
        f = fontes.get(str(ano), {})
        excl_bruto = sum((v[1] for v in res["excl"].values()), Decimal(0))
        excl_liq = sum((v[2] for v in res["excl"].values()), Decimal(0))
        liq_df = sum((v[1] for (cod, classe, *_), v in res["agg"].items() if classe == "distrital"), Decimal(0))
        liq_df_fora = sum((v[2] for (tp, motivo), v in res["excl"].items() if motivo == "df_destinatario_nao_comprovado"), Decimal(0))
        liq_estadual = sum((v[2] for (tp, motivo), v in res["excl"].items() if motivo == "estadual"), Decimal(0))
        anos.append((ano, f.get("arquivo"), f.get("url"), f.get("url_final"), f.get("sha256"), f.get("bytes"), f.get("baixado_em"), f.get("last_modified"),
                     res["info"]["codificacao"], c.get("linhas_arquivo", 0), c.get("incluidas_municipal", 0), c.get("incluidas_distrital", 0),
                     c.get("excluidas", 0), c.get("quarentena", 0), c.get("duplicidade", 0), float(bruto_total), float(liq_total),
                     float(excl_bruto), float(excl_liq), len(por_mun), c.get("liberacao_fora_do_ano", 0),
                     float(liq_df), float(liq_df_fora), float(liq_estadual), c.get("linhas_com_conflito_de_classe", 0)))
    con = duckdb.connect()

    def tabela(nome, colunas, linhas, tipos):
        """Tabela nativa do DuckDB a partir de listas Python, via pyarrow (executemany linha a linha leva horas em 1,5 milhão de linhas)."""
        con.register("_tmp", pa.table({c: pa.array([r[i] for r in linhas], type=t)
                                       for i, (c, t) in enumerate(zip(colunas, tipos))}))
        con.execute(f"CREATE TABLE {nome} AS SELECT * FROM _tmp")
        con.unregister("_tmp")

    i32, f64, txt = pa.int32(), pa.float64(), pa.string()
    tabela("comp", ["ano", "municipio", "bloco", "grupo", "estrategia", "bruto", "liquido", "linhas"], comp, [i32, i32, txt, txt, txt, f64, f64, i32])
    # totais por município: soma exata (Decimal) dos centavos, depois DOUBLE
    mun = [(res["ano"], cod, float(v[0]), float(v[1]), v[2], v[3]) for res in resultados for cod, v in res["por_mun"].items()]
    tabela("mun", ["ano", "municipio", "bruto", "liquido", "linhas", "destino"], mun, [i32, i32, f64, f64, i32, txt])
    tabela("nomes", ["municipio", "cod_ibge", "nome", "uf"], [(m, *v) for m, v in nomes.items()], [i32, i32, txt, txt])
    b = base.as_posix()
    s = saida_saude.as_posix()
    # uma linha por município do cadastro e ano com população (ou com repasse): sem repasse fica NULL, nunca zero
    con.execute(f"""
        CREATE TABLE base AS
        SELECT coalesce(p.ano, m.ano) AS ano, coalesce(p.municipio, m.municipio) AS municipio, p.populacao, m.bruto, m.liquido, m.linhas, m.destino
        FROM (SELECT ano, municipio, populacao FROM '{b}/saude/populacao.parquet' WHERE ano BETWEEN 2002 AND 2025) p
        FULL JOIN mun m ON m.ano = p.ano AND m.municipio = p.municipio""")
    con.execute(f"""
        COPY (
            SELECT x.ano, n.cod_ibge, x.municipio, n.nome, coalesce(n.uf, CASE x.municipio // 10000 {" ".join(f"WHEN {c} THEN '{s_}'" for c, s_ in UF_SIGLA.items())} END) AS uf,
                   CASE WHEN x.municipio = 530010 THEN 'distrital' ELSE 'municipal' END AS destino, x.bruto, x.liquido,
                   x.liquido * i.fator_real AS liquido_real, x.linhas, nullif(x.populacao, 0) AS populacao
            FROM base x LEFT JOIN nomes n USING (municipio)
            LEFT JOIN '{b}/ipca.parquet' i ON i.exercicio = x.ano
            ORDER BY x.ano, x.municipio
        ) TO '{s}/fns_municipios.parquet' (FORMAT parquet, COMPRESSION zstd)""")
    con.execute(f"""
        COPY (
            SELECT c.ano, c.municipio, CASE c.municipio // 10000 {" ".join(f"WHEN {k} THEN '{v}'" for k, v in UF_SIGLA.items())} END AS uf,
                   c.bloco, c.grupo, c.estrategia, c.bruto, c.liquido, c.linhas
            FROM comp c ORDER BY c.ano, c.municipio, c.bloco, c.grupo, c.estrategia
        ) TO '{s}/fns_composicao.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)""")
    tabela("anos", ["ano", "arquivo", "url", "url_final", "sha256", "bytes", "baixado_em", "last_modified", "codificacao", "linhas_arquivo",
                    "linhas_municipais", "linhas_distritais", "linhas_excluidas", "linhas_quarentena", "linhas_duplicadas", "bruto", "liquido",
                    "bruto_excluido", "liquido_excluido", "municipios_com_repasse", "liberacao_fora_do_ano", "liquido_distrital",
                    "liquido_df_nao_comprovado", "liquido_estadual", "linhas_conflito_de_classe"], anos,
           [i32, txt, txt, txt, txt, pa.int64(), txt, txt, txt, i32, i32, i32, i32, i32, i32, f64, f64, f64, f64, i32, i32, f64, f64, f64, i32])
    con.execute(f"COPY (SELECT * FROM anos ORDER BY ano) TO '{s}/fns_anos.parquet' (FORMAT parquet, COMPRESSION zstd)")


def fonte_fns(con, saude: Path) -> dict:
    """Entrada do manifesto (fontes.fns), derivada só dos arquivos fns_* do gold/saude: vale tanto para o candidato quanto para o
    reconstrutor gold.py (sem isto a regeneração do manifesto apagaria a fonte). {} se os arquivos ainda não existem."""
    anos_arq = saude / "fns_anos.parquet"
    mun_arq = saude / "fns_municipios.parquet"
    if not anos_arq.exists() or not mun_arq.exists():
        return {}
    quando = datetime.fromtimestamp(mun_arq.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    anos = [r[0] for r in con.execute(f"SELECT ano FROM '{anos_arq.as_posix()}' ORDER BY ano").fetchall()]
    real = [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{mun_arq.as_posix()}' WHERE liquido_real IS NOT NULL ORDER BY 1").fetchall()]
    arquivos = {str(r[0]): {"arquivo": r[1], "url": r[2], "sha256": r[3], "linhas": r[4]} for r in con.execute(
        f"SELECT ano, arquivo, url, sha256, linhas_arquivo FROM '{anos_arq.as_posix()}' ORDER BY ano").fetchall()}
    return {"fns": {
        "anos": anos, "anos_reais": [real[0], real[-1]] if real else None, "processado_em": quando, "url": CATALOGO,
        "universo": "repasses fundo a fundo classificados pelo FNS (TP_REPASSE) para destinatários municipais, mais os destinatários "
                    "distritais comprovados do DF (Secretaria e Fundo de Saúde); fundos estaduais não entram",
        "df": {"cnpj": list(DF_CNPJ), "documentacao": DF_DOC, "documentacao_historica": DF_DOC_HISTORICO},
        "territorios_especiais": {"2605459": {"nome": "Fernando de Noronha", "tipo": "distrito estadual",
                                              "classificacao_fns": "MUNICIPAL"}},
        "duplicidades": "linhas completas ou chaves de conta repetidas na mesma classificação ficam em quarentena; "
                        "conflitos entre MUNICIPAL e ESTADUAL são auditados separadamente e cada linha segue TP_REPASSE",
        "periodo": "ano do arquivo (a data da última liberação não permite série mensal); saldo de conta não é somado",
        "per_capita": "população anual da SVS/MS (a dos arquivos do FNS, de 2021, não é usada)",
        "composicao": {"nota": "rótulos de bloco, grupo e estratégia da fonte em cada ano, retrospectivamente atualizados; sem equivalência garantida entre anos",
                       "url": NOTA_828},
        "arquivos": arquivos,
    }}


def escrever_json(caminho: Path, obj) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(caminho.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(caminho)


def escrever_csv(caminho: Path, linhas: list[dict], colunas: list[str]) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=colunas, extrasaction="ignore", delimiter=";")
        w.writeheader()
        w.writerows(linhas)
    tmp.replace(caminho)


def candidato(base: Path = BASE, brutos: Path = BRUTOS, saida: Path = CANDIDATO, anos=ANOS, permitido: Path = CANDIDATO) -> dict:
    """Gera o candidato completo em --saida sem tocar --base: processa os arquivos anuais (4 em paralelo), grava os agregados,
    o manifesto (publicado + fns) e a auditoria."""
    validar_destinos(base, saida, brutos, permitido)
    base, brutos, saida = (Path(p).resolve() for p in (base, brutos, saida))
    fontes_arq = brutos / "_fontes.json"
    fontes = json.loads(fontes_arq.read_text(encoding="utf-8")) if fontes_arq.exists() else {}
    tarefas = []
    for a in anos:
        f = fontes.get(str(a), {})
        if f.get("arquivo") != nome_arquivo(a):
            raise ValueError(f"inventário inválido para {a}: arquivo ausente ou diferente do nome anual esperado")
        arq = brutos / nome_arquivo(a)
        if arq.resolve().parent != brutos:
            raise ValueError(f"arquivo bruto aponta para fora da origem: {arq}")
        verificar_arquivo(arq, f)
        tarefas.append((a, str(arq)))
    cods, _ = cadastro_municipios(base)
    with ProcessPoolExecutor(4) as ex:
        futuros = [ex.submit(processar_arquivo, a, p, cods) for a, p in tarefas]
        resultados = []
        for fut in futuros:
            r = fut.result()
            resultados.append(r)
            print(f"{r['ano']}: {r['linhas']} linhas · {r['cont']}", flush=True)
    saude = saida / "gold" / "saude"
    saude.mkdir(parents=True, exist_ok=True)
    agregar(resultados, base, saude, fontes)
    import duckdb

    con = duckdb.connect()
    manifesto = json.loads((base / "manifesto.json").read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {}).update(fonte_fns(con, saude))
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    escrever_json(saida / "gold" / "manifesto.json", manifesto)
    # auditoria
    aud = saida / "auditoria"
    quarent = [q for r in resultados for q in r["quarentena"]]
    escrever_csv(aud / "quarentena_fns.csv", quarent, ["ano", "linha", "motivo", *CAMPOS])
    excl = [{"ano": r["ano"], "tp_repasse": k[0], "motivo": k[1], "linhas": v[0], "bruto": str(v[1]), "liquido": str(v[2])}
            for r in resultados for k, v in sorted(r["excl"].items())]
    escrever_csv(aud / "excluidos_fns.csv", excl, ["ano", "tp_repasse", "motivo", "linhas", "bruto", "liquido"])
    susp = [{"ano": r["ano"], "tipo": k[0], "uf": k[1], "cnpj": k[2], "entidade": k[3], "linhas": v[0], "liquido": str(v[1])}
            for r in resultados for k, v in sorted(r["suspeitos"].items())]
    escrever_csv(aud / "auditoria_destinatarios.csv", susp, ["ano", "tipo", "uf", "cnpj", "entidade", "linhas", "liquido"])
    conf = [c for r in resultados for c in r["conflitos"]]
    escrever_csv(aud / "conflitos_classificacao.csv", conf, ["ano", "linha", "tp_repasse", "uf", "municipio", "cnpj", "entidade", "estrategia", "conta", "vl_bruto", "vl_liquido"])
    dfs = [{"ano": r["ano"], "uf": k[0], "cod_ibge6": k[1], "cnpj": k[2], "entidade": k[3], "tp_repasse": k[4], "situacao": k[5], "linhas": v[0], "liquido": str(v[1])}
           for r in resultados for k, v in sorted(r["df"].items())]
    escrever_csv(aud / "df_destinatarios.csv", dfs, ["ano", "uf", "cod_ibge6", "cnpj", "entidade", "tp_repasse", "situacao", "linhas", "liquido"])
    escrever_json(aud / "fns_fontes.json", {"gerado_em": manifesto["gerado_em"], "catalogo": CATALOGO, "arquivos": fontes,
                                            "leitura": {str(r["ano"]): {**r["info"], "linhas": r["linhas"], **r["cont"]} for r in resultados}})
    return {"anos": len(resultados), "quarentena": len(quarent)}


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("acao", choices=["candidato"])
    p.add_argument("--base", default=str(BASE), help="gold publicado (somente leitura)")
    p.add_argument("--brutos", default=str(BRUTOS))
    a = p.parse_args()
    try:
        r = candidato(Path(a.base), Path(a.brutos), CANDIDATO)
    except (ValueError, FileNotFoundError) as e:
        sys.exit(str(e))
    print("candidato gerado em", CANDIDATO, r)


if __name__ == "__main__":
    main()
