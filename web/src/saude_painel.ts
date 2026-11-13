/**
 * Visão geral da saúde: temas, busca local e resumo exportável dos indicadores do catálogo (saude_comum.INDICADORES).
 * Só funções puras sobre a série que a página já carregou (saude_serie): nada aqui consulta dados nem altera fórmulas;
 * o valor sai de calcular() (razão das somas) e a condição do dado, de condicaoDado()/motivoSemValor().
 */
import type { Linha } from './api';
import { idioma, t } from './idioma';
import {
  anosDoIndicador, calcular, condicaoDado, fonteCurta, INDICADORES, motivoSemValor, nomeContagem, rotuloCondicao, textoMotivo,
  type CondicaoDado, type FontesMeta, type Indicador, type MotivoSemValor,
} from './saude_comum';

const num = (v: unknown) => (typeof v === 'number' ? v : null);

/** Ano mostrado de um dado: o último ano coberto (modo "último de cada fonte") ou o ano escolhido, se a fonte o cobre. */
export const referencia = (cobertos: number[], ano: number, ultimo: boolean): number | null =>
  ultimo ? cobertos.at(-1) ?? null : cobertos.includes(ano) ? ano : null;

// ---------------- temas ----------------

export type Tema = { id: string; nome: () => string; indicadores: string[] };

/** Cada indicador do catálogo aparece em exatamente um tema (o teste confere). */
export const TEMAS: Tema[] = [
  { id: 'maternidade', nome: () => t('Maternidade e infância', 'Maternity and childhood'),
    indicadores: ['mortalidade_infantil', 'mortalidade_neonatal', 'mortalidade_pos_neonatal', 'mortalidade_infancia', 'mortalidade_materna',
      'natalidade', 'baixo_peso', 'prematuros', 'cesareas', 'pre_natal', 'maes_adolescentes'] },
  { id: 'mortalidade', nome: () => t('Mortalidade e causas de morte', 'Mortality and causes of death'),
    indicadores: ['mortalidade_geral', 'dcnt_prematura', 'homicidios', 'suicidios', 'transito', 'mal_definidas'] },
  { id: 'internacoes', nome: () => t('Internações (SIH/SUS)', 'Hospital admissions (SIH/SUS)'),
    indicadores: ['internacoes_mil', 'internacoes_idosos', 'internacoes_criancas', 'internacoes_fora', 'mortalidade_hospitalar', 'permanencia_media',
      'valor_por_internacao', 'valor_por_habitante'] },
  { id: 'rede', nome: () => t('Rede e acesso (CNES)', 'Network and access (CNES)'),
    indicadores: ['leitos_mil', 'leitos_sus_mil', 'leitos_sus_proporcao', 'medicos_mil', 'enfermeiros_mil', 'estabelecimentos_10mil'] },
  { id: 'icsap', nome: () => t('Internações evitáveis (ICSAP)', 'Avoidable admissions (ICSAP)'),
    indicadores: ['icsap_taxa', 'icsap_proporcao'] },
  { id: 'vigilancia', nome: () => t('Vigilância', 'Surveillance'),
    indicadores: ['dengue_incidencia', 'dengue_letalidade', 'dengue_graves', 'chik_incidencia', 'tb_incidencia', 'hans_deteccao', 'violencia_notificada'] },
  { id: 'oncologia', nome: () => t('Oncologia', 'Oncology'),
    indicadores: ['cito_25_64', 'cito_alterados', 'mamo_50_69', 'mamo_50_74', 'cancer_registros', 'cancer_60_dias'] },
  { id: 'resp', nome: () => t('Microcefalia e alterações do SNC (RESP)', 'Microcephaly and CNS changes (RESP)'),
    indicadores: ['resp_notificacoes', 'resp_confirmadas'] },
];

export const temaDoIndicador = (id: string): Tema | undefined => TEMAS.find((x) => x.indicadores.includes(id));
export const indicadoresDoTema = (tema: Tema): Indicador[] =>
  tema.indicadores.map((id) => INDICADORES.find((i) => i.id === id)).filter((i): i is Indicador => !!i);

// ---------------- busca ----------------

