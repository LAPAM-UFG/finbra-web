"""Fixa fontes do Raio X e compatibilidade dos downloads após acrescentar Mobilidade.

Só atualiza candidatos isolados. As séries antigas e a base principal devem
continuar nos mesmos objetos, antes de renovar o hash do catálogo de downloads.
"""
import argparse,copy,json,hashlib
from pathlib import Path
from agropecuaria_fontes import compacto,sha

def preparar(anterior,base,painel,downloads,saida):
 anterior,base,painel,downloads,saida=map(lambda p:Path(p).resolve(),[anterior,base,painel,downloads,saida])
 for p in [anterior,base,painel,downloads]:
  if p==saida or p.is_relative_to(saida)or saida.is_relative_to(p):raise ValueError('Destino sobreposto à origem')
 if saida.exists()and any(saida.iterdir()):raise ValueError('Use um destino vazio')
 old=json.loads((base/'gold/downloads/manifesto.json').read_bytes());new=json.loads((downloads/'gold/downloads/manifesto.json').read_bytes())
 for item in old['arquivos']:
  if item['tipo']=='painel':assert next(x for x in new['arquivos']if x['id']==item['id'])==item,'Seleção principal alterada'
 assert old['resumo']==new['resumo'] and old['base_sha256']==new['base_sha256']
 rootpath=painel/'gold/comparacoes/manifesto.json';root=json.loads(rootpath.read_bytes())
 fresh=(downloads/'gold/downloads/manifesto.json').read_bytes()
 root['origens']['gold/downloads/manifesto.json']=dict(bytes=len(fresh),sha256=sha(fresh));rootpath.write_bytes(compacto(root))
 prov=copy.deepcopy(json.loads((anterior/'proveniencia.json').read_bytes()))
 for key,ref in prov['arquivos'].items():ref['local']=str(Path(ref.get('local',anterior/key)).resolve())
 def add(path,key,mutable=False):
  b=path.read_bytes();ref=dict(local=str(path),bytes=len(b),sha256=sha(b))
  if key in prov['arquivos']and not mutable:assert prov['arquivos'][key]['sha256']==ref['sha256'],key
  prov['arquivos'][key]=ref
 for p in (painel/'gold').rglob('*'):
  if p.is_file():add(p,p.relative_to(painel).as_posix(),p.name.endswith('manifesto.json'))
 add(downloads/'gold/downloads/manifesto.json','gold/downloads/manifesto.json',True)
 saida.mkdir(parents=True);(saida/'proveniencia.json').write_bytes(compacto(prov))
 print(json.dumps(dict(ok=True,objetos=len(prov['arquivos']),origens_antigas_preservadas=True,comparacoes_sha256=sha(rootpath.read_bytes()),downloads_sha256=sha(fresh))),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['anterior','base','painel','downloads','saida']:p.add_argument('--'+k,type=Path,required=True)
 a=p.parse_args();preparar(a.anterior,a.base,a.painel,a.downloads,a.saida)
