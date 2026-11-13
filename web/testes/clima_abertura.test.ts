/**
 * Abertura rápida do clima (src/clima_abertura.ts + a ligação em api.ts/dados.ts): pacote sintético no formato de pipeline/clima_abertura.py,
 * offsets em bytes UTF-8, Range, nulos e zeros, município sem cobertura, corrupção/versão, fallback para o motor e ausência do motor na abertura.
 * Com CLIMA_ABERTURA_CANDIDATO (pasta com gold/), confere também TODOS os grupos do pacote real contra uma leitura independente.
 * Executar:  npx vite build --ssr testes/clima_abertura.test.ts --outDir testes/.saida/abertura --emptyOutDir --logLevel warn && node --test testes/.saida/abertura/clima_abertura.test.js
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { anuncioDoManifesto, criarAbertura, lerLinhaGrupo, USAR_MOTOR, type Dependencias } from '../src/clima_abertura';
import type { ManifestoBruto } from '../src/manifesto';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const enc = new TextEncoder();
const COLUNAS = ['variavel', 'ano_de', 'ano_ate', 'anos_lacuna', 'ate', 'valor', 'anomalia_pct', 'acum3_cob', 'acum3_valor'];
const VARS = ['chuva_mm', 'temperatura_c'];

type Pacote = { manifesto: ManifestoBruto; indice: Uint8Array; dados: Uint8Array; arquivos: Map<string, Uint8Array> };

/** Monta um pacote como o gerador: BR, uma UF, três municípios (um com zero real, um com acento multibyte). */
function montar(opcoes: { snapshot?: string; ate?: number } = {}): Pacote {
  const snapshot = opcoes.snapshot ?? 'abcdef012345';
  const ate = opcoes.ate ?? 202609;
  const grupos: [string, (string | number | null)[][]][] = [
    ['BR', [['chuva_mm', 1981, 2025, null, ate, 1500.25, 0.0123456789, 3, 300.5], ['temperatura_c', 1979, 2025, null, ate, 25.5, null, null, null]]],
    ['GO', [['chuva_mm', 1981, 2025, null, ate, 1400, -0.05, 3, 200], ['temperatura_c', 1979, 2025, null, ate, 24, null, null, null]]],
    ['5208707', [['chuva_mm', 1981, 2025, null, ate, 0, 0, 3, 0], ['temperatura_c', 1979, 2025, '2022,2023', ate, 26, null, null, null]]],
    ['3305505', [['chuva_mm', 1981, 2025, null, ate, 1000, 0.1, 3, 100], ['ação_ç', 1981, 2025, 'ãé', ate, 1, 2, 3, 4]]],
    ['2605459', [['chuva_mm', 1981, 2025, null, ate, 900, null, null, null]]],
  ];
  const linhas = grupos.map(([g, r]) => enc.encode(JSON.stringify({ g, s: snapshot, r }) + '\n'));
  const dados = new Uint8Array(linhas.reduce((n, l) => n + l.byteLength, 0));
  linhas.reduce((o, l) => (dados.set(l, o), o + l.byteLength), 0);
  const indice = enc.encode(JSON.stringify({
    versao: 1, snapshot, arquivo: `abertura_${snapshot}.ndjson`, sha256: sha(dados), bytes: dados.byteLength, ate, colunas: COLUNAS,
    catalogo: VARS.map((variavel) => ({ variavel })), territorios: [[5208707, 'Goiânia', 'GO'], [3305505, 'Saquarema', 'RJ'], [9999999, 'Sem cobertura', 'PE']],
    grupos: grupos.map(([g]) => g), tamanhos: linhas.map((l) => l.byteLength),
  }));
  const ih = sha(indice);
  const painelSha = 'f'.repeat(64);
  const manifesto: ManifestoBruto = {
    gerado_em: '2026-11-13T21:00:00+00:00', anos: [2020], base_ipca: 2025, colunas: {},
    fontes: { siconfi: { x: 1 }, clima: { anos: [1979, 2026], ate, normal: [1991, 2020], processado_em: '2026-11-05', painel: { sha256: painelSha, ate, arquivo: 'gold/clima/painel.parquet', versao: 1 },
      abertura: { versao: 1, indice: `gold/clima/abertura_indice_${ih.slice(0, 12)}.json`, indice_sha256: ih, indice_bytes: indice.byteLength, arquivo: `gold/clima/abertura_${snapshot}.ndjson`,
        sha256: sha(dados), bytes: dados.byteLength, snapshot, grupos: grupos.length, ate, painel_sha256: painelSha } } },
  };
  const a = manifesto.fontes!.clima.abertura as { indice: string; arquivo: string };
  return { manifesto, indice, dados, arquivos: new Map([[a.indice, indice], [a.arquivo, dados]]) };
}

