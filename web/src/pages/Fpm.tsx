import { useMemo, useState } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar, useMetadados } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, Cobertura, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, razao, useIndicadores } from '../hooks';
import { faixa, t } from '../idioma';
import { textoReferencia } from './Receitas';

const pctEixo = (v: number) => pct(v, 0);
const formulaDependencia = () =>
  t(
    'Dependência do FPM = FPM bruto ÷ receita corrente bruta (sem intraorçamentárias, antes das deduções). Em grupos: soma do FPM ÷ soma da receita corrente, só dos municípios com os dois valores; na visão com filtro, sem os ente-anos sinalizados na receita.',
    'FPM dependency = gross FPM ÷ gross current revenue (excluding intra-budgetary, before deductions). For groups: sum of FPM ÷ sum of current revenue, only for municipalities with both values; in the filtered view, without government-years flagged in revenue.',
  );
const formulaTransferencias = () =>
  t(
    'Dependência de transferências correntes = transferências correntes recebidas (União, estados, municípios e outras origens, inclusive FPM) ÷ receita corrente bruta.',
    'Current transfer dependency = current transfers received (federal, state, municipal and other sources, including FPM) ÷ gross current revenue.',
  );
const textoFpmBruto = () =>
  t(
    'FPM bruto: o valor registrado na receita bruta realizada (cota mensal, cotas extraordinárias e as cotas adicionais de 1% de julho e de dezembro, conforme o período). A dedução para o FUNDEB incide sobre a cota mensal; as cotas adicionais de 1% não compõem a base do FUNDEB. O painel não calcula um FPM líquido: as deduções declaradas aparecem no Anexo I-C, nas colunas de dedução.',
    'Gross FPM: the amount recorded in gross revenue collected (monthly quota, extraordinary quotas and the additional 1% quotas of July and December, depending on the period). The FUNDEB deduction applies to the monthly quota; the additional 1% quotas are not part of the FUNDEB base. The dashboard does not compute a net FPM: reported deductions appear in Annex I-C, in the deduction columns.',
  );

