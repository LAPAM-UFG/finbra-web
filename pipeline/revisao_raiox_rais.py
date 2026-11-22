"""Atualiza somente o retrato Trabalho da edição publicada do Raio X.

Escreve a edição v12 isolada, sem substituir os objetos das edições anteriores.
Confere hashes, definições, universo territorial e cada ponto preservado.
"""
import argparse,copy,gzip,json
from datetime import datetime,timezone
from pathlib import Path
from raio_x import compacto,sha,retrato,validar_destino

def gerar(base,comparacoes,saida):
 base=Path(base).resolve();comparacoes=Path(comparacoes).resolve();saida=validar_destino(base,saida);validar_destino(comparacoes,saida)
 dest=saida/'gold/raiox';dest.mkdir(parents=True)
 def ler(root,ref):
  raw=(root/ref['caminho']).read_bytes();assert len(raw)==ref['bytes']and sha(raw)==ref['sha256']
  if ref['caminho'].endswith('.gz'):raw=gzip.decompress(raw);assert len(raw)==ref['json_bytes']and sha(raw)==ref['json_sha256']
  return json.loads(raw)
 def objeto(nome,raw,ext='json'):
  digest=sha(raw);p=dest/(nome+'_'+digest[:16]+'.'+ext);p.write_bytes(raw);return dict(caminho=p.relative_to(saida).as_posix(),bytes=len(raw),sha256=digest)
 def ponto(f,tr):
  f.seek(tr[0]);b=f.read(tr[1]);assert sha(b)==tr[2]and b.endswith(b'\n');return json.loads(b)
 om=json.loads((base/'gold/raiox/v11_manifesto.json').read_bytes());oc=ler(base,om['catalogo']);nc=copy.deepcopy(oc)
 cm=json.loads((comparacoes/'gold/comparacoes/manifesto.json').read_bytes());ref=cm['catalogos']['trabalho_todas'];cc=ler(comparacoes,ref);assert len(cc['indicadores'])==166
 nc['catalogos']['trabalho_todas']['ref']=ref
 positions=[]
 for j,old in enumerate(nc['indicadores']):
  if old['catalogo']!='trabalho_todas':continue
  n=old['indice'];i=cc['indicadores'][n];assert old['id']==i['id'];nc['indicadores'][j]={k:v for k,v in dict(i,area='trabalho',rede='todas',catalogo='trabalho_todas',indice=n).items()if k!='indice_lista'};positions.append(j)
 assert len(positions)==166 and len(nc['indicadores'])==len(oc['indicadores'])
 body=compacto(nc);cat=objeto('catalogo',body);catgz={**objeto('catalogo',gzip.compress(body,mtime=0),'json.gz'),'json_bytes':len(body),'json_sha256':sha(body)}
 for key in ['geografia','geografia_json']:
  if om.get(key):
   source=base/om[key]['caminho']
   if not source.exists():source=comparacoes/om[key]['caminho']
   raw=source.read_bytes();assert sha(raw)==om[key]['sha256'];target=saida/om[key]['caminho'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
 indices={};count=preserved=changed=maxslice=valid=0
 for bucket,ref in om['indices'].items():
  oi=ler(base,ref);ci=ler(comparacoes,cc['indices'][bucket]);entries={};tmp=dest/('temporario_'+bucket+'.ndjson');assert set(oi['grupos'])<=set(ci['grupos'])
  with(base/oi['arquivo']['caminho']).open('rb')as of,(comparacoes/ci['arquivo']['caminho']).open('rb')as cf,tmp.open('wb')as out:
   for group,tr in oi['grupos'].items():
    old=ponto(of,tr);q=ponto(cf,ci['grupos'][group]);assert old['grupo']==q['grupo']==group;rows=copy.deepcopy(old['linhas'])
    for j in positions:
     i=nc['indicadores'][j];rows[j]=retrato(i,q['dados'][i['indice']],len(group)!=7);changed+=rows[j]!=old['linhas'][j]
    assert all(rows[j]==old['linhas'][j]for j in range(len(rows))if j not in positions);preserved+=len(rows)-len(positions)
    raw=compacto(dict(old,linhas=rows))+b'\n';entries[group]=[out.tell(),len(raw),sha(raw)];out.write(raw);maxslice=max(maxslice,len(raw));count+=1;valid+=sum(r is not None and r[1]is not None for r in rows)
  ref=objeto('retratos_'+bucket.lower(),tmp.read_bytes(),'ndjson');tmp.unlink();indices[bucket]=objeto('indice_'+bucket.lower(),compacto(dict(versao=1,arquivo=ref,grupos=entries)));print(json.dumps(dict(uf=bucket,territorios=count)),flush=True)
 assert count==om['territorios']and preserved==count*(len(oc['indicadores'])-166)
 m={**om,'gerado_em':datetime.now(timezone.utc).isoformat(),'catalogo':catgz,'catalogo_json':cat,'indices':indices,'max_trecho_bytes':maxslice,'fontes':{**om['fontes'],'comparacoes':dict(bytes=(comparacoes/'gold/comparacoes/manifesto.json').stat().st_size,sha256=sha((comparacoes/'gold/comparacoes/manifesto.json').read_bytes()))}}
 (dest/'v12_manifesto.json').write_bytes(compacto(m));audit=dict(ok=True,territorios=count,indicadores=m['indicadores'],pontos_preservados=preserved,pontos_trabalho_corrigidos=changed,observacoes_com_valor=valid,max_trecho_bytes=maxslice)
 (saida/'auditoria_geracao.json').write_bytes(compacto(audit));print(json.dumps(audit),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['base','comparacoes','saida']:p.add_argument('--'+k,type=Path,required=True)
 a=p.parse_args();gerar(a.base,a.comparacoes,a.saida)
