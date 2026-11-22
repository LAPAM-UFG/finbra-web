"""Aquisição versionada das fontes mensais e das edições MUNIC/ESTADIC.

Só grava em pasta de trabalho. Disponibilidade vem dos catálogos oficiais,
nunca de completar meses ausentes. Dados individuais do PBF não são publicados.
"""
import calendar
import ftplib
import hashlib
import json
import os
import re
from datetime import date,datetime,timezone
from pathlib import Path

import requests
from assistencia_utils import destino_isolado


def baixar(url,path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);tmp=path.with_name(path.name+'.parte')
    with requests.get(url,headers={'Accept-Encoding':'identity'},stream=True,timeout=(20,180)) as r:
        r.raise_for_status()
        with tmp.open('wb') as f:
            for chunk in r.iter_content(1024*1024):f.write(chunk)
        if r.headers.get('Content-Length') and tmp.stat().st_size!=int(r.headers['Content-Length']):raise ValueError('download incompleto: '+url)
        meta=dict(url=url,bytes=tmp.stat().st_size,etag=r.headers.get('ETag'),last_modified=r.headers.get('Last-Modified'),sha256=hashlib.sha256(tmp.read_bytes()).hexdigest())
    os.replace(tmp,path);path.with_name(path.name+'.fonte.json').write_text(json.dumps(meta,ensure_ascii=False),encoding='utf-8');return meta


