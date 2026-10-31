/**
 * Notas metodológicas das respostas da IA, conferidas nos documentos oficiais (o trecho citado é literal e
 * o documento tem endereço e página). As de quebra de série valem para números da RAIS cujo período
 * atravessa o ano da mudança: a página põe a nota junto ao destaque e à conclusão, marca o ano no gráfico e
 * devolve ao modelo a resposta que compara esses anos sem dizer isso.
 */
import { local, t } from './idioma';
import { ehCompetencia, rotuloCompetencia, sqlSemTextos, type Periodo } from './ia_formato';

export type NotaMetodologica = {
  id: string;
  fonte: 'rais' | 'caged' | 'financas' | 'ibge' | 'metodo';
  /** Primeiro ano da série nova: um período atravessa a quebra quando começa antes dele e termina nele ou depois. */
  quebra?: number;
  titulo: () => string;
  /** Uma frase, para o alerta junto ao número. */
  curta: () => string;
  texto: () => string;
  documento: string;
  url: string;
  /** Trecho literal do documento (em português). */
  trecho: string;
  /** Data em que o texto foi conferido no documento. */
  conferidaEm: string;
};

const NOTA_RAIS_2022 = 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais/rais-2022/apresentacao_rais-2022_nota_tecnica.pdf';
const NOTA_RAIS_2023 = 'https://www.gov.br/trabalho-e-emprego/pt-br/acesso-a-informacao/acoes-e-programas/programas-projetos-acoes-obras-e-atividades/estatisticas-trabalho/rais/rais-2023/nota-tecnica-rais-2023_11-12-2024.pdf';

