/**
 * Tabelas das respostas da IA. O modelo diz qual consulta vira tabela e de que forma (como veio, série por
 * período ou comparação entre dois períodos); a página monta a tabela só com o resultado da consulta e faz
 * aqui, por regras fixas, os totais, as variações e as participações. A mesma estrutura serve à tela, à
 * cópia (Word e Excel), ao CSV/XLSX e ao PDF, com os valores originais preservados.
 *
 * Ausência não é zero: um período pedido que não está no resultado fica "indisponível"; um grupo sem linha
 * num período que existe fica "sem registro"; um total com algum grupo faltando não é calculado
 * ("incompleto"); variação percentual sobre base zero, negativa ou ausente não é calculada. Nulos de uma coluna
 * cujo significado a consulta declarou (campo nulo de "colunas") viram "não se aplica", "denominador inválido",
 * "suprimido" ou "não calculado"; sem declaração, "—" (dado ausente). Zero é zero.
 */
import {
  colunasDeclaradas, ehCompetencia, formatarCelula, lerMarco, periodosComoNumero, rotuloColuna, rotuloCompetencia, tiposDoResultado,
  type Formato, type Tabela, type TipoColuna, type Valor,
} from './ia_formato';
import { fichaDaColuna } from './ia_catalogo';
import type { Cobertura } from './ia';
import { local, t } from './idioma';

/** Pedido do modelo (campo "tabelas" da ferramenta responder). */
export type EspecTabela = {
  consulta: string;
  /** principal: responde ao que foi pedido; alternativa: outro recorte (ex.: anos disponíveis); complemento: apoio. */
  papel: 'principal' | 'alternativa' | 'complemento';
  tipo: 'tabela' | 'serie' | 'comparacao';
  titulo: string;
  /** Coluna dos grupos (linhas da comparação, colunas da série); "" sem grupos. */
  grupo: string;
  /** Coluna dos anos ou competências; "" na tabela simples sem período. */
  periodo: string;
  /** Coluna numérica (série e comparação). */
  valor: string;
  /** Colunas mostradas na tabela simples, na ordem; [] = todas. */
  colunas: string[];
  /** Períodos pedidos na pergunta: início e fim (ano "2011" ou competência "2025-09"). */
  de: string;
  ate: string;
  total: boolean;
  participacao: boolean;
  formato: Formato;
  unidade: string;
  nota: string;
};

export type Ausencia = 'indisponivel' | 'sem_registro' | 'incompleto' | 'base_zero' | 'base_negativa' | 'nao_calculada' | 'sem_referencia'
  | 'nao_aplicavel' | 'denominador_invalido' | 'suprimido';
export type CelulaT = { v: Valor; a?: Ausencia };
/** Coluna da tabela: tipo de formatação e, nas variações, o sinal explícito (+). */
export type ColunaT = { nome: string; tipo: TipoColuna; sinal?: boolean; destaque?: boolean };
/** Cobertura da fonte da consulta, para explicar um período pedido que não veio (ex.: RAIS 2013–2025). */
export type CoberturaFonte = { nome: string; anos?: number[]; meses?: { de: number; ate: number } };

export type TabelaAnalitica = {
  espec: EspecTabela;
  consulta: string;
  sql: string;
  titulo: string;
  unidade: string;
  /** Fontes das tabelas lidas pela consulta (preenchidas por quem monta a resposta). */
  fonte: string;
  colunas: ColunaT[];
  linhas: CelulaT[][];
  /** Índice da linha de total, se houver. */
  linhaTotal: number | null;
  /** Períodos pedidos (rótulos) e os que não estão no resultado. */
  pedidos: string[];
  faltantes: string[];
  /** Período efetivamente coberto pelos dados da tabela (rótulo e intervalo). */
  usado: string;
  intervalo: { tipo: TipoPeriodo; de: number; ate: number } | null;
  notas: string[];
  /** Linhas da consulta: existentes e carregadas na página (a tabela simples mostra as carregadas). */
  registros: number;
  carregados: number;
  /** Colunas do resultado usadas na tabela (nomes originais, para as fichas do catálogo na exportação). */
  nomes?: string[];
};

export type Montagem = { ok: true; tabela: TabelaAnalitica } | { ok: false; motivo: string };

// ---------------- períodos ----------------

