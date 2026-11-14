"""Curadoria dos indicadores: unidades e definições não são inferidas dos valores."""
import hashlib
from assistencia_cadunico import campo

TEMAS = {
 'cadastro': ('Cadastro e marcadores de benefícios','Registration and benefit markers'),
 'demografia': ('Idade, sexo e raça/cor','Age, sex and race/colour'),
 'responsaveis': ('Responsáveis pelas famílias','Family representatives'),
 'educacao': ('Escolaridade e frequência escolar','Education and school attendance'),
 'trabalho': ('Trabalho das pessoas cadastradas','Work among registered people'),
 'deficiencia': ('Deficiência e cuidados','Disability and care'),
 'familias': ('Composição e grupos familiares','Family composition and groups'),
 'vulnerabilidade': ('Vulnerabilidade cadastral','Registration-based vulnerability'),
 'pbf_folha': ('Bolsa Família: folha do MDS','Bolsa Família: MDS payroll'),
 'pbf_pagamentos': ('Pagamentos do Bolsa Família e Auxílio Brasil','Bolsa Família and Auxílio Brasil payments'),
 'bpc': ('BPC: benefícios com pagamento','BPC: benefits with payments'),
 'bpc_detalhes': ('BPC: parcelas e informações judiciais','BPC: instalments and judicial information'),
}

def indicador(id,nome,en,fonte,tema,unidade='numero',descricao=None,descricao_en=None,**opts):
    pt,eng=TEMAS.get(tema,(tema,tema))
    return dict(id=id,nome=nome,nome_en=en,fonte=fonte,tema=pt,tema_en=eng,unidade=unidade,
                descricao=descricao or nome,descricao_en=descricao_en or en,acumulavel=False,**opts)

