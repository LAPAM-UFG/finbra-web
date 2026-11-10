"""Regressões da revisão FNS: origem intocada, cache verificável, identidade e destinatário distrital.

Execução: python pipeline/testes_fns_revisao.py. Não usa rede nem diretórios de dados reais.
Fixtures com junctions ficam em TEMP para evitar qualquer remoção recursiva de links.
"""
import contextlib
import csv
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq

import fns
import fns_baixar as baixar
from fns_leitura import CAMPOS


def fotografia(pasta):
    return {str(p.relative_to(pasta)): (p.stat().st_size, baixar.sha256(p))
            for p in pasta.rglob("*") if p.is_file()}


def linha(**mudancas):
    r = dict.fromkeys(CAMPOS, "")
    r.update(bloco="BLOCO", grupo="GRUPO", estrategia="ESTRATÉGIA", uf="PE", municipio="FERNANDO DE NORONHA",
             cod_ibge6="260545", qt_populacao="999999", nu_ano_referencia_ibge="2021", cnpj="40817926000199",
             entidade="AUTARQUIA TERRITORIAL DISTRITO ESTADUAL DE FERNANDO DE NORONHA", banco="001", agencia="0123",
             conta="00001", tp_repasse="MUNICIPAL", tp_repasse_estado="N", st_faf="S", st_hu="N",
             dt_ultima_liberacao="01/12/2008", vl_bruto="100,01", vl_liquido="100,01", vl_saldo_conta="999999,00")
    r.update(mudancas)
    return r


def csv_oficial(pasta, ano, linhas):
    arq = pasta / baixar.nome_arquivo(ano)
    cab = ["CO_MUNICIPIO_IBGE" if c == "cod_ibge6" else c.upper() for c in CAMPOS]
    with arq.open("w", encoding="cp1252", newline="") as arquivo:
        w = csv.writer(arquivo)
        w.writerow(cab)
        w.writerows([r[c] for c in CAMPOS] for r in linhas)
    return arq


def mini_base(base, anos=(2008,)):
    (base / "saude").mkdir(parents=True)
    pops = [{"ano": a, "municipio": m, "cod_ibge": c, "populacao": p}
            for a in anos for m, c, p in [(260545, 2605459, 100.0), (520870, 5208707, 200.0), (530010, 5300108, 300.0)]]
    pq.write_table(pa.Table.from_pylist(pops), base / "saude/populacao.parquet")
    pq.write_table(pa.Table.from_pylist([
        {"ano": 2025, "municipio": 520870, "cod_ibge": 5208707, "nome": "Goiânia", "uf": "GO"},
        {"ano": 2025, "municipio": 530010, "cod_ibge": 5300108, "nome": "Brasília", "uf": "DF"},
    ]), base / "saude/municipios.parquet")
    pq.write_table(pa.Table.from_pylist([{"exercicio": 2008, "fator_real": 1.2}]), base / "ipca.parquet")
    (base / "manifesto.json").write_text(json.dumps({"gerado_em": "anterior", "fontes": {"icsap": {"anos": [2008, 2025]}},
                                                  "preservar": {"valor": 7}}), encoding="utf8")


def registro(arq):
    return {"arquivo": arq.name, "bytes": arq.stat().st_size, "sha256": baixar.sha256(arq),
            "url": "https://portalfns.saude.gov.br/arquivo-de-teste.csv"}


