"""Extração municipal do SMP, sem baixar as duplicatas longas do ZIP oficial."""
import argparse,csv,hashlib,io,json,re,shutil,struct,zipfile,zlib
from pathlib import Path
import duckdb,pandas as pd,requests
from internet_fontes import sha,qs,qi,salvar,validar_periodos

URL='https://www.anatel.gov.br/dadosabertos/paineis_de_dados/acessos/acessos_telefonia_movel.zip'

class ZipRemoto(io.RawIOBase):
 """Leitura Range com versão fixada por ETag e limites conferidos."""
 def __init__(self,url=URL):
  self.url=url;self.pos=0;self.s=requests.Session();r=self.s.head(url,timeout=90);r.raise_for_status()
  self.size=int(r.headers['Content-Length']);self.etag=r.headers['ETag'];self.modificado=r.headers.get('Last-Modified');self.tail=None
 def seekable(self):return True
 def readable(self):return True
 def tell(self):return self.pos
 def seek(self,n,whence=0):
  self.pos=n if whence==0 else self.pos+n if whence==1 else self.size+n
  if not 0<=self.pos<=self.size:raise ValueError('Posição fora do ZIP')
  return self.pos
 def trecho(self,start,n):
  if n<0 or start<0 or start+n>self.size:raise ValueError('Range fora do ZIP')
  if n==0:return b''
  with self.s.get(self.url,headers={'Range':f'bytes={start}-{start+n-1}','If-Range':self.etag},stream=True,timeout=(30,180))as r:
   if r.status_code!=206 or r.headers.get('ETag')!=self.etag or r.headers.get('Content-Range')!=f'bytes {start}-{start+n-1}/{self.size}':raise ValueError('Servidor alterou a edição ou não respeitou Range')
   b=r.content
  if len(b)!=n:raise ValueError('Range incompleto')
  return b
 def read(self,n=-1):
  if n<0:n=self.size-self.pos
  if n>200000:raise ValueError('Diretório ZIP excessivo')
  if self.tail is None:self.tail=self.trecho(max(0,self.size-131072),min(131072,self.size))
  start=self.size-len(self.tail)
  b=self.tail[self.pos-start:self.pos-start+n]if self.pos>=start else self.trecho(self.pos,n)
  self.pos+=len(b);return b
 def membro(self,i,dest):
  if i.compress_type!=zipfile.ZIP_DEFLATED or i.file_size>100_000_000 or i.compress_size>30_000_000:raise ValueError('Membro fora dos limites esperados')
  if dest.exists():
   body=dest.read_bytes()
   if len(body)==i.file_size and zlib.crc32(body)==i.CRC:return
   raise ValueError('CSV local difere da edição fixada')
  h=self.trecho(i.header_offset,30);fields=struct.unpack('<4s5H3L2H',h)
  if fields[0]!=b'PK\x03\x04':raise ValueError('Cabeçalho ZIP inválido')
  names=self.trecho(i.header_offset+30,fields[-2]+fields[-1]);name=names[:fields[-2]].decode('utf-8')
  if name!=i.filename:raise ValueError('Nome de membro divergente')
  compressed=self.trecho(i.header_offset+30+len(names),i.compress_size)
  d=zlib.decompressobj(-15);body=d.decompress(compressed,i.file_size+1)
  if len(body)!=i.file_size or not d.eof or zlib.crc32(body)!=i.CRC:raise ValueError('Membro ZIP incompleto')
  dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)

 def membro_longo(self,i,dest,prefixo=None):
  if i.compress_type!=zipfile.ZIP_DEFLATED or i.file_size>2_000_000_000 or i.compress_size>300_000_000:raise ValueError('Membro longo fora dos limites')
  if dest.exists():
   crc=0;size=0
   with dest.open('rb')as f:
    for b in iter(lambda:f.read(4*1024*1024),b''):crc=zlib.crc32(b,crc);size+=len(b)
   if crc==i.CRC and size==i.file_size:return
   raise ValueError('Arquivo longo local diverge')
  h=struct.unpack('<4s5H3L2H',self.trecho(i.header_offset,30));names=self.trecho(i.header_offset+30,h[-2]+h[-1])
  if h[0]!=b'PK\x03\x04'or names[:h[-2]].decode('utf-8')!=i.filename:raise ValueError('Cabeçalho divergente')
  start=i.header_offset+30+len(names);partial=dest.with_suffix('.csv.parcial');d=zlib.decompressobj(-15);crc=0;size=0
  if partial.exists():raise ValueError('Extração incompleta encontrada')
  with partial.open('wb')as out:
   for off in range(0,i.compress_size,8*1024*1024):
    n=min(8*1024*1024,i.compress_size-off)
    if prefixo and prefixo.exists()and prefixo.stat().st_size>=start+off+n:
     with prefixo.open('rb')as f:f.seek(start+off);chunk=f.read(n)
    else:chunk=self.trecho(start+off,n)
    b=d.decompress(chunk,i.file_size-size+1);size+=len(b);crc=zlib.crc32(b,crc)
    if size>i.file_size:raise ValueError('Expansão inesperada')
    out.write(b)
  if not d.eof or size!=i.file_size or crc!=i.CRC:raise ValueError('Extração longa incompleta')
  partial.rename(dest)

