import { useMemo, useState } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros } from '../contexto';
import { avisoComposicao, avisoNaoSomar, coberturaPopulacional, FNS_CATALOGO, FNS_NOTA_828, fonteFns, ordenarMunicipios, perCapita, porBloco, razaoPositiva, regraPerCapita, regraPrecos, resumoFns, rotuloComposicao, temRepasse, universoFns } from '../fns_comum';
import { numero, pct, reais, reaisExato } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { faixaAnos, fonteSaude } from '../saude_comum';
import { AvisoAno, referencia, useSaude } from './SaudeDatasus';

const REAL_DESDE = 2006;
const DF_DOC_HISTORICA = 'https://info.saude.df.gov.br/wp-content/uploads/2022/08/Relatorio-Anual-de-Gestao-2009.pdf';
const DF_DOC = 'https://www.saude.df.gov.br/documents/37101/0/Contrato-de-Repasse-no-904651-2020-REFORMA-HRAN-ala-de-queimados-novo.pdf/5a1d087d-619b-bb50-06a4-847244954a05?t=1651503244521';

/**
 * Financiamento federal da saúde (FNS): repasses fundo a fundo da União para destinatários municipais (e, no DF, para a Secretaria e o
 * Fundo de Saúde), por ano do arquivo. Mostra bruto, líquido, líquido real (2006 em diante) e por habitante (população anual da SVS/MS),
 * com a cobertura do denominador, a composição do ano com os nomes da fonte e o ranking dos municípios. Sem repasse registrado, a página diz
 * "sem registro" (nunca zero); com dados antigos sem FNS, diz que o tema é indisponível.
 */
