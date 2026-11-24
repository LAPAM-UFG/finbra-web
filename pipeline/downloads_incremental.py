"""Atualiza áreas da base enxuta sem eliminar complementos de outras fontes."""
import argparse
import copy
import csv
import json
import shutil
import subprocess
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq
from assistencia_utils import destino_isolado, salvar_json
from atualizacao_artefatos import Snapshot
from downloads_enxuto import Enxuto, preparar_stata
from downloads_navegacao import previa, referencia, registrar, pacote
from painel_municipal import Painel, KEYS, qi, qs, sha
from curadoria_catalogos import nome_tema


def gerar(publicado, base, saida, catalogos, areas=('trabalho','gestao','assistencia','clima'), stata=None,rscript=None,caches=(),tabelas=None,chaves_extras=()):
    publicado,base=Path(publicado).resolve(),Path(base).resolve()
    saida=destino_isolado(Path(saida),publicado);destino_isolado(saida,base)
    snapshots=Snapshot(publicado,caches)
    old=json.loads((publicado/'gold/downloads/manifesto.json').read_bytes())
    if not rscript:
        rscript=shutil.which('Rscript')
    if not rscript and any(a['formato']=='rds' for a in old['arquivos']):
        raise ValueError('Rscript é necessário para atualizar os RDS junto com os demais formatos')
    from curadoria_financas import curar
    dictionary=[curar(d.get('variavel_original',d['variavel']),d) for d in json.loads(snapshots.obter(old['dicionario']['caminho'],old['dicionario']).read_bytes())]
    from curadoria_catalogos import curar_dicionario
    dictionary=curar_dicionario(dictionary,base)
    core=next(x for x in old['arquivos'] if x['id']=='painel_brasil_parquet')
    snapshots.obter(core['caminho'],core)
    # Os geradores usam o mesmo catálogo de conceitos do frontend.
    preparation=saida/'preparacao';p=Painel(base,preparation,catalogos)
    tabelas=tabelas or {}
    for area in areas:
        if area in tabelas:
            src=p.fonte(tabelas[area]);schema=p.schema('SELECT * FROM '+src)
            required={d.get('variavel_original',d['variavel']) for d in dictionary if d.get('arquivo_principal') and d['area']==area}
            if not required<=schema.keys():raise ValueError('Colunas da seleção principal ausentes em '+area+': '+str(sorted(required-schema.keys())))
            cols={k:dict(nome=k,descricao=k,unidade='conforme dicionário',fonte=area) for k in sorted(required)}
            p.tabela('atualizacao_'+area,area,'SELECT cast(cod_ibge AS VARCHAR) cod_ibge,ano::INTEGER ano,'+','.join(qi(k) for k in cols)+' FROM '+src,cols)
        else:getattr(p,area)()
    for index,key in enumerate(chaves_extras):
        src=p.fonte(key)
        p.tabela('chaves_extras_'+str(index),'identificacao','SELECT DISTINCT cast(cod_ibge AS VARCHAR) cod_ibge,ano::INTEGER ano FROM '+src,{})
    select=[];joins=[];columns={}
    for table,area,names in p.tables:
        for name in names:
            if name in columns:raise ValueError('coluna duplicada: '+name)
            columns[name]=table
        joins.append('LEFT JOIN '+qi(table)+' ON '+qi(table)+'.cod_ibge=cast(o.cod_ibge AS VARCHAR) AND '+qi(table)+'.ano=o.ano')
    changed=[]
    for d in dictionary:
        name=d['variavel'];original=d.get('variavel_original',name)
        if d.get('arquivo_principal') and d['area'] in areas:
            if original not in columns:
                if original.startswith(('inss_','as_')):continue  # fontes anuais não modificadas nesta carga mensal
                raise ValueError('variável da edição publicada ausente: '+original)
            select.append(qi(columns[original])+'.'+qi(original)+' AS '+qi(name));changed.append(name)
    if not changed and not chaves_extras:raise ValueError('nenhuma variável selecionada para atualização')
    source='read_parquet('+qs((publicado/core['caminho']).as_posix())+')'
    schema=p.schema('SELECT * FROM '+source)
    union=' UNION '.join('SELECT cod_ibge,ano FROM '+qi(table) for table,_,_ in p.tables)
    extras=[]
    for name,typ in schema.items():
        value='n.ano' if name=='ano' else 't.'+qi(name) if name in KEYS else 'NULL'
        extras.append('cast('+value+' AS '+typ+') AS '+qi(name))
    p.db.execute('CREATE OR REPLACE TABLE ancora AS SELECT * FROM '+source+' UNION ALL SELECT '+','.join(extras)+' FROM ('+union+') n JOIN territorios t USING(cod_ibge) ANTI JOIN (SELECT cast(cod_ibge AS VARCHAR) cod_ibge,ano FROM '+source+') old USING(cod_ibge,ano) WHERE n.ano>=2013')
    projection='o.* REPLACE('+','.join(select)+')' if select else 'o.*'
    p.db.execute('CREATE OR REPLACE TABLE atualizado AS SELECT '+projection+' FROM ancora o '+' '.join(joins))
    # O conjunto de municípios/anos e cada coluna fora do lote permanecem iguais.
    names=list(p.schema('SELECT * FROM atualizado'));keep=[n for n in names if n not in changed]
    fields=','.join(qi(k) for k in keep)
    existing='(SELECT a.* FROM atualizado a SEMI JOIN (SELECT cod_ibge,ano FROM '+source+') old USING(cod_ibge,ano))'
    for a,b in [(source,existing),(existing,source)]:
        n=p.db.execute('SELECT count(*) FROM (SELECT '+fields+' FROM '+a+' EXCEPT ALL SELECT '+fields+' FROM '+b+')').fetchall()[0][0]
        if n:raise ValueError('colunas não selecionadas foram alteradas')
    for d in dictionary:
        if d['variavel'] not in changed:continue
        name=d['variavel'];years=[r[0] for r in p.db.execute('SELECT DISTINCT ano FROM atualizado WHERE '+qi(name)+' IS NOT NULL ORDER BY ano').fetchall()]
        d['anos_observados']=years;d['ano_de']=min(years) if years else None;d['ano_ate']=max(years) if years else None
    e=Enxuto.__new__(Enxuto);e.root=saida;e.origem=publicado;e.base=base;e.work=saida/'trabalho_downloads';e.dest=saida/'gold/downloads';e.dictionary=dictionary;e.pending=[]
    e.work.mkdir(parents=True,exist_ok=True);e.dest.mkdir(parents=True,exist_ok=True);e.db=p.db
    e.p=Painel.__new__(Painel);e.p.db=e.db;e.p.root=saida;e.p.work=e.work;e.p.dest=e.dest;e.p.files=[]
    e.exportar('painel_brasil','SELECT * FROM atualizado ORDER BY cod_ibge,ano','Base enxuta — Brasil')
    for uf, in p.db.execute('SELECT DISTINCT uf FROM atualizado ORDER BY uf').fetchall():
        e.exportar('painel_'+uf.lower(),'SELECT * FROM atualizado WHERE uf='+qs(uf)+' ORDER BY cod_ibge,ano','Base enxuta — '+uf,uf=uf)
    for area in areas:
        cols=[d['variavel'] for d in dictionary if d.get('arquivo_principal') and d['area']==area]
        if not cols:continue
        query='SELECT '+','.join(qi(k) for k in [*KEYS,*cols])+' FROM atualizado WHERE ('+' OR '.join(qi(k)+' IS NOT NULL' for k in cols)+')'
        e.exportar('painel_'+area,query+' ORDER BY cod_ibge,ano','Base enxuta — '+nome_tema(area),area=area)
        for uf, in p.db.execute('SELECT DISTINCT uf FROM atualizado ORDER BY uf').fetchall():
            e.exportar('painel_'+area+'_'+uf.lower(),query+' AND uf='+qs(uf)+' ORDER BY cod_ibge,ano',nome_tema(area)+' — '+uf,area=area,uf=uf)
    if stata:e.processar_stata(Path(stata))
    for item in e.pending:
        parquet=next(a for a in e.p.files if a['id']==item['id'].removesuffix('_dta')+'_parquet')
        expected,_=preparar_stata(pq.read_table(saida/parquet['caminho']).to_pandas(),dictionary)
        actual=pd.read_stata(item['path'],convert_categoricals=False,convert_dates=False)
        pd.testing.assert_frame_equal(actual,expected,check_dtype=False,check_exact=True)
        if actual[['cod_ibge','ano']].isna().any().any()or actual.duplicated(['cod_ibge','ano']).any():raise ValueError('Chaves inválidas no download Stata')
        e.registrar(Path(item['path']),item['id'],item['tipo'],'dta',item['nome'],**item['meta'])
    updated_files=e.p.files
    # Inclui somente edições MUNIC novas, sem recodificar os questionários antigos.
    advanced_ref=next(a for a in old['arquivos'] if a['id']=='dicionario_complementos_json')
    advanced=json.loads(snapshots.obter(advanced_ref['caminho'],advanced_ref).read_bytes())
    known={d['tabela'] for d in advanced}
    original_fonte=p.fonte
    def fonte(relative):
        sql=original_fonte(relative)
        if relative=='gold/munic/catalogo.parquet':
            years=p.db.execute('SELECT DISTINCT ano FROM '+sql+" WHERE pesquisa='munic'").fetchall()
            novos=[int(y) for y, in years if int(y)>=2013 and 'munic_'+str(y) not in known]
            return '(SELECT * FROM '+sql+' WHERE ano IN ('+','.join(map(str,novos))+'))' if novos else '(SELECT * FROM '+sql+' WHERE false)'
        return sql
    p.fonte=fonte;p.files=[];before=len(p.dictionary);p.detalhes_munic()
    new_advanced=p.dictionary[before:];advanced+=new_advanced
    for f in p.files:
        source=preparation/f['caminho'];target=saida/f['caminho'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target);updated_files.append({**f,'escopo':'detalhado'})
    m=copy.deepcopy(old);m.update(gerado_em=datetime.now(timezone.utc).isoformat(),base_gerado_em=p.manifest['gerado_em'],base_sha256=sha(base/'gold/manifesto.json'),base_ipca=p.manifest['base_ipca'])
    m['stata']['painel_declarado']=bool(stata)
    n,cities,first,last=p.db.execute('SELECT count(*),count(DISTINCT cod_ibge),min(ano),max(ano) FROM atualizado').fetchall()[0]
    m['resumo'].update(linhas=n,municipios=cities,ano_de=first,ano_ate=last)
    m['resumo']['variaveis_detalhadas']=len(advanced)-len(KEYS)
    for label,entries,scope in [('dicionario',dictionary,'principal'),('dicionario_complementos',advanced,'detalhado')]:
        f=e.work/(label+'.json');salvar_json(f,entries);ref=registrar(saida,f,label,'json')
        template=next(a for a in old['arquivos'] if a['id']==label+'_json');updated_files.append({**template,**ref,'id':label+'_json','linhas':len(entries)})
        if scope=='principal':m['dicionario']=ref
        f=e.work/(label+'.csv');fields=list(dict.fromkeys(k for d in entries for k in d))
        with f.open('w',encoding='utf-8-sig',newline='') as stream:
            w=csv.DictWriter(stream,fieldnames=fields,delimiter=';');w.writeheader();w.writerows(entries)
        z=f.with_suffix('.csv.zip')
        with zipfile.ZipFile(z,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:archive.write(f,label+'.csv')
        ref=registrar(saida,z,label+'_csv','csv.zip');template=next(a for a in old['arquivos'] if a['id']==label+'_csv');updated_files.append({**template,**ref,'linhas':len(entries)})
    import openpyxl
    book=openpyxl.Workbook(write_only=True);sheet=book.create_sheet('Dicionário');fields=['variavel','nome','descricao','unidade','fonte','ano_de','ano_ate','regra_anual','observacao'];sheet.append(fields)
    for d in dictionary:sheet.append([d.get(k) for k in fields])
    excel=e.work/'dicionario.xlsx';book.save(excel);ref=registrar(saida,excel,'dicionario_excel','xlsx');template=next(a for a in old['arquivos'] if a['id']=='dicionario_excel');updated_files.append({**template,**ref,'linhas':len(dictionary)})
    if rscript:
        plan=[]
        for a in updated_files:
            if a['formato']!='parquet' or a['tipo'] not in ['painel','area']:continue
            id=a['id'].removesuffix('_parquet');plan.append(dict(id=id+'_rds',parquet=str(saida/a['caminho']),rds=str(e.work/(id+'.rds')),retorno=str(e.work/(id+'_retorno.parquet')),origem=a['caminho'],sha256=a['sha256'],uf=a['uf'],tema=a['area']))
        conf=dict(dicionario=str(e.work/'dicionario.json'),saida_dicionario=str(e.work/'dicionario.rds'),arquivos=plan,base_sha256=m['base_sha256'],gerado_em=m['gerado_em']);salvar_json(e.work/'plano_r.json',conf)
        subprocess.run([str(rscript),'--vanilla',str(Path(__file__).with_name('downloads_r.R')),str(e.work/'plano_r.json'),str(e.work/'auditoria_r.json')],check=True,timeout=1800)
        by={a['id']:a for a in updated_files};new_r=[]
        for item in plan:
            source=by[item['id'].removesuffix('_rds')+'_parquet'];pd.testing.assert_frame_equal(pq.read_table(saida/source['caminho']).to_pandas(),pq.read_table(item['retorno']).to_pandas(),check_dtype=False,check_exact=True)
            new_r.append({**source,**registrar(saida,Path(item['rds']),item['id'],'rds'),'id':item['id'],'formato':'rds'})
        updated_files+=new_r;template=next(a for a in old['arquivos'] if a['id']=='dicionario_rds');updated_files.append({**template,**registrar(saida,e.work/'dicionario.rds','dicionario_rds','rds'),'linhas':len(dictionary)})
    # Prévias e catálogos de UF também são derivados da versão nova.
    previews={}
    for a in updated_files:
        if a['formato']=='parquet' and a['tipo'] in ['painel','area']:
            frame=pq.read_table(saida/a['caminho']).to_pandas();previews[(a['tipo'],a['area'],a['uf'])]=referencia(saida,e.work,a['id']+'_previa',previa(frame,dictionary,a))
    for a in updated_files:
        key=(a['tipo'],a['area'],a['uf'])
        if key in previews:a['previa']=previews[key]
        if a.get('area'):
            a['nome_en']=a['nome'].replace(nome_tema(a['area']),nome_tema(a['area'],True)).replace('Base enxuta','Core panel')
    replace={a['id']:a for a in updated_files if not (a['tipo']=='area' and a['uf'])}
    m['arquivos']=[replace.pop(a['id'],a) for a in old['arquivos']];m['arquivos']+=list(replace.values())
    for uf,ref in old['recortes_uf'].items():
        catalog=json.loads(snapshots.obter(ref['caminho'],ref).read_bytes());replace={a['id']:a for a in updated_files if a['uf']==uf and a['tipo']=='area'}
        catalog['arquivos']=[replace.pop(a['id'],a) for a in catalog['arquivos']];catalog['arquivos']+=list(replace.values());m['recortes_uf'][uf]=referencia(saida,e.work,'catalogo_'+uf.lower(),catalog)
    # Pacotes nacionais precisam conter o painel e o dicionário novos.
    for a in m['arquivos']:
        if a['tipo'] in ['dicionario','metodologia'] and not (saida/a['caminho']).exists():
            src=snapshots.obter(a['caminho'],a);target=saida/a['caminho'];target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,target)
    for fmt in ['dta','csv.zip','parquet','rds']:
        if fmt=='rds' and not rscript:continue
        new=pacote(saida,e.work,m,fmt);m['arquivos']=[a for a in m['arquivos'] if a['id']!=new['id']]+[new]
    complete=next((a for a in old['arquivos'] if a['id']=='pacote_enxuto'),None)
    if complete:
        archive=e.work/'base_enxuta_completa.zip'
        with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=3,allowZip64=True) as z:
            for a in m['arquivos']:
                if not ((a['tipo']=='painel' and a['uf'] is None) or (a['tipo']=='dicionario' and a.get('escopo')=='principal' and a['formato'] in ['csv.zip','xlsx']) or a['tipo']=='metodologia'):continue
                source=saida/a['caminho']
                if a['formato']=='csv.zip':
                    with zipfile.ZipFile(source) as src:
                        for name in src.namelist():
                            with src.open(name) as inp,z.open(name,'w',force_zip64=True) as out:shutil.copyfileobj(inp,out,8*1024*1024)
                else:z.write(source,a['id']+'.'+a['formato'])
        new={**complete,**registrar(saida,archive,'pacote_enxuto','zip')}
        with zipfile.ZipFile(archive) as z:new['bytes_extraido']=sum(x.file_size for x in z.infolist())
        m['arquivos']=[new if a['id']=='pacote_enxuto' else a for a in m['arquivos']]
    salvar_json(saida/'gold/downloads/manifesto.json',m)
    report=dict(ok=True,areas=list(areas),variaveis_atualizadas=len(changed),variaveis_principais=len(names)-len(KEYS),variaveis_munic_novas=len(new_advanced),arquivos_novos=len(updated_files),r=bool(rscript),stata_nativo=bool(stata),outras_colunas_preservadas=True)
    salvar_json(saida/'auditoria_downloads.json',report);p.db.close();return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['publicado','base','saida','catalogos']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--stata',type=Path);p.add_argument('--rscript',type=Path)
    a=p.parse_args();print(json.dumps(gerar(a.publicado,a.base,a.saida,a.catalogos,stata=a.stata,rscript=a.rscript),ensure_ascii=False))
