/**
 * Catálogo das variáveis e dos conceitos que a IA usa (o mesmo para a tela, a conferência e a exportação):
 *
 *   COLUNAS    unidade, rótulo, definição, fonte e ressalvas das colunas das tabelas do painel; a página formata
 *              pelo tipo declarado aqui (ou na própria consulta), sem adivinhar pelo nome
 *   CONCEITOS  o que a pergunta pede (ex.: Função 04 – Administração) e que colunas ou filtros o atendem: a
 *              revisão devolve ao modelo a resposta que troca a variável pedida por outra
 *
 * As instruções do modelo (worker/src/sistema*.js) descrevem as mesmas colunas e conceitos; o teste
 * "catálogo e instruções" confere que cada conceito daqui aparece lá.
 */
import type { Cobertura } from './ia';
import type { TipoColuna } from './ia_formato';

/** Fonte cujos anos (do manifesto) dão a cobertura temporal da coluna. */
export type ChaveCobertura = 'dca' | 'pib' | 'rais' | 'sim' | 'sinasc' | 'sih' | 'sia' | 'aps' | 'cnes' | 'sinan' | 'siscan' | 'oncologia' | 'resp';

export type Coluna = {
  tipo: TipoColuna;
  rotulo: string;
  definicao: string;
  fonte: string;
  ressalva?: string;
  /** tabelas do painel que têm a coluna */
  tabelas?: string[];
  /** cobertura temporal: a da fonte no manifesto (chave) ou um texto fixo */
  cobertura?: ChaveCobertura | string;
  territorio?: string;
  /** recortes aplicados na construção da variável (estágio, intraorçamentárias, data de referência) */
  filtros?: string;
  classificacao?: string;
  /** a coluna reproduz, sem transformação, um número publicado por esta fonte oficial (não é recalculada) */
  oficial?: string;
};

const DCA = 'SICONFI/Tesouro Nacional: DCA';
const RAIS = 'RAIS (MTE)';
const IBGE_POP = 'IBGE: Censos 2010 e 2022 e estimativas de 1º de julho (SIDRA 202, 4709 e 6579)';
const PIB = 'IBGE: PIB dos municípios (SIDRA 5938)';
const REG = 'LAPAM/UFG: regressão calculada pela página';
const SIM = 'Ministério da Saúde/DATASUS: SIM (óbitos por município de residência, causa básica pela CID-10)';
const SINASC = 'Ministério da Saúde/DATASUS: SINASC (nascidos vivos por município de residência da mãe)';
const sim = (x: Omit<Coluna, 'fonte' | 'tipo'>): Coluna => ({ tipo: 'contagem', fonte: SIM, tabelas: ['saude_municipios'], cobertura: 'sim', territorio: 'municípios de residência', ...x });
const SIH = 'Ministério da Saúde/DATASUS: SIH (internações hospitalares pagas pelo SUS, AIH tipo 1, por município de residência)';
const RESSALVA_SIH = 'só internações pagas pelo SUS (não inclui a saúde suplementar nem a privada); por ano de competência da AIH';
const SIA = 'Ministério da Saúde/DATASUS: SIA (produção ambulatorial do SUS, grupo PA: procedimentos aprovados, por município do estabelecimento)';
const RESSALVA_SIA = 'só o SUS; conta procedimentos aprovados (não pessoas) pelo município do estabelecimento, por ano de apresentação; valor da tabela do SUS (SIGTAP), não o custo nem o gasto do município';
const sia = (x: Omit<Coluna, 'fonte' | 'tipo'> & { tipo?: TipoColuna }): Coluna => ({ tipo: 'contagem', fonte: SIA, tabelas: ['saude_municipios'], cobertura: 'sia', territorio: 'municípios onde fica o estabelecimento', ressalva: RESSALVA_SIA, ...x });
const GRUPOS_SIA: [string, string, string][] = [['promocao', '01', 'promoção e prevenção em saúde'], ['diagnostico', '02', 'diagnóstico (exames e imagem)'], ['clinicos', '03', 'procedimentos clínicos (consultas e terapias)'], ['cirurgicos', '04', 'procedimentos cirúrgicos'], ['transplantes', '05', 'transplantes de órgãos, tecidos e células'], ['medicamentos', '06', 'medicamentos (componente especializado)'], ['orteses', '07', 'órteses, próteses e materiais especiais'], ['complementares', '08', 'ações complementares da atenção à saúde']];
const APS_F = 'Ministério da Saúde/SAPS: relatórios públicos da atenção primária (cobertura das equipes e dos agentes comunitários, valor de dezembro)';
const RESSALVA_APS = 'cobertura é capacidade das equipes cadastradas em relação à população, não a população atendida nem a qualidade; valor de dezembro; as séries ab (2008–2020) e aps (2021 em diante) usam metodologias diferentes e não se comparam';
const aps = (x: Omit<Coluna, 'fonte' | 'tipo'> & { tipo?: TipoColuna }): Coluna => ({ tipo: 'contagem', fonte: APS_F, tabelas: ['saude_municipios'], cobertura: 'aps', territorio: 'municípios de residência', ressalva: RESSALVA_APS, ...x });
const sih = (x: Omit<Coluna, 'fonte' | 'tipo'> & { tipo?: TipoColuna }): Coluna => ({ tipo: 'contagem', fonte: SIH, tabelas: ['saude_municipios'], cobertura: 'sih', territorio: 'municípios de residência', ressalva: RESSALVA_SIH, ...x });
const CAP_SIH = ['infecciosas e parasitárias (A00–B99)', 'neoplasias (C00–D48)', 'sangue e imunidade (D50–D89)', 'endócrinas, nutricionais e metabólicas (E00–E90)', 'transtornos mentais (F00–F99)', 'sistema nervoso (G00–G99)', 'olho (H00–H59)', 'ouvido (H60–H95)', 'aparelho circulatório (I00–I99)', 'aparelho respiratório (J00–J99)', 'aparelho digestivo (K00–K93)', 'pele (L00–L99)', 'osteomuscular (M00–M99)', 'geniturinário (N00–N99)', 'gravidez, parto e puerpério (O00–O99)', 'afecções perinatais (P00–P96)', 'malformações congênitas (Q00–Q99)', 'mal definidas (R00–R99)', 'lesões e envenenamentos (S00–T98)', 'causas externas (V01–Y98)', 'fatores que influenciam o estado de saúde (Z00–Z99)', 'códigos especiais (U00–U99)'];
const CNES_F = 'Ministério da Saúde/DATASUS: CNES (retrato de dezembro; município do estabelecimento)';
const cnes = (x: Omit<Coluna, 'fonte' | 'tipo'>): Coluna => ({ tipo: 'contagem', fonte: CNES_F, tabelas: ['saude_municipios'], cobertura: 'cnes', territorio: 'municípios onde fica o estabelecimento', ressalva: 'retrato de dezembro; conta o que está no município (não o de residência de quem usa), então polos regionais têm valores altos por habitante', ...x });
const SINAN_F = 'Ministério da Saúde/DATASUS: SINAN (agravos de notificação, arquivos finais, por município de residência)';
const sinan = (x: Omit<Coluna, 'fonte' | 'tipo'>): Coluna => ({ tipo: 'contagem', fonte: SINAN_F, tabelas: ['saude_municipios'], cobertura: 'sinan', territorio: 'municípios de residência', ressalva: 'depende da vigilância local (subnotificação) e oscila com surtos; pode diferir dos boletins do Ministério', ...x });
const SISCAN_F = 'Ministério da Saúde/DATASUS: SISCAN (exames de rastreamento do câncer do colo do útero e da mama, por município de residência)';
const siscan = (x: Omit<Coluna, 'fonte' | 'tipo'>): Coluna => ({ tipo: 'contagem', fonte: SISCAN_F, tabelas: ['saude_municipios'], cobertura: 'siscan', territorio: 'municípios de residência', ressalva: 'só o que foi lançado no SISCAN (SUS); conta exames, não mulheres', ...x });
const ONCO_F = 'Ministério da Saúde/DATASUS: Painel de Oncologia (diagnósticos de câncer, por município de residência e ano do diagnóstico)';
const onco = (x: Omit<Coluna, 'fonte' | 'tipo'>): Coluna => ({ tipo: 'contagem', fonte: ONCO_F, tabelas: ['saude_municipios'], cobertura: 'oncologia', territorio: 'municípios de residência', ressalva: 'registro de diagnósticos nos sistemas do SUS, não incidência; antes de 2019 o painel cobria bem menos casos; os últimos anos ainda recebem registros', ...x });
const RESP_F = 'Ministério da Saúde/DATASUS: RESP (microcefalia e alterações do sistema nervoso central, por município de residência e ano da notificação)';
const resp = (x: Omit<Coluna, 'fonte' | 'tipo'>): Coluna => ({ tipo: 'contagem', fonte: RESP_F, tabelas: ['saude_municipios'], cobertura: 'resp', territorio: 'municípios de residência', ressalva: 'notificação não é caso confirmado; a vigilância mudou muito depois de 2016', ...x });
const FUNCOES = 'função de governo 04 (Portaria MOG 42/1999)';

