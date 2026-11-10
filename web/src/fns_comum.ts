/**
 * FNS (repasses federais fundo a fundo): regras e textos compartilhados pela página Saúde → Financiamento federal e pela IA.
 * Os dados são gerados por pipeline/fns.py (gold/saude/fns_municipios, fns_composicao e fns_anos).
 */
import type { Linha } from './api';
import { t } from './idioma';

export const FNS_CATALOGO = 'https://portalfns.saude.gov.br/downloads/';
export const FNS_NOTA_828 = 'https://portalfns.saude.gov.br/wp-content/uploads/2020/06/Nota-Informativa-sobre-a-Portaria-GMMS-n%C2%BA-828-2020.pdf';
export const DF_CNPJ_FNS = ['00394700000108', '00394700000299', '12116247000157'];

export const fonteFns = () => t(
  'Ministério da Saúde/Fundo Nacional de Saúde (FNS): repasses fundo a fundo, arquivos anuais "Repasse FAF com população" (portalfns.saude.gov.br/downloads). Processamento: LAPAM/UFG',
  'Ministry of Health/National Health Fund (FNS): fund-to-fund transfers, annual "Repasse FAF com população" files (portalfns.saude.gov.br/downloads). Processing: LAPAM/UFG',
);

export const universoFns = () => t(
  'repasses fundo a fundo classificados pelo FNS (TP_REPASSE) para destinatários municipais, incluindo o distrito estadual de Fernando de Noronha; mais, no Distrito Federal, a Secretaria de Saúde (CNPJs 00.394.700/0001-08 e 00.394.700/0002-99) e o Fundo de Saúde (CNPJ 12.116.247/0001-57), que o FNS classifica como estaduais; os fundos estaduais não entram',
  'fund-to-fund transfers classified by the FNS (TP_REPASSE) for municipal recipients, including the state district of Fernando de Noronha; plus, in the Federal District, the Health Department (CNPJs 00.394.700/0001-08 and 00.394.700/0002-99) and the Health Fund (CNPJ 12.116.247/0001-57), which the FNS classifies as state-level; state funds are excluded',
);

export const regraPerCapita = () => t(
  'repasse líquido ÷ população residente estimada pela SVS/MS no ano (a população que vem nos arquivos do FNS, de 2021, não é usada); em UF e Brasil, soma dos repasses e das populações dos municípios com repasse e população no ano, nunca média de razões',
  'net transfer ÷ resident population estimated by SVS/MS for the year (the population in the FNS files, from 2021, is not used); for states and Brazil, sum of transfers and populations of the municipalities with a transfer and population in the year, never an average of ratios',
);

export const regraPrecos = (base: number) => t(
  `valor real em R$ de dezembro de ${base} pelo IPCA (dez/dez) do painel, que só começa em 2006: de 2002 a 2005 só há valor nominal`,
  `real value in December ${base} R$ by the panel's IPCA (Dec/Dec), which only starts in 2006: from 2002 to 2005 only nominal values exist`,
);

export const avisoNaoSomar = () => t(
  'O repasse do FNS é a perspectiva da União que transfere; a receita de transferências do SICONFI e a despesa em saúde do SIOPS são perspectivas do ente que recebe e que gasta, do mesmo fluxo. Não se somam nem se tratam como independentes.',
  'The FNS transfer is the perspective of the Union that sends the money; SICONFI transfer revenue and SIOPS health spending are the perspectives of the government that receives and spends it, of the same flow. They are neither added nor treated as independent.',
);

export const avisoComposicao = () => t(
  'Os nomes de bloco, grupo e estratégia são os da fonte em cada ano e foram atualizados retrospectivamente pelo FNS (Portaria GM/MS nº 828/2020): não há equivalência garantida entre anos, por isso a composição é mostrada para um ano de cada vez.',
  'Block, group and strategy names are those of the source in each year and were retrospectively updated by the FNS (Ordinance GM/MS 828/2020): there is no guaranteed equivalence across years, so the composition is shown one year at a time.',
);

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Razão simples; sem denominador positivo não há valor (nunca zero nem infinito). */
export const razaoPositiva = (a: number | null, b: number | null): number | null => (a === null || b === null || !(b > 0) ? null : a / b);

