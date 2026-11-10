import { useMemo, type ReactNode } from 'react';
import { type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { numero } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { anosDaColuna, calcular, colunaGrupoIcsap, condicaoDado, faixaAnos, fonteSaude, GRUPOS_ICSAP, indicador, motivoSemValor, rotuloCondicao, textoMotivo, textoValor, type FontesMeta } from '../saude_comum';
import { Atalhos, numero1Local, referencia, useColunasSaude } from './SaudeDatasus';

const pct1 = (v: number | null) => (v === null ? '–' : `${numero1Local(100 * v)}%`);
const taxa1 = (v: number | null) => (v === null ? '–' : numero1Local(v));
const FORA = () => t('fora da cobertura', 'outside coverage');
const PORTARIA = 'https://bvsms.saude.gov.br/bvs/saudelegis/sas/2008/prt0221_17_04_2008.html';
const FICHA = 'https://proadess.fiocruz.br/?pag=fic&cod=B11&tab=1';

/**
 * Internações por condições sensíveis à atenção primária (ICSAP), dentro da atenção primária de Rede e acesso: total, taxa por
 * 10 mil habitantes, participação nas internações (de residentes, exceto partos) e os 19 grupos da Lista Brasileira (Portaria
 * SAS/MS nº 221/2008). Usa a série do escopo já carregada pela página (saude_serie): em UF e Brasil a taxa e a participação são
 * a razão das somas. Versão dos dados sem as colunas icsap_*: o bloco diz que é indisponível, sem zeros nem erro.
 */
export function BlocoIcsap({ serieDados, ano, semAno, rotulo, municipio, fontes, versao }: {
  serieDados: Linha[] | undefined; ano: number; semAno: boolean; rotulo: string; municipio: boolean; fontes: FontesMeta; versao: string;
}) {
  const colunas = useColunasSaude();
  const dados = serieDados ?? [];
  // a versão carregada precisa ter as colunas e o manifesto precisa dizer os anos; sem um dos dois, a medida é indisponível
  const versaoTem = !!fontes.icsap && (colunas === null || colunas.has('icsap_int')) && (dados.length === 0 || 'icsap_int' in dados[0]);
  const cobertos = anosDaColuna('icsap_int', fontes);
  const ref = referencia(cobertos, ano, semAno);
  const a = dados.find((r) => Number(r.ano) === ref);
  const indTaxa = indicador('icsap_taxa');
  const indProp = indicador('icsap_proporcao');
  const anosS = dados.map((r) => Number(r.ano)).filter((x) => cobertos.includes(x));
  const doIcsap = dados.filter((r) => cobertos.includes(Number(r.ano)));
  const valorTaxa = (r: Linha | undefined) => calcular(indTaxa, r);
  const valorProp = (r: Linha | undefined) => calcular(indProp, r);

  const grupos = GRUPOS_ICSAP.map(([n, nome]) => ({ n, nome: `${String(n).padStart(2, '0')} · ${nome()}`, v: num(a?.[colunaGrupoIcsap(n)]) }));
  const totalGrupos = grupos.reduce((s, g) => s + (g.v ?? 0), 0);
  const ordenados = [...grupos].sort((x, y) => (y.v ?? -1) - (x.v ?? -1));

  const opcaoTaxa = useMemo(() => linhas(anosS, [{ nome: t('ICSAP por 10 mil habitantes', 'ICSAP per 10,000 inhabitants'), valores: doIcsap.map(valorTaxa) }], (v) => numero1Local(v)), [serieDados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoProp = useMemo(() => linhas(anosS, [{ nome: t('Participação nas internações (%)', 'Share of admissions (%)'), valores: doIcsap.map((r) => { const v = valorProp(r); return v === null ? null : 100 * v; }) }], (v) => `${numero1Local(v)}%`), [serieDados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoGrupos = useMemo(() => barras(ordenados.map((g) => g.nome), ordenados.map((g) => g.v), (v) => numero(v), true), [serieDados, ref]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!versaoTem) {
    return <p className="aviso" role="status">{t('Internações por condições sensíveis à atenção primária (ICSAP): indisponíveis nesta versão dos dados.', 'Ambulatory care-sensitive hospitalisations (ICSAP): unavailable in this data version.')}</p>;
  }
  if (dados.length === 0) return null;

  const cond = a ? condicaoDado('icsap_int', num(a.icsap_int), ref, fontes) : null;
  const semValorContagem = (): string => (ref === null ? FORA() : t('sem registro', 'no record'));
  const kpiContagem = (): ReactNode => {
    const rotuloK = t('Internações por ICSAP', 'ICSAP admissions');
    const dica = <Dica rotulo={t('Como ler', 'How to read')}>{t('Internações pagas pelo SUS (AIH tipo 1) de residentes cujo diagnóstico principal consta na Lista Brasileira de ICSAP. Cada internação conta uma vez.', 'SUS-paid admissions (type-1 AIH) of residents whose principal diagnosis is on the Brazilian ICSAP List. Each admission counts once.')}</Dica>;
    if (ref === null || !a || cond === 'ausente') return <Kpi rotulo={rotuloK} valor={semValorContagem()} dica={dica} nota={ref === null ? `ICSAP: ${faixaAnos(cobertos)}` : `${ref}`} />;
    return <Kpi rotulo={rotuloK} valor={textoValor(cond!, numero(num(a.icsap_int)))} dica={dica} nota={`SIH ${ref}${cond === 'zero_registrado' ? ` · ${rotuloCondicao(cond)}` : ''}`} />;
  };
  const kpiIndicador = (ind: typeof indTaxa, rotuloK: string, formatar: (v: number | null) => string, detalhe: string): ReactNode => {
    const dica = <Dica rotulo={t('Fórmula', 'Formula')}>{ind.nota()} {ind.alerta?.()}</Dica>;
    if (ref === null) return <Kpi rotulo={rotuloK} valor={FORA()} dica={dica} nota={`ICSAP: ${faixaAnos(cobertos)}`} />;
    // sem valor por três motivos diferentes: numerador ausente (sem registro), denominador ausente ou denominador zero (indefinida)
    const motivo = motivoSemValor(ind, a);
    if (motivo) { const x = textoMotivo(motivo, ind); return <Kpi rotulo={rotuloK} valor={x.valor} dica={dica} nota={`${ref} · ${x.nota}`} />; }
    const v = calcular(ind, a)!;
    return <Kpi rotulo={rotuloK} valor={formatar(v)} dica={dica} nota={<>{ref} · {detalhe}<Atalhos ind={ind} ano={ref} /></>} />;
  };

  const base = num(a?.icsap_base);
  /** Condição do dado de um indicador calculado (para as exportações): fora da cobertura, o motivo de não haver valor, zero ou registrado. */
  const condicaoCalculo = (ind: typeof indTaxa, r: Linha | undefined): string => {
    if (ref === null) return rotuloCondicao('fora_cobertura');
    const m = motivoSemValor(ind, r);
    if (m) return textoMotivo(m, ind).rotulo;
    return rotuloCondicao(calcular(ind, r) === 0 ? 'zero_registrado' : 'registrado');
  };
  const comuns: [string, string][] = [
    [t('Recorte', 'Scope'), rotulo],
    [t('Fonte', 'Source'), `${t('SIH/SUS, AIH reduzida (tipo 1), pelo município de residência e ano de competência', 'SIH/SUS, reduced AIH (type 1), by municipality of residence and competence year')}; ${t('Lista Brasileira de ICSAP, Portaria SAS/MS nº 221/2008', 'Brazilian ICSAP List, Ordinance SAS/MS 221/2008')} (${PORTARIA})`],
    [t('Classificação', 'Classification'), t('diagnóstico principal da AIH (CID-10); entrada da lista com 3 caracteres vale para qualquer subcategoria, entrada com subcategoria exige a subcategoria', 'principal diagnosis of the AIH (ICD-10); a 3-character list entry covers any subcategory, an entry with a subcategory requires it')],
    [t('Denominador da participação', 'Share denominator'), t('internações pagas pelo SUS de residentes, exceto partos (CID-10 O80–O84), como na ficha do PROADESS/Fiocruz', 'SUS-paid admissions of residents, excluding deliveries (ICD-10 O80–O84), as in the PROADESS/Fiocruz sheet')],
    [t('Denominador da taxa', 'Rate denominator'), t('população residente, estimativa da SVS/MS', 'resident population, SVS/MS estimate')],
    [t('Regra de agregação', 'Aggregation rule'), municipio ? t('município', 'municipality') : t('UF e Brasil: soma de numeradores e de denominadores dos municípios antes de calcular taxa e participação (nunca média das taxas)', 'State and Brazil: sum of numerators and denominators of the municipalities before computing rate and share (never an average of rates)')],
    [t('Cobertura', 'Coverage'), faixaAnos(cobertos)],
    [t('Leitura', 'Reading'), t('medida indireta, relacionada à atenção primária e ao uso hospitalar; não avalia, isoladamente, a qualidade da gestão', 'indirect measure related to primary care and hospital use; on its own it does not assess management quality')],
    [t('Versão da base', 'Data version'), versao],
  ];

  return (
    <>
      <p className="nota-base">
        <strong>{t('Internações por condições sensíveis à atenção primária (ICSAP)', 'Ambulatory care-sensitive hospitalisations (ICSAP)')}</strong>
        {' · '}{t('pelo município de residência, diagnóstico principal', 'by municipality of residence, principal diagnosis')} · SIH {ref ?? FORA()}{ref === null ? ` (${faixaAnos(cobertos)})` : ''}
      </p>
      <div className="kpis">
        {kpiContagem()}
        {kpiIndicador(indTaxa, t('ICSAP por 10 mil habitantes', 'ICSAP per 10,000 inhabitants'), taxa1, t(`${numero(num(a?.icsap_int))} internações ÷ ${numero(num(a?.populacao))} habitantes × 10 mil`, `${numero(num(a?.icsap_int))} admissions ÷ ${numero(num(a?.populacao))} inhabitants × 10,000`))}
        {kpiIndicador(indProp, t('Participação das ICSAP nas internações', 'ICSAP share of admissions'), (v) => pct1(v), t(`denominador: ${numero(base)} internações de residentes, exceto partos`, `denominator: ${numero(base)} residents’ admissions, excluding deliveries`))}
      </div>
      <div className="grade-2">
        {anosS.length > 0 && (
          <CartaoGrafico titulo={t(`ICSAP por 10 mil habitantes, ${faixaAnos(cobertos)}`, `ICSAP per 10,000 inhabitants, ${faixaAnos(cobertos)}`)} desc={`${rotulo} · ${t('SIH, por ano de competência', 'SIH, by competence year')}`}
            tabela={<TabelaSerie nome="saude_icsap" anos={anosS} metadadosProprios colunas={[
              { titulo: t('Internações por ICSAP', 'ICSAP admissions'), valores: doIcsap.map((r) => num(r.icsap_int)), formato: numero },
              { titulo: t('ICSAP por 10 mil habitantes', 'ICSAP per 10,000 inhabitants'), valores: doIcsap.map(valorTaxa), formato: taxa1 },
              { titulo: t('População residente', 'Resident population'), valores: doIcsap.map((r) => num(r.populacao)), formato: numero },
              { titulo: t('Internações de residentes, exceto partos', 'Residents’ admissions, excluding deliveries'), valores: doIcsap.map((r) => num(r.icsap_base)), formato: numero },
              { titulo: t('Participação das ICSAP nas internações (%)', 'ICSAP share of admissions (%)'), valores: doIcsap.map((r) => { const v = valorProp(r); return v === null ? null : 100 * v; }), formato: (v) => (v === null ? '–' : `${numero1Local(v)}%`) },
              ...GRUPOS_ICSAP.map(([n, nome]) => ({ titulo: `${String(n).padStart(2, '0')} · ${nome()}`, valores: doIcsap.map((r) => num(r[colunaGrupoIcsap(n)])), formato: numero })),
            ]} metadados={comuns} />}>
            <Grafico opcao={opcaoTaxa} nome="saude_icsap_taxa" />
          </CartaoGrafico>
        )}
        {anosS.length > 0 && (
          <CartaoGrafico titulo={t(`Participação das ICSAP nas internações, ${faixaAnos(cobertos)} (%)`, `ICSAP share of admissions, ${faixaAnos(cobertos)} (%)`)} desc={`${rotulo} · ${t('internações de residentes, exceto partos', 'residents’ admissions, excluding deliveries')}`}>
            <Grafico opcao={opcaoProp} nome="saude_icsap_participacao" />
          </CartaoGrafico>
        )}
      </div>
      {a && ref !== null && (
        <CartaoGrafico titulo={t(`ICSAP por grupo de causas, ${ref}`, `ICSAP by cause group, ${ref}`)} desc={`${rotulo} · ${t('19 grupos da Lista Brasileira (Portaria SAS/MS nº 221/2008)', '19 groups of the Brazilian List (Ordinance SAS/MS 221/2008)')}`}
          tabela={<TabelaSerie nome={`saude_icsap_grupos_${ref}`} anos={grupos.map((g) => g.nome)} primeiraColuna={t('Grupo da lista', 'List group')} semAnoSelecionado metadadosProprios
            conteudo={t(`distribuição por grupo de causas do ano exibido (${ref})`, `distribution by cause group for the year shown (${ref})`)} colunas={[
              { titulo: t('Internações por ICSAP', 'ICSAP admissions'), valores: grupos.map((g) => g.v), formato: numero },
              { titulo: t('Participação nas ICSAP', 'Share of ICSAP'), valores: grupos.map((g) => (totalGrupos && g.v !== null ? g.v / totalGrupos : null)), formato: pct1 },
            ]} metadados={[...comuns, [t('Ano exibido', 'Year shown'), String(ref)]]} />}>
          <Grafico opcao={opcaoGrupos} nome="saude_icsap_grupos" altura={560} />
        </CartaoGrafico>
      )}
      <BotoesExportar nome="saude_icsap_resumo" obter={() => ({
        colunas: [t('Medida', 'Measure'), t('Ano', 'Year'), t('Valor', 'Value'), t('Condição do dado', 'Data condition')],
        linhas: [
          ['icsap_int', ref, num(a?.icsap_int), ref === null ? rotuloCondicao('fora_cobertura') : rotuloCondicao(condicaoDado('icsap_int', num(a?.icsap_int), ref, fontes))],
          ['icsap_base', ref, num(a?.icsap_base), ref === null ? rotuloCondicao('fora_cobertura') : rotuloCondicao(condicaoDado('icsap_base', num(a?.icsap_base), ref, fontes))],
          ['icsap_taxa_por_10_mil', ref, valorTaxa(a), condicaoCalculo(indTaxa, a)],
          ['icsap_participacao_pct', ref, valorProp(a) === null ? null : 100 * valorProp(a)!, condicaoCalculo(indProp, a)],
          ...GRUPOS_ICSAP.map(([n]) => [colunaGrupoIcsap(n), ref, num(a?.[colunaGrupoIcsap(n)]), ref === null ? rotuloCondicao('fora_cobertura') : rotuloCondicao(condicaoDado(colunaGrupoIcsap(n), num(a?.[colunaGrupoIcsap(n)]), ref, fontes))]),
        ],
        metadados: [...comuns, [t('Fonte (painel)', 'Source (panel)'), fonteSaude()]],
      })} />
      <p className="nota-base">
        {t('ICSAP são internações por condições em que uma atenção primária oportuna e resolutiva, em tese, poderia evitar ou reduzir a hospitalização. É uma medida indireta, relacionada à atenção primária e ao uso hospitalar: não avalia, isoladamente, a qualidade da gestão nem estabelece causa, e depende também da idade da população, da oferta de leitos, do acesso ao SUS e de como o diagnóstico é registrado. Conta só internações pagas pelo SUS (AIH tipo 1), classificadas pelo diagnóstico principal na Lista Brasileira de ICSAP (19 grupos). A taxa é por 10 mil habitantes; a participação tem como denominador as internações de residentes, exceto partos (CID-10 O80–O84). Em UF e Brasil somam-se numeradores e denominadores antes de calcular taxa e participação. Município sem internação no ano aparece como "sem registro"; zero só onde há internações e nenhuma é ICSAP. Fonte: ',
          'ICSAP are admissions for conditions in which timely, effective primary care could, in theory, prevent or reduce hospitalisation. It is an indirect measure related to primary care and hospital use: on its own it neither assesses management quality nor establishes cause, and it also depends on population age, bed supply, access to SUS and how the diagnosis is recorded. It counts only SUS-paid admissions (type-1 AIH), classified by principal diagnosis on the Brazilian ICSAP List (19 groups). The rate is per 10,000 inhabitants; the share uses residents’ admissions, excluding deliveries (ICD-10 O80–O84), as the denominator. For states and Brazil, numerators and denominators are summed before computing rate and share. A municipality with no admissions in the year appears as "no record"; zero only where there are admissions and none is ICSAP. Source: ')}
        <a href={PORTARIA} target="_blank" rel="noreferrer">{t('Portaria SAS/MS nº 221/2008', 'Ordinance SAS/MS 221/2008')}</a>{' · '}
        <a href={FICHA} target="_blank" rel="noreferrer">PROADESS/Fiocruz</a>.
      </p>
    </>
  );
}
