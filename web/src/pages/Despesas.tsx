import { useMemo, useState } from 'react';
import { useApi, type Arvore, type Linha } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { div, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useColuna, useSerie } from '../hooks';
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
  const opcao = useMemo(() => barras(funcoes.map((n) => n.descricao), funcoes.map((n) => n.valor), reaisCurto), [funcoes]);
  const empenhada = num(k?.despesa_empenhada);

  return (
    <>
      <h2 className="titulo-pagina">Visão geral das despesas</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · DCA Anexo I-E (despesas por função)</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo="Despesa empenhada" valor={reais(empenhada)} nota="Inclui intra-orçamentárias" />
        <Kpi rotulo="Liquidada" valor={reais(num(k?.despesa_liquidada))} />
        <Kpi rotulo="Paga" valor={reais(num(k?.despesa_paga))} />
        <Kpi rotulo="Empenhada per capita" valor={reaisExato(div(empenhada, num(k?.populacao)))} />
        <Kpi rotulo="Saúde" valor={pct(div(num(k?.despesa_saude), empenhada))} nota={reais(num(k?.despesa_saude))} />
        <Kpi rotulo="Educação" valor={pct(div(num(k?.despesa_educacao), empenhada))} nota={reais(num(k?.despesa_educacao))} />
      </div>
      {funcoes.length > 0 && (
        <CartaoGrafico titulo="Maiores funções" desc={`${coluna} · exceto intra-orçamentárias`}>
          <Grafico opcao={opcao} altura={Math.max(220, funcoes.length * 30)} />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>Despesas por função e subfunção</h3>
            <p className="desc">As funções somam a despesa exceto intra-orçamentária; o total intra aparece nas linhas de total.</p>
          </div>
          <div className="campo">
            <label htmlFor="col-ie">Coluna</label>
            <select id="col-ie" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)}>
              {opcoes.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={arvore.carregando} erro={arvore.erro} />
        {arvore.dados && <ArvoreTabela key={`${f.ano}-${coluna}`} arvore={arvore.dados} />}
      </section>
    </>
  );
}

const TOTAL = { chave: 'TotalExcetoIntra', descricao: 'Total (exceto intra-orçamentárias)' };

export function DespesasEvolucao() {
  const f = useFiltros();
  const { meta } = useDados();
  const [chave, setChave] = useState(TOTAL.chave);
  const [coluna, setColuna] = useState('Despesas Empenhadas');
  const contas = useApi<{ chave: string; nivel: number; descricao: string; tipo: string }[]>('contas', {
    anexo: 'I-E', ano: meta.anos.at(-1), nivel_max: 2,
  });
  const opcoes = useMemo(
    () => [TOTAL, ...(contas.dados ?? []).filter((c) => c.tipo === 'conta')
      .map((c) => ({ chave: c.chave, descricao: `${c.nivel > 1 ? '   ' : ''}${c.descricao}` }))],
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
      { nome: `Real (R$ de ${meta.baseIpca})`, valores: s.map((p) => p.valor_real) },
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
      <h2 className="titulo-pagina">Evolução das despesas</h2>
      <p className="subtitulo">{f.rotulo} · {opcoes.find((o) => o.chave === chave)?.descricao.trim()}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="funcao">Função / subfunção</label>
          <select id="funcao" value={chave} onChange={(e) => setChave(e.target.value)} style={{ maxWidth: 420 }}>
            {opcoes.map((o) => <option key={o.chave} value={o.chave}>{o.descricao}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="estagio">Estágio</label>
          <select id="estagio" value={coluna} onChange={(e) => setColuna(e.target.value)}>
            {['Despesas Empenhadas', 'Despesas Liquidadas', 'Despesas Pagas'].map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="kpis">
        <Kpi rotulo={`Valor em ${f.ano}`} valor={reais(ponto?.valor)} />
        <Kpi rotulo={`Real (R$ de ${meta.baseIpca})`} valor={reais(ponto?.valor_real)} />
        <Kpi rotulo="Per capita (real)" valor={reaisExato(div(ponto?.valor_real, ponto?.populacao))} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} />
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo="Valor por exercício" desc="Nominal e corrigido pelo IPCA"
            tabela={<TabelaSerie colunas={['Ano', 'Nominal', 'Real']} linhas={s.map((p) => [p.ano, reais(p.valor), reais(p.valor_real)])} />}>
            <Grafico opcao={opcaoValores} />
          </CartaoGrafico>
          <CartaoGrafico titulo="Per capita (real)" desc={f.rotuloComparador ? `Comparado com ${f.rotuloComparador}` : undefined}
            tabela={<TabelaSerie colunas={['Ano', 'Per capita']} linhas={s.map((p, i) => [p.ano, reaisExato(perCapita()[i])])} />}>
            <Grafico opcao={opcaoPerCapita} />
          </CartaoGrafico>
        </div>
      )}
    </>
  );
}
