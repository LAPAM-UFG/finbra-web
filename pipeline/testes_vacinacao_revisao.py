"""Regressões dos destinos e do cache da vacinação, sem rede e sem dados reais.

Execute com: python -B pipeline/testes_vacinacao_revisao.py
Fixtures ficam em uma pasta temporária indicada ao final. Não há remoção recursiva.
Junctions usam apenas essa pasta; symlink de arquivo é opcional conforme permissões.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import vacinacao as v
import vacinacao_baixar as b


class CapturaNecessaria(Exception):
    """A fixture inválida deve pedir nova captura, sem realmente abrir a rede."""


def no(texto, tipo="N", elemento=0, filhos=None):
    return {"qText": texto, "qType": tipo, "qElemNo": elemento, "qSubNodes": filhos or []}


def pagina_sintetica():
    # Um totalizador Brasil e um imunobiológico: evita qualquer matriz municipal.
    caminho = [("Brasil", "N", 0), ("Totais", "T", -1)] + [("", "E", -4)] * 4
    filhos = []
    for texto, tipo, elemento in reversed(caminho):
        filhos = [no(texto, tipo, elemento, filhos)]
    medidas = ("Cobertura Vacinal (%)", "Numerador", "Denominador")
    return {
        "qLeft": filhos,
        "qTop": [no("BCG", filhos=[no(m, "P", i) for i, m in enumerate(medidas)])],
        "qData": [[{"qNum": valor, "qText": str(valor), "qType": "V"} for valor in (0.5, 5, 10)]],
        "qArea": {"qTop": 0, "qLeft": 0, "qHeight": 1, "qWidth": 3},
    }


def criar_cache(raiz: Path, *, bytes_delta=0, sha_incorreto=False, sem_bytes=False):
    pasta = raiz / "2024"
    pasta.mkdir(parents=True)
    bruto = json.dumps(pagina_sintetica(), ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    arquivo = pasta / "pagina_0000.json.gz"
    with gzip.open(arquivo, "wb") as f:
        f.write(bruto)
    pagina = {
        "topo": 0, "altura": 1,
        "sha256": "0" * 64 if sha_incorreto else hashlib.sha256(bruto).hexdigest(),
        "bytes": len(bruto) + bytes_delta,
    }
    if sem_bytes:
        del pagina["bytes"]
    manifesto = {
        "ano": 2024, "app": b.APP_ID, "objeto": b.OBJETO, "url": b.URL_FONTE,
        "cubo": {"linhas": 1, "colunas": 3,
                 "dimensoes": [" ", "Região", "UF", "Macrorregião Saúde", "Região de Saúde", "Município", "Imunobiológico"],
                 "medidas": ["Cobertura Vacinal (%)", "Numerador", "Denominador"]},
        "completo": True, "plano": [[0, 1]], "paginas": {"0000": pagina},
    }
    (pasta / "manifesto.json").write_text(json.dumps(manifesto, ensure_ascii=False), encoding="utf-8")
    return manifesto, arquivo, bruto


class SessaoSimulada:
    """Responde ao protocolo mínimo do Qlik sem abrir sockets ou HTTP."""

    def __init__(self, numerador=5):
        self.pagina = pagina_sintetica()
        self.pagina["qData"] = [[
            {"qNum": valor, "qText": str(valor), "qType": "V"}
            for valor in (numerador / 10, numerador, 10)
        ]]
        self.chamadas = []
        self.fechada = False

    def chamar(self, handle, metodo, params):
        self.chamadas.append((handle, metodo, params))
        esperados = {
            "OpenDoc": (-1, [b.APP_ID], {"qReturn": {"qHandle": 1}}),
            "GetField": (1, ["Ano"], {"qReturn": {"qHandle": 2}}),
            "SelectValues": (2, [[{"qNumber": 2024, "qIsNumeric": True}], False, False], {"qReturn": True}),
            "GetObject": (1, [b.OBJETO], {"qReturn": {"qHandle": 3}}),
        }
        if metodo in esperados:
            esperado_handle, esperado_params, resposta = esperados[metodo]
            if (handle, params) != (esperado_handle, esperado_params):
                raise AssertionError(f"Pedido inesperado: {handle}, {metodo}, {params}")
            return resposta
        if metodo == "GetLayout" and handle == 3 and params == []:
            return {"qLayout": {"qHyperCube": {
                "qSize": {"qcy": 1, "qcx": 3},
                "qDimensionInfo": [{"qFallbackTitle": titulo} for titulo in (
                    " ", "Região", "UF", "Macrorregião Saúde", "Região de Saúde", "Município", "Imunobiológico")],
                "qMeasureInfo": [{"qFallbackTitle": titulo} for titulo in (
                    "Cobertura Vacinal (%)", "Numerador", "Denominador")],
            }}}
        if metodo == "GetHyperCubePivotData" and handle == 3 and params == [
            "/qHyperCubeDef", [{"qTop": 0, "qLeft": 0, "qHeight": 1, "qWidth": 3}]
        ]:
            return {"qDataPages": [self.pagina]}
        raise AssertionError(f"Pedido inesperado: {handle}, {metodo}, {params}")

    def fechar(self):
        self.fechada = True


class DestinosECache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raiz_temporaria = Path(tempfile.mkdtemp(prefix="finbra-vacinacao-regressoes-"))
        print("\nFixtures preservadas em:", cls.raiz_temporaria, flush=True)

    def setUp(self):
        self.pasta = self.raiz_temporaria / self._testMethodName
        self.pasta.mkdir()
        self.base = self.pasta / "data" / "gold"
        self.brutos = self.pasta / "brutos" / "vacinacao"
        self.saida = self.pasta / "candidato"
        (self.base / "saude").mkdir(parents=True)
        self.brutos.mkdir(parents=True)
        self.marcadores = [self.base / "saude" / "nao_alterar.txt", self.brutos / "nao_alterar.txt"]
        for arquivo in self.marcadores:
            arquivo.write_bytes(b"origem temporaria: preservar\n")
        self.originais = {p: p.read_bytes() for p in self.marcadores}

    def tearDown(self):
        for arquivo, conteudo in self.originais.items():
            self.assertEqual(arquivo.read_bytes(), conteudo, f"origem alterada: {arquivo}")

    def junction(self, caminho: Path, destino: Path):
        caminho.parent.mkdir(parents=True, exist_ok=True)
        if os.name != "nt":
            caminho.symlink_to(destino, target_is_directory=True)
            return
        shell = shutil.which("pwsh") or shutil.which("powershell")
        if not shell:
            self.skipTest("PowerShell indisponível para criar junction temporária")
        quote = lambda p: "'" + str(p).replace("'", "''") + "'"
        comando = f"New-Item -ItemType Junction -Path {quote(caminho)} -Target {quote(destino)} | Out-Null"
        resultado = subprocess.run(
            [shell, "-NoProfile", "-NonInteractive", "-Command", comando],
            capture_output=True, text=True, timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        if resultado.returncode:
            self.skipTest("Criação de junction não permitida: " + resultado.stderr.strip())
        self.assertEqual(caminho.resolve(), destino.resolve())

    def symlink_arquivo(self, caminho: Path, destino: Path):
        caminho.parent.mkdir(parents=True, exist_ok=True)
        try:
            caminho.symlink_to(destino)
        except OSError as erro:
            self.skipTest(f"Symlink de arquivo não permitido neste ambiente: {erro}")
        self.assertEqual(caminho.resolve(), destino.resolve())

    def candidato_recusado_antes_de_processar(self):
        vazio = {"municipal": [], "territorios": [], "catalogo": [], "auditoria": [], "niveis": []}
        with mock.patch.object(v, "cadastro_municipios", return_value={}) as cadastro, \
                mock.patch.object(v, "montar", return_value=vazio) as montar, \
                mock.patch.object(v, "gravar", side_effect=AssertionError("escrita antes de recusar destino")) as gravar, \
                mock.patch.object(Path, "mkdir", side_effect=AssertionError("mkdir antes de recusar destino")) as mkdir:
            with self.assertRaises(ValueError):
                v.candidato(self.brutos, self.base, self.saida, [2024])
            cadastro.assert_not_called()
            montar.assert_not_called()
            gravar.assert_not_called()
            mkdir.assert_not_called()

    def baixador_recusado_antes_de_escrever(self):
        sessao = mock.Mock(side_effect=AssertionError("não abrir rede"))
        with mock.patch.object(Path, "mkdir", side_effect=AssertionError("mkdir antes de recusar destino")) as mkdir:
            with self.assertRaises(ValueError):
                b.baixar_ano(2024, self.brutos, sessao_fn=sessao)
            mkdir.assert_not_called()
        sessao.assert_not_called()

    def test_candidato_normal_e_guard_de_ancestral(self):
        v.validar_destinos(self.base, self.saida, self.brutos)
        self.assertFalse(self.saida.exists(), "validar não deve criar a pasta candidata")
        for destino in (self.base, self.base / "novo", self.base.parent, self.pasta, self.brutos):
            with self.subTest(destino=destino), self.assertRaises(ValueError):
                v.validar_destinos(self.base, destino, self.brutos)

    def test_junction_gold_saude_para_base_e_recusada(self):
        self.junction(self.saida / "gold" / "saude", self.base / "saude")
        self.candidato_recusado_antes_de_processar()

    def test_junction_auditoria_para_brutos_e_recusada(self):
        self.junction(self.saida / "auditoria", self.brutos)
        self.candidato_recusado_antes_de_processar()

    def test_junction_auditoria_filha_para_brutos_e_recusada(self):
        self.junction(self.saida / "auditoria" / "vacinacao", self.brutos)
        self.candidato_recusado_antes_de_processar()

    def test_junction_ano_do_baixador_para_base_e_recusada(self):
        self.junction(self.brutos / "2024", self.base / "saude")
        self.baixador_recusado_antes_de_escrever()

    def test_symlink_parquet_final_para_base_e_recusado(self):
        alvo = self.base / "saude" / "vacinacao.parquet"
        alvo.write_bytes(b"parquet de origem temporaria, nao sobrescrever")
        self.originais[alvo] = alvo.read_bytes()
        self.symlink_arquivo(self.saida / "gold" / "saude" / "vacinacao.parquet", alvo)
        self.candidato_recusado_antes_de_processar()

    def test_symlink_manifesto_final_para_base_e_recusado(self):
        alvo = self.base / "manifesto.json"
        alvo.write_text('{"origem":true}', encoding="utf-8")
        self.originais[alvo] = alvo.read_bytes()
        self.symlink_arquivo(self.saida / "gold" / "manifesto.json", alvo)
        self.candidato_recusado_antes_de_processar()

    def test_symlink_relatorio_final_para_brutos_e_recusado(self):
        alvo = self.brutos / "relatorio_protegido.json"
        alvo.write_bytes(b"origem")
        self.originais[alvo] = alvo.read_bytes()
        self.symlink_arquivo(self.saida / "auditoria" / "vacinacao" / "leitura.json", alvo)
        self.candidato_recusado_antes_de_processar()

    def test_symlink_manifesto_do_baixador_para_base_e_recusado(self):
        alvo = self.base / "manifesto.json"
        alvo.write_text('{"origem":true}', encoding="utf-8")
        self.originais[alvo] = alvo.read_bytes()
        self.symlink_arquivo(self.brutos / "2024" / "manifesto.json", alvo)
        self.baixador_recusado_antes_de_escrever()

    def test_symlink_pagina_do_baixador_para_base_e_recusado(self):
        alvo = self.base / "saude" / "protegido.json.gz"
        alvo.write_bytes(b"nao sobrescrever")
        self.originais[alvo] = alvo.read_bytes()
        self.symlink_arquivo(self.brutos / "2024" / "pagina_0000.json.gz", alvo)
        # Plano já conhecido: o preflight pode examinar a página antes da conexão.
        (self.brutos / "2024" / "manifesto.json").write_text(json.dumps({
            "ano": 2024, "plano": [[0, 1]], "cubo": {"linhas": 1, "colunas": 3},
            "paginas": {}, "completo": False,
        }), encoding="utf-8")
        self.baixador_recusado_antes_de_escrever()

    def test_symlink_temporario_do_baixador_para_base_e_recusado(self):
        alvo = self.base / "manifesto_temporario.json"
        alvo.write_bytes(b"temporario de origem protegido")
        self.originais[alvo] = alvo.read_bytes()
        self.symlink_arquivo(self.brutos / "2024" / "manifesto.json.tmp", alvo)
        self.baixador_recusado_antes_de_escrever()

    def capturar_simulado(self, numerador=5):
        sessao = SessaoSimulada(numerador)
        fabrica = mock.Mock(return_value=sessao)
        renomeados = []
        replace_real = Path.replace

        def observar_replace(temporario, destino):
            # Executa a gravação real na fixture, observando o contrato atômico.
            temporario, destino = Path(temporario), Path(destino)
            self.assertTrue(temporario.name.endswith(".tmp"))
            self.assertTrue(temporario.is_file())
            self.assertIn(self.brutos.resolve(), temporario.parents)
            self.assertIn(self.brutos.resolve(), destino.parents)
            renomeados.append((temporario, destino))
            return replace_real(temporario, destino)

        with mock.patch.object(b.time, "sleep"), mock.patch.object(Path, "replace", new=observar_replace):
            manifesto = b.baixar_ano(2024, self.brutos, sessao_fn=fabrica)
        fabrica.assert_called_once()
        self.assertTrue(sessao.fechada)
        self.assertEqual(sum(m == "GetHyperCubePivotData" for _, m, _ in sessao.chamadas), 1)
        self.assertEqual({destino.name for _, destino in renomeados}, {"pagina_0000.json.gz", "manifesto.json"})
        pasta = self.brutos / "2024"
        self.assertEqual(list(pasta.glob("*.tmp")), [])
        persistido = json.loads((pasta / "manifesto.json").read_text(encoding="utf-8"))
        self.assertEqual(persistido, json.loads(json.dumps(manifesto)))
        self.assertTrue(persistido["completo"])
        bruto = gzip.decompress((pasta / "pagina_0000.json.gz").read_bytes())
        self.assertEqual(json.loads(bruto), sessao.pagina)
        self.assertEqual(persistido["paginas"]["0000"]["bytes"], len(bruto))
        self.assertEqual(persistido["paginas"]["0000"]["sha256"], hashlib.sha256(bruto).hexdigest())
        self.assertTrue(b.pagina_valida(persistido, 0, pasta / "pagina_0000.json.gz"))
        registro = v.ler_ano(self.brutos, 2024)["registros"][0]
        self.assertEqual((registro["numerador"], registro["denominador"], registro["cobertura_fonte"]),
                         (numerador, 10, numerador / 10))
        return persistido

    def test_captura_nova_grava_pagina_e_manifesto_atomicamente(self):
        self.assertFalse((self.brutos / "2024").exists())
        self.capturar_simulado()

    def test_cache_com_bytes_errado_e_recapturado_e_corrigido(self):
        antigo, arquivo, _ = criar_cache(self.brutos, bytes_delta=50)
        self.assertFalse(b.pagina_valida(antigo, 0, arquivo))
        # A resposta nova difere da página antiga: a recaptura deve substituir o conteúdo.
        novo = self.capturar_simulado(numerador=7)
        self.assertNotEqual(novo["paginas"]["0000"]["sha256"], antigo["paginas"]["0000"]["sha256"])
        sem_rede = mock.Mock(side_effect=AssertionError("cache corrigido não abre rede"))
        self.assertTrue(b.baixar_ano(2024, self.brutos, sessao_fn=sem_rede)["completo"])
        sem_rede.assert_not_called()

    def test_cache_integro_e_reutilizado_sem_rede(self):
        manifesto, arquivo, bruto = criar_cache(self.brutos)
        self.assertNotEqual(len(bruto), arquivo.stat().st_size, "fixture deve distinguir bytes JSON de bytes gzip")
        self.assertTrue(b.pagina_valida(manifesto, 0, arquivo))
        sessao = mock.Mock(side_effect=AssertionError("cache íntegro não abre rede"))
        self.assertTrue(b.baixar_ano(2024, self.brutos, sessao_fn=sessao)["completo"])
        sessao.assert_not_called()
        lido = v.ler_ano(self.brutos, 2024)
        self.assertEqual(len(lido["registros"]), 1)
        self.assertEqual(lido["registros"][0]["numerador"], 5)
        self.assertEqual(lido["registros"][0]["denominador"], 10)

    def test_cache_com_tamanho_incorreto_nao_e_reutilizado(self):
        manifesto, arquivo, _ = criar_cache(self.brutos, bytes_delta=1)
        anterior = arquivo.read_bytes()
        self.assertFalse(b.pagina_valida(manifesto, 0, arquivo))
        sessao = mock.Mock(side_effect=CapturaNecessaria)
        with self.assertRaises(CapturaNecessaria):
            b.baixar_ano(2024, self.brutos, sessao_fn=sessao)
        sessao.assert_called_once()
        self.assertEqual(arquivo.read_bytes(), anterior)
        with self.assertRaises(v.ErroDeIntegridade):
            v.ler_ano(self.brutos, 2024)

    def test_cache_sem_tamanho_e_recusado_no_processamento(self):
        manifesto, arquivo, _ = criar_cache(self.brutos, sem_bytes=True)
        self.assertFalse(b.pagina_valida(manifesto, 0, arquivo))
        with self.assertRaises(v.ErroDeIntegridade):
            v.ler_ano(self.brutos, 2024)

    def test_cache_com_hash_incorreto_e_recusado(self):
        manifesto, arquivo, _ = criar_cache(self.brutos, sha_incorreto=True)
        self.assertFalse(b.pagina_valida(manifesto, 0, arquivo))
        with self.assertRaises(v.ErroDeIntegridade):
            v.ler_ano(self.brutos, 2024)


if __name__ == "__main__":
    unittest.main(verbosity=2)
