import { COD_UF } from './munic_painel';

export type Area = 'financas' | 'trabalho' | 'saude' | 'munic' | 'clima' | 'assistencia' | 'ia';

const ufPorCodigo = new Map(Object.entries(COD_UF).map(([uf, cod]) => [String(cod), uf]));
const query = (p: URLSearchParams) => { const s = p.toString(); return s ? `?${s}` : ''; };

/**
 * O lugar acompanha a troca de área, traduzindo cod (Clima/MUNIC) e ente (demais painéis).
 * Ano de edição da MUNIC/ESTADIC não é exercício nem ano de observação: só vale nessa área.
 * Escolhas próprias (indicador, ocupação, pergunta, variável climática) não cruzam áreas.
 */
export function buscaEntreAreas(search: string, origem: Area, destino: Exclude<Area, 'ia'>): string {
  const atual = new URLSearchParams(search);
  const saida = new URLSearchParams();
  if (origem === destino) {
    const chaves = origem === 'munic' ? ['pesq', 'uf', 'cod', 'ano'] : origem === 'clima' ? ['uf', 'cod', 'ano', 'variavel'] : origem === 'assistencia' ? ['uf', 'cod', 'mes', 'ano'] : ['uf', 'ente', 'ano'];
    for (const k of chaves) if (atual.get(k)) saida.set(k, atual.get(k)!);
    return query(saida);
  }
  const porCod = origem === 'clima' || origem === 'munic' || origem === 'assistencia';
  const codigoPedido = atual.get(porCod ? 'cod' : 'ente')?.trim() ?? '';
  const ufPedida = (atual.get('uf') ?? '').trim().toUpperCase();
  const codigo = codigoPedido || (origem === 'munic' && atual.get('pesq') === 'estadic' && ufPedida in COD_UF ? String(COD_UF[ufPedida]) : '');
  const ufCodigo = ufPorCodigo.get(codigo) ?? (/^\d{7}$/.test(codigo) ? ufPorCodigo.get(codigo.slice(0, 2)) : undefined);
  // O prefixo serve só para preencher uma UF ausente. Ele não prova que o município existe:
  // pedidos conflitantes ou desconhecidos seguem intactos para a validação do destino avisar.
  const uf = ufPedida || ufCodigo || '';
  const governo = ufPorCodigo.has(codigo);
  const df = codigo === '53' || codigo === '5300108';
  if (uf) saida.set('uf', uf);

  if (destino === 'munic') {
    if (governo || df || (uf === 'DF' && !codigo)) {
      saida.set('pesq', 'estadic');
      saida.set('cod', codigo && !df ? codigo : '53');
    } else if (codigo) saida.set('cod', codigo);
  } else if (destino === 'clima' || destino === 'assistencia') {
    if (df) saida.set('cod', '5300108');
    else if (codigo && !governo) saida.set('cod', codigo);
  } else if (codigo) {
    if (df) saida.set('ente', '53');
    else if (destino === 'financas' || !governo) saida.set('ente', codigo);
  }

  const ano = atual.get('ano');
  if (ano && origem !== 'munic' && destino !== 'munic' && /^\d{4}$/.test(ano)) saida.set('ano', ano);
  return query(saida);
}

/** Links antigos da IA mantêm a conversa e o recorte, que a própria página explica antes de aplicar. */
export function buscaIaLegada(search: string, tema?: string): string {
  const p = new URLSearchParams(search);
  if (tema) p.set('paineis', tema);
  return query(p);
}
