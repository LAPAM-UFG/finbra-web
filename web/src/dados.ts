/**
 * Camada de dados do site: roda DuckDB no navegador (WebAssembly) e consulta os Parquet
 * publicados em /dados/ (R2 em produção, a pasta data/ no desenvolvimento). Só os trechos
 * necessários de cada arquivo são baixados, por requisições HTTP com Range.
 *
 * Cada rota devolve o mesmo formato da antiga API em Node, para as páginas não mudarem.
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import { t } from './idioma';

type Valor = string | number | boolean | null;
export type Linha = Record<string, Valor>;
type Params = Record<string, string | number | null | undefined>;

type Manifesto = { gerado_em: string; anos: number[]; base_ipca: number; colunas: Record<string, Record<string, string[]>> };

const BASE = new URL(import.meta.env.VITE_DADOS_URL ?? '/dados/', location.href).href;

// ---------------- motor ----------------

let pronto: Promise<{ con: duckdb.AsyncDuckDBConnection; manifesto: Manifesto }> | null = null;
let db: duckdb.AsyncDuckDB;

/**
 * Arquivos pequenos e muito consultados: baixados uma vez, inteiros e em paralelo, e carregados
 * na memória do DuckDB. Consultas sobre eles não fazem mais nenhuma requisição.
 */
const TABELAS_EM_MEMORIA: Record<string, string> = {
  entes: 'silver/entes.parquet',
  indicadores: 'gold/indicadores.parquet',
  escopos: 'gold/escopos.parquet',
  alertas: 'gold/alertas.parquet',
  faixas: 'gold/faixas.parquet',
  ipca: 'gold/ipca.parquet',
};

async function baixar(caminho: string): Promise<Uint8Array> {
  const r = await fetch(url(caminho));
  if (!r.ok) throw new Error(`${caminho} ${t('indisponível', 'unavailable')} (${r.status})`);
  return new Uint8Array(await r.arrayBuffer());
}

function iniciar() {
  pronto ??= (async () => {
    const manifesto: Manifesto = await fetch(`${BASE}gold/manifesto.json`, { cache: 'no-cache' }).then((r) => {
      if (!r.ok) throw new Error(`${t('manifesto indisponível', 'manifest unavailable')} (${r.status})`);
      return r.json();
    });
    versao = manifesto.gerado_em.replace(/[^0-9]/g, '');
    const arquivos = Promise.all(
      Object.entries(TABELAS_EM_MEMORIA).map(async ([nome, caminho]) => [nome, await baixar(caminho)] as const),
    );
    // o .wasm (~33 MB) vem da CDN jsDelivr, na mesma versão do pacote npm
    const pacote = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const urlWorker = URL.createObjectURL(
      new Blob([`importScripts("${pacote.mainWorker}");`], { type: 'text/javascript' }),
    );
    db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), new Worker(urlWorker));
    await db.instantiate(pacote.mainModule, pacote.pthreadWorker);
    URL.revokeObjectURL(urlWorker);
    // Só leituras parciais (Range). Nesta versão o DuckDB-WASM vem com forceFullHTTPReads ligado,
    // o que baixa cada arquivo inteiro (centenas de MB numa série histórica).
    await db.open({
      query: { castBigIntToDouble: true },
      filesystem: { forceFullHTTPReads: false, reliableHeadRequests: true, allowFullHTTPReads: false },
    });
    const con = await db.connect();
    for (const [nome, dados] of await arquivos) {
      await db.registerFileBuffer(`${nome}.parquet`, dados);
      await con.query(`CREATE TABLE ${nome} AS SELECT * FROM read_parquet('${nome}.parquet')`);
    }
    return { con, manifesto };
  })();
  pronto.catch(() => (pronto = null));
  return pronto;
}

/**
 * URL de um arquivo de dados com a versão do manifesto no caminho (/dados/v/<versão>/...), para o
 * cache se renovar a cada atualização. Não pode ser "?v=": para o DuckDB, "?" é curinga de glob.
 */
let versao = '';
const url = (caminho: string) => `${BASE}v/${versao}/${caminho}`;
const arq = (caminho: string) => `'${url(caminho)}'`;
// Cada consulta lê um único arquivo: o navegador faz uma requisição por vez ao R2, então
// abrir vários arquivos (um por ano) tornava a série histórica lenta.
const entesDaUf = (uf: string) => arq(`gold/entes/uf=${uf}.parquet`);
const arvore = () => arq('gold/arvore.parquet');

