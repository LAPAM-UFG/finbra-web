import copy
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from downloads_enxuto import Enxuto,metadado,preparar_stata,validar_selecao


class DownloadsEnxuto(unittest.TestCase):
 def test_recorte_do_dicionario_preserva_lacunas(self):
  d=dict(variavel='x',tabela='painel',nome='Valor',descricao='Valor',unidade='número',tipo='numero',anos_observados=[2008,2012,2013,2015],ano_de=2008,ano_ate=2015)
  result=metadado(d,'x','valor',2013)
  self.assertEqual(result['anos_observados'],[2013,2015]);self.assertEqual(result['ano_de'],2013);self.assertEqual(d['ano_de'],2008)

 def test_selecao_nao_trunca_nomes_nem_aceita_colisoes(self):
  rows=[dict(origem=f'x{i}',variavel=f'x{i}',area='saude') for i in range(200)]
  dictionary=[dict(variavel=r['origem'],tabela='painel') for r in rows];cfg=dict(ano_inicial=2013,variaveis=rows)
  validar_selecao(cfg,dictionary)
  for change in ['nome','duplicado','ano']:
   altered=copy.deepcopy(cfg)
   if change=='nome':altered['variaveis'][0]['variavel']='a'*33
   elif change=='duplicado':altered['variaveis'][0]['variavel']='x1'
   else:altered['ano_inicial']=2012
   with self.assertRaises(ValueError):validar_selecao(altered,dictionary)

 def test_logico_com_nulo_nao_vira_categoria_perdida(self):
  frame=pd.DataFrame({'alerta':pd.Series([True,False,None],dtype=object)})
  dictionary=[dict(variavel='alerta',tipo='logico')]
  df,labels=preparar_stata(frame,dictionary)
  self.assertEqual(df['alerta'].iloc[:2].tolist(),[1.,0.]);self.assertTrue(np.isnan(df['alerta'].iloc[2]));self.assertEqual(labels['alerta'],{0:'Não',1:'Sim'})

 def test_categorias_tem_codigos_estaveis_entre_recortes(self):
  dictionary=[dict(variavel='cond',tipo='texto')]
  full,labels=preparar_stata(pd.DataFrame({'cond':['registrado','protegido',None]}),dictionary)
  subset,other=preparar_stata(pd.DataFrame({'cond':['protegido',None]}),dictionary)
  self.assertEqual(subset['cond'].iloc[0],full['cond'].iloc[1]);self.assertEqual(labels,other);self.assertTrue(subset['cond'].isna().iloc[1])
  with self.assertRaises(ValueError):preparar_stata(pd.DataFrame({'cond':['categoria nova']}),dictionary)

 def test_dta_unicode_zero_e_missing_e_rotulos(self):
  frame=pd.DataFrame({'cod_ibge':pd.Series([5208707,2605459],dtype='int32'),'municipio':['Goiânia','Fernando de Noronha'],'ano':pd.Series([2024,2025],dtype='int16'),'valor':[0.,np.nan],'cond':['registrado',None]})
  dictionary=[dict(variavel=k,nome=k,tipo='texto' if k in ['municipio','cond'] else 'numero') for k in frame]
  data,labels=preparar_stata(frame,dictionary)
  with tempfile.TemporaryDirectory() as temp:
   f=Path(temp)/'teste.dta';data.to_stata(f,write_index=False,version=118,variable_labels={'valor':'Valor — R$ nominais'},value_labels=labels)
   result=pd.read_stata(f,convert_categoricals=False)
   self.assertEqual(result['municipio'].tolist(),frame['municipio'].tolist());self.assertEqual(result['valor'].iloc[0],0.);self.assertTrue(result['valor'].isna().iloc[1])
   self.assertEqual(result['cod_ibge'].tolist(),[5208707,2605459])
   with pd.io.stata.StataReader(f) as reader:self.assertEqual(reader.variable_labels()['valor'],'Valor — R$ nominais')

 def test_destino_invalido_recusado_antes_de_escrever(self):
  with tempfile.TemporaryDirectory() as tmp:
   source=Path(tmp)/'origem';source.mkdir();(source/'dado').write_bytes(b'original')
   for dest in [source,source/'filha',source.parent]:
    with self.assertRaises(ValueError):Enxuto(source,dest,source)
   self.assertEqual([p.name for p in source.iterdir()],['dado'])


if __name__=='__main__':unittest.main()
