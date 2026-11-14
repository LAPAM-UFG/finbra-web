"""Auditoria independente dos arquivos municipais, sem escrever nas fontes."""
import argparse
import json
import re
import time
import zipfile
import csv
import io
from pathlib import Path
import duckdb
import pyarrow.parquet as pq
from painel_municipal import qi,qs,sha,KEYS


def validar(root,base,core=False):
 root=root.resolve();base=base.resolve();dest=root/'gold/downloads'
 if core:
  for tentativa in range(10):
   try:cache=json.loads((root/'trabalho_downloads/cache_exports.json').read_text(encoding='utf-8'));break
   except json.JSONDecodeError:time.sleep(.1)
  obj=cache['painel_brasil|parquet']['objeto'];manifest=None
 else:
  manifest=json.loads((dest/'manifesto.json').read_text(encoding='utf-8'));assert not manifest.get('parcial')
  assert sha(base/'gold/manifesto.json')==manifest['base_sha256']
  obj=next(a for a in manifest['arquivos'] if a['tipo']=='painel' and a['uf'] is None and a['formato']=='parquet')
 p=root/obj['caminho'];assert p.is_file() and sha(p)==obj['sha256']
 db=duckdb.connect();db.execute("SET threads=2; SET memory_limit='2GB'")
 db.execute('CREATE VIEW painel AS SELECT * FROM read_parquet('+qs(p.as_posix())+')')
 def fonte(relative):return 'read_parquet('+qs((base/relative).as_posix())+',union_by_name=true,hive_partitioning=false)'
 def valor(q):return db.execute(q).fetchall()[0][0]
 report={'linhas':valor('SELECT count(*) FROM painel'),'variaveis':len(pq.ParquetFile(p).schema_arrow)-len(KEYS),'conferencias':{}}
 assert report['linhas']==obj['linhas']
 if manifest:
  assert manifest['resumo']['linhas']==report['linhas'] and manifest['resumo']['variaveis']==report['variaveis'],'Resumo não corresponde ao arquivo nacional'
 assert not valor("SELECT count(*) FROM painel WHERE cod_ibge IS NULL OR NOT regexp_full_match(cod_ibge,'[0-9]{7}') OR ano IS NULL")
 assert not valor('SELECT count(*) FROM (SELECT cod_ibge,ano,count(*) n FROM painel GROUP BY 1,2 HAVING n>1)')
 def conferir(nome,source,fields,where='true',year='ano',code='cod_ibge'):
  comparisons=[f'p.{qi(k)} IS DISTINCT FROM ({v})' for k,v in fields.items()];count=0
  for start in range(0,len(comparisons),32):
   count+=valor(f'SELECT count(*) FROM painel p JOIN {source} s ON p.cod_ibge=cast(s.{qi(code)} AS VARCHAR) AND p.ano=s.{qi(year)} WHERE ({where}) AND ('+' OR '.join(comparisons[start:start+32])+')')
  assert count==0,(nome,count)
  print(json.dumps({'conferencia':nome,'colunas':len(fields),'divergencias':count}),flush=True)
  report['conferencias'][nome]=dict(colunas=len(fields),divergencias=count)
 # Cópias diretas: confere todos os valores, incluindo zeros e nulos.
 raw=fonte('gold/indicadores.parquet');columns=[r[0] for r in db.execute('DESCRIBE SELECT * FROM '+raw).fetchall()]
 pcols=set(pq.ParquetFile(p).schema_arrow.names)
 fields={'fin_'+c:'s.'+qi(c) for c in columns if 'fin_'+c in pcols}
 conferir('financeiro_integral',raw,fields,"s.esfera='M'",'exercicio')
 cat=json.loads(Path(__file__).with_name('painel_municipal_catalogos.json').read_text(encoding='utf-8'))
 raw=fonte('gold/saude/municipios.parquet');fields={}
 for c in cat['saude_campos']:
  years=','.join(map(str,c['anos']));pred='s.ano IN ('+years+')' if years else 'false'
  fields['sau_'+c['campo']]='CASE WHEN '+pred+' THEN s.'+qi(c['campo'])+' END'
 for i in cat['saude_indicadores']:
  years=','.join(map(str,i['anos']));pred='s.ano IN ('+years+')' if years else 'false'
  fields['sau_ind_'+i['id']]=f'CASE WHEN {pred} THEN s.{qi(i["numerador"])}/nullif(s.{qi(i["denominador"])},0)*{i["fator"]} END'
 conferir('saude_contagens_e_taxas',raw,fields,'s.cod_ibge IS NOT NULL')
 # Garante que o zero de categoria RAIS não esconde uma dimensão não tabulada.
 perfis=fonte('gold/trabalho/perfis_v2/ano=*.parquet')
 missing=valor(f'''WITH t AS (SELECT ano,escopo,vinculos FROM {perfis} WHERE variavel='total' AND regexp_full_match(escopo,'[0-9]{{7}}')),
  dims AS (SELECT unnest(['raca_cor','escolaridade','tipo_vinculo','vinculo_mte']) variavel),
  somas AS (SELECT ano,escopo,variavel,sum(vinculos) n FROM {perfis} WHERE variavel!='total' GROUP BY 1,2,3)
  SELECT count(*) FROM t CROSS JOIN dims d LEFT JOIN somas s ON s.ano=t.ano AND s.escopo=t.escopo AND s.variavel=d.variavel WHERE coalesce(s.n,0)!=t.vinculos''')
 assert missing==0,('Dimensões RAIS incompletas',missing)
 report['conferencias']['rais_dimensoes_fechadas']=dict(divergencias=missing)
 # Pesquisa nunca migra de edição para outro ano.
 for i in cat['munic']:
  col='mun_'+i['id'];years=','.join(str(f['ano']) for f in i['fontes'])
  assert not valor(f'SELECT count(*) FROM painel WHERE ano NOT IN ({years}) AND {qi(col)} IS NOT NULL'),col
 report['conferencias']['munic_sem_interpolacao']=len(cat['munic'])
 # Valores mensais e anuais são comparados com consultas independentes, sem arg_max.
 source_manifest=json.loads((base/'gold/manifesto.json').read_text(encoding='utf-8'))
 for source,ids in [('cadunico',['cad_qtd_familias']),('bpc',['bpc_beneficios','bpc_valor_pago'])]:
  raw=fonte(source_manifest['fontes']['assistencia']['arquivos'][source]['caminho'])
  for id in ids:
   if 'soc_'+id not in pcols:continue
   expected=f"SELECT * FROM {raw} WHERE nivel='M' AND indicador={qs(id)} QUALIFY row_number() over(partition by cod_ibge,competencia//100 order by competencia DESC)=1"
   q=f'SELECT count(*) FROM painel p JOIN ({expected}) s ON p.cod_ibge=cast(s.cod_ibge AS VARCHAR) AND p.ano=s.competencia//100 WHERE p.{qi("soc_"+id)} IS DISTINCT FROM s.valor OR p.{qi("soc_"+id+"_mes")} IS DISTINCT FROM s.competencia%100 OR p.{qi("soc_"+id+"_condicao")} IS DISTINCT FROM s.condicao'
   assert valor(q)==0,('Último registro social',id)
 report['conferencias']['ultimo_mes_inclusive_nulos']=True
 if manifest:
  dictionary=json.loads((root/manifest['dicionario']['caminho']).read_text(encoding='utf-8'));keys={(d['tabela'],d['variavel']) for d in dictionary};assert len(keys)==len(dictionary)
  checked=0;csvs=0
  for a in manifest['arquivos']:
   f=(root/a['caminho']).resolve();assert f.is_relative_to(dest.resolve())
   assert f.is_file() and f.stat().st_size==a['bytes'] and sha(f)==a['sha256'],a['id'];checked+=1
   if a['formato']=='parquet':
    pf=pq.ParquetFile(f);assert pf.metadata.num_rows==a['linhas'];assert len(pf.schema_arrow)==a['variaveis']+len(KEYS)
    table='painel' if a['tipo'] in ['painel','area'] else re.sub('_parquet$','',a['id'])
    assert all(c in KEYS or (table,c) in keys for c in pf.schema_arrow.names),(a['id'],'Coluna sem dicionário')
   elif a['formato']=='csv.zip':
    with zipfile.ZipFile(f) as z:
     assert len(z.namelist())==1
     with z.open(z.namelist()[0]) as stream:
      reader=csv.reader(io.TextIOWrapper(stream,encoding='utf-8-sig',newline=''),delimiter=';');header=next(reader)
      if a['tipo']!='dicionario':
       assert header[:6]==KEYS and len(header)==a['variaveis']+6,a['id']
       par=next(b for b in manifest['arquivos'] if b['id']==a['id'].removesuffix('_csv_zip')+'_parquet')
       assert header==pq.read_schema(root/par['caminho']).names,('Ordem CSV/Parquet divergente',a['id'])
       for n,row in enumerate(reader):
        assert len(row)==len(header),(a['id'],n)
        if n==2:break
    csvs+=1
  report.update(objetos_conferidos=checked,csvs=csvs,dicionario=len(dictionary),municipios=valor('SELECT count(distinct cod_ibge) FROM painel'),manifesto_sha256=sha(dest/'manifesto.json'))
 report['ok']=True;db.close();return report


if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--raiz',type=Path,required=True);ap.add_argument('--base',type=Path,required=True);ap.add_argument('--core',action='store_true');ap.add_argument('--relatorio',type=Path,required=True);args=ap.parse_args()
 report=validar(args.raiz,args.base,args.core);args.relatorio.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(report,ensure_ascii=False))
