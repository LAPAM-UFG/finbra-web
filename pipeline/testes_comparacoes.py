"""Casos de referência para evitar distorções entre escalas territoriais."""

import unittest
import json, tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from comparacoes_base import Quadro, por_base, Gravador, compatibilidade_global
from comparacoes_saude import montar, definicao, incluir_sem_localizacao_brasil
from comparacoes import Comparacoes


class TestesComparacao(unittest.TestCase):
    def test_sinan_brasil_inclui_sem_localizacao_sem_alterar_uf_e_municipio(self):
        import duckdb
        con=duckdb.connect()
        try:
            con.execute('CREATE TABLE registros(ano INTEGER,sinan_teste DOUBLE,populacao DOUBLE)')
            con.execute('INSERT INTO registros VALUES (2024,10,1000),(2024,NULL,2000),(2024,5,NULL)')
            i=definicao('teste','Teste','Test','SINAN','SINAN','https://datasus.saude.gov.br/')
            i['fator']=100000
            a=np.array([[10.,np.nan]]);d=np.array([[1000.,2000.]])
            q=Quadro(i,[2024],a/d*100000,a,d,np.array([[0,2]],dtype=np.uint8))
            g=SimpleNamespace(con=con,sql=lambda _: 'registros')
            novo=incluir_sem_localizacao_brasil(q,g,{'numerador':'sinan_teste','denominador':'populacao'})
            br=novo.grupo_territorio('BR',[0,1]);self.assertEqual((br['n'],br['d'],br['v']),([15],[3000],[500]))
            self.assertEqual(br['q'],[1])
            self.assertEqual(novo.grupo_territorio('GO',[0,1]),q.grupo_territorio('GO',[0,1]))
            self.assertEqual(novo.grupo_territorio('5208707',[0],municipio=True),q.grupo_territorio('5208707',[0],municipio=True))
            con.execute('DELETE FROM registros');con.execute('INSERT INTO registros VALUES (2024,0,1000)')
            self.assertEqual(incluir_sem_localizacao_brasil(q,g,{'numerador':'sinan_teste','denominador':'populacao'}).grupo_territorio('BR',[0,1])['c'],[1])
            con.execute('UPDATE registros SET populacao=0')
            vazio=incluir_sem_localizacao_brasil(q,g,{'numerador':'sinan_teste','denominador':'populacao'}).grupo_territorio('BR',[0,1])
            self.assertEqual((vazio['v'],vazio['c']),([None],[4]))
        finally:con.close()

    def test_envio_comparacoes_inclui_ndjson_e_publica_manifesto_por_ultimo(self):
        import r2

        enviados = []

        def upload(local, bucket, chave, **kwargs):
            enviados.append((chave, kwargs["ExtraArgs"]))

        with tempfile.TemporaryDirectory() as td, patch.object(
            r2, "remotos", return_value={}
        ), patch("builtins.print"):
            raiz = Path(td)
            dest = raiz / "gold/comparacoes"
            dest.mkdir(parents=True)
            for nome in ["manifesto.json", "z_indice.json", "series.ndjson"]:
                (dest / nome).write_text("{}\n")
            r2.enviar(SimpleNamespace(upload_file=upload), "teste", ["gold"], raiz=raiz)
            self.assertEqual(
                [x[0] for x in enviados],
                [
                    "gold/comparacoes/series.ndjson",
                    "gold/comparacoes/z_indice.json",
                    "gold/comparacoes/manifesto.json",
                ],
            )
            self.assertEqual(enviados[-1][1]["CacheControl"], "no-cache")
            self.assertIn("immutable", enviados[0][1]["CacheControl"])
            enviados.clear()

            def falhar(local, bucket, chave, **kwargs):
                enviados.append(chave)
                raise RuntimeError("envio interrompido")

            with self.assertRaisesRegex(RuntimeError, "envio interrompido"):
                r2.enviar(
                    SimpleNamespace(upload_file=falhar), "teste", ["gold"], raiz=raiz
                )
            self.assertNotIn("gold/comparacoes/manifesto.json", enviados)

    def test_envio_reconhece_md5_de_objeto_comparativo_publicado_sem_metadado_customizado(
        self,
    ):
        import r2

        with tempfile.TemporaryDirectory() as td, patch("builtins.print"):
            raiz = Path(td)
            dest = raiz / "gold/comparacoes"
            dest.mkdir(parents=True)
            arq = dest / "series.ndjson"
            arq.write_bytes(b"{}\n")
            chave = "gold/comparacoes/series.ndjson"
            with patch.object(r2, "remotos", return_value={chave: {"Size": 3}}):
                s3 = SimpleNamespace(
                    head_object=lambda **kw: {"ETag": '"' + r2.md5(arq) + '"'},
                    upload_file=lambda *a, **kw: self.fail(
                        "objeto idêntico não deve subir novamente"
                    ),
                )
                r2.enviar(s3, "teste", ["gold"], raiz=raiz)

    def test_assinatura_global_preserva_descritores_sem_criar_referencias_cas_externas(
        self,
    ):
        fontes = {
            "rais": {"anos": [2024]},
            "assistencia": {
                "abertura": {
                    "caminho": "gold/assistencia/indice.json",
                    "sha256": "original",
                    "bytes": 2,
                }
            },
        }
        out = compatibilidade_global({"fontes": fontes})
        self.assertEqual(out["trabalho"]["fontes"], ["rais", "caged", "rais_perfis"])
        self.assertIsInstance(out["assistencia"]["json_referencia"], str)
        self.assertEqual(
            json.loads(out["assistencia"]["json_referencia"]),
            {"assistencia": fontes["assistencia"]},
        )

    def test_sync_fiscal_ignora_comparacoes_e_preserva_opcao_de_microdados(self):
        import r2

        objetos = {
            "gold/manifesto.json": {"Size": 2},
            "gold/comparacoes/manifesto.json": {"Size": 2},
            "gold/comparacoes/series.ndjson": {"Size": 3},
            "silver/trabalho/micro/teste.parquet": {"Size": 3},
        }
        baixados = []

        def download(bucket, chave, destino, **kwargs):
            baixados.append(chave)
            Path(destino).write_bytes(b"x" * objetos[chave]["Size"])

        with tempfile.TemporaryDirectory() as td, patch.object(
            r2, "remotos", return_value=objetos
        ), patch("builtins.print"):
            raiz = Path(td)
            s3 = SimpleNamespace(download_file=download)
            r2.baixar(
                s3,
                "teste",
                ["silver", "gold"],
                raiz=raiz,
                ignorar=("gold/comparacoes/*",),
            )
            self.assertEqual(baixados, ["gold/manifesto.json"])
            self.assertFalse((raiz / "gold/comparacoes").exists())
            self.assertFalse((raiz / "silver/trabalho/micro").exists())
            baixados.clear()
            r2.baixar(
                s3,
                "teste",
                ["silver", "gold"],
                com_micro=True,
                raiz=raiz,
                ignorar=("gold/comparacoes/*",),
            )
            self.assertEqual(baixados, ["silver/trabalho/micro/teste.parquet"])
            self.assertEqual((raiz / "gold/manifesto.json").read_bytes(), b"xx")

    def test_razao_publicada_com_componente_protegido_nao_reconstroi_contagem(self):
        q = self.quadro([10, 249], [5, np.nan])
        q.definicao.update(metodo_referencia="razao", fator=1)
        q.valores = np.array([[2, 2.648936170212766]])
        q.originais = q.valores.copy()
        self.assertEqual(q.grupo([1], municipio=True)["v"], [2.648936170212766])
        self.assertEqual(q.grupo([1], municipio=True)["d"], [None])
        agregado = q.grupo([0, 1])
        self.assertEqual(agregado["v"], [2])
        self.assertEqual(agregado["q"], [1])
        self.assertEqual(agregado["d"], [5])

    def test_lista_nacional_contem_somente_ufs_sem_brasil_duplicado(self):
        with tempfile.TemporaryDirectory() as td:
            g = Gravador.__new__(Gravador)
            g.dest = Path(td)
            g.geo = SimpleNamespace(
                grupos={"GO": [0], "SP": [1], "BR": [0, 1]},
                territorios={
                    "GO": {"nivel": "UF"},
                    "SP": {"nivel": "UF"},
                    "BR": {"nivel": "BR"},
                },
            )
            q = self.quadro([10, 20], [100, 100])
            refs = g.rankings("teste", "trabalho", "todas", [q], {})
            idx = json.loads(
                (g.dest / Path(refs["teste"]["caminho"]).name).read_bytes()
            )
            start, n, _ = idx["recortes"]["2025:BR"]
            with (g.dest / Path(idx["arquivo"]["caminho"]).name).open("rb") as f:
                f.seek(start)
                linhas = [json.loads(l) for l in f.read(n).splitlines()]
            self.assertEqual([l["uf"] for l in linhas], ["GO", "SP"])
            self.assertEqual(sum(l["quantidade"] for l in linhas), 2)

    def quadro(self, n, d, **extra):
        n = np.array([n], dtype=float)
        d = np.array([d], dtype=float)
        with np.errstate(invalid="ignore", divide="ignore"):
            v = n / d * 100
        v[~np.isfinite(v)] = np.nan
        return Quadro(
            dict(
                id="teste",
                nome="Teste",
                nome_en="Test",
                unidade="%",
                metodo_referencia="razao",
                fator=100,
                **extra
            ),
            [2025],
            v,
            n,
            d,
            np.where(np.isfinite(v), 0, 2),
        )

    def test_razao_das_somas_e_mesma_base(self):
        q = self.quadro([1, 99, np.nan, 0], [1, 999, 500, 10])
        r = q.grupo([0, 1, 2, 3])
        self.assertAlmostEqual(r["v"][0], 100 / 1010 * 100)
        self.assertEqual(r["q"], [3])
        self.assertEqual(r["c"], [16])
        self.assertEqual(r["d"], [1010])
        self.assertNotAlmostEqual(r["v"][0], np.nanmean(q.valores))

    def test_zero_ausencia_e_base_zero(self):
        q = por_base(
            dict(id="teste", nome="Teste", nome_en="Test", unidade="por mil"),
            [2026],
            np.array([[0, np.nan, 10, 5]]),
            np.array([[1, 2, 0, 0]]),
            np.array([[100, 100, 0, np.nan]]),
        )
        self.assertEqual(q.grupo([0], True)["v"], [0])
        self.assertEqual(q.grupo([1], True)["v"], [None])
        self.assertEqual(q.grupo([2], True)["c"], [4])
        self.assertEqual(q.grupo([3], True)["c"], [3])

    def test_medianas_rotuladas_nao_sao_indices_regionais(self):
        q = self.quadro([10, 50, 100], [100, 100, 100])
        q.definicao["metodo_referencia"] = "mediana"
        r = q.grupo([0, 1, 2])
        self.assertEqual(r["v"], [50])
        self.assertEqual(r["n"], [None])
        self.assertEqual(r["d"], [None])

    def test_ressalva_preserva_original_e_muda_apenas_referencia_opcional(self):
        q = self.quadro([10, 90], [100, 100])
        q.condicoes[0, 1] = 8
        self.assertEqual(q.grupo([0, 1])["v"], [10])
        self.assertEqual(q.grupo([0, 1], incluir_ressalvas=True)["v"], [50])
        self.assertEqual(q.grupo([1], True)["v"], [90])

    def test_remuneracao_inclui_sem_remuneracao_valida_no_denominador(self):
        q = self.quadro([1000, 0], [10, 10], aceita_denominador_zero_agregado=True)
        q.definicao["fator"] = 1
        q.valores = np.array([[100, np.nan]])
        q.condicoes = np.array([[0, 13]])
        q.elegiveis = np.array([[True, True]])
        q.validacao_extra = np.array([[8, 0]])
        self.assertEqual(q.grupo([0, 1])["v"], [50])
        self.assertEqual(q.grupo([1])["v"], [None])
        self.assertEqual(q.grupo([1])["c"], [13])

    def test_resposta_inesperada_nao_vira_nao_nem_entra_na_porcentagem(self):
        q = self.quadro([1, 0, np.nan], [1, 1, 1], recusar_inesperadas=True)
        q.definicao["metodo_referencia"] = "resposta"
        q.condicoes[0, 2] = 17
        self.assertEqual(q.grupo([0, 1, 2])["v"], [None])
        self.assertEqual(q.grupo([0, 1, 2])["c"], [17])
        self.assertEqual(q.grupo([0, 1])["v"], [50])

    def test_clima_pondera_area_e_nao_populacao(self):
        q = self.quadro([10 * 1, 30 * 9], [1, 9])
        q.definicao.update(metodo_referencia="area", fator=1, unidade="°C")
        q.valores = np.array([[10, 30]])
        self.assertEqual(q.grupo([0, 1])["v"], [28])

    def test_desvio_climatico_percentual_e_razao_ponderada_nao_media_dos_percentuais(
        self,
    ):
        q = self.quadro([(20 - 10) * 1, (110 - 100) * 9], [10 * 1, 100 * 9])
        r = q.grupo([0, 1])
        self.assertAlmostEqual(r["v"][0], 100 * 100 / 910)
        self.assertNotAlmostEqual(r["v"][0], 55)

    def test_recusa_destino_sobreposto_antes_de_criar_arquivos(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            orig = root / "dados/gold"
            orig.mkdir(parents=True)
            arq = orig / "origem.parquet"
            arq.write_bytes(b"origem intocada")
            rev = root / "revisao"
            rev.mkdir()
            (rev / "fontes_comparacoes.json").write_text(
                json.dumps({"arquivos": {"teste": {"local": str(arq)}}, "raizes": {}})
            )
            antes = sorted(str(p.relative_to(root)) for p in root.rglob("*"))
            for destino in [
                root / "dados",
                orig,
                orig / "candidato",
                root / "x/../dados",
                root / "dados/gold/../gold/candidato",
            ]:
                with self.assertRaisesRegex(AssertionError, "Destino sobreposto"):
                    Comparacoes(rev, destino, root)
                self.assertEqual(
                    antes, sorted(str(p.relative_to(root)) for p in root.rglob("*"))
                )
                self.assertEqual(arq.read_bytes(), b"origem intocada")

    def test_saude_distingue_ipca_ausente_de_numerador_e_base_zero(self):
        i = definicao(
            "fns", "FNS", "FNS", "FNS", "FNS", "https://portalfns.saude.gov.br/"
        )
        i["formato"] = "moeda"
        g = SimpleNamespace(m=[0, 1, 2], pos={1: 0, 2: 1, 3: 2})
        q = montar(
            i,
            [2002],
            [
                (1, 2002, None, None, 100, 500),
                (2, 2002, None, None, 100, None),
                (3, 2002, None, 500, 0, 500),
            ],
            g,
        )
        self.assertEqual(q.condicoes.tolist(), [[21, 2, 4]])
        self.assertTrue(np.isnan(q.valores).all())


if __name__ == "__main__":
    unittest.main()
