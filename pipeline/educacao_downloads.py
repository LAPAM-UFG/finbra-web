"""Amplia Educação por UF; preserva os arquivos da seleção principal de 297 indicadores.

O dicionário identifica quais variáveis pertencem à base principal. O arquivo
temático contém todos os indicadores de Educação. R e Stata são validados nativamente.
"""
import argparse
import copy
import json
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado
from downloads_enxuto import Enxuto, ler
from downloads_navegacao import objetos, previa, referencia, registrar
from painel_municipal import Painel, KEYS, qi, qs, sha


def gerar(base,educacao,saida,stata,rscript):
    base=base.resolve();educacao=educacao.resolve();saida=destino_isolado(saida,base);destino_isolado(saida,educacao)
    work=saida/'trabalho_downloads';dest=saida/'gold/downloads'
    work.mkdir(parents=True,exist_ok=True);dest.mkdir(parents=True,exist_ok=True)
    old=ler(base/'gold/downloads/manifesto.json');m=copy.deepcopy(old);edu=ler(educacao/'gold/educacao/manifesto.json')
    assert old['base_sha256']==sha(base/'gold/manifesto.json')
    assert old['resumo']['variaveis']==297 and len(edu['indicadores'])==77
    old_refs,old_files=objetos(base,old)
    dictionary=[copy.deepcopy(d) for d in ler(base/old['dicionario']['caminho']) if d['area']!='educacao']
    for d in dictionary:d['arquivo_principal']=True
    municipal=pq.read_table(educacao/edu['parquet']['caminho'],columns=['ano',*[i['variavel'] for i in edu['indicadores']]]).to_pandas()
    for i in edu['indicadores']:
        years=sorted(int(y) for y in municipal.loc[municipal[i['variavel']].notna(),'ano'].unique())
        dictionary.append(dict(variavel=i['variavel'],nome=i['nome'],descricao=i['descricao'],area='educacao',tabela='painel',
            unidade={'numero':'número','percentual':'% (0 a 100)','indice':'índice (0 a 10)'}[i['unidade']],
            fonte='Inep · '+edu['fontes'][i['fonte']]['nome'],tipo='inteiro' if i['unidade']=='numero' else 'numero',
            regra_anual='Valor do ano do Censo ou da divulgação oficial. Ideb somente nos anos observados, sem interpolação.',
            observacao=('Disponível na base principal e no arquivo de Educação. ' if i['principal'] else 'Disponível no arquivo temático de Educação. ')+i['descricao'],anos_observados=years,
            arquivo_principal=i['principal'],
            ano_de=min(years) if years else None,ano_ate=max(years) if years else None,variavel_original=i['variavel']))
    assert len(dictionary)==337 and len({x['variavel'] for x in dictionary})==337
    assert sum(d['arquivo_principal'] for d in dictionary)==303
    stamp=datetime.now(timezone.utc).isoformat();m['gerado_em']=stamp
    # Métodos conhecidos do exportador; toda a escrita aponta para a candidata.
    e=Enxuto.__new__(Enxuto);e.root=saida;e.origem=base;e.base=base;e.work=work;e.dest=dest;e.dictionary=dictionary;e.pending=[]
    e.db=duckdb.connect();e.db.execute("SET threads=2; SET memory_limit='3GB'")
    e.p=Painel.__new__(Painel);e.p.db=e.db;e.p.root=saida;e.p.work=work;e.p.dest=dest;e.p.files=[]
    original=next(a for a in old['arquivos'] if a['id']=='painel_brasil_parquet')
    main=base/original['caminho'];source=educacao/edu['parquet']['caminho']
    assert sha(main)==original['sha256'] and sha(source)==edu['parquet']['sha256']
    e.db.execute('CREATE VIEW anterior AS SELECT * FROM read_parquet('+qs(main.as_posix())+')')
    e.db.execute('CREATE VIEW educacao AS SELECT * FROM read_parquet('+qs(source.as_posix())+')')
    cols=[i['variavel'] for i in edu['indicadores']]
    # A planilha bienal pode trazer colunas históricas vazias para um município
    # recém-criado. Só uma chave com observação real exige entrada no cadastro.
    available=' OR '.join('e.'+qi(k)+' IS NOT NULL' for k in cols)
    extras=e.db.execute('SELECT count(*) FROM educacao e ANTI JOIN anterior a USING(cod_ibge,ano) WHERE ('+available+')').fetchone()[0]
    if extras:raise ValueError(f'Existem {extras} chaves de educação fora da base municipal; confira o cadastro antes de integrar')
    core=[i['variavel'] for i in edu['indicadores'] if i['principal']]
    changed=e.db.execute('SELECT count(*) FROM anterior a LEFT JOIN educacao e USING(cod_ibge,ano) WHERE '+ ' OR '.join('a.'+qi(k)+' IS DISTINCT FROM e.'+qi(k) for k in core)).fetchone()[0]
    if changed:raise ValueError(f'{changed} linhas alterariam os indicadores já publicados; confira antes de ampliar')
    previous_edu=next(a for a in old['arquivos'] if a['id']=='painel_educacao_parquet')
    previous_path=base/previous_edu['caminho'];assert sha(previous_path)==previous_edu['sha256']
    previous_names=[k for k in pq.read_schema(previous_path).names if k.startswith('edu_')]
    assert set(previous_names).issubset(set(cols))
    e.db.execute('CREATE VIEW educacao_anterior AS SELECT * FROM read_parquet('+qs(previous_path.as_posix())+')')
    old_changed=e.db.execute('SELECT count(*) FROM educacao_anterior p FULL JOIN educacao e USING(cod_ibge,ano) WHERE '+ ' OR '.join('p.'+qi(k)+' IS DISTINCT FROM e.'+qi(k) for k in previous_names)).fetchone()[0]
    if old_changed:raise ValueError('Os indicadores de Educação já publicados mudaram')
    e.db.execute('CREATE TABLE ampliado AS SELECT '+','.join('a.'+qi(k) for k in KEYS)+','+','.join('e.'+qi(k) for k in cols)+' FROM anterior a LEFT JOIN educacao e USING(cod_ibge,ano)')
    assert e.db.execute('SELECT count(*) FROM ampliado').fetchone()[0]==original['linhas']
    assert not e.db.execute('SELECT count(*) FROM (SELECT cod_ibge,ano,count(*) n FROM ampliado GROUP BY 1,2 HAVING n>1)').fetchone()[0]
    selected=','.join(qi(k) for k in [*KEYS,*cols]);valid=' OR '.join(qi(k)+' IS NOT NULL' for k in cols)
    query='SELECT '+selected+' FROM ampliado WHERE ('+valid+')'
    e.exportar('painel_educacao',query+' ORDER BY cod_ibge,ano','Educação — Brasil',area='educacao')
    for uf, in e.db.execute('SELECT DISTINCT uf FROM ('+query+') ORDER BY 1').fetchall():
        e.exportar('painel_educacao_'+uf.lower(),query+' AND uf='+qs(uf)+' ORDER BY cod_ibge,ano','Educação — '+uf,area='educacao',uf=uf)
    e.processar_stata(stata)
    for f in e.pending:e.registrar(Path(f['path']),f['id'],f['tipo'],'dta',f['nome'],**f['meta'])
    new=e.p.files
    stata_cells=0
    for a in new:
        if a['formato']!='dta':continue
        src=next(p for p in new if p['id']==a['id'].removesuffix('_dta')+'_parquet')
        names=['cod_ibge','ano',*cols]
        actual=pd.read_stata(saida/a['caminho'],convert_categoricals=False,convert_dates=False)[names]
        truth=pq.read_table(saida/src['caminho'],columns=names).to_pandas()
        pd.testing.assert_frame_equal(actual,truth,check_dtype=False,check_exact=True);stata_cells+=truth.size
    dict_json=work/'dicionario.json';dict_json.write_text(json.dumps(dictionary,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf-8')
    dictionary_ref=registrar(saida,dict_json,'dicionario','json')
    # R nativo: só os 56 conjuntos novos/alterados. Comparação integral de retorno.
    plan=[]
    for a in new:
        if a['formato']!='parquet':continue
        id=a['id'].removesuffix('_parquet')
        plan.append(dict(id=id+'_rds',parquet=str(saida/a['caminho']),rds=str(work/(id+'.rds')),retorno=str(work/(id+'_retorno.parquet')),
                         origem=a['caminho'],sha256=a['sha256'],uf=a['uf'],tema=a['area']))
    dict_rds=work/'dicionario.rds';plan_file=work/'plano_r.json';report=work/'r_nativo.json'
    plan_file.write_text(json.dumps(dict(dicionario=str(saida/dictionary_ref['caminho']),saida_dicionario=str(dict_rds),arquivos=plan,
        base_sha256=m['base_sha256'],gerado_em=stamp),ensure_ascii=False),encoding='utf-8')
    subprocess.run([str(rscript),'--vanilla',str(Path(__file__).with_name('downloads_r.R')),str(plan_file),str(report)],check=True,timeout=1200)
    assert ler(report)['ok'];cells=0
    for item in plan:
        truth=pq.read_table(item['parquet']).to_pandas();back=pq.read_table(item['retorno']).to_pandas()
        pd.testing.assert_frame_equal(back,truth,check_dtype=False,check_exact=True);cells+=truth.size
        src=next(a for a in new if a['id']==item['id'].removesuffix('_rds')+'_parquet')
        new.append({**src,**registrar(saida,Path(item['rds']),item['id'],'rds'),'id':item['id'],'formato':'rds'})
    # A base principal permanece exatamente no mesmo objeto imutável, em todos os formatos.
    before=pq.read_table(main).to_pandas()
    # Uma prévia para cada conjunto lógico, compartilhada entre os quatro formatos.
    preview_refs={}
    for a in new:
        if a['formato']!='parquet':continue
        frame=pq.read_table(saida/a['caminho']).to_pandas()
        preview_refs[(a['tipo'],a['area'],a['uf'])]=referencia(saida,work,'previa_'+a['id'].removesuffix('_parquet'),previa(frame,dictionary,a))
    for a in new:a['previa']=preview_refs[(a['tipo'],a['area'],a['uf'])]
    m['arquivos']=[a for a in m['arquivos'] if a['area']!='educacao' and not (a['tipo']=='dicionario' and a.get('escopo')=='principal')]
    m['arquivos'].extend(a for a in new if not (a['tipo']=='area' and a['uf']))
    m['areas']=[a for a in m['areas'] if a['id']!='educacao']
    m['areas'].append(dict(id='educacao',nome='Educação',nome_en='Education',descricao='77 indicadores: matrículas, percentuais por sexo/cor/raça, inclusão, docentes, turmas, infraestrutura, trajetória e Ideb.',descricao_en='77 indicators: enrolments, sex/race/colour percentages, inclusion, teaching positions, classes, infrastructure, progression and Ideb.'))
    for uf,ref in old['recortes_uf'].items():
        cat=ler(base/ref['caminho']);cat['arquivos']=[a for a in cat['arquivos'] if a['area']!='educacao'];cat['arquivos'].extend(a for a in new if a['tipo']=='area' and a['uf']==uf)
        m['recortes_uf'][uf]=referencia(saida,work,'catalogo_'+uf.lower(),cat)
    template=next(a for a in old['arquivos'] if a['id']=='dicionario_json')
    def dict_item(id,fmt,path,label):
        ref=registrar(saida,path,id,fmt)
        m['arquivos'].append({**template,**ref,'id':id,'formato':fmt,'linhas':len(dictionary),'variaveis':None,'nome':label,'nome_en':label})
    m['dicionario']=dictionary_ref
    m['arquivos'].append({**template,**dictionary_ref,'id':'dicionario_json','linhas':len(dictionary),'nome':'Dicionário dos downloads — JSON','nome_en':'Download dictionary — JSON'})
    flat=pd.DataFrame([{k:json.dumps(v,ensure_ascii=False) if isinstance(v,(dict,list)) else v for k,v in row.items()} for row in dictionary])
    csv=work/'dicionario.csv';flat.to_csv(csv,index=False,sep=';',encoding='utf-8-sig',lineterminator='\r\n')
    zipped=work/'dicionario.csv.zip'
    with zipfile.ZipFile(zipped,'w',zipfile.ZIP_DEFLATED) as z:z.write(csv,'dicionario.csv')
    dict_item('dicionario_csv','csv.zip',zipped,'Dicionário dos downloads — CSV')
    excel=work/'dicionario.xlsx'
    with pd.ExcelWriter(excel,engine='openpyxl') as writer:
        flat.to_excel(writer,index=False,sheet_name='variaveis');ws=writer.sheets['variaveis'];ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
        from openpyxl.styles import Alignment,Font,PatternFill
        from openpyxl.utils import get_column_letter
        for index,name in enumerate(flat.columns,1):ws.column_dimensions[get_column_letter(index)].width=76 if name in ['descricao','observacao'] else 44 if name in ['nome','regra_anual'] else 25
        for cell in ws[1]:cell.font=Font(color='FFFFFF',bold=True);cell.fill=PatternFill('solid',fgColor='003B5C')
        for row in ws.iter_rows(min_row=2):
            ws.row_dimensions[row[0].row].height=60
            for cell in row:cell.alignment=Alignment(vertical='top',wrap_text=True)
    assert len(pd.read_excel(excel,engine='calamine'))==337
    dict_item('dicionario_excel','xlsx',excel,'Dicionário dos downloads — Excel')
    dict_item('dicionario_rds','rds',dict_rds,'Dicionário dos downloads — R')
    m['resumo']['variaveis']=297
    m['notas'][0]='Base enxuta: 297 variáveis principais, além dos seis identificadores, somente desde 2013.'
    m['notas']=[n for n in m['notas'] if not n.startswith('Educação:')]
    m['notas'].append('Educação: o arquivo do tema contém 77 indicadores; 43 também integram a seleção principal, que mantém 297 indicadores. arquivo_principal no dicionário identifica essa disponibilidade. Sexo/cor/raça: percentuais sobre todas as matrículas da educação básica do mesmo ano/território, incluindo cor/raça não declarada; agregados são razões das somas. São escolas no território; matrículas não são pessoas únicas e docentes são somados por escola. Percentuais são 0–100, Ideb é 0–10. Ausências e anos bienais são preservados.')
    m.setdefault('fontes_complementares',{})['educacao']=dict(caminho='gold/educacao/manifesto.json',sha256=sha(educacao/'gold/educacao/manifesto.json'),gerado_em=edu['gerado_em'])
    # Substitui o texto metodológico que descrevia a dimensão antiga da base.
    for index,a in enumerate(m['arquivos']):
        if a['tipo']=='metodologia' and a['formato']=='txt':
            text=work/'metodologia.txt';text.write_text('\n\n'.join(m['notas'])+'\n\nEducação: '+json.dumps(edu['fontes'],ensure_ascii=False)+'\n',encoding='utf-8')
            m['arquivos'][index]={**a,**registrar(saida,text,a['id'],'txt')}
    # Copia somente os objetos antigos ainda referenciados, inclusive prévias e complementos.
    refs,_=objetos(saida,m)
    for ref in refs:
        target=saida/ref['caminho']
        if not target.exists():
            origin=base/ref['caminho'];assert sha(origin)==ref['sha256'];shutil.copyfile(origin,target)
        assert target.stat().st_size==ref['bytes'] and sha(target)==ref['sha256']
    # Pacotes nacionais contêm a seleção principal e seu dicionário: também são preservados.
    assert [a for a in m['arquivos'] if a['tipo'] in ['painel','pacote']]==[a for a in old['arquivos'] if a['tipo'] in ['painel','pacote']]
    refs,files=objetos(saida,m)
    for ref in refs:assert sha(saida/ref['caminho'])==ref['sha256']
    assert old['base_sha256']==sha(base/'gold/manifesto.json')
    (dest/'manifesto.json').write_text(json.dumps(m,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf-8')
    audit=dict(ok=True,variaveis=297,colunas=303,indicadores_educacao=77,dicionario=337,principal_identica=True,educacao_anterior_identica=True,linhas=original['linhas'],novos_conjuntos=len(plan),celulas_r_conferidas=cells,
        anteriores_preservadas=before.size,celulas_stata_conferidas=stata_cells,objetos=len(refs),arquivos=len(files),origem_manifesto_sha256=sha(base/'gold/downloads/manifesto.json'),manifesto_sha256=sha(dest/'manifesto.json'))
    (work/'auditoria.json').write_text(json.dumps(audit,indent=2),encoding='utf-8');print(json.dumps(audit),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ['base','educacao','saida','stata','rscript']:p.add_argument('--'+arg,type=Path,required=True)
    a=p.parse_args();gerar(a.base,a.educacao,a.saida,a.stata,a.rscript)
