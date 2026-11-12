/**
 * Painel de indicadores do mercado de trabalho: cálculos puros sobre as linhas já publicadas (trab_serie: uma linha por
 * ano; trab_caged: uma linha por competência). Nada aqui consulta dados nem formata texto de tela: numerador,
 * denominador e condição do dado saem junto de cada valor, para a tela, a nota do cartão e a exportação usarem o mesmo número.
 *
 * Regras: divisão por zero ou por ausente dá null (nunca zero falso); remuneração média = massa de dezembro ÷ TODOS os
 * vínculos ativos (quem não tem valor conta como zero no denominador); a massa de dezembro não é massa anual.
 */

export type Linha = Record<string, unknown>;

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
export const razao = (a: number | null | undefined, b: number | null | undefined): number | null =>
  typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || b === 0 ? null : a / b;

export const GRANDES_SETORES = ['agropecuaria', 'industria', 'construcao', 'comercio', 'servicos', 'adm_publica'] as const;
export type GrandeSetor = (typeof GRANDES_SETORES)[number];

export type Parte = { n: number | null; pct: number | null };

export type PainelRais = {
  ano: number;
  anoAnterior: number | null;
  empregos: number | null;
  variacaoAbs: number | null;
  variacaoPct: number | null;
  populacao: number | null;
  porMil: number | null;
  estabelecimentos: number | null;
  vinculosPorEstab: number | null;
  nRem: number | null;
  semRem: number | null;
  pctSemRem: number | null;
  remMedia: number | null;
  remMediaReal: number | null;
  massa: number | null;
  massaReal: number | null;
  remMulheres: number | null;
  remHomens: number | null;
  razaoMH: number | null;
  mulheres: Parte;
  homens: Parte;
  sexoIgnorado: number | null;
  ate24: Parte;
  de50mais: Parte;
  superior: Parte;
  setores: Record<GrandeSetor, Parte>;
};

const parte = (conta: unknown, total: number | null): Parte => {
  const c = n(conta);
  return { n: c, pct: razao(c, total) };
};

/**
 * Indicadores da RAIS de um ano a partir da linha de trab_serie desse ano (e a do ano anterior, quando existe).
 * Sem linha do ano devolve null: o painel diz que não há vínculos, em vez de zeros.
 */
export function calcularRais(a: Linha | undefined, ant: Linha | undefined, ano: number): PainelRais | null {
  if (!a) return null;
  const empregos = n(a.empregos);
  const empAnt = n(ant?.empregos);
  const nRem = n(a.n_rem_dez);
  const semRem = empregos !== null && nRem !== null && nRem <= empregos ? empregos - nRem : null;
  const mulheres = n(a.mulheres);
  const homens = n(a.homens);
  const classificados = mulheres !== null && homens !== null ? mulheres + homens : null;
  const sexoIgnorado = empregos !== null && classificados !== null && classificados <= empregos ? empregos - classificados : null;
  const setores = Object.fromEntries(GRANDES_SETORES.map((s) => [s, parte(a[`empregos_${s}`], empregos)])) as Record<GrandeSetor, Parte>;
  return {
    ano,
    anoAnterior: ant ? ano - 1 : null,
    empregos,
    variacaoAbs: empregos !== null && empAnt !== null ? empregos - empAnt : null,
    variacaoPct: empregos !== null && empAnt !== null ? razao(empregos - empAnt, empAnt) : null,
    populacao: n(a.populacao),
    // só municípios com população válida entram no numerador e no denominador
    porMil: ((r) => (r === null ? null : 1000 * r))(razao(n(a.empregos_com_populacao), n(a.populacao))),
    estabelecimentos: n(a.estabelecimentos),
    vinculosPorEstab: razao(empregos, n(a.estabelecimentos)),
    nRem,
    semRem,
    pctSemRem: razao(semRem, empregos),
    remMedia: n(a.remuneracao_media),
    remMediaReal: n(a.remuneracao_media_real),
    massa: n(a.massa_dez),
    massaReal: n(a.massa_dez_real),
    remMulheres: n(a.remuneracao_mulheres),
    remHomens: n(a.remuneracao_homens),
    razaoMH: razao(n(a.remuneracao_mulheres), n(a.remuneracao_homens)),
    mulheres: parte(mulheres, empregos),
    homens: parte(homens, empregos),
    sexoIgnorado,
    ate24: parte(a.ate24, empregos),
    de50mais: parte(a.de50mais, empregos),
    superior: parte(a.superior, empregos),
    setores,
  };
}

