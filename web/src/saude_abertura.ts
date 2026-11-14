/**
 * Abertura rápida do painel de saúde (/datasus), SEM DuckDB-WASM e sem arquivos financeiros.
 *
 * Lê o pacote gerado por pipeline/saude_abertura.py (manifesto: aberturas.saude): um índice JSON (cadastro de entes, colunas, tamanhos em
 * bytes UTF-8 de cada grupo) e UM Range de 24 a 42 KB por grupo (o DF tem dois: saúde em 5300108 e SIOPS no ente 53) com a série de saúde (saude_serie, todos os anos e colunas) e o SIOPS do recorte.
 * Nada é recalculado: são os valores que as rotas do motor devolveriam, com o mesmo formato. Rotas nativas: saude_meta, saude_entes,
 * saude_colunas, saude_serie e saude_siops. O pacote só vale para o MESMO gerado_em do manifesto e para o mesmo formato: um manifesto
 * atualizado sem regerar o pacote, ou qualquer falha de formato, hash, versão, offset ou resposta HTTP, devolve USAR_MOTOR (a rota cai
 * no caminho antigo, mais lento, pelo DuckDB), nunca dados inventados nem zeros.
 */
import { USAR_MOTOR, type Dependencias } from './clima_abertura';
import type { ManifestoBruto } from './manifesto';

export { USAR_MOTOR };
export type Linha = Record<string, number | string | null>;
export type Params = Record<string, string | number | null | undefined>;

export type Anuncio = {
  versao: number; indice: string; indice_sha256: string; indice_bytes: number; arquivo: string; sha256: string; bytes: number;
  snapshot: string; grupos: number; gerado_em: string; origem: Record<string, string>;
};
export type EnteIndice = [number, string, string, string, boolean | null];
export type Indice = {
  versao: number; snapshot: string; arquivo: string; sha256: string; bytes: number; gerado_em: string; base_ipca: number;
  origem: Record<string, string>; colunas: string[]; serie: string[]; siops: string[]; aliases: { saude: Record<string, string> };
  entes: EnteIndice[]; grupos: string[]; tamanhos: number[];
};
export type GrupoLido = { a: number[]; m: number[]; r: (number | null)[][]; p: [number, number | null, number | null][] };
type IndiceLido = { indice: Indice; deslocamentos: Map<string, [number, number]>; anuncio: Anuncio; manifesto: ManifestoBruto };

export const ROTAS_NATIVAS_SAUDE = ['saude_meta', 'saude_entes', 'saude_colunas', 'saude_serie', 'saude_siops'] as const;
const ROTAS = new Set<string>(ROTAS_NATIVAS_SAUDE);

/** Colunas-chave de saude_municipios (CHAVES_SAUDE em dados.ts): ficam fora das somas. */
const CHAVES = ['ano', 'cod_ibge', 'municipio', 'nome', 'uf'];
const CAMPOS_SIOPS = ['saude_hab', 'saude_proprios_hab'];
const UFS = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));
const ORIGENS = ['municipios', 'saude_educacao', 'entes', 'indicadores', 'ipca'];
/** saude_serie mapeia ente=53 (Distrito Federal no cadastro) para Brasília (5300108); se_ente/SIOPS usa o código como está. */
const ALIAS_SAUDE: Record<string, string> = { '53': '5300108' };

const RE_INDICE = /^gold\/saude\/abertura_indice_[0-9a-f]{12}\.json$/;
const RE_ARQUIVO = /^gold\/saude\/abertura_[0-9a-f]{12}\.ndjson$/;
const RE_HEX12 = /^[0-9a-f]{12}$/;
const RE_HEX64 = /^[0-9a-f]{64}$/;
const ehInteiro = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);
const ehInteiroPositivo = (n: unknown): n is number => ehInteiro(n) && n > 0;
const ehNumeroOuNulo = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isFinite(v));
const inteiro = (v: unknown) => (v === undefined || v === null || v === '' ? null : Number.parseInt(String(v), 10)); // = inteiro de dados.ts

/** Falha de formato/versão: o pacote não é confiável (não adianta tentar de novo nesta sessão). */
export class AberturaSaudeInvalida extends Error {}

