/**
 * Indicadores do painel de saúde (SIM, SINASC e população da SVS/MS), calculados no navegador a partir das
 * contagens de gold/saude/municipios.parquet. Em qualquer agregado (UF, Brasil, série), a taxa é a razão das
 * somas (Σ numerador ÷ Σ denominador), nunca a média das taxas dos municípios.
 */
import type { Linha } from './api';
import { numero1, pct } from './format';
import { t } from './idioma';

// o mesmo num() de hooks.ts, aqui para a camada de dados (dados.ts) poder usar os indicadores sem importar React
const num = (v: unknown) => (typeof v === 'number' ? v : null);

export type Indicador = {
  id: string;
  nome: () => string;
  /** Unidade curta para tabelas e gráficos (ex.: "por mil nascidos vivos"). */
  unidade: () => string;
  numerador: string;
  denominador: string;
  fator: number;
  /** Proporção (0–1, mostrada em %) ou taxa (mostrada com uma casa decimal). */
  tipo: 'proporcao' | 'taxa';
  grupo: () => string;
  /** Denominador mínimo para entrar no ranking por padrão (números pequenos oscilam muito). */
  minimo: number;
  nota: () => string;
};

const G_MORT = () => t('Mortalidade', 'Mortality');
const G_NASC = () => t('Nascimentos', 'Births');
const G_CAUSAS = () => t('Causas de morte', 'Causes of death');

const G_INT = () => t('Internações (SIH/SUS)', 'Hospital admissions (SIH/SUS)');
const G_REDE = () => t('Rede de saúde (CNES)', 'Health network (CNES)');
const G_AGRAVOS = () => t('Agravos notificados (SINAN)', 'Notifiable diseases (SINAN)');
const G_CANCER = () => t('Câncer: rastreamento e diagnóstico (SISCAN, Painel de Oncologia)', 'Cancer: screening and diagnosis (SISCAN, Oncology Panel)');
const G_RESP = () => t('Microcefalia e alterações do sistema nervoso central (RESP)', 'Microcephaly and central nervous system changes (RESP)');
const RESSALVA_SISCAN = () => t('Só traz o que foi lançado no SISCAN, sistema do SUS: exames feitos em plano de saúde ou clínica particular, quando não lançados, não aparecem, então valores baixos não significam falta de rastreamento. Conta exames, não mulheres: quem repete o exame no ano entra mais de uma vez.',
  'It only holds what was entered in SISCAN, a SUS system: tests done under private insurance or clinics, when not entered, do not appear, so low values do not mean absence of screening. It counts tests, not women: someone tested more than once in the year counts more than once.');
const RESSALVA_SINAN = () => t('Notificação depende da vigilância local: onde se notifica menos, aparece menos (subnotificação), e surtos fazem os números oscilar muito de um ano para outro. Pode diferir dos boletins do Ministério, que aplicam exclusões e atualizações próprias.',
  'Notification depends on local surveillance: where less is reported, less appears (under-reporting), and outbreaks make numbers swing from year to year. It may differ from the Ministry’s bulletins, which apply their own exclusions and updates.');
const RESSALVA_CNES = () => t('Conta o que está no município do estabelecimento (não o de residência de quem usa) e o retrato de dezembro; municípios com hospital regional têm valores altos por habitante porque atendem moradores de outros.',
  'Counts what is in the municipality of the facility (not the residence of its users) and the December snapshot; municipalities with a regional hospital have high per-capita values because they serve residents of others.');

