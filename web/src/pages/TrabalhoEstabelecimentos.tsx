import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { AjudaTrabalho, CapacidadeTrabalho } from '../components/AjudaTrabalho';
import { Dica } from '../components/Dica';
import { BotoesExportar, type Tabela } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { EtiquetasRecorte, useTerritorioTrabalho } from '../components/RecorteTrabalho';
import { BarraFiltros, useDados } from '../contexto';
import { cancelarConsultasTrabalho } from '../dados';
import { div, numero, numero1, pct } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { CHAVES_FILTROS_RECORTE, lerAgrupamentoEstab, temFiltrosDeRecorte, useRecorte } from '../trabalho_comum';

type Indice = { anos: number[]; ufs: Record<number, number[]> };
type Resultado = {
  ano: number; uf_cod: number | null; ufs: number[]; resumo: Linha | null; grupos: Linha[]; agrupar: string; sql: string; tem_uf99: boolean; rotulo_uf: string;
};

const PDET = 'https://acesso.trabalho.gov.br/portal-pdet/o-pdet/portifolio-de-produtos/bases-de-dados.htm';
const PDET_FAQ = 'https://acesso.trabalho.gov.br/portal-pdet/ajuda/faq/bases-de-dados/conceitos-e-conteudo.htm';

const AGRUPAMENTOS = (): { id: string; rotulo: string; ordinal?: boolean }[] => [
  { id: 'porte', rotulo: t('Porte (vínculos ativos em 31/12)', 'Size (jobs active on Dec 31)'), ordinal: true },
  { id: 'divisao', rotulo: t('Atividade (CNAE): divisão', 'Activity (CNAE): division') },
  { id: 'natureza_juridica', rotulo: t('Natureza jurídica', 'Legal nature') },
  { id: 'simples', rotulo: t('Indicador Simples', 'Simples indicator') },
  { id: 'pat', rotulo: t('Indicador PAT', 'PAT indicator') },
];

const fonteEstab = () => t(
  'RAIS Estabelecimentos, Ministério do Trabalho e Emprego, microdados públicos sem identificação: um registro por estabelecimento declarante (CNPJ, CEI ou CAEPF). Processamento: LAPAM/UFG.',
  'RAIS Establishments, Ministry of Labour and Employment, public de-identified microdata: one record per declaring establishment (CNPJ, CEI or CAEPF). Processing: LAPAM/UFG.',
);
const notaUnidade = () => t(
  'A unidade é o estabelecimento declarante, não a empresa: uma empresa com várias filiais aparece várias vezes. O arquivo é sem identificação, então não se acompanha estabelecimentos entre anos nem se infere abertura, fechamento ou sobrevivência. Estoque = vínculos ativos em 31/12 (qtd_vinculos_ativos). Estoque zero em 31/12 não significa empresa fechada. RAIS negativa (código 1 do indicador) é, por definição, a declaração de que não houve vínculos no ano, conceito diferente de estoque zero em 31/12: um estabelecimento pode ter tido vínculos durante o ano e zero em 31/12. Espera-se estoque zero nos registros com RAIS negativa; o painel mostra a contagem dos que têm estoque positivo em vez de presumi-la. Registros sem valor de estoque ficam à parte, nunca como zero. A média e a mediana por estabelecimento só consideram os que têm vínculos ativos.',
  'The unit is the declaring establishment, not the company: a company with several branches appears several times. The file is de-identified, so establishments cannot be followed across years and openings, closures or survival cannot be inferred. Stock = jobs active on Dec 31 (qtd_vinculos_ativos). A zero stock on Dec 31 does not mean a closed firm. Negative RAIS (code 1 of the indicator) is, by definition, the declaration that there were no jobs during the year, a different concept from a zero stock on Dec 31: an establishment may have had jobs during the year and zero on Dec 31. Zero stock is expected on negative-RAIS records; the dashboard shows the count of those with a positive stock instead of assuming it. Records without a stock value are kept apart, never as zero. The average and median per establishment only consider those with active jobs.',
);
const notaOrigem = () => t(
  'O estoque desta página é a soma dos vínculos ativos em 31/12 informados no arquivo RAIS Estabelecimentos. A visão geral e a Consulta usam a base RAIS Vínculos. Essas bases podem apresentar totais diferentes.',
  'The stock on this page is the sum of jobs active on Dec 31 reported in the RAIS Establishments file. The overview and Custom query use the RAIS Jobs data. These datasets may have different totals.',
);
const notaCampos = () => t(
  'Porte: faixas calculadas do estoque de vínculos ativos em 31/12 (zero em faixa própria), iguais às do código de tamanho do arquivo. Simples e PAT: indicadores do arquivo do ano (0 = não, 1 = sim); outros códigos aparecem como estão. O indicador do Simples não é o regime tributário atual e não é exclusivo; o PAT só tem o código 9 (sem descrição verificada) a partir de 2023. Natureza jurídica e atividade (CNAE 2.0) usam os dicionários do painel.',
  'Size: bands computed from the stock of jobs active on Dec 31 (zero in its own band), equal to the file’s size code. Simples and PAT: indicators from the year’s file (0 = no, 1 = yes); other codes appear as they are. The Simples indicator is not the current tax regime and is not exclusive; PAT only has code 9 (no verified description) from 2023 on. Legal nature and activity (CNAE 2.0) use the dashboard dictionaries.',
);

