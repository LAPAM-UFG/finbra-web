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
    // castDecimalToDouble: sem ele, um DECIMAL (remunerações da RAIS) chega ao JavaScript sem a escala
    // (R$ 4.160,00 vira 416000)
    await db.open({
      query: { castBigIntToDouble: true, castDecimalToDouble: true },
      filesystem: { forceFullHTTPReads: false, reliableHeadRequests: true, allowFullHTTPReads: false },
    });
    const con = await db.connect();
    for (const [nome, dados] of await arquivos) {
      await db.registerFileBuffer(`${nome}.parquet`, dados);
      await con.query(`CREATE TABLE ${nome} AS SELECT * FROM read_parquet('${nome}.parquet')`);
    }
    await carregarIndiceMicro();
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
  const texto = sql.replace(/\$([a-z_][a-z_0-9]*)/gi, (_, nome: string) => {
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

// ---------------- LRF (RREO e RGF, fechamento do ano) ----------------

/** gold/lrf.parquet (~5 MB): só é baixado quando uma página da LRF ou a IA pede. */
let lrfCarregada: Promise<void> | null = null;
export function tabelaLrf() {
  lrfCarregada ??= (async () => {
    const { con } = await iniciar();
    await db.registerFileBuffer('lrf.parquet', await baixar('gold/lrf.parquet'));
    await con.query(`CREATE TABLE lrf AS SELECT * FROM read_parquet('lrf.parquet')`);
  })();
  lrfCarregada.catch(() => (lrfCarregada = null));
  return lrfCarregada;
}

/**
 * Limites e mínimos legais, para contar quem descumpre. O limite de pessoal é o declarado pelo ente
 * (54% Executivo municipal, 49% estadual, com exceções); DCL: 120% da RCL (municípios) e 200% (estados e DF,
 * Resolução 40/2001 do Senado); saúde: 15% (municípios) e 12% (estados; o DF declara a base combinada);
 * MDE: 25%; FUNDEB na remuneração dos profissionais: 70% desde 2021 (Lei 14.113/2020), 60% antes.
 */
const LRF_LIMITES = `
  CASE WHEN l.esfera = 'M' THEN 120 ELSE 200 END AS lim_dcl,
  CASE WHEN l.esfera = 'M' THEN 15 ELSE 12 END AS min_saude,
  25 AS min_mde,
  CASE WHEN l.exercicio >= 2021 THEN 70 ELSE 60 END AS min_fundeb`;

/** Recorte de grupo na tabela lrf: esfera e, para municípios, a UF. */
function recorteLrf(q: Params, p: Record<string, Valor>) {
  const esferaLrf = q.esfera === 'E' ? 'E' : 'M';
  p.esfera = esferaLrf;
  const uf = UFS.has(String(q.uf)) && esferaLrf === 'M' ? String(q.uf) : null;
  if (uf) p.uf = uf;
  return `l.esfera = $esfera${uf ? ' AND l.uf = $uf' : ''}`;
}

const rotasLrf: Record<string, (q: Params) => Promise<unknown>> = {
  /** Série de um ente: todos os indicadores, com limites e mínimos. */
  async lrf_ente(q) {
    await tabelaLrf();
    return consultar(`SELECT l.*, ${LRF_LIMITES} FROM lrf l WHERE l.cod_ibge = $ente::INTEGER ORDER BY l.exercicio`,
      { ente: inteiro(q.ente) });
  },

  /**
   * Agregados por exercício para um grupo (municípios de uma UF ou do Brasil; estados). As razões são
   * soma ÷ soma, só dos entes com numerador e denominador; os percentuais declarados entram como mediana
   * e na contagem de quem passa do limite ou fica abaixo do mínimo.
   */
  async lrf_grupo(q) {
    await tabelaLrf();
    const p: Record<string, Valor> = {};
    const onde = recorteLrf(q, p);
    return consultar(
      `WITH l AS (SELECT l.*, coalesce(l.rcl_ajustada, l.rcl) AS base, ${LRF_LIMITES} FROM lrf l WHERE ${onde})
       SELECT exercicio, count(*)::INTEGER AS entes,
              count(rreo_tipo)::INTEGER AS com_rreo, count(rgf_tipo)::INTEGER AS com_rgf,
              sum(rcl) AS rcl,
              sum(despesa_pessoal) FILTER (despesa_pessoal IS NOT NULL AND base > 0) / sum(base) FILTER (despesa_pessoal IS NOT NULL AND base > 0) AS pessoal_rcl,
              median(pessoal_rcl_pct) / 100 AS pessoal_mediana,
              count(pessoal_rcl_pct)::INTEGER AS n_pessoal,
              count(*) FILTER (pessoal_rcl_pct > pessoal_limite_pct)::INTEGER AS pessoal_acima_limite,
              count(*) FILTER (pessoal_rcl_pct > 0.95 * pessoal_limite_pct)::INTEGER AS pessoal_acima_prudencial,
              sum(dcl) FILTER (dcl IS NOT NULL AND base > 0) / sum(base) FILTER (dcl IS NOT NULL AND base > 0) AS dcl_rcl,
              median(dcl_rcl_pct) / 100 AS dcl_mediana,
              count(dcl_rcl_pct)::INTEGER AS n_dcl,
              count(*) FILTER (dcl_rcl_pct > lim_dcl)::INTEGER AS dcl_acima_limite,
              median(saude_pct) / 100 AS saude_mediana, count(saude_pct)::INTEGER AS n_saude,
              count(*) FILTER (saude_pct < min_saude)::INTEGER AS saude_abaixo,
              median(mde_pct) / 100 AS mde_mediana, count(mde_pct)::INTEGER AS n_mde,
              count(*) FILTER (mde_pct < min_mde)::INTEGER AS mde_abaixo,
              median(fundeb_pct) / 100 AS fundeb_mediana, count(fundeb_pct)::INTEGER AS n_fundeb,
              count(*) FILTER (fundeb_pct < min_fundeb)::INTEGER AS fundeb_abaixo,
              sum(resultado_primario) AS resultado_primario, count(resultado_primario)::INTEGER AS n_primario,
              count(*) FILTER (resultado_primario < 0)::INTEGER AS primario_deficit,
              count(*) FILTER (resultado_primario IS NOT NULL AND meta_primario IS NOT NULL)::INTEGER AS n_meta,
              count(*) FILTER (resultado_primario >= meta_primario)::INTEGER AS meta_cumprida
       FROM l GROUP BY exercicio ORDER BY exercicio`,
      p,
    );
  },

  /** Entes de um grupo num exercício, com indicadores e limites (tabela e exportação). */
  async lrf_entes(q) {
    await tabelaLrf();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const onde = recorteLrf(q, p);
    return consultar(`SELECT l.*, ${LRF_LIMITES} FROM lrf l WHERE ${onde} AND l.exercicio = $ano::INTEGER ORDER BY l.uf, l.nome`, p);
  },

  /** Anexos que um ente entregou num exercício (o arquivo do ano é lido por Range, só o trecho do ente). */
  async lrf_anexos(q) {
    await iniciar(); // a URL do arquivo leva a versão do manifesto
    return consultar(
      `SELECT relatorio, anexo, any_value(tipo_demonstrativo) AS tipo, any_value(periodicidade) AS periodicidade, count(*)::INTEGER AS linhas
       FROM read_parquet(${arq(`silver/lrf/exercicio=${inteiro(q.ano)}.parquet`)})
       WHERE cod_ibge = $ente::INTEGER GROUP BY ALL ORDER BY relatorio DESC, anexo`,
      { ente: inteiro(q.ente) },
    );
  },

  /** Linhas de um anexo, na ordem do relatório. */
  async lrf_anexo(q) {
    await iniciar();
    return consultar(
      `SELECT ordem, rotulo, cod_conta, conta, coluna, valor
       FROM read_parquet(${arq(`silver/lrf/exercicio=${inteiro(q.ano)}.parquet`)})
       WHERE cod_ibge = $ente::INTEGER AND relatorio = $relatorio AND anexo = $anexo ORDER BY ordem`,
      { ente: inteiro(q.ente), relatorio: String(q.relatorio), anexo: String(q.anexo) },
    );
  },
};

// ---------------- mercado de trabalho (RAIS e Novo CAGED) ----------------

/**
 * Tabelas pequenas do mercado de trabalho, baixadas só quando uma página da área pede:
 * municípios × ano da RAIS (~3 MB), CAGED por UF/Brasil e seção, CAGED anual por município e nomes da CNAE.
 */
const TABELAS_TRABALHO: Record<string, string> = {
  trab_municipios: 'gold/trabalho/municipios.parquet',
  trab_caged_uf: 'gold/trabalho/caged_uf.parquet',
  trab_caged_anual: 'gold/trabalho/caged_anual.parquet',
  trab_setores_uf: 'gold/trabalho/setores_uf.parquet',
  trab_cnae: 'gold/trabalho/cnae.parquet',
};
let trabalhoCarregado: Promise<void> | null = null;
export function tabelasTrabalho() {
  trabalhoCarregado ??= (async () => {
    const { con } = await iniciar();
    const arquivos = await Promise.all(Object.entries(TABELAS_TRABALHO).map(async ([n, c]) => [n, await baixar(c)] as const));
    for (const [nome, dados] of arquivos) {
      await db.registerFileBuffer(`${nome}.parquet`, dados);
      await con.query(`CREATE TABLE ${nome} AS SELECT * FROM read_parquet('${nome}.parquet')`);
    }
  })();
  trabalhoCarregado.catch(() => (trabalhoCarregado = null));
  return trabalhoCarregado;
}

/**
 * Dicionário dos códigos dos microdados (~100 KB), só para a consulta personalizada: fica à parte para as
 * outras páginas de trabalho funcionarem onde ele não foi publicado.
 */
let dicionarioCarregado: Promise<void> | null = null;
function dicionarioTrabalho() {
  dicionarioCarregado ??= (async () => {
    await tabelasTrabalho();
    const { con } = await iniciar();
    await db.registerFileBuffer('trab_dic.parquet', await baixar('gold/trabalho/dicionario.parquet'));
    await con.query(`CREATE TABLE trab_dic AS SELECT * FROM read_parquet('trab_dic.parquet')`);
  })();
  dicionarioCarregado.catch(() => (dicionarioCarregado = null));
  return dicionarioCarregado;
}

/** Escopo das páginas de trabalho: um município, uma UF (municípios dela) ou o Brasil. O DF é Brasília (5300108). */
function escopoTrabalho(q: Params, p: Record<string, Valor>, a = 'm') {
  const ente = inteiro(q.ente);
  if (ente) {
    p.ente = ente === 53 ? 5300108 : ente;
    return { tipo: 'ente' as const, onde: `${a}.cod_ibge = $ente::INTEGER` };
  }
  const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
  if (uf) {
    p.uf = uf;
    return { tipo: 'uf' as const, onde: `${a}.uf = $uf`, escopo: uf };
  }
  return { tipo: 'br' as const, onde: 'true', escopo: 'BR' };
}

const rotasTrabalho: Record<string, (q: Params) => Promise<unknown>> = {
  /**
   * Série anual da RAIS para o escopo: somas e médias ponderadas (massa ÷ vínculos com remuneração),
   * remuneração também em R$ reais do ano-base do IPCA.
   */
  async trab_serie(q) {
    const { manifesto } = await iniciar();
    await tabelasTrabalho();
    const p: Record<string, Valor> = { base: manifesto.base_ipca };
    const e = escopoTrabalho(q, p);
    const setores = ['agropecuaria', 'industria', 'construcao', 'comercio', 'servicos', 'adm_publica']
      .map((s) => `sum(m.empregos_${s}) AS empregos_${s}`).join(', ');
    return consultar(
      `SELECT m.ano, count(*)::INTEGER AS municipios, sum(m.empregos) AS empregos,
              sum(m.populacao) FILTER (m.populacao > 0) AS populacao,
              sum(m.empregos) FILTER (m.populacao > 0) AS empregos_com_populacao,
              sum(m.mulheres) AS mulheres, sum(m.superior) AS superior, sum(m.ate24) AS ate24, sum(m.de50mais) AS de50mais,
              ${setores},
              sum(m.massa_dez) AS massa_dez,
              sum(m.massa_dez) / nullif(sum(m.n_rem_dez), 0) AS remuneracao_media,
              sum(m.massa_dez) / nullif(sum(m.n_rem_dez), 0) * b.indice / i.indice AS remuneracao_media_real,
              sum(m.massa_dez_mulheres) / nullif(sum(m.n_rem_dez_mulheres), 0) AS remuneracao_mulheres,
              sum(m.massa_dez_homens) / nullif(sum(m.n_rem_dez_homens), 0) AS remuneracao_homens,
              sum(m.estabelecimentos) AS estabelecimentos
       FROM trab_municipios m
       LEFT JOIN ipca i ON i.exercicio = m.ano
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       WHERE ${e.onde}
       GROUP BY m.ano, b.indice, i.indice ORDER BY m.ano`,
      p,
    );
  },

  /** Empregos e remuneração por divisão da CNAE num ano (município: lido por Range; UF/Brasil: tabela pronta). */
  async trab_setores(q) {
    await tabelasTrabalho();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const e = escopoTrabalho(q, p, 's');
    const [origem, filtro] = e.tipo === 'ente'
      ? [`read_parquet(${arq('gold/trabalho/setores.parquet')})`, e.onde]
      : ['trab_setores_uf', `s.escopo = '${e.escopo}'`];
    return consultar(
      `SELECT s.divisao, c.divisao_nome, c.secao, c.secao_nome, s.empregos, s.remuneracao_media_dez AS remuneracao_media
       FROM ${origem} s LEFT JOIN trab_cnae c USING (divisao)
       WHERE ${filtro} AND s.ano = $ano::INTEGER
       ORDER BY s.empregos DESC`,
      p,
    );
  },

  /** CAGED mensal: admissões, desligamentos e saldo (município: por Range; UF/Brasil: total). */
  async trab_caged(q) {
    await tabelasTrabalho();
    const p: Record<string, Valor> = {};
    const e = escopoTrabalho(q, p, 'c');
    const [origem, filtro] = e.tipo === 'ente'
      ? [`read_parquet(${arq('gold/trabalho/caged.parquet')})`, e.onde]
      : ['trab_caged_uf', `c.escopo = '${e.escopo}' AND c.secao = 'TOTAL'`];
    return consultar(
      `SELECT c.competencia, c.admissoes, c.desligamentos, c.saldo, c.salario_medio_admissao,
              sum(c.saldo) OVER (ORDER BY c.competencia ROWS BETWEEN 11 PRECEDING AND CURRENT ROW) AS saldo_12m
       FROM ${origem} c WHERE ${filtro} ORDER BY c.competencia`,
      p,
    );
  },

  /** Saldo do CAGED por seção da CNAE nos 12 meses até a competência (só UF e Brasil). */
  async trab_caged_secoes(q) {
    await tabelasTrabalho();
    const p: Record<string, Valor> = { ate: inteiro(q.ate) };
    const e = escopoTrabalho(q, p, 'c');
    if (e.tipo === 'ente') return [];
    return consultar(
      `SELECT c.secao, any_value(n.secao_nome) AS secao_nome, sum(c.admissoes) AS admissoes, sum(c.desligamentos) AS desligamentos,
              sum(c.saldo) AS saldo
       FROM trab_caged_uf c LEFT JOIN (SELECT DISTINCT secao, secao_nome FROM trab_cnae) n USING (secao)
       WHERE c.escopo = '${e.escopo}' AND c.secao NOT IN ('TOTAL') AND c.secao IS NOT NULL
         AND c.competencia > $ate - 100 AND c.competencia <= $ate
       GROUP BY c.secao ORDER BY saldo DESC`,
      p,
    );
  },

  /** Municípios de uma UF (ou do Brasil) num ano da RAIS, com o saldo do CAGED do mesmo ano. */
  async trab_municipios(q) {
    await tabelasTrabalho();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const e = escopoTrabalho({ uf: q.uf }, p);
    return consultar(
      `SELECT m.cod_ibge, m.nome, m.uf, m.populacao, m.empregos,
              1000 * m.empregos / nullif(m.populacao, 0) AS empregos_por_mil,
              m.massa_dez / nullif(m.n_rem_dez, 0) AS remuneracao_media,
              m.mulheres / nullif(m.empregos, 0) AS pct_mulheres, m.superior / nullif(m.empregos, 0) AS pct_superior,
              m.empregos_adm_publica / nullif(m.empregos, 0) AS pct_adm_publica, m.estabelecimentos,
              c.saldo AS saldo_caged, c.meses AS meses_caged
       FROM trab_municipios m LEFT JOIN trab_caged_anual c ON c.cod_ibge = m.cod_ibge AND c.ano = m.ano
       WHERE ${e.onde} AND m.ano = $ano::INTEGER ORDER BY m.empregos DESC`,
      p,
    );
  },
};

// ---------------- consulta personalizada (microdados da RAIS) ----------------

/**
 * Situação do vínculo no ano: 1 ativo em 31/12; 2 desligado no ano (motivo de desligamento informado);
 * 3 outro (não ativo e sem desligamento). Afastado: primeira causa de afastamento válida (10 a 90).
 */
const SITUACAO = `CASE WHEN ativo_31_12 = 1 THEN 1 WHEN motivo_desligamento > 0 THEN 2 ELSE 3 END`;
const AFASTADO = `causa_afastamento_1 BETWEEN 10 AND 90`;
const FAIXA_IDADE = `CASE WHEN idade < 18 THEN '1' WHEN idade < 25 THEN '2' WHEN idade < 30 THEN '3' WHEN idade < 40 THEN '4'
  WHEN idade < 50 THEN '5' WHEN idade < 65 THEN '6' WHEN idade IS NOT NULL THEN '7' END`;

/**
 * Fontes da consulta: os microdados (um arquivo por ano e UF, ~1–3 GB por ano), quando publicados (há
 * silver/trabalho/micro/indice.json no R2 ou, no servidor local do Vite, na pasta finbra_micro), para UFs e
 * municípios; senão, e para o Brasil, as tabelas pré-somadas do gold: cubo_uf (UF × classe CNAE × CBO) e
 * cubo_mun (município × divisão CNAE × grande grupo CBO). VITE_MICRODADOS=0 força as tabelas.
 */
type FonteConsulta = 'micro' | 'cubo_uf' | 'cubo_mun';
type IndiceMicro = { rais_vinculos?: Record<string, number[]> };
const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env;
let indiceMicro: IndiceMicro | null = null;
async function carregarIndiceMicro() {
  if (env?.VITE_MICRODADOS === '0' || lerLocal) return; // nos testes, quem decide é usarMicrodadosNoTeste
  indiceMicro = await baixar('silver/trabalho/micro/indice.json')
    .then((b) => JSON.parse(new TextDecoder().decode(b)) as IndiceMicro)
    .catch(() => null);
}
const temMicro = () => microNoTeste ?? (!!indiceMicro && Object.keys(indiceMicro.rais_vinculos ?? {}).length > 0);
let microNoTeste: boolean | null = null;
/** Testes: liga ou desliga os microdados (por padrão, nos testes, a consulta usa as tabelas). */
export function usarMicrodadosNoTeste(v: boolean) {
  if (microNoTeste !== v) iaTrabalho = null; // as tabelas da IA são refeitas com a nova escolha
  microNoTeste = v;
}
export function fonteConsulta(escopo: { ente?: unknown; uf?: unknown }): FonteConsulta {
  if (temMicro() && (escopo.ente || escopo.uf)) return 'micro';
  return escopo.ente ? 'cubo_mun' : 'cubo_uf';
}

/** Colunas de CNAE e CBO em cada fonte e o maior prefixo que cada uma aceita. */
const COLUNAS_CONSULTA: Record<FonteConsulta, { cnae: string; maxCnae: number; cbo: string; maxCbo: number }> = {
  micro: { cnae: 'coalesce(cnae_subclasse, cnae_classe)', maxCnae: 7, cbo: 'cbo', maxCbo: 6 },
  cubo_uf: { cnae: 'cnae_classe', maxCnae: 5, cbo: 'cbo', maxCbo: 6 },
  cubo_mun: { cnae: 'cnae_divisao', maxCnae: 2, cbo: 'cbo_grande_grupo', maxCbo: 1 },
};
export const LIMITES_CONSULTA = Object.fromEntries(
  Object.entries(COLUNAS_CONSULTA).map(([k, v]) => [k, { cnae: v.maxCnae, cbo: v.maxCbo }]),
) as Record<FonteConsulta, { cnae: number; cbo: number }>;

/**
 * Agrupamentos: expressão em cada fonte (ausente = a fonte não tem o recorte) e de onde vem o nome
 * (variável do dicionário, divisão/seção da CNAE, UF ou município).
 */
type Grupo = { micro: string; cubo_uf?: string; cubo_mun?: string; nome?: string };
const GRUPOS: Record<string, Grupo> = {
  total: { micro: `'total'`, cubo_uf: `'total'`, cubo_mun: `'total'` },
  uf: { micro: 'uf::VARCHAR', cubo_uf: 'uf::VARCHAR', nome: 'uf' },
  municipio: { micro: 'municipio::VARCHAR', cubo_mun: 'municipio::VARCHAR', nome: 'municipio' },
  cnae_secao: { micro: 'secao', cubo_uf: 'secao', cubo_mun: 'secao', nome: 'secao' },
  cnae_divisao: { micro: 'cnae_classe[1:2]', cubo_uf: 'cnae_classe[1:2]', cubo_mun: 'cnae_divisao', nome: 'divisao' },
  cnae_classe: { micro: 'cnae_classe', cubo_uf: 'cnae_classe', nome: 'cnae_classe' },
  cnae_subclasse: { micro: 'cnae_subclasse', nome: 'cnae_subclasse' },
  cbo_grande_grupo: { micro: 'cbo[1:1]', cubo_uf: 'cbo[1:1]', cubo_mun: 'cbo_grande_grupo', nome: 'cbo_grande_grupo' },
  cbo_familia: { micro: 'cbo[1:4]', cubo_uf: 'cbo[1:4]' },
  cbo: { micro: 'cbo', cubo_uf: 'cbo', nome: 'cbo' },
  sexo: { micro: 'sexo::VARCHAR', cubo_uf: 'sexo::VARCHAR', cubo_mun: 'sexo::VARCHAR', nome: 'sexo' },
  situacao: { micro: `(${SITUACAO})::VARCHAR`, cubo_uf: 'situacao::VARCHAR', cubo_mun: 'situacao::VARCHAR', nome: 'situacao' },
  faixa_idade: { micro: FAIXA_IDADE, nome: 'faixa_idade' },
  escolaridade: { micro: 'escolaridade::VARCHAR', nome: 'escolaridade' },
  raca_cor: { micro: 'raca_cor::VARCHAR', nome: 'raca_cor' },
  tipo_vinculo: { micro: 'tipo_vinculo::VARCHAR', nome: 'tipo_vinculo' },
  natureza_juridica_grupo: { micro: '(natureza_juridica // 1000)::VARCHAR', nome: 'natureza_juridica_grupo' },
  tamanho_estab: { micro: 'tamanho_estab::VARCHAR', nome: 'tamanho_estab' },
  causa_afastamento: { micro: 'causa_afastamento_1::VARCHAR', nome: 'causa_afastamento' },
  motivo_desligamento: { micro: 'motivo_desligamento::VARCHAR', nome: 'motivo_desligamento' },
};
export const gruposDaFonte = (fonte: FonteConsulta) => Object.keys(GRUPOS).filter((k) => GRUPOS[k][fonte]);

const MEDIDAS_MICRO = `
  count(*) AS vinculos,
  count(*) FILTER (ativo_31_12 = 1) AS ativos,
  count(*) FILTER (${SITUACAO} = 2) AS desligados,
  count(*) FILTER (${AFASTADO}) AS afastados,
  avg(dias_afastamento) FILTER (${AFASTADO}) AS dias_afastamento_medio,
  count(*) FILTER (sexo = 2) AS mulheres,
  count(*) FILTER (escolaridade >= 9) AS superior,
  avg(rem_dezembro_nom) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0) AS rem_dez_media,
  median(rem_dezembro_nom) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0) AS rem_dez_mediana,
  count(*) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0) AS n_rem_dez,
  avg(rem_media_nom) FILTER (rem_media_nom > 0) AS rem_media_media,
  median(rem_media_nom) FILTER (rem_media_nom > 0) AS rem_media_mediana,
  avg(horas_contratadas) FILTER (horas_contratadas > 0) AS horas_media,
  avg(idade) AS idade_media`;

// o cubo guarda somas e contagens: médias saem como soma ÷ contagem; medianas não são somáveis
const MEDIDAS_CUBO = `
  coalesce(sum(vinculos), 0)::DOUBLE AS vinculos,
  coalesce(sum(vinculos) FILTER (situacao = 1), 0)::DOUBLE AS ativos,
  coalesce(sum(vinculos) FILTER (situacao = 2), 0)::DOUBLE AS desligados,
  coalesce(sum(vinculos) FILTER (afastado), 0)::DOUBLE AS afastados,
  sum(dias_afastamento) FILTER (afastado) / nullif(sum(vinculos) FILTER (afastado), 0) AS dias_afastamento_medio,
  coalesce(sum(vinculos) FILTER (sexo = 2), 0)::DOUBLE AS mulheres,
  coalesce(sum(superior), 0)::DOUBLE AS superior,
  sum(rem_dez_soma) / nullif(sum(rem_dez_n), 0) AS rem_dez_media,
  NULL::DOUBLE AS rem_dez_mediana,
  coalesce(sum(rem_dez_n), 0)::DOUBLE AS n_rem_dez,
  sum(rem_media_soma) / nullif(sum(rem_media_n), 0) AS rem_media_media,
  NULL::DOUBLE AS rem_media_mediana,
  sum(horas_soma) / nullif(sum(horas_n), 0) AS horas_media,
  sum(idade_soma) / nullif(sum(idade_n), 0) AS idade_media`;

/** '4711, 56; 2124' → ['4711', '56', '2124']: só dígitos, até `max` por código e 60 códigos. */
const prefixos = (v: unknown, max: number) =>
  String(v ?? '').split(/[\s,;]+/).map((s) => s.replace(/\D/g, '')).filter((s) => s.length > 0 && s.length <= max).slice(0, 60);

const rotasConsulta: Record<string, (q: Params) => Promise<unknown>> = {
  /**
   * Consulta personalizada da RAIS num ano, na fonte de fonteConsulta: microdados (quando publicados; um
   * arquivo por ano e UF, lido por Range: as colunas usadas e, para um município, só o trecho dele) ou as
   * tabelas pré-somadas (somas e contagens, sem medianas).
   * Filtros: cnae e cbo (listas de prefixos), situacao (ativos, nao_ativos, desligados, afastados), sexo.
   */
  async trab_consulta(q) {
    await dicionarioTrabalho();
    const ano = inteiro(q.ano);
    const ente = inteiro(q.ente);
    const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
    const fonte = fonteConsulta({ ente, uf });
    const p: Record<string, Valor> = {};
    const filtros: string[] = [];
    let ufCod: number | null = null;
    if (ente) {
      const cod = ente === 53 ? 5300108 : ente;
      ufCod = Math.floor(cod / 100000);
      p.municipio = Math.floor(cod / 10); // a RAIS usa o código IBGE de 6 dígitos
      filtros.push('municipio = $municipio::INTEGER');
    } else if (uf) {
      const [u] = await consultar(`SELECT cod_ibge FROM entes WHERE esfera IN ('E', 'D') AND uf = $uf`, { uf });
      ufCod = Number(u?.cod_ibge);
      if (fonte !== 'micro') {
        p.uf_cod = ufCod;
        filtros.push(fonte === 'cubo_uf' ? 'uf = $uf_cod::INTEGER' : 'municipio // 10000 = $uf_cod::INTEGER');
      }
    }
    const origem = `read_parquet(${arq(fonte === 'micro'
      ? `silver/trabalho/micro/rais_vinculos/ano=${ano}/uf=${ufCod}.parquet`
      : `gold/trabalho/${fonte}/ano=${ano}.parquet`)})`;
    const grupo = GRUPOS[String(q.agrupar)] ?? GRUPOS.total;
    const expr = grupo[fonte];
    if (!expr) throw new Error(t('Este agrupamento não está disponível para este recorte.', 'This grouping is not available for this scope.'));

    const col = COLUNAS_CONSULTA[fonte];
    const codigos = (v: unknown, max: number, nome: string) => {
      const lista = prefixos(v, 7);
      if (lista.some((c) => c.length > max)) {
        throw new Error(t(`Neste recorte a ${nome} aceita códigos de até ${max} dígito(s).`, `For this scope ${nome} accepts codes of up to ${max} digit(s).`));
      }
      return lista;
    };
    const cnae = codigos(q.cnae, col.maxCnae, 'CNAE');
    if (cnae.length) filtros.push(`(${cnae.map((c, i) => ((p[`c${i}`] = c), `starts_with(${col.cnae}, $c${i})`)).join(' OR ')})`);
    const cbo = codigos(q.cbo, col.maxCbo, 'CBO');
    if (cbo.length) filtros.push(`(${cbo.map((c, i) => ((p[`o${i}`] = c), `starts_with(${col.cbo}, $o${i})`)).join(' OR ')})`);
    const sit = fonte === 'micro' ? SITUACAO : 'situacao';
    const situacoes: Record<string, string> = {
      ativos: `${sit} = 1`, nao_ativos: `${sit} <> 1`, desligados: `${sit} = 2`,
      afastados: fonte === 'micro' ? AFASTADO : 'afastado',
    };
    if (situacoes[String(q.situacao)]) filtros.push(situacoes[String(q.situacao)]);
    if (q.sexo === '1' || q.sexo === '2') filtros.push(`sexo = ${q.sexo}`);

    // a seção vem da divisão da CNAE; só junta a tabela quando o agrupamento pede
    const divisao = fonte === 'cubo_mun' ? 'v.cnae_divisao' : 'v.cnae_classe[1:2]';
    const base = String(q.agrupar) === 'cnae_secao'
      ? `(SELECT v.*, c.secao FROM ${origem} v LEFT JOIN trab_cnae c ON c.divisao = ${divisao})`
      : origem;
    const nome = ({
      uf: `(SELECT e.uf FROM entes e WHERE e.esfera IN ('E', 'D') AND e.cod_ibge::VARCHAR = g.grupo)`,
      municipio: `(SELECT e.nome FROM entes e WHERE e.esfera = 'M' AND (e.cod_ibge // 10)::VARCHAR = g.grupo)`,
      secao: `(SELECT any_value(c.secao_nome) FROM trab_cnae c WHERE c.secao = g.grupo)`,
      divisao: `(SELECT any_value(c.divisao_nome) FROM trab_cnae c WHERE c.divisao = g.grupo)`,
    } as Record<string, string>)[grupo.nome ?? ''] ??
      (grupo.nome ? `(SELECT d.descricao FROM trab_dic d WHERE d.variavel = '${grupo.nome}' AND d.codigo = g.grupo)` : 'NULL');
    const linhas = await consultar(
      `SELECT g.*, ${nome} AS nome
       FROM (SELECT ${expr} AS grupo, ${fonte === 'micro' ? MEDIDAS_MICRO : MEDIDAS_CUBO}
             FROM ${base} WHERE ${filtros.length ? filtros.join(' AND ') : 'true'} GROUP BY 1) g
       ORDER BY g.vinculos DESC LIMIT 3000`,
      p,
    );
    return { fonte, linhas };
  },

  /** Nomes de um código do dicionário (CBO, CNAE…) que contêm o texto, para a busca dos filtros. */
  async trab_dicionario(q) {
    await dicionarioTrabalho();
    const texto = String(q.texto ?? '').trim();
    if (texto.length < 2) return [];
    return consultar(
      `SELECT codigo, descricao FROM trab_dic
       WHERE variavel = $variavel AND (strip_accents(lower(descricao)) LIKE '%' || strip_accents(lower($texto)) || '%' OR codigo LIKE $texto || '%')
       ORDER BY length(codigo), codigo LIMIT 30`,
      { variavel: String(q.variavel), texto },
    );
  },
};

/** Manifesto como veio do servidor (para o Worker local da IA, que não tem o do R2). */
export async function manifestoDados() {
  return (await iniciar()).manifesto;
}

// ---------------- tabelas da IA do mercado de trabalho ----------------

/** O que a IA do mercado de trabalho tem nesta sessão (vai no pedido ao Worker, que monta as instruções). */
export type ContextoTrabalho = {
  rais_anos: number[]; micro_anos: number[]; caged_de: number | null; caged_ate: number | null;
  base_ipca: number; microdados: boolean;
};

/**
 * Prepara as tabelas que a IA do mercado de trabalho consulta: as pequenas em memória (tabelasTrabalho e o
 * dicionário) e visões sobre arquivos lidos por Range (setores e CAGED por município, tabelas somadas por
 * ano e, no computador local, os microdados por ano e UF, com a lista do indice.json). Devolve o contexto.
 */
let iaTrabalho: Promise<ContextoTrabalho> | null = null;
export function tabelasIaTrabalho() {
  iaTrabalho ??= (async () => {
    const { con, manifesto } = await iniciar();
    // o que faltar (ex.: dicionário não publicado na web) só deixa a tabela de fora, sem derrubar a conversa
    await tabelasTrabalho().catch(() => undefined);
    await dicionarioTrabalho().catch(() => undefined);
    const f = (manifesto.fontes ?? {}) as Record<string, Record<string, unknown>>;
    const lista = (caminhos: string[]) => `[${caminhos.map((c) => arq(c)).join(', ')}]`;
    await con.query(`CREATE OR REPLACE VIEW trab_setores AS SELECT * FROM read_parquet(${arq('gold/trabalho/setores.parquet')})`);
    await con.query(`CREATE OR REPLACE VIEW trab_caged AS SELECT * FROM read_parquet(${arq('gold/trabalho/caged.parquet')})`);
    const microAnos = ((f.rais_micro?.anos as number[] | undefined) ?? []).filter(Number.isInteger);
    // nas tabelas da RAIS a UF é o código IBGE (52); uf_sigla ('GO') evita juntar com entes.uf, que é a sigla
    const ufs = await consultar(`SELECT cod_ibge, uf FROM entes WHERE esfera IN ('E', 'D') AND cod_ibge BETWEEN 11 AND 53`);
    const sigla = (col: string) => (ufs.length
      ? `CASE ${col} ${ufs.map((u) => `WHEN ${Number(u.cod_ibge)} THEN '${String(u.uf).replace(/[^A-Z]/g, '')}'`).join(' ')} END`
      : 'NULL::VARCHAR');
    if (microAnos.length) {
      const cubo = (pasta: string) => `read_parquet(${lista(microAnos.map((a) => `gold/trabalho/${pasta}/ano=${a}.parquet`))})`;
      await con.query(`CREATE OR REPLACE VIEW rais_uf AS SELECT *, ${sigla('uf')} AS uf_sigla FROM ${cubo('cubo_uf')}`);
      // uf (2 dígitos) a partir do município, para filtrar uma UF nesta tabela como nas outras
      await con.query(`CREATE OR REPLACE VIEW rais_mun AS SELECT *, (municipio // 10000)::INTEGER AS uf, ${sigla('municipio // 10000')} AS uf_sigla FROM ${cubo('cubo_mun')}`);
    }
    let microdados = false;
    if (temMicro()) {
      try {
        const indice = indiceMicro ?? JSON.parse(new TextDecoder().decode(await baixar('silver/trabalho/micro/indice.json'))) as IndiceMicro;
        const arquivos = Object.entries(indice.rais_vinculos ?? {}).flatMap(([ano, ufs]) =>
          ufs.filter(Number.isInteger).map((uf) => `silver/trabalho/micro/rais_vinculos/ano=${Number(ano)}/uf=${uf}.parquet`));
        if (arquivos.length) {
          // hive_partitioning: o filtro por ano e uf descarta arquivos pelo caminho, sem abri-los
          await con.query(`CREATE OR REPLACE VIEW rais_vinculos AS SELECT *, ${sigla('uf')} AS uf_sigla FROM read_parquet(${lista(arquivos)}, hive_partitioning = true)`);
          microdados = true;
        }
      } catch {
        /* sem microdados publicados: a IA usa as tabelas somadas */
      }
    }
    const rais = f.rais as { anos?: number[] } | undefined;
    const caged = f.caged as { de?: number; ate?: number } | undefined;
    return {
      rais_anos: rais?.anos ?? [], micro_anos: microAnos, caged_de: caged?.de ?? null, caged_ate: caged?.ate ?? null,
      base_ipca: manifesto.base_ipca, microdados,
    };
  })();
  iaTrabalho.catch(() => (iaTrabalho = null));
  return iaTrabalho;
}

/**
 * Consulta da IA (página /ia), já conferida por validarSql: roda sobre as tabelas em memória e traz
 * no máximo `limite` linhas, mais o total. As colunas saem na ordem do SELECT.
 */
export async function consultaLivre(sql: string, limite: number) {
  const { con } = await iniciar();
  const base = sql.trim().replace(/;\s*$/, '');
  const r = await con.query(`SELECT * FROM (${base}) AS consulta LIMIT ${limite}`);
  // a contagem roda a consulta de novo (pesado nos microdados): só quando o resultado passou do limite
  const [n] = r.numRows < limite ? [{ n: r.numRows }] : await consultar(`SELECT count(*) AS n FROM (${base}) AS consulta`);
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
  const rota = rotas[caminho] ?? rotasLrf[caminho] ?? rotasTrabalho[caminho] ?? rotasConsulta[caminho];
  if (!rota) throw new Error(`rota desconhecida: ${caminho}`);
  return rota(params);
}
