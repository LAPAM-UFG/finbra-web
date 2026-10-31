/**
 * Verificações que a página roda com uma consulta, quando o modelo as declara (campo verificacao de
 * "consultar"), e cujos números vêm do DuckDB, não do modelo:
 *
 *   chaves   as colunas que identificam uma linha do resultado se repetem? (junção ou agrupamento que duplicou)
 *   juncoes  para cada junção: linhas e chaves distintas de cada lado, cardinalidade (1:1, 1:N, N:1, N:N),
 *            chaves com correspondência e sem correspondência (com exemplos)
 *   amostra  quantas observações sobram a cada filtro (uma contagem por etapa)
 *
 * A revisão devolve ao modelo a resposta que usa uma consulta com chave repetida, junção muitos-para-muitos,
 * registros sem correspondência não mencionados ou junção entre fontes diferentes sem verificação.
 */
import type { Valor } from './ia_formato';
import { t } from './idioma';

export type PedidoJuncao = { rotulo: string; esquerda: string; direita: string; chaves: string[] };
export type PedidoVerificacao = { chaves: string[]; juncoes: PedidoJuncao[]; amostra: { etapa: string; sql: string }[] };

/** Um lado da junção: linhas, chaves distintas (sem as nulas) e linhas com chave nula. */
export type Lado = { linhas: number; distintas: number; nulas: number };
export type Cardinalidade = '1:1' | '1:N' | 'N:1' | 'N:N';
export type JuncaoVerificada = {
  rotulo: string; chaves: string[]; esquerda: Lado; direita: Lado; ambas: number; soEsquerda: number; soDireita: number;
  cardinalidade: Cardinalidade; exemplosEsquerda: string[]; exemplosDireita: string[];
};
export type VerificacaoFeita = {
  /** ausentes: chaves que não estão no resultado (ex.: cod_ibge numa consulta agregada); a chave não é conferida */
  chaves: ({ colunas: string[] } & Lado) | { colunas: string[]; erro: string } | { colunas: string[]; ausentes: string[] } | null;
  juncoes: (JuncaoVerificada | { rotulo: string; chaves: string[]; erro: string })[];
  amostra: ({ etapa: string; n: number } | { etapa: string; erro: string })[];
};

/** Lê SQL somente leitura e devolve as linhas (a página usa consultaLivre). */
export type Leitor = (sql: string) => Promise<{ colunas: string[]; linhas: Valor[][] }>;

const NOME = /^[a-z_][a-z0-9_]*$/i;
const MAX_JUNCOES = 4;
const MAX_ETAPAS = 8;
const MAX_EXEMPLOS = 8;

const textoCurto = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nomes = (v: unknown) => (Array.isArray(v) ? v.map((x) => textoCurto(x, 64)) : []);

/** Campo verificacao de "consultar": null se vazio; texto com o problema se mal formado. */
export function lerVerificacao(v: unknown): PedidoVerificacao | string | null {
  if (v === undefined || v === null || v === '' || typeof v !== 'object') return null;
  const o = v as { chaves?: unknown; juncoes?: unknown; amostra?: unknown };
  const chaves = nomes(o.chaves).filter(Boolean);
  const juncoes = (Array.isArray(o.juncoes) ? o.juncoes : []).map((j) => {
    const x = (j ?? {}) as Record<string, unknown>;
    return { rotulo: textoCurto(x.rotulo, 120), esquerda: textoCurto(x.esquerda, 20_000), direita: textoCurto(x.direita, 20_000), chaves: nomes(x.chaves).filter(Boolean) };
  });
  const amostra = (Array.isArray(o.amostra) ? o.amostra : []).map((e) => {
    const x = (e ?? {}) as Record<string, unknown>;
    return { etapa: textoCurto(x.etapa, 160), sql: textoCurto(x.sql, 20_000) };
  });
  if (!chaves.length && !juncoes.length && !amostra.length) return null;
  if ([...chaves, ...juncoes.flatMap((j) => j.chaves)].some((c) => !NOME.test(c))) return 'verificacao: as chaves são nomes de colunas (letras, números e _)';
  if (juncoes.length > MAX_JUNCOES) return `verificacao aceita até ${MAX_JUNCOES} junções`;
  if (amostra.length > MAX_ETAPAS) return `verificacao aceita até ${MAX_ETAPAS} etapas de amostra`;
  if (juncoes.some((j) => !j.esquerda || !j.direita || !j.chaves.length)) return 'verificacao.juncoes: cada junção precisa de esquerda e direita (SELECT com as colunas-chave) e de chaves';
  if (amostra.some((e) => !e.etapa || !e.sql)) return 'verificacao.amostra: cada etapa precisa de etapa (descrição) e sql (SELECT que devolve uma contagem)';
  return { chaves, juncoes: juncoes.map((j, i) => ({ ...j, rotulo: j.rotulo || `junção ${i + 1}` })), amostra };
}

