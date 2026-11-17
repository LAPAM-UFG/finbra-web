"""Estoques públicos MDS/VIS DATA: municípios de AL, 27 UFs e cinco regiões.

Distribuição oficial SEPLAG/AL (CC BY). Aquisição separada da geração/publicação.
Não contém registros pessoais e não transforma totais estaduais em municipais.
"""
import argparse
import json
import ssl
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from assistencia_utils import destino_isolado
from comparacoes_base import compacto, sha

PAGINA = "https://dados.al.gov.br/catalogo/dataset/dados-de-assistencia-social"
CATALOGO = "https://dados.al.gov.br/catalogo/api/3/action/package_show?id=dados-de-assistencia-social"
ARQUIVOS = {tipo: f"familias-por-{tipo}-no-cadastro-unico.csv" for tipo in ["municipio", "estado", "regiao"]}
MESES = {n: k for k, n in enumerate(["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"], 1)}
CATEGORIAS = {f"Número total de {n} cadastradas no Cadastro Único": n for n in ["famílias", "pessoas"]}
COLUNAS = {"famílias": "familias", "pessoas": "pessoas"}
UF = dict(zip([11,12,13,14,15,16,17,21,22,23,24,25,26,27,28,29,31,32,33,35,41,42,43,50,51,52,53],
              ["RO","AC","AM","RR","PA","AP","TO","MA","PI","CE","RN","PB","PE","AL","SE","BA","MG","ES","RJ","SP","PR","SC","RS","MS","MT","GO","DF"]))


def baixar(saida):
    root = destino_isolado(Path(saida))
    assert not root.exists() or not any(root.iterdir()), "Use pasta nova/vazia"
    def obter(url):
        with urllib.request.urlopen(url, timeout=60, context=ssl.create_default_context()) as r:
            assert r.url.startswith("https://dados.al.gov.br/"), "Redirecionamento fora da fonte oficial"
            return r.read(50_000_001)
    body = obter(CATALOGO)
    meta = json.loads(body)
    assert meta.get("success") is True and meta["result"]["name"] == "dados-de-assistencia-social"
    assert meta["result"]["license_id"] == "cc-by", "Revisar atribuição/licença"
    recursos = {r["url"].split("/")[-1]: r for r in meta["result"]["resources"]}
    assert set(ARQUIVOS.values()) <= set(recursos)
    for n in ARQUIVOS.values():
        assert recursos[n]["url"].startswith("https://dados.al.gov.br/catalogo/dataset/")
    root.mkdir(parents=True, exist_ok=True)
    (root / "catalogo_alagoas.json").write_bytes(body)
    arquivos = []
    for n in ARQUIVOS.values():
        r = recursos[n]; b = obter(r["url"])
        assert 1000 < len(b) < 50_000_000 and b.startswith(b"co_"), "Distribuição CSV inesperada"
        (root / n).write_bytes(b)
        arquivos.append(dict(arquivo=n, url=r["url"], bytes=len(b), sha256=sha(b), recurso=r["id"], modificado_em=r["last_modified"]))
    prov = dict(adquirido_em=datetime.now(timezone.utc).isoformat(), catalogo=CATALOGO, pagina=PAGINA,
                fonte="MDS/SAGICAD · VIS DATA; distribuição SEPLAG/AL", licenca="CC BY", arquivos=arquivos)
    (root / "proveniencia.json").write_bytes(compacto(prov))
    return prov


def normalizar(tabela, tipo, codigos):
    """Valida chaves, categorias e contagens; preserva zeros publicados."""
    col = {"municipio": "co_mun", "estado": "co_uf", "regiao": "co_reg_geo"}[tipo]
    d = tabela.copy()
    assert {col, "ano", "variavel", "inf_categoria", "inf_subcategoria", "valor"} <= set(d)
    assert set(d.variavel) == {"Cadastro Único"} and set(d.inf_categoria) == set(CATEGORIAS), "Universo cadastral diferente"
    assert d.inf_subcategoria.isin(MESES).all(), "Mês desconhecido"
    for c in [col, "ano", "valor"]:
        d[c] = pd.to_numeric(d[c], errors="raise")
        assert d[c].notna().all() and np.isfinite(d[c]).all() and (d[c] >= 0).all() and (d[c] == np.floor(d[c])).all(), f"{c}: contagem inválida"
    d["competencia"] = d.ano.astype(int) * 100 + d.inf_subcategoria.map(MESES)
    d["medida"] = d.inf_categoria.map(CATEGORIAS).map(COLUNAS)
    assert not d.duplicated([col, "competencia", "medida"]).any(), "Chave repetida"
    assert set(d[col]) == set(codigos), "Territórios inesperados"
    for _, rows in d.groupby(["competencia", "medida"]):
        assert set(rows[col]) == set(codigos), "Cobertura incompleta"
    out = d.pivot(index=[col, "competencia"], columns="medida", values="valor").reset_index()
    assert out[["familias", "pessoas"]].notna().all().all(), "Medida ausente"
    assert (out.pessoas >= out.familias).all(), "Pessoas menores que famílias"
    out[col] = out[col].astype(int)
    return out.rename(columns={col: "codigo"}).rename_axis(columns=None).sort_values(["competencia", "codigo"]).reset_index(drop=True)


