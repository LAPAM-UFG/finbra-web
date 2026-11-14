"""Pagamentos novos do PBF/CGU, mesma definição da silver histórica. Nenhum identificador é publicado."""
import argparse
import json
import os
import zipfile
from pathlib import Path
import duckdb
import pyarrow as pa
import pyarrow.csv as csv
from assistencia_bpc import normalizar
from assistencia_download import download_meses, competencias
from assistencia_utils import destino_isolado, sql_texto, salvar_json

def agregar(arquivo,mes,saida):
    root=destino_isolado(saida);dest=root/'silver/assistencia/pbf_cgu';dest.mkdir(parents=True,exist_ok=True)
    final=dest/f'{mes}.parquet';temp=final.with_suffix('.parquet.tmp')
    c=duckdb.connect();c.execute("SET memory_limit='2GB'");c.execute('SET threads=2')
    try:
        with zipfile.ZipFile(arquivo) as z:
            members=[x for x in z.namelist() if x.lower().endswith('.csv')];assert len(members)==1
            import csv as csv_py
            with z.open(members[0]) as f:header=next(csv_py.reader([f.readline().decode('latin1')],delimiter=';'))
            cols={normalizar(x):x for x in header};wanted=['MES_COMPETENCIA','UF','CODIGO_MUNICIPIO_SIAFI','NOME_MUNICIPIO','NIS_FAVORECIDO','VALOR_PARCELA']
            assert set(wanted)<=cols.keys(),cols.keys()
            q=lambda name:'"'+cols[name].replace('"','""')+'"'
            with z.open(members[0]) as f:
                names=[cols[x] for x in wanted]
                reader=csv.open_csv(f,read_options=csv.ReadOptions(encoding='latin1',block_size=2**24,use_threads=False),
                    parse_options=csv.ParseOptions(delimiter=';'),convert_options=csv.ConvertOptions(include_columns=names,column_types={x:pa.string() for x in names}))
                c.register('entrada',reader)
                c.execute(f'''CREATE TABLE base AS SELECT {q('MES_COMPETENCIA')}::INTEGER AS aaaamm,
                   'Novo Bolsa Família' AS programa,upper(trim({q('UF')})) AS uf,lpad(trim({q('CODIGO_MUNICIPIO_SIAFI')}),4,'0') AS siafi,
                   {q('NOME_MUNICIPIO')} AS nome_portal,nullif(trim({q('NIS_FAVORECIDO')}),'') AS nis,
                   replace(replace({q('VALOR_PARCELA')},'.',''),',','.')::DECIMAL(18,2) AS valor FROM entrada''')
            assert c.sql('SELECT min(aaaamm),max(aaaamm) FROM base').fetchall()[0]==(mes,mes)
            c.execute(f'''COPY (SELECT aaaamm,programa,uf,siafi,any_value(nome_portal) AS nome_portal,
                      CASE WHEN count(*) FILTER(WHERE nis IS NULL)>0 THEN null ELSE count(DISTINCT nis) END AS familias,
                      count(*) AS parcelas,sum(valor)::DECIMAL(20,2) AS valor FROM base GROUP BY aaaamm,programa,uf,siafi)
                      TO {sql_texto(temp.as_posix())} (FORMAT PARQUET,COMPRESSION ZSTD)''')
        os.replace(temp,final)
        salvar_json(dest/f'{mes}.json',{'competencia':mes,'fonte':'https://portaldatransparencia.gov.br/download-de-dados/novo-bolsa-familia',
                                      'linhas':c.sql('SELECT count(*) FROM base').fetchall()[0][0]})
    finally:c.close()
    return final

def atualizar(saida,base):
    root=destino_isolado(saida,base);historic=base/'silver/bolsa_familia_mensal'
    available=competencias('novo-bolsa-familia')
    have={int(x.stem) for x in historic.glob('*.parquet')}|{int(x.stem) for x in (root/'silver/assistencia/pbf_cgu').glob('*.parquet')}
    selected=[m for m in available if m not in have]
    download_meses(root,'novo-bolsa-familia',selected)
    for m in selected:agregar(root/f'landing/assistencia/novo-bolsa-familia/{m}_NovoBolsaFamilia.zip',m,root)
    return selected

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',type=Path,required=True);p.add_argument('--base',type=Path,required=True)
    a=p.parse_args();print(json.dumps({'novos':atualizar(a.saida,a.base)}),flush=True)
