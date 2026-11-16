"""Contratos de segurança dos destinos e da publicação dos pacotes de abertura."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import abertura_paineis
import r2


class AberturaTest(unittest.TestCase):
    def test_origem_nao_recebe_escritas_com_destino_sobreposto(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp); base = pasta/'base'; base.mkdir()
            sentinela = base/'origem.txt'; sentinela.write_text('preservar')
            antes = {str(p.relative_to(pasta)): p.read_bytes() for p in pasta.rglob('*') if p.is_file()}
            for saida in [base, base/'filho', pasta, base/'filho/../outro']:
                with self.subTest(saida=saida), self.assertRaises(ValueError):
                    abertura_paineis.gerar(base, saida)
            depois = {str(p.relative_to(pasta)): p.read_bytes() for p in pasta.rglob('*') if p.is_file()}
            self.assertEqual(antes, depois)
            self.assertEqual([p.name for p in pasta.iterdir()], ['base'])
            self.assertEqual([p.name for p in base.iterdir()], ['origem.txt'])

    def test_r2_envia_dependencias_antes_do_manifesto_sem_publicar_temporarios(self):
        with tempfile.TemporaryDirectory() as tmp:
            raiz=Path(tmp); arquivos={
                'gold/abertura/serie_123.bin':b'bytes gzip concatenados',
                'gold/abertura/indice_123.json.gz':b'indice gzip',
                'gold/abertura/manifesto.json':json.dumps({'referencias':['serie_123.bin','indice_123.json.gz']}).encode(),
                'gold/abertura/incompleto.parcial':b'nao publicar',
                'gold/fora_do_namespace.bin':b'nao publicar',
                'gold/fora_do_namespace.json.gz':b'nao publicar',
            }
            for chave,data in arquivos.items():
                f=raiz/chave; f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(data)
            enviados={}
            class BucketFalso:
                def upload_file(self,local,bucket,key,**kwargs):
                    if key.endswith('manifesto.json'):
                        self_test.assertIn('gold/abertura/serie_123.bin',enviados)
                        self_test.assertIn('gold/abertura/indice_123.json.gz',enviados)
                    self_test.assertNotIn('ContentEncoding',kwargs['ExtraArgs'])
                    enviados[key]=Path(local).read_bytes()
            self_test=self
            with patch.object(r2,'remotos',return_value={}):
                r2.enviar(BucketFalso(),'teste',['gold'],raiz=raiz)
            self.assertEqual(set(enviados),{k for k in arquivos if k in ['gold/abertura/serie_123.bin','gold/abertura/indice_123.json.gz','gold/abertura/manifesto.json']})
            for chave,data in enviados.items(): self.assertEqual(data,arquivos[chave])


if __name__=='__main__': unittest.main()
