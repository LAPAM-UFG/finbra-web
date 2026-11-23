"""Publicação condicional: acrescenta imutáveis, guarda backup e ativa ponteiros.

Nunca apaga objetos. Uma mudança concorrente impede a ativação. Em falha, só
restaura um objeto se ele ainda contém exatamente o que esta transação escreveu.
"""
import base64
import gzip
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from atualizacao_artefatos import referencias,caminho_resolvido

TEMAS=('educacao','saneamento','agropecuaria','mobilidade','seguranca','internet','energia','comex')
MAPAS=('trabalho','saude',*TEMAS)
PONTEIROS=['gold/abertura/manifesto.json',*[f'gold/{a}/manifesto.json' for a in TEMAS],
           *[f'gold/mapas/{a}_manifesto.json' for a in MAPAS],
           'gold/assistencia/economia_manifesto.json','gold/assistencia/referencias_manifesto.json',
           'gold/comparacoes/manifesto.json','gold/downloads/manifesto.json','gold/raiox/v13_manifesto.json','gold/manifesto.json']
FIXOS={'gold/ipca.parquet','gold/saude_educacao.parquet','gold/assistencia/fonte.json','gold/assistencia/qualidade.json','silver/ipca.parquet','silver/atualizacao/fontes.json'}


def mutavel(key):
    if key in PONTEIROS or key in FIXOS:return True
    if key.startswith(('gold/clima/','gold/munic/')):
        return key.endswith('.parquet') or key.endswith(('painel_indice.json',))
    if key.startswith('gold/trabalho/'):
        return key.rsplit('/',1)[-1] in ['municipios.parquet','estados.parquet','setores.parquet','setores_uf.parquet','setores_validos.parquet','setores_uf_validos.parquet','cnae.parquet','dicionario.parquet','indice.json','caged.parquet','caged_anual.parquet','caged_uf.parquet','caged_cbo.parquet'] or key.startswith(('gold/trabalho/perfis_v2/','gold/trabalho/perfis_v2_validos/','gold/trabalho/perfis/','gold/trabalho/cubo_'))
    if key.startswith(('gold/saude/','gold/siope/','gold/siops/')):
        name=key.rsplit('/',1)[-1]
        return name in {'populacao.parquet','obitos.parquet','obitos_fetais.parquet','nascimentos.parquet','internacoes.parquet','internacoes_atend.parquet','icsap.parquet','cnes.parquet','sinan.parquet','siscan.parquet','oncologia.parquet','resp.parquet','ambulatorial.parquet','ambulatorial_subgrupo.parquet','aps_cobertura.parquet','municipios.parquet','fns_municipios.parquet','fns_composicao.parquet','fns_anos.parquet','vacinacao.parquet','vacinacao_catalogo.parquet','vacinacao_territorios.parquet','indicadores.parquet','remuneracao.parquet','receitas.parquet','despesas.parquet','despesas_funcao.parquet','gerais.parquet','fundeb.parquet'}
    if key.startswith(('silver/clima/','silver/trabalho/','silver/siope/','silver/siops/','silver/bolsa_familia_mensal/','silver/assistencia/pbf_cgu/')):return key.endswith(('.parquet','.json'))
    return key in ['gold/indicadores.parquet','gold/alertas.parquet','gold/escopos.parquet','gold/receita_fonte.parquet','gold/despesa_funcao.parquet','gold/lrf.parquet','gold/arvore.parquet','gold/faixas.parquet','silver/entes.parquet','silver/ibge_pib.parquet','silver/ibge_populacao.parquet','silver/inss_municipios.parquet'] or key.startswith(('gold/entes/','gold/grupos/','silver/dca/','silver/lrf/','silver/contas/','silver/populacao/'))


def digest(path,algorithm):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,algorithm).hexdigest()


def hashes(path):
    md5,sha256=hashlib.md5(),hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):md5.update(block);sha256.update(block)
    return dict(md5=md5.hexdigest(),sha256=sha256.hexdigest())


