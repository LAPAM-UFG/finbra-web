/** Uma segunda tentativa para leituras com falha transitoria; nunca repete escritas. */
export function criarBuscaDados(buscar: typeof globalThis.fetch, esperar = (ms: number) => new Promise<void>(r => setTimeout(r, ms))): typeof globalThis.fetch {
  return async (input, init) => {
    const request = typeof Request !== 'undefined' && input instanceof Request ? input : null;
    const metodo = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    const sinal = init?.signal ?? request?.signal;
    if (!['GET', 'HEAD'].includes(metodo)) return buscar(input, init);
    for (let tentativa = 0; ; tentativa++) {
      sinal?.throwIfAborted();
      try {
        const resposta = await buscar(input, init);
        if (tentativa || ![408, 500, 502, 503, 504].includes(resposta.status)) return resposta;
        try { await resposta.body?.cancel(); } catch { /* a repeticao nao depende do corpo de erro */ }
      } catch (erro) {
        if (tentativa || sinal?.aborted || (erro instanceof Error && erro.name === 'AbortError')) throw erro;
      }
      await esperar(250);
    }
  };
}

// Resolve o fetch no momento da chamada, inclusive nos testes e no navegador.
export const buscarDados = criarBuscaDados((input, init) => globalThis.fetch(input, init));
