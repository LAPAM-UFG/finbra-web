import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import worker from '../src/index.js';

const origin='https://painel.example';
const api='/api/dados/v1';
const hash='a'.repeat(64);

function fixture() {
  const store=new Map(); const calls=[];
  const add=(key,body)=>{store.set(key,Buffer.from(body));return {caminho:key,bytes:Buffer.byteLength(body),sha256:hash};};
  const arquivo=(uf,area,fmt)=>{
    const id=`painel_${area??'todos'}_${uf??'BR'}_${fmt.replace('.','_')}`;
    return {id,tipo:area?'area':'painel',area,uf,formato:fmt,nome:id,nome_en:id,descricao:'',descricao_en:'',linhas:2,variaveis:1,ano_de:2024,ano_ate:2025,...add(`gold/downloads/${id}.${fmt}`,`dados:${uf??'BR'}:${area??'todos'}:${fmt}`)};
  };
  const basics=['dta','rds','parquet','csv.zip'].map(f=>arquivo(null,null,f));
  const regional=['dta','rds','parquet','csv.zip'].map(f=>arquivo('GO','saude',f));
  const keys=['cod_ibge','municipio','uf','regiao','tipo_territorio','ano','valor'];
  const sample={versao:1,id:'painel_saude_GO',uf:'GO',area:'saude',linhas_total:2,ano_de:2024,ano_ate:2025,colunas:keys.map(k=>({variavel:k,nome:k,unidade:'número',anos:[2024],preenchidas:1})),amostra:[{cod_ibge:5208707,municipio:'Goiânia',uf:'GO',regiao:'Centro-Oeste',tipo_territorio:'municipio',ano:2024,valor:0}]};
  const preview=add('gold/downloads/previa_go.json',JSON.stringify(sample));
  for(const a of regional)a.previa=preview;
  const dictionary=add('gold/downloads/dicionario.json',JSON.stringify([{variavel:'cod_ibge',area:'identificacao'},{variavel:'valor',area:'saude'},{variavel:'outra',area:'trabalho'}]));
  const m={versao:1,edicao:'enxuta_2013',gerado_em:'2026-11-14T00:00:00Z',base_gerado_em:'2026-11-14',base_sha256:hash,base_ipca:2025,resumo:{municipios:1,linhas:2,variaveis:1,variaveis_detalhadas:0,ano_de:2024,ano_ate:2025},areas:[{id:'saude',nome:'Saúde',nome_en:'Health',descricao:'',descricao_en:''}],notas:[],dicionario:dictionary,arquivos:basics,recortes_uf:{GO:add('gold/downloads/catalogo_go.json',JSON.stringify({versao:1,uf:'GO',arquivos:regional}))}};
  store.set('gold/downloads/manifesto.json',Buffer.from(JSON.stringify(m)));
  const env={DADOS:{
    async head(key){calls.push(key);const b=store.get(key);return b ? {size:b.length,httpEtag:'"'+createHash('md5').update(b).digest('hex')+'"'} : null;},
    async get(key,options={}){
      calls.push(key);const b=store.get(key);if(!b)return null;
      const meta={size:b.length,httpEtag:'"'+createHash('md5').update(b).digest('hex')+'"'};
      if(options.onlyIf?.get('if-none-match')===meta.httpEtag)return meta;
      const r=options.range?.get('range')?.match(/^bytes=(\d+)-(\d+)$/);
      return r ? {...meta,range:{offset:+r[1],length:+r[2]-r[1]+1},body:b.subarray(+r[1],+r[2]+1)} : {...meta,body:b};
    },
  },ASSETS:{fetch:async req=>new Response(req.method==='HEAD'?null:'# cliente R',{headers:{'Content-Type':'text/plain'}})}};
  const fetch=(path,init)=>worker.fetch(new Request(origin+path,init),env);
  return {m,store,calls,env,regional,fetch};
}

