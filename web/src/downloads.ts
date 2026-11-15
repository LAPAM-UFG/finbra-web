/**
 * Central de downloads municipais: tipos, validação do manifesto e do dicionário, filtros e formatação.
 * Sem React e sem rede: a página (pages/Downloads.tsx) busca os JSON e usa estas funções. Só o que passa pela validação vira link:
 * caminho sob gold/downloads/, sem "..", sem esquema, sem barra invertida e com sha256 válido.
 */
export const TIPOS = ['painel', 'area', 'detalhado', 'dicionario', 'pacote', 'metodologia'] as const;
export const FORMATOS = ['dta', 'rds', 'csv.zip', 'parquet', 'xlsx', 'zip', 'json', 'txt', 'do'] as const;
export type Tipo = (typeof TIPOS)[number];
export type Formato = (typeof FORMATOS)[number];

export type AreaDl = { id: string; nome: string; nome_en: string; descricao: string; descricao_en: string };
export type ReferenciaDl = { caminho: string; bytes: number; sha256: string };
export type ArquivoDl = {
  id: string; tipo: Tipo; area: string | null; nome: string; nome_en: string; descricao: string; descricao_en: string; formato: Formato;
  caminho: string; bytes: number; sha256: string; linhas: number | null; variaveis: number | null; ano_de: number | null; ano_ate: number | null; uf: string | null;
  bytes_extraido?: number;
  escopo?: 'principal' | 'detalhado';
  previa?: ReferenciaDl;
  conteudo?: FormatoBase;
};
export type ManifestoDl = {
  versao: 1; gerado_em: string; base_gerado_em: string; base_sha256: string; base_ipca: number;
  resumo: { municipios: number; ano_de: number; ano_ate: number; variaveis: number; linhas: number; variaveis_detalhadas: number };
  notas: string[]; areas: AreaDl[]; arquivos: ArquivoDl[];
  dicionario: { caminho: string; bytes: number; sha256: string };
  edicao?: 'enxuta_2013';
  stata?: { versao: number; minimo: number; painel_declarado: boolean; chave: string[] };
  recortes_uf?: Record<string, ReferenciaDl>;
};

export const PREFIXO = 'gold/downloads/';
const SHA = /^[0-9a-f]{64}$/i;
const CAMINHO = /^gold\/downloads\/[A-Za-z0-9._\-/]+$/;

/** Só caminhos relativos sob gold/downloads/, sem segmentos vazios, "." ou ".." (nem codificados), esquema, consulta ou âncora. */
export function caminhoSeguro(c: unknown): c is string {
  if (typeof c !== 'string' || !c.startsWith(PREFIXO) || !CAMINHO.test(c)) return false;
  return c.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && !/^\.+$/.test(s));
}

/** Endereço do arquivo, sempre dentro de gold/downloads/ da base de dados; nulo se escapar disso. */
export function urlArquivo(caminho: string, base: string): string | null {
  if (!caminhoSeguro(caminho)) return null;
  try {
    const u = new URL(caminho, base);
    const raiz = new URL(PREFIXO, base);
    return u.origin === raiz.origin && u.pathname.startsWith(raiz.pathname) && !u.search && !u.hash ? u.href : null;
  } catch {
    return null;
  }
}

const texto = (v: unknown): v is string => typeof v === 'string';
const natural = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const naturalOuNulo = (v: unknown): v is number | null => v === null || natural(v);
const anoOuNulo = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 1900 && v <= 2200);
const registro = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const referenciaValida = (v: unknown): v is ReferenciaDl => registro(v) && caminhoSeguro(v.caminho) && natural(v.bytes) && texto(v.sha256) && SHA.test(v.sha256);

/**
 * Valida o manifesto. Estrutura geral inválida: erro (a página mostra "Tentar de novo"). Arquivo individual inválido
 * (caminho, hash, tipo, formato, números): é descartado e contado, nunca vira link.
 */
