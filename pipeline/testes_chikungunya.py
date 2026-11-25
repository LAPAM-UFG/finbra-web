"""Regras epidemiológicas: transição das fichas, pendências e zero registrado."""
import unittest
import contextlib
import io
import tempfile
from pathlib import Path
from unittest.mock import patch

import duckdb

from chikungunya import sql_chikungunya


class ChikungunyaTest(unittest.TestCase):
    def setUp(self):
        self.con = duckdb.connect()
        self.con.execute('CREATE TABLE registros(ano INTEGER,municipio INTEGER,CLASSI_FIN VARCHAR)')

    def tearDown(self):
        self.con.close()

    def agregar(self, ano, classes):
        self.con.executemany('INSERT INTO registros VALUES(?,520870,?)', [(ano, c) for c in classes])
        row = self.con.execute(sql_chikungunya('SELECT * FROM registros')).fetchone()
        return row[2:]

    def test_ficha_antiga_exclui_descartados_e_inclui_pendentes(self):
        self.assertEqual(self.agregar(2014, ['1', '2', '8', None]), (4, 1, 3, 1))

    def test_transicao_mistura_codigos_das_duas_fichas(self):
        self.assertEqual(self.agregar(2016, ['1', '13', '2', '5', None]), (5, 2, 3, 2))

    def test_codigo_antigo_residual_nao_vira_caso_provavel(self):
        self.assertEqual(self.agregar(2022, ['1', '13', '2', '5']), (4, 2, 2, 2))

    def test_apenas_descartados_produz_zero_real(self):
        self.assertEqual(self.agregar(2024, ['2', '5']), (2, 0, 0, 2))

    def test_branco_e_inconclusivo_nao_sao_confirmados(self):
        self.assertEqual(self.agregar(2024, [None, '', '8']), (3, 0, 3, 0))

    def test_somente_espacos_sao_normalizados(self):
        self.assertEqual(self.agregar(2024, [' 13 ', ' 5 ']), (2, 1, 1, 1))

    def test_ausencia_de_notificacao_nao_cria_linha_zero(self):
        self.assertEqual(self.con.execute(sql_chikungunya('SELECT * FROM registros')).fetchall(), [])

    def test_pipeline_preserva_sem_localizacao_dos_dois_agravos_sem_duplicar(self):
        import saude
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);base=root/'SINAN/DADOS/FINAIS';base.mkdir(parents=True)
            sources={
                'CHIKBR24':"SELECT * FROM (VALUES (NULL,'13'),('','5'),('520870','13')) t(ID_MN_RESI,CLASSI_FIN)",
                'DENGBR24':"SELECT * FROM (VALUES (NULL,'10','2'),('520870','10','1')) t(ID_MN_RESI,CLASSI_FIN,EVOLUCAO)",
                'TUBEBR24':"SELECT '' ID_MN_RESI,'' TRATAMENTO,'' DT_DIAG WHERE false",
                'HANSBR24':"SELECT '' ID_MN_RESI,'' MODOENTR WHERE false",
                'VIOLBR24':"SELECT '' ID_MN_RESI WHERE false",
            }
            for name,sql in sources.items():self.con.execute('COPY ('+sql+") TO '"+(base/(name+'.parquet')).as_posix()+"' (FORMAT parquet)")
            out=root/'saida';out.mkdir()
            with patch.object(saude,'GOLD_S',out),contextlib.redirect_stdout(io.StringIO()):saude.sinan(self.con,root)
            self.assertEqual(self.con.execute('SELECT municipio,uf,sinan_dengue_provaveis,sinan_chik_notificacoes,sinan_chik_provaveis FROM sinan ORDER BY municipio').fetchall(),[(0,0,1,2,1),(520870,52,1,1,1)])

    def test_pipeline_preserva_zero_em_ano_so_com_descartados_e_ausencia_noutros_recortes(self):
        import saude
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);base=root/'SINAN/DADOS/FINAIS';base.mkdir(parents=True)
            sources={
                'CHIKBR14':"SELECT * FROM (VALUES ('520870','1'),('520870','2'),('520870',NULL)) t(ID_MN_RESI,CLASSI_FIN)",
                'CHIKBR24':"SELECT '520870' ID_MN_RESI,'5' CLASSI_FIN",
                'DENGBR13':"SELECT '520890' ID_MN_RESI,'10' CLASSI_FIN,'1' EVOLUCAO",
                'DENGBR24':"SELECT '520890' ID_MN_RESI,'10' CLASSI_FIN,'1' EVOLUCAO",
                'TUBEBR24':"SELECT '' ID_MN_RESI,'' TRATAMENTO,'' DT_DIAG WHERE false",
                'HANSBR24':"SELECT '' ID_MN_RESI,'' MODOENTR WHERE false",
                'VIOLBR24':"SELECT '' ID_MN_RESI WHERE false",
            }
            for name,sql in sources.items():self.con.execute('COPY ('+sql+") TO '"+(base/(name+'.parquet')).as_posix()+"' (FORMAT parquet)")
            out=root/'saida';out.mkdir()
            with patch.object(saude,'GOLD_S',out),contextlib.redirect_stdout(io.StringIO()):saude.sinan(self.con,root)
            rows=self.con.execute('SELECT ano,municipio,sinan_chik_notificacoes,sinan_chik_confirmados,sinan_chik_provaveis,sinan_chik_descartados FROM sinan ORDER BY ano,municipio').fetchall()
            self.assertEqual(rows,[(2013,520890,None,None,None,None),(2014,520870,3,1,2,1),(2024,520870,1,0,0,1),(2024,520890,None,None,None,None)])
            self.assertTrue((out/'sinan.parquet').is_file())


if __name__ == '__main__':
    unittest.main()
