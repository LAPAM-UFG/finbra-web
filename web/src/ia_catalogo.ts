/**
 * Catálogo das variáveis e dos conceitos que a IA usa (o mesmo para a tela, a conferência e a exportação):
 *
 *   COLUNAS    unidade, rótulo, definição, fonte e ressalvas das colunas das tabelas do painel; a página formata
 *              pelo tipo declarado aqui (ou na própria consulta), sem adivinhar pelo nome
 *   CONCEITOS  o que a pergunta pede (ex.: Função 04 – Administração) e que colunas ou filtros o atendem: a
 *              revisão devolve ao modelo a resposta que troca a variável pedida por outra
 *
 * As instruções do modelo (worker/src/sistema*.js) descrevem as mesmas colunas e conceitos; o teste
 * "catálogo e instruções" confere que cada conceito daqui aparece lá.
 */
import type { Cobertura } from './ia';
import type { TipoColuna } from './ia_formato';

/** Fonte cujos anos (do manifesto) dão a cobertura temporal da coluna. */
export type ChaveCobertura = 'dca' | 'pib' | 'rais';

export type Coluna = {
  tipo: TipoColuna;
  rotulo: string;
  definicao: string;
  fonte: string;
  ressalva?: string;
  /** tabelas do painel que têm a coluna */
  tabelas?: string[];
  /** cobertura temporal: a da fonte no manifesto (chave) ou um texto fixo */
  cobertura?: ChaveCobertura | string;
  territorio?: string;
  /** recortes aplicados na construção da variável (estágio, intraorçamentárias, data de referência) */
  filtros?: string;
  classificacao?: string;
  /** a coluna reproduz, sem transformação, um número publicado por esta fonte oficial (não é recalculada) */
  oficial?: string;
};

const DCA = 'SICONFI/Tesouro Nacional: DCA';
const RAIS = 'RAIS (MTE)';
const IBGE_POP = 'IBGE: Censos 2010 e 2022 e estimativas de 1º de julho (SIDRA 202, 4709 e 6579)';
const PIB = 'IBGE: PIB dos municípios (SIDRA 5938)';
const REG = 'LAPAM/UFG: regressão calculada pela página';
const FUNCOES = 'função de governo 04 (Portaria MOG 42/1999)';

const TERR_DCA = 'municípios e estados (com o DF) que entregaram a DCA do exercício';
/** Colunas da DCA em indicadores. */
const dca = (x: Omit<Coluna, 'fonte'>): Coluna => ({ fonte: DCA, tabelas: ['indicadores'], cobertura: 'dca', territorio: TERR_DCA, ...x });
const estat = (tipo: TipoColuna, rotulo: string, definicao: string): Coluna => ({ tipo, rotulo, definicao, fonte: REG, cobertura: 'a amostra da consulta' });

