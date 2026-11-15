import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from downloads_navegacao import Navegacao,escalar,previa


class NavegacaoTest(unittest.TestCase):
 def test_zero_false_e_ausente_nao_se_confundem(self):
  self.assertIs(escalar(np.bool_(False)),False)
  self.assertEqual(escalar(np.int64(0)),0)
  self.assertIsNone(escalar(np.nan));self.assertIsNone(escalar(pd.NA))
  self.assertEqual(escalar('Goiânia'),'Goiânia')

 def test_amostra_preserva_lacunas_e_cobertura_com_zero(self):
  frame=pd.DataFrame(dict(cod_ibge=[5208707]*3,municipio=['Goiânia']*3,uf=['GO']*3,regiao=['Centro-Oeste']*3,tipo_territorio=['município']*3,ano=[2013,2020,2025],valor=[0.,2.,None]))
  dictionary=[dict(variavel=k,nome=k,unidade='número') for k in frame]
  result=previa(frame,dictionary,dict(id='painel_saude_go_parquet',uf='GO',area='saude'))
  col=result['colunas'][-1]
  self.assertEqual(col['anos'],[2013,2020]);self.assertEqual(col['preenchidas'],2)
  self.assertEqual([row['ano'] for row in result['amostra']],[2013,2020,2025])
  self.assertEqual(result['amostra'][0]['valor'],0.);self.assertIsNone(result['amostra'][-1]['valor'])

 def test_destino_invalido_nao_cria_arquivos(self):
  with tempfile.TemporaryDirectory() as temp:
   src=Path(temp)/'source';src.mkdir();(src/'original').write_text('preservar')
   for dest in [src,src/'filho',src.parent]:
    with self.assertRaises(ValueError):Navegacao(src,dest,src)
   self.assertEqual([p.name for p in src.iterdir()],['original'])


if __name__=='__main__':unittest.main()