/**
 * Repasse líquido por habitante de uma linha da série (fns_serie): líquido dos municípios que têm população no ano ÷ população desses
 * mesmos municípios (denominador apenas dos que receberam, para não diluir a taxa com quem não aparece nos arquivos).
 */
export function perCapita(r: Linha | undefined, real: boolean): number | null {
  if (!r) return null;
  return razaoPositiva(num(real ? r.liquido_real_com_pop : r.liquido_com_pop), num(r.pop_com_repasse));
}

/** Parcela da população do recorte que mora em municípios com repasse no ano (cobertura do denominador). */
export const coberturaPopulacional = (r: Linha | undefined): number | null => razaoPositiva(num(r?.pop_com_repasse), num(r?.pop_total));

/** Há repasse registrado no ano para o recorte? (ausência não vira zero) */
export const temRepasse = (r: Linha | undefined): boolean => num(r?.municipios_com_repasse) !== null && (num(r?.municipios_com_repasse) ?? 0) > 0 && num(r?.liquido) !== null;

/** Resumo exportável usa a mesma ausência do cartão, inclusive quando a consulta não devolve linha no ano. */
export function resumoFns(r: Linha | undefined, ano: number | null, base: number): (string | number | null)[][] {
  const sem = !temRepasse(r);
  const comum = ano === null ? t('fora da cobertura', 'outside coverage') : sem ? t('sem registro', 'no record') : null;
  const real = ano !== null && ano < 2006 ? t('indisponível antes de 2006', 'unavailable before 2006') : null;
  const valor = (v: number | null, motivo: string | null, calculado = false): [number | null, string] => [motivo ? null : v, motivo ?? t(calculado ? 'calculado' : 'registrado', calculado ? 'computed' : 'recorded')];
  const pc = perCapita(r, false), pcReal = perCapita(r, true), cobertura = coberturaPopulacional(r);
  const semPop = (v: number | null) => v === null ? t('sem população', 'no population') : null;
  return [
    ['liquido_nominal', ano, ...valor(num(r?.liquido), comum)],
    ['bruto_nominal', ano, ...valor(num(r?.bruto), comum)],
    [`liquido_real_${base}`, ano, ...valor(num(r?.liquido_real), comum ?? real)],
    ['liquido_por_habitante_nominal', ano, ...valor(pc, comum ?? semPop(pc), true)],
    [`liquido_por_habitante_real_${base}`, ano, ...valor(pcReal, comum ?? real ?? semPop(pcReal), true)],
    ['cobertura_populacional', ano, ...valor(cobertura, comum ?? semPop(cobertura), true)],
  ];
}

export type LinhaComposicao = { bloco: string; grupo: string; estrategia: string; bruto: number | null; liquido: number | null };

/** Total por bloco (rótulos da fonte no ano), do maior para o menor líquido. */
export function porBloco(linhas: Linha[]): { bloco: string; bruto: number; liquido: number }[] {
  const m = new Map<string, { bloco: string; bruto: number; liquido: number }>();
  for (const l of linhas) {
    const b = String(l.bloco ?? '');
    const x = m.get(b) ?? { bloco: b, bruto: 0, liquido: 0 };
    x.bruto += num(l.bruto) ?? 0;
    x.liquido += num(l.liquido) ?? 0;
    m.set(b, x);
  }
  return [...m.values()].sort((a, b) => b.liquido - a.liquido);
}

export const rotuloComposicao = (l: Pick<LinhaComposicao, 'bloco' | 'grupo' | 'estrategia'>) => [l.bloco, l.grupo, l.estrategia].filter(Boolean).join(' › ');

/** Ordena municípios por líquido total ou per capita (município sem população fica de fora do per capita), maiores ou menores primeiro. */
export function ordenarMunicipios(linhas: Linha[], medida: 'percapita' | 'liquido', maiores: boolean): (Linha & { valor: number })[] {
  const com = linhas
    .map((l) => ({ ...l, valor: medida === 'liquido' ? num(l.liquido) : razaoPositiva(num(l.liquido), num(l.populacao)) }))
    .filter((l): l is Linha & { valor: number } => l.valor !== null);
  return com.sort((a, b) => (maiores ? b.valor - a.valor : a.valor - b.valor) || String(a.nome).localeCompare(String(b.nome)));
}
