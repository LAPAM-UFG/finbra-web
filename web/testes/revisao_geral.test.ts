import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buscaEntreAreas,buscaParaDownloads} from '../src/navegacao';
import {corresponde} from '../src/explorar_painel';
import {janelaTemporal,quebrarTextoImagem} from '../src/imagem_grafico';
const p=(s:string)=>Object.fromEntries(new URLSearchParams(s));

test('download traduz município, mantém tema/UF e não transfere filtros de cálculo',()=>{
 assert.deepEqual(p(buscaParaDownloads('?ente=5208707&ano=2024&ind=salario','trabalho')),{area:'trabalho',uf:'GO',cod:'5208707'});
 assert.deepEqual(p(buscaParaDownloads('?cod=5208707&rede=municipal&ano=2023','educacao')),{area:'educacao',uf:'GO',cod:'5208707',rede:'municipal'});
});
test('download distingue governo estadual, DF e base municipal',()=>{
 assert.deepEqual(p(buscaParaDownloads('?ente=52','financas')),{area:'financas',uf:'GO',governo:'1'});
 assert.deepEqual(p(buscaParaDownloads('?ente=52','educacao')),{area:'educacao',uf:'GO',governo:'1'});
 assert.deepEqual(p(buscaParaDownloads('?pesq=estadic&uf=GO','munic')),{area:'gestao',uf:'GO',governo:'1'});
 assert.deepEqual(p(buscaParaDownloads('?ente=53','financas')),{area:'financas',uf:'DF',cod:'5300108'});
});
test('o lugar escolhido nos downloads volta aos painéis usando o código correto',()=>{
 assert.deepEqual(p(buscaEntreAreas('?area=saude&uf=GO&cod=5208707','downloads','saude')),{uf:'GO',ente:'5208707'});
 assert.deepEqual(p(buscaEntreAreas('?area=educacao&uf=DF&cod=5300108&rede=publica','downloads','financas')),{uf:'DF',ente:'53'});
});
test('busca encontra palavras em campos diferentes, ignorando acento e caixa',()=>{
 assert.ok(corresponde('  RACA REMUNERACAO ',['Raça/cor','Remuneração média de dezembro']));
 assert.ok(corresponde('creche municipal',['Creche','Rede municipal']));
 assert.ok(!corresponde('creche estadual',['Creche','Rede municipal']));
 assert.ok(corresponde('',[]));
 assert.ok(!corresponde('raça',['Remuneração']));
 assert.ok(!corresponde('idade',['Escolaridade']));
});
test('PNG estreito preserva uma URL longa e limita a largura de cada linha',()=>{
 const url='https://finbra-web.luanviniciusbernardelli.workers.dev/clima?uf=GO&cod=5208707';
 const linhas=quebrarTextoImagem(url,s=>s.length,18);
 assert.equal(linhas.join(''),url);assert.ok(linhas.every(s=>s.length<=18));
 assert.deepEqual(quebrarTextoImagem('média de dezembro',s=>s.length,10),['média de','dezembro']);
});
test('janela do PNG usa os eixos do histórico e não códigos numéricos de categorias',()=>{
 assert.equal(janelaTemporal({series:[{type:'line'}],xAxis:[{data:[2010,2011,2025]}]}),'2010–2025');
 assert.equal(janelaTemporal({series:[{type:'heatmap'}],xAxis:[{data:['jan','fev']}],yAxis:[{data:['1981','2026']}]}),'1981–2026');
 assert.equal(janelaTemporal({series:[{type:'bar'}],xAxis:[{data:['2010','2030']}]}),'');
});
