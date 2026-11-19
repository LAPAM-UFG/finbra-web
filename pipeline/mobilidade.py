"""Painel pronto de Mobilidade: Senatran/dezembro e SIM definitivo desde 2013."""
import argparse,gzip,hashlib,json,math
from datetime import datetime,timezone
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pandas as pd
from mobilidade_fontes import ANOS,compacto,sha,norm
from mobilidade_normalizar import chave
from mobilidade_sim import GRUPOS
from agropecuaria import proporcao
from comparacoes_base import Quadro,Gravador,numeros

CONDICOES={0:'Registrado',1:'Zero registrado',2:'Indisponível nesta fonte/ano',3:'Denominador ausente',4:'Denominador zero',5:'Não se aplica',16:'Cobertura municipal incompleta'}
SENATRAN='https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos'
SIM='https://dadosabertos.saude.gov.br/dataset/sim'
POP='https://datasus.saude.gov.br/populacao-residente/'
TIPOS={
 'total':('frota','Frota registrada'), 'automovel':('automoveis','Automóveis'), 'bonde':('bondes','Bondes'),
 'caminhao':('caminhoes','Caminhões'),'caminhaotrator':('caminhao_trator','Caminhões-tratores'),
 'caminhonete':('caminhonetes','Caminhonetes'),'camioneta':('camionetas','Camionetas'),
 'chassiplataf':('chassis','Chassis-plataforma'),'ciclomotor':('ciclomotores','Ciclomotores'),
 'microonibus':('microonibus','Micro-ônibus'),'motocicleta':('motocicletas','Motocicletas'),
 'motoneta':('motonetas','Motonetas'),'onibus':('onibus','Ônibus'),'quadriciclo':('quadriciclos','Quadriciclos'),
 'reboque':('reboques','Reboques'),'semireboque':('semireboques','Semirreboques'),'sidecar':('sidecars','Side-cars'),
 'outros':('outros_veiculos','Outros veículos'),'tratorestei':('tratores_esteira','Tratores de esteira'),
 'tratorrodas':('tratores_rodas','Tratores de rodas'),'triciclo':('triciclos','Triciclos'),'utilitario':('utilitarios','Utilitários')}
SIM_NOMES={'mob_obitos':'Mortes no transporte terrestre','mob_ob_pedestres':'Mortes de pedestres','mob_ob_ciclistas':'Mortes de ciclistas','mob_ob_motociclistas':'Mortes de motociclistas','mob_ob_automoveis':'Mortes de ocupantes de automóveis','mob_ob_caminhonetes':'Mortes de ocupantes de caminhonetes','mob_ob_carga':'Mortes de ocupantes de veículos de carga','mob_ob_onibus':'Mortes de ocupantes de ônibus','mob_ob_outros':'Mortes nos demais transportes terrestres','mob_ob_homens':'Mortes: homens','mob_ob_mulheres':'Mortes: mulheres','mob_ob_sexo_ign':'Mortes: sexo ignorado','mob_ob_0_14':'Mortes: 0 a 14 anos','mob_ob_15_29':'Mortes: 15 a 29 anos','mob_ob_30_59':'Mortes: 30 a 59 anos','mob_ob_60_mais':'Mortes: 60 anos ou mais','mob_ob_idade_ign':'Mortes: idade ignorada'}
IDADE_NOMES={'idade_total':'Veículos no cadastro de fabricação','idade_validos':'Veículos com ano de fabricação válido','idade_anos_soma':'Soma ponderada das idades estimadas','idade_0_4':'Veículos com 0 a 4 anos','idade_5_9':'Veículos com 5 a 9 anos','idade_10_19':'Veículos com 10 a 19 anos','idade_20_mais':'Veículos com 20 anos ou mais','idade_sem_ano':'Veículos sem ano de fabricação válido'}

def correspondencias(g):
 by={(m[2],chave(m[1])):m[0]for m in g['municipios']};aliases=json.loads(Path(__file__).with_name('mobilidade_municipios.json').read_bytes())
 for item in aliases['correspondencias']:
  assert any(m[0]==item['cod_ibge']and m[2]==item['uf']for m in g['municipios'])
  key=(item['uf'],chave(item['nome_senatran']));assert key not in by or by[key]==item['cod_ibge'];by[key]=item['cod_ibge']
 return by

