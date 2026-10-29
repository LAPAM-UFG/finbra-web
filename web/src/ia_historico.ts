/**
 * Histórico das conversas da IA. Cada conversa é guardada inteira — mensagens trocadas com o modelo (com os
 * resultados das ferramentas, que ele relê nas perguntas seguintes), resultados das consultas, contexto e versão
 * dos dados de cada pergunta — para reabrir sem rodar nada de novo e continuar perguntando a partir dela.
 *
 * O armazenamento fica atrás de RepositorioConversas: hoje o IndexedDB deste navegador (repositorioLocal); depois,
 * a conta do usuário. O formato exportado (JSON, FORMATO_CONVERSA/VERSAO_CONVERSA) é o mesmo da gravação, para
 * backup, transferência entre computadores e, mais tarde, a migração das conversas locais para a conta.
 */
import { useSyncExternalStore } from 'react';
import {
  ehPergunta, paraModelo, rotuloModo, rotulosConsultas, rotuloTerritorio, textoDaPergunta, turnos,
  type ContextoIa, type Desfecho, type Mensagem, type Painel, type Resultado,
} from './ia';
import type { NotaMetodologica } from './ia_notas';
import { local, t } from './idioma';

export const FORMATO_CONVERSA = 'lapam-ia-conversa';
export const VERSAO_CONVERSA = 1;

/** Nota metodológica com os textos como saíram na resposta (o navegador só grava dados, não funções). */
export type NotaGuardada = Omit<NotaMetodologica, 'titulo' | 'curta' | 'texto'> & { titulo: string; curta: string; texto: string };
export const guardarNota = (n: NotaMetodologica): NotaGuardada => ({ ...n, titulo: n.titulo(), curta: n.curta(), texto: n.texto() });
export const lerNota = (n: NotaGuardada): NotaMetodologica => ({ ...n, titulo: () => n.titulo, curta: () => n.curta, texto: () => n.texto });

/** Fontes, versões das bases, notas e códigos como saíram na resposta: abrir de novo não troca pelos de hoje. */
export type RegistroTurno = { fontes: string[]; bases?: string[]; notas: NotaGuardada[]; codigos: string[] };
/** Consultas refeitas com dados mais novos (nova versão da conversa): o texto da IA continua o original. */
export type Reexecucao = { em: number; dados: string; original: string; falhas: number };
/** Contexto de cada pergunta, guardado com ela: as respostas anteriores mantêm o recorte que usaram. */
export type MetaTurno = {
  contexto: ContextoIa; inicio: number; fim?: number; desfecho?: Desfecho; detalhe?: string | null;
  /** Versão dos dados (manifesto.geradoEm) quando a pergunta foi feita. */
  dados?: string;
  registro?: RegistroTurno;
  reexecucao?: Reexecucao;
};
export type OrigemConversa =
  | { tipo: 'nova' }
  | { tipo: 'importada'; em: number; id: string }
  | { tipo: 'versao'; de: string; titulo: string; em: number; dados: string };

export type Conversa = {
  formato: typeof FORMATO_CONVERSA;
  versao: typeof VERSAO_CONVERSA;
  /** UUID: único entre navegadores, para juntar depois as conversas locais às da conta. */
  id: string;
  titulo: string;
  tituloManual: boolean;
  criadaEm: number;
  atualizadaEm: number;
  mensagens: Mensagem[];
  metas: MetaTurno[];
  resultados: Record<string, Resultado>;
  /** Catálogo das fontes (manifesto.fontes) de cada versão dos dados usada, pela data de processamento. */
  fontes: Record<string, Record<string, Record<string, unknown>>>;
  origem: OrigemConversa;
  /** Reservado para o histórico por conta (etapa 2): null = só neste navegador. */
  conta: null;
};

/** O que a lista do histórico mostra e onde a busca procura, sem carregar as tabelas. */
export type ResumoConversa = {
  id: string; titulo: string; criadaEm: number; atualizadaEm: number; perguntas: number;
  paineis: Painel[]; territorio: string; modo: string; dados: string[]; origem: OrigemConversa; busca: string;
};

export const novoId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Título automático: a primeira pergunta, cortada numa palavra. */
export function tituloAutomatico(pergunta: string, max = 80) {
  const s = pergunta.replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s || t('Conversa sem título', 'Untitled conversation');
  const corte = s.slice(0, max - 1);
  return `${corte.slice(0, corte.lastIndexOf(' ') > max / 2 ? corte.lastIndexOf(' ') : corte.length).trimEnd()}…`;
}

