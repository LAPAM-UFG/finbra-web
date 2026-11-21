"""Medidas e limites de interpretação do painel de Energia."""
GD_URL='https://dadosabertos.aneel.gov.br/dataset/relacao-de-empreendimentos-de-geracao-distribuida'
SIGA_URL='https://dadosabertos.aneel.gov.br/dataset/siga-sistema-de-informacoes-de-geracao-da-aneel'
NOTA_GD='MMGD: empreendimentos de micro e minigeração distribuída presentes no cadastro da edição indicada. Potência instalada em MW; não é energia produzida ou consumida. Um empreendimento não equivale a uma pessoa ou domicílio. Município é o local da instalação geradora.'
NOTA_SIG='SIGA: usinas identificadas por CEG, contadas uma vez por recorte. Em municípios, uma usina compartilhada pode aparecer em mais de um município; essas contagens não são somáveis. UF usa a UF principal declarada no SIGA. Potência municipal fica indisponível quando a categoria contém usina compartilhada, sem rateio arbitrário. Em operação usa potência fiscalizada; construção usa potência outorgada.'
NOTA_COORTE='Série retrospectiva dos empreendimentos presentes no cadastro atual, por data de conexão informada nos arquivos técnicos. Não representa o estoque histórico nem inclui empreendimentos retirados do cadastro. Potência atual não é atribuída ao ano de conexão. Registros sem data ficam identificados. O último ano está incompleto.'
NOTA_GD_EN='MMGD installations present in the stated registry edition. Installed capacity in MW, not electricity generated or consumed. Installations are not unique people or homes. Municipality refers to the generating installation.'
NOTA_SIG_EN='SIGA plants are counted once per scope. Shared plants may occur in multiple municipalities, so local counts are not additive. States use the reported principal state. Municipal capacity is unavailable for categories containing shared plants; no arbitrary allocation. Operating plants use inspected capacity; construction uses authorised capacity.'
NOTA_COORTE_EN='Retrospective cohorts of installations present in the current registry, using connection dates from technical files. This is not historical stock and excludes installations removed from the registry. Current capacity is not assigned to connection years. Undated records are identified. The latest year is incomplete.'
CONDICOES={0:'Registrado',1:'Zero no cadastro',2:'Indisponível ou potência compartilhada',3:'Denominador ausente',4:'Denominador zero',5:'Fora da cobertura',16:'Cobertura incompleta'}
FONTES=[('solar','Solar','Solar'),('eolica','Eólica','Wind'),('hidrica','Hídrica','Hydro'),('termica','Térmica','Thermal'),('outras','Outras ou não informadas','Other or unspecified')]
CLASSES=[('res','Residencial','Residential'),('com','Comercial','Commercial'),('rural','Rural','Rural'),('ind','Industrial','Industrial'),('outras','Outras classes ou não informadas','Other or unspecified classes')]
PORTES=[('micro','Microgeração','Microgeneration'),('mini','Minigeração','Minigeneration'),('outros','Outros ou não informados','Other or unspecified')]
FONTES_SIGA=[('solar','Solar','Solar'),('eolica','Eólica','Wind'),('hidrica','Hídrica','Hydro'),('biomassa','Biomassa','Biomass'),('fossil','Fóssil','Fossil'),('nuclear','Nuclear','Nuclear'),('outras','Outras ou não informadas','Other or unspecified')]