export function anuncioDoManifesto(m: ManifestoBruto): Anuncio | null {
  const a = (m.aberturas?.saude ?? null) as Partial<Anuncio> | null;
  if (!a || typeof a !== 'object' || a.versao !== 1) return null;
  if (typeof a.indice !== 'string' || !RE_INDICE.test(a.indice) || typeof a.arquivo !== 'string' || !RE_ARQUIVO.test(a.arquivo)) return null;
  if (typeof a.sha256 !== 'string' || !RE_HEX64.test(a.sha256) || a.arquivo !== `gold/saude/abertura_${a.sha256.slice(0, 12)}.ndjson`) return null;
  if (typeof a.indice_sha256 !== 'string' || !RE_HEX64.test(a.indice_sha256) || a.indice !== `gold/saude/abertura_indice_${a.indice_sha256.slice(0, 12)}.json`) return null;
  if (typeof a.snapshot !== 'string' || !RE_HEX12.test(a.snapshot)) return null;
  if (!ehInteiroPositivo(a.bytes) || !ehInteiroPositivo(a.indice_bytes) || !ehInteiroPositivo(a.grupos)) return null;
  // o pacote só vale para ESTE manifesto: uma atualização posterior (outro gerado_em) sem regerar o pacote cai no motor
  if (typeof a.gerado_em !== 'string' || a.gerado_em !== m.gerado_em) return null;
  const o = a.origem;
  if (!o || typeof o !== 'object' || ORIGENS.some((k) => typeof o[k] !== 'string' || !RE_HEX64.test(o[k]))) return null;
  return a as Anuncio;
}

const mesmo = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function validarIndice(i: unknown, a: Anuncio, m: ManifestoBruto): Indice {
  const x = i as Partial<Indice> | null;
  const falha = (msg: string) => new AberturaSaudeInvalida(`índice da saúde inválido: ${msg}`);
  if (!x || typeof x !== 'object') throw falha('não é objeto');
  if (x.versao !== 1) throw falha('versão');
  if (x.snapshot !== a.snapshot || x.sha256 !== a.sha256 || x.bytes !== a.bytes || x.gerado_em !== a.gerado_em || x.gerado_em !== m.gerado_em) throw falha('diverge do manifesto (outro snapshot)');
  if (x.arquivo !== a.arquivo.split('/').pop() || !mesmo(x.origem, a.origem)) throw falha('arquivo ou origem');
  if (x.base_ipca !== m.base_ipca) throw falha('base do IPCA diferente da do manifesto');
  if (!Array.isArray(x.colunas) || x.colunas.some((c) => typeof c !== 'string') || new Set(x.colunas).size !== x.colunas.length || CHAVES.some((c) => !x.colunas!.includes(c))) throw falha('colunas');
  if (!Array.isArray(x.serie) || !mesmo(x.serie, x.colunas.filter((c) => !CHAVES.includes(c)))) throw falha('colunas da série');
  if (!mesmo(x.siops, CAMPOS_SIOPS) || !mesmo(x.aliases, { saude: ALIAS_SAUDE })) throw falha('campos do SIOPS ou aliases');
  if (!Array.isArray(x.grupos) || !Array.isArray(x.tamanhos) || x.grupos.length !== x.tamanhos.length || x.grupos.length !== a.grupos) throw falha('grupos');
  if (new Set(x.grupos).size !== x.grupos.length || !x.grupos.includes('BR') || x.grupos.some((g) => typeof g !== 'string' || !/^([A-Z]{2}|\d{1,7})$/.test(g))) throw falha('chaves de grupo');
  if (x.tamanhos.some((n) => !ehInteiroPositivo(n)) || x.tamanhos.reduce((s, n) => s + n, 0) !== a.bytes) throw falha('tamanhos');
  if (!Array.isArray(x.entes) || x.entes.length === 0) throw falha('cadastro');
  for (const e of x.entes) {
    if (!Array.isArray(e) || e.length !== 5 || !ehInteiroPositivo(e[0]) || typeof e[1] !== 'string' || typeof e[2] !== 'string' || !['M', 'E', 'D'].includes(e[3])
      || (e[4] !== null && typeof e[4] !== 'boolean')) throw falha('cadastro');
  }
  return x as Indice;
}

