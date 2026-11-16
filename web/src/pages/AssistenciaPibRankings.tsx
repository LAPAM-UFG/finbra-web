import { useId, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '../assistencia.css';
import { filtrarRankingPib, obterMetaEconomia, obterRankingPib, type LinhaRankingPib, type MedidaRankingPib } from '../assistencia_economia';
import { useSocial } from '../assistencia_dados';
import { AjudaAssistencia } from '../components/AjudaAssistencia';
import { Estado } from '../components/Kpi';
import { exportar, type Tabela } from '../exportar';
import { numero, reais, reaisExato } from '../format';
import { idioma, local, t } from '../idioma';
import { UF_NOMES } from '../ufs';

const MEDIDAS: MedidaRankingPib[] = ['pbf', 'bpc', 'total'];
const nome = (m: MedidaRankingPib) => m === 'pbf' ? 'Bolsa Família / Auxílio Brasil' : m === 'bpc' ? 'BPC' : t('Os dois programas', 'Both programmes');
const pct = (v: number) => v > 0 && v < .001 ? t('<0,001%', '<0.001%') : `${v.toLocaleString(local(), { minimumFractionDigits: 3, maximumFractionDigits: 3 })}%`;
const rotuloMunicipio = (l: LinhaRankingPib) => l[0] === 2605459 ? `${l[1]} (${t('distrito estadual', 'state district')})` : l[0] === 5300108 ? `${l[1]} (${t('ente único', 'single entity')})` : l[1];
const painel = (l: LinhaRankingPib, ano: number) => `/assistencia?uf=${l[2]}&cod=${l[0]}&ano_pib=${ano}#pagamentos-pib`;
const descricao = () => t('100 × pagamentos nominais dos 12 meses ÷ PIB nominal do mesmo ano e território. A lista é ordenada por essa relação, sem medir contribuição contábil ao PIB ou efeito causal na economia.', '100 × nominal payments in all 12 months ÷ nominal GDP for the same year and territory. The list is ordered by this ratio, which does not measure a contribution to GDP or a causal economic effect.');
const motivo = (i: number) => [t('Com percentual válido', 'Valid percentage'), t('Sem pagamentos informados', 'No reported payments'), t('Ano de pagamento incompleto', 'Incomplete payment year'), t('PIB do mesmo ano ausente', 'GDP for the same year missing'), t('PIB igual a zero', 'GDP is zero'), t('PIB inválido', 'Invalid GDP')][i];

export function AssistenciaPibRankings() {
  const [sp, setSp] = useSearchParams(); const id = useId();
  const meta = useSocial('economia-meta', obterMetaEconomia); const m = meta.dados;
  const rawMedida = sp.get('medida') || 'pbf';
  const medida: MedidaRankingPib = MEDIDAS.includes(rawMedida as MedidaRankingPib) ? rawMedida as MedidaRankingPib : 'pbf';
  const rawUf = (sp.get('uf') || 'BR').trim().toUpperCase(); const uf = rawUf === 'BR' || Object.hasOwn(UF_NOMES, rawUf) ? rawUf : 'BR';
  const rawAno = sp.get('ano_pib'); const anoValido = !!m && !!rawAno && /^\d{4}$/.test(rawAno) && m.anos.includes(Number(rawAno));
  const ano = anoValido ? Number(rawAno) : m?.pib_ate;
  const chave = ano ? `ranking-pib:${medida}:${ano}:${uf}` : null;
  const consulta = useSocial(chave, () => obterRankingPib(medida, ano!, uf)); const r = consulta.dados;
  const busca = sp.get('busca') ?? '';
  const filtradas = useMemo(() => filtrarRankingPib(r?.linhas ?? [], busca), [r, busca]);
  const tamanho = 25; const paginaPedida = Number(sp.get('pagina') ?? 1);
  const pagina = Math.min(Number.isSafeInteger(paginaPedida) && paginaPedida > 0 ? paginaPedida - 1 : 0, Math.max(0, Math.ceil(filtradas.length / tamanho) - 1));
  const visiveis = filtradas.slice(pagina * tamanho, (pagina + 1) * tamanho);
  const mudar = (extra: Record<string, string>) => {
    const n = new URLSearchParams(sp);
    if ('medida' in extra || 'ano_pib' in extra || 'uf' in extra) n.delete('pagina');
    if ('uf' in extra) n.delete('cod');
    for (const [k, v] of Object.entries({ medida, ano_pib: String(ano), uf, ...extra })) {
      if ((k === 'uf' && v === 'BR') || (k === 'busca' && !v) || (k === 'pagina' && v === '1')) n.delete(k); else n.set(k, v);
    }
    setSp(n, { replace: true });
  };
  const setBusca = (v: string) => mudar({ busca: v, pagina: '1' });
  const recorte = uf === 'BR' ? t('Brasil', 'Brazil') : `${UF_NOMES[uf][0]} (${uf})`;
  const origem = /^\d{7}$/.test(sp.get('cod') || '') ? r?.linhas.find(l => l[0] === Number(sp.get('cod'))) : undefined;
  const ufs = useMemo(() => Object.entries(UF_NOMES).sort((a, b) => a[1][0].localeCompare(b[1][0], 'pt-BR')), []);
  const retorno = `/assistencia?${new URLSearchParams({ ...(uf !== 'BR' ? { uf } : {}), ...(ano ? { ano_pib: String(ano) } : {}) })}#pagamentos-pib`;
  const tabela = (): Tabela => ({
    colunas: [t('Posição no recorte completo', 'Rank within the full scope'), t('Código IBGE', 'IBGE code'), t('Município', 'Municipality'), 'UF', t('Ano', 'Year'), t('Programa', 'Programme'), t('Pagamentos / PIB (%)', 'Payments / GDP (%)'), t('Pagamentos anuais (R$ nominais)', 'Yearly payments (nominal R$)'), t('PIB do mesmo ano (R$ nominais)', 'GDP for the same year (nominal R$)')],
    linhas: filtradas.map(l => [l[3], l[0], l[1], l[2], ano!, nome(medida), l[4], l[5], l[6]]),
    metadados: [[t('Recorte', 'Scope'), `${recorte} · ${ano} · ${nome(medida)}`], [t('Cálculo', 'Calculation'), descricao()], [t('Cobertura', 'Coverage'), `${r?.cobertura.validos ?? 0}/${r?.cobertura.total ?? 0} ${t('territórios do cadastro atual com percentual válido; ausências não são zero', 'territories in the current registry with a valid percentage; missing values are not zero')}`], [t('Empates', 'Ties'), t('Posições 1, 2, 2, 4, com razões monetárias exatas, antes do arredondamento. A busca preserva as posições do recorte completo.', 'Ranks 1, 2, 2, 4, using exact monetary ratios before rounding. Search preserves ranks from the full scope.')], [t('Unidades', 'Units'), t('O percentual é numérico: 2 significa 2%. Valores monetários nominais. Todos os classificados têm 12 meses válidos.', 'Percentage is numeric: 2 means 2%. Monetary amounts are nominal. Every ranked record has 12 valid months.')], [t('Ressalva', 'Caveat'), t('A série Bolsa Família/Auxílio Brasil não inclui o Benefício Extraordinário do Auxílio Brasil (atenção a 2021–2023). BPC inclui retroativos já presentes no total. DF e Brasília são um único território; Fernando de Noronha é distrito estadual.', 'The Bolsa Família/Auxílio Brasil series excludes the extraordinary Auxílio Brasil benefit (interpret 2021–2023 with caution). Retroactive BPC payments are already in the total. DF and Brasília are one territory; Fernando de Noronha is a state district.')], [t('Fontes', 'Sources'), 'Portal da Transparência/CGU; IBGE/SIDRA 5938; LAPAM/UFG']],
  });
  const paginas = (sufixo: string) => <nav className="as-ranking-pib-paginacao" aria-label={t(`Paginação do ranking ${sufixo}`, `Ranking pagination ${sufixo}`)}>
    <button className="botao-leve" disabled={pagina === 0} onClick={() => mudar({ pagina: String(pagina) })}>{t('Anterior', 'Previous')}</button>
    <span>{t(`Página ${pagina + 1} de ${Math.max(1, Math.ceil(filtradas.length / tamanho))}`, `Page ${pagina + 1} of ${Math.max(1, Math.ceil(filtradas.length / tamanho))}`)}</span>
    <button className="botao-leve" disabled={(pagina + 1) * tamanho >= filtradas.length} onClick={() => mudar({ pagina: String(pagina + 2) })}>{t('Próxima', 'Next')}</button>
  </nav>;
  return <div className="assistencia-painel">
    <h2 className="titulo-pagina">{t('Onde os benefícios têm maior peso em relação ao PIB?', 'Where are benefit payments largest compared with GDP?')}</h2>
    <p className="as-sub">{t('Ranking municipal com números prontos. Escolha o programa, o ano e o estado; a lista muda automaticamente.', 'Municipal ranking with ready-made figures. Choose the programme, year and state; the list updates automatically.')}</p>
    <nav className="as-nav" aria-label={t('Seções de assistência social', 'Social assistance sections')}><Link to={retorno}>{t('Painel', 'Overview')}</Link><Link to={`/assistencia/rankings${uf !== 'BR' ? `?uf=${uf}` : ''}`}>{t('Rankings mensais', 'Monthly rankings')}</Link><Link to={`/assistencia/rankings-pib?${sp}`} aria-current="page">{t('Pagamentos / PIB', 'Payments / GDP')}</Link></nav>
    {meta.carregando && <Estado carregando />}
    {meta.erro && <Estado erro={meta.erro} tentarNovamente={meta.recarregar} />}
    {m && <>
      <form className="as-ranking-pib-filtros cartao" onSubmit={e => e.preventDefault()} aria-label={t('Filtros do ranking anual', 'Yearly ranking filters')}>
        <div className="as-campo"><label htmlFor={`${id}-programa`}>{t('Programa', 'Programme')}</label><select id={`${id}-programa`} value={medida} onChange={e => mudar({ medida: e.target.value })}>{MEDIDAS.map(k => <option key={k} value={k}>{nome(k)}</option>)}</select></div>
        <div className="as-campo"><label htmlFor={`${id}-ano`}>{t('Ano dos pagamentos e do PIB', 'Year of payments and GDP')}</label><select id={`${id}-ano`} value={ano} onChange={e => mudar({ ano_pib: e.target.value })}>{[...m.anos].reverse().map(y => <option key={y} value={y}>{y}{y > m.pib_ate ? t(' · sem PIB', ' · no GDP') : ''}</option>)}</select></div>
        <div className="as-campo"><label htmlFor={`${id}-uf`}>{t('Comparar municípios de', 'Compare municipalities in')}</label><select id={`${id}-uf`} value={uf} onChange={e => mudar({ uf: e.target.value })}><option value="BR">{t('Brasil · todos os estados', 'Brazil · all states')}</option>{ufs.map(([sigla, [n]]) => <option key={sigla} value={sigla}>{n} ({sigla})</option>)}</select></div>
      </form>
      {(rawUf !== uf || rawMedida !== medida || (!!rawAno && !anoValido)) && <p role="status">{t(`O endereço traz um filtro inválido. Mostrando ${nome(medida)}, ${ano}, ${recorte}; ajuste as opções acima.`, `The URL contains an invalid filter. Showing ${nome(medida)}, ${ano}, ${recorte}; adjust the options above.`)}</p>}
      <p className="as-recorte">{nome(medida)} · {ano} · {recorte}</p>
      <p className="as-resumo">{t('Maior percentual primeiro. Só entram pagamentos de 12 meses válidos e PIB positivo do mesmo ano.', 'Highest percentage first. Requires 12 valid payment months and positive GDP for the same year.')} <AjudaAssistencia rotulo={t('Como o ranking é calculado', 'How the ranking is calculated')}><p>{descricao()}</p><p>{t('Empates usam posições 1, 2, 2, 4. Valores exibidos são arredondados, mas as posições usam as razões monetárias exatas. Um percentual maior não é uma nota de qualidade nem uma medida de impacto causal.', 'Ties use ranks 1, 2, 2, 4. Displayed values are rounded, but positions use exact monetary ratios. A higher percentage is not a quality score or a causal impact measure.')}</p></AjudaAssistencia></p>
      <p className="as-resumo">{t(`PIB disponível até ${m.pib_ate}. A série Bolsa Família/Auxílio Brasil não inclui o Benefício Extraordinário do Auxílio Brasil: atenção a 2021–2023.`, `GDP available through ${m.pib_ate}. The Bolsa Família/Auxílio Brasil series excludes the extraordinary Auxílio Brasil benefit: interpret 2021–2023 with caution.`)}</p>
      {consulta.carregando && <Estado carregando />}
      {consulta.erro && <Estado erro={consulta.erro} tentarNovamente={consulta.recarregar} />}
      {r && <section className="cartao as-ranking-pib-resultados" aria-label={t('Ranking municipal por pagamentos / PIB', 'Municipal payments / GDP ranking')}>
        <p role="status">{t(`${numero(r.cobertura.validos)} municípios e territórios equiparados com percentual válido; ${numero(r.cobertura.total - r.cobertura.validos)} sem percentual.`, `${numero(r.cobertura.validos)} municipalities and equivalent territories with a valid percentage; ${numero(r.cobertura.total - r.cobertura.validos)} without one.`)}</p>
        <details className="as-ranking-pib-cobertura"><summary>{t('Ver cobertura e motivos das exclusões', 'See coverage and reasons for exclusions')}</summary><p>{t('O cadastro territorial é o atual: inclui Brasília/DF uma vez e Fernando de Noronha como distrito estadual. Municípios ainda não existentes no ano podem não ter dados. Ausência de pagamento informado não é pagamento zero.', 'The territorial registry is current: it includes Brasília/DF once and Fernando de Noronha as a state district. Municipalities not yet created in the selected year may have no data. Missing reported payments do not mean zero payments.')}</p><ul>{r.cobertura.condicoes.map((n, i) => <li key={i}>{motivo(i)}: {numero(n)}</li>)}</ul></details>
        {origem && <p className="as-ranking-pib-local">{rotuloMunicipio(origem)} ({origem[2]}): {t(`posição ${numero(origem[3])} no recorte`, `rank ${numero(origem[3])} within the scope`)} · {pct(origem[4])}. <button className="botao-leve" onClick={() => setBusca(String(origem[0]))}>{t('Localizar na lista', 'Find in the list')}</button></p>}
        <div className="as-ranking-pib-busca"><label htmlFor={`${id}-busca`}>{t('Encontrar município ou código IBGE', 'Find a municipality or IBGE code')}</label><input id={`${id}-busca`} type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder={t('Ex.: Goiânia ou 5208707', 'E.g. Goiânia or 5208707')} />{busca && <button className="botao-leve" onClick={() => setBusca('')}>{t('Limpar busca', 'Clear search')}</button>}</div>
        <p className="as-resumo" role="status">{t(`${numero(filtradas.length)} de ${numero(r.linhas.length)} registros encontrados. A busca preserva as posições do recorte completo.`, `${numero(filtradas.length)} of ${numero(r.linhas.length)} records found. Search preserves ranks from the full scope.`)}</p>
        {r.linhas.length === 0 && <p className="as-resumo">{t('Sem percentuais válidos neste ano e recorte. Anos com classificação neste programa:', 'No valid percentages for this year and scope. Years with ranked data for this programme:')} {r.anos_com_valor.join(', ')}.</p>}
        <div className="as-acoes"><span>{t('Baixar ranking filtrado completo:', 'Download the complete filtered ranking:')}</span>{(['csv', 'xlsx'] as const).map(f => <button key={f} className="botao-leve" disabled={!filtradas.length} onClick={() => exportar(`ranking_assistencia_pib_${medida}_${ano}_${uf}`, f, tabela(), idioma() === 'en' ? '.' : ',')}>{f === 'csv' ? 'CSV' : 'Excel'}</button>)}</div>
        {filtradas.length > 0 && <>
          {paginas('superior')}
          <div className="as-ranking-pib-desktop"><table className="as-tabela as-ranking-pib-tabela"><caption>{nome(medida)} / {t('PIB', 'GDP')} · {ano} · {recorte}</caption><thead><tr><th>{t('Posição', 'Rank')}</th><th>{t('Município', 'Municipality')}</th><th>UF</th><th className="as-num">% {t('do PIB', 'of GDP')}</th><th className="as-num">{t('Pagamentos no ano', 'Yearly payments')}</th><th className="as-num">{t('PIB do mesmo ano', 'GDP for the same year')}</th></tr></thead><tbody>{visiveis.map(l => <tr key={l[0]}><td>{numero(l[3])}</td><td><Link to={painel(l, ano!)}>{rotuloMunicipio(l)}</Link><small className="as-ranking-pib-codigo">{l[0]}</small></td><td>{l[2]}</td><td className="as-num"><strong>{pct(l[4])}</strong></td><td className="as-num">{reaisExato(l[5])}</td><td className="as-num">{reaisExato(l[6])}</td></tr>)}</tbody></table></div>
          <ol className="as-ranking-pib-cards" aria-label={t('Ranking municipal', 'Municipal ranking')}>{visiveis.map(l => <li key={l[0]}><span className="as-ranking-pib-pos" aria-label={t(`Posição ${l[3]}`, `Rank ${l[3]}`)}>{numero(l[3])}</span><div><Link to={painel(l, ano!)}>{rotuloMunicipio(l)}</Link><small className="as-ranking-pib-codigo">{l[2]} · {l[0]}</small></div><strong className="as-ranking-pib-percentual">{pct(l[4])}</strong><dl><div><dt>{t('Pagamentos no ano', 'Yearly payments')}</dt><dd>{reais(l[5])}</dd></div><div><dt>{t('PIB do mesmo ano', 'GDP for the same year')}</dt><dd>{reais(l[6])}</dd></div></dl></li>)}</ol>
          {paginas('inferior')}
        </>}
      </section>}
      <p className="as-resumo">{t('Valores em reais nominais. O total soma dinheiro de programas diferentes, sem somar pessoas ou famílias únicas. Fonte: CGU e IBGE/SIDRA 5938. Processamento: LAPAM/UFG.', 'Amounts in nominal reais. The combined figure adds money from different programmes, without adding unique people or families. Sources: CGU and IBGE/SIDRA 5938. Processing: LAPAM/UFG.')}</p>
      <div className="as-atalhos"><Link to={retorno}>{t('Voltar à comparação com o PIB', 'Back to the GDP comparison')}</Link><Link to={`/downloads?area=assistencia${uf !== 'BR' ? `&uf=${uf}` : ''}`}>{t('Dados municipais e API para R e Stata', 'Municipal data and API for R and Stata')}</Link></div>
    </>}
  </div>;
}
