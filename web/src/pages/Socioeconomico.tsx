import { useMemo, useState } from 'react';
import type { Linha } from '../api';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, useDados } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, razao, useIndicadores } from '../hooks';
import { t } from '../idioma';

const CAMPOS = [
  'pib', 'receita_bruta', 'receita_impostos_taxas', 'vab_agropecuaria', 'vab_industria', 'vab_servicos',
  'vab_adm_publica', 'bolsa_familia_valor', 'bolsa_familia_familias', 'inss_beneficios', 'inss_aposentadorias',
];

/**
 * Programa pago em cada ano (o mesmo critério do pipeline): Bolsa Família até out/2021, Auxílio Brasil de
 * nov/2021 a fev/2023 (em nov/2021 os dois), Novo Bolsa Família desde mar/2023.
 */
const programaDoAno = (ano: number) =>
  ano <= 2020 ? 'Bolsa Família'
    : ano === 2021 ? t('Bolsa Família (jan–nov) + Auxílio Brasil (nov–dez)', 'Bolsa Família (Jan–Nov) + Auxílio Brasil (Nov–Dec)')
      : ano === 2022 ? 'Auxílio Brasil'
        : ano === 2023 ? t('Auxílio Brasil (jan–fev) + Novo Bolsa Família', 'Auxílio Brasil (Jan–Feb) + New Bolsa Família')
          : t('Novo Bolsa Família', 'New Bolsa Família');