export function SaudeFinanciamento() {
  const { ano, semAno, escopo, rotulo, temDados, fontes, municipio, uf, f, meta } = useSaude();
  const fns = fontes.fns;
  const cobertos = fns?.anos ?? [];
  const ref = referencia(cobertos, ano, semAno);
  const versaoTem = !!fns && cobertos.length > 0;
  const serie = useApi<Linha[]>(temDados && versaoTem ? 'fns_serie' : null, escopo);
  const auditoria = useApi<Linha[]>(temDados && versaoTem ? 'fns_anos' : null);
  const comp = useApi<Linha[]>(temDados && versaoTem && ref !== null ? 'fns_composicao' : null, { ...escopo, ano: ref });
  // ranking: municípios da UF (ou do Brasil); com um município escolhido, os da UF dele
  const rank = useApi<Linha[]>(temDados && versaoTem && ref !== null ? 'fns_municipios' : null, { uf: uf ?? undefined, ano: ref });
  const dados = serie.dados ?? [];
  const a = dados.find((r) => Number(r.ano) === ref);
  const aud = (auditoria.dados ?? []).find((r) => Number(r.ano) === ref);
  const base = meta.baseIpca;
  const temReal = ref !== null && ref >= REAL_DESDE;
  const anosS = dados.map((r) => Number(r.ano)).filter((x) => cobertos.includes(x));
  const doFns = dados.filter((r) => cobertos.includes(Number(r.ano)));
  const sem = !temRepasse(a);
  const liquido = sem ? null : num(a?.liquido);
  const pcNominal = perCapita(a, false);
  const pcReal = perCapita(a, true);
  const cobertura = coberturaPopulacional(a);
  const semPop = num(a?.liquido_sem_pop);
  const noDf = uf === 'DF' || (municipio && f.alvo?.esfera === 'D');

  const opcaoValores = useMemo(() => linhas(anosS, [
    { nome: t('Líquido (R$ correntes)', 'Net (current R$)'), valores: doFns.map((r) => num(r.liquido)) },
    { nome: t(`Líquido (R$ de ${base})`, `Net (R$ of ${base})`), valores: doFns.map((r) => num(r.liquido_real)) },
  ], (v) => reais(v)), [serie.dados, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoPc = useMemo(() => linhas(anosS, [
    { nome: t('Por habitante (R$ correntes)', 'Per inhabitant (current R$)'), valores: doFns.map((r) => perCapita(r, false)) },
    { nome: t(`Por habitante (R$ de ${base})`, `Per inhabitant (R$ of ${base})`), valores: doFns.map((r) => perCapita(r, true)) },
  ], (v) => reaisExato(v)), [serie.dados, base]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocos = useMemo(() => porBloco(comp.dados ?? []), [comp.dados]);
  const opcaoBlocos = useMemo(() => barras(blocos.map((b) => b.bloco), blocos.map((b) => b.liquido), (v) => reais(v), true), [blocos]);
  const totalComp = blocos.reduce((s, b) => s + b.liquido, 0);

  const comuns: [string, string][] = [
    [t('Recorte', 'Scope'), rotulo],
    [t('Fonte', 'Source'), `${fonteFns()} (${FNS_CATALOGO})`],
    [t('Universo', 'Universe'), universoFns()],
    [t('Período', 'Period'), t('ano do arquivo do FNS; a data da última liberação não permite série mensal e o saldo da conta (estoque) nunca é somado', 'year of the FNS file; the last-release date does not allow a monthly series and the account balance (a stock) is never summed')],
    [t('Valores', 'Values'), t('bruto e líquido como no arquivo, em R$ correntes (soma exata em centavos)', 'gross and net as in the file, in current R$ (exact sum in cents)')],
    [t('Preços', 'Prices'), regraPrecos(base)],
    [t('Per capita', 'Per capita'), regraPerCapita()],
    [t('Cobertura', 'Coverage'), `${faixaAnos(cobertos)}; ${t('2026 (parcial) fica de fora', '2026 (partial) is not included')}`],
    [t('Composição', 'Composition'), avisoComposicao()],
    [t('Perspectiva', 'Perspective'), avisoNaoSomar()],
    [t('Versão da base', 'Data version'), meta.geradoEm],
  ];

  if (!temDados) return <><h2 className="titulo-pagina">{t('Financiamento federal', 'Federal funding')}</h2><p className="vazio">{t('Os dados de saúde ainda não foram publicados.', 'Health data have not been published yet.')}</p></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Financiamento federal da saúde (FNS)', 'Federal health funding (FNS)')}</h2>
      <p className="subtitulo">
        {rotulo} · FNS {ref ?? t('fora da cobertura', 'outside coverage')} · {t('repasses fundo a fundo da União, por ano do arquivo', 'fund-to-fund transfers from the Union, by file year')}{' '}
        <Dica rotulo={t('Fonte', 'Source')}>{fonteFns()}</Dica>
      </p>
      <BarraFiltros comUltimo ultimoPadrao anosCobertos={cobertos} />
      <AvisoAno ano={ano} />
      {!versaoTem && <p className="aviso" role="status">{t('O financiamento federal (FNS) é indisponível nesta versão dos dados.', 'Federal funding (FNS) is unavailable in this data version.')}</p>}
      {versaoTem && (
        <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
          vazio={!serie.carregando && !serie.dados?.length && t('Sem registros para este recorte.', 'No records for this scope.')} />
      )}
      {versaoTem && ref === null && serie.dados && (
        <p className="aviso" role="status">{t(`Ano fora da cobertura: o FNS tem dados de ${faixaAnos(cobertos)}.`, `Year outside coverage: the FNS has data for ${faixaAnos(cobertos)}.`)}</p>
      )}
      {versaoTem && (
        <p className="nota-base">
          <strong>{t('Universo', 'Universe')}:</strong> {t('repasses classificados pelo FNS para destinatários municipais; fundos estaduais não entram.', 'transfers classified by the FNS for municipal recipients; state funds are excluded.')}
          {(noDf || !municipio) && (
            <> {t('No Distrito Federal, que o FNS classifica como estadual, entram a Secretaria e o Fundo de Saúde do DF', 'In the Federal District, which the FNS classifies as state-level, the DF Health Department and Health Fund are included')} (<a href={DF_DOC} target="_blank" rel="noreferrer">{t('documentação', 'documentation')}</a>; <a href={DF_DOC_HISTORICA} target="_blank" rel="noreferrer">{t('CNPJ histórico: RAG 2009', 'Historical CNPJ: 2009 annual report')}</a>).</>
          )}
        </p>
      )}
      {versaoTem && !serie.carregando && !serie.erro && ref !== null && (
        <>
          {sem && (
            <p className="aviso" role="status">
              {t(`Sem repasse registrado em ${ref} para este recorte nos arquivos do FNS. Ausência de registro não é zero.`, `No transfer recorded in ${ref} for this scope in the FNS files. Absence of a record is not zero.`)}
            </p>
          )}
          <div className="kpis kpis-4">
            <Kpi rotulo={t('Repasse líquido', 'Net transfer')} valor={sem ? t('sem registro', 'no record') : reais(liquido)} nota={`${ref} · ${t('R$ correntes', 'current R$')}`}
              dica={<Dica rotulo={t('Como ler', 'How to read')}>{t('Valor repassado pelo FNS fundo a fundo no ano, depois dos descontos (VL_LIQUIDO). É o que a União transferiu, não a despesa do município nem a sua receita no SICONFI.', 'Amount the FNS transferred fund to fund in the year, after deductions (VL_LIQUIDO). It is what the Union transferred, not the municipality’s spending nor its SICONFI revenue.')}</Dica>} />
            <Kpi rotulo={t('Repasse bruto', 'Gross transfer')} valor={sem ? t('sem registro', 'no record') : reais(num(a?.bruto))} nota={`${ref} · ${t('R$ correntes', 'current R$')}`}
              dica={<Dica rotulo={t('Como ler', 'How to read')}>{t('Valor antes dos descontos (VL_BRUTO). O saldo das contas não entra: é estoque, não repasse do ano.', 'Amount before deductions (VL_BRUTO). Account balances do not enter: they are a stock, not the year’s transfer.')}</Dica>} />
            <Kpi rotulo={t(`Líquido em R$ de ${base}`, `Net in R$ of ${base}`)}
              valor={sem ? t('sem registro', 'no record') : temReal ? reais(num(a?.liquido_real)) : t('indisponível antes de 2006', 'unavailable before 2006')}
              nota={temReal ? t('IPCA dez/dez do painel', 'panel Dec/Dec IPCA') : `${ref} · ${t('o IPCA do painel começa em 2006', 'the panel IPCA starts in 2006')}`} />
            <Kpi rotulo={t('Líquido por habitante', 'Net per inhabitant')}
              valor={sem ? t('sem registro', 'no record') : pcNominal === null ? t('sem população', 'no population') : reaisExato(pcNominal)}
              nota={temReal && pcReal !== null ? t(`R$ ${base}: ${reaisExato(pcReal)} · população SVS/MS ${ref}`, `R$ ${base}: ${reaisExato(pcReal)} · SVS/MS population ${ref}`) : `${t('população SVS/MS', 'SVS/MS population')} ${ref}`}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{regraPerCapita()}</Dica>} />
          </div>
          {!municipio && (
            <p className="nota-base">
              {t(`Cobertura: ${numero(num(a?.municipios_com_repasse))} de ${numero(num(a?.municipios))} municípios com repasse registrado, ${pct(cobertura, 1)} da população do recorte (denominador do per capita).`,
                `Coverage: ${numero(num(a?.municipios_com_repasse))} of ${numero(num(a?.municipios))} municipalities with a recorded transfer, ${pct(cobertura, 1)} of the scope population (per-capita denominator).`)}
              {semPop ? ` ${t(`${reais(semPop)} de municípios sem população correspondente no ano ficam fora do per capita, mas entram nos totais.`, `${reais(semPop)} from municipalities without matching population in the year stays out of the per-capita figure but is in the totals.`)}` : ''}
              {num(a?.liquido_distrital) ? ` ${t(`Inclui ${reais(num(a?.liquido_distrital))} do Distrito Federal (Secretaria e Fundo de Saúde, classificados como estaduais pelo FNS).`, `Includes ${reais(num(a?.liquido_distrital))} for the Federal District (Health Department and Fund, classified as state-level by the FNS).`)}` : ''}
            </p>
          )}
          {aud && !municipio && uf === null && (num(aud.liquido_estadual) || num(aud.liquido_df_nao_comprovado)) ? (
            <p className="nota-base">
              {t(`Fora do universo em ${ref}: ${reais(num(aud.liquido_estadual))} repassados a fundos estaduais`, `Outside the universe in ${ref}: ${reais(num(aud.liquido_estadual))} transferred to state funds`)}
              {num(aud.liquido_df_nao_comprovado) ? t(` e ${reais(num(aud.liquido_df_nao_comprovado))} a outro CNPJ da Secretaria de Saúde do DF, não comprovado como destinatário distrital`, ` and ${reais(num(aud.liquido_df_nao_comprovado))} to another CNPJ of the DF Health Department, not proven as a district recipient`) : ''}.
            </p>
          ) : null}
          {aud && noDf && num(aud.liquido_df_nao_comprovado) ? (
            <p className="aviso" role="note">
              {t(`Em ${ref}, ${reais(num(aud.liquido_df_nao_comprovado))} foram repassados no DF a outro CNPJ da Secretaria de Saúde e não entram aqui: os CNPJs documentados são os da Secretaria (00.394.700/0001-08 e 00.394.700/0002-99) e do Fundo (12.116.247/0001-57). O valor do DF neste ano pode estar subestimado.`,
                `In ${ref}, ${reais(num(aud.liquido_df_nao_comprovado))} was transferred in the DF to another CNPJ of the Health Department and is not included here: the documented CNPJs are those of the Department (00.394.700/0001-08 and 00.394.700/0002-99) and the Fund (12.116.247/0001-57). The DF figure for this year may be understated.`)}
            </p>
          ) : null}
        </>
      )}
      {anosS.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t(`Repasse líquido por ano, ${faixaAnos(cobertos)}`, `Net transfer per year, ${faixaAnos(cobertos)}`)} desc={`${rotulo} · ${t('real só de 2006 em diante', 'real only from 2006 on')}`}
            tabela={<TabelaSerie nome="saude_fns_serie" anos={anosS} metadadosProprios valoresReais="parcial" colunas={[
              { titulo: t('Líquido (R$ correntes)', 'Net (current R$)'), valores: doFns.map((r) => num(r.liquido)), formato: (v) => reaisExato(v) },
              { titulo: t('Bruto (R$ correntes)', 'Gross (current R$)'), valores: doFns.map((r) => num(r.bruto)), formato: (v) => reaisExato(v) },
              { titulo: t(`Líquido (R$ de ${base})`, `Net (R$ of ${base})`), valores: doFns.map((r) => num(r.liquido_real)), formato: (v) => reaisExato(v) },
              { titulo: t('Líquido por habitante (R$ correntes)', 'Net per inhabitant (current R$)'), valores: doFns.map((r) => perCapita(r, false)), formato: (v) => reaisExato(v) },
              { titulo: t(`Líquido por habitante (R$ de ${base})`, `Net per inhabitant (R$ of ${base})`), valores: doFns.map((r) => perCapita(r, true)), formato: (v) => reaisExato(v) },
              { titulo: t('Municípios com repasse', 'Municipalities with a transfer'), valores: doFns.map((r) => num(r.municipios_com_repasse)), formato: numero },
              { titulo: t('Cobertura da população', 'Population coverage'), valores: doFns.map((r) => coberturaPopulacional(r)), formato: (v) => pct(v, 1) },
              { titulo: t('Líquido sem população correspondente (R$ correntes)', 'Net without matching population (current R$)'), valores: doFns.map((r) => num(r.liquido_sem_pop)), formato: (v) => reaisExato(v) },
            ]} metadados={comuns} />}>
            <Grafico opcao={opcaoValores} nome="saude_fns_liquido" />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Líquido por habitante por ano', 'Net per inhabitant per year')} desc={`${rotulo} · ${t('população anual da SVS/MS', 'annual SVS/MS population')}`}>
            <Grafico opcao={opcaoPc} nome="saude_fns_percapita" />
          </CartaoGrafico>
        </div>
      )}
      {ref !== null && versaoTem && (
        <>
          <Estado carregando={comp.carregando} erro={comp.erro} tentarNovamente={comp.recarregar}
            vazio={!comp.carregando && !comp.erro && !!comp.dados && comp.dados.length === 0 && t('Sem composição registrada para este recorte e ano.', 'No composition recorded for this scope and year.')} />
          {comp.dados && comp.dados.length > 0 && (
            <CartaoGrafico titulo={t(`Composição do repasse líquido, ${ref}`, `Composition of the net transfer, ${ref}`)} desc={`${rotulo} · ${t('blocos de financiamento, com os nomes da fonte neste ano', 'funding blocks, with the source names in this year')}`}
              tabela={<TabelaSerie nome={`saude_fns_composicao_${ref}`} anos={comp.dados.map((l) => rotuloComposicao({ bloco: String(l.bloco), grupo: String(l.grupo), estrategia: String(l.estrategia) }))}
                primeiraColuna={t('Bloco › grupo › estratégia (nomes da fonte)', 'Block › group › strategy (source names)')} semAnoSelecionado metadadosProprios
                conteudo={t(`composição do ano exibido (${ref}), com os rótulos que a fonte usa nesse ano`, `composition of the year shown (${ref}), with the labels the source uses that year`)} colunas={[
                  { titulo: t('Líquido (R$ correntes)', 'Net (current R$)'), valores: comp.dados.map((l) => num(l.liquido)), formato: (v) => reaisExato(v) },
                  { titulo: t('Bruto (R$ correntes)', 'Gross (current R$)'), valores: comp.dados.map((l) => num(l.bruto)), formato: (v) => reaisExato(v) },
                  { titulo: t('Participação no líquido', 'Share of net'), valores: comp.dados.map((l) => razaoPositiva(num(l.liquido), totalComp)), formato: (v) => pct(v, 1) },
                ]} metadados={[...comuns, [t('Ano exibido', 'Year shown'), String(ref)]]} />}>
              <Grafico opcao={opcaoBlocos} nome="saude_fns_composicao" altura={Math.max(260, 70 + 44 * blocos.length)} />
            </CartaoGrafico>
          )}
          <p className="nota-base">{avisoComposicao()} <a href={FNS_NOTA_828} target="_blank" rel="noreferrer">{t('Nota Informativa', 'Briefing note')}</a>.</p>
          <Ranking dados={rank.dados} carregando={rank.carregando} erro={rank.erro} recarregar={rank.recarregar} ref_={ref} uf={uf} rotulo={rotulo}
            alvo={municipio ? (f.alvo?.esfera === 'D' ? 5300108 : f.alvo?.cod_ibge ?? null) : null} comuns={comuns} base={base} />
        </>
      )}
      {versaoTem && !serie.carregando && !serie.erro && <BotoesExportar nome="saude_fns_resumo" obter={() => ({
        colunas: [t('Medida', 'Measure'), t('Ano', 'Year'), t('Valor', 'Value'), t('Condição do dado', 'Data condition')],
        linhas: resumoFns(a, ref, base),
        metadados: [...comuns, [t('Fonte (painel)', 'Source (panel)'), fonteSaude()]],
      })} />}
      <p className="nota-base">
        {t('Repasses fundo a fundo do Fundo Nacional de Saúde aos fundos de saúde, por ano do arquivo (a data da última liberação da conta não permite série mensal). O universo é o que o próprio FNS classifica como repasse municipal (TP_REPASSE), não o que se infere pela localização ou pelo nome da entidade: linhas de um município podem ser de fundo estadual e vice-versa. O saldo das contas é um estoque e nunca é somado. A população dos arquivos do FNS (de 2021) não é usada: o valor por habitante usa a população anual da SVS/MS. Município ou ano sem repasse aparece como "sem registro", nunca como zero. ',
          'Fund-to-fund transfers from the National Health Fund to health funds, by file year (the last-release date of the account does not allow a monthly series). The universe is what the FNS itself classifies as a municipal transfer (TP_REPASSE), not what is inferred from location or entity name: lines in one municipality may belong to a state fund and vice versa. Account balances are a stock and are never summed. The population in the FNS files (from 2021) is not used: the per-inhabitant value uses the annual SVS/MS population. A municipality or year without a transfer appears as "no record", never as zero. ')}
        {avisoNaoSomar()}{' '}
        <a href={FNS_CATALOGO} target="_blank" rel="noreferrer">{t('Fonte: Portal do FNS', 'Source: FNS portal')}</a>.
      </p>
    </>
  );
}

