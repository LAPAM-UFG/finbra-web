/**
 * Orientação para quem não conhece a RAIS: perguntas da visão geral (que reaproveitam as rotas e os atalhos
 * existentes), grupos da lista completa de atalhos e categorias do "Ver resultado por". Só textos e agrupamentos:
 * nenhum cálculo nem consulta mudam aqui.
 */
import { t } from './idioma';

export type Pergunta = {
  id: string; pergunta: string; desc: string; rotulo: string; caminho: string; params: Record<string, string>;
  /** parâmetros do recorte levados junto (os demais são descartados, como em urlAnalise) */
  manter?: string[];
  /** o que só aparece com os microdados (UF ou município); o link sempre abre o que já funciona no Brasil */
  notaBrasil?: string;
  /** atalhos de ATALHOS_RAIS que aprofundam a pergunta */
  ids: string[];
};

export const PERGUNTAS_RAIS = (): Pergunta[] => [
  { id: 'quantos', pergunta: t('Quantos empregos formais há?', 'How many formal jobs are there?'), rotulo: t('Contar empregos', 'Count jobs'),
    desc: t('Total de empregos no fim do ano, que você pode abrir por atividade, profissão ou sexo.', 'Total jobs at year end, which you can break down by activity, occupation or sex.'),
    notaBrasil: t('No Brasil há o total e os cortes por sexo e grandes grupos de profissão; os demais cortes são de UF ou município.', 'For Brazil there are the total and the cuts by sex and occupation major groups; the other cuts are for a state or municipality.'),
    caminho: '/trabalho/consulta', params: { sit: 'ativos', agr: 'total' }, ids: ['ocup', 'porte'] },
  { id: 'pagam', pergunta: t('Quanto pagam os empregos?', 'How much do jobs pay?'), rotulo: t('Ver remuneração', 'See pay'),
    desc: t('Quanto se ganha em dezembro, em média e no valor do meio, e quais faixas de remuneração existem, por sexo, raça/cor, escolaridade e idade.', 'What people earn in December, on average and at the middle value, and which pay ranges exist, by sex, race/colour, education and age.'),
    notaBrasil: t('No Brasil abre a divisão por sexo e a média; raça/cor, escolaridade, idade, mediana e faixas são de UF ou município.', 'For Brazil it opens the split by sex and the average; race/colour, education, age, median and ranges are for a state or municipality.'),
    caminho: '/trabalho/remuneracao', params: {}, ids: ['sexo', 'esc'] },
  { id: 'profissao', pergunta: t('Quero conhecer uma profissão', 'I want to know an occupation'), rotulo: t('Abrir o perfil', 'Open the profile'),
    desc: t('Escolha pelo nome (ex.: enfermeiro): série histórica, remuneração, onde trabalha e quem são.', 'Pick by name (e.g. nurse): time series, pay, where they work and who they are.'),
    notaBrasil: t('No Brasil parte das tabelas fica indisponível; o perfil completo é de UF ou município.', 'For Brazil some tables are unavailable; the full profile is for a state or municipality.'),
    caminho: '/trabalho/perfil', params: {}, manter: ['cbo'], ids: ['ocup'] },
  { id: 'perfil', pergunta: t('Quem ocupa esses empregos?', 'Who holds these jobs?'), rotulo: t('Ver o perfil dos vínculos', 'See the job profile'),
    desc: t('Sexo, idade, raça/cor, escolaridade, nacionalidade e deficiência declaradas nos vínculos (não são pessoas únicas).', 'Sex, age, race/colour, education, nationality and disability declared in the jobs (not unique people).'),
    notaBrasil: t('No Brasil abre o corte por sexo; idade, raça/cor, escolaridade e os demais são de UF ou município.', 'For Brazil it opens the cut by sex; age, race/colour, education and the others are for a state or municipality.'),
    caminho: '/trabalho/consulta', params: { sit: 'ativos', agr: 'sexo' }, ids: ['sexo', 'raca', 'esc', 'jovens', 'nac', 'pcd'] },
  { id: 'atividades', pergunta: t('Como são os estabelecimentos?', 'What are the establishments like?'), rotulo: t('Ver os estabelecimentos', 'See the establishments'),
    desc: t('Quantos estabelecimentos declaram empregos e como se dividem por porte, atividade, natureza jurídica, Simples e PAT.', 'How many establishments report jobs and how they split by size, activity, legal nature, Simples and PAT.'),
    caminho: '/trabalho/estabelecimentos', params: {}, ids: ['porte', 'publico'] },
  { id: 'movimento', pergunta: t('Quantos empregos com carteira entram e saem?', 'How many payroll (CLT) jobs start and end?'), rotulo: t('Ver contratações e saídas', 'See hirings and exits'),
    desc: t('Contratações, saídas (demissões, pedidos de desligamento e outros) e saldo mês a mês dos empregos com carteira assinada (CLT), no Novo CAGED; não inclui todos os contratos, como os estatutários. Os motivos de saída no ano vêm da RAIS.', 'Hirings, exits (dismissals, resignations and others) and net balance month by month for payroll (CLT) jobs, in New CAGED; it does not cover every contract, such as statutory civil-service jobs. Exit reasons in the year come from RAIS.'),
    caminho: '/trabalho/caged', params: {}, ids: ['deslig', 'afast'] },
];

/** Grupos de atalhos de ATALHOS_RAIS na lista completa ("ver todas as análises"); o que não estiver aqui vai para "Outras". */
export const GRUPOS_ATALHOS = (): { titulo: string; ids: string[] }[] => [
  { titulo: t('Quem trabalha', 'Who works'), ids: ['sexo', 'raca', 'esc', 'jovens', 'nac', 'pcd'] },
  { titulo: t('Profissões e atividades', 'Occupations and activities'), ids: ['ocup', 'publico', 'porte'] },
  { titulo: t('Contrato, jornada e movimentação', 'Contract, hours and job movements'), ids: ['jornada', 'modalidade', 'afast', 'deslig'] },
];

