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
];

/** Parâmetros do recorte que acompanham a navegação entre as páginas da área de trabalho. */
export const PARAMS_TRABALHO = ['cbo', 'cnae', 'sit', 'sexo', 'muns', ...FILTROS_AVANCADOS().map((f) => f.chave),
  'agr', 'agr2', 'pct', 'cols', 'nmin', 'moeda', 'de', 'ate', 'base', 'ord', 'rord', 'min'];

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
