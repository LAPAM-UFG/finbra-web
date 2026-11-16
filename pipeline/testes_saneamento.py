"""Casos pequenos que distinguem conta válida, ausência e mistura de prestadores."""
import tempfile,unittest,json,copy
from unittest.mock import patch
from pathlib import Path
import numpy as np
import pandas as pd
from saneamento import expressao,expressao_disponivel,municipio,celulas,celulas_municipais,aplicar_retificacoes,preencher_condicoes,preparar_provedores,INDICADORES
from assistencia_utils import destino_isolado

def ind(id):return next(i for i in INDICADORES if i['id']==id)

class SaneamentoTest(unittest.TestCase):
 def test_cache_recarrega_componentes_novos_e_reutiliza_mudancas_de_rotulo(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);n=root/'normalizado';w=root/'candidato';n.mkdir();w.mkdir();f=n/'base.parquet'
   pd.DataFrame({'cod_ibge':[5208707],'prestador':['A'],'sistema':['SNIS'],'modulo':['ae'],'ano':[2013],'folha':['base'],'AG001':[1.],'AG002':[10.]}).to_parquet(f)
   (n/'indice.json').write_text(json.dumps({'arquivos':[str(f)]}),encoding='utf-8')
   config=copy.deepcopy(ind('agua_pop'))
   with patch('saneamento.INDICADORES',[config]):preparar_provedores(n,w)
   config['snis']=['AG002'];config['sinisa']=[]
   with patch('saneamento.INDICADORES',[config]):preparar_provedores(n,w)
   out=w/'snis_ae_2013.parquet';self.assertEqual(pd.read_parquet(out).AG002.iloc[0],10)
   stamp=out.stat().st_mtime_ns;config['nome']='Outro rótulo'
   with patch('saneamento.INDICADORES',[config]):preparar_provedores(n,w)
   self.assertEqual(out.stat().st_mtime_ns,stamp)
 def test_proporcao_do_estoque_nao_se_confunde_com_indice_oficial_de_dois_anos(self):
  c=celulas(pd.DataFrame({'GTA0003':[100],'GTA0004':[50],'IAG1003':[40],'provedores':[1]}),ind('agua_hidrometro_pct'),'SINISA');self.assertEqual(c.valor.iloc[0],50);self.assertEqual(c.condicao.iloc[0],0)
 def test_calendario_usa_campos_do_formulario_e_preserva_alternativas(self):
  self.assertTrue(expressao_disponivel('GE12A|POP_TOT',{'POP_TOT'}))
  self.assertFalse(expressao_disponivel('GTA0008+GTA0015',{'GTA0008'}))
  self.assertTrue(expressao_disponivel('GTA0004',{'GTA0004'}))
 def test_residente_rural_nao_mistura_populacoes_de_prestadores_distintos(self):
  f=pd.DataFrame({'cod_ibge':[5208707,5208707],'prestador':['A','B'],'AG001':[100,70],'AG026':[80,40],'GE12A':[250,200],'GE06A':[160,100]})
  c=celulas_municipais(f,municipio(f),ind('agua_rural_pct'),'SNIS');self.assertEqual(c.valor.iloc[0],50)
 def test_rural_usa_o_mesmo_prestador_sem_duplicar_populacao(self):
  f=pd.DataFrame({'cod_ibge':[5208707,5208707],'prestador':['A','B'],'AG001':[100,70],'AG026':[80,40],'GE12A':[200,200],'GE06A':[100,100]})
  c=celulas_municipais(f,municipio(f),ind('agua_rural_pct'),'SNIS');self.assertEqual(c.valor.iloc[0],50)
  f.loc[1,'AG026']=np.nan;c=celulas_municipais(f,municipio(f),ind('agua_rural_pop'),'SNIS');self.assertTrue(c.valor.isna().all());self.assertEqual(c.condicao.iloc[0],1)
 def test_hidrometros_nao_misturam_componentes_entre_prestadores(self):
  f=pd.DataFrame({'cod_ibge':[5208707,5208707],'prestador':['A','B'],'AG004':[np.nan,25],'AG002':[50,np.nan]})
  c=celulas_municipais(f,municipio(f),ind('agua_hidrometro_pct'),'SNIS');self.assertTrue(c.valor.isna().all())
 def test_agregado_nao_esconde_ligacoes_micromedidas_maiores_que_ativas(self):
  f=pd.DataFrame({'cod_ibge':[5208707,5208707],'prestador':['A','B'],'AG004':[160,30],'AG002':[100,400]})
  c=celulas_municipais(f,municipio(f),ind('agua_hidrometro_pct'),'SNIS');self.assertTrue(c.valor.isna().all());self.assertEqual(c.condicao.iloc[0],4)
 def test_zero_de_hidrometros_e_dado_valido(self):
  c=celulas(pd.DataFrame({'GTA0004':[0],'GTA0003':[10]}),ind('agua_hidrometro_pct'),'SINISA');self.assertEqual(c.valor.iloc[0],0);self.assertEqual(c.condicao.iloc[0],0)
 def test_unidades_de_agua_incluem_urbano_e_rural(self):
  c=celulas(pd.DataFrame({'GTA0008':[80],'GTA0015':[20],'GTA0009':[60],'GTA0016':[10]}),ind('agua_economias'),'SINISA');self.assertEqual(c.valor.iloc[0],100)
 def test_faturamento_e_volume_nao_dinheiro(self):
  c=celulas(pd.DataFrame({'GTA1221':[2.5]}),ind('agua_faturada_m3'),'SINISA');self.assertEqual(c.valor.iloc[0],2500);self.assertEqual(ind('agua_faturada_m3')['unidade'],'m3_ano')
 def test_eventos_anuais_nao_sao_acumulados_em_cinco_anos(self):
  c=celulas(pd.DataFrame({'RI028':[500],'RI029':[20]}),ind('desalojados_s2id'),'SNIS');self.assertEqual(c.valor.iloc[0],20)
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
