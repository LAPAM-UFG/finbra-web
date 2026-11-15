"""Painel de Educação: agrega tabelas públicas do Inep e prepara abertura sem WASM.

Somente a pasta candidata recebe arquivos. Brasil/UF: somas de contagens, razões
de somas para infraestrutura, taxas e Ideb publicados pelo próprio Inep.
"""
import argparse
import copy
import hashlib
import io
import json
import math
import re
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado
from educacao_baixar import PAGINAS, sha

UFS = dict(zip([11,12,13,14,15,16,17,21,22,23,24,25,26,27,28,29,31,32,33,35,41,42,43,50,51,52,53],
               'RO AC AM RR PA AP TO MA PI CE RN PB PE AL SE BA MG ES RJ SP PR SC RS MS MT GO DF'.split()))
NOMES_UF = {
    'AC':'Acre','AL':'Alagoas','AM':'Amazonas','AP':'Amapá','BA':'Bahia','CE':'Ceará',
    'DF':'Distrito Federal','ES':'Espírito Santo','GO':'Goiás','MA':'Maranhão',
    'MG':'Minas Gerais','MS':'Mato Grosso do Sul','MT':'Mato Grosso','PA':'Pará',
    'PB':'Paraíba','PE':'Pernambuco','PI':'Piauí','PR':'Paraná','RJ':'Rio de Janeiro',
    'RN':'Rio Grande do Norte','RO':'Rondônia','RR':'Roraima','RS':'Rio Grande do Sul',
    'SC':'Santa Catarina','SE':'Sergipe','SP':'São Paulo','TO':'Tocantins',
}


def indicador(id, nome, nome_en, tema, unidade='numero', fonte='censo', descricao='', descricao_en=''):
    return dict(id=id, variavel='edu_'+id, nome=nome, nome_en=nome_en, tema=tema,
                unidade=unidade, fonte=fonte, descricao=descricao or nome, descricao_en=descricao_en or nome_en)


CONTAGENS = {
    'mat_total': ('QT_MAT_BAS','Matrículas na educação básica','Basic education enrolments'),
    'mat_creche': ('QT_MAT_INF_CRE','Matrículas em creche','Nursery enrolments'),
    'mat_pre': ('QT_MAT_INF_PRE','Matrículas na pré-escola','Preschool enrolments'),
    'mat_ai': ('QT_MAT_FUND_AI','Ensino fundamental: anos iniciais','Primary school enrolments'),
    'mat_af': ('QT_MAT_FUND_AF','Ensino fundamental: anos finais','Lower secondary enrolments'),
    'mat_medio': ('QT_MAT_MED','Matrículas no ensino médio','Upper secondary enrolments'),
    'mat_eja': ('QT_MAT_EJA','Educação de jovens e adultos (EJA)','Youth and adult education enrolments'),
    'mat_prof': ('QT_MAT_PROF','Educação profissional','Vocational education enrolments'),
    'mat_especial': ('QT_MAT_ESP','Matrículas da educação especial','Special education enrolments'),
}
INFRA = {
    'internet_pct': ('IN_INTERNET','Escolas públicas com internet','Public schools with internet'),
    'banda_larga_pct': ('IN_BANDA_LARGA','Escolas públicas com banda larga','Public schools with broadband'),
    'biblioteca_pct': ('IN_BIBLIOTECA_SALA_LEITURA','Biblioteca ou sala de leitura','Library or reading room in public schools'),
    'quadra_pct': ('IN_QUADRA_ESPORTES','Quadra de esportes','Sports court in public schools'),
    'agua_rede_pct': ('IN_AGUA_REDE_PUBLICA','Água da rede pública','Public water supply in public schools'),
    'banheiro_acessivel_pct': ('IN_BANHEIRO_PNE','Banheiro acessível','Accessible toilet in public schools'),
    'lab_informatica_pct': ('IN_LABORATORIO_INFORMATICA','Laboratório de informática','Computer lab in public schools'),
}
INDICADORES = [indicador(k,n,en,'matriculas') for k,(_,n,en) in CONTAGENS.items()]
INDICADORES += [
    indicador('mat_integral','Matrículas em tempo integral','Full-time enrolments','integral'),
    indicador('integral_pct','Tempo integral: infantil, fundamental e médio','Full-time: preschool, primary and secondary','integral','percentual'),
    *[indicador('mat_'+k,'Matrículas: rede '+n,'Enrolments: '+en,'redes') for k,n,en in [
        ('publica','pública','public sector'),('municipal','municipal','municipal schools'),
        ('estadual','estadual','state schools'),('privada','privada','private schools'),('federal','federal','federal schools')]],
    indicador('escolas','Escolas com matrículas','Schools with enrolments','escolas'),
    indicador('escolas_publicas','Escolas públicas','Public schools','escolas'),
    indicador('escolas_municipais','Escolas da rede municipal','Municipal schools','escolas'),
    indicador('escolas_rurais_pct','Escolas públicas na área rural','Public schools in rural areas','escolas','percentual'),
    *[indicador(k,n,en,'infraestrutura','percentual') for k,(_,n,en) in INFRA.items()],
]
for prefix,nome,en in [('apr','Aprovação','Pass rate'),('rep','Reprovação','Repetition rate'),('aband','Abandono','Dropout rate')]:
    for stage,title,title_en in [('ai','anos iniciais','primary'),('af','anos finais','lower secondary'),('medio','ensino médio','upper secondary')]:
        INDICADORES.append(indicador(prefix+'_'+stage,nome+': '+title,en+': '+title_en,'trajetoria','percentual','rendimento'))