export const perguntasDe = (mensagens: Mensagem[]) => mensagens.filter(ehPergunta).map(textoDaPergunta);

/** Versões dos dados das respostas da conversa (as refeitas valem pela versão nova). */
export const versoesDosDados = (metas: MetaTurno[]) => [...new Set(metas.map((m) => m.reexecucao?.dados ?? m.dados).filter((x): x is string => !!x))];

/** Alguma resposta foi gerada com dados mais antigos do que os publicados agora? */
export const desatualizada = (metas: MetaTurno[], atual: string) => versoesDosDados(metas).some((v) => v !== atual);

export function resumoDe(c: Conversa): ResumoConversa {
  const ultima = c.metas.at(-1)?.contexto;
  const conclusoes = turnos(c.mensagens).map((x) => x.resposta?.conclusao ?? x.textoFinal ?? '');
  const perguntas = perguntasDe(c.mensagens);
  return {
    id: c.id, titulo: c.titulo, criadaEm: c.criadaEm, atualizadaEm: c.atualizadaEm, perguntas: perguntas.length,
    paineis: ultima?.paineis ?? [], territorio: ultima ? rotuloTerritorio(ultima.territorio) : '', modo: ultima ? rotuloModo(ultima.modo) : '',
    dados: versoesDosDados(c.metas), origem: c.origem,
    busca: normalizar([c.titulo, ...perguntas, ...conclusoes].join(' ')),
  };
}

/** Conversas cujo título, perguntas ou conclusões têm todas as palavras buscadas; mais recentes primeiro. */
export function filtrarResumos(lista: ResumoConversa[], termo: string) {
  const palavras = normalizar(termo).split(' ').filter(Boolean);
  return lista.filter((r) => palavras.every((p) => r.busca.includes(p))).sort((a, b) => b.atualizadaEm - a.atualizadaEm);
}

/** "29/10/2026 12:22" (data de processamento dos dados ou de uma conversa). */
export function dataHora(v: string | number) {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(local(), { dateStyle: 'short', timeStyle: 'short' });
}

// ---------------- exportação e importação ----------------

export const exportarConversa = (c: Conversa) => JSON.stringify(c);

const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Lê um arquivo exportado; recusa, com o motivo, o que não for uma conversa deste formato. */
export function lerConversaExportada(texto: string): Conversa {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    throw new Error(t('o arquivo não é um JSON válido', 'the file is not valid JSON'));
  }
  if (!objeto(v) || v.formato !== FORMATO_CONVERSA) throw new Error(t('o arquivo não é uma conversa exportada desta página', 'the file is not a conversation exported from this page'));
  if (typeof v.versao !== 'number' || v.versao > VERSAO_CONVERSA) throw new Error(t('a conversa foi exportada por uma versão mais nova da página', 'the conversation was exported by a newer version of the page'));
  const mensagens = v.mensagens;
  if (!Array.isArray(mensagens) || !mensagens.every((m) => objeto(m) && (m.role === 'user' || m.role === 'assistant') && (typeof m.content === 'string' || Array.isArray(m.content)))) {
    throw new Error(t('as mensagens da conversa estão incompletas', 'the conversation messages are incomplete'));
  }
  if (!Array.isArray(v.metas) || !v.metas.every((m) => objeto(m) && objeto(m.contexto)) || !objeto(v.resultados)) {
    throw new Error(t('faltam o contexto ou os resultados das consultas', 'the context or the query results are missing'));
  }
  if (typeof v.id !== 'string' || !v.id) throw new Error(t('a conversa não tem identificador', 'the conversation has no identifier'));
  const agora = Date.now();
  return {
    formato: FORMATO_CONVERSA, versao: VERSAO_CONVERSA, id: v.id,
    titulo: typeof v.titulo === 'string' && v.titulo.trim() ? v.titulo.trim() : tituloAutomatico(perguntasDe(mensagens as Mensagem[])[0] ?? ''),
    tituloManual: v.tituloManual === true,
    criadaEm: typeof v.criadaEm === 'number' ? v.criadaEm : agora,
    atualizadaEm: typeof v.atualizadaEm === 'number' ? v.atualizadaEm : agora,
    mensagens: mensagens as Mensagem[], metas: v.metas as MetaTurno[], resultados: v.resultados as Record<string, Resultado>,
    fontes: objeto(v.fontes) ? v.fontes as Conversa['fontes'] : {},
    origem: objeto(v.origem) && typeof v.origem.tipo === 'string' ? v.origem as OrigemConversa : { tipo: 'nova' },
    conta: null,
  };
}

