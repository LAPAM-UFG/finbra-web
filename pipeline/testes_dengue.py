"""Regressoes da classificacao historica e da ausencia de dados da dengue."""
import tempfile
import unittest
from pathlib import Path
import duckdb
from dengue import fonte_dengue, sql_dengue


class DengueTest(unittest.TestCase):
    def setUp(self):
        self.con = duckdb.connect()
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)

    def tearDown(self):
        self.con.close()
        self.tmp.cleanup()

    def arquivo(self, ano, campos, valores):
        self.con.execute('CREATE OR REPLACE TABLE entrada(' + campos + ')')
        if valores:
            marks = ','.join('?' for _ in valores[0])
            self.con.executemany('INSERT INTO entrada VALUES(' + marks + ')', valores)
        self.con.execute("COPY entrada TO '" + (self.base / f'DENGBR{ano % 100:02}.parquet').as_posix() + "' (FORMAT PARQUET)")

    def agregar(self):
        return self.con.execute(sql_dengue(fonte_dengue(self.con, self.base)) + ' ORDER BY ano,municipio').fetchall()

    def test_windows_exclui_descartado_e_preserva_confirmado_2(self):
        self.arquivo(2006, 'ID_MN_RESI VARCHAR, CON_CLASSI VARCHAR, CON_EVOLUC VARCHAR',
                     [('520870', '2', '1'), ('520870', '3', '2'), ('520870', '5', '2'), ('520870', None, None)])
        self.assertEqual(self.agregar(), [(2006, 520870, 4, 3, 2, 1, 1)])

    def test_online_exclui_descartado_e_classificado_como_chik(self):
        self.arquivo(2024, 'ID_MN_RESI VARCHAR, CLASSI_FIN VARCHAR, EVOLUCAO VARCHAR',
                     [('520870', x, '2') for x in ['10', '11', '12', '5', '13', '8', None]])
        self.assertEqual(self.agregar(), [(2024, 520870, 7, 5, 3, 1, 3)])

    def test_zero_registrado_nao_vira_ausencia(self):
        self.arquivo(2006, 'ID_MN_RESI VARCHAR, CON_CLASSI VARCHAR, CON_EVOLUC VARCHAR', [('520870', '5', '2')])
        self.assertEqual(self.agregar(), [(2006, 520870, 1, 0, 0, 0, 0)])

    def test_uniao_de_schemas_nao_perde_os_anos_antigos(self):
        self.arquivo(2006, 'ID_MN_RESI VARCHAR, CON_CLASSI VARCHAR, CON_EVOLUC VARCHAR', [('520870', '1', '2')])
        self.arquivo(2024, 'ID_MN_RESI VARCHAR, CLASSI_FIN VARCHAR, EVOLUCAO VARCHAR', [('520890', '12', '1')])
        self.assertEqual(self.agregar(), [(2006, 520870, 1, 1, 1, 0, 1), (2024, 520890, 1, 1, 1, 1, 0)])

    def test_sem_coluna_de_classificacao_nao_inventa_provaveis(self):
        self.arquivo(2006, 'ID_MN_RESI VARCHAR', [('520870',)])
        self.assertEqual(self.agregar(), [(2006, 520870, 1, None, None, None, None)])

    def test_sem_coluna_de_evolucao_nao_inventa_obito_zero(self):
        self.arquivo(2006, 'ID_MN_RESI VARCHAR, CON_CLASSI VARCHAR', [('520870', '1')])
        self.assertEqual(self.agregar(), [(2006, 520870, 1, 1, 1, 0, None)])

    def test_coluna_presente_em_outro_ano_nao_transforma_ausencia_em_zero(self):
        self.arquivo(2006, 'ID_MN_RESI VARCHAR, CON_CLASSI VARCHAR', [('520870', '1')])
        self.arquivo(2024, 'ID_MN_RESI VARCHAR, CLASSI_FIN VARCHAR, EVOLUCAO VARCHAR', [('520870', '10', '1')])
        self.assertEqual(self.agregar(), [(2006, 520870, 1, 1, 1, 0, None), (2024, 520870, 1, 1, 1, 0, 0)])

    def test_arquivo_vazio_nao_cria_municipio(self):
        self.arquivo(2006, 'ID_MN_RESI VARCHAR, CON_CLASSI VARCHAR, CON_EVOLUC VARCHAR', [])
        self.assertEqual(self.agregar(), [])

    def test_sem_localizacao_e_preservado_sem_imputar_municipio(self):
        self.arquivo(2024, 'ID_MN_RESI VARCHAR, CLASSI_FIN VARCHAR, EVOLUCAO VARCHAR',
                     [(None, '10', '2'), ('', '5', '1'), ('520870', '10', '1')])
        self.assertEqual(self.agregar(), [(2024, 0, 2, 1, 1, 0, 1), (2024, 520870, 1, 1, 1, 0, 0)])


if __name__ == '__main__':
    unittest.main()