for stage,title,title_en in [('ai','anos iniciais','primary'),('af','anos finais','lower secondary'),('medio','ensino médio','upper secondary')]:
    INDICADORES.append(indicador('dist_'+stage,'Atraso escolar: '+title,'Age-grade distortion: '+title_en,'trajetoria','percentual','distorcao'))
    INDICADORES.append(indicador('ideb_'+stage,'Ideb: '+title,'Ideb: '+title_en,'aprendizagem','indice','ideb'))
INDICADORES.append({**indicador('ideb_medio_estadual','Ideb: ensino médio, rede estadual','Ideb: upper secondary, state schools','aprendizagem','indice','ideb'),'rede':'estadual'})

for i in INDICADORES:
    if i['fonte'] != 'censo':
        i['descricao'] += ('. Rede estadual' if i.get('rede')=='estadual' else '. Rede pública')+', localização total. Valor divulgado pelo Inep para o próprio recorte; não é média dos municípios.'
        i['descricao_en'] += ('. State schools' if i.get('rede')=='estadual' else '. Public schools')+', all locations. Official Inep result for this territory, not a municipal average.'
    elif i['id'] in INFRA or i['id']=='escolas_rurais_pct':
        i['descricao'] += '. Percentual entre escolas públicas com matrículas e informação válida para o item. Ausência de resposta é preservada.'
        i['descricao_en'] += '. Percentage of public schools with enrolments and a valid answer to this item. Missing responses are preserved.'
    elif i['id'] in ['mat_integral','integral_pct']:
        i['descricao'] += '. Educação infantil, ensino fundamental e médio; jornada de pelo menos 7 horas diárias ou 35 semanais, segundo o Censo. Numerador e denominador abrangem as mesmas etapas.'
        i['descricao_en'] += '. Preschool, primary and secondary education; at least 7 hours a day or 35 a week under the Census definition. Numerator and denominator cover the same stages.'
    else:
        i['descricao'] += '. Escolas localizadas no território, todas as redes, salvo a rede indicada no nome. Matrículas não são pessoas únicas.'
        i['descricao_en'] += '. Schools located in the territory, all sectors unless a specific sector is named. Enrolments are not unique people.'
    if i['id'] in ['mat_prof','mat_especial']:
        i['descricao'] += ' Este recorte pode se sobrepor às etapas: não somar ao total.'
        i['descricao_en'] += ' This group can overlap other stages: do not add it to the total.'
    if i['id'].startswith('dist_'):
        i['descricao'] += ' Alunos com dois anos ou mais de atraso em relação à idade esperada para a série.'
        i['descricao_en'] += ' Students at least two years older than the expected age for their grade.'

IDS_PRINCIPAIS = tuple(i['id'] for i in INDICADORES)
CONTAGENS_ADICIONAIS = {
    'mat_feminino':('QT_MAT_BAS_FEM','Matrículas: sexo feminino','Enrolments: female','perfil'),
    'mat_masculino':('QT_MAT_BAS_MASC','Matrículas: sexo masculino','Enrolments: male','perfil'),
    'mat_raca_branca':('QT_MAT_BAS_BRANCA','Matrículas: cor/raça branca','Enrolments: white','perfil'),
    'mat_raca_preta':('QT_MAT_BAS_PRETA','Matrículas: cor/raça preta','Enrolments: black','perfil'),
    'mat_raca_parda':('QT_MAT_BAS_PARDA','Matrículas: cor/raça parda','Enrolments: brown (parda)','perfil'),
    'mat_raca_amarela':('QT_MAT_BAS_AMARELA','Matrículas: cor/raça amarela','Enrolments: Asian (amarela)','perfil'),
    'mat_raca_indigena':('QT_MAT_BAS_INDIGENA','Matrículas: cor/raça indígena','Enrolments: Indigenous','perfil'),
    'mat_raca_nd':('QT_MAT_BAS_ND','Matrículas: cor/raça não declarada','Enrolments: unreported race/colour','perfil'),
    'mat_esp_comum':('QT_MAT_ESP_CC','Educação especial: classes comuns','Special education: mainstream classes','inclusao'),
    'mat_esp_exclusiva':('QT_MAT_ESP_CE','Educação especial: classes exclusivas','Special education: exclusive classes','inclusao'),
    'doc_bas':('QT_DOC_BAS','Docentes nas escolas: educação básica','School teaching positions: basic education','docentes'),
    'doc_inf':('QT_DOC_INF','Docentes nas escolas: educação infantil','School teaching positions: early childhood','docentes'),
    'doc_fund':('QT_DOC_FUND','Docentes nas escolas: ensino fundamental','School teaching positions: primary/lower secondary','docentes'),
    'doc_med':('QT_DOC_MED','Docentes nas escolas: ensino médio regular','School teaching positions: regular upper secondary','docentes'),
    'tur_bas':('QT_TUR_BAS','Turmas da educação básica','Basic education classes','docentes'),
    'tur_inf':('QT_TUR_INF','Turmas da educação infantil','Early childhood classes','docentes'),
    'tur_fund':('QT_TUR_FUND','Turmas do ensino fundamental','Primary/lower secondary classes','docentes'),
    'tur_med':('QT_TUR_MED','Turmas do ensino médio regular','Regular upper secondary classes','docentes'),
}
INFRA_ADICIONAL = {
    'agua_potavel_pct':('IN_AGUA_POTAVEL','Escolas públicas com água potável','Public schools providing drinking water'),
    'esgoto_rede_pct':('IN_ESGOTO_REDE_PUBLICA','Escolas públicas ligadas à rede de esgoto','Public schools connected to a sewage network'),
    'energia_rede_pct':('IN_ENERGIA_REDE_PUBLICA','Escolas públicas com energia da rede','Public schools with grid electricity'),
    'lixo_coleta_pct':('IN_LIXO_SERVICO_COLETA','Escolas públicas com coleta de lixo','Public schools with waste collection'),
    'alimentacao_pct':('IN_ALIMENTACAO','Escolas públicas com alimentação (PNAE)','Public schools providing meals (PNAE)'),
    'internet_alunos_pct':('IN_INTERNET_ALUNOS','Escolas públicas com internet para alunos','Public schools with internet for students'),
    'rampas_pct':('IN_ACESSIBILIDADE_RAMPAS','Escolas públicas com rampas acessíveis','Public schools with accessibility ramps'),
}
for k,(col,n,en,tema) in CONTAGENS_ADICIONAIS.items():
    CONTAGENS[k]=(col,n,en)
    if k.startswith('doc_'):
        pt='Soma das contagens de docentes de cada escola. Um professor que atua em duas escolas conta duas vezes. As etapas podem se sobrepor; não somá-las. Não é uma contagem de professores únicos no território.'
        eng='Sum of school-level teacher counts. A teacher working at two schools counts twice. Stages can overlap and must not be added. This is not a count of unique teachers in the territory.'
    elif k.startswith('tur_'):
        pt='Contagem de turmas nas escolas em funcionamento e com matrículas, em todas as redes. Ausência de divulgação é preservada.'
        eng='Classes in operating schools with enrolments, across all sectors. Unpublished counts remain missing.'
    else:
        pt='Matrículas da educação básica nas escolas do território, em todas as redes. São registros de matrícula, não pessoas únicas. Cor/raça não declarada é uma categoria registrada, diferente de dado ausente.'
        eng='Basic education enrolments in schools located in the territory, across all sectors. These are enrolment records, not unique people. Unreported race/colour is a recorded category, distinct from missing data.'
    INDICADORES.append(indicador(k,n,en,tema,descricao=pt,descricao_en=eng))
