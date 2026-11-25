import { buscarDados as fetch } from './buscar_dados';
import { BASE_DADOS } from './manifesto';

type Objeto = { caminho: string; bytes: number; sha256: string };
type Trecho = [number, number, string];
/** ano, PIB nominal, PBF anual completo, BPC anual completo, meses PBF, meses BPC. */
export type AnoEconomia = [number, number | null, number | null, number | null, number, number];
export type GrupoEconomia = { grupo: string; linhas: AnoEconomia[] };
export type MedidaRankingPib = 'pbf' | 'bpc' | 'total';
export type MetaEconomia = { versao: number; gerado_em: string; anos: number[]; pib_ate: number; arquivo: Objeto; grupos: Record<string, Trecho>; indices_uf: Record<string, Objeto>; rankings?: Partial<Record<MedidaRankingPib, Objeto>> };
/** Código IBGE, município, UF, posição, percentual do PIB, pagamentos, PIB. */
export type LinhaRankingPib = [number, string, string, number, number, number, number];
export type CoberturaRankingPib = { trecho: Trecho; total: number; validos: number; condicoes: number[] };
type IndiceRankingPib = { versao: number; medida: MedidaRankingPib; anos: number[]; anos_com_valor: number[]; arquivo: Objeto; recortes: Record<string, CoberturaRankingPib> };
export type RankingPib = { versao: number; medida: MedidaRankingPib; ano: number; uf: string; linhas: LinhaRankingPib[]; cobertura: CoberturaRankingPib; anos_com_valor: number[] };
const cache = new Map<string, Promise<unknown>>();
function memo<T>(chave: string, ler: () => Promise<T>): Promise<T> {
  let p = cache.get(chave) as Promise<T> | undefined;
  if (!p) { p = ler(); cache.set(chave, p); p.catch(() => { if (cache.get(chave) === p) cache.delete(chave); }); }
  return p;
}
const sha = async (b: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), x => x.toString(16).padStart(2, '0')).join('');
function objeto(o: Objeto) {
  if (!o || !/^gold\/assistencia\/economia_[a-z0-9_]+\.(json|ndjson)$/.test(o.caminho) || !Number.isSafeInteger(o.bytes) || o.bytes < 1 || !/^[a-f0-9]{64}$/.test(o.sha256)) throw new Error('Catálogo anual inválido.');
}
export async function lerJson<T>(o: Objeto): Promise<T> {
  objeto(o);
  const r = await fetch(`${BASE_DADOS}${o.caminho}`);
  if (!r.ok) throw new Error('Índice anual indisponível.');
  const b = await r.arrayBuffer();
  if (b.byteLength !== o.bytes || await sha(b) !== o.sha256) throw new Error('Índice anual incompleto.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as T;
}
export async function lerTrecho<T>(arquivo: Objeto, trecho: Trecho): Promise<T> {
  objeto(arquivo);
  const [inicio, tamanho, hash] = trecho;
  if (!Number.isSafeInteger(inicio) || inicio < 0 || !Number.isSafeInteger(tamanho) || tamanho < 1 || inicio + tamanho > arquivo.bytes || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Trecho anual inválido.');
  const r = await fetch(`${BASE_DADOS}${arquivo.caminho}`, { headers: { Range: `bytes=${inicio}-${inicio + tamanho - 1}` } });
  if (r.status !== 206 || r.headers.get('Content-Range') !== `bytes ${inicio}-${inicio + tamanho - 1}/${arquivo.bytes}`) { await r.body?.cancel(); throw new Error('Não foi possível carregar somente este recorte.'); }
  const b = await r.arrayBuffer();
  if (b.byteLength !== tamanho || await sha(b) !== hash) throw new Error('Dados anuais incompletos.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as T;
}
export function obterMetaEconomia(): Promise<MetaEconomia> {
  return memo('meta', async () => {
    const r = await fetch(`${BASE_DADOS}gold/assistencia/economia_manifesto.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('Comparação anual indisponível.');
    const m = await r.json() as MetaEconomia;
    if (m.versao !== 1 || !Array.isArray(m.anos) || !m.grupos || !m.indices_uf || !m.anos.includes(m.pib_ate)) throw new Error('Catálogo anual incompatível.');
    objeto(m.arquivo); return m;
  });
}
export function obterEconomia(grupo: string, uf: string | null): Promise<GrupoEconomia> {
  return memo(`grupo:${grupo}:${uf}`, async () => {
    const m = await obterMetaEconomia();
    let trecho = m.grupos[grupo];
    if (!trecho && /^\d{7}$/.test(grupo) && uf && m.indices_uf[uf]) {
      const indice = await memo(`indice:${uf}`, () => lerJson<{ grupos: Record<string, Trecho> }>(m.indices_uf[uf]));
      trecho = indice.grupos[grupo];
    }
    if (!trecho) throw new Error('Território ausente da comparação anual.');
    const g = await lerTrecho<GrupoEconomia>(m.arquivo, trecho);
    if (g.grupo !== grupo || !Array.isArray(g.linhas) || g.linhas.some(l => l.length !== 6 || !m.anos.includes(l[0]) || l.slice(1).some(v => v !== null && !Number.isFinite(v)) || !Number.isInteger(l[4]) || !Number.isInteger(l[5]) || l[4] < 0 || l[4] > 12 || l[5] < 0 || l[5] > 12)) throw new Error('Dados anuais de outro recorte ou formato.');
    return g;
  });
}
export function obterRankingPib(medida: MedidaRankingPib, ano: number, uf: string): Promise<RankingPib> {
  return memo(`ranking:${medida}:${ano}:${uf}`, async () => {
    const indice = await memo(`ranking-indice:${medida}`, async () => {
      const m = await obterMetaEconomia(); const ref = m.rankings?.[medida];
      if (!ref) throw new Error('Ranking anual ainda indisponível.');
      const i = await lerJson<IndiceRankingPib>(ref);
      if (i.versao !== 1 || i.medida !== medida || !Array.isArray(i.anos) || !Array.isArray(i.anos_com_valor) || !i.recortes) throw new Error('Índice do ranking incompatível.');
      objeto(i.arquivo); return i;
    });
    const c = indice.recortes[`${ano}:${uf}`];
    if (!c) throw new Error('Ano ou estado fora da cobertura do ranking.');
    if (!Number.isSafeInteger(c.total) || !Number.isSafeInteger(c.validos) || c.total < c.validos || c.validos < 0 || !Array.isArray(c.condicoes) || c.condicoes.length !== 6 || c.condicoes.some(n => !Number.isSafeInteger(n) || n < 0) || c.condicoes[0] !== c.validos || c.condicoes.reduce((a, b) => a + b, 0) !== c.total) throw new Error('Cobertura do ranking inválida.');
    const r = await lerTrecho<RankingPib>(indice.arquivo, c.trecho);
    if (r.versao !== 1 || r.medida !== medida || r.ano !== ano || r.uf !== uf || !Array.isArray(r.linhas) || r.linhas.length !== c.validos || new Set(r.linhas.map(l => l[0])).size !== r.linhas.length || r.linhas.some((l, n) => l.length !== 7 || !Number.isInteger(l[0]) || l[0] < 1000000 || l[0] > 9999999 || typeof l[1] !== 'string' || !/^[A-Z]{2}$/.test(l[2]) || (uf !== 'BR' && l[2] !== uf) || !Number.isSafeInteger(l[3]) || l[3] < 1 || l[3] > n + 1 || (n > 0 && l[3] < r.linhas[n - 1][3]) || l.slice(4).some(v => typeof v !== 'number' || !Number.isFinite(v) || v < 0) || l[6] <= 0 || Math.abs(l[4] - 100 * l[5] / l[6]) > 1e-9 || (n > 0 && l[4] > r.linhas[n - 1][4] + 1e-12))) throw new Error('Dados do ranking de outro recorte ou formato.');
    return { ...r, cobertura: c, anos_com_valor: indice.anos_com_valor };
  });
}
/** A busca preserva as posições calculadas no recorte completo. */
export function filtrarRankingPib(linhas: LinhaRankingPib[], texto: string): LinhaRankingPib[] {
  const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const tokens = normal(texto.trim()).split(/\s+/).filter(Boolean);
  return tokens.length ? linhas.filter(l => tokens.every(q => normal(`${l[0]} ${l[1]} ${l[2]}`).includes(q))) : linhas;
}
/** Percentual em pontos percentuais, não fração: 2 representa 2%. */
export function compararPib(l: AnoEconomia | undefined, tipo: 'pbf' | 'bpc' | 'total'): { valor: number | null; condicao: number; pago: number | null; meses: number } {
  if (!l) return { valor: null, condicao: 1, pago: null, meses: 0 };
  const meses = tipo === 'pbf' ? l[4] : tipo === 'bpc' ? l[5] : Math.min(l[4], l[5]);
  const pago = tipo === 'pbf' ? l[2] : tipo === 'bpc' ? l[3] : l[2] !== null && l[3] !== null ? l[2] + l[3] : null;
  const condicao = meses === 0 ? 1 : meses !== 12 || pago === null ? 2 : l[1] === null ? 3 : l[1] === 0 ? 4 : l[1] < 0 ? 5 : 0;
  return { valor: condicao === 0 ? 100 * pago! / l[1]! : null, condicao, pago, meses };
}
