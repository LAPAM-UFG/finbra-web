"""Receitas de RAIS, IBGE, Previdência, SIOPE e SIOPS em cópias isoladas."""
import argparse
import ftplib
import json
import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb
import pandas as pd

from assistencia_utils import salvar_json
from atualizacao_artefatos import instalar_overlay,sha
from automacao_temas import guardar,ler
from automacao_insumos import caminho_relativo


def fixar_silver(ctx,prefixos):
    from publicacao_lote import inventario
    inv=inventario(ctx.cache.client,ctx.cache.bucket)
    selected=[k for k in inv if k.startswith(tuple(prefixos))]
    if not selected:raise ValueError('Entradas publicadas ausentes: '+str(prefixos))
    def obter(k):
        p=ctx.snapshot.obter_r2(ctx.cache.client,ctx.cache.bucket,k,inv[k]);target=ctx.base/k
        if p.resolve()!=target.resolve():target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,target)
    with ThreadPoolExecutor(max_workers=4)as pool:list(pool.map(obter,selected))


def fiscal(ctx):
    fixar_silver(ctx,('silver/dca/','silver/contas/','silver/populacao/','silver/bolsa_familia_mensal/'))
    original=ler(ctx.base/'gold/manifesto.json')
    ctx.executar('gold.py',data_dir=ctx.base)
    current=ler(ctx.base/'gold/manifesto.json')
    # O gold fiscal não é o dono das edições dos outros temas.
    original.update({k:current[k]for k in ['anos','colunas','mapa_indicadores','politica_alertas']if k in current})
    for k in ['ibge_populacao','ibge_pib','inss','populacao_declarada']:
        if k in current['fontes']:original['fontes'][k]=current['fontes'][k]
    salvar_json(ctx.base/'gold/manifesto.json',original)


def ibge(ctx):
    # APIs retornam os períodos publicados; não pressupõe um ano pela data local.
    ctx.executar('automacao_nucleo.py','ibge','--saida',ctx.fontes,data_dir=ctx.base)
    names=['ibge_populacao.parquet','ibge_pib.parquet'];evidence={p:sha(ctx.fontes/p)for p in names}
    changed=ctx.mudou(evidence,codigo=('externos.py','gold.py'))
    if changed:
        for name in names:shutil.copy2(ctx.fontes/name,ctx.base/'silver'/name)
        fiscal(ctx)
    guardar(ctx,names);return changed


def previdencia(ctx):
    closed=datetime.now(ZoneInfo('America/Sao_Paulo')).year-1;old=ler(ctx.base/'gold/manifesto.json')['fontes']['inss'];last=max(old.get('anos',[closed]))
    ctx.executar('automacao_nucleo.py','previdencia','--saida',ctx.raiz/'temporario','--anos',*range(last-1,closed+1),data_dir=ctx.base)
    key='silver/inss_municipios.parquet';changed=ctx.mudou(sha(ctx.base/key),codigo=('familias.py','gold.py'))
    if changed:fiscal(ctx)
    target=ctx.fontes/'inss_municipios.parquet';shutil.copy2(ctx.base/key,target);guardar(ctx,[target.name]);return changed


def educacao_saude(ctx):
    area=ctx.rotina.id;closed=datetime.now(ZoneInfo('America/Sao_Paulo')).year-1
    old=ler(ctx.base/'gold/manifesto.json')['fontes'][area];last=max(old['anos'])
    fixar_silver(ctx,('silver/'+area+'/',))
    before={p.relative_to(ctx.base).as_posix():sha(p)for p in(ctx.base/('gold/'+area)).glob('*.parquet')}
    ctx.executar(area+'.py','--anos',f'{last-1}-{closed}','--refazer',data_dir=ctx.base)
    after={p.relative_to(ctx.base).as_posix():sha(p)for p in(ctx.base/('gold/'+area)).glob('*.parquet')}
    changed=ctx.mudou(after,codigo=(area+'.py',))
    if area=='siope'and changed:
        from educacao_financeiro import gerar
        from educacao_redes import incorporar_financeiro
        out=ctx.raiz/'financeiro';gerar(ctx.base,out)
        # A operação só modifica o bloco financeiro da Educação.
        school=ctx.raiz/'painel';target=school/'gold/educacao/manifesto.json';target.parent.mkdir(parents=True);shutil.copy2(ctx.base/'gold/educacao/manifesto.json',target)
        incorporar_financeiro(school,out);ctx.aplicar(school)
    guardar(ctx,[]);return changed or before!=after


