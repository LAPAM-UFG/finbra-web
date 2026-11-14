/** Agregados públicos prontos: catálogo leve e apenas um trecho por território, sem iniciar o DuckDB. */
import { useEffect, useState } from 'react';
import { BASE_DADOS, obterManifesto, versaoDoManifesto } from './manifesto';

export type FonteSocial = 'cadunico' | 'pbf' | 'bpc';
export type IndicadorSocial = {
  id: string; nome: string; nome_en: string; tema: string; tema_en: string; fonte: FonteSocial;
  unidade: 'numero' | 'moeda' | 'razao' | 'indice' | 'decimal'; descricao: string; descricao_en: string;
  acumulavel: boolean; destaque?: boolean; precos?: 'nominais' | 'reais';
  competencias?: number[];
};
export type TerritorioSocial = { grupo: string; nome: string; nivel: 'BR' | 'UF' | 'M'; uf: string | null; cod_ibge: number | null };
export type LinhaSocial = { competencia: number; valores: Record<string, number | null>; condicoes: Record<string, string>; referencias?: Record<string, number> };
export type GrupoSocial = { grupo: string; series: Record<FonteSocial, LinhaSocial[]> };
export type ObjetoSocial = { caminho: string; sha256: string; bytes: number };
export type MetaSocial = {
  versao: number; gerado_em: string; base_ipca: number;
  fontes: Record<FonteSocial, { nome: string; url: string; competencias: number[]; avisos: string[]; avisos_en: string[] }>;
  indicadores: IndicadorSocial[]; territorios: TerritorioSocial[]; arquivo: ObjetoSocial;
  grupos: Record<string, [number, number, string]>;
  rankings: Record<FonteSocial, Record<string, ObjetoSocial>>;
};
export type RankingSocial = { fonte: FonteSocial; competencia: number; linhas: { grupo: string; valores: Record<string, number | null>; condicoes: Record<string, string> }[] };

