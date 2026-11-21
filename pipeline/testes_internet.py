"""Regressões de agregação e ausência do painel Anatel."""
import unittest,tempfile
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from internet import taxa,QuadroMercado,destino_seguro

class InternetTest(unittest.TestCase):
 def test_ausencia_zero_denominador(self):
  n=np.array([[np.nan,0.,2.,2.,np.nan]]);d=np.array([[0.,100.,np.nan,0.,100.]])
  v,c=taxa(n,d,np.array([[2,1,0,0,5]]),100)
  self.assertEqual(c.tolist(),[[2,1,3,4,5]])
  self.assertEqual(v[0,1],0);self.assertTrue(np.isnan(v[0,[0,2,3,4]]).all())
 def test_concentracao_regional_nao_e_media_local(self):
  for tipo,fator,expected in [('lider',100,50),('hhi',10000,5000)]:
   q=QuadroMercado(dict(metodo_referencia='razao',fator=fator),[2026],np.array([[90.,90.]]),np.array([[9.,9.]]),np.array([[10.,10.]]),np.array([[0,0]]))
   q.tipo=tipo;q.mercado={(2026,'GO'):SimpleNamespace(total=20,sem_cnpj=0,lider=10,quadrados=200)}
   self.assertEqual(q.grupo_territorio('GO',[0,1])['v'],[expected])
   q.mercado[(2026,'GO')].sem_cnpj=1
   self.assertEqual(q.grupo_territorio('GO',[0,1])['v'],[None])
 def test_destino_nao_toca_origens(self):
  with tempfile.TemporaryDirectory()as t:
   p=Path(t);src=p/'fonte';src.mkdir();(src/'a').write_bytes(b'original')
   for out in [src,src/'saida',p,src/'..'/'fonte']:
    with self.assertRaises(ValueError):destino_seguro(src,out)
   self.assertEqual(list(src.iterdir()),[src/'a']);self.assertEqual((src/'a').read_bytes(),b'original')
   self.assertEqual(destino_seguro(src,p/'candidato')[1],(p/'candidato').resolve());self.assertFalse((p/'candidato').exists())

if __name__=='__main__':unittest.main()
