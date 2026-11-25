import { buscarDados as fetch } from './buscar_dados';
/** Séries e listas prontas: leitura parcial, edição fixada e ausência explícita. */
import { BASE_DADOS } from "./manifesto";
import { UF_NOMES } from "./ufs";
import { permiteAgregadoHistorico } from "./cadunico_historico";

export type AreaComparacao =
  | "assistencia"
  | "educacao"
  | "saude"
  | "trabalho"
  | "saneamento"
  | "financas"
  | "clima"
  | "agropecuaria"
  | "mobilidade"
  | "seguranca"
  | "comex"
  | "energia"
  | "internet"
  | "gestao";
export type ObjetoComparacao = {
  caminho: string;
  bytes: number;
  sha256: string;
};
type Trecho = [number, number, string];
export type DefComparacao = {
  id: string;
  nome: string;
  nome_en: string;
  descricao: string;
  descricao_en: string;
  tema: string;
  tema_en: string;
  unidade: string;
  unidade_en: string;
  formato: string;
  periodos: number[];
  periodos_com_valor?: number[];
  frequencia: "mensal" | "anual";
  metodo_referencia: "razao" | "mediana" | "area" | "resposta";
  normalizacao: string;
  normalizacao_en: string;
  fator: number;
  ranking: boolean;
  binario?: boolean;
  indice_lista?: ObjetoComparacao;
  minimo?: number;
  base_ipca?: number;
  precos?: string;
  anos_base_demografica?: Record<string, number | null>;
  nome_original?: string;
  nome_original_en?: string;
  unidade_original?: string;
  unidade_original_en?: string;
  fonte_nome: string;
  fontes: { nome: string; url: string }[];
  alerta?: string;
  alerta_en?: string;
  notas_anos?: Record<string, [string, string]>;
  marcador?: Record<string, string>;
  avaliacao?: boolean;
  edicoes?: unknown[];
  historico_cadunico?: boolean;
  ufs_historico?: string[];
  ufs_agregados_historico?: string[];
  ultimo_periodo_uf?: Record<string, number>;
  cobertura_titulo?: string;
  cobertura_titulo_en?: string;
  cobertura_nota?: string;
  cobertura_nota_en?: string;
};
export type SerieComparacao = {
  v: (number | null)[];
  n: (number | null)[];
  d: (number | null)[];
  c: number[];
  q: number[];
  e?: number[];
  r?: (number | null)[];
  com_ressalvas?: SerieComparacao;
};
export type GrupoComparacao = {
  versao: 1;
  area: AreaComparacao;
  rede: string;
  grupo: string;
  indicadores: string[];
  quantidade: number;
  dados: SerieComparacao[];
};
export type MunicipioComparacao = [number, string, string, string, string];
export type TerritorioComparacao = {
  nome: string;
  nivel: string;
  uf: string | null;
  cod: string | number;
  imediata?: string;
  intermediaria?: string;
};
export type GeografiaComparacao = {
  versao: 1;
  municipios: MunicipioComparacao[];
  governos: [string, string, string][];
  territorios: Record<string, TerritorioComparacao>;
  fonte: string;
  ano_divisao: number;
  observacao: string;
};
export type CatalogoComparacao = {
  versao: 1;
  area: AreaComparacao;
  rede: string;
  geografia: ObjetoComparacao;
  indicadores: DefComparacao[];
  indices: Record<string, ObjetoComparacao>;
  quantidades: Record<string, number>;
  downloads_historico?: (ObjetoComparacao & { formato: 'csv' | 'parquet' | 'dta' })[];
  dicionario_historico?: ObjetoComparacao;
};

