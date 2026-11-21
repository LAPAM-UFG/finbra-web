import assert from 'node:assert/strict';
import test from 'node:test';
import {validarGrupoEne,type CatalogoEne,type GrupoEne} from '../src/energia_dados';
import {buscaEntreAreas,buscaParaDownloads} from '../src/navegacao';
import {criarLeitorRaio,linkComparacaoRaio,type IndicadorRaio} from '../src/raio_x';
import type {GeografiaComparacao} from '../src/comparacoes_dados';
const cat={versao:1,anos:[2013,2026],indicadores:[{id:'ene_siga_op_mw'}],derivados:[{id:'gd_1000hab'}],condicoes:{}}as CatalogoEne;
const g:GrupoEne={versao:1,grupo:'5208905',anos:[2013,2026],valores:[[null],[null]],condicoes:[[5],[2]],derivados:[[null],[10]],condicoes_derivados:[[5],[0]],numeradores:[[null],[10]],denominadores:[[null],[1000]],coberturas:[[0],[1]],residuos:{}};
test('ausência de retrato histórico e potência compartilhada não viram zero',()=>{
 assert.doesNotThrow(()=>validarGrupoEne(g,'5208905',cat));
 assert.throws(()=>validarGrupoEne({...g,valores:[[0],[null]]},'5208905',cat));
 assert.throws(()=>validarGrupoEne({...g,valores:[[null],[0]]},'5208905',cat));
 assert.throws(()=>validarGrupoEne(g,'5300108',cat));
});
test('denominador zero continua indefinido e componentes negativos são recusados',()=>{
 assert.doesNotThrow(()=>validarGrupoEne({...g,derivados:[[null],[null]],condicoes_derivados:[[5],[4]],denominadores:[[null],[0]]},'5208905',cat));
 assert.throws(()=>validarGrupoEne({...g,numeradores:[[null],[-1]]},'5208905',cat));
});
test('município, DF, ano e download acompanham a navegação de Energia',()=>{
 assert.equal(buscaEntreAreas('?ente=53&ano=2026','saude','energia'),'?uf=DF&cod=5300108&ano=2026');
 assert.equal(buscaEntreAreas('?cod=5208905&uf=GO&ano=2013','energia','educacao'),'?uf=GO&cod=5208905&ano=2013');
 assert.equal(new URLSearchParams(buscaParaDownloads('?cod=5208905&uf=GO','energia')).get('area'),'energia');
});
test('Raio X abre o indicador original e preserva o ano da coorte',()=>{
 const geo={territorios:{'5208905':{nivel:'M',uf:'GO'}}}as unknown as GeografiaComparacao;
 const i={id:'ene_gd_conexoes',catalogo:'energia_original',area:'energia'}as IndicadorRaio;
 const u=new URL(linkComparacaoRaio(i,'5208905',geo,2013),'https://example.test');
 assert.equal(u.pathname,'/energia');assert.equal(u.searchParams.get('ind'),'ene_gd_conexoes');assert.equal(u.searchParams.get('ano'),'2013');
});
test('leitor permite os objetos de Energia com tamanho e hash íntegros',async()=>{
 const bytes=new TextEncoder().encode('{"versao":1}');const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const leitor=criarLeitorRaio((async()=>new Response(bytes))as typeof fetch,'https://example.test/');
 const ref={caminho:'gold/energia/catalogo_123456.json',bytes:bytes.length,sha256:h};assert.deepEqual(await leitor.objeto(ref),{versao:1});
 await assert.rejects(()=>leitor.objeto({...ref,sha256:'a'.repeat(64)}));
});
