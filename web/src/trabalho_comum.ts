/**
 * Peças comuns às páginas do mercado de trabalho: o recorte da consulta guardado na URL (o mesmo em todas
 * as páginas da área, para navegar, recarregar e compartilhar sem perder o recorte), as quebras de série da
 * RAIS e os metadados das exportações. Nada daqui vale para o painel de finanças.
 */
import { useSearchParams } from 'react-router-dom';
import type { Marca } from './components/Grafico';
import { baixarArquivo, nomeArquivo, paraCsv, zip, type Tabela } from './exportar';
import { t } from './idioma';

// ---------------- recorte da consulta na URL ----------------

/** Filtros por lista de códigos (iguais aos de FILTROS_LISTA em dados.ts), com a variável do dicionário dos nomes. */
export const FILTROS_AVANCADOS = (): { chave: string; variavel: string; rotulo: string }[] => [
  { chave: 'idade', variavel: 'faixa_idade', rotulo: t('Faixa de idade', 'Age group') },
  { chave: 'esc', variavel: 'escolaridade', rotulo: t('Escolaridade', 'Education') },
  { chave: 'raca', variavel: 'raca_cor', rotulo: t('Raça/cor', 'Race/colour') },
  { chave: 'si', variavel: 'setor_institucional', rotulo: t('Setor institucional (natureza jurídica)', 'Institutional sector (legal nature)') },
  { chave: 'esf', variavel: 'esfera_adm', rotulo: t('Esfera administrativa', 'Level of government') },
  { chave: 'njg', variavel: 'natureza_juridica_grupo', rotulo: t('Natureza jurídica (grupo)', 'Legal nature (group)') },
  { chave: 'vmte', variavel: 'vinculo_mte', rotulo: t('Tipo de vínculo (agregação do MTE)', 'Type of contract (MTE grouping)') },
  { chave: 'tv', variavel: 'tipo_vinculo', rotulo: t('Tipo de vínculo (detalhado)', 'Type of contract (detailed)') },
  { chave: 'tam', variavel: 'tamanho_estab', rotulo: t('Tamanho do estabelecimento', 'Establishment size') },
  { chave: 'horas', variavel: 'faixa_horas', rotulo: t('Jornada contratual semanal', 'Contracted weekly hours') },
  { chave: 'tempo', variavel: 'faixa_tempo', rotulo: t('Tempo no emprego', 'Job tenure') },
  { chave: 'pcd', variavel: 'pcd', rotulo: t('Pessoa com deficiência (indicador)', 'Person with disability (indicator)') },
  { chave: 'tdef', variavel: 'tipo_deficiencia', rotulo: t('Tipo de deficiência ou reabilitado', 'Disability type or rehabilitated') },
  { chave: 'nac', variavel: 'nacionalidade', rotulo: t('Nacionalidade', 'Nationality') },
  { chave: 'parc', variavel: 'trab_parcial', rotulo: t('Trabalho parcial', 'Part-time contract') },
  { chave: 'intm', variavel: 'trab_intermitente', rotulo: t('Trabalho intermitente', 'Intermittent contract') },
];

/** Parâmetros do recorte que acompanham a navegação entre as páginas da área de trabalho. */
export const PARAMS_TRABALHO = ['cbo', 'cnae', 'sit', 'sexo', 'muns', ...FILTROS_AVANCADOS().map((f) => f.chave),
  'agr', 'agr2', 'eagr', 'pct', 'cols', 'nmin', 'moeda', 'de', 'ate', 'base', 'ord', 'rord', 'min'];

export type Recorte = {
  cbo: string; cnae: string; situacao: string; sexo: string; muns: string;
  listas: Record<string, string>;
  agrupar: string; agrupar2: string; pct: 'abs' | 'linha' | 'coluna';
  cols: string[] | null; nmin: number; moeda: 'nominal' | 'real';
  de: number | null; ate: number | null; base: number | null; ord: string; min: number;
};

const lerNumero = (v: string | null) => (v && /^\d+$/.test(v) ? Number(v) : null);

