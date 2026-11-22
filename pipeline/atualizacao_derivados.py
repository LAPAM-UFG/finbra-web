"""Regera aberturas, mapas e comparações de um candidato, antes da publicação."""
import gzip
import hashlib
import json
import copy
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from atualizacao_artefatos import Snapshot, instalar_overlay, sha, referencias
from assistencia_utils import destino_isolado


def geografia_sem_rotulos(meta):
    """Associações e ordem das posições; apenas nomes podem mudar sem recalcular."""
    out=copy.deepcopy(meta)
    for row in out['municipios']:row[1]=None
    for row in out['governos']:row[1]=None
    for territorio in out['territorios'].values():territorio['nome']=None
    return out


def reconciliar_geografia(novo,anterior,writer,resolver):
    if novo['geografia']==anterior['geografia']:return dict(rotulos=[],catalogos=[])
    def ler(ref):return json.loads(resolver.obter(ref['caminho'],ref).read_bytes())
    before,after=ler(anterior['geografia']),ler(novo['geografia'])
    if geografia_sem_rotulos(before)!=geografia_sem_rotulos(after):
        raise ValueError('geografia mudou: reprocessar todas as comparações antes de publicar')
    # Uma renomeação oficial não altera agrupamentos ou valores. Regrava só os
    # catálogos preservados para que todos apontem para a mesma geografia nova.
    rebound=[]
    for name,ref in anterior['catalogos'].items():
        if name in novo['catalogos']:continue
        catalog=ler(ref)
        if catalog['geografia']!=anterior['geografia']:raise ValueError('catálogo de outra geografia: '+name)
        catalog['geografia']=novo['geografia']
        novo['catalogos'][name]=writer.objeto(name+'_catalogo',catalog);rebound.append(name)
    renamed=[k for k in before['territorios'] if before['territorios'][k]['nome']!=after['territorios'][k]['nome']]
    return dict(rotulos=renamed,catalogos=rebound)


def assistencia_anuais(base,trabalho,snap):
    """Recalcula a cobertura anual e as três referências com os pagamentos novos."""
    import requests
    from assistencia_economia import gerar as economia
    from assistencia_referencias import gerar as referencias_anuais
    base=Path(base).resolve();trabalho=destino_isolado(Path(trabalho),base)
    m=json.loads((base/'gold/manifesto.json').read_bytes())
    saida=trabalho/'economia';economia(base,base/'gold/manifesto.json',saida);instalar_overlay(saida,base)
    fontes=trabalho/'fontes';resolver=Snapshot(fontes,[base,snap.raiz,*snap.caches])
    keys=['gold/manifesto.json','gold/trabalho/municipios.parquet','silver/ibge_pib.parquet','silver/ibge_populacao.parquet']
    for key in keys:
        target=fontes/key;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(base/key,target)
    for ref in m['fontes']['assistencia']['arquivos'].values():resolver.obter(ref['caminho'],ref)
    key='gold/assistencia/economia_manifesto.json';target=fontes/key;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(base/key,target)
    resolver.fixar_referencias(json.loads(target.read_bytes()),True)
    year=max(m['fontes']['ibge_populacao']['anos'])
    response=requests.get(f'https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/{year}',timeout=(20,120));response.raise_for_status()
    response.json();(fontes/'ibge_populacao_2026.json').write_bytes(response.content)
    prov={p.relative_to(fontes).as_posix():dict(bytes=p.stat().st_size,sha256=sha(p)) for p in fontes.rglob('*') if p.is_file()}
    (fontes/'proveniencia.json').write_text(json.dumps(dict(adquirido_em=datetime.now(timezone.utc).isoformat(),arquivos=prov)),encoding='utf-8')
    result=referencias_anuais(fontes,trabalho/'referencias');instalar_overlay(trabalho/'referencias',base)
    return dict(ok=True,anos=result['anos'],populacao_referencia=year)


def aberturas(base, trabalho):
    base=Path(base).resolve();trabalho=destino_isolado(Path(trabalho),base)
    import munic_painel_dados,clima_painel,clima_abertura,saude_abertura,abertura_paineis
    curadoria=Path(__file__).resolve().parent.parent/'web/src/munic_curadoria.ts'
    for nome,gerar in [('munic',lambda out:munic_painel_dados.gerar(base,out,curadoria)),('clima_painel',lambda out:clima_painel.gerar(base,out)),('clima_abertura',lambda out:clima_abertura.gerar(base,out)),('saude',lambda out:saude_abertura.gerar(base,out)),('paineis',lambda out:abertura_paineis.gerar(base,out))]:
        out=trabalho/nome;gerar(out);instalar_overlay(out,base,('gold',));print('Abertura preparada: '+nome,flush=True)


