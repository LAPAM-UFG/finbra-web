/** SIOPE pronto por recorte; falhas ou atualização da fonte retornam ao motor. */
import { BASE_DADOS, obterManifesto, type ManifestoBruto } from './manifesto';
import { obterMetaEducacao, lerObjetoEducacao, ufMunicipioEducacao, type MetaEducacao, type ObjetoEducacao, type TrechoEducacao } from './educacao_dados';
import { USAR_MOTOR } from './clima_abertura';
import type { Meta, Params, Linha, Ente } from './api';

type Pacote={g:string;se:unknown[][];rem:unknown[][];cats:unknown[][];cobertura:unknown[][]};
type Indice={versao:1;meta:Meta;compatibilidade:unknown;arquivo:ObjetoEducacao;entes:ObjetoEducacao;grupos:Record<string,TrechoEducacao>;municipios:Record<string,ObjetoEducacao>;colunas:Record<string,string[]>};
type Dep={educacao:()=>Promise<MetaEducacao>;manifesto:()=>Promise<ManifestoBruto>;ler:<T>(ref:ObjetoEducacao)=>Promise<T>;buscar:typeof fetch};
const ROTAS=new Set(['meta','entes','serie','grupo','tabela','rem_resumo','rem_categorias','cobertura']);
const prefixo='educacao_fin_';
const canonico=(v:unknown):unknown=>Array.isArray(v)?v.map(canonico):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonico(x)])):v;
const igual=(a:unknown,b:unknown)=>JSON.stringify(canonico(a))===JSON.stringify(canonico(b));
const sha=async(b:ArrayBuffer)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');

export function criarLeitorFinanceiro(dep:Dep) {
  let indice:Promise<Indice|null>|undefined;
  const cache=new Map<string,Promise<unknown>>();
  function guardar<T>(key:string,fn:()=>Promise<T>):Promise<T>{let p=cache.get(key) as Promise<T>|undefined;if(!p){p=fn();cache.set(key,p);p.catch(()=>cache.delete(key));}return p;}
  function obterIndice(){return indice??=(async()=>{
    const [e,m]=await Promise.all([dep.educacao(),dep.manifesto()]);if(!e.financeiro)return null;
    const i=await dep.ler<Indice>(e.financeiro);
    const esperado={siope:m.fontes?.siope,ipca:m.fontes?.ipca,base_ipca:m.base_ipca};
    if(i.versao!==1||!igual(i.compatibilidade,esperado))return null;
    if(!i.colunas||!i.grupos||!i.municipios||!i.meta||!i.arquivo)throw new Error('Pacote SIOPE incompleto');
    return {...i,meta:{...i.meta,geradoEm:m.gerado_em}};
  })().catch(e=>{indice=undefined;throw e;});}
  function grupo(q:Params){return q.ente?`ente:${q.ente}`:`${q.esfera==='E'?'E':'M'}:${q.esfera==='E'?'BR':q.uf||'BR'}`;}
  async function referencia(i:Indice,g:string):Promise<TrechoEducacao|undefined>{
    if(i.grupos[g])return i.grupos[g];
    const cod=g.startsWith('ente:')?g.slice(5):'';
    if(!/^\d{7}$/.test(cod))return undefined;
    const uf=ufMunicipioEducacao(cod);
    const ref=uf?i.municipios[uf]:undefined;if(!ref)return undefined;
    const catalogo=await guardar('uf:'+uf,()=>dep.ler<Record<string,TrechoEducacao>>(ref));return catalogo[g];
  }
  async function trecho(i:Indice,g:string):Promise<Pacote|{g:string;rows:unknown[][]}|null>{
    return guardar('grupo:'+g,async()=>{
      const pos=await referencia(i,g);if(!pos)return null;
      const [start,size,digest]=pos;
      if(!Number.isSafeInteger(start)||start<0||!Number.isSafeInteger(size)||size<1||start+size>i.arquivo.bytes||!/^[a-f0-9]{64}$/.test(digest))throw new Error('Trecho SIOPE inválido');
      const r=await dep.buscar(BASE_DADOS+i.arquivo.caminho,{headers:{Range:`bytes=${start}-${start+size-1}`}});
      if(r.status!==206||r.headers.get('Content-Range')!==`bytes ${start}-${start+size-1}/${i.arquivo.bytes}`){await r.body?.cancel();throw new Error('Trecho SIOPE indisponível');}
      const b=await r.arrayBuffer();if(b.byteLength!==size||await sha(b)!==digest)throw new Error('Trecho SIOPE incompleto');
      const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));if(obj.g!==g)throw new Error('Dados de outro governo');return obj;
    });
  }
  function linhas(i:Indice,tipo:string,rows:unknown[][]):Linha[]{
    const names=i.colunas[tipo];if(!names||!Array.isArray(rows)||rows.some(r=>!Array.isArray(r)||r.length!==names.length))throw new Error('Série SIOPE inválida');
    return rows.map(r=>Object.fromEntries(names.map((k,n)=>[k,r[n]])) as Linha);
  }
  async function executar(caminho:string,q:Params={}):Promise<unknown>{
    if(!caminho.startsWith(prefixo)||!ROTAS.has(caminho.slice(prefixo.length)))return USAR_MOTOR;
    try {
      const i=await obterIndice();if(!i)return USAR_MOTOR;
      const rota=caminho.slice(prefixo.length);
      if(rota==='meta')return i.meta;
      if(rota==='entes'){const rows=await guardar('entes',()=>dep.ler<[number,string,string,Ente['esfera'],boolean][]>(i.entes));return rows.map(([cod_ibge,nome,uf,esfera,capital])=>({cod_ibge,nome,uf,esfera,capital}));}
      const g=grupo(q);
      if(rota==='tabela'){const p=await trecho(i,`tabela:${g}:${q.ano}`);return p&&'rows'in p?linhas(i,'tabela',p.rows):[];}
      const p=await trecho(i,g);if(!p||!('se'in p))return [];
      if(rota==='serie'||rota==='grupo')return linhas(i,rota==='serie'?'se':'grupo',p.se);
      if(rota==='cobertura')return linhas(i,'cobertura',p.cobertura);
      if(rota==='rem_resumo')return linhas(i,'rem',p.rem);
      return linhas(i,q.ente?'cats_ente':'cats_grupo',p.cats).filter(x=>x.ano===Number(q.ano)).map(({ano,...row})=>row);
    } catch {return USAR_MOTOR;}
  }
  return {executar};
}
const leitor=criarLeitorFinanceiro({educacao:()=>obterMetaEducacao(),manifesto:()=>obterManifesto(s=>`Manifesto indisponível (${s})`),ler:lerObjetoEducacao,buscar:(...args)=>fetch(...args)});
export const executarInicialEducacaoFinanceira=leitor.executar;
const FALLBACK:Record<string,string>={meta:'meta',entes:'entes',serie:'se_ente',grupo:'se_grupo',tabela:'se_entes',rem_resumo:'rem_resumo',rem_categorias:'rem_categorias',cobertura:'educacao_fin_cobertura'};
export const fallbackEducacaoFinanceira=(caminho:string)=>caminho.startsWith(prefixo)?FALLBACK[caminho.slice(prefixo.length)]??caminho:caminho;
