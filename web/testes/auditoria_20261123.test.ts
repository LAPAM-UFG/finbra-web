import assert from 'node:assert/strict';
import {test} from 'node:test';
import {decimalLocal,numero1,ordinal,porUnidade,reais,reaisExato} from '../src/format';
import {definirIdioma} from '../src/idioma';
import {paraCsv} from '../src/exportar';
import {buscaEntreAreas} from '../src/navegacao';
import {formatoComparacao,rupturaComparacao} from '../src/comparacoes_apresentacao';
import {trienioDestaque} from '../src/raio_x_destaques';
import {apresentarCatalogo,unidadePublica} from '../src/rotulos_publicos';
import type {DefComparacao} from '../src/comparacoes_dados';

test('apresentação por unidade preserva sinal, precisão útil e valores ausentes',()=>{
  assert.equal(reais(11497786866.35),'R$ 11,50 bi');
  assert.equal(reaisExato(-365.31),'R$ −365,31');
  assert.equal(porUnidade(-2004741125,'US$ FOB'),'US$ −2,00 bi');
  assert.equal(porUnidade(10.03,'por mil nascidos vivos'),'10,0');
  assert.equal(porUnidade(250,'por mil nascidos vivos'),'250,0');
  assert.match(porUnidade(1020456,'veículos',{compacto:true}),/1,02/);
  assert.equal(porUnidade(9.739,'%'), '9,74%');
  assert.equal(porUnidade(11.22,'%',{variacao:true}),'+11,22%');
  assert.equal(numero1(-0),'0,0');
  for(const v of [null,undefined,NaN,Infinity,-Infinity])assert.equal(porUnidade(v,'R$'),'—');
});

test('ordinais e unidades são localizados sem alterar unidades físicas',async()=>{
  assert.equal(ordinal(2000),'2.000º');
  assert.equal(unidadePublica('Quilogramas por Hectare'),'quilogramas por hectare');
  assert.equal(unidadePublica('MWh'),'MWh');
  const original=globalThis.document;
  Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:{documentElement:{lang:''},title:''}});
  try{
    await definirIdioma('en');
    assert.equal(ordinal(2000),'2,000th');assert.equal(ordinal(1),'1st');assert.equal(ordinal(12),'12th');assert.equal(ordinal(23),'23rd');
    assert.equal(unidadePublica('Mil litros'),'thousand litres');
    assert.equal(unidadePublica('por 100 mil habitantes'),'per 100,000 residents');
    assert.equal(decimalLocal(-2.5,{minimumFractionDigits:1}),'−2.5');
    const original={indicadores:[{id:'frota',nome:'Frota registrada',nome_en:'Registered fleet',unidade:'veículos',unidade_en:'vehicles'}],derivados:[{id:'taxa',numerador_id:'frota',numerador_nome:'Frota registrada (veículos)'}]};
    const mostrado=apresentarCatalogo(original);
    assert.equal(mostrado.derivados[0].numerador_nome,'Registered fleet (vehicles)');
    assert.equal(original.derivados[0].numerador_nome,'Frota registrada (veículos)');
  }finally{await definirIdioma('pt');Object.defineProperty(globalThis,'document',{configurable:true,writable:true,value:original});}
});

test('CSV tem BOM e comentários: cabeçalho é identificável sem contar linhas de metadados',()=>{
  const csv=paraCsv({colunas:['município','valor'],linhas:[['São Paulo',408.529984662964]],metadados:[['Fonte','IBGE'],['Método','nota\ncom quebra']]});
  assert.equal(csv.charCodeAt(0),0xfeff);
  const dados=csv.replace(/^\uFEFF/,'').split(/\r?\n/).filter(s=>s.trim()&&!s.startsWith('#'));
  assert.deepEqual(dados,['município;valor','São Paulo;408,529984662964']);
  assert.ok(csv.includes('# Método;nota com quebra'));
});

test('alias territorial é aceito e os links novos usam cod; ano remoto não cruza áreas',()=>{
  const url=new URLSearchParams(buscaEntreAreas('?ente=3509502&uf=SP&ano=1985','saude','educacao'));
  assert.equal(url.get('cod'),'3509502');assert.equal(url.has('ente'),false);assert.equal(url.has('ano'),false);
  const ano=new URLSearchParams(buscaEntreAreas('?cod=3509502&ano=2023','educacao','financas'));
  assert.equal(ano.get('cod'),'3509502');assert.equal(ano.get('ano'),'2023');
});

test('mortalidade trienal usa somas, requer três anos e não preenche ausência',()=>{
  const s={periodos:[2022,2023,2024],serie:{v:[250,0,0],n:[1,0,0],d:[4,30,60],c:[0,1,1],q:[1,1,1],r:[null,null,null]}};
  const p=trienioDestaque(s,2024)!;
  assert.equal(p[2],1);assert.equal(p[3],94);assert.equal(p[1],1000/94);
  assert.equal(trienioDestaque({...s,periodos:[2021,2023,2024]},2024),null);
  assert.equal(trienioDestaque({...s,serie:{...s.serie,n:[1,null,0]}},2024),null);
});

test('Censo rompe a linha per capita; indicadores sem base populacional mantêm continuidade',()=>{
  const i={id:'rx_populacao',frequencia:'anual',normalizacao:'População de referência do IBGE',normalizacao_en:'IBGE reference population',unidade:'habitantes',unidade_en:'residents',fonte_nome:'IBGE',fontes:[],metodo_referencia:'razao'} as unknown as DefComparacao;
  assert.equal(rupturaComparacao('financas',i,2021,2022),'metodo');
  assert.equal(rupturaComparacao('financas',i,2022,2023),null);
  assert.equal(rupturaComparacao('financas',{...i,id:'fin_pib_per_capita',metodo_referencia:'mediana',normalizacao:'Indicador da fonte',normalizacao_en:'Source indicator'},2021,2022),'metodo');
  assert.equal(rupturaComparacao('clima',{...i,id:'chuva_mm',normalizacao:'Média pela área',normalizacao_en:'Area weighted',unidade:'mm',unidade_en:'mm',fonte_nome:'CHIRPS'},2021,2022),null);
  assert.equal(formatoComparacao({...i,id:'mortalidade_infantil',formato:'numero',unidade:'por mil nascidos vivos'},10.03),'10,0');
});
