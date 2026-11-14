import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buscaEntreAreas, buscaIaLegada } from '../src/navegacao';

const params = (q: string) => Object.fromEntries(new URLSearchParams(q));

test('município acompanha a troca entre Clima, Saúde, Trabalho e Finanças', () => {
  const clima = '?uf=GO&cod=5208707&ano=2024&variavel=temperatura';
  for (const destino of ['saude', 'trabalho', 'financas'] as const) {
    assert.deepEqual(params(buscaEntreAreas(clima, 'clima', destino)), { uf: 'GO', ente: '5208707', ano: '2024' });
  }
  assert.deepEqual(params(buscaEntreAreas('?ente=5208707&ano=2024&indicador=receita_bruta', 'financas', 'clima')), { uf: 'GO', cod: '5208707', ano: '2024' });
});

test('a edição da MUNIC fica na pesquisa, sem apagar a cidade nas outras áreas', () => {
  const munic = '?pesq=munic&uf=GO&cod=5208707&ano=2021&var=x';
  assert.deepEqual(params(buscaEntreAreas(munic, 'munic', 'saude')), { uf: 'GO', ente: '5208707' });
  assert.deepEqual(params(buscaEntreAreas(munic, 'munic', 'clima')), { uf: 'GO', cod: '5208707' });
  assert.deepEqual(params(buscaEntreAreas('?uf=GO&ente=5208707&ano=2025', 'trabalho', 'munic')), { uf: 'GO', cod: '5208707' });
});

test('governo estadual abre ESTADIC e seus próprios dados financeiros; saúde e clima usam a UF', () => {
  assert.deepEqual(params(buscaEntreAreas('?ente=52&ano=2024', 'financas', 'munic')), { uf: 'GO', pesq: 'estadic', cod: '52' });
  for (const q of ['?pesq=estadic&uf=GO&cod=52&ano=2024', '?pesq=estadic&uf=GO&ano=2024']) {
    assert.deepEqual(params(buscaEntreAreas(q, 'munic', 'clima')), { uf: 'GO' });
    assert.deepEqual(params(buscaEntreAreas(q, 'munic', 'trabalho')), { uf: 'GO' });
    assert.deepEqual(params(buscaEntreAreas(q, 'munic', 'saude')), { uf: 'GO' });
    assert.deepEqual(params(buscaEntreAreas(q, 'munic', 'financas')), { uf: 'GO', ente: '52' });
  }
});

test('DF traduz o código territorial e não vira Brasil', () => {
  assert.deepEqual(params(buscaEntreAreas('?ente=53&ano=2024', 'saude', 'clima')), { uf: 'DF', cod: '5300108', ano: '2024' });
  assert.deepEqual(params(buscaEntreAreas('?cod=5300108&ano=2024', 'clima', 'financas')), { uf: 'DF', ente: '53', ano: '2024' });
  for (const q of ['?ente=53', '?uf=DF', '?ente=5300108']) {
    assert.deepEqual(params(buscaEntreAreas(q, 'saude', 'munic')), { uf: 'DF', pesq: 'estadic', cod: '53' });
  }
});

test('UF agregada continua agregada, sem virar governo estadual', () => {
  for (const destino of ['financas', 'saude', 'trabalho', 'munic', 'clima'] as const) {
    const origem = destino === 'clima' ? 'saude' : 'clima';
    assert.deepEqual(params(buscaEntreAreas('?uf=go', origem, destino)), { uf: 'GO' });
  }
});

test('ano=ultimo só acompanha abas da própria Saúde', () => {
  assert.equal(params(buscaEntreAreas('?uf=GO&ano=ultimo', 'saude', 'saude')).ano, 'ultimo');
  for (const destino of ['financas', 'trabalho', 'clima', 'munic'] as const) {
    assert.ok(!('ano' in params(buscaEntreAreas('?uf=GO&ano=ultimo', 'saude', destino))));
  }
});

test('as áreas preservam seus filtros próprios sem importar escolhas de outras páginas', () => {
  assert.deepEqual(params(buscaEntreAreas('?pesq=munic&uf=DF&cod=5300108&ano=2024&var=x', 'munic', 'munic')), { pesq: 'munic', uf: 'DF', cod: '5300108', ano: '2024' });
  assert.deepEqual(params(buscaEntreAreas('?uf=GO&cod=5208707&ano=2024&variavel=temperatura&grupo=x', 'clima', 'clima')), { uf: 'GO', cod: '5208707', ano: '2024', variavel: 'temperatura' });
  assert.deepEqual(params(buscaEntreAreas('?uf=PE&ente=2605459&ano=2024&cbo=1234', 'saude', 'trabalho')), { uf: 'PE', ente: '2605459', ano: '2024' });
});

test('território desconhecido chega à validação do destino, sem ser descartado', () => {
  assert.deepEqual(params(buscaEntreAreas('?cod=9999999&uf=XX&ano=banana', 'clima', 'saude')), { uf: 'XX', ente: '9999999' });
  assert.deepEqual(params(buscaEntreAreas('?ente=5299999&uf=SP', 'financas', 'clima')), { uf: 'SP', cod: '5299999' });
  assert.deepEqual(params(buscaEntreAreas('?cod=abc&uf=GO', 'clima', 'saude')), { uf: 'GO', ente: 'abc' });
});

test('atalhos antigos da IA preservam conversa e pedido de recorte', () => {
  assert.deepEqual(params(buscaIaLegada('?conversa=abc&ente=5208707&ano=2024&paineis=saude', 'trabalho')), { conversa: 'abc', ente: '5208707', ano: '2024', paineis: 'trabalho' });
  assert.equal(buscaIaLegada('?conversa=abc'), '?conversa=abc');
});
