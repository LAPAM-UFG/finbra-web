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

/** Despesa por função (anexo I-E), lida por Range quando uma consulta da IA a cita; sem o arquivo, fica de fora. */
let despesaFuncao: Promise<void> | null = null;
export function tabelaDespesaFuncao() {
  despesaFuncao ??= (async () => {
    const { con } = await iniciar();
    await con.query(`CREATE OR REPLACE VIEW despesa_funcao AS SELECT * FROM read_parquet(${arq('gold/despesa_funcao.parquet')})`);
  })();
  despesaFuncao.catch(() => (despesaFuncao = null));
  return despesaFuncao;
}

// ---------------- educação (SIOPE) e saúde (SIOPS) ----------------

/** Tabelas da IA sobre as declarações de educação e saúde: fonte no manifesto e arquivo do gold. */
const TABELAS_EDUCACAO_SAUDE: Record<string, [string, string]> = {
  siope_indicadores: ['siope', 'gold/siope/indicadores.parquet'],
  siope_despesas: ['siope', 'gold/siope/despesas.parquet'],
  siope_receitas: ['siope', 'gold/siope/receitas.parquet'],
  siope_despesas_funcao: ['siope', 'gold/siope/despesas_funcao.parquet'],
  siope_gerais: ['siope', 'gold/siope/gerais.parquet'],
  siope_remuneracao: ['siope', 'gold/siope/remuneracao.parquet'],
  siops_indicadores: ['siops', 'gold/siops/indicadores.parquet'],
};

/**
 * Visões sobre os arquivos do SIOPE e do SIOPS, lidos por Range (só o trecho que a consulta usa), criadas
 * quando uma consulta da IA as cita. Só as fontes que estão no manifesto; a remuneração, só se processada.
 */
