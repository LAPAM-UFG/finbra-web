"""Acrescenta o dicionário Excel opcional e prepara o pacote completo após a geração.

Não lê credenciais nem publica. Só escreve em --raiz; o manifesto global é preservado.
"""
import argparse
import csv
import hashlib
import json
import shutil
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
import duckdb
from painel_municipal import qi,qs,sha,NOTAS
from assistencia_utils import destino_isolado

SAUDE_NOMES={
 'pop_homens':'População residente masculina','pop_mulheres':'População residente feminina','pop_menor_1':'População com menos de um ano','pop_mulheres_10_49':'Mulheres de 10 a 49 anos',
 'obitos_homens':'Óbitos de homens','obitos_mulheres':'Óbitos de mulheres','neonatais_precoces':'Óbitos nos primeiros seis dias de vida','idosos_60_mais':'Óbitos de pessoas de 60 anos ou mais',
 'idade_ignorada':'Óbitos com idade ignorada','externas':'Óbitos por causas externas','covid':'Óbitos por COVID-19','circulatorio':'Óbitos por doenças circulatórias','neoplasias':'Óbitos por neoplasias','respiratorio':'Óbitos por doenças respiratórias','obitos_fetais':'Óbitos fetais',
 'sem_consulta':'Nascidos vivos de mães sem consulta de pré-natal','maes_35_mais':'Nascidos vivos de mães com 35 anos ou mais',
 'int_valor':'Valor das internações de moradores aprovado pelo SUS','int_atendidas':'Internações realizadas nos hospitais do município','int_atendidas_de_fora':'Internações nos hospitais do município de pacientes de outros municípios','int_atendidas_valor_real':'Valor SUS das internações realizadas nos hospitais do município (IPCA)',
 'cnes_estab_sus':'Estabelecimentos que atendem ao SUS','cnes_leitos_nao_sus':'Leitos não SUS','cnes_leitos_cirurgicos':'Leitos cirúrgicos','cnes_leitos_clinicos':'Leitos clínicos','cnes_leitos_complementares':'Leitos complementares','cnes_leitos_obstetricos':'Leitos obstétricos','cnes_leitos_pediatricos':'Leitos pediátricos','cnes_leitos_outras':'Leitos de outras especialidades','cnes_leitos_hospital_dia':'Leitos de hospital-dia',
 'sinan_chik_notificacoes':'Notificações de chikungunya','siscan_mamografias':'Mamografias registradas no SISCAN','siscan_histo_colo':'Exames histopatológicos do colo do útero','siscan_histo_mama':'Exames histopatológicos da mama','onco_tratados':'Registros de câncer com tratamento','resp_obitos':'Registros de óbito no RESP',
 'amb_registros':'Registros de produção ambulatorial aprovada (SIA)','amb_qtd':'Procedimentos ambulatoriais aprovados','amb_valor':'Valor aprovado da produção ambulatorial','amb_valor_real':'Valor aprovado da produção ambulatorial (IPCA)','amb_qtd_fora':'Procedimentos identificados como de pacientes de outros municípios','amb_valor_fora_real':'Valor de procedimentos identificados como de outros municípios (IPCA)',
 'ab_cobertura':'Cobertura estimada da atenção básica — metodologia até 2020','ab_cobertura_sf':'Cobertura estimada da Saúde da Família — série atenção básica','ab_equipes_esf':'Equipes de Saúde da Família — série atenção básica','ab_populacao':'População de referência — atenção básica',
 'aps_cobertura':'Cobertura potencial da atenção primária — metodologia desde 2021','aps_equipes_esf':'Equipes de Saúde da Família — série APS','aps_equipes_eap':'Equipes de Atenção Primária','aps_capacidade':'Capacidade potencial de atendimento da APS','aps_populacao':'População de referência — APS','acs_cobertura':'Cobertura de agentes comunitários de saúde','acs_agentes':'Agentes comunitários de saúde','acs_populacao':'População de referência — agentes comunitários',
}