/**
 * Como a conversa importada entra no histórico: com o mesmo identificador quando ele é novo aqui (ou é a mesma
 * versão: nada a fazer) e como cópia, com outro identificador, quando já existe uma conversa diferente com ele.
 */
export function paraImportar(c: Conversa, existente: Conversa | null, agora = Date.now()): { conversa: Conversa; repetida: boolean } {
  if (!existente) return { conversa: c, repetida: false };
  if (existente.atualizadaEm === c.atualizadaEm && existente.mensagens.length === c.mensagens.length) return { conversa: existente, repetida: true };
  return {
    conversa: { ...c, id: novoId(), titulo: `${c.titulo} ${t('(importada)', '(imported)')}`, origem: { tipo: 'importada', em: agora, id: c.id } },
    repetida: false,
  };
}

// ---------------- nova versão com os dados atuais ----------------

/**
 * Nova versão da conversa com as consultas refeitas nos dados atuais, aqui no navegador (a IA não é chamada e o
 * limite não muda). A original fica como estava. Os resultados que o modelo relê nas perguntas seguintes também
 * passam a ser os novos; os textos das respostas (conclusão, análise, ressalvas) continuam os originais.
 */
export async function novaVersaoComDadosAtuais(c: Conversa, o: {
  executar: (sql: string, paineis: Painel[]) => Promise<Resultado>; dados: string; fontes: Record<string, Record<string, unknown>>; agora?: number;
}): Promise<Conversa> {
  const agora = o.agora ?? Date.now();
  const rotulos = rotulosConsultas(c.mensagens);
  const resultados = { ...c.resultados };
  const novos = new Map<string, Resultado>();
  const falhas = new Map<number, number>();
  let turno = -1;
  for (const m of c.mensagens) {
    if (ehPergunta(m)) turno += 1;
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_use' || b.name !== 'consultar' || !b.id) continue;
      const sql = String((b.input as { sql?: unknown } | undefined)?.sql ?? '');
      const r = await o.executar(sql, c.metas[turno]?.contexto.paineis ?? ['financas', 'trabalho']);
      resultados[b.id] = r;
      novos.set(b.id, r);
      if ('erro' in r) falhas.set(turno, (falhas.get(turno) ?? 0) + 1);
    }
  }
  const mensagens = c.mensagens.map((m): Mensagem => (m.role !== 'user' || !Array.isArray(m.content) ? m : {
    ...m,
    content: m.content.map((b) => {
      const r = b.type === 'tool_result' ? novos.get(String(b.tool_use_id)) : undefined;
      if (!r) return b;
      const { is_error: _e, ...resto } = b;
      return { ...resto, content: paraModelo(r, rotulos.get(String(b.tool_use_id))), ...('erro' in r ? { is_error: true } : {}) };
    }),
  }));
  const metas = c.metas.map((m, i): MetaTurno => ({
    ...m,
    // as versões das bases saem do catálogo novo; fontes, notas e códigos são os mesmos (mesmo SQL)
    registro: m.registro ? { ...m.registro, bases: undefined } : undefined,
    reexecucao: { em: agora, dados: o.dados, original: m.reexecucao?.original ?? m.dados ?? '', falhas: falhas.get(i) ?? 0 },
  }));
  return {
    ...c, id: novoId(), titulo: `${c.titulo} · ${t('dados de', 'data of')} ${dataHora(o.dados)}`, tituloManual: false,
    criadaEm: agora, atualizadaEm: agora, mensagens, metas, resultados,
    fontes: { ...c.fontes, [o.dados]: o.fontes },
    origem: { tipo: 'versao', de: c.id, titulo: c.titulo, em: agora, dados: o.dados },
  };
}

// ---------------- armazenamento ----------------

