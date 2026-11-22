"""Corrige só médias RAIS nos downloads publicados; preserva seleção, chaves e outras medidas.

Gera uma candidata isolada em todos os formatos, prévias, dicionários e pacotes.
As origens são snapshots verificados; nada é publicado por este comando.
"""
import argparse,copy,json,re,shutil,subprocess,zipfile
from datetime import datetime,timezone
from pathlib import Path
import duckdb,pandas as pd,pyarrow.parquet as pq
from downloads_enxuto import Enxuto,ler,preparar_stata
from downloads_navegacao import previa,referencia,registrar
from painel_municipal import Painel,KEYS,qi,qs,sha
from saneamento_downloads import declarar_stata
from comparacoes_base import compacto

NOTA='Média de dezembro: soma das remunerações positivas informadas dos vínculos ativos em 31/12 dividida pelo número desses vínculos com remuneração válida. Ausência, zero e valores negativos de remuneração não entram no denominador; o estoque de vínculos permanece separado. Sem remuneração válida, a média fica ausente.'

def gerar(base,rais,saida,stata,rscript):
 base,rais,saida=[Path(p).resolve()for p in [base,rais,saida]]
 for origem in [base,rais]:
  if origem==saida or origem.is_relative_to(saida)or saida.is_relative_to(origem):raise ValueError('Destino sobreposto à origem')
 if saida.exists()and any(saida.iterdir()):raise ValueError('Use uma candidata nova')
 work=saida/'trabalho_downloads_rais';dest=saida/'gold/downloads';work.mkdir(parents=True);dest.mkdir(parents=True)
 old=ler(base/'gold/downloads/manifesto.json');m=copy.deepcopy(old);dictionary=copy.deepcopy(ler(base/old['dicionario']['caminho']))
 corrected=[d for d in dictionary if d['area']=='trabalho'and ('_rem_media'in d['variavel']or'remuneracao_media'in d['variavel'])]
 for d in corrected:d['observacao']=NOTA
 names=[d['variavel']for d in corrected];assert len(names)>15
 for a in [a for a in old['arquivos']if a['id']in ['painel_brasil_parquet','painel_trabalho_parquet']]:assert sha(base/a['caminho'])==a['sha256']
 e=Enxuto.__new__(Enxuto);e.root=saida;e.origem=base;e.base=base;e.work=work;e.dest=dest;e.dictionary=dictionary;e.pending=[]
 e.db=duckdb.connect();e.db.execute("SET threads=2;SET memory_limit='3GB'")
 e.p=Painel.__new__(Painel);e.p.db=e.db;e.p.root=saida;e.p.work=work;e.p.dest=dest;e.p.files=[]
 e.db.execute('CREATE VIEW bruto AS SELECT * FROM read_parquet('+qs((base/'gold/trabalho/municipios.parquet').as_posix())+')')
 mf=ler(rais/'gold/manifesto.json');profile=rais/mf['fontes']['rais_perfis']['arquivos'].replace('{ano}','*')
 select=[]
 for d in corrected:
  original=d.get('variavel_original',d['variavel'])
  match=re.fullmatch(r'rais_(raca_cor|escolaridade|vinculo_mte)_(\d+)_remuneracao_media',original)
  if match:
   v,k=match.groups();select.append('first(massa_dez_centavos/100.0/nullif(n_rem_dez,0)) FILTER(WHERE variavel='+qs(v)+' AND codigo='+qs(k)+') AS '+qi(d['variavel']))
  else:assert original in ['rais_remuneracao_media','rais_remuneracao_media_real'],original
 e.db.execute('CREATE TABLE perfis AS SELECT cast(escopo AS INTEGER)cod_ibge,ano,'+','.join(select)+' FROM read_parquet('+qs(profile.as_posix())+") WHERE regexp_full_match(escopo,'[0-9]{7}') GROUP BY 1,2")
 audit=[]
 for view,area in [('principal',None),('trabalho','trabalho')]:
  orig=next(a for a in old['arquivos']if a['id']==('painel_brasil_parquet'if view=='principal'else'painel_trabalho_parquet'))
  source='read_parquet('+qs((base/orig['caminho']).as_posix())+')'
  replacements=[]
  for d in corrected:
   name=d['variavel']
   expr='b.massa_dez/nullif(b.n_rem_dez,0)'if name=='rais_remuneracao_media'else'b.massa_dez/nullif(b.n_rem_dez,0)*(a.rais_remuneracao_media_real/nullif(a.rais_remuneracao_media,0))'if name=='rais_remuneracao_media_real'else'p.'+qi(name)
   replacements.append(expr+' AS '+qi(name))
  e.db.execute('CREATE TABLE '+view+' AS SELECT a.* REPLACE('+','.join(replacements)+') FROM '+source+' a LEFT JOIN bruto b USING(cod_ibge,ano) LEFT JOIN perfis p USING(cod_ibge,ano)')
  before=pq.read_table(base/orig['caminho']).to_pandas().sort_values(['cod_ibge','ano']).reset_index(drop=True);after=e.db.execute('SELECT * FROM '+view+' ORDER BY cod_ibge,ano').to_arrow_table().to_pandas();pd.testing.assert_frame_equal(before.drop(columns=names),after.drop(columns=names),check_dtype=False,check_exact=True)
  assert len(after)==len(before)and not after.duplicated(['cod_ibge','ano']).any();changed=sum(int((before[n].fillna(-1)!=after[n].fillna(-1)).sum())for n in names)
  sentinel=after.loc[(after.cod_ibge==5208905)&(after.ano==2024),'rais_remuneracao_media'].iloc[0];assert abs(sentinel-3575.85138888889)<1e-8
  audit.append(dict(base=view,linhas=len(after),variaveis=len(after.columns)-len(KEYS),medias_corrigidas=changed,outros_valores_preservados=True,sentinela=float(sentinel)))
  id='painel_brasil'if area is None else'painel_trabalho';e.exportar(id,'SELECT * FROM '+view+' ORDER BY cod_ibge,ano',orig['nome'],area=area)
  for uf, in e.db.execute('SELECT DISTINCT uf FROM '+view+' ORDER BY 1').fetchall():
   id='painel_'+uf.lower()if area is None else'painel_trabalho_'+uf.lower();e.exportar(id,'SELECT * FROM '+view+' WHERE uf='+qs(uf)+' ORDER BY cod_ibge,ano',('Base enxuta'if area is None else'Mercado de trabalho')+' — '+uf,area=area,uf=uf)
 declarar_stata(e.pending,work,stata)
 for a in e.pending:e.registrar(Path(a['path']),a['id'],a['tipo'],'dta',a['nome'],**a['meta'])
 new=e.p.files;stata_cells=0
 for a in new:
  if a['formato']!='dta':continue
  orig=next(p for p in new if p['id']==a['id'].removesuffix('_dta')+'_parquet');truth,_=preparar_stata(pq.read_table(saida/orig['caminho']).to_pandas(),copy.deepcopy(dictionary));actual=pd.read_stata(saida/a['caminho'],convert_categoricals=False,convert_dates=False)
  pd.testing.assert_frame_equal(actual,truth,check_dtype=False,check_exact=True);stata_cells+=truth.size
 dictfile=work/'dicionario.json';dictfile.write_bytes(compacto(dictionary));dref=registrar(saida,dictfile,'dicionario','json');plan=[]
 for a in list(new):
  if a['formato']!='parquet':continue
  id=a['id'].removesuffix('_parquet');plan.append(dict(id=id+'_rds',parquet=str(saida/a['caminho']),rds=str(work/(id+'.rds')),retorno=str(work/(id+'_retorno.parquet')),origem=a['caminho'],sha256=a['sha256'],uf=a['uf'],tema=a['area']or'todos',rede='todas'))
 stamp=datetime.now(timezone.utc).isoformat();rdict=work/'dicionario.rds';rplan=work/'plano_r.json';report=work/'r_nativo.json';m['base_sha256']=sha(rais/'gold/manifesto.json')
 rplan.write_bytes(compacto(dict(dicionario=str(saida/dref['caminho']),saida_dicionario=str(rdict),arquivos=plan,base_sha256=m['base_sha256'],gerado_em=stamp)))
 subprocess.run([str(rscript),'--vanilla',str(Path(__file__).with_name('downloads_r.R')),str(rplan),str(report)],check=True,timeout=1200)
 assert ler(report)['ok'];r_cells=0
 for item in plan:
  truth=pq.read_table(item['parquet']).to_pandas();actual=pq.read_table(item['retorno']).to_pandas();pd.testing.assert_frame_equal(actual,truth,check_dtype=False,check_exact=True);r_cells+=truth.size
  orig=next(a for a in new if a['id']==item['id'].removesuffix('_rds')+'_parquet');new.append({**orig,**registrar(saida,Path(item['rds']),item['id'],'rds'),'id':item['id'],'formato':'rds'})
 previews={}
 for a in new:
  if a['formato']=='parquet':previews[a['area'],a['uf']]=referencia(saida,work,'previa_'+a['id'].removesuffix('_parquet'),previa(pq.read_table(saida/a['caminho']).to_pandas(),dictionary,a))
 for a in new:a['previa']=previews[a['area'],a['uf']]
 replacements={a['id']:a for a in new};m['arquivos']=[replacements.get(a['id'],a)for a in old['arquivos']]
 for uf,ref in old['recortes_uf'].items():
  catalog=ler(base/ref['caminho']);catalog['arquivos']=[replacements.get(a['id'],a)for a in catalog['arquivos']];m['recortes_uf'][uf]=referencia(saida,work,'catalogo_'+uf.lower(),catalog)
 def replace(id,fmt,path):
  j=next(j for j,a in enumerate(m['arquivos'])if a['id']==id);m['arquivos'][j]={**m['arquivos'][j],**registrar(saida,path,id,fmt)}
 m['dicionario']=dref;replace('dicionario_json','json',dictfile)
 flat=pd.DataFrame([{k:json.dumps(v,ensure_ascii=False)if isinstance(v,(dict,list))else v for k,v in row.items()}for row in dictionary]);csv=work/'dicionario.csv';flat.to_csv(csv,index=False,sep=';',encoding='utf-8-sig');z=work/'dicionario.csv.zip'
 with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED)as f:f.write(csv,'dicionario.csv')
 replace('dicionario_csv','csv.zip',z);excel=work/'dicionario.xlsx';flat.to_excel(excel,index=False,engine='openpyxl',freeze_panes=(1,0));replace('dicionario_excel','xlsx',excel);replace('dicionario_rds','rds',rdict)
 m['notas']=[n for n in m['notas']if not n.startswith('Remuneração RAIS:')];m['notas'].append('Remuneração RAIS: '+NOTA)
 method=work/'metodologia.txt';method.write_text('\n\n'.join(m['notas'])+'\n',encoding='utf-8');replace('metodologia','txt',method)
 # Os pacotes também recebem os valores revistos; referências de outras áreas não mudam.
 for a in [a for a in m['arquivos']if a['tipo']=='pacote']:
  fmt=a.get('conteudo');all_formats=a['id']=='pacote_enxuto'
  if not all_formats and not fmt:fmt=next(f for f in ['dta','csv.zip','parquet','rds']if a['id'].endswith(f.replace('.','_')))
  members=[f for f in m['arquivos']if (f['tipo']=='painel'and f.get('uf')is None and (all_formats or f['formato']==fmt))or(f['tipo']=='dicionario'and f.get('escopo')=='principal')or f['tipo']=='metodologia']
  path=work/(a['id']+'.zip')
  with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED,compresslevel=3)as target:
   for member in members:
    source=saida/member['caminho']
    if not source.exists():source=base/member['caminho']
    assert sha(source)==member['sha256']
    if member['formato']=='csv.zip':
     with zipfile.ZipFile(source)as original:
      for entry in original.infolist():
       with original.open(entry)as src,target.open(entry.filename,'w',force_zip64=True)as dst:shutil.copyfileobj(src,dst,8*1024*1024)
    else:target.write(source,member['id']+'.'+member['formato'])
   a['bytes_extraido']=sum(z.file_size for z in target.infolist())
  a.update(registrar(saida,path,a['id'],'zip'))
 m['gerado_em']=stamp;m.setdefault('fontes_complementares',{})['rais_remuneracao']=dict(caminho='gold/manifesto.json',sha256=m['base_sha256'],gerado_em=stamp)
 assert m['resumo']==old['resumo']and len(m['arquivos'])==len(old['arquivos'])
 assert all(next(a for a in m['arquivos']if a['id']==o['id'])==o for o in old['arquivos']if o['tipo']=='area'and o.get('area')!='trabalho')
 (dest/'manifesto.json').write_bytes(compacto(m));audit=dict(ok=True,bases=audit,medidas_remuneracao=len(names),arquivos_revisados=len(new),stata_celulas=stata_cells,r_celulas=r_cells,variaveis_principais=m['resumo']['variaveis'],outros_temas_preservados=True)
 (work/'auditoria.json').write_bytes(compacto(audit));print(json.dumps(audit),flush=True);e.db.close()

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['base','rais','saida','stata','rscript']:p.add_argument('--'+k,type=Path,required=True)
 a=p.parse_args();gerar(a.base,a.rais,a.saida,a.stata,a.rscript)