export const INDICADORES: Indicador[] = [
  {
    id: 'mortalidade_infantil', grupo: G_MORT, nome: () => t('Mortalidade infantil', 'Infant mortality'),
    unidade: () => t('por mil nascidos vivos', 'per 1,000 live births'), numerador: 'infantis', denominador: 'nascidos', fator: 1000, tipo: 'taxa', minimo: 1000,
    nota: () => t('Óbitos de menores de 1 ano (SIM) ÷ nascidos vivos (SINASC) do mesmo ano e município de residência × 1.000. Cálculo direto, sem correção de subnotificação; o Ministério da Saúde usa estimativas corrigidas para UFs com cobertura incompleta.',
      'Deaths under 1 year (SIM) ÷ live births (SINASC) of the same year and municipality of residence × 1,000. Direct calculation, without under-reporting correction; the Ministry of Health uses corrected estimates for states with incomplete coverage.'),
  },
  {
    id: 'mortalidade_neonatal', grupo: G_MORT, nome: () => t('Mortalidade neonatal', 'Neonatal mortality'),
    unidade: () => t('por mil nascidos vivos', 'per 1,000 live births'), numerador: 'neonatais', denominador: 'nascidos', fator: 1000, tipo: 'taxa', minimo: 1000,
    nota: () => t('Óbitos de 0 a 27 dias ÷ nascidos vivos × 1.000.', 'Deaths aged 0–27 days ÷ live births × 1,000.'),
  },
  {
    id: 'mortalidade_pos_neonatal', grupo: G_MORT, nome: () => t('Mortalidade pós-neonatal', 'Post-neonatal mortality'),
    unidade: () => t('por mil nascidos vivos', 'per 1,000 live births'), numerador: 'pos_neonatais', denominador: 'nascidos', fator: 1000, tipo: 'taxa', minimo: 1000,
    nota: () => t('Óbitos de 28 dias a menos de 1 ano ÷ nascidos vivos × 1.000.', 'Deaths aged 28 days to under 1 year ÷ live births × 1,000.'),
  },
  {
    id: 'mortalidade_infancia', grupo: G_MORT, nome: () => t('Mortalidade na infância (menores de 5)', 'Under-5 mortality'),
    unidade: () => t('por mil nascidos vivos', 'per 1,000 live births'), numerador: 'menores_5', denominador: 'nascidos', fator: 1000, tipo: 'taxa', minimo: 1000,
    nota: () => t('Óbitos de menores de 5 anos ÷ nascidos vivos do ano × 1.000 (aproximação usual do indicador).', 'Deaths under 5 ÷ live births of the year × 1,000 (usual approximation).'),
  },
  {
    id: 'mortalidade_materna', grupo: G_MORT, nome: () => t('Razão de mortalidade materna', 'Maternal mortality ratio'),
    unidade: () => t('por 100 mil nascidos vivos', 'per 100,000 live births'), numerador: 'maternos', denominador: 'nascidos', fator: 100000, tipo: 'taxa', minimo: 10000,
    nota: () => t('Óbitos maternos pela causa básica (CID-10 O00–O95, O98–O99 e A34; sem as tardias O96–O97) ÷ nascidos vivos × 100.000. Contagem direta, sem o fator de correção do Ministério da Saúde; com poucos nascidos, um único óbito muda muito a razão.',
      'Maternal deaths by underlying cause (ICD-10 O00–O95, O98–O99 and A34; excluding late deaths O96–O97) ÷ live births × 100,000. Direct count, without the Ministry of Health correction factor; with few births, a single death changes the ratio a lot.'),
  },
  {
    id: 'mortalidade_geral', grupo: G_MORT, nome: () => t('Taxa bruta de mortalidade', 'Crude death rate'),
    unidade: () => t('por mil habitantes', 'per 1,000 inhabitants'), numerador: 'obitos', denominador: 'populacao', fator: 1000, tipo: 'taxa', minimo: 5000,
    nota: () => t('Óbitos não fetais ÷ população residente (estimativa da SVS/MS) × 1.000. Não é padronizada por idade: lugares com população mais velha têm taxas maiores.',
      'Non-fetal deaths ÷ resident population (SVS/MS estimate) × 1,000. Not age-standardised: places with older populations have higher rates.'),
  },
  {
    id: 'dcnt_prematura', grupo: G_CAUSAS, nome: () => t('Mortalidade prematura por doenças crônicas (30–69 anos)', 'Premature NCD mortality (30–69)'),
    unidade: () => t('por 100 mil hab. de 30 a 69 anos', 'per 100,000 aged 30–69'), numerador: 'dcnt_30_69', denominador: 'pop_30_69', fator: 100000, tipo: 'taxa', minimo: 5000,
    nota: () => t('Óbitos de 30 a 69 anos por doenças do aparelho circulatório (I00–I99), câncer (C00–C97), respiratórias crônicas (J30–J98) e diabetes (E10–E14) ÷ população de 30 a 69 anos × 100.000. Taxa bruta (o indicador do Plano de DCNT costuma ser padronizado por idade).',
      'Deaths aged 30–69 from circulatory diseases (I00–I99), cancer (C00–C97), chronic respiratory diseases (J30–J98) and diabetes (E10–E14) ÷ population aged 30–69 × 100,000. Crude rate (the NCD Plan indicator is usually age-standardised).'),
  },
  {
    id: 'homicidios', grupo: G_CAUSAS, nome: () => t('Homicídios', 'Homicides'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'homicidios', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 20000,
    nota: () => t('Óbitos por agressão (X85–Y09) e intervenção legal (Y35–Y36), pela causa básica, ÷ população × 100.000. Não inclui as mortes por intenção indeterminada (Y10–Y34), parte das quais são homicídios.',
      'Deaths from assault (X85–Y09) and legal intervention (Y35–Y36), by underlying cause, ÷ population × 100,000. Excludes deaths of undetermined intent (Y10–Y34), some of which are homicides.'),
  },
  {
    id: 'suicidios', grupo: G_CAUSAS, nome: () => t('Suicídios', 'Suicides'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'suicidios', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 20000,
    nota: () => t('Lesões autoprovocadas intencionalmente (X60–X84) ÷ população × 100.000.', 'Intentional self-harm (X60–X84) ÷ population × 100,000.'),
  },
  {
    id: 'transito', grupo: G_CAUSAS, nome: () => t('Mortes no trânsito', 'Road traffic deaths'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'transito', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 20000,
    nota: () => t('Acidentes de transporte (V01–V89) ÷ população × 100.000, pelo município de residência (não o do acidente).', 'Transport accidents (V01–V89) ÷ population × 100,000, by municipality of residence (not of the accident).'),
  },
  {
    id: 'mal_definidas', grupo: G_CAUSAS, nome: () => t('Óbitos por causas mal definidas', 'Deaths from ill-defined causes'),
    unidade: () => t('% dos óbitos', '% of deaths'), numerador: 'mal_definidas', denominador: 'obitos', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t('Óbitos com causa básica no capítulo XVIII da CID-10 (R00–R99) ÷ total de óbitos. Mede a qualidade da informação: quanto maior, menos confiáveis as taxas por causa.',
      'Deaths with underlying cause in ICD-10 chapter XVIII (R00–R99) ÷ all deaths. Measures data quality: the higher it is, the less reliable cause-specific rates are.'),
  },
  {
    id: 'natalidade', grupo: G_NASC, nome: () => t('Taxa bruta de natalidade', 'Crude birth rate'),
    unidade: () => t('por mil habitantes', 'per 1,000 inhabitants'), numerador: 'nascidos', denominador: 'populacao', fator: 1000, tipo: 'taxa', minimo: 5000,
    nota: () => t('Nascidos vivos de mães residentes ÷ população × 1.000.', 'Live births to resident mothers ÷ population × 1,000.'),
  },
  {
    id: 'baixo_peso', grupo: G_NASC, nome: () => t('Baixo peso ao nascer', 'Low birth weight'),
    unidade: () => t('% dos nascidos com peso informado', '% of births with weight recorded'), numerador: 'baixo_peso', denominador: 'peso_informado', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t('Nascidos vivos com menos de 2.500 g ÷ nascidos com peso informado.', 'Live births under 2,500 g ÷ births with weight recorded.'),
  },
  {
    id: 'prematuros', grupo: G_NASC, nome: () => t('Prematuridade', 'Preterm births'),
    unidade: () => t('% dos nascidos com gestação informada', '% of births with gestation recorded'), numerador: 'prematuros', denominador: 'gestacao_informada', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t('Nascidos com menos de 37 semanas de gestação ÷ nascidos com a duração informada. Em 2011 o SINASC passou a calcular a idade gestacional pela data da última menstruação, e a prematuridade subiu de patamar: compare com cautela os anos antes e depois.',
      'Births before 37 weeks ÷ births with gestation recorded. In 2011 SINASC started computing gestational age from the last menstrual period, and preterm rates rose: compare years before and after with caution.'),
  },
  {
    id: 'cesareas', grupo: G_NASC, nome: () => t('Partos cesáreos', 'Caesarean births'),
    unidade: () => t('% dos nascidos com tipo de parto informado', '% of births with delivery type recorded'), numerador: 'cesareos', denominador: 'parto_informado', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t('Nascidos de parto cesáreo ÷ nascidos com tipo de parto informado.', 'Caesarean births ÷ births with delivery type recorded.'),
  },
  {
    id: 'pre_natal', grupo: G_NASC, nome: () => t('Sete ou mais consultas de pré-natal', 'Seven or more prenatal visits'),
    unidade: () => t('% dos nascidos com consultas informadas', '% of births with visits recorded'), numerador: 'consultas_7_mais', denominador: 'consultas_informadas', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t('Nascidos de mães com 7 ou mais consultas de pré-natal ÷ nascidos com o número de consultas informado.', 'Births to mothers with 7 or more prenatal visits ÷ births with visits recorded.'),
  },
  {
    id: 'maes_adolescentes', grupo: G_NASC, nome: () => t('Mães adolescentes (10–19 anos)', 'Adolescent mothers (10–19)'),
    unidade: () => t('% dos nascidos com idade da mãe informada', '% of births with mother’s age recorded'), numerador: 'maes_10_19', denominador: 'idade_mae_informada', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t('Nascidos de mães de 10 a 19 anos ÷ nascidos com a idade da mãe informada.', 'Births to mothers aged 10–19 ÷ births with mother’s age recorded.'),
  },
  // internações hospitalares do SUS (SIH, AIH reduzida), por município de residência e ano de competência
  {
    id: 'internacoes_mil', grupo: G_INT, nome: () => t('Internações hospitalares', 'Hospital admissions'),
    unidade: () => t('por mil habitantes', 'per 1,000 inhabitants'), numerador: 'int_total', denominador: 'populacao', fator: 1000, tipo: 'taxa', minimo: 5000,
    nota: () => t('Internações pagas pelo SUS (SIH, AIH tipo 1) de residentes ÷ população residente (estimativa da SVS/MS) × 1.000, por ano de competência da AIH. Mede o uso do SUS hospitalar, não a necessidade de saúde: quem tem plano privado ou não consegue vaga aparece menos. Não é padronizada por idade.',
      'SUS-paid hospital admissions (SIH, type-1 AIH) of residents ÷ resident population (SVS/MS estimate) × 1,000, by AIH competence year. It measures use of SUS hospitals, not health need: people with private insurance or without access to a bed appear less. Not age-standardised.'),
  },
  {
    id: 'internacoes_idosos', grupo: G_INT, nome: () => t('Internações de idosos (60 anos ou mais)', 'Admissions of older adults (60+)'),
    unidade: () => t('por mil habitantes de 60 anos ou mais', 'per 1,000 aged 60 or over'), numerador: 'int_60_mais', denominador: 'pop_60_mais', fator: 1000, tipo: 'taxa', minimo: 1000,
    nota: () => t('Internações de residentes com 60 anos ou mais ÷ população de 60 anos ou mais × 1.000.', 'Admissions of residents aged 60 or over ÷ population aged 60 or over × 1,000.'),
  },
  {
    id: 'internacoes_criancas', grupo: G_INT, nome: () => t('Internações de menores de 5 anos', 'Admissions of children under 5'),
    unidade: () => t('por mil crianças de 0 a 4 anos', 'per 1,000 children aged 0–4'), numerador: 'int_menores_5', denominador: 'pop_0_4', fator: 1000, tipo: 'taxa', minimo: 1000,
    nota: () => t('Internações de residentes com menos de 5 anos ÷ população de 0 a 4 anos × 1.000.', 'Admissions of residents under 5 ÷ population aged 0–4 × 1,000.'),
  },
  {
    id: 'internacoes_fora', grupo: G_INT, nome: () => t('Internações fora do município de residência', 'Admissions outside the municipality of residence'),
    unidade: () => t('% das internações dos residentes', '% of residents’ admissions'), numerador: 'int_fora', denominador: 'int_total', fator: 1, tipo: 'proporcao', minimo: 500,
    nota: () => t('Internações de residentes feitas em hospital de outro município ÷ internações dos residentes. Valores altos indicam dependência de outros municípios; municípios pequenos e vizinhos de polos regionais costumam ter proporções altas, e isso não é falha de gestão por si só.',
      'Admissions of residents in a hospital of another municipality ÷ residents’ admissions. High values indicate dependence on other municipalities; small municipalities next to regional hubs usually have high shares, which is not a management failure by itself.'),
  },
  {
    id: 'mortalidade_hospitalar', grupo: G_INT, nome: () => t('Mortalidade hospitalar', 'In-hospital mortality'),
    unidade: () => t('% das internações', '% of admissions'), numerador: 'int_obitos', denominador: 'int_total', fator: 1, tipo: 'proporcao', minimo: 500,
    nota: () => t('Internações encerradas por óbito ÷ internações dos residentes (SIH). Depende da gravidade dos casos e do perfil do hospital: não é uma medida de qualidade e não deve ser usada sozinha para comparar lugares.',
      'Admissions ending in death ÷ residents’ admissions (SIH). It depends on case severity and hospital profile: it is not a quality measure and should not be used alone to compare places.'),
  },
  {
    id: 'permanencia_media', grupo: G_INT, nome: () => t('Tempo médio de permanência', 'Average length of stay'),
    unidade: () => t('dias por internação', 'days per admission'), numerador: 'int_dias', denominador: 'int_total', fator: 1, tipo: 'taxa', minimo: 500,
    nota: () => t('Soma dos dias de permanência ÷ internações dos residentes (SIH).', 'Sum of days of stay ÷ residents’ admissions (SIH).'),
  },
  {
    id: 'valor_por_internacao', grupo: G_INT, nome: () => t('Valor médio pago por internação', 'Average amount paid per admission'),
    unidade: () => t('R$ de 2025 por internação', 'R$ of 2025 per admission'), numerador: 'int_valor_real', denominador: 'int_total', fator: 1, tipo: 'taxa', minimo: 500,
    nota: () => t('Valor total das AIH pagas pelo SUS (serviços hospitalares e profissionais) ÷ internações dos residentes, em reais de 2025 pelo IPCA médio do ano (de 2010 em diante; antes, sem valor). É o valor da tabela do SUS, não o custo real do hospital.',
      'Total value of AIH paid by SUS (hospital and professional services) ÷ residents’ admissions, in 2025 reais using the average-year IPCA (from 2010 onward; earlier years have no value). It is the SUS table value, not the hospital’s actual cost.'),
  },
  {
    id: 'valor_por_habitante', grupo: G_INT, nome: () => t('Valor pago em internações por habitante', 'Amount paid for admissions per inhabitant'),
    unidade: () => t('R$ de 2025 por habitante', 'R$ of 2025 per inhabitant'), numerador: 'int_valor_real', denominador: 'populacao', fator: 1, tipo: 'taxa', minimo: 5000,
    nota: () => t('Valor total das AIH pagas pelo SUS aos residentes ÷ população residente, em reais de 2025 (de 2010 em diante). Reflete o que o SUS pagou, não o gasto da prefeitura.',
      'Total value of AIH paid by SUS for residents ÷ resident population, in 2025 reais (from 2010 onward). It reflects what SUS paid, not municipal spending.'),
  },
  // rede de saúde (CNES): retrato de dezembro, pelo município do estabelecimento
  {
    id: 'leitos_mil', grupo: G_REDE, nome: () => t('Leitos hospitalares existentes', 'Existing hospital beds'),
    unidade: () => t('por mil habitantes', 'per 1,000 inhabitants'), numerador: 'cnes_leitos', denominador: 'populacao', fator: 1000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Leitos existentes (SUS e não SUS) nos estabelecimentos do município ÷ população residente × 1.000. ${RESSALVA_CNES()}`, `Existing beds (SUS and non-SUS) in the municipality’s facilities ÷ resident population × 1,000. ${RESSALVA_CNES()}`),
  },
  {
    id: 'leitos_sus_mil', grupo: G_REDE, nome: () => t('Leitos SUS', 'SUS beds'),
    unidade: () => t('por mil habitantes', 'per 1,000 inhabitants'), numerador: 'cnes_leitos_sus', denominador: 'populacao', fator: 1000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Leitos disponíveis ao SUS ÷ população residente × 1.000. ${RESSALVA_CNES()}`, `Beds available to SUS ÷ resident population × 1,000. ${RESSALVA_CNES()}`),
  },
  {
    id: 'medicos_mil', grupo: G_REDE, nome: () => t('Médicos', 'Physicians'),
    unidade: () => t('por mil habitantes', 'per 1,000 inhabitants'), numerador: 'cnes_medicos', denominador: 'populacao', fator: 1000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Médicos (CBO 225 e 2231), cada pessoa (CNS) contada uma só vez no ano, no município do seu vínculo de maior carga horária, ÷ população residente × 1.000. Assim UF e Brasil somam pessoas distintas. Médicos que atendem em mais de um município aparecem só no principal; de 2007 em diante (em 2006 a CBO ainda não era a de 2002). ${RESSALVA_CNES()}`,
      `Physicians (CBO 225 and 2231), each person (CNS) counted once a year, in the municipality of their link with the most weekly hours, ÷ resident population × 1,000. So states and Brazil add up distinct people. Physicians who work in more than one municipality appear only in the main one; from 2007 on (in 2006 the CBO was not yet the 2002 one). ${RESSALVA_CNES()}`),
  },
  {
    id: 'enfermeiros_mil', grupo: G_REDE, nome: () => t('Enfermeiros', 'Nurses'),
    unidade: () => t('por mil habitantes', 'per 1,000 inhabitants'), numerador: 'cnes_enfermeiros', denominador: 'populacao', fator: 1000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Enfermeiros (CBO 2235), cada pessoa (CNS) uma só vez no ano, no município do vínculo de maior carga horária, ÷ população residente × 1.000. De 2007 em diante. ${RESSALVA_CNES()}`, `Nurses (CBO 2235), each person (CNS) once a year, in the municipality of their link with the most weekly hours, ÷ resident population × 1,000. From 2007 on. ${RESSALVA_CNES()}`),
  },
  {
    id: 'estabelecimentos_10mil', grupo: G_REDE, nome: () => t('Estabelecimentos de saúde', 'Health facilities'),
    unidade: () => t('por 10 mil habitantes', 'per 10,000 inhabitants'), numerador: 'cnes_estab', denominador: 'populacao', fator: 10000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Estabelecimentos cadastrados no CNES (de qualquer tipo, com ou sem vínculo SUS) ÷ população residente × 10.000. ${RESSALVA_CNES()}`, `Facilities registered in CNES (of any type, with or without SUS link) ÷ resident population × 10,000. ${RESSALVA_CNES()}`),
  },
  {
    id: 'leitos_sus_proporcao', grupo: G_REDE, nome: () => t('Participação do SUS nos leitos', 'SUS share of beds'),
    unidade: () => t('% dos leitos existentes', '% of existing beds'), numerador: 'cnes_leitos_sus', denominador: 'cnes_leitos', fator: 1, tipo: 'proporcao', minimo: 20,
    nota: () => t('Leitos SUS ÷ leitos existentes no município. Pode passar de 100% em municípios pequenos por inconsistência de cadastro (leitos SUS maiores que os existentes).', 'SUS beds ÷ existing beds in the municipality. It can exceed 100% in small municipalities because of registry inconsistencies (SUS beds greater than existing).'),
  },
  // agravos de notificação (SINAN), arquivos finais, por município de residência e ano do arquivo
  {
    id: 'dengue_incidencia', grupo: G_AGRAVOS, nome: () => t('Dengue: casos prováveis', 'Dengue: probable cases'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'sinan_dengue_provaveis', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Casos de dengue notificados e não descartados (os arquivos públicos do SINAN já excluem os descartados) ÷ população residente × 100.000. ${RESSALVA_SINAN()}`, `Dengue cases notified and not discarded (the public SINAN files already exclude discarded ones) ÷ resident population × 100,000. ${RESSALVA_SINAN()}`),
  },
  {
    id: 'dengue_letalidade', grupo: G_AGRAVOS, nome: () => t('Dengue: letalidade entre os confirmados', 'Dengue: case fatality among confirmed'),
    unidade: () => t('% dos casos confirmados', '% of confirmed cases'), numerador: 'sinan_dengue_obitos', denominador: 'sinan_dengue_confirmados', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t(`Óbitos pelo agravo (evolução = óbito pelo agravo) entre os casos confirmados ÷ casos confirmados (classificação final dengue, com sinais de alarme ou grave; nos anos antigos, dengue clássica, com complicações, FHD ou SCD). ${RESSALVA_SINAN()}`,
      `Deaths from the disease (outcome = death from the disease) among confirmed cases ÷ confirmed cases (final classification dengue, with warning signs or severe; in old years, classic dengue, with complications, DHF or DSS). ${RESSALVA_SINAN()}`),
  },
  {
    id: 'dengue_graves', grupo: G_AGRAVOS, nome: () => t('Dengue: proporção de casos graves', 'Dengue: share of severe cases'),
    unidade: () => t('% dos casos confirmados', '% of confirmed cases'), numerador: 'sinan_dengue_graves', denominador: 'sinan_dengue_confirmados', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t(`Dengue grave (classificação 12, ou FHD e SCD nos anos antigos) ÷ casos confirmados. ${RESSALVA_SINAN()}`, `Severe dengue (classification 12, or DHF and DSS in old years) ÷ confirmed cases. ${RESSALVA_SINAN()}`),
  },
  {
    id: 'chik_incidencia', grupo: G_AGRAVOS, nome: () => t('Chikungunya: casos confirmados', 'Chikungunya: confirmed cases'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'sinan_chik_confirmados', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Casos de chikungunya com classificação final confirmada ÷ população residente × 100.000 (de 2014 em diante). ${RESSALVA_SINAN()}`, `Chikungunya cases with a confirmed final classification ÷ resident population × 100,000 (from 2014). ${RESSALVA_SINAN()}`),
  },
  {
    id: 'tb_incidencia', grupo: G_AGRAVOS, nome: () => t('Tuberculose: casos novos', 'Tuberculosis: new cases'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'sinan_tb_casos_novos', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Notificações com tipo de entrada "caso novo" (sem recidiva, reingresso após abandono, transferência nem diagnóstico pós-óbito) ÷ população residente × 100.000. Os arquivos finais do SINAN só vão até 2019; depois disso a tuberculose passou a outro sistema. ${RESSALVA_SINAN()}`,
      `Notifications with entry type "new case" (no relapse, return after default, transfer or post-mortem diagnosis) ÷ resident population × 100,000. The final SINAN files only go to 2019; afterwards tuberculosis moved to another system. ${RESSALVA_SINAN()}`),
  },
  {
    id: 'hans_deteccao', grupo: G_AGRAVOS, nome: () => t('Hanseníase: casos novos', 'Leprosy: new cases'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'sinan_hans_casos_novos', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Notificações com modo de entrada "caso novo" ÷ população residente × 100.000 (taxa de detecção). ${RESSALVA_SINAN()}`, `Notifications with entry mode "new case" ÷ resident population × 100,000 (detection rate). ${RESSALVA_SINAN()}`),
  },
  {
    id: 'violencia_notificada', grupo: G_AGRAVOS, nome: () => t('Violência interpessoal e autoprovocada notificada', 'Notified interpersonal and self-harm violence'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'sinan_viol_notificacoes', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Notificações de violência (SINAN-VIVA) ÷ população residente × 100.000. Mede a notificação, não a ocorrência: municípios com mais serviços que notificam aparecem com mais violência, e a cobertura cresceu muito desde 2009. ${RESSALVA_SINAN()}`,
      `Violence notifications (SINAN-VIVA) ÷ resident population × 100,000. It measures notification, not occurrence: municipalities with more reporting services appear to have more violence, and coverage grew a lot since 2009. ${RESSALVA_SINAN()}`),
  },
  // câncer: rastreamento (SISCAN) e diagnósticos (Painel de Oncologia), por município de residência
  {
    id: 'cito_25_64', grupo: G_CANCER, nome: () => t('Colo do útero: exames citopatológicos em mulheres de 25 a 64 anos', 'Cervical cancer: Pap smears in women aged 25–64'),
    unidade: () => t('por 100 mulheres de 25 a 64 anos', 'per 100 women aged 25–64'), numerador: 'siscan_cito_25_64', denominador: 'pop_mulheres_25_64', fator: 100, tipo: 'taxa', minimo: 2000,
    nota: () => t(`Exames citopatológicos do colo do útero liberados no ano (SISCAN) em mulheres de 25 a 64 anos residentes ÷ mulheres dessa faixa × 100. É o número de exames no ano, não a cobertura: a diretriz é um exame a cada três anos depois de dois normais seguidos. ${RESSALVA_SISCAN()}`,
      `Pap smears released in the year (SISCAN) in women aged 25–64 resident in the municipality ÷ women in that age band × 100. It is the number of tests in the year, not coverage: the guideline is one test every three years after two consecutive normal ones. ${RESSALVA_SISCAN()}`),
  },
  {
    id: 'cito_alterados', grupo: G_CANCER, nome: () => t('Colo do útero: exames citopatológicos alterados', 'Cervical cancer: abnormal Pap smears'),
    unidade: () => t('% dos exames', '% of tests'), numerador: 'siscan_cito_alterados', denominador: 'siscan_cito', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t(`Exames marcados como alterados no SISCAN ÷ exames citopatológicos do colo liberados. Alterado não é câncer: inclui desde alterações celulares leves até lesões de alto grau. ${RESSALVA_SISCAN()}`,
      `Tests flagged as abnormal in SISCAN ÷ cervical Pap smears released. Abnormal is not cancer: it ranges from mild cell changes to high-grade lesions. ${RESSALVA_SISCAN()}`),
  },
  {
    id: 'mamo_50_69', grupo: G_CANCER, nome: () => t('Mama: mamografias em mulheres de 50 a 69 anos', 'Breast cancer: mammograms in women aged 50–69'),
    unidade: () => t('por 100 mulheres de 50 a 69 anos', 'per 100 women aged 50–69'), numerador: 'siscan_mamo_50_69', denominador: 'pop_mulheres_50_69', fator: 100, tipo: 'taxa', minimo: 1000,
    nota: () => t(`Mamografias (de rastreamento e diagnósticas) liberadas no ano no SISCAN em mulheres de 50 a 69 anos residentes ÷ mulheres dessa faixa × 100. A diretriz é um exame a cada dois anos: valores perto de 50 equivaleriam à cobertura plena só pelo SISCAN. ${RESSALVA_SISCAN()}`,
      `Mammograms (screening and diagnostic) released in the year in SISCAN in women aged 50–69 resident in the municipality ÷ women in that age band × 100. The guideline is one test every two years: values near 50 would mean full coverage through SISCAN alone. ${RESSALVA_SISCAN()}`),
  },
  {
    id: 'cancer_registros', grupo: G_CANCER, nome: () => t('Câncer: diagnósticos registrados no Painel de Oncologia', 'Cancer: diagnoses recorded in the Oncology Panel'),
    unidade: () => t('por 100 mil habitantes', 'per 100,000 inhabitants'), numerador: 'onco_casos', denominador: 'populacao', fator: 100000, tipo: 'taxa', minimo: 5000,
    nota: () => t(`Diagnósticos de câncer (CID-10 C, inclusive câncer de pele não melanoma e metástases) registrados no Painel de Oncologia do SUS, pelo ano do diagnóstico e município de residência ÷ população × 100.000. É registro de diagnósticos, não incidência: depende de os casos chegarem aos sistemas do SUS (quem se trata só na rede privada pode não aparecer). Antes de 2019 o painel cobria bem menos casos, então a série começa em 2019. Os últimos anos ainda recebem registros.`,
      `Cancer diagnoses (ICD-10 C, including non-melanoma skin cancer and metastases) recorded in the SUS Oncology Panel, by year of diagnosis and municipality of residence ÷ population × 100,000. It counts recorded diagnoses, not incidence: it depends on cases reaching SUS systems (those treated only privately may not appear). Before 2019 the panel covered far fewer cases, so the series starts in 2019. The latest years still receive records.`),
  },
  {
    id: 'cancer_60_dias', grupo: G_CANCER, nome: () => t('Câncer: tratamento iniciado em até 60 dias do diagnóstico', 'Cancer: treatment started within 60 days of diagnosis'),
    unidade: () => t('% dos que iniciaram tratamento', '% of those who started treatment'), numerador: 'onco_trat_60d', denominador: 'onco_trat_validos', fator: 1, tipo: 'proporcao', minimo: 100,
    nota: () => t(`Entre os diagnósticos com data de início de tratamento igual ou posterior à do diagnóstico, os que começaram em até 60 dias (prazo da Lei 12.732/2012) ÷ os que iniciaram tratamento. Não conta quem ainda não tem tratamento registrado, então não é a proporção de todos os pacientes (cerca de 40% dos diagnósticos não têm tratamento registrado). O último ano ainda é incompleto.`,
      `Among diagnoses with a treatment start date on or after the diagnosis date, those that started within 60 days (the deadline in Law 12,732/2012) ÷ those that started treatment. It leaves out people with no treatment recorded yet, so it is not the share of all patients (about 40% of diagnoses have no treatment recorded). The latest year is still incomplete.`),
  },
  // microcefalia (RESP), por município de residência e ano da notificação
  {
    id: 'resp_notificacoes', grupo: G_RESP, nome: () => t('Microcefalia e alterações do SNC: notificações', 'Microcephaly and CNS changes: notifications'),
    unidade: () => t('por 100 mil nascidos vivos', 'per 100,000 live births'), numerador: 'resp_notificacoes', denominador: 'nascidos', fator: 100000, tipo: 'taxa', minimo: 10000,
    nota: () => t(`Notificações no RESP (registro criado na emergência da síndrome congênita ligada ao vírus Zika) de recém-nascidos, crianças, fetos, natimortos e abortos com microcefalia ou alterações do sistema nervoso central, pelo ano da notificação e município de residência, sem as excluídas ÷ nascidos vivos × 100.000. Notificação não é caso confirmado e a vigilância mudou muito depois de 2016. Veja também as confirmadas.`,
      `RESP notifications (a registry created during the emergency of congenital syndrome linked to Zika virus) of newborns, children, fetuses, stillbirths and miscarriages with microcephaly or central nervous system changes, by year of notification and municipality of residence, excluding the removed ones ÷ live births × 100,000. A notification is not a confirmed case and surveillance changed a lot after 2016. See also the confirmed ones.`),
  },
  {
    id: 'resp_confirmadas', grupo: G_RESP, nome: () => t('Microcefalia e alterações do SNC: confirmadas', 'Microcephaly and CNS changes: confirmed'),
    unidade: () => t('por 100 mil nascidos vivos', 'per 100,000 live births'), numerador: 'resp_confirmadas', denominador: 'nascidos', fator: 100000, tipo: 'taxa', minimo: 10000,
    nota: () => t(`Notificações do RESP com classificação final "confirmado" ÷ nascidos vivos × 100.000, pelo ano da notificação e município de residência. A confirmação pode levar meses: os últimos anos tendem a ficar subestimados.`,
      `RESP notifications with final classification "confirmed" ÷ live births × 100,000, by year of notification and municipality of residence. Confirmation can take months: the latest years tend to be underestimated.`),
  },
];