def gerar(fontes,saida):
 fontes=Path(fontes).resolve();saida=Path(saida).resolve()
 if saida==fontes or saida.is_relative_to(fontes)or fontes.is_relative_to(saida):raise ValueError('Destino sobreposto à origem')
 if saida.exists()and any(saida.iterdir()):raise ValueError('Use um candidato novo')
 g=json.loads((fontes/'geografia.json').read_bytes());municipios=g['municipios'];nmun=len(municipios);assert nmun==5571
 grupos=[str(m[0])for m in municipios]+[u for _,_,u in g['governos']]+['BR'];pos={k:j for j,k in enumerate(grupos)};lookup=correspondencias(g);ufcode={int(c.removeprefix('E:')):u for c,_,u in g['governos']}
 sn=json.loads((fontes/'normalizados.json').read_bytes());sm=json.loads((fontes/'sim.json').read_bytes());assert sn['ok']and sm['ok']
 frames={};pend=[]
 for ref in sn['arquivos']:
  b=(fontes/ref['arquivo']).read_bytes();assert sha(b)==ref['sha256'];x=pd.read_parquet(fontes/ref['arquivo']);x['cod_ibge']=[lookup.get((u,chave(n)))for u,n in zip(x.uf,x.municipio)]
  if ref['tipo']=='combustivel':x['combustivel']=x['combustivel'].map(lambda s:' '.join(norm(s).upper().split()).replace(' /','/').replace('/ ','/'))
  for u,n in x.loc[x.cod_ibge.isna(),['uf','municipio']].drop_duplicates().itertuples(index=False,name=None):
   if chave(n)not in ['municipionaoinformado','naoinformado']:pend.append([ref['ano'],ref['tipo'],u,n])
  frames[(ref['ano'],ref['tipo'])]=x
 if pend:raise ValueError('Municípios sem correspondência explícita: '+json.dumps(pend,ensure_ascii=True))
 fuels=sorted({label for(y,kind),x in frames.items()if kind=='combustivel'for label in x.combustivel.unique()},key=norm);assert len(fuels)==len(set(fuels))
 defs=[]
 def add(id,nome,familia,unidade='veículos',fonte='senatran',descricao=None):
  assert len(id+'_cond')<=32 and id not in [i['id']for i in defs]
  texto=descricao or ('Frota registrada no município em dezembro; não é circulação efetiva nem oferta de transporte.'if fonte=='senatran'else'Óbitos não fetais de moradores, causa básica CID-10 V01–V89 (transporte terrestre, incluindo casos fora da via pública); ano do óbito. Não é o local do acidente. Zero significa nenhum óbito registrado, sem garantir ausência de risco.'if fonte=='sim'else'População residente de referência SVS/MS (IBGE), a mesma série usada na Saúde; ausências preservadas.')
  defs.append(dict(id=id,nome=nome,nome_en=nome,familia=familia,unidade=unidade,fonte=fonte,fonte_nome='Senatran / Renavam'if fonte=='senatran'else'Ministério da Saúde · SIM'if fonte=='sim'else'SVS/MS · população residente (IBGE)',fonte_url=SENATRAN if fonte=='senatran'else SIM if fonte=='sim'else POP,descricao=texto,anos=ANOS if fonte!='sim'else sm['anos']))
 for _,(id,nome)in TIPOS.items():add('mob_'+id,nome,'frota')
 for id,nome in [('motos','Motocicletas e motonetas'),('onibus_total','Ônibus e micro-ônibus'),('carga','Caminhões e caminhões-tratores')]:add('mob_'+id,nome,'frota',descricao=nome+'. Soma das categorias indicadas, já incluídas na frota total; não somar novamente com seus componentes.')
 fuel_ids={label:f'mob_cb_{j:02d}'for j,label in enumerate(fuels)}
 for label,id in fuel_ids.items():add(id,'Combustível: '+label,'combustiveis',descricao='Categoria do cadastro de combustível da Senatran, normalizada apenas em acentuação, caixa e espaços: '+label+'. Quando a categoria existe no ano, sua ausência na tabela de frequências de um município presente representa zero. Categorias não observadas em nenhum município no ano e municípios não retornados permanecem indisponíveis.')
 add('mob_cb_total','Veículos no cadastro de combustível','combustiveis')
 add('mob_eletrificados','Categorias elétricas e híbridas cadastradas','combustiveis',descricao='Soma das categorias de combustível cujo nome contém ELÉTRICO, incluindo combinações híbridas e fonte interna/externa. Não identifica autonomia, tecnologia de recarga ou consumo. A classificação é a do registro, não uma reclassificação por modelo.')
 for col,nome in IDADE_NOMES.items():add('mob_'+col,nome,'idade','veículo-anos'if col=='idade_anos_soma'else'veículos',descricao='Cadastro de fabricação da Senatran. Idade aproximada = ano de referência menos ano de fabricação, sem mês; ano válido entre 1900 e o ano de referência. Ano-modelo não substitui fabricação. Valores ausentes ou futuros ficam separados; médias usam somente registros com ano válido.')
 add('mob_idade_10_mais','Veículos com 10 anos ou mais','idade')
 for id in GRUPOS:add(id,SIM_NOMES[id],'seguranca','óbitos','sim')
 add('mob_populacao','População de referência','denominadores','habitantes','populacao')
 idx={i['id']:j for j,i in enumerate(defs)};a=np.full((13,len(grupos),len(defs)),np.nan);c=np.full(a.shape,2,dtype='int8');residuos={}
 def put(y,id,series):
  j=idx[id]
  for key,value in series.items():
   if str(key)in pos and pd.notna(value):a[ANOS.index(y),pos[str(key)],j]=float(value)
 def set_frame(y,id,x,col):
  put(y,id,x[x.cod_ibge.notna()].groupby('cod_ibge')[col].sum().rename(index=lambda k:str(int(k))))
  put(y,id,x.groupby('uf')[col].sum());put(y,id,{'BR':x[col].sum()})
 for y in ANOS:
  x=frames[(y,'tipo')];assert set(TIPOS).issubset(x.columns),x.columns
  for col,(id,_)in TIPOS.items():set_frame(y,'mob_'+id,x,col)
  x=frames[(y,'combustivel')];present=x[['uf','municipio','cod_ibge']].drop_duplicates()
  for label,id in fuel_ids.items():
   if label not in set(x.combustivel):continue
   base=present.copy();s=x[x.combustivel==label].groupby(['uf','municipio']).quantidade.sum();base['quantidade']=[s.get((u,n),0)for u,n in zip(base.uf,base.municipio)];set_frame(y,id,base,'quantidade')
  set_frame(y,'mob_cb_total',x,'quantidade')
  e=x[x.combustivel.map(lambda s:'eletric'in norm(s))]
  if len(e):
   base=present.copy();s=e.groupby(['uf','municipio']).quantidade.sum();base['quantidade']=[s.get((u,n),0)for u,n in zip(base.uf,base.municipio)];set_frame(y,'mob_eletrificados',base,'quantidade')
  x=frames[(y,'idade')]
  for col in IDADE_NOMES:set_frame(y,'mob_'+col,x,col)
  for kind,col in [('tipo','total'),('combustivel','quantidade'),('idade','idade_total')]:
   x=frames[(y,kind)];residuos[f'{y}:{kind}']={**{u:int(v)for u,v in x[x.cod_ibge.isna()].groupby('uf')[col].sum().items()},'BR':int(x.loc[x.cod_ibge.isna(),col].sum())}
 sim=pd.read_parquet(fontes/sm['agregado']['arquivo']);assert sha((fontes/sm['agregado']['arquivo']).read_bytes())==sm['agregado']['sha256'];m6={int(m[0])//10:str(m[0])for m in municipios};sim['cod_ibge']=sim.municipio6.map(m6)
 for y in sm['anos']:
  row=ANOS.index(y);valid=[j for j,m in enumerate(municipios)if m[0]!=5101837]
  for id in GRUPOS:a[row,valid,idx[id]]=0;set_frame(y,id,sim[sim.ano==y],id)
  bad=sim[(sim.ano==y)&sim.cod_ibge.isna()];residuos[f'{y}:sim']={**{u:int(v)for u,v in bad.groupby('uf').mob_obitos.sum().items()},'BR':int(bad.mob_obitos.sum())}
 dm=json.loads((fontes/'gold/downloads/manifesto.json').read_bytes());main=next(x for x in dm['arquivos']if x['id']=='painel_brasil_parquet');pf=pd.read_parquet(fontes/main['caminho'],columns=['cod_ibge','ano','uf','sau_populacao']);assert sha((fontes/main['caminho']).read_bytes())==main['sha256']
 for y in ANOS:
  x=pf[(pf.ano==y)&pf.sau_populacao.notna()];put(y,'mob_populacao',x.set_index('cod_ibge').sau_populacao);put(y,'mob_populacao',x.groupby('uf').sau_populacao.sum());put(y,'mob_populacao',{'BR':x.sau_populacao.sum()})
 for out,parts in [('mob_motos',['mob_motocicletas','mob_motonetas']),('mob_onibus_total',['mob_onibus','mob_microonibus']),('mob_carga',['mob_caminhoes','mob_caminhao_trator']),('mob_idade_10_mais',['mob_idade_10_19','mob_idade_20_mais'])]:
  assert parts;v=a[:,:,[idx[id]for id in parts]];a[:,:,idx[out]]=np.where(np.isfinite(v).all(axis=2),v.sum(axis=2),np.nan)
 c[np.isfinite(a)]=0;c[a==0]=1
 for j,i in enumerate(defs):i['anos']=[y for k,y in enumerate(ANOS)if np.isfinite(a[k,:,j]).any()]
 quadros=[]
 def razao(id,n,d,fator,nome,en,unidade,tema):
  ni,di=idx[n],idx[d];periodos=sm['anos']if defs[ni]['fonte']=='sim'else ANOS;yy=[ANOS.index(p)for p in periodos];nn=a[yy,:nmun,ni];dd=a[yy,:nmun,di];vv,cc=proporcao(nn,dd,c[yy,:nmun,ni],c[yy,:nmun,di],fator)
  detalhe='Razão de componentes do mesmo município e ano. Regiões, UF e Brasil somam somente pares municipais válidos, sem média de taxas. Totais da fonte podem conter registros sem município identificado, informados separadamente.'
  if defs[ni]['fonte']=='sim':detalhe+=' Taxa bruta, sem padronização etária. Pequenas contagens variam muito; zero registrado não garante ausência de risco.'
  definition=dict(id=id,nome=nome,nome_en=en,descricao=detalhe,descricao_en='Same-year municipal components. Aggregates use valid component pairs, not means of rates. Source totals may include records with unidentified municipality. Mortality rates are crude, not age-standardised.',tema=tema,tema_en={'Frota':'Fleet','Combustíveis':'Fuels','Idade da frota':'Fleet age','Segurança no transporte':'Transport safety'}[tema],unidade=unidade,unidade_en=unidade,formato='percentual'if unidade=='%'else'numero',frequencia='anual',metodo_referencia='razao',normalizacao=nome,normalizacao_en=en,fator=fator,ranking=True,minimo=0,fonte_nome=defs[ni]['fonte_nome'],fontes=[dict(nome=defs[ni]['fonte_nome'],url=defs[ni]['fonte_url'])]+([dict(nome=defs[di]['fonte_nome'],url=defs[di]['fonte_url'])]if defs[ni]['fonte']!=defs[di]['fonte']else[]),alerta='Frota registrada não mede circulação efetiva. Óbitos são de moradores, não necessariamente ocorridos no território. Compare os anos e a cobertura; denominador zero não define percentual.',alerta_en='Registered fleet is not traffic flow. Deaths refer to residents, not necessarily events in the territory. Check years and coverage; a zero denominator does not define a percentage.',variavel_download='mob_'+id,numerador_id=n,denominador_id=d,numerador_nome=defs[ni]['nome']+' ('+defs[ni]['unidade']+')',denominador_nome=defs[di]['nome']+' ('+defs[di]['unidade']+')')
  q=Quadro(definition,periodos,vv,nn,dd,cc);quadros.append(q)
 for id,n,nome,en in [('veiculos_mil','mob_frota','Veículos por 1.000 habitantes','Vehicles per 1,000 residents'),('autos_mil','mob_automoveis','Automóveis por 1.000 habitantes','Cars per 1,000 residents'),('motos_mil','mob_motos','Motos por 1.000 habitantes','Motorcycles per 1,000 residents'),('carga_mil','mob_carga','Veículos de carga por 1.000 habitantes','Trucks per 1,000 residents'),('onibus_mil','mob_onibus_total','Ônibus e micro-ônibus por 1.000 habitantes','Buses per 1,000 residents')]:razao(id,n,'mob_populacao',1000,nome,en,'por 1.000 habitantes','Frota')
 for id,n,nome,en in [('autos_pct','mob_automoveis','Automóveis na frota','Cars in fleet'),('motos_pct','mob_motos','Motos na frota','Motorcycles in fleet'),('carga_pct','mob_carga','Veículos de carga na frota','Trucks in fleet'),('onibus_pct','mob_onibus_total','Ônibus e micro-ônibus na frota','Buses in fleet')]:razao(id,n,'mob_frota',100,nome,en,'%','Frota')
 razao('eletrificados_pct','mob_eletrificados','mob_cb_total',100,'Categorias elétricas e híbridas no cadastro','Electric and hybrid fuel categories','%','Combustíveis')
 razao('idade_media','mob_idade_anos_soma','mob_idade_validos',1,'Idade média estimada da frota','Estimated mean fleet age','anos','Idade da frota')
 razao('idade_10_pct','mob_idade_10_mais','mob_idade_validos',100,'Veículos com 10 anos ou mais (ano válido)','Vehicles aged 10 years or older (valid year)','%','Idade da frota')
 razao('idade_info_pct','mob_idade_validos','mob_idade_total',100,'Ano de fabricação válido no cadastro','Valid manufacturing year in register','%','Idade da frota')
 for id,n,nome,en in [('mortes_100mil','mob_obitos','Mortes no transporte terrestre por 100 mil habitantes','Land transport deaths per 100,000 residents'),('motociclistas_100mil','mob_ob_motociclistas','Mortes de motociclistas por 100 mil habitantes','Motorcyclist deaths per 100,000 residents'),('pedestres_100mil','mob_ob_pedestres','Mortes de pedestres por 100 mil habitantes','Pedestrian deaths per 100,000 residents'),('ciclistas_100mil','mob_ob_ciclistas','Mortes de ciclistas por 100 mil habitantes','Cyclist deaths per 100,000 residents')]:razao(id,n,'mob_populacao',100000,nome,en,'por 100 mil habitantes','Segurança no transporte')
 for id,n,nome,en in [('motociclistas_pct','mob_ob_motociclistas','Motociclistas entre as mortes no transporte','Motorcyclists among transport deaths'),('pedestres_pct','mob_ob_pedestres','Pedestres entre as mortes no transporte','Pedestrians among transport deaths'),('jovens_pct','mob_ob_15_29','Jovens de 15 a 29 anos entre as mortes','Ages 15 to 29 among transport deaths'),('homens_pct','mob_ob_homens','Homens entre as mortes no transporte','Men among transport deaths')]:razao(id,n,'mob_obitos',100,nome,en,'%','Segurança no transporte')
 # Os mesmos valores e componentes são usados no painel e nas comparações.
 groups={key:[j for j,m in enumerate(municipios)if key==str(m[0])or key==m[2]or key=='BR'or key=='I:'+m[3]or key=='T:'+m[4]]for key,t in g['territorios'].items()if t['nivel']in ['M','UF','BR','imediata','intermediaria']}
 dv=np.full((13,len(grupos),len(quadros)),np.nan);dc=np.full(dv.shape,2,dtype='int8');dn=dv.copy();dd=dv.copy();dq=np.zeros(dv.shape,dtype='int16')
 for j,q in enumerate(quadros):
  for key in grupos:
   s=q.grupo_territorio(key,groups[key],municipio=len(key)==7)
   for k,p in enumerate(q.periodos):
    y=ANOS.index(p);loc=pos[key];dv[y,loc,j]=s['v'][k]if s['v'][k]is not None else np.nan;dc[y,loc,j]=s['c'][k];dn[y,loc,j]=s['n'][k]if s['n'][k]is not None else np.nan;dd[y,loc,j]=s['d'][k]if s['d'][k]is not None else np.nan;dq[y,loc,j]=s['q'][k]
 dest=saida/'gold/mobilidade';dest.mkdir(parents=True)
 def objeto(namespace,nome,value,zip=False):
  body=compacto(value);b=gzip.compress(body,mtime=0)if zip else body;d=saida/'gold'/namespace;d.mkdir(parents=True,exist_ok=True);p=d/f"{nome}_{sha(b)[:16]}.json{'.gz'if zip else''}";p.write_bytes(b);ref=dict(caminho=p.relative_to(saida).as_posix(),bytes=len(b),sha256=sha(b))
  if zip:ref.update(json_bytes=len(body),json_sha256=sha(body))
  return ref
 indices={};max_slice=0
 for bucket in [*[u for _,_,u in g['governos']],'referencias']:
  keys=[key for key in grupos if(g['territorios'][key]['uf']if len(key)==7 else'referencias')==bucket];temp=dest/f'tmp_{bucket}.ndjson';entries={}
  with temp.open('wb')as f:
   for key in keys:
    loc=pos[key];body=compacto(dict(versao=1,grupo=key,anos=ANOS,valores=[numeros(r)for r in a[:,loc]],condicoes=c[:,loc].tolist(),derivados=[numeros(r)for r in dv[:,loc]],condicoes_derivados=dc[:,loc].tolist(),numeradores=[numeros(r)for r in dn[:,loc]],denominadores=[numeros(r)for r in dd[:,loc]],coberturas=dq[:,loc].tolist(),residuos={f'{y}:{kind}':(None if kind=='sim'and y>sm['anos'][-1]else residuos.get(f'{y}:{kind}',{}).get(key,0))for y in ANOS for kind in ['tipo','combustivel','idade','sim']}if len(key)!=7 else{}))+b'\n';entries[key]=[f.tell(),len(body),sha(body)];f.write(body);max_slice=max(max_slice,len(body))
  h=sha(temp.read_bytes());p=dest/f'series_{bucket.lower()}_{h[:16]}.ndjson';temp.rename(p);indices[bucket]=objeto('mobilidade','indice_'+bucket.lower(),dict(versao=1,arquivo=dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=h),grupos=entries))
 catalogo=objeto('mobilidade','catalogo',dict(versao=1,anos=ANOS,indicadores=defs,derivados=[dict(q.definicao,periodos=q.periodos)for q in quadros],condicoes=CONDICOES),True);geo=objeto('mobilidade','geografia',g,True)
 m=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=ANOS,catalogo=catalogo,geografia=geo,indices=indices,variaveis=len(defs),calculados=len(quadros),territorios=len(grupos),max_trecho_bytes=max_slice,ultimos={'senatran':2025,'sim':2024},origens={'senatran':sha((fontes/'senatran.json').read_bytes()),'sim':sha((fontes/'sim.json').read_bytes()),'populacao':main['sha256']});(dest/'manifesto.json').write_bytes(compacto(m))
 data={'cod_ibge':np.tile([m[0]for m in municipios],13),'ano':np.repeat(ANOS,nmun),'municipio':np.tile([m[1]for m in municipios],13),'uf':np.tile([m[2]for m in municipios],13)}
 for j,i in enumerate(defs):data[i['id']]=a[:,:nmun,j].reshape(-1);data[i['id']+'_cond']=c[:,:nmun,j].reshape(-1)
 for j,q in enumerate(quadros):id=q.definicao['variavel_download'];data[id]=dv[:,:nmun,j].reshape(-1);data[id+'_cond']=dc[:,:nmun,j].reshape(-1)
 work=saida/'trabalho_mobilidade';work.mkdir();pd.DataFrame(data).sort_values(['cod_ibge','ano']).to_parquet(work/'municipios.parquet',index=False,compression='zstd')
 geo_obj=SimpleNamespace(municipios=municipios,territorios=g['territorios'],governos=g['governos'],grupos=groups,buckets={k:t['uf']if t['nivel']=='M'else'referencias'for k,t in g['territorios'].items()})
 root=json.loads((fontes/'gold/comparacoes/manifesto.json').read_bytes());writer=Gravador(saida,geo_obj,fontes,{});writer.georef=root['geografia'];writer.area('mobilidade',quadros,dict(caminho='gold/mobilidade/manifesto.json',sha256=sha((dest/'manifesto.json').read_bytes())));root['catalogos'].update(writer.catalogos);root['origens']['gold/mobilidade/manifesto.json']=dict(bytes=(dest/'manifesto.json').stat().st_size,sha256=sha((dest/'manifesto.json').read_bytes()));(saida/'gold/comparacoes/manifesto.json').write_bytes(compacto(root))
 gerar_mapas(saida,municipios,quadros,m,objeto)
 report=dict(ok=True,indicadores=len(defs),calculados=len(quadros),municipios=nmun,anos=ANOS,max_trecho_bytes=max_slice,sim_totais=sm['totais'],municipios_sem_correspondencia=pend,residuos=residuos);(work/'auditoria_geracao.json').write_bytes(compacto(report));print(json.dumps({k:report[k]for k in ['ok','indicadores','calculados','municipios','max_trecho_bytes']}),flush=True)

