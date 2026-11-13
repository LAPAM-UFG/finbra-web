"""As cópias leves preservam respostas, zeros e ausências; fontes obsoletas não são anunciadas."""
import json,shutil,tempfile
from pathlib import Path
import duckdb
from munic_painel_dados import gerar,fonte_painel,sha,ler_curadoria

with tempfile.TemporaryDirectory() as d:
    root=Path(d);base=root/'base';gold=base/'gold/munic';gold.mkdir(parents=True)
    c=duckdb.connect()
    c.execute("CREATE TABLE respostas(pesquisa VARCHAR,ano SMALLINT,cod INTEGER,var VARCHAR,valor_txt VARCHAR,valor_num DOUBLE,valida BOOLEAN)")
    c.execute("INSERT INTO respostas VALUES ('munic',2024,1,'Q1','Sim',NULL,true),('munic',2024,2,'Q1','Não',NULL,true),('munic',2024,3,'Q1','Não informou',NULL,false),('munic',2024,1,'Q2',NULL,0,true),('munic',2024,2,'Q2','-',NULL,false),('munic',2024,1,'FORA',NULL,99,true)")
    c.execute("CREATE TABLE catalogo AS SELECT 'munic' AS pesquisa,2024 AS ano,'Q1' AS var,'Tema' AS aba,'Contexto' AS tema,'Pergunta 1' AS rotulo UNION ALL SELECT 'munic',2024,'Q2','Tema','Contexto','Pergunta 2'")
    c.execute("CREATE TABLE agregados AS SELECT pesquisa,ano,var,'brasil' AS corte,'BR' AS grupo,valor_txt,valida,count(*) AS n,sum(valor_num) AS soma,avg(valor_num) AS media FROM respostas GROUP BY ALL")
    for name in ('respostas','catalogo','agregados'):
        c.execute(f"COPY {name} TO '{(gold/(name+'.parquet')).as_posix()}' (FORMAT parquet)")
    (base/'gold/manifesto.json').write_text(json.dumps({'fontes':{'outra':{'preservar':True}},'gerado_em':'antes'}),encoding='utf-8')
    cfg=[{'pesquisa':'munic','fontes':[{'ano':2024,'var':f'Q{i}','aba':'Tema','tema':'Contexto','rotulo':f'Pergunta {i}'}]} for i in (1,2)]
    config=root/'curadoria.json';config.write_text(json.dumps(cfg),encoding='utf-8')
    ts=root/'curadoria.ts';ts.write_text('export const CURADORIA: IndicadorMunic[] = '+json.dumps(cfg)+' as IndicadorMunic[];',encoding='utf-8')
    assert ler_curadoria(ts)==cfg
    source_hashes={f.name:sha(f) for f in gold.iterdir()}
    for dest in (base,base/'dentro',root):
        try:gerar(base,dest,config)
        except ValueError:pass
        else:raise AssertionError('destino sobre origem aceito')
    assert source_hashes=={f.name:sha(f) for f in gold.iterdir()}
    out=root/'candidato';ind=gerar(base,out,config)
    assert ind['arquivos']['painel_respostas.parquet']['linhas']==5
    rows=c.execute('SELECT cod,var,valor_txt,valor_num,valida FROM read_parquet(?) ORDER BY cod,var',[(out/'gold/munic/painel_respostas.parquet').as_posix()]).fetchall()
    assert (1,'Q2',None,0.0,True) in rows
    assert (3,'Q1','Não informou',None,False) in rows
    assert (2,'Q2','-',None,False) in rows
    assert not any(r[1]=='FORA' for r in rows)
    manifest=json.loads((out/'gold/manifesto.json').read_text(encoding='utf-8'))
    assert manifest['fontes']['outra']=={'preservar':True}
    merged=root/'mescla';merged.mkdir()
    for f in gold.iterdir():shutil.copyfile(f,merged/f.name)
    for f in (out/'gold/munic').iterdir():shutil.copyfile(f,merged/f.name)
    assert fonte_painel(merged)['munic_painel']['pares']=={'munic':{'2024':['Q1','Q2']}}
    (merged/'respostas.parquet').write_bytes((merged/'respostas.parquet').read_bytes()+b'alterado')
    assert fonte_painel(merged)=={},'atalho obsoleto anunciado'
    cfg[0]['fontes'][0]['tema']='Outro contexto'
    config.write_text(json.dumps(cfg),encoding='utf-8')
    try:gerar(base,root/'ruim',config)
    except ValueError:pass
    else:raise AssertionError('catálogo com outro contexto aceito')
    assert not (root/'ruim').exists()
    assert source_hashes=={f.name:sha(f) for f in gold.iterdir()}
print('Painel leve: seleção exata, valores/zeros/ausências, destinos, fonte obsoleta e origem intacta validados.')
