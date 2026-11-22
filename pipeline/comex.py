"""Comércio exterior: agregados prontos, mesmos meses e referências recalculadas."""
import argparse,json,re,unicodedata
from pathlib import Path
from types import SimpleNamespace
import duckdb,numpy as np,pandas as pd
from comex_fontes import sha,salvar
from comex_definicoes import *
from internet import destino_seguro
from comparacoes_base import Quadro,numeros

def aux(p):
 for enc in ['utf-8-sig','latin1']:
  try:return pd.read_csv(p,sep=';',encoding=enc)
  except UnicodeDecodeError:pass
 raise ValueError('Codificação de tabela auxiliar desconhecida')

def calcular_razao(n,d,fator=100,potencia=1):
 n,d=np.asarray(n,dtype=float),np.asarray(d,dtype=float);dd=np.power(d,potencia)
 with np.errstate(divide='ignore',invalid='ignore'):v=n/dd*fator
 c=np.where(~np.isfinite(n),2,np.where(~np.isfinite(d),3,np.where(d==0,4,np.where(v==0,1,0)))).astype('int8');v[(~np.isfinite(n))|(~np.isfinite(dd))|(d<=0)]=np.nan
 if fator in [100,10000]:
  assert np.all(v[np.isfinite(v)]<=fator+1e-7)and np.all(v[np.isfinite(v)]>=0),'Concentração fora dos limites'
  v=np.minimum(v,float(fator))
 return v,c,dd

class QuadroComex(Quadro):
 def grupo_territorio(self,key,pos,municipio=False,incluir_ressalvas=False):
  if municipio:return super().grupo_territorio(key,pos,municipio=True)
  df=self.base.loc[(key,self.periodos),:];n=df[self.ncol].to_numpy();d=df[self.dcol].to_numpy();v,c,dd=calcular_razao(n,d,self.definicao['fator'],self.power)
  # Zero de comércio é um componente conhecido. Agregações de concentração
  # usam os produtos/mercados reunidos, inclusive municípios sem comércio.
  valid=np.isfinite(v);q=np.where(valid,int(self.cobertos[pos].sum()),0);c[valid&(q<len(pos))]=16
  if self.dcol=='cex_populacao':
   q=np.array([(np.isfinite(self.pop[k,pos])&self.cobertos[pos]).sum()if valid[j]else 0 for j,k in enumerate(range(len(self.periodos)))]);c[valid&(q<len(pos))]=16
  return dict(v=numeros(v),n=numeros(n),d=numeros(dd),c=c.astype(int).tolist(),q=q.astype(int).tolist(),r=numeros(v))

def grupos_geograficos(g):
 out={k:[]for k,t in g['territorios'].items()if t['nivel']in ['M','UF','BR','imediata','intermediaria']}
 for j,(cod,_,uf,im,inter)in enumerate(g['municipios']):
  for key in [str(cod),uf,'BR','I:'+str(im),'T:'+str(inter)]:out[key].append(j)
 return out

def correspondencia_municipal(tabela,municipios):
 """Converte a codificação MDIC por nome oficial + UF ou IBGE existente.

 Três aliases explícitos resolvem nomes históricos de SP; nunca se faz
 correspondência aproximada nem se escolhe uma cidade só pelo nome.
 """
 def norm(s):return re.sub('[^A-Z0-9]','',unicodedata.normalize('NFKD',s.upper()).encode('ascii','ignore').decode())
 geo={int(m[0]):m for m in municipios};nomes={(m[2],norm(m[1])):int(m[0])for m in municipios};prefixos={m[2]:str(m[0])[:2]for m in municipios};out={};audit=[]
 aliases={3415004:3515004,3416101:3516101,3450001:3550001}
 for r in tabela.itertuples(index=False):
  origem=int(r.CO_MUN_GEO);uf=r.SG_UF;dest=nomes.get((uf,norm(r.NO_MUN)));method='nome_oficial_uf'
  if dest is None and origem in geo and geo[origem][2]==uf:dest=origem;method='codigo_ibge_existente'
  if dest is None and origem in aliases and geo[aliases[origem]][2]==uf:dest=aliases[origem];method='codigo_mdic_alias'
  if dest is not None:
   assert geo[dest][2]==uf;out[(origem,uf)]=dest;audit.append(dict(codigo_mdic=origem,cod_ibge=dest,uf=uf,nome_mdic=r.NO_MUN,nome_ibge=geo[dest][1],metodo=method))
  elif uf in prefixos:raise ValueError('Município MDIC sem correspondência inequívoca: '+str((origem,r.NO_MUN,uf)))
 assert len(set(out.values()))==len(out),'Dois códigos MDIC para o mesmo município: revisar antes de somar'
 return out,audit

