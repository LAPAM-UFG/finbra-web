import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {dataLocal,nomeArquivo} from '../src/exportar';
import {nomeArquivoDownload} from '../src/downloads';
import {definirIdioma} from '../src/idioma';
import {unidadePublica} from '../src/rotulos_publicos';
import {criarAberturaPaineis} from '../src/abertura_paineis';
import {USAR_MOTOR} from '../src/clima_abertura';
import {quantidadeEsperada} from '../src/cobertura_territorial';
import {apresentacaoRaio,type IndicadorRaio} from '../src/raio_x';
import type {GeografiaComparacao} from '../src/comparacoes_dados';
import {validarSerieComparacao} from '../src/comparacoes_dados';
import {nomeGrupoTrabalho} from '../src/trabalho_rotulos';
import {incluiDistritoCadastro} from '../src/filtros_url';

test('nome exportado acompanha a data local na noite em que UTC já virou o dia',()=>{
 const anterior=process.env.TZ;try{
  process.env.TZ='America/Sao_Paulo';const noite=new Date('2026-11-24T01:30:00Z');
  assert.equal(dataLocal(noite),'2026-11-23');assert.match(nomeArquivo('raiox_3509502',noite),/_2026-11-23$/);
  process.env.TZ='Asia/Tokyo';assert.equal(dataLocal(noite),'2026-11-24');
 }finally{if(anterior===undefined)delete process.env.TZ;else process.env.TZ=anterior;}
});

test('cartão e nome acessível usam o mesmo nome público, mesmo com prefixo Base enxuta',()=>{
 for(const [area,pt,en]of [['trabalho','Mercado de trabalho','Labour market'],['gestao','Gestão pública','Public management'],['clima','Clima','Climate']]){
  const a={area,nome:'Base enxuta — '+area,nome_en:'Lean base — '+area};
  assert.equal(nomeArquivoDownload(a),'Base enxuta — '+pt);assert.equal(nomeArquivoDownload(a,true),'Lean base — '+en);
 }
 assert.equal(nomeArquivoDownload({area:'saude',nome:'Base enxuta — Saúde',nome_en:'Health'}),'Base enxuta — Saúde');
 assert.equal(nomeArquivoDownload({area:'trabalho',nome:'Mercado de trabalho — SP',nome_en:''}),'Mercado de trabalho — SP');
 assert.equal(nomeArquivoDownload({area:'trabalho',nome:'Mercado de trabalho — SP',nome_en:''},true),'Labour market — SP');
});

test('unidades compostas restantes são localizadas sem modificar símbolos monetários',async()=>{
 const anterior=globalThis.document;Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:{documentElement:{lang:''},title:''}});
 try{await definirIdioma('en');assert.equal(unidadePublica('R$/tonelada'),'R$/tonne');assert.equal(unidadePublica('veículo-anos'),'vehicle-years');assert.equal(nomeGrupoTrabalho('sexo','1','Masculino'),'Male');assert.equal(nomeGrupoTrabalho('raca_cor','8','Parda'),'Brown (parda)');
 await definirIdioma('pt');assert.equal(unidadePublica('R$/tonelada'),'R$/tonelada');}
 finally{await definirIdioma('pt');Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:anterior});}
});

const g={municipios:[[3509502,'Campinas','SP','3507','3502'],[5101837,'Boa Esperança do Norte','MT','5101','5101'],[2605459,'Fernando de Noronha','PE','2601','2601']],territorios:{BR:{nivel:'BR'},SP:{nivel:'UF'},PE:{nivel:'UF'}}}as unknown as GeografiaComparacao;
test('cobertura exige a divisão vigente e conserva o distrito de Fernando de Noronha',()=>{
 assert.equal(quantidadeEsperada(g,'BR',2024),2);assert.equal(quantidadeEsperada(g,'BR',2025),3);
 assert.equal(quantidadeEsperada(g,'BR',202412),2);assert.equal(quantidadeEsperada(g,'PE',2024),1);
});

