/**
 * Pedido de conferência de uma resposta da IA pelo especialista RAIS (formato "conferencia-rais/1"; etapa 1).
 *
 * Montado aqui no navegador, só com o que a página já tem: a pergunta e o contexto enviados ao modelo, as
 * consultas com o SQL e o resultado exatamente como voltaram ao modelo (até 200 linhas), a entrada da ferramenta
 * "responder" e a versão dos dados. Nada vai ao servidor nem à Anthropic: a pessoa baixa o arquivo <id>.json e o
 * entrega ao agente local, que recalcula os números a partir dos brutos da RAIS.
 *
 * Entram as consultas desta pergunta, sem as que deram erro e sem as que outra consulta refez ("substitui"),
 * mais as de perguntas anteriores que a resposta cita. Limites do formato: de 1 a 20 consultas, pergunta com
 * até 2000 caracteres, contexto com até 1500 e arquivo com até 600 KB (passando disso, saem primeiro as
 * consultas que a resposta não cita).
 */
import { ehPergunta, rotulosConsultas, textoDaPergunta, type Bloco, type Mensagem } from './ia';
import type { MetaTurno } from './ia_historico';

export const VERSAO_PEDIDO = 'conferencia-rais/1';
export const MAX_CONSULTAS_PEDIDO = 20;
const MAX_LINHAS_PEDIDO = 200;
export const MAX_BYTES_PEDIDO = 600_000;
const MAX_PERGUNTA = 2000;
const MAX_CONTEXTO = 1500;

type Celula = string | number | boolean | null;
export type ConsultaPedido = { id: string; objetivo: string; sql: string; colunas: string[]; linhas: Celula[][]; total_linhas: number };
export type PedidoConferencia = {
  versao: typeof VERSAO_PEDIDO;
  id: string;
  criado_em: string;
  solicitante: string;
  pergunta: string;
  paineis: string[];
  contexto: string;
  modelo_site: string;
  conversa?: string;
  manifesto: { gerado_em: string; rais_micro_processado_em?: string };
  consultas: ConsultaPedido[];
  resposta: Record<string, unknown>;
};

/** Data ISO 8601 com o fuso do computador (ex.: 2026-10-30T14:00:00-03:00). */
export function isoComFuso(d: Date): string {
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const fuso = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    + `${fuso >= 0 ? '+' : '-'}${p(fuso / 60)}:${p(fuso % 60)}`;
}

