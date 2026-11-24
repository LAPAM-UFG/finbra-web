"""Rótulos e unidades públicos. Nenhuma função modifica valores ou códigos de fonte."""
import copy
import json
import re
from collections import defaultdict
from functools import lru_cache
from pathlib import Path


@lru_cache
def textos():
    return json.loads((Path(__file__).resolve().parent.parent/'shared/rotulos_publicos.json').read_bytes())


def nome_tema(area, ingles=False):
    return textos()['temas'].get(area,[area,area])[int(ingles)]


def unidade(texto):
    s=(texto or '').strip()
    if s.split(' ')[0].lower() in {'hectares','toneladas','quilogramas','metros','cabeças','milheiros','mil','frutos','litros','dúzias'}:
        s=s.lower()
    return s


def unidade_en(s):
    s=unidade(s)
    if s in textos()['unidades']:return textos()['unidades'][s]
    s=re.sub(r'R\$ de dez/(\d+)',r'Dec/\1 R$',s)
    for pt,en in [('por habitante','per resident'),('por aluno','per pupil'),('por 1.000 habitantes','per 1,000 residents'),('por 100 mil habitantes','per 100,000 residents')]:s=s.replace(pt,en)
    return s


def produto_en(s):
    s=re.sub(r'^\d+(?:\.\d+)*\s*-\s*','',s)
    if s in textos()['agro_produtos']:return textos()['agro_produtos'][s]
    for pt,en in [('Carvão vegetal','Charcoal'),('Lenha','Firewood'),('Madeira em tora','Roundwood')]:
        if s.startswith(pt):
            resto=s[len(pt):].strip()
            fim=''
            for a,b in [(' para papel e celulose',' for pulp and paper'),(' para outras finalidades',' for other uses')]:
                if a in ' '+resto:resto=(' '+resto).replace(a,'').strip();fim=b
            if resto.startswith('de '):resto=resto[3:]
            especies={'acácia negra':'black wattle','cedro australiano':'Australian red cedar','eucalipto':'eucalyptus','mogno africano':'African mahogany','pinus':'pine','teca':'teak','outras espécies':'other species'}
            return en+(' · '+especies.get(resto.lower(),resto) if resto else '')+fim
    # Nomes próprios de espécies mantêm a nomenclatura da categoria IBGE.
    return s


