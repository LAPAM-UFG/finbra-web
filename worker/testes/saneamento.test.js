import assert from 'node:assert/strict';
import test from 'node:test';
import {instrucoes,paineisDoPedido} from '../src/sistema_geral.js';
import {contextoSaneamento} from '../src/sistema_saneamento.js';
test('Saneamento é painel válido e usa catálogo independente',()=>{
 assert.deepEqual(paineisDoPedido(['saneamento']),['saneamento']);
 const text=instrucoes(['saneamento'],{saneamento:{gerado_em:'v1',indicadores:[{id:'agua_pop',nome:'Pessoas atendidas',unidade:'pessoas',anos:[2013,2024],snis:['AG001'],sinisa:['GTA0001+GTA0002'],descricao:'observado'}]}}).map(x=>x.text).join('\n');
 assert.match(text,/saneamento_indicadores/);assert.match(text,/Não trate 2022→2023/);assert.match(text,/agua_pop/);assert.doesNotMatch(text,/CREATE.*educacao_inep/);
});
test('catálogo ausente não sugere anos inventados',()=>assert.match(contextoSaneamento(null),/indisponível/));
