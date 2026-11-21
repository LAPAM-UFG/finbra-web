"""Artefatos de Energia no mesmo contrato parcial de séries, mapas e comparações."""
import gzip,hashlib,json
from datetime import datetime,timezone
from types import SimpleNamespace
import numpy as np,pandas as pd
from comparacoes_base import Gravador,compacto,numeros,sha
from energia_fontes import sha as arquivo_sha
from energia_definicoes import CONDICOES,NOTA_GD,NOTA_SIG,NOTA_COORTE

def gerar_artefatos(fontes,saida,g,municipios,grupos,pos,ufs,groups,ANOS,a,c,defs,quadros,residuos,sm,main):
 nmun=len(municipios)
 dv=np.full((len(ANOS),len(grupos),len(quadros)),np.nan);dc=np.full(dv.shape,2,dtype='int8');dn=np.full_like(dv,np.nan);dd=np.full_like(dv,np.nan);dq=np.zeros(dv.shape,dtype='int16')
 groups={key:[j for j,m in enumerate(municipios)if key==str(m[0])or key==m[2]or key=='BR'or key=='I:'+m[3]or key=='T:'+m[4]]for key,t in g['territorios'].items()if t['nivel']in ['M','UF','BR','imediata','intermediaria']}
 for j,q in enumerate(quadros):
  for key in grupos:
   v=q.grupo_territorio(key,groups[key],municipio=len(key)==7);loc=pos[key]
   for k,y in enumerate(q.periodos):
    dest=ANOS.index(y)
    for out,field in [(dv,'v'),(dn,'n'),(dd,'d')]:out[dest,loc,j]=np.nan if v[field][k]is None else v[field][k]
    dc[dest,loc,j]=v['c'][k];dq[dest,loc,j]=v['q'][k]
 dest=saida/'gold/energia';dest.mkdir(parents=True)
 def objeto(area,nome,v,zip=False):
  body=compacto(v);b=gzip.compress(body,mtime=0)if zip else body;h=sha(b);p=saida/'gold'/area/(nome+'_'+h[:16]+('.json.gz'if zip else'.json'));p.parent.mkdir(exist_ok=True);p.write_bytes(b)
  return dict(caminho=p.relative_to(saida).as_posix(),bytes=len(b),sha256=h,**(dict(json_bytes=len(body),json_sha256=sha(body))if zip else{}))
 indices={};maxslice=0
 for bucket in [*sorted(ufs),'referencias']:
  keys=[key for key in grupos if(g['territorios'][key]['uf']if len(key)==7 else'referencias')==bucket];temp=dest/f'tmp_{bucket}.ndjson';entries={}
  with temp.open('wb')as f:
   for key in keys:
    loc=pos[key];body=compacto(dict(versao=1,grupo=key,anos=ANOS,valores=[numeros(r)for r in a[:,loc]],condicoes=c[:,loc].tolist(),derivados=[numeros(r)for r in dv[:,loc]],condicoes_derivados=dc[:,loc].tolist(),numeradores=[numeros(r)for r in dn[:,loc]],denominadores=[numeros(r)for r in dd[:,loc]],coberturas=dq[:,loc].tolist(),residuos=residuos if len(key)!=7 else{}))+b'\n';entries[key]=[f.tell(),len(body),sha(body)];f.write(body);maxslice=max(maxslice,len(body))
  h=arquivo_sha(temp);p=dest/f'series_{bucket.lower()}_{h[:16]}.ndjson';temp.rename(p);indices[bucket]=objeto('energia','indice_'+bucket.lower(),dict(versao=1,arquivo=dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=h),grupos=entries))
 cat=objeto('energia','catalogo',dict(versao=1,anos=ANOS,indicadores=defs,derivados=[dict(q.definicao,periodos=q.periodos)for q in quadros],condicoes=CONDICOES),True);geo=objeto('energia','geografia',g,True)
 m=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=ANOS,catalogo=cat,geografia=geo,indices=indices,variaveis=len(defs),calculados=len(quadros),territorios=len(grupos),max_trecho_bytes=maxslice,origens={'aneel':arquivo_sha(fontes/'energia_normalizada.json'),'populacao':main['sha256'],'populacao_2026':arquivo_sha(fontes/'populacao_2026_sidra.json')},datas={'mmgd':sm['mmgd_data'],'siga':sm['siga_data']},qualidade={k:sm[k]for k in ['mmgd_empreendimentos','mmgd_com_data','mmgd_sem_data','siga_usinas','siga_duplicatas_por_outorga','siga_multimunicipais','siga_sem_municipio']},notas=[NOTA_GD,NOTA_SIG,NOTA_COORTE]);(dest/'manifesto.json').write_bytes(compacto(m))
 data={'cod_ibge':np.tile([m[0]for m in municipios],len(ANOS)),'ano':np.repeat(ANOS,nmun),'municipio':np.tile([m[1]for m in municipios],len(ANOS)),'uf':np.tile([m[2]for m in municipios],len(ANOS))}
 for j,i in enumerate(defs):data[i['id']]=a[:,:nmun,j].reshape(-1);data[i['id']+'_cond']=c[:,:nmun,j].reshape(-1)
 for j,q in enumerate(quadros):id=q.definicao['variavel_download'];data[id]=dv[:,:nmun,j].reshape(-1);data[id+'_cond']=dc[:,:nmun,j].reshape(-1)
 work=saida/'trabalho_energia';work.mkdir();pd.DataFrame(data).sort_values(['cod_ibge','ano']).to_parquet(work/'municipios.parquet',index=False,compression='zstd')
 go=SimpleNamespace(municipios=municipios,territorios=g['territorios'],governos=g['governos'],grupos=groups,buckets={k:t['uf']if t['nivel']=='M'else'referencias'for k,t in g['territorios'].items()})
 root=json.loads((fontes/'gold/comparacoes/manifesto.json').read_bytes());writer=Gravador(saida,go,fontes,{});writer.georef=root['geografia'];writer.area('energia',quadros,dict(caminho='gold/energia/manifesto.json',sha256=arquivo_sha(dest/'manifesto.json')));root['catalogos'].update(writer.catalogos);root['origens']['gold/energia/manifesto.json']=dict(bytes=(dest/'manifesto.json').stat().st_size,sha256=arquivo_sha(dest/'manifesto.json'));root['gerado_em']=m['gerado_em'];(saida/'gold/comparacoes/manifesto.json').write_bytes(compacto(root))
 gerar_mapas(saida,municipios,quadros,m,objeto)
 report=dict(ok=True,originais=len(defs),relativos=len(quadros),territorios=len(grupos),max_trecho_bytes=maxslice,anos=ANOS);(work/'auditoria_geracao.json').write_bytes(compacto(report));print(json.dumps(report),flush=True)

