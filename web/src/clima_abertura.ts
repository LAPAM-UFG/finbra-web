/**
 * Abertura rápida do painel de clima, SEM DuckDB-WASM e sem arquivos financeiros.
 *
 * Lê o pacote gerado por pipeline/clima_abertura.py (manifesto: fontes.clima.abertura): um índice JSON leve (territórios, catálogo,
 * tamanhos em bytes UTF-8 de cada grupo) e UM Range de poucos KB com as seis linhas de resumo do grupo pedido. Nada é recalculado:
 * são os valores do painel.parquet publicado, com as mesmas colunas. Qualquer falha de formato, hash, versão, offset ou resposta
 * HTTP devolve USAR_MOTOR (a rota cai no caminho antigo, mais lento, pelo DuckDB), nunca dados inventados nem zeros.
 */
import type { ManifestoBruto } from './manifesto';

export type LinhaResumo = Record<string, number | string | null>;
export type ClimaMeta = {
  anos: number[]; ate: number | null; normal: [number, number] | null; processado_em: string | null; gerado_em: string; abertura: boolean;
};
export const USAR_MOTOR = Symbol('usar-motor');

export type Dependencias = {
  manifesto: () => Promise<ManifestoBruto>;
  /** URL de um objeto de dados (com a versão do manifesto) */
  url: (caminho: string, manifesto: ManifestoBruto) => string;
  buscar: (url: string, init?: RequestInit) => Promise<Response>;
  /** SHA-256 em hexadecimal do índice, quando o ambiente permite (contexto seguro); senão undefined */
  sha256?: (dados: ArrayBuffer) => Promise<string>;
  avisar?: (mensagem: string, erro?: unknown) => void;
};

export type Anuncio = {
  versao: number; indice: string; indice_sha256: string; indice_bytes: number; arquivo: string; sha256: string; bytes: number;
  snapshot: string; grupos: number; ate: number; painel_sha256: string;
};
export type Indice = {
  versao: number; snapshot: string; arquivo: string; sha256: string; bytes: number; ate: number; colunas: string[];
  catalogo: Record<string, unknown>[]; territorios: [number, string, string][]; grupos: string[]; tamanhos: number[];
};
type IndiceLido = { indice: Indice; deslocamentos: Map<string, [number, number]>; anuncio: Anuncio; manifesto: ManifestoBruto };

const RE_INDICE = /^gold\/clima\/abertura_indice_[0-9a-f]{12}\.json$/;
const RE_ARQUIVO = /^gold\/clima\/abertura_[0-9a-f]{12}\.ndjson$/;
const RE_HEX = /^[0-9a-f]+$/;
const ehInteiroPositivo = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

/** Falha de formato/versão: o pacote não é confiável (não adianta tentar de novo nesta sessão). */
export class AberturaInvalida extends Error {}

export function anuncioDoManifesto(m: ManifestoBruto): Anuncio | null {
  const clima = m.fontes?.clima as { ate?: number; painel?: { sha256?: string; ate?: number }; abertura?: Partial<Anuncio> } | undefined;
  const a = clima?.abertura;
  if (!clima || !a || a.versao !== 1) return null;
  if (typeof a.indice !== 'string' || !RE_INDICE.test(a.indice) || typeof a.arquivo !== 'string' || !RE_ARQUIVO.test(a.arquivo)) return null;
  if (typeof a.snapshot !== 'string' || a.snapshot.length !== 12 || !RE_HEX.test(a.snapshot) || !a.arquivo.endsWith(`${a.snapshot}.ndjson`)) return null;
  if (typeof a.sha256 !== 'string' || typeof a.indice_sha256 !== 'string' || !a.indice.endsWith(`${a.indice_sha256.slice(0, 12)}.json`)) return null;
  if (!ehInteiroPositivo(a.bytes) || !ehInteiroPositivo(a.indice_bytes) || !ehInteiroPositivo(a.grupos)) return null;
  // o pacote só vale para o MESMO último mês e o MESMO painel.parquet que o manifesto anuncia
  if (a.ate !== clima.ate || !a.painel_sha256 || a.painel_sha256 !== clima.painel?.sha256) return null;
  return a as Anuncio;
}

