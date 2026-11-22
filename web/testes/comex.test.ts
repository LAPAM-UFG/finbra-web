import assert from 'node:assert/strict';
import test from 'node:test';
import {validarGrupoComex,validarMensalComex,type MensalComex,type GrupoComex,type CatalogoComex} from '../src/comex_dados';
import {linkComparacaoRaio} from '../src/raio_x';

test('saldo e variações negativas são válidos; pesos e valores comerciais negativos são recusados',()=>{
 const c={versao:1,anos:[2026],indicadores:[{id:'cex_saldo_fob',com_sinal:true},{id:'cex_imp_fob',com_sinal:false}],derivados:[]}as unknown as CatalogoComex;
 const d:GrupoComex={versao:1,grupo:'5208707',anos:[2026],valores:[[-100,200]],condicoes:[[0,0]],derivados:[[]],condicoes_derivados:[[]],numeradores:[[]],denominadores:[[]],coberturas:[[]],residuos:{}};
 assert.doesNotThrow(()=>validarGrupoComex(d,'5208707',c));d.valores[0][1]=-200;assert.throws(()=>validarGrupoComex(d,'5208707',c));
 d.valores[0][1]=0;d.condicoes[0][1]=1;assert.doesNotThrow(()=>validarGrupoComex(d,'5208707',c));
 d.valores[0][0]=null;d.condicoes[0][0]=4;assert.doesNotThrow(()=>validarGrupoComex(d,'5208707',c));d.condicoes[0][0]=0;assert.throws(()=>validarGrupoComex(d,'5208707',c));
});
test('Raio X retorna ao indicador original de Comex com município e ano',()=>{
 const i={area:'comex',catalogo:'comex_original',id:'cex_saldo_fob',rede:'todas'}as any;
 const g={territorios:{'5208707':{nivel:'M',uf:'GO',cod:5208707}}}as any;
 const url=linkComparacaoRaio(i,'5208707',g,2025);assert(url.startsWith('/comex?'));const sp=new URLSearchParams(url.split('?')[1]);assert.equal(sp.get('ind'),'cex_saldo_fob');assert.equal(sp.get('ano'),'2025');assert.equal(sp.get('cod'),'5208707');
});
test('mensal distingue ausência da fonte, zero conhecido e saldo negativo',()=>{
 const d:MensalComex={versao:1,grupo:'5101837',periodos:[202610],colunas:['exp','imp','saldo','kg_exp','kg_imp'],valores:[[null,null,null,null,null]],condicoes:[[2,2,2,2,2]]};
 assert.doesNotThrow(()=>validarMensalComex(d,'5101837',[202610]));d.condicoes=[[1,1,1,1,1]];assert.throws(()=>validarMensalComex(d,'5101837',[202610]));
 d.valores=[[0,0,0,0,0]];assert.doesNotThrow(()=>validarMensalComex(d,'5101837',[202610]));d.valores=[[1,2,-1,0,0]];d.condicoes=[[0,0,0,1,1]];assert.doesNotThrow(()=>validarMensalComex(d,'5101837',[202610]));d.valores[0][1]=-2;assert.throws(()=>validarMensalComex(d,'5101837',[202610]));
});
