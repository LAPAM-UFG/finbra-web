import { useMemo, type ReactNode } from 'react';
import { useApi, type Linha, type Params } from '../api';
import { Dica } from '../components/Dica';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { numero } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { anosDaColuna, faixaAnos, type FontesMeta } from '../saude_comum';
import { numero1Local, referencia, useColunasSaude } from './SaudeDatasus';

const pct1 = (v: number | null) => (v === null ? '–' : `${numero1Local(v)}%`);
const taxa = (cobertos: number | null, pop: number | null) => (cobertos === null || !pop ? null : (100 * cobertos) / pop);
const FORA = () => t('fora da cobertura', 'outside coverage');

function Secao({ titulo, dica, children }: { titulo: string; dica: string; children: ReactNode }) {
  return (
    <section className="cartao">
      <h3>{titulo} <Dica rotulo={t('Como ler', 'How to read')}>{dica}</Dica></h3>
      <div className="kpis">{children}</div>
    </section>
  );
}

/**
 * Atenção primária em Rede e acesso: cobertura e equipes do relatório público da APS (SAPS), valor de dezembro de cada ano.
 * A atenção básica (metodologia anterior, até 2020) e a cobertura potencial da atenção primária (2021 em diante) são séries
 * separadas e não se comparam; os agentes comunitários seguem os dois períodos. Em UF e Brasil, a cobertura é derivada de
 * numeradores e denominadores compatíveis (população coberta ÷ população de referência dos municípios com dado).
 */
