"""Painel de Energia: retratos atuais e coortes verificadas de conexões desde 2013."""
import argparse,gzip,hashlib,json
from pathlib import Path
import numpy as np,pandas as pd
from comparacoes_base import Quadro
from internet import destino_seguro,taxa
from energia_fontes import sha
from energia_definicoes import *

def participacao_siga(numerador,denominador):
 """Não atribui participação a potência municipal compartilhada nem a base zero."""
 if not np.isfinite(numerador)or not np.isfinite(denominador):return np.nan,2
 if denominador==0:return np.nan,4
 assert 0<=numerador<=denominador+1e-6
 return min(100.,numerador/denominador*100),None

def preservar_edicao(fontes,sm,anos,idx,pos,a,c):
 """Mantém valores anteriores da mesma edição após cotejo com a reconstrução."""
 p=fontes/'gold/energia/manifesto.json'
 if not p.exists():return
 m=json.loads(p.read_bytes())
 if m['datas']!={'mmgd':sm['mmgd_data'],'siga':sm['siga_data']}:return
 if m.get('origens'):
  dm=json.loads((fontes/'gold/downloads/manifesto.json').read_bytes())
  principal=next(r for r in dm['arquivos']if r['id']=='painel_brasil_parquet')
  inputs={'aneel':sha(fontes/'energia_normalizada.json'),'populacao':principal['sha256'],'populacao_2026':sha(fontes/'populacao_2026_sidra.json')}
  # A mesma data pode conter uma retificação da ANEEL ou população nova.
  # O cotejo de reprodução só vale quando as versões das três entradas coincidem.
  if m['origens']!=inputs:return
 assert m['anos']==anos
 def ler(ref):
  raw=(fontes/ref['caminho']).read_bytes();assert len(raw)==ref['bytes']and hashlib.sha256(raw).hexdigest()==ref['sha256']
  return raw
 cat=json.loads(gzip.decompress(ler(m['catalogo'])));cols=[idx[i['id']]for i in cat['indicadores']]
 for ref in m['indices'].values():
  index=json.loads(ler(ref));path=fontes/index['arquivo']['caminho'];assert sha(path)==index['arquivo']['sha256']
  with path.open('rb')as f:
   for key,(offset,size,h)in index['grupos'].items():
    f.seek(offset);raw=f.read(size);assert hashlib.sha256(raw).hexdigest()==h;old=json.loads(raw);assert old['grupo']==key and old['anos']==anos
    values=np.array(old['valores'],dtype=float);flags=np.array(old['condicoes'],dtype='int8');loc=pos[key]
    np.testing.assert_allclose(a[:,loc,cols],values,rtol=1e-11,atol=1e-8,equal_nan=True);np.testing.assert_array_equal(c[:,loc,cols],flags)
    a[:,loc,cols]=values;c[:,loc,cols]=flags

