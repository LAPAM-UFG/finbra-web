import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { filtrarRankingPib, obterEconomia, obterMetaEconomia, obterRankingPib, type LinhaRankingPib } from '../src/assistencia_economia';
import { buscaEntreAreas } from '../src/navegacao';

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');

test('Busca aceita acentos, código e UF e preserva posições do ranking completo', () => {
  const rows: LinhaRankingPib[] = [[5208707, 'Goiânia', 'GO', 99, 10, 100, 1000], [5201108, 'Anápolis', 'GO', 100, 9, 90, 1000], [5300108, 'Brasília', 'DF', 101, 8, 80, 1000]];
  assert.equal(filtrarRankingPib(rows, 'GOIANIA')[0][3], 99);
  assert.equal(filtrarRankingPib(rows, '5208707')[0][0], 5208707);
  assert.equal(filtrarRankingPib(rows, 'go').length, 2);
  assert.equal(filtrarRankingPib(rows, 'brasilia DF')[0][3], 101);
  assert.equal(filtrarRankingPib(rows, 'inexistente').length, 0);
  assert.equal(filtrarRankingPib(rows, ''), rows);
});

test('Ano e programa acompanham só a navegação dentro da assistência', () => {
  const sp = '?uf=GO&ano_pib=2023&medida=bpc&mes=202609';
  assert.equal(buscaEntreAreas(sp, 'assistencia', 'assistencia'), '?uf=GO&mes=202609&ano_pib=2023&medida=bpc');
  assert.equal(buscaEntreAreas(sp, 'assistencia', 'educacao'), '?uf=GO');
});

test('Ranking lê somente o recorte e valida índice, Range, integridade, período e cobertura', async () => {
  const original = globalThis.fetch;
  const base = bytes({ grupo: 'BR', linhas: [[2023, 1000, 100, 200, 12, 12]] });
  const rows: LinhaRankingPib[] = [[5208707, 'Goiânia', 'GO', 1, 10, 100, 1000], [5300108, 'Brasília', 'DF', 2, 5, 50, 1000]];
  const br = bytes({ versao: 1, medida: 'pbf', ano: 2023, uf: 'BR', linhas: rows });
  const empty = bytes({ versao: 1, medida: 'pbf', ano: 2026, uf: 'BR', linhas: [] });
  const indice = bytes({ versao: 1, medida: 'pbf', anos: [2022, 2023, 2026], anos_com_valor: [2023], arquivo: { caminho: 'gold/assistencia/economia_rankings_teste.ndjson', bytes: br.length + empty.length, sha256: 'a'.repeat(64) }, recortes: {
    '2023:BR': { trecho: [0, br.length, hash(br)], total: 3, validos: 2, condicoes: [2, 1, 0, 0, 0, 0] },
    '2022:BR': { trecho: [0, br.length, hash(br)], total: 3, validos: 2, condicoes: [2, 1, 0, 0, 0, 0] },
    '2023:GO': { trecho: [0, br.length, hash(br)], total: 3, validos: 2, condicoes: [2, 1, 0, 0, 0, 0] },
    '2026:BR': { trecho: [br.length, empty.length, hash(empty)], total: 3, validos: 0, condicoes: [0, 0, 3, 0, 0, 0] },
    '2023:DF': { trecho: [0, br.length, hash(br)], total: 3, validos: 2, condicoes: [1, 1, 0, 0, 0, 0] },
  } });
  const meta = { versao: 1, anos: [2022, 2023, 2026], pib_ate: 2023, grupos: { BR: [0, base.length, hash(base)] }, indices_uf: {},
    arquivo: { caminho: 'gold/assistencia/economia_series_teste.ndjson', bytes: base.length, sha256: hash(base) },
    rankings: { pbf: { caminho: 'gold/assistencia/economia_ranking_pbf_teste.json', bytes: indice.length, sha256: hash(indice) } } };
  const requests: string[] = []; let indiceRuim = true; let modo = 'inteiro'; let cancelou = false;
  globalThis.fetch = (async (url, init) => {
    const u = String(url); requests.push(u);
    if (u.endsWith('economia_manifesto.json')) return new Response(JSON.stringify(meta));
    if (u.endsWith('economia_ranking_pbf_teste.json')) return new Response(indiceRuim ? new Uint8Array(indice.length) : indice);
    const range = new Headers(init?.headers).get('Range');
    if (u.endsWith('economia_series_teste.ndjson')) return new Response(base, { status: 206, headers: { 'Content-Range': `bytes 0-${base.length - 1}/${base.length}` } });
    assert.ok(range === `bytes=0-${br.length - 1}` || range === `bytes=${br.length}-${br.length + empty.length - 1}`, 'Um intervalo exato, sem baixar o bundle inteiro');
    if (modo === 'inteiro') return new Response(new ReadableStream({ cancel() { cancelou = true; } }));
    const vazio = range!.startsWith(`bytes=${br.length}-`); const data = vazio ? empty : br;
    return new Response(modo === 'corrompido' ? new Uint8Array(data.length) : data, { status: 206, headers: { 'Content-Range': `bytes ${vazio ? br.length : 0}-${vazio ? br.length + empty.length - 1 : br.length - 1}/${br.length + empty.length}` } });
  }) as typeof fetch;
  try {
    await obterMetaEconomia(); await obterEconomia('BR', null);
    assert.equal(requests.length, 2, 'O painel anual não baixa índices ou dados de rankings');
    await assert.rejects(obterRankingPib('pbf', 2023, 'BR'), /Índice anual incompleto/);
    indiceRuim = false;
    await assert.rejects(obterRankingPib('pbf', 2023, 'BR'), /somente este recorte/); assert.equal(cancelou, true);
    modo = 'corrompido'; await assert.rejects(obterRankingPib('pbf', 2023, 'BR'), /incompletos/);
    modo = 'ok'; const r = await obterRankingPib('pbf', 2023, 'BR'); assert.equal(r.linhas[0][0], 5208707); assert.equal(r.cobertura.validos, 2);
    const antes = requests.length; await obterRankingPib('pbf', 2023, 'BR'); assert.equal(requests.length, antes, 'Trocas repetidas reaproveitam o recorte');
    assert.equal((await obterRankingPib('pbf', 2026, 'BR')).linhas.length, 0, 'Ano parcial tem classificação vazia, não zero ou erro de rede');
    await assert.rejects(obterRankingPib('pbf', 2022, 'BR'), /outro recorte/);
    await assert.rejects(obterRankingPib('pbf', 2023, 'GO'), /outro recorte/);
    await assert.rejects(obterRankingPib('pbf', 2023, 'DF'), /Cobertura/);
    await assert.rejects(obterRankingPib('bpc', 2023, 'BR'), /ainda indisponível/);
    await assert.rejects(obterRankingPib('pbf', 2023, 'XX'), /fora da cobertura/);
    assert.equal(requests.filter(u => u.endsWith('economia_manifesto.json')).length, 1);
    assert.equal(requests.filter(u => u.endsWith('economia_ranking_pbf_teste.json')).length, 2, 'O índice é repetido só após falhar, sem baixar os outros programas');
  } finally { globalThis.fetch = original; }
});
