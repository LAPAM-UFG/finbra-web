"""Prepara os seis recortes da Educação em pastas candidatas, sem tocar a origem.

Cada arquivo continua município × ano. A rede é um recorte explícito, não uma
nova chave que quebraria xtset no Stata. O recorte padrão preserva os 77 valores
anteriores e acrescenta oito proficiências Saeb em pontos da escala oficial.
"""
import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

import educacao as e
from assistencia_utils import destino_isolado
from painel_municipal import qs, qi

NOMES_EN={'todas':'All school sectors','publica':'Public schools','municipal':'Municipal schools','estadual':'State schools','federal':'Federal schools','privada':'Private schools'}


def ler(path):return json.loads(path.read_text(encoding='utf-8'))


def incorporar_financeiro(saida,financeiro):
    destino_isolado(saida.resolve(),financeiro.resolve())
    root=saida/'gold/educacao';source=financeiro/'gold/educacao/financeiro_manifesto.json'
    m=ler(root/'manifesto.json');index=ler(source)
    assert index['versao']==1
    for ref in [index['arquivo'],index['entes'],*index['municipios'].values()]:
        path=financeiro/ref['caminho'];assert path.stat().st_size==ref['bytes'] and e.sha(path)==ref['sha256']
        dest=saida/ref['caminho']
        if dest.exists():assert e.sha(dest)==ref['sha256']
        else:shutil.copyfile(path,dest)
    m['financeiro']=e.objeto(saida,source,'financeiro_manifesto','json')
    e.json_file(root/'manifesto.json',m)


def gerar(brutos,base,saida,trabalho,retomar=False,financeiro=None):
    for a,b in [(saida,base),(saida,brutos),(trabalho,base),(trabalho,brutos),(saida,trabalho)]:destino_isolado(a.resolve(),b.resolve())
    if (saida/'gold/educacao/manifesto.json').exists() and not retomar:raise ValueError('Use uma nova pasta candidata')
    paths={}
    for rede in e.REDES:
        root=saida if rede=='todas' else trabalho/rede
        args=[sys.executable,str(Path(e.__file__)),'--brutos',str(brutos),'--saida',str(root),'--rede',rede]
        if rede=='todas':args+=['--publicado',str(base)]
        if not (retomar and (root/'gold/educacao/manifesto.json').exists()):subprocess.run(args,check=True)
        m=ler(root/'gold/educacao/manifesto.json');assert m['rede']==rede and len(m['indicadores'])==93
        assert m['coleta_sha256']==e.sha(brutos/'coleta.json')
        for ref in [m['arquivo'],m['parquet'],*m['rankings'].values(),*m['municipios'].values()]:assert e.sha(root/ref['caminho'])==ref['sha256']
        paths[rede]=(root,m)
    target=saida/'gold/educacao';target.mkdir(parents=True,exist_ok=True)
    main=paths['todas'][1];main['redes']={}
    main['edicoes_avaliacao']=sorted({y for i in main['indicadores'] if i['fonte']=='ideb' for y in i['anos']})
    db=duckdb.connect(config={'threads':2});queries=[];aggregates=[]
    for rede,(root,m) in paths.items():
        if root!=saida:
            for f in (root/'gold/educacao').iterdir():
                if f.name=='manifesto.json':continue
                dest=target/f.name
                if dest.exists():assert e.sha(dest)==e.sha(f)
                else:shutil.copyfile(f,dest)
            ref=e.objeto(saida,root/'gold/educacao/manifesto.json','rede_'+rede,'json')
            main['redes'][rede]={**ref,'nome':e.NOMES_REDE[rede],'nome_en':NOMES_EN[rede]}
        columns=','.join(qi(i['variavel']) for i in m['indicadores'])
        queries.append(f"SELECT cast(cod_ibge AS VARCHAR) grupo,'M' nivel,municipio nome,cast(cod_ibge AS INTEGER) cod_ibge,uf,cast(ano AS INTEGER) ano,{qs(rede)} rede,{columns} FROM read_parquet({qs((saida/m['parquet']['caminho']).as_posix())})")
        with (root/m['arquivo']['caminho']).open('rb') as f:
            for t in m['territorios']:
                start,size,_=t['trecho'];f.seek(start);g=json.loads(f.read(size))
                for row in g['linhas']:
                    aggregates.append(dict(grupo=t['grupo'],nivel=t['nivel'],nome=t['nome'],cod_ibge=None,uf=t['uf'],ano=row[0],rede=rede,**dict(zip([i['variavel'] for i in m['indicadores']],row[1:]))))
    aggregate_path=saida/'trabalho_educacao/agregados_redes.parquet'
    pq.write_table(pa.Table.from_pandas(pd.DataFrame(aggregates),preserve_index=False),aggregate_path,compression='zstd')
    columns=','.join(qi(i['variavel']) for i in main['indicadores'])
    queries.append(f'SELECT grupo,nivel,nome,cast(cod_ibge AS INTEGER) cod_ibge,uf,cast(ano AS INTEGER) ano,rede,{columns} FROM read_parquet({qs(aggregate_path.as_posix())})')
    ia=saida/'trabalho_educacao/consulta.parquet'
    db.execute('COPY ('+' UNION ALL '.join(queries)+') TO '+qs(ia.as_posix())+' (FORMAT PARQUET,COMPRESSION ZSTD,ROW_GROUP_SIZE 16384)')
    main['consulta']=e.objeto(saida,ia,'consulta','parquet')
    e.json_file(saida/'gold/educacao/manifesto.json',main)
    if financeiro:incorporar_financeiro(saida,financeiro)
    print(json.dumps(dict(ok=True,redes=list(paths),indicadores=85,condicoes=8,consulta=main['consulta'])),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ['brutos','base','saida','trabalho']:p.add_argument('--'+arg,type=Path,required=True)
    p.add_argument('--retomar',action='store_true',help='Reutiliza somente recortes completos e íntegros da mesma coleta')
    p.add_argument('--financeiro',type=Path,help='Candidata isolada do SIOPE pré-calculado')
    a=p.parse_args();gerar(a.brutos,a.base,a.saida,a.trabalho,a.retomar,a.financeiro)
