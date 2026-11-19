import tempfile,unittest
from pathlib import Path
import numpy as np,pandas as pd
from mobilidade_normalizar import agrupar_idades
from mobilidade_fontes import descobrir
from mobilidade import gerar
from agropecuaria import proporcao
from comparacoes_base import Quadro

class MobilidadeTest(unittest.TestCase):
 def test_idade_usa_fabricacao_e_separa_ausente_e_futuro(self):
  x=pd.DataFrame(dict(uf=['GO']*4,municipio=['X']*4,modelo=[2020]*4,fabricacao=[2010,2000,2030,None],quantidade=[2,3,4,1]));v=agrupar_idades(x,2025,'fabricacao','quantidade').iloc[0]
  self.assertEqual(v.idade_total,10);self.assertEqual(v.idade_validos,5);self.assertEqual(v.idade_anos_soma,105);self.assertEqual(v.idade_anos_soma/v.idade_validos,21);self.assertEqual(v.idade_sem_ano,5);self.assertEqual(v.idade_10_19,2);self.assertEqual(v.idade_20_mais,3)
 def test_descoberta_recusa_fonte_que_nao_seja_dezembro(self):
  a='<p>Frota Nacional (novembro de 2025)</p><a href="x.xls">Frota por Município e Tipo</a>'
  with self.assertRaises(ValueError):descobrir(a,'https://www.gov.br/x',2025)
 def test_descoberta_fixa_tres_cadastros_e_preserva_url(self):
  a='<p>Frota Nacional (dezembro de 2025)</p><a href="tipo.xls">Frota por Município e Tipo</a><p>Quantidade de Veículos por Município (Dezembro de 2025)</p><a href="idade.xlsx">Quantidade de Veículos por UF Município Ano de Fabricação Modelo</a><a href="comb.zip">Quantidade de Veículos por UF Município e Combustível</a>'
  d=descobrir(a,'https://www.gov.br/x/',2025);self.assertEqual(set(d),{'tipo','idade','combustivel'});self.assertEqual(d['idade']['url'],'https://www.gov.br/x/idade.xlsx')
 def test_taxa_zero_registrado_difere_de_populacao_ausente(self):
  v,c=proporcao(np.array([0.,0.,np.nan,2]),np.array([100.,np.nan,100.,0]),np.array([1,1,2,0]),np.array([0,2,0,1]),100000)
  self.assertEqual(c.tolist(),[1,3,2,4]);self.assertEqual(v[0],0);self.assertTrue(np.isnan(v[1:]).all())
 def test_referencia_e_razao_das_somas_de_pares_validos(self):
  n=np.array([[2.,18.,7.]]);d=np.array([[100.,300.,np.nan]]);v,c=proporcao(n,d,np.zeros(n.shape,dtype=int),np.array([[0,0,2]]),100000)
  q=Quadro(dict(nome='Taxa',nome_en='Rate',unidade='por 100 mil',metodo_referencia='razao',fator=100000),[2024],v,n,d,c);r=q.grupo([0,1,2]);self.assertEqual(r['v'],[5000.]);self.assertEqual(r['n'],[20.]);self.assertEqual(r['d'],[400.]);self.assertEqual(r['q'],[2]);self.assertEqual(r['c'],[16])
 def test_destino_sobreposto_recusado_antes_de_ler_ou_escrever(self):
  with tempfile.TemporaryDirectory()as tmp:
   p=Path(tmp);origem=p/'origem';origem.mkdir();f=origem/'preservar';f.write_bytes(b'intacto')
   for destino in [origem,origem/'novo',p,origem/'x'/'..']:
    with self.assertRaises(ValueError):gerar(origem,destino)
   self.assertEqual(list(origem.iterdir()),[f]);self.assertEqual(f.read_bytes(),b'intacto')

if __name__=='__main__':unittest.main()
