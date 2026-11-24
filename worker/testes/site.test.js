import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';

const html='<!doctype html><html><head><title>Inicial</title><meta name="description" content="Inicial"></head><body><div id="root"></div></body></html>';
const env={IA_HABILITADA:'false',ASSETS:{fetch:async request=>new URL(request.url).pathname==='/logo_lapam.png'?new Response('PNG',{headers:{'Content-Type':'image/png'}}):new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}})}};
const pedir=(path,extra={})=>worker.fetch(new Request('https://site.exemplo'+path),{...env,...extra});

test('404 real com metadados próprios, sem classificar o endereço como Finanças',async()=>{
  const r=await pedir('/nao-existe');assert.equal(r.status,404);assert.equal(r.headers.get('X-Robots-Tag'),'noindex');assert.match(await r.text(),/<title>Página não encontrada/);
});
test('documento usa a raiz de Assets: index.html redireciona na Cloudflare',async()=>{
  const caminhos=[];
  const ASSETS={fetch:async request=>{const path=new URL(request.url).pathname;caminhos.push(path);return path==='/index.html'?Response.redirect('https://site.exemplo/',308):new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});}};
  const r=await pedir('/raio-x?cod=3509502',{ASSETS});
  assert.equal(r.status,200);assert.equal(r.headers.get('Location'),null);assert.deepEqual(caminhos,['/']);assert.match(await r.text(),/Raio X/);
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
test('immutable só em nome por conteúdo ou índice congelado; versão desconhecida não vira alias mutável',async()=>{
  const DADOS={get:async key=>key.startsWith('gold/versoes/')?null:({body:'ok',size:2,httpEtag:'"a"'})};
  const novo=await pedir('/dados/gold/raiox/catalogo_0123456789abcdef.json',{DADOS});assert.match(novo.headers.get('Cache-Control'),/31536000, immutable/);
  const binario=await pedir('/dados/gold/abertura/fiscal_resumo_sp_0123456789abcdef.bin',{DADOS});assert.match(binario.headers.get('Cache-Control'),/31536000, immutable/);
  const canonico=await pedir('/dados/v/1700000000/gold/indicadores.parquet',{DADOS});assert.equal(canonico.status,404);assert.doesNotMatch(canonico.headers.get('Cache-Control'),/immutable/);
});

test('assets com hash recebem cache imutável; documento HTML continua revalidável',async()=>{
 const ASSETS={fetch:async()=>new Response('export {};',{headers:{'Content-Type':'text/javascript','Cache-Control':'public, max-age=0, must-revalidate'}})};
 const r=await pedir('/assets/index-Bo5ICAV6.js',{ASSETS});assert.equal(r.headers.get('Cache-Control'),'public, max-age=31536000, immutable');
 assert.equal((await pedir('/raio-x')).headers.get('Cache-Control'),'no-cache');
});

test('versão congelada conserva bytes e Range mesmo depois da substituição do objeto atual',async()=>{
 const {createHash}=await import('node:crypto'),versao='20261124123456',key='gold/ipca.parquet',antigo='0123456789';
 const etag='"'+createHash('md5').update(antigo).digest('hex')+'"';
 const objetos=new Map([[key,{texto:'nova edição'}],['gold/versoes/objetos/'+etag.slice(1,-1),{texto:antigo,meta:{origem_etag:etag.slice(1,-1)}}],[`gold/versoes/${versao}.json`,{texto:JSON.stringify({versao:1,edicao:versao,arquivos:{[key]:{etag,bytes:antigo.length}}})}]]);
 const DADOS={async get(k,op={}){
  const v=objetos.get(k);if(!v)return null;const tag='"'+createHash('md5').update(v.texto).digest('hex')+'"',base={size:Buffer.byteLength(v.texto),httpEtag:tag,customMetadata:v.meta};
  if(op.onlyIf?.etagMatches&&op.onlyIf.etagMatches!==tag.slice(1,-1))return base;
  const range=op.range?.get('Range')?.match(/^bytes=(\d+)-(\d+)$/);let body=Buffer.from(v.texto);
  if(range){const offset=Number(range[1]),length=Number(range[2])-offset+1;body=body.subarray(offset,offset+length);base.range={offset,length};}
  return {...base,body:new Response(body).body,json:async()=>JSON.parse(v.texto)};
 },async head(k){const v=objetos.get(k);return v?{size:Buffer.byteLength(v.texto),httpEtag:'"'+createHash('md5').update(v.texto).digest('hex')+'"',customMetadata:v.meta}:null;}};
 const url='https://site.exemplo/dados/v/'+versao+'/'+key;
 const r=await worker.fetch(new Request(url,{headers:{Range:'bytes=2-5'}}),{...env,DADOS});assert.equal(r.status,206);assert.equal(await r.text(),'2345');assert.equal(r.headers.get('Content-Range'),'bytes 2-5/10');assert.equal(r.headers.get('ETag'),etag);assert.match(r.headers.get('Cache-Control'),/31536000, immutable/);
 const notModified=await worker.fetch(new Request(url,{headers:{'If-None-Match':etag}}),{...env,DADOS});assert.equal(notModified.status,304);
 const head=await worker.fetch(new Request(url,{method:'HEAD'}),{...env,DADOS});assert.equal(head.status,206);assert.equal(head.headers.get('Content-Length'),'10');assert.equal(head.headers.get('Cache-Control'),'no-store');
});