const TERR_DCA = 'municípios e estados (com o DF) que entregaram a DCA do exercício';
/** Colunas da DCA em indicadores. */
const dca = (x: Omit<Coluna, 'fonte'>): Coluna => ({ fonte: DCA, tabelas: ['indicadores'], cobertura: 'dca', territorio: TERR_DCA, ...x });
const estat = (tipo: TipoColuna, rotulo: string, definicao: string): Coluna => ({ tipo, rotulo, definicao, fonte: REG, cobertura: 'a amostra da consulta' });

/** Colunas pelo nome exato (o mesmo em qualquer tabela do painel). */
export const COLUNAS: Record<string, Coluna> = {
  cod_ibge: { tipo: 'codigo', rotulo: 'código IBGE', definicao: 'código IBGE do ente (município, 7 dígitos; UF, 2 dígitos)', fonte: 'IBGE' },
  municipio: { tipo: 'codigo', rotulo: 'município (código de 6 dígitos)', definicao: 'código IBGE do município sem o dígito verificador (RAIS, SIM e SINASC)', fonte: `${RAIS}; DATASUS` },
  exercicio: { tipo: 'ano', rotulo: 'exercício', definicao: 'ano civil do exercício fiscal', fonte: DCA },
  ano: { tipo: 'ano', rotulo: 'ano', definicao: 'ano de referência', fonte: '' },
  populacao: {
    tipo: 'contagem', rotulo: 'população (habitantes)',
    definicao: 'em indicadores e lrf: população informada pelo próprio ente na DCA do exercício; em trab_municipios: população de referência do IBGE; em saude_municipios: estimativa da SVS/MS',
    fonte: `${DCA} (indicadores); ${IBGE_POP} (trab_municipios); SVS/MS (saude_municipios)`, tabelas: ['indicadores', 'lrf', 'trab_municipios', 'saude_municipios'], cobertura: 'dca', territorio: TERR_DCA,
    ressalva: 'a declarada costuma repetir uma estimativa do IBGE de um ou dois anos antes; não é a estimativa do IBGE do ano. A da SVS/MS (saúde) também difere da do IBGE',
  },
  // saúde (saude_municipios): as contagens que entram nos indicadores do painel
  obitos: sim({ rotulo: 'óbitos', definicao: 'óbitos não fetais de residentes no município', filtros: 'sem os óbitos fetais' }),
  infantis: sim({ rotulo: 'óbitos infantis', definicao: 'óbitos de menores de 1 ano de residentes no município', ressalva: 'contagem direta, sem a correção de subnotificação que o Ministério da Saúde aplica em algumas UFs' }),
  maternos: sim({
    rotulo: 'óbitos maternos', definicao: 'óbitos pela causa básica na gravidez, parto e puerpério (CID-10 O00–O95, O98–O99) e A34', filtros: 'sem as mortes maternas tardias e sequelas (O96–O97)',
    classificacao: 'CID-10, causa básica', ressalva: 'contagem direta, sem o fator de correção do Ministério da Saúde',
  }),
  homicidios: sim({ rotulo: 'homicídios', definicao: 'óbitos por agressão (X85–Y09) e intervenção legal (Y35–Y36) pela causa básica', classificacao: 'CID-10, causa básica', ressalva: 'não inclui as mortes por intenção indeterminada (Y10–Y34)' }),
  int_total: sih({ rotulo: 'internações', definicao: 'AIH tipo 1 aprovadas e pagas pelo SUS de residentes do município, por ano de competência (as AIH de longa permanência, tipo 5, são continuação e não contam)' }),
  int_fora: sih({ rotulo: 'internações fora do município de residência', definicao: 'internações de residentes feitas em hospital de outro município' }),
  int_valor: sih({ tipo: 'reais', rotulo: 'valor pago nas internações (R$ correntes)', definicao: 'soma do valor total das AIH (serviços hospitalares e profissionais), a preços do ano de competência', ressalva: `${RESSALVA_SIH}; valor da tabela do SUS, não o custo real do hospital` }),
  int_valor_real: sih({ tipo: 'reais', rotulo: 'valor pago nas internações (R$ de 2025)', definicao: 'int_valor corrigido para reais de 2025 pelo IPCA médio do ano (gold/ipca.parquet, fator_real); reais de 2025 desde 2008', ressalva: `${RESSALVA_SIH}; valor da tabela do SUS, não o custo real do hospital` }),
  int_dias: sih({ rotulo: 'dias de permanência', definicao: 'soma dos dias de internação das AIH' }),
  int_obitos: sih({ rotulo: 'internações encerradas por óbito', definicao: 'AIH com saída por óbito (MORTE = 1)', ressalva: `${RESSALVA_SIH}; não é medida de qualidade do hospital` }),
  int_menores_5: sih({ rotulo: 'internações de menores de 5 anos', definicao: 'internações de residentes com menos de 5 anos de idade' }),
  int_60_mais: sih({ rotulo: 'internações de 60 anos ou mais', definicao: 'internações de residentes com 60 anos ou mais' }),
  amb_registros: sia({ rotulo: 'linhas de produção ambulatorial', definicao: 'registros do SIA-PA (um por procedimento, estabelecimento, ocupação e competência), antes de somar as quantidades' }),
  amb_qtd: sia({ rotulo: 'procedimentos ambulatoriais aprovados', definicao: 'quantidade aprovada de procedimentos (consultas, exames, sessões, cirurgias ambulatoriais), não de pessoas' }),
  amb_valor: sia({ tipo: 'reais', rotulo: 'valor aprovado na produção ambulatorial (R$ correntes)', definicao: 'valor aprovado pela tabela de procedimentos do SUS, a preços do ano' }),
  amb_valor_real: sia({ tipo: 'reais', rotulo: 'valor aprovado na produção ambulatorial (R$ de 2025)', definicao: 'amb_valor corrigido para reais de 2025 pelo IPCA médio do ano (gold/ipca.parquet, fator_real)' }),
  amb_qtd_fora: sia({ rotulo: 'procedimentos aprovados de pacientes de outro município', definicao: 'quantidade aprovada em que o município de residência do paciente difere do do estabelecimento' }),
  amb_valor_fora_real: sia({ tipo: 'reais', rotulo: 'valor aprovado de pacientes de outro município (R$ de 2025)', definicao: 'valor aprovado dos atendimentos de residentes em outro município, em reais de 2025' }),
  ...Object.fromEntries(GRUPOS_SIA.flatMap(([nome, cod, desc]) => [
    [`amb_${nome}_qtd`, sia({ rotulo: `procedimentos ambulatoriais: ${desc}`, definicao: `quantidade aprovada dos procedimentos do grupo ${cod} (${desc}) da tabela SIGTAP`, classificacao: 'grupo de procedimento (SIGTAP)' })],
    [`amb_${nome}_valor_real`, sia({ tipo: 'reais', rotulo: `valor ambulatorial: ${desc} (R$ de 2025)`, definicao: `valor aprovado do grupo ${cod} (${desc}), em reais de 2025 pelo IPCA médio do ano`, classificacao: 'grupo de procedimento (SIGTAP)' })],
  ])),
  ab_cobertura: aps({ tipo: 'percentual', rotulo: 'cobertura da atenção básica (metodologia antiga, 2008–2020)', definicao: 'percentual da população coberta pela atenção básica (equipes de Saúde da Família e atenção básica equivalente), limitado a 100%; valor de dezembro' }),
  ab_cobertura_sf: aps({ tipo: 'percentual', rotulo: 'cobertura da Saúde da Família (2008–2020)', definicao: 'percentual da população coberta pela Estratégia Saúde da Família, metodologia antiga; valor de dezembro' }),
  ab_equipes_esf: aps({ rotulo: 'equipes de Saúde da Família (2008–2020)', definicao: 'equipes de Saúde da Família no município em dezembro, metodologia antiga' }),
  ab_populacao: aps({ rotulo: 'população considerada na cobertura da atenção básica', definicao: 'população da base oficial usada no cálculo da cobertura antiga (DOU/TCU), diferente da SVS/MS', ressalva: 'base oficial do ano de referência; use para ponderar a cobertura, não como população do município' }),
  aps_cobertura: aps({ tipo: 'percentual', rotulo: 'cobertura da atenção primária (metodologia atual, 2021 em diante)', definicao: 'percentual da população coberta pelas equipes da atenção primária (capacidade das equipes ÷ população), SEM limite de 100%; valor de dezembro' }),
  aps_equipes_esf: aps({ rotulo: 'equipes de Saúde da Família (2021 em diante)', definicao: 'equipes de Saúde da Família no município em dezembro, metodologia atual' }),
  aps_equipes_eap: aps({ rotulo: 'equipes de Atenção Primária (2021 em diante)', definicao: 'equipes de Atenção Primária (eAP de 20 e 30 horas) no município em dezembro' }),
  aps_capacidade: aps({ rotulo: 'população que as equipes podem cobrir', definicao: 'capacidade das equipes de atenção primária cadastradas, em pessoas' }),
  aps_populacao: aps({ rotulo: 'população considerada na cobertura da atenção primária', definicao: 'população da base oficial usada no cálculo da cobertura atual (DOU), diferente da SVS/MS', ressalva: 'base oficial do ano de referência; use para ponderar a cobertura, não como população do município' }),
  acs_cobertura: aps({ tipo: 'percentual', rotulo: 'cobertura de agentes comunitários de saúde', definicao: 'percentual da população coberta por agentes comunitários de saúde, limitado a 100%; valor de dezembro' }),
  acs_agentes: aps({ rotulo: 'agentes comunitários de saúde ativos', definicao: 'agentes comunitários de saúde ativos no município em dezembro' }),
  acs_populacao: aps({ rotulo: 'população considerada na cobertura de agentes comunitários', definicao: 'população da base oficial usada no cálculo da cobertura de agentes comunitários', ressalva: 'use para ponderar a cobertura, não como população do município' }),
  int_atendidas: sih({ rotulo: 'internações atendidas no município', definicao: 'internações feitas em hospitais do município, de quem for residente', territorio: 'municípios onde fica o hospital' }),
  int_atendidas_de_fora: sih({ rotulo: 'internações atendidas de residentes de outros municípios', definicao: 'internações em hospitais do município de pessoas residentes em outro município', territorio: 'municípios onde fica o hospital' }),
  int_atendidas_valor_real: sih({ tipo: 'reais', rotulo: 'valor pago nas internações atendidas (R$ de 2025)', definicao: 'valor das AIH atendidas por hospitais do município, em reais de 2025 pelo IPCA médio do ano', territorio: 'municípios onde fica o hospital' }),
  ...Object.fromEntries(CAP_SIH.map((nome, i) => [`int_cap${String(i + 1).padStart(2, '0')}`, sih({ rotulo: `internações: ${nome}`, definicao: `internações cujo diagnóstico principal é do capítulo ${nome} da CID-10`, classificacao: 'CID-10, diagnóstico principal' })])),
  cnes_estab: cnes({ rotulo: 'estabelecimentos de saúde', definicao: 'estabelecimentos distintos cadastrados no CNES no município (qualquer tipo, com ou sem vínculo SUS)' }),
  cnes_estab_sus: cnes({ rotulo: 'estabelecimentos com vínculo SUS', definicao: 'estabelecimentos do CNES com vínculo ao SUS (VINC_SUS = 1)' }),
  cnes_hospitais: cnes({ rotulo: 'hospitais', definicao: 'estabelecimentos do tipo hospital geral (05) ou hospital especializado (07) na tabela de tipos do CNES' }),
  cnes_ubs: cnes({ rotulo: 'postos de saúde e unidades básicas', definicao: 'estabelecimentos do tipo posto de saúde (01) ou centro de saúde/unidade básica (02)', ressalva: 'não inclui as unidades de saúde da família cadastradas em outros tipos; retrato de dezembro' }),
  cnes_leitos: cnes({ rotulo: 'leitos existentes', definicao: 'soma dos leitos existentes (QT_EXIST) nos estabelecimentos do município, SUS e não SUS' }),
  cnes_leitos_sus: cnes({ rotulo: 'leitos SUS', definicao: 'leitos disponíveis ao SUS (QT_SUS)', ressalva: 'pode superar os existentes em municípios pequenos por inconsistência de cadastro; retrato de dezembro' }),
  cnes_leitos_nao_sus: cnes({ rotulo: 'leitos não SUS', definicao: 'leitos não disponíveis ao SUS (QT_NSUS)' }),
  ...Object.fromEntries([['cirurgicos', 'cirúrgicos'], ['clinicos', 'clínicos'], ['complementares', 'complementares (inclui UTI e unidades intermediárias)'], ['obstetricos', 'obstétricos'],
    ['pediatricos', 'pediátricos'], ['outras', 'de outras especialidades'], ['hospital_dia', 'de hospital-dia']].map(([k, nome]) => [`cnes_leitos_${k}`, cnes({ rotulo: `leitos ${nome}`, definicao: `leitos existentes ${nome} (tipo de leito do CNES)` })])),
  cnes_medicos: cnes({ rotulo: 'médicos', definicao: 'pessoas (CNS) com vínculo de médico (CBO 225 e 2231), cada uma uma só vez no ano, no município do vínculo de maior carga horária (empate: menor código)', ressalva: 'quem atua em mais de um município aparece só no principal, então a soma por UF e Brasil são pessoas distintas; de 2007 em diante; retrato de dezembro' }),
  cnes_medicos_no_municipio: cnes({ rotulo: 'médicos que atuam no município', definicao: 'pessoas (CNS) com vínculo de médico em estabelecimento do município, contadas uma vez em cada município onde atuam', ressalva: 'a mesma pessoa conta em cada município: não some por UF nem Brasil (superconta; para totais use cnes_medicos); de 2007 em diante' }),
  cnes_medicos_sus: cnes({ rotulo: 'médicos com vínculo SUS', definicao: 'médicos (CNS distintos) com vínculo SUS (PROF_SUS = 1) em estabelecimento do município' }),
  cnes_medicos_vinculos: cnes({ rotulo: 'vínculos de médicos', definicao: 'número de vínculos de médicos com estabelecimentos do município (a mesma pessoa conta uma vez por estabelecimento e por CBO)', ressalva: 'é vínculo, não pessoa; retrato de dezembro' }),
  cnes_enfermeiros: cnes({ rotulo: 'enfermeiros', definicao: 'pessoas (CNS) com vínculo de enfermeiro (CBO 2235), cada uma uma só vez no ano, no município do vínculo de maior carga horária', ressalva: 'de 2007 em diante; retrato de dezembro' }),
  cnes_dentistas: cnes({ rotulo: 'cirurgiões-dentistas', definicao: 'pessoas (CNS) com vínculo de cirurgião-dentista (CBO 2232), cada uma uma só vez no ano, no município do vínculo de maior carga horária', ressalva: 'de 2007 em diante; retrato de dezembro' }),
  sinan_dengue_provaveis: sinan({ rotulo: 'casos prováveis de dengue', definicao: 'casos de dengue notificados e não descartados (os arquivos públicos já excluem os descartados), pelo ano do arquivo', cobertura: '2000 em diante' }),
  sinan_dengue_confirmados: sinan({ rotulo: 'casos confirmados de dengue', definicao: 'casos com classificação final dengue (10), com sinais de alarme (11) ou grave (12); nos anos antigos, dengue clássica, com complicações, FHD e SCD (1 a 4)', cobertura: '2000 em diante' }),
  sinan_dengue_graves: sinan({ rotulo: 'casos graves de dengue', definicao: 'casos com classificação dengue grave (12), ou FHD e SCD (3 e 4) nos anos antigos', cobertura: '2000 em diante' }),
  sinan_dengue_obitos: sinan({ rotulo: 'óbitos por dengue (confirmados)', definicao: 'casos confirmados cuja evolução é óbito pelo agravo (EVOLUCAO = 2)', ressalva: 'pode diferir da contagem oficial de óbitos, que passa por investigação e atualização posteriores', cobertura: '2000 em diante' }),
  sinan_chik_notificacoes: sinan({ rotulo: 'notificações de chikungunya', definicao: 'notificações de chikungunya, inclusive as descartadas', cobertura: '2014 em diante' }),
  sinan_chik_confirmados: sinan({ rotulo: 'casos confirmados de chikungunya', definicao: 'notificações com classificação final confirmada (13)', cobertura: '2014 em diante' }),
  sinan_tb_casos_novos: sinan({ rotulo: 'casos novos de tuberculose', definicao: 'notificações com tipo de entrada caso novo (TRATAMENTO = 1), sem recidiva, reingresso, transferência nem pós-óbito', ressalva: 'os arquivos finais do SINAN só vão até 2019; fica 2 a 4% acima dos boletins, que aplicam exclusões extras', cobertura: '2001 a 2019' }),
  sinan_hans_casos_novos: sinan({ rotulo: 'casos novos de hanseníase', definicao: 'notificações com modo de entrada caso novo (MODOENTR = 1)', ressalva: 'fica 2 a 4% acima dos boletins, que aplicam exclusões extras', cobertura: '2001 a 2023' }),
  sinan_viol_notificacoes: sinan({ rotulo: 'notificações de violência', definicao: 'notificações de violência interpessoal e autoprovocada (SINAN-VIVA)', ressalva: 'mede a notificação, não a ocorrência; a cobertura cresceu muito desde 2009', cobertura: '2009 a 2024' }),
  pop_mulheres_25_64: { tipo: 'contagem', rotulo: 'mulheres de 25 a 64 anos', definicao: 'população residente feminina de 25 a 64 anos (estimativas da SVS/MS)', fonte: 'Ministério da Saúde/SVS: estimativas de população por município, sexo e idade', tabelas: ['saude_municipios'], cobertura: 'popSvs', territorio: 'municípios' },
  pop_mulheres_50_69: { tipo: 'contagem', rotulo: 'mulheres de 50 a 69 anos', definicao: 'população residente feminina de 50 a 69 anos (estimativas da SVS/MS)', fonte: 'Ministério da Saúde/SVS: estimativas de população por município, sexo e idade', tabelas: ['saude_municipios'], cobertura: 'popSvs', territorio: 'municípios' },
  siscan_cito: siscan({ rotulo: 'exames citopatológicos do colo do útero', definicao: 'exames citopatológicos do colo liberados no ano (SISCAN), pelo município de residência da paciente' }),
  siscan_cito_25_64: siscan({ rotulo: 'citopatológicos em mulheres de 25 a 64 anos', definicao: 'exames citopatológicos do colo liberados no ano em mulheres de 25 a 64 anos, a faixa-alvo da diretriz' }),
  siscan_cito_alterados: siscan({ rotulo: 'citopatológicos alterados', definicao: 'exames citopatológicos do colo marcados como alterados no SISCAN (de alterações celulares leves a lesões de alto grau; alterado não é câncer)' }),
  siscan_mamografias: siscan({ rotulo: 'mamografias', definicao: 'mamografias (de rastreamento e diagnósticas) liberadas no ano no SISCAN, pelo município de residência' }),
  siscan_mamo_50_69: siscan({ rotulo: 'mamografias em mulheres de 50 a 69 anos', definicao: 'mamografias liberadas no ano em mulheres de 50 a 69 anos, a faixa-alvo da diretriz' }),
  siscan_histo_colo: siscan({ rotulo: 'exames histopatológicos do colo do útero', definicao: 'exames histopatológicos do colo do útero liberados no ano (SISCAN)' }),
  siscan_histo_mama: siscan({ rotulo: 'exames histopatológicos da mama', definicao: 'exames histopatológicos da mama liberados no ano (SISCAN)' }),
  onco_casos: onco({ rotulo: 'diagnósticos de câncer', definicao: 'diagnósticos de câncer (CID-10 C na causa do diagnóstico, inclusive pele não melanoma e metástases) registrados no Painel de Oncologia, pelo ano do diagnóstico', cobertura: '2019 a 2025' }),
  onco_tratados: onco({ rotulo: 'diagnósticos com tratamento registrado', definicao: 'diagnósticos de câncer com data de primeiro tratamento registrada', ressalva: 'cerca de 40% dos diagnósticos não têm tratamento registrado; nos últimos anos o registro ainda está incompleto', cobertura: '2019 a 2025' }),
  onco_trat_validos: onco({ rotulo: 'diagnósticos com tratamento iniciado (data válida)', definicao: 'diagnósticos com tratamento registrado cuja data é igual ou posterior à do diagnóstico; denominador da proporção de tratamento em até 60 dias', cobertura: '2019 a 2025' }),
  onco_trat_60d: onco({ rotulo: 'tratamentos iniciados em até 60 dias', definicao: 'diagnósticos cujo primeiro tratamento começou em até 60 dias da data do diagnóstico (prazo da Lei 12.732/2012)', cobertura: '2019 a 2025' }),
  resp_notificacoes: resp({ rotulo: 'notificações de microcefalia e alterações do SNC', definicao: 'notificações do RESP (recém-nascidos, crianças, fetos, natimortos e abortos), sem as excluídas, pelo ano da notificação', cobertura: '2015 a 2024' }),
  resp_confirmadas: resp({ rotulo: 'confirmadas de microcefalia e alterações do SNC', definicao: 'notificações do RESP com classificação final confirmada', ressalva: 'a confirmação pode levar meses: os últimos anos ficam subestimados', cobertura: '2015 a 2024' }),
  resp_obitos: resp({ rotulo: 'óbitos entre as confirmadas', definicao: 'notificações confirmadas do RESP com óbito', cobertura: '2015 a 2024' }),
  nascidos: { tipo: 'contagem', rotulo: 'nascidos vivos', definicao: 'nascidos vivos de mães residentes no município', fonte: SINASC, tabelas: ['saude_municipios'], cobertura: 'sinasc', territorio: 'municípios de residência da mãe' },
  populacao_ibge: {
    tipo: 'contagem', rotulo: 'população do IBGE (habitantes)',
    definicao: 'publicação do IBGE do próprio ano (estimativa de 1º de julho ou censo); em 2023, sem publicação, o Censo 2022',
    fonte: IBGE_POP, tabelas: ['indicadores'], cobertura: '2010 a 2026 (sem estimativa em 2010, 2022 e 2023: valem os censos)', territorio: 'municípios e UFs',
    filtros: 'publicação do mesmo ano; sem ela, a do ano anterior', oficial: 'IBGE (SIDRA 202, 4709 e 6579)',
    ressalva: 'as estimativas até 2021 e o Censo 2022 têm bases diferentes: o per capita salta entre esses anos',
  },
  populacao_ibge_ano: { tipo: 'ano', rotulo: 'ano da publicação de população do IBGE', definicao: 'ano da estimativa ou do censo usado', fonte: IBGE_POP },
  populacao_ano: { tipo: 'ano', rotulo: 'ano da publicação de população do IBGE', definicao: 'ano da estimativa ou do censo usado', fonte: IBGE_POP },
  pib: {
    tipo: 'reais', rotulo: 'PIB (R$ correntes)', definicao: 'Produto Interno Bruto municipal a preços correntes', fonte: PIB, tabelas: ['indicadores'],
    cobertura: 'pib', territorio: 'municípios', oficial: 'IBGE (SIDRA 5938)', ressalva: 'publicado com cerca de dois anos de atraso',
  },
  pib_per_capita: {
    tipo: 'reais', rotulo: 'PIB per capita (R$ correntes)', definicao: 'PIB ÷ população do IBGE (populacao_ibge); recalculado pelo painel',
    fonte: `${PIB} e população do IBGE`, tabelas: ['indicadores'], cobertura: 'pib', territorio: 'municípios',
    ressalva: 'indicador recalculado pelo painel com a mesma regra do IBGE Cidades, não copiado de uma publicação',
  },
  fpm: dca({
    tipo: 'reais', rotulo: 'FPM (R$)', filtros: 'receita bruta realizada, antes das deduções',
    definicao: 'cota-parte do Fundo de Participação dos Municípios recebida (receita bruta realizada, anexo I-C), com a cota mensal e as cotas extraordinárias de 1%',
  }),
  receita_corrente: dca({ tipo: 'reais', rotulo: 'receita corrente (R$)', definicao: 'receitas correntes brutas realizadas, sem intraorçamentárias (anexo I-C)', filtros: 'realizada; sem intraorçamentárias; antes das deduções', classificacao: 'categoria econômica da receita 1 (correntes)' }),
  despesa_empenhada: dca({ tipo: 'reais', rotulo: 'despesa total empenhada (R$)', definicao: 'despesa total empenhada, com as intraorçamentárias (anexo I-D)', filtros: 'empenhada; com intraorçamentárias' }),
  despesa_empenhada_sem_intra: dca({ tipo: 'reais', rotulo: 'despesa total empenhada sem intra (R$)', definicao: 'despesa total empenhada exceto intraorçamentárias (anexo I-E)', filtros: 'empenhada; sem intraorçamentárias' }),
  despesa_corrente: dca({ tipo: 'reais', rotulo: 'despesa corrente empenhada (R$)', definicao: 'despesas correntes empenhadas, exceto intraorçamentárias (anexo I-D, DO3)', filtros: 'empenhada; sem intraorçamentárias', classificacao: 'categoria econômica da despesa 3 (correntes)' }),
  despesa_capital: dca({ tipo: 'reais', rotulo: 'despesa de capital empenhada (R$)', definicao: 'despesas de capital empenhadas, exceto intraorçamentárias (anexo I-D, DO4)', filtros: 'empenhada; sem intraorçamentárias', classificacao: 'categoria econômica da despesa 4 (capital)' }),
  despesa_pessoal: dca({
    tipo: 'reais', rotulo: 'despesa com pessoal empenhada (R$)', definicao: 'pessoal e encargos sociais, empenhada, exceto intraorçamentárias (anexo I-D, DO3.1)',
    filtros: 'empenhada; sem intraorçamentárias', classificacao: 'grupo de natureza da despesa 1 (Portaria Interministerial 163/2001)',
    ressalva: 'não é a despesa com pessoal da LRF (lrf.despesa_pessoal), que tem exclusões próprias',
  }),
  despesa_administracao: dca({ tipo: 'reais', rotulo: 'Função 04 – Administração, empenhada (R$)', definicao: 'despesa da função 04 (Administração), empenhada, exceto intraorçamentárias (anexo I-E)', filtros: 'empenhada; sem intraorçamentárias', classificacao: FUNCOES }),
  despesa_administracao_liquidada: dca({ tipo: 'reais', rotulo: 'Função 04 – Administração, liquidada (R$)', definicao: 'função 04, liquidada, exceto intraorçamentárias (anexo I-E)', filtros: 'liquidada; sem intraorçamentárias', classificacao: FUNCOES }),
  despesa_administracao_paga: dca({ tipo: 'reais', rotulo: 'Função 04 – Administração, paga (R$)', definicao: 'função 04, paga, exceto intraorçamentárias (anexo I-E)', filtros: 'paga; sem intraorçamentárias', classificacao: FUNCOES }),
  funcao_cod: dca({ tipo: 'codigo', rotulo: 'função (código)', definicao: 'código da função de governo na DCA (F01 a F28)', tabelas: ['despesa_funcao'], classificacao: 'funções de governo (Portaria MOG 42/1999)' }),
  indice: { tipo: 'indice', rotulo: 'número-índice do IPCA (dez/2009 = 1)', definicao: 'IPCA acumulado em dezembro', fonte: 'IPCA (Banco Central, SGS 433)', tabelas: ['ipca'] },
  fator: { tipo: 'indice', rotulo: 'fator de deflação', definicao: 'índice do ano-base ÷ índice do ano', fonte: 'IPCA (Banco Central, SGS 433)' },
  fator_real: {
    tipo: 'indice', rotulo: 'fator de deflação (R$ do ano-base)', definicao: 'índice de dezembro do ano-base ÷ índice de dezembro do ano; valor real = nominal × fator_real',
    fonte: 'IPCA (Banco Central, SGS 433)', tabelas: ['ipca'],
  },
  empregos_adm_publica: {
    tipo: 'contagem', rotulo: 'vínculos na Administração pública (CNAE 84)', fonte: RAIS, tabelas: ['trab_municipios'], cobertura: 'rais', territorio: 'municípios (do estabelecimento)',
    definicao: 'vínculos ativos em 31/12 em estabelecimentos da divisão 84 da CNAE 2.0 (atividade), de todas as esferas, no município do estabelecimento',
    filtros: 'vínculos ativos em 31/12', classificacao: 'CNAE 2.0, divisão 84 (Administração pública, defesa e seguridade social)',
    ressalva: 'é atividade, não natureza jurídica: escolas e hospitais públicos ficam em educação e saúde; inclui órgãos estaduais e federais situados no município',
  },
  // estatísticas: sem unidade monetária
  termo: estat('texto', 'termo', 'variável do modelo'),
  coeficiente: estat('estatistica', 'coeficiente', 'coeficiente estimado por MQO'),
  erro_padrao: estat('estatistica', 'erro-padrão', 'erro-padrão do coeficiente'),
  estatistica_t: estat('estatistica', 'estatística t', 'coeficiente ÷ erro-padrão'),
  p_valor: estat('estatistica', 'p-valor', 'p-valor bilateral pela t de Student'),
  ic95_inferior: estat('estatistica', 'IC 95% (inferior)', 'limite inferior do intervalo de 95%'),
  ic95_superior: estat('estatistica', 'IC 95% (superior)', 'limite superior do intervalo de 95%'),
  n_observacoes: estat('contagem', 'observações', 'observações completas usadas na estimação'),
  r2: estat('estatistica', 'R²', 'proporção da variância de y associada linearmente aos regressores'),
  r2_ajustado: estat('estatistica', 'R² ajustado', 'R² corrigido pelos graus de liberdade'),
  graus_liberdade: estat('contagem', 'graus de liberdade', 'n − k'),
  descartadas_por_ausencia: estat('contagem', 'linhas descartadas por ausência', 'linhas da consulta com algum valor ausente'),
};

