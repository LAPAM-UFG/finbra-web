"""Painel pronto de saneamento, 2013+: candidato isolado, sem alterar as fontes.

Cada cidade, UF e Brasil recebe um registro independente no arquivo de abertura.
Percentuais agregados são razões de somas no mesmo conjunto válido de municípios.
"""
import argparse,ast,copy,hashlib,json,math,re
from datetime import datetime,timezone
from pathlib import Path
import duckdb
import numpy as np
import pandas as pd
from assistencia_utils import destino_isolado
from saneamento_indicadores import INDICADORES,CONDICOES

def serial(v):return json.dumps(v,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode('utf-8')
def digest(b):return hashlib.sha256(b).hexdigest()
def nome_campo(s):return '"'+s.replace('"','""')+'"'
def qs(s):return "'"+str(s).replace("'","''")+"'"

def expressao(frame,texto):
    """Aritmética de componentes; nulos se propagam. | só é coalescência explícita."""
    def parse(s):
        def run(n):
            if isinstance(n,ast.Expression):return run(n.body)
            if isinstance(n,ast.Name):return frame[n.id] if n.id in frame else pd.Series(np.nan,index=frame.index)
            if isinstance(n,ast.Constant) and isinstance(n.value,(int,float)):return pd.Series(float(n.value),index=frame.index)
            if isinstance(n,ast.BinOp):
                a,b=run(n.left),run(n.right)
                if isinstance(n.op,ast.Add):return a+b
                if isinstance(n.op,ast.Sub):return a-b
                if isinstance(n.op,ast.Mult):return a*b
            raise ValueError('Expressão não permitida: '+texto)
        return run(ast.parse(s,mode='eval'))
    pieces=texto.split('|');out=parse(pieces[0])
    for p in pieces[1:]:out=out.fillna(parse(p))
    return out

def referencia(dest,prefix,data,ext='json'):
    raw=serial(data) if not isinstance(data,bytes) else data;h=digest(raw);p=dest/(prefix+'_'+h[:16]+'.'+ext);p.write_bytes(raw)
    return dict(caminho='gold/saneamento/'+p.name,bytes=len(raw),sha256=h)

def preparar_provedores(normalizado,work):
    ix=json.loads((normalizado/'indice.json').read_text(encoding='utf-8'));files=ix['arquivos']
    assinatura=digest((normalizado/'indice.json').read_bytes()+Path(__file__).with_name('saneamento_ler.py').read_bytes()+b'co02a-prioridade-v1')
    needed={'GE12A','GE12B','GE06A','GE06B','POP_TOT','POP_URB','DFE0001','DFE0002'}
    for i in INDICADORES:
        for s in i['snis']+i['sinisa']:needed.update(re.findall('[A-Z][A-Z0-9_]+',s))
        needed.update(c for c in i['oficial'] if c)
    marker=work/'provedores_ok.json'
    if marker.exists():
        cache=json.loads(marker.read_text(encoding='utf-8'))
        if cache.get('assinatura_fonte')==assinatura and needed.issubset(set(cache['campos'])|set(cache.get('ausentes',[])))and all((work/n).exists()and digest((work/n).read_bytes())==h for n,h in cache['arquivos'].items()):return cache['campos']
    db=duckdb.connect();db.execute("SET threads=4; SET memory_limit='3GB'")
    db.execute('CREATE VIEW bruto_externo AS SELECT * FROM read_parquet(['+','.join(qs(f) for f in files)+'],union_by_name=true)')
    allcols={x[0] for x in db.execute('DESCRIBE bruto_externo').fetchall()};needed=set()
    for i in INDICADORES:
        for s in i['snis']+i['sinisa']:needed.update(re.findall('[A-Z][A-Z0-9_]+',s))
        needed.update(c for c in i['oficial'] if c)
    needed.update(['GE12A','GE12B','GE06A','GE06B','POP_TOT','POP_URB','DFE0001','DFE0002'])
    fields=sorted(needed & allcols)
    # Materializa uma única vez. Evita reabrir centenas de XLS normalizados em
    # cada checagem de ano/módulo, principalmente quando a origem está num HD.
    projection=[("CASE WHEN sistema='SNIS' AND modulo='rs' AND ano=2013 AND lower(folha)='co02b' THEN NULL ELSE CO119 END AS CO119" if c=='CO119' else nome_campo(c)) for c in fields]
    # No livro RS 2013 a Co02a contém a massa com casas decimais; a Co02b a
    # repete truncada para quatro capitais. Usa-se a tabela primária de massa.
    db.execute('CREATE TABLE bruto AS SELECT cod_ibge,prestador,sistema,modulo,ano,'+','.join(projection)+' FROM bruto_externo')
    # Campos repetidos em folhas de informações/indicadores precisam concordar.
    conflict=[]
    for system,module,y in db.execute('SELECT DISTINCT sistema,modulo,ano FROM bruto ORDER BY 1,2,3').fetchall():
        where='sistema='+qs(system)+' AND modulo='+qs(module)+' AND ano='+str(y)
        cols=['cod_ibge','prestador']
        q='SELECT '+','.join(cols)+','+','.join('max('+nome_campo(c)+') AS '+nome_campo(c) for c in fields)+' FROM bruto WHERE '+where+' GROUP BY '+','.join(cols)
        checks=','.join('count(DISTINCT '+nome_campo(c)+') AS '+nome_campo(c) for c in fields)
        dup=db.execute('SELECT '+','.join(cols)+','+checks+' FROM bruto WHERE '+where+' GROUP BY '+','.join(cols)).df()
        for c in fields:
            bad=dup[c]>1
            if bad.any():conflict.append(dict(sistema=system,modulo=module,ano=y,campo=c,chaves=dup.loc[bad,cols].head(12).to_dict('records'),quantidade=int(bad.sum())))
        frame=db.execute(q).df();frame['sistema']=system;frame['modulo']=module;frame['ano']=y
        frame.to_parquet(work/(system.lower()+'_'+module+'_'+str(y)+'.parquet'),index=False,compression='zstd')
        print('Conferido',system,module,y,len(frame),'linhas',flush=True)
    (work/'conflitos.json').write_bytes(serial(conflict));db.close()
    if conflict:raise ValueError('Campos conflitantes entre planilhas: revisar '+str(work/'conflitos.json'))
    objects={p.name:digest(p.read_bytes()) for p in work.glob('*.parquet') if re.fullmatch(r'(snis|sinisa)_[a-z]+_20\d{2}',p.stem)}
    marker.write_bytes(serial(dict(assinatura_fonte=assinatura,campos=fields,ausentes=sorted(needed-allcols),arquivos=objects)))
    return fields

def cobertura_campos(normalizado):
    """Calendário estrutural dos formulários, distinto de respostas preenchidas."""
    files=json.loads((normalizado/'indice.json').read_text(encoding='utf-8'))['arquivos'];out={}
    for file in files:
        p=Path(file);match=re.match(r'(snis|sinisa)_([a-z]+)_(20\d{2})_',p.name)
        if not match:raise ValueError('Normalizado sem identificação de sistema, módulo e ano')
        key=(match[1].upper(),match[2],int(match[3]));fields=out.setdefault(key,set())
        for sheet in json.loads(p.with_suffix('.json').read_text(encoding='utf-8')):fields.update(sheet['campos'])
    return out

def expressao_disponivel(texto,fields):
    return any(set(re.findall('[A-Z][A-Z0-9_]+',part)).issubset(fields)for part in texto.split('|'))

def celulas(frame,ind,sistema):
    spec=ind['snis'] if sistema=='SNIS' else ind['sinisa'];n=expressao(frame,spec[0]);d=expressao(frame,spec[1]) if len(spec)>1 else pd.Series(1.,index=frame.index)
    cond=np.select([n.isna(),d.isna(),d.eq(0)],[1,2,3],default=0).astype('int8')
    val=n if len(spec)==1 else n/d.replace(0,np.nan)*ind['fator']
    bad=n.lt(0)|d.lt(0)|(val.lt(0))|(val.gt(100) if ind['unidade']=='percentual' else False)
    official=ind['oficial'][0 if sistema=='SNIS' else 1]
    if official and official in frame and 'provedores' in frame:
        # Divergência além do arredondamento: preserva componentes, sinaliza a
        # inconsistência da fonte e não escolhe silenciosamente um dos valores.
        bad |= frame.provedores.eq(1)&frame[official].notna()&val.notna()&(val-frame[official]).abs().gt(.1)
    cond=np.where(bad,4,cond).astype('int8');val=val.where(cond==0)
    return pd.DataFrame(dict(numerador=n,denominador=d,valor=val,condicao=cond),index=frame.index)

def municipio(frame):
    fields=[c for c in frame if c not in ['cod_ibge','prestador','sistema','modulo','ano']]
    pop={'GE12A','GE12B','GE06A','GE06B','POP_TOT','POP_URB','DFE0001','DFE0002'}
    # População residente se repete em cada prestador. Nunca somar esse denominador.
    sums=frame.groupby('cod_ibge')[fields].sum(min_count=1)
    for c in pop & set(fields):sums[c]=frame.groupby('cod_ibge')[c].max()
    sums['provedores']=frame.groupby('cod_ibge').size()
    # Denominadores do mesmo município nas folhas água/esgoto são alternativas,
    # não parcelas. O código municipal, e não a sede do prestador, define o recorte.
    for a,b,p in [('GE12A','GE12B','POP_TOT'),('GE06A','GE06B','POP_URB')]:
        cols=[c for c in [a,b,p] if c in sums]
        if cols:
            resident=sums[cols].max(axis=1);sums[a]=resident;sums[b]=resident;sums[p]=resident
    return sums

def celulas_municipais(raw,frame,ind,sistema):
    if ind.get('parear_numerador'):
        spec=ind['snis'] if sistema=='SNIS' else ind['sinisa'];n=expressao(raw,spec[0])
        codes=set(re.findall('[A-Z][A-Z0-9_]+',spec[0]))&set(raw)
        ativos=raw[list(codes)].notna().any(axis=1) if codes else pd.Series(False,index=raw.index)
        x=pd.DataFrame({'cod_ibge':raw.cod_ibge,'n':n}).loc[ativos];g=x.groupby('cod_ibge')
        paired=g.n.sum(min_count=1);paired=paired.where(g.n.count().eq(g.size()))
        f=frame.copy();f['NUM_PAREADO']=paired.reindex(frame.index);invalid_d=pd.Series(False,index=frame.index)
        config=copy.deepcopy(ind);config['snis' if sistema=='SNIS' else 'sinisa']=['NUM_PAREADO',*spec[1:]]
        if ind['id'] in ['agua_rural_pct','esgoto_rural_pct']:
            # Calcula o residente rural dentro de cada registro antes de obter
            # o máximo municipal. Não subtrai totais/urbanos de prestadores distintos.
            local=raw.copy()
            for a,b,p in [('GE12A','GE12B','POP_TOT'),('GE06A','GE06B','POP_URB')]:
                cols=[c for c in [a,b,p]if c in local]
                if cols:
                    resident=local[cols].max(axis=1);local[a]=resident;local[b]=resident;local[p]=resident
            resident_rural=expressao(local,spec[1]);denominator=resident_rural.groupby(raw.cod_ibge).max()
            invalid_d=resident_rural.lt(0).groupby(raw.cod_ibge).any().reindex(frame.index,fill_value=False)
            f['DEN_RESIDENTE']=denominator.reindex(frame.index)
            config['snis' if sistema=='SNIS' else 'sinisa']=['NUM_PAREADO','DEN_RESIDENTE']
        out=celulas(f,config,sistema)
        invalid=pd.Series(n.lt(0).to_numpy(),index=raw.cod_ibge).groupby(level=0).any().reindex(frame.index,fill_value=False)
        out.loc[invalid|invalid_d,'condicao']=4;out.loc[invalid|invalid_d,'valor']=np.nan
        return out
    out=celulas(frame,ind,sistema)
    if ind['id'] not in ['agua_perdas_pct','esgoto_tratamento_pct'] and not ind.get('parear_componentes'):return out
    # Fórmulas físicas precisam dos componentes dos mesmos prestadores. Somar
    # cada coluna ignorando nulos poderia combinar produção de A e consumo de B.
    spec=ind['snis'] if sistema=='SNIS' else ind['sinisa']
    n=expressao(raw,spec[0]);d=expressao(raw,spec[1])
    codes=set(re.findall('[A-Z][A-Z0-9_]+',' '.join(spec)))&set(raw)
    ativos=raw[list(codes)].notna().any(axis=1)
    x=pd.DataFrame({'cod_ibge':raw.cod_ibge,'n':n,'d':d}).loc[ativos]
    g=x.groupby('cod_ibge');q=g[['n','d']].sum(min_count=1)
    for col in ['n','d']:q.loc[g[col].count().ne(g.size()),col]=np.nan
    q=q.reindex(frame.index);out['numerador']=q.n;out['denominador']=q.d
    cond=np.select([q.n.isna(),q.d.isna(),q.d.eq(0)],[1,2,3],default=0)
    v=q.n/q.d.replace(0,np.nan)*ind['fator']
    bad=q.n.lt(0)|q.d.lt(0)|v.lt(0)|v.gt(100)
    bad_provider=n.lt(0)|d.lt(0)
    if ind.get('parear_componentes')and ind['unidade']=='percentual':bad_provider|=n.gt(d)
    invalid=pd.Series(bad_provider.to_numpy(),index=raw.cod_ibge).groupby(level=0).any().reindex(frame.index,fill_value=False)
    # Mantém também inconsistências já detectadas no índice oficial municipal.
    out['condicao']=np.where(bad|invalid|out.condicao.eq(4),4,cond).astype('int8');out['valor']=v.where(out.condicao.eq(0))
    return out

def aplicar_retificacoes(frame,normalizado):
    source=normalizado/'retificacoes.json'
    if not source.exists():raise ValueError('Conferir as retificações oficiais de esgoto 2023 antes de gerar o painel')
    patches=json.loads(source.read_text(encoding='utf-8'));changed=[]
    for p in patches:
        r=pd.read_parquet(p['normalizado'])
        for _,row in r.iterrows():
            code=int(row.cod_ibge);mask=frame.cod_ibge.eq(code)
            if mask.sum()>1:raise ValueError('Retificação exige uma linha municipal consolidada: '+str(code))
            # Vinhedo consta da retificação e não da base municipal original.
            # A retificação é uma resposta oficial completa, inclusive DFE.
            if not mask.any():
                frame=pd.concat([frame,pd.DataFrame([dict(cod_ibge=code,prestador='MUNICIPAL',sistema='SINISA',modulo='esgoto',ano=2023)])],ignore_index=True)
                mask=frame.cod_ibge.eq(code)
            cols=[c for c in r if re.fullmatch(r'(GTE|DFE)\d{4}',c)]
            for c in cols:frame.loc[mask,c]=row[c]
            for c in frame:
                if re.fullmatch(r'IES\d{4}',c):frame.loc[mask,c]=np.nan
            changed.append(dict(cod_ibge=code,url=p['url'],campos=cols))
    return frame,changed

def preencher_condicoes(wide,indicadores):
    """Distingue município sem resposta de ano sem informação na fonte."""
    for i in indicadores:
        col=i['variavel']+'_cond';missing=wide[col].isna()|wide[col].eq(5)
        fallback=pd.Series(np.where(wide.ano.isin(i['anos']),1,5),index=wide.index)
        wide[col]=wide[col].where(~missing,fallback).astype('int8')
    return wide

def gerar(normalizado,cadastro,saida):
    normalizado=Path(normalizado).resolve();saida=destino_isolado(Path(saida),normalizado);work=saida/'trabalho_saneamento';dest=saida/'gold/saneamento';work.mkdir(parents=True,exist_ok=True);dest.mkdir(parents=True,exist_ok=True)
    preparar_provedores(normalizado,work);schemas=cobertura_campos(normalizado)
    cad=pd.read_parquet(cadastro);cad=cad[cad.cod_ibge.astype(str).str.len()==7][['cod_ibge','nome','uf']].drop_duplicates('cod_ibge')
    if not (cad.cod_ibge==2605459).any():cad=pd.concat([cad,pd.DataFrame([dict(cod_ibge=2605459,nome='Fernando de Noronha',uf='PE')])],ignore_index=True)
    cad= cad.sort_values('cod_ibge').reset_index(drop=True);cad['cod_ibge']=cad.cod_ibge.astype('int64')
    groups={str(int(r.cod_ibge)):dict(grupo=str(int(r.cod_ibge)),nome=str(r.nome),uf=str(r.uf),nivel='M',cod_ibge=int(r.cod_ibge)) for r in cad.itertuples()}
    groups['BR']=dict(grupo='BR',nome='Brasil',uf=None,nivel='BR',cod_ibge=None)
    for uf in sorted(cad.uf.unique()):groups[uf]=dict(grupo=uf,nome='Municípios de '+uf,uf=uf,nivel='UF',cod_ibge=None)
    years=sorted({y for _,_,y in schemas if y>=2013})
    if not years or years!=list(range(2013,max(years)+1)):raise ValueError('Referências anuais de saneamento incompletas')
    allrows=[];audits=[];metricmeta=copy.deepcopy(INDICADORES)
    for y in years:
        system='SNIS' if y<=2022 else 'SINISA';moduleframes={};providerframes={}
        for mod in ['ae','agua','esgoto','rs','ap']:
            p=work/(system.lower()+'_'+mod+'_'+str(y)+'.parquet')
            if p.exists():
                raw=pd.read_parquet(p)
                if system=='SINISA' and y==2023 and mod=='esgoto':
                    raw,changes=aplicar_retificacoes(raw,normalizado);(work/'retificacoes_aplicadas.json').write_bytes(serial(changes))
                moduleframes[mod]=municipio(raw);providerframes[mod]=raw
        for idx,i in enumerate(INDICADORES):
            if not i['snis' if system=='SNIS' else 'sinisa'] or (system=='SINISA'and y<i.get('sinisa_desde',2023)):continue
            mod='ae' if y<=2022 and i['tema']in ['agua','esgoto'] else i['tema'] if i['tema']in ['agua','esgoto'] else 'rs' if i['tema']=='residuos' else 'ap'
            f=moduleframes.get(mod);available=f is not None
            if not available:continue
            if idx>=28 and not all(expressao_disponivel(expr,schemas.get((system,mod,y),set()))for expr in i['snis'if system=='SNIS'else'sinisa']):continue
            cells=celulas_municipais(providerframes[mod],f,i,system);cells['cod_ibge']=cells.index;cells=cells.reset_index(drop=True).merge(cad,on='cod_ibge',how='inner');cells['grupo']=cells.cod_ibge.astype(str);cells['nivel']='M';cells['municipios_com_dado']=cells.valor.notna().astype(int);cells['municipios_cadastro']=1
            # Comparação independente com os indicadores publicados: não participa da conta.
            official=i['oficial'][0 if y<=2022 else 1]
            if official and official in f:
                single=f.provedores.eq(1);a=celulas(f,i,system);b=f[official]
                pairs=a.valor.notna()&b.notna()&single
                if system=='SINISA' and y==2023 and i['tema']=='esgoto':pairs &= ~f.index.isin([3170107,3556701,4209102,3147105])
                if pairs.any():
                    delta=(a.loc[pairs,'valor']-b[pairs]).abs();audits.append(dict(ano=y,indicador=i['id'],codigo=official,comparados=int(pairs.sum()),divergencias=int((delta>0.1).sum()),max_diferenca=float(delta.max())))
            for group,subset in [('BR',cells),*[(uf,cells[cells.uf==uf]) for uf in sorted(cad.uf.unique())]]:
                valid=subset.condicao.eq(0)&subset.numerador.notna()&subset.denominador.notna()
                v=subset.loc[valid];n=float(v.numerador.sum()) if len(v) else None;d=float(v.denominador.sum()) if len(v) else None
                value=n if i['regra_agregado']=='soma' else n/d*i['fator'] if n is not None and d else None
                total=len(cad) if group=='BR' else int(cad.uf.eq(group).sum())
                row=dict(cod_ibge=None,nome=groups[group]['nome'],uf=groups[group]['uf'],grupo=group,nivel=groups[group]['nivel'],numerador=n,denominador=d,valor=value,condicao=0 if value is not None else 1,municipios_com_dado=len(v),municipios_cadastro=total)
                cells=pd.concat([cells,pd.DataFrame([row])],ignore_index=True)
            cells['ano']=y;cells['indicador']=i['id'];cells['indice']=idx;cells['unidade']=i['unidade'];cells['sistema']=system
            allrows.append(cells)
        print('Calculado',y,flush=True)
    long=pd.concat(allrows,ignore_index=True);long['cod_ibge']=long.cod_ibge.astype('Int64');long['ano']=long.ano.astype('int32');long['indice']=long.indice.astype('int16');long['condicao']=long.condicao.astype('int8')
    assert not long.duplicated(['grupo','ano','indicador']).any()
    print('Preparando Parquet e pacotes territoriais',flush=True)
    for idx,i in enumerate(metricmeta):
        rows=long.loc[long.indicador.eq(i['id'])]
        i['anos']=sorted(int(y)for y in (rows if idx>=28 else rows.loc[rows.valor.notna()]).ano.unique())
    queryfile=work/'consulta.parquet';long.to_parquet(queryfile,index=False,compression='zstd');queryref=referencia(dest,'consulta',queryfile.read_bytes(),'parquet')
    metadata_cols=['cod_ibge','nome','uf'];wide=long[long.nivel=='M'].pivot(index=[*metadata_cols,'ano'],columns='indicador',values='valor').rename(columns={i['id']:i['variavel'] for i in INDICADORES})
    statuses=long[long.nivel=='M'].pivot(index=[*metadata_cols,'ano'],columns='indicador',values='condicao').rename(columns={i['id']:i['variavel']+'_cond' for i in INDICADORES})
    wide=wide.join(statuses).reset_index();wide['cod_ibge']=wide.cod_ibge.astype('int64');wide['ano']=wide.ano.astype('int32');wide['esfera']='M';wide['municipio_especial']=wide.cod_ibge.isin([2605459,5300108]).astype(int)
    # Anos fora da cobertura são identificados, não interpolados nem preenchidos com zero.
    wide=preencher_condicoes(wide,metricmeta)
    wp=work/'municipios.parquet';wide.to_parquet(wp,index=False,compression='zstd');wref=referencia(dest,'municipios',wp.read_bytes(),'parquet')
    archive=bytearray();ordered=long.sort_values(['grupo','ano','indice']);parts=ordered.groupby('grupo',sort=False).indices;territories=[]
    allvals=ordered[['ano','indice','valor','numerador','denominador','municipios_com_dado','municipios_cadastro','condicao']].to_numpy()
    for key,ter in groups.items():
        if key in parts:
            vals=allvals[parts[key]].tolist()
            rows=[[None if pd.isna(v) else int(v) if j in [0,1,5,6,7] else float(v) for j,v in enumerate(row)] for row in vals]
        else:rows=[]
        b=serial(dict(grupo=key,linhas=rows))+b'\n';ter['trecho']=[len(archive),len(b),digest(b)];archive.extend(b);territories.append(ter)
    aref=referencia(dest,'territorios',bytes(archive),'ndjson')
    municipais={}
    for uf in sorted(cad.uf.unique()):municipais[uf]=referencia(dest,'indice_'+uf.lower(),[t for t in territories if t['nivel']=='M'and t['uf']==uf])
    cadastroref=referencia(dest,'cadastro',[[str(int(r.cod_ibge)),str(r.nome),str(r.uf)] for r in cad.itertuples()])
    print('Pacotes territoriais prontos; preparando rankings',flush=True)
    ranks={}
    for (year,id),frame in long[(long.nivel=='M')&long.valor.notna()&long.condicao.eq(0)].groupby(['ano','indicador']):
        rows=[[int(r.cod_ibge),str(r.nome),str(r.uf),float(r.valor),int(r.condicao)] for r in frame.itertuples()]
        ranks[id+':'+str(year)]=referencia(dest,'ranking_'+id+'_'+str(year),dict(ano=int(year),indicador=id,linhas=rows))
    # A abertura conserva as referências dos 28 indicadores originais. A lista
    # ampliada é buscada só quando a comparação de uma medida nova é aberta.
    rankref=referencia(dest,'catalogo_rankings',ranks)
    original={i['id'] for i in INDICADORES[:28]};initialranks={k:v for k,v in ranks.items() if k.rsplit(':',1)[0] in original}
    fontes=json.loads(Path(__file__).with_name('saneamento_fontes.json').read_text(encoding='utf-8'))
    notes=['Dados autodeclarados por prestadores e gestores ao Ministério das Cidades. Não constituem uma avaliação da qualidade da gestão.',
      'SNIS: referências 2013–2022. SINISA: referências 2023–2024. O ano mostrado é o dos dados; a publicação pode ocorrer depois. Há mudanças de conceitos, formulários e cobertura em 2023. As linhas históricas permanecem separadas.',
      'Contagens são somas observadas. Em municípios com mais de um prestador, somam-se os componentes dos prestadores; população residente repetida nas folhas é considerada uma única vez. Totais de sedes e totais de prestadores regionais não são atribuídos à sede como se fossem dados municipais.',
      'UF e Brasil são agregados calculados pelo LAPAM a partir dos municípios com componentes válidos, não médias de percentuais nem estimativas para quem não respondeu. O numerador e o denominador de cada percentual usam os mesmos municípios e o mesmo ano. As coberturas podem variar entre indicadores.',
      'Valores negativos ou percentuais fora de 0–100 não são transformados em indicadores válidos. Os componentes e a condição ficam preservados no Parquet detalhado. Denominador zero produz indicador indefinido, mesmo quando o numerador é zero.',
      'Os percentuais são recalculados dos componentes publicados. Quando o índice publicado contradiz esses componentes em mais de 0,1 ponto percentual, a medida recebe a condição de inconsistência na origem. As retificações oficiais de esgoto de 2023 são aplicadas antes do cálculo.',
      'O cadastro territorial é atual e inclui Brasília e Fernando de Noronha. A contagem de municípios no cadastro não substitui o universo histórico de participantes de cada levantamento. Município sem registro no período não recebe valores de sua UF ou do Brasil.',
      'A série de drenagem começa em 2015 e não tem observações em 2016. Nenhum ano sem pesquisa é interpolado. Atendimento com rede não inclui automaticamente soluções alternativas individuais.',
      'Saneamento tem arquivo temático próprio desde 2013, com valores e condições dos dados. A seleção principal de 297 indicadores dos demais temas é preservada.']
    meta=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=years,indicadores=metricmeta,grupos=[t for t in territories if t['nivel']!='M'],municipios=municipais,cadastro=cadastroref,arquivo=aref,rankings=initialranks,catalogo_rankings=rankref,consulta=queryref,parquet=wref,fontes=[dict(nome=r['titulo'],url=r['url'],ano=r['ano'],modulo=r['modulo']) for r in fontes if r['tipo']=='dados'],notas=notes)
    (dest/'manifesto.json').write_bytes(serial(meta));(work/'comparacoes_oficiais.json').write_bytes(serial(audits));(work/'resumo.json').write_bytes(serial(dict(linhas=len(long),municipios=len(cad),indicadores=len(metricmeta),arquivo_bytes=aref['bytes'],comparacoes=audits)))
    print('CANDIDATO',len(long),'observações;',len(metricmeta),'indicadores;',aref['bytes'],'bytes de abertura',flush=True)
    return meta

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--normalizado',required=True);p.add_argument('--cadastro',required=True);p.add_argument('--saida',required=True);a=p.parse_args();gerar(a.normalizado,a.cadastro,a.saida)
