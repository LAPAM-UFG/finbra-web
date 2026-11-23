import assert from 'node:assert/strict';
import test from 'node:test';
import { validarGrupoAgro, type CatalogoAgro, type GrupoAgro } from '../src/agropecuaria_dados';
import { buscaEntreAreas, buscaParaDownloads } from '../src/navegacao';
import { linkComparacaoRaio, type IndicadorRaio } from '../src/raio_x';
import { permiteAgregadoPublicado, validarSerieComparacao, type GeografiaComparacao } from '../src/comparacoes_dados';
import { numeroAgro } from '../src/agropecuaria_apresentacao';

const cat={versao:1,anos:[2013,2025],produtos:[],indicadores:[{id:'ag_pam_0_valor'}],condicoes:{}}as unknown as CatalogoAgro;
const grupo:GrupoAgro={versao:1,grupo:'5208905',anos:[2013,2025],valores:[[0],[null]],condicoes:[[1],[20]]};
test('série preserva zero e proteção, recusa outro lugar ou ano',()=>{
 assert.doesNotThrow(()=>validarGrupoAgro(grupo,'5208905',cat));
 assert.throws(()=>validarGrupoAgro(grupo,'5208707',cat));
 assert.throws(()=>validarGrupoAgro({...grupo,anos:[2013,2024]},'5208905',cat));
 assert.throws(()=>validarGrupoAgro({...grupo,valores:[[0],[Infinity]]},'5208905',cat));
 assert.throws(()=>validarGrupoAgro({...grupo,condicoes:[[1],[7]]},'5208905',cat));
 assert.throws(()=>validarGrupoAgro({...grupo,valores:[[0],[20]]},'5208905',cat));
 assert.throws(()=>validarGrupoAgro({...grupo,condicoes:[[1],[0]]},'5208905',cat));
});
test('lugar e ano seguem entre Agropecuária, Saúde e Raio X',()=>{
 assert.equal(buscaEntreAreas('?cod=5208905&uf=GO&ano=2024','agropecuaria','saude'),'?uf=GO&ano=2024&cod=5208905');
 assert.equal(buscaEntreAreas('?ente=53&ano=2024','saude','agropecuaria'),'?uf=DF&cod=5300108&ano=2024');
 assert.equal(buscaEntreAreas('?cod=5208905&uf=GO&ano=2024','agropecuaria','raiox'),'?uf=GO&cod=5208905&ano=2024');
 assert.equal(new URLSearchParams(buscaParaDownloads('?cod=5208905&uf=GO','agropecuaria')).get('area'),'agropecuaria');
});
test('medidas originais do Raio X abrem sua série e não uma comparação absoluta',()=>{
 const g={territorios:{'5208905':{nivel:'M',uf:'GO'}}}as unknown as GeografiaComparacao;
 const i={id:'ag_pam_0_valor',area:'agropecuaria',catalogo:'agropecuaria_original'}as IndicadorRaio;
 const url=new URL(linkComparacaoRaio(i,'5208905',g,2025),'https://example.test');
 assert.equal(url.pathname,'/agropecuaria');assert.equal(url.searchParams.get('ind'),i.id);assert.equal(url.searchParams.get('ano'),'2025');assert.equal(url.searchParams.get('cod'),'5208905');
});
test('agregados oficiais PAM/PPM mantêm a cobertura municipal sem afrouxar outros contextos',()=>{
 const s={v:[1000],n:[100],d:[100],c:[22],q:[246]};
 assert.doesNotThrow(()=>validarSerieComparacao(s,1,246,true,true));
 assert.throws(()=>validarSerieComparacao(s,1,246,true));
 assert.throws(()=>validarSerieComparacao(s,1,246));
 assert.throws(()=>validarSerieComparacao({...s,q:[247]},1,246,true,true));
 assert.equal(permiteAgregadoPublicado('agropecuaria','todas','UF','leite_vaca'),true);
 assert.equal(permiteAgregadoPublicado('agropecuaria','todas','M','leite_vaca'),false);
 assert.equal(permiteAgregadoPublicado('saude','todas','UF','leite_vaca'),false);
});

test('medidas calculadas mantêm ausência, denominador zero e proteção',()=>{
 const c={...cat,derivados:[{id:'valor_un_ani_2682'}]}as CatalogoAgro;
 const g={...grupo,derivados:[[1.85],[null]],condicoes_derivados:[[0],[4]]};
 assert.doesNotThrow(()=>validarGrupoAgro(g,'5208905',c));
 assert.throws(()=>validarGrupoAgro(grupo,'5208905',c));
 assert.throws(()=>validarGrupoAgro({...g,derivados:[[1.85],[0]]},'5208905',c));
 assert.throws(()=>validarGrupoAgro({...g,condicoes_derivados:[[20],[4]]},'5208905',c));
 assert.throws(()=>validarGrupoAgro({...g,derivados:[[1.85,2],[null]]},'5208905',c));
 assert.doesNotThrow(()=>validarGrupoAgro({...g,derivados:[[0],[null]],condicoes_derivados:[[1],[20]]},'5208905',c));
});

test('valor positivo muito pequeno não é mostrado como zero',()=>{
 assert.equal(numeroAgro(0),'0');assert.match(numeroAgro(.001),/^<0[,.]01$/);
 assert.equal(numeroAgro(null),'—');assert.match(numeroAgro(1.85),/1[,.]85/);
});
