/**
 * Evolução das posições nos rankings: convenções, estado na URL e tabelas (sem React), usadas pelas páginas de
 * rankings dos três painéis, pelas exportações e pelos testes. As posições vêm da classificação comum
 * (ranking_posicoes em dados.ts), a mesma do ranking anual.
 *
 *   posição            1 = primeiro na ordenação escolhida ("maiores primeiro" ou "menores primeiro"); empates
 *                      competitivos (1, 2, 2, 4). "Primeiro" não quer dizer "melhor": depende do indicador.
 *   variação           posição inicial − posição final: positiva = ganhou posições (foi para mais perto do 1º),
 *                      negativa = perdeu; a mesma convenção na tela e nas exportações
 *   posição relativa   100 × (N − posição) ÷ (N − 1), com N o tamanho do universo no ano: 100 = 1º, 0 = último;
 *                      empatados têm o mesmo valor; com N = 1 não há posição relativa
 */
import type { Classificacao, MudancaPosicao, PontoPosicao } from './dados';
import { t } from './idioma';

export const MAX_COMPARADOS = 5;

export const posicaoRelativa = (pos: number | null | undefined, total: number | null | undefined) =>
  pos == null || total == null || total < 2 ? null : (100 * (total - pos)) / (total - 1);

export const variacaoPosicao = (ini: number | null | undefined, fim: number | null | undefined) =>
  ini == null || fim == null ? null : ini - fim;

/** Variação percentual do indicador, só com valor inicial positivo. */
export const variacaoPct = (ini: number | null | undefined, fim: number | null | undefined) =>
  ini == null || fim == null || !(ini > 0) ? null : (fim / ini - 1) * 100;

/** Por que o município ficou sem posição no ano (motivos de ranking_posicoes; null = sem registro na fonte). */
export function textoMotivo(m: string | null | undefined): string {
  const textos: Record<string, string> = {
    sem_valor: t('sem o valor no ano', 'no value in the year'),
    sem_total_dominio: t('DCA sem o total do domínio (receita ou despesa)', 'DCA without the domain total (revenue or expenditure)'),
    inconsistencia: t('excluído por inconsistência objetiva ou erro confirmado', 'excluded for an objective inconsistency or confirmed error'),
    sem_populacao: t('sem população positiva (per capita não calculável)', 'no positive population (per capita not computable)'),
    abaixo_minimo: t('abaixo do mínimo escolhido', 'below the chosen minimum'),
    sem_ano_anterior: t('sem o ano anterior na RAIS (crescimento não calculável)', 'no previous RAIS year (growth not computable)'),
    sem_caged: t('sem CAGED no ano', 'no CAGED in the year'),
    sem_registro: t('sem registros na fonte no ano', 'no records in the source for the year'),
    denominador_invalido: t('denominador ausente ou zero (taxa não calculável)', 'missing or zero denominator (rate not computable)'),
    sem_numerador: t('sem registros do numerador no ano', 'no numerator records in the year'),
    fora_universo_constante: t('fora do universo constante (sem posição em algum ano do período)', 'outside the constant universe (unranked in some year of the period)'),
  };
  return m ? textos[m] ?? m : t('sem registro na fonte no ano', 'no record in the source for the year');
}

// ---------------- estado na URL ----------------

export type EstadoEvolucao = {
  de: number; ate: number; universo: 'anual' | 'constante'; abrangencia: 'br' | 'uf';
  entes: number[]; escala: 'posicao' | 'percentil'; precos: 'nominal' | 'real';
  /** gráfico mostrado: a posição no ranking (padrão) ou o valor do indicador */
  grafico: 'posicao' | 'valor';
  /** período pedido na URL quando ficou fora da cobertura do indicador e foi ajustado (null = sem ajuste) */
  ajuste: { de: number; ate: number } | null;
};

/**
 * Estado da evolução a partir da URL: período (dentro dos anos da fonte; padrão, os 5 últimos), universo,
 * abrangência (UF quando a página tem uma), municípios comparados (cmp; sem o parâmetro, o município dos
 * filtros), escala do gráfico de posições e preços.
 */
