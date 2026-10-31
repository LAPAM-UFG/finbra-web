import { useMemo } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar, type Tabela } from '../components/Exportar';
import { CartaoGrafico, Grafico, linhas as graficoLinhas } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { FormularioRecorte, paramsConsulta, useAnosConsulta, useTerritorioTrabalho } from '../components/RecorteTrabalho';
import { BarraFiltros, useDados } from '../contexto';
import { cancelarConsultasTrabalho, fonteConsulta } from '../dados';
import { baixarArquivo, nomeArquivo, paraXlsxAbas, type Celula } from '../exportar';
import { div, numero, pct, reaisCurto, reaisExato } from '../format';
import { num } from '../hooks';
import { idioma, t } from '../idioma';
import { baixarPacote, marcasQuebra, notaComparabilidade, pequeno, quebrasEntre, useRecorte, type Recorte } from '../trabalho_comum';
import { metadadosConsulta, notaDefinicoes, notaFonte, type ResultadoConsulta } from './TrabalhoConsulta';

type Serie = ResultadoConsulta & { anos: number[]; fatores: Record<number, number> };
type Perfil = ResultadoConsulta & { dimensoes: string[] };

/** As sete tabelas do perfil e as dimensões (subtabelas) de cada uma. */
const TABELAS = (territorio: 'municipio' | 'uf' | 'brasil') => [
  { n: 3, titulo: t('Composição ocupacional', 'Occupational composition'), desc: t('Códigos e nomes das ocupações (6 dígitos) que formam o recorte, com vínculos, participação e remuneração.', 'Codes and names of the occupations (6 digits) in the recorte, with jobs, share and pay.'),
    dims: [['cbo', t('Ocupação (CBO 2002)', 'Occupation (CBO 2002)')]] },
  { n: 4, titulo: t('Inserção setorial e institucional', 'Sectoral and institutional placement'), desc: t('Atividade do estabelecimento (CNAE) e natureza jurídica em subtabelas separadas: são conceitos diferentes.', 'Establishment activity (CNAE) and legal nature in separate sub-tables: they are different concepts.'),
    dims: [['cnae_secao', t('Atividade econômica do estabelecimento (CNAE, seção)', 'Economic activity of the establishment (CNAE, section)')],
      ['setor_institucional', t('Setor institucional (natureza jurídica)', 'Institutional sector (legal nature)')],
      ['esfera_adm', t('Esfera administrativa (natureza jurídica)', 'Level of government (legal nature)')]] },
  { n: 5, titulo: t('Perfil sociodemográfico', 'Socio-demographic profile'), desc: t('Sexo, idade, raça/cor e escolaridade, com a categoria sem informação quando houver.', 'Sex, age, race/colour and education, with the not-reported category when present.'),
    dims: [['sexo', t('Sexo', 'Sex')], ['faixa_idade', t('Faixa de idade', 'Age group')], ['raca_cor', t('Raça/cor', 'Race/colour')], ['escolaridade', t('Escolaridade', 'Education')]] },
  { n: 6, titulo: t('Distribuição territorial', 'Territorial distribution'), desc: territorio === 'brasil' ? t('UFs do estabelecimento.', 'States of the establishment.') : territorio === 'uf' ? t('Municípios do estabelecimento, com a concentração.', 'Municipalities of the establishment, with concentration.') : t('O município ao lado da UF e do Brasil, no mesmo recorte.', 'The municipality next to its state and Brazil, in the same recorte.'),
    dims: territorio === 'brasil' ? [['uf', 'UF']] : territorio === 'uf' ? [['municipio', t('Município', 'Municipality')]] : [] },
  { n: 7, titulo: t('Características dos vínculos', 'Job characteristics'), desc: t('Jornada contratual, tempo no emprego, tipo de vínculo, porte do estabelecimento e afastamentos.', 'Contracted hours, job tenure, type of contract, establishment size and leaves.'),
    dims: [['faixa_horas', t('Jornada contratual semanal', 'Contracted weekly hours')], ['faixa_tempo', t('Tempo no emprego', 'Job tenure')],
      ['vinculo_mte', t('Tipo de vínculo (agregação do MTE)', 'Type of contract (MTE grouping)')], ['tamanho_estab', t('Tamanho do estabelecimento', 'Establishment size')],
      ['causa_afastamento', t('Causa do afastamento no ano (primeira)', 'Reason for leave in the year (first)')]] },
];