/** Plano de contas de um exercício (~100 KB): baixado uma vez e mantido em memória. */
const contasCarregadas = new Map<number, Promise<string>>();
function contasAno(ano: number): Promise<string> {
  if (!contasCarregadas.has(ano)) {
    const p = (async () => {
      const { con } = await iniciar();
      const nome = `contas_${ano}`;
      await db.registerFileBuffer(`${nome}.parquet`, await baixar(`silver/contas/exercicio=${ano}.parquet`));
      await con.query(`CREATE TABLE ${nome} AS SELECT * FROM read_parquet('${nome}.parquet')`);
      return nome;
    })();
    p.catch(() => contasCarregadas.delete(ano));
    contasCarregadas.set(ano, p);
  }
  return contasCarregadas.get(ano)!;
}

const normalizar = (v: unknown): Valor => (typeof v === 'bigint' ? Number(v) : (v as Valor));

/** SQL com parâmetros nomeados ($nome), executado como consulta preparada. */
async function consultar(sql: string, params: Record<string, Valor> = {}): Promise<Linha[]> {
  const { con } = await iniciar();
  const args: Valor[] = [];
  const texto = sql.replace(/\$([a-z_]+)/gi, (_, nome: string) => {
    if (!(nome in params)) throw new Error(`parâmetro ausente: ${nome}`);
    args.push(params[nome]);
    return '?';
  });
  const stmt = await con.prepare(texto);
  try {
    const r = await stmt.query(...args);
    return r.toArray().map((l) => {
      const o = l.toJSON() as Record<string, unknown>;
      return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, normalizar(v)]));
    });
  } finally {
    await stmt.close();
  }
}

// ---------------- escopo (ente, UF ou Brasil) ----------------

const UFS = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));
const ESFERAS = new Set(['M', 'E', 'D']);
const inteiro = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number.parseInt(String(v), 10));

type Escopo =
  | { tipo: 'ente'; ente: number; uf: string; esfera: string }
  | { tipo: 'grupo'; escopo: string; esfera: string };
type Comparador = { escopo: string; esfera: string; rotulo: string } | null;

async function escopoDe(q: Params): Promise<Escopo> {
  const ente = inteiro(q.ente);
  if (ente) {
    const [e] = await consultar('SELECT uf, esfera FROM entes WHERE cod_ibge = $ente::INTEGER', { ente });
    if (e) return { tipo: 'ente', ente, uf: String(e.uf), esfera: String(e.esfera) };
  }
  const esfera = ESFERAS.has(String(q.esfera)) ? String(q.esfera) : 'M';
  const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
  return { tipo: 'grupo', escopo: uf ?? 'BR', esfera };
}

/** Ente → municípios da sua UF (ou todos os estados); UF → Brasil; Brasil → nenhum. */
function comparadorDe(e: Escopo): Comparador {
  if (e.tipo === 'ente') {
    return e.esfera === 'M' ? { escopo: e.uf, esfera: 'M', rotulo: e.uf } : { escopo: 'BR', esfera: e.esfera, rotulo: 'Estados' };
  }
  return e.escopo !== 'BR' ? { escopo: 'BR', esfera: e.esfera, rotulo: 'Brasil' } : null;
}

/** Filtro sobre a tabela indicadores (agregados deixam de fora os ente-anos atípicos). */
function filtroIndicadores(e: Escopo, params: Record<string, Valor>) {
  if (e.tipo === 'ente') {
    params.ente = e.ente;
    return 'cod_ibge = $ente::INTEGER';
  }
  params.esfera = e.esfera;
  let sql = `esfera = $esfera AND NOT EXISTS (SELECT 1 FROM alertas a
              WHERE a.exercicio = indicadores.exercicio AND a.cod_ibge = indicadores.cod_ibge)`;
  if (e.escopo !== 'BR') {
    params.uf = e.escopo;
    sql += ' AND uf = $uf';
  }
  return sql;
}

// ---------------- rotas ----------------

const CAMPOS = new Set([
  'receita_bruta', 'deducoes', 'receita_liquida', 'receita_corrente', 'receita_capital',
  'receita_impostos_taxas', 'transferencias_correntes', 'fpm', 'icms', 'ipva', 'iptu', 'iss', 'itbi',
  'despesa_empenhada', 'despesa_liquidada', 'despesa_paga', 'despesa_pessoal', 'investimentos',
  'despesa_saude', 'despesa_educacao', 'ativo', 'patrimonio_liquido', 'pib', 'vab_agropecuaria',
  'vab_industria', 'vab_servicos', 'vab_adm_publica', 'bolsa_familia_familias', 'bolsa_familia_valor',
  'inss_beneficios', 'inss_aposentadorias', 'area_km2',
]);
const NAO_MONETARIOS = new Set(['bolsa_familia_familias', 'inss_beneficios', 'inss_aposentadorias', 'area_km2']);
const DIMENSOES = new Set(['exercicio', 'uf', 'regiao', 'faixa_grupo', 'cod_ibge']);

