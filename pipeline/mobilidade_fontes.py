"""Cache auditável dos retratos de dezembro da Senatran, sem alterar o gold."""
import argparse, hashlib, html, json, re, time, unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse, unquote
import requests

ANOS=list(range(2013,2026))
BASE='https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/'

def compacto(x):return json.dumps(x,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def norm(s):return ''.join(c for c in unicodedata.normalize('NFKD',str(s))if not unicodedata.combining(c)).lower().strip()

class Links(HTMLParser):
 def __init__(self):super().__init__();self.out=[];self.text=[];self.href=None;self.label=[];self.ignore=0
 def handle_starttag(self,tag,attrs):
  if tag in ['script','style']:self.ignore+=1
  if tag=='a':self.href=dict(attrs).get('href');self.label=[]
 def handle_data(self,data):
  if self.ignore:return
  text=data.strip()
  if text:self.text.append(text)
  if self.href:self.label.append(text)
 def handle_endtag(self,tag):
  if tag in ['script','style']:self.ignore=max(0,self.ignore-1)
  if tag=='a'and self.href:
   self.out.append(dict(href=self.href,text=' '.join(self.label),context=' '.join(self.text[-30:])));self.href=None

def descobrir(body,url,ano):
 p=Links();p.feed(body);out={}
 for link in p.out:
  label=norm(link['text']);tipo=('tipo'if label.startswith('frota por municipio')or label.startswith('frota por munic')else'idade'if'munic'in label and'fabr'in label else'combustivel'if'munic'in label and'combust'in label else None)
  if tipo and tipo not in out:
   context=norm(link['context']);months=re.findall(r'\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b',context)
   if not months or months[-1]!='dezembro':raise ValueError(f'{ano}: primeiro arquivo de {tipo} não está identificado como dezembro')
   out[tipo]=dict(url=urljoin(url,html.unescape(link['href'])),rotulo=link['text'],contexto=link['context'])
 if set(out)!={'tipo','idade','combustivel'}:raise ValueError(f'{ano}: arquivos de dezembro incompletos: {list(out)}')
 return out

def adquirir(saida):
 saida=Path(saida).resolve();raw=saida/'senatran';raw.mkdir(parents=True,exist_ok=True);jobs=[]
 for ano in ANOS:
  url=BASE+f'frota-de-veiculos-{ano}';p=raw/f'pagina_{ano}.html'
  if not p.exists():
   r=requests.get(url,timeout=90);r.raise_for_status();p.write_bytes(r.content)
  refs=descobrir(p.read_text(encoding='utf-8'),url,ano)
  for tipo,ref in refs.items():jobs.append(dict(ano=ano,tipo=tipo,pagina=url,**ref))
 def download(job):
  key=sha(job['url'].encode())[:16];name=unquote(urlparse(job['url']).path).split('/@@')[0].rsplit('/',1)[-1];ext=Path(name).suffix.lower()or'.bin';p=raw/f"{job['ano']}_{job['tipo']}_{key}{ext}";meta=p.with_suffix(p.suffix+'.json')
  if meta.exists()and p.exists():
   d=json.loads(meta.read_bytes());assert sha(p.read_bytes())==d['sha256'];return d
  for attempt in range(4):
   try:
    r=requests.get(job['url'],timeout=180);r.raise_for_status();body=r.content
    if len(body)<500 or'html'in r.headers.get('Content-Type',''):raise ValueError('A resposta não é uma planilha')
    p.write_bytes(body);d=dict(**job,arquivo=p.relative_to(saida).as_posix(),bytes=len(body),sha256=sha(body),obtido_em=datetime.now(timezone.utc).isoformat(),content_type=r.headers.get('Content-Type'));meta.write_bytes(compacto(d));return d
   except(requests.RequestException,ValueError):
    if attempt==3:raise
    time.sleep(2**attempt)
 out=[]
 with ThreadPoolExecutor(max_workers=4)as pool:
  for f in as_completed([pool.submit(download,j)for j in jobs]):
   d=f.result();out.append(d);print(json.dumps({k:d[k]for k in ['ano','tipo','bytes']}),flush=True)
 out.sort(key=lambda d:(d['ano'],d['tipo']));result=dict(versao=1,referencia='dezembro',anos=ANOS,arquivos=out);(saida/'senatran.json').write_bytes(compacto(result));print(json.dumps(dict(ok=True,arquivos=len(out),bytes=sum(d['bytes']for d in out))),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--saida',required=True,type=Path);a=p.parse_args();adquirir(a.saida)
