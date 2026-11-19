"""Cache auditável dos retratos de dezembro por espécie/eixos da Senatran."""
import argparse,html,json,re,time
from concurrent.futures import ThreadPoolExecutor,as_completed
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urljoin,urlparse,unquote
import requests
from mobilidade_fontes import ANOS,BASE,Links,norm,sha,compacto

def descobrir_especie(body,url,ano):
 p=Links();p.feed(body)
 for link in p.out:
  label=norm(link['text'])
  if 'munic'in label and 'especie'in label and 'eixo'in label:
   months=re.findall(r'\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b',norm(link['context']))
   if not months or months[-1]!='dezembro':continue
   return dict(ano=ano,pagina=url,url=urljoin(url,html.unescape(link['href'])),rotulo=link['text'],contexto=link['context'])
 return None

def adquirir(fontes):
 fontes=Path(fontes).resolve();dest=fontes/'senatran_perfis';dest.mkdir(exist_ok=True);jobs=[];ausentes=[]
 for y in ANOS:
  page=fontes/'senatran'/f'pagina_{y}.html'
  job=descobrir_especie(page.read_text(encoding='utf-8'),BASE+f'frota-de-veiculos-{y}',y)
  if job:jobs.append(job)
  else:ausentes.append(y)
 def baixar(job):
  name=unquote(urlparse(job['url']).path).split('/@@')[0].rsplit('/',1)[-1];ext=Path(name).suffix.lower()or'.bin'
  p=dest/f"{job['ano']}_especie_{sha(job['url'].encode())[:16]}{ext}";meta=p.with_suffix(p.suffix+'.json')
  if p.exists()and meta.exists():
   ref=json.loads(meta.read_bytes());assert ref['sha256']==sha(p.read_bytes());return ref
  for k in range(4):
   try:
    r=requests.get(job['url'],timeout=180);r.raise_for_status();b=r.content
    if len(b)<500 or 'html'in r.headers.get('Content-Type',''):raise ValueError('A fonte não retornou dados tabulares')
    p.write_bytes(b);ref=dict(**job,arquivo=p.relative_to(fontes).as_posix(),bytes=len(b),sha256=sha(b),obtido_em=datetime.now(timezone.utc).isoformat());meta.write_bytes(compacto(ref));return ref
   except(requests.RequestException,ValueError):
    if k==3:raise
    time.sleep(2**k)
 refs=[]
 with ThreadPoolExecutor(max_workers=4)as pool:
  for future in as_completed([pool.submit(baixar,j)for j in jobs]):
   ref=future.result();refs.append(ref);print(json.dumps(dict(ano=ref['ano'],bytes=ref['bytes'])),flush=True)
 (fontes/'senatran_perfis.json').write_bytes(compacto(dict(ok=True,referencia='dezembro',ausencias_dezembro=ausentes,arquivos=sorted(refs,key=lambda x:x['ano']))))
 print(json.dumps(dict(ok=True,arquivos=len(refs),bytes=sum(r['bytes']for r in refs))),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True,type=Path);adquirir(p.parse_args().fontes)