export const NOTAS: NotaMetodologica[] = [
  {
    id: 'rais-2022',
    fonte: 'rais',
    quebra: 2022,
    titulo: () => t('Quebra de série da RAIS em 2022 (eSocial)', 'RAIS series break in 2022 (eSocial)'),
    curta: () => t('Em 2022, empresas do Simples Nacional, entidades sem fins lucrativos e empregadores pessoa física passaram a declarar a RAIS pelo eSocial, o que ampliou a cobertura.',
      'In 2022, Simples Nacional firms, non-profits and individual employers started reporting RAIS through eSocial, which widened coverage.'),
    texto: () => t('Em 2022, a RAIS das empresas do Simples Nacional, das entidades sem fins lucrativos e dos empregadores pessoa física (Grupo 3 do eSocial) passou a ser constituída pelo eSocial, o que ampliou a cobertura. Para o Ministério do Trabalho, isso impede a comparação direta de 2022 com a série anterior: no Brasil, dos 4.061.993 vínculos a mais entre a RAIS 2021 e a de 2022, 1.795.646 vieram do aumento de cobertura e 2.266.347 da geração de empregos do ano.',
      'In 2022, RAIS for Simples Nacional firms, non-profits and individual employers (eSocial Group 3) started being built from eSocial, which widened coverage. According to the Ministry of Labour, 2022 cannot be compared directly with earlier years: in Brazil, of the 4,061,993 additional jobs between RAIS 2021 and 2022, 1,795,646 came from wider coverage and 2,266,347 from job creation in the year.'),
    documento: 'MTE, RAIS 2022: aumento de cobertura e consequências para a série histórica (slides 3, 5 e 10)',
    url: NOTA_RAIS_2022,
    trecho: 'Esses dados demonstram a impossibilidade de comparação direta do resultado de 202[2] com os dados da série histórica anterior da RAIS',
    conferidaEm: '2026-10-27',
  },
  {
    id: 'rais-2023',
    fonte: 'rais',
    quebra: 2023,
    titulo: () => t('Quebra de série da RAIS em 2023 (órgãos públicos no eSocial)', 'RAIS series break in 2023 (public bodies in eSocial)'),
    curta: () => t('Em 2023, os órgãos públicos passaram a declarar pelo eSocial, e a RAIS passou a vir toda dele, com mudança na forma de declarar o tipo de vínculo no setor público.',
      'In 2023, public bodies started reporting through eSocial and RAIS came entirely from it, changing how public-sector job types are reported.'),
    texto: () => t('2023 é o primeiro ano com a RAIS toda captada pelo eSocial, com a entrada dos órgãos públicos e organizações internacionais (Grupo 4). Isso mudou a forma de declarar o tipo de vínculo no setor público: no Brasil, os vínculos estatutários caíram 13,8% e os contratos por prazo determinado regidos por lei municipal ou estadual cresceram. O Ministério do Trabalho não recomenda comparar diretamente os resultados de 2023 com os de anos anteriores.',
      '2023 is the first year with RAIS entirely captured by eSocial, as public bodies and international organizations (Group 4) joined. This changed how public-sector job types are reported: in Brazil, statutory jobs fell 13.8% and fixed-term contracts under municipal or state law grew. The Ministry of Labour advises against comparing 2023 directly with earlier years.'),
    documento: 'MTE, Nota técnica da RAIS ano-base 2023, 11/12/2024 (p. 1, 3 e 4)',
    url: NOTA_RAIS_2023,
    trecho: 'No ano-base 2023, assim como em 2022, percebeu-se a ocorrência de importante quebra na série histórica da RAIS. Por esse motivo, não se recomenda a comparação direta dos resultados desse ano com os resultados de anos anteriores.',
    conferidaEm: '2026-10-27',
  },
  {
    id: 'rais-vinculos',
    fonte: 'rais',
    titulo: () => t('Vínculos, não pessoas', 'Jobs, not people'),
    curta: () => t('A RAIS conta vínculos de emprego: quem tem dois empregos conta duas vezes.', 'RAIS counts jobs: a person with two jobs counts twice.'),
    texto: () => t('A RAIS registra cada relação de trabalho formal (trabalhador, estabelecimento e o vínculo entre eles): quem tem dois empregos conta duas vezes. Os números são de vínculos, não de pessoas; os empregos formais são os vínculos ativos em 31 de dezembro, no município do estabelecimento.',
      'RAIS records each formal employment relationship (worker, establishment and the link between them): a person with two jobs counts twice. Figures are jobs, not people; formal jobs are those active on 31 December, in the establishment’s municipality.'),
    documento: 'MTE, Nota técnica da RAIS ano-base 2023, 11/12/2024 (p. 3 e 4, arquitetura das bases)',
    url: NOTA_RAIS_2023,
    trecho: 'cada relação de trabalho formal declarada (constituída por um trabalhador, um estabelecimento empregador e as relações estabelecidas entre eles) é registrada na base',
    conferidaEm: '2026-10-27',
  },
  {
    id: 'caged-fluxos',
    fonte: 'caged',
    titulo: () => t('Novo CAGED: fluxos de empregos celetistas', 'New CAGED: flows of CLT jobs'),
    curta: () => t('O CAGED mede fluxos (admissões, desligamentos, saldo) de empregos celetistas, não o estoque.', 'CAGED measures flows (hirings, separations, net) of CLT jobs, not the stock.'),
    texto: () => t('O Novo CAGED registra admissões e desligamentos de empregos com carteira (celetistas), sem estatutários. O painel usa a série com ajustes: declarações no prazo, mais as entregues fora do prazo, menos as exclusões, todas pela competência da movimentação. É fluxo: não se soma ao estoque da RAIS.',
      'New CAGED records hirings and separations of CLT (formal private-sector) jobs, without statutory civil servants. The dashboard uses the adjusted series: on-time filings plus late filings minus exclusions, all by the month of the movement. It is a flow and is not added to the RAIS stock.'),
    documento: 'MTE/PDET, microdados do Novo CAGED (arquivos de movimentações no prazo, fora do prazo e exclusões), processados pelo LAPAM/UFG',
    url: 'ftp://ftp.mtps.gov.br/pdet/microdados/NOVO%20CAGED/',
    trecho: '',
    conferidaEm: '2026-10-27',
  },
];