/** Colunas pelo nome exato (o mesmo em qualquer tabela do painel). */
export const COLUNAS: Record<string, Coluna> = {
  cod_ibge: { tipo: 'codigo', rotulo: 'código IBGE', definicao: 'código IBGE do ente (município, 7 dígitos; UF, 2 dígitos)', fonte: 'IBGE' },
  municipio: { tipo: 'codigo', rotulo: 'município (código de 6 dígitos)', definicao: 'código IBGE do município sem o dígito verificador (RAIS)', fonte: RAIS },
  exercicio: { tipo: 'ano', rotulo: 'exercício', definicao: 'ano civil do exercício fiscal', fonte: DCA },
  ano: { tipo: 'ano', rotulo: 'ano', definicao: 'ano de referência', fonte: '' },
  populacao: {
    tipo: 'contagem', rotulo: 'população (habitantes)',
    definicao: 'em indicadores e lrf: população informada pelo próprio ente na DCA do exercício; em trab_municipios: população de referência do IBGE',
    fonte: `${DCA} (indicadores); ${IBGE_POP} (trab_municipios)`, tabelas: ['indicadores', 'lrf', 'trab_municipios'], cobertura: 'dca', territorio: TERR_DCA,
    ressalva: 'a declarada costuma repetir uma estimativa do IBGE de um ou dois anos antes; não é a estimativa do IBGE do ano',
  },
  populacao_ibge: {
    tipo: 'contagem', rotulo: 'população do IBGE (habitantes)',
    definicao: 'publicação do IBGE do próprio ano (estimativa de 1º de julho ou censo); em 2023, sem publicação, o Censo 2022',
    fonte: IBGE_POP, tabelas: ['indicadores'], cobertura: '2010 a 2026 (sem estimativa em 2010, 2022 e 2023: valem os censos)', territorio: 'municípios e UFs',
    filtros: 'publicação do mesmo ano; sem ela, a do ano anterior', oficial: 'IBGE (SIDRA 202, 4709 e 6579)',
    ressalva: 'as estimativas até 2021 e o Censo 2022 têm bases diferentes: o per capita salta entre esses anos',
  },
  populacao_ibge_ano: { tipo: 'ano', rotulo: 'ano da publicação de população do IBGE', definicao: 'ano da estimativa ou do censo usado', fonte: IBGE_POP },
  populacao_ano: { tipo: 'ano', rotulo: 'ano da publicação de população do IBGE', definicao: 'ano da estimativa ou do censo usado', fonte: IBGE_POP },
  pib: {
    tipo: 'reais', rotulo: 'PIB (R$ correntes)', definicao: 'Produto Interno Bruto municipal a preços correntes', fonte: PIB, tabelas: ['indicadores'],
    cobertura: 'pib', territorio: 'municípios', oficial: 'IBGE (SIDRA 5938)', ressalva: 'publicado com cerca de dois anos de atraso',
  },
  pib_per_capita: {
    tipo: 'reais', rotulo: 'PIB per capita (R$ correntes)', definicao: 'PIB ÷ população do IBGE (populacao_ibge); recalculado pelo painel',
    fonte: `${PIB} e população do IBGE`, tabelas: ['indicadores'], cobertura: 'pib', territorio: 'municípios',
    ressalva: 'indicador recalculado pelo painel com a mesma regra do IBGE Cidades, não copiado de uma publicação',
  },
  fpm: dca({
    tipo: 'reais', rotulo: 'FPM (R$)', filtros: 'receita bruta realizada, antes das deduções',
    definicao: 'cota-parte do Fundo de Participação dos Municípios recebida (receita bruta realizada, anexo I-C), com a cota mensal e as cotas extraordinárias de 1%',
  }),
  receita_corrente: dca({ tipo: 'reais', rotulo: 'receita corrente (R$)', definicao: 'receitas correntes brutas realizadas, sem intraorçamentárias (anexo I-C)', filtros: 'realizada; sem intraorçamentárias; antes das deduções', classificacao: 'categoria econômica da receita 1 (correntes)' }),
  despesa_empenhada: dca({ tipo: 'reais', rotulo: 'despesa total empenhada (R$)', definicao: 'despesa total empenhada, com as intraorçamentárias (anexo I-D)', filtros: 'empenhada; com intraorçamentárias' }),
  despesa_empenhada_sem_intra: dca({ tipo: 'reais', rotulo: 'despesa total empenhada sem intra (R$)', definicao: 'despesa total empenhada exceto intraorçamentárias (anexo I-E)', filtros: 'empenhada; sem intraorçamentárias' }),
  despesa_corrente: dca({ tipo: 'reais', rotulo: 'despesa corrente empenhada (R$)', definicao: 'despesas correntes empenhadas, exceto intraorçamentárias (anexo I-D, DO3)', filtros: 'empenhada; sem intraorçamentárias', classificacao: 'categoria econômica da despesa 3 (correntes)' }),
  despesa_capital: dca({ tipo: 'reais', rotulo: 'despesa de capital empenhada (R$)', definicao: 'despesas de capital empenhadas, exceto intraorçamentárias (anexo I-D, DO4)', filtros: 'empenhada; sem intraorçamentárias', classificacao: 'categoria econômica da despesa 4 (capital)' }),
  despesa_pessoal: dca({
    tipo: 'reais', rotulo: 'despesa com pessoal empenhada (R$)', definicao: 'pessoal e encargos sociais, empenhada, exceto intraorçamentárias (anexo I-D, DO3.1)',
    filtros: 'empenhada; sem intraorçamentárias', classificacao: 'grupo de natureza da despesa 1 (Portaria Interministerial 163/2001)',
    ressalva: 'não é a despesa com pessoal da LRF (lrf.despesa_pessoal), que tem exclusões próprias',
  }),
  despesa_administracao: dca({ tipo: 'reais', rotulo: 'Função 04 – Administração, empenhada (R$)', definicao: 'despesa da função 04 (Administração), empenhada, exceto intraorçamentárias (anexo I-E)', filtros: 'empenhada; sem intraorçamentárias', classificacao: FUNCOES }),
  despesa_administracao_liquidada: dca({ tipo: 'reais', rotulo: 'Função 04 – Administração, liquidada (R$)', definicao: 'função 04, liquidada, exceto intraorçamentárias (anexo I-E)', filtros: 'liquidada; sem intraorçamentárias', classificacao: FUNCOES }),
  despesa_administracao_paga: dca({ tipo: 'reais', rotulo: 'Função 04 – Administração, paga (R$)', definicao: 'função 04, paga, exceto intraorçamentárias (anexo I-E)', filtros: 'paga; sem intraorçamentárias', classificacao: FUNCOES }),
  funcao_cod: dca({ tipo: 'codigo', rotulo: 'função (código)', definicao: 'código da função de governo na DCA (F01 a F28)', tabelas: ['despesa_funcao'], classificacao: 'funções de governo (Portaria MOG 42/1999)' }),
  indice: { tipo: 'indice', rotulo: 'número-índice do IPCA (dez/2009 = 1)', definicao: 'IPCA acumulado em dezembro', fonte: 'IPCA (Banco Central, SGS 433)', tabelas: ['ipca'] },
  fator: { tipo: 'indice', rotulo: 'fator de deflação', definicao: 'índice do ano-base ÷ índice do ano', fonte: 'IPCA (Banco Central, SGS 433)' },
  fator_real: {
    tipo: 'indice', rotulo: 'fator de deflação (R$ do ano-base)', definicao: 'índice de dezembro do ano-base ÷ índice de dezembro do ano; valor real = nominal × fator_real',
    fonte: 'IPCA (Banco Central, SGS 433)', tabelas: ['ipca'],
  },
  empregos_adm_publica: {
    tipo: 'contagem', rotulo: 'vínculos na Administração pública (CNAE 84)', fonte: RAIS, tabelas: ['trab_municipios'], cobertura: 'rais', territorio: 'municípios (do estabelecimento)',
    definicao: 'vínculos ativos em 31/12 em estabelecimentos da divisão 84 da CNAE 2.0 (atividade), de todas as esferas, no município do estabelecimento',
    filtros: 'vínculos ativos em 31/12', classificacao: 'CNAE 2.0, divisão 84 (Administração pública, defesa e seguridade social)',
    ressalva: 'é atividade, não natureza jurídica: escolas e hospitais públicos ficam em educação e saúde; inclui órgãos estaduais e federais situados no município',
  },
  // estatísticas: sem unidade monetária
  termo: estat('texto', 'termo', 'variável do modelo'),
  coeficiente: estat('estatistica', 'coeficiente', 'coeficiente estimado por MQO'),
  erro_padrao: estat('estatistica', 'erro-padrão', 'erro-padrão do coeficiente'),
  estatistica_t: estat('estatistica', 'estatística t', 'coeficiente ÷ erro-padrão'),
  p_valor: estat('estatistica', 'p-valor', 'p-valor bilateral pela t de Student'),
  ic95_inferior: estat('estatistica', 'IC 95% (inferior)', 'limite inferior do intervalo de 95%'),
  ic95_superior: estat('estatistica', 'IC 95% (superior)', 'limite superior do intervalo de 95%'),
  n_observacoes: estat('contagem', 'observações', 'observações completas usadas na estimação'),
  r2: estat('estatistica', 'R²', 'proporção da variância de y associada linearmente aos regressores'),
  r2_ajustado: estat('estatistica', 'R² ajustado', 'R² corrigido pelos graus de liberdade'),
  graus_liberdade: estat('contagem', 'graus de liberdade', 'n − k'),
  descartadas_por_ausencia: estat('contagem', 'linhas descartadas por ausência', 'linhas da consulta com algum valor ausente'),
};

