/** Educação: catálogo pequeno e um único Range por território; nenhum motor SQL. */
import { useEffect, useState } from 'react';
import { BASE_DADOS } from './manifesto';

export type ObjetoEducacao = { caminho: string; bytes: number; sha256: string };
export type TrechoEducacao = [number, number, string];
export type TerritorioEducacao = { grupo: string; nome: string; uf: string | null; cod_ibge: number | null; nivel: 'BR' | 'UF' | 'M'; trecho: TrechoEducacao };
export type IndicadorEducacao = { id: string; variavel: string; nome: string; nome_en: string; descricao: string; descricao_en: string; tema: string; unidade: 'numero' | 'percentual' | 'indice'; fonte: string; anos: number[]; rede?: 'publica' | 'estadual' };
export type MetaEducacao = {
  versao: 1; gerado_em: string; anos: number[]; indicadores: IndicadorEducacao[];
  territorios: TerritorioEducacao[]; municipios: Record<string, ObjetoEducacao>;
  arquivo: ObjetoEducacao; rankings: Record<string, ObjetoEducacao>;
  fontes: Record<string, { nome: string; url: string }>;
};
export type GrupoEducacao = { grupo: string; linhas: (number | null)[][]; cobertura: Record<string, Record<string, [number, number]>> };
export type RankingEducacao = { ano: number; linhas: [number, string, string, ...(number | null)[]][] };

const cache = new Map<string, Promise<unknown>>();
function memorizar<T>(key: string, f: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) { p = f(); cache.set(key, p); p.catch(() => { if (cache.get(key) === p) cache.delete(key); }); }
  return p;
}
const digest = async (b: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), x => x.toString(16).padStart(2, '0')).join('');
const hashValido = (s: string) => /^[a-f0-9]{64}$/.test(s);
function validarObjeto(r: ObjetoEducacao) {
  if (!r || !/^gold\/educacao\/[a-z0-9_]+\.(json|ndjson|parquet)$/.test(r.caminho) || !hashValido(r.sha256) || !Number.isSafeInteger(r.bytes) || r.bytes < 1) throw new Error('Catálogo de educação inválido.');
}
async function ler<T>(r: ObjetoEducacao): Promise<T> {
  validarObjeto(r);
  const response = await fetch(`${BASE_DADOS}${r.caminho}`);
  if (!response.ok) throw new Error(`Dados de educação indisponíveis (${response.status}).`);
  const b = await response.arrayBuffer();
  if (b.byteLength !== r.bytes || await digest(b) !== r.sha256) throw new Error('Arquivo de educação incompleto. Tente novamente.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as T;
}
export function obterMetaEducacao(): Promise<MetaEducacao> {
  return memorizar('meta', async () => {
    const r = await fetch(`${BASE_DADOS}gold/educacao/manifesto.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Catálogo de educação indisponível (${r.status}).`);
    const m = await r.json() as MetaEducacao;
    if (m.versao !== 1 || !Array.isArray(m.indicadores) || !Array.isArray(m.territorios) || !Array.isArray(m.anos) || !m.municipios || !m.rankings || !m.fontes) throw new Error('Versão do catálogo de educação incompatível.');
    validarObjeto(m.arquivo);
    if (new Set(m.indicadores.map(i => i.id)).size !== m.indicadores.length || m.indicadores.some(i => !/^[a-z][a-z0-9_]*$/.test(i.id) || !Array.isArray(i.anos))) throw new Error('Indicadores de educação inválidos.');
    return m;
  });
}
export function obterMunicipiosEducacao(uf: string): Promise<TerritorioEducacao[]> {
  return memorizar(`uf:${uf}`, async () => {
    const m = await obterMetaEducacao(); const ref = m.municipios[uf];
    if (!ref) throw new Error('UF ausente dos dados de educação.');
    const items = await ler<TerritorioEducacao[]>(ref);
    if (!Array.isArray(items) || items.some(t => t.uf !== uf || !/^\d{7}$/.test(t.grupo) || t.nivel !== 'M')) throw new Error('Cadastro de municípios de outra UF.');
    return items;
  });
}
export function obterGrupoEducacao(t: TerritorioEducacao): Promise<GrupoEducacao> {
  return memorizar(`grupo:${t.grupo}:${t.trecho?.[2]}`, async () => {
    const m = await obterMetaEducacao(); const [start, size, hash] = t.trecho ?? [];
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(size) || size < 1 || start + size > m.arquivo.bytes || !hashValido(hash)) throw new Error('Trecho de educação inválido.');
    const r = await fetch(`${BASE_DADOS}${m.arquivo.caminho}`, { headers: { Range: `bytes=${start}-${start + size - 1}` } });
    if (r.status !== 206 || r.headers.get('Content-Range') !== `bytes ${start}-${start + size - 1}/${m.arquivo.bytes}`) {
      await r.body?.cancel(); throw new Error('Não foi possível carregar este território. Tente novamente.');
    }
    const b = await r.arrayBuffer();
    if (b.byteLength !== size || await digest(b) !== hash) throw new Error('Trecho de educação incompleto. Tente novamente.');
    const g = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as GrupoEducacao;
    if (g.grupo !== t.grupo || !Array.isArray(g.linhas) || g.linhas.some(l => l.length !== m.indicadores.length + 1)) throw new Error('Dados de outro território ou versão.');
    return g;
  });
}
export function obterRankingEducacao(ano: number): Promise<RankingEducacao> {
  return memorizar(`ranking:${ano}`, async () => {
    const m = await obterMetaEducacao(); const ref = m.rankings[String(ano)];
    if (!ref) throw new Error('Ano ausente dos dados de educação.');
    const r = await ler<RankingEducacao>(ref);
    if (r.ano !== ano || !Array.isArray(r.linhas) || r.linhas.some(l => l.length !== m.indicadores.length + 3)) throw new Error('Ranking de outra referência.');
    return r;
  });
}
export function linhaEducacao(g: GrupoEducacao, indice: number, ano: number | null): { ano: number; valor: number | null } | null {
  const row = ano === null ? [...g.linhas].reverse().find(l => l[indice + 1] !== null) : g.linhas.find(l => l[0] === ano);
  return row ? { ano: row[0] as number, valor: row[indice + 1] } : null;
}
export function useEducacao<T>(chave: string | null, lerDados: () => Promise<T>) {
  const [attempt, setAttempt] = useState(0);
  const [estado, setEstado] = useState<{ chave: string; dados?: T; erro?: string } | null>(null);
  useEffect(() => {
    if (!chave) return;
    let active = true;
    lerDados().then(dados => { if (active) setEstado({ chave, dados }); }).catch((e: Error) => { if (active) setEstado({ chave, erro: e.message }); });
    return () => { active = false; };
    // chave contém todos os argumentos e impede que respostas atrasadas troquem o recorte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, attempt]);
  return { dados: estado?.chave === chave ? estado.dados : undefined, erro: estado?.chave === chave ? estado.erro : undefined,
    recarregar: () => { setEstado(null); setAttempt(v => v + 1); } };
}
