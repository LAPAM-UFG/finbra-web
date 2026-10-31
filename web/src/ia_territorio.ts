/**
 * Municípios e UFs nas consultas da IA, a partir de um cadastro só (tabela entes), com o código de cada
 * lugar em cada formato das tabelas:
 *
 *   cod_ibge, 7 dígitos (4101101)   trab_municipios, trab_grandes_setores, trab_setores, trab_caged,
 *                                   trab_caged_anual, saude_municipios, entes e as tabelas das finanças
 *   municipio, 6 dígitos (410110)   rais_mun, rais_vinculos e saude_municipios (o código IBGE sem o dígito verificador)
 *   UF                              sigla ('PR') em trab_municipios, saude_municipios, entes e no escopo das tabelas por UF;
 *                                   código (41) em rais_uf, rais_mun e rais_vinculos; nas finanças, cod_ibge 41
 *
 * A ferramenta "localizar" acha o lugar pelo nome e a UF; conferirCodigos barra, antes de rodar, a consulta
 * com código no formato errado (410110 em trab_caged), código inexistente ou busca aproximada (pedaço do
 * código, LIKE no nome), que trazia outro município junto.
 */
import { cadastroEntes } from './dados';
import { t } from './idioma';
import { sqlSemTextos, type Valor } from './ia_formato';

export type EnteCadastro = { cod: number; nome: string; uf: string; esfera: string };
export type Cadastro = { porCodigo: Map<number, EnteCadastro>; porRais: Map<number, EnteCadastro>; municipios: EnteCadastro[] };

/** Nome e preposição de cada UF ("em Goiás", "no Pará", "na Bahia"). */
export const UF_NOMES: Record<string, [string, 'em' | 'no' | 'na']> = {
  AC: ['Acre', 'no'], AL: ['Alagoas', 'em'], AM: ['Amazonas', 'no'], AP: ['Amapá', 'no'], BA: ['Bahia', 'na'],
  CE: ['Ceará', 'no'], DF: ['Distrito Federal', 'no'], ES: ['Espírito Santo', 'no'], GO: ['Goiás', 'em'],
  MA: ['Maranhão', 'no'], MG: ['Minas Gerais', 'em'], MS: ['Mato Grosso do Sul', 'em'], MT: ['Mato Grosso', 'em'],
  PA: ['Pará', 'no'], PB: ['Paraíba', 'na'], PE: ['Pernambuco', 'em'], PI: ['Piauí', 'no'], PR: ['Paraná', 'no'],
  RJ: ['Rio de Janeiro', 'no'], RN: ['Rio Grande do Norte', 'no'], RO: ['Rondônia', 'em'], RR: ['Roraima', 'em'],
  RS: ['Rio Grande do Sul', 'no'], SC: ['Santa Catarina', 'em'], SE: ['Sergipe', 'em'], SP: ['São Paulo', 'em'], TO: ['Tocantins', 'no'],
};
export const nomeDaUf = (uf: string) => UF_NOMES[uf]?.[0] ?? uf;

export function montarCadastro(lista: EnteCadastro[]): Cadastro {
  const municipios = lista.filter((e) => e.esfera === 'M');
  return {
    porCodigo: new Map(lista.map((e) => [e.cod, e])),
    porRais: new Map(municipios.map((e) => [Math.floor(e.cod / 10), e])),
    municipios,
  };
}

let carregado: Promise<Cadastro> | null = null;
/** Cadastro dos entes (já em memória no DuckDB), montado uma vez. */
export function cadastro(): Promise<Cadastro> {
  carregado ??= cadastroEntes().then((l) => montarCadastro(l.map((e) => ({ cod: Number(e.cod_ibge), nome: String(e.nome), uf: String(e.uf), esfera: String(e.esfera) }))));
  carregado.catch(() => (carregado = null));
  return carregado;
}

/** Sem acento, minúsculo e com espaços simples: "Andirá" e "ANDIRA" dão "andira". */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’`´]/g, "'").replace(/[\s-]+/g, ' ').trim();

// ---------------- códigos em cada formato ----------------

type Paineis = readonly string[];
const comTrabalho = (p: Paineis) => p.includes('trabalho');
const comFinancas = (p: Paineis) => p.includes('financas');
const comSaude = (p: Paineis) => p.includes('saude');
/** "a, b e c". */
const emLista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}` : xs.join(''));

