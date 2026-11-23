"""Painel pronto de Segurança: SIM definitivo e Sinesp anual, em candidato isolado."""
import argparse,gzip,hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from types import SimpleNamespace
import numpy as np,pandas as pd
from comparacoes_base import Quadro,Gravador,numeros,compacto,sha
from seguranca_fontes import sha as arquivo_sha
from seguranca_definicoes import *

def destino_seguro(fontes,saida):
 fontes,saida=Path(fontes).resolve(),Path(saida).resolve()
 if saida==fontes or saida.is_relative_to(fontes)or fontes.is_relative_to(saida):raise ValueError('Destino sobreposto à origem')
 if saida.exists()and any(saida.iterdir()):raise ValueError('Use um candidato novo e vazio')
 return fontes,saida

def taxa(n,d,cn,cd,fator):
 with np.errstate(divide='ignore',invalid='ignore'):v=n/d*fator
 c=np.where(~np.isfinite(n),cn,np.where(~np.isfinite(d),3,np.where(d==0,4,np.where(v==0,1,0)))).astype('int8')
 v[(~np.isfinite(n))|(~np.isfinite(d))|(d<=0)]=np.nan
 for flag in [23,24]:v[cn==flag]=np.nan;c[cn==flag]=flag
 v[cn==11]=np.nan;c[cn==11]=24
 return v,c

def trienio(v,c):
 out=np.full_like(v,np.nan);flags=np.full(v.shape,5,dtype='int8')
 for k in range(2,len(v)):
  valid=np.isin(c[k-2:k+1],[0,1]).all(axis=0)&np.isfinite(v[k-2:k+1]).all(axis=0)
  out[k,valid]=v[k-2:k+1,valid].sum(axis=0);flags[k]=np.where(valid,np.where(out[k]==0,1,0),2)
 return out,flags

