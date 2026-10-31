import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { EChartsCoreOption } from 'echarts/core';
import { useApi, type Params } from '../api';
import { BotoesExportar } from './Exportar';
import { Dica } from './Dica';
import { CartaoGrafico, Grafico, type Tokens } from './Grafico';
import { Estado } from './Kpi';
import { useDados } from '../contexto';
import type { Classificacao, DominioRanking } from '../dados';
import { numero, numero1 } from '../format';
import { t } from '../idioma';
import {
  gravarEstadoEvolucao, lerEstadoEvolucao, MAX_COMPARADOS, pontosDaTrajetoria, posicaoRelativa, tabelaMudancas, tabelaTrajetorias,
  textoMotivo, variacaoPosicao,
} from '../posicoes';

type Props = {
  dominio: DominioRanking;
  ind: string;
  nomeIndicador: string;
  /** unidade do indicador (ex.: "R$ por habitante", "por mil nascidos vivos") */
  unidade: string;
  formato: (v: number | null) => string;
  monetario: boolean;
  /** parâmetros próprios do painel que mudam o universo (medida, tratamento, mínimo) */
  params: Params;
  ordem: 'asc' | 'desc';
  /** anos da fonte com o indicador */
  anos: number[];
  /** UF da página (filtros), se houver */
  uf: string | null;
  /** município dos filtros, comparado por padrão */
  ente: number | null;
  /** definições, critérios e fonte, para a tela e as exportações */
  definicoes: [string, string][];
  /** nota de comparabilidade do período (quebra de série, ano parcial), se houver */
  nota?: (de: number, ate: number) => string | null;
  arquivo: string;
};

const LINHAS_INICIAIS = 50;

/** "Maiores primeiro" ou "menores primeiro", com o que é o 1º lugar; não diz se é melhor ou pior. */
export const textoOrdem = (ordem: 'asc' | 'desc', nome: string) => (ordem === 'desc'
  ? t(`maiores primeiro: o 1º lugar tem o maior valor de ${nome}`, `highest first: 1st place has the highest ${nome}`)
  : t(`menores primeiro: o 1º lugar tem o menor valor de ${nome}`, `lowest first: 1st place has the lowest ${nome}`));

const textoVariacao = (v: number | null) => (v === null ? '–' : v > 0
  ? t(`subiu ${numero(v)} ${v === 1 ? 'posição' : 'posições'}`, `up ${numero(v)} ${v === 1 ? 'position' : 'positions'}`)
  : v < 0 ? t(`desceu ${numero(-v)} ${v === -1 ? 'posição' : 'posições'}`, `down ${numero(-v)} ${v === -1 ? 'position' : 'positions'}`)
    : t('mesma posição', 'same position'));

/** Cada chave uma vez, a primeira que aparece. */
const unicos = (l: [string, string][]) => l.filter(([k], i) => l.findIndex(([x]) => x === k) === i);

const sinal = (v: number | null) => (v === null ? '–' : v > 0 ? `+${numero(v)}` : numero(v));

