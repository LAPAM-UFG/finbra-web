"""Consolida CadÚnico, folha PBF/MDS e pagamentos CGU em um candidato isolado.

Uso: python pipeline/assistencia.py --base E:/finbra/data --saida E:/finbra/candidato_assistencia_20261114
A aquisição é explícita nos scripts assistencia_download, assistencia_cadunico, assistencia_perfis,
assistencia_pbf e assistencia_pbf_cgu. Este comando nunca faz upload ou modifica a base.
"""
import argparse
import collections
import hashlib
import json
import math
import os
import time
from pathlib import Path
import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from assistencia_utils import destino_isolado, salvar_json, sql_texto
from assistencia_catalogo import cad_catalogo, catalogo_perfis, bpc_catalogo, pbf_cgu_catalogo, perfil_id, indicador
from assistencia_bpc import mapa_siafi

UFS={'RO':'Rondônia','AC':'Acre','AM':'Amazonas','RR':'Roraima','PA':'Pará','AP':'Amapá','TO':'Tocantins','MA':'Maranhão',
     'PI':'Piauí','CE':'Ceará','RN':'Rio Grande do Norte','PB':'Paraíba','PE':'Pernambuco','AL':'Alagoas','SE':'Sergipe','BA':'Bahia',
     'MG':'Minas Gerais','ES':'Espírito Santo','RJ':'Rio de Janeiro','SP':'São Paulo','PR':'Paraná','SC':'Santa Catarina','RS':'Rio Grande do Sul',
     'MS':'Mato Grosso do Sul','MT':'Mato Grosso','GO':'Goiás','DF':'Distrito Federal'}
MDS='https://www.gov.br/mds/pt-br/acoes-e-programas/bolsa-familia/paginas/bolsa-em-numeros'
CAD='https://paineis.mds.gov.br/public/extensions/observatorio-do-cadastro-unico/index.html'
CGU='https://portaldatransparencia.gov.br/download-de-dados/'

def limpar(n):
    return None if n is None or pd.isna(n) or (isinstance(n,float) and not math.isfinite(n)) else (int(n) if isinstance(n,(int,)) else float(n))