def gerar(fontes,saida):
 fontes,saida=destino_seguro(fontes,saida);g=json.loads((fontes/'geografia.json').read_bytes());municipios=g['municipios'];nmun=len(municipios);assert nmun==5571
 grupos=[str(m[0])for m in municipios]+[u for _,_,u in g['governos']]+['BR'];pos={v:j for j,v in enumerate(grupos)};ufs={u for _,_,u in g['governos']}
 sm=json.loads((fontes/'sim_seguranca.json').read_bytes());sn=json.loads((fontes/'sinesp_normalizado.json').read_bytes());assert sm['ok']and sn['ok']
 ANOS[:]=list(range(2013,max(max(sm['anos']),max(sn['anos']))+1))
 for ref in [sm['agregado'],sn['agregado'],sn['mensal']]:assert arquivo_sha(fontes/ref['arquivo'])==ref['sha256']
 defs=[]
 def add(id,n,en,familia,fonte='sim',unidade='óbitos',descricao='',helper=False):
  assert len(id+'_cond')<=32 and id not in [v['id']for v in defs]
  defs.append(dict(id=id,nome=n,nome_en=en,familia=familia,unidade=unidade,unidade_en={'óbitos':'deaths','vítimas':'victims','habitantes':'residents','pessoa-anos':'person-years','meses':'months','mandados':'warrants'}.get(unidade,unidade),fonte=fonte,fonte_nome='Ministério da Saúde · SIM'if fonte=='sim'else'Sinesp VDE · MJSP'if fonte=='sinesp'else'SVS/MS · população de referência (IBGE)',fonte_url=SIM_URL if fonte=='sim'else SINESP_URL if fonte=='sinesp'else'https://datasus.saude.gov.br/populacao-residente/',descricao=descricao or(NOTA_SIM if fonte=='sim'else NOTA_SINESP if fonte=='sinesp'else NOTA_BASE),descricao_en='Final SIM resident deaths; source-specific cause groups and unknown categories are retained. Crude rates are not age-standardised.'if fonte=='sim'else'State-reported police victim records, not SIM deaths. Complete annual rates require 12 valid months. Missing data and state-wide all-zero series are excluded from comparable rates.'if fonte=='sinesp'else'Reference population from SVS/MS (IBGE), consistent with Health. Missing denominators are retained.',anos=[],auxiliar=helper))
  if fonte=='sinesp' and unidade=='mandados':defs[-1]['descricao_en']+=' Executed warrants count recorded acts (total), not unique people or police effectiveness.'
 for id,i in SIM_DEFS.items():add(id,i['nome'],i['nome_en'],i['familia'],descricao=i['descricao'],helper=id in ['sec_ag_15_mais','sec_su_15_mais'])
 for id,(n,en,_)in SINESP.items():
  add('sec_sn_'+id,n+' · Sinesp',en+' · Sinesp','sinesp','sinesp','mandados'if id=='mandados'else'vítimas',NOTA_SINESP+(' Campo total: quantidade de mandados cumpridos, não pessoas únicas; não mede eficácia policial.'if id=='mandados'else' Não equivale ao recorte de óbitos do SIM.'if id=='transito'else''))
  add('sec_sn_'+id+'_meses','Meses válidos: '+n,'Valid months: '+en,'cobertura','sinesp','meses',NOTA_SINESP,True)
 for id in SINESP_MENSAIS:
  n,en,_=SINESP[id]
  for mes,(key,pt,eng)in enumerate(MESES,1):
   add(f'sec_sn_{id}_m_{key}',n+': '+pt+' · Sinesp',en+': '+eng+' · Sinesp','sn_'+id+'_mensal','sinesp','vítimas',NOTA_SINESP+' Mês de referência do registro policial; não comparar diretamente com o mês de falecimento do SIM.')
 add('sec_populacao','População de referência','Reference population','denominadores','populacao','habitantes',helper=True)
 add('sec_pop_3a','Soma das populações do triênio','Sum of three-year populations','trienios','populacao','pessoa-anos',helper=True)
 for id,(n,en,_)in CORE.items():add('sec_'+id+'_3a',n+': soma do triênio',en+': three-year total','trienios',helper=True)
 idx={i['id']:j for j,i in enumerate(defs)};a=np.full((len(ANOS),len(grupos),len(defs)),np.nan);c=np.full(a.shape,2,dtype='int8');residuos={}
 def put(y,id,key,value,flag=None):
  if str(key)not in pos or pd.isna(value):return
  k,j,loc=ANOS.index(int(y)),idx[id],pos[str(key)];a[k,loc,j]=float(value);c[k,loc,j]=flag if flag is not None else(1 if value==0 else 0)
 sx=pd.read_parquet(fontes/sm['agregado']['arquivo']);m6={int(m[0])//10:str(m[0])for m in municipios};sx['cod_ibge']=sx.municipio6.map(m6)
 for y in sm['anos']:
  z=sx[sx.ano==y];valid=[j for j,m in enumerate(municipios)if m[0]!=5101837]
  for id in SIM_DEFS:
   a[ANOS.index(y),valid,idx[id]]=0;c[ANOS.index(y),valid,idx[id]]=1
   for key,v in z[z.cod_ibge.notna()].groupby('cod_ibge')[id].sum().items():put(y,id,key,v)
   for key,v in z.groupby('uf')[id].sum().items():put(y,id,key,v)
   put(y,id,'BR',z[id].sum())
  residuos[str(y)]={id:int(z.loc[z.cod_ibge.isna(),id].sum())for id in ['sec_'+k for k in CORE]}
 sx=pd.read_parquet(fontes/sn['agregado']['arquivo'])
 for row in sx.itertuples(index=False):
  if pd.notna(row.cod_ibge):
   put(row.ano,'sec_sn_'+row.id,int(row.cod_ibge),row.valor,int(row.condicao));put(row.ano,'sec_sn_'+row.id+'_meses',int(row.cod_ibge),row.meses)
 for(y,id),z in sx.groupby(['ano','id']):
  for key,sub in [(u,z[z.uf==u])for u in sorted(ufs)]+[('BR',z)]:
   if sub.empty:continue
   v=sub.valor.sum(min_count=1);valid=int(sub.loc[sub.cod_ibge.notna()&sub.valor.notna(),'cod_ibge'].nunique());expected=sum(key=='BR'or m[2]==key for m in municipios)
   flag=23 if pd.notna(v)and v==0 else 11 if(sub.meses<12).any()else 16 if valid<expected else None
   put(y,'sec_sn_'+id,key,v,flag);put(y,'sec_sn_'+id+'_meses',key,sub.meses.min())
 monthly=pd.read_parquet(fontes/sn['mensal']['arquivo'])
 for row in monthly[monthly.id.isin(SINESP_MENSAIS)].itertuples(index=False):
  if pd.notna(row.cod_ibge):put(row.ano,f'sec_sn_{row.id}_m_{MESES[row.mes-1][0]}',int(row.cod_ibge),row.valor,int(row.condicao))
 for(y,id,mes),z in monthly[monthly.id.isin(SINESP_MENSAIS)].groupby(['ano','id','mes']):
  for key,sub in [(u,z[z.uf==u])for u in sorted(ufs)]+[('BR',z)]:
   if sub.empty:continue
   v=sub.valor.sum(min_count=1);valid=int(sub.loc[sub.cod_ibge.notna()&sub.valido,'cod_ibge'].nunique());expected=sum(key=='BR'or m[2]==key for m in municipios)
   flag=23 if pd.notna(v)and v==0 and sub.condicao.eq(23).all()else 11 if(~sub.valido).any()else 16 if valid<expected else None
   put(y,f'sec_sn_{id}_m_{MESES[mes-1][0]}',key,v,flag)
 dm=json.loads((fontes/'gold/downloads/manifesto.json').read_bytes());main=next(v for v in dm['arquivos']if v['id']=='painel_brasil_parquet');assert arquivo_sha(fontes/main['caminho'])==main['sha256']
 pop=pd.read_parquet(fontes/main['caminho'],columns=['cod_ibge','ano','uf','sau_populacao'])
 for y in ANOS:
  z=pop[(pop.ano==y)&pop.sau_populacao.notna()]
  for key,v in z.set_index('cod_ibge').sau_populacao.items():put(y,'sec_populacao',key,v)
  for key,v in z.groupby('uf').sau_populacao.sum().items():put(y,'sec_populacao',key,v)
  put(y,'sec_populacao','BR',z.sau_populacao.sum())
 for out,base in [('sec_pop_3a','sec_populacao')]+[('sec_'+id+'_3a','sec_'+id)for id in CORE]:a[:,:,idx[out]],c[:,:,idx[out]]=trienio(a[:,:,idx[base]],c[:,:,idx[base]])
 for j,i in enumerate(defs):i['anos']=[y for k,y in enumerate(ANOS)if np.isfinite(a[k,:,j]).any()]
 quadros=[]
 def razao(id,n,d,nome,en,tema,fator=100,unidade='%',periodos=None):
  ni,di=idx[n],idx[d];pp=(periodos or sn['anos'])if defs[ni]['fonte']=='sinesp'else(periodos or sm['anos']);yy=[ANOS.index(y)for y in pp]
  nn,dd=a[yy,:nmun,ni],a[yy,:nmun,di];vv,cc=taxa(nn,dd,c[yy,:nmun,ni],c[yy,:nmun,di],fator)
  descricao=NOTA_BASE+' '+defs[ni]['descricao']
  if '_3a'in n:descricao+=' Taxa anual média do triênio encerrado no ano selecionado = soma dos óbitos dos três anos / soma das populações dos mesmos anos × 100 mil. Exige os três anos completos.'
  definition=dict(id=id,nome=nome,nome_en=en,descricao=descricao,descricao_en='Same-year valid municipal pairs; regions use ratios of sums. Source counts may include unidentified municipalities. '+('Annual Sinesp rates require 12 valid months; state-wide all-zero series are flagged and excluded.'if defs[ni]['fonte']=='sinesp'else'These are crude resident mortality rates or shares of recorded deaths, not age-standardised or group-specific risks.')+(' Three-year mean annual rate = sum of deaths / sum of populations × 100,000; requires three complete years.'if '_3a'in n else''),tema=tema,tema_en={'Mortalidade no SIM':'SIM mortality','Triênios':'Three-year rates','Armas de fogo':'Firearms','Meios das agressões':'Means of assault','Registros policiais':'Police records','Raça/cor':'Race/colour','Sexo':'Sex','Idade':'Age','Escolaridade':'Schooling','Local do falecimento':'Place of death'}[tema],unidade=unidade,unidade_en='per 100,000 residents'if fator==100000 else'%',formato='percentual'if unidade=='%'else'numero',frequencia='anual',metodo_referencia='razao',normalizacao=nome,normalizacao_en=en,fator=fator,ranking=True,minimo=0,fonte_nome=defs[ni]['fonte_nome'],fontes=[dict(nome=defs[ni]['fonte_nome'],url=defs[ni]['fonte_url'])],alerta='Taxas brutas. Contagens pequenas oscilam; use também o triênio. SIM registra óbitos de moradores; Sinesp registra vítimas informadas pela polícia. Um não substitui o outro.',alerta_en='Crude rates. Small counts fluctuate; inspect three-year rates too. SIM records resident deaths; Sinesp contains police-reported victims. They are distinct sources.',variavel_download='sec_'+id,numerador_id=n,denominador_id=d,numerador_nome=defs[ni]['nome']+' ('+defs[ni]['unidade']+')',denominador_nome=defs[di]['nome']+' ('+defs[di]['unidade']+')')
  assert len(definition['variavel_download']+'_cond')<=32
  quadros.append(Quadro(definition,pp,vv,nn,dd,cc))
 for id,(n,en,_)in CORE.items():
  razao(id+'_100mil','sec_'+id,'sec_populacao',n+' por 100 mil habitantes',en+' per 100,000 residents','Mortalidade no SIM',100000,'por 100 mil habitantes')
  razao(id+'_3a_100mil','sec_'+id+'_3a','sec_pop_3a',n+': taxa média do triênio',en+': three-year mean annual rate','Triênios',100000,'por 100 mil habitantes')
 for id,(n,en,_)in SINESP.items():razao('sn_'+id+'_100mil','sec_sn_'+id,'sec_populacao',n+' por 100 mil · Sinesp',en+' per 100,000 · Sinesp','Registros policiais',100000,'por 100 mil habitantes')
 for pre,label,label_en,den in [('ag','Agressão','Assault','sec_agressoes'),('su','Suicídio','Suicide','sec_suicidios')]:
  for tipo,items,tema in [('sex',SEXOS,'Sexo'),('id',IDADES,'Idade')]:
   for id,n,en,*_ in items:razao(f'{pre}_{tipo}_{id}_pct',f'sec_{pre}_{tipo}_{id}',den,label+': '+n+' (%)',label_en+': '+en+' (%)',tema)
 for tipo,items,den,tema in [('rc',RACAS,'sec_agressoes','Raça/cor'),('esc',ESCOLAS,'sec_ag_15_mais','Escolaridade'),('loc',LOCAIS,'sec_agressoes','Local do falecimento')]:
  for id,n,en,*_ in items:razao(f'ag_{tipo}_{id}_pct',f'sec_ag_{tipo}_{id}',den,'Agressão: '+n+' (%)','Assault: '+en+' (%)',tema)
 for pre,den,n,en in [('ag','sec_agressoes','Arma de fogo entre as agressões','Firearms among assault deaths'),('su','sec_suicidios','Arma de fogo entre os suicídios','Firearms among suicide deaths')]:razao(pre+'_armas_pct','sec_'+pre+'_armas',den,n,en,'Armas de fogo')
 for id,n,en,_ in MEIOS_AG:razao('ag_meio_'+id+'_pct','sec_ag_meio_'+id,'sec_agressoes','Agressão: '+n+' (%)','Assault: '+en+' (%)','Meios das agressões')
 for tipo,items,den,tema in [('rc',RACAS,'sec_suicidios','Raça/cor'),('esc',ESCOLAS,'sec_su_15_mais','Escolaridade'),('loc',LOCAIS,'sec_suicidios','Local do falecimento')]:
  for id,n,en,*_ in items:razao(f'su_{tipo}_{id}_pct',f'sec_su_{tipo}_{id}',den,'Suicídio: '+n+' (%)','Suicide: '+en+' (%)',tema)
 dv=np.full((len(ANOS),len(grupos),len(quadros)),np.nan);dc=np.full(dv.shape,2,dtype='int8');dn=np.full_like(dv,np.nan);dd=np.full_like(dv,np.nan);dq=np.zeros(dv.shape,dtype='int16')
 groups={key:[j for j,m in enumerate(municipios)if key==str(m[0])or key==m[2]or key=='BR'or key=='I:'+m[3]or key=='T:'+m[4]]for key,t in g['territorios'].items()if t['nivel']in ['M','UF','BR','imediata','intermediaria']}
 for j,q in enumerate(quadros):
  for key in grupos:
   v=q.grupo(groups[key],municipio=len(key)==7);loc=pos[key]
   for k,y in enumerate(q.periodos):
    dest=ANOS.index(y)
    for out,field in [(dv,'v'),(dn,'n'),(dd,'d')]:out[dest,loc,j]=np.nan if v[field][k]is None else v[field][k]
    dc[dest,loc,j]=v['c'][k];dq[dest,loc,j]=v['q'][k]
 dest=saida/'gold/seguranca';dest.mkdir(parents=True)
 def objeto(area,nome,v,zip=False):
  body=compacto(v);b=gzip.compress(body,mtime=0)if zip else body;h=sha(b);p=saida/'gold'/area/(nome+'_'+h[:16]+('.json.gz'if zip else'.json'));p.parent.mkdir(exist_ok=True);p.write_bytes(b)
  return dict(caminho=p.relative_to(saida).as_posix(),bytes=len(b),sha256=h,**(dict(json_bytes=len(body),json_sha256=sha(body))if zip else{}))
 indices={};maxslice=0
 for bucket in [*sorted(ufs),'referencias']:
  keys=[key for key in grupos if(g['territorios'][key]['uf']if len(key)==7 else'referencias')==bucket];temp=dest/f'tmp_{bucket}.ndjson';entries={}
  with temp.open('wb')as f:
   for key in keys:
    loc=pos[key];body=compacto(dict(versao=1,grupo=key,anos=ANOS,valores=[numeros(r)for r in a[:,loc]],condicoes=c[:,loc].tolist(),derivados=[numeros(r)for r in dv[:,loc]],condicoes_derivados=dc[:,loc].tolist(),numeradores=[numeros(r)for r in dn[:,loc]],denominadores=[numeros(r)for r in dd[:,loc]],coberturas=dq[:,loc].tolist(),residuos=residuos if len(key)!=7 else{}))+b'\n';entries[key]=[f.tell(),len(body),sha(body)];f.write(body);maxslice=max(maxslice,len(body))
  h=arquivo_sha(temp);p=dest/f'series_{bucket.lower()}_{h[:16]}.ndjson';temp.rename(p);indices[bucket]=objeto('seguranca','indice_'+bucket.lower(),dict(versao=1,arquivo=dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=h),grupos=entries))
 cat=objeto('seguranca','catalogo',dict(versao=1,anos=ANOS,indicadores=defs,derivados=[dict(q.definicao,periodos=q.periodos)for q in quadros],condicoes=CONDICOES),True);geo=objeto('seguranca','geografia',g,True)
 m=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=ANOS,catalogo=cat,geografia=geo,indices=indices,variaveis=len(defs),calculados=len(quadros),territorios=len(grupos),max_trecho_bytes=maxslice,ultimos={'sim':max(sm['anos']),'sinesp':max(sn['anos']),'populacao':int(pop.loc[pop.sau_populacao.notna(),'ano'].max())},origens={'sim':arquivo_sha(fontes/'sim_seguranca.json'),'sinesp':arquivo_sha(fontes/'sinesp_normalizado.json'),'populacao':main['sha256']},notas=[NOTA_SIM,NOTA_SINESP,NOTA_BASE]);(dest/'manifesto.json').write_bytes(compacto(m))
 data={'cod_ibge':np.tile([m[0]for m in municipios],len(ANOS)),'ano':np.repeat(ANOS,nmun),'municipio':np.tile([m[1]for m in municipios],len(ANOS)),'uf':np.tile([m[2]for m in municipios],len(ANOS))}
 for j,i in enumerate(defs):data[i['id']]=a[:,:nmun,j].reshape(-1);data[i['id']+'_cond']=c[:,:nmun,j].reshape(-1)
 for j,q in enumerate(quadros):id=q.definicao['variavel_download'];data[id]=dv[:,:nmun,j].reshape(-1);data[id+'_cond']=dc[:,:nmun,j].reshape(-1)
 work=saida/'trabalho_seguranca';work.mkdir();pd.DataFrame(data).sort_values(['cod_ibge','ano']).to_parquet(work/'municipios.parquet',index=False,compression='zstd')
 go=SimpleNamespace(municipios=municipios,territorios=g['territorios'],governos=g['governos'],grupos=groups,buckets={k:t['uf']if t['nivel']=='M'else'referencias'for k,t in g['territorios'].items()})
 root=json.loads((fontes/'gold/comparacoes/manifesto.json').read_bytes());writer=Gravador(saida,go,fontes,{});writer.georef=root['geografia'];writer.area('seguranca',quadros,dict(caminho='gold/seguranca/manifesto.json',sha256=arquivo_sha(dest/'manifesto.json')));root['catalogos'].update(writer.catalogos);root['origens']['gold/seguranca/manifesto.json']=dict(bytes=(dest/'manifesto.json').stat().st_size,sha256=arquivo_sha(dest/'manifesto.json'));root['gerado_em']=m['gerado_em'];(saida/'gold/comparacoes/manifesto.json').write_bytes(compacto(root))
 gerar_mapas(saida,municipios,quadros,m,objeto)
 report=dict(ok=True,originais=len(defs),relativos=len(quadros),territorios=len(grupos),max_trecho_bytes=maxslice,anos=ANOS);(work/'auditoria_geracao.json').write_bytes(compacto(report));print(json.dumps(report),flush=True)

