"""SIOPE pré-calculado por governo/recorte: leitura de um Range, sem WASM.

Só lê os Parquet publicados. Séries, remuneração e tabelas preservam as unidades
do painel: IPCA nos gastos; salários em reais correntes de dezembro. Estados e
DF são tratados explicitamente. Não exporta nomes de profissionais.
"""
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from assistencia_utils import destino_isolado
from educacao import objeto, json_file, sha, UFS
from saude_abertura import criar_se, cadastro, por_hab, num
from painel_municipal import qs

SE=['ano','mde_pct','fundeb_remuneracao_pct','educacao_despesa_pct','aluno_basica','aluno_infantil','aluno_fundamental','professores_aluno','infantil_pct','fundamental_pct','medio_pct','educacao_liquidada','populacao_siope','min_fundeb']
GRUPO="""ano,count(*)::INTEGER entes,median(mde_pct)/100 mde_mediana,count(mde_pct)::INTEGER n_mde,
count(*) FILTER(mde_pct<25)::INTEGER mde_abaixo,median(fundeb_remuneracao_pct)/100 fundeb_mediana,count(fundeb_remuneracao_pct)::INTEGER n_fundeb,
count(*) FILTER(fundeb_remuneracao_pct<min_fundeb)::INTEGER fundeb_abaixo,any_value(min_fundeb) min_fundeb,
median(educacao_despesa_pct)/100 educacao_despesa_mediana,{hab} educacao_hab,median(aluno_basica) aluno_basica_mediana,
median(professores_aluno) professores_aluno_mediana,median(infantil_pct)/100 infantil_mediana,median(fundamental_pct)/100 fundamental_mediana,median(medio_pct)/100 medio_mediana""".format(hab=por_hab('educacao_liquidada','populacao_siope'))
TABELA=['ano','cod_ibge','nome','uf','esfera','mde_pct','fundeb_remuneracao_pct','educacao_despesa_pct','aluno_basica','professores_aluno','educacao_hab']
REM="""ano,tipo_categoria,situacao,sum(profissionais)::INTEGER profissionais,sum(vinculos)::INTEGER vinculos,
sum(profissionais) FILTER(salario_medio IS NOT NULL)::INTEGER com_estatistica,{sal} salario_medio,{carga} carga_horaria_media"""
CAT_ENTE=['ano','tipo_categoria','categoria','situacao','profissionais','vinculos','carga_horaria_media','salario_medio','salario_p25','salario_mediana','salario_p75','outros_medio']
CAT_GRUPO="""ano,tipo_categoria,categoria,situacao,sum(profissionais)::INTEGER profissionais,sum(vinculos)::INTEGER vinculos,
sum(profissionais) FILTER(salario_medio IS NOT NULL)::INTEGER com_estatistica,{carga} carga_horaria_media,{sal} salario_medio"""


def ponderada(c):return f'sum({c}*profissionais) FILTER({c} IS NOT NULL)/sum(profissionais) FILTER({c} IS NOT NULL)'
def ler(p):return json.loads(p.read_text(encoding='utf-8'))


