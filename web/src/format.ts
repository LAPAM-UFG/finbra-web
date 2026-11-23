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
const compacto = () => nf({ notation: 'compact', maximumSignificantDigits: 3 });
const inteiro = () => nf({ maximumFractionDigits: 0 });
const decimal = () => nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const SEM_VALOR = '—';
const vazio = (v: number | null | undefined): v is null | undefined => v === null || v === undefined || !Number.isFinite(v);
export const sinalTipografico = (s: string) => s.replace(/-/g, '−');
export const decimalLocal = (v: number, opcoes: Intl.NumberFormatOptions = {}) => sinalTipografico(nf(opcoes).format(Object.is(v,-0)?0:v));
export function ordinal(v: number|null|undefined): string {
  if(vazio(v))return SEM_VALOR;
  if(local()==='pt-BR')return `${numero(v)}º`;
  const n=Math.abs(Math.trunc(v)),fim=n%100;
  const sufixo=fim>=11&&fim<=13?'th':({1:'st',2:'nd',3:'rd'} as Record<number,string>)[n%10]??'th';
  return `${numero(v)}${sufixo}`;
}

/** R$ 12,10 bi / R$ 340,00 mi / R$ 12,00 mil (em inglês: R$ 12.10 bn / mn / k) */
export function reais(v: number | null | undefined): string {
  if (vazio(v)) return SEM_VALOR;
  const abs = Math.abs(v);
  if (abs >= 1e9) return `R$ ${sinalTipografico(decimal().format(v / 1e9))} ${t('bi', 'bn')}`;
  if (abs >= 1e6) return `R$ ${sinalTipografico(decimal().format(v / 1e6))} ${t('mi', 'mn')}`;
  if (abs >= 1e4) return `R$ ${sinalTipografico(decimal().format(v / 1e3))} ${t('mil', 'k')}`;
  return `R$ ${sinalTipografico(decimal().format(v))}`;
}
export const reaisCurto = (v: number) => sinalTipografico(Math.abs(v) >= 1e3 ? `R$ ${compacto().format(v)}` : `R$ ${inteiro().format(v)}`);
export const reaisExato = (v: number | null | undefined) => (vazio(v) ? SEM_VALOR : `R$ ${sinalTipografico(decimal().format(v))}`);
export const numero = (v: number | null | undefined) => (vazio(v) ? SEM_VALOR : sinalTipografico(inteiro().format(v)));
/** Número com uma casa decimal (razões como P90/P10, horas, idade). */
export const numero1 = (v: number | null | undefined) => (vazio(v) ? SEM_VALOR : decimalLocal(v,{ minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export const pct = (v: number | null | undefined, casas = 1) => (vazio(v) ? SEM_VALOR : sinalTipografico(formatarPct(Object.is(v,-0)?0:v, casas, local())));
/** Apresentação; arquivos de dados preservam a precisão numérica da fonte. */
export function porUnidade(v: number|null|undefined, unidade: string, opcoes: { compacto?: boolean; casas?: number; variacao?: boolean } = {}): string {
  if(vazio(v))return SEM_VALOR;
  const un=unidade.toLocaleLowerCase();let s:string;
  const dinheiro=()=>opcoes.compacto!==false&&Math.abs(v)>=1e6?reais(v):reaisExato(v);
  if(un.includes('us$'))s=dinheiro().replace('R$','US$');
  else if(un.includes('r$'))s=dinheiro();
  else if(un.includes('%')||un.includes('percent'))s=`${decimalLocal(v,{minimumFractionDigits:Math.min(1,opcoes.casas??2),maximumFractionDigits:opcoes.casas??2})}%`;
  else if(/quadr[aá]tic/.test(un)&&Math.abs(v)>=1e6)s=decimalLocal(v,{notation:'scientific',maximumSignificantDigits:3});
  else {const taxa=/por (?:mil|1[.,]000|10 mil|100 mil)|per (?:1,000|100,000)|°c|\banos\b|\byears\b/.test(un);const casas=opcoes.casas??(taxa?1:2);s=decimalLocal(v,opcoes.compacto===true&&!taxa&&Math.abs(v)>=1e6?{notation:'compact',maximumSignificantDigits:3}:{minimumFractionDigits:taxa?casas:0,maximumFractionDigits:casas});}
  return opcoes.variacao&&v>0?'+'+s:s;
}
export const div = (a: number | null | undefined, b: number | null | undefined) =>
  vazio(a) || vazio(b) || b === 0 ? null : a / b;
