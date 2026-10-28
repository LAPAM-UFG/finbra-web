/**
 * Como a IA mostra números, períodos e tabelas (página /ia, cópia em texto e relatório em PDF). O tipo de
 * cada coluna sai do nome dela e da consulta (MIN(competencia) AS primeira também é competência), e a mesma
 * formatação vale na tela, no PDF e nos destaques: competências como "set/2025", códigos sem separador de
 * milhar, reais com duas casas, percentuais com uma.
 */
import { numero, reais, reaisExato } from './format';
import { local, t } from './idioma';

export type Valor = string | number | boolean | null;
export type Tabela = { colunas: string[]; linhas: Valor[][]; total: number };
export type Formato = 'inteiro' | 'decimal' | 'reais' | 'percentual';

/** SQL sem textos entre aspas e sem comentários, em minúsculas: o que sobra é estrutura. */
export const sqlSemTextos = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').toLowerCase();

/** "1 linha", "2 linhas" (o número no formato do idioma). */
export const contar = (n: number, um: string, varios: string) => `${n.toLocaleString(local())} ${n === 1 ? um : varios}`;

// ---------------- anos e competências (AAAAMM) ----------------

const MESES = () => t('jan fev mar abr mai jun jul ago set out nov dez', 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec').split(' ');
const MES_POR_NOME: Record<string, number> = {
  jan: 1, fev: 2, feb: 2, mar: 3, abr: 4, apr: 4, mai: 5, may: 5, jun: 6, jul: 7,
  ago: 8, aug: 8, set: 9, sep: 9, out: 10, oct: 10, nov: 11, dez: 12, dec: 12,
};

/** AAAAMM com mês válido, de 1990 a 2099. */
export const ehCompetencia = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 199001 && v <= 209912 && v % 100 >= 1 && v % 100 <= 12;
const ehAno = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1900 && v <= 2100;

/** 202509 → "set/2025" (em inglês, "Sep 2025"). */
export function rotuloCompetencia(aaaamm: number): string {
  const mes = MESES()[(aaaamm % 100) - 1];
  const ano = Math.floor(aaaamm / 100);
  return t(`${mes}/${ano}`, `${mes} ${ano}`);
}

/** Meses de uma competência a outra, contando as duas (202501 a 202512 = 12). */
const mesesEntre = (de: number, ate: number) => (Math.floor(ate / 100) - Math.floor(de / 100)) * 12 + (ate % 100) - (de % 100) + 1;
/** Competência deslocada em n meses (202601 − 1 = 202512). */
const somarMeses = (aaaamm: number, n: number) => {
  const k = Math.floor(aaaamm / 100) * 12 + (aaaamm % 100) - 1 + n;
  return Math.floor(k / 12) * 100 + (k % 12) + 1;
};

/** Período de anos ou de competências (AAAAMM), com as duas pontas incluídas. */
export type Periodo = { tipo: 'ano' | 'mes'; de: number; ate: number };

/** Um marco escrito pelo modelo: ano ("2025") ou competência ("2025-09", "202509", "09/2025", "set/2025"). */
export function lerMarco(s: string): { tipo: 'ano' | 'mes'; valor: number } | null {
  const x = s.trim().toLowerCase();
  let m = /^(\d{4})$/.exec(x);
  if (m && ehAno(Number(m[1]))) return { tipo: 'ano', valor: Number(m[1]) };
  m = /^(\d{4})-?(\d{2})$/.exec(x);
  if (m && ehCompetencia(Number(m[1]) * 100 + Number(m[2]))) return { tipo: 'mes', valor: Number(m[1]) * 100 + Number(m[2]) };
  m = /^(\d{1,2})\/(\d{4})$/.exec(x);
  if (m && ehCompetencia(Number(m[2]) * 100 + Number(m[1]))) return { tipo: 'mes', valor: Number(m[2]) * 100 + Number(m[1]) };
  m = /^([a-zç]{3})[a-zç]*\.?[/ -](\d{4})$/.exec(x);
  if (m && MES_POR_NOME[m[1]]) return { tipo: 'mes', valor: Number(m[2]) * 100 + MES_POR_NOME[m[1]] };
  return null;
}

/** Período de um destaque (campos de e ate da resposta); null se faltarem ou não forem do mesmo tipo. */
export function periodoDe(de: string, ate: string): Periodo | null {
  const a = lerMarco(de || ate);
  const b = lerMarco(ate || de);
  if (!a || !b || a.tipo !== b.tipo) return null;
  return { tipo: a.tipo, de: Math.min(a.valor, b.valor), ate: Math.max(a.valor, b.valor) };
}

/**
 * "2025"; "2015–2025"; "set/2025"; "ano de 2025 (jan–dez)"; "jan–set/2025 (acumulado no ano)";
 * "out/2024–set/2025 (últimos 12 meses)" quando termina na última competência disponível, "(12 meses)" se não.
 */
export function rotuloPeriodo(p: Periodo, ultimaCompetencia?: number | null): string {
  if (p.tipo === 'ano') return p.de === p.ate ? String(p.de) : `${p.de}–${p.ate}`;
  if (p.de === p.ate) return rotuloCompetencia(p.de);
  const [a1, m1, a2, m2] = [Math.floor(p.de / 100), p.de % 100, Math.floor(p.ate / 100), p.ate % 100];
  if (a1 === a2 && m1 === 1 && m2 === 12) return t(`ano de ${a1} (jan–dez)`, `year ${a1} (Jan–Dec)`);
  if (a1 === a2 && m1 === 1) return t(`jan–${MESES()[m2 - 1]}/${a1} (acumulado no ano)`, `Jan–${MESES()[m2 - 1]} ${a1} (year to date)`);
  const intervalo = `${rotuloCompetencia(p.de)}–${rotuloCompetencia(p.ate)}`;
  if (mesesEntre(p.de, p.ate) === 12) {
    return p.ate === ultimaCompetencia ? t(`${intervalo} (últimos 12 meses)`, `${intervalo} (last 12 months)`) : t(`${intervalo} (12 meses)`, `${intervalo} (12 months)`);
  }
  return intervalo;
}

/**
 * Colunas do resultado que são anos ou competências pela expressão do SELECT, quando o nome não diz
 * ("MIN(c.competencia) AS de_competencia", "max(ano) AS ultimo"). Só expressões que são a coluna de tempo
 * inteira (ou MIN/MAX dela); "LAG(x) OVER (ORDER BY ano) AS anterior" não conta.
 */
export function tempoNoSql(sql: string): Map<string, 'ano' | 'mes'> {
  const r = new Map<string, 'ano' | 'mes'>();
  const re = /(?:\bselect\s+(?:distinct\s+)?|,\s*)(?:(?:min|max|any_value|first|last|arbitrary)\s*\(\s*)?(?:\w+\.)?(competencia|ano|exercicio)\s*\)?\s+as\s+"?([a-z_][a-z0-9_]*)"?/gi;
  for (const m of sqlSemTextos(sql).matchAll(re)) r.set(m[2], m[1] === 'competencia' ? 'mes' : 'ano');
  return r;
}

// ---------------- tipo e formato das colunas ----------------

export type TipoColuna = 'competencia' | 'ano' | 'codigo' | 'percentual' | 'reais' | 'contagem' | 'numero' | 'texto';

const RE_ANO = /^(ano|exercicio)(_[a-z0-9_]+)?$|^[a-z0-9_]+_(ano|exercicio)$/i;
const RE_CODIGO = /^(cod|codigo|id)(_\w+)?$|^\w+_(cod|codigo|id)$|^(cod_ibge|municipio|municipio_trab|uf|cbo(_\w+)?|cnae(_\w+)?|divisao|classe|subclasse|secao|grupo|natureza_juridica(_\w+)?|ibge_subsetor)$/i;
const RE_PERCENTUAL = /(^|_)(pct|perc|percent|percentual|participacao|proporcao|taxa|share)(_|$)|%/i;
const RE_CONTAGEM_EXPLICITA = /^(n|qtd|num|numero|quantidade)_|_n$/i;
const RE_REAIS = /(^|_)(rem|remuneracao|salario|salarios|massa|valor|valores|receita|receitas|despesa|despesas|renda|rendimento|reais|pib|vab|rcl|dcl|divida|patrimonio|investimentos|deducoes|fpm|icms|ipva|iptu|iss|itbi|transferencias|custo|gasto|gastos|preco)(_|$)|^ativo$/i;
const RE_CONTAGEM = /(^|_)(vinculos|empregos|admissoes|desligamentos|saldo|estabelecimentos|mulheres|homens|municipios|entes|meses|familias|beneficios|aposentadorias|pensoes|afastados|ativos|desligados|pessoas|trabalhadores|linhas|registros|populacao|total|soma)(_|$)/i;

/**
 * Tipo de uma coluna pelo nome (e, para anos e competências, também pelos valores e pela consulta):
 * competência e ano só quando todos os valores são válidos; reais e contagem pelo vocabulário dos painéis.
 */
export function tipoColuna(nome: string, valores: Valor[], tempo?: 'ano' | 'mes'): TipoColuna {
  const nums = valores.filter((v): v is number => typeof v === 'number');
  const presentes = valores.filter((v) => v !== null);
  const todosNumeros = presentes.length > 0 && nums.length === presentes.length;
  if ((tempo === 'mes' || /compet/i.test(nome)) && todosNumeros && nums.every(ehCompetencia)) return 'competencia';
  if ((tempo === 'ano' || RE_ANO.test(nome)) && todosNumeros && nums.every(ehAno)) return 'ano';
  if (RE_CODIGO.test(nome)) return 'codigo';
  if (presentes.length > 0 && !todosNumeros) return 'texto';
  if (RE_PERCENTUAL.test(nome)) return 'percentual';
  if (RE_CONTAGEM_EXPLICITA.test(nome)) return 'contagem';
  if (RE_REAIS.test(nome)) return 'reais';
  if (RE_CONTAGEM.test(nome)) return 'contagem';
  return 'numero';
}

export function formatarCelula(v: Valor | undefined, tipo: TipoColuna): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? t('sim', 'yes') : t('não', 'no');
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return '—';
  const f = (min: number, max: number) => v.toLocaleString(local(), { minimumFractionDigits: min, maximumFractionDigits: max });
  switch (tipo) {
    case 'competencia': return ehCompetencia(v) ? rotuloCompetencia(v) : String(v);
    case 'ano': case 'codigo': return String(v);
    // uma casa em toda a coluna; duas só quando uma casa zeraria um valor que não é zero (0,04)
    case 'percentual': return f(1, Math.round(v * 10) === 0 && v !== 0 ? 2 : 1);
    case 'reais': return f(2, 2);
    case 'contagem': return f(0, Number.isInteger(v) ? 0 : 1);
    default: return f(0, Number.isInteger(v) ? 0 : Math.abs(v) < 1 ? 4 : 2);
  }
}