/** Downloads completos são opcionais e nunca são buscados ao abrir o painel. */
export function enderecoDownloadHistorico(o: ObjetoComparacao): string {
  if (!/^gold\/comparacoes\/cadunico_historico_[a-z0-9_]+\.(csv|parquet|dta|json)$/.test(o?.caminho) ||
      !/^[a-f0-9]{64}$/.test(o?.sha256) || !Number.isSafeInteger(o?.bytes) || o.bytes < 1)
    throw new Error('Arquivo do histórico inválido.');
  return `${BASE_DADOS}${o.caminho}`;
}
type ManifestoComparacao = {
  versao: 1;
  geografia: ObjetoComparacao;
  catalogos: Record<string, ObjetoComparacao>;
  origens: Record<string, { sha256: string; bytes: number; etag?: string }>;
  compatibilidade_global?: Partial<
    Record<AreaComparacao, CompatibilidadeGlobal>
  >;
};

type CompatibilidadeGlobal = { fontes: string[]; json_referencia: string };

/** Uma retificação fiscal não altera as fontes de Saúde, Trabalho ou Assistência. */
export function fontesGlobaisCompativeis(
  manifesto: unknown,
  referencia: CompatibilidadeGlobal,
): boolean {
  try {
    if (
      !referencia ||
      !Array.isArray(referencia.fontes) ||
      !referencia.fontes.length ||
      referencia.fontes.some((k) => typeof k !== "string" || !k) ||
      !manifesto ||
      typeof manifesto !== "object" ||
      Array.isArray(manifesto)
    )
      return false;
    const fontes = (manifesto as { fontes?: Record<string, unknown> }).fontes;
    if (!fontes || typeof fontes !== "object" || Array.isArray(fontes))
      return false;
    const volateis = new Set([
      "gerado_em",
      "geradoEm",
      "processado_em",
      "atualizado_em",
    ]);
    const ordenar = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(ordenar);
      if (v && typeof v === "object")
        return Object.fromEntries(
          Object.entries(v)
            .filter(([k]) => !volateis.has(k))
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
            .map(([k, x]) => [k, ordenar(x)]),
        );
      return v;
    };
    const esperado = JSON.parse(referencia.json_referencia);
    if (!esperado || typeof esperado !== "object" || Array.isArray(esperado))
      return false;
    const atual = Object.fromEntries(
      referencia.fontes.map((k) => [k, fontes[k] ?? null]),
    );
    return JSON.stringify(ordenar(atual)) === JSON.stringify(ordenar(esperado));
  } catch {
    return false;
  }
}
type IndiceGrupo = {
  versao: 1;
  area: AreaComparacao;
  rede: string;
  arquivo: ObjetoComparacao;
  grupos: Record<string, Trecho>;
};
type IndiceLista = {
  versao: 1;
  area: AreaComparacao;
  rede: string;
  indicador: string;
  arquivo: ObjetoComparacao;
  recortes: Record<string, Trecho>;
};
type CargaLista = {
  versao: 1;
  area: AreaComparacao;
  rede: string;
  indicador: string;
  periodo: number;
  uf: string;
  quantidade: number;
  v: (number | null)[];
  n: (number | null)[];
  d: (number | null)[];
  c: number[];
  r: (number | null)[];
};
export type LinhaComparacao = {
  cod: number;
  nome: string;
  uf: string;
  imediata: string;
  intermediaria: string;
  grupo?: string;
  nivel?: string;
  q?: number;
  total?: number;
  v: number | null;
  n: number | null;
  d: number | null;
  c: number;
  r: number | null;
};

