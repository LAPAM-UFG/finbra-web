"""Fontes oficiais da Anatel, fixadas por hash e normalizadas fora do gold ativo."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import argparse,csv,hashlib,io,json,re,shutil,zipfile
import duckdb,pandas as pd,requests

def sha(p):
 with Path(p).open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def qs(v):return "'"+str(v).replace("'","''")+"'"
def qi(v):return '"'+str(v).replace('"','""')+'"'
def salvar(p,v):p.write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf-8')

def adquirir(root):
 """Aquisição reproduzível: publica apenas agregados, nunca o arquivo de origem."""
 url='https://www.anatel.gov.br/dadosabertos/paineis_de_dados/acessos/acessos_banda_larga_fixa.zip'
 p=root/'banda_larga.zip';metadata=root/'banda_larga_fonte.json'
 if p.exists()and metadata.exists():return
 if p.exists():raise ValueError('Arquivo sem proveniência: fixe e confira a origem antes de normalizar')
 temp=p.with_suffix('.zip.parcial')
 if temp.exists():raise ValueError('Aquisição parcial encontrada; use uma pasta de fontes nova')
 with requests.get(url,stream=True,timeout=(30,300))as r:
  r.raise_for_status()
  with temp.open('wb')as out:
   for chunk in r.iter_content(1024*1024):out.write(chunk)
  expected=r.headers.get('Content-Length')
  if expected:assert temp.stat().st_size==int(expected)
  with zipfile.ZipFile(temp)as z:assert z.testzip()is None
  ref=dict(arquivo=p.name,url=url,bytes=temp.stat().st_size,sha256=sha(temp),last_modified=r.headers.get('Last-Modified'),etag=r.headers.get('ETag'))
 temp.rename(p);salvar(metadata,ref)
def fixar(root):
 caches=[Path('E:/finbra/fontes_seguranca_ampliacao_20261120'),Path('E:/finbra/candidato_downloads_seguranca_ampliacao_20261120'),Path('E:/finbra/candidato_seguranca_ampliacao_20261120'),Path('E:/finbra/candidato_raiox_seguranca_ampliacao_20261120')]
 def baixar(key,ref=None):
  p=root/key;p.parent.mkdir(parents=True,exist_ok=True)
  if not p.exists():
   old=next((d/key for d in caches if ref and(d/key).is_file()and(d/key).stat().st_size==ref['bytes']and sha(d/key)==ref['sha256']),None)
   if old:shutil.copy2(old,p)
   else:
    r=requests.get('https://finbra-web.luanviniciusbernardelli.workers.dev/dados/'+key,headers={'Cache-Control':'no-cache'},timeout=240);r.raise_for_status();p.write_bytes(r.content)
  if ref:assert p.stat().st_size==ref['bytes']and sha(p)==ref['sha256'],key
  return dict(chave=key,bytes=p.stat().st_size,sha256=sha(p))
 keys=['gold/manifesto.json','gold/downloads/manifesto.json','gold/comparacoes/manifesto.json','gold/raiox/v6_manifesto.json','gold/seguranca/manifesto.json','gold/mobilidade/manifesto.json']
 with ThreadPoolExecutor(max_workers=4)as pool:refs=list(pool.map(baixar,keys))
 dl=json.loads((root/keys[1]).read_bytes());cp=json.loads((root/keys[2]).read_bytes());main=next(x for x in dl['arquivos']if x['id']=='painel_brasil_parquet')
 extra=[dl['dicionario'],*dl['recortes_uf'].values(),cp['geografia'],main]
 with ThreadPoolExecutor(max_workers=4)as pool:refs+=list(pool.map(lambda x:baixar(x['caminho'],x),extra))
 shutil.copy2(root/cp['geografia']['caminho'],root/'geografia.json');salvar(root/'base_publicada.json',dict(ok=True,arquivos=refs))
 import pyarrow.parquet as pq
 pop=[x for x in pq.read_schema(root/main['caminho']).names if 'pop' in x.lower()]
 p=pd.read_parquet(root/main['caminho'],columns=['ano',*pop]);print(json.dumps(dict(base_fixada=True,populacoes={c:sorted(map(int,p.loc[p[c].notna(),'ano'].unique()))for c in pop})),flush=True)
 return main

def normalizar(root):
 root=Path(root).resolve();root.mkdir(parents=True,exist_ok=True);adquirir(root);fixar(root)
 pop=root/'populacao_2026_sidra.json'
 if not pop.exists():
  resp=requests.get('https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/2026',timeout=180);resp.raise_for_status();rows=resp.json()
  assert len(rows)==5572 and all(r['D3C']=='2026'and r['D2C']=='9324'for r in rows[1:]);salvar(pop,rows)
 meta=json.loads((root/'banda_larga_fonte.json').read_bytes());assert sha(root/meta['arquivo'])==meta['sha256']
 work=root/'trabalho';work.mkdir(exist_ok=True);raw=root/'csv';raw.mkdir(exist_ok=True)
 db=duckdb.connect(str(work/'anatel.duckdb'));db.execute("SET threads=3; SET memory_limit='3GB'");db.execute('SET temp_directory='+qs(str(work/'temporario')))
 db.execute('DROP TABLE IF EXISTS fatos');periodos=set();campos={};membros=[]
 with zipfile.ZipFile(root/meta['arquivo'])as z:
  # Em 2026, a versão em colunas omite acessos de janeiro a março que estão
  # no arquivo longo e no total oficial. Usa-se o longo nessa edição.
  files=[i for i in z.infolist()if i.filename.endswith('_Colunas.csv')and 2013<=int(re.search(r'20\d{2}',i.filename)[0])<2026]+[z.getinfo('Acessos_Banda_Larga_Fixa_2026.csv')]
  for member in files:
   dest=raw/Path(member.filename).name
   if not dest.exists():
    with z.open(member)as f,dest.open('wb')as out:shutil.copyfileobj(f,out,1024*1024)
   assert dest.stat().st_size==member.file_size
   with dest.open(encoding='utf-8-sig',newline='')as f:cols=next(csv.reader(f,delimiter=';'))
   longo='Ano'in cols
   meses=[c for c in cols if re.fullmatch(r'20\d{2}-\d{2}',c)]
   if longo:
    pp=[202600+m for m in range(1,10)]
   else:pp=[int(c.replace('-',''))for c in meses]
   assert pp and not periodos.intersection(pp);periodos.update(pp)
   for p in pp:campos[str(p)]=dict(pessoa='Tipo de Pessoa'in cols,velocidade='Velocidade'in cols)
   def col(nome,default='CAST(NULL AS VARCHAR)'):return qi(nome)if nome in cols else default
   select=[col('CNPJ')+' AS cnpj',col('UF')+' AS uf',col('Código IBGE Município')+' AS cod',col('Meio de Acesso')+' AS meio',col('Tecnologia')+' AS tecnologia',col('Faixa de Velocidade')+' AS faixa',col('Porte da Prestadora')+' AS porte',col('Tipo de Pessoa')+' AS pessoa',col('Tipo de Produto')+' AS produto',col('Velocidade')+' AS velocidade',('TRUE'if'Tipo de Pessoa'in cols else'FALSE')+' AS tem_pessoa',('TRUE'if'Velocidade'in cols else'FALSE')+' AS tem_vel',*([qi('Ano'),qi('Mês'),qi('Acessos')]if longo else[qi(c)for c in meses])]
   db.execute('CREATE OR REPLACE VIEW wide AS SELECT '+','.join(select)+' FROM read_csv('+qs(dest.as_posix())+",delim=';',header=true,all_varchar=true,nullstr='',sample_size=-1)")
   sql='SELECT cast(replace(periodo,\'-\',\'\')as INTEGER)periodo,upper(trim(uf))uf,try_cast(cod as BIGINT)cod_ibge,upper(regexp_replace(cnpj,\'[^A-Za-z0-9]\',\'\',\'g\'))cnpj,meio,tecnologia,faixa,porte,pessoa,produto,try_cast(replace(velocidade,\',\',\'.\')as DOUBLE)mbps,tem_pessoa,tem_vel,try_cast(replace(valor,\',\',\'.\')as DOUBLE)q FROM(UNPIVOT wide ON '+','.join(qi(c)for c in meses)+' INTO NAME periodo VALUE valor)'
   if longo:sql=sql.replace("cast(replace(periodo,'-','')as INTEGER)",'cast("Ano"as INTEGER)*100+cast("Mês"as INTEGER)').replace('FROM(UNPIVOT wide ON  INTO NAME periodo VALUE valor)','FROM(SELECT *,"Acessos"valor FROM wide)')
   if not membros:db.execute('CREATE TABLE fatos AS '+sql)
   else:db.execute('INSERT INTO fatos '+sql)
   n=db.execute('SELECT count(*)FROM fatos WHERE periodo BETWEEN ?AND?',[min(pp),max(pp)]).fetchone()[0];membros.append(dict(arquivo=member.filename,sha256=sha(dest),periodos=pp,linhas=n));print(json.dumps(dict(normalizado=member.filename,linhas=n)),flush=True)
  with z.open('Acessos_Banda_Larga_Fixa_Total.csv')as f:oficial=pd.read_csv(f,sep=';',encoding='utf-8-sig')
 assert db.execute('SELECT count(*)FROM fatos WHERE q IS NULL OR q<0 OR NOT isfinite(q) OR q<>floor(q)').fetchone()[0]==0
 assert db.execute("SELECT count(*)FROM fatos WHERE uf NOT IN ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')OR uf IS NULL").fetchone()[0]==0
 totals=db.execute('SELECT periodo,sum(q)acessos FROM fatos GROUP BY 1 ORDER BY 1').fetchdf().set_index('periodo').acessos
 oficial['periodo']=oficial['Ano']*100+oficial['Mês'];truth=oficial.set_index('periodo').Acessos.reindex(totals.index)
 assert max(periodos)==int(oficial.periodo.max()),'Edição nova: revise a seleção dos arquivos e o mês de referência'
 pd.testing.assert_series_equal(totals,truth,check_names=False,check_dtype=False,check_exact=True)
 ref={int(y):max(p for p in periodos if p//100==y)for y in sorted({p//100 for p in periodos})};assert min(ref)==2013
 db.register('referencias',pd.DataFrame(dict(ano=list(ref),periodo=list(ref.values()))))
 def norm(c):return "regexp_replace(lower(strip_accents(trim("+c+"))),'[^a-z0-9>]','','g')"
 meio,faixa,porte,pessoa=map(norm,['meio','faixa','porte','pessoa'])
 media={'fibra':"meio='fibra'",'metal':"meio='cabometalico'",'coaxial':"meio='cabocoaxial'",'radio':"meio='radio'",'satelite':"meio='satelite'",'outros':"meio IS NULL OR meio NOT IN ('fibra','cabometalico','cabocoaxial','radio','satelite')"}
 faixas={'512k':"faixa IN ('0kbpsa64kbps','64kbpsa512kbps','0kbpsa512kbps')",'2m':"faixa='512kbpsa2mbps'",'12m':"faixa='2mbpsa12mbps'",'34m':"faixa='12mbpsa34mbps'",'mais34':"faixa='>34mbps'",'outras':"faixa IS NULL OR faixa NOT IN ('0kbpsa64kbps','64kbpsa512kbps','0kbpsa512kbps','512kbpsa2mbps','2mbpsa12mbps','12mbpsa34mbps','>34mbps')"}
 db.execute('CREATE OR REPLACE VIEW f AS SELECT periodo,uf,cod_ibge,cnpj,q,mbps,tem_pessoa,tem_vel,'+meio+' meio,'+faixa+' faixa,'+porte+' porte,'+pessoa+' pessoa,produto FROM fatos')
 sums=['sum(q)int_acessos']
 for prefix,items in [('meio',media),('faixa',faixas)]:
  for key,expr in items.items():sums.append('sum(CASE WHEN '+expr+' THEN q ELSE 0 END)int_'+prefix+'_'+key)
 for key,expr in {'peq':"porte='pequenoporte'",'grande':"porte='grandeporte'",'ign':"porte IS NULL OR porte NOT IN ('pequenoporte','grandeporte')"}.items():sums.append('sum(CASE WHEN '+expr+' THEN q ELSE 0 END)int_porte_'+key)
 for key,expr in {'fisica':"pessoa IN ('pessoafisica','fisica','pf')",'juridica':"pessoa IN ('pessoajuridica','juridica','pj')",'ign':"pessoa IS NULL OR pessoa NOT IN ('pessoafisica','fisica','pf','pessoajuridica','juridica','pj')"}.items():sums.append('CASE WHEN bool_and(tem_pessoa)THEN sum(CASE WHEN '+expr+' THEN q ELSE 0 END)END int_pessoa_'+key)
 for key,expr in {'100':"mbps>=100 AND isfinite(mbps)",'1000':"mbps>=1000 AND isfinite(mbps)",'ign':"mbps IS NULL OR NOT isfinite(mbps)OR mbps<=0"}.items():sums.append('CASE WHEN bool_and(tem_vel)THEN sum(CASE WHEN '+expr+' THEN q ELSE 0 END)END int_vel_'+key)
 query='SELECT periodo,uf,cod_ibge,'+','.join(sums)+' FROM f GROUP BY 1,2,3 ORDER BY 1,2,3'
 db.execute('COPY('+query+')TO '+qs((root/'municipio_mensal.parquet').as_posix())+"(FORMAT PARQUET,COMPRESSION ZSTD)")
 geo=json.loads((root/'geografia.json').read_bytes());members=[]
 for cod,nome,uf,ri,rt in geo['municipios']:
  for group in [str(cod),'I:'+str(ri),'T:'+str(rt)]:members.append((int(cod),group))
 db.register('membros',pd.DataFrame(members,columns=['cod_ibge','grupo']))
 provider="CASE WHEN length(cnpj)=14 AND cnpj<>'00000000000000'THEN cnpj ELSE NULL END"
 db.execute('CREATE OR REPLACE TABLE empresas_ref AS SELECT f.periodo,f.uf,f.cod_ibge,'+provider+' prov,sum(q)q FROM f JOIN referencias USING(periodo)GROUP BY 1,2,3,4')
 grouped="SELECT periodo,m.grupo,prov,sum(q)q FROM empresas_ref e JOIN membros m USING(cod_ibge)GROUP BY 1,2,3 UNION ALL SELECT periodo,uf grupo,prov,sum(q)q FROM empresas_ref GROUP BY 1,2,3 UNION ALL SELECT periodo,'BR'grupo,prov,sum(q)q FROM empresas_ref GROUP BY 1,2,3"
 db.execute('CREATE OR REPLACE TABLE mercado AS SELECT periodo,grupo,sum(q)total,sum(CASE WHEN prov IS NULL THEN q ELSE 0 END)sem_cnpj,count(*)FILTER(WHERE prov IS NOT NULL AND q>0)int_prestadoras,max(q)FILTER(WHERE prov IS NOT NULL)lider,sum(q*q)FILTER(WHERE prov IS NOT NULL)quadrados FROM('+grouped+')GROUP BY 1,2')
 db.execute('COPY mercado TO '+qs((root/'mercado_referencias.parquet').as_posix())+"(FORMAT PARQUET,COMPRESSION ZSTD)")
 dist={c:db.execute('SELECT '+qi(c)+',count(*),sum(q)FROM fatos GROUP BY 1 ORDER BY 3 DESC').fetchall()for c in ['meio','faixa','porte','pessoa','produto']}
 report=dict(ok=True,periodos=sorted(periodos),referencias=ref,campos=campos,membros=membros,linhas=int(db.execute('SELECT count(*)FROM fatos').fetchone()[0]),totais={int(k):int(v)for k,v in totals.items()},distribuicoes=dist,agregados={key:dict(arquivo=key+'.parquet',sha256=sha(root/(key+'.parquet')))for key in ['municipio_mensal','mercado_referencias']})
 report['fonte']=meta;report['quantidade_membros']=len(files);salvar(root/'anatel_normalizado.json',report);db.close();print(json.dumps(dict(ok=True,linhas=report['linhas'],referencias=ref,distribuicoes=dist),ensure_ascii=True),flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--fontes',type=Path,required=True);normalizar(p.parse_args().fontes)
