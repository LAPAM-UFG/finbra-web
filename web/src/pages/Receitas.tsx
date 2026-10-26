import { useMemo, useState } from 'react';
import { useApi, type Arvore, type Linha } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { Dica } from '../components/Dica';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, Cobertura, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useColuna, useSerie } from '../hooks';
import { dado, t } from '../idioma';
import { codigoConta } from '../calculos';

export const textoReferencia = () =>
  t(
    'Referência de UF ou Brasil: soma dos valores ÷ soma da população dos municípios com dados no exercício (quociente agregado, não média dos per capita municipais). O município selecionado faz parte da referência da sua UF.',
    'State or national reference: sum of values ÷ sum of the population of municipalities with data in the year (aggregate ratio, not the average of municipal per capita values). The selected municipality is part of its state’s reference.',
  );

export function ReceitasVisaoGeral() {
  const f = useFiltros();
  const { coluna, setColuna, opcoes } = useColuna('I-C', f.ano);
  const arvore = useApi<Arvore>(coluna ? 'arvore' : null, { anexo: 'I-C', ano: f.ano, coluna, ...f.escopo });
  const kpi = useApi<Linha[]>('agregado', {
    por: 'exercicio', campos: 'receita_bruta,deducoes,receita_liquida,receita_corrente', ano: f.ano, ...f.escopo,
  });
  const k = kpi.dados?.[0];
  const pop = num(k?.populacao_receita_bruta);

  return (
    <>
      <h2 className="titulo-pagina">{t('Visão geral das receitas', 'Revenue overview')}</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · {t('DCA Anexo I-C (receitas orçamentárias)', 'DCA Annex I-C (budget revenue)')}</p>
      <BarraFiltros />
      <Cobertura dominio="receita" />
      <Estado carregando={kpi.carregando} erro={kpi.erro} tentarNovamente={kpi.recarregar} />
      <div className="kpis">
        <Kpi rotulo={t('Receita bruta', 'Gross revenue')} valor={reais(num(k?.receita_bruta))}
          nota={t('inclui intraorçamentárias', 'includes intra-budgetary')} />
        <Kpi rotulo={t('Deduções', 'Deductions')} valor={reais(num(k?.deducoes))}
          nota={t('FUNDEB, transferências constitucionais e outras', 'FUNDEB, constitutional transfers and others')} />
        <Kpi rotulo={t('Receita líquida', 'Net revenue')} valor={reais(num(k?.receita_liquida))}
          dica={<Dica rotulo={t('Fórmula da receita líquida', 'Net revenue formula')}>
            {t(
              'Receita líquida = receita bruta realizada − deduções declaradas nas colunas de dedução do Anexo I-C (FUNDEB, transferências constitucionais e outras). As deduções entram pelo valor absoluto: alguns entes as declaram com sinal negativo. Não é a Receita Corrente Líquida (RCL) da LRF, que considera só receitas correntes, outras deduções e 12 meses.',
              'Net revenue = gross revenue collected − deductions reported in the deduction columns of Annex I-C (FUNDEB, constitutional transfers and others). Deductions are taken as absolute values: some governments report them with a negative sign. It is not the Fiscal Responsibility Law’s Net Current Revenue (RCL), which uses only current revenue, other deductions and 12 months.',
            )}
          </Dica>} />
        <Kpi rotulo={t('Receita bruta per capita', 'Gross revenue per capita')} valor={reaisExato(div(num(k?.receita_bruta), pop))}
          dica={f.alvo ? undefined : <Dica rotulo={t('Como é calculado', 'How it is calculated')}>{textoReferencia()}</Dica>} />
        <Kpi rotulo={t('População', 'Population')} valor={numero(pop)}
          nota={f.alvo ? t('declarada na DCA', 'reported in the DCA') : `${numero(num(k?.entes_receita_bruta))} ${t('entes com receita · declarada na DCA', 'governments with revenue · reported in the DCA')}`} />
      </div>
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t('Receitas por conta', 'Revenue by account')}</h3>
            <p className="desc">
              {t(
                'Valor informado pelo ente em cada nível da classificação; cada nível já contém os de baixo.',
                'Value reported by the government at each level of the classification; each level already contains the ones below.',
              )}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="col-ic">{t('Coluna', 'Column')}</label>
            <select id="col-ic" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)}>
              {opcoes.map((c) => <option key={c} value={c}>{dado(c)}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={arvore.carregando} erro={arvore.erro} tentarNovamente={arvore.recarregar} />
        {arvore.dados && coluna && <ArvoreTabela key={`${f.ano}-${coluna}`} arvore={arvore.dados} anexo="I-C" coluna={coluna} />}
      </section>
    </>
  );
}

