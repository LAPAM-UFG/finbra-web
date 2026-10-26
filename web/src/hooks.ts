import { useState } from 'react';
import { useApi, type Linha, type Params, type PontoSerie } from './api';
import { useFiltros } from './contexto';

/** Coluna escolhida do anexo; volta para a primeira se não existir no exercício. */
export function useColuna(anexo: string, ano: number, preferida?: string) {
  const { dados: opcoes = [] } = useApi<string[]>('colunas', { anexo, ano });
  const [escolhida, setEscolhida] = useState<string | undefined>(preferida);
  const coluna = escolhida && opcoes.includes(escolhida) ? escolhida : opcoes[0];
  return { coluna, setColuna: setEscolhida, opcoes };
}

/**
 * Indicadores da gold somados por exercício, para o escopo e para o comparador. Cada campo vem
 * com a população e o número de entes do próprio conjunto elegível (populacao_<campo>, entes_<campo>);
 * `pares` ("a/b") traz numerador e denominador na interseção; `painel` restringe aos mesmos entes em todos os anos.
 */
export function useIndicadores(campos: string[], opcoes: { pares?: string[]; painel?: boolean } = {}) {
  const f = useFiltros();
  const extra = { pares: opcoes.pares?.join(','), painel: opcoes.painel ? 1 : undefined };
  const alvo = useApi<Linha[]>('agregado', { por: 'exercicio', campos: campos.join(','), ...extra, ...f.escopo });
  const comp = useApi<Linha[]>(f.escopoComparador ? 'agregado' : null, {
    por: 'exercicio', campos: campos.join(','), ...extra, ...(f.escopoComparador ?? {}),
  });
  return { alvo, comp, f };
}

/** Série de uma conta para o escopo e o comparador. */
export function useSerie(params: Params) {
  const f = useFiltros();
  const alvo = useApi<PontoSerie[]>(params.chave ? 'serie' : null, { ...params, ...f.escopo });
  const comp = useApi<PontoSerie[]>(params.chave && f.escopoComparador ? 'serie' : null, {
    ...params, ...(f.escopoComparador ?? {}),
  });
  return { alvo, comp, f };
}

export const num = (v: unknown) => (typeof v === 'number' ? v : null);

/** Razão de um par devolvido pelo agregado (interseção das observações válidas). */
export const razao = (r: Linha | undefined, a: string, b: string) => {
  const n = num(r?.[`${a}__${b}_num`]);
  const d = num(r?.[`${a}__${b}_den`]);
  return n === null || d === null || d === 0 ? null : n / d;
};