const cache = new Map<string, Promise<unknown>>();
function memo<T>(chave: string, obter: () => Promise<T>): Promise<T> {
  let p = cache.get(chave) as Promise<T> | undefined;
  if (!p) {
    p = obter();
    cache.set(chave, p);
    p.catch(() => {
      if (cache.get(chave) === p) cache.delete(chave);
    });
  }
  return p;
}
const hashValido = (s: string) => /^[a-f0-9]{64}$/.test(s);
const digest = async (b: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", b)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
function validarObjeto(o: ObjetoComparacao) {
  if (
    !o ||
    !/^gold\/comparacoes\/[a-z0-9_]+\.(json|ndjson)$/.test(o.caminho) ||
    !hashValido(o.sha256) ||
    !Number.isSafeInteger(o.bytes) ||
    o.bytes < 1
  )
    throw new Error("Referência de comparação inválida.");
}
async function ler<T>(o: ObjetoComparacao): Promise<T> {
  validarObjeto(o);
  const r = await fetch(`${BASE_DADOS}${o.caminho}`);
  if (!r.ok) throw new Error("Arquivo de comparação indisponível.");
  const b = await r.arrayBuffer();
  if (b.byteLength !== o.bytes || (await digest(b)) !== o.sha256)
    throw new Error("Arquivo de comparação incompleto.");
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b)) as T;
}
function manifesto(): Promise<ManifestoComparacao> {
  return memo("manifesto", async () => {
    const r = await fetch(`${BASE_DADOS}gold/comparacoes/manifesto.json`, {
      cache: "no-cache",
    });
    if (!r.ok)
      throw new Error("As comparações prontas ainda não estão disponíveis.");
    const m = (await r.json()) as ManifestoComparacao;
    if (m.versao !== 1 || !m.catalogos || !m.origens)
      throw new Error("Edição de comparação inválida.");
    validarObjeto(m.geografia);
    return m;
  });
}
export function obterComparacoes(
  area: AreaComparacao,
  rede = "todas",
): Promise<CatalogoComparacao> {
  return memo(`catalogo:${area}:${rede}`, async () => {
    const raiz = await manifesto(),
      ref = raiz.catalogos[`${area}_${rede}`];
    if (!ref) throw new Error("Recorte de comparação indisponível.");
    const m = await ler<CatalogoComparacao>(ref);
    if (
      m.versao !== 1 ||
      m.area !== area ||
      m.rede !== rede ||
      m.geografia.sha256 !== raiz.geografia.sha256 ||
      !Array.isArray(m.indicadores) ||
      !m.indices ||
      !m.quantidades
    )
      throw new Error("Catálogo de outra área ou edição.");
    const ids = new Set<string>();
    if (m.downloads_historico) {
      if (area !== 'assistencia' || rede !== 'cadunico_historico' || !Array.isArray(m.downloads_historico) ||
          m.downloads_historico.length !== 3 || new Set(m.downloads_historico.map(x => x.formato)).size !== 3)
        throw new Error('Downloads do histórico inválidos.');
      for (const o of m.downloads_historico) {
        if (!['csv', 'parquet', 'dta'].includes(o.formato) || !o.caminho.endsWith('.' + o.formato)) throw new Error('Formato do histórico inválido.');
        enderecoDownloadHistorico(o);
      }
      if (!m.dicionario_historico) throw new Error('Dicionário do histórico ausente.');
      enderecoDownloadHistorico(m.dicionario_historico);
    }
    for (const i of m.indicadores) {
      if (
        !/^[a-z][a-z0-9_]*$/.test(i.id) ||
        ids.has(i.id) ||
        !i.nome ||
        !i.nome_en ||
        !i.unidade ||
        !["razao", "mediana", "area", "resposta"].includes(
          i.metodo_referencia,
        ) ||
        !Array.isArray(i.periodos) ||
        i.periodos.some(
          (p, k) => !Number.isInteger(p) || (k > 0 && p <= i.periodos[k - 1]),
        ) ||
        (i.periodos_com_valor !== undefined &&
          (!Array.isArray(i.periodos_com_valor) ||
            i.periodos_com_valor.some(
              (p, k) =>
                !i.periodos.includes(p) ||
                (k > 0 && p <= i.periodos_com_valor![k - 1]),
            )))
      )
        throw new Error("Indicador de comparação inválido.");
      ids.add(i.id);
      if (i.indice_lista) validarObjeto(i.indice_lista);
    }
    // Revalida só as fontes deste painel. Uma nova edição nunca é misturada
    // silenciosamente com referências antigas; outras áreas não bloqueiam esta.
    const chaves =
      area === 'assistencia' && rede === 'cadunico_historico'
        ? [] // Catálogo independente, com distribuições Seade e cotejo MDS fixados por hash.
        : area === "comex"
        ? ["gold/comex/manifesto.json"]
        : area === "energia"
        ? ["gold/energia/manifesto.json"]
        : area === "internet"
        ? ["gold/internet/manifesto.json"]
        : area === "seguranca"
        ? ["gold/seguranca/manifesto.json"]
        : area === "mobilidade"
        ? ["gold/mobilidade/manifesto.json"]
        : area === "agropecuaria"
        ? ["gold/agropecuaria/manifesto.json"]
        : area === "gestao"
        ? ["gold/munic/painel_respostas.parquet"]
        : area === "clima"
          ? [
              "gold/clima/anual.parquet",
              "gold/clima/territorio.parquet",
              "gold/clima/catalogo.parquet",
            ]
          : area === "financas"
            ? ["gold/downloads/manifesto.json"]
            : area === "assistencia"
              ? ["gold/manifesto.json"]
              : [
                  `gold/mapas/${area}_manifesto.json`,
                  ...(area === "saude" || area === "trabalho"
                    ? ["gold/manifesto.json"]
                    : [`gold/${area}/manifesto.json`]),
                  ...(area === "saude"
                    ? [
                        "gold/saude/municipios.parquet",
                        "gold/saude/vacinacao.parquet",
                        "gold/saude/vacinacao_catalogo.parquet",
                        "gold/saude/fns_municipios.parquet",
                      ]
                    : []),
                ];
    await Promise.all(
      chaves
        .filter((k) => raiz.origens[k])
        .map((k) =>
          memo(`origem:${area}:${k}`, async () => {
            const origem = raiz.origens[k];
            const resposta = await fetch(`${BASE_DADOS}${k}`, {
              cache: "no-cache",
              ...(origem.etag ? { method: "HEAD" } : {}),
            });
            let ok = resposta.ok;
            if (ok && origem.etag) {
              ok =
                resposta.headers.get("ETag") === origem.etag &&
                Number(resposta.headers.get("Content-Length")) === origem.bytes;
            } else if (ok) {
              const bytes = await resposta.arrayBuffer();
              const compatibilidade =
                k === "gold/manifesto.json"
                  ? raiz.compatibilidade_global?.[area]
                  : undefined;
              if (compatibilidade) {
                try {
                  ok = fontesGlobaisCompativeis(
                    JSON.parse(new TextDecoder().decode(bytes)),
                    compatibilidade,
                  );
                } catch {
                  ok = false;
                }
              } else ok = (await digest(bytes)) === origem.sha256;
            }
            if (!ok)
              throw new Error(
                "A fonte foi atualizada. As comparações precisam ser preparadas para a nova edição.",
              );
            return true;
          }),
        ),
    );
    return m;
  });
}
export function obterGeografiaComparacao(
  m: CatalogoComparacao,
): Promise<GeografiaComparacao> {
  return memo(m.geografia.sha256, async () => {
    const g = await ler<GeografiaComparacao>(m.geografia);
    if (
      g.versao !== 1 ||
      g.municipios.length !== 5571 ||
      new Set(g.municipios.map((x) => x[0])).size !== g.municipios.length ||
      !g.territorios.BR
    )
      throw new Error("Geografia de comparação inválida.");
    return g;
  });
}
async function trecho(o: ObjetoComparacao, tr: Trecho): Promise<unknown[]> {
  validarObjeto(o);
  if (
    !tr ||
    tr.length !== 3 ||
    !Number.isSafeInteger(tr[0]) ||
    tr[0] < 0 ||
    !Number.isSafeInteger(tr[1]) ||
    tr[1] < 1 ||
    tr[0] + tr[1] > o.bytes ||
    !hashValido(tr[2])
  )
    throw new Error("Trecho de comparação inválido.");
  const [inicio, bytes, hash] = tr;
  const r = await fetch(`${BASE_DADOS}${o.caminho}`, {
    headers: { Range: `bytes=${inicio}-${inicio + bytes - 1}` },
  });
  if (
    r.status !== 206 ||
    r.headers.get("Content-Range") !==
      `bytes ${inicio}-${inicio + bytes - 1}/${o.bytes}`
  ) {
    await r.body?.cancel();
    throw new Error("O servidor não forneceu o recorte solicitado.");
  }
  const b = await r.arrayBuffer();
  if (b.byteLength !== bytes || (await digest(b)) !== hash)
    throw new Error("Recorte de comparação incompleto.");
  const s = new TextDecoder("utf-8", { fatal: true }).decode(b);
  if (!s.endsWith("\n")) throw new Error("Recorte truncado.");
  return s
    .trimEnd()
    .split("\n")
    .map((l) => JSON.parse(l));
}
const finito = (x: unknown) =>
  x === null || (typeof x === "number" && Number.isFinite(x));
