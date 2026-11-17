"""Distribuições oficiais anuais do CadÚnico: Fapespa (PA) e FJP (MG).

Só agrega tabelas públicas municipais. Não reconstrói contagens a partir de
percentuais, não inventa meses e não mistura séries com universos distintos.
"""
import argparse
import json
import re
import ssl
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

import numpy as np
import pandas as pd

from assistencia_utils import destino_isolado
from comparacoes_base import Quadro, compacto, por_base, sha

FAPESPA = "https://www.fapespa.pa.gov.br/sistemas/anuario"
DISTRIBUICOES = {
    "fapespa_2018.xlsx": FAPESPA + "2018/xls/social/inclusao_social/tab_5.2.2_total_de_familias_inscritas_no_cadastro_unico_para_programas_sociais_cad_unico_para_e_municipios_2012_a_2016.xlsx",
    "fapespa_2020.xlsx": FAPESPA + "2020/planilhas/social/5.2-inclusao-social/tab-5.2.2-total-de-familias-inscritas-no-cadastro-unico-para-programas-sociais-cadunico-2015-a-2019.xlsx",
    "fapespa_2024.xlsx": FAPESPA + "2024/planilhas/social/5.2-inclusao-social/tab-5.2.3-total-de-familias-inscritas-no-cadastro-unico-para-programas-sociais-cadunico-2020-a-2024.xlsx",
}
API_FJP = "https://apiimrs.fjp.mg.gov.br/"
FJP_VALORES = API_FJP + "municipios/allValuesByCity"
FJP_METADATA = API_FJP + "consultas/metadata?indicadores=AS_POPCADUNICO"
CONSULTA_FJP = dict(years=[str(y) for y in range(2013, 2025)], indicators=[90])
AVISO_PA = (
    "144 municípios do Pará, 2013–2024; Mojuí dos Campos sem publicação em 2013. "
    "São observações por ano, não somas nem médias anuais. A Fapespa não informa o mês das referências até 2023; "
    "2024 refere-se a julho. Não se cria série mensal ou referência de dezembro. "
    "Famílias cadastradas não equivalem a domicílios, benefícios recebidos ou pobreza. "
    "Brasil indisponível: o subconjunto paraense não é um total nacional."
)
AVISO_PA_EN = (
    "144 Pará municipalities, 2013–2024; Mojuí dos Campos has no published value for 2013. "
    "These are yearly observations, not annual sums or averages. Fapespa does not specify the reference month through 2023; "
    "2024 refers to July. No monthly series or December reference is invented. "
    "Registered families are not households, benefits received or poverty. "
    "Brazil is unavailable: the Pará subset is not a national total."
)
AVISO_MG = (
    "853 municípios de Minas Gerais, 2014–2024. Percentual publicado pela Fundação João Pinheiro (IMRS), "
    "sem numeradores e denominadores municipais exatos nesta distribuição. "
    "Não se recuperam contagens a partir de percentuais arredondados. As referências das regiões e de MG "
    "são medianas municipais, não percentuais agregados oficiais. Brasil indisponível. "
    "Cadastro não equivale a pobreza ou recebimento de benefício; o mês da observação anual não é informado."
)
AVISO_MG_EN = (
    "853 Minas Gerais municipalities, 2014–2024. Percentage published by Fundação João Pinheiro (IMRS), "
    "without exact municipal numerators and denominators in this distribution. "
    "Counts are not recovered from rounded percentages. Regional and MG references are municipal medians, "
    "not official aggregate percentages. Brazil is unavailable. "
    "Registration is not poverty or receipt of a benefit; the month of the yearly observation is unspecified."
)


