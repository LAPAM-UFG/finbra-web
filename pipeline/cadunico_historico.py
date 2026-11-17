"""Histórico público do MDS redistribuído pela Fundação Seade, sem dados pessoais.

Não substitui o Observatório atual. Gera um catálogo separado de comparações,
com a cobertura recuperada explícita: municípios de SP e famílias no Brasil.
Aquisição e geração são separadas; nunca faz upload nem altera as entradas.
"""

import argparse
import copy
import json
from pathlib import Path
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from assistencia_utils import destino_isolado
from comparacoes import Comparacoes
from comparacoes_base import Quadro, compacto, sha

CATALOGO = "https://repositorio.seade.gov.br/api/3/action/package_show?id=transferencia-de-renda-painel"
PAGINA = "https://repositorio.seade.gov.br/dataset/transferencia-de-renda-painel"
ARQUIVOS = ["bd_cad_pbf.csv", "br_sp_var.csv", "bd_cad_pbf_dicionario.csv", "br_sp_var_dicionario.csv"]
IDS = ["cad_hist_familias", "cad_hist_pessoas", "cad_hist_pessoas_por_familia"]
AVISO = (
    "Histórico recuperado: 01/2018–08/2026, somente municípios de São Paulo; "
    "o total Brasil está disponível apenas para famílias. MDS/Sagicad, redistribuído pela Fundação Seade. "
    "Esta distribuição mensal cobre SP; séries anuais de outras fontes oficiais aparecem em indicadores próprios. "
    "Os perfis do retrato de 10/2026 não têm histórico recuperado nesta distribuição. "
    "04/2025 permanece sem valor: a série do MDS não publica esse mês, enquanto o arquivo Seade "
    "repete os valores de 05/2025. Não se interpola, não se somam estoques mensais e não se emenda "
    "esta série ao retrato do Observatório. Cadastro não equivale a recebimento de benefício nem a taxa de pobreza."
)
AVISO_EN = (
    "Recovered history: Jan/2018–Aug/2026, São Paulo municipalities only; Brazil totals are available for families only. "
    "MDS/Sagicad data redistributed by Fundação Seade. This monthly distribution covers SP; yearly series from other official sources have separate indicators. "
    "The Oct/2026 snapshot profiles have no recovered history in this distribution. "
    "Apr/2025 remains missing: the MDS series does not publish this month, while the Seade file repeats May/2025 values. "
    "No interpolation, summing of monthly stocks or splicing with the Observatory snapshot. "
    "Registration is not receipt of a benefit or a poverty rate."
)


def baixar(saida):
    root = destino_isolado(Path(saida))
    assert not root.exists() or not any(root.iterdir()), "Use pasta nova/vazia"
    r = requests.get(CATALOGO, timeout=(15, 45))
    r.raise_for_status()
    meta = r.json()
    assert meta.get("success") is True
    recursos = {x["url"].split("/")[-1]: x for x in meta["result"]["resources"]}
    assert set(ARQUIVOS) <= set(recursos)
    # Somente as distribuições públicas anunciadas pelo repositório oficial.
    assert all(recursos[n]["url"].startswith("https://repositorio.seade.gov.br/dataset/") for n in ARQUIVOS)
    root.mkdir(parents=True, exist_ok=True)
    (root / "catalogo_seade.json").write_bytes(r.content)
    fontes = []
    for nome in ARQUIVOS:
        url = recursos[nome]["url"]
        resposta = requests.get(url, timeout=(20, 60))
        resposta.raise_for_status()
        assert resposta.url.startswith("https://repositorio.seade.gov.br/") and "html" not in resposta.headers.get("Content-Type", ""), "Resposta não é distribuição CSV"
        assert resposta.content and len(resposta.content) < 50_000_000
        (root / nome).write_bytes(resposta.content)
        fontes.append(dict(arquivo=nome, url=url, bytes=len(resposta.content), sha256=sha(resposta.content)))
    prov = dict(adquirido_em=datetime.now(timezone.utc).isoformat(), catalogo=CATALOGO, arquivos=fontes)
    (root / "proveniencia.json").write_bytes(compacto(prov))
    return prov


