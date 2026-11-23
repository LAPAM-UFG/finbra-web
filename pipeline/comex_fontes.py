"""Fontes oficiais do Comex Stat e bases publicadas, fixadas por SHA-256."""
import argparse,hashlib,json,re,shutil,subprocess,os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from datetime import datetime,timezone
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from energia_fontes import validar_pastas

PAGINA='https://www.gov.br/mdic/pt-br/assuntos/comercio-exterior/estatisticas/base-de-dados-bruta'
ORIGEM='https://balanca.mdic.gov.br/balanca/bd/'
SITE='https://finbra-web.luanviniciusbernardelli.workers.dev/dados/'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def salvar(p,v):Path(p).write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf-8')
def sessao():
 s=requests.Session();s.mount('https://',HTTPAdapter(max_retries=Retry(total=3,connect=3,read=1,backoff_factor=1)));return s

def baixar(root,name,url):
 p=root/name;ref=p.with_name(p.name+'.fonte.json')
 if p.exists():
  m=json.loads(ref.read_bytes());assert m['url']==url and m['sha256']==sha(p)and m['bytes']==p.stat().st_size;return m
 temp=p.with_name(p.name+'.parcial')
 if url.startswith(ORIGEM):
  # O curl nativo do Windows usa a cadeia de certificados do sistema, sem
  # desabilitar TLS, inclusive quando o servidor não envia os intermediários.
  headers=root/(name+'.headers.txt')
  def hs():
   blocks=re.split(r'\r?\n\r?\n',headers.read_text(encoding='utf-8'));block=[x for x in blocks if x.startswith('HTTP/')][-1];return{a.strip().lower():b.strip()for line in block.splitlines()[1:]if ':'in line for a,b in[line.split(':',1)]}
  offset=temp.stat().st_size if temp.exists()else 0;old=hs()if offset else{};assert not offset or old.get('etag'),'Retomada exige ETag da primeira resposta'
  cmd=[shutil.which('curl.exe'if os.name=='nt'else'curl'),'--fail','--location','--silent','--show-error','--connect-timeout','25','--max-time','600','--retry','8','--retry-all-errors','--retry-delay','2','--header','Accept-Encoding: identity',*(['--continue-at','-','--header','If-Range: '+old['etag']]if offset else[]),'--dump-header',str(headers),'--output',str(temp),'--write-out','%{http_code}\n%{url_effective}\n%{size_download}',url]
  result=subprocess.run(cmd,capture_output=True,text=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt'else 0)
  if result.returncode:raise RuntimeError('Falha ao adquirir '+name+': '+result.stderr[-1200:])
  status,final,size=result.stdout.strip().splitlines();assert status==('206'if offset else'200')and final.startswith(ORIGEM)and int(float(size))+offset==temp.stat().st_size
  h=hs()
  if offset:assert h.get('etag')==old['etag']and int(h['content-range'].split('/')[-1])==temp.stat().st_size,'Fonte alterada durante a retomada'
  else:assert not h.get('content-length')or int(h['content-length'])==temp.stat().st_size
  m=dict(arquivo=name,url=url,url_final=final,bytes=temp.stat().st_size,sha256=sha(temp),adquirido_em=datetime.now(timezone.utc).isoformat(),etag=h.get('etag'),last_modified=h.get('last-modified'),TLS_verificado=True);temp.rename(p);salvar(ref,m);print(json.dumps(dict(adquirido=name,bytes=m['bytes'])),flush=True);return m
 assert not temp.exists(),'Aquisição parcial: confira a pasta antes de repetir'
 with sessao()as s,s.get(url,stream=True,headers={'Accept-Encoding':'identity'},timeout=(25,180))as r:
  r.raise_for_status()
  with temp.open('xb')as f:
   for b in r.iter_content(1024*1024):f.write(b)
  assert r.headers.get('Content-Encoding')or not r.headers.get('Content-Length')or int(r.headers['Content-Length'])==temp.stat().st_size
  m=dict(arquivo=name,url=url,url_final=r.url,bytes=temp.stat().st_size,sha256=sha(temp),adquirido_em=datetime.now(timezone.utc).isoformat(),etag=r.headers.get('ETag'),last_modified=r.headers.get('Last-Modified'));temp.rename(p);salvar(ref,m)
 print(json.dumps(dict(adquirido=name,bytes=m['bytes'])),flush=True);return m

def adquirir(root):
 root=Path(root);root.mkdir(parents=True,exist_ok=True);baixar(root,'pagina_mdic.html',PAGINA)
 page=(root/'pagina_mdic.html').read_text(encoding='utf-8');match=re.search(r'janeiro\s*[-–]\s*(\w+)\s+de\s+(\d{4})',page,re.I);assert match,'Cobertura oficial não identificada'
 meses=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];mes=meses.index(match[1].lower())+1;ano=int(match[2]);assert 2013<=ano<=datetime.now(timezone.utc).year
 jobs=[(x,ORIGEM+'tabelas/'+x)for x in ['UF_MUN.csv','PAIS.csv','NCM_SH.csv']]
 jobs += [(f'{f}_TOTAIS_CONFERENCIA_MUN.csv',ORIGEM+f'comexstat-bd/mun/{f}_TOTAIS_CONFERENCIA_MUN.csv')for f in ['EXP','IMP']]
 jobs += [(f'{f}_{y}_MUN.csv',ORIGEM+f'comexstat-bd/mun/{f}_{y}_MUN.csv')for y in reversed(range(2013,ano+1))for f in ['EXP','IMP']]
 for _,url in jobs:assert url in page,url
 with ThreadPoolExecutor(max_workers=2)as e:refs=list(e.map(lambda x:baixar(root,*x),jobs))
 updated=baixar(root,'atualizacao_api.json','https://api-comexstat.mdic.gov.br/cities/dates/updated');u=json.loads((root/'atualizacao_api.json').read_bytes());assert u['success']and int(u['data']['year'])==ano and int(u['data']['monthNumber'])==mes;refs.append(updated)
 salvar(root/'fontes_comex.json',dict(ok=True,ano=ano,mes=mes,periodos={str(y):(mes if y==ano else 12)for y in range(2013,ano+1)},arquivos=refs,pagina_sha256=sha(root/'pagina_mdic.html')))

