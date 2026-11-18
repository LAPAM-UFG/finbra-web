import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apresentacaoRaio, criarLeitorRaio, grupoOrigemRaio, linkComparacaoRaio, pontoDoAnoRaio, pontoEfetivoRaio, serieExtraRaio, type IndicadorRaio, type PontoRaio } from '../src/raio_x';
import type { GeografiaComparacao, ObjetoComparacao, SerieComparacao } from '../src/comparacoes_dados';
import { buscaEntreAreas, buscaParaDownloads } from '../src/navegacao';

const indicador:IndicadorRaio={id:'empregos',nome:'Vínculos por mil habitantes',nome_en:'Jobs per thousand residents',nome_original:'Vínculos formais',unidade_original:'vínculos',descricao:'Empregos',descricao_en:'Jobs',tema:'Trabalho',tema_en:'Jobs',unidade:'vínculos por mil',unidade_en:'jobs per thousand',formato:'numero',periodos:[2024,2025],frequencia:'anual',metodo_referencia:'razao',normalizacao:'Valor observado dividido pela população residente',normalizacao_en:'Observed value divided by population',fator:1000,ranking:true,fonte_nome:'RAIS',fontes:[],area:'trabalho',rede:'todas',catalogo:'trabalho_todas',indice:0};
const serie:SerieComparacao={v:[2,0],n:[2,0],d:[1,1],c:[0,1],q:[1,1],r:[2,0]};
const geo={versao:1,municipios:[],governos:[['E:52','Goiás','GO']],territorios:{BR:{nome:'Brasil',nivel:'BR',uf:null,cod:'BR'},GO:{nome:'GO',nivel:'UF',uf:'GO',cod:'GO'},'5208905':{nome:'Goiás',nivel:'M',uf:'GO',cod:5208905}}} as GeografiaComparacao;

test('ano solicitado não usa outra data; meses são observações, não somas',()=>{
  assert.deepEqual(pontoDoAnoRaio(indicador,serie,2023),[2023,null,null,null,5,0,null]);
  const i={...indicador,periodos:[202501,202502,202503],frequencia:'mensal' as const};
  const s={v:[10,20,null],n:[10,20,null],d:[1,1,null],c:[0,0,2],q:[1,1,0]};
  assert.equal(pontoDoAnoRaio(i,s,2025)[1],20);assert.equal(pontoDoAnoRaio(i,s,2025)[0],202502);
});
test('zero observado aparece; ressalva requer opção e não vaza no valor original',()=>{
  const zero:PontoRaio=[2025,0,0,100,1,1,0];assert.equal(apresentacaoRaio(indicador,zero,'5208905').texto,'0');
  const p:PontoRaio=[2025,30,30,1000,18,1,30,[40,40,1000,18,1,40]];
  assert.equal(pontoEfetivoRaio(p,false)![1],null);assert.equal(apresentacaoRaio(indicador,p,'5208905').original,null);
  assert.equal(apresentacaoRaio(indicador,p,'5208905',true).original,40);
});
test('a falta de um ano não muda o nome nem a unidade de uma contagem',()=>{
  const a=apresentacaoRaio(indicador,[2023,null,null,null,5,0,null],'5208905');
  assert.equal(a.nome,'Vínculos formais');assert.equal(a.unidade,'vínculos');assert.equal(a.valor,null);
});
test('total municipal preserva numerador somável; mediana nunca vira total inventado',()=>{
  const p:PontoRaio=[2025,20,200,10000,16,20,null];assert.equal(apresentacaoRaio(indicador,p,'GO').valor,200);
  const mediana={...indicador,metodo_referencia:'mediana' as const,fator:1,normalizacao:'Mediana municipal'};
  assert.equal(apresentacaoRaio(mediana,p,'GO').valor,20);
});
test('frações aparecem como percentuais compreensíveis; valores inconsistentes não viram originais válidos',()=>{
  const i={...indicador,formato:'percentual',unidade:'%',unidade_original:'fração (×100 = %)'};
  const a=apresentacaoRaio(i,[2025,85,85,100,0,1,.85],'5208905');
  assert.equal(a.valor,85);assert.equal(a.texto,'85,0%');
  assert.equal(apresentacaoRaio(indicador,[2025,null,999,1,9,1,999],'5208905').valor,null);
});
test('ESTADIC usa governo, MUNIC usa território; não mistura universos',()=>{
  assert.equal(grupoOrigemRaio(geo,'GO',{...indicador,catalogo:'gestao_estadic'}),'E:52');
  assert.equal(grupoOrigemRaio(geo,'5208905',{...indicador,catalogo:'gestao_estadic'}),null);
  assert.equal(grupoOrigemRaio(geo,'GO',indicador),'GO');
});
test('referências anuais identificam ano parcial, denominador zero e pagamentos ausentes',()=>{
  const ls:any[]=[[2025,1000,120,60,12,12,100,600,9,10,2025],[2026,null,90,45,9,9,110,null,null,null,2026]];
  assert.deepEqual(serieExtraRaio(ls,'rx_pbf_rais').v,[20,null]);
  assert.deepEqual(serieExtraRaio(ls,'rx_total_populacao').v,[1.8,null]);
  assert.equal(serieExtraRaio([[2025,0,null,0,0,12,100,0,0,0,2025]],'rx_pbf_rais').c[0],2);
  assert.equal(serieExtraRaio([[2025,0,0,0,12,12,100,0,0,0,2025]],'rx_bpc_rais').c[0],4);
});
test('navegação mantém município e distingue DF governo de Brasília',()=>{
  assert.equal(new URLSearchParams(buscaEntreAreas('?ente=5208905&uf=GO','trabalho','raiox')).get('cod'),'5208905');
  assert.equal(new URLSearchParams(buscaEntreAreas('?ente=53','financas','raiox')).get('uf'),'DF');
  assert.equal(new URLSearchParams(buscaEntreAreas('?ente=53','financas','raiox')).has('cod'),false);
  assert.equal(new URLSearchParams(buscaEntreAreas('?cod=5300108','raiox','educacao')).get('cod'),'5300108');
  assert.equal(new URLSearchParams(buscaParaDownloads('?uf=GO&cod=5208905','raiox')).has('area'),false);
});
test('atalhos das referências abrem o painel e os filtros correspondentes',()=>{
  const ref={...indicador,catalogo:'referencias',id:'rx_massa_rais'};
  assert.equal(linkComparacaoRaio(ref,'5208905',geo,2025),'/trabalho?uf=GO&ente=5208905&ano=2025');
  const u=new URL('https://exemplo'+linkComparacaoRaio({...ref,id:'rx_bpc_rais'},'5208905',geo,2025));
  assert.equal(u.pathname,'/assistencia/comparacoes-pagamentos');assert.equal(u.searchParams.get('base_comparacao'),'rais');assert.equal(u.searchParams.get('medida'),'bpc');assert.equal(u.searchParams.get('ano_comparacao'),'2025');assert.equal(u.searchParams.has('indicador'),false);
});

