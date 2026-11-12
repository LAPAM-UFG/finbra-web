/**
 * Perfis da RAIS por raça/cor, escolaridade e tipo de vínculo: cálculos puros sobre as linhas dos Parquet agregados
 * (gold/trabalho/perfis/ano=AAAA.parquet, gerados por pipeline/trabalho_perfis.py). Nada aqui consulta dados.
 *
 * Linha do arquivo: ano, escopo (município de 7 dígitos, UF ou 'BR'), variavel (raca_cor, escolaridade, tipo_vinculo,
 * vinculo_mte ou total), codigo (texto), vinculos e total. Há uma linha total/total em todo escopo, inclusive sem vínculos (0).
 *
 * Regras:
 *  - a unidade é o vínculo ativo em 31/12 (contrato), nunca pessoa;
 *  - campo vazio vem como '_ausente' e continua no denominador; raça/cor 9 ('não identificada') é outra categoria;
 *  - categoria do dicionário não observada num escopo que EXISTE vale 0; escopo, ano ou fonte indisponível nunca vira zero;
 *  - código fora do dicionário é preservado, com o código no rótulo;
 *  - a soma de todas as categorias (ausente e desconhecidas incluídas) tem de fechar no total, senão o recorte é recusado;
 *  - percentual sem denominador positivo é null (indefinido).
 */

export type Linha = Record<string, unknown>;
export type Lang = 'pt' | 'en';

export const AUSENTE = '_ausente';
export const VARIAVEIS_PERFIL = ['raca_cor', 'escolaridade', 'vinculo_mte', 'tipo_vinculo'] as const;
export type VariavelPerfil = (typeof VARIAVEIS_PERFIL)[number];