const TOTAL = 'TotalReceitas';

export function ReceitasEvolucao() {
  const f = useFiltros();
  const { meta } = useDados();
  const [chave, setChave] = useState(TOTAL);
  const contas = useApi<{ chave: string; nivel: number; descricao: string; tipo: string; chave_pai: string | null }[]>('contas', {
    anexo: 'I-C', ano: meta.anos.at(-1), nivel_max: 3,
  });
  const opcoes = useMemo(
    () => [{ chave: TOTAL, descricao: t('Receita total (inclui intraorçamentárias)', 'Total revenue (includes intra-budgetary)') }, ...(contas.dados ?? [])
      .filter((c) => c.tipo === 'conta' && c.chave.startsWith('RO'))
      .map((c) => ({ chave: c.chave, descricao: `${'  '.repeat(c.nivel - 1)}${codigoConta(c.chave)} ${dado(c.descricao)}`, nivel: c.nivel }))],
    [contas.dados],
  );
  const { alvo, comp } = useSerie({ anexo: 'I-C', coluna: 'Receitas Brutas Realizadas', chave });
  const s = alvo.dados ?? [];
  const anos = s.map((p) => p.ano);
  const ponto = s.find((p) => p.ano === f.ano);
  const primeiro = s.find((p) => p.valor_real !== null);
  const crescimento = div(ponto?.valor_real, primeiro?.valor_real);

  const opcaoValores = useMemo(
    () => linhas(anos, [
      { nome: 'Nominal', valores: s.map((p) => p.valor) },
      { nome: t(`Real (IPCA, R$ de dez/${meta.baseIpca})`, `Real (IPCA, Dec/${meta.baseIpca} R$)`), valores: s.map((p) => p.valor_real) },
    ], reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados, meta.baseIpca],
  );
  const perCapita = (dados = s) => dados.map((p) => div(p.valor_real, p.populacao));
  const opcaoPerCapita = useMemo(
    () => linhas(anos, [
      { nome: f.rotulo, valores: perCapita() },
      ...(comp.dados && f.rotuloComparador ? [{ nome: f.rotuloComparador, valores: perCapita(comp.dados) }] : []),
    ], reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados, comp.dados],
  );
  const nomeConta = opcoes.find((o) => o.chave === chave)?.descricao.trim() ?? '';
  const periodo = anos.length ? `${anos[0]}–${anos.at(-1)}` : '';

  return (
    <>
      <h2 className="titulo-pagina">{t('Evolução das receitas', 'Revenue trends')}</h2>
      <p className="subtitulo">{f.rotulo} · {nomeConta}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="conta">{t('Conta', 'Account')}</label>
          <select id="conta" value={chave} onChange={(e) => setChave(e.target.value)} style={{ maxWidth: 520 }}>
            {opcoes.map((o) => <option key={o.chave} value={o.chave}>{o.descricao}</option>)}
          </select>
        </div>
      </div>
      <p className="aviso">
        {t(
          'Os códigos de receita mudaram em 2018 e em 2022. Os dois primeiros níveis (receitas correntes, de capital, impostos, transferências…) são comparáveis em toda a série; abaixo disso, a série pode ter quebras. A correspondência dos indicadores está em Qualidade e fontes.',
          'Revenue codes changed in 2018 and 2022. The first two levels (current and capital revenue, taxes, transfers…) are comparable across the whole series; below that, the series may have breaks. The indicator mapping is under Quality and sources.',
        )}
      </p>
      <h3 className="secao">{t(`Exercício de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
      <div className="kpis">
        <Kpi rotulo={t(`Valor nominal em ${f.ano}`, `Nominal value in ${f.ano}`)} valor={reais(ponto?.valor)} />
        <Kpi rotulo={t(`Valor real (R$ de dez/${meta.baseIpca})`, `Real value (Dec/${meta.baseIpca} R$)`)} valor={reais(ponto?.valor_real)} />
        <Kpi rotulo={t('Per capita (real)', 'Per capita (real)')} valor={reaisExato(div(ponto?.valor_real, ponto?.populacao))}
          nota={f.alvo || !ponto ? undefined : `${numero(ponto.entes)} ${t('entes no exercício', 'governments in the year')}`} />
        <Kpi rotulo={t(`Variação real ${primeiro?.ano ?? '–'}–${f.ano}`, `Real change ${primeiro?.ano ?? '–'}–${f.ano}`)}
          valor={crescimento === null ? '–' : pct(crescimento - 1)}
          nota={f.alvo ? undefined : t('a cobertura de entes pode variar entre os anos', 'government coverage may vary between years')} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} tentarNovamente={alvo.recarregar} />
      {s.length > 0 && (
        <>
          <h3 className="secao">{t(`Série completa: ${periodo}`, `Full series: ${periodo}`)}</h3>
          <div className="grade-2">
            <CartaoGrafico titulo={t('Valor por exercício', 'Value by fiscal year')} desc={t('Nominal e corrigido pelo IPCA', 'Nominal and adjusted by the IPCA')}
              tabela={<TabelaSerie nome={`receita_${chave}`} anos={anos} colunas={[
                { titulo: t('Nominal (R$ correntes)', 'Nominal (current R$)'), valores: s.map((p) => p.valor), formato: reais },
                { titulo: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((p) => p.valor_real), formato: reais },
                ...(f.alvo ? [] : [
                  { titulo: t('Entes com dados', 'Governments with data'), valores: s.map((p) => p.entes), formato: numero },
                  { titulo: t('Universo (cadastro)', 'Universe (registry)'), valores: s.map((p) => p.esperados), formato: numero },
                  { titulo: t('Excluídos pelo filtro', 'Excluded by filter'), valores: s.map((p) => p.excluidos), formato: numero },
                ]),
              ]} />}>
              <Grafico opcao={opcaoValores} nome={`receita_${chave}`} />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Per capita (real)', 'Per capita (real)')}
              desc={f.rotuloComparador ? t(`Comparado com ${f.rotuloComparador}`, `Compared with ${f.rotuloComparador}`) : undefined}
              acoes={f.rotuloComparador ? <Dica rotulo={t('Referência', 'Reference')}>{textoReferencia()}</Dica> : undefined}
              tabela={<TabelaSerie nome={`receita_per_capita_${chave}`} anos={anos} colunas={[
                { titulo: f.rotulo, valores: perCapita(), formato: reaisExato },
                { titulo: f.rotuloComparador ?? '', valores: comp.dados ? perCapita(comp.dados) : [], formato: reaisExato },
              ]} />}>
              <Grafico opcao={opcaoPerCapita} nome={`receita_per_capita_${chave}`} />
            </CartaoGrafico>
          </div>
          {!f.alvo && (
            <p className="legenda-tabela">
              {t(
                'A série soma os municípios com dados em cada ano: a cobertura varia (veja “Entes com dados” na tabela). Para comparar sempre o mesmo conjunto de municípios, use a opção de painel balanceado na página do FPM; para contas detalhadas, a série com os mesmos entes não está disponível.',
                'The series adds the municipalities with data in each year: coverage varies (see “Governments with data” in the table). To compare the same set of municipalities every year, use the balanced panel option on the FPM page; for detailed accounts, a same-government series is not available.',
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}
