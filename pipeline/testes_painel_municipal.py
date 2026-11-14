"""Verifica a junção anual e os arquivos em diretórios temporários, sem tocar nas bases."""
import csv
import tempfile
import unittest
from pathlib import Path
import duckdb
from painel_municipal import Painel,campo,social_mensal_para_anual,contagem_perfil_sql,qs
from assistencia_utils import destino_isolado
from finalizar_downloads import periodos


class PainelMunicipal(unittest.TestCase):
 def setUp(self):
  self.db=duckdb.connect();self.addCleanup(self.db.close)

 def test_csv_tipado_nulo_zero_decimal_e_formula(self):
  p=Painel.__new__(Painel);p.db=self.db
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'dados.csv'
   p.csv("SELECT '0012345' cod_ibge,0 zero,NULL faltante,12.34 valor,'=1+1' texto,'Não' resposta",path)
   self.assertTrue(path.read_bytes().startswith(b'\xef\xbb\xbf'))
   with path.open(encoding='utf-8-sig',newline='') as f:row=next(csv.DictReader(f,delimiter=';'))
   self.assertEqual(row,dict(cod_ibge='0012345',zero='0',faltante='',valor='12,34',texto="'=1+1",resposta='Não'))

 def test_ultimo_mes_nulo_nao_retrocede_e_zero_e_preservado(self):
  self.db.execute("CREATE TABLE mensal(cod_ibge BIGINT,competencia INTEGER,nivel VARCHAR,indicador VARCHAR,valor DOUBLE,condicao VARCHAR)")
  self.db.execute("INSERT INTO mensal VALUES (5208707,202601,'M','familias',15,'registrado'),(5208707,202602,'M','familias',NULL,'protegido_ou_ausente'),(5208707,202601,'M','valor',100,'registrado'),(5208707,202602,'M','valor',0,'zero_registrado'),(52,202602,'UF','familias',500,'registrado')")
  social_mensal_para_anual(self.db,['mensal'])
  familia=self.db.execute("SELECT ultima_competencia,ultimo.valor,ultimo.condicao,meses FROM social_anual WHERE indicador='familias'").fetchone()
  self.assertEqual(familia,(202602,None,'protegido_ou_ausente',1))
  valor=self.db.execute("SELECT ultimo.valor,soma,meses FROM social_anual WHERE indicador='valor'").fetchone()
  self.assertEqual(valor,(0,100,2))
  self.assertEqual(self.db.execute('SELECT count(*) FROM social_anual').fetchone()[0],2)

 def test_csv_largo_mantem_ordem_das_colunas_acima_de_2048(self):
  self.db.execute('SET preserve_insertion_order=false; SET threads=4')
  p=Painel.__new__(Painel);p.db=self.db
  query="SELECT '5208707' cod_ibge,2024 ano,"+','.join(f'{i} v{i}' for i in range(2100))
  with tempfile.TemporaryDirectory() as tmp:
   path=Path(tmp)/'largo.csv';p.csv(query,path)
   with path.open(encoding='utf-8-sig',newline='') as f:header,row=list(csv.reader(f,delimiter=';'))
   self.assertEqual(header,['cod_ibge','ano',*[f'v{i}' for i in range(2100)]])
   self.assertEqual(row,['5208707','2024',*[str(i) for i in range(2100)]])

 def test_chave_duplicada_e_recusada(self):
  p=Painel.__new__(Painel);p.db=self.db;p.origins={};p.cache={};p.dictionary=[];p.tables=[]
  self.db.execute("CREATE TABLE territorios AS SELECT '5208707' cod_ibge")
  with tempfile.TemporaryDirectory() as tmp:
   p.work=Path(tmp)
   with self.assertRaisesRegex(ValueError,'duplicadas'):
    p.tabela('teste','saude',"SELECT * FROM (VALUES ('5208707',2024,1),('5208707',2024,2)) t(cod_ibge,ano,valor)",{'valor':campo('Valor')})

 def test_perfil_nao_tabulado_nao_vira_categoria_zero(self):
  self.db.execute("CREATE TABLE totais AS SELECT * FROM (VALUES ('A',10),('B',0),('C',10)) t(escopo,vinculos)")
  self.db.execute("CREATE TABLE perfis AS SELECT 'C' escopo,'raca_cor' variavel,'1' codigo,10 vinculos")
  sql='SELECT t.escopo,'+contagem_perfil_sql('raca_cor','2')+' n FROM totais t LEFT JOIN perfis p USING(escopo) GROUP BY t.escopo,t.vinculos ORDER BY 1'
  self.assertEqual(self.db.execute(sql).fetchall(),[('A',None),('B',0),('C',0)])

 def test_destinos_sobre_origem_sao_recusados_sem_escrita(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp)/'origem';base.mkdir();(base/'dado').write_bytes(b'original')
   before=list(base.iterdir())
   for target in [base,base/'filha',base.parent,base/'x/../gold']:
    with self.assertRaises(ValueError):destino_isolado(target,base)
   self.assertEqual(list(base.iterdir()),before)
   self.assertEqual((base/'dado').read_bytes(),b'original')

 def test_anos_observados_vem_do_arquivo_entregue_e_preservam_lacunas(self):
  self.db.execute('CREATE TABLE painel AS SELECT 1900 ano,99 valor')
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);path=root/'painel.parquet'
   self.db.execute("COPY (SELECT * FROM (VALUES ('5208707',2021,0,NULL),('5208707',2022,NULL,NULL),('5208707',2024,12,NULL)) t(cod_ibge,ano,valor,ausente)) TO "+qs(path.as_posix())+" (FORMAT PARQUET)")
   entries=[dict(tabela='painel',variavel=k) for k in ['valor','ausente']]
   periodos(self.db,entries,[dict(id='painel_brasil_parquet',formato='parquet',tipo='painel',caminho=path.name)],root)
   self.assertEqual(entries[0]['anos_observados'],[2021,2024])
   self.assertEqual((entries[0]['ano_de'],entries[0]['ano_ate']),(2021,2024))
   self.assertEqual(entries[1]['anos_observados'],[])
   self.assertIsNone(entries[1]['ano_de'])


if __name__=='__main__':unittest.main()