def cad_catalogo():
    rows=[]
    def add(name,pt,en,tema='cadastro',unidade='numero',**opts):
        rows.append(indicador(campo('im_'+name),pt,en,'cadunico',tema,unidade,
            f'{pt}. Contagem do Observatório público do Cadastro Único; pode se sobrepor a outros perfis. Células pequenas protegidas pela fonte permanecem sem valor.',
            f'{en}. Count from the public Cadastro Único Observatory; profiles may overlap. Small cells protected by the source remain unavailable.',**opts))
    add('qtd_familias','Famílias no CadÚnico','Families in Cadastro Único',destaque=True)
    add('qtd_pessoas','Pessoas no CadÚnico','People in Cadastro Único',destaque=True)
    add('pessoas_por_familia','Pessoas por família cadastrada','People per registered family',unidade='decimal')
    add('qtd_familias_pbf','Famílias com marcador de Bolsa Família no cadastro','Families marked as Bolsa Família in the register')
    add('qtd_pessoas_pbf','Pessoas em famílias com marcador de Bolsa Família','People in families marked as Bolsa Família')
    add('qtd_pessoas_bpc','Pessoas com indicação de BPC no cadastro','People marked as BPC recipients in the register')
    for n,pt,en in [('01_Entre0e3','0 a 3 anos','0–3 years'),('02_Entre4a6','4 a 6 anos','4–6 years'),
      ('03_Entre7a15','7 a 15 anos','7–15 years'),('04_Entre16a17','16 a 17 anos','16–17 years'),
      ('05_Entre18a24','18 a 24 anos','18–24 years'),('06_Entre25a34','25 a 34 anos','25–34 years'),
      ('07_Entre35a39','35 a 39 anos','35–39 years'),('08_Entre40a44','40 a 44 anos','40–44 years'),
      ('09_Entre45a49','45 a 49 anos','45–49 years'),('10_Entre50a54','50 a 54 anos','50–54 years'),
      ('11_Entre55a59','55 a 59 anos','55–59 years'),('12_Entre60a64','60 a 64 anos','60–64 years'),
      ('13_MaiorQue65','65 anos ou mais','65 years or older')]:
        add('faixa_etaria_'+n,'Pessoas: '+pt,'People: '+en,'demografia')
    for n,pt,en in [('01_Branca','branca','White'),('02_Preta','preta','Black'),('03_Amarela','amarela','Asian'),
                    ('04_Parda','parda','Brown'),('05_Indígena','indígena','Indigenous'),('99_sem_resposta','não informada','not stated')]:
        add('raca_cor_'+n,'Pessoas de raça/cor '+pt,'People by race/colour: '+en,'demografia')
        add('rf_raca_cor_'+n,'Responsáveis de raça/cor '+pt,'Family representatives by race/colour: '+en,'responsaveis')
    for suffix,pt,en in [('feminino','feminino','female'),('masculino','masculino','male')]:
        add('qtd_pessoas_sexo_'+suffix,'Pessoas: sexo '+pt,'People: '+en,'demografia')
        add('rf_sexo_'+suffix,'Responsáveis: sexo '+pt,'Family representatives: '+en,'responsaveis')
    for n,pt,en in [('sem_escolaridade','Sem escolaridade','No schooling'),('instrucao_fundamental_incompleto','Fundamental incompleto','Incomplete primary/lower secondary'),
      ('instrucao_fundamental_completo','Fundamental completo','Completed primary/lower secondary'),('instrucao_medio_incompleto','Médio incompleto','Incomplete upper secondary'),
      ('instrucao_medio_completo','Médio completo','Completed upper secondary'),('instrucao_superior_incompleto_ou_mais','Superior incompleto ou mais','Some tertiary education or more'),
      ('escolaridade_indefinida','Escolaridade não definida','Schooling not defined'),('nao_sabe_ler_escrever','Não sabem ler e escrever','Unable to read and write'),
      ('sabe_ler_escrever','Sabem ler e escrever','Able to read and write'),('escola_nunca_frequentou','Nunca frequentaram escola','Never attended school'),
      ('escola_nao_frequenta_mas_ja_frequentou','Já frequentaram, mas não frequentam escola','Previously attended school'),
      ('escola_rede_publica','Frequentam escola pública','Attend public school'),('escola_rede_particular','Frequentam escola particular','Attend private school')]:
        add(n,'Pessoas: '+pt,'People: '+en,'educacao')
    for n,pt,en in [('pessoas_que_trabalham','Pessoas que trabalham','People who work'),('empregado_formal','Pessoas em emprego formal','People in formal employment'),
      ('empregado_informal','Pessoas em emprego informal','People in informal employment'),('atividade_trabalho_conta_propria','Pessoas que trabalham por conta própria','Self-employed people'),
      ('atividade_empregador','Empregadores','Employers'),('atividade_aprendiz','Aprendizes','Apprentices'),('atividade_estagiario','Estagiários','Interns'),
      ('atividade_nao_remunerado','Trabalhadores não remunerados','Unpaid workers'),('qtd_pessoas_trabalho_infantil','Pessoas com trabalho infantil registrado','People with child labour recorded')]:
        add(n,pt,en,'trabalho')
    for n,pt,en in [('deficiencia','com deficiência','with a disability'),('cegueira','com cegueira','with blindness'),('baixa_visao','com baixa visão','with low vision'),
      ('surdez_profunda','com surdez profunda','with profound deafness'),('surdez_leve','com surdez leve','with mild deafness'),
      ('fisica','com deficiência física','with a physical disability'),('mental','com deficiência mental ou intelectual','with a mental or intellectual disability'),
      ('sindrome_down','com síndrome de Down','with Down syndrome'),('trasntorno_mental','com transtorno mental','with a mental disorder'),
      ('cuidados_permanentes','que necessitam de cuidados permanentes','requiring permanent care')]:
        add('qtd_pessoas_'+n,'Pessoas '+pt,'People '+en,'deficiencia')
    for n,pt,en in [('qtd_familias_gpte','Famílias de grupos populacionais tradicionais e específicos','Families from traditional and specific population groups'),
      ('familia_indigena','Famílias indígenas','Indigenous families'),('familia_quilombola','Famílias quilombolas','Quilombola families'),
      ('qtd_familias_situacao_rua','Famílias com pessoas em situação de rua','Families with homeless members'),
      ('qtd_pessoas_situacao_rua','Pessoas em situação de rua','Homeless people'),('qtd_familias_estrangeiros','Famílias com estrangeiros','Families with foreign nationals'),
      ('familia_00a03','Famílias com crianças de 0 a 3 anos','Families with children aged 0–3'),('familia_04a06','Famílias com crianças de 4 a 6 anos','Families with children aged 4–6'),
      ('familia_07a17','Famílias com crianças/adolescentes de 7 a 17 anos','Families with children aged 7–17'),
      ('familia_18a59','Famílias com adultos de 18 a 59 anos','Families with adults aged 18–59'),
      ('familia_apenas_18a59','Famílias somente com adultos de 18 a 59 anos','Families consisting only of adults aged 18–59'),
      ('familia_60oumais','Famílias com pessoas de 60 anos ou mais','Families with people aged 60 or older')]:
        add(n,pt,en,'familias')
    rows.append(indicador(campo('im_ivcad__geral'),'IVCAD: vulnerabilidade das famílias','IVCAD: family vulnerability','cadunico','vulnerabilidade','indice',
        'Índice de 0 a 1 do MDS: quanto maior, mais vulnerabilidade. Abrange famílias do Bolsa Família e demais famílias elegíveis com cadastro atualizado e renda de até meio salário mínimo por pessoa; não toda a população. Agregados ponderados pelas famílias, fornecidos pelo MDS.',
        'MDS index from 0 to 1: higher means greater vulnerability. Covers Bolsa Família families and other eligible, up-to-date registered families with per-capita income up to half the minimum wage; not the entire population. Family-weighted aggregates supplied by MDS.'))
    return rows

