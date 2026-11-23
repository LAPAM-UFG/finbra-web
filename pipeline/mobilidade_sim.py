"""Contagens de transporte terrestre do SIM definitivo, por residência.

Lê os Parquet convertidos de DORES. DOBR e prévias ficam fora para não duplicar
registros nem misturar cobertura parcial. Nenhum microdado sai do disco.
"""
import argparse,hashlib,json,re
from pathlib import Path
import duckdb,pandas as pd
from mobilidade_fontes import compacto,sha
from mobilidade_perfis import SIM_PERFIS,RACAS,LOCAIS,ESCOLAS,MESES,DIC_SIM

GRUPOS={
 'mob_obitos':"cid BETWEEN 'V01' AND 'V89'",
 'mob_ob_pedestres':"cid BETWEEN 'V01' AND 'V09'",
 'mob_ob_ciclistas':"cid BETWEEN 'V10' AND 'V19'",
 'mob_ob_motociclistas':"cid BETWEEN 'V20' AND 'V29'",
 'mob_ob_automoveis':"cid BETWEEN 'V40' AND 'V49'",
 'mob_ob_caminhonetes':"cid BETWEEN 'V50' AND 'V59'",
 'mob_ob_carga':"cid BETWEEN 'V60' AND 'V69'",
 'mob_ob_onibus':"cid BETWEEN 'V70' AND 'V79'",
 'mob_ob_outros':"cid BETWEEN 'V30' AND 'V39' OR cid BETWEEN 'V80' AND 'V89'",
 'mob_ob_homens':"SEXO IN ('1','M')",
 'mob_ob_mulheres':"SEXO IN ('2','F')",
 'mob_ob_sexo_ign':"SEXO IS NULL OR SEXO NOT IN ('1','M','2','F')",
 'mob_ob_0_14':"idade_anos<15",
 'mob_ob_15_29':"idade_anos BETWEEN 15 AND 29",
 'mob_ob_30_59':"idade_anos BETWEEN 30 AND 59",
 'mob_ob_60_mais':"idade_anos>=60",
 'mob_ob_idade_ign':"idade_anos IS NULL",
}
GRUPOS.update({id:v['expr']for id,v in SIM_PERFIS.items()})

def agrupar_sim(c):
 cols=','.join(f'count(*)FILTER(WHERE {expr})AS {id}'for id,expr in GRUPOS.items())
 return c.execute(f"SELECT ano,municipio6,uf_codigo,{cols} FROM ob WHERE cid BETWEEN 'V01' AND 'V89' GROUP BY 1,2,3 ORDER BY 1,2").fetchdf()

