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

/** Indicadores da gold somados por exercício, para o escopo e para o comparador. */
export function useIndicadores(campos: string[]) {
  const f = useFiltros();
  const alvo = useApi<Linha[]>('agregado', { por: 'exercicio', campos: campos.join(','), ...f.escopo });
  const comp = useApi<Linha[]>(f.escopoComparador ? 'agregado' : null, {
    por: 'exercicio', campos: campos.join(','), ...(f.escopoComparador ?? {}),
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