export function validarIndice(i: unknown, a: Anuncio, ate: number | undefined): Indice {
  const x = i as Partial<Indice> | null;
  const falha = (m: string) => new AberturaInvalida(`índice do clima inválido: ${m}`);
  if (!x || typeof x !== 'object') throw falha('não é objeto');
  if (x.versao !== 1) throw falha('versão');
  if (x.snapshot !== a.snapshot || x.sha256 !== a.sha256 || x.bytes !== a.bytes || x.ate !== a.ate || x.ate !== ate) throw falha('diverge do manifesto (outro snapshot)');
  if (x.arquivo !== a.arquivo.split('/').pop()) throw falha('arquivo');
  if (!Array.isArray(x.colunas) || x.colunas[0] !== 'variavel' || x.colunas.some((c) => typeof c !== 'string') || new Set(x.colunas).size !== x.colunas.length) throw falha('colunas');
  if (!Array.isArray(x.grupos) || !Array.isArray(x.tamanhos) || x.grupos.length !== x.tamanhos.length || x.grupos.length !== a.grupos) throw falha('grupos');
  if (new Set(x.grupos).size !== x.grupos.length || x.grupos.some((g) => typeof g !== 'string' || !/^([A-Z]{2}|\d{7})$/.test(g))) throw falha('chaves de grupo');
  if (x.tamanhos.some((n) => !ehInteiroPositivo(n)) || x.tamanhos.reduce((s, n) => s + n, 0) !== a.bytes) throw falha('tamanhos');
  if (!Array.isArray(x.territorios) || x.territorios.some((t) => !Array.isArray(t) || t.length !== 3 || !Number.isInteger(t[0]) || typeof t[1] !== 'string' || typeof t[2] !== 'string')) throw falha('territórios');
  if (!Array.isArray(x.catalogo)) throw falha('catálogo');
  return x as Indice;
}

