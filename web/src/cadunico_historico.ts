/** Mantém o lugar; datas do retrato não são aplicadas à série histórica separada. */
export function linkHistoricoCadunico(sp: URLSearchParams, indicador = 'cad_hist_familias'): string {
  const p = new URLSearchParams([...sp].filter(([k]) => ['cod', 'ente', 'uf', 'recorte', 'lang'].includes(k)));
  p.set('conjunto', 'cadunico_historico');
  p.set('indicador', indicador);
  return '/assistencia/comparar?' + p.toString();
}

export const indicadorHistoricoCadunico: Record<string, string> = {
  cad_qtd_familias: 'cad_hist_familias',
  cad_qtd_pessoas: 'cad_hist_pessoas',
  cad_pessoas_por_familia: 'cad_hist_pessoas_por_familia',
};
