/**
 * Visão geral da saúde (src/saude_painel.ts): integridade dos temas, busca sem acento, valor/condição do dado e escala do resumo exportado.
 * Só funções puras, sem arquivos de dados.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Linha } from '../src/api';
import { INDICADORES, indicador, type FontesMeta } from '../src/saude_comum';
import {
  condicaoTexto, filtrarIndicadores, normalizarBusca, notaSemValor, resumirIndicador, tabelaResumo, TEMAS, temColunasDoIndicador, valorExportado,
} from '../src/saude_painel';

const FONTES: FontesMeta = {
  sim: { anos: [2022, 2023] }, sinasc: { anos: [2022, 2023] }, populacao_svs: { anos: [2022, 2023] }, sih: { anos: [2023] },
  icsap: { anos: [2023] }, cnes: { anos: [2022, 2023] }, sinan: { anos: [2022, 2023] }, siscan: { anos: [2023] }, oncologia: { anos: [2023] }, resp: { anos: [2023] },
};
const colunasDe = () => new Set(INDICADORES.flatMap((i) => [i.numerador, i.denominador]));
/** Série de dois anos com todas as colunas dos indicadores; `r` sobrescreve valores do ano 2023. */
const serie = (r: Record<string, number | null> = {}): Linha[] => {
  const base = (ano: number) => ({ ano, ...Object.fromEntries([...colunasDe()].map((c) => [c, 100])) });
  return [base(2022), { ...base(2023), ...r }];
};

test('cada um dos indicadores do catálogo está em exatamente um tema, e todo tema só cita indicadores existentes', () => {
  const todos = TEMAS.flatMap((x) => x.indicadores);
  assert.equal(todos.length, INDICADORES.length);
  assert.deepEqual([...todos].sort(), INDICADORES.map((i) => i.id).sort());
  assert.equal(new Set(todos).size, todos.length);
  assert.ok(INDICADORES.length >= 48);
  // os que antes ficavam fora da visão geral agora têm tema
  for (const id of ['prematuros', 'maes_adolescentes', 'suicidios', 'transito', 'enfermeiros_mil', 'permanencia_media', 'internacoes_idosos',
    'internacoes_criancas', 'mamo_50_74', 'icsap_taxa', 'icsap_proporcao', 'resp_notificacoes', 'resp_confirmadas']) {
    assert.ok(todos.includes(id), id);
  }
});

test('busca: sem acento, maiúsculas, palavras usuais e tema; vazia devolve o conjunto', () => {
  const ids = (q: string, tema: string | null = null) => filtrarIndicadores(q, tema).map((i) => i.id);
  assert.equal(normalizarBusca('  CESÁREA!  '), 'cesarea');
  assert.deepEqual(ids('médico'), ['medicos_mil']);
  assert.deepEqual(ids('MEDICO'), ['medicos_mil']);
  assert.deepEqual(ids('cesárea'), ['cesareas']);
  assert.ok(['mamo_50_69', 'mamo_50_74'].every((id) => ids('mama').includes(id)));
  assert.ok(ids('enfermeiros').includes('enfermeiros_mil'));
  assert.deepEqual(ids('dengue', 'vigilancia').sort(), ['dengue_graves', 'dengue_incidencia', 'dengue_letalidade']);
  assert.deepEqual(ids('dengue', 'oncologia'), []); // o tema restringe
  assert.deepEqual(ids('zzzz inexistente'), []);
  assert.equal(ids('').length, INDICADORES.length);
  assert.equal(ids('', 'resp').length, 2);
});

test('resumo: valor é a razão das somas; o zero registrado continua zero e a falta de dado não vira zero', () => {
  const inf = indicador('mortalidade_infantil'); // infantis ÷ nascidos × 1000
  const normal = resumirIndicador(inf, serie({ infantis: 12, nascidos: 2000 }), 2023, false, FONTES);
  assert.equal(normal.estado, 'valor');
  assert.equal(normal.valor, 6);
  assert.equal(normal.ano, 2023);
  assert.equal(normal.condicao, 'registrado');
  // numerador zero com denominador positivo: valor 0, condição zero registrado
  const zero = resumirIndicador(inf, serie({ infantis: 0, nascidos: 2000 }), 2023, false, FONTES);
  assert.equal(zero.valor, 0);
  assert.equal(zero.condicao, 'zero_registrado');
  // numerador ausente: sem registro, nunca zero
  const semReg = resumirIndicador(inf, serie({ infantis: null }), 2023, false, FONTES);
  assert.equal(semReg.valor, null);
  assert.equal(semReg.motivo, 'sem_registro');
  assert.match(condicaoTexto(semReg), /sem registro/);
  // denominador ausente e denominador zero são motivos distintos
  assert.equal(resumirIndicador(inf, serie({ nascidos: null }), 2023, false, FONTES).motivo, 'denominador_ausente');
  const dz = resumirIndicador(inf, serie({ nascidos: 0 }), 2023, false, FONTES);
  assert.equal(dz.motivo, 'denominador_zero');
  assert.equal(dz.valor, null);
  assert.match(condicaoTexto(dz), /denominador zero/);
  assert.notEqual(condicaoTexto(dz), condicaoTexto(semReg));
});

