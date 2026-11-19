import { BASE_DADOS } from './manifesto';
import { idioma, local, t } from './idioma';
import { reaisExato } from './format';
import { condicaoComparacao, formatoComparacao, normComparacao, serieEfetivaComparacao, textoComparacao } from './comparacoes_apresentacao';
import { obterGrupoComparacao, type AreaComparacao, type CatalogoComparacao, type DefComparacao, type GeografiaComparacao, type ObjetoComparacao, type SerieComparacao } from './comparacoes_dados';
import { compararReferencia, type AnoReferencia, type BaseReferencia } from './assistencia_referencias';

export const AREAS_RAIO: { id:AreaComparacao; nome:string; en:string; caminho:string }[] = [
  {id:'financas',nome:'População e finanças',en:'Population and finances',caminho:'/comparar'},
  {id:'trabalho',nome:'Mercado de trabalho',en:'Labour market',caminho:'/trabalho/comparar'},
  {id:'saude',nome:'Saúde',en:'Health',caminho:'/datasus/comparar'},
  {id:'educacao',nome:'Educação',en:'Education',caminho:'/educacao/comparar'},
  {id:'saneamento',nome:'Saneamento',en:'Sanitation',caminho:'/saneamento/comparar'},
  {id:'assistencia',nome:'Assistência social',en:'Social assistance',caminho:'/assistencia/comparar'},
  {id:'gestao',nome:'Gestão pública',en:'Public management',caminho:'/munic/comparar'},
  {id:'clima',nome:'Clima',en:'Climate',caminho:'/clima/comparar'},
  {id:'mobilidade',nome:'Mobilidade e trânsito',en:'Mobility and traffic',caminho:'/mobilidade/comparar'},
  {id:'agropecuaria',nome:'Agropecuária',en:'Agriculture and livestock',caminho:'/agropecuaria/comparar'},
];
export const REDES_RAIO = ['todas','publica','municipal','estadual','federal','privada'] as const;
export const nomeRedeRaio = (r:string) => ({todas:t('Todas as redes','All networks'),publica:t('Pública','Public'),municipal:t('Municipal','Municipal'),estadual:t('Estadual','State'),federal:t('Federal','Federal'),privada:t('Privada','Private')})[r]??r;
export type IndicadorRaio = DefComparacao & {area:AreaComparacao;catalogo:string;indice:number;rede:string};
export const chaveRaio = (i:IndicadorRaio) => `${i.catalogo}:${i.id}`;
export type PontoRaio = [number,number|null,number|null,number|null,number,number,number|null,[number|null,number|null,number|null,number,number,number|null]?];
export type RetratoRaio = {versao:1;grupo:string;linhas:(PontoRaio|null)[];referencias:Record<string,[number|null,number|null,number|null]>};
type TrechoRaio = [number,number,string];
type ObjetoRaio = ObjetoComparacao & {json_sha256?:string;json_bytes?:number};
type IndiceRaio = {versao:1;arquivo:ObjetoComparacao;grupos:Record<string,TrechoRaio>};
export type MetaRaio = {versao:1;gerado_em:string;catalogo:ObjetoRaio;catalogo_json?:ObjetoComparacao;geografia:ObjetoRaio;geografia_json?:ObjetoComparacao;indices:Record<string,ObjetoComparacao>;anos:number[];territorios:number;indicadores:number};
export type CatalogoRaio = {versao:1;mobilidade?:{anos:number[];indices:Record<string,ObjetoComparacao>;indicadores:string[];edicao_sha256:string};agropecuaria?:{anos:number[];indices:Record<string,ObjetoComparacao>;indicadores:string[];edicao_sha256:string};indicadores:IndicadorRaio[];catalogos:Record<string,{area:AreaComparacao;rede:string;ref:ObjetoComparacao}>;referencias:{anos:number[];arquivo:ObjetoComparacao;grupos:Record<string,TrechoRaio>;indices_uf:Record<string,ObjetoComparacao>}};
export type SerieRaio = {periodos:number[];serie:SerieComparacao};
const hashValido=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const digest=async(b:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
const finito=(v:unknown)=>v===null||typeof v==='number'&&Number.isFinite(v);
function validarObjeto(o:ObjetoComparacao) {
  if(!o||!/^gold\/(raiox|comparacoes|assistencia|agropecuaria|mobilidade)\/[a-z0-9_]+\.(json(?:\.gz)?|ndjson)$/.test(o.caminho)||!hashValido(o.sha256)||!Number.isSafeInteger(o.bytes)||o.bytes<1)throw new Error(t('Referência territorial inválida.','Invalid territory reference.'));
}
export function validarPontoRaio(p:PontoRaio|null) {
  if(p===null)return;
  if(!Array.isArray(p)||![7,8].includes(p.length)||!Number.isInteger(p[0])||p[0]<1900||![p[1],p[2],p[3],p[6]].every(finito)||!Number.isInteger(p[4])||p[4]<0||p[4]>22||!Number.isSafeInteger(p[5])||p[5]<0)throw new Error('Observação territorial inválida.');
  if(p[7]) {const a=p[7];if(a.length!==6||![a[0],a[1],a[2],a[5]].every(finito)||!Number.isInteger(a[3])||a[3]<0||a[3]>22||!Number.isSafeInteger(a[4])||a[4]<0)throw new Error('Ressalva territorial inválida.');}
}

/** Leitura limitada ao território solicitado; respostas com o bundle completo são recusadas. */
export function criarLeitorRaio(buscar:typeof fetch=fetch,base=BASE_DADOS) {
  const cache=new Map<string,Promise<unknown>>();
  function memo<T>(k:string,f:()=>Promise<T>):Promise<T>{let p=cache.get(k) as Promise<T>|undefined;if(!p){p=f();cache.set(k,p);p.catch(()=>{if(cache.get(k)===p)cache.delete(k);});}return p;}
  async function objeto<T>(o:ObjetoRaio):Promise<T>{
    validarObjeto(o);if(!/\.json(?:\.gz)?$/.test(o.caminho)||o.bytes>12_000_000)throw new Error('Objeto excessivo para o retrato.');
    return memo(`${o.sha256}:${o.json_sha256??''}:${o.json_bytes??0}`,async()=>{const r=await buscar(base+o.caminho);if(!r.ok)throw new Error(t('Não foi possível carregar o arquivo do Raio X.','Could not load the X-ray file.'));let b=await r.arrayBuffer();if(b.byteLength!==o.bytes||await digest(b)!==o.sha256)throw new Error('Arquivo territorial incompleto.');
      if(o.caminho.endsWith('.gz')){
        if(!hashValido(o.json_sha256)||!Number.isSafeInteger(o.json_bytes)||o.json_bytes!<1||o.json_bytes!>12_000_000)throw new Error('Metadados comprimidos inválidos.');
        const reader=new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();const chunks:Uint8Array[]=[];let size=0;
        while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>o.json_bytes!){await reader.cancel();throw new Error('Metadados descompactados excessivos.');}chunks.push(x.value);}
        const result=new Uint8Array(size);let off=0;for(const x of chunks){result.set(x,off);off+=x.byteLength;}b=result.buffer;
        if(size!==o.json_bytes||await digest(b)!==o.json_sha256)throw new Error('Metadados descompactados incompletos.');
      }
      return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b)) as T;});
  }
  async function trecho<T>(o:ObjetoComparacao,tr:TrechoRaio):Promise<T>{
    validarObjeto(o);if(!tr||tr.length!==3||!Number.isSafeInteger(tr[0])||tr[0]<0||!Number.isSafeInteger(tr[1])||tr[1]<1||tr[1]>3_000_000||tr[0]+tr[1]>o.bytes||!hashValido(tr[2]))throw new Error('Recorte territorial inválido.');
    return memo(o.sha256+':'+tr.join(':'),async()=>{
      const r=await buscar(base+o.caminho,{headers:{Range:`bytes=${tr[0]}-${tr[0]+tr[1]-1}`}});
      if(r.status!==206||r.headers.get('Content-Range')!==`bytes ${tr[0]}-${tr[0]+tr[1]-1}/${o.bytes}`){await r.body?.cancel();throw new Error(t('O servidor não forneceu somente o território solicitado.','The server did not return the requested territory slice.'));}
      const b=await r.arrayBuffer();if(b.byteLength!==tr[1]||await digest(b)!==tr[2])throw new Error('Recorte territorial incompleto.');
      const s=new TextDecoder('utf-8',{fatal:true}).decode(b);if(!s.endsWith('\n')||s.trimEnd().includes('\n'))throw new Error('Retrato territorial truncado.');return JSON.parse(s) as T;
    });
  }
  const meta=()=>memo('manifesto',async()=>{let r=await buscar(base+'gold/raiox/v4_manifesto.json',{cache:'no-cache'});if(r.status===404)r=await buscar(base+'gold/raiox/v3_manifesto.json',{cache:'no-cache'});if(r.status===404)r=await buscar(base+'gold/raiox/v2_manifesto.json',{cache:'no-cache'});if(r.status===404)r=await buscar(base+'gold/raiox/manifesto.json',{cache:'no-cache'});if(!r.ok)throw new Error(t('O Raio X está temporariamente indisponível.','X-ray is temporarily unavailable.'));const m=await r.json() as MetaRaio;
    if(m.versao!==1||!m.indices?.referencias||!Array.isArray(m.anos)||!Number.isSafeInteger(m.indicadores)||m.indicadores<1)throw new Error('Catálogo territorial incompatível.');for(const o of [m.catalogo,m.geografia,...Object.values(m.indices)])validarObjeto(o);return m;});
  const catalogo=async(m:MetaRaio)=>{const c=await objeto<CatalogoRaio>(typeof DecompressionStream==='undefined'&&m.catalogo_json?m.catalogo_json:m.catalogo);if(c.versao!==1||c.indicadores?.length!==m.indicadores||new Set(c.indicadores.map(chaveRaio)).size!==m.indicadores||!c.catalogos||!c.referencias)throw new Error('Indicadores territoriais incompatíveis.');
    for(const i of c.indicadores)if(!AREAS_RAIO.some(a=>a.id===i.area)||!i.nome||!i.unidade||!Array.isArray(i.periodos)||i.periodos.some((p,k)=>!Number.isInteger(p)||(k>0&&p<=i.periodos[k-1])))throw new Error('Definição territorial inválida.');return c;};
  const geografia=async(m:MetaRaio)=>{const g=await objeto<GeografiaComparacao>(typeof DecompressionStream==='undefined'&&m.geografia_json?m.geografia_json:m.geografia);if(g.versao!==1||!g.municipios||!g.territorios?.BR||!g.governos)throw new Error('Cadastro territorial inválido.');return g;};
  const retrato=async(m:MetaRaio,g:GeografiaComparacao,grupo:string)=>{
    const ter=g.territorios[grupo];if(!ter||!['M','UF','BR'].includes(ter.nivel))throw new Error('Escolha um município, estado ou Brasil.');
    const idx=await objeto<IndiceRaio>(m.indices[ter.nivel==='M'?ter.uf!:'referencias']);const r=await trecho<RetratoRaio>(idx.arquivo,idx.grupos[grupo]);
    if(idx.versao!==1||r.versao!==1||r.grupo!==grupo||r.linhas?.length!==m.indicadores||!r.referencias)throw new Error('Retrato de outro território ou edição.');r.linhas.forEach(validarPontoRaio);return r;
  };
  return {meta,catalogo,geografia,retrato,objeto,trecho};
}
export const leitorRaio=criarLeitorRaio();
export const nomeAreaRaio=(id:string)=>{const a=AREAS_RAIO.find(a=>a.id===id);return a?t(a.nome,a.en):id;};
export function grupoOrigemRaio(g:GeografiaComparacao,grupo:string,i:IndicadorRaio) {
  return i.catalogo==='gestao_estadic'?(grupo.startsWith('E:')?grupo:grupo==='BR'?'E:BR':g.governos.find(x=>x[2]===grupo)?.[0]??null):grupo;
}
export function indicadoresRaio(c:CatalogoRaio,grupo:string,rede:string) {
  return c.indicadores.map((i,k)=>({i,k})).filter(({i})=>(i.area!=='educacao'||i.rede===rede)&&(i.catalogo!=='gestao_estadic'||!/^[0-9]{7}$/.test(grupo)));
}
export function pontoEfetivoRaio(p:PontoRaio|null,ressalvas:boolean):PontoRaio|null {
  if(!p)return null;const a=ressalvas&&p[7]?[p[0],...p[7]] as PontoRaio:[...p] as PontoRaio;
  return !ressalvas&&[8,18].includes(a[4])?[a[0],null,null,null,a[4],a[5],null]:a;
}
export function pontoDoAnoRaio(i:DefComparacao,s:SerieComparacao,ano:number):PontoRaio {
  const ks=i.periodos.map((p,k)=>({p,k})).filter(({p})=>(p>10000?Math.floor(p/100):p)===ano);
  if(!ks.length)return [ano,null,null,null,i.avaliacao?7:5,0,null];
  const obs=s.com_ressalvas??s;const candidatos=ks.filter(({k})=>obs.v[k]!==null||obs.r?.[k]!=null);
  const {p,k}=(candidatos.length?candidatos:ks).at(-1)!;
  const linha=(x:SerieComparacao):[number|null,number|null,number|null,number,number,number|null]=>[x.v[k],x.n[k],x.d[k],x.c[k],x.q[k],x.r?.[k]??null];
  const b=linha(s),alt=linha(obs);const ponto:PontoRaio=[p,...b];if(JSON.stringify(b)!==JSON.stringify(alt))ponto[7]=alt;return ponto;
}
function unidadeOriginalRaio(i:IndicadorRaio) {
  if(i.unidade_original===i.unidade)return textoComparacao(i,'unidade');
  const pt=i.unidade_original??'';
  const en:Record<string,string>={
    'vínculos':'jobs','matrículas':'enrolments','famílias':'families','pessoas':'people','domicílios':'households','economias atendidas':'served units',
    'entidades':'entities','escolas':'schools','estabelecimentos':'establishments','imóveis':'properties','ligações':'connections','número':'number','ocorrências':'occurrences','servidores':'employees','turmas':'classes','óbitos':'deaths',
    'vínculos docente–escola':'teacher–school jobs','vínculos por estabelecimento':'jobs per establishment','vínculos por mil habitantes':'jobs per 1,000 residents',
    'R$ nominais':'nominal R$','R$ de 2025 por habitante':'2025 R$ per resident','R$ de 2025 por internação':'2025 R$ per admission','dias por internação':'days per admission',
    'pontos na escala Saeb':'Saeb scale points','índice 0–10':'0–10 index','m³/ano':'m³/year','t/ano':'t/year',
    'por 10 mil habitantes':'per 10,000 residents','por 100 mil habitantes':'per 100,000 residents','por 100 mil hab. de 30 a 69 anos':'per 100,000 residents aged 30–69',
    'por 100 mil nascidos vivos':'per 100,000 live births','por mil nascidos vivos':'per 1,000 live births','por mil habitantes':'per 1,000 residents',
    'por mil habitantes de 60 anos ou mais':'per 1,000 residents aged 60+','por mil crianças de 0 a 4 anos':'per 1,000 children aged 0–4',
    'por 100 mulheres de 25 a 64 anos':'per 100 women aged 25–64','mamografias registradas por 100 mulheres de 50 a 69 anos':'recorded mammograms per 100 women aged 50–69',
    'mamografias registradas por 100 mulheres de 50 a 74 anos':'recorded mammograms per 100 women aged 50–74',
  };
  return t(pt,en[pt]??pt);
}
export function apresentacaoRaio(i:IndicadorRaio,p:PontoRaio|null,grupo:string,ressalvas=false) {
  const ponto=pontoEfetivoRaio(p,ressalvas);const valor=ponto?.[1]??null;
  const individual=/^\d{7}$/.test(grupo)||i.catalogo==='gestao_estadic'&&grupo!=='BR';
  let original=ponto?.[6]??null;
  // A soma do numerador só representa o original em indicadores explicitamente
  // divididos pela população. Valores monetários deflacionados mantêm sua unidade.
  if(original===null&&ponto&&i.fator===1000&&i.normalizacao.startsWith('Valor observado dividido pela população')&&i.unidade_original!=='R$'&&ponto[5]>0)original=ponto[2];
  const percentual=i.formato==='percentual'||i.unidade.includes('%');
  const originalValido=!!ponto&&[0,1,3,4,6,8,11,12,16,18,21,22].includes(ponto[4]);
  const somavel=i.fator===1000&&i.normalizacao.startsWith('Valor observado dividido pela população')&&i.unidade_original!=='R$';
  const usarOriginal=!percentual&&!i.binario&&!!i.nome_original&&!!i.unidade_original&&!/fração|fraction/i.test(i.unidade_original)&&(individual||original!==null||somavel);
  if(!originalValido)original=null;
  const n=usarOriginal?textoComparacao(i,'nome_original'):textoComparacao(i,'nome');
  const un=usarOriginal?unidadeOriginalRaio(i):textoComparacao(i,'unidade');
  return {nome:n,unidade:un,valor:usarOriginal?original:valor,comparavel:valor,original,individual,
    texto:i.binario&&individual?formatoComparacao(i,valor,true):usarOriginal&&un==='R$'?reaisExato(original):usarOriginal?(original===null?'—':original.toLocaleString(local(),{maximumFractionDigits:Number.isInteger(original)?0:2})):formatarRaio(i,valor),
    condicao:condicaoRaio(i,ponto),ponto};
}
function condicaoRaio(i:IndicadorRaio,p:PontoRaio|null) {
  if(!p)return t('Não se aplica a este recorte','Not applicable to this scope');
  if(i.catalogo==='referencias'&&p[1]===null){
    if(['rx_pib','rx_pib_hab'].includes(i.id)&&p[2]===null)return t('PIB indisponível neste ano na base','GDP unavailable for this year in this dataset');
    if(i.id==='rx_populacao')return t('População indisponível neste ano','Population unavailable for this year');
    if(i.id==='rx_massa_rais')return t('Massa salarial indisponível neste ano','Payroll unavailable for this year');
    if(p[4]===2)return t('Sem pagamentos informados','No reported payments');
    if(p[4]===11)return t('Pagamentos anuais incompletos','Incomplete yearly payments');
  }
  return condicaoComparacao(p[4]);
}
export const formatarRaio=(i:DefComparacao,v:number|null)=>i.id==='rx_populacao'?(v===null?'—':v.toLocaleString(local(),{maximumFractionDigits:0})):i.formato==='moeda'?reaisExato(v):formatoComparacao(i,v);
export function buscarIndicadorRaio(i:IndicadorRaio,termo:string) {
  const texto=normComparacao([i.id,i.nome,i.nome_en,i.nome_original,i.descricao,i.tema,i.fonte_nome].join(' '));
  const q=normComparacao(termo.trim());
  return texto.includes(q)||(/^(salario|salarios|salario medio|salarios medios|wages?)$/.test(q)&&texto.includes('remunera'))||(/^(emprego|empregos|jobs?)$/.test(q)&&i.area==='trabalho'&&texto.includes('vinculo'));
}
export function linkComparacaoRaio(i:IndicadorRaio,grupo:string,g:GeografiaComparacao,p?:number) {
  const ter=g.territorios[grupo];const sp=new URLSearchParams();if(ter.uf)sp.set('uf',ter.uf);if(ter.nivel==='M')sp.set('cod',grupo);
  if(p)sp.set('periodo',String(p));sp.set('indicador',i.id);
  if(['agropecuaria_original','mobilidade_original'].includes(i.catalogo)){sp.delete('periodo');sp.delete('indicador');sp.set('ind',i.id);if(p)sp.set('ano',String(p));return (i.catalogo==='mobilidade_original'?'/mobilidade?':'/agropecuaria?')+sp;}
  if(i.area==='educacao')sp.set('rede',i.rede);
  if(i.catalogo==='gestao_estadic')sp.set('pesq','estadic');
  if(i.catalogo==='assistencia_cadunico_historico')sp.set('conjunto','cadunico_historico');
  if(i.catalogo==='referencias'){
    if(i.id.startsWith('rx_pbf_')||i.id.startsWith('rx_bpc_')||i.id.startsWith('rx_total_')){const [,medida,base]=i.id.split('_');sp.delete('indicador');sp.delete('periodo');sp.set('medida',medida);sp.set('base_comparacao',base);if(p)sp.set('ano_comparacao',String(p));return '/assistencia/comparacoes-pagamentos?'+sp;}
    const extra=new URLSearchParams({...((ter.uf??grupo)!=='BR'?{uf:ter.uf??grupo}:{}),...(ter.nivel==='M'?{ente:grupo==='5300108'?'53':grupo}:{}),...(p?{ano:String(p)}:{})});
    return (i.id==='rx_massa_rais'?'/trabalho':'/socioeconomico')+'?'+extra;
  }
  return AREAS_RAIO.find(a=>a.id===i.area)!.caminho+'?'+sp;
}

