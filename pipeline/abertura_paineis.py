"""Pacotes de abertura de Trabalho, Gestão e resumos fiscais, derivados dos gold.

Cada recorte é um registro gzip independente, com offset e SHA-256. O navegador
lê apenas o catálogo da UF e o pequeno trecho pedido. Ausências, universos,
estágios, remunerações e condições são os mesmos das rotas SQL de dados.ts.
Os Parquet e o manifesto global nunca são reescritos por este gerador.

Uso: python pipeline/abertura_paineis.py --base <snapshot> --saida <candidato>
     python pipeline/abertura_paineis.py --instalar-local (após gold.py)
"""
import argparse
import gzip
import hashlib
import itertools
import json
import math
import shutil
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import duckdb
from config import DATA, UF_POR_CODIGO
from munic_painel_dados import ler_curadoria

CURADORIA = Path(__file__).resolve().parent.parent/'web/src/munic_curadoria.ts'
FISCAIS = ['receita_bruta','deducoes','receita_liquida','receita_corrente',
           'despesa_empenhada_sem_intra','despesa_liquidada_sem_intra',
           'despesa_paga_sem_intra','despesa_intra','despesa_empenhada',
           'despesa_liquidada','despesa_paga']
SETOR = ['agropecuaria','industria','construcao','comercio','servicos','adm_publica']
PARES_FISCAIS = [('despesa_saude','despesa_empenhada_sem_intra'),('despesa_educacao','despesa_empenhada_sem_intra')]


def serializar(value):
    def numero(v):
        if isinstance(v, Decimal): return float(v)
        raise TypeError(type(v).__name__)
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False,default=numero).encode('utf-8')


def sha(value): return hashlib.sha256(value).hexdigest()


def canonico(value):
    return json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')


def balde(chave):
    cod=chave.split(':')[-1]
    if cod.isdigit(): return UF_POR_CODIGO.get(int(cod[:2]),'governos') if len(cod)==7 else 'governos'
    return 'grupos'


def compatibilidade(m, fontes, ipca=False):
    d={'gerado_em':m['gerado_em'],'fontes':{k:m.get('fontes',{}).get(k) for k in fontes}}
    if ipca: d.update(base_ipca=m['base_ipca'],ipca=m.get('fontes',{}).get('ipca'))
    return d


def manter_remuneracao(bloco,m):
    """Atualizações de outro tema não apagam estatísticas ainda compatíveis."""
    import copy
    if not bloco:return None
    antiga=bloco.get('compatibilidade',{});nova=compatibilidade(m,['rais_micro'],True)
    if any(antiga.get(k)!=nova.get(k)for k in ['fontes','base_ipca','ipca']):return None
    return {**copy.deepcopy(bloco),'compatibilidade':nova}


class Escritor:
    def __init__(self,saida):
        self.pasta=saida/'gold/abertura'
        self.pasta.mkdir(parents=True,exist_ok=True)
        self.objetos=[]

    def referencia(self,nome,conteudo,gz=False):
        data=gzip.compress(conteudo,compresslevel=6,mtime=0) if gz else conteudo
        nome=f'{nome}_{sha(data)[:16]}'+('.json.gz' if gz else '.json')
        arquivo=self.pasta/nome
        arquivo.write_bytes(data)
        ref={'caminho':'gold/abertura/'+nome,'bytes':len(data),'sha256':sha(data)}
        if gz: ref['gzip']=True
        self.objetos.append(ref)
        return ref

    def partes(self,nome,registros):
        """Iterável (chave, objeto); cada recorte tem hash e gzip próprios."""
        arquivos={};indices={}
        try:
            for chave,objeto in registros:
                bucket=balde(chave)
                if bucket not in arquivos:
                    arquivos[bucket]=(self.pasta/f'{nome}_{bucket}.parcial').open('wb')
                    indices[bucket]={}
                if chave in indices[bucket]: raise ValueError('chave repetida: '+chave)
                data=gzip.compress(serializar({'chave':chave,'dados':objeto}),compresslevel=4,mtime=0)
                f=arquivos[bucket];indices[bucket][chave]=[f.tell(),len(data),sha(data)];f.write(data)
        finally:
            for f in arquivos.values(): f.close()
        refs={}
        for bucket,grupos in indices.items():
            tmp=self.pasta/f'{nome}_{bucket}.parcial'
            with tmp.open('rb') as f: digest=hashlib.file_digest(f,'sha256').hexdigest()
            destino=self.pasta/f'{nome}_{bucket}_{digest[:16]}.bin'
            tmp.replace(destino)
            arq={'caminho':'gold/abertura/'+destino.name,'sha256':digest,'bytes':destino.stat().st_size}
            self.objetos.append(arq)
            refs[bucket]=self.referencia(f'{nome}_{bucket}_indice',serializar({'versao':1,'arquivo':arq,'grupos':grupos}),True)
        return refs


