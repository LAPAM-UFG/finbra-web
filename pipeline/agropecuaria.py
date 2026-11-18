"""PAM/PPM desde 2013: retratos territoriais prontos e comparações relativas.

Lê somente o cache auditado. Escreve exclusivamente em uma candidata isolada.
Unidades vêm da API SIDRA; valores monetários são convertidos de mil R$ para R$.
Não soma espécies, produtos com unidades diferentes nem categorias sobrepostas.
"""
import argparse, copy, gzip, hashlib, json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import re
import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from agropecuaria_fontes import ANOS, TABELAS, compacto, sha
from comparacoes_base import Quadro, Gravador, numeros

CONDICOES={0:'Registrado',1:'Zero registrado',2:'Indisponível na fonte',3:'Denominador ausente',4:'Denominador zero',5:'Não se aplica',20:'Valor protegido pelo IBGE'}
METRICAS={'8331':('plantada','Área plantada ou destinada à colheita','Planted/intended harvest area'),
 '216':('colhida','Área colhida','Harvested area'),'214':('quantidade','Quantidade produzida','Output'),
 '112':('rendimento','Rendimento médio','Average yield'),'215':('valor','Valor da produção','Production value'),
 '105':('quantidade','Efetivo do rebanho em 31/12','Livestock on 31 December'),
 '106':('quantidade','Produção de origem animal','Animal output'),'107':('quantidade','Vacas ordenhadas no ano','Cows milked during the year'),
 '4146':('quantidade','Produção da aquicultura','Aquaculture output'),
 '108':('quantidade','Ovinos tosquiados no ano','Sheep shorn during the year'),
 '144':('quantidade','Quantidade da extração vegetal','Extractive output'),'145':('valor','Valor da extração vegetal','Extractive production value'),
 '142':('quantidade','Quantidade da silvicultura','Planted forest output'),'143':('valor','Valor da silvicultura','Planted forest production value'),
 '6549':('existente','Área de florestas plantadas em 31/12','Planted forest area on 31 December')}
FAMILIAS={'5457':'lavouras','3939':'rebanhos','74':'origem_animal','94':'rebanhos','3940':'aquicultura','95':'rebanhos','289':'extracao_vegetal','291':'silvicultura','5930':'florestas_plantadas'}
PREFIXOS={'5457':'pam','3939':'reb','74':'ani','94':'vacas','3940':'aqua','95':'tosq','289':'ext','291':'sil','5930':'flo'}
CURTAS={'plantada':'plant','colhida':'area','quantidade':'qtd','rendimento':'rend','valor':'valor','existente':'area'}
CULTURAS=['40124','40122','40102','40112','40106','40139','40119','40127','40099','40151','40136','40126','45982','40138','40092']

def numero(v):
    """Legenda SIDRA: traço é zero; .., ... e X não são zero."""
    if v=='-':return 0.,1
    if v in ['..','...','X',''] :return np.nan,{'..':5,'...':2,'X':20,'':2}[v]
    n=float(v)
    if not np.isfinite(n) or n<0:raise ValueError('Valor inesperado: '+v)
    return n,1 if n==0 else 0

def proporcao(n,d,cn,cd,fator):
    with np.errstate(invalid='ignore',divide='ignore'):v=n/d*fator
    ok=np.isfinite(n)&np.isfinite(d)&(d>0);v[~ok]=np.nan
    c=np.where(~np.isfinite(n),cn,np.where(~np.isfinite(d),3,np.where(d==0,4,np.where(v==0,1,0)))).astype('int8')
    c[(cn==20)|(np.isfinite(n)&(cd==20))]=20
    return v,c

class QuadroAgro(Quadro):
    oficiais:dict
    def grupo_territorio(self,key,pos,municipio=False,incluir_ressalvas=False):
        out=super().grupo_territorio(key,pos,municipio,incluir_ressalvas)
        if key in self.oficiais:
            v,n,d,c=self.oficiais[key]
            out.update(v=numeros(v),n=numeros(n),d=numeros(d),c=[22 if np.isfinite(x) else int(y) for x,y in zip(v,c)])
        return out

