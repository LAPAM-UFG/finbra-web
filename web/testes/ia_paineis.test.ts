import assert from 'node:assert/strict';
import test from 'node:test';
import {executarPainelPreparado,lerPedidoPainel,entradaConsultaPainel,TEMAS_PREPARADOS,type DependenciasPainel} from '../src/ia_paineis';
import {rotulosConsultas,consultasDaConversa,type Mensagem} from '../src/ia';
import {resultadosReaproveitaveis} from '../src/ia_continuidade';
import {registrarColunas,tiposDoResultado} from '../src/ia_formato';
const dep:DependenciasPainel={pacote:async()=>({
 m:{gerado_em:'2026-11-21'},
 c:{anos:[2013,2024],indicadores:[{id:'contagem',nome:'Quantidade observada',unidade:'registros',anos:[2013,2024]},{id:'pop',nome:'População',unidade:'habitantes',anos:[2013,2024]}],derivados:[{id:'taxa',nome:'Por cem habitantes',unidade:'por 100 habitantes',anos:[2013,2024],numerador_id:'contagem',denominador_id:'pop'}],condicoes:{0:'Registrado',1:'Zero registrado',2:'Sem registro',5:'Fora da cobertura'}},
 g:{territorios:{'5208905':{cod:'5208905',nome:'Goiás',nivel:'M',uf:'GO'},GO:{cod:'52',nome:'Goiás',nivel:'UF',uf:'GO'},BR:{cod:'BR',nome:'Brasil',nivel:'BR',uf:null}},municipios:[],governos:[]}as never,
 grupo:async()=>({anos:[2013,2024],valores:[[0,100],[null,200]],condicoes:[[1,0],[2,0]],derivados:[[0],[null]],condicoes_derivados:[[1],[2]],numeradores:[[0],[null]],denominadores:[[100],[200]]}),
})};
for(const tema of TEMAS_PREPARADOS)test(`${tema}: valores prontos preservam zero, ausência, ano e denominador`,async()=>{
 const r=await executarPainelPreparado({tema,operacao:'serie',indicadores:['contagem','taxa'],territorios:['5208905'],anos:[2013,2024,2026]},[tema],undefined,2000,dep);assert.ok(!('erro'in r));if('erro'in r)return;
 assert.equal(r.total,6);const rows=r.linhas.map(l=>Object.fromEntries(r.colunas.map((c,i)=>[c,l[i]])));
 assert.equal(rows.find(x=>x.ano===2013&&x.indicador==='contagem')?.valor,0);assert.equal(rows.find(x=>x.ano===2024&&x.indicador==='contagem')?.valor,null);assert.equal(rows.find(x=>x.ano===2026&&x.indicador==='contagem')?.condicao,'Fora da cobertura');assert.equal(rows.find(x=>x.ano===2013&&x.indicador==='taxa')?.denominador,100);assert.equal(rows[0].cod_ibge,5208905);
});
test('catálogo permite descobrir IDs por nome sem trocar medida desconhecida',async()=>{
 const r=await executarPainelPreparado({tema:'energia',operacao:'catalogo',busca:'população'},['energia'],undefined,2000,dep);assert.ok(!('erro'in r));if(!('erro'in r)){assert.equal(r.total,1);assert.equal(r.linhas[0][0],'pop');}
 const errado=await executarPainelPreparado({tema:'energia',operacao:'serie',indicadores:['inventado']},['energia'],undefined,2000,dep);assert.ok('erro'in errado&&/não encontrado/.test(errado.erro));
});
test('tema desmarcado, parâmetros externos e códigos inválidos são recusados',async()=>{
 assert.throws(()=>lerPedidoPainel({tema:'energia',operacao:'serie',url:'https://exemplo.invalid'}));assert.throws(()=>lerPedidoPainel({tema:'energia',operacao:'serie',territorios:['../../segredo']}));assert.throws(()=>lerPedidoPainel({tema:'energia',operacao:'serie',anos:[2024.5]}));assert.throws(()=>lerPedidoPainel({tema:'energia',operacao:'ranking',uf:'ZZ'}));
 const r=await executarPainelPreparado({tema:'energia',operacao:'catalogo'},['trabalho'],undefined,2000,dep);assert.ok('erro'in r&&r.bloqueada);
});
test('última referência não substitui um ano explicitamente pedido e exportação mantém o total',async()=>{
 const r=await executarPainelPreparado({tema:'comex',operacao:'serie',indicadores:['contagem'],anos:[2013,2024],territorios:['GO','BR']},['comex'],undefined,1,dep);assert.ok(!('erro'in r));if(!('erro'in r)){assert.equal(r.total,4);assert.equal(r.linhas.length,1);}
});
test('consulta de painel mantém identificadores, histórico e tabelas reaproveitáveis para cruzamentos',()=>{
 const pedido={tema:'internet',operacao:'serie',indicadores:['contagem'],territorios:['5208905'],anos:[2024]};const h:Mensagem[]=[{role:'user',content:'Mostre os acessos.'},{role:'assistant',content:[{type:'tool_use',id:'p1',name:'consultar_painel',input:pedido},{type:'tool_use',id:'p2',name:'consultar',input:{sql:'SELECT 1',objetivo:'Outra fonte'}}]}];
 assert.equal(rotulosConsultas(h).get('p1'),'C1');assert.equal(rotulosConsultas(h).get('p2'),'C2');const resultados={p1:{colunas:['cod_ibge','ano','valor'],linhas:[[5208905,2024,30]],total:1}};const c=consultasDaConversa(h,resultados).get('C1')!;assert.deepEqual(c.preparado,pedido);assert.equal(c.sql,entradaConsultaPainel(pedido).sql);assert.equal(resultadosReaproveitaveis(h,resultados).get('C1')?.res.linhas[0][2],30);
});
test('cancelamento não entrega dados de uma consulta abandonada',async()=>{const c=new AbortController();c.abort();await assert.rejects(()=>executarPainelPreparado({tema:'energia',operacao:'catalogo'},['energia'],c.signal,2000,dep),{name:'AbortError'});});

test('unidade da linha não é sobrescrita por reais no cabeçalho genérico',()=>{
 const c=entradaConsultaPainel({tema:'internet',operacao:'serie',indicadores:['acessos_100hab'],territorios:['GO'],anos:[2024]});registrarColunas(c.sql,c.colunas);
 assert.deepEqual(tiposDoResultado({colunas:['valor','numerador','denominador'],linhas:[[22.28,1637698,7350483]],total:1},c.sql),['numero','numero','numero']);
});

test('cobertura própria da medida prevalece sobre o calendário geral do tema',async()=>{
 const d:DependenciasPainel={pacote:async tema=>{const x=await dep.pacote(tema);return{...x,c:{...x.c,derivados:[{...x.c.derivados![0],anos:[2024]}]}};}};
 const r=await executarPainelPreparado({tema:'energia',operacao:'serie',indicadores:['taxa'],anos:[2013]},['energia'],undefined,2000,d);
 assert.ok(!('erro'in r));if(!('erro'in r)){assert.equal(r.linhas[0][r.colunas.indexOf('valor')],null);assert.equal(r.linhas[0][r.colunas.indexOf('condicao')],'Fora da cobertura');}
});