/** Os códigos de um município em cada tabela dos painéis marcados, para o modelo. */
export function codigosDoMunicipio(cod: number, paineis: Paineis): string {
  const tabelas7 = [...(comTrabalho(paineis) ? ['trab_municipios', 'trab_grandes_setores', 'trab_setores', 'trab_caged', 'trab_caged_anual'] : []),
    ...(comSaude(paineis) ? ['saude_municipios'] : []), 'entes', ...(comFinancas(paineis) ? ['indicadores', 'alertas', 'lrf'] : [])];
  const partes = [`cod_ibge = ${cod} (7 dígitos) em ${emLista(tabelas7)}`];
  if (comTrabalho(paineis)) partes.push(`municipio = ${Math.floor(cod / 10)} (6 dígitos) só em rais_mun e rais_vinculos`);
  return `Códigos: ${partes.join('; ')}.`;
}

/** Os códigos de uma UF em cada tabela. */
export function codigosDaUf(uf: string, cod: number, paineis: Paineis): string {
  const partes: string[] = [];
  if (comTrabalho(paineis)) {
    partes.push(`uf = '${uf}' (sigla) em trab_municipios e entes`, `escopo = '${uf}' em trab_setores_uf e trab_caged_uf`,
      `uf = ${cod} (código) ou uf_sigla = '${uf}' em rais_uf, rais_mun e rais_vinculos`);
  }
  if (comFinancas(paineis)) partes.push(`governo estadual: cod_ibge = ${cod} (esfera 'E'); municípios da UF: uf = '${uf}' com esfera 'M'`);
  if (comSaude(paineis)) partes.push(`uf = '${uf}' (sigla) em saude_municipios (inclui as linhas de município ignorado da UF)`);
  return `Códigos: ${partes.join('; ')}.`;
}

/** Distrito Federal: ente 53 nas finanças; Brasília (5300108) no mercado de trabalho. */
export function codigosDoDf(paineis: Paineis): string {
  const partes: string[] = [];
  if (comFinancas(paineis)) partes.push("nas finanças, cod_ibge = 53 (esfera 'D')");
  if (comTrabalho(paineis)) partes.push("no trabalho, Brasília: cod_ibge = 5300108 nas tabelas trab_*, municipio = 530010 em rais_mun e rais_vinculos, uf = 53 ou uf_sigla = 'DF' nas tabelas rais_*, escopo = 'DF' nas tabelas por UF");
  if (comSaude(paineis)) partes.push("na saúde, o DF inteiro é Brasília: cod_ibge = 5300108 (ou uf = 'DF') em saude_municipios");
  return `Códigos: ${partes.join('; ')}.`;
}

// ---------------- localizar (ferramenta do modelo) ----------------

export type Localizado = { tipo: 'municipio' | 'uf'; nome: string; uf: string; cod: number };

const ufDe = (s: string): string | null => {
  const x = s.trim();
  if (!x) return null;
  if (/^[a-z]{2}$/i.test(x) && UF_NOMES[x.toUpperCase()]) return x.toUpperCase();
  return Object.entries(UF_NOMES).find(([, [nome]]) => chave(nome) === chave(x))?.[0] ?? null;
};

/** Distância de edição (para sugerir nomes parecidos quando não há nenhum igual). */
function distancia(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const guardado = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = guardado;
    }
  }
  return d[b.length];
}

/**
 * Lugar pelo nome (sem diferenciar acento e maiúsculas) e, se informada, pela UF (sigla ou nome). Estados
 * também valem ("Paraná", "PR"). Sem nenhum igual, até 5 nomes parecidos como sugestão.
 */
