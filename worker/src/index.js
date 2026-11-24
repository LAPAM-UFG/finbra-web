/**
 * Worker do site: entrega os arquivos do React (web/dist) e serve /dados/* a partir do
 * bucket R2 privado, com suporte a Range, para o DuckDB do navegador ler só o necessário.
 * /api/ia* são as perguntas à base com o Claude (ia.js), só com login.
 */
import { rotaIa } from './ia.js';
import { rotaDados } from './dados.js';
import { cabecalhosSeguros, paginaSite } from './site.js';
import { porConteudo, referenciaVersao, objetoVersao } from './versoes_dados.js';

const PREFIXOS_PUBLICOS = /^(silver|gold)\//;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    let response;
    if (url.pathname === '/api/dados' || url.pathname.startsWith('/api/dados/')) response = await rotaDados(request, env, url, servirDados);
    else if (url.pathname.startsWith('/dados/')) response = await servirDados(request, env, url);
    else if (url.pathname === '/api/ia' || url.pathname.startsWith('/api/ia/')) response = await rotaIa(request, env, url);
    else response = await paginaSite(request, env, url);
    return cabecalhosSeguros(response);
  },
};

function tipo(chave) {
  if (chave.endsWith('.json')) return 'application/json; charset=utf-8';
  if (chave.endsWith('.ndjson')) return 'application/x-ndjson; charset=utf-8';
  if (chave.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'application/octet-stream';
}

async function servirDados(request, env, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Método não permitido', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const caminho = decodeURIComponent(url.pathname.slice('/dados/'.length));
  const versao = caminho.match(/^v\/([0-9]{8,40})\//)?.[1];
  if (caminho.startsWith('v/') && !versao) return new Response('Edição inválida', {status:404,headers:{'Cache-Control':'no-store'}});
  const chave = caminho.replace(/^v\/[0-9]+\//, '');
  if (!PREFIXOS_PUBLICOS.test(chave) || chave.includes('..')) {
    return new Response('Não encontrado', { status: 404 });
  }
  const congelada = versao && !porConteudo(chave) ? await referenciaVersao(env.DADOS,versao,chave) : null;
  if (versao && !porConteudo(chave) && !congelada) return new Response('Edição não disponível', {status:404,headers:{'Cache-Control':'no-store'}});
  const cabecalhos = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type': tipo(chave),
    // Cache longo apenas para nomes por conteúdo ou edições com ETags congeladas.
    'Cache-Control': congelada || porConteudo(chave) ? 'public, max-age=31536000, immutable' : chave.endsWith('manifesto.json') ? 'no-cache' : 'public, max-age=86400',
    // a resposta depende do Range pedido: sem isto o navegador reaproveita do disco um trecho (ex.: bytes 0-16383) guardado
    // para outro intervalo sobreposto e entrega bytes que não são os pedidos (rodapé do Parquet ilegível)
    Vary: 'Range',
  });

  if (request.method === 'HEAD') {
    const objeto = congelada ? await objetoVersao(env.DADOS,chave,congelada,request) : await env.DADOS.head(chave);
    if (!objeto) return new Response(null, { status: 404 });
    // o navegador descarta o Range no HEAD, mas o DuckDB-WASM só usa leitura parcial se o HEAD
    // responder 206 com o tamanho do arquivo; por isso o 206 fica, sem corpo e sem cache (no-store, abaixo)
    // resposta só de metadados (sem corpo): nunca vai para o cache, para o Content-Range do arquivo inteiro não se misturar
    // com as respostas parciais (GET com Range) que o navegador guarda do mesmo endereço
    cabecalhos.set('Cache-Control', 'no-store');
    cabecalhos.set('Content-Length', String(objeto.size));
    cabecalhos.set('Content-Range', `bytes 0-${objeto.size - 1}/${objeto.size}`);
    cabecalhos.set('ETag', congelada?.etag ?? objeto.httpEtag);
    return new Response(null, { status: 206, headers: cabecalhos });
  }

  if (congelada && request.headers.get('If-None-Match') === congelada.etag) return new Response(null,{status:304,headers:{...Object.fromEntries(cabecalhos),ETag:congelada.etag}});
  if (congelada && request.headers.has('If-Match') && request.headers.get('If-Match') !== congelada.etag) return new Response(null,{status:412});
  const objeto = congelada ? await objetoVersao(env.DADOS,chave,congelada,request) : await env.DADOS.get(chave, { range: request.headers, onlyIf: request.headers });
  if (!objeto) return new Response('Não encontrado', { status: 404 });
  cabecalhos.set('ETag', congelada?.etag ?? objeto.httpEtag);
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