export function validarSerieComparacao(
  s: SerieComparacao,
  tamanho: number,
  quantidade: number,
  agregadoPublicado = false,
  coberturaMunicipalConhecida = false,
) {
  for (const a of [s.v, s.n, s.d, s.r].filter((a) => a !== undefined))
    if (!Array.isArray(a) || a.length !== tamanho || a.some((x) => !finito(x)))
      throw new Error("Série incompleta.");
  if (
    !Array.isArray(s.c) ||
    s.c.length !== tamanho ||
    s.c.some((c) => !Number.isInteger(c) || c < 0 || c > 24 || c === 22 && !agregadoPublicado) ||
    !Array.isArray(s.q) ||
    s.q.length !== tamanho ||
    s.q.some((q) => !Number.isInteger(q) || q < 0 || q > quantidade)
  )
    throw new Error("Condições ou cobertura incompletas.");
  if(s.e!==undefined&&(!Array.isArray(s.e)||s.e.length!==tamanho||s.e.some((e,k)=>!Number.isSafeInteger(e)||e<0||e>quantidade||e<s.q[k])))
    throw new Error("Quantidade esperada de territórios inválida.");
  if (
    s.v.some(
      (v, k) =>
        ([23,24].includes(s.c[k]) && v !== null) || (s.c[k] === 1 && v !== 0) ||
        (v === null && [0, 1, 6, 11, 12, 16, 18, 22].includes(s.c[k])) ||
        (s.c[k] === 22 && ((!coberturaMunicipalConhecida && s.q[k] !== 0) || s.n[k] === null || s.d[k] === null || s.d[k]! <= 0)),
    )
  )
    throw new Error("Valor e condição divergentes.");
  if (s.com_ressalvas)
    validarSerieComparacao(s.com_ressalvas, tamanho, quantidade, agregadoPublicado, coberturaMunicipalConhecida);
}
/** PAM/PPM tem componentes oficiais e, separadamente, cobertura municipal conhecida. */
export const permiteAgregadoPublicado = (area:AreaComparacao,rede:string,nivel:string,id:string) =>
  area==='agropecuaria'&&['UF','BR'].includes(nivel)||permiteAgregadoHistorico(area,rede,nivel,id);