export function validarManifesto(bruto: unknown): { manifesto: ManifestoDl; descartados: number } {
  const falha = (m: string) => new Error(`Manifesto inválido: ${m}`);
  if (!registro(bruto) || bruto.versao !== 1) throw falha('versão não suportada');
  if (bruto.parcial === true) throw falha('pacote ainda em preparação');
  const { resumo, areas, arquivos, dicionario, notas } = bruto;
  if (!texto(bruto.gerado_em) || !texto(bruto.base_gerado_em) || !texto(bruto.base_sha256) || !SHA.test(bruto.base_sha256) || !natural(bruto.base_ipca)) throw falha('cabeçalho');
  if (!registro(resumo) || !(['municipios', 'variaveis', 'linhas', 'variaveis_detalhadas'] as const).every((k) => natural(resumo[k])) || !anoOuNulo(resumo.ano_de) || !anoOuNulo(resumo.ano_ate)
    || resumo.ano_de === null || resumo.ano_ate === null) throw falha('resumo');
  if (bruto.edicao === 'enxuta_2013' && (resumo.ano_de < 2013 || (resumo.variaveis as number) > 300)) throw falha('recorte da base enxuta');
  if (!Array.isArray(areas) || !Array.isArray(arquivos) || !Array.isArray(notas)) throw falha('listas');
  if (!registro(dicionario) || !caminhoSeguro(dicionario.caminho) || !natural(dicionario.bytes) || !texto(dicionario.sha256) || !SHA.test(dicionario.sha256)) throw falha('dicionário');
  if (bruto.recortes_uf !== undefined && (!registro(bruto.recortes_uf) || Object.entries(bruto.recortes_uf).some(([uf, ref]) => !/^[A-Z]{2}$/.test(uf) || !referenciaValida(ref)))) throw falha('catálogos por UF');

  const areasOk: AreaDl[] = [];
  for (const a of areas) {
    if (registro(a) && texto(a.id) && a.id && texto(a.nome) && texto(a.nome_en) && texto(a.descricao) && texto(a.descricao_en) && !areasOk.some((x) => x.id === a.id)) areasOk.push(a as AreaDl);
  }
  const ids = new Set<string>();
  const ok: ArquivoDl[] = [];
  let descartados = 0;
  for (const f of arquivos) {
    const bom = registro(f) && texto(f.id) && f.id !== '' && !ids.has(f.id) && (TIPOS as readonly unknown[]).includes(f.tipo) && (FORMATOS as readonly unknown[]).includes(f.formato)
      && (f.area === null || (texto(f.area) && areasOk.some((a) => a.id === f.area))) && texto(f.nome) && f.nome !== '' && texto(f.nome_en) && texto(f.descricao) && texto(f.descricao_en)
      && caminhoSeguro(f.caminho) && natural(f.bytes) && texto(f.sha256) && SHA.test(f.sha256) && naturalOuNulo(f.linhas) && naturalOuNulo(f.variaveis)
      && (f.bytes_extraido === undefined || natural(f.bytes_extraido))
      && (f.escopo === undefined || f.escopo === 'principal' || f.escopo === 'detalhado')
      && (f.previa === undefined || referenciaValida(f.previa))
      && (f.conteudo === undefined || (FORMATOS_BASE as readonly unknown[]).includes(f.conteudo))
      && anoOuNulo(f.ano_de) && anoOuNulo(f.ano_ate) && (f.uf === null || (texto(f.uf) && /^[A-Z]{2}$/.test(f.uf)));
    const recorte = bruto.edicao !== 'enxuta_2013' || !registro(f) || !['painel', 'area', 'detalhado'].includes(String(f.tipo)) || (typeof f.ano_de === 'number' && f.ano_de >= 2013);
    if (bom && recorte) {
      ids.add((f as ArquivoDl).id);
      ok.push(f as ArquivoDl);
    } else descartados += 1;
  }
  return {
    manifesto: { ...(bruto as unknown as ManifestoDl), notas: notas.filter(texto), areas: areasOk, arquivos: ok },
    descartados,
  };
}

/* ---------- apresentação ---------- */

