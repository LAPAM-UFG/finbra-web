import {ajustarIndicadorRede} from '../src/educacao_rede';
import {criarLeitorFinanceiro} from '../src/educacao_financeira';
import {USAR_MOTOR} from '../src/clima_abertura';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { anoSemEdicaoEducacao,posicoesEducacao,type MetaEducacao,type IndicadorEducacao,linhaEducacao,filtrarMunicipiosEducacao,municipioExatoEducacao,ufMunicipioEducacao, type GrupoEducacao } from '../src/educacao_dados';
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
  assert.equal(r.get('cod'),'5208707');assert.equal(r.get('ind'),null);
});
test('SIOPE mantém os códigos do contexto financeiro e o DF',()=>{
  assert.equal(new URLSearchParams(buscaEntreAreas('?uf=DF&cod=5300108','educacao','financas')).get('cod'),'53');
  assert.equal(new URLSearchParams(buscaEntreAreas('?ente=5208707','educacao','educacao')).get('cod'),'5208707');
});

test('calendário distingue ano sem edição de resultado municipal não publicado',()=>{
 const i={fonte:'saeb',anos:[2023]} as IndicadorEducacao;
 const m={indicadores:[i],edicoes_avaliacao:[2013,2015,2017,2019,2021,2023,2025]} as MetaEducacao;
 assert.equal(anoSemEdicaoEducacao(m,i,2024),true);
 assert.equal(anoSemEdicaoEducacao(m,i,2025),false);
 assert.equal(anoSemEdicaoEducacao(m,{...i,fonte:'censo'},2024),false);
});
test('ranking conserva posição em empate sem pular o primeiro após cada grupo',()=>{
 assert.deepEqual(posicoesEducacao([[1,'A','GO',100],[2,'B','GO',100],[3,'C','GO',99],[4,'D','GO',99],[5,'E','GO',90]],0),[1,1,3,3,5]);
});

function financeiroFixture(change=false,corrupt=false){
 const raw=Buffer.from(JSON.stringify({g:'M:GO',se:[[2025,241]],rem:[],cats:[],cobertura:[[2025,241,246]]})+'\n');
 const arquivo={caminho:'gold/educacao/siope_teste.ndjson',bytes:raw.length,sha256:'a'.repeat(64)};
 const ref={caminho:'gold/educacao/financeiro_teste.json',bytes:2,sha256:'b'.repeat(64)};
 const compatibilidade={siope:{anos:[2024,2025]},ipca:{ano_base:2025},base_ipca:2025};
 const ind={versao:1,meta:{geradoEm:'anterior'},compatibilidade,arquivo,entes:ref,grupos:{'M:GO':[0,raw.length,createHash('sha256').update(raw).digest('hex')]},municipios:{},colunas:{grupo:['ano','entes'],cobertura:['ano','com_declaracao','esperados']}};
 let requests=0;
 const reader=criarLeitorFinanceiro({educacao:async()=>({financeiro:ref} as unknown as MetaEducacao),manifesto:async()=>({gerado_em:'atual',base_ipca:2025,fontes:{siope:{anos:change?[2024,2025,2026]:[2024,2025]},ipca:{ano_base:2025},outra:{versao:'nova'}}} as any),ler:async<T>()=>ind as T,buscar:async()=>{requests++;return new Response(corrupt?Buffer.alloc(raw.length):raw,{status:206,headers:{'Content-Range':`bytes 0-${raw.length-1}/${raw.length}`}});}});
 return {reader,requests:()=>requests};
}
test('SIOPE pronto conserva cobertura e ignora atualização de outra fonte',async()=>{
 const f=financeiroFixture();
 assert.deepEqual(await f.reader.executar('educacao_fin_grupo',{uf:'GO'}),[{ano:2025,entes:241}]);
 assert.deepEqual(await f.reader.executar('educacao_fin_cobertura',{uf:'GO'}),[{ano:2025,com_declaracao:241,esperados:246}]);
 assert.equal(f.requests(),1);
 assert.equal(await f.reader.executar('se_grupo',{uf:'GO'}),USAR_MOTOR);
});
test('SIOPE atualizado ou trecho corrompido volta ao motor, sem mostrar pacote antigo',async()=>{
 assert.equal(await financeiroFixture(true).reader.executar('educacao_fin_grupo',{uf:'GO'}),USAR_MOTOR);
 assert.equal(await financeiroFixture(false,true).reader.executar('educacao_fin_grupo',{uf:'GO'}),USAR_MOTOR);
});

test('trocar de rede ajusta a medida estadual explícita, preservando as outras escolhas',()=>{
 for(const id of ['ideb_medio_estadual','saeb_lp_medio_estadual','saeb_mat_medio_estadual']){
  assert.equal(ajustarIndicadorRede(id,'municipal'),id.replace(/_estadual$/,''));
  assert.equal(ajustarIndicadorRede(id,'todas'),id);
 }
 assert.equal(ajustarIndicadorRede('saeb_lp_ai','privada'),'saeb_lp_ai');
 assert.equal(ajustarIndicadorRede(null,'publica'),null);
});

test('navegar dentro da Educação conserva rede e indicador; trocar de área leva só o contexto comum',()=>{
 const primeiro=buscaEntreAreas('?uf=GO&cod=5208707&ano=2025&ind=saeb_lp_ai&rede=municipal','educacao','educacao');
 const segundo=new URLSearchParams(buscaEntreAreas(primeiro,'educacao','educacao'));
 assert.equal(segundo.get('rede'),'municipal');assert.equal(segundo.get('ind'),'saeb_lp_ai');
 const saude=new URLSearchParams(buscaEntreAreas(primeiro,'educacao','saude'));
 assert.equal(saude.get('rede'),null);assert.equal(saude.get('ind'),null);assert.equal(saude.get('cod'),'5208707');
});
