import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar, type Tabela } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { EtiquetasRecorte, paramsConsulta, useAnosConsulta, useTerritorioTrabalho } from '../components/RecorteTrabalho';
import { BarraFiltros, useDados } from '../contexto';
import { cancelarConsultasTrabalho, fonteConsulta, gruposDaFonte } from '../dados';
import { div, numero, pct, reaisCurto, reaisExato } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { pequeno, temFiltrosDeRecorte, totalDosGrupos, useRecorte } from '../trabalho_comum';
import { colunasConsulta, metadadosConsulta, notaDefinicoes, notaFonte, type ResultadoConsulta } from './TrabalhoConsulta';

/** Dimensões comparáveis (uma por vez) e se a ordem natural é a do código (faixas) ou a do tamanho do grupo. */
const DIMENSOES = (): { id: string; rotulo: string; ordinal: boolean }[] => [
  { id: 'sexo', rotulo: t('Sexo', 'Sex'), ordinal: false },
  { id: 'raca_cor', rotulo: t('Raça/cor', 'Race/colour'), ordinal: false },
  { id: 'escolaridade', rotulo: t('Escolaridade', 'Education'), ordinal: true },
  { id: 'faixa_idade', rotulo: t('Faixa de idade', 'Age group'), ordinal: true },
];

/** Colunas da tabela, reaproveitadas da Consulta personalizada (mesmas fórmulas e rótulos). */
const COLUNAS_PAGINA = ['ativos', 'part', 'rem_dez', 'rem_dez_med', 'p10', 'p90', 'n_rem_dez', 'fora'];