def inventario(client,bucket):
    return {x['Key']:dict(bytes=x['Size'],etag=x['ETag']) for prefix in ['gold/','silver/'] for page in client.get_paginator('list_objects_v2').paginate(Bucket=bucket,Prefix=prefix) for x in page.get('Contents',[])}


def arquivos(raiz):
    raiz=caminho_resolvido(raiz);selected={};pending=[];expected={}
    for key in PONTEIROS:
        path=raiz/key
        if not path.is_file():raise ValueError('ponteiro candidato ausente: '+key)
        pending.append(key)
    for layer in ['gold','silver']:
        for path in (raiz/layer).rglob('*'):
            if path.is_file() and mutavel(path.relative_to(raiz).as_posix()):pending.append(path.relative_to(raiz).as_posix())
    while pending:
        key=pending.pop()
        if key in selected:
            ref=expected.get(key)
            if ref and (selected[key]['bytes'],selected[key]['sha256'])!=ref:raise ValueError('referência local divergente: '+key)
            continue
        path=caminho_resolvido(raiz/key)
        if not path.is_relative_to(raiz):raise ValueError('artefato fora da candidata')
        if not path.exists():continue  # Referência a um objeto já publicado, preservado.
        if '.parte' in key or 'temporario' in key:raise ValueError('artefato incompleto: '+key)
        selected[key]=dict(local=str(path),bytes=path.stat().st_size,**hashes(path))
        if key in expected and (selected[key]['bytes'],selected[key]['sha256'])!=expected[key]:raise ValueError('referência local divergente: '+key)
        if key.endswith(('.json','.json.gz')):
            raw=path.read_bytes();obj=json.loads(gzip.decompress(raw) if key.endswith('.gz') else raw)
            for ref in referencias(obj):
                target=raiz/ref['caminho']
                if target.is_file():
                    required=(ref['bytes'],ref['sha256'])
                    if ref['caminho'] in expected and expected[ref['caminho']]!=required:raise ValueError('referências incompatíveis: '+ref['caminho'])
                    expected[ref['caminho']]=required
                    pending.append(ref['caminho'])
    return selected


def planejar(client,bucket,raiz,esperado):
    before=inventario(client,bucket)
    for key,ref in esperado.items():
        if key in before and (before[key]['etag']!=ref['etag'] or before[key]['bytes']!=ref['bytes']):raise ValueError('origem mudou durante a preparação: '+key)
        if key not in before:raise ValueError('origem foi retirada: '+key)
    files=arquivos(raiz);changed={}
    for key,ref in files.items():
        old=before.get(key)
        if old==dict(bytes=ref['bytes'],etag='"'+ref['md5']+'"'):continue
        if old and old['bytes']==ref['bytes'] and '-' in old['etag']:
            h=client.head_object(Bucket=bucket,Key=key)
            if h['ETag']!=old['etag']:raise ValueError('origem mudou no planejamento: '+key)
            meta=h.get('Metadata',{})
            if meta.get('md5')==ref['md5'] or meta.get('sha256')==ref['sha256']:continue
        if old and not mutavel(key):raise ValueError('tentativa de substituir imutável: '+key)
        changed[key]=ref
    return dict(arquivos=changed,antes=before)


def enviar(client,bucket,key,ref,condicao):
    path=Path(ref['local'])
    if digest(path,'sha256')!=ref['sha256']:raise ValueError('candidato mudou: '+key)
    with path.open('rb') as body:
        client.put_object(Bucket=bucket,Key=key,Body=body,ContentLength=ref['bytes'],ContentMD5=base64.b64encode(bytes.fromhex(ref['md5'])).decode(),ContentType='application/json; charset=utf-8' if key.endswith('.json') else 'application/octet-stream',CacheControl='no-cache' if mutavel(key) else 'public, max-age=31536000, immutable',Metadata={'sha256':ref['sha256'],'md5':ref['md5']},**condicao)
    h=client.head_object(Bucket=bucket,Key=key)
    if h['ContentLength']!=ref['bytes'] or h['ETag'].strip('"')!=ref['md5']:raise ValueError('verificação após envio falhou: '+key)
    return h['ETag']