test('Noronha é selecionável nas fontes com dados próprios, sem criar declaração fiscal',()=>{
 for(const p of ['/trabalho','/trabalho/remuneracao','/datasus/rede'])assert.equal(incluiDistritoCadastro(p),true);
 for(const p of ['/receitas','/socioeconomico','/lrf/demonstrativos','/trabalhox'])assert.equal(incluiDistritoCadastro(p),false);
});
test('aviso de cobertura informa quantos territórios faltam, sem ocultar ausência',()=>{
 const i={id:'empregos',area:'trabalho',catalogo:'trabalho_todas',nome:'Empregos',nome_en:'Jobs',unidade:'vínculos',unidade_en:'jobs',formato:'numero',fator:1,normalizacao:'Soma de pares válidos'}as IndicadorRaio;
 const a=apresentacaoRaio(i,[2025,10,10,1,16,2,null],'BR',false,g);assert.match(a.condicao,/faltam 1/);assert.match(a.condicao,/2 de 3/);
 const governo=apresentacaoRaio({...i,catalogo:'gestao_estadic'},[2025,10,10,1,16,23,null],'BR',false,g,27);assert.match(governo.condicao,/faltam 4/);assert.match(governo.condicao,/governos estaduais/);
});

test('cobertura opcional recusa séries truncadas ou contagens impossíveis',()=>{
 const s={v:[10],n:[10],d:[1],c:[0],q:[2],e:[2]};validarSerieComparacao(s,1,3);
 for(const e of [[],[1],[4],[-1],[1.5]])assert.throws(()=>validarSerieComparacao({...s,e},1,3),/esperada/);
});

function fixture(corromper=false){
 const objetos=new Map<string,Uint8Array>();const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
 const linha={grupo:'1',nome:'Masculino',vinculos:3,ativos:3,n_rem_dez:2,rem_dez_soma:300,rem_dez_media:150,rem_dez_mediana:150,rem_dez_p10:110,rem_dez_p90:190};
 const b=gzipSync(JSON.stringify({chave:'ente:3509502',dados:{ano:2025,dimensoes:{sexo:[linha]}}}));
 const arquivo={caminho:'gold/abertura/remuneracao_teste.bin',bytes:b.length,sha256:hash(b)};objetos.set(arquivo.caminho,b);
 const idx=gzipSync(JSON.stringify({versao:1,arquivo,grupos:{'ente:3509502':[0,b.length,corromper?'0'.repeat(64):hash(b)]}}));
 const ref={caminho:'gold/abertura/remuneracao_indice.json.gz',bytes:idx.length,sha256:hash(idx),gzip:true};objetos.set(ref.caminho,idx);
 const m={gerado_em:'2026-11-23',anos:[2025],base_ipca:2025,colunas:{},fontes:{rais_micro:{anos:[2025]},ipca:{ano:2025}}};
 const r={versao:1,remuneracao:{compatibilidade:{gerado_em:m.gerado_em,fontes:{rais_micro:m.fontes.rais_micro},base_ipca:2025,ipca:m.fontes.ipca},anos:{'2025':{SP:ref}},base_ipca:2025,fatores:{'2025':1}}};
 let ranges=0;
 const buscar=(async(u:RequestInfo|URL,init?:RequestInit)=>{
  const key=String(u).replace('https://dados.invalid/','');if(key==='gold/abertura/manifesto.json')return Response.json(r);
  const bytes=objetos.get(key);assert.ok(bytes,key);const range=new Headers(init?.headers).get('Range');
  if(range){ranges++;assert.equal(range,`bytes=0-${bytes.length-1}`);return new Response(bytes,{status:206,headers:{'Content-Range':`bytes 0-${bytes.length-1}/${bytes.length}`}});}
  return new Response(bytes);
 })as typeof fetch;
 return {leitor:criarAberturaPaineis({buscar,base:'https://dados.invalid/',manifesto:async()=>m}),get ranges(){return ranges;}};
}
test('remuneração pronta mantém quantis exatos e lê um trecho territorial uma única vez',async()=>{
 const f=fixture();const q={ano:2025,ente:3509502,situacao:'ativos',agrupar:'sexo'};
 const a=await f.leitor.executar('trab_remuneracao',q)as {preparado:boolean;linhas:Record<string,number>[]};
 assert.equal(a.preparado,true);assert.equal(a.linhas[0].rem_dez_mediana,150);assert.equal(a.linhas[0].rem_dez_p10,110);assert.equal(a.linhas[0].n_rem_dez,2);
 await f.leitor.executar('trab_remuneracao',q);assert.equal(f.ranges,1);
});
test('filtros não preparados e trechos corrompidos usam o cálculo completo, nunca um recorte aproximado',async()=>{
 const f=fixture();assert.equal(await f.leitor.executar('trab_remuneracao',{ano:2025,ente:3509502,situacao:'ativos',agrupar:'sexo',cnae:'47'}),USAR_MOTOR);
 assert.equal(f.ranges,0);assert.equal(await fixture(true).leitor.executar('trab_remuneracao',{ano:2025,ente:3509502,situacao:'ativos',agrupar:'sexo'}),USAR_MOTOR);
});