def gerar(base,saida):
    base=base.resolve();saida=destino_isolado(saida,base)
    if (saida/'gold/educacao/financeiro_manifesto.json').exists():raise ValueError('Use nova candidata')
    work=saida/'trabalho_educacao';work.mkdir(parents=True,exist_ok=True)
    orig={k:sha(base/k) for k in ['gold/saude_educacao.parquet','gold/siope/remuneracao.parquet','gold/ipca.parquet','silver/entes.parquet','gold/indicadores.parquet']}
    m=ler(base/'gold/manifesto.json');db=duckdb.connect(config={'threads':1});criar_se(db,base,m['base_ipca'])
    db.execute('CREATE VIEW entes AS SELECT * FROM read_parquet('+qs((base/'silver/entes.parquet').as_posix())+')')
    db.execute("CREATE VIEW rem AS SELECT * FROM read_parquet("+qs((base/'gold/siope/remuneracao.parquet').as_posix())+") WHERE mes=12 AND cod_ibge IS NOT NULL")
    entidades=cadastro(db,base);packets={};cols={};tables={}
    def packet(g):return packets.setdefault(g,{'g':g,'se':[],'rem':[],'cats':[],'cobertura':[]})
    cur=db.execute('SELECT cod_ibge,'+','.join(SE)+' FROM se ORDER BY cod_ibge,ano')
    for cod,*row in cur.fetchall():packet('ente:'+str(cod))['se'].append([num(v) for v in row])
    cols['se']=SE
    rem_expr=REM.format(sal=ponderada('salario_medio'),carga=ponderada('carga_horaria_media'))
    cat_expr=CAT_GRUPO.format(sal=ponderada('salario_medio'),carga=ponderada('carga_horaria_media'))
    cur=db.execute('SELECT cod_ibge,'+rem_expr+' FROM rem GROUP BY ALL ORDER BY cod_ibge,ano,tipo_categoria,profissionais DESC')
    cols['rem']=[x[0] for x in cur.description][1:]
    for cod,*row in cur.fetchall():packet('ente:'+str(cod))['rem'].append([num(v) for v in row])
    cur=db.execute('SELECT cod_ibge,'+','.join(CAT_ENTE)+' FROM rem ORDER BY cod_ibge,ano,tipo_categoria DESC,profissionais DESC')
    for cod,*row in cur.fetchall():packet('ente:'+str(cod))['cats'].append([num(v) for v in row])
    cols['cats_ente']=CAT_ENTE
    for cod,ano in db.execute('SELECT DISTINCT cod_ibge,ano FROM rem ORDER BY cod_ibge,ano').fetchall():packet('ente:'+str(cod))['cobertura'].append([ano,1,1])
    for level,uf in [('M',None),('E',None),*[('M',u) for u in sorted(UFS.values())]]:
        g=level+':'+(uf or 'BR');where="esfera IN ('E','D')" if level=='E' else "esfera='M'"+((' AND uf='+qs(uf)) if uf else '')
        cur=db.execute('SELECT '+GRUPO+' FROM se WHERE '+where+' GROUP BY ano ORDER BY ano');cols['grupo']=[x[0] for x in cur.description]
        packet(g)['se']=[[num(v) for v in row] for row in cur.fetchall()]
        cur=db.execute('SELECT '+rem_expr+' FROM rem WHERE '+where+' GROUP BY ALL ORDER BY ano,tipo_categoria,profissionais DESC')
        packet(g)['rem']=[[num(v) for v in row] for row in cur.fetchall()]
        cur=db.execute('SELECT '+cat_expr+' FROM rem WHERE '+where+' GROUP BY ALL ORDER BY ano,tipo_categoria DESC,profissionais DESC');cols['cats_grupo']=[x[0] for x in cur.description]
        packet(g)['cats']=[[num(v) for v in row] for row in cur.fetchall()]
        expected=db.execute('SELECT count(*) FROM entes WHERE '+where).fetchone()[0]
        packet(g)['cobertura']=[[ano,n,expected] for ano,n in db.execute('SELECT ano,count(DISTINCT cod_ibge) FROM rem WHERE '+where+' GROUP BY ano ORDER BY ano').fetchall()]
        query='SELECT s.ano,s.cod_ibge,e.nome,s.uf,s.esfera,s.mde_pct,s.fundeb_remuneracao_pct,s.educacao_despesa_pct,s.aluno_basica,s.professores_aluno,s.educacao_liquidada/nullif(s.populacao_siope,0) educacao_hab FROM se s JOIN entes e USING(cod_ibge) WHERE '+where.replace('esfera','s.esfera').replace('uf=','s.uf=')+' ORDER BY s.ano,s.uf,e.nome'
        for row in db.execute(query).fetchall():tables.setdefault('tabela:'+g+':'+str(row[0]),[]).append([num(v) for v in row])
        print(json.dumps(dict(recorte=g,series=len(packet(g)['se']),categorias=len(packet(g)['cats']))),flush=True)
    cols['tabela']=TABELA;cols['cobertura']=['ano','com_declaracao','esperados']
    # Governos sem remuneração têm pacote vazio, nunca salário zero inventado.
    for cod,*_ in entidades:packet('ente:'+str(cod))
    arquivo=work/'financeiro.ndjson';indices={};municipios={u:{} for u in UFS.values()}
    with arquivo.open('wb') as f:
        for g,obj in sorted(packets.items()):
            data=(json.dumps(obj,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode();ref=[f.tell(),len(data),hashlib.sha256(data).hexdigest()];f.write(data)
            if g.startswith('ente:') and len(g.split(':')[1])==7:municipios[UFS[int(g.split(':')[1][:2])]][g]=ref
            else:indices[g]=ref
        for g,rows in sorted(tables.items()):
            data=(json.dumps({'g':g,'rows':rows},ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode();indices[g]=[f.tell(),len(data),hashlib.sha256(data).hexdigest()];f.write(data)
    refs={}
    for uf,items in municipios.items():
        p=work/('financeiro_'+uf.lower()+'.json');json_file(p,items);refs[uf]=objeto(saida,p,'financeiro_'+uf.lower(),'json')
    p=work/'financeiro_entes.json';json_file(p,entidades);ref_entes=objeto(saida,p,'financeiro_entes','json')
    idx=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),origens=orig,
        compatibilidade=dict(siope=m['fontes'].get('siope'),ipca=m['fontes'].get('ipca'),base_ipca=m['base_ipca']),
        meta=dict(anos=m['anos'],anexos={},baseIpca=m['base_ipca'],geradoEm=m['gerado_em'],ipcaUltimo=m.get('ipca_ultimo'),fontes={'siope':m['fontes'].get('siope')},mapaIndicadores={},politica={}),
        entes=ref_entes,arquivo=objeto(saida,arquivo,'financeiro','ndjson'),grupos=indices,municipios=refs,colunas=cols)
    json_file(saida/'gold/educacao/financeiro_manifesto.json',idx)
    assert all(sha(base/k)==v for k,v in orig.items()),'Origem mudou durante a preparação'
    json_file(work/'financeiro_auditoria.json',dict(ok=True,origens_preservadas=orig,pacotes=len(packets),tabelas=len(tables),bytes=idx['arquivo']['bytes']))
    print(json.dumps(dict(ok=True,pacotes=len(packets),tabelas=len(tables),bytes=idx['arquivo']['bytes'])),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    a=p.parse_args();gerar(a.base,a.saida)
