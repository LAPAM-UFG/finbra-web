"""Leitura das planilhas oficiais: códigos IBGE canônicos e campos originais.

Preserva vazios. Lê dados em células, sem abrir Excel ou executar fórmulas/macros.
Planilhas agregadas de prestadores regionais nunca viram municípios pela sede.
"""
import argparse,hashlib,json,re,unicodedata,warnings
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import pandas as pd
from assistencia_utils import destino_isolado

warnings.filterwarnings('ignore',category=FutureWarning)
CODE=re.compile(r'^(?:[A-Z]{2,3}\d{3,4}|[A-Z]{2}\d{2}[AB])$')
def normalizar(s):return re.sub(r'[^a-z0-9]','',unicodedata.normalize('NFKD',str(s)).encode('ascii','ignore').decode().lower())
def id_campo(v):
    s=re.sub(r'\s+|\*','',str(v)).upper()
    return s if CODE.fullmatch(s) or s in ['POP_TOT','POP_URB','POP_RURAL'] else None
def inteiro(v):
    try:
        f=float(v);return str(int(f)) if np.isfinite(f) and f==int(f) else ''
    except (ValueError,TypeError):return ''
def numeros(s):
    if pd.api.types.is_numeric_dtype(s):return pd.to_numeric(s,errors='coerce')
    v=s.astype('string').str.strip().replace({'Sim':'1','SIM':'1','Não':'0','NÃO':'0'})
    comma=v.str.contains(',',regex=False,na=False)
    v=v.where(~comma,v.str.replace('.','',regex=False).str.replace(',','.',regex=False))
    return pd.to_numeric(v,errors='coerce')