for(const fmt of ['dta','rds','parquet','csv.zip'])test(`arquivo ${fmt} usa UF e tema exatos, sem login`,async()=>{
  const f=fixture();const r=await f.fetch(`${api}/painel/GO/saude.${fmt}`);
  assert.equal(r.status,200);assert.equal(await r.text(),`dados:GO:saude:${fmt}`);
  assert.equal(r.headers.get('X-Finbra-SHA256'),hash);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(r.headers.get('Cache-Control'),'no-cache');
  assert(f.calls.every(k=>k.startsWith('gold/downloads/')));
});

test('query e caminho identificam o mesmo arquivo; BR padrão preserva a base completa',async()=>{
  const f=fixture();const q=await f.fetch(`${api}/painel.dta?uf=go&tema=saude`);assert.equal(await q.text(),'dados:GO:saude:dta');
  const main=await f.fetch(`${api}/painel.dta`);assert.equal(await main.text(),'dados:BR:todos:dta');
  assert.equal((await f.fetch(`${api}/painel/SP/saude.dta`)).status,404);
});

test('catálogo fornece hash e URL imutável do recorte exato',async()=>{
  const f=fixture();const b=await (await f.fetch(`${api}/catalogo.json?uf=GO&tema=saude`)).json();
  assert.equal(b.arquivos.length,4);assert(b.arquivos.every(a=>a.uf==='GO'&&a.tema==='saude'));
  assert(b.arquivos.every(a=>a.url_imutavel.startsWith(origin+'/dados/gold/downloads/')));
  assert.equal(b.api_versao,'v1');
});

test('dicionário inclui indicadores adicionais no tema, preservando a seleção principal',async()=>{
 const f=fixture();
 f.store.set(f.m.dicionario.caminho,Buffer.from(JSON.stringify([{variavel:'cod_ibge',area:'identificacao'},{variavel:'valor',area:'saude'},{variavel:'extra',area:'saude',arquivo_principal:false}])));
 const main=await (await f.fetch(`${api}/dicionario.json`)).json();
 const themed=await (await f.fetch(`${api}/dicionario.json?tema=saude`)).json();
 assert.deepEqual(main.map(e=>e.variavel),['cod_ibge','valor']);
 assert.deepEqual(themed.map(e=>e.variavel),['cod_ibge','valor','extra']);
 assert.equal(themed[2].arquivo_principal,false);
});

test('HEAD padrão e Range não alteram a rota de dados anterior',async()=>{
  const f=fixture();const h=await f.fetch(`${api}/painel/GO/saude.dta`,{method:'HEAD'});
  assert.equal(h.status,200);assert.equal(await h.text(),'');assert(h.headers.get('Content-Length'));assert.equal(h.headers.get('Content-Range'),null);
  const r=await f.fetch(`${api}/painel/GO/saude.dta`,{headers:{Range:'bytes=0-4'}});assert.equal(r.status,206);assert.equal(await r.text(),'dados');
  const old=await f.fetch('/dados/'+f.regional[0].caminho,{method:'HEAD'});assert.equal(old.status,206);
});

test('ETag permite 304 e OPTIONS responde sem ler arquivos',async()=>{
  const f=fixture();const p=`${api}/painel/GO/saude.dta`;const first=await f.fetch(p);
  const cached=await f.fetch(p,{headers:{'If-None-Match':first.headers.get('ETag')}});assert.equal(cached.status,304);
  f.calls.length=0;const options=await f.fetch(p,{method:'OPTIONS'});assert.equal(options.status,204);assert.equal(f.calls.length,0);
});

test('amostra mantém zero e não se apresenta como a base completa',async()=>{
  const f=fixture();const b=await (await f.fetch(`${api}/amostra.json?uf=GO&tema=saude`)).json();
  assert.equal(b.tipo,'amostra');assert.equal(b.amostra[0].valor,0);assert.equal(b.linhas_total,2);assert.equal(b.amostra.length,1);
});

