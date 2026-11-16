import { BASE_DADOS } from './manifesto';

type Objeto = { caminho: string; bytes: number; sha256: string };
type Trecho = [number, number, string];
/** ano, PIB nominal, PBF anual completo, BPC anual completo, meses PBF, meses BPC. */
export type AnoEconomia = [number, number | null, number | null, number | null, number, number];
export type GrupoEconomia = { grupo: string; linhas: AnoEconomia[] };
export type MetaEconomia = { versao: number; gerado_em: string; anos: number[]; pib_ate: number; arquivo: Objeto; grupos: Record<string, Trecho>; indices_uf: Record<string, Objeto> };
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
      const indice = await memo(`indice:${uf}`, async () => {
        const o = m.indices_uf[uf]; objeto(o);
        const r = await fetch(`${BASE_DADOS}${o.caminho}`);
        if (!r.ok) throw new Error('Índice municipal anual indisponível.');
        const b = await r.arrayBuffer();
        if (b.byteLength !== o.bytes || await sha(b) !== o.sha256) throw new Error('Índice municipal anual incompleto.');
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as { grupos: Record<string, Trecho> };
      });
      trecho = indice.grupos[grupo];
    }
    if (!trecho) throw new Error('Território ausente da comparação anual.');
    const [inicio, tamanho, hash] = trecho;
    if (!Number.isSafeInteger(inicio) || inicio < 0 || !Number.isSafeInteger(tamanho) || tamanho < 1 || inicio + tamanho > m.arquivo.bytes || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('Trecho anual inválido.');
    const r = await fetch(`${BASE_DADOS}${m.arquivo.caminho}`, { headers: { Range: `bytes=${inicio}-${inicio + tamanho - 1}` } });
    if (r.status !== 206 || r.headers.get('Content-Range') !== `bytes ${inicio}-${inicio + tamanho - 1}/${m.arquivo.bytes}`) { await r.body?.cancel(); throw new Error('Não foi possível carregar somente este território.'); }
    const b = await r.arrayBuffer();
    if (b.byteLength !== tamanho || await sha(b) !== hash) throw new Error('Dados anuais incompletos.');
    const g = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as GrupoEconomia;
    if (g.grupo !== grupo || !Array.isArray(g.linhas) || g.linhas.some(l => l.length !== 6 || !m.anos.includes(l[0]) || l.slice(1).some(v => v !== null && !Number.isFinite(v)) || !Number.isInteger(l[4]) || !Number.isInteger(l[5]) || l[4] < 0 || l[4] > 12 || l[5] < 0 || l[5] > 12)) throw new Error('Dados anuais de outro recorte ou formato.');
    return g;
  });
}
/** Percentual em pontos percentuais, não fração: 2 representa 2%. */
export function compararPib(l: AnoEconomia | undefined, tipo: 'pbf' | 'bpc' | 'total'): { valor: number | null; condicao: number; pago: number | null; meses: number } {
  if (!l) return { valor: null, condicao: 1, pago: null, meses: 0 };
  const meses = tipo === 'pbf' ? l[4] : tipo === 'bpc' ? l[5] : Math.min(l[4], l[5]);
  const pago = tipo === 'pbf' ? l[2] : tipo === 'bpc' ? l[3] : l[2] !== null && l[3] !== null ? l[2] + l[3] : null;
  const condicao = meses === 0 ? 1 : meses !== 12 || pago === null ? 2 : l[1] === null ? 3 : l[1] === 0 ? 4 : l[1] < 0 ? 5 : 0;
  return { valor: condicao === 0 ? 100 * pago! / l[1]! : null, condicao, pago, meses };
}