type TipoPeriodo = 'ano' | 'mes';
const intervaloDe = (ps: number[], tipo: TipoPeriodo) => (ps.length ? { tipo, de: Math.min(...ps), ate: Math.max(...ps) } : null);
const proximoMes = (aaaamm: number) => (aaaamm % 100 === 12 ? aaaamm + 89 : aaaamm + 1);
const rotuloP = (v: number, tipo: TipoPeriodo) => (tipo === 'mes' ? rotuloCompetencia(v) : String(v));

/** Marco pedido convertido ao tipo da coluna; null se vazio ou de outro tipo. */
function marco(s: string, tipo: TipoPeriodo): number | null {
  const m = s ? lerMarco(s) : null;
  return m && m.tipo === tipo ? m.valor : null;
}

/** Períodos de de a ate (anos ou meses), no máximo 600. */
function enumerar(de: number, ate: number, tipo: TipoPeriodo): number[] {
  const r: number[] = [];
  for (let p = Math.min(de, ate); p <= Math.max(de, ate) && r.length < 600; p = tipo === 'ano' ? p + 1 : proximoMes(p)) r.push(p);
  return r;
}

/** "2013–2021", "2013 e 2021", "set/2025". */
function rotuloIntervalo(ps: number[], tipo: TipoPeriodo, pontos = false): string {
  if (!ps.length) return '';
  const o = [...ps].sort((a, b) => a - b);
  if (o.length === 1) return rotuloP(o[0], tipo);
  return pontos ? `${rotuloP(o[0], tipo)} ${t('e', 'and')} ${rotuloP(o.at(-1)!, tipo)}` : `${rotuloP(o[0], tipo)}–${rotuloP(o.at(-1)!, tipo)}`;
}

/** Por que um período pedido não veio: fora da cobertura da fonte (quando conhecida) ou sem dados no resultado. */
function motivoFalta(p: number, tipo: TipoPeriodo, cob: CoberturaFonte | null): string {
  const rot = rotuloP(p, tipo);
  if (cob && tipo === 'ano' && cob.anos?.length && !cob.anos.includes(p)) {
    return t(`${rot}: não disponível — ${cob.nome} no painel cobre ${cob.anos[0]}–${cob.anos.at(-1)}.`,
      `${rot}: not available — ${cob.nome} in the dashboard covers ${cob.anos[0]}–${cob.anos.at(-1)}.`);
  }
  if (cob && tipo === 'mes' && cob.meses && (p < cob.meses.de || p > cob.meses.ate)) {
    return t(`${rot}: não disponível — ${cob.nome} no painel cobre ${rotuloCompetencia(cob.meses.de)}–${rotuloCompetencia(cob.meses.ate)}.`,
      `${rot}: not available — ${cob.nome} in the dashboard covers ${rotuloCompetencia(cob.meses.de)}–${rotuloCompetencia(cob.meses.ate)}.`);
  }
  return t(`${rot}: sem dados no resultado da consulta.`, `${rot}: no data in the query result.`);
}

// ---------------- formatação ----------------

const TIPO_DO_FORMATO: Record<Formato, TipoColuna> = { inteiro: 'contagem', reais: 'reais', percentual: 'percentual', decimal: 'numero' };

export const ROTULO_AUSENCIA = (): Record<Ausencia, [string, string]> => ({
  indisponivel: [t('indisp.', 'n/a'), t('indisp. = período pedido sem dados na base (não é zero)', 'n/a = requested period with no data in the source (not zero)')],
  sem_registro: [t('s/ reg.', 'no rec.'), t('s/ reg. = grupo sem registro no resultado para o período (não tratado como zero)', 'no rec. = group with no record in the result for the period (not treated as zero)')],
  incompleto: [t('incompl.', 'incompl.'), t('incompl. = total não calculado porque falta o valor de algum grupo', 'incompl. = total not computed because a group value is missing')],
  base_zero: [t('n.c.', 'n.c.'), t('n.c. = variação percentual não calculada: valor inicial zero', 'n.c. = percentage change not computed: initial value is zero')],
  base_negativa: [t('n.c.', 'n.c.'), t('n.c. = variação percentual não calculada: valor inicial negativo', 'n.c. = percentage change not computed: initial value is negative')],
  nao_calculada: [t('n.c.', 'n.c.'), t('n.c. = não calculada: falta o valor de um dos períodos', 'n.c. = not computed: a period value is missing')],
  sem_referencia: [t('n.c.', 'n.c.'), t('n.c. = variação não calculada nesta linha (sem período ou valor de referência, como na primeira linha da série); o valor da linha existe', 'n.c. = change not computed in this row (no reference period or value, as in the first row of a series); the row value exists')],
  nao_aplicavel: [t('n.a.', 'n.a.'), t('n.a. = não se aplica a esta linha (o indicador não existe para esse ente ou período)', 'n.a. = not applicable to this row (the indicator does not exist for this government or period)')],
  denominador_invalido: [t('den. inv.', 'inv. den.'), t('den. inv. = não calculado: denominador ausente, zero ou negativo (ex.: população não informada)', 'inv. den. = not computed: denominator missing, zero or negative (e.g. population not reported)')],
  suprimido: [t('supr.', 'suppr.'), t('supr. = valor suprimido (sigilo ou poucas observações); existe, mas não é divulgado', 'suppr. = suppressed value (confidentiality or few observations); it exists but is not released')],
});

