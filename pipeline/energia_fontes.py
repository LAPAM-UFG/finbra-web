"""Fontes ANEEL fixadas por SHA-256; somente agregados saem para o painel."""
import argparse,hashlib,json,re,shutil,unicodedata
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import duckdb,pandas as pd,requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from internet_fontes import sha,qs,salvar

MMGD='relacao-de-empreendimentos-de-geracao-distribuida'
SIGA='siga-sistema-de-informacoes-de-geracao-da-aneel'
SITE='https://finbra-web.luanviniciusbernardelli.workers.dev/dados/'
RECURSOS={MMGD:['empreendimento-geracao-distribuida.parquet',
 'empreendimento-gd-informacoes-tecnicas-fotovoltaica.parquet',
 *['empreendimento-gd-informacoes-tecnicas-'+v+'.csv'for v in ['eolica','hidreletrica','termeletrica']]],
 SIGA:['siga-empreendimentos-geracao-diario.csv']}

def sessao():
 s=requests.Session();s.mount('https://',HTTPAdapter(max_retries=Retry(total=3,connect=3,read=1,backoff_factor=1)));return s

def adquirir(root):
 root=Path(root);root.mkdir(parents=True,exist_ok=True);out=[]
 for slug,names in RECURSOS.items():
  meta=root/(slug+'.json')
  if not meta.exists():
   with sessao()as s:r=s.get('https://dadosabertos.aneel.gov.br/api/3/action/package_show',params={'id':slug},timeout=(20,120));r.raise_for_status();salvar(meta,r.json())
  package=json.loads(meta.read_bytes());assert package['success']
  for name in names:
   a=next(x for x in package['result']['resources']if x['name']==name);p=root/name;mp=root/(name+'.fonte.json')
   if p.exists():
    ref=json.loads(mp.read_bytes());assert ref['url']==a['url']and p.stat().st_size==ref['bytes']and sha(p)==ref['sha256']
   else:
    temp=p.with_suffix(p.suffix+'.parcial')
    if temp.exists():raise ValueError('Aquisição parcial: use uma pasta nova ou confira a falha antes de repetir')
    with sessao()as s,s.get(a['url'],stream=True,timeout=(20,180))as r:
     r.raise_for_status()
     with temp.open('xb')as f:
      for b in r.iter_content(1024*1024):f.write(b)
     assert not r.headers.get('Content-Length')or int(r.headers['Content-Length'])==temp.stat().st_size
     assert not a.get('size')or a['size']==temp.stat().st_size
     ref=dict(ok=True,arquivo=name,url=a['url'],bytes=temp.stat().st_size,sha256=sha(temp),etag=r.headers.get('ETag'),last_modified=r.headers.get('Last-Modified'),recurso=a['id']);temp.rename(p);salvar(mp,ref)
   out.append(ref);print(json.dumps(dict(adquirido=name,bytes=ref['bytes'])),flush=True)
 return out

def fixar(root,caches):
 root=Path(root);caches=list(map(Path,caches))
 def baixar(key,ref=None):
  p=root/key;p.parent.mkdir(parents=True,exist_ok=True)
  if not p.exists():
   old=next((x/key for x in caches if ref and(x/key).is_file()and(x/key).stat().st_size==ref['bytes']and sha(x/key)==ref['sha256']),None)
   if old:shutil.copy2(old,p)
   else:
    with sessao()as s:r=s.get(SITE+key,headers={'Cache-Control':'no-cache'},timeout=(20,180));r.raise_for_status();p.write_bytes(r.content)
  if ref:assert p.stat().st_size==ref['bytes']and sha(p)==ref['sha256']
  return dict(chave=key,bytes=p.stat().st_size,sha256=sha(p))
 keys=['gold/manifesto.json','gold/downloads/manifesto.json','gold/comparacoes/manifesto.json','gold/raiox/v8_manifesto.json','gold/internet/manifesto.json','gold/mobilidade/manifesto.json','gold/seguranca/manifesto.json']
 with ThreadPoolExecutor(max_workers=3)as e:refs=list(e.map(baixar,keys))
 dm=json.loads((root/keys[1]).read_bytes());cp=json.loads((root/keys[2]).read_bytes());main=next(x for x in dm['arquivos']if x['id']=='painel_brasil_parquet')
 with ThreadPoolExecutor(max_workers=3)as e:refs+=list(e.map(lambda x:baixar(x['caminho'],x),[dm['dicionario'],*dm['recortes_uf'].values(),cp['geografia'],main]))
 shutil.copy2(root/cp['geografia']['caminho'],root/'geografia.json')
 pop=root/'populacao_2026_sidra.json'
 if not pop.exists():
  cached=next((x/pop.name for x in caches if(x/pop.name).is_file()),None)
  if cached:shutil.copy2(cached,pop)
  else:
   with sessao()as s:r=s.get('https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/2026',timeout=(20,180));r.raise_for_status();salvar(pop,r.json())
 rows=json.loads(pop.read_bytes());assert len(rows)==5572 and all(x['D3C']=='2026'and x['D2C']=='9324'for x in rows[1:])
 salvar(root/'base_publicada.json',dict(ok=True,arquivos=refs,populacao_2026_sha256=sha(pop)))

