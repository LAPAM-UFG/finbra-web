import { useEffect, useId, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import * as echarts from 'echarts/core';
import { MapChart } from 'echarts/charts';
import { TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { buscarNoMapa, centroDaMalha, CORES_PIB, COR_SEM_PERCENTUAL, corReferencia, limitesReferencia, linhasDoMapa, obterMalhaMunicipal, tamanhoMapa, type MalhaMunicipal } from '../assistencia_mapa';
import { useSocial } from '../assistencia_dados';
import { formatarReferencia, nomeBase, nomeDenominador, type RankingReferencia } from '../assistencia_referencias';
import { Estado } from './Kpi';
import { t } from '../idioma';
import { numero, reaisExato } from '../format';

echarts.use([MapChart, TooltipComponent, CanvasRenderer]);
const html = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const prepararMapa = obterMalhaMunicipal;

type Props = { ranking: RankingReferencia; busca: string; selecionado: string | null; selecionar: (cod: string) => void; titulo: string };
export default function MapaAssistenciaPib(props: Props) {
  const consulta = useSocial(`malha:${props.ranking.uf}`, () => obterMalhaMunicipal(props.ranking.uf));
  return <>
    {consulta.carregando && <Estado carregando />}
    {consulta.erro && <Estado erro={consulta.erro} tentarNovamente={consulta.recarregar} />}
    {consulta.dados && <Mapa key={props.ranking.uf} {...props} malha={consulta.dados.malha} anoMalha={consulta.dados.ano} fonte={consulta.dados.fonte} />}
  </>;
}
function Mapa({ ranking, busca, selecionado, selecionar, titulo, malha, anoMalha, fonte }: Props & { malha: MalhaMunicipal; anoMalha: number; fonte: string }) {
  const base=ranking.base;
  const percentual=(v:number)=>formatarReferencia(v,base);
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
          return `<strong>${html(l.nome)} (${l.uf})</strong><br>${l.percentual === null ? t('Sem valor válido', 'No valid value') : percentual(l.percentual)}<br>${t('Clique para ver os valores abaixo do mapa.', 'Click to see the figures below the map.')}`;
        } },
        series: [{ data: linhas.map(l => ({ name: l.name, value: l.percentual ?? '-', itemStyle: { areaColor: corReferencia(l.percentual,base), borderColor: l.name === selecionado ? '#e77722' : styles.getPropertyValue('--superficie').trim(), borderWidth: l.name === selecionado ? 2.5 : .35 } })) }],
      });
    };
    desenhar(); const obs = new MutationObserver(desenhar); obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema', 'data-theme', 'class', 'style'] });
    const mq = matchMedia('(prefers-color-scheme: dark)'); mq.addEventListener('change', desenhar);
    return () => { obs.disconnect(); mq.removeEventListener('change', desenhar); };
  }, [linhas, selecionado, base]);
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
  const limites=limitesReferencia(base);
  const faixas=[t('Zero registrado','Reported zero'),t(`Mais de 0 a menos de ${percentual(limites[0])}`,`Over 0 to under ${percentual(limites[0])}`),...limites.slice(0,-1).map((n,k)=>t(`${percentual(n)} a menos de ${percentual(limites[k+1])}`,`${percentual(n)} to under ${percentual(limites[k+1])}`)),t(`${percentual(limites[3])} ou mais`,`${percentual(limites[3])} or more`),t('Sem valor válido','No valid value')];
  const semMalha = useMemo(() => { const codigos = new Set(malha.features.map(f => f.properties.name)); return ranking.linhas.filter(l => !codigos.has(String(l[0]))); }, [malha, ranking]);
  return <section className="as-mapa-pib" aria-label={t('Mapa municipal dos pagamentos', 'Municipal payment map')}>
    <h3>{titulo} · {nomeBase(base)} · {ranking.ano}</h3>
    <p className="as-resumo" id={`${id}-instrucoes`}>{t('Toque ou clique em um município para ver os números abaixo do mapa. Arraste para mover e use + e − para ampliar. A busca localiza inclusive municípios sem valor; as cores dos demais permanecem.', 'Tap or click a municipality to see the figures below the map. Drag to pan and use + and − to zoom. Search also finds municipalities without a value; other municipalities retain their colours.')}</p>
    {busca.trim() && <div className="as-mapa-pib-encontrados" aria-label={t('Resultados da busca no mapa', 'Map search results')}><p role="status">{t(`${numero(matches.length)} ${matches.length === 1 ? 'território encontrado' : 'territórios encontrados'} no mapa${matches.length > 8 ? '; refine a busca para localizar mais' : ''}.`, `${numero(matches.length)} ${matches.length === 1 ? 'territory' : 'territories'} found on the map${matches.length > 8 ? '; refine the search to find more' : ''}.`)}</p>{matches.slice(0, 8).map(p => <button key={p.name} className="botao-leve" onClick={() => localizar(p.name)}>{t('Ver', 'View')} {p.nome} ({p.uf})</button>)}</div>}
    <div className="as-mapa-pib-controles" role="group" aria-label={t('Controles do mapa', 'Map controls')}>
      <button className="botao-leve" onClick={() => zoom(1.6)} aria-label={t('Ampliar mapa', 'Zoom in')}>+</button><button className="botao-leve" onClick={() => zoom(1 / 1.6)} aria-label={t('Reduzir mapa', 'Zoom out')}>−</button><button className="botao-leve" onClick={() => chart.current?.setOption({ series: [{ center: centro, zoom: 1 }] })}>{t('Reenquadrar', 'Reset view')}</button>
    </div>
    <div className="as-mapa-pib-canvas" ref={ref} role="img" aria-label={`${titulo} · ${nomeBase(base)} · ${ranking.ano} · ${ranking.uf}`} aria-describedby={`${id}-instrucoes`} />
    <ul className="as-mapa-pib-legenda" aria-label={t('Legenda da comparação','Comparison legend')}>{faixas.map((f, i) => <li key={i}><span style={{ background: i < 6 ? CORES_PIB[i] : COR_SEM_PERCENTUAL }} aria-hidden="true" />{f}</li>)}</ul>
    <p className="as-resumo">{t('Escala fixa por referência em todos os programas, anos e estados. Valores maiores não são notas de qualidade. Por habitante: reais nominais; RAIS: percentual sobre massa anual estimada.', 'Fixed scale per reference across programmes, years and states. Higher values are not quality scores. Per resident: nominal reais; RAIS: percentage of estimated yearly payroll.')}</p>
    <div className="as-mapa-pib-detalhe" aria-live="polite" aria-atomic="true">{ativo ? <>
      <h4>{ativo.nome} ({ativo.uf})</h4><p className="as-ranking-pib-codigo">{t('Código IBGE', 'IBGE code')}: {ativo.name}</p>
      {ativo.linha ? <dl><div><dt>{nomeBase(base)}</dt><dd><strong>{percentual(ativo.linha[4])}</strong>{ativo.linha[4] === 0 && ` · ${t('zero registrado', 'reported zero')}`}</dd></div><div><dt>{t('Pagamentos no ano', 'Yearly payments')}</dt><dd>{reaisExato(ativo.linha[5])}</dd></div><div><dt>{nomeDenominador(base)}</dt><dd>{base==='populacao'?numero(ativo.linha[6]):reaisExato(ativo.linha[6])}</dd></div><div><dt>{t('Posição no recorte', 'Rank within the scope')}</dt><dd>{numero(ativo.linha[3])}</dd></div></dl> : <p>{t('Sem valor válido neste programa e ano: pagamentos ausentes ou incompletos, ou denominador ausente ou inválido. Ausência não significa pagamento zero.', 'No valid value for this programme and year: missing or incomplete payments, or missing or invalid denominator. Missing is not zero payments.')}</p>}
      <Link to={`/assistencia?uf=${ativo.uf}&cod=${ativo.name}&ano_comparacao=${ranking.ano}&base_comparacao=${base}#pagamentos-pib`}>{t('Abrir comparação anual deste município', 'Open this municipality’s annual comparison')}</Link>
    </> : <p>{t('Escolha um município no mapa ou na busca para ver os valores e a posição. A visualização Ranking oferece a lista completa e acessível.', 'Choose a municipality on the map or in search to see values and rank. Ranking view provides the complete accessible list.')}</p>}</div>
    {semMalha.length > 0 && <p role="status">{t(`${semMalha.length} registros válidos não têm geometria nesta malha; consulte o ranking.`, `${semMalha.length} valid records lack geometry in this mesh; see the ranking.`)}</p>}
    <p className="as-resumo"><a href={fonte} target="_blank" rel="noreferrer">{t(`Malha municipal IBGE ${anoMalha}`, `IBGE ${anoMalha} municipal mesh`)}</a>. {t('Limites atuais simplificados para visualização, sem reconstruir fronteiras históricas. Inclui Brasília/DF e Fernando de Noronha; exclui áreas operacionais de lagoas, que não são municípios. Cores em cinza indicam ausência de valor válido.', 'Current boundaries simplified for display, without reconstructing historical boundaries. Includes Brasília/DF and Fernando de Noronha; excludes operational lagoon areas, which are not municipalities. Grey means no valid percentage.')}</p>
  </section>;
}
