import { useMemo, useState, type ReactNode } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { numero, pct, reais, reaisCurto } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';

const pctEixo = (v: number) => pct(v, 0);
/** Percentual declarado (25,74) como fração (0,2574), o formato do pct(). */
const fr = (v: unknown) => (typeof v === 'number' ? v / 100 : null);
const porHab = (v: unknown, pop: unknown) => (typeof v === 'number' && typeof pop === 'number' && pop > 0 ? v / pop : null);

const fonteSiope = () => t(
  'SIOPE/FNDE (dados abertos): declaração anual do ente sobre receitas e despesas com educação; de 2017 em diante, o 6º bimestre. Indicadores como calculados pelo SIOPE.',
  'SIOPE/FNDE (open data): each government’s annual return on education revenue and spending; from 2017 on, the 6th two-month period. Indicators as computed by SIOPE.',
);
const fonteSiops = () => t(
  'SIOPS/DATASUS (série histórica de indicadores municipais): declaração anual do município sobre receitas e despesas com saúde. Indicadores como calculados pelo SIOPS. O DF e os estados não estão nesta série.',
  'SIOPS/DATASUS (municipal indicator series): each municipality’s annual return on health revenue and spending. Indicators as computed by SIOPS. The Federal District and the states are not in this series.',
);
const notaReais = (base: number) => t(`R$ de ${base}, corrigidos pelo IPCA`, `${base} R$, IPCA-adjusted`);

const formulas = {
  mde: () => t(
    'Despesa em manutenção e desenvolvimento do ensino ÷ receita de impostos e transferências vinculadas à educação, como declarado no SIOPE. Mínimo constitucional: 25% (art. 212). A EC 119/2022 dispensou de sanção quem ficou abaixo em 2020 e 2021.',
    'Maintenance and development of education spending ÷ tax and transfer revenue earmarked for education, as reported in SIOPE. Constitutional minimum: 25% (art. 212). Constitutional Amendment 119/2022 waived penalties for 2020 and 2021.',
  ),
  fundeb: () => t(
    'Parcela do FUNDEB aplicada na remuneração: dos profissionais do magistério até 2020 (mínimo de 60%) e dos profissionais da educação desde 2021 (mínimo de 70%, Lei 14.113/2020).',
    'Share of FUNDEB spent on pay: teaching staff until 2020 (minimum 60%) and education professionals since 2021 (minimum 70%, Law 14,113/2020).',
  ),
  aluno: () => t(
    'Investimento educacional por aluno, como calculado pelo SIOPE: despesa da etapa ÷ matrículas da rede no Censo Escolar.',
    'Education spending per pupil, as computed by SIOPE: spending on the stage ÷ enrolments in the network (School Census).',
  ),
  educacaoHab: () => t(
    'Despesa liquidada em educação declarada no SIOPE ÷ população informada na declaração. Em grupos: soma ÷ soma, só dos entes com os dois valores.',
    'Education spending (liquidated) reported in SIOPE ÷ population in the return. For groups: sum ÷ sum, only for governments with both values.',
  ),
  saude: () => t(
    'Receita própria aplicada em ações e serviços públicos de saúde ÷ receita de impostos e transferências constitucionais (EC 29 e LC 141/2012). Mínimo: 15% nos municípios.',
    'Own revenue spent on public health actions and services ÷ tax and constitutional transfer revenue (Constitutional Amendment 29 and Supplementary Law 141/2012). Minimum: 15% for municipalities.',
  ),
  saudeHab: () => t(
    'Despesa total com saúde (todas as fontes), despesa com recursos próprios e receita de transferências do SUS, por habitante. Em grupos: soma ÷ soma da população, só dos municípios com os dois valores.',
    'Total health spending (all sources), spending from own resources and SUS transfer revenue, per inhabitant. For groups: sum ÷ sum of population, only for municipalities with both values.',
  ),
};

/** Situação em relação a um mínimo legal. */
const frenteAoMinimo = (v: number | null, min: number | null) =>
  v === null || min === null ? '' : v < min ? t('abaixo do mínimo', 'below the minimum') : t('cumpre o mínimo', 'meets the minimum');

const de = (n: unknown, total: unknown) => `${numero(num(n))} ${t('de', 'of')} ${numero(num(total))}`;

function AvisoAno({ ano, anos, fonte }: { ano: number; anos: number[]; fonte: string }) {
  if (!anos.length || anos.includes(ano)) return null;
  return (
    <p className="aviso" role="status">
      {t(`O ${fonte} processado vai de ${anos[0]} a ${anos.at(-1)}; ${ano} não tem dados.`,
        `The processed ${fonte} covers ${anos[0]} to ${anos.at(-1)}; ${ano} has no data.`)}
    </p>
  );
}