export function lerEstadoEvolucao(b: URLSearchParams, anos: number[], padrao: { ente?: number | null; temUf: boolean }): EstadoEvolucao {
  const ultimo = anos.at(-1) ?? 0;
  const pedido = (k: string) => {
    const v = Number.parseInt(b.get(k) ?? '', 10);
    return Number.isFinite(v) ? v : null;
  };
  let pDe = pedido('de');
  let pAte = pedido('ate');
  if (pDe !== null && pAte !== null && pDe > pAte) [pDe, pAte] = [pAte, pDe];
  // ano pedido fora da cobertura: o início vai para o 1º ano coberto a partir dele e o fim para o último até ele
  // (sem nenhum, a ponta mais próxima); o período efetivo só tem anos em que alguma posição é possível
  const inicio = (v: number) => anos.find((a) => a >= v) ?? ultimo;
  const fim = (v: number) => [...anos].reverse().find((a) => a <= v) ?? anos[0] ?? 0;
  let de = pDe === null ? anos[Math.max(0, anos.length - 5)] ?? ultimo : inicio(pDe);
  let ate = pAte === null ? ultimo : fim(pAte);
  if (de > ate) [de, ate] = [ate, de];
  const ajuste = anos.length && ((pDe !== null && pDe !== de) || (pAte !== null && pAte !== ate))
    ? { de: pDe ?? de, ate: pAte ?? ate } : null;
  const cmp = b.get('cmp');
  const entes = cmp !== null
    ? [...new Set(cmp.split(',').map((x) => Number.parseInt(x, 10)).filter((x) => x > 0))].slice(0, MAX_COMPARADOS)
    : padrao.ente ? [padrao.ente] : [];
  return {
    de, ate, entes,
    universo: b.get('univ') === 'constante' ? 'constante' : 'anual',
    abrangencia: padrao.temUf && b.get('abr') !== 'br' ? 'uf' : 'br',
    escala: b.get('esc') === 'percentil' ? 'percentil' : 'posicao',
    precos: b.get('precos') === 'real' ? 'real' : 'nominal',
    grafico: b.get('graf') === 'valor' ? 'valor' : 'posicao',
    ajuste,
  };
}

/**
 * Resumo de um município no período: a posição no ano inicial e no final ou, sem posição neles, o motivo e a
 * primeira/última posição disponível (com o ano). A variação só compara dois anos com posição.
 */
export function resumoTrajetoria(c: Classificacao, cod: number, de: number, ate: number, uf: boolean) {
  const pontos = c.serie.filter((p) => p.cod_ibge === cod);
  const pos = (p: PontoPosicao) => (uf ? p.posicao_uf : p.posicao_br);
  const comPos = pontos.filter((p) => pos(p) != null && p.ano >= de && p.ano <= ate).sort((a, b) => a.ano - b.ano);
  const ini = comPos[0];
  const fim = comPos.at(-1);
  const motivoNo = (ano: number) => {
    const p = pontos.find((x) => x.ano === ano);
    return p && pos(p) != null ? null : textoMotivo(p?.motivo);
  };
  return {
    ini, fim,
    /** por que não há posição no ano inicial/final do período (null = há posição) */
    semInicio: motivoNo(de), semFim: motivoNo(ate),
    variacao: ini && fim && ini !== fim ? variacaoPosicao(pos(ini), pos(fim)) : null,
  };
}

/** Grava as mudanças do estado na URL (os demais parâmetros da página ficam). */
export function gravarEstadoEvolucao(b: URLSearchParams, e: Partial<EstadoEvolucao>): URLSearchParams {
  const p = new URLSearchParams(b);
  const pares: [keyof EstadoEvolucao, string, (v: never) => string | null][] = [
    ['de', 'de', (v: number) => String(v)], ['ate', 'ate', (v: number) => String(v)],
    ['universo', 'univ', (v: string) => (v === 'constante' ? v : null)], ['abrangencia', 'abr', (v: string) => (v === 'br' ? v : null)],
    ['entes', 'cmp', (v: number[]) => v.join(',')], ['escala', 'esc', (v: string) => (v === 'percentil' ? v : null)],
    ['precos', 'precos', (v: string) => (v === 'real' ? v : null)], ['grafico', 'graf', (v: string) => (v === 'valor' ? v : null)],
  ];
  for (const [chave, param, valor] of pares) {
    if (!(chave in e)) continue;
    const v = valor(e[chave] as never);
    if (v === null) p.delete(param);
    else p.set(param, v);
  }
  return p;
}

// ---------------- tabelas (tela e exportação: todas as observações) ----------------

/**
 * percentual: o indicador é uma proporção guardada de 0 a 1 (ex.: % de mulheres, crescimento): a diferença entre dois
 * anos sai em pontos percentuais (p.p.), separada da variação relativa (%).
 */
export type OpcoesTabela = {
  unidade: string; monetario: boolean; percentual?: boolean; uf: boolean; baseIpca: number; nomes: Map<number, { nome: string; uf: string }>;
};
const rotuloValor = (o: OpcoesTabela) => (o.percentual
  ? t(`proporção de 0 a 1, ${o.unidade}; 0,49 = 49%`, `share from 0 to 1, ${o.unidade}; 0.49 = 49%`)
  : o.unidade);
type Celula = string | number | null;

const posicaoDoEscopo = (p: PontoPosicao, uf: boolean) => (uf ? [p.posicao_uf, p.total_uf] : [p.posicao_br, p.total_br]) as [number | null, number | null];

