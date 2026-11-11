/**
 * Regressão da orientação do mercado de trabalho: as perguntas e os grupos reaproveitam os atalhos e agrupamentos
 * existentes, sem perder nenhum, e a ação que leva a ocupação ao perfil só leva o que foi pedido.
 * Não usa os arquivos de dados.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ATALHOS_RAIS, urlAnalise } from '../src/trabalho_comum';
import { agruparAtalhos, categorizarOpcoes, CATEGORIAS_AGRUPAMENTO, codigosInvalidos, normalizarAgrupamentos, PERGUNTAS_RAIS } from '../src/trabalho_orientacao';

test('nenhum atalho some ao agrupar e cada um aparece uma vez', () => {
  const todos = ATALHOS_RAIS();
  const ids = agruparAtalhos(todos).flatMap((g) => g.itens.map((x) => x.id));
  assert.deepEqual([...ids].sort(), todos.map((x) => x.id).sort());
  assert.equal(agruparAtalhos([...todos, { id: 'novo' } as (typeof todos)[number]]).at(-1)?.itens[0].id, 'novo');
});

test('as perguntas só apontam para atalhos e rotas que existem', () => {
  const ids = new Set(ATALHOS_RAIS().map((x) => x.id));
  const rotas = ['/trabalho/consulta', '/trabalho/remuneracao', '/trabalho/perfil', '/trabalho/estabelecimentos', '/trabalho/caged'];
  for (const q of PERGUNTAS_RAIS()) {
    assert.ok(rotas.includes(q.caminho), q.id);
    for (const id of q.ids) assert.ok(ids.has(id), `${q.id}: ${id}`);
  }
});

test('categorizar o "Ver resultado por" não perde nem repete nenhuma opção', () => {
  const chaves = CATEGORIAS_AGRUPAMENTO().flatMap((c) => c.chaves);
  assert.equal(new Set(chaves).size, chaves.length, 'chave em duas categorias');
  const opcoes: [string, string][] = [...chaves, 'agrupamento_futuro'].map((k) => [k, k]);
  const saida = categorizarOpcoes(opcoes).flatMap((g) => g.opcoes.map(([k]) => k));
  assert.deepEqual([...saida].sort(), opcoes.map(([k]) => k).sort());
  // uma fonte com menos agrupamentos (tabelas pré-somadas) só mostra os que tem
  assert.deepEqual(categorizarOpcoes([['sexo', 'Sexo'], ['total', 'Total']]).map((g) => g.opcoes.map(([k]) => k)), [['total'], ['sexo']]);
});

test('urlAnalise leva só território, ano e o que a ação pede para manter', () => {
  const busca = new URLSearchParams('ano=2022&uf=GO&cbo=2512&cnae=56&sit=ativos&agr=sexo');
  assert.equal(urlAnalise(busca, '/trabalho/perfil', {}), '/trabalho/perfil?ano=2022&uf=GO');
  assert.equal(urlAnalise(busca, '/trabalho/perfil', {}, ['cbo']), '/trabalho/perfil?ano=2022&uf=GO&cbo=2512');
  assert.equal(urlAnalise(new URLSearchParams('ente=5208707'), '/trabalho/perfil', {}, ['cbo']), '/trabalho/perfil?ente=5208707');
});

test('códigos digitados: só prefixos numéricos (CBO 1-6, CNAE 1-7), com zeros à esquerda e vários separadores', () => {
  assert.deepEqual(codigosInvalidos('2512, 251205;2 0141 01113', 6), []);
  assert.deepEqual(codigosInvalidos('', 6), []);
  assert.deepEqual(codigosInvalidos('0111301', 7), []);
  assert.deepEqual(codigosInvalidos('2512, abc, 25x1 1234567', 6), ['abc', '25x1', '1234567']);
  assert.deepEqual(codigosInvalidos('0111301 01113012', 7), ['01113012']);
});

test('comparação do rascunho some com o total, com o mesmo agrupamento ou se a fonte não a tem', () => {
  const v = ['total', 'sexo', 'cnae_divisao'];
  assert.deepEqual(normalizarAgrupamentos('sexo', 'cnae_divisao', v), { agr: 'sexo', agr2: 'cnae_divisao' });
  assert.deepEqual(normalizarAgrupamentos('total', 'sexo', v), { agr: 'total', agr2: '' });
  assert.deepEqual(normalizarAgrupamentos('sexo', 'sexo', v), { agr: 'sexo', agr2: '' });
  assert.deepEqual(normalizarAgrupamentos('sexo', 'raca_cor', v), { agr: 'sexo', agr2: '' });
  assert.deepEqual(normalizarAgrupamentos('raca_cor', 'sexo', v), { agr: 'total', agr2: '' });
});

test('as perguntas não prometem recursos que o Brasil não tem e descrevem o CAGED como emprego com carteira', () => {
  const q = Object.fromEntries(PERGUNTAS_RAIS().map((x) => [x.id, x]));
  assert.equal(q.atividades.notaBrasil, undefined); // Estabelecimentos funciona completo no Brasil
  for (const id of ['pagam', 'perfil', 'profissao']) assert.ok(q[id].notaBrasil, id);
  assert.ok(!/extremos/i.test(q.pagam.desc));
  assert.match(q.movimento.desc, /CLT/);
});