def construir_quadros(a,c,idx,produtos,inds,grupos,pos,nmun):
    # Comparações: apenas razões, percentuais e produtividade; nunca totais absolutos.
    quadros=[]
    def razao(id,nkey,dkey,factor,name,en,unit,theme='Lavouras',raw=False):
        nj,dj=idx[nkey],idx[dkey];n,d=a[:,:,nj],a[:,:,dj];v,flags=proporcao(n,d,c[:,:,nj],c[:,:,dj],factor)
        definition=dict(id=id,nome=name,nome_en=en,descricao=f'{name}. Razão entre componentes da mesma localidade e ano; regiões somam apenas pares válidos. Não é medida de bem-estar.',descricao_en=f'{en}. Same-place, same-year components; regional sums use valid pairs. Not a welfare measure.',
            tema=theme,tema_en={'Lavouras':'Crops','Pecuária':'Livestock','Florestas plantadas':'Planted forests','Extrativismo vegetal':'Forest extraction','Silvicultura':'Forestry'}.get(theme,theme),unidade=unit,unidade_en=unit,formato='percentual'if unit=='%'else'moeda'if unit.startswith('R$')else'numero',
            frequencia='anual',metodo_referencia='razao',normalizacao=name,normalizacao_en=en,fator=factor,ranking=True,minimo=0,
            fonte_nome='IBGE · PAM / PPM / PEVS',fontes=[dict(nome='SIDRA '+tab,url='https://sidra.ibge.gov.br/tabela/'+tab)for tab in sorted({nkey[0],dkey[0]})],
            alerta='Valores monetários são nominais; a série não foi deflacionada.'if unit=='R$/ha'else'Não compare volumes de produtos com unidades diferentes.',
            alerta_en='Monetary values are nominal; the series is not inflation-adjusted.'if unit=='R$/ha'else'Do not compare output volumes expressed in different units.')
        if raw:definition.update(nome_original=inds[nj]['nome'],nome_original_en=inds[nj]['nome_en'],unidade_original=inds[nj]['unidade'])
        q=QuadroAgro(definition,ANOS,v[:,:nmun],n[:,:nmun],d[:,:nmun],flags[:,:nmun],originais=n[:,:nmun]if raw else None)
        q.completo=(v,flags);definition.update(variavel_download='ag_'+id,numerador_id=inds[nj]['id'],denominador_id=inds[dj]['id'],numerador_nome=inds[nj]['nome']+' ('+inds[nj]['unidade']+')',denominador_nome=inds[dj]['nome']+' ('+inds[dj]['unidade']+')');q.oficiais={key:(v[:,pos[key]],n[:,pos[key]],d[:,pos[key]],flags[:,pos[key]])for key in grupos[nmun:]};quadros.append(q)
    razao('valor_lavouras_ha',('5457','0','215'),('5457','0','216'),1,'Valor das lavouras por hectare colhido','Crop production value per harvested hectare','R$/ha',raw=True)
    for code in CULTURAS:
        p=next(p for p in produtos if p['tabela']=='5457'and p['codigo']==code);nome=p['nome']
        unit='frutos/ha'if code=='40092'else'kg/ha'
        razao('rendimento_'+code,('5457',code,'214'),('5457',code,'216'),1000,nome+' · produtividade',nome+' · yield',unit)
        razao('area_pct_'+code,('5457',code,'216'),('5457','0','216'),100,nome+' · participação na área colhida',nome+' · share of harvested area','%',raw=True)
    razao('leite_vaca',('74','2682','106'),('94','0','107'),1000,'Leite por vaca ordenhada','Milk per milked cow','litros/vaca','Pecuária')
    razao('vacas_bovinos_pct',('94','0','107'),('3939','2670','105'),100,'Vacas ordenhadas / bovinos','Milked cows / cattle','%','Pecuária',True)
    razao('matrizes_suinos_pct',('3939','32795','105'),('3939','32794','105'),100,'Matrizes / suínos','Breeding sows / pigs','%','Pecuária',True)
    razao('galinhas_galinaceos_pct',('3939','32793','105'),('3939','32796','105'),100,'Galinhas / galináceos','Hens / poultry','%','Pecuária',True)
    # Valores por unidade são razões implícitas de valor/quantidade; não cotações.
    def unitario(tab,code,qvar,vvar,theme):
        p=next(p for p in produtos if p['tabela']==tab and p['codigo']==code)
        u=inds[idx[(tab,code,qvar)]]['unidade'];factor=.001 if u in ['Mil litros','Mil dúzias']else 1
        un={'Toneladas':'R$/tonelada','Mil frutos':'R$/mil frutos','Mil litros':'R$/litro','Mil dúzias':'R$/dúzia','Quilogramas':'R$/kg','Metros cúbicos':'R$/m³'}.get(u,'R$/'+u)
        razao('valor_un_'+PREFIXOS[tab]+'_'+code,(tab,code,vvar),(tab,code,qvar),factor,p['nome']+' · valor por unidade (implícito)',p['nome']+' · implicit unit value',un,theme)
        quadros[-1].definicao.update(alerta='Valor unitário implícito: valor da produção dividido pela quantidade do mesmo ano e território. Não é cotação de mercado, preço recebido por produtor ou renda líquida. Valores nominais, sem desconto da inflação.',alerta_en='Implicit unit value: production value divided by same-year, same-place output. Not a market quote, individual farm price or net income. Nominal values without inflation adjustment.')
    for code in CULTURAS:
        unitario('5457',code,'214','215','Lavouras')
        p=next(p for p in produtos if p['tabela']=='5457'and p['codigo']==code)
        razao('valor_pct_'+code,('5457',code,'215'),('5457','0','215'),100,p['nome']+' · participação no valor das lavouras',p['nome']+' · share of crop value','%')
    for code in ['2682','2685','2686','2687','2683','2684']:unitario('74',code,'106','215','Pecuária')
    razao('la_ovino_tosq',('74','2684','106'),('95','0','108'),1,'Lã por ovino tosquiado','Wool per shorn sheep','kg/animal','Pecuária')
    for p in produtos:
        if p['tabela']=='5930'and p['codigo']!='0':
            razao('floresta_pct_'+p['codigo'],('5930',p['codigo'],'6549'),('5930','0','6549'),100,p['nome']+' · participação na área de florestas plantadas',p['nome']+' · share of planted forest area','%','Florestas plantadas')
    for code in ['3455','3456','3457']:unitario('291',code,'142','143','Silvicultura')
    for code in ['3403','3405','39409','3433','3434','3435']:unitario('289',code,'144','145','Extrativismo vegetal')
    assert len({q.definicao['id']for q in quadros})==len(quadros)
    assert all(len(q.definicao['variavel_download']+'_cond')<=32 for q in quadros)
    return quadros

