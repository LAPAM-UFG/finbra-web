import {BASE_DADOS} from './manifesto';
import {leitorRaio} from './raio_x';
import {useEne} from './energia_dados';
import type {DefComparacao,GeografiaComparacao,ObjetoComparacao} from './comparacoes_dados';
export {useEne as useComex};
type Objeto=ObjetoComparacao&{json_bytes?:number;json_sha256?:string};
export type IndicadorComex={id:string;nome:string;nome_en:string;familia:string;unidade:string;unidade_en:string;descricao:string;descricao_en:string;anos:number[];auxiliar:boolean;com_sinal:boolean;recorte:'comum'|'observado';fonte_nome:string;fonte_url:string;notas_anos?:Record<string,[string,string]>};
export type CalculadoComex=DefComparacao&{variavel_download:string;numerador_id:string;denominador_id:string;numerador_nome:string;denominador_nome:string;denominador_potencia?:number};
export type CatalogoComex={versao:1;anos:number[];indicadores:IndicadorComex[];derivados:CalculadoComex[];condicoes:Record<string,string>};
export type GrupoComex={versao:1;grupo:string;anos:number[];valores:(number|null)[][];condicoes:number[][];derivados:(number|null)[][];condicoes_derivados:number[][];numeradores:(number|null)[][];denominadores:(number|null)[][];coberturas:number[][];residuos:Record<string,Record<string,number>>};
export type MensalComex={versao:1;grupo:string;periodos:number[];colunas:string[];valores:number[][];condicoes:number[][]};
export type PerfilComex={versao:1;grupo:string;ano:number;mes_ate:number;fluxos:Record<'exp'|'imp',{produtos:[string,number,number][];paises:[number,number,number][]}>};
export type ClassesComex={versao:1;produtos:Record<string,[string,string]>;paises:Record<string,[string,string]>};
type MetaComex={versao:1;catalogo:Objeto;geografia:Objeto;indices:Record<string,Objeto>;anos:number[];variaveis:number;calculados:number;max_trecho_bytes:number;datas:{comex:string};periodos:Record<string,number>;mes_comum:number;qualidade:{registros_sem_municipio:number;registros_fob_negativo:number;fob_negativo_preservado:number};mensais:{indices:Record<string,Objeto>;periodos:number[]};perfis:Objeto;classificacoes:Objeto;notas:string[]};
type Indice={versao:1;arquivo:Objeto;grupos:Record<string,[number,number,string]>};
let promise:Promise<{m:MetaComex;c:CatalogoComex;g:GeografiaComparacao}>|undefined;
export function validarGrupoComex(x:GrupoComex,grupo:string,c:CatalogoComex){
 if(x.versao!==1||x.grupo!==grupo||JSON.stringify(x.anos)!==JSON.stringify(c.anos))throw new Error('Série de outro território ou período.');
 const arrays=[x.valores,x.condicoes,x.derivados,x.condicoes_derivados,x.numeradores,x.denominadores,x.coberturas];if(arrays.some(a=>!Array.isArray(a)||a.length!==c.anos.length))throw new Error('Série incompleta.');
 for(let y=0;y<c.anos.length;y++){
  for(const[v,flags,n,raw]of[[x.valores[y],x.condicoes[y],c.indicadores.length,true],[x.derivados[y],x.condicoes_derivados[y],c.derivados.length,false]]as[(number|null)[],number[],number,boolean][]){
   if(v.length!==n||flags.length!==n||v.some((z,j)=>z===null?![2,3,4,5,16].includes(flags[j]):!Number.isFinite(z)||z<0&&(!raw||!c.indicadores[j].com_sinal)||![0,1,16].includes(flags[j])||flags[j]===1&&z!==0))throw new Error('Valor e condição divergem.');
  }
  for(const a of[x.numeradores[y],x.denominadores[y]])if(a.length!==c.derivados.length||a.some(v=>v!==null&&(!Number.isFinite(v)||v<0)))throw new Error('Componente inválido.');
  if(x.coberturas[y].length!==c.derivados.length||x.coberturas[y].some(n=>!Number.isSafeInteger(n)||n<0||n>5571))throw new Error('Cobertura inválida.');
 }
}
export function obterMetaComex(){
 if(!promise)promise=(async()=>{const r=await fetch(`${BASE_DADOS}gold/comex/manifesto.json`,{cache:'no-cache'});if(!r.ok)throw new Error('Não foi possível abrir Comércio exterior.');const m=await r.json()as MetaComex;
  if(m.versao!==1||!m.indices||!m.anos.length||!Number.isInteger(m.mes_comum)||m.mes_comum<1||m.mes_comum>12)throw new Error('Edição inválida.');
  const[c,g]=await Promise.all([leitorRaio.objeto<CatalogoComex>(m.catalogo),leitorRaio.objeto<GeografiaComparacao>(m.geografia)]);const ids=new Set(c.indicadores.map(i=>i.id));
  if(c.versao!==1||JSON.stringify(c.anos)!==JSON.stringify(m.anos)||ids.size!==m.variaveis||c.indicadores.length!==m.variaveis||c.derivados.length!==m.calculados||new Set(c.derivados.map(i=>i.id)).size!==m.calculados||c.derivados.some(i=>!ids.has(i.numerador_id)||!ids.has(i.denominador_id)||!Number.isFinite(i.fator)||i.fator<=0||![1,2].includes(i.denominador_potencia??1)))throw new Error('Catálogo incompleto.');return{m,c,g};
 })().catch(e=>{promise=undefined;throw e;});return promise;
}
async function recorte(grupo:string){const b=await obterMetaComex(),ter=b.g.territorios[grupo];if(!ter||!['M','UF','BR'].includes(ter.nivel))throw new Error('Escolha um município, estado ou Brasil.');return{...b,bucket:ter.nivel==='M'?ter.uf!:'referencias'};}
export async function obterGrupoComex(grupo:string){const{m,c,bucket}=await recorte(grupo),i=await leitorRaio.objeto<Indice>(m.indices[bucket]),d=await leitorRaio.trecho<GrupoComex>(i.arquivo,i.grupos[grupo]);validarGrupoComex(d,grupo,c);return d;}
export async function obterMensalComex(grupo:string){const{m,bucket}=await recorte(grupo),i=await leitorRaio.objeto<Indice>(m.mensais.indices[bucket]),d=await leitorRaio.trecho<MensalComex>(i.arquivo,i.grupos[grupo]);
 if(d.versao!==1||d.grupo!==grupo||JSON.stringify(d.periodos)!==JSON.stringify(m.mensais.periodos)||d.colunas.length!==5||d.valores.length!==d.periodos.length||d.condicoes.length!==d.periodos.length||d.valores.some((row,k)=>row.length!==5||d.condicoes[k].length!==5||row.some((v,j)=>!Number.isFinite(v)||j!==2&&v<0||d.condicoes[k][j]!== (v===0?1:0))))throw new Error('Série mensal inválida.');return d;
}
export async function obterPerfilComex(grupo:string,ano:number){const{m,bucket}=await recorte(grupo);if(!m.anos.includes(ano))throw new Error('Ano fora da cobertura.');const[p,classes]=await Promise.all([leitorRaio.objeto<{indices:Record<string,Objeto>}>(m.perfis),leitorRaio.objeto<ClassesComex>(m.classificacoes)]),i=await leitorRaio.objeto<Indice>(p.indices[`${bucket}:${ano}`]),d=await leitorRaio.trecho<PerfilComex>(i.arquivo,i.grupos[grupo]);
 if(d.versao!==1||d.grupo!==grupo||d.ano!==ano||d.mes_ate!==m.periodos[String(ano)]||!d.fluxos.exp||!d.fluxos.imp)throw new Error('Perfil de outra edição.');
 for(const f of['exp','imp']as const)for(const tipo of['produtos','paises']as const){const rows=d.fluxos[f][tipo];if(!Array.isArray(rows)||rows.some(r=>r.length!==3||r.slice(1).some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0))||new Set(rows.map(r=>r[0])).size!==rows.length)throw new Error('Perfil inválido.');}
 return{d,classes};
}
