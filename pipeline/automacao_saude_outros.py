"""APS, repasses FNS e vacinação oficial, preservando a cobertura anterior."""
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import duckdb

from assistencia_utils import salvar_json
from atualizacao_artefatos import sha
from automacao_saude import mesclar
from automacao_temas import guardar,ler,fatos


def aps(ctx):
    import aps as f
    import saude as s
    closed=datetime.now(ZoneInfo('America/Sao_Paulo')).year-1
    old=ler(ctx.base/'gold/manifesto.json')['fontes']['aps'];last=max(old['anos'])
    raw=ctx.fontes/'aps';refs=[]
    for year in range(last-1,closed+1):
        current=[];expected=0
        for serie,(begin,end)in f.SERIES.items():
            for month in range(1,13):
                comp=year*100+month
                if not begin<=comp<=end:continue
                expected+=1
                values=f.pedir(serie,comp)
                if not values:
                    if year<=last:raise ValueError('APS perdeu uma competência publicada')
                    continue
                p=raw/serie/f'{comp}.json';p.parent.mkdir(parents=True,exist_ok=True);salvar_json(p,values);current.append(dict(arquivo=str(p.relative_to(ctx.fontes)),sha256=sha(p)))
        if len(current)!=expected:
            # Um ano novo só entra depois das doze competências de cada série.
            for ref in current:ctx.excluir_copia(ctx.fontes/ref['arquivo'])
            continue
        refs.extend(current)
    changed=ctx.mudou(refs,codigo=('aps.py','saude.py'))
    if changed:
        out=ctx.raiz/'processado';out.mkdir();c=duckdb.connect()
        try:s.atencao_primaria(c,ctx.fontes,out)
        finally:c.close()
        mesclar(ctx.base/'gold/saude/aps_cobertura.parquet',out/'aps_cobertura.parquet')
        ctx.executar('automacao_saude.py','recompor','--base',ctx.base,'--fontes','aps',data_dir=ctx.base)
    guardar(ctx,[r['arquivo']for r in refs]);return changed


def fns(ctx):
    import fns as transform
    import fns_baixar as f
    from educacao_baixar import pagina,links
    from concurrent.futures import ThreadPoolExecutor
    closed=datetime.now(ZoneInfo('America/Sao_Paulo')).year-1
    page=pagina(f.BASE+'/downloads/');urls=dict(f.URLS)
    for url,title in links(page):
        text=(url+' '+title).lower()
        if 'repasse'not in text or'popula'not in text:continue
        match=re.search(r'(20\d{2})',title)or re.search(r'populacao[-_](20\d{2})',url,re.I)
        if not match:continue
        year=int(match[1])
        if year>closed or year in urls:continue
        if ('parcial'in text or 'acumulado'in text)and'dezembro'not in text:continue
        urls[year]=urljoin(f.BASE,url)
    years=sorted(y for y in urls if y<=closed)
    if years!=list(range(2002,max(years)+1)):raise ValueError('Catálogo FNS com lacunas')
    f.URLS.update(urls);f.ANOS=tuple(years)
    raw=ctx.fontes/'brutos/fns';raw.mkdir(parents=True,exist_ok=True)
    def get(year):
        name=f.nome_arquivo(year);ref=ctx.obter_oficial(urls[year],'brutos/fns/'+name)
        return year,{**ref,'arquivo':name,'url_final':urls[year]}
    with ThreadPoolExecutor(max_workers=3)as pool:refs=dict(pool.map(get,years))
    salvar_json(raw/'_fontes.json',{str(y):r for y,r in refs.items()})
    changed=ctx.mudou(fatos(list(refs.values())),codigo=('fns.py','fns_baixar.py'))
    if changed:
        transform.ANOS=tuple(years);out=ctx.raiz/'painel'
        report=transform.candidato(ctx.base/'gold',raw,out,anos=years,permitido=out)
        if report['quarentena']:
            import csv
            previous=ler(ctx.base/'gold/manifesto.json')['fontes']['fns']['arquivos']
            with(out/'auditoria/quarentena_fns.csv').open(encoding='utf-8-sig',newline='')as file:uncertain={int(row['ano'])for row in csv.DictReader(file,delimiter=';')}
            if any(refs[y]['sha256']!=previous.get(str(y),{}).get('sha256')for y in uncertain):raise ValueError('FNS: há linhas ambíguas em uma edição nova/retificada; conferir a quarentena')
        ctx.aplicar(out,('fns',))
    guardar(ctx,['brutos/fns/_fontes.json',*['brutos/fns/'+r['arquivo']for r in refs.values()],*['brutos/fns/'+r['arquivo']+'.oficial.json'for r in refs.values()]])
    return changed


def vacinacao(ctx):
    import vacinacao_baixar as f
    import vacinacao as v
    closed=datetime.now(ZoneInfo('America/Sao_Paulo')).year-1
    raw=ctx.fontes/'brutos/vacinacao';raw.mkdir(parents=True,exist_ok=True)
    # Reconsulta as edições: as coberturas oficiais podem ser retificadas.
    # A extração pública já é agregada e mantém células protegidas como ausentes.
    refs=[]
    for year in range(2015,closed+1):
        # Uma rodada nova tem cache próprio; não reutiliza a conclusão de outra consulta.
        folder=raw/str(year)
        if folder.exists():
            for p in folder.glob('*'):
                if p.is_file():ctx.excluir_copia(p)
        f.baixar_ano(year,raw)
    for p in raw.rglob('*.gz'):refs.append(dict(arquivo=str(p.relative_to(ctx.fontes)),sha256=sha(p)))
    if not refs:raise ValueError('Vacinação sem páginas oficiais')
    changed=ctx.mudou(refs,codigo=('vacinacao.py','vacinacao_baixar.py'))
    if changed:
        out=ctx.raiz/'painel';v.candidato(raw,ctx.base/'gold',out,list(range(2015,closed+1)));ctx.aplicar(out,('vacinacao',))
    guardar(ctx,[str(p.relative_to(ctx.fontes))for p in raw.rglob('*')if p.is_file()]);return changed