const intervalo = (anos?: number[]) => (anos?.length ? `${anos[0]} a ${anos.at(-1)}` : '');

/** Cobertura temporal da coluna: os anos da fonte no manifesto, ou o texto fixo do catálogo. */
export function coberturaDaColuna(c: Coluna, cob?: Cobertura | null): string {
  if (c.cobertura === 'dca') return intervalo(cob?.dca);
  if (c.cobertura === 'rais') return intervalo(cob?.rais);
  if (c.cobertura === 'pib') return cob?.pib ? `${cob.pib.de} a ${cob.pib.ate}` : '';
  if (c.cobertura === 'sim') return intervalo(cob?.sim);
  if (c.cobertura === 'sinasc') return intervalo(cob?.sinasc);
  if (c.cobertura === 'sih') return intervalo(cob?.sih);
  if (c.cobertura === 'sia') return intervalo(cob?.sia);
  if (c.cobertura === 'aps') return intervalo(cob?.aps);
  if (c.cobertura === 'cnes') return intervalo(cob?.cnes);
  if (c.cobertura === 'sinan') return intervalo(cob?.sinan);
  if (c.cobertura === 'siscan') return intervalo(cob?.siscan);
  if (c.cobertura === 'oncologia') return intervalo(cob?.oncologia);
  if (c.cobertura === 'resp') return intervalo(cob?.resp);
  return c.cobertura ?? '';
}

