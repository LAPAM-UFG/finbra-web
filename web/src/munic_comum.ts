/** Painel da MUNIC e da ESTADIC (IBGE): nomes, ordenação e cálculo das distribuições, compartilhados pelas páginas. */
import type { Linha } from './api';
import { local, t } from './idioma';

export type Pesquisa = 'munic' | 'estadic';
export const pesquisaDe = (v: string | null | undefined): Pesquisa => (v === 'estadic' ? 'estadic' : 'munic');

export const nomePesquisa = (p: Pesquisa) => (p === 'munic'
  ? t('MUNIC · Pesquisa de Informações Básicas Municipais', 'MUNIC · Survey of Basic Municipal Information')
  : t('ESTADIC · Pesquisa de Informações Básicas Estaduais', 'ESTADIC · Survey of Basic State Information'));
export const siglaPesquisa = (p: Pesquisa) => (p === 'munic' ? 'MUNIC' : 'ESTADIC');
export const territorioNome = (p: Pesquisa) => (p === 'munic' ? t('municípios', 'municipalities') : t('estados', 'states'));

export const fonteMunic = () => t(
  'IBGE, Pesquisa de Informações Básicas Municipais (MUNIC) e Pesquisa de Informações Básicas Estaduais (ESTADIC): respostas dos gestores públicos. Processamento: LAPAM/UFG',
  'IBGE, Survey of Basic Municipal Information (MUNIC) and Survey of Basic State Information (ESTADIC): answers given by public managers. Processing: LAPAM/UFG',
);

/** Ordem natural dos códigos de variável: A2 antes de A10. */
export const compararVar = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' });

const sim = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
/** Texto sem acento e em minúsculas, para as buscas. */
export const semAcento = sim;

export type Resposta = { texto: string; n: number; parte: number };
export type Distribuicao = { total: number; respostas: Resposta[]; invalidas: { texto: string; n: number }[]; soma: number | null; media: number | null; numerico: number };

/** Respostas de um recorte (Brasil, uma UF ou uma faixa de porte): participação entre as respostas válidas e o que ficou de fora. */
export function distribuicao(linhas: Linha[], corte: string, grupo: string): Distribuicao {
  const meus = linhas.filter((r) => r.corte === corte && r.grupo === grupo);
  const validas = meus.filter((r) => r.valida && r.valor_txt !== null);
  const total = validas.reduce((s, r) => s + Number(r.n), 0);
  const numericas = meus.filter((r) => r.valor_txt === null);
  const nNum = numericas.reduce((s, r) => s + Number(r.n), 0);
  const soma = numericas.length ? numericas.reduce((s, r) => s + Number(r.soma ?? 0), 0) : null;
  return {
    total,
    respostas: validas.map((r) => ({ texto: String(r.valor_txt), n: Number(r.n), parte: total ? Number(r.n) / total : 0 }))
      .sort((a, b) => ordemTexto(a.texto, b.texto, a.n, b.n)),
    invalidas: meus.filter((r) => !r.valida && r.valor_txt !== null).map((r) => ({ texto: String(r.valor_txt), n: Number(r.n) })).sort((a, b) => b.n - a.n),
    soma,
    media: nNum ? (soma ?? 0) / nNum : null,
    numerico: nNum,
  };
}

/** Sim e Não primeiro (nessa ordem); as demais respostas, da mais frequente para a menos. */
function ordemTexto(a: string, b: string, na: number, nb: number): number {
  const peso = (s: string) => (sim(s) === 'sim' ? 0 : sim(s) === 'nao' ? 1 : 2);
  return peso(a) - peso(b) || nb - na;
}

export const pctTxt = (v: number | null | undefined, casas = 1) => (v === null || v === undefined || !Number.isFinite(v)
  ? '–' : `${(v * 100).toLocaleString(local(), { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`);

export const FAIXAS_PORTE = ['Até 5.000', '5.001 a 10.000', '10.001 a 20.000', '20.001 a 50.000', '50.001 a 100.000', '100.001 a 500.000', 'Mais de 500.000'];

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];

/** Aviso de comparabilidade que acompanha qualquer leitura entre edições. */
export const avisoComparacao = () => t(
  'As perguntas são ligadas entre edições pelo enunciado: um agrupamento automático. Confira o código e o enunciado de cada edição abaixo; o IBGE reformula perguntas, opções de resposta e o universo respondente, e uma diferença pode vir da pergunta, não do município.',
  'Questions are linked across editions by their wording, an automatic grouping. Check the code and wording of each edition below; IBGE rewords questions, answer options and the respondent universe, and a difference may come from the question, not from the municipality.',
);

export const notaSemResposta = () => t(
  'Os percentuais usam só as respostas válidas. "Não aplicável", "Não informou", "Recusa", "Não soube informar" e "–" (pergunta não preenchida) aparecem à parte e ficam fora da base do percentual. Quem não respondeu a pergunta não entra e nunca vira zero.',
  'Percentages use valid answers only. "Not applicable", "Did not report", "Refused", "Could not report" and "–" (question not filled in) appear separately and are left out of the percentage base. Whoever did not answer is excluded and never counts as zero.',
);

/**
 * Células "(n)" e "(%)" de uma resposta no CSV do explorador: participação de 0 a 100, como diz a coluna. Resposta que ninguém deu
 * num recorte com respostas válidas vale 0; recorte sem nenhuma resposta válida fica vazio (null), nunca um zero inventado.
 */
export function celulasDaResposta(d: Distribuicao, texto: string): [number | null, number | null] {
  const x = d.respostas.find((y) => y.texto === texto);
  if (x) return [x.n, x.parte * 100];
  return d.total > 0 ? [0, 0] : [null, null];
}
