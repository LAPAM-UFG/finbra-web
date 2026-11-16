"""Acrescenta pagamentos/PIB ao tema Assistência, preservando os dados já publicados.

Brasil/UF, CSV, Parquet, Stata e RDS nativo, prévias e dicionários.
Não altera seleção principal, outros temas nem manifesto global.
"""
import argparse,copy,json,subprocess,zipfile
from datetime import datetime,timezone
from pathlib import Path
import duckdb
import pandas as pd
import pyarrow.parquet as pq
from assistencia_utils import destino_isolado
from assistencia_economia import CONDICOES
from downloads_enxuto import Enxuto,ler,preparar_stata
from downloads_navegacao import previa,referencia,registrar
from painel_municipal import Painel,KEYS,qi,qs,sha


def gerar(base,painel,saida,stata,rscript):
    base=Path(base).resolve();painel=Path(painel).resolve();saida=destino_isolado(Path(saida),base);destino_isolado(saida,painel)
    work=saida/'trabalho_downloads_assistencia';dest=saida/'gold/downloads'
    for directory in [work,dest]:
        if not directory.resolve().is_relative_to(saida):raise ValueError('Destino redirecionado para fora do candidato')
    old=ler(base/'gold/downloads/manifesto.json');m=copy.deepcopy(old);meta=ler(painel/'gold/assistencia/economia_manifesto.json')
    assert old['base_sha256']==sha(base/'gold/manifesto.json')
    main=next(a for a in old['arquivos'] if a['id']=='painel_assistencia_parquet');mainpath=base/main['caminho'];assert sha(mainpath)==main['sha256']
    source=painel/meta['parquet']['caminho'];assert sha(source)==meta['parquet']['sha256']
    work.mkdir(parents=True,exist_ok=True);dest.mkdir(parents=True,exist_ok=True)
    dictionary=ler(base/old['dicionario']['caminho']);existing={d['variavel'] for d in dictionary}
    df=pq.read_table(source).to_pandas();newids=[]
    for i in meta['indicadores']:
        name=i['variavel'];newids.append(name)
        years=sorted(int(y) for y in df.loc[df[name].notna(),'ano'].unique())
        assert name not in existing and len(name)<=32
        dictionary.append(dict(variavel=name,nome=i['nome'],descricao=i['descricao'],area='assistencia',tabela='painel',unidade=i['unidade'],fonte='Portal da Transparência/CGU; IBGE/SIDRA 5938; LAPAM/UFG',tipo='inteiro' if name.endswith('_meses') else 'numero',regra_anual='PIB e pagamentos nominais do mesmo ano. Pagamentos anuais só com 12 meses válidos. Não estima ou preenche ausências.',observacao='Complemento do arquivo temático. A seleção principal permanece com 297 indicadores. '+i['descricao'],anos_observados=years,arquivo_principal=False,ano_de=min(years)if years else None,ano_ate=max(years)if years else None,variavel_original=name))
    for key,label in [('pbf','Bolsa Família/Auxílio Brasil'),('bpc','BPC'),('total','Dois programas')]:
        name='as_'+key+'_pib_cond';newids.append(name)
        dictionary.append(dict(variavel=name,nome='Condição: '+label+' / PIB',descricao='Condição do percentual pareado as_'+key+'_pib_pct. Zero informado é válido; ano incompleto ou sem PIB permanece sem valor.',area='assistencia',tabela='painel',unidade='código de condição',fonte='LAPAM/UFG',tipo='inteiro',regra_anual='Condição do mesmo ano e território.',observacao='Não confundir ausência com zero.',anos_observados=meta['anos'],arquivo_principal=False,ano_de=min(meta['anos']),ano_ate=max(meta['anos']),variavel_original=name,stata_rotulos={str(k):v for k,v in CONDICOES.items()}))
    assert len({d['variavel']for d in dictionary})==len(dictionary)
    assert sum(d.get('arquivo_principal')is not False for d in dictionary)==303
    e=Enxuto.__new__(Enxuto);e.root=saida;e.origem=base;e.base=base;e.work=work;e.dest=dest;e.dictionary=dictionary;e.pending=[]
    e.db=duckdb.connect();e.db.execute("SET threads=2; SET memory_limit='2GB'")
    e.p=Painel.__new__(Painel);e.p.db=e.db;e.p.root=saida;e.p.work=work;e.p.dest=dest;e.p.files=[]
    e.db.execute('CREATE VIEW anterior AS SELECT * FROM read_parquet('+qs(mainpath.as_posix())+')')
    e.db.execute('CREATE VIEW economia AS SELECT * FROM read_parquet('+qs(source.as_posix())+')')
    columns=e.db.execute('DESCRIBE anterior').fetchdf().column_name.tolist()
    e.db.execute('CREATE VIEW registro AS SELECT cod_ibge,'+','.join('first('+qi(k)+' ORDER BY ano DESC) AS '+qi(k)for k in KEYS if k not in ['cod_ibge','ano'])+' FROM anterior GROUP BY cod_ibge')
    assert e.db.execute('SELECT count(*) FROM economia s ANTI JOIN registro r USING(cod_ibge)').fetchone()[0]==0,'Município fora do cadastro publicado'
    expr=[('coalesce(a.'+qi(k)+',s.'+qi(k)+')'if k in ['cod_ibge','ano']else'coalesce(a.'+qi(k)+',r.'+qi(k)+')')+' AS '+qi(k)if k in KEYS else'a.'+qi(k)for k in columns]
    e.db.execute('CREATE TABLE tematico AS SELECT '+','.join(expr)+','+','.join('s.'+qi(k)for k in newids)+' FROM anterior a FULL JOIN economia s USING(cod_ibge,ano) LEFT JOIN registro r ON r.cod_ibge=coalesce(a.cod_ibge,s.cod_ibge) WHERE a.cod_ibge IS NOT NULL OR s.as_pib IS NOT NULL OR s.as_pbf_meses>0 OR s.as_bpc_meses>0')
    assert e.db.execute('SELECT count(*) FROM tematico').fetchone()[0]>=main['linhas']
    assert e.db.execute('SELECT count(*) FROM (SELECT '+','.join('t.'+qi(k)for k in columns)+' FROM tematico t JOIN anterior a USING(cod_ibge,ano) EXCEPT ALL SELECT * FROM anterior)').fetchone()[0]==0,'Os dados existentes mudaram'
    select=','.join(qi(k)for k in [*columns,*newids])
    e.exportar('painel_assistencia','SELECT '+select+' FROM tematico ORDER BY cod_ibge,ano','Assistência social — Brasil',area='assistencia')
    for uf, in e.db.execute('SELECT DISTINCT uf FROM tematico ORDER BY 1').fetchall():
        e.exportar('painel_assistencia_'+uf.lower(),'SELECT '+select+' FROM tematico WHERE uf='+qs(uf)+' ORDER BY cod_ibge,ano','Assistência social — '+uf,area='assistencia',uf=uf)
    e.processar_stata(stata)
    for f in e.pending:e.registrar(Path(f['path']),f['id'],f['tipo'],'dta',f['nome'],**f['meta'])
    new=e.p.files;stata_cells=0
    for a in new:
        if a['formato']!='dta':continue
        orig=next(p for p in new if p['id']==a['id'].removesuffix('_dta')+'_parquet')
        truth=pq.read_table(saida/orig['caminho']).to_pandas();actual=pd.read_stata(saida/a['caminho'],convert_categoricals=False,convert_dates=False)
        expected,_=preparar_stata(truth,dictionary);pd.testing.assert_frame_equal(actual,expected,check_dtype=False,check_exact=True);stata_cells+=truth.size
    dictionaryfile=work/'dicionario.json';dictionaryfile.write_text(json.dumps(dictionary,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    dref=registrar(saida,dictionaryfile,'dicionario','json');plan=[]
    for a in list(new):
        if a['formato']!='parquet':continue
        id=a['id'].removesuffix('_parquet');plan.append(dict(id=id+'_rds',parquet=str(saida/a['caminho']),rds=str(work/(id+'.rds')),retorno=str(work/(id+'_retorno.parquet')),origem=a['caminho'],sha256=a['sha256'],uf=a['uf'],tema='assistencia',rede='todas'))
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
    m['arquivos']=[a for a in m['arquivos'] if a.get('area')!='assistencia' and not(a['tipo']=='dicionario'and a.get('escopo')=='principal')]
    m['arquivos'].extend(a for a in new if not a['uf'])
    for uf,ref in old['recortes_uf'].items():
        cat=ler(base/ref['caminho']);cat['arquivos']=[a for a in cat['arquivos'] if a.get('area')!='assistencia'];cat['arquivos'].extend(a for a in new if a['uf']==uf)
        m['recortes_uf'][uf]=referencia(saida,work,'catalogo_'+uf.lower(),cat)
    m['areas']=[{**a,'descricao':'Cadastro, benefícios e pagamentos; comparação anual dos pagamentos com o PIB do mesmo ano.','descricao_en':'Registry, benefits and payments; yearly payments compared with GDP for the same year.'}if a['id']=='assistencia'else a for a in m['areas']]
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
    m['gerado_em']=stamp;m['notas']=[n for n in m['notas'] if not n.startswith('Assistência social / PIB:')]
    m['notas'].append('Assistência social / PIB: complemento do tema com pagamentos nominais de 12 meses e PIB do mesmo ano, desde 2013 (BPC desde 2019). Comparação de grandeza, não efeito causal. Anos parciais e sem PIB ficam sem percentual; condições e meses válidos acompanham. A série Bolsa Família/Auxílio Brasil não inclui o Benefício Extraordinário do Auxílio Brasil (2021–2023). Não muda os indicadores existentes, outros temas ou a seleção principal de 297 indicadores.')
    m.setdefault('fontes_complementares',{})['assistencia_economia']=dict(caminho='gold/assistencia/economia_manifesto.json',sha256=sha(painel/'gold/assistencia/economia_manifesto.json'),gerado_em=meta['gerado_em'])
    for index,a in enumerate(m['arquivos']):
        if a['tipo']=='metodologia'and a['formato']=='txt':
            txt=work/'metodologia.txt';txt.write_text('\n\n'.join(m['notas'])+'\n',encoding='utf-8');m['arquivos'][index]={**a,**registrar(saida,txt,a['id'],'txt')}
    assert all(next(a for a in m['arquivos'] if a['id']==o['id'])==o for o in old['arquivos'] if o['tipo']=='painel')
    (dest/'manifesto.json').write_text(json.dumps(m,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    audit=dict(ok=True,origem_manifesto_sha256=sha(base/'gold/downloads/manifesto.json'),manifesto_sha256=sha(dest/'manifesto.json'),economia_manifesto_sha256=sha(painel/'gold/assistencia/economia_manifesto.json'),arquivos_novos=len(new),stata_celulas=stata_cells,r_celulas=r_cells,dicionario=len(dictionary),variaveis_principais=m['resumo']['variaveis'])
    (work/'auditoria.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8');e.db.close();print(json.dumps(audit),flush=True)
    return m

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['base','painel','saida','stata','rscript']:p.add_argument('--'+name,required=True,type=Path)
    a=p.parse_args();gerar(a.base,a.painel,a.saida,a.stata,a.rscript)
