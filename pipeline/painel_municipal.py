"""Central de downloads: painéis anuais municipais e detalhes, sem alterar as fontes.

python pipeline/painel_municipal.py --base E:/finbra/data --saida E:/finbra/candidato_downloads
Só publica arquivos agregados. O manifesto global não é modificado.
"""
import argparse
import csv
import hashlib
import json
import re
import shutil
import unicodedata
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado

VERSAO = 1
VERSAO_CSV = 2
KEYS = ['cod_ibge', 'municipio', 'uf', 'regiao', 'tipo_territorio', 'ano']
AREAS = [
 ('financas','Finanças e economia','Finance and economy'),
 ('saude','Saúde','Health'), ('trabalho','Mercado de trabalho','Labour market'),
 ('gestao','Gestão pública','Public management'), ('clima','Clima','Climate'),
 ('assistencia','Assistência social','Social assistance')]
NOTAS = [
 'Cada linha representa um código IBGE municipal de sete dígitos e um ano. Brasília/DF e Fernando de Noronha são identificados como unidades especiais, sem duplicar governos estaduais.',
 'A base integrada reúne os indicadores e recortes dos painéis. Os questionários integrais da MUNIC e as contas DCA por anexo estão nos complementos, com a mesma chave município–ano.',
 'Valor vazio não significa zero. Não há interpolação, repetição de edição de pesquisa em outro ano nem preenchimento de ausência com zero.',
 'MUNIC: respostas só na edição pesquisada. O complemento mantém variáveis separadas por edição; códigos iguais podem representar perguntas diferentes.',
 'Assistência: a coluna principal usa o último registro do ano, inclusive se nulo, com mês e condição do dado por indicador. Fluxos monetários têm também a soma dos meses disponíveis e a quantidade de meses; menos de 12 é parcial.',
 'Clima: só anos completos da série anual; agregação por soma ou média conforme a variável. A malha é fixa: séries antigas representam as áreas dos municípios atuais, não a existência administrativa histórica.',
 'Valores monetários mantêm a unidade indicada no dicionário. Colunas reais usam o ano-base IPCA publicado. A massa salarial RAIS é de dezembro, não a soma do ano.',
 'A série CGU do Bolsa Família inclui Auxílio Brasil e Novo Bolsa Família, com transições de programa; não inclui o Benefício Extraordinário do Auxílio Brasil. Folha do MDS e pagamento efetivo da CGU são conceitos separados.',
 'A DCA mantém os valores declarados, inclusive os sinalizados, com os alertas à parte. Contas hierárquicas não devem ser somadas indiscriminadamente.',
 'Nos complementos DCA, a coluna de valor vem acompanhada de um indicador _sintetico: verdadeiro identifica total reconstruído pela hierarquia no tratamento já publicado, em vez de total declarado diretamente.',
 'ESTADIC é estadual e não é replicada como dado municipal. As fontes têm coberturas distintas; a primeira e a última data do arquivo não significam cobertura completa de todas as variáveis.',
 'Brasília aparece nas fontes territoriais disponíveis. Dados de governo com código de dois dígitos (inclusive 53/DF em DCA e SIOPE) não são transplantados para o município. Portanto algumas colunas fiscais de Brasília ficam vazias.',
 'CSV em UTF-8 com BOM, ponto e vírgula e decimal com vírgula. Extraia o ZIP antes de abrir. Textos que poderiam virar fórmulas no Excel recebem apóstrofo inicial; o Parquet preserva o texto original.',
]


def sha(path):
 with Path(path).open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()


def qi(s):return '"'+str(s).replace('"','""')+'"'
def qs(s):return "'"+str(s).replace("'","''")+"'"
def slug(s):
 s=unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower()
 return re.sub('[^a-z0-9]+','_',s).strip('_') or 'ausente'


def social_mensal_para_anual(db,sources):
 """Não pula um último valor nulo e não soma estoques; a soma é saída separada."""
 db.execute('CREATE OR REPLACE TABLE social_anual AS SELECT cast(cod_ibge as VARCHAR) cod_ibge,(competencia//100)::INTEGER ano,indicador,max(competencia) ultima_competencia,arg_max(struct_pack(valor:=valor,condicao:=condicao),competencia) ultimo,sum(valor) soma,count(valor)::INTEGER meses FROM ('+' UNION ALL '.join('SELECT * FROM '+s for s in sources)+") WHERE nivel='M' GROUP BY 1,2,3")


def contagem_perfil_sql(var,code):
 fechado=f"(t.vinculos=0 OR sum(p.vinculos) FILTER(WHERE p.variavel={qs(var)})=t.vinculos)"
 return f'CASE WHEN {fechado} THEN coalesce(first(p.vinculos) FILTER(WHERE p.variavel={qs(var)} AND p.codigo={qs(code)}),0) END'


def campo(nome,descricao=None,unidade='número',fonte='',regra='Valor do ano publicado.',tipo='numero',obs=''):
 return dict(nome=nome,descricao=descricao or nome,unidade=unidade,fonte=fonte,regra_anual=regra,tipo=tipo,observacao=obs)