export const UFS_PERFIL: ReadonlySet<string> = new Set('AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' '));

/** Nota técnica da RAIS 2023 (MTE) que define o agrupamento do tipo de vínculo; as páginas (4–5) ficam fora do endereço. */
export const URL_NOTA_MTE = 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais/rais-2023/nota-tecnica-rais-2023_11-12-2024.pdf';
export const PAGINAS_NOTA_MTE = '4–5';

// ---------------- dicionário (códigos da RAIS; textos em português iguais aos de pipeline/dicionario_trabalho.csv) ----------------

type Entrada = { codigo: string; pt: string; en: string };
const e = (codigo: string, pt: string, en: string): Entrada => ({ codigo, pt, en });

export const DICIONARIO: Record<VariavelPerfil, Entrada[]> = {
  raca_cor: [
    e('1', 'Indígena', 'Indigenous'), e('2', 'Branca', 'White'), e('4', 'Preta', 'Black'),
    e('6', 'Amarela', 'Asian (amarela)'), e('8', 'Parda', 'Mixed race (parda)'), e('9', 'Não identificada', 'Not identified'),
  ],
  escolaridade: [
    e('1', 'Analfabeto', 'Illiterate'), e('2', 'Até o 5º ano incompleto', 'Up to 5th grade, incomplete'),
    e('3', '5º ano completo do fundamental', '5th grade of primary school, complete'), e('4', 'Do 6º ao 9º ano do fundamental', '6th to 9th grade of primary school'),
    e('5', 'Fundamental completo', 'Primary school complete'), e('6', 'Médio incompleto', 'Secondary school, incomplete'),
    e('7', 'Médio completo', 'Secondary school complete'), e('8', 'Superior incompleto', 'College, incomplete'),
    e('9', 'Superior completo', 'College degree'), e('10', 'Mestrado', 'Master’s degree'), e('11', 'Doutorado', 'Doctorate'),
  ],
  tipo_vinculo: [
    e('10', 'CLT urbano, empregador pessoa jurídica, prazo indeterminado', 'CLT, urban, company employer, open-ended'),
    e('15', 'CLT urbano, empregador pessoa física, prazo indeterminado', 'CLT, urban, individual employer, open-ended'),
    e('20', 'CLT rural, empregador pessoa jurídica, prazo indeterminado', 'CLT, rural, company employer, open-ended'),
    e('25', 'CLT rural, empregador pessoa física, prazo indeterminado', 'CLT, rural, individual employer, open-ended'),
    e('30', 'Estatutário', 'Statutory (civil servant)'), e('31', 'Estatutário (RGPS)', 'Statutory (general social security regime)'),
    e('35', 'Estatutário não efetivo', 'Statutory, non-tenured'), e('40', 'Avulso', 'Casual (avulso)'),
    e('50', 'Temporário', 'Temporary'), e('55', 'Aprendiz', 'Apprentice'),
    e('60', 'CLT urbano, empregador pessoa jurídica, prazo determinado', 'CLT, urban, company employer, fixed-term'),
    e('65', 'CLT urbano, empregador pessoa física, prazo determinado', 'CLT, urban, individual employer, fixed-term'),
    e('70', 'CLT rural, empregador pessoa jurídica, prazo determinado', 'CLT, rural, company employer, fixed-term'),
    e('75', 'CLT rural, empregador pessoa física, prazo determinado', 'CLT, rural, individual employer, fixed-term'),
    e('80', 'Diretor sem vínculo empregatício (com FGTS)', 'Director without an employment relationship (with FGTS)'),
    e('90', 'Contrato por prazo determinado', 'Fixed-term contract'), e('95', 'Contrato por tempo determinado', 'Fixed-time contract'),
    e('96', 'Contrato por lei estadual', 'Contract under state law'), e('97', 'Contrato por lei municipal', 'Contract under municipal law'),
  ],
  // agrupamento estatístico da nota técnica da RAIS 2023 (MTE); não é o regime jurídico de cada vínculo
  vinculo_mte: [
    e('1', 'Celetistas', 'CLT (private-law) jobs'),
    e('2', 'Estatutários (inclui contratos por lei estadual ou municipal)', 'Statutory jobs (includes contracts under state or municipal law)'),
    e('3', 'Outros tipos (temporários, aprendizes, avulsos, diretores e demais)', 'Other types (temporary, apprentices, casual, directors and others)'),
  ],
};

export const rotuloAusente = (l: Lang) => (l === 'en' ? 'Not reported (empty field)' : 'Não informado (campo vazio)');
export const rotuloDesconhecido = (codigo: string, l: Lang) => (l === 'en' ? `Code ${codigo} (not in the dictionary)` : `Código ${codigo} (fora do dicionário)`);

export const NOME_VARIAVEL: Record<VariavelPerfil, Entrada> = {
  raca_cor: e('raca_cor', 'Raça/cor', 'Race/colour'),
  escolaridade: e('escolaridade', 'Escolaridade', 'Education'),
  vinculo_mte: e('vinculo_mte', 'Tipo de vínculo (agrupamento do MTE)', 'Job type (Ministry grouping)'),
  tipo_vinculo: e('tipo_vinculo', 'Tipo de vínculo (detalhado)', 'Job type (detailed)'),
};

/** Grupo do tipo de vínculo na nota técnica da RAIS 2023 (mesma regra de VINCULO_MTE em dados.ts e do gerador): '1', '2' ou '3'; vazio ou não numérico, null. */
export function grupoMte(codigo: string): '1' | '2' | '3' | null {
  if (!/^-?\d+$/.test(codigo)) return null;
  const n = Number(codigo);
  if ([10, 15, 20, 25, 60, 65, 70, 75].includes(n)) return '1';
  if ([30, 31, 35, 96, 97].includes(n)) return '2';
  return '3';
}

// ---------------- disponibilidade e escopo ----------------

export type Disponibilidade =
  | { ok: true; anos: number[] }
  | { ok: false; motivo: 'sem_fonte' | 'sem_ano' | 'ano_ausente'; anos: number[] };

/** A fonte do manifesto (fontes.rais_perfis) tem o arquivo do ano exibido? Não há ano substituto: ano ausente é indisponível. */
export function disponibilidadePerfis(fonte: unknown, ano: number | null | undefined): Disponibilidade {
  const anosBrutos = fonte && typeof fonte === 'object' ? (fonte as { anos?: unknown }).anos : undefined;
  if (!Array.isArray(anosBrutos)) return { ok: false, motivo: 'sem_fonte', anos: [] };
  const fallback = fonte && typeof fonte === 'object' && (fonte as { versao?: unknown }).versao === 2 ? (fonte as { fallback_v1?: { anos?: unknown } }).fallback_v1?.anos : undefined;
  const anos = [...new Set([...anosBrutos, ...(Array.isArray(fallback) ? fallback : [])].filter((a): a is number => typeof a === 'number' && Number.isInteger(a)))].sort((x, y) => x - y);
  if (!anos.length) return { ok: false, motivo: 'sem_fonte', anos: [] };
  if (typeof ano !== 'number' || !Number.isInteger(ano)) return { ok: false, motivo: 'sem_ano', anos };
  return anos.includes(ano) ? { ok: true, anos } : { ok: false, motivo: 'ano_ausente', anos };
}

/**
 * Escopo do arquivo: município (7 dígitos; o DF, 53, é Brasília), UF (sigla) ou 'BR'. Município ou UF informado e
 * inválido dá null — nunca cai para o Brasil em silêncio.
 */
export function escopoDoPerfil(p: { ente?: unknown; uf?: unknown }): string | null {
  const dado = (v: unknown) => v !== undefined && v !== null && v !== '';
  if (dado(p.ente)) {
    const s = String(p.ente).trim();
    const cod = s === '53' ? '5300108' : s;
    return /^\d{7}$/.test(cod) ? cod : null;
  }
  if (dado(p.uf)) return typeof p.uf === 'string' && UFS_PERFIL.has(p.uf) ? p.uf : null;
  return 'BR';
}

export const perfisComRemuneracao = (fonte: unknown, ano?: number): boolean => {
  if (!fonte || typeof fonte !== 'object' || (fonte as { versao?: unknown }).versao !== 2) return false;
  const anos = (fonte as { anos?: unknown }).anos;
  // remuneração só onde o arquivo V2 do ANO existe; sem a lista de anos ou sem o ano, nada é presumido
  return ano !== undefined && Array.isArray(anos) && anos.includes(ano);
};
export const caminhoPerfis = (ano: number, fonte?: unknown) => `gold/trabalho/${perfisComRemuneracao(fonte, ano) ? 'perfis_v2' : 'perfis'}/ano=${ano}.parquet`;

// ---------------- leitura das linhas ----------------

export type RemuneracaoPerfil = { massaCentavos: number | null; nRem: number; media: number | null };
export type PerfilLido =
  | { estado: 'sem_escopo' }
  | { estado: 'inconsistente'; problemas: string[] }
  | { estado: 'ok'; ano: number; total: number; contagens: Record<VariavelPerfil, Map<string, number>>;
      remuneracoes: Record<VariavelPerfil, Map<string, RemuneracaoPerfil>> | null; remuneracaoTotal: RemuneracaoPerfil | null };

const inteiroNaoNegativo = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Valida e organiza as linhas de UM escopo e UM ano. Sem a linha total/total o escopo não existe no arquivo
 * ('sem_escopo': não é zero). Qualquer incoerência (ano trocado, contagem inválida, duplicata, total diferente na
 * coluna, soma de uma dimensão diferente do total) recusa o recorte inteiro: não se exibe nem exporta meio-resultado.
 */
export function lerPerfil(linhas: Linha[] | undefined, ano: number): PerfilLido {
  const todas = linhas ?? [];
  const totais = todas.filter((r) => r.variavel === 'total' && r.codigo === 'total');
  if (!totais.length) return { estado: 'sem_escopo' };
  const problemas: string[] = [];
  const total = totais.length === 1 && inteiroNaoNegativo(totais[0].vinculos) ? totais[0].vinculos : null;
  if (total === null) problemas.push('total');
  const contagens = Object.fromEntries(VARIAVEIS_PERFIL.map((v) => [v, new Map<string, number>()])) as Record<VariavelPerfil, Map<string, number>>;
  const temRem = todas.some((r) => ['massa_dez_centavos', 'n_rem_dez', 'remuneracao_media_dez'].some((c) => c in r));
  const remuneracoes = temRem ? Object.fromEntries(VARIAVEIS_PERFIL.map((v) => [v, new Map<string, RemuneracaoPerfil>()])) as Record<VariavelPerfil, Map<string, RemuneracaoPerfil>> : null;
  const lerRem = (r: Linha): RemuneracaoPerfil | null => {
    const m = r.massa_dez_centavos, k = r.n_rem_dez, media = r.remuneracao_media_dez;
    if (!inteiroNaoNegativo(r.vinculos) || !inteiroNaoNegativo(k) || k > r.vinculos) { problemas.push('quantidade com remuneração'); return null; }
    if (k === 0) {
      if (m !== null || media !== null) { problemas.push('remuneração sem valor válido'); return null; }
      return { massaCentavos: null, nRem: 0, media: null };
    }
    // média = massa ÷ 100 ÷ vínculos, a mesma conta do gerador (IEEE idêntico): só algumas ULPs de folga; cada valor positivo vale ao menos 1 centavo
    if (typeof m !== 'number' || !Number.isSafeInteger(m) || m < k || typeof media !== 'number' || !Number.isFinite(media)
      || media <= 0 || Math.abs(media - m / 100 / r.vinculos) > Math.abs(media) * Number.EPSILON * 4) { problemas.push('massa ou média de remuneração'); return null; }
    return { massaCentavos: m, nRem: k, media };
  };
  const remuneracaoTotal = temRem && totais.length === 1 ? lerRem(totais[0]) : null;
  const vistas = new Set<string>();
  for (const r of todas) {
    if (r.ano !== undefined && r.ano !== ano) problemas.push(`ano ${String(r.ano)}`);
    if (typeof r.variavel !== 'string' || typeof r.codigo !== 'string' || r.codigo === '') { problemas.push('linha sem variável ou código'); continue; }
    if (total !== null && r.total !== undefined && r.total !== total) problemas.push('total da linha');
    if (r.variavel === 'total') continue;
    if (!(VARIAVEIS_PERFIL as readonly string[]).includes(r.variavel)) continue; // variável futura: ignorada
    if (!inteiroNaoNegativo(r.vinculos)) { problemas.push(`contagem de ${r.variavel}/${r.codigo}`); continue; }
    const chave = `${r.variavel}\u0000${r.codigo}`;
    if (vistas.has(chave)) { problemas.push(`duplicata ${r.variavel}/${r.codigo}`); continue; }
    vistas.add(chave);
    contagens[r.variavel as VariavelPerfil].set(r.codigo, r.vinculos);
    if (remuneracoes) {
      const rem = lerRem(r);
      if (rem) remuneracoes[r.variavel as VariavelPerfil].set(r.codigo, rem);
    }
  }
  if (total !== null) {
    for (const v of VARIAVEIS_PERFIL) {
      const soma = [...contagens[v].values()].reduce((s, x) => s + x, 0);
      if (soma !== total) problemas.push(`soma de ${v} (${soma}) diferente do total (${total})`);
      if (remuneracoes && remuneracaoTotal) {
        const valores = [...remuneracoes[v].values()];
        if (valores.reduce((s, r) => s + (r.massaCentavos ?? 0), 0) !== (remuneracaoTotal.massaCentavos ?? 0)
          || valores.reduce((s, r) => s + r.nRem, 0) !== remuneracaoTotal.nRem) problemas.push(`remuneração de ${v} não fecha no total`);
      }
    }
  }
  if (problemas.length || total === null) return { estado: 'inconsistente', problemas: [...new Set(problemas)] };
  return { estado: 'ok', ano, total, contagens, remuneracoes, remuneracaoTotal };
}

// ---------------- distribuições ----------------

export type TipoItem = 'conhecido' | 'ausente' | 'desconhecido';
export type CondicaoRemuneracao = 'registrada' | 'sem_valor' | 'sem_vinculos' | 'nao_publicada';
export type ItemDist = { codigo: string; rotulo: string; vinculos: number; pct: number | null; tipo: TipoItem; grupoMte?: string | null;
  media: number | null; massaCentavos: number | null; nRem: number | null; semRem: number | null; condicaoRem: CondicaoRemuneracao };
export type Distribuicao = { variavel: VariavelPerfil; total: number; soma: number; itens: ItemDist[] };

export const razao = (a: number, b: number): number | null => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null);