type Registro = { url: string; range: string | null };
/** "Servidor": responde a cada caminho (o sufixo depois de /v/<versão>/) com o arquivo, honrando Range com 206 e Content-Range. */
function servidor(p: Pacote, mod: { semRange?: boolean; contentRange?: string; cortar?: number; status?: Record<string, number>; corpo?: (c: string, b: Uint8Array) => Uint8Array } = {}) {
  const log: Registro[] = [];
  const buscar: Dependencias['buscar'] = async (url, init) => {
    const caminho = url.replace(/^(?:.*\/)?v\/\d+\//, '');
    const range = new Headers(init?.headers).get('Range');
    log.push({ url, range });
    if (mod.status?.[caminho]) return new Response('x', { status: mod.status[caminho] });
    let b = p.arquivos.get(caminho);
    if (!b) return new Response('não encontrado', { status: 404 });
    if (mod.corpo) b = mod.corpo(caminho, b);
    const m = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
    if (!m || mod.semRange) return new Response(b as BodyInit, { status: 200 });
    const [i, f] = [Number(m[1]), Number(m[2])];
    let parte = b.slice(i, f + 1);
    if (mod.cortar) parte = parte.slice(0, parte.byteLength - mod.cortar);
    return new Response(parte as BodyInit, { status: 206, headers: { 'Content-Range': mod.contentRange ?? `bytes ${i}-${f}/${b.byteLength}` } });
  };
  return { buscar, log };
}

function abertura(p: Pacote, mod: Parameters<typeof servidor>[1] = {}) {
  const s = servidor(p, mod);
  const avisos: string[] = [];
  const a = criarAbertura({ manifesto: async () => p.manifesto, url: (c, m) => `https://site.test/dados/v/${m.gerado_em.replace(/\D/g, '')}1/${c}`, buscar: s.buscar, avisar: (m) => void avisos.push(m) });
  return { a, ...s, avisos };
}

type Resumo = { origem: string; linhas: Record<string, unknown>[] };

test('um Range por grupo, com offsets em bytes UTF-8, e os valores do pacote sem alteração (zero é zero, ausência é null)', async () => {
  const p = montar();
  const { a, log } = abertura(p);
  const mun = (await a.executar('clima_painel', { cod: 3305505 })) as Resumo; // contém "ação_ç": offset de bytes ≠ offset de caracteres
  assert.equal(mun.origem, 'abertura');
  assert.deepEqual(mun.linhas.map((l) => l.variavel), ['ação_ç', 'chuva_mm']);
  assert.equal(mun.linhas[0].anos_lacuna, 'ãé');
  assert.ok(new TextDecoder().decode(p.dados).length < p.dados.byteLength, 'o pacote de teste precisa ter multibyte');
  const zero = ((await a.executar('clima_painel', { cod: 5208707 })) as Resumo).linhas;
  assert.equal(zero[0].valor, 0);
  assert.equal(zero[0].acum3_valor, 0); // zero real preservado
  assert.equal(zero[1].anos_lacuna, '2022,2023');
  assert.equal(zero[1].acum3_valor, null);
  assert.equal(zero[1].anomalia_pct, null); // ausência nunca vira zero
  const br = (await a.executar('clima_painel', {})) as Resumo;
  assert.equal(br.linhas[0].valor, 1500.25);
  assert.equal(br.linhas[0].anomalia_pct, 0.0123456789);
  assert.equal(br.linhas[0].grupo, 'BR');
  // índice uma vez, um Range exato por grupo pedido (nunca o arquivo inteiro)
  assert.equal(log.filter((r) => r.range === null).length, 1);
  const idx = JSON.parse(new TextDecoder().decode(p.indice)) as { grupos: string[]; tamanhos: number[] };
  const intervalo = (g: string) => { const k = idx.grupos.indexOf(g); const ini = idx.tamanhos.slice(0, k).reduce((s, n) => s + n, 0); return `bytes=${ini}-${ini + idx.tamanhos[k] - 1}`; };
  assert.deepEqual(log.filter((r) => r.range).map((r) => r.range), [intervalo('3305505'), intervalo('5208707'), intervalo('BR')]);
});

test('recorte: município vale mais que a UF; UF inválida ou vazia é o Brasil; UF válida usa o grupo da UF', async () => {
  const { a } = abertura(montar());
  const g = async (q: Record<string, string | number>) => ((await a.executar('clima_painel', q)) as Resumo).linhas[0].grupo;
  assert.equal(await g({ uf: 'GO' }), 'GO');
  assert.equal(await g({ uf: 'XX' }), 'BR');
  assert.equal(await g({ uf: '' }), 'BR');
  assert.equal(await g({ uf: 'GO', cod: 5208707 }), '5208707');
});

test('município sem cobertura: resumo vazio pelo caminho rápido (a página mostra "sem dados"), sem zeros e sem trocar o recorte', async () => {
  const { a, log } = abertura(montar());
  const r = (await a.executar('clima_painel', { cod: 9999999 })) as Resumo;
  assert.deepEqual(r, { origem: 'abertura', linhas: [] });
  assert.equal(log.filter((x) => x.range).length, 0);
  const terr = (await a.executar('clima_territorios', {})) as { cod: number; nome: string; uf: string }[];
  assert.deepEqual(terr[2], { cod: 9999999, nome: 'Sem cobertura', uf: 'PE' }); // continua na busca
  assert.equal(terr.length, 3);
});

test('clima_meta vem só do manifesto: anos, último mês, normal e versão', async () => {
  const p = montar();
  const { a, log } = abertura(p);
  assert.deepEqual(await a.executar('clima_meta', {}), { anos: [1979, 2026], ate: 202609, normal: [1991, 2020], processado_em: '2026-11-05', gerado_em: p.manifesto.gerado_em, abertura: true });
  assert.equal(log.length, 0);
  // sem fonte de clima no manifesto: lista vazia (a página diz "não publicado" só depois de carregar)
  const vazio = criarAbertura({ manifesto: async () => ({ ...p.manifesto, fontes: {} }), url: () => '', buscar: async () => new Response('', { status: 500 }) });
  assert.deepEqual(await vazio.executar('clima_meta', {}), { anos: [], ate: null, normal: null, processado_em: null, gerado_em: p.manifesto.gerado_em, abertura: false });
});

test('rotas de histórico e outras não passam pelo caminho rápido', async () => {
  const { a, log } = abertura(montar());
  for (const rota of ['clima_anual', 'clima_mensal', 'clima_ranking', 'meta', 'entes', 'clima_catalogo']) assert.equal(await a.executar(rota, {}), USAR_MOTOR);
  assert.equal(log.length, 0);
});

test('sem o pacote no manifesto, ou com o anúncio inconsistente: fallback para o motor, avisado', async () => {
  const p = montar();
  const sem = structuredClone(p.manifesto);
  delete (sem.fontes!.clima as Record<string, unknown>).abertura;
  const ab = (m: ManifestoBruto) => criarAbertura({ manifesto: async () => m, url: (c) => c, buscar: servidor(p).buscar, avisar: () => {} });
  assert.equal(await ab(sem).executar('clima_painel', {}), USAR_MOTOR);
  assert.equal(await ab(sem).executar('clima_territorios', {}), USAR_MOTOR);
  const muda = (f: (x: Record<string, unknown>, c: Record<string, unknown>) => void) => {
    const m = structuredClone(p.manifesto);
    const c = m.fontes!.clima as Record<string, unknown>;
    f(c.abertura as Record<string, unknown>, c);
    return anuncioDoManifesto(m);
  };
  assert.notEqual(muda(() => {}), null);
  assert.equal(muda((x) => (x.versao = 2)), null);
  assert.equal(muda((x) => (x.indice = '../segredo.json')), null);
  assert.equal(muda((x) => (x.arquivo = 'gold/clima/abertura_zzzzzzzzzzzz.ndjson')), null);
  assert.equal(muda((x) => (x.snapshot = '000000000000')), null);
  assert.equal(muda((x) => (x.ate = 202608)), null); // outro último mês
  assert.equal(muda((_, c) => ((c.painel as Record<string, unknown>).sha256 = '0'.repeat(64))), null); // outro painel.parquet
  assert.equal(muda((x) => (x.bytes = 0)), null);
});

test('arquivos ausentes, índice corrompido ou de outro snapshot: fallback honesto, e o índice inválido não vira laço', async () => {
  const p = montar();
  const caminhoIdx = (p.manifesto.fontes!.clima.abertura as { indice: string }).indice;
  const casos: [string, Parameters<typeof servidor>[1]][] = [
    ['índice 404', { status: { [caminhoIdx]: 404 } }],
    ['índice truncado', { corpo: (c, b) => (c === caminhoIdx ? b.slice(0, b.byteLength - 5) : b) }],
    ['índice com um byte trocado (hash)', { corpo: (c, b) => { if (c !== caminhoIdx) return b; const x = b.slice(); x[x.byteLength - 3] ^= 1; return x; } }],
  ];
  for (const [nome, mod] of casos) {
    const { a, log, avisos } = abertura(p, mod);
    assert.equal(await a.executar('clima_painel', {}), USAR_MOTOR, nome);
    assert.equal(avisos.length, 1, nome);
    assert.equal(a.estado(), 'motor');
    const n = log.length;
    assert.equal(await a.executar('clima_territorios', {}), USAR_MOTOR);
    if (nome !== 'índice 404') assert.equal(log.length, n, `${nome}: formato inválido não pode repetir a requisição`);
  }
  // índice válido em si, mas de outro snapshot/último mês que o manifesto: recusado
  for (const outro of [montar({ snapshot: '111111111111' }), montar({ ate: 202608 })]) {
    const m = structuredClone(p.manifesto);
    const a0 = m.fontes!.clima.abertura as Record<string, unknown>;
    const nova = outro.manifesto.fontes!.clima.abertura as Record<string, unknown>;
    const trocar = new Map<string, Uint8Array>([[a0.indice as string, outro.indice], [a0.arquivo as string, outro.dados]]);
    const s = servidor({ ...p, arquivos: trocar });
    const avisos: string[] = [];
    const a = criarAbertura({ manifesto: async () => m, url: (c) => c, buscar: s.buscar, avisar: (x) => void avisos.push(x) });
    assert.equal(await a.executar('clima_painel', {}), USAR_MOTOR);
    assert.ok(avisos.length === 1 && nova);
  }
});

test('erro de rede no índice não é permanente: a chamada seguinte tenta de novo', async () => {
  const p = montar();
  let falhar = true;
  const s = servidor(p);
  const a = criarAbertura({ manifesto: async () => p.manifesto, url: (c) => c, avisar: () => {},
    buscar: async (u, i) => { if (falhar) throw new TypeError('rede'); return s.buscar(u, i); } });
  assert.equal(await a.executar('clima_painel', {}), USAR_MOTOR);
  falhar = false;
  assert.equal(((await a.executar('clima_painel', {})) as Resumo).origem, 'abertura');
});

test('respostas inválidas ao Range: 200 (servidor ignorou o intervalo), Content-Range trocado, corpo curto e linha de outro grupo/snapshot', async () => {
  const p = montar();
  const idx = JSON.parse(new TextDecoder().decode(p.indice)) as { grupos: string[]; tamanhos: number[] };
  const arq = (p.manifesto.fontes!.clima.abertura as { arquivo: string }).arquivo;
  const trocar = (de: string, para: string) => ({ corpo: (c: string, b: Uint8Array) => (c === arq ? enc.encode(new TextDecoder().decode(b).replace(de, para)) : b) });
  const casos: [string, Parameters<typeof servidor>[1]][] = [
    ['200 em vez de 206', { semRange: true }],
    ['Content-Range diferente', { contentRange: 'bytes 0-10/99' }],
    ['corpo curto', { cortar: 3 }],
    ['grupo trocado', trocar('"g":"BR"', '"g":"XX"')],
    ['snapshot misturado', trocar('"s":"abcdef012345"', '"s":"999999999999"')],
    ['JSON inválido', trocar('"r":[[', '"r":[[[')],
  ];
  for (const [nome, mod] of casos) {
    const { a, avisos } = abertura(p, mod);
    const r = await a.executar('clima_painel', {});
    // as duas primeiras trocas mudam o tamanho do grupo BR: o corpo deixa de ter o tamanho do índice
    assert.equal(r, USAR_MOTOR, nome);
    assert.equal(avisos.length, 1, nome);
  }
  assert.equal(idx.grupos[0], 'BR');
  // lerLinhaGrupo isolado: sem fim de linha, UTF-8 inválido, valor de tipo errado, variável repetida
  const ok = enc.encode('{"g":"X1","s":"a","r":[["v",1]]}\n');
  assert.equal(lerLinhaGrupo(ok, 'X1', ok.byteLength, 'a', ['variavel', 'valor'])[0].valor, 1);
  const f = (s: string | Uint8Array, cols = ['variavel', 'valor']) => () => lerLinhaGrupo(typeof s === 'string' ? enc.encode(s) : s, 'X1', (typeof s === 'string' ? enc.encode(s) : s).byteLength, 'a', cols);
  assert.throws(f('{"g":"X1","s":"a","r":[["v",1]]}'), /fim de linha/);
  assert.throws(f(Uint8Array.from([0x7b, 0xff, 0xfe, 0x0a])));
  assert.throws(f('{"g":"X1","s":"a","r":[["v",{"x":1}]]}\n'), /valor inválido/);
  assert.throws(f('{"g":"X1","s":"a","r":[["v",1],["v",2]]}\n'), /repetida/);
  assert.throws(f('{"g":"X1","s":"a","r":[["v",1,2]]}\n'), /malformada/);
});

test('buscar(): clima_meta, território e resumo abrem sem iniciar o motor, com um único manifesto e sem requisição financeira; o histórico segue pelo motor', async () => {
  const p = montar();
  const s = servidor(p);
  const pedidos: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (u: RequestInfo | URL, init?: RequestInit) => {
    const url = String(u);
    pedidos.push(url);
    if (url.endsWith('gold/manifesto.json')) return new Response(JSON.stringify(p.manifesto), { status: 200 });
    return s.buscar(url, init);
  }) as typeof fetch;
  try {
    const { buscar } = await import('../src/api');
    const meta = await buscar<{ anos: number[]; abertura: boolean }>('clima_meta');
    const terr = await buscar<unknown[]>('clima_territorios');
    const r1 = await buscar<Resumo>('clima_painel', { uf: 'GO' });
    const r2 = await buscar<Resumo>('clima_painel', { uf: 'GO' }); // cache: nenhuma requisição nova
    assert.equal(r1, r2);
    assert.deepEqual(meta.anos, [1979, 2026]);
    assert.equal(meta.abertura, true);
    assert.equal(terr.length, 3);
    assert.equal(r1.linhas[0].grupo, 'GO');
    assert.equal(pedidos.filter((u) => u.endsWith('gold/manifesto.json')).length, 1, 'um snapshot do manifesto por sessão');
    assert.ok(pedidos.every((u) => /^gold\/manifesto\.json$|^v\/\d+\/gold\/clima\/abertura_/.test(u)), `só manifesto e pacote de abertura: ${pedidos.join(' | ')}`);
    assert.equal(pedidos.length, 1 + 1 + 1, 'manifesto + índice + um Range');
    // versão do URL: dígitos de gerado_em + revisão do transporte (1), como no motor
    assert.ok(pedidos[1].startsWith(`v/${p.manifesto.gerado_em.replace(/\D/g, '')}1/gold/clima/abertura_indice_`), pedidos[1]);
  } finally {
    globalThis.fetch = original;
  }
});

