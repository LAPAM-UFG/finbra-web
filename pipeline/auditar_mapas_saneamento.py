"""Confere cada célula e componente do mapa com o NDJSON publicado de saneamento."""
import argparse,json
from pathlib import Path
import numpy as np
from mapas_indicadores import sha

def auditar(rev,base):
 m=json.loads((base/'gold/mapas/saneamento_manifesto.json').read_bytes());original=json.loads((rev/'saneamento_base.json').read_bytes());refs=json.loads((rev/'fontes_resolvidas.json').read_bytes())
 def objeto(r):
  b=(base/r['caminho']).read_bytes();assert len(b)==r['bytes']and sha(b)==r['sha256'];return json.loads(b)
 cad=objeto(m['cadastro'])['municipios'];pos={r[0]:p for p,r in enumerate(cad)};anos=original['anos'];py={a:k for k,a in enumerate(anos)};ufpos={u:[p for p,r in enumerate(cad)if r[2]==u]for u in sorted({r[2]for r in cad})}
 shape=(len(anos),len(cad),len(original['indicadores']));vv=np.full(shape,np.nan);nn=np.full(shape,np.nan);dd=np.full(shape,np.nan);cc=np.full(shape,1,dtype=np.uint8)
 for j,i in enumerate(original['indicadores']):
  for a,k in py.items():
   if a not in i['anos']:cc[k,:,j]=5
 source=Path(refs[original['arquivo']['caminho']]['caminho_local']);assert source.stat().st_size==original['arquivo']['bytes']and sha(source.read_bytes())==original['arquivo']['sha256']
 with source.open(encoding='utf-8')as f:
  for l in f:
   g=json.loads(l)
   if not g['grupo'].isdigit()or len(g['grupo'])!=7:continue
   p=pos[int(g['grupo'])]
   for a,j,v,n,d,_,_,c in g['linhas']:
    k=py[a];vv[k,p,j]=np.nan if v is None else v;nn[k,p,j]=np.nan if n is None else n;dd[k,p,j]=np.nan if d is None else d;cc[k,p,j]=c
 report=dict(ok=True,celulas=0,recortes=0,zeros=0,ausentes=0,condicoes_originais={})
 bundle=None;estados=np.array([0,2,3,4,9,5,10])
 for ind in m['indicadores']:
  j=next(j for j,x in enumerate(original['indicadores'])if x['id']==ind['id']);assert ind['anos']==original['indicadores'][j]['anos'];idx=objeto(ind['indice'])
  if bundle is None:
   arq=idx['arquivo'];bundle=(base/arq['caminho']).read_bytes();assert len(bundle)==arq['bytes']and sha(bundle)==arq['sha256']
  else:assert idx['arquivo']==arq
  for a in ind['anos']:
   k=py[a];inicio,n,h=idx['recortes'][f'{a}:BR'];total=bundle[inicio:inicio+n];assert sha(total)==h and total.endswith(b'\n');linhas=total.splitlines(keepends=True);assert len(linhas)==27
   for (uf,pp),bb in zip(ufpos.items(),linhas):
    off,nb,hb=idx['recortes'][f'{a}:{uf}'];assert bb==bundle[off:off+nb]and sha(bb)==hb
    c=json.loads(bb);assert c['area']=='saneamento'and c['ano']==a and c['uf']==uf and c['indicador']==ind['id']and c['cadastro']==m['cadastro']['sha256']and c['quantidade']==len(pp)
    valores=np.array(c['valores']if c['valores']is not None else[None]*len(pp),dtype=float)
    assert np.array_equal(valores,vv[k,pp,j],equal_nan=True),(a,uf,ind['id'],'valor')
    assert np.array_equal(np.array(c['numeradores'],dtype=float),nn[k,pp,j],equal_nan=True)
    assert np.array_equal(np.array(c['denominadores'],dtype=float),dd[k,pp,j],equal_nan=True)
    assert np.array_equal(np.array(c['condicoes_originais']),cc[k,pp,j])
    esperado=estados[cc[k,pp,j]];esperado[(cc[k,pp,j]==0)&(vv[k,pp,j]==0)]=1;assert np.array_equal(np.array(c['condicoes']),esperado)
    report['celulas']+=len(pp);report['recortes']+=1;report['zeros']+=int(np.count_nonzero(valores==0));report['ausentes']+=int(np.count_nonzero(np.isnan(valores)))
    for code,nr in zip(*np.unique(cc[k,pp,j],return_counts=True)):report['condicoes_originais'][str(code)]=report['condicoes_originais'].get(str(code),0)+int(nr)
 (rev/'auditoria_saneamento.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--revisao',type=Path,required=True);p.add_argument('--candidato',type=Path,required=True);a=p.parse_args();auditar(a.revisao,a.candidato)
