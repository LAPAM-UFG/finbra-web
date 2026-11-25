import { buscarDados as fetch } from './buscar_dados';
import { BASE_DADOS } from './manifesto';
import { lerJson, lerTrecho, type MedidaRankingPib, type LinhaRankingPib, type CoberturaRankingPib } from './assistencia_economia';
import { local, t } from './idioma';

export type BaseReferencia = 'populacao' | 'rais' | 'pib';
export const BASES_REFERENCIA: BaseReferencia[] = ['populacao','rais','pib'];
type Objeto = { caminho:string; bytes:number; sha256:string };
type Trecho = [number,number,string];
/** ano, PIB, PBF, BPC, meses PBF/BPC, população, massa anual estimada, N com remuneração, vínculos, ano da população. */
export type AnoReferencia = [number,number|null,number|null,number|null,number,number,number|null,number|null,number|null,number|null,number|null];
export type MetaReferencias = { versao:1; anos:number[]; anos_com_valor:Record<BaseReferencia,number[]>; arquivo:Objeto; grupos:Record<string,Trecho>; indices_uf:Record<string,Objeto>; rankings:Record<BaseReferencia,Record<MedidaRankingPib,Objeto>>; downloads:({formato:string}&Objeto)[]; dicionario:Objeto; nota_rais:string; nota_rais_en:string };
export type SerieReferencias = {grupo:string;linhas:AnoReferencia[]};
export type RankingReferencia = {versao:1;base:BaseReferencia;medida:MedidaRankingPib;ano:number;uf:string;linhas:LinhaRankingPib[];cobertura:CoberturaRankingPib;anos_com_valor:number[]};
const cache = new Map<string,Promise<unknown>>();
function memo<T>(k:string,f:()=>Promise<T>):Promise<T> { let p=cache.get(k) as Promise<T>|undefined; if(!p){p=f();cache.set(k,p);p.catch(()=>{if(cache.get(k)===p)cache.delete(k);});} return p; }
export const nomeBase = (b:BaseReferencia) => b==='populacao'?t('Por habitante','Per resident'):b==='rais'?t('Massa salarial formal · estimativa','Formal payroll · estimate'):t('PIB','GDP');
export const unidadeReferencia = (b:BaseReferencia) => b==='populacao'?t('R$ por habitante/ano','R$ per resident/year'):'%';
export const nomeDenominador = (b:BaseReferencia) => b==='populacao'?t('População residente','Resident population'):b==='rais'?t('Massa salarial formal anual estimada','Estimated yearly formal payroll'):t('PIB do mesmo ano','GDP for the same year');
export const formatarReferencia = (v:number|null,b:BaseReferencia) => v===null?'—':(v>0&&v<.01?t('<0,01','<0.01'):v.toLocaleString(local(),{minimumFractionDigits:2,maximumFractionDigits:2}))+(b==='populacao'?t(' R$/hab.',' R$/resident'):'%');
export function condicaoReferencia(c:number,b:BaseReferencia) { return [t('Registrado','Recorded'),t('Sem pagamentos informados','No reported payments'),t('Ano incompleto: menos de 12 meses válidos','Incomplete year: fewer than 12 valid months'),t(`${nomeDenominador(b)} indisponível`,`${nomeDenominador(b)} unavailable`),t('Indefinido: denominador zero','Undefined: zero denominator'),t('Denominador inválido','Invalid denominator')][c]??t('Indisponível','Unavailable'); }
export const notaReferencia = (b:BaseReferencia) => b==='populacao'
  ? t('Pagamentos nominais dos 12 meses / população residente de referência do IBGE. Resultado em reais por habitante no ano. Em 2023 usa-se o Censo 2022, identificado como base demográfica.','Nominal payments over all 12 months / IBGE reference resident population. Reais per resident in the year. For 2023, the 2022 Census is used and identified as the population base.')
  : b==='rais'
    ? t('ESTIMATIVA: pagamentos anuais / (12 × massa salarial nominal observada em dezembro) × 100. Não é folha anual observada; sem 13º imputado. RAIS cobre vínculos formais no local do estabelecimento, não a renda de todos os moradores. Confira a cobertura da remuneração; há mudanças de captação em 2022/2023.','ESTIMATE: yearly payments / (12 × observed nominal December payroll) × 100. Not observed yearly payroll; no imputed 13th salary. RAIS covers formal jobs at the employer location, not all residents’ income. Check reported-pay coverage; collection changed in 2022/2023.')
    : t('Pagamentos nominais dos 12 meses / PIB nominal do mesmo ano × 100. Comparação de grandeza; não mede contribuição ao PIB ou efeito causal.','Nominal payments over all 12 months / nominal GDP for the same year × 100. A magnitude comparison, not a contribution to GDP or a causal effect.');