def perfil_id(dim,categoria,tipo):
    return 'cad_perfil_'+hashlib.sha256((dim+'|'+categoria+'|'+tipo).encode()).hexdigest()[:12]

PERFIS = {
 'DS_FAIXA_RENDA_PER_CAPITA':('Renda por pessoa','Income per person'),
 'DS_FAIXA_RENDA_PER_CAPITA_SM':('Renda em salários mínimos','Income in minimum wages'),
 'DS_MESES_ATUALIZACAO':('Atualização do cadastro','Registration updates'),
 'DS_SITUACAO_DOMICILIO':('Domicílio urbano e rural','Urban and rural households'),
 'DS_ESPECIE_DOMICILIO':('Tipo de domicílio','Type of dwelling'),
 'DS_ARRANJO_FAMILIAR':('Arranjo familiar','Family arrangement'),
 'DS_ARRANJO_QTD_MEMBRO':('Tamanho da família','Family size'),
}
TRADUCAO = {'Pobreza':'Poverty','Baixa renda':'Low income','Acima de 1/2 SM':'Above half the minimum wage',
 'Até 1/4 SM':'Up to a quarter of the minimum wage','Acima de 1/4 SM até 1/2 SM':'Above a quarter up to half the minimum wage',
 'Acima de 1/2 SM até 1 SM':'Above half up to one minimum wage','Acima de 1 SM':'Above one minimum wage',
 'até 12 Meses':'Up to 12 months','acima de 12 até 18 Meses':'Over 12 up to 18 months','acima de 18 até 24 Meses':'Over 18 up to 24 months',
 'acima de 24 até 36 Meses':'Over 24 up to 36 months','acima de 37 até 48 Meses':'Over 37 up to 48 months',
 'Urbana':'Urban','Rural':'Rural','Sem resposta':'Not stated','-':'Not stated','Não informado':'Not stated',
 'Unipessoal':'One-person family','Monoparental feminino':'Female single-parent family','Monoparental masculino':'Male single-parent family',
 'Casal com filho(s)':'Couple with children','Casal sem filho(s)':'Couple without children','Outros':'Other',
 'Unipessoal em sit. de rua':'One-person homeless family','Unipessoal em dom. coletivo':'One-person family in collective housing',
 'Unipessoal em dom. com famílias conviventes':'One-person family sharing a dwelling with other families',
 'Particular Permanente':'Permanent private dwelling','Particular Improvisado':'Improvised private dwelling','Coletivo':'Collective dwelling'}

def catalogo_perfis(categorias):
    result=[]
    for dim,cats in categorias.items():
        pt,en=PERFIS[dim]
        for cat in cats:
            eng=TRADUCAO.get(cat)
            if eng is None and cat.endswith(' pessoas'):eng=cat.replace(' pessoas',' people')
            if cat=='8 ou mais pessoas':eng='8 or more people'
            if eng is None:eng=cat  # rótulo literal da fonte, sem inventar uma categoria
            for kind,prefix,pref_en in [('familias','Famílias','Families'),('pessoas','Pessoas','People')]:
                result.append(indicador(perfil_id(dim,cat,kind),prefix+': '+cat,pref_en+': '+eng,'cadunico',pt,'numero',
                    f'{prefix} na categoria “{cat}” da variável {dim} do Observatório público. A faixa de renda é declarada no cadastro e usa os limites vigentes na referência. Não equivale à elegibilidade nem à cobertura do Bolsa Família.',
                    f'{pref_en} in category “{eng}” of public Observatory variable {dim}. Income bands use declared registration income and thresholds applying to that reference. This does not measure Bolsa Família eligibility or coverage.'))
                result[-1]['tema_en']=en
    return result