def gerar(fontes,saida):
 fontes,saida=destino_seguro(fontes,saida);meta=json.loads((fontes/'fontes_comex.json').read_bytes());assert meta['ok'];years=list(range(2013,meta['ano']+1));cut=meta['mes']
 for f in meta['arquivos']:assert sha(fontes/f['arquivo'])==f['sha256']
 g=json.loads((fontes/'geografia.json').read_bytes());mun=g['municipios'];assert len(mun)==5571;geo={int(m[0]):m for m in mun};groups=grupos_geograficos(g)
 work=saida/'trabalho_comex';work.mkdir(parents=True);db=duckdb.connect(str(work/'comex.duckdb'));db.execute("SET threads=2;SET memory_limit='3GB';SET enable_progress_bar=false")
 db.execute('CREATE TABLE fatos(ano SMALLINT,mes SMALLINT,fluxo VARCHAR,cod_ibge INTEGER,uf VARCHAR,sh4 VARCHAR,pais INTEGER,kg BIGINT,fob BIGINT)')
 for ref in meta['arquivos']:
  name=ref['arquivo'];m=re.fullmatch(r'(EXP|IMP)_(\d{4})_MUN.csv',name)
  if not m:continue
  flow='exp'if m[1]=='EXP'else'imp';year=int(m[2]);p=(fontes/name).as_posix()
  db.execute("INSERT INTO fatos SELECT CO_ANO::SMALLINT,CO_MES::SMALLINT,?,coalesce(try_cast(CO_MUN AS INTEGER),-1),trim(SG_UF_MUN),lpad(SH4,4,'0'),CO_PAIS::INTEGER,KG_LIQUIDO::BIGINT,VL_FOB::BIGINT FROM read_csv(?,delim=';',header=true,types={'SH4':'VARCHAR'})",[flow,p])
  v=db.execute('SELECT min(ano),max(ano),list(DISTINCT mes ORDER BY mes),count(*),sum(kg),sum(fob)FROM fatos WHERE fluxo=? AND ano=?',[flow,year]).fetchone();assert v[0]==v[1]==year and v[2]==list(range(1,meta['periodos'][str(year)]+1)),name
  ctrl=aux(fontes/(m[1]+'_TOTAIS_CONFERENCIA_MUN.csv'));target=ctrl[ctrl.CO_ANO.eq(year)];assert len(target)==1 and v[3:]==tuple(int(target[c].iloc[0])for c in ['NUMERO_LINHAS','KG_LIQUIDO','VL_FOB']),('Totais oficiais divergem',name,v)
  print(json.dumps(dict(etapa='arquivo_conferido',arquivo=name,linhas=v[3],FOB=v[5])),flush=True)
 assert db.execute('SELECT count(*)FROM fatos WHERE kg IS NULL OR fob IS NULL OR kg<0 OR NOT regexp_full_match(sh4,\'[0-9]{4}\')').fetchone()[0]==0
 negativos=db.execute('SELECT count(*),coalesce(sum(fob),0)FROM fatos WHERE fob<0').fetchone()
 knownufs={m[2]for m in mun};mapping=[];unresolved=[];crosswalk,audit=correspondencia_municipal(aux(fontes/'UF_MUN.csv'),mun);pd.DataFrame(audit).to_csv(work/'correspondencia_municipios.csv',index=False,encoding='utf-8');covered=set(crosswalk.values());smissing=[m[:3]for m in mun if m[0]not in covered];meta['municipios_sem_tabela']=smissing
 for cod,uf in db.execute('SELECT DISTINCT cod_ibge,uf FROM fatos').fetchall():
  keys=['BR']+([uf]if uf in knownufs else[]);m=geo.get(crosswalk.get((cod,uf)))
  if m:keys +=[str(m[0]),'I:'+str(m[3]),'T:'+str(m[4])]
  else:unresolved.append([cod,uf])
  for key in keys:mapping.append((cod,uf,key))
 mm=pd.DataFrame(mapping,columns=['cod_ibge','uf','grupo']);db.register('mapa',mm);db.execute('CREATE VIEW territorial AS SELECT f.*,m.grupo FROM fatos f JOIN mapa m USING(cod_ibge,uf)')
 print(json.dumps(dict(etapa='territorios',associacoes=len(mapping),codigos_nao_atribuidos=unresolved,correspondencias=len(audit))),flush=True)
 db.execute("CREATE TABLE produtos AS SELECT grupo,ano,fluxo,modo,sh4,sum(fob)::BIGINT fob,sum(kg)::BIGINT kg FROM territorial CROSS JOIN (VALUES ('obs',12),('c',?)) w(modo,corte)WHERE mes<=corte GROUP BY ALL",[cut]);print(json.dumps(dict(etapa='produtos',linhas=db.execute('SELECT count(*)FROM produtos').fetchone()[0])),flush=True)
 db.execute("CREATE TABLE paises AS SELECT grupo,ano,fluxo,modo,pais,sum(fob)::BIGINT fob,sum(kg)::BIGINT kg FROM territorial CROSS JOIN (VALUES ('obs',12),('c',?)) w(modo,corte)WHERE mes<=corte GROUP BY ALL",[cut]);print(json.dumps(dict(etapa='mercados',linhas=db.execute('SELECT count(*)FROM paises').fetchone()[0])),flush=True)
 assert db.execute('SELECT count(*)FROM produtos WHERE fob<0').fetchone()[0]==0 and db.execute('SELECT count(*)FROM paises WHERE fob<0').fetchone()[0]==0,'Revisar concentração com peso líquido negativo; não truncar nem remover registros'
 db.execute('CREATE TABLE mensal AS SELECT grupo,ano,mes,fluxo,sum(fob)::BIGINT fob,sum(kg)::BIGINT kg FROM territorial GROUP BY ALL')
 db.execute("CREATE TABLE stats AS WITH p AS(SELECT grupo,ano,fluxo,modo,count(*)prod_n,sum(fob)::BIGINT fob,sum(kg)::BIGINT kg,max(fob)::BIGINT p1_fob,sum(fob)FILTER(WHERE rn<=3)::BIGINT p3_fob,sum(fob::HUGEINT*fob::HUGEINT)::DOUBLE p2 FROM(SELECT *,row_number()OVER(PARTITION BY grupo,ano,fluxo,modo ORDER BY fob DESC,sh4)rn FROM produtos)GROUP BY ALL),c AS(SELECT grupo,ano,fluxo,modo,count(*)pais_n,max(fob)::BIGINT c1_fob,sum(fob)FILTER(WHERE rn<=3)::BIGINT c3_fob,sum(fob::HUGEINT*fob::HUGEINT)::DOUBLE c2 FROM(SELECT *,row_number()OVER(PARTITION BY grupo,ano,fluxo,modo ORDER BY fob DESC,pais)rn FROM paises)GROUP BY ALL)SELECT * FROM p JOIN c USING(grupo,ano,fluxo,modo)")
 stats=db.execute('SELECT * FROM stats').fetchdf().set_index(['grupo','ano','fluxo','modo']);allkeys=list(groups);index=pd.MultiIndex.from_product([allkeys,years],names=['grupo','ano']);df=pd.DataFrame(index=index)
 for flow in ['exp','imp']:
  for mode in ['obs','c']:
   sub=stats.xs((flow,mode),level=('fluxo','modo')).reindex(index).fillna(0)
   for suffix,*_ in BASES:df[f'cex_{flow}_{suffix}'+('_c'if mode=='c'else'')]=sub[suffix].to_numpy()
  for suffix,ncol,_,_,factor,_ in RAZOES:
   v,_,_=calcular_razao(df[f'cex_{flow}_{ncol}'],df[f'cex_{flow}_fob'],factor,2 if suffix.startswith('hhi')else 1);df[f'cex_{flow}_{suffix}']=v
  yearmeta=pd.DataFrame([(y,meta['periodos'][str(y)])for y in years[1:]],columns=['destino','max_mes']);db.register('anos_anteriores',yearmeta)
  prev=db.execute('SELECT grupo,a.destino ano,sum(fob)::BIGINT valor FROM mensal m JOIN anos_anteriores a ON m.ano=a.destino-1 AND m.mes<=a.max_mes WHERE fluxo=? GROUP BY ALL',[flow]).fetchdf().set_index(['grupo','ano']).valor.reindex(index).fillna(0);prev.loc[pd.IndexSlice[:,2013]]=np.nan;df[f'cex_{flow}_ant_eq']=prev
  with np.errstate(divide='ignore',invalid='ignore'):df[f'cex_{flow}_var_pct']=(df[f'cex_{flow}_fob']/prev-1)*100
  df.loc[prev.le(0),f'cex_{flow}_var_pct']=np.nan
 for suffix in ['', '_c']:
  df['cex_saldo_fob'+suffix]=df['cex_exp_fob'+suffix]-df['cex_imp_fob'+suffix];df['cex_corrente_fob'+suffix]=df['cex_exp_fob'+suffix]+df['cex_imp_fob'+suffix]
 dm=json.loads((fontes/'gold/downloads/manifesto.json').read_bytes());main=next(v for v in dm['arquivos']if v['id']=='painel_brasil_parquet');assert sha(fontes/main['caminho'])==main['sha256'];pop=pd.read_parquet(fontes/main['caminho'],columns=['cod_ibge','ano','sau_populacao']).set_index(['cod_ibge','ano']).sau_populacao
 for row in json.loads((fontes/'populacao_2026_sidra.json').read_bytes())[1:]:pop.loc[(int(row['D1C']),2026)]=int(row['V'])
 pop=pop.reindex(pd.MultiIndex.from_product([[m[0]for m in mun],years])).to_numpy().reshape(len(mun),len(years)).T
 pops=[]
 for key,pp in groups.items():
  sub=pop[:,pp];pops.append(np.where(np.isfinite(sub).any(axis=1),np.nansum(sub,axis=1),np.nan))
 df['cex_populacao']=np.array(pops).reshape(-1)
 df['cex_meses_ano']=[meta['periodos'][str(y)]for _,y in index];df['cex_meses_comuns']=cut
 defs=definicoes(meta);ids=[i['id']for i in defs];assert set(df)==set(ids),(set(df)-set(ids),set(ids)-set(df));df=df[ids]
 flags=pd.DataFrame(np.where(df.isna(),2,np.where(df.eq(0),1,0)),index=df.index,columns=ids,dtype='int8')
 flags.loc[df.cex_populacao.isna(),'cex_populacao']=3
 for flow in ['exp','imp']:
  for suffix,*_ in RAZOES:flags.loc[df[f'cex_{flow}_fob'].eq(0),f'cex_{flow}_{suffix}']=4
  flags.loc[df[f'cex_{flow}_ant_eq'].eq(0),f'cex_{flow}_var_pct']=4
  for id in [f'cex_{flow}_ant_eq',f'cex_{flow}_var_pct']:flags.loc[pd.IndexSlice[:,2013],id]=5
 # Ausência da classificação municipal não comprova zero comercializado.
 # Mantém população e meses nacionais como bases; não inventa operações.
 sem_tabela=[str(m[0])for m in smissing];sem_dados=[i for i in ids if i not in ['cex_populacao','cex_meses_ano','cex_meses_comuns']]
 df.loc[pd.IndexSlice[sem_tabela,:],sem_dados]=np.nan;flags.loc[pd.IndexSlice[sem_tabela,:],sem_dados]=2
 df.to_parquet(work/'agregados.parquet',compression='zstd');flags.add_suffix('_cond').to_parquet(work/'condicoes_agregados.parquet',compression='zstd')
 municipios=[str(m[0])for m in mun];grupos=municipios+sorted(knownufs)+['BR'];pos={k:j for j,k in enumerate(grupos)};ix=pd.MultiIndex.from_product([grupos,years],names=index.names)
 a=df.reindex(ix).to_numpy().reshape(len(grupos),len(years),len(ids)).transpose(1,0,2);c=flags.reindex(ix).to_numpy().reshape(len(grupos),len(years),len(ids)).transpose(1,0,2)
 quadros=[]
 def razao(id,n,d,pt,en,factor=100,unit='%',power=1):
  nmat=a[:,:len(mun),ids.index(n)].copy();dmat=a[:,:len(mun),ids.index(d)].copy();v,cc,dd=calcular_razao(nmat,dmat,factor,power);notes={str(y):[f'Janeiro a {MESES[cut-1]} de {y}: os mesmos meses em todos os anos.',f'January to {MONTHS[cut-1]} {y}: the same months in every year.']for y in years};description='Recorte comparável: janeiro a '+MESES[cut-1]+' em todos os anos. Concentração recalculada sobre o conjunto de produtos ou mercados do território, sem média de indicadores municipais. '+NOTA;description_en='Comparable window: January to '+MONTHS[cut-1]+' in every year. Concentration is recomputed from pooled products or markets, not averaged across municipalities. '+NOTA_EN
  di=dict(id=id,nome=pt,nome_en=en,descricao=description,descricao_en=description_en,tema='Valores por habitante'if d=='cex_populacao'else'Concentração de produtos e mercados',tema_en='Per-resident values'if d=='cex_populacao'else'Product and market concentration',unidade=unit,unidade_en='US$ FOB per resident'if unit=='US$ FOB por habitante'else'0–10,000 index'if factor==10000 else unit,formato='percentual'if unit=='%'else'numero',frequencia='anual',metodo_referencia='razao',normalizacao=pt,normalizacao_en=en,fator=factor,ranking=True,minimo=0,fonte_nome='MDIC/Secex · Comex Stat / IBGE',fontes=[dict(nome='MDIC/Secex · Comex Stat',url=FONTE),dict(nome='IBGE · população',url='https://sidra.ibge.gov.br/tabela/6579')],alerta=description,alerta_en=description_en,variavel_download='cex_'+id+('_c'if d!='cex_populacao'else''),numerador_id=n,denominador_id=d,numerador_nome=next(x['nome']for x in defs if x['id']==n),denominador_nome=('Quadrado de 'if power==2 else'')+next(x['nome']for x in defs if x['id']==d),denominador_potencia=power,tipo_periodo='anual',notas_anos=notes)
  q=QuadroComex(di,years,v,nmat,dd,cc);q.base=df;q.ncol=n;q.dcol=d;q.power=power;q.pop=pop;q.cobertos=np.array([m[0]in covered for m in mun]);quadros.append(q)
 for id,pt,en in [('exp','Exportações','Exports'),('imp','Importações','Imports'),('corrente','Corrente de comércio','Total trade')]:razao(id+'_hab','cex_'+id+'_fob_c','cex_populacao',pt+' por habitante · mesmos meses',en+' per resident · same months',1,'US$ FOB por habitante')
 for flow,pt,en in [('exp','Exportações','Exports'),('imp','Importações','Imports')]:
  for suffix,n,pt2,en2,factor,unit in RAZOES:razao(flow+'_'+suffix,f'cex_{flow}_{n}_c',f'cex_{flow}_fob_c',pt+' · '+pt2+' · mesmos meses',en+' · '+en2+' · same months',factor,unit,2 if suffix.startswith('hhi')else 1)
 assert len(quadros)==15
 countries=aux(fontes/'PAIS.csv');products=aux(fontes/'NCM_SH.csv');classes=dict(paises={str(int(r.CO_PAIS)):[r.NO_PAIS,r.NO_PAIS_ING]for r in countries.itertuples(index=False)},produtos={str(int(r.CO_SH4)).zfill(4):[r.NO_SH4_POR,r.NO_SH4_ING]for r in products.drop_duplicates('CO_SH4').itertuples(index=False)})
 unresolved_df=pd.DataFrame(unresolved,columns=['cod_ibge','uf']);db.register('sem_local',unresolved_df)
 residual=db.execute('SELECT t.grupo,t.ano,t.fluxo,sum(t.fob)::BIGINT fob,sum(t.kg)::BIGINT kg,count(*)registros FROM territorial t JOIN sem_local s USING(cod_ibge,uf)GROUP BY ALL').fetchdf();residual.to_parquet(work/'sem_municipio.parquet',index=False)
 quality=dict(linhas=db.execute('SELECT count(*)FROM fatos').fetchone()[0],codigos_sem_municipio=unresolved,municipios_sem_tabela=smissing,registros_sem_municipio=int(residual.loc[residual.grupo.eq('BR'),'registros'].sum()),registros_fob_negativo=int(negativos[0]),fob_negativo_preservado=int(negativos[1]),totais_oficiais_conferidos=True)
 from comex_artefatos import gerar_artefatos
 gerar_artefatos(fontes,saida,g,mun,grupos,pos,knownufs,groups,years,a,c,defs,quadros,{},meta,main,db,classes,quality)
 db.close()

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True);p.add_argument('--saida',required=True);a=p.parse_args();gerar(a.fontes,a.saida)
