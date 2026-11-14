"""Agregados do app EXTERNO público do Observatório do Cadastro Único (MDS).

Usa as medidas públicas com a proteção original de células pequenas; nunca desliga variáveis LGPD,
consulta apps internos ou exporta registros individuais. Totais BR/UF são consultados no próprio MDS,
não reconstruídos a partir de municípios com células suprimidas.
"""
import argparse
import hashlib
import json
import math
import os
import re
import time
import unicodedata
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
import requests
import websocket

from assistencia_utils import destino_isolado, salvar_json

APP_PUBLICO = '4bc1cdd4-aed5-41fe-bfa4-81b01b12881f'
ORIGEM = 'https://paineis.mds.gov.br'
PAGINA = ORIGEM + '/public/extensions/observatorio-do-cadastro-unico/index.html'
VERSAO = 2
CORRECOES_CAMPOS = {'IN_FAMILIA_INDIGENA_FAM':'DS_FAM_INDIGENA', 'IN_FAMILIA_QUILOMBOLA_FAM':'DS_FAM_QUILOMBOLA'}

def tem_protecao(expression):
    active=re.sub(r'/\*.*?(?:\*/|$)|//[^\n]*','',expression,flags=re.S).lower()
    return bool(re.search(r'\bif\s*\(',active) and 'v_usar_restricao_lgpd' in active and
                ('qtd_fam_lgpd' in active or 'qtd_pes_lgpd' in active))

def medidas_publicas(path):
    measures=json.loads(path.read_text(encoding='utf-8-sig'))
    measures=[m for m in measures if tem_protecao(m['qMeasure']['qDef'])]
    for m in measures:
        expression=m['qMeasure']['qDef']
        changes={a:b for a,b in CORRECOES_CAMPOS.items() if a in expression}
        if changes:
            m['expressao_original']=expression;m['correcoes_finbra']=changes
            for a,b in changes.items():expression=expression.replace(a,b)
            m['qMeasure']['qDef']=expression
    return measures

def payload_medida(m):
    return {'qDef':m['qMeasure']['qDef'],'qLabel':m['nome']} if m.get('correcoes_finbra') else m['id']

def conferir_campos(medidas,campos):
    for m in medidas:
        expression=re.sub(r'/\*.*?\*/','',m['qMeasure']['qDef'],flags=re.S)
        refs=set(re.findall(r'([A-Za-z_][\w]*)\s*=\s*\{',expression))
        if refs-set(campos):raise ValueError(f"Medida {m['nome']} referencia campos inexistentes: {sorted(refs-set(campos))}")


