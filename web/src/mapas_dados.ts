/** Um indicador/ano/UF por Range. Nunca inicia SQL nem baixa microdados. */
import { BASE_DADOS } from './manifesto';
import { UF_NOMES } from './ufs';

export type AreaMapa = 'saude' | 'educacao' | 'trabalho' | 'saneamento' | 'agropecuaria' | 'mobilidade' | 'seguranca';
export type ObjetoMapa = { caminho: string; bytes: number; sha256: string };
type Trecho = [number, number, string];
export type IndicadorMapa = {
  id: string; nome: string; nome_en: string; descricao: string; descricao_en: string; tema: string; tema_en: string;
  unidade: string; unidade_en: string; formato: 'numero' | 'percentual' | 'fracao' | 'indice' | 'pontos' | 'moeda';
  anos: number[]; anos_com_valor: number[]; escala: number[]; indice: ObjetoMapa; minimo: number;
  fonte_nome: string; fonte_nome_en: string; fontes: { nome: string; url: string }[];
  territorio: string; territorio_en: string; alerta?: string; alerta_en?: string;
  numerador_nome?: string; numerador_nome_en?: string; denominador_nome?: string; denominador_nome_en?: string;
  marcador?: Record<string, string> | null; avaliacao?: boolean; edicoes?: number[];
  com_sinal?: boolean; notas_anos?: Record<string, [string, string]>;
};
export type CatalogoMapa = { versao: 1; area: AreaMapa; rede: string; gerado_em: string; cadastro: ObjetoMapa; indicadores: IndicadorMapa[]; redes?: Record<string, ObjetoMapa>; origem: { tipo: AreaMapa; caminho: string; sha256: string; indice_sha256?: string; gerado_em: string } };
export type MunicipioMapaDados = [number, string, string];
export type LinhaMapaDados = { cod: number; nome: string; uf: string; valor: number | null; numerador: number | null; denominador: number | null; condicao: number; marcador: number | null; condicao_original?: number | null; rem_validas?: number | null };
type Carga = { versao: number; area: AreaMapa; rede: string; indicador: string; ano: number; uf: string; cadastro: string; quantidade: number; valores: (number | null)[] | null; numeradores?: (number | null)[]; denominadores?: (number | null)[]; condicoes?: number[]; marcadores?: (number | null)[]; condicoes_originais?: number[]; rem_validas?: (number | null)[] };
type Indice = { versao: number; area: AreaMapa; rede: string; indicador: string; cadastro: string; arquivo: ObjetoMapa; recortes: Record<string, Trecho> };
const cache = new Map<string, Promise<unknown>>();
function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) { p = fn(); cache.set(key, p); p.catch(() => { if (cache.get(key) === p) cache.delete(key); }); }
  return p;
}
const hashValido = (s: string) => /^[a-f0-9]{64}$/.test(s);
const hash = async (b: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), x => x.toString(16).padStart(2, '0')).join('');
function objeto(o: ObjetoMapa) {
  if (!o || !/^gold\/mapas\/[a-z0-9_]+\.(json|ndjson)$/.test(o.caminho) || !hashValido(o.sha256) || !Number.isSafeInteger(o.bytes) || o.bytes < 1) throw new Error('Referência do mapa inválida.');
}
async function ler<T>(o: ObjetoMapa): Promise<T> {
  objeto(o);
  const r = await fetch(`${BASE_DADOS}${o.caminho}`);
  if (!r.ok) throw new Error('Arquivo do mapa indisponível.');
  const b = await r.arrayBuffer();
  if (b.byteLength !== o.bytes || await hash(b) !== o.sha256) throw new Error('Arquivo do mapa incompleto.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as T;
}
function validarCatalogo(m: CatalogoMapa, area: AreaMapa, rede: string) {
  if (m.versao !== 1 || m.area !== area || m.rede !== rede || !Array.isArray(m.indicadores) || !m.origem || !hashValido(m.origem.sha256)) throw new Error('Catálogo do mapa de outro painel ou rede.');
  objeto(m.cadastro);
  const ids = new Set<string>();
  for (const i of m.indicadores) {
    if (!/^[a-z][a-z0-9_]*$/.test(i.id) || ids.has(i.id) || !i.nome || !Array.isArray(i.anos) || i.anos.some(a => !Number.isInteger(a) || a < 1900 || a > 2200) || !Array.isArray(i.escala) || i.escala.length !== 4 || i.escala.some((v, k) => !Number.isFinite(v) || v <= 0 || (k > 0 && v <= i.escala[k - 1]))) throw new Error('Definição de indicador inválida.');
    ids.add(i.id); objeto(i.indice);
  }
}
async function verificarOrigem(m: CatalogoMapa) {
  await memo(`origem:${m.area}:${m.origem.sha256}`, async () => {
    if (m.area === 'trabalho') {
      const canonico = (x: unknown): unknown => Array.isArray(x) ? x.map(canonico) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonico((x as Record<string, unknown>)[k])])) : x;
      const [ab, gb] = await Promise.all(['gold/abertura/manifesto.json', 'gold/manifesto.json'].map(async k => { const r = await fetch(`${BASE_DADOS}${k}`, { cache: 'no-cache' }); if (!r.ok) throw new Error('Não foi possível conferir a edição de trabalho.'); return r.json(); }));
      const compat = { gerado_em: gb.gerado_em, fontes: Object.fromEntries(['rais', 'caged', 'rais_perfis'].map(k => [k, gb.fontes?.[k] ?? null])), base_ipca: gb.base_ipca, ipca: gb.fontes?.ipca ?? null };
      if (!ab.trabalho || await hash(new TextEncoder().encode(JSON.stringify(canonico(ab.trabalho))).buffer) !== m.origem.sha256 || JSON.stringify(canonico(ab.trabalho.compatibilidade)) !== JSON.stringify(canonico(compat))) throw new Error('Os dados de trabalho foram atualizados. O mapa precisa ser preparado para a nova edição.');
      return true;
    }
    const caminho = m.area === 'saude' ? 'gold/manifesto.json' : `gold/${m.area}/manifesto.json`;
    const r = await fetch(`${BASE_DADOS}${caminho}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Não foi possível conferir a edição dos dados.');
    const b = await r.arrayBuffer();
    if (m.area === 'educacao' || m.area === 'saneamento' || (m.area === 'agropecuaria' || m.area === 'mobilidade' || m.area === 'seguranca')) {
      if (await hash(b) !== m.origem.sha256) throw new Error('Os dados foram atualizados. O mapa precisa ser preparado para a nova edição.');
    } else {
      const a = JSON.parse(new TextDecoder().decode(b)).aberturas?.saude;
      if (!a || a.sha256 !== m.origem.sha256 || a.indice_sha256 !== m.origem.indice_sha256) throw new Error('Os dados de saúde foram atualizados. O mapa precisa ser preparado para a nova edição.');
    }
    return true;
  });
}
export function obterCatalogoMapa(area: AreaMapa, rede = 'todas'): Promise<CatalogoMapa> {
  return memo(`catalogo:${area}:${rede}`, async () => {
    if (!['saude', 'educacao', 'trabalho', 'saneamento', 'agropecuaria', 'mobilidade', 'seguranca'].includes(area)) throw new Error('Painel do mapa inválido.');
    if (rede !== 'todas') {
      const base = await obterCatalogoMapa(area); const ref = base.redes?.[rede];
      if (!ref) throw new Error('Rede de ensino indisponível para o mapa.');
      const m = await ler<CatalogoMapa>(ref); validarCatalogo(m, area, rede);
      if (m.cadastro.sha256 !== base.cadastro.sha256 || m.origem.sha256 !== base.origem.sha256) throw new Error('Edições de dados incompatíveis.');
      return { ...m, redes: base.redes };
    }
    const r = await fetch(`${BASE_DADOS}gold/mapas/${area}_manifesto.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Catálogo do mapa indisponível.');
    const m = await r.json() as CatalogoMapa; validarCatalogo(m, area, rede);
    await verificarOrigem(m); return m;
  });
}
export function obterMunicipiosMapa(m: CatalogoMapa): Promise<MunicipioMapaDados[]> {
  return memo(`cadastro:${m.cadastro.sha256}`, async () => {
    const c = await ler<{ versao: number; municipios: MunicipioMapaDados[] }>(m.cadastro); const codigos = new Set<number>();
    if (c.versao !== 1 || !Array.isArray(c.municipios) || !c.municipios.length) throw new Error('Cadastro do mapa inválido.');
    for (const [cod, nome, uf] of c.municipios) {
      if (!Number.isInteger(cod) || !/^\d{7}$/.test(String(cod)) || !nome || !Object.hasOwn(UF_NOMES, uf) || codigos.has(cod)) throw new Error('Município inválido no cadastro do mapa.');
      codigos.add(cod);
    }
    return c.municipios;
  });
}
export function validarCargaMapa(c: Carga, m: CatalogoMapa, i: IndicadorMapa, ano: number, uf: string, municipios: MunicipioMapaDados[]): LinhaMapaDados[] {
  const finito = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v));
  const valorValido = (v: unknown) => finito(v) && (v === null || (v as number) >= 0 || (m.area === 'trabalho' && i.com_sinal === true));
  const n = municipios.length;
  if (c.versao !== 1 || c.area !== m.area || c.rede !== m.rede || c.indicador !== i.id || c.ano !== ano || c.uf !== uf || c.cadastro !== m.cadastro.sha256 || c.quantidade !== n || (c.valores !== null && (!Array.isArray(c.valores) || c.valores.length !== n || c.valores.some(v => !valorValido(v))))) throw new Error('Trecho do mapa pertence a outro recorte ou edição.');
  for (const v of [c.numeradores, c.denominadores, c.marcadores]) if (v && (v.length !== n || v.some(x => !finito(x)))) throw new Error('Campos incompletos no mapa.');
  if ((m.area === 'saude' || m.area === 'educacao') && [c.numeradores, c.denominadores, c.marcadores].some(a => a?.some(x => x !== null && x < 0))) throw new Error('Componente negativo inesperado no mapa.');
  if (m.area === 'saude' && (!c.numeradores || !c.denominadores || !c.condicoes || c.condicoes.length !== n || c.condicoes.some(x => ![0, 1, 2, 3, 4, 6].includes(x)))) throw new Error('Condições de saúde incompletas no mapa.');
  if (m.area === 'trabalho' || m.area === 'saneamento' || (m.area === 'agropecuaria' || m.area === 'mobilidade' || m.area === 'seguranca')) {
    const permitidas = m.area === 'seguranca' ? [0,1,2,3,4,5,23,24] : m.area === 'mobilidade' ? [0,1,2,3,4,5] : m.area === 'agropecuaria' ? [0,1,2,3,4,5,20] : m.area === 'trabalho' ? [0, 1, 2, 3, 4, 5, 11, 12, 13, 14, 15] : [0, 1, 2, 3, 4, 5, 9, 10];
    if (!c.numeradores || !c.denominadores || !c.condicoes || c.condicoes.length !== n || c.condicoes.some(x => !permitidas.includes(x))) throw new Error('Condições do indicador incompletas no mapa.');
    if (m.area === 'saneamento' && (!c.condicoes_originais || c.condicoes_originais.length !== n || c.condicoes_originais.some(x => !Number.isInteger(x) || x < 0 || x > 6))) throw new Error('Condições originais do saneamento incompletas.');
    if (c.rem_validas && (c.rem_validas.length !== n || c.rem_validas.some(x => x !== null && (!Number.isInteger(x) || x < 0)))) throw new Error('Quantidades de remuneração inválidas.');
  }
  return municipios.map(([cod, nome, u], k) => {
    const valor = c.valores?.[k] ?? null; const marcador = c.marcadores?.[k] ?? null;
    const condicao = c.condicoes?.[k] ?? (valor === null ? 2 : marcador === 1 || marcador === 2 ? 8 : valor === 0 ? 1 : 0);
    if (m.area === 'seguranca' && [23,24].includes(condicao) && valor !== null) throw new Error('Série sem cobertura confirmada não define taxa.');
    if (m.area !== 'educacao' && ((valor === null && [0, 1, 6, 11, 12].includes(condicao)) || (valor !== null && [2, 3, 4, 5, 9, 10, 13, 14, 15, 20].includes(condicao)) || (condicao === 1 && valor !== 0))) throw new Error('Valor e condição do mapa divergem.');
    if (c.rem_validas?.[k] != null && (c.denominadores?.[k] == null || c.rem_validas[k]! > c.denominadores[k]!)) throw new Error('Remunerações válidas excedem os vínculos.');
    return { cod, nome, uf: u, valor, numerador: c.numeradores?.[k] ?? null, denominador: c.denominadores?.[k] ?? null, condicao, marcador, condicao_original: c.condicoes_originais?.[k] ?? null, rem_validas: c.rem_validas?.[k] ?? null };
  });
}
export function obterDadosMapa(m: CatalogoMapa, i: IndicadorMapa, ano: number, uf: string): Promise<LinhaMapaDados[]> {
  return memo(`dados:${m.area}:${m.rede}:${i.indice.sha256}:${ano}:${uf}`, async () => {
    if (uf !== 'BR' && !Object.hasOwn(UF_NOMES, uf)) throw new Error('Estado inválido para o mapa.');
    const [cadastro, idx] = await Promise.all([obterMunicipiosMapa(m), i.anos.includes(ano) ? memo(`indice:${i.indice.sha256}`, () => ler<Indice>(i.indice)) : Promise.resolve(null)]);
    const municipios = uf === 'BR' ? cadastro : cadastro.filter(x => x[2] === uf);
    if (!i.anos.includes(ano)) return municipios.map(([cod, nome, u]) => ({ cod, nome, uf: u, valor: null, numerador: null, denominador: null, condicao: i.avaliacao && !i.edicoes?.includes(ano) ? 7 : 5, marcador: null, condicao_original: m.area === 'saneamento' ? 5 : null, rem_validas: null }));
    if (!idx || idx.versao !== 1 || idx.area !== m.area || idx.rede !== m.rede || idx.indicador !== i.id || idx.cadastro !== m.cadastro.sha256) throw new Error('Índice de outro indicador ou edição.');
    objeto(idx.arquivo); const tr = idx.recortes[`${ano}:${uf}`];
    if (!tr || tr.length !== 3 || !Number.isSafeInteger(tr[0]) || tr[0] < 0 || !Number.isSafeInteger(tr[1]) || tr[1] < 1 || tr[0] + tr[1] > idx.arquivo.bytes || !hashValido(tr[2])) throw new Error('Recorte ausente ou inválido no mapa.');
    const [inicio, bytes, sha] = tr;
    const r = await fetch(`${BASE_DADOS}${idx.arquivo.caminho}`, { headers: { Range: `bytes=${inicio}-${inicio + bytes - 1}` } });
    if (r.status !== 206 || r.headers.get('Content-Range') !== `bytes ${inicio}-${inicio + bytes - 1}/${idx.arquivo.bytes}`) { await r.body?.cancel(); throw new Error('Não foi possível carregar somente o recorte do mapa.'); }
    const b = await r.arrayBuffer();
    if (b.byteLength !== bytes || await hash(b) !== sha) throw new Error('Recorte do mapa incompleto.');
    const texto = new TextDecoder('utf-8', { fatal: true }).decode(b);
    if (!texto.endsWith('\n')) throw new Error('Recorte do mapa truncado.');
    const cargas = texto.trimEnd().split('\n').map(l => JSON.parse(l) as Carga);
    const esperadas = uf === 'BR' ? Object.keys(UF_NOMES).sort() : [uf];
    if (cargas.length !== esperadas.length || cargas.some((c, k) => c.uf !== esperadas[k])) throw new Error('Estados ausentes ou duplicados no mapa.');
    return cargas.flatMap(c => validarCargaMapa(c, m, i, ano, c.uf, municipios.filter(x => x[2] === c.uf)));
  });
}
