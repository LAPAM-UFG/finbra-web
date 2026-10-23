import { useSyncExternalStore } from 'react';

export type Idioma = 'pt' | 'en';

function lerIdioma(): Idioma {
  try {
    return localStorage.getItem('idioma') === 'en' ? 'en' : 'pt';
  } catch {
    return 'pt';
  }
}

let atual: Idioma = lerIdioma();
let contas: Record<string, string> = {};
const ouvintes = new Set<() => void>();

/** Texto no idioma atual: t('Receita bruta', 'Gross revenue'). */
export const t = (pt: string, en: string) => (atual === 'en' ? en : pt);
export const idioma = () => atual;
/** Locale para Intl e toLocaleString. */
export const local = () => (atual === 'en' ? 'en-US' : 'pt-BR');

/** Termos que vêm dos dados fora do plano de contas: colunas dos anexos, alertas e testes. */
const TERMOS: Record<string, string> = {
  'Receitas Brutas Realizadas': 'Gross Revenue Collected',
  'Deduções - FUNDEB': 'Deductions - FUNDEB',
  'Deduções - Transferências Constitucionais': 'Deductions - Constitutional Transfers',
  'Deduções da Receita': 'Revenue Deductions',
  'Outras Deduções da Receita': 'Other Revenue Deductions',
  'Despesas Empenhadas': 'Committed Expenditure',
  'Despesas Liquidadas': 'Accrued Expenditure',
  'Despesas Pagas': 'Paid Expenditure',
  'Inscrição de Restos a Pagar Processados': 'Processed Carry-over Payables Recorded',
  'Inscrição de Restos a Pagar Não Processados': 'Unprocessed Carry-over Payables Recorded',
  'Restos a Pagar Processados Inscritos em Exercícios Anteriores': 'Processed Carry-over Payables Recorded in Prior Years',
  'Restos a Pagar Processados Inscritos em 31 de Dezembro do Exercício Anterior': 'Processed Carry-over Payables Recorded on December 31 of the Prior Year',
  'Restos a Pagar Processados Pagos': 'Processed Carry-over Payables Paid',
  'Restos a Pagar Processados Cancelados': 'Processed Carry-over Payables Cancelled',
  'Restos a Pagar Não Processados Inscritos em Exercícios Anteriores': 'Unprocessed Carry-over Payables Recorded in Prior Years',
  'Restos a Pagar Não Processados Inscritos em 31 de Dezembro do Exercício Anterior': 'Unprocessed Carry-over Payables Recorded on December 31 of the Prior Year',
  'Restos a Pagar Não Processados Liquidados': 'Unprocessed Carry-over Payables Accrued',
  'Restos a Pagar Não Processados Pagos': 'Unprocessed Carry-over Payables Paid',
  'Restos a Pagar Não Processados Cancelados': 'Unprocessed Carry-over Payables Cancelled',
  'Saldo em 31/12': 'Balance on 12/31',
  'muito acima do habitual': 'far above the usual level',
  'muito abaixo do habitual': 'far below the usual level',
  'não declarado': 'not declared',
  'ativo = passivo + PL': 'assets = liabilities + equity',
  'arvore x total': 'tree × total',
};

/**
 * Texto que vem dos dados (conta, coluna, alerta), no idioma atual.
 * O Tesouro publica tudo em português; sem tradução, mostra o original.
 */
export function dado(texto: string) {
  if (atual !== 'en') return texto;
  return TERMOS[texto] ?? contas[texto] ?? texto;
}

/** Faixa populacional ("0 a 4.999", "3.000.000 ou mais") no idioma atual. */
export function faixa(texto: string) {
  if (atual !== 'en') return texto;
  return texto.replace(/\./g, ',').replace(' a ', ' to ').replace(' ou mais', ' or more').replace(/^Grupo /, 'Group ');
}

/** Troca o idioma; o inglês carrega antes o dicionário do plano de contas (só quando pedido). */
export async function definirIdioma(novo: Idioma) {
  if (novo === 'en' && !Object.keys(contas).length) contas = (await import('./traducoes/contas.en.json')).default;
  atual = novo;
  document.documentElement.lang = novo === 'en' ? 'en' : 'pt-BR';
  document.title = t('LAPAM · Finanças Municipais', 'LAPAM · Municipal Finances');
  try {
    localStorage.setItem('idioma', novo);
  } catch {
    /* armazenamento indisponível: o idioma vale só nesta visita */
  }
  ouvintes.forEach((f) => f());
}

export function useIdioma() {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => atual,
  );
}
