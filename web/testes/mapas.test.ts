import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { obterCatalogoMapa, obterDadosMapa, validarCargaMapa, type IndicadorMapa, type LinhaMapaDados } from '../src/mapas_dados';
import { buscarMunicipiosMapa, COR_AUSENTE_MAPA, corMapa, formatarMapa, valorEfetivoMapa, legendaMapa, coresLegendaMapa, condicaoMapa } from '../src/mapas_apresentacao';
import { celulasPrincipaisTrabalho, definicoesPrincipaisTrabalho, definicaoCategoriaTrabalho } from '../src/trabalho_mapa';
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

test('Saldos negativos têm legenda própria, distinta de zero e ausência; limites não mudam entre recortes', () => {
  const indicador = { ...i, com_sinal: true };
  assert.notEqual(corMapa(-1, i.escala), corMapa(1, i.escala));
  assert.notEqual(corMapa(-1, i.escala), corMapa(0, i.escala));
  assert.notEqual(corMapa(-1, i.escala), COR_AUSENTE_MAPA);
  assert.equal(legendaMapa(indicador).length, coresLegendaMapa(indicador).length);
  assert.equal(legendaMapa(i).length, 7);
  for (const x of i.escala) assert.notEqual(corMapa(-x, i.escala), corMapa(-x + .000001, i.escala));
  assert.equal(formatarMapa({ ...indicador, formato: 'fracao' }, -.0000001), '>-0,01%');
});

test('Indicadores de Trabalho mantêm as contas do painel, quebra, ausência e ano parcial do CAGED', () => {
  const defs = definicoesPrincipaisTrabalho(2025);
  const serie = [{ ano: 2023, empregos: 20 }, { ano: 2024, empregos: 10, massa_dez: 1000, massa_dez_real: 1200, remuneracao_media: 100, remuneracao_media_real: 120, estabelecimentos: 2, populacao: 1000, empregos_com_populacao: 10, mulheres: 4, homens: 6, ate24: 2, de50mais: 3, superior: 5, n_rem_dez: 8 }];
  const a = celulasPrincipaisTrabalho(serie, [], 2024, 202001, 202608); assert.equal(a.length, defs.length);
  const celula = (id: string) => a[defs.findIndex(i => i.id === id)];
  assert.deepEqual(celula('variacao').slice(0, 1), [-10]); assert.equal(celula('variacao_pct')[0], -.5);
  assert.equal(celula('por_mil')[0], 10); assert.equal(celula('vinculos_por_estab')[0], 5);
  assert.equal(celula('rem_media')[0], 125); assert.equal(celula('rem_media_real')[0], 150);
  assert.equal(celula('mulheres')[0], .4); assert.equal(celula('sem_rem')[0], 2);
  const b = celulasPrincipaisTrabalho([{ ano: 2022, empregos: 20 }, { ano: 2023, empregos: 10 }], [], 2023, 202001, 202608);
  assert.equal(b[defs.findIndex(i => i.id === 'variacao')][3], 12);
  const parcial = celulasPrincipaisTrabalho([], [{ competencia: 202601, admissoes: 1, desligamentos: 2, saldo: -1 }], 2026, 202001, 202608);
  assert.deepEqual(parcial.at(-1), [-1, null, null, 11]); assert.equal(parcial[0][0], null);
  assert(celulasPrincipaisTrabalho([], [], 2026, 202001, 202608).every(c => c[0] === null));
  const zero = celulasPrincipaisTrabalho([{ ano: 2023, empregos: 0 }, { ano: 2024, empregos: 0 }], [], 2024, 202001, 202608);
  assert.equal(zero[defs.findIndex(i => i.id === 'variacao_pct')][3], 4);
  assert.equal(definicaoCategoriaTrabalho('raca_cor', '_ausente', 'rem').id, 'raca_cor_ausente_rem');
});

