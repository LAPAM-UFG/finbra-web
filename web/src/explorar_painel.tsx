import { useEffect, useId, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { t } from './idioma';
export const normalizarBusca=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function corresponde(busca:string,textos:unknown[]){
 const palavras=normalizarBusca(textos.filter(x=>typeof x==='string'||typeof x==='number').join(' ')).match(/[\p{L}\p{N}]+/gu)??[];
 const termos=normalizarBusca(busca).match(/[\p{L}\p{N}]+/gu)??[];
 return termos.every(t=>palavras.some(p=>p.startsWith(t)));
}
export function useExplorarPainel(ids:readonly string[]) {
 const [busca,setBusca]=useState(''),[fechados,setFechados]=useState<Set<string>>(()=>new Set());
 const {hash,key}=useLocation();
 useEffect(()=>setFechados(new Set()),[busca]);
 useEffect(()=>{if(hash)setFechados(s=>{const n=new Set(s);try{n.delete(decodeURIComponent(hash.slice(1)));}catch{}return n;});},[hash,key]);
 const abrir=(id:string,aberto:boolean)=>setFechados(s=>{if(s.has(id)===!aberto)return s;const n=new Set(s);if(aberto)n.delete(id);else n.add(id);return n;});
 return {busca,setBusca,aberto:(id:string)=>!fechados.has(id),abrir,expandir:()=>setFechados(new Set()),recolher:()=>setFechados(new Set(ids))};
}
export type Exploracao=ReturnType<typeof useExplorarPainel>;
export function BuscaPainel({explorar,total,encontrados,temas=false,exemplos}:{explorar:Exploracao;total:number;encontrados:number;temas?:boolean;exemplos?:string}){
 const id=useId();return <section className="cartao busca-painel" aria-label={t('Encontrar indicadores','Find indicators')}>
 <label htmlFor={id}>{t('Buscar indicador ou assunto','Find an indicator or topic')}</label>
 <div className="busca-painel-campo"><input id={id} type="search" value={explorar.busca} onChange={e=>explorar.setBusca(e.target.value)} placeholder={exemplos??t('Digite um assunto…','Type a topic…')}/>{explorar.busca&&<button className="botao-leve" onClick={()=>explorar.setBusca('')}>{t('Limpar busca','Clear search')}</button>}</div>
 <div className="busca-painel-rodape"><p role="status">{t(`${encontrados} de ${total} ${temas?'temas':'indicadores'}`,`${encontrados} of ${total} ${temas?'topics':'indicators'}`)}</p>
 <details><summary>{t('Organizar temas','Organise topics')}</summary><div className="busca-painel-acoes"><button className="botao-leve" onClick={explorar.expandir}>{t('Expandir todos os temas','Expand all topics')}</button><button className="botao-leve" onClick={explorar.recolher}>{t('Recolher todos os temas','Collapse all topics')}</button></div></details></div>
 </section>;
}
export function TemaPainel({id,titulo,explorar,children}:{id:string;titulo:string;explorar:Exploracao;children:ReactNode}){
 const aberto=explorar.aberto(id);return <details className="tema-painel" open={aberto} onToggle={e=>explorar.abrir(id,e.currentTarget.open)}>
 <summary><h3 className="secao bloco-saude" id={id} data-indice={titulo} tabIndex={-1}>{titulo}</h3></summary>
 {aberto&&<div className="tema-painel-corpo">{children}</div>}
 </details>;
}
