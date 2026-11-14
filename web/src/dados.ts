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
import { SQL_IPCA_BASE } from './ia_moeda';
import { indicador as indicadorSaude, type Indicador } from './saude_comum';
import { caminhoPerfis, disponibilidadePerfis, escopoDoPerfil, perfisComRemuneracao } from './trabalho_perfis';
import { CURADORIA } from './munic_curadoria';
import { ARQUIVOS_PAINEL, edicoesCuradas, lerEscolhas, paresPedidos, selecionar, usarArquivosLeves } from './munic_painel';
import CLIMA_PAINEL_SQL from './clima_painel.sql?raw';
import { criarAbertura, USAR_MOTOR } from './clima_abertura';
import { criarAberturaSaude } from './saude_abertura';
import { BASE_DADOS, injetarManifesto, obterManifesto, versaoDoManifesto, type ManifestoBruto } from './manifesto';

type Valor = string | number | boolean | null;
export type Linha = Record<string, Valor>;
type Params = Record<string, string | number | null | undefined>;

type Manifesto = ManifestoBruto;

const BASE = BASE_DADOS;

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
  injetarManifesto(manifesto);
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
    const manifesto = await manifestoCompartilhado();
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
    // valores reais em qualquer ano-base completo (ex.: 2021 com fatores referenciados a 2025), sem montar razões à mão
    await con.query(SQL_IPCA_BASE);
    await carregarIndiceMicro();
    return { con, manifesto };
  })();
  pronto.catch(() => (pronto = null));
  return pronto;
}

/** O manifesto único da sessão (o mesmo do caminho rápido do clima) e a versão dos URLs que sai dele. */
async function manifestoCompartilhado(): Promise<Manifesto> {
  const m = await obterManifesto((status) => `${t('manifesto indisponível', 'manifest unavailable')} (${status})`);
  versao = versaoDoManifesto(m);
  return m;
}

/**
 * URL de um arquivo de dados com a versão do manifesto no caminho (/dados/v/<versão>/...), para o
 * cache se renovar a cada atualização. Não pode ser "?v=": para o DuckDB, "?" é curinga de glob.
 */
let versao = '';
/**
 * Revisão do transporte HTTP, somada aos dígitos da versão no caminho (/dados/v/<versão><revisão>/…): invalida as entradas de
 * cache do navegador anteriores à correção dos intervalos (Range sobrepostos, Vary: Range no Worker). Não muda a chave no R2,
 * o manifesto nem o caminho dos testes locais; aumente só se o transporte voltar a exigir uma limpeza de cache.
 */