test('Saneamento mantém motivo original e componentes inconsistentes; remuneração ausente não vira zero', () => {
  const m = { area: 'saneamento', rede: 'todas', cadastro: { sha256: 'x' } } as any;
  const ind = { ...i, id: 'esgoto_pct' };
  const carga = { versao: 1, area: 'saneamento', rede: 'todas', indicador: ind.id, ano: 2024, uf: 'GO', cadastro: 'x', quantidade: 1, valores: null, numeradores: [-1], denominadores: [2], condicoes: [9], condicoes_originais: [4] } as any;
  const [r] = validarCargaMapa(carga, m, ind, 2024, 'GO', [[5208707, 'Goiânia', 'GO']]);
  assert.equal(r.condicao_original, 4); assert.equal(r.numerador, -1); assert.equal(r.valor, null); assert.match(condicaoMapa(r), /inconsistência/);
  assert.throws(() => validarCargaMapa({ ...carga, valores: [-1], condicoes: [0] }, m, ind, 2024, 'GO', [[5208707, 'Goiânia', 'GO']]));
  const trabalho = { ...m, area: 'trabalho' };
  const semRem = { ...carga, area: 'trabalho', numeradores: [null], denominadores: [5], condicoes: [13], rem_validas: [0] };
  const [rem] = validarCargaMapa(semRem, trabalho, ind, 2024, 'GO', [[5208707, 'Goiânia', 'GO']]);
  assert.equal(rem.valor, null); assert.equal(rem.rem_validas, 0); assert.match(condicaoMapa(rem), /sem remuneração válida/);
  assert.throws(() => validarCargaMapa({ ...semRem, rem_validas: [6] }, trabalho, ind, 2024, 'GO', [[5208707, 'Goiânia', 'GO']]));
  assert.throws(() => validarCargaMapa({ ...semRem, valores: [-2], condicoes: [0] }, trabalho, ind, 2024, 'GO', [[5208707, 'Goiânia', 'GO']]));
  assert.equal(validarCargaMapa({ ...semRem, valores: [-2], condicoes: [0] }, trabalho, { ...ind, com_sinal: true }, 2024, 'GO', [[5208707, 'Goiânia', 'GO']])[0].valor, -2);
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

test('Mapa de Trabalho recusa abertura incompatível com a edição atual e permite repetir após corrigir a origem', async () => {
  const original = globalThis.fetch;
  const canonico = (x: any): any => Array.isArray(x) ? x.map(canonico) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonico(x[k])])) : x;
  const g = { gerado_em: 'teste', base_ipca: 2023, fontes: { rais: { anos: [2023] }, caged: { de: 202001, ate: 202312 } } };
  const compat = { gerado_em: g.gerado_em, base_ipca: g.base_ipca, fontes: { ...g.fontes, rais_perfis: null }, ipca: null };
  const abertura = { trabalho: { compatibilidade: compat, historico: {}, anos: {} } };
  const referencia = { caminho: 'gold/mapas/teste_origem.json', bytes: 1, sha256: 'f'.repeat(64) };
  const meta = { versao: 1, area: 'trabalho', rede: 'todas', cadastro: referencia, indicadores: [{ ...i, nome: 'Vínculos', anos: [2023], indice: referencia }], origem: { sha256: sha(bytes(canonico(abertura.trabalho))) } };
  let incompat = true;
  globalThis.fetch = async u => {
    const url = String(u);
    if (url.endsWith('gold/mapas/trabalho_manifesto.json')) return Response.json(meta);
    if (url.endsWith('gold/abertura/manifesto.json')) return Response.json(abertura);
    assert(url.endsWith('gold/manifesto.json'));
    return Response.json({ ...g, fontes: { ...g.fontes, rais: { anos: incompat ? [2024] : [2023] } } });
  };
  try {
    await assert.rejects(obterCatalogoMapa('trabalho'), /dados de trabalho foram atualizados/);
    incompat = false; assert.equal((await obterCatalogoMapa('trabalho')).area, 'trabalho');
  } finally { globalThis.fetch = original; }
});