const hexDe = async (dados: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', dados))].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Padrao = () => (typeof crypto !== 'undefined' && crypto.subtle ? hexDe : undefined);

/** Uma linha do pacote: valida grupo, snapshot, tipos e anos, e devolve as séries. */
export function lerLinhaGrupo(bytes: Uint8Array, grupo: string, esperadoBytes: number, snapshot: string, nSerie: number): GrupoLido {
  const ruim = (msg: string) => new Error(`trecho da saúde inválido (${grupo}): ${msg}`);
  if (bytes.byteLength !== esperadoBytes) throw ruim(`${bytes.byteLength} bytes em vez de ${esperadoBytes}`);
  if (bytes[bytes.byteLength - 1] !== 0x0a) throw ruim('sem fim de linha');
  const o = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { g?: string; s?: string; a?: unknown; m?: unknown; r?: unknown; p?: unknown };
  if (o.g !== grupo || o.s !== snapshot) throw ruim('grupo ou snapshot diferente do índice');
  const crescente = (anos: number[]) => anos.every((n, k) => ehInteiro(n) && n >= 1900 && n <= 2200 && (k === 0 || n > anos[k - 1]));
  if (!Array.isArray(o.a) || !Array.isArray(o.m) || !Array.isArray(o.r) || !Array.isArray(o.p)) throw ruim('forma');
  if (!crescente(o.a as number[]) || o.m.length !== o.a.length || o.r.length !== o.a.length) throw ruim('anos');
  if (o.m.some((n) => !ehInteiro(n) || n < 0)) throw ruim('contagem de municípios');
  for (const r of o.r) if (!Array.isArray(r) || r.length !== nSerie || r.some((v) => !ehNumeroOuNulo(v))) throw ruim('linha de valores');
  for (const p of o.p) if (!Array.isArray(p) || p.length !== 3 || !ehInteiro(p[0]) || !ehNumeroOuNulo(p[1]) || !ehNumeroOuNulo(p[2])) throw ruim('SIOPS');
  if (!crescente((o.p as unknown[][]).map((p) => p[0] as number))) throw ruim('anos do SIOPS');
  return { a: o.a as number[], m: o.m as number[], r: o.r as (number | null)[][], p: o.p as GrupoLido['p'] };
}

/** Recorte da saúde pedido (mesma regra de escopoTrabalho em dados.ts): ente (53 → Brasília), UF ou Brasil. */
export function grupoSaude(q: Params): string {
  const ente = inteiro(q.ente);
  if (ente) return String(ente === 53 ? 5300108 : ente);
  const uf = String(q.uf);
  return UFS.has(uf) ? uf : 'BR';
}
/** Recorte do SIOPS: o ente com o código como está (se_ente), a UF (municípios dela) ou o Brasil (se_grupo com esfera M). */
export function grupoSiops(q: Params): string {
  const ente = inteiro(q.ente);
  if (ente) return String(ente);
  const uf = String(q.uf);
  return UFS.has(uf) ? uf : 'BR';
}

/** Trecho com formato inválido (Content-Range, tamanho, JSON, tipos): não adianta baixar de novo; o resultado negativo fica no cache. */
class TrechoInvalido extends Error {}
/** Grupos em cache (promises): o suficiente para um recorte e seus comparativos, sem reter os milhares do pacote. */
const LIMITE_GRUPOS = 32;

export function criarAberturaSaude(dep: Dependencias, limiteGrupos = LIMITE_GRUPOS) {
  const avisar = dep.avisar ?? ((msg: string, e?: unknown) => console.warn(msg, e));
  let indice: Promise<IndiceLido | null> | null = null;
  let estado: 'indefinido' | 'rapido' | 'motor' = 'indefinido';

  async function carregarIndice(): Promise<IndiceLido | null> {
    const manifesto = await dep.manifesto();
    const anuncio = anuncioDoManifesto(manifesto);
    if (!anuncio) return null; // sem pacote para ESTE manifesto: caminho antigo
    const r = await dep.buscar(dep.url(anuncio.indice, manifesto));
    if (!r.ok) throw new Error(`índice da saúde indisponível (${r.status})`);
    const bruto = await r.arrayBuffer();
    if (bruto.byteLength !== anuncio.indice_bytes) throw new AberturaSaudeInvalida('índice da saúde com tamanho diferente do manifesto');
    const sha = dep.sha256 ?? sha256Padrao();
    if (sha && (await sha(bruto)) !== anuncio.indice_sha256) throw new AberturaSaudeInvalida('índice da saúde com hash diferente do manifesto');
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bruto));
    } catch {
      throw new AberturaSaudeInvalida('índice da saúde ilegível');
    }
    const lido = validarIndice(json, anuncio, manifesto);
    const deslocamentos = new Map<string, [number, number]>();
    let off = 0;
    lido.grupos.forEach((g, k) => { deslocamentos.set(g, [off, lido.tamanhos[k]]); off += lido.tamanhos[k]; });
    return { indice: lido, deslocamentos, anuncio, manifesto };
  }

  /** O índice de uma sessão: erro de rede tenta de novo na próxima chamada; formato inválido não (sem laço). */
  function obterIndice(): Promise<IndiceLido | null> {
    const p = (indice ??= carregarIndice());
    p.catch((e) => {
      if (!(e instanceof AberturaSaudeInvalida) && indice === p) indice = null;
    });
    return p;
  }

  async function baixarTrecho(l: IndiceLido, grupo: string, ini: number, n: number): Promise<GrupoLido> {
    const fim = ini + n - 1;
    const r = await dep.buscar(dep.url(l.anuncio.arquivo, l.manifesto), { headers: { Range: `bytes=${ini}-${fim}` } });
    if (r.status !== 206) {
      void r.body?.cancel?.();
      throw new Error(`o servidor não respondeu ao intervalo pedido (${r.status})`);
    }
    // o cabeçalho tem de existir e ser EXATAMENTE o pedido (início, fim e total do pacote): ausente, deslocado ou de outro total, não vale
    const cr = r.headers.get('Content-Range');
    if (cr !== `bytes ${ini}-${fim}/${l.anuncio.bytes}`) {
      void r.body?.cancel?.();
      throw new TrechoInvalido(`Content-Range inesperado: ${cr ?? 'ausente'}`);
    }
    try {
      return lerLinhaGrupo(new Uint8Array(await r.arrayBuffer()), grupo, n, l.indice.snapshot, l.indice.serie.length);
    } catch (e) {
      throw new TrechoInvalido((e as Error).message);
    }
  }

  /**
   * Cache de PROMISE por grupo (no máximo `limiteGrupos`, os mais antigos saem): chamadas concorrentes ou repetidas ao mesmo grupo (série da
   * saúde e SIOPS do mesmo recorte) dividem UM Range e UM parse. Falha de rede ou de status sai do cache (a próxima chamada tenta de novo);
   * formato inválido fica (a rota recua para o motor sem baixar o mesmo trecho outra vez). Exceção ao "um Range por recorte": o DF tem duas
   * chaves (5300108 na saúde, 53 no SIOPS), logo dois grupos.
   */
  const grupos = new Map<string, Promise<GrupoLido>>();
  async function trecho(l: IndiceLido, grupo: string): Promise<GrupoLido | null> {
    const pos = l.deslocamentos.get(grupo);
    if (!pos) return null; // grupo fora do pacote: o motor também não teria linhas (sem dados, nunca zeros)
    let p = grupos.get(grupo);
    if (p) {
      grupos.delete(grupo); // reinsere no fim: o mais antigo sai primeiro
    } else {
      const novo = baixarTrecho(l, grupo, pos[0], pos[1]);
      p = novo;
      novo.catch((e) => {
        if (!(e instanceof TrechoInvalido) && grupos.get(grupo) === novo) grupos.delete(grupo);
      });
    }
    grupos.set(grupo, p);
    while (grupos.size > limiteGrupos) grupos.delete(grupos.keys().next().value!);
    return p;
  }

  function recuo(msg: string, e?: unknown): typeof USAR_MOTOR {
    estado = 'motor';
    avisar(msg, e);
    return USAR_MOTOR;
  }

  /** Mesmo objeto que a rota `meta` do motor devolve, do MESMO manifesto da sessão (o do pacote). */
  function meta(m: ManifestoBruto) {
    const ultimo = String(m.anos.at(-1));
    return {
      anos: m.anos, anexos: m.colunas?.[ultimo] ?? {}, baseIpca: m.base_ipca, geradoEm: m.gerado_em, ipcaUltimo: m.ipca_ultimo ?? null,
      fontes: m.fontes ?? {}, mapaIndicadores: m.mapa_indicadores ?? {}, politica: m.politica_alertas ?? {},
    };
  }

  /** Rotas iniciais da saúde. USAR_MOTOR = o pacote não está disponível ou falhou: a rota segue pelo caminho completo (DuckDB). */
  async function executar(caminho: string, params: Params): Promise<unknown> {
    if (!ROTAS.has(caminho)) return USAR_MOTOR;
    try {
      const l = await obterIndice();
      if (!l) return recuo('o manifesto não anuncia um pacote de abertura da saúde para esta versão; usando o caminho completo (mais lento)');
      let r: unknown;
      if (caminho === 'saude_meta') r = meta(l.manifesto);
      else if (caminho === 'saude_entes') r = l.indice.entes.map(([cod_ibge, nome, uf, esfera, capital]) => ({ cod_ibge, nome, uf, esfera, capital }));
      else if (caminho === 'saude_colunas') r = l.indice.colunas.map((column_name) => ({ column_name }));
      else if (caminho === 'saude_serie') {
        const g = await trecho(l, grupoSaude(params));
        r = (g?.a ?? []).map((ano, k) => {
          const linha: Linha = { ano, municipios: g!.m[k] };
          l.indice.serie.forEach((c, j) => { linha[c] = g!.r[k][j]; });
          return linha;
        });
      } else {
        const g = await trecho(l, grupoSiops(params));
        r = (g?.p ?? []).map(([ano, saude_hab, saude_proprios_hab]) => ({ ano, saude_hab, saude_proprios_hab }));
      }
      estado = 'rapido';
      return r;
    } catch (e) {
      return recuo('abertura rápida da saúde indisponível; usando o caminho completo (mais lento)', e);
    }
  }

  return { executar, estado: () => estado };
}
