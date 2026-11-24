/** Mesma elegibilidade e rank() nacional das consultas SQL; a UF só filtra a lista final. */
import type {Params} from './api';
type Linha=Record<string,unknown>;
export type ItemFiscal={cod_ibge:number;nome:string;uf:string;populacao:number|null;valor:number|null;indicador:number|null;motivo:string|null;posicao_br?:number;total_br?:number;posicao_uf?:number;total_uf?:number};
const RECEITAS=new Set(['receita_bruta','receita_corrente','receita_impostos_taxas','fpm','icms','iptu','iss','itbi']);
const numero=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const inteiro=(v:unknown,padrao:number)=>Number.parseInt(String(v??''),10)||padrao;
const texto=(a:string,b:string)=>a<b?-1:a>b?1:0;

export function baseFiscalPronta(linhas:Linha[],campo:string,perCapita:boolean,tratamento:unknown):ItemFiscal[]{
 const dominio=campo==='pib'?null:RECEITAS.has(campo)?'receita':'despesa';
 return linhas.map(l=>{
  const valor=numero(l[campo]),populacao=numero(l[campo==='pib'?'populacao_ibge':'populacao']);
  const motivo=valor===null?'sem_valor':dominio&&l[dominio+'_ok']===false?'sem_total_dominio':
   dominio&&tratamento!=='declarado'&&l['exclui_'+dominio]===true?'inconsistencia':
   perCapita&&populacao!==null&&populacao<=0?'sem_populacao':null;
  return {cod_ibge:Number(l.cod_ibge),nome:String(l.nome),uf:String(l.uf),populacao,valor,
   indicador:perCapita?(valor!==null&&populacao!==null&&populacao>0?valor/populacao:null):valor,motivo};
 });
}

export function classificarFiscal(base:ItemFiscal[],asc=false):ItemFiscal[]{
 const itens=base.filter(l=>l.motivo===null&&l.indicador!==null).map(l=>({...l}));
 itens.sort((a,b)=>(a.indicador!-b.indicador!)*(asc?1:-1)||texto(a.nome,b.nome));
 const totais=new Map<string,number>(),contagens=new Map<string,{valor:number|null;pos:number;n:number}>();
 for(const i of itens)totais.set(i.uf,(totais.get(i.uf)??0)+1);
 let anterior:number|null=null,pos=0;
 itens.forEach((i,k)=>{
  if(k===0||i.indicador!==anterior)pos=k+1;
  anterior=i.indicador;i.posicao_br=pos;i.total_br=itens.length;
  const u=contagens.get(i.uf)??{valor:null,pos:0,n:0};
  u.n++;if(u.n===1||u.valor!==i.indicador)u.pos=u.n;
  u.valor=i.indicador;contagens.set(i.uf,u);i.posicao_uf=u.pos;i.total_uf=totais.get(i.uf)!;
 });
 return itens;
}

export function rankingFiscalPronto(linhas:Linha[],campo:string,q:Params){
 const perCapita=q.per_capita==='1'||q.per_capita===1;
 const base=baseFiscalPronta(linhas,campo,perCapita,q.tratamento);
 const nacional=classificarFiscal(base,q.ordem==='asc');
 const escopo=(l:ItemFiscal)=>!q.uf||l.uf===q.uf;
 const lista=nacional.filter(escopo),esc=base.filter(escopo);
 const limite=String(q.todos)==='1'?100000:Math.min(inteiro(q.limite,20),100),pagina=Math.max(inteiro(q.pagina,1),1);
 // O motivo é interno: o contrato público do ranking anual continua igual ao SQL.
 const publico=({motivo:_,...i}:ItemFiscal)=>i;
 return {itens:lista.slice((pagina-1)*limite,pagina*limite).map(publico),elegiveis:lista.length,
  com_dca:esc.length,sem_valor:esc.filter(l=>l.motivo==='sem_valor').length,
  fora:esc.filter(l=>l.motivo!==null&&l.motivo!=='sem_valor').length,
  zeros:lista.filter(l=>l.valor===0).length,negativos:lista.filter(l=>l.valor!==null&&l.valor<0).length,
  ente:nacional.find(l=>l.cod_ibge===Number(q.ente))?publico(nacional.find(l=>l.cod_ibge===Number(q.ente))!):null,pagina,limite};
}

export type ArvoreFiscalPronta={valores:Record<string,[string,number|null,boolean|null][]>;populacao:number|null;entes:number};
export function comparadorFiscalPronto(g:string,todos:[number,string,string][]){
 const partes=g.split(':');
 if(partes[0]==='ente'){
  const e=todos.find(e=>e[0]===Number(partes[1]));
  if(e?.[2]==='M')return {grupo:'M:'+e[1],rotulo:e[1]};
  if(e?.[2]==='E')return {grupo:'E:BR',rotulo:'Estados'};
  return null;
 }
 return partes[1]!=='BR'?{grupo:partes[0]+':BR',rotulo:'Brasil'}:null;
}