const ordemCodigo = (a: string, b: string) => {
  const x = Number(a), y = Number(b);
  return Number.isFinite(x) && Number.isFinite(y) && x !== y ? x - y : a < b ? -1 : a > b ? 1 : 0;
};

/**
 * Categorias de uma dimensão: as do dicionário (0 quando não observadas, num escopo que existe), os códigos
 * desconhecidos observados (com o código no rótulo) e o campo vazio, só se observado. Percentual sobre TODOS os vínculos.
 */
export function distribuicao(p: Extract<PerfilLido, { estado: 'ok' }>, variavel: VariavelPerfil, lang: Lang): Distribuicao {
  const obs = p.contagens[variavel];
  const dic = DICIONARIO[variavel];
  const item = (codigo: string, rotulo: string, tipo: TipoItem): ItemDist => {
    const v = obs.get(codigo) ?? 0;
    const rem = p.remuneracoes ? p.remuneracoes[variavel].get(codigo) ?? { massaCentavos: null, nRem: 0, media: null } : null;
    return { codigo, rotulo, vinculos: v, pct: razao(v, p.total), tipo, ...(variavel === 'tipo_vinculo' ? { grupoMte: grupoMte(codigo) } : {}),
      media: rem?.media ?? null, massaCentavos: rem?.massaCentavos ?? null, nRem: rem?.nRem ?? null, semRem: rem ? v - rem.nRem : null,
      condicaoRem: !rem ? 'nao_publicada' : v === 0 ? 'sem_vinculos' : rem.nRem === 0 ? 'sem_valor' : 'registrada' };
  };
  const conhecidos = new Set(dic.map((x) => x.codigo));
  const itens = dic.map((x) => item(x.codigo, lang === 'en' ? x.en : x.pt, 'conhecido'));
  const outros = [...obs.keys()].filter((c) => c !== AUSENTE && !conhecidos.has(c)).sort(ordemCodigo);
  for (const c of outros) itens.push(item(c, rotuloDesconhecido(c, lang), 'desconhecido'));
  if (obs.has(AUSENTE)) itens.push(item(AUSENTE, rotuloAusente(lang), 'ausente'));
  return { variavel, total: p.total, soma: itens.reduce((s, i) => s + i.vinculos, 0), itens };
}

