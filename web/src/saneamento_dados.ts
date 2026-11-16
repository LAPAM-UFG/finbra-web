/** Saneamento: um catálogo pequeno e um Range por território, sem DuckDB. */
import {useEffect,useState} from 'react';
import {BASE_DADOS} from './manifesto';
export type RefSan={caminho:string;bytes:number;sha256:string};
export type TerrSan={grupo:string;nome:string;uf:string|null;nivel:'M'|'UF'|'BR';cod_ibge:number|null;trecho:[number,number,string]};
export type IndSan={id:string;variavel:string;nome:string;nome_en:string;descricao:string;descricao_en:string;tema:string;unidade:string;anos:number[];snis:string[];sinisa:string[];oficial:(string|null)[];fator:number;regra_agregado:string};
/** ano, indicador, valor, numerador, denominador, observados, cadastro, condição */
export type LinhaSan=[number,number,number|null,number|null,number|null,number,number,number];
export type GrupoSan={grupo:string;linhas:LinhaSan[]};
export type MetaSan={versao:1;gerado_em:string;anos:number[];indicadores:IndSan[];grupos:TerrSan[];municipios:Record<string,RefSan>;cadastro:RefSan;arquivo:RefSan;rankings:Record<string,RefSan>;catalogo_rankings?:RefSan;consulta:RefSan;fontes:{nome:string;url:string;ano:number;modulo:string}[];notas:string[]};
export type RankingSan={ano:number;indicador:string;linhas:[number,string,string,number,number][]};
const UF_COD:Record<string,string>={11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF'};
export const ufDoMunicipioSan=(cod:string)=>/^\d{7}$/.test(cod)?UF_COD[cod.slice(0,2)]:undefined;
const digest=async(b:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validarRefSan(r:RefSan){if(!r||!/^gold\/saneamento\/[a-z0-9_]+\.(json|ndjson|parquet)$/.test(r.caminho)||!hash(r.sha256)||!Number.isSafeInteger(r.bytes)||r.bytes<1)throw Error('Arquivo de saneamento inválido.');}
export function criarLeitorSan(base:string,buscar:typeof fetch){
 const cache=new Map<string,Promise<unknown>>();
 function memorizar<T>(key:string,fn:()=>Promise<T>):Promise<T>{let p=cache.get(key)as Promise<T>|undefined;if(!p){p=fn();cache.set(key,p);p.catch(()=>cache.delete(key));}return p;}
 async function ler<T>(ref:RefSan):Promise<T>{validarRefSan(ref);return memorizar(ref.caminho,async()=>{const r=await buscar(base+ref.caminho);if(!r.ok)throw Error('Arquivo de saneamento indisponível.');const b=await r.arrayBuffer();if(b.byteLength!==ref.bytes||await digest(b)!==ref.sha256)throw Error('Arquivo de saneamento incompleto.');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));});}
 function meta():Promise<MetaSan>{return memorizar('meta',async()=>{
  const r=await buscar(base+'gold/saneamento/manifesto.json',{cache:'no-cache'});if(!r.ok)throw Error('Não foi possível carregar o catálogo de saneamento.');
  const m=await r.json()as MetaSan;
  if(m.versao!==1||!Array.isArray(m.anos)||!m.anos.length||m.anos.some(y=>!Number.isInteger(y)||y<2013)||!Array.isArray(m.indicadores)||!m.indicadores.length||!Array.isArray(m.grupos)||!m.municipios||!m.rankings||!Array.isArray(m.fontes)||!Array.isArray(m.notas))throw Error('Catálogo de saneamento incompatível.');
  if(new Set(m.indicadores.map(i=>i.id)).size!==m.indicadores.length||m.indicadores.some(i=>!/^[a-z][a-z0-9_]*$/.test(i.id)||!Array.isArray(i.anos)))throw Error('Indicadores de saneamento inválidos.');
  validarRefSan(m.arquivo);validarRefSan(m.cadastro);validarRefSan(m.consulta);return m;
 });}
 function municipios(uf:string):Promise<TerrSan[]>{return memorizar('uf:'+uf,async()=>{const m=await meta(),ref=m.municipios[uf];if(!ref)throw Error('UF não encontrada.');const rows=await ler<TerrSan[]>(ref);if(!Array.isArray(rows)||rows.some(t=>t.uf!==uf||t.nivel!=='M'||ufDoMunicipioSan(t.grupo)!==uf))throw Error('Cadastro municipal inconsistente.');return rows;});}
 function cadastro():Promise<[string,string,string][]> {return memorizar('cadastro',async()=>{const m=await meta(),rows=await ler<[string,string,string][]>(m.cadastro);if(!Array.isArray(rows)||rows.some(r=>r.length!==3||ufDoMunicipioSan(r[0])!==r[2]||!r[1]))throw Error('Busca municipal inconsistente.');return rows;});}
 async function territorio(cod:string,uf:string){const m=await meta();if(cod){const u=ufDoMunicipioSan(cod);if(!u)throw Error('Código de município inválido.');const t=(await municipios(u)).find(t=>t.grupo===cod);if(!t)throw Error('Município não encontrado. Escolha um nome na busca.');return t;}const t=m.grupos.find(t=>t.grupo===(uf||'BR'));if(!t)throw Error('UF não encontrada.');return t;}
 function grupo(t:TerrSan):Promise<GrupoSan>{return memorizar('grupo:'+t.grupo+':'+t.trecho?.[2],async()=>{
  const m=await meta(),[start,size,sha]=t.trecho??[];
  if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(size)||size<1||start+size>m.arquivo.bytes||!hash(sha))throw Error('Trecho de saneamento inválido.');
  const r=await buscar(base+m.arquivo.caminho,{headers:{Range:`bytes=${start}-${start+size-1}`}});
  if(r.status!==206||r.headers.get('Content-Range')!==`bytes ${start}-${start+size-1}/${m.arquivo.bytes}`){await r.body?.cancel();throw Error('Não foi possível ler este território. Tente novamente.');}
  const b=await r.arrayBuffer();if(b.byteLength!==size||await digest(b)!==sha)throw Error('Dados de saneamento incompletos.');
  const g=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b))as GrupoSan;
  if(g.grupo!==t.grupo||!Array.isArray(g.linhas))throw Error('Dados de outro território.');
  const seen=new Set<string>();for(const l of g.linhas){const key=l[0]+':'+l[1];if(l.length!==8||!m.anos.includes(l[0])||!Number.isInteger(l[1])||!m.indicadores[l[1]]||l.some(v=>v!==null&&(typeof v!=='number'||!Number.isFinite(v)))||seen.has(key)||!Number.isInteger(l[7])||l[7]<0||l[7]>6||![l[5],l[6]].every(v=>Number.isSafeInteger(v)&&v>=0)||l[5]>l[6]||(l[7]===0)!==(l[2]!==null))throw Error('Linha de saneamento inconsistente.');seen.add(key);}return g;
 });}
 function ranking(ano:number,id:string):Promise<RankingSan>{return memorizar('ranking:'+ano+':'+id,async()=>{const m=await meta(),ind=m.indicadores.find(i=>i.id===id);if(!ind)throw Error('Indicador de saneamento não encontrado.');if(!m.anos.includes(ano))throw Error('Ano fora da cobertura de saneamento.');if(!ind.anos.includes(ano))return{ano,indicador:id,linhas:[]};let ref=m.rankings[id+':'+ano];if(!ref&&m.catalogo_rankings){const catalogo=await ler<Record<string,RefSan>>(m.catalogo_rankings);ref=catalogo[id+':'+ano];}if(!ref)throw Error('Sem ranking desta medida neste ano.');const r=await ler<RankingSan>(ref);if(r.ano!==ano||r.indicador!==id||!Array.isArray(r.linhas)||r.linhas.some(l=>l.length!==5||ufDoMunicipioSan(String(l[0]))!==l[2]||!Number.isFinite(l[3])))throw Error('Ranking de outra referência.');return r;});}
 return {meta,municipios,cadastro,territorio,grupo,ranking,limpar:()=>cache.clear()};
}
export const leitorSan=criarLeitorSan(BASE_DADOS,(u,i)=>fetch(u,i));
export function useRecursoSan<T>(fn:()=>Promise<T>,deps:unknown[]){
 const [versao,setVersao]=useState(0),[state,setState]=useState<{dado?:T;carregando:boolean;erro?:string}>({carregando:true});
 useEffect(()=>{let vivo=true;setState({carregando:true});fn().then(dado=>{if(vivo)setState({dado,carregando:false});}).catch(e=>{if(vivo)setState({carregando:false,erro:e instanceof Error?e.message:'Dados indisponíveis.'});});return()=>{vivo=false;};},[...deps,versao]);
 return {...state,recarregar:()=>{leitorSan.limpar();setVersao(v=>v+1);}};
}
export function linhaSan(meta:MetaSan,g:GrupoSan,ano:number,idx:number):LinhaSan{
 return g.linhas.find(l=>l[0]===ano&&l[1]===idx)??[ano,idx,null,null,null,0,g.linhas[0]?.[6]??(/^\d{7}$/.test(g.grupo)?1:0),meta.indicadores[idx]?.anos.includes(ano)?1:5];
}
/** Exportação inclui também combinações sem resposta ou sem pesquisa. */
export function linhasCompletasSan(meta:MetaSan,g:GrupoSan):LinhaSan[]{return meta.anos.flatMap(ano=>meta.indicadores.map((_,idx)=>linhaSan(meta,g,ano,idx)));}
export function posicoesSan(rows:RankingSan['linhas'],asc=false){let pos=0,antes:number|undefined;return [...rows].sort((a,b)=>(asc?a[3]-b[3]:b[3]-a[3])||a[1].localeCompare(b[1],'pt-BR')).map((r,i)=>{if(r[3]!==antes)pos=i+1;antes=r[3];return{r,pos};});}