def fixar(root,caches):
 root=Path(root);caches=list(map(Path,caches));refs=[]
 def get(key,ref=None):
  p=root/key;p.parent.mkdir(parents=True,exist_ok=True)
  if not p.exists():
   old=next((c/key for c in caches if ref and(c/key).is_file()and(c/key).stat().st_size==ref['bytes']and sha(c/key)==ref['sha256']),None)
   if old:shutil.copy2(old,p)
   else:
    with sessao()as s:r=s.get(SITE+key,headers={'Cache-Control':'no-cache'},timeout=(20,180));r.raise_for_status();p.write_bytes(r.content)
  if ref:assert p.stat().st_size==ref['bytes']and sha(p)==ref['sha256']
  return dict(chave=key,bytes=p.stat().st_size,sha256=sha(p))
 keys=['gold/manifesto.json','gold/downloads/manifesto.json','gold/comparacoes/manifesto.json','gold/raiox/v10_manifesto.json',*['gold/'+x+'/manifesto.json'for x in ['energia','internet','mobilidade','seguranca']]]
 with ThreadPoolExecutor(max_workers=3)as e:refs=list(e.map(get,keys))
 dl=json.loads((root/keys[1]).read_bytes());cp=json.loads((root/keys[2]).read_bytes());main=next(x for x in dl['arquivos']if x['id']=='painel_brasil_parquet')
 with ThreadPoolExecutor(max_workers=3)as e:refs+=list(e.map(lambda x:get(x['caminho'],x),[dl['dicionario'],*dl['recortes_uf'].values(),cp['geografia'],main]))
 shutil.copy2(root/cp['geografia']['caminho'],root/'geografia.json')
 p=root/'populacao_2026_sidra.json'
 if not p.exists():
  cached=next((c/p.name for c in caches if(c/p.name).is_file()),None)
  if cached:shutil.copy2(cached,p)
  else:
   with sessao()as s:r=s.get('https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/2026',timeout=(20,180));r.raise_for_status();salvar(p,r.json())
 rows=json.loads(p.read_bytes());assert len(rows)==5572 and all(x['D3C']=='2026'for x in rows[1:]);salvar(root/'base_publicada.json',dict(ok=True,arquivos=refs,populacao_2026_sha256=sha(p)))

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True,type=Path);p.add_argument('--cache',action='append',default=[]);a=p.parse_args();validar_pastas(a.fontes,a.cache);adquirir(a.fontes);fixar(a.fontes,a.cache)