/** Cabeçalho, filtros e escolha entre ente e grupo, comum às páginas de saúde e educação. */
function Pagina({ titulo, fonte, sigla, soMunicipios, ente, grupo }: {
  titulo: string; fonte: string; sigla: 'siope' | 'siops'; soMunicipios?: boolean;
  ente: (cod: number) => ReactNode; grupo: (esfera: 'M' | 'E', uf?: string) => ReactNode;
}) {
  const { meta } = useDados();
  const f = useFiltros();
  const [esfera, setEsfera] = useState<'M' | 'E'>('M');
  const dados = meta.fontes[sigla] as { anos?: number[] } | undefined;
  const nome = sigla.toUpperCase();
  if (!dados) {
    return (
      <>
        <h2 className="titulo-pagina">{titulo}</h2>
        <p className="vazio">{t(`Os dados do ${nome} ainda não foram publicados.`, `${nome} data have not been published yet.`)}</p>
      </>
    );
  }
  const esferaGrupo = soMunicipios || f.uf ? 'M' : esfera;
  return (
    <>
      <h2 className="titulo-pagina">{titulo}</h2>
      <p className="subtitulo">
        {f.alvo ? f.rotulo : esferaGrupo === 'E' ? t('Estados', 'States') : f.uf ? t(`Municípios de ${f.uf}`, `Municipalities in ${f.uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil')}
        {' · '}{nome} <Dica rotulo={t('Fonte', 'Source')}>{fonte}</Dica>
      </p>
      <BarraFiltros />
      {!soMunicipios && !f.alvo && !f.uf && (
        <div className="alternar" role="group" aria-label={t('Esfera', 'Level')} style={{ marginBottom: 14 }}>
          <button className={esfera === 'M' ? 'ativo' : ''} onClick={() => setEsfera('M')}>{t('Municípios', 'Municipalities')}</button>
          <button className={esfera === 'E' ? 'ativo' : ''} onClick={() => setEsfera('E')}>{t('Estados e DF', 'States and DF')}</button>
        </div>
      )}
      <AvisoAno ano={f.ano} anos={dados.anos ?? []} fonte={nome} />
      {soMunicipios && f.alvo && f.alvo.esfera !== 'M'
        ? <p className="aviso">{t('A série do SIOPS carregada aqui é só de municípios. Escolha um município, ou limpe o filtro para ver os municípios do estado.',
          'The SIOPS series loaded here covers municipalities only. Choose a municipality, or clear the filter to see the state’s municipalities.')}</p>
        : f.alvo ? ente(f.alvo.cod_ibge) : grupo(esferaGrupo, f.uf ?? undefined)}
    </>
  );
}

type ColunaEntes = { campo: string; titulo: string; formato: (v: number | null) => string; valor: (r: Linha) => number | null; exportar?: string };

/** Entes do grupo no ano, ordenáveis por coluna, com exportação. */
function TabelaEntes({ linhas: dados, carregando, erro, recarregar, colunas, esfera, escopo, nome, metadados }: {
  linhas: Linha[]; carregando: boolean; erro?: string; recarregar: () => void; colunas: ColunaEntes[];
  esfera: 'M' | 'E'; escopo: string; nome: string; metadados: [string, string][];
}) {
  const f = useFiltros();
  const [ordem, setOrdem] = useState({ campo: colunas[0].campo, desc: true });
  const [todos, setTodos] = useState(false);
  const ordenados = useMemo(() => {
    const c = colunas.find((x) => x.campo === ordem.campo) ?? colunas[0];
    return [...dados].sort((x, y) => {
      const vx = c.valor(x);
      const vy = c.valor(y);
      if (vx === null) return 1;
      if (vy === null) return -1;
      return (vx - vy) * (ordem.desc ? -1 : 1);
    });
  }, [dados, ordem]); // eslint-disable-line react-hooks/exhaustive-deps
  const visiveis = todos ? ordenados : ordenados.slice(0, 50);
  return (
    <section className="cartao">
      <div className="cabeca-cartao">
        <div>
          <h3>{t(`${escopo} em ${f.ano}`, `${escopo} in ${f.ano}`)}</h3>
          <p className="desc">{t('Clique no título de uma coluna para ordenar.', 'Click a column header to sort.')}</p>
        </div>
        <BotoesExportar nome={`${nome}_${f.ano}`} obter={() => ({
          colunas: ['cod_ibge', t('Ente', 'Government'), 'UF', ...colunas.map((c) => c.exportar ?? c.titulo)],
          linhas: ordenados.map((r) => [r.cod_ibge, r.nome, r.uf, ...colunas.map((c) => c.valor(r))]),
          metadados: [[t('Recorte', 'Scope'), escopo], [t('Ano', 'Year'), String(f.ano)], ...metadados],
        })} />
      </div>
      <Estado carregando={carregando} erro={erro} tentarNovamente={recarregar}
        vazio={!carregando && !ordenados.length && t('Nenhum ente com dados neste ano.', 'No government with data in this year.')} />
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
                    {colunas.map((c) => <td key={c.campo}>{c.formato(c.valor(r))}</td>)}
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
  );
}

const escopoDe = (esfera: 'M' | 'E', uf?: string) =>
  esfera === 'E' ? t('Estados e DF', 'States and DF') : uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil');

// ---------------- educação (SIOPE) ----------------

export function Educacao() {
  return (
    <Pagina titulo={t('Educação: gastos e mínimos', 'Education: spending and minimums')} fonte={fonteSiope()} sigla="siope"
      ente={(cod) => <EducacaoEnte cod={cod} />} grupo={(esfera, uf) => <EducacaoGrupo esfera={esfera} uf={uf} />} />
  );
}

function EducacaoEnte({ cod }: { cod: number }) {
  const { meta } = useDados();
  const f = useFiltros();
  const serie = useApi<Linha[]>('se_ente', { ente: cod });
  const s = (serie.dados ?? []).filter((r) => r.mde_pct !== null || r.aluno_basica !== null);
  const anos = s.map((r) => r.ano as number);
  const a = s.find((r) => r.ano === f.ano);
  const reaisBase = notaReais(meta.baseIpca);

  const opcaoMinimos = useMemo(() => linhas(anos, [
    { nome: t('MDE', 'MDE'), valores: s.map((r) => fr(r.mde_pct)) },
    { nome: t('FUNDEB na remuneração', 'FUNDEB on pay'), valores: s.map((r) => fr(r.fundeb_remuneracao_pct)) },
    { nome: t('Educação na despesa total', 'Education in total spending'), valores: s.map((r) => fr(r.educacao_despesa_pct)) },
  ], pctEixo), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoAluno = useMemo(() => linhas(anos, [
    { nome: t('Educação básica', 'Basic education'), valores: s.map((r) => num(r.aluno_basica)) },
    { nome: t('Educação infantil', 'Early childhood'), valores: s.map((r) => num(r.aluno_infantil)) },
    { nome: t('Ensino fundamental', 'Primary/lower secondary'), valores: s.map((r) => num(r.aluno_fundamental)) },
    { nome: t('Professores (básica)', 'Teachers (basic)'), valores: s.map((r) => num(r.professores_aluno)) },
  ], reaisCurto), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoEtapas = useMemo(() => linhas(anos, [
    { nome: t('Educação infantil', 'Early childhood'), valores: s.map((r) => fr(r.infantil_pct)) },
    { nome: t('Ensino fundamental', 'Primary/lower secondary'), valores: s.map((r) => fr(r.fundamental_pct)) },
    { nome: t('Ensino médio', 'Upper secondary'), valores: s.map((r) => fr(r.medio_pct)) },
  ], pctEixo), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const metadados: [string, string][] = [[t('Ente', 'Government'), f.rotulo], [t('Fonte', 'Source'), fonteSiope()], [t('Valores', 'Values'), reaisBase]];

  return (
    <>
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !s.length && t('Este ente não tem declarações no SIOPE.', 'This government has no SIOPE returns.')} />
      {a && (
        <>
          <h3 className="secao">{t(`Ano de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
          <div className="kpis">
            <Kpi rotulo={t('Aplicação em MDE', 'Spending on MDE')} valor={pct(fr(a.mde_pct))}
              nota={`${t('Mínimo', 'Minimum')} 25% · ${frenteAoMinimo(num(a.mde_pct), 25)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.mde()}</Dica>} />
            <Kpi rotulo={t('FUNDEB na remuneração', 'FUNDEB on pay')} valor={pct(fr(a.fundeb_remuneracao_pct))}
              nota={`${t('Mínimo', 'Minimum')} ${a.min_fundeb}% · ${frenteAoMinimo(num(a.fundeb_remuneracao_pct), num(a.min_fundeb))}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.fundeb()}</Dica>} />
            <Kpi rotulo={t('Educação na despesa total', 'Education in total spending')} valor={pct(fr(a.educacao_despesa_pct))}
              nota={t('despesas de todas as áreas', 'spending across all areas')} />
            <Kpi rotulo={t('Investimento por aluno (educação básica)', 'Spending per pupil (basic education)')} valor={reais(num(a.aluno_basica))}
              nota={reaisBase} dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.aluno()}</Dica>} />
            <Kpi rotulo={t('Despesa com professores por aluno', 'Teacher spending per pupil')} valor={reais(num(a.professores_aluno))} nota={reaisBase} />
            <Kpi rotulo={t('Despesa com educação por habitante', 'Education spending per inhabitant')}
              valor={reais(porHab(a.educacao_liquidada, a.populacao_siope))} nota={reaisBase}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.educacaoHab()}</Dica>} />
          </div>
        </>
      )}
      {s.length > 0 && (
        <>
          <div className="grade-2">
            <CartaoGrafico titulo={t('Mínimos e peso da educação', 'Minimums and weight of education')}
              desc={t('% como declarado no SIOPE', '% as reported in SIOPE')}
              acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.mde()} {formulas.fundeb()}</Dica>}
              tabela={<TabelaSerie nome="educacao_minimos" anos={anos} colunas={[
                { titulo: 'MDE', valores: s.map((r) => fr(r.mde_pct)), formato: (v) => pct(v) },
                { titulo: t('FUNDEB na remuneração', 'FUNDEB on pay'), valores: s.map((r) => fr(r.fundeb_remuneracao_pct)), formato: (v) => pct(v) },
                { titulo: t('Mínimo do FUNDEB', 'FUNDEB minimum'), valores: s.map((r) => fr(r.min_fundeb)), formato: (v) => pct(v, 0) },
                { titulo: t('Educação na despesa total', 'Education in total spending'), valores: s.map((r) => fr(r.educacao_despesa_pct)), formato: (v) => pct(v) },
              ]} metadados={metadados} />}>
              <Grafico opcao={opcaoMinimos} nome="educacao_minimos" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Investimento por aluno', 'Spending per pupil')} desc={reaisBase}
              acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.aluno()}</Dica>}
              tabela={<TabelaSerie nome="educacao_por_aluno" anos={anos} colunas={[
                { titulo: t('Educação básica', 'Basic education'), valores: s.map((r) => num(r.aluno_basica)), formato: reais },
                { titulo: t('Educação infantil', 'Early childhood'), valores: s.map((r) => num(r.aluno_infantil)), formato: reais },
                { titulo: t('Ensino fundamental', 'Primary/lower secondary'), valores: s.map((r) => num(r.aluno_fundamental)), formato: reais },
                { titulo: t('Professores por aluno', 'Teachers per pupil'), valores: s.map((r) => num(r.professores_aluno)), formato: reais },
                { titulo: t('Educação por habitante', 'Education per inhabitant'), valores: s.map((r) => porHab(r.educacao_liquidada, r.populacao_siope)), formato: reais },
              ]} metadados={metadados} />}>
              <Grafico opcao={opcaoAluno} nome="educacao_por_aluno" />
            </CartaoGrafico>
          </div>
          <CartaoGrafico titulo={t('Despesa por etapa de ensino', 'Spending by stage of education')}
            desc={t('% da despesa total com educação', '% of total education spending')}
            tabela={<TabelaSerie nome="educacao_etapas" anos={anos} colunas={[
              { titulo: t('Educação infantil', 'Early childhood'), valores: s.map((r) => fr(r.infantil_pct)), formato: (v) => pct(v) },
              { titulo: t('Ensino fundamental', 'Primary/lower secondary'), valores: s.map((r) => fr(r.fundamental_pct)), formato: (v) => pct(v) },
              { titulo: t('Ensino médio', 'Upper secondary'), valores: s.map((r) => fr(r.medio_pct)), formato: (v) => pct(v) },
            ]} metadados={metadados} />}>
            <Grafico opcao={opcaoEtapas} nome="educacao_etapas" />
          </CartaoGrafico>
        </>
      )}
    </>
  );
}

