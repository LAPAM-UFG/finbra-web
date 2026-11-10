"""Cobertura vacinal oficial por residência (PNI / InfoMS), 2015–2025: leitura dos brutos, auditoria e agregados candidatos.

Origem dos dados: pipeline/vacinacao_baixar.py (páginas do cubo Qlik em E:/finbra/brutos/vacinacao/<ano>).

Medidas (por ano × território × imunobiológico), exatamente como o painel oficial as entrega:
    numerador     doses (até 2022, por tipo de dose) ou pessoas vacinadas (2023 em diante, por indivíduo)
    denominador   SINASC vigente (ou anterior, quando indisponível) para menores de 1 ano e crianças de 1 ano;
                  aos 4 anos, SINASC do ano de nascimento da coorte. Preserva-se a base oficial; nunca população SVS/IBGE
    cobertura     RAZÃO de 0 a 1 (0,72 = 72%), numerador ÷ denominador; o rótulo oficial "(%)" não significa que o valor venha multiplicado
                  por 100. Pode passar de 100% (observado, não se limita); só existe quando o denominador é positivo.
Regras de integridade:
    - denominador zero ou ausente: cobertura NÃO calculável (cobertura vazia, status "denominador_zero"). A expressão oficial devolve a
      sentinela 0,0000001 quando há numerador e a base é zero: é guardada só em cobertura_fonte, nunca como cobertura verdadeira;
    - célula ausente (NaN) é ausência, nunca zero: sem linha; zero só existe como numerador zero com denominador positivo;
    - o catálogo de imunobiológicos varia por ano (14 em 2015/2022, 22 em 2023/2024, 21 em 2025): não se emenda por nome parecido;
      o rótulo original de cada ano é preservado e o identificador é só o rótulo sem acento/símbolos;
    - até 2022 o método é "tipo_de_dose"; de 2023 em diante, "individuo" (NT 84/2026-DPNI/SVSA/MS): as duas séries não são comparáveis;
    - UF e Brasil vêm dos totalizadores oficiais (vacinacao_territorios), nunca da média dos percentuais municipais.

Saídas candidatas (nunca o gold publicado):
    gold/saude/vacinacao.parquet             ano × município (código de 6 dígitos) × imunobiológico
    gold/saude/vacinacao_territorios.parquet ano × (Brasil, região, UF, macrorregião, região de saúde) × imunobiológico, oficiais
    gold/saude/vacinacao_catalogo.parquet    ano × imunobiológico: rótulo, método, cobertura de municípios, meta oficial quando confirmada
    gold/manifesto.json                      o publicado mais fontes.vacinacao
    auditoria/                               linhas lidas, rejeitadas, conferências

Uso:
    py pipeline/vacinacao.py candidato --saida E:/finbra/candidato_vacinacao_20261110
"""
import argparse
import gzip
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from vacinacao_baixar import ANOS, APP_ID, BRUTOS_PADRAO, OBJETO, URL_FONTE, destino_em_raiz, ler_pagina, sha256

UF_POR_COD = {
    11: "RO", 12: "AC", 13: "AM", 14: "RR", 15: "PA", 16: "AP", 17: "TO", 21: "MA", 22: "PI", 23: "CE",
    24: "RN", 25: "PB", 26: "PE", 27: "AL", 28: "SE", 29: "BA", 31: "MG", 32: "ES", 33: "RJ", 35: "SP",
    41: "PR", 42: "SC", 43: "RS", 50: "MS", 51: "MT", 52: "GO", 53: "DF",
}
COD_POR_UF = {v: k for k, v in UF_POR_COD.items()}
NIVEIS_PUBLICADOS = ("BR", "REGIAO", "UF")  # macrorregião e região de saúde ficam só na auditoria (a mesma região pode repetir-se sob duas macros)
NIVEIS = ("BR", "REGIAO", "UF", "MACRO", "REGIAO_SAUDE", "MUNICIPIO")
ULTIMO_ANO_TIPO_DE_DOSE = 2022
SENTINELA = 1e-7  # valor que a expressão oficial devolve com numerador positivo e denominador zero
URL_NT84 = "https://www.gov.br/saude/pt-br/centrais-de-conteudo/publicacoes/notas-tecnicas/2026/nota-tecnica-no-84-2026-dpni-svsa-ms.pdf"
URL_NT87 = "https://www.gov.br/saude/pt-br/composicao/svsa/pni/notas-tecnicas/2026/nota-tecnica-no-87-2026-cgici-dpni-svsa-ms"
URL_NT91 = "https://www.gov.br/saude/pt-br/composicao/svsa/pni/notas-tecnicas/2026/nota-tecnica-no-91-2026-cgici-dpni-svsa-ms"

