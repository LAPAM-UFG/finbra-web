/** Resumos prontos: índices pequenos por UF e trechos gzip com hash, sem motor SQL. */
import { USAR_MOTOR } from './clima_abertura';
import { BASE_DADOS, obterManifesto, versaoDoManifesto, type ManifestoBruto } from './manifesto';
import { CURADORIA } from './munic_curadoria';
import { COD_UF, edicoesCuradas, lerEscolhas, paresPedidos, selecionar } from './munic_painel';
import { disponibilidadePerfis, escopoDoPerfil } from './trabalho_perfis';
import type { Params } from './api';
import { avisarEtapa } from './consulta_estado';
import { t } from './idioma';
let etapaRemuneracao=-1;

type Ref={caminho:string;bytes:number;sha256:string;gzip?:boolean};
type Tabela={colunas:string[];linhas:unknown[][]};
type Linha=Record<string,unknown>;
type Indices=Record<string,Ref>;
type Indice={versao:1;arquivo:Ref;grupos:Record<string,[number,number,string]>};
type Bloco={compatibilidade:unknown};
type Raiz={versao:1;catalogo:Bloco&{arquivo:Ref};
 remuneracao?:Bloco&{anos:Record<string,Indices>;fatores:Record<string,number>;base_ipca:number;modelos_sql?:Record<string,string>};
 trabalho:Bloco&{historico:Indices;anos:Record<string,Indices>};
 gestao:Bloco&{curadoria_sha256:string;territorios:Ref;respostas:Indices;agregados:Indices};
 fiscal:Bloco&{campos:string[];pares?:string[];pacotes:Indices}};
type Dep={manifesto:()=>Promise<ManifestoBruto>;base:string;buscar:typeof fetch};
const ROTAS=new Set(['entes','trab_remuneracao','trab_serie','trab_caged','trab_setores','trab_perfis','munic_territorios','munic_painel','agregado','cobertura']);
const UFS=new Set(Object.keys(COD_UF));
const UF_COD=new Map(Object.entries(COD_UF).map(([uf,cod])=>[String(cod),uf]));
const canonico=(x:unknown):unknown=>Array.isArray(x)?x.map(canonico):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonico((x as Record<string,unknown>)[k])])):x;
const igual=(a:unknown,b:unknown)=>JSON.stringify(canonico(a))===JSON.stringify(canonico(b));
const sha=async(b:BufferSource)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
const int=(x:unknown)=>x===undefined||x===null||x===''?null:Number.parseInt(String(x),10);
function compat(m:ManifestoBruto,keys:string[],ipca=false){return {gerado_em:m.gerado_em,fontes:Object.fromEntries(keys.map(k=>[k,m.fontes?.[k]??null])),...(ipca?{base_ipca:m.base_ipca,ipca:m.fontes?.ipca??null}:{})};}
function bucket(chave:string){const cod=chave.split(':').at(-1)!;return /^\d+$/.test(cod)?cod.length===7?UF_COD.get(cod.slice(0,2))??'governos':'governos':'grupos';}
function validarRef(r:Ref){if(!r||!/^gold\/abertura\/[A-Za-z0-9_.-]+$/.test(r.caminho)||!Number.isSafeInteger(r.bytes)||r.bytes<1||!/^[a-f0-9]{64}$/.test(r.sha256))throw new Error('Objeto de abertura inválido');}
async function json(b:ArrayBuffer,gzip=false){const dados=gzip?await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():b;return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(dados));}
function linhas(t:Tabela):Linha[]{
 if(!t||!Array.isArray(t.colunas)||!Array.isArray(t.linhas)||new Set(t.colunas).size!==t.colunas.length||t.colunas.some(c=>typeof c!=='string'))throw new Error('Tabela de abertura inválida');
 return t.linhas.map(r=>{if(!Array.isArray(r)||r.length!==t.colunas.length||r.some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)))throw new Error('Linha de abertura inválida');return Object.fromEntries(t.colunas.map((c,i)=>[c,r[i]]));});
}

