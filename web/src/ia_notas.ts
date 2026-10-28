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
  fonte: 'rais' | 'caged';
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
export const notasDasFontes = (sqls: string[]): NotaMetodologica[] => [
  ...(sqls.some(leRais) ? NOTAS.filter((n) => n.id === 'rais-vinculos') : []),
  ...(sqls.some(leCaged) ? NOTAS.filter((n) => n.id === 'caged-fluxos') : []),
];

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
  const caged = fontes?.caged;
  if (caged && sqls.some(leCaged)) {
    const quando = data(caged.processado_em);
    r.push(t(`Novo CAGED ${mesAno(caged.de)}–${mesAno(caged.ate)} (microdados do MTE/PDET)${quando ? `, processado em ${quando}` : ''}`,
      `New CAGED ${mesAno(caged.de)}–${mesAno(caged.ate)} (MTE/PDET microdata)${quando ? `, processed on ${quando}` : ''}`));
  }
  return r;
}