def gerar(micro,fontes,anos_selecionados=None):
 fontes=Path(fontes).resolve();micro=Path(micro).resolve();globalm=json.loads((fontes/'gold/manifesto.json').read_bytes());anos=[y for y in globalm['fontes']['sim']['anos']if y>=2013];assert anos==list(range(2013,max(anos)+1)),anos
 if anos_selecionados is not None:anos=sorted(set(anos_selecionados))
 paths=sorted(p for p in micro.glob('DO*.parquet')if re.fullmatch(r'DO[A-Z]{2}\d{4}\.parquet',p.name)and not p.name.startswith('DOBR')and int(p.stem[-4:])in anos)
 g=json.loads((fontes/'geografia.json').read_bytes());ufs={uf:int(code.removeprefix('E:'))for code,_,uf in g['governos']}
 assert len(paths)==27*len(anos)
 for y in anos:assert {p.name[2:4]for p in paths if int(p.stem[-4:])==y}==set(ufs)
 import pyarrow.parquet as pq
 campos=['TIPOBITO','DTOBITO','CODMUNRES','CAUSABAS','SEXO','IDADE','RACACOR','ESC','LOCOCOR','ACIDTRAB']
 for p in paths:assert set(campos).issubset(pq.read_schema(p).names),p.name
 c=duckdb.connect();c.execute("SET threads=3; SET memory_limit='3GB'");c.from_parquet([p.as_posix()for p in paths],filename=True,union_by_name=True).project('filename,'+','.join(campos)).create_view('raw')
 assert c.execute("SELECT count(*) FROM raw WHERE TIPOBITO IS DISTINCT FROM '2'").fetchone()[0]==0
 assert c.execute("SELECT count(*) FROM raw WHERE right(DTOBITO,4) IS DISTINCT FROM regexp_extract(filename,'(20[0-9]{2})[.]parquet$',1)").fetchone()[0]==0
 ufkeys=','.join("'"+str(x)+"'"for x in ufs.values())
 assert c.execute(f"SELECT count(*) FROM raw WHERE left(CODMUNRES,2) NOT IN ({ufkeys}) OR CODMUNRES IS NULL").fetchone()[0]==0
 c.execute("CREATE VIEW ob AS SELECT cast(regexp_extract(filename,'(20[0-9]{2})[.]parquet$',1)as INTEGER) ano, cast(left(CODMUNRES,6)as INTEGER) municipio6, cast(left(CODMUNRES,2)as INTEGER) uf_codigo, upper(left(trim(CAUSABAS),3))cid,SEXO,trim(RACACOR)RACACOR,trim(ESC)ESC,trim(LOCOCOR)LOCOCOR,trim(ACIDTRAB)ACIDTRAB,try_cast(substr(DTOBITO,3,2)as INTEGER)mes_obito, CASE WHEN left(IDADE,1) IN ('0','1','2','3') THEN 0 WHEN left(IDADE,1)='4' THEN try_cast(substr(IDADE,2,2)as INTEGER) WHEN left(IDADE,1)='5' THEN 100+try_cast(substr(IDADE,2,2)as INTEGER) END idade_anos FROM raw")
 # WHERE restringe todo o perfil à mesma causa básica e população de óbitos.
 frame=agrupar_sim(c)
 frame['uf']=frame['uf_codigo'].map({v:k for k,v in ufs.items()})
 assert(frame.mob_obitos==frame[['mob_ob_pedestres','mob_ob_ciclistas','mob_ob_motociclistas','mob_ob_automoveis','mob_ob_caminhonetes','mob_ob_carga','mob_ob_onibus','mob_ob_outros']].sum(axis=1)).all()
 assert(frame.mob_obitos==frame[['mob_ob_homens','mob_ob_mulheres','mob_ob_sexo_ign']].sum(axis=1)).all()
 assert(frame.mob_obitos==frame[['mob_ob_0_14','mob_ob_15_29','mob_ob_30_59','mob_ob_60_mais','mob_ob_idade_ign']].sum(axis=1)).all()
 for cols in [[*['mob_ob_rc_'+id for id,_,_ in RACAS],'mob_ob_rc_ign'],[*['mob_ob_loc_'+id for id,_,_ in LOCAIS],'mob_ob_loc_ign'],[*['mob_ob_mes_'+id for id,_ in MESES],'mob_ob_mes_ign'],['mob_ob_trab_sim','mob_ob_trab_nao','mob_ob_trab_ign']]:
  assert(frame.mob_obitos==frame[cols].sum(axis=1)).all(),cols
 assert(frame.mob_ob_15_mais==frame[[*['mob_ob_esc_'+id for id,_,_ in ESCOLAS],'mob_ob_esc_ign']].sum(axis=1)).all()
 assert(frame.mob_ob_rc_info==frame[['mob_ob_rc_'+id for id,_,_ in RACAS]].sum(axis=1)).all()
 assert(frame.mob_ob_esc_info==frame[['mob_ob_esc_'+id for id,_,_ in ESCOLAS]].sum(axis=1)).all()
 assert(frame.mob_ob_trab_info==frame.mob_ob_trab_sim+frame.mob_ob_trab_nao).all()
 out=fontes/'sim_normalizado.parquet';frame.to_parquet(out,index=False,compression='zstd')
 manifest=[]
 for j,p in enumerate(paths):
  with p.open('rb')as f:digest=hashlib.file_digest(f,'sha256').hexdigest()
  dbc=Path('E:/finbra/brutos/saude/SIM/CID10/DORES')/(p.stem+'.dbc');item=dict(arquivo=p.name,bytes=p.stat().st_size,sha256=digest,url='https://ftp.datasus.gov.br/dissemin/publicos/SIM/CID10/DORES/'+p.stem+'.dbc')
  if dbc.exists():
   with dbc.open('rb')as f:item.update(dbc_sha256=hashlib.file_digest(f,'sha256').hexdigest(),dbc_bytes=dbc.stat().st_size)
  manifest.append(item)
  if(j+1)%27==0:print(json.dumps(dict(fontes_conferidas=j+1,total=len(paths))),flush=True)
 report=dict(ok=True,anos=anos,edicao=globalm['fontes']['sim'],dicionario=DIC_SIM,campos=campos,arquivos=manifest,agregado=dict(arquivo=out.name,bytes=out.stat().st_size,sha256=sha(out.read_bytes())),totais={int(y):int(v)for y,v in frame.groupby('ano').mob_obitos.sum().items()},residentes_municipio_ignorado=int(frame[~frame.municipio6.isin([int(m[0])//10 for m in g['municipios']])].mob_obitos.sum()))
 (fontes/'sim.json').write_bytes(compacto(report));print(json.dumps({k:report[k]for k in ['ok','anos','totais','residentes_municipio_ignorado']}),flush=True);c.close()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--micro',type=Path,required=True);p.add_argument('--fontes',type=Path,required=True);a=p.parse_args();gerar(a.micro,a.fontes)
