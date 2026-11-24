import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {criarLeitorRaio} from '../src/raio_x';
import {criarAberturaPaineis} from '../src/abertura_paineis';
import {USAR_MOTOR} from '../src/clima_abertura';
import {baseFiscalPronta,classificarFiscal,rankingFiscalPronto,comparadorFiscalPronto} from '../src/fiscal_pronto';
import {permiteParticaoFiscal,sqlClassificacao} from '../src/dados';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');

test('Comex lê o JSON gzip legado com todas as verificações de integridade',async()=>{
 const raw=Buffer.from(JSON.stringify({versao:1,indicadores:[{id:'cex_exp_fob'}]}));const b=gzipSync(raw);
 const ref={caminho:'gold/comex/catalogo_'+sha(b).slice(0,16)+'.json_'+sha(b).slice(0,16)+'.gz',bytes:b.length,sha256:sha(b),json_bytes:raw.length,json_sha256:sha(raw)};
 let n=0;const leitor=criarLeitorRaio((async()=>{n++;return new Response(b);})as typeof fetch,'https://dados.invalid/');
 assert.deepEqual(await leitor.objeto(ref),JSON.parse(raw.toString()));await leitor.objeto(ref);assert.equal(n,1);
 await assert.rejects(leitor.objeto({...ref,sha256:'0'.repeat(64)}),/incompleto/);
 await assert.rejects(leitor.objeto({...ref,json_sha256:'0'.repeat(64)}),/descompactados incompletos/);
 await assert.rejects(leitor.objeto({...ref,caminho:'gold/comex/../catalogo.json.gz'}),/Referência/);
 await assert.rejects(leitor.objeto({...ref,caminho:'gold/comex/catalogo.json_invalido.gz'}),/Referência/);
 await assert.rejects(leitor.objeto({...ref,json_bytes:raw.length-1}),/excessivos/);
});

test('a classificação nacional impede a substituição pela partição da UF também na evolução',()=>{
 assert.equal(permiteParticaoFiscal('SELECT * FROM indicadores WHERE uf=$uf'),true);
 const base=sqlClassificacao('SELECT * FROM indicadores',{ordem:'DESC',constante:false});
 assert.equal(permiteParticaoFiscal('WITH '+base+' SELECT * FROM r WHERE uf=$uf'),false);
 assert.equal(permiteParticaoFiscal('WITH '+base+' SELECT * FROM base WHERE cod_ibge=$ente'),false);
});

const dados=[
 {cod_ibge:1,nome:'A',uf:'SP',populacao:10,populacao_ibge:20,receita_bruta:100,pib:2000,receita_ok:true,exclui_receita:false},
 {cod_ibge:2,nome:'B',uf:'MG',populacao:10,populacao_ibge:10,receita_bruta:300,pib:2000,receita_ok:true,exclui_receita:false},
 {cod_ibge:3,nome:'C',uf:'SP',populacao:10,populacao_ibge:10,receita_bruta:100,pib:null,receita_ok:true,exclui_receita:false},
 {cod_ibge:4,nome:'Zero',uf:'SP',populacao:10,populacao_ibge:10,receita_bruta:0,pib:0,receita_ok:true,exclui_receita:false},
 {cod_ibge:5,nome:'Negativo',uf:'SP',populacao:10,populacao_ibge:10,receita_bruta:-100,pib:0,receita_ok:true,exclui_receita:false},
 {cod_ibge:6,nome:'Excluído',uf:'SP',populacao:10,populacao_ibge:10,receita_bruta:500,pib:0,receita_ok:true,exclui_receita:true},
];
test('ranking pronto preserva universo nacional, empates, zero, negativos, destaque e exportação',()=>{
 const q={per_capita:1,uf:'SP',ente:1,limite:2,pagina:1};const a=rankingFiscalPronto(dados,'receita_bruta',q);
 assert.equal(a.ente?.posicao_br,2);assert.equal(a.ente?.posicao_uf,1);assert.equal(a.ente?.total_br,5);assert.equal(a.ente?.total_uf,4);
 assert.deepEqual(a.itens.map(i=>i.posicao_br),[2,2]);assert.equal(a.elegiveis,4);assert.equal(a.zeros,1);assert.equal(a.negativos,1);assert.equal(a.fora,1);
 const tudo=rankingFiscalPronto(dados,'receita_bruta',{...q,todos:1});assert.equal(tudo.itens.length,4);assert.deepEqual(tudo.itens.map(i=>i.posicao_uf),[1,1,3,4]);
 const br=rankingFiscalPronto(dados,'receita_bruta',{...q,uf:undefined,todos:1});assert.deepEqual(br.ente,a.ente);
 assert.equal(rankingFiscalPronto(dados,'receita_bruta',{...q,tratamento:'declarado'}).ente?.posicao_br,3);
 assert.equal(rankingFiscalPronto(dados,'receita_bruta',{...q,ordem:'asc'}).itens[0].valor,-100);
});
test('PIB usa população IBGE sem modificar população DCA dos outros campos',()=>{
 assert.equal(baseFiscalPronta(dados,'pib',true,'filtrado')[0].indicador,100);
 assert.equal(baseFiscalPronta(dados,'receita_bruta',true,'filtrado')[0].indicador,10);
 assert.equal(classificarFiscal(baseFiscalPronta(dados,'pib',true,'filtrado'))[0].cod_ibge,2);
 const c=baseFiscalPronta([{...dados[0],populacao_ibge:0}], 'pib',true,'filtrado')[0];assert.equal(c.indicador,null);assert.equal(c.motivo,'sem_populacao');
});
test('comparador da árvore conserva UF, estados, Brasil e a exceção do DF',()=>{
 const todos:[[number,string,string],[number,string,string],[number,string,string]]=[[3509502,'SP','M'],[35,'SP','E'],[53,'DF','D']];
 assert.deepEqual(comparadorFiscalPronto('ente:3509502',todos),{grupo:'M:SP',rotulo:'SP'});
 assert.deepEqual(comparadorFiscalPronto('ente:35',todos),{grupo:'E:BR',rotulo:'Estados'});
 assert.equal(comparadorFiscalPronto('ente:53',todos),null);assert.equal(comparadorFiscalPronto('M:BR',todos),null);
 assert.deepEqual(comparadorFiscalPronto('M:SP',todos),{grupo:'M:BR',rotulo:'Brasil'});
});

