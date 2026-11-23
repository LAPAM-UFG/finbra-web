"""Transporte opcional de fontes públicas por uma ponte privada com TLS."""
import hashlib
import hmac
import os
from urllib.parse import urlencode,urlsplit

import requests
from requests.structures import CaseInsensitiveDict


class SessaoOficial(requests.Session):
    def request(self,method,url,**kwargs):
        proxy=os.environ.get('FINBRA_FONTE_PROXY_URL')
        if proxy and urlsplit(url).hostname=='dadosabertos.aneel.gov.br':
            p=urlsplit(proxy)
            if p.scheme!='https'or not p.hostname or p.username or p.password or p.query or p.fragment:
                raise ValueError('A ponte de coleta exige uma URL HTTPS sem credenciais ou parâmetros')
            secret=os.environ.get('R2_SECRET_ACCESS_KEY')
            if not secret:raise ValueError('Credencial de coleta ausente')
            target=requests.Request(method,url,params=kwargs.pop('params',None)).prepare().url
            token=hmac.new(secret.encode(),b'finbra-fontes-v1',hashlib.sha256).hexdigest()
            headers=CaseInsensitiveDict(kwargs.pop('headers',None)or{})
            headers.pop('Cookie',None);headers['Authorization']='Bearer '+token;headers['Accept-Encoding']='identity'
            kwargs.pop('cookies',None);kwargs.pop('auth',None)
            return super().request(method,proxy+'?'+urlencode({'url':target}),headers=headers,**kwargs)
        return super().request(method,url,**kwargs)