def gerar_mapas(saida,municipios,quadros,m,objeto):
 from mapas_indicadores import escala
 dest=saida/'gold/mapas';dest.mkdir(exist_ok=True);cad=objeto('mapas','cadastro_energia',dict(versao=1,municipios=[m[:3]for m in municipios]));temp=dest/'temp_energia.ndjson';indices=[];definitions=[]
 with temp.open('wb')as f:
  for q in quadros:
   tr={}
   for k,y in enumerate(q.periodos):
    start=f.tell();h=hashlib.sha256()
    for uf in sorted({m[2]for m in municipios}):
     pp=[j for j,m in enumerate(municipios)if m[2]==uf];b=compacto(dict(versao=1,area='energia',rede='todas',indicador=q.definicao['id'],ano=y,uf=uf,cadastro=cad['sha256'],quantidade=len(pp),valores=numeros(q.valores[k,pp]),numeradores=numeros(q.numeradores[k,pp]),denominadores=numeros(q.denominadores[k,pp]),condicoes=q.condicoes[k,pp].tolist()))+b'\n';tr[f'{y}:{uf}']=[f.tell(),len(b),sha(b)];f.write(b);h.update(b)
    tr[f'{y}:BR']=[start,f.tell()-start,h.hexdigest()]
   indices.append((q,tr))
 h=arquivo_sha(temp);p=dest/f'energia_todas_dados_{h[:16]}.ndjson';temp.rename(p);ref=dict(caminho=p.relative_to(saida).as_posix(),bytes=p.stat().st_size,sha256=h)
 for q,tr in indices:
  i=q.definicao;index=objeto('mapas','energia_todas_'+i['id']+'_indice',dict(versao=1,area='energia',rede='todas',indicador=i['id'],cadastro=cad['sha256'],arquivo=ref,recortes=tr))
  definitions.append({**{k:v for k,v in i.items()if k in ['id','nome','nome_en','descricao','descricao_en','tema','tema_en','unidade','unidade_en','formato','fonte_nome','fontes','alerta','alerta_en','numerador_nome','denominador_nome','minimo','notas_anos']},'fonte_nome_en':i['fonte_nome'],'territorio':'Município da instalação de geração distribuída','territorio_en':'Location of the distributed generating installation','numerador_nome_en':i['numerador_nome'],'denominador_nome_en':i['denominador_nome'],'anos':q.periodos,'anos_com_valor':[y for k,y in enumerate(q.periodos)if np.isfinite(q.valores[k]).any()],'escala':escala(q.valores,i['formato']),'indice':index})
 (dest/'energia_manifesto.json').write_bytes(compacto(dict(versao=1,area='energia',rede='todas',gerado_em=m['gerado_em'],cadastro=cad,indicadores=definitions,origem=dict(tipo='energia',caminho='gold/energia/manifesto.json',sha256=arquivo_sha(saida/'gold/energia/manifesto.json'),gerado_em=m['gerado_em']))))