def baixar(saida):
    root = destino_isolado(Path(saida))
    assert not root.exists() or not any(root.iterdir()), "Use pasta nova/vazia"
    root.mkdir(parents=True, exist_ok=True)
    refs = []
    consultas = [(n, u, None) for n, u in DISTRIBUICOES.items()] + [
        ("fjp_metadados.json", FJP_METADATA, None),
        ("fjp_valores.json", FJP_VALORES, CONSULTA_FJP),
    ]
    for nome, url, payload in consultas:
        req = Request(url, data=compacto(payload) if payload else None,
            headers={"Content-Type": "application/json", "User-Agent": "Finbra/pesquisa-agregados-publicos"})
        # O contexto padrão usa os certificados confiáveis do sistema no Windows.
        # Nunca desabilitar a validação TLS para contornar certificados vencidos.
        with urlopen(req, timeout=45, context=ssl.create_default_context()) as resp:
            assert resp.url.startswith(("https://www.fapespa.pa.gov.br/", API_FJP))
            original = resp.read(10_000_001)
        assert 0 < len(original) <= 10_000_000
        body = original
        if nome.endswith(".xlsx"):
            assert body.startswith(b"PK"), "Distribuição não é XLSX"
        else:
            obj = json.loads(body)
            assert obj.get("status") == "success"
            if nome == "fjp_valores.json":
                # Preserva apenas os agregados, sem conteúdo das páginas municipais.
                obj = dict(status="success", values=[dict(
                    cd_geocodm=x["cd_geocodm"], nm_municip=x["nm_municip"],
                    valores=[{k: v[k] for k in ["id_indicador", "valor", "edicoes"]} for v in x["valores"]]
                ) for x in obj["values"]])
            body = compacto(obj)
        (root / nome).write_bytes(body)
        refs.append(dict(arquivo=nome, url=url, metodo="POST" if payload else "GET", consulta=payload,
            bytes=len(body), sha256=sha(body), bytes_resposta=len(original), sha256_resposta=sha(original)))
    prov = dict(adquirido_em=datetime.now(timezone.utc).isoformat(), arquivos=refs,
        paginas=[FAPESPA + "2024/", "https://imrs.fjp.mg.gov.br/consultas"])
    (root / "proveniencia.json").write_bytes(compacto(prov))
    return prov


def nome_chave(s):
    return " ".join(re.sub(r"[-–]", " ", unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()).split())


def nome_municipio_pa(s):
    # Grafias dos anuários 2018/2020; correspondência exata, exclusiva do PA.
    aliases = {"santa isabel do para": "santa izabel do para", "eldorado dos carajas": "eldorado do carajas"}
    n = nome_chave(s)
    return aliases.get(n, n)


def tabela_fapespa(tabela, municipios_pa):
    nomes = {nome_chave(nome): cod for cod, nome in municipios_pa}
    assert len(nomes) == len(municipios_pa)
    assert "total de familias inscritas no cadastro unico" in nome_chave(tabela.iloc[2, 0])
    assert nome_chave(tabela.iloc[4, 0]) == "estado/municipio"
    anos = [int(str(x).removesuffix(".0").removesuffix("*")) for x in tabela.iloc[4, 1:]]
    assert anos == sorted(set(anos))
    linhas = tabela.iloc[6:6+len(nomes)]
    assert {nome_municipio_pa(x) for x in linhas.iloc[:, 0]} == set(nomes), "Cobertura PA mudou"
    assert len(set(linhas.iloc[:, 0])) == len(linhas), "Município PA repetido"
    rows = []
    for _, linha in linhas.iterrows():
        cod = nomes[nome_municipio_pa(linha.iloc[0])]
        for ano, x in zip(anos, linha.iloc[1:]):
            # Traço significa ausência na tabela original, nunca zero.
            valor = np.nan if pd.isna(x) or str(x).strip() == "-" else float(x)
            assert pd.isna(valor) or np.isfinite(valor) and valor >= 0 and valor.is_integer(), "Contagem PA inválida"
            rows.append(dict(cod_ibge=cod, ano=ano, familias=valor,
                mes=7.0 if ano == 2024 else np.nan))
    d = pd.DataFrame(rows)
    total = pd.to_numeric(tabela.iloc[5, 1:], errors="raise").to_numpy(float)
    assert nome_chave(tabela.iloc[5, 0]) == "para"
    assert np.array_equal(d.groupby("ano").familias.sum().to_numpy(), total), "Total PA difere dos municípios"
    if 2024 in anos:
        notas = " ".join(nome_chave(x) for x in tabela.iloc[:, 0].dropna())
        assert "julho de 2024" in notas, "Revisar mês de referência PA 2024"
    return d[d.ano >= 2013].copy()


def juntar_edicoes(tabelas):
    d = pd.concat(tabelas, ignore_index=True)
    # Edições sobrepostas só podem ser unificadas se repetem os mesmos valores.
    for _, g in d.groupby(["cod_ibge", "ano"]):
        assert g.familias.nunique(dropna=False) == 1 and g.mes.nunique(dropna=False) == 1, "Edições PA divergentes"
    return d.drop_duplicates(["cod_ibge", "ano"]).sort_values(["ano", "cod_ibge"]).reset_index(drop=True)