def tabela(cols,rows): return {'colunas':cols,'linhas':rows}


def grupos(con,sql):
    c=con.execute(sql);cols=[d[0] for d in c.description][1:]
    for chave,rows in itertools.groupby(c.fetchall(),key=lambda r:r[0]):
        yield str(chave),tabela(cols,[list(r[1:]) for r in rows])


def trabalho(con,m,e):
    setores=', '.join(f'sum(m.empregos_{s}) AS empregos_{s}' for s in SETOR)
    sql=f"""SELECT CASE WHEN grouping(m.cod_ibge)=0 THEN m.cod_ibge::VARCHAR
                   WHEN grouping(m.uf)=0 THEN m.uf ELSE 'BR' END AS chave,
        m.ano,count(*)::INTEGER AS municipios,sum(m.empregos) AS empregos,
        sum(m.populacao) FILTER (m.populacao>0) AS populacao,
        sum(m.empregos) FILTER (m.populacao>0) AS empregos_com_populacao,
        sum(m.mulheres) AS mulheres,sum(m.homens) AS homens,sum(m.superior) AS superior,
        sum(m.ate24) AS ate24,sum(m.de50mais) AS de50mais,{setores},
        sum(m.massa_dez) AS massa_dez,sum(m.n_rem_dez) AS n_rem_dez,
        sum(m.massa_dez)*b.indice/i.indice AS massa_dez_real,
         sum(m.massa_dez)/nullif(sum(m.n_rem_dez),0) AS remuneracao_media,
         sum(m.massa_dez)/nullif(sum(m.n_rem_dez),0)*b.indice/i.indice AS remuneracao_media_real,
         sum(m.massa_dez_mulheres)/nullif(sum(m.n_rem_dez_mulheres),0) AS remuneracao_mulheres,
         sum(m.massa_dez_homens)/nullif(sum(m.n_rem_dez_homens),0) AS remuneracao_homens,
        sum(m.estabelecimentos) AS estabelecimentos
        FROM trab_municipios m LEFT JOIN ipca i ON i.exercicio=m.ano
        CROSS JOIN (SELECT indice FROM ipca WHERE exercicio={int(m['base_ipca'])}) b
        GROUP BY GROUPING SETS ((m.cod_ibge,m.ano,b.indice,i.indice),
          (m.uf,m.ano,b.indice,i.indice),(m.ano,b.indice,i.indice)) ORDER BY chave,m.ano"""
    series=dict(grupos(con,sql))
    caged=dict(grupos(con,"""WITH c AS (
        SELECT cod_ibge::VARCHAR AS chave,competencia,admissoes,desligamentos,saldo,salario_medio_admissao FROM trab_caged
        UNION ALL SELECT escopo,competencia,admissoes,desligamentos,saldo,salario_medio_admissao FROM trab_caged_uf WHERE secao='TOTAL')
        SELECT *,sum(saldo) OVER (PARTITION BY chave ORDER BY competencia ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) AS saldo_12m
        FROM c ORDER BY chave,competencia"""))
    hist=e.partes('trabalho_historico',((g,{'trab_serie':series.get(g,tabela([],[])),
        'trab_caged':caged.get(g,tabela(['competencia','admissoes','desligamentos','saldo','salario_medio_admissao','saldo_12m'],[]))})
        for g in sorted(set(series)|set(caged))))
    anos={}
    for ano in m['fontes']['rais']['anos']:
        setores=dict(grupos(con,f"""WITH s AS (
            SELECT cod_ibge::VARCHAR AS chave,divisao,empregos,remuneracao_media_dez FROM trab_setores WHERE ano={int(ano)}
            UNION ALL SELECT escopo,divisao,empregos,remuneracao_media_dez FROM trab_setores_uf WHERE ano={int(ano)})
            SELECT chave,s.divisao,c.divisao_nome,c.secao,c.secao_nome,s.empregos,s.remuneracao_media_dez AS remuneracao_media
            FROM s LEFT JOIN trab_cnae c USING(divisao) ORDER BY chave,s.empregos DESC,s.divisao"""))
        perfil={}
        arq=m['fontes'].get('rais_perfis',{}).get('arquivos','').replace('{ano}',str(ano))
        if arq and (con._base/arq).exists():
            con.execute(f"CREATE OR REPLACE VIEW perfil AS SELECT * FROM read_parquet('{(con._base/arq).as_posix()}')")
            campos=[d[0] for d in con.execute('SELECT * FROM perfil LIMIT 0').description if d[0]!='escopo']
            perfil=dict(grupos(con,'SELECT escopo AS chave,'+','.join(campos)+' FROM perfil ORDER BY escopo,variavel,codigo'))
        anos[str(ano)]=e.partes(f'trabalho_{ano}',((g,{'trab_setores':setores.get(g,tabela([],[])),
            **({'trab_perfis':perfil[g]} if g in perfil else {})}) for g in sorted(set(setores)|set(perfil))))
        print('Trabalho',ano,len(setores),'recortes',flush=True)
    return {'compatibilidade':compatibilidade(m,['rais','caged','rais_perfis'],True),'historico':hist,'anos':anos}