/** Palavras de uso comum que não estão no nome do indicador. */
const SINONIMOS: Record<string, string> = {
  mortalidade_materna: 'morte materna gestante',
  prematuros: 'prematuro prematuridade',
  cesareas: 'cesarea cesareo cesariana parto',
  pre_natal: 'prenatal consulta gestante gravida',
  maes_adolescentes: 'gravidez na adolescencia adolescente mae jovem',
  baixo_peso: 'peso ao nascer bebe',
  homicidios: 'homicidio assassinato violencia',
  suicidios: 'suicidio autoprovocada',
  transito: 'acidente transito carro moto',
  medicos_mil: 'medico medicos doutor profissionais',
  enfermeiros_mil: 'enfermeiro enfermeira enfermagem profissionais',
  leitos_mil: 'leito hospital', leitos_sus_mil: 'leito hospital sus', leitos_sus_proporcao: 'leito hospital sus',
  estabelecimentos_10mil: 'unidade posto clinica hospital ubs',
  internacoes_idosos: 'idoso terceira idade', internacoes_criancas: 'crianca infantil pediatrica',
  permanencia_media: 'dias internado',
  valor_por_internacao: 'custo gasto reais', valor_por_habitante: 'custo gasto reais per capita',
  dengue_incidencia: 'arbovirose', dengue_letalidade: 'arbovirose', dengue_graves: 'arbovirose',
  chik_incidencia: 'chikungunya arbovirose', tb_incidencia: 'tuberculose', hans_deteccao: 'hanseniase lepra',
  violencia_notificada: 'violencia notificada agressao',
  cito_25_64: 'colo do utero papanicolau preventivo citologia', cito_alterados: 'colo do utero papanicolau preventivo citologia',
  mamo_50_69: 'mama mamografia cancer de mama', mamo_50_74: 'mama mamografia cancer de mama',
  cancer_registros: 'cancer tumor oncologia', cancer_60_dias: 'cancer tumor oncologia tratamento',
  icsap_taxa: 'atencao primaria evitaveis condicoes sensiveis', icsap_proporcao: 'atencao primaria evitaveis condicoes sensiveis',
  resp_notificacoes: 'microcefalia zika', resp_confirmadas: 'microcefalia zika',
};

/** Minúsculas, sem acentos e com espaços simples (a busca aceita "cesárea", "cesarea", "MÉDICO"). */
export const normalizarBusca = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const fardo = (ind: Indicador) => normalizarBusca([
  ind.nome(), ind.unidade(), ind.grupo(), temaDoIndicador(ind.id)?.nome() ?? '', ind.id.replace(/_/g, ' '), SINONIMOS[ind.id] ?? '',
].join(' '));

/** Cada palavra da busca (singular ou plural) tem de aparecer no nome, tema, unidade ou sinônimos. */
export function filtrarIndicadores(texto: string, temaId: string | null): Indicador[] {
  const tema = temaId ? TEMAS.find((x) => x.id === temaId) : undefined;
  const base = tema ? indicadoresDoTema(tema) : TEMAS.flatMap(indicadoresDoTema);
  const palavras = normalizarBusca(texto).split(' ').filter(Boolean);
  if (!palavras.length) return base;
  return base.filter((ind) => {
    const f = ` ${fardo(ind)} `;
    return palavras.every((p) => f.includes(p) || (p.length > 3 && p.endsWith('s') && f.includes(p.slice(0, -1))));
  });
}

// ---------------- resumo de um indicador ----------------

export type EstadoResumo = 'indisponivel' | 'fora_cobertura' | 'sem_valor' | 'valor';
export type ResumoIndicador = {
  ind: Indicador;
  estado: EstadoResumo;
  /** ano efetivo (null fora da cobertura ou na versão sem as colunas) */
  ano: number | null;
  valor: number | null;
  numerador: number | null;
  denominador: number | null;
  /** condição do numerador na fonte (registrado, zero registrado, preliminar…) */
  condicao: CondicaoDado | null;
  motivo: MotivoSemValor | null;
  /** denominador abaixo do mínimo do indicador */
  pequeno: boolean;
};

/** A série carregada tem as colunas do indicador? (sem linhas não dá para saber: considera disponível) */
export const temColunasDoIndicador = (ind: Indicador, serie: Linha[]) =>
  serie.length === 0 || (ind.numerador in serie[0] && ind.denominador in serie[0]);

/**
 * O que a visão geral mostra de um indicador no ano de referência da sua fonte. Falta de dado nunca vira zero:
 * valor só existe quando calcular() devolve número; zero registrado continua zero, com a sua condição.
 */
