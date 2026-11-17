"""APS, PNI e FNS: mesmos componentes e universos das páginas detalhadas."""

import numpy as np
from comparacoes_base import Quadro


def definicao(id, nome, nome_en, tema, fonte, url, **extra):
    return dict(
        id=id,
        nome=nome,
        nome_en=nome_en,
        descricao=nome,
        descricao_en=nome_en,
        tema=tema,
        tema_en=tema,
        fonte_nome=fonte,
        fontes=[dict(nome=fonte, url=url)],
        frequencia="anual",
        ranking=True,
        minimo=0,
        metodo_referencia="razao",
        fator=100,
        formato="percentual",
        unidade="%",
        unidade_en="%",
        normalizacao="Soma dos numeradores dividida pela soma dos denominadores dos mesmos municípios e período. Referência derivada dos dados municipais, com cobertura explícita; não é o totalizador oficial da UF ou Brasil.",
        normalizacao_en="Ratio of summed numerators and denominators for the same municipalities and period. Reference derived from municipal records, with explicit coverage; not the official state/Brazil total.",
        **extra
    )


def montar(i, pp, linhas, g):
    shape = (len(pp), len(g.m))
    v = np.full(shape, np.nan)
    n = v.copy()
    d = v.copy()
    c = np.full(shape, 2, dtype=np.uint8)
    r = v.copy()
    py = {a: k for k, a in enumerate(pp)}
    for cod, ano, vv, nn, dd, bruto in linhas:
        if cod not in g.pos or ano not in py:
            continue
        k = py[ano]
        p = g.pos[cod]
        n[k, p] = np.nan if nn is None else nn
        d[k, p] = np.nan if dd is None else dd
        r[k, p] = np.nan if bruto is None else bruto
        if vv is not None and np.isfinite(vv):
            v[k, p] = vv
            c[k, p] = 1 if vv == 0 else 0
        elif nn is not None:
            c[k, p] = 3 if dd is None else 4 if dd == 0 else 2
        elif i["formato"] == "moeda" and bruto is not None:
            c[k, p] = 21
    return Quadro(i, pp, v, n, d, c, originais=r)