const REVISAO_CACHE_HTTP = '1';
const url = (caminho: string) => (caminhoLocal ? caminhoLocal(caminho) : `${BASE}v/${versao}${REVISAO_CACHE_HTTP}/${caminho}`);
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

  /** Contexto da saúde (/datasus): os mesmos meta e entes, com nome próprio para a abertura rápida interceptar só as rotas da saúde. */
  saude_meta: (q) => rotas.meta(q),
  saude_entes: (q) => rotas.entes(q),

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
   * Ranking completo dos municípios num exercício: posição nacional e na UF, página pedida, total elegível e a
   * posição do ente escolhido. As regras (elegibilidade e empates) são as da classificação comum
   * (baseFinancas e sqlClassificacao), as mesmas da evolução das posições.
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
    const ano = inteiro(q.ano);
    const p: Record<string, Valor> = { ano, de: ano, ate: ano, limite, offset: (pagina - 1) * limite };
    if (uf) p.uf = uf;
    if (ente) p.ente = ente;
    const base = `WITH ${sqlClassificacao(baseFinancas(campo, perCapita, trat), { ordem, constante: false })}`;
    const colunas = 'cod_ibge, nome, uf, populacao, valor, indicador, posicao_br, posicao_uf, total_br, total_uf';
    const noEscopo = uf ? 'WHERE uf = $uf' : '';
    const eUf = uf ? 'AND uf = $uf' : '';
    const [itens, [contagem], [doEnte]] = await Promise.all([
      consultar(`${base} SELECT ${colunas} FROM r ${noEscopo} ORDER BY ${uf ? 'posicao_uf' : 'posicao_br'}, nome LIMIT $limite OFFSET $offset`, p),
      consultar(
        `${base}, esc AS (SELECT * FROM base WHERE ano = $ano ${eUf})
         SELECT (SELECT count(*) FROM r ${noEscopo}) AS elegiveis,
                (SELECT count(*) FROM esc) AS com_dca,
                (SELECT count(*) FROM esc WHERE motivo = 'sem_valor') AS sem_valor,
                (SELECT count(*) FROM esc WHERE motivo IS NOT NULL AND motivo <> 'sem_valor') AS fora,
                (SELECT count(*) FROM r WHERE valor = 0 ${eUf}) AS zeros,
                (SELECT count(*) FROM r WHERE valor < 0 ${eUf}) AS negativos`,
        p,
      ),
      ente
        ? consultar(`${base} SELECT ${colunas} FROM r WHERE cod_ibge = $ente::INTEGER`, p)
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

  /**
   * Despesa em saúde por habitante do bloco SIOPS de /datasus: só ano, saude_hab e saude_proprios_hab, projetados de se_ente (um ente) ou
   * de se_grupo (municípios da UF ou do Brasil). Contrato privado da abertura rápida; se_ente e se_grupo continuam como são.
   */
  async saude_siops(q) {
    const linhas = (inteiro(q.ente) ? await rotasSaudeEducacao.se_ente({ ente: q.ente }) : await rotasSaudeEducacao.se_grupo({ esfera: 'M', uf: q.uf })) as Linha[];
    return linhas.map((r) => ({ ano: r.ano, saude_hab: r.saude_hab, saude_proprios_hab: r.saude_proprios_hab }));
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
   * Série anual da RAIS para o escopo: somas e médias como as do PDET/MTE (massa ÷ todos os vínculos ativos,
   * quem não tem valor de dezembro conta como zero), remuneração também em R$ reais do ano-base do IPCA.
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
              sum(m.mulheres) AS mulheres, sum(m.homens) AS homens, sum(m.superior) AS superior, sum(m.ate24) AS ate24, sum(m.de50mais) AS de50mais,
              ${setores},
              sum(m.massa_dez) AS massa_dez, sum(m.n_rem_dez) AS n_rem_dez,
              sum(m.massa_dez) * b.indice / i.indice AS massa_dez_real,
              sum(m.massa_dez) / nullif(sum(m.empregos), 0) AS remuneracao_media,
              sum(m.massa_dez) / nullif(sum(m.empregos), 0) * b.indice / i.indice AS remuneracao_media_real,
              sum(m.massa_dez_mulheres) / nullif(sum(m.mulheres), 0) AS remuneracao_mulheres,
              sum(m.massa_dez_homens) / nullif(sum(m.homens), 0) AS remuneracao_homens,
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

  /**
   * Perfis da RAIS (raça/cor, escolaridade, tipo de vínculo) de UM escopo e UM ano: lê só o Parquet pequeno do ano pedido
   * (gold/trabalho/perfis, ordenado por escopo: leitura por Range). Sem a fonte no manifesto, sem o ano ou com recorte inválido,
   * recusa: não há ano substituto nem zero no lugar de dado indisponível. O escopo é validado e entra como literal, sem cast na coluna.
   */
  async trab_perfis(q) {
    const { manifesto } = await iniciar();
    const ano = inteiro(q.ano);
    if (!disponibilidadePerfis(manifesto.fontes?.rais_perfis, ano).ok) {
      throw new Error(t(`perfis da RAIS indisponíveis para ${ano ?? 'o ano pedido'}`, `RAIS profiles unavailable for ${ano ?? 'the requested year'}`));
    }
    const escopo = escopoDoPerfil(q);
    if (!escopo) throw new Error(t('recorte inválido para os perfis da RAIS', 'invalid scope for the RAIS profiles'));
    return consultar(
      `SELECT ano, variavel, codigo, vinculos, total${perfisComRemuneracao(manifesto.fontes?.rais_perfis, ano as number) ? ', massa_dez_centavos, n_rem_dez, remuneracao_media_dez' : ''}
       FROM read_parquet(${arq(caminhoPerfis(ano as number, manifesto.fontes?.rais_perfis))})
       WHERE escopo = '${escopo.replace(/'/g, "''")}' ORDER BY variavel, codigo`,
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
    return consultar(`${sqlTrabMunicipios(`${e.onde} AND m.ano = $ano::INTEGER`)} ORDER BY m.empregos DESC`, p);
  },
};

/**
 * Indicadores municipais da RAIS por ano (os da página de rankings e da evolução das posições): crescimento =
 * vínculos ativos sobre o ano anterior da RAIS (mesmo município); o saldo do CAGED é do ano civil.
 */
function sqlTrabMunicipios(onde: string) {
  return `SELECT m.ano, m.cod_ibge, m.nome, m.uf, m.populacao, m.empregos, a.empregos AS empregos_ano_anterior,
              (m.empregos - a.empregos) / nullif(a.empregos, 0) AS var_empregos,
              1000 * m.empregos / nullif(m.populacao, 0) AS empregos_por_mil,
              m.massa_dez / nullif(m.empregos, 0) AS remuneracao_media, m.n_rem_dez,
              m.mulheres / nullif(m.empregos, 0) AS pct_mulheres, m.superior / nullif(m.empregos, 0) AS pct_superior,
              m.empregos_adm_publica / nullif(m.empregos, 0) AS pct_adm_publica, m.estabelecimentos,
              c.saldo AS saldo_caged, c.meses AS meses_caged, c.saldo - c0.saldo AS saldo_caged_dif,
              c0.saldo AS saldo_caged_ano_anterior, c0.meses AS meses_caged_ano_anterior
       FROM trab_municipios m
       LEFT JOIN trab_municipios a ON a.cod_ibge = m.cod_ibge AND a.ano = m.ano - 1
       LEFT JOIN trab_caged_anual c ON c.cod_ibge = m.cod_ibge AND c.ano = m.ano
       LEFT JOIN trab_caged_anual c0 ON c0.cod_ibge = m.cod_ibge AND c0.ano = m.ano - 1
       WHERE ${onde}`;
}

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

  /** Colunas da tabela de saúde carregada: as telas escondem o que a versão dos dados ainda não traz. */
  async saude_colunas() {
    await tabelasSaude();
    return consultar(`SELECT column_name FROM information_schema.columns WHERE table_name = 'saude_municipios' ORDER BY ordinal_position`);
  },

  /**
   * Atenção primária (relatórios da APS, valor de dezembro) do escopo, por ano, com os insumos da agregação. Somar o percentual de
   * cobertura dos municípios não faz sentido; a cobertura de uma UF ou do Brasil é derivada de numeradores e denominadores
   * compatíveis: população coberta ÷ população de referência, só dos municípios que têm o dado (`*_municipios`). Na atenção
   * básica (até 2020) e nos agentes comunitários a população coberta é a cobertura municipal × a população de referência; na
   * atenção primária (2021 em diante), a capacidade das equipes, sem limite de 100%. Grupos cuja coluna a versão dos dados
   * não tem ficam de fora da resposta, e a página diz que a medida é indisponível.
   */
  async saude_aps(q) {
    await tabelasSaude();
    const tem = new Set((await consultar(`SELECT column_name FROM information_schema.columns WHERE table_name = 'saude_municipios'`)).map((r) => String(r.column_name)));
    const p: Record<string, Valor> = {};
    const e = escopoTrabalho(q, p);
    const partes: string[] = [];
    if (tem.has('ab_cobertura') && tem.has('ab_populacao')) {
      partes.push(
        `sum(ab_cobertura * ab_populacao / 100) FILTER (WHERE ab_cobertura IS NOT NULL AND ab_populacao > 0)::DOUBLE AS ab_cobertos`,
        `sum(ab_populacao) FILTER (WHERE ab_cobertura IS NOT NULL AND ab_populacao > 0)::DOUBLE AS ab_pop`,
        `sum(ab_cobertura_sf * ab_populacao / 100) FILTER (WHERE ab_cobertura_sf IS NOT NULL AND ab_populacao > 0)::DOUBLE AS ab_sf_cobertos`,
        `sum(ab_populacao) FILTER (WHERE ab_cobertura_sf IS NOT NULL AND ab_populacao > 0)::DOUBLE AS ab_sf_pop`,
        `sum(ab_equipes_esf)::DOUBLE AS ab_equipes_esf`,
        `(count(*) FILTER (WHERE ab_cobertura IS NOT NULL AND ab_populacao > 0))::INTEGER AS ab_municipios`,
      );
    }
    if (tem.has('aps_capacidade') && tem.has('aps_populacao')) {
      partes.push(
        `sum(aps_capacidade) FILTER (WHERE aps_capacidade IS NOT NULL AND aps_populacao > 0)::DOUBLE AS aps_capacidade`,
        `sum(aps_populacao) FILTER (WHERE aps_capacidade IS NOT NULL AND aps_populacao > 0)::DOUBLE AS aps_pop`,
        `sum(aps_equipes_esf)::DOUBLE AS aps_equipes_esf`,
        `sum(aps_equipes_eap)::DOUBLE AS aps_equipes_eap`,
        `(count(*) FILTER (WHERE aps_capacidade IS NOT NULL AND aps_populacao > 0))::INTEGER AS aps_municipios`,
      );
    }
    if (tem.has('acs_cobertura') && tem.has('acs_populacao')) {
      partes.push(
        `sum(acs_cobertura * acs_populacao / 100) FILTER (WHERE acs_cobertura IS NOT NULL AND acs_populacao > 0)::DOUBLE AS acs_cobertos`,
        `sum(acs_populacao) FILTER (WHERE acs_cobertura IS NOT NULL AND acs_populacao > 0)::DOUBLE AS acs_pop`,
        `sum(acs_agentes)::DOUBLE AS acs_agentes`,
        `(count(*) FILTER (WHERE acs_cobertura IS NOT NULL AND acs_populacao > 0))::INTEGER AS acs_municipios`,
      );
    }
    if (!partes.length) return [];
    // municípios do recorte: os do cadastro e os que só existem nos relatórios da APS (ex.: Fernando de Noronha, sem código no cadastro)
    const temDado = ['ab_cobertura', 'aps_capacidade', 'acs_cobertura'].filter((c) => tem.has(c)).map((c) => `${c} IS NOT NULL`);
    return consultar(
      `SELECT ano, (count(*) FILTER (WHERE cod_ibge IS NOT NULL OR ${temDado.join(' OR ')}))::INTEGER AS municipios, ${partes.join(', ')}
       FROM saude_municipios m WHERE ${e.onde} GROUP BY ano ORDER BY ano`,
      p,
    );
  },

  /**
   * Registros sem município válido (município ignorado, sem cod_ibge) da UF ou do Brasil, por ano: entram nos totais de
   * UF e Brasil de saude_serie, e aqui saem à parte para a página mostrá-los separados.
   */
  async saude_ignorados(q) {
    await tabelasSaude();
    const p: Record<string, Valor> = {};
    const e = escopoTrabalho({ uf: q.uf }, p);
    return consultar(
      `SELECT ano, sum(COLUMNS(* EXCLUDE (${CHAVES_SAUDE})))::DOUBLE
       FROM saude_municipios m WHERE ${e.onde} AND m.cod_ibge IS NULL GROUP BY ano ORDER BY ano`,
      p,
    );
  },

  /**
   * Municípios com a soma das colunas pedidas numa janela de anos [de, ate] (ex.: o triênio): a razão do período é a
   * razão das somas. Cada coluna vem com n_<coluna>, os anos da janela com valor, para a página só aceitar quem tem todos.
   */
  async saude_janela(q) {
    await tabelasSaude();
    const de = inteiro(q.de);
    const ate = inteiro(q.ate);
    const colunas = String(q.colunas ?? '').split(',').filter((c) => /^[a-z][a-z0-9_]*$/.test(c)).slice(0, 8);
    if (!de || !ate || ate < de || !colunas.length) return [];
    const p: Record<string, Valor> = { de, ate };
    const e = escopoTrabalho({ uf: q.uf }, p);
    return consultar(
      `SELECT cod_ibge, nome, uf, ${colunas.map((c) => `sum(${c})::DOUBLE AS ${c}, count(${c})::INTEGER AS n_${c}`).join(', ')}
       FROM saude_municipios m WHERE ${e.onde} AND m.cod_ibge IS NOT NULL AND m.ano BETWEEN $de::INTEGER AND $ate::INTEGER
       GROUP BY cod_ibge, nome, uf ORDER BY nome`,
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

// ---------------- saúde: cobertura vacinal oficial por residência (PNI / InfoMS) ----------------

/**
 * Três tabelas independentes de saude_municipios (pipeline/vacinacao.py), baixadas só quando a página de vacinação ou a IA pedem:
 * saude_vacinacao (ano × município × imunobiológico, ~10 MB), saude_vacinacao_territorios (Brasil, regiões e UFs: totalizadores
 * oficiais) e saude_vacinacao_catalogo (rótulo, método e meta de cada imunobiológico por ano). A cobertura é razão (0–1) e só existe
 * com denominador positivo; UF e Brasil vêm dos totalizadores oficiais, nunca da média dos municípios. O nome do município vem do cadastro.
 */
let vacinacaoCarregada: Promise<void> | null = null;
export function tabelasVacinacao() {
  vacinacaoCarregada ??= (async () => {
    const { con } = await iniciar();
    const arquivos = [['saude_vacinacao', 'vacinacao'], ['saude_vacinacao_territorios', 'vacinacao_territorios'], ['saude_vacinacao_catalogo', 'vacinacao_catalogo']] as const;
    // primeiro baixa TUDO: uma falha em qualquer arquivo não deixa tabela instalada pela metade
    const dados = await Promise.all(arquivos.map(async ([tabela, arquivo]) => [tabela, await baixar(`gold/saude/${arquivo}.parquet`)] as const));
    // CREATE OR REPLACE só nestas três tabelas: refazer a inicialização depois de uma falha é seguro e não toca em outros domínios
    for (const [tabela, bytes] of dados) {
      await db.registerFileBuffer(`${tabela}.parquet`, bytes);
      await con.query(tabela === 'saude_vacinacao'
        ? `CREATE OR REPLACE TABLE saude_vacinacao AS SELECT v.*, e.nome FROM read_parquet('saude_vacinacao.parquet') v
           LEFT JOIN entes e ON e.cod_ibge = v.cod_ibge AND e.esfera = 'M' ORDER BY v.ano, v.imunobiologico, v.municipio`
        : `CREATE OR REPLACE TABLE ${tabela} AS SELECT * FROM read_parquet('${tabela}.parquet')`);
    }
  })();
  vacinacaoCarregada.catch(() => (vacinacaoCarregada = null));
  return vacinacaoCarregada;
}

/** Só testes: troca o leitor compartilhado; cada domínio tem seu próprio reset abaixo. */
export function usarLeituraNoTeste(ler: (caminho: string) => Promise<Uint8Array>) {
  lerLocal = ler;
}
export async function reiniciarVacinacaoNoTeste() {
  const { con } = await iniciar();
  for (const t of ['saude_vacinacao', 'saude_vacinacao_territorios', 'saude_vacinacao_catalogo']) await con.query(`DROP TABLE IF EXISTS ${t}`);
  vacinacaoCarregada = null;
}

/** Escopo da vacinação: município (tabela municipal), UF ou Brasil (totalizadores oficiais, nunca a soma ou a média dos municípios). */
function escopoVacinacao(q: Params, p: Record<string, Valor>) {
  const ente = inteiro(q.ente);
  if (ente) {
    p.ente = ente === 53 ? 5300108 : ente;
    return { tipo: 'municipio' as const, de: 'saude_vacinacao t', onde: 't.cod_ibge = $ente::INTEGER' };
  }
  const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
  if (uf) {
    p.uf = uf;
    return { tipo: 'uf' as const, de: 'saude_vacinacao_territorios t', onde: `t.nivel = 'UF' AND t.codigo = $uf` };
  }
  return { tipo: 'br' as const, de: 'saude_vacinacao_territorios t', onde: `t.nivel = 'BR'` };
}

const COLUNAS_VACINACAO = `t.ano::INTEGER AS ano, t.imunobiologico, c.rotulo, t.metodo, t.numerador::DOUBLE AS numerador, t.denominador::DOUBLE AS denominador,
  t.cobertura, t.cobertura_fonte, t.status, c.meta`;
const JUNCAO_CATALOGO = 'JOIN saude_vacinacao_catalogo c ON c.ano = t.ano AND c.imunobiologico = t.imunobiologico';

const rotasVacinacao: Record<string, (q: Params) => Promise<unknown>> = {
  /** Imunobiológicos de cada ano (rótulo original, método e meta oficial confirmada): o catálogo varia por ano e não se emenda. */
  async vacinacao_catalogo() {
    await tabelasVacinacao();
    return consultar(`SELECT ano::INTEGER AS ano, imunobiologico, rotulo, metodo, ordem::INTEGER AS ordem, municipios::INTEGER AS municipios,
      municipios_calculaveis::INTEGER AS municipios_calculaveis, meta, meta_fonte FROM saude_vacinacao_catalogo ORDER BY ano, ordem`);
  },

  /** Série de um imunobiológico no escopo (município, UF ou Brasil), uma linha por ano com dado; o método vem em cada linha. */
  async vacinacao_serie(q) {
    await tabelasVacinacao();
    const p: Record<string, Valor> = { imuno: String(q.imuno ?? '') };
    const e = escopoVacinacao(q, p);
    return consultar(`SELECT ${COLUNAS_VACINACAO} FROM ${e.de} ${JUNCAO_CATALOGO} WHERE ${e.onde} AND t.imunobiologico = $imuno ORDER BY t.ano`, p);
  },

  /** Todos os imunobiológicos do escopo num ano, na ordem do catálogo. */
  async vacinacao_ano(q) {
    await tabelasVacinacao();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const e = escopoVacinacao(q, p);
    return consultar(`SELECT ${COLUNAS_VACINACAO} FROM ${e.de} ${JUNCAO_CATALOGO} WHERE ${e.onde} AND t.ano = $ano::INTEGER ORDER BY c.ordem`, p);
  },

  /** Municípios (da UF ou do Brasil) com a cobertura de um imunobiológico num ano; só os do cadastro (os demais ficam à parte, contados). */
  async vacinacao_municipios(q) {
    await tabelasVacinacao();
    const p: Record<string, Valor> = { ano: inteiro(q.ano), imuno: String(q.imuno ?? '') };
    const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
    if (uf) p.uf = uf;
    return consultar(
      `SELECT t.cod_ibge, t.municipio, t.nome, t.uf, t.numerador::DOUBLE AS numerador, t.denominador::DOUBLE AS denominador, t.cobertura, t.cobertura_fonte, t.status,
              count(*) FILTER (WHERE t.cod_ibge IS NULL) OVER ()::INTEGER AS sem_cadastro
       FROM saude_vacinacao t WHERE t.ano = $ano::INTEGER AND t.imunobiologico = $imuno ${uf ? 'AND t.uf = $uf' : ''}
       ORDER BY t.nome NULLS LAST, t.municipio`,
      p,
    );
  },
};

// ---------------- FNS: repasses federais fundo a fundo (pipeline/fns.py) ----------------

/**
 * fns_municipios (ano × município, ~3 MB) e fns_anos (auditoria por ano, pequena) ficam em memória; fns_composicao (bloco, grupo e
 * estratégia por município e ano, ~19 MB, ordenada por ano e município) é lida por Range: cada consulta pede um ano. Fonte própria,
 * fora de saude_municipios: a população do ano aparece uma vez por município em fns_municipios e os valores nunca se somam à
 * receita (SICONFI) nem à despesa (SIOPS).
 */
let fnsCarregada: Promise<void> | null = null;
/** Só testes: reinicia apenas o domínio FNS para exercitar a carga e a retomada. */
export async function reiniciarFnsNoTeste() {
  const { con } = await iniciar();
  await con.query('DROP VIEW IF EXISTS fns_composicao');
  for (const nome of ['fns_municipios', 'fns_anos']) await con.query(`DROP TABLE IF EXISTS ${nome}`);
  fnsCarregada = null;
}
export function tabelasFns() {
  fnsCarregada ??= (async () => {
    const { con } = await iniciar();
    const nomes = ['municipios', 'anos'];
    const arquivos = await Promise.all(nomes.map((nome) => baixar(`gold/saude/fns_${nome}.parquet`)));
    for (const [i, nome] of nomes.entries()) {
      await db.registerFileBuffer(`fns_${nome}.parquet`, arquivos[i]);
      await con.query(`CREATE OR REPLACE TABLE fns_${nome} AS SELECT * FROM read_parquet('fns_${nome}.parquet')`);
    }
    await con.query(`CREATE OR REPLACE VIEW fns_composicao AS SELECT * FROM read_parquet(${arq('gold/saude/fns_composicao.parquet')})`);
  })();
  fnsCarregada.catch(() => (fnsCarregada = null));
  return fnsCarregada;
}

const rotasFns: Record<string, (q: Params) => Promise<unknown>> = {
  /**
   * Série anual do escopo (município, UF ou Brasil). Sem repasse no ano, bruto e líquido saem nulos (nunca zero). O per capita usa só os
   * municípios com população SVS/MS no ano (liquido_com_pop ÷ pop_com_repasse), e a cobertura (pop_com_repasse ÷ pop_total) e o valor
   * sem população correspondente (liquido_sem_pop) vão junto, para a página mostrar o que o denominador não alcança.
   */
  async fns_serie(q) {
    await tabelasFns();
    const p: Record<string, Valor> = {};
    const e = escopoTrabalho(q, p);
    return consultar(
      `SELECT ano, count(*)::INTEGER AS municipios, (count(*) FILTER (WHERE linhas IS NOT NULL))::INTEGER AS municipios_com_repasse,
              sum(bruto)::DOUBLE AS bruto, sum(liquido)::DOUBLE AS liquido, sum(liquido_real)::DOUBLE AS liquido_real,
              sum(liquido) FILTER (WHERE populacao > 0)::DOUBLE AS liquido_com_pop, sum(liquido_real) FILTER (WHERE populacao > 0)::DOUBLE AS liquido_real_com_pop,
              sum(populacao) FILTER (WHERE linhas IS NOT NULL AND populacao > 0)::DOUBLE AS pop_com_repasse, sum(populacao)::DOUBLE AS pop_total,
              sum(liquido) FILTER (WHERE populacao IS NULL OR populacao <= 0)::DOUBLE AS liquido_sem_pop,
              sum(liquido) FILTER (WHERE destino = 'distrital')::DOUBLE AS liquido_distrital, sum(linhas)::INTEGER AS linhas
       FROM fns_municipios m WHERE ${e.onde} GROUP BY ano ORDER BY ano`,
      p,
    );
  },

  /** Composição do ano (bloco, grupo, estratégia, com os nomes da fonte naquele ano) no escopo; só nominal. */
  async fns_composicao(q) {
    await tabelasFns();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const ente = inteiro(q.ente);
    const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
    let onde = 'true';
    if (ente) {
      p.municipio = Math.floor((ente === 53 ? 5300108 : ente) / 10);
      onde = 'c.municipio = $municipio::INTEGER';
    } else if (uf) {
      p.uf = uf;
      onde = 'c.uf = $uf';
    }
    return consultar(
      `SELECT c.bloco, c.grupo, c.estrategia, sum(c.bruto)::DOUBLE AS bruto, sum(c.liquido)::DOUBLE AS liquido, sum(c.linhas)::INTEGER AS linhas
       FROM fns_composicao c WHERE c.ano = $ano::INTEGER AND ${onde} GROUP BY ALL ORDER BY liquido DESC, c.bloco, c.grupo, c.estrategia`,
      p,
    );
  },

  /** Municípios com repasse no ano (da UF, ou do Brasil), com a população do ano; per capita e ordem saem na página. */
  async fns_municipios(q) {
    await tabelasFns();
    const p: Record<string, Valor> = { ano: inteiro(q.ano) };
    const e = escopoTrabalho({ uf: q.uf }, p);
    return consultar(
      `SELECT m.cod_ibge, m.municipio, m.nome, m.uf, m.destino, m.bruto::DOUBLE AS bruto, m.liquido::DOUBLE AS liquido, m.liquido_real::DOUBLE AS liquido_real,
              m.populacao::DOUBLE AS populacao, m.linhas::INTEGER AS linhas
       FROM fns_municipios m WHERE ${e.onde} AND m.ano = $ano::INTEGER AND m.linhas IS NOT NULL ORDER BY m.nome, m.municipio`,
      p,
    );
  },

  /** Auditoria por ano: linhas lidas, incluídas, excluídas e em quarentena, e o que ficou fora do universo (fundos estaduais, DF não comprovado). */
  async fns_anos() {
    await tabelasFns();
    return consultar(
      `SELECT ano, linhas_arquivo::INTEGER AS linhas_arquivo, linhas_municipais::INTEGER AS linhas_municipais, linhas_distritais::INTEGER AS linhas_distritais,
              linhas_excluidas::INTEGER AS linhas_excluidas, linhas_quarentena::INTEGER AS linhas_quarentena, linhas_conflito_de_classe::INTEGER AS linhas_conflito_de_classe,
              bruto::DOUBLE AS bruto, liquido::DOUBLE AS liquido, liquido_distrital::DOUBLE AS liquido_distrital,
              liquido_df_nao_comprovado::DOUBLE AS liquido_df_nao_comprovado, liquido_estadual::DOUBLE AS liquido_estadual
       FROM fns_anos ORDER BY ano`,
    );
  },
};

// ---------------- MUNIC e ESTADIC (IBGE): gestão pública dos municípios e dos estados ----------------

/**
 * catalogo, territorio e comparaveis (pequenos) ficam em memória; agregados e respostas, ordenados por pesquisa, edição e
 * pergunta, são lidos por Range (cada consulta pede uma pergunta ou um território). pipeline/munic.py.
 */
let municCarregada: Promise<void> | null = null;
export function tabelasMunic() {
  municCarregada ??= (async () => {
    const { con } = await iniciar();
    for (const nome of ['catalogo', 'territorio', 'comparaveis']) {
      await db.registerFileBuffer(`munic_${nome}.parquet`, await baixar(`gold/munic/${nome}.parquet`));
      await con.query(`CREATE TABLE munic_${nome} AS SELECT * FROM read_parquet('munic_${nome}.parquet')`);
    }
  })();
  municCarregada.catch(() => (municCarregada = null));
  return municCarregada;
}

/**
 * Tabelas da IA de gestão pública: as três pequenas em memória (tabelasMunic) e visões sobre os arquivos grandes,
 * lidos por Range (agregados e respostas, ordenados por pesquisa, ano e var: o filtro das consultas descarta o resto).
 */
let iaMunic: Promise<void> | null = null;
export function tabelasIaMunic() {
  iaMunic ??= (async () => {
    const { con } = await iniciar();
    await tabelasMunic();
    for (const nome of ['agregados', 'respostas']) {
      await con.query(`CREATE OR REPLACE VIEW munic_${nome} AS SELECT * FROM read_parquet(${arq(`gold/munic/${nome}.parquet`)})`);
    }
  })();
  iaMunic.catch(() => (iaMunic = null));
  return iaMunic;
}

const pesquisaMunic = (q: Params) => (q.pesquisa === 'estadic' ? 'estadic' : 'munic');
const SEM_ACENTO = (col: string) => `strip_accents(lower(${col}))`;

const rotasMunic: Record<string, (q: Params) => Promise<unknown>> = {
  /** Temas (abas) de cada edição da pesquisa, com o número de perguntas publicadas. */
  async munic_temas(q) {
    await tabelasMunic();
    return consultar(
      `SELECT ano, aba, count(*)::INTEGER AS perguntas, max(n_territorios)::INTEGER AS territorios
       FROM munic_catalogo WHERE pesquisa = $pesquisa GROUP BY ano, aba ORDER BY ano, aba`,
      { pesquisa: pesquisaMunic(q) },
    );
  },

  /** Perguntas de um tema numa edição: enunciado completo, tipo e quantos territórios responderam. */
  async munic_perguntas(q) {
    await tabelasMunic();
    return consultar(
      `SELECT var, aba, tema, subtema, rotulo, tipo, n_respostas::INTEGER AS n_respostas, n_validas::INTEGER AS n_validas, n_territorios::INTEGER AS n_territorios
       FROM munic_catalogo WHERE pesquisa = $pesquisa AND ano = $ano::INTEGER AND ($aba = '' OR aba = $aba)`,
      { pesquisa: pesquisaMunic(q), ano: inteiro(q.ano), aba: q.aba ? String(q.aba) : '' },
    );
  },

  /** Agregados de uma pergunta: Brasil, cada UF e cada faixa de porte, por resposta (categorias ou soma e média). */
  async munic_distribuicao(q) {
    await tabelasMunic();
    return consultar(
      `SELECT corte, grupo, valor_txt, valida, n::INTEGER AS n, soma, media
       FROM read_parquet(${arq('gold/munic/agregados.parquet')})
       WHERE pesquisa = $pesquisa AND ano = $ano::INTEGER AND var = $var`,
      { pesquisa: pesquisaMunic(q), ano: inteiro(q.ano), var: String(q.var ?? '') },
    );
  },

  /** Perguntas com o mesmo enunciado em mais de uma edição, achadas por um trecho do enunciado. */
  async munic_busca(q) {
    await tabelasMunic();
    const termo = String(q.q ?? '').trim();
    return consultar(
      `SELECT grupo, any_value(rotulo) AS rotulo, any_value(tipo) AS tipo, count(DISTINCT ano)::INTEGER AS edicoes,
              min(ano)::INTEGER AS de, max(ano)::INTEGER AS ate
       FROM munic_comparaveis WHERE pesquisa = $pesquisa AND ($termo = '' OR ${SEM_ACENTO('rotulo')} LIKE '%' || strip_accents(lower($termo)) || '%')
       GROUP BY grupo ORDER BY edicoes DESC, rotulo LIMIT 60`,
      { pesquisa: pesquisaMunic(q), termo },
    );
  },

  /** Série de uma pergunta comparável: uma linha por edição e resposta (Brasil), com a pergunta de cada edição. */
  async munic_evolucao(q) {
    await tabelasMunic();
    return consultar(
      `SELECT g.ano, g.var, g.rotulo, g.tipo, a.valor_txt, a.valida, a.n::INTEGER AS n, a.soma, a.media
       FROM munic_comparaveis g
       JOIN read_parquet(${arq('gold/munic/agregados.parquet')}) a
         ON a.pesquisa = g.pesquisa AND a.ano = g.ano AND a.var = g.var AND a.corte = 'brasil'
       WHERE g.pesquisa = $pesquisa AND g.grupo = $grupo ORDER BY g.ano`,
      { pesquisa: pesquisaMunic(q), grupo: String(q.grupo ?? '') },
    );
  },

  /** Municípios (ou UFs) com respostas numa edição. */
  async munic_territorios(q) {
    await tabelasMunic();
    return consultar(
      `SELECT cod, nome, uf, faixa, populacao FROM munic_territorio WHERE pesquisa = $pesquisa AND ano = $ano::INTEGER
       AND ($uf = '' OR uf = $uf) ORDER BY nome`,
      { pesquisa: pesquisaMunic(q), ano: inteiro(q.ano), uf: UFS.has(String(q.uf)) ? String(q.uf) : '' },
    );
  },

  /** Todas as respostas de um município (ou UF) numa edição, com o enunciado de cada pergunta. */
  async munic_ficha(q) {
    await tabelasMunic();
    return consultar(
      `SELECT c.aba, c.subtema, c.rotulo, c.tipo, c.var, r.valor_txt, r.valor_num, r.valida
       FROM read_parquet(${arq('gold/munic/respostas.parquet')}) r
       JOIN munic_catalogo c ON c.pesquisa = r.pesquisa AND c.ano = r.ano AND c.var = r.var
       WHERE r.pesquisa = $pesquisa AND r.ano = $ano::INTEGER AND r.cod = $cod::INTEGER`,
      { pesquisa: pesquisaMunic(q), ano: inteiro(q.ano), cod: inteiro(q.cod) },
    );
  },

  /**
   * Painel automático de gestão pública: TODOS os cartões numa rota só (não uma consulta por indicador). Lê do agregado o
   * Brasil e a UF e, para um município ou governo estadual, só as respostas das variáveis curadas (filtro por edição e
   * variável, para ler poucos grupos de linhas por Range). As edições e variáveis vêm da curadoria (munic_curadoria.ts), nunca
   * do endereço; pesquisa, edição, UF e código inválidos recusam, sem cair no Brasil. Devolve também o universo de cada
   * edição (território por edição) e o território achado, ou null se o código não existe.
   */
  async munic_painel(q) {
    await tabelasMunic();
    const sp = new URLSearchParams();
    for (const [k, nome] of [['pesq', 'pesquisa'], ['ano', 'ano'], ['uf', 'uf'], ['cod', 'cod']] as const) if (q[nome] !== undefined && q[nome] !== null && q[nome] !== '') sp.set(k, String(q[nome]));
    const esc = lerEscolhas(sp, edicoesCuradas(CURADORIA));
    if (!esc.ok) throw new Error(t(`escolha inválida (${esc.erro}): ${esc.valor}`, `invalid choice (${esc.erro}): ${esc.valor}`));
    const pesquisa = esc.pesquisa;
    const sel = selecionar(CURADORIA, pesquisa, esc.modo);
    const pares = paresPedidos(sel);
    const vazio = { agregados: [], respostas: [], universo: [], territorio: null };
    if (!pares.size) return vazio;
    const seguro = /^[A-Za-z0-9]+$/;
    for (const vars of pares.values()) for (const v of vars) if (!seguro.test(v)) throw new Error(`variável curada inválida: ${v}`);
    const grupos = [...pares].map(([ano, vars]) => `(ano = ${Number(ano)} AND var IN (${vars.map((v) => `'${v}'`).join(', ')}))`).join(' OR ');
    // cópias leves (só os pares da curadoria, mesmas colunas e linhas) quando o manifesto as declara e cobrem TODOS os pares pedidos; senão, os gold completos
    const { manifesto } = await iniciar();
    const leve = usarArquivosLeves(manifesto.fontes?.munic_painel, pares, pesquisa);
    const arqAgregados = arq(leve ? ARQUIVOS_PAINEL.agregados : 'gold/munic/agregados.parquet');
    const arqRespostas = arq(leve ? ARQUIVOS_PAINEL.respostas : 'gold/munic/respostas.parquet');
    let territorio: Linha | null = null;
    let uf = esc.escopo.tipo === 'uf' ? esc.escopo.uf : '';
    if (esc.escopo.tipo === 'territorio') {
      [territorio = null] = await consultar(
        `SELECT cod, nome, uf, faixa, populacao FROM munic_territorio WHERE pesquisa = $pesquisa AND cod = $cod::INTEGER ORDER BY ano DESC LIMIT 1`,
        { pesquisa, cod: esc.escopo.cod },
      );
      if (!territorio) return { ...vazio, territorio: null };
      if (pesquisa === 'munic') uf = String(territorio.uf);
    }
    const recortes = `(corte = 'brasil' AND grupo = 'BR')${uf ? ` OR (corte = 'uf' AND grupo = $uf)` : ''}`;
    const agregados = await consultar(
      `SELECT ano::INTEGER AS ano, var, corte, grupo, valor_txt, valida, n::DOUBLE AS n, soma, media
       FROM read_parquet(${arqAgregados})
       WHERE pesquisa = $pesquisa AND (${grupos}) AND (${recortes})`,
      uf ? { pesquisa, uf } : { pesquisa },
    );
    const respostas = esc.escopo.tipo === 'territorio'
      ? await consultar(
        `SELECT ano::INTEGER AS ano, var, valor_txt, valor_num, valida FROM read_parquet(${arqRespostas})
         WHERE pesquisa = $pesquisa AND cod = $cod::INTEGER AND (${grupos})`,
        { pesquisa, cod: esc.escopo.cod },
      )
      : [];
    const universo = await consultar(
      `SELECT ano::INTEGER AS ano, count(*)::INTEGER AS territorios, (count(*) FILTER (uf = $uf))::INTEGER AS territorios_uf
       FROM munic_territorio WHERE pesquisa = $pesquisa AND ano IN (${[...pares.keys()].map(Number).join(', ')}) GROUP BY ano`,
      { pesquisa, uf },
    );
    return { agregados, respostas, universo, territorio };
  },
};

// ---------------- clima por município e mês (CHIRPS e ERA5-Land; pipeline/clima.py) ----------------

/**
 * territorio e catalogo (~70 KB) bastam para abrir o painel (lista de municípios e os seis cartões, que vêm do resumo leve);
 * normal e agregado (Brasil e UF, ~3,6 MB) só entram quando um detalhe, a IA ou o cálculo sem o resumo precisam deles. Os
 * arquivos são baixados em paralelo. mensal e anual (milhões de linhas, ordenados por variável, município e ano) são lidos
 * por Range: cada consulta pede uma variável e um município.
 */
const climaTabela = new Map<string, Promise<void>>();
function tabelaClima(nome: string) {
  if (!climaTabela.has(nome)) {
    const p = (async () => {
      const { con } = await iniciar();
      await db.registerFileBuffer(`clima_${nome}.parquet`, await baixar(`gold/clima/${nome}.parquet`));
      await con.query(`CREATE TABLE clima_${nome} AS SELECT * FROM read_parquet('clima_${nome}.parquet')`);
    })();
    p.catch(() => climaTabela.delete(nome));
    climaTabela.set(nome, p);
  }
  return climaTabela.get(nome)!;
}
export const tabelasClimaLeves = () => Promise.all(['territorio', 'catalogo'].map(tabelaClima)).then(() => undefined);
export const tabelasClima = () => Promise.all(['territorio', 'catalogo', 'normal', 'agregado'].map(tabelaClima)).then(() => undefined);

/**
 * Tabelas da IA de clima: as quatro pequenas em memória (tabelasClima) e visões sobre mensal e anual, lidos por Range
 * (ordenados por variável, município e ano: o filtro das consultas descarta o resto).
 */
let iaClima: Promise<void> | null = null;
export function tabelasIaClima() {
  iaClima ??= (async () => {
    const { con } = await iniciar();
    await tabelasClima();
    for (const nome of ['anual', 'mensal']) {
      await con.query(`CREATE OR REPLACE VIEW clima_${nome} AS SELECT * FROM read_parquet(${arq(`gold/clima/${nome}.parquet`)})`);
    }
  })();
  iaClima.catch(() => (iaClima = null));
  return iaClima;
}

const NORMAL_DE = 1991;
const NORMAL_ATE = 2020;
const variavelClima = (q: Params) => String(q.variavel ?? 'chuva_mm');
/** Município (cod) ou grupo: 'BR' ou a sigla de uma UF. */
const grupoClima = (q: Params) => (q.uf && UFS.has(String(q.uf)) ? String(q.uf) : 'BR');

/**
 * Resumo das seis variáveis de um grupo (BR, UF ou município): o arquivo leve gold/clima/painel.parquet, anunciado em
 * fontes.clima.painel do manifesto e lido por Range, ou, se o campo ou o arquivo faltar, a MESMA regra (clima_painel.sql) sobre
 * as tabelas publicadas. Os dois caminhos devolvem as mesmas colunas e os mesmos valores.
 */
export type ResumoClimaFonte = { origem: 'abertura' | 'leve' | 'calculado'; linhas: Linha[] };
const ENTRADA_CATALOGO = `agr AS (SELECT variavel, resumo_anual AS agregacao, anomalia AS tipo FROM clima_catalogo),`;
export function painelLeveClima(manifesto: { fontes?: Record<string, Record<string, unknown>> } | undefined): string | null {
  const clima = manifesto?.fontes?.clima as { ate?: number; painel?: { versao?: number; arquivo?: unknown; ate?: number } } | undefined;
  const p = clima?.painel;
  if (!p || p.versao !== 1 || typeof p.arquivo !== 'string' || !/^gold\/clima\/[A-Za-z0-9_.-]+\.parquet$/.test(p.arquivo)) return null;
  // o resumo só vale para o mesmo último mês dos dados publicados
  return p.ate === clima?.ate ? p.arquivo : null;
}
async function resumoClima(q: Params): Promise<ResumoClimaFonte> {
  const cod = inteiro(q.cod);
  const grupo = cod ? String(cod) : grupoClima(q);
  await tabelasClimaLeves();
  const { manifesto } = await iniciar();
  const leve = painelLeveClima(manifesto);
  if (leve) {
    try {
      const linhas = await consultar(`SELECT * FROM read_parquet(${arq(leve)}) WHERE grupo = $g ORDER BY variavel`, { g: grupo });
      return { origem: 'leve', linhas };
    } catch (e) {
      // arquivo anunciado e ausente (ou ilegível): cai no cálculo direto, sem perder o painel
      console.warn('resumo leve do clima indisponível; calculando pelos gold publicados', e);
    }
  }
  if (cod) {
    await tabelasClima();
    const linhas = await consultar(
      `WITH a AS (SELECT CAST(cod AS VARCHAR) AS grupo, variavel, ano, valor, normal, anomalia_pct, anomalia
                  FROM read_parquet(${arq('gold/clima/anual.parquet')}) WHERE cod = $cod::INTEGER),
            s AS (SELECT CAST(cod AS VARCHAR) AS grupo, variavel, ano, mes, valor
                  FROM read_parquet(${arq('gold/clima/mensal.parquet')}) WHERE cod = $cod::INTEGER),
            n AS (SELECT CAST(cod AS VARCHAR) AS grupo, variavel, mes, normal FROM clima_normal WHERE cod = $cod::INTEGER),
            ${ENTRADA_CATALOGO}
            ${CLIMA_PAINEL_SQL} ORDER BY r.variavel`,
      { cod },
    );
    return { origem: 'calculado', linhas };
  }
  await tabelasClima();
  const linhas = await consultar(
    `WITH a AS (SELECT grupo, variavel, ano, valor, avg(valor) FILTER (ano BETWEEN ${NORMAL_DE} AND ${NORMAL_ATE}) OVER (PARTITION BY grupo, variavel) AS normal,
                       anomalia_pct, anomalia FROM clima_agregado WHERE grupo = $g AND mes = 0),
          s AS (SELECT grupo, variavel, ano, mes, valor FROM clima_agregado WHERE grupo = $g AND mes > 0),
          n AS (SELECT grupo, variavel, mes, avg(valor) FILTER (ano BETWEEN ${NORMAL_DE} AND ${NORMAL_ATE}) AS normal FROM clima_agregado
                WHERE grupo = $g AND mes > 0 GROUP BY ALL),
          ${ENTRADA_CATALOGO}
          ${CLIMA_PAINEL_SQL} ORDER BY r.variavel`,
    { g: grupo },
  );
  return { origem: 'calculado', linhas };
}

/**
 * Abertura rápida do clima: meta, territórios e resumo do recorte SEM iniciar o motor (DuckDB-WASM), lidos do pacote
 * fontes.clima.abertura por um índice leve e um Range. Sem o pacote (ou se algo falhar), a rota segue pelo motor, mais lenta.
 * Nos testes (motor injetado) o motor é sempre usado.
 */
const abertura = criarAbertura({
  manifesto: manifestoCompartilhado,
  url: (caminho, m) => `${BASE}v/${versaoDoManifesto(m)}${REVISAO_CACHE_HTTP}/${caminho}`,
  buscar: (u, init) => fetch(u, init),
});
const ROTAS_INICIAIS_CLIMA = new Set(['clima_meta', 'clima_territorios', 'clima_painel']);
export const estadoAberturaClima = () => abertura.estado();
export async function executarInicialClima(caminho: string, params: Params): Promise<unknown | typeof USAR_MOTOR> {
  if (caminhoLocal || !ROTAS_INICIAIS_CLIMA.has(caminho)) return USAR_MOTOR;
  return abertura.executar(caminho, params);
}

/**
 * Abertura rápida da saúde (/datasus): contexto (saude_meta, saude_entes), colunas, série de contagens e SIOPS SEM iniciar o motor, do
 * pacote aberturas.saude (um índice leve e UM Range por recorte). Sem o pacote para este manifesto (ou se algo falhar), a rota segue pelo
 * motor, mais lenta, com o mesmo resultado. O manifesto é o mesmo da sessão (obterManifesto). Nos testes (motor injetado) o motor é sempre usado.
 */
const aberturaSaude = criarAberturaSaude({
  manifesto: manifestoCompartilhado,
  url: (caminho, m) => `${BASE}v/${versaoDoManifesto(m)}${REVISAO_CACHE_HTTP}/${caminho}`,
  buscar: (u, init) => fetch(u, init),
});
export const estadoAberturaSaude = () => aberturaSaude.estado();
export async function executarInicialSaude(caminho: string, params: Params): Promise<unknown | typeof USAR_MOTOR> {
  if (caminhoLocal) return USAR_MOTOR;
  return aberturaSaude.executar(caminho, params);
}

const rotasClima: Record<string, (q: Params) => Promise<unknown>> = {
  /** Metadados do clima (anos, último mês, normal) tirados do manifesto; o motor só é usado se o caminho rápido não for. */
  async clima_meta() {
    const { manifesto } = await iniciar();
    const c = manifesto.fontes?.clima as { anos?: number[]; ate?: number; normal?: number[]; processado_em?: string } | undefined;
    return {
      anos: c?.anos ?? [], ate: c?.ate ?? null, normal: c?.normal?.length === 2 ? [c.normal[0], c.normal[1]] : null,
      processado_em: c?.processado_em ?? null, gerado_em: manifesto.gerado_em, abertura: false,
    };
  },
  /** Variáveis publicadas (catálogo). */
  async clima_catalogo() {
    await tabelasClimaLeves();
    return consultar(
      `SELECT variavel, rotulo, unidade, resumo_anual, fonte, anomalia, ano_de, ano_ate, ate FROM clima_catalogo
       ORDER BY variavel <> 'chuva_mm', rotulo`,
    );
  },

  /** Municípios do cadastro (para a busca pelo nome); quem não tem dado de clima é identificado pelo resumo, não aqui. */
  async clima_territorios() {
    await tabelasClimaLeves();
    return consultar('SELECT cod, nome, uf FROM clima_territorio ORDER BY nome');
  },

  /** Resumo das seis variáveis do recorte (cartões, acumulados de chuva, ano em curso e cobertura). */
  clima_painel: resumoClima,

  /** Série anual (anos com os 12 meses) do município, da UF ou do Brasil, com a normal e a anomalia. */
  async clima_anual(q) {
    const v = variavelClima(q);
    if (inteiro(q.cod)) {
      return consultar(
        `SELECT ano, valor, normal, anomalia_pct, anomalia FROM read_parquet(${arq('gold/clima/anual.parquet')})
         WHERE variavel = $v AND cod = $cod::INTEGER ORDER BY ano`,
        { cod: inteiro(q.cod), v },
      );
    }
    await tabelasClima();
    return consultar(
      `SELECT ano, valor, avg(valor) FILTER (ano BETWEEN ${NORMAL_DE} AND ${NORMAL_ATE}) OVER () AS normal,
              anomalia_pct, valor - avg(valor) FILTER (ano BETWEEN ${NORMAL_DE} AND ${NORMAL_ATE}) OVER () AS anomalia
       FROM clima_agregado WHERE grupo = $g AND mes = 0 AND variavel = $v ORDER BY ano`,
      { g: grupoClima(q), v },
    );
  },

  /** Série mensal do município, da UF ou do Brasil, com a normal do mês (1991–2020). */
  async clima_mensal(q) {
    const v = variavelClima(q);
    await tabelasClima();
    if (inteiro(q.cod)) {
      return consultar(
        `SELECT m.ano, m.mes, m.valor, n.normal
         FROM read_parquet(${arq('gold/clima/mensal.parquet')}) m
         LEFT JOIN clima_normal n ON n.cod = m.cod AND n.mes = m.mes AND n.variavel = m.variavel
         WHERE m.variavel = $v AND m.cod = $cod::INTEGER ORDER BY m.ano, m.mes`,
        { cod: inteiro(q.cod), v },
      );
    }
    return consultar(
      `SELECT ano, mes, valor, avg(valor) FILTER (ano BETWEEN ${NORMAL_DE} AND ${NORMAL_ATE}) OVER (PARTITION BY mes) AS normal
       FROM clima_agregado WHERE grupo = $g AND mes > 0 AND variavel = $v ORDER BY ano, mes`,
      { g: grupoClima(q), v },
    );
  },

  /** Ranking dos municípios num ano (de uma UF ou do Brasil): total ou média anual, normal e anomalia (relativa ou absoluta). */
  async clima_ranking(q) {
    await tabelasClimaLeves();
    const ano = inteiro(q.ano);
    if (ano === null || !Number.isFinite(ano)) return [];
    return consultar(
      `SELECT a.cod, t.nome, t.uf, a.valor, a.normal, a.anomalia_pct, a.anomalia
       FROM read_parquet(${arq('gold/clima/anual.parquet')}) a JOIN clima_territorio t USING (cod)
       WHERE a.variavel = $v AND a.ano = $ano::INTEGER AND ($uf = '' OR t.uf = $uf)`,
      { v: variavelClima(q), ano, uf: UFS.has(String(q.uf)) ? String(q.uf) : '' },
    );
  },
};

// ---------------- classificação dos municípios (rankings anuais e evolução das posições) ----------------

/**
 * Uma regra só para as posições de todos os painéis: o ranking de cada ano e a evolução das posições saem
 * das mesmas consultas. Etapas:
 *   1. base: uma linha por município e ano da fonte, com o indicador e o motivo de ficar fora (NULL = elegível)
 *   2. el: os elegíveis do intervalo pedido
 *   3. u: o universo (anual: os elegíveis de cada ano; constante: só os elegíveis em todos os anos do intervalo)
 *   4. r: posições no universo, com empates competitivos (1, 2, 2, 4): nacional sobre todos os municípios e,
 *      depois, a da UF só entre os do estado; o tamanho de cada universo vem junto
 * A seleção de municípios, a página e a exportação vêm depois, sobre r.
 */
export type DominioRanking = 'financas' | 'trabalho' | 'saude';

/** Indicadores da RAIS (colunas de sqlTrabMunicipios) que entram nos rankings; o motivo explica o valor ausente. */
export const INDICADORES_RANKING_TRABALHO: Record<string, { monetario: boolean; semValor: string }> = {
  empregos: { monetario: false, semValor: 'sem_valor' },
  empregos_por_mil: { monetario: false, semValor: 'sem_populacao' },
  remuneracao_media: { monetario: true, semValor: 'sem_valor' },
  n_rem_dez: { monetario: false, semValor: 'sem_valor' },
  var_empregos: { monetario: false, semValor: 'sem_ano_anterior' },
  saldo_caged: { monetario: false, semValor: 'sem_caged' },
  pct_mulheres: { monetario: false, semValor: 'sem_valor' },
  pct_superior: { monetario: false, semValor: 'sem_valor' },
  pct_adm_publica: { monetario: false, semValor: 'sem_valor' },
};

/**
 * Finanças: valor declarado no exercício (zeros e negativos entram), DCA com o total do domínio, fora as
 * inconsistências objetivas e os erros confirmados (visão filtrada) e, no per capita, população declarada na
 * DCA positiva.
 */
function baseFinancas(campo: string, perCapita: boolean, trat: Tratamento) {
  const d = dominioCampo(campo);
  return `SELECT i.exercicio AS ano, i.cod_ibge, i.nome, i.uf, i.populacao::DOUBLE AS populacao, i.${campo}::DOUBLE AS valor,
      ${perCapita ? `CASE WHEN i.populacao > 0 THEN i.${campo} / i.populacao END` : `i.${campo}`}::DOUBLE AS indicador,
      CASE WHEN i.${campo} IS NULL THEN 'sem_valor'
           WHEN NOT (${validoNoDominio(d, 'i')}) THEN 'sem_total_dominio'
           WHEN NOT (${naoExcluido(d, 'i', trat)}) THEN 'inconsistencia'
           ${perCapita ? "WHEN NOT (i.populacao > 0) THEN 'sem_populacao'" : ''} END AS motivo
    FROM indicadores i WHERE i.esfera = 'M'`;
}

/** RAIS: municípios com pelo menos `min` vínculos ativos e o indicador calculável. */
function baseTrabalho(ind: string) {
  const def = INDICADORES_RANKING_TRABALHO[ind];
  return `SELECT x.ano, x.cod_ibge, x.nome, x.uf, x.populacao::DOUBLE AS populacao, x.empregos::DOUBLE AS valor,
      x.${ind}::DOUBLE AS indicador, x.meses_caged,
      CASE WHEN coalesce(x.empregos, 0) < $min THEN 'abaixo_minimo' WHEN x.${ind} IS NULL THEN '${def.semValor}' END AS motivo
    FROM (${sqlTrabMunicipios('true')}) x`;
}

/**
 * Saúde: taxa = fator × numerador ÷ denominador do próprio município (residência), com o denominador mínimo
 * escolhido; sem denominador positivo ou sem numerador não há taxa (as mesmas regras de calcular()).
 */
function baseSaude(ind: Indicador) {
  const n = `s.${ind.numerador}`;
  const d = `s.${ind.denominador}`;
  return `SELECT s.ano, s.cod_ibge, s.nome, s.uf, s.populacao::DOUBLE AS populacao, ${n}::DOUBLE AS valor, ${d}::DOUBLE AS denominador,
      CASE WHEN ${d} > 0 AND ${n} IS NOT NULL THEN ${ind.fator} * ${n} / ${d} END::DOUBLE AS indicador,
      CASE WHEN ${n} IS NULL AND ${d} IS NULL THEN 'sem_registro'
           WHEN ${d} IS NULL OR ${d} <= 0 THEN 'denominador_invalido'
           WHEN ${n} IS NULL THEN 'sem_numerador'
           WHEN ${d} < $min THEN 'abaixo_minimo' END AS motivo
    FROM saude_municipios s WHERE s.cod_ibge IS NOT NULL`;
}

/**
 * Cadeia de CTEs base → el → u → r sobre uma base (SQL com ano, cod_ibge, uf, indicador e motivo), para os anos
 * $de a $ate. Exportada para os testes com dados controlados.
 */
export function sqlClassificacao(base: string, o: { ordem: 'ASC' | 'DESC'; constante: boolean }) {
  return `base AS (${base}),
    el AS (SELECT * FROM base WHERE motivo IS NULL AND indicador IS NOT NULL AND ano BETWEEN $de AND $ate),
    u AS (SELECT * FROM el ${o.constante
      ? 'WHERE cod_ibge IN (SELECT cod_ibge FROM el GROUP BY cod_ibge HAVING count(DISTINCT ano) = (SELECT count(DISTINCT ano) FROM el))'
      : ''}),
    r AS (SELECT *, rank() OVER (PARTITION BY ano ORDER BY indicador ${o.ordem}) AS posicao_br,
                    count(*) OVER (PARTITION BY ano) AS total_br,
                    rank() OVER (PARTITION BY ano, uf ORDER BY indicador ${o.ordem}) AS posicao_uf,
                    count(*) OVER (PARTITION BY ano, uf) AS total_uf
          FROM u)`;
}

/** Base e parâmetros de um pedido de classificação (domínio, indicador, medida, filtros). */
function pedidoClassificacao(q: Params) {
  const dominio: DominioRanking = q.dominio === 'trabalho' || q.dominio === 'saude' ? q.dominio : 'financas';
  const p: Record<string, Valor> = {};
  let base: string;
  let monetario = false;
  let ind: string;
  if (dominio === 'financas') {
    ind = CAMPOS.has(String(q.ind)) ? String(q.ind) : 'receita_bruta';
    const perCapita = q.medida !== 'total';
    base = baseFinancas(ind, perCapita, tratamentoDe(q));
    monetario = !NAO_MONETARIOS.has(ind);
  } else if (dominio === 'trabalho') {
    ind = INDICADORES_RANKING_TRABALHO[String(q.ind)] ? String(q.ind) : 'empregos_por_mil';
    p.min = Math.max(inteiro(q.min) ?? 0, 0);
    base = baseTrabalho(ind);
    monetario = INDICADORES_RANKING_TRABALHO[ind].monetario;
  } else {
    const def = indicadorSaude(String(q.ind ?? ''));
    ind = def.id;
    p.min = Math.max(q.min === undefined || q.min === null || q.min === '' ? def.minimo : Number(q.min), 0);
    base = baseSaude(def);
  }
  const ordem: 'ASC' | 'DESC' = q.ordem === 'asc' ? 'ASC' : 'DESC';
  const constante = q.universo === 'constante';
  return { dominio, ind, base, p, monetario, ordem, constante };
}

async function tabelasDoDominio(dominio: DominioRanking) {
  if (dominio === 'financas') await iniciar();
  else if (dominio === 'trabalho') await tabelasTrabalho();
  else await tabelasSaude();
}

export type PontoPosicao = {
  ano: number; cod_ibge: number; nome: string; uf: string; valor: number | null; indicador: number | null;
  populacao: number | null; denominador?: number | null; meses_caged?: number | null; motivo: string | null;
  posicao_br: number | null; total_br: number | null; posicao_uf: number | null; total_uf: number | null; fator_real: number | null;
};
export type MudancaPosicao = {
  cod_ibge: number; nome: string; uf: string; valor_ini: number | null; valor_fim: number | null;
  pos_ini: number | null; pos_fim: number | null; total_ini: number | null; total_fim: number | null;
  fator_ini: number | null; fator_fim: number | null;
};
export type Classificacao = {
  dominio: DominioRanking; ind: string; anos: number[]; monetario: boolean; base_ipca: number;
  /** municípios elegíveis em cada ano, no Brasil e na UF pedida (no universo escolhido) */
  universos: { ano: number; total_br: number; total_uf: number | null; meses_caged?: number | null }[];
  /** municípios escolhidos, um ponto por ano do intervalo com registro na fonte */
  serie: PontoPosicao[];
  /** todos os municípios do escopo com posição no ano inicial ou no final */
  mudancas: MudancaPosicao[];
  /** lista=1: todas as posições do escopo em cada ano (o ranking anual) */
  lista?: PontoPosicao[];
};

const rotasPosicoes: Record<string, (q: Params) => Promise<unknown>> = {
  /**
   * Cobertura do indicador: os anos com pelo menos um município elegível, com os mesmos parâmetros que mudam a
   * elegibilidade (medida, tratamento, mínimo). É o que os seletores de período oferecem: um ano fora daqui não
   * teria nenhuma posição (ex.: crescimento dos vínculos no 1º ano da RAIS; taxas por habitante antes de 2000).
   */
  async ranking_anos(q): Promise<number[]> {
    const c = pedidoClassificacao(q);
    await tabelasDoDominio(c.dominio);
    const linhas = await consultar(`WITH base AS (${c.base}) SELECT DISTINCT ano FROM base WHERE motivo IS NULL AND indicador IS NOT NULL ORDER BY ano`, c.p);
    return linhas.map((l) => Number(l.ano));
  },

  /**
   * Posições dos municípios ano a ano. Parâmetros: dominio, ind, medida (finanças), tratamento, min (RAIS e
   * saúde), ordem, de, ate, uf (posições e mudanças na UF; o ranking nacional é calculado antes), universo
   * (anual ou constante), entes (até 5 códigos) e lista=1 (todas as posições, para o ranking anual).
   */
  async ranking_posicoes(q): Promise<Classificacao> {
    const { manifesto } = await iniciar();
    const c = pedidoClassificacao(q);
    await tabelasDoDominio(c.dominio);
    const de = inteiro(q.de) ?? 0;
    const ate = Math.max(inteiro(q.ate) ?? de, de);
    const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
    const entes = String(q.entes ?? '').split(',').map((x) => inteiro(x)).filter((x): x is number => !!x).slice(0, 5);
    const p: Record<string, Valor> = { ...c.p, de, ate, base: manifesto.base_ipca };
    if (uf) p.uf = uf;
    const cte = `WITH ${sqlClassificacao(c.base, c)},
      fat AS (SELECT ip.exercicio AS ano, b.indice / ip.indice AS fator_real FROM ipca ip CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b)`;
    const pos = uf ? 'posicao_uf' : 'posicao_br';
    const tot = uf ? 'total_uf' : 'total_br';
    const noEscopo = uf ? 'AND uf = $uf' : '';
    const [anos, universos, serie, mudancas, lista] = await Promise.all([
      // anos do período com algum município elegível (a mesma regra de ranking_anos)
      consultar(`${cte} SELECT DISTINCT ano FROM el ORDER BY ano`, p),
      consultar(`${cte} SELECT ano, count(*)::INTEGER AS total_br, ${uf ? 'count(*) FILTER (WHERE uf = $uf)::INTEGER' : 'NULL::INTEGER'} AS total_uf
                 ${c.dominio === 'trabalho' ? ', max(meses_caged) AS meses_caged' : ''}
                 FROM u GROUP BY ano ORDER BY ano`, p),
      entes.length
        ? consultar(`${cte}
            SELECT b.ano, b.cod_ibge, b.nome, b.uf, b.valor, b.indicador, b.populacao,
                   ${c.dominio === 'saude' ? 'b.denominador,' : ''}${c.dominio === 'trabalho' ? 'b.meses_caged,' : ''}
                   CASE WHEN b.motivo IS NULL AND b.indicador IS NOT NULL AND r.cod_ibge IS NULL THEN 'fora_universo_constante' ELSE b.motivo END AS motivo,
                   r.posicao_br, r.total_br, r.posicao_uf, r.total_uf, f.fator_real
            FROM base b LEFT JOIN r USING (ano, cod_ibge) LEFT JOIN fat f ON f.ano = b.ano
            WHERE b.cod_ibge IN (${entes.join(', ')}) AND b.ano BETWEEN $de AND $ate ORDER BY b.cod_ibge, b.ano`, p)
        : Promise.resolve([] as Linha[]),
      consultar(`${cte},
          a AS (SELECT cod_ibge, nome, uf, indicador, ${pos} AS pos, ${tot} AS total FROM r WHERE ano = $de ${noEscopo}),
          z AS (SELECT cod_ibge, nome, uf, indicador, ${pos} AS pos, ${tot} AS total FROM r WHERE ano = $ate ${noEscopo})
        SELECT coalesce(z.cod_ibge, a.cod_ibge) AS cod_ibge, coalesce(z.nome, a.nome) AS nome, coalesce(z.uf, a.uf) AS uf,
               a.indicador AS valor_ini, z.indicador AS valor_fim, a.pos AS pos_ini, z.pos AS pos_fim, a.total AS total_ini, z.total AS total_fim,
               (SELECT fator_real FROM fat WHERE ano = $de) AS fator_ini, (SELECT fator_real FROM fat WHERE ano = $ate) AS fator_fim
        FROM a FULL JOIN z USING (cod_ibge)
        ORDER BY (a.pos - z.pos) DESC NULLS LAST, z.pos NULLS LAST, a.pos NULLS LAST`, p),
      String(q.lista) === '1'
        ? consultar(`${cte} SELECT r.ano, r.cod_ibge, r.nome, r.uf, r.valor, r.indicador, r.populacao,
              ${c.dominio === 'saude' ? 'r.denominador,' : ''} NULL AS motivo, r.posicao_br, r.total_br, r.posicao_uf, r.total_uf, f.fator_real
            FROM r LEFT JOIN fat f ON f.ano = r.ano WHERE true ${noEscopo} ORDER BY r.ano, ${pos}, r.nome`, p)
        : Promise.resolve(undefined),
    ]);
    return {
      dominio: c.dominio, ind: c.ind, anos: anos.map((a) => Number(a.ano)), monetario: c.monetario, base_ipca: manifesto.base_ipca,
      universos: universos as Classificacao['universos'], serie: serie as PontoPosicao[], mudancas: mudancas as MudancaPosicao[],
      ...(lista ? { lista: lista as PontoPosicao[] } : {}),
    };
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
/** Indicador 0/1 com o campo vazio separado ('9') e qualquer outro código também à parte ('8'): vazio nunca vira 0. */
const FLAG = (c: string) => `CASE WHEN ${c} IS NULL THEN '9' WHEN ${c} IN (0, 1) THEN ${c}::VARCHAR ELSE '8' END`;
/** Tempo no emprego em meses, como na RAIS. */
const FAIXA_TEMPO = `CASE WHEN tempo_emprego IS NULL OR tempo_emprego < 0 THEN '9' WHEN tempo_emprego < 3 THEN '1' WHEN tempo_emprego < 12 THEN '2'
  WHEN tempo_emprego < 24 THEN '3' WHEN tempo_emprego < 60 THEN '4' WHEN tempo_emprego < 120 THEN '5' ELSE '6' END`;
/**
 * Remuneração de dezembro informada: vínculo ativo em 31/12 com valor maior que zero. Até a RAIS 2022 a falta
 * de valor vem como 0 no arquivo; desde 2023, em branco (ausente). As médias seguem o PDET/MTE: soma ÷ todos os
 * vínculos ativos do grupo, com quem não tem valor contado como zero (contados à parte); medianas, percentis e o
 * valor por hora usam só os valores informados.
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
  // indicadores dos vínculos: 0 e 1 são os códigos do arquivo; 9 aqui é o campo vazio (nunca vira 0); 8, qualquer outro código
  ['pcd', '0', 'Sem deficiência declarada'], ['pcd', '1', 'Com deficiência (inclui reabilitados)'],
  ['pcd', '8', 'Código diferente de 0 e 1'], ['pcd', '9', 'Sem informação no arquivo do ano'],
  ['trab_parcial', '0', 'Não'], ['trab_parcial', '1', 'Sim'], ['trab_parcial', '8', 'Código diferente de 0 e 1'], ['trab_parcial', '9', 'Sem informação no arquivo do ano (campo vazio)'],
  ['trab_intermitente', '0', 'Não'], ['trab_intermitente', '1', 'Sim'], ['trab_intermitente', '8', 'Código diferente de 0 e 1'], ['trab_intermitente', '9', 'Sem informação no arquivo do ano (campo vazio)'],
  // estabelecimentos: faixas calculadas do estoque de vínculos ativos em 31/12 e indicadores 0/1 (outros códigos ficam sem nome)
  ['estab_porte', '0', 'Zero vínculos ativos em 31/12'], ['estab_porte', '1', '1 a 4'], ['estab_porte', '2', '5 a 9'], ['estab_porte', '3', '10 a 19'],
  ['estab_porte', '4', '20 a 49'], ['estab_porte', '5', '50 a 99'], ['estab_porte', '6', '100 a 249'], ['estab_porte', '7', '250 a 499'],
  ['estab_porte', '8', '500 a 999'], ['estab_porte', '9', '1.000 ou mais'], ['estab_porte', 'N', 'Estoque negativo (valor inválido)'],
  ['estab_simples', '0', 'Não'], ['estab_simples', '1', 'Sim'],
  ['estab_pat', '0', 'Não'], ['estab_pat', '1', 'Sim'], ['estab_pat', '9', 'Código 9 (sem descrição verificada; único valor desde 2023)'],
];

/**
 * Fontes da consulta: os microdados (um arquivo por ano e UF, ~1–3 GB por ano), quando publicados (há
 * silver/trabalho/micro/indice.json no R2 ou, no servidor local do Vite, na pasta dos microdados), para UFs e
 * municípios; senão, e para o Brasil, as tabelas pré-somadas do gold: cubo_uf (UF × classe CNAE × CBO) e
 * cubo_mun (município × divisão CNAE × grande grupo CBO). VITE_MICRODADOS=0 força as tabelas.
 */
type FonteConsulta = 'micro' | 'cubo_uf' | 'cubo_mun';
export type IndiceMicro = { rais_vinculos?: Record<string, number[]>; rais_estab?: Record<string, number[]> };
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
  pcd: { micro: FLAG('deficiente'), nome: 'pcd' },
  tipo_deficiencia: { micro: 'tipo_deficiencia::VARCHAR', nome: 'tipo_deficiencia' },
  nacionalidade: { micro: 'nacionalidade::VARCHAR', nome: 'nacionalidade' },
  trab_parcial: { micro: FLAG('ind_parcial'), nome: 'trab_parcial' },
  trab_intermitente: { micro: FLAG('ind_intermitente'), nome: 'trab_intermitente' },
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
  pcd: { expr: FLAG('deficiente'), variavel: 'pcd' },
  tdef: { expr: 'tipo_deficiencia::VARCHAR', variavel: 'tipo_deficiencia' },
  nac: { expr: 'nacionalidade::VARCHAR', variavel: 'nacionalidade' },
  parc: { expr: FLAG('ind_parcial'), variavel: 'trab_parcial' },
  intm: { expr: FLAG('ind_intermitente'), variavel: 'trab_intermitente' },
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
  sum(rem_dezembro_nom) FILTER (${REM_VALIDA})::DOUBLE / nullif(count(*) FILTER (ativo_31_12 = 1), 0) AS rem_dez_media,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.1) FILTER (${REM_VALIDA}) AS rem_dez_p10,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.25) FILTER (${REM_VALIDA}) AS rem_dez_p25,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.5) FILTER (${REM_VALIDA}) AS rem_dez_mediana,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.75) FILTER (${REM_VALIDA}) AS rem_dez_p75,
  quantile_cont(rem_dezembro_nom::DOUBLE, 0.9) FILTER (${REM_VALIDA}) AS rem_dez_p90,
  sum(rem_dezembro_nom) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS})::DOUBLE
    / nullif(sum(horas_contratadas * ${SEMANAS_MES}) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS}), 0) AS rem_hora_media,
  median(rem_dezembro_nom::DOUBLE / (horas_contratadas * ${SEMANAS_MES})) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS}) AS rem_hora_mediana,
  count(*) FILTER (${REM_VALIDA} AND ${HORAS_VALIDAS}) AS n_rem_hora,
  sum(rem_media_nom) FILTER (rem_media_nom > 0)::DOUBLE / nullif(count(*), 0) AS rem_media_media,
  median(rem_media_nom::DOUBLE) FILTER (rem_media_nom > 0) AS rem_media_mediana,
  count(*) FILTER (rem_media_nom > 0) AS n_rem_media,
  avg(horas_contratadas) FILTER (horas_contratadas > 0) AS horas_media,
  avg(idade) AS idade_media`;

// o cubo guarda somas e contagens: médias saem como soma ÷ contagem (as de remuneração, ÷ todos os vínculos do
// grupo, como o PDET); medianas e percentis não são somáveis
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
  sum(rem_dez_soma) / nullif(sum(vinculos) FILTER (situacao = 1), 0) AS rem_dez_media,
  NULL::DOUBLE AS rem_dez_p10, NULL::DOUBLE AS rem_dez_p25, NULL::DOUBLE AS rem_dez_mediana, NULL::DOUBLE AS rem_dez_p75, NULL::DOUBLE AS rem_dez_p90,
  NULL::DOUBLE AS rem_hora_media, NULL::DOUBLE AS rem_hora_mediana, NULL::DOUBLE AS n_rem_hora,
  sum(rem_media_soma) / nullif(sum(vinculos), 0) AS rem_media_media,
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
    const bruto = String(q[k] ?? '').split(/[\s,;]+/).filter(Boolean);
    // um código que não é número de até 4 dígitos é erro de digitação: avisa em vez de ignorar e consultar o universo inteiro
    const invalidos = bruto.filter((s) => !/^[0-9]{1,4}$/.test(s));
    if (invalidos.length) throw new Error(t(`Filtro ${k}: código inválido (${invalidos.slice(0, 3).join(', ')}). Use códigos numéricos de até 4 dígitos.`, `Filter ${k}: invalid code (${invalidos.slice(0, 3).join(', ')}). Use numeric codes of up to 4 digits.`));
    const valores = bruto.slice(0, 60);
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

// ---------- estabelecimentos (RAIS Estabelecimentos, microdados) ----------

const num0 = (v: unknown) => (typeof v === 'number' ? v : 0);

/**
 * Anos e UFs de rais_estab que o índice dos microdados publica (nada é suposto: 2010–2019 não têm a UF 99, a geografia
 * ignorada). Sem índice, sem a chave rais_estab (índice antigo) ou com VITE_MICRODADOS=0, o resultado é vazio.
 */
async function indiceEstab(): Promise<Record<number, number[]>> {
  if (env?.VITE_MICRODADOS === '0') return {};
  return estabDoIndice(indiceMicro ?? await baixar('silver/trabalho/micro/indice.json').then((b) => JSON.parse(new TextDecoder().decode(b)) as IndiceMicro).catch(() => null));
}

/** Anos e UFs de rais_estab de um índice (já lido): só anos de 4 dígitos com UFs inteiras; índice antigo (sem rais_estab) dá {}. */
export function estabDoIndice(indice: IndiceMicro | null | undefined): Record<number, number[]> {
  const saida: Record<number, number[]> = {};
  for (const [ano, ufs] of Object.entries(indice?.rais_estab ?? {})) {
    const lista = (Array.isArray(ufs) ? ufs : []).filter((u) => Number.isInteger(u)).sort((x, y) => x - y);
    if (/^\d{4}$/.test(ano) && lista.length) saida[Number(ano)] = lista;
  }
  return saida;
}

/** Faixas do estoque de vínculos ativos em 31/12 (calculadas de qtd_vinculos_ativos; zero à parte, ausente fica sem faixa). */
const FAIXAS_ESTAB = `CASE WHEN qtd_vinculos_ativos IS NULL THEN NULL WHEN qtd_vinculos_ativos < 0 THEN 'N' WHEN qtd_vinculos_ativos = 0 THEN '0'
  WHEN qtd_vinculos_ativos < 5 THEN '1' WHEN qtd_vinculos_ativos < 10 THEN '2' WHEN qtd_vinculos_ativos < 20 THEN '3' WHEN qtd_vinculos_ativos < 50 THEN '4'
  WHEN qtd_vinculos_ativos < 100 THEN '5' WHEN qtd_vinculos_ativos < 250 THEN '6' WHEN qtd_vinculos_ativos < 500 THEN '7' WHEN qtd_vinculos_ativos < 1000 THEN '8' ELSE '9' END`;
/** Agrupamentos de estabelecimentos: expressão sobre as colunas de rais_estab e de onde vem o nome (dicionário). */
export const GRUPOS_ESTAB: Record<string, Grupo> = {
  total: { micro: `'total'` },
  divisao: { micro: 'cnae_classe[1:2]', nome: 'divisao' },
  porte: { micro: FAIXAS_ESTAB, nome: 'estab_porte' },
  natureza_juridica: { micro: 'natureza_juridica::VARCHAR', nome: 'natureza_juridica' },
  simples: { micro: 'ind_simples::VARCHAR', nome: 'estab_simples' },
  pat: { micro: 'ind_pat::VARCHAR', nome: 'estab_pat' },
};

/**
 * Medidas por estabelecimento (uma linha do arquivo = um estabelecimento declarante, não uma empresa). Estoque = vínculos
 * ativos em 31/12 (qtd_vinculos_ativos); ausente (NULL) fica à parte e nunca vira 0. RAIS negativa (código 1) é a declaração
 * sem vínculos no ano, diferente de estoque zero em 31/12. Indicadores: só 0/1 contam como Não/Sim; vazio e outros códigos
 * ficam fora dessas contagens e aparecem em "informado" e "outro código".
 */
const MEDIDAS_ESTAB = `
  count(*)::DOUBLE AS estabelecimentos,
  count(qtd_vinculos_ativos)::DOUBLE AS com_estoque,
  (count(*) - count(qtd_vinculos_ativos))::DOUBLE AS sem_estoque,
  count(*) FILTER (qtd_vinculos_ativos = 0) AS estoque_zero,
  count(*) FILTER (qtd_vinculos_ativos < 0) AS estoque_negativo,
  count(*) FILTER (qtd_vinculos_ativos > 0) AS com_vinculos,
  sum(qtd_vinculos_ativos) FILTER (qtd_vinculos_ativos > 0)::DOUBLE AS vinculos_ativos,
  sum(qtd_vinculos_ativos) FILTER (qtd_vinculos_ativos > 0)::DOUBLE / nullif(count(*) FILTER (qtd_vinculos_ativos > 0), 0) AS media_com_vinculos,
  quantile_cont(qtd_vinculos_ativos::DOUBLE, 0.5) FILTER (qtd_vinculos_ativos > 0) AS mediana_com_vinculos,
  count(ind_rais_negativa) AS negativa_informada,
  count(*) FILTER (ind_rais_negativa = 1) AS rais_negativa,
  count(*) FILTER (ind_rais_negativa = 1 AND qtd_vinculos_ativos > 0) AS negativa_com_vinculos,
  count(*) FILTER (ind_rais_negativa NOT IN (0, 1)) AS negativa_outro_codigo,
  count(ind_simples) AS simples_informado,
  count(*) FILTER (ind_simples = 1) AS simples_sim,
  count(*) FILTER (ind_simples = 0) AS simples_nao,
  count(*) FILTER (ind_simples NOT IN (0, 1)) AS simples_outro_codigo,
  count(ind_pat) AS pat_informado,
  count(*) FILTER (ind_pat = 1) AS pat_sim,
  count(*) FILTER (ind_pat = 0) AS pat_nao,
  count(*) FILTER (ind_pat NOT IN (0, 1)) AS pat_outro_codigo,
  count(*) FILTER (uf = 99) AS geografia_ignorada`;

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

  /** Anos e UFs publicados de rais_estab (vazio: índice antigo, sem estabelecimentos). */
  async trab_estab_indice() {
    const indice = await indiceEstab();
    return { anos: Object.keys(indice).map(Number).sort((a, b) => a - b), ufs: indice };
  },

  /**
   * Estabelecimentos declarantes da RAIS num ano: o resumo do território e, opcionalmente, um agrupamento (GRUPOS_ESTAB),
   * numa leitura só (GROUPING SETS). Brasil lê os arquivos que o índice lista para o ano (inclui a UF 99, geografia ignorada,
   * quando existir); UF lê o arquivo da UF; município lê o da UF filtrando o código de 6 dígitos. Ano ou UF fora do índice: erro claro.
   */
  async trab_estab(q) {
    await dicionarioTrabalho();
    const ano = inteiro(q.ano);
    const indice = await indiceEstab();
    const ufsAno = ano ? indice[ano] ?? [] : [];
    if (!ano || !ufsAno.length) throw new Error(t(`Não há microdados de estabelecimentos publicados para ${ano ?? 'o ano pedido'}.`, `No establishment microdata is published for ${ano ?? 'the requested year'}.`));
    const chave = String(q.agrupar ?? 'total');
    const grupo = GRUPOS_ESTAB[chave];
    if (!grupo) throw new Error(t(`Agrupamento de estabelecimentos desconhecido: ${chave}.`, `Unknown establishment grouping: ${chave}.`));
    const ente = inteiro(q.ente);
    const uf = UFS.has(String(q.uf)) ? String(q.uf) : null;
    let ufCod: number | null = null;
    const filtros: string[] = [];
    if (ente) {
      const cod = ente === 53 ? 5300108 : ente;
      ufCod = Math.floor(cod / 100000);
      filtros.push(`municipio = ${Math.floor(cod / 10)}`);
    } else if (uf) {
      const [u] = await consultar(`SELECT cod_ibge FROM entes WHERE esfera IN ('E', 'D') AND uf = $uf`, { uf });
      ufCod = Number(u?.cod_ibge);
    }
    if (ufCod !== null && !ufsAno.includes(ufCod)) {
      throw new Error(t(`Não há arquivo de estabelecimentos de ${SIGLAS[ufCod] ?? ufCod} em ${ano}.`, `There is no establishment file for ${SIGLAS[ufCod] ?? ufCod} in ${ano}.`));
    }
    const ufsLidas = ufCod !== null ? [ufCod] : ufsAno;
    const caminho = (u: number) => `silver/trabalho/micro/rais_estab/ano=${ano}/uf=${u}.parquet`;
    const onde = filtros.length ? filtros.join(' AND ') : 'true';
    const consulta = (origem: string) => `SELECT g.*, ${chave === 'total' ? 'NULL' : nomeDoGrupo(grupo, 'grupo')} AS nome
       FROM (SELECT ${chave === 'total' ? `'total' AS nivel, NULL::VARCHAR AS grupo` : `CASE WHEN grouping(grupo) = 0 THEN 'grupo' ELSE 'total' END AS nivel, grupo::VARCHAR AS grupo`}, ${MEDIDAS_ESTAB}
             FROM (SELECT *, ${grupo.micro} AS grupo FROM read_parquet(${origem}) WHERE ${onde})
             GROUP BY GROUPING SETS ((), (grupo))) g
       ORDER BY g.nivel DESC, g.estabelecimentos DESC`;
    const sql = consulta(`[${ufsLidas.map((u) => arq(caminho(u))).join(', ')}]`);
    const linhas = await consultarTrabalho(sql, ufCod === null
      ? t(`Lendo os estabelecimentos da RAIS ${ano} de ${ufsLidas.length} arquivos de UF (Brasil)`, `Reading RAIS ${ano} establishments from ${ufsLidas.length} state files (Brazil)`)
      : t(`Lendo os estabelecimentos da RAIS ${ano} (${SIGLAS[ufCod] ?? ufCod})`, `Reading RAIS ${ano} establishments (${SIGLAS[ufCod] ?? ufCod})`));
    const resumo = linhas.find((r) => r.nivel === 'total') ?? null;
    // o SQL mostrado e exportado tem a mesma lista exata de arquivos (caminhos relativos), sem glob: um arquivo extra fora do índice mudaria os números
    const exibicao = consulta(`[${ufsLidas.map((u) => `'${caminho(u)}'`).join(', ')}]`);
    return {
      fonte: 'estab', ano, uf_cod: ufCod, ufs: ufsLidas, resumo: resumo && num0(resumo.estabelecimentos) ? resumo : null,
      grupos: linhas.filter((r) => r.nivel === 'grupo'), agrupar: chave, sql: semEspacos(exibicao),
      tem_uf99: ufsLidas.includes(99), caminhos: ufsLidas.map(caminho), rotulo_uf: ufCod === null ? t('Brasil', 'Brazil') : SIGLAS[ufCod] ?? String(ufCod),
    };
  },

  /** Nomes de um código do dicionário (CBO, CNAE…) que contêm o texto, para a busca dos filtros. */
  async trab_dicionario(q) {
    await dicionarioTrabalho();
    const texto = String(q.texto ?? '').trim();
    if (texto.length < 2) return [];
    // as divisões da CNAE não estão no dicionário (só classe e subclasse): os nomes vêm de trab_cnae, como em nomeDoGrupo
    if (String(q.variavel) === 'cnae_divisao') {
      return consultar(
        `SELECT DISTINCT lpad(divisao::VARCHAR, 2, '0') AS codigo, divisao_nome AS descricao FROM trab_cnae
         WHERE strip_accents(lower(divisao_nome)) LIKE '%' || strip_accents(lower($texto)) || '%' OR lpad(divisao::VARCHAR, 2, '0') LIKE $texto || '%'
         ORDER BY codigo LIMIT 30`,
        { texto },
      );
    }
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
  base_ipca: number; microdados: boolean; esc_porte_anos?: number[];
};

/**
 * Prepara as tabelas que a IA do mercado de trabalho consulta: as pequenas em memória (tabelasTrabalho e o
 * dicionário) e visões sobre arquivos lidos por Range (setores e CAGED por município, tabelas somadas por
 * ano e, no computador local, os microdados por ano e UF, com a lista do indice.json). Devolve o contexto.
 */
let iaTrabalho: Promise<ContextoTrabalho> | null = null;
let iaTrabalhoPronto: ContextoTrabalho | null = null;

/**
 * O contexto do trabalho (anos da RAIS, microdados, CAGED) só com o manifesto, sem criar as tabelas nem as visões: serve ao
 * prompt e à cobertura de qualquer pergunta. As tabelas só são preparadas (tabelasIaTrabalho) quando uma consulta as usa.
 * Depois de preparadas, vale o contexto conferido (inclusive o índice dos microdados).
 */
export async function contextoTrabalhoIa(): Promise<ContextoTrabalho> {
  if (iaTrabalhoPronto) return iaTrabalhoPronto;
  const { manifesto } = await iniciar();
  const f = (manifesto.fontes ?? {}) as Record<string, Record<string, unknown>>;
  const microAnos = ((f.rais_micro?.anos as number[] | undefined) ?? []).filter(Number.isInteger);
  const rais = f.rais as { anos?: number[] } | undefined;
  const caged = f.caged as { de?: number; ate?: number } | undefined;
  return {
    rais_anos: rais?.anos ?? [], micro_anos: microAnos, caged_de: caged?.de ?? null, caged_ate: caged?.ate ?? null,
    base_ipca: manifesto.base_ipca, microdados: temMicro() && microAnos.length > 0,
    esc_porte_anos: (((f.rais_micro as { esc_porte?: number[] } | undefined)?.esc_porte) ?? []).filter(Number.isInteger),
  };
}

/**
 * Colunas DECIMAL da fonte como DOUBLE (cláusula REPLACE do SELECT *): uma soma ou um produto de DECIMAL, como a
 * remuneração vezes o fator do IPCA, estoura a precisão do tipo (erro de overflow); em DOUBLE as contas de valores
 * reais não estouram, e os centavos seguem exatos nas ordens de grandeza da RAIS. Sem DESCRIBE, a fonte fica como está.
 */
async function decimaisEmDouble(fonte: string): Promise<string> {
  try {
    const colunas = await consultar(`DESCRIBE SELECT * FROM ${fonte} LIMIT 0`);
    const decimais = colunas.filter((c) => /^DECIMAL/i.test(String(c.column_type))).map((c) => String(c.column_name).replace(/"/g, '""'));
    return decimais.length ? ` REPLACE (${decimais.map((c) => `"${c}"::DOUBLE AS "${c}"`).join(', ')})` : '';
  } catch {
    return '';
  }
}

/**
 * Cria, na conexão da IA, uma tabela temporária para cada resultado já apurado na conversa (res_C1…), para as
 * perguntas seguintes recalcularem sobre ele. Números não inteiros entram como DOUBLE (um literal decimal do
 * DuckDB é DECIMAL e voltaria a estourar nas contas).
 */
export async function prepararResultadosIa(tabelas: { nome: string; colunas: string[]; linhas: (string | number | boolean | null)[][] }[], sinal?: AbortSignal) {
  const con = await conexaoIa();
  const lit = (v: string | number | boolean | null) => (v === null || (typeof v === 'number' && !Number.isFinite(v)) ? 'NULL'
    : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : `${v}::DOUBLE`)
      : typeof v === 'boolean' ? String(v) : `'${v.replace(/'/g, "''")}'`);
  for (const tab of tabelas) {
    if (!/^res_C\d+$/.test(tab.nome)) throw new Error(`nome de tabela não permitido: ${tab.nome}`);
    const nomes = tab.colunas.map((c) => `"${c.replace(/"/g, '""')}"`);
    const sql = tab.linhas.length
      ? `CREATE OR REPLACE TEMP TABLE ${tab.nome} AS SELECT * FROM (VALUES ${tab.linhas.map((l) => `(${l.map(lit).join(', ')})`).join(', ')}) AS t(${nomes.join(', ')})`
      : `CREATE OR REPLACE TEMP TABLE ${tab.nome} AS SELECT ${nomes.map((n) => `NULL::DOUBLE AS ${n}`).join(', ')} WHERE false`;
    await lerCancelavel(con, sql, sinal);
  }
}

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
      await con.query(`CREATE OR REPLACE VIEW rais_uf AS SELECT *${await decimaisEmDouble(cubo('cubo_uf'))}, ${sigla('uf')} AS uf_sigla FROM ${cubo('cubo_uf')}`);
      // uf (2 dígitos) a partir do município, para filtrar uma UF nesta tabela como nas outras
      await con.query(`CREATE OR REPLACE VIEW rais_mun AS SELECT *${await decimaisEmDouble(cubo('cubo_mun'))}, (municipio // 10000)::INTEGER AS uf, ${sigla('municipio // 10000')} AS uf_sigla FROM ${cubo('cubo_mun')}`);
    }
    // cruzamento nacional escolaridade × porte do estabelecimento (cubo_esc_porte): H1 a H4 montados aqui, na visão
    const escAnos = ((f.rais_micro as { esc_porte?: number[] } | undefined)?.esc_porte ?? []).filter(Number.isInteger);
    if (escAnos.length) {
      const fonteEsc = `read_parquet(${lista(escAnos.map((a) => `gold/trabalho/cubo_esc_porte/ano=${a}.parquet`))})`;
      await con.query(`CREATE OR REPLACE VIEW rais_esc_porte AS SELECT *${await decimaisEmDouble(fonteEsc)}, ${sigla('uf')} AS uf_sigla,
        CASE WHEN escolaridade_cod BETWEEN 1 AND 4 THEN 'H1' WHEN escolaridade_cod BETWEEN 5 AND 6 THEN 'H2'
             WHEN escolaridade_cod BETWEEN 7 AND 8 THEN 'H3' WHEN escolaridade_cod BETWEEN 9 AND 11 THEN 'H4' ELSE 'ignorada' END AS escolaridade_grupo
        FROM ${fonteEsc}`);
    }
    let microdados = false;
    if (temMicro()) {
      try {
        const indice = indiceMicro ?? JSON.parse(new TextDecoder().decode(await baixar('silver/trabalho/micro/indice.json'))) as IndiceMicro;
        const arquivos = Object.entries(indice.rais_vinculos ?? {}).flatMap(([ano, ufs]) =>
          ufs.filter(Number.isInteger).map((uf) => `silver/trabalho/micro/rais_vinculos/ano=${Number(ano)}/uf=${uf}.parquet`));
        if (arquivos.length) {
          // hive_partitioning: o filtro por ano e uf descarta arquivos pelo caminho, sem abri-los
          const fonteVinculos = `read_parquet(${lista(arquivos)}, hive_partitioning = true)`;
          await con.query(`CREATE OR REPLACE VIEW rais_vinculos AS SELECT *${await decimaisEmDouble(fonteVinculos)}, ${sigla('uf')} AS uf_sigla FROM ${fonteVinculos}`);
          microdados = true;
        }
      } catch {
        /* sem microdados publicados: a IA usa as tabelas somadas */
      }
    }
    const rais = f.rais as { anos?: number[] } | undefined;
    const caged = f.caged as { de?: number; ate?: number } | undefined;
    return (iaTrabalhoPronto = {
      rais_anos: rais?.anos ?? [], micro_anos: microAnos, caged_de: caged?.de ?? null, caged_ate: caged?.ate ?? null,
      base_ipca: manifesto.base_ipca, microdados, esc_porte_anos: escAnos,
    });
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

/**
 * Larga a conexão da IA depois de uma consulta cancelada ou estourada: se o DuckDB estiver preso numa leitura de rede,
 * a pergunta seguinte abre outra conexão em vez de entrar na fila atrás dela. Pede também que a consulta pare.
 */
export function abandonarConsultaIa() {
  const antiga = conexaoDaIa;
  conexaoDaIa = null;
  void antiga?.then((c) => c.cancelSent()).catch(() => undefined);
}
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
  const rota = rotas[caminho] ?? rotasLrf[caminho] ?? rotasSaudeEducacao[caminho] ?? rotasTrabalho[caminho] ?? rotasConsulta[caminho] ?? rotasSaude[caminho] ?? rotasVacinacao[caminho] ?? rotasFns[caminho] ?? rotasMunic[caminho] ?? rotasClima[caminho]
    ?? rotasPosicoes[caminho];
  if (!rota) throw new Error(`rota desconhecida: ${caminho}`);
  return rota(params);
}
