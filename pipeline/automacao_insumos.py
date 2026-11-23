"""Cache privado no R2: nunca serve microdados pela rota pública /dados/."""
import hashlib
import json
import os
import shutil
from pathlib import Path, PurePosixPath

from atualizacao_artefatos import sha
from assistencia_utils import destino_isolado, salvar_json

PREFIXO = 'pipeline/automacao/'


def caminho_relativo(nome):
    key=PurePosixPath(nome)
    if not key.parts or key.is_absolute() or '..' in key.parts or '\\' in nome or ':' in nome:
        raise ValueError('Caminho de insumo inválido')
    return key.as_posix()


def referencia(path, raiz):
    path,raiz=Path(path).resolve(),Path(raiz).resolve()
    if not path.is_relative_to(raiz):raise ValueError('Insumo fora da pasta da rotina')
    nome=caminho_relativo(path.relative_to(raiz).as_posix())
    return dict(nome=nome, bytes=path.stat().st_size, sha256=sha(path))


class Insumos:
    def __init__(self,client,bucket,rotina,raiz,caches=()):
        if not rotina or any(c not in 'abcdefghijklmnopqrstuvwxyz_0123456789' for c in rotina):raise ValueError('Rotina inválida')
        self.client,self.bucket,self.rotina=client,bucket,rotina
        self.raiz=destino_isolado(Path(raiz));self.caches=list(map(Path,caches))
        self.chave=PREFIXO+'estados/'+rotina+'.json';self.etag=None;self.estado=None

    def ler(self):
        try:r=self.client.get_object(Bucket=self.bucket,Key=self.chave)
        except Exception as e:
            if getattr(e,'response',{}).get('Error',{}).get('Code') not in ['404','NoSuchKey','NotFound']:raise
            return None
        try:self.estado=json.loads(r['Body'].read())
        finally:r['Body'].close()
        self.etag=r['ETag']
        if self.estado.get('rotina')!=self.rotina:raise ValueError('Estado de outra rotina')
        return self.estado

    def obter(self,ref):
        nome=caminho_relativo(ref['nome']);target=(self.raiz/nome).resolve()
        if not target.is_relative_to(self.raiz):raise ValueError('Insumo redirecionado')
        key=PREFIXO+'objetos/'+ref['sha256']
        def valido(p):return p.is_file() and p.stat().st_size==ref['bytes'] and sha(p)==ref['sha256']
        for source in [target,*[p/nome for p in self.caches]]:
            if valido(source):
                if source!=target:target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
                return target
        target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.parte')
        obj=self.client.get_object(Bucket=self.bucket,Key=key)
        try:
            with tmp.open('wb') as f:
                for b in iter(lambda:obj['Body'].read(1024*1024),b''):f.write(b)
        finally:obj['Body'].close()
        if not valido(tmp):raise ValueError('Insumo privado corrompido: '+nome)
        os.replace(tmp,target);return target

    def restaurar(self):
        state=self.estado if self.estado is not None else self.ler()
        if state:
            for ref in state['arquivos']:self.obter(ref)
        return state

    def preparar(self,arquivos,assinatura,manifestos):
        refs=[referencia(p,self.raiz) for p in arquivos]
        return dict(versao=1,rotina=self.rotina,assinatura=assinatura,manifestos=manifestos,arquivos=refs)

    def enviar(self,state):
        """Chamar só depois da validação, antes de ativar os dados públicos."""
        from publicacao_lote import enviar,hashes
        for ref in state['arquivos']:
            path=self.raiz/ref['nome'];key=PREFIXO+'objetos/'+ref['sha256']
            current=hashes(path)
            if path.stat().st_size!=ref['bytes']or current['sha256']!=ref['sha256']:raise ValueError('Insumo mudou depois da validação')
            if ref['bytes']>=5_000_000_000:raise ValueError('Insumo acima do limite de envio; dividir a fonte antes de publicar')
            try:head=self.client.head_object(Bucket=self.bucket,Key=key)
            except Exception as e:
                if getattr(e,'response',{}).get('Error',{}).get('Code') not in ['404','NoSuchKey','NotFound']:raise
                enviar(self.client,self.bucket,key,dict(local=str(path),bytes=ref['bytes'],**current),{'IfNoneMatch':'*'})
            else:
                if head['ContentLength']!=ref['bytes'] or head.get('Metadata',{}).get('sha256')!=ref['sha256']:raise ValueError('Colisão de insumo privado')

    def confirmar(self,state):
        """Chamar depois da ativação: falha aqui provoca repetição, nunca perda de dados."""
        raw=json.dumps(state,ensure_ascii=False,separators=(',',':')).encode()
        cond={'IfMatch':self.etag} if self.etag else {'IfNoneMatch':'*'}
        self.client.put_object(Bucket=self.bucket,Key=self.chave,Body=raw,ContentType='application/json',CacheControl='no-store',**cond)
        salvar_json(self.raiz/'estado_confirmado.json',state)