export const indicador = (id: string | null | undefined) => INDICADORES.find((i) => i.id === id) ?? INDICADORES[0];

/** Valor do indicador numa linha de contagens (município, UF, Brasil ou ano da série); null sem denominador. */
export function calcular(ind: Indicador, r: Linha | undefined): number | null {
  const n = num(r?.[ind.numerador]);
  const d = num(r?.[ind.denominador]);
  if (n === null || !d) return null;
  return (n / d) * ind.fator;
}

/** Nome legível de cada contagem usada como numerador ou denominador (rótulos de tabela e filtros). */
export const nomeContagem = (c: string): string => ({
  populacao: t('População', 'Population'), pop_30_69: t('População de 30 a 69 anos', 'Population aged 30–69'),
  nascidos: t('Nascidos vivos', 'Live births'), obitos: t('Óbitos', 'Deaths'), infantis: t('Óbitos infantis', 'Infant deaths'),
  neonatais: t('Óbitos neonatais', 'Neonatal deaths'), pos_neonatais: t('Óbitos pós-neonatais', 'Post-neonatal deaths'),
  menores_5: t('Óbitos de menores de 5', 'Deaths under 5'), maternos: t('Óbitos maternos', 'Maternal deaths'),
  dcnt_30_69: t('Óbitos por DCNT (30–69)', 'NCD deaths (30–69)'), homicidios: t('Homicídios', 'Homicides'), suicidios: t('Suicídios', 'Suicides'),
  transito: t('Mortes no trânsito', 'Road deaths'), mal_definidas: t('Óbitos mal definidos', 'Ill-defined deaths'),
  baixo_peso: t('Nascidos com baixo peso', 'Low-weight births'), peso_informado: t('Nascidos com peso informado', 'Births with weight recorded'),
  prematuros: t('Nascidos prematuros', 'Preterm births'), gestacao_informada: t('Nascidos com gestação informada', 'Births with gestation recorded'),
  cesareos: t('Nascidos de cesárea', 'Caesarean births'), parto_informado: t('Nascidos com parto informado', 'Births with delivery recorded'),
  consultas_7_mais: t('Nascidos com 7+ consultas', 'Births with 7+ visits'), consultas_informadas: t('Nascidos com consultas informadas', 'Births with visits recorded'),
  maes_10_19: t('Nascidos de mães de 10–19 anos', 'Births to mothers aged 10–19'), idade_mae_informada: t('Nascidos com idade da mãe informada', 'Births with mother’s age recorded'),
  int_total: t('Internações', 'Admissions'), int_fora: t('Internações fora do município', 'Admissions outside the municipality'),
  int_obitos: t('Internações com óbito', 'Admissions ending in death'), int_dias: t('Dias de internação', 'Days of stay'),
  int_60_mais: t('Internações de 60 anos ou mais', 'Admissions aged 60+'), int_menores_5: t('Internações de menores de 5', 'Admissions under 5'),
  int_valor_real: t('Valor pago (R$ de 2025)', 'Amount paid (R$ of 2025)'), pop_60_mais: t('População de 60 anos ou mais', 'Population aged 60+'),
  pop_0_4: t('População de 0 a 4 anos', 'Population aged 0–4'),
  cnes_leitos: t('Leitos existentes', 'Existing beds'), cnes_leitos_sus: t('Leitos SUS', 'SUS beds'), cnes_medicos: t('Médicos', 'Physicians'),
  cnes_enfermeiros: t('Enfermeiros', 'Nurses'), cnes_estab: t('Estabelecimentos', 'Facilities'),
  sinan_dengue_provaveis: t('Casos prováveis de dengue', 'Probable dengue cases'), sinan_dengue_confirmados: t('Casos confirmados de dengue', 'Confirmed dengue cases'),
  sinan_dengue_graves: t('Casos graves de dengue', 'Severe dengue cases'), sinan_dengue_obitos: t('Óbitos por dengue (confirmados)', 'Dengue deaths (confirmed)'),
  sinan_chik_confirmados: t('Casos confirmados de chikungunya', 'Confirmed chikungunya cases'), sinan_tb_casos_novos: t('Casos novos de tuberculose', 'New tuberculosis cases'),
  sinan_hans_casos_novos: t('Casos novos de hanseníase', 'New leprosy cases'), sinan_viol_notificacoes: t('Notificações de violência', 'Violence notifications'),
  pop_mulheres_25_64: t('Mulheres de 25 a 64 anos', 'Women aged 25–64'), pop_mulheres_50_69: t('Mulheres de 50 a 69 anos', 'Women aged 50–69'),
  siscan_cito: t('Exames citopatológicos do colo', 'Cervical Pap smears'), siscan_cito_25_64: t('Citopatológicos em mulheres de 25 a 64 anos', 'Pap smears in women aged 25–64'),
  siscan_cito_alterados: t('Citopatológicos alterados', 'Abnormal Pap smears'), siscan_mamo_50_69: t('Mamografias em mulheres de 50 a 69 anos', 'Mammograms in women aged 50–69'),
  onco_casos: t('Diagnósticos de câncer', 'Cancer diagnoses'), onco_trat_60d: t('Tratamentos iniciados em até 60 dias', 'Treatments started within 60 days'),
  onco_trat_validos: t('Diagnósticos com tratamento iniciado', 'Diagnoses with treatment started'),
  resp_notificacoes: t('Notificações de microcefalia (RESP)', 'Microcephaly notifications (RESP)'), resp_confirmadas: t('Confirmadas de microcefalia (RESP)', 'Confirmed microcephaly (RESP)'),
}[c] ?? c);