# As NT 87/91 descrevem as coberturas por indivíduo, reaplicadas pelo painel desde 2023.
# Não se projetam essas metas sobre rótulos/esquemas históricos não confirmados. Em particular,
# febre amarela tinha meta de 100% nas áreas recomendadas em 2015, não 95% universal.
# Hepatite B <=1/2 dias são indicadores de oportunidade, sem meta nas notas técnicas.
META_FONTE = "Metas mínimas do PNI/Ministério da Saúde para as vacinas do primeiro ano de vida"
METAS_HISTORICAS = {  # apenas os rótulos históricos já confirmados; meta em razão (0–1)
    "bcg": 0.90, "rotavirus": 0.90,
    "penta_dtp_hepb_hib": 0.95, "pneumo_10": 0.95, "meningo_c": 0.95, "triplice_viral_1_dose": 0.95,
}
METAS_INDIVIDUO = {
    "bcg": 0.90, "rotavirus": 0.90,
    **dict.fromkeys(("dtp_1_reforco", "dtp_2_reforco", "febre_amarela", "febre_amarela_reforco", "hepatite_a_infantil",
                     "hepatite_b_le_30_dias", "meningococica_conjugada", "meningococica_conjugada_1_reforco", "penta_dtp_hepb_hib",
                     "pneumococica_conjugada", "pneumococica_conjugada_1_reforco", "poliomielite", "poliomielite_1_reforco",
                     "poliomielite_2_reforco", "triplice_viral_1_dose", "triplice_viral_2_dose", "varicela", "varicela_2_dose"), 0.95),
}


def metodo_do_ano(ano: int) -> str:
    return "tipo_de_dose" if ano <= ULTIMO_ANO_TIPO_DE_DOSE else "individuo"


def meta_do(imuno_id: str, ano: int) -> float | None:
    """Meta oficial confirmada para o rótulo, ou None (sem meta: o site não desenha linha de meta nem compara)."""
    if not ANOS[0] <= ano <= ANOS[1]:
        return None
    return (METAS_HISTORICAS if ano <= ULTIMO_ANO_TIPO_DE_DOSE else METAS_INDIVIDUO).get(imuno_id)


def identificador(rotulo: str) -> str:
    """Rótulo oficial → identificador estável (sem acento, símbolos de comparação por extenso). Não emenda rótulos diferentes."""
    t = rotulo.replace("<=", " le ").replace(">=", " ge ").replace("<", " lt ").replace(">", " gt ")
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "_", t).strip("_")


# ----------------------------------------------------------------------------------------------------------------- leitura
def achatar(nos: list, prefixo: tuple = ()) -> list[tuple]:
    """Caminhos folha→raiz do cubo pivô: tuplas de (texto, tipo, elemento) por dimensão."""
    saida = []
    for n in nos:
        caminho = prefixo + ((n.get("qText") or "", n.get("qType"), n.get("qElemNo")),)
        if n.get("qSubNodes"):
            saida.extend(achatar(n["qSubNodes"], caminho))
        else:
            saida.append(caminho)
    return saida


def numero(celula: dict):
    """qNum de uma célula; 'NaN'/ausente → None (ausência, nunca zero)."""
    v = celula.get("qNum")
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v:
        return None
    return v


