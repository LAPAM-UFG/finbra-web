"""Recortes para mapas a partir das edições publicadas, sem alterar ou enviar fontes."""
import argparse,hashlib,json,math
from datetime import datetime,timezone
from pathlib import Path
import numpy as np
from mapas_indicadores import compacto,escala,numeros,sha

class Gerador:
 def __init__(self,revisao,saida):
  self.rev=revisao.resolve();self.saida=saida.resolve();self.dest=self.saida/'gold/mapas'
  self.refs=json.loads((self.rev/'fontes_resolvidas.json').read_bytes())
  for ref in self.refs.values():
   origem=Path(ref['caminho_local']).resolve();assert not self.saida.is_relative_to(origem.parent)and not origem.is_relative_to(self.saida),'Destino sobreposto às fontes'
  assert not self.saida.is_relative_to(self.rev)and not self.rev.is_relative_to(self.saida),'Destino sobreposto à revisão'
  assert not self.dest.exists()or not any(self.dest.iterdir()),'Use um candidato novo/vazio'
  self.edu=self.ler('educacao_base.json');self.global_meta=self.ler('global_base.json');self.san=self.ler('saneamento_base.json');self.trab=self.ler('trabalho_definicoes.json')
  self.municipios=sorted([[int(c),n,u]for c,n,u in json.loads(self.fonte(self.edu['busca_municipios']).read_bytes())]);assert len(self.municipios)==5571
  self.pos={r[0]:k for k,r in enumerate(self.municipios)};self.ufs={u:[k for k,r in enumerate(self.municipios)if r[2]==u]for u in sorted({r[2]for r in self.municipios})}
  self.cadastro=self.objeto('cadastro',dict(versao=1,municipios=self.municipios));self.agora=datetime.now(timezone.utc).isoformat()
  self.audit=dict(ok=True,indicadores={},celulas=0,zeros=0,negativos=0,ausentes=0,recortes=0,casos_saneamento={})
 def ler(self,n):return json.loads((self.rev/n).read_bytes())
 def fonte(self,ref):
  r=self.refs[ref['caminho']];p=Path(r['caminho_local']);assert p.stat().st_size==ref['bytes']and sha(p.read_bytes())==ref['sha256'];return p
 def objeto(self,nome,v):
  b=compacto(v);h=sha(b);self.dest.mkdir(parents=True,exist_ok=True);p=self.dest/f'{nome}_{h[:16]}.json';p.write_bytes(b);return dict(caminho='gold/mapas/'+p.name,bytes=len(b),sha256=h)
 def escrever(self,area,inds,anos,v,n,d,c,origem,originais=None,validas=None):
  temp=self.dest/f'{area}_temporario.ndjson';indices=[]
  with temp.open('xb')as f:
   for j,i in enumerate(inds):
    dados=v[:,:,j];assert np.isfinite(dados).sum()==np.count_nonzero(np.isin(c[:,:,j],[0,1,11,12]))
    assert i.get('com_sinal')or np.all(dados[np.isfinite(dados)]>=0),i['id']
    i['anos_com_valor']=[a for k,a in enumerate(anos)if a in i['anos']and np.isfinite(dados[k]).any()];i['escala']=escala(np.abs(dados)if i.get('com_sinal')else dados,i['formato'])
    trechos={}
    for k,ano in enumerate(anos):
     if ano not in i['anos']:continue
     inicio=f.tell();hbr=hashlib.sha256()
     for uf,pos in self.ufs.items():
      vs=numeros(v[k,pos,j]);ns=numeros(n[k,pos,j]);ds=numeros(d[k,pos,j]);estados=c[k,pos,j].astype(int).tolist()
      carga=dict(versao=1,area=area,rede='todas',indicador=i['id'],ano=ano,uf=uf,cadastro=self.cadastro['sha256'],quantidade=len(pos),valores=vs if any(x is not None for x in vs)else None,numeradores=ns,denominadores=ds,condicoes=estados)
      if originais is not None:carga['condicoes_originais']=originais[k,pos,j].astype(int).tolist()
      if validas is not None and i.get('categoria',{}).get('medida')=='rem':carga['rem_validas']=numeros(validas[k,pos,j])
      b=compacto(carga)+b'\n';trechos[f'{ano}:{uf}']=[f.tell(),len(b),sha(b)];f.write(b);hbr.update(b)
      self.audit['celulas']+=len(vs);self.audit['zeros']+=sum(x==0 for x in vs);self.audit['negativos']+=sum(x is not None and x<0 for x in vs);self.audit['ausentes']+=sum(x is None for x in vs);self.audit['recortes']+=1
     trechos[f'{ano}:BR']=[inicio,f.tell()-inicio,hbr.hexdigest()]
    indices.append((i,dict(versao=1,area=area,rede='todas',indicador=i['id'],cadastro=self.cadastro['sha256'],recortes=trechos)))
  b=temp.read_bytes();h=sha(b);p=self.dest/f'{area}_todas_dados_{h[:16]}.ndjson';assert p.resolve().is_relative_to(self.dest.resolve());temp.rename(p)
  arquivo=dict(caminho='gold/mapas/'+p.name,bytes=len(b),sha256=h);medidas=[]
  for i,idx in indices:
   idx['arquivo']=arquivo;i=dict(i);i.pop('source_index',None);i.pop('source_san_index',None);i['indice']=self.objeto(area+'_todas_'+i['id']+'_indice',idx);medidas.append(i)
  catalogo=dict(versao=1,area=area,rede='todas',gerado_em=self.agora,cadastro=self.cadastro,origem=origem,indicadores=medidas)
  (self.dest/(area+'_manifesto.json')).write_bytes(compacto(catalogo));self.audit['indicadores'][area]=dict(total=len(medidas),bytes_dados=len(b));print(json.dumps(self.audit['indicadores'][area]|{'area':area}),flush=True)
 def trabalho(self):
  defs=self.trab['indicadores'];anos=self.trab['anos'];shape=(len(anos),len(self.municipios),len(defs));v=np.full(shape,np.nan);n=np.full(shape,np.nan);d=np.full(shape,np.nan);c=np.full(shape,2,dtype=np.uint8);val=np.full(shape,np.nan)
  principais=[(j,i['source_index'])for j,i in enumerate(defs)if'source_index'in i];categorias=[(j,i['categoria'])for j,i in enumerate(defs)if'categoria'in i];py={a:k for k,a in enumerate(anos)}
  for uf in self.ufs:
   with(self.rev/'intermediarios'/f'trabalho_{uf}.ndjson').open(encoding='utf-8')as f:
    for linha in f:
     cod,ano,cels,total,itens=json.loads(linha);k=py[ano];p=self.pos[cod];assert self.municipios[p][2]==uf
     for j,src in principais:
      vv,nn,dd,cc=cels[src];v[k,p,j]=np.nan if vv is None else vv;n[k,p,j]=np.nan if nn is None else nn;d[k,p,j]=np.nan if dd is None else dd;c[k,p,j]=cc
     if total is None:continue
     obs={(x[0],x[1]):x[2:]for x in itens}
     for j,cat in categorias:
      count,pct,media,massa,nrem=obs.get((cat['variavel'],cat['codigo']),[0,0 if total>0 else None,None,None,0]);medida=cat['medida']
      vv=count if medida=='n'else pct if medida=='pct'else media;nn=massa if medida=='rem'else count;dd=nrem if medida=='rem'else total
      cc=(14 if count==0 else 15 if nrem is None else 13)if medida=='rem'and vv is None else 4 if medida=='pct'and total==0 else 1 if vv==0 else 0
      v[k,p,j]=np.nan if vv is None else vv;n[k,p,j]=np.nan if nn is None else nn;d[k,p,j]=dd;c[k,p,j]=cc;val[k,p,j]=np.nan if nrem is None else nrem
  for i in defs:
   i['alerta']='RAIS: mudanças de captação em 2022 e 2023; consulte as notas técnicas do MTE antes de comparar anos. Em 2023 também houve alterações na declaração de vínculos e remuneração.'if i['fonte_nome']=='RAIS'else'Novo CAGED: fluxos de vínculos celetistas. O saldo pode ser negativo; não é o estoque de vínculos da RAIS.'
   i['alerta_en']='RAIS: collection changes in 2022 and 2023; consult the Ministry’s technical notes before comparing years. In 2023, job-type and pay reporting also changed.'if i['fonte_nome']=='RAIS'else'Novo CAGED: flows of CLT jobs. The balance can be negative; it is not the RAIS job stock.'
   if i['fonte_nome']=='Novo CAGED':
    caged=self.global_meta['fontes']['caged'];y=caged['ate']//100;mes=caged['ate']%100
    if mes<12:i['notas_anos']={str(y):[f'Ano parcial: competências de janeiro a {mes:02d}/{y} ({mes} de 12 meses publicados).',f'Partial year: January through {mes:02d}/{y} ({mes} of 12 published months).']}
   if i.get('categoria',{}).get('variavel')=='vinculo_mte':
    i['descricao']+=' Agrupamento estatístico do MTE, não regime jurídico individual; o grupo estatutário inclui contratos por lei estadual ou municipal.';i['descricao_en']+=' Statistical Ministry grouping, not individual legal status; the statutory group includes contracts under state or municipal law.'
  self.escrever('trabalho',defs,anos,v,n,d,c,self.trab['origem'],validas=val)
 def saneamento(self):
  m=self.san;anos=m['anos'];shape=(len(anos),len(self.municipios),len(m['indicadores']));v=np.full(shape,np.nan);n=np.full(shape,np.nan);d=np.full(shape,np.nan);c=np.full(shape,2,dtype=np.uint8);raw=np.full(shape,1,dtype=np.uint8);py={a:k for k,a in enumerate(anos)}
  mapa={0:0,1:2,2:3,3:4,4:9,5:5,6:10}
  with self.fonte(m['arquivo']).open(encoding='utf-8')as f:
   for line in f:
    g=json.loads(line)
    if not g['grupo'].isdigit()or len(g['grupo'])!=7:continue
    cod=int(g['grupo']);p=self.pos[cod];vistos=set()
    for r in g['linhas']:
     a,j,vv,nn,dd,_,_,cc=r;assert(a,j)not in vistos;vistos.add((a,j));k=py[a];v[k,p,j]=np.nan if vv is None else vv;n[k,p,j]=np.nan if nn is None else nn;d[k,p,j]=np.nan if dd is None else dd;c[k,p,j]=1 if cc==0 and vv==0 else mapa[cc];raw[k,p,j]=cc
     if str(cc)not in self.audit['casos_saneamento']or cc==0 and vv==0 and'zero'not in self.audit['casos_saneamento']:
      chave='zero'if cc==0 and vv==0 else str(cc);self.audit['casos_saneamento'][chave]=dict(cod=cod,ano=a,id=m['indicadores'][j]['id'],valor=vv,numerador=nn,denominador=dd,condicao_origem=cc)
  unidades={'percentual':('%','%'),'pessoas':('pessoas','people'),'ligacoes':('ligações','connections'),'km':('km','km'),'m3_ano':('m³/ano','m³/year'),'t_ano':('t/ano','t/year'),'domicilios':('domicílios','households'),'economias':('economias atendidas','served consumer units'),'entidades':('entidades','entities'),'ocorrencias':('ocorrências','events'),'obitos':('óbitos','deaths'),'imoveis':('imóveis','properties'),'m3':('m³','m³')};temas={'agua':('Água','Water'),'esgoto':('Esgoto','Sewage'),'residuos':('Resíduos e coleta seletiva','Waste and selective collection'),'drenagem':('Drenagem e inundações','Drainage and floods')}
  inds=[]
  for j,i in enumerate(m['indicadores']):
   u,ue=unidades[i['unidade']];i=dict(i);i.update(source_san_index=j,formato='percentual'if i['unidade']=='percentual'else'numero',unidade=u,unidade_en=ue,tema=temas[i['tema']][0],tema_en=temas[i['tema']][1],minimo=0,fonte_nome='SNIS / SINISA',fontes=[dict(nome='Ministério das Cidades · SNIS',url='https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/snis'),dict(nome='Ministério das Cidades · SINISA',url='https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/sinisa')],territorio='Dados municipais autodeclarados por prestadores e gestores; não constituem avaliação da gestão.',territorio_en='Municipal data self-reported by providers and managers; not an assessment of management.',numerador_nome='Numerador ou soma observada',numerador_nome_en='Numerator or observed sum',denominador_nome='Denominador observado',denominador_nome_en='Observed denominator')
   for k,a in enumerate(anos):
    if a not in i['anos']:raw[k,:,j]=5;c[k,:,j]=5
   for campo in ['variavel','snis','sinisa','oficial','fator','regra_agregado','parear_numerador','parear_componentes','sinisa_desde']:i.pop(campo,None)
   inds.append(i)
  # O primeiro indicador é a cobertura de água; os demais mantêm a ordem do painel.
  ordem=[next(j for j,i in enumerate(inds)if i['id']=='agua_cobertura_pct')]+[j for j,i in enumerate(inds)if i['id']!='agua_cobertura_pct'];inds=[inds[j]for j in ordem]
  self.escrever('saneamento',inds,anos,v[:,:,ordem],n[:,:,ordem],d[:,:,ordem],c[:,:,ordem],dict(tipo='saneamento',caminho='gold/saneamento/manifesto.json',sha256=sha((self.rev/'saneamento_base.json').read_bytes()),gerado_em=m['gerado_em']),originais=raw[:,:,ordem])

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--revisao',required=True,type=Path);p.add_argument('--saida',required=True,type=Path);a=p.parse_args();g=Gerador(a.revisao,a.saida);g.trabalho();g.saneamento();(g.rev/'geracao_mapas.json').write_bytes(compacto(g.audit));print(json.dumps(g.audit),flush=True)