export function Fpm() {
  const { meta } = useDados();
  const [painel, setPainel] = useState(false);
  const { alvo, comp, f } = useIndicadores(['fpm', 'receita_corrente', 'transferencias_correntes'], {
    pares: ['fpm/receita_corrente', 'transferencias_correntes/receita_corrente'], painel,
  });
  const s = alvo.dados ?? [];
  const c = comp.dados ?? [];
  const anos = s.map((r) => r.exercicio as number);
  const noAno = (d: Linha[]) => d.find((r) => r.exercicio === f.ano);
  const a = noAno(s);
  const b = noAno(c);
  const dependencia = (r?: Linha) => razao(r, 'fpm', 'receita_corrente');
  const depTransf = (r?: Linha) => razao(r, 'transferencias_correntes', 'receita_corrente');
  const perCapita = (r?: Linha) => div(num(r?.fpm), num(r?.populacao_fpm));
  const periodo = anos.length ? `${anos[0]}–${anos.at(-1)}` : '';
  const semFpm = a && a.fpm === null && f.alvo;

  const opcaoFpm = useMemo(
    () => linhas(anos, [
      { nome: 'Nominal', valores: s.map((r) => num(r.fpm)) },
      { nome: t(`Real (R$ de dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((r) => num(r.fpm_real)) },
    ], reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados],
  );
  const opcaoDep = useMemo(
    () => linhas(anos, [
      { nome: f.rotulo, valores: s.map(dependencia) },
      ...(f.rotuloComparador && c.length ? [{ nome: f.rotuloComparador, valores: anos.map((ano) => dependencia(c.find((r) => r.exercicio === ano))) }] : []),
    ], pctEixo),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados, comp.dados],
  );

  return (
    <>
      <h2 className="titulo-pagina">{t('Fundo de Participação dos Municípios', 'Municipal Participation Fund (FPM)')}</h2>
      <p className="subtitulo">{f.rotulo} · {t('FPM bruto', 'Gross FPM')} <Dica rotulo={t('O que é o FPM bruto', 'What gross FPM is')}>{textoFpmBruto()}</Dica></p>
      <BarraFiltros />
      <Cobertura dominio="receita" />
      {!f.alvo && (
        <label className="caixa">
          <input type="checkbox" checked={painel} onChange={(e) => setPainel(e.target.checked)} />
          {t('Painel balanceado: só os municípios com FPM em todos os exercícios', 'Balanced panel: only municipalities with FPM in every fiscal year')}
        </label>
      )}
      {semFpm && (
        <p className="aviso" role="status">
          {t(
            `A DCA de ${f.ano} deste ente não traz a conta do FPM (nem as subcontas de cota mensal ou extraordinária), embora informe outras receitas. A ausência está na declaração de origem; o painel não preenche o valor.`,
            `This government’s ${f.ano} DCA does not include the FPM account (nor the monthly or extraordinary quota sub-accounts), although it reports other revenue. The gap is in the original filing; the dashboard does not fill in the value.`,
          )}
        </p>
      )}
      <h3 className="secao">{t(`Exercício de referência: ${f.ano}`, `Reference year: ${f.ano}`)}{painel ? ` · ${t('painel balanceado', 'balanced panel')}` : ''}</h3>
      <div className="kpis">
        <Kpi rotulo={t(`FPM em ${f.ano}`, `FPM in ${f.ano}`)} valor={semFpm ? t('não declarado', 'not reported') : reais(num(a?.fpm))}
          nota={`${t('Real', 'Real')} (R$ dez/${meta.baseIpca}): ${reais(num(a?.fpm_real))}`} />
        <Kpi rotulo={t('FPM per capita', 'FPM per capita')} valor={reaisExato(perCapita(a))}
          nota={f.rotuloComparador ? `${f.rotuloComparador}: ${reaisExato(perCapita(b))}` : undefined}
          dica={f.rotuloComparador ? <Dica rotulo={t('Referência', 'Reference')}>{textoReferencia()}</Dica> : undefined} />
        <Kpi rotulo={t('Dependência do FPM', 'FPM dependency')} valor={pct(dependencia(a))}
          nota={f.rotuloComparador ? `${f.rotuloComparador}: ${pct(dependencia(b))}` : t('FPM ÷ receita corrente', 'FPM ÷ current revenue')}
          dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulaDependencia()}</Dica>} />
        <Kpi rotulo={t('Dependência de transferências correntes', 'Current transfer dependency')} valor={pct(depTransf(a))}
          nota={f.rotuloComparador ? `${f.rotuloComparador}: ${pct(depTransf(b))}` : undefined}
          dica={<Dica rotulo={t('Fórmula', 'Formula')}>{formulaTransferencias()}</Dica>} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} tentarNovamente={alvo.recarregar}
        vazio={!alvo.carregando && !s.some((r) => r.fpm) && t('Sem FPM declarado para este filtro.', 'No FPM reported for this filter.')} />
      {s.some((r) => r.fpm) && (
        <>
          <h3 className="secao">{t(`Série completa: ${periodo}`, `Full series: ${periodo}`)}</h3>
          <div className="grade-2">
            <CartaoGrafico titulo={t('FPM por exercício', 'FPM by fiscal year')}
              desc={t('Nominal e corrigido pelo IPCA; anos sem declaração ficam em branco', 'Nominal and adjusted by the IPCA; years without a filing are left blank')}
              tabela={<TabelaSerie nome="fpm" anos={anos} colunas={[
                { titulo: t('Nominal (R$ correntes)', 'Nominal (current R$)'), valores: s.map((r) => num(r.fpm)), formato: reais },
                { titulo: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((r) => num(r.fpm_real)), formato: reais },
                ...(f.alvo ? [] : [{ titulo: t('Municípios com FPM', 'Municipalities with FPM'), valores: s.map((r) => num(r.entes_fpm)), formato: numero }]),
              ]} metadados={[[t('Painel balanceado', 'Balanced panel'), painel ? t('sim', 'yes') : t('não', 'no')]]} />}>
              <Grafico opcao={opcaoFpm} nome="fpm" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Dependência do FPM', 'FPM dependency')} desc={t('FPM ÷ receita corrente', 'FPM ÷ current revenue')}
              acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{formulaDependencia()}</Dica>}
              tabela={<TabelaSerie nome="dependencia_fpm" anos={anos} colunas={[
                { titulo: t('Dependência do FPM', 'FPM dependency'), valores: s.map(dependencia), formato: (v) => pct(v) },
                { titulo: t('Dependência de transferências', 'Transfer dependency'), valores: s.map(depTransf), formato: (v) => pct(v) },
                ...(f.alvo ? [] : [{ titulo: t('Municípios na razão', 'Municipalities in the ratio'), valores: s.map((r) => num(r.fpm__receita_corrente_entes)), formato: numero }]),
              ]} />}>
              <Grafico opcao={opcaoDep} nome="dependencia_fpm" />
            </CartaoGrafico>
          </div>
        </>
      )}
    </>
  );
}

type Faixa = { grupo: number; nome: string; faixa: string; pop_min: number; pop_max: number | null };

export function FpmFaixas() {
  const f = useFiltros();
  const metadados = useMetadados();
  const faixas = useApi<Faixa[]>('faixas');
  const base = { campos: 'fpm,receita_corrente', pares: 'fpm/receita_corrente', ano: f.ano, esfera: 'M', tratamento: f.tratamento };
  const porFaixa = useApi<Linha[]>('agregado', { por: 'faixa_grupo', uf: f.uf && f.uf !== 'DF' ? f.uf : undefined, ...base });
  const daEnte = useApi<Linha[]>(f.ente?.esfera === 'M' ? 'agregado' : null, { por: 'faixa_grupo', ente: f.ente?.cod_ibge, ...base });
  const faixaEnte = num(daEnte.dados?.[0]?.faixa_grupo);
  const [grupo, setGrupo] = useState<number | ''>('');
  const porUf = useApi<Linha[]>('agregado', { por: 'uf', faixa: grupo, ...base });

  const linhasFaixa = (faixas.dados ?? []).map((fx) => {
    const r = porFaixa.dados?.find((l) => l.faixa_grupo === fx.grupo);
    return { ...fx, r, perCapita: div(num(r?.fpm), num(r?.populacao_fpm)) };
  });
  const opcao = useMemo(
    () => barras(linhasFaixa.map((l) => `${faixa(l.faixa)}${l.grupo === faixaEnte ? ' ◆' : ''}`), linhasFaixa.map((l) => l.perCapita), reaisCurto, true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [porFaixa.dados, faixas.dados, faixaEnte],
  );
  const colDependencia = <th>{t('Dependência do FPM', 'FPM dependency')} <Dica rotulo={t('Fórmula', 'Formula')}>{formulaDependencia()}</Dica></th>;
  const escopoTabela = f.uf && f.uf !== 'DF' ? t(`Municípios de ${f.uf}`, `Municipalities in ${f.uf}`) : t('Municípios com dados no Brasil', 'Municipalities with data in Brazil');

  return (
    <>
      <h2 className="titulo-pagina">{t('FPM por faixa populacional', 'FPM by population bracket')}</h2>
      <p className="subtitulo">{escopoTabela} · {f.ano}</p>
      <BarraFiltros semEnte={t(
        'Nesta página o município selecionado não restringe os resultados: a faixa dele é destacada (◆) e a UF dele define o recorte da tabela por faixa.',
        'On this page the selected municipality does not restrict the results: its bracket is highlighted (◆) and its state sets the scope of the bracket table.',
      )} />
      <p className="aviso">
        {t(
          'As faixas são agrupamentos analíticos de população (limites em 5, 10, 20, 30, 50, 80, 100, 150, 200, 300, 400, 500 e 750 mil, 1, 1,5, 2 e 3 milhões de habitantes), escolhidos para comparar municípios de porte parecido. Não são as faixas dos coeficientes do FPM (Decreto-Lei nº 1.881/1981), que tratam de forma distinta capitais, interior e reserva; o coeficiente aplicado a cada município é fixado anualmente pelo TCU e pode diferir do teórico.',
          'Brackets are analytical population groups (cut-offs at 5, 10, 20, 30, 50, 80, 100, 150, 200, 300, 400, 500 and 750 thousand, 1, 1.5, 2 and 3 million inhabitants), chosen to compare municipalities of similar size. They are not the FPM coefficient brackets (Decree-Law No. 1,881/1981), which treat state capitals, the interior and the reserve differently; the coefficient applied to each municipality is set yearly by the Federal Court of Accounts (TCU) and may differ from the theoretical one.',
        )}
      </p>
      {f.ente?.esfera === 'M' && (
        <p className="nota-base" role="status">
          {faixaEnte
            ? t(`${f.ente.nome} (${f.ente.uf}) está na faixa ${faixa(linhasFaixa.find((l) => l.grupo === faixaEnte)?.faixa ?? '')} em ${f.ano} (◆).`,
              `${f.ente.nome} (${f.ente.uf}) is in the ${faixa(linhasFaixa.find((l) => l.grupo === faixaEnte)?.faixa ?? '')} bracket in ${f.ano} (◆).`)
            : t(`${f.ente.nome} não tem população declarada em ${f.ano}.`, `${f.ente.nome} has no reported population in ${f.ano}.`)}
        </p>
      )}
      {f.uf === 'DF' && (
        <p className="nota-base">{t('O Distrito Federal não tem municípios; a tabela mostra o Brasil.', 'The Federal District has no municipalities; the table shows Brazil.')}</p>
      )}
      <Estado carregando={porFaixa.carregando} erro={porFaixa.erro} tentarNovamente={porFaixa.recarregar} />
      <CartaoGrafico titulo={t('FPM per capita por faixa', 'FPM per capita by bracket')}
        desc={t('Municípios agrupados pela população declarada no exercício; soma do FPM ÷ soma da população da faixa', 'Municipalities grouped by population reported in the year; sum of FPM ÷ sum of the bracket’s population')}>
        <Grafico opcao={opcao} altura={Math.max(320, linhasFaixa.length * 26)} nome="fpm_por_faixa" />
      </CartaoGrafico>
      <section className="cartao">
        <div className="cabeca-cartao">
          <h3>{t('Faixas populacionais (analíticas)', 'Population brackets (analytical)')}</h3>
          <BotoesExportar nome="fpm_faixas" obter={() => ({
            colunas: [t('Grupo', 'Group'), t('Habitantes', 'Inhabitants'), t('Municípios com FPM', 'Municipalities with FPM'), t('População', 'Population'),
              t('FPM (R$ correntes)', 'FPM (current R$)'), t('FPM per capita', 'FPM per capita'), t('Dependência do FPM', 'FPM dependency')],
            linhas: linhasFaixa.map((l) => [l.nome, l.faixa, num(l.r?.entes_fpm), num(l.r?.populacao_fpm), num(l.r?.fpm), l.perCapita,
              razao(l.r, 'fpm', 'receita_corrente')]),
            metadados: metadados([[t('Recorte da tabela', 'Table scope'), escopoTabela]]),
          })} />
        </div>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('Grupo', 'Group')}</th><th>{t('Habitantes', 'Inhabitants')}</th><th>{t('Municípios com FPM', 'Municipalities with FPM')}</th>
                <th>{t('População', 'Population')}</th><th>FPM</th><th>{t('FPM per capita', 'FPM per capita')}</th>{colDependencia}
              </tr>
            </thead>
            <tbody>
              {linhasFaixa.map((l) => (
                <tr key={l.grupo} className={l.grupo === faixaEnte ? 'destaque' : undefined}>
                  <td>{faixa(l.nome)}{l.grupo === faixaEnte ? ' ◆' : ''}</td><td>{faixa(l.faixa)}</td>
                  {l.r ? (
                    <>
                      <td>{numero(num(l.r.entes_fpm))}</td><td>{numero(num(l.r.populacao_fpm))}</td>
                      <td>{reais(num(l.r.fpm))}</td><td>{reaisExato(l.perCapita)}</td>
                      <td>{pct(razao(l.r, 'fpm', 'receita_corrente'))}</td>
                    </>
                  ) : (
                    <td colSpan={5} className="sem-obs">{t('nenhum município nesta faixa no recorte', 'no municipality in this bracket for the scope')}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t('Por UF', 'By state')}</h3>
            <p className="desc">
              {t(
                'Compara os estados entre si, para a faixa escolhida (todas as UFs, independentemente do filtro de UF acima). Útil para ver como municípios de mesmo porte dependem do FPM em cada estado.',
                'Compares states with each other for the chosen bracket (all states, regardless of the state filter above). Useful to see how municipalities of the same size depend on FPM in each state.',
              )}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="faixa">{t('Faixa', 'Bracket')}</label>
            <select id="faixa" value={grupo} onChange={(e) => setGrupo(e.target.value ? Number(e.target.value) : '')}>
              <option value="">{t('Todas', 'All')}</option>
              {(faixas.dados ?? []).map((fx) => <option key={fx.grupo} value={fx.grupo}>{faixa(fx.nome)} · {faixa(fx.faixa)}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={porUf.carregando} erro={porUf.erro} tentarNovamente={porUf.recarregar} />
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('UF', 'State')}</th><th>{t('Municípios com FPM', 'Municipalities with FPM')}</th><th>FPM</th><th>{t('FPM real', 'Real FPM')}</th>
                <th>{t('FPM per capita', 'FPM per capita')}</th>{colDependencia}
              </tr>
            </thead>
            <tbody>
              {(porUf.dados ?? []).map((r) => (
                <tr key={String(r.uf)} className={r.uf === f.uf ? 'destaque' : undefined}>
                  <td>{r.uf}</td><td>{numero(num(r.entes_fpm))}</td><td>{reais(num(r.fpm))}</td><td>{reais(num(r.fpm_real))}</td>
                  <td>{reaisExato(div(num(r.fpm), num(r.populacao_fpm)))}</td><td>{pct(razao(r, 'fpm', 'receita_corrente'))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