/** Notas das populações, da divisão 84 da CNAE e da regressão: valem para qualquer consulta que as use. */
export const NOTAS_METODO: NotaMetodologica[] = [
  {
    id: 'populacao-declarada',
    fonte: 'financas',
    titulo: () => t('População declarada na DCA', 'Population reported in the DCA'),
    curta: () => t('A população de indicadores é a declarada pelo ente na DCA, que costuma repetir uma estimativa do IBGE de um ou dois anos antes; não é a estimativa do IBGE do ano.',
      'The population in indicadores is the one the government reported in its DCA, which usually repeats an IBGE estimate from one or two years earlier; it is not the IBGE estimate for the year.'),
    texto: () => t('indicadores.populacao (e lrf.populacao) é a população informada pelo próprio ente na Declaração de Contas Anuais do exercício. Ela costuma repetir uma estimativa do IBGE de um ou dois anos antes: Goiânia declarou em 2022 e 2023 a estimativa de 2021 (1.555.626) e, em 2024 e 2025, 1.414.483, que não corresponde a nenhuma publicação do IBGE; o Censo 2022 contou 1.437.366 e a estimativa de 2025 é 1.503.256. Em 2022 e 2023, 3.356 municípios declararam valores mais de 5% diferentes da população do IBGE. Para valores por habitante comparáveis com o IBGE, use populacao_ibge.',
      'indicadores.populacao (and lrf.populacao) is the population the government itself reported in the year’s Annual Accounts Statement. It usually repeats an IBGE estimate from one or two years earlier. For per-inhabitant values comparable with IBGE, use populacao_ibge.'),
    documento: 'LAPAM/UFG: comparação da população declarada no SICONFI com as publicações do IBGE (SIDRA 4709 e 6579)',
    url: 'https://sidra.ibge.gov.br/tabela/6579',
    trecho: '',
    conferidaEm: '2026-10-30',
  },
  {
    id: 'populacao-ibge',
    fonte: 'ibge',
    titulo: () => t('População de referência do IBGE', 'IBGE reference population'),
    curta: () => t('População do IBGE do próprio ano (estimativa de 1º de julho ou censo); em 2023, sem publicação, o Censo 2022.',
      'IBGE population for the same year (July 1 estimate or census); in 2023, with no publication, the 2022 Census.'),
    texto: () => t('populacao_ibge (indicadores) e populacao (trab_municipios) são a publicação do IBGE do próprio ano: estimativa da população residente em 1º de julho (SIDRA 6579) ou Censo (2010, SIDRA 202; 2022, SIDRA 4709). O IBGE não publicou estimativa para 2023: o painel usa o Censo 2022, como o IBGE faz no PIB per capita municipal; populacao_ibge_ano diz qual publicação entrou. pib_per_capita é recalculado pelo painel (PIB ÷ populacao_ibge) e confere com o IBGE Cidades (Goiânia, 2023: R$ 52.722,02). Até 2021 as estimativas são projeções a partir do Censo 2010; com o Censo 2022 a população de muitos municípios cai (Goiânia: 1.555.626 em 2021 e 1.437.366 em 2022), então valores por habitante comparados entre esses dois períodos misturam bases diferentes.',
      'populacao_ibge (indicadores) and populacao (trab_municipios) are the IBGE publication for the same year: July 1 resident population estimate (SIDRA 6579) or Census (2010, SIDRA 202; 2022, SIDRA 4709). IBGE did not publish an estimate for 2023: the dashboard uses the 2022 Census, as IBGE does for municipal GDP per capita; populacao_ibge_ano tells which publication was used.'),
    documento: 'IBGE, Estimativas da população residente (SIDRA 6579) e Censos Demográficos 2010 e 2022 (SIDRA 202 e 4709)',
    url: 'https://sidra.ibge.gov.br/tabela/6579',
    trecho: '',
    conferidaEm: '2026-10-30',
  },
  {
    id: 'adm-publica-cnae84',
    fonte: 'rais',
    titulo: () => t('Administração pública = divisão 84 da CNAE (atividade)', 'Public administration = CNAE division 84 (activity)'),
    curta: () => t('"Administração pública" nas tabelas do painel é a divisão 84 da CNAE: atividade, de todas as esferas, no município do estabelecimento; não é a natureza jurídica nem só a prefeitura.',
      '"Public administration" in the dashboard tables is CNAE division 84: an activity, of all levels of government, in the establishment’s municipality; it is not legal nature nor only the city government.'),
    texto: () => t('empregos_adm_publica (trab_municipios) e o setor "Administração pública" (trab_grandes_setores) são os vínculos ativos em 31/12 em estabelecimentos da divisão 84 da CNAE 2.0 (administração pública, defesa e seguridade social), no município do estabelecimento, das três esferas: incluem órgãos estaduais e federais situados no município. Escolas e hospitais públicos ficam em educação e saúde (outras divisões). O setor público pela natureza jurídica (grupo 1; prefeitura: 1031, 1244, 1120 e 1155) é outro recorte e só existe nos microdados. A igualdade dos totais com a divisão 84 decorre da própria definição e não comprova equivalência com a natureza jurídica.',
      'empregos_adm_publica and the "Public administration" sector are jobs active on 31 Dec in establishments of CNAE 2.0 division 84, in the establishment’s municipality, at all levels of government. Public schools and hospitals are in education and health. The public sector by legal nature is a different cut, only in the microdata.'),
    documento: 'LAPAM/UFG: regra do pipeline (pipeline/trabalho.py, GRANDE_SETOR) sobre a CNAE 2.0 do IBGE/CONCLA',
    url: 'https://concla.ibge.gov.br/busca-online-cnae.html',
    trecho: '',
    conferidaEm: '2026-10-30',
  },
  {
    id: 'regressao',
    fonte: 'metodo',
    titulo: () => t('Regressão calculada pela página', 'Regression computed by the page'),
    curta: () => t('Coeficientes por MQO, com o erro-padrão e a distribuição informados na tabela; mostram associação, não efeito causal.',
      'OLS coefficients with the standard error and distribution shown in the table; they show association, not a causal effect.'),
    texto: () => t('A regressão é estimada pela página, por mínimos quadrados ordinários, com todas as linhas da consulta (linhas com algum valor ausente saem e são contadas). Erro-padrão clássico ou robusto à heterocedasticidade (HC1); p-valores e intervalos de 95% pela t de Student com n − k graus de liberdade. Incluir controles reduz a confusão por variáveis observadas, mas não identifica efeito causal: variáveis omitidas, causalidade reversa e seleção continuam possíveis.',
      'The regression is estimated by the page by ordinary least squares on all rows of the query (rows with missing values are dropped and counted). Classical or heteroskedasticity-robust (HC1) standard errors; p-values and 95% intervals from Student’s t with n − k degrees of freedom. Adding controls does not identify a causal effect.'),
    documento: 'LAPAM/UFG: web/src/ia_estatistica.ts, conferida com o conjunto I de Anscombe',
    url: '',
    trecho: '',
    conferidaEm: '2026-10-30',
  },
];

