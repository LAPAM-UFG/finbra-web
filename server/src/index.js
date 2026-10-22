import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consultar, dcaAno, DATA_DIR } from './db.js';

const app = Fastify({ logger: { level: 'info' } });
await app.register(cors);

// ---------- utilidades ----------

const cache = new Map();
async function emCache(chave, fn) {
  if (cache.has(chave)) return cache.get(chave);
  const valor = await fn();
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  cache.set(chave, valor);
  return valor;
}

const inteiro = (v) => (v === undefined || v === '' ? null : Number.parseInt(v, 10));
const ESFERAS = new Set(['M', 'E', 'D']);
const UFS = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));

/** Exclui dos agregados os ente-anos com declaração atípica (gold/alertas.parquet). */
const valido = (linha) =>
  `NOT EXISTS (SELECT 1 FROM excluidos x WHERE x.exercicio = ${linha}.exercicio AND x.cod_ibge = ${linha}.cod_ibge)`;

/**
 * Escopo da consulta: um ente, os entes de uma UF ou o Brasil (sempre de uma esfera).
 * `linha` é a tabela com (exercicio, cod_ibge); nos agregados ela perde os ente-anos atípicos.
 * Um ente escolhido diretamente é sempre mostrado como declarou.
 */
function escopo(q, prefixo = '', linha = null) {
  const ente = inteiro(q.ente);
  const uf = UFS.has(q.uf) ? q.uf : null;
  const esfera = ESFERAS.has(q.esfera) ? q.esfera : 'M';
  const filtro = linha ? ` AND ${valido(linha)}` : '';
  if (ente) return { sql: `${prefixo}cod_ibge = $ente`, params: { ente } };
  if (uf) return { sql: `${prefixo}uf = $uf AND ${prefixo}esfera = $esfera${filtro}`, params: { uf, esfera } };
  return { sql: `${prefixo}esfera = $esfera${filtro}`, params: { esfera } };
}

/** Comparador do escopo: ente → sua UF (mesma esfera); UF → Brasil; Brasil → nenhum. */
async function comparador(q) {
  const ente = inteiro(q.ente);
  if (ente) {
    const [e] = await consultar('SELECT uf, esfera FROM entes WHERE cod_ibge = $ente', { ente });
    if (!e) return null;
    // estado e DF comparam com todos os estados; município com os municípios da UF
    return e.esfera === 'M' ? { uf: e.uf, esfera: 'M', rotulo: e.uf } : { esfera: e.esfera, rotulo: 'Estados' };
  }
  if (UFS.has(q.uf)) return { esfera: q.esfera ?? 'M', rotulo: 'Brasil' };
  return null;
}

async function baseIpca() {
  return emCache('ipca-base', async () => {
    const [r] = await consultar('SELECT max(exercicio) AS base FROM ipca WHERE completo');
    return r.base;
  });
}

// ---------- metadados ----------

app.get('/api/meta', async () =>
  emCache('meta', async () => {
    const anos = (await consultar('SELECT DISTINCT exercicio FROM populacao ORDER BY 1')).map((r) => r.exercicio);
    const ultimo = anos.at(-1);
    const colunas = await consultar(
      `SELECT anexo, coluna, count(*) AS n FROM ${dcaAno(ultimo)} GROUP BY ALL ORDER BY anexo, n DESC`,
    );
    const anexos = {};
    for (const { anexo, coluna } of colunas) (anexos[anexo] ??= []).push(coluna);
    return { anos, anexos, baseIpca: await baseIpca() };
  }),
);

app.get('/api/entes', async () =>
  emCache('entes', () =>
    consultar(`SELECT cod_ibge, nome, uf, esfera, capital FROM entes ORDER BY esfera DESC, uf, nome`),
  ),
);

app.get('/api/colunas', async (req) => {
  const ano = inteiro(req.query.ano);
  return emCache(`colunas:${ano}:${req.query.anexo}`, async () =>
    (await consultar(
      `SELECT coluna, count(*) AS n FROM ${dcaAno(ano)} WHERE anexo = $anexo GROUP BY coluna ORDER BY n DESC`,
      { anexo: req.query.anexo },
    )).map((r) => r.coluna),
  );
});

/** Contas de um anexo num exercício (sem valores), para seletores. */
app.get('/api/contas', async (req) => {
  const q = req.query;
  const nivelMax = inteiro(q.nivel_max) ?? 3;
  return emCache(`contas:${JSON.stringify(q)}`, () =>
    consultar(
      `SELECT chave, chave_pai, nivel, descricao, tipo FROM contas
       WHERE exercicio = $ano AND anexo = $anexo AND (tipo = 'total' OR nivel <= $nivelMax)
       ORDER BY ordem`,
      { ano: inteiro(q.ano), anexo: q.anexo, nivelMax },
    ),
  );
});

// ---------- árvore de contas de um anexo ----------