const aspas = (c: string) => `"${c}"`;
const numero = (v: Valor | undefined) => (typeof v === 'number' ? v : Number(v ?? NaN));
const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Linhas, chaves distintas (sem nulas) e linhas com chave nula de uma consulta. */
async function lado(sql: string, chaves: string[], ler: Leitor): Promise<Lado> {
  const cols = chaves.map(aspas).join(', ');
  const nula = chaves.map((c) => `${aspas(c)} IS NULL`).join(' OR ');
  const r = await ler(`WITH q AS (SELECT ${cols} FROM (${sql}) AS q0) SELECT (SELECT count(*) FROM q) AS linhas, `
    + `(SELECT count(*) FROM (SELECT DISTINCT * FROM q WHERE NOT (${nula}))) AS distintas, (SELECT count(*) FROM q WHERE ${nula}) AS nulas`);
  const l = r.linhas[0] ?? [];
  return { linhas: numero(l[0]), distintas: numero(l[1]), nulas: numero(l[2]) };
}

const repete = (x: Lado) => x.linhas - x.nulas > x.distintas;

/**
 * Roda as verificações pedidas. `validar` confere cada SQL extra (o mesmo filtro das consultas); `nomear`
 * troca códigos de ente por nome nos exemplos ("Sanclerlândia (GO) 5220009").
 */
export async function verificar(sql: string, p: PedidoVerificacao, ler: Leitor, o: {
  validar: (sql: string) => string | null; nomear?: (coluna: string, v: Valor) => string | null;
  /** colunas do resultado: chave fora delas não é conferida (fica registrada como ausente) */
  colunas?: string[];
}): Promise<VerificacaoFeita> {
  const feita: VerificacaoFeita = { chaves: null, juncoes: [], amostra: [] };
  const ausentes = o.colunas ? p.chaves.filter((c) => !o.colunas!.some((x) => x.toLowerCase() === c.toLowerCase())) : [];
  if (ausentes.length) feita.chaves = { colunas: p.chaves, ausentes };
  else if (p.chaves.length) {
    try {
      feita.chaves = { colunas: p.chaves, ...(await lado(sql, p.chaves, ler)) };
    } catch (e) {
      feita.chaves = { colunas: p.chaves, erro: erroDe(e) };
    }
  }
  for (const j of p.juncoes) {
    const recusa = o.validar(j.esquerda) ?? o.validar(j.direita);
    if (recusa) {
      feita.juncoes.push({ rotulo: j.rotulo, chaves: j.chaves, erro: recusa });
      continue;
    }
    try {
      const cols = j.chaves.map(aspas).join(', ');
      const semNula = j.chaves.map((c) => `${aspas(c)} IS NOT NULL`).join(' AND ');
      const base = `WITH a AS (SELECT DISTINCT ${cols} FROM (${j.esquerda}) AS a0 WHERE ${semNula}), b AS (SELECT DISTINCT ${cols} FROM (${j.direita}) AS b0 WHERE ${semNula})`;
      // uma consulta de cada vez: a conexão do DuckDB é uma só
      const esquerda = await lado(j.esquerda, j.chaves, ler);
      const direita = await lado(j.direita, j.chaves, ler);
      const r = await ler(`${base} SELECT (SELECT count(*) FROM a SEMI JOIN b USING (${cols})) AS ambas, (SELECT count(*) FROM a ANTI JOIN b USING (${cols})) AS so_a, (SELECT count(*) FROM b ANTI JOIN a USING (${cols})) AS so_b`);
      const [ambas, soEsquerda, soDireita] = (r.linhas[0] ?? []).map(numero);
      const exemplos = async (de: 'a' | 'b', n: number) => {
        if (!n) return [];
        const x = await ler(`${base} SELECT * FROM ${de} ANTI JOIN ${de === 'a' ? 'b' : 'a'} USING (${cols}) ORDER BY ALL LIMIT ${MAX_EXEMPLOS}`);
        return x.linhas.map((l) => l.map((v, k) => o.nomear?.(x.colunas[k], v) ?? String(v)).join(' / '));
      };
      feita.juncoes.push({
        rotulo: j.rotulo, chaves: j.chaves, esquerda, direita, ambas, soEsquerda, soDireita,
        cardinalidade: `${repete(esquerda) ? 'N' : '1'}:${repete(direita) ? 'N' : '1'}` as Cardinalidade,
        exemplosEsquerda: await exemplos('a', soEsquerda), exemplosDireita: await exemplos('b', soDireita),
      });
    } catch (e) {
      feita.juncoes.push({ rotulo: j.rotulo, chaves: j.chaves, erro: erroDe(e) });
    }
  }
  for (const e of p.amostra) {
    const recusa = o.validar(e.sql);
    if (recusa) {
      feita.amostra.push({ etapa: e.etapa, erro: recusa });
      continue;
    }
    try {
      const r = await ler(e.sql);
      const n = r.linhas.length === 1 ? r.linhas[0].find((v) => typeof v === 'number') : undefined;
      feita.amostra.push(typeof n === 'number' ? { etapa: e.etapa, n } : { etapa: e.etapa, erro: 'a etapa deve devolver uma linha com uma contagem' });
    } catch (err) {
      feita.amostra.push({ etapa: e.etapa, erro: erroDe(err) });
    }
  }
  return feita;
}