for k,(col,n,en) in INFRA_ADICIONAL.items():
    INFRA[k]=(col,n,en)
    pt='Percentual entre escolas públicas com matrículas e resposta válida ao item. Razão das somas de escolas, sem média dos percentuais municipais. Ausência de resposta permanece ausente.'
    eng='Percentage of public schools with enrolments and a valid answer. Ratio of school counts, not an average of municipal percentages. Missing answers remain missing.'
    if k=='alimentacao_pct':
        pt+=' O campo oficial refere-se à alimentação escolar PNAE/FNDE.'
        eng+=' The official field refers to PNAE/FNDE school meals.'
    if k=='internet_alunos_pct':
        pt+=' A declaração explícita de não ter internet implica não oferecê-la aos alunos.'
        eng+=' An explicit no-internet answer implies no internet for students.'
    INDICADORES.append(indicador(k,n,en,'infraestrutura','percentual',descricao=pt,descricao_en=eng))
INDICADORES.append(indicador('esp_comum_pct','Educação especial em classes comuns','Special education in mainstream classes','inclusao','percentual',
    descricao='Matrículas da educação especial em classes comuns divididas pelas matrículas da educação especial em classes comuns e exclusivas, vezes 100. Todas as redes; não mede a parcela de alunos com deficiência na população. Sem matrículas de educação especial, o percentual fica indefinido.',
    descricao_en='Special education enrolments in mainstream classes divided by special education enrolments in mainstream and exclusive classes, times 100. All sectors; not a measure of disability prevalence. With no special education enrolments, the percentage is undefined.'))
for i in INDICADORES:i['principal']=i['id'] in IDS_PRINCIPAIS
IDS = [i['id'] for i in INDICADORES]
assert len(IDS)==69 and len(set(IDS))==69 and len(IDS_PRINCIPAIS)==43


def normal(text):
    import unicodedata
    return re.sub(r'\s+',' ',''.join(c for c in unicodedata.normalize('NFD',str(text)) if not unicodedata.combining(c))).lower().strip()


def valor(x):
    if x is None or pd.isna(x): return None
    v=float(x)
    if not math.isfinite(v): return None
    return int(v) if v.is_integer() else v


