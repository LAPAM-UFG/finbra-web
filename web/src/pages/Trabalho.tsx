import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApi, type Linha, type Params } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { EtiquetasRecorte, paramsConsulta, useAnosConsulta } from '../components/RecorteTrabalho';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { cancelarConsultasTrabalho } from '../dados';
import { div, numero, numero1, pct, reais, reaisCurto, reaisExato } from '../format';
import { num } from '../hooks';
import { local, t } from '../idioma';
import { marcasQuebra, notaComparabilidade, quebrasEntre, temFiltrosDeRecorte, useRecorte } from '../trabalho_comum';

const SETORES = (): [string, string][] => [
  ['agropecuaria', t('Agropecuária', 'Agriculture')],
  ['industria', t('Indústria', 'Industry')],
  ['construcao', t('Construção', 'Construction')],
  ['comercio', t('Comércio', 'Trade')],
  ['servicos', t('Serviços', 'Services')],
  ['adm_publica', t('Adm. pública, defesa e seguridade (CNAE 84)', 'Public adm., defence and social security (CNAE 84)')],
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
  'Grandes setores pela divisão da CNAE 2.0 (atividade do estabelecimento): agropecuária (01–03), indústria (05–39, inclui extrativa, energia e saneamento), construção (41–43), comércio (45–47), administração pública, defesa e seguridade social (84) e serviços (demais). A divisão 84 é uma atividade: não reúne todo o setor público, que também aparece em educação, saúde e outras atividades. Para o setor público pela natureza jurídica, use a Consulta personalizada (setor institucional).',
  'Broad sectors by CNAE 2.0 division (establishment activity): agriculture (01–03), industry (05–39, including mining, energy and sanitation), construction (41–43), trade (45–47), public administration, defence and social security (84) and services (all others). Division 84 is an activity: it does not cover the whole public sector, which also appears in education, health and other activities. For the public sector by legal nature, use the Custom query (institutional sector).',
);
const notaRemuneracao = () => t(
  'Remuneração média de dezembro, como no PDET/MTE: soma das remunerações nominais de dezembro ÷ todos os vínculos ativos em 31/12. Quem está ativo sem valor de dezembro conta como zero (entra no denominador), e o painel mostra quantos são: onde há muitos, a média fica abaixo do salário de quem tem o valor. Em grupos, massa ÷ ativos do grupo, nunca média das médias. Remuneração real: × (IPCA de dezembro do ano-base ÷ IPCA de dezembro do ano).',
  'Average December pay, as in PDET/MTE: sum of nominal December pay ÷ all jobs active on Dec 31. Active jobs without a December value count as zero (they stay in the denominator), and the dashboard shows how many there are: where there are many, the average falls below the pay of those with a value. For groups, payroll ÷ the group’s active jobs, never an average of averages. Real pay: × (base-year December IPCA ÷ December IPCA of the year).',
);
const notaPorMil = (ano: number | undefined) => t(
  `Vínculos ativos em 31/12 no município do estabelecimento ÷ população residente do mesmo ano (${ano ?? ''}) × 1.000. A população é a do painel de finanças desde 2013 e a do IBGE antes (Censo 2010 e estimativas). Não é taxa de ocupação, de formalização ou de desemprego: uma pessoa pode ter mais de um vínculo e trabalhar fora do município onde mora, e o valor pode passar de 1.000.`,
  `Jobs active on Dec 31 in the establishment’s municipality ÷ resident population of the same year (${ano ?? ''}) × 1,000. Population is the finance dashboard’s from 2013 and IBGE’s before (2010 Census and estimates). It is not an employment, formality or unemployment rate: a person may hold more than one job and work outside the municipality where they live, and the value can exceed 1,000.`,
);

