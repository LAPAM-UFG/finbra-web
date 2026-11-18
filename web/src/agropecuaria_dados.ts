/** Números prontos por território. Não inicia SQL nem carrega dados de outros lugares. */
import { useEffect, useState } from 'react';
import { BASE_DADOS } from './manifesto';
import { leitorRaio } from './raio_x';
import type { GeografiaComparacao, ObjetoComparacao } from './comparacoes_dados';
type ObjetoRaio=ObjetoComparacao&{json_bytes?:number;json_sha256?:string};
type TrechoRaio=[number,number,string];

export type FamiliaAgro='lavouras'|'rebanhos'|'origem_animal'|'aquicultura';
export type MedidaAgro='plantada'|'colhida'|'quantidade'|'rendimento'|'valor';
export type ProdutoAgro={id:string;codigo:string;tabela:string;nome:string;familia:FamiliaAgro;medidas:Partial<Record<MedidaAgro,number>>;nota?:string};
export type IndicadorAgro={id:string;nome:string;nome_en:string;descricao:string;unidade:string;unidade_original:string;tabela:string;categoria:string;variavel_sidra:string;medida:MedidaAgro;produto:string;familia:FamiliaAgro;fator:number;anos:number[]};
export type CatalogoAgro={versao:1;anos:number[];produtos:ProdutoAgro[];indicadores:IndicadorAgro[];condicoes:Record<string,string>};
export type GrupoAgro={versao:1;grupo:string;anos:number[];valores:(number|null)[][];condicoes:number[][]};
export type MetaAgro={versao:1;anos:number[];catalogo:ObjetoRaio;geografia:ObjetoRaio;indices:Record<string,ObjetoRaio>;gerado_em:string;variaveis:number;produtos:number;max_trecho_bytes:number};
type IndiceAgro={versao:1;arquivo:ObjetoRaio;grupos:Record<string,TrechoRaio>};
let promessa:Promise<{m:MetaAgro;c:CatalogoAgro;g:GeografiaComparacao}>|undefined;

export function validarGrupoAgro(x:GrupoAgro,grupo:string,c:CatalogoAgro) {
 if(x?.versao!==1||x.grupo!==grupo||JSON.stringify(x.anos)!==JSON.stringify(c.anos)||x.valores?.length!==c.anos.length||x.condicoes?.length!==c.anos.length)throw new Error('Série de outro território ou período.');
 for(let k=0;k<c.anos.length;k++){
  if(x.valores[k].length!==c.indicadores.length||x.condicoes[k].length!==c.indicadores.length||x.valores[k].some(v=>v!==null&&(!Number.isFinite(v)||v<0))||x.condicoes[k].some(v=>![0,1,2,3,4,5,20].includes(v)))throw new Error('Série agropecuária inválida.');
  if(x.valores[k].some((v,j)=>v===null?[0,1].includes(x.condicoes[k][j]):![0,1].includes(x.condicoes[k][j])||x.condicoes[k][j]===1&&v!==0))throw new Error('Valor e condição agropecuária divergem.');
 }
}
export function obterMetaAgro() {
 if(!promessa)promessa=(async()=>{
  const r=await fetch(`${BASE_DADOS}gold/agropecuaria/manifesto.json`,{cache:'no-cache'});if(!r.ok)throw new Error('Não foi possível carregar a edição agropecuária.');
  const m=await r.json() as MetaAgro;if(m.versao!==1||!m.indices||!Array.isArray(m.anos)||m.anos.some((y,k)=>!Number.isInteger(y)||y<2013||(k>0&&y<=m.anos[k-1])))throw new Error('Edição agropecuária inválida.');
  const[c,g]=await Promise.all([leitorRaio.objeto<CatalogoAgro>(m.catalogo),leitorRaio.objeto<GeografiaComparacao>(m.geografia)]);
  if(c.versao!==1||JSON.stringify(c.anos)!==JSON.stringify(m.anos)||c.indicadores.length!==m.variaveis||c.produtos.length!==m.produtos||new Set(c.indicadores.map(i=>i.id)).size!==c.indicadores.length)throw new Error('Catálogo agropecuário incompleto.');
  for(const p of c.produtos)for(const j of Object.values(p.medidas))if(!Number.isInteger(j)||!c.indicadores[j]||c.indicadores[j].produto!==p.id)throw new Error('Medida de outro produto.');
  return{m,c,g};
 })().catch(e=>{promessa=undefined;throw e;});return promessa;
}
export async function obterGrupoAgro(grupo:string) {
 const{m,c,g}=await obterMetaAgro();const ter=g.territorios[grupo];if(!ter||!['M','UF','BR'].includes(ter.nivel))throw new Error('Escolha um município, estado ou Brasil válido.');
 const ref=m.indices[ter.nivel==='M'?ter.uf!:'referencias'];if(!ref)throw new Error('Recorte indisponível.');
 const index=await leitorRaio.objeto<IndiceAgro>(ref);const tr=index.grupos[grupo];if(!tr)throw new Error('Território não encontrado nesta edição.');
 const x=await leitorRaio.trecho<GrupoAgro>(index.arquivo,tr);validarGrupoAgro(x,grupo,c);return x;
}
export function useAgro<T>(obter:()=>Promise<T>,chave:string){
 const[dados,setDados]=useState<T>(),[erro,setErro]=useState<string>(),[tentativa,setTentativa]=useState(0);
 useEffect(()=>{let vivo=true;setDados(undefined);setErro(undefined);obter().then(v=>{if(vivo)setDados(v);}).catch(e=>{if(vivo)setErro(String(e instanceof Error?e.message:e));});return()=>{vivo=false;};},[chave,tentativa]);
 return{dados,erro,recarregar:()=>setTentativa(v=>v+1)};
}
