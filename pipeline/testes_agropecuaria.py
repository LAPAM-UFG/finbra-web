"""Regras materiais: sigilo/zero, unidades, pesos e isolamento do destino."""
import tempfile, unittest
from pathlib import Path
import numpy as np
from agropecuaria import numero, proporcao, QuadroAgro, gerar

class AgropecuariaTest(unittest.TestCase):
 def test_legenda_nao_confunde_zero_ausencia_e_sigilo(self):
  self.assertEqual(numero('-'),(0.,1));self.assertEqual(numero('0'),(0.,1))
  for text,flag in [('..',5),('...',2),('X',20)]:
   n,c=numero(text);self.assertTrue(np.isnan(n));self.assertEqual(c,flag)
  with self.assertRaises(ValueError):numero('-5')

 def test_leite_mil_litros_para_litros_por_vaca(self):
  v,c=proporcao(np.array([1500.]),np.array([1000.]),np.array([0]),np.array([0]),1000)
  self.assertEqual(v[0],1500);self.assertEqual(c[0],0)

 def test_numerador_ausente_precede_denominador_e_zero_nao_define_razao(self):
  v,c=proporcao(np.array([np.nan,0,0,2,2]),np.array([0,0,5,np.nan,4]),np.array([20,1,1,0,0]),np.array([1,1,0,2,0]),100)
  self.assertEqual(c.tolist(),[20,4,1,3,0]);self.assertTrue(np.isnan(v[0]));self.assertEqual(v[2],0);self.assertEqual(v[4],50)

 def test_regiao_usa_componentes_pareados_e_nao_media_de_produtividades(self):
  n=np.array([[100.,900.,999.]]);d=np.array([[1.,9.,np.nan]])
  v,c=proporcao(n,d,np.zeros(n.shape,dtype=int),np.zeros(d.shape,dtype=int),1)
  q=QuadroAgro({'nome':'r','nome_en':'r','unidade':'kg/ha','metodo_referencia':'razao','fator':1},[2025],v,n,d,c);q.oficiais={}
  g=q.grupo_territorio('I:1',[0,1,2]);self.assertEqual(g['v'],[100]);self.assertEqual(g['n'],[1000]);self.assertEqual(g['d'],[10]);self.assertEqual(g['q'],[2]);self.assertEqual(g['c'],[16])

 def test_agregado_oficial_preserva_componentes_e_condicao(self):
  n=np.array([[100.]]);d=np.array([[2.]]);v,c=proporcao(n,d,np.array([[0]]),np.array([[0]]),1)
  q=QuadroAgro({'nome':'r','nome_en':'r','unidade':'x','metodo_referencia':'razao','fator':1},[2025],v,n,d,c)
  q.oficiais={'GO':(np.array([52.]),np.array([104.]),np.array([2.]),np.array([0]))}
  g=q.grupo_territorio('GO',[0]);self.assertEqual(g['v'],[52]);self.assertEqual(g['n'],[104]);self.assertEqual(g['c'],[22])

 def test_destino_sobreposto_recusado_sem_criar_arquivos(self):
  with tempfile.TemporaryDirectory()as temp:
   p=Path(temp);origem=p/'origem';origem.mkdir();(origem/'preservar.txt').write_bytes(b'intacto')
   for destino in [origem,origem/'candidato',p,p/'origem'/'x'/'..']:
    with self.assertRaises(ValueError):gerar(origem,destino)
   self.assertEqual(list(origem.iterdir()),[origem/'preservar.txt']);self.assertEqual((origem/'preservar.txt').read_bytes(),b'intacto')

if __name__=='__main__':unittest.main()