def gestao(con,m,e,curadoria):
    # O painel consulta todos os pares curados; a seleção de edição é aplicada no leitor.
    pares=defaultdict(lambda:defaultdict(set))
    for ind in curadoria:
        for f in ind['fontes']:
            pares[ind['pesquisa']][int(f['ano'])].add(f['var'])
    declarados=m.get('fontes',{}).get('munic_painel',{}).get('pares',{})
    for pesquisa,anos in pares.items():
        for ano,vs in anos.items():
            if not vs.issubset(set(declarados.get(pesquisa,{}).get(str(ano),[]))):
                print('Gestão: curadoria não coberta pelos arquivos leves; manter motor completo.',flush=True)
                return None
    pred=[]
    for pesquisa,anos in pares.items():
        for ano,vs in anos.items():
            if any(not v.isalnum() for v in vs): raise ValueError('variável curada inválida')
            pred.append(f"(pesquisa='{pesquisa}' AND ano={ano} AND var IN ({','.join(repr(v) for v in sorted(vs))}))")
    filtro=' OR '.join(pred)
    respostas=dict(grupos(con,f"SELECT pesquisa||':'||cod::VARCHAR AS chave,ano::INTEGER AS ano,var,valor_txt,valor_num,valida FROM munic_respostas WHERE {filtro} ORDER BY chave,ano,var"))
    res=e.partes('gestao_respostas',((g,{'respostas':v}) for g,v in respostas.items()))
    territorio=con.execute("""SELECT pesquisa,cod,nome,uf,faixa,populacao FROM munic_territorio
        QUALIFY row_number() OVER(PARTITION BY pesquisa,cod ORDER BY ano DESC)=1 ORDER BY pesquisa,cod""")
    cols=[d[0] for d in territorio.description];cad=tabela(cols,[list(r) for r in territorio.fetchall()])
    edicoes={p:max(anos) for p,anos in pares.items()}
    lugares={}
    for p,ano in edicoes.items():
        c=con.execute(f"SELECT cod,nome,uf,faixa,populacao FROM munic_territorio WHERE pesquisa='{p}' AND ano={ano} ORDER BY nome")
        lugares[p]=tabela([d[0] for d in c.description],[list(r) for r in c.fetchall()])
    catalogo=e.referencia('gestao_territorios',serializar({'cadastro':cad,'lugares':lugares,'edicoes':edicoes}),True)
    aggs=[]
    for pesquisa,anos in pares.items():
        ufs=['']+(list(UF_POR_CODIGO.values()) if pesquisa=='munic' else [])
        for uf in ufs:
            recorte="(corte='brasil' AND grupo='BR')"+(f" OR (corte='uf' AND grupo='{uf}')" if uf else '')
            c=con.execute(f"SELECT ano::INTEGER AS ano,var,corte,grupo,valor_txt,valida,n::DOUBLE AS n,soma,media FROM munic_agregados WHERE pesquisa='{pesquisa}' AND ({filtro}) AND ({recorte}) ORDER BY ano,var,corte,grupo,valor_txt")
            agg=tabela([d[0] for d in c.description],[list(r) for r in c.fetchall()])
            c=con.execute(f"SELECT ano::INTEGER AS ano,count(*)::INTEGER AS territorios,(count(*) FILTER (uf='{uf}'))::INTEGER AS territorios_uf FROM munic_territorio WHERE pesquisa='{pesquisa}' AND ano IN ({','.join(map(str,anos))}) GROUP BY ano ORDER BY ano")
            universo=tabela([d[0] for d in c.description],[list(r) for r in c.fetchall()])
            aggs.append((pesquisa+':'+(uf or 'BR'),{'agregados':agg,'universo':universo}))
    return {'compatibilidade':compatibilidade(m,['munic','estadic','munic_painel']),
        'curadoria_sha256':sha(canonico(curadoria)),'territorios':catalogo,'respostas':res,
        'agregados':e.partes('gestao_agregados',aggs)}