def csv_escola(folder, year):
    files=[p for p in folder.iterdir() if p.suffix.lower()=='.csv' and ('microdados_ed_basica' in p.name.lower() or 'tabela_escola_' in p.name.lower())]
    if len(files)!=1: raise ValueError(f'Tabela de escola ambígua em {folder}')
    path=files[0]
    with path.open('rb') as f:columns=f.readline().decode('utf-8-sig').strip().split(';')
    wanted={'NU_ANO_CENSO','CO_ENTIDADE','CO_MUNICIPIO','NO_MUNICIPIO','SG_UF','TP_DEPENDENCIA','TP_LOCALIZACAO','TP_SITUACAO_FUNCIONAMENTO',
            'QT_MAT_BAS','QT_MAT_INF','QT_MAT_FUND','QT_MAT_MED','QT_MAT_INF_INT','QT_MAT_FUND_INT','QT_MAT_MED_INT',
            'IN_BIBLIOTECA','IN_SALA_LEITURA',*[v[0] for v in CONTAGENS.values()],*[v[0] for v in INFRA.values()]}
    def read(file,usecols):
        try:return pd.read_csv(file,sep=';',encoding='utf-8-sig',usecols=usecols,low_memory=False)
        except UnicodeDecodeError:return pd.read_csv(file,sep=';',encoding='cp1252',usecols=usecols,low_memory=False)
    frame=read(path,[c for c in columns if c in wanted])
    if year>=2025:
        for kind in ['Matricula','Docente','Turma']:
            files=list(folder.glob('Tabela_'+kind+'_*.csv'))
            if len(files)!=1:raise ValueError('Tabela agregada ausente ou ambígua: '+kind)
            with files[0].open('rb') as f:cols=f.readline().decode('utf-8-sig').strip().split(';')
            selected=['CO_ENTIDADE',*[c for c in cols if c in wanted and c not in frame]]
            m=read(files[0],selected)
            if frame.CO_ENTIDADE.duplicated().any() or m.CO_ENTIDADE.duplicated().any(): raise ValueError('Escolas duplicadas na junção: '+kind)
            frame=frame.merge(m,on='CO_ENTIDADE',how='left',validate='one_to_one')
    if frame.CO_ENTIDADE.duplicated().any():raise ValueError('Escola duplicada')
    if set(frame.NU_ANO_CENSO.dropna().unique())!={year}:raise ValueError('Ano do Censo divergente')
    if frame.CO_MUNICIPIO.isna().any():raise ValueError('Código municipal ausente')
    # Uma escola de Sapiranga/RS em 2025 tem nome municipal e sigla vazios,
    # mas código IBGE válido. Completa apenas o cadastro; nenhum número muda.
    code=frame.CO_MUNICIPIO.astype(int).astype(str)
    expected=code.str[:2].astype(int).map(UFS)
    if expected.isna().any() or (~code.str.fullmatch(r'[1-9][0-9]{6}')).any():raise ValueError('Código municipal inválido')
    if (frame.SG_UF.notna() & frame.SG_UF.ne(expected)).any():raise ValueError('UF não corresponde ao código municipal')
    frame['SG_UF']=frame.SG_UF.fillna(expected)
    frame['NO_MUNICIPIO']=frame.NO_MUNICIPIO.fillna(frame.groupby('CO_MUNICIPIO').NO_MUNICIPIO.transform('first'))
    if frame.NO_MUNICIPIO.isna().any():raise ValueError('Município sem nome de referência')
    return frame.loc[(frame.TP_SITUACAO_FUNCIONAMENTO==1)&(frame.QT_MAT_BAS>0)].copy()


def agregar_escolas(frame):
    """Uma escola, uma linha. NULL continua NULL; razões nunca são médias locais."""
    public=frame.TP_DEPENDENCIA.isin([1,2,3])
    vals=pd.DataFrame(index=frame.index)
    for k,(col,_,_) in CONTAGENS.items(): vals[k]=pd.to_numeric(frame.get(col,pd.Series(np.nan,index=frame.index)),errors='raise')
    stages=['QT_MAT_INF_INT','QT_MAT_FUND_INT','QT_MAT_MED_INT']
    vals['mat_integral']=frame.reindex(columns=stages).sum(axis=1,min_count=3)
    vals['_base_integral']=frame.reindex(columns=['QT_MAT_INF','QT_MAT_FUND','QT_MAT_MED']).sum(axis=1,min_count=3)
    for id,deps in {'mat_publica':[1,2,3],'mat_municipal':[3],'mat_estadual':[2],'mat_privada':[4],'mat_federal':[1]}.items():
        vals[id]=frame.QT_MAT_BAS.where(frame.TP_DEPENDENCIA.isin(deps),0)
    vals['escolas']=1
    vals['escolas_publicas']=public.astype(int)
    vals['escolas_municipais']=(frame.TP_DEPENDENCIA==3).astype(int)
    flags={'escolas_rurais_pct':(frame.TP_LOCALIZACAO==2).where(frame.TP_LOCALIZACAO.isin([1,2]))}
    for k,(c,_,_) in INFRA.items():
        flag=frame.get(c,pd.Series(np.nan,index=frame.index)).copy()
        if k=='biblioteca_pct':
            a=frame.get('IN_BIBLIOTECA',pd.Series(np.nan,index=frame.index));b=frame.get('IN_SALA_LEITURA',pd.Series(np.nan,index=frame.index))
            derived=(a.eq(1)|b.eq(1)).astype(float).where(a.eq(1)|b.eq(1)|(a.eq(0)&b.eq(0)))
            flag=flag.where(flag.notna(),derived)
        if k in ['banda_larga_pct','internet_alunos_pct']: flag=flag.where(flag.notna(),0).where(flag.notna()|frame.IN_INTERNET.eq(0))
        flags[k]=flag.where(flag.isin([0,1]))
    for k,flag in flags.items():
        vals['_n_'+k]=flag.eq(1).where(public,False).astype(int)
        vals['_d_'+k]=(public & flag.notna()).astype(int)
    result={}
    labels={}
    # Todas as linhas municipais, UF e Brasil seguem a mesma expressão, com min_count para preservar ausências.
    aggregated=pd.concat([
        pd.DataFrame([vals.sum(min_count=1)],index=['BR']),
        vals.groupby(frame.CO_MUNICIPIO.astype(int).astype(str)).sum(min_count=1),
        vals.groupby(frame.SG_UF).sum(min_count=1),
    ])
    incomplete=vals[['mat_integral','_base_integral']].isna().any(axis=1)
    bad={'BR':incomplete.any(),**incomplete.groupby(frame.CO_MUNICIPIO.astype(int).astype(str)).any().to_dict(),**incomplete.groupby(frame.SG_UF).any().to_dict()}
    missing=vals[list(CONTAGENS_ADICIONAIS)].isna()
    missing_groups=pd.concat([pd.DataFrame([missing.any()],index=['BR']),missing.groupby(frame.CO_MUNICIPIO.astype(int).astype(str)).any(),missing.groupby(frame.SG_UF).any()])
    for group,sums in aggregated.iterrows():
        rec={k:valor(sums.get(k)) for k in IDS if k in vals}
        den=sums['_base_integral'];num=sums['mat_integral']
        # Cobertura completa das três etapas em todas as escolas é necessária para a razão agregada.
        complete=not bad[group]
        if not complete:rec['mat_integral']=None
        rec['integral_pct']=valor(100*num/den) if complete and pd.notna(den) and den>0 else None
        for k in CONTAGENS_ADICIONAIS:
            if missing_groups.loc[group,k]:rec[k]=None
        cc,ce=rec['mat_esp_comum'],rec['mat_esp_exclusiva']
        rec['esp_comum_pct']=100*cc/(cc+ce) if cc is not None and ce is not None and cc+ce>0 else None
        cov={}
        for k in flags:
            n,d=int(sums['_n_'+k]),int(sums['_d_'+k]);rec[k]=100*n/d if d else None;cov[k]=[n,d]
        result[group]=(rec,cov)
    for c,g in frame.groupby('CO_MUNICIPIO'):
        if len(g.NO_MUNICIPIO.unique())!=1 or len(g.SG_UF.unique())!=1:raise ValueError('Cadastro municipal ambíguo')
        labels[str(int(c))]=dict(grupo=str(int(c)),nome=str(g.NO_MUNICIPIO.iloc[0]),uf=str(g.SG_UF.iloc[0]),cod_ibge=int(c),nivel='M')
    return result,labels


