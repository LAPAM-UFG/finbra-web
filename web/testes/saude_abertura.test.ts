/**
 * Abertura rápida da saúde (src/saude_abertura.ts): pacote sintético no formato de pipeline/saude_abertura.py, offsets em bytes UTF-8, Range,
 * nulos e zeros, aliases do DF, recortes sem dados, manifesto de outra versão, corrupção/truncamento e fallback para o motor (que aqui nunca existe:
 * toda rota nativa que falha devolve USAR_MOTOR).
 * Com SAUDE_ABERTURA_CANDIDATO (pasta com gold/ e manifesto), confere TODOS os grupos do pacote real contra uma leitura independente por offsets.
 * Executar:  npx vite build --ssr testes/saude_abertura.test.ts --outDir testes/.saida/saude_abertura --emptyOutDir --logLevel warn && node --test testes/.saida/saude_abertura/saude_abertura.test.js
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import type { Dependencias } from '../src/clima_abertura';
import type { ManifestoBruto } from '../src/manifesto';
import { anuncioDoManifesto, criarAberturaSaude, grupoSaude, grupoSiops, lerLinhaGrupo, USAR_MOTOR } from '../src/saude_abertura';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const enc = new TextEncoder();
const COLUNAS = ['ano', 'cod_ibge', 'municipio', 'nome', 'uf', 'populacao', 'obitos', 'int_valor_real', 'ab_cobertura'];
const SERIE = ['populacao', 'obitos', 'int_valor_real', 'ab_cobertura'];
const GERADO = '2026-11-14T01:00:00+00:00';
const ORIGEM = Object.fromEntries(['municipios', 'saude_educacao', 'entes', 'indicadores', 'ipca'].map((k) => [k, sha(k)]));

type G = { g: string; a?: number[]; m?: number[]; r?: (number | null)[][]; p?: [number, number | null, number | null][] };
type Pacote = { manifesto: ManifestoBruto; indice: Uint8Array; dados: Uint8Array; arquivos: Map<string, Uint8Array>; indiceObj: Record<string, unknown> };

function montar(opcoes: { snapshot?: string; gerado?: string; grupos?: G[]; mexer?: (i: Record<string, unknown>) => void } = {}): Pacote {
  const snapshot = opcoes.snapshot ?? 'abcdef012345';
  const gerado = opcoes.gerado ?? GERADO;
  const grupos: G[] = opcoes.grupos ?? [
    { g: 'BR', a: [2013, 2014], m: [2, 2], r: [[300.5, 10, 1e9 + 0.25, null], [310, 11, 2e9, 50]], p: [[2013, 900.5, 700], [2014, 1000, null]] },
    { g: 'GO', a: [2013, 2014], m: [1, 1], r: [[100, 3, 0, null], [101, 4, 5, 60]], p: [[2013, 800, 600]] },
    { g: '11', p: [[2013, 1500, 1200]] }, // estado: só SIOPS
    { g: '53', p: [[2013, 2000, 1800], [2014, 2100, 1900]] }, // DF no SIOPS
    { g: '5208707', a: [2013, 2014], m: [1, 1], r: [[100, 0, 0, null], [101, 0, 5.5, 60]], p: [[2013, null, null]] }, // zero real ≠ null
    { g: '5300108', a: [2014], m: [1], r: [[250, 7, 1, 70]], p: [] }, // Brasília na saúde
    { g: '3305505', a: [2014], m: [1], r: [[1, 1, 1, 1]], p: [] }, // outro município
  ].map((x) => ({ ...x }));
  const linhas = grupos.map((x) => enc.encode(JSON.stringify({ g: x.g, s: snapshot, a: x.a ?? [], m: x.m ?? [], r: x.r ?? [], p: x.p ?? [] }) + '\n'));
  const dados = new Uint8Array(linhas.reduce((n, l) => n + l.byteLength, 0));
  linhas.reduce((o, l) => (dados.set(l, o), o + l.byteLength), 0);
  const nomeArq = `abertura_${sha(dados).slice(0, 12)}.ndjson`;
  const indiceObj: Record<string, unknown> = {
    versao: 1, snapshot, arquivo: nomeArq, sha256: sha(dados), bytes: dados.byteLength, gerado_em: gerado, base_ipca: 2025, origem: ORIGEM,
    colunas: COLUNAS, serie: SERIE, siops: ['saude_hab', 'saude_proprios_hab'], aliases: { saude: { '53': '5300108' } },
    entes: [[5208707, 'Goiânia (ação)', 'GO', 'M', false], [11, 'Rondônia', 'RO', 'E', null], [53, 'Distrito Federal', 'DF', 'D', false]],
    grupos: grupos.map((x) => x.g), tamanhos: linhas.map((l) => l.byteLength),
  };
  opcoes.mexer?.(indiceObj);
  const indice = enc.encode(JSON.stringify(indiceObj));
  const ih = sha(indice);
  const manifesto: ManifestoBruto = {
    gerado_em: gerado, anos: [2013, 2014], base_ipca: 2025, colunas: { '2014': { A: ['x'] } }, ipca_ultimo: { exercicio: 2025, meses: 12 },
    fontes: { siconfi: { x: 1 }, clima: { abertura: { versao: 1 } } }, mapa_indicadores: { receita: [{ chave: 'r' }] }, politica_alertas: { p: 1 },
    aberturas: {
      clima: { versao: 1 },
      saude: { versao: 1, indice: `gold/saude/abertura_indice_${ih.slice(0, 12)}.json`, indice_sha256: ih, indice_bytes: indice.byteLength, arquivo: `gold/saude/${nomeArq}`,
        sha256: sha(dados), bytes: dados.byteLength, snapshot, grupos: grupos.length, gerado_em: gerado, origem: ORIGEM },
    },
  };
  const a = manifesto.aberturas!.saude as { indice: string; arquivo: string };
  return { manifesto, indice, dados, arquivos: new Map([[a.indice, indice], [a.arquivo, dados]]), indiceObj };
}

type Registro = { url: string; range: string | null };
function servidor(p: Pacote, mod: { semRange?: boolean; contentRange?: string; semContentRange?: boolean; deslocar?: number; total?: number; cortar?: number; status?: Record<string, number>; corpo?: (c: string, b: Uint8Array) => Uint8Array; rede?: () => boolean } = {}) {
  const log: Registro[] = [];
  const buscar: Dependencias['buscar'] = async (url, init) => {
    const caminho = url.replace(/^(?:.*\/)?v\/\d+\//, '');
    const range = new Headers(init?.headers).get('Range');
    log.push({ url, range });
    if (mod.rede?.()) throw new TypeError('falha de rede');
    if (mod.status?.[caminho]) return new Response('x', { status: mod.status[caminho] });
    let b = p.arquivos.get(caminho);
    if (!b) return new Response('não encontrado', { status: 404 });
    if (mod.corpo) b = mod.corpo(caminho, b);
    const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    if (!m || mod.semRange) return new Response(b as BodyInit, { status: 200 });
    const [i, f] = [Number(m[1]), Number(m[2])];
    let parte = b.slice(i, f + 1);
    if (mod.cortar) parte = parte.slice(0, parte.byteLength - mod.cortar);
    const headers: Record<string, string> = mod.semContentRange ? {} : { 'Content-Range': mod.contentRange ?? `bytes ${i + (mod.deslocar ?? 0)}-${f + (mod.deslocar ?? 0)}/${mod.total ?? b.byteLength}` };
    return new Response(parte as BodyInit, { status: 206, headers });
  };
  return { buscar, log };
}

function abertura(p: Pacote, mod: Parameters<typeof servidor>[1] = {}, manifesto?: () => Promise<ManifestoBruto>, limite?: number) {
  const s = servidor(p, mod);
  const avisos: string[] = [];
  const a = criarAberturaSaude({ manifesto: manifesto ?? (async () => p.manifesto), url: (c, m) => `https://site.test/dados/v/${m.gerado_em.replace(/\D/g, '')}1/${c}`, buscar: s.buscar, avisar: (m) => void avisos.push(m) }, limite);
  return { a, ...s, avisos };
}

test('recortes: ente (53 → Brasília na saúde, mas 53 no SIOPS), UF, Brasil e valores não numéricos', () => {
  assert.equal(grupoSaude({ ente: 53 }), '5300108');
  assert.equal(grupoSaude({ ente: '3305505' }), '3305505');
  assert.equal(grupoSaude({ ente: 53, uf: 'GO' }), '5300108'); // o ente vence a UF
  assert.equal(grupoSaude({ uf: 'GO' }), 'GO');
  assert.equal(grupoSaude({ uf: 'XX' }), 'BR');
  assert.equal(grupoSaude({}), 'BR');
  assert.equal(grupoSaude({ ente: 'abc', uf: 'GO' }), 'GO'); // NaN é falso, como o SQL das rotas
  assert.equal(grupoSiops({ ente: 53 }), '53');
  assert.equal(grupoSiops({ ente: 11 }), '11');
  assert.equal(grupoSiops({ uf: 'DF' }), 'DF');
  assert.equal(grupoSiops({}), 'BR');
});

test('saude_serie: todas as colunas e anos, com zero ≠ null, sem motor e com UM Range por recorte', async () => {
  const p = montar();
  const { a, log, avisos } = abertura(p);
  const br = (await a.executar('saude_serie', {})) as Record<string, number | null>[];
  assert.deepEqual(br[0], { ano: 2013, municipios: 2, populacao: 300.5, obitos: 10, int_valor_real: 1e9 + 0.25, ab_cobertura: null });
  assert.equal(br.length, 2);
  assert.deepEqual(Object.keys(br[1]), ['ano', 'municipios', ...SERIE]);
  const mun = (await a.executar('saude_serie', { ente: 5208707 })) as Record<string, number | null>[];
  assert.equal(mun[0].obitos, 0);
  assert.notEqual(mun[0].obitos, null);
  assert.equal(mun[0].ab_cobertura, null);
  assert.equal(mun[0].int_valor_real, 0);
  assert.equal(mun[1].int_valor_real, 5.5);
  // DF: o ente 53 vira Brasília (5300108)
  const df = (await a.executar('saude_serie', { ente: 53 })) as Record<string, number | null>[];
  assert.deepEqual(df.map((r) => [r.ano, r.populacao, r.obitos]), [[2014, 250, 7]]);
  assert.deepEqual(await a.executar('saude_serie', { uf: 'GO' }), [
    { ano: 2013, municipios: 1, populacao: 100, obitos: 3, int_valor_real: 0, ab_cobertura: null },
    { ano: 2014, municipios: 1, populacao: 101, obitos: 4, int_valor_real: 5, ab_cobertura: 60 },
  ]);
  assert.equal(log.filter((x) => x.range === null).length, 1, 'o índice vem uma vez; os demais pedidos são Range');
  assert.ok(log.filter((x) => x.range).every((x) => /^bytes=\d+-\d+$/.test(x.range!)));
  assert.equal(avisos.length, 0);
  assert.equal(a.estado(), 'rapido');
});

test('recorte sem linhas devolve [] (como o SQL), sem erro e sem zeros inventados', async () => {
  const { a } = abertura(montar());
  assert.deepEqual(await a.executar('saude_serie', { ente: 9999999 }), []);
  assert.deepEqual(await a.executar('saude_serie', { ente: 11 }), []); // estado: só SIOPS
  assert.deepEqual(await a.executar('saude_siops', { ente: 9999999 }), []);
  assert.deepEqual(await a.executar('saude_siops', { uf: 'DF' }), []); // sem município no DF
});

test('saude_siops: três campos, ente com o código como está (53 é o DF), UF e Brasil', async () => {
  const { a } = abertura(montar());
  assert.deepEqual(await a.executar('saude_siops', { ente: 53 }), [
    { ano: 2013, saude_hab: 2000, saude_proprios_hab: 1800 }, { ano: 2014, saude_hab: 2100, saude_proprios_hab: 1900 }]);
  assert.deepEqual(await a.executar('saude_siops', { ente: 5208707 }), [{ ano: 2013, saude_hab: null, saude_proprios_hab: null }]);
  assert.deepEqual(await a.executar('saude_siops', { ente: 5300108 }), []); // Brasília não tem linha de SIOPS (o DF é o ente 53)
  assert.deepEqual(await a.executar('saude_siops', { uf: 'GO' }), [{ ano: 2013, saude_hab: 800, saude_proprios_hab: 600 }]);
  assert.deepEqual(await a.executar('saude_siops', {}), [
    { ano: 2013, saude_hab: 900.5, saude_proprios_hab: 700 }, { ano: 2014, saude_hab: 1000, saude_proprios_hab: null }]);
  assert.deepEqual(await a.executar('saude_siops', { ente: 11 }), [{ ano: 2013, saude_hab: 1500, saude_proprios_hab: 1200 }]);
});

test('contexto: saude_meta reproduz os campos de meta (com o gerado_em do manifesto), saude_entes e saude_colunas', async () => {
  const p = montar();
  const { a, log } = abertura(p);
  assert.deepEqual(await a.executar('saude_meta', {}), {
    anos: [2013, 2014], anexos: { A: ['x'] }, baseIpca: 2025, geradoEm: GERADO, ipcaUltimo: { exercicio: 2025, meses: 12 },
    fontes: p.manifesto.fontes, mapaIndicadores: p.manifesto.mapa_indicadores, politica: { p: 1 },
  });
  assert.deepEqual(await a.executar('saude_entes', {}), [
    { cod_ibge: 5208707, nome: 'Goiânia (ação)', uf: 'GO', esfera: 'M', capital: false },
    { cod_ibge: 11, nome: 'Rondônia', uf: 'RO', esfera: 'E', capital: null },
    { cod_ibge: 53, nome: 'Distrito Federal', uf: 'DF', esfera: 'D', capital: false },
  ]);
  assert.deepEqual(await a.executar('saude_colunas', {}), COLUNAS.map((column_name) => ({ column_name })));
  assert.equal(log.filter((x) => x.range).length, 0, 'contexto e colunas não pedem trechos');
  assert.equal(Object.keys(p.manifesto.fontes!).length, 2);
});

test('rotas de outros painéis e do motor não são interceptadas', async () => {
  const { a, log } = abertura(montar());
  for (const r of ['meta', 'entes', 'saude_aps', 'saude_municipios', 'se_ente', 'se_grupo', 'ranking', 'clima_painel']) assert.equal(await a.executar(r, {}), USAR_MOTOR, r);
  assert.equal(log.length, 0, 'nem o manifesto de pacote foi lido');
});

test('offsets em bytes UTF-8: nomes acentuados no índice não deslocam os grupos', () => {
  const p = montar();
  assert.ok(new TextDecoder().decode(p.dados).length <= p.dados.byteLength);
  let off = 0;
  const tam = p.indiceObj.tamanhos as number[];
  (p.indiceObj.grupos as string[]).forEach((g, k) => {
    const x = lerLinhaGrupo(p.dados.slice(off, off + tam[k]), g, tam[k], 'abcdef012345', SERIE.length);
    assert.ok(Array.isArray(x.a));
    off += tam[k];
  });
});

test('manifesto sem o ponteiro, de outro gerado_em ou malformado: motor, sem buscar nada', async () => {
  const p = montar();
  const casos: [string, ManifestoBruto][] = [
    ['sem aberturas', { ...p.manifesto, aberturas: undefined }],
    ['sem saude', { ...p.manifesto, aberturas: { clima: {} } }],
    ['manifesto mais novo (gerado_em diferente)', { ...p.manifesto, gerado_em: '2026-11-15T00:00:00+00:00' }],
    ['versão 2', { ...p.manifesto, aberturas: { saude: { ...(p.manifesto.aberturas!.saude as object), versao: 2 } } }],
    ['arquivo com nome de outro hash', { ...p.manifesto, aberturas: { saude: { ...(p.manifesto.aberturas!.saude as object), arquivo: 'gold/saude/abertura_000000000000.ndjson' } } }],
    ['caminho fora do padrão', { ...p.manifesto, aberturas: { saude: { ...(p.manifesto.aberturas!.saude as object), indice: '../x.json' } } }],
    ['origem incompleta', { ...p.manifesto, aberturas: { saude: { ...(p.manifesto.aberturas!.saude as object), origem: { municipios: sha('a') } } } }],
  ];
  for (const [nome, m] of casos) {
    assert.equal(anuncioDoManifesto(m), null, nome);
    const { a, log, avisos } = abertura(p, {}, async () => m);
    for (const r of ['saude_meta', 'saude_entes', 'saude_colunas', 'saude_serie', 'saude_siops']) assert.equal(await a.executar(r, {}), USAR_MOTOR, `${nome}/${r}`);
    assert.equal(log.length, 0, nome);
    assert.ok(avisos.length > 0 && a.estado() === 'motor');
  }
});

test('índice: tamanho, hash, outro snapshot/gerado_em/base do IPCA e campos inválidos → motor, sem repetir a busca', async () => {
  const ok = montar();
  const ruins: [string, Pacote, Parameters<typeof servidor>[1]?][] = [
    ['tamanho', ok, { corpo: (c, b) => (c.includes('indice') ? new Uint8Array([...b, 32]) : b) }],
    ['hash', ok, { corpo: (c, b) => (c.includes('indice') ? new Uint8Array(b.map((x, i) => (i === 5 ? x ^ 1 : x))) : b) }],
    ['gerado_em do índice', montar({ mexer: (i) => { i.gerado_em = '2026-01-01T00:00:00+00:00'; } })],
    ['base do IPCA', montar({ mexer: (i) => { i.base_ipca = 2020; } })],
    ['alias', montar({ mexer: (i) => { i.aliases = { saude: {} }; } })],
    ['colunas da série', montar({ mexer: (i) => { i.serie = ['populacao']; } })],
    ['cadastro', montar({ mexer: (i) => { i.entes = [[1, 'x', 'GO', 'Z', false]]; } })],
    ['origem do índice', montar({ mexer: (i) => { i.origem = { ...(i.origem as object), ipca: sha('outro') }; } })],
    ['tamanhos', montar({ mexer: (i) => { (i.tamanhos as number[])[0] += 1; } })],
    ['chave de grupo', montar({ mexer: (i) => { (i.grupos as string[])[1] = 'go'; } })],
  ];
  for (const [nome, p, mod] of ruins) {
    const { a, log, avisos } = abertura(p, mod ?? {});
    assert.equal(await a.executar('saude_serie', {}), USAR_MOTOR, nome);
    assert.equal(await a.executar('saude_serie', { uf: 'GO' }), USAR_MOTOR, nome);
    assert.equal(log.filter((x) => x.range === null).length, 1, `${nome}: índice inválido não é buscado de novo`);
    assert.ok(avisos.length === 2 && a.estado() === 'motor');
  }
});

test('falha de rede no índice tenta de novo na chamada seguinte; índice 404 também', async () => {
  const p = montar();
  let cai = true;
  const { a, log } = abertura(p, { rede: () => cai });
  assert.equal(await a.executar('saude_siops', {}), USAR_MOTOR);
  cai = false;
  assert.equal((await a.executar('saude_siops', {}) as unknown[]).length, 2);
  assert.equal(log.filter((x) => x.range === null).length, 2);
  const b = abertura(p, { status: { [(p.manifesto.aberturas!.saude as { indice: string }).indice]: 404 } });
  assert.equal(await b.a.executar('saude_colunas', {}), USAR_MOTOR);
});

test('trecho: resposta 200 ao Range, Content-Range errado, corpo truncado/adulterado/de outro grupo → motor', async () => {
  const p = montar();
  const arq = (p.manifesto.aberturas!.saude as { arquivo: string }).arquivo;
  const casos: [string, Parameters<typeof servidor>[1]][] = [
    ['200 em vez de 206', { semRange: true }],
    ['Content-Range inesperado', { contentRange: 'bytes 0-9/1' }],
    ['Content-Range ausente', { semContentRange: true }],
    ['Content-Range deslocado', { deslocar: 1 }],
    ['Content-Range com total errado', { total: 1 }],
    ['truncado', { cortar: 3 }],
    ['status 500', { status: { [arq]: 500 } }],
    ['conteúdo adulterado (JSON inválido)', { corpo: (c, b) => (c === arq ? new Uint8Array(b.map((x) => (x === 0x7b ? 0x7d : x))) : b) }],
    ['linha de outro snapshot', { corpo: (c, b) => (c === arq ? enc.encode(new TextDecoder().decode(b).replaceAll('abcdef012345', 'ffffffffffff')) : b) }],
  ];
  for (const [nome, mod] of casos) {
    const { a, avisos } = abertura(p, mod);
    assert.equal(await a.executar('saude_serie', { uf: 'GO' }), USAR_MOTOR, nome);
    assert.ok(avisos.length >= 1, nome);
  }
});

test('cache de trechos: série e SIOPS do mesmo grupo, ou chamadas concorrentes, dividem UM Range; o DF usa dois grupos', async () => {
  const { a, log } = abertura(montar());
  const [s1, s2, p1, p2] = await Promise.all([a.executar('saude_serie', { uf: 'GO' }), a.executar('saude_serie', { uf: 'GO' }), a.executar('saude_siops', { uf: 'GO' }), a.executar('saude_siops', { uf: 'GO' })]);
  assert.deepEqual(s1, s2);
  assert.equal((p1 as unknown[]).length, 1);
  assert.deepEqual(p1, p2);
  assert.equal(log.filter((x) => x.range).length, 1, 'um Range para as quatro chamadas');
  await a.executar('saude_serie', { uf: 'GO' });
  assert.equal(log.filter((x) => x.range).length, 1, 'chamada posterior também vem do cache');
  // DF: saúde em 5300108 e SIOPS em 53 são grupos (e Ranges) diferentes
  await Promise.all([a.executar('saude_serie', { ente: 53 }), a.executar('saude_siops', { ente: 53 }), a.executar('saude_serie', { ente: 53 })]);
  const ranges = log.filter((x) => x.range).map((x) => x.range);
  assert.equal(ranges.length, 3);
  assert.equal(new Set(ranges).size, 3);
});

test('cache de trechos: limite de grupos (os mais antigos saem) e sem reter o pacote inteiro', async () => {
  const { a, log } = abertura(montar(), {}, undefined, 2);
  for (const uf of ['GO', 'RO', 'SP']) await a.executar('saude_serie', { uf }); // RO e SP não existem: sem Range
  await a.executar('saude_serie', {}); // BR
  await a.executar('saude_serie', { uf: 'GO' }); // GO ainda cabe (limite 2: BR e GO)
  assert.equal(log.filter((x) => x.range).length, 2);
  await a.executar('saude_serie', { ente: 3305505 }); // sai o mais antigo (BR)
  await a.executar('saude_serie', { ente: 5208707 }); // sai GO
  await a.executar('saude_serie', { uf: 'GO' }); // baixa de novo
  assert.equal(log.filter((x) => x.range).length, 5);
});

test('cache de trechos: corpo inválido recua para o motor sem baixar o mesmo grupo de novo; falha de rede tenta de novo', async () => {
  const p = montar();
  const arq = (p.manifesto.aberturas!.saude as { arquivo: string }).arquivo;
  const ruim = abertura(p, { corpo: (c, b) => (c === arq ? new Uint8Array(b.map((x) => (x === 0x7b ? 0x7d : x))) : b) });
  const rs = await Promise.all([ruim.a.executar('saude_serie', { uf: 'GO' }), ruim.a.executar('saude_siops', { uf: 'GO' })]);
  assert.deepEqual(rs, [USAR_MOTOR, USAR_MOTOR]);
  assert.equal(await ruim.a.executar('saude_serie', { uf: 'GO' }), USAR_MOTOR);
  assert.equal(ruim.log.filter((x) => x.range).length, 1, 'formato inválido: um único download, sem repetir');
  // Content-Range ausente também é formato inválido (não repete)
  const sem = abertura(p, { semContentRange: true });
  assert.equal(await sem.a.executar('saude_serie', { uf: 'GO' }), USAR_MOTOR);
  assert.equal(await sem.a.executar('saude_siops', { uf: 'GO' }), USAR_MOTOR);
  assert.equal(sem.log.filter((x) => x.range).length, 1);
  // rede: a falha não fica no cache
  let cai = false;
  const rede = abertura(p, { rede: () => cai });
  assert.equal((await rede.a.executar('saude_serie', { uf: 'GO' }) as unknown[]).length, 2);
  cai = false;
  const r2 = abertura(p, { rede: () => cai });
  await r2.a.executar('saude_colunas', {}); // carrega o índice
  cai = true;
  assert.equal(await r2.a.executar('saude_serie', { uf: 'GO' }), USAR_MOTOR);
  cai = false;
  assert.equal((await r2.a.executar('saude_serie', { uf: 'GO' }) as unknown[]).length, 2);
});

test('forma do trecho: anos fora de ordem, tamanho da linha de valores, SIOPS e tipos inválidos são recusados', () => {
  const linha = (o: object) => enc.encode(JSON.stringify({ g: 'X1', s: 'abcdef012345', ...o }) + '\n');
  const ok = { a: [2013], m: [1], r: [[1, null, 3, 4]], p: [[2013, 1, null]] };
  const ler = (o: object) => { const b = linha(o); return lerLinhaGrupo(b, 'X1', b.byteLength, 'abcdef012345', 4); };
  assert.deepEqual(ler(ok).r, [[1, null, 3, 4]]);
  for (const [nome, ruim] of [
    ['anos repetidos', { ...ok, a: [2013, 2013], m: [1, 1], r: [[1, 1, 1, 1], [1, 1, 1, 1]] }],
    ['coluna a menos', { ...ok, r: [[1, 2, 3]] }],
    ['texto no valor', { ...ok, r: [[1, 'x', 3, 4]] }],
    ['m com outro tamanho', { ...ok, m: [] }],
    ['SIOPS com 2 campos', { ...ok, p: [[2013, 1]] }],
    ['SIOPS fora de ordem', { ...ok, p: [[2014, 1, 1], [2013, 1, 1]] }],
    ['ano fracionário', { ...ok, a: [2013.5] }],
  ] as [string, object][]) assert.throws(() => ler(ruim), nome);
  const b = linha(ok);
  assert.throws(() => lerLinhaGrupo(b.slice(0, b.byteLength - 1), 'X1', b.byteLength - 1, 'abcdef012345', 4), /fim de linha/);
  assert.throws(() => lerLinhaGrupo(b, 'Y2', b.byteLength, 'abcdef012345', 4), /grupo ou snapshot/);
});

// ---------------------------------------------------------------- pacote real (opcional)
const CANDIDATO = process.env.SAUDE_ABERTURA_CANDIDATO?.replaceAll('\\', '/');
test('pacote real: todos os grupos lidos por Range são idênticos a uma leitura independente por offsets', { skip: !CANDIDATO || !existsSync(`${CANDIDATO}/gold/manifesto.json`) }, async () => {
  const manifesto = JSON.parse(readFileSync(`${CANDIDATO}/gold/manifesto.json`, 'utf8')) as ManifestoBruto;
  const anuncio = anuncioDoManifesto(manifesto);
  assert.ok(anuncio, 'o manifesto candidato anuncia o pacote da saúde para o próprio gerado_em');
  const pasta = `${CANDIDATO}/gold/saude`;
  assert.deepEqual(readdirSync(pasta).filter((n) => n.startsWith('abertura')).length >= 2, true);
  const arquivos = new Map<string, Uint8Array>([[anuncio.indice, readFileSync(`${CANDIDATO}/${anuncio.indice}`)], [anuncio.arquivo, readFileSync(`${CANDIDATO}/${anuncio.arquivo}`)]]);
  const indice = JSON.parse(new TextDecoder().decode(arquivos.get(anuncio.indice)!));
  const dados = arquivos.get(anuncio.arquivo)!;
  assert.equal(dados.byteLength, anuncio.bytes);
  const p = { manifesto, indice: arquivos.get(anuncio.indice)!, dados, arquivos, indiceObj: indice } as Pacote;
  const { a, log, avisos } = abertura(p);
  let off = 0;
  let n = 0;
  for (const [k, g] of (indice.grupos as string[]).entries()) {
    const bruto = JSON.parse(new TextDecoder().decode(dados.slice(off, off + indice.tamanhos[k]))) as { g: string; a: number[]; m: number[]; r: (number | null)[][]; p: [number, number | null, number | null][] };
    off += indice.tamanhos[k];
    assert.equal(bruto.g, g);
    const q = g === 'BR' ? {} : /^[A-Z]{2}$/.test(g) ? { uf: g } : { ente: g === '5300108' ? 53 : Number(g) };
    if (bruto.a.length) {
      const serie = (await a.executar('saude_serie', q)) as Record<string, number | null>[];
      assert.equal(serie.length, bruto.a.length, g);
      serie.forEach((l, i) => {
        assert.equal(l.ano, bruto.a[i]);
        assert.equal(l.municipios, bruto.m[i]);
        indice.serie.forEach((c: string, j: number) => assert.equal(l[c], bruto.r[i][j], `${g}/${bruto.a[i]}/${c}`));
      });
      n += serie.length;
    }
    if (bruto.p.length || /^[A-Z]{2}$/.test(g)) {
      const q2 = g === 'BR' ? {} : /^[A-Z]{2}$/.test(g) ? { uf: g } : { ente: Number(g) };
      const s = (await a.executar('saude_siops', q2)) as Record<string, number | null>[];
      assert.deepEqual(s.map((r) => [r.ano, r.saude_hab, r.saude_proprios_hab]), bruto.p, `SIOPS ${g}`);
    }
  }
  assert.equal(off, dados.byteLength);
  assert.equal(avisos.length, 0, avisos.join('; '));
  assert.equal(a.estado(), 'rapido');
  assert.ok(log.filter((x) => x.range).every((x) => /^bytes=\d+-\d+$/.test(x.range!)));
  const entes = (await a.executar('saude_entes', {})) as { cod_ibge: number }[];
  assert.equal(entes.length, indice.entes.length);
  assert.equal((await a.executar('saude_colunas', {}) as unknown[]).length, indice.colunas.length);
  assert.ok(n > 100000, `linhas de série conferidas: ${n}`);
});
