/**
 * Regressão dos perfis da RAIS (raça/cor, escolaridade, tipo de vínculo): só funções puras, sem arquivos de dados.
 * Os números de referência de Goiânia 2024 vêm de uma contagem independente dos microdados (não de trabalho_perfis.ts).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  AUSENTE, DICIONARIO, caminhoPerfis, colunasExportacao, disponibilidadePerfis, distribuicao, escopoDoPerfil, grupoMte, lerPerfil, linhasExportacao, superiorSomado,
  type Linha, type PerfilLido,
} from '../src/trabalho_perfis';

type Ok = Extract<PerfilLido, { estado: 'ok' }>;
const linhasDe = (ano: number, total: number, dims: Record<string, Record<string, number>>): Linha[] => [
  { ano, variavel: 'total', codigo: 'total', vinculos: total, total },
  ...Object.entries(dims).flatMap(([variavel, cods]) => Object.entries(cods).map(([codigo, vinculos]) => ({ ano, variavel, codigo, vinculos, total }))),
];
const ok = (l: Linha[], ano = 2024): Ok => {
  const p = lerPerfil(l, ano);
  assert.equal(p.estado, 'ok', JSON.stringify(p));
  return p as Ok;
};

// Goiânia 2024 (referência independente)
const GOIANIA = linhasDe(2024, 728780, {
  raca_cor: { '1': 1268, '2': 224560, '4': 39631, '6': 9218, '8': 431525, '9': 22578 },
  escolaridade: { '1': 1561, '2': 10152, '3': 6289, '4': 24831, '5': 30551, '6': 38130, '7': 337870, '8': 21534, '9': 243766, '10': 6739, '11': 7357 },
  vinculo_mte: { '1': 505719, '2': 204476, '3': 18585 },
  tipo_vinculo: { '10': 465346, '15': 3669, '20': 890, '25': 411, '30': 129193, '31': 234, '35': 23297, '40': 554, '50': 199, '55': 15660, '60': 35239, '65': 136, '70': 14, '75': 14, '80': 508, '90': 426, '95': 1238, '96': 42005, '97': 9747 },
});

// Duas categorias, com tamanhos e cobertura diferentes: massa em centavos, média sobre TODOS os ativos.
function comRemuneracao(semValor = false): Linha[] {
  const grupos: Record<string, string[]> = { raca_cor: ['2', '77'], escolaridade: ['7', '9'], tipo_vinculo: ['10', '30'], vinculo_mte: ['1', '2'] };
  const m1 = semValor ? null : 300000;
  const m2 = 1600000;
  const total = (m1 ?? 0) + m2;
  return [
    { ano: 2024, variavel: 'total', codigo: 'total', vinculos: 10, total: 10, massa_dez_centavos: total, n_rem_dez: semValor ? 8 : 9, remuneracao_media_dez: total / 100 / 10 },
    ...Object.entries(grupos).flatMap(([variavel, cs]) => [
      { ano: 2024, variavel, codigo: cs[0], vinculos: 2, total: 10, massa_dez_centavos: m1, n_rem_dez: semValor ? 0 : 1, remuneracao_media_dez: m1 === null ? null : m1 / 100 / 2 },
      { ano: 2024, variavel, codigo: cs[1], vinculos: 8, total: 10, massa_dez_centavos: m2, n_rem_dez: 8, remuneracao_media_dez: m2 / 100 / 8 },
    ]),
  ];
}

test('remuneração: média usa todos os vínculos da categoria; total é ponderado pela massa', () => {
  const p = ok(comRemuneracao());
  assert.equal(p.remuneracaoTotal?.media, 1900);
  const d = distribuicao(p, 'raca_cor', 'pt');
  const a = d.itens.find((i) => i.codigo === '2')!;
  const b = d.itens.find((i) => i.codigo === '77')!;
  assert.equal(a.media, 1500); // 3000 ÷ 2 ativos; apenas um tem o valor, não dividir por 1
  assert.equal(a.nRem, 1);
  assert.equal(a.semRem, 1);
  assert.equal(b.media, 2000);
  assert.equal(b.tipo, 'desconhecido');
  assert.notEqual(p.remuneracaoTotal?.media, (a.media! + b.media!) / 2);
});

test('remuneração: grupo sem valor e categoria sem vínculos têm média indisponível', () => {
  const p = ok(comRemuneracao(true));
  const d = distribuicao(p, 'raca_cor', 'pt');
  const semValor = d.itens.find((i) => i.codigo === '2')!;
  const semVinculos = d.itens.find((i) => i.codigo === '1')!;
  assert.equal(semValor.media, null);
  assert.equal(semValor.nRem, 0);
  assert.equal(semValor.semRem, 2);
  assert.equal(semValor.condicaoRem, 'sem_valor');
  assert.equal(semVinculos.media, null);
  assert.equal(semVinculos.condicaoRem, 'sem_vinculos');
  assert.equal(p.remuneracaoTotal?.media, 1600);
});

test('remuneração V1: contagens preservadas, salários não publicados nunca viram zero', () => {
  const p = ok(GOIANIA);
  assert.equal(p.remuneracoes, null);
  const a = distribuicao(p, 'raca_cor', 'pt').itens[0];
  assert.equal(a.media, null);
  assert.equal(a.nRem, null);
  assert.equal(a.semRem, null);
  assert.equal(a.condicaoRem, 'nao_publicada');
  assert.equal(caminhoPerfis(2024), 'gold/trabalho/perfis/ano=2024.parquet');
  assert.equal(caminhoPerfis(2024, { versao: 2, anos: [2024] }), 'gold/trabalho/perfis_v2/ano=2024.parquet');
  const parcial = { versao: 2, anos: [2024], fallback_v1: { anos: [2023, 2024] } };
  assert.equal(disponibilidadePerfis(parcial, 2023).ok, true);
  assert.equal(caminhoPerfis(2023, parcial), 'gold/trabalho/perfis/ano=2023.parquet');
});

test('remuneração: massa, cobertura e média incoerentes ou campos parciais recusam os dados', () => {
  for (const [field, value] of [['massa_dez_centavos', 300001], ['n_rem_dez', 3], ['n_rem_dez', 0], ['remuneracao_media_dez', 3000]]) {
    const linhas = comRemuneracao().map((r) => ({ ...r }));
    linhas[1][field as string] = value;
    assert.equal(lerPerfil(linhas, 2024).estado, 'inconsistente', String(field));
  }
  const parciais = comRemuneracao();
  delete parciais[1].n_rem_dez;
  assert.equal(lerPerfil(parciais, 2024).estado, 'inconsistente');
});

test('exportação de remuneração: reais numéricos, cobertura, condição e moeda explícitos', () => {
  const cols = colunasExportacao('pt');
  const rows = linhasExportacao(ok(comRemuneracao()), ['raca_cor'], 'pt');
  const a = rows.find((r) => r[1] === '2')!;
  assert.equal(a[cols.indexOf('Remuneração média de dezembro')], 1500);
  assert.equal(a[cols.indexOf('Massa de dezembro')], 3000);
  assert.equal(a[cols.indexOf('Vínculos com remuneração válida')], 1);
  assert.equal(a[cols.indexOf('Vínculos sem remuneração válida')], 1);
  assert.equal(a[cols.indexOf('Moeda')], 'BRL');
  assert.ok(rows.every((r) => r.length === cols.length));
  const old = linhasExportacao(ok(GOIANIA), ['raca_cor'], 'en')[0];
  assert.equal(old[9], null);
  assert.equal(old[13], 'pay not published');
});

test('Goiânia 2024: cada dimensão fecha no total e superior = 9 + 10 + 11 (257.862)', () => {
  const p = ok(GOIANIA);
  for (const v of ['raca_cor', 'escolaridade', 'vinculo_mte', 'tipo_vinculo'] as const) {
    const d = distribuicao(p, v, 'pt');
    assert.equal(d.soma, 728780, v);
    assert.equal(d.total, 728780);
  }
  const esc = distribuicao(p, 'escolaridade', 'pt');
  assert.equal(esc.itens.length, 11);
  assert.equal(esc.itens.find((i) => i.codigo === '10')!.vinculos, 6739); // mestrado e doutorado separados do superior completo
  assert.equal(esc.itens.find((i) => i.codigo === '9')!.vinculos, 243766);
  assert.equal(superiorSomado(esc).vinculos, 257862);
  assert.ok(Math.abs(superiorSomado(esc).pct! - 257862 / 728780) < 1e-12);
  // o agrupamento do detalhado pela regra do MTE reproduz o resumo independente (96/97 em estatutários, aprendiz em outros)
  const porGrupo: Record<string, number> = {};
  for (const i of distribuicao(p, 'tipo_vinculo', 'pt').itens) porGrupo[i.grupoMte!] = (porGrupo[i.grupoMte!] ?? 0) + i.vinculos;
  assert.deepEqual(porGrupo, { '1': 505719, '2': 204476, '3': 18585 });
  const raca = distribuicao(p, 'raca_cor', 'pt');
  assert.equal(raca.itens.length, 6); // sem ausente quando não observado
  assert.ok(Math.abs(raca.itens.find((i) => i.codigo === '8')!.pct! - 431525 / 728780) < 1e-12);
});

test('categoria do dicionário não observada vale 0 em escopo existente; ausente e desconhecida só quando observadas', () => {
  const l = linhasDe(2024, 10, { raca_cor: { '2': 6, '8': 2, [AUSENTE]: 1, '77': 1 }, escolaridade: { '7': 10 }, vinculo_mte: { '1': 10 }, tipo_vinculo: { '10': 10 } });
  const d = distribuicao(ok(l), 'raca_cor', 'pt');
  assert.equal(d.soma, 10);
  assert.equal(d.itens.find((i) => i.codigo === '1')!.vinculos, 0); // conhecida, não observada: zero
  assert.equal(d.itens.find((i) => i.codigo === '9')!.vinculos, 0); // "não identificada" separada do vazio
  const desc = d.itens.find((i) => i.codigo === '77')!;
  assert.equal(desc.tipo, 'desconhecido');
  assert.match(desc.rotulo, /77/); // código visível no rótulo
  assert.equal(desc.vinculos, 1);
  const aus = d.itens.find((i) => i.codigo === AUSENTE)!;
  assert.equal(aus.tipo, 'ausente');
  assert.equal(aus.vinculos, 1);
  assert.equal(d.itens.at(-1)!.codigo, AUSENTE); // ausente sempre por último
  assert.equal(distribuicao(ok(l), 'escolaridade', 'pt').itens.some((i) => i.tipo === 'ausente'), false); // sem ausente observado, sem linha
});

test('ausente e código desconhecido nunca viram categoria conhecida nem somem do total', () => {
  const l = linhasDe(2024, 5, { raca_cor: { [AUSENTE]: 5 }, escolaridade: { [AUSENTE]: 2, '99': 3 }, vinculo_mte: { [AUSENTE]: 5 }, tipo_vinculo: { [AUSENTE]: 4, '12': 1 } });
  const p = ok(l);
  const raca = distribuicao(p, 'raca_cor', 'pt');
  assert.equal(raca.itens.find((i) => i.codigo === '2')!.vinculos, 0); // nenhum vazio virou branca
  assert.equal(raca.itens.find((i) => i.codigo === AUSENTE)!.pct, 1);
  const esc = distribuicao(p, 'escolaridade', 'pt');
  assert.equal(superiorSomado(esc).vinculos, 0); // vazio e código 99 não são superior
  assert.equal(esc.soma, 5);
  const tv = distribuicao(p, 'tipo_vinculo', 'pt');
  assert.equal(tv.itens.find((i) => i.codigo === '10')!.vinculos, 0); // vazio nunca vira CLT
  assert.equal(tv.itens.find((i) => i.codigo === '12')!.grupoMte, '3'); // desconhecido numérico cai em "outros", como na regra do MTE
  assert.equal(tv.itens.find((i) => i.codigo === AUSENTE)!.grupoMte, null);
});

test('recorte sem vínculos: total 0 e percentual indefinido, não 0%', () => {
  const p = ok(linhasDe(2024, 0, {}));
  assert.equal(p.total, 0);
  const d = distribuicao(p, 'raca_cor', 'pt');
  assert.ok(d.itens.every((i) => i.vinculos === 0 && i.pct === null));
  assert.equal(superiorSomado(distribuicao(p, 'escolaridade', 'pt')).pct, null);
});

test('escopo ausente do arquivo não é zero; dados incoerentes são recusados inteiros', () => {
  assert.deepEqual(lerPerfil([], 2024), { estado: 'sem_escopo' });
  assert.deepEqual(lerPerfil(undefined, 2024), { estado: 'sem_escopo' });
  const base = { raca_cor: { '2': 10 }, escolaridade: { '7': 10 }, vinculo_mte: { '1': 10 }, tipo_vinculo: { '10': 10 } };
  assert.equal(lerPerfil(linhasDe(2024, 10, { ...base, raca_cor: { '2': 9 } }), 2024).estado, 'inconsistente'); // não fecha no total
  assert.equal(lerPerfil(linhasDe(2024, 10, { ...base, escolaridade: {} }), 2024).estado, 'inconsistente'); // dimensão faltando com total > 0
  assert.equal(lerPerfil(linhasDe(2023, 10, base), 2024).estado, 'inconsistente'); // ano trocado
  const dup = [...linhasDe(2024, 10, base), { ano: 2024, variavel: 'raca_cor', codigo: '2', vinculos: 10, total: 10 }];
  assert.equal(lerPerfil(dup, 2024).estado, 'inconsistente');
  const nula = linhasDe(2024, 10, base);
  nula.find((r) => r.variavel === 'raca_cor')!.vinculos = null;
  assert.equal(lerPerfil(nula, 2024).estado, 'inconsistente'); // contagem nula não é zero
  assert.equal(lerPerfil(linhasDe(2024, 10, base).map((r) => (r.variavel === 'vinculo_mte' ? { ...r, total: 11 } : r)), 2024).estado, 'inconsistente');
});

test('fonte opcional: ausente, ano fora da lista e sem ano são indisponíveis, sem ano substituto', () => {
  assert.deepEqual(disponibilidadePerfis(undefined, 2024), { ok: false, motivo: 'sem_fonte', anos: [] });
  assert.equal(disponibilidadePerfis({}, 2024).ok, false);
  assert.equal(disponibilidadePerfis({ anos: [] }, 2024).ok, false);
  const f = { anos: [2022, 2023, 2024], arquivos: 'gold/trabalho/perfis/ano={ano}.parquet' };
  assert.deepEqual(disponibilidadePerfis(f, 2024), { ok: true, anos: [2022, 2023, 2024] });
  const falta = disponibilidadePerfis(f, 2025);
  assert.deepEqual(falta, { ok: false, motivo: 'ano_ausente', anos: [2022, 2023, 2024] });
  assert.deepEqual(disponibilidadePerfis(f, undefined), { ok: false, motivo: 'sem_ano', anos: [2022, 2023, 2024] });
});

test('escopo do arquivo: município de 7 dígitos, UF, Brasil; inválido nunca vira Brasil', () => {
  assert.equal(escopoDoPerfil({ ente: 5208707 }), '5208707');
  assert.equal(escopoDoPerfil({ ente: 53 }), '5300108');
  assert.equal(escopoDoPerfil({ uf: 'GO' }), 'GO');
  assert.equal(escopoDoPerfil({}), 'BR');
  assert.equal(escopoDoPerfil({ ente: "5208707' OR '1'='1" }), null);
  assert.equal(escopoDoPerfil({ ente: 520870 }), null);
  assert.equal(escopoDoPerfil({ uf: 'XX' }), null);
  assert.equal(escopoDoPerfil({ uf: "GO'" }), null);
  assert.equal(escopoDoPerfil({ uf: 'BR' }), null);
});

test('regra do MTE (96/97 estatutários; aprendiz em outros) coincide com a de dados.ts', () => {
  for (const c of ['10', '15', '20', '25', '60', '65', '70', '75']) assert.equal(grupoMte(c), '1', c);
  for (const c of ['30', '31', '35', '96', '97']) assert.equal(grupoMte(c), '2', c);
  for (const c of ['40', '50', '55', '80', '90', '95', '99']) assert.equal(grupoMte(c), '3', c);
  assert.equal(grupoMte(AUSENTE), null);
  const aqui = process.cwd(); // npm test roda em web/
  const ts = readFileSync(path.resolve(aqui, 'src/dados.ts'), 'utf8');
  assert.match(ts, /tipo_vinculo IN \(10, 15, 20, 25, 60, 65, 70, 75\) THEN '1'/);
  assert.match(ts, /tipo_vinculo IN \(30, 31, 35, 96, 97\) THEN '2'/);
});

test('dicionário: mesmos códigos e textos em português do dicionário do pipeline; 6 raças, 11 níveis, 19 tipos', () => {
  const aqui = process.cwd(); // npm test roda em web/
  const csv = readFileSync(path.resolve(aqui, '../pipeline/dicionario_trabalho.csv'), 'utf8').split(/\r?\n/).slice(1).filter(Boolean);
  const real = (v: string) => csv.filter((l) => l.startsWith(`${v},`)).map((l) => l.match(/^[a-z_]+,(\d+),(?:"([^"]*)"|(.*))$/)!).map((m) => [m[1], m[2] ?? m[3]]);
  for (const v of ['raca_cor', 'escolaridade', 'tipo_vinculo'] as const) {
    assert.deepEqual(DICIONARIO[v].map((x) => [x.codigo, x.pt]), real(v), v);
    assert.ok(DICIONARIO[v].every((x) => x.en.length > 0 && !/^\d+\s*[·\-–]/.test(x.pt)), `${v}: rótulo sem código na frente`);
  }
  assert.deepEqual([6, 11, 19], [DICIONARIO.raca_cor.length, DICIONARIO.escolaridade.length, DICIONARIO.tipo_vinculo.length]);
});

test('exportação: todas as categorias (zeros, ausente, desconhecidas, detalhado), números e participação de 0 a 100', () => {
  const l = linhasDe(2024, 8, {
    raca_cor: { '2': 4, '8': 2, '9': 1, [AUSENTE]: 1 }, escolaridade: { '9': 3, '10': 2, '7': 2, '99': 1 },
    vinculo_mte: { '1': 5, '2': 2, '3': 1 }, tipo_vinculo: { '10': 5, '96': 2, '55': 1 },
  });
  const p = ok(l);
  const col = colunasExportacao('pt');
  const rows = linhasExportacao(p, ['raca_cor', 'escolaridade', 'vinculo_mte', 'tipo_vinculo'], 'pt');
  const i = (n: string) => col.indexOf(n);
  const por = (dim: string) => rows.filter((r) => r[0] === dim);
  assert.equal(rows.length, 7 + 12 + 3 + 19);
  assert.equal(por('Raça/cor').length, 7); // 6 do dicionário + vazio observado
  assert.equal(por('Escolaridade').length, 12); // 11 + código 99
  for (const dim of ['Raça/cor', 'Escolaridade', 'Tipo de vínculo (agrupamento do MTE)', 'Tipo de vínculo (detalhado)']) {
    assert.equal(por(dim).reduce((s, r) => s + (r[i('Vínculos ativos')] as number), 0), 8, dim); // soma fecha no total
    assert.ok(Math.abs(por(dim).reduce((s, r) => s + (r[i('Participação')] as number), 0) - 100) < 1e-9, dim); // escala 0–100
  }
  assert.ok(rows.every((r) => typeof r[i('Vínculos ativos')] === 'number' && r[i('Total de vínculos ativos do recorte')] === 8 && r[i('Unidade da participação')] === '%'));
  const vazio = por('Raça/cor').find((r) => r[1] === AUSENTE)!;
  assert.equal(vazio[i('Tipo da categoria')], 'campo vazio');
  assert.equal(vazio[i('Participação')], 12.5);
  const t96 = por('Tipo de vínculo (detalhado)').find((r) => r[1] === '96')!;
  assert.equal(t96[i('Grupo do MTE')], DICIONARIO.vinculo_mte[1].pt);
  assert.equal(por('Escolaridade').find((r) => r[1] === '99')![i('Tipo da categoria')], 'código fora do dicionário');
  // total zero: participação vazia, não 0
  const zero = linhasExportacao(ok(linhasDe(2024, 0, {})), ['raca_cor'], 'pt');
  assert.ok(zero.every((r) => r[i('Participação')] === null && r[i('Vínculos ativos')] === 0));
});

test('metadados: V1 sem versão ignora fallback_v1; V2 só vale nos anos do próprio arquivo; sem lista de anos não há remuneração', () => {
  const v1 = { anos: [2022], fallback_v1: { anos: [2023] } }; // metadado sem versão: só os anos declarados
  assert.equal(disponibilidadePerfis(v1, 2023).ok, false);
  assert.equal(caminhoPerfis(2022, v1), 'gold/trabalho/perfis/ano=2022.parquet');
  assert.equal(caminhoPerfis(2024, { versao: 2, anos: [2023] }), 'gold/trabalho/perfis/ano=2024.parquet'); // ano fora da V2: nunca o arquivo V2
  assert.equal(caminhoPerfis(2024, { versao: 2 }), 'gold/trabalho/perfis/ano=2024.parquet'); // V2 sem anos: nada presumido
  assert.equal(caminhoPerfis(2024, { versao: 1, anos: [2024] }), 'gold/trabalho/perfis/ano=2024.parquet');
});

test('remuneração: média só com poucas ULPs de folga; massa abaixo de 1 centavo por valor é recusada', () => {
  const exata = comRemuneracao();
  assert.equal(lerPerfil(exata, 2024).estado, 'ok');
  const ruido = comRemuneracao().map((r) => ({ ...r }));
  ruido[1].remuneracao_media_dez = (ruido[1].remuneracao_media_dez as number) * (1 + 1e-9); // erro relativo bem acima de poucas ULPs
  assert.equal(lerPerfil(ruido, 2024).estado, 'inconsistente');
  const ulp = comRemuneracao().map((r) => ({ ...r }));
  ulp[2].remuneracao_media_dez = (ulp[2].remuneracao_media_dez as number) * (1 + Number.EPSILON); // 1 ULP: tolerado
  assert.equal(lerPerfil(ulp, 2024).estado, 'ok');
  const pouca = comRemuneracao().map((r) => ({ ...r }));
  pouca[2].massa_dez_centavos = 0;
  pouca[2].remuneracao_media_dez = 0;
  assert.equal(lerPerfil(pouca, 2024).estado, 'inconsistente'); // 1 valor positivo com massa 0: impossível
});
