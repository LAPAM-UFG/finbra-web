"""Atualização coordenada, verificável e sem publicação parcial de derivados.

Uso: --raiz PASTA_NOVA [--fontes ipca caged pbf gestao clima] [--publicar]
Em CI, R2_* e CDSAPI_* vêm dos secrets. Sem --publicar, só gera o candidato.
"""
import argparse
import copy
import gzip
import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime,timezone
from pathlib import Path

import duckdb
import numpy as np
import requests
from assistencia_utils import destino_isolado,salvar_json
from atualizacao_artefatos import Snapshot,instalar_overlay,sha
from atualizacao_fontes import baixar,baixar_caged,caged_disponivel,baixar_gestao,clima_disponivel,baixar_clima

REPO=Path(__file__).resolve().parent.parent


def copiar_arquivo(src,dst):
    dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)


def preparar_fiscal(root,area):
    """Só baixa as entradas fiscais: dispensa décadas de clima, cubos e downloads."""
    from concurrent.futures import ThreadPoolExecutor
    import r2
    from publicacao_lote import inventario
    root=destino_isolado(Path(root));snap=Snapshot(root)
    client,bucket=r2.cliente();inv=inventario(client,bucket)
    exact={'gold/manifesto.json','silver/entes.parquet','silver/ibge_populacao.parquet','silver/ibge_pib.parquet','silver/ipca.parquet','silver/inss_municipios.parquet'}
    prefixes=('silver/dca/','silver/contas/','silver/populacao/','silver/bolsa_familia_mensal/','silver/lrf/') if area=='fiscal' else ('silver/lrf/',)
    keys=[k for k in inv if k in exact or k.startswith(prefixes)]
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda key:snap.obter_r2(client,bucket,key,inv[key]),keys))
    return dict(ok=True,area=area,arquivos=len(keys))


def fixar_base(root,caches=()):
    import r2
    from publicacao_lote import inventario
    client,bucket=r2.cliente();inv=inventario(client,bucket);base=root/'base';snap=Snapshot(base,caches)
    keys={k for k in inv if k.startswith('gold/') and (k.count('/')==1 or k.startswith(('gold/munic/','gold/clima/','gold/trabalho/','gold/saude/','gold/siope/','gold/siops/')) and k.endswith('.parquet') and not any(x in k for x in ['cubo_','perfis_','abertura_']))}
    keys.update(k for k in inv if k.startswith(('silver/trabalho/caged/','silver/trabalho/caged_cbo/','silver/bolsa_familia_mensal/','silver/clima/')) or k in ['silver/entes.parquet','silver/ibge_populacao.parquet','silver/ibge_pib.parquet','silver/ipca.parquet','silver/inss_municipios.parquet','silver/atualizacao/fontes.json'])
    keys.update(['gold/manifesto.json','gold/abertura/manifesto.json','gold/comparacoes/manifesto.json','gold/downloads/manifesto.json','gold/raiox/v12_manifesto.json',*[f'gold/mapas/{x}_manifesto.json' for x in ['trabalho','saude','educacao','saneamento']],*[f'gold/{x}/manifesto.json' for x in ['educacao','saneamento','agropecuaria','mobilidade','seguranca','internet','energia','comex']]])
    if 'gold/raiox/v13_manifesto.json' in inv:keys.add('gold/raiox/v13_manifesto.json')
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as pool:list(pool.map(lambda key:snap.obter_r2(client,bucket,key,inv[key]),sorted(keys)))
    meta=json.loads((base/'gold/manifesto.json').read_bytes())
    for year in meta['fontes']['rais_perfis']['anos']:
        snap.obter(meta['fontes']['rais_perfis']['arquivos'].replace('{ano}',str(year)))
    social=meta['fontes']['assistencia'];idx=snap.json(social['abertura']['caminho'],social['abertura'])
    snap.obter(idx['arquivo']['caminho'],idx['arquivo']);snap.obter(social['qualidade'])
    for ref in social['arquivos'].values():snap.obter(ref['caminho'],ref)
    expected=inv
    salvar_json(root/'snapshot_base.json',expected)
    return base,snap,expected


def aplicar(base,out,source,keys):
    manifest=json.loads((out/'gold/manifesto.json').read_bytes());new=json.loads((source/'gold/manifesto.json').read_bytes())
    for k in keys:manifest['fontes'][k]=new['fontes'][k]
    instalar_overlay(source,out)
    salvar_json(out/'gold/manifesto.json',manifest)