const rotuloGrupo = (r: Linha) => (r.grupo === null || r.grupo === undefined ? t('(não informado)', '(not reported)') : r.nome ? `${r.grupo} · ${r.nome}` : `${r.grupo} · ${t('código sem nome no dicionário', 'code without a name in the dictionary')}`);

/** Linhas de uma distribuição: grupo, vínculos, participação, remuneração e Ns. Valores em reais já multiplicados pelo fator. */
function linhasDistribuicao(lista: Linha[], total: Linha | undefined, fator: number): Celula[][] {
  const m = (v: unknown) => (num(v) === null ? null : num(v)! * fator);
  return lista.map((r) => [r.grupo === null ? null : String(r.grupo), r.nome ?? null, num(r.vinculos), div(num(r.vinculos), num(total?.vinculos)),
    m(r.rem_dez_media), m(r.rem_dez_mediana), num(r.n_rem_dez), div((num(r.ativos) ?? 0) - (num(r.n_rem_dez) ?? 0), num(r.ativos)), div(num(r.mulheres), num(r.vinculos))]);
}
const COLUNAS_DIST = () => [t('Código', 'Code'), t('Nome', 'Name'), t('Vínculos ativos', 'Active jobs'), t('Participação', 'Share'),
  t('Rem. dezembro (média)', 'December pay (avg)'), t('Rem. dezembro (mediana)', 'December pay (median)'), t('Com valor (rem.)', 'With pay value'),
  t('% sem valor (zero na média)', '% without pay (zero in the average)'), t('% mulheres', '% women')];

