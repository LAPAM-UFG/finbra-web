import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { obterCatalogoMapa, obterDadosMapa, validarCargaMapa, type IndicadorMapa, type LinhaMapaDados } from '../src/mapas_dados';
import { buscarMunicipiosMapa, COR_AUSENTE_MAPA, corMapa, formatarMapa, valorEfetivoMapa } from '../src/mapas_apresentacao';
import { UF_NOMES } from '../src/ufs';
const bytes = (x: unknown) => Buffer.from(JSON.stringify(x));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const i = { id: 'mat_total', formato: 'numero', escala: [1, 2, 5, 10] } as IndicadorMapa;
const linha = { cod: 5208707, nome: 'Goiânia', uf: 'GO', valor: 0, numerador: null, denominador: null, condicao: 1, marcador: null } as LinhaMapaDados;

test('Mapas distinguem zero, ausência e limites exatos; percentuais próximos dos extremos não viram 0% ou 100%', () => {
  assert.notEqual(corMapa(0, i.escala), corMapa(null, i.escala)); assert.equal(corMapa(NaN, i.escala), COR_AUSENTE_MAPA);
  for (const x of i.escala) assert.notEqual(corMapa(x - .000001, i.escala), corMapa(x, i.escala));
  const p = { ...i, formato: 'percentual' } as IndicadorMapa;
  assert.equal(formatarMapa(p, .00001), '<0,01%'); assert.equal(formatarMapa(p, 99.9999), '>99,99%');
  assert.equal(formatarMapa({ ...p, formato: 'fracao' }, .2), '20%');
  assert.equal(formatarMapa({ ...p, formato: 'fracao' }, 1.2), '120%');
  assert.equal(formatarMapa({ ...p, formato: 'pontos' }, 230.5).includes('%'), false);
});
test('Ressalvas só afetam as cores opcionais: valores e motivos originais continuam disponíveis', () => {
  const flagged = { ...linha, valor: 180, condicao: 8, marcador: 1 };
  assert.equal(valorEfetivoMapa(flagged, false), null); assert.equal(valorEfetivoMapa(flagged, true), 180); assert.equal(flagged.valor, 180);
  assert.equal(valorEfetivoMapa(linha, false), 0);
  assert.equal(valorEfetivoMapa({ ...linha, valor: null, condicao: 4 }, true), null);
});
test('Busca aceita nome sem acentos, código e UF, incluindo municípios sem valor', () => {
  const ausente = { ...linha, cod: 5101837, nome: 'Boa Esperança do Norte', uf: 'MT', valor: null, condicao: 2 };
  assert.equal(buscarMunicipiosMapa([linha, ausente], 'goiania GO')[0], linha);
  assert.equal(buscarMunicipiosMapa([linha, ausente], '5101837')[0], ausente);
  assert.equal(buscarMunicipiosMapa([linha, ausente], '').length, 2);
});
test('Leitor usa um Range, confere integridade e recorte, repete falhas e não busca dados fora da cobertura', async () => {
  const original = globalThis.fetch; const calls: { url: string; range: string | null }[] = [];
  const ref = (nome: string, b: Buffer) => ({ caminho: `gold/mapas/${nome}.json`, bytes: b.length, sha256: sha(b) });
  const reg = bytes({ versao: 1, municipios: [[5201108, 'Anápolis', 'GO'], [5208707, 'Goiânia', 'GO'], [5300108, 'Brasília', 'DF']] }); const cadastro = ref('cadastro_teste', reg);
  let offset = 0; const recortes: Record<string, [number, number, string]> = {}; const textos: Buffer[] = [];
  for (const uf of Object.keys(UF_NOMES).sort()) {
    const n = uf === 'GO' ? 2 : uf === 'DF' ? 1 : 0;
    const carga = { versao: 1, area: 'educacao', rede: 'todas', indicador: i.id, ano: 2023, uf, cadastro: cadastro.sha256, quantidade: n, valores: uf === 'GO' ? [0, null] : uf === 'DF' ? [100] : null };
    const b = Buffer.concat([bytes(carga), Buffer.from('\n')]); recortes[`2023:${uf}`] = [offset, b.length, sha(b)]; textos.push(b); offset += b.length;
  }
  const dados = Buffer.concat(textos); recortes['2023:BR'] = [0, dados.length, sha(dados)];
  const arquivo = { caminho: 'gold/mapas/educacao_todas_dados_teste.ndjson', bytes: dados.length, sha256: sha(dados) };
  const indiceBytes = bytes({ versao: 1, area: 'educacao', rede: 'todas', indicador: i.id, cadastro: cadastro.sha256, arquivo, recortes }); const indice = ref('educacao_todas_mat_total_indice_teste', indiceBytes);
  const base = bytes({ gerado_em: '2026-11-16', dados: 'originais' });
  const indicador = { ...i, nome: 'Matrículas', nome_en: 'Enrolments', anos: [2023], anos_com_valor: [2023], indice, fontes: [] };
  const meta = { versao: 1, area: 'educacao', rede: 'todas', cadastro, indicadores: [indicador], origem: { tipo: 'educacao', caminho: 'gold/educacao/manifesto.json', sha256: sha(base) } };
  let falha = 'range';
  globalThis.fetch = async (u, init) => {
    const url = String(u); const range = new Headers(init?.headers).get('Range'); calls.push({ url, range });
    if (url.endsWith('gold/mapas/educacao_manifesto.json')) return Response.json(meta);
    if (url.endsWith('gold/educacao/manifesto.json')) return new Response(base);
    if (url.endsWith(cadastro.caminho)) return new Response(reg);
    if (url.endsWith(indice.caminho)) return new Response(indiceBytes);
    assert(url.endsWith(arquivo.caminho)); assert(range);
    const [, a, b] = range!.match(/^bytes=(\d+)-(\d+)$/)!; const inicio = Number(a), fim = Number(b);
    return new Response(falha === 'corromper' ? dados.subarray(inicio + 1, fim + 1) : dados.subarray(inicio, fim + 1), { status: falha === 'range' ? 200 : 206, headers: { 'Content-Range': `bytes ${inicio}-${fim}/${dados.length}` } });
  };
  try {
    const m = await obterCatalogoMapa('educacao'); const ind = m.indicadores[0];
    await assert.rejects(obterDadosMapa(m, ind, 2023, 'GO'), /somente o recorte/);
    falha = 'corromper'; await assert.rejects(obterDadosMapa(m, ind, 2023, 'GO'), /incompleto/);
    falha = ''; const go = await obterDadosMapa(m, ind, 2023, 'GO'); assert.deepEqual(go.map(l => l.valor), [0, null]); assert.deepEqual(go.map(l => l.condicao), [1, 2]);
    const antes = calls.length; await obterDadosMapa(m, ind, 2023, 'GO'); assert.equal(calls.length, antes);
    const ausentes = await obterDadosMapa(m, { ...ind, avaliacao: true, edicoes: [2023] }, 2024, 'GO'); assert.equal(calls.length, antes); assert(ausentes.every(l => l.valor === null && l.condicao === 7));
    const br = await obterDadosMapa(m, ind, 2023, 'BR'); assert.equal(br.length, 3); assert.equal(br.find(x => x.uf === 'DF')?.cod, 5300108);
    const modelo = JSON.parse(textos[Object.keys(UF_NOMES).sort().indexOf('GO')].toString());
    assert.throws(() => validarCargaMapa({ ...modelo, ano: 2024 }, m, ind, 2023, 'GO', [[5201108, 'Anápolis', 'GO'], [5208707, 'Goiânia', 'GO']]));
    assert.equal(calls.filter(x => /\.ndjson$/.test(x.url)).length, 4);
    assert.equal(calls.some(x => /\.parquet|\.wasm/.test(x.url)), false);
  } finally { globalThis.fetch = original; }
});
