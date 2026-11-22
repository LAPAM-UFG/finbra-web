"""Fixa o grafo de fontes do Raio X, preservando séries e downloads anteriores."""
import argparse,copy,gzip,hashlib,json
from pathlib import Path
import requests
from comparacoes_base import compacto,sha
from seguranca_fontes import sha as file_sha

def preparar(anterior,base,painel,downloads,saida,cache_previo=None):
 anterior,base,painel,downloads,saida=map(lambda p:Path(p).resolve(),[anterior,base,painel,downloads,saida])
 for p in [anterior,base,painel,downloads]:
  if p==saida or p.is_relative_to(saida)or saida.is_relative_to(p):raise ValueError('Destino sobreposto à origem')
 if saida.exists()and any(saida.iterdir()):raise ValueError('Use fontes novas e vazias')
 old=json.loads((base/'gold/downloads/manifesto.json').read_bytes());fresh=(downloads/'gold/downloads/manifesto.json').read_bytes();new=json.loads(fresh)
 assert old['resumo']==new['resumo']and old['base_sha256']==new['base_sha256']
 assert all(next(x for x in new['arquivos']if x['id']==o['id'])==o for o in old['arquivos']if o['tipo']in['painel','area']and o.get('area')!='comex')
 cp=painel/'gold/comparacoes/manifesto.json';root=json.loads(cp.read_bytes());root['origens']['gold/downloads/manifesto.json']=dict(bytes=len(fresh),sha256=sha(fresh));cp.write_bytes(compacto(root))
 pins=json.loads((anterior/'proveniencia.json').read_bytes())['arquivos'];out={};saida.mkdir(parents=True);cache=saida/'cache';cache.mkdir()
 def resolve(key,expected=None,local=None,public=False):
  if not key.startswith('gold/')or Path(key).is_absolute()or '..'in Path(key).parts or '\\'in key or ':'in key:raise ValueError('Chave de fonte inválida')
  if key in out:
   if expected:assert out[key]['sha256']==expected['sha256'],key
   return Path(out[key]['local'])
  candidates=([local]if local else[])+[p/key for p in [painel,downloads,base]]
  if cache_previo:candidates.append(Path(cache_previo).resolve()/key)
  if key in pins:candidates.append(Path(pins[key].get('local',anterior/key)))
  chosen=None
  if not public:
   for p in candidates:
    if p and p.is_file()and(expected is None or p.stat().st_size==expected['bytes']and file_sha(p)==expected['sha256']):chosen=p;break
  if chosen is None:
   chosen=cache/key;assert chosen.resolve().is_relative_to(cache.resolve());chosen.parent.mkdir(parents=True,exist_ok=True);resp=requests.get('https://finbra-web.luanviniciusbernardelli.workers.dev/dados/'+key,headers={'Cache-Control':'no-cache'},timeout=180);resp.raise_for_status();chosen.write_bytes(resp.content)
  ref=dict(local=str(chosen.resolve()),bytes=chosen.stat().st_size,sha256=file_sha(chosen))
  if expected:assert ref['bytes']==expected['bytes']and ref['sha256']==expected['sha256'],key
  out[key]=ref
  if key!='gold/downloads/manifesto.json'and(key.endswith('.json')or key.endswith('.json.gz')):
   b=chosen.read_bytes();walk(json.loads(gzip.decompress(b)if key.endswith('.gz')else b))
  return chosen
 def walk(v):
  if isinstance(v,dict):
   if isinstance(v.get('caminho'),str)and v['caminho'].startswith('gold/')and 'sha256'in v and 'bytes'in v:resolve(v['caminho'],v)
   # O Raio X lê séries territoriais; índices e arquivos de rankings são
   # referências da página de comparação, não dependências dos retratos.
   for k,x in v.items():
    if k not in ['indice_lista','mensais','perfis','classificacoes','downloads_mensais','dicionario_mensal']:walk(x)
  elif isinstance(v,list):
   for x in v:walk(x)
 resolve('gold/comparacoes/manifesto.json',local=cp)
 resolve('gold/assistencia/referencias_manifesto.json',public=True)
 resolve('gold/agropecuaria/manifesto.json',public=True)
 resolve('gold/mobilidade/manifesto.json',local=base/'gold/mobilidade/manifesto.json')
 resolve('gold/seguranca/manifesto.json',local=base/'gold/seguranca/manifesto.json')
 resolve('gold/internet/manifesto.json',local=base/'gold/internet/manifesto.json')
 resolve('gold/comex/manifesto.json',local=painel/'gold/comex/manifesto.json')
 resolve('gold/energia/manifesto.json',local=base/'gold/energia/manifesto.json')
 resolve('gold/downloads/manifesto.json',local=downloads/'gold/downloads/manifesto.json')
 # Apenas o fecho efetivamente usado entra na proveniência. Objetos históricos
 # fora deste grafo permanecem nas fontes anteriores, sem escrita ou exclusão.
 (saida/'proveniencia.json').write_bytes(compacto(dict(arquivos=out)))
 report=dict(ok=True,objetos=len(out),catalogos_anteriores_preservados=True,comparacoes_sha256=file_sha(cp),downloads_sha256=sha(fresh));(saida/'auditoria_integracao.json').write_bytes(compacto(report));print(json.dumps(report),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['anterior','base','painel','downloads','saida']:p.add_argument('--'+k,required=True)
 p.add_argument('--cache-previo')
 a=p.parse_args();preparar(a.anterior,a.base,a.painel,a.downloads,a.saida,a.cache_previo)
