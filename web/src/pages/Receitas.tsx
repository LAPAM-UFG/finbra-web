import { useMemo, useState } from 'react';
import { useApi, type Arvore, type Linha } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useColuna, useSerie } from '../hooks';

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
      <h2 className="titulo-pagina">Visão geral das receitas</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · DCA Anexo I-C (receitas orçamentárias)</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo="Receita bruta" valor={reais(num(k?.receita_bruta))} />
        <Kpi rotulo="Deduções" valor={reais(num(k?.deducoes))} nota="FUNDEB, transferências constitucionais e outras" />
        <Kpi rotulo="Receita líquida" valor={reais(num(k?.receita_liquida))} />
        <Kpi rotulo="Receita bruta per capita" valor={reaisExato(div(num(k?.receita_bruta), pop))} />
        <Kpi rotulo="População" valor={numero(pop)} nota={f.ente ? undefined : `${numero(num(k?.entes))} entes`} />
      </div>
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>Receitas por conta</h3>
            <p className="desc">Valor informado pelo ente em cada nível da classificação. % AV = participação no total da coluna.</p>
          </div>
          <div className="campo">
            <label htmlFor="col-ic">Coluna</label>
            <select id="col-ic" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)}>
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

const TOTAL = { chave: 'TotalReceitas', descricao: 'Receita total' };

export function ReceitasEvolucao() {
  const f = useFiltros();
  const { meta } = useDados();
  const [chave, setChave] = useState(TOTAL.chave);
  const contas = useApi<{ chave: string; nivel: number; descricao: string; tipo: string }[]>('contas', {
    anexo: 'I-C', ano: meta.anos.at(-1), nivel_max: 3,
  });
  const opcoes = useMemo(
    () => [TOTAL, ...(contas.dados ?? []).filter((c) => c.tipo === 'conta' && c.chave.startsWith('RO'))
      .map((c) => ({ chave: c.chave, descricao: `${'  '.repeat(c.nivel - 1)}${c.descricao}`, nivel: c.nivel }))],
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
      { nome: `Real (IPCA, R$ de ${meta.baseIpca})`, valores: s.map((p) => p.valor_real) },
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
      <h2 className="titulo-pagina">Evolução das receitas</h2>
      <p className="subtitulo">{f.rotulo} · {nomeConta}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="conta">Conta</label>
          <select id="conta" value={chave} onChange={(e) => setChave(e.target.value)} style={{ maxWidth: 520 }}>
            {opcoes.map((o) => <option key={o.chave} value={o.chave}>{o.descricao}</option>)}
          </select>
        </div>
      </div>
      <p className="aviso">
        Os códigos de receita mudaram em 2018 e em 2022. Os dois primeiros níveis (receitas correntes, de capital,
        impostos, transferências…) são comparáveis em toda a série; abaixo disso, a série pode ter quebras.
      </p>
      <div className="kpis">
        <Kpi rotulo={`Valor em ${f.ano}`} valor={reais(ponto?.valor)} />
        <Kpi rotulo={`Valor real (R$ de ${meta.baseIpca})`} valor={reais(ponto?.valor_real)} />
        <Kpi rotulo="Per capita (real)" valor={reaisExato(div(ponto?.valor_real, ponto?.populacao))} />
        <Kpi rotulo={`Variação real desde ${primeiro?.ano ?? '–'}`} valor={crescimento === null ? '–' : pct(crescimento - 1)} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} />
      {s.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo="Valor por exercício" desc="Nominal e corrigido pelo IPCA"
            tabela={<TabelaSerie linhas={s.map((p) => [p.ano, reais(p.valor), reais(p.valor_real)])} colunas={['Ano', 'Nominal', 'Real']} />}>
            <Grafico opcao={opcaoValores} />
          </CartaoGrafico>
          <CartaoGrafico titulo="Per capita (real)" desc={f.rotuloComparador ? `Comparado com ${f.rotuloComparador}` : undefined}
            tabela={<TabelaSerie linhas={s.map((p, i) => [p.ano, reaisExato(perCapita()[i]), reaisExato(comp.dados ? perCapita(comp.dados)[i] : null)])}
              colunas={['Ano', f.rotulo, f.rotuloComparador ?? '']} />}>
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
