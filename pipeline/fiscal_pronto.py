"""Abertura fiscal sem WASM: base nacional do ranking e contas de receitas.

Só deriva os arquivos fiscais já publicados. Conserva os valores, as ausências,
os tratamentos, os comparadores e todas as colunas/contas do Anexo I-C.
Não altera os Parquet de origem nem exige reconstruir Trabalho ou Gestão.
"""
import argparse
import itertools
import json
from pathlib import Path
import duckdb
from abertura_paineis import Escritor,serializar,tabela,compatibilidade

CAMPOS=['receita_bruta','receita_corrente','receita_impostos_taxas','fpm','icms','iptu','iss','itbi',
        'despesa_empenhada_sem_intra','despesa_saude','despesa_educacao','investimentos','despesa_pessoal','pib']

def gerar_alertas(con,m,e,codigos):
    colunas=['exercicio','cod_ibge','nome','uf','esfera','indicador','dominio','valor','valor_real','mediana_real','razao','n_obs','categoria','motivo','regra','evidencia','fonte','exclui']
    rows=con.execute(f"SELECT {','.join(colunas)} FROM a ORDER BY exercicio DESC,CASE categoria WHEN 'inconsistente' THEN 0 WHEN 'confirmado' THEN 1 WHEN 'suspeita' THEN 2 ELSE 3 END,razao DESC NULLS LAST").fetchall()
    por_ente={c:[]for c in codigos}
    for row in rows:por_ente.setdefault(int(row[1]),[]).append(row)
    return {'compatibilidade':compatibilidade(m,['siconfi','populacao_declarada']),
        'todos':e.referencia('fiscal_alertas',serializar(tabela(colunas,rows)),True),
        'pacotes':e.partes('fiscal_alertas',((f'ente:{cod}',{'alertas':tabela(colunas,rs)})for cod,rs in sorted(por_ente.items())))}

