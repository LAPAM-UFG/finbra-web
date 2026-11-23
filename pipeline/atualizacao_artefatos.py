"""Captura verificável de entradas publicadas e instalação de overlays isolados."""
import hashlib
import json
import os
import shutil
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import requests

PUBLICO='https://finbra-web.luanviniciusbernardelli.workers.dev/dados/'


def caminho_resolvido(path):
    """Resolve links e normaliza aliases do mesmo volume no Windows (\\\\?\\)."""
    resolved=Path(path).resolve()
    value=str(resolved)
    if os.name=='nt'and value.startswith('\\\\?\\'):
        value=value[4:]
        if value.startswith('UNC\\'):value='\\\\'+value[4:]
        resolved=Path(value)
    return resolved


def sha(path):
    with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def referencias(obj):
    if isinstance(obj,dict):
        if isinstance(obj.get('caminho'),str) and obj['caminho'].startswith(('gold/','silver/')) and isinstance(obj.get('bytes'),int) and obj.get('sha256'):
            yield obj
        for name,size,digest in [('arquivo','bytes','sha256'),('indice','indice_bytes','indice_sha256')]:
            key=obj.get(name)
            if isinstance(key,str) and key.startswith(('gold/','silver/')) and isinstance(obj.get(size),int) and obj.get(digest):
                yield dict(caminho=key,bytes=obj[size],sha256=obj[digest])
        for value in obj.values():
            if isinstance(value,(dict,list)):yield from referencias(value)
    elif isinstance(obj,list):
        for value in obj:
            if isinstance(value,(dict,list)):yield from referencias(value)


class Snapshot:
    def __init__(self,raiz,caches=(),url=PUBLICO,copiar_cache=True):
        self.raiz=caminho_resolvido(raiz);self.caches=list(map(Path,caches));self.url=url;self.proveniencia={};self.copiar_cache=copiar_cache

    def obter(self,chave,ref=None):
        key=Path(chave)
        if not key.parts or key.is_absolute() or '..' in key.parts or key.parts[0] not in ['gold','silver']:
            raise ValueError('chave de entrada inválida: '+chave)
        target=caminho_resolvido(self.raiz/key)
        if not target.is_relative_to(self.raiz):raise ValueError('entrada redirecionada: '+str(target)+' fora de '+str(self.raiz))
        if ref:
            expected=ref['sha256'];size=ref['bytes'];etag=None
        else:
            h=requests.head(self.url+chave,headers={'Accept-Encoding':'identity'},timeout=(20,90));h.raise_for_status();size=int(h.headers['Content-Length']);etag=h.headers.get('ETag');expected=None
        def valida(p):
            if not p.is_file() or p.stat().st_size!=size:return False
            if expected:return sha(p)==expected
            if etag and '-' not in etag:return '"'+hashlib.md5(p.read_bytes()).hexdigest()+'"'==etag
            return False
        for source in [target,*[root/key for root in self.caches]]:
            if valida(source):
                if source!=target:
                    if self.copiar_cache:target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
                    else:target=source
                break
        else:
            if target.exists():raise ValueError('snapshot mudou; use pasta nova: '+chave)
            target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.parte')
            # A compressão HTTP torna o ETag fraco no Cloudflare. Pedir os bytes
            # originais mantém HEAD, GET, tamanho e hash na mesma representação.
            with requests.get(self.url+chave,headers={'Accept-Encoding':'identity'},stream=True,timeout=(20,180)) as r:
                r.raise_for_status()
                if etag and r.headers.get('ETag')!=etag:raise ValueError('origem mudou durante captura: '+chave)
                with tmp.open('wb') as f:
                    for bloco in r.iter_content(1024*1024):f.write(bloco)
            if not valida(tmp):raise ValueError('conteúdo não confere: '+chave)
            os.replace(tmp,target)
        self.proveniencia[chave]=dict(local=str(target),bytes=size,sha256=expected or sha(target),**({'etag':etag} if etag else {}))
        return target

    def json(self,key,ref=None):return json.loads(self.obter(key,ref).read_bytes())

    def obter_r2(self,client,bucket,chave,ref):
        """Captura nomes mutáveis pelo ETag S3, inclusive uploads multipart."""
        key=Path(chave)
        if not key.parts or key.is_absolute() or '..' in key.parts or key.parts[0] not in ['gold','silver']:raise ValueError('chave de entrada inválida')
        target=caminho_resolvido(self.raiz/key)
        if not target.is_relative_to(self.raiz):raise ValueError('entrada redirecionada')
        head=client.head_object(Bucket=bucket,Key=chave)
        if head['ETag']!=ref['etag'] or head['ContentLength']!=ref['bytes']:raise ValueError('origem mudou: '+chave)
        meta=head.get('Metadata',{});expected=meta.get('md5') or (ref['etag'].strip('"') if '-' not in ref['etag'] else None)
        def valida(path):
            if not path.is_file() or path.stat().st_size!=ref['bytes']:return False
            if meta.get('sha256'):return sha(path)==meta['sha256']
            if expected:
                with path.open('rb') as stream:return hashlib.file_digest(stream,'md5').hexdigest()==expected
            return False
        for path in [target,*[p/key for p in self.caches]]:
            if valida(path):
                if path!=target:target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
                break
        else:
            if target.exists():raise ValueError('snapshot mudou; use pasta nova: '+chave)
            obj=client.get_object(Bucket=bucket,Key=chave,IfMatch=ref['etag'])
            if obj['ETag']!=ref['etag']:raise ValueError('origem mudou durante captura')
            target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.parte')
            with tmp.open('wb') as stream:
                body=obj['Body']
                try:
                    for block in iter(lambda:body.read(1024*1024),b''):stream.write(block)
                finally:body.close()
            if tmp.stat().st_size!=ref['bytes'] or (expected or meta.get('sha256')) and not valida(tmp):raise ValueError('conteúdo R2 divergente: '+chave)
            os.replace(tmp,target)
        self.proveniencia[chave]=dict(local=str(target),bytes=ref['bytes'],etag=ref['etag'],sha256=sha(target));return target

    def fixar_referencias(self,obj,recursivo=False):
        refs={r['caminho']:r for r in referencias(obj)}
        with ThreadPoolExecutor(max_workers=4) as pool:
            paths=list(pool.map(lambda r:self.obter(r['caminho'],r),refs.values()))
        if recursivo:
            for path in paths:
                if path.suffix=='.json':
                    child=json.loads(path.read_bytes())
                    pending=[r for r in referencias(child) if r['caminho'] not in self.proveniencia]
                    if pending:self.fixar_referencias(pending,True)
        return paths


def instalar_overlay(origem,destino,camadas=('gold','silver')):
    origem=Path(origem).resolve();destino=Path(destino).resolve()
    if origem==destino or origem.is_relative_to(destino) or destino.is_relative_to(origem):
        raise ValueError('overlay deve ser separado do destino')
    for camada in camadas:
        for path in (origem/camada).rglob('*'):
            if not path.is_file():continue
            target=destino/path.relative_to(origem)
            if not target.resolve().is_relative_to(destino):raise ValueError('destino redirecionado')
            target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
