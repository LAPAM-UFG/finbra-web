"""Universos separados: declarações de óbito (SIM) e registros policiais (Sinesp)."""
ANOS=list(range(2013,2026))
CONDICOES={0:'Registrado',1:'Zero registrado',2:'Indisponível nesta fonte/ano',3:'Denominador ausente',4:'Denominador zero',5:'Fora da cobertura',11:'Contagem parcial do ano',16:'Cobertura municipal incompleta',23:'Zero publicado em toda a UF; cobertura não confirmada',24:'Ano sem os 12 meses válidos'}
SIM_URL='https://dadosabertos.saude.gov.br/dataset/sim'
SINESP_URL='https://www.gov.br/mj/pt-br/assuntos/sua-seguranca/seguranca-publica/estatistica/dados-nacionais-1/base-de-dados-e-notas-metodologicas-dos-gestores-estaduais-sinesp-vde-2022-e-2023'
NOTA_SIM='SIM definitivo, óbitos não fetais de residentes, ano do óbito. Agressões: X85–Y09; suicídios: X60–X84; intenção indeterminada: Y10–Y34; intervenção legal: Y35. Óbitos por armas de fogo: W32–W34, X72–X74, X93–X95, Y22–Y24 e Y35.0. Agressão no SIM não equivale à classificação penal de homicídio ou feminicídio. Perfis descrevem os registros e não medem o risco específico de cada grupo. Taxas brutas, sem ajuste etário; pequenas contagens oscilam muito.'
NOTA_SINESP='Sinesp VDE/MJSP, abrangência Estadual, registros de vítimas enviados pelos gestores estaduais, desde 2015. Polícia Federal e Polícia Rodoviária Federal não são somadas. Não se mistura com o SIM, nem se soma homicídio doloso a categorias sem conferir sua definição. Totais anuais comparáveis exigem 12 meses com valores válidos. A soma de linhas complementares do mesmo evento/mês preserva os componentes publicados. Ausência de linha ou campo nulo não vira zero. Séries zeradas em toda uma UF/ano/evento ficam identificadas; a fonte não permite comprovar completude apenas pela presença de zeros, por isso essas séries ficam fora das taxas e rankings. Eventos disponíveis apenas por UF não são distribuídos pelos municípios.'
NOTA_BASE='Comparações e mapas usam taxas, proporções e média anual de triênios. Referências regionais somam os mesmos pares municipais válidos; nunca fazem média simples de taxas. Usam a divisão regional atual do IBGE em toda a série. População: SVS/MS, referência IBGE, igual à Saúde. Totais UF/Brasil podem incluir registros sem município identificado; as taxas indicam sua base municipal válida. Contagem e condição permanecem disponíveis nos downloads.'

CORE={
 'agressoes':('Óbitos por agressão','Deaths from assault',"cid BETWEEN 'X85' AND 'Y09'"),
 'suicidios':('Óbitos por suicídio','Deaths from suicide',"cid BETWEEN 'X60' AND 'X84'"),
 'indeterminada':('Óbitos de intenção indeterminada','Deaths of undetermined intent',"cid BETWEEN 'Y10' AND 'Y34'"),
 'intervencao':('Óbitos por intervenção legal','Deaths from legal intervention',"cid='Y35'"),
 'armas_fogo':('Óbitos por armas de fogo, todas as intenções','Firearm deaths, all intents',"cid BETWEEN 'W32' AND 'W34' OR cid BETWEEN 'X72' AND 'X74' OR cid BETWEEN 'X93' AND 'X95' OR cid BETWEEN 'Y22' AND 'Y24' OR cid4='Y350'")}