def gerar(fontes,saida):
 fontes,saida=destino_seguro(fontes,saida);sm=json.loads((fontes/'energia_normalizada.json').read_bytes());assert sm['ok']
 for item in sm['arquivos'].values():assert sha(fontes/item['arquivo'])==item['sha256']
 assert not sm['mmgd_municipios_nao_resolvidos'],'Há registros MMGD sem município resolvido'
 g=json.loads((fontes/'geografia.json').read_bytes());municipios=g['municipios'];nmun=len(municipios);assert nmun==5571
 ufs={m[2]for m in municipios};grupos=[str(m[0])for m in municipios]+sorted(ufs)+['BR'];pos={v:j for j,v in enumerate(grupos)}
 groups={key:[j for j,m in enumerate(municipios)if key==str(m[0])or key==m[2]or key=='BR'or key=='I:'+str(m[3])or key=='T:'+str(m[4])]for key,t in g['territorios'].items()if t['nivel']in ['M','UF','BR','imediata','intermediaria']}
 ANOS=list(range(2013,sm['ano']+1));defs=definicoes(sm);idx={i['id']:j for j,i in enumerate(defs)};a=np.full((len(ANOS),len(grupos),len(defs)),np.nan);c=np.full(a.shape,5,dtype='int8')
 def put(year,id,key,value,flag=None):
  if str(key)not in pos or year not in ANOS:return
  k,j,z=ANOS.index(year),pos[str(key)],idx[id]
  if pd.isna(value):a[k,j,z]=np.nan;c[k,j,z]=2 if flag is None else flag
  else:a[k,j,z]=float(value);c[k,j,z]=flag if flag is not None else 1 if value==0 else 0
 year=sm['ano'];gd=pd.read_parquet(fontes/'mmgd_municipios.parquet');refs=pd.read_parquet(fontes/'mmgd_referencias.parquet');co=pd.read_parquet(fontes/'mmgd_coortes.parquet')
 def gd_value(id,val):return(id.removesuffix('_kw')+'_mw',val/1000)if id.endswith('_kw')else(id,val)
 gd_cols=[x for x in gd if x.startswith('ene_')]
 for key in grupos:
  for id in gd_cols:
   name,_=gd_value(id,0);put(year,name,key,0)
 for row in pd.concat([gd.rename(columns={'cod_ibge':'grupo'}),refs.assign(grupo=refs.uf)],ignore_index=True).itertuples(index=False):
  for id in gd_cols:
   name,value=gd_value(id,getattr(row,id));put(year,name,str(int(row.grupo))if isinstance(row.grupo,(float,int,np.integer))else row.grupo,value)
 cohort_cols=[id for id in co if id.startswith('ene_')]
 for yy in ANOS:
  for key in grupos:
   for id in cohort_cols:put(yy,id,key,0)
 for row in co.itertuples(index=False):
  for id in cohort_cols:put(int(row.ano),id,int(row.cod_ibge),getattr(row,id))
 for yy,z in co.groupby('ano'):
  for key,sub in [('BR',z),*list(z.groupby('uf'))]:
   for id in cohort_cols:put(int(yy),id,key,sub[id].sum())
 sf=pd.read_parquet(fontes/'siga_usinas.parquet');sl=pd.read_parquet(fontes/'siga_localizacoes.parquet');assert set(sf.fase)<=set(['Operação','Construção','Construção não iniciada'])
 shared=set(sl.loc[sl.compartilhada,'CodCEG']);sf['_compartilhada']=sf.CodCEG.isin(shared);sf['_renovavel']=sf.fonte.isin(['Solar','Eólica','Hídrica','Biomassa']);municipal=sf.merge(sl,on='CodCEG',validate='one_to_many');local={str(int(k)):z for k,z in municipal.groupby('cod_ibge')}
 source_names={'solar':'Solar','eolica':'Eólica','hidrica':'Hídrica','biomassa':'Biomassa','fossil':'Fóssil','nuclear':'Nuclear'}
 for key in grupos:
  z=local.get(key,sf.iloc[:0])if len(key)==7 else sf if key=='BR'else sf[sf.uf==key]
  def capacity(sub,column):return np.nan if len(key)==7 and sub['_compartilhada'].any()else sub[column].sum()/1000
  for id,phase in [('op','Operação'),('obra','Construção'),('projeto','Construção não iniciada')]:
   sub=z[z.fase==phase];put(year,'ene_siga_'+id+'_n',key,len(sub));put(year,'ene_siga_'+id+'_mw',key,capacity(sub,'kw'if id=='op'else'outorgada_kw'))
  op=z[z.fase=='Operação'];put(year,'ene_siga_compart_n',key,int(op['_compartilhada'].sum()))
  total_mw=capacity(op,'kw')
  for id,_,_ in FONTES_SIGA:
   sub=op[op.fonte==source_names[id]]if id in source_names else op[~op.fonte.isin(source_names.values())]
   put(year,'ene_siga_'+id+'_n',key,len(sub));put(year,'ene_siga_'+id+'_mw',key,capacity(sub,'kw'))
   v,flag=participacao_siga(capacity(sub,'kw'),total_mw);put(year,'ene_siga_'+id+'_mw_pct',key,v,flag)
  for id,_,_ in HIDRELETRICAS:
   sub=op[op.tipo==id.upper()];put(year,'ene_siga_'+id+'_n',key,len(sub));put(year,'ene_siga_'+id+'_mw',key,capacity(sub,'kw'))
  renewable=op[op['_renovavel']];ren_mw=capacity(renewable,'kw');put(year,'ene_siga_ren_n',key,len(renewable));put(year,'ene_siga_ren_mw',key,ren_mw)
  v,flag=participacao_siga(ren_mw,total_mw);put(year,'ene_siga_ren_mw_pct',key,v,flag)
 dm=json.loads((fontes/'gold/downloads/manifesto.json').read_bytes());main=next(x for x in dm['arquivos']if x['id']=='painel_brasil_parquet');assert sha(fontes/main['caminho'])==main['sha256']
 pop=pd.read_parquet(fontes/main['caminho'],columns=['cod_ibge','ano','sau_populacao'])
 for row in pop[pop.sau_populacao.notna()].itertuples(index=False):put(int(row.ano),'ene_populacao',int(row.cod_ibge),row.sau_populacao)
 for row in json.loads((fontes/'populacao_2026_sidra.json').read_bytes())[1:]:put(int(row['D3C']),'ene_populacao',row['D1C'],int(row['V']))
 for key in [*sorted(ufs),'BR']:
  for k,yy in enumerate(ANOS):
   z=a[k,groups[key],idx['ene_populacao']];put(yy,'ene_populacao',key,np.nansum(z)if np.isfinite(z).any()else np.nan)
 preservar_edicao(fontes,sm,ANOS,idx,pos,a,c)
 quadros=[]
 def razao(id,n,d,pt,en,tema,fator=100,unidade='%'):
  ni,di=idx[n],idx[d];periodos=defs[ni]['anos'];yy=[ANOS.index(y)for y in periodos];nn=a[yy,:nmun,ni].copy();dd=a[yy,:nmun,di].copy();vv,cc=taxa(nn,dd,c[yy,:nmun,ni],fator);coorte=defs[ni]['tipo_periodo']=='coorte';nota=NOTA_COORTE if coorte else NOTA_GD;nota_en=NOTA_COORTE_EN if coorte else NOTA_GD_EN
  definition=dict(id=id,nome=pt,nome_en=en,descricao=nota,descricao_en=nota_en,tema=tema,tema_en=tema,unidade=unidade,unidade_en={'por mil habitantes':'per 1,000 residents','kW por habitante':'kW per resident','kW por instalação':'kW per installation'}.get(unidade,unidade),formato='percentual'if unidade=='%'else'numero',frequencia='anual',metodo_referencia='razao',normalizacao=pt,normalizacao_en=en,fator=fator,ranking=True,minimo=0,fonte_nome='ANEEL · MMGD / IBGE',fontes=[dict(nome='ANEEL · MMGD',url=GD_URL),dict(nome='IBGE · população',url='https://sidra.ibge.gov.br/tabela/6579')],alerta=nota,alerta_en=nota_en,variavel_download='ene_'+id,numerador_id=n,denominador_id=d,numerador_nome=defs[ni]['nome'],denominador_nome=defs[di]['nome'],tipo_periodo='coorte'if coorte else'atual',notas_anos=defs[ni]['notas_anos']);assert len(definition['variavel_download']+'_cond')<=32;quadros.append(Quadro(definition,periodos,vv,nn,dd,cc))
 razao('gd_1000hab','ene_gd_n','ene_populacao','Geração distribuída: instalações por mil habitantes','Distributed generation installations per 1,000 residents','Geração distribuída',1000,'por mil habitantes')
 razao('gd_kw_hab','ene_gd_mw','ene_populacao','Potência de geração distribuída por habitante','Distributed generation capacity per resident','Geração distribuída',1000,'kW por habitante')
 razao('gd_kw_inst','ene_gd_mw','ene_gd_n','Potência média por instalação','Average capacity per installation','Geração distribuída',1000,'kW por instalação')
 for fam,items in [('fonte',FONTES),('classe',CLASSES),('porte',PORTES)]:
  for k,pt,en in items:
   for suffix,desc,desc_en in [('n','instalações','installations'),('mw','potência','capacity')]:
    razao(f'gd_{fam}_{k}_{suffix}_pct',f'ene_gd_{fam}_{k}_{suffix}','ene_gd_n'if suffix=='n'else'ene_gd_mw',pt+f': participação nas {desc}'if suffix=='n'else pt+': participação na potência',en+': share of '+desc_en,'Fonte da geração'if fam=='fonte'else'Classe de consumo'if fam=='classe'else'Porte da instalação')
 razao('gd_con_1000hab','ene_gd_conexoes','ene_populacao','Conexões por mil habitantes: cadastro atual','Connections per 1,000 residents: current registry','Coortes de conexão',1000,'por mil habitantes')
 razao('gd_con_solar_pct','ene_gd_con_solar','ene_gd_conexoes','Solar entre as conexões do ano: cadastro atual','Solar share of annual connections: current registry','Coortes de conexão')
 for fam,items in PERFIS_NOVOS:
  for k,pt,en in items:
   for suffix,label,label_en in [('n','instalações','installations'),('mw','potência','capacity')]:
    razao(f'gd_{fam}_{k}_{suffix}_pct',f'ene_gd_{fam}_{k}_{suffix}','ene_gd_n'if suffix=='n'else'ene_gd_mw',pt+': participação '+('nas instalações'if suffix=='n'else'na potência'),en+': share of '+label_en,{'mod':'Modalidade de geração','tit':'Tipo de titular','pub':'Classes públicas'}[fam])
    quadros[-1].definicao.update(descricao=NOTAS_PERFIS[fam][0]+' '+NOTA_GD,descricao_en=NOTAS_PERFIS[fam][1]+' '+NOTA_GD_EN,alerta=NOTAS_PERFIS[fam][0]+' '+NOTA_GD,alerta_en=NOTAS_PERFIS[fam][1]+' '+NOTA_GD_EN)
 from energia_artefatos import gerar_artefatos
 gerar_artefatos(fontes,saida,g,municipios,grupos,pos,ufs,groups,ANOS,a,c,defs,quadros,{},sm,main)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True);p.add_argument('--saida',required=True);a=p.parse_args();gerar(a.fontes,a.saida)