def adquirir(root):
 root=Path(root);raw=root/'csv_smp';raw.mkdir(exist_ok=True)
 source=ZipRemoto();out=[]
 with zipfile.ZipFile(source)as z:
  semesters=sorted({m[1]+'_'+m[2]+'S' for i in z.infolist() if (m:=re.fullmatch(r'Acessos_Telefonia_Movel_(20\d{2})_([12])S(?:_Colunas)?\.csv',i.filename)) and int(m[1])>=2019})
  if not semesters:raise ValueError('Nenhum semestre municipal SMP na fonte')
  preferidos={'2019_1S','2019_2S','2022_1S','2026_2S',semesters[-1]}
  longos=['Acessos_Telefonia_Movel_'+v+'.csv'for v in sorted(preferidos)if 'Acessos_Telefonia_Movel_'+v+'.csv'in z.namelist()]
  # Em 2019 as representações não são equivalentes. Junho/2022 e a
  # edição mais recente também são cotejados no arquivo longo.
  wanted=['Acessos_Telefonia_Movel_Total.csv','Densidade_Telefonia_Movel.csv']
  for sem in semesters:
   long_name='Acessos_Telefonia_Movel_'+sem+'.csv';wide_name='Acessos_Telefonia_Movel_'+sem+'_Colunas.csv'
   if wide_name not in z.namelist()and long_name in z.namelist()and long_name not in longos:longos.append(long_name)
   wanted.append(long_name if long_name in longos else wide_name)
  if len(wanted)!=len(set(wanted))or not set(wanted)<=set(z.namelist()):raise ValueError('Semestres SMP incompletos ou duplicados')
  members=[z.getinfo(name)for name in wanted]
  for i in members:
   p=raw/i.filename
   if p.exists():
    crc=0
    with p.open('rb')as cached:
     for b in iter(lambda:cached.read(1024*1024),b''):crc=zlib.crc32(b,crc)
    if p.stat().st_size!=i.file_size or crc!=i.CRC:p.unlink()
   if i.filename in longos:source.membro_longo(i,p,root/'telefonia_movel.zip.parcial')
   else:source.membro(i,p)
   out.append(dict(arquivo=p.relative_to(root).as_posix(),bytes=p.stat().st_size,sha256=sha(p),crc32=i.CRC,comprimido=i.compress_size))
   print(json.dumps(dict(adquirido=i.filename,bytes=p.stat().st_size)),flush=True)
 report=dict(ok=True,url=URL,arquivo_bytes=source.size,etag=source.etag,modificado=source.modificado,membros=out)
 salvar(root/'smp_fonte.json',report);source.s.close();return report

