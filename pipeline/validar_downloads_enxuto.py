"""Confere a base reduzida contra a fonte ampla e os três formatos entre si."""
import argparse
import csv
import io
import json
import math
import zipfile
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow.parquet as pq

from downloads_enxuto import EDICAO,ler,preparar_stata,validar_selecao
from painel_municipal import KEYS,qi,qs,sha


def validar(root,origem):
 root=root.resolve();origem=origem.resolve();m=ler(root/'gold/downloads/manifesto.json');assert m['edicao']==EDICAO and m['resumo']['ano_de']>=2013 and m['stata']['painel_declarado']
 dictionary=ler(root/m['dicionario']['caminho']);config=ler(Path(__file__).with_name('downloads_selecao.json'))
 raw=ler(origem/'gold/downloads/manifesto.json');rawdict=ler(origem/raw['dicionario']['caminho']);selection=validar_selecao(config,rawdict)
 columns=KEYS+[r['variavel'] for r in selection];assert [d['variavel'] for d in dictionary]==columns
 assert len(columns)-len(KEYS)==m['resumo']['variaveis'] and 200<=m['resumo']['variaveis']<=300
 assert all(len(k)<=32 for k in columns)
 assert all(d['ano_de'] is None or d['ano_de']>=2013 for d in dictionary)
 db=duckdb.connect();db.execute("SET threads=2;SET memory_limit='3GB'")
 main=next(a for a in m['arquivos'] if a['id']=='painel_brasil_parquet');source=next(a for a in raw['arquivos'] if a['id']=='painel_brasil_parquet')
 assert sha(origem/source['caminho'])==source['sha256']
 db.execute('CREATE VIEW painel AS SELECT * FROM read_parquet('+qs((root/main['caminho']).as_posix())+')')
 db.execute('CREATE VIEW fonte AS SELECT * FROM read_parquet('+qs((origem/source['caminho']).as_posix())+') WHERE ano>=2013')
 def valor(sql):return db.execute(sql).fetchone()[0]
 assert valor('SELECT count(*) FROM painel')==m['resumo']['linhas']==valor('SELECT count(*) FROM fonte')
 assert not valor('SELECT count(*) FROM painel WHERE ano<2013 OR ano IS NULL OR cod_ibge IS NULL OR cod_ibge NOT BETWEEN 1000000 AND 9999999')
 assert not valor('SELECT count(*) FROM (SELECT cod_ibge,ano,count(*) n FROM painel GROUP BY 1,2 HAVING n>1)')
 assert valor('SELECT count(*) FROM painel p JOIN fonte s ON p.cod_ibge=cast(s.cod_ibge AS INTEGER) AND p.ano=s.ano')==m['resumo']['linhas']
 comparisons=[f'p.{qi(k)} IS DISTINCT FROM s.{qi(k)}' for k in KEYS[1:]]+[f'p.{qi(r["variavel"])} IS DISTINCT FROM s.{qi(r["origem"])}' for r in selection]
 for start in range(0,len(comparisons),32):
  assert not valor('SELECT count(*) FROM painel p JOIN fonte s ON p.cod_ibge=cast(s.cod_ibge AS INTEGER) AND p.ano=s.ano WHERE '+' OR '.join(comparisons[start:start+32])),'Divergência com a fonte'
 print(json.dumps(dict(fonte_ampla_conferida=True,campos=len(columns))),flush=True)
 ids={a['id']:a for a in m['arquivos']};checked=0;dta_files=0;parquets=0;csv_files=0;csv_cells=0;stata_cells=0
 for a in m['arquivos']:
  path=(root/a['caminho']).resolve();assert path.is_relative_to((root/'gold/downloads').resolve())
  assert path.is_file() and path.stat().st_size==a['bytes'] and sha(path)==a['sha256'],a['id'];checked+=1
  if a['tipo'] in ['painel','area','detalhado']:
   assert a['ano_de']>=2013 and a['ano_ate']>=a['ano_de']
  if a['formato']=='parquet':
   pf=pq.ParquetFile(path);assert pf.metadata.num_rows==a['linhas'];assert len(pf.schema_arrow)==a['variaveis']+len(KEYS)
   assert pf.schema_arrow.names[:6]==KEYS
   assert db.execute('SELECT min(ano),max(ano) FROM read_parquet(?)',[path.as_posix()]).fetchone()==(a['ano_de'],a['ano_ate'])
   if a['tipo'] in ['painel','area']:
    names=pf.schema_arrow.names;pred='uf='+qs(a['uf']) if a['uf'] else 'true'
    if a['tipo']=='area':pred=' OR '.join(qi(k)+' IS NOT NULL' for k in names if k not in KEYS)
    expected='SELECT '+','.join(qi(k) for k in names)+' FROM painel WHERE '+pred
    actual='SELECT * FROM read_parquet('+qs(path.as_posix())+')'
    assert not valor('SELECT count(*) FROM (('+actual+' EXCEPT ALL '+expected+') UNION ALL ('+expected+' EXCEPT ALL '+actual+'))'),a['id']
   parquets+=1
  elif a['formato']=='dta':
   assert a['tipo'] in ['painel','area'];pair=ids[a['id'].removesuffix('_dta')+'_parquet'];frame=pq.read_table(root/pair['caminho']).to_pandas();expected,labels=preparar_stata(frame,dictionary)
   actual=pd.read_stata(path,convert_categoricals=False,convert_dates=False)
   pd.testing.assert_frame_equal(actual.sort_values(['cod_ibge','ano']).reset_index(drop=True),expected.sort_values(['cod_ibge','ano']).reset_index(drop=True),check_dtype=False,check_exact=True,check_categorical=False)
   with pd.io.stata.StataReader(path) as reader:
    readlabels=reader.variable_labels();value_labels=reader.value_labels()
   for k in actual:
    name=next(d['nome'][:80].strip() for d in dictionary if d['variavel']==k);assert readlabels[k].strip()==name,(a['id'],k,'rótulo')
    if k in labels:assert value_labels[k]==labels[k],(a['id'],k,'categorias')
   with path.open('rb') as f:assert b'<release>118</release>' in f.read(128)
   dta_files+=1;stata_cells+=actual.size
   print(json.dumps(dict(stata=a['id'],linhas=len(actual),campos=len(actual.columns))),flush=True)
  elif a['formato']=='csv.zip':
   with zipfile.ZipFile(path) as z:
    assert len(z.namelist())==1
    with z.open(z.namelist()[0]) as stream:
     assert stream.read(3)==b'\xef\xbb\xbf'
     reader=csv.reader(io.TextIOWrapper(stream,encoding='utf-8'),delimiter=';');header=next(reader)
     if a['tipo'] in ['painel','area','detalhado']:
      par=ids[a['id'].removesuffix('_csv_zip')+'_parquet'];p=root/par['caminho'];names=pq.read_schema(p).names;assert header==names
      for i,row in enumerate(reader):
       assert len(row)==len(header)
       if i>=2:break
       truth=db.execute('SELECT * FROM read_parquet(?) WHERE cast(cod_ibge AS VARCHAR)=? AND ano=?',[p.as_posix(),row[0],int(row[5])]).fetchone();assert truth is not None
       for k,text,v in zip(header,row,truth):
        if v is None:ok=text==''
        elif isinstance(v,bool):ok=text==str(v).lower()
        elif isinstance(v,int):ok=int(text)==v
        elif isinstance(v,float):ok=math.isclose(float(text.replace(',','.')),v,rel_tol=1e-14,abs_tol=1e-12)
        else:ok=text==("'"+str(v) if str(v).startswith(('=','+','@','-')) else str(v))
        assert ok,(a['id'],k,text,str(v));csv_cells+=1
     else:
      assert 'variavel' in header and 'ano_de' in header
      for row in reader:
       y=row[header.index('ano_de')];assert not y or int(y)>=2013
   csv_files+=1
  elif a['tipo']=='pacote':
   with zipfile.ZipFile(path) as z:
    assert z.testzip() is None
    assert any(n.endswith('.dta') for n in z.namelist()) and not any(n.startswith('complementos/') for n in z.namelist())
    assert sum(i.file_size for i in z.infolist())==a['bytes_extraido']
    dta=next(v for v in m['arquivos'] if v['id']=='painel_brasil_dta');assert hashlib_sha(z.read('painel_brasil_dta.dta'))==dta['sha256']
 assert dta_files==34 and parquets==51,(dta_files,parquets)
 assert len({a['id'] for a in m['arquivos']})==len(m['arquivos'])
 return dict(ok=True,manifesto_sha256=sha(root/'gold/downloads/manifesto.json'),objetos=checked,stata_arquivos=dta_files,stata_celulas=stata_cells,parquet_arquivos=parquets,csv_arquivos=csv_files,csv_celulas=csv_cells,resumo=m['resumo'])


def hashlib_sha(body):
 import hashlib
 return hashlib.sha256(body).hexdigest()


if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raiz',type=Path,required=True);p.add_argument('--origem',type=Path,required=True);p.add_argument('--relatorio',type=Path,required=True);args=p.parse_args()
 result=validar(args.raiz,args.origem);args.relatorio.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False),flush=True)
