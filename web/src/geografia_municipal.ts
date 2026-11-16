import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { BASE_DADOS } from './manifesto';
import { UF_NOMES } from './ufs';

export type MunicipioMapa = { name: string; nome: string; uf: string };
export type MalhaMunicipal = FeatureCollection<Polygon | MultiPolygon, MunicipioMapa>;
/** Suspense pode ocultar temporariamente o gráfico durante uma navegação. */
export function tamanhoMapa(largura: number, altura: number) {
  return Number.isFinite(largura) && Number.isFinite(altura) && largura > 0 && altura > 0 ? { width: largura, height: altura } : null;
}
/** Centro geográfico da extensão total, usado para reenquadrar sem alterar o recorte. */
export function centroDaMalha(malha: MalhaMunicipal): [number, number] {
  let oeste = Infinity, leste = -Infinity, sul = Infinity, norte = -Infinity;
  for (const f of malha.features) {
    const poligonos = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poligono of poligonos) for (const anel of poligono) for (const [x, y] of anel) {
      oeste = Math.min(oeste, x); leste = Math.max(leste, x); sul = Math.min(sul, y); norte = Math.max(norte, y);
    }
  }
  if (![oeste, leste, sul, norte].every(Number.isFinite)) throw new Error('Limites da malha inválidos.');
  return [(oeste + leste) / 2, (sul + norte) / 2];
}
type Objeto = { caminho: string; bytes: number; sha256: string; territorios: number };
type Catalogo = { versao: number; ano_malha: number; fonte: string; recortes: Record<string, Objeto> };
export function buscarNoMapa(malha: MalhaMunicipal, busca: string): MunicipioMapa[] {
  const normal = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR');
  const termos = normal(busca.trim()).split(/\s+/).filter(Boolean);
  if (!termos.length) return [];
  return malha.features.map(f => f.properties).filter(p => termos.every(t => normal(`${p.nome} ${p.uf} ${p.name}`).includes(t)));
}
const cache = new Map<string, Promise<unknown>>();
function memo<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) { p = fn(); cache.set(key, p); p.catch(() => { if (cache.get(key) === p) cache.delete(key); }); }
  return p;
}
export function validarMalha(malha: MalhaMunicipal, uf: string, quantidade: number): void {
  const codigos = new Set<string>();
  if (malha.type !== 'FeatureCollection' || !Array.isArray(malha.features) || malha.features.length !== quantidade || !quantidade) throw new Error('Cobertura da malha incompatível.');
  for (const f of malha.features) {
    const p = f.properties;
    if (!p || !/^\d{7}$/.test(p.name) || !p.nome || !Object.hasOwn(UF_NOMES, p.uf) || (uf !== 'BR' && p.uf !== uf) || codigos.has(p.name) || !['Polygon', 'MultiPolygon'].includes(f.geometry?.type) || !f.geometry.coordinates.length) throw new Error('Território inválido na malha.');
    codigos.add(p.name);
  }
}
export function obterMalhaMunicipal(uf: string): Promise<{ malha: MalhaMunicipal; ano: number; fonte: string }> {
  return memo(`malha:${uf}`, async () => {
    if (uf !== 'BR' && !Object.hasOwn(UF_NOMES, uf)) throw new Error('Estado inválido para o mapa.');
    const m = await memo('catalogo', async () => {
      const r = await fetch(`${BASE_DADOS}gold/geografia/manifesto.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error('Catálogo do mapa indisponível.');
      const v = await r.json() as Catalogo;
      if (v.versao !== 1 || v.ano_malha !== 2025 || !v.recortes || v.fonte !== 'https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html') throw new Error('Catálogo do mapa incompatível.');
      return v;
    });
    const o = m.recortes[uf];
    if (!o || !/^gold\/geografia\/municipios_2025_[a-z]{2}_[a-f0-9]{16}\.json$/.test(o.caminho) || !Number.isSafeInteger(o.bytes) || o.bytes < 1 || o.bytes > 4000000 || !/^[a-f0-9]{64}$/.test(o.sha256) || !Number.isSafeInteger(o.territorios)) throw new Error('Recorte do mapa inválido.');
    const r = await fetch(`${BASE_DADOS}${o.caminho}`);
    if (!r.ok) throw new Error('Malha municipal indisponível.');
    const b = await r.arrayBuffer();
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), x => x.toString(16).padStart(2, '0')).join('');
    if (b.byteLength !== o.bytes || h !== o.sha256) throw new Error('Malha municipal incompleta.');
    const topo = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as Topology;
    if (topo.type !== 'Topology' || !topo.objects.municipios || topo.objects.municipios.type !== 'GeometryCollection') throw new Error('Formato da malha incompatível.');
    const malha = feature(topo, topo.objects.municipios as GeometryCollection) as MalhaMunicipal;
    validarMalha(malha, uf, o.territorios);
    return { malha, ano: m.ano_malha, fonte: m.fonte };
  });
}