// ---------------- fontes juntadas numa consulta ----------------

/** Tabelas de fato por fonte; as de apoio (ipca, entes, faixas, dicionários) não contam. */
const FONTES_DE_FATO: [RegExp, string][] = [
  [/^(indicadores|despesa_funcao)$/, 'DCA'],
  [/^lrf$/, 'RREO/RGF'],
  [/^siope_\w+$/, 'SIOPE'],
  [/^siops_\w+$/, 'SIOPS'],
  [/^trab_caged\w*$/, 'Novo CAGED'],
  [/^(trab_(municipios|setores|setores_uf|grandes_setores)|rais_\w+)$/, 'RAIS'],
  [/^bolsa_familia_\w+$/, 'Bolsa Família'],
  [/^inss_\w+$/, 'INSS'],
];

/** Tabelas de fato lidas pela consulta (depois de FROM e JOIN; textos entre aspas e CTEs não contam). */
export function tabelasDeFato(sql: string): string[] {
  const s = sql.replace(/'(?:[^']|'')*'/g, "''").toLowerCase();
  const tabelas = [...s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
  return [...new Set(tabelas.filter((x) => FONTES_DE_FATO.some(([re]) => re.test(x))))];
}

/** Fontes de fato lidas pela consulta (DCA, RAIS…). */
export function fontesDaConsulta(sql: string): string[] {
  return [...new Set(tabelasDeFato(sql).flatMap((x) => FONTES_DE_FATO.filter(([re]) => re.test(x)).map(([, f]) => f)))];
}

/** A consulta junta tabelas de fato de fontes diferentes (ex.: DCA × RAIS)? */
export const juntaFontes = (sql: string) => /\bjoin\b/i.test(sql.replace(/'(?:[^']|'')*'/g, "''")) && fontesDaConsulta(sql).length > 1;

// ---------------- leitura e revisão ----------------

const fmt = (n: number) => n.toLocaleString('pt-BR');
/** "1 linha", "246 linhas" (o rótulo no idioma da página). */
const qtd = (n: number, um: [string, string], varios: [string, string]) => `${fmt(n)} ${n === 1 ? t(...um) : t(...varios)}`;
const exemplos = (xs: string[], n: number) => (xs.length ? ` (${xs.join('; ')}${n > xs.length ? '; …' : ''})` : '');

