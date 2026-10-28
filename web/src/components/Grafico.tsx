import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { nomeArquivo } from '../exportar';
import { t } from '../idioma';

// SVG: gráficos do relatório em PDF da IA, desenhados sem tela (graficoSvg)
echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, CanvasRenderer, SVGRenderer]);

/** Lê os tokens de cor atuais (mudam com o tema). */
export function tokens() {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    superficie: v('--superficie'), tinta: v('--tinta'), tinta2: v('--tinta-2'), tinta3: v('--tinta-3'),
    grade: v('--grade'), eixo: v('--eixo'), series: [v('--serie-1'), v('--serie-2'), v('--serie-3')],
  };
}
export type Tokens = ReturnType<typeof tokens>;

/** Incrementa quando o tema (SO ou alternador) muda, para redesenhar os gráficos. */
function useVersaoTema() {
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const bump = () => setVersao((v) => v + 1);
    mq.addEventListener('change', bump);
    const obs = new MutationObserver(bump);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', bump);
      obs.disconnect();
    };
  }, []);
  return versao;
}

export function Grafico({ opcao, altura = 300, nome, descricao }: {
  opcao: (t: Tokens) => EChartsCoreOption; altura?: number; nome?: string; descricao?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const grafico = useRef<echarts.ECharts | null>(null);
  const versao = useVersaoTema();
  const baixarPng = () => {
    const g = grafico.current;
    if (!g) return;
    const a = document.createElement('a');
    a.href = g.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: tokens().superficie });
    a.download = `${nomeArquivo(nome ?? 'grafico')}.png`;
    a.click();
  };

  useEffect(() => {
    grafico.current = echarts.init(ref.current!, undefined, { renderer: 'canvas' });
    const ro = new ResizeObserver(() => grafico.current?.resize());
    ro.observe(ref.current!);
    return () => {
      ro.disconnect();
      grafico.current?.dispose();
    };
  }, []);

  useEffect(() => {
    grafico.current?.setOption(opcao(tokens()), { notMerge: true });
  }, [opcao, versao]);

  return (
    <figure className="grafico">
      <div ref={ref} style={{ height: altura, width: '100%' }} role="img"
        aria-label={descricao ?? t('Gráfico; os valores estão na opção Tabela', 'Chart; values are available in the Table option')} />
      <button className="botao-leve png" onClick={baixarPng}>{t('Imagem (PNG)', 'Image (PNG)')}</button>
    </figure>
  );
}