/** Texto de uma célula: ausências com rótulo curto, — para dado ausente, sinal explícito nas variações. */
export function formatarCelulaT(c: CelulaT, col: ColunaT): string {
  if (c.a) return ROTULO_AUSENCIA()[c.a][0];
  const s = formatarCelula(c.v, col.tipo);
  return col.sinal && typeof c.v === 'number' && c.v > 0 ? `+${s}` : s;
}

/** Legenda das ausências que aparecem na tabela (uma vez cada). */
export function legendaAusencias(tab: TabelaAnalitica): string[] {
  const vistas = new Set<string>();
  for (const l of tab.linhas) for (const c of l) if (c.a) vistas.add(ROTULO_AUSENCIA()[c.a][1]);
  if (tab.linhas.some((l) => l.some((c) => !c.a && c.v === null))) vistas.add(t('— = sem dado (ausente, não zero)', '— = no data (missing, not zero)'));
  return [...vistas];
}

/** Coluna de texto (alinhada à esquerda)? */
export const ehTexto = (col: ColunaT) => col.tipo === 'texto';

// ---------------- montagem ----------------

const nomeGrupo = (v: Valor) => (v === null || v === undefined || v === '' ? '—' : String(v));
const somar = (cs: CelulaT[]): CelulaT => (cs.every((c) => typeof c.v === 'number' && !c.a)
  ? { v: cs.reduce((s, c) => s + (c.v as number), 0) }
  : { v: null, a: 'incompleto' });

/**
 * Monta a tabela pedida a partir do resultado da consulta. Devolve o motivo quando o pedido não combina com
 * o resultado (coluna inexistente, valor não numérico, período que não é ano nem competência, linhas
 * repetidas para o mesmo período e grupo).
 */
