import argparse,concurrent.futures,gzip,hashlib,json
from pathlib import Path
import requests
T=Path('.')
ROOTS=[]
refs={}
def sha(b):return hashlib.sha256(b).hexdigest()
def fonte(ref):
 k=ref['caminho'];assert k.startswith(('gold/abertura/','gold/saneamento/','gold/educacao/'))and'..'not in k
 for root in ROOTS+[T/'fontes']:
  p=root/k
  if p.is_file()and p.stat().st_size==ref['bytes']and sha(p.read_bytes())==ref['sha256']:
   refs[k]={'caminho_local':str(p),'bytes':ref['bytes'],'sha256':ref['sha256']};return p
 r=requests.get('https://finbra-web.luanviniciusbernardelli.workers.dev/dados/'+k,timeout=120);r.raise_for_status();assert len(r.content)==ref['bytes']and sha(r.content)==ref['sha256'],k
 p=T/'fontes'/k;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(r.content);refs[k]={'caminho_local':str(p),'bytes':ref['bytes'],'sha256':ref['sha256']};return p
def indice(ref):
 p=fonte(ref);v=json.loads(gzip.decompress(p.read_bytes()));fonte(v['arquivo']);return v
def ler(n):return json.loads((T/n).read_bytes())
if __name__=='__main__':
 p=argparse.ArgumentParser(description='Confere/baixa somente as fontes publicadas necessárias aos mapas. Não altera as bases locais.');p.add_argument('--revisao',type=Path,required=True);p.add_argument('--bases',type=Path,nargs='*',default=[]);args=p.parse_args();T=args.revisao.resolve();ROOTS=[x.resolve()for x in args.bases];T.mkdir(parents=True,exist_ok=True)
 for name,key in {'global_base.json':'gold/manifesto.json','abertura_base.json':'gold/abertura/manifesto.json','saneamento_base.json':'gold/saneamento/manifesto.json','educacao_base.json':'gold/educacao/manifesto.json'}.items():
  r=requests.get('https://finbra-web.luanviniciusbernardelli.workers.dev/dados/'+key,timeout=60);r.raise_for_status();dest=T/name
  if dest.exists():assert dest.read_bytes()==r.content,'Manifesto mudou: use uma pasta de revisão nova'
  else:dest.write_bytes(r.content)
 g=ler('global_base.json');a=ler('abertura_base.json');s=ler('saneamento_base.json');e=ler('educacao_base.json')
 expected={'gerado_em':g['gerado_em'],'fontes':{k:g['fontes'][k]for k in ['rais','caged','rais_perfis']},'base_ipca':g['base_ipca'],'ipca':g['fontes']['ipca']}
 assert a['trabalho']['compatibilidade']==expected
 indices=[r for k,r in a['trabalho']['historico'].items()if len(k)==2]+[r for y,v in a['trabalho']['anos'].items()for k,r in v.items()if len(k)==2]
 with concurrent.futures.ThreadPoolExecutor(max_workers=6)as pool:list(pool.map(indice,indices))
 with concurrent.futures.ThreadPoolExecutor(max_workers=6)as pool:list(pool.map(fonte,[s['arquivo'],s['cadastro'],e['busca_municipios'],*s['municipios'].values()]))
 (T/'fontes_resolvidas.json').write_text(json.dumps(refs,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(dict(ok=True,objetos=len(refs),bytes=sum(r['bytes']for r in refs.values()),indices_trabalho=len(indices))),flush=True)
