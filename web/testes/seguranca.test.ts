import assert from 'node:assert/strict';
import test from 'node:test';
import {validarGrupoSeg,alturaMesesSeg,type CatalogoSeg,type GrupoSeg} from '../src/seguranca_dados';
import {buscaEntreAreas,buscaParaDownloads} from '../src/navegacao';
import {linkComparacaoRaio,type IndicadorRaio} from '../src/raio_x';
import {validarSerieComparacao,type GeografiaComparacao} from '../src/comparacoes_dados';
const cat={versao:1,anos:[2024,2025],indicadores:[{id:'sec_sn_homicidio'}],derivados:[{id:'sn_homicidio_100mil'}],condicoes:{}}as CatalogoSeg;
const g:GrupoSeg={versao:1,grupo:'5208905',anos:[2024,2025],valores:[[0],[3]],condicoes:[[23],[11]],derivados:[[null],[null]],condicoes_derivados:[[23],[24]],numeradores:[[0],[3]],denominadores:[[1000],[1000]],coberturas:[[0],[0]],residuos:{}};
test('zeros da UF e contagens parciais permanecem nas contagens sem gerar taxas',()=>{
 assert.doesNotThrow(()=>validarGrupoSeg(g,'5208905',cat));assert.throws(()=>validarGrupoSeg({...g,derivados:[[0],[3]]},'5208905',cat));assert.throws(()=>validarGrupoSeg({...g,valores:[[1],[3]]},'5208905',cat));assert.throws(()=>validarGrupoSeg(g,'5300108',cat));
});
test('série comparável conserva motivo das ausências e recusa taxa com cobertura não confirmada',()=>{
 const s={v:[null,null],n:[0,3],d:[1000,1000],c:[23,24],q:[0,0]};assert.doesNotThrow(()=>validarSerieComparacao(s,2,1));assert.throws(()=>validarSerieComparacao({...s,v:[0,null]},2,1));
});
test('mês ausente e mês sem óbitos têm representações diferentes',()=>{assert.deepEqual(alturaMesesSeg([0,null,2,1]),[0,null,100,50]);assert.deepEqual(alturaMesesSeg([null,null]),[null,null]);});
test('território, DF e ano acompanham Segurança e downloads',()=>{
 assert.equal(buscaEntreAreas('?ente=53&ano=2024','saude','seguranca'),'?uf=DF&cod=5300108&ano=2024');assert.equal(buscaEntreAreas('?cod=5208905&uf=GO&ano=2024','seguranca','mobilidade'),'?uf=GO&cod=5208905&ano=2024');assert.equal(new URLSearchParams(buscaParaDownloads('?cod=5208905&uf=GO','seguranca')).get('area'),'seguranca');
});
test('contagem original abre o painel, sem comparação absoluta entre lugares',()=>{
 const geo={territorios:{'5208905':{nivel:'M',uf:'GO'}}}as unknown as GeografiaComparacao;const i={id:'sec_agressoes',catalogo:'seguranca_original',area:'seguranca'}as IndicadorRaio;const url=new URL(linkComparacaoRaio(i,'5208905',geo,2024),'https://example.test');assert.equal(url.pathname,'/seguranca');assert.equal(url.searchParams.get('ind'),'sec_agressoes');assert.equal(url.searchParams.get('ano'),'2024');
});