/** Onde as conversas ficam. Hoje, o navegador; a conta do usuário entra como outra implementação. */
export interface RepositorioConversas {
  readonly onde: 'navegador' | 'conta';
  listar(): Promise<ResumoConversa[]>;
  ler(id: string): Promise<Conversa | null>;
  salvar(c: Conversa): Promise<void>;
  excluir(id: string): Promise<void>;
}

const BANCO = 'lapam-ia';
const CONVERSAS = 'conversas';
const RESUMOS = 'resumos';

let banco: Promise<IDBDatabase> | null = null;
function abrirBanco(): Promise<IDBDatabase> {
  banco ??= new Promise<IDBDatabase>((ok, falha) => {
    if (typeof indexedDB === 'undefined') {
      falha(new Error(t('este navegador não oferece armazenamento local (IndexedDB)', 'this browser has no local storage (IndexedDB)')));
      return;
    }
    const pedido = indexedDB.open(BANCO, 1);
    pedido.onupgradeneeded = () => {
      const db = pedido.result;
      if (!db.objectStoreNames.contains(CONVERSAS)) db.createObjectStore(CONVERSAS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(RESUMOS)) db.createObjectStore(RESUMOS, { keyPath: 'id' });
    };
    pedido.onsuccess = () => ok(pedido.result);
    pedido.onerror = () => falha(pedido.error ?? new Error('IndexedDB'));
    pedido.onblocked = () => falha(new Error(t('o armazenamento está bloqueado por outra aba desta página', 'storage is blocked by another tab of this page')));
  });
  banco.catch(() => {
    banco = null;
  });
  return banco;
}

