import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
const token = createHmac('sha256', process.env.R2_SECRET_ACCESS_KEY).update('finbra-fontes-v1').digest('hex');
const url = 'https://finbra-fontes.luanviniciusbernardelli.workers.dev/';
const nomes = new Set(['empreendimento-geracao-distribuida.parquet', 'empreendimento-gd-informacoes-tecnicas-fotovoltaica.parquet', 'empreendimento-gd-informacoes-tecnicas-eolica.csv', 'empreendimento-gd-informacoes-tecnicas-hidreletrica.csv', 'empreendimento-gd-informacoes-tecnicas-termeletrica.csv', 'siga-empreendimentos-geracao-diario.csv']);
let arquivos = 0;
for (const slug of ['relacao-de-empreendimentos-de-geracao-distribuida', 'siga-sistema-de-informacoes-de-geracao-da-aneel']) {
  const r = await fetch(url + '?url=' + encodeURIComponent('https://dadosabertos.aneel.gov.br/api/3/action/package_show?id=' + slug), { headers: { authorization: 'Bearer ' + token, 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(60000) });
  assert.equal(r.status, 200, 'Catálogo oficial não respondeu pela ponte'); const p = await r.json(); assert.equal(p.success, true);
  console.log(JSON.stringify({ catalogo: slug, ok: true, placement: r.headers.get('cf-placement') }));
  for (const a of p.result.resources.filter(a => nomes.has(a.name))) {
    const h = await fetch(url + '?url=' + encodeURIComponent(a.url), { method: 'HEAD', headers: { authorization: 'Bearer ' + token, 'accept-encoding': 'identity' }, signal: AbortSignal.timeout(60000) });
    assert.equal(h.status, 200, 'Arquivo oficial não respondeu pela ponte'); arquivos++;
    console.log(JSON.stringify({ arquivo: a.name, status: h.status, bytes: h.headers.get('content-length'), etag: h.headers.get('etag') }));
  }
}
assert.equal(arquivos, 6);
console.log(JSON.stringify({ ok: true, catalogos: 2, arquivos }));