def classificar(caminho: tuple[str, ...]) -> tuple[str, str, str]:
    """(nível, código, rótulo) de uma linha do cubo, a partir dos 6 rótulos Brasil→Região→UF→Macrorregião→Região de Saúde→Município.
    A primeira posição 'Totais' marca a linha de totalizador daquele nível (as seguintes vêm vazias)."""
    if len(caminho) != 6:
        raise ValueError(f"caminho com {len(caminho)} níveis: {caminho}")
    for i, texto in enumerate(caminho[1:], start=1):
        if texto == "Totais":
            if any(caminho[j] for j in range(i + 1, 6)):
                raise ValueError(f"totalizador com níveis abaixo: {caminho}")
            nivel = NIVEIS[i - 1]
            ref = caminho[i - 1]
            codigo = "BR" if nivel == "BR" else _codigo_rotulo(ref, nivel)
            if nivel == "REGIAO_SAUDE":  # em alguns anos (ex.: 11003 em RO, 2015) a mesma região aparece sob duas macrorregiões
                codigo = _codigo_rotulo(caminho[3], "MACRO") + ":" + codigo
            return nivel, codigo, ref
    folha = caminho[5]
    if not re.match(r"^\d{6} - ", folha):
        raise ValueError(f"município sem código de 6 dígitos: {caminho}")
    return "MUNICIPIO", folha[:6], folha[9:]


def _codigo_rotulo(ref: str, nivel: str) -> str:
    if nivel in ("MACRO", "REGIAO_SAUDE"):
        m = re.match(r"^(\d+) - ", ref)
        if not m:
            raise ValueError(f"{nivel} sem código: {ref!r}")
        return m.group(1)
    return ref  # região (nome) ou UF (sigla)


class ErroDeIntegridade(Exception):
    pass


