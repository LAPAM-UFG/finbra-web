/** Consultas da IA aos pacotes preparados: mesmas medidas, condições e períodos dos painéis. */
import { BASE_DADOS } from './manifesto';
import type { Resultado } from './ia';
import type { GeografiaComparacao } from './comparacoes_dados';
import { condicaoComparacao, ranquearComparacao } from './comparacoes_apresentacao';
import { t } from './idioma';

export const TEMAS_PREPARADOS = ['agropecuaria','mobilidade','seguranca','internet','energia','comex'] as const;
export type TemaPreparado = typeof TEMAS_PREPARADOS[number];
export type PedidoPainel = {
  tema:TemaPreparado; operacao:'catalogo'|'territorios'|'serie'|'ranking'; busca?:string;
  indicadores?:string[]; territorios?:string[]; anos?:number[]; uf?:string;
  nivel?:'M'|'UF'|'imediata'|'intermediaria'; ordem?:'asc'|'desc'; limite?:number; offset?:number;
  objetivo?:string; substitui?:string;
};
type Indicador = {id:string;nome:string;nome_en?:string;descricao?:string;descricao_en?:string;unidade:string;anos?:number[];periodos?:number[];familia?:string;tema?:string;fonte_nome?:string;fonte_url?:string;numerador_id?:string;denominador_id?:string;fator?:number;denominador_potencia?:number;tipo_periodo?:string;notas_anos?:Record<string,[string,string]>};
type Catalogo = {anos:number[];indicadores:Indicador[];derivados?:Indicador[];condicoes:Record<string,string>};
type Grupo = {anos:number[];valores:(number|null)[][];condicoes:number[][];derivados?:(number|null)[][];condicoes_derivados?:number[][];numeradores?:(number|null)[][];denominadores?:(number|null)[][];coberturas?:number[][]};
type Pacote = {m:{gerado_em?:string;notas?:string[];datas?:Record<string,string>};c:Catalogo;g:GeografiaComparacao;grupo:(id:string)=>Promise<Grupo>};
export type DependenciasPainel = {pacote:(tema:TemaPreparado)=>Promise<Pacote>};
const normalizar=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const isTema=(x:unknown):x is TemaPreparado=>typeof x==='string'&&(TEMAS_PREPARADOS as readonly string[]).includes(x);

export function lerPedidoPainel(entrada:unknown):PedidoPainel {
  if(!entrada||typeof entrada!=='object'||Array.isArray(entrada))throw Error('Pedido de painel inválido.');
  const p=entrada as Record<string,unknown>;
  const permitidos=['tema','operacao','busca','indicadores','territorios','anos','uf','nivel','ordem','limite','offset','objetivo','substitui'];
  if(Object.keys(p).some(k=>!permitidos.includes(k))||!isTema(p.tema)||!['catalogo','territorios','serie','ranking'].includes(String(p.operacao)))throw Error('Tema ou operação indisponível.');
  for(const k of ['busca','objetivo','substitui'])if(p[k]!==undefined&&(typeof p[k]!=='string'||p[k].length>(k==='objetivo'?500:180)))throw Error('Texto de consulta inválido.');
  for(const [k,max]of [['indicadores',12],['territorios',8]]as const)if(p[k]!==undefined&&(!Array.isArray(p[k])||p[k].length>max||p[k].some(x=>typeof x!=='string'||!(k==='indicadores'?/^[a-z][a-z0-9_]{0,99}$/:/^(BR|[A-Z]{2}|\d{7}|[IT]:\d{4,7})$/).test(x))))throw Error('Indicadores ou territórios inválidos.');
  if(p.anos!==undefined&&(!Array.isArray(p.anos)||p.anos.length>40||p.anos.some(x=>!Number.isInteger(x)||Number(x)<1900||Number(x)>2100)))throw Error('Anos inválidos.');
  if(p.uf!==undefined&&(typeof p.uf!=='string'||!(/^(BR|AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)$/).test(p.uf)))throw Error('UF inválida.');
  if(p.nivel!==undefined&&!['M','UF','imediata','intermediaria'].includes(String(p.nivel)))throw Error('Nível territorial inválido.');
  if(p.ordem!==undefined&&!['asc','desc'].includes(String(p.ordem)))throw Error('Ordem inválida.');
  for(const k of ['limite','offset'])if(p[k]!==undefined&&(!Number.isSafeInteger(p[k])||Number(p[k])<(k==='limite'?1:0)||Number(p[k])>200000))throw Error('Limite inválido.');
  return p as PedidoPainel;
}