/**
 * Ficha de uma coluna do catálogo para a exportação e para a tela: definição, fonte, cobertura, filtros,
 * classificação, se é valor oficial ou recalculado e ressalvas. Colunas calculadas na consulta não têm ficha.
 */
export function fichaDaColuna(nome: string, cob?: Cobertura | null): string | null {
  const c = COLUNAS[nome.toLowerCase()];
  if (!c || c.fonte === REG) return null;
  const anos = coberturaDaColuna(c, cob);
  return [
    `${c.definicao.replace(/^./, (x) => x.toUpperCase())}.`,
    c.fonte && `Fonte: ${c.fonte}.`,
    (anos || c.territorio) && `Cobertura: ${[anos, c.territorio].filter(Boolean).join('; ')}.`,
    c.filtros && `Filtros: ${c.filtros}.`,
    c.classificacao && `Classificação: ${c.classificacao}.`,
    c.oficial ? `Valor publicado por ${c.oficial}, sem transformação pelo painel.` : /recalculad/.test(c.definicao) ? 'Indicador recalculado pelo painel.' : '',
    c.ressalva && `Ressalva: ${c.ressalva}.`,
  ].filter(Boolean).join(' ');
}

/**
 * Unidade declarada pelo modelo para cada coluna da consulta (campo colunas de "consultar") → tipo da tela.
 * reais_por_habitante e pontos_percentuais mudam só o rótulo.
 */
