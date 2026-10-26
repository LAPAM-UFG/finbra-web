/**
 * Regras de cálculo sem dependências (testadas em web/testes/).
 */

export type NoAV = { chave: string; chave_pai: string | null; tipo: string; valor: number | null; valor_comp?: number | null };
export type Base = { valor: number | null; valor_comp: number | null; rotulo: string };

/** Anexos em que cada grupo de primeiro nível é a própria base (lados do balanço; VPA e VPD). */
const BASE_POR_GRUPO = new Set(['I-AB', 'I-HI']);

/**
 * Base da análise vertical de cada conta.
 *   I-AB  Ativo = 100% para as contas do Ativo; Passivo e PL = 100% para esse lado (e cada grupo
 *         de compensação, nos formatos antigos, é a própria base). Os lados nunca são somados.
 *   I-HI  Variações aumentativas e diminutivas: cada grupo é a própria base.
 *   I-D/F Soma das raízes sem as linhas "Intra" (DI): o detalhamento intraorçamentário já está
 *         contido nas despesas correntes e de capital. As linhas DI usam a mesma base.
 *   I-C, I-E, I-G  Soma das raízes da coluna (I-C inclui as receitas intraorçamentárias; I-E e I-G
 *         somam as funções, que excluem as intraorçamentárias).
 */
export function basesAV(anexo: string, nos: NoAV[], nomeRaiz: (chave: string) => string): (no: NoAV) => Base {
  const contas = nos.filter((n) => n.tipo === 'conta');
  const presentes = new Map(contas.map((n) => [n.chave, n]));
  const pai = (n: NoAV) => (n.chave_pai && presentes.has(n.chave_pai) ? presentes.get(n.chave_pai)! : null);
  const raizDe = (n: NoAV) => {
    let r = n;
    for (let p = pai(r); p; p = pai(r)) r = p;
    return r;
  };
  if (BASE_POR_GRUPO.has(anexo)) {
    return (n) => {
      const r = raizDe(n);
      return { valor: r.valor, valor_comp: r.valor_comp ?? null, rotulo: nomeRaiz(r.chave) };
    };
  }
  const raizes = contas.filter((n) => !pai(n) && !(anexo !== 'I-C' && n.chave.startsWith('DI')));
  const soma = (k: 'valor' | 'valor_comp') => {
    const vs = raizes.map((n) => n[k]).filter((v): v is number => typeof v === 'number');
    return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
  };
  const b: Base = { valor: soma('valor'), valor_comp: soma('valor_comp'), rotulo: '' };
  return () => b;
}

/** Código da conta para exibição: 'RO1.7.1.1.51' → '1.7.1.1.51'; 'F04.122' → '04.122'; 'P2.3' → '2.3'. */
export function codigoConta(chave: string): string {
  const base = chave.split('#')[0];
  const m = base.match(/^[A-Z]*(\d[\d.]*)$/);
  return m ? m[1] : '';
}

/** Ancestrais de uma conta (do topo até o pai), para mostrar o caminho e para a busca manter a hierarquia. */
export function caminho(chave: string, paiDe: Map<string, string | null>): string[] {
  const saida: string[] = [];
  for (let p = paiDe.get(chave) ?? null; p; p = paiDe.get(p) ?? null) saida.unshift(p);
  return saida;
}

/** Percentual com casas fixas; arredondamentos para zero não exibem sinal ("0,0%" e não "−0,0%"). */
export function formatarPct(v: number, casas: number, local: string): string {
  const fmt = new Intl.NumberFormat(local, { minimumFractionDigits: casas, maximumFractionDigits: casas });
  const texto = fmt.format(v * 100);
  // "-0,0" (ou com o sinal de menos tipográfico) vira "0,0"
  return `${/^[-−]0([.,]0+)?$/.test(texto) ? texto.slice(1) : texto}%`;
}