export function localizar(nome: string, uf: string, cad: Cadastro): { encontrados: Localizado[]; sugestoes: Localizado[] } {
  const n = chave(nome.replace(/\s*[(/-]\s*[a-z]{2}\)?\s*$/i, '')); // "Andirá (PR)", "Andirá/PR", "Andirá - PR"
  const sigla = ufDe(uf) ?? ufDe(/[(/-]\s*([a-z]{2})\)?\s*$/i.exec(nome)?.[1] ?? '');
  const estado = ufDe(nome);
  const comoUf = (u: string): Localizado => ({ tipo: 'uf', nome: nomeDaUf(u), uf: u, cod: [...cad.porCodigo.values()].find((e) => e.uf === u && (e.esfera === 'E' || e.esfera === 'D'))?.cod ?? 0 });
  const comoMunicipio = (e: EnteCadastro): Localizado => ({ tipo: 'municipio', nome: e.nome, uf: e.uf, cod: e.cod });
  const encontrados: Localizado[] = cad.municipios.filter((e) => chave(e.nome) === n && (!sigla || e.uf === sigla)).map(comoMunicipio);
  if (estado && (!sigla || sigla === estado) && n === chave(nomeDaUf(estado))) encontrados.unshift(comoUf(estado));
  else if (estado && /^[a-z]{2}$/i.test(nome.trim())) encontrados.unshift(comoUf(estado));
  if (encontrados.length || !n) return { encontrados, sugestoes: [] };
  const candidatos = cad.municipios.filter((e) => !sigla || e.uf === sigla)
    .map((e) => {
      const k = chave(e.nome);
      return { e, d: k.startsWith(n) || n.startsWith(k) ? 0.5 : distancia(n, k) };
    })
    .filter((x) => x.d <= Math.max(2, Math.floor(n.length / 4)))
    .sort((a, b) => a.d - b.d || a.e.nome.localeCompare(b.e.nome))
    .slice(0, 5);
  return { encontrados: [], sugestoes: candidatos.map((x) => comoMunicipio(x.e)) };
}

/** Linha de um lugar para o modelo, com os códigos em cada formato. */
function paraModeloLocalizado(l: Localizado, paineis: Paineis) {
  if (l.tipo === 'uf') {
    return { tipo: 'uf', nome: l.nome, uf: l.uf, cod_ibge: l.cod, codigos: l.uf === 'DF' ? codigosDoDf(paineis) : codigosDaUf(l.uf, l.cod, paineis) };
  }
  return { tipo: 'municipio', nome: l.nome, uf: l.uf, cod_ibge: l.cod, municipio_rais: Math.floor(l.cod / 10), codigos: codigosDoMunicipio(l.cod, paineis) };
}

/**
 * Executa a ferramenta "localizar": devolve o texto para o modelo e uma tabela para a página (nome, UF e os
 * códigos), que fica no histórico da conversa como as consultas.
 */
export function executarLocalizacao(entrada: unknown, cad: Cadastro, paineis: Paineis): {
  modelo: string; tabela: { colunas: string[]; linhas: Valor[][]; total: number } | { erro: string }; erro: boolean;
} {
  const e = (entrada ?? {}) as { nome?: unknown; uf?: unknown };
  const nome = typeof e.nome === 'string' ? e.nome.slice(0, 120) : '';
  if (!nome.trim()) return { modelo: JSON.stringify({ erro: 'informe o nome do município ou da UF' }), tabela: { erro: 'nome vazio' }, erro: true };
  const r = localizar(nome, typeof e.uf === 'string' ? e.uf : '', cad);
  const lista = r.encontrados.length ? r.encontrados : r.sugestoes;
  const tabela = {
    colunas: ['nome', 'uf', 'cod_ibge', 'municipio_rais'],
    linhas: lista.map((l): Valor[] => [l.nome, l.uf, l.cod, l.tipo === 'municipio' ? Math.floor(l.cod / 10) : null]),
    total: lista.length,
  };
  if (r.encontrados.length === 1) {
    return { modelo: JSON.stringify({ encontrado: paraModeloLocalizado(r.encontrados[0], paineis), observacao: 'Use estes códigos exatos nas consultas.' }), tabela, erro: false };
  }
  if (r.encontrados.length > 1) {
    return {
      modelo: JSON.stringify({
        encontrados: r.encontrados.map((l) => paraModeloLocalizado(l, paineis)),
        observacao: 'Há mais de um lugar com esse nome: use a UF citada na pergunta; se ela não disser, peça esclarecimento (tipo "esclarecimento") com as opções.',
      }),
      tabela, erro: false,
    };
  }
  return {
    modelo: JSON.stringify({
      erro: `nenhum município ou UF com o nome "${nome}"${typeof e.uf === 'string' && e.uf ? ` em ${e.uf}` : ''}`,
      sugestoes: r.sugestoes.map((l) => `${l.nome} (${l.uf})`),
      observacao: 'Confira a grafia; se a pergunta for ambígua, peça esclarecimento. Não procure o código por LIKE.',
    }),
    tabela, erro: true,
  };
}

