import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { useApi, type Params } from '../api';
import { BotoesExportar } from './Exportar';
import { Dica } from './Dica';
import { Grafico, type Tokens } from './Grafico';
import { Estado } from './Kpi';
import { BuscaEnte, useDados } from '../contexto';
import type { Ente } from '../api';
import type { Classificacao, DominioRanking, PontoPosicao } from '../dados';
import { numero, numero1 } from '../format';
import { local, t } from '../idioma';
import {
  gravarEstadoEvolucao, lerEstadoEvolucao, MAX_COMPARADOS, pontosDaTrajetoria, posicaoRelativa, resumoTrajetoria, tabelaMudancas,
  tabelaTrajetorias, textoMotivo, variacaoPosicao,
} from '../posicoes';

type Props = {
  dominio: DominioRanking;
  ind: string;
  /** nome do indicador na configuração vigente (ex.: "FPM per capita") */
  nomeIndicador: string;
  /** unidade do indicador (ex.: "R$ por habitante", "por mil nascidos vivos") */
  unidade: string;
  formato: (v: number | null) => string;
  monetario: boolean;
  /** proporção guardada de 0 a 1: diferenças entre anos em pontos percentuais */
  percentual?: boolean;
  /** parâmetros próprios do painel que mudam o universo (medida, tratamento, mínimo) */
  params: Params;
  ordem: 'asc' | 'desc';
  /** anos da fonte (os seletores usam a cobertura do indicador, de ranking_anos) */
  anos?: number[];
  /** UF da página (filtros), se houver */
  uf: string | null;
  /** município dos filtros, mostrado por padrão */
  ente: number | null;
  /** seletor do indicador do painel, em destaque ao lado do município */
  indicador: ReactNode;
  /** controles do painel no bloco "Mais opções" (medida, ordenação, mínimo) */
  opcoes?: ReactNode;
  /** configurações do painel fora do padrão, em poucas palavras (aviso no botão e resumo junto ao gráfico) */
  ativas?: string[];
  /** definições, critérios e fonte, para "Ver dados e metodologia" e as exportações */
  definicoes: [string, string][];
  /** fonte em poucas palavras, para a linha abaixo do gráfico (ex.: "SIM e SINASC (DATASUS)") */
  fonte: string;
  /** quando a base da fonte foi processada (ISO); sem ela, a versão geral dos dados */
  atualizadoEm?: string;
  /** o mínimo do painel, para o resumo dizer qual (ex.: "nascidos vivos (1.000)") */
  minimo?: string;
  /** nota de comparabilidade do período (quebra de série, ano parcial): uma frase curta e, se houver, o texto completo */
  nota?: (de: number, ate: number) => { curta: string; completa?: string } | null;
  arquivo: string;
};

const LINHAS_INICIAIS = 50;

/** "Maiores primeiro" ou "menores primeiro", com o que é o 1º lugar; não diz se é melhor ou pior. */
export const textoOrdem = (ordem: 'asc' | 'desc', nome: string) => (ordem === 'desc'
  ? t(`maiores primeiro: o 1º lugar tem o maior valor de ${nome}`, `highest first: 1st place has the highest ${nome}`)
  : t(`menores primeiro: o 1º lugar tem o menor valor de ${nome}`, `lowest first: 1st place has the lowest ${nome}`));

/** Mudança de posição em linguagem neutra: mais perto ou mais longe do 1º lugar da ordenação. */
const textoVariacao = (v: number | null) => (v === null ? '' : v > 0
  ? t(`${numero(v)} ${v === 1 ? 'posição' : 'posições'} mais perto do 1º lugar`, `${numero(v)} ${v === 1 ? 'position' : 'positions'} closer to 1st place`)
  : v < 0 ? t(`${numero(-v)} ${v === -1 ? 'posição' : 'posições'} mais longe do 1º lugar`, `${numero(-v)} ${v === -1 ? 'position' : 'positions'} further from 1st place`)
    : t('mesma posição', 'same position'));

const sinal = (v: number | null) => (v === null ? '–' : v > 0 ? `+${numero(v)}` : numero(v));

/** Cada chave uma vez, a primeira que aparece. */
const unicos = (l: [string, string][]) => l.filter(([k], i) => l.findIndex(([x]) => x === k) === i);