def complementos(g):
    out = []
    df = g.con.execute(
        "SELECT cod_ibge,ano,ab_cobertura,ab_cobertura_sf,ab_populacao,aps_capacidade,aps_populacao,acs_cobertura,acs_populacao FROM "
        + g.sql("gold/saude/municipios.parquet")
        + " WHERE cod_ibge IS NOT NULL"
    ).fetchall()
    for id, nome, en, col, den, de, ate in [
        (
            "ab_cobertura",
            "Atenção básica: cobertura (até 2020)",
            "Basic care coverage (through 2020)",
            2,
            4,
            2008,
            2020,
        ),
        (
            "ab_sf",
            "Saúde da Família: cobertura (até 2020)",
            "Family Health coverage (through 2020)",
            3,
            4,
            2008,
            2020,
        ),
        (
            "aps_potencial",
            "Atenção primária: cobertura potencial (desde 2021)",
            "Primary care: potential coverage (from 2021)",
            5,
            6,
            2021,
            2025,
        ),
        (
            "acs_cobertura",
            "Agentes comunitários: cobertura",
            "Community health agents: coverage",
            7,
            8,
            2008,
            2025,
        ),
    ]:
        pp = list(range(de, ate + 1))
        i = definicao(
            id,
            nome,
            en,
            "Atenção primária",
            "SAPS · Ministério da Saúde",
            "https://relatorioaps.saude.gov.br/cobertura/aps",
        )
        i.update(
            alerta="Retrato de dezembro. Atenção básica até 2020 e cobertura potencial desde 2021 são metodologias distintas e não se emendam. Cobertura potencial representa capacidade das equipes, não pessoas atendidas.",
            alerta_en="December snapshot. Basic care through 2020 and potential coverage from 2021 use distinct methods and are not joined. Potential coverage measures team capacity, not people actually served.",
        )
        rows = []
        for row in df:
            cod, ano = row[:2]
            x, base = row[col], row[den]
            if ano not in pp:
                continue
            num = (
                x
                if id == "aps_potencial"
                else x * base / 100 if x is not None and base is not None else None
            )
            v = (
                num / base * 100
                if num is not None and base is not None and base > 0
                else None
            )
            rows.append((cod, ano, v, num, base, v))
        out.append(montar(i, pp, rows, g))
    vac = g.con.execute(
        "SELECT cod_ibge,ano,imunobiologico,metodo,numerador,denominador,cobertura FROM "
        + g.sql("gold/saude/vacinacao.parquet")
    ).fetchall()
    cat = g.con.execute(
        "SELECT ano,imunobiologico,metodo,rotulo FROM "
        + g.sql("gold/saude/vacinacao_catalogo.parquet")
        + " ORDER BY ano"
    ).fetchall()
    metas = {}
    for ano, im, met, rot in cat:
        metas.setdefault((im, met), {"rotulo": rot, "anos": []})["anos"].append(ano)
    por = {}
    for cod, ano, im, met, nn, dd, vv in vac:
        por.setdefault((im, met), []).append(
            (cod, ano, vv * 100 if vv is not None else None, nn, dd, vv)
        )
    for (im, met), meta in metas.items():
        sufixo = (
            "por indivíduo (2023 em diante)"
            if met == "individuo"
            else "por tipo de dose (até 2022)"
        )
        code = (
            im if im.replace("_", "").isalnum() and im.isascii() else im.encode().hex()
        )
        i = definicao(
            "vac_" + met + "_" + code,
            meta["rotulo"] + ": cobertura " + sufixo,
            meta["rotulo"]
            + ": coverage "
            + (
                "per individual (from 2023)"
                if met == "individuo"
                else "by dose type (through 2022)"
            ),
            "Vacinação",
            "PNI · Ministério da Saúde",
            "https://infoms.saude.gov.br/extensions/SEIDIGI_DEMAS_VACINACAO_CALENDARIO_NACIONAL_COBERTURA_RESIDENCIA/index.html",
        )
        i.update(
            minimo=30,
            unidade_original="fração (×100 = %)",
            alerta="Denominador: nascidos vivos do SINASC, nunca população residente. Métodos e rótulos distintos permanecem em séries separadas. Pode superar 100%, como na fonte. Referências regionais são derivadas dos componentes municipais; os totalizadores oficiais continuam na página de Vacinação.",
            alerta_en="Denominator: SINASC live births, never resident population. Distinct methods and labels remain separate. Coverage can exceed 100%, as published. Regional references are derived from municipal components; official totals remain on the Vaccination page.",
            notas_anos={
                "2025": [
                    "Dados de 2025 preliminares; os denominadores do SINASC podem ser atualizados.",
                    "Preliminary 2025 data; SINASC denominators may be updated.",
                ]
            },
        )
        q = montar(i, sorted(set(meta["anos"])), por.get((im, met), []), g)
        if 2025 in q.periodos:
            k = q.periodos.index(2025)
            q.condicoes[k, np.isfinite(q.valores[k])] = 6
        out.append(q)
    fns = g.con.execute(
        "SELECT cod_ibge,ano,bruto,liquido,liquido_real,linhas,populacao FROM "
        + g.sql("gold/saude/fns_municipios.parquet")
    ).fetchall()
    pp = sorted({row[1] for row in fns})
    fat = dict(zip(pp, g.fatores(pp)))
    for id, col, nome, en in [
        (
            "fns_liquido_hab",
            3,
            "FNS: repasse líquido real por habitante",
            "FNS: real net transfers per inhabitant",
        ),
        (
            "fns_bruto_hab",
            2,
            "FNS: repasse bruto real por habitante",
            "FNS: real gross transfers per inhabitant",
        ),
    ]:
        i = definicao(
            id,
            nome,
            en,
            "Financiamento federal",
            "Fundo Nacional de Saúde",
            "https://portalfns.saude.gov.br/downloads/",
        )
        i.update(
            fator=1,
            formato="moeda",
            unidade="R$ por habitante",
            unidade_en="R$ per inhabitant",
            unidade_original="R$ nominais",
            precos="reais",
            base_ipca=g.base_ipca,
            normalizacao="Repasses aos destinatários municipais e distritais comprovados do FNS, divididos pela população anual SVS/MS dos mesmos municípios com repasse. Não inclui fundos estaduais. Valores corrigidos pelo IPCA; base demográfica e cobertura explícitas.",
            normalizacao_en="FNS transfers to documented municipal and Federal District recipients divided by the annual SVS/MS population of the same municipalities with transfers. State funds are excluded. IPCA-adjusted values with explicit population base and coverage.",
            alerta="Ano do arquivo; não é série mensal. DF pode ter cobertura incompleta dos destinatários comprovados. A ausência de repasse não é convertida em zero. Valores reais publicados disponíveis desde 2006.",
            alerta_en="File year; not a monthly series. Coverage of documented Federal District recipients may be incomplete. Missing transfers are not converted to zero. Published real values are available from 2006.",
        )
        rows = []
        for row in fns:
            cod, ano = row[:2]
            bruto = row[col]
            nn = (
                row[4]
                if col == 3
                else bruto * fat[ano] if bruto is not None and ano >= 2006 else None
            )
            dd = row[6]
            v = (
                nn / dd
                if nn is not None and dd is not None and dd > 0 and row[5] is not None
                else None
            )
            rows.append((cod, ano, v, nn, dd, bruto))
        out.append(montar(i, pp, rows, g))
    return out
