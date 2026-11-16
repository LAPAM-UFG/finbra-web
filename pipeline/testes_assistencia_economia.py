"""Unidades, cobertura anual, zero, sobreposição territorial e proteção da origem."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from assistencia_economia import anual, razao, gerar, sha


class Economia(unittest.TestCase):
    def test_doze_meses_zero_real_e_ausencia(self):
        rows = [(202300 + m, 0, 'zero_registrado') for m in range(1, 13)]
        self.assertEqual(anual(rows), (0, 12))
        self.assertEqual(razao(0, 12, 1000), (0, 0))
        self.assertEqual(anual(rows[:-1]), (None, 11))
        rows[-1] = (202312, None, 'ausente')
        self.assertEqual(anual(rows), (None, 11))
        rows[-1] = (202312, 10, 'suprimido')
        self.assertEqual(anual(rows), (None, 11))
        with self.assertRaisesRegex(ValueError, 'duplicada'):
            anual(rows + rows[:1])
        with self.assertRaisesRegex(ValueError, 'anos diferentes'):
            anual(rows[:-1] + [(202412, 10, 'registrado')])

    def test_denominadores_e_ano_incompleto(self):
        self.assertEqual(razao(None, 0, 1000), (None, 1))
        self.assertEqual(razao(None, 11, 1000), (None, 2))
        self.assertEqual(razao(100, 12, None), (None, 3))
        self.assertEqual(razao(100, 12, 0), (None, 4))
        self.assertEqual(razao(100, 12, -10), (None, 5))
        self.assertEqual(razao(100, 12, 1000), (10, 0))

    def fixture(self, root):
        base = root / 'base'; (base / 'gold/assistencia').mkdir(parents=True); (base / 'silver').mkdir()
        terras = [dict(grupo='BR', nivel='BR', uf=None, cod_ibge=None, nome='Brasil'),
                  dict(grupo='GO', nivel='UF', uf='GO', cod_ibge=None, nome='Goiás'),
                  dict(grupo='DF', nivel='UF', uf='DF', cod_ibge=None, nome='Distrito Federal'),
                  dict(grupo='5208707', nivel='M', uf='GO', cod_ibge=5208707, nome='Goiânia'),
                  dict(grupo='5218805', nivel='M', uf='GO', cod_ibge=5218805, nome='Rio Verde'),
                  dict(grupo='5300108', nivel='M', uf='DF', cod_ibge=5300108, nome='Brasília')]
        refs = {}
        for fonte, id in [('pbf', 'pbf_cgu_valor'), ('bpc', 'bpc_valor_pago')]:
            rows = []
            for t in terras:
                for m in range(1, 13):
                    rows.append(dict(grupo=t['grupo'], competencia=202300+m, indicador=id, valor=10.0 if fonte == 'pbf' else 20.0, condicao='registrado'))
            # Um valor mensal isolado no ano seguinte nunca vira anual por ×12.
            rows.append(dict(grupo='BR', competencia=202401, indicador=id, valor=1000.0, condicao='registrado'))
            p = base / f'gold/assistencia/{fonte}.parquet'; pq.write_table(pa.Table.from_pylist(rows), p)
            refs[fonte] = dict(caminho=p.relative_to(base).as_posix(), bytes=p.stat().st_size, sha256=sha(p))
        p = base / 'gold/assistencia/territorios.parquet'; pq.write_table(pa.Table.from_pylist(terras), p)
        refs['territorios'] = dict(caminho=p.relative_to(base).as_posix(), bytes=p.stat().st_size, sha256=sha(p))
        pq.write_table(pa.Table.from_pylist([dict(cod_ibge=5208707, exercicio=2023, pib=1000.0), dict(cod_ibge=5218805, exercicio=2023, pib=9000.0), dict(cod_ibge=5300108, exercicio=2023, pib=2000.0)]), base / 'silver/ibge_pib.parquet')
        m = root / 'manifesto.json'; m.write_text(json.dumps(dict(fontes=dict(assistencia=dict(arquivos=refs))))); return base, m

    def test_geracao_nominal_agregados_e_brasilia(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); base, manifest = self.fixture(root); out = root / 'candidato'
            m = gerar(base, manifest, out)
            data = pq.read_table(out / m['parquet']['caminho']).to_pandas()
            goiania = data[(data.cod_ibge == 5208707) & (data.ano == 2023)].iloc[0]
            self.assertEqual(goiania.as_pib, 1000)  # Sem multiplicar por mil de novo.
            self.assertEqual(goiania.as_pbf_pago_ano, 120)
            self.assertEqual(goiania.as_bpc_pago_ano, 240)
            self.assertEqual(goiania.as_total_pib_pct, 36)
            bundle = (out / m['arquivo']['caminho']).read_bytes()
            def grupo(g):
                a, n, digest = m['grupos'][g]; b = bundle[a:a+n]
                self.assertEqual(hashlib.sha256(b).hexdigest(), digest); return json.loads(b)['linhas']
            br = grupo('BR'); go = grupo('GO'); df = grupo('DF')
            self.assertEqual(br[0][1], 12000)  # PIB dos três municípios uma vez só.
            self.assertEqual(go[0][1], 10000)
            self.assertEqual(df[0][1], 2000)
            self.assertEqual(br[1][1:4], [None, None, None])
            self.assertEqual(br[1][4:], [1, 1])
            self.assertEqual(razao(go[0][2], go[0][4], go[0][1])[0], 1.2)

    def test_destino_e_hash_invalidos_nao_escrevem(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); base, manifest = self.fixture(root)
            before = {p.relative_to(base).as_posix(): sha(p) for p in base.rglob('*') if p.is_file()}
            with self.assertRaisesRegex(ValueError, 'isolado'):
                gerar(base, manifest, base / 'nova')
            self.assertEqual(before, {p.relative_to(base).as_posix(): sha(p) for p in base.rglob('*') if p.is_file()})
            (base / 'gold/assistencia/pbf.parquet').write_bytes(b'invalido')
            with self.assertRaisesRegex(ValueError, 'diverge'):
                gerar(base, manifest, root / 'candidato')
            self.assertFalse((root / 'candidato').exists())


if __name__ == '__main__':
    unittest.main()