export function compararReferencia(l:AnoReferencia|undefined,tipo:MedidaRankingPib,base:BaseReferencia) {
  if(!l)return {valor:null,condicao:1,pago:null,meses:0,denominador:null};
  const meses=tipo==='pbf'?l[4]:tipo==='bpc'?l[5]:Math.min(l[4],l[5]);
  const pago=tipo==='pbf'?l[2]:tipo==='bpc'?l[3]:l[2]!==null&&l[3]!==null?l[2]+l[3]:null;
  const d=base==='pib'?l[1]:base==='populacao'?l[6]:l[7];
  const condicao=meses===0?1:meses!==12||pago===null?2:d===null?3:d===0?4:!Number.isFinite(d)||d<0?5:0;
  return {valor:condicao===0?pago!/d!*(base==='populacao'?1:100):null,condicao,pago,meses,denominador:d};
}
export const ultimoAnoReferencia = (m:MetaReferencias,b:BaseReferencia) => m.anos_com_valor[b].at(-1)??m.anos.at(-1)!;
export function enderecoReferencia(o:Objeto) {
  if(!/^gold\/assistencia\/economia_[a-z0-9_]+\.(csv|parquet|dta|json)$/.test(o.caminho)||!Number.isSafeInteger(o.bytes)||o.bytes<=0||!/^[a-f0-9]{64}$/.test(o.sha256))throw new Error('Download da comparação inválido.');
  return BASE_DADOS+o.caminho;
}
export function obterMetaReferencias():Promise<MetaReferencias> { return memo('meta',async()=>{
  const r=await fetch(BASE_DADOS+'gold/assistencia/referencias_manifesto.json',{cache:'no-cache'});if(!r.ok)throw new Error('Comparações anuais indisponíveis.');
  const m=await r.json() as MetaReferencias;
  if(m.versao!==1||!Array.isArray(m.anos)||!m.grupos||!m.indices_uf||BASES_REFERENCIA.some(b=>!Array.isArray(m.anos_com_valor?.[b])||m.anos_com_valor[b].some(y=>!m.anos.includes(y))||!m.rankings?.[b]))throw new Error('Catálogo de comparações incompatível.');
  for(const o of [...m.downloads,m.dicionario])enderecoReferencia(o);return m;
}); }
export function obterSerieReferencias(grupo:string,uf:string|null):Promise<SerieReferencias> { return memo('serie:'+grupo+':'+uf,async()=>{
  const m=await obterMetaReferencias();let trecho=m.grupos[grupo];
  if(!trecho&&/^\d{7}$/.test(grupo)&&uf&&m.indices_uf[uf]) { const idx=await memo('indice:'+m.indices_uf[uf].sha256,()=>lerJson<{grupos:Record<string,Trecho>}>(m.indices_uf[uf]));trecho=idx.grupos[grupo]; }
  if(!trecho)throw new Error('Território fora da comparação.');const s=await lerTrecho<SerieReferencias>(m.arquivo,trecho);
  if(s.grupo!==grupo||!Array.isArray(s.linhas)||s.linhas.length!==m.anos.length||new Set(s.linhas.map(l=>l[0])).size!==m.anos.length||s.linhas.some(l=>l.length!==11||!m.anos.includes(l[0])||l.slice(1).some(v=>v!==null&&(!Number.isFinite(v)||v<0))||![l[4],l[5]].every(v=>Number.isInteger(v)&&v>=0&&v<=12)||(l[8]!==null&&l[9]!==null&&l[8]>l[9])))throw new Error('Série anual incompatível.');
  return s;
}); }
export function obterRankingReferencia(base:BaseReferencia,medida:MedidaRankingPib,ano:number,uf:string):Promise<RankingReferencia> { return memo(`rank:${base}:${medida}:${ano}:${uf}`,async()=>{
  const m=await obterMetaReferencias();const ref=m.rankings[base][medida];
  type Indice={versao:1;base?:BaseReferencia;medida:MedidaRankingPib;arquivo:Objeto;anos_com_valor:number[];recortes:Record<string,CoberturaRankingPib>};
  const idx=await memo('rankidx:'+ref.sha256,()=>lerJson<Indice>(ref));
  if(idx.versao!==1||idx.medida!==medida||(idx.base!==undefined&&idx.base!==base)||(base!=='pib'&&idx.base===undefined))throw new Error('Ranking de outra referência.');
  const c=idx.recortes[`${ano}:${uf}`];if(!c||!Array.isArray(c.condicoes)||c.condicoes.length!==6||c.condicoes.some(v=>!Number.isSafeInteger(v)||v<0)||c.condicoes.reduce((a,b)=>a+b,0)!==c.total||c.condicoes[0]!==c.validos)throw new Error('Cobertura de outro período.');
  const x=await lerTrecho<RankingReferencia>(idx.arquivo,c.trecho);const fator=base==='populacao'?1:100;
  if(x.versao!==1||x.medida!==medida||x.ano!==ano||x.uf!==uf||(x.base!==undefined&&x.base!==base)||(base!=='pib'&&x.base===undefined)||!Array.isArray(x.linhas)||x.linhas.length!==c.validos||new Set(x.linhas.map(l=>l[0])).size!==x.linhas.length||x.linhas.some((l,k)=>l.length!==7||!Number.isSafeInteger(l[0])||typeof l[1]!=='string'||!/^[A-Z]{2}$/.test(l[2])||(uf!=='BR'&&l[2]!==uf)||!Number.isSafeInteger(l[3])||l[3]<1||l[3]>k+1||l.slice(4).some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)||l[6]<=0||Math.abs(l[4]-fator*l[5]/l[6])>1e-7||(k>0&&l[4]>x.linhas[k-1][4]+1e-9)))throw new Error('Ranking anual incompatível.');
  return {...x,base,cobertura:c,anos_com_valor:idx.anos_com_valor};
}); }