export function montarTabela(e: EspecTabela, c: { rotulo: string; sql: string; resultado?: Tabela | { erro: string } },
  cobertura: CoberturaFonte | null = null): Montagem {
  const nao = (motivo: string): Montagem => ({ ok: false, motivo });
  if (!c.resultado || 'erro' in c.resultado) return nao(t(`a consulta ${e.consulta} não existe ou falhou`, `query ${e.consulta} does not exist or failed`));
  const r = periodosComoNumero(c.resultado);
  if (!r.linhas.length) return nao(t(`a consulta ${e.consulta} não trouxe linhas`, `query ${e.consulta} returned no rows`));
  const exigidas = e.tipo === 'tabela' ? [...e.colunas, ...(e.periodo ? [e.periodo] : [])] : [e.periodo, e.valor, ...(e.grupo ? [e.grupo] : [])];
  const faltam = exigidas.filter((x) => !x || !r.colunas.includes(x));
  if (faltam.length) {
    return nao(t(`as colunas ${faltam.map((x) => x || '(vazia)').join(', ')} não existem em ${e.consulta} (colunas: ${r.colunas.join(', ')})`,
      `columns ${faltam.map((x) => x || '(empty)').join(', ')} not found in ${e.consulta} (columns: ${r.colunas.join(', ')})`));
  }
  const tipos = tiposDoResultado(r, c.sql);
  const base = {
    espec: e, consulta: e.consulta, sql: c.sql, titulo: e.titulo || t('Tabela', 'Table'), unidade: e.unidade, fonte: '',
    registros: r.total, carregados: r.linhas.length,
    nomes: e.tipo === 'tabela' ? (e.colunas.length ? e.colunas : r.colunas) : [e.periodo, e.grupo, e.valor].filter(Boolean),
  };
  if (e.tipo === 'tabela') return montarSimples(e, r, tipos, base, cobertura);

  const ip = r.colunas.indexOf(e.periodo);
  const iv = r.colunas.indexOf(e.valor);
  const ig = e.grupo ? r.colunas.indexOf(e.grupo) : -1;
  const tipoP: TipoPeriodo | null = tipos[ip] === 'ano' ? 'ano' : tipos[ip] === 'competencia' ? 'mes' : null;
  if (!tipoP) return nao(t(`a coluna ${e.periodo} não tem anos nem competências (AAAAMM)`, `column ${e.periodo} holds neither years nor months (YYYYMM)`));
  if (!r.linhas.some((l) => typeof l[iv] === 'number')) return nao(t(`a coluna ${e.valor} não é numérica`, `column ${e.valor} is not numeric`));
  if (r.total > r.linhas.length) {
    return nao(t(`a consulta ${e.consulta} tem ${r.total} linhas e só ${r.linhas.length} foram carregadas: agregue antes de montar a tabela`,
      `query ${e.consulta} has ${r.total} rows and only ${r.linhas.length} were loaded: aggregate before building the table`));
  }

  // valores por período e grupo (cada par aparece uma vez)
  const valores = new Map<string, Valor>();
  const grupos: string[] = [];
  const presentes = new Set<number>();
  for (const l of r.linhas) {
    const p = l[ip];
    if (typeof p !== 'number' || (tipoP === 'mes' && !ehCompetencia(p))) continue;
    const g = ig >= 0 ? nomeGrupo(l[ig]) : '';
    const k = `${p}|${g}`;
    if (valores.has(k)) {
      return nao(t(`há mais de uma linha para ${rotuloP(p, tipoP)}${g ? ` e ${g}` : ''} em ${e.consulta}: agregue por período${e.grupo ? ' e grupo' : ''}`,
        `more than one row for ${rotuloP(p, tipoP)}${g ? ` and ${g}` : ''} in ${e.consulta}: aggregate by period${e.grupo ? ' and group' : ''}`));
    }
    valores.set(k, l[iv]);
    // período só com valores nulos (a consulta cruzou os anos pedidos com a base) = período sem dados
    if (l[iv] !== null && l[iv] !== undefined) presentes.add(p);
    if (!grupos.includes(g)) grupos.push(g);
  }
  const de = marco(e.de, tipoP);
  const ate = marco(e.ate, tipoP);
  const ordenados = [...presentes].sort((a, b) => a - b);
  const notas: string[] = [];
  let pedidos: number[];
  if (e.tipo === 'comparacao') {
    pedidos = de !== null && ate !== null ? [de, ate] : [ordenados[0], ordenados.at(-1)!];
    if (de === null || ate === null) notas.push(t('Períodos não indicados: comparados o primeiro e o último do resultado.', 'Periods not given: the first and last in the result are compared.'));
    if (pedidos[0] === pedidos[1]) return nao(t('a comparação precisa de dois períodos diferentes em de e ate', 'the comparison needs two different periods in de and ate'));
  } else {
    pedidos = de !== null && ate !== null ? enumerar(de, ate, tipoP) : ordenados;
  }
  const faltantes = pedidos.filter((p) => !presentes.has(p));
  for (const p of faltantes) notas.push(motivoFalta(p, tipoP, cobertura));
  const fora = ordenados.filter((p) => !pedidos.includes(p));
  if (fora.length) {
    notas.push(t(`O resultado também tem ${rotuloIntervalo(fora, tipoP, e.tipo === 'comparacao')}, fora dos períodos pedidos: não ${fora.length === 1 ? 'entra' : 'entram'} nesta tabela.`,
      `The result also has ${rotuloIntervalo(fora, tipoP, e.tipo === 'comparacao')}, outside the requested periods: not included in this table.`));
  }
  // nulo da coluna de valor com significado declarado na consulta (não se aplica, denominador inválido…)
  const nuloV = colunasDeclaradas(c.sql)?.get(e.valor.toLowerCase())?.nulo;
  const celula = (p: number, g: string): CelulaT => {
    if (!presentes.has(p)) return { v: null, a: 'indisponivel' };
    const k = `${p}|${g}`;
    if (!valores.has(k)) return { v: null, a: 'sem_registro' };
    const v = valores.get(k)!;
    return v === null && nuloV ? { v: null, a: nuloV } : { v };
  };
  const tipoV = TIPO_DO_FORMATO[e.formato] ?? 'numero';
  const comTotal = e.total && grupos.length > 1 && e.formato !== 'percentual';
  const usados = pedidos.filter((p) => presentes.has(p));
  const comum = {
    ...base, pedidos: pedidos.map((p) => rotuloP(p, tipoP)), faltantes: faltantes.map((p) => rotuloP(p, tipoP)),
    usado: rotuloIntervalo(usados, tipoP, e.tipo === 'comparacao'),
    intervalo: intervaloDe(usados, tipoP),
  };

  if (e.tipo === 'serie') {
    const colunas: ColunaT[] = [
      { nome: tipoP === 'ano' ? t('Ano', 'Year') : t('Competência', 'Month'), tipo: 'texto' },
      ...grupos.map((g): ColunaT => ({ nome: g || rotuloColuna(e.valor, 'numero'), tipo: tipoV })),
      ...(comTotal ? [{ nome: t('Total', 'Total'), tipo: tipoV, destaque: true }] : []),
    ];
    const linhas = pedidos.map((p) => {
      const cs = grupos.map((g) => celula(p, g));
      const total = !presentes.has(p) ? { v: null, a: 'indisponivel' as const } : somar(cs);
      return [{ v: rotuloP(p, tipoP) }, ...cs, ...(comTotal ? [total] : [])];
    });
    if (comTotal) notas.push(t('Total = soma dos grupos da tabela no período; não é calculado quando falta algum grupo.', 'Total = sum of the groups in the table for the period; not computed when a group is missing.'));
    return { ok: true, tabela: { ...comum, colunas, linhas, linhaTotal: null, notas: [...notas, ...notaDoModelo(e)] } };
  }

  // comparação: uma linha por grupo (e o total), valores nos dois períodos, variações e participações
  const [p0, p1] = pedidos;
  const pct = e.formato === 'percentual';
  const comPart = e.participacao && comTotal;
  const totais = comTotal ? [p0, p1].map((p) => (presentes.has(p) ? somar(grupos.map((g) => celula(p, g))) : { v: null, a: 'indisponivel' as const })) : [];
  const variacoes = (a: CelulaT, b: CelulaT): CelulaT[] => {
    const ok = typeof a.v === 'number' && typeof b.v === 'number' && !a.a && !b.a;
    const abs: CelulaT = ok ? { v: (b.v as number) - (a.v as number) } : { v: null, a: 'nao_calculada' };
    if (pct) return [abs];
    const rel: CelulaT = !ok ? { v: null, a: 'nao_calculada' }
      : (a.v as number) === 0 ? { v: null, a: 'base_zero' }
        : (a.v as number) < 0 ? { v: null, a: 'base_negativa' }
          : { v: ((b.v as number) / (a.v as number) - 1) * 100 };
    return [abs, rel];
  };
  const participacoes = (a: CelulaT, b: CelulaT): CelulaT[] => {
    const parte = (x: CelulaT, tot: CelulaT): CelulaT => (typeof x.v === 'number' && !x.a && typeof tot.v === 'number' && !tot.a && tot.v !== 0
      ? { v: (x.v / tot.v) * 100 } : { v: null, a: 'nao_calculada' });
    const [x, y] = [parte(a, totais[0]), parte(b, totais[1])];
    const dif: CelulaT = typeof x.v === 'number' && typeof y.v === 'number' ? { v: y.v - x.v } : { v: null, a: 'nao_calculada' };
    return [x, y, dif];
  };
  // contribuição para a variação do total, em p.p.: variação absoluta do grupo ÷ total inicial × 100 (somam a variação % do total)
  const comContrib = comTotal && !pct;
  const contribuicao = (a: CelulaT, b: CelulaT): CelulaT => {
    const t0 = totais[0];
    return typeof a.v === 'number' && typeof b.v === 'number' && !a.a && !b.a && typeof t0?.v === 'number' && !t0.a && t0.v > 0
      ? { v: (((b.v as number) - (a.v as number)) / t0.v) * 100 } : { v: null, a: 'nao_calculada' };
  };
  const linhaDe = (rotulo: string, a: CelulaT, b: CelulaT): CelulaT[] => [{ v: rotulo }, a, b, ...variacoes(a, b),
    ...(comContrib ? [contribuicao(a, b)] : []), ...(comPart ? participacoes(a, b) : [])];
  const linhas = grupos.map((g) => linhaDe(g || rotuloColuna(e.valor, 'numero'), celula(p0, g), celula(p1, g)));
  if (comTotal) linhas.push(linhaDe(t('Total', 'Total'), totais[0], totais[1]));
  const r0 = rotuloP(p0, tipoP);
  const r1 = rotuloP(p1, tipoP);
  const colunas: ColunaT[] = [
    { nome: e.grupo ? rotuloColuna(e.grupo, 'texto').replace(/^./, (x) => x.toUpperCase()) : t('Indicador', 'Indicator'), tipo: 'texto' },
    { nome: r0, tipo: tipoV },
    { nome: r1, tipo: tipoV },
    pct ? { nome: t('Diferença (p.p.)', 'Difference (p.p.)'), tipo: 'percentual', sinal: true } : { nome: t('Variação absoluta', 'Absolute change'), tipo: tipoV, sinal: true },
    ...(pct ? [] : [{ nome: t('Variação (%)', 'Change (%)'), tipo: 'percentual' as TipoColuna, sinal: true }]),
    ...(comContrib ? [{ nome: t('Contribuição para a variação do total (p.p.)', 'Contribution to the change in the total (p.p.)'), tipo: 'percentual' as TipoColuna, sinal: true }] : []),
    ...(comPart ? [
      { nome: t(`Participação ${r0} (%)`, `Share ${r0} (%)`), tipo: 'percentual' as TipoColuna },
      { nome: t(`Participação ${r1} (%)`, `Share ${r1} (%)`), tipo: 'percentual' as TipoColuna },
      { nome: t('Diferença de participação (p.p.)', 'Share difference (p.p.)'), tipo: 'percentual' as TipoColuna, sinal: true },
    ] : []),
  ];
  notas.push(pct
    ? t(`Diferença em pontos percentuais = valor de ${r1} − valor de ${r0}.`, `Difference in percentage points = ${r1} value − ${r0} value.`)
    : t(`Variação absoluta = valor de ${r1} − valor de ${r0}; variação (%) = (${r1} ÷ ${r0} − 1) × 100.`, `Absolute change = ${r1} value − ${r0} value; change (%) = (${r1} ÷ ${r0} − 1) × 100.`));
  if (comContrib) notas.push(t(`Variação (%) é o crescimento de cada grupo; contribuição (p.p.) = variação absoluta do grupo ÷ total de ${r0} × 100: as contribuições somam a variação (%) do total.`, `Change (%) is each group’s growth; contribution (p.p.) = group’s absolute change ÷ ${r0} total × 100: contributions add up to the total’s change (%).`));
  if (comPart) notas.push(t('Participação = valor do grupo ÷ total do período × 100 (denominador: o total da tabela).', 'Share = group value ÷ period total × 100 (denominator: the table total).'));
  if (comTotal) notas.push(t('Total = soma dos grupos da tabela; não é calculado quando falta algum grupo.', 'Total = sum of the groups in the table; not computed when a group is missing.'));
  return { ok: true, tabela: { ...comum, colunas, linhas, linhaTotal: comTotal ? linhas.length - 1 : null, notas: [...notas, ...notaDoModelo(e)] } };
}