RACAS=[('branca','Branca','White','1'),('preta','Preta','Black','2'),('amarela','Amarela','Asian','3'),('parda','Parda','Brown','4'),('indigena','Indígena','Indigenous','5'),('ign','Sem informação','Unknown',None)]
SEXOS=[('h','Homens','Men',"SEXO IN ('1','M')"),('m','Mulheres','Women',"SEXO IN ('2','F')"),('ign','Sexo ignorado','Unknown sex',"SEXO IS NULL OR SEXO NOT IN ('1','M','2','F')")]
IDADES=[('0_14','0 a 14 anos','Aged 0–14','idade_anos<15'),('15_29','15 a 29 anos','Aged 15–29','idade_anos BETWEEN 15 AND 29'),('30_59','30 a 59 anos','Aged 30–59','idade_anos BETWEEN 30 AND 59'),('60_mais','60 anos ou mais','Aged 60+','idade_anos>=60'),('ign','Idade ignorada','Unknown age','idade_anos IS NULL')]
ESCOLAS=[('nenhuma','Nenhuma escolaridade','No schooling','1'),('1_3','1 a 3 anos de estudo','1–3 years of schooling','2'),('4_7','4 a 7 anos de estudo','4–7 years of schooling','3'),('8_11','8 a 11 anos de estudo','8–11 years of schooling','4'),('12_mais','12 anos ou mais de estudo','12+ years of schooling','5'),('ign','Escolaridade ignorada','Unknown schooling',None)]
LOCAIS=[('hospital','Hospital','Hospital','1'),('outro_estab','Outro estabelecimento de saúde','Other healthcare facility','2'),('domicilio','Domicílio','Home','3'),('via_publica','Via pública','Public road','4'),('outro','Outro local','Other location','5'),('aldeia','Aldeia indígena','Indigenous village','6'),('ign','Local ignorado','Unknown location',None)]
MESES=[('jan','Janeiro','January'),('fev','Fevereiro','February'),('mar','Março','March'),('abr','Abril','April'),('mai','Maio','May'),('jun','Junho','June'),('jul','Julho','July'),('ago','Agosto','August'),('set','Setembro','September'),('out','Outubro','October'),('nov','Novembro','November'),('dez','Dezembro','December')]
SINESP={
 'homicidio':('Homicídio doloso','Intentional homicide','Homicídio doloso'),
 'feminicidio':('Feminicídio','Femicide','Feminicídio'),
 'latrocinio':('Roubo seguido de morte (latrocínio)','Robbery resulting in death','Roubo seguido de morte (latrocínio)'),
 'lesao_morte':('Lesão corporal seguida de morte','Bodily injury resulting in death','Lesão corporal seguida de morte'),
 'tent_hom':('Tentativa de homicídio','Attempted homicide','Tentativa de homicídio'),
 'tent_fem':('Tentativa de feminicídio','Attempted femicide','Tentativa de feminicídio'),
 'suicidio':('Suicídio registrado pela polícia','Police-recorded suicide','Suicídio'),
 'esclarecer':('Mortes a esclarecer, sem indício de crime','Deaths to clarify, no sign of crime','Mortes a esclarecer (sem indício de crime)')}
SINESP.update({
 'mandados':('Mandados de prisão cumpridos','Arrest warrants executed','Mandado de prisão cumprido'),
 'transito':('Mortes no trânsito · registro policial','Road deaths · police records','Morte no trânsito ou em decorrência dele (exceto homicídio doloso)')})
SINESP_CAMPOS={'mandados':'total'}
SINESP_MENSAIS=['homicidio','feminicidio','suicidio']
MEIOS_AG=[
 ('cortante','Objeto cortante ou penetrante','Sharp object',"cid='X99'"),
 ('contundente','Objeto contundente','Blunt object',"cid='Y00'"),
 ('sufocacao','Enforcamento, estrangulamento e sufocação','Hanging, strangulation and suffocation',"cid='X91'"),
 ('forca','Força corporal','Bodily force',"cid='Y04'"),
 ('nao_espec','Meio não especificado','Unspecified means',"cid='Y09'"),
 ('outros','Outros meios especificados','Other specified means',"cid NOT BETWEEN 'X93' AND 'X95' AND cid NOT IN ('X99','Y00','X91','Y04','Y09')")]