const semAcento = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function EvolucaoPosicao(p: Props) {
  const { meta, entes, porCodigo } = useDados();
  const [busca, setBusca] = useSearchParams();
  const cobertura = useApi<number[]>('ranking_anos', { dominio: p.dominio, ind: p.ind, ...p.params });
  const anosCobertos = cobertura.dados ?? [];
  const e = lerEstadoEvolucao(busca, anosCobertos, { ente: p.ente, temUf: !!p.uf });
  const definir = (m: Parameters<typeof gravarEstadoEvolucao>[1], extra: Record<string, string> = {}) => {
    const b = gravarEstadoEvolucao(busca, m);
    for (const [k, v] of Object.entries(extra)) b.set(k, v);
    setBusca(b, { replace: true });
  };
  // período pedido fora da cobertura: a URL passa ao período efetivo e a tela explica o ajuste
  const [ajusteFeito, setAjusteFeito] = useState<{ de: number; ate: number } | null>(null);
  useEffect(() => {
    if (!cobertura.dados || !e.ajuste) return;
    setAjusteFeito(e.ajuste);
    definir({ de: e.de, ate: e.ate });
  }, [cobertura.dados, e.ajuste?.de, e.ajuste?.ate]); // eslint-disable-line react-hooks/exhaustive-deps
  const mudarPeriodo = (m: { de?: number; ate?: number }) => {
    setAjusteFeito(null);
    definir(m);
  };
  const ufEscopo = e.abrangencia === 'uf' && p.uf ? p.uf : null;
  const c = useApi<Classificacao>(anosCobertos.length && !e.ajuste ? 'ranking_posicoes' : null, {
    dominio: p.dominio, ind: p.ind, ...p.params, ordem: p.ordem, de: e.de, ate: e.ate, uf: ufEscopo ?? undefined,
    universo: e.universo, entes: e.entes.join(','),
  });
  const d = c.dados;
  const nomes = useMemo(() => new Map([...porCodigo].map(([k, v]) => [k, { nome: v.nome, uf: v.uf }])), [porCodigo]);
  const nomeDe = (cod: number) => {
    const n = nomes.get(cod);
    return n ? `${n.nome} (${n.uf})` : String(cod);
  };
  const opcoesMunicipios = useMemo(() => entes.filter((x) => x.esfera === 'M' && (!ufEscopo || x.uf === ufEscopo))
    .sort((a, b) => a.nome.localeCompare(b.nome)), [entes, ufEscopo]);

  // município principal (o 1º da lista) e comparação opcional (os demais, até 5 no total); o principal também vai
  // para o filtro da página (ente), o mesmo do ranking anual
  const principal = e.entes[0] ?? null;
  const trocarPrincipal = (alvo: Ente | null) => {
    if (!alvo) return;
    definir({ entes: [alvo.cod_ibge, ...e.entes.slice(1).filter((x) => x !== alvo.cod_ibge)] },
      { ente: String(alvo.cod_ibge), ...(busca.get('uf') ? { uf: alvo.uf } : {}) });
  };
  const [comparando, setComparando] = useState(e.entes.length > 1);
  const adicionar = (alvo: Ente | null) => {
    if (!alvo || e.entes.includes(alvo.cod_ibge) || e.entes.length >= MAX_COMPARADOS) return;
    definir({ entes: [...e.entes, alvo.cod_ibge] });
  };
  const [maisOpcoes, setMaisOpcoes] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const linkDaAnalise = () => {
    const b = gravarEstadoEvolucao(busca, { de: e.de, ate: e.ate, entes: e.entes });
    b.set('vista', 'evolucao');
    if (e.entes[0]) b.set('ente', String(e.entes[0]));
    return `${location.origin}${location.pathname}?${b}`;
  };
  const compartilhar = async () => {
    const link = linkDaAnalise();
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 4000);
    } catch {
      // sem acesso à área de transferência: mostra o link para copiar à mão
      window.prompt(t('Copie o link da análise:', 'Copy the analysis link:'), link);
    }
  };

  const pos = (x: { posicao_uf: number | null; posicao_br: number | null }) => (ufEscopo ? x.posicao_uf : x.posicao_br);
  const tot = (x: { total_uf: number | null; total_br: number | null }) => (ufEscopo ? x.total_uf : x.total_br);
  const real = e.precos === 'real' && p.monetario;
  const valorExibido = (v: number | null, f: number | null) => (v == null ? null : real ? (f == null ? null : v * f) : v);
  const unidade = real ? `${p.unidade}, R$ de dez/${d?.base_ipca ?? meta.baseIpca}` : p.unidade;
  const escopoNome = ufEscopo ? t(`municípios de ${ufEscopo}`, `municipalities in ${ufEscopo}`) : t('municípios do Brasil', 'municipalities in Brazil');
  const universoNome = e.universo === 'constante'
    ? t('universo constante: os mesmos municípios elegíveis em todos os anos do período, com as posições recalculadas nessa amostra', 'constant universe: the same municipalities eligible in every year of the period, with positions recomputed within that sample')
    : t('universo anual: os municípios elegíveis em cada ano', 'annual universe: the municipalities eligible in each year');
  // configurações fora do padrão (as do painel e as desta tela): aviso no botão e resumo junto ao gráfico
  const ativas = [
    ...(p.ativas ?? []),
    ...(e.universo === 'constante' ? [t('universo constante', 'constant universe')] : []),
    ...(e.escala === 'percentil' ? [t('posição relativa', 'relative position')] : []),
    ...(real ? [t('preços reais', 'real prices')] : []),
  ];
  const nota = p.nota?.(e.de, e.ate) ?? null;
  const parciais = (d?.universos ?? []).filter((u) => u.meses_caged != null && u.meses_caged < 12);
  const anos = d?.anos ?? [];
  const pontos = useMemo(() => (d ? pontosDaTrajetoria(d, e.entes) : []), [d, e.entes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // resumo de cada município: primeira e última posição do período (os anos sem posição ficam de fora)
  const resumos = e.entes.map((cod) => ({ cod, ...(d ? resumoTrajetoria(d, cod, e.de, e.ate, !!ufEscopo) : { ini: undefined, fim: undefined, semInicio: null, semFim: null, codigoInicio: null, codigoFim: null, variacao: null }) }));
  const lugar = (x: PontoPosicao) => t(`${numero(pos(x))}ª de ${numero(tot(x))} municípios, em ${x.ano}`, `${numero(pos(x))} of ${numero(tot(x))} municipalities in ${x.ano}`);
  // motivo em poucas palavras; "abaixo do mínimo" diz qual mínimo
  const motivoCurto = (codigo: string | null, texto: string | null) => (codigo === 'abaixo_minimo' && p.minimo
    ? t(`abaixo do mínimo de ${p.minimo}`, `below the minimum of ${p.minimo}`) : texto ?? '');
  const fraseResumo = (r: (typeof resumos)[number]) => {
    if (!r.ini || !r.fim) return t(`sem posição no período (em ${e.ate}: ${motivoCurto(r.codigoFim, r.semFim)}).`, `unranked in the period (in ${e.ate}: ${motivoCurto(r.codigoFim, r.semFim)}).`);
    if (!r.semInicio && !r.semFim) {
      return t(`passou da ${numero(pos(r.ini))}ª posição entre ${numero(tot(r.ini))} municípios, em ${r.ini.ano}, para a ${numero(pos(r.fim))}ª entre ${numero(tot(r.fim))}, em ${r.fim.ano} (${textoVariacao(r.variacao)}).`,
        `went from ${numero(pos(r.ini))} of ${numero(tot(r.ini))} municipalities in ${r.ini.ano} to ${numero(pos(r.fim))} of ${numero(tot(r.fim))} in ${r.fim.ano} (${textoVariacao(r.variacao)}).`);
    }
    // ano inicial ou final sem posição: frases curtas, a ausência primeiro; os detalhes ficam em "Ver dados e metodologia"
    const inicio = r.semInicio
      ? t(`sem posição em ${e.de}: ${motivoCurto(r.codigoInicio, r.semInicio)}. Primeira classificação: ${lugar(r.ini)}.`, `unranked in ${e.de}: ${motivoCurto(r.codigoInicio, r.semInicio)}. First ranking: ${lugar(r.ini)}.`)
      : t(`em ${e.de}, ${numero(pos(r.ini))}ª de ${numero(tot(r.ini))} municípios.`, `in ${e.de}, ${numero(pos(r.ini))} of ${numero(tot(r.ini))} municipalities.`);
    const fim = r.semFim
      ? t(`Sem posição em ${e.ate}: ${motivoCurto(r.codigoFim, r.semFim)}. Última classificação: ${lugar(r.fim)}.`, `Unranked in ${e.ate}: ${motivoCurto(r.codigoFim, r.semFim)}. Last ranking: ${lugar(r.fim)}.`)
      : t(`Em ${e.ate}, ${numero(pos(r.fim))}ª de ${numero(tot(r.fim))} municípios.`, `In ${e.ate}, ${numero(pos(r.fim))} of ${numero(tot(r.fim))} municipalities.`);
    return `${inicio} ${fim}`;
  };
  const universoMudou = (() => {
    const u = d?.universos ?? [];
    if (u.length < 2) return null;
    const a = ufEscopo ? u[0].total_uf : u[0].total_br;
    const b = ufEscopo ? u.at(-1)!.total_uf : u.at(-1)!.total_br;
    return a !== b ? { a, b, de: u[0].ano, ate: u.at(-1)!.ano } : null;
  })();

  // eixo das posições: do melhor colocado entre os mostrados (com folga) até o último lugar do maior universo;
  // o 1º lugar fica sempre no alto e, quando o eixo não começa nele, a nota do gráfico diz isso
  const faixaPosicoes = useMemo(() => {
    const posicoes = pontos.map((x) => (x.p ? pos(x.p) : null)).filter((v): v is number => v != null);
    const hi = Math.max(1, ...(d?.universos ?? []).map((u) => (ufEscopo ? u.total_uf ?? 0 : u.total_br)));
    if (!posicoes.length) return { lo: 1, hi };
    const folga = Math.max(1, Math.round((hi - Math.min(...posicoes)) * 0.08));
    const lo = Math.max(1, Math.min(...posicoes) - folga);
    return { lo: lo <= Math.max(3, hi * 0.05) ? 1 : lo, hi };
  }, [pontos, d, ufEscopo]); // eslint-disable-line react-hooks/exhaustive-deps

  const eixoX = (tk: Tokens) => ({ type: 'category', data: anos.map(String), axisLabel: { color: tk.tinta3 }, axisLine: { lineStyle: { color: tk.eixo } }, axisTick: { show: false } });
  const legenda = (tk: Tokens) => ({ type: 'scroll', top: 0, textStyle: { color: tk.tinta2 }, itemWidth: 14, itemHeight: 8, pageTextStyle: { color: tk.tinta3 } });
  const serieDe = (tk: Tokens, cod: number, i: number, valor: (x: PontoPosicao) => number | null) => ({
    name: nomeDe(cod), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 },
    itemStyle: { color: tk.comparacao[i], borderColor: tk.superficie, borderWidth: 2 },
    data: anos.map((a) => {
      const x = pontos.find((y) => y.cod === cod && y.ano === a)?.p;
      return x ? valor(x) : null;
    }),
  });
  // tooltip comum aos dois gráficos: ano, município, valor e unidade, posição e elegíveis
  const tooltip = (tk: Tokens) => {
    const porAno = new Map((d?.universos ?? []).map((u) => [u.ano, ufEscopo ? u.total_uf : u.total_br]));
    return {
      trigger: 'axis', backgroundColor: tk.superficie, borderColor: tk.grade, textStyle: { color: tk.tinta, fontSize: 12 },
      formatter: (ps: { axisValue: string; seriesIndex: number; marker: string }[]) => {
        const ano = Number(ps[0]?.axisValue);
        const linhas = e.entes.map((cod, i) => {
          const x = pontos.find((y) => y.cod === cod && y.ano === ano)?.p ?? null;
          const marca = ps.find((q) => q.seriesIndex === i)?.marker ?? '';
          const valor = x?.indicador != null ? `${p.formato(valorExibido(x.indicador, x.fator_real))} ${unidade}` : t('sem valor', 'no value');
          if (!x || pos(x) == null) return `${marca}<b>${nomeDe(cod)}</b>: ${valor}<br/>&nbsp;&nbsp;&nbsp;${t('sem posição', 'unranked')} (${textoMotivo(x?.motivo)})`;
          const rel = posicaoRelativa(pos(x), tot(x));
          return `${marca}<b>${x.nome} (${x.uf})</b>: ${valor}`
            + `<br/>&nbsp;&nbsp;&nbsp;${numero(pos(x))}º ${t('de', 'of')} ${numero(tot(x))}${rel == null ? '' : ` · ${t('posição relativa', 'relative position')} ${numero1(rel)}`}`;
        });
        return `<b>${ano}</b> · ${escopoNome}<br/>${linhas.join('<br/>')}<br/>${t('Elegíveis no ano', 'Eligible in the year')}: ${numero(porAno.get(ano) ?? null)}`;
      },
    };
  };

  const opcaoPosicao = useMemo(() => (tk: Tokens): EChartsCoreOption => {
    const percentil = e.escala === 'percentil';
    const { lo, hi } = faixaPosicoes;
    const porAno = new Map((d?.universos ?? []).map((u) => [u.ano, ufEscopo ? u.total_uf : u.total_br]));
    const series = e.entes.map((cod, i) => serieDe(tk, cod, i, (x) => (percentil ? posicaoRelativa(pos(x), tot(x)) : pos(x))));
    // o último lugar de cada ano (tamanho do universo): a posição se lê contra ele
    const ultimo = percentil ? [] : [{
      name: t('Último lugar (tamanho do universo)', 'Last place (universe size)'), type: 'line', symbol: 'none',
      lineStyle: { width: 1, type: 'dashed', color: tk.tinta3 }, itemStyle: { color: tk.tinta3 },
      data: anos.map((a) => porAno.get(a) ?? null),
    }];
    return {
      animation: false,
      grid: { left: 8, right: 24, top: 64, bottom: 8, containLabel: true },
      legend: legenda(tk), tooltip: tooltip(tk), xAxis: eixoX(tk),
      yAxis: percentil
        ? { type: 'value', min: 0, max: 100, name: t('posição relativa (100 = 1º)', 'relative position (100 = 1st)'), nameTextStyle: { color: tk.tinta3, align: 'left' },
          axisLabel: { color: tk.tinta3 }, splitLine: { lineStyle: { color: tk.grade } } }
        : { type: 'value', inverse: true, min: lo, max: hi, minInterval: 1, name: t('posição (1º no alto)', 'position (1st at the top)'), nameLocation: 'start', nameTextStyle: { color: tk.tinta3, align: 'left' },
          axisLabel: { color: tk.tinta3, formatter: (v: number) => `${numero(v)}º` }, splitLine: { lineStyle: { color: tk.grade } } },
      series: [...series, ...ultimo],
    };
  }, [d, pontos, faixaPosicoes, e.escala, e.entes.join(','), ufEscopo, real]); // eslint-disable-line react-hooks/exhaustive-deps

  const opcaoValor = useMemo(() => (tk: Tokens): EChartsCoreOption => ({
    animation: false,
    grid: { left: 8, right: 24, top: 40, bottom: 8, containLabel: true },
    legend: legenda(tk), tooltip: tooltip(tk), xAxis: eixoX(tk),
    yAxis: { type: 'value', scale: true, axisLabel: { color: tk.tinta3, formatter: (v: number) => p.formato(v) }, splitLine: { lineStyle: { color: tk.grade } } },
    // o valor aparece em todo ano com registro, mesmo sem posição (ex.: abaixo do mínimo)
    series: e.entes.map((cod, i) => serieDe(tk, cod, i, (x) => valorExibido(x.indicador, x.fator_real))),
  }), [d, pontos, e.entes.join(','), ufEscopo, real]); // eslint-disable-line react-hooks/exhaustive-deps

  const opcoesTabela = { unidade: p.unidade, monetario: p.monetario, percentual: p.percentual, uf: !!ufEscopo, baseIpca: d?.base_ipca ?? meta.baseIpca, nomes };
  const convencoes: [string, string][] = [
    [t('Ordenação', 'Order'), textoOrdem(p.ordem, p.nomeIndicador)],
    [t('Abrangência das posições', 'Scope of positions'), ufEscopo ? t(`municípios de ${ufEscopo} (o ranking nacional é calculado antes, com todos os municípios)`, `municipalities in ${ufEscopo} (the national ranking is computed first, with all municipalities)`) : t('municípios do Brasil', 'municipalities in Brazil')],
    [t('Universo', 'Universe'), universoNome],
    [t('Empates', 'Ties'), t('mesma posição, e a seguinte salta (1, 2, 2, 4)', 'same position, and the next one skips (1, 2, 2, 4)')],
    [t('Variação da posição', 'Change in position'), t('posição inicial − posição final: positiva = mais perto do 1º lugar; negativa = mais longe. Não é, por si, melhora ou piora: depende do indicador', 'initial position − final position: positive = closer to 1st place; negative = further. Not, by itself, an improvement or deterioration: it depends on the indicator')],
    [t('Posição relativa', 'Relative position'), t('100 × (N − posição) ÷ (N − 1), N = municípios elegíveis no ano: 100 = 1º, 0 = último; com um só município, não calculada', '100 × (N − position) ÷ (N − 1), N = eligible municipalities in the year: 100 = 1st, 0 = last; not computed with a single municipality')],
    [t('Ausências', 'Missing data'), t('ano sem posição fica em branco, com o motivo; ausência nunca vira zero', 'a year without a position is blank, with the reason; missing data never becomes zero')],
    ...(p.percentual ? [[t('Percentuais', 'Percentages'), t('diferença entre dois anos em pontos percentuais (p.p.); a variação relativa (%) vem à parte', 'difference between two years in percentage points (p.p.); the relative change (%) comes separately')] as [string, string]] : []),
    ...(p.monetario ? [[t('Valores reais', 'Real values'), t(`R$ de dezembro de ${d?.base_ipca ?? meta.baseIpca} (IPCA dez/dez); a posição de cada ano não muda com a deflação`, `December ${d?.base_ipca ?? meta.baseIpca} R$ (Dec/Dec IPCA); each year's position does not change with deflation`)] as [string, string]] : []),
  ];
  const metadados = (conteudo: string): [string, string][] => unicos([
    [t('Indicador', 'Indicator'), p.nomeIndicador], [t('Unidade', 'Unit'), p.unidade], [t('Período', 'Period'), `${e.de}–${e.ate}`],
    ...convencoes,
    ...(nota ? [[t('Comparabilidade', 'Comparability'), nota.completa ?? nota.curta] as [string, string]] : []),
    ...p.definicoes,
    [t('Conteúdo', 'Content'), conteudo],
    [t('Versão da base', 'Data version'), meta.geradoEm], [t('Exportado em', 'Exported on'), new Date().toISOString()], [t('Endereço', 'Address'), location.href],
  ]);

  // mudanças entre os dois anos: todos os municípios do escopo (a tela pagina; a exportação leva tudo)
  const [filtroMud, setFiltroMud] = useState<'todos' | 'subiram' | 'desceram'>('todos');
  const [buscaMud, setBuscaMud] = useState('');
  const [todas, setTodas] = useState(false);
  const termo = semAcento(buscaMud.trim());
  const mudancas = (d?.mudancas ?? []).filter((m) => {
    const v = variacaoPosicao(m.pos_ini, m.pos_fim);
    if (filtroMud === 'subiram' && !(v != null && v > 0)) return false;
    if (filtroMud === 'desceram' && !(v != null && v < 0)) return false;
    return !termo || semAcento(m.nome).includes(termo);
  });
  const visiveis = todas || termo ? mudancas : mudancas.slice(0, LINHAS_INICIAIS);
  const tabelaMud = d ? tabelaMudancas(d, opcoesTabela, e.de, e.ate) : null;
  const variacaoIndicador = (ri: number | null, rf: number | null) => {
    if (ri == null || rf == null) return '–';
    const dif = rf - ri;
    return p.percentual ? `${dif > 0 ? '+' : ''}${numero1(dif * 100)} p.p.` : `${dif > 0 ? '+' : ''}${p.formato(dif)}`;
  };

  const trajetoria = d ? tabelaTrajetorias(d, e.entes, opcoesTabela) : null;
  // tela: valores no formato do indicador, anos e códigos sem separador de milhar (a exportação leva os números completos)
  const celula = (v: string | number | null, coluna: string, j: number) => {
    if (typeof v !== 'number') return v ?? '–';
    if (j === 0 || j === 1) return String(v);
    if (j === 4 || (p.monetario && j === 5)) return p.formato(v);
    return /relativa|Relative/.test(coluna) ? numero1(v) : numero(v);
  };

  if (cobertura.carregando || cobertura.erro) return <Estado carregando={cobertura.carregando} erro={cobertura.erro} tentarNovamente={cobertura.recarregar} />;
  if (!anosCobertos.length) return <p className="vazio">{t('Nenhum ano com municípios classificados para este indicador e estas opções.', 'No year with ranked municipalities for this indicator and these options.')}</p>;
  return (
    <>
      <section className="cartao evol-entrada">
        <div className="filtros evol-principal">
          <BuscaEnte id="ev-municipio" rotulo={t('Município', 'Municipality')} entes={opcoesMunicipios} uf={ufEscopo}
            atual={principal ? porCodigo.get(principal) ?? null : null} aoEscolher={trocarPrincipal} semLimpar />
          {p.indicador}
        </div>
        <div className="evol-compactos">
          <label className="evol-compacto">{t('De', 'From')}{' '}
            <select value={e.de} onChange={(x) => mudarPeriodo({ de: Number(x.target.value) })}>
              {anosCobertos.filter((a) => a <= e.ate).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="evol-compacto">{t('até', 'to')}{' '}
            <select value={e.ate} onChange={(x) => mudarPeriodo({ ate: Number(x.target.value) })}>
              {anosCobertos.filter((a) => a >= e.de).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          {p.uf && (
            <div className="alternar compacto" role="group" aria-label={t('Abrangência', 'Scope')}>
              <button aria-pressed={e.abrangencia === 'br'} className={e.abrangencia === 'br' ? 'ativo' : ''} onClick={() => definir({ abrangencia: 'br' })}>{t('Brasil', 'Brazil')}</button>
              <button aria-pressed={e.abrangencia === 'uf'} className={e.abrangencia === 'uf' ? 'ativo' : ''} onClick={() => definir({ abrangencia: 'uf' })}>{p.uf}</button>
            </div>
          )}
          <span className="evol-acoes">
            <button className="botao-leve" onClick={compartilhar} title={t('Copia o link com o município, o indicador, o período e as opções', 'Copies the link with the municipality, indicator, period and options')}>
              {copiado ? t('Link copiado', 'Link copied') : t('Compartilhar análise', 'Share analysis')}
            </button>
            <span className="sr-only" aria-live="polite">{copiado ? t('Link da análise copiado', 'Analysis link copied') : ''}</span>
            <button className="botao-leve" aria-expanded={comparando} onClick={() => setComparando(!comparando)}>
              {t('Comparar municípios', 'Compare municipalities')}{e.entes.length > 1 ? ` (${e.entes.length})` : ''}
            </button>
            <button className={`botao-leve${ativas.length ? ' evol-ativas' : ''}`} aria-expanded={maisOpcoes} onClick={() => setMaisOpcoes(!maisOpcoes)}>
              {t('Mais opções', 'More options')}{ativas.length ? ` · ${ativas.length} ${ativas.length === 1 ? t('ativa', 'active') : t('ativas', 'active')}` : ''}
            </button>
          </span>
        </div>
        {comparando && (
          <div className="evol-comparados">
            {e.entes.map((cod, i) => (
              <span key={cod} className="evol-chip">
                <span className="evol-cor" style={{ background: `var(--cmp-${i + 1})` }} aria-hidden="true" />
                {nomeDe(cod)}
                {i > 0 && <button className="limpar" aria-label={t(`Tirar ${nomeDe(cod)}`, `Remove ${nomeDe(cod)}`)} onClick={() => definir({ entes: e.entes.filter((x) => x !== cod) })}>×</button>}
              </span>
            ))}
            {e.entes.length < MAX_COMPARADOS && (
              <BuscaEnte id="ev-comparar" rotulo={t(`Acrescentar município (até ${MAX_COMPARADOS})`, `Add municipality (up to ${MAX_COMPARADOS})`)}
                entes={opcoesMunicipios.filter((x) => !e.entes.includes(x.cod_ibge))} uf={ufEscopo} atual={null} aoEscolher={adicionar} />
            )}
          </div>
        )}
        {maisOpcoes && (
          <div className="evol-opcoes">
            <div className="filtros">
              <div className="alternar" role="group" aria-label={t('Universo', 'Universe')}>
                <button aria-pressed={e.universo === 'anual'} className={e.universo === 'anual' ? 'ativo' : ''} onClick={() => definir({ universo: 'anual' })}>{t('Universo anual', 'Annual universe')}</button>
                <button aria-pressed={e.universo === 'constante'} className={e.universo === 'constante' ? 'ativo' : ''} onClick={() => definir({ universo: 'constante' })}>{t('Universo constante', 'Constant universe')}</button>
              </div>
              <div className="alternar" role="group" aria-label={t('Escala da posição', 'Position scale')}>
                <button aria-pressed={e.escala === 'posicao'} className={e.escala === 'posicao' ? 'ativo' : ''} onClick={() => definir({ escala: 'posicao' })}>{t('Posição', 'Position')}</button>
                <button aria-pressed={e.escala === 'percentil'} className={e.escala === 'percentil' ? 'ativo' : ''} onClick={() => definir({ escala: 'percentil' })}>{t('Posição relativa', 'Relative position')}</button>
              </div>
              {p.monetario && (
                <div className="alternar" role="group" aria-label={t('Preços', 'Prices')}>
                  <button aria-pressed={!real} className={!real ? 'ativo' : ''} onClick={() => definir({ precos: 'nominal' })}>{t('Nominal', 'Nominal')}</button>
                  <button aria-pressed={real} className={real ? 'ativo' : ''} onClick={() => definir({ precos: 'real' })}>{t('Real', 'Real')}</button>
                </div>
              )}
              {p.opcoes}
            </div>
            <p className="nota-base">{t('Padrão: universo anual (os elegíveis de cada ano), posição absoluta e preços nominais. Universo constante: os mesmos municípios em todos os anos do período, com as posições recalculadas nessa amostra. Posição relativa: 100 = 1º, 0 = último.',
              'Default: annual universe (each year’s eligible municipalities), absolute position and nominal prices. Constant universe: the same municipalities in every year of the period, with positions recomputed within that sample. Relative position: 100 = 1st, 0 = last.')}</p>
          </div>
        )}
      </section>

      <Estado carregando={c.carregando} erro={c.erro} tentarNovamente={c.recarregar} />
      {d && (
        <section className="cartao evol-grafico">
          <div className="cabeca-cartao">
            <div>
              <h3>{p.nomeIndicador}</h3>
              <p className="desc">{unidade} · {escopoNome} · {e.de}–{e.ate}</p>
            </div>
            <div className="alternar" role="tablist" aria-label={t('Gráfico', 'Chart')}>
              <button role="tab" aria-selected={e.grafico === 'posicao'} className={e.grafico === 'posicao' ? 'ativo' : ''} onClick={() => definir({ grafico: 'posicao' })}>{t('Posição no ranking', 'Ranking position')}</button>
              <button role="tab" aria-selected={e.grafico === 'valor'} className={e.grafico === 'valor' ? 'ativo' : ''} onClick={() => definir({ grafico: 'valor' })}>{t('Valor do indicador', 'Indicator value')}</button>
            </div>
          </div>
          {e.entes.length === 0 ? (
            <p className="nota-base">{t('Escolha um município acima para ver a trajetória. Em “Ver dados e metodologia”, a tabela de mudanças já traz todos os municípios do escopo.', 'Choose a municipality above to see its trajectory. Under “See data and methodology”, the table of changes already lists every municipality in scope.')}</p>
          ) : (
            <>
              <ul className="evol-resumos">
                {resumos.map((r, i) => (
                  <li key={r.cod}>
                    {e.entes.length > 1 && <span className="evol-cor" style={{ background: `var(--cmp-${i + 1})` }} aria-hidden="true" />}
                    <strong>{nomeDe(r.cod)}</strong> {fraseResumo(r)}
                  </li>
                ))}
              </ul>
              <p className="nota-base">
                {t(`Ordenação: ${textoOrdem(p.ordem, p.nomeIndicador)}. Ficar mais perto do 1º lugar não quer dizer, por si, situação melhor ou pior: depende do indicador.`,
                  `Order: ${textoOrdem(p.ordem, p.nomeIndicador)}. Being closer to 1st place does not, by itself, mean a better or worse situation: it depends on the indicator.`)}
                {universoMudou && ` ${t(`O número de municípios elegíveis mudou de ${numero(universoMudou.a)} (${universoMudou.de}) para ${numero(universoMudou.b)} (${universoMudou.ate}).`, `The number of eligible municipalities changed from ${numero(universoMudou.a)} (${universoMudou.de}) to ${numero(universoMudou.b)} (${universoMudou.ate}).`)}`}
                {ativas.length > 0 && <> <strong>{t('Opções ativas', 'Active options')}:</strong> {ativas.join(' · ')}.</>}
              </p>
              {ajusteFeito && (
                <p className="aviso evol-nota" role="note">{t(`Período ajustado à cobertura do indicador: o pedido era ${ajusteFeito.de}–${ajusteFeito.ate}, mas ${p.nomeIndicador} só tem municípios classificados de ${anosCobertos[0]} a ${anosCobertos.at(-1)} com estas opções. Período mostrado: ${e.de}–${e.ate}.`,
                  `Period adjusted to the indicator's coverage: ${ajusteFeito.de}–${ajusteFeito.ate} was requested, but ${p.nomeIndicador} only has ranked municipalities from ${anosCobertos[0]} to ${anosCobertos.at(-1)} with these options. Period shown: ${e.de}–${e.ate}.`)}</p>
              )}
              {nota && (nota.completa
                ? <details className="aviso evol-nota"><summary>{nota.curta}</summary>{nota.completa}</details>
                : <p className="aviso evol-nota" role="note">{nota.curta}</p>)}
              {parciais.length > 0 && (
                <p className="aviso evol-nota" role="note">{t(`Anos com CAGED parcial: ${parciais.map((u) => `${u.ano} (até o mês ${u.meses_caged})`).join(', ')}; o valor desses anos não se compara com anos completos.`,
                  `Years with partial CAGED: ${parciais.map((u) => `${u.ano} (up to month ${u.meses_caged})`).join(', ')}; their values are not comparable with full years.`)}</p>
              )}
              {e.grafico === 'posicao'
                ? <Grafico opcao={opcaoPosicao} altura={340} nome={`${p.arquivo}_posicao_${e.de}_${e.ate}`}
                  descricao={t('Gráfico da posição por ano; os valores estão em Ver dados e metodologia', 'Chart of position by year; values are under See data and methodology')} />
                : <Grafico opcao={opcaoValor} altura={320} nome={`${p.arquivo}_valor_${e.de}_${e.ate}`}
                  descricao={t('Gráfico do valor do indicador por ano; os valores estão em Ver dados e metodologia', 'Chart of the indicator value by year; values are under See data and methodology')} />}
              <p className="evol-fonte">
                {t(`Fonte: ${p.fonte}. Base atualizada em ${new Date(p.atualizadoEm ?? meta.geradoEm).toLocaleDateString(local())}; último ano disponível para este indicador: ${anosCobertos.at(-1)}.`,
                  `Source: ${p.fonte}. Data updated on ${new Date(p.atualizadoEm ?? meta.geradoEm).toLocaleDateString(local())}; latest year available for this indicator: ${anosCobertos.at(-1)}.`)}
              </p>
              <p className="nota-base">
                {e.grafico === 'posicao'
                  ? (e.escala === 'percentil' ? t('Posição relativa: 100 = 1º lugar, 0 = último.', 'Relative position: 100 = 1st place, 0 = last.')
                    : t(`1º lugar no alto; a linha tracejada é o último lugar de cada ano${faixaPosicoes.lo > 1 ? `; eixo ampliado, começa no ${numero(faixaPosicoes.lo)}º` : ''}.`, `1st place at the top; the dashed line is the last place in each year${faixaPosicoes.lo > 1 ? `; zoomed axis, starts at ${numero(faixaPosicoes.lo)}th` : ''}.`))
                  : t('O valor aparece em todo ano com registro, mesmo quando o município ficou sem posição.', 'The value appears in every year with a record, even when the municipality was unranked.')}
                {pontos.some((x) => !x.p || pos(x.p) == null) && ` ${t('Anos sem posição', 'Unranked years')}: ${pontos.filter((x) => !x.p || pos(x.p) == null)
                  .map((x) => `${nomeDe(x.cod)} ${x.ano} (${textoMotivo(x.p?.motivo)})`).join('; ')}.`}
              </p>
            </>
          )}
        </section>
      )}

      {d && (
        <details className="cartao evol-detalhes">
          <summary>{t('Ver dados e metodologia', 'See data and methodology')}</summary>
          {trajetoria && e.entes.length > 0 && (
            <>
              <div className="cabeca-cartao">
                <h3>{t('Trajetória por ano', 'Trajectory by year')}</h3>
                <BotoesExportar nome={`${p.arquivo}_trajetoria_${e.de}_${e.ate}`} obter={() => ({ ...trajetoria, metadados: metadados(t('todas as observações dos municípios mostrados, um ano por linha (inclusive os anos sem posição)', 'all observations of the municipalities shown, one year per row (including unranked years)')) })} />
              </div>
              <div className="rolagem">
                <table className="tabela-fixa">
                  <thead><tr>{trajetoria.colunas.map((x) => <th key={x}>{x}</th>)}</tr></thead>
                  <tbody>{trajetoria.linhas.map((l, i) => <tr key={i}>{l.map((v, j) => <td key={j}>{celula(v, trajetoria.colunas[j], j)}</td>)}</tr>)}</tbody>
                </table>
              </div>
            </>
          )}
          <h3>{t('Municípios elegíveis por ano', 'Eligible municipalities by year')}</h3>
          <div className="rolagem">
            <table>
              <thead><tr><th>{t('Ano', 'Year')}</th>{d.universos.map((u) => <th key={u.ano}>{u.ano}</th>)}</tr></thead>
              <tbody>
                <tr><td>{t('Brasil', 'Brazil')}</td>{d.universos.map((u) => <td key={u.ano}>{numero(u.total_br)}</td>)}</tr>
                {ufEscopo && <tr><td>{ufEscopo}</td>{d.universos.map((u) => <td key={u.ano}>{numero(u.total_uf)}</td>)}</tr>}
              </tbody>
            </table>
          </div>
          {tabelaMud && (
            <>
              <div className="cabeca-cartao">
                <div>
                  <h3>{t(`Mudanças de posição de ${e.de} a ${e.ate}`, `Changes in position from ${e.de} to ${e.ate}`)}</h3>
                  <p className="desc">{t(`Todos os ${escopoNome} com posição em ${e.de} ou em ${e.ate}. Variação da posição = posição em ${e.de} − posição em ${e.ate} (positiva = mais perto do 1º lugar).${p.monetario ? ' A variação do indicador é em valores reais.' : ''}${p.percentual ? ' A diferença do indicador é em pontos percentuais.' : ''}`,
                    `All ${escopoNome} ranked in ${e.de} or ${e.ate}. Change in position = position in ${e.de} − position in ${e.ate} (positive = closer to 1st place).${p.monetario ? ' The change in the indicator is in real terms.' : ''}${p.percentual ? ' The difference in the indicator is in percentage points.' : ''}`)}</p>
                </div>
                <BotoesExportar nome={`${p.arquivo}_mudancas_${e.de}_${e.ate}`} obter={() => ({ ...tabelaMud, metadados: metadados(t(`todos os municípios do escopo com posição em ${e.de} ou ${e.ate} (${tabelaMud.linhas.length} linhas; a tela mostra ${LINHAS_INICIAIS} de início)`, `every municipality in scope ranked in ${e.de} or ${e.ate} (${tabelaMud.linhas.length} rows; the screen first shows ${LINHAS_INICIAIS})`)) })} />
              </div>
              <div className="filtros">
                <div className="alternar" role="group" aria-label={t('Mostrar', 'Show')}>
                  {(['todos', 'subiram', 'desceram'] as const).map((k) => (
                    <button key={k} aria-pressed={filtroMud === k} className={filtroMud === k ? 'ativo' : ''} onClick={() => setFiltroMud(k)}>
                      {k === 'todos' ? t('Todos', 'All') : k === 'subiram' ? t('Mais perto do 1º', 'Closer to 1st') : t('Mais longe do 1º', 'Further from 1st')}
                    </button>
                  ))}
                </div>
                <div className="campo">
                  <label htmlFor="ev-busca">{t('Buscar município', 'Search municipality')}</label>
                  <input id="ev-busca" value={buscaMud} onChange={(x) => setBuscaMud(x.target.value)} placeholder={t('nome…', 'name…')} />
                </div>
              </div>
              <div className="rolagem">
                <table className="tabela-fixa">
                  <thead>
                    <tr>
                      <th>{t('Município', 'Municipality')}</th><th>{t('Código IBGE', 'IBGE code')}</th>
                      <th>{t(`Valor ${e.de}`, `Value ${e.de}`)}{p.monetario ? ` (${real ? t(`real, R$ de dez/${d.base_ipca}`, `real, Dec/${d.base_ipca} R$`) : t('nominal', 'nominal')})` : ''}</th>
                      <th>{t(`Valor ${e.ate}`, `Value ${e.ate}`)}{p.monetario ? ` (${real ? t(`real, R$ de dez/${d.base_ipca}`, `real, Dec/${d.base_ipca} R$`) : t('nominal', 'nominal')})` : ''}</th>
                      <th>{p.percentual ? t('Diferença do indicador (p.p.)', 'Difference in indicator (p.p.)')
                        : p.monetario ? t(`Variação real do indicador (R$ de dez/${d.base_ipca})`, `Real change in indicator (Dec/${d.base_ipca} R$)`)
                          : t('Variação do indicador', 'Change in indicator')}</th>
                      <th>{t(`Posição ${e.de}`, `Position ${e.de}`)}</th><th>{t(`Posição ${e.ate}`, `Position ${e.ate}`)}</th>
                      <th>{t('Variação da posição', 'Change in position')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((m) => {
                      const ri = valorExibido(m.valor_ini, m.fator_ini);
                      const rf = valorExibido(m.valor_fim, m.fator_fim);
                      // monetário: variação em termos reais, como na exportação
                      const varInd = p.monetario
                        ? variacaoIndicador(m.valor_ini != null && m.fator_ini != null ? m.valor_ini * m.fator_ini : null, m.valor_fim != null && m.fator_fim != null ? m.valor_fim * m.fator_fim : null)
                        : variacaoIndicador(m.valor_ini, m.valor_fim);
                      return (
                        <tr key={m.cod_ibge} className={e.entes.includes(m.cod_ibge) ? 'destaque' : undefined}>
                          <td>{m.nome}{ufEscopo ? '' : ` (${m.uf})`}</td><td>{m.cod_ibge}</td>
                          <td>{ri == null ? '–' : p.formato(ri)}</td><td>{rf == null ? '–' : p.formato(rf)}</td>
                          <td>{varInd}</td>
                          <td>{m.pos_ini == null ? '–' : `${numero(m.pos_ini)}º ${t('de', 'of')} ${numero(m.total_ini)}`}</td>
                          <td>{m.pos_fim == null ? '–' : `${numero(m.pos_fim)}º ${t('de', 'of')} ${numero(m.total_fim)}`}</td>
                          <td>{sinal(variacaoPosicao(m.pos_ini, m.pos_fim))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="legenda-tabela">
                {!todas && !termo && mudancas.length > LINHAS_INICIAIS ? t(`Mostrando ${LINHAS_INICIAIS} de ${numero(mudancas.length)}. `, `Showing ${LINHAS_INICIAIS} of ${numero(mudancas.length)}. `) : ''}
                {mudancas.length > LINHAS_INICIAIS && !termo && <button className="limpar" onClick={() => setTodas(!todas)}>{todas ? t('mostrar menos', 'show fewer') : t('mostrar todos', 'show all')}</button>}
                {' '}{t('“–” = sem posição naquele ano. A exportação traz todas as linhas e os valores completos.', '“–” = unranked in that year. The export has every row and the full values.')}
              </p>
            </>
          )}
          <h3>{t('Metodologia', 'Methodology')} <Dica rotulo={t('Convenções', 'Conventions')}>{t('As mesmas definições vão nos metadados de cada exportação.', 'The same definitions go into the metadata of every export.')}</Dica></h3>
          <dl className="evol-definicoes">
            {unicos([...convencoes, ...p.definicoes]).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
        </details>
      )}
    </>
  );
}

/** Alternância entre o ranking anual e a evolução da posição (vista=evolucao na URL; os demais parâmetros ficam). */
export function AlternarVista({ vista, mudar }: { vista: 'anual' | 'evolucao'; mudar: (v: 'anual' | 'evolucao') => void }) {
  return (
    <div className="alternar vista-ranking" role="tablist" aria-label={t('Vista do ranking', 'Ranking view')}>
      <button role="tab" aria-selected={vista === 'anual'} className={vista === 'anual' ? 'ativo' : ''} onClick={() => mudar('anual')}>{t('Ranking anual', 'Annual ranking')}</button>
      <button role="tab" aria-selected={vista === 'evolucao'} className={vista === 'evolucao' ? 'ativo' : ''} onClick={() => mudar('evolucao')}>{t('Evolução da posição', 'Position over time')}</button>
    </div>
  );
}
