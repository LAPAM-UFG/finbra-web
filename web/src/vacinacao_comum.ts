/**
 * Cobertura vacinal oficial por residência (PNI / InfoMS): regras da página e da IA, sem React.
 *
 * Fatos que valem para tudo aqui (pipeline/vacinacao.py):
 *  - cobertura é RAZÃO de 0 a 1 (0,72 = 72%); mostra-se em % multiplicando uma única vez; passa de 100% quando é o que a fonte traz;
 *  - denominador oficial: nascidos vivos do SINASC (coortes incluídas), nunca a população da SVS/IBGE;
 *  - até 2022 o método é por tipo de dose; de 2023 em diante, por indivíduo (NT 84/2026-DPNI/SVSA/MS): as séries NÃO se emendam;
 *  - o catálogo de imunobiológicos varia por ano: ausência não é zero e nomes parecidos não se juntam;
 *  - UF e Brasil são os totalizadores oficiais, nunca a média dos municípios; vacinas diferentes nunca se somam;
 *  - meta só onde a regra oficial foi confirmada para o rótulo (campo meta do catálogo); nunca 95% como regra geral.
 */
import type { Linha } from './api';
import { local, t } from './idioma';

export type Metodo = 'tipo_de_dose' | 'individuo';
export const METODOS: Metodo[] = ['tipo_de_dose', 'individuo'];
/** Último ano do método por tipo de dose (1994–2022); de 2023 em diante é por indivíduo. */
export const ULTIMO_ANO_TIPO_DE_DOSE = 2022;
export const metodoDoAno = (ano: number): Metodo => (ano <= ULTIMO_ANO_TIPO_DE_DOSE ? 'tipo_de_dose' : 'individuo');

export const URL_FONTE_VACINACAO = 'https://infoms.saude.gov.br/extensions/SEIDIGI_DEMAS_VACINACAO_CALENDARIO_NACIONAL_COBERTURA_RESIDENCIA/index.html';
export const URL_NT84 = 'https://www.gov.br/saude/pt-br/centrais-de-conteudo/publicacoes/notas-tecnicas/2026/nota-tecnica-no-84-2026-dpni-svsa-ms.pdf';
export const URL_NT87 = 'https://www.gov.br/saude/pt-br/composicao/svsa/pni/notas-tecnicas/2026/nota-tecnica-no-87-2026-cgici-dpni-svsa-ms';
export const URL_NT91 = 'https://www.gov.br/saude/pt-br/composicao/svsa/pni/notas-tecnicas/2026/nota-tecnica-no-91-2026-cgici-dpni-svsa-ms';

export const nomeMetodo = (m: Metodo | string) => (m === 'individuo' ? t('por indivíduo (2023 em diante)', 'per individual (2023 onwards)') : t('por tipo de dose (até 2022)', 'by dose type (up to 2022)'));
export const nomeMetodoCurto = (m: Metodo | string) => (m === 'individuo' ? t('por indivíduo', 'per individual') : t('por tipo de dose', 'by dose type'));
/** O que o numerador conta em cada método. */
export const unidadeNumerador = (m: Metodo | string) => (m === 'individuo' ? t('pessoas vacinadas', 'people vaccinated') : t('doses aplicadas', 'doses administered'));
export const DENOMINADOR = () => t('nascidos vivos (SINASC)', 'live births (SINASC)');

export type LinhaVac = {
  ano: number; imunobiologico: string; rotulo: string; metodo: Metodo; numerador: number | null; denominador: number | null;
  cobertura: number | null; cobertura_fonte: number | null; status: string; meta: number | null;
};
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const paraLinhaVac = (r: Linha): LinhaVac => ({
  ano: Number(r.ano), imunobiologico: String(r.imunobiologico), rotulo: String(r.rotulo ?? r.imunobiologico), metodo: r.metodo === 'individuo' ? 'individuo' : 'tipo_de_dose',
  numerador: n(r.numerador), denominador: n(r.denominador), cobertura: n(r.cobertura), cobertura_fonte: n(r.cobertura_fonte), status: String(r.status ?? ''), meta: n(r.meta),
});

export type CatalogoVac = { ano: number; imunobiologico: string; rotulo: string; metodo: Metodo; ordem: number; municipios: number; municipios_calculaveis: number; meta: number | null; meta_fonte: string | null };
export const paraCatalogo = (r: Linha): CatalogoVac => ({
  ano: Number(r.ano), imunobiologico: String(r.imunobiologico), rotulo: String(r.rotulo), metodo: r.metodo === 'individuo' ? 'individuo' : 'tipo_de_dose', ordem: Number(r.ordem),
  municipios: Number(r.municipios ?? 0), municipios_calculaveis: Number(r.municipios_calculaveis ?? 0), meta: n(r.meta), meta_fonte: typeof r.meta_fonte === 'string' ? r.meta_fonte : null,
});

