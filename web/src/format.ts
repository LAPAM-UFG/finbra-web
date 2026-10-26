import { formatarPct } from './calculos';
import { local, t } from './idioma';

const formatos = new Map<string, Intl.NumberFormat>();
/** Intl.NumberFormat no locale atual (pt-BR ou en-US), criado uma vez por combinação. */
function nf(opcoes: Intl.NumberFormatOptions) {
  const chave = local() + JSON.stringify(opcoes);
  let f = formatos.get(chave);
  if (!f) formatos.set(chave, (f = new Intl.NumberFormat(local(), opcoes)));
  return f;
}
const compacto = () => nf({ notation: 'compact', maximumFractionDigits: 1 });
const inteiro = () => nf({ maximumFractionDigits: 0 });
const decimal = () => nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

const vazio = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || Number.isNaN(v);

/** R$ 12,10 bi / R$ 340,00 mi / R$ 12,00 mil (em inglês: R$ 12.10 bn / mn / k) */
export function reais(v: number | null | undefined): string {
  if (vazio(v)) return '–';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${decimal().format(v / 1e9)} ${t('bi', 'bn')}`;
  if (abs >= 1e6) return `R$ ${decimal().format(v / 1e6)} ${t('mi', 'mn')}`;
  if (abs >= 1e4) return `R$ ${decimal().format(v / 1e3)} ${t('mil', 'k')}`;
  return `R$ ${decimal().format(v)}`;
}
export const reaisCurto = (v: number) => (Math.abs(v) >= 1e3 ? `R$ ${compacto().format(v)}` : `R$ ${inteiro().format(v)}`);
export const reaisExato = (v: number | null | undefined) => (vazio(v) ? '–' : `R$ ${decimal().format(v)}`);
export const numero = (v: number | null | undefined) => (vazio(v) ? '–' : inteiro().format(v));
export const pct = (v: number | null | undefined, casas = 1) => (vazio(v) || !Number.isFinite(v) ? '–' : formatarPct(v, casas, local()));
export const div = (a: number | null | undefined, b: number | null | undefined) =>
  vazio(a) || vazio(b) || b === 0 ? null : a / b;
