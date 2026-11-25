import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarBuscaDados } from '../src/buscar_dados';

test('leitura saudavel faz uma unica requisicao, sem espera', async () => {
  let chamadas=0, pausas=0;
  const buscar=criarBuscaDados(async()=>{chamadas++;return new Response('dados');},async()=>{pausas++;});
  assert.equal(await (await buscar('/dados/teste')).text(),'dados');
  assert.equal(chamadas,1);assert.equal(pausas,0);
});

test('falha temporaria preserva URL, intervalo e sinal ao repetir uma vez', async () => {
  const chamadas: Array<[unknown,RequestInit|undefined]>=[];
  const init={headers:{Range:'bytes=40-79'},signal:new AbortController().signal};
  const buscar=criarBuscaDados(async(u,i)=>{chamadas.push([u,i]);return chamadas.length===1?new Response('falha',{status:500}):new Response('trecho',{status:206});},async()=>{});
  assert.equal((await buscar('/dados/v/20261125/arquivo',init)).status,206);
  assert.deepEqual(chamadas,[['/dados/v/20261125/arquivo',init],['/dados/v/20261125/arquivo',init]]);
});

test('nao repete ausencia definitiva nem escrita; falha persistente e limitada', async () => {
  for(const [status,method,esperado]of [[404,'GET',1],[503,'POST',1],[503,'GET',2]]as const){
    let n=0;const buscar=criarBuscaDados(async()=>{n++;return new Response(null,{status});},async()=>{});
    assert.equal((await buscar('/dados/teste',{method})).status,status);assert.equal(n,esperado);
  }
});

test('falha de rede recupera uma vez; cancelamento impede a repeticao', async () => {
  let n=0;const buscar=criarBuscaDados(async()=>{if(!n++)throw new TypeError('rede');return new Response('ok');},async()=>{});
  assert.equal(await(await buscar('/dados/teste')).text(),'ok');assert.equal(n,2);
  const c=new AbortController();let chamadas=0;
  const cancelado=criarBuscaDados(async()=>{chamadas++;c.abort();throw new DOMException('Cancelado','AbortError');},async()=>{});
  await assert.rejects(cancelado('/dados/teste',{signal:c.signal}),{name:'AbortError'});assert.equal(chamadas,1);
});
