import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

const html='<!doctype html><html><head><title>Inicial</title><meta name="description" content="Inicial"></head><body><div id="root"></div></body></html>';
const env={IA_HABILITADA:'false',ASSETS:{fetch:async request=>new URL(request.url).pathname==='/logo_lapam.png'?new Response('PNG',{headers:{'Content-Type':'image/png'}}):new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}})}};
const pedir=(path,extra={})=>worker.fetch(new Request('https://site.exemplo'+path),{...env,...extra});

test('404 real com metadados próprios, sem classificar o endereço como Finanças',async()=>{
  const r=await pedir('/nao-existe');assert.equal(r.status,404);assert.equal(r.headers.get('X-Robots-Tag'),'noindex');assert.match(await r.text(),/<title>Página não encontrada/);
});
test('robots e sitemap reais; excluem aliases e a IA pausada',async()=>{
  const robots=await pedir('/robots.txt');assert.match(robots.headers.get('Content-Type'),/text\/plain/);assert.match(await robots.text(),/Sitemap: https:\/\/site.exemplo\/sitemap.xml/);
  const sitemap=await pedir('/sitemap.xml'),s=await sitemap.text();assert.match(s,/\/raio-x<\/loc>/);assert.doesNotMatch(s,/\/ia<\/loc>|\/assistencia\/rankings-pib<\/loc>/);
});
test('índice API e rota inexistente são JSON, nunca a SPA',async()=>{
  const index=await pedir('/api');const catalogo=await index.json();assert.equal(catalogo.dados,'/api/dados/v1/');assert.equal(catalogo.documentacao,'/downloads#dl-api');const bad=await pedir('/api/nao-existe');assert.equal(bad.status,404);assert.equal((await bad.json()).erro.codigo,'rota_inexistente');
});
test('alias conserva recorte; pausa da IA é temporária e retira conversas antigas da URL',async()=>{
  const r=await pedir('/profissionais?uf=SP&cod=3509502');assert.equal(r.status,308);assert.equal(r.headers.get('Location'),'https://site.exemplo/educacao/profissionais?uf=SP&cod=3509502');
  const ia=await pedir('/ia?cod=3509502&conversa=privada');assert.equal(ia.status,302);assert.equal(ia.headers.get('Location'),'https://site.exemplo/raio-x?cod=3509502');
});
test('metadados por rota e idioma, sem duplicar description',async()=>{
  const r=await pedir('/trabalho?lang=en'),s=await r.text();assert.match(s,/<title>LAPAM · Labour market/);assert.match(s,/property="og:title"/);assert.equal((s.match(/name="description"/g)||[]).length,1);
  for(const h of['Content-Security-Policy','X-Content-Type-Options','Referrer-Policy','Permissions-Policy'])assert.ok(r.headers.get(h),h);
});
test('assets inexistentes não devolvem HTML 200 e favicon serve imagem',async()=>{
  assert.equal((await pedir('/assets/inexistente.js')).status,404);assert.equal((await pedir('/favicon.ico')).headers.get('Content-Type'),'image/png');
});
test('immutable só em nome por conteúdo; alias de data para chave mutável mantém cache curto',async()=>{
  const DADOS={get:async()=>({body:'ok',size:2,httpEtag:'"a"'})};
  const novo=await pedir('/dados/gold/raiox/catalogo_0123456789abcdef.json',{DADOS});assert.match(novo.headers.get('Cache-Control'),/31536000, immutable/);
  const binario=await pedir('/dados/gold/abertura/fiscal_resumo_sp_0123456789abcdef.bin',{DADOS});assert.match(binario.headers.get('Cache-Control'),/31536000, immutable/);
  const canonico=await pedir('/dados/v/1700000000/gold/indicadores.parquet',{DADOS});assert.doesNotMatch(canonico.headers.get('Cache-Control'),/immutable/);assert.equal(await canonico.text(),'ok');
});