def bpc_catalogo():
    info=[('beneficios','Benefícios do BPC com pagamento','BPC benefits with payments','numero',True),
          ('valor_pago','Valor pago pelo BPC no mês','BPC amount paid in the month','moeda',True),
          ('pagamentos','Parcelas pagas do BPC','BPC instalments paid','numero',False),
          ('pagamentos_retroativos','Parcelas de referências anteriores','Instalments for earlier reference months','numero',False),
          ('valor_retroativo','Valor das parcelas de referências anteriores','Amount of instalments for earlier reference months','moeda',False),
          ('beneficios_judiciais','Benefícios com indicação judicial','Benefits marked as court-granted','numero',False),
          ('beneficios_judicial_nao_informado','Benefícios sem informação judicial','Benefits without judicial information','numero',False),
          ('valor_judicial','Valor com indicação judicial','Amount marked as court-granted','moeda',False)]
    out=[]
    for field,pt,en,unit,featured in info:
        r=indicador('bpc_'+field,pt,en,'bpc','bpc' if featured else 'bpc_detalhes',unit,
          'Portal da Transparência/CGU. Benefícios são números de benefício distintos com pagamento na competência, não pessoas únicas ou estoque de benefícios ativos. Parcelas podem ser retroativas. Informação judicial não informada não significa ausência de concessão judicial.',
          'Transparency Portal/CGU. Benefits are distinct benefit numbers with payments in the payroll month, not unique people or the stock of active benefits. Instalments may be retroactive. Missing judicial information does not mean a benefit was not court-granted.',destaque=featured)
        r['acumulavel']=unit=='moeda'
        if unit=='moeda':r['precos']='nominais'
        out.append(r)
        if unit=='moeda':
            real={**r,'id':r['id']+'_real','nome':pt+' (IPCA)','nome_en':en+' (IPCA adjusted)','precos':'reais','destaque':False}
            out.append(real)
    return out

def pbf_cgu_catalogo():
    out=[]
    for field,pt,en,unit in [('valor','Valor pago: Bolsa Família/Auxílio Brasil','Amount paid: Bolsa Família/Auxílio Brasil','moeda'),
      ('parcelas','Parcelas pagas: Bolsa Família/Auxílio Brasil','Instalments paid: Bolsa Família/Auxílio Brasil','numero'),
      ('responsaveis','Responsáveis com pagamento no município','Family representatives paid in the municipality','numero')]:
        r=indicador('pbf_cgu_'+field,pt,en,'pbf','pbf_pagamentos',unit,
          'Pagamentos efetivos agregados do Portal da Transparência/CGU. Bolsa Família até novembro/2021, Auxílio Brasil de novembro/2021 a fevereiro/2023 e Novo Bolsa Família desde março/2023. Novembro/2021 contém os dois programas; responsáveis distintos nos municípios não podem ser somados como pessoas únicas no estado ou no Brasil. A série de valores não inclui o Benefício Extraordinário do Auxílio Brasil: 2021–2023 requer cautela.',
          'Actual payments aggregated from the Transparency Portal/CGU. Bolsa Família through November 2021, Auxílio Brasil from November 2021 to February 2023, and Novo Bolsa Família since March 2023. Both programmes paid in November 2021; municipal distinct representatives cannot be added as unique state or national people. Amounts exclude the extraordinary Auxílio Brasil benefit: interpret 2021–2023 with caution.')
        r['acumulavel']=unit=='moeda';r['destaque']=unit=='moeda'
        if unit=='moeda':r['precos']='nominais'
        out.append(r)
        if unit=='moeda':out.append({**r,'id':r['id']+'_real','nome':pt+' (IPCA)','nome_en':en+' (IPCA adjusted)','precos':'reais','destaque':False})
    return out
