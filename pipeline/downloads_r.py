"""Acrescenta RDS nativos à edição publicada sem modificar os formatos anteriores."""
import argparse,copy,json,shutil,subprocess,zipfile
from datetime import datetime,timezone
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado,salvar_json
from downloads_enxuto import ler
from downloads_navegacao import objetos,referencia,registrar
from painel_municipal import sha


def gerar(origem,saida,base,rscript):
 origem=origem.resolve();base=base.resolve();saida=destino_isolado(saida,origem);destino_isolado(saida,base)
 dest=saida/'gold/downloads';work=saida/'trabalho_downloads'
 if not dest.resolve().is_relative_to(saida):raise ValueError('Pasta redirecionada para fora da candidata')
 m=copy.deepcopy(ler(origem/'gold/downloads/manifesto.json'));assert m['base_sha256']==sha(base/'gold/manifesto.json')
 refs,files=objetos(origem,m)
 work.mkdir(parents=True,exist_ok=True);dest.mkdir(parents=True,exist_ok=True)
 for a in refs:
  src=origem/a['caminho'];assert sha(src)==a['sha256'];target=saida/a['caminho']
  if target.exists():assert sha(target)==a['sha256']
  else:shutil.copyfile(src,target)
 plan=[]
 for a in files:
  if a['tipo'] not in ['painel','area'] or a['formato']!='parquet':continue
  id=a['id'].removesuffix('_parquet')
  plan.append(dict(id=id+'_rds',parquet=str(saida/a['caminho']),rds=str(work/(id+'.rds')),retorno=str(work/(id+'_retorno.parquet')),origem=a['caminho'],sha256=a['sha256'],uf=a['uf'],tema=a['area']))
 dictionary=saida/m['dicionario']['caminho'];dict_rds=work/'dicionario.rds'
 config=dict(dicionario=str(dictionary),saida_dicionario=str(dict_rds),arquivos=plan,base_sha256=m['base_sha256'],gerado_em=m['gerado_em'])
 save=work/'plano_r.json';salvar_json(save,config);report=work/'r_nativo.json'
 subprocess.run([str(rscript),'--vanilla',str(Path(__file__).with_suffix('.R')),str(save),str(report)],check=True,timeout=1200)
 assert ler(report)['ok']
 new=[];cells=0
 by_id={a['id']:a for a in files}
 for item in plan:
  source=by_id[item['id'].removesuffix('_rds')+'_parquet'];truth=pq.read_table(saida/source['caminho']).to_pandas();actual=pq.read_table(item['retorno']).to_pandas()
  pd.testing.assert_frame_equal(actual,truth,check_dtype=False,check_exact=True)
  cells+=truth.size
  ref=registrar(saida,Path(item['rds']),item['id'],'rds')
  obj={**source,**ref,'id':item['id'],'formato':'rds'};new.append(obj)
  if obj['uf'] and obj['tipo']=='area':continue
  m['arquivos'].append(obj)
 for uf,ref in list(m['recortes_uf'].items()):
  catalog=ler(saida/ref['caminho']);catalog['arquivos'].extend(a for a in new if a['uf']==uf and a['tipo']=='area')
  m['recortes_uf'][uf]=referencia(saida,work,'catalogo_'+uf.lower(),catalog)
 dict_ref=registrar(saida,dict_rds,'dicionario_rds','rds')
 template=next(a for a in m['arquivos'] if a['id']=='dicionario_excel')
 m['arquivos'].append({**template,**dict_ref,'id':'dicionario_rds','formato':'rds','nome':'Dicionário da base enxuta — R','nome_en':'Compact base dictionary — R','descricao':'Dicionário nativo para R.','descricao_en':'Native dictionary for R.'})
 main=next(a for a in new if a['tipo']=='painel' and a['uf'] is None)
 archive=work/'pacote_brasil_rds.zip'
 with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as z:
  for a in [main]+[a for a in m['arquivos'] if (a['tipo']=='dicionario' and a.get('escopo')=='principal') or a['tipo']=='metodologia']:
   file=saida/a['caminho']
   if a['formato']=='csv.zip':
    with zipfile.ZipFile(file) as src:
     for entry in src.infolist():
      with src.open(entry) as stream,z.open(entry.filename,'w',force_zip64=True) as target:shutil.copyfileobj(stream,target,8*1024*1024)
   else:z.write(file,a['id']+'.'+a['formato'])
  helper=Path(__file__).resolve().parent.parent/'web/public/finbra.R'
  if helper.exists():z.write(helper,'finbra.R')
 ref=registrar(saida,archive,'pacote_brasil_rds','zip')
 template=next(a for a in m['arquivos'] if a.get('conteudo')=='dta')
 with zipfile.ZipFile(archive) as z:extracted=sum(a.file_size for a in z.infolist());assert z.testzip() is None
 m['arquivos'].append({**template,**ref,'id':'pacote_brasil_rds','conteudo':'rds','nome':'Brasil — R + dicionário','nome_en':'Brazil — R + dictionary','bytes_extraido':extracted})
 m['gerado_em']=datetime.now(timezone.utc).isoformat();m['r']=dict(formato='rds',serializacao=2,dependencias_para_ler=[])
 salvar_json(dest/'manifesto.json',m);all_refs,all_files=objetos(saida,m)
 for a in all_refs:assert (saida/a['caminho']).stat().st_size==a['bytes'] and sha(saida/a['caminho'])==a['sha256']
 result=dict(ok=True,manifesto_sha256=sha(dest/'manifesto.json'),objetos=len(all_refs),arquivos=len(all_files),rds=len(new),rds_celulas=cells,dicionario_rds=True,base_sha256=m['base_sha256'],fonte_manifesto_sha256=sha(origem/'gold/downloads/manifesto.json'))
 assert sha(base/'gold/manifesto.json')==m['base_sha256']
 salvar_json(work/'auditoria.json',result);print(json.dumps(result),flush=True)


