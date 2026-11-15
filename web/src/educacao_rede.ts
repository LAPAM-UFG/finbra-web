/** Identificadores compartilhados pelo site, API e cliente de downloads. */
export const REDES_EDUCACAO=['todas','publica','municipal','estadual','federal','privada'] as const;
export type RedeEducacao=typeof REDES_EDUCACAO[number];
export const redeEducacaoValida=(v:string):v is RedeEducacao=>(REDES_EDUCACAO as readonly string[]).includes(v);