export const UNIDADES: Record<string, TipoColuna> = {
  reais: 'reais', reais_por_habitante: 'reais', contagem: 'contagem', habitantes: 'contagem', percentual: 'percentual',
  pontos_percentuais: 'percentual', razao: 'razao', estatistica: 'estatistica', indice: 'indice', codigo: 'codigo',
  ano: 'ano', competencia: 'competencia', texto: 'texto',
};

/** Tipo pelo nome de estatística (correlação, R², t, p): nunca R$, mesmo com fpm ou despesa no nome. */
export const RE_ESTATISTICA = /^(corr|correlacao|spearman|pearson|r2|r_quadrado|rsq|coef|coeficiente|beta|inclinacao|intercepto|elasticidade|t|t_stat|estatistica_t|p|p_valor|pvalor|p_value|erro_padrao|se|desvio_padrao|dp|ic95(_\w+)?)(_|$)|(^|_)(corr|correlacao|spearman|pearson|r2|coef|elasticidade|p_valor|pvalor|t_stat|erro_padrao)$/i;

// ---------------- conceitos pedidos × variáveis usadas ----------------

export type Conceito = {
  id: string;
  nome: string;
  /** a pergunta pede este conceito */
  pedido: RegExp;
  /** colunas ou filtros que o atendem (no SQL, sem os textos entre aspas, exceto os códigos de função) */
  atende: RegExp;
  /** o que dizer ao modelo quando a resposta não o usa */
  orientacao: string;
};