class RevisaoFNS(unittest.TestCase):
    def setUp(self):
        self.raiz = Path(tempfile.mkdtemp(prefix="fns_revisao_"))
        self.base = self.raiz / "base"
        self.brutos = self.raiz / "brutos/fns"
        self.saida = self.raiz / "candidato"
        self.brutos.mkdir(parents=True)

    def validar(self):
        fns.validar_destinos(self.base, self.saida, self.brutos, permitido=self.saida)

    def junction(self, alvo, destino):
        destino.parent.mkdir(parents=True, exist_ok=True)
        alvo.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            import _winapi
            _winapi.CreateJunction(str(alvo), str(destino))
        else:
            destino.symlink_to(alvo, target_is_directory=True)

    def test_destino_separado_sem_escrita(self):
        antes = fotografia(self.raiz)
        self.validar()
        self.assertEqual(fotografia(self.raiz), antes)
        self.assertFalse(self.saida.exists())

    def test_destino_sobreposto_recusado_sem_escrita(self):
        self.base.mkdir()
        (self.base / "original").write_bytes(b"preservar")
        antes = fotografia(self.base)
        for saida in (self.base, self.base / "interno", self.base.parent):
            with self.subTest(saida=saida), self.assertRaises(ValueError):
                fns.validar_destinos(self.base, saida, self.brutos, permitido=saida)
        self.assertEqual(fotografia(self.base), antes)

    def test_junction_saude_para_base_recusada(self):
        alvo = self.base / "saude"
        self.junction(alvo, self.saida / "gold/saude")
        (alvo / "original").write_bytes(b"preservar")
        antes = fotografia(self.base)
        with self.assertRaises(ValueError):
            self.validar()
        self.assertEqual(fotografia(self.base), antes)

    def test_junction_auditoria_para_brutos_recusada(self):
        self.junction(self.brutos, self.saida / "auditoria")
        antes = fotografia(self.brutos)
        with self.assertRaises(ValueError):
            self.validar()
        self.assertEqual(fotografia(self.brutos), antes)

    def test_symlink_temporario_recusado(self):
        self.base.mkdir()
        origem = self.base / "manifesto.json"
        origem.write_bytes(b"preservar")
        destino = self.saida / "gold/manifesto.json.tmp"
        destino.parent.mkdir(parents=True)
        try:
            destino.symlink_to(origem)
        except OSError as erro:
            self.skipTest(f"sistema não permite criar symlink de arquivo: {erro}")
        with self.assertRaises(ValueError):
            self.validar()
        self.assertEqual(origem.read_bytes(), b"preservar")

    def test_cache_valido_modificado_e_truncado(self):
        arq = csv_oficial(self.brutos, 2008, [linha()])
        meta = registro(arq)
        self.assertTrue(baixar.baixar_um(2008, self.brutos, False, meta)["reutilizado"])
        dados = arq.read_bytes()
        arq.write_bytes(dados.replace(b"100,01", b"100,02"))  # mesmo tamanho, hash diferente
        self.assertIn("erro", baixar.baixar_um(2008, self.brutos, False, meta))
        arq.write_bytes(dados[:-1])
        self.assertIn("erro", baixar.baixar_um(2008, self.brutos, False, meta))

    def test_cache_sem_inventario_nao_e_certificado(self):
        arq = csv_oficial(self.brutos, 2008, [linha()])
        self.assertIn("erro", baixar.baixar_um(2008, self.brutos, False))
        with self.assertRaises(ValueError):
            baixar.verificar_arquivo(arq, {"bytes": arq.stat().st_size})

    def test_candidato_recusa_hash_antes_de_criar_saida(self):
        arq = csv_oficial(self.brutos, 2008, [linha()])
        (self.brutos / "_fontes.json").write_text(json.dumps({"2008": registro(arq)}), encoding="utf8")
        arq.write_bytes(arq.read_bytes().replace(b"100,01", b"100,02"))
        antes = fotografia(self.brutos)
        with self.assertRaisesRegex(ValueError, "bytes/SHA-256"):
            fns.candidato(self.base, self.brutos, self.saida, anos=(2008,), permitido=self.saida)
        self.assertFalse(self.saida.exists())
        self.assertEqual(fotografia(self.brutos), antes)

    def test_refazer_com_falha_sai_com_erro_mesmo_com_registro_antigo(self):
        arq = csv_oficial(self.brutos, 2008, [linha()])
        (self.brutos / "_fontes.json").write_text(json.dumps({"2008": registro(arq)}), encoding="utf8")
        antes = fotografia(self.brutos)
        with patch.object(baixar, "ANOS", (2008,)), patch.object(baixar.urllib.request, "urlopen", side_effect=OSError("rede indisponível")), \
                patch.object(baixar.time, "sleep"), patch.object(sys, "argv", ["fns_baixar.py", "--brutos", str(self.brutos), "--refazer"]), \
                contextlib.redirect_stdout(io.StringIO()), self.assertRaises(SystemExit) as saida:
            baixar.main()
        self.assertNotEqual(saida.exception.code, 0)
        self.assertEqual(fotografia(self.brutos), antes)

    def test_df_historico_documentado_sem_incluir_outros_destinatarios(self):
        for cnpj in ("00394700000108", "00394700000299", "12116247000157"):
            r = linha(uf="DF", cod_ibge6="530010", cnpj=cnpj, tp_repasse="ESTADUAL", tp_repasse_estado="S")
            self.assertEqual(fns.classificar(r, "ESTADUAL", 530010, frozenset()), ("distrital", None))
        r["cnpj"] = "00000000000000"
        self.assertEqual(fns.classificar(r, "ESTADUAL", 530010, frozenset())[0], "excluido")
        r["cnpj"], r["uf"] = "00394700000299", "GO"
        self.assertEqual(fns.classificar(r, "ESTADUAL", 530010, frozenset())[0], "excluido")
        r["uf"], r["tp_repasse_estado"] = "DF", "N"
        self.assertEqual(fns.classificar(r, "ESTADUAL", 530010, frozenset())[0], "quarentena")

    def test_duplicata_na_classe_nao_confunde_conflito_entre_classes(self):
        arq = csv_oficial(self.brutos, 2008, [linha(conta="a", vl_liquido="1"), linha(conta="a", vl_liquido="2"),
            linha(conta="b", vl_liquido="10"), linha(conta="b", vl_liquido="20", tp_repasse="ESTADUAL", tp_repasse_estado="S")])
        res = fns.processar_arquivo(2008, str(arq), frozenset({260545}))
        self.assertEqual(res["cont"]["quarentena"], 2)
        self.assertEqual(res["cont"]["incluidas_municipal"], 1)
        self.assertEqual(res["cont"]["excluidas"], 1)
        self.assertEqual(res["cont"]["linhas_com_conflito_de_classe"], 2)
        self.assertEqual(sum(v[1] for v in res["agg"].values()), 10)

    def test_candidato_preserva_origem_identidade_somas_e_manifesto(self):
        mini_base(self.base)
        arq = csv_oficial(self.brutos, 2008, [linha(), linha(estrategia="OUTRA", vl_bruto="200,02", vl_liquido="200,02"),
            linha(uf="DF", municipio="BRASILIA", cod_ibge6="530010", cnpj="00394700000299", tp_repasse="ESTADUAL", tp_repasse_estado="S",
                  vl_bruto="400", vl_liquido="400")])
        (self.brutos / "_fontes.json").write_text(json.dumps({"2008": registro(arq)}), encoding="utf8")
        antes = (fotografia(self.base), fotografia(self.brutos))
        with contextlib.redirect_stdout(io.StringIO()):
            fns.candidato(self.base, self.brutos, self.saida, anos=(2008,), permitido=self.saida)
        self.assertEqual((fotografia(self.base), fotografia(self.brutos)), antes)
        con = duckdb.connect()
        s = (self.saida / "gold/saude").as_posix()
        noronha = con.execute(f"SELECT cod_ibge,nome,liquido::DECIMAL(20,2),populacao,liquido_real FROM '{s}/fns_municipios.parquet' WHERE municipio=260545").fetchone()
        self.assertEqual(noronha[:2], (2605459, "FERNANDO DE NORONHA"))
        self.assertEqual(str(noronha[2]), "300.03")
        self.assertEqual(noronha[3], 100)  # uma população anual, apesar das duas estratégias e da população2021 no arquivo
        self.assertAlmostEqual(noronha[4], 360.036)
        self.assertEqual(con.execute(f"SELECT count(*) FROM '{s}/fns_municipios.parquet'").fetchone()[0], 3)
        self.assertIsNone(con.execute(f"SELECT liquido FROM '{s}/fns_municipios.parquet' WHERE municipio=520870").fetchone()[0])
        totais = [con.execute(f"SELECT sum(liquido::DECIMAL(20,2)) FROM '{s}/fns_{t}.parquet'").fetchone()[0]
                  for t in ("municipios", "composicao", "anos")]
        self.assertEqual(list(map(str, totais)), ["700.03"] * 3)
        manifesto = json.loads((self.saida / "gold/manifesto.json").read_text(encoding="utf8"))
        self.assertEqual(manifesto["fontes"]["icsap"], {"anos": [2008, 2025]})
        self.assertEqual(manifesto["preservar"], {"valor": 7})
        self.assertIn("00394700000299", manifesto["fontes"]["fns"]["df"]["cnpj"])
        self.assertIn("documentacao_historica", manifesto["fontes"]["fns"]["df"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