def ler_arquivo(ref,pasta,cadastro):
    path=pasta/ref['extraido'];records=[];meta=[]
    if hashlib.sha256(path.read_bytes()).hexdigest()!=ref['extraido_sha256']:raise ValueError('Planilha alterada: '+str(path))
    x=pd.ExcelFile(path,engine='calamine')
    for sheet in x.sheet_names:
        if any(w in normalizar(sheet) for w in ['notas','cooperativ','veiculos','reservatori','linear','bacia','tratamentoap','resum']):continue
        head=pd.read_excel(x,sheet_name=sheet,header=None,nrows=32)
        scores=head.map(lambda v:id_campo(v) is not None).sum(axis=1)
        if scores.empty or scores.max()<3:continue
        h=int(scores.idxmax());keys={j:id_campo(v) for j,v in enumerate(head.iloc[h]) if id_campo(v)}
        d=pd.read_excel(x,sheet_name=sheet,header=None,skiprows=h+1)
        if d.empty:continue
        # Coluna geográfica explícita sempre vence o prefixo do prestador local.
        scores_geo=[]
        for j in range(min(10,d.shape[1])):
            vals=d[j].map(inteiro);seven=vals.str.len().eq(7).sum();six=vals.str.len().eq(6).sum()
            names=' '.join(str(v) for v in head.iloc[:h+1,j] if pd.notna(v));label=normalizar(names)
            if 'codigo' not in label and 'cod' not in label:continue
            if 'prestador' in label and 'municip'not in label:continue
            score=seven*2+six
            if score:scores_geo.append((score,j))
        local=False
        if scores_geo:geo=max(scores_geo)[1]
        else:
            # LPu/LPr/LEP: o identificador de oito dígitos contém o município.
            # Não se aplica aos totais regionais e microrregionais.
            n=normalizar(ref['membro'])
            if ref['sistema']!='SNIS' or ref['modulo']!='ae' or not any(t in n for t in ['lpu','lpr','lep']):continue
            geo=0;local=True
        cod=d[geo].map(inteiro)
        if local:cod=cod.where(cod.str.len()!=8,cod.str[:6])
        lookup={str(c):c for c in cadastro}|{str(c//10):c for c in cadastro}
        cod=cod.map(lookup)
        valid=cod.notna()
        if not valid.any():continue
        # O cadastro SINISA contém não participantes, cujos campos não são zeros.
        for j in range(min(16,d.shape[1])):
            labels=' '.join(str(v) for v in head.iloc[:h+1,j] if pd.notna(v));label=normalizar(labels)
            if 'municipioparticipante' in label or 'respondeuaomodulo' in label:
                status=d[j].map(normalizar)
                valid &= status.isin(['sim','participante','1'])
        d=d.loc[valid].copy();cod=cod.loc[valid].astype('int64')
        if d.empty:continue
        prestador=None
        if ref['sistema']=='SNIS' and ref['modulo']=='ae':
            for j in range(min(10,d.shape[1])):
                label=normalizar(' '.join(str(v) for v in head.iloc[:h+1,j] if pd.notna(v)))
                if ('codigodoprestador' in label or 'codigoprestador' in label):prestador=d[j].map(inteiro);break
            if prestador is None and local:prestador=d[geo].map(inteiro)
        # Campos POP_TOT/POP_URB sem código aparecem em resíduos e nos prestadores locais.
        for j in range(d.shape[1]):
            if j in keys:continue
            labels=' '.join(str(v) for v in head.iloc[max(0,h-5):h+1,j] if pd.notna(v));label=normalizar(labels)
            if 'populacaototaldomunicipio' in label or label.endswith('populacaototalhabitante'):keys[j]='POP_TOT'
            elif 'populacaourbanadomunicipio' in label:keys[j]='POP_URB'
        data={'cod_ibge':cod.to_numpy(),'prestador':prestador.to_numpy() if prestador is not None else np.full(len(d),'MUNICIPAL')}
        for j,k in keys.items():
            if j<d.shape[1]:data[k]=numeros(d[j]).to_numpy(dtype='float64',na_value=np.nan)
        frame=pd.DataFrame(data);frame['ano']=ref['ano'];frame['modulo']=ref['modulo'];frame['sistema']=ref['sistema'];frame['origem']=ref['extraido'];frame['folha']=sheet
        records.append(frame)
        meta.append(dict(arquivo=ref['extraido'],membro=ref['membro'],sheet=sheet,header=h,linhas=len(frame),campos=list(keys.values())))
    return records,meta

def preparar(planilhas,cadastro,saida):
    planilhas=Path(planilhas).resolve();saida=destino_isolado(Path(saida),planilhas);saida.mkdir(parents=True,exist_ok=True)
    cad=pd.read_parquet(cadastro);codes=set(int(c) for c in cad.cod_ibge if len(str(int(c)))==7);codes.add(2605459)
    refs=json.loads((planilhas/'indice.json').read_text(encoding='utf-8'))
    selected=[];seen=set()
    for r in refs:
        n=normalizar(r['membro'])
        if r['tipo']!='dados' or not r['extraido'].endswith(('.xls','.xlsx')) or r['modulo']=='gestao':continue
        if r['sistema']=='SNIS' and r['ano']>2022:raise ValueError('SNIS com referência após 2022')
        if r['sistema']=='SNIS' and r['modulo']=='ae' and 'inform'not in n and 'indic'not in n:continue
        if r['sistema']=='SINISA' and r['modulo']in ['agua','esgoto'] and 'basemunicipal'not in n:continue
        # As retificações específicas são aplicadas numa etapa explícita, depois da base.
        if r['sistema']=='SINISA' and r['ano']==2023 and 'retifica' in n and 'basemunicipal'not in n:continue
        identity=(r['sistema'],r['modulo'],r['ano'],r['extraido'])
        if identity not in seen:seen.add(identity);selected.append(r)
    meta=[];files=[]
    for i,r in enumerate(selected,1):
        target=saida/(r['sistema'].lower()+'_'+r['modulo']+'_'+str(r['ano'])+'_'+r['extraido'][:-4]+'.parquet')
        mp=target.with_suffix('.json')
        if target.exists() and mp.exists():meta.extend(json.loads(mp.read_text(encoding='utf-8')));files.append(str(target));continue
        frames,m=ler_arquivo(r,planilhas,codes)
        if frames:
            frame=pd.concat(frames,ignore_index=True);frame.to_parquet(target,index=False,compression='zstd');mp.write_text(json.dumps(m,ensure_ascii=False),encoding='utf-8');files.append(str(target));meta.extend(m)
        if i%50==0:print('Lidos',i,'de',len(selected),flush=True)
    (saida/'indice.json').write_text(json.dumps(dict(arquivos=files,folhas=meta),ensure_ascii=False,indent=2),encoding='utf-8')
    correcoes=[]
    for r in refs:
        if r['sistema']!='SINISA' or r['modulo']!='esgoto' or r['ano']!=2023 or 'GestaoTecnicaEsgoto' not in r['url'] or 'Retifica' not in r['url']:continue
        targets=[4209102] if 'Joinville' in r['url'] else [3147105] if 'Para_de_Minas' in r['url'] else [3170107,3556701]
        frames,_=ler_arquivo(r,planilhas,codes)
        if not frames:raise ValueError('Retificação não pôde ser lida: '+r['url'])
        f=pd.concat(frames,ignore_index=True);f=f[f.cod_ibge.isin(targets)]
        if set(f.cod_ibge)!=set(targets) or f.cod_ibge.duplicated().any():raise ValueError('Recorte inesperado na retificação: '+r['url'])
        target=saida/('retificacao_'+r['extraido'][:-4]+'.parquet');f.to_parquet(target,index=False,compression='zstd')
        correcoes.append({**r,'normalizado':str(target),'municipios':targets})
    (saida/'retificacoes.json').write_text(json.dumps(correcoes,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Normalizados',len(files),'arquivos;',sum(x['linhas'] for x in meta),'linhas brutas',flush=True)
    return meta

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--planilhas',required=True);p.add_argument('--cadastro',required=True);p.add_argument('--saida',required=True);a=p.parse_args();preparar(a.planilhas,a.cadastro,a.saida)