def ipca(base,saida):
    from externos import ipca as obter
    df=obter();old=__import__('pandas').read_parquet(base/'silver/ipca.parquet')
    common=old[old.completo].merge(df,on='exercicio',suffixes=('_old','_new'))
    if not np.allclose(common.indice_old,common.indice_new,rtol=1e-12,atol=1e-12):raise ValueError('IPCA fechado foi retificado: reavaliar os valores reais já preparados')
    if df.equals(old):return False
    out=saida/'silver/ipca.parquet';out.parent.mkdir(parents=True,exist_ok=True);df.to_parquet(out,index=False)
    m=json.loads((base/'gold/manifesto.json').read_bytes());year=int(m['base_ipca'])
    if not bool(df.loc[df.exercicio==year,'completo'].iloc[0]):raise ValueError('base de preços indisponível')
    out=saida/'gold/ipca.parquet';out.parent.mkdir(parents=True,exist_ok=True);c=duckdb.connect()
    try:c.execute('COPY (SELECT p.*,b.indice/p.indice fator_real,b.exercicio ano_base FROM read_parquet(?) p CROSS JOIN (SELECT exercicio,indice FROM read_parquet(?) WHERE exercicio=?) b) TO ? (FORMAT parquet)',[str(saida/'silver/ipca.parquet'),str(saida/'silver/ipca.parquet'),year,str(out)])
    finally:c.close()
    m['fontes']['ipca'].update(ultimo=int(df.exercicio.max()),meses=int(df.meses.iloc[-1]),processado_em=datetime.now(timezone.utc).isoformat());m['ipca_ultimo']={'exercicio':int(df.exercicio.max()),'meses':int(df.meses.iloc[-1])}
    salvar_json(saida/'gold/manifesto.json',m);return True


def raiox(base,snap,root,edicao=13):
    roots=['gold/comparacoes/manifesto.json','gold/assistencia/referencias_manifesto.json',*[f'gold/{x}/manifesto.json'for x in ['agropecuaria','mobilidade','seguranca','internet','energia','comex']]]
    sources=root/'fontes_raiox';sources.mkdir(parents=True,exist_ok=True);refs={}
    # Um Snapshot separado usa primeiro o candidato, preservando objetos de áreas
    # que não foram alteradas e conferindo todos os hashes do grafo ativo.
    resolver=Snapshot(root/'cache_raiox',[base,snap.raiz,*snap.caches],copiar_cache=False)
    def obter(ref):
        key=ref['caminho']
        if key not in refs:
            path=resolver.obter(key,ref);refs[key]=resolver.proveniencia[key]
        return Path(refs[key]['local'])
    def ler(ref):
        path=obter(ref);raw=path.read_bytes()
        return json.loads(gzip.decompress(raw) if path.name.endswith('.gz') else raw)
    for key in roots:
        path=base/key
        if not path.is_file():path=resolver.obter(key)
        meta=json.loads(path.read_bytes());refs[key]=dict(local=str(path),bytes=path.stat().st_size,sha256=sha(path))
        # O retrato só usa catálogo, índices e séries. Rankings, pacotes de
        # download e exports completos permanecem disponíveis sob demanda.
        if key=='gold/comparacoes/manifesto.json':
            obter(meta['geografia'])
            for ref in meta['catalogos'].values():
                catalog=ler(ref)
                for idx in catalog['indices'].values():obter(ler(idx)['arquivo'])
        elif key=='gold/assistencia/referencias_manifesto.json':
            obter(meta['arquivo'])
            for ref in meta['indices_uf'].values():ler(ref)
        else:
            ler(meta['catalogo'])
            for ref in meta['indices'].values():obter(ler(ref)['arquivo'])
        print('Raio X: fontes conferidas de '+key,flush=True)
    salvar_json(sources/'proveniencia.json',{'arquivos':refs})
    from raio_x import gerar
    result=gerar(sources,root/'raiox',edicao);instalar_overlay(root/'raiox',base);return result


