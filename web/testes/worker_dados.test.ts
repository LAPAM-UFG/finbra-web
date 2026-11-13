/**
 * Servidor de dados do Worker (/dados/*) com um R2 simulado: HEAD só de metadados e sem cache, GET parcial cacheável,
 * condicionais (304) e recusas. Não acessa o R2 real.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error módulo JavaScript do Worker, sem tipos
import worker from '../../worker/src/index.js';

const CHAVE = 'gold/munic/painel_agregados.parquet';
const CONTEUDO = Uint8Array.from({ length: 1000 }, (_, i) => (i * 7) % 251);
const ETAG = '"etag-1"';
const EXISTE = (k: string) => k === CHAVE || k === 'gold/manifesto.json';

/** Imita o contrato do R2 usado pelo Worker: head, e get com range e onlyIf (sem corpo quando a condição de If-None-Match bate). */
const env = {
  DADOS: {
    head: async (k: string) => (EXISTE(k) ? { size: CONTEUDO.length, httpEtag: ETAG } : null),
    get: async (k: string, op: { range?: Headers; onlyIf?: Headers }) => {
      if (!EXISTE(k)) return null;
      if (op.onlyIf?.get('If-None-Match') === ETAG) return { size: CONTEUDO.length, httpEtag: ETAG };
      const m = /^bytes=(\d+)-(\d+)$/.exec(op.range?.get('Range') ?? '');
      if (!m) return { size: CONTEUDO.length, httpEtag: ETAG, body: CONTEUDO };
      const [a, b] = [Number(m[1]), Number(m[2])];
      return { size: CONTEUDO.length, httpEtag: ETAG, body: CONTEUDO.slice(a, b + 1), range: { offset: a, length: b - a + 1 } };
    },
  },
  ASSETS: { fetch: async () => new Response('estático') },
};
const pedir = (caminho: string, init: RequestInit = {}) => worker.fetch(new Request(`https://site.test${caminho}`, init), env) as Promise<Response>;
const bytes = async (r: Response) => new Uint8Array(await r.arrayBuffer());

test('HEAD: 206 só de metadados com o tamanho, o Content-Range do arquivo inteiro e o ETag, sem corpo e sem cache', async () => {
  const r = await pedir(`/dados/${CHAVE}`, { method: 'HEAD' });
  assert.equal(r.status, 206); // o DuckDB-WASM só usa leitura parcial se o HEAD responder 206
  assert.equal(r.headers.get('Cache-Control'), 'no-store'); // nunca substitui no cache o GET parcial
  assert.equal(r.headers.get('Content-Length'), '1000');
  assert.equal(r.headers.get('Content-Range'), 'bytes 0-999/1000');
  assert.equal(r.headers.get('ETag'), ETAG);
  assert.equal(r.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(r.headers.get('Vary'), 'Range');
  assert.equal((await bytes(r)).length, 0);
  assert.equal((await pedir('/dados/gold/munic/inexistente.parquet', { method: 'HEAD' })).status, 404);
  // o prefixo de versão no caminho (renovação do cache do navegador) acha o mesmo arquivo
  assert.equal((await pedir(`/dados/v/20261112123456/${CHAVE}`, { method: 'HEAD' })).headers.get('Content-Range'), 'bytes 0-999/1000');
});

test('GET com Range: 206 com os bytes pedidos, Content-Range e Content-Length do trecho, ETag e cache público', async () => {
  const r = await pedir(`/dados/${CHAVE}`, { headers: { Range: 'bytes=10-19' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('Content-Range'), 'bytes 10-19/1000'); // o do trecho, nunca o do arquivo inteiro
  assert.equal(r.headers.get('Content-Length'), '10');
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(r.headers.get('ETag'), ETAG);
  assert.equal(r.headers.get('Vary'), 'Range'); // o trecho guardado depende do intervalo pedido
  assert.deepEqual([...(await bytes(r))], [...CONTEUDO.slice(10, 20)]);
  // o trecho do fim (rodapé do Parquet) também sai exato
  const fim = await pedir(`/dados/${CHAVE}`, { headers: { Range: 'bytes=900-999' } });
  assert.equal(fim.headers.get('Content-Range'), 'bytes 900-999/1000');
  assert.deepEqual([...(await bytes(fim))], [...CONTEUDO.slice(900)]);
});

test('GET inteiro: 200 com o corpo, tamanho e cache público; o manifesto é sempre revalidado', async () => {
  const r = await pedir(`/dados/${CHAVE}`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('Content-Length'), '1000');
  assert.equal(r.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(r.headers.get('Vary'), 'Range');
  assert.deepEqual([...(await bytes(r))], [...CONTEUDO]);
  assert.equal((await pedir('/dados/gold/manifesto.json')).headers.get('Cache-Control'), 'no-cache');
});

test('GET condicional: ETag igual dá 304 sem corpo (com ou sem Range) e mantém ETag e cache; ETag diferente entrega os bytes', async () => {
  const sem = await pedir(`/dados/${CHAVE}`, { headers: { 'If-None-Match': ETAG } });
  assert.equal(sem.status, 304);
  assert.equal(sem.headers.get('ETag'), ETAG);
  assert.equal(sem.headers.get('Cache-Control'), 'public, max-age=86400');
  assert.equal(sem.headers.get('Vary'), 'Range');
  assert.equal((await bytes(sem)).length, 0);
  // as condicionais valem antes do Range (RFC 9110): o 304 continua sendo a resposta
  const sem304Range = await pedir(`/dados/${CHAVE}`, { headers: { Range: 'bytes=0-9', 'If-None-Match': ETAG } });
  assert.equal(sem304Range.status, 304);
  assert.equal(sem304Range.headers.get('Vary'), 'Range');
  const outro = await pedir(`/dados/${CHAVE}`, { headers: { Range: 'bytes=0-9', 'If-None-Match': '"outro"' } });
  assert.equal(outro.status, 206);
  assert.deepEqual([...(await bytes(outro))], [...CONTEUDO.slice(0, 10)]);
});

test('métodos e caminhos inválidos: só GET e HEAD; fora de silver e gold, com ".." ou inexistente não há arquivo; outras rotas seguem', async () => {
  const post = await pedir(`/dados/${CHAVE}`, { method: 'POST', body: 'x' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  assert.equal((await pedir(`/dados/${CHAVE}`, { method: 'DELETE' })).status, 405);
  assert.equal((await pedir('/dados/privado/segredo.parquet')).status, 404);
  assert.equal((await pedir('/dados/gold%2F..%2Fsegredo')).status, 404);
  assert.equal((await pedir('/dados/silver/..%2Fgold%2Fmanifesto.json')).status, 404);
  assert.equal((await pedir('/dados/gold/munic/inexistente.parquet')).status, 404);
  assert.equal(await (await pedir('/index.html')).text(), 'estático'); // fora de /dados/ continua nos arquivos do site
});