def normalizar_fjp(obj, meta, municipios_mg):
    assert obj.get("status") == meta.get("status") == "success"
    assert len(meta["message"]) == 1
    md = meta["message"][0]
    assert md["sigla"] == "AS_POPCADUNICO" and md["unidade"] == "%" and md["periodicidade"] == "Anual"
    assert "populacao total" in nome_chave(md["descricao"]), "Revisar universo FJP"
    cidades = obj["values"]
    assert len(cidades) == len(municipios_mg) and {int(m["cd_geocodm"]) for m in cidades} == set(municipios_mg)
    rows = []
    for m in cidades:
        for r in m["valores"]:
            assert r["id_indicador"] == 90, "Indicador FJP diferente do solicitado"
            ano = int(r["edicoes"]["nome"])
            assert 2013 <= ano <= 2024
            x = r["valor"]
            valor = np.nan if x is None or str(x).strip() in ["", "-", "..", "..."] else float(x)
            assert pd.isna(valor) or np.isfinite(valor) and valor >= 0, "Percentual FJP inválido"
            # A fonte é cadastral / população estimada: pode ultrapassar 100%.
            # Não truncar nem usar este percentual para inventar contagens.
            rows.append(dict(cod_ibge=int(m["cd_geocodm"]), ano=ano, percentual_pessoas_fjp=valor, mes=np.nan))
    d = pd.DataFrame(rows)
    assert not d.duplicated(["cod_ibge", "ano"]).any(), "Município/ano FJP repetido"
    anos = sorted(d.ano.unique())
    assert anos == list(range(2014, 2025)), "Nova cobertura FJP: revisar"
    for _, g in d.groupby("ano"):
        assert set(g.cod_ibge) == set(municipios_mg), "Cobertura anual FJP incompleta"
    return d.sort_values(["ano", "cod_ibge"]).reset_index(drop=True)


class QuadroEstadual(Quadro):
    def grupo(self, pos, municipio=False, incluir_ressalvas=False):
        if not municipio and len(pos) == self.valores.shape[1]:
            # Cobertura de um estado não vira referência nacional.
            assert set(pos) == set(range(self.valores.shape[1]))
            return {k: [5 if k == "c" else 0 if k == "q" else None] * len(self.periodos) for k in ["v", "n", "d", "c", "q"]}
        resultado = super().grupo(pos, municipio, incluir_ressalvas)
        fora = (self.condicoes[:, pos] == 5).all(axis=1)
        resultado['c'] = [5 if fora[k] else c for k, c in enumerate(resultado['c'])]
        return resultado