def normalizar(root,meta=None):
 root=Path(root).resolve();meta=meta or adquirir(root)
 work=root/'trabalho_smp';work.mkdir(exist_ok=True);db=duckdb.connect(str(work/'smp.duckdb'));db.execute("SET threads=2;SET memory_limit='3GB'");db.execute('SET temp_directory='+qs(str(work/'temporario')))
 db.execute('DROP TABLE IF EXISTS fatos');periodos=set();periodos_longos=set();quantidade=0
 for member in meta['membros']:
  filename=Path(member['arquivo']).name
  if filename in ['Acessos_Telefonia_Movel_Total.csv','Densidade_Telefonia_Movel.csv']:continue
  p=root/member['arquivo'];assert sha(p)==member['sha256']
  with p.open(encoding='utf-8-sig',newline='')as f:cols=next(csv.reader(f,delimiter=';'))
  longo='Ano'in cols;meses=[c for c in cols if re.fullmatch(r'20\d{2}-\d{2}',c)]
  pp=[int(c.replace('-',''))for c in meses]
  aliases={'UF':'uf','Código IBGE Município':'cod','Tipo de Produto':'produto','Modalidade de Cobrança':'cobranca','Tecnologia Geração':'geracao','Tipo de Pessoa':'pessoa'}
  select=','.join(qi(k)+' AS '+v for k,v in aliases.items())+','+','.join(qi(m)for m in(['Ano','Mês','Acessos']if longo else meses))
  db.execute('CREATE OR REPLACE VIEW wide AS SELECT '+select+' FROM read_csv('+qs(p.as_posix())+",delim=';',header=true,all_varchar=true,nullstr='',sample_size=20480)")
  if longo:pp=[int(p) for p, in db.execute('SELECT DISTINCT cast("Ano" AS INTEGER)*100+cast("Mês" AS INTEGER) FROM wide ORDER BY 1').fetchall()]
  if not pp or periodos.intersection(pp)or any(p%100 not in range(1,13)for p in pp):raise ValueError('Períodos SMP ausentes, duplicados ou inválidos')
  periodos.update(pp)
  if longo:periodos_longos.update(pp)
  sql="SELECT cast(replace(periodo,'-','')AS INTEGER)periodo,upper(trim(uf))uf,try_cast(cod AS BIGINT)cod_ibge,produto,cobranca,geracao,pessoa,try_cast(replace(valor,',','.')AS DOUBLE)q FROM(UNPIVOT wide ON "+','.join(qi(m)for m in meses)+' INTO NAME periodo VALUE valor)'
  if longo:sql=sql.replace("cast(replace(periodo,'-','')AS INTEGER)",'cast("Ano"AS INTEGER)*100+cast("Mês"AS INTEGER)').replace('FROM(UNPIVOT wide ON  INTO NAME periodo VALUE valor)','FROM(SELECT *,"Acessos"valor FROM wide)')
  sql+=' WHERE valor IS NOT NULL'
  db.execute(('CREATE TABLE fatos AS 'if quantidade==0 else'INSERT INTO fatos ')+sql);quantidade+=1
  print(json.dumps(dict(normalizado=p.name)),flush=True)
 finalizar(root,db,meta,periodos,periodos_longos)

