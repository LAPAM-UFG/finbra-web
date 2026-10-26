/**
 * Camada de dados do site: roda DuckDB no navegador (WebAssembly) e consulta os Parquet
 * publicados em /dados/ (R2 em produção, a pasta data/ no desenvolvimento). Só os trechos
 * necessários de cada arquivo são baixados, por requisições HTTP com Range.
 *
 * Cada rota devolve o mesmo formato da antiga API em Node, para as páginas não mudarem.
 *
 * Tratamento dos agregados (parâmetro `tratamento`):
 *   'filtrado' (o que o site usa)  sem as inconsistências objetivas e erros confirmados (alertas com
 *                                  exclui = true), só no domínio do alerta. Suspeitas estatísticas ficam.
 *   'declarado'                    todas as declarações com dados no domínio (usado para medir impacto).
 * Em ambos, numerador e população usam o mesmo conjunto de entes (os que têm o dado).
 */
import * as duckdb from '@duckdb/duckdb-wasm';
import { t } from './idioma';

type Valor = string | number | boolean | null;
export type Linha = Record<string, Valor>;
type Params = Record<string, string | number | null | undefined>;

type Manifesto = {
  gerado_em: string; anos: number[]; base_ipca: number; colunas: Record<string, Record<string, string[]>>;
  ipca_ultimo?: { exercicio: number; meses: number };
  fontes?: Record<string, Record<string, unknown>>;
  mapa_indicadores?: Record<string, Record<string, unknown>[]>;
  politica_alertas?: Record<string, unknown>;
};

const BASE = typeof location === 'undefined' ? '' : new URL(import.meta.env?.VITE_DADOS_URL ?? '/dados/', location.href).href;

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

/**
 * Testes (web/testes/): usa um DuckDB já aberto no Node e lê os arquivos da pasta data/ local, com o
 * mesmo SQL das rotas. No site isto nunca é chamado.
 */
let caminhoLocal: ((caminho: string) => string) | null = null;
let lerLocal: ((caminho: string) => Promise<Uint8Array>) | null = null;
export function usarMotorDeTeste(instancia: duckdb.AsyncDuckDB, con: duckdb.AsyncDuckDBConnection, manifesto: Manifesto,
  resolver: (caminho: string) => string, ler: (caminho: string) => Promise<Uint8Array>) {
  db = instancia;
  caminhoLocal = resolver;
  lerLocal = ler;
  pronto = Promise.resolve({ con, manifesto });
}