def norm(x):return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',str(x)).encode('ascii','ignore').decode().lower())

def normalizar_datas(tech):
 tech=tech.copy();tech['DatConexao']=pd.to_datetime(tech.DatConexao,errors='coerce');tech.loc[tech.DatConexao.eq(pd.Timestamp('1900-01-01')),'DatConexao']=pd.NaT
 different=tech.groupby(['CodGeracaoDistribuida','tecnologia']).DatConexao.nunique();assert not different.gt(1).any(),'Datas de conexão conflitantes para a mesma tecnologia'
 return tech.sort_values('DatConexao',na_position='first').drop_duplicates(['CodGeracaoDistribuida','tecnologia'],keep='last')

def deduplicar_usinas(sd):
 duplicates=0
 for _,z in sd[sd.CodCEG.duplicated(False)].groupby('CodCEG'):
  assert all(z[c].nunique(dropna=False)==1 for c in z if c!='DscTipoOutorga'),'CEG com atributos incompatíveis';duplicates+=len(z)-1
 return sd.drop_duplicates('CodCEG').copy(),duplicates

def validar_pastas(root,caches):
 root=Path(root).resolve()
 for cache in map(lambda x:Path(x).resolve(),caches):
  if root==cache or root.is_relative_to(cache)or cache.is_relative_to(root):raise ValueError('Fontes e caches sobrepostos')
 return root

