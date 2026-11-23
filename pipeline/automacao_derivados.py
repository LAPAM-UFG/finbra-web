"""Fecha a edição: valores prontos, formatos, mapas, comparações, Raio X e IA."""
import importlib
import json
import shutil
import subprocess
from pathlib import Path

import duckdb
import pyarrow.parquet as pq

from assistencia_utils import salvar_json
from atualizacao_artefatos import instalar_overlay,sha
from automacao_contexto import REPO
from automacao_temas import ler


def catalogo(base,work):
    work.mkdir(parents=True,exist_ok=True);schema=pq.ParquetFile(base/'gold/saude/municipios.parquet').schema_arrow
    salvar_json(work/'inventario.json',dict(manifesto=ler(base/'gold/manifesto.json'),parquet=[dict(path='gold/saude/municipios.parquet',schema={f.name:str(f.type)for f in schema})]))
    # Imports externos (React) precisam ser resolvidos dentro de web/node_modules.
    bundle=REPO/'web/testes/.saida/catalogos_automacao'
    subprocess.run(['node',str(REPO/'web/node_modules/vite/bin/vite.js'),'build','--ssr','scripts/catalogos_downloads.ts','--outDir',str(bundle),'--emptyOutDir','--logLevel','warn'],cwd=REPO/'web',check=True)
    subprocess.run(['node',str(bundle/'catalogos_downloads.js'),str(work/'inventario.json'),str(work/'catalogos.json')],cwd=REPO/'web',check=True)
    return work/'catalogos.json'


def core(publicado,base,snap,root,contexts,stata,rscript):
    from downloads_incremental import gerar
    areas=set();tables={};extra=[];temporary=base/'temporario_atualizacao';temporary.mkdir(exist_ok=True)
    for ctx in contexts:
        areas.update(set(ctx.rotina.areas)&{'financas','saude','trabalho','assistencia'})
        painel=getattr(ctx,'painel',None)
        if painel:
            area=ctx.rotina.id
            if area=='educacao':
                key=ler(base/'gold/educacao/manifesto.json')['parquet']['caminho'];tables[area]=key;areas.add(area);extra.append(key)
            else:
                p=painel/f'trabalho_{area}/municipios.parquet'
                if p.is_file():
                    target=temporary/(area+'.parquet');shutil.copy2(p,target);extra.append(target.relative_to(base).as_posix())
    if not areas and not extra:
        # Educação financeira ou metadados não acrescentam chaves ao painel principal.
        main=next(r for r in ler(publicado/'gold/downloads/manifesto.json')['arquivos']if r['id']=='painel_brasil_parquet')
        src=snap.obter(main['caminho'],main);target=base/main['caminho'];target.parent.mkdir(parents=True,exist_ok=True)
        if src.resolve()!=target.resolve():shutil.copy2(src,target)
        extra.append(main['caminho'])
    for year in ler(base/'gold/manifesto.json')['fontes']['rais_perfis']['anos']:
        key=ler(base/'gold/manifesto.json')['fontes']['rais_perfis']['arquivos'].replace('{ano}',str(year))
        if not(base/key).is_file():
            src=snap.obter(key);target=base/key;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,target)
    catalogs=catalogo(base,root/'catalogos');out=root/'core'
    result=gerar(publicado,base,out,catalogs,areas=tuple(sorted(areas)),stata=stata,rscript=rscript,caches=[snap.raiz,*snap.caches],tabelas=tables,chaves_extras=extra)
    instalar_overlay(out,base);return result


