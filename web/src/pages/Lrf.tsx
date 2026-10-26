import { useMemo, useState } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { numero, pct, reais } from '../format';
import { num } from '../hooks';
import { local, t } from '../idioma';

const PRIMEIRO_ANO_LRF = 2015;
const pctEixo = (v: number) => pct(v, 0);
/** Percentual declarado (48,56) como fração (0,4856), o formato do pct(). */
const fr = (v: unknown) => (typeof v === 'number' ? v / 100 : null);

const fonteLrf = () => t(
  'SICONFI/Tesouro Nacional: Relatório Resumido da Execução Orçamentária (RREO, 6º bimestre) e Relatório de Gestão Fiscal (RGF, último quadrimestre ou semestre, Poder Executivo), incluídas as versões simplificadas. Percentuais como declarados pelo ente.',
  'SICONFI/National Treasury: Summary Budget Execution Report (RREO, 6th two-month period) and Fiscal Management Report (RGF, last four-month or six-month period, Executive branch), including the simplified versions. Percentages as reported by each government.',
);

const formulas = {
  pessoal: () => t(
    'Despesa total com pessoal (DTP) do Poder Executivo ÷ receita corrente líquida ajustada, nos últimos 12 meses (RGF, anexo 1). Limite máximo: 54% nos municípios e 49% nos estados; prudencial: 95% do limite. Em grupos: soma da DTP ÷ soma da RCL ajustada, só dos entes com os dois valores.',
    'Total personnel expenditure (DTP) of the Executive ÷ adjusted net current revenue, last 12 months (RGF, annex 1). Maximum limit: 54% for municipalities and 49% for states; prudential: 95% of the limit. For groups: sum of DTP ÷ sum of adjusted RCL, only for governments with both values.',
  ),
  dcl: () => t(
    'Dívida consolidada líquida (DCL) ÷ receita corrente líquida ajustada, no fim do exercício (RGF, anexo 2). Limite do Senado (Resolução 40/2001): 120% nos municípios e 200% nos estados. DCL negativa: as disponibilidades superam a dívida.',
    'Net consolidated debt (DCL) ÷ adjusted net current revenue at year-end (RGF, annex 2). Senate limit (Resolution 40/2001): 120% for municipalities and 200% for states. Negative DCL: cash exceeds debt.',
  ),
  saude: () => t(
    'Despesas com ações e serviços públicos de saúde ÷ receita de impostos e transferências da base constitucional (RREO, anexo 14). Mínimo: 15% nos municípios (LC 141/2012) e 12% nos estados.',
    'Public health actions and services expenditure ÷ the constitutional base of taxes and transfers (RREO, annex 14). Minimum: 15% for municipalities (Supplementary Law 141/2012) and 12% for states.',
  ),
  mde: () => t(
    'Manutenção e desenvolvimento do ensino ÷ receita de impostos e transferências (RREO, anexo 14). Mínimo constitucional: 25% (art. 212).',
    'Maintenance and development of education ÷ tax and transfer revenue (RREO, annex 14). Constitutional minimum: 25% (art. 212).',
  ),
  fundeb: () => t(
    'Parcela do FUNDEB aplicada na remuneração dos profissionais da educação (RREO, anexo 14). Mínimo: 70% desde 2021 (Lei 14.113/2020); 60% na remuneração do magistério até 2020.',
    'Share of FUNDEB spent on education professionals’ pay (RREO, annex 14). Minimum: 70% since 2021 (Law 14,113/2020); 60% on teachers’ pay until 2020.',
  ),
  primario: () => t(
    'Resultado primário do exercício, acima da linha e sem o RPPS quando o ente informa essa versão (RREO, anexo 14), comparado à meta da Lei de Diretrizes Orçamentárias. Negativo: déficit.',
    'Primary balance for the year, above the line and excluding the pension regime (RPPS) when reported (RREO, annex 14), compared with the Budget Guidelines Law target. Negative: deficit.',
  ),
};