def normalizar(root):
 root=Path(root);db=duckdb.connect();db.execute("SET threads=2;SET memory_limit='3GB'")
 geo=json.loads((root/'geografia.json').read_bytes());municipios=geo['municipios'];lookup={(norm(n),u):int(c)for c,n,u,*_ in municipios};valid={int(m[0]):m[2]for m in municipios}
 aliases=[('Alto Alegre do Parecis','RO','Alto Alegre dos Parecis'),('Armação de Búzios','RJ','Armação dos Búzios'),('Arês','RN','Arez'),('Açu','RN','Assú'),('Bataiporã','MS','Batayporã'),('Chiapeta','RS','Chiapetta'),('Embu','SP','Embu das Artes'),('Ipauçu','SP','Ipaussu'),('Lagoa do Itaenga','PE','Lagoa de Itaenga'),('Moji das Cruzes','SP','Mogi das Cruzes'),('Moji-Mirim','SP','Mogi Mirim'),('Muquém de São Francisco','BA','Muquém do São Francisco'),('Poxoréo','MT','Poxoréu'),('Santo Antônio do Leverger','MT','Santo Antônio de Leverger'),('Trajano de Morais','RJ','Trajano de Moraes')]
 for alias,uf,atual in aliases:lookup[norm(alias),uf]=lookup[norm(atual),uf]
 base=root/'empreendimento-geracao-distribuida.parquet';db.execute('CREATE VIEW gd AS SELECT * FROM read_parquet('+qs(base.as_posix())+')')
 assert db.execute('SELECT count(*)-count(DISTINCT CodEmpreendimento)FROM gd').fetchone()[0]==0
 assert db.execute('SELECT count(*)FROM gd WHERE MdaPotenciaInstaladaKW IS NULL OR NOT isfinite(MdaPotenciaInstaladaKW)OR MdaPotenciaInstaladaKW<0').fetchone()[0]==0
 technical=[]
 for file in RECURSOS[MMGD][1:]:
  p=root/file;z=db.execute('SELECT CodGeracaoDistribuida,DatConexao FROM '+('read_parquet('+qs(p.as_posix())+')'if file.endswith('parquet')else'read_csv('+qs(p.as_posix())+",delim=';',header=true,all_varchar=true)")).fetchdf();z['tecnologia']='UFV'if'fotovoltaica'in file else'EOL'if'eolica'in file else'HID'if'hidreletrica'in file else'UTE';technical.append(z)
 tech=normalizar_datas(pd.concat(technical,ignore_index=True));db.register('tech',tech)
 db.execute("CREATE VIEW f AS SELECT g.CodEmpreendimento,g.CodMunicipioIbge cod_ibge,g.SigUF uf,g.MdaPotenciaInstaladaKW kw,g.QtdUCRecebeCredito creditos,g.SigTipoGeracao tipo,g.DscClasseConsumo classe,g.DscPorte porte,t.DatConexao conexao FROM gd g LEFT JOIN tech t ON t.CodGeracaoDistribuida=g.CodEmpreendimento AND t.tecnologia=CASE WHEN g.SigTipoGeracao IN ('CGH','PCH','UHE')THEN'HID'ELSE g.SigTipoGeracao END")
 assert db.execute('SELECT count(*)FROM f').fetchone()[0]==db.execute('SELECT count(*)FROM gd').fetchone()[0]
 date=db.execute('SELECT min(DatGeracaoConjuntoDados),max(DatGeracaoConjuntoDados),count(DISTINCT AnmPeriodoReferencia)FROM gd').fetchone();assert date[0]==date[1]and date[2]==1;gd_date=date[0].isoformat();year=date[0].year
 assert db.execute('SELECT count(*)FROM f WHERE conexao>CAST(?AS DATE)',[gd_date]).fetchone()[0]==0
 # Zero significa ausência de empreendimentos no cadastro nacional desta edição.
 items={'ene_gd_n':'count(*)','ene_gd_kw':'sum(kw)','ene_gd_creditos':'sum(creditos)','ene_gd_sem_data':'count(*)FILTER(WHERE conexao IS NULL)','ene_gd_antes2013':'count(*)FILTER(WHERE year(conexao)<2013)'}
 fontes={'solar':"tipo='UFV'",'eolica':"tipo='EOL'",'hidrica':"tipo IN ('CGH','PCH','UHE')",'termica':"tipo='UTE'",'outras':"tipo IS NULL OR tipo NOT IN ('UFV','EOL','CGH','PCH','UHE','UTE')"}
 classes={'res':"classe='Residencial'",'com':"classe='Comercial'",'rural':"classe='Rural'",'ind':"classe='Industrial'",'outras':"classe IS NULL OR classe NOT IN ('Residencial','Comercial','Rural','Industrial')"}
 portes={'micro':"porte='Microgeracao'",'mini':"porte='Minigeracao'",'outros':"porte IS NULL OR porte NOT IN ('Microgeracao','Minigeracao')"}
 for fam,vals in [('fonte',fontes),('classe',classes),('porte',portes)]:
  for key,expr in vals.items():
   for unit,aggregate in [('n','count(*)'),('kw','sum(kw)')]:items[f'ene_gd_{fam}_{key}_{unit}']=aggregate+' FILTER(WHERE '+expr+')'
 def aggregate(table,by,exprs):return db.execute('SELECT '+by+','+','.join(v+' '+k for k,v in exprs.items())+' FROM '+table+' GROUP BY '+','.join(str(j+1)for j in range(len(by.split(','))))).fetchdf()
 gd=aggregate('f','cod_ibge,uf',items)
 # Somatórios vazios de uma categoria dentro de um cadastro observado são zeros.
 gd[list(items)]=gd[list(items)].fillna(0);gd.to_parquet(root/'mmgd_municipios.parquet',index=False)
 totals=aggregate('f','uf',items).fillna(0);br=aggregate('f',"'BR'",items).fillna(0).rename(columns={"'BR'":'uf'});pd.concat([totals,br],ignore_index=True).to_parquet(root/'mmgd_referencias.parquet',index=False)
 cohort={'ene_gd_conexoes':'count(*)'}
 for key,expr in fontes.items():cohort['ene_gd_con_'+key]='count(*)FILTER(WHERE '+expr+')'
 co=aggregate('f WHERE conexao IS NOT NULL AND year(conexao)>=2013','cod_ibge,uf,year(conexao)ano',cohort);co.to_parquet(root/'mmgd_coortes.parquet',index=False)
 sd=pd.read_csv(root/'siga-empreendimentos-geracao-diario.csv',sep=';',dtype=str,encoding='utf-8-sig');assert sd.DatGeracaoConjuntoDados.nunique()==1;siga_date=sd.DatGeracaoConjuntoDados.iloc[0]
 # A mesma CEG aparece em mais de uma espécie de outorga. Só se elimina a
 # repetição se TODAS as medidas e os demais atributos forem idênticos.
 sd,duplicates=deduplicar_usinas(sd);sd['kw']=pd.to_numeric(sd.MdaPotenciaFiscalizadaKw.str.replace(',','.'),errors='raise');sd['outorgada_kw']=pd.to_numeric(sd.MdaPotenciaOutorgadaKw.str.replace(',','.'),errors='raise');assert sd.kw.notna().all()and sd.kw.ge(0).all()and sd.outorgada_kw.notna().all()and sd.outorgada_kw.ge(0).all()
 mappings=[];unmapped=[]
 for row in sd.itertuples(index=False):
  places=str(row.DscMuninicpios).split(', ');codes=[]
  for place in places:
   match=re.fullmatch(r'(.+) - ([A-Z]{2})',place);code=lookup.get((norm(match[1]),match[2]))if match else None
   if code is None:unmapped.append(place)
   else:codes.append(code)
  if len(codes)!=len(places):continue
  assert len(codes)==len(set(codes))
  for code in codes:mappings.append(dict(CodCEG=row.CodCEG,cod_ibge=code,compartilhada=len(codes)>1))
 if unmapped:
  salvar(root/'municipios_siga_nao_resolvidos.json',dict(locais=sorted(set(unmapped))))
  assert set(unmapped)<=set(['Não Informado','Iauretê - AM','Vila Bittencourt - AM','lagoas - MG']),'Novo município não resolvido: revise o cadastro'
 sf=sd[['CodCEG','SigUFPrincipal','DscFaseUsina','DscOrigemCombustivel','kw','outorgada_kw','DatEntradaOperacao']].rename(columns={'SigUFPrincipal':'uf','DscFaseUsina':'fase','DscOrigemCombustivel':'fonte'});sf['inicio']=pd.to_datetime(sf.DatEntradaOperacao,errors='coerce');sf=sf.drop(columns=['DatEntradaOperacao']);sm=pd.DataFrame(mappings);sf.to_parquet(root/'siga_usinas.parquet',index=False);sm.to_parquet(root/'siga_localizacoes.parquet',index=False)
 quality=dict(ok=True,mmgd_data=gd_date,siga_data=siga_date,ano=year,mmgd_empreendimentos=int(db.execute('SELECT count(*)FROM f').fetchone()[0]),mmgd_potencia_kw=float(db.execute('SELECT sum(kw)FROM f').fetchone()[0]),mmgd_com_data=int(db.execute('SELECT count(*)FROM f WHERE conexao IS NOT NULL').fetchone()[0]),mmgd_sem_data=int(db.execute('SELECT count(*)FROM f WHERE conexao IS NULL').fetchone()[0]),mmgd_municipios_nao_resolvidos=[int(c)for c,u in gd[['cod_ibge','uf']].itertuples(index=False,name=None)if valid.get(int(c))!=u],siga_usinas=len(sf),siga_duplicatas_por_outorga=duplicates,siga_multimunicipais=int(sm.groupby('CodCEG').size().gt(1).sum()),siga_sem_municipio=int((~sf.CodCEG.isin(sm.CodCEG)).sum()),siga_locais_nao_resolvidos=sorted(set(unmapped)),arquivos={name:dict(arquivo=name,sha256=sha(root/name),bytes=(root/name).stat().st_size)for name in ['mmgd_municipios.parquet','mmgd_referencias.parquet','mmgd_coortes.parquet','siga_usinas.parquet','siga_localizacoes.parquet']})
 salvar(root/'energia_normalizada.json',quality);db.close();print(json.dumps(quality),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',type=Path,required=True);p.add_argument('--cache',action='append',default=[]);a=p.parse_args();validar_pastas(a.fontes,a.cache);adquirir(a.fontes);fixar(a.fontes,a.cache);normalizar(a.fontes)
