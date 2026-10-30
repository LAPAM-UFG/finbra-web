/**
 * Conversas da IA guardadas na conta de quem fez o login (Cloudflare Access). Cada pessoa só lê e grava as
 * próprias: a pasta no R2 vem do e-mail conferido no token, nunca do pedido.
 *
 *   ia/conversas/<pessoa>/<id>.json    a conversa inteira (o mesmo formato do JSON exportado pela página)
 *   ia/conversas/<pessoa>/indice.json  resumos para a lista e a busca (título, datas, perguntas, conclusões)
 *
 * <pessoa> é o SHA-256 do e-mail: o e-mail não aparece nas chaves. A última gravação vale (a mesma conversa
 * continuada em dois computadores fica com a versão gravada por último) e excluir apaga de vez.
 *
 *   GET    /api/ia/conversas        { resumos }
 *   GET    /api/ia/conversas/<id>   a conversa (404 se não existir)
 *   PUT    /api/ia/conversas/<id>   { conversa, resumo } -> { atualizadaEm }
 *   DELETE /api/ia/conversas/<id>
 */
const FORMATO = 'lapam-ia-conversa';
const ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_CONVERSA = 25_000_000; // caracteres do pedido (tabelas de até 2.000 linhas por consulta)
const MAX_CONVERSAS = 2000;
const MAX_BUSCA = 20_000;
const MAX_TEXTO = 300;

