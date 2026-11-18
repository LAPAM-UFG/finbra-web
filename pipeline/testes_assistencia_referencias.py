"""Períodos completos, unidades, cobertura e estimativa sem imputar salários."""
import json
import tempfile
import unittest
from pathlib import Path
from assistencia_referencias import comparar, massa_rais, gerar


class Referencias(unittest.TestCase):
    def test_unidades_diferentes_mesmos_pagamentos(self):
        self.assertEqual(comparar(100,12,1000,1),(0.1,0))
        self.assertEqual(comparar(100,12,1000,100),(10.,0))
        self.assertEqual(comparar(0,12,1000,1),(0.,0))
        self.assertEqual(comparar(2500,12,1000,100),(250.,0))

    def test_nao_estima_pagamentos_incompletos(self):
        self.assertEqual(comparar(None,11,1000,1),(None,2))
        self.assertEqual(comparar(None,0,None,100),(None,1))
        for base,c in [(None,3),(0,4),(-1,5),(float('inf'),5)]:
            self.assertEqual(comparar(100,12,base,100),(None,c))

    def test_estimativa_dezembro_vezes_doze_sem_corrigir_nao_respostas(self):
        self.assertEqual(massa_rais(100,10,8),(1200,80))
        self.assertEqual(massa_rais(100,10,10),(1200,100))
        self.assertEqual(massa_rais(None,10,0),(None,0))
        self.assertEqual(massa_rais(None,0,0),(0.,None))
        self.assertEqual(massa_rais(None,None,None),(None,None))
        with self.assertRaises(AssertionError):massa_rais(100,10,11)
        with self.assertRaises(AssertionError):massa_rais(-100,10,8)

    def test_destino_recusado_antes_de_escrita(self):
        with tempfile.TemporaryDirectory() as td:
            src=Path(td)/'fontes';src.mkdir();marker=src/'intacto';marker.write_bytes(b'preservar')
            for out in [src,src/'novo',src.parent]:
                with self.assertRaises(ValueError):gerar(src,out)
                self.assertEqual(list(src.iterdir()),[marker]);self.assertEqual(marker.read_bytes(),b'preservar')

    def test_hash_de_origem_invalido_nao_cria_candidato(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td);src=root/'fontes';src.mkdir();(src/'dado').write_bytes(b'alterado')
            (src/'proveniencia.json').write_text(json.dumps({'arquivos':{'dado':{'bytes':8,'sha256':'0'*64}}}))
            with self.assertRaisesRegex(AssertionError,'Fonte alterada'):gerar(src,root/'candidato')
            self.assertFalse((root/'candidato').exists())


if __name__=='__main__':unittest.main()