export function BlocoAps({ ano, semAno, escopo, rotulo, municipio, fontes, versao }: {
  ano: number; semAno: boolean; escopo: Params; rotulo: string; municipio: boolean; fontes: FontesMeta; versao: string;
}) {
  const colunas = useColunasSaude();
  const versaoTem = colunas === null || colunas.has('aps_capacidade') || colunas.has('ab_cobertura') || colunas.has('acs_cobertura');
  const r = useApi<Linha[]>(versaoTem ? 'saude_aps' : null, escopo);
  const dados = r.dados ?? [];
  const coberturaAb = anosDaColuna('ab_cobertura', fontes);
  const coberturaAps = anosDaColuna('aps_cobertura', fontes);
  const coberturaAcs = anosDaColuna('acs_cobertura', fontes);
  const refAb = referencia(coberturaAb, ano, semAno);
  const refAps = referencia(coberturaAps, ano, semAno);
  const refAcs = referencia(coberturaAcs, ano, semAno);
  const doAno = (a: number | null) => (a === null ? undefined : dados.find((x) => Number(x.ano) === a));
  const temGrupo = (c: string) => dados.length === 0 || c in dados[0];

  /** Um cartão de cobertura: percentual derivado de numerador e denominador do mesmo recorte, ou o motivo de não haver. */
  const cartaoCobertura = (titulo: string, ref: number | null, cobertura: number[], grupo: string, cobertos: string, pop: string, muni: string, detalhe: (p: number | null) => string, dica?: ReactNode) => {
    if (!temGrupo(cobertos)) return <Kpi rotulo={titulo} valor={t('indisponível', 'unavailable')} nota={t('indisponível nesta versão dos dados', 'unavailable in this data version')} dica={dica} />;
    if (ref === null) return <Kpi rotulo={titulo} valor={FORA()} nota={`${grupo}: ${faixaAnos(cobertura)}`} dica={dica} />;
    const x = doAno(ref);
    const p = num(x?.[pop]);
    const v = taxa(num(x?.[cobertos]), p);
    if (v === null) {
      return <Kpi rotulo={titulo} valor={x ? t('indisponível no recorte', 'unavailable for this scope') : t('sem registro', 'no record')} dica={dica}
        nota={x ? t(`${ref} · faltam a população de referência ou a capacidade das equipes nos municípios do recorte`, `${ref} · reference population or team capacity is missing for the scope’s municipalities`) : `${ref}`} />;
    }
    const n = num(x?.[muni]);
    const todos = num(x?.municipios);
    return <Kpi rotulo={titulo} valor={pct1(v)} dica={dica}
      nota={<>{ref} · {t('dezembro', 'December')} · {detalhe(p)}{!municipio && n !== null && todos !== null ? ` · ${t(`${numero(n)} de ${numero(todos)} municípios com dado`, `${numero(n)} of ${numero(todos)} municipalities with data`)}` : ''}</>} />;
  };

  const cartaoContagem = (titulo: string, ref: number | null, cobertura: number[], grupo: string, coluna: string, nota: string, dica?: ReactNode) => {
    if (!temGrupo(coluna)) return <Kpi rotulo={titulo} valor={t('indisponível', 'unavailable')} nota={t('indisponível nesta versão dos dados', 'unavailable in this data version')} dica={dica} />;
    if (ref === null) return <Kpi rotulo={titulo} valor={FORA()} nota={`${grupo}: ${faixaAnos(cobertura)}`} dica={dica} />;
    const v = num(doAno(ref)?.[coluna]);
    return <Kpi rotulo={titulo} valor={v === null ? t('sem registro', 'no record') : numero(v)} nota={`${ref} · ${t('dezembro', 'December')} · ${nota}`} dica={dica} />;
  };

  const GRUPO_AB = t('atenção básica', 'basic care');
  const GRUPO_APS = t('atenção primária', 'primary care');
  const GRUPO_ACS = t('agentes comunitários', 'community agents');
  const popDe = (p: number | null) => t(`população de referência ${numero(p)}`, `reference population ${numero(p)}`);

  // séries: cada metodologia no seu período, sem emendar uma na outra
  const serieAb = dados.filter((x) => coberturaAb.includes(Number(x.ano)));
  const serieAps = dados.filter((x) => coberturaAps.includes(Number(x.ano)));
  const anosAb = serieAb.map((x) => Number(x.ano));
  const anosAps = serieAps.map((x) => Number(x.ano));
  const valorAb = (x: Linha) => taxa(num(x.ab_cobertos), num(x.ab_pop));
  const valorSf = (x: Linha) => taxa(num(x.ab_sf_cobertos), num(x.ab_sf_pop));
  const valorAps = (x: Linha) => taxa(num(x.aps_capacidade), num(x.aps_pop));
  const valorAcs = (x: Linha) => taxa(num(x.acs_cobertos), num(x.acs_pop));
  const fmt = (v: number) => `${numero1Local(v)}%`;
  const opcaoAb = useMemo(() => linhas(anosAb, [
    { nome: t('Atenção básica', 'Basic care'), valores: serieAb.map(valorAb) },
    { nome: t('Saúde da Família', 'Family Health'), valores: serieAb.map(valorSf) },
    { nome: t('Agentes comunitários', 'Community agents'), valores: serieAb.map(valorAcs) },
  ], fmt), [r.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoAps = useMemo(() => linhas(anosAps, [
    { nome: t('Cobertura potencial da atenção primária', 'Primary care potential coverage'), valores: serieAps.map(valorAps) },
    { nome: t('Agentes comunitários', 'Community agents'), valores: serieAps.map(valorAcs) },
  ], fmt), [r.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  const regra = !municipio
    ? t('UF e Brasil: população coberta ÷ população de referência dos municípios que têm o dado (nunca a soma ou a média dos percentuais municipais)', 'State and Brazil: covered population ÷ reference population of municipalities that have the data (never the sum or average of municipal percentages)')
    : t('município: valor oficial do relatório da APS', 'municipality: official value from the APS report');
  const comuns: [string, string][] = [
    [t('Recorte', 'Scope'), rotulo],
    [t('Competência', 'Competence'), t('dezembro de cada ano', 'December of each year')],
    [t('Fonte', 'Source'), t('relatórios públicos da atenção primária (SAPS/Ministério da Saúde), relatorioaps.saude.gov.br/cobertura/aps', 'public primary care reports (SAPS/Ministry of Health), relatorioaps.saude.gov.br/cobertura/aps')],
    [t('Regra de agregação', 'Aggregation rule'), regra],
    [t('Versão da base', 'Data version'), versao],
  ];
  const nMun = (x: Linha, k: string) => (municipio ? null : num(x[k]));

  if (!versaoTem) {
    return (
      <p className="aviso" role="status">
        {t('Atenção primária: indisponível nesta versão dos dados.', 'Primary care: unavailable in this data version.')}
      </p>
    );
  }
  if (r.carregando) return <p className="nota-base">{t('Carregando a atenção primária…', 'Loading primary care…')}</p>;
  if (r.erro) return <p className="aviso" role="alert">{t('Não foi possível carregar a atenção primária.', 'Could not load primary care.')}</p>;

  return (
    <>
      <p className="nota-base">
        <strong>{t('Atenção primária (SAPS)', 'Primary care (SAPS)')}</strong> · {t('valor de dezembro de cada ano, pelo município de residência', 'December value of each year, by municipality of residence')}
        {' · '}{GRUPO_AB}: {refAb ?? FORA()}{refAb === null ? ` (${faixaAnos(coberturaAb)})` : ''} · {GRUPO_APS}: {refAps ?? FORA()}{refAps === null ? ` (${faixaAnos(coberturaAps)})` : ''} · {GRUPO_ACS}: {refAcs ?? FORA()}
      </p>
      <div className="grade-2">
        <Secao titulo={t(`Atenção básica (metodologia anterior, ${faixaAnos(coberturaAb)})`, `Basic care (previous methodology, ${faixaAnos(coberturaAb)})`)}
          dica={t('Percentual da população coberta pelas equipes de Saúde da Família e de atenção básica equivalentes, limitado a 100% em cada município, segundo a portaria anterior. Não se compara com a cobertura potencial de 2021 em diante: a população coberta e a capacidade das equipes mudaram.', 'Share of the population covered by Family Health and equivalent basic care teams, capped at 100% in each municipality, under the previous ordinance. It is not comparable with the potential coverage from 2021: the covered population and team capacity changed.')}>
          {cartaoCobertura(t('Cobertura da atenção básica', 'Basic care coverage'), refAb, coberturaAb, GRUPO_AB, 'ab_cobertos', 'ab_pop', 'ab_municipios', popDe)}
          {cartaoCobertura(t('Cobertura da Saúde da Família', 'Family Health coverage'), refAb, coberturaAb, GRUPO_AB, 'ab_sf_cobertos', 'ab_sf_pop', 'ab_municipios', popDe)}
          {cartaoContagem(t('Equipes de Saúde da Família (eSF)', 'Family Health teams (eSF)'), refAb, coberturaAb, GRUPO_AB, 'ab_equipes_esf', t('equipes', 'teams'))}
        </Secao>
        <Secao titulo={t(`Atenção primária (cobertura potencial, ${faixaAnos(coberturaAps)})`, `Primary care (potential coverage, ${faixaAnos(coberturaAps)})`)}
          dica={t('Capacidade das equipes cadastradas (eSF e eAP) ÷ população de referência, sem limite de 100%: uma equipe acima da população entra como cobertura potencial acima de 100%. É a capacidade de atender, não a população efetivamente atendida.', 'Capacity of registered teams (eSF and eAP) ÷ reference population, with no 100% cap: a team above the population enters as potential coverage above 100%. It is the capacity to serve, not the population actually served.')}>
          {cartaoCobertura(t('Cobertura potencial da atenção primária', 'Primary care potential coverage'), refAps, coberturaAps, GRUPO_APS, 'aps_capacidade', 'aps_pop', 'aps_municipios', popDe)}
          {cartaoContagem(t('Equipes de Saúde da Família (eSF)', 'Family Health teams (eSF)'), refAps, coberturaAps, GRUPO_APS, 'aps_equipes_esf', t('equipes', 'teams'))}
          {cartaoContagem(t('Equipes de Atenção Primária (eAP)', 'Primary Care teams (eAP)'), refAps, coberturaAps, GRUPO_APS, 'aps_equipes_eap', t('equipes (eAP de 20 e de 30 horas)', 'teams (20-hour and 30-hour eAP)'))}
          {cartaoContagem(t('População coberta potencial', 'Potential covered population'), refAps, coberturaAps, GRUPO_APS, 'aps_capacidade', t('capacidade das equipes, em pessoas', 'team capacity, in people'))}
        </Secao>
      </div>
      <Secao titulo={t(`Agentes comunitários de saúde (${faixaAnos(coberturaAcs)})`, `Community health agents (${faixaAnos(coberturaAcs)})`)}
        dica={t('Percentual da população coberta por agentes comunitários de saúde ativos, limitado a 100% em cada município; a série segue nos dois períodos de metodologia da atenção primária.', 'Share of the population covered by active community health agents, capped at 100% in each municipality; the series continues across both primary care methodology periods.')}>
        {cartaoCobertura(t('Cobertura de agentes comunitários', 'Community agents coverage'), refAcs, coberturaAcs, GRUPO_ACS, 'acs_cobertos', 'acs_pop', 'acs_municipios', popDe)}
        {cartaoContagem(t('Agentes comunitários ativos', 'Active community agents'), refAcs, coberturaAcs, GRUPO_ACS, 'acs_agentes', t('agentes', 'agents'))}
      </Secao>
      <div className="grade-2">
        {anosAb.length > 0 && (
          <CartaoGrafico titulo={t(`Atenção básica e agentes comunitários, ${faixaAnos(coberturaAb)} (%)`, `Basic care and community agents, ${faixaAnos(coberturaAb)} (%)`)} desc={`${rotulo} · ${t('metodologia anterior, dezembro', 'previous methodology, December')}`}
            tabela={<TabelaSerie nome="saude_aps_atencao_basica" anos={anosAb} colunas={[
              { titulo: t('Cobertura da atenção básica (%)', 'Basic care coverage (%)'), valores: serieAb.map(valorAb), formato: pct1 },
              { titulo: t('População coberta estimada (atenção básica)', 'Estimated covered population (basic care)'), valores: serieAb.map((x) => num(x.ab_cobertos)), formato: numero },
              { titulo: t('População de referência (atenção básica)', 'Reference population (basic care)'), valores: serieAb.map((x) => num(x.ab_pop)), formato: numero },
              { titulo: t('Cobertura da Saúde da Família (%)', 'Family Health coverage (%)'), valores: serieAb.map(valorSf), formato: pct1 },
              { titulo: t('Equipes de Saúde da Família', 'Family Health teams'), valores: serieAb.map((x) => num(x.ab_equipes_esf)), formato: numero },
              { titulo: t('Cobertura de agentes comunitários (%)', 'Community agents coverage (%)'), valores: serieAb.map(valorAcs), formato: pct1 },
              { titulo: t('Agentes comunitários ativos', 'Active community agents'), valores: serieAb.map((x) => num(x.acs_agentes)), formato: numero },
              ...(municipio ? [] : [{ titulo: t('Municípios com dado de atenção básica', 'Municipalities with basic care data'), valores: serieAb.map((x) => nMun(x, 'ab_municipios')), formato: numero }]),
            ]} metadados={[...comuns, [t('Série', 'Series'), t(`atenção básica, metodologia anterior (${faixaAnos(coberturaAb)}); não se compara com a cobertura potencial de 2021 em diante`, `basic care, previous methodology (${faixaAnos(coberturaAb)}); not comparable with the potential coverage from 2021`)],
              [t('População de referência', 'Reference population'), t('população da base do relatório da APS em dezembro de cada ano (não é a estimativa da SVS/MS usada nas outras taxas)', 'population in the APS report base in December of each year (not the SVS/MS estimate used for other rates)')],
              [t('Cobertura estimada', 'Estimated coverage'), t('população coberta = cobertura municipal × população de referência (os percentuais do relatório vêm arredondados em duas casas)', 'covered population = municipal coverage × reference population (report percentages are rounded to two decimals)')]]} />}>
            <Grafico opcao={opcaoAb} nome="saude_aps_atencao_basica" />
          </CartaoGrafico>
        )}
        {anosAps.length > 0 && (
          <CartaoGrafico titulo={t(`Cobertura potencial da atenção primária, ${faixaAnos(coberturaAps)} (%)`, `Primary care potential coverage, ${faixaAnos(coberturaAps)} (%)`)} desc={`${rotulo} · ${t('metodologia atual, dezembro; sem limite de 100%', 'current methodology, December; no 100% cap')}`}
            tabela={<TabelaSerie nome="saude_aps_cobertura_potencial" anos={anosAps} colunas={[
              { titulo: t('Cobertura potencial (%)', 'Potential coverage (%)'), valores: serieAps.map(valorAps), formato: pct1 },
              { titulo: t('População coberta potencial (capacidade das equipes)', 'Potential covered population (team capacity)'), valores: serieAps.map((x) => num(x.aps_capacidade)), formato: numero },
              { titulo: t('População de referência', 'Reference population'), valores: serieAps.map((x) => num(x.aps_pop)), formato: numero },
              { titulo: t('Equipes de Saúde da Família (eSF)', 'Family Health teams (eSF)'), valores: serieAps.map((x) => num(x.aps_equipes_esf)), formato: numero },
              { titulo: t('Equipes de Atenção Primária (eAP)', 'Primary Care teams (eAP)'), valores: serieAps.map((x) => num(x.aps_equipes_eap)), formato: numero },
              { titulo: t('Cobertura de agentes comunitários (%)', 'Community agents coverage (%)'), valores: serieAps.map(valorAcs), formato: pct1 },
              { titulo: t('Agentes comunitários ativos', 'Active community agents'), valores: serieAps.map((x) => num(x.acs_agentes)), formato: numero },
              ...(municipio ? [] : [{ titulo: t('Municípios com dado de atenção primária', 'Municipalities with primary care data'), valores: serieAps.map((x) => nMun(x, 'aps_municipios')), formato: numero }]),
            ]} metadados={[...comuns, [t('Série', 'Series'), t(`atenção primária, cobertura potencial (${faixaAnos(coberturaAps)}); não se compara com a atenção básica até 2020`, `primary care, potential coverage (${faixaAnos(coberturaAps)}); not comparable with basic care up to 2020`)],
              [t('População de referência', 'Reference population'), t('população da base do relatório da APS em dezembro de cada ano (não é a estimativa da SVS/MS usada nas outras taxas)', 'population in the APS report base in December of each year (not the SVS/MS estimate used for other rates)')],
              [t('Cobertura potencial', 'Potential coverage'), t('capacidade das equipes cadastradas ÷ população de referência, sem limite de 100%', 'capacity of registered teams ÷ reference population, no 100% cap')]]} />}>
            <Grafico opcao={opcaoAps} nome="saude_aps_cobertura_potencial" />
          </CartaoGrafico>
        )}
      </div>
      <p className="nota-base">
        {t('A cobertura mede a capacidade das equipes cadastradas em relação à população de referência do relatório da APS, não a população efetivamente atendida. A atenção básica (até 2020) e a cobertura potencial (a partir de 2021) são séries separadas, com populações e regras de cálculo diferentes: não há continuidade entre elas. Fonte: ',
          'Coverage measures the capacity of registered teams relative to the APS report’s reference population, not the population actually served. Basic care (up to 2020) and potential coverage (from 2021) are separate series, with different populations and calculation rules: there is no continuity between them. Source: ')}
        <a href="https://relatorioaps.saude.gov.br/cobertura/aps" target="_blank" rel="noreferrer">relatorioaps.saude.gov.br</a>.
      </p>
    </>
  );
}
