import assert from 'node:assert/strict';
import test from 'node:test';
import {validarGrupoMob,type CatalogoMob,type GrupoMob} from '../src/mobilidade_dados';
import {buscaEntreAreas,buscaParaDownloads} from '../src/navegacao';
import {criarLeitorRaio,linkComparacaoRaio,type IndicadorRaio} from '../src/raio_x';
import type {GeografiaComparacao} from '../src/comparacoes_dados';

const cat={versao:1,anos:[2024,2025],indicadores:[{id:'mob_obitos'}],derivados:[{id:'mortes_100mil'}],condicoes:{}}as CatalogoMob;
const g:GrupoMob={versao:1,grupo:'5208905',anos:[2024,2025],valores:[[0],[null]],condicoes:[[1],[2]],derivados:[[0],[null]],condicoes_derivados:[[1],[2]],numeradores:[[0],[null]],denominadores:[[1000],[null]],coberturas:[[1],[0]],residuos:{}};
test('zero de óbitos registrado não preenche SIM fora da cobertura',()=>{
 assert.doesNotThrow(()=>validarGrupoMob(g,'5208905',cat));
 assert.throws(()=>validarGrupoMob({...g,valores:[[0],[0]]},'5208905',cat));
 assert.throws(()=>validarGrupoMob(g,'5208707',cat));
 assert.throws(()=>validarGrupoMob({...g,condicoes_derivados:[[1],[0]]},'5208905',cat));
 assert.throws(()=>validarGrupoMob({...g,denominadores:[[1000],[-1]]},'5208905',cat));
 assert.throws(()=>validarGrupoMob({...g,derivados:[[Infinity],[null]]},'5208905',cat));
});
test('município, DF, ano e tema acompanham a navegação',()=>{
 assert.equal(buscaEntreAreas('?ente=53&ano=2024','saude','mobilidade'),'?uf=DF&cod=5300108&ano=2024');
 assert.equal(buscaEntreAreas('?cod=5208905&uf=GO&ano=2024','mobilidade','saude'),'?uf=GO&ente=5208905&ano=2024');
 assert.equal(new URLSearchParams(buscaParaDownloads('?cod=5208905&uf=GO','mobilidade')).get('area'),'mobilidade');
});
test('contagem original abre Mobilidade e não uma comparação absoluta',()=>{
 const geo={territorios:{'5208905':{nivel:'M',uf:'GO'}}}as unknown as GeografiaComparacao;
 const i={id:'mob_obitos',catalogo:'mobilidade_original',area:'mobilidade'}as IndicadorRaio;
 const url=new URL(linkComparacaoRaio(i,'5208905',geo,2024),'https://example.test');assert.equal(url.pathname,'/mobilidade');assert.equal(url.searchParams.get('ind'),'mob_obitos');assert.equal(url.searchParams.get('ano'),'2024');
});
test('Raio X usa edição nova e mantém fallback para clientes de nove áreas',async()=>{
 const ref={caminho:'gold/raiox/catalogo_abc.json',bytes:1,sha256:'a'.repeat(64)};const urls:string[]=[];
 const f=(async(url:string|URL|Request)=>{urls.push(String(url));return String(url).includes('v3_manifesto')?new Response('',{status:404}):Response.json({versao:1,indices:{referencias:ref},anos:[2024],indicadores:1,catalogo:ref,geografia:ref});})as typeof fetch;
 await criarLeitorRaio(f,'https://example.test/').meta();assert.deepEqual(urls,['https://example.test/gold/raiox/v3_manifesto.json','https://example.test/gold/raiox/v2_manifesto.json']);
});