export function EvolucaoPosicao(p: Props) {
  const { meta, entes, porCodigo } = useDados();
  const [busca, setBusca] = useSearchParams();
  const e = lerEstadoEvolucao(busca, p.anos, { ente: p.ente, temUf: !!p.uf });
  const definir = (m: Parameters<typeof gravarEstadoEvolucao>[1]) => setBusca(gravarEstadoEvolucao(busca, m), { replace: true });
  const ufEscopo = e.abrangencia === 'uf' && p.uf ? p.uf : null;
  const c = useApi<Classificacao>(p.anos.length ? 'ranking_posicoes' : null, {
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
  const [novo, setNovo] = useState('');
  const adicionar = (texto: string) => {
    const alvo = opcoesMunicipios.find((x) => `${x.nome} (${x.uf})` === texto || String(x.cod_ibge) === texto.trim());
    if (!alvo || e.entes.includes(alvo.cod_ibge) || e.entes.length >= MAX_COMPARADOS) return;
    definir({ entes: [...e.entes, alvo.cod_ibge] });
    setNovo('');
  };
  const pos = (x: { posicao_uf: number | null; posicao_br: number | null }) => (ufEscopo ? x.posicao_uf : x.posicao_br);
  const tot = (x: { total_uf: number | null; total_br: number | null }) => (ufEscopo ? x.total_uf : x.total_br);
  const real = e.precos === 'real' && p.monetario;
  const valorExibido = (v: number | null, f: number | null) => (v == null ? null : real ? (f == null ? null : v * f) : v);
  const unidade = real ? `${p.unidade} (R$ de dez/${d?.base_ipca ?? meta.baseIpca})` : p.unidade;
  const escopoNome = ufEscopo ? t(`municípios de ${ufEscopo}`, `municipalities in ${ufEscopo}`) : t('municípios do Brasil', 'municipalities in Brazil');
  const universoNome = e.universo === 'constante'
    ? t('universo constante: os mesmos municípios elegíveis em todos os anos do período, com as posições recalculadas nessa amostra', 'constant universe: the same municipalities eligible in every year of the period, with positions recomputed within that sample')
    : t('universo anual: os municípios elegíveis em cada ano', 'annual universe: the municipalities eligible in each year');
  const nota = p.nota?.(e.de, e.ate) ?? null;
  const parciais = (d?.universos ?? []).filter((u) => u.meses_caged != null && u.meses_caged < 12);
  const anos = d?.anos ?? [];
  const pontos = useMemo(() => (d ? pontosDaTrajetoria(d, e.entes) : []), [d, e.entes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // resumo de cada município: primeira e última posição do período (os anos sem posição ficam de fora)
  const resumos = e.entes.map((cod) => {
    const comPos = pontos.filter((x) => x.cod === cod && x.p && pos(x.p) != null).map((x) => x.p!);
    const ini = comPos[0];
    const fim = comPos.at(-1);
    return { cod, ini, fim, variacao: ini && fim && ini !== fim ? variacaoPosicao(pos(ini), pos(fim)) : null };
  });

  // eixo das posições: do melhor colocado entre os comparados (com folga) até o último lugar do maior universo;
  // o 1º lugar fica sempre no alto e, quando o eixo não começa nele, a descrição do gráfico diz isso
  const faixaPosicoes = useMemo(() => {
    const posicoes = pontos.map((x) => (x.p ? pos(x.p) : null)).filter((v): v is number => v != null);
    const hi = Math.max(1, ...(d?.universos ?? []).map((u) => (ufEscopo ? u.total_uf ?? 0 : u.total_br)));
    if (!posicoes.length) return { lo: 1, hi };
    const folga = Math.max(1, Math.round((hi - Math.min(...posicoes)) * 0.08));
    const lo = Math.max(1, Math.min(...posicoes) - folga);
    return { lo: lo <= Math.max(3, hi * 0.05) ? 1 : lo, hi };
  }, [pontos, d, ufEscopo]); // eslint-disable-line react-hooks/exhaustive-deps

  const opcaoPosicao = useMemo(() => (tk: Tokens): EChartsCoreOption => {
    const percentil = e.escala === 'percentil';
    const { lo, hi } = faixaPosicoes;
    const porAno = new Map((d?.universos ?? []).map((u) => [u.ano, ufEscopo ? u.total_uf : u.total_br]));
    const series = e.entes.map((cod, i) => ({
      name: nomeDe(cod), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 },
      itemStyle: { color: tk.comparacao[i], borderColor: tk.superficie, borderWidth: 2 },
      data: anos.map((a) => {
        const x = pontos.find((y) => y.cod === cod && y.ano === a)?.p;
        const v = x ? (percentil ? posicaoRelativa(pos(x), tot(x)) : pos(x)) : null;
        return v == null ? null : v;
      }),
    }));
    // o último lugar de cada ano (tamanho do universo): a posição se lê contra ele
    const ultimo = percentil ? [] : [{
      name: t('Último lugar (tamanho do universo)', 'Last place (universe size)'), type: 'line', symbol: 'none',
      lineStyle: { width: 1, type: 'dashed', color: tk.tinta3 }, itemStyle: { color: tk.tinta3 },
      data: anos.map((a) => porAno.get(a) ?? null),
    }];
    return {
      animation: false,
      grid: { left: 8, right: 24, top: 64, bottom: 8, containLabel: true },
      legend: { type: 'scroll', top: 0, textStyle: { color: tk.tinta2 }, itemWidth: 14, itemHeight: 8, pageTextStyle: { color: tk.tinta3 } },
      tooltip: {
        trigger: 'axis', backgroundColor: tk.superficie, borderColor: tk.grade, textStyle: { color: tk.tinta, fontSize: 12 },
        formatter: (ps: { axisValue: string; seriesIndex: number; marker: string }[]) => {
          const ano = Number(ps[0]?.axisValue);
          const linhas = e.entes.map((cod, i) => {
            const x = pontos.find((y) => y.cod === cod && y.ano === ano)?.p ?? null;
            const marca = ps.find((q) => q.seriesIndex === i)?.marker ?? '';
            if (!x || pos(x) == null) return `${marca}${nomeDe(cod)}: ${t('sem posição', 'unranked')} (${textoMotivo(x?.motivo)})`;
            const rel = posicaoRelativa(pos(x), tot(x));
            return `${marca}<b>${x.nome} (${x.uf})</b>: ${p.formato(valorExibido(x.indicador, x.fator_real))} ${unidade}`
              + `<br/>&nbsp;&nbsp;&nbsp;${numero(pos(x))}º ${t('de', 'of')} ${numero(tot(x))}${rel == null ? '' : ` · ${t('posição relativa', 'relative position')} ${numero1(rel)}`}`;
          });
          return `<b>${ano}</b> · ${escopoNome}<br/>${linhas.join('<br/>')}<br/>${t('Elegíveis no ano', 'Eligible in the year')}: ${numero(porAno.get(ano) ?? null)}`;
        },
      },
      xAxis: { type: 'category', data: anos.map(String), axisLabel: { color: tk.tinta3 }, axisLine: { lineStyle: { color: tk.eixo } }, axisTick: { show: false } },
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
    grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
    legend: { type: 'scroll', top: 0, textStyle: { color: tk.tinta2 }, itemWidth: 14, itemHeight: 8, pageTextStyle: { color: tk.tinta3 } },
    tooltip: {
      trigger: 'axis', backgroundColor: tk.superficie, borderColor: tk.grade, textStyle: { color: tk.tinta, fontSize: 12 },
      valueFormatter: (v: number | null) => (v == null ? t('sem valor', 'no value') : `${p.formato(v)} ${unidade}`),
    },
    xAxis: { type: 'category', data: anos.map(String), axisLabel: { color: tk.tinta3 }, axisLine: { lineStyle: { color: tk.eixo } }, axisTick: { show: false } },
    yAxis: { type: 'value', scale: true, axisLabel: { color: tk.tinta3, formatter: (v: number) => p.formato(v) }, splitLine: { lineStyle: { color: tk.grade } } },
    series: e.entes.map((cod, i) => ({
      name: nomeDe(cod), type: 'line', connectNulls: false, symbol: 'circle', symbolSize: 8, lineStyle: { width: 2 },
      itemStyle: { color: tk.comparacao[i], borderColor: tk.superficie, borderWidth: 2 },
      // o valor do indicador aparece em todo ano com registro, mesmo sem posição (ex.: abaixo do mínimo)
      data: anos.map((a) => {
        const x = pontos.find((y) => y.cod === cod && y.ano === a)?.p;
        return x ? valorExibido(x.indicador, x.fator_real) : null;
      }),
    })),
  }), [d, pontos, e.entes.join(','), real]); // eslint-disable-line react-hooks/exhaustive-deps

  const opcoesTabela = { unidade: p.unidade, monetario: p.monetario, uf: !!ufEscopo, baseIpca: d?.base_ipca ?? meta.baseIpca, nomes };
  // a mesma chave só uma vez (as definições do painel podem repetir a data e a versão)
  const metadados = (conteudo: string): [string, string][] => unicos([
    [t('Indicador', 'Indicator'), p.nomeIndicador], [t('Unidade', 'Unit'), p.unidade],
    [t('Ordenação', 'Order'), textoOrdem(p.ordem, p.nomeIndicador)],
    [t('Abrangência das posições', 'Scope of positions'), ufEscopo ? t(`municípios de ${ufEscopo} (o ranking nacional é calculado antes, com todos os municípios)`, `municipalities in ${ufEscopo} (the national ranking is computed first, with all municipalities)`) : t('municípios do Brasil', 'municipalities in Brazil')],
    [t('Universo', 'Universe'), universoNome], [t('Período', 'Period'), `${e.de}–${e.ate}`],
    [t('Empates', 'Ties'), t('mesma posição, e a seguinte salta (1, 2, 2, 4)', 'same position, and the next one skips (1, 2, 2, 4)')],
    [t('Variação da posição', 'Change in position'), t('posição inicial − posição final: positiva = ganhou posições (mais perto do 1º); negativa = perdeu', 'initial position − final position: positive = gained positions (closer to 1st); negative = lost')],
    [t('Posição relativa', 'Relative position'), t('100 × (N − posição) ÷ (N − 1), N = municípios elegíveis no ano: 100 = 1º, 0 = último; com um só município, não calculada', '100 × (N − position) ÷ (N − 1), N = eligible municipalities in the year: 100 = 1st, 0 = last; not computed with a single municipality')],
    [t('Ausências', 'Missing data'), t('ano sem posição fica em branco, com o motivo; ausência nunca vira zero', 'a year without a position is blank, with the reason; missing data never becomes zero')],
    ...(p.monetario ? [[t('Valores reais', 'Real values'), t(`R$ de dezembro de ${d?.base_ipca ?? meta.baseIpca} (IPCA dez/dez); a posição de cada ano não muda com a deflação`, `December ${d?.base_ipca ?? meta.baseIpca} R$ (Dec/Dec IPCA); each year's position does not change with deflation`)] as [string, string]] : []),
    ...(nota ? [[t('Comparabilidade', 'Comparability'), nota] as [string, string]] : []),
    ...p.definicoes,
    [t('Conteúdo', 'Content'), conteudo],
    [t('Versão da base', 'Data version'), meta.geradoEm], [t('Exportado em', 'Exported on'), new Date().toISOString()], [t('Endereço', 'Address'), location.href],
  ]);

  // mudanças entre os dois anos: todos os municípios do escopo (a tela pagina; a exportação leva tudo)
  const [filtroMud, setFiltroMud] = useState<'todos' | 'subiram' | 'desceram'>('todos');
  const [buscaMud, setBuscaMud] = useState('');
  const [todas, setTodas] = useState(false);
  const termo = buscaMud.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const mudancas = (d?.mudancas ?? []).filter((m) => {
    const v = variacaoPosicao(m.pos_ini, m.pos_fim);
    if (filtroMud === 'subiram' && !(v != null && v > 0)) return false;
    if (filtroMud === 'desceram' && !(v != null && v < 0)) return false;
    return !termo || m.nome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo);
  });
  const visiveis = todas || termo ? mudancas : mudancas.slice(0, LINHAS_INICIAIS);
  const tabelaMud = d ? tabelaMudancas(d, opcoesTabela, e.de, e.ate) : null;

  const trajetoria = d ? tabelaTrajetorias(d, e.entes, opcoesTabela) : null;
  const tabelaTraj = trajetoria && (
    <table className="tabela-fixa">
      <thead><tr>{trajetoria.colunas.map((x) => <th key={x}>{x}</th>)}</tr></thead>
      <tbody>
        {trajetoria.linhas.map((l, i) => (
          <tr key={i}>{l.map((v, j) => <td key={j}>{typeof v === 'number'
            ? (j === 4 || (p.monetario && j === 5) ? p.formato(v) : trajetoria.colunas[j].includes('relativa') || trajetoria.colunas[j].includes('Relative') ? numero1(v) : j === 1 ? String(v) : numero(v))
            : v ?? '–'}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );

  if (!p.anos.length) return <p className="vazio">{t('Sem anos com dados para este indicador.', 'No years with data for this indicator.')}</p>;
  return (
    <>
      <section className="cartao">
        <div className="filtros">
          <div className="campo">
            <label htmlFor="ev-de">{t('De', 'From')}</label>
            <select id="ev-de" value={e.de} onChange={(x) => definir({ de: Number(x.target.value) })}>
              {p.anos.filter((a) => a <= e.ate).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="ev-ate">{t('Até', 'To')}</label>
            <select id="ev-ate" value={e.ate} onChange={(x) => definir({ ate: Number(x.target.value) })}>
              {p.anos.filter((a) => a >= e.de).map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          {p.uf && (
            <div className="alternar" role="group" aria-label={t('Abrangência', 'Scope')}>
              <button aria-pressed={e.abrangencia === 'br'} className={e.abrangencia === 'br' ? 'ativo' : ''} onClick={() => definir({ abrangencia: 'br' })}>{t('Brasil', 'Brazil')}</button>
              <button aria-pressed={e.abrangencia === 'uf'} className={e.abrangencia === 'uf' ? 'ativo' : ''} onClick={() => definir({ abrangencia: 'uf' })}>{p.uf}</button>
            </div>
          )}
          <div className="alternar" role="group" aria-label={t('Universo', 'Universe')}>
            <button aria-pressed={e.universo === 'anual'} className={e.universo === 'anual' ? 'ativo' : ''} onClick={() => definir({ universo: 'anual' })}>{t('Universo anual', 'Annual universe')}</button>
            <button aria-pressed={e.universo === 'constante'} className={e.universo === 'constante' ? 'ativo' : ''} onClick={() => definir({ universo: 'constante' })}>{t('Universo constante', 'Constant universe')}</button>
          </div>
          <div className="alternar" role="group" aria-label={t('Escala do gráfico de posições', 'Position chart scale')}>
            <button aria-pressed={e.escala === 'posicao'} className={e.escala === 'posicao' ? 'ativo' : ''} onClick={() => definir({ escala: 'posicao' })}>{t('Posição', 'Position')}</button>
            <button aria-pressed={e.escala === 'percentil'} className={e.escala === 'percentil' ? 'ativo' : ''} onClick={() => definir({ escala: 'percentil' })}>{t('Posição relativa', 'Relative position')}</button>
          </div>
          {p.monetario && (
            <div className="alternar" role="group" aria-label={t('Preços', 'Prices')}>
              <button aria-pressed={!real} className={!real ? 'ativo' : ''} onClick={() => definir({ precos: 'nominal' })}>{t('Nominal', 'Nominal')}</button>
              <button aria-pressed={real} className={real ? 'ativo' : ''} onClick={() => definir({ precos: 'real' })}>{t('Real', 'Real')}</button>
            </div>
          )}
        </div>
        <div className="evol-comparados">
          <span className="evol-rotulo">{t(`Municípios comparados (até ${MAX_COMPARADOS})`, `Compared municipalities (up to ${MAX_COMPARADOS})`)}:</span>
          {e.entes.map((cod, i) => (
            <span key={cod} className="evol-chip">
              <span className="evol-cor" style={{ background: `var(--cmp-${i + 1})` }} aria-hidden="true" />
              {nomeDe(cod)}
              <button className="limpar" aria-label={t(`Tirar ${nomeDe(cod)}`, `Remove ${nomeDe(cod)}`)} onClick={() => definir({ entes: e.entes.filter((x) => x !== cod) })}>×</button>
            </span>
          ))}
          {e.entes.length < MAX_COMPARADOS && (
            <>
              <input list="ev-municipios" value={novo} placeholder={t('acrescentar município…', 'add municipality…')} aria-label={t('Acrescentar município', 'Add municipality')}
                onChange={(x) => { setNovo(x.target.value); adicionar(x.target.value); }} onKeyDown={(x) => x.key === 'Enter' && adicionar(novo)} />
              <datalist id="ev-municipios">{opcoesMunicipios.map((x) => <option key={x.cod_ibge} value={`${x.nome} (${x.uf})`} />)}</datalist>
            </>
          )}
        </div>
        <p className="desc">
          {t('Ordenação', 'Order')}: {textoOrdem(p.ordem, p.nomeIndicador)}. {t('Estar mais perto do 1º lugar não quer dizer, por si, situação melhor ou pior: depende do indicador.', 'Being closer to 1st place does not, by itself, mean a better or worse situation: it depends on the indicator.')}
          {' '}{t('Posições entre', 'Positions among')} {escopoNome}; {universoNome}.{' '}
          <Dica rotulo={t('Convenções', 'Conventions')}>
            {t('Empates recebem a mesma posição e a seguinte salta (1, 2, 2, 4). Variação da posição = posição inicial − posição final: positiva quando o município ganhou posições, negativa quando perdeu. Como o número de municípios elegíveis muda de um ano para outro, uma mudança de posição sozinha não prova melhora nem piora: compare com o valor do indicador, a posição relativa e o universo constante. Posição relativa = 100 × (N − posição) ÷ (N − 1): 100 = 1º, 0 = último.',
              'Ties share the same position and the next one skips (1, 2, 2, 4). Change in position = initial position − final position: positive when the municipality gained positions, negative when it lost. Since the number of eligible municipalities changes from year to year, a change in position alone proves neither improvement nor deterioration: compare with the indicator value, the relative position and the constant universe. Relative position = 100 × (N − position) ÷ (N − 1): 100 = 1st, 0 = last.')}
          </Dica>
        </p>
        {nota && <p className="aviso" role="note">{nota}</p>}
        {parciais.length > 0 && (
          <p className="aviso" role="note">{t(`Anos com CAGED parcial: ${parciais.map((u) => `${u.ano} (até o mês ${u.meses_caged})`).join(', ')}. No mesmo ano todos os municípios têm os mesmos meses, mas o valor não se compara com anos completos.`,
            `Years with partial CAGED: ${parciais.map((u) => `${u.ano} (up to month ${u.meses_caged})`).join(', ')}. Within a year all municipalities have the same months, but the value is not comparable with full years.`)}</p>
        )}
      </section>

      <Estado carregando={c.carregando} erro={c.erro} tentarNovamente={c.recarregar} />
      {d && e.entes.length === 0 && (
        <p className="nota-base">{t('Escolha um ou mais municípios para ver a trajetória; a tabela de mudanças abaixo já mostra todos os municípios do escopo.', 'Choose one or more municipalities to see their trajectory; the table of changes below already shows every municipality in scope.')}</p>
      )}
      {d && resumos.length > 0 && (
        <div className="kpis">
          {resumos.map((r, i) => (
            <div key={r.cod} className="kpi evol-resumo" style={{ borderTopColor: `var(--cmp-${i + 1})` }}>
              <div className="rotulo">{nomeDe(r.cod)}</div>
              {r.ini && r.fim ? (
                <>
                  <div className="valor">{numero(pos(r.ini))}º → {numero(pos(r.fim))}º</div>
                  <div className="nota">
                    {r.ini.ano}: {numero(pos(r.ini))}º {t('de', 'of')} {numero(tot(r.ini))} · {r.fim.ano}: {numero(pos(r.fim))}º {t('de', 'of')} {numero(tot(r.fim))}
                    <br />{r.ini === r.fim ? t('posição em um só ano do período', 'ranked in only one year of the period') : `${textoVariacao(r.variacao)} (${sinal(r.variacao)})`}
                    {' · '}{t('posição relativa', 'relative position')} {numero1(posicaoRelativa(pos(r.ini), tot(r.ini)))} → {numero1(posicaoRelativa(pos(r.fim), tot(r.fim)))}
                  </div>
                </>
              ) : <div className="nota">{t('sem posição no período', 'unranked in the period')}</div>}
            </div>
          ))}
        </div>
      )}
      {d && e.entes.length > 0 && (
        <>
          <CartaoGrafico titulo={t('Posição por ano', 'Position by year')}
            desc={`${p.nomeIndicador} · ${escopoNome} · ${e.universo === 'constante' ? t('universo constante', 'constant universe') : t('universo anual', 'annual universe')} · ${e.escala === 'percentil' ? t('posição relativa (100 = 1º)', 'relative position (100 = 1st)') : t('1º lugar no alto; a linha tracejada é o último lugar de cada ano', '1st place at the top; the dashed line is the last place in each year')}${e.escala === 'posicao' && faixaPosicoes.lo > 1 ? t(` · eixo ampliado: começa no ${numero(faixaPosicoes.lo)}º`, ` · zoomed axis: starts at ${numero(faixaPosicoes.lo)}th`) : ''}`}
            tabela={tabelaTraj}
            acoes={trajetoria && <BotoesExportar nome={`${p.arquivo}_trajetoria_${e.de}_${e.ate}`} obter={() => ({ ...trajetoria, metadados: metadados(t('todas as observações dos municípios comparados, um ano por linha (inclusive os anos sem posição)', 'all observations of the compared municipalities, one year per row (including unranked years)')) })} />}>
            <Grafico opcao={opcaoPosicao} altura={340} nome={`${p.arquivo}_posicao_${e.de}_${e.ate}`}
              descricao={t('Gráfico da posição por ano; os valores estão na opção Tabela', 'Chart of position by year; values are in the Table option')} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Valor do indicador', 'Indicator value')} desc={`${p.nomeIndicador} · ${unidade}`} tabela={tabelaTraj}>
            <Grafico opcao={opcaoValor} altura={300} nome={`${p.arquivo}_valor_${e.de}_${e.ate}`}
              descricao={t('Gráfico do valor do indicador por ano; os valores estão na opção Tabela', 'Chart of the indicator value by year; values are in the Table option')} />
          </CartaoGrafico>
          {pontos.some((x) => !x.p || pos(x.p) == null) && (
            <p className="nota-base">{t('Anos sem posição', 'Unranked years')}: {pontos.filter((x) => !x.p || pos(x.p) == null)
              .map((x) => `${nomeDe(x.cod)} ${x.ano} (${textoMotivo(x.p?.motivo)})`).join('; ')}.</p>
          )}
        </>
      )}
      {d && (
        <section className="cartao">
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
        </section>
      )}
      {d && tabelaMud && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h3>{t(`Mudanças de posição de ${e.de} a ${e.ate}`, `Changes in position from ${e.de} to ${e.ate}`)}</h3>
              <p className="desc">{t(`Todos os ${escopoNome} com posição em ${e.de} ou em ${e.ate}. Variação da posição = posição em ${e.de} − posição em ${e.ate} (positiva = ganhou posições). ${p.monetario ? 'A variação do indicador é em valores reais.' : ''}`,
                `All ${escopoNome} ranked in ${e.de} or ${e.ate}. Change in position = position in ${e.de} − position in ${e.ate} (positive = gained positions). ${p.monetario ? 'The change in the indicator is in real terms.' : ''}`)}</p>
            </div>
            <BotoesExportar nome={`${p.arquivo}_mudancas_${e.de}_${e.ate}`} obter={() => ({ ...tabelaMud, metadados: metadados(t(`todos os municípios do escopo com posição em ${e.de} ou ${e.ate} (${tabelaMud.linhas.length} linhas; a tela mostra ${LINHAS_INICIAIS} de início)`, `every municipality in scope ranked in ${e.de} or ${e.ate} (${tabelaMud.linhas.length} rows; the screen first shows ${LINHAS_INICIAIS})`)) })} />
          </div>
          <div className="filtros">
            <div className="alternar" role="group" aria-label={t('Mostrar', 'Show')}>
              {(['todos', 'subiram', 'desceram'] as const).map((k) => (
                <button key={k} aria-pressed={filtroMud === k} className={filtroMud === k ? 'ativo' : ''} onClick={() => setFiltroMud(k)}>
                  {k === 'todos' ? t('Todos', 'All') : k === 'subiram' ? t('Ganharam posições', 'Gained positions') : t('Perderam posições', 'Lost positions')}
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
                  <th>{t(`Valor ${e.de}`, `Value ${e.de}`)}</th><th>{t(`Valor ${e.ate}`, `Value ${e.ate}`)}</th>
                  <th>{t('Variação do indicador', 'Change in indicator')}</th>
                  <th>{t(`Posição ${e.de}`, `Position ${e.de}`)}</th><th>{t(`Posição ${e.ate}`, `Position ${e.ate}`)}</th>
                  <th>{t('Variação da posição', 'Change in position')}</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map((m) => {
                  const v = variacaoPosicao(m.pos_ini, m.pos_fim);
                  const ri = valorExibido(m.valor_ini, m.fator_ini);
                  const rf = valorExibido(m.valor_fim, m.fator_fim);
                  const varInd = p.monetario
                    ? (m.valor_ini != null && m.valor_fim != null && m.fator_ini != null && m.fator_fim != null ? m.valor_fim * m.fator_fim - m.valor_ini * m.fator_ini : null)
                    : (m.valor_ini != null && m.valor_fim != null ? m.valor_fim - m.valor_ini : null);
                  return (
                    <tr key={m.cod_ibge} className={e.entes.includes(m.cod_ibge) ? 'destaque' : undefined}>
                      <td>{m.nome}{ufEscopo ? '' : ` (${m.uf})`}</td><td>{m.cod_ibge}</td>
                      <td>{ri == null ? '–' : p.formato(ri)}</td><td>{rf == null ? '–' : p.formato(rf)}</td>
                      <td>{varInd == null ? '–' : `${varInd > 0 ? '+' : ''}${p.formato(varInd)}`}</td>
                      <td>{m.pos_ini == null ? '–' : `${numero(m.pos_ini)}º ${t('de', 'of')} ${numero(m.total_ini)}`}</td>
                      <td>{m.pos_fim == null ? '–' : `${numero(m.pos_fim)}º ${t('de', 'of')} ${numero(m.total_fim)}`}</td>
                      <td>{sinal(v)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="legenda-tabela">
            {!todas && !termo && mudancas.length > LINHAS_INICIAIS ? t(`Mostrando ${LINHAS_INICIAIS} de ${numero(mudancas.length)}. `, `Showing ${LINHAS_INICIAIS} of ${numero(mudancas.length)}. `) : ''}
            {mudancas.length > LINHAS_INICIAIS && !termo && <button className="limpar" onClick={() => setTodas(!todas)}>{todas ? t('mostrar menos', 'show fewer') : t('mostrar todos', 'show all')}</button>}
            {' '}{t('“–” = sem posição naquele ano (ver o motivo na trajetória do município). Valores no formato da tela; a exportação traz os valores completos.', '“–” = unranked in that year (see the reason in the municipality’s trajectory). Values as displayed; the export has the full values.')}
          </p>
        </section>
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
