"""Auditoria da candidata: integridade, agregados e cotejo independente com CSV."""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

import duckdb

from educacao import IDS, NOMES_UF, UFS, planilhas, normal
import pandas as pd
from educacao_baixar import sha
from painel_municipal import qs


def ler(p):return json.loads(p.read_text(encoding='utf-8'))


def validar(root,brutos):
    m=ler(root/'gold/educacao/manifesto.json');coleta=ler(brutos/'coleta.json')
    assert len(m['indicadores'])==43 and m['anos']==list(range(2013,2026))
    assert [i['id'] for i in m['indicadores']]==IDS
    assert m['coleta_sha256']==sha(brutos/'coleta.json')
    refs=[m['arquivo'],m['parquet'],*m['municipios'].values(),*m['rankings'].values()]
    for ref in refs:
        p=(root/ref['caminho']).resolve();assert p.is_relative_to((root/'gold/educacao').resolve())
        assert p.stat().st_size==ref['bytes'] and sha(p)==ref['sha256']
    territories={t['grupo']:t for t in m['territorios']}
    assert territories['SP']['nome']=='São Paulo' and territories['SE']['nome']=='Sergipe'
    for uf,ref in m['municipios'].items():
        for t in ler(root/ref['caminho']):
            assert t['uf']==uf and t['grupo'] not in territories
            assert UFS[int(t['grupo'][:2])]==uf and t['nome']
            territories[t['grupo']]=t
    values={};coverage={};offsets=[]
    with (root/m['arquivo']['caminho']).open('rb') as f:
        for g,t in territories.items():
            offset,size,digest=t['trecho'];f.seek(offset);raw=f.read(size)
            assert hashlib.sha256(raw).hexdigest()==digest and raw.endswith(b'\n')
            record=json.loads(raw);assert record['grupo']==g
            years=[int(r[0]) for r in record['linhas']];assert years==sorted(set(years))
            for row in record['linhas']:
                assert len(row)==44 and 2013<=row[0]<=2025
                vals=dict(zip(IDS,row[1:]));values[(g,row[0])]=vals
                coverage[(g,row[0])]=record['cobertura'].get(str(row[0]),{})
                for i in m['indicadores']:
                    v=vals[i['id']]
                    if v is None:continue
                    assert math.isfinite(v) and v>=0
                    if i['unidade']=='percentual':assert v<=100
                    elif i['unidade']=='indice':assert v<=10
                    else:assert int(v)==v
            offsets.append((offset,size))
    pos=0
    for start,size in sorted(offsets):assert start==pos;pos+=size
    assert pos==m['arquivo']['bytes']
    # A publicação de taxas tem referências próprias; nunca se exige soma/média de Ideb.
    count_ids=['mat_total','mat_creche','mat_pre','mat_ai','mat_af','mat_medio','mat_eja','mat_prof','mat_especial','mat_publica','mat_municipal','mat_estadual','mat_privada','mat_federal','escolas','escolas_publicas','escolas_municipais']
    compared=0
    for year in m['anos']:
        for group in ['BR',*NOMES_UF]:
            agg=values.get((group,year))
            if agg is None:continue
            members=[g for g,t in territories.items() if t['nivel']=='M' and (group=='BR' or t['uf']==group)]
            for id in count_ids:
                observed=[values[(g,year)].get(id) for g in members if (g,year) in values and values[(g,year)].get('mat_total') is not None]
                if agg.get(id) is not None and observed and all(v is not None for v in observed):
                    assert sum(observed)==agg[id],(group,year,id);compared+=1
            for id,(n,d) in coverage.get((group,year),{}).items():
                municipal=[coverage.get((g,year),{}).get(id,[0,0]) for g in members]
                assert sum(v[0] for v in municipal)==n and sum(v[1] for v in municipal)==d
                assert (agg[id] is None and d==0) or math.isclose(agg[id],100*n/d,rel_tol=1e-12)
    # MD5 distribuído pelo Inep, além de CRC e SHA-256 registrados na extração.
    md5_checked=0
    for source in coleta['censo']:
        folder=brutos/str(source['ano']);expected={}
        for path in folder.glob('md5_*.txt'):
            for line in path.read_text(encoding='utf-8-sig').splitlines():
                match=re.match(r'([a-fA-F0-9]{32})\s+\*?(.+)',line.strip())
                if match:expected[Path(match[2]).name.lower()]=match[1].lower()
        for entry in source['arquivos']:
            path=folder/entry['nome'];assert sha(path)==entry['sha256']
            if path.suffix.lower()=='.csv' and path.name.lower() in expected:
                with path.open('rb') as f:assert hashlib.file_digest(f,'md5').hexdigest()==expected[path.name.lower()]
                md5_checked+=1
    # Um segundo motor lê os CSV diretamente, sem usar a transformação pandas.
    db=duckdb.connect();checks=[]
    def csv(p):return 'read_csv('+qs(p.as_posix())+",delim=';',header=true,all_varchar=true,encoding='latin-1')"
    for year in [2013,2024,2025]:
        folder=brutos/str(year);school=next(p for p in folder.iterdir() if p.suffix.lower()=='.csv' and ('microdados_ed_basica' in p.name.lower() or 'tabela_escola_' in p.name.lower()))
        if year==2025:
            mat=next(folder.glob('Tabela_Matricula_*.csv'))
            query='SELECT s.CO_MUNICIPIO,s.SG_UF,s.TP_DEPENDENCIA,s.TP_SITUACAO_FUNCIONAMENTO,m.QT_MAT_BAS FROM '+csv(school)+' s JOIN '+csv(mat)+' m USING(CO_ENTIDADE)'
        else:query='SELECT CO_MUNICIPIO,SG_UF,TP_DEPENDENCIA,TP_SITUACAO_FUNCIONAMENTO,QT_MAT_BAS FROM '+csv(school)
        db.execute('CREATE OR REPLACE TABLE escolas AS '+query)
        for group,condition in [('BR','true'),('GO',"SG_UF='GO'"),('5208707',"CO_MUNICIPIO='5208707'"),('DF',"SG_UF='DF'")]:
            total,schools,public=db.execute('SELECT sum(cast(QT_MAT_BAS as BIGINT)),count(*),sum(CASE WHEN TP_DEPENDENCIA IN (\'1\',\'2\',\'3\') THEN cast(QT_MAT_BAS as BIGINT) ELSE 0 END) FROM escolas WHERE TP_SITUACAO_FUNCIONAMENTO=\'1\' AND cast(QT_MAT_BAS as BIGINT)>0 AND '+condition).fetchone()
            rec=values[(group,year)];assert (rec['mat_total'],rec['escolas'],rec['mat_publica'])==(total,schools,public),(group,year)
            checks.append(dict(grupo=group,ano=year,matriculas=total,escolas=schools))
    # Cotejo por nomes literais da tabela original: não reutiliza o mapa nome→UF
    # da transformação, para detectar troca entre São Paulo e Sergipe.
    ideb_checks=[]
    source=next(s for s in coleta['indicadores'] if s['fonte']=='ideb' and 'ufs' in s['url'])
    for filename,book in planilhas(Path(source['caminho'])):
        for sheet in book.sheet_names:
            raw=pd.read_excel(book,sheet_name=sheet,header=None)
            header=next(n for n,r in raw.iterrows() if 'VL_OBSERVADO_2025' in r.values)
            column=list(raw.iloc[header]).index('VL_OBSERVADO_2025')
            stage='ai' if '(ai)' in normal(sheet) or 'iniciais' in normal(sheet) else 'af' if '(af)' in normal(sheet) or 'finais' in normal(sheet) else 'medio'
            network='Estadual' if stage=='medio' else 'Pública'
            field='ideb_medio_estadual' if stage=='medio' else 'ideb_'+stage
            for name,uf in [('São Paulo','SP'),('Sergipe','SE')]:
                networks=raw.iloc[:,1].astype(str).str.replace(r'\s*\(\d+\)','',regex=True).str.strip()
                expected=raw.loc[(raw.iloc[:,0]==name)&(networks==network),column]
                assert len(expected)==1,(sheet,name)
                assert values[(uf,2025)][field]==float(expected.iloc[0]),(uf,field)
                ideb_checks.append(dict(uf=uf,ano=2025,indicador=field,valor=float(expected.iloc[0])))
    assert len(ideb_checks)==6
    out=dict(ok=True,indicadores=43,territorios=len(territories),objetos=len(refs),somas_conferidas=compared,md5_inep_conferidos=md5_checked,duckdb=checks,ideb_estados=ideb_checks)
    (root/'trabalho_educacao/auditoria.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(out,ensure_ascii=False),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raiz',type=Path,required=True);p.add_argument('--brutos',type=Path,required=True)
    a=p.parse_args();validar(a.raiz,a.brutos)