def mapas(publicado,base,trabalho,saida,caches=()):
    publicado,base,trabalho,saida=map(lambda p:Path(p).resolve(),[publicado,base,trabalho,saida])
    destino_isolado(saida,base);destino_isolado(trabalho,base)
    repo=Path(__file__).resolve().parent.parent;rev=trabalho/'fontes_mapas';rev.mkdir(parents=True,exist_ok=True)
    snap=Snapshot(publicado,[base,*caches]);refs={}
    for nome,key in [('global','gold/manifesto.json'),('abertura','gold/abertura/manifesto.json'),('educacao','gold/educacao/manifesto.json'),('saneamento','gold/saneamento/manifesto.json')]:
        raw=(base/key).read_bytes();(rev/(nome+'_base.json')).write_bytes(raw)
    m=json.loads((base/'gold/abertura/manifesto.json').read_bytes())
    for ref in referencias(m['trabalho']):
        path=snap.obter(ref['caminho'],ref);refs[ref['caminho']]={'caminho_local':str(path),**ref}
        if path.name.endswith('.json.gz'):
            index=json.loads(gzip.decompress(path.read_bytes()))
            if 'arquivo' in index:
                a=index['arquivo'];path=snap.obter(a['caminho'],a);refs[a['caminho']]={'caminho_local':str(path),**a}
    edu=json.loads((base/'gold/educacao/manifesto.json').read_bytes());a=edu['busca_municipios'];path=snap.obter(a['caminho'],a);refs[a['caminho']]={'caminho_local':str(path),**a}
    (rev/'fontes_resolvidas.json').write_text(json.dumps(refs,ensure_ascii=False),encoding='utf-8')
    bundle=repo/'web/testes/.saida/mapas_atualizacao'
    subprocess.run(['node',str(repo/'web/node_modules/vite/bin/vite.js'),'build','--ssr','scripts/preparar_mapas_trabalho.ts','--outDir',str(bundle),'--emptyOutDir','--logLevel','warn'],cwd=repo/'web',check=True)
    subprocess.run(['node',str(bundle/'preparar_mapas_trabalho.js'),str(rev)],cwd=repo/'web',check=True)
    from mapas_trabalho_saneamento import Gerador
    writer=Gerador(rev,saida);writer.trabalho()
    # Saúde é reempacotada por compatibilidade do manifesto. Se os valores são
    # idênticos, conserva o mapa pronto e atualiza apenas sua referência de fonte.
    previous=json.loads((publicado/'gold/manifesto.json').read_bytes())['aberturas']['saude'];current=json.loads((base/'gold/manifesto.json').read_bytes())['aberturas']['saude']
    def file(ann):return snap.obter(ann['arquivo'],dict(caminho=ann['arquivo'],bytes=ann['bytes'],sha256=ann['sha256']))
    old_path,new_path=file(previous),file(current)
    groups=0;identical=True
    with old_path.open('rb') as a,new_path.open('rb') as b:
        while True:
            left,right=a.readline(),b.readline()
            if not left or not right:
                if left!=right:identical=False
                break
            x,y=json.loads(left),json.loads(right);x.pop('s',None);y.pop('s',None)
            if x!=y:identical=False;break
            groups+=1
    if identical:
        meta=json.loads((publicado/'gold/mapas/saude_manifesto.json').read_bytes())
        meta['gerado_em']=datetime.now(timezone.utc).isoformat();meta['origem'].update(sha256=current['sha256'],indice_sha256=current['indice_sha256'],gerado_em=json.loads((base/'gold/manifesto.json').read_bytes())['gerado_em'])
        dest=saida/'gold/mapas/saude_manifesto.json';dest.parent.mkdir(parents=True,exist_ok=True);dest.write_text(json.dumps(meta,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    else:
        bundle=repo/'web/testes/.saida/catalogo_atualizacao'
        subprocess.run(['node',str(repo/'web/node_modules/vite/bin/vite.js'),'build','--ssr','scripts/catalogo_mapas.ts','--outDir',str(bundle),'--emptyOutDir','--logLevel','warn'],cwd=repo/'web',check=True)
        subprocess.run(['node',str(bundle/'catalogo_mapas.js'),str(rev/'global_base.json'),str(rev/'saude_catalogo_origem.json')],cwd=repo/'web',check=True)
        from mapas_indicadores import Gerador as MapasSaude
        health=trabalho/'mapa_saude';MapasSaude(base,rev,health).saude();instalar_overlay(health,saida)
    audit=dict(ok=True,trabalho=writer.audit,saude_grupos_identicos=groups,saude_mapa_preservado=identical)
    (saida/'auditoria_mapas.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    return audit


def comparacoes(publicado,base,trabalho,saida,caches=()):
    from comparacoes_fontes import Fontes
    from comparacoes import Comparacoes
    from comparacoes_base import compacto
    publicado,base,trabalho,saida=map(lambda p:Path(p).resolve(),[publicado,base,trabalho,saida])
    destino_isolado(saida,base);rev=trabalho/'fontes_comparacoes'
    Fontes(rev,[base,publicado,*caches],overlay=base).preparar()
    repo=Path(__file__).resolve().parent.parent;bundle=repo/'web/testes/.saida/catalogo_atualizacao'
    subprocess.run(['node',str(repo/'web/node_modules/vite/bin/vite.js'),'build','--ssr','scripts/catalogo_mapas.ts','--outDir',str(bundle),'--emptyOutDir','--logLevel','warn'],cwd=repo/'web',check=True)
    subprocess.run(['node',str(bundle/'catalogo_mapas.js'),str(rev/'global_base.json'),str(rev/'saude_catalogo_origem.json')],cwd=repo/'web',check=True)
    writer=Comparacoes(rev,saida,Path(__file__).resolve().parent.parent)
    for area in ['trabalho','saude']:writer.mapa(area)
    for area in ['financas','assistencia','clima','gestao']:getattr(writer,area)()
    novo=writer.writer.concluir();old=json.loads((publicado/'gold/comparacoes/manifesto.json').read_bytes())
    atualizados=list(novo['catalogos']);preservados=sorted(set(old['catalogos'])-set(atualizados))
    resolver=Snapshot(trabalho/'geografia',[saida,publicado,base,*caches],copiar_cache=False)
    geografia=reconciliar_geografia(novo,old,writer.writer,resolver)
    merged={**old,**novo,'catalogos':{**old['catalogos'],**novo['catalogos']},'origens':{**old['origens'],**novo['origens']}}
    (saida/'gold/comparacoes/manifesto.json').write_bytes(compacto(merged))
    audit=dict(ok=True,catalogos_atualizados=atualizados,catalogos_preservados=preservados,geografia=geografia)
    (saida/'auditoria_comparacoes.json').write_bytes(compacto(audit));return audit