def curar_definicao(i):
    i=copy.deepcopy(i)
    if i.get('tema')=='Finanças e economia'and i.get('metodo_referencia')=='mediana':
        i['normalizacao']='No município, indicador da fonte (corrigido pelo IPCA quando monetário). Referências regionais, estaduais e Brasil: mediana dos resultados municipais disponíveis; não é o consolidado oficial.'
        i['normalizacao_en']='For a municipality, the source indicator (IPCA-adjusted when monetary). Regional, state and Brazil benchmarks: median of available municipal results; not the official consolidated result.'
        if i.get('precos')=='reais':
            i['unidade_original']=re.sub(r'R\$ de dez/\d+','R$ nominais',i.get('unidade',''))
    if i.get('id','').startswith('se_')and'aluno'in i['id']:
        i['descricao']=i.get('nome','')+'. Indicador nominal publicado pelo FNDE/SIOPE; o painel aplica apenas o IPCA nos valores reais. Não divide novamente pelas matrículas do Censo Escolar. Não inferir participação dos gastos com professores sem confirmar o mesmo universo dos indicadores.'
        i['descricao_en']=i.get('nome_en',i.get('nome',''))+'. Nominal indicator published by FNDE/SIOPE; only IPCA is applied for real values. Not divided again by School Census enrolments. Do not infer the share of teacher expenditure without confirming identical indicator scopes.'
    if any(re.match(r'^número(?:$| por )',i.get(k,''))for k in ['unidade','unidade_original']):
        nome=(i.get('nome','')+' '+i.get('nome_original','')).lower()
        pares=[('famíl','famílias'),('benefíc','benefícios'),('pessoa','pessoas'),('veículo','veículos'),('matrícul','matrículas'),('escola','escolas'),('vínculo','vínculos'),('óbito','óbitos'),('estabelecimento','estabelecimentos'),('servidor','servidores'),('município','municípios'),('ligaç','ligações'),('domicíl','domicílios')]
        tipo=next((u for p,u in pares if p in nome),'registros')
        for k in ['unidade','unidade_original']:
            if k in i:i[k]=re.sub(r'^número(?=$| por )',tipo,i[k])
            if k+'_en'in i:i[k+'_en']=re.sub(r'^(?:number|número)(?=$| per | por )',unidade_en(tipo),i[k+'_en'],flags=re.I)
    for key in ['unidade','unidade_original']:
        if key in i:i[key]=unidade(i[key])
    if 'unidade'in i and (not i.get('unidade_en')or i['unidade_en'].lower()==i['unidade'].lower()):i['unidade_en']=unidade_en(i['unidade'])
    if 'unidade_original'in i:i['unidade_original_en']=unidade_en(i['unidade_original'])
    for key in ['nome','nome_original']:
        if key in i:i[key]=i[key].replace('Atendimento / estimativa de pobreza da planilha','Atendimento em relação à estimativa de famílias pobres')
        if key in i:i[key]=i[key].replace('da planilha','da folha de pagamento do MDS').replace('na planilha','na folha de pagamento do MDS')
        if key+'_en'in i:i[key+'_en']=i[key+'_en'].replace('spreadsheet','MDS payroll')
        if key+'_en'in i:i[key+'_en']=i[key+'_en'].replace('R$/tonelada','R$/tonne').replace('veículo-anos','vehicle-years')
        if i.get('historico_cadunico'):
            if key in i and '(série histórica)' not in i[key]:i[key]+=' (série histórica)'
            if key+'_en'in i and '(historical series)' not in i[key+'_en']:i[key+'_en']+=' (historical series)'
    if i.get('id')=='homicidios':
        i['nome']='Homicídios (agressões + intervenção legal)'
        i['nome_en']='Homicides (assaults + legal intervention)'
        i['alerta']='Saúde: CID-10 X85–Y09 + Y35–Y36 (inclui intervenção legal e operações de guerra). Segurança separa agressões (X85–Y09). As medidas não são idênticas.'
        i['alerta_en']='Health: ICD-10 X85–Y09 + Y35–Y36 (includes legal intervention and operations of war). Public safety reports assaults (X85–Y09) separately. These measures differ.'
    if i.get('id')=='idade_media'and i.get('numerador_id')=='mob_idade_anos_soma':
        i['nome']='Idade média estimada da frota registrada'
        i['nome_en']='Estimated mean age of the registered fleet'
        i['descricao']='Ano de referência menos ano de fabricação, ponderado pelos veículos com ano válido. A tabulação da Senatran por fabricação não traz licenciamento, condição efetiva de uso nem situação de baixa por registro; não permite separar veículos inativos/baixados ou medir apenas os que circulam. Veículos fora de uso com cadastro ainda existente podem elevar a idade. Não se afirma que veículos formalmente baixados estejam incluídos.'
        i['descricao_en']='Reference year minus manufacturing year, weighted by vehicles with a valid year. The Senatran manufacturing-year table has no record-level licensing, actual-use or deregistration status; it cannot isolate inactive/deregistered vehicles or measure only vehicles in use. Unused vehicles with existing registrations can increase the age. This does not assert that formally deregistered vehicles are included.'
    if i.get('id','').startswith('vac_'):
        notas={'alerta':' Coberturas acima de 100% são valores observados, não limitados; numerador e população-alvo podem diferir por atualização cadastral, doses e mobilidade.','alerta_en':' Values above 100% are observed, not capped; doses and the target population can differ due to registration updates and mobility.'}
        for campo,nota in notas.items():i[campo]=i.get(campo,'').replace(nota,'').rstrip()+nota
    if '(US$ FOB)²' in i.get('unidade',''):
        i['unidade']='componente quadrático do índice de concentração'
        i['unidade_en']='quadratic component of the concentration index'
        i['descricao']=i.get('descricao','')+' Soma dos valores por categoria ao quadrado, em (US$ FOB)²; componente de cálculo do HHI, não valor comercial nem índice pronto.'
        i['descricao_en']=i.get('descricao_en','')+' Sum of squared category values in (US dollars FOB) squared; an HHI calculation component, not trade value or the final index.'
    return i