/** Identificador do pedido: 8 a 64 caracteres [A-Za-z0-9_-] (UUID sem hífens). */
const novoIdPedido = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID().replace(/-/g, '')
  : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`);

/** Consultas que a resposta cita (campos "consulta" em destaques, tabelas, gráficos e leituras). */
function citadas(v: unknown, r = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => citadas(x, r));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (k === 'consulta' && typeof x === 'string' && /^C\d+$/.test(x.trim())) r.add(x.trim());
      else citadas(x, r);
    }
  }
  return r;
}

/** Resultado de consulta como voltou ao modelo (paraModelo), ou null se foi erro ou não pôde ser lido. */
function lerDevolvido(b?: Bloco): { colunas: string[]; linhas: Celula[][]; total: number } | null {
  if (!b || b.is_error || typeof b.content !== 'string') return null;
  try {
    const r = JSON.parse(b.content) as { colunas?: unknown; linhas?: unknown; total_linhas?: unknown };
    if (!Array.isArray(r.colunas) || !Array.isArray(r.linhas) || !r.linhas.every((l) => Array.isArray(l) && l.length === (r.colunas as unknown[]).length)) return null;
    return { colunas: r.colunas.map(String), linhas: (r.linhas as Celula[][]).slice(0, MAX_LINHAS_PEDIDO), total: typeof r.total_linhas === 'number' ? r.total_linhas : r.linhas.length };
  } catch {
    return null;
  }
}

/** A entrada de "responder", sem mudanças: o objeto "resposta" (que sem o modo estrito pode vir como texto JSON). */
function entradaResponder(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  let dentro = (input as Record<string, unknown>).resposta;
  if (typeof dentro === 'string') try { dentro = JSON.parse(dentro); } catch { return null; }
  if (dentro && typeof dentro === 'object' && !Array.isArray(dentro)) return dentro as Record<string, unknown>;
  return input as Record<string, unknown>;
}

const tamanho = (s: string) => new TextEncoder().encode(s).length;

/**
 * Monta o pedido da pergunta `turno` (0 = primeira) da conversa. Devolve o pedido e o texto do arquivo, ou o
 * motivo de não poder montá-lo.
 */
export function pedidoConferencia(e: {
  mensagens: Mensagem[]; turno: number; meta?: MetaTurno; solicitante: string; modelo: string;
  /** Catálogo das fontes de cada versão dos dados usada na conversa (Conversa.fontes). */
  fontes: Record<string, Record<string, Record<string, unknown>>>;
  dadosAtuais: { geradoEm: string; fontes: Record<string, unknown> };
  conversa?: string; id?: string; agora?: Date;
}): { pedido: PedidoConferencia; json: string } | { erro: string } {
  const inicios = e.mensagens.flatMap((m, i) => (ehPergunta(m) ? [i] : []));
  if (e.turno < 0 || e.turno >= inicios.length) return { erro: 'pergunta não encontrada na conversa' };
  const de = inicios[e.turno];
  const ate = inicios[e.turno + 1] ?? e.mensagens.length;
  const perguntaMsg = e.mensagens[de];
  const textos = typeof perguntaMsg.content === 'string' ? [perguntaMsg.content] : perguntaMsg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '');

  // resultados devolvidos ao modelo e respostas recusadas pela página, na conversa inteira
  const devolvidos = new Map<string, Bloco>();
  for (const m of e.mensagens) {
    if (m.role === 'user' && Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_result') devolvidos.set(String(b.tool_use_id), b);
  }
  // a resposta da pergunta: a última chamada de "responder" que a página não devolveu ao modelo
  let resposta: Record<string, unknown> | null = null;
  for (const m of e.mensagens.slice(de, ate)) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === 'tool_use' && b.name === 'responder' && !devolvidos.get(String(b.id))?.is_error) resposta = entradaResponder(b.input) ?? resposta;
    }
  }
  if (!resposta) return { erro: 'esta pergunta não tem resposta estruturada para conferir' };

  const rotulos = rotulosConsultas(e.mensagens);
  const cita = citadas(resposta);
  type Candidata = ConsultaPedido & { n: number; citada: boolean; doTurno: boolean; substitui: string };
  const candidatas: Candidata[] = [];
  e.mensagens.forEach((m, i) => {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) return;
    for (const b of m.content) {
      if (b.type !== 'tool_use' || b.name !== 'consultar' || !b.id) continue;
      const rotulo = rotulos.get(b.id) ?? '';
      const doTurno = i >= de && i < ate;
      if (!doTurno && !cita.has(rotulo)) continue;
      const r = lerDevolvido(devolvidos.get(b.id));
      if (!r) continue;
      const x = (b.input ?? {}) as { sql?: unknown; objetivo?: unknown; substitui?: unknown };
      candidatas.push({
        id: rotulo, objetivo: String(x.objetivo ?? ''), sql: String(x.sql ?? ''), colunas: r.colunas, linhas: r.linhas, total_linhas: r.total,
        n: Number(rotulo.slice(1)), citada: cita.has(rotulo), doTurno, substitui: String(x.substitui ?? '').trim(),
      });
    }
  });
  // o SQL final: sai a consulta que outra desta pergunta refez, salvo se a resposta a cita
  const refeitas = new Set(candidatas.filter((c) => c.doTurno).map((c) => c.substitui).filter(Boolean));
  let escolhidas = candidatas.filter((c) => c.citada || !refeitas.has(c.id));
  // até 20: primeiro as citadas na resposta
  escolhidas = [...escolhidas.filter((c) => c.citada), ...escolhidas.filter((c) => !c.citada)].slice(0, MAX_CONSULTAS_PEDIDO);
  if (!escolhidas.length) return { erro: 'nenhuma consulta com resultado nesta pergunta' };

  const gerado = e.meta?.reexecucao?.original ?? e.meta?.dados ?? e.dadosAtuais.geradoEm;
  const fontes = (e.fontes[gerado] ?? (gerado === e.dadosAtuais.geradoEm ? e.dadosAtuais.fontes : {})) as Record<string, { processado_em?: unknown } | undefined>;
  const rais = fontes.rais_micro?.processado_em;
  const id = e.id ?? novoIdPedido();
  const criado = isoComFuso(e.agora ?? new Date());

  const montar = (lista: Candidata[]) => {
    const pedido: PedidoConferencia = {
      versao: VERSAO_PEDIDO,
      id,
      criado_em: criado,
      solicitante: e.solicitante,
      pergunta: textoDaPergunta(perguntaMsg).slice(0, MAX_PERGUNTA),
      paineis: e.meta?.contexto.paineis ?? ['trabalho'],
      contexto: textos.slice(0, -1).join('\n\n').slice(0, MAX_CONTEXTO),
      modelo_site: e.modelo,
      ...(e.conversa ? { conversa: e.conversa } : {}),
      manifesto: { gerado_em: gerado, ...(typeof rais === 'string' ? { rais_micro_processado_em: rais } : {}) },
      consultas: [...lista].sort((a, b) => a.n - b.n).map(({ id, objetivo, sql, colunas, linhas, total_linhas }) => ({ id, objetivo, sql, colunas, linhas, total_linhas })),
      resposta,
    };
    // sem recuo: com ele, cada célula das tabelas vira uma linha e o arquivo cresce várias vezes
    return { pedido, json: JSON.stringify(pedido) };
  };
  let feito = montar(escolhidas);
  // acima de 600 KB, saem as consultas que a resposta não cita, das últimas para as primeiras
  while (tamanho(feito.json) > MAX_BYTES_PEDIDO) {
    const i = escolhidas.findLastIndex((c) => !c.citada);
    if (i < 0 || escolhidas.length === 1) return { erro: 'o pedido passa de 600 KB mesmo só com as consultas citadas na resposta' };
    escolhidas = escolhidas.filter((_, j) => j !== i);
    feito = montar(escolhidas);
  }
  return feito;
}