def ler_ano(raiz: Path, ano: int) -> dict:
    """Lê as páginas do ano (conferindo o SHA-256 de cada uma) e devolve {'registros': [...], 'auditoria': {...}}.
    Cada registro: ano, nivel, codigo, rotulo, uf, imunobiologico (rótulo oficial), cobertura_fonte, numerador, denominador, texto_cobertura."""
    pasta = raiz / str(ano)
    mf = json.loads((pasta / "manifesto.json").read_text(encoding="utf-8"))
    if not mf.get("completo") or mf.get("ano") != ano:
        raise ErroDeIntegridade(f"{ano}: captura incompleta ou de outro ano")
    linhas_cubo, colunas_cubo = mf["cubo"]["linhas"], mf["cubo"]["colunas"]
    dic: dict[int, dict[int, str]] = {}  # por nível: elemento → texto (ancestrais cortados pela paginação voltam sem texto)
    cabecalho = None
    registros, vistos, linhas_lidas = [], set(), 0
    for i, (topo, altura) in enumerate(mf["plano"]):
        arq = pasta / f"pagina_{i:04d}.json.gz"
        bruto = ler_pagina(arq)
        esperado = mf["paginas"].get(f"{i:04d}")
        if not esperado or len(bruto) != esperado.get("bytes") or sha256(bruto) != esperado.get("sha256"):
            raise ErroDeIntegridade(f"{ano}: página {i} não confere com o tamanho/hash do manifesto")
        pg = json.loads(bruto)
        esquerda, topo_cols, dados = achatar(pg["qLeft"]), achatar(pg["qTop"]), pg["qData"]
        if len(esquerda) != altura or len(dados) != altura:
            raise ErroDeIntegridade(f"{ano}: página {i} com {len(esquerda)}/{len(dados)} linhas, esperado {altura}")
        cols = [(c[0][0], c[1][0]) for c in topo_cols]
        if len(cols) != colunas_cubo:
            raise ErroDeIntegridade(f"{ano}: página {i} com {len(cols)} colunas, esperado {colunas_cubo}")
        if cabecalho is None:
            cabecalho = cols
        elif cols != cabecalho:
            raise ErroDeIntegridade(f"{ano}: cabeçalho da página {i} difere do da primeira")
        for caminho, linha in zip(esquerda, dados):
            rotulos = []
            for nivel, (texto, tipo, elem) in enumerate(caminho):
                if texto:
                    dic.setdefault(nivel, {})[elem] = texto
                elif tipo == "E":
                    texto = ""
                else:
                    texto = dic.get(nivel, {}).get(elem)
                    if texto is None:
                        raise ErroDeIntegridade(f"{ano}: ancestral sem rótulo (nível {nivel}, elemento {elem}) na página {i}")
                rotulos.append(texto)
            nivel_t, codigo, rotulo = classificar(tuple(rotulos))
            uf = None
            if nivel_t == "MUNICIPIO":
                uf = UF_POR_COD.get(int(codigo) // 10000)
                if rotulos[2] != uf:
                    raise ErroDeIntegridade(f"{ano}: município {codigo} sob a UF {rotulos[2]!r}, mas o código indica {uf!r}")
            elif nivel_t == "UF":
                uf = codigo
            if len(linha) != len(cols):
                raise ErroDeIntegridade(f"{ano}: linha com {len(linha)} células, esperado {len(cols)}")
            linhas_lidas += 1
            por_imuno: dict[str, dict] = {}
            for (imuno, medida), cel in zip(cols, linha):
                por_imuno.setdefault(imuno, {})[medida] = cel
            for imuno, ms in por_imuno.items():
                cob, num, den = ms.get("Cobertura Vacinal (%)"), ms.get("Numerador"), ms.get("Denominador")
                if cob is None or num is None or den is None:
                    raise ErroDeIntegridade(f"{ano}: medidas incompletas para {imuno!r}: {sorted(ms)}")
                vc, vn, vd = numero(cob), numero(num), numero(den)
                if vc is None and vn is None and vd is None:
                    continue  # imunobiológico fora do catálogo do ano / sem registro: ausência
                chave = (nivel_t, codigo, imuno)
                if chave in vistos:
                    raise ErroDeIntegridade(f"{ano}: linha duplicada {chave}")
                vistos.add(chave)
                registros.append({"ano": ano, "nivel": nivel_t, "codigo": codigo, "rotulo": rotulo, "uf": uf, "imunobiologico": imuno,
                                  "cobertura_fonte": vc, "numerador": vn, "denominador": vd, "texto_cobertura": cob.get("qText")})
    if linhas_lidas != linhas_cubo:
        raise ErroDeIntegridade(f"{ano}: {linhas_lidas} linhas lidas, o cubo declara {linhas_cubo}")
    return {"registros": registros, "auditoria": {"ano": ano, "linhas_cubo": linhas_cubo, "colunas_cubo": colunas_cubo, "paginas": len(mf["plano"]),
                                                  "imunobiologicos_no_cabecalho": sorted({c[0] for c in cabecalho}),
                                                  "registros": len(registros), "capturado_em": mf.get("concluido_em")}}


# ------------------------------------------------------------------------------------------------------------ normalização
def normalizar(r: dict) -> dict:
    """Aplica as regras de integridade a um registro lido. Acrescenta: imuno_id, metodo, cobertura, status."""
    num, den, cob = r["numerador"], r["denominador"], r["cobertura_fonte"]
    saida = {**r, "imuno_id": identificador(r["imunobiologico"]), "metodo": metodo_do_ano(r["ano"])}
    if den is None or num is None:
        saida.update(cobertura=None, status="sem_valor")
    elif den <= 0:
        # inclui a sentinela 0,0000001 (numerador positivo, base zero): não é cobertura verdadeira
        saida.update(cobertura=None, status="denominador_zero")
    else:
        recalculada = num / den
        if cob is None or abs(cob - recalculada) > 1e-6 * max(1.0, abs(recalculada)):
            saida.update(cobertura=recalculada, status="recalculada")  # a fonte não traz valor ou diverge: vale o numerador ÷ denominador
        else:
            saida.update(cobertura=cob, status="ok")
    return saida


def validar_unicidade_de_ids(rotulos_por_ano: dict[int, set]) -> None:
    ids: dict[str, set] = {}
    for rotulos in rotulos_por_ano.values():
        for rot in rotulos:
            ids.setdefault(identificador(rot), set()).add(rot)
    colisoes = {k: v for k, v in ids.items() if len(v) > 1}
    if colisoes:
        raise ErroDeIntegridade(f"rótulos distintos com o mesmo identificador: {colisoes}")


ESQ_MUN = pa.schema([("ano", pa.int16()), ("municipio", pa.int32()), ("cod_ibge", pa.int32()), ("uf", pa.string()), ("imunobiologico", pa.string()),
                     ("metodo", pa.string()), ("numerador", pa.int64()), ("denominador", pa.int64()), ("cobertura", pa.float64()),
                     ("cobertura_fonte", pa.float64()), ("status", pa.string())])
ESQ_TER = pa.schema([("ano", pa.int16()), ("nivel", pa.string()), ("codigo", pa.string()), ("rotulo", pa.string()), ("uf", pa.string()),
                     ("cod_uf", pa.int16()), ("imunobiologico", pa.string()), ("metodo", pa.string()), ("numerador", pa.int64()),
                     ("denominador", pa.int64()), ("cobertura", pa.float64()), ("cobertura_fonte", pa.float64()), ("status", pa.string())])
ESQ_CAT = pa.schema([("ano", pa.int16()), ("imunobiologico", pa.string()), ("rotulo", pa.string()), ("metodo", pa.string()), ("ordem", pa.int16()),
                     ("municipios", pa.int32()), ("municipios_calculaveis", pa.int32()), ("meta", pa.float64()), ("meta_fonte", pa.string())])


def _inteiro(v):
    if v is None:
        return None
    if abs(v - round(v)) > 1e-9:
        raise ErroDeIntegridade(f"valor não inteiro onde se esperava contagem: {v}")
    return int(round(v))


def montar(raiz: Path, anos: list[int], cadastro: dict[int, int]) -> dict:
    """Lê todos os anos e monta as três tabelas (listas de dicts) mais a auditoria."""
    mun, ter, aud, auditoria_niveis = [], [], [], {}
    rotulos_por_ano = {}
    for ano in anos:
        lido = ler_ano(raiz, ano)
        aud.append(lido["auditoria"])
        rotulos_por_ano[ano] = {r["imunobiologico"] for r in lido["registros"]}
        for r in map(normalizar, lido["registros"]):
            comum = dict(ano=ano, imunobiologico=r["imuno_id"], metodo=r["metodo"], numerador=_inteiro(r["numerador"]), denominador=_inteiro(r["denominador"]),
                         cobertura=r["cobertura"], cobertura_fonte=r["cobertura_fonte"], status=r["status"])
            auditoria_niveis[(ano, r["nivel"])] = auditoria_niveis.get((ano, r["nivel"]), 0) + 1
            if r["nivel"] == "MUNICIPIO":
                cod6 = int(r["codigo"])
                mun.append({**comum, "municipio": cod6, "cod_ibge": cadastro.get(cod6), "uf": r["uf"]})
            elif r["nivel"] in NIVEIS_PUBLICADOS:
                cod_uf = COD_POR_UF.get(r["codigo"]) if r["nivel"] == "UF" else None
                ter.append({**comum, "nivel": r["nivel"], "codigo": r["codigo"], "rotulo": r["rotulo"], "uf": r["uf"], "cod_uf": cod_uf})
    validar_unicidade_de_ids(rotulos_por_ano)
    # catálogo: rótulo original por ano, na ordem em que o painel os entrega
    cat = []
    for ano in anos:
        por_id = {}
        for r in mun:
            if r["ano"] == ano:
                d = por_id.setdefault(r["imunobiologico"], [0, 0])
                d[0] += 1
                d[1] += r["cobertura"] is not None
        rotulos = {identificador(x): x for x in rotulos_por_ano[ano]}
        ids = sorted(set(rotulos) | set(r["imunobiologico"] for r in ter if r["ano"] == ano))
        for ordem, i in enumerate(ids):
            m = meta_do(i, ano)
            n, c = por_id.get(i, (0, 0))
            cat.append({"ano": ano, "imunobiologico": i, "rotulo": rotulos[i], "metodo": metodo_do_ano(ano), "ordem": ordem,
                        "municipios": n, "municipios_calculaveis": c, "meta": m,
                        "meta_fonte": (f"NT 87/2026 e NT 91/2026, coberturas desde 2023: {URL_NT87}; {URL_NT91}"
                                       if ano >= 2023 else META_FONTE) if m is not None else None})
    return {"municipal": mun, "territorios": ter, "catalogo": cat, "auditoria": aud,
            "niveis": [{"ano": a, "nivel": n, "linhas": k} for (a, n), k in sorted(auditoria_niveis.items())]}


def gravar(tab: list[dict], esquema: pa.Schema, destino: Path) -> None:
    t = pa.Table.from_pylist([{c: r.get(c) for c in esquema.names} for r in tab], schema=esquema)
    pq.write_table(t, destino, compression="zstd")


def cadastro_municipios(base: Path) -> dict[int, int]:
    """Código de 6 dígitos → IBGE de 7, pelo cadastro já publicado (gold/saude/municipios.parquet): é o mesmo que o painel de saúde usa."""
    con = duckdb.connect()
    arq = (base / "saude" / "municipios.parquet").as_posix()
    linhas = con.execute(f"SELECT DISTINCT municipio, cod_ibge FROM '{arq}' WHERE cod_ibge IS NOT NULL").fetchall()
    return {int(m): int(c) for m, c in linhas}


# --------------------------------------------------------------------------------------------------------- manifesto, destinos
def fonte_vacinacao(con, arquivo: Path) -> dict:
    """Entrada do manifesto (fontes.vacinacao): anos, métodos e a referência da fonte."""
    a = arquivo.as_posix()
    anos = [r[0] for r in con.execute(f"SELECT DISTINCT ano FROM '{a}' ORDER BY 1").fetchall()]
    quando = datetime.fromtimestamp(arquivo.stat().st_mtime, timezone.utc).isoformat(timespec="seconds")
    metodos = {}
    for ano in anos:
        metodos.setdefault(metodo_do_ano(ano), []).append(ano)
    return {"anos": anos, "metodos": {k: [v[0], v[-1]] for k, v in metodos.items()}, "processado_em": quando, "url": URL_FONTE,
            "notas": {"tipo_de_dose_ate_2022_individuo_desde_2023": URL_NT84, "denominador_sinasc": URL_NT87, "rotavirus_idades": URL_NT91}}


ARQUIVOS_CANDIDATOS = (
    "gold/saude/vacinacao.parquet", "gold/saude/vacinacao_territorios.parquet", "gold/saude/vacinacao_catalogo.parquet", "gold/manifesto.json",
    "auditoria/vacinacao/leitura.json", "auditoria/vacinacao/status_municipal.csv", "auditoria/vacinacao/territorios.csv",
    "auditoria/vacinacao/municipios_sem_cadastro.csv", "auditoria/vacinacao/divergencia_uf_x_municipios.csv",
)


def validar_destinos(base: Path, saida: Path, brutos: Path = BRUTOS_PADRAO) -> None:
    """Recusa, antes de escrever, qualquer --saida que seja o gold publicado, esteja dentro dele (ou o contenha) ou caia em dados publicados."""
    base, saida, brutos = base.resolve(), saida.resolve(), brutos.resolve()

    def dentro(a: Path, b: Path) -> bool:  # a é b ou está dentro de b
        return a == b or b in a.parents

    # Resolve também os arquivos finais: uma raiz segura pode conter junctions/symlinks
    # em gold, auditoria ou num único arquivo apontando para a origem.
    destinos = [saida, *(destino_em_raiz(saida, saida / relativo) for relativo in ARQUIVOS_CANDIDATOS)]
    for destino in destinos:
        for proibido in (base.parent, brutos.parent):  # árvores inteiras de dados e brutos, não só os arquivos lidos
            if dentro(destino, proibido) or dentro(proibido, destino):
                raise ValueError(f"destino inválido: {destino} coincide com {proibido}, está dentro dele ou o contém")
        if any(p.lower() in ("micro", "brutos") for p in destino.parts):
            raise ValueError(f"destino inválido: {destino} está em microdados ou brutos")


def candidato(raiz: Path, base: Path, saida: Path, anos: list[int]) -> None:
    saida = saida.resolve()  # mantém a raiz permitida, mesmo se o caminho informado era um link
    validar_destinos(base, saida, raiz)
    cadastro = cadastro_municipios(base)
    r = montar(raiz, anos, cadastro)
    destino = destino_em_raiz(saida, saida / "gold" / "saude")
    destino.mkdir(parents=True, exist_ok=True)
    (saida / "auditoria").mkdir(parents=True, exist_ok=True)
    gravar(r["municipal"], ESQ_MUN, destino / "vacinacao.parquet")
    gravar(r["territorios"], ESQ_TER, destino / "vacinacao_territorios.parquet")
    gravar(r["catalogo"], ESQ_CAT, destino / "vacinacao_catalogo.parquet")
    con = duckdb.connect()
    manifesto = json.loads((base / "manifesto.json").read_text(encoding="utf-8"))
    manifesto.setdefault("fontes", {})["vacinacao"] = fonte_vacinacao(con, destino / "vacinacao.parquet")
    manifesto["gerado_em"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (saida / "gold" / "manifesto.json").write_text(json.dumps(manifesto, ensure_ascii=False, indent=1), encoding="utf-8")
    auditar(con, r, cadastro, saida / "auditoria")
    print("candidato gerado em", saida)


def auditar(con, r: dict, cadastro: dict[int, int], pasta: Path) -> None:
    """Escreve a auditoria: contagens por ano/nível, status, municípios sem cadastro e divergências hierárquicas."""
    d = pasta / "vacinacao"
    d.mkdir(parents=True, exist_ok=True)
    mun = (pasta.parent / "gold" / "saude" / "vacinacao.parquet").as_posix()
    ter = (pasta.parent / "gold" / "saude" / "vacinacao_territorios.parquet").as_posix()
    (d / "leitura.json").write_text(json.dumps({"fonte": URL_FONTE, "app": APP_ID, "objeto": OBJETO, "anos": r["auditoria"], "linhas_por_nivel": r["niveis"]}, ensure_ascii=False, indent=1), encoding="utf-8")
    con.execute(f"""COPY (SELECT ano, status, count(*) AS linhas FROM '{mun}' GROUP BY ALL ORDER BY 1, 2) TO '{(d / 'status_municipal.csv').as_posix()}' (HEADER)""")
    con.execute(f"""COPY (SELECT ano, nivel, count(DISTINCT codigo) AS territorios, count(*) AS linhas FROM '{ter}' GROUP BY ALL ORDER BY 1, 2) TO '{(d / 'territorios.csv').as_posix()}' (HEADER)""")
    con.execute(f"""COPY (SELECT DISTINCT municipio, uf FROM '{mun}' WHERE cod_ibge IS NULL ORDER BY 1) TO '{(d / 'municipios_sem_cadastro.csv').as_posix()}' (HEADER)""")
    # soma dos municípios × totalizador oficial da UF (diferenças existem: municípios ignorados/residência inválida; só se reporta)
    con.execute(f"""COPY (
        WITH m AS (SELECT ano, uf, imunobiologico, sum(numerador) AS num_mun, sum(denominador) AS den_mun FROM '{mun}' GROUP BY ALL),
             t AS (SELECT ano, uf, imunobiologico, numerador AS num_uf, denominador AS den_uf FROM '{ter}' WHERE nivel = 'UF')
        SELECT t.*, m.num_mun, m.den_mun, t.num_uf - m.num_mun AS dif_num, t.den_uf - m.den_mun AS dif_den
        FROM t JOIN m USING (ano, uf, imunobiologico) WHERE t.num_uf <> m.num_mun OR t.den_uf <> m.den_mun ORDER BY 1, 2, 3)
        TO '{(d / 'divergencia_uf_x_municipios.csv').as_posix()}' (HEADER)""")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("acao", choices=["candidato"])
    p.add_argument("--brutos", default=str(BRUTOS_PADRAO))
    p.add_argument("--base", default="E:/finbra/data/gold", help="gold publicado (somente leitura)")
    p.add_argument("--saida", required=True)
    p.add_argument("--anos", default=f"{ANOS[0]}-{ANOS[1]}")
    a = p.parse_args()
    ini, _, fim = a.anos.partition("-")
    try:
        candidato(Path(a.brutos), Path(a.base), Path(a.saida), list(range(int(ini), int(fim or ini) + 1)))
    except (ValueError, ErroDeIntegridade) as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
