import assert from 'node:assert/strict';
import test from 'node:test';
import {validarGrupoInt,alturaMesesInt,type CatalogoInt,type GrupoInt} from '../src/internet_dados';
import {buscaEntreAreas,buscaParaDownloads} from '../src/navegacao';
import {criarLeitorRaio,linkComparacaoRaio,type IndicadorRaio} from '../src/raio_x';
import type {GeografiaComparacao} from '../src/comparacoes_dados';
const cat={versao:1,anos:[2013,2026],indicadores:[{id:'int_vel_100'}],derivados:[{id:'vel_100_pct'}],condicoes:{}}as CatalogoInt;
const g:GrupoInt={versao:1,grupo:'5208905',anos:[2013,2026],valores:[[null],[0]],condicoes:[[5],[1]],derivados:[[null],[0]],condicoes_derivados:[[5],[1]],numeradores:[[null],[0]],denominadores:[[1000],[1000]],coberturas:[[0],[1]],residuos:{}};
test('campo inexistente no passado não vira zero ou percentual',()=>{
 assert.doesNotThrow(()=>validarGrupoInt(g,'5208905',cat));
 assert.throws(()=>validarGrupoInt({...g,valores:[[0],[0]]},'5208905',cat));
 assert.throws(()=>validarGrupoInt(g,'5300108',cat));
 assert.throws(()=>validarGrupoInt({...g,anos:[2013,2025]},'5208905',cat));
});
test('meses não publicados continuam distintos de zero',()=>assert.deepEqual(alturaMesesInt([0,null,2,1]),[0,null,100,50]));
test('município, ano e DF acompanham Internet e downloads',()=>{
 assert.equal(buscaEntreAreas('?ente=53&ano=2026','saude','internet'),'?uf=DF&cod=5300108&ano=2026');
 assert.equal(buscaEntreAreas('?cod=5208905&uf=GO&ano=2013','internet','educacao'),'?uf=GO&cod=5208905&ano=2013');
 assert.equal(new URLSearchParams(buscaParaDownloads('?cod=5208905&uf=GO','internet')).get('area'),'internet');
});
test('original do Raio X abre no painel e preserva o ano',()=>{
 const geo={territorios:{'5208905':{nivel:'M',uf:'GO'}}}as unknown as GeografiaComparacao;
 const i={id:'int_acessos',catalogo:'internet_original',area:'internet'}as IndicadorRaio;
 const u=new URL(linkComparacaoRaio(i,'5208905',geo,2026),'https://example.test');
 assert.equal(u.pathname,'/internet');assert.equal(u.searchParams.get('ind'),'int_acessos');assert.equal(u.searchParams.get('ano'),'2026');
});

test('leitor aceita os objetos de Internet e confere o hash do conteúdo',async()=>{
 const bytes=new TextEncoder().encode('{"versao":1}');
 const h=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const f=(async()=>new Response(bytes))as typeof fetch;
 const leitor=criarLeitorRaio(f,'https://example.test/');
 const ref={caminho:'gold/internet/catalogo_123456.json',bytes:bytes.length,sha256:h};
 assert.deepEqual(await leitor.objeto(ref),{versao:1});
 await assert.rejects(()=>leitor.objeto({...ref,sha256:'a'.repeat(64)}));
});