def contagens(serie, nome, permite_nulo=False):
    x = pd.to_numeric(serie, errors="raise")
    assert (permite_nulo | x.notna()).all(), f"{nome}: contagem ausente"
    ok = x.dropna()
    assert np.isfinite(ok).all() and (ok >= 0).all() and (ok == np.floor(ok)).all(), f"{nome}: contagem inválida"
    return x.astype(float)


def normalizar(municipal, nacional, municipios_sp):
    """Recebe contagens publicadas, sem inferir números protegidos do Observatório."""
    m = municipal.copy()
    b = nacional.copy()
    assert {"Cod_Mun", "Referência", "Fam_Cad", "Pes_Cad"} <= set(m)
    assert {"Anomes", "BR_CAD_F", "SP_CAD_F"} <= set(b)
    codigos = contagens(m.Cod_Mun, "IBGE").astype(int)
    assert set(codigos) == set(municipios_sp), "Cobertura deve ser exatamente os 645 municípios de SP"
    datas = pd.to_datetime(m["Referência"], format="%Y-%m-%d", errors="raise")
    assert (datas.dt.day == 1).all()
    m["competencia"] = datas.dt.year * 100 + datas.dt.month
    m["cod_ibge"] = codigos
    assert not m.duplicated(["cod_ibge", "competencia"]).any(), "Município/mês repetido"
    for mes, g in m.groupby("competencia"):
        assert set(g.cod_ibge) == set(municipios_sp), f"Cobertura incompleta: {mes}"
    m["familias"] = contagens(m.Fam_Cad, "Fam_Cad")
    m["pessoas"] = contagens(m.Pes_Cad, "Pes_Cad")
    assert (m.pessoas >= m.familias).all(), "Pessoas menores que famílias"
    datas_br = pd.to_datetime(b.Anomes, format="%Y-%m", errors="raise")
    b["competencia"] = datas_br.dt.year * 100 + datas_br.dt.month
    assert not b.competencia.duplicated().any()
    assert set(m.competencia) == set(b.competencia), "Períodos municipal e Brasil divergem"
    b["sem_sp"] = contagens(b.BR_CAD_F, "BR_CAD_F")
    b["sp"] = contagens(b.SP_CAD_F, "SP_CAD_F")
    totais_sp = m.groupby("competencia").familias.sum()
    assert np.array_equal(b.set_index("competencia").sp.sort_index(), totais_sp.sort_index()), "Total SP difere dos municípios"
    # O dicionário ficou desatualizado: até 04/2021 a coluna exclui SP;
    # desde 05/2021 já inclui SP. Regra cotejada com 99 meses do MDS.
    b["familias_br"] = b.sem_sp + np.where(b.competencia <= 202104, b.sp, 0)
    cotejo = json.loads(Path(__file__).with_name('referencias').joinpath('cadunico_brasil_cotejo_20261117.json').read_bytes())
    confirmado = {r['competencia']: r['familias'] for r in cotejo['referencias']}
    for r in b.itertuples(index=False):
        if r.competencia in confirmado:
            assert r.familias_br == confirmado[r.competencia], f'Total Brasil não confere com MDS: {r.competencia}'
    final = cotejo['conferencia_final']
    if final['competencia'] in set(b.competencia):
        assert b.set_index('competencia').loc[final['competencia'], 'familias_br'] == final['familias']
    meses = sorted(m.competencia.unique().tolist())
    assert meses[0] == 201801 and meses[-1] == 202608, 'Nova edição: revisar cobertura e cotejo antes de integrar'
    esperados = [ano * 100 + mes for ano in range(2018, 2027) for mes in range(1, 13) if ano * 100 + mes <= 202608]
    assert meses == esperados, 'Série adquirida incompleta: faltam meses inteiros'
    # Abril e maio são iguais no arquivo redistribuído. Não deslocar o mês de maio
    # nem apresentar como observação confirmada um mês ausente na série do MDS.
    if 202504 in meses:
        abril = m[m.competencia == 202504].set_index("cod_ibge").sort_index()
        maio = m[m.competencia == 202505].set_index("cod_ibge").sort_index()
        assert abril[["familias", "pessoas"]].equals(maio[["familias", "pessoas"]]), "04/2025 mudou: revisar a fonte"
        bb = b.set_index("competencia")
        assert bb.loc[202504, "familias_br"] == bb.loc[202505, "familias_br"]
        m.loc[m.competencia == 202504, ["familias", "pessoas"]] = np.nan
        b.loc[b.competencia == 202504, "familias_br"] = np.nan
    return m[["competencia", "cod_ibge", "familias", "pessoas"]], b.set_index("competencia").familias_br, meses


