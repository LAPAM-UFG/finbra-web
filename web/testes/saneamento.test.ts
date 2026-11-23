import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {criarLeitorSan,linhaSan,linhasCompletasSan,posicoesSan,validarRefSan,type MetaSan} from '../src/saneamento_dados';
import {buscaEntreAreas,buscaParaDownloads} from '../src/navegacao';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function fixture(options:{badHash?:boolean;full?:boolean;wrongGroup?:boolean;missingStatus?:boolean;lazy?:boolean;badCatalog?:boolean}={}){
 const b=Buffer.from(JSON.stringify({grupo:options.wrongGroup?'GO':'BR',linhas:[[2024,0,options.missingStatus?null:0,0,10,1,2,0]]})+'\n');
 const ref={caminho:'gold/saneamento/territorios_abc.ndjson',bytes:b.length,sha256:sha(b)};
 const ter={grupo:'BR',nome:'Brasil',nivel:'BR',uf:null,cod_ibge:null,trecho:[0,b.length,options.badHash?'a'.repeat(64):sha(b)]};
 const m={versao:1,gerado_em:'2026-11-16',anos:[2013,2024],indicadores:[{id:'agua_cobertura_pct',anos:[2024]}],grupos:[ter],municipios:{},cadastro:{...ref,caminho:'gold/saneamento/cadastro_abc.json'},arquivo:ref,consulta:{...ref,caminho:'gold/saneamento/consulta_abc.parquet'},rankings:{},fontes:[],notas:[]}as unknown as MetaSan;
 const rb=Buffer.from(JSON.stringify({ano:2024,indicador:'agua_cobertura_pct',linhas:[[5208707,'Goiânia','GO',100,0]]}));const rr={caminho:'gold/saneamento/ranking_abc.json',bytes:rb.length,sha256:sha(rb)};const cb=Buffer.from(JSON.stringify({'agua_cobertura_pct:2024':rr}));if(options.lazy)m.catalogo_rankings={caminho:'gold/saneamento/catalogo_rankings_abc.json',bytes:cb.length,sha256:sha(cb)};
 const calls:{url:string;range?:string|null}[]=[];
 const buscar=(async(u:RequestInfo|URL,init?:RequestInit)=>{calls.push({url:String(u),range:new Headers(init?.headers).get('Range')});if(String(u).endsWith('/manifesto.json'))return Response.json(m);if(String(u).includes('catalogo_rankings_abc'))return new Response(options.badCatalog?Buffer.alloc(cb.length):cb);if(String(u).endsWith('/ranking_abc.json'))return new Response(rb);return new Response(b,{status:options.full?200:206,headers:{'Content-Range':`bytes 0-${b.length-1}/${b.length}`}});})as typeof fetch;
 return{leitor:criarLeitorSan('/dados/',buscar),m,ter:m.grupos[0],calls};
}
test('abertura usa catálogo e só um Range, preservando zero e cache',async()=>{
 const{leitor,ter,calls}=fixture();const g=await leitor.grupo(ter);assert.equal(g.linhas[0][2],0);await leitor.grupo(ter);assert.equal(calls.length,2);assert.match(calls[1].range!,/^bytes=0-/);assert.ok(calls.every(c=>!c.url.includes('wasm')&&!c.url.includes('parquet')));
});
for(const kind of ['badHash','full','wrongGroup','missingStatus']as const)test('recusa '+kind+' sem mostrar outro valor',async()=>{const{leitor,ter}=fixture({[kind]:true});await assert.rejects(leitor.grupo(ter));});
test('código inexistente não vira Brasil nem UF',async()=>{const{leitor}=fixture();await assert.rejects(leitor.territorio('0000000','GO'),/Código/);await assert.rejects(leitor.territorio('','XX'),/UF/);});
test('referência não escapa do namespace de saneamento',()=>{assert.throws(()=>validarRefSan({caminho:'gold/../segredo.json',bytes:1,sha256:'a'.repeat(64)}));});
test('ausência de registro e ano fora da fonte são estados distintos',()=>{const{m}=fixture();assert.equal(linhaSan(m,{grupo:'BR',linhas:[]},2024,0)[7],1);assert.equal(linhaSan(m,{grupo:'BR',linhas:[]},2013,0)[7],5);});
test('empates mantêm posições competitivas nas duas ordens',()=>{const rows:[number,string,string,number,number][]=[[1,'A','GO',100,0],[2,'B','GO',100,0],[3,'C','GO',90,0]];assert.deepEqual(posicoesSan(rows).map(x=>x.pos),[1,1,3]);assert.deepEqual(posicoesSan(rows,true).map(x=>x.pos),[1,2,2]);});
test('navegação conserva município e tema nos downloads',()=>{const q=new URLSearchParams(buscaParaDownloads('?uf=GO&ente=5208707&ano=2024','saneamento'));assert.equal(q.get('area'),'saneamento');assert.equal(q.get('cod'),'5208707');assert.equal(new URLSearchParams(buscaEntreAreas('?ente=5208707','saneamento','saude')).get('cod'),'5208707');});

test('exportação inclui os anos sem registro, preservando condição',()=>{const{m}=fixture();const rows=linhasCompletasSan(m,{grupo:'BR',linhas:[]});assert.equal(rows.length,2);assert.deepEqual(rows.map(l=>l[7]),[5,1]);});

test('município cadastrado sem resposta conserva cadastro unitário na exportação',()=>{const{m}=fixture();assert.equal(linhaSan(m,{grupo:'5101837',linhas:[]},2024,0)[6],1);assert.equal(linhaSan(m,{grupo:'5101837',linhas:[]},2024,0)[2],null);});

test('catálogo ampliado só é buscado ao comparar indicador e fica em cache',async()=>{const{leitor,ter,calls}=fixture({lazy:true});await leitor.grupo(ter);assert.equal(calls.length,2);const r=await leitor.ranking(2024,'agua_cobertura_pct');assert.equal(r.linhas[0][1],'Goiânia');assert.equal(calls.length,4);await leitor.ranking(2024,'agua_cobertura_pct');assert.equal(calls.length,4);});
test('ranking não usa um catálogo com conteúdo corrompido',async()=>{const{leitor}=fixture({lazy:true,badCatalog:true});await assert.rejects(leitor.ranking(2024,'agua_cobertura_pct'),/incompleto/);});

test('ano sem série retorna comparação vazia sem baixar catálogo nem simular falha de rede',async()=>{const{leitor,calls}=fixture({lazy:true});const r=await leitor.ranking(2013,'agua_cobertura_pct');assert.deepEqual(r.linhas,[]);assert.equal(calls.length,1);await assert.rejects(leitor.ranking(1990,'agua_cobertura_pct'),/Ano fora/);});