test('arquivos prontos reais reproduzem a classificação SQL nacional em todos os campos e anos',{skip:!process.env.FISCAL_CANDIDATO},()=>{
 const root=process.env.FISCAL_CANDIDATO!;const refs=JSON.parse(readFileSync(path.join(root,'gold/abertura/manifesto.json'),'utf8')).fiscal_ranking;
 const expected=JSON.parse(readFileSync(path.join(root,'verificacao_fiscal_sql.json'),'utf8'));
 for(const [ano,ref]of Object.entries(refs.anos)as [string,{caminho:string}][]){
  const t=JSON.parse(gunzipSync(readFileSync(path.join(root,ref.caminho))).toString());
  const rows=t.linhas.map((r:unknown[])=>Object.fromEntries(t.colunas.map((c:string,k:number)=>[c,r[k]])));
  for(const campo of refs.campos)for(const pc of [false,true])for(const tratado of ['filtrado','declarado'])for(const asc of [false,true]){
   const itens=classificarFiscal(baseFiscalPronta(rows,campo,pc,tratado),asc);
   const list=itens.map(i=>[i.cod_ibge,i.posicao_br,i.posicao_uf,i.total_br,i.total_uf]).sort((a,b)=>a[0]!-b[0]!);
   const key=[ano,campo,pc?1:0,tratado,asc?1:0].join(':');assert.equal(sha(JSON.stringify(list)),expected[key],key);
  }
 }
});

test('leitor completo reproduz todas as contas/colunas, referências e tratamentos da árvore SQL',{skip:!process.env.FISCAL_CANDIDATO},async()=>{
 const root=process.env.FISCAL_CANDIDATO!,base=path.join(root,'../base');
 const caches=[root,base,process.env.DATA_DIR!];let reads=0,corromper=false;
 const buscar=(async(u:RequestInfo|URL,init?:RequestInit)=>{
  const key=String(u).replace('https://dados.invalid/','');const p=caches.map(c=>path.join(c,key)).find(p=>existsSync(p));assert.ok(p,key);
  const b=readFileSync(p),range=new Headers(init?.headers).get('Range');
  if(range){reads++;const m=/bytes=(\d+)-(\d+)/.exec(range)!;const a=Number(m[1]),z=Number(m[2]);const bytes=b.subarray(a,z+1);if(corromper)bytes[0]^=1;
   return new Response(bytes,{status:206,headers:{'Content-Range':`bytes ${a}-${z}/${b.length}`}});}
  return new Response(b);
 })as typeof fetch;
 const manifesto=JSON.parse(readFileSync(path.join(root,'gold/manifesto.json'),'utf8'));
 const leitor=criarAberturaPaineis({base:'https://dados.invalid/',buscar,manifesto:async()=>manifesto});
 const cases=JSON.parse(readFileSync(path.join(root,'verificacao_arvore_sql.json'),'utf8'));
 for(const c of cases)assert.deepEqual(await leitor.executar('arvore',c.q),c.esperado,JSON.stringify(c.q));
 const alertas=JSON.parse(readFileSync(path.join(root,'verificacao_alertas_sql.json'),'utf8'));
 assert.deepEqual(await leitor.executar('alertas'),alertas,'lista completa, incluindo motivos, evidências e fontes');
 for(const cod of [3509502,5101837,alertas[0].cod_ibge])assert.deepEqual(await leitor.executar('alertas',{ente:cod}),alertas.filter((a:{cod_ibge:number})=>a.cod_ibge===cod));
 const anterior=reads;await leitor.executar('arvore',cases[0].q);assert.equal(reads,anterior,'trecho é reutilizado entre colunas');
 assert.equal(await leitor.executar('arvore',{...cases[0].q,anexo:'I-D'}),USAR_MOTOR);
 corromper=true;const novo=criarAberturaPaineis({base:'https://dados.invalid/',buscar,manifesto:async()=>manifesto});
 assert.equal(await novo.executar('arvore',cases[0].q),USAR_MOTOR,'integridade falha sem entregar uma árvore parcial');
});
