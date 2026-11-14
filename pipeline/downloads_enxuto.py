"""Recorta uma fonte municipal ampla já auditada: 2013+, seleção enxuta e Stata.

gerar --origem CANDIDATA_AMPLA --saida CANDIDATA_NOVA [--stata EXE]
finalizar --raiz CANDIDATA_NOVA --excel DICIONARIO.xlsx
Nunca escreve na origem nem no manifesto global.
"""
import argparse
import copy
import csv
import hashlib
import json
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado, salvar_json
from painel_municipal import Painel, KEYS, qi, qs, sha
from finalizar_downloads import validar_excel

EDICAO = 'enxuta_2013'
MESES = {1:'Janeiro',2:'Fevereiro',3:'Março',4:'Abril',5:'Maio',6:'Junho',7:'Julho',8:'Agosto',9:'Setembro',10:'Outubro',11:'Novembro',12:'Dezembro'}
NOMES = {
 'fin_populacao_ibge':'População IBGE de referência das finanças', 'fin_populacao_ibge_ano':'Ano da população IBGE de referência das finanças',
 'rais_populacao':'População de referência da RAIS', 'rais_populacao_ano':'Ano da população de referência da RAIS',
 'lrf_rcl':'Receita corrente líquida (LRF)', 'lrf_rcl_ajustada':'Receita corrente líquida ajustada (LRF)',
 'lrf_pessoal_rcl_pct':'Despesa com pessoal / RCL', 'lrf_pessoal_limite_pct':'Limite de pessoal informado na LRF',
 'lrf_dcl':'Dívida consolidada líquida', 'lrf_dcl_rcl_pct':'Dívida consolidada líquida / RCL',
 'lrf_rreo_tipo':'Modalidade de declaração do RREO', 'lrf_rgf_tipo':'Modalidade de declaração do RGF',
 'se_mde_pct':'Aplicação em manutenção e desenvolvimento do ensino', 'se_fundeb_remuneracao_pct':'Fundeb aplicado na remuneração dos profissionais',
 'se_saude_pct':'Aplicação em saúde (SIOPS)', 'se_saude_hab':'Despesa total em saúde por habitante',
 'se_saude_proprios_hab':'Despesa própria em saúde por habitante', 'se_saude_total':'Despesa total em saúde',
 'se_saude_proprios':'Despesa própria em saúde', 'se_sus_receita':'Receita de transferências do SUS',
 'rais_empregos':'Vínculos formais ativos em 31/12', 'rais_estabelecimentos':'Estabelecimentos com vínculos ativos',
 'rais_mulheres':'Vínculos ativos de mulheres', 'rais_homens':'Vínculos ativos de homens',
 'rais_ate24':'Vínculos ativos de pessoas de até 24 anos', 'rais_de50mais':'Vínculos ativos de pessoas com 50 anos ou mais',
 'rais_massa_dez':'Massa de remuneração de dezembro', 'fns_liquido_real':'Repasses líquidos do Fundo Nacional de Saúde (IPCA)',
 'cli_chuva_mm_anomalia_pct':'Chuva: desvio relativo do habitual', 'cli_evap_mm_anomalia_pct':'Evaporação: desvio relativo do habitual',
}


def ler(path):
 return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def validar_selecao(config, dictionary):
 rows=config['variaveis'];origens={d['variavel'] for d in dictionary if d['tabela']=='painel'}
 if config['ano_inicial']<2013 or not 200<=len(rows)<=300:raise ValueError('Seleção fora do recorte solicitado')
 if len({r['origem'] for r in rows})!=len(rows) or len({r['variavel'] for r in rows})!=len(rows):raise ValueError('Variáveis duplicadas')
 for r in rows:
  if r['origem'] not in origens:raise ValueError('Variável não encontrada: '+r['origem'])
  if len(r['variavel'])>32 or not re.fullmatch(r'[a-z][a-z0-9_]*',r['variavel']):raise ValueError('Nome incompatível com Stata: '+r['variavel'])
 return rows