/** Tabelas da RAIS (estoque, vínculos em 31/12 ou do ano) e do Novo CAGED (fluxos). */
const TABELAS_RAIS = /\b(trab_municipios|trab_setores|trab_setores_uf|trab_grandes_setores|rais_uf|rais_mun|rais_vinculos)\b/;
const TABELAS_CAGED = /\btrab_caged(_anual|_uf)?\b/;
export const leRais = (sql: string) => TABELAS_RAIS.test(sqlSemTextos(sql));
export const leCaged = (sql: string) => TABELAS_CAGED.test(sqlSemTextos(sql));

/** Quebras da RAIS que um período de anos atravessa (começa antes do ano da mudança e termina nele ou depois). */
export const quebrasNoPeriodo = (p: Periodo | null): NotaMetodologica[] =>
  (p?.tipo === 'ano' ? NOTAS.filter((n) => n.quebra && p.de < n.quebra && p.ate >= n.quebra) : []);

/** O texto fala da mudança de captação? (eSocial, quebra de série, cobertura, comparação direta…) */
export const citaQuebra = (s: string) =>
  /e-?social|quebra|capta[çc][ãa]o|cobertura|compara[çc][ãa]o direta|comparabilidade|diretamente compar|series break|coverage|not directly compar/i.test(s);

/** Notas gerais das fontes lidas: vínculos (RAIS) e fluxos celetistas (CAGED). */
export const notasDasFontes = (sqls: string[], o: { regressao?: boolean } = {}): NotaMetodologica[] => {
  const limpas = sqls.map(sqlSemTextos);
  const nota = (id: string) => NOTAS_METODO.filter((n) => n.id === id);
  return [
    ...(sqls.some(leRais) ? NOTAS.filter((n) => n.id === 'rais-vinculos') : []),
    ...(sqls.some(leCaged) ? NOTAS.filter((n) => n.id === 'caged-fluxos') : []),
    ...(limpas.some((s) => /\b(indicadores|lrf)\b/.test(s) && /\bpopulacao\b/.test(s)) ? nota('populacao-declarada') : []),
    ...(limpas.some((s) => /\bpopulacao_ibge\b|\bpib_per_capita\b/.test(s) || (/\btrab_municipios\b/.test(s) && /\bpopulacao\b/.test(s))) ? nota('populacao-ibge') : []),
    ...(limpas.some((s) => /\bempregos_adm_publica\b|\btrab_grandes_setores\b/.test(s)) ? nota('adm-publica-cnae84') : []),
    ...(o.regressao ? nota('regressao') : []),
  ];
};

