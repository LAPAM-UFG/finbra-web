"""Curadoria municipal: conceitos, unidades e componentes nas duas metodologias.

Os códigos originais são preservados no catálogo. Não se conecta uma linha do
SNIS a outra do SINISA no gráfico. Os componentes não preenchidos continuam nulos.
"""
CONDICOES={0:'observado',1:'sem registro na fonte',2:'denominador ausente',3:'denominador zero',4:'inconsistência nos dados de origem',5:'fora da cobertura da fonte',6:'sem resposta ao módulo'}

def m(id,nome,en,tema,unidade,snis,sinisa,oficial=None,descricao='',pct=False):
    return dict(id=id,variavel='san_'+id,nome=nome,nome_en=en,tema=tema,unidade=unidade,
        snis=snis,sinisa=sinisa,oficial=oficial or [None,None],fator=100 if pct else 1,
        descricao=descricao or nome,descricao_en=en,regra_agregado='razao' if pct else 'soma')

INDICADORES=[
 m('agua_pop','Pessoas atendidas com água','People served by water supply','agua','pessoas',['AG001'],['GTA0001+GTA0002']),
 m('agua_cobertura_pct','População atendida com água','Population served by water supply','agua','percentual',['AG001','GE12A|GE12B|POP_TOT'],['GTA0001+GTA0002','DFE0001'],['IN055','IAG0001'],pct=True),
 m('agua_urbana_pct','Atendimento urbano com água','Urban population served by water supply','agua','percentual',['AG026','GE06A|GE06B|POP_URB'],['GTA0001','DFE0002'],['IN023','IAG0002'],pct=True),
 m('agua_ligacoes','Ligações ativas de água','Active water connections','agua','ligacoes',['AG002'],['GTA0003']),
 m('agua_rede_km','Rede de distribuição de água','Water distribution network','agua','km',['AG005'],['GTA1102']),
 m('agua_consumida_m3','Volume de água consumido','Water consumed','agua','m3_ano',['AG010*1000'],['GTA1211*1000']),
 m('agua_produzida_m3','Volume de água produzido','Water produced','agua','m3_ano',['AG006*1000'],['GTA1001*1000']),
 m('agua_perdas_pct','Perdas de água na distribuição','Water distribution losses','agua','percentual',
   ['AG006+AG018-AG010-AG024','AG006+AG018-AG024'],['GTA1001+GTA1009-GTA1207-GTA1211-GTA1203','GTA1001+GTA1009'],['IN049','IAG2013'],pct=True,
   descricao='Parcela do volume perdido. SNIS: desconta o volume de serviço do denominador; SINISA: considera o volume de entrada e desconta consumos autorizados não faturados e exportações no numerador. Há mudança de metodologia em 2023.'),
 m('esgoto_pop','Pessoas atendidas com esgoto','People served by sewage collection','esgoto','pessoas',['ES001'],['GTE0001+GTE0002']),
 m('esgoto_cobertura_pct','População atendida com esgoto','Population served by sewage collection','esgoto','percentual',['ES001','GE12A|GE12B|POP_TOT'],['GTE0001+GTE0002','DFE0001'],['IN056','IES0001'],pct=True),
 m('esgoto_urbano_pct','Atendimento urbano com esgoto','Urban population served by sewage collection','esgoto','percentual',['ES026','GE06A|GE06B|POP_URB'],['GTE0001','DFE0002'],['IN024','IES0002'],pct=True),
 m('esgoto_ligacoes','Ligações ativas de esgoto','Active sewage connections','esgoto','ligacoes',['ES002'],['GTE0003']),
 m('esgoto_rede_km','Rede coletora de esgoto','Sewage collection network','esgoto','km',['ES004'],['GTE1001']),
 m('esgoto_coletado_m3','Volume de esgoto coletado','Sewage collected','esgoto','m3_ano',['ES005*1000'],['GTE1002*1000']),
 m('esgoto_tratado_m3','Volume de esgoto tratado','Sewage treated','esgoto','m3_ano',['ES006*1000'],['GTE1014*1000']),
 m('esgoto_tratamento_pct','Tratamento do esgoto coletado','Treatment of collected sewage','esgoto','percentual',
   ['ES006+ES014+ES015','ES005+ES013'],['GTE1014+GTE1015+GTE1013','GTE1002+GTE1009'],['IN016','IES2004'],pct=True,
   descricao='Esgoto tratado, incluindo os ajustes de importação e exportação para tratamento previstos na fonte, dividido pelo esgoto coletado e importado. Não é o percentual da população com esgoto tratado.'),
 m('residuos_pop','Pessoas com coleta regular de resíduos','People served by regular waste collection','residuos','pessoas',['CO164'],['GTR0201']),
 m('residuos_coleta_pct','População com coleta regular de resíduos','Population served by regular waste collection','residuos','percentual',['CO164','POP_TOT'],['GTR0201','DFE0001'],['IN015','IRS0001'],pct=True),
 m('residuos_urbana_pct','Coleta regular na área urbana','Regular urban waste collection','residuos','percentual',['CO050','POP_URB'],['GTR0202','DFE0002'],['IN016','IRS0002'],pct=True),
 m('residuos_massa_t','Resíduos domiciliares e públicos coletados','Household and public waste collected','residuos','t_ano',['CO119'],['GTR1028']),
 m('seletiva_urbana_pop','Pessoas com coleta seletiva porta a porta','People served by door-to-door selective collection','residuos','pessoas',['CS050'],['GTR0204'],descricao='População urbana com coleta seletiva porta a porta. No SINISA, com frequência mínima de uma vez por semana; a definição da fonte muda em 2023.'),
 m('seletiva_urbana_pct','Coleta seletiva: população urbana','Selective collection: urban population','residuos','percentual',['CS050','POP_URB'],['GTR0204','DFE0002'],[None,None],pct=True,
   descricao='População urbana com coleta seletiva porta a porta dividida pela população urbana informada. No SINISA, frequência mínima de uma vez por semana. Indicador calculado pelo LAPAM a partir dos componentes da fonte.'),
 m('drenagem_vias_km','Vias públicas urbanas','Urban public roads','drenagem','km',['IE017'],['GAP0304']),
 m('vias_pavimentadas_pct','Vias urbanas pavimentadas','Paved urban roads','drenagem','percentual',['IE019','IE017'],['GAP0303','GAP0304'],['IN020','IAP0001'],pct=True),
 m('drenagem_rede_km','Vias com rede pluvial subterrânea','Roads with underground stormwater drainage','drenagem','km',['IE024'],['GAP0305']),
 m('drenagem_rede_pct','Vias com rede pluvial subterrânea','Roads with underground stormwater drainage','drenagem','percentual',['IE024','IE017'],['GAP0305','GAP0304'],['IN021','IAP0002'],pct=True),
 m('inundacao_risco_dom','Domicílios urbanos sob risco de inundação','Urban households at risk of flooding','drenagem','domicilios',['RI013'],['GAP2110']),
 m('inundacao_risco_pct','Domicílios urbanos sob risco de inundação','Urban households at risk of flooding','drenagem','percentual',['RI013','GE008'],['GAP2110','GAP2103'],['IN040','IGR0001'],pct=True),
]
for i in INDICADORES:
    assert len(i['variavel']+'_cond')<=32
    i['descricao'] += ' Ausência de informação não é zero. UF/Brasil usam apenas municípios com os componentes válidos do mesmo ano; percentuais são razões das somas, não médias municipais.'
    i['descricao_en'] += '. Missing data are not zero. State/national aggregates use municipalities with valid components from the same year; percentages are ratios of sums.'
    if i['unidade']=='percentual':i['descricao']+=' Percentual de 0 a 100.'
    if i['tema']=='drenagem':i['descricao']+=' Série disponível a partir da primeira coleta de drenagem em 2015, com anos sem pesquisa preservados.'