const json = (corpo, status = 200) => new Response(JSON.stringify(corpo), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const erro = (mensagem, status) => json({ erro: mensagem }, status);

export async function pastaDe(email) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email.toLowerCase())));
  return `ia/conversas/${[...h].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const texto = (v, max = MAX_TEXTO) => (typeof v === 'string' ? v.slice(0, max) : '');
const numero = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const textos = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 50).map((x) => x.slice(0, MAX_TEXTO)) : []);

/** Só os campos que a lista usa, com tamanho limitado; null se o resumo não for desta conversa. */
export function limparResumo(r, id) {
  if (!r || typeof r !== 'object' || r.id !== id) return null;
  const origem = r.origem && typeof r.origem === 'object' && typeof r.origem.tipo === 'string' && JSON.stringify(r.origem).length <= 2000
    ? r.origem : { tipo: 'nova' };
  return {
    id, titulo: texto(r.titulo) || 'Conversa', criadaEm: numero(r.criadaEm), atualizadaEm: numero(r.atualizadaEm),
    perguntas: numero(r.perguntas), paineis: textos(r.paineis), territorio: texto(r.territorio), modo: texto(r.modo),
    dados: textos(r.dados), origem, busca: texto(r.busca, MAX_BUSCA),
  };
}

/** Título e datas também nos metadados da conversa: a lista se refaz a partir deles se o índice perder alguma. */
const metadados = (r) => ({
  titulo: encodeURIComponent(r.titulo.slice(0, 120)), criadaEm: String(r.criadaEm), atualizadaEm: String(r.atualizadaEm), perguntas: String(r.perguntas),
});
function resumoDosMetadados(id, m = {}) {
  let titulo = 'Conversa';
  try {
    titulo = decodeURIComponent(m.titulo ?? '') || titulo;
  } catch { /* fica o padrão */ }
  return limparResumo({ id, titulo, criadaEm: Number(m.criadaEm), atualizadaEm: Number(m.atualizadaEm), perguntas: Number(m.perguntas), origem: { tipo: 'nova' } }, id);
}

/** {id: metadados} das conversas gravadas na pasta. */
async function conversasGravadas(env, pasta) {
  const achadas = new Map();
  let cursor;
  do {
    const r = await env.DADOS.list({ prefix: `${pasta}/`, include: ['customMetadata'], cursor });
    for (const o of r.objects) {
      const id = o.key.slice(pasta.length + 1).replace(/\.json$/, '');
      if (ID.test(id) && o.key.endsWith('.json')) achadas.set(id, o.customMetadata ?? {});
    }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return achadas;
}

async function lerIndice(env, pasta) {
  const o = await env.DADOS.get(`${pasta}/indice.json`);
  if (!o) return { resumos: [], etag: null };
  const v = await o.json().catch(() => []);
  return { resumos: Array.isArray(v) ? v : [], etag: o.etag };
}

/**
 * Muda o índice só se ninguém o gravou no meio (etag): duas abas gravando ao mesmo tempo não apagam a entrada
 * uma da outra. mudar devolve a lista nova ou uma Response (recusa).
 */
async function mudarIndice(env, pasta, mudar) {
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const { resumos, etag } = await lerIndice(env, pasta);
    const novos = mudar(resumos);
    if (novos instanceof Response) return novos;
    const gravado = await env.DADOS.put(`${pasta}/indice.json`, JSON.stringify(novos), {
      httpMetadata: { contentType: 'application/json' },
      ...(etag ? { onlyIf: { etagMatches: etag } } : {}),
    });
    if (gravado) return null;
  }
  return erro('o histórico está sendo gravado por outra aba; tente de novo', 409);
}

function mesmaOrigem(origem, url) {
  try {
    const o = new URL(origem);
    return o.origin === url.origin || (url.hostname === 'localhost' && o.hostname === 'localhost');
  } catch {
    return false;
  }
}

export async function rotaConversas(request, env, url, email) {
  // gravar e excluir só a partir do próprio site (a sessão do Access vai junto em qualquer pedido ao domínio); no
  // computador local, o Vite (porta 5180) repassa os pedidos ao Worker (porta 8787)
  const origem = request.headers.get('Origin');
  if (request.method !== 'GET' && origem && !mesmaOrigem(origem, url)) return erro('origem não permitida', 403);

  const pasta = await pastaDe(email);
  const resto = url.pathname.slice('/api/ia/conversas'.length).replace(/^\//, '');
  if (!resto) {
    if (request.method !== 'GET') return erro('método não permitido', 405);
    // o índice vale para o que existe de fato: sem as excluídas e com as que ele perdeu (gravações simultâneas)
    const [{ resumos }, gravadas] = await Promise.all([lerIndice(env, pasta), conversasGravadas(env, pasta)]);
    const lista = resumos.filter((r) => gravadas.has(r.id));
    const noIndice = new Set(lista.map((r) => r.id));
    for (const [id, m] of gravadas) if (!noIndice.has(id)) lista.push(resumoDosMetadados(id, m));
    return json({ resumos: lista });
  }
  const id = decodeURIComponent(resto);
  if (!ID.test(id)) return erro('identificador inválido', 400);
  const chave = `${pasta}/${id}.json`;

  if (request.method === 'GET') {
    const o = await env.DADOS.get(chave);
    if (!o) return erro('conversa não encontrada', 404);
    return new Response(o.body, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  if (request.method === 'PUT') {
    const bruto = await request.text();
    if (bruto.length > MAX_CONVERSA) return erro('conversa grande demais para guardar na conta: exporte-a em JSON', 413);
    let corpo;
    try {
      corpo = JSON.parse(bruto);
    } catch {
      return erro('pedido inválido', 400);
    }
    const c = corpo?.conversa;
    if (!c || typeof c !== 'object' || c.formato !== FORMATO || c.id !== id || !Array.isArray(c.mensagens) || !Array.isArray(c.metas)) {
      return erro('conversa inválida', 400);
    }
    const resumo = limparResumo(corpo.resumo, id);
    if (!resumo) return erro('resumo inválido', 400);
    const { resumos } = await lerIndice(env, pasta);
    if (resumos.length >= MAX_CONVERSAS && !resumos.some((r) => r.id === id)) {
      return erro(`limite de ${MAX_CONVERSAS} conversas na conta: exclua as que não usa mais`, 413);
    }
    await env.DADOS.put(chave, JSON.stringify(c), { httpMetadata: { contentType: 'application/json' }, customMetadata: metadados(resumo) });
    const falha = await mudarIndice(env, pasta, (lista) => [resumo, ...lista.filter((r) => r.id !== id)]);
    return falha ?? json({ atualizadaEm: resumo.atualizadaEm });
  }

  if (request.method === 'DELETE') {
    await env.DADOS.delete(chave);
    const falha = await mudarIndice(env, pasta, (lista) => lista.filter((r) => r.id !== id));
    return falha ?? json({ excluida: id });
  }

  return erro('método não permitido', 405);
}
