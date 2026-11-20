import {useEffect,useState} from 'react';
import {BASE_DADOS} from './manifesto';
import {leitorRaio} from './raio_x';
import type {DefComparacao,GeografiaComparacao,ObjetoComparacao} from './comparacoes_dados';
type Objeto=ObjetoComparacao&{json_bytes?:number;json_sha256?:string};
export type IndicadorSeg={id:string;nome:string;nome_en:string;familia:string;unidade:string;unidade_en:string;fonte:string;fonte_nome:string;fonte_url:string;descricao:string;descricao_en:string;anos:number[];auxiliar:boolean};
export type CalculadoSeg=DefComparacao&{variavel_download:string;numerador_id:string;denominador_id:string;numerador_nome:string;denominador_nome:string};
export type CatalogoSeg={versao:1;anos:number[];indicadores:IndicadorSeg[];derivados:CalculadoSeg[];condicoes:Record<string,string>};
export type GrupoSeg={versao:1;grupo:string;anos:number[];valores:(number|null)[][];condicoes:number[][];derivados:(number|null)[][];condicoes_derivados:number[][];numeradores:(number|null)[][];denominadores:(number|null)[][];coberturas:number[][];residuos:Record<string,unknown>};
export type MetaSeg={versao:1;anos:number[];catalogo:Objeto;geografia:Objeto;indices:Record<string,Objeto>;variaveis:number;calculados:number;max_trecho_bytes:number;ultimos:Record<string,number>;gerado_em:string;notas:string[]};
let promessa:Promise<{m:MetaSeg;c:CatalogoSeg;g:GeografiaComparacao}>|undefined;
export function validarGrupoSeg(x:GrupoSeg,grupo:string,c:CatalogoSeg){
 if(x.versao!==1||x.grupo!==grupo||JSON.stringify(x.anos)!==JSON.stringify(c.anos))throw new Error('Recorte de outra edição, território ou período.');
 const arrays=[x.valores,x.condicoes,x.derivados,x.condicoes_derivados,x.numeradores,x.denominadores,x.coberturas];if(arrays.some(a=>!Array.isArray(a)||a.length!==c.anos.length))throw new Error('Série de segurança incompleta.');
 for(let y=0;y<c.anos.length;y++){
  for(const[v,flags,n,raw]of[[x.valores[y],x.condicoes[y],c.indicadores.length,true],[x.derivados[y],x.condicoes_derivados[y],c.derivados.length,false]]as[(number|null)[],number[],number,boolean][]){
   if(v.length!==n||flags.length!==n||v.some((z,j)=>z===null?![2,3,4,5,23,24].includes(flags[j]):!Number.isFinite(z)||z<0||!(raw?[0,1,11,16,23]:[0,1,16]).includes(flags[j])||[1,23].includes(flags[j])&&z!==0))throw new Error('Valor e condição de segurança divergem.');
  }
  for(const vs of[x.numeradores[y],x.denominadores[y]])if(vs.length!==c.derivados.length||vs.some(v=>v!==null&&(!Number.isFinite(v)||v<0)))throw new Error('Componentes inválidos.');
  if(x.coberturas[y].length!==c.derivados.length||x.coberturas[y].some(v=>!Number.isSafeInteger(v)||v<0||v>5571))throw new Error('Cobertura inválida.');
 }
}
export function obterMetaSeg(){
 if(!promessa)promessa=(async()=>{
  const r=await fetch(`${BASE_DADOS}gold/seguranca/manifesto.json`,{cache:'no-cache'});if(!r.ok)throw new Error('Não foi possível abrir o painel de Segurança.');const m=await r.json()as MetaSeg;
  if(m.versao!==1||!m.indices||!Array.isArray(m.anos)||m.anos.some((y,k)=>!Number.isInteger(y)||y<2013||k>0&&y<=m.anos[k-1]))throw new Error('Edição de segurança inválida.');
  const[c,g]=await Promise.all([leitorRaio.objeto<CatalogoSeg>(m.catalogo),leitorRaio.objeto<GeografiaComparacao>(m.geografia)]);
  if(c.versao!==1||JSON.stringify(c.anos)!==JSON.stringify(m.anos)||c.indicadores.length!==m.variaveis||c.derivados.length!==m.calculados||new Set(c.indicadores.map(i=>i.id)).size!==m.variaveis||new Set(c.derivados.map(i=>i.id)).size!==m.calculados)throw new Error('Catálogo incompleto.');
  const raw=new Set(c.indicadores.map(i=>i.id));if(c.derivados.some(i=>!raw.has(i.numerador_id)||!raw.has(i.denominador_id)||!Number.isFinite(i.fator)||i.fator<=0||i.variavel_download.length+5>32))throw new Error('Fórmula de segurança inválida.');return{m,c,g};
 })().catch(e=>{promessa=undefined;throw e;});return promessa;
}
export async function obterGrupoSeg(grupo:string){const{m,c,g}=await obterMetaSeg();const ter=g.territorios[grupo];if(!ter||!['M','UF','BR'].includes(ter.nivel))throw new Error('Escolha um município, estado ou Brasil.');const idx=await leitorRaio.objeto<{arquivo:Objeto;grupos:Record<string,[number,number,string]>}>(m.indices[ter.nivel==='M'?ter.uf!:'referencias']);const x=await leitorRaio.trecho<GrupoSeg>(idx.arquivo,idx.grupos[grupo]);validarGrupoSeg(x,grupo,c);return x;}
export function useSeg<T>(obter:()=>Promise<T>,chave:string){const[dados,setDados]=useState<T>(),[erro,setErro]=useState<string>(),[tentativa,setTentativa]=useState(0);useEffect(()=>{let vivo=true;setDados(undefined);setErro(undefined);obter().then(d=>{if(vivo)setDados(d);}).catch(e=>{if(vivo)setErro(e instanceof Error?e.message:String(e));});return()=>{vivo=false;};},[chave,tentativa]);return{dados,erro,recarregar:()=>setTentativa(t=>t+1)};}
export function alturaMesesSeg(vs:(number|null)[]){const max=Math.max(1,...vs.filter((v):v is number=>v!==null));return vs.map(v=>v===null?null:v/max*100);}