/** Cabeçalho legível: "salario medio admissao (R$)", "variacao (%)", "primeira (mês)". */
export function rotuloColuna(nome: string, tipo: TipoColuna): string {
  let s = nome.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (tipo === 'percentual' && !s.includes('%')) s = `${s.replace(/\bpct\b/i, '').replace(/\s+/g, ' ').trim()} (%)`.trim();
  if (tipo === 'reais') s += ' (R$)';
  if (tipo === 'competencia' && !/compet/i.test(nome)) s += t(' (mês)', ' (month)');
  return s.startsWith('(') ? s.slice(1, -1) : s;
}

const CATEGORIAS: Record<string, [string, string]> = {
  agropecuaria: ['Agropecuária', 'Agriculture'], industria: ['Indústria', 'Industry'], construcao: ['Construção', 'Construction'],
  comercio: ['Comércio', 'Trade'], servicos: ['Serviços', 'Services'], adm_publica: ['Administração pública', 'Public administration'],
  mulheres: ['Mulheres', 'Women'], homens: ['Homens', 'Men'],
};
const rotuloCategoria = (s: string) => (CATEGORIAS[s] ? t(...CATEGORIAS[s]) : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
const MEDIDAS_PCT = new Set(['pct', 'perc', 'percentual', 'participacao']);

/** Tabela pronta para a tela e o PDF: cabeçalho, células já formatadas e colunas de texto (alinhadas à esquerda). */
export type TabelaFormatada = {
  cabecalho: string[]; linhas: string[][]; texto: boolean[];
  /** Tabela de uma linha só mostrada em linhas (uma por categoria ou por coluna). */
  emLinhas: boolean;
  /** Colunas que ficaram fora das linhas (ex.: o total), como "empregos: 4.731". */
  extras: string[];
};

/**
 * Resultado de uma linha só com muitas colunas (empregos_industria, pct_industria…) em linhas: uma por
 * categoria, com uma coluna por medida; sem esse padrão, uma linha por coluna (indicador, valor).
 */
function emLinhas(r: Tabela, tipos: TipoColuna[]): TabelaFormatada {
  const l = r.linhas[0];
  const porPrefixo = new Map<string, Map<string, number>>();
  r.colunas.forEach((c, j) => {
    const i = c.indexOf('_');
    if (i <= 0 || i === c.length - 1) return;
    const [prefixo, sufixo] = [c.slice(0, i), c.slice(i + 1)];
    if (!porPrefixo.has(prefixo)) porPrefixo.set(prefixo, new Map());
    porPrefixo.get(prefixo)!.set(sufixo, j);
  });
  const medidas = [...porPrefixo].filter(([, s]) => s.size >= 3);
  const contagem = new Map<string, number>();
  for (const [, s] of medidas) for (const sufixo of s.keys()) contagem.set(sufixo, (contagem.get(sufixo) ?? 0) + 1);
  const categorias = [...contagem].filter(([, n]) => n >= Math.min(2, medidas.length)).map(([s]) => s);
  if (medidas.length && categorias.length >= 3) {
    const usadas = new Set<number>();
    const linhas = categorias.map((s) => [rotuloCategoria(s), ...medidas.map(([, m]) => {
      const j = m.get(s);
      if (j === undefined) return '—';
      usadas.add(j);
      return formatarCelula(l[j], tipos[j]);
    })]);
    const cabecalho = [t('categoria', 'category'), ...medidas.map(([p, m]) => (MEDIDAS_PCT.has(p)
      ? t('participação (%)', 'share (%)')
      : rotuloColuna(p, tipos[[...m.values()][0]])))];
    const extras = r.colunas.map((c, j) => (usadas.has(j) ? '' : `${rotuloColuna(c, tipos[j])}: ${formatarCelula(l[j], tipos[j])}`)).filter(Boolean);
    return { cabecalho, linhas, texto: cabecalho.map((_, k) => k === 0), emLinhas: true, extras };
  }
  return {
    cabecalho: [t('indicador', 'indicator'), t('valor', 'value')],
    linhas: r.colunas.map((c, j) => [rotuloColuna(c, tipos[j]), formatarCelula(l[j], tipos[j])]),
    texto: [true, false], emLinhas: true, extras: [],
  };
}

/** Tipos das colunas de um resultado, com as de tempo reconhecidas também pela consulta. */
export function tiposDoResultado(r: Tabela, sql = ''): TipoColuna[] {
  const tempo = tempoNoSql(sql);
  return r.colunas.map((c, j) => tipoColuna(c, r.linhas.map((l) => l[j]), tempo.get(c.toLowerCase())));
}

/** Resultado de consulta formatado; com uma linha só e muitas colunas, vira linhas. */
export function formatarTabela(r: Tabela, sql = '', limite = Infinity): TabelaFormatada {
  const tipos = tiposDoResultado(r, sql);
  if (r.linhas.length === 1 && r.colunas.length > 6) return emLinhas(r, tipos);
  const linhas = r.linhas.slice(0, limite).map((l) => l.map((v, j) => formatarCelula(v, tipos[j])));
  const texto = r.colunas.map((_, j) => tipos[j] === 'texto' && linhas.some((l) => l[j].length > 24));
  return { cabecalho: r.colunas.map((c, j) => rotuloColuna(c, tipos[j])), linhas, texto, emLinhas: false, extras: [] };
}

// ---------------- destaques e textos ----------------

/** Valor de um destaque: reais com duas casas (abreviados a partir de milhão), percentual com uma. */
export function formatarValor(v: number, f: Formato): string {
  if (f === 'reais') return Math.abs(v) >= 1e6 ? reais(v) : reaisExato(v);
  if (f === 'percentual') return `${v.toLocaleString(local(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (f === 'decimal') return v.toLocaleString(local(), { maximumFractionDigits: 2 });
  return numero(v);
}

/** Unidade sem o símbolo que o valor já mostra: "% dos vínculos" → "dos vínculos"; "R$ nominais" → "nominais". */
export function unidadeLimpa(unidade: string, f: Formato): string {
  let s = unidade.trim();
  if (f === 'percentual') s = s.replace(/^%\s*/, '').replace(/^(por cento|percentual|percent|pontos percentuais)$/i, '');
  if (f === 'reais') s = s.replace(/^R\$\s*/i, '').replace(/^(reais|R\$)$/i, '');
  return s.trim();
}

/** "competências de 202509 a 202608" → "competências de set/2025 a ago/2026" (o modelo às vezes escreve o número). */
export function competenciasNoTexto(s: string): string {
  return s.replace(/(compet[eê]ncias?\s+(?:de\s+|entre\s+|desde\s+|em\s+)?)(\d{6})\b(\s*(?:a|e|até|-|–)\s*(\d{6})\b)?/gi,
    (todo: string, antes: string, a: string, resto?: string, b?: string) => {
      const [x, y] = [Number(a), b ? Number(b) : null];
      if (!ehCompetencia(x) || (y !== null && !ehCompetencia(y))) return todo;
      return `${antes}${rotuloCompetencia(x)}${resto && y !== null ? resto.replace(b!, rotuloCompetencia(y)) : ''}`;
    });
}

// ---------------- período consultado ----------------

/**
 * Anos e competências que as consultas leram: valores das colunas de tempo dos resultados e, quando o
 * resultado não traz a coluna de tempo, filtros fixos no SQL (ano = 2025, ano BETWEEN 2015 AND 2025,
 * competencia >= 202509…). Com a coluna no resultado, valem só os períodos que vieram: um ano pedido no
 * filtro e ausente da base (ano IN (2011, 2021) sem 2011) não conta como usado.
 */
export function periodoDasConsultas(consultas: { sql: string; resultado?: Tabela | { erro: string } }[]): { anos: Periodo | null; meses: Periodo | null } {
  const anos: number[] = [];
  const comps: number[] = [];
  const ajuste = (op: string, v: number, mes: boolean) => (op === '>' ? (mes ? somarMeses(v, 1) : v + 1) : op === '<' ? (mes ? somarMeses(v, -1) : v - 1) : v);
  for (const c of consultas) {
    const r = c.resultado;
    if (!r || 'erro' in r) continue;
    const tipos = tiposDoResultado(r, c.sql);
    const doResultado = { ano: [] as number[], mes: [] as number[] };
    const tempo = (k: number) => tipos[k] === 'ano' || tipos[k] === 'competencia';
    // linhas em que só o período tem número (os valores vieram nulos) não são período com dado; um resultado
    // sem outras colunas numéricas (ex.: a lista de anos) vale inteiro
    const valor = (l: Valor[]) => l.some((v, k) => !tempo(k) && typeof v === 'number');
    const comDado = r.linhas.some(valor) ? r.linhas.filter(valor) : r.linhas;
    tipos.forEach((tipo, j) => {
      const vals = comDado.map((l) => l[j]).filter((v): v is number => typeof v === 'number');
      if (tipo === 'ano') doResultado.ano.push(...vals);
      if (tipo === 'competencia') doResultado.mes.push(...vals);
    });
    anos.push(...doResultado.ano);
    comps.push(...doResultado.mes);
    const doFiltro = { ano: [] as number[], mes: [] as number[] };
    const s = sqlSemTextos(c.sql);
    for (const m of s.matchAll(/\b(?:\w+\.)?(ano|exercicio|competencia)\s*(=|>=|<=|>|<)\s*(\d{4}|\d{6})\b/g)) {
      const mes = m[1] === 'competencia';
      if (mes === (m[3].length === 6)) doFiltro[mes ? 'mes' : 'ano'].push(ajuste(m[2], Number(m[3]), mes));
    }
    for (const m of s.matchAll(/\b(?:\w+\.)?(ano|exercicio|competencia)\s+between\s+(\d{4}|\d{6})\s+and\s+(\d{4}|\d{6})\b/g)) {
      doFiltro[m[1] === 'competencia' ? 'mes' : 'ano'].push(Number(m[2]), Number(m[3]));
    }
    for (const m of s.matchAll(/\b(?:\w+\.)?(ano|exercicio|competencia)\s+in\s*\(([\d\s,]+)\)/g)) {
      doFiltro[m[1] === 'competencia' ? 'mes' : 'ano'].push(...m[2].split(',').map((x) => Number(x.trim())));
    }
    if (!doResultado.ano.length) anos.push(...doFiltro.ano);
    if (!doResultado.mes.length) comps.push(...doFiltro.mes);
  }
  const a = anos.filter(ehAno);
  const c = comps.filter(ehCompetencia);
  return {
    anos: a.length ? { tipo: 'ano', de: Math.min(...a), ate: Math.max(...a) } : null,
    meses: c.length ? { tipo: 'mes', de: Math.min(...c), ate: Math.max(...c) } : null,
  };
}
