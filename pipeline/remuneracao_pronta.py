"""Respostas exatas dos recortes usuais da RAIS, sem médias de medianas.

Lê somente fontes locais conferidas pelo chamador; preserva zeros e ausências.
Cada município/UF recebe um trecho gzip independente com as quatro dimensões.
"""
import json
from pathlib import Path
import duckdb
from abertura_paineis import Escritor,compatibilidade

DIMENSOES={
 'sexo':'sexo::VARCHAR', 'raca_cor':'raca_cor::VARCHAR',
 'escolaridade':'escolaridade::VARCHAR',
 'faixa_idade':"CASE WHEN idade<18 THEN '1' WHEN idade<25 THEN '2' WHEN idade<30 THEN '3' WHEN idade<40 THEN '4' WHEN idade<50 THEN '5' WHEN idade<65 THEN '6' WHEN idade IS NOT NULL THEN '7' END",
}
MEDIDAS="""count(*)::DOUBLE AS vinculos,count(*)::DOUBLE AS ativos,
 sum(rem_dezembro_nom) FILTER(rem_dezembro_nom>0)::DOUBLE AS rem_dez_soma,
 count(*) FILTER(rem_dezembro_nom>0)::DOUBLE AS n_rem_dez,
 count(*) FILTER(rem_dezembro_nom IS NULL)::DOUBLE AS rem_dez_ausente,
 count(*) FILTER(rem_dezembro_nom=0)::DOUBLE AS rem_dez_zero,
 count(*) FILTER(rem_dezembro_nom<0)::DOUBLE AS rem_dez_negativa,
 avg(rem_dezembro_nom) FILTER(rem_dezembro_nom>0)::DOUBLE AS rem_dez_media,
 quantile_cont(rem_dezembro_nom::DOUBLE,0.1) FILTER(rem_dezembro_nom>0) AS rem_dez_p10,
 quantile_cont(rem_dezembro_nom::DOUBLE,0.5) FILTER(rem_dezembro_nom>0) AS rem_dez_mediana,
 quantile_cont(rem_dezembro_nom::DOUBLE,0.9) FILTER(rem_dezembro_nom>0) AS rem_dez_p90"""

def modelos_sql():
    return {dim:f"SELECT {expr} AS grupo,{MEDIDAS} FROM read_parquet('{{arquivo}}') WHERE ativo_31_12=1 {{recorte}} GROUP BY grupo ORDER BY vinculos DESC"for dim,expr in DIMENSOES.items()}

def por_uf(con,path,uf,ano,nomes):
    con.execute('CREATE OR REPLACE TEMP TABLE ativos_rem AS SELECT municipio,sexo,raca_cor,escolaridade,idade,rem_dezembro_nom FROM read_parquet(?) WHERE ativo_31_12=1',[str(path)])
    grupos={}
    for dim,expr in DIMENSOES.items():
        sql=f'SELECT municipio,grouping(municipio) AS agregado,{expr} AS grupo,{MEDIDAS} FROM ativos_rem GROUP BY GROUPING SETS ((municipio,grupo),(grupo))'
        cur=con.execute(sql);cols=[c[0]for c in cur.description]
        for row in cur.fetchall():
            d=dict(zip(cols,row));mun=d.pop('municipio');agregado=d.pop('agregado')
            if agregado:g='uf:'+uf
            elif mun is not None and int(mun)in nomes['municipios']:g='ente:'+str(nomes['municipios'][int(mun)])
            else:continue # Na UF, registros sem município continuam incluídos.
            codigo=d['grupo'];d['nome']=nomes['dimensoes'].get((dim,str(codigo)),str(codigo))if codigo is not None else None
            grupos.setdefault(g,{}).setdefault(dim,[]).append(d)
    con.execute('DROP TABLE ativos_rem')
    for g,dimensoes in grupos.items():
        for linhas in dimensoes.values():linhas.sort(key=lambda r:(-r['vinculos'],str(r['grupo'])))
        yield g,{'ano':ano,'dimensoes':dimensoes}