export const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tamanho legível (base 1024), com a vírgula ou o ponto do idioma. */
export function tamanho(bytes: number, loc: string): string {
  const un = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < un.length - 1) {
    v /= 1024;
    i += 1;
  }
  const casas = i === 0 || v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${new Intl.NumberFormat(loc, { minimumFractionDigits: casas === 2 && v % 1 === 0 ? 0 : casas, maximumFractionDigits: casas }).format(v)} ${un[i]}`;
}

/** Cobertura de anos do arquivo: um ano, uma faixa ou nada (nunca inventa o que o manifesto não diz). */
export const faixaAnos = (a: { ano_de: number | null; ano_ate: number | null; anos_observados?: number[] }): string | null => {
  if (a.anos_observados?.length) {
    const anos = [...new Set(a.anos_observados)].sort((x,y)=>x-y); const partes: string[] = [];
    for (let i=0;i<anos.length;i++) { let j=i;while (j+1<anos.length&&anos[j+1]===anos[j]+1)j++;partes.push(j>i?`${anos[i]}–${anos[j]}`:String(anos[i]));i=j; }
    return partes.join(', ');
  }
  return a.ano_de !== null && a.ano_ate !== null ? (a.ano_de === a.ano_ate ? String(a.ano_de) : `${a.ano_de}–${a.ano_ate}`) : a.ano_de !== null ? String(a.ano_de) : a.ano_ate !== null ? String(a.ano_ate) : null;
};

/** "DF" aqui é Brasília (5300108), que reúne as funções estadual e municipal; não é um estado repetido como município. */
export const COD_BRASILIA = '5300108';
export const COD_NORONHA = '2605459';

export type Filtro = { texto: string; area: string; uf: string };
export const filtroVazio: Filtro = { texto: '', area: '', uf: '' };

export function filtrarArquivos(arquivos: ArquivoDl[], f: Filtro, en: boolean): ArquivoDl[] {
  const termos = normalizar(f.texto).split(/\s+/).filter(Boolean);
  return arquivos.filter((a) => {
    if (f.area && a.area !== f.area) return false;
    if (f.uf && a.uf !== f.uf) return false;
    if (!termos.length) return true;
    const palha = normalizar(`${a.nome} ${a.nome_en} ${en ? a.descricao_en : a.descricao} ${a.formato} ${a.uf ?? ''} ${faixaAnos(a) ?? ''}`);
    return termos.every((t) => palha.includes(t));
  });
}

/* ---------- dicionário ---------- */

export type EntradaDic = {
  variavel: string; nome: string; descricao: string; area: string; fonte: string; unidade: string; tipo: string; regra_anual: string;
  ano_de: number | null; ano_ate: number | null; tabela: string; observacao: string;
  anos_observados?: number[];
  variavel_original?: string;
  arquivo_principal?: boolean;
  stata_rotulos?: Record<string, string>;
};
export type IndiceDic = { entradas: EntradaDic[]; textos: string[]; variaveis: string[] };

const s = (v: unknown) => (typeof v === 'string' ? v : '');

/** Entradas sem código de variável são descartadas; campos ausentes ficam vazios, nunca inventados. */
export function validarDicionario(bruto: unknown): EntradaDic[] {
  if (!Array.isArray(bruto)) throw new Error('Dicionário inválido: esperava uma lista');
  const saida: EntradaDic[] = [];
  for (const e of bruto) {
    if (!registro(e) || !texto(e.variavel) || !e.variavel) continue;
    saida.push({
      variavel: e.variavel, nome: s(e.nome), descricao: s(e.descricao), area: s(e.area), fonte: s(e.fonte), unidade: s(e.unidade), tipo: s(e.tipo), regra_anual: s(e.regra_anual),
      ano_de: anoOuNulo(e.ano_de) ? e.ano_de : null, ano_ate: anoOuNulo(e.ano_ate) ? e.ano_ate : null, tabela: s(e.tabela), observacao: s(e.observacao),
      variavel_original: s(e.variavel_original) || undefined,
      arquivo_principal: typeof e.arquivo_principal==='boolean' ? e.arquivo_principal : undefined,
      stata_rotulos: registro(e.stata_rotulos) ? Object.fromEntries(Object.entries(e.stata_rotulos).filter(([,v]) => typeof v === 'string')) as Record<string,string> : undefined,
      anos_observados: Array.isArray(e.anos_observados) ? e.anos_observados.filter((v): v is number => typeof v==='number'&&Number.isInteger(v)&&v>=1900&&v<=2200) : undefined,
    });
  }
  return saida;
}

export function indexarDicionario(entradas: EntradaDic[]): IndiceDic {
  return {
    entradas,
    variaveis: entradas.map((e) => normalizar(e.variavel)),
    textos: entradas.map((e) => {
      const original=e.variavel_original ?? e.variavel;
      const aliases=[/remuneracao|rem_media/.test(original) ? 'salário salário médio wages salary' : '', /^(soc_)?pbf_/.test(original) ? 'Bolsa Família' : '', /^(soc_)?cad_/.test(original) ? 'CadÚnico Cadastro Único' : '', /^(soc_)?bpc_/.test(original) ? 'Benefício de Prestação Continuada' : '', /pib/.test(original) ? 'Produto Interno Bruto GDP' : '', /raca/.test(original) ? 'raça cor etnia' : '', /escolar/.test(original) ? 'educação escolaridade estudo' : '', /rais_vinculo_mte_1_/.test(original) ? 'CLT celetista' : ''].join(' ');
      return normalizar(`${e.variavel} ${original} ${e.nome} ${e.descricao} ${e.fonte} ${e.unidade} ${e.tabela} ${aliases}`);
    }),
  };
}

/** Todos os termos precisam aparecer; quem tem o termo no código ou no nome da variável vem primeiro. */
export function filtrarDicionario(idx: IndiceDic, busca: string, area: string): EntradaDic[] {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  const primeiros: EntradaDic[] = [];
  const demais: EntradaDic[] = [];
  for (let i = 0; i < idx.entradas.length; i += 1) {
    const e = idx.entradas[i];
    if (!area && !termos.length && e.arquivo_principal===false) continue;
    if (area && e.area !== area) continue;
    if (termos.some((t) => !idx.textos[i].includes(t))) continue;
    (termos.length && termos.every((t) => idx.variaveis[i].includes(t)) ? primeiros : demais).push(e);
  }
  return primeiros.length ? primeiros.concat(demais) : demais;
}

export const POR_PAGINA = 40;

export const FORMATOS_BASE = ['dta', 'rds', 'csv.zip', 'parquet'] as const;
export type FormatoBase = (typeof FORMATOS_BASE)[number];
export const formatosBase = (arquivos: ArquivoDl[]): FormatoBase[] => FORMATOS_BASE.filter((f) => arquivos.some((a) => a.formato === f));
export const formatoDisponivel = (pedido: FormatoBase, arquivos: ArquivoDl[]): FormatoBase => {
 const disponiveis = formatosBase(arquivos);
 return disponiveis.includes(pedido) ? pedido : disponiveis[0] ?? 'csv.zip';
};

/** Nunca troca silenciosamente uma UF por Brasil, nem um tema pela base completa. */
export const arquivoDoRecorte = (arquivos: ArquivoDl[], area: string, uf: string, formato: FormatoBase): ArquivoDl | undefined =>
 arquivos.find((a) => a.tipo === (area ? 'area' : 'painel') && a.area === (area || null) && a.uf === (uf || null) && a.formato === formato);

export function validarCatalogo(bruto: unknown, m: ManifestoDl, uf: string): ArquivoDl[] {
 if (!registro(bruto) || bruto.versao !== 1 || bruto.uf !== uf || !Array.isArray(bruto.arquivos)) throw new Error('Catálogo de UF inválido');
 const result = validarManifesto({ ...m, arquivos: bruto.arquivos });
 if (result.descartados || result.manifesto.arquivos.some((a) => a.uf !== uf || a.tipo !== 'area')) throw new Error('Catálogo contém outro recorte');
 return result.manifesto.arquivos;
}

export type ColunaPrevia = { variavel: string; nome: string; unidade: string; anos: number[]; preenchidas: number };
export type PreviaDl = { versao: 1; id: string; area: string | null; uf: string | null; linhas_total: number; ano_de: number; ano_ate: number; colunas: ColunaPrevia[]; amostra: Record<string, string | number | boolean | null>[] };
export function validarPrevia(bruto: unknown, arquivo: ArquivoDl): PreviaDl {
 const fail = () => { throw new Error('Prévia inválida para o arquivo escolhido'); };
 if (!registro(bruto) || bruto.versao !== 1 || bruto.id !== arquivo.id.replace(/_(parquet|csv_zip|dta|rds)$/, '') || bruto.uf !== arquivo.uf || bruto.area !== arquivo.area || bruto.linhas_total !== arquivo.linhas || bruto.ano_de !== arquivo.ano_de || bruto.ano_ate !== arquivo.ano_ate || !Array.isArray(bruto.colunas) || !Array.isArray(bruto.amostra)) return fail();
 const cols = bruto.colunas; const rows = bruto.amostra;
 if (cols.length !== (arquivo.variaveis ?? 0) + 6 || rows.length < 1 || rows.length > 5) return fail();
 const names = new Set<string>();
 for (const c of cols) {
  if (!registro(c) || !texto(c.variavel) || !/^[a-z][a-z0-9_]{0,31}$/.test(c.variavel) || names.has(c.variavel) || !texto(c.nome) || !texto(c.unidade) || !natural(c.preenchidas) || c.preenchidas > (arquivo.linhas ?? 0) || !Array.isArray(c.anos) || c.anos.some((y) => typeof y !== 'number' || !Number.isInteger(y) || y < (arquivo.ano_de ?? 2013) || y > (arquivo.ano_ate ?? 2200))) return fail();
  names.add(c.variavel);
 }
 for (const row of rows) {
  if (!registro(row) || Object.keys(row).length !== names.size || Object.entries(row).some(([k,v]) => !names.has(k) || (v !== null && typeof v !== 'string' && typeof v !== 'boolean' && (typeof v !== 'number' || !Number.isFinite(v)))) || typeof row.ano !== 'number' || row.ano < (arquivo.ano_de ?? 2013) || row.ano > (arquivo.ano_ate ?? 2200) || (arquivo.uf && row.uf !== arquivo.uf)) return fail();
 }
 return bruto as unknown as PreviaDl;
}

export const ordenarDetalhados = (arquivos: ArquivoDl[]): ArquivoDl[] => [...arquivos].sort((a,b) => (b.ano_ate ?? 0) - (a.ano_ate ?? 0) || a.nome.localeCompare(b.nome, 'pt-BR') || a.formato.localeCompare(b.formato));