const cache = new Map<string, Promise<unknown>>();
function memorizar<T>(chave: string, ler: () => Promise<T>): Promise<T> {
  let p = cache.get(chave) as Promise<T> | undefined;
  if (!p) { p = ler(); cache.set(chave, p); p.catch(() => { if (cache.get(chave) === p) cache.delete(chave); }); }
  return p;
}
const sha = async (b: ArrayBuffer) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b)), x => x.toString(16).padStart(2, '0')).join('');
function validarObjeto(a: ObjetoSocial): void {
  if (!a || !/^gold\/assistencia\/[a-z0-9_]+\.(json|ndjson)$/.test(a.caminho) || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes < 1) throw new Error('Catálogo de assistência social inválido.');
}
async function endereco(caminho: string): Promise<string> {
  const m = await obterManifesto(s => `Manifesto indisponível (${s}).`);
  return `${BASE_DADOS}v/${versaoDoManifesto(m)}/${caminho}`;
}
async function lerObjeto<T>(objeto: ObjetoSocial): Promise<T> {
  validarObjeto(objeto);
  const r = await fetch(await endereco(objeto.caminho));
  if (!r.ok) throw new Error(`Dados de assistência social indisponíveis (${r.status}).`);
  const b = await r.arrayBuffer();
  if (b.byteLength !== objeto.bytes || await sha(b) !== objeto.sha256) throw new Error('Os dados recebidos diferem do catálogo. Atualize a página e tente novamente.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as T;
}
export function obterMetaSocial(): Promise<MetaSocial> {
  return memorizar('meta', async () => {
    const manifesto = await obterManifesto(s => `Manifesto indisponível (${s}).`);
    const anuncio = manifesto.fontes?.assistencia?.abertura as ObjetoSocial | undefined;
    if (!anuncio) throw new Error('Os dados de assistência social ainda não foram publicados.');
    const meta = await lerObjeto<MetaSocial>(anuncio);
    if (meta.versao !== 1 || !Array.isArray(meta.territorios) || !Array.isArray(meta.indicadores) || !meta.fontes || !meta.grupos) throw new Error('Versão do painel de assistência social incompatível.');
    validarObjeto(meta.arquivo);
    if (new Set(meta.indicadores.map(i => i.id)).size !== meta.indicadores.length || new Set(meta.territorios.map(t => t.grupo)).size !== meta.territorios.length) throw new Error('Catálogo de assistência social com chaves repetidas.');
    for (const [grupo, intervalo] of Object.entries(meta.grupos)) {
      const [inicio, tamanho, digest] = intervalo;
      if (!/^(BR|[A-Z]{2}|\d{7})$/.test(grupo) || !Number.isSafeInteger(inicio) || inicio < 0 || !Number.isSafeInteger(tamanho) || tamanho < 1 || inicio + tamanho > meta.arquivo.bytes || !/^[0-9a-f]{64}$/.test(digest)) throw new Error('Trecho de dados inválido no catálogo.');
    }
    return meta;
  });
}
export function obterGrupoSocial(grupo: string): Promise<GrupoSocial> {
  return memorizar(`grupo:${grupo}`, async () => {
    const meta = await obterMetaSocial();
    const intervalo = meta.grupos[grupo];
    if (!intervalo) throw new Error('Território ausente dos dados de assistência social.');
    const [inicio, tamanho, digest] = intervalo;
    const r = await fetch(await endereco(meta.arquivo.caminho), { headers: { Range: `bytes=${inicio}-${inicio + tamanho - 1}` } });
    if (r.status !== 206 || r.headers.get('Content-Range') !== `bytes ${inicio}-${inicio + tamanho - 1}/${meta.arquivo.bytes}`) {
      await r.body?.cancel();
      throw new Error('Não foi possível carregar o trecho desse território. Tente novamente.');
    }
    const b = await r.arrayBuffer();
    if (b.byteLength !== tamanho || await sha(b) !== digest) throw new Error('Trecho de assistência social incompleto. Tente novamente.');
    const g = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b)) as GrupoSocial;
    if (g.grupo !== grupo || !g.series || !['cadunico', 'pbf', 'bpc'].every(f => Array.isArray(g.series[f as FonteSocial]))) throw new Error('Dados de outro território: carregamento interrompido.');
    return g;
  });
}
export function obterRankingSocial(fonte: FonteSocial, competencia: number): Promise<RankingSocial> {
  return memorizar(`ranking:${fonte}:${competencia}`, async () => {
    const m = await obterMetaSocial(); const a = m.rankings[fonte]?.[String(competencia)];
    if (!a) return { fonte, competencia, linhas: [] };
    const r = await lerObjeto<RankingSocial>(a);
    if (r.fonte !== fonte || r.competencia !== competencia || !Array.isArray(r.linhas)) throw new Error('Ranking de outro período.');
    return r;
  });
}
export function useSocial<T>(chave: string | null, ler: () => Promise<T>) {
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<{ chave: string; dados?: T; erro?: string } | null>(null);
  useEffect(() => {
    if (!chave) return;
    let vivo = true;
    ler().then(dados => { if (vivo) setEstado({ chave, dados }); }).catch((e: Error) => { if (vivo) setEstado({ chave, erro: e.message }); });
    return () => { vivo = false; };
    // chave inclui todos os argumentos da leitura; não repetir quando a função inline muda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, tentativa]);
  return { dados: estado?.chave === chave ? estado.dados : undefined, erro: estado?.chave === chave ? estado.erro : undefined,
    carregando: !!chave && estado?.chave !== chave, recarregar: () => { setEstado(null); setTentativa(x => x + 1); } };
}
/** Retrato com a última referência DE CADA INDICADOR; mês explícito nunca é trocado. Datas estão em referencias[id]. */
export function linhaSocial(grupo: GrupoSocial | undefined, fonte: FonteSocial, mes?: number): LinhaSocial | undefined {
  const linhas = grupo?.series[fonte] ?? [];
  if (mes) return linhas.find(l => l.competencia === mes);
  if (!linhas.length) return undefined;
  const result: LinhaSocial = { competencia: linhas[linhas.length - 1].competencia, valores: {}, condicoes: {}, referencias: {} };
  for (const l of linhas) for (const [id, valor] of Object.entries(l.valores)) {
    result.valores[id] = valor; result.referencias![id] = l.competencia;
    if (l.condicoes[id]) result.condicoes[id] = l.condicoes[id]; else delete result.condicoes[id];
  }
  return result;
}
/** A referência pertence ao indicador, pois folha MDS e pagamentos CGU não têm a mesma cobertura. */
export function linhaIndicadorSocial(grupo: GrupoSocial | undefined, indicador: IndicadorSocial, mes?: number): LinhaSocial | undefined {
  const linhas = grupo?.series[indicador.fonte] ?? [];
  return mes ? linhas.find(l => l.competencia === mes && indicador.id in l.valores)
    : [...linhas].reverse().find(l => indicador.id in l.valores);
}
export const mesSocial = (n: number): string => `${String(n % 100).padStart(2, '0')}/${Math.floor(n / 100)}`;