test('resumo: cobertura da fonte, "último ano de cada fonte" e versão antiga dos dados', () => {
  const sih = indicador('internacoes_mil'); // SIH só em 2023
  const fora = resumirIndicador(sih, serie(), 2022, false, FONTES);
  assert.equal(fora.estado, 'fora_cobertura');
  assert.equal(fora.valor, null);
  assert.equal(fora.ano, null);
  const ultimo = resumirIndicador(sih, serie(), 2022, true, FONTES);
  assert.equal(ultimo.estado, 'valor');
  assert.equal(ultimo.ano, 2023); // o último ano da fonte, não o escolhido
  // gold antigo: sem as colunas do indicador, é "indisponível", nunca zero nem erro
  const antigo = serie().map((l) => Object.fromEntries(Object.entries(l).filter(([c]) => c !== 'int_total')));
  assert.equal(temColunasDoIndicador(sih, antigo), false);
  const x = resumirIndicador(sih, antigo, 2023, false, FONTES);
  assert.equal(x.estado, 'indisponivel');
  assert.equal(x.valor, null);
  assert.match(condicaoTexto(x), /indisponível|unavailable/);
});

test('resumo: denominador pequeno é marcado só quando há valor e o denominador está abaixo do mínimo do indicador', () => {
  const inf = indicador('mortalidade_infantil'); // mínimo 1000 nascidos
  assert.equal(resumirIndicador(inf, serie({ infantis: 1, nascidos: 500 }), 2023, false, FONTES).pequeno, true);
  assert.equal(resumirIndicador(inf, serie({ infantis: 1, nascidos: 5000 }), 2023, false, FONTES).pequeno, false);
  assert.equal(resumirIndicador(inf, serie({ infantis: null, nascidos: 500 }), 2023, false, FONTES).pequeno, false);
});

test('exportação: todos os indicadores, proporção em 0–100, taxa e reais como calculados, vazio sem valor', () => {
  assert.equal(valorExportado(indicador('cesareas'), 0.4123), 41.23);
  assert.equal(valorExportado(indicador('mortalidade_infantil'), 12.5), 12.5);
  assert.equal(valorExportado(indicador('valor_por_internacao'), 1234.5), 1234.5);
  assert.equal(valorExportado(indicador('cesareas'), null), null);

  const { colunas, linhas } = tabelaResumo(serie({ cesareos: 40, parto_informado: 100, infantis: null }), 2023, false, FONTES);
  assert.equal(linhas.length, INDICADORES.length); // todos, sem filtro de busca
  assert.ok(linhas.every((l) => l.length === colunas.length));
  const col = (nome: RegExp) => colunas.findIndex((c) => nome.test(c));
  const iCod = col(/Código|Code/), iVal = col(/^Valor \(|^Value \(/), iAno = col(/Ano de ref|Reference year/), iCond = col(/Condição|condition/);
  const linha = (id: string) => linhas.find((l) => l[iCod] === id)!;
  assert.equal(linha('cesareas')[iVal], 40); // 40 de 100 partos = 40 %, na escala 0–100
  assert.equal(linha('mortalidade_infantil')[iVal], null); // numerador ausente: vazio, não zero
  assert.match(String(linha('mortalidade_infantil')[iCond]), /sem registro|no record/);
  assert.equal(linha('internacoes_mil')[iAno], 2023);
  // a unidade monetária também precisa distinguir o denominador: por internação e por habitante
  const iUnidade = col(/^Unidade$|^Unit$/);
  for (const id of ['valor_por_internacao', 'valor_por_habitante']) {
    assert.equal(linha(id)[iUnidade], indicador(id).unidade());
  }
  // cada linha tem a condição preenchida
  assert.ok(linhas.every((l) => String(l[iCond]).length > 0));
});

test('nota de denominador ausente ou zero usa o nome legível da contagem, e a falta de registro não cita o SIH', () => {
  const ces = indicador('cesareas'); // denominador parto_informado
  const ausente = notaSemValor(ces, 'denominador_ausente');
  assert.match(ausente, /nascidos com parto informado/);
  assert.ok(!ausente.includes('parto_informado'));
  assert.match(notaSemValor(ces, 'denominador_zero'), /nascidos com parto informado = 0/);
  assert.ok(!/SIH|AIH|internaç/i.test(notaSemValor(ces, 'sem_registro')));
  assert.ok(!/SIH|AIH|internaç/i.test(notaSemValor(indicador('mortalidade_infantil'), null)));
});
