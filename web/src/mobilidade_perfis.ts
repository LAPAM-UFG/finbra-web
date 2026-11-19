export const RACAS_MOB = ['branca','preta','amarela','parda','indigena','ign'] as const;
export const LOCAIS_MOB = ['hospital','outro_estab','domicilio','via_publica','outro_local','aldeia','ign'] as const;
export const ESCOLAS_MOB = ['nenhuma','1_3','4_7','8_11','12_mais','ign'] as const;
export const ESPECIES_MOB = ['passageiro','carga','misto','corrida','tracao','especial','colecao','sem_classe'] as const;
export const MESES_MOB = [['jan','Jan'],['fev','Fev'],['mar','Mar'],['abr','Abr'],['mai','Mai'],['jun','Jun'],['jul','Jul'],['ago','Ago'],['set','Set'],['out','Out'],['nov','Nov'],['dez','Dez']] as const;
/** O tamanho visual nunca transforma ausência em zero nem preenche um mês. */
export function alturasMesesMob(valores:readonly(number|null)[]) {
 const max=Math.max(0,...valores.filter((v):v is number=>v!==null&&Number.isFinite(v)));
 return valores.map(v=>v===null||!Number.isFinite(v)?null:max>0?Math.max(0,v)/max:0);
}
/** Acrescenta posições do calendário; quem chama mantém esses anos sem valor. */
export function eixoAnualMob(periodos:readonly number[]):number[] {
 const a=periodos[0],b=periodos.at(-1);
 if(a===undefined||b===undefined||a<1000||b>9999||b-a>200)return [...periodos];
 return Array.from({length:b-a+1},(_,j)=>a+j);
}