async function fixture(modo='ok') {
  const enc=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));const sum=async(b:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b as BufferSource)),x=>x.toString(16).padStart(2,'0')).join('');
  const body=new TextEncoder().encode(JSON.stringify({versao:1,grupo:modo==='outro'?'5208707':'5208905',linhas:[[2025,0,0,100,1,1,0]],referencias:{}})+'\n');
  const files=new Map<string,Uint8Array>();
  async function ref(nome:string,b:Uint8Array):Promise<ObjetoComparacao>{const r={caminho:'gold/raiox/'+nome,bytes:b.length,sha256:await sum(b)};files.set(r.caminho,b);return r;}
  const arq=await ref('retratos_test.ndjson',body);const idx=await ref('indice_test.json',enc({versao:1,arquivo:arq,grupos:{'5208905':[0,body.length,await sum(body)]}}));
  const geografia=await ref('geografia_test.json',enc(geo));const catalogo=await ref('catalogo_test.json',enc({versao:1,indicadores:[indicador],catalogos:{},referencias:{}}));
  files.set('gold/raiox/manifesto.json',enc({versao:1,catalogo,geografia,indices:{GO:idx,referencias:idx},anos:[2025],indicadores:1}));
  const calls:string[]=[];
  const buscar=async(input:RequestInfo|URL,init?:RequestInit)=>{const key=String(input).replace('https://exemplo/','');calls.push(key);const bytes=files.get(key);if(!bytes)return new Response('',{status:404});if(key.endsWith('.ndjson')){assert.equal((init?.headers as Record<string,string>).Range,`bytes=0-${body.length-1}`);return new Response(modo==='corrompido'?new Uint8Array(body.length):bytes,{status:modo==='inteiro'?200:206,headers:{'Content-Range':`bytes 0-${body.length-1}/${body.length}`}});}return new Response(bytes,{status:200});};
  const l=criarLeitorRaio(buscar as typeof fetch,'https://exemplo/');const m=await l.meta();const g=await l.geografia(m);return {l,m,g,calls};
}
test('abertura lê somente o retrato solicitado e reutiliza o cache',async()=>{
  const {l,m,g,calls}=await fixture();const a=await l.retrato(m,g,'5208905');const b=await l.retrato(m,g,'5208905');assert.equal(a,b);assert.equal(a.linhas[0]![1],0);assert.equal(calls.filter(x=>x.endsWith('.ndjson')).length,1);
});
test('recusa bundle inteiro, bytes corrompidos e retrato de outro município',async()=>{
  for(const modo of ['inteiro','corrompido','outro']){const {l,m,g}=await fixture(modo);await assert.rejects(()=>l.retrato(m,g,'5208905'));}
});
test('metadados gzip preservam conteúdo e validam hash e limite descompactados',async()=>{
  const raw=new TextEncoder().encode(JSON.stringify({indicador:'População',valor:24113}));
  const compressed=await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const sum=async(b:BufferSource)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',b)),x=>x.toString(16).padStart(2,'0')).join('');
  const ref={caminho:'gold/raiox/catalogo_fixture.json.gz',bytes:compressed.byteLength,sha256:await sum(compressed),json_bytes:raw.length,json_sha256:await sum(raw)};
  const leitor=criarLeitorRaio((async()=>new Response(compressed)) as typeof fetch,'https://exemplo/');
  assert.deepEqual(await leitor.objeto(ref),{indicador:'População',valor:24113});
  await assert.rejects(()=>leitor.objeto({...ref,json_sha256:'f'.repeat(64)}));
  await assert.rejects(()=>leitor.objeto({...ref,json_bytes:raw.length-1}));
});
