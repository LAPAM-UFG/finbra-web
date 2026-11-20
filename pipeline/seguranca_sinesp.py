"""Normaliza Sinesp sem somar instituições, inventar municípios ou completar meses."""
import argparse,json,unicodedata
from pathlib import Path
import pandas as pd
from seguranca_fontes import sha
from seguranca_definicoes import SINESP,SINESP_CAMPOS

def chave(s):return ''.join(c for c in unicodedata.normalize('NFKD',str(s)).lower()if c.isascii()and c.isalnum())
def valores_evento(x):
 campos=x.evento.map({v[2]:SINESP_CAMPOS.get(k,'total_vitima')for k,v in SINESP.items()})
 assert campos.notna().all(),'Evento sem unidade definida'
 return x.total_vitima.where(campos.ne('total'),x.total)
def anual(x):
 """Linhas complementares são somadas; qualquer componente nulo invalida o mês."""
 assert x.data_referencia.notna().all()
 x=x.copy();x['mes']=pd.to_datetime(x.data_referencia).dt.month
 assert x.mes.between(1,12).all();assert(x.total_vitima.dropna()>=0).all()
 x['valido']=x.total_vitima.notna()
 grupos=x.groupby(['uf','municipio','id','mes'],dropna=False)
 m=grupos.total_vitima.sum(min_count=1).to_frame('valor');m['valido']=grupos.valido.all();m=m.reset_index()
 m['mes_valido']=m.valido.astype(int)
 grupos=m.groupby(['uf','municipio','id'],dropna=False)
 a=grupos.valor.sum(min_count=1).to_frame('valor');a['meses']=grupos.mes_valido.sum();a['meses_presentes']=grupos.mes.nunique();a=a.reset_index()
 a['condicao']=2;a.loc[a.valor.notna(),'condicao']=11;a.loc[a.valor.notna()&a.meses.eq(12),'condicao']=0;a.loc[a.valor.eq(0)&a.meses.eq(12),'condicao']=1
 return a,m
def gerar(fontes):
 root=Path(fontes).resolve();meta=json.loads((root/'sinesp_fontes.json').read_bytes());geo=json.loads((root/'geografia.json').read_bytes())
 lookup={(u,chave(n)):int(c)for c,n,u,*_ in geo['municipios']}
 aliases=json.loads(Path(__file__).with_name('mobilidade_municipios.json').read_bytes())['correspondencias']
 for a in aliases:lookup.setdefault((a['uf'],chave(a['nome_senatran'])),a['cod_ibge'])
 # Variações oficiais de grafia: correspondência explícita, nunca aproximação.
 extras=Path(__file__).with_name('seguranca_municipios.json')
 if extras.exists():
  for a in json.loads(extras.read_bytes()):
   assert any(m[0]==a['cod_ibge']and m[2]==a['uf']for m in geo['municipios']);lookup[(a['uf'],chave(a['nome']))]=a['cod_ibge']
 event={v[2]:k for k,v in SINESP.items()};parts=[];months=[];reports=[];pending=[]
 for ref in meta['arquivos']:
  if ref['ano']>2025:continue # Somente anos civis encerrados; 2026 não é total anual.
  p=root/ref['arquivo'];assert sha(p)==ref['sha256']
  cache=root/f'sinesp_{ref["ano"]}_leitura.parquet';cachemeta=cache.with_suffix('.origem.json')
  if cache.exists()and cachemeta.exists()and json.loads(cachemeta.read_bytes()).get('sha256')==ref['sha256']:x=pd.read_parquet(cache)
  else:
   x=pd.read_excel(p,engine='calamine',usecols=['uf','municipio','evento','data_referencia','total_vitima','total','abrangencia'])
   x.to_parquet(cache,index=False,compression='zstd');cachemeta.write_text(json.dumps(dict(sha256=ref['sha256'])),encoding='utf-8')
  x=x[x.abrangencia.eq('Estadual')&x.evento.isin(event)].copy();assert set(x.evento)==set(event)
  # Mandados são ocorrências (total); os demais indicadores contam vítimas.
  x['total_vitima']=valores_evento(x)
  assert pd.to_datetime(x.data_referencia).dt.year.eq(ref['ano']).all()
  x['id']=x.evento.map(event);a,m=anual(x);a['ano']=ref['ano'];m['ano']=ref['ano']
  for df in [a,m]:df['cod_ibge']=[lookup.get((u,chave(n)))for u,n in zip(df.uf,df.municipio)]
  for u,n in a.loc[a.cod_ibge.isna(),['uf','municipio']].drop_duplicates().itertuples(index=False,name=None):
   if chave(n)not in ['naoinformado','municipionaoinformado']:pending.append(dict(ano=ref['ano'],uf=u,nome=n))
  # Todos os zeros oficiais continuam nas contagens. A série zerada da UF é
  # distinguida de zeros municipais em uma UF que efetivamente reporta casos.
  totals=a.groupby(['uf','id']).valor.sum(min_count=1)
  zeradas={(u,id)for(u,id),v in totals.items()if pd.notna(v)and v==0}
  a.loc[[v==0 and(y,id)in zeradas for v,y,id in zip(a.valor,a.uf,a.id)],'condicao']=23
  m['condicao']=m['valido'].map({True:0,False:11})
  m.loc[m.valor.isna(),'condicao']=2
  m.loc[m.valido&m.valor.eq(0),'condicao']=1
  m.loc[[v==0 and(y,id)in zeradas for v,y,id in zip(m.valor,m.uf,m.id)],'condicao']=23
  parts.append(a);months.append(m);reports.append(dict(ano=ref['ano'],arquivo=ref['arquivo'],sha256=ref['sha256'],linhas_estaduais=len(x),linhas_anuais=len(a),series_zeradas_uf=[dict(uf=u,id=id)for u,id in sorted(zeradas)],linhas_com_menos_12_meses=int((a.meses<12).sum())))
  print(json.dumps(reports[-1],ensure_ascii=True),flush=True)
 if pending:
  (root/'sinesp_municipios_pendentes.json').write_text(json.dumps(pending,ensure_ascii=False,indent=2),encoding='utf-8');raise ValueError(f'{len(pending)} correspondências municipais a resolver explicitamente')
 allx=pd.concat(parts,ignore_index=True);assert not allx.duplicated(['ano','uf','cod_ibge','municipio','id']).any()
 allx.to_parquet(root/'sinesp_anual.parquet',index=False,compression='zstd');pd.concat(months,ignore_index=True).to_parquet(root/'sinesp_mensal.parquet',index=False,compression='zstd')
 report=dict(ok=True,anos=sorted(allx.ano.unique().tolist()),arquivos=reports,agregado=dict(arquivo='sinesp_anual.parquet',sha256=sha(root/'sinesp_anual.parquet')),mensal=dict(arquivo='sinesp_mensal.parquet',sha256=sha(root/'sinesp_mensal.parquet')))
 (root/'sinesp_normalizado.json').write_text(json.dumps(report,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print(json.dumps(dict(ok=True,linhas=len(allx))),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True);a=p.parse_args();gerar(a.fontes)
