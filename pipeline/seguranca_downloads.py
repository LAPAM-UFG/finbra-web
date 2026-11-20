"""Acrescenta Segurança aos downloads/API sem ampliar a seleção principal de 297.

Arquivos prontos Brasil/UF em Parquet, CSV, Stata e RDS. A chave é município/ano;
as unidades e condições acompanham cada medida. Nenhuma origem é modificada.
"""
import argparse,copy,json,subprocess,zipfile
from datetime import datetime,timezone
from pathlib import Path
import duckdb,pandas as pd,pyarrow.parquet as pq
from seguranca_definicoes import CONDICOES,NOTA_BASE,NOTA_SIM,NOTA_SINESP
from comparacoes_base import compacto
from downloads_enxuto import Enxuto,ler
from downloads_navegacao import previa,referencia,registrar
from painel_municipal import Painel,KEYS,qi,qs,sha
from saneamento_downloads import declarar_stata

def gerar(base,painel,saida,stata,rscript):
 base=Path(base).resolve();painel=Path(painel).resolve();saida=Path(saida).resolve()
 for origem in [base,painel]:
  if origem==saida or origem.is_relative_to(saida) or saida.is_relative_to(origem):raise ValueError('Destino sobreposto à origem')
 dest=saida/'gold/downloads';work=saida/'trabalho_downloads_seguranca';dest.mkdir(parents=True);work.mkdir()
 old=ler(base/'gold/downloads/manifesto.json');m=copy.deepcopy(old);meta=ler(painel/'gold/seguranca/manifesto.json')
 import gzip
 catalog=ler(painel/'gold/seguranca/manifesto.json')['catalogo'];raw=(painel/catalog['caminho']).read_bytes();assert len(raw)==catalog['bytes']
 import hashlib
 assert hashlib.sha256(raw).hexdigest()==catalog['sha256'];cat=json.loads(gzip.decompress(raw));raw_count=len(cat['indicadores']);definitions=list(cat['indicadores'])+[dict(i,id=i['variavel_download'],fonte='calculado',fonte_nome='SIM / Sinesp / SVS; cálculo LAPAM/UFG',descricao=i['descricao']+' Fórmula: '+i['numerador_id']+' / '+i['denominador_id']+' × '+str(i['fator'])+'. '+i.get('alerta',''))for i in cat.get('derivados',[])];ids=[i['id']for i in definitions]
 main=next(a for a in old['arquivos']if a['id']=='painel_brasil_parquet');assert sha(base/main['caminho'])==main['sha256']
 dictionary=[d for d in ler(base/old['dicionario']['caminho'])if d.get('area')!='seguranca'];keys=[d for d in dictionary if d['variavel']in KEYS];assert len(keys)==len(KEYS)
 source=painel/'trabalho_seguranca/municipios.parquet'
 frame=pq.read_table(source,columns=['ano',*ids]).to_pandas()
 years_by_id={id:sorted(int(y)for y in frame.loc[frame[id].notna(),'ano'].unique())for id in ids};del frame
 added=[]
 for i in definitions:
  for cond in [False,True]:
   id=i['id']+('_cond'if cond else'')
   added.append(dict(variavel=id,nome=('Condição: 'if cond else'')+i['nome'],descricao=('Condição do dado de '+i['id']if cond else i['descricao']),area='seguranca',tabela='painel',
       unidade='código de condição'if cond else i['unidade'],fonte=i['fonte_nome'],tipo='inteiro'if cond else'numero',
       regra_anual=NOTA_BASE+' '+NOTA_SIM+' '+NOTA_SINESP,observacao='Arquivo temático próprio; datas e definições das duas fontes são distintas. Não somar SIM e Sinesp. Taxas brutas; ausência, ano parcial e série zerada na UF têm condições próprias.',anos_observados=years_by_id[i['id']],arquivo_principal=False,ano_de=min(years_by_id[i['id']],default=None),ano_ate=max(years_by_id[i['id']],default=None),variavel_original=id,
       **({'stata_rotulos':{str(k):v for k,v in CONDICOES.items()}}if cond else{})))
 assert not set(d['variavel']for d in dictionary)&set(d['variavel']for d in added);dictionary+=added
 e=Enxuto.__new__(Enxuto);e.root=saida;e.origem=base;e.base=base;e.work=work;e.dest=dest;e.dictionary=copy.deepcopy(keys+added);e.pending=[]
 assert len(KEYS)+len(ids)*2<=2048,'Arquivo acima do limite Stata BE';e.db=duckdb.connect();e.db.execute("SET threads=2; SET memory_limit='3GB'")
 e.p=Painel.__new__(Painel);e.p.db=e.db;e.p.root=saida;e.p.work=work;e.p.dest=dest;e.p.files=[]
 e.db.execute('CREATE VIEW anterior AS SELECT '+','.join(qi(k)for k in KEYS)+' FROM read_parquet('+qs((base/main['caminho']).as_posix())+') WHERE ano BETWEEN 2013 AND '+str(max(cat['anos'])))
 e.db.execute('CREATE VIEW mob AS SELECT * FROM read_parquet('+qs(source.as_posix())+')')
 cols=[x for id in ids for x in [id,id+'_cond']]
 e.db.execute('CREATE TABLE tematico AS SELECT '+','.join('a.'+qi(k)for k in KEYS)+','+','.join('b.'+qi(k)for k in cols)+' FROM anterior a LEFT JOIN mob b USING(cod_ibge,ano)')
 assert e.db.execute('SELECT count(*) FROM tematico WHERE '+qi(cols[1])+' IS NULL').fetchone()[0]==0
 assert e.db.execute('SELECT count(*) FROM (SELECT cod_ibge,ano,count(*) n FROM tematico GROUP BY 1,2 HAVING n>1)').fetchone()[0]==0
 select=','.join(qi(k)for k in [*KEYS,*cols]);e.exportar('painel_seguranca','SELECT '+select+' FROM tematico ORDER BY cod_ibge,ano','Segurança pública e violência — Brasil',area='seguranca')
 for uf, in e.db.execute('SELECT DISTINCT uf FROM tematico ORDER BY 1').fetchall():
  e.exportar('painel_seguranca_'+uf.lower(),'SELECT '+select+' FROM tematico WHERE uf='+qs(uf)+' ORDER BY cod_ibge,ano','Segurança pública e violência — '+uf,area='seguranca',uf=uf)
 declarar_stata(e.pending,work,stata)
 for item in e.pending:e.registrar(Path(item['path']),item['id'],item['tipo'],'dta',item['nome'],**item['meta'])
 new=e.p.files;stata_cells=0
 for a in new:
  if a['formato']!='dta':continue
  orig=next(p for p in new if p['id']==a['id'].removesuffix('_dta')+'_parquet');truth=pq.read_table(saida/orig['caminho']).to_pandas();actual=pd.read_stata(saida/a['caminho'],convert_categoricals=False,convert_dates=False)
  pd.testing.assert_frame_equal(actual,truth,check_dtype=False,check_exact=True);stata_cells+=truth.size
 dictionaryfile=work/'dicionario.json';dictionaryfile.write_bytes(compacto(dictionary));dref=registrar(saida,dictionaryfile,'dicionario','json');plan=[]
 for a in list(new):
  if a['formato']!='parquet':continue
  id=a['id'].removesuffix('_parquet');plan.append(dict(id=id+'_rds',parquet=str(saida/a['caminho']),rds=str(work/(id+'.rds')),retorno=str(work/(id+'_retorno.parquet')),origem=a['caminho'],sha256=a['sha256'],uf=a['uf'],tema='seguranca',rede='todas'))
 stamp=datetime.now(timezone.utc).isoformat();rdict=work/'dicionario.rds';rplan=work/'plano_r.json';report=work/'r_nativo.json'
 rplan.write_bytes(compacto(dict(dicionario=str(saida/dref['caminho']),saida_dicionario=str(rdict),arquivos=plan,base_sha256=m['base_sha256'],gerado_em=stamp)))
 subprocess.run([str(rscript),'--vanilla',str(Path(__file__).with_name('downloads_r.R')),str(rplan),str(report)],check=True,timeout=1200)
 assert ler(report)['ok'];r_cells=0
 for item in plan:
  truth=pq.read_table(item['parquet']).to_pandas();actual=pq.read_table(item['retorno']).to_pandas();pd.testing.assert_frame_equal(actual,truth,check_dtype=False,check_exact=True);r_cells+=truth.size
  orig=next(a for a in new if a['id']==item['id'].removesuffix('_rds')+'_parquet');new.append({**orig,**registrar(saida,Path(item['rds']),item['id'],'rds'),'id':item['id'],'formato':'rds'})
 previews={}
 for a in new:
  if a['formato']=='parquet':previews[a['uf']]=referencia(saida,work,'previa_'+a['id'].removesuffix('_parquet'),previa(pq.read_table(saida/a['caminho']).to_pandas(),dictionary,a))
 for a in new:a['previa']=previews[a['uf']]
 m['arquivos']=[a for a in m['arquivos']if a.get('area')!='seguranca'and not(a['tipo']=='dicionario'and a.get('escopo')=='principal')];m['arquivos'].extend(a for a in new if not a['uf'])
 for uf,ref in old['recortes_uf'].items():
  catalog=ler(base/ref['caminho']);catalog['arquivos']=[a for a in catalog['arquivos']if a.get('area')!='seguranca'];catalog['arquivos'].extend(a for a in new if a['uf']==uf);m['recortes_uf'][uf]=referencia(saida,work,'catalogo_'+uf.lower(),catalog)
 m['areas']=[a for a in m['areas']if a['id']!='seguranca'];m['areas'].append(dict(id='seguranca',nome='Segurança pública e violência',nome_en='Public safety and violence',descricao=f'{raw_count} medidas originais e {len(ids)-raw_count} relativas, incluindo bases de cálculo e condições. SIM definitivo 2013–2024; Sinesp VDE 2015–2025, sem completar ausências. Taxas anuais e de triênios, perfis das vítimas e meses.',descricao_en=f'{raw_count} original and {len(ids)-raw_count} relative measures, including calculation bases and conditions. Final SIM 2013–2024; Sinesp VDE 2015–2025, without filling missing data. Annual and three-year rates, victim profiles and months.'))
 template=next(a for a in old['arquivos']if a['id']=='dicionario_json')
 def dict_item(id,fmt,path,label):m['arquivos'].append({**template,**registrar(saida,path,id,fmt),'id':id,'formato':fmt,'linhas':len(dictionary),'variaveis':None,'nome':label,'nome_en':label})
 m['dicionario']=dref;m['arquivos'].append({**template,**dref,'id':'dicionario_json','linhas':len(dictionary)})
 flat=pd.DataFrame([{k:json.dumps(v,ensure_ascii=False)if isinstance(v,(dict,list))else v for k,v in row.items()}for row in dictionary]);csv=work/'dicionario.csv';flat.to_csv(csv,index=False,sep=';',encoding='utf-8-sig');zipped=work/'dicionario.csv.zip'
 with zipfile.ZipFile(zipped,'w',zipfile.ZIP_DEFLATED)as z:z.write(csv,'dicionario.csv')
 dict_item('dicionario_csv','csv.zip',zipped,'Dicionário — CSV');excel=work/'dicionario.xlsx';flat.to_excel(excel,index=False,engine='openpyxl',freeze_panes=(1,0));dict_item('dicionario_excel','xlsx',excel,'Dicionário — Excel');dict_item('dicionario_rds','rds',rdict,'Dicionário — R')
 m['gerado_em']=stamp;m['notas']=[n for n in m['notas']if not n.startswith('Segurança pública e violência:')];m['notas'].append('Segurança pública e violência: '+NOTA_SIM+' '+NOTA_SINESP+' '+NOTA_BASE)
 m.setdefault('fontes_complementares',{})['seguranca']=dict(caminho='gold/seguranca/manifesto.json',sha256=sha(painel/'gold/seguranca/manifesto.json'),gerado_em=meta['gerado_em'])
 for j,item in enumerate(m['arquivos']):
  if item['tipo']=='metodologia'and item['formato']=='txt':
   txt=work/'metodologia.txt';txt.write_text('\n\n'.join(m['notas'])+'\n',encoding='utf-8');m['arquivos'][j]={**item,**registrar(saida,txt,item['id'],'txt')}
 assert all(next(a for a in m['arquivos']if a['id']==o['id'])==o for o in old['arquivos']if o['tipo']=='painel' or o['tipo']=='area'and o.get('area')!='seguranca')
 (dest/'manifesto.json').write_bytes(compacto(m));audit=dict(ok=True,arquivos_novos=len(new),stata_celulas=stata_cells,r_celulas=r_cells,variaveis_seguranca=len(ids),variaveis_principais=m['resumo']['variaveis'],origem_sha256=sha(base/'gold/downloads/manifesto.json'),manifesto_sha256=sha(dest/'manifesto.json'))
 (work/'auditoria.json').write_bytes(compacto(audit));print(json.dumps(audit),flush=True);e.db.close()

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for key in ['base','painel','saida','stata','rscript']:p.add_argument('--'+key,type=Path,required=True)
 a=p.parse_args();gerar(a.base,a.painel,a.saida,a.stata,a.rscript)
