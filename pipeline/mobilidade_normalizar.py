"""Normaliza somente o cache Senatran para tabelas municipais pequenas."""
import argparse, io, json, re, zipfile, subprocess, os
from pathlib import Path
import numpy as np
import pandas as pd
from mobilidade_fontes import compacto,sha,norm

def chave(x):return re.sub(r'[^a-z0-9]','',norm(x))

def agrupar_idades(x,ano,coluna_fabricacao,coluna_quantidade):
 f=pd.to_numeric(x[coluna_fabricacao],errors='coerce');valid=(f>=1900)&(f<=ano)&(f%1==0);idade=ano-f;qty=x[coluna_quantidade]
 z=x[['uf','municipio']].copy();z['idade_total']=qty;z['idade_validos']=qty.where(valid,0);z['idade_anos_soma']=(qty*idade).where(valid,0).astype('int64')
 for col,mask in [('idade_0_4',idade.between(0,4)),('idade_5_9',idade.between(5,9)),('idade_10_19',idade.between(10,19)),('idade_20_mais',idade>=20)]:z[col]=qty.where(valid&mask,0)
 z['idade_sem_ano']=qty.where(~valid,0);return z.groupby(['uf','municipio'],as_index=False).sum(numeric_only=True)

def ler_planilha(path,work):
 data=path.read_bytes();name=path.name
 if data.startswith(b'Rar!'):
  flags={'creationflags':subprocess.CREATE_NO_WINDOW}if os.name=='nt'else{}
  names=subprocess.check_output(['tar','-tf',str(path)],**flags).decode('utf-8').splitlines();names=[n for n in names if re.search(r'\.(xls|xlsx)$',n,re.I)];assert len(names)==1,names
  name=names[0]
  seven=Path('C:/Program Files/7-Zip/7z.exe')
  data=subprocess.check_output([str(seven),'e','-so',str(path),name],**flags)if seven.exists()else subprocess.check_output(['tar','-xOf',str(path),name],**flags)
 if zipfile.is_zipfile(io.BytesIO(data)):
  with zipfile.ZipFile(io.BytesIO(data))as z:
   if'xl/workbook.xml'not in z.namelist():
    names=[n for n in z.namelist()if re.search(r'\.(xls|xlsx|mdb|csv)$',n,re.I)]
    if len(names)!=1:raise ValueError('Arquivo compactado ambíguo: '+str(names))
    name=names[0];data=z.read(name)
 if name.lower().endswith('.mdb'):
  import pyodbc
  p=work/(path.stem+'.mdb')
  if not p.exists():p.write_bytes(data)
  assert sha(p.read_bytes())==sha(data)
  c=pyodbc.connect('DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ='+str(p)+';READONLY=TRUE;')
  try:
   tables=[t.table_name for t in c.cursor().tables(tableType='TABLE')];main=[t for t in tables if'quantidadeveiculos'in chave(t)];assert len(main)==1,tables
   errors={t:c.cursor().execute('SELECT count(*) FROM ['+t.replace(']',']]')+']').fetchone()[0]for t in tables if'importerrors'in chave(t)}
   cur=c.cursor().execute('SELECT * FROM ['+main[0].replace(']',']]')+']');df=pd.DataFrame.from_records(cur.fetchall(),columns=[d[0]for d in cur.description]);df.attrs['import_errors']=errors;return df
  finally:c.close()
 x=pd.ExcelFile(io.BytesIO(data),engine='calamine');sheet=next(n for n in x.sheet_names if'gloss'not in norm(n));sample=pd.read_excel(x,sheet_name=sheet,header=None,nrows=16)
 header=next(j for j,row in sample.iterrows()if'uf'in [chave(v)for v in row]and'municipio'in [chave(v)for v in row])
 return pd.read_excel(x,sheet_name=sheet,header=header)

def normalizar(fontes):
 fontes=Path(fontes).resolve();work=fontes/'normalizados';work.mkdir(exist_ok=True);m=json.loads((fontes/'senatran.json').read_bytes());g=json.loads((fontes/'geografia.json').read_bytes());ufs={chave(uf):uf for _,_,uf in g['governos']};ufs.update({chave(nome):uf for _,nome,uf in g['governos']});report=[]
 for ref in m['arquivos']:
  path=fontes/ref['arquivo'];assert sha(path.read_bytes())==ref['sha256'];y=ref['ano'];kind=ref['tipo'];out=work/f'{y}_{kind}.parquet';meta=out.with_suffix('.json')
  if out.exists()and meta.exists():
   d=json.loads(meta.read_bytes());assert d['origem_sha256']==ref['sha256']and d['sha256']==sha(out.read_bytes());report.append(d);continue
  print(json.dumps(dict(lendo=y,tipo=kind,arquivo=path.name)),flush=True)
  x=ler_planilha(path,work);import_errors=x.attrs.get('import_errors',{});x.columns=[chave(k)for k in x.columns];assert'uf'in x and'municipio'in x
  x['uf']=x['uf'].astype(str).map(chave).map(ufs);x=x[x['uf'].notna()].copy();x['municipio']=x['municipio'].astype(str).str.strip();keys=['uf','municipio']
  if kind=='tipo':
   cols=[k for k in x.columns if k not in keys];x[cols]=x[cols].apply(pd.to_numeric,errors='raise');assert x[cols].notna().all().all();assert(x[cols]>=0).all().all();x[cols]=x[cols].astype('int64');assert (x['total']==x[[k for k in cols if k!='total']].sum(axis=1)).all();x=x.groupby(keys,as_index=False).sum(numeric_only=True)
  else:
   qty=next(k for k in x if k in ['qtdveiculos','qtdeveiculos','qtdeveiculo','qtddeveiculos']);x[qty]=pd.to_numeric(x[qty],errors='raise');assert x[qty].notna().all()and(x[qty]>=0).all()and(x[qty]%1==0).all();x[qty]=x[qty].astype('int64')
   if kind=='combustivel':
    label=next(k for k in x if'combust'in k);x=x.rename(columns={label:'combustivel',qty:'quantidade'});x['combustivel']=x['combustivel'].fillna('Sem informação').astype(str).str.strip();x=x.groupby(keys+['combustivel'],as_index=False)['quantidade'].sum()
   else:
    x=agrupar_idades(x,y,next(k for k in x if'fabr'in k),qty)
  x.to_parquet(out,index=False,compression='zstd');d=dict(ano=y,tipo=kind,linhas=len(x),origem_sha256=ref['sha256'],arquivo=out.relative_to(fontes).as_posix(),sha256=sha(out.read_bytes()),registros_log_importacao=import_errors);meta.write_bytes(compacto(d));report.append(d);print(json.dumps(d),flush=True)
 (fontes/'normalizados.json').write_bytes(compacto(dict(ok=True,arquivos=report)))

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--fontes',required=True,type=Path);a=p.parse_args();normalizar(a.fontes)