/** Descrição estável do pedido para histórico, auditoria e reuso; não é SQL executável. */
export function entradaConsultaPainel(entrada:unknown) {
  let p:Record<string,unknown>;
  try{p=lerPedidoPainel(entrada)as unknown as Record<string,unknown>;}catch{p={pedido_invalido:entrada};}
  const chave=JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k])=>!['objetivo','substitui'].includes(k)).sort(([a],[b])=>a.localeCompare(b))));
  // A unidade pertence a cada linha. O nome genérico "valor" não implica reais.
  const colunas=[['valor',t('Valor','Value')],['numerador',t('Numerador','Numerator')],['denominador',t('Denominador','Denominator')]].map(([nome,rotulo])=>({nome,rotulo,unidade:'numero'}));
  return {sql:`-- Painel preparado: ${chave}`,preparado:entrada,colunas,objetivo:String(p.objetivo??'Consultar os dados preparados do painel'),substitui:String(p.substitui??'')};
}

async function pacote(tema:TemaPreparado):Promise<Pacote> {
  switch(tema){
    case'agropecuaria':{const a=await import('./agropecuaria_dados');return{...await a.obterMetaAgro(),grupo:a.obterGrupoAgro}as Pacote;}
    case'mobilidade':{const a=await import('./mobilidade_dados');return{...await a.obterMetaMob(),grupo:a.obterGrupoMob}as Pacote;}
    case'seguranca':{const a=await import('./seguranca_dados');return{...await a.obterMetaSeg(),grupo:a.obterGrupoSeg}as Pacote;}
    case'internet':{const a=await import('./internet_dados');return{...await a.obterMetaInt(),grupo:a.obterGrupoInt}as Pacote;}
    case'energia':{const a=await import('./energia_dados');return{...await a.obterMetaEne(),grupo:a.obterGrupoEne}as Pacote;}
    case'comex':{const a=await import('./comex_dados');return{...await a.obterMetaComex(),grupo:a.obterGrupoComex}as Pacote;}
  }
}
const fontes:Record<TemaPreparado,string>={agropecuaria:'IBGE · PAM/PPM/PEVS',mobilidade:'Senatran / SIM',seguranca:'SIM / Sinesp',internet:'Anatel',energia:'ANEEL',comex:'MDIC/Secex · Comex Stat'};
export function pedidoDaConsultaPainel(descricao:string):PedidoPainel|null {
  const prefixo='-- Painel preparado: ';if(!descricao.startsWith(prefixo))return null;
  try{return lerPedidoPainel(JSON.parse(descricao.slice(prefixo.length)));}catch{return null;}
}
export const fonteDaConsultaPainel=(descricao:string)=>{const p=pedidoDaConsultaPainel(descricao);return p?fontes[p.tema]:null;};
const abortar=(s?:AbortSignal)=>{if(s?.aborted)throw new DOMException('Consulta cancelada','AbortError');};