// ---- pacote real (candidato) ----
const CANDIDATO = process.env.CLIMA_ABERTURA_CANDIDATO?.replaceAll('\\', '/');
test('pacote real: todos os grupos lidos por offset coincidem com a leitura independente do arquivo inteiro', { skip: !CANDIDATO || !existsSync(`${CANDIDATO}/gold/manifesto.json`) }, async () => {
  const man = JSON.parse(readFileSync(`${CANDIDATO}/gold/manifesto.json`, 'utf8')) as ManifestoBruto;
  const anuncio = anuncioDoManifesto(man);
  assert.ok(anuncio, 'manifesto do candidato sem fontes.clima.abertura válido');
  const arquivos = new Map<string, Uint8Array>();
  for (const c of [anuncio.indice, anuncio.arquivo]) arquivos.set(c, readFileSync(`${CANDIDATO}/${c}`));
  assert.equal(sha(arquivos.get(anuncio.arquivo)!), anuncio.sha256);
  assert.equal(sha(arquivos.get(anuncio.indice)!), anuncio.indice_sha256);
  const s = servidor({ manifesto: man, indice: arquivos.get(anuncio.indice)!, dados: arquivos.get(anuncio.arquivo)!, arquivos });
  const a = criarAbertura({ manifesto: async () => man, url: (c) => c, buscar: s.buscar, avisar: (m) => assert.fail(m) });
  const indice = JSON.parse(readFileSync(`${CANDIDATO}/${anuncio.indice}`, 'utf8')) as { grupos: string[]; territorios: unknown[]; colunas: string[] };
  const linhasCruas = new TextDecoder().decode(arquivos.get(anuncio.arquivo)!).split('\n');
  assert.equal(linhasCruas.pop(), '');
  assert.equal(linhasCruas.length, indice.grupos.length);
  let total = 0;
  for (let k = 0; k < indice.grupos.length; k++) {
    const g = indice.grupos[k];
    const quer = /^\d{7}$/.test(g) ? { cod: Number(g) } : g === 'BR' ? {} : { uf: g };
    const r = (await a.executar('clima_painel', quer)) as Resumo;
    const cru = JSON.parse(linhasCruas[k]) as { g: string; r: unknown[][] };
    assert.equal(cru.g, g);
    assert.equal(r.linhas.length, cru.r.length);
    assert.equal(r.linhas.length, 6, `${g}: esperadas as seis variáveis`);
    for (const l of r.linhas) assert.deepEqual(indice.colunas.map((c) => l[c]), cru.r.find((x) => x[0] === l.variavel));
    total += r.linhas.length;
  }
  assert.equal(total, 33582);
  assert.equal(indice.territorios.length, 5570);
});
