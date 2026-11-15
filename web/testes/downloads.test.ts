import assert from 'node:assert/strict';
import test from 'node:test';
import { caminhoSeguro, urlArquivo, validarManifesto, validarDicionario, indexarDicionario, filtrarDicionario, filtrarArquivos, faixaAnos, formatoDisponivel, formatosBase, arquivoDoRecorte, validarCatalogo, validarPrevia, ordenarDetalhados } from '../src/downloads';
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

test('Stata e comandos do arquivo são aceitos e o formato tem fallback durante a atualização',()=>{
 const lido=validarManifesto({...manifesto,arquivos:[arquivo,{...arquivo,id:'dta',formato:'dta',caminho:'gold/downloads/painel.dta'},{...arquivo,id:'do',tipo:'metodologia',formato:'do',caminho:'gold/downloads/exemplo.do'}]}).manifesto.arquivos;
 assert.equal(lido.length,3);assert.deepEqual(formatosBase(lido),['dta','csv.zip']);assert.equal(formatoDisponivel('dta',lido),'dta');assert.equal(formatoDisponivel('dta',[lido[0]]),'csv.zip');
});

test('edição enxuta recusa o período anterior a 2013 e os arquivos não recortados',()=>{
 const novo={...manifesto,edicao:'enxuta_2013',resumo:{...manifesto.resumo,variaveis:254,ano_de:2013}};
 assert.throws(()=>validarManifesto({...novo,resumo:{...novo.resumo,ano_de:2012}}));
 assert.throws(()=>validarManifesto({...novo,resumo:{...novo.resumo,variaveis:301}}));
 const lido=validarManifesto({...novo,arquivos:[arquivo,{...arquivo,id:'antigo',ano_de:2012}]});assert.equal(lido.descartados,1);
});

test('dicionário encontra o nome original e preserva a codificação Stata',()=>{
 const entries=validarDicionario([{variavel:'rais_esc_9_rem_media',variavel_original:'rais_escolaridade_9_remuneracao_media',nome:'Remuneração',stata_rotulos:{1:'Sim',2:'Não'}}]);
 assert.equal(filtrarDicionario(indexarDicionario(entries),'rais_escolaridade_9','').length,1);assert.deepEqual(entries[0].stata_rotulos,{'1':'Sim','2':'Não'});
});

test('busca entende salário e siglas sem ocultar os nomes originais',()=>{
 const entries=validarDicionario([{variavel:'rais_rem_media',variavel_original:'rais_remuneracao_media',nome:'Remuneração média'},{variavel:'soc_pbf_familias',nome:'Famílias'},{variavel:'ibge_pib',nome:'PIB'}]);
 const idx=indexarDicionario(entries);
 assert.equal(filtrarDicionario(idx,'salário médio','')[0].variavel,'rais_rem_media');
 assert.equal(filtrarDicionario(idx,'Bolsa Família','')[0].variavel,'soc_pbf_familias');
 assert.equal(filtrarDicionario(idx,'produto interno bruto','')[0].variavel,'ibge_pib');
});

test('UF e tema só selecionam o arquivo exato, sem fallback nacional',()=>{
 const files=validarManifesto({...manifesto,arquivos:[arquivo,{...arquivo,id:'saude_br',tipo:'area',area:'saude'},{...arquivo,id:'saude_go',tipo:'area',area:'saude',uf:'GO'}]}).manifesto.arquivos;
 assert.equal(arquivoDoRecorte(files,'saude','GO','csv.zip')?.id,'saude_go');
 assert.equal(arquivoDoRecorte(files,'saude','SP','csv.zip'),undefined);
 assert.equal(arquivoDoRecorte(files,'','GO','csv.zip'),undefined);
 assert.equal(arquivoDoRecorte(files,'saude','','csv.zip')?.id,'saude_br');
});

test('catálogo da UF recusa outro território ou referência fora do prefixo',()=>{
 const m=validarManifesto(manifesto).manifesto;
 const cat={versao:1,uf:'GO',arquivos:[{...arquivo,id:'go_saude',uf:'GO',area:'saude',tipo:'area'}]};
 assert.equal(validarCatalogo(cat,m,'GO').length,1);
 assert.throws(()=>validarCatalogo(cat,m,'SP'));
 assert.throws(()=>validarCatalogo({...cat,arquivos:[{...cat.arquivos[0],uf:null}]},m,'GO'));
 assert.throws(()=>validarManifesto({...manifesto,recortes_uf:{GO:{caminho:'gold/fora.json',bytes:10,sha256:'a'.repeat(64)}}}));
 assert.equal(validarManifesto({...manifesto,arquivos:[{...arquivo,previa:{caminho:'../fora.json',bytes:1,sha256:'a'.repeat(64)}}]}).descartados,1);
});

test('prévia mantém zero e nulo distintos e não aceita outro arquivo',()=>{
 const a=validarManifesto({...manifesto,arquivos:[{...arquivo,id:'painel_go_dta',uf:'GO',formato:'dta',linhas:2,variaveis:1}]}).manifesto.arquivos[0];
 const values={cod_ibge:5208707,municipio:'Goiânia',uf:'GO',regiao:'Centro-Oeste',tipo_territorio:'município',ano:2020,valor:0};
 const preview={versao:1,id:'painel_go',uf:'GO',area:null,linhas_total:2,ano_de:2020,ano_ate:2024,colunas:Object.keys(values).map(k=>({variavel:k,nome:k,unidade:'número',anos:[2020],preenchidas:1})),amostra:[values,{...values,ano:2024,valor:null}]};
 const result=validarPrevia(preview,a);assert.equal(result.amostra[0].valor,0);assert.equal(result.amostra[1].valor,null);
 assert.throws(()=>validarPrevia({...preview,uf:'SP'},a));
 assert.throws(()=>validarPrevia({...preview,amostra:[{...values,valor:{html:'mal'}}]},a));
});

test('MUNIC recente aparece primeiro sem alterar a lista recebida',()=>{
 const files=validarManifesto({...manifesto,arquivos:[{...arquivo,id:'antigo',nome:'MUNIC 2013',ano_de:2013,ano_ate:2013},{...arquivo,id:'novo',nome:'MUNIC 2024',ano_de:2024,ano_ate:2024}]}).manifesto.arquivos;
 assert.deepEqual(ordenarDetalhados(files).map(a=>a.id),['novo','antigo']);assert.equal(files[0].id,'antigo');
});
