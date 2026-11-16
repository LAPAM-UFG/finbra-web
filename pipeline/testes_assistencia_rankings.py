"""Empates exatos, precisão, cobertura, recortes e isolamento dos rankings."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from assistencia_economia import gerar as anual, sha
from assistencia_economia_rankings import gerar, ordenar
from testes_assistencia_economia import Economia


class Rankings(unittest.TestCase):
    def test_empates_exatos_zero_e_ordem_estavel(self):
        rows = ordenar([[3333333, 'C', 'GO', 0, 10], [2222222, 'B', 'GO', 2, 6], [1111111, 'A', 'GO', 1, 3], [4444444, 'D', 'DF', 2, 3]])
        self.assertEqual([r[0] for r in rows], [4444444, 1111111, 2222222, 3333333])
        self.assertEqual([r[3] for r in rows], [1, 2, 2, 4])
        self.assertEqual(rows[-1][4], 0)
        self.assertEqual(rows[1][4], rows[2][4])

    def test_percentual_arredondado_nao_produz_empate(self):
        rows = ordenar([[1111111, 'A', 'GO', 1, 100], [2222222, 'B', 'GO', 1, 99.999]])
        self.assertEqual([r[0] for r in rows], [2222222, 1111111])
        self.assertEqual([r[3] for r in rows], [1, 2])
        self.assertEqual(round(rows[0][4], 3), round(rows[1][4], 3))
        # Relações superiores a 100% não são arbitrariamente limitadas.
        self.assertEqual(ordenar([[1111111, 'A', 'GO', 200, 100]])[0][4], 200)

    def test_carga_anual_tambem_gera_rankings_e_recortes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); base, manifest = Economia().fixture(root); out = root / 'anual'
            meta = anual(base, manifest, out)
            idx = json.loads((out / meta['rankings']['pbf']['caminho']).read_bytes())
            bundle = (out / idx['arquivo']['caminho']).read_bytes()
            def ler(ano, uf):
                c = idx['recortes'][f'{ano}:{uf}']; a, n, h = c['trecho']; b = bundle[a:a+n]
                self.assertEqual(hashlib.sha256(b).hexdigest(), h)
                self.assertEqual(sum(c['condicoes']), c['total'])
                return json.loads(b), c
            br, cov = ler(2023, 'BR'); go, _ = ler(2023, 'GO'); df, _ = ler(2023, 'DF')
            self.assertEqual(cov['validos'], 3)
            self.assertEqual([r[0] for r in br['linhas']], [5208707, 5300108, 5218805])
            self.assertEqual(go['linhas'][-1][3], 2)  # No Brasil, Rio Verde é terceiro.
            self.assertEqual(len(df['linhas']), 1)
            self.assertEqual(df['linhas'][0][0], 5300108)
            sem, cov = ler(2024, 'BR')
            self.assertEqual(sem['linhas'], [])
            self.assertEqual(cov['validos'], 0)
            self.assertEqual(cov['condicoes'][1], 3)

    def test_reaproveita_anual_sem_alterar_a_origem(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); base, manifest = Economia().fixture(root); origem = root / 'anual'
            antigo = anual(base, manifest, origem)
            antes = {p.relative_to(origem).as_posix(): sha(p) for p in origem.rglob('*') if p.is_file()}
            with self.assertRaisesRegex(ValueError, 'isolado'):
                gerar(base, manifest, origem, origem / 'novo')
            novo = gerar(base, manifest, origem, root / 'ranking')
            self.assertEqual(novo['parquet'], antigo['parquet'])
            self.assertEqual(novo['arquivo'], antigo['arquivo'])
            self.assertEqual(antes, {p.relative_to(origem).as_posix(): sha(p) for p in origem.rglob('*') if p.is_file()})


if __name__ == '__main__':
    unittest.main()