export function obterGrupoComparacao(
  m: CatalogoComparacao,
  g: GeografiaComparacao,
  grupo: string,
): Promise<GrupoComparacao> {
  return memo(
    `grupo:${m.area}:${m.rede}:${m.indices.BR?.sha256 ?? m.indices.referencias?.sha256}:${grupo}`,
    async () => {
      const terr = g.territorios[grupo];
      if (!terr || !m.quantidades[grupo])
        throw new Error("Território fora deste universo.");
      const bucket = terr.nivel === "M" ? terr.uf! : "referencias",
        ref = m.indices[bucket];
      const idx = await memo(ref.sha256, () => ler<IndiceGrupo>(ref));
      if (idx.versao !== 1 || idx.area !== m.area || idx.rede !== m.rede)
        throw new Error("Índice de outra edição.");
      const linhas = await trecho(idx.arquivo, idx.grupos[grupo]);
      const x = linhas[0] as GrupoComparacao;
      if (
        linhas.length !== 1 ||
        x.versao !== 1 ||
        x.area !== m.area ||
        x.rede !== m.rede ||
        x.grupo !== grupo ||
        x.quantidade !== m.quantidades[grupo] ||
        x.indicadores.join("|") !== m.indicadores.map((i) => i.id).join("|") ||
        x.dados.length !== m.indicadores.length
      )
        throw new Error("Série de outro território, indicador ou edição.");
      x.dados.forEach((s, k) =>
        validarSerieComparacao(
          s,
          m.indicadores[k].periodos.length,
          x.quantidade,
          permiteAgregadoPublicado(m.area, m.rede, terr.nivel, m.indicadores[k].id),
          m.area==='agropecuaria'&&['UF','BR'].includes(terr.nivel),
        ),
      );
      if (!["M", "E"].includes(terr.nivel))
        x.dados.forEach((s) => {
          // Soma de um conjunto vazio é zero matemático, mas não é um componente
          // observado. Na consulta e exportação, referência sem base fica em branco.
          for (const y of [s, ...(s.com_ressalvas ? [s.com_ressalvas] : [])]) {
            y.n = y.n.map((v, k) => (y.q[k] === 0 && y.c[k] !== 22 ? null : v));
            y.d = y.d.map((v, k) => (y.q[k] === 0 && y.c[k] !== 22 ? null : v));
          }
        });
      return x;
    },
  );
}
export function obterListaComparacao(
  m: CatalogoComparacao,
  i: DefComparacao,
  periodo: number,
  uf: string,
): Promise<LinhaComparacao[]> {
  return memo(`lista:${i.indice_lista?.sha256}:${periodo}:${uf}`, async () => {
    if (
      !i.indice_lista ||
      !i.periodos.includes(periodo) ||
      (uf !== "BR" && !Object.hasOwn(UF_NOMES, uf))
    )
      throw new Error("Lista não disponível neste período ou recorte.");
    const [g, idx] = await Promise.all([
      obterGeografiaComparacao(m),
      memo(i.indice_lista.sha256, () => ler<IndiceLista>(i.indice_lista!)),
    ]);
    if (
      idx.versao !== 1 ||
      idx.area !== m.area ||
      idx.rede !== m.rede ||
      idx.indicador !== i.id
    )
      throw new Error("Índice de outro indicador.");
    const cargas = (await trecho(
        idx.arquivo,
        idx.recortes[`${periodo}:${uf}`],
      )) as CargaLista[],
      ufs = uf === "BR" ? Object.keys(UF_NOMES).sort() : [uf];
    if (cargas.length !== ufs.length || cargas.some((x, k) => x.uf !== ufs[k]))
      throw new Error("Lista de estados incompleta.");
    return cargas.flatMap((x) => {
      const cidades = g.municipios.filter((c) => c[2] === x.uf),
        n = cidades.length;
      if (
        x.versao !== 1 ||
        x.area !== m.area ||
        x.rede !== m.rede ||
        x.indicador !== i.id ||
        x.periodo !== periodo ||
        x.quantidade !== n ||
        [x.v, x.n, x.d, x.r].some(
          (a) =>
            !Array.isArray(a) || a.length !== n || a.some((v) => !finito(v)),
        ) ||
        x.c.length !== n ||
        x.c.some((c) => !Number.isInteger(c) || c < 0 || c > 24 || c === 22)
      )
        throw new Error("Lista de outro período ou edição.");
      return cidades.map(([cod, nome, estado, im, inter], k) => ({
        cod,
        nome,
        uf: estado,
        imediata: `I:${im}`,
        intermediaria: `T:${inter}`,
        v: x.v[k],
        n: x.n[k],
        d: x.d[k],
        c: x.c[k],
        r: x.r[k],
      }));
    });
  });
}
type CargaReferencias = {
  versao: 1;
  area: AreaComparacao;
  rede: string;
  indicador: string;
  periodo: number;
  nivel: string;
  grupos: string[];
  quantidade: number;
} & SerieComparacao;
export function obterListaReferencias(
  m: CatalogoComparacao,
  i: DefComparacao,
  periodo: number,
  nivel: "UF" | "imediata" | "intermediaria",
  ressalvas: boolean,
): Promise<LinhaComparacao[]> {
  return memo(
    `lista-ref:${i.indice_lista?.sha256}:${periodo}:${nivel}:${ressalvas}`,
    async () => {
      if (!i.indice_lista || !i.periodos.includes(periodo))
        throw new Error("Lista de referências indisponível.");
      const [g, idx] = await Promise.all([
        obterGeografiaComparacao(m),
        memo(i.indice_lista.sha256, () => ler<IndiceLista>(i.indice_lista!)),
      ]);
      if (
        idx.versao !== 1 ||
        idx.area !== m.area ||
        idx.rede !== m.rede ||
        idx.indicador !== i.id
      )
        throw new Error("Índice de outro indicador.");
      const linhas = await trecho(
        idx.arquivo,
        idx.recortes[`${periodo}:${nivel}`],
      );
      const x = linhas[0] as CargaReferencias;
      const keys = Object.keys(g.territorios)
        .filter((k) => g.territorios[k].nivel === nivel)
        .sort();
      if (
        linhas.length !== 1 ||
        x.versao !== 1 ||
        x.area !== m.area ||
        x.rede !== m.rede ||
        x.indicador !== i.id ||
        x.periodo !== periodo ||
        x.nivel !== nivel ||
        x.grupos?.join("|") !== keys.join("|") ||
        x.quantidade !== keys.length ||
        [x.v, x.n, x.d].some(
          (a) =>
            !Array.isArray(a) ||
            a.length !== keys.length ||
            a.some((v) => !finito(v)),
        ) ||
        x.c.length !== keys.length ||
        x.q.length !== keys.length
      )
        throw new Error("Lista de referências de outra edição ou recorte.");
      const s = ressalvas && x.com_ressalvas ? x.com_ressalvas : x;
      if (
        [s.v, s.n, s.d, s.c, s.q].some(
          (a) => !Array.isArray(a) || a.length !== keys.length,
        ) ||
        s.v.some((v) => !finito(v))
      )
        throw new Error("Valores de referências incompletos.");
      if (s.c.includes(22)) {
        if (!permiteAgregadoPublicado(m.area, m.rede, nivel, i.id))
          throw new Error('Agregado publicado fora do contexto histórico.');
        validarSerieComparacao(s, keys.length, Math.max(...keys.map(key => m.quantidades[key])), true, m.area==='agropecuaria'&&nivel==='UF');
      }
      return keys.map((key, k) => {
        const ter = g.territorios[key];
        return {
          cod:
            nivel === "UF"
              ? Number(g.governos.find((x) => x[2] === key)?.[0].slice(2))
              : Number(key.slice(2)),
          nome: ter.nome,
          uf: ter.uf!,
          imediata: "",
          intermediaria: ter.intermediaria ?? "",
          grupo: key,
          nivel,
          q: s.q[k],
          total: m.quantidades[key],
          v: s.v[k],
          n: s.q[k] === 0 && s.c[k] !== 22 ? null : s.n[k],
          d: s.q[k] === 0 && s.c[k] !== 22 ? null : s.d[k],
          c: s.c[k],
          r: null,
        };
      });
    },
  );
}
