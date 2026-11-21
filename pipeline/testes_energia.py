import unittest,tempfile,subprocess,sys
from pathlib import Path
import pandas as pd
from energia_fontes import normalizar_datas,deduplicar_usinas
from energia import participacao_siga,preservar_edicao
from energia_definicoes import definicoes,PERFIS_NOVOS

class EnergiaTest(unittest.TestCase):
 def test_preservar_edicao_confere_valores_e_nao_oculta_divergencia(self):
  import gzip,hashlib,json,numpy as np
  with tempfile.TemporaryDirectory()as t:
   p=Path(t);(p/'gold/energia').mkdir(parents=True)
   def obj(name,data):
    b=data if isinstance(data,bytes)else json.dumps(data).encode();(p/name).write_bytes(b)
    return dict(caminho=name,bytes=len(b),sha256=hashlib.sha256(b).hexdigest())
   cat=obj('cat.gz',gzip.compress(json.dumps(dict(indicadores=[dict(id='old')])).encode()))
   body=json.dumps(dict(grupo='BR',anos=[2026],valores=[[10]],condicoes=[[0]])).encode()+b'\n';series=obj('series.ndjson',body)
   index=obj('indice.json',dict(arquivo=series,grupos={'BR':[0,len(body),hashlib.sha256(body).hexdigest()]}))
   meta=dict(datas={'mmgd':'2026-11-19','siga':'2026-11-21'},anos=[2026],catalogo=cat,indices={'referencias':index});obj('gold/energia/manifesto.json',meta)
   sm=dict(mmgd_data='2026-11-19',siga_data='2026-11-21');a=np.array([[[10+1e-12,4.]]]);c=np.array([[[0,0]]],dtype='int8')
   preservar_edicao(p,sm,[2026],{'old':0,'new':1},{'BR':0},a,c);np.testing.assert_array_equal(a,[[[10,4]]])
   with self.assertRaises(AssertionError):preservar_edicao(p,sm,[2026],{'old':0},{'BR':0},a*2,c)
 def test_participacao_sem_ratear_potencia_compartilhada(self):
  import math
  for n,d,cond in [(0,0,4),(0,float('nan'),2),(float('nan'),100,2)]:
   valor,flag=participacao_siga(n,d);self.assertTrue(math.isnan(valor));self.assertEqual(flag,cond)
  self.assertEqual(participacao_siga(0,100),(0,None))
  self.assertEqual(participacao_siga(80,100),(80,None))
  with self.assertRaises(AssertionError):participacao_siga(101,100)
 def test_perfis_novos_com_definicoes_e_nomes_compativeis_com_stata(self):
  ds=definicoes(dict(ano=2026,mmgd_data='2026-11-19',siga_data='2026-11-21'));di={d['id']:d for d in ds}
  self.assertEqual(len(ds),97)
  for fam,items in PERFIS_NOVOS:
   for k,_,_ in items:
    for unit in ['n','mw']:
     d=di[f'ene_gd_{fam}_{k}_{unit}'];self.assertEqual(d['anos'],[2026]);self.assertIn('MMGD',d['descricao_en'])
  self.assertEqual(di['ene_siga_ren_mw_pct']['unidade'],'%')
  self.assertIn('indefinida',di['ene_siga_ren_mw_pct']['descricao'])
 def test_data_cadastral_nao_substitui_conexao_ausente(self):
  f=pd.DataFrame(dict(CodGeracaoDistribuida=['A','B'],tecnologia=['UFV','UFV'],DatConexao=['1900-01-01','2020-03-04'],DthAtualizaCadastralEmpreend=['2026-11-19','2026-11-19']))
  out=normalizar_datas(f).set_index('CodGeracaoDistribuida');self.assertTrue(pd.isna(out.loc['A','DatConexao']));self.assertEqual(out.loc['B','DatConexao'],pd.Timestamp('2020-03-04'))
 def test_datas_de_tecnologias_distintas_nao_se_misturam(self):
  f=pd.DataFrame(dict(CodGeracaoDistribuida=['A','A'],tecnologia=['UFV','UTE'],DatConexao=['2020-01-01','2021-01-01']))
  self.assertEqual(len(normalizar_datas(f)),2)
  with self.assertRaises(AssertionError):normalizar_datas(f.assign(tecnologia='UFV'))
 def test_duas_outorgas_nao_duplicam_potencia(self):
  f=pd.DataFrame(dict(CodCEG=['A','A'],DscTipoOutorga=['Registro','Autorização'],kw=[100,100],municipio=['X','X']))
  out,n=deduplicar_usinas(f);self.assertEqual(n,1);self.assertEqual(out.kw.sum(),100)
  with self.assertRaises(AssertionError):deduplicar_usinas(f.assign(kw=[100,200]))
 def test_cli_recusa_cache_antes_de_qualquer_escrita_ou_rede(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t);src=p/'fonte';src.mkdir();f=src/'original';f.write_bytes(b'original')
   for out in [src,src/'saida',p]:
    r=subprocess.run([sys.executable,str(Path(__file__).with_name('energia_fontes.py')),'--fontes',str(out),'--cache',str(src)],capture_output=True,text=True,timeout=20)
    self.assertNotEqual(r.returncode,0);self.assertIn('sobrepostos',r.stderr);self.assertEqual(set(p.rglob('*')),{src,f});self.assertEqual(f.read_bytes(),b'original')

if __name__=='__main__':unittest.main()
