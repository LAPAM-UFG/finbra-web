"""Acrescenta o tema Saneamento aos downloads/API, preservando a seleção principal.

Somente a candidata recebe arquivos. As referências antigas continuam imutáveis.
Gera Brasil/UF, Stata 14+, RDS nativo, CSV, Parquet, prévias e dicionários.
"""
import argparse,copy,json,os,subprocess,time,zipfile
from datetime import datetime,timezone
from pathlib import Path
import duckdb
import pandas as pd
import pyarrow.parquet as pq
from assistencia_utils import destino_isolado
from downloads_enxuto import Enxuto,ler
from downloads_navegacao import previa,referencia,registrar
from painel_municipal import Painel,KEYS,qi,qs,sha
from saneamento_indicadores import CONDICOES

def declarar_stata(pending,work,exe):
    if exe is None:
        for item in pending:
            frame=pd.read_stata(item['path'],convert_categoricals=False,convert_dates=False)
            if frame[['cod_ibge','ano']].isna().any().any() or frame.duplicated(['cod_ibge','ano']).any():raise ValueError('Chave município/ano inválida no Stata')
            if not frame.ano.ge(2013).all():raise ValueError('Stata com observações anteriores a 2013')
            if not frame.cod_ibge.between(1000000,9999999).all():raise ValueError('Código municipal inválido no Stata')
        print('Stata 14+: arquivos relidos e chaves conferidas; executável nativo não disponível neste ambiente.',flush=True)
        return
    flag=work/'stata_ok.txt';flag.unlink(missing_ok=True)
    do=work/'declarar_saneamento.do';log=work/'stata_nativo.log'
    lines=['version 14','set more off','capture log close _all','log using "'+log.as_posix()+'", text replace']
    for item in pending:
        f=Path(item['path']).as_posix();lines+=['use "'+f+'", clear','isid cod_ibge ano','assert ano >= 2013','xtset cod_ibge ano, yearly','compress','save "'+f+'", replace']
    lines+=['log close','file open ok using "'+flag.as_posix()+'", write replace','file write ok "ok"','file close ok','exit, clear']
    do.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    startup=None;creation=0
    if os.name=='nt':
        startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0;creation=subprocess.CREATE_NO_WINDOW
    proc=subprocess.Popen([str(exe),'/e','do',str(do)],cwd=work,startupinfo=startup,creationflags=creation)
    end=time.monotonic()+240
    while not flag.exists() and time.monotonic()<end:
        if proc.poll() is not None and log.exists() and 'end of do-file' in log.read_text(encoding='utf-8',errors='replace'):break
        time.sleep(1)
    if not flag.exists():raise ValueError('Stata não confirmou os arquivos; conferir '+str(log))
    print('Stata nativo: chaves, xtset e gravação conferidos.',flush=True)

