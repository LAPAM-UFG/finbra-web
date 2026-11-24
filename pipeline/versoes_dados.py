"""Índices congelados e arquivo antes da substituição, sem duplicar o bucket.

Um URL antigo recebe os mesmos bytes ou falha explicitamente. Nunca recebe
silenciosamente a edição atual sob um cache immutable de uma edição anterior.
"""
import hashlib,json,re

HASH=re.compile(r'_[a-f0-9]{16,64}\.(?:json(?:\.gz)?|ndjson|parquet|bin|csv(?:\.zip)?|dta|rds)$')

def versao_manifesto(m):
    c=m.get('cache_http',{})
    return c['versao']if c.get('manifesto_gerado_em')==m['gerado_em']and re.fullmatch(r'\d{8,39}',c.get('versao',''))else re.sub(r'\D','',m['gerado_em'])

def inexistente(e):
    return getattr(e,'response',{}).get('Error',{}).get('Code')in ['404','NoSuchKey','NotFound']

def arquivar(client,bucket,key,etag=None):
    if not key.startswith(('gold/','silver/'))or key.startswith('gold/versoes/')or HASH.search(key):return
    try:head=client.head_object(Bucket=bucket,Key=key)
    except Exception as e:
        if inexistente(e):return
        raise
    if etag and head['ETag']!=etag:raise ValueError('Origem mudou antes de arquivar: '+key)
    tag=head['ETag'].strip('"')
    if not re.fullmatch(r'[a-f0-9]{32}(?:-\d+)?',tag):raise ValueError('ETag não suportado: '+key)
    arquivo='gold/versoes/objetos/'+tag
    try:salvo=client.head_object(Bucket=bucket,Key=arquivo)
    except Exception as e:
        if not inexistente(e):raise
    else:
        if salvo['ContentLength']!=head['ContentLength']or salvo.get('Metadata',{}).get('origem_etag')!=tag:raise ValueError('Arquivo anterior divergente: '+key)
        return
    # CopySourceIfMatch fecha a janela entre HEAD e cópia; só objetos alterados
    # são arquivados. Não há uma segunda cópia de todos os microdados.
    client.copy_object(Bucket=bucket,Key=arquivo,CopySource={'Bucket':bucket,'Key':key},CopySourceIfMatch=head['ETag'],MetadataDirective='REPLACE',Metadata={**head.get('Metadata',{}),'origem_etag':tag},ContentType=head.get('ContentType','application/octet-stream'),CacheControl='public, max-age=31536000, immutable')
    salvo=client.head_object(Bucket=bucket,Key=arquivo)
    if salvo['ContentLength']!=head['ContentLength']or salvo.get('Metadata',{}).get('origem_etag')!=tag:raise ValueError('Falha na conferência do arquivo anterior: '+key)

def publicar_indice(client,bucket,m,inventario):
    base=versao_manifesto(m)
    arquivos={k:dict(bytes=v['bytes'],etag=v['etag'])for k,v in inventario.items()if k.startswith(('gold/','silver/'))and not k.startswith('gold/versoes/')and not HASH.search(k)}
    quantidades=[]
    for edicao in [base,base+'1']:
        if not re.fullmatch(r'\d{8,40}',edicao):raise ValueError('Versão inválida')
        key=f'gold/versoes/{edicao}.json'
        raw=json.dumps(dict(versao=1,edicao=edicao,arquivos=arquivos),sort_keys=True,separators=(',',':')).encode()
        try:obj=client.get_object(Bucket=bucket,Key=key)
        except Exception as e:
            if not inexistente(e):raise
        else:
            try:anterior=obj['Body'].read()
            finally:obj['Body'].close()
            if anterior!=raw:
                antigo=json.loads(anterior)
                # Artefatos novos podem ser preparados antes da ativação. Eles
                # não passam a integrar retroativamente a edição congelada.
                if antigo.get('versao')!=1 or antigo.get('edicao')!=edicao or not isinstance(antigo.get('arquivos'),dict)or any(arquivos.get(k)!=v for k,v in antigo['arquivos'].items()):
                    raise ValueError('Tentativa de reescrever uma versão congelada: '+edicao)
            quantidades.append(len(json.loads(anterior)['arquivos']))
            continue
        client.put_object(Bucket=bucket,Key=key,Body=raw,ContentType='application/json',CacheControl='public, max-age=31536000, immutable',Metadata={'sha256':hashlib.sha256(raw).hexdigest(),'md5':hashlib.md5(raw).hexdigest()},IfNoneMatch='*')
        quantidades.append(len(arquivos))
    return dict(versao=base,objetos=min(quantidades))