/** Municípios com repasse no ano: maiores ou menores, por líquido total ou por habitante; a exportação traz todos. */
function Ranking({ dados, carregando, erro, recarregar, ref_, uf, rotulo, alvo, comuns, base }: {
  dados: Linha[] | undefined; carregando: boolean; erro?: string; recarregar: () => void; ref_: number; uf: string | null; rotulo: string; alvo: number | null;
  comuns: [string, string][]; base: number;
}) {
  const [medida, setMedida] = useState<'percapita' | 'liquido'>('percapita');
  const [maiores, setMaiores] = useState(true);
  const ordenados = useMemo(() => ordenarMunicipios(dados ?? [], medida, maiores), [dados, medida, maiores]);
  const mostrados = ordenados.slice(0, 50);
  const posicaoAlvo = alvo ? ordenados.findIndex((l) => Number(l.cod_ibge) === alvo) : -1;
  const escopoRanking = uf ? t(`municípios de ${uf}`, `municipalities in ${uf}`) : t('municípios do Brasil', 'municipalities in Brazil');
  const semPop = (dados ?? []).filter((l) => !(num(l.populacao) !== null && (num(l.populacao) ?? 0) > 0)).length;
  const pc = (l: Linha) => razaoPositiva(num(l.liquido), num(l.populacao));
  return (
    <section className="cartao">
      <div className="cabeca-cartao">
        <div>
          <h3>{t(`Ranking dos ${escopoRanking}, ${ref_}`, `Ranking of ${escopoRanking}, ${ref_}`)}</h3>
          <p className="desc">{t('só municípios com repasse registrado no ano; o DF aparece como destinatário distrital (†)', 'only municipalities with a transfer recorded in the year; the DF appears as a district recipient (†)')}</p>
        </div>
        <div className="alternar" role="group" aria-label={t('Medida do ranking', 'Ranking measure')}>
          <button className={medida === 'percapita' ? 'ativo' : ''} onClick={() => setMedida('percapita')}>{t('Por habitante', 'Per inhabitant')}</button>
          <button className={medida === 'liquido' ? 'ativo' : ''} onClick={() => setMedida('liquido')}>{t('Líquido total', 'Net total')}</button>
        </div>
        <div className="alternar" role="group" aria-label={t('Ordem', 'Order')}>
          <button className={maiores ? 'ativo' : ''} onClick={() => setMaiores(true)}>{t('Maiores', 'Highest')}</button>
          <button className={!maiores ? 'ativo' : ''} onClick={() => setMaiores(false)}>{t('Menores', 'Lowest')}</button>
        </div>
      </div>
      <Estado carregando={carregando} erro={erro} tentarNovamente={recarregar} />
      {dados && dados.length > 0 && (
        <>
          {alvo && (
            <p className="nota-base">{posicaoAlvo >= 0
              ? t(`O município selecionado está na posição ${posicaoAlvo + 1} de ${numero(ordenados.length)} nesta ordem.`, `The selected municipality is in position ${posicaoAlvo + 1} of ${numero(ordenados.length)} in this order.`)
              : t('O município selecionado não tem valor nesta medida no ano (sem repasse ou sem população).', 'The selected municipality has no value for this measure in the year (no transfer or no population).')}</p>
          )}
          <div className="rolagem">
            <table>
              <thead><tr>
                <th>#</th><th style={{ textAlign: 'left' }}>{t('Município', 'Municipality')}</th><th>UF</th><th>{t('Líquido (R$ correntes)', 'Net (current R$)')}</th><th>{t('Por habitante (R$ correntes)', 'Per inhabitant (current R$)')}</th><th>{t('População SVS/MS', 'SVS/MS population')}</th>
              </tr></thead>
              <tbody>
                {mostrados.map((l, i) => (
                  <tr key={String(l.municipio)} className={alvo && Number(l.cod_ibge) === alvo ? 'destaque' : undefined}>
                    <td>{i + 1}</td><td style={{ textAlign: 'left' }}>{String(l.nome ?? l.municipio)}{l.destino === 'distrital' ? ' †' : ''}</td><td>{String(l.uf ?? '')}</td>
                    <td>{reaisExato(num(l.liquido))}</td><td>{reaisExato(pc(l))}</td><td>{numero(num(l.populacao))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="nota-base">
            {t(`Mostrando ${mostrados.length} de ${numero(ordenados.length)}.`, `Showing ${mostrados.length} of ${numero(ordenados.length)}.`)}{' '}
            {semPop ? t(`${numero(semPop)} município(s) sem população no ano ficam fora do ranking por habitante.`, `${numero(semPop)} municipality(ies) without population in the year are left out of the per-inhabitant ranking.`) : ''}
          </p>
          <BotoesExportar nome={`saude_fns_municipios_${ref_}`} obter={() => ({
            colunas: ['cod_ibge', t('Município', 'Municipality'), 'UF', t('Destinatário', 'Recipient'), t('Líquido (R$ correntes)', 'Net (current R$)'), t('Bruto (R$ correntes)', 'Gross (current R$)'),
              ref_ >= REAL_DESDE ? t(`Líquido (R$ de ${base})`, `Net (R$ of ${base})`) : t('Líquido real (indisponível antes de 2006)', 'Net real (unavailable before 2006)'),
              t('População SVS/MS', 'SVS/MS population'), t('Líquido por habitante (R$ correntes)', 'Net per inhabitant (current R$)')],
            linhas: (dados ?? []).map((l) => [num(l.cod_ibge), String(l.nome ?? ''), String(l.uf ?? ''), l.destino === 'distrital' ? t('distrital (DF)', 'district (DF)') : t('municipal', 'municipal'),
              num(l.liquido), num(l.bruto), num(l.liquido_real), num(l.populacao), pc(l)]),
            metadados: [...comuns, [t('Ano exibido', 'Year shown'), String(ref_)], [t('Recorte do ranking', 'Ranking scope'), uf ?? rotulo], [t('Fonte (painel)', 'Source (panel)'), fonteSaude()]],
          })} />
        </>
      )}
    </section>
  );
}