def validar_excel(path,dictionary):
 ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
 with zipfile.ZipFile(path) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
  sheet=ET.fromstring(z.read('xl/worksheets/sheet1.xml'));rows=sheet.findall('s:sheetData/s:row',ns);data=[]
  for row in rows[1:]:
   values={}
   for cell in row.findall('s:c',ns):
    column=''.join(x for x in cell.attrib['r'] if x.isalpha());v=cell.find('s:v',ns)
    if cell.attrib.get('t')=='s':value=strings[int(v.text)]
    elif cell.attrib.get('t')=='inlineStr':value=''.join(cell.find('s:is',ns).itertext())
    else:value=v.text if v is not None else ''
    values[column]=value
   data.append((values.get('A',''),values.get('C','')))
  assert data==[(d['variavel'],d['unidade']) for d in dictionary], 'Excel não corresponde aos códigos/unidades do dicionário atual'
  assert sheet.find('s:sheetViews/s:sheetView/s:pane',ns) is not None,'Excel sem cabeçalho fixo'


def esclarecer(dictionary,base):
 cat=json.loads(Path(__file__).with_name('painel_municipal_catalogos.json').read_text(encoding='utf-8'))
 import pyarrow.parquet as pq
 cnaes={}
 for r in pq.read_table(base/'gold/trabalho/cnae.parquet').to_pylist():
  desc=r.get('descricao') or r.get('nome') or r.get('rotulo') or r.get('divisao_nome')
  if desc:cnaes[str(r['divisao']).zfill(2)]=desc
 grupos={'promocao':'Promoção e prevenção','diagnostico':'Diagnóstico','clinicos':'Procedimentos clínicos','cirurgicos':'Procedimentos cirúrgicos','transplantes':'Transplantes','medicamentos':'Medicamentos','orteses':'Órteses e próteses','complementares':'Ações complementares'}
 for d in dictionary:
  var=d['variavel'];raw=var.removeprefix('sau_')
  if raw in SAUDE_NOMES:d['nome']=d['descricao']=SAUDE_NOMES[raw]
  if raw.startswith('cap') or raw.startswith('int_cap'):
   chapter=raw.removeprefix('int_');label=cat['capitulos_cid'].get(chapter,'CID-10, capítulo '+chapter.removeprefix('cap'))
   d['nome']=d['descricao']=('Internações: ' if raw.startswith('int_') else 'Óbitos: ')+label;d['unidade']='internações' if raw.startswith('int_') else 'óbitos'
  if raw.startswith('icsap_g'):
   label=cat['grupos_icsap'][str(int(raw.removeprefix('icsap_g')))];d['nome']=d['descricao']='ICSAP: '+label;d['unidade']='internações'
  if raw.startswith('amb_'):
   for group,label in grupos.items():
    if raw.startswith('amb_'+group+'_'):
     d['nome']=d['descricao']='SIA — '+label+(': procedimentos aprovados' if raw.endswith('_qtd') else ': valor aprovado (IPCA)')
  if var.startswith('sia_sub_'):d['nome']=d['nome'].replace('Grupo SIGTAP','Subgrupo SIGTAP');d['descricao']=d['nome']
  import re
  match=re.fullmatch(r'cnae_(\d+)_(empregos|remuneracao_media_dez)',var)
  if match:
   code,metric=match.groups();label=cnaes.get(code.zfill(2),'Divisão CNAE '+code)
   d['nome']=d['descricao']=('Vínculos ativos: ' if metric=='empregos' else 'Remuneração média de dezembro: ')+label
  if var.startswith('cli_') and var.endswith('_anomalia_pct'):d['unidade']='variação relativa (0,01 = 1%)'
  if d['unidade']=='fração (0–1)':d['unidade']='razão (1 = 100%)'
  if (var.startswith('fin_inss_') or var.startswith('inss_')) and d['tipo'] in ['numero','inteiro']:d['regra_anual']='Quantidade de benefícios emitidos em dezembro; não é valor em reais nem pessoas únicas.'
  if var=='fin_bolsa_familia_familias':d['nome']=d['descricao']='Responsáveis distintos pagos em dezembro — CGU';d['regra_anual']='Dezembro; não equivale às famílias da folha do MDS.'
  if var=='fin_bolsa_familia_valor':
   d['nome']=d['descricao']='Bolsa Família/Auxílio Brasil: pagamentos acumulados no ano — CGU';d['unidade']='R$ nominais — acumulado no ano';d['regra_anual']='Soma dos meses publicados no ano. Não é valor mensal; a completude mensal acompanha os indicadores soc_pbf_cgu_.'