def definicoes(meta):
 out=[];year=meta['ano']
 def add(id,pt,en,fam,un='instalações',source='mmgd',coorte=False,helper=False,desc=None):
  nota=NOTA_COORTE if coorte else NOTA_SIG if source=='siga'else NOTA_GD;nota_en=NOTA_COORTE_EN if coorte else NOTA_SIG_EN if source=='siga'else NOTA_GD_EN
  out.append(dict(id=id,nome=pt,nome_en=en,familia=fam,unidade=un,unidade_en={'instalações':'installations','usinas':'plants','habitantes':'residents','registros':'records'}.get(un,un),fonte=source,fonte_nome='ANEEL · SIGA'if source=='siga'else'ANEEL · MMGD',fonte_url=SIGA_URL if source=='siga'else GD_URL,descricao=(desc+' 'if desc else'')+nota,descricao_en=nota_en,anos=list(range(2013,year+1))if coorte else[year],tipo_periodo='coorte'if coorte else'atual',auxiliar=helper,notas_anos={str(y):[NOTA_COORTE,NOTA_COORTE_EN]for y in range(2013,year+1)}if coorte else{str(year):[f"Cadastro de {meta['siga_data']if source=='siga'else meta['mmgd_data']}.",f"Registry dated {meta['siga_data']if source=='siga'else meta['mmgd_data']}."]}))
 add('ene_gd_n','Instalações de geração distribuída','Distributed generation installations','gd_resumo')
 add('ene_gd_mw','Potência instalada da geração distribuída','Distributed generation installed capacity','gd_resumo','MW')
 for fam,items in [('fonte',FONTES),('classe',CLASSES),('porte',PORTES)]:
  for k,pt,en in items:
   add(f'ene_gd_{fam}_{k}_n',pt+' · instalações',en+' · installations','gd_'+fam)
   add(f'ene_gd_{fam}_{k}_mw',pt+' · potência',en+' · capacity','gd_'+fam,'MW')
 add('ene_gd_creditos','Soma dos registros de unidades que recebem créditos','Sum of credit-receiving unit records','gd_bases','registros',helper=True,desc='Soma por instalação geradora. A mesma unidade pode receber créditos de mais de uma instalação e estar em outro município. Não é contagem de beneficiários únicos ou de moradores do recorte.')
 add('ene_gd_sem_data','Instalações sem data de conexão recuperada','Installations without a recovered connection date','gd_bases',helper=True)
 add('ene_gd_antes2013','Instalações atuais conectadas antes de 2013','Current installations connected before 2013','gd_bases',helper=True)
 add('ene_gd_conexoes','Conexões por ano no cadastro atual','Connections by year in the current registry','gd_coorte',coorte=True)
 for k,pt,en in FONTES:add('ene_gd_con_'+k,pt+' · conexões por ano',en+' · connections by year','gd_coorte',coorte=True)
 for k,pt,en in [('op','Em operação','Operating'),('obra','Em construção','Under construction'),('projeto','Construção não iniciada','Construction not started')]:
  add('ene_siga_'+k+'_n',pt+' · usinas',en+' · plants','siga_fases','usinas','siga')
  add('ene_siga_'+k+'_mw',pt+(' · potência fiscalizada'if k=='op'else' · potência outorgada'),en+(' · inspected capacity'if k=='op'else' · authorised capacity'),'siga_fases','MW','siga')
 for k,pt,en in FONTES_SIGA:
  add('ene_siga_'+k+'_n',pt+' · usinas em operação',en+' · operating plants','siga_fontes','usinas','siga')
  add('ene_siga_'+k+'_mw',pt+' · potência em operação',en+' · operating capacity','siga_fontes','MW','siga')
 add('ene_siga_compart_n','Usinas em operação em mais de um município','Operating plants spanning multiple municipalities','siga_bases','usinas','siga',helper=True)
 add('ene_populacao','População de referência','Reference population','bases','habitantes',helper=True)
 out[-1].update(anos=list(range(2013,year+1)),tipo_periodo='anual',fonte_nome='IBGE / SVS',fonte_url='https://sidra.ibge.gov.br/tabela/6579',descricao='População de referência SVS/IBGE até 2025 e estimativa municipal IBGE de julho de 2026. Não é número de consumidores ou domicílios.',descricao_en='Reference population from SVS/IBGE through 2025 and July 2026 IBGE municipal estimates. Not a count of consumers or households.',notas_anos={})
 assert len({i['id']for i in out})==len(out)and all(len(i['id']+'_cond')<=32 for i in out)
 return out