def fiscal(con,m,e):
    dados=[]
    # Uma consulta para todos os municípios/estados individualmente e outra para os agregados.
    for individual in [True,False]:
        col=[]
        for campo in FISCAIS:
            dominio='receita' if campo in FISCAIS[:4] else 'despesa'
            total='receita_bruta' if dominio=='receita' else 'despesa_empenhada'
            ok=f'i.{campo} IS NOT NULL'
            if not individual:
                ok+=f" AND i.{total}>0 AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.exclui AND a.exercicio=i.exercicio AND a.cod_ibge=i.cod_ibge AND a.dominio='{dominio}')"
            col += [f'sum(i.{campo}) FILTER ({ok}) AS {campo}',
                    f'sum(i.{campo}*b.indice/ip.indice) FILTER ({ok}) AS {campo}_real',
                    f'sum(i.{"populacao_ibge" if campo=="pib" else "populacao"}) FILTER ({ok} AND i.{"populacao_ibge" if campo=="pib" else "populacao"}>0)::DOUBLE AS populacao_{campo}',
                    f'count(*) FILTER ({ok})::INTEGER AS entes_{campo}']
        for a,b in PARES_FISCAIS:
            ok=f'i.{a} IS NOT NULL AND i.{b} IS NOT NULL'
            if not individual:
                ok+=" AND i.despesa_empenhada>0 AND NOT EXISTS (SELECT 1 FROM alertas a WHERE a.exclui AND a.exercicio=i.exercicio AND a.cod_ibge=i.cod_ibge AND a.dominio='despesa')"
            col.extend([f'sum(i.{a}) FILTER ({ok}) AS {a}__{b}_num',f'sum(i.{b}) FILTER ({ok}) AS {a}__{b}_den',f'count(*) FILTER ({ok})::INTEGER AS {a}__{b}_entes'])
        chave="'ente:'||i.cod_ibge::VARCHAR" if individual else "i.esfera||':'||CASE WHEN grouping(i.uf)=0 THEN i.uf ELSE 'BR' END"
        group='i.cod_ibge,i.exercicio' if individual else 'GROUPING SETS ((i.esfera,i.uf,i.exercicio),(i.esfera,i.exercicio))'
        sql=f"SELECT {chave} AS chave,i.exercicio,{','.join(col)},sum(i.populacao)::DOUBLE AS populacao,count(*)::INTEGER AS entes FROM indicadores i LEFT JOIN ipca ip USING(exercicio) CROSS JOIN (SELECT indice FROM ipca WHERE exercicio={int(m['base_ipca'])}) b GROUP BY {group} ORDER BY chave,i.exercicio"
        dados.extend((g,{'agregado':v}) for g,v in grupos(con,sql))
    cobertura={}
    c=con.execute("""SELECT s.esfera||':'||s.escopo AS chave,s.dominio,s.exercicio,s.entes,s.esperados,s.excluidos,s.sem_dados,s.populacao::DOUBLE AS populacao,
        (SELECT count(*) FROM alertas a WHERE a.exclui AND a.dominio=s.dominio AND a.exercicio=s.exercicio AND a.esfera=s.esfera AND (s.escopo='BR' OR a.uf=s.escopo) AND a.categoria<>'ausente') AS sinalizados,
        (SELECT sum(a.valor) FROM alertas a WHERE a.exclui AND a.dominio=s.dominio AND a.exercicio=s.exercicio AND a.esfera=s.esfera AND (s.escopo='BR' OR a.uf=s.escopo) AND a.categoria<>'ausente') AS valor_excluido
        FROM escopos s WHERE s.tratamento='filtrado' ORDER BY chave,s.dominio,s.exercicio""")
    names=[d[0] for d in c.description][2:]
    for row in c.fetchall(): cobertura.setdefault(row[0],{}).setdefault(row[1],tabela(names,[]))['linhas'].append(list(row[2:]))
    alertas=dict(grupos(con,"SELECT 'ente:'||cod_ibge::VARCHAR AS chave,exercicio,categoria,indicador,dominio,valor,valor_real,mediana_real,razao,n_obs,regra,exclui FROM alertas ORDER BY chave,exercicio"))
    for g,d in dados:
        d['cobertura']=alertas.get(g,tabela(['exercicio','categoria','indicador','dominio','valor','valor_real','mediana_real','razao','n_obs','regra','exclui'],[])) if g.startswith('ente:') else cobertura.get(g,{})
    return {'compatibilidade':compatibilidade(m,['siconfi','populacao_declarada'],True),'campos':FISCAIS,'pares':['/'.join(p)for p in PARES_FISCAIS],'pacotes':e.partes('fiscal_resumo',dados)}