class QuadroHistorico(Quadro):
    """Brasil publicado não é a soma do subconjunto paulista recuperado."""

    def grupo(self, pos, municipio=False, incluir_ressalvas=False):
        if not municipio and len(pos) == self.valores.shape[1]:
            assert set(pos) == set(range(self.valores.shape[1]))
            return copy.deepcopy(self.brasil_publicado)
        return super().grupo(pos, municipio, incluir_ressalvas)


def gerar(fontes, revisao, saida, repo, estaduais=None):
    fontes, revisao, saida = map(lambda p: Path(p).resolve(), [fontes, revisao, saida])
    destino_isolado(saida, fontes)
    destino_isolado(saida, revisao)
    if estaduais:
        destino_isolado(saida, Path(estaduais))
    assert not saida.exists() or not any(saida.iterdir()), "Use candidato novo/vazio"
    prov = json.loads((fontes / "proveniencia.json").read_bytes())
    registros = {x["arquivo"]: x for x in prov["arquivos"]}
    assert set(registros) == set(ARQUIVOS)
    for nome, ref in registros.items():
        body = (fontes / nome).read_bytes()
        assert len(body) == ref["bytes"] and sha(body) == ref["sha256"], nome
    dicionario = (fontes / "br_sp_var_dicionario.csv").read_text(encoding="cp1252")
    assert "Brasil sem o Estado de São Paulo" in dicionario, "Conceito do total Brasil mudou"
    g = Comparacoes(revisao, saida, repo)
    try:
        municipios_sp = [x[0] for x in g.m if x[2] == "SP"]
        assert len(municipios_sp) == 645
        municipal, familias_br, periodos = normalizar(
            pd.read_csv(fontes / "bd_cad_pbf.csv", low_memory=False),
            pd.read_csv(fontes / "br_sp_var.csv"), municipios_sp,
        )
        py = {p: k for k, p in enumerate(periodos)}
        f = np.full((len(periodos), len(g.m)), np.nan)
        p = f.copy()
        for linha in municipal.itertuples(index=False):
            k, j = py[linha.competencia], g.pos[linha.cod_ibge]
            f[k, j], p[k, j] = linha.familias, linha.pessoas
        populacao, anos_base = g.populacao(periodos)
        fonte = {"nome": "MDS/Sagicad · distribuição pública da Fundação Seade", "url": PAGINA}
        cotejo = g.writer.objeto('cadunico_historico_cotejo_mds', json.loads(Path(__file__).with_name('referencias').joinpath('cadunico_brasil_cotejo_20261117.json').read_bytes()))
        linhagem = g.writer.objeto("cadunico_historico_fontes", dict(prov, aviso=AVISO, aviso_en=AVISO_EN, cotejo=cotejo,
            regra_brasil='BR_CAD_F + SP_CAD_F até 04/2021; BR_CAD_F desde 05/2021, quando passa a incluir SP. Cotejo de 99 meses com a tabela oficial do MDS e do total de 08/2026 com o CECAD.'))
        out = []
        for id, pt, en, valores, denominadores, fator, unidade, unidade_en in [
            (IDS[0], "Famílias no CadÚnico", "Families in Cadastro Único", f, populacao, 1000, "famílias por 1.000 habitantes", "families per 1,000 inhabitants"),
            (IDS[1], "Pessoas no CadÚnico", "People in Cadastro Único", p, populacao, 1000, "pessoas por 1.000 habitantes", "people per 1,000 inhabitants"),
            (IDS[2], "Pessoas por família cadastrada", "People per registered family", p, f, 1, "pessoas por família", "people per family"),
        ]:
            with np.errstate(invalid="ignore", divide="ignore"):
                v = valores / denominadores * fator
            v[(denominadores <= 0) | ~np.isfinite(valores)] = np.nan
            c = np.where(np.isfinite(v), np.where(v == 0, 1, 0), 2).astype(np.uint8)
            c[np.isfinite(valores) & ~np.isfinite(denominadores)] = 3
            c[np.isfinite(valores) & (denominadores == 0)] = 4
            densidade = fator == 1000
            definicao = dict(id=id, nome=pt + (" por 1.000 habitantes" if densidade else ""),
                nome_en=en + (" per 1,000 inhabitants" if densidade else ""), nome_original=pt, nome_original_en=en,
                unidade=unidade, unidade_en=unidade_en, unidade_original="famílias" if id == IDS[0] else "pessoas",
                tema="CadÚnico: histórico recuperado", tema_en="Cadastro Único: recovered history", formato="numero",
                descricao=pt + ". Estoque mensal cadastral; famílias não equivalem a domicílios ou beneficiários.",
                descricao_en=en + ". Monthly registered stock; families are not households or beneficiaries.",
                normalizacao="Soma dos numeradores dividida pela soma dos denominadores dos municípios com dados. Brasil: total de famílias publicado, incluindo SP, dividido pela população nacional de referência do IBGE." if id == IDS[0] else "Pessoas cadastradas divididas pela população residente de referência do IBGE, vezes 1.000. Referências regionais usam a razão das somas; Brasil indisponível nesta série." if densidade else "Pessoas cadastradas divididas por famílias cadastradas. Referências regionais usam a razão das somas; o total Brasil não está disponível nesta série.",
                normalizacao_en="Sum of numerators divided by the sum of denominators for municipalities with data. Brazil: published family total, including SP, divided by the IBGE reference national population." if id == IDS[0] else "Registered people divided by the IBGE reference resident population, times 1,000. Regional references use the ratio of sums; Brazil is unavailable in this series." if densidade else "Registered people divided by registered families. Regional references use the ratio of sums; Brazil is unavailable in this series.",
                frequencia="mensal", metodo_referencia="razao", fator=fator, ranking=True, minimo=0,
                fonte_nome=fonte["nome"], fontes=[fonte], alerta=AVISO, alerta_en=AVISO_EN,
                historico_cadunico=True, ufs_historico=['SP'],
                cobertura_titulo='São Paulo: 645 municípios, 01/2018 a 08/2026; Brasil: famílias.',
                cobertura_titulo_en='São Paulo: 645 municipalities, Jan/2018 to Aug/2026; Brazil: families.',
                notas_anos={"202504": ["Mês não confirmado na fonte original; não preenchido com os valores de maio.", "Month unconfirmed in the original source; not filled with May values."]})
            if densidade:
                definicao["anos_base_demografica"] = anos_base
            q = QuadroHistorico(definicao, periodos, v, valores.copy(), denominadores.copy(), c,
                originais=valores.copy() if densidade else v.copy())
            nacional = dict(v=[], n=[], d=[], c=[], q=[])
            for k, mes in enumerate(periodos):
                n = float(familias_br.loc[mes]) if id == IDS[0] else np.nan
                demografia = populacao[k]
                assert np.isfinite(demografia).sum() >= 5570, "População nacional incompleta"
                d = float(np.nansum(demografia))
                valido = np.isfinite(n) and d > 0
                for campo, x in dict(v=n / d * fator if valido else None, n=n if valido else None,
                    d=d if valido else None, c=22 if valido else 2, q=0).items():
                    nacional[campo].append(x)
            q.brasil_publicado = nacional
            out.append(q)
        anuais = None
        if estaduais:
            from cadunico_estaduais import quadros_estaduais
            quadros, anuais, prov_estaduais = quadros_estaduais(estaduais, g)
            out.extend(quadros)
            linhagem = g.writer.objeto('cadunico_historico_fontes', dict(mensal=linhagem, anuais=prov_estaduais,
                regra='Séries distintas por fonte, território e frequência; sem interpolação ou inferência de contagens.'))
        cat = g.writer.area("assistencia", out, dict(tipo="objeto", **linhagem), rede="cadunico_historico")
        # Arquivos completos de contagens, não apenas a série ou o ranking em tela.
        tabela = municipal.copy()
        tabela["municipio"] = tabela.cod_ibge.map({x[0]: x[1] for x in g.m})
        tabela["uf"] = "SP"
        tabela["territorio"] = tabela.cod_ibge.astype(str)
        extras = []
        for mes, rows in tabela.groupby("competencia"):
            for key, nome in [("SP", "São Paulo"), ("BR", "Brasil")]:
                ff = rows.familias.sum(min_count=len(rows)) if key == "SP" else familias_br.loc[mes]
                pp = rows.pessoas.sum(min_count=len(rows)) if key == "SP" else np.nan
                extras.append(dict(competencia=mes, territorio=key, municipio=nome, uf="SP" if key == "SP" else "", familias=ff, pessoas=pp))
        tabela = pd.concat([tabela, pd.DataFrame(extras)], ignore_index=True)
        tabela["ano"], tabela["mes"] = tabela.competencia // 100, tabela.competencia % 100
        tabela["pessoas_por_familia"] = tabela.pessoas / tabela.familias.where(tabela.familias > 0)
        tabela["condicao"] = np.where(tabela.familias.notna(), "registrado", "sem_publicacao_confirmada")
        tabela["fonte"] = "MDS/Sagicad; Fundação Seade"
        tabela = tabela[["territorio", "municipio", "uf", "ano", "mes", "familias", "pessoas", "pessoas_por_familia", "condicao", "fonte"]]
        tabela['frequencia'] = 'mensal'
        tabela['percentual_pessoas_fjp'] = np.nan
        if anuais is not None:
            tabela = pd.concat([tabela, anuais.drop(columns=['cod_ibge'])], ignore_index=True)[list(tabela.columns)]
        downloads = []
        for formato in ["csv", "parquet", "dta"]:
            temporario = g.writer.dest / ("cadunico_historico_temporario." + formato)
            if formato == "csv": tabela.to_csv(temporario, index=False, na_rep="", encoding="utf-8-sig", float_format="%.10g")
            elif formato == "parquet": tabela.to_parquet(temporario, index=False, compression="zstd")
            else:
                stata = tabela.copy()
                stata["territorio"] = stata.territorio.astype(str)
                stata.to_stata(temporario, write_index=False, version=118, variable_labels={
                    "territorio": "Código IBGE (7 dígitos), SP ou BR", "ano": "Ano de referência", "mes": "Mês informado pela fonte; ausente se não informado",
                    "familias": "Famílias cadastradas (estoque; nunca somar meses)", "pessoas": "Pessoas cadastradas; Brasil, PA e MG indisponíveis",
                    "pessoas_por_familia": "Pessoas / famílias; indefinido se famílias = 0", "condicao": "Ausência não equivale a zero",
                    "frequencia": "Mensal (Seade) ou anual (Fapespa/FJP)", "percentual_pessoas_fjp": "Percentual municipal publicado pelo IMRS (MG)"})
            h = sha(temporario.read_bytes())
            final = temporario.with_name(f"cadunico_historico_{h[:16]}.{formato}")
            temporario.rename(final)
            downloads.append(dict(formato=formato, caminho="gold/comparacoes/" + final.name, bytes=final.stat().st_size, sha256=h))
        dicionario = g.writer.objeto("cadunico_historico_dicionario", dict(
            titulo="CadÚnico: histórico recuperado",
            aviso="Fontes e frequências distintas: SP, famílias e pessoas mensais (2018–2026); Brasil, somente famílias mensais; PA, famílias anuais (2013–2024); MG, percentual de pessoas anual (2014–2024). Use frequencia, ano e mes para identificar a observação. Não se somam estoques nem se inferem contagens dos percentuais." if estaduais else AVISO,
            aviso_en="Distinct sources and frequencies: SP, monthly families and people (2018–2026); Brazil, monthly families only; PA, yearly families (2013–2024); MG, yearly people percentage (2014–2024). Use frequencia, ano and mes to identify observations. Stocks are not summed and counts are not inferred from percentages." if estaduais else AVISO_EN, fonte=PAGINA,
            variaveis={"territorio": "Código IBGE do município (7 dígitos), SP ou BR. Regiões usam a associação IBGE atual (divisão 2017).",
                "municipio": "Nome do município ou do agregado.", "uf": "Sigla do estado; vazio no Brasil.",
                "ano": "Ano da observação mensal ou anual, conforme frequencia.", "mes": "Mês informado pela fonte, de 1 a 12; vazio nas observações anuais de MG e PA até 2023. PA 2024 = julho. Nunca inferir dezembro.", "familias": "Famílias cadastradas; estoque, não somar meses nem tratar como média anual. SP/BR mensais (Seade); PA anual (Fapespa). Brasil = BR_CAD_F + SP_CAD_F até 04/2021; desde 05/2021, BR_CAD_F já inclui SP. Regra cotejada com MDS.",
                "pessoas": "Pessoas cadastradas no mês. Disponível apenas para SP.", "pessoas_por_familia": "Pessoas / famílias do mesmo território e mês, apenas SP. Ausente quando um componente falta ou o denominador é zero.",
                "condicao": "registrado ou sem_publicacao_confirmada. Campos ausentes permanecem vazios.", "fonte": "Órgão responsável pela distribuição das observações públicas.",
                "frequencia": "mensal: Seade (SP e famílias BR). anual: Fapespa (PA) ou FJP (MG); estoques, não acumulados.",
                "percentual_pessoas_fjp": "População inscrita no CadÚnico / população estimada × 100, percentual municipal publicado no IMRS (MG), 2014–2024. Sem inferir contagens; não é taxa de pobreza. Referências regionais do painel são medianas, não agregados oficiais."},
            fontes_anuais=prov_estaduais if estaduais else None))
        cat["downloads_historico"] = downloads
        cat["dicionario_historico"] = dicionario
        cat["cobertura_historico"] = dict(municipios=1642 if estaduais else 645, ufs=['SP', 'PA', 'MG'] if estaduais else ['SP'],
            mensal=dict(uf='SP', municipios=645, inicio=periodos[0], fim=periodos[-1], meses_com_valor=len(periodos)-1),
            anual=dict(PA=dict(municipios=144,inicio=2013,fim=2024), MG=dict(municipios=853,inicio=2014,fim=2024)) if estaduais else {})
        g.writer.catalogos["assistencia_cadunico_historico"] = g.writer.objeto("assistencia_cadunico_historico_catalogo", cat)
        g.writer.concluir()
        resumo = dict(ok=True, municipios=1642 if estaduais else 645, indicadores=len(out), periodos_mensais=len(periodos), meses_com_valor=len(periodos)-1,
            linhas_download=len(tabela), janeiro_2018_brasil=float(familias_br.loc[201801]),
            ultima_referencia=periodos[-1], brasil_ultima=float(familias_br.iloc[-1]),
            aviso=AVISO, arquivos=downloads, fontes=linhagem)
        (saida / "validacao_historico.json").write_bytes(compacto(resumo))
        return resumo
    finally:
        g.con.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="comando", required=True)
    b = sub.add_parser("baixar"); b.add_argument("--saida", type=Path, required=True)
    c = sub.add_parser("gerar")
    for nome in ["fontes", "revisao", "saida"]: c.add_argument("--"+nome, type=Path, required=True)
    c.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    c.add_argument('--estaduais', type=Path)
    args = parser.parse_args()
    print(json.dumps(baixar(args.saida) if args.comando == "baixar" else gerar(args.fontes, args.revisao, args.saida, args.repo, args.estaduais), ensure_ascii=True), flush=True)