def validar_totais(m, u, r, cotejo):
    """AL completo, regiões completas e referências nacionais independentes."""
    cols = ["familias", "pessoas"]
    a = m.groupby("competencia")[cols].sum().sort_index()
    b = u[u.codigo == 27].set_index("competencia")[cols].sort_index()
    pd.testing.assert_frame_equal(a, b, check_dtype=False)
    br = u.groupby("competencia")[cols].sum().sort_index()
    reg = r.groupby("competencia")[cols].sum().sort_index()
    pd.testing.assert_frame_equal(br, reg, check_dtype=False)
    confirmados = {x["competencia"]: x["familias"] for x in cotejo["referencias"]}
    comuns = sorted(set(br.index) & set(confirmados))
    assert comuns, "Sem referência nacional independente"
    for p in comuns:
        assert br.loc[p, "familias"] == confirmados[p], f"Brasil diverge do MDS: {p}"
    return br, len(comuns)


def carregar(fontes, municipios_al):
    root = Path(fontes)
    prov = json.loads((root / "proveniencia.json").read_bytes())
    refs = {x["arquivo"]: x for x in prov["arquivos"]}
    assert set(refs) == set(ARQUIVOS.values())
    for n, ref in refs.items():
        b = (root / n).read_bytes()
        assert len(b) == ref["bytes"] and sha(b) == ref["sha256"], "Fonte alterada: " + n
    m, u, r = [normalizar(pd.read_csv(root / ARQUIVOS[tipo]), tipo, codigos)
               for tipo, codigos in [("municipio", municipios_al), ("estado", UF), ("regiao", range(1,6))]]
    esperados = [a*100+b for a in range(2012,2027) for b in range(1,13) if 201208 <= a*100+b <= 202605 and a*100+b != 202504]
    for d in [m, u, r]:
        assert sorted(d.competencia.unique()) == esperados, "Nova edição: revisar cobertura/períodos"
    cotejo = json.loads(Path(__file__).with_name("referencias").joinpath("cadunico_brasil_cotejo_20261117.json").read_bytes())
    br, n = validar_totais(m, u, r, cotejo)
    assert n == 164, "Revisar cotejo da edição adquirida"
    prov["cotejo"] = dict(meses_mds=n, municipios_al=102, ufs=27, regioes=5, divergencias=0)
    return m[m.competencia >= 201301], u[u.competencia >= 201301], br[br.index >= 201301], prov


def juntar_mensais(tabelas):
    """Uma observação por território/mês; sobreposições exigem valores iguais."""
    d = pd.concat(tabelas, ignore_index=True)
    keys = ["territorio", "ano", "mes"]
    for campo in ["familias", "pessoas"]:
        assert d.groupby(keys)[campo].nunique(dropna=True).le(1).all(), f"Fontes mensais divergentes: {campo}"
    valores = d.groupby(keys, sort=False)[["familias", "pessoas"]].first()
    info = d.groupby(keys, sort=False)[["municipio", "uf"]].first()
    fontes = d.groupby(keys, sort=False).fonte.agg(lambda x: "; ".join(dict.fromkeys(x)))
    out = info.join(valores).join(fontes).reset_index()
    out["pessoas_por_familia"] = out.pessoas / out.familias.where(out.familias > 0)
    out["condicao"] = np.where(out.familias.notna(), "registrado", "sem_publicacao_confirmada")
    out["frequencia"] = "mensal"
    out["percentual_pessoas_fjp"] = np.nan
    assert not out.duplicated(keys).any()
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--saida", type=Path, required=True)
    print(json.dumps(baixar(parser.parse_args().saida), ensure_ascii=True), flush=True)