// ---------------- CAGED do ano ----------------

export type CondicaoCaged = 'completo' | 'parcial' | 'sem_registros' | 'fora_cobertura';

export type CagedAno = {
  ano: number;
  condicao: CondicaoCaged;
  /** meses do ano dentro da cobertura publicada (metadados) */
  mesesCobertos: number[];
  /** meses do ano que têm ao menos uma linha na tabela do território */
  mesesComRegistro: number[];
  admissoes: number | null;
  desligamentos: number | null;
  saldo: number | null;
};

/** Competências AAAAMM de um ano dentro de [de, ate] (os metadados do CAGED). Sem metadados, nada está coberto. */
export function mesesCobertos(ano: number, de: number | undefined, ate: number | undefined): number[] {
  if (!de || !ate) return [];
  const m: number[] = [];
  for (let mes = 1; mes <= 12; mes++) {
    const c = ano * 100 + mes;
    if (c >= de && c <= ate) m.push(mes);
  }
  return m;
}

/**
 * Admissões, desligamentos e saldo do ANO-calendário: soma só as competências desse ano (nunca saldo_12m, que é janela
 * de 12 linhas). Fora da cobertura publicada ou sem nenhuma linha no ano, os valores são null (não zero). Ano com
 * menos de 12 meses cobertos é parcial. Em município, mês sem movimentação pode não ter linha: a cobertura vem dos
 * metadados, e os meses com registro ficam à parte.
 */
export function somarCagedAno(linhas: Linha[] | undefined, ano: number, de: number | undefined, ate: number | undefined): CagedAno {
  const cobertos = mesesCobertos(ano, de, ate);
  // só competências AAAAMM válidas (mês 1 a 12) do ano e dentro da cobertura declarada; o resto não entra no valor
  const doAno = (linhas ?? []).filter((r) => {
    const c = n(r.competencia);
    return c !== null && Number.isInteger(c) && Math.floor(c / 100) === ano && c % 100 >= 1 && c % 100 <= 12 && !!de && !!ate && c >= de && c <= ate;
  });
  const mesesComRegistro = [...new Set(doAno.map((r) => (n(r.competencia) as number) % 100))].sort((x, y) => x - y);
  const base = { ano, mesesCobertos: cobertos, mesesComRegistro };
  if (!cobertos.length) return { ...base, condicao: 'fora_cobertura', admissoes: null, desligamentos: null, saldo: null };
  if (!doAno.length) return { ...base, condicao: 'sem_registros', admissoes: null, desligamentos: null, saldo: null };
  const soma = (c: string) => {
    // campo ausente em algum mês com registro: sem dado (total aparentemente completo seria enganoso); zero registrado segue zero
    const v = doAno.map((r) => n(r[c]));
    return v.some((x) => x === null) ? null : v.reduce<number>((s, x) => s + (x as number), 0);
  };
  return { ...base, condicao: cobertos.length === 12 ? 'completo' : 'parcial', admissoes: soma('admissoes'), desligamentos: soma('desligamentos'), saldo: soma('saldo') };
}

// ---------------- indicadores para tabela e exportação ----------------

export type Condicao = 'ok' | 'ausente' | 'parcial' | 'sem_registros' | 'fora_cobertura';

/** Condição de um valor numérico simples: null é ausente (nunca se mostra como zero). */
export const condicaoValor = (v: number | null): Condicao => (v === null ? 'ausente' : 'ok');

/** Número de meses por extenso para a cobertura: "jan–set" ou "jan–dez". */
export function faixaMeses(meses: number[], nomes: string[]): string {
  if (!meses.length) return '–';
  return meses.length === 1 ? nomes[meses[0] - 1] : `${nomes[meses[0] - 1]}–${nomes[meses[meses.length - 1] - 1]}`;
}

/** Valor para o arquivo exportado: percentuais e razões saem em pontos percentuais (48,5), como na tela; o resto não muda. */
export function valorExportado(valor: number | null, un: string): number | null {
  if (valor === null) return null;
  return un === 'pct' || un === 'razao' ? valor * 100 : valor;
}