def anterior(meses,quantidade):
    y,m=divmod(int(meses),100);serial=y*12+m-1
    if not 1<=m<=12 or quantidade<1:raise ValueError('janela mensal inválida')
    return [s//12*100+s%12+1 for s in range(serial-quantidade+1,serial+1)]


def caged_disponivel(ano=None):
    ano=ano or date.today().year;result=[]
    with ftplib.FTP('ftp.mtps.gov.br',timeout=90,encoding='latin-1') as ftp:
        ftp.login()
        for year in [ano-1,ano]:
            try:dirs=ftp.nlst(f'/pdet/microdados/NOVO CAGED/{year}/')
            except ftplib.error_perm:continue
            for folder in dirs:
                name=folder.rstrip('/').rsplit('/',1)[-1]
                if not re.fullmatch(r'20\d{4}',name):continue
                folder=f'/pdet/microdados/NOVO CAGED/{year}/{name}/'
                try:files=ftp.nlst(folder)
                except ftplib.error_perm:continue
                names=[p.rsplit('/',1)[-1].upper() for p in files]
                if f'CAGEDMOV{name}.7Z' in names and f'CAGEDFOR{name}.7Z' in names and f'CAGEDEXC{name}.7Z' in names:result.append(int(name))
    if not result:raise ValueError('catálogo Caged sem competência completa')
    return sorted(set(result))


def baixar_caged(raiz,ate,janela=3):
    raiz=destino_isolado(Path(raiz));out=[]
    with ftplib.FTP('ftp.mtps.gov.br',timeout=180,encoding='latin-1') as ftp:
        ftp.login()
        for month in anterior(ate,janela):
            folder=f'/pdet/microdados/NOVO CAGED/{month//100}/{month}/'
            names=ftp.nlst(folder)
            selected=[p for p in names if re.fullmatch(r'CAGED(MOV|FOR|EXC)'+str(month)+r'\.7z',p.rsplit('/',1)[-1],re.I)]
            if len(selected)!=3:raise ValueError('três arquivos Caged são necessários: '+str(month))
            for remote in selected:
                name=remote.rsplit('/',1)[-1];p=raiz/'caged'/str(month)/name;p.parent.mkdir(parents=True,exist_ok=True)
                size=ftp.size(remote);version=ftp.sendcmd('MDTM '+remote);tmp=p.with_name(p.name+'.parte')
                with tmp.open('wb') as f:ftp.retrbinary('RETR '+remote,f.write,blocksize=1024*1024)
                if not size or tmp.stat().st_size!=size:raise ValueError('arquivo Caged incompleto: '+name)
                os.replace(tmp,p);out.append(dict(arquivo=name,bytes=size,mdtm=version,sha256=hashlib.sha256(p.read_bytes()).hexdigest(),url='ftp://ftp.mtps.gov.br'+remote))
    return out


def gestao_disponivel(pesquisa,ano=None):
    if pesquisa not in ['munic','estadic']:raise ValueError('pesquisa inválida')
    for year in range((ano or date.today().year)-1,2012,-1):
        prefix='Perfil_Municipios' if pesquisa=='munic' else 'Perfil_Estados'
        name=f'Base_MUNIC_{year}.xlsx' if pesquisa=='munic' else f'Base_Estadic_{year}.xlsx'
        url=f'https://ftp.ibge.gov.br/{prefix}/{year}/'+('Base_de_Dados/' if pesquisa=='munic' else '')+name
        r=requests.head(url,timeout=(15,30))
        if r.status_code==200:return year,url
        if r.status_code not in [403,404]:r.raise_for_status()
    raise ValueError('edição oficial não localizada: '+pesquisa)


def baixar_gestao(raiz):
    raiz=destino_isolado(Path(raiz));out=[]
    for pesquisa in ['munic','estadic']:
        year,url=gestao_disponivel(pesquisa);name=url.rsplit('/',1)[-1]
        ref=baixar(url,raiz/pesquisa/(str(year)+'_'+name));out.append(dict(pesquisa=pesquisa,ano=year,**ref))
    return out


def clima_disponivel():
    url='https://cds.climate.copernicus.eu/api/catalogue/v1/collections/reanalysis-era5-land-monthly-means'
    r=requests.get(url,timeout=(20,60));r.raise_for_status();catalog=r.json();end=catalog['extent']['temporal']['interval'][0][1];month=int(end[:4])*100+int(end[5:7])
    for candidate in reversed(anterior(month,3)):
        y,m=divmod(candidate,100);rain=f'https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/latam/tifs/chirps-v3.0.{y}.{m:02}.tif'
        with requests.get(rain,headers={'Range':'bytes=0-3'},stream=True,timeout=(20,60)) as h:
            if h.status_code==404:continue
            h.raise_for_status();magic=next(h.iter_content(4),b'')
            if magic not in [b'II*\x00',b'MM\x00*',b'II+\x00',b'MM\x00+']:raise ValueError('CHIRPS não entregou TIFF')
            return dict(ate=candidate,era5_atualizado=catalog.get('updated'),chuva=rain)
    raise ValueError('não há competência final comum entre ERA5 e CHIRPS')


def baixar_clima(raiz,ate,malha,desde=None):
    import clima_era5
    raiz=destino_isolado(Path(raiz));destino_isolado(raiz,Path(malha))
    desde=desde or ate;clima_era5.BRUTOS=raiz/'era5';status='mantido'
    for year in range(desde//100,ate//100+1):
        month=ate%100 if year==ate//100 else 12;alvo=clima_era5.BRUTOS/'mensal'/f'{year}.nc';alvo.parent.mkdir(parents=True,exist_ok=True)
        pedido=clima_era5.completar(dict(product_type='monthly_averaged_reanalysis',variable=clima_era5.MENSAL,year=str(year),month=[f'{m:02}' for m in range(1,month+1)],time='00:00'))
        status=clima_era5.obter('reanalysis-era5-land-monthly-means',pedido,alvo)
        if status not in ['baixado','igual','mantido'] or (year,month) not in (clima_era5.meses_do_arquivo(alvo) or set()):raise ValueError('ERA5 não cobre a competência final anunciada')
        for m in range(desde%100 if year==desde//100 else 1,month+1):
            baixar(f'https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/latam/tifs/chirps-v3.0.{year}.{m:02}.tif',raiz/'chirps'/f'chirps-v3.0.{year}.{m:02}.tif')
    import shutil
    target=raiz/'malha/BR_Municipios_2022.zip';target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(malha,target)
    return dict(ate=ate,era5_status=status)
