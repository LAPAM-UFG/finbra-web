/**
 * Worker do site: entrega os arquivos do React (web/dist) e serve /dados/* a partir do
 * bucket R2 privado, com suporte a Range, para o DuckDB do navegador ler só o necessário.
 */
const PREFIXOS_PUBLICOS = /^(silver|gold)\//;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/dados/')) return servirDados(request, env, url);
    return env.ASSETS.fetch(request);
  },
};

function tipo(chave) {
  if (chave.endsWith('.json')) return 'application/json; charset=utf-8';
  if (chave.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}

async function servirDados(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Método não permitido', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  // /dados/v/<versão>/... só renova o cache do navegador; a chave no R2 é a mesma
  const chave = decodeURIComponent(url.pathname.slice('/dados/'.length)).replace(/^v\/[0-9]+\//, '');
  if (!PREFIXOS_PUBLICOS.test(chave) || chave.includes('..')) {
    return new Response('Não encontrado', { status: 404 });
  }
  const cabecalhos = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': tipo(chave),
    // o site pede cada arquivo com /v/<data da atualização>/ no caminho, então pode ficar em cache por bastante tempo;
    // o manifesto é sempre revalidado
    'Cache-Control': chave.endsWith('manifesto.json') ? 'no-cache' : 'public, max-age=86400',
  });

  if (request.method === 'HEAD') {
    const objeto = await env.DADOS.head(chave);
    if (!objeto) return new Response(null, { status: 404 });
    // o navegador descarta o Range no HEAD, mas o DuckDB-WASM só usa leitura parcial se o HEAD
    // responder 206; HEAD não tem corpo, então anunciar o arquivo inteiro como 206 é inofensivo
    cabecalhos.set('Content-Length', String(objeto.size));
    cabecalhos.set('Content-Range', `bytes 0-${objeto.size - 1}/${objeto.size}`);
    cabecalhos.set('ETag', objeto.httpEtag);
    return new Response(null, { status: 206, headers: cabecalhos });
  }

  const objeto = await env.DADOS.get(chave, { range: request.headers, onlyIf: request.headers });
  if (!objeto) return new Response('Não encontrado', { status: 404 });
  cabecalhos.set('ETag', objeto.httpEtag);
  if (!('body' in objeto)) return new Response(null, { status: 304, headers: cabecalhos });

  if (request.headers.has('Range') && objeto.range) {
    // R2Range: { offset, length } ou { suffix }; a chave pode existir com valor undefined
    const r = objeto.range;
    const inicio = typeof r.suffix === 'number' ? objeto.size - r.suffix : (r.offset ?? 0);
    const fim = typeof r.suffix === 'number' || typeof r.length !== 'number' ? objeto.size - 1 : inicio + r.length - 1;
    cabecalhos.set('Content-Range', `bytes ${inicio}-${fim}/${objeto.size}`);
    cabecalhos.set('Content-Length', String(fim - inicio + 1));
    return new Response(objeto.body, { status: 206, headers: cabecalhos });
  }
  cabecalhos.set('Content-Length', String(objeto.size));
  return new Response(objeto.body, { headers: cabecalhos });
}
