"""Retratos territoriais leves de todas as séries publicadas, sem recalcular agregações.

Lê uma edição fixada por SHA-256, escreve somente candidato novo. As séries
completas continuam nos objetos imutáveis originais e só são lidas sob demanda.
"""
import argparse, gzip, hashlib, json, math
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path


def compacto(v):
    return json.dumps(v, ensure_ascii=False, allow_nan=False, separators=(',', ':')).encode()


def sha(b): return hashlib.sha256(b).hexdigest()


def validar_destino(origem, saida, arquivos=()):
    origem, saida = Path(origem).resolve(), Path(saida).resolve()
    if origem == saida or origem.is_relative_to(saida) or saida.is_relative_to(origem):
        raise ValueError('Destino sobreposto à origem')
    if any(Path(p).resolve().is_relative_to(saida) for p in arquivos):
        raise ValueError('Destino contém um arquivo de origem')
    if saida.exists() and any(saida.iterdir()):
        raise ValueError('Use um candidato novo e vazio')
    return saida


def celula(s, k, agregado=False):
    c, q = s['c'][k], s['q'][k]
    vazio = agregado and q == 0 and c != 22
    return [s['v'][k], None if vazio else s['n'][k], None if vazio else s['d'][k],
            c, q, (s.get('r') or [None] * len(s['v']))[k] if not vazio else None]


def retrato(i, s, agregado=False):
    """Última observação local, inclusive ressalva identificada; nunca transforma falta em zero."""
    pp = i['periodos']
    if not pp: return None
    limite = max(i.get('periodos_com_valor') or pp)
    ks = [k for k, p in enumerate(pp) if p <= limite]
    observado = s.get('com_ressalvas', s)
    validos = [k for k in ks if observado['v'][k] is not None or
               (observado.get('r') or [None] * len(pp))[k] is not None]
    k = (validos or ks)[-1]
    base = celula(s, k, agregado)
    alt = celula(observado, k, agregado)
    return [pp[k], *base, *([alt] if alt != base else [])]


def extras_definicoes(anos):
    out = []
    def adicionar(id, nome, en, area, unidade, unidade_en, formato, descricao, descricao_en, **extra):
        ibge=dict(nome='IBGE · população',url='https://sidra.ibge.gov.br/tabela/6579')
        pib=dict(nome='IBGE · PIB municipal',url='https://sidra.ibge.gov.br/tabela/5938')
        rais=dict(nome='MTE · RAIS',url='https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho')
        cgu=dict(nome='CGU · pagamentos',url='https://portaldatransparencia.gov.br')
        fontes=([ibge] if id=='rx_populacao' else [pib] if id=='rx_pib' else [pib,ibge] if id=='rx_pib_hab' else
                [rais] if id=='rx_massa_rais' else [cgu,rais] if id.endswith('_rais') else [cgu,pib] if id.endswith('_pib') else [cgu,ibge])
        out.append(dict(id=id, nome=nome, nome_en=en, area=area, catalogo='referencias', indice=len(out), rede='todas',
                        tema='População e economia' if area != 'assistencia' else 'Comparações dos pagamentos',
                        tema_en='Population and economy' if area != 'assistencia' else 'Payment comparisons',
                        unidade=unidade, unidade_en=unidade_en, formato=formato, descricao=descricao, descricao_en=descricao_en,
                        periodos=anos, frequencia='anual', metodo_referencia='razao', normalizacao=descricao,
                        normalizacao_en=descricao_en, fator=1, ranking=False, fonte_nome='; '.join(f['nome'] for f in fontes),
                        fontes=fontes, **extra))
    adicionar('rx_populacao','População residente de referência','Reference resident population','financas','habitantes','residents','numero',
              'População de referência do IBGE. Em 2023 usa o Censo 2022.','IBGE reference population. The 2022 Census is used for 2023.')
    adicionar('rx_pib','PIB nominal','Nominal GDP','financas','R$','R$','moeda','PIB nominal do próprio ano.','Nominal GDP for the observation year.')
    adicionar('rx_pib_hab','PIB nominal por habitante','Nominal GDP per resident','financas','R$ por habitante','R$ per resident','moeda',
              'PIB dividido pela população de referência. Em 2023 usa o Censo 2022. Valores nominais.','GDP divided by reference population. For 2023 uses the 2022 Census. Nominal amounts.')
    adicionar('rx_massa_rais','Massa salarial formal anual estimada','Estimated annual formal payroll','trabalho','R$','R$','moeda',
              'ESTIMATIVA: massa nominal de dezembro × 12, sem 13º imputado. Local do estabelecimento; confira a cobertura da remuneração.',
              'ESTIMATE: nominal December payroll × 12, without an imputed 13th salary. Employer location; check reported-pay coverage.')
    for programa, nome, en in [('pbf','Bolsa Família / Auxílio Brasil','Bolsa Família / Auxílio Brasil'),('bpc','BPC','BPC'),('total','Bolsa Família + BPC','Bolsa Família + BPC')]:
        for base, sufixo, en_suf, unidade, formato in [('populacao','por habitante','per resident','R$ por habitante','moeda'),('rais','/ massa salarial estimada','/ estimated formal payroll','%','percentual'),('pib','/ PIB','/ GDP','%','percentual')]:
            nota = 'Pagamentos nominais de 12 meses válidos. ' + ('ESTIMATIVA: denominador = massa de dezembro × 12, sem 13º imputado.' if base=='rais' else 'Denominador do mesmo ano; população de 2023 usa o Censo 2022.')
            adicionar('rx_'+programa+'_'+base, nome+' '+sufixo, en+' '+en_suf,'assistencia',unidade,'R$ per resident' if base=='populacao' else '%',formato,
                      nota,'Nominal payments over 12 valid months. '+('ESTIMATE: denominator = December payroll × 12, with no imputed 13th salary.' if base=='rais' else 'Same-year denominator; 2023 population uses the 2022 Census.'))
    return out