/** Situação em relação ao limite (máximo) ou ao mínimo legal. */
function situacao(v: number | null, ref: number | null, tipo: 'max' | 'min') {
  if (v === null || ref === null) return '';
  if (tipo === 'max') {
    if (v > ref) return t('acima do limite', 'above the limit');
    if (v > 0.95 * ref) return t('acima do prudencial', 'above the prudential limit');
    return t('dentro do limite', 'within the limit');
  }
  return v < ref ? t('abaixo do mínimo', 'below the minimum') : t('cumpre o mínimo', 'meets the minimum');
}

function AvisoAnos({ ano, anos }: { ano: number; anos: number[] }) {
  if (ano >= PRIMEIRO_ANO_LRF && (!anos.length || anos.includes(ano))) return null;
  return (
    <p className="aviso" role="status">
      {ano < PRIMEIRO_ANO_LRF
        ? t(`A API do SICONFI publica o RREO e o RGF a partir de ${PRIMEIRO_ANO_LRF}; ${ano} não tem esses relatórios.`,
          `The SICONFI API publishes the RREO and RGF from ${PRIMEIRO_ANO_LRF}; ${ano} has no such reports.`)
        : t(`Ainda não há RREO/RGF processados para ${ano}.`, `No RREO/RGF processed for ${ano} yet.`)}
    </p>
  );
}