def periodos(db,dictionary,arquivos,root):
 sources={('painel' if a['id']=='painel_brasil_parquet' else a['id'].removesuffix('_parquet')):'read_parquet('+qs((root/a['caminho']).as_posix())+')' for a in arquivos if a['formato']=='parquet' and (a['id']=='painel_brasil_parquet' or a['tipo']=='detalhado')}
 for table in sorted({d['tabela'] for d in dictionary}):
  entries=[d for d in dictionary if d['tabela']==table]
  source=sources[table]
  cols={r[0] for r in db.execute('DESCRIBE SELECT * FROM '+source).fetchall()}
  bounds=db.execute('SELECT min(ano),max(ano) FROM '+source).fetchall()[0]
  all_years=[r[0] for r in db.execute('SELECT DISTINCT ano FROM '+source+' ORDER BY 1').fetchall()]
  for d in entries:
   if d['variavel'] not in cols:d['ano_de'],d['ano_ate']=bounds;d['anos_observados']=all_years
  selected=[d for d in entries if d['variavel'] in cols]
  # Conta os não nulos por ano: zeros e falsos contam; lacunas permanecem ausentes.
  # Isso evita milhares de agregados DISTINCT, cujo estado intermediário é muito maior.
  for start in range(0,len(selected),1000):
   chunk=selected[start:start+1000];query=[]
   for d in chunk:
    c=qi(d['variavel']);query.append(f'count({c})')
   values=db.execute('SELECT ano,'+','.join(query)+' FROM '+source+' GROUP BY ano ORDER BY ano').fetchall()
   for j,d in enumerate(chunk):
    years=[row[0] for row in values if row[j+1]>0];d['anos_observados']=years;d['ano_de']=years[0] if years else None;d['ano_ate']=years[-1] if years else None
  print(json.dumps({'dicionario_tabela':table,'campos':len(entries),'anos_conferidos':True}),flush=True)


