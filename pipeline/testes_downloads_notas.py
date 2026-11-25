import unittest
from downloads_notas import notas_da_edicao


class NotasTest(unittest.TestCase):
    def test_atualiza_a_selecao_sem_alterar_medidas_tematicas(self):
        notas=['Base enxuta: 299 variáveis principais, além dos seis identificadores, somente desde 2013.',
               'Educação: 85 indicadores e 8 condições; 43 na seleção principal, que mantém 297 indicadores. Saeb em pontos.',
               'Mobilidade: 142 medidas e 54 relativas. A seleção principal de 297 indicadores e os outros temas permanecem nos mesmos objetos imutáveis.']
        a=notas_da_edicao(notas,300)
        self.assertIn('300 variáveis principais',a[0])
        self.assertIn('mantém 300 indicadores',a[1])
        self.assertIn('85 indicadores e 8 condições; 43',a[1])
        self.assertIn('142 medidas e 54 relativas',a[2])
        self.assertNotIn('mesmos objetos',a[2])
        self.assertIn('2013',a[0])

    def test_preserva_notas_sem_referencia_a_tamanho_da_selecao(self):
        n=['SIM: óbitos de residentes. Não somar os componentes.', 'Energia: 300 variáveis no arquivo temático.']
        self.assertEqual(notas_da_edicao(n,300),n)


if __name__=='__main__':unittest.main()
