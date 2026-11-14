"""Planilhas oficiais do Bolsa Família (MDS, "Bolsa em Números"): aquisição e normalização municipal por competência.

Fonte: https://www.gov.br/mds/pt-br/acoes-e-programas/bolsa-familia/paginas/bolsa-em-numeros
Arquivos: <BASE_URL><ano>/<pasta do mês>/relatorio_pbf_<MM>_<AAAA>_<uf>.xlsx (a pasta de março é "marco"). A lista de pastas é a do JavaScript da
própria página; a listagem HTML de cada pasta pode omitir UFs já publicadas (o JS do site conta com isso), por isso cada UF é sondada por GET
(o servidor responde 403 a HEAD). O que existe é o que responde 200: nenhum mês é presumido.

Uso (Python da .venv do repositório original):
  py pipeline/assistencia_pbf.py baixar     [--saida DIR] [--anos 2021 2026] [--uf PR GO] [--sem-rede-listagem]
  py pipeline/assistencia_pbf.py normalizar [--saida DIR]
  py pipeline/assistencia_pbf.py tudo       [--saida DIR]

Saída (SOMENTE sob --saida; padrão E:/finbra/candidato_assistencia_20261114):
  landing/assistencia/pbf/xlsx/<AAAA>/<MM>/relatorio_pbf_<MM>_<AAAA>_<uf>.xlsx   arquivos originais, escrita atômica, sha256 no catálogo
  landing/assistencia/pbf/listagens/<AAAA>_<MM>.html                             listagem HTML de cada pasta (evidência)
  landing/assistencia/pbf/catalogo_aquisicao.json                                URLs, status HTTP, bytes, sha256, ETag, datas (também é o cache)
  landing/assistencia/pbf/catalogo.json                                          aquisição + variáveis/linhagem + resultado por competência
  silver/assistencia/pbf/pbf_<AAAAMM>.parquet                                    um município por linha (conjunto validado)
  silver/assistencia/pbf/quarentena/tipos_quantidade_<AAAAMM>.parquet            quantidades por tipo cuja competência NÃO foi confirmada

Regras de confiança:
  * A competência vem do TÍTULO da aba Municipio ("Informações sobre o Programa Bolsa Família - JUNHO 2026"). Nome da pasta/arquivo sozinho não
    prova nada: se o título divergir de pasta e nome, o arquivo é rejeitado.
  * Só a aba Municipio (relatório do mês) é lida. A aba oculta nacional rel_beneficios_ibge_202503all e as demais auxiliares nunca entram.
  * As colunas são achadas pelo RÓTULO (normalizado: sem acento, minúsculo), nunca por posição.
  * A aba "Tipos de beneficios" traz quantidades de benefícios por tipo e uma linha "Fonte: Folha de Pagamentos ..., mês/ano". Só se o mês/ano da
    fonte for o da competência as quantidades entram no conjunto validado; senão vão para a quarentena e as colunas ficam null.
  * Linhas de total identificadas por rótulo (Total, Brasil, UF) ficam em catalogo.json (totais), nunca no Parquet. Ausente = null; 0 = 0.
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import re
import sys
import threading
import time
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from pathlib import Path

BASE_URL = "https://www.gov.br/mds/pt-br/acoes-e-programas/bolsa-familia/paginas/bolsa-em-numeros/relatorios/"
PAGINA = "https://www.gov.br/mds/pt-br/acoes-e-programas/bolsa-familia/paginas/bolsa-em-numeros"
SAIDA_PADRAO = Path("E:/finbra/candidato_assistencia_20261114")
PROIBIDOS = (
    Path("E:/finbra/data"),
    Path("D:/LVBERNARDELLI/Dropbox/Meu Drive/ARTIGOS CIENTÍFICOS/Current/Artigo 261 - DashFin/finbra-web"),
    Path(__file__).resolve().parents[1],  # o repositório de código não recebe dados
)
MESES = [("01", "janeiro"), ("02", "fevereiro"), ("03", "marco"), ("04", "abril"), ("05", "maio"), ("06", "junho"),
         ("07", "julho"), ("08", "agosto"), ("09", "setembro"), ("10", "outubro"), ("11", "novembro"), ("12", "dezembro")]
NOME_MES = {"janeiro": 1, "fevereiro": 2, "marco": 3, "abril": 4, "maio": 5, "junho": 6, "julho": 7, "agosto": 8, "setembro": 9,
            "outubro": 10, "novembro": 11, "dezembro": 12}
ABREV_MES = {"jan": 1, "fev": 2, "mar": 3, "abr": 4, "mai": 5, "jun": 6, "jul": 7, "ago": 8, "set": 9, "out": 10, "nov": 11, "dez": 12}
# UF -> código IBGE de 2 dígitos (confere o prefixo do código do município)
UF_COD = {"RO": 11, "AC": 12, "AM": 13, "RR": 14, "PA": 15, "AP": 16, "TO": 17, "MA": 21, "PI": 22, "CE": 23, "RN": 24, "PB": 25, "PE": 26,
          "AL": 27, "SE": 28, "BA": 29, "MG": 31, "ES": 32, "RJ": 33, "SP": 35, "PR": 41, "SC": 42, "RS": 43, "MS": 50, "MT": 51, "GO": 52, "DF": 53}
UFS = sorted(UF_COD)
UA = "Mozilla/5.0 (compatible; finbra-pipeline-pbf/1.0)"
MAX_SIMULTANEOS = 2
TIMEOUT = (15, 180)
TENTATIVAS = 4
RE_ARQ = re.compile(r"relatorio_pbf_(\d{2})_(\d{4})_([a-z]+)\.xlsx", re.I)

# ---------------------------------------------------------------- variáveis (catálogo canônico)
# nome canônico: (regex sobre o rótulo normalizado, tipo, unidade, descrição). Tipo: inteiro | real. Sem acentos, em português.
NOM = "R$ na competencia (nominal)"
# nome canônico: (regex sobre o rótulo normalizado, tipo, unidade, descrição, bloco). Bloco: pbf (programa principal) | gas (Auxílio Gás/Gás do Povo) |
# qualquer (coluna sem grupo). O layout muda muito entre 2023 e 2026: cada rótulo aceito aqui foi visto num arquivo real (ver catalogo.json, rotulos).
MAPA_MUNICIPIO = {
    "estimativa_pobreza": (r"^e(s)?t?imativas? de (familias )?pobre(s|za)?( \d{4})?$", "inteiro", "familias (inferido: cobertura = familias_atendidas / estimativa)",
                           "Estimativa de famílias pobres (denominador da cobertura). O ano da estimativa muda entre arquivos (2012 até 2024; ver estimativa_pobreza_ano); "
                           "a planilha grafa 'Etimativa de Pobreza 2024'", "qualquer"),
    "familias_atendidas": (r"^familias atendidas( pbf)?$", "inteiro", "familias", "Famílias atendidas pelo programa principal na competência (estoque da folha)", "pbf"),
    "familias_em_pagamento": (r"^familias atendidas (em pagamento|nao suspensas)$", "inteiro", "familias",
                              "Famílias atendidas com pagamento (a planilha ora diz 'em pagamento', ora 'não suspensas')", "pbf"),
    "valor_renda_cidadania": (r"^valor beneficio renda de cidadania$", "real", NOM, "Valor pago do Benefício Renda de Cidadania", "pbf"),
    "valor_complementar": (r"^valor beneficio complementar$", "real", NOM, "Valor pago do Benefício Complementar", "pbf"),
    "valor_inicial_sem_primeira_infancia": (r"^valor inicial sem beneficio primeira infancia( pbf)?$", "real", NOM,
                                            "Só em 2023-04 e 2023-05: valor sem o Benefício Primeira Infância", "pbf"),
    "valor_primeira_infancia": (r"^valor beneficio primeira infancia( pbf)?$", "real", NOM, "Valor pago do Benefício Primeira Infância", "pbf"),
    "valor_variavel_gestante": (r"^valor beneficio v[a-z]*avel familiar gestante$", "real", NOM, "Valor pago do Benefício Variável Familiar Gestante", "pbf"),
    "valor_variavel_nutriz": (r"^valor beneficio v[a-z]*avel familiar nutriz$", "real", NOM, "Valor pago do Benefício Variável Familiar Nutriz", "pbf"),
    "valor_variavel_crianca": (r"^valor beneficio v[a-z]*avel familiar crianca$", "real", NOM, "Valor pago do Benefício Variável Familiar Criança", "pbf"),
    "valor_variavel_adolescente": (r"^valor beneficio v[a-z]*avel familiar adolescente$", "real", NOM, "Valor pago do Benefício Variável Familiar Adolescente", "pbf"),
    "valor_extraordinario_transicao": (r"^valor beneficio extraordinario de transicao$", "real", NOM,
                                       "Benefício Extraordinário de Transição (some das planilhas a partir de 2025-06)", "pbf"),
    "valor_desconto_seguro_defeso": (r"^valor de desconto do seguro defeso$", "real", NOM, "Desconto do seguro defeso (só nos arquivos de 2023-11 e 2023-12)", "pbf"),
    "valor_total_planilha": (r"^(total de )?recursos transferidos( pbf)?$", "real", NOM,
                             "Coluna 'Total de Recursos Transferidos' (em 2023-02, 'Recursos Transferidos' do Auxílio Brasil) como vem na planilha. Pode estar errada: ver "
                             "verificacoes.total_igual_regra_protecao_n (em 2026 ela repete valor_regra_protecao); valor_soma_componentes é a conferência", "pbf"),
    "valor_total_descontado_seguro_defeso": (r"^total de recursos transferidos descontado o seguro defeso$", "real", NOM,
                                             "Total já descontado o seguro defeso (só 2023-11 e 2023-12)", "pbf"),
    "cobertura_planilha": (r"^(percentual de cobertura do pbf|familias pobres atendidas)$", "real", "razao (1 = 100%)",
                           "Cobertura publicada = familias_atendidas / estimativa_pobreza (rótulos 'Percentual de Cobertura' e '% Famílias pobres atendidas'); pode passar de 1; "
                           "nunca média de municípios", "pbf"),
    "valor_medio_planilha": (r"^valor medio programa (bolsa familia|auxilio brasil[a-z ]*)( \d+)?$", "real", "R$ por familia (nominal)",
                             "Valor médio publicado; a nota de rodapé não vem no arquivo e a razão não bate sempre com a soma dos componentes por família: não recalcular nem agregar", "pbf"),
    "familias_regra_protecao": (r"^familias em regra de protecao( pbf)?$", "inteiro", "familias", "Famílias na Regra de Proteção", "pbf"),
    "familias_regra_protecao_em_pagamento": (r"^familias em regra de protecao (em pagamento|nao susp[a-z]*)$", "inteiro", "familias",
                                             "Famílias na Regra de Proteção com pagamento ('em pagamento' ou 'não suspensas')", "pbf"),
    "valor_regra_protecao": (r"^(valor em regra de protecao|valrp|valor familias regra de protecao( pbf)?)$", "real", NOM,
                             "Valor pago às famílias na Regra de Proteção (a coluna aparece como 'valrp' em 2025-02-PR)", "pbf"),
    "beneficio_medio_regra_protecao": (r"^beneficio medio para as familias em regra de protecao( pbf)?$", "real", "R$ por familia (nominal)",
                                       "Benefício médio das famílias na Regra de Proteção (publicado)", "pbf"),
    "beneficio_medio_regra_protecao_descontado_seguro_defeso": (r"^beneficio medio para as familias em regra de protecao descontado o seguro defeso$", "real",
                                                                "R$ por familia (nominal)", "Idem, descontado o seguro defeso (só 2023-11 e 2023-12)", "pbf"),
    "familias_canceladas": (r"^familias canceladas$", "inteiro", "familias", "Famílias canceladas na competência (só nos arquivos recentes)", "pbf"),
    "gas_familias_atendidas": (r"^familias atendidas( pagb)?$", "inteiro", "familias", "Auxílio Gás dos Brasileiros / Gás do Povo: famílias atendidas (programa à parte; não soma com o PBF)", "gas"),
    "gas_valor_transferido": (r"^recursos transferidos( pagb)?$", "real", NOM, "Auxílio Gás / Gás do Povo: recursos transferidos", "gas"),
    "gas_cobertura_planilha": (r"^familias pobres atendidas( pagb)?$", "real", "razao (1 = 100%)", "Auxílio Gás / Gás do Povo: % de famílias pobres atendidas (publicado)", "gas"),
    "gas_valor_medio": (r"^valor (medio )?programa auxilio gas .*$", "real", "R$ por familia (nominal)", "Auxílio Gás / Gás do Povo: valor médio publicado", "gas"),
}
COMPONENTES = ["valor_renda_cidadania", "valor_complementar", "valor_primeira_infancia", "valor_variavel_gestante", "valor_variavel_nutriz",
               "valor_variavel_crianca", "valor_variavel_adolescente"]
DERIVADAS = {"valor_soma_componentes": ("real", NOM,
                                        "DERIVADA: soma dos sete componentes valor_renda_cidadania..valor_variavel_adolescente mais valor_extraordinario_transicao quando "
                                        "a planilha tem essa coluna; null se algum faltar. Não vem na planilha"),
             "estimativa_pobreza_ano": ("inteiro", "ano", "Ano da estimativa de pobreza lido do rótulo da coluna (null se o rótulo não traz ano)"),
             "programa": ("texto", "texto", "Programa do bloco principal da planilha ('Bolsa Familia' ou 'Auxilio Brasil' em 2023-02)"),
             "gas_programa": ("texto", "texto", "Programa do segundo bloco (Auxílio Gás dos Brasileiros ou Gás do Povo - Monetária); null se a planilha não tem esse bloco")}
MAPA_TIPOS = {
    "qtd_beneficios_renda_cidadania": r"^total de beneficios renda de cidadania$",
    "qtd_beneficios_complementares": r"^total de beneficios complementares$",
    "qtd_beneficios_primeira_infancia": r"^total de beneficios primeira infancia( pbf)?$",
    "qtd_beneficios_variavel_gestante": r"^total de beneficios v[a-z]*veis familiares gestante$",
    "qtd_beneficios_variavel_nutriz": r"^total de beneficios v[a-z]*veis familiares nutriz$",
    "qtd_beneficios_variavel_crianca": r"^total de beneficios v[a-z]*veis familiares crianca$",
    "qtd_beneficios_variavel_adolescente": r"^total de beneficios v[a-z]*veis familiares adolescente$",
    "qtd_beneficios_extraordinario_transicao": r"^total de beneficios extraordinarios? de transicao$",
}
EXPLICA_TIPOS = "Quantidade de benefícios do tipo (aba 'Tipos de beneficios'); só validada quando a fonte da aba é da própria competência"
OBRIGATORIAS = ("familias_atendidas",)


def agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def norm(s) -> str:
    """Rótulo normalizado: sem acento, minúsculo, só letras e dígitos separados por espaço; nota de rodapé '(1)' no fim some."""
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", " ", t).strip()
    return re.sub(r"\s\d$", "", t) if re.search(r"[a-z]\s\d$", t) and not re.search(r"\d{4}$", t) else t


# ---------------------------------------------------------------- proteção dos destinos
def eh_link(p: Path) -> bool:
    return p.is_symlink() or (hasattr(os.path, "isjunction") and os.path.isjunction(p))


def _chave(p: Path) -> str:
    """Caminho comparável: o resolve() do Windows devolve, em alguns caminhos e em outros não, o prefixo de caminho longo (barra barra ? barra)."""
    t = str(p)
    bs = chr(92)
    longo, unc = bs * 2 + "?" + bs, bs * 2 + "?" + bs + "UNC" + bs
    if t.startswith(unc):
        t = bs * 2 + t[len(unc):]
    elif t.startswith(longo):
        t = t[len(longo):]
    return os.path.normcase(t)


def _relativo(a: Path, b: Path) -> bool:
    """a == b ou a dentro de b (comparação sem diferença de caixa, como no Windows)."""
    ka, kb = _chave(a), _chave(b)
    return ka == kb or ka.startswith(kb.rstrip("\\/") + os.sep)


def validar_saida(saida: Path, proibidos=PROIBIDOS) -> Path:
    """Antes de qualquer mkdir: a saída resolvida não pode ser origem proibida, ancestral nem descendente dela, nem passar por link/junção."""
    bruto = Path(os.path.abspath(saida))
    for trecho in [bruto, *bruto.parents]:
        if trecho.exists() and eh_link(trecho):
            raise ValueError(f"a saída passa por link simbólico/junção: {trecho}")
    r = bruto.resolve()
    if r == Path(r.anchor):
        raise ValueError("a saída não pode ser a raiz do disco")
    for p in proibidos:
        pr = p.resolve()
        if _relativo(r, pr) or _relativo(pr, r):
            raise ValueError(f"saída {r} coincide com, contém ou está dentro de {pr} (somente leitura/proibido)")
    return r


def validar_alvo(saida: Path, alvo: Path, sub: tuple[str, ...] = ("landing/assistencia/pbf", "silver/assistencia/pbf")) -> Path:
    """Cada arquivo final: dentro de uma das duas pastas autorizadas da saída, sem link/junção em nenhum trecho existente."""
    s = saida.resolve()
    bruto = Path(os.path.abspath(alvo))
    for trecho in [bruto, *bruto.parents]:
        if _relativo(trecho, s) and trecho.exists() and eh_link(trecho):
            raise ValueError(f"o destino passa por link simbólico/junção: {trecho}")
    r = bruto.resolve()
    if not any(_relativo(r, (s / x).resolve()) for x in sub):
        raise ValueError(f"destino fora das pastas autorizadas {sub}: {r}")
    for p in PROIBIDOS:
        if _relativo(r, p.resolve()):
            raise ValueError(f"destino dentro de pasta proibida: {r}")
    return r


def gravar_atomico(saida: Path, alvo: Path, conteudo: bytes) -> None:
    validar_alvo(saida, alvo)
    alvo.parent.mkdir(parents=True, exist_ok=True)
    validar_alvo(saida, alvo)
    tmp = alvo.with_name(f"{alvo.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    try:
        tmp.write_bytes(conteudo)
        os.replace(tmp, alvo)
    finally:
        if tmp.exists():
            tmp.unlink()


def gravar_json(saida: Path, alvo: Path, obj) -> None:
    gravar_atomico(saida, alvo, json.dumps(obj, ensure_ascii=False, indent=1, allow_nan=False).encode("utf-8"))


def sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha_arquivo(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


# ---------------------------------------------------------------- aquisição
_local = threading.local()


def sessao():
    import requests
    if not hasattr(_local, "s"):
        _local.s = requests.Session()
        _local.s.headers.update({"User-Agent": UA, "Accept": "*/*"})
    return _local.s


def pedir(url: str, headers: dict | None = None, stream: bool = False):
    """GET com timeout e novas tentativas (erro de rede, 429, 5xx e 403 transitório). 404 e 304 voltam sem insistir."""
    ultimo = None
    for i in range(TENTATIVAS):
        try:
            r = sessao().get(url, headers=headers or {}, timeout=TIMEOUT, stream=stream, allow_redirects=True)
            if r.status_code in (429, 500, 502, 503, 504) or (r.status_code == 403 and i < 1):
                ultimo = f"HTTP {r.status_code}"
                r.close()
            else:
                return r, i + 1
        except Exception as e:  # noqa: BLE001 - rede: qualquer falha tenta de novo
            ultimo = f"{type(e).__name__}: {e}"
        time.sleep(min(2 ** i, 15))
    raise RuntimeError(f"falha em {url}: {ultimo}")


def eh_xlsx(caminho: Path) -> bool:
    try:
        with zipfile.ZipFile(caminho) as z:
            return "xl/workbook.xml" in z.namelist() and z.testzip() is None
    except Exception:  # noqa: BLE001
        return False


def baixar_arquivo(saida: Path, destino: Path, url: str, antigo: dict | None, forcar: bool = False) -> dict:
    """Um arquivo: cache validado por sha256 + GET condicional (ETag/Last-Modified), escrita atômica, conferência de tamanho e de ZIP."""
    rec = {"url": url, "baixado_em": agora()}
    validar_alvo(saida, destino)
    cond = {}
    if (not forcar and antigo and destino.exists() and antigo.get("sha256") and destino.stat().st_size == antigo.get("bytes")
            and sha_arquivo(destino) == antigo["sha256"]):
        if not antigo.get("etag") and not antigo.get("last_modified"):
            # sem validadores no servidor só --forcar rebaixa; o arquivo local confere com o sha256 do catálogo
            return {**{k: antigo.get(k) for k in ("bytes", "sha256", "etag", "last_modified", "url_final", "content_type")}, "url": url,
                    "estado": "cache", "status_http": antigo.get("status_http"), "baixado_em": antigo.get("baixado_em"), "verificado_em": agora()}
        if antigo.get("etag"):
            cond["If-None-Match"] = antigo["etag"]
        if antigo.get("last_modified"):
            cond["If-Modified-Since"] = antigo["last_modified"]
    r, tent = pedir(url, cond, stream=True)
    rec.update(status_http=r.status_code, tentativas=tent, url_final=r.url, content_type=r.headers.get("Content-Type"))
    try:
        if r.status_code == 304 and antigo:
            rec.update({k: antigo.get(k) for k in ("bytes", "sha256", "etag", "last_modified")}, estado="cache", status_http=304)
            return rec
        if r.status_code != 200:
            rec.update(estado="ausente" if r.status_code == 404 else "erro", bytes=None, sha256=None)
            return rec
        esperado = r.headers.get("Content-Length")
        destino.parent.mkdir(parents=True, exist_ok=True)
        validar_alvo(saida, destino)
        tmp = destino.with_name(f"{destino.name}.{os.getpid()}.{threading.get_ident()}.part")
        h, n = hashlib.sha256(), 0
        try:
            with tmp.open("wb") as f:
                for bloco in r.iter_content(1 << 20):
                    f.write(bloco)
                    h.update(bloco)
                    n += len(bloco)
            if esperado is not None and int(esperado) != n:
                raise RuntimeError(f"tamanho recebido {n} != Content-Length {esperado}")
            if not eh_xlsx(tmp):
                raise RuntimeError("o arquivo recebido não é um XLSX/ZIP íntegro")
            os.replace(tmp, destino)
        finally:
            if tmp.exists():
                tmp.unlink()
        igual = bool(antigo and antigo.get("sha256") == h.hexdigest())
        rec.update(estado="inalterado" if igual else "baixado", bytes=n, sha256=h.hexdigest(), etag=r.headers.get("ETag"),
                   last_modified=r.headers.get("Last-Modified"))
        return rec
    finally:
        r.close()


def caminho_xlsx(saida: Path, ano: int, mes: str, uf: str) -> Path:
    return saida / "landing/assistencia/pbf/xlsx" / str(ano) / mes / f"relatorio_pbf_{mes}_{ano}_{uf.lower()}.xlsx"


def ler_catalogo_aquisicao(saida: Path) -> dict:
    p = saida / "landing/assistencia/pbf/catalogo_aquisicao.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"arquivos": {}, "pastas": {}}


def baixar(saida: Path, anos: list[int], ufs: list[str], forcar: bool = False) -> dict:
    """Descobre as pastas (uma GET por ano/mês), sonda cada UF das pastas que existem e baixa o que responde 200 (no máximo 2 ao mesmo tempo)."""
    cat = ler_catalogo_aquisicao(saida)
    cat.update({"fonte": PAGINA, "base_url": BASE_URL, "metodo": "GET por pasta e por arquivo (HEAD retorna 403); no máximo 2 requisições simultâneas",
                "atualizado_em": agora()})
    cat.setdefault("arquivos", {}), cat.setdefault("pastas", {})
    pool = cf.ThreadPoolExecutor(MAX_SIMULTANEOS)
    try:
        # 1) pastas
        def pasta(ano, num, nome):
            url = f"{BASE_URL}{ano}/{nome}/"
            r, tent = pedir(url)
            corpo = r.content if r.status_code == 200 else b""
            listados = sorted({m.group(0).lower() for m in RE_ARQ.finditer(corpo.decode("utf-8", "replace"))})
            return (ano, num), {"ano": ano, "mes": num, "pasta": nome, "url": url, "status_http": r.status_code, "bytes": len(corpo),
                                "sha256": sha_bytes(corpo) if corpo else None, "listados_no_html": listados, "tentativas": tent, "sondado_em": agora()}, corpo
        pares = [(a, n, nm) for a in anos for n, nm in MESES]
        existentes = []
        for (chave, rec, corpo) in pool.map(lambda x: pasta(*x), pares):
            cat["pastas"][f"{chave[0]}-{chave[1]}"] = rec
            if rec["status_http"] == 200:
                existentes.append(chave)
                gravar_atomico(saida, saida / f"landing/assistencia/pbf/listagens/{chave[0]}_{chave[1]}.html", corpo)
        print(f"pastas existentes: {len(existentes)} de {len(pares)} sondadas", flush=True)
        # 2) arquivos: as 27 UFs sondadas para o mês da pasta e para qualquer outro mês que a listagem da pasta mostre (a pasta 2024/outubro guarda os
        # arquivos de 11/2024) + qualquer outro nome relatorio_pbf_MM_AAAA_*.xlsx listado no HTML. A competência real sai do título de cada planilha.
        tarefas = []
        for (ano, num) in existentes:
            nome_pasta = dict(MESES)[num]
            listados = cat["pastas"][f"{ano}-{num}"]["listados_no_html"]
            alvo = {(ano, num)} | {(int(m.group(2)), m.group(1)) for n in listados if (m := RE_ARQ.fullmatch(n))}
            for (a, mm) in sorted(alvo):
                nomes = {f"relatorio_pbf_{mm}_{a}_{u.lower()}.xlsx": u for u in ufs}
                for n in listados:
                    m = RE_ARQ.fullmatch(n)
                    if m and m.group(3).upper() not in ufs and m.group(1) == mm and int(m.group(2)) == a:
                        nomes[n] = m.group(3).upper()
                for n, u in sorted(nomes.items()):
                    tarefas.append((ano, nome_pasta, a, mm, u, n, n in listados))

        def um(t):
            ano_pasta, nome_pasta, ano, num, u, n, listado = t
            url = f"{BASE_URL}{ano_pasta}/{nome_pasta}/{n}"
            destino = caminho_xlsx(saida, ano, num, u)
            chave = f"{ano}-{num}-{u}"
            rec = None
            for tentativa in range(3):  # conexão cortada no meio do corpo: refaz o arquivo inteiro
                try:
                    rec = baixar_arquivo(saida, destino, url, cat["arquivos"].get(chave), forcar)
                    break
                except ValueError as e:  # destino recusado: não adianta insistir
                    rec = {"url": url, "estado": "erro", "erro": str(e), "baixado_em": agora(), "bytes": None, "sha256": None}
                    break
                except Exception as e:  # noqa: BLE001
                    rec = {"url": url, "estado": "erro", "erro": f"{type(e).__name__}: {e}", "baixado_em": agora(), "bytes": None, "sha256": None,
                           "tentativas_download": tentativa + 1}
                    time.sleep(2 ** tentativa)
            rec.update(ano=ano, mes=num, uf_arquivo=u, nome=n, listado_no_html=listado, tipo="uf" if u in UF_COD else "extra", pasta=f"{ano_pasta}/{nome_pasta}",
                       caminho=str(destino.relative_to(saida)).replace("\\", "/"))
            return chave, rec
        feitos = 0
        for chave, rec in pool.map(um, tarefas):
            cat["arquivos"][chave] = rec
            feitos += 1
            if feitos % 25 == 0 or rec["estado"] in ("erro",):
                print(f"[{feitos}/{len(tarefas)}] {chave} {rec['estado']} {rec.get('bytes')}", flush=True)
            if feitos % 50 == 0:
                gravar_json(saida, saida / "landing/assistencia/pbf/catalogo_aquisicao.json", cat)
    finally:
        pool.shutdown(wait=True)
    cat["atualizado_em"] = agora()
    gravar_json(saida, saida / "landing/assistencia/pbf/catalogo_aquisicao.json", cat)
    return cat


# ---------------------------------------------------------------- leitura de XLSX (sem openpyxl)
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
RNS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def abas_do_xlsx(z: zipfile.ZipFile):
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rel = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    abas = []
    for s in wb.find(NS + "sheets"):
        alvo = rel[s.get(RNS + "id")]
        alvo = alvo.lstrip("/")
        abas.append((s.get("name"), s.get("state") or "visible", alvo if alvo.startswith("xl/") else "xl/" + alvo))
    ss = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            # só o texto do corpo (<t> direto ou dentro de <r>); <rPh> (fonética) fica de fora
            partes = []
            for f in si:
                if f.tag == NS + "t":
                    partes.append(f.text or "")
                elif f.tag == NS + "r":
                    partes += [t.text or "" for t in f.findall(NS + "t")]
            ss.append("".join(partes))
    return abas, ss


def linhas_da_aba(z: zipfile.ZipFile, caminho: str, ss: list[str]):
    """[(número da linha, {coluna: valor})]; números como float, textos como str, célula vazia ausente. Fórmulas valem pelo valor guardado."""
    out = []
    with z.open(caminho) as f:
        _linhas(f, ss, out)
    return out


def _linhas(f, ss, out):
    for _, el in ET.iterparse(f, events=("end",)):
        if el.tag != NS + "row":
            continue
        d = {}
        for c in el.findall(NS + "c"):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            t, v = c.get("t"), c.find(NS + "v")
            if t == "inlineStr":
                d[col] = "".join(x.text or "" for x in c.iter(NS + "t"))
            elif v is None or v.text is None:
                continue
            elif t == "s":
                d[col] = ss[int(v.text)]
            elif t in ("str", "e"):
                d[col] = v.text
            elif t == "b":
                d[col] = bool(int(v.text))
            else:
                d[col] = float(v.text)
        out.append((int(el.get("r")), d))
        el.clear()


def achar_aba(abas, prefixo: str):
    """A aba visível de nome <prefixo>*. Se não houver nenhuma e o arquivo tiver UMA só aba visível (2025-10 chama-se 'Planilha1'), vale essa aba."""
    achadas = [a for a in abas if norm(a[0]).startswith(prefixo) and a[1] == "visible"]
    if not achadas and prefixo == "municipio":
        visiveis = [a for a in abas if a[1] == "visible"]
        if len(visiveis) == 1:
            return visiveis[0]
    if len(achadas) != 1:
        raise ValueError(f"aba visível '{prefixo}*' esperada uma vez, achadas {len(achadas)}: {[a[0] for a in abas]}")
    return achadas[0]


# ---------------------------------------------------------------- parser de um arquivo
class ArquivoInvalido(ValueError):
    """Arquivo recusado inteiro (competência não confirmada, cabeçalho ausente, UF divergente...)."""


RE_MES_ANO = re.compile(r"(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de\s*|/)?\s*(\d{4})")
RE_MM_AAAA = re.compile(r"(?<![\d/])(0[1-9]|1[0-2])/(\d{4})(?!\d)")
RE_CONFECCAO = re.compile(r"(\d{2})/(\d{2})/(\d{4})")
RE_FONTE = re.compile(r"\b(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\s+(\d{2,4})\b")


def competencia_do_titulo(linhas, ate: int) -> tuple[int, dict]:
    """AAAAMM do TÍTULO da aba ('Informações sobre o Programa ... - JUNHO 2026' ou 'Total de benefícios por tipos ..., JUNHO 2026'), nas linhas até o
    cabeçalho. Notas de rodapé com outras datas (ex.: 'a partir de fevereiro de 2023') não contam. Exige um único mês/ano; 'Data de confecção' só é registrada."""
    titulos, outros, confeccao = set(), set(), None
    for n, d in linhas:
        if n > ate:
            break
        for v in d.values():
            if not isinstance(v, str):
                continue
            t = norm(v)
            if t.startswith("data de confeccao"):
                m = RE_CONFECCAO.search(v)
                confeccao = f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None
                continue
            m = RE_MES_ANO.search(t)
            if m:
                comp = int(m.group(2)) * 100 + NOME_MES[m.group(1)]
            else:
                m2 = RE_MM_AAAA.search(v)  # '... Bolsa Família, 07/2024'
                if not m2:
                    continue
                comp = int(m2.group(2)) * 100 + int(m2.group(1))
            if t.startswith("informacoes sobre") or t.startswith("total de beneficios"):
                titulos.add(comp)
            elif "programa bolsa familia" in t or "beneficios" in t:
                outros.add(comp)
    achados = titulos or outros
    if len(achados) != 1:
        raise ArquivoInvalido(f"título sem competência única (achadas: {sorted(achados)})")
    return next(iter(achados)), {"data_confeccao": confeccao}


def achar_cabecalho(linhas):
    """(linha do rótulo 'IBGE', primeira linha de dados, {coluna: rótulo normalizado}, {coluna: bloco}, {bloco: texto original do grupo}).
    Rótulo = o último texto do cabeçalho na coluna. Bloco = grupo ('Programa ...') da linha do IBGE, repetido até o próximo grupo:
    pbf (Bolsa Família ou Auxílio Brasil), gas (Auxílio Gás/Gás do Povo) ou None."""
    for n, d in linhas:
        if any(isinstance(v, str) and norm(v) == "ibge" for v in d.values()):
            r0 = n
            break
    else:
        raise ArquivoInvalido("cabeçalho com a coluna IBGE não encontrado")
    col_ibge = next(c for c, v in dict(linhas)[r0].items() if isinstance(v, str) and norm(v) == "ibge")
    rot, primeira = {}, None
    for n, d in linhas:
        if n < r0:
            continue
        v = d.get(col_ibge)
        if isinstance(v, float) and v == int(v) and 1_000_000 <= v <= 9_999_999:
            primeira = n
            break
        for c, x in d.items():
            if isinstance(x, str) and norm(x):
                rot[c] = norm(x)
        if n - r0 > 6:
            break
    if primeira is None:
        raise ArquivoInvalido("nenhuma linha de município com IBGE de 7 dígitos depois do cabeçalho")
    # os grupos ('Programa Bolsa Família', 'Programa Auxílio Gás...') ficam na linha do IBGE ou na de cima (2025-02-AC) e começam por 'Programa'
    por_linha = dict(linhas)
    topo = {c: v for n in (r0 - 1, r0) for c, v in por_linha.get(n, {}).items() if isinstance(v, str) and norm(v).startswith("programa ")}
    blocos, textos, atual = {}, {}, None
    for c in sorted({*rot, *por_linha.get(r0, {}), *topo}, key=lambda x: (len(x), x)):
        if c in topo:
            g = norm(topo[c])
            atual = "gas" if re.search(r"\bgas\b", g) else "pbf" if re.search(r"bolsa familia|auxilio brasil", g) else None
            if atual:
                textos[atual] = topo[c].strip()
        blocos[c] = atual
    if not topo:
        # alguns arquivos (2025-02 de várias UFs, 2025-07) vêm sem a linha de grupos: o bloco do gás começa na primeira coluna cujo rótulo repete um rótulo
        # do bloco principal ou diz 'PAGB'/'Auxílio Gás'/'Gás do Povo'
        vistos, atual = set(), "pbf"
        for c in sorted(rot, key=lambda x: (len(x), x)):
            r = rot[c]
            if c == col_ibge or r in ("uf", "municipio", "ibge", "regiao", "coduf") or r.startswith("e") and "pobre" in r:
                blocos[c] = None
                continue
            if atual == "pbf" and (r in vistos or re.search(r"pagb|auxilio gas|gas do povo", r)):
                atual = "gas"
            blocos[c] = atual
            if atual == "pbf":
                vistos.add(re.sub(r" pbf$", "", r))
        textos = {"pbf": "Programa Bolsa Família (grupo ausente no cabeçalho; inferido)", "gas": "Programa Auxílio Gás (grupo ausente no cabeçalho; inferido pelo bloco repetido)"}
    return r0, primeira, rot, blocos, textos


def mapear(rot: dict, mapa: dict, blocos: dict | None = None) -> tuple[dict, list]:
    """{nome canônico: coluna} por rótulo (e bloco, quando o mapa o declara) + lista de rótulos sem destino. Cada coluna vale uma vez."""
    achado, usados = {}, set()
    for nome, spec in mapa.items():
        rx = spec if isinstance(spec, str) else spec[0]
        bloco = None if isinstance(spec, str) else spec[4]
        for c, r in rot.items():
            if c in usados or not re.fullmatch(rx, r):
                continue
            if blocos is not None and bloco not in (None, "qualquer") and blocos.get(c) != bloco:
                continue
            if nome in achado:
                raise ArquivoInvalido(f"rótulo ambíguo para {nome}: colunas {achado[nome]} e {c}")
            achado[nome] = c
            usados.add(c)
    ident = ("uf", "municipio", "ibge", "regiao", "coduf") + tuple(r for r in rot.values() if r.startswith("programa "))
    return achado, [r for c, r in rot.items() if c not in usados and r not in ident]


def numero(v, contagem: dict):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, float):
        return v
    t = str(v).strip().replace("\xa0", "")
    if t in ("", "-", "--", "..."):
        contagem["celulas_texto_vazio"] = contagem.get("celulas_texto_vazio", 0) + 1
        return None
    try:
        return float(t.replace(".", "").replace(",", ".")) if "," in t else float(t)
    except ValueError:
        contagem["celulas_nao_numericas"] = contagem.get("celulas_nao_numericas", 0) + 1
        return None


def fonte_do_topo(linhas, ate: int):
    """(texto, AAAAMM) da linha 'Fonte: Folha de Pagamentos ..., mês/ano' acima do cabeçalho, se houver."""
    for n, d in linhas:
        if n >= ate:
            break
        for v in d.values():
            if isinstance(v, str) and norm(v).startswith("fonte"):
                achados = RE_FONTE.findall(norm(v))
                if achados:
                    a = int(achados[-1][1])
                    return v.strip(), (2000 + a if a < 100 else a) * 100 + ABREV_MES[achados[-1][0]]
                return v.strip(), None
    return None, None


def ler_planilha(caminho: Path, ano: int, mes: str, uf_arquivo: str) -> dict:
    """Lê a aba Municipio (e Tipos de beneficios). Devolve {competencia, linhas, totais, tipos, quarentena, verificacoes, ...} ou ArquivoInvalido."""
    esperada = ano * 100 + int(mes)
    with zipfile.ZipFile(caminho) as z:
        abas, ss = abas_do_xlsx(z)
        nome_m, _, cam_m = achar_aba(abas, "municipio")
        L = linhas_da_aba(z, cam_m, ss)
        tipos_aba = next((a for a in abas if norm(a[0]).startswith("tipos de beneficios") and a[1] == "visible" and a[2] != cam_m), None)
        LT = linhas_da_aba(z, tipos_aba[2], ss) if tipos_aba else None
    r0, primeira, rot, blocos, textos = achar_cabecalho(L)
    comp, meta = competencia_do_titulo(L, primeira)
    if comp != esperada:
        raise ArquivoInvalido(f"competência do título {comp} diverge de pasta/nome {esperada}")
    meta["fonte_municipio_texto"], meta["fonte_municipio_competencia"] = fonte_do_topo(L, primeira)
    colunas, sobras = mapear(rot, MAPA_MUNICIPIO, blocos)
    meta["grupos_inferidos"] = "inferido" in textos.get("pbf", "")
    prog = "Auxilio Brasil" if "auxilio brasil" in norm(textos.get("pbf", "")) else "Bolsa Familia" if textos.get("pbf") else None
    gas_prog = textos.get("gas")
    if "familias_atendidas" not in colunas:
        raise ArquivoInvalido(f"coluna 'Famílias Atendidas' não encontrada (rótulos: {sorted(rot.values())})")
    col_uf = next((c for c, r in rot.items() if r == "uf"), None)
    col_nome = next((c for c, r in rot.items() if r == "municipio"), None)
    col_ibge = next(c for c, r in dict(L)[r0].items() if isinstance(r, str) and norm(r) == "ibge")
    if not col_uf or not col_nome:
        raise ArquivoInvalido("colunas UF/MUNICÍPIO não encontradas")
    rot_est = rot.get(colunas.get("estimativa_pobreza", ""), "")
    ano_estimativa = int(re.search(r"\d{4}", rot_est).group(0)) if re.search(r"\d{4}", rot_est or "") else None
    tem_bet = "valor_extraordinario_transicao" in colunas
    cont, linhas, totais, ignoradas, vistos, dup, uf_div = {}, [], [], 0, {}, [], []
    for n, d in L:
        if n < primeira:
            continue
        ib, u, nm = d.get(col_ibge), d.get(col_uf), d.get(col_nome)
        txt = " ".join(str(x) for x in (u, nm) if isinstance(x, str))
        valido = isinstance(ib, float) and ib == int(ib) and 1_000_000 <= ib <= 9_999_999
        if not valido:
            if re.search(r"\b(total|brasil)\b", norm(txt)) or norm(str(u or "")) in ("total", "brasil"):
                totais.append({"linha": n, "rotulo": txt.strip(), "valores": {k: numero(d.get(c), cont) for k, c in colunas.items()}})
            elif d:
                ignoradas += 1
            continue
        cod = int(ib)
        uf = str(u).strip().upper() if isinstance(u, str) else None
        if uf != uf_arquivo.upper() or UF_COD.get(uf) != cod // 100000:
            uf_div.append({"linha": n, "cod_ibge": cod, "uf_linha": uf})
            continue
        if cod in vistos:
            dup.append({"cod_ibge": cod, "linhas": [vistos[cod], n]})
            continue
        vistos[cod] = n
        reg = {"competencia": comp, "cod_ibge": cod, "uf": uf, "nome": str(nm).strip() if nm is not None else None}
        for k, c in colunas.items():
            v = numero(d.get(c), cont)
            reg[k] = None if v is None else (int(v) if MAPA_MUNICIPIO[k][1] == "inteiro" and v == int(v) else v)
        comp_v = [reg.get(k) for k in COMPONENTES + (["valor_extraordinario_transicao"] if tem_bet else [])]
        reg["valor_soma_componentes"] = round(sum(comp_v), 2) if all(v is not None for v in comp_v) and all(k in colunas for k in COMPONENTES) else None
        reg["estimativa_pobreza_ano"] = ano_estimativa
        reg["programa"], reg["gas_programa"] = prog, (gas_prog if any(k.startswith("gas_") for k in colunas) else None)
        linhas.append(reg)
    if uf_div:
        raise ArquivoInvalido(f"{len(uf_div)} linha(s) com UF/prefixo IBGE diferente do arquivo {uf_arquivo}: {uf_div[:3]}")
    if dup:
        raise ArquivoInvalido(f"códigos IBGE duplicados na competência: {dup[:3]}")
    if not linhas:
        raise ArquivoInvalido("nenhum município lido")
    verif = {"celulas": cont, "linhas_ignoradas": ignoradas}
    c_ok = [r for r in linhas if r.get("estimativa_pobreza") and r.get("cobertura_planilha") is not None and r.get("familias_atendidas") is not None]
    verif["cobertura_confere_n"] = len(c_ok)  # tolerância 1e-4: alguns arquivos trazem a cobertura arredondada em 4 casas
    verif["cobertura_divergente_n"] = sum(1 for r in c_ok if abs(r["cobertura_planilha"] - r["familias_atendidas"] / r["estimativa_pobreza"]) > 1e-4)
    t_ok = [r for r in linhas if r.get("valor_total_planilha") is not None and r.get("valor_regra_protecao") is not None]
    verif["total_igual_regra_protecao_n"] = sum(1 for r in t_ok if r["valor_total_planilha"] == r["valor_regra_protecao"])
    verif["total_planilha_testado_n"] = len(t_ok)
    s_ok = [r for r in linhas if r.get("valor_total_planilha") is not None and r.get("valor_soma_componentes") is not None]
    verif["total_igual_soma_componentes_n"] = sum(1 for r in s_ok if abs(r["valor_total_planilha"] - r["valor_soma_componentes"]) < 1)
    verif["total_planilha_vs_soma_testado_n"] = len(s_ok)
    verif["pagamento_maior_que_atendidas_n"] = sum(1 for r in linhas if r.get("familias_em_pagamento") is not None and r["familias_em_pagamento"] > r["familias_atendidas"])
    saida = {"competencia": comp, "uf": uf_arquivo.upper(), "aba": nome_m, "ano_estimativa_pobreza": ano_estimativa, "linhas": linhas, "totais": totais,
             "rotulos_nao_mapeados": sobras, "verificacoes": verif, "colunas_mapeadas": {k: rot[c] for k, c in colunas.items()},
             "programa": prog, "gas_programa": gas_prog, "tipos": None, "quarentena": None, **meta}
    saida["tipos_info"] = ler_tipos(LT, comp, linhas, saida) if LT is not None else {"estado": "aba ausente"}
    return saida


def ler_tipos(LT, comp: int, linhas_mun: list, saida: dict) -> dict:
    """Aba 'Tipos de beneficios': quantidades por tipo. Validadas SÓ se 'Fonte: ..., mês/ano' for a própria competência."""
    try:
        r0, primeira, rot, _, _ = achar_cabecalho(LT)
    except ArquivoInvalido as e:
        return {"estado": f"cabeçalho não reconhecido: {e}"}
    info = {"estado": None, "titulo_competencia": None, "fonte_texto": None, "fonte_competencia": None}
    for n, d in LT:
        if n >= primeira:
            break
        for v in d.values():
            if isinstance(v, str) and norm(v).startswith("fonte"):
                info["fonte_texto"] = v.strip()
                achados = RE_FONTE.findall(norm(v))
                if achados:
                    a = int(achados[-1][1])
                    info["fonte_competencia"] = (2000 + a if a < 100 else a) * 100 + ABREV_MES[achados[-1][0]]
    try:
        info["titulo_competencia"] = competencia_do_titulo(LT, primeira)[0]
    except ArquivoInvalido:
        pass
    colunas, sobras = mapear(rot, MAPA_TIPOS)
    if not colunas:
        info["estado"] = "colunas de quantidade não reconhecidas (nada validado)"
        return info
    col_ibge = next(c for c, r in dict(LT)[r0].items() if isinstance(r, str) and norm(r) == "ibge")
    cont, qtd = {}, {}
    for n, d in LT:
        if n < primeira:
            continue
        ib = d.get(col_ibge)
        if isinstance(ib, float) and ib == int(ib) and 1_000_000 <= ib <= 9_999_999:
            qtd[int(ib)] = {k: numero(d.get(c), cont) for k, c in colunas.items()}
    mun = {r["cod_ibge"] for r in linhas_mun}
    info.update(colunas_mapeadas=sorted(colunas), rotulos_nao_mapeados=sobras, municipios=len(qtd), so_em_tipos=len(set(qtd) - mun), so_em_municipio=len(mun - set(qtd)))
    confirmada = info["fonte_competencia"] == comp and info["titulo_competencia"] == comp and not info["so_em_tipos"] and not info["so_em_municipio"]
    if confirmada:
        info["estado"] = "validado"
        for r in linhas_mun:
            q = qtd.get(r["cod_ibge"], {})
            for k in MAPA_TIPOS:
                v = q.get(k)
                r[k] = None if v is None else int(v)
    else:
        motivo = []
        if info["fonte_competencia"] != comp:
            motivo.append(f"texto 'Fonte' aponta {info['fonte_competencia']} e o título da aba Municipio {comp}")
        if info["titulo_competencia"] != comp:
            motivo.append(f"título da aba de tipos aponta {info['titulo_competencia']}")
        if info["so_em_tipos"] or info["so_em_municipio"]:
            motivo.append("conjunto de municípios difere da aba Municipio")
        info["estado"] = "quarentena: " + "; ".join(motivo)
        saida["quarentena"] = [{"competencia": comp, "cod_ibge": c, "uf": saida["uf"], "fonte_texto": info["fonte_texto"],
                                **{k: (None if v is None else int(v)) for k, v in q.items()}} for c, q in sorted(qtd.items())]
        for r in linhas_mun:
            for k in MAPA_TIPOS:
                r[k] = None
    return info


# ---------------------------------------------------------------- normalização por competência
COLUNAS_SILVER = (["competencia", "cod_ibge", "uf", "nome", "programa", "gas_programa", "estimativa_pobreza_ano"]
                  + list(MAPA_MUNICIPIO) + ["valor_soma_componentes"] + list(MAPA_TIPOS))
TIPO_SQL = {"inteiro": "BIGINT", "real": "DOUBLE", "texto": "VARCHAR"}


def tipos_sql() -> dict:
    t = {"competencia": "INTEGER", "cod_ibge": "INTEGER", "uf": "VARCHAR", "nome": "VARCHAR"}
    t.update({k: TIPO_SQL[v[1]] for k, v in MAPA_MUNICIPIO.items()})
    t.update({k: TIPO_SQL[v[0]] for k, v in DERIVADAS.items()})
    t["estimativa_pobreza_ano"] = "INTEGER"
    t.update({k: "BIGINT" for k in MAPA_TIPOS})
    return t


def gravar_parquet(saida: Path, alvo: Path, colunas: list, tipos: dict, linhas: list[dict]) -> None:
    import duckdb
    validar_alvo(saida, alvo)
    alvo.parent.mkdir(parents=True, exist_ok=True)
    validar_alvo(saida, alvo)
    tmp = alvo.with_name(f"{alvo.name}.{os.getpid()}.tmp")
    con = duckdb.connect()
    try:
        con.execute("CREATE TABLE t (" + ", ".join(f"{c} {tipos[c]}" for c in colunas) + ")")
        con.executemany("INSERT INTO t VALUES (" + ",".join("?" * len(colunas)) + ")", [[r.get(c) for c in colunas] for r in linhas])
        con.execute(f"COPY (SELECT * FROM t ORDER BY cod_ibge) TO '{tmp.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)")
        con.close()
        os.replace(tmp, alvo)
    finally:
        if tmp.exists():
            tmp.unlink()


def catalogo_variaveis() -> list[dict]:
    v = [{"coluna": "competencia", "tipo": "INTEGER", "unidade": "AAAAMM", "origem": "título da aba Municipio", "descricao": "Mês de referência do relatório"},
         {"coluna": "cod_ibge", "tipo": "INTEGER", "unidade": "codigo IBGE de 7 digitos", "origem": "coluna 'IBGE'", "descricao": "Município"},
         {"coluna": "uf", "tipo": "VARCHAR", "unidade": "sigla", "origem": "coluna 'UF' (conferida com o arquivo e com o prefixo do IBGE)", "descricao": "Unidade da Federação"},
         {"coluna": "nome", "tipo": "VARCHAR", "unidade": "texto", "origem": "coluna 'MUNICÍPIO'", "descricao": "Nome como na planilha (maiúsculas, sem acento)"}]
    for k, (tp, un, ds) in DERIVADAS.items():
        v.append({"coluna": k, "tipo": tipos_sql()[k], "unidade": un, "origem": "derivada" if k == "valor_soma_componentes" else "cabeçalho da aba Municipio", "descricao": ds})
    for k, (rx, tp, un, ds, bloco) in MAPA_MUNICIPIO.items():
        v.append({"coluna": k, "tipo": TIPO_SQL[tp], "unidade": un, "bloco_da_planilha": bloco, "descricao": ds,
                  "origem": "aba Municipio (ou aba única visível), rótulo normalizado (sem acento, minúsculo) casando " + rx})
    for k, rx in MAPA_TIPOS.items():
        v.append({"coluna": k, "tipo": "BIGINT", "unidade": "beneficios", "origem": "aba 'Tipos de beneficios', rótulo " + rx,
                  "descricao": EXPLICA_TIPOS + " (null onde a competência da fonte não foi confirmada)"})
    return v


ESPERADOS_NAO_PRESUMIDOS = "o número de municípios por UF não é presumido: o catálogo compara cada UF com a mediana das outras competências"


def normalizar(saida: Path, so: set[int] | None = None) -> dict:
    """Parquet por competência. `so` limita o reprocessamento a essas competências (as demais são reaproveitadas do catalogo.json anterior)."""
    acq = ler_catalogo_aquisicao(saida)
    anterior = {}
    if so:
        pc = saida / "landing/assistencia/pbf/catalogo.json"
        anterior = json.loads(pc.read_text(encoding="utf-8"))["competencias"] if pc.exists() else {}
    por_comp: dict[int, dict] = {}
    for chave, rec in sorted(acq["arquivos"].items()):
        if rec.get("estado") not in ("baixado", "cache", "inalterado") or rec.get("tipo") != "uf":
            continue
        c = int(rec["ano"]) * 100 + int(rec["mes"])
        por_comp.setdefault(c, {"arquivos": {}})["arquivos"][rec["uf_arquivo"]] = rec
    resumo = {}
    for comp in sorted(por_comp):
        if so and comp not in so and str(comp) in anterior:
            resumo[str(comp)] = anterior[str(comp)]
            continue
        linhas, quarent, totais, arq_res, erros = [], [], [], {}, {}
        for uf, rec in sorted(por_comp[comp]["arquivos"].items()):
            caminho = saida / rec["caminho"]
            validar_alvo(saida, caminho)
            if sha_arquivo(caminho) != rec["sha256"]:
                erros[uf] = "sha256 do arquivo local diverge do catálogo de aquisição"
                continue
            try:
                p = ler_planilha(caminho, rec["ano"], rec["mes"], uf)
            except (ArquivoInvalido, ValueError, KeyError, zipfile.BadZipFile) as e:
                erros[uf] = f"{type(e).__name__}: {e}"
                continue
            linhas += p["linhas"]
            quarent += p["quarentena"] or []
            totais += [{**t, "uf": uf} for t in p["totais"]]
            arq_res[uf] = {k: p[k] for k in ("aba", "data_confeccao", "ano_estimativa_pobreza", "programa", "gas_programa", "fonte_municipio_texto",
                                             "fonte_municipio_competencia", "rotulos_nao_mapeados", "verificacoes", "tipos_info", "colunas_mapeadas")}
            arq_res[uf].update(municipios=len(p["linhas"]), sha256=rec["sha256"], caminho=rec["caminho"])
        ufs_ok = sorted(arq_res)
        faltantes = sorted(set(UFS) - set(por_comp[comp]["arquivos"]))
        if linhas:
            gravar_parquet(saida, saida / f"silver/assistencia/pbf/pbf_{comp}.parquet", COLUNAS_SILVER, tipos_sql(), linhas)
        if quarent:
            cols = ["competencia", "cod_ibge", "uf", "fonte_texto"] + list(MAPA_TIPOS)
            gravar_parquet(saida, saida / f"silver/assistencia/pbf/quarentena/tipos_quantidade_{comp}.parquet", cols,
                           {**tipos_sql(), "fonte_texto": "VARCHAR"}, quarent)
        cods = [r["cod_ibge"] for r in linhas]
        resumo[str(comp)] = {"competencia": comp, "ufs_lidas": ufs_ok, "ufs_sem_arquivo": faltantes, "ufs_rejeitadas": erros, "municipios": len(linhas),
                             "duplicados_entre_ufs": len(cods) - len(set(cods)), "totais_identificados": totais,
                             "quantidades_por_tipo": sorted({a["tipos_info"]["estado"].split(":")[0] for a in arq_res.values()}),
                             "arquivos": arq_res, "parquet": f"silver/assistencia/pbf/pbf_{comp}.parquet" if linhas else None,
                             "quarentena": f"silver/assistencia/pbf/quarentena/tipos_quantidade_{comp}.parquet" if quarent else None}
        print(f"{comp}: {len(ufs_ok)} UFs, {len(linhas)} municípios, rejeitadas {len(erros)}, sem arquivo {len(faltantes)}", flush=True)
    # consistência entre competências: municípios por UF contra a mediana
    cont = {}
    for c, r in resumo.items():
        for uf, a in r["arquivos"].items():
            cont.setdefault(uf, []).append((c, a["municipios"]))
    desvios = []
    for uf, lst in cont.items():
        med = sorted(n for _, n in lst)[len(lst) // 2]
        desvios += [{"uf": uf, "competencia": int(c), "municipios": n, "mediana": med} for c, n in lst if n != med]
    cat = {
        "gerado_em": agora(), "fonte": PAGINA, "base_url": BASE_URL, "script": "pipeline/assistencia_pbf.py",
        "descricao": "Folha mensal do Bolsa Família (MDS, Bolsa em Números) por município. NÃO é a série da CGU/Portal da Transparência e não se une a ela.",
        "regras": ["competência do título da aba Municipio, conferida com pasta e nome", "aba oculta rel_beneficios_ibge_202503all e auxiliares nunca lidas",
                   "estoques (famílias) não se somam no tempo; valores são R$ nominais da competência (inflação é tarefa do painel)",
                   "taxas/médias/cobertura da planilha não são recalculadas nem agregadas por média; Brasil/UF vêm só de linhas explicitamente rotuladas",
                   ESPERADOS_NAO_PRESUMIDOS],
        "limitacoes": [
            "Aba 'Tipos de beneficios': o texto 'Fonte: Folha de Pagamentos do Programa Bolsa Família, ago/25' aparece mesmo com o título do mês da competência "
            "(ex.: JUNHO 2026). Quando o mês/ano da fonte difere da competência, as quantidades vão à quarentena e as colunas qtd_* ficam null.",
            "A coluna 'Total de Recursos Transferidos' da aba Municipio pode ser idêntica à 'Valor em Regra de Proteção': ver verificacoes.total_igual_regra_protecao_n; "
            "valor_soma_componentes é a alternativa derivada.",
            "'Valor Médio Programa Bolsa Família (1)': a nota (1) não acompanha o arquivo; é preservado como publicado.",
            "A listagem HTML das pastas omite UFs que existem; por isso cada UF é sondada por GET.",
            "O arquivo '..._origem.xlsx' listado na pasta é registrado e baixado, mas não é lido (não é um relatório de UF)."],
        "variaveis": catalogo_variaveis(), "aquisicao": acq, "competencias": resumo, "desvios_municipios_por_uf": desvios,
    }
    gravar_json(saida, saida / "landing/assistencia/pbf/catalogo.json", cat)
    return cat


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("comando", choices=["baixar", "normalizar", "tudo"])
    ap.add_argument("--saida", type=Path, default=SAIDA_PADRAO)
    ap.add_argument("--anos", type=int, nargs=2, metavar=("DE", "ATE"), default=[2021, datetime.now().year])
    ap.add_argument("--uf", nargs="*", default=UFS)
    ap.add_argument("--competencias", type=int, nargs="*", help="normalizar só estas competências (AAAAMM); as outras vêm do catálogo anterior")
    ap.add_argument("--forcar", action="store_true", help="rebaixa mesmo com arquivo local conferido")
    a = ap.parse_args(argv)
    saida = validar_saida(a.saida)
    if not _relativo(saida, SAIDA_PADRAO.resolve()):
        ap.error(f"a saída deve ficar dentro de {SAIDA_PADRAO} (dados só na pasta candidata)")
    ufs = [u.upper() for u in a.uf]
    if any(u not in UF_COD for u in ufs):
        ap.error("UF desconhecida")
    if a.comando in ("baixar", "tudo"):
        baixar(saida, list(range(a.anos[0], a.anos[1] + 1)), ufs, a.forcar)
    if a.comando in ("normalizar", "tudo"):
        normalizar(saida, set(a.competencias) if a.competencias else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