/** Percentual (0–100) com uma casa; nulo vira "–". Aceita a razão da fonte (0–1) e multiplica uma única vez. */
export const pctRazao = (razao: number | null, casas = 1) =>
  razao === null ? '–' : `${(100 * razao).toLocaleString(local(), { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export type Situacao = 'calculada' | 'acima_100' | 'denominador_zero' | 'sem_valor' | 'sem_registro' | 'fora_do_catalogo';

/** Situação de uma linha (ou da falta dela) para os cartões e as tabelas. sem_registro: o ano tem o imunobiológico, mas não há linha deste território. */
export function situacao(r: LinhaVac | undefined, noCatalogo: boolean): Situacao {
  if (!noCatalogo) return 'fora_do_catalogo';
  if (!r) return 'sem_registro';
  if (r.status === 'denominador_zero') return 'denominador_zero';
  if (r.cobertura === null) return 'sem_valor';
  return r.cobertura > 1 ? 'acima_100' : 'calculada';
}

export const textoSituacao = (s: Situacao) => ({
  calculada: t('calculada', 'calculated'),
  acima_100: t('acima de 100%: valor observado, não limitado', 'above 100%: observed value, not capped'),
  denominador_zero: t('não calculável: denominador zero', 'not computable: zero denominator'),
  sem_valor: t('sem valor', 'no value'),
  sem_registro: t('sem registro', 'no record'),
  fora_do_catalogo: t('imunobiológico fora do catálogo deste ano', 'immunobiological not in this year’s catalogue'),
})[s];

/** Valor mostrado na tela de uma linha: percentual quando calculável; senão o motivo (nunca zero no lugar de ausência). */
export function textoCobertura(r: LinhaVac | undefined, noCatalogo: boolean, casas = 1): string {
  const s = situacao(r, noCatalogo);
  if (s === 'calculada' || s === 'acima_100') return pctRazao(r!.cobertura, casas);
  return textoSituacao(s);
}

/** Compara com a meta só quando há meta confirmada e cobertura calculada. */
export function contraMeta(r: LinhaVac | undefined): 'atingida' | 'abaixo' | null {
  if (!r || r.meta === null || r.cobertura === null) return null;
  return r.cobertura >= r.meta ? 'atingida' : 'abaixo';
}

/** Municípios pequenos oscilam: denominador abaixo disto recebe a ressalva. */
export const DENOMINADOR_PEQUENO = 30;

/** Separa as linhas por método (as séries nunca se unem): ordenadas por ano. */
export function separarPorMetodo(linhas: LinhaVac[]): Record<Metodo, LinhaVac[]> {
  const saida: Record<Metodo, LinhaVac[]> = { tipo_de_dose: [], individuo: [] };
  for (const r of [...linhas].sort((a, b) => a.ano - b.ano)) saida[r.metodo].push(r);
  return saida;
}

/** Anos do catálogo por método (a janela de cada série, mesmo onde o imunobiológico não existe). */
export function anosPorMetodo(catalogo: CatalogoVac[]): Record<Metodo, number[]> {
  const saida: Record<Metodo, number[]> = { tipo_de_dose: [], individuo: [] };
  for (const a of [...new Set(catalogo.map((c) => c.ano))].sort((x, y) => x - y)) saida[metodoDoAno(a)].push(a);
  return saida;
}

/** Imunobiológicos de um ano, na ordem do catálogo. */
export const doAno = (catalogo: CatalogoVac[], ano: number) => catalogo.filter((c) => c.ano === ano).sort((a, b) => a.ordem - b.ordem);

/** Anos (do catálogo) em que o identificador existe, por método: a série de cada método só usa os anos dela. */
export function anosDoImunobiologico(catalogo: CatalogoVac[], id: string): Record<Metodo, number[]> {
  const saida: Record<Metodo, number[]> = { tipo_de_dose: [], individuo: [] };
  for (const c of catalogo) if (c.imunobiologico === id) saida[c.metodo].push(c.ano);
  for (const m of METODOS) saida[m].sort((a, b) => a - b);
  return saida;
}

/** Meta do rótulo no ano (do catálogo): a regra confirmada, ou null. */
export const metaDoAno = (catalogo: CatalogoVac[], ano: number, id: string): number | null =>
  catalogo.find((c) => c.ano === ano && c.imunobiologico === id)?.meta ?? null;

/**
 * Totais para a nota de reconciliação: soma de numeradores e denominadores de LINHAS DO MESMO imunobiológico. Somar vacinas diferentes
 * não é cobertura geral, então recusa misturar.
 */
export function razaoDasSomas(linhas: LinhaVac[]): { numerador: number; denominador: number; cobertura: number | null } {
  if (new Set(linhas.map((r) => r.imunobiologico)).size > 1) throw new Error('vacinas diferentes não se somam');
  if (new Set(linhas.map((r) => r.ano)).size > 1) throw new Error('anos diferentes não se somam');
  const numerador = linhas.reduce((s, r) => s + (r.numerador ?? 0), 0);
  const denominador = linhas.reduce((s, r) => s + (r.denominador ?? 0), 0);
  return { numerador, denominador, cobertura: denominador > 0 ? numerador / denominador : null };
}
