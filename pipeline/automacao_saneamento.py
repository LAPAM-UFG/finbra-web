"""Descobre resultados publicados do SINISA; coleta não equivale a resultado."""
import json
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urljoin,urlparse,unquote

from assistencia_utils import salvar_json
from automacao_temas import ler,fatos,guardar
from educacao_baixar import links,pagina
from saneamento_baixar import CATALOGO,extrair
from saneamento_ler import preparar
from saneamento import gerar

RESULTADOS='https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/sinisa/resultados-sinisa'


def modulo(url):
    text=unicodedata.normalize('NFKD',unquote(url)).encode('ascii','ignore').decode().lower()
    if 'esgoto'in text:return 'esgoto'
    if 'pluvia'in text or'drenag'in text:return 'ap'
    if 'residuo'in text or'residuosol'in text:return 'rs'
    if 'agua'in text:return 'agua'
    if 'gestao'in text:return 'gestao'
    raise ValueError('Módulo novo sem identificação: '+url)


def descobrir():
    refs=ler(CATALOGO);known={r['url']for r in refs}
    queue=[RESULTADOS];seen=set();new=[]
    while queue:
        url=queue.pop()
        if url in seen:continue
        seen.add(url);body=pagina(url)
        for href,title in links(body):
            href=urljoin(url,href)
            if href.startswith(RESULTADOS+'/')and re.search(r'resultados-sinisa-20\d{2}/?$',href):queue.append(href)
        edition=re.search(r'resultados-sinisa-(20\d{2})',url)
        if not edition:continue
        year=int(edition[1])-1
        plain=re.sub('<[^>]+>',' ',body)
        if not re.search(r'refer[eê]ncia\s*(?:de\s*)?'+str(year),plain,re.I):raise ValueError('Ano de referência não comprovado: '+url)
        found=[]
        for href,title in links(body):
            href=urljoin(url,href)
            if not re.search(r'\.(?:zip|rar|xlsx?)(?:/@@download/file)?$',href,re.I)or'planilha'not in title.lower():continue
            if urlparse(href).hostname not in ['www.gov.br','gov.br']:raise ValueError('Resultado fora do domínio oficial')
            mod=modulo(href);found.append(mod)
            if href not in known:
                name=f'sinisa_{mod}_{year}_'+__import__('hashlib').sha256(href.encode()).hexdigest()[:12]+'.'+re.search(r'\.(zip|rar|xlsx?)',href,re.I)[1]
                new.append(dict(sistema='SINISA',ano=year,modulo=mod,tipo='dados',arquivo=name,url=href,pagina=url,titulo=title));known.add(href)
        if not {'agua','esgoto','rs','ap'}<=set(found):raise ValueError('Resultados SINISA sem os quatro módulos: '+url)
    return refs+new


def saneamento(ctx):
    ctx.preparar_painel('saneamento');cad=ctx.raiz_fonte('silver/entes.parquet')
    refs=descobrir()
    def get(r):
        ref=ctx.obter_oficial(r['url'],r['arquivo'])
        return {**r,**{k:ref[k]for k in ('bytes','sha256')}}
    with ThreadPoolExecutor(max_workers=3)as pool:refs=list(pool.map(get,refs))
    salvar_json(ctx.fontes/'catalogo.json',refs)
    changed=ctx.mudou(fatos(refs),codigo=('saneamento.py','saneamento_ler.py','saneamento_indicadores.py','automacao_saneamento.py'))
    if changed:
        sheets=ctx.raiz/'planilhas';normal=ctx.raiz/'normalizado';out=ctx.raiz/'painel'
        extrair(ctx.fontes,sheets,refs);preparar(sheets,cad,normal);gerar(normal,cad,out)
        ctx.aplicar(out);ctx.painel=out
    guardar(ctx,['catalogo.json',*[r['arquivo']for r in refs],*[r['arquivo']+'.oficial.json'for r in refs]])
    return changed
