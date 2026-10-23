import { useMemo, useState } from 'react';
import { useApi, type Arvore, type Linha } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useColuna, useSerie } from '../hooks';
import { dado, t } from '../idioma';

export function ReceitasVisaoGeral() {
  const f = useFiltros();
  const { coluna, setColuna, opcoes } = useColuna('I-C', f.ano);
  const arvore = useApi<Arvore>(coluna ? 'arvore' : null, { anexo: 'I-C', ano: f.ano, coluna, ...f.escopo });
  const kpi = useApi<Linha[]>('agregado', {
    por: 'exercicio', campos: 'receita_bruta,deducoes,receita_liquida,receita_corrente', ano: f.ano, ...f.escopo,
  });
  const k = kpi.dados?.[0];
  const pop = num(k?.populacao);

  return (
    <>
      <h2 className="titulo-pagina">{t('Visão geral das receitas', 'Revenue overview')}</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · {t('DCA Anexo I-C (receitas orçamentárias)', 'DCA Annex I-C (budget revenue)')}</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo={t('Receita bruta', 'Gross revenue')} valor={reais(num(k?.receita_bruta))} />
        <Kpi rotulo={t('Deduções', 'Deductions')} valor={reais(num(k?.deducoes))}
          nota={t('FUNDEB, transferências constitucionais e outras', 'FUNDEB, constitutional transfers and others')} />
        <Kpi rotulo={t('Receita líquida', 'Net revenue')} valor={reais(num(k?.receita_liquida))} />
        <Kpi rotulo={t('Receita bruta per capita', 'Gross revenue per capita')} valor={reaisExato(div(num(k?.receita_bruta), pop))} />
        <Kpi rotulo={t('População', 'Population')} valor={numero(pop)}
          nota={f.ente ? undefined : `${numero(num(k?.entes))} ${t('entes', 'governments')}`} />
      </div>
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t('Receitas por conta', 'Revenue by account')}</h3>
            <p className="desc">
              {t(
                'Valor informado pelo ente em cada nível da classificação. % AV = participação no total da coluna.',
                'Value reported by the government at each level of the classification. % VA = share of the column total.',
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
        <Estado carregando={arvore.carregando} erro={arvore.erro} />
        {arvore.dados && <ArvoreTabela key={`${f.ano}-${coluna}`} arvore={arvore.dados} />}
      </section>
    </>
  );
}

const TOTAL = 'TotalReceitas';

export function ReceitasEvolucao() {
  const f = useFiltros();
  const { meta } = useDados();
  const [chave, setChave] = useState(TOTAL);
  const contas = useApi<{ chave: string; nivel: number; descricao: string; tipo: string }[]>('contas', {
    anexo: 'I-C', ano: meta.anos.at(-1), nivel_max: 3,
  });
  const opcoes = useMemo(
    () => [{ chave: TOTAL, descricao: t('Receita total', 'Total revenue') }, ...(contas.dados ?? [])
      .filter((c) => c.tipo === 'conta' && c.chave.startsWith('RO'))
      .map((c) => ({ chave: c.chave, descricao: `${'  '.repeat(c.nivel - 1)}${dado(c.descricao)}`, nivel: c.nivel }))],
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
      { nome: t(`Real (IPCA, R$ de ${meta.baseIpca})`, `Real (IPCA, ${meta.baseIpca} R$)`), valores: s.map((p) => p.valor_real) },
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
          'Os códigos de receita mudaram em 2018 e em 2022. Os dois primeiros níveis (receitas correntes, de capital, impostos, transferências…) são comparáveis em toda a série; abaixo disso, a série pode ter quebras.',
          'Revenue codes changed in 2018 and 2022. The first two levels (current and capital revenue, taxes, transfers…) are comparable across the whole series; below that, the series may have breaks.',
        )}
      </p>
      <div className="kpis">
        <Kpi rotulo={t(`Valor em ${f.ano}`, `Value in ${f.ano}`)} valor={reais(ponto?.valor)} />
        <Kpi rotulo={t(`Valor real (R$ de ${meta.baseIpca})`, `Real value (${meta.baseIpca} R$)`)} valor={reais(ponto?.valor_real)} />
        <Kpi rotulo={t('Per capita (real)', 'Per capita (real)')} valor={reaisExato(div(ponto?.valor_real, ponto?.populacao))} />
        <Kpi rotulo={t(`Variação real desde ${primeiro?.ano ?? '–'}`, `Real change since ${primeiro?.ano ?? '–'}`)}
          valor={crescimento === null ? '–' : pct(crescimento - 1)} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} />
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Valor por exercício', 'Value by fiscal year')} desc={t('Nominal e corrigido pelo IPCA', 'Nominal and adjusted by the IPCA')}
            tabela={<TabelaSerie linhas={s.map((p) => [p.ano, reais(p.valor), reais(p.valor_real)])} colunas={[t('Ano', 'Year'), 'Nominal', 'Real']} />}>
            <Grafico opcao={opcaoValores} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Per capita (real)', 'Per capita (real)')}
            desc={f.rotuloComparador ? t(`Comparado com ${f.rotuloComparador}`, `Compared with ${f.rotuloComparador}`) : undefined}
            tabela={<TabelaSerie linhas={s.map((p, i) => [p.ano, reaisExato(perCapita()[i]), reaisExato(comp.dados ? perCapita(comp.dados)[i] : null)])}
              colunas={[t('Ano', 'Year'), f.rotulo, f.rotuloComparador ?? '']} />}>
            <Grafico opcao={opcaoPerCapita} />
          </CartaoGrafico>
        </div>
      )}
    </>
  );
}

export function TabelaSerie({ colunas, linhas }: { colunas: string[]; linhas: (string | number)[][] }) {
  return (
    <table>
      <thead><tr>{colunas.filter(Boolean).map((c) => <th key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={String(l[0])}>{l.slice(0, colunas.filter(Boolean).length).map((v, i) => <td key={i}>{v}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
