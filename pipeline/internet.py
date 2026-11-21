"""Painel Anatel pré-calculado, com retratos anuais e estoques mensais desde 2013."""
import argparse,gzip,hashlib,json
from datetime import datetime,timezone
from pathlib import Path
from types import SimpleNamespace
import numpy as np,pandas as pd
from comparacoes_base import Quadro,Gravador,numeros,compacto,sha
from internet_fontes import sha as arquivo_sha
from internet_definicoes import *

def destino_seguro(fontes,saida):
 fontes,saida=Path(fontes).resolve(),Path(saida).resolve()
 if saida==fontes or saida.is_relative_to(fontes)or fontes.is_relative_to(saida):raise ValueError('Destino sobreposto à origem')
 if saida.exists()and any(saida.iterdir()):raise ValueError('Use um candidato novo e vazio')
 return fontes,saida

def taxa(n,d,cn,fator):
 with np.errstate(divide='ignore',invalid='ignore'):v=n/d*fator
 c=np.where(~np.isfinite(n),cn,np.where(~np.isfinite(d),3,np.where(d==0,4,np.where(v==0,1,0)))).astype('int8')
 v[(~np.isfinite(n))|(~np.isfinite(d))|(d<=0)]=np.nan
 return v,c

class QuadroMercado(Quadro):
 """Concentração agregada por CNPJ, nunca média das concentrações locais."""
 def grupo_territorio(self,key,pos,municipio=False,incluir_ressalvas=False):
  if municipio:return super().grupo(pos,True,incluir_ressalvas)
  out=dict(v=[],n=[],d=[],c=[],q=[])
  for k,y in enumerate(self.periodos):
   row=self.mercado.get((int(y),str(key)));q=int(np.isfinite(self.valores[k,pos]).sum())
   total=float(row.total)if row is not None else None
   n=(float(row.lider)if self.tipo=='lider'else float(row.quadrados))if row is not None and pd.notna(row.lider)else None
   d=total if self.tipo=='lider'else total**2 if total is not None else None
   flag=2 if n is None or row.sem_cnpj>0 else 4 if not d else 16 if q<len(pos)else 1 if n==0 else 0
   v=n/d*self.definicao['fator']if flag in [0,1,16]and d and row.sem_cnpj==0 else None
   for field,val in [('v',v),('n',n),('d',d),('c',flag),('q',q)]:out[field].append(val)
  return out

