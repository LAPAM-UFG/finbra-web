import { useMemo, useState } from 'react';
import { useApi, type Arvore, type Linha } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { div, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useColuna, useSerie } from '../hooks';
import { dado, t } from '../idioma';
import { TabelaSerie } from './Receitas';

export function DespesasVisaoGeral() {
  const f = useFiltros();
  const { coluna, setColuna, opcoes } = useColuna('I-E', f.ano, 'Despesas Empenhadas');
  const arvore = useApi<Arvore>(coluna ? 'arvore' : null, { anexo: 'I-E', ano: f.ano, coluna, ...f.escopo });
  const kpi = useApi<Linha[]>('agregado', {
    por: 'exercicio', campos: 'despesa_empenhada,despesa_liquidada,despesa_paga,despesa_saude,despesa_educacao', ano: f.ano, ...f.escopo,
  });
  const k = kpi.dados?.[0];
  const funcoes = useMemo(
    () => (arvore.dados?.nos ?? []).filter((n) => n.tipo === 'conta' && n.nivel === 1 && n.valor)
      .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)).slice(0, 12),
    [arvore.dados],
  );
  const opcao = useMemo(() => barras(funcoes.map((n) => dado(n.descricao)), funcoes.map((n) => n.valor), reaisCurto), [funcoes]);
  const empenhada = num(k?.despesa_empenhada);

  return (
    <>
      <h2 className="titulo-pagina">{t('Visão geral das despesas', 'Expenditure overview')}</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · {t('DCA Anexo I-E (despesas por função)', 'DCA Annex I-E (expenditure by function)')}</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo={t('Despesa empenhada', 'Committed expenditure')} valor={reais(empenhada)}
          nota={t('Inclui intra-orçamentárias', 'Includes intra-budgetary')} />
        <Kpi rotulo={t('Liquidada', 'Accrued')} valor={reais(num(k?.despesa_liquidada))} />
        <Kpi rotulo={t('Paga', 'Paid')} valor={reais(num(k?.despesa_paga))} />
        <Kpi rotulo={t('Empenhada per capita', 'Committed per capita')} valor={reaisExato(div(empenhada, num(k?.populacao)))} />
        <Kpi rotulo={t('Saúde', 'Health')} valor={pct(div(num(k?.despesa_saude), empenhada))} nota={reais(num(k?.despesa_saude))} />
        <Kpi rotulo={t('Educação', 'Education')} valor={pct(div(num(k?.despesa_educacao), empenhada))} nota={reais(num(k?.despesa_educacao))} />
      </div>
      {funcoes.length > 0 && (
        <CartaoGrafico titulo={t('Maiores funções', 'Largest functions')}
          desc={`${dado(coluna ?? '')} · ${t('exceto intra-orçamentárias', 'excluding intra-budgetary')}`}>
          <Grafico opcao={opcao} altura={Math.max(220, funcoes.length * 30)} />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t('Despesas por função e subfunção', 'Expenditure by function and subfunction')}</h3>
            <p className="desc">
              {t(
                'As funções somam a despesa exceto intra-orçamentária; o total intra aparece nas linhas de total.',
                'Functions add up to expenditure excluding intra-budgetary; the intra-budgetary total appears in the total lines.',
              )}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="col-ie">{t('Coluna', 'Column')}</label>
            <select id="col-ie" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)}>
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

const TOTAL = 'TotalExcetoIntra';
const ESTAGIOS = ['Despesas Empenhadas', 'Despesas Liquidadas', 'Despesas Pagas'];

export function DespesasEvolucao() {
  const f = useFiltros();
  const { meta } = useDados();
  const [chave, setChave] = useState(TOTAL);
  const [coluna, setColuna] = useState(ESTAGIOS[0]);
  const contas = useApi<{ chave: string; nivel: number; descricao: string; tipo: string }[]>('contas', {
    anexo: 'I-E', ano: meta.anos.at(-1), nivel_max: 2,
  });
  const opcoes = useMemo(
    () => [{ chave: TOTAL, descricao: t('Total (exceto intra-orçamentárias)', 'Total (excluding intra-budgetary)') }, ...(contas.dados ?? [])
      .filter((c) => c.tipo === 'conta')
      .map((c) => ({ chave: c.chave, descricao: `${c.nivel > 1 ? '   ' : ''}${dado(c.descricao)}` }))],
    [contas.dados],
  );
  const { alvo, comp } = useSerie({ anexo: 'I-E', coluna, chave });
  const s = alvo.dados ?? [];
  const anos = s.map((p) => p.ano);
  const ponto = s.find((p) => p.ano === f.ano);
  const perCapita = (d = s) => d.map((p) => div(p.valor_real, p.populacao));

  const opcaoValores = useMemo(
    () => linhas(anos, [
      { nome: 'Nominal', valores: s.map((p) => p.valor) },
      { nome: t(`Real (R$ de ${meta.baseIpca})`, `Real (${meta.baseIpca} R$)`), valores: s.map((p) => p.valor_real) },
    ], reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados],
  );
  const opcaoPerCapita = useMemo(
    () => linhas(anos, [
      { nome: f.rotulo, valores: perCapita() },
      ...(comp.dados && f.rotuloComparador ? [{ nome: f.rotuloComparador, valores: perCapita(comp.dados) }] : []),
    ], reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados, comp.dados],
  );

  return (
    <>
      <h2 className="titulo-pagina">{t('Evolução das despesas', 'Expenditure trends')}</h2>
      <p className="subtitulo">{f.rotulo} · {opcoes.find((o) => o.chave === chave)?.descricao.trim()}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="funcao">{t('Função / subfunção', 'Function / subfunction')}</label>
          <select id="funcao" value={chave} onChange={(e) => setChave(e.target.value)} style={{ maxWidth: 420 }}>
            {opcoes.map((o) => <option key={o.chave} value={o.chave}>{o.descricao}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="estagio">{t('Estágio', 'Stage')}</label>
          <select id="estagio" value={coluna} onChange={(e) => setColuna(e.target.value)}>
            {ESTAGIOS.map((c) => <option key={c} value={c}>{dado(c)}</option>)}
          </select>
        </div>
      </div>
      <div className="kpis">
        <Kpi rotulo={t(`Valor em ${f.ano}`, `Value in ${f.ano}`)} valor={reais(ponto?.valor)} />
        <Kpi rotulo={t(`Real (R$ de ${meta.baseIpca})`, `Real (${meta.baseIpca} R$)`)} valor={reais(ponto?.valor_real)} />
        <Kpi rotulo={t('Per capita (real)', 'Per capita (real)')} valor={reaisExato(div(ponto?.valor_real, ponto?.populacao))} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} />
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Valor por exercício', 'Value by fiscal year')} desc={t('Nominal e corrigido pelo IPCA', 'Nominal and adjusted by the IPCA')}
            tabela={<TabelaSerie colunas={[t('Ano', 'Year'), 'Nominal', 'Real']} linhas={s.map((p) => [p.ano, reais(p.valor), reais(p.valor_real)])} />}>
            <Grafico opcao={opcaoValores} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Per capita (real)', 'Per capita (real)')}
            desc={f.rotuloComparador ? t(`Comparado com ${f.rotuloComparador}`, `Compared with ${f.rotuloComparador}`) : undefined}
            tabela={<TabelaSerie colunas={[t('Ano', 'Year'), 'Per capita']} linhas={s.map((p, i) => [p.ano, reaisExato(perCapita()[i])])} />}>
            <Grafico opcao={opcaoPerCapita} />
          </CartaoGrafico>
        </div>
      )}
    </>
  );
}
