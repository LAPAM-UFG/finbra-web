/**
 * Regressão linear por mínimos quadrados ordinários, calculada pela página (nunca pelo modelo) com as linhas
 * inteiras de uma consulta: coeficientes, erro-padrão clássico ou robusto à heterocedasticidade (HC1, o
 * "robust" do Stata), estatística t, p-valor bilateral e intervalo de 95% pela t de Student com n − k graus
 * de liberdade. Conferida nos testes com o conjunto I de Anscombe (valores publicados).
 */

export type ErroPadrao = 'classico' | 'hc1';
export type Regressao = {
  termos: string[]; coeficientes: number[]; erros: number[]; t: number[]; p: number[]; ic: [number, number][];
  n: number; k: number; gl: number; r2: number; r2Ajustado: number; erroPadrao: ErroPadrao; descartadas: number;
};

/** ln Γ(x) (Lanczos), para a função beta. */
function lnGama(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Fração contínua da beta incompleta (Numerical Recipes, betacf). */
function fracaoBeta(a: number, b: number, x: number): number {
  const MIN = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < MIN) d = MIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a - 1 + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < MIN) d = MIN;
    c = 1 + aa / c; if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + 1 + m2));
    d = 1 + aa * d; if (Math.abs(d) < MIN) d = MIN;
    c = 1 + aa / c; if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

/** Beta incompleta regularizada I_x(a, b). */
export function betaIncompleta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGama(a + b) - lnGama(a) - lnGama(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * fracaoBeta(a, b, x)) / a : 1 - (bt * fracaoBeta(b, a, 1 - x)) / b;
}

/** P(|T| > |t|) com gl graus de liberdade. */
export function pBilateral(t: number, gl: number): number {
  if (!Number.isFinite(t)) return 0;
  return betaIncompleta(gl / (gl + t * t), gl / 2, 0.5);
}

/** Quantil t(1 − α/2, gl) por bisseção sobre o p-valor bilateral. */
export function quantilT(alfa: number, gl: number): number {
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const meio = (lo + hi) / 2;
    if (pBilateral(meio, gl) > alfa) lo = meio; else hi = meio;
  }
  return (lo + hi) / 2;
}

/** Inversa de uma matriz simétrica positiva definida (Gauss-Jordan com pivô); null se singular. */
function inversa(m: number[][]): number[][] | null {
  const k = m.length;
  const a = m.map((l, i) => [...l, ...Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))]);
  const escala = Math.max(...m.map((l, i) => Math.abs(l[i])), 1e-300);
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(a[r][c]) > Math.abs(a[piv][c])) piv = r;
    if (Math.abs(a[piv][c]) <= 1e-10 * escala) return null;
    [a[c], a[piv]] = [a[piv], a[c]];
    const p = a[c][c];
    for (let j = 0; j < 2 * k; j++) a[c][j] /= p;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = a[r][c];
      if (f !== 0) for (let j = 0; j < 2 * k; j++) a[r][j] -= f * a[c][j];
    }
  }
  return a.map((l) => l.slice(k));
}

/**
 * Estima y = b0 + b1·x1 + … por MQO. Linhas com algum valor ausente ou não numérico saem (contadas em
 * descartadas). Erros de uso viram mensagens: poucas observações, regressor sem variação ou colinear.
 */
export function mqo(y: (number | null)[], xs: { nome: string; valores: (number | null)[] }[], erroPadrao: ErroPadrao = 'hc1'):
  Regressao | { erro: string } {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const idx = y.map((_, i) => i).filter((i) => ok(y[i]) && xs.every((x) => ok(x.valores[i])));
  const n = idx.length;
  const k = xs.length + 1;
  if (n <= k) return { erro: `observações completas insuficientes: ${n} para ${k} parâmetros` };
  for (const x of xs) {
    const v = idx.map((i) => x.valores[i] as number);
    if (Math.max(...v) - Math.min(...v) === 0) return { erro: `o regressor ${x.nome} não varia na amostra (${n} observações): não é possível estimar o coeficiente` };
  }
  const X = idx.map((i) => [1, ...xs.map((x) => x.valores[i] as number)]);
  const Y = idx.map((i) => y[i] as number);
  const XtX = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => X.reduce((s, l) => s + l[a] * l[b], 0)));
  const inv = inversa(XtX);
  if (!inv) return { erro: `regressores colineares (${xs.map((x) => x.nome).join(', ')}): a matriz X'X é singular` };
  const XtY = Array.from({ length: k }, (_, a) => X.reduce((s, l, i) => s + l[a] * Y[i], 0));
  const b = inv.map((l) => l.reduce((s, v, j) => s + v * XtY[j], 0));
  const e = X.map((l, i) => Y[i] - l.reduce((s, v, j) => s + v * b[j], 0));
  const gl = n - k;
  const sqr = e.reduce((s, v) => s + v * v, 0);
  const media = Y.reduce((s, v) => s + v, 0) / n;
  const sqt = Y.reduce((s, v) => s + (v - media) ** 2, 0);
  let V: number[][];
  if (erroPadrao === 'classico') {
    const s2 = sqr / gl;
    V = inv.map((l) => l.map((v) => v * s2));
  } else {
    // HC1: (X'X)⁻¹ X' diag(e²) X (X'X)⁻¹ × n/(n − k)
    const meio = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, c) => X.reduce((s, l, i) => s + l[a] * l[c] * e[i] * e[i], 0)));
    const m1 = inv.map((l) => Array.from({ length: k }, (_, c) => l.reduce((s, v, j) => s + v * meio[j][c], 0)));
    V = m1.map((l) => Array.from({ length: k }, (_, c) => l.reduce((s, v, j) => s + v * inv[j][c], 0) * (n / gl)));
  }
  const erros = V.map((l, i) => Math.sqrt(Math.max(l[i], 0)));
  const t = b.map((v, i) => v / erros[i]);
  const q = quantilT(0.05, gl);
  const r2 = sqt > 0 ? 1 - sqr / sqt : NaN;
  return {
    termos: ['(intercepto)', ...xs.map((x) => x.nome)], coeficientes: b, erros, t, p: t.map((v) => pBilateral(v, gl)),
    ic: b.map((v, i) => [v - q * erros[i], v + q * erros[i]]), n, k, gl, r2, r2Ajustado: 1 - ((1 - r2) * (n - 1)) / gl,
    erroPadrao, descartadas: y.length - n,
  };
}

export const NOME_ERRO_PADRAO: Record<ErroPadrao, string> = {
  classico: 'clássico (homocedástico)',
  hc1: 'robusto à heterocedasticidade (HC1)',
};

/** Resultado da regressão como tabela de consulta: uma linha por termo, com o resumo do modelo em colunas. */
export function tabelaRegressao(r: Regressao, y: string) {
  const colunas = ['termo', 'coeficiente', 'erro_padrao', 'estatistica_t', 'p_valor', 'ic95_inferior', 'ic95_superior',
    'n_observacoes', 'r2', 'r2_ajustado', 'graus_liberdade', 'descartadas_por_ausencia', 'variavel_dependente', 'tipo_erro_padrao', 'distribuicao'];
  const linhas = r.termos.map((termo, i) => [termo, r.coeficientes[i], r.erros[i], r.t[i], r.p[i], r.ic[i][0], r.ic[i][1],
    r.n, r.r2, r.r2Ajustado, r.gl, r.descartadas, y, NOME_ERRO_PADRAO[r.erroPadrao], `t de Student com ${r.gl} graus de liberdade`]);
  return { colunas, linhas, total: linhas.length };
}
