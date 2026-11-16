"""Casos pequenos que distinguem conta válida, ausência e mistura de prestadores."""
import tempfile,unittest,json
from pathlib import Path
import numpy as np
import pandas as pd
from saneamento import expressao,municipio,celulas,celulas_municipais,aplicar_retificacoes,preencher_condicoes,INDICADORES
from assistencia_utils import destino_isolado

def ind(id):return next(i for i in INDICADORES if i['id']==id)

class SaneamentoTest(unittest.TestCase):
 def test_arquivo_largo_nao_confunde_nao_resposta_com_ano_sem_pesquisa(self):
  f=pd.DataFrame({'ano':[2013,2015,2016,2017],'san_ap_cond':[np.nan,np.nan,5,0]})
  out=preencher_condicoes(f,[{'variavel':'san_ap','anos':[2015,2017]}])
  self.assertEqual(out.san_ap_cond.tolist(),[5,1,5,0])
 def test_nulos_nao_sao_zero(self):
  f=pd.DataFrame({'AG001':[0,np.nan,2,2],'GE12A':[10,10,0,np.nan]})
  c=celulas(f,ind('agua_cobertura_pct'),'SNIS')
  self.assertEqual(c.condicao.tolist(),[0,1,3,2]);self.assertEqual(c.valor[0],0);self.assertTrue(c.valor.iloc[1:].isna().all())
 def test_pop_residente_uma_vez(self):
  f=pd.DataFrame({'cod_ibge':[5208707,5208707],'prestador':['A','B'],'AG001':[40,30],'GE12A':[100,100]})
  c=celulas(municipio(f),ind('agua_cobertura_pct'),'SNIS');self.assertEqual(c.valor.iloc[0],70)
 def test_formula_perdas_muda_em_2023(self):
  a=pd.DataFrame({'AG006':[100],'AG018':[0],'AG010':[60],'AG024':[10]})
  b=pd.DataFrame({'GTA1001':[100],'GTA1009':[0],'GTA1207':[10],'GTA1211':[60],'GTA1203':[0]})
  self.assertAlmostEqual(celulas(a,ind('agua_perdas_pct'),'SNIS').valor[0],100/3)
  self.assertEqual(celulas(b,ind('agua_perdas_pct'),'SINISA').valor[0],30)
 def test_nao_combina_componentes_de_prestadores_diferentes(self):
  f=pd.DataFrame({'cod_ibge':[5208707,5208707],'prestador':['A','B'],'AG006':[100,np.nan],'AG018':[0,0],'AG010':[np.nan,50],'AG024':[0,0]})
  c=celulas_municipais(f,municipio(f),ind('agua_perdas_pct'),'SNIS');self.assertTrue(c.valor.isna().all());self.assertNotEqual(c.condicao.iloc[0],0)
 def test_prestadores_completos_pareados(self):
  f=pd.DataFrame({'cod_ibge':[5208707,5208707],'prestador':['A','B'],'AG006':[100,300],'AG018':[0,0],'AG010':[80,150],'AG024':[0,0]})
  c=celulas_municipais(f,municipio(f),ind('agua_perdas_pct'),'SNIS');self.assertEqual(c.valor.iloc[0],42.5)
 def test_populacao_urbana_rural_vence_total_inconsistente(self):
  f=pd.DataFrame({'GTA0001':[4543],'GTA0002':[10963],'GTA0019':[4543],'DFE0001':[17626]})
  self.assertEqual(celulas(f,ind('agua_pop'),'SINISA').valor[0],15506)
  self.assertAlmostEqual(celulas(f,ind('agua_cobertura_pct'),'SINISA').valor[0],87.97,places=2)
 def test_indice_publicado_contraditorio_nao_escolhido_silenciosamente(self):
  f=pd.DataFrame({'IE019':[5.5],'IE017':[6],'IN020':[20],'provedores':[1]})
  c=celulas(f,ind('vias_pavimentadas_pct'),'SNIS');self.assertEqual(c.condicao[0],4);self.assertTrue(c.valor.isna().all())
 def test_aritmetica_restrita(self):
  with self.assertRaises(ValueError):expressao(pd.DataFrame({'A':[1]}),'__import__("os")')
 def test_destino_recusa_sobreposicao_sem_escrever(self):
  with tempfile.TemporaryDirectory() as t:
   base=Path(t)/'origem';base.mkdir();before=list(base.rglob('*'))
   for p in [base,base/'filho',base.parent,base/'x/..']:
    with self.assertRaises(ValueError):destino_isolado(p,base)
   self.assertEqual(before,list(base.rglob('*')))
 def test_retificacao_inclui_resposta_nova_e_nulos(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);p=root/'correcao.parquet'
   pd.DataFrame({'cod_ibge':[3556701],'GTE0001':[7.],'GTE0002':[0.],'DFE0001':[10.]}).to_parquet(p)
   (root/'retificacoes.json').write_text(json.dumps([{'normalizado':str(p),'url':'https://fonte.test'}]))
   f=pd.DataFrame({'cod_ibge':[3170107],'prestador':['MUNICIPAL'],'GTE0001':[10.],'DFE0001':[20.],'IES0001':[50.]})
   out,log=aplicar_retificacoes(f,root);self.assertEqual(len(out),2);self.assertEqual(out.loc[out.cod_ibge.eq(3556701),'DFE0001'].iloc[0],10);self.assertEqual(len(log),1)

if __name__=='__main__':unittest.main()
