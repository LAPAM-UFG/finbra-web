import { useMemo, useState } from 'react';
import { useApi, type Linha, type Params } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num } from '../hooks';
import { local, t } from '../idioma';

const SETORES = (): [string, string][] => [
  ['agropecuaria', t('Agropecuária', 'Agriculture')],
  ['industria', t('Indústria', 'Industry')],
  ['construcao', t('Construção', 'Construction')],
  ['comercio', t('Comércio', 'Trade')],
  ['servicos', t('Serviços', 'Services')],
  ['adm_publica', t('Administração pública', 'Public administration')],
];

const fonteRais = () => t(
  'RAIS (Relação Anual de Informações Sociais), Ministério do Trabalho e Emprego, microdados públicos sem identificação: vínculos formais ativos em 31 de dezembro, por município do estabelecimento. Processamento: LAPAM/UFG.',
  'RAIS (Annual Social Information Report), Ministry of Labour and Employment, public de-identified microdata: formal jobs active on December 31, by municipality of the establishment. Processing: LAPAM/UFG.',
);
const fonteCaged = () => t(
  'Novo CAGED, Ministério do Trabalho e Emprego: admissões e desligamentos de empregos formais celetistas, mês a mês. Série com ajustes: declarações no prazo, mais as fora do prazo, menos as exclusões, pela competência da movimentação.',
  'New CAGED, Ministry of Labour and Employment: monthly hirings and separations of formal CLT jobs. Adjusted series: on-time filings, plus late filings, minus exclusions, by the month of the movement.',
);
const notaSetores = () => t(
  'Grandes setores pela divisão da CNAE 2.0: agropecuária (01–03), indústria (05–39, inclui extrativa, energia e saneamento), construção (41–43), comércio (45–47), administração pública (84) e serviços (demais).',
  'Broad sectors by CNAE 2.0 division: agriculture (01–03), industry (05–39, including mining, energy and sanitation), construction (41–43), trade (45–47), public administration (84) and services (all others).',
);
const notaRemuneracao = () => t(
  'Remuneração média de dezembro: soma das remunerações nominais de dezembro ÷ vínculos ativos com remuneração no mês. Em grupos, média ponderada (massa ÷ vínculos).',
  'Average December pay: sum of nominal December pay ÷ active jobs with pay that month. For groups, weighted average (payroll ÷ jobs).',
);

const mesAno = (aaaamm: number) => `${String(aaaamm % 100).padStart(2, '0')}/${Math.floor(aaaamm / 100)}`;

/** Escopo das páginas de trabalho a partir dos filtros: município, UF (municípios dela) ou Brasil. */
function useTrabalho() {
  const { meta } = useDados();
  const f = useFiltros();
  const rais = meta.fontes.rais as { anos?: number[] } | undefined;
  const caged = meta.fontes.caged as { de?: number; ate?: number } | undefined;
  const anos = rais?.anos ?? [];
  // ano da RAIS: o do filtro, ou o mais recente até ele (a RAIS sai com ~1 ano de atraso)
  const anoRais = anos.includes(f.ano) ? f.ano : ([...anos].reverse().find((a) => a <= f.ano) ?? anos.at(-1));
  let escopo: Params;
  let rotulo: string;
  let municipio = false;
  if (f.alvo && f.alvo.esfera !== 'E') {
    escopo = { ente: f.alvo.cod_ibge };
    rotulo = f.alvo.esfera === 'D' ? t('Brasília (DF)', 'Brasília (DF)') : f.rotulo;
    municipio = true;
  } else if (f.alvo?.esfera === 'E' || f.uf) {
    const uf = f.alvo?.uf ?? f.uf!;
    escopo = { uf };
    rotulo = t(`Municípios de ${uf}`, `Municipalities in ${uf}`);
  } else {
    escopo = {};
    rotulo = t('Brasil', 'Brazil');
  }
  return { f, meta, anos, anoRais, caged, escopo, rotulo, municipio, temDados: anos.length > 0 };
}

function SemDados() {
  return <p className="vazio">{t('Os dados da RAIS e do CAGED ainda não foram publicados.', 'RAIS and CAGED data have not been published yet.')}</p>;
}

function AvisoAno({ ano, anoRais }: { ano: number; anoRais?: number }) {
  if (!anoRais || anoRais === ano) return null;
  return (
    <p className="aviso" role="status">
      {t(`A RAIS de ${ano} ainda não foi publicada; a página mostra ${anoRais}, o ano mais recente disponível.`,
        `RAIS ${ano} has not been published yet; the page shows ${anoRais}, the latest year available.`)}
    </p>
  );
}