def gerar_mapas(saida,municipios,quadros,m,objeto):
 from mapas_indicadores import escala
 dest=saida/'gold/mapas';dest.mkdir(exist_ok=True);cad=objeto('mapas','cadastro_seguranca',dict(versao=1,municipios=[m[:3]for m in municipios]));temp=dest/'temp_seguranca.ndjson';indices=[];definitions=[]
 with temp.open('wb')as f:
  for q in quadros:
   tr={}
   for k,y in enumerate(q.periodos):
    start=f.tell();h=hashlib.sha256()
    for uf in sorted({m[2]for m in municipios}):
     pp=[j for j,m in enumerate(municipios)if m[2]==uf];b=compacto(dict(versao=1,area='seguranca',rede='todas',indicador=q.definicao['id'],ano=y,uf=uf,cadastro=cad['sha256'],quantidade=len(pp),valores=numeros(q.valores[k,pp]),numeradores=numeros(q.numeradores[k,pp]),denominadores=numeros(q.denominadores[k,pp]),condicoes=q.condicoes[k,pp].tolist()))+b'\n';tr[f'{y}:{uf}']=[f.tell(),len(b),sha(b)];f.write(b);h.update(b)
    tr[f'{y}:BR']=[start,f.tell()-start,h.hexdigest()]
   indices.append((q,tr))
 h=arquivo_sha(temp);p=dest/f'seguranca_todas_dados_{h[:16]}.ndjson';temp.rename(p);ref=dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=h)
 for q,tr in indices:
  i=q.definicao;index=objeto('mapas','seguranca_todas_'+i['id']+'_indice',dict(versao=1,area='seguranca',rede='todas',indicador=i['id'],cadastro=cad['sha256'],arquivo=ref,recortes=tr))
  definitions.append({**{k:v for k,v in i.items()if k in ['id','nome','nome_en','descricao','descricao_en','tema','tema_en','unidade','unidade_en','formato','fonte_nome','fontes','alerta','alerta_en','numerador_nome','denominador_nome','minimo']},'fonte_nome_en':i['fonte_nome'],'territorio':'SIM: residência; Sinesp: município do registro policial','territorio_en':'SIM: residence; Sinesp: reported police location','numerador_nome_en':i['numerador_nome'],'denominador_nome_en':i['denominador_nome'],'anos':q.periodos,'anos_com_valor':[y for k,y in enumerate(q.periodos)if np.isfinite(q.valores[k]).any()],'escala':escala(q.valores,i['formato']),'indice':index})
 (dest/'seguranca_manifesto.json').write_bytes(compacto(dict(versao=1,area='seguranca',rede='todas',gerado_em=m['gerado_em'],cadastro=cad,indicadores=definitions,origem=dict(tipo='seguranca',caminho='gold/seguranca/manifesto.json',sha256=arquivo_sha(saida/'gold/seguranca/manifesto.json'),gerado_em=m['gerado_em']))))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True);p.add_argument('--saida',required=True);a=p.parse_args();gerar(a.fontes,a.saida)