def curar_dicionario(entries,base):
    """Mesmo vocabulário dos painéis, em todos os formatos do dicionário/API."""
    import gzip
    by_area={}
    for area in ['agropecuaria','mobilidade','comex']:
        p=Path(base)/f'gold/{area}/manifesto.json'
        if not p.is_file():continue
        m=json.loads(p.read_bytes());ref=m['catalogo'];path=Path(base)/ref['caminho']
        if not path.is_file():continue
        raw=path.read_bytes();c=json.loads(gzip.decompress(raw)if path.suffix=='.gz'else raw)
        by_area[area]={i['id']:i for i in c['indicadores']+c.get('derivados',[])}
    out=[]
    for d in entries:
        d=curar_definicao(d)
        source=by_area.get(d.get('area'),{}).get(d.get('variavel_original'))or by_area.get(d.get('area'),{}).get(d.get('variavel'))
        if source:
            for key in ['nome','nome_en','descricao','descricao_en','unidade','unidade_en']:
                if key in source:d[key]=source[key]
        out.append(d)
    return out


def curar_agro(c):
    c=copy.deepcopy(c)
    for p in c.get('produtos',[]):p['nome_en']=produto_en(p['nome'])
    produtos={p['id']:p for p in c.get('produtos',[])}
    metricas={'plantada':'Planted/intended harvest area','colhida':'Harvested area','quantidade':'Output / stock reported by IBGE','rendimento':'Average yield','valor':'Production value','existente':'Planted forest area on 31 December'}
    for i in c['indicadores']:
        p=produtos[i['produto']]
        i['nome_en']=p['nome_en']+' · '+metricas[i['medida']]
        i['descricao_en']=i['nome_en']+f". IBGE SIDRA table {i['tabela']}, variable {i['variavel_sidra']}, category {i['categoria']}. "+('Current-year nominal R$; not GDP or value added.'if i['medida']=='valor'else'Source units retained. Overlapping categories must not be added.')
    c['indicadores']=[curar_definicao(i)for i in c['indicadores']]
    c['derivados']=[curar_definicao(i)for i in c.get('derivados',[])]
    for i in c['derivados']:
        for p in sorted(produtos.values(),key=lambda p:-len(p['nome'])):
            if p['nome'] in i['nome_en']:i['nome_en']=i['nome_en'].replace(p['nome'],p['nome_en'])
    return c