// ---------------- visão geral ----------------

export function TrabalhoVisaoGeral() {
  const { anoRais, escopo, rotulo, temDados, f, meta } = useTrabalho();
  const serie = useApi<Linha[]>(temDados ? 'trab_serie' : null, escopo);
  const setores = useApi<Linha[]>(temDados && anoRais ? 'trab_setores' : null, { ...escopo, ano: anoRais });
  const [todos, setTodos] = useState(false);
  const a = serie.dados?.find((r) => r.ano === anoRais);
  const empregos = num(a?.empregos);
  const porMil = div(num(a?.empregos_com_populacao), num(a?.populacao));
  const lista = setores.dados ?? [];
  const totalSet = lista.reduce((s, r) => s + (num(r.empregos) ?? 0), 0);

  const opcaoSetores = useMemo(() => barras(
    SETORES().map(([, n]) => n), SETORES().map(([k]) => num(a?.[`empregos_${k}`])), (v) => numero(v), true,
  ), [serie.dados, anoRais]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!temDados) return <><h2 className="titulo-pagina">{t('Mercado de trabalho', 'Labour market')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Mercado de trabalho: visão geral', 'Labour market: overview')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {anoRais} <Dica rotulo={t('Fonte', 'Source')}>{fonteRais()}</Dica></p>
      <BarraFiltros />
      <AvisoAno ano={f.ano} anoRais={anoRais} />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !a && t('Sem vínculos na RAIS para este recorte.', 'No RAIS jobs for this scope.')} />
      {a && (
        <div className="kpis">
          <Kpi rotulo={t('Empregos formais (31/12)', 'Formal jobs (Dec 31)')} valor={numero(empregos)}
            nota={porMil !== null ? t(`${numero(1000 * porMil)} por mil habitantes`, `${numero(1000 * porMil)} per thousand inhabitants`) : undefined} />
          <Kpi rotulo={t('Remuneração média (dezembro)', 'Average pay (December)')} valor={reaisExato(num(a.remuneracao_media))}
            nota={`${t('Real', 'Real')} (R$ dez/${meta.baseIpca}): ${reaisExato(num(a.remuneracao_media_real))}`}
            dica={<Dica rotulo={t('Fórmula', 'Formula')}>{notaRemuneracao()}</Dica>} />
          <Kpi rotulo={t('Massa salarial de dezembro', 'December payroll')} valor={reais(num(a.massa_dez))} />
          <Kpi rotulo={t('Mulheres', 'Women')} valor={pct(div(num(a.mulheres), empregos))}
            nota={t(`Remuneração das mulheres = ${pct(div(num(a.remuneracao_mulheres), num(a.remuneracao_homens)), 0)} da dos homens`,
              `Women’s pay = ${pct(div(num(a.remuneracao_mulheres), num(a.remuneracao_homens)), 0)} of men’s`)} />
          <Kpi rotulo={t('Com ensino superior completo', 'With a college degree')} valor={pct(div(num(a.superior), empregos))} />
          <Kpi rotulo={t('Administração pública', 'Public administration')} valor={pct(div(num(a.empregos_adm_publica), empregos))}
            nota={t('dos empregos formais (CNAE 84)', 'of formal jobs (CNAE 84)')} />
          <Kpi rotulo={t('Estabelecimentos com empregados', 'Establishments with employees')} valor={numero(num(a.estabelecimentos))} />
        </div>
      )}
      {a && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Empregos por grande setor', 'Jobs by broad sector')} desc={`RAIS ${anoRais}`}
            acoes={<Dica rotulo={t('Classificação', 'Classification')}>{notaSetores()}</Dica>}>
            <Grafico opcao={opcaoSetores} nome="trabalho_setores" />
          </CartaoGrafico>
          <section className="cartao">
            <div className="cabeca-cartao">
              <div>
                <h3>{t('Atividades que mais empregam', 'Top employing activities')}</h3>
                <p className="desc">{t('Divisões da CNAE 2.0', 'CNAE 2.0 divisions')} · RAIS {anoRais}</p>
              </div>
              <BotoesExportar nome={`trabalho_setores_${anoRais}`} obter={() => ({
                colunas: [t('Divisão', 'Division'), t('Atividade', 'Activity'), t('Seção', 'Section'), t('Empregos', 'Jobs'),
                  t('Participação', 'Share'), t('Remuneração média (dez)', 'Average pay (Dec)')],
                linhas: lista.map((r) => [r.divisao, r.divisao_nome, r.secao_nome, r.empregos, div(num(r.empregos), totalSet), r.remuneracao_media]),
                metadados: [[t('Recorte', 'Scope'), rotulo], [t('Ano', 'Year'), String(anoRais)], [t('Fonte', 'Source'), fonteRais()]],
              })} />
            </div>
            <Estado carregando={setores.carregando} erro={setores.erro} tentarNovamente={setores.recarregar} />
            {lista.length > 0 && (
              <div className="rolagem">
                <table>
                  <thead><tr><th>{t('Atividade', 'Activity')}</th><th>{t('Empregos', 'Jobs')}</th><th>%</th><th>{t('Remuneração', 'Pay')}</th></tr></thead>
                  <tbody>
                    {(todos ? lista : lista.slice(0, 12)).map((r) => (
                      <tr key={String(r.divisao)}>
                        <td title={`${r.divisao} · ${r.secao_nome ?? ''}`}>{String(r.divisao_nome ?? r.divisao)}</td>
                        <td>{numero(num(r.empregos))}</td><td>{pct(div(num(r.empregos), totalSet))}</td>
                        <td>{reaisExato(num(r.remuneracao_media))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {lista.length > 12 && (
              <p className="legenda-tabela"><button className="limpar" onClick={() => setTodos(!todos)}>
                {todos ? t('mostrar menos', 'show fewer') : t(`mostrar as ${lista.length} atividades`, `show all ${lista.length} activities`)}
              </button></p>
            )}
          </section>
        </div>
      )}
    </>
  );
}

// ---------------- evolução ----------------

export function TrabalhoEvolucao() {
  const { escopo, rotulo, temDados, meta } = useTrabalho();
  const serie = useApi<Linha[]>(temDados ? 'trab_serie' : null, escopo);
  const s = serie.dados ?? [];
  const anos = s.map((r) => r.ano as number);
  const periodo = anos.length ? `${anos[0]}–${anos.at(-1)}` : '';

  const opcaoEmpregos = useMemo(() => linhas(anos, [{ nome: t('Empregos formais', 'Formal jobs'), valores: s.map((r) => num(r.empregos)) }],
    (v) => numero(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoRemun = useMemo(() => linhas(anos, [
    { nome: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((r) => num(r.remuneracao_media_real)) },
    { nome: 'Nominal', valores: s.map((r) => num(r.remuneracao_media)) },
  ], reaisCurto), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoSetores = useMemo(() => linhas(anos, SETORES().map(([k, n]) => ({ nome: n, valores: s.map((r) => num(r[`empregos_${k}`])) })),
    (v) => numero(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoPerfil = useMemo(() => linhas(anos, [
    { nome: t('Mulheres', 'Women'), valores: s.map((r) => div(num(r.mulheres), num(r.empregos))) },
    { nome: t('Ensino superior', 'College degree'), valores: s.map((r) => div(num(r.superior), num(r.empregos))) },
    { nome: t('Remuneração mulheres ÷ homens', 'Women ÷ men pay'), valores: s.map((r) => div(num(r.remuneracao_mulheres), num(r.remuneracao_homens))) },
  ], (v) => pct(v, 0)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!temDados) return <><h2 className="titulo-pagina">{t('Mercado de trabalho', 'Labour market')}</h2><SemDados /></>;
  const meta2: [string, string][] = [[t('Recorte', 'Scope'), rotulo], [t('Fonte', 'Source'), fonteRais()]];
  return (
    <>
      <h2 className="titulo-pagina">{t('Mercado de trabalho: evolução', 'Labour market: trends')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {periodo} <Dica rotulo={t('Fonte', 'Source')}>{fonteRais()}</Dica></p>
      <BarraFiltros semAno />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar} />
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Empregos formais em 31/12', 'Formal jobs on Dec 31')}
            tabela={<TabelaSerie nome="trabalho_empregos" anos={anos} colunas={[
              { titulo: t('Empregos', 'Jobs'), valores: s.map((r) => num(r.empregos)), formato: numero },
              { titulo: t('Estabelecimentos', 'Establishments'), valores: s.map((r) => num(r.estabelecimentos)), formato: numero },
              { titulo: t('Massa salarial de dezembro', 'December payroll'), valores: s.map((r) => num(r.massa_dez)), formato: reais },
            ]} metadados={meta2} />}>
            <Grafico opcao={opcaoEmpregos} nome="trabalho_empregos" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Remuneração média de dezembro', 'Average December pay')}
            desc={t('Nominal e corrigida pelo IPCA', 'Nominal and adjusted by the IPCA')}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{notaRemuneracao()}</Dica>}
            tabela={<TabelaSerie nome="trabalho_remuneracao" anos={anos} colunas={[
              { titulo: 'Nominal', valores: s.map((r) => num(r.remuneracao_media)), formato: reaisExato },
              { titulo: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((r) => num(r.remuneracao_media_real)), formato: reaisExato },
              { titulo: t('Mulheres (nominal)', 'Women (nominal)'), valores: s.map((r) => num(r.remuneracao_mulheres)), formato: reaisExato },
              { titulo: t('Homens (nominal)', 'Men (nominal)'), valores: s.map((r) => num(r.remuneracao_homens)), formato: reaisExato },
            ]} metadados={meta2} />}>
            <Grafico opcao={opcaoRemun} nome="trabalho_remuneracao" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Empregos por grande setor', 'Jobs by broad sector')}
            acoes={<Dica rotulo={t('Classificação', 'Classification')}>{notaSetores()}</Dica>}
            tabela={<TabelaSerie nome="trabalho_setores_serie" anos={anos}
              colunas={SETORES().map(([k, n]) => ({ titulo: n, valores: s.map((r) => num(r[`empregos_${k}`])), formato: numero }))} metadados={meta2} />}>
            <Grafico opcao={opcaoSetores} nome="trabalho_setores_serie" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Perfil dos empregos', 'Job profile')}
            desc={t('Participação de mulheres e de pessoas com ensino superior; razão entre as remunerações', 'Share of women and of college graduates; pay ratio')}
            tabela={<TabelaSerie nome="trabalho_perfil" anos={anos} colunas={[
              { titulo: t('Mulheres', 'Women'), valores: s.map((r) => div(num(r.mulheres), num(r.empregos))), formato: (v) => pct(v) },
              { titulo: t('Ensino superior', 'College degree'), valores: s.map((r) => div(num(r.superior), num(r.empregos))), formato: (v) => pct(v) },
              { titulo: t('Até 24 anos', 'Up to 24'), valores: s.map((r) => div(num(r.ate24), num(r.empregos))), formato: (v) => pct(v) },
              { titulo: t('50 anos ou mais', '50 or older'), valores: s.map((r) => div(num(r.de50mais), num(r.empregos))), formato: (v) => pct(v) },
            ]} metadados={meta2} />}>
            <Grafico opcao={opcaoPerfil} nome="trabalho_perfil" />
          </CartaoGrafico>
        </div>
      )}
    </>
  );
}

// ---------------- CAGED ----------------

export function TrabalhoCaged() {
  const { escopo, rotulo, caged, municipio } = useTrabalho();
  const serie = useApi<Linha[]>(caged ? 'trab_caged' : null, escopo);
  const s = serie.dados ?? [];
  const ultimo = s.at(-1);
  const ate = num(ultimo?.competencia);
  const secoes = useApi<Linha[]>(caged && ate && !municipio ? 'trab_caged_secoes' : null, { ...escopo, ate });
  const ultimos12 = s.slice(-12);
  const soma = (c: string) => ultimos12.reduce((t0, r) => t0 + (num(r[c]) ?? 0), 0);
  const meses = s.map((r) => mesAno(r.competencia as number));

  const opcaoSaldo = useMemo(() => barras(meses, s.map((r) => num(r.saldo)), (v) => numero(v), false),
    [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcao12 = useMemo(() => linhas(meses, [
    { nome: t('Saldo em 12 meses', '12-month net balance'), valores: s.map((r, i) => (i >= 11 ? num(r.saldo_12m) : null)) },
  ], (v) => numero(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!caged) return <><h2 className="titulo-pagina">{t('Novo CAGED', 'New CAGED')}</h2><SemDados /></>;
  const metaC: [string, string][] = [[t('Recorte', 'Scope'), rotulo], [t('Fonte', 'Source'), fonteCaged()]];
  return (
    <>
      <h2 className="titulo-pagina">{t('Empregos formais mês a mês (Novo CAGED)', 'Formal jobs month by month (New CAGED)')}</h2>
      <p className="subtitulo">{rotulo} · {caged.de && caged.ate ? `${mesAno(caged.de)}–${mesAno(caged.ate)}` : ''} <Dica rotulo={t('Fonte', 'Source')}>{fonteCaged()}</Dica></p>
      <BarraFiltros semAno />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !s.length && t('Sem movimentações no CAGED para este recorte.', 'No CAGED movements for this scope.')} />
      {ultimo && (
        <>
          <h3 className="secao">{t(`Último mês: ${mesAno(ate!)}`, `Latest month: ${mesAno(ate!)}`)}</h3>
          <div className="kpis">
            <Kpi rotulo={t('Saldo do mês', 'Net balance (month)')} valor={numero(num(ultimo.saldo))}
              nota={`${numero(num(ultimo.admissoes))} ${t('admissões', 'hirings')} · ${numero(num(ultimo.desligamentos))} ${t('desligamentos', 'separations')}`} />
            <Kpi rotulo={t('Saldo em 12 meses', '12-month net balance')} valor={numero(soma('saldo'))}
              nota={`${numero(soma('admissoes'))} ${t('admissões', 'hirings')} · ${numero(soma('desligamentos'))} ${t('desligamentos', 'separations')}`} />
            <Kpi rotulo={t('Salário médio de admissão', 'Average hiring wage')} valor={reaisExato(num(ultimo.salario_medio_admissao))}
              nota={t('entre 0,3 e 150 salários mínimos', 'between 0.3 and 150 minimum wages')} />
          </div>
          <div className="grade-2">
            <CartaoGrafico titulo={t('Saldo mensal (admissões − desligamentos)', 'Monthly net balance (hirings − separations)')}
              tabela={<TabelaSerie nome="caged_mensal" anos={meses} colunas={[
                { titulo: t('Admissões', 'Hirings'), valores: s.map((r) => num(r.admissoes)), formato: numero },
                { titulo: t('Desligamentos', 'Separations'), valores: s.map((r) => num(r.desligamentos)), formato: numero },
                { titulo: t('Saldo', 'Net balance'), valores: s.map((r) => num(r.saldo)), formato: numero },
                { titulo: t('Salário médio de admissão', 'Average hiring wage'), valores: s.map((r) => num(r.salario_medio_admissao)), formato: reaisExato },
              ]} metadados={metaC} />}>
              <Grafico opcao={opcaoSaldo} nome="caged_saldo" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Saldo acumulado em 12 meses', 'Rolling 12-month net balance')}>
              <Grafico opcao={opcao12} nome="caged_12m" />
            </CartaoGrafico>
          </div>
        </>
      )}
      {!municipio && (secoes.dados ?? []).length > 0 && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h3>{t('Saldo por setor nos últimos 12 meses', 'Net balance by sector, last 12 months')}</h3>
              <p className="desc">{t('Seções da CNAE 2.0', 'CNAE 2.0 sections')} · {t('até', 'through')} {mesAno(ate!)}</p>
            </div>
            <BotoesExportar nome="caged_setores_12m" obter={() => ({
              colunas: [t('Seção', 'Section'), t('Atividade', 'Activity'), t('Admissões', 'Hirings'), t('Desligamentos', 'Separations'), t('Saldo', 'Net balance')],
              linhas: (secoes.dados ?? []).map((r) => [r.secao, r.secao_nome, r.admissoes, r.desligamentos, r.saldo]),
              metadados: [...metaC, [t('Período', 'Period'), t(`12 meses até ${mesAno(ate!)}`, `12 months through ${mesAno(ate!)}`)]],
            })} />
          </div>
          <div className="rolagem">
            <table>
              <thead><tr><th>{t('Atividade', 'Activity')}</th><th>{t('Admissões', 'Hirings')}</th><th>{t('Desligamentos', 'Separations')}</th><th>{t('Saldo', 'Net balance')}</th></tr></thead>
              <tbody>
                {(secoes.dados ?? []).map((r) => (
                  <tr key={String(r.secao)}>
                    <td>{String(r.secao_nome ?? r.secao)}</td><td>{numero(num(r.admissoes))}</td>
                    <td>{numero(num(r.desligamentos))}</td><td>{numero(num(r.saldo))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      {municipio && (
        <p className="nota-base">{t('O saldo por setor aparece para UFs e para o Brasil.', 'The balance by sector is shown for states and for Brazil.')}</p>
      )}
    </>
  );
}

// ---------------- rankings ----------------

type Col = { campo: string; titulo: string; formato: (v: unknown) => string };

export function TrabalhoRankings() {
  const { anoRais, temDados, f } = useTrabalho();
  const uf = f.alvo?.uf ?? f.uf ?? undefined;
  const dados = useApi<Linha[]>(temDados && anoRais ? 'trab_municipios' : null, { uf, ano: anoRais });
  const [ordem, setOrdem] = useState<{ campo: string; desc: boolean }>({ campo: 'empregos_por_mil', desc: true });
  const [todos, setTodos] = useState(false);
  const colunas: Col[] = [
    { campo: 'empregos', titulo: t('Empregos', 'Jobs'), formato: (v) => numero(num(v)) },
    { campo: 'empregos_por_mil', titulo: t('Por mil hab.', 'Per 1,000 inh.'), formato: (v) => numero(num(v)) },
    { campo: 'remuneracao_media', titulo: t('Remuneração média', 'Average pay'), formato: (v) => reaisExato(num(v)) },
    { campo: 'pct_mulheres', titulo: t('Mulheres', 'Women'), formato: (v) => pct(num(v)) },
    { campo: 'pct_superior', titulo: t('Ens. superior', 'College'), formato: (v) => pct(num(v)) },
    { campo: 'pct_adm_publica', titulo: t('Adm. pública', 'Public adm.'), formato: (v) => pct(num(v)) },
    { campo: 'saldo_caged', titulo: t('Saldo CAGED no ano', 'CAGED balance (year)'), formato: (v) => numero(num(v)) },
  ];
  const ordenados = useMemo(() => [...(dados.dados ?? [])].sort((x, y) => {
    const a = num(x[ordem.campo]);
    const b = num(y[ordem.campo]);
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * (ordem.desc ? -1 : 1);
  }), [dados.dados, ordem]);
  const visiveis = todos ? ordenados : ordenados.slice(0, 50);
  const escopo = uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil');

  if (!temDados) return <><h2 className="titulo-pagina">{t('Rankings do mercado de trabalho', 'Labour market rankings')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Rankings do mercado de trabalho', 'Labour market rankings')}</h2>
      <p className="subtitulo">{escopo} · RAIS {anoRais} <Dica rotulo={t('Fonte', 'Source')}>{fonteRais()} {fonteCaged()}</Dica></p>
      <BarraFiltros semEnte={t('Nesta página o município escolhido define só a UF do ranking.', 'On this page the chosen municipality only sets the state of the ranking.')} />
      <AvisoAno ano={f.ano} anoRais={anoRais} />
      <section className="cartao">
        <div className="cabeca-cartao">
          <p className="desc">{t('Clique no título de uma coluna para ordenar. Empregos por mil habitantes usam a população do painel de finanças.', 'Click a column header to sort. Jobs per thousand inhabitants use the population from the finance dashboard.')}</p>
          <BotoesExportar nome={`trabalho_ranking_${anoRais}`} obter={() => ({
            colunas: ['cod_ibge', t('Município', 'Municipality'), 'UF', t('População', 'Population'), ...colunas.map((c) => c.titulo),
              t('Estabelecimentos', 'Establishments'), t('Meses de CAGED no ano', 'CAGED months in year')],
            linhas: ordenados.map((r) => [r.cod_ibge, r.nome, r.uf, r.populacao, ...colunas.map((c) => r[c.campo]), r.estabelecimentos, r.meses_caged]),
            metadados: [[t('Recorte', 'Scope'), escopo], [t('Ano', 'Year'), String(anoRais)], [t('Fonte', 'Source'), `${fonteRais()} ${fonteCaged()}`]],
          })} />
        </div>
        <Estado carregando={dados.carregando} erro={dados.erro} tentarNovamente={dados.recarregar} />
        {ordenados.length > 0 && (
          <>
            <div className="rolagem">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>{t('Município', 'Municipality')}</th>
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
                  {visiveis.map((r, i) => (
                    <tr key={String(r.cod_ibge)} className={f.alvo?.cod_ibge === r.cod_ibge ? 'destaque' : undefined}>
                      <td>{(i + 1).toLocaleString(local())}</td>
                      <td>{String(r.nome)}{uf ? '' : ` (${r.uf})`}</td>
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
