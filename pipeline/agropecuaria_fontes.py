"""Aquisição reproduzível da PAM/PPM no SIDRA, com cache e sem escrita no gold.

Os lotes ficam abaixo de 60 mil valores. Respostas incompletas não são aceitas.
O cache conserva os bytes oficiais, URL, data e SHA-256 para permitir auditoria.
"""
import argparse, gzip, hashlib, json, math, shutil, time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import requests

API = 'https://servicodados.ibge.gov.br/api/v3/agregados/'
TABELAS = {'5457': ('782', ['8331','216','214','112','215']),
           '3939': ('79', ['105']), '74': ('80', ['106','215']),
           '94': (None, ['107']), '3940': ('654', ['4146','215']),
           '95': (None, ['108']), '289': ('193', ['144','145']),
           '291': ('194', ['142','143']), '5930': ('734', ['6549'])}
ANOS = list(range(2013, 2026))

def compacto(x): return json.dumps(x,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
def sha(b): return hashlib.sha256(b).hexdigest()

def adquirir(saida, geografia, workers=6,anos=None):
    saida=Path(saida).resolve(); geo=Path(geografia).resolve()
    if saida==geo or geo.is_relative_to(saida/'sidra'): raise ValueError('Destino sobreposto à origem')
    raw=saida/'sidra';raw.mkdir(parents=True,exist_ok=True)
    session=requests.Session();session.headers['User-Agent']='Finbra-LAPAM/1.0 (dados agregados publicos)'
    metas={}
    for tab in TABELAS:
        p=saida/f'metadados_{tab}.json'
        if not p.exists():
            r=session.get(API+tab+'/metadados',timeout=90);r.raise_for_status();p.write_bytes(r.content)
        metas[tab]=json.loads(p.read_bytes())
    ANOS[:]=list(anos) if anos is not None else list(range(2013,min(int(m['periodicidade']['fim']) for m in metas.values())+1))
    if ANOS!=list(range(2013,max(ANOS)+1)):raise ValueError('A série agropecuária deve começar em 2013, sem lacunas')
    for tab in TABELAS:
        if not set(ANOS).issubset(set(range(int(metas[tab]['periodicidade']['inicio']),int(metas[tab]['periodicidade']['fim'])+1))):raise ValueError('Período mudou: '+tab)
        units=saida/f'unidades_{tab}.json';cl=TABELAS[tab][0]
        if not units.exists():
            url='https://apisidra.ibge.gov.br/values/t/'+tab+'/n1/all/p/'+str(ANOS[-1])+'/v/all'+('/c'+cl+'/all'if cl else'')
            r=session.get(url,timeout=90);r.raise_for_status();units.write_bytes(r.content)
    g=json.loads(geo.read_bytes());counts={}
    for m in g['municipios']:counts[m[2]]=counts.get(m[2],0)+1
    ufcode={u:code.removeprefix('E:') for code,_,u in g['governos']}
    jobs=[]
    for tab,(cl,vs) in TABELAS.items():
        cats=[str(c['id']) for c in metas[tab]['classificacoes'][0]['categorias']] if cl else ['0']
        for uf in [*sorted(counts),'referencias']:
            n=counts.get(uf,28);step=max(1,60000//(n*len(ANOS)*len(vs)))
            for start in range(0,len(cats),step):
                selected=cats[start:start+step]
                params={'localidades':f'N6[N3[{ufcode[uf]}]]' if uf!='referencias' else 'N3[all]|N1[1]'}
                if cl:params['classificacao']=cl+'['+','.join(selected)+']'
                url=API+tab+'/periodos/2013-'+str(ANOS[-1])+'/variaveis/'+'|'.join(vs)
                jobs.append((tab,uf,selected,vs,url,params))
    def buscar(job):
        tab,uf,cats,vs,url,params=job
        identity=sha(compacto([url,params]));p=raw/f'{tab}_{uf.lower()}_{identity[:16]}.json.gz';meta=p.with_suffix('.meta.json')
        if p.exists() and meta.exists():
            descriptor=json.loads(meta.read_bytes());body=gzip.decompress(p.read_bytes())
            assert descriptor['sha256']==sha(body)
            return descriptor
        for attempt in range(6):
            try:
                r=requests.get(url,params=params,timeout=150,headers={'User-Agent':'Finbra-LAPAM/1.0'})
                r.raise_for_status();data=r.json()
                # A API devolve [] quando não há registro do tema na UF (ex.:
                # silvicultura no AC). Isso é ausência, nunca produção zero.
                if not isinstance(data,list) or data and {str(v['id']) for v in data}!=set(vs):raise ValueError('Variáveis incompletas')
                for v in data:
                    if len(v['resultados'])!=len(cats):raise ValueError('Produtos incompletos')
                    for result in v['resultados']:
                        ids=[s['localidade']['id'] for s in result['series']]
                        if len(ids)!=len(set(ids)) or not ids:raise ValueError('Localidades inválidas')
                        for s in result['series']:
                            if set(s['serie'])!=set(map(str,ANOS)):raise ValueError('Anos incompletos')
                body=r.content
                descriptor=dict(tabela=tab,uf=uf,categorias=cats,variaveis=vs,url=r.url,
                    arquivo=p.relative_to(saida).as_posix(),bytes=len(body),sha256=sha(body),
                    obtido_em=datetime.now(timezone.utc).isoformat(),sem_registros=not data)
                temp=p.with_suffix('.tmp');temp.write_bytes(gzip.compress(body,compresslevel=3,mtime=0));temp.replace(p)
                meta.write_bytes(compacto(descriptor));return descriptor
            except (requests.RequestException,ValueError,AssertionError):
                if attempt==5:raise
                time.sleep(min(30,2**attempt))
    results=[];start=time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for task in as_completed([pool.submit(buscar,j) for j in jobs]):
            results.append(task.result())
            if len(results)%25==0: print(json.dumps(dict(lotes=len(results),total=len(jobs),segundos=round(time.monotonic()-start))),flush=True)
    results.sort(key=lambda x:(x['tabela'],x['uf'],x['categorias']))
    out=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=ANOS,
             geografia_sha256=sha(geo.read_bytes()),lotes=results)
    (saida/'fontes.json').write_bytes(compacto(out));print(json.dumps(dict(ok=True,lotes=len(results),bytes=sum(x['bytes'] for x in results))),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',required=True,type=Path);p.add_argument('--geografia',required=True,type=Path);p.add_argument('--workers',type=int,default=6)
    a=p.parse_args();adquirir(a.saida,a.geografia,a.workers)
