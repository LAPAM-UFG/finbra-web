"""Agrega o SIM definitivo local sem publicar ou alterar microdados."""
import argparse,json,re
from pathlib import Path
import duckdb,pyarrow.parquet as pq
from seguranca_fontes import sha
from seguranca_definicoes import SIM_DEFS,CORE,RACAS,SEXOS,IDADES,ESCOLAS,LOCAIS,MESES,MEIOS_AG,SIM_URL

def agrupar(c):
 cols=','.join(f'count(*)FILTER(WHERE {i["expr"]})AS {id}'for id,i in SIM_DEFS.items())
 return c.execute('SELECT ano,municipio6,uf_codigo,'+cols+' FROM ob GROUP BY 1,2,3 ORDER BY 1,2').fetchdf()
def validar_particoes(x):
 for pre,total in [('ag','sec_agressoes'),('su','sec_suicidios')]:
  for tipo,itens in [('sex',SEXOS),('id',IDADES)]:assert(x[total]==x[[f'sec_{pre}_{tipo}_{a[0]}'for a in itens]].sum(axis=1)).all()
 for tipo,itens,total in [('rc',RACAS,'sec_agressoes'),('esc',ESCOLAS,'sec_ag_15_mais'),('loc',LOCAIS,'sec_agressoes'),('mes',MESES+[('ign','','')],'sec_agressoes')]:assert(x[total]==x[[f'sec_ag_{tipo}_{a[0]}'for a in itens]].sum(axis=1)).all()
 assert(x.sec_armas_fogo==x[['sec_ag_armas','sec_su_armas','sec_in_armas','sec_ac_armas','sec_il_armas']].sum(axis=1)).all()
 assert(x.sec_agressoes==x[['sec_ag_armas',*['sec_ag_meio_'+i[0]for i in MEIOS_AG]]].sum(axis=1)).all()
 for tipo,itens,total in [('rc',RACAS,'sec_suicidios'),('esc',ESCOLAS,'sec_su_15_mais'),('loc',LOCAIS,'sec_suicidios'),('mes',MESES+[('ign','','')],'sec_suicidios')]:
  assert(x[total]==x[[f'sec_su_{tipo}_{a[0]}'for a in itens]].sum(axis=1)).all()
def gerar(micro,fontes):
 root=Path(fontes).resolve();micro=Path(micro).resolve();g=json.loads((root/'geografia.json').read_bytes());ufs={u:int(c.removeprefix('E:'))for c,_,u in g['governos']}
 edicao=json.loads((root/'gold/manifesto.json').read_bytes())['fontes']['sim'];anos=[y for y in edicao['anos']if y>=2013];assert anos==list(range(2013,2025))
 paths=sorted(p for p in micro.glob('DO*.parquet')if re.fullmatch(r'DO[A-Z]{2}\d{4}\.parquet',p.name)and not p.name.startswith('DOBR')and int(p.stem[-4:])in anos)
 assert len(paths)==27*len(anos)
 for y in anos:assert {p.name[2:4]for p in paths if int(p.stem[-4:])==y}==set(ufs)
 fields=['TIPOBITO','DTOBITO','CODMUNRES','CAUSABAS','SEXO','IDADE','RACACOR','ESC','LOCOCOR']
 for p in paths:assert set(fields)<=set(pq.read_schema(p).names),p
 c=duckdb.connect();c.execute("SET threads=3;SET memory_limit='3GB'");c.from_parquet([p.as_posix()for p in paths],filename=True,union_by_name=True).project('filename,'+','.join(fields)).create_view('raw')
 assert c.execute("SELECT count(*)FROM raw WHERE TIPOBITO IS DISTINCT FROM '2'OR right(DTOBITO,4)IS DISTINCT FROM regexp_extract(filename,'(20[0-9]{2})[.]parquet$',1)").fetchone()[0]==0
 c.execute("CREATE VIEW ob AS SELECT cast(right(DTOBITO,4)as INTEGER)ano,try_cast(left(CODMUNRES,6)as INTEGER)municipio6,try_cast(left(CODMUNRES,2)as INTEGER)uf_codigo,upper(left(trim(CAUSABAS),3))cid,replace(upper(trim(CAUSABAS)),'.','')cid4,SEXO,trim(RACACOR)RACACOR,trim(ESC)ESC,trim(LOCOCOR)LOCOCOR,try_cast(substr(DTOBITO,3,2)as INTEGER)mes_obito,CASE WHEN left(IDADE,1)IN('0','1','2','3')THEN 0 WHEN left(IDADE,1)='4'THEN try_cast(substr(IDADE,2,2)as INTEGER)WHEN left(IDADE,1)='5'THEN 100+try_cast(substr(IDADE,2,2)as INTEGER)END idade_anos FROM raw")
 assert c.execute('SELECT count(*)FROM ob WHERE uf_codigo IS NULL OR uf_codigo NOT IN('+','.join(map(str,ufs.values()))+')').fetchone()[0]==0
 x=agrupar(c);validar_particoes(x);x['uf']=x.uf_codigo.map({v:k for k,v in ufs.items()});out=root/'sim_seguranca.parquet';x.to_parquet(out,index=False,compression='zstd')
 refs=[]
 for j,p in enumerate(paths):
  refs.append(dict(arquivo=p.name,bytes=p.stat().st_size,sha256=sha(p),url='https://ftp.datasus.gov.br/dissemin/publicos/SIM/CID10/DORES/'+p.stem+'.dbc'))
  if(j+1)%54==0:print(json.dumps(dict(arquivos_conferidos=j+1,total=len(paths))),flush=True)
 report=dict(ok=True,anos=anos,edicao=edicao,fonte=SIM_URL,campos=fields,arquivos=refs,agregado=dict(arquivo=out.name,bytes=out.stat().st_size,sha256=sha(out)),totais={int(y):{id:int(v)for id,v in row.items()}for y,row in x.groupby('ano')[[f'sec_{id}'for id in CORE]].sum().iterrows()})
 (root/'sim_seguranca.json').write_text(json.dumps(report,ensure_ascii=False,separators=(',',':')),encoding='utf-8');print(json.dumps(dict(ok=True,linhas=len(x),totais=report['totais'])),flush=True);c.close()
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--micro',required=True);p.add_argument('--fontes',required=True);a=p.parse_args();gerar(a.micro,a.fontes)