export function lerRecorte(busca: URLSearchParams): Recorte {
  const listas: Record<string, string> = {};
  for (const f of FILTROS_AVANCADOS()) if (busca.get(f.chave)) listas[f.chave] = busca.get(f.chave)!;
  const pct = busca.get('pct');
  return {
    cbo: busca.get('cbo') ?? '', cnae: busca.get('cnae') ?? '', situacao: busca.get('sit') ?? '', sexo: busca.get('sexo') ?? '',
    muns: busca.get('muns') ?? '', listas,
    agrupar: busca.get('agr') ?? '', agrupar2: busca.get('agr2') ?? '',
    pct: pct === 'linha' || pct === 'coluna' ? pct : 'abs',
    cols: busca.get('cols') ? busca.get('cols')!.split(',').filter(Boolean) : null,
    nmin: lerNumero(busca.get('nmin')) ?? 30,
    moeda: busca.get('moeda') === 'real' ? 'real' : 'nominal',
    de: lerNumero(busca.get('de')), ate: lerNumero(busca.get('ate')), base: lerNumero(busca.get('base')),
    ord: busca.get('ord') ?? '', min: lerNumero(busca.get('min')) ?? 0,
  };
}

/** Parâmetros do recorte para as rotas de dados (trab_consulta e trab_consulta_serie). */
export function paramsDoRecorte(r: Recorte): Record<string, string> {
  return { cbo: r.cbo, cnae: r.cnae, situacao: r.situacao, sexo: r.sexo, muns: r.muns, ...r.listas };
}