def derivados(publicado,base,snap,root,stata=None,rscript=None,areas=None):
    from atualizacao_derivados import aberturas,mapas,comparacoes,assistencia_anuais
    aberturas(base,root/'aberturas')
    assistencia_anuais(base,root/'assistencia_anuais',snap)
    work=root/'catalogos';work.mkdir(parents=True,exist_ok=True)
    import pyarrow.parquet as pq
    m=json.loads((base/'gold/manifesto.json').read_bytes());schema=pq.ParquetFile(base/'gold/saude/municipios.parquet').schema_arrow
    salvar_json(work/'inventario.json',dict(manifesto=m,parquet=[dict(path='gold/saude/municipios.parquet',schema={f.name:str(f.type)for f in schema})]))
    bundle=REPO/'web/testes/.saida/catalogos_atualizacao'
    subprocess.run(['node',str(REPO/'web/node_modules/vite/bin/vite.js'),'build','--ssr','scripts/catalogos_downloads.ts','--outDir',str(bundle),'--emptyOutDir','--logLevel','warn'],cwd=REPO/'web',check=True)
    subprocess.run(['node',str(bundle/'catalogos_downloads.js'),str(work/'inventario.json'),str(work/'catalogos.json')],cwd=REPO/'web',check=True)
    from downloads_incremental import gerar
    for y in m['fontes']['rais_perfis']['anos']:
        key=m['fontes']['rais_perfis']['arquivos'].replace('{ano}',str(y));copiar_arquivo(snap.obter(key),base/key)
    gerar(publicado,base,root/'downloads',work/'catalogos.json',areas=areas or ('trabalho','gestao','assistencia','clima'),stata=stata,rscript=rscript,caches=snap.caches)
    instalar_overlay(root/'downloads',base)
    mapas(publicado,base,root/'preparar_mapas',root/'mapas',snap.caches);instalar_overlay(root/'mapas',base)
    comparacoes(publicado,base,root/'preparar_comparacoes',root/'comparacoes',snap.caches);instalar_overlay(root/'comparacoes',base)
    raiox(base,snap,root)


