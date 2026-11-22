"""Séries mensais e perfis completos por ano, lidos em trechos pequenos."""
import hashlib,json
from pathlib import Path
import numpy as np,pandas as pd
from comparacoes_base import compacto,numeros
from comex_fontes import sha
from painel_municipal import KEYS

MENSAL=['cex_exp_fob','cex_imp_fob','cex_saldo_fob','cex_exp_kg','cex_imp_kg']
def gerar_extras(fontes,saida,db,g,grupos,ufs,anos,meta,classes,objeto):
 dest=saida/'gold/comex';periodos=[y*100+m for y in anos for m in range(1,meta['periodos'][str(y)]+1)];pidx={p:j for j,p in enumerate(periodos)}
 mf=json.loads((fontes/'gold/downloads/manifesto.json').read_bytes());main=next(v for v in mf['arquivos']if v['id']=='painel_brasil_parquet');ident=pd.read_parquet(fontes/main['caminho'],columns=KEYS).sort_values('ano').drop_duplicates('cod_ibge',keep='last').set_index('cod_ibge');assert len(ident)==len(g['municipios'])
 series_indices={};perfis_indices={};csvrefs={};csvpaths={};max_mensal=max_perfil=0
 def registrar(p,**extra):return dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=sha(p),**extra)
 def fechar(temp,prefix):
  h=sha(temp);p=dest/(prefix+'_'+h[:16]+temp.suffix);temp.rename(p);return p,registrar(p)
 buckets=sorted(ufs,key=lambda u:min(c for c,_,uf,*_ in g['municipios']if uf==u))+['referencias']
 for bucket in buckets:
  keys=sorted([k for k in grupos if(g['territorios'][k]['uf']if len(k)==7 else'referencias')==bucket],key=lambda k:int(k)if k.isdigit()else k);pos={key:j for j,key in enumerate(keys)};db.execute('CREATE OR REPLACE TEMP TABLE lote_extra AS SELECT unnest(?) grupo',[keys]).fetchall()
  values=np.zeros((len(keys),len(periodos),5))
  for key,y,m,flow,fob,kg in db.execute('SELECT grupo,ano,mes,fluxo,fob,kg FROM mensal JOIN lote_extra USING(grupo)').fetchall():
   j,k=pos[key],pidx[y*100+m];z=0 if flow=='exp'else 1;values[j,k,z]=fob;values[j,k,z+3]=kg
  values[:,:,2]=values[:,:,0]-values[:,:,1];assert (values[:,:,[0,1,3,4]]>=0).all()
  temp=dest/('tmp_mensal_'+bucket+'.ndjson');entries={}
  with temp.open('wb')as f:
   for key,j in pos.items():
    body=compacto(dict(versao=1,grupo=key,periodos=periodos,colunas=MENSAL,valores=values[j].tolist(),condicoes=np.where(values[j]==0,1,0).tolist()))+b'\n';entries[key]=[f.tell(),len(body),hashlib.sha256(body).hexdigest()];max_mensal=max(max_mensal,len(body));f.write(body)
  _,ref=fechar(temp,'mensal_'+bucket.lower());series_indices[bucket]=objeto('comex','mensal_indice_'+bucket.lower(),dict(versao=1,arquivo=ref,grupos=entries))
  if bucket!='referencias':
   codes=[int(k)for k in keys];n=len(periodos);data={'cod_ibge':np.repeat(codes,n),'ano':np.tile(np.array(periodos)//100,len(codes)),'mes':np.tile(np.array(periodos)%100,len(codes)),'periodo':np.tile(periodos,len(codes))}
   for col in KEYS:
    if col not in data:data[col]=np.repeat(ident.reindex(codes)[col].to_numpy(),n)
   for j,id in enumerate(MENSAL):data[id]=values[:,:,j].reshape(-1);data[id+'_cond']=np.where(data[id]==0,1,0)
   frame=pd.DataFrame(data)[[*KEYS,'mes','periodo',*[c for id in MENSAL for c in [id,id+'_cond']]]];p=dest/('tmp_mensal_'+bucket+'.csv');frame.to_csv(p,index=False,sep=';',encoding='utf-8');p,ref=fechar(p,'mensal_'+bucket.lower());csvpaths[bucket]=p;csvrefs[bucket]={**ref,'linhas':len(frame),'variaveis':len(frame.columns),'formato':'csv','tipo':'mensal','uf':bucket,'area':'comex'}
  records={}
  for table,field,label in [('produtos','sh4','produtos'),('paises','pais','paises')]:
   for key,y,flow,code,fob,kg in db.execute(f"SELECT grupo,ano,fluxo,{field},fob,kg FROM {table} JOIN lote_extra USING(grupo)WHERE modo='obs'ORDER BY grupo,ano,fluxo,fob DESC,{field}").fetchall():records.setdefault((key,y),{}).setdefault(flow,{}).setdefault(label,[]).append([code,int(fob),int(kg)])
  temp=dest/('tmp_perfis_'+bucket+'.ndjson');entries={y:{}for y in anos}
  with temp.open('wb')as f:
   for y in anos:
    for key in keys:
     flows=records.get((key,y),{});flows={flow:{kind:flows.get(flow,{}).get(kind,[])for kind in ['produtos','paises']}for flow in ['exp','imp']};body=compacto(dict(versao=1,grupo=key,ano=y,mes_ate=meta['periodos'][str(y)],fluxos=flows))+b'\n';entries[y][key]=[f.tell(),len(body),hashlib.sha256(body).hexdigest()];max_perfil=max(max_perfil,len(body));f.write(body)
  _,ref=fechar(temp,'perfis_'+bucket.lower())
  for y,groups in entries.items():perfis_indices[f'{bucket}:{y}']=objeto('comex',f'perfil_indice_{bucket.lower()}_{y}',dict(versao=1,arquivo=ref,grupos=groups))
  print(json.dumps(dict(etapa='extras_prontos',uf=bucket,series=len(keys),anos=len(anos))),flush=True)
 # Brasil mensal contém os mesmos municípios/meses dos arquivos de UF, sem
 # acrescentar totais estaduais às linhas municipais nem duplicar registros.
 temp=dest/'tmp_mensal_BR.csv';nrows=0
 with temp.open('wb')as f:
  for j,uf in enumerate(buckets[:-1]):
   with csvpaths[uf].open('rb')as src:
    header=src.readline()
    if j==0:f.write(header)
    for chunk in iter(lambda:src.read(1024*1024),b''):f.write(chunk)
   nrows+=csvrefs[uf]['linhas']
 p,ref=fechar(temp,'mensal_br');csvrefs['BR']={**ref,'linhas':nrows,'variaveis':18,'formato':'csv','tipo':'mensal','uf':'BR','area':'comex'};assert nrows==len(g['municipios'])*len(periodos)
 dictionary=[]
 for id in KEYS:dictionary.append(dict(variavel=id,descricao='Identificação territorial e ano; mesmo cadastro da base municipal anual.',unidade='identificador'))
 dictionary += [dict(variavel='mes',descricao='Mês do registro, de 1 a 12.',unidade='mês'),dict(variavel='periodo',descricao='Ano e mês no formato numérico AAAAMM. No Stata, crie a data mensal com ym(ano,mes).',unidade='AAAAMM')]
 for id in MENSAL:
  dictionary.append(dict(variavel=id,descricao='Importações de bens.'if'_imp_'in id else'Exportações menos importações de bens.'if'_saldo_'in id else'Exportações de bens.',unidade='kg de peso líquido declarado'if id.endswith('_kg')else'US$ FOB correntes'));dictionary.append(dict(variavel=id+'_cond',descricao='0: registrado com valor diferente de zero; 1: zero ou sem registro de operações no arquivo, dentro da cobertura publicada. Meses futuros ou fora da cobertura não são gerados.',unidade='código'))
 temp=dest/'tmp_dicionario_mensal.csv';pd.DataFrame(dictionary).to_csv(temp,index=False,sep=';',encoding='utf-8');p,ref=fechar(temp,'dicionario_mensal');csvdict={**ref,'formato':'csv','tipo':'dicionario','linhas':len(dictionary),'variaveis':3,'area':'comex'}
 return dict(mensais=dict(indices=series_indices,periodos=periodos,max_trecho_bytes=max_mensal),perfis=objeto('comex','perfis_catalogo',dict(versao=1,indices=perfis_indices,max_trecho_bytes=max_perfil)),classificacoes=objeto('comex','classificacoes',dict(versao=1,**classes),True),downloads_mensais=csvrefs,dicionario_mensal=csvdict)
