/**
 * Fila de perguntas de uma conversa. Cada pergunta é um item independente, com identificador, ordem e estado
 * (aguardando, executando, concluída, falhou, cancelada). Uma falha ou cancelamento não mexe nas outras
 * perguntas nem no rascunho do campo de texto: só o item afetado muda de estado e pode ser tentado de novo.
 * Funções puras sobre listas imutáveis, para a tela e os testes usarem as mesmas regras.
 */
export type EstadoItem = 'aguardando' | 'executando' | 'concluida' | 'falhou' | 'cancelada';
export type ItemFila = { id: string; conversa: string; texto: string; estado: EstadoItem; erro?: string };

let contador = 0;
export const novoIdItem = () => `q${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const enfileirar = (fila: ItemFila[], conversa: string, texto: string, id = novoIdItem()): ItemFila[] =>
  [...fila, { id, conversa, texto, estado: 'aguardando' }];

/** Atualiza só o item indicado (um identificador que não existe não muda nada). */
export const marcar = (fila: ItemFila[], id: string, estado: EstadoItem, erro?: string): ItemFila[] =>
  fila.map((x) => (x.id === id ? { ...x, estado, erro: estado === 'falhou' ? erro : undefined } : x));

/**
 * Próxima a rodar: a primeira aguardando da conversa, se nada estiver executando e nenhuma pergunta anterior tiver
 * falhado ou sido cancelada (a ordem é preservada: a fila espera a pessoa decidir entre tentar de novo ou remover).
 */
export function proxima(fila: ItemFila[], conversa: string): ItemFila | null {
  if (fila.some((x) => x.estado === 'executando')) return null;
  for (const x of fila) {
    if (x.conversa !== conversa) continue;
    if (x.estado === 'falhou' || x.estado === 'cancelada') return null;
    if (x.estado === 'aguardando') return x;
  }
  return null;
}

/** Tentar de novo só a que falhou (ou foi cancelada): volta a aguardar no mesmo lugar; as outras ficam como estão. */
export const tentarDeNovo = (fila: ItemFila[], id: string): ItemFila[] =>
  fila.map((x) => (x.id === id && (x.estado === 'falhou' || x.estado === 'cancelada') ? { ...x, estado: 'aguardando', erro: undefined } : x));

export const remover = (fila: ItemFila[], id: string): ItemFila[] => fila.filter((x) => x.id !== id || x.estado === 'executando');
export const limparConcluidas = (fila: ItemFila[]): ItemFila[] => fila.filter((x) => x.estado !== 'concluida');
export const aEsperar = (fila: ItemFila[]) => fila.filter((x) => x.estado === 'aguardando').length;
/** Perguntas ainda não respondidas (aguardando, executando, falhou ou cancelada): ocupam lugar na fila e no limite diário. */
export const abertas = (fila: ItemFila[]) => fila.filter((x) => x.estado !== 'concluida').length;

const CHAVE_VALIDA = (x: unknown): x is ItemFila => {
  const i = x as ItemFila | null;
  return !!i && typeof i.id === 'string' && typeof i.conversa === 'string' && typeof i.texto === 'string'
    && ['aguardando', 'executando', 'concluida', 'falhou', 'cancelada'].includes(i.estado);
};

export const serializar = (fila: ItemFila[]) => JSON.stringify(fila.filter((x) => x.estado !== 'concluida'));

/**
 * Lê a fila guardada (recarregar a página). Uma pergunta que estava executando foi interrompida: volta como falha,
 * para a pessoa decidir tentar de novo, em vez de rodar sozinha e repetir consultas.
 */
export function lerFila(bruto: string | null): ItemFila[] {
  if (!bruto) return [];
  try {
    const v = JSON.parse(bruto);
    if (!Array.isArray(v)) return [];
    const vistos = new Set<string>();
    return v.filter(CHAVE_VALIDA).filter((x) => !vistos.has(x.id) && !!vistos.add(x.id))
      .map((x) => (x.estado === 'executando' ? { ...x, estado: 'falhou' as const, erro: 'interrompida ao recarregar a página' } : x));
  } catch {
    return [];
  }
}