/** Separa os atalhos nos grupos acima, sem perder nenhum. */
export function agruparAtalhos<T extends { id: string }>(atalhos: T[]): { titulo: string; itens: T[] }[] {
  const usados = new Set<string>();
  const grupos = GRUPOS_ATALHOS().map((g) => ({
    titulo: g.titulo,
    itens: g.ids.flatMap((id) => { const a = atalhos.find((x) => x.id === id); if (a) usados.add(id); return a ? [a] : []; }),
  }));
  const outros = atalhos.filter((a) => !usados.has(a.id));
  if (outros.length) grupos.push({ titulo: t('Outras análises', 'Other analyses'), itens: outros });
  return grupos.filter((g) => g.itens.length);
}

/** Categorias do "Ver resultado por"; cada agrupamento válido cai em exatamente uma. */
export const CATEGORIAS_AGRUPAMENTO = (): { titulo: string; chaves: string[] }[] => [
  { titulo: t('Total', 'Total'), chaves: ['total'] },
  { titulo: t('Atividade do estabelecimento (CNAE)', 'Establishment activity (CNAE)'), chaves: ['cnae_secao', 'cnae_divisao', 'cnae_classe', 'cnae_subclasse'] },
  { titulo: t('Profissão (CBO)', 'Occupation (CBO)'), chaves: ['cbo_grande_grupo', 'cbo_familia', 'cbo'] },
  { titulo: t('Quem trabalha', 'Who works'), chaves: ['sexo', 'faixa_idade', 'escolaridade', 'raca_cor', 'nacionalidade', 'pcd', 'tipo_deficiencia'] },
  { titulo: t('Contrato, jornada e movimentação', 'Contract, hours and job movements'), chaves: ['vinculo_mte', 'tipo_vinculo', 'situacao', 'faixa_horas', 'faixa_tempo', 'trab_parcial', 'trab_intermitente', 'causa_afastamento', 'motivo_desligamento'] },
  { titulo: t('Empregador e estabelecimento', 'Employer and establishment'), chaves: ['setor_institucional', 'esfera_adm', 'natureza_juridica_grupo', 'natureza_juridica', 'tamanho_estab'] },
  { titulo: t('Local', 'Place'), chaves: ['uf', 'municipio'] },
];

/** Separa as opções em categorias, na ordem delas; nenhuma opção some (as sem categoria vão para "Outros"). */
export function categorizarOpcoes(opcoes: [string, string][]): { titulo: string; opcoes: [string, string][] }[] {
  const usados = new Set<string>();
  const grupos = CATEGORIAS_AGRUPAMENTO().map((c) => ({
    titulo: c.titulo,
    opcoes: c.chaves.flatMap((k) => { const o = opcoes.find(([x]) => x === k); if (o) usados.add(k); return o ? [o] : []; }),
  }));
  const outros = opcoes.filter(([k]) => !usados.has(k));
  if (outros.length) grupos.push({ titulo: t('Outros', 'Other'), opcoes: outros });
  return grupos.filter((g) => g.opcoes.length);
}

/** Códigos digitados à mão: lista de prefixos numéricos separados por vírgula, ponto e vírgula ou espaço, de 1 a `max` dígitos. */
export const SEPARADOR_CODIGOS = /[\s,;]+/;
export function codigosInvalidos(valor: string, max: number): string[] {
  return valor.split(SEPARADOR_CODIGOS).filter(Boolean).filter((c) => !new RegExp(`^[0-9]{1,${max}}$`).test(c));
}

/**
 * Agrupamento principal e comparação do rascunho da Consulta, coerentes com o que a fonte oferece: o principal
 * inválido vira "total"; a comparação some se o principal é "total", se é igual a ele ou se a fonte não a tem.
 */
export function normalizarAgrupamentos(agr: string, agr2: string, validos: string[]): { agr: string; agr2: string } {
  const principal = validos.includes(agr) ? agr : 'total';
  const comparacao = principal !== 'total' && agr2 !== principal && agr2 !== 'total' && validos.includes(agr2) ? agr2 : '';
  return { agr: principal, agr2: comparacao };
}

/** Nomes da interface para os agrupamentos mais técnicos; os valores, as categorias e os nomes completos do motor não mudam. */
const AMIGAVEIS = (): Record<string, string> => ({
  total: t('Um total para a seleção', 'One total for the selection'),
  cnae_secao: t('Grandes ramos de atividade', 'Broad lines of activity'),
  cnae_divisao: t('Atividades econômicas', 'Economic activities'),
  cnae_classe: t('Atividades detalhadas', 'Detailed activities'),
  cnae_subclasse: t('Atividades mais específicas', 'More specific activities'),
  cbo_grande_grupo: t('Grandes grupos de profissões', 'Broad occupation groups'),
  cbo_familia: t('Grupos de profissões relacionadas', 'Groups of related occupations'),
  cbo: t('Ocupações específicas', 'Specific occupations'),
});

/** Rótulo amigável de um agrupamento; sem tradução própria, devolve o nome técnico. */
export const rotuloAmigavel = (chave: string, tecnico: string) => AMIGAVEIS()[chave] ?? tecnico;

/** Troca os rótulos das opções pelos amigáveis, sem tirar nenhuma. */
export const opcoesAmigaveis = (opcoes: [string, string][]): [string, string][] => opcoes.map(([k, n]) => [k, rotuloAmigavel(k, n)]);
