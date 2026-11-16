/** Compara os pacotes prontos ao SQL original, inclusive casos sem valor e DF. */
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { criarAberturaPaineis } from '../src/abertura_paineis';
import { USAR_MOTOR } from '../src/clima_abertura';
import { executar,usarMotorDeTeste } from '../src/dados';
import { SQL_IPCA_BASE } from '../src/ia_moeda';
import { CURADORIA } from '../src/munic_curadoria';
import { edicoesCuradas,montarCartoes,selecionar } from '../src/munic_painel';

const require=createRequire(import.meta.url),base=process.env.SNAPSHOT_ABERTURA!,candidato=process.env.CANDIDATO_ABERTURA!;
if(!base||!candidato)throw new Error('Informe SNAPSHOT_ABERTURA e CANDIDATO_ABERTURA');
const manifesto=JSON.parse(await readFile(path.join(base,'gold/manifesto.json'),'utf8'));
const duckdb=require('@duckdb/duckdb-wasm/blocking'),dist=path.dirname(require.resolve('@duckdb/duckdb-wasm'));
const bundles={mvp:{mainModule:path.join(dist,'duckdb-mvp.wasm'),mainWorker:path.join(dist,'duckdb-node-mvp.worker.cjs')},eh:{mainModule:path.join(dist,'duckdb-eh.wasm'),mainWorker:path.join(dist,'duckdb-node-eh.worker.cjs')}};
const db=await duckdb.createDuckDB(bundles,new duckdb.VoidLogger(),duckdb.NODE_RUNTIME);
await db.instantiate();db.open({query:{castBigIntToDouble:true,castDecimalToDouble:true}});
const con=db.connect();
const adapter={query:async(sql:string)=>con.query(sql),prepare:async(sql:string)=>{const st=con.prepare(sql);return {query:async(...a:unknown[])=>st.query(...a),close:async()=>st.close()};}};
for(const [n,p] of Object.entries({entes:'silver/entes.parquet',indicadores:'gold/indicadores.parquet',ipca:'gold/ipca.parquet',escopos:'gold/escopos.parquet',alertas:'gold/alertas.parquet'}))con.query(`CREATE TABLE ${n} AS SELECT * FROM read_parquet('${path.join(base,p).replaceAll('\\','/')}')`);
con.query(SQL_IPCA_BASE);
usarMotorDeTeste({registerFileBuffer:async(n:string,b:Uint8Array)=>db.registerFileBuffer(n,b)} as any,adapter as any,manifesto,c=>path.join(base,c).replaceAll('\\','/'),async c=>new Uint8Array(await readFile(path.join(base,c))));
const pedidos:{url:string;bytes:number;status:number}[]=[];
let defeito:'nenhum'|'hash'|'range'|'raiz'='nenhum';
const buscar=async(input:RequestInfo|URL,init?:RequestInit)=>{
 const u=String(input),p=new URL(u).pathname.slice(1);
 if(defeito==='raiz'&&p.endsWith('/manifesto.json'))return new Response('{}',{status:404});
 const bytes=await readFile(path.join(candidato,p));
 const range=new Headers(init?.headers).get('Range');
 if(range){const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(range)!;const start=Number(a),end=Number(b);let data=new Uint8Array(bytes.subarray(start,end+1));if(defeito==='hash'){data=data.slice();data[0]^=1;}const status=defeito==='range'?200:206;pedidos.push({url:p,bytes:data.byteLength,status});return new Response(data,{status,headers:{'Content-Range':`bytes ${start}-${end}/${bytes.byteLength}`}});}
 pedidos.push({url:p,bytes:bytes.byteLength,status:200});return new Response(bytes);
};
const criar=(m=manifesto)=>criarAberturaPaineis({base:'https://teste/',manifesto:async()=>m,buscar});
const leve=criar();let comparacoes=0;
function mesmo(a:any,b:any,onde='resultado'){
 if(typeof a==='number'&&typeof b==='number'){assert.ok(Math.abs(a-b)<=Math.max(1e-6,Math.abs(b)*1e-12),`${onde}: ${a} ≠ ${b}`);return;}
 if(Array.isArray(a)||Array.isArray(b)){assert.ok(Array.isArray(a)&&Array.isArray(b),onde);assert.equal(a.length,b.length,onde);a.forEach((x,i)=>mesmo(x,b[i],onde+'['+i+']'));return;}
 if(a&&b&&typeof a==='object'&&typeof b==='object'){assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort(),onde);for(const k of Object.keys(a))mesmo(a[k],b[k],onde+'.'+k);return;}
 assert.equal(a,b,onde);
}
function ordenar(v:any){if(!v||typeof v!=='object'||Array.isArray(v))return v;const out={...v};for(const k of ['agregados','respostas','universo'])if(Array.isArray(out[k]))out[k]=[...out[k]].sort((a,b)=>JSON.stringify([a.ano,a.var,a.corte,a.grupo,a.valor_txt,a.valida]).localeCompare(JSON.stringify([b.ano,b.var,b.corte,b.grupo,b.valor_txt,b.valida])));return out;}
async function conferir(c:string,q:Record<string,string|number>={}){
 const [rapido,nativo]=await Promise.all([leve.executar(c,q),executar(c,q)]);
 assert.notEqual(rapido,USAR_MOTOR,`${c} ${JSON.stringify(q)} caiu no motor`);
 mesmo(ordenar(rapido),ordenar(nativo),c+' '+JSON.stringify(q));comparacoes++;
}
if(!process.env.AUDITORIA_SO_FALHAS){
await conferir('entes');
const scopes=[{}, {uf:'GO'}, {uf:'SP'}, {uf:'DF'}, {ente:5208707}, {ente:5208905}, {ente:3305505}, {ente:1504752}, {ente:5101837}, {ente:53}];
for(const q of scopes){
 await conferir('trab_serie',q);await conferir('trab_caged',q);
 for(const ano of [2010,2013,2024,2025]){
  await conferir('trab_setores',{...q,ano});await conferir('trab_perfis',{...q,ano});
 }
}
for(const q of [{},{uf:'GO'},{uf:'SP'},{uf:'DF'},{ente:5208707},{ente:53},{ente:52},{esfera:'E'}]){
 for(const ano of [2013,2024,2025]){
  await conferir('agregado',{...q,ano,por:'exercicio',campos:'receita_bruta,deducoes,receita_liquida,receita_corrente'});
  await conferir('agregado',{...q,ano,por:'exercicio',campos:'despesa_empenhada_sem_intra,despesa_liquidada_sem_intra,despesa_paga_sem_intra,despesa_intra,despesa_empenhada'});
  for(const dominio of ['receita','despesa'])await conferir('cobertura',{...q,ano,dominio});
 }
}
const edicoes=edicoesCuradas(CURADORIA);
for(const pesquisa of ['munic','estadic'] as const){
 await conferir('munic_territorios',{pesquisa,ano:edicoes[pesquisa][0]});
 const recortes=pesquisa==='munic'?[{}, {uf:'GO'},{uf:'SP'}, {cod:5208707}, {cod:5101837}, {cod:1504752}]:[{}, {uf:'GO'}, {uf:'DF'}];
 for(const q of recortes)for(const ano of [undefined,...edicoes[pesquisa]]){
  const params={pesquisa,...q,...(ano?{ano}:{})};await conferir('munic_painel',params);
 }
}
}
// Falha de integridade e formato preserva o caminho completo em cada domínio.
for(const falha of ['hash','range','raiz'] as const){
 defeito=falha;
 for(const [rota,q] of [['trab_serie',{ente:5208707}],['munic_painel',{pesquisa:'munic',cod:5208707}],['agregado',{ente:5208707,campos:'receita_bruta',por:'exercicio'}]] as const)
  assert.equal(await criar().executar(rota,q),USAR_MOTOR,`${falha}: ${rota}`);
}
defeito='nenhum';const mudou=structuredClone(manifesto);mudou.fontes.rais.processado_em='outra edição';assert.equal(await criar(mudou).executar('trab_serie',{}),USAR_MOTOR);
assert.equal(await leve.executar('agregado',{campos:'fpm',por:'exercicio'}),USAR_MOTOR);
assert.equal(await leve.executar('agregado',{campos:'receita_bruta',por:'exercicio',painel:1}),USAR_MOTOR);
assert.equal(await leve.executar('munic_painel',{pesquisa:'invalida'}),USAR_MOTOR);
const resultado={ok:true,comparacoes,pedidos:pedidos.length,bytes:pedidos.reduce((s,p)=>s+p.bytes,0),edicoes:edicoesCuradas(CURADORIA),nota:'Pacotes conferidos contra dados.ts; hashes/Range/atualização provocam fallback.'};
console.log(JSON.stringify(resultado,null,2));
if(process.env.AUDITORIA_ABERTURA)await writeFile(process.env.AUDITORIA_ABERTURA,JSON.stringify(resultado,null,2));
