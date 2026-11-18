"""Conferência independente dos recortes e de uma amostra nova na API oficial."""
import argparse,gzip,hashlib,json,math
from pathlib import Path
import numpy as np,requests
from agropecuaria_fontes import TABELAS,compacto,sha

def auditar(candidato,saida):
 root=Path(candidato);m=json.loads((root/'gold/agropecuaria/manifesto.json').read_bytes())
 def ler(ref):
  b=(root/ref['caminho']).read_bytes();assert len(b)==ref['bytes']and sha(b)==ref['sha256']
  if ref['caminho'].endswith('.gz'):
   b=gzip.decompress(b);assert len(b)==ref['json_bytes']and sha(b)==ref['json_sha256']
  return json.loads(b)
 cat=ler(m['catalogo']);geo=ler(m['geografia']);ids={(i['tabela'],i['categoria'],i['variavel_sidra']):j for j,i in enumerate(cat['indicadores'])}
 by_id={i['id']:i for i in cat['indicadores']};assert by_id['ag_tosq_0_qtd']['unidade']=='Cabeças';assert by_id['ag_sil_3457_qtd']['unidade']=='Metros cúbicos';assert by_id['ag_flo_0_area']['unidade']=='Hectares'
 assert by_id['ag_pam_40092_qtd']['unidade']=='Mil frutos'
 assert by_id['ag_pam_40145_qtd']['unidade']=='Mil frutos'
 assert by_id['ag_pam_40092_rend']['unidade']=='Frutos por Hectare'
 assert by_id['ag_ani_2682_qtd']['unidade']=='Mil litros'
 assert by_id['ag_ani_2685_qtd']['unidade']=='Mil dúzias'
 assert by_id['ag_aqua_79366_qtd']['unidade']=='Quilogramas'
 assert by_id['ag_aqua_32886_qtd']['unidade']=='Milheiros'
 novos=[str(r[0])for r in geo['municipios']if r[1]=='Boa Esperança do Norte'];samples=['5208905','5208707','3548807','5300108',*novos,'GO','DF','BR'];data={};count=cells=0;total_bytes=0
 for ref in m['indices'].values():
  index=ler(ref);file=root/index['arquivo']['caminho'];assert file.stat().st_size==index['arquivo']['bytes']
  with file.open('rb')as f:assert hashlib.file_digest(f,'sha256').hexdigest()==index['arquivo']['sha256']
  with file.open('rb')as f:
   for key,(offset,size,h)in index['grupos'].items():
    f.seek(offset);b=f.read(size);assert sha(b)==h and b.endswith(b'\n');g=json.loads(b)
    assert g['grupo']==key and g['anos']==cat['anos'];v=np.array(g['valores'],dtype=float);c=np.array(g['condicoes'])
    assert v.shape==c.shape==(13,len(cat['indicadores']))
    finite=np.isfinite(v);assert np.array_equal(finite,np.isin(c,[0,1]));assert np.all(v[finite]>=0);assert np.all(v[c==1]==0)
    if cat.get('derivados'):
     dv=np.array(g['derivados'],dtype=float);dc=np.array(g['condicoes_derivados']);assert dv.shape==dc.shape==(13,len(cat['derivados']))
     assert np.array_equal(np.isfinite(dv),np.isin(dc,[0,1]));assert np.all(dv[dc==1]==0)
     for j,definition in enumerate(cat['derivados']):
      nj=next(k for k,i in enumerate(cat['indicadores'])if i['id']==definition['numerador_id']);dj=next(k for k,i in enumerate(cat['indicadores'])if i['id']==definition['denominador_id'])
      with np.errstate(invalid='ignore',divide='ignore'):expected=v[:,nj]/v[:,dj]*definition['fator']
      expected[~np.isfinite(v[:,nj])|~np.isfinite(v[:,dj])|(v[:,dj]<=0)]=np.nan
      np.testing.assert_allclose(dv[:,j],expected,rtol=1e-12,equal_nan=True)
    if key in samples:data[key]=g
    count+=1;cells+=v.size;total_bytes+=len(b)
 assert count==5599 and len(data)==len(samples)
 # Nova consulta oficial: todas as medidas e todos os anos de oito recortes.
 mc=[k for k in samples if len(k)==7];local='N6['+','.join(mc)+']|N3[52,53]|N1[1]';verified=0;fresh=[]
 for tab,(cl,variables)in TABELAS.items():
  params={'localidades':local}
  if cl:params['classificacao']=cl+'[all]'
  r=requests.get('https://servicodados.ibge.gov.br/api/v3/agregados/'+tab+'/periodos/2013-2025/variaveis/'+'|'.join(variables),params=params,timeout=120);r.raise_for_status()
  fresh.append(dict(tabela=tab,url=r.url,sha256=sha(r.content),bytes=len(r.content)))
  for var in r.json():
   for result in var['resultados']:
    category=next(iter(result['classificacoes'][0]['categoria']))if result['classificacoes']else'0'
    j=ids.get((tab,category,str(var['id'])))
    if j is None:continue
    for obs in result['series']:
     loc=obs['localidade'];key=loc['id']if loc['nivel']['id']=='N6'else'BR'if loc['nivel']['id']=='N1'else{'52':'GO','53':'DF'}[loc['id']]
     for year,text in obs['serie'].items():
      k=cat['anos'].index(int(year));actual=data[key]['valores'][k][j];flag=data[key]['condicoes'][k][j]
      if text in ['..','...','X','']:
       assert actual is None and flag=={'..':5,'...':2,'X':20,'':2}[text],(key,tab,category,var['id'],year,text,actual)
      else:
       expected=0 if text=='-'else float(text)
       if str(var['id'])in ['215','143','145']:expected*=1000
       assert actual==expected and flag==(1 if expected==0 else 0),(key,tab,category,var['id'],year,expected,actual)
      verified+=1
 # O município não retornado não se converteu em município de produção zero.
 assert all(v is None for row in data['3548807']['valores']for v in row)
 report=dict(ok=True,territorios=count,celulas=cells,bytes_recortes=total_bytes,maior_recorte=m['max_trecho_bytes'],calculados=len(cat.get('derivados',[])),celulas_reconsultadas_ibge=verified,amostra=samples,unidades_especiais_conferidas=True,consultas=fresh,
     exemplo_goias_2025={id:data['5208905']['valores'][-1][next(j for j,i in enumerate(cat['indicadores'])if i['id']==id)]for id in ['ag_pam_0_valor','ag_reb_2670_qtd','ag_ani_2682_qtd']})
 Path(saida).write_bytes(compacto(report));print(json.dumps(report),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidato',type=Path,required=True);p.add_argument('--saida',type=Path,required=True);a=p.parse_args();auditar(a.candidato,a.saida)