// ---------------- conferência dos códigos nas consultas ----------------

const descrever = (e: EnteCadastro) => `${e.nome} (${e.uf})`;
const TABELAS_SO_MUNICIPIO = /\b(trab_municipios|trab_grandes_setores|trab_setores|trab_caged|trab_caged_anual|saude_municipios)\b/;
const TABELAS_COM_UF_EM_COD = /\b(entes|indicadores|alertas|escopos|lrf)\b/;

/**
 * Confere, antes de rodar, os códigos de território que a consulta compara com números fixos. Devolve o
 * problema (para o modelo corrigir) ou null. Cobre: 6 dígitos em cod_ibge (410110 no lugar de 4101101),
 * 7 dígitos em municipio, códigos inexistentes, UF de 2 dígitos em tabelas só de municípios, junção de
 * municipio com cod_ibge sem a conversão e busca por pedaço de código ou pelo nome.
 */
export function conferirCodigos(sql: string, cad: Cadastro): string | null {
  const s = sqlSemTextos(sql);
  const comTextos = sql.toLowerCase();
  const problemas: string[] = [];
  const pares: [string, number][] = [];
  for (const m of s.matchAll(/\b(?:\w+\.)?(cod_ibge|municipio_trab|municipio)\s*(?:=|<>|!=)\s*(\d+)\b/g)) pares.push([m[1], Number(m[2])]);
  // número sozinho do lado esquerdo (4101101 = cod_ibge); o 10 de "cod_ibge // 10 = municipio" não conta
  for (const m of s.matchAll(/(?:^|[(,]|\b(?:where|and|or|on|when|not|having)\s)\s*(\d+)\s*(?:=|<>|!=)\s*(?:\w+\.)?(cod_ibge|municipio_trab|municipio)\b/g)) {
    pares.push([m[2], Number(m[1])]);
  }
  for (const m of s.matchAll(/\b(?:\w+\.)?(cod_ibge|municipio_trab|municipio)\s+(?:not\s+)?in\s*\(([\d\s,]+)\)/g)) {
    for (const x of m[2].split(',')) if (x.trim()) pares.push([m[1], Number(x)]);
  }
  const soMunicipios = TABELAS_SO_MUNICIPIO.test(s) && !TABELAS_COM_UF_EM_COD.test(s);
  for (const [coluna, n] of pares) {
    const digitos = String(n).length;
    if (coluna === 'cod_ibge') {
      if (digitos === 6) {
        const e = cad.porRais.get(n);
        problemas.push(e
          ? `cod_ibge tem 7 dígitos; ${n} é o código de 6 dígitos (usado só em rais_mun e rais_vinculos) de ${descrever(e)}: use cod_ibge = ${e.cod}.`
          : `cod_ibge = ${n}: o código de município tem 7 dígitos, e ${n} não corresponde a nenhum município.`);
      } else if (digitos === 7) {
        if (!cad.porCodigo.has(n)) problemas.push(`cod_ibge = ${n} não existe no cadastro de municípios: use a ferramenta localizar.`);
      } else if (digitos <= 2) {
        const e = cad.porCodigo.get(n);
        if (!e) problemas.push(`cod_ibge = ${n} não é código de UF nem de município.`);
        else if (soMunicipios) {
          problemas.push(`nas tabelas trab_* e em saude_municipios o cod_ibge é sempre de município (7 dígitos); para ${e.esfera === 'D' ? 'o DF use Brasília, cod_ibge = 5300108' : `a UF ${e.uf} use uf = '${e.uf}' (sigla)`}.`);
        }
      } else problemas.push(`cod_ibge = ${n}: código de município tem 7 dígitos (ex.: 4101101) e de UF, 2 (ex.: 41).`);
    } else if (digitos === 7) {
      const e = cad.porCodigo.get(n);
      problemas.push(e && e.esfera === 'M'
        ? `${coluna} tem 6 dígitos nas tabelas rais_mun e rais_vinculos; ${n} é o cod_ibge de 7 dígitos de ${descrever(e)}: use ${coluna} = ${Math.floor(n / 10)}.`
        : `${coluna} = ${n}: nas tabelas rais_mun e rais_vinculos o município tem 6 dígitos.`);
    } else if (digitos === 6) {
      if (!cad.porRais.has(n)) problemas.push(`${coluna} = ${n} não corresponde a nenhum município: use a ferramenta localizar.`);
    } else problemas.push(`${coluna} = ${n}: nas tabelas rais_mun e rais_vinculos o município tem 6 dígitos (ex.: 410110).`);
  }
  // "/" no DuckDB é divisão com casas decimais (410110,1): só "// 10" converte o código
  if (/\b(?:\w+\.)?(municipio|municipio_trab)\s*=\s*(?:\w+\.)?cod_ibge\b(?!\s*\/\/\s*10\b)|\b(?:\w+\.)?cod_ibge\s*=\s*(?:\w+\.)?(municipio|municipio_trab)\b/.test(s)) {
    problemas.push('municipio (6 dígitos) foi comparado com cod_ibge (7 dígitos): use cod_ibge // 10 = municipio.');
  }
  if (/(cod_ibge|municipio)[\w.]*\s*(?:::\s*\w+|\s+as\s+\w+\s*\))?\s*\)?\s*(?:not\s+)?(?:i?like|similar\s+to|~~\*?|glob)\s*'\d{3,}/.test(comTextos)
    || /(?:starts_with|prefix|left|substr|substring)\s*\(\s*(?:cast\s*\(\s*)?[\w.]*(cod_ibge|municipio)\b[^)]*\)?\s*(?:,\s*'\d{3,}'|,\s*\d+\s*(?:,\s*\d+\s*)?\)\s*=\s*'\d{3,}')/.test(comTextos)) {
    problemas.push('não procure municípios por parte do código: use a ferramenta localizar (nome e UF) e filtre pelo código exato.');
  }
  if (/\b(?:\w+\.)?nome\s*\)*\s*(?:not\s+)?(?:i?like|similar\s+to|~~\*?|=)\s*'|(?:lower|upper|strip_accents)\s*\(\s*(?:(?:lower|upper|strip_accents)\s*\(\s*)?(?:\w+\.)?nome\b/.test(s)) {
    problemas.push('para achar um município ou uma UF pelo nome, use a ferramenta localizar; nas consultas, filtre pelo código (cod_ibge, municipio ou uf).');
  }
  return problemas.length ? [...new Set(problemas)].join(' ') : null;
}