app.get('/api/arvore', async (req) => {
  const q = req.query;
  const ano = inteiro(q.ano);
  return emCache(`arvore:${JSON.stringify(q)}`, async () => {
    const alvo = escopo(q, 'e.', 'd');
    const comp = await comparador(q);
    const params = { ...alvo.params, ano, anexo: q.anexo, coluna: q.coluna };
    let sqlComp = 'SELECT NULL::VARCHAR AS chave, NULL::DOUBLE AS valor WHERE false';
    if (comp) {
      const filtro = `${comp.uf ? 'e.uf = $cuf AND e.esfera = $cesf' : 'e.esfera = $cesf'} AND ${valido('d')}`;
      Object.assign(params, { cesf: comp.esfera }, comp.uf ? { cuf: comp.uf } : {});
      sqlComp = `SELECT chave, sum(valor) AS valor FROM ${dcaAno(ano)} d JOIN entes e USING (cod_ibge)
                 WHERE ${filtro} AND anexo = $anexo AND coluna = $coluna GROUP BY chave`;
    }
    const nos = await consultar(
      `WITH v AS (
         SELECT chave, sum(valor) AS valor, bool_or(sintetico) AS sintetico
         FROM ${dcaAno(ano)} d JOIN entes e USING (cod_ibge)
         WHERE ${alvo.sql} AND anexo = $anexo AND coluna = $coluna GROUP BY chave),
       comp AS (${sqlComp})
       SELECT c.chave, c.chave_pai, c.nivel, c.descricao, c.tipo, v.valor, comp.valor AS valor_comp, v.sintetico
       FROM contas c LEFT JOIN v USING (chave) LEFT JOIN comp USING (chave)
       WHERE c.exercicio = $ano AND c.anexo = $anexo AND (v.valor IS NOT NULL OR comp.valor IS NOT NULL)
       ORDER BY c.ordem`,
      params,
    );
    const pop = await populacoes(ano, q, comp);
    return { nos, ...pop, comparador: comp?.rotulo ?? null };
  });
});

async function populacoes(ano, q, comp) {
  const alvo = escopo(q, 'e.', 'p');
  const [a] = await consultar(
    `SELECT sum(p.populacao) AS pop, count(*) AS entes FROM populacao p JOIN entes e USING (cod_ibge)
     WHERE p.exercicio = $ano AND ${alvo.sql}`,
    { ...alvo.params, ano },
  );
  let popComp = null;
  if (comp) {
    const filtro = `${comp.uf ? 'e.uf = $cuf AND e.esfera = $cesf' : 'e.esfera = $cesf'} AND ${valido('p')}`;
    const [c] = await consultar(
      `SELECT sum(p.populacao) AS pop FROM populacao p JOIN entes e USING (cod_ibge)
       WHERE p.exercicio = $ano AND ${filtro}`,
      { ano, cesf: comp.esfera, ...(comp.uf ? { cuf: comp.uf } : {}) },
    );
    popComp = c.pop;
  }
  return { populacao: a.pop, entes: a.entes, populacao_comp: popComp };
}

// ---------- série histórica de uma conta ----------

app.get('/api/serie', async (req) => {
  const q = req.query;
  return emCache(`serie:${JSON.stringify(q)}`, async () => {
    const alvo = escopo(q, 'e.', 'p');
    const base = await baseIpca();
    return consultar(
      `WITH alvo AS (
         SELECT p.exercicio, p.cod_ibge, p.populacao FROM populacao p JOIN entes e USING (cod_ibge) WHERE ${alvo.sql}),
       v AS (
         SELECT d.exercicio, sum(d.valor) AS valor FROM dca d JOIN alvo USING (exercicio, cod_ibge)
         WHERE d.anexo = $anexo AND d.coluna = $coluna AND d.chave = $chave GROUP BY ALL),
       pop AS (SELECT exercicio, sum(populacao) AS populacao, count(*) AS entes FROM alvo GROUP BY ALL)
       SELECT pop.exercicio AS ano, v.valor, v.valor * b.indice / i.indice AS valor_real, pop.populacao, pop.entes
       FROM pop LEFT JOIN v USING (exercicio) LEFT JOIN ipca i USING (exercicio)
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       ORDER BY ano`,
      { ...alvo.params, anexo: q.anexo, coluna: q.coluna, chave: q.chave, base },
    );
  });
});

// ---------- indicadores (gold) agregados ----------