/** O recorte guardado na URL e como mudá-lo (sem empilhar no histórico do navegador). */
export function useRecorte() {
  const [busca, setBusca] = useSearchParams();
  const recorte = lerRecorte(busca);
  const definir = (novo: Record<string, string | number | null | undefined>, empilhar = false) => {
    const p = new URLSearchParams(busca);
    for (const [k, v] of Object.entries(novo)) {
      if (v === null || v === undefined || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    setBusca(p, { replace: !empilhar });
  };
  return { recorte, definir, busca };
}

/** Parâmetros dos filtros de vínculos (os que `temFiltrosDeRecorte` conta), para limpá-los de uma vez. */
export const CHAVES_FILTROS_RECORTE = ['cbo', 'cnae', 'sit', 'sexo', 'muns', ...FILTROS_AVANCADOS().map((f) => f.chave)];

/** Agrupamentos da página Estabelecimentos, num parâmetro próprio (eagr): não toca no agr da Consulta de vínculos. */
export const AGRUPAMENTOS_ESTAB = ['porte', 'divisao', 'natureza_juridica', 'simples', 'pat'];
export const lerAgrupamentoEstab = (busca: URLSearchParams) => AGRUPAMENTOS_ESTAB.find((x) => x === busca.get('eagr')) ?? 'porte';

/** Filtros do recorte que mudam o universo (os de exibição, como agrupamento e colunas, não contam). */
export const temFiltrosDeRecorte = (r: Recorte) => !!(r.cbo || r.cnae || r.situacao || r.sexo || r.muns || Object.keys(r.listas).length);

// ---------------- quebras de série da RAIS ----------------

export const NOTA_RAIS_2022 = 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais/rais-2022/nota-tecnica-rais-2022.pdf';
export const NOTA_RAIS_2023 = 'https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais/rais-2023/nota-tecnica-rais-2023_11-12-2024.pdf';

/**
 * Anos em que o MTE aponta quebra na série da RAIS (notas técnicas de 2022 e 2023): a captação passou ao
 * eSocial por grupos de empregadores. Os textos dizem só o que as notas dizem.
 */
export const QUEBRAS_RAIS = (): { ano: number; curto: string; texto: string; url: string }[] => [
  {
    ano: 2022, curto: t('quebra 2022', 'break 2022'), url: NOTA_RAIS_2022,
    texto: t(
      '2022: primeiro ano em que os empregadores do Simples Nacional, as entidades sem fins lucrativos e os empregadores pessoa física (Grupo 3) foram captados pelo eSocial. O MTE aponta maior cobertura e quebra importante na série.',
      '2022: first year in which Simples Nacional employers, non-profit entities and individual employers (Group 3) were captured through eSocial. The Ministry reports wider coverage and a significant break in the series.',
    ),
  },
  {
    ano: 2023, curto: t('quebra 2023', 'break 2023'), url: NOTA_RAIS_2023,
    texto: t(
      '2023: primeiro ano com os órgãos públicos e organizações internacionais (Grupo 4) no eSocial. O MTE registra quebra no tipo de vínculo (estatutários passaram a contratos por lei estadual ou municipal), subdeclaração de remuneração de estatutários e mudança no preenchimento de raça/cor, e não recomenda comparar diretamente com anos anteriores.',
      '2023: first year with public bodies and international organisations (Group 4) on eSocial. The Ministry reports a break in the type of contract (statutory jobs moved to state or municipal law contracts), under-reporting of statutory pay and a change in race/colour reporting, and advises against direct comparison with earlier years.',
    ),
  },
];

/** Quebras entre dois anos (exclusive o primeiro): a variação de `de` a `ate` atravessa cada uma delas. */
export const quebrasEntre = (de: number, ate: number) => QUEBRAS_RAIS().filter((q) => q.ano > Math.min(de, ate) && q.ano <= Math.max(de, ate));

/** Linhas tracejadas nos anos de quebra que aparecem no eixo. */
export function marcasQuebra(anos: (number | string)[]): Marca[] {
  const qs = QUEBRAS_RAIS().filter((q) => anos.map(String).includes(String(q.ano)));
  // anos vizinhos: um rótulo só, na última linha, para os textos não se sobreporem
  if (qs.length > 1) return qs.map((q, i) => ({ x: String(q.ano), rotulo: i === qs.length - 1 ? t(`quebras ${qs.map((x) => x.ano).join(' e ')}`, `breaks ${qs.map((x) => x.ano).join(' and ')}`) : '' }));
  return qs.map((q) => ({ x: String(q.ano), rotulo: q.curto }));
}

/** Nota de comparabilidade para metadados e avisos de um período, ou null se ele não cruza nenhuma quebra. */
export function notaComparabilidade(anos: number[]): string | null {
  if (anos.length < 2) return null;
  const qs = quebrasEntre(Math.min(...anos), Math.max(...anos));
  if (!qs.length) return null;
  return `${t('Comparabilidade', 'Comparability')}: ${qs.map((q) => q.texto).join(' ')} ${t(
    'Variações que atravessam esses anos são observadas e podem refletir mudanças de cobertura ou de classificação, não só do mercado de trabalho.',
    'Changes across these years are observed and may reflect coverage or classification changes, not only labour-market changes.',
  )} ${t('Notas técnicas do MTE', 'Ministry technical notes')}: ${qs.map((q) => q.url).join(' ; ')}`;
}

// ---------------- grupos pequenos e números ----------------

/** O grupo tem menos vínculos do que o mínimo configurado (padrão 30): o valor sai marcado. */
export const pequeno = (n: number | null | undefined, nmin: number) => n !== null && n !== undefined && n < nmin;

// ---------------- pacote de pesquisa ----------------

/**
 * Pacote para artigos (zip): uma planilha CSV por tabela, metadados.csv, consulta.json (a especificação do
 * recorte e o endereço da página) e, quando houver, consulta.sql com o SQL que gerou cada tabela, sobre os
 * arquivos publicados.
 */
export function baixarPacote(nome: string, tabelas: { nome: string; tabela: Tabela; sql?: string }[], especificacao: unknown, decimal: string) {
  const arquivos: [string, string][] = tabelas.map((x, i) => [`${String(i + 1).padStart(2, '0')}_${nomeArquivo(x.nome)}.csv`, paraCsv(x.tabela, decimal)]);
  const meta = tabelas[0]?.tabela.metadados ?? [];
  arquivos.push(['metadados.csv', paraCsv({ colunas: [t('Campo', 'Field'), t('Valor', 'Value')], linhas: meta, metadados: [] }, decimal)]);
  arquivos.push(['consulta.json', JSON.stringify(especificacao, null, 2)]);
  const sqls = tabelas.filter((x) => x.sql).map((x) => `-- ${x.nome}\n${x.sql!.trim()};\n`);
  if (sqls.length) {
    arquivos.push(['consulta.sql', `-- ${t('SQL (DuckDB) que gerou as tabelas, sobre os arquivos Parquet publicados pelo painel.', 'SQL (DuckDB) that produced the tables, over the Parquet files published by the dashboard.')}\n\n${sqls.join('\n')}`]);
  }
  baixarArquivo(`${nomeArquivo(nome)}.zip`, zip(arquivos) as BlobPart, 'application/zip');
}

// ---------------- atalhos temáticos e concentração ----------------

/**
 * Endereço de uma análise pronta: guarda só o território e o ano da URL atual (ano, uf, ente) e descarta o
 * resto do recorte (ocupação, atividade, listas, agrupamentos), que poderia ser incompatível com a análise.
 */
export function urlAnalise(busca: URLSearchParams, caminho: string, params: Record<string, string>): string {
  const p = new URLSearchParams();
  for (const k of ['ano', 'uf', 'ente']) if (busca.get(k)) p.set(k, busca.get(k)!);
  for (const [k, v] of Object.entries(params)) p.set(k, v);
  return `${caminho}?${p}`;
}

/** Atalhos da visão geral para a Consulta personalizada. `micro`: o agrupamento ou filtro só existe nos microdados (UF ou município). */
export const ATALHOS_RAIS = (): { id: string; titulo: string; desc: string; params: Record<string, string>; micro: boolean }[] => [
  { id: 'sexo', micro: false, params: { sit: 'ativos', agr: 'sexo' }, titulo: t('Sexo e remuneração', 'Sex and pay'),
    desc: t('Vínculos ativos e remuneração média de dezembro de homens e mulheres.', 'Active jobs and average December pay of men and women.') },
  { id: 'raca', micro: true, params: { sit: 'ativos', agr: 'raca_cor' }, titulo: t('Raça/cor', 'Race/colour'),
    desc: t('Composição dos vínculos ativos e remuneração por raça/cor declarada.', 'Composition of active jobs and pay by reported race/colour.') },
  { id: 'esc', micro: true, params: { sit: 'ativos', agr: 'escolaridade' }, titulo: t('Escolaridade', 'Education'),
    desc: t('Quantos vínculos há em cada nível de instrução e quanto pagam.', 'How many jobs sit at each education level and what they pay.') },
  { id: 'jovens', micro: true, params: { sit: 'ativos', idade: '1,2', agr: 'cnae_secao' }, titulo: t('Jovens (até 24 anos)', 'Young workers (up to 24)'),
    desc: t('Em quais atividades (seções da CNAE) estão os vínculos de quem tem até 24 anos.', 'Which activities (CNAE sections) hold the jobs of workers up to 24.') },
  { id: 'ocup', micro: false, params: { sit: 'ativos', agr: 'cbo_grande_grupo' }, titulo: t('Ocupações', 'Occupations'),
    desc: t('Vínculos e remuneração pelos grandes grupos da CBO; depois, refine por família ou ocupação.', 'Jobs and pay by CBO major group; then refine by family or occupation.') },
  { id: 'publico', micro: true, params: { sit: 'ativos', agr: 'setor_institucional' }, titulo: t('Setor público por natureza jurídica', 'Public sector by legal nature'),
    desc: t('Administração pública, empresas estatais e setor privado pelo cadastro do estabelecimento (não pela atividade CNAE 84).', 'Public administration, state-owned firms and private sector by the establishment’s legal nature (not by CNAE 84 activity).') },
  { id: 'porte', micro: true, params: { sit: 'ativos', agr: 'tamanho_estab' }, titulo: t('Porte do estabelecimento', 'Establishment size'),
    desc: t('Vínculos e remuneração por faixa de tamanho do estabelecimento.', 'Jobs and pay by establishment size band.') },
  { id: 'jornada', micro: true, params: { sit: 'ativos', agr: 'faixa_horas', agr2: 'faixa_tempo' }, titulo: t('Jornada e tempo no emprego', 'Hours and job tenure'),
    desc: t('Cruzamento da jornada contratual semanal com o tempo no emprego.', 'Cross-tab of contracted weekly hours and job tenure.') },
  { id: 'pcd', micro: true, params: { sit: 'ativos', agr: 'tipo_deficiencia' }, titulo: t('Deficiência e reabilitados', 'Disability and rehabilitated'),
    desc: t('Vínculos por tipo de deficiência declarada e reabilitados (código 6), ao lado dos sem deficiência declarada. Descreve o campo da RAIS: não mede cumprimento de cotas.', 'Jobs by declared disability type and rehabilitated (code 6), next to those with no declared disability. It describes the RAIS field: it does not measure quota compliance.') },
  { id: 'nac', micro: true, params: { sit: 'ativos', agr: 'nacionalidade' }, titulo: t('Nacionalidade', 'Nationality'),
    desc: t('Vínculos por nacionalidade declarada. Conta vínculos, não pessoas nem migrantes únicos.', 'Jobs by declared nationality. It counts jobs, not people or unique migrants.') },
  { id: 'modalidade', micro: true, params: { sit: 'ativos', agr: 'trab_parcial', agr2: 'trab_intermitente' }, titulo: t('Trabalho parcial e intermitente', 'Part-time and intermittent work'),
    desc: t('Cruzamento dos dois indicadores de modalidade; “sem informação” é o campo vazio do arquivo do ano (não é “não”).', 'Cross-tab of the two contract-modality indicators; “no information” is the file’s empty field for the year (not “no”).') },
  { id: 'afast', micro: true, params: { sit: 'afastados', agr: 'causa_afastamento' }, titulo: t('Afastamentos no ano', 'Leaves during the year'),
    desc: t('Vínculos com afastamento no ano por causa (primeira informada). O mês da RAIS é o ano de referência, não o fluxo mensal do CAGED.', 'Jobs with a leave during the year by reason (first reported). RAIS is annual, not the monthly CAGED flow.') },
  { id: 'deslig', micro: true, params: { sit: 'desligados', agr: 'motivo_desligamento' }, titulo: t('Motivos de desligamento no ano', 'Separation reasons in the year'),
    desc: t('Vínculos desligados no ano por motivo, sem calcular rotatividade; difere das movimentações mensais do CAGED.', 'Jobs separated in the year by reason, without computing turnover; different from CAGED monthly movements.') },
];

/**
 * Total de um recorte a partir dos seus grupos (todo vínculo ativo cai em algum grupo): ativos, N com remuneração e
 * a média de dezembro = soma das remunerações ÷ ativos (nunca média das médias). A soma e a média ficam null
 * quando ninguém tem remuneração informada (como o motor) e o total fica null sem vínculos ativos.
 */
export function totalDosGrupos(linhas: Record<string, unknown>[]) {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const ativos = linhas.reduce((s, r) => s + n(r.ativos), 0);
  if (!(ativos > 0)) return null;
  const nRem = linhas.reduce((s, r) => s + n(r.n_rem_dez), 0);
  const soma = nRem > 0 && linhas.some((r) => typeof r.rem_dez_soma === 'number') ? linhas.reduce((s, r) => s + n(r.rem_dez_soma), 0) : null;
  return { vinculos: ativos, ativos, n_rem_dez: nRem, rem_dez_soma: soma, rem_dez_media: soma === null ? null : soma / ativos };
}

export type Concentracao = { top3: { nome: string; parte: number }[]; parteTop3: number; hhi: number; efetivo: number; n: number; total: number };

/**
 * Concentração de uma distribuição de vínculos (ex.: divisões da CNAE de um território).
 * Participação s_i = vínculos_i ÷ Σ vínculos; HHI = Σ s_i² (0 a 1; ×10.000 na tela); número efetivo = 1 ÷ HHI.
 * Usa todas as categorias com valor positivo; sem soma positiva devolve null (nunca zero falso).
 */
export function concentracao(itens: { nome: string; valor: number | null | undefined }[]): Concentracao | null {
  const v = itens.filter((i) => typeof i.valor === 'number' && Number.isFinite(i.valor) && i.valor > 0) as { nome: string; valor: number }[];
  const total = v.reduce((s, i) => s + i.valor, 0);
  if (!v.length || !(total > 0)) return null;
  const partes = v.map((i) => ({ nome: i.nome, parte: i.valor / total })).sort((a, b) => b.parte - a.parte);
  const hhi = partes.reduce((s, i) => s + i.parte * i.parte, 0);
  const top3 = partes.slice(0, 3);
  return { top3, parteTop3: top3.reduce((s, i) => s + i.parte, 0), hhi, efetivo: 1 / hhi, n: v.length, total };
}