def gerar_mapas(saida,municipios,quadros,manifesto,objeto):
 from mapas_indicadores import escala
 dest=saida/'gold/mapas';dest.mkdir(exist_ok=True);cad=objeto('mapas','cadastro_mobilidade',dict(versao=1,municipios=[m[:3]for m in municipios]));temp=dest/'temp_mobilidade.ndjson';definitions=[];indices=[]
 with temp.open('wb')as f:
  for q in quadros:
   tr={}
   for k,y in enumerate(q.periodos):
    inicio=f.tell();h=hashlib.sha256()
    for uf in sorted({m[2]for m in municipios}):
     pp=[j for j,m in enumerate(municipios)if m[2]==uf];b=compacto(dict(versao=1,area='mobilidade',rede='todas',indicador=q.definicao['id'],ano=y,uf=uf,cadastro=cad['sha256'],quantidade=len(pp),valores=numeros(q.valores[k,pp]),numeradores=numeros(q.numeradores[k,pp]),denominadores=numeros(q.denominadores[k,pp]),condicoes=q.condicoes[k,pp].tolist()))+b'\n';tr[f'{y}:{uf}']=[f.tell(),len(b),sha(b)];f.write(b);h.update(b)
    tr[f'{y}:BR']=[inicio,f.tell()-inicio,h.hexdigest()]
   indices.append((q,tr))
 h=sha(temp.read_bytes());path=dest/f'mobilidade_todas_dados_{h[:16]}.ndjson';temp.rename(path);ref=dict(caminho=path.relative_to(saida).as_posix(),bytes=path.stat().st_size,sha256=h)
 for q,tr in indices:
  i=q.definicao;index=objeto('mapas','mobilidade_todas_'+i['id']+'_indice',dict(versao=1,area='mobilidade',rede='todas',indicador=i['id'],cadastro=cad['sha256'],arquivo=ref,recortes=tr));definitions.append({**{k:v for k,v in i.items()if k in ['id','nome','nome_en','descricao','descricao_en','tema','tema_en','unidade','unidade_en','formato','fonte_nome','fontes','alerta','alerta_en','numerador_nome','denominador_nome','minimo']},'fonte_nome_en':i['fonte_nome'],'territorio':'Município de registro ou residência, conforme o indicador','territorio_en':'Registration or residence municipality, depending on indicator','numerador_nome_en':i['numerador_nome'],'denominador_nome_en':i['denominador_nome'],'anos':q.periodos,'anos_com_valor':[y for k,y in enumerate(q.periodos)if np.isfinite(q.valores[k]).any()],'escala':escala(q.valores,i['formato']),'indice':index})
 origem=dict(tipo='mobilidade',caminho='gold/mobilidade/manifesto.json',sha256=sha((saida/'gold/mobilidade/manifesto.json').read_bytes()),gerado_em=manifesto['gerado_em'])
 (dest/'mobilidade_manifesto.json').write_bytes(compacto(dict(versao=1,area='mobilidade',rede='todas',gerado_em=manifesto['gerado_em'],cadastro=cad,indicadores=definitions,origem=origem)))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--fontes',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args();gerar(a.fontes,a.saida)