/** Nota do modelo (depois das da página). */
const notaDoModelo = (e: EspecTabela) => (e.nota.trim() ? [e.nota.trim()] : []);

/** Tabela simples: o resultado como veio (colunas escolhidas), com os períodos pedidos que faltarem. */
function montarSimples(e: EspecTabela, r: Tabela, tipos: TipoColuna[], base: Omit<TabelaAnalitica, 'colunas' | 'linhas' | 'linhaTotal' | 'pedidos' | 'faltantes' | 'usado' | 'intervalo' | 'notas'>,
  cobertura: CoberturaFonte | null): Montagem {
  const idx = (e.colunas.length ? e.colunas : r.colunas).map((c) => r.colunas.indexOf(c));
  const decl = colunasDeclaradas(base.sql);
  const colunas: ColunaT[] = idx.map((j) => ({ nome: rotuloColuna(r.colunas[j], tipos[j], decl?.get(r.colunas[j].toLowerCase())), tipo: tipos[j] }));
  const variacao = idx.map((j) => /(^|_)(var|variacao|crescimento|cresc|dif|diferenca|delta|contribuicao)(_|$)/i.test(r.colunas[j]));
  const linhas = r.linhas.map((l) => {
    // a linha tem o valor medido (não conta ano, competência nem código): a variação vazia é "não calculada"
    const temValor = idx.some((j, k) => !variacao[k] && typeof l[j] === 'number' && !['ano', 'competencia', 'codigo'].includes(tipos[j]));
    return idx.map((j, k): CelulaT => {
      if (l[j] !== null) return { v: l[j] };
      const nulo = decl?.get(r.colunas[j].toLowerCase())?.nulo;
      return nulo ? { v: null, a: nulo } : variacao[k] && temValor ? { v: null, a: 'sem_referencia' } : { v: null };
    });
  });
  const notas: string[] = [];
  if (e.nota.trim()) notas.push(e.nota.trim());
  let pedidos: string[] = [];
  let faltantes: string[] = [];
  let usado = '';
  let intervalo: TabelaAnalitica['intervalo'] = null;
  const ip = e.periodo ? r.colunas.indexOf(e.periodo) : -1;
  const tipoP: TipoPeriodo | null = ip < 0 ? null : tipos[ip] === 'ano' ? 'ano' : tipos[ip] === 'competencia' ? 'mes' : null;
  if (tipoP) {
    // períodos com algum número além do próprio período (linhas só com nulos não contam como dado)
    const comDado = (l: Valor[]) => l.some((v, j) => j !== ip && typeof v === 'number');
    const presentes = [...new Set(r.linhas.filter(comDado).map((l) => l[ip]).filter((v): v is number => typeof v === 'number'))].sort((a, b) => a - b);
    const de = marco(e.de, tipoP);
    const ate = marco(e.ate, tipoP);
    const lista = de !== null && ate !== null ? enumerar(de, ate, tipoP) : presentes;
    pedidos = lista.map((p) => rotuloP(p, tipoP));
    const falta = lista.filter((p) => !presentes.includes(p));
    faltantes = falta.map((p) => rotuloP(p, tipoP));
    for (const p of falta) notas.push(motivoFalta(p, tipoP, cobertura));
    const usados = presentes.filter((p) => lista.includes(p));
    usado = rotuloIntervalo(usados, tipoP);
    intervalo = intervaloDe(usados, tipoP);
  }
  if (r.total > r.linhas.length) {
    notas.push(t(`A consulta tem ${r.total.toLocaleString(local())} linhas; a página mostra as primeiras ${r.linhas.length.toLocaleString(local())}, e a exportação (CSV ou Excel) roda a consulta de novo e traz todas.`,
      `The query has ${r.total.toLocaleString(local())} rows; the page shows the first ${r.linhas.length.toLocaleString(local())}, and the export (CSV or Excel) runs the query again and includes all of them.`));
  }
  return { ok: true, tabela: { ...base, colunas, linhas, linhaTotal: null, pedidos, faltantes, usado, intervalo, notas } };
}