const intervalo = (anos?: number[]) => (anos?.length ? `${anos[0]} a ${anos.at(-1)}` : '');

/** Cobertura temporal da coluna: os anos da fonte no manifesto, ou o texto fixo do catálogo. */
export function coberturaDaColuna(c: Coluna, cob?: Cobertura | null): string {
  if (c.cobertura === 'dca') return intervalo(cob?.dca);
  if (c.cobertura === 'rais') return intervalo(cob?.rais);
  if (c.cobertura === 'pib') return cob?.pib ? `${cob.pib.de} a ${cob.pib.ate}` : '';
  return c.cobertura ?? '';
}

/**
 * Ficha de uma coluna do catálogo para a exportação e para a tela: definição, fonte, cobertura, filtros,
 * classificação, se é valor oficial ou recalculado e ressalvas. Colunas calculadas na consulta não têm ficha.
 */
export function fichaDaColuna(nome: string, cob?: Cobertura | null): string | null {
  const c = COLUNAS[nome.toLowerCase()];
  if (!c || c.fonte === REG) return null;
  const anos = coberturaDaColuna(c, cob);
  return [
    `${c.definicao.replace(/^./, (x) => x.toUpperCase())}.`,
    c.fonte && `Fonte: ${c.fonte}.`,
    (anos || c.territorio) && `Cobertura: ${[anos, c.territorio].filter(Boolean).join('; ')}.`,
    c.filtros && `Filtros: ${c.filtros}.`,
    c.classificacao && `Classificação: ${c.classificacao}.`,
    c.oficial ? `Valor publicado por ${c.oficial}, sem transformação pelo painel.` : /recalculad/.test(c.definicao) ? 'Indicador recalculado pelo painel.' : '',
    c.ressalva && `Ressalva: ${c.ressalva}.`,
  ].filter(Boolean).join(' ');
}

