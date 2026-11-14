"""Testes com fontes sintéticas e diretórios temporários; nenhum dado publicado é escrito."""
import csv
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
import pyarrow.parquet as pq
from assistencia_bpc import agregar
from assistencia_cadunico import celula,geografia,conferir_campos,tem_protecao
from assistencia_utils import destino_isolado

class Protecao(unittest.TestCase):
    def test_destinos_recusados_antes_da_escrita(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);base=root/'origem';base.mkdir();(base/'arquivo').write_text('intacto')
            before=[(str(x.relative_to(root)),x.read_bytes() if x.is_file() else None) for x in root.rglob('*')]
            for dest in [base,base/'gold',base/'x/../gold',root]:
                with self.subTest(dest=dest),self.assertRaises(ValueError):destino_isolado(dest,base)
            self.assertEqual(before,[(str(x.relative_to(root)),x.read_bytes() if x.is_file() else None) for x in root.rglob('*')])
            self.assertEqual(destino_isolado(root/'candidato',base),(root/'candidato').resolve())
            self.assertFalse((root/'candidato').exists())

class Cadastro(unittest.TestCase):
    def test_comentario_nao_prova_protecao(self):
        self.assertFalse(tem_protecao('sum(qtd_familias) /* lgpd v_usar_restricao_lgpd qtd_fam_lgpd */'))
        self.assertTrue(tem_protecao('if(v_usar_restricao_lgpd=1 and sum(x)<qtd_fam_lgpd,-1,sum(x))'))
    def test_zero_nao_e_supressao(self):
        self.assertEqual(celula({'qNum':0,'qText':'0'}),(0,None))
        self.assertEqual(celula({'qNum':-1,'qText':'-1'}),(None,'suprimido'))
        self.assertEqual(celula({'qNum':float('nan'),'qText':''}),(None,'suprimido'))
        self.assertEqual(celula({'qNum':float('nan'),'qText':'-'}),(None,'protegido_ou_ausente'))
        self.assertEqual(celula({'qNum':1234,'qText':'1.234'}),(1234,None))
    def test_campo_inexistente_nao_pode_virar_total_silencioso(self):
        m={'nome':'indigena','qMeasure':{'qDef':"sum({<IN_ANTIGO={'Sim'}>} qtd_familias)"}}
        with self.assertRaises(ValueError):conferir_campos([m],{'DS_FAM_INDIGENA','qtd_familias'})
        m['qMeasure']['qDef']="sum({<DS_FAM_INDIGENA={'Sim'}>} qtd_familias)"
        conferir_campos([m],{'DS_FAM_INDIGENA','qtd_familias'})
    def test_codigo_sete_digitos_e_distrito(self):
        a=geografia(['codigo_ibge7','sigla_uf','nome_municipio'],[{'qText':'2605459'},{'qText':'PE'},{'qText':'Fernando de Noronha'}])
        self.assertEqual(a['grupo'],'2605459');self.assertEqual(a['uf'],'PE')

class Bpc(unittest.TestCase):
    def fixture(self,rows):
        stream=io.StringIO();writer=csv.writer(stream,delimiter=';',lineterminator='\n')
        writer.writerow(['MÊS COMPETÊNCIA','MÊS REFERÊNCIA','UF','CÓDIGO MUNICÍPIO SIAFI','NOME MUNICÍPIO',
                         'NÚMERO BENEFÍCIO','BENEFÍCIO CONCEDIDO JUDICIALMENTE','VALOR PARCELA','CPF BENEFICIÁRIO','NOME BENEFICIÁRIO'])
        for r in rows:writer.writerow([*r,'00000000000','NÃO PUBLICAR'])
        return stream.getvalue().encode('latin1')
    def executar(self,rows):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup);root=Path(self.tmp.name)
        source=root/'fonte.zip'
        with zipfile.ZipFile(source,'w') as z:z.writestr('pagamentos.csv',self.fixture(rows))
        mapa=[{'uf':'SP','siafi':'0001','cod_ibge':3550308,'nome':'São Paulo'},
              {'uf':'SP','siafi':'0002','cod_ibge':3509502,'nome':'Campinas'}]
        quality=agregar(source,202609,root/'candidato',mapa)
        table=pq.read_table(root/'candidato/silver/assistencia/bpc/202609.parquet')
        return {r['grupo']:r for r in table.to_pylist()},quality,table
    def test_distintos_retroativos_totais_e_privacidade(self):
        rows,q,table=self.executar([
          [202609,202609,'SP','0001','São Paulo','A','SIM','700,00'],
          [202609,202608,'SP','0001','São Paulo','A','SIM','300,00'],
          [202609,202609,'SP','0001','São Paulo','B','','1.100,50'],
          [202609,202609,'SP','0002','Campinas','A','SIM','100,00'],
          [202609,202609,'SP','0002','Campinas','C','NÃO','2.000,00']])
        self.assertEqual(rows['BR']['beneficios'],3)
        self.assertEqual(rows['SP']['beneficios'],3)
        self.assertEqual(rows['3550308']['beneficios'],2)
        self.assertEqual(rows['3509502']['beneficios'],2)
        self.assertEqual(rows['BR']['pagamentos'],5)
        self.assertEqual(float(rows['BR']['valor_pago']),4200.5)
        self.assertEqual(rows['BR']['pagamentos_retroativos'],1)
        self.assertEqual(float(rows['BR']['valor_retroativo']),300)
        self.assertEqual(rows['BR']['beneficios_judiciais'],1)
        self.assertEqual(rows['BR']['beneficios_judicial_nao_informado'],1)
        self.assertFalse(any('cpf' in col.lower() or 'nis' in col.lower() or col=='nb' for col in table.column_names))
        self.assertNotIn('NÃO PUBLICAR',json.dumps(table.to_pylist(),default=str))
        self.assertEqual(q['stats']['linhas_sem_mapa'],0)
    def test_faltante_nao_vira_zero_e_territorio_sem_mapa_nao_some(self):
        rows,q,_=self.executar([
          [202609,202609,'SP','0001','São Paulo','A','','0,00'],
          [202609,202609,'SP','9999','Não mapeado','','','']])
        self.assertIsNone(rows['BR']['beneficios']);self.assertIsNone(rows['BR']['valor_pago'])
        self.assertIsNone(rows['BR']['beneficios_judiciais'])
        self.assertEqual(rows['BR']['pagamentos'],2);self.assertEqual(q['stats']['linhas_sem_mapa'],1)
        self.assertEqual(rows['3550308']['valor_pago'],0)
        self.assertEqual(rows['3550308']['valor_retroativo'],0)
        self.assertIsNone(rows['3550308']['valor_judicial'])

if __name__=='__main__':unittest.main()