// ---------------- conferência e saídas ----------------

/** O número aparece em alguma célula da tabela (com a precisão em que foi escrito)? */
export function tabelaTem(tab: TabelaAnalitica, valor: number, tolerancia: number): boolean {
  return tab.linhas.some((l) => l.some((c) => typeof c.v === 'number' && !c.a && Math.abs(c.v - valor) <= tolerancia));
}

const html = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/** Linhas de rodapé da tabela: unidade, fonte, notas e legenda das ausências. */
export function rodapeTabela(tab: TabelaAnalitica): string[] {
  return [
    tab.unidade && `${t('Unidade', 'Unit')}: ${tab.unidade}.`,
    tab.fonte && `${t('Fonte', 'Source')}: ${tab.fonte}; ${t('elaboração LAPAM/UFG', 'prepared by LAPAM/UFG')}.`,
    ...tab.notas.map((n) => `${t('Nota', 'Note')}: ${n}`),
    ...legendaAusencias(tab),
  ].filter((x): x is string => !!x);
}

/** Tabela em HTML (cópia para o Word e PDF): título na legenda, números à direita, cabeçalho que se repete. */
export function tabelaHtml(tab: TabelaAnalitica, o: { inline?: boolean; numero?: string } = {}): string {
  const est = (textual: boolean, cab = false) => (o.inline
    ? ` style="border:1px solid #999;padding:3px 6px;${textual ? 'text-align:left' : 'text-align:right'}${cab ? ';background:#e8e8e8;font-weight:bold' : ''}"`
    : ` class="${textual ? 't' : 'n'}"`);
  const titulo = `${o.numero ? `${html(o.numero)} — ` : ''}${html(tab.titulo)}`;
  const cab = `<thead><tr>${tab.colunas.map((c) => `<th${est(ehTexto(c), true)}>${html(c.nome)}</th>`).join('')}</tr></thead>`;
  const corpo = tab.linhas.map((l, i) => `<tr${i === tab.linhaTotal ? (o.inline ? ' style="font-weight:bold"' : ' class="total"') : ''}>${
    l.map((c, j) => `<td${est(ehTexto(tab.colunas[j]))}>${html(formatarCelulaT(c, tab.colunas[j]))}</td>`).join('')}</tr>`).join('');
  const tabela = `<table${o.inline ? ' style="border-collapse:collapse;font-size:10pt"' : ' class="analitica"'}><caption${o.inline ? ' style="text-align:left;font-weight:bold;padding:4px 0"' : ''}>${titulo}</caption>${cab}<tbody>${corpo}</tbody></table>`;
  const rodape = rodapeTabela(tab).map((x) => `<p${o.inline ? ' style="font-size:9pt;margin:2px 0"' : ' class="nota"'}>${html(x)}</p>`).join('');
  return `${tabela}${rodape}`;
}