async function baixar(caminho: string): Promise<Uint8Array> {
  if (lerLocal) return lerLocal(caminho);
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
const url = (caminho: string) => (caminhoLocal ? caminhoLocal(caminho) : `${BASE}v/${versao}/${caminho}`);
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

/** CSV pequeno do gold, registrado uma vez no DuckDB. */
const csvCarregados = new Map<string, Promise<void>>();
function registrarCsv(nome: string): Promise<void> {
  if (!csvCarregados.has(nome)) {
    const p = (async () => {
      await iniciar();
      await db.registerFileBuffer(nome, await baixar(`gold/${nome}`));
    })();
    p.catch(() => csvCarregados.delete(nome));
    csvCarregados.set(nome, p);
  }
  return csvCarregados.get(nome)!;
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
type Tratamento = 'declarado' | 'filtrado';

/** 'filtrado' (padrão): agregados sem os ente-anos sinalizados no domínio; 'declarado': todas as declarações. */
const tratamentoDe = (q: Params): Tratamento => (q.tratamento === 'declarado' ? 'declarado' : 'filtrado');

async function escopoDe(q: Params): Promise<Escopo> {
  const ente = inteiro(q.ente);
  if (ente) {
    const [e] = await consultar('SELECT uf, esfera FROM entes WHERE cod_ibge = $ente::INTEGER', { ente });
    if (e) return { tipo: 'ente', ente, uf: String(e.uf), esfera: String(e.esfera) };
  }
  const esfera = ESFERAS.has(String(q.esfera)) ? String(q.esfera) : 'M';
  const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
  // UF sem municípios próprios (DF): as contas são do ente Distrito Federal (esfera D)
  if (uf && esfera === 'M') {
    const [d] = await consultar(`SELECT cod_ibge FROM entes WHERE uf = $uf AND esfera = 'D'`, { uf });
    if (d) return { tipo: 'ente', ente: Number(d.cod_ibge), uf, esfera: 'D' };
  }
  return { tipo: 'grupo', escopo: uf ?? 'BR', esfera };
}

/** Ente → municípios da sua UF (ou todos os estados); UF → Brasil; Brasil → nenhum. DF: não há comparador equivalente. */
function comparadorDe(e: Escopo): Comparador {
  if (e.tipo === 'ente') {
    if (e.esfera === 'M') return { escopo: e.uf, esfera: 'M', rotulo: e.uf };
    return e.esfera === 'E' ? { escopo: 'BR', esfera: 'E', rotulo: 'Estados' } : null;
  }
  return e.escopo !== 'BR' ? { escopo: 'BR', esfera: e.esfera, rotulo: 'Brasil' } : null;
}

// ---------------- domínios, validade e exclusões ----------------

type Dominio = 'receita' | 'despesa' | 'patrimonio' | 'externo';
const DOMINIO_CAMPO: Record<string, Dominio> = {};
for (const c of ['receita_bruta', 'deducoes', 'receita_liquida', 'receita_corrente', 'receita_capital', 'receita_impostos_taxas',
  'transferencias_correntes', 'fpm', 'icms', 'ipva', 'iptu', 'iss', 'itbi']) DOMINIO_CAMPO[c] = 'receita';
for (const c of ['despesa_empenhada', 'despesa_liquidada', 'despesa_paga', 'despesa_pessoal', 'investimentos', 'despesa_saude',
  'despesa_educacao', 'despesa_empenhada_sem_intra', 'despesa_liquidada_sem_intra', 'despesa_paga_sem_intra', 'despesa_intra'])
  DOMINIO_CAMPO[c] = 'despesa';
for (const c of ['ativo', 'patrimonio_liquido']) DOMINIO_CAMPO[c] = 'patrimonio';
const dominioCampo = (c: string): Dominio => DOMINIO_CAMPO[c] ?? 'externo';
const DOMINIO_ANEXO: Record<string, Dominio> = { 'I-C': 'receita', 'I-D': 'despesa', 'I-E': 'despesa', 'I-F': 'despesa', 'I-G': 'despesa' };
const dominioAnexo = (anexo: string): Dominio => DOMINIO_ANEXO[anexo] ?? 'patrimonio';

/** O ente tem dados utilizáveis no domínio (DCA com o total do domínio). */
function validoNoDominio(d: Dominio, a: string) {
  if (d === 'receita') return `${a}.receita_bruta > 0`;
  if (d === 'despesa') return `${a}.despesa_empenhada > 0`;
  if (d === 'patrimonio') return `${a}.ativo IS NOT NULL`;
  return 'true';
}
function naoExcluido(d: Dominio, a: string, t: Tratamento) {
  if (t === 'declarado' || (d !== 'receita' && d !== 'despesa')) return 'true';
  return `NOT EXISTS (SELECT 1 FROM alertas x WHERE x.exclui AND x.exercicio = ${a}.exercicio
            AND x.cod_ibge = ${a}.cod_ibge AND x.dominio = '${d}')`;
}
/** Observação elegível para o campo: valor presente, ente com dados no domínio e, na visão filtrada, não excluído. */
function elegivel(campo: string, a: string, t: Tratamento, individual = false) {
  if (individual) return `${a}.${campo} IS NOT NULL`;
  const d = dominioCampo(campo);
  return `(${a}.${campo} IS NOT NULL AND ${validoNoDominio(d, a)} AND ${naoExcluido(d, a, t)})`;
}

/** Recorte do escopo na tabela indicadores. */
function recorte(e: Escopo, a: string, params: Record<string, Valor>) {
  if (e.tipo === 'ente') {
    params.ente = e.ente;
    return `${a}.cod_ibge = $ente::INTEGER`;
  }
  params.esfera = e.esfera;
  if (e.escopo === 'BR') return `${a}.esfera = $esfera`;
  params.uf = e.escopo;
  return `${a}.esfera = $esfera AND ${a}.uf = $uf`;
}

// ---------------- rotas ----------------

const CAMPOS = new Set([...Object.keys(DOMINIO_CAMPO), 'pib', 'vab_agropecuaria', 'vab_industria', 'vab_servicos',
  'vab_adm_publica', 'bolsa_familia_familias', 'bolsa_familia_valor', 'inss_beneficios', 'inss_aposentadorias', 'inss_pensoes']);
const NAO_MONETARIOS = new Set(['bolsa_familia_familias', 'inss_beneficios', 'inss_aposentadorias', 'inss_pensoes']);
const DIMENSOES = new Set(['exercicio', 'uf', 'regiao', 'faixa_grupo', 'cod_ibge']);

const rotas: Record<string, (q: Params) => Promise<unknown>> = {
  async meta() {
    const { manifesto } = await iniciar();
    const ultimo = String(manifesto.anos.at(-1));
    return {
      anos: manifesto.anos, anexos: manifesto.colunas[ultimo] ?? {}, baseIpca: manifesto.base_ipca,
      geradoEm: manifesto.gerado_em, ipcaUltimo: manifesto.ipca_ultimo ?? null, fontes: manifesto.fontes ?? {},
      mapaIndicadores: manifesto.mapa_indicadores ?? {}, politica: manifesto.politica_alertas ?? {},
    };
  },

  async colunas(q) {
    const { manifesto } = await iniciar();
    return manifesto.colunas[String(inteiro(q.ano))]?.[String(q.anexo)] ?? [];
  },

  // A União e entes sem nenhuma declaração (Brasília: as contas são do DF) ficam fora da busca
  entes: () => consultar(
    `SELECT e.cod_ibge, e.nome, e.uf, e.esfera, e.capital
     FROM entes e WHERE e.esfera <> 'U' AND EXISTS (SELECT 1 FROM indicadores i WHERE i.cod_ibge = e.cod_ibge)
     ORDER BY e.esfera DESC, e.uf, e.nome`,
  ),

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
    const trat = tratamentoDe(q);
    const comp = comparadorDe(e);
    const anexo = String(q.anexo);
    const p: Record<string, Valor> = { anexo, coluna: String(q.coluna), trat };
    let valores: string;
    if (e.tipo === 'ente') {
      Object.assign(p, { ente: e.ente, ano });
      valores = `SELECT chave, sum(valor) AS valor, bool_or(sintetico) AS sintetico FROM read_parquet(${entesDaUf(e.uf)})
                 WHERE cod_ibge = $ente::INTEGER AND exercicio = $ano::SMALLINT AND anexo = $anexo AND coluna = $coluna
                 GROUP BY chave`;
    } else {
      Object.assign(p, { escopo: e.escopo, esfera: e.esfera, ano });
      valores = `SELECT chave, valor, NULL::BOOLEAN AS sintetico FROM read_parquet(${arvore()})
                 WHERE escopo = $escopo AND esfera = $esfera AND tratamento = $trat AND anexo = $anexo
                   AND coluna = $coluna AND exercicio = $ano::SMALLINT`;
    }
    let comparacao = 'SELECT NULL::VARCHAR AS chave, NULL::DOUBLE AS valor WHERE false';
    if (comp) {
      Object.assign(p, { cescopo: comp.escopo, cesfera: comp.esfera, cano: ano });
      comparacao = `SELECT chave, valor FROM read_parquet(${arvore()})
                    WHERE escopo = $cescopo AND esfera = $cesfera AND tratamento = $trat AND anexo = $anexo
                      AND coluna = $coluna AND exercicio = $cano::SMALLINT`;
    }
    const nos = await consultar(
      `WITH v AS (${valores}), comp AS (${comparacao})
       SELECT c.chave, c.chave_pai, c.nivel, c.descricao, c.tipo, v.valor, comp.valor AS valor_comp, v.sintetico
       FROM ${await contasAno(ano)} c LEFT JOIN v USING (chave) LEFT JOIN comp USING (chave)
       WHERE c.anexo = $anexo AND (v.valor IS NOT NULL OR comp.valor IS NOT NULL)
       ORDER BY c.ordem`,
      p,
    );
    const dominio = dominioAnexo(anexo);
    const pop = await populacao(ano, e, dominio, trat);
    const popComp = comp ? (await populacao(ano, { tipo: 'grupo', ...comp }, dominio, trat)).populacao : null;
    return { nos, populacao: pop.populacao, entes: pop.entes, populacao_comp: popComp, comparador: comp?.rotulo ?? null };
  },

  async serie(q) {
    const { manifesto } = await iniciar();
    const e = await escopoDe(q);
    const trat = tratamentoDe(q);
    const dominio = dominioAnexo(String(q.anexo));
    const p: Record<string, Valor> = {
      anexo: String(q.anexo), coluna: String(q.coluna), chave: String(q.chave), base: manifesto.base_ipca,
    };
    let valores: string;
    let pop: string;
    if (e.tipo === 'ente') {
      p.ente = e.ente;
      valores = `SELECT exercicio, sum(valor) AS valor FROM read_parquet(${entesDaUf(e.uf)})
                 WHERE cod_ibge = $ente::INTEGER AND anexo = $anexo AND coluna = $coluna AND chave = $chave GROUP BY ALL`;
      pop = `SELECT exercicio, populacao::DOUBLE AS populacao, 1 AS entes, NULL::INTEGER AS esperados, 0 AS excluidos
             FROM indicadores WHERE cod_ibge = $ente::INTEGER`;
    } else {
      Object.assign(p, { escopo: e.escopo, esfera: e.esfera, trat, dominio });
      valores = `SELECT exercicio, valor FROM read_parquet(${arvore()})
                 WHERE escopo = $escopo AND esfera = $esfera AND tratamento = $trat AND anexo = $anexo
                   AND coluna = $coluna AND chave = $chave`;
      pop = `SELECT exercicio, populacao::DOUBLE AS populacao, entes, esperados, excluidos FROM escopos
             WHERE escopo = $escopo AND esfera = $esfera AND dominio = $dominio AND tratamento = $trat`;
    }
    return consultar(
      `WITH v AS (${valores}), pop AS (${pop})
       SELECT pop.exercicio AS ano, v.valor, v.valor * b.indice / i.indice AS valor_real,
              CASE WHEN pop.populacao > 0 THEN pop.populacao END AS populacao, pop.entes, pop.esperados, pop.excluidos
       FROM pop LEFT JOIN v USING (exercicio) LEFT JOIN ipca i USING (exercicio)
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       ORDER BY ano`,
      p,
    );
  },

  /**
   * Somas por dimensão. Para cada campo: soma, soma real, população e número de entes do mesmo
   * conjunto de observações elegíveis (per capita = soma ÷ população desses entes). `pares`
   * ("a/b,c/d") devolve numerador e denominador na interseção das observações válidas dos dois campos.
   * `painel=1`: só os entes com o primeiro campo elegível em todos os exercícios em que ele existe no escopo.
   */
  async agregado(q) {
    const { manifesto } = await iniciar();
    const campos = String(q.campos ?? '').split(',').filter((c) => CAMPOS.has(c));
    const por = String(q.por ?? 'exercicio').split(',').filter((d) => DIMENSOES.has(d));
    if (!campos.length || !por.length) return [];
    const e = await escopoDe(q);
    const trat = tratamentoDe(q);
    const individual = e.tipo === 'ente';
    const p: Record<string, Valor> = { base: manifesto.base_ipca };
    const filtros = [recorte(e, 'i', p)];
    if (inteiro(q.ano)) { filtros.push('i.exercicio = $ano'); p.ano = inteiro(q.ano); }
    if (inteiro(q.faixa)) { filtros.push('i.faixa_grupo = $faixa'); p.faixa = inteiro(q.faixa); }
    if (String(q.painel) === '1' && !individual) {
      const c0 = campos[0];
      filtros.push(`i.cod_ibge IN (
        SELECT j.cod_ibge FROM indicadores j WHERE ${recorte(e, 'j', p)} AND ${elegivel(c0, 'j', trat)}
        GROUP BY j.cod_ibge
        HAVING count(DISTINCT j.exercicio) = (SELECT count(DISTINCT k.exercicio) FROM indicadores k
                                              WHERE ${recorte(e, 'k', p)} AND k.${c0} IS NOT NULL))`);
    }
    const colunas: string[] = [];
    for (const c of campos) {
      const ok = elegivel(c, 'i', trat, individual);
      colunas.push(`sum(i.${c}) FILTER (${ok}) AS ${c}`);
      if (!NAO_MONETARIOS.has(c)) colunas.push(`sum(i.${c} * b.indice / ip.indice) FILTER (${ok}) AS ${c}_real`);
      colunas.push(`sum(i.populacao) FILTER (${ok} AND i.populacao > 0)::DOUBLE AS populacao_${c}`);
      colunas.push(`count(*) FILTER (${ok})::INTEGER AS entes_${c}`);
    }
    for (const par of String(q.pares ?? '').split(',').filter(Boolean)) {
      const [a, b] = par.split('/');
      if (!CAMPOS.has(a) || !CAMPOS.has(b)) continue;
      const ok = `${elegivel(a, 'i', trat, individual)} AND ${elegivel(b, 'i', trat, individual)}`;
      colunas.push(`sum(i.${a}) FILTER (${ok}) AS ${a}__${b}_num`, `sum(i.${b}) FILTER (${ok}) AS ${a}__${b}_den`,
        `count(*) FILTER (${ok})::INTEGER AS ${a}__${b}_entes`);
    }
    const dims = por.map((d) => `i.${d}`);
    const extras = por.includes('cod_ibge') ? ', any_value(i.nome) AS nome, any_value(i.uf) AS uf_ente' : '';
    return consultar(
      `SELECT ${dims.join(', ')}, ${colunas.join(', ')}, sum(i.populacao)::DOUBLE AS populacao, count(*)::INTEGER AS entes${extras}
       FROM indicadores i LEFT JOIN ipca ip USING (exercicio)
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       WHERE ${filtros.join(' AND ')}
       GROUP BY ${dims.join(', ')} ORDER BY ${dims.join(', ')}`,
      p,
    );
  },

  /**
   * Cobertura por exercício no escopo e domínio: entes com dados, universo do cadastro, sem dados,
   * excluídos pelo filtro e valor excluído (total do domínio dos ente-anos fora dos agregados).
   */
  async cobertura(q) {
    await iniciar();
    const e = await escopoDe(q);
    const trat = tratamentoDe(q);
    const dominio = (['receita', 'despesa', 'patrimonio'].includes(String(q.dominio)) ? String(q.dominio) : 'receita') as Dominio;
    if (e.tipo === 'ente') {
      return consultar(
        `SELECT exercicio, categoria, indicador, dominio, valor, valor_real, mediana_real, razao, n_obs, regra, exclui
         FROM alertas WHERE cod_ibge = $ente::INTEGER ORDER BY exercicio`, { ente: e.ente },
      );
    }
    const p: Record<string, Valor> = { escopo: e.escopo, esfera: e.esfera, dominio, trat };
    const ano = inteiro(q.ano);
    if (ano) p.ano = ano;
    const ufAlerta = e.escopo === 'BR' ? '' : 'AND a.uf = $escopo';
    return consultar(
      `SELECT s.exercicio, s.entes, s.esperados, s.excluidos, s.sem_dados, s.populacao::DOUBLE AS populacao,
              (SELECT count(*) FROM alertas a WHERE a.exclui AND a.dominio = $dominio AND a.exercicio = s.exercicio
                 AND a.esfera = $esfera ${ufAlerta} AND a.categoria <> 'ausente') AS sinalizados,
              (SELECT sum(a.valor) FROM alertas a WHERE a.exclui AND a.dominio = $dominio AND a.exercicio = s.exercicio
                 AND a.esfera = $esfera ${ufAlerta} AND a.categoria <> 'ausente') AS valor_excluido
       FROM escopos s
       WHERE s.escopo = $escopo AND s.esfera = $esfera AND s.dominio = $dominio AND s.tratamento = $trat
         ${ano ? 'AND s.exercicio = $ano' : ''}
       ORDER BY s.exercicio`,
      p,
    );
  },

  /**
   * Ranking completo dos municípios: posição nacional e na UF (empates com a mesma posição,
   * RANK), página pedida, total elegível e a posição do ente escolhido. Zeros e negativos
   * declarados entram; per capita exige população positiva.
   */
  async ranking(q) {
    const campo = CAMPOS.has(String(q.campo)) ? String(q.campo) : 'receita_bruta';
    const trat = tratamentoDe(q);
    const perCapita = q.per_capita === '1' || q.per_capita === 1;
    const ordem = q.ordem === 'asc' ? 'ASC' : 'DESC';
    // todos=1: a consulta inteira (exportação); senão, uma página de até 100 linhas
    const limite = String(q.todos) === '1' ? 100000 : Math.min(inteiro(q.limite) ?? 20, 100);
    const pagina = Math.max(inteiro(q.pagina) ?? 1, 1);
    const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
    const ente = inteiro(q.ente);
    const p: Record<string, Valor> = { ano: inteiro(q.ano), limite, offset: (pagina - 1) * limite };
    if (uf) p.uf = uf;
    if (ente) p.ente = ente;
    const expr = perCapita ? `i.${campo} / i.populacao` : `i.${campo}`;
    const ok = `${elegivel(campo, 'i', trat)}${perCapita ? ' AND i.populacao > 0' : ''}`;
    const base = `
      WITH todos AS (SELECT i.* FROM indicadores i WHERE i.exercicio = $ano AND i.esfera = 'M'),
      el AS (SELECT cod_ibge, nome, uf, populacao::DOUBLE AS populacao, ${campo} AS valor, ${expr} AS indicador
             FROM todos i WHERE ${ok}),
      r AS (SELECT *, rank() OVER (ORDER BY indicador ${ordem}) AS posicao_br,
                      rank() OVER (PARTITION BY uf ORDER BY indicador ${ordem}) AS posicao_uf,
                      count(*) OVER () AS total_br, count(*) OVER (PARTITION BY uf) AS total_uf
            FROM el)`;
    const noEscopo = uf ? 'WHERE uf = $uf' : '';
    const [itens, [contagem], [doEnte]] = await Promise.all([
      consultar(`${base} SELECT * FROM r ${noEscopo} ORDER BY ${uf ? 'posicao_uf' : 'posicao_br'}, nome LIMIT $limite OFFSET $offset`, p),
      consultar(
        `${base}, esc AS (SELECT * FROM todos i ${uf ? 'WHERE i.uf = $uf' : ''})
         SELECT (SELECT count(*) FROM r ${noEscopo}) AS elegiveis,
                (SELECT count(*) FROM esc) AS com_dca,
                (SELECT count(*) FROM esc i WHERE i.${campo} IS NULL) AS sem_valor,
                (SELECT count(*) FROM esc i WHERE i.${campo} IS NOT NULL AND NOT (${ok})) AS fora,
                (SELECT count(*) FROM esc i WHERE i.${campo} = 0 AND (${ok})) AS zeros,
                (SELECT count(*) FROM esc i WHERE i.${campo} < 0 AND (${ok})) AS negativos`,
        p,
      ),
      ente
        ? consultar(`${base} SELECT * FROM r WHERE cod_ibge = $ente::INTEGER`, p)
        : Promise.resolve([] as Linha[]),
    ]);
    return { itens, ...contagem, ente: doEnte ?? null, pagina, limite };
  },

  /** Exercícios com o campo informado por algum município (para restringir a escolha do ano). */
  disponibilidade: (q) =>
    consultar(
      `SELECT exercicio, count(${CAMPOS.has(String(q.campo)) ? String(q.campo) : 'receita_bruta'})::INTEGER AS entes
       FROM indicadores WHERE esfera = 'M' GROUP BY 1 HAVING entes > 0 ORDER BY 1`,
    ),

  faixas: () => consultar('SELECT * FROM faixas ORDER BY grupo'),

  async ipca() {
    const { manifesto } = await iniciar();
    return consultar(
      `SELECT i.exercicio AS ano, i.ipca_pct, i.completo, i.meses, b.indice / i.indice AS fator
       FROM ipca i CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       WHERE i.exercicio >= 2013 ORDER BY 1`,
      { base: manifesto.base_ipca },
    );
  },

  async alertas(q) {
    const ente = inteiro(q.ente);
    return consultar(
      `SELECT exercicio, cod_ibge, nome, uf, esfera, indicador, dominio, valor, valor_real, mediana_real, razao, n_obs,
              categoria, motivo, regra, evidencia, fonte, exclui
       FROM alertas ${ente ? 'WHERE cod_ibge = $ente::INTEGER' : ''}
       ORDER BY exercicio DESC, CASE categoria WHEN 'inconsistente' THEN 0 WHEN 'confirmado' THEN 1 WHEN 'suspeita' THEN 2 ELSE 3 END,
                razao DESC NULLS LAST`,
      ente ? { ente } : {},
    );
  },

  async validacao() {
    await registrarCsv('validacao.csv');
    return consultar(`SELECT * FROM read_csv('validacao.csv') ORDER BY tipo DESC, teste, exercicio, anexo`);
  },

  /** Casos reprovados de um teste, com o nome do ente. */
  async divergencias(q) {
    await registrarCsv('validacao_divergencias.csv');
    return consultar(
      `SELECT d.*, e.nome, e.uf FROM read_csv('validacao_divergencias.csv') d LEFT JOIN entes e USING (cod_ibge)
       WHERE d.teste = $teste AND d.exercicio = $ano AND d.anexo = $anexo ORDER BY abs(d.diferenca) DESC LIMIT 500`,
      { teste: String(q.teste), ano: inteiro(q.ano), anexo: String(q.anexo) },
    );
  },
};

async function populacao(ano: number, e: Escopo, dominio: Dominio, trat: Tratamento) {
  const [r] =
    e.tipo === 'ente'
      ? await consultar('SELECT populacao::DOUBLE AS populacao, 1 AS entes FROM indicadores WHERE exercicio = $ano AND cod_ibge = $ente::INTEGER', { ano, ente: e.ente })
      : await consultar(
        `SELECT populacao::DOUBLE AS populacao, entes FROM escopos
         WHERE exercicio = $ano AND escopo = $escopo AND esfera = $esfera AND dominio = $dominio AND tratamento = $trat`,
        { ano, escopo: e.escopo, esfera: e.esfera, dominio, trat },
      );
  const pop = (r?.populacao as number) ?? null;
  return { populacao: pop && pop > 0 ? pop : null, entes: (r?.entes as number) ?? 0 };
}

/**
 * Consulta da IA (página /ia), já conferida por validarSql: roda sobre as tabelas em memória e traz
 * no máximo `limite` linhas, mais o total. As colunas saem na ordem do SELECT.
 */
export async function consultaLivre(sql: string, limite: number) {
  const { con } = await iniciar();
  const base = sql.trim().replace(/;\s*$/, '');
  const r = await con.query(`SELECT * FROM (${base}) AS consulta LIMIT ${limite}`);
  const [n] = await consultar(`SELECT count(*) AS n FROM (${base}) AS consulta`);
  const colunas = r.schema.fields.map((f) => f.name);
  // DECIMAL, datas e listas chegam como objetos do Arrow: viram número ou texto
  const celula = (v: unknown): Valor => {
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === 'object') {
      const x = Number(String(v));
      return Number.isFinite(x) ? x : String(v);
    }
    return normalizar(v);
  };
  const linhas = r.toArray().map((l) => {
    const o = l.toJSON() as Record<string, unknown>;
    return colunas.map((c) => celula(o[c]));
  });
  return { colunas, linhas, total: Number(n.n) };
}

export async function executar(caminho: string, params: Params): Promise<unknown> {
  const rota = rotas[caminho];
  if (!rota) throw new Error(`rota desconhecida: ${caminho}`);
  return rota(params);
}
