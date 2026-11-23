const HOST = 'dadosabertos.aneel.gov.br';
const CATALOGOS = new Set(['relacao-de-empreendimentos-de-geracao-distribuida', 'siga-sistema-de-informacoes-de-geracao-da-aneel']);
const DATASETS = new Set([...CATALOGOS, '5e0fafd2-21b9-4d5b-b622-40438d40aba2', '6d90b77c-c5f5-4d81-bdec-7bc619494bb9']);
const ARQUIVOS = new Set(['empreendimento-geracao-distribuida.parquet', 'empreendimento-gd-informacoes-tecnicas-fotovoltaica.parquet', 'empreendimento-gd-informacoes-tecnicas-eolica.csv', 'empreendimento-gd-informacoes-tecnicas-hidreletrica.csv', 'empreendimento-gd-informacoes-tecnicas-termeletrica.csv', 'siga-empreendimentos-geracao-diario.csv']);
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const COPIAR = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified', 'content-encoding'];

export function permitido(value) {
  let u; try { u = new URL(value); } catch { return false; }
  if (u.origin !== 'https://' + HOST || u.username || u.password || u.hash) return false;
  if (u.pathname === '/api/3/action/package_show') return [...u.searchParams.keys()].every(k => k === 'id') && u.searchParams.getAll('id').length === 1 && CATALOGOS.has(u.searchParams.get('id'));
  const p = u.pathname.split('/');
  return !u.search && p.length === 7 && p[1] === 'dataset' && DATASETS.has(p[2]) && p[3] === 'resource' && UUID.test(p[4]) && p[5] === 'download' && ARQUIVOS.has(p[6]);
}

export async function sha(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
}

function igual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const erro = (status, texto) => new Response(texto, { status, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });

export async function atender(request, env, buscar = fetch) {
  const url = new URL(request.url);
  if (url.pathname === '/health' && request.method === 'GET') return Response.json({ ok: true, servico: 'fontes-oficiais' }, { headers: { 'cache-control': 'no-store' } });
  const expected = env.FONTE_TOKEN_SHA256?.trim();
  if (!expected) return erro(503, 'Coleta ainda não configurada');
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token || !igual(await sha(token), expected)) return erro(401, 'Não autorizado');
  if (!['GET', 'HEAD'].includes(request.method)) return erro(405, 'Método não permitido');
  let target = url.searchParams.get('url');
  if (!permitido(target)) return erro(403, 'Fonte não permitida');
  const headers = new Headers({ 'accept-encoding': 'identity', 'user-agent': 'lapam-finbra-coleta' });
  for (const k of ['range', 'if-range', 'if-none-match', 'if-modified-since', 'accept']) if (request.headers.has(k)) headers.set(k, request.headers.get(k));
  for (let n = 0; n < 4; n++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    let r;
    try { r = await buscar(target, { method: request.method, headers, redirect: 'manual', signal: controller.signal }); }
    catch { return erro(504, 'Fonte oficial indisponível'); }
    finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const location = r.headers.get('location'); await r.body?.cancel();
      if (!location) return erro(502, 'Redirecionamento inválido');
      target = new URL(location, target).href;
      if (!permitido(target)) return erro(502, 'Redirecionamento fora da fonte permitida');
      continue;
    }
    const out = new Headers({ 'cache-control': 'no-store', 'x-finbra-fonte': HOST });
    for (const k of COPIAR) if (r.headers.has(k)) out.set(k, r.headers.get(k));
    return new Response(request.method === 'HEAD' || [204, 304].includes(r.status) ? null : r.body, { status: r.status, headers: out });
  }
  return erro(502, 'Excesso de redirecionamentos');
}

export default { fetch: (request, env) => atender(request, env) };