export const formatar = (ind: Indicador, v: number | null | undefined) => (ind.tipo === 'proporcao' ? pct(v) : numero1(v));

export const fonteSaude = () => t(
  'SIM (Sistema de Informações sobre Mortalidade), SINASC (Sistema de Informações sobre Nascidos Vivos), SIH (Sistema de Informações Hospitalares do SUS), CNES (Cadastro Nacional de Estabelecimentos de Saúde), SINAN (agravos de notificação), SISCAN (controle do câncer do colo do útero e da mama), Painel de Oncologia e RESP (microcefalia), Ministério da Saúde/DATASUS, microdados públicos por município de residência; população: estimativas da SVS/MS por município, sexo e idade (2000 em diante). Processamento: LAPAM/UFG.',
  'SIM (Mortality Information System), SINASC (Live Birth Information System), SIH (SUS Hospital Information System), CNES (National Registry of Health Facilities), SINAN (notifiable diseases), SISCAN (cervical and breast cancer control), Oncology Panel and RESP (microcephaly), Ministry of Health/DATASUS, public microdata by municipality of residence; population: SVS/MS estimates by municipality, sex and age (2000 onwards). Processing: LAPAM/UFG.',
);

/** Capítulos da CID-10 (causa básica do óbito), na ordem das colunas cap01…cap22. */
export const CAPITULOS = (): [string, string][] => [
  ['cap01', t('I. Infecciosas e parasitárias', 'I. Infectious and parasitic')],
  ['cap02', t('II. Neoplasias (tumores)', 'II. Neoplasms')],
  ['cap03', t('III. Sangue e imunidade', 'III. Blood and immune')],
  ['cap04', t('IV. Endócrinas, nutricionais e metabólicas', 'IV. Endocrine, nutritional and metabolic')],
  ['cap05', t('V. Transtornos mentais', 'V. Mental disorders')],
  ['cap06', t('VI. Sistema nervoso', 'VI. Nervous system')],
  ['cap07', t('VII. Olho', 'VII. Eye')],
  ['cap08', t('VIII. Ouvido', 'VIII. Ear')],
  ['cap09', t('IX. Aparelho circulatório', 'IX. Circulatory system')],
  ['cap10', t('X. Aparelho respiratório', 'X. Respiratory system')],
  ['cap11', t('XI. Aparelho digestivo', 'XI. Digestive system')],
  ['cap12', t('XII. Pele', 'XII. Skin')],
  ['cap13', t('XIII. Osteomuscular', 'XIII. Musculoskeletal')],
  ['cap14', t('XIV. Geniturinário', 'XIV. Genitourinary')],
  ['cap15', t('XV. Gravidez, parto e puerpério', 'XV. Pregnancy and childbirth')],
  ['cap16', t('XVI. Afecções perinatais', 'XVI. Perinatal conditions')],
  ['cap17', t('XVII. Malformações congênitas', 'XVII. Congenital malformations')],
  ['cap18', t('XVIII. Mal definidas', 'XVIII. Ill-defined')],
  ['cap20', t('XX. Causas externas', 'XX. External causes')],
  ['cap22', t('XXII. Códigos especiais (inclui COVID-19)', 'XXII. Special codes (incl. COVID-19)')],
];