def gerar(fontes,saida):
    fontes=Path(fontes).resolve();saida=Path(saida).resolve()
    if saida==fontes or saida.is_relative_to(fontes) or fontes.is_relative_to(saida):raise ValueError('Destino sobreposto à origem')
    dest=saida/'gold/agropecuaria'
    if dest.exists() and any(dest.iterdir()):raise ValueError('Use uma candidata nova')
    dest.mkdir(parents=True,exist_ok=True)
    prov=json.loads((fontes/'fontes.json').read_bytes());g=json.loads((fontes/'geografia.json').read_bytes())
    assert sha((fontes/'geografia.json').read_bytes())==prov['geografia_sha256']
    municipios=g['municipios'];nmun=len(municipios);assert nmun==5571
    grupos=[str(m[0])for m in municipios]+[u for _,_,u in g['governos']]+['BR'];pos={k:j for j,k in enumerate(grupos)}
    ufcode={code.removeprefix('E:'):uf for code,_,uf in g['governos']}
    produtos=[];inds=[];idx={}
    for tab,(cl,vs) in TABELAS.items():
        m=json.loads((fontes/f'metadados_{tab}.json').read_bytes())
        cats=m['classificacoes'][0]['categorias']if cl else[dict(id=0,nome=m['nome'])]
        units={}
        for r in json.loads((fontes/f'unidades_{tab}.json').read_bytes())[1:]:
            units[(r['D3C'],r.get('D4C','0'))]=r['MN']
        for cat in cats:
            code=str(cat['id']);p=dict(id=PREFIXOS[tab]+'_'+code,codigo=code,tabela=tab,nome=cat['nome'].replace('*',''),familia=FAMILIAS[tab],medidas={})
            if tab=='5457' and code in ['40140','40141']:p['nota']='Subtipo de café: já está incluído em Café Total.'
            if tab=='3939' and code in ['32795','32793']:p['nota']='Subgrupo já incluído no total da espécie. Não somar novamente.'
            if tab=='3940' and code not in ['0','79366']:p['nota']='Espécies de peixe estão incluídas em Peixes; não somar subtotais com espécies.'
            for var in vs:
                # A unidade genérica da variável na API não incorpora a nota
                # das duas frutas assinaladas com * na tabela PAM 5457.
                # https://www.ibge.gov.br/comunicados/16980-ibge-disponibiliza-serie-historica-completa-da-pesquisa-agricola-municipal.html
                if tab=='5457'and code=='0'and var in ['214','112']:continue
                u=units.get((var,code),'')
                if tab=='5457'and code in ['40092','40145']:
                    if var=='214':u='Mil frutos'
                    if var=='112':u='Frutos por Hectare'
                if not u:continue
                met,nome,en=METRICAS[var];id='ag_'+PREFIXOS[tab]+'_'+code+'_'+CURTAS[met]
                j=len(inds);p['medidas'][met]=j;idx[(tab,code,var)]=j
                inds.append(dict(id=id,nome=f"{p['nome']} · {nome}",nome_en=f"{p['nome']} · {en}",
                    descricao=f"{nome}: {p['nome']}. IBGE, tabela SIDRA {tab}, variável {var}, categoria {code}. "+('Valor nominal em reais do próprio ano; não é PIB nem valor adicionado.'if var in ['215','143','145']else 'Mantém a unidade da fonte. Não se somam unidades ou categorias sobrepostas.'),
                    unidade='R$ nominais'if var in ['215','143','145']else u,unidade_original=u,tabela=tab,categoria=code,variavel_sidra=var,
                    medida=met,produto=p['id'],familia=p['familia'],fator=1000 if var in ['215','143','145']else 1,anos=ANOS))
            if tab in ['289','291']:
                p['nome']=re.sub(r'^\d+(?:\.\d+)*\s*-\s*','',p['nome']);p['nota']='Há totais, grupos e subprodutos na fonte. Não some categorias sobrepostas. Extração de vegetação nativa e produção de florestas plantadas são apresentadas separadamente.'
            if tab=='5930':p['nota']='Área de florestas plantadas existente em 31/12; não é área de mata nativa nem área colhida. O total já inclui as espécies.'
            produtos.append(p)
    a=np.full((len(ANOS),len(grupos),len(inds)),np.nan);c=np.full(a.shape,2,dtype='int8');vistos=set();lugares_recebidos=set()
    for k,ref in enumerate(prov['lotes']):
        body=gzip.decompress((fontes/ref['arquivo']).read_bytes());assert sha(body)==ref['sha256'] and len(body)==ref['bytes']
        for v in json.loads(body):
            tab=ref['tabela'];var=str(v['id'])
            for result in v['resultados']:
                cat=next(iter(result['classificacoes'][0]['categoria']))if result['classificacoes']else'0'
                j=idx.get((tab,cat,var))
                if j is None:continue
                for s in result['series']:
                    loc=s['localidade'];key=loc['id']if loc['nivel']['id']=='N6'else'BR'if loc['nivel']['id']=='N1'else ufcode[loc['id']]
                    if key not in pos:raise ValueError('Localidade fora do cadastro: '+key)
                    destj=pos[key];marker=(tab,cat,var,key)
                    if marker in vistos:raise ValueError('Observação duplicada: '+str(marker))
                    vistos.add(marker);lugares_recebidos.add(key)
                    for year,val in s['serie'].items():
                        row=ANOS.index(int(year));value,flag=numero(val);a[row,destj,j]=value*inds[j]['fator'];c[row,destj,j]=flag
        if k%100==0:print(json.dumps(dict(lotes_lidos=k,total=len(prov['lotes']))),flush=True)
    for key in grupos[nmun:]:
        if key not in lugares_recebidos:raise ValueError('Agregado não recebido: '+key)
    # Alguns municípios urbanos não aparecem em nenhuma tabela PAM/PPM. A falta
    # de uma linha oficial permanece indisponível, sem inventar produção zero.
    nao_retornados=sorted(set(grupos)-lugares_recebidos)
    quadros=construir_quadros(a,c,idx,produtos,inds,grupos,pos,nmun)
    calculados=np.stack([q.completo[0]for q in quadros],axis=2);cond_calculados=np.stack([q.completo[1]for q in quadros],axis=2)
    def objeto(namespace,nome,value,comprimir=False):
        d=saida/'gold'/namespace;d.mkdir(parents=True,exist_ok=True);body=compacto(value);b=gzip.compress(body,mtime=0)if comprimir else body
        path=d/f"{nome}_{sha(b)[:16]}.{'json.gz'if comprimir else'json'}"
        path.write_bytes(b);ref=dict(caminho=path.relative_to(saida).as_posix(),bytes=len(b),sha256=sha(b))
        if comprimir:ref.update(json_bytes=len(body),json_sha256=sha(body))
        return ref
    indices={};max_slice=0
    for uf in [*[u for _,_,u in g['governos']],'referencias']:
        selected=[key for key in grupos if (g['territorios'][key]['uf']if len(key)==7 else'referencias')==uf]
        temp=dest/f'tmp_{uf}.ndjson';entries={}
        with temp.open('wb')as f:
            for key in selected:
                j=pos[key];body=compacto(dict(versao=1,grupo=key,anos=ANOS,valores=[numeros(x)for x in a[:,j]],condicoes=c[:,j].tolist(),derivados=[numeros(x)for x in calculados[:,j]],condicoes_derivados=cond_calculados[:,j].tolist()))+b'\n'
                entries[key]=[f.tell(),len(body),sha(body)];f.write(body);max_slice=max(max_slice,len(body))
        digest=hashlib.sha256(temp.read_bytes()).hexdigest();target=dest/f'series_{uf.lower()}_{digest[:16]}.ndjson';temp.rename(target)
        ref=dict(caminho=target.relative_to(saida).as_posix(),bytes=target.stat().st_size,sha256=digest)
        indices[uf]=objeto('agropecuaria','indice_'+uf.lower(),dict(versao=1,arquivo=ref,grupos=entries))
    geo=objeto('agropecuaria','geografia',g,True)
    catalogo=objeto('agropecuaria','catalogo',dict(versao=1,anos=ANOS,produtos=produtos,indicadores=inds,derivados=[dict(q.definicao,periodos=ANOS)for q in quadros],condicoes=CONDICOES),True)
    manifesto=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=ANOS,catalogo=catalogo,geografia=geo,indices=indices,
        fonte='IBGE · PAM, PPM e PEVS',
        fontes=[dict(nome='SIDRA '+t,url='https://sidra.ibge.gov.br/tabela/'+t)for t in TABELAS],
        origem_sha256=sha((fontes/'fontes.json').read_bytes()),territorios=len(grupos),variaveis=len(inds),calculados=len(quadros),produtos=len(produtos),max_trecho_bytes=max_slice)
    (dest/'manifesto.json').write_bytes(compacto(manifesto))
    # Todos os produtos permanecem no arquivo temático: uma linha por município/ano.
    data={'cod_ibge':np.tile(np.array([m[0]for m in municipios],dtype='int32'),len(ANOS)),
          'ano':np.repeat(np.array(ANOS,dtype='int16'),nmun),'municipio':np.tile([m[1]for m in municipios],len(ANOS)),'uf':np.tile([m[2]for m in municipios],len(ANOS))}
    for j,i in enumerate(inds):data[i['id']]=a[:,:nmun,j].reshape(-1);data[i['id']+'_cond']=c[:,:nmun,j].reshape(-1)
    for j,q in enumerate(quadros):
        id=q.definicao['variavel_download'];data[id]=calculados[:,:nmun,j].reshape(-1);data[id+'_cond']=cond_calculados[:,:nmun,j].reshape(-1)
    frame=pd.DataFrame(data).sort_values(['cod_ibge','ano']);work=saida/'trabalho_agropecuaria';work.mkdir()
    pq.write_table(pa.Table.from_pandas(frame,preserve_index=False),work/'municipios.parquet',compression='zstd')
    geo_groups={};geo_buckets={}
    for key,t in g['territorios'].items():
        if t['nivel']not in ['M','UF','BR','imediata','intermediaria']:continue
        geo_groups[key]=[j for j,m in enumerate(municipios)if key==str(m[0])or key==m[2]or key=='BR'or key=='I:'+m[3]or key=='T:'+m[4]]
        geo_buckets[key]=t['uf']if t['nivel']=='M'else'referencias'
    geo_obj=SimpleNamespace(municipios=municipios,territorios=g['territorios'],governos=g['governos'],grupos=geo_groups,buckets=geo_buckets)
    root=json.loads((fontes/'gold/comparacoes/manifesto.json').read_bytes());writer=Gravador(saida,geo_obj,fontes,{})
    writer.georef=root['geografia'];writer.area('agropecuaria',quadros,dict(caminho='gold/agropecuaria/manifesto.json',sha256=sha((dest/'manifesto.json').read_bytes())))
    root['catalogos'].update(writer.catalogos);root['origens']['gold/agropecuaria/manifesto.json']=dict(bytes=(dest/'manifesto.json').stat().st_size,sha256=sha((dest/'manifesto.json').read_bytes()))
    (saida/'gold/comparacoes/manifesto.json').write_bytes(compacto(root))
    maps(saida,municipios,quadros,manifesto)
    audit=dict(ok=True,variaveis=len(inds),produtos=len(produtos),comparaveis=len(quadros),municipios=nmun,anos=ANOS,linhas=len(frame),max_trecho_bytes=max_slice,
        valores=int(np.isfinite(a).sum()),protegidos=int((c==20).sum()),zero=int((c==1).sum()),municipios_nao_retornados=nao_retornados,origem_sha256=manifesto['origem_sha256'])
    (work/'auditoria.json').write_bytes(compacto(audit));print(json.dumps(audit),flush=True)