export function resumirIndicador(ind: Indicador, serie: Linha[], ano: number, ultimo: boolean, fontes: FontesMeta): ResumoIndicador {
  const vazio = { ind, ano: null, valor: null, numerador: null, denominador: null, condicao: null, motivo: null, pequeno: false };
  if (!temColunasDoIndicador(ind, serie)) return { ...vazio, estado: 'indisponivel' };
  const ref = referencia(anosDoIndicador(ind, fontes), ano, ultimo);
  if (ref === null) return { ...vazio, estado: 'fora_cobertura' };
  const r = serie.find((x) => Number(x.ano) === ref);
  const n = num(r?.[ind.numerador]);
  const d = num(r?.[ind.denominador]);
  const valor = calcular(ind, r);
  return {
    ind, ano: ref, valor, numerador: n, denominador: d,
    estado: valor === null ? 'sem_valor' : 'valor',
    condicao: condicaoDado(ind.numerador, n, ref, fontes),
    motivo: motivoSemValor(ind, r),
    pequeno: valor !== null && d !== null && d < ind.minimo,
  };
}

/** Proporção (0–1) vira 0–100 no arquivo, como o cabeçalho "%" da unidade; taxas e valores em reais saem como calculados. */
export const valorExportado = (ind: Indicador, v: number | null): number | null =>
  v === null ? null : ind.tipo === 'proporcao' ? Number((v * 100).toPrecision(15)) : v;

/** Nota de um indicador sem valor: o nome legível da contagem (não a coluna crua) e, para "sem registro", a condição genérica (a nota do helper cita o SIH). */
export function notaSemValor(ind: Indicador, motivo: MotivoSemValor | null): string {
  const den = nomeContagem(ind.denominador).toLowerCase();
  if (motivo === 'denominador_ausente') return t(`denominador ausente: ${den}`, `denominator missing: ${den}`);
  if (motivo === 'denominador_zero') return t(`denominador zero: ${den} = 0`, `zero denominator: ${den} = 0`);
  return rotuloCondicao('ausente');
}

/** Texto curto da condição do dado de um resumo (arquivo exportado). */
export function condicaoTexto(x: ResumoIndicador): string {
  if (x.estado === 'indisponivel') return t('indisponível nesta versão dos dados', 'unavailable in this data version');
  if (x.estado === 'fora_cobertura') return rotuloCondicao('fora_cobertura');
  if (x.estado === 'sem_valor') {
    // a nota de "sem registro" do motivo fala de internações; a condição genérica vale para qualquer fonte
    if (x.motivo === null || x.motivo === 'sem_registro') return rotuloCondicao('ausente');
    return textoMotivo(x.motivo, x.ind).rotulo;
  }
  return rotuloCondicao(x.condicao ?? 'registrado');
}

/** Linhas do resumo exportado: todos os indicadores do catálogo, na ordem dos temas, independentemente da busca. */
export function tabelaResumo(serie: Linha[], ano: number, ultimo: boolean, fontes: FontesMeta) {
  const en = idioma() === 'en';
  const colunas = [
    t('Tema', 'Theme'), t('Indicador', 'Indicator'), t('Código', 'Code'),
    t('Valor (proporções em %, de 0 a 100)', 'Value (shares in %, 0 to 100)'), t('Unidade', 'Unit'), t('Ano de referência', 'Reference year'),
    t('Numerador', 'Numerator'), t('Valor do numerador', 'Numerator value'), t('Denominador', 'Denominator'), t('Valor do denominador', 'Denominator value'),
    t('Condição do dado', 'Data condition'), t('Denominador pequeno', 'Small denominator'), t('Fonte', 'Source'),
  ];
  const linhas = TEMAS.flatMap((tema) => indicadoresDoTema(tema).map((ind) => {
    const x = resumirIndicador(ind, serie, ano, ultimo, fontes);
    const unidade = ind.unidade();
    return [
      tema.nome(), ind.nome(), ind.id, valorExportado(ind, x.valor), unidade, x.ano,
      nomeContagem(ind.numerador), x.numerador, nomeContagem(ind.denominador), x.denominador,
      condicaoTexto(x), x.pequeno ? (en ? 'yes' : 'sim') : (x.estado === 'valor' ? (en ? 'no' : 'não') : ''), fonteCurta(ind),
    ];
  }));
  return { colunas, linhas };
}
