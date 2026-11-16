import { useEffect, useId } from 'react';
import { Link } from 'react-router-dom';
import { compararPib, obterEconomia, obterMetaEconomia, type AnoEconomia } from '../assistencia_economia';
import { useSocial } from '../assistencia_dados';
import { exportar, type Tabela } from '../exportar';
import { idioma, local, t } from '../idioma';
import { reais, reaisExato } from '../format';
import { Estado } from './Kpi';
import { AjudaAssistencia } from './AjudaAssistencia';

const TIPOS = ['pbf', 'bpc', 'total'] as const;
const nome = (tipo: typeof TIPOS[number]) => tipo === 'pbf' ? 'Bolsa Família / Auxílio Brasil' : tipo === 'bpc' ? 'BPC' : t('Os dois programas', 'Both programmes');
const percentual = (v: number | null) => v === null ? '–' : `${v.toLocaleString(local(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
export const condicaoEconomia = (c: number) => [t('Registrado', 'Recorded'), t('Sem pagamentos informados', 'No reported payments'), t('Ano incompleto: menos de 12 meses válidos', 'Incomplete year: fewer than 12 valid months'), t('PIB do mesmo ano indisponível', 'GDP for the same year unavailable'), t('Indefinido: PIB igual a zero', 'Undefined: GDP is zero'), t('PIB inválido', 'Invalid GDP')][c] ?? t('Indisponível', 'Unavailable');
const nota = () => t('Pagamentos nominais dos 12 meses ÷ PIB nominal do mesmo ano × 100. É uma comparação de grandeza; não mede a contribuição desses programas ao PIB nem seu efeito causal na economia.', 'Nominal payments over all 12 months ÷ nominal GDP for the same year × 100. This compares magnitudes; it does not measure these programmes’ contribution to GDP or their causal effect on the economy.');

export function EconomiaAssistencia({ grupo, uf, nomeTerritorio, anoPedido, alterar }: { grupo: string; uf: string | null; nomeTerritorio: string; anoPedido: string | null; alterar: (m: Record<string, string | null>) => void }) {
  const id = useId();
  const meta = useSocial('economia-meta', obterMetaEconomia);
  const dados = useSocial(`economia:${grupo}:${uf}`, () => obterEconomia(grupo, uf));
  useEffect(() => {
    if (!dados.dados || window.location.hash !== '#pagamentos-pib') return;
    const frame = requestAnimationFrame(() => document.getElementById('pagamentos-pib')?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [dados.dados]);
  const estado = useSocial(uf && grupo !== uf ? `economia:${uf}` : null, () => obterEconomia(uf!, uf));
  const brasil = useSocial(grupo !== 'BR' ? 'economia:BR' : null, () => obterEconomia('BR', null));
  const m = meta.dados;
  const anoValido = !!m && !!anoPedido && /^\d{4}$/.test(anoPedido) && m.anos.includes(Number(anoPedido));
  const ano = anoValido ? Number(anoPedido) : m?.pib_ate;
  const l = dados.dados?.linhas.find(x => x[0] === ano);
  const tabela = (): Tabela => ({
    colunas: [t('Território', 'Territory'), t('Ano', 'Year'), t('PIB (R$ nominais)', 'GDP (nominal R$)'), t('Programa', 'Programme'), t('Pagamentos anuais completos (R$ nominais)', 'Complete yearly payments (nominal R$)'), t('Meses válidos', 'Valid months'), t('Pagamentos / PIB (%)', 'Payments / GDP (%)'), t('Condição', 'Data status')],
    linhas: (dados.dados?.linhas ?? []).flatMap(row => TIPOS.map(tipo => { const c = compararPib(row, tipo); return [nomeTerritorio, row[0], row[1], nome(tipo), c.pago, c.meses, c.valor, condicaoEconomia(c.condicao)]; })),
    metadados: [[t('Cálculo', 'Calculation'), nota()], [t('Fontes', 'Sources'), 'Portal da Transparência/CGU; IBGE/SIDRA 5938; LAPAM/UFG'], [t('Cobertura', 'Coverage'), t('A série Bolsa Família/Auxílio Brasil não inclui o Benefício Extraordinário do Auxílio Brasil (2021–2023). Retroativos do BPC já entram no total. CadÚnico é cadastro e não tem pagamento próprio.', 'The Bolsa Família/Auxílio Brasil series excludes the extraordinary Auxílio Brasil benefit (2021–2023). Retroactive BPC payments are already in the total. CadÚnico is a registry with no payments of its own.')]],
  });
  const comp = (row: AnoEconomia | undefined, tipo: typeof TIPOS[number], rotulo: string) => { const c = compararPib(row, tipo); return `${rotulo}: ${c.valor === null ? condicaoEconomia(c.condicao) : percentual(c.valor)}`; };
  return <section id="pagamentos-pib" className="cartao as-economia" aria-labelledby={`${id}-titulo`}>
    <h3 id={`${id}-titulo`}>{t('Quanto os pagamentos representam em relação ao PIB?', 'How large are the payments compared with GDP?')}</h3>
    <p className="as-resumo">{t('Comparação anual independente do filtro mensal acima. O PIB mede o valor dos bens e serviços finais produzidos no território durante o ano.', 'This yearly comparison is independent of the monthly filter above. GDP measures the value of final goods and services produced in the territory over a year.')}</p>
    {(meta.carregando || dados.carregando) && <Estado carregando />}
    {(meta.erro || dados.erro) && <Estado erro={meta.erro || dados.erro || ''} tentarNovamente={() => { meta.recarregar(); dados.recarregar(); }} />}
    {m && dados.dados && <>
      <div className="as-economia-filtro"><label htmlFor={`${id}-ano`}>{t('Ano da comparação com o PIB', 'Year for GDP comparison')}</label><select id={`${id}-ano`} value={ano} onChange={e => alterar({ ano_pib: e.target.value })}>{[...m.anos].reverse().map(y => <option key={y} value={y}>{y}{y > m.pib_ate ? t(' · sem PIB disponível', ' · GDP unavailable') : ''}</option>)}</select></div>
      {anoPedido && !anoValido && <p role="status">{t(`Ano inválido para esta comparação. Mostrando ${ano}.`, `Invalid comparison year. Showing ${ano}.`)}</p>}
      <p className="as-recorte">{nomeTerritorio} · {ano} · {t('PIB', 'GDP')}: {l?.[1] === null || l?.[1] === undefined ? t('indisponível', 'unavailable') : reais(l[1])}</p>
      <div className="as-economia-kpis">{TIPOS.map(tipo => { const x = compararPib(l, tipo); return <div className="as-kpi as-economia-kpi" key={tipo}>
        <div className="as-economia-cab"><span className="as-kpi-rot">{nome(tipo)} / {t('PIB', 'GDP')}</span><AjudaAssistencia rotulo={t(`Explicação: ${nome(tipo)} / ${t('PIB', 'GDP')}`, `Explanation: ${nome(tipo)} / GDP`)}><p>{nota()}</p><p>{t('Só aparece com 12 meses válidos de pagamento e PIB positivo do mesmo ano. O total exige os dois programas completos. Ausência não vira zero.', 'Requires 12 valid payment months and positive GDP for the same year. The combined figure requires both complete programmes. Missing data never become zero.')}</p></AjudaAssistencia></div>
        <span className="as-kpi-val">{x.valor === null ? condicaoEconomia(x.condicao) : percentual(x.valor)}</span>
        <span className="as-kpi-cmp">{t('Pagamentos no ano', 'Yearly payments')}: {x.pago === null ? '–' : reais(x.pago)} · {x.meses}/12 {t('meses válidos', 'valid months')}{tipo === 'total' ? t(' em ambos', ' in both') : ''}</span>
        {x.valor !== null && <span className="as-kpi-cmp">{t(`A cada R$ 100 de PIB, R$ ${(x.valor).toLocaleString(local(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} em pagamentos.`, `For every R$100 of GDP, R$${(x.valor).toLocaleString(local(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })} in payments.`)}</span>}
        {estado.dados && <span className="as-kpi-cmp">{comp(estado.dados.linhas.find(r => r[0] === ano), tipo, uf!)}</span>}
        {brasil.dados && <span className="as-kpi-cmp">{comp(brasil.dados.linhas.find(r => r[0] === ano), tipo, t('Brasil', 'Brazil'))}</span>}
        {m.rankings?.[tipo] && <Link className="as-ranking-pib-link" aria-label={t(`Ranking municipal: ${nome(tipo)} / PIB`, `Municipal ranking: ${nome(tipo)} / GDP`)} to={`/assistencia/rankings-pib?${new URLSearchParams({ medida: tipo, ano_pib: String(ano), ...(uf ? { uf } : {}), ...(/^\d{7}$/.test(grupo) ? { cod: grupo } : {}) })}`}>{uf ? t(`Ranking em ${uf}`, `Ranking in ${uf}`) : t('Ranking dos municípios', 'Municipal ranking')}</Link>}
      </div>; })}</div>
      <p className="as-resumo">{nota()}</p>
      <p className="as-resumo">{t(`PIB disponível neste painel até ${m.pib_ate}. CadÚnico é um cadastro, não um benefício pago, e não entra na soma. A série Bolsa Família/Auxílio Brasil não inclui o Benefício Extraordinário do Auxílio Brasil: atenção a 2021–2023.`, `GDP available in this panel through ${m.pib_ate}. CadÚnico is a registry, not a cash benefit, and is excluded from the sum. The Bolsa Família/Auxílio Brasil series excludes the extraordinary Auxílio Brasil benefit: interpret 2021–2023 with caution.`)}</p>
      <details><summary>{t('Ver todos os anos e valores usados', 'See all years and underlying amounts')}</summary><div className="as-tabela-rolagem"><table className="as-tabela"><caption>{nomeTerritorio} · {t('valores anuais em reais nominais', 'yearly amounts in nominal reais')}</caption><thead><tr><th>{t('Ano', 'Year')}</th><th>PIB (R$)</th><th>Bolsa Família / Auxílio Brasil (R$)</th><th>BPC (R$)</th><th>{t('Programa / PIB', 'Programme / GDP')}</th></tr></thead><tbody>{dados.dados.linhas.map(row => <tr key={row[0]}><td>{row[0]}</td><td className="as-num">{row[1] === null ? '–' : reaisExato(row[1])}</td><td className="as-num">{row[2] === null ? `– (${row[4]}/12)` : reaisExato(row[2])}</td><td className="as-num">{row[3] === null ? `– (${row[5]}/12)` : reaisExato(row[3])}</td><td>{TIPOS.map(tipo => { const x = compararPib(row, tipo); return <div key={tipo}>{nome(tipo)}: {x.valor === null ? condicaoEconomia(x.condicao) : percentual(x.valor)}</div>; })}</td></tr>)}</tbody></table></div></details>
      <div className="as-acoes"><span>{t('Baixar comparação anual:', 'Download yearly comparison:')}</span>{(['csv', 'xlsx'] as const).map(fmt => <button key={fmt} className="botao-leve" onClick={() => exportar(`assistencia_pib_${grupo}`, fmt, tabela(), idioma() === 'en' ? '.' : ',')}>{fmt === 'csv' ? 'CSV' : 'Excel'}</button>)}<Link to="/downloads?area=assistencia">{t('Base municipal e API para R e Stata', 'Municipal data and API for R and Stata')}</Link></div>
    </>}
  </section>;
}
