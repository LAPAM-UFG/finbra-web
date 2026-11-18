import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compararReferencia, enderecoReferencia, formatarReferencia, notaReferencia, obterSerieReferencias, obterRankingReferencia, ultimoAnoReferencia, type AnoReferencia, type MetaReferencias } from '../src/assistencia_referencias';
import { corReferencia, limitesReferencia, COR_SEM_PERCENTUAL } from '../src/assistencia_mapa';
const row:AnoReferencia=[2025,1000,100,200,12,12,50,1200,8,10,2025];
test('as três referências preservam unidades e total sem somar beneficiários',()=>{
  assert.equal(compararReferencia(row,'pbf','populacao').valor,2);
  assert.equal(compararReferencia(row,'bpc','pib').valor,20);
  assert.equal(compararReferencia(row,'total','rais').valor,25);
  const zero=[...row] as AnoReferencia;zero[2]=0;assert.equal(compararReferencia(zero,'pbf','pib').valor,0);
});
test('ano incompleto e denominador zero não viram valor; razões acima de 100 são válidas',()=>{
  const incompleto=[...row] as AnoReferencia;incompleto[4]=11;incompleto[2]=null;
  assert.equal(compararReferencia(incompleto,'total','rais').condicao,2);
  const zero=[...row] as AnoReferencia;zero[7]=0;
  assert.equal(compararReferencia(zero,'pbf','rais').condicao,4);
  zero[7]=1;assert.equal(compararReferencia(zero,'pbf','rais').valor,10000);
  assert.equal(compararReferencia(undefined,'pbf','pib').valor,null);
});
test('estimativa e valores pequenos continuam identificados',()=>{
  assert.match(notaReferencia('rais'),/ESTIMATIVA/);
  assert.match(notaReferencia('rais'),/12/);
  assert.match(formatarReferencia(.0001,'pib'),/^<0,01%$/);
  assert.match(formatarReferencia(2,'populacao'),/R\$\/hab/);
  const m={anos:[2023,2025,2026],anos_com_valor:{pib:[2023],rais:[2025],populacao:[2025]}} as MetaReferencias;
  assert.equal(ultimoAnoReferencia(m,'rais'),2025);assert.equal(ultimoAnoReferencia(m,'pib'),2023);
});
test('cores do mapa mudam de unidade sem colorir ausência como zero',()=>{
  assert.notDeepEqual(limitesReferencia('populacao'),limitesReferencia('pib'));
  assert.notDeepEqual(limitesReferencia('rais'),limitesReferencia('pib'));
  assert.equal(corReferencia(null,'populacao'),COR_SEM_PERCENTUAL);
  assert.notEqual(corReferencia(0,'populacao'),COR_SEM_PERCENTUAL);
  assert.notEqual(corReferencia(500,'populacao'),corReferencia(500,'pib'));
});
test('download aceita apenas o namespace imutável das comparações',()=>{
  const o={caminho:'gold/assistencia/economia_referencias_base_abcdef.dta',bytes:100,sha256:'a'.repeat(64)};
  assert.match(enderecoReferencia(o),/economia_referencias/);
  for(const caminho of ['gold/assistencia/../segredo.csv','https://example.test/a.csv','gold/assistencia/economia_a.exe'])assert.throws(()=>enderecoReferencia({...o,caminho}));
});
test('séries e rankings exigem Range e preservam a referência, o programa e a cobertura',async()=>{
  const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
  const enc=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v)+'\n');
  const series=[{grupo:'5208707',linhas:[row]},{grupo:'5208905',linhas:[[2025,1000,100,200,12,12,50,1200,11,10,2025]]},{grupo:'5218805',linhas:[row]}];
  const chunks=series.map(enc);let offset=0;const grupos:Record<string,[number,number,string]>={};
  chunks.forEach((b,k)=>{grupos[series[k].grupo]=[offset,b.length,hash(b)];offset+=b.length;});
  const bytes=new Uint8Array(offset);offset=0;chunks.forEach(b=>{bytes.set(b,offset);offset+=b.length;});
  const objetos=new Map<string,Uint8Array>();
  const ref=(nome:string,b:Uint8Array)=>{const caminho='gold/assistencia/economia_teste_'+nome;objetos.set(caminho,b);return{caminho,bytes:b.length,sha256:hash(b)};};
  const arq=ref('series.ndjson',bytes),indice=ref('indice.json',enc({grupos}));
  const ranking=enc({versao:1,base:'populacao',medida:'pbf',ano:2025,uf:'GO',linhas:[[5208707,'Goiânia','GO',1,2,100,50]]});
  const rankfile=ref('rank.ndjson',ranking);
  const rankidx=ref('ranking.json',enc({versao:1,base:'populacao',medida:'pbf',arquivo:rankfile,anos_com_valor:[2025],recortes:{'2025:GO':{trecho:[0,ranking.length,hash(ranking)],total:2,validos:1,condicoes:[1,1,0,0,0,0]}}}));
  const download={caminho:'gold/assistencia/economia_teste.csv',bytes:1,sha256:'a'.repeat(64),formato:'csv'};
  const meta={versao:1,anos:[2025],anos_com_valor:{populacao:[2025],rais:[2025],pib:[2025]},arquivo:arq,grupos:{},indices_uf:{GO:indice},rankings:{populacao:{pbf:rankidx,bpc:rankidx,total:rankidx},rais:{pbf:rankidx,bpc:rankidx,total:rankidx},pib:{pbf:rankidx,bpc:rankidx,total:rankidx}},downloads:[download],dicionario:{...download,caminho:'gold/assistencia/economia_teste.json'}};
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async(input,init)=>{const url=String(input);if(url.endsWith('referencias_manifesto.json'))return new Response(JSON.stringify(meta));const key=url.slice(url.indexOf('gold/'));const b=objetos.get(key);assert.ok(b,key);const range=new Headers(init?.headers).get('Range');if(!range)return new Response(b);requests++;const [,a,z]=range.match(/bytes=(\d+)-(\d+)/)!;const inicio=Number(a),fim=Number(z);if(inicio===grupos['5218805'][0])return new Response(b,{status:200});return new Response(b.slice(inicio,fim+1),{status:206,headers:{'Content-Range':`bytes ${inicio}-${fim}/${b.length}`}});};
  try{
    assert.equal((await obterSerieReferencias('5208707','GO')).linhas[0][7],1200);
    await assert.rejects(obterSerieReferencias('5208905','GO'),/Série anual incompatível/);
    await assert.rejects(obterSerieReferencias('5218805','GO'),/somente este recorte/);
    const r=await obterRankingReferencia('populacao','pbf',2025,'GO');assert.equal(r.linhas[0][4],2);assert.equal(r.cobertura.validos,1);
    await assert.rejects(obterRankingReferencia('rais','pbf',2025,'GO'),/outra referência/);
    await assert.rejects(obterRankingReferencia('pib','pbf',2025,'GO'),/outra referência/);
    assert.ok(requests>=4);
  }finally{globalThis.fetch=original;}
});