MOB_EN={'mob_frota':'Registered fleet','mob_automoveis':'Cars','mob_motos':'Motorcycles and scooters','mob_onibus_total':'Buses and minibuses','mob_carga':'Trucks and tractor units','mob_populacao':'Reference population','mob_idade_total':'Vehicles in the manufacturing-year register','mob_idade_validos':'Vehicles with a valid manufacturing year','mob_idade_anos_soma':'Weighted sum of estimated vehicle ages','mob_idade_0_4':'Vehicles aged 0 to 4','mob_idade_5_9':'Vehicles aged 5 to 9','mob_idade_10_19':'Vehicles aged 10 to 19','mob_idade_20_mais':'Vehicles aged 20 or older','mob_idade_sem_ano':'Vehicles without a valid manufacturing year','mob_idade_10_mais':'Vehicles aged 10 or older'}
MOB_EN.update({'mob_'+k:v for k,v in dict(bondes='Trams',caminhoes='Trucks',caminhao_trator='Tractor units',caminhonetes='Pickup trucks',camionetas='Passenger/cargo vans',chassis='Platform chassis',ciclomotores='Mopeds',microonibus='Minibuses',motocicletas='Motorcycles',motonetas='Scooters',onibus='Buses',quadriciclos='Quadricycles',reboques='Trailers',semireboques='Semitrailers',sidecars='Sidecars',outros_veiculos='Other vehicles',tratores_esteira='Crawler tractors',tratores_rodas='Wheeled tractors',triciclos='Tricycles',utilitarios='Utility vehicles',cb_total='Vehicles in the fuel register',eletrificados='Registered electric and hybrid categories',esp_total='Vehicles in the class/axle register',eix_1_9='Records with 1 to 9 axles',cg_eix_1_9='Cargo vehicles with 1 to 9 axles',cg_eix_3_9='Cargo vehicles with 3 to 9 axles',obitos='Land transport deaths',ob_pedestres='Pedestrian deaths',ob_ciclistas='Cyclist deaths',ob_motociclistas='Motorcyclist deaths',ob_automoveis='Car occupant deaths',ob_caminhonetes='Pickup occupant deaths',ob_carga='Cargo vehicle occupant deaths',ob_onibus='Bus occupant deaths',ob_outros='Other land transport deaths',ob_homens='Deaths: men',ob_mulheres='Deaths: women',ob_sexo_ign='Deaths: sex not reported',ob_0_14='Deaths: aged 0 to 14',ob_15_29='Deaths: aged 15 to 29',ob_30_59='Deaths: aged 30 to 59',ob_60_mais='Deaths: aged 60 or older',ob_idade_ign='Deaths: age not reported',ob_15_mais='Deaths aged 15 or older',ob_rc_info='Deaths with race/colour reported',ob_esc_info='Deaths aged 15+ with education reported',ob_mes_ign='Deaths without a valid month').items()})
FUEL_EN={'ALCOOL':'Ethanol','GASOLINA':'Petrol','DIESEL':'Diesel','GASOLINA/ALCOOL':'Petrol/ethanol','ALCOOL/GASOLINA':'Ethanol/petrol','ELETRICO/FONTE EXTERNA':'Electric/external source','ELETRICO/FONTE INTERNA':'Electric/internal source','GASOGENIO':'Producer gas','GAS NATURAL VEICULAR':'Compressed natural gas','GAS METANO':'Methane','VIDE/CAMPO/OBSERVACAO':'See registration remarks','SEM COMBUSTIVEL':'Without fuel','NAO INFORMADO':'Not reported','GASOLINA/ELETRICO':'Petrol/electric','DIESEL/ELETRICO':'Diesel/electric','ALCOOL/ELETRICO':'Ethanol/electric','HIBRIDO':'Hybrid'}
FUEL_EN.update({'ELETRICO':'Electric','ETANOL':'Ethanol','GASOL':'Petrol','GAS NATURAL COMBUSTIVEL':'Natural gas fuel','GAS NATURAL':'Natural gas','GAS/NATURAL/LIQUEFEITO':'Liquefied natural gas','CELULA COMBUSTIVEL':'Fuel cell','HIBRIDO PLUG-IN':'Plug-in hybrid','NAO IDENTIFICADO':'Not identified','NA£O IDENTIFICADO':'Not identified (source encoding variant)','SEM INFORMAA§A£O':'Not reported (source encoding variant)','SEM INFORMACAO':'Not reported'})