def quadros_estaduais(fontes, g):
    root = Path(fontes)
    prov = json.loads((root / "proveniencia.json").read_bytes())
    refs = {r["arquivo"]: r for r in prov["arquivos"]}
    assert set(refs) == set(DISTRIBUICOES) | {"fjp_metadados.json", "fjp_valores.json"}
    for nome, r in refs.items():
        b = (root / nome).read_bytes()
        assert len(b) == r["bytes"] and sha(b) == r["sha256"], "Fonte alterada: " + nome
    pa = [(x[0], x[1]) for x in g.m if x[2] == "PA"]
    mg = [x[0] for x in g.m if x[2] == "MG"]
    assert len(pa) == 144 and len(mg) == 853
    dpa = juntar_edicoes([tabela_fapespa(pd.read_excel(root/n, header=None, engine="openpyxl"), pa) for n in DISTRIBUICOES])
    assert sorted(dpa.ano.unique()) == list(range(2013, 2025)) and len(dpa) == 144 * 12
    faltas = dpa[dpa.familias.isna()][["cod_ibge", "ano"]].to_records(index=False).tolist()
    assert faltas == [(1504752, 2013)], "Ausências PA mudaram: revisar"
    dmg = normalizar_fjp(json.loads((root/"fjp_valores.json").read_bytes()), json.loads((root/"fjp_metadados.json").read_bytes()), mg)
    out = []
    for id, df, coluna, pt, en, aviso, aviso_en, fonte_nome, url in [
        ("cad_hist_pa_familias_anual", dpa, "familias", "Famílias no CadÚnico por 1.000 habitantes · PA, anual", "Families in Cadastro Único per 1,000 residents · PA, yearly", AVISO_PA, AVISO_PA_EN, "MDS/SAGI · Fapespa (anuários 2018, 2020 e 2024)", FAPESPA + "2024/"),
        ("cad_hist_mg_pessoas_pct", dmg, "percentual_pessoas_fjp", "População no CadÚnico (%) · MG, anual", "Population in Cadastro Único (%) · MG, yearly", AVISO_MG, AVISO_MG_EN, "Fundação João Pinheiro · IMRS · MDS/SAGI", "https://imrs.fjp.mg.gov.br/consultas"),
    ]:
        anos = sorted(int(x) for x in df.ano.unique())
        v = np.full((len(anos), len(g.m)), np.nan)
        posano = {y: j for j, y in enumerate(anos)}
        for _, r in df.iterrows(): v[posano[int(r.ano)], g.pos[int(r.cod_ibge)]] = r[coluna]
        c = np.where(np.isfinite(v), np.where(v == 0, 1, 0), 2).astype(np.uint8)
        pa_count = coluna == "familias"
        uf = 'PA' if pa_count else 'MG'
        c[:, [x[2] != uf for x in g.m]] = 5
        definicao = dict(id=id, nome=pt, nome_en=en,
            descricao="Famílias inscritas no Cadastro Único, nas observações anuais redistribuídas pela Fapespa. Não representa quantidade de benefícios recebidos." if pa_count else "Parcela da população do município inscrita no Cadastro Único, conforme o percentual publicado no IMRS. Cadastro não é taxa de pobreza ou recebimento de benefício.",
            descricao_en="Families registered in Cadastro Único, from yearly observations redistributed by Fapespa. Not a count of benefits received." if pa_count else "Share of the municipality's population registered in Cadastro Único, as published by IMRS. Registration is not a poverty rate or receipt of a benefit.",
            tema="CadÚnico: histórico anual · outras fontes oficiais", tema_en="Cadastro Único: annual history · other official sources",
            unidade="famílias por 1.000 habitantes" if pa_count else "% da população residente",
            unidade_en="families per 1,000 residents" if pa_count else "% of resident population", formato="numero" if pa_count else "percentual",
            nome_original="Famílias cadastradas" if pa_count else "População no CadÚnico (%)",
            nome_original_en="Registered families" if pa_count else "Population in Cadastro Único (%)",
            unidade_original="famílias" if pa_count else "%", frequencia="anual", fator=1000 if pa_count else 1,
            metodo_referencia="razao" if pa_count else "mediana", ranking=True, minimo=0,
            fonte_nome=fonte_nome, fontes=[dict(nome=fonte_nome, url=url)], alerta=aviso, alerta_en=aviso_en,
            historico_cadunico=True, ufs_historico=["PA" if pa_count else "MG"],
            cobertura_titulo="Pará: 144 municípios, 2013–2024." if pa_count else "Minas Gerais: 853 municípios, 2014–2024.",
            cobertura_titulo_en="Pará: 144 municipalities, 2013–2024." if pa_count else "Minas Gerais: 853 municipalities, 2014–2024.",
            cobertura_nota="2024 refere-se a julho; até 2023 o mês não é informado. Mojuí dos Campos em 2013 permanece ausente. Brasil fora da cobertura." if pa_count else "Percentuais municipais publicados, sem contagens inferidas. Regiões e MG usam medianas dos municípios, identificadas abaixo. Brasil fora da cobertura.",
            cobertura_nota_en="2024 refers to July; the month is unspecified through 2023. Mojuí dos Campos in 2013 stays missing. Brazil is outside coverage." if pa_count else "Published municipal percentages, without inferred counts. Regional and MG references use municipal medians, labelled below. Brazil is outside coverage.",
            normalizacao="Famílias cadastradas / população de referência do IBGE × 1.000. Regiões e PA: razão das somas dos municípios com dados. Brasil indisponível." if pa_count else "Percentual municipal publicado pelo IMRS, sem inferir contagens. Regiões e MG: mediana dos percentuais municipais disponíveis. Brasil indisponível.",
            normalizacao_en="Registered families / IBGE reference population × 1,000. Regional and PA references: ratio of sums for municipalities with data. Brazil unavailable." if pa_count else "Municipal percentage published by IMRS, without inferred counts. Regional and MG references: median of available municipal percentages. Brazil unavailable.")
        if pa_count:
            base, anos_base = g.populacao(anos)
            baseq = por_base(definicao, anos, v, c, base, base_anos=anos_base)
            q = QuadroEstadual(**vars(baseq))
            q.definicao["notas_anos"] = {"2024": ["Referência: julho de 2024 (Fapespa). Não é acumulado anual.", "Reference: July 2024 (Fapespa). Not an annual total."]}
        else:
            q = QuadroEstadual(definicao, anos, v, np.full_like(v, np.nan), np.full_like(v, np.nan), c, originais=v.copy())
        out.append(q)
    dpa["fonte"] = "MDS/SAGI; Fapespa"
    dmg["fonte"] = "MDS/SAGI; Fundação João Pinheiro (IMRS)"
    tabela = pd.concat([dpa, dmg], ignore_index=True)
    tabela["municipio"] = tabela.cod_ibge.map({x[0]: x[1] for x in g.m})
    tabela["uf"] = tabela.cod_ibge.map({x[0]: x[2] for x in g.m})
    tabela["territorio"] = tabela.cod_ibge.astype(str)
    tabela["frequencia"] = "anual"
    tabela["condicao"] = np.where(tabela.familias.notna() | tabela.percentual_pessoas_fjp.notna(), "registrado", "sem_publicacao_confirmada")
    return out, tabela, prov


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, required=True)
    print(json.dumps(baixar(parser.parse_args().saida), ensure_ascii=True), flush=True)
