import { useEffect, useMemo, useRef } from 'react';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { centroDaMalha, tamanhoMapa, type MalhaMunicipal } from '../geografia_municipal';
import { CORES_MAPA, COR_AUSENTE_MAPA, condicaoMapa, corMapa, formatarMapa, legendaMapa, valorEfetivoMapa } from '../mapas_apresentacao';
import type { IndicadorMapa, LinhaMapaDados } from '../mapas_dados';
import { idioma, t } from '../idioma';
echarts.use([MapChart, TooltipComponent, CanvasRenderer]);
const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Props = { malha: MalhaMunicipal; uf: string; indicador: IndicadorMapa; linhas: LinhaMapaDados[]; ano: number; selecionado: string | null; selecionar: (cod: string) => void; foco: { cod: string; n: number } | null; ressalvas: boolean };
export default function MapaMunicipal({ malha, uf, indicador: i, linhas, ano, selecionado, selecionar, foco, ressalvas }: Props) {
  const ref = useRef<HTMLDivElement>(null); const chart = useRef<echarts.EChartsType | null>(null);
  const escolher = useRef(selecionar); escolher.current = selecionar;
  const centro = useMemo(() => centroDaMalha(malha), [malha]);
  useEffect(() => {
    const nome = `municipios-${uf}`; echarts.registerMap(nome, malha as unknown as Parameters<typeof echarts.registerMap>[1]);
    const c = echarts.init(ref.current!, undefined, { renderer: 'canvas' }); chart.current = c;
    c.setOption({ animation: false, series: [{ type: 'map', map: nome, center: centro, roam: true, scaleLimit: { min: 1, max: 24 }, layoutCenter: ['50%', '50%'], layoutSize: '95%', selectedMode: false, label: { show: false }, emphasis: { label: { show: false }, itemStyle: { borderColor: '#e77722', borderWidth: 2 } } }] });
    c.on('click', p => { if (typeof p.name === 'string' && /^\d{7}$/.test(p.name)) escolher.current(p.name); });
    const o = new ResizeObserver(() => { const el = ref.current; const tamanho = el && tamanhoMapa(el.clientWidth, el.clientHeight); if (tamanho && !c.isDisposed()) c.resize(tamanho); });
    o.observe(ref.current!); return () => { o.disconnect(); c.dispose(); chart.current = null; };
  }, [malha, uf, centro]);
  useEffect(() => {
    const pintar = () => {
      const css = getComputedStyle(document.documentElement); const dados = new Map(linhas.map(l => [String(l.cod), l]));
      chart.current?.setOption({ tooltip: { trigger: 'item', confine: true, extraCssText: 'max-width:min(280px, calc(100vw - 64px));white-space:normal;overflow-wrap:anywhere;', backgroundColor: css.getPropertyValue('--superficie').trim(), textStyle: { color: css.getPropertyValue('--tinta').trim() }, formatter: (p: { name?: string }) => {
        const l = dados.get(p.name ?? ''); if (!l) return '';
        const unidade = idioma() === 'en' ? i.unidade_en : i.unidade;
        return `<strong>${html(l.nome)} (${l.uf})</strong><br>${formatarMapa(i, l.valor)}${unidade === '%' ? '' : ` ${html(unidade)}`}<br>${html(condicaoMapa(l))}<br>${t('Toque ou clique para ver o detalhe.', 'Tap or click to see details.')}`;
      } }, series: [{ data: malha.features.map(f => {
        const l = dados.get(f.properties.name); const v = l ? valorEfetivoMapa(l, ressalvas) : null;
        return { name: f.properties.name, value: v ?? '-', itemStyle: { areaColor: corMapa(v, i.escala), borderWidth: f.properties.name === selecionado ? 2.5 : l?.condicao === 8 && ressalvas ? 1.5 : .35, borderColor: f.properties.name === selecionado || l?.condicao === 8 && ressalvas ? '#e77722' : css.getPropertyValue('--superficie').trim() } };
      }) }] });
    };
    pintar(); const o = new MutationObserver(pintar); o.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class', 'style'] });
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', pintar);
    return () => { o.disconnect(); mq.removeEventListener('change', pintar); };
  }, [malha, linhas, i, selecionado, ressalvas]);
  useEffect(() => {
    if (!foco) return;
    const f = malha.features.find(f => f.properties.name === foco.cod); if (!f) return;
    const ponto = centroDaMalha({ type: 'FeatureCollection', features: [f] });
    chart.current?.setOption({ series: [{ center: ponto, zoom: uf === 'BR' ? 8 : 3 }] });
  }, [foco, malha, uf]);
  const zoom = (fator: number) => { const c = chart.current; if (!c) return; const serie = (c.getOption().series as { zoom?: number }[])[0]; c.setOption({ series: [{ zoom: Math.max(1, Math.min(24, (serie.zoom ?? 1) * fator)) }] }); };
  return <>
    <div className="mp-controles" role="group" aria-label={t('Controles do mapa', 'Map controls')}><button className="botao-leve" aria-label={t('Ampliar mapa', 'Zoom in')} onClick={() => zoom(1.6)}>+</button><button className="botao-leve" aria-label={t('Reduzir mapa', 'Zoom out')} onClick={() => zoom(1 / 1.6)}>−</button><button className="botao-leve" onClick={() => chart.current?.setOption({ series: [{ center: centro, zoom: 1 }] })}>{t('Reenquadrar', 'Reset view')}</button></div>
    <div ref={ref} className="mp-canvas" role="img" aria-label={`${idioma() === 'en' ? i.nome_en : i.nome} · ${ano} · ${uf}`} />
    <ul className="mp-legenda" aria-label={t('Legenda do mapa', 'Map legend')}>{legendaMapa(i).map((l, k) => <li key={k}><span aria-hidden="true" style={{ background: k < 6 ? CORES_MAPA[k] : COR_AUSENTE_MAPA }} />{l}</li>)}{ressalvas && linhas.some(l => l.condicao === 8) && <li><span aria-hidden="true" style={{ border: '2px solid #e77722' }} />{t('Ressalva do Inep', 'Inep flag')}</li>}</ul>
    <p className="mp-nota">{t('Faixas numéricas fixas para este indicador em todos os anos e estados. Zero registrado e ausência de valor têm cores diferentes.', 'Fixed numeric ranges for this indicator across years and states. Reported zero and missing values have different colours.')}</p>
  </>;
}
