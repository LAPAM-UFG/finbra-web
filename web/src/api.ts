import { useEffect, useState } from 'react';

export type Meta = { anos: number[]; anexos: Record<string, string[]>; baseIpca: number };
export type Ente = { cod_ibge: number; nome: string; uf: string; esfera: 'M' | 'E' | 'D'; capital: boolean };
export type No = {
  chave: string; chave_pai: string | null; nivel: number; descricao: string; tipo: 'conta' | 'total' | 'atributo';
  valor: number | null; valor_comp: number | null; sintetico: boolean | null;
};
export type Arvore = { nos: No[]; populacao: number; entes: number; populacao_comp: number | null; comparador: string | null };
export type PontoSerie = { ano: number; valor: number | null; valor_real: number | null; populacao: number; entes: number };
export type Linha = Record<string, number | string | null>;

export type Params = Record<string, string | number | null | undefined>;
const cache = new Map<string, Promise<unknown>>();

export function url(caminho: string, params: Params = {}) {
  const busca = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') busca.set(k, String(v));
  const q = busca.toString();
  return `/api/${caminho}${q ? `?${q}` : ''}`;
}

export function buscar<T>(caminho: string, params: Params = {}): Promise<T> {
  const u = url(caminho, params);
  if (!cache.has(u)) {
    const p = fetch(u).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return r.json();
    });
    p.catch(() => cache.delete(u));
    cache.set(u, p);
  }
  return cache.get(u) as Promise<T>;
}

/** Busca com estado de carregamento; refaz quando os parâmetros mudam. Caminho null não busca. */
export function useApi<T>(caminho: string | null, params: Params = {}) {
  const chave = caminho ? url(caminho, params) : null;
  const [estado, setEstado] = useState<{ chave: string | null; dados?: T; erro?: string }>({ chave: null });
  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    buscar<T>(caminho, params)
      .then((dados) => vivo && setEstado({ chave, dados }))
      .catch((e: Error) => vivo && setEstado({ chave, erro: e.message }));
    return () => {
      vivo = false;
    };
    // a chave já resume caminho + parâmetros
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave]);
  const atual = estado.chave === chave;
  return { dados: atual ? estado.dados : undefined, erro: atual ? estado.erro : undefined, carregando: !!chave && !atual };
}