def executar(root,fontes,publicar=False,stata=None,rscript=None,caches=(),base_extra=None,raw_area=None):
    root=destino_isolado(Path(root));root.mkdir(parents=True,exist_ok=True)
    base,snap,expected=fixar_base(root,caches);out=root/'candidato';instalar_overlay(base,out)
    m=json.loads((base/'gold/manifesto.json').read_bytes());changes=[];source_report={}
    if base_extra:
        extra=Path(base_extra).resolve();source=json.loads((extra/'gold/manifesto.json').read_bytes())
        if source.get('base_ipca')!=m['base_ipca']:raise ValueError('atualização parcial não pode mudar a base de preços')
        allowed=['gold/indicadores.parquet','gold/alertas.parquet','gold/escopos.parquet','gold/receita_fonte.parquet','gold/despesa_funcao.parquet','gold/arvore.parquet','gold/faixas.parquet','silver/entes.parquet','silver/ibge_pib.parquet','silver/ibge_populacao.parquet','silver/inss_municipios.parquet'] if raw_area=='fiscal' else ['gold/lrf.parquet']
        allowed += [p.relative_to(extra).as_posix() for prefix in (['gold/entes','gold/grupos','silver/dca','silver/contas','silver/populacao','silver/bolsa_familia_mensal'] if raw_area=='fiscal' else ['silver/lrf']) for p in (extra/prefix).rglob('*') if p.is_file()]
        for key in allowed:
            if (extra/key).is_file():copiar_arquivo(extra/key,out/key)
        for key in (['siconfi','ibge_pib','ibge_populacao','populacao_declarada','inss','bolsa_familia'] if raw_area=='fiscal' else ['siconfi_lrf']):
            if key in source['fontes']:m['fontes'][key]=source['fontes'][key]
        if raw_area=='fiscal':
            for key in ['anos','colunas','mapa_indicadores','politica_alertas']:
                if key in source:m[key]=source[key]
        salvar_json(out/'gold/manifesto.json',m);changes.append(raw_area)
    if 'ipca' in fontes and ipca(base,root/'ipca'):
        aplicar(base,out,root/'ipca',['ipca']);current=json.loads((out/'gold/manifesto.json').read_bytes());current['ipca_ultimo']=json.loads((root/'ipca/gold/manifesto.json').read_bytes())['ipca_ultimo'];salvar_json(out/'gold/manifesto.json',current);changes.append('ipca')
    if 'caged' in fontes:
        latest=max(caged_disponivel());source_report['caged']=baixar_caged(root/'brutos',latest)
        from caged_atualizar import gerar
        gerar(base,root/'brutos',root/'caged');aplicar(base,out,root/'caged',['caged','caged_cbo']);changes.append('caged')
    if 'pbf' in fontes:
        from assistencia_download import competencias,IPCA
        from assistencia_pbf_cgu import agregar
        from assistencia_incremental import gerar
        index=snap.json(m['fontes']['assistencia']['abertura']['caminho'],m['fontes']['assistencia']['abertura'])
        known=set(next(i['competencias'] for i in index['indicadores']if i['id']=='pbf_cgu_valor'));selected=sorted(set(competencias('novo-bolsa-familia'))-known)
        if selected:
            entries=root/'pbf_agregado'
            for month in selected:
                path=root/f'brutos/pbf/{month}.zip';baixar(f'https://portaldatransparencia.gov.br/download-de-dados/novo-bolsa-familia/{month}',path);agregar(path,month,entries)
            monthly=root/'ipca_mensal.json';baixar(IPCA,monthly);gerar(base,entries/'silver/assistencia/pbf_cgu',monthly,root/'pbf');aplicar(base,out,root/'pbf',['assistencia'])
            for month in selected:copiar_arquivo(entries/f'silver/assistencia/pbf_cgu/{month}.parquet',out/f'silver/bolsa_familia_mensal/{month}.parquet')
            current=json.loads((out/'gold/manifesto.json').read_bytes());current['fontes']['bolsa_familia'].update(ultimo_mes=max(selected),processado_em=datetime.now(timezone.utc).isoformat());salvar_json(out/'gold/manifesto.json',current);changes.append('pbf')
    if 'gestao' in fontes:
        source_report['gestao']=baixar_gestao(root/'brutos')
        env={**os.environ,'DATA_DIR':str(out),'MUNIC_BRUTOS':str(root/'brutos')}
        import sys
        subprocess.run([sys.executable,str(REPO/'pipeline/munic.py'),'--anos',*map(str,sorted({x['ano'] for x in source_report['gestao']})),'--incremental'],env=env,check=True);changes.append('gestao')
    if 'clima' in fontes:
        found=clima_disponivel();source_report['clima']=found
        if found['ate']>m['fontes']['clima']['ate']:
            malha=root/'malha/BR_Municipios_2022.zip';baixar('https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2022/Brasil/BR/BR_Municipios_2022.zip',malha)
            old_month=m['fontes']['clima']['ate'];year,month=divmod(old_month,100);desde=(year+1)*100+1 if month==12 else old_month+1
            baixar_clima(root/'brutos/clima',found['ate'],malha,desde)
            from clima_incremental import gerar
            gerar(base,root/'brutos/clima',root/'clima',desde);aplicar(base,out,root/'clima',['clima']);changes.append('clima')
    if not changes:return dict(ok=True,sem_mudanca=True)
    current=json.loads((out/'gold/manifesto.json').read_bytes());current['gerado_em']=datetime.now(timezone.utc).isoformat();salvar_json(out/'gold/manifesto.json',current)
    (out/'silver/atualizacao').mkdir(parents=True,exist_ok=True)
    salvar_json(out/'silver/atualizacao/fontes.json',dict(consultado_em=current['gerado_em'],fontes=source_report))
    derivados(base,out,snap,root,stata,rscript,areas=('financas','trabalho','gestao','assistencia','clima') if raw_area else None)
    from validar_atualizacao import gerar as validar
    validation=validar(out,base,root/'validacao',snap.caches)
    report=dict(ok=True,fontes=changes,validacao=validation,publicado=False)
    salvar_json(root/'resultado.json',report)
    if publicar:
        import r2
        from publicacao_lote import planejar,stage,ativar
        client,bucket=r2.cliente();plan=planejar(client,bucket,out,expected);salvar_json(root/'plano_publicacao.json',plan);stage(client,bucket,plan);report['publicacao']=ativar(client,bucket,plan,root/'backup_r2');report['publicado']=True;salvar_json(root/'resultado.json',report)
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raiz',type=Path,required=True);p.add_argument('--fontes',nargs='*',choices=['ipca','caged','pbf','gestao','clima'],default=['ipca','caged','pbf','gestao','clima']);p.add_argument('--publicar',action='store_true');p.add_argument('--stata',type=Path);p.add_argument('--rscript',type=Path);p.add_argument('--caches',type=Path,nargs='*',default=[]);p.add_argument('--base-extra',type=Path);p.add_argument('--raw-area',choices=['fiscal','lrf'])
    p.add_argument('--preparar-fiscal',choices=['fiscal','lrf'])
    a=p.parse_args()
    if bool(a.base_extra)!=bool(a.raw_area):p.error('--base-extra e --raw-area devem ser usados juntos')
    print(json.dumps(preparar_fiscal(a.raiz,a.preparar_fiscal) if a.preparar_fiscal else executar(a.raiz,a.fontes,a.publicar,a.stata,a.rscript,a.caches,a.base_extra,a.raw_area),ensure_ascii=False))
