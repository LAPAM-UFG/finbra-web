"""Audita o candidato publicado: chaves, hashes, Range, nulos, preços e equivalência JSON/Parquet."""
import argparse
import hashlib
import json
from pathlib import Path
import duckdb

def sha(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def validar(root,ipea=None):
    m=json.loads((root/'gold/manifesto.json').read_text(encoding='utf-8'))
    a=m['fontes']['assistencia'];q=json.loads((root/a['qualidade']).read_text(encoding='utf-8'))
    assert q['parcial'] is False,'Um candidato de desenvolvimento não pode ser publicado'
    index=a['abertura'];assert sha(root/index['caminho'])==index['sha256']
    meta=json.loads((root/index['caminho']).read_text(encoding='utf-8'))
    assert len(meta['territorios'])==len(meta['grupos']) and len(meta['grupos'])>=5599
    assert len({i['id'] for i in meta['indicadores']})==len(meta['indicadores'])
    report={'indicadores':len(meta['indicadores']),'territorios':len(meta['territorios']),'hashes':0,'linhas_sql':{},'comparacoes_json_sql':0}
    objects=[meta['arquivo'],*a['arquivos'].values()]
    for f in meta['rankings'].values():objects.extend(f.values())
    for obj in objects:
        path=root/obj['caminho'];assert path.stat().st_size==obj['bytes'] and sha(path)==obj['sha256'],obj['caminho']
        report['hashes']+=1
    con=duckdb.connect();con.execute("SET memory_limit='4GB'");con.execute('SET threads=4')
    sample={'BR','GO','5208707','PB','2507507','2605459','DF','5300108','5101837','1504752'}
    expected={}
    try:
        for name in ['cadunico','pbf','bpc']:
            path=(root/a['arquivos'][name]['caminho']).as_posix()
            con.execute(f"CREATE VIEW {name} AS SELECT * FROM read_parquet('{path}')")
            count=con.sql(f'SELECT count(*) FROM {name}').fetchall()[0][0];report['linhas_sql'][name]=count;assert count>10000
            assert con.sql(f'SELECT count(*) FROM (SELECT competencia,grupo,indicador FROM {name} GROUP BY ALL HAVING count(*)<>1)').fetchall()[0][0]==0
            assert con.sql(f"SELECT count(*) FROM {name} WHERE valor IS NOT NULL AND NOT isfinite(valor)").fetchall()[0][0]==0
            assert con.sql(f"SELECT count(*) FROM {name} WHERE condicao='suprimido' AND valor IS NOT NULL").fetchall()[0][0]==0
            assert con.sql(f"SELECT count(*) FROM {name} WHERE valor IS NULL AND condicao IN ('registrado','zero_registrado')").fetchall()[0][0]==0
            assert not any(col[0].lower() in ['cpf','nis','nb','numero_beneficio','nome_beneficiario'] for col in con.sql(f'DESCRIBE {name}').fetchall())
            values=','.join("'"+g+"'" for g in sample)
            for mes,g,id,value,condition in con.sql(f'SELECT competencia,grupo,indicador,valor,condicao FROM {name} WHERE grupo IN ({values})').fetchall():
                expected[(name,g,mes,id)]=(value,condition)
        body=root/meta['arquivo']['caminho'];position=0;seen=set();comparison=0;checkpoints={}
        with body.open('rb') as stream:
            for line in stream:
                r=json.loads(line);g=r['grupo'];assert g not in seen;seen.add(g)
                assert meta['grupos'][g]==[position,len(line),hashlib.sha256(line).hexdigest()];position+=len(line)
                for fonte,series in r['series'].items():
                    assert [s['competencia'] for s in series]==sorted({s['competencia'] for s in series})
                    if g not in sample:continue
                    for s in series:
                        for id,v in s['valores'].items():
                            cond=s['condicoes'].get(id,'zero_registrado' if v==0 else 'registrado')
                            assert expected.pop((fonte,g,s['competencia'],id))==(v,cond),(fonte,g,s['competencia'],id)
                            comparison+=1
                if g=='BR':checkpoints=r
        assert not expected and seen==set(meta['grupos']) and position==body.stat().st_size
        report['comparacoes_json_sql']=comparison
        cad=checkpoints['series']['cadunico'][-1]
        original=q['fontes']['cadunico']['referencias']['brasil']
        assert cad['valores']['cad_qtd_familias']==original['cad_qtd_familias'] and cad['valores']['cad_qtd_pessoas']==original['cad_qtd_pessoas']
        bpc=checkpoints['series']['bpc'];assert bpc[0]['competencia']==201901
        last=bpc[-1]['competencia'];assert len(bpc)==(last//100-2019)*12+last%100
        report['brasil']={'cadunico_familias':cad['valores']['cad_qtd_familias'],'cadunico_pessoas':cad['valores']['cad_qtd_pessoas'],
                          'bpc_competencia':last,'bpc_beneficios':bpc[-1]['valores']['bpc_beneficios'],'bpc_valor':bpc[-1]['valores']['bpc_valor_pago']}
        # Totais monetários somáveis; contagens distintas de benefícios não são forçadas à soma municipal.
        missing=q['fontes']['bpc'].get('sem_uf',[])
        con.register('sem_uf',__import__('pyarrow').Table.from_pylist(missing or [{'competencia':0,'parcelas':0,'valor_pago':0.0}]))
        differences=con.sql("""WITH br AS (SELECT competencia,indicador,valor FROM bpc WHERE grupo='BR' AND indicador IN ('bpc_valor_pago','bpc_pagamentos')),
          uf AS (SELECT competencia,indicador,sum(valor) AS valor FROM bpc WHERE nivel='UF' AND indicador IN ('bpc_valor_pago','bpc_pagamentos') GROUP BY ALL)
          SELECT max(abs(br.valor-uf.valor-coalesce(CASE WHEN br.indicador='bpc_valor_pago' THEN s.valor_pago ELSE s.parcelas END,0)))
          FROM br JOIN uf USING(competencia,indicador) LEFT JOIN sem_uf s USING(competencia)""").fetchall()[0][0]
        assert differences<0.02,differences;report['erro_maximo_soma_bpc']=differences
        report['bpc_sem_uf']=missing
        if ipea:
            ref=json.loads(ipea.read_text(encoding='utf-8-sig'))['value']
            serie={int(x['VALDATA'][:7].replace('-','')):x['VALVALOR'] for x in ref if x['TERCODIGO']=='0'}
            unknown={s['competencia']:s['parcelas'] for s in missing}
            common=[r for r in bpc if r['competencia'] in serie]
            diffs=[{'competencia':r['competencia'],'beneficios_distintos':r['valores']['bpc_beneficios'],
                    'parcelas':r['valores']['bpc_pagamentos'],'ipeadata':serie[r['competencia']],
                    'ipea_igual_parcelas_com_uf':serie[r['competencia']]==r['valores']['bpc_pagamentos']-unknown.get(r['competencia'],0)}
                   for r in common if r['valores']['bpc_beneficios']!=serie[r['competencia']]]
            report['ipeadata_br_competencias']=len(common);report['ipeadata_divergencias']=diffs
            report['ipeadata_nota']='Conferência externa, não série substituta: parcelas, NB distintos e exclusão de UF ignorada produzem contagens diferentes. Divergências restantes não têm causa atribuída sem evidência; o indicador mantém a definição e os arquivos CGU identificados por hash.'
        return report
    finally:con.close()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raiz',type=Path,required=True);p.add_argument('--ipea',type=Path);p.add_argument('--relatorio',type=Path)
    a=p.parse_args();r=validar(a.raiz,a.ipea)
    if a.relatorio:a.relatorio.write_text(json.dumps(r,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(r,ensure_ascii=False),flush=True)