/** Superior completo + mestrado + doutorado: o que o cartão "Ensino superior completo" do perfil soma (escolaridade ≥ 9). */
export function superiorSomado(d: Distribuicao): { vinculos: number; pct: number | null } {
  const v = d.itens.filter((i) => ['9', '10', '11'].includes(i.codigo)).reduce((s, i) => s + i.vinculos, 0);
  return { vinculos: v, pct: razao(v, d.total) };
}

// ---------------- exportação ----------------

export function colunasExportacao(lang: Lang): string[] {
  return lang === 'en'
    ? ['Dimension', 'Code', 'Category', 'Category type', 'Ministry group', 'Active jobs', 'Total active jobs in the scope', 'Share', 'Share unit', 'Average December pay', 'December payroll', 'Jobs with valid December pay', 'Jobs without valid December pay', 'Pay data condition', 'Currency']
    : ['Dimensão', 'Código', 'Categoria', 'Tipo da categoria', 'Grupo do MTE', 'Vínculos ativos', 'Total de vínculos ativos do recorte', 'Participação', 'Unidade da participação', 'Remuneração média de dezembro', 'Massa de dezembro', 'Vínculos com remuneração válida', 'Vínculos sem remuneração válida', 'Condição da remuneração', 'Moeda'];
}

export function condicaoRemuneracao(c: CondicaoRemuneracao, lang: Lang): string {
  const nomes = { registrada: ['registrada', 'recorded'], sem_valor: ['sem remuneração válida', 'no valid pay'], sem_vinculos: ['sem vínculos', 'no jobs'], nao_publicada: ['remuneração não publicada', 'pay not published'] };
  return nomes[c][lang === 'en' ? 1 : 0];
}

