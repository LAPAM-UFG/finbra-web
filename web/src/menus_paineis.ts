import type { Area } from './navegacao';

export type PaginaMenu = [caminho: string, rotulo: string];
export type GrupoMenu = [titulo: string, paginas: PaginaMenu[]];
type Traduzir = (pt: string, en: string) => string;

/** O mesmo catálogo orienta o menu do computador e o do celular, sem buscar dados. */
export function menuDoPainel(area: Area, t: Traduzir): GrupoMenu[] {
  const painel = (raiz: string): GrupoMenu => [t('Painel', 'Dashboard'), [[raiz, t('Painel de indicadores', 'Indicator dashboard')]]];
  const comparar = (raiz: string, mapa = true, ranking = true): GrupoMenu => [
    t('Comparar e acompanhar', 'Compare and track'),
    [
      [raiz + '/comparar', t('Comparar regiões e períodos', 'Compare regions and periods')],
      ...(mapa ? [[raiz + '/mapa', t('Mapa de indicadores', 'Indicator map')] as PaginaMenu] : []),
      ...(ranking ? [[raiz + '/rankings', t('Rankings', 'Rankings')] as PaginaMenu] : []),
    ],
  ];
  const fontes = (raiz: string): GrupoMenu => [t('Fontes e conceitos', 'Sources and concepts'), [[raiz + '/metodologia', t('Fontes e metodologia', 'Sources and methodology')]]];
  const series = (raiz: string, caminho = '/serie'): GrupoMenu => [t('Séries e tabelas', 'Series and tables'), [
    [raiz + caminho, t('Série detalhada', 'Detailed series')],
    [raiz + '/tabela', t('Tabela e exportações', 'Table and exports')],
  ]];

  switch (area) {
    case 'financas': return [
      [t('Receitas', 'Revenue'), [
        ['/receitas', t('Visão geral de receitas', 'Revenue overview')],
        ['/receitas/evolucao', t('Evolução das receitas', 'Revenue trends')],
      ]],
      [t('Comparar e acompanhar', 'Compare and track'), [
        ['/comparar', t('Comparar regiões e períodos', 'Compare regions and periods')],
        ['/rankings', t('Rankings fiscais', 'Fiscal rankings')],
      ]],
      [t('Fundo de participação (FPM)', 'Municipal fund (FPM)'), [
        ['/fpm', t('Evolução e dependência', 'Trends and dependency')],
        ['/fpm/faixas', t('Faixas populacionais', 'Population brackets')],
      ]],
      [t('Despesas orçamentárias', 'Budget expenditure'), [
        ['/despesas-orcamentarias', t('Visão geral', 'Overview')],
        ['/despesas-orcamentarias/evolucao', t('Evolução', 'Trends')],
      ]],
      [t('Despesas por função', 'Expenditure by function'), [
        ['/despesas', t('Visão geral', 'Overview')],
        ['/despesas/evolucao', t('Evolução', 'Trends')],
      ]],
      [t('Responsabilidade fiscal', 'Fiscal responsibility'), [
        ['/lrf', t('Indicadores da LRF', 'LRF indicators')],
        ['/lrf/demonstrativos', t('Demonstrativos RREO e RGF', 'RREO and RGF statements')],
      ]],
      [t('Saúde e educação', 'Health and education'), [
        ['/educacao/financiamento', t('Educação: gastos e aplicação', 'Education: expenditure and allocation')],
        ['/educacao/profissionais', t('Profissionais da educação', 'Education staff')],
        ['/saude/financiamento', t('Despesa em saúde (SIOPS)', 'Health expenditure (SIOPS)')],
      ]],
      [t('Mais análises', 'More analysis'), [
        ['/demonstrativos', t('Demonstrativos (7 anexos)', 'Financial statements (7 annexes)')],
        ['/socioeconomico', t('Economia e população', 'Economy and population')],
      ]],
      [t('Fontes e conceitos', 'Sources and concepts'), [
        ['/deflatores', t('Inflação e deflatores', 'Inflation and deflators')],
        ['/qualidade', t('Qualidade e fontes', 'Quality and sources')],
      ]],
    ];
    case 'trabalho': return [
      painel('/trabalho'), comparar('/trabalho'),
      [t('Trabalhadores e empresas', 'Workers and businesses'), [
        ['/trabalho/perfil', t('Perfil dos vínculos', 'Jobs profile')],
        ['/trabalho/remuneracao', t('Remuneração e desigualdades', 'Pay and inequality')],
        ['/trabalho/estabelecimentos', t('Estabelecimentos', 'Establishments')],
        ['/trabalho/caged', t('Emprego mês a mês (CAGED)', 'Monthly employment (CAGED)')],
      ]],
      [t('Séries e consultas', 'Series and queries'), [
        ['/trabalho/evolucao', t('Série detalhada da RAIS', 'Detailed RAIS series')],
        ['/trabalho/consulta', t('Consulta personalizada', 'Custom query')],
      ]], fontes('/trabalho'),
    ];
    case 'saude': return [
      painel('/datasus'), comparar('/datasus'),
      [t('Temas de saúde', 'Health topics'), [
        ['/datasus/rede', t('Rede e acesso', 'Network and access')],
        ['/datasus/ambulatorial', t('Produção ambulatorial', 'Outpatient output')],
        ['/datasus/vacinacao', t('Vacinação', 'Vaccination')],
      ]],
      [t('Financiamento', 'Funding'), [
        ['/saude/financiamento', t('Despesa em saúde (SIOPS)', 'Health expenditure (SIOPS)')],
        ['/datasus/financiamento', t('Financiamento federal', 'Federal funding')],
      ]], series('/datasus', '/evolucao'), fontes('/datasus'),
    ];
    case 'educacao': return [
      painel('/educacao'), comparar('/educacao'),
      [t('Financiamento', 'Funding'), [
        ['/educacao/financiamento', t('Gastos e aplicação (SIOPE)', 'Expenditure and allocation (SIOPE)')],
        ['/educacao/profissionais', t('Profissionais da educação', 'Education staff')],
      ]], series('/educacao'), fontes('/educacao'),
    ];
    case 'assistencia': return [
      painel('/assistencia'),
      [t('Comparar e acompanhar', 'Compare and track'), [
        ['/assistencia/comparar', t('Comparar regiões e períodos', 'Compare regions and periods')],
        ['/assistencia/rankings', t('Rankings mensais', 'Monthly rankings')],
        ['/assistencia/comparacoes-pagamentos', t('Pagamentos e economia', 'Payments and the economy')],
      ]], series('/assistencia'), fontes('/assistencia'),
    ];
    case 'munic': return [
      painel('/munic'), comparar('/munic', false, false),
      [t('Mais detalhes', 'More detail'), [
        ['/munic/territorio', t('Ficha do município ou estado', 'Municipality or state profile')],
        ['/munic/evolucao', t('Evolução entre edições', 'Change across editions')],
        ['/munic/perguntas', t('Explorar por pergunta', 'Explore by question')],
      ]], fontes('/munic'),
    ];
    case 'clima': return [painel('/clima'), comparar('/clima', false), fontes('/clima')];
    case 'saneamento': return [painel('/saneamento'), comparar('/saneamento'), fontes('/saneamento')];
    case 'comex':
    case 'energia':
    case 'internet':
    case 'seguranca':
    case 'mobilidade':
    case 'agropecuaria': return [painel('/' + area), comparar('/' + area)];
    case 'downloads': return [[t('Dados abertos', 'Open data'), [['/downloads', t('Baixar dados municipais', 'Download municipal data')]]]];
    case 'raiox':
    case 'ia': return [];
  }
}

/** O assunto completa nomes repetidos, inclusive para leitores de tela. */
export function nomePaginaMenu(grupo: string, rotulo: string): string {
  return ['Visão geral', 'Evolução', 'Overview', 'Trends'].includes(rotulo) ? `${grupo}: ${rotulo}` : rotulo;
}
