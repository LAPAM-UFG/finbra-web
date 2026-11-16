/** Leitores leves compartilhados; este módulo nunca importa o DuckDB. */
import { criarAbertura, USAR_MOTOR } from './clima_abertura';
import { criarAberturaSaude } from './saude_abertura';
import { BASE_DADOS, obterManifesto, versaoDoManifesto } from './manifesto';
import type { Params } from './api';
const dep={manifesto:()=>obterManifesto(s=>`Manifesto indisponível (${s})`),url:(c:string,m:Parameters<typeof versaoDoManifesto>[0])=>`${BASE_DADOS}v/${versaoDoManifesto(m)}1/${c}`,buscar:(u:RequestInfo|URL,i?:RequestInit)=>fetch(u,i)};
const clima=criarAbertura(dep),saude=criarAberturaSaude(dep);
export async function executarInicialClima(c:string,q:Params){return ['clima_meta','clima_territorios','clima_painel'].includes(c)?clima.executar(c,q):USAR_MOTOR;}
export async function executarInicialSaude(c:string,q:Params){
 if(c==='meta') {const m=await dep.manifesto();return {anos:m.anos,anexos:m.colunas?.[String(m.anos.at(-1))]??{},baseIpca:m.base_ipca,geradoEm:m.gerado_em,ipcaUltimo:m.ipca_ultimo??null,fontes:m.fontes??{},mapaIndicadores:m.mapa_indicadores??{},politica:m.politica_alertas??{}};}
 return saude.executar(c==='entes'?'saude_entes':c,q);
}