export function Socioeconomico() {
  const { meta } = useDados();
  const anosInss = (meta.fontes.inss as { exercicios?: number[] } | undefined)?.exercicios ?? [];
  const { alvo, comp, f } = useIndicadores(CAMPOS, { pares: ['receita_bruta/pib', 'receita_impostos_taxas/pib'] });
  const [modo, setModo] = useState<'selecionado' | 'ultimo'>('selecionado');
  const s = alvo.dados ?? [];
  const c = comp.dados ?? [];
  const doAno = (d: Linha[], ano: number) => d.find((r) => r.exercicio === ano);
  const anosPib = s.filter((r) => r.pib !== null).map((r) => r.exercicio as number);
  const anosSetor = s.filter((r) => r.vab_servicos !== null).map((r) => r.exercicio as number);
  const anosFamilias = s.filter((r) => r.bolsa_familia_valor !== null || r.inss_beneficios !== null).map((r) => r.exercicio as number);
  const ultimoPib = anosPib.at(-1);
  const anoPib = modo === 'ultimo' && ultimoPib ? ultimoPib : f.ano;
  const a = doAno(s, anoPib);
  const temPib = !!a && a.pib !== null;
  const anoSetor = anosSetor.includes(anoPib) ? anoPib : anosSetor.at(-1);
  const comVab = anoSetor ? doAno(s, anoSetor) : undefined;

  const pibPc = (r?: Linha) => div(num(r?.pib), num(r?.populacao_pib));
  const receitaPib = (r?: Linha) => razao(r, 'receita_bruta', 'pib');
  const impostosPib = (r?: Linha) => razao(r, 'receita_impostos_taxas', 'pib');
  const anos = s.map((r) => r.exercicio as number);
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
  const opcaoVab = useMemo(
    () => barras(setores.map(([n]) => n), setores.map(([, k]) => num(comVab?.[k])), reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados, anoSetor],
  );
  const indisponivel = t(`indisponível em ${anoPib}`, `unavailable in ${anoPib}`);

  return (
    <>
      <h2 className="titulo-pagina">{t('Contexto socioeconômico', 'Socioeconomic context')}</h2>
      <p className="subtitulo">{f.rotulo} · {t('PIB municipal (IBGE), Bolsa Família (Portal da Transparência) e INSS (Ministério da Previdência)', 'Municipal GDP (IBGE), Bolsa Família (Transparency Portal) and INSS (Ministry of Social Security)')}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="modo-ano">{t('Ano dos indicadores', 'Year of the indicators')}</label>
          <select id="modo-ano" value={modo} onChange={(e) => setModo(e.target.value as 'selecionado' | 'ultimo')}>
            <option value="selecionado">{t(`Exercício selecionado (${f.ano})`, `Selected fiscal year (${f.ano})`)}</option>
            <option value="ultimo" disabled={!ultimoPib}>{t(`Último ano com PIB (${ultimoPib ?? '–'})`, `Latest year with GDP (${ultimoPib ?? '–'})`)}</option>
          </select>
        </div>
      </div>
      <p className="aviso">
        {t(
          `Disponibilidade: PIB municipal do IBGE ${anosPib[0] ?? '–'}–${ultimoPib ?? '–'}; detalhamento por setor até ${anosSetor.at(-1) ?? '–'}; Bolsa Família ${anosFamilias[0] ?? '–'}–${anosFamilias.at(-1) ?? '–'}; INSS ${anosInss.join(', ') || '–'}. Para os estados, só há dados fiscais; o DF recebe os pagamentos registrados em Brasília. Cada razão usa receita e PIB do mesmo ano.`,
          `Availability: IBGE municipal GDP ${anosPib[0] ?? '–'}–${ultimoPib ?? '–'}; sector breakdown through ${anosSetor.at(-1) ?? '–'}; Bolsa Família ${anosFamilias[0] ?? '–'}–${anosFamilias.at(-1) ?? '–'}; INSS ${anosInss.join(', ') || '–'}. For states, only fiscal data are available; the DF receives the payments recorded in Brasília. Each ratio uses revenue and GDP from the same year.`,
        )}
      </p>
      {!temPib && !alvo.carregando && (
        <p className="aviso" role="status">
          {t(`Não há PIB municipal para ${anoPib} neste recorte.`, `There is no municipal GDP for ${anoPib} in this scope.`)}{' '}
          {ultimoPib && modo === 'selecionado' && (
            <button className="limpar" onClick={() => setModo('ultimo')}>{t(`Usar o último ano disponível (${ultimoPib})`, `Use the latest available year (${ultimoPib})`)}</button>
          )}
        </p>
      )}
      <h3 className="secao">{t(`Indicadores de ${anoPib}`, `Indicators for ${anoPib}`)}</h3>
      <div className="kpis">
        <Kpi rotulo={`${t('PIB', 'GDP')} ${anoPib}`} valor={temPib ? reais(num(a?.pib)) : indisponivel} nota={t('R$ correntes', 'current R$')} />
        <Kpi rotulo={`${t('PIB per capita', 'GDP per capita')} ${anoPib}`} valor={temPib ? reaisExato(pibPc(a)) : indisponivel} />
        <Kpi rotulo={`${t('Receita bruta ÷ PIB', 'Gross revenue ÷ GDP')} ${anoPib}`} valor={temPib ? pct(receitaPib(a)) : indisponivel}
          nota={f.alvo || !temPib ? undefined : `${numero(num(a?.receita_bruta__pib_entes))} ${t('municípios com os dois valores', 'municipalities with both values')}`} />
        <Kpi rotulo={`${t('Impostos, taxas e contrib. de melhoria ÷ PIB', 'Taxes, fees and betterment levies ÷ GDP')} ${anoPib}`}
          valor={temPib ? pct(impostosPib(a), 2) : indisponivel}
          nota={t('arrecadação própria: conta 1.1 da receita corrente', 'own revenue: current revenue account 1.1')} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} tentarNovamente={alvo.recarregar} />
      {anosPib.length > 0 && (
        <>
          <h3 className="secao">{t(`Série completa: ${anos[0]}–${anos.at(-1)}`, `Full series: ${anos[0]}–${anos.at(-1)}`)}</h3>
          <div className="grade-2">
            <CartaoGrafico titulo={t('PIB per capita', 'GDP per capita')} desc={t('R$ correntes; anos sem PIB ficam em branco', 'current R$; years without GDP are left blank')}
              tabela={<TabelaSerie nome="pib_per_capita" anos={anos} colunas={[
                { titulo: t('PIB per capita (R$ correntes)', 'GDP per capita (current R$)'), valores: anos.map((ano) => pibPc(doAno(s, ano))), formato: reaisExato },
                ...(f.rotuloComparador ? [{ titulo: f.rotuloComparador, valores: anos.map((ano) => pibPc(doAno(c, ano))), formato: reaisExato }] : []),
              ]} />}>
              <Grafico opcao={opcaoPib} nome="pib_per_capita" />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Receita bruta em relação ao PIB', 'Gross revenue relative to GDP')}
              desc={t('Peso do orçamento na economia local; receita e PIB do mesmo ano', 'Weight of the budget in the local economy; revenue and GDP from the same year')}
              tabela={<TabelaSerie nome="receita_pib" anos={anos} colunas={[
                { titulo: t('Receita ÷ PIB', 'Revenue ÷ GDP'), valores: anos.map((ano) => receitaPib(doAno(s, ano))), formato: (v) => pct(v) },
              ]} />}>
              <Grafico opcao={opcaoCarga} nome="receita_pib" />
            </CartaoGrafico>
          </div>
        </>
      )}
      {comVab && (
        <CartaoGrafico titulo={`${t('Valor adicionado por setor', 'Value added by sector')} · ${anoSetor}`}
          desc={anoSetor !== anoPib
            ? t(`IBGE, R$ correntes. Detalhamento setorial disponível até ${anoSetor}; não há dado setorial para ${anoPib}.`,
              `IBGE, current R$. Sector breakdown available through ${anoSetor}; there is no sector data for ${anoPib}.`)
            : t('IBGE, R$ correntes', 'IBGE, current R$')}
          tabela={<TabelaSerie nome={`vab_${anoSetor}`} anos={setores.map(([n]) => n)}
            colunas={[{ titulo: t('Valor adicionado (R$ correntes)', 'Value added (current R$)'), valores: setores.map(([, k]) => num(comVab?.[k])), formato: reais }]} />}>
          <Grafico opcao={opcaoVab} altura={200} nome={`vab_${anoSetor}`} />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <h3>{t('Transferências às famílias', 'Transfers to households')}</h3>
        <p className="desc">
          {t(
            `Famílias = beneficiárias pagas em dezembro; valor = total pago no ano (R$ correntes), ambos somados dos pagamentos publicados no Portal da Transparência (CGU). INSS = benefícios previdenciários emitidos em dezembro (aposentadorias, pensões, auxílios e outros; sem os assistenciais, como o BPC), das planilhas do Ministério da Previdência, publicadas para ${anosInss.join(', ') || '–'}; os demais anos ficam em branco.`,
            `Families = beneficiaries paid in December; amount = total paid in the year (current R$), both added up from payments published on the Transparency Portal (CGU). INSS = social security benefits issued in December (retirement, survivor pensions, sickness and other benefits; excluding assistance benefits such as the BPC), from Ministry of Social Security spreadsheets, published for ${anosInss.join(', ') || '–'}; other years are left blank.`,
          )}
        </p>
        <p className="nota-base">
          {t(
            'Quebra de série: de novembro de 2021 a fevereiro de 2023 o programa foi o Auxílio Brasil; desde março de 2023, o Novo Bolsa Família, com valores e regras diferentes. Em 2020 e 2021, parte das famílias recebeu o Auxílio Emergencial no lugar do Bolsa Família, o que reduz o valor pago pelo programa. De 2021 a 2023 o valor anual fica indisponível: os arquivos de pagamento do Auxílio Brasil trazem só o benefício regular, sem o Benefício Extraordinário que completava o mínimo de R$ 400 (R$ 600 a partir de agosto de 2022); o número de famílias está completo. Anos sem os 12 meses publicados também ficam sem valor anual.',
            'Series break: from November 2021 to February 2023 the program was Auxílio Brasil; since March 2023, the New Bolsa Família, with different amounts and rules. In 2020 and 2021, part of the families received Emergency Aid instead of Bolsa Família, which lowers the amount paid by the program. From 2021 to 2023 the annual amount is unavailable: Auxílio Brasil payment files only include the regular benefit, without the Extraordinary Benefit that topped it up to the R$ 400 minimum (R$ 600 from August 2022); the number of families is complete. Years without all 12 months published also have no annual amount.',
          )}
        </p>
        {anosFamilias.length ? (
          <TabelaSerie nome="transferencias_familias" anos={anosFamilias} colunas={[
            { titulo: t('Programa', 'Program'), valores: anosFamilias.map(programaDoAno) },
            { titulo: t('Famílias pagas em dezembro', 'Families paid in December'), valores: anosFamilias.map((ano) => num(doAno(s, ano)?.bolsa_familia_familias)), formato: numero },
            { titulo: t('Valor pago no ano (R$ correntes)', 'Amount paid in the year (current R$)'), valores: anosFamilias.map((ano) => num(doAno(s, ano)?.bolsa_familia_valor)), formato: reais },
            { titulo: t('Benefícios previdenciários do INSS (dezembro)', 'INSS social security benefits (December)'), valores: anosFamilias.map((ano) => num(doAno(s, ano)?.inss_beneficios)), formato: numero },
            { titulo: t('Aposentadorias (dezembro)', 'Retirement pensions (December)'), valores: anosFamilias.map((ano) => num(doAno(s, ano)?.inss_aposentadorias)), formato: numero },
          ]} metadados={[[t('Fontes', 'Sources'), t('Portal da Transparência/CGU (pagamentos do Bolsa Família, Auxílio Brasil e Novo Bolsa Família); Ministério da Previdência (benefícios emitidos pelo INSS por município, dezembro)', 'Transparency Portal/CGU (Bolsa Família, Auxílio Brasil and New Bolsa Família payments); Ministry of Social Security (INSS benefits issued by municipality, December)')]]} />
        ) : (
          <p className="vazio">{t('Sem dados de transferências às famílias para este recorte.', 'No household transfer data for this scope.')}</p>
        )}
      </section>
    </>
  );
}