def stage(client,bucket,plano):
    todo=[(k,v) for k,v in plano['arquivos'].items() if k not in plano['antes'] and k not in PONTEIROS]
    def gravar(item):
        key,ref=item
        try:
            h=client.head_object(Bucket=bucket,Key=key)
        except Exception as e:
            if getattr(e,'response',{}).get('Error',{}).get('Code') not in ['404','NoSuchKey','NotFound']:raise
        else:
            if h['ContentLength']!=ref['bytes'] or h['ETag'].strip('"')!=ref['md5']:raise ValueError('entrada nova concorrente: '+key)
            return h['ETag']
        return enviar(client,bucket,key,ref,{'IfNoneMatch':'*'})
    with ThreadPoolExecutor(max_workers=4) as pool:
        for count,_ in enumerate(pool.map(gravar,todo),1):
            if count%100==0:print(f'Envio: {count}/{len(todo)} objetos novos conferidos',flush=True)
    return dict(ok=True,imutaveis_e_entradas_novas=len(todo))


def ativar(client,bucket,plano,backup):
    backup=Path(backup).resolve();backup.mkdir(parents=True,exist_ok=True);changed=plano['arquivos'];before=plano['antes'];written=[]
    replacements=[k for k in changed if k in before]
    # Pré-condições e backups são concluídos antes da primeira substituição.
    for key in replacements:
        current=client.get_object(Bucket=bucket,Key=key)
        if current['ETag']!=before[key]['etag']:raise ValueError('ativação concorrente: '+key)
        raw=current['Body'].read();path=backup/key
        if path.exists() and path.read_bytes()!=raw:raise ValueError('backup anterior diferente: '+key)
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(raw)
    fallback={}
    if 'gold/raiox/v13_manifesto.json' in changed and 'gold/raiox/v13_manifesto.json' not in before and 'gold/raiox/v12_manifesto.json' in before:
        key='gold/raiox/v12_manifesto.json';obj=client.get_object(Bucket=bucket,Key=key)
        if obj['ETag']!=before[key]['etag']:raise ValueError('Raio X anterior mudou')
        path=backup/'fallback/raiox.json';path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(obj['Body'].read());fallback['gold/raiox/v13_manifesto.json']=path
    order=[k for k in changed if k not in PONTEIROS and k in before]+[k for k in PONTEIROS if k in changed]
    try:
        for key in order:
            condition={'IfMatch':before[key]['etag']} if key in before else {'IfNoneMatch':'*'}
            tag=enviar(client,bucket,key,changed[key],condition);written.append((key,tag))
    except Exception:
        for key,tag in reversed(written):
            if key not in before and key not in fallback:continue
            path=backup/key if key in before else fallback[key]
            ref=dict(local=str(path),bytes=path.stat().st_size,md5=digest(path,'md5'),sha256=digest(path,'sha256'))
            try:enviar(client,bucket,key,ref,{'IfMatch':tag})
            except Exception as rollback_error:print('Restauração precisa ser conferida: '+key+' ('+type(rollback_error).__name__+')',flush=True)
        raise
    after=inventario(client,bucket)
    for key,ref in before.items():
        if key not in changed and after.get(key)!=ref:raise ValueError('objeto fora do lote mudou: '+key)
    for key,ref in changed.items():
        if after.get(key)!=dict(bytes=ref['bytes'],etag='"'+ref['md5']+'"'):raise ValueError('publicação incompleta: '+key)
    result=dict(ok=True,novos=len(set(changed)-set(before)),substituidos=len(replacements),preservados=len(before)-len(replacements),objetos=len(changed))
    (backup/'resultado.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