def metadado(d, original, novo, ano):
 x=copy.deepcopy(d);x.update(variavel=novo,variavel_original=original,tabela='painel')
 years=[v for v in x.get('anos_observados',[]) if v>=ano]
 x.update(anos_observados=years,ano_de=min(years) if years else None,ano_ate=max(years) if years else None)
 if original in NOMES:x['nome']=x['descricao']=NOMES[original]
 if original.startswith('rais_'):
  x['nome']=x['nome'].replace('Raca cor:','Raça/cor:').replace('Vinculo mte:','Tipo de vínculo MTE:').replace(' — vinculos',' — vínculos ativos').replace(' — remuneracao media',' — remuneração média de dezembro')
  if 'remuneracao_media' in original and not original.endswith('_real'):x['unidade']='R$ nominais de dezembro'
 if original.startswith('vac_'):
  vaccine='BCG' if '_bcg_' in original else 'pentavalente' if '_penta_' in original else 'tríplice viral, 1ª dose' if '_triplice_' in original else 'poliomielite'
  method='indivíduo' if original.startswith('vac_individuo_') else 'tipo de dose'
  x['nome']=x['descricao']=f'Cobertura vacinal: {vaccine} — {method}'
 if original=='cli_umid_solo_pct_anomalia':x['unidade']='pontos percentuais'
 if original=='cod_ibge':x['tipo']='inteiro';x['observacao']='Código numérico de sete dígitos; identificador do painel no Stata.'
 return x


def preparar_stata(frame, dictionary):
 """Nulos numéricos viram missing; categorias recebem códigos e rótulos estáveis."""
 df=frame.copy();rotulos={};by={d['variavel']:d for d in dictionary}
 for name in df:
  if pd.api.types.is_bool_dtype(df[name].dtype) or (name not in KEYS and by[name]['tipo']=='logico'):
   df[name]=df[name].astype('float64');rotulos[name]={0:'Não',1:'Sim'};by[name]['stata_rotulos']=rotulos[name]
  elif name not in KEYS and (pd.api.types.is_object_dtype(df[name].dtype) or pd.api.types.is_string_dtype(df[name].dtype)):
   cats=by[name].get('stata_rotulos')
   if cats is None:
    values=sorted(str(v) for v in df[name].dropna().unique())
    cats={0:'Não',1:'Sim'} if set(values)<=set(['Não','Sim']) else {i+1:v for i,v in enumerate(values)}
    by[name]['stata_rotulos']=cats
   cats={int(k):v for k,v in cats.items()};inv={v:k for k,v in cats.items()}
   unknown=set(str(v) for v in df[name].dropna().unique())-set(inv)
   if unknown:raise ValueError(f'Categorias novas em {name}: {unknown}')
   df[name]=df[name].map(inv).astype('float64');rotulos[name]=cats
  elif pd.api.types.is_string_dtype(df[name].dtype) or pd.api.types.is_object_dtype(df[name].dtype):
   df[name]=df[name].fillna('').astype(object)
  elif pd.api.types.is_numeric_dtype(df[name].dtype):
   if np.isinf(df[name].to_numpy(dtype='float64',na_value=np.nan)).any():raise ValueError('Valor infinito: '+name)
  if name not in KEYS and by[name].get('variavel_original',name).endswith('_mes'):rotulos[name]=MESES;by[name]['stata_rotulos']=MESES
 return df,rotulos


