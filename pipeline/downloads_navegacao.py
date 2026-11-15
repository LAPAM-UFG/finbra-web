"""Acrescenta recortes UF × tema, prévias leves e ZIP por formato à base enxuta.

Reutiliza os arquivos publicados sem modificar seus valores. Catálogos de UF e
prévias são carregados pela página somente quando solicitados.
"""
import argparse
import copy
import json
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado, salvar_json
from downloads_enxuto import Enxuto, ler
from painel_municipal import Painel, KEYS, qi, qs, sha


def escalar(value):
 if pd.isna(value):return None
 return value.item() if isinstance(value,np.generic) else value


def previa(frame, dictionary, item):
 """Amostra real de até cinco anos de um município; cobertura do arquivo inteiro."""
 by={d['variavel']:d for d in dictionary};columns=[]
 for name in frame:
  present=frame[name].notna();d=by[name]
  columns.append(dict(variavel=name,nome=d['nome'],unidade=d['unidade'],anos=sorted(int(y) for y in frame.loc[present,'ano'].unique()),preenchidas=int(present.sum())))
 code=5208707 if (frame.cod_ibge==5208707).any() else int(frame.cod_ibge.min())
 city=frame.loc[frame.cod_ibge==code].sort_values('ano')
 indexes=np.unique(np.linspace(0,len(city)-1,min(5,len(city)),dtype=int))
 sample=[{k:escalar(row[k]) for k in frame} for _,row in city.iloc[indexes].iterrows()]
 return dict(versao=1,id=item['id'].removesuffix('_parquet'),uf=item['uf'],area=item['area'],linhas_total=len(frame),ano_de=int(frame.ano.min()),ano_ate=int(frame.ano.max()),colunas=columns,amostra=sample)


def referencia(root,work,name,value):
 file=work/(name+'.json');file.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf-8')
 return registrar(root,file,name,'json')


def registrar(root,file,name,fmt):
 digest=sha(file);dest=root/'gold/downloads'/(name+'_'+digest[:12]+'.'+fmt)
 if dest.exists():assert sha(dest)==digest
 else:shutil.copyfile(file,dest)
 return dict(caminho=dest.relative_to(root).as_posix(),bytes=dest.stat().st_size,sha256=digest)


