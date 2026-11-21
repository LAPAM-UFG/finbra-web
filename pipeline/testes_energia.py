import unittest,tempfile,subprocess,sys
from pathlib import Path
import pandas as pd
from energia_fontes import normalizar_datas,deduplicar_usinas

class EnergiaTest(unittest.TestCase):
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
