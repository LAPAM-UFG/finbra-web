"""Auditoria da candidata: bytes, todos os territórios, fórmulas e cotejo SIM publicado."""
import argparse,gzip,hashlib,json
from pathlib import Path
import numpy as np,pandas as pd,requests
from mobilidade import correspondencias,TIPOS
from mobilidade_fontes import ANOS,compacto,sha
from mobilidade_perfis import FROTA_PERFIS,RACAS,LOCAIS,ESCOLAS,MESES

def auditar(fontes,candidato,saida):
 fontes=Path(fontes);root=Path(candidato);m=json.loads((root/'gold/mobilidade/manifesto.json').read_bytes())
 def ler(ref):
  b=(root/ref['caminho']).read_bytes();assert len(b)==ref['bytes']and sha(b)==ref['sha256']
  if ref['caminho'].endswith('.gz'):b=gzip.decompress(b);assert len(b)==ref['json_bytes']and sha(b)==ref['json_sha256']
  return json.loads(b)
 cat=ler(m['catalogo']);g=ler(m['geografia']);groups=[str(x[0])for x in g['municipios']]+[u for _,_,u in g['governos']]+['BR'];pos={k:j for j,k in enumerate(groups)};raw={i['id']:j for j,i in enumerate(cat['indicadores'])};a=np.full((13,len(groups),len(raw)),np.nan);vs=np.full((13,len(groups),len(cat['derivados'])),np.nan);cs=np.full(vs.shape,2,dtype=int);ns=vs.copy();ds=vs.copy();qs=np.zeros(vs.shape,dtype=int);count=bytes_read=0;cases={}
 for bucket,ref in m['indices'].items():
  idx=ler(ref);p=root/idx['arquivo']['caminho'];assert p.stat().st_size==idx['arquivo']['bytes']
  with p.open('rb')as f:assert hashlib.file_digest(f,'sha256').hexdigest()==idx['arquivo']['sha256']
  with p.open('rb')as f:
   for key,tr in idx['grupos'].items():
    f.seek(tr[0]);b=f.read(tr[1]);assert len(b)==tr[1]and sha(b)==tr[2]and b.endswith(b'\n');x=json.loads(b);assert x['grupo']==key and x['anos']==ANOS;v=np.array(x['valores'],dtype=float);c=np.array(x['condicoes']);d=np.array(x['derivados'],dtype=float);dc=np.array(x['condicoes_derivados']);n=np.array(x['numeradores'],dtype=float);den=np.array(x['denominadores'],dtype=float)
    assert v.shape==c.shape==(13,len(raw))and d.shape==dc.shape==n.shape==den.shape==(13,len(cat['derivados']));assert np.array_equal(np.isfinite(v),np.isin(c,[0,1]));assert np.all(v[c==1]==0);assert np.all(v[np.isfinite(v)]>=0);assert np.array_equal(np.isfinite(d),np.isin(dc,[0,1,16]));assert np.all(d[dc==1]==0)
    for j,i in enumerate(cat['derivados']):
     with np.errstate(invalid='ignore',divide='ignore'):expected=n[:,j]/den[:,j]*i['fator']
     expected[~np.isfinite(n[:,j])|~np.isfinite(den[:,j])|(den[:,j]<=0)]=np.nan;np.testing.assert_allclose(d[:,j],expected,equal_nan=True,rtol=1e-12)
    loc=pos[key];a[:,loc]=v;vs[:,loc]=d;cs[:,loc]=dc;ns[:,loc]=n;ds[:,loc]=den;qs[:,loc]=x['coberturas'];count+=1;bytes_read+=len(b)
    if key in ['BR','GO','5208905','5300108','2605459','5101837','3539509']:cases[key]=x
  print(json.dumps(dict(uf=bucket,territorios=count)),flush=True)
 assert count==5599 and len(groups)==5599
 lookup=correspondencias(g);normal=json.loads((fontes/'normalizados.json').read_bytes());checked=0
 for ref in normal['arquivos']:
  if ref['tipo']!='tipo':continue
  x=pd.read_parquet(fontes/ref['arquivo']);x['cod']=[lookup.get((u,''.join(z for z in __import__('mobilidade_fontes').norm(n)if z.isalnum())))for u,n in zip(x.uf,x.municipio)]
  for col,(id,_)in TIPOS.items():
   expected=x[x.cod.notna()].groupby('cod')[col].sum();y=ANOS.index(ref['ano']);j=raw['mob_'+id]
   for cod,v in expected.items():assert a[y,pos[str(int(cod))],j]==v;checked+=1
   assert a[y,pos['BR'],j]==x[col].sum()
 # Recalcula os agregados relativos a partir dos municípios, sem usar os
 # componentes agregados armazenados nem os totais com localidade ignorada.
 for j,i in enumerate(cat['derivados']):
  for key in ['BR',*[u for _,_,u in g['governos']]]:
   pp=[k for k,t in enumerate(g['municipios'])if key=='BR'or t[2]==key];loc=pos[key]
   for year in i['periodos']:
    y=ANOS.index(year);n=a[y,pp,raw[i['numerador_id']]];d=a[y,pp,raw[i['denominador_id']]];ok=np.isfinite(n)&np.isfinite(d)&(d>0)
    assert ns[y,loc,j]==n[ok].sum()and ds[y,loc,j]==d[ok].sum()and qs[y,loc,j]==ok.sum()
 # O total de causa básica deve reproduzir os dados de Saúde já publicados,
 # elaborados por outro pipeline e sem os novos recortes de sexo/idade/veículo.
 health=fontes/'cotejo_obitos_publicado.parquet'
 if not health.exists():
  r=requests.get('https://finbra-web.luanviniciusbernardelli.workers.dev/dados/gold/saude/obitos.parquet',timeout=120);r.raise_for_status();health.write_bytes(r.content)
 h=pd.read_parquet(health,columns=['ano','municipio','transito']);s=pd.read_parquet(fontes/'sim_normalizado.parquet');z=s.merge(h,left_on=['ano','municipio6'],right_on=['ano','municipio'],how='left',validate='1:1');assert z.transito.notna().all()and(z.mob_obitos==z.transito).all()
 yy=list(range(2013,2025));totais=h[h.ano.isin(yy)].groupby('ano').transito.sum();assert all(a[ANOS.index(y),pos['BR'],raw['mob_obitos']]==v for y,v in totais.items())
 # Fora da cobertura definitiva não há zeros fabricados.
 for id in raw:
  if id.startswith('mob_ob'):assert np.isnan(a[-1,:,raw[id]]).all()
 assert np.isnan(a[:-1,pos['5101837'],raw['mob_obitos']]).all();assert np.isnan(a[:,pos['2605459'],raw['mob_populacao']]).all()
 if 'mob_esp_total'in raw:
  for y in m['especie_anos_ausentes']:
   assert np.isnan(a[ANOS.index(y),:,[raw[id]for id in FROTA_PERFIS]]).all()
  for ids in [[*['mob_ob_rc_'+id for id,_,_ in RACAS],'mob_ob_rc_ign'],[*['mob_ob_loc_'+id for id,_,_ in LOCAIS],'mob_ob_loc_ign'],[*['mob_ob_mes_'+id for id,_ in MESES],'mob_ob_mes_ign'],['mob_ob_trab_sim','mob_ob_trab_nao','mob_ob_trab_ign']]:
   np.testing.assert_allclose(a[:,:,[raw[id]for id in ids]].sum(axis=2),a[:,:,raw['mob_obitos']],equal_nan=True)
  np.testing.assert_allclose(a[:,:,[raw['mob_ob_esc_'+id]for id,_,_ in ESCOLAS]+[raw['mob_ob_esc_ign']]].sum(axis=2),a[:,:,raw['mob_ob_15_mais']],equal_nan=True)
  for j,i in enumerate(cat['derivados']):
   if i['unidade']=='%':assert np.all(vs[:,:,j][np.isfinite(vs[:,:,j])]<=100+1e-10),i['id']
 report=dict(ok=True,territorios=count,originais=len(raw),relativos=len(cat['derivados']),celulas_originais=a.size,celulas_relativas=vs.size,bytes_recortes=bytes_read,max_trecho=m['max_trecho_bytes'],valores_frota_reconferidos=checked,registros_municipais_sim_cotejados=len(z),sim_publicado_sha256=sha(health.read_bytes()),totais_sim={int(k):int(v)for k,v in totais.items()},exemplos={key:{str(y):{id:(None if not np.isfinite(a[ANOS.index(y),pos[key],raw[id]])else float(a[ANOS.index(y),pos[key],raw[id]]))for id in ['mob_frota','mob_obitos','mob_populacao','mob_eletrificados']}for y in [2013,2024,2025]}for key in cases})
 Path(saida).write_bytes(compacto(report));print(json.dumps({k:report[k]for k in ['ok','territorios','originais','relativos','valores_frota_reconferidos','registros_municipais_sim_cotejados']}),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--fontes',type=Path,required=True);p.add_argument('--candidato',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args();auditar(a.fontes,a.candidato,a.saida)
