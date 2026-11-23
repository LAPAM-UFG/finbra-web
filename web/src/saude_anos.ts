/** Anos da Saúde sem carregar o catálogo completo de indicadores. */
export type FonteChave = 'sim' | 'sinasc' | 'populacao_svs' | 'sih' | 'icsap' | 'sia' | 'cnes' | 'sinan' | 'siscan' | 'oncologia' | 'resp' | 'aps' | 'fns';
export const CHAVES_FONTES: FonteChave[] = ['sim', 'sinasc', 'populacao_svs', 'sih', 'icsap', 'sia', 'cnes', 'sinan', 'siscan', 'oncologia', 'resp', 'aps', 'fns'];
export const anosSaude=(fontes:Record<string,{anos?:number[]}|undefined>):number[]=>[...new Set(CHAVES_FONTES.flatMap(k=>fontes[k]?.anos??[]))].sort((a,b)=>a-b);
