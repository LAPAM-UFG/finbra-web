import type { LinhaRankingPib } from './assistencia_economia';
import type { MalhaMunicipal } from './geografia_municipal';
export { buscarNoMapa, centroDaMalha, obterMalhaMunicipal, tamanhoMapa, validarMalha, type MalhaMunicipal, type MunicipioMapa } from './geografia_municipal';

export const CORES_PIB = ['#edf5fc', '#c6dbef', '#9ecae1', '#6baed6', '#3182bd', '#08519c'] as const;
export const COR_SEM_PERCENTUAL = '#a7adb5';
/** Limites fixos, em pontos percentuais, para comparar programas, anos e estados. */
export function corPercentualPib(v: number | null): string {
  if (v === null || !Number.isFinite(v) || v < 0) return COR_SEM_PERCENTUAL;
  return CORES_PIB[v === 0 ? 0 : v < 2 ? 1 : v < 5 ? 2 : v < 10 ? 3 : v < 20 ? 4 : 5];
}
export function linhasDoMapa(malha: MalhaMunicipal, linhas: LinhaRankingPib[]) {
  const porCodigo = new Map(linhas.map(l => [String(l[0]), l]));
  return malha.features.map(f => {
    const linha = porCodigo.get(f.properties.name);
    return { ...f.properties, linha, percentual: linha?.[4] ?? null };
  });
}