def compacto(obj):return json.dumps(obj,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
def hash_arquivo(path):
    with path.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()

def objeto(path,root):return {'caminho':path.relative_to(root).as_posix(),'sha256':hash_arquivo(path),'bytes':path.stat().st_size}

def gravar_hash_json(root,prefix,obj):
    data=compacto(obj);digest=hashlib.sha256(data).hexdigest();path=root/'gold/assistencia'/f'{prefix}_{digest[:12]}.json'
    path.write_bytes(data);return objeto(path,root)

def informar_cobertura_bpc(root,fontes,quality):
    """Registros sem UF ficam no Brasil, sem inventar um estado para fechar a soma."""
    missing=[]
    for path in sorted((root/'silver/assistencia/bpc').glob('[0-9]'*6+'.parquet')):
        records=pq.read_table(path,columns=['nivel','uf','pagamentos','beneficios','valor_pago']).to_pylist()
        rows=[r for r in records if r['nivel']=='UF' and r['uf'] not in UFS]
        if rows:
            missing.append({'competencia':int(path.stem),'parcelas':sum(r['pagamentos'] for r in rows),
                            'beneficios_com_registro_sem_uf':sum(r['beneficios'] for r in rows) if all(r['beneficios'] is not None for r in rows) else None,
                            'valor_pago':round(sum(float(r['valor_pago']) for r in rows),2) if all(r['valor_pago'] is not None for r in rows) else None})
    quality['fontes']['bpc']['sem_uf']=missing
    fontes['bpc']['sem_uf']=missing
    if missing:
        pt='Há pagamentos sem UF identificada em algumas competências: entram no Brasil e não são atribuídos a estados ou municípios. Por isso a soma dos estados pode diferir do Brasil.'
        en='Some months include payments without an identified state: these enter the Brazil total and are not assigned to a state or municipality. The sum of states can therefore differ from Brazil.'
        if pt not in fontes['bpc']['avisos']:fontes['bpc']['avisos'].append(pt)
        if en not in fontes['bpc']['avisos_en']:fontes['bpc']['avisos_en'].append(en)
    return missing

PBF_NOMES={
 'familias_atendidas':('Famílias atendidas na folha do PBF','Families covered by the PBF payroll'),
 'familias_em_pagamento':('Famílias em pagamento na folha do PBF','Families with payment in the PBF payroll'),
 'familias_regra_protecao':('Famílias na Regra de Proteção','Families under the Protection Rule'),
 'familias_regra_protecao_em_pagamento':('Famílias da Regra de Proteção em pagamento','Families under the Protection Rule with payment'),
 'familias_canceladas':('Famílias canceladas na competência','Families cancelled in the payroll month'),
 'valor_renda_cidadania':('Componente Renda de Cidadania: valor','Citizenship Income component: amount'),
 'valor_complementar':('Benefício Complementar: valor','Complementary benefit: amount'),
 'valor_primeira_infancia':('Benefício Primeira Infância: valor','Early Childhood benefit: amount'),
 'valor_variavel_gestante':('Benefício Variável Familiar Gestante: valor','Pregnancy variable benefit: amount'),
 'valor_variavel_nutriz':('Benefício Variável Familiar Nutriz: valor','Nursing variable benefit: amount'),
 'valor_variavel_crianca':('Benefício Variável Familiar Criança: valor','Child variable benefit: amount'),
 'valor_variavel_adolescente':('Benefício Variável Familiar Adolescente: valor','Adolescent variable benefit: amount'),
 'valor_soma_componentes':('Soma dos componentes monetários da planilha','Sum of monetary components in the worksheet'),
 'valor_extraordinario_transicao':('Benefício Extraordinário de Transição: valor','Extraordinary Transition Benefit: amount'),
 'valor_desconto_seguro_defeso':('Desconto de Seguro Defeso informado','Reported Seguro Defeso deduction'),
 'valor_regra_protecao':('Valor informado para a Regra de Proteção','Reported amount for the Protection Rule'),
 'valor_medio_planilha':('Benefício médio informado na planilha','Average benefit reported in the worksheet'),
 'beneficio_medio_regra_protecao':('Benefício médio informado da Regra de Proteção','Reported average benefit under the Protection Rule'),
 'cobertura_planilha':('Atendimento / estimativa de pobreza da planilha','Covered families / worksheet poverty estimate'),
 'qtd_beneficios_renda_cidadania':('Benefícios Renda de Cidadania: quantidade','Citizenship Income benefits: count'),
 'qtd_beneficios_complementares':('Benefícios Complementares: quantidade','Complementary benefits: count'),
 'qtd_beneficios_primeira_infancia':('Benefícios Primeira Infância: quantidade','Early Childhood benefits: count'),
 'qtd_beneficios_variavel_gestante':('Benefícios Variáveis Gestante: quantidade','Pregnancy variable benefits: count'),
 'qtd_beneficios_variavel_nutriz':('Benefícios Variáveis Nutriz: quantidade','Nursing variable benefits: count'),
 'qtd_beneficios_variavel_crianca':('Benefícios Variáveis Criança: quantidade','Child variable benefits: count'),
 'qtd_beneficios_variavel_adolescente':('Benefícios Variáveis Adolescente: quantidade','Adolescent variable benefits: count'),
 'qtd_beneficios_extraordinario_transicao':('Benefícios Extraordinários de Transição: quantidade','Extraordinary Transition benefits: count'),
}

def pbf_catalogo():
    out=[]
    for field,(pt,en) in PBF_NOMES.items():
        unit='razao' if field=='cobertura_planilha' else 'moeda' if 'valor' in field or field.startswith('beneficio_medio') else 'numero'
        desc='Folha do MDS; não equivale ao pagamento efetivo da CGU. Municípios ausentes ou rejeitados não são preenchidos com zero. Estoques de famílias não se somam entre meses.'
        desc_en='MDS payroll; not equivalent to actual CGU payments. Missing or rejected municipalities are not filled with zero. Family stocks are not added across months.'
        if field=='cobertura_planilha':
            desc+=' Razão em relação à estimativa de pobreza usada pela planilha (que tem ano próprio), não à população total; pode superar 100%. Não mede cobertura de todos os elegíveis.'
            desc_en+=' Ratio to the worksheet poverty estimate (which has its own reference year), not the total population; it can exceed 100%. It is not coverage of all eligible people.'
        if 'medio' in field:
            desc+=' Valor municipal como publicado, sem nota completa ou conciliação com os componentes; não agregado para UF/Brasil.'
            desc_en+=' Municipal value as published, without a complete footnote or reconciliation with components; not aggregated to state/Brazil.'
        r=indicador('pbf_'+field,pt,en,'pbf','pbf_folha',unit,desc,desc_en,destaque=field in ['familias_atendidas','familias_regra_protecao'])
        r['acumulavel']=unit=='moeda' and 'medio' not in field
        if unit=='moeda':r['precos']='nominais'
        out.append(r)
    return out

def construir(base,saida,parcial=False):
    root=destino_isolado(saida,base);dest=root/'gold/assistencia';dest.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((base/'gold/manifesto.json').read_text(encoding='utf-8-sig'));base_ipca=int(manifest['base_ipca'])
    timestamp=time.strftime('%Y-%m-%dT%H:%M:%S+00:00',time.gmtime())
    cadfiles=sorted((root/'silver/assistencia/cadunico').glob('[0-9]'*6+'.parquet'));assert cadfiles,'CadÚnico não adquirido'
    cadframe=pd.concat([pq.read_table(f).to_pandas() for f in cadfiles],ignore_index=True)
    cad_month=int(cadframe.competencia.max());cad_latest=cadframe[cadframe.competencia==cad_month]
    assert set(cad_latest.nivel)<=set(['BR','UF','M']),'Cadastro com território não identificado: revisar a fonte antes de publicar'
    terras={r['grupo']:{k:r[k] for k in ['grupo','nome','nivel','uf','cod_ibge']} for r in cad_latest.to_dict('records')}
    for g,t in terras.items():
        t['cod_ibge']=int(t['cod_ibge']) if pd.notna(t['cod_ibge']) else None
        t['uf']=t['uf'] if pd.notna(t['uf']) else None
        if g in UFS:t['nome']=UFS[g]
    assert len(terras)>=5599 and 'BR' in terras and '5101837' in terras
    perf_path=root/f'silver/assistencia/cadunico/{cad_month}_perfis.parquet'
    if not parcial:assert perf_path.exists(),'Perfis do CadÚnico ainda não adquiridos'
    perf=pq.read_table(perf_path).to_pandas() if perf_path.exists() else pd.DataFrame()
    categorias={d:sorted(g.categoria.unique()) for d,g in perf.groupby('dimensao')} if len(perf) else {}
    catalog=cad_catalogo()+catalogo_perfis(categorias)+pbf_catalogo()+pbf_cgu_catalogo()+bpc_catalogo()
    by_id={i['id']:i for i in catalog};assert len(by_id)==len(catalog)
    cad_ids=[i['id'] for i in catalog if i['fonte']=='cadunico' and not i['id'].startswith('cad_perfil_')]
    assert set(cad_ids)<=set(cadframe.columns),set(cad_ids)-set(cadframe.columns)
    data={g:{'grupo':g,'series':{'cadunico':{},'pbf':{},'bpc':{}}} for g in terras}
    ipca_data=json.loads((root/'landing/assistencia/ipca_mensal.json').read_text(encoding='utf-8-sig'))
    indices={int(x['D3C']):float(x['V']) for x in ipca_data[1:] if x['V'] not in ['-','...','..','X']}
    base_index=indices[base_ipca*100+12];assert base_index>0
    quality={'gerado_em':timestamp,'base_manifesto_sha256':hash_arquivo(base/'gold/manifesto.json'),'fontes':{},'parcial':parcial}

    def row(g,fonte,mes):
        if g not in data:return None
        return data[g]['series'][fonte].setdefault(int(mes),{'competencia':int(mes),'valores':{},'condicoes':{}})
    def put(g,fonte,mes,id,value,cond=None):
        assert id in by_id,id
        line=row(g,fonte,mes)
        if line is None:return
        assert id not in line['valores'],(g,mes,id)
        v=limpar(value);line['valores'][id]=v
        if v is None:line['condicoes'][id]=cond if isinstance(cond,str) and cond else 'ausente'
    def money(g,fonte,mes,id,value,cond=None):
        put(g,fonte,mes,id,value,cond)
        if id+'_real' in by_id:
            v=limpar(value)
            put(g,fonte,mes,id+'_real',round(v*base_index/indices[mes],2) if v is not None and mes in indices else None,
                cond if v is None else 'indisponivel_ipca')

    for r in cadframe.to_dict('records'):
        conditions=json.loads(r['condicoes'])
        for id in cad_ids:put(r['grupo'],'cadunico',r['competencia'],id,r.get(id),conditions.get(id))
    for r in perf.to_dict('records'):
        for kind in ['familias','pessoas']:
            put(r['grupo'],'cadunico',r['competencia'],perfil_id(r['dimensao'],r['categoria'],kind),r['valor_'+kind],r['condicao_'+kind])
    quality['fontes']['cadunico']={'competencias':sorted(cadframe.competencia.unique().tolist()),'grupos':len(terras),
        'referencias':json.loads((root/f'silver/assistencia/cadunico/{cad_month}.json').read_text(encoding='utf-8'))}

    bpcfiles=sorted((root/'silver/assistencia/bpc').glob('[0-9]'*6+'.parquet'))
    if not parcial:assert len(bpcfiles)>=93,'Carga BPC incompleta'
    bpc_fields=[i['id'].removeprefix('bpc_') for i in catalog if i['fonte']=='bpc' and i.get('precos')!='reais']
    for f in bpcfiles:
        bpc=pq.read_table(f).to_pandas()
        assert not bpc.duplicated(['competencia','grupo']).any()
        for r in bpc.to_dict('records'):
            for field in bpc_fields:
                money(r['grupo'],'bpc',int(r['competencia']),'bpc_'+field,r[field])
    quality['fontes']['bpc']={'competencias':[int(f.stem) for f in bpcfiles],
        'arquivos':[{ 'competencia':int(f.stem),'sha256':hash_arquivo(f)} for f in bpcfiles]}
    print('CadÚnico e BPC consolidados',flush=True)

    con=duckdb.connect();con.execute("SET memory_limit='3GB'");con.execute('SET threads=2')
    try:
        con.register('mapa',pa.Table.from_pylist(mapa_siafi()))
        # A silver legada é somente lida; a contagem municipal de responsáveis NÃO é somada como pessoas únicas na UF/BR.
        cgufiles={int(f.stem):f for f in (base/'silver/bolsa_familia_mensal').glob('*.parquet')}
        cgufiles.update({int(f.stem):f for f in (root/'silver/assistencia/pbf_cgu').glob('*.parquet')})
        for mes,f in sorted(cgufiles.items()):
            con.execute(f'''CREATE OR REPLACE TEMP VIEW pagamentos AS SELECT s.*,m.cod_ibge,
                coalesce(m.cod_ibge::VARCHAR,'SIAFI:'||s.uf||':'||s.siafi) AS grupo
                FROM read_parquet({sql_texto(f.as_posix())}) s LEFT JOIN mapa m ON m.uf=s.uf AND m.siafi=lpad(s.siafi,4,'0')''')
            records=con.sql('''SELECT CASE WHEN grouping(uf)=1 THEN 'BR' WHEN grouping(grupo)=1 THEN uf ELSE grupo END AS alvo,
                sum(valor::DECIMAL(18,2))::DOUBLE AS valor,sum(parcelas)::BIGINT AS parcelas,
                CASE WHEN grouping(grupo)=0 AND count(DISTINCT programa)=1 AND count(familias)=count(*) THEN sum(familias) ELSE null END::BIGINT AS responsaveis
                FROM pagamentos GROUP BY GROUPING SETS((uf,grupo),(uf),())''').df().to_dict('records')
            for r in records:
                money(r['alvo'],'pbf',mes,'pbf_cgu_valor',r['valor'])
                put(r['alvo'],'pbf',mes,'pbf_cgu_parcelas',r['parcelas'])
                put(r['alvo'],'pbf',mes,'pbf_cgu_responsaveis',r['responsaveis'],'nao_agregavel')
        quality['fontes']['pbf_cgu']={'competencias':sorted(cgufiles),'arquivos':[{'competencia':m,'sha256':hash_arquivo(f)} for m,f in sorted(cgufiles.items())]}
    finally:con.close()
    print('Pagamentos históricos do PBF consolidados',flush=True)

    pbfcat=json.loads((root/'landing/assistencia/pbf/catalogo.json').read_text(encoding='utf-8-sig'))
    expected=collections.Counter(t['uf'] for t in terras.values() if t['nivel']=='M')
    mds_coverage={}
    for comp,cmeta in sorted(pbfcat['competencias'].items()):
        if not cmeta.get('parquet'):continue
        f=root/cmeta['parquet']
        assert f.resolve().is_relative_to((root/'silver/assistencia/pbf').resolve()) and f.is_file()
        mes=int(comp)
        if mes<202303:continue
        frame=pq.read_table(f).to_pandas();assert not frame.cod_ibge.duplicated().any()
        assert len(frame)==cmeta['municipios'] and set(frame.uf)==set(cmeta['ufs_lidas']),'Parquet não corresponde ao catálogo validado'
        tipos_ok={uf for uf,arquivo in cmeta.get('arquivos',{}).items() if arquivo.get('tipos_info',{}).get('estado')=='validado'}
        def aplica(field,uf):return not field.startswith('qtd_beneficios_') or uf in tipos_ok
        present=[x for x in PBF_NOMES if x in frame.columns and frame[x].notna().any()]
        for r in frame.to_dict('records'):
            for field in present:
                if aplica(field,r['uf']):put(str(r['cod_ibge']),'pbf',mes,'pbf_'+field,r[field])
        covered=[]
        for uf,g in frame.groupby('uf'):
            expect=expected[uf]-(1 if uf=='MT' and mes<202501 else 0)
            # As contagens são somáveis entre municípios, desde que a UF tenha TODOS os seus municípios.
            # Não se agrega nenhum campo de uma UF incompleta, nem médias publicadas.
            if len(g)!=expect:continue
            covered.append(uf)
            for field in present:
                if not aplica(field,uf):continue
                value=None;reason='nao_agregavel'
                if 'medio' not in field and field!='cobertura_planilha':
                    value=g[field].sum() if g[field].notna().all() else None;reason='ausente'
                elif field=='cobertura_planilha' and 'estimativa_pobreza' in g:
                    ok=g['estimativa_pobreza'].notna().all() and g['familias_atendidas'].notna().all()
                    value=g['familias_atendidas'].sum()/g['estimativa_pobreza'].sum() if ok and g['estimativa_pobreza'].sum()>0 else None
                put(uf,'pbf',mes,'pbf_'+field,value,reason)
        if set(covered)==set(UFS):
            for field in present:
                if field.startswith('qtd_beneficios_') and tipos_ok!=set(UFS):continue
                value=None;reason='nao_agregavel'
                if 'medio' not in field and field!='cobertura_planilha':value=frame[field].sum() if frame[field].notna().all() else None;reason='ausente'
                elif field=='cobertura_planilha' and 'estimativa_pobreza' in frame:
                    ok=frame['estimativa_pobreza'].notna().all() and frame['familias_atendidas'].notna().all()
                    value=frame['familias_atendidas'].sum()/frame['estimativa_pobreza'].sum() if ok and frame['estimativa_pobreza'].sum()>0 else None
                put('BR','pbf',mes,'pbf_'+field,value,reason)
        mds_coverage[mes]={'ufs_completas':sorted(covered),'municipios':len(frame),
                          'ufs_rejeitadas':pbfcat['competencias'].get(str(mes),{}).get('ufs_rejeitadas',{})}
    quality['fontes']['pbf_mds']=mds_coverage
    print('Folha PBF validada consolidada',flush=True)

    # Datas por indicador (a folha do MDS e os pagamentos da CGU têm coberturas diferentes).
    dates={id:set() for id in by_id}
    for g in data.values():
        for fonte,months in g['series'].items():
            for mes,r in months.items():
                for id in r['valores']:dates[id].add(mes)
    for i in catalog:i['competencias']=sorted(dates[i['id']])
    catalog=[i for i in catalog if i['competencias']]
    by_id={i['id']:i for i in catalog}
    periodos={f:sorted({m for i in catalog if i['fonte']==f for m in i['competencias']}) for f in ['cadunico','pbf','bpc']}

    # Longos colunares para SQL/IA: um valor por indicador, território e competência, sem duplicar o total.
    parquet_objects={}
    schema=pa.schema([('competencia',pa.int32()),('grupo',pa.string()),('nivel',pa.string()),('uf',pa.string()),('cod_ibge',pa.int64()),
                      ('indicador',pa.string()),('valor',pa.float64()),('condicao',pa.string())])
    for fonte in periodos:
        temp=dest/f'{fonte}_temporario.parquet'
        with pq.ParquetWriter(temp,schema,compression='zstd') as writer:
            for mes in periodos[fonte]:
                rows=[]
                for g,t in terras.items():
                    r=data[g]['series'][fonte].get(mes)
                    if not r:continue
                    for id,value in r['valores'].items():
                        rows.append({'competencia':mes,**{k:t[k] for k in ['grupo','nivel','uf','cod_ibge']},'indicador':id,
                                     'valor':value,'condicao':r['condicoes'].get(id,'zero_registrado' if value==0 else 'registrado')})
                if rows:writer.write_table(pa.Table.from_pylist(rows,schema=schema))
        digest=hash_arquivo(temp);final=dest/f'{fonte}_{digest[:12]}.parquet';os.replace(temp,final);parquet_objects[fonte]=objeto(final,root)
        print(json.dumps({'parquet':fonte,'bytes':final.stat().st_size}),flush=True)
    cat_table=[]
    for i in catalog:cat_table.append({**{k:v for k,v in i.items() if k!='competencias'},'competencias':json.dumps(i['competencias'])})
    for name,rows in [('catalogo',cat_table),('territorios',list(terras.values()))]:
        temp=dest/f'{name}_temporario.parquet';pq.write_table(pa.Table.from_pylist(rows),temp,compression='zstd')
        digest=hash_arquivo(temp);final=dest/f'{name}_{digest[:12]}.parquet';os.replace(temp,final);parquet_objects[name]=objeto(final,root)

    rankings={f:{} for f in periodos}
    for fonte,meses in periodos.items():
        for mes in meses:
            rows=[{'grupo':g,**{k:v for k,v in (data[g]['series'][fonte].get(mes) or {'valores':{},'condicoes':{}}).items() if k!='competencia'}}
                  for g,t in terras.items() if t['nivel']!='BR']
            rankings[fonte][str(mes)]=gravar_hash_json(root,f'ranking_{fonte}_{mes}',{'fonte':fonte,'competencia':mes,'linhas':rows})

    temp=dest/'abertura_temporaria.ndjson';offsets={};position=0;digest=hashlib.sha256()
    with temp.open('wb') as output:
        for g in sorted(data):
            record={'grupo':g,'series':{f:[r for _,r in sorted(months.items())] for f,months in data[g]['series'].items()}}
            body=compacto(record)+b'\n';output.write(body);digest.update(body)
            offsets[g]=[position,len(body),hashlib.sha256(body).hexdigest()];position+=len(body)
    final=dest/f'abertura_{digest.hexdigest()[:12]}.ndjson';os.replace(temp,final)
    refs_cad=quality['fontes']['cadunico']['referencias'].get('referencias',{})
    ref_pbf=', '.join(refs_cad.get('REF_PBF',[])) or 'não informada'
    ref_bpc=', '.join(refs_cad.get('REF_BPC',[])) or 'não informada'
    ref_txt=f'{cad_month%100:02}/{cad_month//100}'
    avisos_cad=[f'Retrato mais recente: {ref_txt}. A API histórica do MDS estava em manutenção na aquisição; não foi recuperado histórico anterior aos retratos coletados.',
                f'Marcadores do cadastro: Bolsa Família {ref_pbf}; BPC {ref_bpc}. Não são a série de pagamentos. Células positivas abaixo de 100 famílias ou 200 pessoas podem ser omitidas pelo MDS.']
    avisos_pbf=['As datas variam por indicador: folha do MDS e pagamentos efetivos da CGU são séries diferentes. A referência aparece junto de cada medida.',
               'Há meses e arquivos de UF ausentes ou rejeitados na folha do MDS. Totais UF/Brasil só são calculados com cobertura municipal completa. Não são interpolados meses.',
               'Quantidades de tipos de benefício com data inconsistente e o campo de total com erro nas planilhas foram excluídos. Médias informadas só estão disponíveis por município, sem conciliação.',
               'A série de pagamentos inclui Bolsa Família, Auxílio Brasil e Novo Bolsa Família; não inclui o Benefício Extraordinário do Auxílio Brasil. Use 2021–2023 com cautela.']
    fontes={
      'cadunico':{'nome':'MDS · Observatório do Cadastro Único (público externo)','url':CAD,'competencias':periodos['cadunico'],'avisos':avisos_cad,
                 'avisos_en':[f'Latest snapshot: {ref_txt}. The historical MDS API was under maintenance during acquisition; no history preceding the collected snapshots was recovered.',
                              f'Registration markers: Bolsa Família {ref_pbf}; BPC {ref_bpc}. These are not payment series. Positive cells below 100 families or 200 people may be withheld by MDS.']},
      'pbf':{'nome':'MDS · Bolsa em Números; CGU · Portal da Transparência','url':MDS,'competencias':periodos['pbf'],'avisos':avisos_pbf,
             'avisos_en':['Dates vary by indicator: MDS payroll and actual CGU payments are separate series. Each measure shows its reference.',
                         'Some MDS months and state files are missing or rejected. State/Brazil totals require complete municipal coverage; no months are interpolated.',
                         'Benefit-type counts with inconsistent dates and an erroneous total field were excluded. Reported averages are municipal only, without reconciliation.',
                         'Payment history includes Bolsa Família, Auxílio Brasil and Novo Bolsa Família; it excludes the extraordinary Auxílio Brasil benefit. Interpret 2021–2023 with caution.']},
      'bpc':{'nome':'CGU · Portal da Transparência · BPC','url':CGU+'bpc','competencias':periodos['bpc'],
             'avisos':['Benefícios distintos com pagamento no mês; não são pessoas únicas nem estoque de benefícios ativos. Parcelas de referência anterior estão separadas.',
                       'Os arquivos não distinguem BPC idoso e BPC pessoa com deficiência. Informação judicial ausente não significa concessão administrativa.'],
             'avisos_en':['Distinct benefits with payments in the month, not unique people or the stock of active benefits. Instalments for earlier reference months are separate.',
                          'The files do not distinguish old-age BPC from disability BPC. Missing judicial information does not imply administrative approval.']}}
    informar_cobertura_bpc(root,fontes,quality)
    meta={'versao':1,'gerado_em':timestamp,'base_ipca':base_ipca,'fontes':fontes,'indicadores':catalog,
          'territorios':list(terras.values()),'arquivo':objeto(final,root),'grupos':offsets,'rankings':rankings}
    index=gravar_hash_json(root,'indice',meta)
    quality['indicadores']=len(catalog);quality['territorios']=len(terras);quality['abertura']=index;quality['arquivos']=parquet_objects
    quality['bytes_abertura']=final.stat().st_size;salvar_json(dest/'qualidade.json',quality)
    manifest.setdefault('fontes',{})['assistencia']={'versao':1,'atualizado_em':timestamp,'indicadores':len(catalog),'territorios':len(terras),
       'fontes':fontes,'arquivos':parquet_objects,'abertura':index,'qualidade':'gold/assistencia/qualidade.json','base_ipca':base_ipca}
    if not parcial:salvar_json(dest/'fonte.json',manifest['fontes']['assistencia'])
    manifest['gerado_em']=timestamp
    salvar_json(root/'gold/manifesto.json',manifest)
    print(json.dumps({'concluido':True,'indicadores':len(catalog),'territorios':len(terras),'competencias':periodos,
                      'abertura_bytes':final.stat().st_size,'indice_bytes':index['bytes'],'parcial':parcial}),flush=True)
    return meta,quality

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--base',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    p.add_argument('--parcial',action='store_true',help='Somente desenvolvimento; uma carga parcial não pode ser publicada')
    a=p.parse_args();construir(a.base,a.saida,a.parcial)