let educacaoSaude: Promise<string[]> | null = null;
export function tabelasEducacaoSaude() {
  educacaoSaude ??= (async () => {
    const { con, manifesto } = await iniciar();
    const f = (manifesto.fontes ?? {}) as Record<string, { remuneracao?: unknown[] }>;
    const criadas: string[] = [];
    for (const [nome, [fonte, caminho]] of Object.entries(TABELAS_EDUCACAO_SAUDE)) {
      if (!f[fonte] || (nome === 'siope_remuneracao' && !f.siope?.remuneracao?.length)) continue;
      await con.query(`CREATE OR REPLACE VIEW ${nome} AS SELECT * FROM read_parquet(${arq(caminho)})`);
      criadas.push(nome);
    }
    return criadas;
  })();
  educacaoSaude.catch(() => (educacaoSaude = null));
  return educacaoSaude;
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

/** Recorte de grupo (municípios do Brasil ou de uma UF; estados) na tabela de apelido `a`. */
function recorteLrf(q: Params, p: Record<string, Valor>, a = 'l') {
  const esferaLrf = q.esfera === 'E' ? 'E' : 'M';
  p.esfera = esferaLrf;
  const uf = UFS.has(String(q.uf)) && esferaLrf === 'M' ? String(q.uf) : null;
  if (uf) p.uf = uf;
  return `${a}.esfera = $esfera${uf ? ` AND ${a}.uf = $uf` : ''}`;
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

// ---------------- saúde (SIOPS) e educação (SIOPE) ----------------

/** Colunas em reais do resumo: corrigidas pelo IPCA para reais do ano-base do painel ao carregar. */
const SE_REAIS = ['aluno_basica', 'aluno_infantil', 'aluno_fundamental', 'professores_aluno', 'educacao_liquidada', 'despesa_liquidada',
  'saude_hab', 'saude_proprios_hab', 'sus_hab', 'saude_total', 'saude_proprios', 'sus_receita'];

/** gold/saude_educacao.parquet (~6 MB): uma linha por ente e ano, baixado quando uma página de saúde ou educação pede. */
let seCarregada: Promise<void> | null = null;
function tabelaSaudeEducacao() {
  seCarregada ??= (async () => {
    const { con, manifesto } = await iniciar();
    await db.registerFileBuffer('saude_educacao.parquet', await baixar('gold/saude_educacao.parquet'));
    await con.query(
      `CREATE TABLE se AS
       SELECT s.* REPLACE (${SE_REAIS.map((c) => `s.${c} * b.indice / i.indice AS ${c}`).join(', ')}),
              CASE WHEN s.ano >= 2021 THEN 70 ELSE 60 END AS min_fundeb
       FROM read_parquet('saude_educacao.parquet') s LEFT JOIN ipca i ON i.exercicio = s.ano
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = ${Number(manifesto.base_ipca)}) b`,
    );
  })();
  seCarregada.catch(() => (seCarregada = null));
  return seCarregada;
}

/** Remuneração da educação (SIOPE, dezembro): ente, ou os municípios de uma UF ou do Brasil, ou os estados. */
function recorteRemuneracao(q: Params, p: Record<string, Valor>) {
  if (q.ente) {
    p.ente = inteiro(q.ente);
    return 'r.cod_ibge = $ente::INTEGER';
  }
  return recorteLrf(q, p, 'r');
}

/** Média de grupos já agregados, ponderada pelo número de pessoas (só grupos com a estatística, de 5 ou mais). */
const ponderada = (c: string) => `sum(${c} * profissionais) FILTER (${c} IS NOT NULL) / sum(profissionais) FILTER (${c} IS NOT NULL)`;

const rotasSaudeEducacao: Record<string, (q: Params) => Promise<unknown>> = {
  /** Série de um ente, com os mínimos legais. */
  async se_ente(q) {
    await tabelaSaudeEducacao();
    return consultar('SELECT * FROM se WHERE cod_ibge = $ente::INTEGER ORDER BY ano', { ente: inteiro(q.ente) });
  },

  /**
   * Agregados por ano de um grupo. Percentuais declarados: mediana e contagem de quem fica abaixo do mínimo;
   * valores por habitante: soma ÷ soma da população, só dos entes com os dois valores.
   */
  async se_grupo(q) {
    await tabelaSaudeEducacao();
    const p: Record<string, Valor> = {};
    const onde = recorteLrf(q, p, 's');
    const porHab = (v: string, pop: string) =>
      `sum(${v}) FILTER (${v} IS NOT NULL AND ${pop} > 0) / sum(${pop}) FILTER (${v} IS NOT NULL AND ${pop} > 0)`;
    return consultar(
      `SELECT ano, count(*)::INTEGER AS entes,
              median(mde_pct) / 100 AS mde_mediana, count(mde_pct)::INTEGER AS n_mde,
              count(*) FILTER (mde_pct < 25)::INTEGER AS mde_abaixo,
              median(fundeb_remuneracao_pct) / 100 AS fundeb_mediana, count(fundeb_remuneracao_pct)::INTEGER AS n_fundeb,
              count(*) FILTER (fundeb_remuneracao_pct < min_fundeb)::INTEGER AS fundeb_abaixo, any_value(min_fundeb) AS min_fundeb,
              median(educacao_despesa_pct) / 100 AS educacao_despesa_mediana,
              ${porHab('educacao_liquidada', 'populacao_siope')} AS educacao_hab,
              median(aluno_basica) AS aluno_basica_mediana, median(professores_aluno) AS professores_aluno_mediana,
              median(infantil_pct) / 100 AS infantil_mediana, median(fundamental_pct) / 100 AS fundamental_mediana,
              median(medio_pct) / 100 AS medio_mediana,
              median(saude_pct) / 100 AS saude_mediana, count(saude_pct)::INTEGER AS n_saude,
              count(*) FILTER (saude_pct < 15)::INTEGER AS saude_abaixo,
              ${porHab('saude_total', 'populacao_siops')} AS saude_hab,
              ${porHab('saude_proprios', 'populacao_siops')} AS saude_proprios_hab,
              ${porHab('sus_receita', 'populacao_siops')} AS sus_hab,
              median(saude_pessoal_pct) / 100 AS saude_pessoal_mediana, median(saude_medicamentos_pct) / 100 AS saude_medicamentos_mediana,
              median(saude_terceiros_pct) / 100 AS saude_terceiros_mediana, median(saude_investimentos_pct) / 100 AS saude_investimentos_mediana,
              median(sus_despesa_pct) / 100 AS sus_despesa_mediana
       FROM se s WHERE ${onde} GROUP BY ano ORDER BY ano`,
      p,
    );
  },

  /** Entes de um grupo num ano (tabela e exportação). */
  async se_entes(q) {
    await tabelaSaudeEducacao();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const onde = recorteLrf(q, p, 's');
    return consultar(
      `SELECT s.*, e.nome, s.educacao_liquidada / nullif(s.populacao_siope, 0) AS educacao_hab
       FROM se s JOIN entes e USING (cod_ibge) WHERE ${onde} AND s.ano = $ano::INTEGER ORDER BY s.uf, e.nome`,
      p,
    );
  },

  /** Profissionais e remuneração por ano, tipo de categoria e situação (o arquivo é lido por Range). */
  async rem_resumo(q) {
    await iniciar();
    const p: Record<string, Valor> = {};
    const onde = recorteRemuneracao(q, p);
    return consultar(
      `SELECT ano, tipo_categoria, situacao, sum(profissionais)::INTEGER AS profissionais, sum(vinculos)::INTEGER AS vinculos,
              sum(profissionais) FILTER (salario_medio IS NOT NULL)::INTEGER AS com_estatistica,
              ${ponderada('salario_medio')} AS salario_medio, ${ponderada('carga_horaria_media')} AS carga_horaria_media
       FROM read_parquet(${arq('gold/siope/remuneracao.parquet')}) r WHERE ${onde} GROUP BY ALL ORDER BY ano, tipo_categoria, profissionais DESC`,
      p,
    );
  },

  /** Categorias de um ano: as do ente como declaradas (com quartis), ou somadas no grupo (média ponderada). */
  async rem_categorias(q) {
    await iniciar();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const onde = recorteRemuneracao(q, p);
    const colunas = q.ente
      ? 'profissionais, vinculos, carga_horaria_media, salario_medio, salario_p25, salario_mediana, salario_p75, outros_medio'
      : `sum(profissionais)::INTEGER AS profissionais, sum(vinculos)::INTEGER AS vinculos,
         sum(profissionais) FILTER (salario_medio IS NOT NULL)::INTEGER AS com_estatistica,
         ${ponderada('carga_horaria_media')} AS carga_horaria_media, ${ponderada('salario_medio')} AS salario_medio`;
    return consultar(
      `SELECT tipo_categoria, categoria, situacao, ${colunas}
       FROM read_parquet(${arq('gold/siope/remuneracao.parquet')}) r WHERE ${onde} AND r.ano = $ano::INTEGER
       ${q.ente ? '' : 'GROUP BY ALL'} ORDER BY tipo_categoria DESC, profissionais DESC`,
      p,
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
    // nomes das classificações derivadas da consulta (setor institucional, esfera, faixas de jornada e tempo)
    await con.query(`INSERT INTO trab_dic (variavel, codigo, descricao) SELECT * FROM (VALUES ${DERIVADAS.map((d) => `(${d.map(lit).join(', ')})`).join(', ')}) d
      WHERE NOT EXISTS (SELECT 1 FROM trab_dic x WHERE x.variavel = d.col0 AND x.codigo = d.col1)`);
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
              sum(m.massa_dez) AS massa_dez, sum(m.n_rem_dez) AS n_rem_dez,
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

  /**
   * CAGED mensal de famílias da CBO (prefixos de até 4 dígitos), para uma UF ou o Brasil (tabela caged_cbo, lida
   * por Range: ordenada por escopo e família). Soma as famílias pedidas; o salário de admissão vem com N e fora.
   */
  async trab_caged_cbo(q) {
    await tabelasTrabalho();
    const p: Record<string, Valor> = {};
    const e = escopoTrabalho(q, p, 'c');
    if (e.tipo === 'ente') throw new Error(t('O CAGED por ocupação está disponível para UFs e para o Brasil.', 'CAGED by occupation is available for states and Brazil.'));
    const lista = prefixos(q.cbo, 6);
    if (!lista.length) return [];
    if (lista.some((c) => c.length > 4)) {
      throw new Error(t('No CAGED o painel tem a ocupação até a família (4 dígitos): use 2512, não 251205.', 'In CAGED the dashboard has occupations down to the family (4 digits): use 2512, not 251205.'));
    }
    const cbo = prefixosSemSobreposicao(lista);
    return consultar(
      `SELECT c.competencia, sum(c.admissoes) AS admissoes, sum(c.desligamentos) AS desligamentos, sum(c.saldo) AS saldo,
              sum(c.salario_adm_soma) / nullif(sum(c.salario_adm_n), 0) AS salario_medio_admissao,
              sum(c.salario_adm_n) AS salario_adm_n, sum(c.salario_adm_fora) AS salario_adm_fora
       FROM read_parquet(${arq('gold/trabalho/caged_cbo.parquet')}) c
       WHERE c.escopo = '${e.escopo}' AND (${cbo.map((x) => `starts_with(c.cbo_familia, ${lit(x)})`).join(' OR ')})
       GROUP BY c.competencia ORDER BY c.competencia`,
      p,
    );
  },

  /** Municípios de uma UF (ou do Brasil) num ano da RAIS, com o saldo do CAGED do mesmo ano. */
  async trab_municipios(q) {
    await tabelasTrabalho();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const e = escopoTrabalho({ uf: q.uf }, p);
    // crescimento: vínculos ativos sobre o ano anterior da RAIS (mesmo município); o saldo do CAGED é do ano civil
    return consultar(
      `SELECT m.cod_ibge, m.nome, m.uf, m.populacao, m.empregos, a.empregos AS empregos_ano_anterior,
              (m.empregos - a.empregos) / nullif(a.empregos, 0) AS var_empregos,
              1000 * m.empregos / nullif(m.populacao, 0) AS empregos_por_mil,
              m.massa_dez / nullif(m.n_rem_dez, 0) AS remuneracao_media, m.n_rem_dez,
              m.mulheres / nullif(m.empregos, 0) AS pct_mulheres, m.superior / nullif(m.empregos, 0) AS pct_superior,
              m.empregos_adm_publica / nullif(m.empregos, 0) AS pct_adm_publica, m.estabelecimentos,
              c.saldo AS saldo_caged, c.meses AS meses_caged, c.saldo - c0.saldo AS saldo_caged_dif,
              c0.saldo AS saldo_caged_ano_anterior, c0.meses AS meses_caged_ano_anterior
       FROM trab_municipios m
       LEFT JOIN trab_municipios a ON a.cod_ibge = m.cod_ibge AND a.ano = m.ano - 1
       LEFT JOIN trab_caged_anual c ON c.cod_ibge = m.cod_ibge AND c.ano = m.ano
       LEFT JOIN trab_caged_anual c0 ON c0.cod_ibge = m.cod_ibge AND c0.ano = m.ano - 1
       WHERE ${e.onde} AND m.ano = $ano::INTEGER ORDER BY m.empregos DESC`,
      p,
    );
  },
};

// ---------------- saúde (SIM, SINASC e população da SVS/MS) ----------------

/**
 * Ano × município de residência (~5 MB): população, óbitos, óbitos fetais e nascimentos (pipeline/saude.py).
 * Baixada só quando uma página da área de saúde pede. Códigos fora do cadastro (município ignorado) não têm
 * cod_ibge: entram nos totais da UF e do Brasil, nunca nos rankings.
 */
let saudeCarregada: Promise<void> | null = null;
export function tabelasSaude() {
  saudeCarregada ??= (async () => {
    const { con } = await iniciar();
    await db.registerFileBuffer('saude_municipios.parquet', await baixar('gold/saude/municipios.parquet'));
    await con.query(`CREATE TABLE saude_municipios AS SELECT * FROM read_parquet('saude_municipios.parquet')`);
  })();
  saudeCarregada.catch(() => (saudeCarregada = null));
  return saudeCarregada;
}

const CHAVES_SAUDE = 'ano, cod_ibge, municipio, nome, uf';

const rotasSaude: Record<string, (q: Params) => Promise<unknown>> = {
  /** Série anual do escopo (município, UF ou Brasil): somas de todas as contagens; as taxas saem na página. */
  async saude_serie(q) {
    await tabelasSaude();
    const p: Record<string, Valor> = {};
    const e = escopoTrabalho(q, p);
    return consultar(
      `SELECT ano, count(cod_ibge)::INTEGER AS municipios, sum(COLUMNS(* EXCLUDE (${CHAVES_SAUDE})))::DOUBLE
       FROM saude_municipios m WHERE ${e.onde} GROUP BY ano ORDER BY ano`,
      p,
    );
  },

  /** Municípios de uma UF (ou do Brasil) num ano, com as contagens; os indicadores saem na página. */
  async saude_municipios(q) {
    await tabelasSaude();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const e = escopoTrabalho({ uf: q.uf }, p);
    return consultar(
      `SELECT cod_ibge, nome, uf, COLUMNS(* EXCLUDE (${CHAVES_SAUDE}))::DOUBLE
       FROM saude_municipios m WHERE ${e.onde} AND m.ano = $ano::INTEGER AND m.cod_ibge IS NOT NULL ORDER BY m.nome`,
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
 * Classificações derivadas da natureza jurídica do estabelecimento (Tabela de Natureza Jurídica 2021,
 * CONCLA/IBGE). Setor institucional: o grupo 2 (entidades empresariais) se divide em empresas estatais
 * (201-1 empresa pública e 203-8 sociedade de economia mista) e privadas; o grupo 1 é a administração
 * pública. Esfera: pelo nome do código (federal, estadual/DF, municipal); consórcios, comissão
 * polinacional e o fundo público sem esfera ficam como interfederativos. 9999 e códigos fora da tabela: ignorado.
 */
const NJ_FEDERAL = [1015, 1040, 1074, 1104, 1139, 1163, 1252, 1287, 1317, 1341];
const NJ_ESTADUAL = [1023, 1058, 1082, 1112, 1147, 1171, 1236, 1260, 1295, 1325];
const NJ_MUNICIPAL = [1031, 1066, 1120, 1155, 1180, 1244, 1279, 1309, 1333];
const SETOR_INSTITUCIONAL = `CASE WHEN natureza_juridica BETWEEN 1000 AND 1999 THEN '1' WHEN natureza_juridica IN (2011, 2038) THEN '2'
  WHEN natureza_juridica BETWEEN 2000 AND 2999 THEN '3' WHEN natureza_juridica BETWEEN 3000 AND 3999 THEN '4'
  WHEN natureza_juridica BETWEEN 4000 AND 4999 THEN '5' WHEN natureza_juridica BETWEEN 5000 AND 5999 THEN '6' ELSE '9' END`;
const ESFERA_ADM = `CASE WHEN natureza_juridica IN (${NJ_FEDERAL}) THEN '1' WHEN natureza_juridica IN (${NJ_ESTADUAL}) THEN '2'
  WHEN natureza_juridica IN (${NJ_MUNICIPAL}) THEN '3' WHEN natureza_juridica BETWEEN 1000 AND 1999 THEN '4'
  WHEN natureza_juridica BETWEEN 2000 AND 5999 THEN '8' ELSE '9' END`;
const NJ_GRUPO = `CASE WHEN natureza_juridica BETWEEN 1000 AND 5999 THEN (natureza_juridica // 1000)::VARCHAR ELSE '9' END`;
/** Agregação do tipo de vínculo da nota técnica da RAIS 2023 (MTE): contratos por lei estadual ou municipal entram em estatutários. */
const VINCULO_MTE = `CASE WHEN tipo_vinculo IN (10, 15, 20, 25, 60, 65, 70, 75) THEN '1'
  WHEN tipo_vinculo IN (30, 31, 35, 96, 97) THEN '2' WHEN tipo_vinculo IS NOT NULL THEN '3' END`;
/** Jornada contratual semanal: válida de 1 a 44 horas (limite constitucional); fora disso, não entra no valor por hora. */
const HORAS_VALIDAS = 'horas_contratadas BETWEEN 1 AND 44';
const FAIXA_HORAS = `CASE WHEN horas_contratadas BETWEEN 1 AND 20 THEN '1' WHEN horas_contratadas BETWEEN 21 AND 30 THEN '2'
  WHEN horas_contratadas BETWEEN 31 AND 39 THEN '3' WHEN horas_contratadas = 40 THEN '4' WHEN horas_contratadas BETWEEN 41 AND 44 THEN '5' ELSE '9' END`;
/** Tempo no emprego em meses, como na RAIS. */
const FAIXA_TEMPO = `CASE WHEN tempo_emprego IS NULL OR tempo_emprego < 0 THEN '9' WHEN tempo_emprego < 3 THEN '1' WHEN tempo_emprego < 12 THEN '2'
  WHEN tempo_emprego < 24 THEN '3' WHEN tempo_emprego < 60 THEN '4' WHEN tempo_emprego < 120 THEN '5' ELSE '6' END`;
/**
 * Remuneração de dezembro válida: vínculo ativo em 31/12 com valor maior que zero. Até a RAIS 2022 a falta
 * de valor vem como 0 no arquivo; desde 2023, em branco (ausente). As duas ficam fora da média e são contadas à parte.
 */
const REM_VALIDA = 'ativo_31_12 = 1 AND rem_dezembro_nom > 0';
/** Mês ÷ semana: 52 semanas ÷ 12 meses. Valor por hora contratada (não por hora trabalhada). */
const SEMANAS_MES = '(52.0 / 12)';

/** Nomes das classificações derivadas (não estão no dicionário do PDET). */
const DERIVADAS: [string, string, string][] = [
  ['natureza_juridica_grupo', '9', 'Ignorado (9999 ou código fora da tabela)'],
  ['setor_institucional', '1', 'Administração pública (natureza jurídica do grupo 1)'],
  ['setor_institucional', '2', 'Empresas estatais (empresa pública e sociedade de economia mista)'],
  ['setor_institucional', '3', 'Empresas privadas (demais entidades empresariais)'],
  ['setor_institucional', '4', 'Entidades sem fins lucrativos'],
  ['setor_institucional', '5', 'Pessoas físicas empregadoras'],
  ['setor_institucional', '6', 'Organizações internacionais'],
  ['setor_institucional', '9', 'Ignorado ou código sem classificação'],
  ['esfera_adm', '1', 'Federal'], ['esfera_adm', '2', 'Estadual ou distrital'], ['esfera_adm', '3', 'Municipal'],
  ['esfera_adm', '4', 'Interfederativa ou sem esfera (consórcios públicos, comissão polinacional, fundo público)'],
  ['esfera_adm', '8', 'Fora da administração pública'], ['esfera_adm', '9', 'Ignorado'],
  ['vinculo_mte', '1', 'Celetista'], ['vinculo_mte', '2', 'Estatutário (inclui contratos por lei estadual ou municipal)'], ['vinculo_mte', '3', 'Outros'],
  ['faixa_horas', '1', 'Até 20 horas'], ['faixa_horas', '2', '21 a 30 horas'], ['faixa_horas', '3', '31 a 39 horas'],
  ['faixa_horas', '4', '40 horas'], ['faixa_horas', '5', '41 a 44 horas'], ['faixa_horas', '9', 'Não informada ou fora de 1 a 44 horas'],
  ['faixa_tempo', '1', 'Menos de 3 meses'], ['faixa_tempo', '2', '3 a 11 meses'], ['faixa_tempo', '3', '1 ano a menos de 2'],
  ['faixa_tempo', '4', '2 a menos de 5 anos'], ['faixa_tempo', '5', '5 a menos de 10 anos'], ['faixa_tempo', '6', '10 anos ou mais'],
  ['faixa_tempo', '9', 'Não informado'],
];

/**
 * Fontes da consulta: os microdados (um arquivo por ano e UF, ~1–3 GB por ano), quando publicados (há
 * silver/trabalho/micro/indice.json no R2 ou, no servidor local do Vite, na pasta dos microdados), para UFs e
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
  cbo_familia: { micro: 'cbo[1:4]', cubo_uf: 'cbo[1:4]', nome: 'cbo_familia' },
  cbo: { micro: 'cbo', cubo_uf: 'cbo', nome: 'cbo' },
  sexo: { micro: 'sexo::VARCHAR', cubo_uf: 'sexo::VARCHAR', cubo_mun: 'sexo::VARCHAR', nome: 'sexo' },
  situacao: { micro: `(${SITUACAO})::VARCHAR`, cubo_uf: 'situacao::VARCHAR', cubo_mun: 'situacao::VARCHAR', nome: 'situacao' },
  faixa_idade: { micro: FAIXA_IDADE, nome: 'faixa_idade' },
  escolaridade: { micro: 'escolaridade::VARCHAR', nome: 'escolaridade' },
  raca_cor: { micro: 'raca_cor::VARCHAR', nome: 'raca_cor' },
  tipo_vinculo: { micro: 'tipo_vinculo::VARCHAR', nome: 'tipo_vinculo' },
  vinculo_mte: { micro: VINCULO_MTE, nome: 'vinculo_mte' },
  natureza_juridica_grupo: { micro: NJ_GRUPO, nome: 'natureza_juridica_grupo' },
  natureza_juridica: { micro: 'natureza_juridica::VARCHAR', nome: 'natureza_juridica' },
  setor_institucional: { micro: SETOR_INSTITUCIONAL, nome: 'setor_institucional' },
  esfera_adm: { micro: ESFERA_ADM, nome: 'esfera_adm' },
  tamanho_estab: { micro: 'tamanho_estab::VARCHAR', nome: 'tamanho_estab' },
  faixa_horas: { micro: FAIXA_HORAS, nome: 'faixa_horas' },
  faixa_tempo: { micro: FAIXA_TEMPO, nome: 'faixa_tempo' },
  causa_afastamento: { micro: 'causa_afastamento_1::VARCHAR', nome: 'causa_afastamento' },
  motivo_desligamento: { micro: 'motivo_desligamento::VARCHAR', nome: 'motivo_desligamento' },
};
export const gruposDaFonte = (fonte: FonteConsulta) => Object.keys(GRUPOS).filter((k) => GRUPOS[k][fonte]);

/**
 * Filtros por lista de códigos (só nos microdados): o vínculo entra se o valor estiver na lista (união
 * dentro do filtro); filtros diferentes se somam por interseção. Os códigos são os da variável (ex.:
 * escolaridade 9, 10, 11) ou das classificações derivadas acima.
 */
export const FILTROS_LISTA: Record<string, { expr: string; variavel: string }> = {
  idade: { expr: FAIXA_IDADE, variavel: 'faixa_idade' },
  esc: { expr: 'escolaridade::VARCHAR', variavel: 'escolaridade' },
  raca: { expr: 'raca_cor::VARCHAR', variavel: 'raca_cor' },
  si: { expr: SETOR_INSTITUCIONAL, variavel: 'setor_institucional' },
  esf: { expr: ESFERA_ADM, variavel: 'esfera_adm' },
  njg: { expr: NJ_GRUPO, variavel: 'natureza_juridica_grupo' },
  nj: { expr: 'natureza_juridica::VARCHAR', variavel: 'natureza_juridica' },
  tv: { expr: 'tipo_vinculo::VARCHAR', variavel: 'tipo_vinculo' },
  vmte: { expr: VINCULO_MTE, variavel: 'vinculo_mte' },
  tam: { expr: 'tamanho_estab::VARCHAR', variavel: 'tamanho_estab' },
  horas: { expr: FAIXA_HORAS, variavel: 'faixa_horas' },
  tempo: { expr: FAIXA_TEMPO, variavel: 'faixa_tempo' },
};

const MEDIDAS_MICRO = `
  count(*) AS vinculos,
  count(*) FILTER (ativo_31_12 = 1) AS ativos,
  count(*) FILTER (${SITUACAO} = 2) AS desligados,
  count(*) FILTER (${AFASTADO}) AS afastados,
  avg(dias_afastamento) FILTER (${AFASTADO}) AS dias_afastamento_medio,
  count(*) FILTER (sexo = 2) AS mulheres,
  count(*) FILTER (escolaridade >= 9) AS superior,
  sum(rem_dezembro_nom) FILTER (${REM_VALIDA})::DOUBLE AS rem_dez_soma,
  count(*) FILTER (${REM_VALIDA}) AS n_rem_dez,
  count(*) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom IS NULL) AS rem_dez_ausente,
  count(*) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom = 0) AS rem_dez_zero,
  count(*) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom < 0) AS rem_dez_negativa,
  sum(rem_dezembro_nom) FILTER (${REM_VALIDA})::DOUBLE / nullif(count(*) FILTER (${REM_VALIDA}), 0) AS rem_dez_media,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.1) FILTER (${REM_VALIDA}) AS rem_dez_p10,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.25) FILTER (${REM_VALIDA}) AS rem_dez_p25,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.5) FILTER (${REM_VALIDA}) AS rem_dez_mediana,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.75) FILTER (${REM_VALIDA}) AS rem_dez_p75,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.9) FILTER (${REM_VALIDA}) AS rem_dez_p90,
  sum(rem_dezembro_nom) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS})::DOUBLE
    / nullif(sum(horas_contratadas * ${SEMANAS_MES}) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS}), 0) AS rem_hora_media,
  median(rem_dezembro_nom::DOUBLE / (horas_contratadas * ${SEMANAS_MES})) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS}) AS rem_hora_mediana,
  count(*) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS}) AS n_rem_hora,
  sum(rem_media_nom) FILTER (rem_media_nom > 0)::DOUBLE / nullif(count(*) FILTER (rem_media_nom > 0), 0) AS rem_media_media,
  median(rem_media_nom::DOUBLE) FILTER (rem_media_nom > 0) AS rem_media_mediana,
  count(*) FILTER (rem_media_nom > 0) AS n_rem_media,
  avg(horas_contratadas) FILTER (horas_contratadas > 0) AS horas_media,
  avg(idade) AS idade_media`;

// o cubo guarda somas e contagens: médias saem como soma ÷ contagem; medianas e percentis não são somáveis
const MEDIDAS_CUBO = `
  coalesce(sum(vinculos), 0)::DOUBLE AS vinculos,
  coalesce(sum(vinculos) FILTER (situacao = 1), 0)::DOUBLE AS ativos,
  coalesce(sum(vinculos) FILTER (situacao = 2), 0)::DOUBLE AS desligados,
  coalesce(sum(vinculos) FILTER (afastado), 0)::DOUBLE AS afastados,
  sum(dias_afastamento) FILTER (afastado) / nullif(sum(vinculos) FILTER (afastado), 0) AS dias_afastamento_medio,
  coalesce(sum(vinculos) FILTER (sexo = 2), 0)::DOUBLE AS mulheres,
  coalesce(sum(superior), 0)::DOUBLE AS superior,
  sum(rem_dez_soma) AS rem_dez_soma,
  coalesce(sum(rem_dez_n), 0)::DOUBLE AS n_rem_dez,
  NULL::DOUBLE AS rem_dez_ausente, NULL::DOUBLE AS rem_dez_zero, NULL::DOUBLE AS rem_dez_negativa,
  sum(rem_dez_soma) / nullif(sum(rem_dez_n), 0) AS rem_dez_media,
  NULL::DOUBLE AS rem_dez_p10, NULL::DOUBLE AS rem_dez_p25, NULL::DOUBLE AS rem_dez_mediana, NULL::DOUBLE AS rem_dez_p75, NULL::DOUBLE AS rem_dez_p90,
  NULL::DOUBLE AS rem_hora_media, NULL::DOUBLE AS rem_hora_mediana, NULL::DOUBLE AS n_rem_hora,
  sum(rem_media_soma) / nullif(sum(rem_media_n), 0) AS rem_media_media,
  NULL::DOUBLE AS rem_media_mediana,
  coalesce(sum(rem_media_n), 0)::DOUBLE AS n_rem_media,
  sum(horas_soma) / nullif(sum(horas_n), 0) AS horas_media,
  sum(idade_soma) / nullif(sum(idade_n), 0) AS idade_media`;

/** '4711, 56; 2124' → ['4711', '56', '2124']: só dígitos, até `max` por código e 60 códigos. */
const prefixos = (v: unknown, max: number) =>
  String(v ?? '').split(/[\s,;]+/).map((s) => s.replace(/\D/g, '')).filter((s) => s.length > 0 && s.length <= max).slice(0, 60);

/**
 * Prefixos sem os que já estão dentro de outro da lista ("2512, 251205" → "2512"). O filtro já conta cada
 * vínculo uma vez (é um OU sobre as linhas), mas a lista limpa deixa o recorte claro nos metadados.
 */
export function prefixosSemSobreposicao(lista: string[]): string[] {
  const unicos = [...new Set(lista)].sort((a, b) => a.length - b.length || a.localeCompare(b));
  return unicos.filter((c, i) => !unicos.slice(0, i).some((p) => c.startsWith(p)));
}

// ---------- etapas e cancelamento das consultas de microdados ----------

/** Etapa em andamento de cada consulta de microdados (para a página mostrar o que está acontecendo). */
const etapas = new Map<number, string>();
const ouvintesEtapa = new Set<() => void>();
let proximaEtapa = 0;
let ultimaEtapa: string | null = null;
function avisarEtapa(id: number, texto: string | null) {
  if (texto === null) etapas.delete(id);
  else etapas.set(id, texto);
  ultimaEtapa = [...etapas.values()].at(-1) ?? null;
  for (const f of ouvintesEtapa) f();
}
export const etapaAtual = () => ultimaEtapa;
export function aoMudarEtapa(f: () => void) {
  ouvintesEtapa.add(f);
  return () => void ouvintesEtapa.delete(f);
}

/**
 * Conexão só das consultas de microdados do mercado de trabalho: cancelar uma (botão Cancelar) pede ao
 * DuckDB que pare, sem interromper as outras páginas. Nos testes há uma conexão só.
 */
let conexaoDoTrabalho: Promise<duckdb.AsyncDuckDBConnection> | null = null;
async function conexaoTrabalho(): Promise<duckdb.AsyncDuckDBConnection> {
  const { con } = await iniciar();
  if (lerLocal || typeof db.connect !== 'function') return con;
  conexaoDoTrabalho ??= db.connect();
  conexaoDoTrabalho.catch(() => (conexaoDoTrabalho = null));
  return conexaoDoTrabalho;
}
let abortoTrabalho = new AbortController();
/** Cancela as consultas de microdados em andamento (as próximas usam um sinal novo). */
export function cancelarConsultasTrabalho() {
  abortoTrabalho.abort();
  abortoTrabalho = new AbortController();
}

/** SQL para mostrar e exportar: uma linha por cláusula, sem a indentação do código. */
const semEspacos = (sql: string) => sql.replace(/\n\s+/g, '\n').trim();

/** Literal SQL de um texto já conferido (só dígitos e letras): as consultas de microdados rodam sem parâmetros, para poderem ser canceladas. */
const lit = (v: Valor) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/**
 * Uma consulta de cada vez na conexão do trabalho: lidas por partes (para poderem ser canceladas), duas
 * consultas simultâneas na mesma conexão misturariam os resultados. As da fila esperam a anterior terminar.
 */
let filaTrabalho: Promise<unknown> = Promise.resolve();
function consultarTrabalho(sql: string, etapa: string): Promise<Linha[]> {
  const sinal = abortoTrabalho.signal;
  const vez = filaTrabalho.catch(() => undefined).then(async () => {
    const id = proximaEtapa++;
    avisarEtapa(id, etapa);
    try {
      const con = await conexaoTrabalho();
      const r = await lerCancelavel(con, sql, sinal);
      return r.linhas.map((o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, normalizar(v)])));
    } finally {
      avisarEtapa(id, null);
    }
  });
  filaTrabalho = vez;
  return vez;
}

/** Fator do IPCA de dezembro para R$ de dezembro do ano-base: índice do ano-base ÷ índice do ano. */
async function fatoresIpca(): Promise<{ base: number; fatores: Record<number, number> }> {
  const { manifesto } = await iniciar();
  const linhas = await consultar(`SELECT i.exercicio, b.indice / i.indice AS fator FROM ipca i CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b`,
    { base: manifesto.base_ipca });
  return { base: manifesto.base_ipca, fatores: Object.fromEntries(linhas.map((l) => [Number(l.exercicio), Number(l.fator)])) };
}

const SIGLAS: Record<number, string> = {
  11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE',
  27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF',
};

/**
 * Monta a origem e os filtros de uma consulta da RAIS para os anos pedidos, na fonte de fonteConsulta.
 * Filtros: cnae e cbo (listas de prefixos), situacao (ativos, nao_ativos, desligados, afastados), sexo,
 * muns (municípios IBGE de 7 dígitos dentro da UF) e as listas de FILTROS_LISTA (só nos microdados).
 */
async function planoConsulta(q: Params, anos: number[]) {
  await dicionarioTrabalho();
  const ente = inteiro(q.ente);
  const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
  const fonte = fonteConsulta({ ente, uf });
  const filtros: string[] = [];
  let ufCod: number | null = null;
  if (ente) {
    const cod = ente === 53 ? 5300108 : ente;
    ufCod = Math.floor(cod / 100000);
    filtros.push(`municipio = ${Math.floor(cod / 10)}`); // a RAIS usa o código IBGE de 6 dígitos
  } else if (uf) {
    const [u] = await consultar(`SELECT cod_ibge FROM entes WHERE esfera IN ('E', 'D') AND uf = $uf`, { uf });
    ufCod = Number(u?.cod_ibge);
    if (fonte !== 'micro') filtros.push(fonte === 'cubo_uf' ? `uf = ${ufCod}` : `municipio // 10000 = ${ufCod}`);
  }
  const lista = (caminhos: string[]) => `read_parquet([${caminhos.map(arq).join(', ')}])`;
  const origem = lista(anos.map((a) => (fonte === 'micro'
    ? `silver/trabalho/micro/rais_vinculos/ano=${a}/uf=${ufCod}.parquet`
    : `gold/trabalho/${fonte}/ano=${a}.parquet`)));

  const col = COLUNAS_CONSULTA[fonte];
  const codigos = (v: unknown, max: number, nome: string) => {
    const l = prefixos(v, 7);
    if (l.some((c) => c.length > max)) {
      throw new Error(t(`Neste recorte a ${nome} aceita códigos de até ${max} dígito(s).`, `For this scope ${nome} accepts codes of up to ${max} digit(s).`));
    }
    return prefixosSemSobreposicao(l);
  };
  const cnae = codigos(q.cnae, col.maxCnae, 'CNAE');
  if (cnae.length) filtros.push(`(${cnae.map((c) => `starts_with(${col.cnae}, ${lit(c)})`).join(' OR ')})`);
  const cbo = codigos(q.cbo, col.maxCbo, 'CBO');
  if (cbo.length) filtros.push(`(${cbo.map((c) => `starts_with(${col.cbo}, ${lit(c)})`).join(' OR ')})`);
  const sit = fonte === 'micro' ? SITUACAO : 'situacao';
  const situacoes: Record<string, string> = {
    ativos: `${sit} = 1`, nao_ativos: `${sit} <> 1`, desligados: `${sit} = 2`,
    afastados: fonte === 'micro' ? AFASTADO : 'afastado',
  };
  if (situacoes[String(q.situacao)]) filtros.push(situacoes[String(q.situacao)]);
  if (q.sexo === '1' || q.sexo === '2') filtros.push(`sexo = ${q.sexo}`);
  const muns = prefixos(q.muns, 7).filter((c) => c.length === 7 && (!ufCod || Math.floor(Number(c) / 100000) === ufCod));
  const usados: string[] = [];
  if (muns.length) {
    if (fonte === 'cubo_uf') usados.push(t('municípios', 'municipalities'));
    else filtros.push(`municipio IN (${muns.map((c) => Math.floor(Number(c) / 10)).join(', ')})`);
  }
  for (const [k, f] of Object.entries(FILTROS_LISTA)) {
    const valores = String(q[k] ?? '').split(/[\s,;]+/).filter((s) => /^[0-9]{1,4}$/.test(s)).slice(0, 60);
    if (!valores.length) continue;
    if (fonte !== 'micro') usados.push(k);
    else filtros.push(`${f.expr} IN (${valores.map(lit).join(', ')})`);
  }
  if (usados.length) {
    throw new Error(t(
      `Os filtros ${usados.join(', ')} precisam dos microdados, que esta consulta não usa para o Brasil: escolha uma UF ou um município.`,
      `Filters ${usados.join(', ')} need the microdata, which this query does not use for Brazil: choose a state or a municipality.`,
    ));
  }
  const rotuloUf = ufCod ? SIGLAS[ufCod] ?? String(ufCod) : t('Brasil', 'Brazil');
  return { fonte, origem, onde: filtros.length ? filtros.join(' AND ') : 'true', rotuloUf };
}

/** Expressão do nome de um grupo (coluna `c` do resultado agrupado). */
function nomeDoGrupo(grupo: Grupo, c: string) {
  return ({
    uf: `(SELECT e.uf FROM entes e WHERE e.esfera IN ('E', 'D') AND e.cod_ibge::VARCHAR = g.${c})`,
    municipio: `(SELECT e.nome FROM entes e WHERE e.esfera = 'M' AND (e.cod_ibge // 10)::VARCHAR = g.${c})`,
    secao: `(SELECT any_value(cn.secao_nome) FROM trab_cnae cn WHERE cn.secao = g.${c})`,
    divisao: `(SELECT any_value(cn.divisao_nome) FROM trab_cnae cn WHERE cn.divisao = g.${c})`,
  } as Record<string, string>)[grupo.nome ?? ''] ??
    (grupo.nome ? `(SELECT any_value(d.descricao) FROM trab_dic d WHERE d.variavel = '${grupo.nome}' AND d.codigo = g.${c})` : 'NULL');
}

function grupoDe(chave: unknown, fonte: FonteConsulta) {
  const grupo = GRUPOS[String(chave ?? 'total')] ?? GRUPOS.total;
  const expr = grupo[fonte];
  if (!expr) throw new Error(t('Este agrupamento não está disponível para este recorte.', 'This grouping is not available for this scope.'));
  return { grupo, expr, chave: String(chave ?? 'total') };
}

/** A seção da CNAE vem da divisão: só junta a tabela de nomes quando um agrupamento pede. */
const comSecao = (origem: string, fonte: FonteConsulta, precisa: boolean) => (precisa
  ? `(SELECT v.*, cn.secao FROM ${origem} v LEFT JOIN trab_cnae cn ON cn.divisao = ${fonte === 'cubo_mun' ? 'v.cnae_divisao' : 'v.cnae_classe[1:2]'})`
  : origem);

const rotasConsulta: Record<string, (q: Params) => Promise<unknown>> = {
  /**
   * Consulta personalizada da RAIS num ano, na fonte de fonteConsulta: microdados (quando publicados; um
   * arquivo por ano e UF, lido por Range: as colunas usadas e, para um município, só o trecho dele) ou as
   * tabelas pré-somadas (somas e contagens, sem medianas). agrupar e agrupar2 (cruzamento de duas dimensões);
   * limite: grupos devolvidos (padrão 3.000; a exportação pede todos, até 200.000). grupos_total: grupos existentes.
   */
  async trab_consulta(q) {
    const ano = inteiro(q.ano)!;
    const plano = await planoConsulta(q, [ano]);
    const g1 = grupoDe(q.agrupar, plano.fonte);
    const g2 = q.agrupar2 && q.agrupar2 !== 'total' && q.agrupar2 !== q.agrupar ? grupoDe(q.agrupar2, plano.fonte) : null;
    const limite = Math.min(Math.max(inteiro(q.limite) ?? 3000, 1), 200_000);
    const base = comSecao(plano.origem, plano.fonte, g1.chave === 'cnae_secao' || g2?.chave === 'cnae_secao');
    const sql = `SELECT g.*, ${nomeDoGrupo(g1.grupo, 'grupo')} AS nome${g2 ? `, ${nomeDoGrupo(g2.grupo, 'grupo2')} AS nome2` : ''},
              count(*) OVER () AS grupos_total
       FROM (SELECT ${g1.expr} AS grupo${g2 ? `, ${g2.expr} AS grupo2` : ''}, ${plano.fonte === 'micro' ? MEDIDAS_MICRO : MEDIDAS_CUBO}
             FROM ${base} WHERE ${plano.onde} GROUP BY ALL) g
       ORDER BY g.vinculos DESC LIMIT ${limite}`;
    const linhas = await consultarTrabalho(
      sql,
      plano.fonte === 'micro'
        ? t(`Lendo os microdados da RAIS ${ano} (${plano.rotuloUf}): só as colunas e os trechos do recorte`, `Reading RAIS ${ano} microdata (${plano.rotuloUf}): only the columns and row groups needed`)
        : t(`Somando a tabela pré-somada da RAIS ${ano}`, `Summing the RAIS ${ano} pre-aggregated table`),
    );
    const { base: baseIpca, fatores } = await fatoresIpca();
    return { fonte: plano.fonte, linhas, ano, base_ipca: baseIpca, fator_real: fatores[ano] ?? null, sql: semEspacos(sql) };
  },

  /**
   * A mesma consulta ano a ano (de ... ate, só os anos com dados), opcionalmente agrupada: uma linha por ano
   * (e grupo), com o fator do IPCA de cada ano para os valores reais.
   */
  async trab_consulta_serie(q) {
    const { manifesto } = await iniciar();
    const disponiveis = ((manifesto.fontes?.rais_micro?.anos as number[] | undefined) ?? []).filter(Number.isInteger);
    const de = inteiro(q.de) ?? disponiveis[0];
    const ate = inteiro(q.ate) ?? disponiveis.at(-1);
    const anos = disponiveis.filter((a) => a >= de && a <= ate!);
    if (!anos.length) return { fonte: fonteConsulta({ ente: q.ente, uf: q.uf }), linhas: [], anos: [], base_ipca: manifesto.base_ipca, fatores: {} };
    const plano = await planoConsulta(q, anos);
    const g1 = grupoDe(q.agrupar, plano.fonte);
    const base = comSecao(plano.origem, plano.fonte, g1.chave === 'cnae_secao');
    const sql = `SELECT g.*, ${nomeDoGrupo(g1.grupo, 'grupo')} AS nome
       FROM (SELECT ano::INTEGER AS ano, ${g1.expr} AS grupo, ${plano.fonte === 'micro' ? MEDIDAS_MICRO : MEDIDAS_CUBO}
             FROM ${base} WHERE ${plano.onde} GROUP BY ALL) g
       ORDER BY g.ano, g.vinculos DESC LIMIT 20000`;
    const linhas = await consultarTrabalho(
      sql,
      plano.fonte === 'micro'
        ? t(`Lendo os microdados da RAIS de ${anos[0]} a ${anos.at(-1)} (${plano.rotuloUf}), um arquivo por ano`, `Reading RAIS microdata ${anos[0]}–${anos.at(-1)} (${plano.rotuloUf}), one file per year`)
        : t(`Somando as tabelas pré-somadas da RAIS de ${anos[0]} a ${anos.at(-1)}`, `Summing the RAIS pre-aggregated tables ${anos[0]}–${anos.at(-1)}`),
    );
    const { base: baseIpca, fatores } = await fatoresIpca();
    return { fonte: plano.fonte, linhas, anos, base_ipca: baseIpca, fatores, sql: semEspacos(sql) };
  },

  /**
   * Perfil de um recorte num ano: as distribuições por várias dimensões numa leitura só do arquivo (GROUPING
   * SETS), uma linha por dimensão e grupo, com as mesmas medidas da consulta. Dimensões que a fonte não tem
   * (tabelas pré-somadas) ficam de fora de `dimensoes` e a página mostra a tabela como indisponível.
   */
  async trab_perfil(q) {
    const ano = inteiro(q.ano)!;
    const plano = await planoConsulta(q, [ano]);
    const pedidas = String(q.dimensoes ?? '').split(',').filter((d) => GRUPOS[d] && d !== 'total');
    const dimensoes = pedidas.filter((d) => GRUPOS[d][plano.fonte]);
    const base = comSecao(plano.origem, plano.fonte, dimensoes.includes('cnae_secao'));
    const colunas = dimensoes.map((d, i) => `${GRUPOS[d][plano.fonte]} AS d${i}`).join(', ');
    const rotulo = dimensoes.length
      ? `CASE ${dimensoes.map((d, i) => `WHEN grouping(d${i}) = 0 THEN '${d}'`).join(' ')} ELSE 'total' END`
      : `'total'`;
    const grupo = dimensoes.length ? `coalesce(${dimensoes.map((_, i) => `CASE WHEN grouping(d${i}) = 0 THEN d${i}::VARCHAR END`).join(', ')})` : 'NULL';
    const nomes = dimensoes.map((d) => `WHEN '${d}' THEN ${nomeDoGrupo(GRUPOS[d], 'grupo')}`).join(' ');
    const sql = `SELECT g.*, ${dimensoes.length ? `CASE g.dimensao ${nomes} END` : 'NULL'} AS nome
       FROM (SELECT ${rotulo} AS dimensao, ${grupo} AS grupo, ${plano.fonte === 'micro' ? MEDIDAS_MICRO : MEDIDAS_CUBO}
             FROM (SELECT *${colunas ? `, ${colunas}` : ''} FROM ${base} WHERE ${plano.onde})
             GROUP BY GROUPING SETS ((), ${dimensoes.map((_, i) => `(d${i})`).join(', ')})) g
       ORDER BY g.dimensao, g.vinculos DESC`;
    const linhas = await consultarTrabalho(sql, plano.fonte === 'micro'
      ? t(`Lendo os microdados da RAIS ${ano} (${plano.rotuloUf}) uma vez para todas as tabelas do perfil`, `Reading RAIS ${ano} microdata (${plano.rotuloUf}) once for every profile table`)
      : t(`Somando a tabela pré-somada da RAIS ${ano}`, `Summing the RAIS ${ano} pre-aggregated table`));
    const { base: baseIpca, fatores } = await fatoresIpca();
    return { fonte: plano.fonte, ano, dimensoes, linhas, base_ipca: baseIpca, fator_real: fatores[ano] ?? null, sql: semEspacos(sql) };
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

  /**
   * Busca de ocupações em todos os níveis da CBO 2002 (grande grupo, subgrupo principal, subgrupo, família
   * e ocupação), pelo nome ou pelo começo do código, com o nível de cada achado e o nome da família.
   */
  async trab_busca_ocupacao(q) {
    await dicionarioTrabalho();
    const texto = String(q.texto ?? '').trim();
    if (texto.length < 2) return [];
    return consultar(
      `SELECT d.codigo, d.descricao, d.variavel AS nivel, f.descricao AS familia
       FROM trab_dic d LEFT JOIN trab_dic f ON f.variavel = 'cbo_familia' AND f.codigo = d.codigo[1:4] AND d.variavel = 'cbo'
       WHERE d.variavel IN ('cbo_grande_grupo', 'cbo_subgrupo_principal', 'cbo_subgrupo', 'cbo_familia', 'cbo')
         AND (strip_accents(lower(d.descricao)) LIKE '%' || strip_accents(lower($texto)) || '%' OR d.codigo LIKE $texto || '%')
       ORDER BY CASE WHEN d.codigo LIKE $texto || '%' THEN 0 ELSE 1 END, length(d.codigo), d.codigo LIMIT 40`,
      { texto },
    );
  },

  /** Todos os códigos de uma variável do dicionário (para listas de filtros), ou os de um prefixo. */
  async trab_codigos(q) {
    await dicionarioTrabalho();
    return consultar(
      `SELECT codigo, descricao FROM trab_dic WHERE variavel = $variavel AND codigo LIKE $prefixo || '%' ORDER BY codigo LIMIT 3000`,
      { variavel: String(q.variavel), prefixo: String(q.prefixo ?? '').replace(/\D/g, '') },
    );
  },
};

/** Manifesto como veio do servidor (para o Worker local da IA, que não tem o do R2). */
export async function manifestoDados() {
  return (await iniciar()).manifesto;
}

/** Cadastro de entes (municípios, estados, DF e União) para a IA achar e conferir códigos de território. */
export function cadastroEntes() {
  return consultar('SELECT cod_ibge, nome, uf, esfera FROM entes');
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
    // os seis grandes setores de trab_municipios em linhas (setor, vínculos): distribuição sem uma coluna por setor
    await con.query(`CREATE OR REPLACE VIEW trab_grandes_setores AS
      SELECT m.ano, m.cod_ibge, m.nome, m.uf, s.ordem, s.setor,
        CASE s.ordem WHEN 1 THEN m.empregos_agropecuaria WHEN 2 THEN m.empregos_industria WHEN 3 THEN m.empregos_construcao
          WHEN 4 THEN m.empregos_comercio WHEN 5 THEN m.empregos_servicos ELSE m.empregos_adm_publica END AS vinculos
      FROM trab_municipios m
      CROSS JOIN (VALUES (1, 'Agropecuária'), (2, 'Indústria'), (3, 'Construção'), (4, 'Comércio'), (5, 'Serviços'), (6, 'Administração pública')) s(ordem, setor)`)
      .catch(() => undefined); // sem trab_municipios (dados não publicados), a visão fica de fora
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
 * Conexão só das consultas da IA: cancelar uma delas (botão Cancelar da página /ia) não interrompe as
 * consultas dos painéis. Tabelas e visões ficam no mesmo banco em memória, visíveis às duas conexões.
 * Nos testes há uma conexão só.
 */
let conexaoDaIa: Promise<duckdb.AsyncDuckDBConnection> | null = null;
async function conexaoIa(): Promise<duckdb.AsyncDuckDBConnection> {
  const { con } = await iniciar();
  if (lerLocal || typeof db.connect !== 'function') return con;
  conexaoDaIa ??= db.connect();
  conexaoDaIa.catch(() => (conexaoDaIa = null));
  return conexaoDaIa;
}

type Lote = { schema: { fields: { name: string }[] }; toArray(): { toJSON(): unknown }[] };
type Leitor = { schema?: { fields: { name: string }[] }; next(): IteratorResult<Lote> | Promise<IteratorResult<Lote>> };
const cancelada = () => new DOMException(t('consulta cancelada', 'query cancelled'), 'AbortError');

/**
 * Roda a consulta por partes (send), para poder cancelá-la no meio: o sinal pede ao DuckDB que pare
 * (cancelSent) e a leitura das partes já recebidas é interrompida.
 */
async function lerCancelavel(con: duckdb.AsyncDuckDBConnection, sql: string, sinal?: AbortSignal) {
  if (sinal?.aborted) throw cancelada();
  const parar = () => void con.cancelSent().catch(() => undefined);
  sinal?.addEventListener('abort', parar, { once: true });
  try {
    const leitor = (await con.send(sql, true)) as unknown as Leitor;
    let colunas: string[] | null = null;
    const linhas: Record<string, unknown>[] = [];
    // next() serve aos dois leitores do Arrow: o assíncrono do navegador e o síncrono dos testes
    for (let r = await leitor.next(); !r.done; r = await leitor.next()) {
      if (sinal?.aborted) throw cancelada();
      colunas ??= r.value.schema.fields.map((f) => f.name);
      for (const l of r.value.toArray()) linhas.push(l.toJSON() as Record<string, unknown>);
    }
    return { colunas: colunas ?? leitor.schema?.fields.map((f) => f.name) ?? [], linhas };
  } catch (e) {
    if (sinal?.aborted) throw cancelada();
    throw e;
  } finally {
    sinal?.removeEventListener('abort', parar);
  }
}

/**
 * Consulta da IA (página /ia), já conferida por validarSql: roda sobre as tabelas em memória e traz
 * no máximo `limite` linhas, mais o total. As colunas saem na ordem do SELECT. Com `sinal`, pode ser
 * cancelada (o erro é um AbortError).
 */
export async function consultaLivre(sql: string, limite: number, sinal?: AbortSignal) {
  const con = await conexaoIa();
  const base = sql.trim().replace(/;\s*$/, '');
  const r = await lerCancelavel(con, `SELECT * FROM (${base}) AS consulta LIMIT ${limite}`, sinal);
  // a contagem roda a consulta de novo (pesado nos microdados): só quando o resultado passou do limite
  const total = r.linhas.length < limite
    ? r.linhas.length
    : Number((await lerCancelavel(con, `SELECT count(*) AS n FROM (${base}) AS consulta`, sinal)).linhas[0]?.n);
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
  const linhas = r.linhas.map((o) => r.colunas.map((c) => celula(o[c])));
  return { colunas: r.colunas, linhas, total };
}

export async function executar(caminho: string, params: Params): Promise<unknown> {
  const rota = rotas[caminho] ?? rotasLrf[caminho] ?? rotasSaudeEducacao[caminho] ?? rotasTrabalho[caminho] ?? rotasConsulta[caminho] ?? rotasSaude[caminho];
  if (!rota) throw new Error(`rota desconhecida: ${caminho}`);
  return rota(params);
}