export function LrfIndicadores() {
  const { meta } = useDados();
  const f = useFiltros();
  const [esfera, setEsfera] = useState<'M' | 'E'>('M');
  const fonte = meta.fontes.siconfi_lrf as { exercicios?: number[] } | undefined;
  const anosLrf = fonte?.exercicios ?? [];

  if (!fonte) {
    return (
      <>
        <h2 className="titulo-pagina">{t('Responsabilidade fiscal (LRF)', 'Fiscal responsibility (LRF)')}</h2>
        <p className="vazio">{t('Os dados do RREO e do RGF ainda não foram publicados.', 'RREO and RGF data have not been published yet.')}</p>
      </>
    );
  }
  return (
    <>
      <h2 className="titulo-pagina">{t('Responsabilidade fiscal (LRF)', 'Fiscal responsibility (LRF)')}</h2>
      <p className="subtitulo">
        {f.alvo ? f.rotulo : esfera === 'E' ? t('Estados', 'States') : f.uf ? t(`Municípios de ${f.uf}`, `Municipalities in ${f.uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil')}
        {' · '}{t('RREO e RGF, fechamento do exercício', 'RREO and RGF, year-end')} <Dica rotulo={t('Fonte', 'Source')}>{fonteLrf()}</Dica>
      </p>
      <BarraFiltros />
      {!f.alvo && !f.uf && (
        <div className="alternar" role="group" aria-label={t('Esfera', 'Level')} style={{ marginBottom: 14 }}>
          <button className={esfera === 'M' ? 'ativo' : ''} onClick={() => setEsfera('M')}>{t('Municípios', 'Municipalities')}</button>
          <button className={esfera === 'E' ? 'ativo' : ''} onClick={() => setEsfera('E')}>{t('Estados', 'States')}</button>
        </div>
      )}
      <AvisoAnos ano={f.ano} anos={anosLrf} />
      {f.alvo ? <LrfEnte cod={f.alvo.cod_ibge} /> : <LrfGrupo esfera={f.uf ? 'M' : esfera} uf={f.uf ?? undefined} />}
    </>
  );
}

function LrfEnte({ cod }: { cod: number }) {
  const f = useFiltros();
  const serie = useApi<Linha[]>('lrf_ente', { ente: cod });
  const s = serie.dados ?? [];
  const anos = s.map((r) => r.exercicio as number);
  const a = s.find((r) => r.exercicio === f.ano);

  const opcaoPessoal = useMemo(() => linhas(anos, [
    { nome: t('Pessoal ÷ RCL', 'Personnel ÷ RCL'), valores: s.map((r) => fr(r.pessoal_rcl_pct)) },
    { nome: t('Limite máximo', 'Maximum limit'), valores: s.map((r) => fr(r.pessoal_limite_pct)) },
    { nome: t('DCL ÷ RCL', 'DCL ÷ RCL'), valores: s.map((r) => fr(r.dcl_rcl_pct)) },
  ], pctEixo), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoMinimos = useMemo(() => linhas(anos, [
    { nome: t('Saúde', 'Health'), valores: s.map((r) => fr(r.saude_pct)) },
    { nome: t('Educação (MDE)', 'Education (MDE)'), valores: s.map((r) => fr(r.mde_pct)) },
    { nome: t('FUNDEB na remuneração', 'FUNDEB on pay'), valores: s.map((r) => fr(r.fundeb_pct)) },
  ], pctEixo), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !s.length && t('Este ente não tem RREO nem RGF na API.', 'This government has no RREO or RGF in the API.')} />
      {a && (
        <>
          <h3 className="secao">{t(`Exercício de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
          <p className="nota-base">
            {t('Entregue', 'Filed')}: {a.rreo_tipo ?? t('RREO não entregue', 'RREO not filed')} · {a.rgf_tipo ?? t('RGF não entregue', 'RGF not filed')}
          </p>
          <div className="kpis">
            <Kpi rotulo={t('Despesa com pessoal ÷ RCL', 'Personnel expenditure ÷ RCL')} valor={pct(fr(a.pessoal_rcl_pct))}
              nota={`${t('Limite', 'Limit')} ${pct(fr(a.pessoal_limite_pct))} · ${situacao(num(a.pessoal_rcl_pct), num(a.pessoal_limite_pct), 'max')}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.pessoal()}</Dica>} />
            <Kpi rotulo={t('Dívida consolidada líquida ÷ RCL', 'Net consolidated debt ÷ RCL')} valor={pct(fr(a.dcl_rcl_pct))}
              nota={`${t('Limite', 'Limit')} ${pct(fr(a.lim_dcl), 0)} · ${situacao(num(a.dcl_rcl_pct), num(a.lim_dcl), 'max')}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.dcl()}</Dica>} />
            <Kpi rotulo={t('Aplicação em saúde', 'Health spending')} valor={pct(fr(a.saude_pct))}
              nota={`${t('Mínimo', 'Minimum')} ${pct(fr(a.min_saude), 0)} · ${situacao(num(a.saude_pct), num(a.min_saude), 'min')}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saude()}</Dica>} />
            <Kpi rotulo={t('Aplicação em educação (MDE)', 'Education spending (MDE)')} valor={pct(fr(a.mde_pct))}
              nota={`${t('Mínimo', 'Minimum')} 25% · ${situacao(num(a.mde_pct), 25, 'min')}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.mde()}</Dica>} />
            <Kpi rotulo={t('FUNDEB na remuneração', 'FUNDEB on education pay')} valor={pct(fr(a.fundeb_pct))}
              nota={`${t('Mínimo', 'Minimum')} ${pct(fr(a.min_fundeb), 0)} · ${situacao(num(a.fundeb_pct), num(a.min_fundeb), 'min')}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.fundeb()}</Dica>} />
            <Kpi rotulo={t('Resultado primário', 'Primary balance')} valor={reais(num(a.resultado_primario))}
              nota={`${t('Meta da LDO', 'LDO target')}: ${reais(num(a.meta_primario))}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.primario()}</Dica>} />
            <Kpi rotulo={t('Receita corrente líquida', 'Net current revenue')} valor={reais(num(a.rcl))}
              nota={a.rcl_ajustada ? `${t('Ajustada', 'Adjusted')}: ${reais(num(a.rcl_ajustada))}` : undefined} />
          </div>
        </>
      )}
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Pessoal e dívida em % da RCL', 'Personnel and debt as % of RCL')}
            desc={t('Executivo; limite de pessoal como declarado', 'Executive; personnel limit as reported')}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.pessoal()} {formulas.dcl()}</Dica>}
            tabela={<TabelaSerie nome="lrf_pessoal_divida" anos={anos} colunas={[
              { titulo: t('Pessoal ÷ RCL', 'Personnel ÷ RCL'), valores: s.map((r) => fr(r.pessoal_rcl_pct)), formato: (v) => pct(v) },
              { titulo: t('Limite', 'Limit'), valores: s.map((r) => fr(r.pessoal_limite_pct)), formato: (v) => pct(v) },
              { titulo: t('Despesa com pessoal', 'Personnel expenditure'), valores: s.map((r) => num(r.despesa_pessoal)), formato: reais },
              { titulo: 'RCL', valores: s.map((r) => num(r.rcl)), formato: reais },
              { titulo: t('DCL ÷ RCL', 'DCL ÷ RCL'), valores: s.map((r) => fr(r.dcl_rcl_pct)), formato: (v) => pct(v) },
              { titulo: 'DCL', valores: s.map((r) => num(r.dcl)), formato: reais },
            ]} metadados={[[t('Fonte', 'Source'), fonteLrf()]]} />}>
            <Grafico opcao={opcaoPessoal} nome="lrf_pessoal_divida" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Saúde, educação e FUNDEB', 'Health, education and FUNDEB')}
            desc={t('% aplicado, como declarado no RREO', '% spent, as reported in the RREO')}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saude()} {formulas.mde()} {formulas.fundeb()}</Dica>}
            tabela={<TabelaSerie nome="lrf_minimos" anos={anos} colunas={[
              { titulo: t('Saúde', 'Health'), valores: s.map((r) => fr(r.saude_pct)), formato: (v) => pct(v) },
              { titulo: t('Educação (MDE)', 'Education (MDE)'), valores: s.map((r) => fr(r.mde_pct)), formato: (v) => pct(v) },
              { titulo: 'FUNDEB', valores: s.map((r) => fr(r.fundeb_pct)), formato: (v) => pct(v) },
              { titulo: t('Resultado primário', 'Primary balance'), valores: s.map((r) => num(r.resultado_primario)), formato: reais },
              { titulo: t('Meta da LDO', 'LDO target'), valores: s.map((r) => num(r.meta_primario)), formato: reais },
            ]} metadados={[[t('Fonte', 'Source'), fonteLrf()]]} />}>
            <Grafico opcao={opcaoMinimos} nome="lrf_minimos" />
          </CartaoGrafico>
        </div>
      )}
    </>
  );
}