def gerar(base,saida,curadoria=CURADORIA):
    base=Path(base).resolve();saida=Path(saida).resolve()
    if base==saida or base.is_relative_to(saida) or saida.is_relative_to(base):
        raise ValueError('A saída candidata deve ser separada da origem.')
    m=json.loads((base/'gold/manifesto.json').read_bytes())
    perfil_meta=m.get('fontes',{}).get('rais_perfis',{})
    perfil_template=perfil_meta.get('arquivos')
    if perfil_template:
        for ano in perfil_meta.get('anos',[]):
            arquivo=(base/perfil_template.replace('{ano}',str(ano))).resolve()
            if not arquivo.is_relative_to(base) or not arquivo.is_file():
                raise ValueError('Perfil RAIS anunciado no manifesto está ausente: '+str(ano))
    cur=ler_curadoria(curadoria)
    con=duckdb.connect();con.execute('SET threads=4')
    # Wrapper mantém a origem junto à conexão sem depender de atributos do binding C++.
    class Conexao:
        _base=base
        def execute(self,*args): return con.execute(*args)
    cx=Conexao()
    views={'entes':'silver/entes.parquet','indicadores':'gold/indicadores.parquet','ipca':'gold/ipca.parquet','alertas':'gold/alertas.parquet','escopos':'gold/escopos.parquet'}
    views.update({f'trab_{n}':'gold/trabalho/'+n+'.parquet' for n in ['municipios','setores','setores_uf','cnae','caged','caged_uf']})
    for n in ['setores','setores_uf']:
        views['trab_'+n]=m['fontes'].get('rais',{}).get(n,views['trab_'+n])
    views.update({'munic_territorio':'gold/munic/territorio.parquet','munic_respostas':'gold/munic/painel_respostas.parquet','munic_agregados':'gold/munic/painel_agregados.parquet'})
    for name,path in views.items():
        caminho=(base/path).resolve()
        if not caminho.is_relative_to(base): raise ValueError('Origem fora da base')
        if caminho.exists():
            con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{caminho.as_posix().replace(chr(39),chr(39)*2)}')")
    e=Escritor(saida)
    entes=con.execute("SELECT e.cod_ibge,e.nome,e.uf,e.esfera,e.capital FROM entes e WHERE e.esfera<>'U' AND EXISTS(SELECT 1 FROM indicadores i WHERE i.cod_ibge=e.cod_ibge) ORDER BY e.esfera DESC,e.uf,e.nome").fetchall()
    todos=con.execute('SELECT cod_ibge,uf,esfera FROM entes').fetchall()
    root={'versao':1,'gerado_em':datetime.now(timezone.utc).isoformat(),
        'catalogo':{'compatibilidade':compatibilidade(m,['siconfi']),
                    'arquivo':e.referencia('cadastro',serializar({'entes':entes,'todos':todos}),True)}}
    if all((base/p).exists() for n,p in views.items() if n.startswith('trab_')) and m.get('fontes',{}).get('rais'):
        root['trabalho']=trabalho(cx,m,e)
    if all((base/p).exists() for n,p in views.items() if n.startswith('munic_')):
        pacote=gestao(cx,m,e,cur)
        if pacote: root['gestao']=pacote
    root['fiscal']=fiscal(cx,m,e)
    anterior=base/'gold/abertura/manifesto.json'
    if anterior.exists():
        bloco=manter_remuneracao(json.loads(anterior.read_bytes()).get('remuneracao'),m)
        if bloco:root['remuneracao']=bloco
    (e.pasta/'manifesto.json').write_bytes(serializar(root))
    auditoria={'versao':1,'base_manifesto_sha256':sha((base/'gold/manifesto.json').read_bytes()),
        'manifesto_sha256':sha(serializar(root)),'objetos':e.objetos,'bytes':sum(r['bytes'] for r in e.objetos)}
    (saida/'auditoria_abertura.json').write_bytes(serializar(auditoria))
    con.close()
    print('PACOTES GERADOS',len(e.objetos),'objetos;',auditoria['bytes'],'bytes',flush=True)
    return root


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base',type=Path,default=DATA)
    p.add_argument('--saida',type=Path)
    p.add_argument('--instalar-local',action='store_true')
    args=p.parse_args()
    if args.instalar_local:
        if args.saida: p.error('--instalar-local não recebe --saida')
        with tempfile.TemporaryDirectory(prefix='finbra_abertura_') as tmp:
            gerar(args.base,Path(tmp))
            origem=Path(tmp)/'gold/abertura';destino=args.base.resolve()/'gold/abertura'
            destino.mkdir(parents=True,exist_ok=True)
            for f in origem.iterdir():
                if f.name!='manifesto.json': shutil.copyfile(f,destino/f.name)
            temporario=destino/'manifesto.json.parcial'
            shutil.copyfile(origem/'manifesto.json',temporario)
            temporario.replace(destino/'manifesto.json')
    else:
        if not args.saida: p.error('Informe --saida em pasta separada da origem')
        gerar(args.base,args.saida)


if __name__=='__main__': main()
