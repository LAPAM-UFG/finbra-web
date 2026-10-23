import { useMemo } from 'react';
import type { Linha } from '../api';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useIndicadores } from '../hooks';
import { t } from '../idioma';
import { TabelaSerie } from './Receitas';

const CAMPOS = [
  'pib', 'receita_bruta', 'receita_impostos_taxas', 'vab_agropecuaria', 'vab_industria', 'vab_servicos',
  'vab_adm_publica', 'bolsa_familia_valor', 'bolsa_familia_familias', 'inss_beneficios',
];

export function Socioeconomico() {
  const { alvo, comp, f } = useIndicadores(CAMPOS);
  const s = (alvo.dados ?? []).filter((r) => r.pib !== null || r.receita_bruta !== null);
  const c = comp.dados ?? [];
  const anos = s.map((r) => r.exercicio as number);
  const pibPc = (r?: Linha) => div(num(r?.pib), num(r?.populacao));
  const receitaPib = (r?: Linha) => div(num(r?.receita_bruta), num(r?.pib));
  const doAno = (d: Linha[], ano: number) => d.find((r) => r.exercicio === ano);
  const comPib = s.filter((r) => r.pib !== null);
  const ultimoPib = comPib.at(-1);
  const a = doAno(s, f.ano) ?? ultimoPib;
  const pib = t('PIB', 'GDP');

  const serie = (fn: (r?: Linha) => number | null) => [
    { nome: f.rotulo, valores: anos.map((ano) => fn(doAno(s, ano))) },
    ...(f.rotuloComparador && c.length ? [{ nome: f.rotuloComparador, valores: anos.map((ano) => fn(doAno(c, ano))) }] : []),
  ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opcaoPib = useMemo(() => linhas(anos, serie(pibPc), reaisCurto), [alvo.dados, comp.dados]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opcaoCarga = useMemo(() => linhas(anos, serie(receitaPib), (v) => pct(v, 0)), [alvo.dados, comp.dados]);
  const setores: [string, string][] = [
    [t('Agropecuária', 'Agriculture'), 'vab_agropecuaria'], [t('Indústria', 'Industry'), 'vab_industria'],
    [t('Serviços', 'Services'), 'vab_servicos'], [t('Administração pública', 'Public administration'), 'vab_adm_publica'],
  ];
  const comVab = s.filter((r) => r.vab_servicos !== null).at(-1);
  const opcaoVab = useMemo(
    () => barras(setores.map(([n]) => n), setores.map(([, k]) => num(comVab?.[k])), reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados],
  );

  return (
    <>
      <h2 className="titulo-pagina">{t('Contexto socioeconômico', 'Socioeconomic context')}</h2>
      <p className="subtitulo">{f.rotulo} · {t('PIB municipal (IBGE) e painel da pesquisa LAPAM', 'Municipal GDP (IBGE) and the LAPAM research panel')}</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo={`${pib} ${ultimoPib?.exercicio ?? ''}`} valor={reais(num(ultimoPib?.pib))} />
        <Kpi rotulo={t('PIB per capita', 'GDP per capita')} valor={reaisExato(pibPc(ultimoPib))} />
        <Kpi rotulo={t('Receita bruta ÷ PIB', 'Gross revenue ÷ GDP')} valor={pct(receitaPib(ultimoPib))} nota={`${ultimoPib?.exercicio ?? ''}`} />
        <Kpi rotulo={t('Impostos e taxas próprios ÷ PIB', 'Own taxes and fees ÷ GDP')}
          valor={pct(div(num(ultimoPib?.receita_impostos_taxas), num(ultimoPib?.pib)), 2)} />
      </div>
      <p className="aviso">
        {t(
          'O PIB municipal do IBGE vai até 2023, e o detalhamento por setor até 2021. Para estados, só há dados fiscais.',
          'IBGE municipal GDP runs through 2023, and the sector breakdown through 2021. For states, only fiscal data are available.',
        )}
      </p>
      <Estado carregando={alvo.carregando} erro={alvo.erro} />
      {comPib.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('PIB per capita', 'GDP per capita')} desc={t('R$ correntes', 'Current R$')}
            tabela={<TabelaSerie colunas={[t('Ano', 'Year'), t('PIB per capita', 'GDP per capita')]} linhas={s.map((r) => [r.exercicio as number, reaisExato(pibPc(r))])} />}>
            <Grafico opcao={opcaoPib} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Receita bruta em relação ao PIB', 'Gross revenue relative to GDP')}
            desc={t('Peso do orçamento municipal na economia local', 'Weight of the municipal budget in the local economy')}
            tabela={<TabelaSerie colunas={[t('Ano', 'Year'), t('Receita ÷ PIB', 'Revenue ÷ GDP')]} linhas={s.map((r) => [r.exercicio as number, pct(receitaPib(r))])} />}>
            <Grafico opcao={opcaoCarga} />
          </CartaoGrafico>
        </div>
      )}
      {comVab && (
        <CartaoGrafico titulo={`${t('Valor adicionado por setor', 'Value added by sector')} · ${comVab.exercicio}`} desc={t('IBGE, R$ correntes', 'IBGE, current R$')}>
          <Grafico opcao={opcaoVab} altura={200} />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <h3>{t('Transferências às famílias', 'Transfers to households')}</h3>
        <p className="desc">
          {t(
            'Painel da pesquisa LAPAM (2013–2021): Bolsa Família e benefícios do INSS.',
            'LAPAM research panel (2013–2021): Bolsa Família and INSS (social security) benefits.',
          )}
        </p>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('Ano', 'Year')}</th><th>{t('Famílias no Bolsa Família', 'Families in Bolsa Família')}</th>
                <th>{t('Valor do Bolsa Família', 'Bolsa Família amount')}</th><th>{t('Benefícios INSS', 'INSS benefits')}</th>
              </tr>
            </thead>
            <tbody>
              {s.filter((r) => r.bolsa_familia_valor !== null).map((r) => (
                <tr key={String(r.exercicio)}>
                  <td>{r.exercicio}</td><td>{numero(num(r.bolsa_familia_familias))}</td>
                  <td>{reais(num(r.bolsa_familia_valor))}</td><td>{numero(num(r.inss_beneficios))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {a && a.bolsa_familia_valor === null && (
          <p className="vazio">{t('Sem dados do painel para os exercícios disponíveis.', 'No panel data for the available fiscal years.')}</p>
        )}
      </section>
    </>
  );
}