def finalizar(root,db,meta,periodos,periodos_longos=None):
 assert {p for p, in db.execute('SELECT DISTINCT periodo FROM fatos').fetchall()}==set(periodos),'Período inesperado na edição: revisar seleção dos arquivos'
 assert db.execute('SELECT count(*)FROM fatos WHERE q IS NULL OR q<0 OR NOT isfinite(q)OR q<>floor(q)').fetchone()[0]==0
 totals=db.execute('SELECT periodo,sum(q)q FROM fatos GROUP BY 1 ORDER BY 1').fetchdf().set_index('periodo').q
 official=pd.read_csv(root/'csv_smp/Acessos_Telefonia_Movel_Total.csv',sep=';');official['periodo']=official.Ano*100+official['Mês'];truth=official.set_index('periodo').Acessos.reindex(totals.index)
 # O resumo nacional mede apenas o uso padrão e termina antes dos CSVs.
 standard=db.execute("SELECT periodo,sum(q)q FROM fatos WHERE produto IN ('VOZ','DADOS','VOZ+DADOS','OCIOSO')GROUP BY 1 ORDER BY 1").fetchdf().set_index('periodo').q
 diferenca=(standard-truth)[truth.notna()];different=diferenca[diferenca.ne(0)]
 expected={201901:795101,201907:-56315,202206:-12518}
 assert all(int(k)in expected and int(v)==expected[int(k)]for k,v in different.items()),'Divergência nova entre resumo e detalhado: revisar antes de gerar'
 assert not any(p%100==12 for p in different.index),'Retrato anual de dezembro diverge do resumo'
 divergencias={str(p):dict(detalhado=int(standard.loc[p]),resumo=int(truth.loc[p]),diferenca=int(v))for p,v in different.items()}
 validar_periodos(periodos)
 refs={y:max(p for p in periodos if p//100==y)for y in sorted({p//100 for p in periodos})}
 def norm(col):return "regexp_replace(lower(strip_accents(trim("+col+"))),'[^a-z0-9]','','g')"
 prod,gen,cob,pessoa=map(norm,['produto','geracao','cobranca','pessoa'])
 db.execute('CREATE OR REPLACE VIEW f AS SELECT periodo,uf,cod_ibge,q,'+prod+' produto,'+gen+' geracao,'+cob+' cobranca,'+pessoa+' pessoa FROM fatos')
 std="produto IN ('voz','dados','vozdados','ocioso')";m2m="produto LIKE '%m2m%'";ponto="produto='pontodeservico'"
 sums=['sum(q)int_smp_total']
 for key,expr in {'padrao':std,'m2m':m2m,'ponto':ponto,'tipo_ign':f"produto IS NULL OR NOT({std}OR {m2m}OR {ponto})"}.items():sums.append('sum(CASE WHEN '+expr+' THEN q ELSE 0 END)int_smp_'+key)
 for key,expr in {'2g':"geracao='2g'",'3g':"geracao='3g'",'4g':"geracao='4g'",'5g':"geracao='5g'",'outras':"geracao IS NULL OR geracao NOT IN ('2g','3g','4g','5g')"}.items():
  val='sum(CASE WHEN '+std+' AND('+expr+')THEN q ELSE 0 END)'
  if key=='5g':val='CASE WHEN periodo>=202108 THEN '+val+' END'
  sums.append(val+' int_smp_tec_'+key)
 for prefix,items in [('cobranca',{'pre':"cobranca='prepago'",'pos':"cobranca='pospago'",'ign':"cobranca IS NULL OR cobranca NOT IN ('prepago','pospago')"}),('pessoa',{'fisica':"pessoa='pessoafisica'",'juridica':"pessoa='pessoajuridica'",'ign':"pessoa IS NULL OR pessoa NOT IN ('pessoafisica','pessoajuridica')"})]:
  for key,expr in items.items():sums.append('sum(CASE WHEN '+std+' AND('+expr+')THEN q ELSE 0 END)int_smp_'+prefix+'_'+key)
 path=root/'smp_municipio_mensal.parquet';db.execute('COPY(SELECT periodo,uf,cod_ibge,'+','.join(sums)+' FROM f GROUP BY 1,2,3 ORDER BY 1,2,3)TO '+qs(path.as_posix())+'(FORMAT PARQUET,COMPRESSION ZSTD)')
 dist={c:db.execute('SELECT '+qi(c)+',sum(q) FROM fatos GROUP BY 1 ORDER BY 2 DESC').fetchall()for c in ['produto','geracao','cobranca','pessoa']}
 report=dict(ok=True,fonte=meta,referencias=refs,periodos=sorted(periodos),resumo_oficial_ate=int(official.periodo.max()),meses_cotejados=int(truth.notna().sum()),meses_iguais=int(truth.notna().sum())-len(divergencias),divergencias_resumo=divergencias,ultimo_mes_conferido_em_arquivo_longo=max(periodos_longos or [],default=None),linhas=int(db.execute('SELECT count(*)FROM fatos').fetchone()[0]),totais={int(k):int(v)for k,v in totals.items()},distribuicoes=dist,agregado=dict(arquivo=path.name,sha256=sha(path),bytes=path.stat().st_size))
 salvar(root/'smp_normalizado.json',report);db.close();print(json.dumps(dict(ok=True,referencias=refs,distribuicoes=dist),ensure_ascii=True),flush=True)

def validar_pastas(fixa,saida):
 fixa,saida=Path(fixa).resolve(),Path(saida).resolve()
 if fixa==saida or fixa.is_relative_to(saida)or saida.is_relative_to(fixa):raise ValueError('Destinos sobrepostos')
 return fixa,saida

def ampliar_fixa(fixa,saida):
 """Reaproveita a edição já publicada, sem alterar os agregados existentes."""
 fixa,saida=validar_pastas(fixa,saida)
 meta=json.loads((fixa/'anatel_normalizado.json').read_bytes())
 for item in meta['agregados'].values():assert sha(fixa/item['arquivo'])==item['sha256']
 db=duckdb.connect(str(fixa/'trabalho/anatel.duckdb'),read_only=True)
 tec="regexp_replace(lower(strip_accents(trim(tecnologia))),'[^a-z0-9]','','g')"
 expressions={'ftth':"tec='ftth'",'fttb':"tec='fttb'",'hfc':"tec IN ('hfc','cablemodem')",'xdsl':"tec IN ('adsl','adsl1','adsl2','adsl2plus','vdsl','vdsl2','hdsl','sdsl')",'ethernet':"tec='ethernet'",'outras':"tec IS NULL OR tec NOT IN ('ftth','fttb','hfc','cablemodem','adsl','adsl1','adsl2','adsl2plus','vdsl','vdsl2','hdsl','sdsl','ethernet')"}
 sums=['sum(CASE WHEN '+expr+' THEN q ELSE 0 END)int_tec_'+key for key,expr in expressions.items()]
 for n in [300,500]:sums.append('CASE WHEN bool_and(tem_vel)THEN sum(CASE WHEN mbps>='+str(n)+' AND isfinite(mbps)THEN q ELSE 0 END)END int_vel_'+str(n))
 extra=db.execute('SELECT periodo,uf,cod_ibge,'+','.join(sums)+' FROM(SELECT *, '+tec+' tec FROM fatos)GROUP BY 1,2,3').fetchdf();db.close()
 base=pd.read_parquet(fixa/'municipio_mensal.parquet');merged=base.merge(extra,on=['periodo','uf','cod_ibge'],how='left',validate='one_to_one');assert len(base)==len(merged)
 for col in base:pd.testing.assert_series_equal(base[col].reset_index(drop=True),merged[col].reset_index(drop=True),check_names=False,check_dtype=False,check_exact=True)
 merged.to_parquet(saida/'municipio_mensal.parquet',index=False,compression='zstd');shutil.copy2(fixa/'mercado_referencias.parquet',saida/'mercado_referencias.parquet')
 meta['base_normalizada_sha256']=sha(fixa/'anatel_normalizado.json');meta['agregados']['municipio_mensal']['sha256']=sha(saida/'municipio_mensal.parquet');meta['ampliacao']='Tecnologias FTTH/FTTB/HFC/xDSL/Ethernet e limiares de 300/500 Mbps, sobre a mesma edição SCM.'
 salvar(saida/'anatel_normalizado.json',meta);print(json.dumps(dict(fixa_preservada=True,linhas=len(merged))),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--fontes',type=Path,required=True);p.add_argument('--fixa',type=Path);a=p.parse_args()
 if a.fixa:validar_pastas(a.fixa,a.fontes)
 a.fontes.mkdir(parents=True,exist_ok=True);normalizar(a.fontes)
 if a.fixa:ampliar_fixa(a.fixa,a.fontes)
