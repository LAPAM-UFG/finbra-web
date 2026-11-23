import test from 'node:test';
import assert from 'node:assert/strict';
import { atender, permitido, sha } from '../src/index.mjs';
const api = 'https://dadosabertos.aneel.gov.br/api/3/action/package_show?id=relacao-de-empreendimentos-de-geracao-distribuida';
const arquivo = 'https://dadosabertos.aneel.gov.br/dataset/5e0fafd2-21b9-4d5b-b622-40438d40aba2/resource/cd29f6eb-e08d-4db7-b6fb-ed6e3b682d27/download/empreendimento-geracao-distribuida.parquet';
const token = 'a'.repeat(64), env = { FONTE_TOKEN_SHA256: await sha(token) };
const req = (url = api, options = {}) => new Request('https://ponte.test/?url=' + encodeURIComponent(url), { ...options, headers: { authorization: 'Bearer ' + token, ...options.headers } });

test('somente catálogos e arquivos públicos aprovados, com TLS', () => {
  assert.ok(permitido(api)); assert.ok(permitido(arquivo));
  for (const u of [api.replace('https:', 'http:'), api.replace('aneel.gov.br', 'aneel.gov.br.evil.test'), api.replace('https://', 'https://user:senha@'), api + '&id=x', api.replace('relacao-de-empreendimentos-de-geracao-distribuida', 'x'), 'https://127.0.0.1/admin', arquivo.replace('empreendimento-geracao-distribuida.parquet', 'arquivo.csv'), arquivo.replace('/download/', '/admin/')]) assert.equal(permitido(u), false, u);
});
test('sem autenticação não consulta a fonte', async () => {
  let calls = 0; const f = async () => { calls++; throw Error('não deveria acessar'); };
  assert.equal((await atender(new Request('https://ponte.test/?url=' + encodeURIComponent(api)), env, f)).status, 401);
  assert.equal((await atender(req(api, { headers: { authorization: 'Bearer ' + 'b'.repeat(64) } }), env, f)).status, 401);
  assert.equal(calls, 0);
});
test('a quebra de linha do cadastro do segredo não muda seu hash', async () => {
  const r = await atender(req(), { FONTE_TOKEN_SHA256: env.FONTE_TOKEN_SHA256 + '\n' }, async () => new Response('{}'));
  assert.equal(r.status, 200);
});
test('não encaminha credenciais e preserva bytes, range e validadores', async () => {
  const response = await atender(req(arquivo, { headers: { range: 'bytes=1-3', cookie: 'privado=1' } }), env, async (url, options) => {
    assert.equal(url, arquivo); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.get('authorization'), null); assert.equal(options.headers.get('cookie'), null);
    assert.equal(options.headers.get('range'), 'bytes=1-3');
    return new Response('abc', { status: 206, headers: { 'content-length': '3', 'content-range': 'bytes 1-3/10', etag: 'v1', 'set-cookie': 'sessao=nao-encaminhar' } });
  });
  assert.equal(await response.text(), 'abc'); assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 1-3/10'); assert.equal(response.headers.get('etag'), 'v1');
  assert.equal(response.headers.get('set-cookie'), null); assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('redirecionamentos externos são recusados', async () => {
  let calls = 0;
  const r = await atender(req(), env, async () => { calls++; return new Response(null, { status: 302, headers: { location: 'https://outro.test/' } }); });
  assert.equal(r.status, 502); assert.equal(calls, 1);
});
test('falha da fonte não é trocada por dados em cache', async () => {
  const r = await atender(req(), env, async () => { throw Error('rede indisponível'); });
  assert.equal(r.status, 504);
});
test('HEAD preserva metadados sem corpo', async () => {
  const r = await atender(req(arquivo, { method: 'HEAD' }), env, async (url, options) => {
    assert.equal(options.method, 'HEAD'); return new Response(null, { headers: { 'content-length': '100', etag: 'v2' } });
  });
  assert.equal(r.headers.get('content-length'), '100'); assert.equal(await r.text(), '');
});