def componentes_mapa(id):
    if id=='leite_vaca':n,d='Leite produzido (mil litros)','Vacas ordenhadas no ano (cabeças)'
    elif id.startswith('rendimento_'):n,d=('Produção (mil frutos)'if id.endswith('40092')else'Produção (toneladas)'),'Área colhida (ha)'
    elif id.startswith('area_pct_'):n,d='Área colhida da cultura (ha)','Área colhida de todas as lavouras (ha)'
    elif id=='valor_lavouras_ha':n,d='Valor das lavouras (R$ nominais)','Área colhida (ha)'
    elif id=='vacas_bovinos_pct':n,d='Vacas ordenhadas no ano (cabeças)','Bovinos em 31/12 (cabeças)'
    elif id=='matrizes_suinos_pct':n,d='Matrizes suínas (cabeças)','Suínos — total (cabeças)'
    else:n,d='Galinhas (cabeças)','Galináceos — total (cabeças)'
    return dict(numerador_nome=n,denominador_nome=d,numerador_nome_en=n,denominador_nome_en=d)

def maps(saida,municipios,quadros,manifesto):
    from mapas_indicadores import Gerador,escala
    d=saida/'gold/mapas';d.mkdir();obj=Gerador.__new__(Gerador);obj.saida=saida;obj.dest=d
    obj.cadastro=obj.objeto('cadastro_agro',dict(versao=1,municipios=[m[:3]for m in municipios]));inds=[];temp=d/'tmp_agro.ndjson'
    with temp.open('wb')as f:
        for q in quadros:
            tr={};i=q.definicao
            for k,year in enumerate(ANOS):
                start=f.tell();br=hashlib.sha256()
                for uf in sorted({m[2]for m in municipios}):
                    pos=[j for j,m in enumerate(municipios)if m[2]==uf]
                    b=compacto(dict(versao=1,area='agropecuaria',rede='todas',indicador=i['id'],ano=year,uf=uf,cadastro=obj.cadastro['sha256'],quantidade=len(pos),
                        valores=numeros(q.valores[k,pos]),numeradores=numeros(q.numeradores[k,pos]),denominadores=numeros(q.denominadores[k,pos]),condicoes=q.condicoes[k,pos].tolist()))+b'\n'
                    tr[f'{year}:{uf}']=[f.tell(),len(b),sha(b)];f.write(b);br.update(b)
                tr[f'{year}:BR']=[start,f.tell()-start,br.hexdigest()]
            inds.append((q,tr))
    h=sha(temp.read_bytes());target=d/f'agropecuaria_todas_dados_{h[:16]}.ndjson';temp.rename(target);ref=dict(caminho=target.relative_to(saida).as_posix(),bytes=target.stat().st_size,sha256=h)
    measures=[]
    for q,tr in inds:
        i=q.definicao;ind={k:v for k,v in i.items()if k in ['id','nome','nome_en','descricao','descricao_en','tema','tema_en','unidade','unidade_en','formato','fonte_nome','fontes','alerta','alerta_en','minimo']}
        ind.update(anos=ANOS,anos_com_valor=[y for j,y in enumerate(ANOS)if np.isfinite(q.valores[j]).any()],escala=escala(q.valores,i['formato']),
            fonte_nome_en='IBGE · PAM / PPM / PEVS',territorio='Município da produção',territorio_en='Municipality of production',indice=obj.objeto('agro_'+i['id']+'_indice',dict(versao=1,area='agropecuaria',rede='todas',indicador=i['id'],cadastro=obj.cadastro['sha256'],arquivo=ref,recortes=tr)))
        ind.update(componentes_mapa(i['id']));ind.update(numerador_nome=i['numerador_nome'],denominador_nome=i['denominador_nome'],numerador_nome_en=i['numerador_nome'],denominador_nome_en=i['denominador_nome'])
        measures.append(ind)
    origin=dict(tipo='agropecuaria',caminho='gold/agropecuaria/manifesto.json',sha256=sha((saida/'gold/agropecuaria/manifesto.json').read_bytes()),gerado_em=manifesto['gerado_em'])
    (d/'agropecuaria_manifesto.json').write_bytes(compacto(dict(versao=1,area='agropecuaria',rede='todas',gerado_em=manifesto['gerado_em'],cadastro=obj.cadastro,indicadores=measures,origem=origin)))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--fontes',required=True,type=Path);p.add_argument('--saida',required=True,type=Path)
    a=p.parse_args();gerar(a.fontes,a.saida)
