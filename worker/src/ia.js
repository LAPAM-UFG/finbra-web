/**
 * Perguntas à base com o Claude (/api/ia). Só com login no Cloudflare Access.
 *
 * O Worker não roda SQL: o Claude propõe consultas (ferramenta "consultar"), o navegador as executa
 * no DuckDB com os mesmos Parquet do painel e devolve o resultado no próximo pedido. O histórico
 * da conversa fica no navegador e vem inteiro a cada pedido (a API não guarda estado).
 *
 *   GET  /api/ia/estado   e-mail e perguntas restantes no dia
 *   GET  /api/ia/entrar   passa pelo login do Access e volta para /ia
 *   POST /api/ia          { idioma, mensagens } -> { conteudo, parada, restantes }
 *
 * Limites por pessoa e dia (horário de Brasília): 50 perguntas e 400 chamadas ao modelo (cada pergunta
 * pode levar algumas rodadas de consulta). A contagem fica no R2, em ia/uso/, fora de /dados/.
 * Segredo: ANTHROPIC_API_KEY (wrangler secret put ANTHROPIC_API_KEY).
 */
import Anthropic from '@anthropic-ai/sdk';
import { identificar } from './acesso.js';
import { SISTEMA, contextoDosDados } from './sistema.js';

// Sonnet: bem mais barato que o Opus e suficiente para SQL sobre estas tabelas; para mais qualidade, 'claude-opus-5-5'
const MODELO = 'claude-sonnet-5-5';
const LIMITE_PERGUNTAS = 50;
const LIMITE_CHAMADAS = 400;
const MAX_RODADAS = 8; // chamadas ao modelo por pergunta
const MAX_PERGUNTAS_CONVERSA = 15;
const MAX_CORPO = 600_000; // bytes
const MAX_PERGUNTA = 2000; // caracteres

const FERRAMENTAS = [
  {
    name: 'consultar',
    description:
      'Executa uma consulta SQL somente leitura (DuckDB) nas tabelas entes, indicadores, alertas, escopos, faixas e ipca, no navegador '
      + 'de quem perguntou, e devolve as colunas e até 200 linhas em JSON (com o total de linhas). Use para obter qualquer número da resposta. '
      + 'Só SELECT ou WITH, uma instrução, sem ler arquivos ou URLs.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'Uma única consulta SELECT/WITH em SQL do DuckDB.' },
        objetivo: { type: 'string', description: 'Frase curta, no idioma da resposta, dizendo o que a consulta mede.' },
      },
      required: ['sql', 'objetivo'],
      additionalProperties: false,
    },
  },
];

const IDIOMA = {
  pt: 'Responda em português do Brasil.',
  en: 'Answer in English. Keep Brazilian program and account names in Portuguese, with a short English gloss the first time.',
};

const resposta = (corpo, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const erro = (mensagem, status) => resposta({ erro: mensagem }, status);

// ---------------- uso diário ----------------

const diaDeBrasilia = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

async function chaveDeUso(email) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email)));
  return `ia/uso/${diaDeBrasilia()}/${[...h.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}.json`;
}

async function lerUso(env, chave) {
  const o = await env.DADOS.get(chave);
  return o ? await o.json() : { perguntas: 0, chamadas: 0 };
}

// ---------------- manifesto (anos, ano-base, cobertura) ----------------

const manifesto = { valor: null, ate: 0 };
async function lerManifesto(env) {
  if (Date.now() > manifesto.ate) {
    const o = await env.DADOS.get('gold/manifesto.json');
    manifesto.valor = o ? await o.json() : null;
    manifesto.ate = Date.now() + 10 * 60_000;
  }
  return manifesto.valor;
}

// ---------------- validação do histórico ----------------

const ehPergunta = (m) => m.role === 'user' && typeof m.content === 'string';