/** Tabela em texto separado por tabulação (cola em linhas e colunas no Excel e no Word); números sem milhar. */
export function tabelaTsv(tab: TabelaAnalitica, decimal = ','): string {
  const cel = (c: CelulaT, col: ColunaT) => (c.a || typeof c.v !== 'number' || col.tipo === 'ano' || col.tipo === 'codigo'
    ? formatarCelulaT(c, col)
    : String(c.v).replace('.', decimal));
  return [
    tab.titulo,
    tab.colunas.map((c) => c.nome).join('\t'),
    ...tab.linhas.map((l) => l.map((c, j) => cel(c, tab.colunas[j])).join('\t')),
    ...rodapeTabela(tab),
  ].join('\n');
}

/** Tabela para CSV/XLSX: números como números (ausências como texto) e metadados. */
/** Nome legível do tipo de cada coluna, para a ficha da exportação. */
const NOME_TIPO = (): Partial<Record<TipoColuna, string>> => ({
  reais: t('R$', 'R$'), contagem: t('contagem (inteiro)', 'count (integer)'), percentual: t('percentual (0–100)', 'percentage (0–100)'),
  codigo: t('código', 'code'), ano: t('ano', 'year'), competencia: t('competência (AAAAMM)', 'month (YYYYMM)'), texto: t('texto', 'text'),
  estatistica: t('estatística (sem unidade)', 'statistic (unitless)'), indice: t('índice/fator', 'index/factor'), razao: t('razão', 'ratio'), numero: t('número', 'number'),
});

