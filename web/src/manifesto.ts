/**
 * Manifesto dos dados: UM snapshot por sessão, compartilhado entre o caminho rápido do clima (sem DuckDB) e o motor (dados.ts).
 * Assim a versão do resumo e a do histórico nunca se misturam ao navegar. Respeita VITE_DADOS_URL e não usa cache do navegador
 * (no-cache revalida); os testes injetam o manifesto em vez de buscar.
 */
export type ManifestoBruto = {
  gerado_em: string; anos: number[]; base_ipca: number; colunas: Record<string, Record<string, string[]>>;
  ipca_ultimo?: { exercicio: number; meses: number };
  fontes?: Record<string, Record<string, unknown>>;
  /** Ponteiros técnicos de pacotes de abertura (sem motor), amarrados ao gerado_em deste manifesto; não são fontes de dados. */
  aberturas?: Record<string, unknown>;
  mapa_indicadores?: Record<string, Record<string, unknown>[]>;
  politica_alertas?: Record<string, unknown>;
};

export const BASE_DADOS = typeof location === 'undefined' ? '' : new URL(import.meta.env?.VITE_DADOS_URL ?? '/dados/', location.href).href;

let atual: Promise<ManifestoBruto> | null = null;

export function obterManifesto(mensagemErro: (status: number) => string): Promise<ManifestoBruto> {
  const p = (atual ??= fetch(`${BASE_DADOS}gold/manifesto.json`, { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(mensagemErro(r.status));
    return r.json() as Promise<ManifestoBruto>;
  }));
  p.catch(() => {
    if (atual === p) atual = null;
  });
  return p;
}

/** Testes: o manifesto que a "rede" devolve. */
export function injetarManifesto(m: ManifestoBruto) {
  atual = Promise.resolve(m);
}

/** Versão dos URLs: os dígitos de gerado_em (mesma regra de sempre). */
export const versaoDoManifesto = (m: ManifestoBruto) => m.gerado_em.replace(/[^0-9]/g, '');
