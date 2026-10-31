/**
 * Indicadores do painel de saúde (SIM, SINASC e população da SVS/MS), calculados no navegador a partir das
 * contagens de gold/saude/municipios.parquet. Em qualquer agregado (UF, Brasil, série), a taxa é a razão das
 * somas (Σ numerador ÷ Σ denominador), nunca a média das taxas dos municípios.
 */
import type { Linha } from './api';
import { numero1, pct } from './format';
import { num } from './hooks';
import { t } from './idioma';

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
}[c] ?? c);

export const formatar = (ind: Indicador, v: number | null | undefined) => (ind.tipo === 'proporcao' ? pct(v) : numero1(v));

export const fonteSaude = () => t(
  'SIM (Sistema de Informações sobre Mortalidade) e SINASC (Sistema de Informações sobre Nascidos Vivos), Ministério da Saúde/DATASUS, microdados públicos por município de residência; população: estimativas da SVS/MS por município, sexo e idade (2000 em diante). Processamento: LAPAM/UFG.',
  'SIM (Mortality Information System) and SINASC (Live Birth Information System), Ministry of Health/DATASUS, public microdata by municipality of residence; population: SVS/MS estimates by municipality, sex and age (2000 onwards). Processing: LAPAM/UFG.',
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
