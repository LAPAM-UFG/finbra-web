"""Regressões de agregação e ausência do painel Anatel."""
import unittest,tempfile,subprocess,sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np
from internet import taxa,QuadroMercado,destino_seguro
from internet_smp_fontes import ZipRemoto

class InternetTest(unittest.TestCase):
 def test_cli_smp_recusa_origem_antes_de_adquirir_ou_criar_arquivos(self):
  with tempfile.TemporaryDirectory()as t:
   base=Path(t);src=base/'fixa';src.mkdir();original=src/'fonte.bin';original.write_bytes(b'original')
   for out in [src,src/'nova',base]:
    p=subprocess.run([sys.executable,str(Path(__file__).with_name('internet_smp_fontes.py')),'--fontes',str(out),'--fixa',str(src)],capture_output=True,text=True,timeout=20)
    self.assertNotEqual(p.returncode,0);self.assertIn('Destinos sobrepostos',p.stderr)
    self.assertEqual(set(base.rglob('*')),{src,original});self.assertEqual(original.read_bytes(),b'original')
 def test_range_ignorado_nao_dispara_download_integral(self):
  class Response:
   status_code=200;headers={}
   def __enter__(self):return self
   def __exit__(self,*args):pass
   @property
   def content(self):raise AssertionError('O corpo integral não pode ser lido')
  z=ZipRemoto.__new__(ZipRemoto);z.url='https://example.invalid/a.zip';z.size=100;z.etag='edicao';z.s=SimpleNamespace(get=lambda *a,**k:Response())
  with self.assertRaises(ValueError):z.trecho(0,20)
  with self.assertRaises(ValueError):z.trecho(90,20)
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