def rais(ctx):
    from trabalho import remotos,FTP
    closed=datetime.now(ZoneInfo('America/Sao_Paulo')).year-1;m=ler(ctx.base/'gold/manifesto.json');last=max(m['fontes']['rais']['anos']);refs=[]
    with ftplib.FTP(FTP,timeout=180,encoding='latin-1')as ftp:
        ftp.login()
        for year in range(last-1,closed+1):
            folder=f'/pdet/microdados/RAIS/{year}/'
            try:files=remotos(folder)
            except ftplib.error_perm as e:
                if year>last and str(e).startswith('550'):continue
                raise
            selected={n:s for n,s in files.items()if n.lower().endswith('.7z')}
            estab=[n for n in selected if 'ESTAB'in n.upper()or n.upper().startswith('ESTB')]
            if len(estab)!=1 or not set(selected)-set(estab):raise ValueError('Edição RAIS com organização nova ou incompleta: revisar o leiaute')
            for name,size in selected.items():
                refs.append(dict(ano=year,arquivo=caminho_relativo(f'rais/{year}/{name}'),remoto=folder+name,bytes=size,modificado=ftp.sendcmd('MDTM '+folder+name)))
    changed=ctx.mudou(refs,codigo=('trabalho.py','microdados.py','trabalho_perfis.py','revisao_rais.py'))
    if changed:
        raw=ctx.raiz/'brutos';raw.mkdir()
        for ref in refs:
            target=raw/ref['arquivo'];target.parent.mkdir(parents=True,exist_ok=True);tmp=target.with_name(target.name+'.parte')
            with ftplib.FTP(FTP,timeout=180,encoding='latin-1')as ftp:
                ftp.login()
                with tmp.open('wb')as f:ftp.retrbinary('RETR '+ref['remoto'],f.write,blocksize=1024*1024)
                if tmp.stat().st_size!=ref['bytes']or ftp.sendcmd('MDTM '+ref['remoto'])!=ref['modificado']:raise ValueError('RAIS mudou durante a aquisição')
            os.replace(tmp,target);ref['sha256']=sha(target)
        fixar_silver(ctx,('silver/trabalho/rais_vinculos/','silver/trabalho/rais_estab/','silver/trabalho/caged/','silver/trabalho/caged_cbo/'))
        # Conserva os perfis antigos no índice; só refaz os anos coletados.
        old=m['fontes']['rais_perfis'];ctx.raiz_fonte(old['indice'])
        perfis=ctx.raiz/'perfis/gold/trabalho/perfis_v2_validos';perfis.mkdir(parents=True)
        shutil.copy2(ctx.fontes/old['indice'],perfis/'indice.json')
        for year in old['anos']:shutil.copy2(ctx.raiz_fonte(old['arquivos'].replace('{ano}',str(year))),perfis/f'ano={year}.parquet')
        micro_index='silver/trabalho/micro/indice.json';previous_index=ler(ctx.raiz_fonte(micro_index))
        ctx.executar('automacao_nucleo.py','rais','--base',ctx.base,'--saida',ctx.raiz/'perfis','--brutos',raw,'--micro',ctx.raiz/'micro','--anos',*sorted({r['ano']for r in refs}),data_dir=ctx.base)
        instalar_overlay(ctx.raiz/'perfis',ctx.base)
        instalar_overlay(ctx.raiz/'micro',ctx.base)
        current_index=ler(ctx.base/micro_index)
        for table,years in current_index.items():previous_index.setdefault(table,{}).update(years)
        salvar_json(ctx.base/micro_index,previous_index)
        # Reaplica o denominador de remuneração válida em todos os perfis/setores.
        from revisao_rais import gerar
        out=ctx.raiz/'remuneracao';gerar(ctx.base,ctx.base/'silver/trabalho',out);ctx.aplicar(out,('rais','rais_perfis'))
        new=ler(ctx.base/'gold/manifesto.json');years={r['ano']for r in refs}
        new['fontes']['rais_micro']={**m['fontes']['rais_micro'],'anos':sorted(set(m['fontes']['rais_micro']['anos'])|years),'esc_porte':sorted(set(m['fontes']['rais_micro'].get('esc_porte',[]))|years),'processado_em':datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat()};salvar_json(ctx.base/'gold/manifesto.json',new)
        ctx.descartar_temporario(raw);ctx.descartar_temporario(ctx.raiz/'micro')
    salvar_json(ctx.fontes/'fontes_rais.json',refs);guardar(ctx,['fontes_rais.json']);return changed