const rotas: Record<string, (q: Params) => Promise<unknown>> = {
  async meta() {
    const { manifesto } = await iniciar();
    const ultimo = String(manifesto.anos.at(-1));
    return { anos: manifesto.anos, anexos: manifesto.colunas[ultimo] ?? {}, baseIpca: manifesto.base_ipca };
  },

  async colunas(q) {
    const { manifesto } = await iniciar();
    return manifesto.colunas[String(inteiro(q.ano))]?.[String(q.anexo)] ?? [];
  },

  entes: () => consultar('SELECT cod_ibge, nome, uf, esfera, capital FROM entes ORDER BY esfera DESC, uf, nome'),

  async contas(q) {
    await iniciar();
    const ano = inteiro(q.ano)!;
    return consultar(
      `SELECT chave, chave_pai, nivel, descricao, tipo FROM ${await contasAno(ano)}
       WHERE anexo = $anexo AND (tipo = 'total' OR nivel <= $nivel) ORDER BY ordem`,
      { anexo: String(q.anexo), nivel: inteiro(q.nivel_max) ?? 3 },
    );
  },

  async arvore(q) {
    await iniciar();
    const ano = inteiro(q.ano)!;
    const e = await escopoDe(q);
    const comp = comparadorDe(e);
    const p: Record<string, Valor> = { anexo: String(q.anexo), coluna: String(q.coluna) };
    let valores: string;
    if (e.tipo === 'ente') {
      Object.assign(p, { ente: e.ente, ano });
      valores = `SELECT chave, sum(valor) AS valor, bool_or(sintetico) AS sintetico FROM read_parquet(${entesDaUf(e.uf)})
                 WHERE cod_ibge = $ente::INTEGER AND exercicio = $ano::SMALLINT AND anexo = $anexo AND coluna = $coluna
                 GROUP BY chave`;
    } else {
      Object.assign(p, { escopo: e.escopo, esfera: e.esfera, ano });
      valores = `SELECT chave, valor, NULL::BOOLEAN AS sintetico FROM read_parquet(${arvore()})
                 WHERE escopo = $escopo AND esfera = $esfera AND anexo = $anexo AND coluna = $coluna
                   AND exercicio = $ano::SMALLINT`;
    }
    let comparacao = 'SELECT NULL::VARCHAR AS chave, NULL::DOUBLE AS valor WHERE false';
    if (comp) {
      Object.assign(p, { cescopo: comp.escopo, cesfera: comp.esfera, cano: ano });
      comparacao = `SELECT chave, valor FROM read_parquet(${arvore()})
                    WHERE escopo = $cescopo AND esfera = $cesfera AND anexo = $anexo AND coluna = $coluna
                      AND exercicio = $cano::SMALLINT`;
    }
    const nos = await consultar(
      `WITH v AS (${valores}), comp AS (${comparacao})
       SELECT c.chave, c.chave_pai, c.nivel, c.descricao, c.tipo, v.valor, comp.valor AS valor_comp, v.sintetico
       FROM ${await contasAno(ano)} c LEFT JOIN v USING (chave) LEFT JOIN comp USING (chave)
       WHERE c.anexo = $anexo AND (v.valor IS NOT NULL OR comp.valor IS NOT NULL)
       ORDER BY c.ordem`,
      p,
    );
    const pop = await populacao(ano, e);
    const popComp = comp ? (await populacao(ano, { tipo: 'grupo', ...comp })).populacao : null;
    return { nos, populacao: pop.populacao, entes: pop.entes, populacao_comp: popComp, comparador: comp?.rotulo ?? null };
  },

  async serie(q) {
    const { manifesto } = await iniciar();
    const e = await escopoDe(q);
    const p: Record<string, Valor> = {
      anexo: String(q.anexo), coluna: String(q.coluna), chave: String(q.chave), base: manifesto.base_ipca,
    };
    let valores: string;
    let pop: string;
    if (e.tipo === 'ente') {
      p.ente = e.ente;
      valores = `SELECT exercicio, sum(valor) AS valor FROM read_parquet(${entesDaUf(e.uf)})
                 WHERE cod_ibge = $ente::INTEGER AND anexo = $anexo AND coluna = $coluna AND chave = $chave GROUP BY ALL`;
      pop = `SELECT exercicio, populacao::DOUBLE AS populacao, 1 AS entes FROM indicadores WHERE cod_ibge = $ente::INTEGER`;
    } else {
      Object.assign(p, { escopo: e.escopo, esfera: e.esfera });
      valores = `SELECT exercicio, valor FROM read_parquet(${arvore()})
                 WHERE escopo = $escopo AND esfera = $esfera AND anexo = $anexo AND coluna = $coluna AND chave = $chave`;
      pop = `SELECT exercicio, populacao::DOUBLE AS populacao, entes FROM escopos WHERE escopo = $escopo AND esfera = $esfera`;
    }
    return consultar(
      `WITH v AS (${valores}), pop AS (${pop})
       SELECT pop.exercicio AS ano, v.valor, v.valor * b.indice / i.indice AS valor_real, pop.populacao, pop.entes
       FROM pop LEFT JOIN v USING (exercicio) LEFT JOIN ipca i USING (exercicio)
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       ORDER BY ano`,
      p,
    );
  },

  async agregado(q) {
    const { manifesto } = await iniciar();
    const campos = String(q.campos ?? '').split(',').filter((c) => CAMPOS.has(c));
    const por = String(q.por ?? 'exercicio').split(',').filter((d) => DIMENSOES.has(d));
    if (!campos.length || !por.length) return [];
    const p: Record<string, Valor> = { base: manifesto.base_ipca };
    const filtros = [filtroIndicadores(await escopoDe(q), p)];
    if (inteiro(q.ano)) { filtros.push('exercicio = $ano'); p.ano = inteiro(q.ano); }
    if (inteiro(q.faixa)) { filtros.push('faixa_grupo = $faixa'); p.faixa = inteiro(q.faixa); }
    const somas = campos.flatMap((c) =>
      NAO_MONETARIOS.has(c) ? [`sum(${c}) AS ${c}`] : [`sum(${c}) AS ${c}`, `sum(${c} * b.indice / i.indice) AS ${c}_real`],
    );
    const extras = por.includes('cod_ibge') ? ', any_value(nome) AS nome, any_value(uf) AS uf_ente' : '';
    return consultar(
      `SELECT ${por.join(', ')}, ${somas.join(', ')}, sum(populacao)::DOUBLE AS populacao, count(*)::INTEGER AS entes${extras}
       FROM indicadores LEFT JOIN ipca i USING (exercicio)
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       WHERE ${filtros.join(' AND ')}
       GROUP BY ${por.join(', ')} ORDER BY ${por.join(', ')}`,
      p,
    );
  },

  async ranking(q) {
    const campo = CAMPOS.has(String(q.campo)) ? String(q.campo) : 'receita_bruta';
    const limite = Math.min(inteiro(q.limite) ?? 20, 100);
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const filtro = filtroIndicadores(await escopoDe({ ...q, ente: undefined }), p);
    const expr = q.per_capita === '1' || q.per_capita === 1 ? `${campo} / nullif(populacao, 0)` : campo;
    return consultar(
      `SELECT cod_ibge, nome, uf, populacao::DOUBLE AS populacao, ${campo} AS valor, ${expr} AS indicador
       FROM indicadores WHERE exercicio = $ano AND ${filtro} AND ${campo} IS NOT NULL
       ORDER BY indicador ${q.ordem === 'asc' ? 'ASC' : 'DESC'} LIMIT ${limite}`,
      p,
    );
  },

  faixas: () => consultar('SELECT * FROM faixas ORDER BY grupo'),

  async ipca() {
    const { manifesto } = await iniciar();
    return consultar(
      `SELECT i.exercicio AS ano, i.ipca_pct, i.completo, b.indice / i.indice AS fator
       FROM ipca i CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       WHERE i.exercicio >= 2013 ORDER BY 1`,
      { base: manifesto.base_ipca },
    );
  },

  async alertas(q) {
    const ente = inteiro(q.ente);
    return consultar(
      `SELECT exercicio, cod_ibge, nome, uf, esfera, indicador, valor, mediana, razao, motivo FROM alertas
       ${ente ? 'WHERE cod_ibge = $ente::INTEGER' : ''} ORDER BY exercicio DESC, razao DESC NULLS LAST`,
      ente ? { ente } : {},
    );
  },

  async validacao() {
    await iniciar();
    await db.registerFileBuffer('validacao.csv', await baixar('gold/validacao.csv'));
    return consultar(`SELECT * FROM read_csv('validacao.csv')`);
  },
};

async function populacao(ano: number, e: Escopo) {
  const [r] =
    e.tipo === 'ente'
      ? await consultar('SELECT populacao::DOUBLE AS populacao, 1 AS entes FROM indicadores WHERE exercicio = $ano AND cod_ibge = $ente::INTEGER', { ano, ente: e.ente })
      : await consultar('SELECT populacao::DOUBLE AS populacao, entes FROM escopos WHERE exercicio = $ano AND escopo = $escopo AND esfera = $esfera', { ano, escopo: e.escopo, esfera: e.esfera });
  return { populacao: (r?.populacao as number) ?? null, entes: (r?.entes as number) ?? 0 };
}

export async function executar(caminho: string, params: Params): Promise<unknown> {
  const rota = rotas[caminho];
  if (!rota) throw new Error(`rota desconhecida: ${caminho}`);
  return rota(params);
}
