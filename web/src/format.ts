const compacto = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const inteiro = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const vazio = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || Number.isNaN(v);

/** R$ 12,10 bi / R$ 340,00 mi / R$ 12,00 mil */
export function reais(v: number | null | undefined): string {
  if (vazio(v)) return '–';
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${decimal.format(v / 1e9)} bi`;
  if (abs >= 1e6) return `R$ ${decimal.format(v / 1e6)} mi`;
  if (abs >= 1e4) return `R$ ${decimal.format(v / 1e3)} mil`;
  return `R$ ${decimal.format(v)}`;
}
export const reaisCurto = (v: number) => (Math.abs(v) >= 1e3 ? `R$ ${compacto.format(v)}` : `R$ ${inteiro.format(v)}`);
export const reaisExato = (v: number | null | undefined) => (vazio(v) ? '–' : `R$ ${decimal.format(v)}`);
export const numero = (v: number | null | undefined) => (vazio(v) ? '–' : inteiro.format(v));
export const pct = (v: number | null | undefined, casas = 1) =>
  vazio(v)
    ? '–'
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v * 100)}%`;
export const div = (a: number | null | undefined, b: number | null | undefined) =>
  vazio(a) || vazio(b) || b === 0 ? null : a / b;
