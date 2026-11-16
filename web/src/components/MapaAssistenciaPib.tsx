import { useEffect, useId, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { buscarNoMapa, centroDaMalha, CORES_PIB, COR_SEM_PERCENTUAL, corPercentualPib, linhasDoMapa, obterMalhaMunicipal, tamanhoMapa, type MalhaMunicipal } from '../assistencia_mapa';
import { useSocial } from '../assistencia_dados';
import type { RankingPib } from '../assistencia_economia';
import { Estado } from './Kpi';
import { local, t } from '../idioma';
import { numero, reaisExato } from '../format';

echarts.use([MapChart, TooltipComponent, CanvasRenderer]);
const percentual = (v: number) => v > 0 && v < .001 ? t('<0,001%', '<0.001%') : `${v.toLocaleString(local(), { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`;
const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Props = { ranking: RankingPib; busca: string; selecionado: string | null; selecionar: (cod: string) => void; titulo: string };
export default function MapaAssistenciaPib(props: Props) {
  const consulta = useSocial(`malha:${props.ranking.uf}`, () => obterMalhaMunicipal(props.ranking.uf));
  return <>
    {consulta.carregando && <Estado carregando />}
    {consulta.erro && <Estado erro={consulta.erro} tentarNovamente={consulta.recarregar} />}
    {consulta.dados && <Mapa key={props.ranking.uf} {...props} malha={consulta.dados.malha} anoMalha={consulta.dados.ano} fonte={consulta.dados.fonte} />}
  </>;
}
function Mapa({ ranking, busca, selecionado, selecionar, titulo, malha, anoMalha, fonte }: Props & { malha: MalhaMunicipal; anoMalha: number; fonte: string }) {
  const ref = useRef<HTMLDivElement>(null); const chart = useRef<echarts.EChartsType | null>(null); const id = useId();
  const aoSelecionar = useRef(selecionar); aoSelecionar.current = selecionar;
  const linhas = useMemo(() => linhasDoMapa(malha, ranking.linhas), [malha, ranking]);
  const matches = useMemo(() => buscarNoMapa(malha, busca), [malha, busca]);
  const centro = useMemo(() => centroDaMalha(malha), [malha]);
  const ativo = linhas.find(l => l.name === selecionado);
  // A mesma malha é reutilizada ao trocar programa/ano; nenhum valor é interpolado.
  useEffect(() => {
    const mapa = `assistencia-pib-${ranking.uf}`;
    echarts.registerMap(mapa, malha as unknown as Parameters<typeof echarts.registerMap>[1]);
    const c = echarts.init(ref.current!, undefined, { renderer: 'canvas' }); chart.current = c;
    c.setOption({ animation: false, series: [{ type: 'map', map: mapa, center: centro, roam: true, scaleLimit: { min: 1, max: 24 }, layoutCenter: ['50%', '50%'], layoutSize: '95%', label: { show: false }, emphasis: { label: { show: false }, itemStyle: { borderColor: '#e77722', borderWidth: 2, areaColor: undefined } }, selectedMode: false }] });
    c.on('click', p => { if (typeof p.name === 'string' && /^\d{7}$/.test(p.name)) aoSelecionar.current(p.name); });
    const ro = new ResizeObserver(() => {
      const el = ref.current; const dimensoes = el && tamanhoMapa(el.clientWidth, el.clientHeight);
      // O ECharts 6 tenta inverter uma matriz singular quando recebe tamanho zero.
      if (dimensoes && !c.isDisposed()) c.resize(dimensoes);
    }); ro.observe(ref.current!);
    return () => { ro.disconnect(); c.dispose(); chart.current = null; };
  }, [malha, ranking.uf, centro]);
  useEffect(() => {
    const desenhar = () => {
      const styles = getComputedStyle(document.documentElement);
      const porCodigo = new Map(linhas.map(l => [l.name, l]));
      chart.current?.setOption({
        tooltip: { trigger: 'item', confine: true, backgroundColor: styles.getPropertyValue('--superficie').trim(), textStyle: { color: styles.getPropertyValue('--tinta').trim() }, formatter: (p: { name?: string }) => {
          const l = porCodigo.get(p.name ?? ''); if (!l) return '';
          return `<strong>${html(l.nome)} (${l.uf})</strong><br>${l.percentual === null ? t('Sem percentual válido', 'No valid percentage') : percentual(l.percentual)}<br>${t('Clique para ver os valores abaixo do mapa.', 'Click to see the figures below the map.')}`;
        } },
        series: [{ data: linhas.map(l => ({ name: l.name, value: l.percentual ?? '-', itemStyle: { areaColor: corPercentualPib(l.percentual), borderColor: l.name === selecionado ? '#e77722' : styles.getPropertyValue('--superficie').trim(), borderWidth: l.name === selecionado ? 2.5 : .35 } })) }],
      });
    };
    desenhar(); const obs = new MutationObserver(desenhar); obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema', 'data-theme', 'class', 'style'] });
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', desenhar);
    return () => { obs.disconnect(); mq.removeEventListener('change', desenhar); };
  }, [linhas, selecionado]);
  const zoom = (fator: number) => {
    const c = chart.current; if (!c) return;
    const serie = (c.getOption().series as { zoom?: number }[])[0];
    c.setOption({ series: [{ zoom: Math.min(24, Math.max(1, (serie.zoom ?? 1) * fator)) }] });
  };
  const localizar = (cod: string) => {
    selecionar(cod);
    const f = malha.features.find(f => f.properties.name === cod); if (!f) return;
    const pontos = f.geometry.coordinates.flat(f.geometry.type === 'Polygon' ? 1 : 2) as number[][];
    const xs = pontos.map(p => p[0]), ys = pontos.map(p => p[1]);
    chart.current?.setOption({ series: [{ center: [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2], zoom: ranking.uf === 'BR' ? 8 : 3 }] });
  };
  const faixas = [t('Zero registrado', 'Reported zero'), t('Mais de 0 a menos de 2%', 'Over 0 to under 2%'), t('2 a menos de 5%', '2 to under 5%'), t('5 a menos de 10%', '5 to under 10%'), t('10 a menos de 20%', '10 to under 20%'), t('20% ou mais', '20% or more'), t('Sem percentual válido', 'No valid percentage')];
  const semMalha = useMemo(() => { const codigos = new Set(malha.features.map(f => f.properties.name)); return ranking.linhas.filter(l => !codigos.has(String(l[0]))); }, [malha, ranking]);
  return <section className="as-mapa-pib" aria-label={t('Mapa municipal de pagamentos / PIB', 'Municipal payments / GDP map')}>
    <h3>{titulo} / {t('PIB', 'GDP')} · {ranking.ano}</h3>
    <p className="as-resumo" id={`${id}-instrucoes`}>{t('Toque ou clique em um município para ver os números abaixo do mapa. Arraste para mover e use + e − para ampliar. A busca localiza inclusive municípios sem percentual; as cores dos demais permanecem.', 'Tap or click a municipality to see the figures below the map. Drag to pan and use + and − to zoom. Search also finds municipalities without a percentage; other municipalities retain their colours.')}</p>
    {busca.trim() && <div className="as-mapa-pib-encontrados" aria-label={t('Resultados da busca no mapa', 'Map search results')}><p role="status">{t(`${numero(matches.length)} ${matches.length === 1 ? 'território encontrado' : 'territórios encontrados'} no mapa${matches.length > 8 ? '; refine a busca para localizar mais' : ''}.`, `${numero(matches.length)} ${matches.length === 1 ? 'territory' : 'territories'} found on the map${matches.length > 8 ? '; refine the search to find more' : ''}.`)}</p>{matches.slice(0, 8).map(p => <button key={p.name} className="botao-leve" onClick={() => localizar(p.name)}>{t('Ver', 'View')} {p.nome} ({p.uf})</button>)}</div>}
    <div className="as-mapa-pib-controles" role="group" aria-label={t('Controles do mapa', 'Map controls')}>
      <button className="botao-leve" onClick={() => zoom(1.6)} aria-label={t('Ampliar mapa', 'Zoom in')}>+</button><button className="botao-leve" onClick={() => zoom(1 / 1.6)} aria-label={t('Reduzir mapa', 'Zoom out')}>−</button><button className="botao-leve" onClick={() => chart.current?.setOption({ series: [{ center: centro, zoom: 1 }] })}>{t('Reenquadrar', 'Reset view')}</button>
    </div>
    <div className="as-mapa-pib-canvas" ref={ref} role="img" aria-label={`${titulo} / ${t('PIB', 'GDP')} · ${ranking.ano} · ${ranking.uf}`} aria-describedby={`${id}-instrucoes`} />
    <ul className="as-mapa-pib-legenda" aria-label={t('Legenda em percentual do PIB', 'Legend as a percentage of GDP')}>{faixas.map((f, i) => <li key={i}><span style={{ background: i < 6 ? CORES_PIB[i] : COR_SEM_PERCENTUAL }} aria-hidden="true" />{f}</li>)}</ul>
    <p className="as-resumo">{t('Escala fixa em todos os programas, anos e estados. Um percentual maior indica maior relação entre pagamentos e PIB, sem atribuir uma nota ao município.', 'Fixed scale across programmes, years and states. A higher percentage means a higher payments-to-GDP ratio, without assigning a quality score to the municipality.')}</p>
    <div className="as-mapa-pib-detalhe" aria-live="polite" aria-atomic="true">{ativo ? <>
      <h4>{ativo.nome} ({ativo.uf})</h4><p className="as-ranking-pib-codigo">{t('Código IBGE', 'IBGE code')}: {ativo.name}</p>
      {ativo.linha ? <dl><div><dt>{t('Pagamentos / PIB', 'Payments / GDP')}</dt><dd><strong>{percentual(ativo.linha[4])}</strong>{ativo.linha[4] === 0 && ` · ${t('zero registrado', 'reported zero')}`}</dd></div><div><dt>{t('Pagamentos no ano', 'Yearly payments')}</dt><dd>{reaisExato(ativo.linha[5])}</dd></div><div><dt>{t('PIB do mesmo ano', 'GDP for the same year')}</dt><dd>{reaisExato(ativo.linha[6])}</dd></div><div><dt>{t('Posição no recorte', 'Rank within the scope')}</dt><dd>{numero(ativo.linha[3])}</dd></div></dl> : <p>{t('Sem percentual válido neste programa e ano. Pagamentos ausentes ou incompletos, ou PIB ausente ou inválido, impedem o cálculo. Isso não significa pagamento zero.', 'No valid percentage for this programme and year. Missing or incomplete payments, or missing or invalid GDP, prevent calculation. This does not mean zero payments.')}</p>}
      <Link to={`/assistencia?uf=${ativo.uf}&cod=${ativo.name}&ano_pib=${ranking.ano}#pagamentos-pib`}>{t('Abrir comparação anual deste município', 'Open this municipality’s annual comparison')}</Link>
    </> : <p>{t('Escolha um município no mapa ou nos resultados da busca para ver pagamentos, PIB e posição no ranking. A visualização “Ranking” oferece a lista completa e acessível.', 'Choose a municipality on the map or in the search results to see payments, GDP and rank. The “Ranking” view provides the complete accessible list.')}</p>}</div>
    {semMalha.length > 0 && <p role="status">{t(`${semMalha.length} registros com percentual válido não têm geometria nesta malha; consulte o ranking.`, `${semMalha.length} records with a valid percentage lack geometry in this mesh; see the ranking.`)}</p>}
    <p className="as-resumo"><a href={fonte} target="_blank" rel="noreferrer">{t(`Malha municipal IBGE ${anoMalha}`, `IBGE ${anoMalha} municipal mesh`)}</a>. {t('Limites atuais simplificados para visualização, sem reconstruir fronteiras históricas. Inclui Brasília/DF e Fernando de Noronha; exclui áreas operacionais de lagoas, que não são municípios. Cores em cinza indicam ausência de percentual válido.', 'Current boundaries simplified for display, without reconstructing historical boundaries. Includes Brasília/DF and Fernando de Noronha; excludes operational lagoon areas, which are not municipalities. Grey means no valid percentage.')}</p>
  </section>;
}
