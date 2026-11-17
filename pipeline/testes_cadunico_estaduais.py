import copy
import unittest
import numpy as np
import pandas as pd

from cadunico_estaduais import tabela_fapespa, juntar_edicoes, normalizar_fjp, QuadroEstadual


def pa():
    return pd.DataFrame([
        [None, None, None], [None, None, None],
        ['Total de famílias inscritas no Cadastro Único para programas sociais', None, None],
        [None, None, None], ['Estado/Município', 2013, 2024], ['Pará', 10, 30],
        ['Santa Isabel do Pará', 10, 10], ['Tomé Açu', '-', 20],
        ['Nota: dados referentes a julho de 2024', None, None],
    ])


def mg():
    return dict(status='success', values=[dict(cd_geocodm='3100104', valores=[
        dict(id_indicador=90, valor=None if y == 2014 else '102.25' if y == 2015 else '0' if y == 2016 else '40.42', edicoes=dict(nome=str(y)))
        for y in range(2014, 2025)])]), dict(status='success', message=[dict(sigla='AS_POPCADUNICO', unidade='%', periodicidade='Anual', descricao='Razão entre população inscrita e população total do município')])


class Estaduais(unittest.TestCase):
    def test_pa_preserva_traco_mes_omitido_e_mes_informado(self):
        d = tabela_fapespa(pa(), [(1506500, 'Santa Izabel do Pará'), (1508001, 'Tomé-Açu')])
        self.assertTrue(d[d.ano == 2013].mes.isna().all())
        self.assertTrue(d[d.ano == 2024].mes.eq(7).all())
        self.assertEqual(d.familias.isna().sum(), 1)
        self.assertEqual(set(d.ano), {2013, 2024})  # sem interpolar anos intermediários

    def test_pa_recusa_alteracao_total_contagem_e_mes(self):
        for coluna, linha, valor in [(1, 5, 11), (2, 7, -1), (2, 7, 20.5), (0, 8, 'julho de 2025')]:
            with self.subTest(coluna=coluna, linha=linha):
                d = pa(); d.iloc[linha, coluna] = valor
                with self.assertRaises(AssertionError): tabela_fapespa(d, [(1506500, 'Santa Izabel do Pará'), (1508001, 'Tomé-Açu')])

    def test_pa_recusa_municipio_inventado(self):
        d = pa(); d.iloc[6, 0] = 'Nome desconhecido'
        with self.assertRaisesRegex(AssertionError, 'Cobertura'): tabela_fapespa(d, [(1506500, 'Santa Izabel do Pará'), (1508001, 'Tomé-Açu')])

    def test_edicoes_sobrepostas_nao_podem_mudar_valor_ou_ausencia(self):
        d = pd.DataFrame([dict(cod_ibge=1508001, ano=2013, familias=np.nan, mes=np.nan)])
        self.assertEqual(len(juntar_edicoes([d, d.copy()])), 1)
        outro = d.copy(); outro.familias = 0.
        with self.assertRaisesRegex(AssertionError, 'divergentes'): juntar_edicoes([d, outro])

    def test_mg_preserva_percentual_zero_e_ausencia_sem_inventar_contagens(self):
        obj, meta = mg(); d = normalizar_fjp(obj, meta, [3100104])
        self.assertTrue(pd.isna(d.iloc[0].percentual_pessoas_fjp))
        self.assertEqual(d.iloc[1].percentual_pessoas_fjp, 102.25)
        self.assertEqual(d.iloc[2].percentual_pessoas_fjp, 0)
        self.assertTrue(d.mes.isna().all())
        self.assertNotIn('pessoas', d)

    def test_mg_recusa_codigo_indicador_universo_duplicata(self):
        for caso in ['indicador', 'universo', 'duplicata', 'municipio']:
            o, m = copy.deepcopy(mg())
            if caso == 'indicador': o['values'][0]['valores'][0]['id_indicador'] = 88
            if caso == 'universo': m['message'][0]['descricao'] = 'Famílias atualizadas de baixa renda'
            if caso == 'duplicata': o['values'][0]['valores'].append(copy.deepcopy(o['values'][0]['valores'][0]))
            if caso == 'municipio': o['values'][0]['cd_geocodm'] = '3500105'
            with self.subTest(caso=caso), self.assertRaises(AssertionError): normalizar_fjp(o, m, [3100104])

    def test_referencias_mg_sao_medianas_brasil_permanece_ausente(self):
        v = np.array([[20., 80., 90., np.nan]])
        n = np.full_like(v, np.nan)
        q = QuadroEstadual(dict(metodo_referencia='mediana'), [2024], v, n, n.copy(), np.array([[0, 0, 0, 2]]))
        r = q.grupo([0, 1, 2]); self.assertEqual(r['v'], [80.]); self.assertEqual(r['q'], [3])
        self.assertEqual(r['n'], [None]); self.assertEqual(r['d'], [None])
        self.assertEqual(q.grupo([0], municipio=True)['r'], [20.])
        self.assertEqual(q.grupo([0, 1, 2, 3]), dict(v=[None], n=[None], d=[None], c=[5], q=[0]))


if __name__ == '__main__': unittest.main()