const seriesCache=new Map<string,Promise<SerieRaio>>();
export function obterSerieRaio(c:CatalogoRaio,g:GeografiaComparacao,grupo:string,i:IndicadorRaio):Promise<SerieRaio> {
  const original=grupoOrigemRaio(g,grupo,i);if(!original)return Promise.reject(new Error(t('Indicador exclusivo de governos estaduais.','Indicator applies to state governments only.')));
  const chave=(i.catalogo==='mobilidade_original'?c.mobilidade?.edicao_sha256:i.catalogo==='agropecuaria_original'?c.agropecuaria?.edicao_sha256:i.catalogo==='referencias'?c.referencias.arquivo.sha256:c.catalogos[i.catalogo].ref.sha256)+':'+original+':'+i.indice;
  let p=seriesCache.get(chave);if(!p){p=(async()=>{
    if(['agropecuaria_original','mobilidade_original'].includes(i.catalogo)){
      const a=i.catalogo==='mobilidade_original'?c.mobilidade:c.agropecuaria;if(!a||a.indicadores[i.indice]!==i.id)throw new Error('Medida original de outra edição.');
      const ter=g.territorios[grupo];const idx=await leitorRaio.objeto<IndiceRaio>(a.indices[ter.nivel==='M'?ter.uf!:'referencias']);
      const x=await leitorRaio.trecho<{grupo:string;anos:number[];valores:(number|null)[][];condicoes:number[][]}>(idx.arquivo,idx.grupos[grupo]);
      if(x.grupo!==grupo||JSON.stringify(x.anos)!==JSON.stringify(a.anos)||x.valores.length!==a.anos.length||x.condicoes.length!==a.anos.length||x.valores.some(v=>v.length!==a.indicadores.length)||x.condicoes.some(v=>v.length!==a.indicadores.length))throw new Error('Série original incompleta.');
      const v=x.valores.map(r=>r[i.indice]);return{periodos:a.anos,serie:{v,n:v.map(()=>null),d:v.map(()=>null),r:v,c:x.condicoes.map((r,k)=>i.catalogo==='agropecuaria_original'&&ter.nivel!=='M'&&v[k]!==null?22:r[i.indice]),q:v.map(x=>Number(x!==null))}};
    }
    if(i.catalogo==='referencias'){
      const m=c.referencias;let tr=m.grupos[grupo];if(!tr){const uf=g.territorios[grupo]?.uf;if(uf&&m.indices_uf[uf])tr=(await leitorRaio.objeto<{grupos:Record<string,TrechoRaio>}>(m.indices_uf[uf])).grupos[grupo];}
      const s=await leitorRaio.trecho<{grupo:string;linhas:AnoReferencia[]}>(m.arquivo,tr);if(s.grupo!==grupo||s.linhas.length!==m.anos.length)throw new Error('Referência de outro território.');return {periodos:m.anos,serie:serieExtraRaio(s.linhas,i.id)};
    }
    const m=await leitorRaio.objeto<CatalogoComparacao>(c.catalogos[i.catalogo].ref);
    if(m.indicadores[i.indice]?.id!==i.id)throw new Error('Série de outro indicador.');const dados=await obterGrupoComparacao(m,g,original);return {periodos:m.indicadores[i.indice].periodos,serie:dados.dados[i.indice]};
  })();seriesCache.set(chave,p);p.catch(()=>{if(seriesCache.get(chave)===p)seriesCache.delete(chave);});}return p;
}
export function serieExtraRaio(linhas:AnoReferencia[],id:string):SerieComparacao {
  const s:SerieComparacao={v:[],n:[],d:[],c:[],q:[],r:[]};
  for(const l of linhas){let v:number|null=null,n:number|null=null,d:number|null=1,c=0;
    if(id==='rx_populacao')v=n=l[6];else if(id==='rx_pib')v=n=l[1];else if(id==='rx_massa_rais')v=n=l[7];
    else if(id==='rx_pib_hab'){n=l[1];d=l[6];v=n!==null&&d!==null&&d>0?n/d:null;}
    else {const [,prog,base]=id.split('_');const x=compararReferencia(l,prog as 'pbf'|'bpc'|'total',base as BaseReferencia);v=x.valor;n=x.pago;d=x.denominador;c=[0,2,11,3,4,9][x.condicao];}
    if(c===0&&v===null)c=3;if(v===0)c=1;s.v.push(v);s.n.push(n);s.d.push(d);s.c.push(c);s.q.push(v===null?0:1);s.r!.push(null);
  }return s;
}
export async function retratoDoAnoRaio(c:CatalogoRaio,g:GeografiaComparacao,r:RetratoRaio,ano:number,rede:string) {
  const linhas=r.linhas.map(()=>null as PontoRaio|null);const erros:Record<string,string>={};
  const escolhidos=indicadoresRaio(c,r.grupo,rede);const cats=[...new Set(escolhidos.map(x=>x.i.catalogo))];
  await Promise.all(cats.map(async cat=>{
    const itens=escolhidos.filter(x=>x.i.catalogo===cat);
    const resultados=await Promise.allSettled(itens.map(async({i})=>{const s=await obterSerieRaio(c,g,r.grupo,i);return pontoDoAnoRaio({...i,periodos:s.periodos},s.serie,ano);}));
    resultados.forEach((x,j)=>{if(x.status==='fulfilled')linhas[itens[j].k]=x.value;else erros[cat]=String(x.reason?.message??x.reason);});
  }));
  return {retrato:{...r,linhas},erros};
}

export function nomeTerritorioRaio(g:GeografiaComparacao,grupo:string) {
  const ter=g.territorios[grupo];if(!ter)return grupo;
  if(ter.nivel==='M')return `${ter.nome} (${ter.uf})${grupo==='2605459'?t(' · distrito estadual',' · state district'):''}`;
  if(grupo==='BR')return t('Brasil','Brazil');return g.governos.find(x=>x[2]===grupo)?.[1]??grupo;
}
export const nomeIndicadorRaio=(i:IndicadorRaio)=>textoComparacao(i,'nome');
export const efetivarSerieRaio=serieEfetivaComparacao;
export const idiomaRaio=()=>idioma();
