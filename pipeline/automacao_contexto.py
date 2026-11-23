"""Execução isolada, entradas fixadas e revalidação das versões oficiais."""
import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import re
from urllib.parse import urlparse
from pathlib import Path

from atualizacao_artefatos import Snapshot,referencias,sha,instalar_overlay
from atualizacao_fontes import HTTP,baixar
from assistencia_utils import destino_isolado,salvar_json
from automacao_insumos import Insumos

REPO=Path(__file__).resolve().parent.parent


def assinatura(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()


def versao_http(url):
    if urlparse(url).hostname=='balanca.mdic.gov.br':
        # Usa a mesma pilha TLS do coletor MDIC (sem desativar certificados).
        result=subprocess.run([shutil.which('curl.exe'if os.name=='nt'else'curl'),'--fail','--head','--location','--silent','--show-error','--connect-timeout','20','--max-time','90','--header','Accept-Encoding: identity',url],capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt'else 0)
        if result.returncode:raise RuntimeError('Falha na conferência TLS/HTTP do MDIC: '+result.stderr[-500:])
        blocks=[b for b in re.split(r'\r?\n\r?\n',result.stdout.strip())if b.startswith('HTTP/')]
        if not blocks or blocks[-1].splitlines()[0].split()[1]!='200':raise ValueError('Resposta HEAD inesperada do MDIC')
        headers={k.strip().lower():v.strip()for line in blocks[-1].splitlines()[1:]if ':'in line for k,v in [line.split(':',1)]}
        return dict(url=url,etag=headers.get('etag'),last_modified=headers.get('last-modified'),bytes=int(headers['content-length'])if headers.get('content-length')else None)
    r=HTTP.head(url,headers={'Accept-Encoding':'identity'},allow_redirects=True,timeout=(20,90))
    r.raise_for_status()
    etag=r.headers.get('ETag');modified=r.headers.get('Last-Modified');size=r.headers.get('Content-Length')
    if not etag and not (modified and size):return None
    return dict(url=url,etag=etag,last_modified=modified,bytes=int(size)if size else None)


class Contexto:
    def __init__(self,rotina,base,snapshot,raiz,client,bucket,caches=()):
        self.rotina=rotina;self.base=Path(base).resolve();self.raiz=destino_isolado(Path(raiz),self.base)
        self.raiz.mkdir(parents=True,exist_ok=True);self.fontes=self.raiz/'fontes';self.fontes.mkdir(exist_ok=True)
        self.snapshot=snapshot;self.caches=list(caches);self.cache=Insumos(client,bucket,rotina.id,self.fontes)
        self.anterior=self.cache.restaurar();self.versoes={};self.pins={}
        self.resolver=Snapshot(self.raiz/'cache',[self.base,snapshot.raiz,*snapshot.caches,*caches],copiar_cache=False)
        self.resultado=None

    def ref(self,ref):
        p=self.resolver.obter(ref['caminho'],ref);target=self.fontes/ref['caminho']
        if p.resolve()!=target.resolve():target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
        self.pins[ref['caminho']]=dict(local=str(target),bytes=ref['bytes'],sha256=ref['sha256'])
        return target

    def raiz_fonte(self,key):
        p=self.base/key
        if not p.exists():p=self.resolver.obter(key)
        return self.ref(dict(caminho=key,bytes=p.stat().st_size,sha256=sha(p)))

    def grafo(self,meta):
        seen=set();pending=list(referencias(meta))
        while pending:
            ref=pending.pop();key=ref['caminho']
            if key in seen:continue
            seen.add(key);p=self.ref(ref)
            if key.endswith('.json'):pending.extend(referencias(json.loads(p.read_bytes())))

    def preparar_painel(self,area=None):
        for key in ['gold/manifesto.json','gold/downloads/manifesto.json','gold/comparacoes/manifesto.json']:
            self.raiz_fonte(key)
        downloads=json.loads((self.fontes/'gold/downloads/manifesto.json').read_bytes())
        for ref in [downloads['dicionario'],next(a for a in downloads['arquivos']if a['id']=='painel_brasil_parquet')]:self.ref(ref)
        for ref in downloads['recortes_uf'].values():self.ref(ref)
        cmp=json.loads((self.fontes/'gold/comparacoes/manifesto.json').read_bytes())
        shutil.copy2(self.ref(cmp['geografia']),self.fontes/'geografia.json')
        for name in [area] if area else []:
            key=f'gold/{name}/manifesto.json'
            if (self.base/key).exists():self.raiz_fonte(key)
        salvar_json(self.fontes/'base_publicada.json',dict(ok=True,arquivos=self.pins))
        return downloads

    def populacao(self):
        m=json.loads((self.base/'gold/manifesto.json').read_bytes());year=max(m['fontes']['ibge_populacao']['anos'])
        # Nome legado é mantido para os leitores existentes; o ano vem de D3C.
        p=self.fontes/'populacao_2026_sidra.json'
        baixar(f'https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/{year}',p)
        data=json.loads(p.read_bytes())
        if len(data)<2 or {int(x['D3C'])for x in data[1:]}!={year}:raise ValueError('Ano da população oficial divergente')
        return year

    def executar(self,script,*args,data_dir=None,env=None):
        taskenv={**os.environ,'PYTHONIOENCODING':'utf-8','PYTHONUNBUFFERED':'1','DATA_DIR':str(data_dir or self.base),**(env or {})}
        print('Executando '+script+' · '+self.rotina.id,flush=True)
        subprocess.run([sys.executable,str(REPO/'pipeline'/script),*map(str,args)],cwd=REPO,env=taskenv,check=True)

    def obter_oficial(self,url,nome):
        """GET condicional: um 304 só é aceito com a cópia e o hash conferidos."""
        from automacao_insumos import caminho_relativo
        key=caminho_relativo(nome);target=self.fontes/key
        if urlparse(url).scheme!='https':raise ValueError('Fonte HTTP deve usar TLS')
        meta=target.with_name(target.name+'.oficial.json')
        old=json.loads(meta.read_bytes()) if meta.exists() else {}
        valid=target.is_file()and target.stat().st_size==old.get('bytes')and sha(target)==old.get('sha256')
        headers={'Accept-Encoding':'identity'}
        if valid and old.get('url')==url:
            if old.get('etag'):headers['If-None-Match']=old['etag']
            elif old.get('last_modified'):headers['If-Modified-Since']=old['last_modified']
        with HTTP.get(url,headers=headers,stream=True,timeout=(30,180))as r:
            if r.status_code==304:
                if not valid:raise ValueError('304 sem cópia íntegra')
                return old
            r.raise_for_status();target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.parte')
            with tmp.open('wb')as f:
                for chunk in r.iter_content(1024*1024):f.write(chunk)
            if not r.headers.get('Content-Encoding') and r.headers.get('Content-Length')and tmp.stat().st_size!=int(r.headers['Content-Length']):raise ValueError('Fonte truncada')
            ref=dict(url=url,arquivo=key,bytes=tmp.stat().st_size,sha256=sha(tmp),etag=r.headers.get('ETag'),last_modified=r.headers.get('Last-Modified'))
            os.replace(tmp,target);salvar_json(meta,ref);return ref

    def arquivos_cache(self):
        # Nunca armazena gold, cadastro de pessoas nem os microdados de Saúde.
        # A executora fornece explicitamente a lista permitida de insumos.
        return [p for p in self.fontes.rglob('*')if p.is_file()and p.suffix not in ['.parte','.parcial']and not p.relative_to(self.fontes).parts[0]in ['gold','silver','micro','brutos']]

    def excluir_copia(self,path):
        path=Path(path).resolve()
        if not path.is_relative_to(self.fontes.resolve()):raise ValueError('Só pode invalidar cópias da rotina')
        path.unlink(missing_ok=True)

    def descartar_temporario(self,path):
        path=Path(path).resolve()
        if path==self.raiz.resolve()or not path.is_relative_to(self.raiz.resolve())or path==self.fontes.resolve():raise ValueError('Temporário fora da pasta da rotina')
        if path.is_dir():shutil.rmtree(path)
        else:path.unlink(missing_ok=True)

    def revalidar(self,metadados):
        """Invalida a cópia restaurada se o servidor anunciar outra versão."""
        previous=(self.anterior or {}).get('versoes',{})
        for meta in metadados:
            meta=Path(meta)
            if not meta.exists():continue
            d=json.loads(meta.read_bytes())
            if not isinstance(d,dict)or not d.get('url'):continue
            url=d['url'];version=versao_http(url);self.versoes[url]=version
            legacy=dict(url=url,etag=d.get('etag'),last_modified=d.get('last_modified'),bytes=d.get('bytes'))
            known=previous.get(url,legacy)
            if version is not None and known==version:continue
            name=d.get('arquivo')
            source=self.fontes/name if name else meta.with_name(meta.name.removesuffix('.fonte.json').removesuffix('.json'))
            if source.exists()and source!=meta:self.excluir_copia(source)
            self.excluir_copia(meta)

    def mudou(self,fatos,vinculos=None,codigo=()):
        m=json.loads((self.base/'gold/manifesto.json').read_bytes())
        bindings=vinculos or {f:m['fontes'].get(f)for f in self.rotina.fontes if f in m['fontes']}
        for area in self.rotina.areas:
            key=f'gold/{area}/manifesto.json'
            if (self.base/key).is_file():bindings[key]=sha(self.base/key)
        if set(self.rotina.areas)&{'internet','energia','comex'}:
            bindings['$principal']=next(r['sha256']for r in json.loads((self.base/'gold/downloads/manifesto.json').read_bytes())['arquivos']if r['id']=='painel_brasil_parquet')
        if set(self.rotina.areas)&{'mobilidade','seguranca'}:bindings['gold/saude/populacao.parquet']=sha(self.base/'gold/saude/populacao.parquet')
        modules=set(codigo)|{p.name for p in(REPO/'pipeline').glob('automacao_*.py')}|{'automatizar_demais_bases.py','downloads_incremental.py','painel_municipal.py','atualizacao_derivados.py'}
        code={str(x):sha(REPO/'pipeline'/x)for x in sorted(modules)}
        self.assinatura=assinatura(dict(fatos=fatos,codigo=code))
        self.bindings=bindings
        return not self.anterior or self.anterior['assinatura']!=self.assinatura or self.anterior.get('manifestos')!=bindings

    def estado(self,arquivos):
        m=json.loads((self.base/'gold/manifesto.json').read_bytes())
        def atual(k):
            if k=='$principal':return next(r['sha256']for r in json.loads((self.base/'gold/downloads/manifesto.json').read_bytes())['arquivos']if r['id']=='painel_brasil_parquet')
            return sha(self.base/k)if k.startswith('gold/')else m['fontes'].get(k)
        bindings={k:atual(k)for k in self.bindings}
        state=self.cache.preparar(arquivos,self.assinatura,bindings)
        state['versoes']=self.versoes
        if hasattr(self,'fatos'):state['fatos']=self.fatos
        return state

    def aplicar(self,saida,chaves_fontes=()):
        p=Path(saida)/'gold/manifesto.json'
        manifest=json.loads((self.base/'gold/manifesto.json').read_bytes())
        if p.exists():
            new=json.loads(p.read_bytes())
            if manifest['base_ipca']!=new['base_ipca']:raise ValueError('Uma rotina parcial não pode mudar a base de preços')
            for key in chaves_fontes:manifest['fontes'][key]=new['fontes'][key]
        instalar_overlay(Path(saida),self.base)
        salvar_json(self.base/'gold/manifesto.json',manifest)