const TIPO_EXPORT: Record<TipoItem, Entrada> = {
  conhecido: e('conhecido', 'categoria do dicionário', 'dictionary category'),
  ausente: e('ausente', 'campo vazio', 'empty field'),
  desconhecido: e('desconhecido', 'código fora do dicionário', 'code not in the dictionary'),
};

/**
 * Uma linha por categoria de cada dimensão pedida, com todos os códigos (zeros do dicionário, ausentes e desconhecidos) e o tipo
 * de vínculo detalhado. Vínculos e total saem numéricos; participação numérica de 0 a 100 (pontos percentuais), vazia se indefinida.
 */
export function linhasExportacao(p: Extract<PerfilLido, { estado: 'ok' }>, variaveis: readonly VariavelPerfil[], lang: Lang): (string | number | null)[][] {
  const saida: (string | number | null)[][] = [];
  for (const v of variaveis) {
    const d = distribuicao(p, v, lang);
    for (const i of d.itens) {
      const g = i.grupoMte ?? null;
      saida.push([
        lang === 'en' ? NOME_VARIAVEL[v].en : NOME_VARIAVEL[v].pt, i.codigo, i.rotulo, lang === 'en' ? TIPO_EXPORT[i.tipo].en : TIPO_EXPORT[i.tipo].pt,
        g ? (lang === 'en' ? DICIONARIO.vinculo_mte.find((x) => x.codigo === g)!.en : DICIONARIO.vinculo_mte.find((x) => x.codigo === g)!.pt) : null,
        i.vinculos, d.total, i.pct === null ? null : i.pct * 100, '%',
        i.media, i.massaCentavos === null ? null : i.massaCentavos / 100, i.nRem, i.semRem, condicaoRemuneracao(i.condicaoRem, lang), i.condicaoRem === 'nao_publicada' ? null : 'BRL',
      ]);
    }
  }
  return saida;
}