/** Um ponto por município comparado e ano do período: com registro, a posição; sem, a lacuna com o motivo. */
export function pontosDaTrajetoria(c: Classificacao, entes: number[]) {
  const porChave = new Map(c.serie.map((p) => [`${p.cod_ibge}-${p.ano}`, p]));
  return entes.flatMap((cod) => c.anos.map((ano) => ({ cod, ano, p: porChave.get(`${cod}-${ano}`) ?? null })));
}

export function tabelaTrajetorias(c: Classificacao, entes: number[], o: OpcoesTabela): { colunas: string[]; linhas: Celula[][] } {
  const colunas = [
    t('Ano', 'Year'), t('Código IBGE', 'IBGE code'), t('Município', 'Municipality'), 'UF', `${t('Valor', 'Value')} (${rotuloValor(o)})`,
    ...(o.monetario ? [t(`Valor real (R$ de dez/${o.baseIpca})`, `Real value (Dec/${o.baseIpca} R$)`)] : []),
    o.uf ? t('Posição na UF', 'State position') : t('Posição no Brasil', 'National position'),
    o.uf ? t('Municípios elegíveis na UF', 'Eligible municipalities in the state') : t('Municípios elegíveis no Brasil', 'Eligible municipalities in Brazil'),
    t('Posição relativa (0–100)', 'Relative position (0–100)'),
    ...(o.uf ? [t('Posição no Brasil', 'National position'), t('Municípios elegíveis no Brasil', 'Eligible municipalities in Brazil')] : []),
    t('Situação', 'Status'),
  ];
  const linhas = pontosDaTrajetoria(c, entes).map(({ cod, ano, p }) => {
    const n = o.nomes.get(cod);
    const [pos, tot] = p ? posicaoDoEscopo(p, o.uf) : [null, null];
    return [
      ano, cod, p?.nome ?? n?.nome ?? String(cod), p?.uf ?? n?.uf ?? null, p?.indicador ?? null,
      ...(o.monetario ? [p?.indicador != null && p.fator_real != null ? p.indicador * p.fator_real : null] : []),
      pos, tot, posicaoRelativa(pos, tot),
      ...(o.uf ? [p?.posicao_br ?? null, p?.total_br ?? null] : []),
      pos != null ? t('classificado', 'ranked') : textoMotivo(p?.motivo),
    ];
  });
  return { colunas, linhas };
}

export function tabelaMudancas(c: Classificacao, o: OpcoesTabela, de: number, ate: number): { colunas: string[]; linhas: Celula[][] } {
  const real = (v: number | null, f: number | null) => (v != null && f != null ? v * f : null);
  const colunas = [
    t('Código IBGE', 'IBGE code'), t('Município', 'Municipality'), 'UF',
    `${t('Valor', 'Value')} ${de} (${rotuloValor(o)})`, `${t('Valor', 'Value')} ${ate} (${rotuloValor(o)})`,
    ...(o.monetario ? [t(`Valor real ${de} (R$ de dez/${o.baseIpca})`, `Real value ${de} (Dec/${o.baseIpca} R$)`), t(`Valor real ${ate} (R$ de dez/${o.baseIpca})`, `Real value ${ate} (Dec/${o.baseIpca} R$)`)] : []),
    o.percentual
      ? t('Diferença do indicador em pontos percentuais (final − inicial)', 'Difference in the indicator in percentage points (final − initial)')
      : o.monetario
        ? t(`Variação real do indicador (R$ de dez/${o.baseIpca}, final − inicial)`, `Real change in the indicator (Dec/${o.baseIpca} R$, final − initial)`)
        : t('Variação do indicador (final − inicial)', 'Change in the indicator (final − initial)'),
    o.monetario ? t('Variação real relativa do indicador (%)', 'Real relative change in the indicator (%)') : t('Variação relativa do indicador (%)', 'Relative change in the indicator (%)'),
    t(`Posição ${de}`, `Position ${de}`), t(`Universo ${de}`, `Universe ${de}`), t(`Posição ${ate}`, `Position ${ate}`), t(`Universo ${ate}`, `Universe ${ate}`),
    t('Variação da posição (inicial − final; + = ganhou posições)', 'Change in position (initial − final; + = gained positions)'),
  ];
  const linhas = c.mudancas.map((m: MudancaPosicao) => {
    const ri = o.monetario ? real(m.valor_ini, m.fator_ini) : m.valor_ini;
    const rf = o.monetario ? real(m.valor_fim, m.fator_fim) : m.valor_fim;
    return [
      m.cod_ibge, m.nome, m.uf, m.valor_ini, m.valor_fim, ...(o.monetario ? [ri, rf] : []),
      // monetário: variação em termos reais (nominal não compara anos); contagens, taxas e percentuais: sem deflação
      ri != null && rf != null ? (rf - ri) * (o.percentual ? 100 : 1) : null, variacaoPct(ri, rf),
      m.pos_ini, m.total_ini, m.pos_fim, m.total_fim, variacaoPosicao(m.pos_ini, m.pos_fim),
    ];
  });
  return { colunas, linhas };
}
