import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PAINEIS,paineisDoPedido,instrucoes} from '../src/sistema_geral.js';
import {FERRAMENTAS} from '../src/ia.js';
import {NOVOS_PAINEIS} from '../src/sistema_paineis.js';
test('seis temas preparados integram contrato, ferramenta e instruções com fonte e limites',()=>{
 assert.equal(Object.keys(PAINEIS).length,14);
 const f=FERRAMENTAS.find(f=>f.name==='consultar_painel');assert.ok(f);
 for(const tema of Object.keys(NOVOS_PAINEIS)){
  assert.ok(paineisDoPedido([tema]).includes(tema));assert.ok(f.input_schema.properties.tema.enum.includes(tema));
  const texto=instrucoes([tema],{temasPreparados:{[tema]:{anos:[2013,2024],gerado_em:'2026-11-21T00:00:00Z'}}}).map(x=>x.text).join('\n');
  assert.ok(texto.includes('consultar_painel'));assert.ok(texto.includes('2013'));assert.ok(texto.includes('NULL nunca é zero'));
 }
});