function TabelaDistribuicao({ linhas, total, fator, micro, nmin }: { linhas: Linha[]; total: Linha | undefined; fator: number; micro: boolean; nmin: number }) {
  const m = (v: unknown) => (num(v) === null ? null : num(v)! * fator);
  return (
    <div className="rolagem">
      <table className="tabela-fixa">
        <thead><tr>{[t('Grupo', 'Group'), ...COLUNAS_DIST().slice(2)].map((c, i) => (i === 4 && !micro ? null : <th key={c}>{c}</th>))}</tr></thead>
        <tbody>
          {linhas.map((r) => {
            const n = num(r.n_rem_dez);
            const p = pequeno(n, nmin);
            return (
              <tr key={String(r.grupo)}>
                <td>{rotuloGrupo(r)}</td>
                <td>{numero(num(r.vinculos))}</td>
                <td>{pct(div(num(r.vinculos), num(total?.vinculos)))}</td>
                <td className={p ? 'n-pequeno' : undefined}>{reaisExato(m(r.rem_dez_media))}{p && n ? ' ‡' : ''}</td>
                {micro && <td className={p ? 'n-pequeno' : undefined}>{reaisExato(m(r.rem_dez_mediana))}{p && n ? ' ‡' : ''}</td>}
                <td>{numero(n)}</td>
                <td>{pct(div((num(r.ativos) ?? 0) - (n ?? 0), num(r.ativos)))}</td>
                <td>{pct(div(num(r.mulheres), num(r.vinculos)))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Concentração territorial: índice de Herfindahl-Hirschman (soma das participações ao quadrado) e participação dos 5 maiores. */
function concentracao(linhas: Linha[]) {
  const tot = linhas.reduce((s, r) => s + (num(r.vinculos) ?? 0), 0);
  if (!tot) return null;
  const partes = linhas.map((r) => (num(r.vinculos) ?? 0) / tot).sort((a, b) => b - a);
  return { hhi: partes.reduce((s, p) => s + p * p, 0), top5: partes.slice(0, 5).reduce((s, p) => s + p, 0), n: partes.filter((p) => p > 0).length };
}

export function TrabalhoPerfil() {
  const { meta } = useDados();
  const { f, escopo, rotulo, tipo } = useTerritorioTrabalho();
  const anos = useAnosConsulta();
  const { recorte, definir } = useRecorte();
  const fonte = fonteConsulta(escopo);
  const micro = fonte === 'micro';
  const ate = recorte.ate && anos.includes(recorte.ate) ? recorte.ate : (anos.includes(f.ano) ? f.ano : anos.at(-1)!);
  const de = recorte.de && anos.includes(recorte.de) && recorte.de <= ate ? recorte.de : anos[0];
  const anosPeriodo = anos.filter((a) => a >= de && a <= ate);
  // o perfil descreve os vínculos ativos em 31/12 (o estoque), como os totais divulgados pelo MTE
  const rec: Recorte = { ...recorte, situacao: 'ativos' };
  const pronto = !!recorte.cbo;
  const dimensoes = TABELAS(tipo).flatMap((x) => x.dims.map(([d]) => d));
  const p = pronto ? paramsConsulta(escopo, rec) : null;
  const serie = useApi<Serie>(p ? 'trab_consulta_serie' : null, { ...p, de, ate, agrupar: 'total' });
  const universo = useApi<Serie>(p ? 'trab_consulta_serie' : null, { ...escopo, situacao: 'ativos', de, ate, agrupar: 'total' });
  const perfil = useApi<Perfil>(p ? 'trab_perfil' : null, { ...p, ano: ate, dimensoes: dimensoes.join(',') });
  const ufCmp = useApi<ResultadoConsulta>(p && tipo === 'municipio' && f.alvo ? 'trab_consulta' : null, { ...paramsConsulta({ uf: f.alvo?.uf ?? '' }, rec), ano: ate, agrupar: 'total' });
  const brCmp = useApi<ResultadoConsulta>(p && tipo === 'municipio' ? 'trab_consulta' : null, { ...paramsConsulta({}, { ...rec, listas: {} }), ano: ate, agrupar: 'total' });

  const real = recorte.moeda === 'real';
  const fatorRef = real ? perfil.dados?.fator_real ?? 1 : 1;
  const moedaTexto = real ? t(`R$ de dezembro de ${meta.baseIpca} (IPCA de dezembro)`, `December ${meta.baseIpca} R$ (December IPCA)`) : t('R$ nominais de cada ano', 'nominal R$ of each year');
  const total = perfil.dados?.linhas.find((r) => r.dimensao === 'total');
  const daDim = (d: string) => (perfil.dados?.linhas ?? []).filter((r) => r.dimensao === d);
  const temDim = (d: string) => !!perfil.dados?.dimensoes.includes(d);
  const processado = (meta.fontes.rais_micro as { processado_em?: string } | undefined)?.processado_em;
  const notaQuebra = notaComparabilidade(anosPeriodo);

  // tabelas 1 e 2: uma linha por ano
  const porAno = useMemo(() => {
    const u = new Map((universo.dados?.linhas ?? []).map((r) => [Number(r.ano), r]));
    return (serie.dados?.linhas ?? []).map((r) => ({ ano: Number(r.ano), r, u: u.get(Number(r.ano)), fator: serie.dados?.fatores[Number(r.ano)] ?? null }));
  }, [serie.dados, universo.dados]);
  const anosSerie = porAno.map((x) => x.ano);
  const tabela1 = (): Tabela => ({
    colunas: [t('Ano', 'Year'), t('Vínculos ativos em 31/12', 'Active jobs on Dec 31'), t('Vínculos ativos do território', 'Active jobs in the territory'),
      t('Participação no emprego formal do território', 'Share of the territory’s formal jobs'), t('Variação % sobre o ano anterior', '% change on previous year'),
      t('% mulheres', '% women'), t('% superior completo', '% college degree'), t('Quebra de série no ano (MTE)', 'Series break in the year (MTE)')],
    linhas: porAno.map((x, i) => [x.ano, num(x.r.vinculos), num(x.u?.vinculos), div(num(x.r.vinculos), num(x.u?.vinculos)),
      i ? div((num(x.r.vinculos) ?? 0) - (num(porAno[i - 1].r.vinculos) ?? 0), num(porAno[i - 1].r.vinculos)) : null,
      div(num(x.r.mulheres), num(x.r.vinculos)), div(num(x.r.superior), num(x.r.vinculos)), quebrasEntre(x.ano - 1, x.ano).length ? t('sim', 'yes') : '']),
    metadados: metaPerfil(t('1. Série histórica', '1. Time series'), serie.dados?.sql),
  });
  const tabela2 = (): Tabela => ({
    colunas: [t('Ano', 'Year'), t('Rem. dezembro, média nominal', 'December pay, nominal average'), t(`Rem. dezembro, média real (R$ dez/${meta.baseIpca})`, `December pay, real average (Dec/${meta.baseIpca} R$)`),
      t('Mediana nominal', 'Nominal median'), t('Mediana real', 'Real median'), t('Com valor informado', 'With pay reported'), t('Ativos sem valor (zero na média)', 'Active jobs without pay (zero in the average)'), t('% sem valor', '% without pay'),
      t('Fator IPCA (dez/ano-base ÷ dez/ano)', 'IPCA factor (Dec base ÷ Dec year)')],
    linhas: porAno.map((x) => {
      const fora = (num(x.r.ativos) ?? 0) - (num(x.r.n_rem_dez) ?? 0);
      return [x.ano, num(x.r.rem_dez_media), x.fator && num(x.r.rem_dez_media) !== null ? num(x.r.rem_dez_media)! * x.fator : null,
        num(x.r.rem_dez_mediana), x.fator && num(x.r.rem_dez_mediana) !== null ? num(x.r.rem_dez_mediana)! * x.fator : null,
        num(x.r.n_rem_dez), fora, div(fora, num(x.r.ativos)), x.fator];
    }),
    metadados: metaPerfil(t('2. Remuneração ao longo do tempo', '2. Pay over time'), serie.dados?.sql),
  });
  const tabelaDim = (titulo: string, d: string): Tabela => ({
    colunas: COLUNAS_DIST(),
    linhas: temDim(d) ? linhasDistribuicao(daDim(d), total, fatorRef) : [],
    metadados: metaPerfil(titulo, perfil.dados?.sql, temDim(d) ? [] : [[t('Situação', 'Status'), t('indisponível nesta fonte: escolha uma UF ou um município (microdados)', 'unavailable in this source: choose a state or municipality (microdata)')]]),
  });
  function metaPerfil(titulo: string, sql?: string, extra: [string, string][] = []): [string, string][] {
    return metadadosConsulta({
      rotulo, ano: titulo.startsWith('1') || titulo.startsWith('2') ? `${de}–${ate}` : ate, recorte: rec, fonte, total, moeda: titulo.startsWith('2') ? t('nominal e real (colunas separadas)', 'nominal and real (separate columns)') : moedaTexto,
      geradoEm: meta.geradoEm, processado, sql,
      extra: [[t('Tabela', 'Table'), titulo], ...(notaQuebra && (titulo.startsWith('1') || titulo.startsWith('2')) ? [[t('Comparabilidade', 'Comparability'), notaQuebra] as [string, string]] : []), ...extra],
    });
  }
  const todas = (): { nome: string; tabela: Tabela; sql?: string }[] => [
    { nome: t('1 série histórica', '1 time series'), tabela: tabela1(), sql: serie.dados?.sql },
    { nome: t('2 remuneração', '2 pay'), tabela: tabela2(), sql: serie.dados?.sql },
    ...TABELAS(tipo).flatMap((x) => x.dims.map(([d, nome]) => ({ nome: `${x.n} ${nome}`, tabela: tabelaDim(`${x.n}. ${x.titulo}: ${nome}`, d), sql: perfil.dados?.sql }))),
    ...(tipo === 'municipio' ? [{ nome: t('6 comparação territorial', '6 territorial comparison'), tabela: tabelaComparacao() }] : []),
  ];
  function tabelaComparacao(): Tabela {
    const linhas = [[rotulo, total], [f.alvo?.uf ?? 'UF', ufCmp.dados?.linhas[0]], [t('Brasil', 'Brazil'), brCmp.dados?.linhas[0]]] as [string, Linha | undefined][];
    return {
      colunas: [t('Território', 'Territory'), t('Vínculos ativos', 'Active jobs'), t('Rem. dezembro (média)', 'December pay (avg)'), t('Rem. dezembro (mediana)', 'December pay (median)'), t('Com valor informado', 'With pay reported'), t('% mulheres', '% women'), t('% superior', '% college')],
      linhas: linhas.map(([n, r]) => [n, num(r?.vinculos), num(r?.rem_dez_media) === null ? null : num(r?.rem_dez_media)! * fatorRef,
        num(r?.rem_dez_mediana) === null ? null : num(r?.rem_dez_mediana)! * fatorRef, num(r?.n_rem_dez), div(num(r?.mulheres), num(r?.vinculos)), div(num(r?.superior), num(r?.vinculos))]),
      metadados: metaPerfil(t('6. Distribuição territorial: comparação', '6. Territorial distribution: comparison'), undefined,
        [[t('Brasil', 'Brazil'), t('tabelas pré-somadas (sem mediana; filtros avançados não se aplicam ao Brasil)', 'pre-aggregated tables (no median; advanced filters do not apply to Brazil)')]]),
    };
  }
  const exportarTudo = () => {
    const abas = todas();
    const xlsx = paraXlsxAbas([
      { nome: t('metadados', 'metadata'), linhas: [[t('Campo', 'Field'), t('Valor', 'Value')], ...metaPerfil(t('Perfil da ocupação: conjunto completo', 'Occupation profile: full set'), perfil.dados?.sql)] },
      ...abas.map((a) => ({ nome: a.nome.slice(0, 31), linhas: [a.tabela.colunas, ...a.tabela.linhas] })),
    ]);
    baixarArquivo(`${nomeArquivo(`perfil_ocupacao_${recorte.cbo}_${ate}`)}.xlsx`, xlsx as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };

  const opcaoSerie = useMemo(() => graficoLinhas(anosSerie, [{ nome: t('Vínculos ativos em 31/12', 'Active jobs on Dec 31'), valores: porAno.map((x) => num(x.r.vinculos)) }],
    (v) => numero(v), marcasQuebra(anosSerie)), [porAno]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoRem = useMemo(() => graficoLinhas(anosSerie, [
    { nome: t(`Média real (R$ dez/${meta.baseIpca})`, `Real average (Dec/${meta.baseIpca} R$)`), valores: porAno.map((x) => (x.fator && num(x.r.rem_dez_media) !== null ? num(x.r.rem_dez_media)! * x.fator : null)) },
    ...(micro ? [{ nome: t('Mediana real', 'Real median'), valores: porAno.map((x) => (x.fator && num(x.r.rem_dez_mediana) !== null ? num(x.r.rem_dez_mediana)! * x.fator : null)) }] : []),
    { nome: t('Média nominal', 'Nominal average'), valores: porAno.map((x) => num(x.r.rem_dez_media)) },
  ], reaisCurto, marcasQuebra(anosSerie)), [porAno]); // eslint-disable-line react-hooks/exhaustive-deps

  const carregando = serie.carregando || perfil.carregando;
  const erro = serie.erro ?? perfil.erro;
  const recarregar = () => { serie.recarregar(); universo.recarregar(); perfil.recarregar(); };

  return (
    <>
      <h2 className="titulo-pagina">{t('Perfil da ocupação', 'Occupation profile')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {de}–{ate} · {t('vínculos ativos em 31/12', 'jobs active on Dec 31')} <Dica rotulo={t('Fonte', 'Source')}>{notaFonte()}</Dica></p>
      <BarraFiltros semAno />
      <p className="cobertura" role="note">{t(
        'Diagnóstico padronizado de uma ocupação ou família da CBO: sete tabelas, cada uma exportável, e o conjunto completo em Excel ou em pacote de pesquisa. A CBO é a ocupação exercida no vínculo, não a formação nem o registro profissional.',
        'Standard diagnosis of a CBO occupation or family: seven tables, each exportable, and the full set in Excel or as a research package. CBO is the occupation performed in the job, not training or professional registration.',
      )} {micro ? '' : t('Nesta fonte (tabelas pré-somadas do Brasil) parte das tabelas fica indisponível: escolha uma UF ou um município para os microdados.', 'In this source (pre-aggregated tables for Brazil) some tables are unavailable: choose a state or municipality for the microdata.')}</p>
      <FormularioRecorte recorte={recorte} definir={(n) => { cancelarConsultasTrabalho(); definir(n); }} micro={micro} rotuloAplicar={t('Gerar perfil', 'Build profile')}
        extra={(
          <>
            <div className="campo">
              <label htmlFor="p-de">{t('De', 'From')}</label>
              <select id="p-de" value={de} onChange={(e) => definir({ de: e.target.value })}>{anos.map((a) => <option key={a}>{a}</option>)}</select>
            </div>
            <div className="campo">
              <label htmlFor="p-ate">{t('Até (ano de referência)', 'To (reference year)')}</label>
              <select id="p-ate" value={ate} onChange={(e) => definir({ ate: e.target.value })}>{anos.map((a) => <option key={a}>{a}</option>)}</select>
            </div>
            <div className="campo">
              <label htmlFor="p-moeda">{t('Valores em reais', 'Values in R$')}</label>
              <select id="p-moeda" value={recorte.moeda} onChange={(e) => definir({ moeda: e.target.value === 'real' ? 'real' : null })}>
                <option value="nominal">{t('Nominais', 'Nominal')}</option>
                <option value="real">{t(`Reais (dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca})`)}</option>
              </select>
            </div>
          </>
        )} />
      {recorte.situacao && recorte.situacao !== 'ativos' && <p className="aviso" role="status">{t('O perfil usa sempre os vínculos ativos em 31/12; o filtro de situação escolhido vale na Consulta personalizada.', 'The profile always uses jobs active on Dec 31; the chosen status filter applies in the Custom query.')}</p>}
      {!pronto && <p className="vazio">{t('Escolha uma ocupação ou família da CBO (ex.: 2512, economistas) e clique em Gerar perfil.', 'Choose a CBO occupation or family (e.g. 2512, economists) and click Build profile.')}</p>}
      {pronto && (
        <>
          <Estado carregando={carregando} erro={erro} tentarNovamente={recarregar} cancelar={cancelarConsultasTrabalho}
            vazio={!carregando && !erro && !num(total?.vinculos) && t('Nenhum vínculo ativo com esse recorte no ano de referência.', 'No active jobs with this recorte in the reference year.')} />
          {perfil.dados && serie.dados && (
            <>
              <div className="acoes-cartao" style={{ marginBottom: 12 }}>
                <button className="botao" onClick={exportarTudo}>{t('Exportar as sete tabelas (Excel)', 'Export all seven tables (Excel)')}</button>
                <button className="botao-leve" onClick={() => baixarPacote(`perfil_ocupacao_${recorte.cbo}_${ate}`, todas(),
                  { painel: 'mercado de trabalho (RAIS)', pagina: 'perfil da ocupação', territorio: { rotulo, ...escopo }, periodo: { de, ate }, recorte: rec, endereco: location.href, versao_base: meta.geradoEm },
                  idioma() === 'en' ? '.' : ',')}>{t('Pacote de pesquisa (zip)', 'Research package (zip)')}</button>
                <button className="botao-leve" onClick={() => print()} title={t('Abre a impressão do navegador: escolha Salvar como PDF. Saem título, recorte, unidade, fonte e as tabelas inteiras.', 'Opens the browser print dialog: choose Save as PDF. Title, recorte, unit, source and the full tables are included.')}>{t('PDF (imprimir)', 'PDF (print)')}</button>
                <span className="nota-base">{moedaTexto} · {t(`grupos com menos de ${recorte.nmin} vínculos com valor marcados com ‡`, `groups with fewer than ${recorte.nmin} jobs with a value flagged with ‡`)}</span>
              </div>
              {notaQuebra && (
                <p className="quebra-serie" role="note">{quebrasEntre(de, ate).map((q) => <span key={q.ano}>{q.texto} <a href={q.url} target="_blank" rel="noreferrer">{t('Nota técnica do MTE', 'MTE technical note')}</a>. </span>)}
                  {t('Variações que atravessam esses anos são observadas e podem refletir cobertura ou classificação.', 'Changes across these years are observed and may reflect coverage or classification.')}</p>
              )}
              <div className="grade-2">
                <CartaoGrafico titulo={t('1. Série histórica', '1. Time series')} desc={t('Vínculos ativos, participação no emprego formal do território e composição', 'Active jobs, share of the territory’s formal jobs and composition')}
                  tabela={(
                    <>
                      <table>
                        <thead><tr>{tabela1().colunas.slice(0, 7).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>{tabela1().linhas.map((l) => (
                          <tr key={String(l[0])} className={l[7] ? 'quebra' : undefined}>
                            <td className={l[7] ? 'quebra-ano' : undefined}>{l[0]}{l[7] ? ' †' : ''}</td><td>{numero(l[1] as number)}</td><td>{numero(l[2] as number)}</td>
                            <td>{pct(l[3] as number, 2)}</td><td>{pct(l[4] as number)}</td><td>{pct(l[5] as number)}</td><td>{pct(l[6] as number)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                      <p className="legenda-tabela">† {t('ano com quebra de série apontada pelo MTE; a variação sobre o ano anterior é observada, não necessariamente geração de empregos.', 'year with a series break reported by the Ministry; the change on the previous year is observed, not necessarily job creation.')}</p>
                      <BotoesExportar nome={`perfil_${recorte.cbo}_1_serie`} obter={tabela1} />
                    </>
                  )}>
                  <Grafico opcao={opcaoSerie} nome={`perfil_${recorte.cbo}_serie`} descricao={t('Vínculos ativos por ano; anos de quebra marcados com linha tracejada. Valores na opção Tabela.', 'Active jobs by year; break years marked with a dashed line. Values in the Table option.')} />
                </CartaoGrafico>
                <CartaoGrafico titulo={t('2. Remuneração ao longo do tempo', '2. Pay over time')} desc={t('Dezembro: média nominal e real (regra do PDET) e mediana; ativos com valor e sem valor', 'December: nominal and real average (PDET rule) and median; active jobs with and without a value')}
                  acoes={<Dica rotulo={t('Definições', 'Definitions')}>{notaDefinicoes()}</Dica>}
                  tabela={(
                    <>
                      <table>
                        <thead><tr>{tabela2().colunas.slice(0, 8).filter((_, i) => micro || (i !== 3 && i !== 4)).map((c) => <th key={c}>{c}</th>)}</tr></thead>
                        <tbody>{tabela2().linhas.map((l) => (
                          <tr key={String(l[0])}>
                            <td className={quebrasEntre(Number(l[0]) - 1, Number(l[0])).length ? 'quebra-ano' : undefined}>{l[0]}</td>
                            <td>{reaisExato(l[1] as number)}</td><td>{reaisExato(l[2] as number)}</td>
                            {micro && <><td>{reaisExato(l[3] as number)}</td><td>{reaisExato(l[4] as number)}</td></>}
                            <td>{numero(l[5] as number)}</td><td>{numero(l[6] as number)}</td><td>{pct(l[7] as number)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                      <BotoesExportar nome={`perfil_${recorte.cbo}_2_remuneracao`} obter={tabela2} />
                    </>
                  )}>
                  <Grafico opcao={opcaoRem} nome={`perfil_${recorte.cbo}_remuneracao`} />
                </CartaoGrafico>
              </div>
              {TABELAS(tipo).map((x) => (
                <section key={x.n} className="cartao perfil-tabela">
                  <div className="cabeca-cartao">
                    <div>
                      <h3>{x.n}. {x.titulo}</h3>
                      <p className="desc">{x.desc} {rotulo} · RAIS {ate} · {moedaTexto}</p>
                    </div>
                  </div>
                  {x.dims.map(([d, nome]) => (
                    <div key={d}>
                      <div className="cabeca-cartao">
                        <h4>{nome}</h4>
                        {temDim(d) && <BotoesExportar nome={`perfil_${recorte.cbo}_${x.n}_${d}`} obter={() => tabelaDim(`${x.n}. ${x.titulo}: ${nome}`, d)} />}
                      </div>
                      {temDim(d)
                        ? <TabelaDistribuicao linhas={daDim(d)} total={total} fator={fatorRef} micro={micro} nmin={recorte.nmin} />
                        : <p className="indisponivel">{t('Indisponível nas tabelas pré-somadas do Brasil: a tabela precisa dos microdados de uma UF ou de um município. Nenhum número é estimado no lugar.', 'Unavailable in the pre-aggregated tables for Brazil: the table needs the microdata of a state or municipality. No number is estimated instead.')}</p>}
                      {d === 'municipio' && temDim(d) && (() => {
                        const c = concentracao(daDim(d));
                        return c && (
                          <p className="nota-base">{t(`Concentração: ${c.n} municípios com vínculos; os 5 maiores têm ${pct(c.top5)} dos vínculos; índice de Herfindahl-Hirschman ${c.hhi.toFixed(3)} (soma das participações ao quadrado; 1 = um só município).`,
                            `Concentration: ${c.n} municipalities with jobs; the 5 largest hold ${pct(c.top5)} of jobs; Herfindahl-Hirschman index ${c.hhi.toFixed(3)} (sum of squared shares; 1 = a single municipality).`)}</p>
                        );
                      })()}
                      {d === 'raca_cor' && temDim(d) && <p className="nota-base">{t('Até 2022 a raça/cor de estatutários vinha quase toda como não classificada; a nota técnica da RAIS 2023 desaconselha comparar essa variável com anos anteriores.', 'Until 2022, race/colour for statutory workers was almost entirely unclassified; the RAIS 2023 technical note advises against comparing this variable with earlier years.')}</p>}
                      {d === 'vinculo_mte' && temDim(d) && <p className="nota-base">{t('Agregação da nota técnica da RAIS 2023: contratos por lei estadual ou municipal entram em estatutários.', 'Grouping from the RAIS 2023 technical note: state or municipal law contracts count as statutory.')}</p>}
                    </div>
                  ))}
                  {x.n === 6 && tipo === 'municipio' && (
                    <>
                      <div className="cabeca-cartao"><h4>{t('Comparação: município, UF e Brasil', 'Comparison: municipality, state and Brazil')}</h4>
                        <BotoesExportar nome={`perfil_${recorte.cbo}_6_comparacao`} obter={tabelaComparacao} /></div>
                      <Estado carregando={ufCmp.carregando || brCmp.carregando} erro={ufCmp.erro ?? brCmp.erro} cancelar={cancelarConsultasTrabalho} />
                      <div className="rolagem">
                        <table>
                          <thead><tr>{tabelaComparacao().colunas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                          <tbody>{tabelaComparacao().linhas.map((l) => (
                            <tr key={String(l[0])}><td>{l[0]}</td><td>{numero(l[1] as number)}</td><td>{reaisExato(l[2] as number)}</td><td>{reaisExato(l[3] as number)}</td>
                              <td>{numero(l[4] as number)}</td><td>{pct(l[5] as number)}</td><td>{pct(l[6] as number)}</td></tr>
                          ))}</tbody>
                        </table>
                      </div>
                      <p className="nota-base">{t('O Brasil vem das tabelas pré-somadas (sem mediana) e sem os filtros avançados; município e UF, dos microdados.', 'Brazil comes from the pre-aggregated tables (no median) and without the advanced filters; municipality and state, from the microdata.')}</p>
                    </>
                  )}
                </section>
              ))}
              <details className="sql"><summary>{t('SQL das tabelas 3 a 7 (DuckDB, sobre os arquivos publicados)', 'SQL of tables 3 to 7 (DuckDB, over the published files)')}</summary><pre>{perfil.dados.sql}</pre></details>
            </>
          )}
        </>
      )}
    </>
  );
}
