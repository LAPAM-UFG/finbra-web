/**
 * Regressão dos cálculos do painel de trabalho: só funções puras, sem arquivos de dados.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calcularRais, mesesCobertos, razao, somarCagedAno, valorExportado } from '../src/trabalho_painel';

const linha = {
  empregos: 1000, populacao: 20000, empregos_com_populacao: 800, estabelecimentos: 50, n_rem_dez: 900,
  mulheres: 450, homens: 500, ate24: 100, de50mais: 250, superior: 300,
  massa_dez: 2_000_000, massa_dez_real: 2_400_000, remuneracao_media: 2000, remuneracao_media_real: 2400,
  remuneracao_mulheres: 1800, remuneracao_homens: 2250,
  empregos_agropecuaria: 10, empregos_industria: 100, empregos_construcao: 50, empregos_comercio: 300, empregos_servicos: 440, empregos_adm_publica: 100,
};

test('razao: zero, ausente e não finito dão null, nunca zero falso', () => {
  assert.equal(razao(1, 0), null);
  assert.equal(razao(null, 5), null);
  assert.equal(razao(5, undefined), null);
  assert.equal(razao(Number.NaN, 5), null);
  assert.equal(razao(0, 5), 0);
});

test('indicadores da RAIS: por mil só com população válida, variação, estabelecimento, sem remuneração', () => {
  const r = calcularRais(linha, { empregos: 800 }, 2022)!;
  assert.equal(r.porMil, 1000 * 800 / 20000);
  assert.equal(r.variacaoAbs, 200);
  assert.equal(r.variacaoPct, 0.25);
  assert.equal(r.vinculosPorEstab, 20);
  assert.equal(r.semRem, 100);
  assert.equal(r.pctSemRem, 0.1);
  assert.equal(r.razaoMH, 1800 / 2250);
  assert.equal(r.massaReal, 2_400_000);
  assert.equal(r.mulheres.pct, 0.45);
  assert.equal(r.sexoIgnorado, 50); // 1000 − 450 − 500: nunca somado aos homens
  assert.equal(r.setores.adm_publica.pct, 0.1);
});

test('sem ano anterior ou com denominadores zero, nada vira zero', () => {
  const r = calcularRais({ ...linha, estabelecimentos: 0, populacao: 0, homens: null }, undefined, 2010)!;
  assert.equal(r.variacaoAbs, null);
  assert.equal(r.variacaoPct, null);
  assert.equal(r.vinculosPorEstab, null);
  assert.equal(r.porMil, null);
  assert.equal(r.sexoIgnorado, null);
  assert.equal(calcularRais({ empregos: 10 }, { empregos: 0 }, 2011)!.variacaoPct, null);
  assert.equal(calcularRais(undefined, undefined, 2010), null);
  assert.equal(calcularRais({ empregos: 10, n_rem_dez: 20 }, undefined, 2010)!.semRem, null); // mais valores que vínculos: inconsistente, não negativo
});

const mov = (comp: number, a = 10, d = 6) => ({ competencia: comp, admissoes: a, desligamentos: d, saldo: a - d, saldo_12m: 999 });

test('CAGED do ano soma só as competências do ano e ignora saldo_12m', () => {
  const doze = Array.from({ length: 12 }, (_, i) => mov(202400 + i + 1));
  const c = somarCagedAno([mov(202312), ...doze, mov(202501)], 2024, 202001, 202512);
  assert.equal(c.condicao, 'completo');
  assert.equal(c.admissoes, 120);
  assert.equal(c.desligamentos, 72);
  assert.equal(c.saldo, 48);
});

test('CAGED: ano parcial, sem registros e fora da cobertura', () => {
  const ate = [1, 2, 3].map((m) => mov(202500 + m));
  const parcial = somarCagedAno(ate, 2025, 202001, 202503);
  assert.equal(parcial.condicao, 'parcial');
  assert.deepEqual(parcial.mesesCobertos, [1, 2, 3]);
  assert.equal(parcial.saldo, 12);
  const vazio = somarCagedAno([mov(202401)], 2025, 202001, 202503);
  assert.equal(vazio.condicao, 'sem_registros');
  assert.equal(vazio.saldo, null); // ausência não é zero
  const fora = somarCagedAno(ate, 2026, 202001, 202503);
  assert.equal(fora.condicao, 'fora_cobertura');
  assert.equal(fora.admissoes, null);
  assert.equal(somarCagedAno(ate, 2019, 202001, 202503).condicao, 'fora_cobertura');
  assert.equal(somarCagedAno(ate, 2025, undefined, undefined).condicao, 'fora_cobertura');
});

test('CAGED: saldo zero registrado continua zero, e mês sem linha em município fica visível', () => {
  const c = somarCagedAno([mov(202401, 5, 5), mov(202403, 2, 2)], 2024, 202001, 202512);
  assert.equal(c.saldo, 0);
  assert.equal(c.condicao, 'completo');
  assert.deepEqual(c.mesesComRegistro, [1, 3]);
  assert.equal(c.mesesCobertos.length, 12);
});

test('meses cobertos respeitam início e fim da cobertura', () => {
  assert.deepEqual(mesesCobertos(2020, 202007, 202512), [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(mesesCobertos(2025, 202001, 202506), [1, 2, 3, 4, 5, 6]);
});

test('CAGED ignora competências além da cobertura e meses inválidos', () => {
  const c = somarCagedAno([mov(202501), mov(202502), mov(202503), mov(202504), mov(202513), mov(202500)], 2025, 202001, 202503);
  assert.deepEqual(c.mesesComRegistro, [1, 2, 3]);
  assert.equal(c.admissoes, 30);
  assert.equal(c.saldo, 12);
  assert.equal(c.condicao, 'parcial');
  // só linhas fora da cobertura: sem registros, nunca soma
  assert.equal(somarCagedAno([mov(202504)], 2025, 202001, 202503).condicao, 'sem_registros');
});

test('CAGED: campo ausente num mês com registro dá null, sem inventar zero', () => {
  const c = somarCagedAno([mov(202401), { competencia: 202402, admissoes: null, desligamentos: 3, saldo: null }], 2024, 202001, 202512);
  assert.equal(c.admissoes, null);
  assert.equal(c.saldo, null);
  assert.equal(c.desligamentos, 9);
  assert.equal(c.condicao, 'completo');
});

test('exportação: percentuais e razão em pontos percentuais; null e zero preservados', () => {
  assert.equal(valorExportado(0.485, 'pct'), 48.5);
  assert.equal(valorExportado(1800 / 2250, 'razao'), 80);
  assert.equal(valorExportado(0, 'pct'), 0);
  assert.equal(valorExportado(null, 'pct'), null);
  assert.equal(valorExportado(1234, 'vinculos'), 1234);
  assert.equal(valorExportado(2400.5, 'reais'), 2400.5);
});