export const CONCEITOS: Conceito[] = [
  {
    id: 'funcao_04', nome: 'Função 04 – Administração',
    pedido: /fun[çc][ãa]o\s*(0?4\b|administra)|despesas?\s+(com\s+)?administra[çc][ãa]o\b|despesas?\s+administrativ|gastos?\s+(com\s+)?administra[çc][ãa]o\b|gastos?\s+administrativ|custeio\s+administrativ/i,
    atende: /\bdespesa_administracao(_liquidada|_paga)?\b|'F04'/i,
    orientacao: 'use indicadores.despesa_administracao (empenhada; _liquidada e _paga nos outros estágios) ou despesa_funcao com funcao_cod = \'F04\' (anexo I-E, exceto intraorçamentárias); despesa total, corrente ou com pessoal não são a função 04',
  },
  {
    id: 'despesa_pessoal', nome: 'despesa com pessoal',
    pedido: /despesas?\s+(com\s+|de\s+)?pessoal|gastos?\s+com\s+pessoal|folha\s+de\s+pagamento/i,
    atende: /\bdespesa_pessoal\b|\bpessoal_rcl_pct\b/i,
    orientacao: 'use indicadores.despesa_pessoal (pessoal e encargos, empenhada, exceto intraorçamentárias) ou, para o limite da LRF, lrf.despesa_pessoal',
  },
  {
    id: 'despesa_corrente', nome: 'despesas correntes',
    pedido: /despesas?\s+correntes?/i,
    atende: /\bdespesa_corrente\b/i,
    orientacao: 'use indicadores.despesa_corrente (empenhada, exceto intraorçamentárias)',
  },
  {
    id: 'receita_corrente', nome: 'receitas correntes',
    pedido: /receitas?\s+correntes?/i,
    atende: /\breceita_corrente\b|\brcl(_ajustada)?\b/i,
    orientacao: 'use indicadores.receita_corrente (bruta realizada, sem intraorçamentárias) ou, se pedirem a líquida da LRF, lrf.rcl',
  },
  {
    id: 'fpm', nome: 'FPM',
    pedido: /\bfpm\b|fundo\s+de\s+participa[çc][ãa]o\s+dos\s+munic/i,
    atende: /\bfpm\b/i,
    orientacao: 'use indicadores.fpm',
  },
  {
    id: 'pib_per_capita', nome: 'PIB per capita',
    pedido: /pib\s+per\s+capita|pib\s+por\s+habitante/i,
    // pib_per_capita, ou o PIB com a população do IBGE (populacao_ibge, ou a de trab_municipios)
    atende: /\bpib_per_capita\b|\bpib\b[\s\S]*\bpopulacao_ibge\b|\bpopulacao_ibge\b[\s\S]*\bpib\b|^(?=[\s\S]*\bpib\b)(?=[\s\S]*\btrab_municipios\b)(?=[\s\S]*\bpopulacao\b)/i,
    orientacao: 'use indicadores.pib_per_capita (PIB ÷ população do IBGE, a mesma regra do IBGE Cidades), não o PIB dividido pela população declarada na DCA',
  },
  {
    id: 'vinculos_municipais', nome: 'vínculos da prefeitura (natureza jurídica municipal)',
    pedido: /v[ií]nculos?\s+(da|na|das)\s+prefeitura|servidores?\s+(municipais|da\s+prefeitura)|emprego\s+p[úu]blico\s+municipal|funcionalismo\s+municipal/i,
    atende: /\bnatureza_juridica\b/i,
    orientacao: 'a prefeitura é identificada pela natureza jurídica municipal (1031, 1244, 1120, 1155), só nos microdados (rais_vinculos); a divisão 84 da CNAE (empregos_adm_publica) é a atividade e inclui órgãos estaduais e federais no município. Sem os microdados, diga isso e não use a CNAE 84 como resposta',
  },
  {
    id: 'mortalidade_infantil', nome: 'mortalidade infantil',
    pedido: /mortalidade\s+infantil|taxa\s+de\s+[óo]bitos?\s+infantis/i,
    // óbitos de menores de 1 ano por nascidos vivos (não a neonatal, nem por população de menores de 1 ano)
    atende: /\binfantis\b[\s\S]*\bnascidos\b|\bnascidos\b[\s\S]*\binfantis\b/i,
    orientacao: 'use saude_municipios: 1000.0 * sum(infantis) / sum(nascidos), óbitos de menores de 1 ano por mil nascidos vivos; a neonatal (neonatais) e a pós-neonatal são componentes, e a população de menores de 1 ano não é o denominador',
  },
  {
    id: 'mortalidade_materna', nome: 'mortalidade materna',
    pedido: /mortalidade\s+materna|mortes?\s+maternas?|[óo]bitos?\s+maternos?/i,
    atende: /\bmaternos\b/i,
    orientacao: 'use saude_municipios.maternos; a razão de mortalidade materna é 100000.0 * sum(maternos) / sum(nascidos), por 100 mil nascidos vivos',
  },
];

/** Texto da consulta sem os literais, salvo os códigos de função ('F04'), que identificam a variável. */
const sqlParaConceito = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, (m) => (/^'F\d{2}'$/i.test(m) ? m : "''"));

export const conceitosPedidos = (pergunta: string) => CONCEITOS.filter((c) => c.pedido.test(pergunta));
export const atendeConceito = (c: Conceito, sql: string) => c.atende.test(sqlParaConceito(sql));