export async function executarPainelPreparado(entrada:unknown,paineis:readonly string[],sinal?:AbortSignal,limite=2000,dep:DependenciasPainel={pacote}):Promise<Resultado> {
 try{
  abortar(sinal);const p=lerPedidoPainel(entrada);if(!paineis.includes(p.tema))return{erro:'Este tema não está incluído na conversa.',bloqueada:true};
  const {m,c,g,grupo}=await dep.pacote(p.tema);abortar(sinal);
  const defs=[...c.indicadores.map((i,j)=>({i,j,calculado:false})),...(c.derivados??[]).map((i,j)=>({i,j,calculado:true}))];
  const selecionar=(cols:string[],linhas:(string|number|boolean|null)[][]):Resultado=>({colunas:cols,linhas:linhas.slice(0,limite),total:linhas.length});
  if(p.operacao==='catalogo'){
    const busca=normalizar(p.busca??'');let lista=defs.filter(d=>normalizar([d.i.id,d.i.nome,d.i.familia,d.i.tema,d.i.descricao].join(' ')).includes(busca));
    lista=lista.slice(p.offset??0,p.limite===undefined?undefined:(p.offset??0)+p.limite);
    return selecionar(['indicador','nome','unidade','comparavel','anos','descricao','fonte','edicao'],lista.map(({i,calculado})=>[i.id,i.nome,i.unidade,calculado,(i.anos??i.periodos??c.anos).join(', '),(i.descricao??'').slice(0,1200),i.fonte_nome??fontes[p.tema],m.gerado_em??'']));
  }
  if(p.operacao==='territorios'){
    const busca=normalizar(p.busca??'');const lista=Object.entries(g.territorios).filter(([k,t])=>(!p.nivel||t.nivel===p.nivel)&&(!p.uf||p.uf==='BR'||t.uf===p.uf)&&normalizar(k+' '+t.nome).includes(busca)).slice(p.offset??0,p.limite===undefined?undefined:(p.offset??0)+p.limite);
    return selecionar(['territorio','nome','nivel','uf','imediata','intermediaria'],lista.map(([k,t])=>[k,t.nome,t.nivel,t.uf,t.imediata??null,t.intermediaria??null]));
  }
  if(!p.indicadores?.length)throw Error('Informe os identificadores encontrados no catálogo do tema.');
  const pedidas=p.indicadores.map(id=>{const d=defs.find(x=>x.i.id===id);if(!d)throw Error(`Indicador não encontrado: ${id}. Consulte o catálogo; não substitua por outro.`);return d;});
  if(p.operacao==='ranking'){
    if(pedidas.length!==1||p.anos&&p.anos.length>1)throw Error('O ranking usa um indicador relativo e um ano por consulta.');
    const a=await import('./comparacoes_dados');const meta=await a.obterComparacoes(p.tema,'todas');const i=meta.indicadores.find(x=>x.id===pedidas[0].i.id);
    if(!i?.ranking)throw Error('Para ordenar lugares de tamanhos diferentes, escolha um indicador relativo do catálogo. Os totais permanecem disponíveis na série.');
    const ano=p.anos?.[0]??(i.periodos_com_valor??i.periodos).at(-1)!;
    if(!i.periodos.includes(ano))return selecionar(['posicao','territorio','cod_ibge','nome','uf','ano','indicador','valor','unidade','condicao'],[]);
    const nivel=p.nivel??'M';const rows=nivel==='M'?await a.obterListaComparacao(meta,i,ano,p.uf??'BR'):await a.obterListaReferencias(meta,i,ano,nivel,false);abortar(sinal);
    const validos=ranquearComparacao(rows.filter(r=>!p.uf||p.uf==='BR'||r.uf===p.uf),p.ordem==='asc'?'menor':'maior',false,i.minimo??0).com;
    let pos=0,anterior:number|null=null;
    const lines=validos.map((r,j)=>{if(r.v!==anterior)pos=j+1;anterior=r.v;return[pos,r.grupo??String(r.cod),nivel==='M'?r.cod:null,r.nome,r.uf,ano,i.id,r.v,i.unidade,condicaoComparacao(r.c)]as(string|number|null)[];}).slice(p.offset??0,p.limite===undefined?undefined:(p.offset??0)+p.limite);
    return selecionar(['posicao','territorio','cod_ibge','nome','uf','ano','indicador','valor','unidade','condicao'],lines);
  }
  const territorios=p.territorios?.length?[...new Set(p.territorios)]:['BR'];
  const linhas:(string|number|boolean|null)[][]=[];
  for(const id of territorios){
    const ter=g.territorios[id];if(!ter)throw Error(`Território não encontrado: ${id}. Use localizar ou a operação territorios.`);
    const regional=!['M','UF','BR'].includes(ter.nivel);
    let ref:Awaited<ReturnType<typeof import('./comparacoes_dados')['obterGrupoComparacao']>>|undefined;
    let cm:Awaited<ReturnType<typeof import('./comparacoes_dados')['obterComparacoes']>>|undefined;
    let x:Grupo|undefined;
    if(regional){if(pedidas.some(d=>!d.calculado))throw Error('Para séries regionais, selecione indicadores relativos do catálogo.');const a=await import('./comparacoes_dados');cm=await a.obterComparacoes(p.tema,'todas');ref=await a.obterGrupoComparacao(cm,g,id);}else x=await grupo(id);
    abortar(sinal);
    for(const d of pedidas){
      const i=d.i;const anos=p.anos?.length?[...new Set(p.anos)].sort((a,b)=>a-b):[(i.anos??i.periodos??c.anos).at(-1)!];
      for(const ano of anos){
        let valor:number|null=null,numerador:number|null=null,denominador:number|null=null,cond=5;
        const coberto=(i.anos??i.periodos??c.anos).includes(ano);
        if(x&&coberto){const k=x.anos.indexOf(ano);if(k>=0){valor=(d.calculado?x.derivados:x.valores)?.[k]?.[d.j]??null;cond=(d.calculado?x.condicoes_derivados:x.condicoes)?.[k]?.[d.j]??5;
          if(d.calculado){numerador=x.numeradores?.[k]?.[d.j]??null;denominador=x.denominadores?.[k]?.[d.j]??null;
            if(!x.numeradores&&i.numerador_id){const j=c.indicadores.findIndex(v=>v.id===i.numerador_id);numerador=x.valores[k]?.[j]??null;}
            if(!x.denominadores&&i.denominador_id){const j=c.indicadores.findIndex(v=>v.id===i.denominador_id);denominador=x.valores[k]?.[j]??null;}
          }
        }}else if(ref&&cm&&coberto){const j=cm.indicadores.findIndex(v=>v.id===i.id),k=cm.indicadores[j]?.periodos.indexOf(ano)??-1;if(j>=0&&k>=0){const r=ref.dados[j];valor=r.v[k];numerador=r.n[k];denominador=r.d[k];cond=r.c[k];}}
        const nota=[...(m.notas??[]),i.notas_anos?.[String(ano)]?.[0]??'',i.tipo_periodo?`Tipo de período: ${i.tipo_periodo}`:'',m.datas?JSON.stringify(m.datas):''].filter(Boolean).join(' ');
        linhas.push([id,ter.nivel==='M'?Number(ter.cod):null,ter.nome,ter.uf,ter.nivel,ano,i.id,i.nome,valor,i.unidade,regional?condicaoComparacao(cond):String(c.condicoes[String(cond)]??cond),numerador,denominador,i.fonte_nome??fontes[p.tema],nota,m.gerado_em??'']);
      }
    }
  }
  return selecionar(['territorio','cod_ibge','nome_territorio','uf','nivel','ano','indicador','nome_indicador','valor','unidade','condicao','numerador','denominador','fonte','nota','edicao'],linhas);
 }catch(e){if(sinal?.aborted)throw new DOMException('Consulta cancelada','AbortError');return{erro:e instanceof Error?e.message:String(e),bloqueada:true};}
}

export type MetaTemaIa={anos:number[];gerado_em:string;catalogo?:{sha256:string};datas?:Record<string,string>;periodos?:unknown;ultimos?:Record<string,number>};
let metas:Promise<Partial<Record<TemaPreparado,MetaTemaIa>>>|undefined;
/** Apenas seis manifestos pequenos; nenhum catálogo ou conjunto de dados é baixado na abertura da IA. */
export function metadadosTemasIa(){return metas??=Promise.all(TEMAS_PREPARADOS.map(async t=>{try{const r=await fetch(`${BASE_DADOS}gold/${t}/manifesto.json`,{cache:'no-cache'});if(!r.ok)throw Error('Catálogo indisponível');return[t,await r.json()]as const;}catch{return[t,null]as const;}})).then(rows=>Object.fromEntries(rows.filter(([,m])=>m)));}
