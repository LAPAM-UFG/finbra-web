/** Disponibilidade dos atalhos avançados, sem carregar o motor ou microdados. */
import { useEffect,useState } from 'react';
import { BASE_DADOS } from './manifesto';
let disponibilidade:Promise<boolean>|null=null;
function temMicro(){
 if(import.meta.env?.VITE_MICRODADOS==='0')return Promise.resolve(false);
 return disponibilidade??=(async()=>{
  try {const r=await fetch(BASE_DADOS+'silver/trabalho/micro/indice.json');if(!r.ok)throw new Error('Catálogo indisponível');const x=await r.json();return !!x?.rais_vinculos&&Object.keys(x.rais_vinculos).length>0;}
  catch {disponibilidade=null;return false;}
 })();
}
export function useMicroNoPainel(escopo:{ente?:unknown;uf?:unknown}){
 const [ativo,setAtivo]=useState(false),local=!!(escopo.ente||escopo.uf);
 useEffect(()=>{let atual=true;if(local)temMicro().then(v=>{if(atual)setAtivo(v);});return()=>{atual=false;};},[local]);
 return local&&ativo;
}