const data = (iso: unknown) => {
  const d = typeof iso === 'string' ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(local()) : null;
};
/** Data da conferência de uma nota ("2026-10-27"), sem passar pelo fuso: em Brasília, meia-noite UTC ainda é o dia anterior. */
export const dataDaNota = (n: NotaMetodologica) => new Date(`${n.conferidaEm}T12:00:00Z`).toLocaleDateString(local(), { timeZone: 'UTC' });
const mesAno = (aaaamm: unknown) => (ehCompetencia(aaaamm) ? rotuloCompetencia(aaaamm) : '');

/**
 * Versão das bases que as consultas leram, do manifesto dos dados (fontes.rais, fontes.caged): anos ou
 * meses cobertos e data do processamento, para a ficha da resposta e as notas.
 */
export function versaoDasBases(sqls: string[], fontes: Record<string, Record<string, unknown>> | undefined): string[] {
  const r: string[] = [];
  const rais = fontes?.rais;
  if (rais && sqls.some(leRais)) {
    const anos = Array.isArray(rais.anos) ? (rais.anos as number[]) : [];
    const quando = data(rais.processado_em);
    r.push(t(`RAIS ${anos[0] ?? ''}–${anos.at(-1) ?? ''} (microdados do MTE/PDET)${quando ? `, processada em ${quando}` : ''}`,
      `RAIS ${anos[0] ?? ''}–${anos.at(-1) ?? ''} (MTE/PDET microdata)${quando ? `, processed on ${quando}` : ''}`));
  }
  const limpas = sqls.map(sqlSemTextos);
  const siconfi = fontes?.siconfi;
  if (siconfi && limpas.some((s) => /\b(indicadores|despesa_funcao|lrf)\b/.test(s))) {
    const anos = Array.isArray(siconfi.anos) ? (siconfi.anos as number[]) : [];
    const quando = data(siconfi.processado_em);
    r.push(t(`DCA/SICONFI ${anos[0] ?? ''}–${anos.at(-1) ?? ''}${quando ? `, processada em ${quando}` : ''}`,
      `DCA/SICONFI ${anos[0] ?? ''}–${anos.at(-1) ?? ''}${quando ? `, processed on ${quando}` : ''}`));
  }
  const pop = fontes?.ibge_populacao;
  if (pop && limpas.some((s) => /\bpopulacao_ibge\b|\bpib_per_capita\b/.test(s) || (/\btrab_municipios\b/.test(s) && /\bpopulacao\b/.test(s)))) {
    const quando = data(pop.processado_em);
    r.push(t(`População do IBGE (SIDRA 202, 4709 e 6579)${quando ? `, baixada em ${quando}` : ''}`,
      `IBGE population (SIDRA 202, 4709 and 6579)${quando ? `, downloaded on ${quando}` : ''}`));
  }
  const pib = fontes?.ibge_pib;
  if (pib && limpas.some((s) => /\b(pib|pib_per_capita|vab_\w+)\b/.test(s))) {
    const anos = Array.isArray(pib.anos) ? (pib.anos as number[]) : [];
    r.push(t(`PIB dos municípios (IBGE, SIDRA 5938) ${anos[0] ?? ''}–${anos.at(-1) ?? ''}`, `Municipal GDP (IBGE, SIDRA 5938) ${anos[0] ?? ''}–${anos.at(-1) ?? ''}`));
  }
  const caged = fontes?.caged;
  if (caged && sqls.some(leCaged)) {
    const quando = data(caged.processado_em);
    r.push(t(`Novo CAGED ${mesAno(caged.de)}–${mesAno(caged.ate)} (microdados do MTE/PDET)${quando ? `, processado em ${quando}` : ''}`,
      `New CAGED ${mesAno(caged.de)}–${mesAno(caged.ate)} (MTE/PDET microdata)${quando ? `, processed on ${quando}` : ''}`));
  }
  return r;
}