def nome_mobilidade(i):
    id=i['id']
    if id in MOB_EN:return MOB_EN[id]
    grupos={
      'mob_esp_':('Vehicle class: ',dict(passageiro='passenger',carga='cargo',misto='mixed',corrida='racing',tracao='traction',especial='special',colecao='collection',sem_classe='not specifically classified')),
      'mob_eix_':('Axle register: ',{'1':'1 axle','2':'2 axles','3':'3 axles','4':'4 axles','5_9':'5 to 9 axles','zero':'zero or missing','outros':'other values'}),
      'mob_ob_rc_':('Deaths by race/colour: ',dict(branca='White',preta='Black',amarela='Asian',parda='Brown (parda)',indigena='Indigenous',ign='not reported')),
      'mob_ob_loc_':('Place of death: ',dict(hospital='hospital',outro_estab='other healthcare facility',domicilio='home',via_publica='public road',outro_local='other place',aldeia='Indigenous village',ign='not reported')),
      'mob_ob_mes_':('Deaths in ',dict(jan='January',fev='February',mar='March',abr='April',mai='May',jun='June',jul='July',ago='August',set='September',out='October',nov='November',dez='December')),
      'mob_ob_esc_':('Deaths aged 15+, education: ',dict(nenhuma='none',ign='not reported',**{'1_3':'1 to 3 years','4_7':'4 to 7 years','8_11':'8 to 11 years','12_mais':'12 years or more'})),
      'mob_ob_trab_':('Work-related accident field: ',dict(sim='yes',nao='no',ign='not reported',info='reported'))}
    for prefixo,(nome,valores)in grupos.items():
        if id.startswith(prefixo)and id[len(prefixo):]in valores:return nome+valores[id[len(prefixo):]]
    return i.get('nome_en',i['nome'])


def curar_mobilidade(c):
    c=copy.deepcopy(c)
    for i in c['indicadores']:
        i['nome_en']=nome_mobilidade(i)
        if i['nome'].startswith('Combustível: '):
            original=i['nome'].split(': ',1)[1]
            i['nome_en']='Fuel: '+FUEL_EN.get(original,' / '.join(FUEL_EN.get(x,x.title())for x in original.split('/')))
            i['categoria_original']=original
            i['nome']='Combustível: '+original.capitalize()
        if i.get('fonte')=='senatran':
            i['descricao_en']='Senatran/Renavam registered fleet; this is an administrative stock, not the fleet actually circulating. A registered vehicle may not be in use. Manufacturing-year ages are estimates, not an operational fleet survey.'
            nota=' Cadastro administrativo, não pesquisa da frota em circulação; um registro não comprova que o veículo esteja em uso. A idade usa o ano de fabricação.'
            i['descricao']=i['descricao'].replace(nota,'').rstrip()+nota
        elif i.get('fonte')=='sim':i['descricao_en']='Resident deaths, underlying ICD-10 cause V01–V89; includes land transport deaths outside public roads. The municipality is the place of residence, not necessarily the crash location.'
        else:i['descricao_en']='Reference resident population (SVS/IBGE). Missing values are preserved.'
    c['indicadores']=[curar_definicao(i)for i in c['indicadores']]
    c['derivados']=[curar_definicao(i)for i in c['derivados']]
    return c


def diferenciar_raiox(defs):
    """Qualifica nomes ambíguos pelo universo e tema, mantendo todos os indicadores."""
    defs=[curar_definicao(i)for i in defs]
    groups=defaultdict(list)
    for i in defs:
        if i.get('rede','todas')not in ['todas','']:continue
        percentual=i.get('formato')=='percentual'or'%'in i.get('unidade','')
        nome=i.get('nome_original')if not percentual else None
        groups[nome or i['nome']].append(i)
    areas={'mobilidade':('Mobilidade','Mobility'),'seguranca':('Segurança','Public safety'),'internet':('Internet','Internet'),'energia':('Energia','Energy'),'comex':('Comércio exterior','Foreign trade')}
    for name,items in groups.items():
        if len(items)<2:continue
        contextos=[i.get('tema')for i in items]
        for i in items:
            if name=='População de referência':pt,en=areas.get(i.get('area'),(i['fonte_nome'],i['fonte_nome']))
            elif len(set(contextos))>1:pt,en=i.get('tema',''),i.get('tema_en',i.get('tema',''))
            elif len({i.get('unidade')for i in items})>1:pt,en=i.get('unidade',''),i.get('unidade_en',i.get('unidade',''))
            else:pt,en=i.get('fonte_nome',''),i.get('fonte_nome','')
            for key in ['nome','nome_original']:
                if key in i and pt and not i[key].endswith(' · '+pt):i[key]+=' · '+pt
                if key+'_en'in i and en and not i[key+'_en'].endswith(' · '+en):i[key+'_en']+=' · '+en
    return defs
