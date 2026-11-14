"""Mantém a assistência social no manifesto quando o gold financeiro é reconstruído."""
import hashlib
import json
import re
from pathlib import Path

def fonte_assistencia(gold: Path):
    path=gold/'assistencia/fonte.json'
    if not path.exists():return {}
    fonte=json.loads(path.read_text(encoding='utf-8'))
    if fonte.get('versao')!=1:raise ValueError('Versão desconhecida da assistência social')
    root=gold.parent.resolve()
    objects=[fonte['abertura'],*fonte['arquivos'].values()]
    def conferir(obj):
        name=obj.get('caminho','');sha=obj.get('sha256','')
        if not re.fullmatch(r'gold/assistencia/[a-z0-9_]+\.(json|parquet|ndjson)',name) or not re.fullmatch('[0-9a-f]{64}',sha):
            raise ValueError('Descritor da assistência social inválido')
        candidate=root/name
        if not candidate.is_file() or candidate.stat().st_size!=obj['bytes']:
            raise ValueError('Pacote de assistência social incompleto: '+name)
        with candidate.open('rb') as stream:
            if hashlib.file_digest(stream,'sha256').hexdigest()!=sha:raise ValueError('Arquivo da assistência social alterado: '+name)
    for obj in objects:conferir(obj)
    index=json.loads((root/fonte['abertura']['caminho']).read_text(encoding='utf-8'))
    body=index['arquivo'];body_path=root/body['caminho']
    if not re.fullmatch(r'gold/assistencia/abertura_[a-f0-9]{12}\.ndjson',body['caminho']) or not body_path.is_file() or body_path.stat().st_size!=body['bytes']:
        raise ValueError('Abertura de assistência social incompleta')
    conferir(body)
    for source in index['rankings'].values():
        for obj in source.values():conferir(obj)
    return {'assistencia':fonte}
