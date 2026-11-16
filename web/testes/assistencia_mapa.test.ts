import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buscarNoMapa, centroDaMalha, COR_SEM_PERCENTUAL, corPercentualPib, linhasDoMapa, obterMalhaMunicipal, tamanhoMapa, validarMalha, type MalhaMunicipal } from '../src/assistencia_mapa';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { SVGRenderer } from 'echarts/renderers';

const malha: MalhaMunicipal = { type: 'FeatureCollection', features: [
  { type: 'Feature', properties: { name: '5208707', nome: 'Goiânia', uf: 'GO' }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] } },
  { type: 'Feature', properties: { name: '5101837', nome: 'Boa Esperança do Norte', uf: 'MT' }, geometry: { type: 'Polygon', coordinates: [[[2, 0], [3, 0], [3, 1], [2, 0]]] } },
] };

test('O mapa distingue zero registrado e ausência; não arredonda os limites da escala', () => {
  assert.notEqual(corPercentualPib(0), corPercentualPib(null));
  assert.equal(corPercentualPib(NaN), COR_SEM_PERCENTUAL);
  assert.equal(corPercentualPib(-1), COR_SEM_PERCENTUAL);
  for (const limite of [0, 2, 5, 10, 20]) assert.notEqual(corPercentualPib(limite), corPercentualPib(limite === 0 ? .0000001 : limite - .0000001));
  const r = linhasDoMapa(malha, [[5208707, 'Goiânia', 'GO', 1, 0, 0, 1000]]);
  assert.equal(r[0].percentual, 0); assert.equal(r[1].percentual, null);
  assert.equal(linhasDoMapa(malha, []).filter(x => x.percentual === null).length, 2);
});
test('Busca no mapa aceita acentos e códigos e encontra municípios sem percentual', () => {
  assert.equal(buscarNoMapa(malha, 'GOIANIA GO')[0].name, '5208707');
  assert.equal(buscarNoMapa(malha, '5101837')[0].nome, 'Boa Esperança do Norte');
  assert.equal(buscarNoMapa(malha, 'esperanca MT').length, 1);
  assert.deepEqual(buscarNoMapa(malha, 'desconhecido'), []);
  assert.deepEqual(buscarNoMapa(malha, '  '), []);
});
test('Malha recusa território duplicado, recorte de outro estado e cobertura incompleta', () => {
  validarMalha(malha, 'BR', 2);
  assert.throws(() => validarMalha(malha, 'GO', 2));
  assert.throws(() => validarMalha(malha, 'BR', 3));
  assert.throws(() => validarMalha({ ...malha, features: [malha.features[0], malha.features[0]] }, 'BR', 2));
});
test('Mapa real conserva cores de zero e ausência depois de zoom, reenquadramento e resize', () => {
  echarts.use([MapChart, SVGRenderer]);
  echarts.registerMap('regressao-pib', malha);
  const centro = centroDaMalha(malha); assert.deepEqual(centro, [1.5, .5]);
  const c = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: 600, height: 400 });
  const data = malha.features.map((f, i) => ({ name: f.properties.name, value: i === 0 ? 0 : '-', itemStyle: { areaColor: corPercentualPib(i === 0 ? 0 : null) } }));
  try {
    c.setOption({ animation: false, series: [{ type: 'map', map: 'regressao-pib', center: centro, data }] });
    c.setOption({ series: [{ zoom: 8, center: [1, 1] }] });
    c.setOption({ series: [{ center: centro, zoom: 1 }] });
    // A navegação com Suspense oculta o mapa antes de desmontar: jamais repasse
    // essas dimensões ao ECharts, cuja inversão de matriz falha com tamanho zero.
    for (const [w, h] of [[0, 0], [0, 350], [390, 0], [390, 350], [1280, 590]]) {
      const dimensoes = tamanhoMapa(w, h);
      if (w === 0 || h === 0) assert.equal(dimensoes, null);
      if (dimensoes) c.resize(dimensoes);
    }
    const svg = c.renderToSVGString();
    assert(svg.includes(corPercentualPib(0))); assert(svg.includes(COR_SEM_PERCENTUAL));
  } finally { c.dispose(); }
});
test('Carrega só a geometria pedida, verifica SHA/bytes e permite repetir falha de rede', async () => {
  const original = globalThis.fetch; const chamadas: string[] = [];
  const b = new TextEncoder().encode(JSON.stringify({ type: 'Topology', objects: { municipios: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', properties: malha.features[0].properties, arcs: [[0]] }] } }, arcs: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }));
  const caminho = 'gold/geografia/municipios_2025_go_0123456789abcdef.json';
  const cat = { versao: 1, ano_malha: 2025, fonte: 'https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html', recortes: { GO: { caminho, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex'), territorios: 1 } } };
  let falhar = true;
  globalThis.fetch = async u => {
    const url = String(u); chamadas.push(url);
    if (url.endsWith('/manifesto.json')) return Response.json(cat);
    if (falhar) return new Response(b.slice(1), { status: 200 });
    return new Response(b);
  };
  try {
    await assert.rejects(obterMalhaMunicipal('GO'), /incompleta/);
    falhar = false;
    const g = await obterMalhaMunicipal('GO');
    assert.equal(g.malha.features[0].properties.name, '5208707');
    assert.equal(chamadas.filter(x => x.endsWith('/manifesto.json')).length, 1);
    assert.equal(chamadas.filter(x => x.endsWith(caminho)).length, 2);
    assert.equal(chamadas.some(x => /_br_|\.parquet|\.wasm/.test(x)), false);
    await obterMalhaMunicipal('GO'); assert.equal(chamadas.length, 3);
    await assert.rejects(obterMalhaMunicipal('../BR'), /inválido/);
  } finally { globalThis.fetch = original; }
});