export function TrabalhoRemuneracao() {
  const { meta } = useDados();
  const { f, escopo, rotulo } = useTerritorioTrabalho();
  const anos = useAnosConsulta();
  const ano = anos.includes(f.ano) ? f.ano : ([...anos].reverse().find((a) => a <= f.ano) ?? anos.at(-1));
  const { recorte, definir } = useRecorte();
  const { search } = useLocation();
  const fonte = fonteConsulta(escopo);
  const micro = fonte === 'micro';
  const disponiveis = gruposDaFonte(fonte);
  const dimensoes = DIMENSOES().filter((d) => disponiveis.includes(d.id));
  // 'agr' vem da URL e pode ser de outra página (ex.: atividade): só vale se for uma das dimensões desta
  const dimUrl = dimensoes.find((d) => d.id === recorte.agrupar)?.id;
  const [rascunho, setRascunho] = useState(dimUrl ?? 'sexo');
  const dimEscolhida = dimensoes.find((d) => d.id === rascunho) ?? dimensoes[0];
  const [pedido, setPedido] = useState<string | null>(null);
  const rec = { ...recorte, situacao: 'ativos' };
  const incompativel = !micro && Object.keys(recorte.listas).length > 0;
  const p = ano && dimEscolhida ? paramsConsulta(escopo, rec, { ano }) : null;
  // consulta pesada (microdados de uma UF) só depois de Calcular; as tabelas pré-somadas (Brasil, cubo) são leves e rodam direto
  const chave = JSON.stringify([dimEscolhida?.id, p]);
  const liberado = !!p && !incompativel && (!micro || pedido === chave);
  const grupos = useApi<ResultadoConsulta>(liberado ? 'trab_consulta' : null, { ...p, agrupar: dimEscolhida?.id ?? 'sexo' });
  const dados = liberado ? grupos.dados : undefined;

  const real = recorte.moeda === 'real';
  const fator = real ? dados?.fator_real ?? null : 1;
  const moedaTexto = real
    ? t(`R$ de dezembro de ${meta.baseIpca} (IPCA, razão entre os índices de dezembro)`, `December ${meta.baseIpca} R$ (IPCA, ratio of December indices)`)
    : t(`R$ nominais de ${ano}`, `${ano} nominal R$`);
  const colunas = colunasConsulta(fator ?? 1).filter((c) => COLUNAS_PAGINA.includes(c.id) && (micro || !c.soMicro));
  const processado = (meta.fontes.rais_micro as { processado_em?: string } | undefined)?.processado_em;

  const { linhas, total } = useMemo(() => {
    let l = [...(dados?.linhas ?? [])];
    if (dimEscolhida?.ordinal) l = l.sort((a, b) => (a.grupo === null ? 1 : b.grupo === null ? -1 : Number(a.grupo) - Number(b.grupo)));
    // o recorte inteiro vem das somas dos grupos (todos os ativos entram em algum grupo, inclusive "não informado"): evita uma segunda leitura
    return { linhas: l, total: totalDosGrupos(l) ?? undefined };
  }, [dados, dimEscolhida?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nome = (r: Linha) => (r.grupo === null ? t('(não informado)', '(not reported)') : r.nome ? String(r.nome) : String(r.grupo));
  const mediaTotal = total && total.rem_dez_media !== null && fator !== null ? total.rem_dez_media * fator : null;
  const mediaDe = (r: Linha) => (fator === null || num(r.rem_dez_media) === null ? null : num(r.rem_dez_media)! * fator);
  const valida = (r: Linha, nmin = recorte.nmin) => !pequeno(num(r.n_rem_dez), nmin);
  const opcaoPagamento = useMemo(() => barras(linhas.map(nome), linhas.map((r) => (valida(r) ? mediaDe(r) : null)), reaisCurto, true), [dados, fator, recorte.nmin]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoComposicao = useMemo(() => barras(linhas.map(nome), linhas.map((r) => div(num(r.ativos), total?.ativos)), (v) => pct(v), true), [dados, total]); // eslint-disable-line react-hooks/exhaustive-deps

  // sexo: razão observada entre mulheres e homens (só com N suficiente nos dois lados)
  const homens = linhas.find((r) => String(r.grupo) === '1');
  const mulheres = linhas.find((r) => String(r.grupo) === '2');
  const razaoSexo = dimEscolhida?.id === 'sexo' && homens && mulheres && valida(homens) && valida(mulheres)
    ? { media: div(num(mulheres.rem_dez_media), num(homens.rem_dez_media)), mediana: micro ? div(num(mulheres.rem_dez_mediana), num(homens.rem_dez_mediana)) : null } : null;

  const metodo = t(
    'Média de dezembro como no PDET/MTE: massa ÷ todos os vínculos ativos em 31/12 do grupo (quem está sem valor conta como zero e é mostrado na coluna "sem valor"). Mediana, P10 e P90: só dos valores informados (maiores que zero), só nos microdados. Os grupos são vínculos, não pessoas. As diferenças entre grupos são descritivas e não ajustadas por ocupação, atividade, idade, escolaridade, jornada ou tempo de emprego; não provam discriminação nem efeito causal.',
    'December average as in PDET/MTE: payroll ÷ all active jobs on Dec 31 in the group (jobs without a value count as zero and are shown in the "without pay" column). Median, P10 and P90: reported values only (above zero), microdata only. Groups are jobs, not people. Differences between groups are descriptive and not adjusted for occupation, activity, age, education, hours or tenure; they do not prove discrimination or a causal effect.',
  );
  const tabela = (): Tabela => {
    const cols = colunas;
    return {
      colunas: [t('Código', 'Code'), dimEscolhida!.rotulo, ...cols.map((c) => c.titulo), ...cols.filter((c) => c.n).map((c) => `${t('N com remuneração informada', 'N with pay reported')} · ${c.titulo}`), t('% da média do recorte', '% of the scope average')],
      linhas: linhas.map((r) => [r.grupo === null ? null : String(r.grupo), nome(r), ...cols.map((c) => c.valor(r, total as unknown as Linha)), ...cols.filter((c) => c.n).map((c) => c.n!(r)),
        div(mediaDe(r), mediaTotal)]),
      metadados: metadadosConsulta({
        rotulo, ano: ano!, recorte: rec, fonte, total: total as unknown as Linha, moeda: moedaTexto, geradoEm: meta.geradoEm, processado, sql: dados?.sql,
        extra: [[t('Comparação', 'Comparison'), dimEscolhida!.rotulo], [t('Método', 'Method'), metodo], [t('Definições', 'Definitions'), notaDefinicoes()],
          [t('Quantis', 'Quantiles'), micro ? t('medianas e percentis dos microdados', 'microdata medians and percentiles') : t('indisponíveis nas tabelas pré-somadas deste recorte (precisam dos microdados)', 'unavailable in this scope’s pre-aggregated tables (they need the microdata)')],
          [t('Grupos pequenos', 'Small groups'), t(`N com remuneração informada abaixo de ${recorte.nmin} (cobertura salarial, não o total de ativos): valor marcado na tela e grupo fora do gráfico`, `N with pay reported below ${recorte.nmin} (pay coverage, not total active jobs): value flagged on screen and group left out of the chart`)]],
      }),
    };
  };

  if (!anos.length) return <><h2 className="titulo-pagina">{t('Remuneração e desigualdades', 'Pay and inequality')}</h2><p className="vazio">{t('Os microdados da RAIS ainda não foram publicados.', 'RAIS microdata have not been published yet.')}</p></>;
  const aguardando = micro && !!p && !incompativel && pedido !== chave;

  return (
    <>
      <h2 className="titulo-pagina">{t('Remuneração e desigualdades (RAIS)', 'Pay and inequality (RAIS)')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {ano} · {t('vínculos ativos em 31/12', 'jobs active on Dec 31')} <Dica rotulo={t('Fonte', 'Source')}>{notaFonte()}</Dica></p>
      <BarraFiltros />
      {f.anoForaDaBase && <p className="aviso" role="status">{t(`A RAIS de ${f.anoForaDaBase} ainda não foi publicada; a página usa ${ano}.`, `RAIS ${f.anoForaDaBase} has not been published yet; the page uses ${ano}.`)}</p>}
      <p className={`cobertura capacidade ${micro ? '' : 'limitada'}`} role="note">
        <strong>{t('O que esta página oferece aqui', 'What this page offers here')}:</strong>{' '}
        {micro
          ? t(`microdados de ${rotulo}: sexo, raça/cor, escolaridade e idade, com média, mediana, P10 e P90. A leitura é pesada (SP, MG e RJ podem levar minutos): ela só começa em Calcular.`,
            `microdata for ${rotulo}: sex, race/colour, education and age, with average, median, P10 and P90. Reading is heavy (SP, MG and RJ may take minutes): it only starts on Calculate.`)
          : t('tabelas pré-somadas deste recorte: só a divisão por sexo e a média de dezembro; raça/cor, escolaridade, idade, mediana e percentis precisam dos microdados, que não estão disponíveis para este recorte.',
            'pre-aggregated tables for this scope: only the split by sex and the December average; race/colour, education, age, median and percentiles need the microdata, which are not available for this scope.')}
      </p>
      <section className="cartao formulario-recorte">
        <div className="filtros">
          <div className="campo">
            <label htmlFor="r-dim">{t('Comparar por', 'Compare by')}</label>
            <select id="r-dim" value={dimEscolhida?.id} onChange={(e) => setRascunho(e.target.value)}>
              {dimensoes.map((d) => <option key={d.id} value={d.id}>{d.rotulo}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="r-moeda">{t('Valores em reais', 'Values in R$')}</label>
            <select id="r-moeda" value={recorte.moeda} onChange={(e) => definir({ moeda: e.target.value === 'real' ? 'real' : null })}>
              <option value="nominal">{t(`Nominais (R$ de ${ano})`, `Nominal (${ano} R$)`)}</option>
              <option value="real">{t(`Reais (R$ de dez/${meta.baseIpca}, IPCA)`, `Real (Dec/${meta.baseIpca} R$, IPCA)`)}</option>
            </select>
          </div>
          <div className="campo">
            <label htmlFor="r-nmin">{t('Marcar grupos com N (remuneração informada) abaixo de', 'Flag groups with N (pay reported) below')}</label>
            <input id="r-nmin" type="number" min={0} max={10000} value={recorte.nmin} style={{ width: 90 }}
              onChange={(e) => definir({ nmin: Number(e.target.value) === 30 ? null : Math.max(0, Number(e.target.value) || 0) })} />
          </div>
          {micro && (
            <button className="botao" disabled={!p || incompativel} onClick={() => { cancelarConsultasTrabalho(); setPedido(chave); definir({ agr: dimEscolhida!.id }); }}>
              {t('Calcular', 'Calculate')}
            </button>
          )}
        </div>
        <EtiquetasRecorte recorte={recorte} definir={definir} />
        {temFiltrosDeRecorte(recorte) && (
          <p className="nota-base">{t('O recorte acima vem da Consulta personalizada e vale aqui (sempre só vínculos ativos em 31/12). Para alterá-lo, ', 'The scope above comes from the Custom query and applies here (always active jobs on Dec 31 only). To change it, ')}
            <Link to={`/trabalho/consulta${search}`}>{t('use a Consulta personalizada', 'use the Custom query')}</Link>.</p>
        )}
      </section>
      {incompativel && <p className="aviso" role="status">{t('Os filtros avançados do recorte precisam dos microdados, indisponíveis para este recorte: remova-os ou mude o território.', 'The scope’s advanced filters need the microdata, unavailable for this scope: remove them or change the territory.')}</p>}
      {aguardando && <p className="vazio">{t('Escolha a comparação e clique em Calcular.', 'Choose the comparison and click Calculate.')}</p>}
      {liberado && (
        <>
          <Estado carregando={grupos.carregando} erro={grupos.erro} tentarNovamente={grupos.recarregar} cancelar={cancelarConsultasTrabalho}
            vazio={!grupos.carregando && !grupos.erro && !total && t('Nenhum vínculo ativo com esses filtros.', 'No active jobs match these filters.')} />
          {total && dados && (
            <>
              <div className="kpis kpis-4">
                <Kpi rotulo={t('Vínculos ativos (31/12)', 'Active jobs (Dec 31)')} valor={numero(total.ativos)} nota={t('vínculos, não pessoas', 'jobs, not people')} />
                <Kpi rotulo={t('Remuneração média de dezembro', 'Average December pay')} valor={reaisExato(mediaTotal)}
                  nota={t(`${numero(total.n_rem_dez)} de ${numero(total.ativos)} com valor (${pct(div(total.ativos - total.n_rem_dez, total.ativos))} sem valor, contam como zero) · regra do PDET`,
                    `${numero(total.n_rem_dez)} of ${numero(total.ativos)} with a value (${pct(div(total.ativos - total.n_rem_dez, total.ativos))} without, counted as zero) · PDET rule`)}
                  dica={<Dica rotulo={t('Método', 'Method')}>{metodo}</Dica>} />
                {dimEscolhida?.id === 'sexo' && (
                  <Kpi rotulo={t('Mulheres ÷ homens (média)', 'Women ÷ men (average)')} valor={razaoSexo?.media != null ? pct(razaoSexo.media, 0) : '–'}
                    nota={razaoSexo
                      ? `${razaoSexo.mediana != null ? t(`mediana: ${pct(razaoSexo.mediana, 0)} · `, `median: ${pct(razaoSexo.mediana, 0)} · `) : ''}${t('diferença observada, sem ajuste', 'observed difference, unadjusted')}`
                      : t('sem N suficiente nos dois grupos', 'not enough N in both groups')} />
                )}
                {!micro && <Kpi rotulo={t('Mediana, P10 e P90', 'Median, P10 and P90')} valor={t('indisponível', 'unavailable')} nota={t('precisa dos microdados, indisponíveis para este recorte', 'needs the microdata, unavailable for this scope')} />}
              </div>
              <div className="grade-2">
                <CartaoGrafico titulo={t(`Remuneração média de dezembro por ${dimEscolhida!.rotulo.toLowerCase()}`, `Average December pay by ${dimEscolhida!.rotulo.toLowerCase()}`)}
                  desc={`${rotulo} · RAIS ${ano} · ${moedaTexto} · ${t(`grupos com menos de ${recorte.nmin} com remuneração informada ficam de fora`, `groups with fewer than ${recorte.nmin} with pay reported are left out`)}`}>
                  <Grafico opcao={opcaoPagamento} nome={`rais_remuneracao_${dimEscolhida!.id}`} />
                </CartaoGrafico>
                <CartaoGrafico titulo={t('Composição dos vínculos ativos', 'Composition of active jobs')} desc={`${rotulo} · RAIS ${ano} · ${t('% dos ativos', '% of active jobs')}`}>
                  <Grafico opcao={opcaoComposicao} nome={`rais_composicao_${dimEscolhida!.id}`} />
                </CartaoGrafico>
              </div>
              <section className="cartao">
                <div className="cabeca-cartao">
                  <div>
                    <h3>{t(`Por ${dimEscolhida!.rotulo.toLowerCase()}`, `By ${dimEscolhida!.rotulo.toLowerCase()}`)}</h3>
                    <p className="desc">{rotulo} · RAIS {ano} · {moedaTexto}</p>
                  </div>
                  <BotoesExportar nome={`rais_remuneracao_${ano}_${dimEscolhida!.id}`} obter={tabela} />
                </div>
                <div className="rolagem">
                  <table className="tabela-fixa">
                    <thead>
                      <tr><th>{dimEscolhida!.rotulo}</th>{colunas.map((c) => <th key={c.id}>{c.titulo}</th>)}<th>{t('% da média do recorte', '% of the scope average')}</th></tr>
                    </thead>
                    <tbody>
                      {linhas.map((r) => (
                        <tr key={String(r.grupo)}>
                          <td title={String(r.grupo ?? '')}>{nome(r)}</td>
                          {colunas.map((c) => {
                            const n = c.n?.(r);
                            const v = c.valor(r, total as unknown as Linha);
                            const marca = pequeno(n, recorte.nmin) && v !== null;
                            return <td key={c.id} className={marca ? 'n-pequeno' : undefined} title={n != null ? `${t('N com remuneração informada', 'N with pay reported')} = ${numero(n)}` : undefined}>{c.formato(v)}{marca ? ' ‡' : ''}</td>;
                          })}
                          <td>{pct(div(mediaDe(r), mediaTotal), 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="legenda-tabela">
                  ‡ {t(`N com remuneração informada abaixo de ${recorte.nmin} (passe o mouse para ver): leia com cautela. Esse N são os valores positivos usados nas medianas e percentis; a média do PDET divide por todos os ativos, e a cobertura salarial aparece em “sem valor”.`, `N with pay reported below ${recorte.nmin} (hover to see it): read with caution. This N is the positive values used in medians and percentiles; the PDET average divides by all active jobs, and pay coverage appears under “without pay”.`)}{' '}
                  {t('Valores ausentes aparecem como "–", nunca como zero.', 'Missing values show as "–", never as zero.')}{' '}
                  {metodo}
                </p>
                {dados.sql && <details className="sql"><summary>{t('SQL desta tabela (DuckDB, sobre os arquivos publicados)', 'SQL for this table (DuckDB, over the published files)')}</summary><pre>{dados.sql}</pre></details>}
              </section>
            </>
          )}
        </>
      )}
    </>
  );
}