/**
 * Unidade declarada pelo modelo para cada coluna da consulta (campo colunas de "consultar") → tipo da tela.
 * reais_por_habitante e pontos_percentuais mudam só o rótulo.
 */
export const UNIDADES: Record<string, TipoColuna> = {
  reais: 'reais', reais_por_habitante: 'reais', contagem: 'contagem', habitantes: 'contagem', percentual: 'percentual',
  pontos_percentuais: 'percentual', razao: 'razao', estatistica: 'estatistica', indice: 'indice', codigo: 'codigo',
  ano: 'ano', competencia: 'competencia', texto: 'texto',
};

/** Tipo pelo nome de estatística (correlação, R², t, p): nunca R$, mesmo com fpm ou despesa no nome. */
export const RE_ESTATISTICA = /^(corr|correlacao|spearman|pearson|r2|r_quadrado|rsq|coef|coeficiente|beta|inclinacao|intercepto|elasticidade|t|t_stat|estatistica_t|p|p_valor|pvalor|p_value|erro_padrao|se|desvio_padrao|dp|ic95(_\w+)?)(_|$)|(^|_)(corr|correlacao|spearman|pearson|r2|coef|elasticidade|p_valor|pvalor|t_stat|erro_padrao)$/i;

// ---------------- conceitos pedidos × variáveis usadas ----------------

export type Conceito = {
  id: string;
  nome: string;
  /** a pergunta pede este conceito */
  pedido: RegExp;
  /** colunas ou filtros que o atendem (no SQL, sem os textos entre aspas, exceto os códigos de função) */
  atende: RegExp;
  /** o que dizer ao modelo quando a resposta não o usa */
  orientacao: string;
};

