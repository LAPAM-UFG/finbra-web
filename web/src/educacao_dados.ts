import { buscarDados as fetch } from './buscar_dados';
/** Educação: catálogo pequeno e um único Range por território; nenhum motor SQL. */
import { useEffect, useState } from 'react';
import { BASE_DADOS } from './manifesto';
import {type RedeEducacao} from './educacao_rede';
export {REDES_EDUCACAO,redeEducacaoValida,type RedeEducacao} from './educacao_rede';

export type ObjetoEducacao = { caminho: string; bytes: number; sha256: string };
export type TrechoEducacao = [number, number, string];
export type TerritorioEducacao = { grupo: string; nome: string; uf: string | null; cod_ibge: number | null; nivel: 'BR' | 'UF' | 'M'; trecho: TrechoEducacao };
export type MunicipioBuscaEducacao = Pick<TerritorioEducacao,'grupo'|'nome'|'uf'>;
const UFS_CODIGO: Record<string,string>={11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF'};
export const ufMunicipioEducacao=(codigo:string)=>/^\d{7}$/.test(codigo) ? UFS_CODIGO[codigo.slice(0,2)] : undefined;
export const normalizarBuscaEducacao=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
export function filtrarMunicipiosEducacao(items:MunicipioBuscaEducacao[],busca:string):MunicipioBuscaEducacao[] {
  const q=normalizarBuscaEducacao(busca),terms=q.split(/\s+/).filter(Boolean);
  const score=(x:MunicipioBuscaEducacao)=>x.grupo===q || normalizarBuscaEducacao(x.nome)===q ? 0 : normalizarBuscaEducacao(x.nome).startsWith(q) ? 1 : 2;
  return items.filter(x=>terms.every(t=>normalizarBuscaEducacao(`${x.nome} ${x.uf} ${x.grupo}`).includes(t))).sort((a,b)=>score(a)-score(b) || a.nome.localeCompare(b.nome,'pt-BR') || String(a.uf).localeCompare(String(b.uf)));
}
export function municipioExatoEducacao(items:MunicipioBuscaEducacao[],busca:string):MunicipioBuscaEducacao|undefined {
  const q=normalizarBuscaEducacao(busca),matches=items.filter(x=>x.grupo===q || normalizarBuscaEducacao(x.nome)===q);
  return matches.length===1 ? matches[0] : items.length===1 ? items[0] : undefined;
}
export type IndicadorEducacao = { id: string; variavel: string; nome: string; nome_en: string; descricao: string; descricao_en: string; tema: string; unidade: 'numero' | 'percentual' | 'indice' | 'pontos' | 'condicao'; fonte: string; anos: number[]; rede?: 'publica' | 'estadual'; etapa?: string;associado?:string;rotulos?:Record<string,string> };
export type MetaEducacao = {
  versao: 1; gerado_em: string; anos: number[]; indicadores: IndicadorEducacao[];
  territorios: TerritorioEducacao[]; municipios: Record<string, ObjetoEducacao>;
  busca_municipios?: ObjetoEducacao;
  arquivo: ObjetoEducacao; rankings: Record<string, ObjetoEducacao>;
  fontes: Record<string, { nome: string; url: string }>;
  rede?: RedeEducacao;
  redes?: Partial<Record<RedeEducacao,ObjetoEducacao & {nome:string;nome_en:string}>>;
  consulta?: ObjetoEducacao;
  financeiro?: ObjetoEducacao;
  edicoes_avaliacao?: number[];
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
export {ler as lerObjetoEducacao};
export function obterMetaEducacao(rede:RedeEducacao='todas'): Promise<MetaEducacao> {
  return memorizar('meta:'+rede, async () => {
    if(rede!=='todas') {
      const principal=await obterMetaEducacao();const ref=principal.redes?.[rede];
      if(!ref)throw new Error('Este recorte por rede ainda não está disponível.');
      const m=await ler<MetaEducacao>(ref);
      if(m.rede!==rede)throw new Error('Dados de outra rede de ensino.');
      validarMeta(m);return {...m,redes:principal.redes,edicoes_avaliacao:principal.edicoes_avaliacao};
    }
    const r = await fetch(`${BASE_DADOS}gold/educacao/manifesto.json`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`Catálogo de educação indisponível (${r.status}).`);
    const m = await r.json() as MetaEducacao;
    validarMeta(m);
    return m;
  });
}
function validarMeta(m:MetaEducacao) {
  if (m.versao !== 1 || !Array.isArray(m.indicadores) || !Array.isArray(m.territorios) || !Array.isArray(m.anos) || !m.municipios || !m.rankings || !m.fontes) throw new Error('Versão do catálogo de educação incompatível.');
  validarObjeto(m.arquivo);
  if (new Set(m.indicadores.map(i => i.id)).size !== m.indicadores.length || m.indicadores.some(i => !/^[a-z][a-z0-9_]*$/.test(i.id) || !Array.isArray(i.anos))) throw new Error('Indicadores de educação inválidos.');
}
export function obterMunicipiosEducacao(uf: string,rede:RedeEducacao='todas'): Promise<TerritorioEducacao[]> {
  return memorizar(`uf:${rede}:${uf}`, async () => {
    const m = await obterMetaEducacao(rede); const ref = m.municipios[uf];
    if (!ref) throw new Error('UF ausente dos dados de educação.');
    const items = await ler<TerritorioEducacao[]>(ref);
    if (!Array.isArray(items) || items.some(t => t.uf !== uf || !/^\d{7}$/.test(t.grupo) || t.nivel !== 'M')) throw new Error('Cadastro de municípios de outra UF.');
    return items;
  });
}
export function obterBuscaMunicipiosEducacao():Promise<MunicipioBuscaEducacao[]> {
  return memorizar('busca-municipios',async()=>{
    const m=await obterMetaEducacao();
    if(!m.busca_municipios)throw new Error('Catálogo nacional de municípios indisponível.');
    const rows=await ler<unknown>(m.busca_municipios);
    if(!Array.isArray(rows))throw new Error('Busca municipal inválida.');
    const seen=new Set<string>();
    return rows.map(r=>{
      if(!Array.isArray(r) || r.length!==3 || typeof r[0]!=='string' || !ufMunicipioEducacao(r[0]) || typeof r[1]!=='string' || !r[1].trim() || r[2]!==ufMunicipioEducacao(r[0]) || seen.has(r[0]))throw new Error('Cadastro nacional inconsistente.');
      seen.add(r[0]);return {grupo:r[0],nome:r[1],uf:r[2] as string};
    });
  });
}
export function obterGrupoEducacao(t: TerritorioEducacao,rede:RedeEducacao='todas'): Promise<GrupoEducacao> {
  return memorizar(`grupo:${rede}:${t.grupo}:${t.trecho?.[2]}`, async () => {
    const m = await obterMetaEducacao(rede); const [start, size, hash] = t.trecho ?? [];
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
export function obterRankingEducacao(ano: number,rede:RedeEducacao='todas'): Promise<RankingEducacao> {
  return memorizar(`ranking:${rede}:${ano}`, async () => {
    const m = await obterMetaEducacao(rede); const ref = m.rankings[String(ano)];
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
export function avaliacaoEducacao(i:IndicadorEducacao) { return i.fonte==='ideb'||i.fonte==='saeb'; }
export function anoSemEdicaoEducacao(m:MetaEducacao,i:IndicadorEducacao,ano:number|null) {
  return ano!==null && avaliacaoEducacao(i) && !(m.edicoes_avaliacao ?? m.indicadores.filter(avaliacaoEducacao).flatMap(x=>x.anos)).includes(ano);
}
/** Posição compartilhada em empates; nunca desempata uma nota idêntica por código IBGE. */
export function posicoesEducacao(rows:RankingEducacao['linhas'],indice:number):number[] {
  const result:number[]=[];rows.forEach((r,n)=>result.push(n>0 && r[indice+3]===rows[n-1][indice+3] ? result[n-1] : n+1));return result;
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