def gerar(base,saida,raiz=None):
    base=Path(base).resolve();saida=Path(saida).resolve()
    if base==saida or base.is_relative_to(saida) or saida.is_relative_to(base):
        raise ValueError('A saída deve ser separada da origem.')
    m=json.loads((base/'gold/manifesto.json').read_bytes())
    root=raiz if raiz is not None else json.loads((base/'gold/abertura/manifesto.json').read_bytes())
    con=duckdb.connect();con.execute('SET threads=4')
    def pq(p):return "read_parquet('"+(base/p).as_posix().replace("'","''")+"')"
    for nome,path in {'i':'gold/indicadores.parquet','a':'gold/alertas.parquet','s':'gold/escopos.parquet','arv':'gold/arvore.parquet'}.items():
        con.execute(f'CREATE VIEW {nome} AS SELECT * FROM {pq(path)}')
    e=Escritor(saida)
    c={'compatibilidade':compatibilidade(m,['siconfi','populacao_declarada','ibge_pib']),
       'campos':CAMPOS,'anos':{},'disponibilidade':{}}
    for campo in CAMPOS:
        c['disponibilidade'][campo]=con.execute(f"SELECT exercicio,count({campo})::INTEGER FROM i WHERE esfera='M' GROUP BY 1 HAVING count({campo})>0 ORDER BY 1").fetchall()
    anos=[r[0]for r in con.execute('SELECT DISTINCT exercicio FROM i ORDER BY 1').fetchall()]
    for ano in anos:
        q=con.execute(f"""SELECT cod_ibge,nome,uf,populacao::DOUBLE AS populacao,populacao_ibge::DOUBLE AS populacao_ibge,
          receita_bruta>0 AS receita_ok,despesa_empenhada>0 AS despesa_ok,
          EXISTS(SELECT 1 FROM a WHERE a.exclui AND a.exercicio=i.exercicio AND a.cod_ibge=i.cod_ibge AND a.dominio='receita') AS exclui_receita,
          EXISTS(SELECT 1 FROM a WHERE a.exclui AND a.exercicio=i.exercicio AND a.cod_ibge=i.cod_ibge AND a.dominio='despesa') AS exclui_despesa,
          {','.join(f'{x}::DOUBLE AS {x}'for x in CAMPOS)} FROM i WHERE esfera='M' AND exercicio={int(ano)} ORDER BY cod_ibge""")
        cols=[x[0] for x in q.description]
        c['anos'][str(ano)]=e.referencia(f'fiscal_ranking_{ano}',serializar(tabela(cols,q.fetchall())),True)
    root['fiscal_ranking']=c
    tree={'compatibilidade':compatibilidade(m,['siconfi','populacao_declarada']),'anexo':'I-C','anos':{}}
    fontes=sorted((base/'gold/entes').glob('*.parquet'))
    if not fontes:raise ValueError('Partições fiscais ausentes')
    codigos=[int(c)for c, in con.execute(f"SELECT cod_ibge FROM {pq('silver/entes.parquet')} ORDER BY cod_ibge").fetchall()]
    for ano in anos:
        cp=base/f'silver/contas/exercicio={ano}.parquet'
        if not cp.exists():continue
        contas=con.execute(f"SELECT chave,chave_pai,nivel,descricao,tipo FROM {pq(cp.relative_to(base))} WHERE anexo='I-C' ORDER BY ordem").fetchall()
        cols=['chave','chave_pai','nivel','descricao','tipo']
        cref=e.referencia(f'fiscal_contas_{ano}',serializar(tabela(cols,contas)),True)
        pops={int(c):(float(p)if p and p>0 else None)for c,p in con.execute(f'SELECT cod_ibge,populacao FROM i WHERE exercicio={int(ano)}').fetchall()}
        scopes={f'{t}:{es}:{esc}':{'populacao':float(p)if p and p>0 else None,'entes':int(n),'valores':{}}for es,esc,t,p,n in con.execute(f"SELECT esfera,escopo,tratamento,populacao,entes FROM s WHERE exercicio={int(ano)} AND dominio='receita'").fetchall()}
        q=con.execute(f"SELECT tratamento||':'||esfera||':'||escopo AS grupo,coluna,chave,valor FROM arv WHERE exercicio={int(ano)} AND anexo='I-C' ORDER BY grupo,coluna,chave")
        for g,rows in itertools.groupby(q.fetchall(),key=lambda r:r[0]):
            if g not in scopes:raise ValueError('Árvore sem população/cobertura: '+g)
            for _,col,chave,v in rows:scopes[g]['valores'].setdefault(col,[]).append([chave,float(v)if v is not None else None,None])
        def registros():
            vistos=set()
            for fonte in fontes:
                q=con.execute(f"SELECT cod_ibge,coluna,chave,sum(valor)::DOUBLE AS valor,bool_or(sintetico) AS sintetico FROM {pq(fonte.relative_to(base))} WHERE exercicio={int(ano)} AND anexo='I-C' GROUP BY cod_ibge,coluna,chave ORDER BY cod_ibge,coluna,chave")
                for cod,rows in itertools.groupby(q.fetchall(),key=lambda r:r[0]):
                    if cod in vistos:raise ValueError('Ente fiscal duplicado')
                    vistos.add(cod);valores={}
                    for _,col,chave,v,sint in rows:valores.setdefault(col,[]).append([chave,v,sint])
                    yield 'ente:'+str(cod),{'valores':valores,'populacao':pops.get(cod),'entes':1 if cod in pops else 0}
            for cod in codigos:
                if cod not in vistos:yield 'ente:'+str(cod),{'valores':{},'populacao':pops.get(cod),'entes':1 if cod in pops else 0}
            yield from sorted(scopes.items())
        tree['anos'][str(ano)]={'contas':cref,'pacotes':e.partes(f'fiscal_contas_{ano}',registros()),'colunas':m['colunas'].get(str(ano),{}).get('I-C',[])}
        print('CONTAS FISCAIS PRONTAS',ano,flush=True)
    root['fiscal_arvore']=tree
    root['fiscal_alertas']=gerar_alertas(con,m,e,codigos)
    (e.pasta/'manifesto.json').write_bytes(serializar(root))
    (saida/'auditoria_fiscal_pronto.json').write_bytes(serializar({'objetos':e.objetos,'bytes':sum(x['bytes']for x in e.objetos),'anos':anos}))
    con.close();return root

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--base',required=True,type=Path);p.add_argument('--saida',required=True,type=Path);p.add_argument('--somente-alertas',action='store_true');a=p.parse_args()
    if not a.somente_alertas:gerar(a.base,a.saida)
    else:
        base=a.base.resolve();saida=a.saida.resolve()
        if base==saida or base.is_relative_to(saida)or saida.is_relative_to(base):raise ValueError('Saída deve ser separada da origem')
        m=json.loads((base/'gold/manifesto.json').read_bytes());root=json.loads((saida/'gold/abertura/manifesto.json').read_bytes());con=duckdb.connect()
        path=(base/'gold/alertas.parquet').as_posix().replace("'","''");con.execute(f"CREATE VIEW a AS SELECT * FROM read_parquet('{path}')")
        codigos=[int(c)for c, in con.execute('SELECT cod_ibge FROM read_parquet(?)',[str(base/'silver/entes.parquet')]).fetchall()]
        e=Escritor(saida);root['fiscal_alertas']=gerar_alertas(con,m,e,codigos);(e.pasta/'manifesto.json').write_bytes(serializar(root));con.close()