def planilhas(path):
    """Lê apenas planilhas tabulares, nunca extrai caminhos do ZIP para o disco."""
    if path.suffix=='.zip':
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.lower().endswith(('.xls','.xlsx')) and not Path(name).name.startswith('~'):
                    with pd.ExcelFile(io.BytesIO(z.read(name)),engine='calamine') as book:yield name,book
    else:
        with pd.ExcelFile(path,engine='calamine') as book:yield path.name,book


def objeto(root,path,name,ext):
    digest=sha(path);dest=root/'gold/educacao'/(name+'_'+digest[:12]+'.'+ext)
    dest.parent.mkdir(parents=True,exist_ok=True)
    if not dest.exists():
        import shutil
        shutil.copyfile(path,dest)
    elif sha(dest)!=digest:raise ValueError('Colisão de nome imutável')
    return dict(caminho=dest.relative_to(root).as_posix(),sha256=digest,bytes=dest.stat().st_size)


def json_file(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')),encoding='utf-8')


def tabela_legada(book,sheet,top,kind):
    """Edições antigas não têm nomes técnicos: reconhece os rótulos oficiais."""
    candidates=[idx for idx,row in top.iterrows() if any(normal(v)=='ano' for v in row)]
    if not candidates:return None
    header=candidates[0];base=top.iloc[header]
    body=top.iloc[header:]
    def initial(label):return 'anos iniciais' in label or bool(re.search(r'\b1[ºo]?\s*a(?:o)?\s*5',label))
    def final(label):return 'anos finais' in label or bool(re.search(r'\b6[ºo]?\s*a(?:o)?\s*9',label))
    sub_idx=next((idx for idx,row in body.iterrows() if any(initial(normal(v)) for v in row)),None)
    stage_idx=next((idx for idx,row in body.iterrows() if any('ensino medio' in normal(v) for v in row)),None)
    if sub_idx is None or stage_idx is None:raise ValueError('Etapas não identificadas no cabeçalho: '+sheet)
    sub=top.iloc[sub_idx];stages=top.iloc[stage_idx]
    metric_idx=next((idx for idx,row in body.iterrows() if any('aprovacao' in normal(v) for v in row)),header)
    blocks=top.iloc[metric_idx].ffill()
    rename={}
    for pos,cell in enumerate(base):
        label=normal(cell)
        if label=='ano':rename[pos]='NU_ANO_CENSO'
        elif 'codigo' in label and 'municipio' in label:rename[pos]='CO_MUNICIPIO'
        elif 'nome' in label and 'municipio' in label:rename[pos]='NO_MUNICIPIO'
        elif label in ['uf','sigla da uf']:rename[pos]='SG_UF'
        elif label in ['regiao','grandes regioes']:rename[pos]='NO_REGIAO'
        elif label in ['brasil','abrangencia'] or 'federacao' in label or ('unidade' in label and 'geografica' in label):rename[pos]='UNIDGEO'
        elif label=='localizacao':rename[pos]='NO_CATEGORIA'
        elif label=='rede' or 'dependencia administrativa' in label:rename[pos]='NO_DEPENDENCIA'
    for pos,cell in enumerate(sub):
        label=normal(cell);block=normal(blocks.iloc[pos])
        stage='FUN_AI' if initial(label) else 'FUN_AF' if final(label) else 'MED' if 'ensino medio' in normal(stages.iloc[pos]) else None
        if not stage:continue
        if kind=='rendimento':
            text=block+' '+label
            metric='2' if 'reprovacao' in text else '3' if 'abandono' in text else '1' if 'aprovacao' in text else None
            if metric:rename[pos]=metric+'_CAT_'+stage
        else:rename[pos]=stage+'_CAT_0'
    starts=[idx for idx,row in top.iterrows() if idx>header and pd.notna(row.iloc[0]) and re.fullmatch(r'20\d{2}(?:\.0)?',str(row.iloc[0]))]
    if not starts:raise ValueError('Início dos dados não identificado: '+sheet)
    positions=sorted(rename)
    d=pd.read_excel(book,sheet_name=sheet,header=None,skiprows=starts[0],usecols=positions)
    d.columns=[rename[p] for p in positions]
    return d,dict(planilha=sheet,formato='cabecalhos_legiveis',linha=header,colunas=rename)


def gerar(brutos,saida,base=Path('E:/finbra/data')):
    brutos=brutos.resolve();saida=destino_isolado(saida,brutos)
    destino_isolado(saida,base.resolve())
    if (saida/'gold/educacao/manifesto.json').exists():raise ValueError('A candidata já contém um manifesto de educação')
    (saida/'trabalho_educacao').mkdir(parents=True,exist_ok=True)
    work=saida/'trabalho_educacao';coleta=json.loads((brutos/'coleta.json').read_text(encoding='utf-8'))
    values={};coverage={};territories={}
    for source in coleta['censo']:
        year=source['ano'];folder=brutos/str(year)
        hashes=[(e['nome'],sha(folder/e['nome'])) for e in source['arquivos'] if Path(e['nome']).suffix.lower()=='.csv']
        for name,digest in hashes:assert digest==next(e['sha256'] for e in source['arquivos'] if e['nome']==name)
        fingerprint=hashlib.sha256(json.dumps(hashes,sort_keys=True).encode()).hexdigest()
        cache=work/f'censo_{year}_v2.json'
        cached=json.loads(cache.read_text(encoding='utf-8')) if cache.exists() else None
        if cached and cached['origem']==fingerprint:
            result=cached['result'];labels=cached['labels'];schools=cached['escolas']
        else:
            frame=csv_escola(folder,year);result,labels=agregar_escolas(frame);schools=len(frame)
            json_file(cache,dict(origem=fingerprint,result=result,labels=labels,escolas=schools))
        territories.update(labels)
        for g,(rec,cov) in result.items():values[(g,year)]=rec;coverage[(g,year)]=cov
        print(f'Censo agregado: {year}, {schools} escolas, {len(labels)} municípios',flush=True)
    # Resultados de rendimento, distorção e Ideb entram pelos recortes oficiais.
    auditoria=ler_indicadores_paralelo(coleta['indicadores'],values)
    years=sorted({y for g,y in values})
    for uf,name in NOMES_UF.items():territories[uf]=dict(grupo=uf,nome=name,uf=uf,cod_ibge=None,nivel='UF')
    territories['BR']=dict(grupo='BR',nome='Brasil',uf=None,cod_ibge=None,nivel='BR')
    groups={}
    nd=work/'series.ndjson'
    with nd.open('wb') as f:
        for g in sorted({g for g,y in values}):
            rows=[[y,*[values[(g,y)].get(k) for k in IDS]] for y in years if (g,y) in values]
            obj=dict(grupo=g,linhas=rows,cobertura={str(y):coverage[(g,y)] for y in years if (g,y) in coverage})
            content=(json.dumps(obj,ensure_ascii=False,allow_nan=False,separators=(',',':'))+'\n').encode('utf-8')
            groups[g]=[f.tell(),len(content),hashlib.sha256(content).hexdigest()];f.write(content)
    refs={}
    for uf in sorted(NOMES_UF):
        items=[{**t,'trecho':groups[g]} for g,t in territories.items() if t['nivel']=='M' and t['uf']==uf and g in groups]
        items.sort(key=lambda t:normal(t['nome']))
        path=work/f'municipios_{uf.lower()}.json';json_file(path,items);refs[uf]=objeto(saida,path,'municipios_'+uf.lower(),'json')
    ranking={}
    for year in years:
        rows=[[int(g),territories[g]['nome'],territories[g]['uf'],*[v.get(k) for k in IDS]] for (g,y),v in values.items() if y==year and g.isdigit() and len(g)==7]
        rows.sort(key=lambda r:r[0]);path=work/f'ranking_{year}.json';json_file(path,dict(ano=year,linhas=rows))
        ranking[str(year)]=objeto(saida,path,'ranking_'+str(year),'json')
    indicators=copy.deepcopy(INDICADORES)
    for i in indicators:
        i['anos']=sorted({y for (g,y),v in values.items() if v.get(i['id']) is not None})
    rows=[]
    for (g,year),v in sorted(values.items()):
        if g.isdigit() and len(g)==7:
            t=territories[g]
            rows.append(dict(cod_ibge=int(g),municipio=t['nome'],uf=t['uf'],ano=year,**{'edu_'+k:v.get(k) for k in IDS}))
    frame=pd.DataFrame(rows)
    table=pa.Table.from_pandas(frame,preserve_index=False)
    pq.write_table(table,work/'municipios.parquet',compression='zstd')
    parquet=objeto(saida,work/'municipios.parquet','municipios','parquet')
    meta=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=years,indicadores=indicators,
              arquivo=objeto(saida,nd,'series','ndjson'),municipios=refs,rankings=ranking,parquet=parquet,
              territorios=[{**territories[g],'trecho':groups[g]} for g in ['BR',*sorted(NOMES_UF)] if g in groups],
              fontes={k:dict(nome={'censo':'Censo Escolar','rendimento':'Taxas de rendimento','distorcao':'Distorção idade-série','ideb':'Ideb'}[k],url=u) for k,u in PAGINAS.items()},
              coleta_sha256=sha(brutos/'coleta.json'))
    json_file(saida/'gold/educacao/manifesto.json',meta)
    json_file(work/'auditoria_fontes.json',auditoria)
    print(json.dumps(dict(ok=True,indicadores=len(IDS),municipios=frame.cod_ibge.nunique(),linhas=len(frame),anos=years,manifesto_bytes=(saida/'gold/educacao/manifesto.json').stat().st_size)),flush=True)
    return meta