const hexDe = async (dados: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', dados))].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256Padrao = () => (typeof crypto !== 'undefined' && crypto.subtle ? hexDe : undefined);

/** Uma linha do pacote: valida grupo, snapshot e forma, e devolve as linhas no formato do painel.parquet (uma por variável). */
export function lerLinhaGrupo(bytes: Uint8Array, grupo: string, esperadoBytes: number, snapshot: string, colunas: string[]): LinhaResumo[] {
  const ruim = (m: string) => new Error(`trecho do clima inválido (${grupo}): ${m}`);
  if (bytes.byteLength !== esperadoBytes) throw ruim(`${bytes.byteLength} bytes em vez de ${esperadoBytes}`);
  if (bytes[bytes.byteLength - 1] !== 0x0a) throw ruim('sem fim de linha');
  const texto = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const o = JSON.parse(texto) as { g?: string; s?: string; r?: unknown };
  if (o.g !== grupo || o.s !== snapshot || !Array.isArray(o.r)) throw ruim('grupo ou snapshot diferente do índice');
  const linhas = o.r.map((r) => {
    if (!Array.isArray(r) || r.length !== colunas.length || typeof r[0] !== 'string') throw ruim('linha malformada');
    const l: LinhaResumo = { grupo };
    colunas.forEach((c, i) => {
      const v = r[i];
      if (v !== null && typeof v !== 'number' && typeof v !== 'string') throw ruim('valor inválido');
      l[c] = v;
    });
    return l;
  });
  if (new Set(linhas.map((l) => l.variavel)).size !== linhas.length) throw ruim('variável repetida');
  return linhas.sort((a, b) => (a.variavel! < b.variavel! ? -1 : a.variavel! > b.variavel! ? 1 : 0));
}

export function criarAbertura(dep: Dependencias) {
  const avisar = dep.avisar ?? ((m: string, e?: unknown) => console.warn(m, e));
  let indice: Promise<IndiceLido | null> | null = null;
  let estado: 'indefinido' | 'rapido' | 'motor' = 'indefinido';

  async function carregarIndice(): Promise<IndiceLido | null> {
    const manifesto = await dep.manifesto();
    const anuncio = anuncioDoManifesto(manifesto);
    if (!anuncio) return null; // sem pacote publicado: caminho antigo
    const r = await dep.buscar(dep.url(anuncio.indice, manifesto));
    if (!r.ok) throw new Error(`índice do clima indisponível (${r.status})`);
    const bruto = await r.arrayBuffer();
    if (bruto.byteLength !== anuncio.indice_bytes) throw new AberturaInvalida('índice do clima com tamanho diferente do manifesto');
    const sha = dep.sha256 ?? sha256Padrao();
    if (sha && (await sha(bruto)) !== anuncio.indice_sha256) throw new AberturaInvalida('índice do clima com hash diferente do manifesto');
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bruto));
    } catch {
      throw new AberturaInvalida('índice do clima ilegível');
    }
    const lido = validarIndice(json, anuncio, (manifesto.fontes?.clima as { ate?: number }).ate);
    const deslocamentos = new Map<string, [number, number]>();
    let off = 0;
    lido.grupos.forEach((g, k) => { deslocamentos.set(g, [off, lido.tamanhos[k]]); off += lido.tamanhos[k]; });
    return { indice: lido, deslocamentos, anuncio, manifesto };
  }

  /** O índice de uma sessão: erro de rede tenta de novo na próxima chamada; formato inválido não (sem laço). */
  function obterIndice(): Promise<IndiceLido | null> {
    const p = (indice ??= carregarIndice());
    p.catch((e) => {
      if (!(e instanceof AberturaInvalida) && indice === p) indice = null;
    });
    return p;
  }

  async function trecho(l: IndiceLido, grupo: string): Promise<LinhaResumo[]> {
    const pos = l.deslocamentos.get(grupo);
    if (!pos) return []; // grupo fora do pacote (ex.: município que a grade não cobre): sem dados, nunca zeros
    const [ini, n] = pos;
    const fim = ini + n - 1;
    const r = await dep.buscar(dep.url(l.anuncio.arquivo, l.manifesto), { headers: { Range: `bytes=${ini}-${fim}` } });
    if (r.status !== 206) {
      void r.body?.cancel?.();
      throw new Error(`o servidor não respondeu ao intervalo pedido (${r.status})`);
    }
    const cr = r.headers.get('Content-Range');
    if (cr !== null && cr !== `bytes ${ini}-${fim}/${l.anuncio.bytes}`) throw new Error(`Content-Range inesperado: ${cr}`);
    return lerLinhaGrupo(new Uint8Array(await r.arrayBuffer()), grupo, n, l.indice.snapshot, l.indice.colunas);
  }

  function recuo(msg: string, e?: unknown): typeof USAR_MOTOR {
    estado = 'motor';
    avisar(msg, e);
    return USAR_MOTOR;
  }

  async function meta(): Promise<ClimaMeta> {
    const m = await dep.manifesto();
    const c = m.fontes?.clima as { anos?: number[]; ate?: number; normal?: number[]; processado_em?: string } | undefined;
    return {
      anos: c?.anos ?? [], ate: c?.ate ?? null, normal: c?.normal?.length === 2 ? [c.normal[0], c.normal[1]] : null,
      processado_em: c?.processado_em ?? null, gerado_em: m.gerado_em, abertura: anuncioDoManifesto(m) !== null,
    };
  }

  /** Rotas iniciais. USAR_MOTOR = o pacote não está disponível ou falhou: a rota segue pelo caminho completo (DuckDB). */
  async function executar(caminho: string, params: Record<string, string | number | null | undefined>): Promise<unknown> {
    if (caminho === 'clima_meta') return meta(); // só o manifesto: erro de rede é erro honesto
    if (caminho !== 'clima_territorios' && caminho !== 'clima_painel') return USAR_MOTOR;
    try {
      const l = await obterIndice();
      if (!l) return recuo('o manifesto não anuncia o pacote de abertura do clima; usando o caminho completo (mais lento)');
      if (caminho === 'clima_territorios') {
        estado = 'rapido';
        return l.indice.territorios.map(([cod, nome, uf]) => ({ cod, nome, uf }));
      }
      const cod = Number(params.cod);
      const uf = String(params.uf ?? '');
      const grupo = Number.isInteger(cod) && cod > 0 ? String(cod) : /^[A-Z]{2}$/.test(uf) && l.deslocamentos.has(uf) ? uf : 'BR';
      const linhas = await trecho(l, grupo);
      estado = 'rapido';
      return { origem: 'abertura', linhas };
    } catch (e) {
      return recuo('abertura rápida do clima indisponível; usando o caminho completo (mais lento)', e);
    }
  }

  return { executar, estado: () => estado };
}
