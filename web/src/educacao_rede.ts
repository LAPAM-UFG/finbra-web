/** Identificadores compartilhados pelo site, API e cliente de downloads. */
export const REDES_EDUCACAO=['todas','publica','municipal','estadual','federal','privada'] as const;
export type RedeEducacao=typeof REDES_EDUCACAO[number];
export const redeEducacaoValida=(v:string):v is RedeEducacao=>(REDES_EDUCACAO as readonly string[]).includes(v);

/** Ao trocar a rede, a medida estadual explícita vira a medida da rede escolhida. */
export function ajustarIndicadorRede(ind:string|null,rede:RedeEducacao):string|null {
 return rede!=='todas'&&ind&&/^(ideb|saeb_lp|saeb_mat)_medio_estadual$/.test(ind)?ind.replace(/_estadual$/,''):ind;
}