const CAMPOS = new Set([
  'receita_bruta', 'deducoes', 'receita_liquida', 'receita_corrente', 'receita_capital',
  'receita_impostos_taxas', 'transferencias_correntes', 'fpm', 'icms', 'ipva', 'iptu', 'iss', 'itbi',
  'despesa_empenhada', 'despesa_liquidada', 'despesa_paga', 'despesa_pessoal', 'investimentos',
  'despesa_saude', 'despesa_educacao', 'ativo', 'patrimonio_liquido', 'pib', 'vab_agropecuaria',
  'vab_industria', 'vab_servicos', 'vab_adm_publica', 'bolsa_familia_familias', 'bolsa_familia_valor',
  'inss_beneficios', 'inss_aposentadorias', 'area_km2',
]);
const MONETARIOS = new Set([...CAMPOS].filter((c) => !['bolsa_familia_familias', 'inss_beneficios', 'inss_aposentadorias', 'area_km2'].includes(c)));
const DIMENSOES = new Set(['exercicio', 'uf', 'regiao', 'faixa_grupo', 'cod_ibge']);

app.get('/api/agregado', async (req) => {
  const q = req.query;
  return emCache(`agregado:${JSON.stringify(q)}`, async () => {
    const campos = String(q.campos ?? '').split(',').filter((c) => CAMPOS.has(c));
    const por = String(q.por ?? 'exercicio').split(',').filter((d) => DIMENSOES.has(d));
    if (!campos.length || !por.length) return [];
    const alvo = escopo(q, '', 'indicadores');
    const filtros = [alvo.sql];
    const params = { ...alvo.params, base: await baseIpca() };
    if (inteiro(q.ano)) { filtros.push('exercicio = $ano'); params.ano = inteiro(q.ano); }
    if (inteiro(q.faixa)) { filtros.push('faixa_grupo = $faixa'); params.faixa = inteiro(q.faixa); }
    const somas = campos.flatMap((c) => {
      const s = [`sum(${c}) AS ${c}`];
      if (MONETARIOS.has(c)) s.push(`sum(${c} * b.indice / i.indice) AS ${c}_real`);
      return s;
    });
    const extras = por.includes('cod_ibge') ? ', any_value(nome) AS nome, any_value(uf) AS uf_ente' : '';
    return consultar(
      `SELECT ${por.join(', ')}, ${somas.join(', ')}, sum(populacao) AS populacao, count(*) AS entes${extras}
       FROM indicadores LEFT JOIN ipca i USING (exercicio)
       CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       WHERE ${filtros.join(' AND ')}
       GROUP BY ${por.join(', ')} ORDER BY ${por.join(', ')}`,
      params,
    );
  });
});

app.get('/api/ranking', async (req) => {
  const q = req.query;
  const campo = CAMPOS.has(q.campo) ? q.campo : 'receita_bruta';
  const ano = inteiro(q.ano);
  const limite = Math.min(inteiro(q.limite) ?? 20, 100);
  const perCapita = q.per_capita === '1';
  const alvo = escopo({ ...q, ente: undefined }, '', 'indicadores');
  const expr = perCapita ? `${campo} / nullif(populacao, 0)` : campo;
  return emCache(`ranking:${JSON.stringify(q)}`, () =>
    consultar(
      `SELECT cod_ibge, nome, uf, populacao, ${campo} AS valor, ${expr} AS indicador
       FROM indicadores WHERE exercicio = $ano AND ${alvo.sql} AND ${campo} IS NOT NULL
       ORDER BY indicador ${q.ordem === 'asc' ? 'ASC' : 'DESC'} LIMIT ${limite}`,
      { ...alvo.params, ano },
    ),
  );
});

app.get('/api/alertas', async (req) => {
  const ente = inteiro(req.query.ente);
  return emCache(`alertas:${ente}`, () =>
    consultar(
      `SELECT exercicio, cod_ibge, nome, uf, esfera, indicador, valor, mediana, razao, motivo FROM alertas
       ${ente ? 'WHERE cod_ibge = $ente' : ''} ORDER BY exercicio DESC, razao DESC NULLS LAST`,
      ente ? { ente } : {},
    ),
  );
});

app.get('/api/faixas', async () => emCache('faixas', () => consultar('SELECT * FROM faixas ORDER BY grupo')));

app.get('/api/ipca', async () =>
  emCache('ipca', async () => {
    const base = await baseIpca();
    return consultar(
      `SELECT i.exercicio AS ano, i.ipca_pct, i.completo, b.indice / i.indice AS fator
       FROM ipca i CROSS JOIN (SELECT indice FROM ipca WHERE exercicio = $base) b
       WHERE i.exercicio >= 2013 ORDER BY 1`,
      { base },
    );
  }),
);

app.get('/api/validacao', async () => {
  const arquivo = `${DATA_DIR}/gold/validacao.csv`;
  if (!fs.existsSync(arquivo)) return [];
  return emCache('validacao', () => consultar(`SELECT * FROM read_csv('${arquivo}')`));
});

// ---------- site compilado (produção) ----------

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(web)) {
  await app.register(fastifyStatic, { root: web });
  app.setNotFoundHandler((req, reply) =>
    req.url.startsWith('/api/') ? reply.code(404).send({ erro: 'não encontrado' }) : reply.sendFile('index.html'),
  );
}

await app.listen({ port: Number(process.env.PORT ?? 3001), host: '0.0.0.0' });