function EducacaoGrupo({ esfera, uf }: { esfera: 'M' | 'E'; uf?: string }) {
  const { meta } = useDados();
  const f = useFiltros();
  const grupo = useApi<Linha[]>('se_grupo', { esfera, uf });
  const entes = useApi<Linha[]>('se_entes', { esfera, uf, ano: f.ano });
  const s = (grupo.dados ?? []).filter((r) => num(r.n_mde));
  const anos = s.map((r) => r.ano as number);
  const a = s.find((r) => r.ano === f.ano);
  const reaisBase = notaReais(meta.baseIpca);
  const escopo = escopoDe(esfera, uf);

  const opcao = useMemo(() => linhas(anos, [
    { nome: t('MDE (mediana)', 'MDE (median)'), valores: s.map((r) => num(r.mde_mediana)) },
    { nome: t('FUNDEB na remuneração (mediana)', 'FUNDEB on pay (median)'), valores: s.map((r) => num(r.fundeb_mediana)) },
    { nome: t('Educação na despesa total (mediana)', 'Education in total spending (median)'), valores: s.map((r) => num(r.educacao_despesa_mediana)) },
  ], pctEixo), [grupo.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoReais = useMemo(() => linhas(anos, [
    { nome: t('Por aluno, educação básica (mediana)', 'Per pupil, basic education (median)'), valores: s.map((r) => num(r.aluno_basica_mediana)) },
    { nome: t('Por habitante (agregado)', 'Per inhabitant (aggregate)'), valores: s.map((r) => num(r.educacao_hab)) },
  ], reaisCurto), [grupo.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Estado carregando={grupo.carregando} erro={grupo.erro} tentarNovamente={grupo.recarregar} />
      {a && (
        <>
          <h3 className="secao">{t(`Ano de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
          <p className="cobertura">{t(`${numero(num(a.n_mde))} entes com o indicador de MDE declarado, de ${numero(num(a.entes))} no recorte.`,
            `${numero(num(a.n_mde))} governments with the MDE indicator reported, out of ${numero(num(a.entes))} in scope.`)}</p>
          <div className="kpis">
            <Kpi rotulo={t('MDE (mediana)', 'MDE (median)')} valor={pct(num(a.mde_mediana))}
              nota={`${t('abaixo de 25%', 'below 25%')}: ${de(a.mde_abaixo, a.n_mde)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.mde()}</Dica>} />
            <Kpi rotulo={t('FUNDEB na remuneração (mediana)', 'FUNDEB on pay (median)')} valor={pct(num(a.fundeb_mediana))}
              nota={`${t(`abaixo de ${a.min_fundeb}%`, `below ${a.min_fundeb}%`)}: ${de(a.fundeb_abaixo, a.n_fundeb)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.fundeb()}</Dica>} />
            <Kpi rotulo={t('Educação na despesa total (mediana)', 'Education in total spending (median)')} valor={pct(num(a.educacao_despesa_mediana))} />
            <Kpi rotulo={t('Investimento por aluno (mediana)', 'Spending per pupil (median)')} valor={reais(num(a.aluno_basica_mediana))}
              nota={`${t('educação básica', 'basic education')} · ${reaisBase}`} dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.aluno()}</Dica>} />
            <Kpi rotulo={t('Despesa com educação por habitante', 'Education spending per inhabitant')} valor={reais(num(a.educacao_hab))}
              nota={`${t('agregado', 'aggregate')} · ${reaisBase}`} dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.educacaoHab()}</Dica>} />
          </div>
        </>
      )}
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Mínimos e peso da educação', 'Minimums and weight of education')}
            desc={t('Mediana dos percentuais declarados', 'Median of reported percentages')}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.mde()} {formulas.fundeb()}</Dica>}
            tabela={<TabelaSerie nome="educacao_grupo" anos={anos} colunas={[
              { titulo: t('Entes com MDE', 'Governments with MDE'), valores: s.map((r) => num(r.n_mde)), formato: numero },
              { titulo: t('MDE (mediana)', 'MDE (median)'), valores: s.map((r) => num(r.mde_mediana)), formato: (v) => pct(v) },
              { titulo: t('MDE abaixo de 25%', 'MDE below 25%'), valores: s.map((r) => num(r.mde_abaixo)), formato: numero },
              { titulo: t('FUNDEB (mediana)', 'FUNDEB (median)'), valores: s.map((r) => num(r.fundeb_mediana)), formato: (v) => pct(v) },
              { titulo: t('FUNDEB abaixo do mínimo', 'FUNDEB below minimum'), valores: s.map((r) => num(r.fundeb_abaixo)), formato: numero },
              { titulo: t('Educação na despesa (mediana)', 'Education in spending (median)'), valores: s.map((r) => num(r.educacao_despesa_mediana)), formato: (v) => pct(v) },
            ]} metadados={[[t('Recorte', 'Scope'), escopo], [t('Fonte', 'Source'), fonteSiope()]]} />}>
            <Grafico opcao={opcao} nome="educacao_grupo" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Gasto por aluno e por habitante', 'Spending per pupil and per inhabitant')} desc={reaisBase}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.aluno()} {formulas.educacaoHab()}</Dica>}
            tabela={<TabelaSerie nome="educacao_grupo_reais" anos={anos} colunas={[
              { titulo: t('Por aluno, educação básica (mediana)', 'Per pupil, basic education (median)'), valores: s.map((r) => num(r.aluno_basica_mediana)), formato: reais },
              { titulo: t('Professores por aluno (mediana)', 'Teachers per pupil (median)'), valores: s.map((r) => num(r.professores_aluno_mediana)), formato: reais },
              { titulo: t('Educação por habitante (agregado)', 'Education per inhabitant (aggregate)'), valores: s.map((r) => num(r.educacao_hab)), formato: reais },
            ]} metadados={[[t('Recorte', 'Scope'), escopo], [t('Fonte', 'Source'), fonteSiope()], [t('Valores', 'Values'), reaisBase]]} />}>
            <Grafico opcao={opcaoReais} nome="educacao_grupo_reais" />
          </CartaoGrafico>
        </div>
      )}
      <TabelaEntes linhas={entes.dados ?? []} carregando={entes.carregando} erro={entes.erro} recarregar={entes.recarregar}
        esfera={esfera} escopo={escopo} nome="educacao" metadados={[[t('Fonte', 'Source'), fonteSiope()], [t('Valores', 'Values'), reaisBase]]}
        colunas={[
          { campo: 'mde', titulo: 'MDE', exportar: t('MDE (%)', 'MDE (%)'), formato: (v) => pct(fr(v)), valor: (r) => num(r.mde_pct) },
          { campo: 'fundeb', titulo: 'FUNDEB', exportar: t('FUNDEB na remuneração (%)', 'FUNDEB on pay (%)'), formato: (v) => pct(fr(v)), valor: (r) => num(r.fundeb_remuneracao_pct) },
          { campo: 'peso', titulo: t('Na despesa total', 'Of total spending'), exportar: t('Educação na despesa total (%)', 'Education in total spending (%)'), formato: (v) => pct(fr(v)), valor: (r) => num(r.educacao_despesa_pct) },
          { campo: 'aluno', titulo: t('Por aluno', 'Per pupil'), exportar: t('Investimento por aluno, educação básica', 'Spending per pupil, basic education'), formato: reais, valor: (r) => num(r.aluno_basica) },
          { campo: 'professores', titulo: t('Professores por aluno', 'Teachers per pupil'), formato: reais, valor: (r) => num(r.professores_aluno) },
          { campo: 'hab', titulo: t('Por habitante', 'Per inhabitant'), exportar: t('Despesa com educação por habitante', 'Education spending per inhabitant'), formato: reais, valor: (r) => num(r.educacao_hab) },
        ]} />
    </>
  );
}

// ---------------- saúde (SIOPS) ----------------

export function Saude() {
  return (
    <Pagina titulo={t('Saúde: gastos e mínimo', 'Health: spending and minimum')} fonte={fonteSiops()} sigla="siops" soMunicipios
      ente={(cod) => <SaudeEnte cod={cod} />} grupo={(_, uf) => <SaudeGrupo uf={uf} />} />
  );
}

function SaudeEnte({ cod }: { cod: number }) {
  const { meta } = useDados();
  const f = useFiltros();
  const serie = useApi<Linha[]>('se_ente', { ente: cod });
  const s = (serie.dados ?? []).filter((r) => r.saude_pct !== null || r.saude_total !== null);
  const anos = s.map((r) => r.ano as number);
  const a = s.find((r) => r.ano === f.ano);
  const reaisBase = notaReais(meta.baseIpca);

  const opcaoPct = useMemo(() => linhas(anos, [
    { nome: t('Receita própria aplicada em saúde', 'Own revenue spent on health'), valores: s.map((r) => fr(r.saude_pct)) },
    { nome: t('Transferências do SUS na despesa', 'SUS transfers in spending'), valores: s.map((r) => fr(r.sus_despesa_pct)) },
  ], pctEixo), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoHab = useMemo(() => linhas(anos, [
    { nome: t('Despesa total', 'Total spending'), valores: s.map((r) => num(r.saude_hab)) },
    { nome: t('Recursos próprios', 'Own resources'), valores: s.map((r) => num(r.saude_proprios_hab)) },
    { nome: t('Transferências do SUS', 'SUS transfers'), valores: s.map((r) => num(r.sus_hab)) },
  ], reaisCurto), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoComp = useMemo(() => linhas(anos, [
    { nome: t('Pessoal', 'Personnel'), valores: s.map((r) => fr(r.saude_pessoal_pct)) },
    { nome: t('Serviços de terceiros', 'Third-party services'), valores: s.map((r) => fr(r.saude_terceiros_pct)) },
    { nome: t('Medicamentos', 'Medicines'), valores: s.map((r) => fr(r.saude_medicamentos_pct)) },
    { nome: t('Investimentos', 'Investment'), valores: s.map((r) => fr(r.saude_investimentos_pct)) },
  ], pctEixo), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const metadados: [string, string][] = [[t('Ente', 'Government'), f.rotulo], [t('Fonte', 'Source'), fonteSiops()], [t('Valores', 'Values'), reaisBase]];

  return (
    <>
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !s.length && t('Este município não tem declarações no SIOPS.', 'This municipality has no SIOPS returns.')} />
      {a && (
        <>
          <h3 className="secao">{t(`Ano de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
          <div className="kpis">
            <Kpi rotulo={t('Receita própria aplicada em saúde', 'Own revenue spent on health')} valor={pct(fr(a.saude_pct))}
              nota={`${t('Mínimo', 'Minimum')} 15% · ${frenteAoMinimo(num(a.saude_pct), 15)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saude()}</Dica>} />
            <Kpi rotulo={t('Despesa total com saúde por habitante', 'Total health spending per inhabitant')} valor={reais(num(a.saude_hab))}
              nota={reaisBase} dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saudeHab()}</Dica>} />
            <Kpi rotulo={t('Recursos próprios por habitante', 'Own resources per inhabitant')} valor={reais(num(a.saude_proprios_hab))} nota={reaisBase} />
            <Kpi rotulo={t('Transferências do SUS por habitante', 'SUS transfers per inhabitant')} valor={reais(num(a.sus_hab))} nota={reaisBase} />
            <Kpi rotulo={t('Pessoal na despesa com saúde', 'Personnel in health spending')} valor={pct(fr(a.saude_pessoal_pct))} />
            <Kpi rotulo={t('Despesa total com saúde', 'Total health spending')} valor={reais(num(a.saude_total))} nota={reaisBase} />
          </div>
        </>
      )}
      {s.length > 0 && (
        <>
          <div className="grade-2">
            <CartaoGrafico titulo={t('Mínimo constitucional e SUS', 'Constitutional minimum and SUS')}
              desc={t('% como declarado no SIOPS', '% as reported in SIOPS')}
              acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saude()}</Dica>}
              tabela={<TabelaSerie nome="saude_minimo" anos={anos} colunas={[
                { titulo: t('Receita própria aplicada', 'Own revenue spent'), valores: s.map((r) => fr(r.saude_pct)), formato: (v) => pct(v) },
                { titulo: t('Transferências do SUS ÷ despesa total', 'SUS transfers ÷ total spending'), valores: s.map((r) => fr(r.sus_despesa_pct)), formato: (v) => pct(v) },
              ]} metadados={metadados} />}>
              <Grafico opcao={opcaoPct} nome="saude_minimo" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Por habitante', 'Per inhabitant')} desc={reaisBase}
              acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saudeHab()}</Dica>}
              tabela={<TabelaSerie nome="saude_por_habitante" anos={anos} colunas={[
                { titulo: t('Despesa total', 'Total spending'), valores: s.map((r) => num(r.saude_hab)), formato: reais },
                { titulo: t('Recursos próprios', 'Own resources'), valores: s.map((r) => num(r.saude_proprios_hab)), formato: reais },
                { titulo: t('Transferências do SUS', 'SUS transfers'), valores: s.map((r) => num(r.sus_hab)), formato: reais },
                { titulo: t('Despesa total (R$)', 'Total spending (R$)'), valores: s.map((r) => num(r.saude_total)), formato: reais },
                { titulo: t('População', 'Population'), valores: s.map((r) => num(r.populacao_siops)), formato: numero },
              ]} metadados={metadados} />}>
              <Grafico opcao={opcaoHab} nome="saude_por_habitante" />
            </CartaoGrafico>
          </div>
          <CartaoGrafico titulo={t('Composição da despesa com saúde', 'Composition of health spending')}
            desc={t('% da despesa total com saúde', '% of total health spending')}
            tabela={<TabelaSerie nome="saude_composicao" anos={anos} colunas={[
              { titulo: t('Pessoal', 'Personnel'), valores: s.map((r) => fr(r.saude_pessoal_pct)), formato: (v) => pct(v) },
              { titulo: t('Serviços de terceiros', 'Third-party services'), valores: s.map((r) => fr(r.saude_terceiros_pct)), formato: (v) => pct(v) },
              { titulo: t('Medicamentos', 'Medicines'), valores: s.map((r) => fr(r.saude_medicamentos_pct)), formato: (v) => pct(v) },
              { titulo: t('Investimentos', 'Investment'), valores: s.map((r) => fr(r.saude_investimentos_pct)), formato: (v) => pct(v) },
            ]} metadados={metadados} />}>
            <Grafico opcao={opcaoComp} nome="saude_composicao" />
          </CartaoGrafico>
        </>
      )}
    </>
  );
}

function SaudeGrupo({ uf }: { uf?: string }) {
  const { meta } = useDados();
  const f = useFiltros();
  const grupo = useApi<Linha[]>('se_grupo', { esfera: 'M', uf });
  const entes = useApi<Linha[]>('se_entes', { esfera: 'M', uf, ano: f.ano });
  const s = (grupo.dados ?? []).filter((r) => num(r.n_saude));
  const anos = s.map((r) => r.ano as number);
  const a = s.find((r) => r.ano === f.ano);
  const reaisBase = notaReais(meta.baseIpca);
  const escopo = escopoDe('M', uf);

  const opcaoPct = useMemo(() => linhas(anos, [
    { nome: t('Receita própria aplicada (mediana)', 'Own revenue spent (median)'), valores: s.map((r) => num(r.saude_mediana)) },
    { nome: t('Pessoal na despesa (mediana)', 'Personnel in spending (median)'), valores: s.map((r) => num(r.saude_pessoal_mediana)) },
    { nome: t('SUS na despesa (mediana)', 'SUS in spending (median)'), valores: s.map((r) => num(r.sus_despesa_mediana)) },
  ], pctEixo), [grupo.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoHab = useMemo(() => linhas(anos, [
    { nome: t('Despesa total', 'Total spending'), valores: s.map((r) => num(r.saude_hab)) },
    { nome: t('Recursos próprios', 'Own resources'), valores: s.map((r) => num(r.saude_proprios_hab)) },
    { nome: t('Transferências do SUS', 'SUS transfers'), valores: s.map((r) => num(r.sus_hab)) },
  ], reaisCurto), [grupo.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Estado carregando={grupo.carregando} erro={grupo.erro} tentarNovamente={grupo.recarregar} />
      {a && (
        <>
          <h3 className="secao">{t(`Ano de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
          <p className="cobertura">{t(`${numero(num(a.n_saude))} municípios com o percentual da EC 29 declarado, de ${numero(num(a.entes))} no recorte.`,
            `${numero(num(a.n_saude))} municipalities with the EC 29 percentage reported, out of ${numero(num(a.entes))} in scope.`)}</p>
          <div className="kpis">
            <Kpi rotulo={t('Receita própria aplicada (mediana)', 'Own revenue spent (median)')} valor={pct(num(a.saude_mediana))}
              nota={`${t('abaixo de 15%', 'below 15%')}: ${de(a.saude_abaixo, a.n_saude)}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saude()}</Dica>} />
            <Kpi rotulo={t('Despesa total com saúde por habitante', 'Total health spending per inhabitant')} valor={reais(num(a.saude_hab))}
              nota={`${t('agregado', 'aggregate')} · ${reaisBase}`} dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saudeHab()}</Dica>} />
            <Kpi rotulo={t('Recursos próprios por habitante', 'Own resources per inhabitant')} valor={reais(num(a.saude_proprios_hab))}
              nota={`${t('agregado', 'aggregate')} · ${reaisBase}`} />
            <Kpi rotulo={t('Transferências do SUS por habitante', 'SUS transfers per inhabitant')} valor={reais(num(a.sus_hab))}
              nota={`${t('agregado', 'aggregate')} · ${reaisBase}`} />
            <Kpi rotulo={t('Pessoal na despesa (mediana)', 'Personnel in spending (median)')} valor={pct(num(a.saude_pessoal_mediana))} />
          </div>
        </>
      )}
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Mínimo constitucional e composição', 'Constitutional minimum and composition')}
            desc={t('Mediana dos percentuais declarados', 'Median of reported percentages')}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saude()}</Dica>}
            tabela={<TabelaSerie nome="saude_grupo" anos={anos} colunas={[
              { titulo: t('Municípios com o indicador', 'Municipalities with the indicator'), valores: s.map((r) => num(r.n_saude)), formato: numero },
              { titulo: t('Receita própria aplicada (mediana)', 'Own revenue spent (median)'), valores: s.map((r) => num(r.saude_mediana)), formato: (v) => pct(v) },
              { titulo: t('Abaixo de 15%', 'Below 15%'), valores: s.map((r) => num(r.saude_abaixo)), formato: numero },
              { titulo: t('Pessoal (mediana)', 'Personnel (median)'), valores: s.map((r) => num(r.saude_pessoal_mediana)), formato: (v) => pct(v) },
              { titulo: t('Medicamentos (mediana)', 'Medicines (median)'), valores: s.map((r) => num(r.saude_medicamentos_mediana)), formato: (v) => pct(v) },
              { titulo: t('Serviços de terceiros (mediana)', 'Third-party services (median)'), valores: s.map((r) => num(r.saude_terceiros_mediana)), formato: (v) => pct(v) },
              { titulo: t('Investimentos (mediana)', 'Investment (median)'), valores: s.map((r) => num(r.saude_investimentos_mediana)), formato: (v) => pct(v) },
            ]} metadados={[[t('Recorte', 'Scope'), escopo], [t('Fonte', 'Source'), fonteSiops()]]} />}>
            <Grafico opcao={opcaoPct} nome="saude_grupo" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Por habitante', 'Per inhabitant')} desc={`${t('Soma ÷ população', 'Sum ÷ population')} · ${reaisBase}`}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulas.saudeHab()}</Dica>}
            tabela={<TabelaSerie nome="saude_grupo_habitante" anos={anos} colunas={[
              { titulo: t('Despesa total', 'Total spending'), valores: s.map((r) => num(r.saude_hab)), formato: reais },
              { titulo: t('Recursos próprios', 'Own resources'), valores: s.map((r) => num(r.saude_proprios_hab)), formato: reais },
              { titulo: t('Transferências do SUS', 'SUS transfers'), valores: s.map((r) => num(r.sus_hab)), formato: reais },
            ]} metadados={[[t('Recorte', 'Scope'), escopo], [t('Fonte', 'Source'), fonteSiops()], [t('Valores', 'Values'), reaisBase]]} />}>
            <Grafico opcao={opcaoHab} nome="saude_grupo_habitante" />
          </CartaoGrafico>
        </div>
      )}
      <TabelaEntes linhas={(entes.dados ?? []).filter((r) => r.saude_pct !== null || r.saude_total !== null)} carregando={entes.carregando}
        erro={entes.erro} recarregar={entes.recarregar} esfera="M" escopo={escopo} nome="saude"
        metadados={[[t('Fonte', 'Source'), fonteSiops()], [t('Valores', 'Values'), reaisBase]]}
        colunas={[
          { campo: 'pct', titulo: t('Receita própria', 'Own revenue'), exportar: t('Receita própria aplicada em saúde (%)', 'Own revenue spent on health (%)'), formato: (v) => pct(fr(v)), valor: (r) => num(r.saude_pct) },
          { campo: 'hab', titulo: t('Por habitante', 'Per inhabitant'), exportar: t('Despesa total com saúde por habitante', 'Total health spending per inhabitant'), formato: reais, valor: (r) => num(r.saude_hab) },
          { campo: 'proprios', titulo: t('Próprios por hab.', 'Own per inh.'), exportar: t('Recursos próprios por habitante', 'Own resources per inhabitant'), formato: reais, valor: (r) => num(r.saude_proprios_hab) },
          { campo: 'sus', titulo: t('SUS por hab.', 'SUS per inh.'), exportar: t('Transferências do SUS por habitante', 'SUS transfers per inhabitant'), formato: reais, valor: (r) => num(r.sus_hab) },
          { campo: 'pessoal', titulo: t('Pessoal', 'Personnel'), exportar: t('Pessoal na despesa com saúde (%)', 'Personnel in health spending (%)'), formato: (v) => pct(fr(v)), valor: (r) => num(r.saude_pessoal_pct) },
          { campo: 'total', titulo: t('Despesa total', 'Total spending'), formato: reais, valor: (r) => num(r.saude_total) },
        ]} />
    </>
  );
}

// ---------------- profissionais da educação (remuneração do SIOPE) ----------------

const notaRemuneracao = () => t(
  'SIOPE, remuneração de dezembro declarada pelo ente, sem nomes: vínculos repetidos (mesma escola, categoria, carga e remuneração) contam uma vez e os vínculos de uma mesma pessoa na mesma categoria e situação são somados. Salário e carga horária só aparecem em grupos de 5 ou mais pessoas; em grupos de entes, a média é ponderada pelo número de pessoas desses grupos. Valores em R$ correntes de dezembro.',
  'SIOPE, December pay reported by each government, without names: repeated records (same school, category, hours and pay) count once and a person’s records in the same category and status are added up. Pay and hours only for groups of 5 or more people; for groups of governments, the mean is weighted by the number of people in those groups. Values in current R$ of December.',
);

export function RemuneracaoEducacao() {
  const { meta } = useDados();
  const f = useFiltros();
  const [esfera, setEsfera] = useState<'M' | 'E'>('M');
  const meses = ((meta.fontes.siope as { remuneracao?: number[] } | undefined)?.remuneracao ?? []);
  const anos = [...new Set(meses.map((m) => Math.floor(m / 100)))];
  const ano = anos.includes(f.ano) ? f.ano : anos.at(-1);
  const esferaGrupo = f.uf ? 'M' : esfera;
  const escopo = f.alvo ? { ente: f.alvo.cod_ibge } : { esfera: esferaGrupo, uf: f.uf ?? undefined };
  const resumo = useApi<Linha[]>(anos.length ? 'rem_resumo' : null, escopo);
  const categorias = useApi<Linha[]>(ano ? 'rem_categorias' : null, { ...escopo, ano });
  const r = resumo.dados ?? [];
  const rotuloEscopo = f.alvo ? f.rotulo : escopoDe(esferaGrupo, f.uf ?? undefined);

  // por ano e tipo de categoria (magistério ou outros)
  const porAno = useMemo(() => {
    const soma = (linhasAno: Linha[], campo: string) => linhasAno.reduce((acc, x) => acc + (num(x[campo]) ?? 0), 0);
    const media = (linhasAno: Linha[], campo: string) => {
      const ok = linhasAno.filter((x) => num(x[campo]) !== null && num(x.com_estatistica));
      const peso = soma(ok, 'com_estatistica');
      return peso ? ok.reduce((acc, x) => acc + num(x[campo])! * num(x.com_estatistica)!, 0) / peso : null;
    };
    const anosR = [...new Set(r.map((x) => x.ano as number))];
    return anosR.map((a) => {
      const doAno = r.filter((x) => x.ano === a);
      const mag = doAno.filter((x) => String(x.tipo_categoria).startsWith('Profissionais do magist'));
      const outros = doAno.filter((x) => !String(x.tipo_categoria).startsWith('Profissionais do magist'));
      const magEfetivo = mag.filter((x) => x.situacao === 'Efetivo');
      return {
        ano: a, total: soma(doAno, 'profissionais'), magisterio: soma(mag, 'profissionais'), outros: soma(outros, 'profissionais'),
        temporarios: soma(mag.filter((x) => x.situacao === 'Temporário'), 'profissionais'),
        salarioMagEfetivo: media(magEfetivo, 'salario_medio'), salarioOutros: media(outros, 'salario_medio'),
        cargaMag: media(mag, 'carga_horaria_media'),
      };
    });
  }, [resumo.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = porAno.find((x) => x.ano === ano);
  const eixo = porAno.map((x) => x.ano);
  const opcaoPessoas = useMemo(() => linhas(eixo, [
    { nome: t('Magistério', 'Teaching staff'), valores: porAno.map((x) => x.magisterio) },
    { nome: t('Outros profissionais', 'Other staff'), valores: porAno.map((x) => x.outros) },
  ], numero), [porAno]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoSalario = useMemo(() => linhas(eixo, [
    { nome: t('Magistério efetivo', 'Permanent teaching staff'), valores: porAno.map((x) => x.salarioMagEfetivo) },
    { nome: t('Outros profissionais', 'Other staff'), valores: porAno.map((x) => x.salarioOutros) },
  ], reaisCurto), [porAno]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = categorias.dados ?? [];
  const metadados: [string, string][] = [[t('Recorte', 'Scope'), rotuloEscopo], [t('Fonte e tratamento', 'Source and processing'), notaRemuneracao()]];

  return (
    <>
      <h2 className="titulo-pagina">{t('Profissionais da educação', 'Education staff')}</h2>
      <p className="subtitulo">
        {rotuloEscopo} · {t('remuneração declarada no SIOPE, dezembro', 'pay reported in SIOPE, December')}{' '}
        <Dica rotulo={t('Fonte', 'Source')}>{notaRemuneracao()}</Dica>
      </p>
      <BarraFiltros />
      {!anos.length && <p className="vazio">{t('A remuneração do SIOPE ainda não foi publicada.', 'SIOPE pay data have not been published yet.')}</p>}
      {anos.length > 0 && !f.alvo && !f.uf && (
        <div className="alternar" role="group" aria-label={t('Esfera', 'Level')} style={{ marginBottom: 14 }}>
          <button className={esfera === 'M' ? 'ativo' : ''} onClick={() => setEsfera('M')}>{t('Redes municipais', 'Municipal networks')}</button>
          <button className={esfera === 'E' ? 'ativo' : ''} onClick={() => setEsfera('E')}>{t('Redes estaduais', 'State networks')}</button>
        </div>
      )}
      {anos.length > 0 && ano !== f.ano && (
        <p className="aviso" role="status">{t(`A remuneração vai de ${anos[0]} a ${anos.at(-1)}; mostrando ${ano}.`, `Pay data cover ${anos[0]} to ${anos.at(-1)}; showing ${ano}.`)}</p>
      )}
      <Estado carregando={resumo.carregando} erro={resumo.erro} tentarNovamente={resumo.recarregar}
        vazio={!resumo.carregando && anos.length > 0 && !r.length && t('Sem remuneração declarada para este recorte.', 'No pay reported for this scope.')} />
      {a && (
        <>
          <h3 className="secao">{t(`Dezembro de ${ano}`, `December ${ano}`)}</h3>
          <div className="kpis">
            <Kpi rotulo={t('Profissionais', 'Staff')} valor={numero(a.total)} nota={t('pessoas na folha da educação', 'people on the education payroll')} />
            <Kpi rotulo={t('Magistério', 'Teaching staff')} valor={numero(a.magisterio)}
              nota={`${t('temporários', 'temporary')}: ${pct(a.magisterio ? a.temporarios / a.magisterio : null)}`} />
            <Kpi rotulo={t('Outros profissionais', 'Other staff')} valor={numero(a.outros)} />
            <Kpi rotulo={t('Remuneração média, magistério efetivo', 'Average pay, permanent teaching staff')} valor={reais(a.salarioMagEfetivo)}
              nota={a.cargaMag !== null ? t(`carga média do magistério: ${numero(a.cargaMag)} h`, `average teaching hours: ${numero(a.cargaMag)} h`) : undefined} />
            <Kpi rotulo={t('Remuneração média, outros profissionais', 'Average pay, other staff')} valor={reais(a.salarioOutros)} />
          </div>
        </>
      )}
      {porAno.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Profissionais na folha', 'Staff on the payroll')} desc={t('Pessoas em dezembro', 'People in December')}
            tabela={<TabelaSerie nome="educacao_profissionais" anos={eixo} colunas={[
              { titulo: t('Total', 'Total'), valores: porAno.map((x) => x.total), formato: numero },
              { titulo: t('Magistério', 'Teaching staff'), valores: porAno.map((x) => x.magisterio), formato: numero },
              { titulo: t('Magistério temporário', 'Temporary teaching staff'), valores: porAno.map((x) => x.temporarios), formato: numero },
              { titulo: t('Outros profissionais', 'Other staff'), valores: porAno.map((x) => x.outros), formato: numero },
            ]} metadados={metadados} />}>
            <Grafico opcao={opcaoPessoas} nome="educacao_profissionais" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Remuneração média', 'Average pay')} desc={t('R$ correntes de dezembro', 'current R$, December')}
            acoes={<Dica rotulo={t('Fonte', 'Source')}>{notaRemuneracao()}</Dica>}
            tabela={<TabelaSerie nome="educacao_remuneracao" anos={eixo} colunas={[
              { titulo: t('Magistério efetivo', 'Permanent teaching staff'), valores: porAno.map((x) => x.salarioMagEfetivo), formato: reais },
              { titulo: t('Outros profissionais', 'Other staff'), valores: porAno.map((x) => x.salarioOutros), formato: reais },
              { titulo: t('Carga horária média do magistério', 'Average teaching hours'), valores: porAno.map((x) => x.cargaMag), formato: numero },
            ]} metadados={metadados} />}>
            <Grafico opcao={opcaoSalario} nome="educacao_remuneracao" />
          </CartaoGrafico>
        </div>
      )}
      {ano && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h3>{t(`Categorias em dezembro de ${ano}`, `Categories in December ${ano}`)}</h3>
              <p className="desc">{t('Grupos com menos de 5 pessoas aparecem sem remuneração.', 'Groups of fewer than 5 people are shown without pay.')}</p>
            </div>
            <BotoesExportar nome={`educacao_categorias_${ano}`} obter={() => ({
              colunas: [t('Tipo', 'Type'), t('Categoria', 'Category'), t('Situação', 'Status'), t('Profissionais', 'Staff'), t('Vínculos', 'Records'),
                t('Carga horária média', 'Average hours'), t('Remuneração média', 'Average pay'),
                ...(f.alvo ? [t('1º quartil', '1st quartile'), t('Mediana', 'Median'), t('3º quartil', '3rd quartile')] : [])],
              linhas: cats.map((c) => [c.tipo_categoria, c.categoria, c.situacao, c.profissionais, c.vinculos, c.carga_horaria_media, c.salario_medio,
                ...(f.alvo ? [c.salario_p25, c.salario_mediana, c.salario_p75] : [])]),
              metadados: [...metadados, [t('Mês', 'Month'), `12/${ano}`]],
            })} />
          </div>
          <Estado carregando={categorias.carregando} erro={categorias.erro} tentarNovamente={categorias.recarregar} />
          {cats.length > 0 && (
            <div className="rolagem">
              <table>
                <thead>
                  <tr>
                    <th>{t('Categoria', 'Category')}</th>
                    <th>{t('Situação', 'Status')}</th>
                    <th>{t('Profissionais', 'Staff')}</th>
                    <th>{t('Carga média (h)', 'Avg. hours')}</th>
                    <th>{t('Remuneração média', 'Average pay')}</th>
                    {f.alvo && <th>{t('Mediana', 'Median')}</th>}
                    {f.alvo && <th>{t('1º–3º quartil', '1st–3rd quartile')}</th>}
                  </tr>
                </thead>
                <tbody>
                  {cats.map((c, i) => (
                    <tr key={i}>
                      <td title={String(c.tipo_categoria)}>{String(c.categoria)}</td>
                      <td>{String(c.situacao)}</td>
                      <td>{numero(num(c.profissionais))}</td>
                      <td>{numero(num(c.carga_horaria_media))}</td>
                      <td>{reais(num(c.salario_medio))}</td>
                      {f.alvo && <td>{reais(num(c.salario_mediana))}</td>}
                      {f.alvo && <td>{c.salario_p25 === null ? '–' : `${reais(num(c.salario_p25))} – ${reais(num(c.salario_p75))}`}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </>
  );
}