export function tabelaExportavel(tab: TabelaAnalitica, extras: [string, string][] = [], cobertura?: Cobertura | null) {
  // definição, fonte, cobertura, filtros e classificação das colunas do catálogo (as calculadas na consulta não têm)
  const fichas = [...new Set(tab.nomes ?? [])].flatMap((n) => {
    const f = fichaDaColuna(n, cobertura);
    return f ? [[`${t('Definição', 'Definition')}: ${n}`, f] as [string, string]] : [];
  });
  return {
    colunas: tab.colunas.map((c) => c.nome),
    linhas: tab.linhas.map((l) => l.map((c) => (c.a ? ROTULO_AUSENCIA()[c.a][0] : c.v))),
    metadados: [
      [t('Tabela', 'Table'), tab.titulo] as [string, string],
      ...(tab.unidade ? [[t('Unidade', 'Unit'), tab.unidade] as [string, string]] : []),
      ...(tab.fonte ? [[t('Fonte', 'Source'), `${tab.fonte}; ${t('elaboração LAPAM/UFG', 'prepared by LAPAM/UFG')}`] as [string, string]] : []),
      ...(tab.pedidos.length ? [[t('Período pedido', 'Requested period'), tab.pedidos.length > 2 ? `${tab.pedidos[0]}–${tab.pedidos.at(-1)}` : tab.pedidos.join(t(' e ', ' and '))] as [string, string]] : []),
      ...(tab.usado ? [[t('Período com dados', 'Period with data'), tab.usado] as [string, string]] : []),
      ...tab.notas.map((n) => [t('Nota', 'Note'), n] as [string, string]),
      ...legendaAusencias(tab).map((n) => [t('Legenda', 'Legend'), n] as [string, string]),
      [t('Unidade das colunas', 'Column units'), tab.colunas.map((c) => `${c.nome}: ${NOME_TIPO()[c.tipo] ?? c.tipo}`).join(' | ')] as [string, string],
      ...fichas,
      ...extras,
      [t('Consulta', 'Query'), tab.consulta] as [string, string],
      ['SQL', tab.sql.slice(0, 32000)] as [string, string],
    ],
  };
}
