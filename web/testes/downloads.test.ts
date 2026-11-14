import assert from 'node:assert/strict';
import test from 'node:test';
import { caminhoSeguro, urlArquivo, validarManifesto, validarDicionario, indexarDicionario, filtrarDicionario, filtrarArquivos, faixaAnos } from '../src/downloads';
import { buscaEntreAreas } from '../src/navegacao';

const arquivo = {id:'br_csv',tipo:'painel',area:null,nome:'Brasil',nome_en:'Brazil',descricao:'Base anual',descricao_en:'Annual panel',formato:'csv.zip',caminho:'gold/downloads/br_abcdef.csv.zip',bytes:100,sha256:'a'.repeat(64),linhas:10,variaveis:4,ano_de:2020,ano_ate:2024,uf:null};
const manifesto = {versao:1,gerado_em:'2026-11-14',base_gerado_em:'2026-11-14',base_sha256:'b'.repeat(64),base_ipca:2025,resumo:{municipios:2,ano_de:2020,ano_ate:2024,variaveis:4,linhas:10,variaveis_detalhadas:1},notas:[],areas:[{id:'saude',nome:'Saúde',nome_en:'Health',descricao:'Saúde',descricao_en:'Health'}],arquivos:[arquivo],dicionario:{caminho:'gold/downloads/dicionario_abc.json',bytes:200,sha256:'c'.repeat(64)}};

test('somente arquivos públicos do pacote viram links',()=>{
 assert.equal(urlArquivo(arquivo.caminho,'https://painel.invalid/dados/'),'https://painel.invalid/dados/'+arquivo.caminho);
 for(const path of ['../credencial','gold/downloads/../manifesto.json','https://mal.invalid/a','gold/downloads/%2e%2e/a','gold/downloads/a?b=1','gold/downloads/a#b','gold/downloads\\a'])assert.equal(caminhoSeguro(path),false,path);
});

test('arquivo corrompido ou duplicado não aparece como download',()=>{
 const bom=validarManifesto(manifesto);assert.equal(bom.descartados,0);assert.equal(bom.manifesto.arquivos.length,1);
 const erro=validarManifesto({...manifesto,arquivos:[arquivo,{...arquivo,id:'mal',caminho:'gold/../segredo'},{...arquivo,id:'hash',sha256:'incompleto'},arquivo]});
 assert.equal(erro.manifesto.arquivos.length,1);assert.equal(erro.descartados,3);
 assert.throws(()=>validarManifesto({...manifesto,versao:2}));
 assert.throws(()=>validarManifesto({...manifesto,parcial:true}));
});

test('filtro não promete dados de outra UF ou tema',()=>{
 const arquivos=validarManifesto({...manifesto,arquivos:[arquivo,{...arquivo,id:'go',uf:'GO',area:'saude',tipo:'area',nome:'Goiás Saúde'}]}).manifesto.arquivos;
 assert.deepEqual(filtrarArquivos(arquivos,{texto:'saude',uf:'GO',area:'saude'},false).map(x=>x.id),['go']);
 assert.equal(filtrarArquivos(arquivos,{texto:'',uf:'SP',area:''},false).length,0);
});

test('dicionário pesquisa sem acentos e preserva nulos e referências',()=>{
 const entries=validarDicionario([{variavel:'sau_obitos',nome:'Óbitos de crianças',descricao:'Contagem anual',area:'saude',fonte:'SIM',unidade:'número',tipo:'numero',regra_anual:'Ano observado',ano_de:2000,ano_ate:2024,tabela:'painel',observacao:''}]);
 assert.equal(filtrarDicionario(indexarDicionario(entries),'obitos criancas','saude').length,1);
 assert.equal(entries[0].ano_de,2000);assert.throws(()=>validarDicionario({}));
});

test('Downloads não leva filtros para os painéis',()=>{
 assert.equal(buscaEntreAreas('?uf=GO&ano=2020&ente=5208707','downloads','saude'),'');
 assert.ok(buscaEntreAreas('?uf=GO&ente=5208707','saude','assistencia').includes('cod=5208707'));
});

test('anos observados deixam as lacunas da pesquisa explícitas',()=>{
 assert.equal(faixaAnos({ano_de:2021,ano_ate:2024,anos_observados:[2021,2023,2024]}),'2021, 2023–2024');
});
