"""Aquisição reexecutável de dados públicos. Arquivos individuais ficam só na landing local."""
import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import threading
import time
import zipfile
from pathlib import Path
import requests
from assistencia_utils import destino_isolado, salvar_json

IPCA='https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/all?formato=json'
PORTAL='https://portaldatransparencia.gov.br/download-de-dados/'

def competencias(conjunto):
    r=requests.get(PORTAL+conjunto,timeout=60);r.raise_for_status()
    items=[json.loads(x) for x in re.findall(r'arquivos\.push\((\{[^\n]+?\})\)',r.text)]
    meses=sorted({int(i['ano']+i['mes']) for i in items if i.get('mes')})
    if not meses:raise ValueError('Catálogo oficial sem competências: '+conjunto)
    return meses

def download_meses(saida,conjunto,meses=None):
    root=destino_isolado(saida);dest=root/'landing/assistencia'/conjunto;dest.mkdir(parents=True,exist_ok=True)
    available=competencias(conjunto)
    selected=[m for m in available if meses is None or m in meses]
    state_path=dest/'downloads.json';state=json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else {}
    salvar_json(dest/'competencias.json',{'url':PORTAL+conjunto,'competencias':available})
    lock=threading.Lock()
    def one(month):
        key=str(month);name=f'{month}_{"BPC" if conjunto=="bpc" else "NovoBolsaFamilia"}.zip'
        final=dest/name;partial=final.with_suffix('.zip.parcial');old=state.get(key)
        if old and final.exists() and final.stat().st_size==old['bytes'] and zipfile.is_zipfile(final):return month
        url=PORTAL+conjunto+'/'+key
        for attempt in range(4):
            try:
                digest=hashlib.sha256();size=0
                with requests.get(url,stream=True,timeout=(20,120)) as r:
                    r.raise_for_status();expected=int(r.headers.get('Content-Length','0'))
                    with partial.open('wb') as f:
                        for block in r.iter_content(2**20):
                            if block:f.write(block);digest.update(block);size+=len(block)
                    if expected and expected!=size:raise ValueError('Download incompleto')
                    if not zipfile.is_zipfile(partial):raise ValueError('Resposta não é ZIP')
                    with zipfile.ZipFile(partial) as z:
                        if len([i for i in z.infolist() if i.filename.lower().endswith('.csv')])!=1:raise ValueError('Esperado um CSV')
                    os.replace(partial,final)
                    with lock:
                        state[key]={'url':url,'url_final':r.url,'bytes':size,'sha256':digest.hexdigest(),'etag':r.headers.get('ETag'),
                                    'baixado_em':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
                        salvar_json(state_path,state)
                    print(json.dumps({'conjunto':conjunto,'mes':month,'bytes':size}),flush=True)
                    return month
            except Exception:
                if attempt==3:raise
                time.sleep(2*(attempt+1))
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(one,reversed(selected)))
    return selected

def ipca(saida):
    root=destino_isolado(saida);dest=root/'landing/assistencia';dest.mkdir(parents=True,exist_ok=True)
    r=requests.get(IPCA,timeout=90);r.raise_for_status();data=r.json()
    assert len(data)>500 and all(x['D2C']=='2266' and x['D1C']=='1' for x in data[1:])
    salvar_json(dest/'ipca_mensal.json',data)
    salvar_json(dest/'ipca_mensal_fonte.json',{'url':IPCA,'sha256':hashlib.sha256(r.content).hexdigest(),
                                            'baixado_em':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())})
    return data

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',type=Path,required=True)
    p.add_argument('--bpc',action='store_true');p.add_argument('--ipca',action='store_true');p.add_argument('--mes',type=int,nargs='+')
    a=p.parse_args()
    if a.bpc:download_meses(a.saida,'bpc',a.mes)
    if a.ipca:ipca(a.saida)
