"""Candidato de remuneração válida da RAIS, sem reler microdados nem modificar origens.

Recalcula apenas médias; concilia vínculos, massas e coberturas com o gold publicado.
Mantém arquivos legados para clientes antigos. --base é um snapshot do R2 com o
manifesto, municípios, setores e perfis; --silver contém rais_vinculos/ano=*.parquet.
"""
import argparse,copy,hashlib,json,sys
from datetime import datetime,timezone
from pathlib import Path
import duckdb,pyarrow.parquet as pq
from trabalho_perfis import remuneracao_doc

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def sql(p):return "'"+Path(p).as_posix().replace("'","''")+"'"

def gerar(base,silver,saida):
 base,silver,saida=[Path(p).resolve()for p in [base,silver,saida]]
 for origem in [base,silver]:
  if origem==saida or origem.is_relative_to(saida)or saida.is_relative_to(origem):raise ValueError('Saída deve estar separada das origens')
 if (saida/'gold/manifesto.json').exists():raise ValueError('Candidato já existe; use uma nova pasta')
 original=json.loads((base/'gold/manifesto.json').read_bytes());m=copy.deepcopy(original)
 oldperfil=m['fontes']['rais_perfis'];oldpath=oldperfil['arquivos'];oldindex=json.loads((base/oldperfil['indice']).read_bytes())
 stamp=datetime.now(timezone.utc).isoformat();db=duckdb.connect();db.execute("SET threads=4;SET memory_limit='3GB'")
 db.execute('CREATE VIEW g AS SELECT *,cod_ibge//10 AS mun6 FROM read_parquet('+sql(base/'gold/trabalho/municipios.parquet')+')')
 db.execute('CREATE VIEW s AS SELECT * FROM read_parquet('+sql(silver/'rais_vinculos/ano=*.parquet')+')')
 # Mesmo conjunto de municípios/anos do gold publicado, e mesmas parcelas da massa.
 db.execute('CREATE TABLE setores AS SELECT s.ano,g.cod_ibge,g.uf,s.divisao,sum(s.vinculos) empregos,sum(s.rem_dez_soma) massa_dez,sum(s.rem_dez_n) n_rem_dez FROM s JOIN g ON g.mun6=s.municipio AND g.ano=s.ano GROUP BY ALL')
 old=base/'gold/trabalho/setores.parquet'
 assert db.execute('SELECT count(*) FROM setores n FULL JOIN read_parquet('+sql(old)+') o USING(ano,cod_ibge,divisao) WHERE n.empregos IS DISTINCT FROM o.empregos').fetchone()[0]==0,'Estoque setorial não coincide com o publicado'
 assert db.execute('SELECT count(*) FROM (SELECT ano,cod_ibge,sum(massa_dez) massa,sum(n_rem_dez) n FROM setores GROUP BY 1,2)t JOIN g USING(ano,cod_ibge) WHERE t.n IS DISTINCT FROM g.n_rem_dez OR abs(coalesce(t.massa,0)-coalesce(g.massa_dez,0))>0.021').fetchone()[0]==0,'Massa/cobertura setorial não coincide com o publicado'
 dest=saida/'gold/trabalho';dest.mkdir(parents=True,exist_ok=True)
 db.execute('COPY (SELECT ano,cod_ibge,divisao,empregos,massa_dez,n_rem_dez,massa_dez/nullif(n_rem_dez,0) remuneracao_media_dez FROM setores ORDER BY cod_ibge,ano,divisao) TO '+sql(dest/'setores_validos.parquet')+' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 8192)')
 # O publicado inclui códigos ignorados no Brasil e códigos fora do cadastro municipal na UF.
 # Preservar esse universo, distinto dos perfis conciliados ao cadastro municipal.
 db.execute('CREATE VIEW uf_s AS SELECT s.*,e.uf FROM s LEFT JOIN (SELECT cod_ibge,uf FROM read_parquet('+sql(base/'silver/entes.parquet')+") WHERE esfera IN ('E','D')) e ON e.cod_ibge=s.municipio//10000")
 db.execute("CREATE TABLE setores_uf AS SELECT ano,CASE WHEN grouping(uf)=1 THEN 'BR' ELSE uf END escopo,divisao,sum(vinculos) empregos,sum(rem_dez_soma) massa_dez,sum(rem_dez_n)n_rem_dez FROM uf_s GROUP BY GROUPING SETS((ano,uf,divisao),(ano,divisao)) HAVING grouping(uf)=1 OR uf IS NOT NULL")
 diferencas=db.execute('SELECT n.ano,n.escopo,n.divisao,n.empregos,o.empregos FROM setores_uf n FULL JOIN read_parquet('+sql(base/'gold/trabalho/setores_uf.parquet')+')o ON n.ano=o.ano AND n.escopo IS NOT DISTINCT FROM o.escopo AND n.divisao IS NOT DISTINCT FROM o.divisao WHERE n.empregos IS DISTINCT FROM o.empregos').fetchall()
 assert not diferencas,'Estoque UF/BR diferente: '+str(diferencas[:8])
 db.execute('COPY (SELECT *,massa_dez/nullif(n_rem_dez,0) remuneracao_media_dez FROM setores_uf ORDER BY escopo,ano,divisao) TO '+sql(dest/'setores_uf_validos.parquet')+' (FORMAT PARQUET,COMPRESSION ZSTD)')
 newfolder=dest/'perfis_v2_validos';newfolder.mkdir();index=copy.deepcopy(oldindex);rows=0;changed=0
 for ano in oldperfil['anos']:
  src=base/oldpath.replace('{ano}',str(ano));target=newfolder/f'ano={ano}.parquet'
  db.execute('CREATE OR REPLACE VIEW perfil AS SELECT * FROM read_parquet('+sql(src)+')')
  db.execute('COPY (SELECT * REPLACE(massa_dez_centavos::DOUBLE/100.0/nullif(n_rem_dez,0) AS remuneracao_media_dez) FROM perfil ORDER BY escopo,variavel,codigo) TO '+sql(target)+' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 8192)')
  db.execute('CREATE OR REPLACE VIEW corrigido AS SELECT * FROM read_parquet('+sql(target)+')')
  assert db.execute('SELECT count(*) FROM ((SELECT * EXCLUDE(remuneracao_media_dez) FROM perfil EXCEPT ALL SELECT * EXCLUDE(remuneracao_media_dez) FROM corrigido) UNION ALL (SELECT * EXCLUDE(remuneracao_media_dez) FROM corrigido EXCEPT ALL SELECT * EXCLUDE(remuneracao_media_dez) FROM perfil))').fetchone()[0]==0,'Perfil alterou parcelas: '+str(ano)
  assert db.execute('SELECT count(*) FROM corrigido WHERE n_rem_dez>vinculos OR (remuneracao_media_dez IS NULL)<>(n_rem_dez=0) OR abs(remuneracao_media_dez-massa_dez_centavos/100.0/n_rem_dez)>1e-8').fetchone()[0]==0
  n,c=db.execute('SELECT count(*),count(*)FILTER(remuneracao_media_dez IS DISTINCT FROM massa_dez_centavos::DOUBLE/100/nullif(vinculos,0)) FROM corrigido').fetchone();rows+=n;changed+=c
  reg=index['arquivos'][str(ano)];reg.update(arquivo=target.name,bytes=target.stat().st_size,sha256=sha(target))
  print(json.dumps(dict(ano=ano,linhas=n,medias_corrigidas=c)),flush=True)
 index.update(gerado_em=stamp,remuneracao=remuneracao_doc());ipath=newfolder/'indice.json';ipath.write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding='utf-8')
 m['fontes']['rais'].update(setores='gold/trabalho/setores_validos.parquet',setores_uf='gold/trabalho/setores_uf_validos.parquet',remuneracao=dict(denominador='n_rem_dez',revisado_em=stamp,ausentes='Ausentes, zeros e negativos ficam fora da média; estoque e cobertura preservados'))
 newperfil=copy.deepcopy(oldperfil);newperfil.update(arquivos='gold/trabalho/perfis_v2_validos/ano={ano}.parquet',indice='gold/trabalho/perfis_v2_validos/indice.json',bytes=sum(x.stat().st_size for x in newfolder.glob('*.parquet')),processado_em=stamp,remuneracao=remuneracao_doc());m['fontes']['rais_perfis']=newperfil
 # As demais fontes não mudaram. Mantemos a versão-base e revisamos só as duas fontes afetadas.
 assert all(m[k]==v for k,v in original.items()if k!='fontes')
 assert all(m['fontes'][k]==v for k,v in original['fontes'].items()if k not in ['rais','rais_perfis'])
 (saida/'gold/manifesto.json').write_text(json.dumps(m,ensure_ascii=False,indent=1),encoding='utf-8')
 audit=dict(ok=True,linhas_perfis=rows,medias_perfis_corrigidas=changed,origem_sha256=sha(base/'gold/manifesto.json'),manifesto_sha256=sha(saida/'gold/manifesto.json'),massa_e_cobertura_preservadas=True,estoque_setorial_preservado=True,arquivos_legados_preservados=True)
 (saida/'auditoria_rais.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8');db.close();return audit

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__)
 for k in ['base','silver','saida']:p.add_argument('--'+k,type=Path,required=True)
 a=p.parse_args();print(json.dumps(gerar(a.base,a.silver,a.saida),ensure_ascii=False))