export function criarAberturaPaineis(dep:Dep){
 let raiz:Promise<Raiz|null>|undefined;
 const cache=new Map<string,Promise<unknown>>();
 function guardar<T>(key:string,fn:()=>Promise<T>):Promise<T>{let p=cache.get(key) as Promise<T>|undefined;if(!p){p=fn();cache.set(key,p);p.catch(()=>cache.delete(key));}return p;}
 function obter(){return raiz??=(async()=>{const r=await dep.buscar(dep.base+'gold/abertura/manifesto.json',{cache:'no-cache'});if(!r.ok)return null;const x=await r.json() as Raiz;return x.versao===1?x:null;})().catch(()=>{raiz=undefined;return null;});}
 async function ler<T>(ref:Ref):Promise<T>{validarRef(ref);return guardar(ref.caminho,async()=>{const r=await dep.buscar(dep.base+ref.caminho);if(!r.ok)throw new Error('Índice indisponível');const b=await r.arrayBuffer();if(b.byteLength!==ref.bytes||await sha(b)!==ref.sha256)throw new Error('Índice incompleto');return json(b,ref.gzip);});}
 async function parte(indices:Indices,chave:string):Promise<Record<string,Tabela>|null>{
  const ref=indices[bucket(chave)];if(!ref)throw new Error('Catálogo de recortes indisponível');
  const i=await ler<Indice>(ref);if(i.versao!==1||!i.grupos)throw new Error('Formato de índice inválido');
  const pos=i.grupos[chave];if(!pos)return null;
  validarRef(i.arquivo);const [inicio,size,digest]=pos;
  if(!Number.isSafeInteger(inicio)||inicio<0||!Number.isSafeInteger(size)||size<1||inicio+size>i.arquivo.bytes||!/^[a-f0-9]{64}$/.test(digest))throw new Error('Trecho inválido');
  return guardar(i.arquivo.caminho+':'+chave,async()=>{
   const r=await dep.buscar(dep.base+i.arquivo.caminho,{headers:{Range:`bytes=${inicio}-${inicio+size-1}`}});
   if(r.status!==206||r.headers.get('Content-Range')!==`bytes ${inicio}-${inicio+size-1}/${i.arquivo.bytes}`){await r.body?.cancel();throw new Error('Range indisponível');}
   const b=await r.arrayBuffer();if(b.byteLength!==size||await sha(b)!==digest)throw new Error('Trecho incompleto');
   const p=await json(b,true);if(p.chave!==chave||!p.dados)throw new Error('Trecho de outro recorte');return p.dados;
  });
 }
 async function cadastro(r:Raiz,m:ManifestoBruto){if(!igual(r.catalogo?.compatibilidade,compat(m,['siconfi'])))throw new Error('Cadastro atualizado');return ler<{entes:[number,string,string,string,boolean][];todos:[number,string,string][]}>(r.catalogo.arquivo);}
 async function fiscalScope(r:Raiz,m:ManifestoBruto,q:Params){
  const cat=await cadastro(r,m),ente=int(q.ente),esfera=['M','E','D'].includes(String(q.esfera))?String(q.esfera):'M';
  if(ente&&cat.todos.some(e=>e[0]===ente))return 'ente:'+ente;
  const uf=UFS.has(String(q.uf))?String(q.uf):'BR';
  if(uf==='DF'&&esfera==='M')return 'ente:53';
  return esfera+':'+uf;
 }
 async function gestao(r:Raiz,m:ManifestoBruto,c:string,q:Params){
  const a=r.gestao;if(!igual(a?.compatibilidade,compat(m,['munic','estadic','munic_painel'])))return USAR_MOTOR;
  const hash=await guardar('curadoria',()=>sha(new TextEncoder().encode(JSON.stringify(canonico(CURADORIA)))));
  if(hash!==a.curadoria_sha256)return USAR_MOTOR;
  const cat=await ler<{cadastro:Tabela;lugares:Record<string,Tabela>;edicoes:Record<string,number>}>(a.territorios);
  if(c==='munic_territorios'){
   const p=q.pesquisa==='estadic'?'estadic':'munic';if(Number(q.ano)!==cat.edicoes[p]||q.faixa)return USAR_MOTOR;
   return linhas(cat.lugares[p]).filter(x=>!q.uf||x.uf===q.uf);
  }
  const sp=new URLSearchParams();for(const [p,k] of [['pesq','pesquisa'],['ano','ano'],['uf','uf'],['cod','cod']])if(q[k]!==undefined&&q[k]!==null&&q[k]!=='')sp.set(p,String(q[k]));
  const esc=lerEscolhas(sp,edicoesCuradas(CURADORIA));if(!esc.ok)return USAR_MOTOR;
  const pares=paresPedidos(selecionar(CURADORIA,esc.pesquisa,esc.modo));
  const vazio={agregados:[],respostas:[],universo:[],territorio:null};if(!pares.size)return vazio;
  let territorio:Linha|null=null,uf=esc.escopo.tipo==='uf'?esc.escopo.uf:'';
  if(esc.escopo.tipo==='territorio'){
   const codigo=esc.escopo.cod;
   territorio=linhas(cat.cadastro).find(x=>x.pesquisa===esc.pesquisa&&Number(x.cod)===codigo)??null;
   if(!territorio)return vazio;
   const {pesquisa:_,...visivel}=territorio;territorio=visivel;
   if(esc.pesquisa==='munic')uf=String(territorio.uf);
  }
  const p=await parte(a.agregados,esc.pesquisa+':'+(uf||'BR'));if(!p)return USAR_MOTOR;
  const filtrar=(x:Linha)=>pares.get(Number(x.ano))?.includes(String(x.var))??false;
  let respostas:Linha[]=[];
  if(esc.escopo.tipo==='territorio'){
   const resp=await parte(a.respostas,esc.pesquisa+':'+esc.escopo.cod);if(resp)respostas=linhas(resp.respostas).filter(filtrar);
  }
  return {agregados:linhas(p.agregados).filter(filtrar),respostas,universo:linhas(p.universo).filter(x=>pares.has(Number(x.ano))),territorio};
 }
 async function executar(c:string,q:Params={}):Promise<unknown>{
  if(!ROTAS.has(c))return USAR_MOTOR;
  const etapa=c==='trab_remuneracao'?etapaRemuneracao--:null;
  if(etapa!==null)avisarEtapa(etapa,t('Conferindo as estatísticas prontas da RAIS…','Checking prepared RAIS statistics…'));
  try {
   const [r,m]=await Promise.all([obter(),dep.manifesto()]);if(!r)return USAR_MOTOR;
   if(c==='entes'){const cat=await cadastro(r,m);return cat.entes.map(([cod_ibge,nome,uf,esfera,capital])=>({cod_ibge,nome,uf,esfera,capital}));}
   if(c.startsWith('munic_'))return await gestao(r,m,c,q);
   if(c==='trab_remuneracao') {
    const a=r.remuneracao,ano=int(q.ano),dim=String(q.agrupar??'sexo');
    const permitidos=new Set(['ente','uf','ano','situacao','agrupar','limite']);
    if(!a||!ano||!['sexo','raca_cor','escolaridade','faixa_idade'].includes(dim)||q.situacao!=='ativos'||Object.entries(q).some(([k,v])=>v!==''&&v!==null&&v!==undefined&&!permitidos.has(k))||!igual(a.compatibilidade,compat(m,['rais_micro'],true)))return USAR_MOTOR;
    const ente=int(q.ente),uf=UFS.has(String(q.uf))?String(q.uf):null;
    if(!ente&&!uf)return USAR_MOTOR;
    const g=ente?'ente:'+String(ente===53?5300108:ente):'uf:'+uf;
    if(etapa!==null)avisarEtapa(etapa,t('Lendo somente as estatísticas deste território…','Reading only this territory’s statistics…'));
    const raw=await parte(a.anos[String(ano)],g);
    const p=raw as unknown as {ano:number;dimensoes:Record<string,Linha[]>}|null;
    if(!p||p.ano!==ano||!p.dimensoes)return USAR_MOTOR;
    const linhas=p.dimensoes[dim];
    if(!Array.isArray(linhas))return USAR_MOTOR;
    if(etapa!==null)avisarEtapa(etapa,t('Conferindo médias, medianas e percentis…','Checking means, medians and percentiles…'));
    const codigo=ente?(ente===53?5300108:ente):null;
    const codUf=codigo?Math.floor(codigo/100000):COD_UF[uf!];
    const arquivo=dep.base+'v/'+versaoDoManifesto(m)+'1/'+`silver/trabalho/micro/rais_vinculos/ano=${ano}/uf=${codUf}.parquet`;
    const sql=a.modelos_sql?.[dim]?.replace('{arquivo}',arquivo.replace(/'/g,"''")).replace('{recorte}',codigo?`AND municipio=${Math.floor(codigo/10)}`:'');
    const limite=Math.min(Math.max(int(q.limite)??3000,1),200000);
    return {fonte:'micro',linhas:linhas.slice(0,limite).map(r=>({...r,grupos_total:linhas.length})),ano,base_ipca:a.base_ipca,fator_real:a.fatores[String(ano)]??null,preparado:true,sql};
   }
   if(c.startsWith('trab_')){
    const a=r.trabalho;if(!igual(a?.compatibilidade,compat(m,['rais','caged','rais_perfis'],true)))return USAR_MOTOR;
    if(Object.keys(q).some(k=>!['ente','uf','ano'].includes(k)))return USAR_MOTOR;
    const ente=int(q.ente),uf=UFS.has(String(q.uf))?String(q.uf):'BR',g=ente?String(ente===53?5300108:ente):uf;
    const historico=c==='trab_serie'||c==='trab_caged';
    const ano=int(q.ano);
    if(c==='trab_perfis'&&(!disponibilidadePerfis(m.fontes?.rais_perfis,ano).ok||!escopoDoPerfil(q)))return USAR_MOTOR;
    const indices=historico?a.historico:a.anos[String(ano)];if(!indices)return USAR_MOTOR;
    const p=await parte(indices,g);return p===null?[]:p[c]?linhas(p[c]):USAR_MOTOR;
   }
   const a=r.fiscal;if(!igual(a?.compatibilidade,compat(m,['siconfi','populacao_declarada'],true))||q.tratamento==='declarado')return USAR_MOTOR;
    if(Object.keys(q).some(k=>!['ente','uf','ano','esfera','tratamento','por','campos','dominio','pares'].includes(k)))return USAR_MOTOR;
    const pares=String(q.pares??'').split(',').filter(Boolean);
    if(pares.some(p=>!a.pares?.includes(p)))return USAR_MOTOR;
   const g=await fiscalScope(r,m,q),p=await parte(a.pacotes,g);if(!p)return USAR_MOTOR;
   const ano=int(q.ano);
   if(c==='cobertura'){
    if(g.startsWith('ente:'))return linhas(p.cobertura);
    const dominio=['receita','despesa','patrimonio'].includes(String(q.dominio))?String(q.dominio):'receita';
    const porDominio=p.cobertura as unknown as Record<string,Tabela>;return porDominio[dominio]?linhas(porDominio[dominio]).filter(x=>!ano||Number(x.exercicio)===ano):[];
   }
   if(String(q.por??'exercicio')!=='exercicio')return USAR_MOTOR;
   const campos=String(q.campos??'').split(',').filter(Boolean);if(!campos.length||campos.some(c=>!a.campos.includes(c)))return USAR_MOTOR;
    const nomes=['exercicio',...campos.flatMap(c=>[c,c+'_real','populacao_'+c,'entes_'+c]),...pares.flatMap(p=>{const[a,b]=p.split('/');return['num','den','entes'].map(s=>`${a}__${b}_${s}`)}),'populacao','entes'];
   return linhas(p.agregado).filter(x=>!ano||Number(x.exercicio)===ano).map(x=>Object.fromEntries(nomes.map(n=>{if(!(n in x))throw new Error('Coluna ausente');return [n,x[n]];})));
  } catch {return USAR_MOTOR;} finally {if(etapa!==null)avisarEtapa(etapa,null);}
 }
 return {executar};
}

const abertura=criarAberturaPaineis({manifesto:()=>obterManifesto(s=>`Manifesto indisponível (${s})`),base:BASE_DADOS,buscar:(...a)=>fetch(...a)});
export const executarAberturaPaineis=abertura.executar;