test('dicionário JSON filtra o tema mantendo identificadores',async()=>{
  const f=fixture();const b=await (await f.fetch(`${api}/dicionario.json?tema=saude`)).json();assert.deepEqual(b.map(d=>d.variavel),['cod_ibge','valor']);
});

test('cliente R é entregue como texto e não permite escolher outro recurso',async()=>{
  const f=fixture();const r=await f.fetch(`${api}/cliente.R`);assert.equal(r.status,200);const body=await r.text();assert(body.startsWith('# cliente R'));assert(body.includes('.finbra_base <- "'+origin+api+'"'));
  assert.equal((await f.fetch(`${api}/cliente.R?url=https://fora.example`)).status,400);
});

for(const query of ['uf=XX','tema=fora','ano=2024','uf=GO&uf=SP','variaveis=valor'])test(`recusa parâmetro inválido ou não suportado: ${query}`,async()=>{
  const f=fixture();const r=await f.fetch(`${api}/painel.dta?${query}`);assert.equal(r.status,400);assert((await r.json()).erro.codigo);
});

test('POST e versões desconhecidas têm erro explícito',async()=>{
  const f=fixture();assert.equal((await f.fetch(`${api}/painel.dta`,{method:'POST'})).status,405);
  assert.equal((await f.fetch('/api/dados/v2/painel.dta')).status,404);
});

test('arquivo, catálogo ou leitura corrompidos falham sem expor detalhes internos',async()=>{
  const f=fixture();f.m.arquivos[0].caminho='raw/privado';f.store.set('gold/downloads/manifesto.json',Buffer.from(JSON.stringify(f.m)));
  assert.equal((await f.fetch(`${api}/painel.dta`)).status,503);assert(!f.calls.includes('raw/privado'));
  const g=fixture();g.store.delete(g.regional[0].caminho);assert.equal((await g.fetch(`${api}/painel/GO/saude.dta`)).status,503);
  const z=fixture();z.env.DADOS.get=async()=>{throw Error('SEGREDO_INTERNO');};const r=await z.fetch(`${api}/painel.dta`);assert.equal(r.status,503);assert(!JSON.stringify(await r.json()).includes('SEGREDO'));
});

test('rede de ensino seleciona arquivos prontos distintos e preserva a API anterior',async()=>{
 const f=fixture();f.m.areas.push({id:'educacao',nome:'Educação',nome_en:'Education',descricao:'',descricao_en:''});
 for(const rede of ['todas','municipal'])for(const fmt of ['dta','rds','parquet','csv.zip']){
  const a={...f.m.arquivos.find(a=>a.formato===fmt),tipo:'area',area:'educacao',rede,id:'educacao_'+rede+'_'+fmt.replace('.','_'),caminho:'gold/downloads/educacao_'+rede+'.'+fmt};
  const raw=Buffer.from(rede+':'+fmt);a.bytes=raw.length;f.store.set(a.caminho,raw);f.m.arquivos.push(a);
 }
 f.store.set('gold/downloads/manifesto.json',Buffer.from(JSON.stringify(f.m)));
 for(const fmt of ['dta','rds','parquet','csv.zip']){
  const r=await f.fetch(`${api}/painel/BR/educacao.${fmt}?rede=municipal`);assert.equal(r.status,200);assert.equal(await r.text(),'municipal:'+fmt);
  assert(r.headers.get('Content-Disposition').includes('_municipal.'));
 }
 assert.equal(await (await f.fetch(`${api}/painel.dta?tema=educacao`)).text(),'todas:dta');
 const c=await (await f.fetch(`${api}/catalogo.json?tema=educacao&rede=municipal`)).json();
 assert.equal(c.arquivos.length,4);assert(c.arquivos.every(a=>a.rede==='municipal'&&a.url.endsWith('?rede=municipal')));
 for(const q of ['tema=saude&rede=municipal','tema=educacao&rede=errada','tema=educacao&rede=municipal&rede=estadual'])assert.equal((await f.fetch(`${api}/painel.dta?${q}`)).status,400);
});
