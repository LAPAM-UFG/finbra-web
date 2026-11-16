"""Fontes oficiais SNIS/SINISA, fixadas por URL e SHA-256. Sem escrita no gold.

python pipeline/saneamento_baixar.py --saida E:/finbra/fontes_saneamento
Arquivos RAR são lidos com o 7-Zip instalado; nenhuma planilha é executada.
"""
import argparse
import hashlib
import io
import json
import shutil
import subprocess
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from assistencia_utils import destino_isolado

CATALOGO=Path(__file__).with_name('saneamento_fontes.json')
def sha(b):return hashlib.sha256(b).hexdigest()

def baixar(ref,saida):
    target=saida/ref['arquivo']
    if target.exists() and sha(target.read_bytes())==ref['sha256']:return target
    with requests.get(ref['url'],headers={'User-Agent':'Finbra-Saneamento/1.0'},timeout=(20,180)) as r:
        r.raise_for_status();data=r.content
    if sha(data)!=ref['sha256']:raise ValueError('A fonte mudou; revisar a nova edição antes de substituir: '+ref['url'])
    temp=target.with_suffix(target.suffix+'.parcial');temp.write_bytes(data);temp.replace(target)
    return target

def conteudos(data,nome='',nivel=0):
    if nivel>5:raise ValueError('Arquivo com camadas demais')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for item in z.infolist():
            if item.is_dir():continue
            if item.file_size>500_000_000:raise ValueError('Planilha grande demais')
            n=item.filename;ext=Path(n).suffix.lower()
            if ext=='.zip':yield from conteudos(z.read(n),nome+n+'!',nivel+1)
            elif ext in ['.xls','.xlsx','.pdf']:yield nome+n,z.read(n)

def planilhas(arquivo):
    ext=arquivo.suffix.lower()
    if ext=='.zip':yield from conteudos(arquivo.read_bytes())
    elif ext=='.rar':
        exe=shutil.which('7z') or 'C:/Program Files/7-Zip/7z.exe'
        if not Path(exe).exists():raise ValueError('7-Zip necessário para ler os RAR oficiais')
        listing=subprocess.run([exe,'l','-slt',str(arquivo)],capture_output=True,check=True).stdout.decode('utf-8',errors='replace')
        for line in listing.splitlines():
            if not line.startswith('Path = '):continue
            name=line[7:]
            if Path(name).suffix.lower() not in ['.xls','.xlsx','.pdf','.zip']:continue
            raw=subprocess.run([exe,'e','-so','-bd',str(arquivo),name],capture_output=True,check=True).stdout
            if Path(name).suffix.lower()=='.zip':yield from conteudos(raw,name+'!')
            else:yield name,raw
    elif ext in ['.xlsx','.xls','.pdf']:yield arquivo.name,arquivo.read_bytes()

def extrair(origem,saida,catalogo=None):
    origem=Path(origem).resolve();saida=destino_isolado(Path(saida),origem);saida.mkdir(parents=True,exist_ok=True)
    refs=catalogo or json.loads(CATALOGO.read_text(encoding='utf-8'));out=[]
    for ref in refs:
        raw=origem/ref['arquivo']
        if sha(raw.read_bytes())!=ref['sha256']:raise ValueError('Fonte local alterada: '+str(raw))
        for nome,data in planilhas(raw):
            digest=sha(data);target=saida/(digest+Path(nome).suffix.lower())
            if not target.exists():target.write_bytes(data)
            out.append({**ref,'membro':nome,'extraido':target.name,'extraido_sha256':digest})
    (saida/'indice.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',required=True,type=Path);p.add_argument('--extrair',type=Path);a=p.parse_args()
    output=destino_isolado(a.saida);output.mkdir(parents=True,exist_ok=True)
    refs=json.loads(CATALOGO.read_text(encoding='utf-8'))
    with ThreadPoolExecutor(max_workers=5) as pool:list(pool.map(lambda r:baixar(r,output),refs))
    if a.extrair:print('Extraídos',len(extrair(output,a.extrair,refs)))