export const CONCEITOS: Conceito[] = [
  {
    id: 'funcao_04', nome: 'Função 04 – Administração',
    pedido: /fun[çc][ãa]o\s*(0?4\b|administra)|despesas?\s+(com\s+)?administra[çc][ãa]o\b|despesas?\s+administrativ|gastos?\s+(com\s+)?administra[çc][ãa]o\b|gastos?\s+administrativ|custeio\s+administrativ/i,
    atende: /\bdespesa_administracao(_liquidada|_paga)?\b|'F04'/i,
    orientacao: 'use indicadores.despesa_administracao (empenhada; _liquidada e _paga nos outros estágios) ou despesa_funcao com funcao_cod = \'F04\' (anexo I-E, exceto intraorçamentárias); despesa total, corrente ou com pessoal não são a função 04',
  },
  {
    id: 'despesa_pessoal', nome: 'despesa com pessoal',
    pedido: /despesas?\s+(com\s+|de\s+)?pessoal|gastos?\s+com\s+pessoal|folha\s+de\s+pagamento/i,
    atende: /\bdespesa_pessoal\b|\bpessoal_rcl_pct\b/i,
    orientacao: 'use indicadores.despesa_pessoal (pessoal e encargos, empenhada, exceto intraorçamentárias) ou, para o limite da LRF, lrf.despesa_pessoal',
  },
  {
    id: 'despesa_corrente', nome: 'despesas correntes',
    pedido: /despesas?\s+correntes?/i,
    atende: /\bdespesa_corrente\b/i,
    orientacao: 'use indicadores.despesa_corrente (empenhada, exceto intraorçamentárias)',
  },
  {
    id: 'receita_corrente', nome: 'receitas correntes',
    pedido: /receitas?\s+correntes?/i,
    atende: /\breceita_corrente\b|\brcl(_ajustada)?\b/i,
    orientacao: 'use indicadores.receita_corrente (bruta realizada, sem intraorçamentárias) ou, se pedirem a líquida da LRF, lrf.rcl',
  },
  {
    id: 'fpm', nome: 'FPM',
    pedido: /\bfpm\b|fundo\s+de\s+participa[çc][ãa]o\s+dos\s+munic/i,
    atende: /\bfpm\b/i,
    orientacao: 'use indicadores.fpm',
  },
  {
    id: 'pib_per_capita', nome: 'PIB per capita',
    pedido: /pib\s+per\s+capita|pib\s+por\s+habitante/i,
    // pib_per_capita, ou o PIB com a população do IBGE (populacao_ibge, ou a de trab_municipios)
    atende: /\bpib_per_capita\b|\bpib\b[\s\S]*\bpopulacao_ibge\b|\bpopulacao_ibge\b[\s\S]*\bpib\b|^(?=[\s\S]*\bpib\b)(?=[\s\S]*\btrab_municipios\b)(?=[\s\S]*\bpopulacao\b)/i,
    orientacao: 'use indicadores.pib_per_capita (PIB ÷ população do IBGE, a mesma regra do IBGE Cidades), não o PIB dividido pela população declarada na DCA',
  },
  {
    id: 'vinculos_municipais', nome: 'vínculos da prefeitura (natureza jurídica municipal)',
    pedido: /v[ií]nculos?\s+(da|na|das)\s+prefeitura|servidores?\s+(municipais|da\s+prefeitura)|emprego\s+p[úu]blico\s+municipal|funcionalismo\s+municipal/i,
    atende: /\bnatureza_juridica\b/i,
    orientacao: 'a prefeitura é identificada pela natureza jurídica municipal (1031, 1244, 1120, 1155), só nos microdados (rais_vinculos); a divisão 84 da CNAE (empregos_adm_publica) é a atividade e inclui órgãos estaduais e federais no município. Sem os microdados, diga isso e não use a CNAE 84 como resposta',
  },
];

/** Texto da consulta sem os literais, salvo os códigos de função ('F04'), que identificam a variável. */
const sqlParaConceito = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, (m) => (/^'F\d{2}'$/i.test(m) ? m : "''"));

export const conceitosPedidos = (pergunta: string) => CONCEITOS.filter((c) => c.pedido.test(pergunta));
export const atendeConceito = (c: Conceito, sql: string) => c.atende.test(sqlParaConceito(sql));