def gerar(base,painel,saida,stata,rscript):
    base=Path(base).resolve();painel=Path(painel).resolve();saida=destino_isolado(Path(saida),base);destino_isolado(saida,painel)
    work=saida/'trabalho_downloads_saneamento';dest=saida/'gold/downloads';work.mkdir(parents=True,exist_ok=True);dest.mkdir(parents=True,exist_ok=True)
    old=ler(base/'gold/downloads/manifesto.json');m=copy.deepcopy(old);meta=ler(painel/'gold/saneamento/manifesto.json')
    assert old['base_sha256']==sha(base/'gold/manifesto.json')
    main=next(a for a in old['arquivos'] if a['id']=='painel_brasil_parquet');mainpath=base/main['caminho'];assert sha(mainpath)==main['sha256']
    source=painel/meta['parquet']['caminho'];assert sha(source)==meta['parquet']['sha256']
    dictionary=[d for d in ler(base/old['dicionario']['caminho']) if d['area']!='saneamento']
    ids=[i['variavel'] for i in meta['indicadores']];columns=[v for id in ids for v in [id,id+'_cond']]
    df=pq.read_table(source).to_pandas()
    units={'economias':'unidades atendidas (economias)','entidades':'entidades','ocorrencias':'ocorrências/ano','obitos':'óbitos/ano','imoveis':'imóveis/ano','m3':'m³ de armazenamento','percentual':'% (0 a 100)','pessoas':'pessoas','ligacoes':'ligações','km':'km','m3_ano':'m³/ano','t_ano':'toneladas/ano','domicilios':'domicílios'}
    for i in meta['indicadores']:
        years=sorted(int(y) for y in df.loc[df[i['variavel']].notna(),'ano'].unique())
        for cond in [False,True]:
            name=i['variavel']+('_cond' if cond else '')
            dictionary.append(dict(variavel=name,nome=('Condição: ' if cond else '')+i['nome'],descricao=('Código da condição do dado pareado '+i['variavel'] if cond else i['descricao']),area='saneamento',tabela='painel',unidade='código de condição' if cond else units[i['unidade']],fonte='Ministério das Cidades · SNIS/SINISA',tipo='inteiro' if cond else 'numero',regra_anual='Ano de referência da informação. SNIS 2013–2022; SINISA 2023–2024, com quebra de metodologia. Não se interpolam anos e não se preenchem ausências com zero.',observacao='Arquivo temático próprio; não altera a seleção principal de 297 indicadores. '+i['descricao'],anos_observados=years,arquivo_principal=False,ano_de=min(years) if years else None,ano_ate=max(years) if years else None,variavel_original=name,**({'stata_rotulos':{str(k):v for k,v in CONDICOES.items()}} if cond else {})))
    assert len({d['variavel'] for d in dictionary})==len(dictionary)
    assert sum(d.get('arquivo_principal')is not False for d in dictionary)==303
    e=Enxuto.__new__(Enxuto);e.root=saida;e.origem=base;e.base=base;e.work=work;e.dest=dest;e.dictionary=dictionary;e.pending=[]
    e.db=duckdb.connect();e.db.execute("SET threads=2; SET memory_limit='2GB'")
    e.p=Painel.__new__(Painel);e.p.db=e.db;e.p.root=saida;e.p.work=work;e.p.dest=dest;e.p.files=[]
    e.db.execute('CREATE VIEW anterior AS SELECT * FROM read_parquet('+qs(mainpath.as_posix())+')')
    e.db.execute('CREATE VIEW saneamento AS SELECT * FROM read_parquet('+qs(source.as_posix())+')')
    missing=e.db.execute('SELECT count(*) FROM saneamento s ANTI JOIN anterior a USING(cod_ibge,ano)').fetchone()[0]
    if missing:raise ValueError('Chaves de saneamento fora do cadastro publicado: '+str(missing))
    expr=[]
    for i in meta['indicadores']:
        name=i['variavel'];expr.append('s.'+qi(name))
        years=','.join(map(str,i['anos'])) or '-1';expr.append('coalesce(s.'+qi(name+'_cond')+',CASE WHEN a.ano IN ('+years+') THEN 1 ELSE 5 END)::TINYINT AS '+qi(name+'_cond'))
    e.db.execute('CREATE TABLE tematico AS SELECT '+','.join('a.'+qi(k) for k in KEYS)+','+','.join(expr)+' FROM anterior a LEFT JOIN saneamento s USING(cod_ibge,ano) WHERE a.ano BETWEEN 2013 AND '+str(max(meta['anos'])))
    assert not e.db.execute('SELECT count(*) FROM (SELECT cod_ibge,ano,count(*) n FROM tematico GROUP BY 1,2 HAVING n>1)').fetchone()[0]
    select=','.join(qi(k) for k in [*KEYS,*columns])
    e.exportar('painel_saneamento','SELECT '+select+' FROM tematico ORDER BY cod_ibge,ano','Saneamento — Brasil',area='saneamento')
    for uf, in e.db.execute('SELECT DISTINCT uf FROM tematico ORDER BY 1').fetchall():
        e.exportar('painel_saneamento_'+uf.lower(),'SELECT '+select+' FROM tematico WHERE uf='+qs(uf)+' ORDER BY cod_ibge,ano','Saneamento — '+uf,area='saneamento',uf=uf)
    declarar_stata(e.pending,work,stata)
    for f in e.pending:e.registrar(Path(f['path']),f['id'],f['tipo'],'dta',f['nome'],**f['meta'])
    new=e.p.files;stata_cells=0
    for a in new:
        if a['formato']!='dta':continue
        orig=next(p for p in new if p['id']==a['id'].removesuffix('_dta')+'_parquet')
        truth=pq.read_table(saida/orig['caminho']).to_pandas();actual=pd.read_stata(saida/a['caminho'],convert_categoricals=False,convert_dates=False)
        pd.testing.assert_frame_equal(actual,truth,check_dtype=False,check_exact=True);stata_cells+=truth.size
    dictionaryfile=work/'dicionario.json';dictionaryfile.write_text(json.dumps(dictionary,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    dref=registrar(saida,dictionaryfile,'dicionario','json');plan=[]
    for a in list(new):
        if a['formato']!='parquet':continue
        id=a['id'].removesuffix('_parquet');plan.append(dict(id=id+'_rds',parquet=str(saida/a['caminho']),rds=str(work/(id+'.rds')),retorno=str(work/(id+'_retorno.parquet')),origem=a['caminho'],sha256=a['sha256'],uf=a['uf'],tema='saneamento',rede='todas'))
    stamp=datetime.now(timezone.utc).isoformat();rdict=work/'dicionario.rds';rplan=work/'plano_r.json';report=work/'r_nativo.json'
    rplan.write_text(json.dumps(dict(dicionario=str(saida/dref['caminho']),saida_dicionario=str(rdict),arquivos=plan,base_sha256=m['base_sha256'],gerado_em=stamp)),encoding='utf-8')
    subprocess.run([str(rscript),'--vanilla',str(Path(__file__).with_name('downloads_r.R')),str(rplan),str(report)],check=True,timeout=600)
    assert ler(report)['ok'];r_cells=0
    for item in plan:
        truth=pq.read_table(item['parquet']).to_pandas();back=pq.read_table(item['retorno']).to_pandas();pd.testing.assert_frame_equal(back,truth,check_dtype=False,check_exact=True);r_cells+=truth.size
        orig=next(a for a in new if a['id']==item['id'].removesuffix('_rds')+'_parquet')
        new.append({**orig,**registrar(saida,Path(item['rds']),item['id'],'rds'),'id':item['id'],'formato':'rds'})
    previews={}
    for a in new:
        if a['formato']=='parquet':previews[a['uf']]=referencia(saida,work,'previa_'+a['id'].removesuffix('_parquet'),previa(pq.read_table(saida/a['caminho']).to_pandas(),dictionary,a))
    for a in new:a['previa']=previews[a['uf']]
    m['arquivos']=[a for a in m['arquivos'] if a.get('area')!='saneamento' and not(a['tipo']=='dicionario'and a.get('escopo')=='principal')]
    m['arquivos'].extend(a for a in new if not a['uf'])
    for uf,ref in old['recortes_uf'].items():
        cat=ler(base/ref['caminho']);cat['arquivos']=[a for a in cat['arquivos'] if a.get('area')!='saneamento'];cat['arquivos'].extend(a for a in new if a['uf']==uf)
        m['recortes_uf'][uf]=referencia(saida,work,'catalogo_'+uf.lower(),cat)
    m['areas']=[a for a in m['areas'] if a['id']!='saneamento']+[dict(id='saneamento',nome='Saneamento',nome_en='Sanitation',descricao=f'{len(ids)} indicadores e condições: água, esgoto, resíduos e drenagem, desde 2013; quebra SNIS/SINISA em 2023.',descricao_en=f'{len(ids)} indicators and data status: water, sewage, waste and drainage since 2013; SNIS/SINISA methodology break in 2023.')]
    template=next(a for a in old['arquivos'] if a['id']=='dicionario_json')
    def dict_item(id,fmt,path,label):m['arquivos'].append({**template,**registrar(saida,path,id,fmt),'id':id,'formato':fmt,'linhas':len(dictionary),'variaveis':None,'nome':label,'nome_en':label})
    m['dicionario']=dref;m['arquivos'].append({**template,**dref,'id':'dicionario_json','linhas':len(dictionary),'nome':'Dicionário dos downloads — JSON','nome_en':'Download dictionary — JSON'})
    flat=pd.DataFrame([{k:json.dumps(v,ensure_ascii=False)if isinstance(v,(dict,list))else v for k,v in row.items()}for row in dictionary]);csv=work/'dicionario.csv';flat.to_csv(csv,index=False,sep=';',encoding='utf-8-sig')
    zipped=work/'dicionario.csv.zip'
    with zipfile.ZipFile(zipped,'w',zipfile.ZIP_DEFLATED)as z:z.write(csv,'dicionario.csv')
    dict_item('dicionario_csv','csv.zip',zipped,'Dicionário — CSV');excel=work/'dicionario.xlsx'
    with pd.ExcelWriter(excel,engine='openpyxl')as w:
        flat.to_excel(w,index=False,sheet_name='variaveis');ws=w.sheets['variaveis'];ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
        from openpyxl.styles import Alignment,Font,PatternFill
        for row in ws.iter_rows():
            for cell in row:cell.alignment=Alignment(vertical='top',wrap_text=True)
        for c in ws[1]:c.font=Font(color='FFFFFF',bold=True);c.fill=PatternFill('solid',fgColor='002F51')
        for col in ws.columns:ws.column_dimensions[col[0].column_letter].width=58 if col[0].value in ['nome','descricao','observacao'] else 25
    assert len(pd.read_excel(excel,engine='calamine'))==len(dictionary)
    dict_item('dicionario_excel','xlsx',excel,'Dicionário — Excel');dict_item('dicionario_rds','rds',rdict,'Dicionário — R')
    m['gerado_em']=stamp;m['notas']=[n for n in m['notas'] if not n.startswith('Saneamento:')]
    m['notas'].append(f'Saneamento: arquivo temático próprio, Brasil/UF, desde 2013, com {len(ids)} valores e {len(ids)} códigos de condição. SNIS até 2022 e SINISA desde 2023: definições e cobertura mudam. Drenagem começa em 2015 e não tem 2016. Não se interpolam ausências. Os demais temas e a seleção principal de 297 indicadores permanecem nos mesmos objetos imutáveis.')
    m.setdefault('fontes_complementares',{})['saneamento']=dict(caminho='gold/saneamento/manifesto.json',sha256=sha(painel/'gold/saneamento/manifesto.json'),gerado_em=meta['gerado_em'])
    for index,a in enumerate(m['arquivos']):
        if a['tipo']=='metodologia'and a['formato']=='txt':
            txt=work/'metodologia.txt';txt.write_text('\n\n'.join(m['notas'])+'\n',encoding='utf-8');m['arquivos'][index]={**a,**registrar(saida,txt,a['id'],'txt')}
    assert all(next(a for a in m['arquivos'] if a['id']==o['id'])==o for o in old['arquivos'] if o['tipo']=='painel')
    (dest/'manifesto.json').write_text(json.dumps(m,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    audit=dict(ok=True,origem_manifesto_sha256=sha(base/'gold/downloads/manifesto.json'),manifesto_sha256=sha(dest/'manifesto.json'),saneamento_manifesto_sha256=sha(painel/'gold/saneamento/manifesto.json'),arquivos_novos=len(new),stata_celulas=stata_cells,r_celulas=r_cells,dicionario=len(dictionary),variaveis_principais=m['resumo']['variaveis'])
    (work/'auditoria.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8');e.db.close();print(json.dumps(audit),flush=True)
    return m

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['base','painel','saida','stata','rscript']:p.add_argument('--'+name,required=True,type=Path)
    a=p.parse_args();gerar(a.base,a.painel,a.saida,a.stata,a.rscript)