/** Linhas legíveis das verificações, para a tela, o PDF e a exportação. */
export function linhasDaVerificacao(v: VerificacaoFeita): string[] {
  const r: string[] = [];
  const c = v.chaves;
  if (c && 'ausentes' in c) r.push(t(`Chave do resultado não conferida: ${c.ausentes.join(', ')} não ${c.ausentes.length > 1 ? 'estão' : 'está'} no resultado (consulta agregada).`, `Result key not checked: ${c.ausentes.join(', ')} not in the result (aggregated query).`));
  else if (c && 'erro' in c) r.push(t(`Chave do resultado (${c.colunas.join(', ')}): verificação falhou (${c.erro}).`, `Result key (${c.colunas.join(', ')}): check failed (${c.erro}).`));
  else if (c) {
    const dup = c.linhas - c.nulas - c.distintas;
    const linhas = qtd(c.linhas, ['linha', 'row'], ['linhas', 'rows']);
    const distintas = qtd(c.distintas, ['combinação distinta', 'distinct combination'], ['combinações distintas', 'distinct combinations']);
    const mais = qtd(dup, ['linha a mais', 'extra row'], ['linhas a mais', 'extra rows']);
    r.push(t(`Chave do resultado (${c.colunas.join(', ')}): ${linhas}, ${distintas} — ${dup > 0 ? `repetida (${mais})` : 'única'}${c.nulas ? `; ${fmt(c.nulas)} com chave nula` : ''}.`,
      `Result key (${c.colunas.join(', ')}): ${linhas}, ${distintas} — ${dup > 0 ? `repeated (${mais})` : 'unique'}${c.nulas ? `; ${fmt(c.nulas)} with null key` : ''}.`));
  }
  for (const j of v.juncoes) {
    if ('erro' in j) {
      r.push(t(`Junção “${j.rotulo}”: verificação falhou (${j.erro}).`, `Join “${j.rotulo}”: check failed (${j.erro}).`));
      continue;
    }
    r.push(t(
      `Junção “${j.rotulo}” por ${j.chaves.join(', ')}: esquerda ${fmt(j.esquerda.linhas)} linhas (${fmt(j.esquerda.distintas)} chaves), direita ${fmt(j.direita.linhas)} (${fmt(j.direita.distintas)}); cardinalidade ${j.cardinalidade}; ${fmt(j.ambas)} chaves com correspondência; `
        + `${fmt(j.soEsquerda)} só na esquerda${exemplos(j.exemplosEsquerda, j.soEsquerda)}; ${fmt(j.soDireita)} só na direita${exemplos(j.exemplosDireita, j.soDireita)}.`,
      `Join “${j.rotulo}” on ${j.chaves.join(', ')}: left ${fmt(j.esquerda.linhas)} rows (${fmt(j.esquerda.distintas)} keys), right ${fmt(j.direita.linhas)} (${fmt(j.direita.distintas)}); cardinality ${j.cardinalidade}; ${fmt(j.ambas)} matched keys; `
        + `${fmt(j.soEsquerda)} only on the left${exemplos(j.exemplosEsquerda, j.soEsquerda)}; ${fmt(j.soDireita)} only on the right${exemplos(j.exemplosDireita, j.soDireita)}.`,
    ));
  }
  if (v.amostra.length) {
    r.push(`${t('Amostra', 'Sample')}: ${v.amostra.map((e) => ('erro' in e ? `${e.etapa}: ${t('falhou', 'failed')} (${e.erro})` : `${e.etapa}: ${fmt(e.n)}`)).join(' → ')}.`);
  }
  return r;
}

/** A resposta diz que houve registros sem correspondência (ou que ficaram de fora)? */
const MENCIONA_SEM_PAR = /sem\s+correspond|sem\s+par\b|n[ãa]o\s+(t[êe]m|tem|tinham?|possu[ei]m?|entregou|entregaram|encontrad|casad|pareads?)|ficaram?\s+de\s+fora|fora\s+da\s+(amostra|jun[çc])|ausentes?\b|sem\s+(dados?|registros?|declara[çc]|DCA|RAIS)|faltam?\b|n[ãa]o\s+correspond/i;

/**
 * Problemas da verificação de uma consulta usada na resposta, para a revisão devolver ao modelo. `texto` é o
 * texto da resposta (conclusão, metodologia, limitações, recorte), onde as perdas da junção precisam aparecer.
 */
export function problemasDaVerificacao(v: VerificacaoFeita, rotulo: string, texto: string): string[] {
  const r: string[] = [];
  // chave fora do resultado e etapa de amostra que falhou ficam só registradas (não mudam os números da resposta)
  const c = v.chaves;
  if (c && 'erro' in c) r.push(`${rotulo}: a verificação da chave (${c.colunas.join(', ')}) falhou: ${c.erro}. Use nomes de colunas do resultado.`);
  else if (c && 'linhas' in c && c.linhas - c.nulas > c.distintas) {
    r.push(`${rotulo}: a chave (${c.colunas.join(', ')}) se repete (${c.linhas} linhas, ${c.distintas} combinações distintas): a junção ou o agrupamento duplicou linhas. Corrija a consulta antes de usar os números.`);
  }
  for (const j of v.juncoes) {
    if ('erro' in j) {
      r.push(`${rotulo}, junção "${j.rotulo}": a verificação falhou (${j.erro}). Esquerda e direita são SELECTs que devolvem as colunas-chave com os mesmos nomes.`);
      continue;
    }
    if (j.cardinalidade === 'N:N') {
      r.push(`${rotulo}, junção "${j.rotulo}": as chaves (${j.chaves.join(', ')}) se repetem dos dois lados (muitos-para-muitos), o que multiplica linhas. Agregue um dos lados antes de juntar.`);
    }
    if ((j.soEsquerda || j.soDireita) && !MENCIONA_SEM_PAR.test(texto)) {
      r.push(`${rotulo}, junção "${j.rotulo}": ${j.soEsquerda} chaves só na esquerda${exemplos(j.exemplosEsquerda.slice(0, 3), j.soEsquerda)} e ${j.soDireita} só na direita ficaram sem correspondência. Diga na metodologia ou nas limitações quantas ficaram de fora e o que isso muda na amostra.`);
    }
  }
  return r;
}
