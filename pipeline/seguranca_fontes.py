"""Aquisição dos arquivos anuais oficiais Sinesp; cache e proveniência isolados."""
import argparse,hashlib,json,re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from html.parser import HTMLParser
from pathlib import Path
import requests

PAGINA='https://www.gov.br/mj/pt-br/assuntos/sua-seguranca/seguranca-publica/estatistica/dados-nacionais-1/base-de-dados-e-notas-metodologicas-dos-gestores-estaduais-sinesp-vde-2022-e-2023'
SIM='https://dadosabertos.saude.gov.br/dataset/sim'
class Links(HTMLParser):
 def __init__(self):super().__init__();self.urls=[]
 def handle_starttag(self,tag,attrs):
  if tag=='a':self.urls.append(dict(attrs).get('href',''))
def sha(p):
 with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def adquirir(fontes):
 root=Path(fontes).resolve();root.mkdir(parents=True,exist_ok=True)
 r=requests.get(PAGINA,timeout=90);r.raise_for_status();(root/'sinesp_pagina.html').write_bytes(r.content)
 links=Links();links.feed(r.text)
 urls=sorted(set(u for u in links.urls if re.search(r'/bancovde-20\d{2}\.xlsx/@@download/file$',u)))
 assert urls,'Nenhum arquivo anual na página oficial'
 def fetch(url):
  ano=int(re.search(r'bancovde-(20\d{2})',url)[1]);p=root/'sinesp'/f'bancovde-{ano}.xlsx';p.parent.mkdir(exist_ok=True)
  if not p.exists():
   resp=requests.get(url,timeout=180);resp.raise_for_status();assert resp.content[:2]==b'PK';p.write_bytes(resp.content)
  return dict(ano=ano,arquivo=p.relative_to(root).as_posix(),url=url,bytes=p.stat().st_size,sha256=sha(p))
 with ThreadPoolExecutor(max_workers=3)as pool:refs=list(pool.map(fetch,urls))
 out=dict(ok=True,adquirido_em=datetime.now(timezone.utc).isoformat(),pagina=PAGINA,pagina_sha256=sha(root/'sinesp_pagina.html'),arquivos=refs)
 (root/'sinesp_fontes.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(dict(ok=True,anos=[r['ano']for r in refs],bytes=sum(r['bytes']for r in refs))),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True);a=p.parse_args();adquirir(a.fontes)