/** Confere a forma do histórico enviado pelo navegador; devolve a mensagem de erro ou null. */
function validar(mensagens) {
  if (!Array.isArray(mensagens) || !mensagens.length) return 'histórico vazio';
  if (!mensagens.every((m) => m && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)))) {
    return 'histórico inválido';
  }
  if (!ehPergunta(mensagens[0])) return 'a conversa deve começar por uma pergunta';
  const ultima = mensagens.at(-1);
  if (ultima.role !== 'user') return 'a última mensagem deve ser do usuário';
  const perguntas = mensagens.filter(ehPergunta);
  if (perguntas.length > MAX_PERGUNTAS_CONVERSA) return 'conversa longa demais: comece uma nova';
  if (perguntas.some((m) => !m.content.trim() || m.content.length > MAX_PERGUNTA)) return `pergunta vazia ou com mais de ${MAX_PERGUNTA} caracteres`;
  const inicio = mensagens.findLastIndex(ehPergunta);
  if (mensagens.slice(inicio).filter((m) => m.role === 'assistant').length >= MAX_RODADAS) return 'consultas demais nesta pergunta';
  return null;
}

// ---------------- rotas ----------------

export async function rotaIa(request, env, url) {
  const email = await identificar(request, env);
  if (!email) return erro('login necessário', 401);

  const chave = await chaveDeUso(email);
  if (url.pathname === '/api/ia/entrar') return Response.redirect(new URL('/ia', url).href, 302);
  if (url.pathname === '/api/ia/estado' && request.method === 'GET') {
    const uso = await lerUso(env, chave);
    return resposta({ email, restantes: Math.max(0, LIMITE_PERGUNTAS - uso.perguntas), limite: LIMITE_PERGUNTAS, configurada: !!env.ANTHROPIC_API_KEY });
  }
  if (url.pathname !== '/api/ia') return erro('não encontrado', 404);
  if (request.method !== 'POST') return erro('método não permitido', 405);
  if (!env.ANTHROPIC_API_KEY) return erro('a IA ainda não foi configurada (falta a chave da Anthropic)', 503);

  const bruto = await request.text();
  if (bruto.length > MAX_CORPO) return erro('conversa longa demais: comece uma nova', 413);
  let corpo;
  try {
    corpo = JSON.parse(bruto);
  } catch {
    return erro('pedido inválido', 400);
  }
  const mensagens = corpo?.mensagens;
  const problema = validar(mensagens);
  if (problema) return erro(problema, 400);

  const nova = ehPergunta(mensagens.at(-1));
  const uso = await lerUso(env, chave);
  if (nova && uso.perguntas >= LIMITE_PERGUNTAS) return erro(`limite de ${LIMITE_PERGUNTAS} perguntas por dia atingido`, 429);
  if (uso.chamadas >= LIMITE_CHAMADAS) return erro('limite diário de consultas atingido', 429);

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let msg;
  try {
    msg = await client.beta.messages.create({
      model: MODELO,
      max_tokens: 16000,
      // se o modelo recusar por política de segurança, a API refaz o pedido no modelo reserva indicado pela Anthropic
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      // explícito: o padrão do Sonnet 5.5 é 'high'; 'medium' é o indicado para várias rodadas de ferramenta
      output_config: { effort: 'medium' },
      // instruções fixas com marcador próprio; o restante da conversa entra no cache automático
      cache_control: { type: 'ephemeral' },
      system: [
        { type: 'text', text: SISTEMA, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: contextoDosDados(await lerManifesto(env)) },
        { type: 'text', text: IDIOMA[corpo.idioma === 'en' ? 'en' : 'pt'] },
      ],
      tools: FERRAMENTAS,
      messages: mensagens,
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return erro('a IA está sobrecarregada; tente de novo em instantes', 503);
    if (e instanceof Anthropic.BadRequestError) return erro(`pedido recusado pela API: ${e.message}`, 400);
    if (e instanceof Anthropic.APIError) return erro(`falha na API da Anthropic (${e.status ?? 'sem status'})`, 502);
    throw e;
  }

  const atualizado = { perguntas: uso.perguntas + (nova ? 1 : 0), chamadas: uso.chamadas + 1 };
  await env.DADOS.put(chave, JSON.stringify(atualizado), { httpMetadata: { contentType: 'application/json' } });
  console.log(JSON.stringify({ ia: { parada: msg.stop_reason, modelo: msg.model, uso: msg.usage } }));

  return resposta({
    conteudo: msg.content,
    parada: msg.stop_reason,
    recusa: msg.stop_reason === 'refusal' ? (msg.stop_details?.explanation ?? null) : undefined,
    restantes: Math.max(0, LIMITE_PERGUNTAS - atualizado.perguntas),
  });
}