class QlikPublico:
    def __init__(self):
        session = requests.Session()
        response = session.get(PAGINA, timeout=40)
        response.raise_for_status()
        cookie = '; '.join(key+'='+value for key, value in session.cookies.get_dict().items())
        self.socket = websocket.create_connection(f'wss://paineis.mds.gov.br/public/app/{APP_PUBLICO}',
                                                 origin=ORIGEM, cookie=cookie, timeout=180)
        self.id = 0
        opened = self.call(-1, 'OpenDoc', [APP_PUBLICO])['qReturn']
        assert opened['qGenericId'] == APP_PUBLICO
        self.doc = opened['qHandle']

    def call(self, handle, method, params=None):
        self.id += 1
        number = self.id
        self.socket.send(json.dumps({'jsonrpc':'2.0','id':number,'handle':handle,'method':method,'params':params or []}))
        while True:
            data = json.loads(self.socket.recv())
            if data.get('id') != number:
                continue
            if data.get('error'):
                raise RuntimeError(f'{method}: {data["error"]}')
            return data['result']

    def cube(self, dimensions, measures):
        width = len(dimensions)+len(measures)
        props = {'qInfo':{'qType':'finbra-agregados-publicos'}, 'qHyperCubeDef':{
            'qDimensions':[{'qDef':{'qFieldDefs':[d], 'qSortCriterias':[{'qSortByAscii':1}]},'qNullSuppression':False} for d in dimensions],
            'qMeasures':[{'qLibraryId':m,'qDef':{}} if isinstance(m,str) else {'qDef':m} for m in measures],
            'qInterColumnSortOrder':list(range(width)), 'qSuppressZero':False,'qSuppressMissing':False,
            'qInitialDataFetch':[{'qTop':0,'qLeft':0,'qHeight':1,'qWidth':width}]}}
        handle = self.call(self.doc, 'CreateSessionObject', [props])['qReturn']['qHandle']
        layout = self.call(handle, 'GetLayout')['qLayout']['qHyperCube']
        if layout.get('qError',{}).get('qErrorCode'):
            raise RuntimeError(layout['qError'])
        errors=[x.get('qError') for x in layout.get('qMeasureInfo',[]) if x.get('qError',{}).get('qErrorCode')]
        if errors:raise RuntimeError(f'Medidas inválidas: {errors}')
        height = max(1,9000//width)
        rows = []
        for start in range(0,layout['qSize']['qcy'],height):
            page = self.call(handle,'GetHyperCubeData',['/qHyperCubeDef',[{
                'qTop':start,'qLeft':0,'qHeight':min(height,layout['qSize']['qcy']-start),'qWidth':width}]])['qDataPages'][0]
            assert page['qArea']['qTop']==start and page['qArea']['qWidth']==width
            rows.extend(page['qMatrix'])
        assert len(rows)==layout['qSize']['qcy']
        return rows,layout

    def fields(self):
        handle=self.call(self.doc,'CreateSessionObject',[{'qInfo':{'qType':'FieldList'},'qFieldListDef':{}}])['qReturn']['qHandle']
        return {x['qName'] for x in self.call(handle,'GetLayout')['qLayout']['qFieldList']['qItems']}

    def close(self):
        self.socket.close()


def campo(name):
    return 'cad_'+re.sub(r'[^a-z0-9]+','_',unicodedata.normalize('NFKD',name.removeprefix('im_')).encode('ascii','ignore').decode().lower()).strip('_')


def celula(cell):
    value = cell.get('qNum')
    if isinstance(value,(int,float)) and math.isfinite(value) and value>=0:
        return value,None
    # As medidas oficiais usam texto vazio ou -1 para células protegidas. Zero expresso continua zero.
    if value==-1 or cell.get('qText')=='':
        return None,'suprimido'
    return None,'protegido_ou_ausente'


def geografia(dimensions, cells):
    values = {key:cell.get('qText') for key,cell in zip(dimensions,cells)}
    if not dimensions:
        return {'grupo':'BR','nivel':'BR','uf':None,'cod_ibge':None,'nome':'Brasil'}
    if dimensions==['sigla_uf']:
        uf=values['sigla_uf']
        return {'grupo':uf,'nivel':'UF','uf':uf,'cod_ibge':None,'nome':uf}
    code=values['codigo_ibge7']
    if code and re.fullmatch(r'\d{7}',code):
        return {'grupo':code,'nivel':'M','uf':values['sigla_uf'],'cod_ibge':int(code),'nome':values['nome_municipio']}
    return {'grupo':'NAO_IDENTIFICADO','nivel':'I','uf':None,'cod_ibge':None,'nome':'Território não identificado na fonte'}


def carregar(saida: Path, medidas_path: Path):
    root=destino_isolado(saida)
    raw=root/'landing/assistencia/cadunico';silver=root/'silver/assistencia/cadunico'
    measures=medidas_publicas(medidas_path)
    from assistencia_catalogo import cad_catalogo
    approved={i['id'] for i in cad_catalogo()}
    measures=[m for m in measures if campo(m['nome']) in approved]
    # A lista revisada contém apenas medidas com as regras LGPD já implementadas pelo próprio Observatório.
    measures=[m for m in measures if tem_protecao(m['qMeasure']['qDef'])]
    assert {campo(m['nome']) for m in measures}==approved and len(measures)==len(approved)
    client=QlikPublico()
    try:
        before=client.call(client.doc,'GetAppLayout')
        conferir_campos(measures,client.fields())
        privacy,_=client.cube(['v_usar_restricao_lgpd','qtd_fam_lgpd','qtd_pes_lgpd'],[])
        assert len(privacy)==1 and [c['qText'] for c in privacy[0]]==['1','100','200'],'Proteção da fonte deve permanecer habilitada'
        dims_dates=['anomes','REF_PBF','REF_BPC','tipo_publicacao']
        dates,_=client.cube(dims_dates,[])
        references={name:sorted({row[i]['qText'] for row in dates if row[i].get('qElemNumber',-2)>=0}) for i,name in enumerate(dims_dates)}
        assert references['tipo_publicacao']==['EXTERNA_PUBLICA'], 'Somente a versão pública externa é aceita'
        assert len(references['anomes'])==1 and re.fullmatch(r'\d{4}/\d{2}',references['anomes'][0])
        month=int(references['anomes'][0].replace('/',''))
        raw.mkdir(parents=True,exist_ok=True);silver.mkdir(parents=True,exist_ok=True)
        salvar_json(raw/f'{month}_metadados_medidas.json',measures)
        salvar_json(raw/f'{month}_referencias.json',{'app':APP_PUBLICO,'origem':PAGINA,'layout':before,'referencias':references})
        ids=[payload_medida(m) for m in measures];names=[campo(m['nome']) for m in measures]
        all_rows=[];suppressed=0
        for level,dimensions in [('BR',[]),('UF',['sigla_uf']),('M',['codigo_ibge7','sigla_uf','nome_municipio'])]:
            rows,layout=client.cube(dimensions,ids)
            salvar_json(raw/f'{month}_{level}_layout.json',layout)
            for row in rows:
                record={'competencia':month,**geografia(dimensions,row[:len(dimensions)]),'ref_pbf':references.get('REF_PBF',[None])[0]}
                reasons={}
                for name,cell in zip(names,row[len(dimensions):]):
                    value,condition=celula(cell);record[name]=value
                    if condition:reasons[name]=condition
                    if condition=='suprimido':suppressed+=1
                record['condicoes']=json.dumps(reasons,ensure_ascii=False,separators=(',',':'))
                all_rows.append(record)
            print(json.dumps({'fonte':'cadunico','nivel':level,'linhas':len(rows),'medidas':len(names),'competencia':month}),flush=True)
        assert len({r['grupo'] for r in all_rows})==len(all_rows)
        assert all(r['nivel'] in ['BR','UF','M'] for r in all_rows),'Revisar territórios não identificados antes de publicar'
        assert sum(r['nivel']=='BR' for r in all_rows)==1 and sum(r['nivel']=='UF' for r in all_rows)==27
        assert sum(r['nivel']=='M' for r in all_rows)>=5570
        totals=next(r for r in all_rows if r['grupo']=='BR')
        crosschecks=[]
        for dim,id in [('DS_FAM_INDIGENA','cad_familia_indigena'),('DS_FAM_QUILOMBOLA','cad_familia_quilombola')]:
            categories,_=client.cube([dim],['JBmfU'])
            value=next(celula(r[1])[0] for r in categories if r[0]['qText']=='Sim')
            assert value==totals[id],f'Campo corrigido não confere com a categoria pública: {dim}'
            crosschecks.append({'campo':dim,'familias_brasil':value,'coincide_com_cubo_por_categoria':True})
        after=client.call(client.doc,'GetAppLayout')
        assert before==after,'O app foi atualizado durante a extração: não misturar snapshots'
        final=silver/f'{month}.parquet';temporary=final.with_suffix('.parquet.tmp')
        pq.write_table(pa.Table.from_pylist(all_rows),temporary,compression='zstd')
        os.replace(temporary,final)
        totals=next(r for r in all_rows if r['grupo']=='BR')
        quality={'versao':VERSAO,'competencia':month,'ref_pbf':references.get('REF_PBF'), 'referencias':references,
                 'medidas':len(names),'grupos':len(all_rows),'celulas_suprimidas':suppressed,
                 'brasil':{k:totals[k] for k in ['cad_qtd_familias','cad_qtd_pessoas']},
                 'sha256_parquet':hashlib.file_digest(final.open('rb'),'sha256').hexdigest(),
                 'url':PAGINA,'app_publico':APP_PUBLICO,'extraido_em':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
        quality['correcoes_campos']=CORRECOES_CAMPOS
        quality['conferencias_por_categoria']=crosschecks
        salvar_json(silver/f'{month}.json',quality)
        print(json.dumps(quality,ensure_ascii=False),flush=True)
        return quality
    finally:
        client.close()


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--saida',type=Path,required=True)
    parser.add_argument('--medidas',type=Path,default=Path(__file__).with_name('assistencia_cadunico_medidas.json'))
    args=parser.parse_args()
    carregar(args.saida,args.medidas)
