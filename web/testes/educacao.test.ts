import assert from 'node:assert/strict';
import test from 'node:test';
import { linhaEducacao, type GrupoEducacao } from '../src/educacao_dados';
import { buscaEntreAreas } from '../src/navegacao';

const g: GrupoEducacao = {grupo:'BR',linhas:[[2023,6.1,100],[2024,null,0],[2025,null,null]],cobertura:{}};
test('a última referência é escolhida por indicador, preservando zero',()=>{
  assert.deepEqual(linhaEducacao(g,0,null),{ano:2023,valor:6.1});
  assert.deepEqual(linhaEducacao(g,1,null),{ano:2024,valor:0});
});
test('um ano pedido não é substituído pelo último Ideb',()=>{
  assert.deepEqual(linhaEducacao(g,0,2024),{ano:2024,valor:null});
  assert.equal(linhaEducacao(g,0,2026),null);
});
test('território acompanha a navegação entre Saúde e Educação',()=>{
  const q=new URLSearchParams(buscaEntreAreas('?uf=GO&ente=5208707&ano=2024','saude','educacao'));
  assert.equal(q.get('cod'),'5208707');assert.equal(q.get('uf'),'GO');assert.equal(q.get('ano'),'2024');
  const r=new URLSearchParams(buscaEntreAreas('?uf=GO&cod=5208707&ind=mat_total','educacao','saude'));
  assert.equal(r.get('ente'),'5208707');assert.equal(r.get('ind'),null);
});
test('SIOPE mantém os códigos do contexto financeiro e o DF',()=>{
  assert.equal(new URLSearchParams(buscaEntreAreas('?uf=DF&cod=5300108','educacao','financas')).get('ente'),'53');
  assert.equal(new URLSearchParams(buscaEntreAreas('?ente=5208707','educacao','educacao')).get('ente'),'5208707');
});
