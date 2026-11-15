import assert from 'node:assert/strict';
import test from 'node:test';
import { linhaEducacao,filtrarMunicipiosEducacao,municipioExatoEducacao,ufMunicipioEducacao, type GrupoEducacao } from '../src/educacao_dados';
import { buscaEntreAreas } from '../src/navegacao';

const g: GrupoEducacao = {grupo:'BR',linhas:[[2023,6.1,100],[2024,null,0],[2025,null,null]],cobertura:{}};
const cidades=[{grupo:'5208707',nome:'Goiânia',uf:'GO'},{grupo:'5201405',nome:'Aparecida de Goiânia',uf:'GO'},{grupo:'2201903',nome:'Bom Jesus',uf:'PI'},{grupo:'4302303',nome:'Bom Jesus',uf:'RS'}];
test('busca nacional encontra nome sem acento e código sem pedir estado',()=>{
 assert.equal(filtrarMunicipiosEducacao(cidades,'goiania')[0].grupo,'5208707');
 assert.equal(municipioExatoEducacao(filtrarMunicipiosEducacao(cidades,'goiania'),'goiania')?.grupo,'5208707');
 assert.equal(filtrarMunicipiosEducacao(cidades,'4302303')[0].uf,'RS');
 assert.equal(ufMunicipioEducacao('5300108'),'DF');assert.equal(ufMunicipioEducacao('0000000'),undefined);
});
test('homônimos precisam de escolha explícita, com UF/código para distinguir',()=>{
 const r=filtrarMunicipiosEducacao(cidades,'Bom Jesus');assert.equal(r.length,2);
 assert.equal(municipioExatoEducacao(r,'Bom Jesus'),undefined);
 assert.equal(filtrarMunicipiosEducacao(cidades,'Bom Jesus RS')[0].grupo,'4302303');
 assert.equal(filtrarMunicipiosEducacao(cidades,'inexistente').length,0);
});
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