def exportar_temas(base,snap,root,contexts,stata,rscript):
    audit={}
    for ctx in contexts:
        area=ctx.rotina.id;painel=getattr(ctx,'painel',None)
        if area not in ['educacao','saneamento','agropecuaria','mobilidade','seguranca','internet','energia','comex']or not painel:continue
        # Restaura apenas os objetos que o exportador lê; os pacotes completos
        # continuam referenciados pelo manifesto sem download desnecessário.
        from downloads_navegacao import objetos
        old=ler(base/'gold/downloads/manifesto.json');refs,_=objetos(base,old)
        from atualizacao_artefatos import Snapshot
        resolver=Snapshot(root/('cache_'+area),[base,snap.raiz,*snap.caches])
        needed={old['dicionario']['caminho'],*[a['caminho']for a in old['arquivos']if a['id']=='painel_brasil_parquet'or a['tipo']=='metodologia'],*[r['caminho']for r in old['recortes_uf'].values()]}
        if area=='educacao':needed.update(a['caminho']for a in old['arquivos']if a['id']=='painel_educacao_parquet')
        for ref in refs:
            if not isinstance(ref,dict)or not ref.get('caminho'):continue
            key=ref['caminho']
            if key in needed:
                src=resolver.obter(key,ref);target=base/key;target.parent.mkdir(parents=True,exist_ok=True)
                if src.resolve()!=target.resolve():shutil.copy2(src,target)
        out=root/area;mod=importlib.import_module(area+'_downloads')
        if area=='educacao':mod.gerar(base,painel,out,stata,rscript,atualizar=True)
        else:mod.gerar(base,painel,out,stata,rscript)
        instalar_overlay(out,base);audit[area]=str(out)
    # SIOPE altera só o bloco financeiro da Educação, com os Parquet do Censo
    # idênticos. A origem do catálogo deve acompanhar essa edição também.
    if any(c.rotina.id=='siope'for c in contexts):
        key='gold/downloads/manifesto.json';m=ler(base/key);edu=ler(base/'gold/educacao/manifesto.json')
        m.setdefault('fontes_complementares',{})['educacao']=dict(caminho='gold/educacao/manifesto.json',sha256=sha(base/'gold/educacao/manifesto.json'),gerado_em=edu['gerado_em'])
        salvar_json(base/key,m)
    return audit


def fechar(publicado,base,snap,root):
    from atualizacao_derivados import assistencia_anuais,mapas,comparacoes
    from atualizar_bases import raiox
    # As aberturas já estão fixadas antes dos downloads. Recriá-las aqui muda o
    # manifesto global e invalida o hash de origem dos RDS e do catálogo/API.
    assistencia_anuais(base,root/'assistencia_anuais',snap)
    mapas(publicado,base,root/'preparar_mapas',root/'mapas',[snap.raiz,*snap.caches]);instalar_overlay(root/'mapas',base)
    comparacoes(publicado,base,root/'preparar_comparacoes',root/'comparacoes',[snap.raiz,*snap.caches]);instalar_overlay(root/'comparacoes',base)
    return raiox(base,snap,root/'raiox')


def perdas(old,new,keys):
    """Uma célula publicada não pode desaparecer silenciosamente numa retificação."""
    c=duckdb.connect(config={'memory_limit':'2GB','threads':2})
    try:
        a=pq.read_schema(old);b=pq.read_schema(new)
        if not set(a.names)<=set(b.names):raise ValueError('Colunas publicadas desapareceram')
        for path in (old,new):
            n=c.execute('SELECT count(*)FROM(SELECT '+','.join('"'+k+'"'for k in keys)+' FROM read_parquet(?)GROUP BY ALL HAVING count(*)>1)',[str(path)]).fetchone()[0]
            if n:raise ValueError('Chaves duplicadas: '+str(path))
        cols=[x for x in a.names if x not in keys and not x.endswith(('_cond','_nota'))]
        cond=' OR '.join('(a."'+x+'" IS NOT NULL AND b."'+x+'" IS NULL)'for x in cols)
        if not cond:return 0
        join=' AND '.join('a."'+k+'" IS NOT DISTINCT FROM b."'+k+'"'for k in keys)
        n=c.execute('SELECT count(*)FROM read_parquet(?)a LEFT JOIN read_parquet(?)b ON '+join+' WHERE '+cond,[str(old),str(new)]).fetchone()[0]
        if n:raise ValueError(f'{n} linhas perderam valores publicados: {new}')
        return n
    finally:c.close()


def cobertura_downloads(publicado,base,snap,root):
    from atualizacao_artefatos import Snapshot
    old=ler(publicado/'gold/downloads/manifesto.json');new=ler(base/'gold/downloads/manifesto.json')
    resolver=Snapshot(root,[base,publicado,snap.raiz,*snap.caches],copiar_cache=False)
    before={a['id']:a for a in old['arquivos']if a['formato']=='parquet'and not a.get('uf')and a['tipo']in ('painel','area')}
    after={a['id']:a for a in new['arquivos']if a['formato']=='parquet'and not a.get('uf')and a['tipo']in ('painel','area')}
    if not set(before)<=set(after):raise ValueError('Conjunto de download publicado desapareceu')
    checked=[]
    for id,a in before.items():
        b=after[id]
        if a['sha256']==b['sha256']:continue
        ap=resolver.obter(a['caminho'],a);bp=resolver.obter(b['caminho'],b)
        perdas(ap,bp,['cod_ibge','ano']);checked.append(id)
    return dict(ok=True,conjuntos_conferidos=checked)