class Enxuto:
 def __init__(self, origem, saida, base, config=None):
  self.origem=origem.resolve();self.base=base.resolve();self.root=destino_isolado(saida,self.origem);destino_isolado(self.root,self.base)
  self.work=self.root/'trabalho_downloads';self.dest=self.root/'gold/downloads'
  if not self.dest.resolve().is_relative_to(self.root):raise ValueError('Pasta downloads redirecionada para fora da candidata')
  self.fonte=ler(self.origem/'gold/downloads/manifesto.json');self.config=config or ler(Path(__file__).with_name('downloads_selecao.json'))
  assert self.fonte['base_sha256']==sha(self.base/'gold/manifesto.json'),'Atualize a fonte ampla para o manifesto atual'
  self.raw_dictionary=ler(self.origem/self.fonte['dicionario']['caminho']);self.rows=validar_selecao(self.config,self.raw_dictionary)
  self.work.mkdir(parents=True,exist_ok=True);self.dest.mkdir(parents=True,exist_ok=True)
  self.db=duckdb.connect();self.db.execute("SET threads=2;SET memory_limit='3GB';SET preserve_insertion_order=false")
  self.p=Painel.__new__(Painel);self.p.db=self.db;self.p.root=self.root;self.p.work=self.work;self.p.dest=self.dest;self.p.files=[]
  self.dictionary=[];self.pending=[];self.year=self.config['ano_inicial']

 def registrar(self,path,id,tipo,fmt,nome,**kw):
  obj=self.p.objeto(path,id,tipo,kw.get('area'),nome,fmt,kw.get('linhas'),kw.get('variaveis'),kw.get('ano_de'),kw.get('ano_ate'),kw.get('uf'))
  if kw.get('escopo'):obj['escopo']=kw['escopo']
  if fmt in ['csv.zip','zip']:
   with zipfile.ZipFile(self.root/obj['caminho']) as z:obj['bytes_extraido']=sum(v.file_size for v in z.infolist())
  return obj

 def exportar(self,id,query,nome,area=None,uf=None):
  cols=self.p.schema(query);n,first,last=self.db.execute('SELECT count(*),min(ano),max(ano) FROM ('+query+')').fetchone()
  if not n:return
  meta=dict(linhas=n,variaveis=len(cols)-len(KEYS),ano_de=first,ano_ate=last,area=area,uf=uf)
  kind='area' if area else 'painel';file=self.work/(id+'.parquet')
  self.db.execute('COPY ('+query+') TO '+qs(file.as_posix())+" (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 16384)")
  obj=self.registrar(file,id+'_parquet',kind,'parquet',nome,**meta);source=self.root/obj['caminho']
  plain=self.work/(id+'.csv');self.p.csv('SELECT * FROM read_parquet('+qs(source.as_posix())+')',plain)
  zipped=self.work/(id+'.csv.zip')
  with zipfile.ZipFile(zipped,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as z:z.write(plain,id+'.csv')
  plain.unlink();self.registrar(zipped,id+'_csv_zip',kind,'csv.zip',nome,**meta)
  data=pq.read_table(source).to_pandas();df,labels=preparar_stata(data,self.dictionary);dta=self.work/(id+'.dta')
  variable_labels={k:next(d['nome'] for d in self.dictionary if d['variavel']==k)[:80] for k in df}
  df.to_stata(dta,write_index=False,version=118,variable_labels=variable_labels,value_labels=labels,data_label='Finbra | Painel municipal enxuto, desde 2013')
  self.pending.append(dict(path=str(dta),id=id+'_dta',tipo=kind,nome=nome,meta=meta))
  print(json.dumps(dict(exportado=id,linhas=n,variaveis=meta['variaveis'])),flush=True)

 def gerar(self,stata=None):
  origin=next(a for a in self.fonte['arquivos'] if a['id']=='painel_brasil_parquet');file=self.origem/origin['caminho'];assert sha(file)==origin['sha256']
  raw={d['variavel']:d for d in self.raw_dictionary if d['tabela']=='painel'}
  self.dictionary=[metadado(raw[k],k,k,self.year) for k in KEYS]+[metadado(raw[r['origem']],r['origem'],r['variavel'],self.year) for r in self.rows]
  source='read_parquet('+qs(file.as_posix())+')';bad=self.db.execute('SELECT count(*) FROM '+source+" WHERE ano>=? AND NOT regexp_full_match(cod_ibge,'[1-9][0-9]{6}')",[self.year]).fetchone()[0];assert not bad,'Código IBGE inválido'
  select=['cast(cod_ibge as INTEGER) cod_ibge',*[qi(k) for k in KEYS[1:]],*[qi(r['origem'])+' '+qi(r['variavel']) for r in self.rows]]
  self.db.execute('CREATE TABLE enxuto AS SELECT '+','.join(select)+' FROM '+source+' WHERE ano>='+str(self.year))
  assert not self.db.execute('SELECT count(*) FROM (SELECT cod_ibge,ano,count(*) n FROM enxuto GROUP BY 1,2 HAVING n>1)').fetchone()[0]
  self.exportar('painel_brasil','SELECT * FROM enxuto ORDER BY cod_ibge,ano','Base enxuta — Brasil')
  for uf, in self.db.execute('SELECT DISTINCT uf FROM enxuto ORDER BY 1').fetchall():self.exportar('painel_'+uf.lower(),'SELECT * FROM enxuto WHERE uf='+qs(uf)+' ORDER BY cod_ibge,ano','Base enxuta — '+uf,uf=uf)
  for area in self.fonte['areas']:
   names=[r['variavel'] for r in self.rows if r['area']==area['id']]
   if not names:continue
   query='SELECT '+','.join(qi(k) for k in [*KEYS,*names])+' FROM enxuto WHERE ('+' OR '.join(qi(k)+' IS NOT NULL' for k in names)+') ORDER BY cod_ibge,ano'
   self.exportar('painel_'+area['id'],query,'Base enxuta — '+area['nome'],area=area['id'])
  declared=False
  if stata:
   self.processar_stata(stata);declared=True
  for f in self.pending:self.registrar(Path(f['path']),f['id'],f['tipo'],'dta',f['nome'],**f['meta'])
  self.complementos()
  n,cities,first,last=self.db.execute('SELECT count(*),count(DISTINCT cod_ibge),min(ano),max(ano) FROM enxuto').fetchone()
  notes=[f'Base enxuta: {len(self.rows)} variáveis principais, além dos seis identificadores, somente desde {self.year}.',
   'Os vazios foram preservados; não se interpola nem se substitui ausência por zero. As coberturas diferem por fonte; o ano em curso pode ser parcial.',
   'CadÚnico está disponível nos retratos indicados no dicionário. MUNIC/RH aparece apenas nas edições observadas. Não são séries anuais completas.',
   'Os nomes das variáveis são iguais em Stata, CSV e Parquet e têm até 32 caracteres. O dicionário informa o nome na fonte ampla.',
   'No Stata, cod_ibge é numérico (sete dígitos), ano é inteiro e categorias têm rótulos. Os dados monetários mantêm as unidades indicadas.',
   'RAIS: vínculos ativos em 31/12, não pessoas; remuneração de dezembro. Tipos MTE são três grupos, separados dos códigos detalhados de contrato.',
   'Assistência: contagens usam último registro, com mês e condição; dinheiro anual tem número de meses. Menos de 12 meses é acumulado parcial.',
   'AB/APS e metodologias de vacinação ficam em variáveis diferentes. Anomalias relativas do clima são frações: 0,01 = 1%.',
   'DCA/MUNIC completas ficam separadas, também desde 2013. Não somar contas totais e componentes; _sintetico sinaliza total reconstruído.',
   'Brasília e Noronha são unidades especiais. Dados estaduais da ESTADIC e do governo DF/código 53 não são transplantados para municípios.']
  self.manifest=dict(versao=1,edicao=EDICAO,gerado_em=datetime.now(timezone.utc).isoformat(),base_gerado_em=self.fonte['base_gerado_em'],base_sha256=self.fonte['base_sha256'],base_ipca=self.fonte['base_ipca'],resumo=dict(municipios=cities,ano_de=first,ano_ate=last,variaveis=len(self.rows),linhas=n,variaveis_detalhadas=len(self.advanced)-len(KEYS)),notas=notes,areas=self.fonte['areas'],arquivos=self.p.files,parcial=False,stata=dict(versao=118,minimo=14,painel_declarado=declared,chave=['cod_ibge','ano']),criterios=self.config['criterios'])
  assert sha(file)==origin['sha256'] and sha(self.base/'gold/manifesto.json')==self.fonte['base_sha256'],'A fonte mudou durante a preparação'
  salvar_json(self.work/'dicionario_principal.json',self.dictionary);salvar_json(self.work/'dicionario_complementos.json',self.advanced)
  salvar_json(self.dest/'manifesto.json',self.manifest)
  finalizar(self.root)

 def processar_stata(self,exe):
  exe=exe.resolve();assert exe.is_file(),str(exe)
  script=self.work/'preparar_stata.do';marker=self.work/'stata_ok.txt';log=self.work/'stata.log'
  lines=['version 14','clear all','set more off','capture log close _all',f'log using "{log.as_posix()}", text replace']
  for item in self.pending:
   file=Path(item['path']).as_posix();lines.extend([f'use "{file}", clear',f'assert _N=={item["meta"]["linhas"]}','assert ano>=2013 & ano<.','assert inrange(cod_ibge,1000000,9999999)','isid cod_ibge ano','xtset cod_ibge ano, yearly','format cod_ibge %07.0f','compress',f'saveold "{file}", version(14) replace'])
  lines.extend([f'file open finbra_ok using "{marker.as_posix()}", write replace','file write finbra_ok "OK"','file close finbra_ok','log close','exit, clear']);script.write_text('\n'.join(lines)+'\n',encoding='utf-8')
  if marker.exists():marker.unlink()
  kwargs={}
  if sys.platform=='win32':
   startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0;kwargs=dict(startupinfo=startup,creationflags=subprocess.CREATE_NO_WINDOW)
  subprocess.run([str(exe),'/e','do',str(script)],cwd=self.work,timeout=600,check=True,**kwargs)
  if not marker.exists() or marker.read_text().strip()!='OK':raise RuntimeError('Stata não concluiu; veja '+str(log))
  print(json.dumps(dict(stata_native_ok=True,arquivos=len(self.pending))),flush=True)

 def complementos(self):
  tables=set()
  for a in self.fonte['arquivos']:
   if a['tipo']!='detalhado' or a['ano_ate']<self.year:continue
   assert a['ano_de']>=self.year,'A fonte detalhada precisa ser recortada antes de reutilizar: '+a['id']
   source=self.origem/a['caminho'];assert sha(source)==a['sha256'];dest=self.root/a['caminho']
   if dest.exists():assert sha(dest)==a['sha256']
   else:shutil.copyfile(source,dest)
   self.p.files.append({**a,'escopo':'detalhado'})
   tables.add(a['id'].removesuffix('_parquet').removesuffix('_csv_zip'))
  self.advanced=[]
  for d in self.raw_dictionary:
   if d['variavel'] in KEYS and d['tabela']=='painel':
    x=copy.deepcopy(d);years=[y for y in x.get('anos_observados',[]) if y>=self.year];x.update(anos_observados=years,ano_de=min(years) if years else None,ano_ate=max(years) if years else None);self.advanced.append(x)
   elif d['tabela'] in tables:
    x=copy.deepcopy(d);years=[y for y in x.get('anos_observados',[]) if y>=self.year];x.update(anos_observados=years,ano_de=min(years) if years else None,ano_ate=max(years) if years else None);self.advanced.append(x)


def finalizar(root,excel=None):
 root=destino_isolado(root);mp=root/'gold/downloads/manifesto.json';m=ler(mp);assert m['edicao']==EDICAO
 dictionary=ler(root/'trabalho_downloads/dicionario_principal.json');advanced=ler(root/'trabalho_downloads/dicionario_complementos.json')
 m['arquivos']=[a for a in m['arquivos'] if a['tipo'] in ['painel','area','detalhado']]
 def register(path,id,tipo,fmt,nome,escopo=None,rows=None):
  digest=sha(path);dest=root/'gold/downloads'/(id+'_'+digest[:12]+'.'+fmt)
  if not dest.exists():shutil.copyfile(path,dest)
  else:assert sha(dest)==digest
  obj=dict(id=id,tipo=tipo,area=None,nome=nome,nome_en=nome,descricao=nome,descricao_en=nome,formato=fmt,caminho=dest.relative_to(root).as_posix(),bytes=dest.stat().st_size,sha256=digest,linhas=rows,variaveis=None,ano_de=None,ano_ate=None,uf=None)
  if escopo:obj['escopo']=escopo
  if fmt=='zip' or fmt=='csv.zip':
   with zipfile.ZipFile(dest) as z:obj['bytes_extraido']=sum(x.file_size for x in z.infolist())
  m['arquivos'].append(obj);return obj
 for entries,name,scope in [(dictionary,'dicionario','principal'),(advanced,'dicionario_complementos','detalhado')]:
  file=root/'trabalho_downloads'/(name+'.json');salvar_json(file,entries);obj=register(file,name+'_json','dicionario','json','Dicionário '+('da base enxuta' if scope=='principal' else 'dos complementos'),scope,len(entries))
  if scope=='principal':m['dicionario']={k:obj[k] for k in ['caminho','bytes','sha256']}
  plain=file.with_suffix('.csv');fields=list(dict.fromkeys(k for d in entries for k in d))
  with plain.open('w',encoding='utf-8-sig',newline='') as f:
   w=csv.DictWriter(f,fieldnames=fields,delimiter=';');w.writeheader();w.writerows(entries)
  zipped=file.with_suffix('.csv.zip')
  with zipfile.ZipFile(zipped,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:z.write(plain,name+'.csv')
  register(zipped,name+'_csv','dicionario','csv.zip','Dicionário '+('da base enxuta' if scope=='principal' else 'dos complementos'),scope,len(entries))
 if excel:
  validar_excel(excel,dictionary);register(excel,'dicionario_excel','dicionario','xlsx','Dicionário da base enxuta — Excel','principal',len(dictionary))
 notes=root/'trabalho_downloads/LEIA-ME.txt';notes.write_text('FINBRA — BASE MUNICIPAL ENXUTA\n\n'+'\n\n'.join(m['notas'])+'\n\nStata: abra o .dta diretamente. O painel já está declarado quando indicado na página. Use xtset cod_ibge ano. CSV: UTF-8 BOM, separador ; e decimal vírgula.\n',encoding='utf-8')
 register(notes,'metodologia','metodologia','txt','Como usar a base enxuta')
 do=root/'trabalho_downloads/abrir_painel.do';do.write_text('version 14\nset more off\n* Primeiro abra o arquivo .dta pelo menu File > Open.\n* Estes comandos conferem e declaram o painel municipal anual.\nisid cod_ibge ano\nxtset cod_ibge ano, yearly\ndescribe\n',encoding='utf-8');register(do,'comandos_stata','metodologia','do','Exemplo de comandos para Stata')
 if excel:
  zipped=root/'trabalho_downloads/base_enxuta_completa.zip'
  with zipfile.ZipFile(zipped,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as target:
   members=[a for a in m['arquivos'] if (a['tipo']=='painel' and a['uf'] is None) or (a['tipo']=='dicionario' and a.get('escopo')=='principal' and a['formato'] in ['csv.zip','xlsx']) or a['tipo']=='metodologia']
   for a in members:
    source=root/a['caminho']
    if a['formato']=='csv.zip':
     with zipfile.ZipFile(source) as z:
      name=z.namelist()[0]
      with z.open(name) as src,target.open(name,'w',force_zip64=True) as dst:shutil.copyfileobj(src,dst,8*1024*1024)
    else:target.write(source,a['id']+'.'+a['formato'])
  register(zipped,'pacote_enxuto','pacote','zip','Base enxuta + Stata + dicionário')
 salvar_json(mp,m);print(json.dumps(dict(ok=True,edicao=EDICAO,resumo=m['resumo'],arquivos=len(m['arquivos']),excel=bool(excel))),flush=True)


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='comando',required=True)
 g=sub.add_parser('gerar');g.add_argument('--origem',type=Path,required=True);g.add_argument('--saida',type=Path,required=True);g.add_argument('--base',type=Path,default=Path('E:/finbra/data'));g.add_argument('--stata',type=Path)
 f=sub.add_parser('finalizar');f.add_argument('--raiz',type=Path,required=True);f.add_argument('--excel',type=Path,required=True)
 args=parser.parse_args()
 if args.comando=='gerar':Enxuto(args.origem,args.saida,args.base).gerar(args.stata)
 else:finalizar(args.raiz,args.excel)
