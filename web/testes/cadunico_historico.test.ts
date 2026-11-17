import test from 'node:test';
import assert from 'node:assert/strict';
import { linkHistoricoCadunico, indicadorHistoricoCadunico } from '../src/cadunico_historico';
import { condicaoComparacao } from '../src/comparacoes_apresentacao';
import { enderecoDownloadHistorico, validarSerieComparacao } from '../src/comparacoes_dados';

test('atalho mantém município e idioma, sem levar a data do retrato para a série', () => {
  const u = new URL(linkHistoricoCadunico(new URLSearchParams('cod=3550308&uf=SP&mes=202610&ano=2026&inicio=202501&periodo=202610&lang=en&fonte=cadunico')), 'https://example.test');
  assert.equal(u.pathname, '/assistencia/comparar');
  assert.equal(u.searchParams.get('conjunto'), 'cadunico_historico');
  assert.equal(u.searchParams.get('cod'), '3550308');
  assert.equal(u.searchParams.get('lang'), 'en');
  for (const k of ['mes', 'ano', 'inicio', 'periodo', 'fonte']) assert.equal(u.searchParams.has(k), false);
});
test('atalho de pessoas não troca a medida por famílias', () => {
  const u = linkHistoricoCadunico(new URLSearchParams(), indicadorHistoricoCadunico.cad_qtd_pessoas);
  assert.ok(u.includes('indicador=cad_hist_pessoas'));
  assert.equal(indicadorHistoricoCadunico.cad_perfil_qualquer, undefined);
});
test('Brasil publicado tem condição própria, sem atribuir cobertura municipal ao arquivo parcial', () => {
  assert.match(condicaoComparacao(22), /Total nacional publicado/);
  assert.doesNotMatch(condicaoComparacao(22), /incompleta/);
});
test('a condição nacional só é aceita no contexto próprio e com componentes publicados', () => {
  const s = {v:[200],n:[400],d:[2000],c:[22],q:[0]};
  assert.throws(() => validarSerieComparacao(s,1,5571));
  assert.doesNotThrow(() => validarSerieComparacao(s,1,5571,true));
  assert.throws(() => validarSerieComparacao({...s,n:[null]},1,5571,true));
  assert.throws(() => validarSerieComparacao({...s,v:[null]},1,5571,true));
  assert.throws(() => validarSerieComparacao({...s,q:[645]},1,5571,true));
});
test('downloads aceitam só os arquivos imutáveis do histórico, sem consultas de rede', () => {
  const o = { caminho: 'gold/comparacoes/cadunico_historico_abc123.dta', sha256: 'a'.repeat(64), bytes: 100 };
  assert.ok(enderecoDownloadHistorico(o).endsWith(o.caminho));
  for (const caminho of ['https://example.test/a.csv', 'gold/comparacoes/../segredo.csv', 'gold/assistencia/qualquer.csv', 'gold/comparacoes/cadunico_historico_x.exe'])
    assert.throws(() => enderecoDownloadHistorico({...o, caminho}));
  assert.throws(() => enderecoDownloadHistorico({...o, bytes: -1}));
});
