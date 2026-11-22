import unittest
import numpy as np,pandas as pd
from comex import calcular_razao,correspondencia_municipal,QuadroComex
from comex_definicoes import definicoes

class ComexTest(unittest.TestCase):
 def test_concentracao_recalculada(self):
  # Dois municípios: A90/B10 e A10/C90. Média HHI municipal é 8.200;
  # a região reúne A100/B10/C90 e tem HHI 4.550.
  municipal=calcular_razao([90**2+10**2]*2,[100]*2,10000,2)[0]
  regional=calcular_razao([100**2+10**2+90**2],[200],10000,2)[0]
  np.testing.assert_allclose(municipal,8200);np.testing.assert_allclose(regional,4550)
  self.assertEqual(calcular_razao([50**2],[50],10000,2)[0][0],10000)
 def test_zero_ausente_e_zero_registrado(self):
  v,c,_=calcular_razao([0,0,np.nan,1],[10,0,10,np.nan],1)
  self.assertEqual(v[0],0);self.assertTrue(np.isnan(v[1:]).all());self.assertEqual(c.tolist(),[1,4,2,3])
  with self.assertRaises(AssertionError):calcular_razao([101],[100],100)
 def test_codigos_mdic_distintos_do_ibge(self):
  mun=[[3550308,'São Paulo','SP','',''],[5208707,'Goiânia','GO','',''],[5001904,'Bataguassu','MS','',''],[3515004,'Embu das Artes','SP','','']]
  table=pd.DataFrame([[3450308,'SAO PAULO','','SP'],[5308707,'GOIANIA','','GO'],[5201904,'BATAGUASSU','','MS'],[3415004,'EMBU','','SP'],[9999999,'NAO DECLARADO','','ND']],columns=['CO_MUN_GEO','NO_MUN','NO_MUN_MIN','SG_UF'])
  x,a=correspondencia_municipal(table,mun);self.assertEqual(list(x.values()),[3550308,5208707,5001904,3515004]);self.assertEqual(len(a),4)
  table.loc[0,'NO_MUN']='NOME DESCONHECIDO'
  with self.assertRaises(ValueError):correspondencia_municipal(table,mun)
 def test_periodos_sinais_e_limite_stata(self):
  d=definicoes(dict(ano=2026,mes=10,periodos={str(y):10 if y==2026 else 12 for y in range(2013,2027)}));self.assertEqual(len(d),63)
  self.assertEqual({x['id']for x in d if x['com_sinal']},{'cex_saldo_fob','cex_saldo_fob_c','cex_exp_var_pct','cex_imp_var_pct'})
  x={x['id']:x for x in d};self.assertIn('dezembro',x['cex_exp_fob']['notas_anos']['2025'][0]);self.assertIn('outubro',x['cex_exp_fob_c']['notas_anos']['2025'][0]);self.assertNotIn(2013,x['cex_exp_var_pct']['anos']);self.assertTrue(all(len(v+'_cond')<=32 for v in x))
 def test_referencia_identifica_cobertura_municipal_incompleta(self):
  q=QuadroComex.__new__(QuadroComex);q.periodos=[2026];q.base=pd.DataFrame({'valor':[50.],'cex_populacao':[20.]},index=pd.MultiIndex.from_tuples([('BR',2026)]));q.ncol='valor';q.dcol='cex_populacao';q.power=1;q.pop=np.array([[10.,10.]]);q.cobertos=np.array([True,False]);q.definicao={'fator':1}
  r=q.grupo_territorio('BR',[0,1]);self.assertEqual(r['v'],[2.5]);self.assertEqual(r['q'],[1]);self.assertEqual(r['c'],[16])

if __name__=='__main__':unittest.main()
