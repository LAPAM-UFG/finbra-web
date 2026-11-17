/** Mantém o lugar; datas do retrato não são aplicadas à série histórica separada. */
export function indicadorCadunicoLocal(uf?: string, municipal = true): string {
  return municipal && uf === 'PA' ? 'cad_hist_pa_familias_anual' : municipal && uf === 'MG' ? 'cad_hist_mg_pessoas_pct' : 'cad_hist_familias';
}

export const permiteAgregadoHistorico = (area: string, rede: string, nivel: string, indicador: string) =>
  area === 'assistencia' && rede === 'cadunico_historico' && ['BR', 'UF'].includes(nivel) &&
  ['cad_hist_familias', 'cad_hist_pessoas', 'cad_hist_pessoas_por_familia'].includes(indicador);

export function linkHistoricoCadunico(sp: URLSearchParams, indicador?: string): string {
  const p = new URLSearchParams([...sp].filter(([k]) => ['cod', 'ente', 'uf', 'recorte', 'lang'].includes(k)));
  const cod = (sp.get('cod') ?? sp.get('ente'))?.toUpperCase();
  const uf = cod ? (/^15\d{5}$/.test(cod) ? 'PA' : /^31\d{5}$/.test(cod) ? 'MG' : cod) : sp.get('uf')?.toUpperCase();
  p.set('conjunto', 'cadunico_historico');
  const municipal = /^\d{7}$/.test(cod ?? '') || /^(I:|T:)/.test(sp.get('recorte') ?? '');
  p.set('indicador', indicador ?? indicadorCadunicoLocal(uf, municipal));
  return '/assistencia/comparar?' + p.toString();
}

export const indicadorHistoricoCadunico: Record<string, string> = {
  cad_qtd_familias: 'cad_hist_familias',
  cad_qtd_pessoas: 'cad_hist_pessoas',
  cad_pessoas_por_familia: 'cad_hist_pessoas_por_familia',
};
