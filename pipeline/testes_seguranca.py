import tempfile,unittest
from pathlib import Path
import numpy as np,pandas as pd,duckdb
from seguranca import taxa,trienio,destino_seguro
from seguranca_sinesp import anual,valores_evento
from seguranca_sim import agrupar,validar_particoes
from comparacoes_base import Quadro

class SegurancaTest(unittest.TestCase):
 def test_meios_de_agressao_formam_particao_sem_somar_suicidio(self):
  codes=['X93','X94','X95','X99','Y00','X91','Y04','Y09','X85','Y08','X70','V01']
  x=pd.DataFrame(dict(cid=codes,cid4=[c+'0'for c in codes],SEXO='1',idade_anos=30,RACACOR='4',ESC='4',LOCOCOR='1',mes_obito=1,ano=2024,municipio6=520890,uf_codigo=52))
  with duckdb.connect()as c:c.register('ob',x);z=agrupar(c)
  validar_particoes(z);r=z.iloc[0]
  for k,v in {'sec_agressoes':10,'sec_ag_armas':3,'sec_ag_meio_cortante':1,'sec_ag_meio_contundente':1,'sec_ag_meio_sufocacao':1,'sec_ag_meio_forca':1,'sec_ag_meio_nao_espec':1,'sec_ag_meio_outros':2}.items():self.assertEqual(r[k],v,k)
 def test_perfil_suicidio_conserva_ignorados_e_limite_de_idade(self):
  x=pd.DataFrame(dict(cid=['X84']*3,cid4=['X840']*3,SEXO=['2','1','9'],idade_anos=[14,15,None],RACACOR=['1','4',None],ESC=['4','9','1'],LOCOCOR=['1','3',None],mes_obito=[1,12,None],ano=2024,municipio6=520890,uf_codigo=52))
  with duckdb.connect()as c:c.register('ob',x);z=agrupar(c)
  validar_particoes(z);r=z.iloc[0]
  for k,v in {'sec_suicidios':3,'sec_su_15_mais':1,'sec_su_esc_ign':1,'sec_su_rc_ign':1,'sec_su_loc_domicilio':1,'sec_su_mes_ign':1}.items():self.assertEqual(r[k],v,k)
 def test_mandados_usam_ocorrencias_e_preservam_nulo(self):
  x=pd.DataFrame(dict(evento=['Mandado de prisão cumprido','Mandado de prisão cumprido','Homicídio doloso'],total=[7.,None,0.],total_vitima=[0.,0.,3.]))
  v=valores_evento(x);self.assertEqual(v.iloc[0],7);self.assertTrue(pd.isna(v.iloc[1]));self.assertEqual(v.iloc[2],3)
 def test_fontes_mes_e_universos_distintos(self):
  rows=[('X93','X930','1',20,'4','4','1',1),('X84','X840','2',None,None,'9',None,0),('W32','W320','9',0,'1','1','4',12),('Y35','Y350','1',40,'2','2','4',2),('V01','V010','2',10,'5','1','1',3),('Y10','Y100','9',None,None,None,None,2)]
  x=pd.DataFrame(rows,columns=['cid','cid4','SEXO','idade_anos','RACACOR','ESC','LOCOCOR','mes_obito']);x['ano']=2024;x['municipio6']=520890;x['uf_codigo']=52
  with duckdb.connect()as c:c.register('ob',x);z=agrupar(c)
  validar_particoes(z);r=z.iloc[0]
  for id,v in {'sec_agressoes':1,'sec_suicidios':1,'sec_armas_fogo':3,'sec_intervencao':1,'sec_indeterminada':1,'sec_ag_rc_parda':1,'sec_ag_esc_8_11':1,'sec_ag_mes_jan':1,'sec_su_id_ign':1}.items():self.assertEqual(r[id],v,id)
 def test_zeros_parciais_e_nao_informados_nao_entram_em_taxas(self):
  n=np.array([0.,0.,2.,np.nan,3.,4.]);d=np.array([100.,100.,100.,100.,np.nan,0.]);v,c=taxa(n,d,np.array([1,23,11,2,0,0]),np.array([0]*6),100000)
  self.assertEqual(v[0],0);self.assertTrue(np.isnan(v[1:]).all());self.assertEqual(c.tolist(),[1,23,24,2,3,4])
 def test_trienio_exige_tres_anos_validos(self):
  v,c=trienio(np.array([[1.,2.],[2.,0.],[3.,4.],[4.,5.]]),np.array([[0,0],[0,23],[0,0],[0,0]]));self.assertEqual(v[2,0],6);self.assertEqual(v[3,0],9);self.assertTrue(np.isnan(v[:2]).all());self.assertTrue(np.isnan(v[:,1]).all());self.assertEqual(c[0,0],5)
 def test_media_anual_trienal_e_razao_das_somas(self):
  n=np.array([[3.,9.,5.]]);d=np.array([[300.,900.,np.nan]]);v,c=taxa(n,d,np.array([[0,0,0]]),np.array([[0,0,2]]),100000);q=Quadro(dict(nome='Triênio',nome_en='Three-year',unidade='por 100 mil',metodo_referencia='razao',fator=100000),[2024],v,n,d,c);r=q.grupo([0,1,2]);self.assertEqual(r['v'],[1000.]);self.assertEqual(r['n'],[12.]);self.assertEqual(r['d'],[1200.]);self.assertEqual(r['q'],[2]);self.assertEqual(r['c'],[16])
 def test_linhas_complementares_nao_apagam_nulo_nem_inventam_mes(self):
  x=pd.DataFrame(dict(uf=['GO']*4,municipio=['Goiás']*4,id=['homicidio']*4,data_referencia=pd.to_datetime(['2024-01-01','2024-01-01','2024-02-01','2024-03-01']),total_vitima=[1.,2.,None,0.]))
  a,m=anual(x);self.assertEqual(a.iloc[0].valor,3);self.assertEqual(a.iloc[0].meses,2);self.assertEqual(a.iloc[0].condicao,11);self.assertTrue(pd.isna(m.loc[m.mes.eq(2),'valor'].iloc[0]))
 def test_doze_meses_validos_admitem_zero_municipal(self):
  x=pd.DataFrame(dict(uf=['GO']*12,municipio=['Goiás']*12,id=['homicidio']*12,data_referencia=pd.date_range('2024-01-01',periods=12,freq='MS'),total_vitima=[0.]*12));a,_=anual(x);self.assertEqual(a.iloc[0].meses,12);self.assertEqual(a.iloc[0].valor,0);self.assertEqual(a.iloc[0].condicao,1)
 def test_protecao_de_destino_antes_de_escrita(self):
  with tempfile.TemporaryDirectory()as td:
   root=Path(td);src=root/'origem';src.mkdir();(src/'prova').write_bytes(b'original')
   for dest in [src,src/'sub',root,src/'..']:
    with self.assertRaises(ValueError):destino_seguro(src,dest)
   out=root/'candidato';self.assertEqual(destino_seguro(src,out)[1],out.resolve());self.assertFalse(out.exists());self.assertEqual(list(src.iterdir()),[src/'prova']);self.assertEqual((src/'prova').read_bytes(),b'original')
if __name__=='__main__':unittest.main()