function transacao<T>(lojas: string[], modo: IDBTransactionMode, fazer: (tx: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
  return abrirBanco().then((db) => new Promise<T | undefined>((ok, falha) => {
    const tx = db.transaction(lojas, modo);
    const pedido = fazer(tx);
    tx.oncomplete = () => ok(pedido ? pedido.result : undefined);
    tx.onerror = () => falha(tx.error ?? new Error('IndexedDB'));
    tx.onabort = () => falha(tx.error ?? new Error(t('gravação cancelada pelo navegador', 'write cancelled by the browser')));
  }));
}

export const repositorioLocal: RepositorioConversas = {
  onde: 'navegador',
  listar: () => transacao<ResumoConversa[]>([RESUMOS], 'readonly', (tx) => tx.objectStore(RESUMOS).getAll()).then((r) => r ?? []),
  ler: (id) => transacao<Conversa>([CONVERSAS], 'readonly', (tx) => tx.objectStore(CONVERSAS).get(id)).then((r) => r ?? null),
  salvar: (c) => transacao([CONVERSAS, RESUMOS], 'readwrite', (tx) => {
    tx.objectStore(CONVERSAS).put(c);
    tx.objectStore(RESUMOS).put(resumoDe(c));
  }).then(() => undefined),
  excluir: (id) => transacao([CONVERSAS, RESUMOS], 'readwrite', (tx) => {
    tx.objectStore(CONVERSAS).delete(id);
    tx.objectStore(RESUMOS).delete(id);
  }).then(() => undefined),
};

/** Repositório em memória (testes e navegadores sem IndexedDB: vale só nesta visita). */
export function repositorioEmMemoria(): RepositorioConversas {
  const m = new Map<string, Conversa>();
  // mesmo algoritmo de cópia do IndexedDB: o que ele não grava falha aqui também
  const copia = <T>(v: T): T => structuredClone(v);
  return {
    onde: 'navegador',
    listar: async () => [...m.values()].map(resumoDe),
    ler: async (id) => (m.has(id) ? copia(m.get(id)!) : null),
    salvar: async (c) => void m.set(c.id, copia(c)),
    excluir: async (id) => void m.delete(id),
  };
}

/** Mensagem legível para uma falha de gravação (sem espaço, bloqueio, navegador sem armazenamento). */
export function motivoFalha(e: unknown) {
  const nome = (e as { name?: string } | null)?.name;
  if (nome === 'QuotaExceededError') return t('o navegador está sem espaço para guardar a conversa', 'the browser has no room left to store the conversation');
  // sem o ponto final: a frase do aviso continua depois do motivo
  return (e instanceof Error ? e.message : String(e)).trim().replace(/\.+$/, '');
}

// ---------------- estado compartilhado (lista lateral e página) ----------------

type EstadoHistorico = {
  resumos: ResumoConversa[];
  carregado: boolean;
  /** Última falha de gravação ou leitura, para o aviso visível. */
  erro: string | null;
  /** Conversas com uma pergunta rodando (inclusive fora da tela: a resposta é gravada quando chegar). */
  emAndamento: string[];
  /** Quando cada conversa foi gravada pela última vez nesta visita (a página recarrega se não for a dela). */
  gravadas: Record<string, number>;
};

let repo: RepositorioConversas = repositorioLocal;
let estado: EstadoHistorico = { resumos: [], carregado: false, erro: null, emAndamento: [], gravadas: {} };
const ouvintes = new Set<() => void>();
const excluidas = new Set<string>();
const mudar = (novo: Partial<EstadoHistorico>) => {
  estado = { ...estado, ...novo };
  for (const f of ouvintes) f();
};

export function usarRepositorio(r: RepositorioConversas) {
  repo = r;
  estado = { resumos: [], carregado: false, erro: null, emAndamento: [], gravadas: {} };
  excluidas.clear();
}

let persistencia: Promise<unknown> | null = null;

export const historico = {
  estado: () => estado,
  assinar(f: () => void) {
    ouvintes.add(f);
    return () => void ouvintes.delete(f);
  },
  async recarregar() {
    try {
      mudar({ resumos: await repo.listar(), carregado: true });
    } catch (e) {
      mudar({ carregado: true, erro: t(`Não foi possível ler o histórico: ${motivoFalha(e)}.`, `Could not read the history: ${motivoFalha(e)}.`) });
    }
  },
  ler: (id: string) => repo.ler(id),
  /**
   * Grava a conversa. Um título dado pela pessoa (renomear) prevalece sobre o automático de uma gravação que
   * começou antes; uma conversa excluída não volta. Devolve false (com o aviso no estado) se a gravação falhar.
   */
  async salvar(c: Conversa): Promise<boolean> {
    if (excluidas.has(c.id)) return true;
    try {
      const antes = await repo.ler(c.id).catch(() => null);
      const final = antes?.tituloManual && !c.tituloManual ? { ...c, titulo: antes.titulo, tituloManual: true } : c;
      await repo.salvar(final);
      // pede ao navegador para não apagar o histórico quando faltar espaço (ele pode recusar)
      persistencia ??= (typeof navigator !== 'undefined' && navigator.storage?.persist?.().catch(() => false)) || Promise.resolve(false);
      mudar({ erro: null, gravadas: { ...estado.gravadas, [c.id]: final.atualizadaEm } });
      await historico.recarregar();
      return true;
    } catch (e) {
      mudar({ erro: t(`A conversa não foi salva neste navegador: ${motivoFalha(e)}. Exporte-a em JSON para não perdê-la.`,
        `The conversation was not saved in this browser: ${motivoFalha(e)}. Export it as JSON so you do not lose it.`) });
      return false;
    }
  },
  async renomear(id: string, titulo: string) {
    const c = await repo.ler(id);
    if (!c || !titulo.trim()) return false;
    return historico.salvar({ ...c, titulo: titulo.trim(), tituloManual: true, atualizadaEm: Date.now() });
  },
  async excluir(id: string) {
    excluidas.add(id);
    try {
      await repo.excluir(id);
      await historico.recarregar();
      return true;
    } catch (e) {
      excluidas.delete(id);
      mudar({ erro: t(`Não foi possível excluir a conversa: ${motivoFalha(e)}.`, `Could not delete the conversation: ${motivoFalha(e)}.`) });
      return false;
    }
  },
  /** Importa um arquivo exportado; devolve o identificador com que a conversa ficou. */
  async importar(texto: string): Promise<{ id: string; repetida: boolean }> {
    const c = lerConversaExportada(texto);
    excluidas.delete(c.id);
    const { conversa, repetida } = paraImportar(c, await repo.ler(c.id));
    if (!repetida && !(await historico.salvar(conversa))) throw new Error(estado.erro ?? '');
    return { id: conversa.id, repetida };
  },
  marcar(id: string, rodando: boolean) {
    const resto = estado.emAndamento.filter((x) => x !== id);
    mudar({ emAndamento: rodando ? [...resto, id] : resto });
  },
  limparErro: () => mudar({ erro: null }),
};

export const useHistorico = () => useSyncExternalStore(historico.assinar, historico.estado, historico.estado);