type ColunaEntes = { campo: string; titulo: string; formato: (v: unknown) => string; valor: (r: Linha) => number | string | null };

function LrfGrupo({ esfera, uf }: { esfera: 'M' | 'E'; uf?: string }) {
  const f = useFiltros();
  const grupo = useApi<Linha[]>('lrf_grupo', { esfera, uf });
  const entes = useApi<Linha[]>('lrf_entes', { esfera, uf, ano: f.ano });
  const [ordem, setOrdem] = useState<{ campo: string; desc: boolean }>({ campo: 'pessoal_rcl_pct', desc: true });
  const [todos, setTodos] = useState(false);
  const s = grupo.dados ?? [];
  const anos = s.map((r) => r.exercicio as number);
  const a = s.find((r) => r.exercicio === f.ano);
  const de = (n: unknown, total: unknown) => `${numero(num(n))} ${t('de', 'of')} ${numero(num(total))}`;

  const opcao = useMemo(() => linhas(anos, [
    { nome: t('Pessoal ÷ RCL (agregado)', 'Personnel ÷ RCL (aggregate)'), valores: s.map((r) => num(r.pessoal_rcl)) },
    { nome: t('Pessoal ÷ RCL (mediana)', 'Personnel ÷ RCL (median)'), valores: s.map((r) => num(r.pessoal_mediana)) },
    { nome: t('Saúde (mediana)', 'Health (median)'), valores: s.map((r) => num(r.saude_mediana)) },
    { nome: t('Educação (mediana)', 'Education (median)'), valores: s.map((r) => num(r.mde_mediana)) },
  ], pctEixo), [grupo.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  const colunas: ColunaEntes[] = [
    { campo: 'pessoal_rcl_pct', titulo: t('Pessoal ÷ RCL', 'Personnel ÷ RCL'), formato: (v) => pct(fr(v)), valor: (r) => num(r.pessoal_rcl_pct) },
    { campo: 'dcl_rcl_pct', titulo: t('DCL ÷ RCL', 'DCL ÷ RCL'), formato: (v) => pct(fr(v)), valor: (r) => num(r.dcl_rcl_pct) },
    { campo: 'saude_pct', titulo: t('Saúde', 'Health'), formato: (v) => pct(fr(v)), valor: (r) => num(r.saude_pct) },
    { campo: 'mde_pct', titulo: t('Educação (MDE)', 'Education (MDE)'), formato: (v) => pct(fr(v)), valor: (r) => num(r.mde_pct) },
    { campo: 'fundeb_pct', titulo: 'FUNDEB', formato: (v) => pct(fr(v)), valor: (r) => num(r.fundeb_pct) },
    { campo: 'resultado_primario', titulo: t('Resultado primário', 'Primary balance'), formato: (v) => reais(num(v)), valor: (r) => num(r.resultado_primario) },
    { campo: 'rcl', titulo: 'RCL', formato: (v) => reais(num(v)), valor: (r) => num(r.rcl) },
  ];
  const ordenados = useMemo(() => {
    const c = colunas.find((x) => x.campo === ordem.campo) ?? colunas[0];
    return [...(entes.dados ?? [])].sort((x, y) => {
      const vx = c.valor(x);
      const vy = c.valor(y);
      if (vx === null) return 1;
      if (vy === null) return -1;
      return (Number(vx) - Number(vy)) * (ordem.desc ? -1 : 1);
    });
  }, [entes.dados, ordem]); // eslint-disable-line react-hooks/exhaustive-deps
  const visiveis = todos ? ordenados : ordenados.slice(0, 50);
  const escopo = esfera === 'E' ? t('Estados', 'States') : uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil');

  return (
    <>
      <Estado carregando={grupo.carregando} erro={grupo.erro} tentarNovamente={grupo.recarregar} />
      {a && (
        <>
          <h3 className="secao">{t(`Exercício de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
          <p className="cobertura">
            {t(`${numero(num(a.com_rreo))} entes com RREO e ${numero(num(a.com_rgf))} com RGF, de ${numero(num(a.entes))} no recorte.`,
              `${numero(num(a.com_rreo))} governments with RREO and ${numero(num(a.com_rgf))} with RGF, out of ${numero(num(a.entes))} in scope.`)}
          </p>
          <div className="kpis">
            <Kpi rotulo={t('Pessoal ÷ RCL', 'Personnel ÷ RCL')} valor={pct(num(a.pessoal_rcl))}
              nota={`${t('Mediana', 'Median')} ${pct(num(a.pessoal_mediana))} · ${t('acima do limite', 'above the limit')}: ${de(a.pessoal_acima_limite, a.n_pessoal)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.pessoal()}</Dica>} />
            <Kpi rotulo={t('Acima do limite prudencial de pessoal', 'Above the prudential personnel limit')}
              valor={de(a.pessoal_acima_prudencial, a.n_pessoal)} nota={t('95% do limite máximo', '95% of the maximum limit')} />
            <Kpi rotulo={t('DCL ÷ RCL', 'DCL ÷ RCL')} valor={pct(num(a.dcl_rcl))}
              nota={`${t('Mediana', 'Median')} ${pct(num(a.dcl_mediana))} · ${t('acima do limite', 'above the limit')}: ${de(a.dcl_acima_limite, a.n_dcl)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.dcl()}</Dica>} />
            <Kpi rotulo={t('Saúde (mediana)', 'Health (median)')} valor={pct(num(a.saude_mediana))}
              nota={`${t('abaixo do mínimo', 'below the minimum')}: ${de(a.saude_abaixo, a.n_saude)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saude()}</Dica>} />
            <Kpi rotulo={t('Educação MDE (mediana)', 'Education MDE (median)')} valor={pct(num(a.mde_mediana))}
              nota={`${t('abaixo do mínimo', 'below the minimum')}: ${de(a.mde_abaixo, a.n_mde)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.mde()}</Dica>} />
            <Kpi rotulo={t('FUNDEB na remuneração (mediana)', 'FUNDEB on pay (median)')} valor={pct(num(a.fundeb_mediana))}
              nota={`${t('abaixo do mínimo', 'below the minimum')}: ${de(a.fundeb_abaixo, a.n_fundeb)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.fundeb()}</Dica>} />
            <Kpi rotulo={t('Resultado primário (soma)', 'Primary balance (sum)')} valor={reais(num(a.resultado_primario))}
              nota={`${t('com déficit', 'in deficit')}: ${de(a.primario_deficit, a.n_primario)} · ${t('cumpriram a meta', 'met the target')}: ${de(a.meta_cumprida, a.n_meta)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.primario()}</Dica>} />
          </div>
        </>
      )}
      {s.length > 0 && (
        <CartaoGrafico titulo={t('Evolução', 'Trends')}
          desc={t('Pessoal: soma ÷ soma e mediana; saúde e educação: mediana dos percentuais declarados', 'Personnel: sum ÷ sum and median; health and education: median of reported percentages')}
          tabela={<TabelaSerie nome="lrf_grupo" anos={anos} colunas={[
            { titulo: t('Entes com RGF', 'Governments with RGF'), valores: s.map((r) => num(r.com_rgf)), formato: numero },
            { titulo: t('Pessoal ÷ RCL (agregado)', 'Personnel ÷ RCL (aggregate)'), valores: s.map((r) => num(r.pessoal_rcl)), formato: (v) => pct(v) },
            { titulo: t('Pessoal acima do limite', 'Personnel above limit'), valores: s.map((r) => num(r.pessoal_acima_limite)), formato: numero },
            { titulo: t('DCL ÷ RCL (agregado)', 'DCL ÷ RCL (aggregate)'), valores: s.map((r) => num(r.dcl_rcl)), formato: (v) => pct(v) },
            { titulo: t('Saúde (mediana)', 'Health (median)'), valores: s.map((r) => num(r.saude_mediana)), formato: (v) => pct(v) },
            { titulo: t('Saúde abaixo do mínimo', 'Health below minimum'), valores: s.map((r) => num(r.saude_abaixo)), formato: numero },
            { titulo: t('MDE (mediana)', 'MDE (median)'), valores: s.map((r) => num(r.mde_mediana)), formato: (v) => pct(v) },
            { titulo: t('MDE abaixo do mínimo', 'MDE below minimum'), valores: s.map((r) => num(r.mde_abaixo)), formato: numero },
            { titulo: t('Resultado primário (soma)', 'Primary balance (sum)'), valores: s.map((r) => num(r.resultado_primario)), formato: reais },
          ]} metadados={[[t('Recorte', 'Scope'), escopo], [t('Fonte', 'Source'), fonteLrf()]]} />}>
          <Grafico opcao={opcao} nome="lrf_grupo" />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t(`${escopo} em ${f.ano}`, `${escopo} in ${f.ano}`)}</h3>
            <p className="desc">{t('Clique no título de uma coluna para ordenar. Percentuais como declarados.', 'Click a column header to sort. Percentages as reported.')}</p>
          </div>
          <BotoesExportar nome={`lrf_${f.ano}`} obter={() => ({
            colunas: ['cod_ibge', t('Ente', 'Government'), 'UF', t('RREO entregue', 'RREO filed'), t('RGF entregue', 'RGF filed'),
              'RCL', t('RCL ajustada', 'Adjusted RCL'), t('Despesa com pessoal', 'Personnel expenditure'), t('Pessoal ÷ RCL (%)', 'Personnel ÷ RCL (%)'),
              t('Limite de pessoal (%)', 'Personnel limit (%)'), t('Dívida consolidada', 'Consolidated debt'), 'DCL', t('DCL ÷ RCL (%)', 'DCL ÷ RCL (%)'),
              t('Saúde (%)', 'Health (%)'), t('MDE (%)', 'MDE (%)'), t('FUNDEB (%)', 'FUNDEB (%)'), t('Resultado primário', 'Primary balance'),
              t('Meta da LDO', 'LDO target'), t('Resultado nominal', 'Nominal balance')],
            linhas: ordenados.map((r) => [r.cod_ibge, r.nome, r.uf, r.rreo_tipo, r.rgf_tipo, r.rcl, r.rcl_ajustada, r.despesa_pessoal, r.pessoal_rcl_pct,
              r.pessoal_limite_pct, r.divida_consolidada, r.dcl, r.dcl_rcl_pct, r.saude_pct, r.mde_pct, r.fundeb_pct, r.resultado_primario,
              r.meta_primario, r.resultado_nominal]),
            metadados: [[t('Recorte', 'Scope'), escopo], [t('Exercício', 'Fiscal year'), String(f.ano)], [t('Fonte', 'Source'), fonteLrf()],
              [t('Unidade', 'Unit'), t('R$ correntes; percentuais em pontos (48,5 = 48,5%)', 'current R$; percentages in points (48.5 = 48.5%)')]],
          })} />
        </div>
        <Estado carregando={entes.carregando} erro={entes.erro} tentarNovamente={entes.recarregar}
          vazio={!entes.carregando && !ordenados.length && t('Nenhum ente com RREO/RGF neste exercício.', 'No government with RREO/RGF in this year.')} />
        {ordenados.length > 0 && (
          <>
            <div className="rolagem">
              <table>
                <thead>
                  <tr>
                    <th>{t('Ente', 'Government')}</th>
                    {colunas.map((c) => (
                      <th key={c.campo} aria-sort={ordem.campo === c.campo ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
                        <button className="valor-exato" onClick={() => setOrdem({ campo: c.campo, desc: ordem.campo === c.campo ? !ordem.desc : true })}>
                          {c.titulo}{ordem.campo === c.campo ? (ordem.desc ? ' ▼' : ' ▲') : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r) => (
                    <tr key={String(r.cod_ibge)}>
                      <td>{String(r.nome)}{esfera === 'M' ? ` (${r.uf})` : ''}</td>
                      {colunas.map((c) => <td key={c.campo}>{c.formato(r[c.campo])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {ordenados.length > 50 && (
              <p className="legenda-tabela">
                {todos ? '' : t(`Mostrando 50 de ${numero(ordenados.length)}. `, `Showing 50 of ${numero(ordenados.length)}. `)}
                <button className="limpar" onClick={() => setTodos(!todos)}>{todos ? t('mostrar menos', 'show fewer') : t('mostrar todos', 'show all')}</button>
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}

// ---------------- demonstrativos (anexos completos) ----------------

type LinhaAnexo = { ordem: number; rotulo: string; cod_conta: string; conta: string; coluna: string; valor: number | null };
type Anexo = { relatorio: string; anexo: string; tipo: string; periodicidade: string; linhas: number };

/** Colunas mensais (<MR-11> … <MR>) viram "mês de referência −11" … "mês de referência". */
const rotuloColuna = (c: string) => {
  const m = /^<MR(?:-(\d+))?>$/.exec(c);
  if (!m) return c;
  return m[1] ? t(`Mês ref. −${m[1]}`, `Ref. month −${m[1]}`) : t('Mês de referência', 'Reference month');
};

export function LrfDemonstrativos() {
  const { meta } = useDados();
  const f = useFiltros();
  const fonte = meta.fontes.siconfi_lrf as { exercicios?: number[] } | undefined;
  const anosLrf = fonte?.exercicios ?? [];
  const ano = anosLrf.includes(f.ano) ? f.ano : anosLrf.at(-1);
  const ente = f.alvo?.cod_ibge;
  const anexos = useApi<Anexo[]>(ente && ano ? 'lrf_anexos' : null, { ente, ano });
  const [escolha, setEscolha] = useState('');
  const lista = anexos.dados ?? [];
  const atual = lista.find((x) => `${x.relatorio}|${x.anexo}` === escolha) ?? lista[0];
  const dados = useApi<LinhaAnexo[]>(atual && ente ? 'lrf_anexo' : null, { ente, ano, relatorio: atual?.relatorio, anexo: atual?.anexo });

  // tabela larga: uma linha por conta (na ordem do relatório) e uma coluna por coluna do anexo
  const { colunas, contas } = useMemo(() => {
    const cols: string[] = [];
    const porConta = new Map<string, { rotulo: string; cod: string; conta: string; valores: Record<string, number | null> }>();
    for (const l of dados.dados ?? []) {
      if (!cols.includes(l.coluna)) cols.push(l.coluna);
      const chave = `${l.rotulo}|${l.cod_conta}|${l.conta}`;
      if (!porConta.has(chave)) porConta.set(chave, { rotulo: l.rotulo, cod: l.cod_conta, conta: l.conta, valores: {} });
      porConta.get(chave)!.valores[l.coluna] = l.valor;
    }
    return { colunas: cols, contas: [...porConta.values()] };
  }, [dados.dados]);
  const mostrarRotulo = new Set(contas.map((c) => c.rotulo)).size > 1;
  const formatar = (v: number | null | undefined, coluna: string) =>
    v === null || v === undefined ? '–' : v.toLocaleString(local(), { maximumFractionDigits: 2, minimumFractionDigits: /%/.test(coluna) ? 2 : 0 });

  return (
    <>
      <h2 className="titulo-pagina">{t('Demonstrativos RREO e RGF', 'RREO and RGF statements')}</h2>
      <p className="subtitulo">
        {f.alvo ? f.rotulo : t('Escolha um ente', 'Choose a government')} · {t('fechamento do exercício, como entregue ao SICONFI', 'year-end, as filed with SICONFI')}
        {' '}<Dica rotulo={t('Fonte', 'Source')}>{fonteLrf()}</Dica>
      </p>
      <BarraFiltros />
      {!fonte && <p className="vazio">{t('Os dados do RREO e do RGF ainda não foram publicados.', 'RREO and RGF data have not been published yet.')}</p>}
      {fonte && !f.alvo && (
        <p className="aviso">{t('Escolha um município, estado ou o DF no filtro acima para ver os anexos completos.', 'Choose a municipality, state or the Federal District in the filter above to see the full annexes.')}</p>
      )}
      {fonte && f.alvo && ano !== f.ano && <AvisoAnos ano={f.ano} anos={anosLrf} />}
      {fonte && f.alvo && ano && (
        <>
          <Estado carregando={anexos.carregando} erro={anexos.erro} tentarNovamente={anexos.recarregar}
            vazio={!anexos.carregando && !lista.length && t(`Sem RREO nem RGF de ${ano} para este ente.`, `No RREO or RGF for ${ano} for this government.`)} />
          {lista.length > 0 && (
            <section className="cartao">
              <div className="cabeca-cartao">
                <div className="campo">
                  <label htmlFor="anexo-lrf">{t(`Anexo (${ano})`, `Annex (${ano})`)}</label>
                  <select id="anexo-lrf" value={atual ? `${atual.relatorio}|${atual.anexo}` : ''} onChange={(e) => setEscolha(e.target.value)}>
                    {lista.map((x) => (
                      <option key={`${x.relatorio}|${x.anexo}`} value={`${x.relatorio}|${x.anexo}`}>
                        {x.anexo} · {x.tipo}{x.relatorio === 'RGF' ? ` (${x.periodicidade === 'S' ? t('semestral', 'six-month') : t('quadrimestral', 'four-month')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                {contas.length > 0 && (
                  <BotoesExportar nome={`${atual?.anexo ?? 'anexo'}_${ente}_${ano}`.replace(/\s+/g, '_')} obter={() => ({
                    colunas: [...(mostrarRotulo ? [t('Rótulo', 'Label')] : []), t('Código da conta', 'Account code'), t('Conta', 'Account'), ...colunas],
                    linhas: contas.map((c) => [...(mostrarRotulo ? [c.rotulo] : []), c.cod, c.conta, ...colunas.map((col) => c.valores[col] ?? null)]),
                    metadados: [[t('Ente', 'Government'), f.rotulo], [t('Exercício', 'Fiscal year'), String(ano)],
                      [t('Demonstrativo', 'Statement'), `${atual?.anexo} · ${atual?.tipo}`], [t('Fonte', 'Source'), fonteLrf()]],
                  })} />
                )}
              </div>
              <Estado carregando={dados.carregando} erro={dados.erro} tentarNovamente={dados.recarregar} />
              {contas.length > 0 && (
                <div className="rolagem">
                  <table className="lrf-anexo">
                    <thead>
                      <tr>
                        {mostrarRotulo && <th>{t('Rótulo', 'Label')}</th>}
                        <th>{t('Conta', 'Account')}</th>
                        {colunas.map((c) => <th key={c} title={c}>{rotuloColuna(c)}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {contas.map((c, i) => (
                        <tr key={i}>
                          {mostrarRotulo && <td className="regra">{c.rotulo}</td>}
                          <td className="lrf-conta" title={c.cod}>{c.conta}</td>
                          {colunas.map((col) => <td key={col}>{formatar(c.valores[col], col)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