/**
 * Lugares que as consultas filtraram por código ou UF fixos, com nome (para a ficha da resposta, em vez
 * do que o modelo escreveu): "Andirá (PR) · IBGE 4101101", "Paraná (PR)", "Brasil".
 */
export function territoriosNasConsultas(sqls: string[], cad: Cadastro | null): string[] {
  const r = new Map<string, string>();
  for (const sql of sqls) {
    const s = sqlSemTextos(sql);
    const comTextos = sql.toLowerCase();
    const numeros: [string, number][] = [];
    for (const m of s.matchAll(/\b(?:\w+\.)?(cod_ibge|municipio|uf)\s*=\s*(\d+)\b/g)) numeros.push([m[1], Number(m[2])]);
    for (const m of s.matchAll(/\b(?:\w+\.)?(cod_ibge|municipio|uf)\s+in\s*\(([\d\s,]+)\)/g)) for (const x of m[2].split(',')) numeros.push([m[1], Number(x)]);
    for (const [coluna, n] of numeros) {
      const e = cad && (coluna === 'municipio' ? cad.porRais.get(n) : cad.porCodigo.get(n));
      if (!e) continue;
      if (e.esfera === 'M') r.set(`m${e.cod}`, `${e.nome} (${e.uf}) · IBGE ${e.cod}`);
      else if (e.esfera === 'E' || e.esfera === 'D') r.set(`u${e.uf}`, `${nomeDaUf(e.uf)} (${e.uf})`);
    }
    for (const m of comTextos.matchAll(/\b(?:\w+\.)?(uf|uf_sigla|escopo)\s*(?:=\s*'([a-z]{2})'|in\s*\(([^)]*)\))/g)) {
      for (const x of m[2] ? [m[2]] : [...(m[3] ?? '').matchAll(/'([a-z]{2})'/g)].map((y) => y[1])) {
        const u = x.toUpperCase();
        if (u === 'BR') r.set('br', t('Brasil', 'Brazil'));
        else if (UF_NOMES[u]) r.set(`u${u}`, `${nomeDaUf(u)} (${u})`);
      }
    }
  }
  return [...r.values()];
}
