"""Mantém os dicionários dos pacotes nacionais iguais ao catálogo/API ativo."""
import json
import shutil
import zipfile
from pathlib import Path
from atualizacao_artefatos import Snapshot,instalar_overlay
from assistencia_utils import salvar_json
from downloads_navegacao import pacote,registrar


def atualizar(base,snap,root):
    meta=json.loads((base/'gold/downloads/manifesto.json').read_bytes());resolver=Snapshot(root/'cache',[base,snap.raiz,*snap.caches])
    for ref in meta['arquivos']:
        if(ref['tipo']=='painel'and ref.get('uf')is None)or ref['tipo']in ('dicionario','metodologia'):
            src=resolver.obter(ref['caminho'],ref);dest=base/ref['caminho'];dest.parent.mkdir(parents=True,exist_ok=True)
            if src.resolve()!=dest.resolve():shutil.copy2(src,dest)
    work=root/'trabalho';work.mkdir(parents=True);saida=root/'pacotes'
    for fmt in ('parquet','csv.zip','dta','rds'):
        new=pacote(base,work,meta,fmt);meta['arquivos']=[a for a in meta['arquivos']if a['id']!=new['id']]+[new]
    old=next((a for a in meta['arquivos']if a['id']=='pacote_enxuto'),None)
    if old:
        archive=work/'base_enxuta_completa.zip'
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True)as z:
            for a in meta['arquivos']:
                if not((a['tipo']=='painel'and a.get('uf')is None)or(a['tipo']=='dicionario'and a.get('escopo')=='principal'and a['formato']in ['csv.zip','xlsx'])or a['tipo']=='metodologia'):continue
                source=base/a['caminho']
                if a['formato']=='csv.zip':
                    with zipfile.ZipFile(source)as src:
                        for name in src.namelist():
                            with src.open(name)as inp,z.open(name,'w',force_zip64=True)as out:shutil.copyfileobj(inp,out,8*1024*1024)
                else:z.write(source,a['id']+'.'+a['formato'])
        new={**old,**registrar(base,archive,'pacote_enxuto','zip')}
        with zipfile.ZipFile(archive)as z:new['bytes_extraido']=sum(i.file_size for i in z.infolist())
        meta['arquivos']=[new if a['id']=='pacote_enxuto'else a for a in meta['arquivos']]
    salvar_json(base/'gold/downloads/manifesto.json',meta)