def extras_series(linhas):
    out = [dict(v=[],n=[],d=[],c=[],q=[],r=[]) for _ in range(13)]
    for a in linhas:
        ano,pib,pbf,bpc,mp,mB,pop,massa,nrem,ativos,bp = a
        valores = [(pop,pop,1),(pib,pib,1),(pib/pop if pib is not None and pop and pop>0 else None,pib,pop),(massa,massa,1)]
        conds = [0 if x[0] is not None else 3 for x in valores]
        for pago, meses in [(pbf,mp),(bpc,mB),(pbf+bpc if pbf is not None and bpc is not None else None,min(mp,mB))]:
            for base,fator in [(pop,1),(massa,100),(pib,100)]:
                c = 2 if not meses else 11 if meses != 12 or pago is None else 3 if base is None else 4 if base == 0 else 0
                valores.append((pago/base*fator if c==0 else None,pago,base));conds.append(c)
        for s,(v,n,d),c in zip(out,valores,conds):
            s['v'].append(v);s['n'].append(n);s['d'].append(d);s['c'].append(1 if v==0 else c)
            s['q'].append(0 if v is None else 1);s['r'].append(None)
    return out


def gerar(fontes, destino):
    fontes = Path(fontes).resolve()
    prov = json.loads((fontes/'proveniencia.json').read_bytes())['arquivos']
    paths = {k: Path(v.get('local', fontes/k)).resolve() for k,v in prov.items()}
    destino = validar_destino(fontes,destino,paths.values())
    for key,p in paths.items():
        with p.open('rb') as f: digest = hashlib.file_digest(f,'sha256').hexdigest()
        assert digest==prov[key]['sha256'] and p.stat().st_size==prov[key]['bytes'],key
    def ler(key): return json.loads(paths[key].read_bytes())
    origem=ler('gold/comparacoes/manifesto.json');geo=ler(origem['geografia']['caminho'])
    cats={key:ler(ref['caminho']) for key,ref in origem['catalogos'].items()}
    if 'agropecuaria_todas'in cats and 'gold/agropecuaria/manifesto.json'not in paths:
        raise ValueError('A edição inclui Agropecuária: fixe também seu manifesto, catálogo, índices e séries originais.')
    if 'mobilidade_todas'in cats and 'gold/mobilidade/manifesto.json'not in paths:
        raise ValueError('A edição inclui Mobilidade: fixe também suas séries originais.')
    econ=ler('gold/assistencia/referencias_manifesto.json')
    defs=[];indices={};arquivos={};catalogos={}
    for key,cat in cats.items():
        catalogos[key]=dict(area=cat['area'],rede=cat['rede'],ref=origem['catalogos'][key])
        indices[key]={u:ler(ref['caminho']) for u,ref in cat['indices'].items()}
        arquivos[key]=paths[next(iter(indices[key].values()))['arquivo']['caminho']]
        for n,i in enumerate(cat['indicadores']):
            defs.append({k:v for k,v in dict(i,area=cat['area'],rede=cat['rede'],catalogo=key,indice=n).items() if k!='indice_lista'})
    extra=extras_definicoes(econ['anos']);defs+=extra
    # PAM/PPM preserva todas as medidas originais no retrato, além das razões
    # comparáveis. Totais originais têm série própria e não geram comparação
    # absoluta com territórios de tamanhos diferentes.
    agro=None;agro_indices={};agro_paths={};agro_defs=[]
    if 'gold/agropecuaria/manifesto.json' in paths:
        am=ler('gold/agropecuaria/manifesto.json')
        ac=json.loads(gzip.decompress(paths[am['catalogo']['caminho']].read_bytes()))
        agro=dict(anos=am['anos'],indices=am['indices'],indicadores=[i['id']for i in ac['indicadores']],edicao_sha256=prov['gold/agropecuaria/manifesto.json']['sha256'])
        for bucket,ref in am['indices'].items():
            agro_indices[bucket]=ler(ref['caminho']);agro_paths[bucket]=paths[agro_indices[bucket]['arquivo']['caminho']]
        for j,i in enumerate(ac['indicadores']):
            total={'lavouras':'Total das lavouras','origem_animal':'Total dos produtos de origem animal','aquicultura':'Total da aquicultura','silvicultura':'Total da silvicultura','extracao_vegetal':'Total da extração vegetal','florestas_plantadas':'Total das florestas plantadas'}.get(i['familia'],'Total')
            total_en={'lavouras':'All crops','origem_animal':'All animal products','aquicultura':'All aquaculture','silvicultura':'All forestry','extracao_vegetal':'All forest extraction','florestas_plantadas':'All planted forests'}.get(i['familia'],'Total')
            label=i['nome'].replace('Total ·',total+' ·',1)if i['categoria']=='0'else i['nome']
            label_en=i['nome_en'].replace('Total ·',total_en+' ·',1)if i['categoria']=='0'else i['nome_en']
            agro_defs.append(dict(id=i['id'],nome=label,nome_en=label_en,descricao=i['descricao'],descricao_en=i['descricao'],
                tema=i['familia'],tema_en=i['familia'],unidade=i['unidade'],unidade_en=i['unidade'],formato='moeda'if i['medida']=='valor'else'numero',periodos=am['anos'],
                frequencia='anual',metodo_referencia='razao',normalizacao='Valor original da PAM/PPM. Use produtividade e percentuais para comparar lugares.',normalizacao_en='Original PAM/PPM value. Use yields and shares to compare places.',fator=1,ranking=False,
                fonte_nome='IBGE · PAM / PPM / PEVS',fontes=[dict(nome='SIDRA '+i['tabela'],url='https://sidra.ibge.gov.br/tabela/'+i['tabela'])],area='agropecuaria',rede='todas',catalogo='agropecuaria_original',indice=j,
                alerta='Valor nominal do próprio ano, sem desconto da inflação; não é PIB.'if i['medida']=='valor'else'',alerta_en='Nominal current-year value, without inflation adjustment; not GDP.'if i['medida']=='valor'else''))
        defs+=agro_defs
    mob=None;mob_indices={};mob_paths={};mob_defs=[]
    if 'gold/mobilidade/manifesto.json'in paths:
        mm=ler('gold/mobilidade/manifesto.json');mc=json.loads(gzip.decompress(paths[mm['catalogo']['caminho']].read_bytes()))
        mob=dict(anos=mm['anos'],indices=mm['indices'],indicadores=[i['id']for i in mc['indicadores']],edicao_sha256=prov['gold/mobilidade/manifesto.json']['sha256'])
        for bucket,ref in mm['indices'].items():mob_indices[bucket]=ler(ref['caminho']);mob_paths[bucket]=paths[mob_indices[bucket]['arquivo']['caminho']]
        for j,i in enumerate(mc['indicadores']):
            mob_defs.append(dict(id=i['id'],nome=i['nome'],nome_en=i['nome_en'],descricao=i['descricao'],descricao_en=i['descricao'],tema=i['familia'],tema_en=i['familia'],unidade=i['unidade'],unidade_en=i['unidade'],formato='numero',periodos=i['anos'],frequencia='anual',metodo_referencia='razao',normalizacao='Medida original de registro ou residência. Use taxas e proporções para comparar lugares.',normalizacao_en='Original registration/residence measure. Compare places using rates and shares.',fator=1,ranking=False,fonte_nome=i['fonte_nome'],fontes=[dict(nome=i['fonte_nome'],url=i['fonte_url'])],area='mobilidade',rede='todas',catalogo='mobilidade_original',indice=j,alerta='Senatran: retratos de dezembro. SIM: óbitos de residentes em transporte terrestre; edição definitiva até 2024. Idade da frota é estimada pelo ano de fabricação.',alerta_en='Senatran: December snapshots. SIM: resident land transport deaths, final data through 2024. Fleet age is estimated from manufacturing year.'))
        defs+=mob_defs
    saida=destino/'gold/raiox';saida.mkdir(parents=True)
    def objeto(nome,body,ext='json'):
        key=f'gold/raiox/{nome}_{sha(body)[:16]}.{ext}';(destino/key).write_bytes(body)
        return dict(caminho=key,bytes=len(body),sha256=sha(body))
    meta=objeto('catalogo',compacto(dict(versao=1,indicadores=defs,catalogos=catalogos,
         referencias={k:econ[k] for k in ['anos','arquivo','grupos','indices_uf']},**({'agropecuaria':agro}if agro else{}),**({'mobilidade':mob}if mob else{}))))
    meta_gzip={**objeto('catalogo',gzip.compress((destino/meta['caminho']).read_bytes(),mtime=0),'json.gz'),'json_sha256':meta['sha256'],'json_bytes':meta['bytes']}
    geo_body=paths[origem['geografia']['caminho']].read_bytes()
    geo_gzip={**objeto('geografia',gzip.compress(geo_body,mtime=0),'json.gz'),'json_sha256':sha(geo_body),'json_bytes':len(geo_body)}
    todos=['BR',*[u for u in geo['territorios'] if geo['territorios'][u]['nivel']=='UF'],*[str(m[0]) for m in geo['municipios']]]
    extras_idx={**econ['grupos']}
    for ref in econ['indices_uf'].values(): extras_idx.update(ler(ref['caminho'])['grupos'])
    governos={uf:cod for cod,_,uf in geo['governos']}
    rel={};contagem=0;max_trecho=0;validos=0
    with ExitStack() as stack:
        files={key:stack.enter_context(p.open('rb')) for key,p in arquivos.items()}
        economic=stack.enter_context(paths[econ['arquivo']['caminho']].open('rb'))
        handles={};index={}
        agro_files={b:stack.enter_context(p.open('rb'))for b,p in agro_paths.items()}
        mob_files={b:stack.enter_context(p.open('rb'))for b,p in mob_paths.items()}
        for grupo in todos:
            ter=geo['territorios'][grupo];bucket=ter['uf'] if ter['nivel']=='M' else 'referencias'
            if bucket not in handles:
                handles[bucket]=stack.enter_context((saida/f'temporario_{bucket}.ndjson').open('wb'));index[bucket]={}
            rows=[]
            for key,cat in cats.items():
                group=('E:BR' if grupo=='BR' else governos.get(grupo)) if key=='gestao_estadic' else grupo
                if not group or group not in cat['quantidades']:
                    rows.extend([None]*len(cat['indicadores']));continue
                idx=indices[key][bucket if key!='gestao_estadic' else 'referencias']
                off,size,h=idx['grupos'][group];f=files[key];f.seek(off);body=f.read(size);assert sha(body)==h
                data=json.loads(body);assert data['grupo']==group and data['indicadores']==[i['id'] for i in cat['indicadores']]
                rows.extend(retrato(i,s,ter['nivel']!='M' and key!='gestao_estadic') for i,s in zip(cat['indicadores'],data['dados']))
            off,size,h=extras_idx[grupo];economic.seek(off);body=economic.read(size);assert sha(body)==h
            es=json.loads(body);assert es['grupo']==grupo
            rows.extend(retrato(i,s) for i,s in zip(extra,extras_series(es['linhas'])))
            if agro:
                ai=agro_indices[bucket];off,size,h=ai['grupos'][grupo];af=agro_files[bucket];af.seek(off);ab=af.read(size);assert sha(ab)==h
                ag=json.loads(ab);assert ag['grupo']==grupo and ag['anos']==agro['anos']
                for j,i in enumerate(agro_defs):
                    vals=[r[j]for r in ag['valores']];flags=[22 if ter['nivel']!='M'and v is not None else ag['condicoes'][k][j]for k,v in enumerate(vals)]
                    series=dict(v=vals,n=[None]*len(vals),d=[None]*len(vals),r=vals,c=flags,q=[int(v is not None)for v in vals])
                    rows.append(retrato(i,series))
            if mob:
                mi=mob_indices[bucket];off,size,h=mi['grupos'][grupo];mf=mob_files[bucket];mf.seek(off);mb=mf.read(size);assert sha(mb)==h;mo=json.loads(mb);assert mo['grupo']==grupo and mo['anos']==mob['anos']
                for j,i in enumerate(mob_defs):
                    yy=[mo['anos'].index(y)for y in i['periodos']];vals=[mo['valores'][k][j]for k in yy];flags=[mo['condicoes'][k][j]for k in yy]
                    series=dict(v=vals,n=[None]*len(vals),d=[None]*len(vals),r=vals,c=flags,q=[int(v is not None)for v in vals]);rows.append(retrato(i,series))
            assert len(rows)==len(defs)
            body=compacto(dict(versao=1,grupo=grupo,linhas=rows,referencias={str(a[0]):[a[10],a[8],a[9]] for a in es['linhas']}))+b'\n';f=handles[bucket]
            index[bucket][grupo]=[f.tell(),len(body),sha(body)];f.write(body)
            max_trecho=max(max_trecho,len(body));validos+=sum(r is not None and r[1] is not None for r in rows);contagem+=1
            if contagem%500==0:print(json.dumps(dict(territorios=contagem,total=len(todos))),flush=True)
        for f in handles.values():f.flush()
    # Todos os handles estão fechados antes de renomear no Windows.
    for bucket in index:
        p=saida/f'temporario_{bucket}.ndjson'
        with p.open('rb') as f:h=hashlib.file_digest(f,'sha256').hexdigest()
        novo=saida/f'retratos_{bucket.lower()}_{h[:16]}.ndjson';p.rename(novo)
        ref=dict(caminho=novo.relative_to(destino).as_posix(),bytes=novo.stat().st_size,sha256=h)
        rel[bucket]=objeto('indice_'+bucket.lower(),compacto(dict(versao=1,arquivo=ref,grupos=index[bucket])))
    manifesto=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),catalogo=meta_gzip,catalogo_json=meta,geografia=geo_gzip,geografia_json=origem['geografia'],indices=rel,
         anos=sorted({p//100 if p>10000 else p for i in defs for p in i['periodos']}),
         fontes={nome:{k:prov[path][k]for k in ['bytes','sha256']}for nome,path in [('comparacoes','gold/comparacoes/manifesto.json'),('referencias','gold/assistencia/referencias_manifesto.json')]},
         territorios=contagem,indicadores=len(defs),max_trecho_bytes=max_trecho)
    # Mantém as edições anteriores para clientes abertos antes da ampliação.
    perfis_mob=any(i.get('area')=='mobilidade'and i.get('tema')=='raca'for i in defs)
    (saida/('v4_manifesto.json'if perfis_mob else'v3_manifesto.json'if mob else'v2_manifesto.json'if agro else'manifesto.json')).write_bytes(compacto(manifesto))
    report=dict(ok=True,territorios=contagem,indicadores=len(defs),observacoes_com_valor=validos,max_trecho_bytes=max_trecho,
                bytes=sum(p.stat().st_size for p in saida.iterdir()),arquivos=len(list(saida.iterdir())))
    (destino/'auditoria_geracao.json').write_bytes(compacto(report));print(json.dumps(report),flush=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--fontes',required=True);parser.add_argument('--saida',required=True)
    args=parser.parse_args();gerar(args.fontes,args.saida)