def finalizar(root,excel=None,base=Path('E:/finbra/data')):
 root=destino_isolado(root,base);dest=root/'gold/downloads';mp=dest/'manifesto.json'
 m=json.loads(mp.read_text(encoding='utf-8'));assert not m.get('parcial'), 'A geração parcial não pode ser entregue'
 main=next(a for a in m['arquivos'] if a['id']=='painel_brasil_parquet')
 with duckdb.connect() as db:
  total,cities,first,last=db.execute('SELECT count(*),count(distinct cod_ibge),min(ano),max(ano) FROM read_parquet('+qs((root/main['caminho']).as_posix())+')').fetchone()
 m['resumo'].update(linhas=total,municipios=cities,ano_de=first,ano_ate=last,variaveis=main['variaveis'])
 dictionary=json.loads((root/m['dicionario']['caminho']).read_text(encoding='utf-8'))
 data_signature=hashlib.sha256(json.dumps(sorted((a['id'],a['sha256']) for a in m['arquivos'] if a['tipo'] in ['painel','area','detalhado'] and a['formato']=='parquet')).encode()).hexdigest()
 if m.get('dicionario_periodos_dados_sha256')!=data_signature:
  with duckdb.connect() as db:
   db.execute("SET threads=2; SET memory_limit='3GB'");periodos(db,dictionary,m['arquivos'],root)
  m['dicionario_periodos_dados_sha256']=data_signature
 esclarecer(dictionary,base.resolve())
 for d in dictionary:
  var=d['variavel']
  if var=='fin_pib_per_capita':d['unidade']='R$ nominais por habitante'
  if var.startswith('soc_pbf_cgu_'):d['fonte']='CGU — pagamentos do Bolsa Família/Auxílio Brasil'
  elif var.startswith('soc_pbf_'):d['fonte']='MDS — Bolsa em Números'
  elif var.startswith('soc_bpc_'):d['fonte']='CGU — BPC'
  elif var.startswith('soc_cad_'):d['fonte']='MDS — CadÚnico'
  if var.startswith('soc_') and d['unidade'].startswith('R$'):
   d['unidade']=d['unidade'].split(' — ')[0]+(' — acumulado no ano' if var.endswith('_soma_ano') else ' — mês indicado')
 m['arquivos']=[a for a in m['arquivos'] if a['tipo'] not in ['dicionario','pacote','metodologia']]
 def registrar(path,id,fmt,tipo,nome,linhas=None):
  digest=sha(path);target=dest/(id+'_'+digest[:12]+'.'+fmt)
  if target!=path:
   if not target.exists():shutil.copyfile(path,target)
   else:assert sha(target)==digest
  obj=dict(id=id,tipo=tipo,area=None,nome=nome,nome_en=nome,descricao=nome,descricao_en=nome,formato=fmt,caminho=target.relative_to(root).as_posix(),bytes=target.stat().st_size,sha256=digest,linhas=linhas,variaveis=None,ano_de=None,ano_ate=None,uf=None)
  m['arquivos'].append(obj);return obj
 work=root/'trabalho_downloads';p=work/'dicionario_final.json';p.write_text(json.dumps(dictionary,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 obj=registrar(p,'dicionario_json','json','dicionario','Dicionário de variáveis',len(dictionary));m['dicionario']={k:obj[k] for k in ['caminho','bytes','sha256']}
 csvfile=work/'dicionario_final.csv'
 with csvfile.open('w',encoding='utf-8-sig',newline='') as f:
  fields=['variavel','nome','descricao','area','fonte','unidade','tipo','regra_anual','ano_de','ano_ate','tabela','observacao','anos_observados'];w=csv.DictWriter(f,fieldnames=fields,delimiter=';');w.writeheader();w.writerows(dictionary)
 zfile=work/'dicionario_final.csv.zip'
 with zipfile.ZipFile(zfile,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:z.write(csvfile,'dicionario.csv')
 registrar(zfile,'dicionario_csv','csv.zip','dicionario','Dicionário de variáveis',len(dictionary))
 if excel:
  validar_excel(excel.resolve(),dictionary)
  registrar(excel.resolve(),'dicionario_excel','xlsx','dicionario','Dicionário de variáveis — Excel',len(dictionary))
 leia=work/'LEIA-ME.txt';leia.write_text('BASE MUNICIPAL ANUAL — LAPAM/UFG\n\n'+'\n\n'.join(NOTAS)+'\n\nJunção: cod_ibge + ano. A tabela painel corresponde à base integrada e aos recortes por área/UF. munic_AAAA corresponde ao questionário da edição AAAA. dca_ identifica o anexo DCA. Não misture os códigos das perguntas MUNIC de edições distintas. Os anos do dicionário são os efetivamente observados com valor em pelo menos um município; a cobertura não é necessariamente completa em cada local.\n',encoding='utf-8')
 registrar(leia,'metodologia','txt','metodologia','Como usar os arquivos')
 if excel:
  package=work/'base_municipal_completa.zip'
  members=[a for a in m['arquivos'] if (a['tipo']=='painel' and a['uf'] is None and a['formato']=='csv.zip') or (a['tipo']=='detalhado' and a['formato']=='csv.zip') or (a['tipo']=='dicionario' and a['formato'] in ['csv.zip','xlsx']) or a['tipo']=='metodologia']
  with zipfile.ZipFile(package,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True) as target:
   for a in members:
    source=root/a['caminho'];folder='complementos/' if a['tipo']=='detalhado' else ''
    if a['formato']=='csv.zip':
     with zipfile.ZipFile(source) as z:
      for name in z.namelist():
       assert name==Path(name).name and name.endswith('.csv'),name
       with z.open(name) as src,target.open(folder+name,'w',force_zip64=True) as dst:shutil.copyfileobj(src,dst,8*1024*1024)
    else:target.write(source,a['id']+'.'+a['formato'])
  registrar(package,'pacote_completo','zip','pacote','Base integrada + complementos + dicionário')
 m['notas']=NOTAS
 for a in m['arquivos']:
  if a['formato'] in ['csv.zip','zip']:
   with zipfile.ZipFile(root/a['caminho']) as z:a['bytes_extraido']=sum(i.file_size for i in z.infolist())
 temporary=mp.with_suffix('.novo.json');temporary.write_text(json.dumps(m,ensure_ascii=False,indent=2),encoding='utf-8');temporary.replace(mp)
 print(json.dumps({'ok':True,'arquivos':len(m['arquivos']),'dicionario':len(dictionary),'excel':bool(excel),'resumo':m['resumo']},ensure_ascii=False))


if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--raiz',type=Path,required=True);ap.add_argument('--excel',type=Path);ap.add_argument('--base',type=Path,default=Path('E:/finbra/data'));args=ap.parse_args();finalizar(args.raiz,args.excel,args.base)