def pacote(root,work,m,fmt):
 data=next(a for a in m['arquivos'] if a['tipo']=='painel' and a['uf'] is None and a['formato']==fmt)
 sources=[data]+[a for a in m['arquivos'] if (a['tipo']=='dicionario' and a.get('escopo')=='principal') or a['tipo']=='metodologia']
 file=work/('pacote_brasil_'+fmt.replace('.','_')+'.zip')
 with zipfile.ZipFile(file,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as target:
  for a in sources:
   source=root/a['caminho']
   if a['formato']=='csv.zip':
    with zipfile.ZipFile(source) as z:
     for entry in z.infolist():
      with z.open(entry) as src,target.open(entry.filename,'w',force_zip64=True) as dst:shutil.copyfileobj(src,dst,8*1024*1024)
   else:target.write(source,a['id']+'.'+a['formato'])
 ref=registrar(root,file,'pacote_brasil_'+fmt.replace('.','_'),'zip')
 with zipfile.ZipFile(file) as z:extracted=sum(x.file_size for x in z.infolist())
 label={'dta':'Stata','csv.zip':'CSV','parquet':'Parquet'}[fmt]
 name=f'Brasil — {label} + dicionário'
 return dict(id='pacote_brasil_'+fmt.replace('.','_'),tipo='pacote',area=None,uf=None,nome=name,nome_en=f'Brazil — {label} + dictionary',descricao='Um único formato de dados, dicionário e instruções.',descricao_en='One data format, dictionary and instructions.',formato='zip',conteudo=fmt,linhas=data['linhas'],variaveis=data['variaveis'],ano_de=data['ano_de'],ano_ate=data['ano_ate'],bytes_extraido=extracted,**ref)


def objetos(root,m):
 """Todos os objetos alcançáveis, incluindo catálogos e prévias sob demanda."""
 result={}
 def add(ref):
  path=ref['caminho'];file=(root/path).resolve()
  assert file.is_relative_to((root/'gold/downloads').resolve()) and file.name!='manifesto.json'
  meta={k:ref[k] for k in ['caminho','bytes','sha256']}
  if path in result:assert result[path]==meta
  result[path]=meta
 items=list(m['arquivos'])
 for uf,ref in m.get('recortes_uf',{}).items():
  add(ref);catalog=ler(root/ref['caminho']);assert catalog['versao']==1 and catalog['uf']==uf
  assert all(a['uf']==uf and a['tipo']=='area' for a in catalog['arquivos'])
  items.extend(catalog['arquivos'])
 for a in items:
  add(a)
  if a.get('previa'):add(a['previa'])
 add(m['dicionario'])
 return list(result.values()),items


class Navegacao(Enxuto):
 def __init__(self,origem,saida,base):
  self.origem=origem.resolve();self.root=destino_isolado(saida,self.origem);self.base=base.resolve();destino_isolado(self.root,self.base)
  self.work=self.root/'trabalho_downloads';self.dest=self.root/'gold/downloads'
  if not self.dest.resolve().is_relative_to(self.root):raise ValueError('Pasta redirecionada para fora da candidata')
  self.fonte=ler(self.origem/'gold/downloads/manifesto.json')
  assert self.fonte['edicao']=='enxuta_2013' and 200<=self.fonte['resumo']['variaveis']<=300
  assert self.fonte['base_sha256']==sha(self.base/'gold/manifesto.json')
  self.dictionary=copy.deepcopy(ler(self.origem/self.fonte['dicionario']['caminho']))
  self.work.mkdir(parents=True,exist_ok=True);self.dest.mkdir(parents=True,exist_ok=True)
  self.db=duckdb.connect();self.db.execute("SET threads=2; SET memory_limit='2GB'")
  self.p=Painel.__new__(Painel);self.p.db=self.db;self.p.root=self.root;self.p.work=self.work;self.p.dest=self.dest;self.p.files=[]
  self.pending=[]

 def gerar(self,stata):
  m=copy.deepcopy(self.fonte)
  for a in m['arquivos']:
   source=self.origem/a['caminho'];assert sha(source)==a['sha256']
   dest=self.root/a['caminho']
   if dest.exists():assert sha(dest)==a['sha256']
   else:shutil.copyfile(source,dest)
  for a in self.fonte['arquivos']:
   if a['tipo']!='area' or a['formato']!='parquet' or a['uf']:continue
   source=self.root/a['caminho'];query='SELECT * FROM read_parquet('+qs(source.as_posix())+')'
   for uf, in self.db.execute('SELECT DISTINCT uf FROM ('+query+') ORDER BY uf').fetchall():
    self.exportar(a['id'].removesuffix('_parquet')+'_'+uf.lower(),query+' WHERE uf='+qs(uf)+' ORDER BY cod_ibge,ano',a['nome']+' — '+uf,area=a['area'],uf=uf)
  self.processar_stata(stata)
  for f in self.pending:self.registrar(Path(f['path']),f['id'],f['tipo'],'dta',f['nome'],**f['meta'])
  # One preview per logical dataset, reused by its three formats.
  all_items=m['arquivos']+self.p.files;refs={}
  for a in all_items:
   if a['tipo'] not in ['painel','area'] or a['formato']!='parquet':continue
   key=(a['tipo'],a['area'],a['uf']);frame=pq.read_table(self.root/a['caminho']).to_pandas()
   ref=referencia(self.root,self.work,'previa_'+a['id'].removesuffix('_parquet'),previa(frame,self.dictionary,a));refs[key]=ref
  for a in all_items:
   if a['tipo'] in ['painel','area']:a['previa']=refs[(a['tipo'],a['area'],a['uf'])]
  m['recortes_uf']={}
  for uf in sorted({a['uf'] for a in self.p.files}):
   catalog=dict(versao=1,uf=uf,arquivos=[a for a in self.p.files if a['uf']==uf])
   m['recortes_uf'][uf]=referencia(self.root,self.work,'catalogo_'+uf.lower(),catalog)
  for fmt in ['dta','csv.zip','parquet']:m['arquivos'].append(pacote(self.root,self.work,m,fmt))
  m.update(navegacao=1,gerado_em=datetime.now(timezone.utc).isoformat())
  refs,items=objetos(self.root,m)
  assert self.fonte['base_sha256']==sha(self.base/'gold/manifesto.json')
  salvar_json(self.dest/'manifesto.json',m)
  salvar_json(self.work/'objetos.json',refs)
  salvar_json(self.work/'resumo.json',dict(arquivos=len(items),objetos=len(refs),recortes_uf_tema=len(self.pending),previas=len({a['previa']['caminho'] for a in items if a.get('previa')}),manifesto_bytes=(self.dest/'manifesto.json').stat().st_size))
  print(json.dumps(ler(self.work/'resumo.json')),flush=True)


if __name__=='__main__':
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--origem',type=Path,required=True);parser.add_argument('--saida',type=Path,required=True);parser.add_argument('--base',type=Path,default=Path('E:/finbra/data'));parser.add_argument('--stata',type=Path,required=True);args=parser.parse_args()
 Navegacao(args.origem,args.saida,args.base).gerar(args.stata)