export function TrabalhoEstabelecimentos() {
  const { meta, entes } = useDados();
  const { f, escopo, rotulo, tipo } = useTerritorioTrabalho();
  const { recorte, definir, busca } = useRecorte();
  const { search } = useLocation();
  const indice = useApi<Indice>('trab_estab_indice');
  const anos = indice.dados?.anos ?? [];
  const ano = anos.includes(f.ano) ? f.ano : ([...anos].reverse().find((a) => a <= f.ano) ?? anos.at(-1));
  const grupos = AGRUPAMENTOS();
  const [rascunho, setRascunho] = useState(lerAgrupamentoEstab(busca));
  const [pedido, setPedido] = useState<string | null>(null);
  const [todas, setTodas] = useState(false);

  // UF do território (código IBGE de 2 dígitos) para saber, pelo índice, se há arquivo daquele ano
  const ufCod = tipo === 'municipio' && f.alvo ? Math.floor((f.alvo.cod_ibge === 53 ? 5300108 : f.alvo.cod_ibge) / 100000)
    : tipo === 'uf' ? entes.find((e) => (e.esfera === 'E' || e.esfera === 'D') && e.uf === escopo.uf)?.cod_ibge ?? null : null;
  const semArquivo = !!ano && ufCod !== null && !(indice.dados?.ufs[ano] ?? []).includes(ufCod);
  const chave = JSON.stringify([ano, escopo, rascunho]);
  const liberado = !!ano && !semArquivo && pedido === chave;
  const r = useApi<Resultado>(liberado ? 'trab_estab' : null, { ...escopo, ano, agrupar: rascunho });
  const d = liberado ? r.dados : undefined;
  const res = d?.resumo ?? null;
  const g = AGRUPAMENTOS().find((x) => x.id === d?.agrupar);
  const processado = (meta.fontes.rais_micro as { processado_em?: string } | undefined)?.processado_em;

  const nome = (x: Linha) => (x.grupo === null ? t('(não informado)', '(not reported)')
    : x.nome ? `${d?.agrupar === 'divisao' || d?.agrupar === 'natureza_juridica' ? `${x.grupo} · ` : ''}${x.nome}` : `${x.grupo} · ${t('código sem nome no dicionário', 'code without a name in the dictionary')}`);
  const linhas = useMemo(() => {
    const l = [...(d?.grupos ?? [])];
    if (g?.ordinal) l.sort((a, b) => (a.grupo === 'N' ? 99 : Number(a.grupo ?? 98)) - (b.grupo === 'N' ? 99 : Number(b.grupo ?? 98)));
    return l;
  }, [d, g?.ordinal]);
  const total = num(res?.estabelecimentos);
  const topo = g?.ordinal ? linhas : linhas.slice(0, 15);
  const opEstab = useMemo(() => barras(topo.map(nome), topo.map((x) => num(x.estabelecimentos)), (v) => numero(v), true), [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const opMedia = useMemo(() => barras(topo.map(nome), topo.map((x) => num(x.media_com_vinculos)), (v) => numero1(v), true), [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const colunas = (): [string, (x: Linha) => number | string | null][] => [
    [t('Estabelecimentos declarantes', 'Declaring establishments'), (x) => num(x.estabelecimentos)],
    [t('% do total', '% of total'), (x) => div(num(x.estabelecimentos), total)],
    [t('Com vínculos ativos em 31/12', 'With jobs active on Dec 31'), (x) => num(x.com_vinculos)],
    [t('Estoque zero em 31/12', 'Zero stock on Dec 31'), (x) => num(x.estoque_zero)],
    [t('RAIS negativa (código 1)', 'Negative RAIS (code 1)'), (x) => num(x.rais_negativa)],
    [t('Sem valor de estoque', 'No stock value'), (x) => num(x.sem_estoque)],
    [t('Vínculos ativos (estoque)', 'Active jobs (stock)'), (x) => num(x.vinculos_ativos)],
    [t('Média por estabelecimento com vínculos', 'Average per establishment with jobs'), (x) => num(x.media_com_vinculos)],
    [t('Mediana por estabelecimento com vínculos', 'Median per establishment with jobs'), (x) => num(x.mediana_com_vinculos)],
  ];
  const formato = (i: number, v: number | string | null) => (v === null ? '–' : i === 1 ? pct(v as number) : i >= 7 ? numero1(v as number) : numero(v as number));

  const metadados = (): [string, string][] => {
    const m: [string, string][] = [
      [t('Fonte', 'Source'), fonteEstab()],
      [t('Fontes metodológicas (MTE/PDET)', 'Methodology sources (MTE/PDET)'), `${PDET} ; ${PDET_FAQ}`],
      [t('Base', 'Data'), t('microdados RAIS Estabelecimentos (silver/trabalho/micro/rais_estab)', 'RAIS Establishments microdata (silver/trabalho/micro/rais_estab)')],
      [t('Território', 'Territory'), rotulo], [t('Ano', 'Year'), String(d?.ano ?? ano)],
      [t('Arquivos lidos', 'Files read'), t(`${d?.ufs.length} arquivo(s) de UF do índice: ${d?.ufs.join(', ')}`, `${d?.ufs.length} state file(s) from the index: ${d?.ufs.join(', ')}`)],
      [t('Universo', 'Universe'), t('estabelecimentos declarantes da RAIS (inclui RAIS negativa e estoque zero)', 'RAIS declaring establishments (includes negative RAIS and zero stock)')],
      [t('Unidade', 'Unit'), t('estabelecimento declarante (não empresa, não pessoa)', 'declaring establishment (not company, not person)')],
      [t('Agrupamento', 'Grouping'), g?.rotulo ?? ''],
      [t('Filtros de vínculos', 'Job filters'), temFiltrosDeRecorte(recorte)
        ? t('presentes na URL (ocupação, atividade, sexo, perfil…), mas NÃO aplicados: os números usam todos os estabelecimentos do território e ano', 'present in the URL (occupation, activity, sex, profile…) but NOT applied: the numbers use every establishment in the territory and year')
        : t('nenhum; os filtros de vínculos não se aplicam a esta página', 'none; job filters do not apply to this page')],
      [t('Origem do estoque', 'Origin of the stock'), notaOrigem()],
    ];
    if (res) {
      m.push(
        [t('Cobertura: estoque informado', 'Coverage: stock reported'), `${num(res.com_estoque)} de ${num(res.estabelecimentos)}`],
        ...([['negativa', t('indicador de RAIS negativa', 'negative-RAIS indicator')], ['simples', 'Simples'], ['pat', 'PAT']] as const).map(([k, rot]): [string, string] => {
          const pre = num(res[`${k}_informado`]) ?? 0;
          const outros = num(res[`${k}_outro_codigo`]) ?? 0;
          return [t(`Cobertura: ${rot}`, `Coverage: ${rot}`), t(
            `campo preenchido (não nulo): ${pre} de ${num(res.estabelecimentos)}; códigos 0/1 válidos: ${pre - outros}; outros códigos (sem descrição verificada): ${outros}. Preenchido não significa classificado.`,
            `field filled in (non-null): ${pre} of ${num(res.estabelecimentos)}; valid 0/1 codes: ${pre - outros}; other codes (no verified description): ${outros}. Filled in does not mean classified.`)];
        }),
        [t('UF 99 (geografia ignorada)', 'State 99 (unknown geography)'), String(num(res.geografia_ignorada))],
      );
    }
    m.push([t('Definições', 'Definitions'), notaUnidade()], [t('Campos', 'Fields'), notaCampos()],
      [t('Versão da base (manifesto)', 'Data version (manifest)'), meta.geradoEm],
      ...(processado ? [[t('Microdados processados em', 'Microdata processed on'), processado] as [string, string]] : []),
      [t('Exportado em', 'Exported on'), new Date().toISOString()], [t('Endereço', 'Address'), typeof location === 'undefined' ? '' : location.href],
      ['SQL', d?.sql ?? '']);
    return m;
  };
  const tabela = (): Tabela => ({
    colunas: [t('Código', 'Code'), g?.rotulo ?? '', ...colunas().map(([c]) => c)],
    linhas: [[null, t('Total do território', 'Territory total'), ...colunas().map(([, f2]) => (res ? f2(res) : null))],
      ...linhas.map((x) => [x.grupo === null ? null : String(x.grupo), nome(x), ...colunas().map(([, f2]) => f2(x))])],
    metadados: metadados(),
  });

  const titulo = t('Estabelecimentos (RAIS)', 'Establishments (RAIS)');
  if (indice.carregando) return <><h2 className="titulo-pagina">{titulo}</h2><Estado carregando /></>;
  if (indice.erro) return <><h2 className="titulo-pagina">{titulo}</h2><Estado erro={indice.erro} tentarNovamente={indice.recarregar} /></>;
  if (!anos.length) {
    return (
      <>
        <h2 className="titulo-pagina">{titulo}</h2>
        <p className="vazio">{t('Os microdados de estabelecimentos da RAIS não estão publicados nesta versão dos dados (o índice dos microdados não tem rais_estab).', 'RAIS establishment microdata are not published in this version of the data (the microdata index has no rais_estab).')}</p>
      </>
    );
  }
  const aguardando = !!ano && !semArquivo && !liberado;
  return (
    <>
      <h2 className="titulo-pagina">{titulo}</h2>
      <p className="subtitulo">{rotulo} · RAIS {ano} · {t('estabelecimentos declarantes', 'declaring establishments')} <Dica rotulo={t('Fonte', 'Source')}>{fonteEstab()}</Dica></p>
      <BarraFiltros />
      {f.anoForaDaBase && <p className="aviso" role="status">{t(`A RAIS de ${f.anoForaDaBase} não tem estabelecimentos publicados; a página usa ${ano}.`, `RAIS ${f.anoForaDaBase} has no published establishments; the page uses ${ano}.`)}</p>}
      {!f.anoForaDaBase && ano !== f.ano && <p className="aviso" role="status">{t(`Estabelecimentos de ${f.ano} não estão publicados; a página usa ${ano}.`, `Establishments for ${f.ano} are not published; the page uses ${ano}.`)}</p>}
      <CapacidadeTrabalho micro={tipo !== 'brasil'} rotulo={t('O que esta página oferece', 'What this page offers')}
        resumo={t('conta os estabelecimentos que declararam à RAIS (unidades, não empresas) e como se dividem por porte, atividade, natureza jurídica, Simples e PAT. Escolha como dividir e clique em Calcular.', 'counts the establishments that reported to RAIS (units, not companies) and how they split by size, activity, legal nature, Simples and PAT. Choose how to split and click Calculate.')}
        detalhe={<>{tipo === 'brasil'
          ? t(`para o Brasil, lê os ${indice.dados?.ufs[ano!]?.length ?? ''} arquivos de UF de ${ano} do índice (inclui a UF 99, geografia ignorada, quando existe). É uma leitura grande: só começa em Calcular.`,
            `for Brazil, reads the ${indice.dados?.ufs[ano!]?.length ?? ''} state files for ${ano} listed in the index (including state 99, unknown geography, when present). It is a large read: it only starts on Calculate.`)
          : t('lê o arquivo da UF (e, num município, filtra o código de 6 dígitos). A leitura só começa em Calcular.', 'reads the state file (and, for a municipality, filters its 6-digit code). Reading only starts on Calculate.')}</>} />
      <AjudaTrabalho foco="estabelecimentos" />
      <p className="nota-base" role="note"><strong>{t('Origem dos números', 'Origin of the numbers')}:</strong> {notaOrigem()}</p>
      {temFiltrosDeRecorte(recorte) && (
        <div className="aviso" role="status">
          <p>{t('Há filtros de vínculos na URL, mas esta página não os aplica: os números de estabelecimentos usam todo o território e o ano, sem ocupação, atividade, sexo ou perfil de pessoas.',
            'There are job filters in the URL, but this page does not apply them: the establishment numbers use the whole territory and year, with no occupation, activity, sex or worker profile.')}{' '}
            <Link to={`/trabalho/consulta${search}`}>{t('Aplicar na Consulta personalizada', 'Apply in the Custom query')}</Link>{' · '}
            <button className="limpar" onClick={() => definir(Object.fromEntries(CHAVES_FILTROS_RECORTE.map((k) => [k, null])))}>{t('limpar esses filtros', 'clear these filters')}</button></p>
          <EtiquetasRecorte recorte={recorte} definir={definir} />
        </div>
      )}
      <section className="cartao formulario-recorte">
        <div className="filtros">
          <div className="campo">
            <label htmlFor="e-agr">{t('Ver estabelecimentos por', 'View establishments by')}</label>
            <select id="e-agr" value={rascunho} onChange={(e) => setRascunho(e.target.value)}>
              {grupos.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
            </select>
          </div>
          <button className="botao" disabled={!ano || semArquivo} onClick={() => { cancelarConsultasTrabalho(); setPedido(chave); definir({ eagr: rascunho }); }}>{t('Calcular', 'Calculate')}</button>
        </div>
      </section>
      {semArquivo && <p className="aviso" role="status">{t(`Não há arquivo de estabelecimentos deste território em ${ano} no índice dos microdados.`, `There is no establishment file for this territory in ${ano} in the microdata index.`)}</p>}
      {aguardando && <p className="vazio">{t('Escolha o agrupamento e clique em Calcular.', 'Choose the grouping and click Calculate.')}</p>}
      {liberado && (
        <>
          <Estado carregando={r.carregando} erro={r.erro} tentarNovamente={r.recarregar} cancelar={cancelarConsultasTrabalho}
            vazio={!r.carregando && !r.erro && !res && t('Nenhum estabelecimento declarante neste recorte.', 'No declaring establishment in this scope.')} />
          {res && d && total !== null && (
            <>
              <div className="kpis kpis-4">
                <Kpi rotulo={t('Estabelecimentos declarantes', 'Declaring establishments')} valor={numero(total)} nota={t('linhas do arquivo, não empresas; inclui RAIS negativa', 'file rows, not companies; includes negative RAIS')}
                  dica={<Dica rotulo={t('Definições', 'Definitions')}>{notaUnidade()}</Dica>} />
                <Kpi rotulo={t('Com vínculos ativos em 31/12', 'With jobs active on Dec 31')} valor={numero(num(res.com_vinculos))}
                  nota={t(`${pct(div(num(res.com_vinculos), total))} do total · estoque zero: ${numero(num(res.estoque_zero))} (${pct(div(num(res.estoque_zero), total))}), não é empresa fechada`,
                    `${pct(div(num(res.com_vinculos), total))} of the total · zero stock: ${numero(num(res.estoque_zero))} (${pct(div(num(res.estoque_zero), total))}), not a closed firm`)} />
                <Kpi rotulo={t('Vínculos ativos em 31/12 (estoque)', 'Jobs active on Dec 31 (stock)')} valor={numero(num(res.vinculos_ativos))}
                  nota={t(`média ${numero1(num(res.media_com_vinculos))} e mediana ${numero1(num(res.mediana_com_vinculos))} por estabelecimento com vínculos`,
                    `average ${numero1(num(res.media_com_vinculos))} and median ${numero1(num(res.mediana_com_vinculos))} per establishment with jobs`)} />
                <Kpi rotulo={t('RAIS negativa (código 1)', 'Negative RAIS (code 1)')} valor={numero(num(res.rais_negativa))}
                  nota={t(`${pct(div(num(res.rais_negativa), total))} do total; indicador informado em ${pct(div(num(res.negativa_informada), total))}${num(res.negativa_outro_codigo) ? `; outro código: ${numero(num(res.negativa_outro_codigo))} (sem descrição verificada, fora desta contagem)` : ''}`,
                    `${pct(div(num(res.rais_negativa), total))} of the total; indicator reported for ${pct(div(num(res.negativa_informada), total))}${num(res.negativa_outro_codigo) ? `; other code: ${numero(num(res.negativa_outro_codigo))} (no verified description, not in this count)` : ''}`)} />
                <Kpi rotulo={t('Sem valor de estoque', 'No stock value')} valor={numero(num(res.sem_estoque))}
                  nota={t(`${pct(div(num(res.sem_estoque), total))} do total; ausência, não zero`, `${pct(div(num(res.sem_estoque), total))} of the total; missing, not zero`)} />
                <Kpi rotulo={t('Indicador Simples = 1', 'Simples indicator = 1')} valor={pct(div(num(res.simples_sim), num(res.simples_informado)))}
                  nota={t(`${numero(num(res.simples_sim))} de ${numero(num(res.simples_informado))} com o campo informado; não é o regime tributário atual`,
                    `${numero(num(res.simples_sim))} of ${numero(num(res.simples_informado))} with the field reported; not the current tax regime`)} />
                <Kpi rotulo={t('Indicador PAT = 1', 'PAT indicator = 1')} valor={num(res.pat_sim) === 0 && !num(res.pat_nao) ? '–' : pct(div(num(res.pat_sim), (num(res.pat_sim) ?? 0) + (num(res.pat_nao) ?? 0)))}
                  nota={num(res.pat_outro_codigo)
                    ? t(`código 9 (sem descrição verificada) em ${numero(num(res.pat_outro_codigo))} registros; só 0 e 1 entram no percentual`, `code 9 (no verified description) in ${numero(num(res.pat_outro_codigo))} records; only 0 and 1 enter the percentage`)
                    : t('entre os registros com 0 ou 1', 'among records with 0 or 1')} />
              </div>
              {tipo === 'brasil' && (
                <p className="nota-base">{d.tem_uf99
                  ? t(`Inclui ${numero(num(res.geografia_ignorada))} estabelecimentos da UF 99 (geografia ignorada), que não pertencem a nenhuma UF listada.`, `Includes ${numero(num(res.geografia_ignorada))} establishments from state 99 (unknown geography), which belong to none of the listed states.`)
                  : t(`Em ${d.ano} o índice não tem a UF 99 (geografia ignorada): o total soma as ${d.ufs.length} UFs.`, `In ${d.ano} the index has no state 99 (unknown geography): the total adds the ${d.ufs.length} states.`)}</p>
              )}
              <div className="grade-2">
                <CartaoGrafico titulo={t(`Estabelecimentos por ${g?.rotulo.toLowerCase()}`, `Establishments by ${g?.rotulo.toLowerCase()}`)}
                  desc={`${rotulo} · RAIS ${d.ano}${!g?.ordinal && linhas.length > 15 ? t(` · 15 maiores de ${linhas.length} grupos`, ` · 15 largest of ${linhas.length} groups`) : ''}`}>
                  <Grafico opcao={opEstab} nome={`rais_estab_${d.agrupar}`} />
                </CartaoGrafico>
                <CartaoGrafico titulo={t('Vínculos médios por estabelecimento com vínculos', 'Average jobs per establishment with jobs')}
                  desc={`${rotulo} · RAIS ${d.ano} · ${t('só estabelecimentos com estoque maior que zero', 'only establishments with a stock above zero')}`}>
                  <Grafico opcao={opMedia} nome={`rais_estab_media_${d.agrupar}`} />
                </CartaoGrafico>
              </div>
              <section className="cartao">
                <div className="cabeca-cartao">
                  <div>
                    <h3>{t(`Por ${g?.rotulo.toLowerCase()}`, `By ${g?.rotulo.toLowerCase()}`)}</h3>
                    <p className="desc">{rotulo} · RAIS {d.ano} · {t(`${linhas.length} grupos`, `${linhas.length} groups`)}</p>
                  </div>
                  <BotoesExportar nome={`rais_estabelecimentos_${d.ano}_${d.agrupar}`} obter={tabela} />
                </div>
                <div className="rolagem">
                  <table className="tabela-fixa">
                    <thead><tr><th>{g?.rotulo}</th>{colunas().map(([c]) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>
                      {(todas ? linhas : linhas.slice(0, 30)).map((x) => (
                        <tr key={String(x.grupo)}>
                          <td title={String(x.grupo ?? '')}>{nome(x)}</td>
                          {colunas().map(([c, f2], i) => <td key={c}>{formato(i, f2(x))}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {linhas.length > 30 && (
                  <p className="legenda-tabela"><button className="limpar" onClick={() => setTodas(!todas)}>
                    {todas ? t('mostrar menos', 'show fewer') : t(`mostrar os ${linhas.length} grupos`, `show all ${linhas.length} groups`)}
                  </button></p>
                )}
                <p className="legenda-tabela">{t('Valores ausentes aparecem como "–", nunca como zero. ', 'Missing values show as "–", never as zero. ')}{notaCampos()}</p>
                <p className="legenda-tabela">{t('Metodologia oficial: ', 'Official methodology: ')}
                  <a href={PDET} target="_blank" rel="noreferrer">PDET · {t('bases de dados', 'databases')}</a> · <a href={PDET_FAQ} target="_blank" rel="noreferrer">{t('conceitos e conteúdo', 'concepts and content')}</a></p>
                <details className="sql"><summary>{t('SQL desta tabela (DuckDB, sobre os arquivos publicados)', 'SQL for this table (DuckDB, over the published files)')}</summary><pre>{d.sql}</pre></details>
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