def ler_indicadores(sources,values):
    audit=[];seen={};uf_names={normal(n):u for u,n in NOMES_UF.items()}
    uf_names.update({normal('R. G. do Norte'):'RN',normal('R. G. do Sul'):'RS',normal('M. G. do Sul'):'MS'})
    def number(x):
        if pd.isna(x):return None
        if isinstance(x,str):
            if normal(x) in {'','-','--','---','*','**','***','...','..','nd','n/d','s/d','na','nan'}:return None
            x=x.strip().replace(',','.')
        return valor(x)
    def geographic(row):
        if 'CO_MUNICIPIO' in row.index:
            n=number(row.CO_MUNICIPIO)
            return str(int(n)) if n is not None and 1000000<=n<=9999999 else None
        for col in ['SG_UF','SIGLA','UF','NO_UF','UNIDGEO','BRASIL']:
            if col not in row.index:continue
            v=str(row[col]).strip()
            if v in NOMES_UF:return v
            if normal(v) in uf_names:return uf_names[normal(v)]
            if normal(v)=='brasil':return 'BR'
        return None
    def put(group,year,id,x,source):
        key=(group,year,id);v=number(x)
        if v is not None and not 0<=v<=(10 if id.startswith('ideb') else 100):raise ValueError('Indicador fora da unidade: '+str(key))
        if key in seen and seen[key]!=v:raise ValueError('Resultados oficiais conflitantes: '+str(key))
        seen[key]=v
        groups_seen.add(group)
        # Um território sem escola no Censo pode existir nas tabelas do Inep; seus demais indicadores permanecem ausentes.
        values.setdefault((group,year),{})[id]=v
    for source in sources:
        path=Path(source['caminho'])
        if sha(path)!=source['sha256']:raise ValueError('Origem alterada: '+str(path))
        added=0;aliases=[];groups_seen=set()
        for filename,book in planilhas(path):
            for sheet in book.sheet_names:
                top=pd.read_excel(book,sheet_name=sheet,header=None,nrows=16)
                headers=[idx for idx,row in top.iterrows() if 'NU_ANO_CENSO' in row.values or any(re.fullmatch(r'VL_OBSERVADO_20\d{2}',str(v)) for v in row)]
                if not headers:
                    legacy=tabela_legada(book,sheet,top,source['fonte']) if source['fonte']!='ideb' else None
                    if legacy is None:continue
                    d,alias=legacy;aliases.append(alias)
                else:
                    if source['fonte']=='ideb':d=pd.read_excel(book,sheet_name=sheet,header=headers[0])
                    else:
                        expected={str(n)+'_CAT_'+suffix for n in [1,2,3] for suffix in ['FUN_AI','FUN_AF','MED']} if source['fonte']=='rendimento' else {'FUN_AI_CAT_0','FUN_AF_CAT_0','MED_CAT_0'}
                        wanted=expected|{'NU_ANO_CENSO','NO_CATEGORIA','NO_DEPENDENCIA','CO_MUNICIPIO','NO_MUNICIPIO','SG_UF','SIGLA','UF','NO_UF','UNIDGEO','BRASIL','CO_UF'}
                        d=pd.read_excel(book,sheet_name=sheet,header=headers[0],usecols=lambda c:str(c).strip().upper() in wanted)
                d.columns=[str(c).strip().upper() for c in d.columns]
                if source['fonte']=='ideb':
                    names=list(d.columns)
                    for position,cell in enumerate(top.iloc[6]):
                        if not names[position].startswith('UNNAMED:'):continue
                        label=normal(cell);canonical=None
                        if label=='rede' or 'dependencia administrativa' in label:canonical='REDE'
                        elif 'codigo' in label and 'municipio' in label:canonical='CO_MUNICIPIO'
                        elif 'nome' in label and 'municipio' in label:canonical='NO_MUNICIPIO'
                        elif label in ['uf','sigla da uf']:canonical='SG_UF'
                        elif label in ['brasil','abrangencia'] or 'federacao' in label or ('unidade' in label and 'geografica' in label):canonical='UNIDGEO'
                        if canonical:
                            aliases.append(dict(planilha=sheet,cabecalho=str(cell),coluna=names[position],canonico=canonical))
                            names[position]=canonical
                    d.columns=names
                if source['fonte']!='ideb':
                    expected={str(n)+'_CAT_'+suffix for n in [1,2,3] for suffix in ['FUN_AI','FUN_AF','MED']} if source['fonte']=='rendimento' else {'FUN_AI_CAT_0','FUN_AF_CAT_0','MED_CAT_0'}
                    if not (expected|{'NU_ANO_CENSO','NO_CATEGORIA','NO_DEPENDENCIA'}).issubset(set(d.columns)):
                        legacy=tabela_legada(book,sheet,top,source['fonte'])
                        if legacy is None:raise ValueError('Cabeçalho não reconhecido: '+filename)
                        d,alias=legacy;aliases.append(alias)
                if d.columns.duplicated().any():raise ValueError('Cabeçalho duplicado: '+filename)
                dep='NO_DEPENDENCIA' if 'NO_DEPENDENCIA' in d else 'REDE'
                if 'NO_CATEGORIA' in d:d=d.loc[d.NO_CATEGORIA.map(normal)=='total']
                rede=d[dep].map(lambda s:re.sub(r'\s*\(\d+\)','',normal(s)).strip())
                estadual=d.loc[rede=='estadual'] if source['fonte']=='ideb' else None
                d=d.loc[rede.isin(['publica','publico'])]
                if source['fonte']=='ideb':
                    title=normal(filename+' '+sheet)
                    stage='ai' if 'iniciais' in title or '(ai)' in title else 'af' if 'finais' in title or '(af)' in title else 'medio' if 'medio' in title or '(em)' in title else None
                    if stage is None:raise ValueError('Etapa do Ideb não reconhecida: '+title)
                    cols={int(c[-4:]):c for c in d if re.fullmatch('VL_OBSERVADO_20[0-9]{2}',c) and 2013<=int(c[-4:])<=source['ano']}
                    # Na divulgação de 2025, Brasil/anos finais tem o cabeçalho
                    # técnico de 2023 vazio. O cabeçalho legível explicita Ideb
                    # 2023. Usa-se esse rótulo oficial, nunca a posição presumida.
                    for h in range(headers[0]):
                        for position,cell in enumerate(top.iloc[h]):
                            match=re.match(r'^IDEB\s*(20\d{2})',str(cell))
                            if not match:continue
                            year=int(match[1]);column=d.columns[position]
                            if 2013<=year<=source['ano'] and year not in cols and column.startswith('UNNAMED:'):
                                cols[year]=column;aliases.append(dict(planilha=sheet,ano=year,cabecalho=str(cell),coluna=column))
                    if not cols:raise ValueError('Colunas do Ideb não encontradas: '+filename)
                    for _,row in d.iterrows():
                        g=geographic(row)
                        if not g:continue
                        for year,col in cols.items():put(g,year,'ideb_'+stage,row[col],source);added+=1
                    if stage=='medio':
                        for _,row in estadual.iterrows():
                            g=geographic(row)
                            if not g:continue
                            for year,col in cols.items():put(g,year,'ideb_medio_estadual',row[col],source);added+=1
                else:
                    fields={}
                    for stage,suffix in [('ai','FUN_AI'),('af','FUN_AF'),('medio','MED')]:
                        if source['fonte']=='rendimento':
                            for n,prefix in [(1,'apr'),(2,'rep'),(3,'aband')]:fields[prefix+'_'+stage]=str(n)+'_CAT_'+suffix
                        else:fields['dist_'+stage]=suffix+'_CAT_0'
                    missing=set(fields.values())-set(d.columns)
                    if missing:raise ValueError('Leiaute não reconhecido: '+filename+' '+str(missing))
                    for _,row in d.iterrows():
                        g=geographic(row)
                        if not g or pd.isna(row.NU_ANO_CENSO):continue
                        year=int(row.NU_ANO_CENSO)
                        if year!=source['ano']:raise ValueError('Ano divergente nas taxas')
                        for id,col in fields.items():put(g,year,id,row[col],source);added+=1
        if not added:raise ValueError('Nenhum resultado público importado: '+str(path))
        if source['fonte']!='ideb' and 'munic' not in source['url'].lower():
            missing={'BR',*NOMES_UF}-groups_seen
            if missing:raise ValueError('Recortes oficiais não reconhecidos: '+path.name+' '+str(missing))
        if source['fonte']=='ideb' and 'ufs' in source.get('url','').lower():
            missing=set(NOMES_UF)-groups_seen
            if missing:raise ValueError('UFs do Ideb não reconhecidas: '+str(missing))
        audit.append(dict(arquivo=path.name,fonte=source['fonte'],sha256=source['sha256'],celulas=added,recortes=sorted(groups_seen),cabecalhos_legiveis=aliases))
        print(f'Indicadores: {path.name} ({added} células oficiais)',flush=True)
    return dict(arquivos=audit,celulas=len(seen),regra='Rede pública; Ideb estadual em medida separada; localização total; Brasil e UF oficiais, sem média municipal')


def ler_indicadores_paralelo(sources,values):
    """Leituras independentes; a junção sequencial recusa resultados conflitantes."""
    def parse(source):
        partial={};audit=ler_indicadores([source],partial)
        return partial,audit
    files=[];keys=set()
    with ThreadPoolExecutor(max_workers=3) as pool:
        for partial,audit in pool.map(parse,sources):
            files.extend(audit['arquivos'])
            for key,record in partial.items():
                target=values.setdefault(key,{})
                for field,v in record.items():
                    if field in target and target[field]!=v:raise ValueError('Resultados oficiais conflitantes na junção: '+str((key,field)))
                    target[field]=v;keys.add((*key,field))
    return dict(arquivos=files,celulas=len(keys),regra='Rede pública; Ideb estadual em medida separada; localização total; Brasil e UF oficiais, sem média municipal')


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--brutos',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    a=p.parse_args();gerar(a.brutos,a.saida)
