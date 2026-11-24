import { ALIASES, ROTAS, TITULOS, rotaConhecida } from '../../shared/rotas_site.mjs';

const escapar = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function cabecalhosSeguros(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), browsing-topics=()');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' blob: 'wasm-unsafe-eval' https://cdn.jsdelivr.net; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cdn.jsdelivr.net https://*.duckdb.org https://*.ibge.gov.br https://icy-breeze-2aa0.cloudflareaccess.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function redirecionamentoSite(url, env) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const pausa = env.IA_HABILITADA !== 'true';
  const destino = path === '/' ? '/raio-x' : pausa && path === '/ia' ? '/raio-x' : pausa && path === '/trabalho/ia' ? '/trabalho' : ALIASES[path];
  if (!destino && path === url.pathname) return null;
  const next = new URL(destino || path, url);
  next.search = url.search;
  if (path === '/' || path === '/ia' || path === '/trabalho/ia') {
    for (const k of [...next.searchParams.keys()]) if (!['uf','cod','ente','ano','lang','tema','rede','ind','busca','zeros'].includes(k)) next.searchParams.delete(k);
  }
  if (next.pathname.endsWith('/comparar') && next.searchParams.has('ind') && !next.searchParams.has('indicador')) {
    next.searchParams.set('indicador', next.searchParams.get('ind'));
    next.searchParams.delete('ind');
  }
  return Response.redirect(next.href, path === '/' || path === '/ia' || path === '/trabalho/ia' ? 302 : 308);
}

export async function paginaSite(request, env, url) {
  const path = url.pathname;
  if (path === '/api' || path === '/api/') return Response.json({ dados: '/api/dados/v1/', catalogo: '/api/dados/v1/catalogo.json', documentacao: '/downloads#dl-api' });
  if (path.startsWith('/api/')) return Response.json({ erro: { codigo: 'rota_inexistente', mensagem: 'Consulte /api/dados/v1/.' } }, { status: 404 });
  if (path === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /dados/\nDisallow: /api/\nSitemap: ${url.origin}/sitemap.xml\n`, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  if (path === '/sitemap.xml') {
    const caminhos = ROTAS.filter(p => p !== '/' && !ALIASES[p] && !p.includes('/ia'));
    return new Response('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + caminhos.map(p => `<url><loc>${escapar(url.origin + p)}</loc></url>`).join('') + '</urlset>', { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  }
  if (path === '/favicon.ico') return env.ASSETS.fetch(new Request(new URL('/logo_lapam.png', url), request));
  if (path.startsWith('/assets/') || ['/logo_lapam.png', '/finbra.R'].includes(path)) {
    const asset = await env.ASSETS.fetch(request);
    if(asset.headers.get('Content-Type')?.includes('text/html'))return new Response('Arquivo não encontrado', { status: 404 });
    if(asset.ok && /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:js|css|wasm|woff2?)$/.test(path)) {
      const headers=new Headers(asset.headers);headers.set('Cache-Control','public, max-age=31536000, immutable');
      return new Response(asset.body,{status:asset.status,headers});
    }
    return asset;
  }
  const redirect = redirecionamentoSite(url, env);
  if (redirect) return redirect;
  const encontrada = rotaConhecida(path), en = url.searchParams.get('lang') === 'en';
  const titulo = encontrada ? `LAPAM · ${(TITULOS[path] || ['Dados públicos municipais','Municipal public data'])[en ? 1 : 0]}` : en ? 'Page not found · LAPAM' : 'Página não encontrada · LAPAM';
  const descricao = titulo + (en ? '. Official municipal data, indicators, maps, comparisons and downloads.' : '. Dados municipais oficiais, indicadores, mapas, comparações e downloads.');
  const meta = `<meta property="og:type" content="website"><meta property="og:title" content="${escapar(titulo)}"><meta property="og:description" content="${escapar(descricao)}"><meta property="og:url" content="${escapar(url.origin + path)}"><meta property="og:image" content="${escapar(url.origin)}/logo_lapam.png"><link rel="canonical" href="${escapar(url.origin + path)}">`;
  // O binding de Assets canonicaliza /index.html para /. Pedir o documento
  // pela raiz evita devolver esse redirect no lugar de uma rota da SPA.
  const asset = await env.ASSETS.fetch(new Request(new URL('/', url), request));
  const headers = new Headers(asset.headers);
  headers.delete('Content-Length'); headers.delete('ETag');
  headers.set('Content-Type', 'text/html; charset=utf-8'); headers.set('Cache-Control', 'no-cache');
  if (!encontrada) headers.set('X-Robots-Tag', 'noindex');
  const response = new Response(asset.body, { status: encontrada ? asset.status : 404, headers });
  if (typeof HTMLRewriter !== 'undefined') return new HTMLRewriter().on('title', { element(e) { e.setInnerContent(titulo); } }).on('meta[name="description"]', { element(e) { e.setAttribute('content', descricao); } }).on('head', { element(e) { e.append(meta, { html: true }); } }).transform(response);
  // Mesmo comportamento no servidor local de validação e nos testes Node.
  return new Response((await response.text()).replace(/<title>[^<]*<\/title>/i, `<title>${escapar(titulo)}</title>`).replace(/<meta name="description"[^>]*>/i, `<meta name="description" content="${escapar(descricao)}">`).replace('</head>', meta + '</head>'), { status: response.status, headers });
}