def validar_rais(con,base,anos):
    expected={11,12,13,14,15,16,17,21,22,23,24,25,26,27,28,29,31,32,33,35,41,42,43,50,51,52,53}
    for year in anos:
        for table in ('rais_vinculos','rais_estab'):
            path=Path(base)/f'silver/trabalho/{table}/ano={year}.parquet'
            present={r[0]for r in con.execute('SELECT DISTINCT municipio//10000 FROM read_parquet(?) WHERE ano=?',[str(path),year]).fetchall()}
            if not expected<=present:raise ValueError(f'RAIS {year}: UFs ausentes em {table}: {sorted(expected-present)}')


def worker(args):
    if args.acao=='ibge':
        import externos
        for name,func in [('ibge_populacao',externos.populacao_ibge),('ibge_pib',externos.pib)]:
            df=func();keys=['ano'if name=='ibge_populacao'else'exercicio','cod_ibge']
            if df.empty or df.duplicated(keys).any():raise ValueError('IBGE sem chave única')
            df.sort_values(keys).to_parquet(args.saida/(name+'.parquet'),index=False,compression='zstd')
    elif args.acao=='previdencia':
        from familias import inss,PREVIDENCIA
        from atualizacao_fontes import HTTP
        from config import GOLD
        last=max(ler(GOLD/'manifesto.json')['fontes']['inss']['anos'])
        required={PREVIDENCIA.format(ano=y)for y in args.anos if y<=last}
        def obter(url,dest):
            with HTTP.get(url,stream=True,timeout=(30,180))as response:
                if response.status_code==404 and url not in required:return False
                response.raise_for_status()
                with dest.open('wb')as f:
                    for chunk in response.iter_content(1024*1024):f.write(chunk)
                if not response.headers.get('Content-Encoding')and response.headers.get('Content-Length')and dest.stat().st_size!=int(response.headers['Content-Length']):raise ValueError('Planilha INSS truncada')
            return True
        args.saida.mkdir();inss(args.anos,args.saida,baixador=obter)
    elif args.acao=='rais':
        import trabalho as t
        import microdados as micro
        import trabalho_perfis as p
        c=duckdb.connect(config={'memory_limit':'3GB','threads':3});c.execute('SET preserve_insertion_order=false')
        c.execute("SET temp_directory='"+(args.brutos/'temporario_duckdb').as_posix()+"'")
        try:
            for year in args.anos:
                if not t.completo(list((args.brutos/f'rais/{year}').glob('*.7z')),f'/pdet/microdados/RAIS/{year}/',True):raise ValueError('Catálogo RAIS mudou durante a aquisição: '+str(year))
            t.processar_rais(c,args.brutos,True,True);validar_rais(c,args.base,args.anos);t.gerar_gold(c)
            path=args.micro/'silver/trabalho/micro'
            micro.processar_rais(c,args.brutos,path,args.anos,True,True)
            micro.escrever_indice(path)
            micro.gerar_cubos(c,path,args.base/'gold/trabalho',args.anos,True)
            p.executar(args.micro,args.base,args.saida,args.anos,threads=3,memoria='3GB',refazer=True,versao=2)
        finally:c.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('acao',choices=['ibge','previdencia','rais'])
    for name in ['base','saida','micro','brutos']:p.add_argument('--'+name,type=Path)
    p.add_argument('--anos',nargs='+',type=int);worker(p.parse_args())