def definicoes_sim():
 out={}
 def add(id,nome,en,expr,familia='sim',extra=''):
  out['sec_'+id]=dict(nome=nome,nome_en=en,expr=expr,familia=familia,fonte='sim',descricao=(extra+' '+NOTA_SIM).strip())
 for id,(n,en,e)in CORE.items():add(id,n,en,e)
 for id,n,en,e in [('ag_armas','Agressões por arma de fogo','Assaults by firearm',"cid BETWEEN 'X93' AND 'X95'"),('su_armas','Suicídios por arma de fogo','Suicides by firearm',"cid BETWEEN 'X72' AND 'X74'"),('in_armas','Arma de fogo: intenção indeterminada','Firearm: undetermined intent',"cid BETWEEN 'Y22' AND 'Y24'"),('ac_armas','Disparos acidentais de arma de fogo','Accidental firearm discharges',"cid BETWEEN 'W32' AND 'W34'"),('il_armas','Intervenção legal por arma de fogo','Legal intervention by firearm',"cid4='Y350'")]:add(id,n,en,e,'armas')
 ag=CORE['agressoes'][2];su=CORE['suicidios'][2]
 for pre,cause,label,label_en in [('ag',ag,'Agressão','Assault'),('su',su,'Suicídio','Suicide')]:
  for id,n,en,e in SEXOS:add(f'{pre}_sex_{id}',label+': '+n,label_en+': '+en,f'({cause})AND({e})',pre+'_sexo')
  for id,n,en,e in IDADES:add(f'{pre}_id_{id}',label+': '+n,label_en+': '+en,f'({cause})AND({e})',pre+'_idade')
 for id,n,en,code in RACAS:
  e=f"RACACOR='{code}'"if code else"RACACOR IS NULL OR RACACOR NOT IN ('1','2','3','4','5')"
  add('ag_rc_'+id,'Agressão: raça/cor '+n,'Assault: race/colour '+en,f'({ag})AND({e})','ag_raca')
 add('ag_15_mais','Agressão: óbitos com 15 anos ou mais','Assault deaths aged 15+',f'({ag})AND idade_anos>=15','denominadores')
 for id,n,en,code in ESCOLAS:
  e=f"ESC='{code}'"if code else"ESC IS NULL OR ESC NOT IN ('1','2','3','4','5')"
  add('ag_esc_'+id,'Agressão (15+): '+n,'Assault (15+): '+en,f'({ag})AND idade_anos>=15 AND({e})','ag_escolaridade','ESC em anos de estudo. Inclui ignorados no denominador de 15+; não converte ESC2010.')
 for id,n,en,code in LOCAIS:
  e=f"LOCOCOR='{code}'"if code else"LOCOCOR IS NULL OR LOCOCOR NOT IN ('1','2','3','4','5','6')"
  add('ag_loc_'+id,'Agressão: falecimento em '+n,'Assault: place of death '+en,f'({ag})AND({e})','ag_local','LOCOCOR é o local do falecimento, não necessariamente o da agressão.')
 for mes,(id,n,en)in enumerate(MESES,1):add('ag_mes_'+id,'Agressão: óbitos em '+n,'Assault: deaths in '+en,f'({ag})AND mes_obito={mes}','ag_meses','Mês da data do óbito, não necessariamente da agressão.')
 add('ag_mes_ign','Agressão: mês ignorado','Assault: unknown month',f'({ag})AND(mes_obito IS NULL OR mes_obito NOT BETWEEN 1 AND 12)','ag_meses')
 for id,n,en,e in MEIOS_AG:
  add('ag_meio_'+id,'Agressão: '+n,'Assault: '+en,f'({ag})AND({e})','ag_meios','Meio informado pela causa básica CID-10; grupos mutuamente exclusivos junto às armas de fogo.')
 for id,n,en,code in RACAS:
  e=f"RACACOR='{code}'"if code else"RACACOR IS NULL OR RACACOR NOT IN ('1','2','3','4','5')"
  add('su_rc_'+id,'Suicídio: raça/cor '+n,'Suicide: race/colour '+en,f'({su})AND({e})','su_raca')
 add('su_15_mais','Suicídio: óbitos com 15 anos ou mais','Suicide deaths aged 15+',f'({su})AND idade_anos>=15','denominadores')
 for id,n,en,code in ESCOLAS:
  e=f"ESC='{code}'"if code else"ESC IS NULL OR ESC NOT IN ('1','2','3','4','5')"
  add('su_esc_'+id,'Suicídio (15+): '+n,'Suicide (15+): '+en,f'({su})AND idade_anos>=15 AND({e})','su_escolaridade','ESC em anos de estudo; inclui ignorados no denominador de 15+.')
 for id,n,en,code in LOCAIS:
  e=f"LOCOCOR='{code}'"if code else"LOCOCOR IS NULL OR LOCOCOR NOT IN ('1','2','3','4','5','6')"
  add('su_loc_'+id,'Suicídio: falecimento em '+n,'Suicide: place of death '+en,f'({su})AND({e})','su_local','Local do falecimento, não necessariamente o do evento.')
 for mes,(id,n,en)in enumerate(MESES,1):
  add('su_mes_'+id,'Suicídio: óbitos em '+n,'Suicide: deaths in '+en,f'({su})AND mes_obito={mes}','su_meses','Mês do falecimento.')
 add('su_mes_ign','Suicídio: mês ignorado','Suicide: unknown month',f'({su})AND(mes_obito IS NULL OR mes_obito NOT BETWEEN 1 AND 12)','su_meses')
 return out
SIM_DEFS=definicoes_sim()
