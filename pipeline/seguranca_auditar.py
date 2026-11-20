"""Confere todas as contagens municipais, condições, razões, triênios e recortes."""
import argparse,gzip,json
from pathlib import Path
import numpy as np,pandas as pd
from seguranca_definicoes import SIM_DEFS,SINESP,SINESP_MENSAIS,MESES,CORE,ANOS
from seguranca_fontes import sha

def auditar(fontes,candidato,saida):
 fontes,candidato=Path(fontes).resolve(),Path(candidato).resolve();meta=json.loads((candidato/'gold/seguranca/manifesto.json').read_bytes());ref=meta['catalogo'];assert sha(candidato/ref['caminho'])==ref['sha256']
 cat=json.loads(gzip.decompress((candidato/ref['caminho']).read_bytes()));x=pd.read_parquet(candidato/'trabalho_seguranca/municipios.parquet').set_index(['cod_ibge','ano']).sort_index();geo=json.loads((fontes/'geografia.json').read_bytes());names={int(m[0]):m for m in geo['municipios']};nmun=len(names)
 assert len(x)==nmun*len(ANOS)and x.index.is_unique
 sm=pd.read_parquet(fontes/'sim_seguranca.parquet');m6={c//10:c for c in names};sm['cod_ibge']=sm.municipio6.map(m6);valid=sm[sm.cod_ibge.notna()].copy();valid['cod_ibge']=valid.cod_ibge.astype(int);valid=valid.set_index(['cod_ibge','ano'])
 original_cells=0
 for id in SIM_DEFS:
  expected=valid[id].reindex(x.index);available=(x.index.get_level_values('ano')<=2024)&(x.index.get_level_values('cod_ibge')!=5101837);expected.loc[available]=expected.loc[available].fillna(0);np.testing.assert_allclose(x[id],expected,equal_nan=True);original_cells+=len(x)
 sn=pd.read_parquet(fontes/'sinesp_anual.parquet');valid=sn[sn.cod_ibge.notna()].copy();valid.cod_ibge=valid.cod_ibge.astype(int)
 assert not valid.duplicated(['cod_ibge','ano','id']).any(),'Correspondência fundiu localidades diferentes'
 for id in SINESP:
  z=valid[valid.id==id].set_index(['cod_ibge','ano']);v=z.valor.reindex(x.index);np.testing.assert_allclose(x['sec_sn_'+id],v,equal_nan=True);np.testing.assert_array_equal(x['sec_sn_'+id+'_cond'],z.condicao.reindex(x.index).fillna(2));np.testing.assert_allclose(x['sec_sn_'+id+'_meses'],z.meses.reindex(x.index),equal_nan=True);original_cells+=len(x)*3
  totals=sn[sn.id==id].groupby(['ano','uf']).valor.sum(min_count=1)
  for(y,uf),v in totals.items():
   if pd.notna(v)and v==0:assert z[(z.index.get_level_values('ano')==y)&(z.uf==uf)].condicao.eq(23).all()
 monthly=pd.read_parquet(fontes/'sinesp_mensal.parquet');monthly=monthly[monthly.cod_ibge.notna()].copy();monthly.cod_ibge=monthly.cod_ibge.astype(int)
 for id in SINESP_MENSAIS:
  colunas=[f'sec_sn_{id}_m_{key}'for key,_,_ in MESES]
  soma=x[colunas].sum(axis=1,min_count=12);ok=x['sec_sn_'+id+'_cond'].isin([0,1])
  np.testing.assert_allclose(soma[ok],x.loc[ok,'sec_sn_'+id],equal_nan=True)
  for mes,(key,_,_)in enumerate(MESES,1):
   z=monthly[monthly.id.eq(id)&monthly.mes.eq(mes)].set_index(['cod_ibge','ano']);col=f'sec_sn_{id}_m_{key}'
   assert z.index.is_unique
   np.testing.assert_allclose(x[col],z.valor.reindex(x.index),equal_nan=True)
   np.testing.assert_array_equal(x[col+'_cond'],z.condicao.reindex(x.index).fillna(2));original_cells+=len(x)*2
 ids={v['id']:j for j,v in enumerate(cat['indicadores'])};rates=0;tri=0
 for id in CORE:
  base=x['sec_'+id].unstack('ano').reindex(columns=ANOS);actual=x['sec_'+id+'_3a'].unstack('ano').reindex(columns=ANOS)
  expected=base.T.rolling(3,min_periods=3).sum().T;np.testing.assert_allclose(actual,expected,equal_nan=True);tri+=actual.size
 for i in cat['derivados']:
  n,d=x[i['numerador_id']],x[i['denominador_id']];cn=x[i['numerador_id']+'_cond'];eligible=n.notna()&d.notna()&d.gt(0)&cn.isin([0,1]);truth=(n/d*i['fator']).where(eligible);np.testing.assert_allclose(x[i['variavel_download']],truth,equal_nan=True)
  flags=x[i['variavel_download']+'_cond'];assert x.loc[flags.isin([23,24]),i['variavel_download']].isna().all();assert flags.loc[cn.eq(23)].eq(23).all();assert flags.loc[cn.eq(11)].eq(24).all()
  if i['unidade']=='%':assert truth.dropna().between(0,100).all(),i['id']
  rates+=len(x)
 # Todos os recortes são conferidos por tamanho, hash, território e matrizes.
 for bucket,ir in meta['indices'].items():
  assert sha(candidato/ir['caminho'])==ir['sha256'];index=json.loads((candidato/ir['caminho']).read_bytes());p=candidato/index['arquivo']['caminho'];assert sha(p)==index['arquivo']['sha256']
  with p.open('rb')as f:
   for key,(off,size,h)in index['grupos'].items():
    f.seek(off);b=f.read(size);import hashlib
    assert len(b)==size and hashlib.sha256(b).hexdigest()==h;row=json.loads(b);assert row['grupo']==key and row['anos']==ANOS
    if len(key)==7:
     truth=x.loc[int(key)].reindex(ANOS)
     raw=[i['id']for i in cat['indicadores']];derived=[i['variavel_download']for i in cat['derivados']]
     np.testing.assert_allclose(np.asarray(row['valores'],dtype=float),truth[raw].to_numpy(),equal_nan=True)
     np.testing.assert_allclose(np.asarray(row['derivados'],dtype=float),truth[derived].to_numpy(),equal_nan=True)
     np.testing.assert_array_equal(row['condicoes'],truth[[id+'_cond'for id in raw]].to_numpy())
     np.testing.assert_array_equal(row['condicoes_derivados'],truth[[id+'_cond'for id in derived]].to_numpy())
 # Só o catálogo de Segurança muda; os demais continuam nos mesmos hashes.
 old=json.loads((fontes/'gold/comparacoes/manifesto.json').read_bytes());new=json.loads((candidato/'gold/comparacoes/manifesto.json').read_bytes());assert all(new['catalogos'][k]==v for k,v in old['catalogos'].items()if not k.startswith('seguranca_'))
 report=dict(ok=True,territorios=meta['territorios'],originais=meta['variaveis'],relativos=meta['calculados'],contagens_e_condicoes_cotejadas=original_cells,celulas_relativas= rates,celulas_trienio=tri,max_trecho_bytes=meta['max_trecho_bytes'],catalogos_anteriores_preservados=len(old['catalogos']),SIM_2025_indisponivel=bool(x.loc[(slice(None),2025),list(SIM_DEFS)].isna().all().all()),Sinesp_2013_2014_indisponivel=bool(x.loc[(slice(None),[2013,2014]),['sec_sn_'+k for k in SINESP]].isna().all().all()))
 report['catalogos_anteriores_preservados']=sum(not k.startswith('seguranca_')for k in old['catalogos'])
 assert report['SIM_2025_indisponivel']and report['Sinesp_2013_2014_indisponivel']
 Path(saida).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['fontes','candidato','saida']:p.add_argument('--'+k,required=True)
 a=p.parse_args();auditar(a.fontes,a.candidato,a.saida)