const mesAno = (aaaamm: number) => `${String(aaaamm % 100).padStart(2, '0')}/${Math.floor(aaaamm / 100)}`;
const MESES = () => t('jan fev mar abr mai jun jul ago set out nov dez', 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec').split(' ');

/** Escopo das páginas de trabalho a partir dos filtros: município, UF (municípios dela) ou Brasil. */
function useTrabalho() {
  const { meta } = useDados();
  const f = useFiltros();
  const rais = meta.fontes.rais as { anos?: number[] } | undefined;
  const caged = meta.fontes.caged as { de?: number; ate?: number; processado_em?: string } | undefined;
  const anos = rais?.anos ?? [];
  // o filtro de ano da área já usa os anos da RAIS (useFiltros)
  const anoRais = anos.includes(f.ano) ? f.ano : anos.at(-1);
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

function AvisoAno({ anoRais }: { anoRais?: number }) {
  const f = useFiltros();
  if (!f.anoForaDaBase || !anoRais) return null;
  return (
    <p className="aviso" role="status">
      {t(`A RAIS de ${f.anoForaDaBase} ainda não foi publicada; a página mostra ${anoRais}, o ano mais recente disponível.`,
        `RAIS ${f.anoForaDaBase} has not been published yet; the page shows ${anoRais}, the latest year available.`)}
    </p>
  );
}

/** Esta página usa tabelas agregadas por município: o recorte (ocupação, atividade, perfil) não se aplica a ela, e a página diz isso em vez de ignorá-lo em silêncio. */
function AvisoRecorte({ pagina }: { pagina: string }) {
  const { recorte, definir } = useRecorte();
  const { search } = useLocation();
  if (!temFiltrosDeRecorte(recorte)) return null;
  return (
    <div className="aviso" role="status">
      <p>{t(`O recorte abaixo está ativo, mas ${pagina} usa as tabelas somadas por município (todos os vínculos ativos), que não têm ocupação nem os demais filtros. Os números desta página não aplicam o recorte.`,
        `The recorte below is active, but ${pagina} uses tables summed by municipality (all active jobs), which have no occupation or the other filters. The numbers on this page do not apply the recorte.`)}{' '}
        <Link to={`/trabalho/consulta${search}`}>{t('Consulta com o recorte', 'Query with the recorte')}</Link> ·{' '}
        <Link to={`/trabalho/perfil${search}`}>{t('Perfil da ocupação', 'Occupation profile')}</Link> ·{' '}
        <Link to={`/trabalho/evolucao${search}`}>{t('Evolução do recorte', 'Recorte over time')}</Link></p>
      <EtiquetasRecorte recorte={recorte} definir={definir} />
    </div>
  );
}

function NotaQuebra({ anos }: { anos: number[] }) {
  const qs = anos.length ? quebrasEntre(Math.min(...anos), Math.max(...anos)) : [];
  if (!qs.length) return null;
  return (
    <p className="quebra-serie" role="note">
      <strong>{t('Quebras de série na RAIS', 'Breaks in the RAIS series')}:</strong>{' '}
      {qs.map((q) => <span key={q.ano}>{q.texto} <a href={q.url} target="_blank" rel="noreferrer">{t('Nota técnica do MTE', 'MTE technical note')}</a>. </span>)}
      {t('Nos gráficos, linhas tracejadas marcam esses anos; variações que os atravessam são observadas e podem refletir cobertura ou classificação, não só o mercado de trabalho.',
        'In the charts, dashed lines mark these years; changes across them are observed and may reflect coverage or classification, not only the labour market.')}
    </p>
  );
}

// ---------------- visão geral ----------------

export function TrabalhoVisaoGeral() {
  const { anoRais, escopo, rotulo, temDados, meta } = useTrabalho();
  const serie = useApi<Linha[]>(temDados ? 'trab_serie' : null, escopo);
  const setores = useApi<Linha[]>(temDados && anoRais ? 'trab_setores' : null, { ...escopo, ano: anoRais });
  const [todos, setTodos] = useState(false);
  const a = serie.dados?.find((r) => r.ano === anoRais);
  const ant = serie.dados?.find((r) => r.ano === (anoRais ?? 0) - 1);
  const empregos = num(a?.empregos);
  const porMil = div(num(a?.empregos_com_populacao), num(a?.populacao));
  const nRem = num(a?.n_rem_dez);
  const fora = empregos !== null && nRem !== null ? empregos - nRem : null;
  const variacao = div((empregos ?? 0) - (num(ant?.empregos) ?? 0), num(ant?.empregos));
  const quebra = anoRais ? quebrasEntre(anoRais - 1, anoRais)[0] : undefined;
  const lista = setores.dados ?? [];
  const totalSet = lista.reduce((s, r) => s + (num(r.empregos) ?? 0), 0);

  const opcaoSetores = useMemo(() => barras(
    SETORES().map(([, n]) => n), SETORES().map(([k]) => num(a?.[`empregos_${k}`])), (v) => numero(v), true,
  ), [serie.dados, anoRais]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!temDados) return <><h2 className="titulo-pagina">{t('Mercado de trabalho', 'Labour market')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Mercado de trabalho: visão geral', 'Labour market: overview')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {anoRais} · {t('vínculos formais ativos em 31/12', 'formal jobs active on Dec 31')} <Dica rotulo={t('Fonte', 'Source')}>{fonteRais()}</Dica></p>
      <BarraFiltros />
      <AvisoAno anoRais={anoRais} />
      <AvisoRecorte pagina={t('a visão geral', 'the overview')} />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !a && t('Sem vínculos na RAIS para este recorte.', 'No RAIS jobs for this scope.')} />
      {a && (
        <>
          <div className="kpis kpis-4">
            <Kpi rotulo={t('Vínculos formais ativos (31/12)', 'Formal jobs active (Dec 31)')} valor={numero(empregos)}
              nota={ant ? <>{t(`${pct(variacao)} sobre ${anoRais! - 1}`, `${pct(variacao)} on ${anoRais! - 1}`)}{quebra && <> · <span title={quebra.texto}>{t('variação observada; atravessa a quebra de ', 'observed change; crosses the break of ')}{quebra.ano}</span></>}</> : undefined} />
            <Kpi rotulo={t('Vínculos por mil habitantes', 'Jobs per thousand inhabitants')} valor={porMil !== null ? numero(1000 * porMil) : '–'}
              nota={t(`população de ${anoRais}; não é taxa de ocupação`, `${anoRais} population; not an employment rate`)}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{notaPorMil(anoRais)}</Dica>} />
            <Kpi rotulo={t('Remuneração média de dezembro', 'Average December pay')} valor={reaisExato(num(a.remuneracao_media))}
              nota={`${t('Real', 'Real')} (R$ dez/${meta.baseIpca}): ${reaisExato(num(a.remuneracao_media_real))} · ${t('regra do PDET', 'PDET rule')}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{notaRemuneracao()}</Dica>} />
            <Kpi rotulo={t('Ativos sem remuneração de dezembro', 'Active jobs without December pay')} valor={`${numero(fora)} (${pct(div(fora, empregos))})`}
              nota={t(`contam como zero na média; ${numero(nRem)} têm o valor`, `counted as zero in the average; ${numero(nRem)} have the value`)} />
            <Kpi rotulo={t('Massa salarial de dezembro', 'December payroll')} valor={reais(num(a.massa_dez))} nota={t('nominal, soma dos valores informados', 'nominal, sum of reported values')} />
            <Kpi rotulo={t('Mulheres', 'Women')} valor={pct(div(num(a.mulheres), empregos))}
              nota={t(`remuneração média das mulheres = ${pct(div(num(a.remuneracao_mulheres), num(a.remuneracao_homens)), 0)} da dos homens (diferença observada)`,
                `women’s average pay = ${pct(div(num(a.remuneracao_mulheres), num(a.remuneracao_homens)), 0)} of men’s (observed difference)`)} />
            <Kpi rotulo={t('Atividade adm. pública (CNAE 84)', 'Public administration activity (CNAE 84)')} valor={pct(div(num(a.empregos_adm_publica), empregos))}
              nota={t('dos vínculos; não é todo o setor público', 'of jobs; not the whole public sector')} dica={<Dica rotulo={t('Classificação', 'Classification')}>{notaSetores()}</Dica>} />
            <Kpi rotulo={t('Estabelecimentos com vínculos ativos', 'Establishments with active jobs')} valor={numero(num(a.estabelecimentos))}
              nota={t(`ensino superior completo: ${pct(div(num(a.superior), empregos))} dos vínculos`, `college degree: ${pct(div(num(a.superior), empregos))} of jobs`)} />
          </div>
          {quebra && <NotaQuebra anos={[anoRais! - 1, anoRais!]} />}
        </>
      )}
      {a && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Vínculos por grande setor (atividade do estabelecimento)', 'Jobs by broad sector (establishment activity)')} desc={`RAIS ${anoRais}`}
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
                colunas: [t('Divisão', 'Division'), t('Atividade', 'Activity'), t('Seção', 'Section'), t('Vínculos ativos', 'Active jobs'),
                  t('Participação', 'Share'), t('Remuneração média (dez, nominal)', 'Average pay (Dec, nominal)')],
                linhas: lista.map((r) => [r.divisao, r.divisao_nome, r.secao_nome, r.empregos, div(num(r.empregos), totalSet), r.remuneracao_media]),
                metadados: [[t('Recorte', 'Scope'), rotulo], [t('Ano', 'Year'), String(anoRais)], [t('Universo', 'Universe'), t('vínculos ativos em 31/12', 'jobs active on Dec 31')],
                  [t('Linhas', 'Rows'), t(`todas as ${lista.length} divisões (a tela mostra 12 de início)`, `all ${lista.length} divisions (the screen first shows 12)`)],
                  [t('Fórmula', 'Formula'), notaRemuneracao()], [t('Fonte', 'Source'), fonteRais()], [t('Versão da base', 'Data version'), meta.geradoEm]],
              })} />
            </div>
            <Estado carregando={setores.carregando} erro={setores.erro} tentarNovamente={setores.recarregar} />
            {lista.length > 0 && (
              <div className="rolagem">
                <table className="tabela-fixa">
                  <thead><tr><th>{t('Atividade', 'Activity')}</th><th>{t('Vínculos', 'Jobs')}</th><th>%</th><th>{t('Remuneração', 'Pay')}</th></tr></thead>
                  <tbody>
                    {(todos ? lista : lista.slice(0, 12)).map((r) => (
                      <tr key={String(r.divisao)}>
                        <td title={`${r.divisao} · ${r.secao_nome ?? ''}`}>{r.divisao} · {String(r.divisao_nome ?? r.divisao)}</td>
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

type Transformacao = 'nivel' | 'var_abs' | 'var_pct' | 'indice';

/** Aplica a transformação a uma série anual: nível, variação absoluta (p.p. para percentuais), variação % ou índice com base 100 no ano-base. */
function transformar(valores: (number | null)[], anos: number[], modo: Transformacao, base: number, percentual: boolean): (number | null)[] {
  if (modo === 'nivel') return valores;
  if (modo === 'indice') {
    const b = valores[anos.indexOf(base)];
    return valores.map((v) => (v === null || !b ? null : (100 * v) / b));
  }
  return valores.map((v, i) => {
    const a = i ? valores[i - 1] : null;
    if (v === null || a === null) return null;
    if (modo === 'var_abs') return percentual ? 100 * (v - a) : v - a;
    return a ? (v - a) / a : null;
  });
}

type SerieConsulta = { fonte: string; linhas: Linha[]; anos: number[]; fatores: Record<number, number>; sql: string };

/** A evolução do recorte da consulta (ocupação, atividade, perfil), com referências da UF e do Brasil quando comparáveis. */
function EvolucaoRecorte({ escopo, rotulo }: { escopo: Params; rotulo: string }) {
  const { meta } = useDados();
  const f = useFiltros();
  const { recorte, definir } = useRecorte();
  const anos = useAnosConsulta();
  const [indicador, setIndicador] = useState<'vinculos' | 'rem_real' | 'mulheres' | 'superior'>('vinculos');
  const [modo, setModo] = useState<Transformacao>('nivel');
  const base = recorte.base && anos.includes(recorte.base) ? recorte.base : anos[0];
  const rec = { ...recorte, situacao: recorte.situacao || 'ativos' };
  const esc = escopo as Record<string, string | number>;
  const principal = useApi<SerieConsulta>('trab_consulta_serie', { ...paramsConsulta(esc, rec), agrupar: 'total' });
  const temListas = !!(Object.keys(rec.listas).length || rec.muns);
  const refUf = f.alvo && f.alvo.esfera === 'M' ? f.alvo.uf : null;
  const ufSerie = useApi<SerieConsulta>(refUf ? 'trab_consulta_serie' : null, { ...paramsConsulta({ uf: refUf! }, rec), agrupar: 'total' });
  // o Brasil vem das tabelas pré-somadas, que não têm os filtros avançados: só entra quando o recorte é comparável
  const brSerie = useApi<SerieConsulta>(Object.keys(esc).length && !temListas ? 'trab_consulta_serie' : null, { ...paramsConsulta({}, rec), agrupar: 'total' });
  const percentual = indicador === 'mulheres' || indicador === 'superior';
  const valor = (s: SerieConsulta | undefined) => (s?.linhas ?? []).map((r) => {
    const fator = s!.fatores[Number(r.ano)];
    if (indicador === 'vinculos') return num(r.vinculos);
    if (indicador === 'rem_real') return num(r.rem_dez_media) === null || !fator ? null : num(r.rem_dez_media)! * fator;
    return div(num(indicador === 'mulheres' ? r.mulheres : r.superior), num(r.vinculos));
  });
  const anosS = (principal.dados?.linhas ?? []).map((r) => Number(r.ano));
  const alinhar = (s: SerieConsulta | undefined) => {
    const m = new Map((s?.linhas ?? []).map((r, i) => [Number(r.ano), valor(s)[i]]));
    return anosS.map((a) => m.get(a) ?? null);
  };
  const series = [
    { nome: rotulo, valores: transformar(valor(principal.dados), anosS, modo, base, percentual) },
    ...(refUf && ufSerie.dados ? [{ nome: refUf, valores: transformar(alinhar(ufSerie.dados), anosS, modo, base, percentual) }] : []),
    ...(brSerie.dados ? [{ nome: t('Brasil', 'Brazil'), valores: transformar(alinhar(brSerie.dados), anosS, modo, base, percentual) }] : []),
  ];
  const formato = modo === 'indice' ? (v: number) => numero1(v)
    : modo === 'var_pct' ? (v: number) => pct(v)
      : percentual ? (modo === 'var_abs' ? (v: number) => `${numero1(v)} p.p.` : (v: number) => pct(v))
        : indicador === 'rem_real' ? reaisCurto : (v: number) => numero(v);
  const nomeInd = {
    vinculos: t(`Vínculos (${rec.situacao === 'ativos' ? 'ativos em 31/12' : 'no recorte'})`, `Jobs (${rec.situacao === 'ativos' ? 'active on Dec 31' : 'in the recorte'})`),
    rem_real: t(`Remuneração média de dezembro, real (R$ dez/${meta.baseIpca})`, `Average December pay, real (Dec/${meta.baseIpca} R$)`),
    mulheres: t('Participação das mulheres', 'Share of women'), superior: t('Participação com superior completo', 'Share with college degree'),
  }[indicador];
  const nomeModo = { nivel: t('nível', 'level'), var_abs: percentual ? t('variação em pontos percentuais', 'change in percentage points') : t('variação absoluta', 'absolute change'), var_pct: t('variação % sobre o ano anterior', '% change on previous year'), indice: t(`índice (${base} = 100)`, `index (${base} = 100)`) }[modo];
  const opcao = useMemo(() => linhas(anosS, series, formato, marcasQuebra(anosS)), [principal.dados, ufSerie.dados, brSerie.dados, indicador, modo, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const nota = notaComparabilidade(anosS);
  return (
    <section className="cartao">
      <div className="cabeca-cartao">
        <div>
          <h3>{t('Evolução do recorte da consulta', 'Recorte over time')}</h3>
          <p className="desc">{nomeInd} · {nomeModo} · {rotulo}{refUf ? `, ${refUf}` : ''}{brSerie.dados ? t(' e Brasil', ' and Brazil') : ''}</p>
        </div>
      </div>
      <EtiquetasRecorte recorte={recorte} definir={definir} />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="e-ind">{t('Indicador', 'Indicator')}</label>
          <select id="e-ind" value={indicador} onChange={(e) => setIndicador(e.target.value as typeof indicador)}>
            <option value="vinculos">{t('Vínculos', 'Jobs')}</option>
            <option value="rem_real">{t('Remuneração média real de dezembro', 'Real average December pay')}</option>
            <option value="mulheres">{t('% mulheres', '% women')}</option>
            <option value="superior">{t('% superior completo', '% college degree')}</option>
          </select>
        </div>
        <div className="campo">
          <label htmlFor="e-modo">{t('Mostrar', 'Show')}</label>
          <select id="e-modo" value={modo} onChange={(e) => setModo(e.target.value as Transformacao)}>
            <option value="nivel">{t('Nível', 'Level')}</option>
            <option value="var_abs">{percentual ? t('Variação em p.p.', 'Change in p.p.') : t('Variação absoluta', 'Absolute change')}</option>
            <option value="var_pct">{t('Variação %', '% change')}</option>
            <option value="indice">{t('Índice (base 100)', 'Index (base 100)')}</option>
          </select>
        </div>
        {modo === 'indice' && (
          <div className="campo">
            <label htmlFor="e-base">{t('Ano-base', 'Base year')}</label>
            <select id="e-base" value={base} onChange={(e) => definir({ base: e.target.value })}>{anos.map((a) => <option key={a}>{a}</option>)}</select>
          </div>
        )}
      </div>
      <Estado carregando={principal.carregando} erro={principal.erro} tentarNovamente={principal.recarregar} cancelar={cancelarConsultasTrabalho} />
      {principal.dados && (
        <>
          <Grafico opcao={opcao} nome="trabalho_evolucao_recorte" descricao={t('Evolução do recorte; anos de quebra da RAIS marcados com linhas tracejadas. Valores na tabela abaixo.', 'Recorte over time; RAIS break years marked with dashed lines. Values in the table below.')} />
          <TabelaSerie nome="trabalho_evolucao_recorte" anos={anosS.map((a) => (quebrasEntre(a - 1, a).length ? `${a} †` : String(a)))}
            colunas={[
              ...series.map((s) => ({ titulo: s.nome, valores: s.valores, formato: (v: number | null) => (v === null ? '–' : formato(v)) })),
              { titulo: t('Ativos com remuneração informada', 'Active jobs with pay reported'), valores: (principal.dados.linhas ?? []).map((r) => num(r.n_rem_dez)), formato: numero },
            ]}
            metadados={[[t('Indicador', 'Indicator'), `${nomeInd} — ${nomeModo}`], [t('Território', 'Territory'), rotulo],
              [t('Referências', 'References'), [refUf, brSerie.dados ? t('Brasil (tabelas pré-somadas)', 'Brazil (pre-aggregated tables)') : null].filter(Boolean).join(', ') || t('nenhuma', 'none')],
              [t('Recorte', 'Recorte'), JSON.stringify({ cbo: rec.cbo, cnae: rec.cnae, situacao: rec.situacao, sexo: rec.sexo, ...rec.listas })],
              ...(nota ? [[t('Comparabilidade', 'Comparability'), nota] as [string, string]] : []), ['SQL', principal.dados.sql]]} />
          <p className="legenda-tabela">† {t('ano com quebra de série apontada pelo MTE.', 'year with a series break reported by the Ministry.')}
            {temListas && Object.keys(esc).length ? ` ${t('O Brasil não aparece: as tabelas pré-somadas não têm os filtros avançados deste recorte.', 'Brazil is not shown: the pre-aggregated tables lack this recorte’s advanced filters.')}` : ''}</p>
        </>
      )}
    </section>
  );
}

export function TrabalhoEvolucao() {
  const { escopo, rotulo, temDados, meta } = useTrabalho();
  const { recorte } = useRecorte();
  const serie = useApi<Linha[]>(temDados ? 'trab_serie' : null, escopo);
  const s = serie.dados ?? [];
  const anos = s.map((r) => r.ano as number);
  const periodo = anos.length ? `${anos[0]}–${anos.at(-1)}` : '';
  const marcas = marcasQuebra(anos);

  const opcaoEmpregos = useMemo(() => linhas(anos, [{ nome: t('Vínculos ativos em 31/12', 'Jobs active on Dec 31'), valores: s.map((r) => num(r.empregos)) }],
    (v) => numero(v), marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoRemun = useMemo(() => linhas(anos, [
    { nome: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((r) => num(r.remuneracao_media_real)) },
    { nome: 'Nominal', valores: s.map((r) => num(r.remuneracao_media)) },
  ], reaisCurto, marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoSetores = useMemo(() => linhas(anos, SETORES().map(([k, n]) => ({ nome: n, valores: s.map((r) => num(r[`empregos_${k}`])) })),
    (v) => numero(v), marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoPerfil = useMemo(() => linhas(anos, [
    { nome: t('Mulheres', 'Women'), valores: s.map((r) => div(num(r.mulheres), num(r.empregos))) },
    { nome: t('Ensino superior', 'College degree'), valores: s.map((r) => div(num(r.superior), num(r.empregos))) },
    { nome: t('Remuneração mulheres ÷ homens', 'Women ÷ men pay'), valores: s.map((r) => div(num(r.remuneracao_mulheres), num(r.remuneracao_homens))) },
  ], (v) => pct(v, 0), marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!temDados) return <><h2 className="titulo-pagina">{t('Mercado de trabalho', 'Labour market')}</h2><SemDados /></>;
  const nota = notaComparabilidade(anos);
  const meta2: [string, string][] = [[t('Recorte', 'Scope'), rotulo], [t('Universo', 'Universe'), t('vínculos ativos em 31/12 (todos)', 'jobs active on Dec 31 (all)')],
    [t('Fonte', 'Source'), fonteRais()], ...(nota ? [[t('Comparabilidade', 'Comparability'), nota] as [string, string]] : [])];
  const anosTabela = anos.map((a) => (quebrasEntre(a - 1, a).length ? `${a} †` : String(a)));
  return (
    <>
      <h2 className="titulo-pagina">{t('Mercado de trabalho: evolução', 'Labour market: trends')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {periodo} <Dica rotulo={t('Fonte', 'Source')}>{fonteRais()}</Dica></p>
      <BarraFiltros semAno />
      <NotaQuebra anos={anos} />
      {temFiltrosDeRecorte(recorte) && <EvolucaoRecorte escopo={escopo} rotulo={rotulo} />}
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar} />
      {s.length > 0 && (
        <>
          {temFiltrosDeRecorte(recorte) && <h3 className="secao">{t('Todos os vínculos do território (sem o recorte)', 'All jobs in the territory (without the recorte)')}</h3>}
          <div className="grade-2">
            <CartaoGrafico titulo={t('Vínculos formais ativos em 31/12', 'Formal jobs active on Dec 31')}
              tabela={<TabelaSerie nome="trabalho_empregos" anos={anosTabela} colunas={[
                { titulo: t('Vínculos ativos', 'Active jobs'), valores: s.map((r) => num(r.empregos)), formato: numero },
                { titulo: t('Estabelecimentos', 'Establishments'), valores: s.map((r) => num(r.estabelecimentos)), formato: numero },
                { titulo: t('Massa salarial de dezembro', 'December payroll'), valores: s.map((r) => num(r.massa_dez)), formato: reais },
              ]} metadados={meta2} />}>
              <Grafico opcao={opcaoEmpregos} nome="trabalho_empregos" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Remuneração média de dezembro', 'Average December pay')}
              desc={t('Nominal e corrigida pelo IPCA de dezembro', 'Nominal and adjusted by December IPCA')}
              acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{notaRemuneracao()}</Dica>}
              tabela={<TabelaSerie nome="trabalho_remuneracao" anos={anosTabela} colunas={[
                { titulo: 'Nominal', valores: s.map((r) => num(r.remuneracao_media)), formato: reaisExato },
                { titulo: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((r) => num(r.remuneracao_media_real)), formato: reaisExato },
                { titulo: t('Com remuneração informada', 'With pay reported'), valores: s.map((r) => num(r.n_rem_dez)), formato: numero },
                { titulo: t('% dos ativos sem valor (zero na média)', '% of active jobs without pay (zero in the average)'), valores: s.map((r) => div((num(r.empregos) ?? 0) - (num(r.n_rem_dez) ?? 0), num(r.empregos))), formato: (v) => pct(v) },
                { titulo: t('Mulheres (nominal)', 'Women (nominal)'), valores: s.map((r) => num(r.remuneracao_mulheres)), formato: reaisExato },
                { titulo: t('Homens (nominal)', 'Men (nominal)'), valores: s.map((r) => num(r.remuneracao_homens)), formato: reaisExato },
              ]} metadados={meta2} />}>
              <Grafico opcao={opcaoRemun} nome="trabalho_remuneracao" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Vínculos por grande setor (atividade)', 'Jobs by broad sector (activity)')}
              acoes={<Dica rotulo={t('Classificação', 'Classification')}>{notaSetores()}</Dica>}
              tabela={<TabelaSerie nome="trabalho_setores_serie" anos={anosTabela}
                colunas={SETORES().map(([k, n]) => ({ titulo: n, valores: s.map((r) => num(r[`empregos_${k}`])), formato: numero }))} metadados={meta2} />}>
              <Grafico opcao={opcaoSetores} nome="trabalho_setores_serie" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Perfil dos vínculos', 'Job profile')}
              desc={t('Participação de mulheres e de pessoas com ensino superior; razão entre as remunerações (diferença observada)', 'Share of women and of college graduates; pay ratio (observed difference)')}
              tabela={<TabelaSerie nome="trabalho_perfil" anos={anosTabela} colunas={[
                { titulo: t('Mulheres', 'Women'), valores: s.map((r) => div(num(r.mulheres), num(r.empregos))), formato: (v) => pct(v) },
                { titulo: t('Ensino superior', 'College degree'), valores: s.map((r) => div(num(r.superior), num(r.empregos))), formato: (v) => pct(v) },
                { titulo: t('Até 24 anos', 'Up to 24'), valores: s.map((r) => div(num(r.ate24), num(r.empregos))), formato: (v) => pct(v) },
                { titulo: t('50 anos ou mais', '50 or older'), valores: s.map((r) => div(num(r.de50mais), num(r.empregos))), formato: (v) => pct(v) },
              ]} metadados={meta2} />}>
              <Grafico opcao={opcaoPerfil} nome="trabalho_perfil" />
            </CartaoGrafico>
          </div>
          <p className="legenda-tabela">† {t('ano com quebra de série apontada pelo MTE (nas tabelas e exportações).', 'year with a series break reported by the Ministry (in tables and exports).')}</p>
        </>
      )}
    </>
  );
}

// ---------------- CAGED ----------------

/** Movimentações do CAGED das famílias da CBO do recorte (UF ou Brasil), com acumulado no ano e mesmo período do ano anterior. */
function CagedOcupacao({ escopo, rotulo, cbo, ate }: { escopo: Params; rotulo: string; cbo: string; ate: number | null }) {
  const { meta } = useDados();
  const r = useApi<Linha[]>('trab_caged_cbo', { ...escopo, cbo });
  const s = r.dados ?? [];
  const comp = s.map((x) => Number(x.competencia));
  const ref = ate && comp.includes(ate) ? ate : comp.at(-1);
  const soma = (de: number, a: number, c: string) => s.filter((x) => Number(x.competencia) >= de && Number(x.competencia) <= a).reduce((t0, x) => t0 + (num(x[c]) ?? 0), 0);
  const meses = s.map((x) => mesAno(Number(x.competencia)));
  const opcao = useMemo(() => linhas(meses, [
    { nome: t('Admissões', 'Hirings'), valores: s.map((x) => num(x.admissoes)) },
    { nome: t('Desligamentos', 'Separations'), valores: s.map((x) => num(x.desligamentos)) },
    { nome: t('Saldo', 'Net balance'), valores: s.map((x) => num(x.saldo)) },
  ], (v) => numero(v)), [r.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const iRef = ref ? comp.indexOf(ref) : -1;
  const atual = iRef >= 0 ? s[iRef] : undefined;
  const ano = ref ? Math.floor(ref / 100) : 0;
  const mes = ref ? ref % 100 : 0;
  const doze = iRef >= 11 ? s.slice(iRef - 11, iRef + 1) : [];
  const cobertura = meta.fontes.caged_cbo as { processado_em?: string } | undefined;
  return (
    <section className="cartao">
      <div className="cabeca-cartao">
        <div>
          <h3>{t(`Ocupação ${cbo} (famílias da CBO) no Novo CAGED`, `Occupation ${cbo} (CBO families) in New CAGED`)}</h3>
          <p className="desc">{rotulo} · {t('empregos celetistas; série com ajustes pela competência da movimentação', 'CLT jobs; adjusted series by month of movement')}</p>
        </div>
        {s.length > 0 && <BotoesExportar nome={`caged_cbo_${cbo.replace(/[^0-9]+/g, '_')}`} obter={() => ({
          colunas: [t('Competência', 'Month'), t('Admissões', 'Hirings'), t('Desligamentos', 'Separations'), t('Saldo', 'Net balance'),
            t('Salário médio de admissão (nominal)', 'Average hiring wage (nominal)'), t('Admissões no cálculo do salário', 'Hirings in the wage average'), t('Admissões fora do cálculo do salário', 'Hirings left out of the wage average')],
          linhas: s.map((x) => [x.competencia, x.admissoes, x.desligamentos, x.saldo, x.salario_medio_admissao, x.salario_adm_n, x.salario_adm_fora]),
          metadados: [[t('Território', 'Territory'), rotulo], [t('Ocupação (famílias CBO, prefixos)', 'Occupation (CBO families, prefixes)'), cbo],
            [t('Universo', 'Universe'), t('movimentações de empregos celetistas', 'movements of CLT jobs')], [t('Fonte', 'Source'), fonteCaged()],
            [t('Salário de admissão', 'Hiring wage'), t('campo salario (mensal) entre 0,3 e 150 salários mínimos da competência; as demais admissões ficam fora e são contadas', 'salario field (monthly) between 0.3 and 150 minimum wages of the month; other hirings are left out and counted')],
            [t('Processado em', 'Processed on'), cobertura?.processado_em ?? ''], [t('Versão da base', 'Data version'), meta.geradoEm]],
        })} />}
      </div>
      <Estado carregando={r.carregando} erro={r.erro} tentarNovamente={r.recarregar}
        vazio={!r.carregando && !r.erro && !s.length && t('Sem movimentações dessa ocupação no recorte.', 'No movements for this occupation in the scope.')} />
      {atual && ref && (
        <>
          <div className="kpis kpis-4">
            <Kpi rotulo={t(`Saldo de ${mesAno(ref)}`, `Net balance, ${mesAno(ref)}`)} valor={numero(num(atual.saldo))}
              nota={`${numero(num(atual.admissoes))} ${t('admissões', 'hirings')} · ${numero(num(atual.desligamentos))} ${t('desligamentos', 'separations')}`} />
            <Kpi rotulo={t(`Acumulado ${MESES()[0]}–${MESES()[mes - 1]}/${ano}`, `${MESES()[0]}–${MESES()[mes - 1]}/${ano} total`)} valor={numero(soma(ano * 100 + 1, ref, 'saldo'))}
              nota={comp.includes((ano - 1) * 100 + 1) ? t(`mesmo período de ${ano - 1}: ${numero(soma((ano - 1) * 100 + 1, (ano - 1) * 100 + mes, 'saldo'))}`, `same period of ${ano - 1}: ${numero(soma((ano - 1) * 100 + 1, (ano - 1) * 100 + mes, 'saldo'))}`) : undefined} />
            <Kpi rotulo={t('Saldo em 12 meses', '12-month balance')} valor={doze.length === 12 ? numero(doze.reduce((t0, x) => t0 + (num(x.saldo) ?? 0), 0)) : '–'}
              nota={doze.length === 12 ? `${mesAno(Number(doze[0].competencia))}–${mesAno(ref)}` : t('menos de 12 meses na série', 'fewer than 12 months in the series')} />
            <Kpi rotulo={t('Salário médio de admissão (nominal)', 'Average hiring wage (nominal)')} valor={reaisExato(num(atual.salario_medio_admissao))}
              nota={t(`N ${numero(num(atual.salario_adm_n))}; ${numero(num(atual.salario_adm_fora))} admissões fora da faixa de 0,3 a 150 salários mínimos`, `N ${numero(num(atual.salario_adm_n))}; ${numero(num(atual.salario_adm_fora))} hirings outside 0.3–150 minimum wages`)} />
          </div>
          <Grafico opcao={opcao} nome="caged_ocupacao" />
        </>
      )}
    </section>
  );
}

export function TrabalhoCaged() {
  const { escopo, rotulo, caged, municipio } = useTrabalho();
  const serie = useApi<Linha[]>(caged ? 'trab_caged' : null, escopo);
  const s = serie.dados ?? [];
  const competencias = s.map((r) => Number(r.competencia));
  const [mesEscolhido, setMes] = useState<number | null>(null);
  const ate = mesEscolhido && competencias.includes(mesEscolhido) ? mesEscolhido : competencias.at(-1) ?? null;
  const iAte = ate ? competencias.indexOf(ate) : -1;
  const atual = iAte >= 0 ? s[iAte] : undefined;
  const secoes = useApi<Linha[]>(caged && ate && !municipio ? 'trab_caged_secoes' : null, { ...escopo, ate });
  const soma = (de: number, ateC: number, c: string) => s.filter((r) => Number(r.competencia) >= de && Number(r.competencia) <= ateC).reduce((t0, r) => t0 + (num(r[c]) ?? 0), 0);
  const ano = ate ? Math.floor(ate / 100) : 0;
  const mes = ate ? ate % 100 : 0;
  const temAnoAnterior = competencias.includes((ano - 1) * 100 + 1);
  const ultimos12 = iAte >= 11 ? s.slice(iAte - 11, iAte + 1) : [];
  const soma12 = (c: string) => ultimos12.reduce((t0, r) => t0 + (num(r[c]) ?? 0), 0);
  const meses = s.map((r) => mesAno(r.competencia as number));
  const periodoAno = `${MESES()[0]}–${MESES()[mes - 1]}/${ano}`;
  const periodoAnt = `${MESES()[0]}–${MESES()[mes - 1]}/${ano - 1}`;

  const opcaoSaldo = useMemo(() => barras(meses, s.map((r) => num(r.saldo)), (v) => numero(v), false),
    [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoMov = useMemo(() => linhas(meses, [
    { nome: t('Admissões', 'Hirings'), valores: s.map((r) => num(r.admissoes)) },
    { nome: t('Desligamentos', 'Separations'), valores: s.map((r) => num(r.desligamentos)) },
  ], (v) => numero(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcao12 = useMemo(() => linhas(meses, [
    { nome: t('Saldo em 12 meses', '12-month net balance'), valores: s.map((r, i) => (i >= 11 ? num(r.saldo_12m) : null)) },
  ], (v) => numero(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const { recorte } = useRecorte();
  const cagedCbo = useDados().meta.fontes.caged_cbo;

  if (!caged) return <><h2 className="titulo-pagina">{t('Novo CAGED', 'New CAGED')}</h2><SemDados /></>;
  const metaC: [string, string][] = [[t('Recorte', 'Scope'), rotulo], [t('Universo', 'Universe'), t('movimentações de empregos celetistas (não inclui estatutários)', 'movements of CLT jobs (statutory jobs not included)')],
    [t('Fonte', 'Source'), fonteCaged()], [t('Última competência carregada', 'Latest month loaded'), caged.ate ? mesAno(caged.ate) : ''],
    [t('Processado em', 'Processed on'), caged.processado_em ?? '']];
  return (
    <>
      <h2 className="titulo-pagina">{t('Empregos formais mês a mês (Novo CAGED)', 'Formal jobs month by month (New CAGED)')}</h2>
      <p className="subtitulo">{rotulo} · {caged.de && caged.ate ? `${mesAno(caged.de)}–${mesAno(caged.ate)}` : ''} <Dica rotulo={t('Fonte', 'Source')}>{fonteCaged()}</Dica></p>
      <BarraFiltros semAno />
      <p className="cobertura" role="note">
        <strong>{t('Atualização', 'Update')}:</strong> {t(`última competência carregada ${caged.ate ? mesAno(caged.ate) : '–'}, processada em ${caged.processado_em ? new Date(caged.processado_em).toLocaleDateString(local()) : '–'}. O MTE divulga cada mês com cerca de um mês de defasagem e às vezes muda a data no calendário; confira os comunicados do Ministério antes de considerar a série desatualizada.`,
          `latest month loaded ${caged.ate ? mesAno(caged.ate) : '–'}, processed on ${caged.processado_em ? new Date(caged.processado_em).toLocaleDateString(local()) : '–'}. The Ministry releases each month with about a month’s lag and sometimes moves the date in its calendar; check the Ministry’s notices before treating the series as out of date.`)}{' '}
        {t('Cobertura: só empregos celetistas; o estoque da RAIS inclui estatutários e outros vínculos, por isso saldo do CAGED e estoque da RAIS não se somam.', 'Coverage: CLT jobs only; the RAIS stock also includes statutory and other jobs, so the CAGED balance and the RAIS stock do not add up.')}
      </p>
      {temFiltrosDeRecorte(recorte) && (
        <p className="aviso" role="status">{cagedCbo && recorte.cbo && !municipio
          ? t('A ocupação do recorte (famílias da CBO) se aplica na seção logo abaixo. Atividade (CNAE) e perfil do trabalhador ainda não estão carregados para o CAGED: o Novo CAGED informa esses dados, mas o painel ainda não tem a tabela somada correspondente. Os demais números da página são de todas as movimentações.',
            'The recorte occupation (CBO families) applies in the section just below. Activity (CNAE) and worker profile are not loaded for CAGED yet: New CAGED reports them, but the dashboard does not have the corresponding summed table yet. The other numbers on the page cover all movements.')
          : t('O recorte da consulta ainda não se aplica a este território no CAGED: a ocupação está disponível para UFs e para o Brasil; atividade (CNAE) e perfil do trabalhador ainda não estão carregados (o Novo CAGED os informa, mas o painel ainda não tem a tabela somada). Os números abaixo são de todas as movimentações.',
            'The query recorte does not apply to this territory in CAGED yet: occupation is available for states and Brazil; activity (CNAE) and worker profile are not loaded yet (New CAGED reports them, but the dashboard does not have the summed table yet). The numbers below cover all movements.')}</p>
      )}
      {cagedCbo && recorte.cbo && !municipio && <CagedOcupacao escopo={escopo} rotulo={rotulo} cbo={recorte.cbo} ate={ate} />}
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !s.length && t('Sem movimentações no CAGED para este recorte.', 'No CAGED movements for this scope.')} />
      {atual && ate && (
        <>
          <div className="filtros">
            <div className="campo">
              <label htmlFor="c-mes">{t('Mês de referência', 'Reference month')}</label>
              <select id="c-mes" value={ate} onChange={(e) => setMes(Number(e.target.value))}>
                {[...competencias].reverse().map((c) => <option key={c} value={c}>{mesAno(c)}</option>)}
              </select>
            </div>
          </div>
          <div className="kpis kpis-4">
            <Kpi rotulo={t(`Saldo de ${mesAno(ate)}`, `Net balance, ${mesAno(ate)}`)} valor={numero(num(atual.saldo))}
              nota={`${numero(num(atual.admissoes))} ${t('admissões', 'hirings')} · ${numero(num(atual.desligamentos))} ${t('desligamentos', 'separations')}`} />
            <Kpi rotulo={t(`Acumulado no ano (${periodoAno})`, `Year to date (${periodoAno})`)} valor={numero(soma(ano * 100 + 1, ate, 'saldo'))}
              nota={temAnoAnterior ? t(`mesmo período de ${ano - 1} (${periodoAnt}): ${numero(soma((ano - 1) * 100 + 1, (ano - 1) * 100 + mes, 'saldo'))}`, `same period of ${ano - 1} (${periodoAnt}): ${numero(soma((ano - 1) * 100 + 1, (ano - 1) * 100 + mes, 'saldo'))}`) : t('sem o ano anterior na série', 'previous year not in the series')} />
            <Kpi rotulo={t('Saldo em 12 meses', '12-month net balance')} valor={ultimos12.length === 12 ? numero(soma12('saldo')) : '–'}
              nota={ultimos12.length === 12 ? `${mesAno(Number(ultimos12[0].competencia))}–${mesAno(ate)} · ${numero(soma12('admissoes'))} ${t('admissões', 'hirings')} · ${numero(soma12('desligamentos'))} ${t('desligamentos', 'separations')}` : t('menos de 12 meses na série', 'fewer than 12 months in the series')} />
            <Kpi rotulo={t('Salário médio de admissão (nominal)', 'Average hiring wage (nominal)')} valor={reaisExato(num(atual.salario_medio_admissao))}
              nota={t('admissões com salário entre 0,3 e 150 salários mínimos do mês; as demais ficam fora da média', 'hirings with wages between 0.3 and 150 minimum wages of the month; the rest are left out')} />
          </div>
          <div className="grade-2">
            <CartaoGrafico titulo={t('Admissões e desligamentos', 'Hirings and separations')}
              tabela={<TabelaSerie nome="caged_mensal" anos={meses} colunas={[
                { titulo: t('Admissões', 'Hirings'), valores: s.map((r) => num(r.admissoes)), formato: numero },
                { titulo: t('Desligamentos', 'Separations'), valores: s.map((r) => num(r.desligamentos)), formato: numero },
                { titulo: t('Saldo', 'Net balance'), valores: s.map((r) => num(r.saldo)), formato: numero },
                { titulo: t('Saldo em 12 meses', '12-month balance'), valores: s.map((r, i) => (i >= 11 ? num(r.saldo_12m) : null)), formato: numero },
                { titulo: t('Salário médio de admissão (nominal)', 'Average hiring wage (nominal)'), valores: s.map((r) => num(r.salario_medio_admissao)), formato: reaisExato },
              ]} metadados={metaC} />}>
              <Grafico opcao={opcaoMov} nome="caged_admissoes_desligamentos" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Saldo mensal (admissões − desligamentos)', 'Monthly net balance (hirings − separations)')}>
              <Grafico opcao={opcaoSaldo} nome="caged_saldo" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Saldo acumulado em 12 meses', 'Rolling 12-month net balance')}>
              <Grafico opcao={opcao12} nome="caged_12m" />
            </CartaoGrafico>
          </div>
        </>
      )}
      {!municipio && (secoes.dados ?? []).length > 0 && ate && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h3>{t('Saldo por setor nos 12 meses até o mês de referência', 'Net balance by sector, 12 months to the reference month')}</h3>
              <p className="desc">{t('Seções da CNAE 2.0', 'CNAE 2.0 sections')} · {t('até', 'through')} {mesAno(ate)}</p>
            </div>
            <BotoesExportar nome="caged_setores_12m" obter={() => ({
              colunas: [t('Seção', 'Section'), t('Atividade', 'Activity'), t('Admissões', 'Hirings'), t('Desligamentos', 'Separations'), t('Saldo', 'Net balance')],
              linhas: (secoes.dados ?? []).map((r) => [r.secao, r.secao_nome, r.admissoes, r.desligamentos, r.saldo]),
              metadados: [...metaC, [t('Período', 'Period'), t(`12 meses até ${mesAno(ate)}`, `12 months through ${mesAno(ate)}`)]],
            })} />
          </div>
          <div className="rolagem">
            <table className="tabela-fixa">
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

type Col = { campo: string; titulo: string; tipo: string; formato: (v: unknown) => string };

export function TrabalhoRankings() {
  const { anoRais, temDados, f, meta } = useTrabalho();
  const { recorte, definir, busca: params } = useRecorte();
  const { search } = useLocation();
  const uf = f.alvo?.uf ?? f.uf ?? undefined;
  const dados = useApi<Linha[]>(temDados && anoRais ? 'trab_municipios' : null, { uf, ano: anoRais });
  const [campoOrd, sentido] = (params.get('rord') ?? 'empregos_por_mil:desc').split(':');
  const ordem = { campo: campoOrd, desc: sentido !== 'asc' };
  const [todos, setTodos] = useState(false);
  const [buscaNome, setBuscaNome] = useState('');
  const quebra = anoRais ? quebrasEntre(anoRais - 1, anoRais)[0] : undefined;
  const caged = meta.fontes.caged as { ate?: number } | undefined;
  const primeiro = dados.dados?.[0];
  const meses = num(primeiro?.meses_caged) ?? 12;
  const periodoCaged = `${MESES()[0]}–${MESES()[meses - 1]}/${anoRais}`;
  const colunas: Col[] = [
    { campo: 'empregos', tipo: t('volume', 'volume'), titulo: t('Vínculos ativos', 'Active jobs'), formato: (v) => numero(num(v)) },
    { campo: 'empregos_por_mil', tipo: t('intensidade', 'intensity'), titulo: t('Vínculos por mil hab.', 'Jobs per 1,000 inh.'), formato: (v) => numero(num(v)) },
    { campo: 'remuneracao_media', tipo: t('remuneração', 'pay'), titulo: t('Remuneração média (dez)', 'Average pay (Dec)'), formato: (v) => reaisExato(num(v)) },
    { campo: 'n_rem_dez', tipo: t('remuneração', 'pay'), titulo: t('Com valor (rem.)', 'With pay value'), formato: (v) => numero(num(v)) },
    { campo: 'var_empregos', tipo: t('crescimento', 'growth'), titulo: t(`Variação dos vínculos sobre ${(anoRais ?? 0) - 1}${quebra ? ' †' : ''}`, `Change in jobs on ${(anoRais ?? 0) - 1}${quebra ? ' †' : ''}`), formato: (v) => pct(num(v)) },
    { campo: 'saldo_caged', tipo: t('crescimento', 'growth'), titulo: t(`Saldo CAGED ${periodoCaged}`, `CAGED balance ${periodoCaged}`), formato: (v) => numero(num(v)) },
    { campo: 'pct_mulheres', tipo: t('perfil', 'profile'), titulo: t('% mulheres', '% women'), formato: (v) => pct(num(v)) },
    { campo: 'pct_superior', tipo: t('perfil', 'profile'), titulo: t('% superior', '% college'), formato: (v) => pct(num(v)) },
    { campo: 'pct_adm_publica', tipo: t('perfil', 'profile'), titulo: t('% atividade adm. pública (CNAE 84)', '% public adm. activity (CNAE 84)'), formato: (v) => pct(num(v)) },
  ];
  const universo = useMemo(() => (dados.dados ?? []).filter((r) => (num(r.empregos) ?? 0) >= recorte.min), [dados.dados, recorte.min]);
  const ordenados = useMemo(() => [...universo].sort((x, y) => {
    const a = num(x[ordem.campo]);
    const b = num(y[ordem.campo]);
    if (a === null) return 1;
    if (b === null) return -1;
    return (a - b) * (ordem.desc ? -1 : 1);
  }), [universo, ordem.campo, ordem.desc]);
  const posicao = new Map(ordenados.map((r, i) => [r.cod_ibge, i + 1]));
  const termo = buscaNome.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtrados = termo ? ordenados.filter((r) => String(r.nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo)) : ordenados;
  const visiveis = todos || termo ? filtrados : filtrados.slice(0, 50);
  const escolhido = f.alvo && f.alvo.esfera === 'M' ? ordenados.find((r) => r.cod_ibge === f.alvo!.cod_ibge) : undefined;
  const escopo = uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil');
  const colOrd = colunas.find((c) => c.campo === ordem.campo);
  const mediana = (c: string) => {
    const v = universo.map((r) => num(r[c])).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null;
  };

  if (!temDados) return <><h2 className="titulo-pagina">{t('Rankings do mercado de trabalho', 'Labour market rankings')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Rankings do mercado de trabalho', 'Labour market rankings')}</h2>
      <p className="subtitulo">{escopo} · RAIS {anoRais} <Dica rotulo={t('Fonte', 'Source')}>{fonteRais()} {fonteCaged()}</Dica></p>
      <BarraFiltros semEnte={t('O município escolhido define a UF do ranking e aparece destacado, com a sua posição.', 'The chosen municipality sets the state of the ranking and is highlighted, with its position.')} />
      <AvisoAno anoRais={anoRais} />
      <AvisoRecorte pagina={t('o ranking', 'the ranking')} />
      {quebra && <NotaQuebra anos={[anoRais! - 1, anoRais!]} />}
      {escolhido && colOrd && (
        <div className="destaque-ente" role="status">
          <strong>{String(escolhido.nome)}</strong>: {t(`posição ${posicao.get(escolhido.cod_ibge)} de ${ordenados.length}`, `rank ${posicao.get(escolhido.cod_ibge)} of ${ordenados.length}`)} {t('em', 'in')} {colOrd.titulo.toLowerCase()} ({colOrd.formato(escolhido[ordem.campo])}; {t('mediana dos municípios', 'municipal median')}: {colOrd.formato(mediana(ordem.campo))}){' · '}
          {t(`vínculos ativos ${numero(num(escolhido.empregos))}`, `active jobs ${numero(num(escolhido.empregos))}`)}{' · '}
          <Link to={`/trabalho${search}`}>{t('ver o município na visão geral', 'see the municipality in the overview')}</Link>
        </div>
      )}
      {f.alvo && f.alvo.esfera === 'M' && !escolhido && dados.dados && (
        <p className="aviso" role="status">{t(`${f.rotulo} não entra no ranking com o tamanho mínimo escolhido (ou não tem vínculos na RAIS ${anoRais}).`, `${f.rotulo} is not in the ranking with the chosen minimum size (or has no RAIS ${anoRais} jobs).`)}</p>
      )}
      <section className="cartao">
        <div className="filtros">
          <div className="campo">
            <label htmlFor="r-busca">{t('Buscar município', 'Search municipality')}</label>
            <input id="r-busca" value={buscaNome} onChange={(e) => setBuscaNome(e.target.value)} placeholder={t('nome…', 'name…')} />
          </div>
          <div className="campo">
            <label htmlFor="r-min">{t('Tamanho mínimo (vínculos ativos)', 'Minimum size (active jobs)')}</label>
            <select id="r-min" value={recorte.min} onChange={(e) => definir({ min: Number(e.target.value) || null })}>
              {[0, 100, 1000, 10000, 100000].map((v) => <option key={v} value={v}>{v ? `≥ ${numero(v)}` : t('todos', 'all')}</option>)}
            </select>
          </div>
        </div>
        <div className="cabeca-cartao">
          <p className="desc">{t(`Universo: ${numero(universo.length)} municípios${recorte.min ? ` com pelo menos ${numero(recorte.min)} vínculos ativos` : ''}. Clique no título de uma coluna para ordenar (a ordem vai no endereço da página). Volume, intensidade, remuneração e crescimento são rankings diferentes; a remuneração traz ao lado quantos ativos têm o valor (os demais contam como zero).`,
            `Universe: ${numero(universo.length)} municipalities${recorte.min ? ` with at least ${numero(recorte.min)} active jobs` : ''}. Click a column header to sort (the order goes in the page address). Volume, intensity, pay and growth are different rankings; pay comes with how many active jobs have the value (the rest count as zero).`)}{' '}
            <Dica rotulo={t('Vínculos por mil habitantes', 'Jobs per thousand inhabitants')}>{notaPorMil(anoRais)}</Dica></p>
          <BotoesExportar nome={`trabalho_ranking_${anoRais}`} obter={() => ({
            colunas: [t('Posição', 'Rank'), 'cod_ibge', t('Município', 'Municipality'), 'UF', t('População', 'Population'), ...colunas.map((c) => c.titulo),
              t('Vínculos ativos no ano anterior', 'Active jobs in the previous year'), t('Estabelecimentos', 'Establishments'), t('Meses de CAGED no ano', 'CAGED months in year'),
              t('Saldo CAGED no mesmo período do ano anterior', 'CAGED balance, same period of previous year')],
            linhas: ordenados.map((r, i) => [i + 1, String(r.cod_ibge), r.nome, r.uf, r.populacao, ...colunas.map((c) => r[c.campo]), r.empregos_ano_anterior, r.estabelecimentos, r.meses_caged,
              num(r.meses_caged_ano_anterior) === num(r.meses_caged) ? r.saldo_caged_ano_anterior : null]),
            metadados: [[t('Recorte', 'Scope'), escopo], [t('Ano', 'Year'), String(anoRais)], [t('Ordenação', 'Sorting'), `${colOrd?.titulo ?? ordem.campo} (${ordem.desc ? t('decrescente', 'descending') : t('crescente', 'ascending')})`],
              [t('Universo', 'Universe'), t(`${ordenados.length} municípios${recorte.min ? `, mínimo de ${recorte.min} vínculos ativos` : ''}; todas as linhas (a tela mostra 50 de início)`, `${ordenados.length} municipalities${recorte.min ? `, minimum ${recorte.min} active jobs` : ''}; all rows (the screen first shows 50)`)],
              [t('Vínculos por mil habitantes', 'Jobs per thousand inhabitants'), notaPorMil(anoRais)], [t('Remuneração', 'Pay'), notaRemuneracao()],
              [t('Saldo CAGED', 'CAGED balance'), t(`competências de ${periodoCaged}; o saldo do ano anterior só aparece com o mesmo número de meses${caged?.ate ? `; última competência carregada ${mesAno(caged.ate)}` : ''}`, `months ${periodoCaged}; the previous-year balance only appears with the same number of months${caged?.ate ? `; latest month loaded ${mesAno(caged.ate)}` : ''}`)],
              ...(quebra ? [[t('Comparabilidade', 'Comparability'), notaComparabilidade([anoRais! - 1, anoRais!])!] as [string, string]] : []),
              [t('Fonte', 'Source'), `${fonteRais()} ${fonteCaged()}`], [t('Versão da base', 'Data version'), meta.geradoEm], [t('Endereço', 'Address'), location.href]],
          })} />
        </div>
        <Estado carregando={dados.carregando} erro={dados.erro} tentarNovamente={dados.recarregar} />
        {ordenados.length > 0 && (
          <>
            <div className="rolagem">
              <table className="tabela-fixa">
                <thead>
                  <tr>
                    <th>{t('Município', 'Municipality')}</th><th>#</th>
                    {colunas.map((c) => (
                      <th key={c.campo} aria-sort={ordem.campo === c.campo ? (ordem.desc ? 'descending' : 'ascending') : 'none'} title={c.tipo}>
                        <button className="valor-exato" onClick={() => definir({ rord: `${c.campo}:${ordem.campo === c.campo && ordem.desc ? 'asc' : 'desc'}` })}>
                          {c.titulo}{ordem.campo === c.campo ? (ordem.desc ? ' ▼' : ' ▲') : ''}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r) => (
                    <tr key={String(r.cod_ibge)} className={f.alvo?.cod_ibge === r.cod_ibge ? 'destaque' : undefined}>
                      <td><Link to={`/trabalho?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(search)), ente: String(r.cod_ibge), uf: String(r.uf) })}`}>{String(r.nome)}{uf ? '' : ` (${r.uf})`}</Link></td>
                      <td>{(posicao.get(r.cod_ibge) ?? 0).toLocaleString(local())}</td>
                      {colunas.map((c) => <td key={c.campo}>{c.formato(r[c.campo])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="legenda-tabela">
              {!todos && !termo && ordenados.length > 50 ? t(`Mostrando 50 de ${numero(ordenados.length)}. `, `Showing 50 of ${numero(ordenados.length)}. `) : ''}
              {ordenados.length > 50 && !termo && <button className="limpar" onClick={() => setTodos(!todos)}>{todos ? t('mostrar menos', 'show fewer') : t('mostrar todos', 'show all')}</button>}
              {quebra ? ` † ${t(`a variação de ${anoRais! - 1} para ${anoRais} atravessa a quebra de série de ${quebra.ano}: é observada, não necessariamente geração de empregos.`, `the change from ${anoRais! - 1} to ${anoRais} crosses the ${quebra.ano} series break: it is observed, not necessarily job creation.`)}` : ''}
              {' '}{t('Clique no município para abrir o detalhamento.', 'Click a municipality to open its details.')}
            </p>
          </>
        )}
      </section>
    </>
  );
}