def gerar(fontes,saida):
 fontes,saida=destino_seguro(fontes,saida);g=json.loads((fontes/'geografia.json').read_bytes());municipios=g['municipios'];nmun=len(municipios);assert nmun==5571
 sm=json.loads((fontes/'anatel_normalizado.json').read_bytes());assert sm['ok']
 for ref in sm['agregados'].values():assert arquivo_sha(fontes/ref['arquivo'])==ref['sha256']
 ANOS=sorted(map(int,sm['referencias']));refs={int(y):p for y,p in sm['referencias'].items()}
 assert all(p%100==12 for y,p in refs.items()if y<max(ANOS))
 grupos=[str(m[0])for m in municipios]+[u for _,_,u in g['governos']]+['BR'];pos={v:j for j,v in enumerate(grupos)};ufs={u for _,_,u in g['governos']}
 groups={key:[j for j,m in enumerate(municipios)if key==str(m[0])or key==m[2]or key=='BR'or key=='I:'+str(m[3])or key=='T:'+str(m[4])]for key,t in g['territorios'].items()if t['nivel']in ['M','UF','BR','imediata','intermediaria']}
 notes={str(y):[f'Retrato de {p%100:02d}/{y}: acessos ativos no mês, não soma anual.',f'{p%100:02d}/{y} snapshot: active monthly subscriptions, not an annual sum.']for y,p in refs.items()}
 defs=[]
 def add(id,n,en,fam,un='acessos',helper=False,desc=None,**extra):
  assert len(id+'_cond')<=32
  defs.append(dict(id=id,nome=n,nome_en=en,familia=fam,unidade=un,unidade_en={'acessos':'subscriptions','habitantes':'residents','CNPJs':'reporting companies','mês':'month'}.get(un,un),fonte='anatel',fonte_nome='Anatel · banda larga fixa (SCM)',fonte_url=URL,descricao=desc or NOTA_ANATEL,descricao_en=NOTA_EN,anos=[],auxiliar=helper,**extra))
 add('int_acessos','Acessos de banda larga fixa','Fixed broadband subscriptions','acessos')
 for pre,items in GRUPOS.items():
  for id,pt,en in items:add(f'int_{pre}_{id}',pt,en,pre,desc=NOTA_ANATEL+(' Categorias oficiais da faixa; não inferir 100 Mbps da faixa acima de 34 Mbps.'if pre=='faixa'else' 1 Gbps ou mais é subconjunto de 100 Mbps ou mais; não somar essas duas faixas.'if pre=='vel'else''))
 add('int_prestadoras','Prestadoras declarantes','Reporting providers','mercado','CNPJs',desc=NOTA_MERCADO)
 add('int_lider','Acessos da maior declarante','Largest reporting company subscriptions','mercado',helper=True,desc=NOTA_MERCADO)
 add('int_quadrados','Soma dos quadrados dos acessos por declarante','Sum of squared subscriptions by reporting company','mercado','acessos²',True,NOTA_MERCADO)
 add('int_populacao','População de referência','Reference population','bases','habitantes',True,'IBGE/SVS, mesma base demográfica do painel até 2025; estimativa municipal IBGE/SIDRA 6579 de julho de 2026. Não é número de assinantes.')
 defs[-1].update(fonte_nome='IBGE / SVS · população de referência',fonte_url=POP_URL)
 add('int_mes_ref','Mês do retrato anual','Annual snapshot reference month','bases','mês',True,NOTA_BASE)
 for m,(key,pt,en)in enumerate(MESES,1):add('int_mes_'+key,'Acessos em '+pt,'Subscriptions in '+en,'mensal',mes_fixo=m)
 idx={i['id']:j for j,i in enumerate(defs)};a=np.full((len(ANOS),len(grupos),len(defs)),np.nan);c=np.full(a.shape,2,dtype='int8');residuos={}
 def put(y,id,key,value,flag=None):
  if str(key)not in pos or pd.isna(value):return
  k,j,loc=ANOS.index(int(y)),idx[id],pos[str(key)];a[k,loc,j]=float(value);c[k,loc,j]=flag if flag is not None else(1 if value==0 else 0)
 sx=pd.read_parquet(fontes/sm['agregados']['municipio_mensal']['arquivo']);valid_codes={m[0]:m[2]for m in municipios}
 bad=sx.cod_ibge.map(valid_codes).ne(sx.uf);sx.loc[bad,'cod_ibge']=np.nan
 for y in ANOS:
  zz=sx[sx.periodo==refs[y]];source=[id for id in idx if id in sx]
  for row in zz[zz.cod_ibge.notna()].itertuples(index=False):
   for id in source:put(y,id,int(row.cod_ibge),getattr(row,id))
  for key,z in [(u,zz[zz.uf==u])for u in sorted(ufs)]+[('BR',zz)]:
   count=int(z.loc[z.cod_ibge.notna(),'cod_ibge'].nunique());expected=len(groups[key])
   for id in source:put(y,id,key,z[id].sum(min_count=1),16 if count<expected or z.cod_ibge.isna().any()else None)
  residues=zz.loc[zz.cod_ibge.isna(),'int_acessos'].sum();residuos[str(y)]=int(residues)
  for id in idx:
   field='pessoa'if id.startswith('int_pessoa_')else'velocidade'if id.startswith('int_vel_')else None
   if field and not sm['campos'][str(refs[y])][field]:c[ANOS.index(y),:,idx[id]]=5
  for m,(key,_,_)in enumerate(MESES,1):
   p=y*100+m;id='int_mes_'+key
   if p not in sm['periodos']:c[ANOS.index(y),:,idx[id]]=5;continue
   z=sx[sx.periodo==p]
   for row in z[z.cod_ibge.notna()].itertuples(index=False):put(y,id,int(row.cod_ibge),row.int_acessos)
   for group,sub in [(u,z[z.uf==u])for u in sorted(ufs)]+[('BR',z)]:put(y,id,group,sub.int_acessos.sum(min_count=1),16 if sub.cod_ibge.nunique()<len(groups[group])or sub.cod_ibge.isna().any()else None)
  for group in grupos:put(y,'int_mes_ref',group,refs[y]%100)
 market=pd.read_parquet(fontes/sm['agregados']['mercado_referencias']['arquivo']);lookup={(int(r.periodo)//100,str(r.grupo)):r for r in market.itertuples(index=False)}
 for row in market.itertuples(index=False):
  for id,val in [('int_prestadoras',row.int_prestadoras),('int_lider',row.lider),('int_quadrados',row.quadrados)]:put(row.periodo//100,id,row.grupo,val,16 if row.sem_cnpj>0 else None)
 dm=json.loads((fontes/'gold/downloads/manifesto.json').read_bytes());main=next(v for v in dm['arquivos']if v['id']=='painel_brasil_parquet');assert arquivo_sha(fontes/main['caminho'])==main['sha256']
 pop=pd.read_parquet(fontes/main['caminho'],columns=['cod_ibge','ano','uf','sau_populacao'])
 for row in pop[pop.sau_populacao.notna()].itertuples(index=False):put(row.ano,'int_populacao',row.cod_ibge,row.sau_populacao)
 p26=json.loads((fontes/'populacao_2026_sidra.json').read_bytes());assert len(p26)==5572
 for row in p26[1:]:
  assert row['D3C']=='2026'and row['D2C']=='9324'and row['V'].isdigit();put(2026,'int_populacao',row['D1C'],int(row['V']))
 for key in [*sorted(ufs),'BR']:
  for k,y in enumerate(ANOS):put(y,'int_populacao',key,np.nansum(a[k,groups[key],idx['int_populacao']])if np.isfinite(a[k,groups[key],idx['int_populacao']]).any()else np.nan)
 assert a[-1,pos['BR'],idx['int_populacao']]==214211951
 for j,i in enumerate(defs):i['anos']=[y for k,y in enumerate(ANOS)if np.isfinite(a[k,:,j]).any()]
 quadros=[]
 def razao(id,n,d,pt,en,tema,fator=100,unidade='%',market_kind=None):
  ni,di=idx[n],idx[d];pp=defs[ni]['anos'];yy=[ANOS.index(y)for y in pp];nn=a[yy,:nmun,ni].copy();dd=a[yy,:nmun,di].copy()
  if market_kind=='hhi':dd=dd**2
  vv,cc=taxa(nn,dd,c[yy,:nmun,ni],fator)
  if market_kind:
   for k,y in enumerate(pp):
    for j,m in enumerate(municipios):
     row=lookup.get((y,str(m[0])))
     if row is not None and row.sem_cnpj>0:vv[k,j]=np.nan;cc[k,j]=2
  definition=dict(id=id,nome=pt,nome_en=en,descricao=NOTA_BASE+' '+(NOTA_MERCADO if market_kind else NOTA_ANATEL),descricao_en=NOTA_EN+(' Regional concentration is computed after grouping subscriptions by reporting CNPJ, not averaging local shares or indices.'if market_kind else' Regions use ratios of sums over municipalities with both valid components.'),tema=tema,tema_en=tema,unidade=unidade,unidade_en='per 100 residents'if fator==100 and unidade!='%'else unidade,formato='percentual'if unidade=='%'else'numero',frequencia='anual',metodo_referencia='razao',normalizacao=pt,normalizacao_en=en,fator=fator,ranking=True,minimo=0,fonte_nome='Anatel / IBGE',fontes=[dict(nome='Anatel · SCM',url=URL),dict(nome='IBGE · população',url=POP_URL)],alerta='Acessos não são pessoas ou domicílios únicos; velocidades são contratadas. Compare o mês de referência de cada ano.',alerta_en='Subscriptions are not unique people or households; speeds are contracted. Check each year’s reference month.',variavel_download='int_'+id,numerador_id=n,denominador_id=d,numerador_nome=defs[ni]['nome'],denominador_nome=('Quadrado de: 'if market_kind=='hhi'else'')+defs[di]['nome'],notas_anos=notes)
  if market_kind=='hhi':definition['denominador_potencia']=2
  q=(QuadroMercado if market_kind else Quadro)(definition,pp,vv,nn,dd,cc)
  if market_kind:q.mercado=lookup;q.tipo=market_kind
  quadros.append(q)
 razao('acessos_100hab','int_acessos','int_populacao','Banda larga fixa por 100 habitantes','Fixed broadband per 100 residents','Acesso',100,'por 100 habitantes')
 for pre,items in GRUPOS.items():
  for id,pt,en in items:razao(f'{pre}_{id}_pct',f'int_{pre}_{id}','int_acessos',pt+' (%)',en+' (%)',{'meio':'Meio de acesso','faixa':'Faixa de velocidade','porte':'Porte da prestadora','pessoa':'Titular da assinatura','vel':'Velocidade contratada'}[pre])
 razao('lider_pct','int_lider','int_acessos','Participação da maior declarante','Largest reporting company share','Prestadoras',market_kind='lider')
 razao('hhi','int_quadrados','int_acessos','Concentração entre declarantes (HHI)','Concentration among reporting companies (HHI)','Prestadoras',10000,'índice de 0 a 10.000','hhi')
 # Escrita CAS, mapas e comparações: mesmo contrato das demais áreas.
 gerar_artefatos(fontes,saida,g,municipios,grupos,pos,ufs,groups,ANOS,a,c,defs,quadros,residuos,refs,sm,main)

def gerar_artefatos(fontes,saida,g,municipios,grupos,pos,ufs,groups,ANOS,a,c,defs,quadros,residuos,refs,sm,main):
 nmun=len(municipios)
 dv=np.full((len(ANOS),len(grupos),len(quadros)),np.nan);dc=np.full(dv.shape,2,dtype='int8');dn=np.full_like(dv,np.nan);dd=np.full_like(dv,np.nan);dq=np.zeros(dv.shape,dtype='int16')
 groups={key:[j for j,m in enumerate(municipios)if key==str(m[0])or key==m[2]or key=='BR'or key=='I:'+m[3]or key=='T:'+m[4]]for key,t in g['territorios'].items()if t['nivel']in ['M','UF','BR','imediata','intermediaria']}
 for j,q in enumerate(quadros):
  for key in grupos:
   v=q.grupo_territorio(key,groups[key],municipio=len(key)==7);loc=pos[key]
   for k,y in enumerate(q.periodos):
    dest=ANOS.index(y)
    for out,field in [(dv,'v'),(dn,'n'),(dd,'d')]:out[dest,loc,j]=np.nan if v[field][k]is None else v[field][k]
    dc[dest,loc,j]=v['c'][k];dq[dest,loc,j]=v['q'][k]
 dest=saida/'gold/internet';dest.mkdir(parents=True)
 def objeto(area,nome,v,zip=False):
  body=compacto(v);b=gzip.compress(body,mtime=0)if zip else body;h=sha(b);p=saida/'gold'/area/(nome+'_'+h[:16]+('.json.gz'if zip else'.json'));p.parent.mkdir(exist_ok=True);p.write_bytes(b)
  return dict(caminho=p.relative_to(saida).as_posix(),bytes=len(b),sha256=h,**(dict(json_bytes=len(body),json_sha256=sha(body))if zip else{}))
 indices={};maxslice=0
 for bucket in [*sorted(ufs),'referencias']:
  keys=[key for key in grupos if(g['territorios'][key]['uf']if len(key)==7 else'referencias')==bucket];temp=dest/f'tmp_{bucket}.ndjson';entries={}
  with temp.open('wb')as f:
   for key in keys:
    loc=pos[key];body=compacto(dict(versao=1,grupo=key,anos=ANOS,valores=[numeros(r)for r in a[:,loc]],condicoes=c[:,loc].tolist(),derivados=[numeros(r)for r in dv[:,loc]],condicoes_derivados=dc[:,loc].tolist(),numeradores=[numeros(r)for r in dn[:,loc]],denominadores=[numeros(r)for r in dd[:,loc]],coberturas=dq[:,loc].tolist(),residuos=residuos if len(key)!=7 else{}))+b'\n';entries[key]=[f.tell(),len(body),sha(body)];f.write(body);maxslice=max(maxslice,len(body))
  h=arquivo_sha(temp);p=dest/f'series_{bucket.lower()}_{h[:16]}.ndjson';temp.rename(p);indices[bucket]=objeto('internet','indice_'+bucket.lower(),dict(versao=1,arquivo=dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=h),grupos=entries))
 cat=objeto('internet','catalogo',dict(versao=1,anos=ANOS,indicadores=defs,derivados=[dict(q.definicao,periodos=q.periodos)for q in quadros],condicoes=CONDICOES),True);geo=objeto('internet','geografia',g,True)
 m=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=ANOS,catalogo=cat,geografia=geo,indices=indices,variaveis=len(defs),calculados=len(quadros),territorios=len(grupos),max_trecho_bytes=maxslice,ultimos={'anatel':max(ANOS)},referencias=refs,origens={'anatel':arquivo_sha(fontes/'anatel_normalizado.json'),'populacao':main['sha256'],'populacao_2026':arquivo_sha(fontes/'populacao_2026_sidra.json')},notas=[NOTA_ANATEL,NOTA_BASE,NOTA_MERCADO]);(dest/'manifesto.json').write_bytes(compacto(m))
 data={'cod_ibge':np.tile([m[0]for m in municipios],len(ANOS)),'ano':np.repeat(ANOS,nmun),'municipio':np.tile([m[1]for m in municipios],len(ANOS)),'uf':np.tile([m[2]for m in municipios],len(ANOS))}
 for j,i in enumerate(defs):data[i['id']]=a[:,:nmun,j].reshape(-1);data[i['id']+'_cond']=c[:,:nmun,j].reshape(-1)
 for j,q in enumerate(quadros):id=q.definicao['variavel_download'];data[id]=dv[:,:nmun,j].reshape(-1);data[id+'_cond']=dc[:,:nmun,j].reshape(-1)
 work=saida/'trabalho_internet';work.mkdir();pd.DataFrame(data).sort_values(['cod_ibge','ano']).to_parquet(work/'municipios.parquet',index=False,compression='zstd')
 go=SimpleNamespace(municipios=municipios,territorios=g['territorios'],governos=g['governos'],grupos=groups,buckets={k:t['uf']if t['nivel']=='M'else'referencias'for k,t in g['territorios'].items()})
 root=json.loads((fontes/'gold/comparacoes/manifesto.json').read_bytes());writer=Gravador(saida,go,fontes,{});writer.georef=root['geografia'];writer.area('internet',quadros,dict(caminho='gold/internet/manifesto.json',sha256=arquivo_sha(dest/'manifesto.json')));root['catalogos'].update(writer.catalogos);root['origens']['gold/internet/manifesto.json']=dict(bytes=(dest/'manifesto.json').stat().st_size,sha256=arquivo_sha(dest/'manifesto.json'));root['gerado_em']=m['gerado_em'];(saida/'gold/comparacoes/manifesto.json').write_bytes(compacto(root))
 gerar_mapas(saida,municipios,quadros,m,objeto)
 report=dict(ok=True,originais=len(defs),relativos=len(quadros),territorios=len(grupos),max_trecho_bytes=maxslice,anos=ANOS);(work/'auditoria_geracao.json').write_bytes(compacto(report));print(json.dumps(report),flush=True)

def gerar_mapas(saida,municipios,quadros,m,objeto):
 from mapas_indicadores import escala
 dest=saida/'gold/mapas';dest.mkdir(exist_ok=True);cad=objeto('mapas','cadastro_internet',dict(versao=1,municipios=[m[:3]for m in municipios]));temp=dest/'temp_internet.ndjson';indices=[];definitions=[]
 with temp.open('wb')as f:
  for q in quadros:
   tr={}
   for k,y in enumerate(q.periodos):
    start=f.tell();h=hashlib.sha256()
    for uf in sorted({m[2]for m in municipios}):
     pp=[j for j,m in enumerate(municipios)if m[2]==uf];b=compacto(dict(versao=1,area='internet',rede='todas',indicador=q.definicao['id'],ano=y,uf=uf,cadastro=cad['sha256'],quantidade=len(pp),valores=numeros(q.valores[k,pp]),numeradores=numeros(q.numeradores[k,pp]),denominadores=numeros(q.denominadores[k,pp]),condicoes=q.condicoes[k,pp].tolist()))+b'\n';tr[f'{y}:{uf}']=[f.tell(),len(b),sha(b)];f.write(b);h.update(b)
    tr[f'{y}:BR']=[start,f.tell()-start,h.hexdigest()]
   indices.append((q,tr))
 h=arquivo_sha(temp);p=dest/f'internet_todas_dados_{h[:16]}.ndjson';temp.rename(p);ref=dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=h)
 for q,tr in indices:
  i=q.definicao;index=objeto('mapas','internet_todas_'+i['id']+'_indice',dict(versao=1,area='internet',rede='todas',indicador=i['id'],cadastro=cad['sha256'],arquivo=ref,recortes=tr))
  definitions.append({**{k:v for k,v in i.items()if k in ['id','nome','nome_en','descricao','descricao_en','tema','tema_en','unidade','unidade_en','formato','fonte_nome','fontes','alerta','alerta_en','numerador_nome','denominador_nome','minimo','notas_anos']},'fonte_nome_en':i['fonte_nome'],'territorio':'Município de localização do acesso de banda larga fixa','territorio_en':'Location of the fixed broadband subscription','numerador_nome_en':i['numerador_nome'],'denominador_nome_en':i['denominador_nome'],'anos':q.periodos,'anos_com_valor':[y for k,y in enumerate(q.periodos)if np.isfinite(q.valores[k]).any()],'escala':escala(q.valores,i['formato']),'indice':index})
 (dest/'internet_manifesto.json').write_bytes(compacto(dict(versao=1,area='internet',rede='todas',gerado_em=m['gerado_em'],cadastro=cad,indicadores=definitions,origem=dict(tipo='internet',caminho='gold/internet/manifesto.json',sha256=arquivo_sha(saida/'gold/internet/manifesto.json'),gerado_em=m['gerado_em']))))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True);p.add_argument('--saida',required=True);a=p.parse_args();gerar(a.fontes,a.saida)
