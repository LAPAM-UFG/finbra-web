"""Coleta pública do Inep, sem dados pessoais: escolas e contagens agregadas.

Extrai apenas as tabelas necessárias dos ZIP oficiais, por HTTP Range. Mantém
CRC do ZIP, SHA-256 dos arquivos extraídos e URLs de origem para reprodução.
Não escreve em gold nem em dados já publicados.
"""
import argparse
import hashlib
import html
import io
import json
import re
import shutil
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

BASE = 'https://www.gov.br/inep/pt-br/'
PAGINAS = {
    'censo': BASE + 'acesso-a-informacao/dados-abertos/microdados/censo-escolar',
    'rendimento': BASE + 'acesso-a-informacao/dados-abertos/indicadores-educacionais/taxas-de-rendimento-escolar',
    'distorcao': BASE + 'acesso-a-informacao/dados-abertos/indicadores-educacionais/taxas-de-distorcao-idade-serie',
    'ideb': BASE + 'areas-de-atuacao/pesquisas-estatisticas-e-indicadores/ideb/resultados',
}


def sessao():
    s = requests.Session()
    s.mount('http://', HTTPAdapter(max_retries=Retry(total=4, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
    s.mount('https://', HTTPAdapter(max_retries=Retry(total=4, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])))
    s.headers.update({'User-Agent': 'Mozilla/5.0', 'Accept-Encoding': 'identity', 'Connection': 'close'})
    return s


def links(text):
    return [(html.unescape(u), html.unescape(re.sub('<.*?>', '', t)).strip())
            for u, t in re.findall(r'<a\b[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>', text, re.S)]


def pagina(url):
    r = sessao().get(url, timeout=60)
    r.raise_for_status()
    return r.text


class ZipRemoto(io.RawIOBase):
    """ZIP de leitura, exige resposta Range exata e recusa transferência integral."""
    def __init__(self, url):
        self.url = url.replace('https://download.inep.gov.br/', 'http://download.inep.gov.br/') + '?verificacao=educacao'
        self.s = sessao()
        self.pos = 0
        with self.s.get(self.url, headers={'Range': 'bytes=0-0'}, timeout=90, stream=True) as r:
            r.raise_for_status()
            if r.status_code != 206 or not re.fullmatch(r'bytes 0-0/\d+', r.headers.get('Content-Range', '')):
                raise ValueError('A origem não permite leitura por trecho: ' + url)
            self.tamanho = int(r.headers['Content-Range'].split('/')[-1])
            self.etag = r.headers.get('ETag')

    def seekable(self):
        return True

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.tamanho + offset
        return self.pos

    def tell(self):
        return self.pos

    def read(self, size=-1):
        end = self.tamanho if size < 0 else min(self.tamanho, self.pos + size)
        if end <= self.pos:
            return b''
        def trecho(bounds):
            start,stop=bounds;headers={'Range':f'bytes={start}-{stop-1}'}
            headers['Connection']='close'
            for attempt in range(3):
                try:
                    with requests.get(self.url,headers=headers,timeout=(10,30),stream=True) as r:
                        r.raise_for_status()
                        if r.status_code!=206 or r.headers.get('Content-Range')!=f'bytes {start}-{stop-1}/{self.tamanho}':
                            raise ValueError('Trecho inválido ou origem alterada: '+self.url)
                        if self.etag and r.headers.get('ETag') and r.headers['ETag']!=self.etag:raise ValueError('Versão da origem alterada')
                        data=r.content
                        if len(data)!=stop-start:raise ValueError('Trecho incompleto: '+self.url)
                        return data
                except requests.RequestException:
                    if attempt==2:raise
        if end-self.pos>1024*1024:
            step=1024*1024
            with ThreadPoolExecutor(max_workers=3) as pool:
                data=b''.join(pool.map(trecho,[(a,min(a+step,end)) for a in range(self.pos,end,step)]))
        else:data=trecho((self.pos,end))
        self.pos = end
        return data


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def extrair_censo(job):
    year, url, root = job
    folder = root / str(year)
    folder.mkdir(parents=True, exist_ok=True)
    record = folder / 'origem.json'
    if record.exists():
        old = json.loads(record.read_text(encoding='utf-8'))
        adicionais = year < 2025 or all(any(re.search('Tabela_'+tipo+'_',f['nome'],re.I) for f in old['arquivos']) for tipo in ['Docente','Turma'])
        if old['url'] == url and adicionais and all((folder / f['nome']).is_file() and sha(folder/f['nome']) == f['sha256'] for f in old['arquivos']):
            print(f'Censo {year}: cache conferido', flush=True)
            return old
    remote = ZipRemoto(url)
    files = []
    with zipfile.ZipFile(remote) as z:
        for item in z.infolist():
            name = Path(item.filename).name
            csv = name.lower().endswith('.csv') and ('microdados_ed_basica' in name.lower() or re.search('Tabela_(Escola|Matricula|Docente|Turma)_', name, re.I))
            dictionary = name.endswith('.xlsx') and 'Dicion' in item.filename
            check = name.startswith('md5_')
            if not (csv or dictionary or check):
                continue
            target = folder / ('dicionario_'+hashlib.sha256(item.filename.encode('utf-8')).hexdigest()[:8]+'.xlsx' if dictionary else name)
            # Uma coleta interrompida pode reaproveitar membros já concluídos,
            # mas apenas depois de conferir o CRC atual do ZIP oficial.
            if target.is_file() and target.stat().st_size==item.file_size:
                crc=0
                with target.open('rb') as cached:
                    for block in iter(lambda:cached.read(8*1024*1024),b''):crc=zlib.crc32(block,crc)
                if crc==item.CRC:
                    files.append(dict(nome=target.name,membro=item.filename,bytes=item.file_size,crc32=f'{item.CRC:08x}',sha256=sha(target)))
                    continue
            partial = target.with_suffix(target.suffix + '.part')
            with z.open(item) as src, partial.open('wb') as dst:
                total=0
                while block:=src.read(8*1024*1024):
                    dst.write(block);total+=len(block)
                    if item.file_size>100*1024*1024 and total%(32*1024*1024)==0:
                        print(f'Censo {year}: {name} {total/1024**2:.0f}/{item.file_size/1024**2:.0f} MiB',flush=True)
            if partial.stat().st_size != item.file_size:
                raise ValueError('Arquivo extraído incompleto: ' + name)
            partial.replace(target)
            files.append(dict(nome=target.name, membro=item.filename, bytes=item.file_size, crc32=f'{item.CRC:08x}', sha256=sha(target)))
    if not any(x['nome'].lower().endswith('.csv') for x in files):
        raise ValueError('Tabela de escolas não localizada: ' + url)
    result = dict(fonte='censo', ano=year, url=url, transporte=remote.url, zip_bytes=remote.tamanho, arquivos=files)
    record.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Censo {year}: {sum(x["bytes"] for x in files)/1e6:.1f} MB extraídos e CRC conferido', flush=True)
    return result


def baixar_indicador(job):
    kind, year, url, root = job
    folder = root / kind
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / url.split('/')[-1]
    marker = path.with_suffix(path.suffix + '.json')
    if marker.exists():
        old = json.loads(marker.read_text(encoding='utf-8'))
        if path.is_file() and sha(path) == old['sha256']:
            return old
    remote=ZipRemoto(url)
    partial=path.with_suffix(path.suffix+'.part')
    checkpoint=partial.with_suffix(partial.suffix+'.json')
    identity=dict(url=url,etag=remote.etag,bytes=remote.tamanho)
    resume=partial.is_file() and checkpoint.is_file() and json.loads(checkpoint.read_text(encoding='utf-8'))==identity and partial.stat().st_size<=remote.tamanho
    offset=partial.stat().st_size if resume else 0
    checkpoint.write_text(json.dumps(identity),encoding='utf-8');remote.seek(offset)
    with partial.open('ab' if resume else 'wb') as f:
        while block:=remote.read(min(8*1024*1024,remote.tamanho-remote.tell())):f.write(block)
    if partial.stat().st_size!=remote.tamanho:raise ValueError('Arquivo incompleto: '+url)
    if path.suffix == '.zip':
        with zipfile.ZipFile(partial) as z:
            if z.testzip():
                raise ValueError('CRC inválido: ' + url)
    partial.replace(path)
    result = dict(fonte=kind, ano=year, url=url, caminho=str(path), bytes=path.stat().st_size, sha256=sha(path))
    marker.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'{kind} {year}: {path.name}', flush=True)
    return result


def coletar(root, inicio=2013, fim=2025):
    root = root.resolve()
    if any(p.lower()=='gold' for p in root.parts):
        raise ValueError('A coleta bruta não pode escrever em gold')
    root.mkdir(parents=True, exist_ok=True)
    jobs = []
    for url, title in links(pagina(PAGINAS['censo'])):
        match = re.search(r'microdados_censo_escolar_(\d{4})_?\.zip$', url)
        if match and inicio <= int(match[1]) <= fim:
            jobs.append((int(match[1]), url, root))
    if {j[0] for j in jobs} != set(range(inicio, fim+1)):
        raise ValueError('O catálogo oficial não contém todos os anos pedidos')
    with ThreadPoolExecutor(max_workers=3) as pool:
        census = list(pool.map(extrair_censo, sorted(jobs)))
    tasks = []
    for kind in ['rendimento', 'distorcao']:
        def ano(year):
            page = pagina(PAGINAS[kind] + '/' + str(year))
            found = []
            for url, title in links(page):
                if re.search(r'\.zip$|\.xlsx?$', url, re.I) and ('Munic' in title or 'munic' in url.lower() or 'regi' in title.lower() or 'ufs' in url.lower()):
                    found.append((kind, year, url, root))
            if len(found) != 2:
                raise ValueError(f'Esperados dois recortes oficiais: {kind} {year}; encontrados {found}')
            return found
        with ThreadPoolExecutor(max_workers=3) as pool:
            for found in pool.map(ano, range(inicio, fim+1)):
                tasks.extend(found)
    page = pagina(PAGINAS['ideb'])
    tabs = re.findall(r'data-url="([^"]+)"', page)
    tab = next(u for u in tabs if re.search(r'2005-\d{4}$', u))
    for url, title in links(pagina(tab)):
        if url.endswith('.zip') and ('municipios' in url or 'brasil_ideb' in url or 'regioes_ufs_ideb' in url):
            tasks.append(('ideb', fim, url, root))
    with ThreadPoolExecutor(max_workers=3) as pool:
        indicators = list(pool.map(baixar_indicador, tasks))
    result = dict(gerado_em=datetime.now(timezone.utc).isoformat(), fontes=PAGINAS, censo=census, indicadores=indicators)
    (root/'coleta.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--saida', type=Path, required=True)
    p.add_argument('--inicio', type=int, default=2013)
    p.add_argument('--fim', type=int, default=2025)
    args = p.parse_args()
    result = coletar(args.saida, args.inicio, args.fim)
    print(f'Coleta concluída: {len(result["censo"])} anos de Censo e {len(result["indicadores"])} arquivos de indicadores.')
