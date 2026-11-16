/** Nomes das UFs sem dependência do motor ou da IA. */
export const UF_NOMES: Record<string, [string, 'em' | 'no' | 'na']> = {
  AC: ['Acre', 'no'], AL: ['Alagoas', 'em'], AM: ['Amazonas', 'no'], AP: ['Amapá', 'no'], BA: ['Bahia', 'na'],
  CE: ['Ceará', 'no'], DF: ['Distrito Federal', 'no'], ES: ['Espírito Santo', 'no'], GO: ['Goiás', 'em'],
  MA: ['Maranhão', 'no'], MG: ['Minas Gerais', 'em'], MS: ['Mato Grosso do Sul', 'em'], MT: ['Mato Grosso', 'em'],
  PA: ['Pará', 'no'], PB: ['Paraíba', 'na'], PE: ['Pernambuco', 'em'], PI: ['Piauí', 'no'], PR: ['Paraná', 'no'],
  RJ: ['Rio de Janeiro', 'no'], RN: ['Rio Grande do Norte', 'no'], RO: ['Rondônia', 'em'], RR: ['Roraima', 'em'],
  RS: ['Rio Grande do Sul', 'no'], SC: ['Santa Catarina', 'em'], SE: ['Sergipe', 'em'], SP: ['São Paulo', 'em'], TO: ['Tocantins', 'no'],
};
export const nomeDaUf = (uf: string) => UF_NOMES[uf]?.[0] ?? uf;
