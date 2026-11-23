import hashlib,hmac,os,unittest
from urllib.parse import parse_qs,urlsplit
from unittest.mock import patch
from automacao_http import SessaoOficial


class Transporte(unittest.TestCase):
    def test_reescreve_somente_aneel_e_preserva_metodo_range_e_query(self):
        config=dict(FINBRA_FONTE_PROXY_URL='https://ponte.test/',R2_SECRET_ACCESS_KEY='chave-ficticia')
        with patch.dict(os.environ,config),patch('requests.Session.request',return_value=object())as send:
            with SessaoOficial()as s:
                s.get('https://dadosabertos.aneel.gov.br/api/3/action/package_show',params={'id':'siga'},headers={'Range':'bytes=0-3','Cookie':'nao-encaminhar'})
                args=send.call_args
                self.assertEqual(args.args[0],'GET')
                self.assertEqual(parse_qs(urlsplit(args.args[1]).query)['url'],['https://dadosabertos.aneel.gov.br/api/3/action/package_show?id=siga'])
                headers=args.kwargs['headers']
                expected=hmac.new(b'chave-ficticia',b'finbra-fontes-v1',hashlib.sha256).hexdigest()
                self.assertEqual(headers['Authorization'],'Bearer '+expected)
                self.assertEqual(headers['Range'],'bytes=0-3');self.assertNotIn('Cookie',headers)
                s.head('https://apisidra.ibge.gov.br/teste')
                self.assertEqual(send.call_args.args[1],'https://apisidra.ibge.gov.br/teste')
                self.assertNotIn('headers',send.call_args.kwargs)

    def test_sem_configuracao_mantem_acesso_direto(self):
        with patch.dict(os.environ,{},clear=True),patch('requests.Session.request',return_value=object())as send:
            with SessaoOficial()as s:s.get('https://dadosabertos.aneel.gov.br/teste')
            self.assertEqual(send.call_args.args[1],'https://dadosabertos.aneel.gov.br/teste')

    def test_nunca_envia_autenticacao_sem_tls_ou_credencial(self):
        for config in [dict(FINBRA_FONTE_PROXY_URL='http://ponte.test/',R2_SECRET_ACCESS_KEY='ficticia'),dict(FINBRA_FONTE_PROXY_URL='https://ponte.test/')]:
            with patch.dict(os.environ,config,clear=True),patch('requests.Session.request')as send:
                with SessaoOficial()as s:
                    with self.assertRaises(ValueError):s.get('https://dadosabertos.aneel.gov.br/teste')
                send.assert_not_called()


if __name__=='__main__':unittest.main()