def empacotar_cliente(root):
 """Atualiza só o cliente dentro do ZIP, sem regenerar os dados já auditados."""
 root=destino_isolado(root);mp=root/'gold/downloads/manifesto.json';m=ler(mp);work=root/'trabalho_downloads'
 audit=ler(work/'auditoria.json');assert audit['ok'] and audit['manifesto_sha256']==sha(mp)
 index=next(i for i,a in enumerate(m['arquivos']) if a['id']=='pacote_brasil_rds');a=m['arquivos'][index]
 original=root/a['caminho'];assert sha(original)==a['sha256']
 helper=Path(__file__).resolve().parent.parent/'web/public/finbra.R';target=work/'pacote_rds_cliente_atualizado.zip'
 with zipfile.ZipFile(original) as src,zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3) as dst:
  for entry in src.infolist():
   if entry.filename=='finbra.R':continue
   with src.open(entry) as stream,dst.open(entry,'w',force_zip64=True) as out:shutil.copyfileobj(stream,out,8*1024*1024)
  dst.write(helper,'finbra.R')
 with zipfile.ZipFile(target) as z:
  assert z.testzip() is None and z.read('finbra.R')==helper.read_bytes();extracted=sum(v.file_size for v in z.infolist())
 m['arquivos'][index]={**a,**registrar(root,target,'pacote_brasil_rds','zip'),'bytes_extraido':extracted}
 m['gerado_em']=datetime.now(timezone.utc).isoformat();salvar_json(mp,m)
 refs,files=objetos(root,m)
 for ref in refs:assert sha(root/ref['caminho'])==ref['sha256']
 audit.update(manifesto_sha256=sha(mp),objetos=len(refs),arquivos=len(files),cliente_r_sha256=sha(helper))
 salvar_json(work/'auditoria.json',audit);print(json.dumps(audit),flush=True)


if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--origem',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);p.add_argument('--base',type=Path,default=Path('E:/finbra/data'));p.add_argument('--rscript',type=Path,required=True);a=p.parse_args();gerar(a.origem,a.saida,a.base,a.rscript)