/** Cartão com título, alternância Gráfico/Tabela e o conteúdo. */
export function CartaoGrafico({ titulo, desc, tabela, children, acoes }: {
  titulo: string; desc?: string; tabela?: ReactNode; children: ReactNode; acoes?: ReactNode;
}) {
  const [modo, setModo] = useState<'grafico' | 'tabela'>('grafico');
  return (
    <section className="cartao">
      <div className="cabeca-cartao">
        <div>
          <h3>{titulo}</h3>
          {desc && <p className="desc">{desc}</p>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {acoes}
          {tabela && (
            <div className="alternar" role="group" aria-label={t('Modo de exibição', 'Display mode')}>
              <button className={modo === 'grafico' ? 'ativo' : ''} onClick={() => setModo('grafico')}>{t('Gráfico', 'Chart')}</button>
              <button className={modo === 'tabela' ? 'ativo' : ''} onClick={() => setModo('tabela')}>{t('Tabela', 'Table')}</button>
            </div>
          )}
        </div>
      </div>
      {modo === 'grafico' || !tabela ? children : <div className="rolagem">{tabela}</div>}
    </section>
  );
}

// ---------- construtores de opção (specs da skill de dataviz) ----------

type Serie = { nome: string; valores: (number | null)[] };

const eixoValor = (t: Tokens, formato: (v: number) => string) => ({
  type: 'value',
  axisLabel: { color: t.tinta3, formatter: formato },
  splitLine: { lineStyle: { color: t.grade, width: 1 } },
  axisLine: { show: false },
  axisTick: { show: false },
});
const eixoCategoria = (t: Tokens, dados: (string | number)[]) => ({
  type: 'category',
  data: dados,
  axisLabel: { color: t.tinta3 },
  axisLine: { lineStyle: { color: t.eixo } },
  axisTick: { show: false },
});
const tooltipBase = (t: Tokens) => ({
  backgroundColor: t.superficie,
  borderColor: t.grade,
  textStyle: { color: t.tinta, fontSize: 12 },
});

/** Cores do tema claro, para gráficos desenhados fora da página (relatório em PDF). */
const TOKENS_IMPRESSAO: Tokens = {
  superficie: '#ffffff', tinta: '#0f1e2c', tinta2: '#44505f', tinta3: '#626e82', grade: '#e5e1d5', eixo: '#cbc6b6',
  series: ['#1f5f96', '#7d9c12', '#2492b8'],
};

/** O gráfico como SVG (texto), nas cores do tema claro, sem animação: vai dentro do relatório em PDF. */
export function graficoSvg(opcao: (t: Tokens) => EChartsCoreOption, largura = 640, altura = 260): string {
  const g = echarts.init(null, undefined, { renderer: 'svg', ssr: true, width: largura, height: altura });
  g.setOption({ ...opcao(TOKENS_IMPRESSAO), animation: false });
  const svg = g.renderToSVGString();
  g.dispose();
  return svg;
}

/** Linha vertical tracejada numa categoria do eixo x (ex.: ano de uma quebra de série), com rótulo no topo. */
export type Marca = { x: string; rotulo: string };

/** Linhas sobre os anos: 2px, marcadores de 8px com anel na cor da superfície, mira e tooltip. */
export function linhas(anos: (number | string)[], series: Serie[], formato: (v: number) => string, marcas: Marca[] = []) {
  return (t: Tokens): EChartsCoreOption => ({
    grid: { left: 8, right: 16, top: series.length > 1 ? 36 : marcas.length ? 26 : 16, bottom: 8, containLabel: true },
    legend: series.length > 1
      ? { top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 3, textStyle: { color: t.tinta2 } }
      : undefined,
    tooltip: {
      ...tooltipBase(t),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: t.eixo } },
      valueFormatter: (v: number) => (v === null || v === undefined ? '–' : formato(v)),
    },
    xAxis: { ...eixoCategoria(t, anos), boundaryGap: false },
    yAxis: eixoValor(t, formato),
    series: series.map((s, i) => ({
      name: s.nome,
      type: 'line',
      data: s.valores,
      connectNulls: false,
      lineStyle: { width: 2, color: t.series[i] },
      itemStyle: { color: t.series[i], borderColor: t.superficie, borderWidth: 2 },
      symbol: 'circle',
      symbolSize: 8,
      emphasis: { scale: 1.4 },
      ...(i === 0 && marcas.length ? {
        markLine: {
          silent: true,
          symbol: 'none',
          lineStyle: { type: 'dashed', color: t.tinta3, width: 1 },
          label: { position: 'end', color: t.tinta2, fontSize: 10 },
          data: marcas.map((m) => ({ xAxis: m.x, label: { show: !!m.rotulo, formatter: m.rotulo } })),
        },
      } : {}),
    })),
  });
}

/** Barras (horizontais por padrão): espessura até 24px, ponta arredondada de 4px, rótulo na ponta. */
export function barras(categorias: string[], valores: (number | null)[], formato: (v: number) => string, horizontal = true) {
  return (t: Tokens): EChartsCoreOption => ({
    grid: { left: 8, right: horizontal ? 72 : 16, top: horizontal ? 8 : 24, bottom: 8, containLabel: true },
    tooltip: { ...tooltipBase(t), trigger: 'item', valueFormatter: (v: number) => formato(v) },
    xAxis: horizontal
      ? { ...eixoValor(t, formato), axisLabel: { show: false } }
      : { ...eixoCategoria(t, categorias), axisLabel: { color: t.tinta3, interval: 0, rotate: 35, fontSize: 11 } },
    yAxis: horizontal ? { ...eixoCategoria(t, categorias), inverse: true, axisLine: { show: false } } : eixoValor(t, formato),
    series: [{
      type: 'bar',
      data: valores,
      barMaxWidth: 24,
      itemStyle: { color: t.series[0], borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] },
      label: {
        show: true,
        position: horizontal ? 'right' : 'top',
        color: t.tinta2,
        fontSize: 11,
        formatter: (p: { value: number }) => formato(p.value),
      },
    }],
  });
}