class Painel:
 def __init__(self,base,saida,catalogos=None):
  self.base=base.resolve();self.root=destino_isolado(saida,self.base)
  self.work=self.root/'trabalho_downloads';self.dest=self.root/'gold/downloads'
  self.work.mkdir(parents=True,exist_ok=True);self.dest.mkdir(parents=True,exist_ok=True)
  self.manifest=json.loads((self.base/'gold/manifesto.json').read_text(encoding='utf-8-sig'))
  self.base_sha=sha(self.base/'gold/manifesto.json')
  self.catalog=json.loads(Path(catalogos or Path(__file__).with_name('painel_municipal_catalogos.json')).read_text(encoding='utf-8'))
  if self.catalog.get('base_gerado_em')!=self.manifest['gerado_em']:
   raise ValueError('Atualize o catálogo de downloads para este manifesto antes de gerar a base (veja PAINEL_MUNICIPAL.md)')
  self.db=duckdb.connect(str(self.work/'painel.duckdb'))
  self.db.execute("SET threads=4; SET memory_limit='6GB'; SET preserve_insertion_order=false")
  self.db.execute('SET temp_directory='+qs((self.work/'temporarios').as_posix()))
  self.dictionary=[];self.files=[];self.tables=[];self.origins={}
  cache_path=self.work/'cache_tabelas.json'
  self.cache=json.loads(cache_path.read_text(encoding='utf-8')) if cache_path.exists() else {}
  export_cache=self.work/'cache_exports.json'
  self.export_cache=json.loads(export_cache.read_text(encoding='utf-8')) if export_cache.exists() else {}
  self.skeleton()

 def fonte(self,relative):
  paths=sorted(self.base.glob(relative))
  if not paths:raise FileNotFoundError(relative)
  for p in paths:
   key=p.relative_to(self.base).as_posix();info=dict(sha256=sha(p),bytes=p.stat().st_size)
   if key in self.origins:assert self.origins[key]==info,'Origem mudou durante a geração: '+key
   self.origins[key]=info
  return 'read_parquet('+qs((self.base/relative).as_posix())+',union_by_name=true,hive_partitioning=false)'

 def rows(self,q):
  c=self.db.execute(q);return [dict(zip([x[0] for x in c.description],r)) for r in c.fetchall()]

 def schema(self,q):
  # DESCRIBE pode devolver blocos fora de ordem com preserve_insertion_order=false.
  # A descrição do resultado mantém a ordem real da projeção, mesmo acima de 2048 colunas.
  cursor=self.db.execute('SELECT * FROM ('+q+') esquema LIMIT 0')
  return {d[0]:str(d[1]) for d in cursor.description}

 def skeleton(self):
  entes=self.fonte('silver/entes.parquet');clima=self.fonte('gold/clima/territorio.parquet')
  social=self.fonte(self.manifest['fontes']['assistencia']['arquivos']['territorios']['caminho'])
  self.db.execute(f'''CREATE OR REPLACE TABLE territorios AS
   WITH candidatos AS (
    SELECT cast(cod_ibge AS VARCHAR) cod_ibge,nome municipio,uf,regiao,0 prioridade FROM {entes} WHERE esfera='M' AND cod_ibge>=1000000
    UNION ALL SELECT cast(cod AS VARCHAR),nome,uf,regiao,1 FROM {clima}
    UNION ALL SELECT cast(cod_ibge AS VARCHAR),nome,uf,NULL,2 FROM {social} WHERE nivel='M')
   SELECT cod_ibge,municipio,uf,coalesce(regiao,CASE WHEN uf in ('DF','GO','MT','MS') THEN 'CO' WHEN uf in ('SP','RJ','ES','MG') THEN 'SE'
    WHEN uf in ('RS','SC','PR') THEN 'S' WHEN uf in ('AC','AM','AP','PA','RO','RR','TO') THEN 'N' ELSE 'NE' END) regiao,
    CASE WHEN cod_ibge='5300108' THEN 'Distrito Federal (Brasília)' WHEN cod_ibge='2605459' THEN 'Distrito estadual' ELSE 'Município' END tipo_territorio
   FROM candidatos WHERE regexp_full_match(cod_ibge,'[0-9]{{7}}') QUALIFY row_number() over(partition by cod_ibge order by prioridade)=1''')
  for k,desc in [('cod_ibge','Código IBGE de sete dígitos; chave territorial.'),('municipio','Nome do município ou unidade especial.'),('uf','Sigla da unidade da federação.'),('regiao','Grande região do Brasil.'),('tipo_territorio','Município, Distrito Federal/Brasília ou distrito estadual.'),('ano','Ano da observação ou edição da pesquisa.')]:
   self.dictionary.append(dict(variavel=k,**campo(desc,tipo='inteiro' if k=='ano' else 'texto',unidade='identificação',fonte='IBGE',regra='Chave da linha.'),area='identificacao',tabela='painel',ano_de=None,ano_ate=None))

 def tabela(self,name,area,query,columns,principal=True,preparada=False):
  print(json.dumps({'tabela':name,'etapa':'preparando'},ensure_ascii=False),flush=True)
  signature=hashlib.sha256((query+json.dumps(columns,sort_keys=True)+json.dumps(self.origins,sort_keys=True)).encode()).hexdigest()
  exists=self.db.execute('SELECT count(*) FROM information_schema.tables WHERE table_name=?',[name]).fetchone()[0]
  if not exists or self.cache.get(name)!=signature:
   if not preparada:self.db.execute(f'CREATE OR REPLACE TABLE {qi(name)} AS {query}')
   self.db.execute(f'DELETE FROM {qi(name)} WHERE cod_ibge IS NULL OR cod_ibge NOT IN (SELECT cod_ibge FROM territorios)')
  else:print(json.dumps({'tabela':name,'cache':'conferido'}),flush=True)
  dup=self.db.execute(f'SELECT count(*) FROM (SELECT cod_ibge,ano,count(*) n FROM {qi(name)} GROUP BY 1,2 HAVING n>1)').fetchone()[0]
  if dup:raise ValueError(f'{name}: {dup} chaves município–ano duplicadas')
  actual=self.schema(f'SELECT * FROM {qi(name)}')
  assert set(actual)=={'cod_ibge','ano',*columns},(name,set(actual)-{'cod_ibge','ano',*columns})
  years=self.db.execute(f'SELECT min(ano),max(ano),count(*) FROM {qi(name)}').fetchone()
  for key,meta in columns.items():
   self.dictionary.append({'variavel':key,**meta,'area':area,'tabela':'painel' if principal else name,'ano_de':meta.get('ano_de',years[0]),'ano_ate':meta.get('ano_ate',years[1])})
  if principal:self.tables.append((name,area,list(columns)))
  self.cache[name]=signature
  (self.work/'cache_tabelas.json').write_text(json.dumps(self.cache,indent=2),encoding='utf-8')
  return years

 def simples(self,name,area,relative,code,year,prefix,exclude=(),labels=None,source='',unit=None,where='true'):
  source_sql=self.fonte(relative);types=self.schema(f'SELECT * FROM {source_sql}')
  data={c:t for c,t in types.items() if c not in {code,year,*exclude}}
  select=[f'cast({qi(code)} as VARCHAR) cod_ibge',f'cast({qi(year)} as INTEGER) ano'];columns={}
  for c,t in data.items():
   new=prefix+c;select.append(f'{qi(c)} AS {qi(new)}')
   numeric=bool(re.search('INT|DOUBLE|FLOAT|DECIMAL',t));text=(labels or {}).get(c,c.replace('_',' ').capitalize())
   fallback='percentual (0–100)' if c.endswith('_pct') else 'R$ nominais por habitante' if c.endswith('_hab') else 'número' if numeric else 'texto'
   columns[new]=campo(text,unidade=(unit or {}).get(c,fallback),fonte=source,tipo='numero' if numeric else 'texto')
  self.tabela(name,area,'SELECT '+','.join(select)+f' FROM {source_sql} WHERE {where}',columns)

 def financas(self):
  labels={'fpm':'Cota-parte do FPM','icms':'Cota-parte do ICMS','ipva':'Cota-parte do IPVA','iptu':'Arrecadação de IPTU','iss':'Arrecadação de ISS','itbi':'Arrecadação de ITBI',
    'pib':'Produto interno bruto municipal','vab_agropecuaria':'Valor adicionado da agropecuária','vab_industria':'Valor adicionado da indústria','vab_servicos':'Valor adicionado dos serviços',
    'vab_adm_publica':'Valor adicionado da administração pública','pib_per_capita':'PIB por habitante','populacao':'População declarada na DCA','populacao_ibge':'População IBGE usada no indicador',
    'inss_beneficios':'Benefícios previdenciários emitidos em dezembro','inss_aposentadorias':'Aposentadorias emitidas em dezembro','inss_pensoes':'Pensões emitidas em dezembro'}
  src=self.fonte('gold/indicadores.parquet');types=self.schema(f'SELECT * FROM {src}')
  excluded={'exercicio','cod_ibge','nome','uf','regiao','esfera','capital','faixa_grupo'}
  cols={};select=['cast(cod_ibge as VARCHAR) cod_ibge','exercicio::INTEGER ano']
  for c,t in types.items():
   if c in excluded:continue
   numeric=bool(re.search('INT|DOUBLE|FLOAT|DECIMAL',t));money=numeric and not c.startswith(('populacao','inss_')) and not c.endswith('_ano') and c!='bolsa_familia_familias'
   u='R$ nominais' if money else 'número' if numeric else 'texto';k='fin_'+c
   cols[k]=campo(labels.get(c,c.replace('_',' ').capitalize()),unidade=u,fonte='IBGE' if c.startswith(('pib','vab_','populacao_ibge')) else 'INSS' if c.startswith('inss') else 'CGU' if c.startswith('bolsa_familia') else 'SICONFI/DCA',tipo='numero' if numeric else 'texto')
   select.append(f'{qi(c)} {qi(k)}')
  self.tabela('financas','financas','SELECT '+','.join(select)+f" FROM {src} WHERE esfera='M'",cols)
  self.simples('pib_historico','financas','silver/ibge_pib.parquet','cod_ibge','exercicio','ibge_',source='IBGE — PIB municipal',unit={c:'R$ nominais' for c in ['pib','impostos_produtos','vab_total','vab_adm_publica','vab_agropecuaria','vab_industria','vab_servicos']})
  self.simples('inss_historico','assistencia','silver/inss_municipios.parquet','cod_ibge','exercicio','inss_',source='Previdência Social — benefícios emitidos em dezembro')
  self.simples('lrf','financas','gold/lrf.parquet','cod_ibge','exercicio','lrf_',exclude=['nome','uf','regiao','esfera'],source='SICONFI/RREO e RGF',where="esfera='M'",unit={c:'R$ nominais' for c in ['rcl','rcl_ajustada','despesa_pessoal','divida_consolidada','dcl','resultado_primario','meta_primario','resultado_nominal','saude_valor','mde_valor']})
  se_labels={'aluno_basica':'Investimento educacional por aluno da educação básica','aluno_infantil':'Investimento educacional por aluno da educação infantil','aluno_fundamental':'Investimento educacional por aluno do ensino fundamental','professores_aluno':'Despesa com professores por aluno da educação básica','sus_hab':'Transferências recebidas do SUS por habitante'}
  self.simples('saude_educacao','financas','gold/saude_educacao.parquet','cod_ibge','ano','se_',exclude=['uf','esfera'],source='FNDE/SIOPE e Ministério da Saúde/SIOPS',where="esfera='M'",labels=se_labels,unit={**{c:'R$ nominais' for c in ['educacao_liquidada','despesa_liquidada','saude_total','saude_proprios','sus_receita']},**{c:'R$ nominais por aluno' for c in ['aluno_basica','aluno_infantil','aluno_fundamental','professores_aluno']}})
  self.simples('siope_gerais','financas','gold/siope/gerais.parquet','cod_ibge','ano','siope_',exclude=['uf','esfera'],source='FNDE/SIOPE',where="esfera='M'",unit={c:'R$ nominais' for c in ['receita_prevista','receita_realizada','despesa_dotacao','despesa_empenhada','despesa_liquidada','despesa_paga','educacao_dotacao','educacao_empenhada','educacao_liquidada','educacao_paga']})
  for name,relative,source,unitcol in [('siope_ind','gold/siope/indicadores.parquet','FNDE/SIOPE',None),('siops_ind','gold/siops/indicadores.parquet','Ministério da Saúde/SIOPS','unidade')]:
   source_sql=self.fonte(relative);sc=self.schema('SELECT * FROM '+source_sql);extra=',unidade' if unitcol else ''
   rows=self.rows(f'SELECT DISTINCT codigo,indicador{extra} FROM {source_sql} ORDER BY 1,2')
   cols={};select=['cast(cod_ibge as VARCHAR) cod_ibge','ano::INTEGER ano']
   for r in rows:
    sig=hashlib.sha256((str(r['codigo'])+'|'+r['indicador']).encode()).hexdigest()[:10];k=name+'_'+slug(r['codigo'])+'_'+sig
    pred=f'codigo={qs(r["codigo"])} AND indicador={qs(r["indicador"])}';select.append(f'first(valor) FILTER(WHERE {pred}) {qi(k)}')
    u=r.get('unidade') or ('percentual (0–100)' if '%' in r['indicador'] or 'percentual' in r['indicador'].lower() else 'conforme indicador')
    cols[k]=campo(r['indicador'],unidade=u,fonte=source,obs='Código original: '+str(r['codigo'])+'. A chave também distingue enunciados diferentes.')
   where=" WHERE esfera='M'" if 'esfera' in sc else ''
   self.tabela(name,'financas','SELECT '+','.join(select)+f' FROM {source_sql}{where} GROUP BY 1,2',cols)
  src=self.fonte('gold/despesa_funcao.parquet')
  registros=self.rows(f'SELECT DISTINCT funcao_cod,funcao FROM {src} ORDER BY 1,2')
  campos={};select=['cast(cod_ibge AS VARCHAR) cod_ibge','exercicio::INTEGER ano']
  for row in registros:
   for metric in ['empenhada','liquidada','paga']:
    k=f'funcao_{slug(row["funcao_cod"])}_{metric}'
    if k in campos:continue
    campos[k]=campo(f'Despesa {metric}: {row["funcao"]}',unidade='R$ nominais',fonte='SICONFI/DCA Anexo I-E')
    select.append(f'sum({metric}) FILTER(WHERE funcao_cod={qs(row["funcao_cod"])}) {qi(k)}')
  self.tabela('funcoes','financas','SELECT '+','.join(select)+f' FROM {src} GROUP BY 1,2',campos)
  alerts=self.fonte('gold/alertas.parquet');cols={};select=['cast(cod_ibge as VARCHAR) cod_ibge','exercicio::INTEGER ano']
  for domain in ['receita','despesa']:
   for c in ['categoria','motivo','exclui']:
    k=f'fin_alerta_{domain}_{c}';select.append(f'first({qi(c)}) FILTER(WHERE dominio={qs(domain)}) {qi(k)}')
    cols[k]=campo(f'Alerta de {domain}: {c}',fonte='LAPAM/UFG — qualidade DCA',tipo='logico' if c=='exclui' else 'texto',unidade='condição')
  self.tabela('alertas','financas','SELECT '+','.join(select)+f' FROM {alerts} GROUP BY 1,2',cols)

 def saude(self):
  src=self.fonte('gold/saude/municipios.parquet');select=['cast(cod_ibge as VARCHAR) cod_ibge','ano::INTEGER ano'];columns={}
  for c in self.catalog['saude_campos']:
   name=c['campo'];k='sau_'+name;years=c['anos'];condition='ano IN ('+','.join(map(str,years))+')' if years else 'false'
   select.append(f'CASE WHEN {condition} THEN {qi(name)} END {qi(k)}')
   monetary='valor' in name;u=f'R$ de {self.manifest["base_ipca"]} (IPCA)' if name.endswith('_real') else 'R$ nominais' if monetary else 'percentual (0–100)' if 'cobertura' in name else 'número'
   desc=c['nome'] if c['nome']!=name else name.replace('_',' ').capitalize()
   columns[k]=campo(desc,unidade=u,fonte=c['fonte'].upper(),obs='Fonte e cobertura específicas da medida; CNES é retrato de dezembro. APS mantém metodologias AB/APS/ACS separadas.')
   columns[k].update(ano_de=min(years) if years else None,ano_ate=max(years) if years else None)
  for i in self.catalog['saude_indicadores']:
   years=i['anos'];cond='ano IN ('+','.join(map(str,years))+')' if years else 'false';k='sau_ind_'+i['id']
   select.append(f'CASE WHEN {cond} THEN {qi(i["numerador"])} / nullif({qi(i["denominador"])},0)*{i["fator"]} END {qi(k)}')
   columns[k]=campo(i['nome'],i['descricao'],unidade='fração (0–1)' if i['tipo']=='proporcao' else i['unidade'],fonte=i['fonte'])
   columns[k].update(ano_de=min(years) if years else None,ano_ate=max(years) if years else None)
  self.tabela('saude','saude','SELECT '+','.join(select)+f' FROM {src} WHERE cod_ibge IS NOT NULL',columns)
  self.simples('fns','saude','gold/saude/fns_municipios.parquet','cod_ibge','ano','fns_',exclude=['municipio','nome','uf','destino'],source='Fundo Nacional de Saúde',unit={'bruto':'R$ nominais','liquido':'R$ nominais','liquido_real':f'R$ de {self.manifest["base_ipca"]} (IPCA)'})
  src=self.fonte('gold/saude/vacinacao.parquet');types=self.rows(f'SELECT DISTINCT imunobiologico,metodo FROM {src} ORDER BY 1,2');cols={};select=['cast(cod_ibge AS VARCHAR) cod_ibge','ano::INTEGER ano']
  for r in types:
   for c in ['numerador','denominador','cobertura','status']:
    k=f'vac_{slug(r["metodo"])}_{slug(r["imunobiologico"])}_{c}'
    select.append(f'first({qi(c)}) FILTER(WHERE imunobiologico={qs(r["imunobiologico"])} AND metodo={qs(r["metodo"])}) {qi(k)}')
    cols[k]=campo(f'Vacinação {r["imunobiologico"]}: {c}',unidade='percentual (0–100)' if c=='cobertura' else 'condição' if c=='status' else 'número',fonte='Ministério da Saúde — vacinação',tipo='texto' if c=='status' else 'numero',obs=f'Metodologia {r["metodo"]}; não unir metodologias diferentes.')
  self.tabela('vacinas','saude','SELECT '+','.join(select)+f' FROM {src} WHERE cod_ibge IS NOT NULL GROUP BY 1,2',cols)
  src=self.fonte('gold/saude/ambulatorial_subgrupo.parquet');groups=self.rows(f'SELECT DISTINCT subgrupo FROM {src} ORDER BY 1');cols={};select=['cast(m.cod_ibge as VARCHAR) cod_ibge','a.ano::INTEGER ano']
  for row in groups:
   for metric in ['registros','qtd','valor','valor_real']:
    k='sia_sub_'+slug(row['subgrupo'])+'_'+metric;select.append(f'first(a.{metric}) FILTER(WHERE subgrupo={qs(row["subgrupo"])}) {qi(k)}')
    cols[k]=campo(f'Grupo SIGTAP {row["subgrupo"]}: {metric}',unidade='R$ nominais' if metric=='valor' else f'R$ de {self.manifest["base_ipca"]}' if metric=='valor_real' else 'número',fonte='SIA/SUS',obs='Procedimentos aprovados no município do estabelecimento; valores de tabela SUS, não despesa municipal.')
  self.tabela('sia_subgrupos','saude','SELECT '+','.join(select)+f' FROM {src} a JOIN (SELECT DISTINCT cod_ibge,municipio FROM '+self.fonte('gold/saude/municipios.parquet')+') m ON m.municipio=a.municipio GROUP BY 1,2',cols)

 def trabalho(self):
  src=self.fonte('gold/trabalho/municipios.parquet');types=self.schema(f'SELECT * FROM {src}');cols={};select=['cast(m.cod_ibge as VARCHAR) cod_ibge','m.ano::INTEGER ano']
  for c,t in types.items():
   if c in ['cod_ibge','ano','nome','uf','regiao']:continue
   k='rais_'+c;select.append(f'm.{qi(c)} {qi(k)}');cols[k]=campo(c.replace('_',' ').capitalize(),fonte='MTE/RAIS',unidade='R$ nominais de dezembro' if c.startswith('massa_') else 'número',regra='Vínculos ativos em 31/12, não pessoas; massa de dezembro, não anual.')
  for c,sql,label,u in [
   ('remuneracao_media','m.massa_dez/nullif(m.n_rem_dez,0)','Remuneração média de dezembro','R$ nominais'),
   ('remuneracao_media_real','m.massa_dez/nullif(m.n_rem_dez,0)*ip.fator_real','Remuneração média de dezembro (IPCA)',f'R$ de {self.manifest["base_ipca"]}'),
   ('empregos_por_mil','1000.0*m.empregos/nullif(m.populacao,0)','Vínculos por mil habitantes','por mil habitantes'),
   ('vinculos_por_estabelecimento','m.empregos/nullif(m.estabelecimentos,0)','Vínculos por estabelecimento','vínculos/estabelecimento')]:
   cols['rais_'+c]=campo(label,unidade=u,fonte='MTE/RAIS',obs='Médias salariais usam apenas vínculos ativos com remuneração positiva informada; cobertura salarial separada do estoque.');select.append(f'{sql} {qi("rais_"+c)}')
  ipca=self.fonte('gold/ipca.parquet');self.tabela('rais','trabalho','SELECT '+','.join(select)+f' FROM {src} m LEFT JOIN {ipca} ip ON ip.exercicio=m.ano',cols)
  src=self.fonte(self.manifest['fontes']['rais_perfis']['arquivos'].replace('{ano}','*'));self.db.execute(f'CREATE OR REPLACE VIEW perfis AS SELECT * FROM {src} WHERE regexp_full_match(escopo,\'[0-9]{{7}}\')')
  totals='(SELECT ano,escopo,vinculos FROM perfis WHERE variavel=\'total\')';cols={};select=['t.escopo cod_ibge','t.ano::INTEGER ano']
  pairs=self.rows("SELECT DISTINCT variavel,codigo FROM perfis WHERE variavel!='total' ORDER BY 1,2")
  for p in pairs:
   var=p['variavel'];code=p['codigo'];entry=next((e['pt'] for e in self.catalog['rais_perfis'].get(var,[]) if e['codigo']==code), 'Não informado' if code=='_ausente' else 'Código '+code)
   pred=f'p.variavel={qs(var)} AND p.codigo={qs(code)}';base=f'rais_{slug(var)}_{slug(code)}'
   count_sql=contagem_perfil_sql(var,code)
   for metric,sql,u in [('vinculos',count_sql,'vínculos'),
      ('proporcao',f'({count_sql})/nullif(t.vinculos,0)','fração (0–1)'),
      ('remuneracao_media',f'first(p.remuneracao_media_dez) FILTER(WHERE {pred})','R$ nominais de dezembro')]:
    k=base+'_'+metric;cols[k]=campo(f'{var.replace("_"," ").capitalize()}: {entry} — {metric.replace("_"," ")}',unidade=u,fonte='MTE/RAIS — perfis',obs='Grupo ausente em território coberto tem zero vínculos; salário sem valor positivo permanece ausente. Não representa pessoas únicas.');select.append(f'{sql} {qi(k)}')
  self.tabela('perfis_rais','trabalho','SELECT '+','.join(select)+f' FROM {totals} t LEFT JOIN perfis p ON p.escopo=t.escopo AND p.ano=t.ano GROUP BY t.escopo,t.ano,t.vinculos',cols)
  src=self.fonte(self.manifest['fontes']['rais'].get('setores','gold/trabalho/setores.parquet'));rows=self.rows(f'SELECT DISTINCT divisao FROM {src} ORDER BY 1');cols={};select=['cast(cod_ibge as VARCHAR) cod_ibge','ano::INTEGER ano']
  for r in rows:
   for c in ['empregos','remuneracao_media_dez']:
    k='cnae_'+slug(r['divisao'])+'_'+c;select.append(f'first({qi(c)}) FILTER(WHERE divisao={qs(r["divisao"])}) {qi(k)}');cols[k]=campo(f'Divisão CNAE {r["divisao"]}: {c.replace("_"," ")}',unidade='vínculos' if c=='empregos' else 'R$ nominais de dezembro',fonte='MTE/RAIS — atividade do estabelecimento')
  self.tabela('setores','trabalho','SELECT '+','.join(select)+f' FROM {src} GROUP BY 1,2',cols)
  caged=self.fonte('gold/trabalho/caged.parquet');ct=self.schema(f'SELECT * FROM {caged}');code='cod_ibge';year='ano' if 'ano' in ct else 'competencia//100'
  metrics=[x for x in ['admissoes','desligamentos','saldo'] if x in ct];select=[f'cast({code} as VARCHAR) cod_ibge',f'{year}::INTEGER ano'];cols={}
  for c in metrics:
   k='caged_'+c;select.append(f'sum({qi(c)}) {qi(k)}');cols[k]=campo('CAGED: '+c,fonte='MTE/Novo CAGED',regra='Soma dos meses presentes no ano; conferir meses observados.')
  month='mes' if 'mes' in ct else 'competencia';select.append(f'count(distinct {month})::INTEGER caged_meses');cols['caged_meses']=campo('Meses observados do CAGED',unidade='meses',fonte='MTE/Novo CAGED')
  if 'salario_medio_admissao' in ct:
   select.extend(['arg_max(struct_pack(v:=salario_medio_admissao),competencia).v caged_ultimo_salario_medio_admissao','max(competencia)%100 caged_ultimo_mes'])
   cols['caged_ultimo_salario_medio_admissao']=campo('Salário médio de admissão no último mês do ano disponível',unidade='R$ nominais',fonte='MTE/Novo CAGED',regra='Último mês disponível do ano; não é média anual.')
   cols['caged_ultimo_mes']=campo('Último mês disponível do CAGED no ano',unidade='mês',fonte='MTE/Novo CAGED')
  self.tabela('caged','trabalho','SELECT '+','.join(select)+f' FROM {caged} GROUP BY 1,2',cols)
  src=self.fonte('gold/siope/remuneracao.parquet');groups=self.rows(f"SELECT DISTINCT categoria,situacao FROM {src} WHERE esfera='M' ORDER BY 1,2");cols={};select=['cod_ibge','ano'];mapping=[]
  metrics=['profissionais','vinculos','carga_horaria_media','salario_medio','salario_p25','salario_mediana','salario_p75','outros_medio']
  for r in groups:
   prefix='siope_rem_'+hashlib.sha256((r['categoria']+'|'+r['situacao']).encode()).hexdigest()[:10];mapping.append({**r,'id':prefix})
   for metric in metrics:
    k=prefix+'_'+metric;select.append(f'{qi(prefix)}.{qi(metric)} {qi(k)}')
    cols[k]=campo(f'Profissionais da educação {r["categoria"]}, {r["situacao"]}: {metric.replace("_"," ")}',unidade='R$ nominais' if metric.startswith(('salario','outros')) else 'horas' if metric=='carga_horaria_media' else 'número',fonte='FNDE/SIOPE — remuneração',regra='Última competência publicada no ano para a categoria/situação; não é soma anual nem média entre meses.')
   k=prefix+'_mes';select.append(f'{qi(prefix)}.mes {qi(k)}');cols[k]=campo(f'Mês dos profissionais da educação: {r["categoria"]}, {r["situacao"]}',unidade='mês',fonte='FNDE/SIOPE')
  duplicates=self.db.execute(f"SELECT count(*) FROM (SELECT cod_ibge,ano,mes,categoria,situacao,count(*) n FROM {src} WHERE esfera='M' GROUP BY 1,2,3,4,5 HAVING n>1)").fetchall()[0][0]
  assert not duplicates,('SIOPE remuneração com categoria duplicada',duplicates)
  self.db.register('mapa_rem_siope',pa.Table.from_pylist(mapping))
  data='struct_pack('+','.join(f'{qi(c)}:=s.{qi(c)}' for c in [*metrics,'mes'])+')'
  raw=f"SELECT cast(s.cod_ibge AS VARCHAR) cod_ibge,s.ano::INTEGER ano,m.id,arg_max({data},s.mes) dado FROM {src} s JOIN mapa_rem_siope m USING(categoria,situacao) WHERE s.esfera='M' GROUP BY 1,2,3"
  pivot='PIVOT ('+raw+') ON id IN ('+','.join(qs(r['id']) for r in mapping)+') USING first(dado) GROUP BY cod_ibge,ano'
  self.tabela('educacao_profissionais','trabalho','SELECT '+','.join(select)+' FROM ('+pivot+')',cols)

 def clima(self):
  src=self.fonte('gold/clima/anual.parquet');cat=self.rows('SELECT * FROM '+self.fonte('gold/clima/catalogo.parquet'));cols={};select=['cast(cod as VARCHAR) cod_ibge','ano::INTEGER ano']
  for r in cat:
   for c in ['valor','normal','anomalia','anomalia_pct']:
    k='cli_'+r['variavel']+'_'+c;select.append(f'first({c}) FILTER(WHERE variavel={qs(r["variavel"])}) {qi(k)}');cols[k]=campo(f'{r["rotulo"]}: {c.replace("_"," ")}',unidade='percentual (0–100)' if c=='anomalia_pct' else r['unidade'],fonte=r['fonte'],regra=f'Ano completo; {r["resumo_anual"]} dos meses. Normal 1991–2020.',obs='Estimativa de grade, não medição de estação. Malha municipal fixa.')
  self.tabela('clima','clima','SELECT '+','.join(select)+f' FROM {src} GROUP BY 1,2',cols)

 def assistencia(self):
  meta=self.manifest['fontes']['assistencia'];cat=self.rows('SELECT * FROM '+self.fonte(meta['arquivos']['catalogo']['caminho']))
  sources=[self.fonte(meta['arquivos'][f]['caminho']) for f in ['cadunico','pbf','bpc']]
  social_mensal_para_anual(self.db,sources)
  ids=','.join(qs(i['id']) for i in cat)
  pivot='PIVOT social_anual ON indicador IN ('+ids+') USING first(ultimo) AS dado,first(ultima_competencia) AS comp,first(soma) AS soma,first(meses) AS meses GROUP BY cod_ibge,ano'
  cols={};select=['cod_ibge','ano']
  for i in cat:
   base='soc_'+i['id'];condition=f'indicador={qs(i["id"])}';u=(f'R$ de {self.manifest["base_ipca"]} (IPCA)' if i['id'].endswith('_real') else 'R$ nominais') if i['unidade']=='moeda' else 'fração (0–1)' if i['unidade']=='razao' else 'número'
   rule='Último registro do ano, inclusive se ausente/protegido. O mês de referência acompanha o valor.'
   for suffix,sql,label,unit,kind in [('', qi(i['id']+'_dado')+'.valor',i['nome'],u,'numero'),('_mes',qi(i['id']+'_comp')+'%100','Mês: '+i['nome'],'mês','inteiro'),('_condicao',qi(i['id']+'_dado')+'.condicao','Condição: '+i['nome'],'condição','texto')]:
    k=base+suffix;select.append(f'{sql} {qi(k)}');cols[k]=campo(label,i['descricao'] if not suffix else label,unidade=unit,fonte=i['fonte'],regra=rule,tipo=kind)
   if i['acumulavel']:
    for suffix,sql,label,unit in [('_soma_ano','soma','Soma no ano: '+i['nome'],u),('_meses','meses','Meses com valor: '+i['nome'],'meses')]:
     k=base+suffix;select.append(f'{qi(i["id"]+"_"+sql)} {qi(k)}');cols[k]=campo(label,unidade=unit,fonte=i['fonte'],regra='Soma dos meses com valor no ano; menos de 12 meses é parcial. Não estima meses ausentes.',obs=i['descricao'])
  self.tabela('social','assistencia','SELECT '+','.join(select)+' FROM ('+pivot+')',cols)

 def gestao(self):
  src=self.fonte('gold/munic/painel_respostas.parquet');cols={};select=['cast(cod as VARCHAR) cod_ibge','ano::INTEGER ano']
  for i in self.catalog['munic']:
   cond=' OR '.join(f'(ano={f["ano"]} AND var={qs(f["var"])})' for f in i['fontes']);k='mun_'+i['id'];typ=i['tipo'];value='valor_num' if typ=='numerico' else 'valor_txt'
   select.append(f'first(CASE WHEN valida THEN {value} END) FILTER(WHERE {cond}) {qi(k)}')
   cols[k]=campo(i['titulo']['pt'],fonte='IBGE/MUNIC',tipo='numero' if typ=='numerico' else 'texto',unidade='número' if typ=='numerico' else 'resposta',regra='Somente a edição pesquisada. Pares edição/variável conferidos na curadoria; sem interpolação.')
  self.tabela('gestao','gestao','SELECT '+','.join(select)+f" FROM {src} WHERE pesquisa='munic' GROUP BY 1,2",cols)

 def objeto(self,path,id,tipo,area,nome,fmt,lines=None,variables=None,start=None,end=None,uf=None,desc=None):
  digest=sha(path);new=self.dest/f'{id}_{digest[:12]}.{fmt}'
  if path!=new:
   if new.exists():assert sha(new)==digest;path.unlink()
   else:path.replace(new)
  obj=dict(id=id,tipo=tipo,area=area,nome=nome,nome_en=nome,descricao=desc or nome,descricao_en=desc or nome,formato=fmt,caminho=new.relative_to(self.root).as_posix(),bytes=new.stat().st_size,sha256=digest,linhas=lines,variaveis=variables,ano_de=start,ano_ate=end,uf=uf)
  self.files.append(obj);return obj

 def csv(self,query,path):
  # COPY nativo é colunar e não materializa milhões de células no Python.
  types=self.schema(query);select=[]
  for c,t in types.items():
   if t=='VARCHAR':select.append(f'CASE WHEN regexp_matches({qi(c)},\'^[=+@-]\') THEN chr(39)||{qi(c)} ELSE {qi(c)} END {qi(c)}')
   elif re.search('DOUBLE|FLOAT|DECIMAL',t):select.append(f"replace(cast({qi(c)} AS VARCHAR),'.',',') {qi(c)}")
   else:select.append(qi(c))
  raw=path.with_name(path.name+'.utf8')
  self.db.execute('COPY (SELECT '+','.join(select)+' FROM ('+query+')) TO '+qs(raw.as_posix())+" (FORMAT CSV, HEADER true, DELIMITER ';')")
  with path.open('wb') as target,raw.open('rb') as source:
   target.write(b'\xef\xbb\xbf');shutil.copyfileobj(source,target,8*1024*1024)
  raw.unlink()

 def export(self,table,id,kind,area,name,uf=None,formats=('parquet','csv.zip')):
  query='SELECT t.cod_ibge,c.municipio,c.uf,c.regiao,c.tipo_territorio,t.ano,t.* EXCLUDE(cod_ibge,ano) FROM '+qi(table)+' t JOIN territorios c USING(cod_ibge)'
  if uf:query+=' WHERE c.uf='+qs(uf)
  if uf or kind=='area':query+=' ORDER BY t.cod_ibge,t.ano'
  rows,start,end=self.db.execute('SELECT count(*),min(ano),max(ano) FROM ('+query+')').fetchone();columns=len(self.schema(query))-len(KEYS)
  if not rows:return
  signature=hashlib.sha256((query+json.dumps(self.cache,sort_keys=True)+json.dumps(self.origins,sort_keys=True)).encode()).hexdigest()
  parquet_source=None
  for fmt in formats:
   cache_key=id+'|'+fmt;cached=self.export_cache.get(cache_key)
   if cached and cached['signature']==signature and (fmt!='csv.zip' or cached.get('csv_versao')==VERSAO_CSV):
    obj=cached['objeto'];existing=self.root/obj['caminho']
    if existing.is_file() and sha(existing)==obj['sha256']:
     obj={**obj,'tipo':kind,'area':area,'nome':name,'nome_en':name,'descricao':name,'descricao_en':name,'linhas':rows,'variaveis':columns,'ano_de':start,'ano_ate':end,'uf':uf}
     self.files.append(obj)
     if fmt=='parquet':parquet_source=existing
     print(json.dumps({'arquivo':obj['id'],'cache':'conferido'}),flush=True)
     continue
   path=self.dest/(id+'.'+fmt)
   if fmt=='parquet':self.db.execute('COPY ('+query+') TO '+qs(path.as_posix())+" (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 32768)")
   else:
    plain=self.work/(id+'.csv');csv_query='SELECT * FROM read_parquet('+qs(parquet_source.as_posix())+')' if parquet_source else query
    self.csv(csv_query,plain)
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as z:z.write(plain,arcname=id+'.csv')
    plain.unlink()
   obj=self.objeto(path,id+'_'+slug(fmt),kind,area,name,fmt,rows,columns,start,end,uf)
   if fmt=='parquet':parquet_source=self.root/obj['caminho']
   self.export_cache[cache_key]=dict(signature=signature,objeto=obj,csv_versao=VERSAO_CSV if fmt=='csv.zip' else None)
   (self.work/'cache_exports.json').write_text(json.dumps(self.export_cache,ensure_ascii=False,indent=2),encoding='utf-8')
   print(json.dumps({'arquivo':obj['id'],'bytes':obj['bytes']},ensure_ascii=False),flush=True)

 def integrar(self):
  union=' UNION '.join('SELECT cod_ibge,ano FROM '+qi(n) for n,a,cols in self.tables)
  columns=[];joins=[];used=set(KEYS)
  for n,a,cols in self.tables:
   assert not used.intersection(cols),(n,used.intersection(cols));used.update(cols)
   columns.extend(f'{qi(n)}.{qi(c)}' for c in cols);joins.append(f'LEFT JOIN {qi(n)} USING(cod_ibge,ano)')
  self.db.execute('CREATE OR REPLACE TABLE painel AS SELECT ch.cod_ibge,ch.ano,'+','.join(columns)+' FROM ('+union+') ch '+' '.join(joins))
  self.export('painel','painel_brasil','painel',None,'Base integrada — Brasil')
  for area,pt,en in AREAS:
   ns=[(n,cs) for n,a,cs in self.tables if a==area];union=' UNION '.join('SELECT cod_ibge,ano FROM '+qi(n) for n,cs in ns)
   columns=[f'{qi(n)}.{qi(c)}' for n,cs in ns for c in cs];joins=[f'LEFT JOIN {qi(n)} USING(cod_ibge,ano)' for n,cs in ns]
   target='area_'+area;self.db.execute('CREATE OR REPLACE TABLE '+qi(target)+' AS SELECT ch.cod_ibge,ch.ano,'+','.join(columns)+' FROM ('+union+') ch '+' '.join(joins))
   self.export(target,'painel_'+area,'area',area,'Painel anual — '+pt)
  for uf, in self.db.execute('SELECT DISTINCT uf FROM territorios ORDER BY 1').fetchall():self.export('painel','painel_'+uf.lower(),'painel',None,'Base integrada — '+uf,uf=uf)

 def detalhes_munic(self):
  cat=self.rows('SELECT * FROM '+self.fonte('gold/munic/catalogo.parquet')+" WHERE pesquisa='munic' ORDER BY ano,var")
  src=self.fonte('gold/munic/respostas.parquet')
  for year in sorted({r['ano'] for r in cat}):
   entries=[r for r in cat if r['ano']==year];cols={};select=['cast(cod as VARCHAR) cod_ibge','ano::INTEGER ano']
   for r in entries:
    k='munic_'+str(year)+'_'+slug(r['var']);numeric=r['tipo']=='numerica';v='CASE WHEN valida THEN valor_num END' if numeric else 'valor_txt'
    value=f'CASE WHEN {qi(r["var"])}.valida THEN {qi(r["var"])}.numero END' if numeric else qi(r['var'])+'.texto'
    select.append(value+' '+qi(k))
    cols[k]=campo(r['rotulo'],unidade='número' if numeric else 'resposta',fonte='IBGE/MUNIC',tipo='numero' if numeric else 'texto',regra=f'Edição {year} apenas; não harmonizada com outra edição.',obs=f'Aba: {r["aba"]}. Tema: {r["tema"]}. Código original: {r["var"]}. Textos preservam respostas não aplicáveis; numéricos não válidos ficam vazios.')
   assert len(cols)==len(entries),'Colisão de nomes no questionário MUNIC'
   raw=f"SELECT cod,ano,var,struct_pack(numero:=valor_num,texto:=valor_txt,valida:=valida) valor FROM {src} WHERE pesquisa='munic' AND ano={year}"
   pivot='PIVOT ('+raw+') ON var IN ('+','.join(qs(r['var']) for r in entries)+') USING first(valor) GROUP BY cod,ano'
   name='munic_'+str(year);self.tabela(name,'gestao','SELECT '+','.join(select)+' FROM ('+pivot+')',cols,False)
   self.export(name,name,'detalhado','gestao',f'MUNIC — questionário completo {year}')

 def detalhes_dca(self):
  self.db.execute("SET threads=2; SET memory_limit='8GB'")
  src=self.fonte('gold/entes/uf=*.parquet');cat=self.fonte('silver/contas/*.parquet')
  self.db.execute('CREATE OR REPLACE VIEW contas_descr AS SELECT anexo,chave,arg_max(descricao,exercicio) descricao FROM '+cat+' GROUP BY 1,2')
  for annex, in self.db.execute(f'SELECT DISTINCT anexo FROM {src} ORDER BY 1').fetchall():
   entries=self.rows(f'SELECT DISTINCT d.chave,d.coluna,c.descricao FROM {src} d LEFT JOIN contas_descr c USING(anexo,chave) WHERE anexo={qs(annex)} ORDER BY 1,2')
   cols={};mapping=[];select=['cod_ibge','ano']
   for r in entries:
    sig=hashlib.sha256((annex+'|'+r['chave']+'|'+r['coluna']).encode()).hexdigest()[:14];k='dca_'+slug(annex)+'_'+sig
    mapping.append(dict(chave=r['chave'],coluna=r['coluna'],id=k))
    cols[k]=campo((r['descricao'] or r['chave'])+' — '+r['coluna'],unidade='R$ nominais',fonte='SICONFI/DCA Anexo '+annex,regra='Valor do exercício no tratamento publicado; sinais originais preservados. Conferir o indicador _sintetico.',obs=f'Chave original: {r["chave"]}. Coluna: {r["coluna"]}. Contas hierárquicas podem se sobrepor; não somar totais e componentes.')
    cols[k+'_sintetico']=campo('Total reconstruído: '+(r['descricao'] or r['chave'])+' — '+r['coluna'],unidade='verdadeiro/falso',fonte='SICONFI/DCA — tratamento LAPAM/UFG',tipo='logico',regra='Verdadeiro: total reconstruído na hierarquia; falso: valor diretamente disponível na origem.')
    select.extend([f'{qi(k+"_valor")} {qi(k)}',f'{qi(k+"_derivado")} {qi(k+"_sintetico")}'])
   self.db.register('mapa_dca',pa.Table.from_pylist(mapping))
   raw=f'SELECT cast(d.cod_ibge AS VARCHAR) cod_ibge,d.exercicio::INTEGER ano,m.id,d.valor,d.sintetico FROM {src} d JOIN mapa_dca m USING(chave,coluna) JOIN territorios t ON t.cod_ibge=cast(d.cod_ibge AS VARCHAR) WHERE d.anexo={qs(annex)}'
   duplicates=self.db.execute('SELECT count(*) FROM (SELECT cod_ibge,ano,id,count(*) n FROM ('+raw+') GROUP BY 1,2,3 HAVING n>1)').fetchone()[0]
   assert not duplicates,(annex,'Conta duplicada antes de pivotar',duplicates)
   pivot='PIVOT ('+raw+') ON id IN ('+','.join(qs(r['id']) for r in mapping)+') USING first(valor) AS valor,first(sintetico) AS derivado GROUP BY cod_ibge,ano'
   name='dca_'+slug(annex);query='SELECT '+','.join(select)+' FROM ('+pivot+')'
   signature=hashlib.sha256((query+json.dumps(cols,sort_keys=True)+json.dumps(self.origins,sort_keys=True)).encode()).hexdigest()
   exists=self.db.execute('SELECT count(*) FROM information_schema.tables WHERE table_name=?',[name]).fetchall()[0][0]
   if not exists or self.cache.get(name)!=signature:
    # Cada UF cabe na memória; CHECKPOINT libera os blocos sujos entre as inserções.
    self.db.execute('CREATE OR REPLACE TABLE '+qi(name)+' AS SELECT * FROM ('+query+') LIMIT 0')
    for uf, in self.db.execute('SELECT DISTINCT uf FROM territorios ORDER BY 1').fetchall():
     uf_source='read_parquet('+qs((self.base/f'gold/entes/uf={uf}.parquet').as_posix())+',union_by_name=true,hive_partitioning=false)'
     self.db.execute('INSERT INTO '+qi(name)+' '+query.replace(src,uf_source))
     self.db.execute('CHECKPOINT')
     print(json.dumps({'tabela':name,'uf':uf,'etapa':'gravada'}),flush=True)
   self.tabela(name,'financas',query,cols,False,preparada=True)
   self.export(name,name,'detalhado','financas','DCA — todas as contas do Anexo '+annex)

 def finalizar(self):
  for entry in self.dictionary:
   entry.setdefault('ano_de',None);entry.setdefault('ano_ate',None)
  assert len({(d['tabela'],d['variavel']) for d in self.dictionary})==len(self.dictionary)
  dicpath=self.dest/'dicionario.json';dicpath.write_text(json.dumps(self.dictionary,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
  descriptor=self.objeto(dicpath,'dicionario_json','dicionario',None,'Dicionário de variáveis','json',len(self.dictionary))
  csvpath=self.work/'dicionario.csv'
  with csvpath.open('w',encoding='utf-8-sig',newline='') as f:
   fields=['variavel','nome','descricao','area','fonte','unidade','tipo','regra_anual','ano_de','ano_ate','tabela','observacao'];w=csv.DictWriter(f,fieldnames=fields,delimiter=';');w.writeheader();w.writerows(self.dictionary)
  path=self.dest/'dicionario.csv.zip'
  with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:z.write(csvpath,'dicionario.csv')
  self.objeto(path,'dicionario_csv','dicionario',None,'Dicionário de variáveis','csv.zip',len(self.dictionary))
  metod=self.dest/'metodologia.txt';metod.write_text('BASE MUNICIPAL ANUAL — LAPAM/UFG\n\n'+'\n\n'.join(NOTAS),encoding='utf-8')
  self.objeto(metod,'metodologia','metodologia',None,'Como usar os arquivos','txt')
  main=next(a for a in self.files if a['id']=='painel_brasil_parquet')
  total,municipios,first,last=self.db.execute('SELECT count(*),count(distinct cod_ibge),min(ano),max(ano) FROM read_parquet('+qs((self.root/main['caminho']).as_posix())+')').fetchone()
  for relative,before in self.origins.items():
   assert sha(self.base/relative)==before['sha256'],'Origem mudou durante a geração: '+relative
  source=self.base/'gold/manifesto.json'
  assert sha(source)==self.base_sha,'Manifesto de origem mudou durante a geração'
  payload=dict(versao=VERSAO,gerado_em=datetime.now(timezone.utc).isoformat(),base_gerado_em=self.manifest['gerado_em'],base_sha256=sha(source),base_ipca=self.manifest['base_ipca'],
   resumo=dict(municipios=municipios,ano_de=first,ano_ate=last,variaveis=len(self.schema('SELECT * FROM painel'))-2,linhas=total,variaveis_detalhadas=sum(d['tabela']!='painel' for d in self.dictionary)),
   notas=NOTAS,areas=[dict(id=a,nome=pt,nome_en=en,descricao=pt,descricao_en=en) for a,pt,en in AREAS],arquivos=self.files,
   dicionario={k:descriptor[k] for k in ['caminho','bytes','sha256']})
  payload['parcial']=getattr(self,'parcial',False)
  (self.dest/'manifesto.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
  (self.work/'origens.json').write_text(json.dumps(self.origins,indent=2),encoding='utf-8')
  print(json.dumps({'concluido':True,**payload['resumo'],'arquivos':len(self.files)},ensure_ascii=False),flush=True)


def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--base',type=Path,required=True);ap.add_argument('--saida',type=Path,required=True);ap.add_argument('--sem-detalhes',action='store_true')
 args=ap.parse_args();p=Painel(args.base,args.saida);p.parcial=args.sem_detalhes
 for action in [p.financas,p.saude,p.trabalho,p.clima,p.assistencia,p.gestao,p.integrar]:action()
 if not args.sem_detalhes:p.detalhes_munic();p.detalhes_dca()
 p.finalizar()


if __name__=='__main__':main()
