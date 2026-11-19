import tempfile,unittest
from pathlib import Path
import numpy as np,pandas as pd
from mobilidade_normalizar import agrupar_idades
from mobilidade_fontes import descobrir
from mobilidade import gerar
from agropecuaria import proporcao
from comparacoes_base import Quadro
from mobilidade_perfis import agrupar_especies
from mobilidade_perfis_fontes import descobrir_especie
from mobilidade_sim import agrupar_sim
import duckdb

class MobilidadeTest(unittest.TestCase):
 def test_especie_e_eixos_nao_corrigem_20_para_2_nem_perdem_quantidades(self):
  x=pd.DataFrame(dict(uf=['GO']*6,municipio=['X']*6,especie=['CARGA','CARGA','PASSAGEIRO','Sem Informação','ESPECIAL','CARGA'],eixos=['2','20','0',None,'-2','3'],quantidade=[10,20,30,40,50,60]));z=agrupar_especies(x).iloc[0]
  self.assertEqual(z.mob_esp_total,210);self.assertEqual(z.mob_esp_carga,90);self.assertEqual(z.mob_esp_sem_classe,40)
  self.assertEqual(z.mob_eix_2,10);self.assertEqual(z.mob_eix_outros,70);self.assertEqual(z.mob_eix_zero,70);self.assertEqual(z.mob_cg_eix_1_9,70);self.assertEqual(z.mob_cg_eix_3_9,60)
 def test_sem_dezembro_nao_substitui_por_agosto(self):
  a='<p>Quantidade de veículos por município (agosto de 2018)</p><a href="agosto.xlsx">Quantidade por UF Município tipo espécie e eixos</a>'
  self.assertIsNone(descobrir_especie(a,'https://www.gov.br/x/',2018))
  b=a+'<p>Quantidade de veículos por município (dezembro de 2018)</p><a href="dezembro.xlsx">Quantidade por UF Município tipo espécie e eixos</a>'
  self.assertEqual(descobrir_especie(b,'https://www.gov.br/x/',2018)['url'],'https://www.gov.br/x/dezembro.xlsx')
 def test_perfis_sim_preservam_ignorados_excluem_menores_da_escolaridade_e_outras_causas(self):
  rows=[(2024,520890,52,'V01','1',17,'1','4','1','1',1),(2024,520890,52,'V29','1',40,None,'0','4','9',12),(2024,520890,52,'V49','2',10,'4','1','6','2',0),(2024,520890,52,'V89','9',None,'8','5',None,None,2),(2024,520890,52,'Y85','1',30,'1','4','1','1',1)]
  x=pd.DataFrame(rows,columns=['ano','municipio6','uf_codigo','cid','SEXO','idade_anos','RACACOR','ESC','LOCOCOR','ACIDTRAB','mes_obito'])
  with duckdb.connect()as c:
   c.register('ob',x);z=agrupar_sim(c).iloc[0]
  expected={'mob_obitos':4,'mob_ob_rc_info':2,'mob_ob_rc_ign':2,'mob_ob_rc_branca':1,'mob_ob_15_mais':2,'mob_ob_esc_8_11':1,'mob_ob_esc_ign':1,'mob_ob_esc_nenhuma':0,'mob_ob_loc_aldeia':1,'mob_ob_loc_ign':1,'mob_ob_mes_jan':1,'mob_ob_mes_fev':1,'mob_ob_mes_dez':1,'mob_ob_mes_ign':1,'mob_ob_trab_sim':1,'mob_ob_trab_nao':1,'mob_ob_trab_ign':2,'mob_ob_trab_info':2}
  for k,v in expected.items():self.assertEqual(z[k],v,k)
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
