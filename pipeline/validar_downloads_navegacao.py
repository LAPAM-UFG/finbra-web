"""Audita os objetos novos contra a base enxuta publicada, sem alterar fontes."""
import argparse
import copy
import csv
import hashlib
import io
import json
import math
import zipfile
from pathlib import Path

import pandas as pd
import pyarrow.compute as pc
import pyarrow.parquet as pq

from downloads_enxuto import ler,preparar_stata
from downloads_navegacao import objetos
from painel_municipal import KEYS,sha


def igual(x,y):
 if x is None or pd.isna(x):return y is None
 return x==y


def validar(root,origem):
 m=ler(root/'gold/downloads/manifesto.json');old=ler(origem/'gold/downloads/manifesto.json')
 assert m['resumo']==old['resumo'] and m['dicionario']==old['dicionario'] and m['base_sha256']==old['base_sha256']
 refs,files=objetos(root,m);ids={a['id']:a for a in files};dictionary=ler(root/m['dicionario']['caminho'])
 assert len(ids)==len(files) and len(m['recortes_uf'])==27 and m['stata']['painel_declarado']
 for ref in refs:
  f=root/ref['caminho'];assert f.stat().st_size==ref['bytes'] and sha(f)==ref['sha256'],ref['caminho']
 for a in old['arquivos']:
  assert a['caminho']==ids[a['id']]['caminho'] and a['sha256']==ids[a['id']]['sha256']
  assert sha(origem/a['caminho'])==a['sha256']
 print(json.dumps(dict(objetos_conferidos=len(refs),anteriores_preservados=len(old['arquivos']))),flush=True)
 native=0;cells=0;preview_count=0;sample_cells=0;csv_cells=0;parquets=0
 for a in files:
  if a['tipo'] not in ['painel','area'] or a['formato']!='parquet':continue
  tab=pq.read_table(root/a['caminho']);frame=tab.to_pandas();assert len(frame)==a['linhas'] and len(frame.columns)==a['variaveis']+6
  assert frame.ano.min()==a['ano_de']>=2013 and frame.ano.max()==a['ano_ate']
  assert not frame.duplicated(['cod_ibge','ano']).any() and frame.columns[:6].tolist()==KEYS
  if a['uf']:assert (frame.uf==a['uf']).all()
  # Existing national/UF files are byte-identical; verify every new UF/topic
  # against the matching rows of the published national topic file.
  if a['tipo']=='area' and a['uf']:
   source=next(v for v in old['arquivos'] if v['tipo']=='area' and v['area']==a['area'] and v['formato']=='parquet')
   truth=pq.read_table(origem/source['caminho']);expected=truth.filter(pc.equal(truth['uf'],a['uf'])).to_pandas()
   pd.testing.assert_frame_equal(frame.reset_index(drop=True),expected.reset_index(drop=True),check_dtype=False,check_exact=True)
   dta=ids[a['id'].removesuffix('_parquet')+'_dta'];actual=pd.read_stata(root/dta['caminho'],convert_categoricals=False,convert_dates=False)
   expected,labels=preparar_stata(frame,copy.deepcopy(dictionary))
   pd.testing.assert_frame_equal(actual,expected,check_dtype=False,check_exact=True,check_categorical=False)
   with pd.io.stata.StataReader(root/dta['caminho']) as reader:
    variables=reader.variable_labels();categories=reader.value_labels()
   by={d['variavel']:d for d in dictionary}
   for k in frame:
    assert variables[k].strip()==by[k]['nome'][:80].strip()
    if k in labels:assert categories[k]==labels[k]
   native+=1;cells+=actual.size
   zipped=ids[a['id'].removesuffix('_parquet')+'_csv_zip']
   with zipfile.ZipFile(root/zipped['caminho']) as z:
    assert z.testzip() is None and len(z.namelist())==1
    with z.open(z.namelist()[0]) as f:
     assert f.read(3)==b'\xef\xbb\xbf'
     reader=csv.reader(io.TextIOWrapper(f,encoding='utf-8'),delimiter=';');assert next(reader)==frame.columns.tolist()
     for i,row in enumerate(reader):
      assert len(row)==len(frame.columns)
      if i<2:
       for text,v in zip(row,frame.iloc[i]):
        if pd.isna(v):ok=text==''
        elif isinstance(v,bool):ok=text==str(v).lower()
        elif isinstance(v,(int,float)):
         ok=math.isclose(float(text.replace(',','.')),float(v),rel_tol=1e-14,abs_tol=1e-12)
        else:ok=text==("'"+str(v) if str(v).startswith(('=','+','@','-')) else str(v))
        assert ok,(a['id'],text,v);csv_cells+=1
     assert i+1==len(frame)
  v=ler(root/a['previa']['caminho']);assert v['uf']==a['uf'] and v['area']==a['area'] and v['linhas_total']==len(frame)
  assert [c['variavel'] for c in v['colunas']]==frame.columns.tolist()
  by={d['variavel']:d for d in dictionary}
  for c in v['colunas']:
   k=c['variavel'];assert c['nome']==by[k]['nome'] and c['unidade']==by[k]['unidade']
   assert c['preenchidas']==len(tab)-tab[k].null_count
   years=sorted(pc.filter(tab['ano'],pc.is_valid(tab[k])).unique().to_pylist());assert c['anos']==years
  assert 1<=len(v['amostra'])<=5
  for row in v['amostra']:
   truth=frame.loc[(frame.cod_ibge==row['cod_ibge']) & (frame.ano==row['ano'])];assert len(truth)==1
   assert set(row)==set(frame.columns)
   for k in row:assert igual(truth.iloc[0][k],row[k]),(a['id'],k,row[k]);sample_cells+=1
  preview_count+=1;parquets+=1
  print(json.dumps(dict(parquet=a['id'],linhas=len(frame))),flush=True)
 for fmt in ['dta','csv.zip','parquet']:
  package=next(a for a in files if a.get('conteudo')==fmt);source=next(a for a in files if a['tipo']=='painel' and a['uf'] is None and a['formato']==fmt)
  with zipfile.ZipFile(root/package['caminho']) as z:
   assert z.testzip() is None and sum(a.file_size for a in z.infolist())==package['bytes_extraido']
   data=[n for n in z.namelist() if n.startswith('painel_brasil')];assert len(data)==1
   assert data[0].endswith('.csv' if fmt=='csv.zip' else '.'+fmt)
   def digest(stream):
    h=hashlib.sha256()
    while b:=stream.read(2**20):h.update(b)
    return h.hexdigest()
   with z.open(data[0]) as stream:actual=digest(stream)
   if fmt=='csv.zip':
    with zipfile.ZipFile(root/source['caminho']) as source_zip:
     with source_zip.open(source_zip.namelist()[0]) as stream:assert actual==digest(stream)
   else:assert actual==source['sha256']
   assert 'dicionario_excel.xlsx' in z.namelist() and 'dicionario.csv' in z.namelist() and 'dicionario_json.json' in z.namelist()
 assert native==162 and parquets==196 and preview_count==196
 assert (root/'trabalho_downloads/stata_ok.txt').read_text().strip()=='OK'
 return dict(ok=True,manifesto_sha256=sha(root/'gold/downloads/manifesto.json'),objetos=len(refs),arquivos=len(files),anteriores_preservados=len(old['arquivos']),stata_novos=native,stata_celulas=cells,previas=preview_count,amostra_celulas=sample_cells,csv_celulas=csv_cells,manifesto_bytes=(root/'gold/downloads/manifesto.json').stat().st_size)


if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--raiz',type=Path,required=True);p.add_argument('--origem',type=Path,required=True);p.add_argument('--relatorio',type=Path,required=True);a=p.parse_args()
 result=validar(a.raiz,a.origem);a.relatorio.write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result),flush=True)