def gerar(base,saida,micro,anos,municipios):
    base,saida,micro=map(lambda p:Path(p).resolve(),[base,saida,micro])
    if base==saida or base.is_relative_to(saida)or saida.is_relative_to(base)or micro.is_relative_to(saida)or saida.is_relative_to(micro):raise ValueError('Saída deve ser separada das fontes')
    m=json.loads((base/'gold/manifesto.json').read_bytes())
    con=duckdb.connect();con.execute("SET threads=4; SET memory_limit='3GB'")
    tmp=saida/'temporario_remuneracao';tmp.mkdir(parents=True,exist_ok=True);con.execute('SET temp_directory=?',[str(tmp)])
    dicionario=con.execute('SELECT variavel,codigo,descricao FROM read_parquet(?)',[str(base/'gold/trabalho/dicionario.parquet')]).fetchall()
    nomes={'municipios':{int(c)//10:int(c)for c in municipios},'dimensoes':{(v,str(c)):d for v,c,d in dicionario}}
    escritor=Escritor(saida);indices={}
    for ano in anos:
        files=sorted((micro/f'ano={ano}').glob('uf=*.parquet'))
        if len(files)!=27:raise ValueError(f'Esperadas 27 UFs em {ano}, encontradas {len(files)}')
        from config import UF_POR_CODIGO
        def registros():
            for p in files:
                cod=int(p.stem.split('=')[1]);uf=UF_POR_CODIGO.get(cod)or UF_POR_CODIGO.get(str(cod))
                if not uf:raise ValueError('UF desconhecida')
                yield from por_uf(con,p,uf,ano,nomes)
                print(f'Remuneração pronta: {ano} {uf}',flush=True)
        indices[str(ano)]=escritor.partes(f'remuneracao_{ano}',registros())
    fatores={int(a):float(f) for a,f in con.execute('SELECT a.exercicio,b.indice/a.indice FROM read_parquet(?) a CROSS JOIN read_parquet(?) b WHERE b.exercicio=?',[str(base/'gold/ipca.parquet'),str(base/'gold/ipca.parquet'),m['base_ipca']]).fetchall()}
    bloco={'compatibilidade':compatibilidade(m,['rais_micro'],True),'anos':indices,'fatores':fatores,'base_ipca':m['base_ipca'],'modelos_sql':modelos_sql(),'metodo':'quantile_cont, somente ativos em 31/12 e remunerações positivas; nenhuma média de medianas'}
    p=saida/'remuneracao_bloco.json';p.write_text(json.dumps(bloco,ensure_ascii=False),encoding='utf-8')
    return bloco


if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['base','saida','micro']:p.add_argument('--'+name,required=True,type=Path)
    p.add_argument('--ano',type=int,nargs='+',help='Padrão: último ano dos microdados no manifesto')
    a=p.parse_args();base,saida=a.base.resolve(),a.saida.resolve()
    if saida.exists()and any(saida.iterdir()):p.error('Use uma candidata nova e vazia')
    origem=base/'gold/abertura/manifesto.json'
    if not origem.is_file():p.error('Gere os pacotes de abertura da base antes da remuneração')
    m=json.loads((base/'gold/manifesto.json').read_bytes());anos=a.ano or[max(m['fontes']['rais_micro']['anos'])]
    con=duckdb.connect()
    municipios=[int(r[0])for r in con.execute('SELECT DISTINCT cod_ibge FROM read_parquet(?)',[str(base/'gold/trabalho/municipios.parquet')]).fetchall()];con.close()
    bloco=gerar(base,saida,a.micro,anos,municipios)
    meta=json.loads(origem.read_bytes());meta['remuneracao']=bloco
    (saida/'gold/abertura/manifesto.json').write_text(json.dumps(meta,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    print(json.dumps({'ok':True,'anos':anos,'dimensoes':list(DIMENSOES),'municipios':len(municipios),'saida':str(saida)},ensure_ascii=False))
