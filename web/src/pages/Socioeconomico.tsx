import { useMemo } from 'react';
import type { Linha } from '../api';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useIndicadores } from '../hooks';
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

  const serie = (fn: (r?: Linha) => number | null) => [
    { nome: f.rotulo, valores: anos.map((ano) => fn(doAno(s, ano))) },
    ...(f.rotuloComparador && c.length ? [{ nome: f.rotuloComparador, valores: anos.map((ano) => fn(doAno(c, ano))) }] : []),
  ];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opcaoPib = useMemo(() => linhas(anos, serie(pibPc), reaisCurto), [alvo.dados, comp.dados]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const opcaoCarga = useMemo(() => linhas(anos, serie(receitaPib), (v) => pct(v, 0)), [alvo.dados, comp.dados]);
  const setores: [string, string][] = [
    ['Agropecuária', 'vab_agropecuaria'], ['Indústria', 'vab_industria'],
    ['Serviços', 'vab_servicos'], ['Administração pública', 'vab_adm_publica'],
  ];
  const comVab = s.filter((r) => r.vab_servicos !== null).at(-1);
  const opcaoVab = useMemo(
    () => barras(setores.map(([n]) => n), setores.map(([, k]) => num(comVab?.[k])), reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados],
  );

  return (
    <>
      <h2 className="titulo-pagina">Contexto socioeconômico</h2>
      <p className="subtitulo">{f.rotulo} · PIB municipal (IBGE) e painel da pesquisa LAPAM</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo={`PIB ${ultimoPib?.exercicio ?? ''}`} valor={reais(num(ultimoPib?.pib))} />
        <Kpi rotulo="PIB per capita" valor={reaisExato(pibPc(ultimoPib))} />
        <Kpi rotulo="Receita bruta ÷ PIB" valor={pct(receitaPib(ultimoPib))} nota={`${ultimoPib?.exercicio ?? ''}`} />
        <Kpi rotulo="Impostos e taxas próprios ÷ PIB" valor={pct(div(num(ultimoPib?.receita_impostos_taxas), num(ultimoPib?.pib)), 2)} />
      </div>
      <p className="aviso">
        O PIB municipal do IBGE vai até 2023, e o detalhamento por setor até 2021. Para estados, só há dados fiscais.
      </p>
      <Estado carregando={alvo.carregando} erro={alvo.erro} />
      {comPib.length > 0 && (
        <div className="grade-2">
          <CartaoGrafico titulo="PIB per capita" desc="R$ correntes"
            tabela={<TabelaSerie colunas={['Ano', 'PIB per capita']} linhas={s.map((r) => [r.exercicio as number, reaisExato(pibPc(r))])} />}>
            <Grafico opcao={opcaoPib} />
          </CartaoGrafico>
          <CartaoGrafico titulo="Receita bruta em relação ao PIB" desc="Peso do orçamento municipal na economia local"
            tabela={<TabelaSerie colunas={['Ano', 'Receita ÷ PIB']} linhas={s.map((r) => [r.exercicio as number, pct(receitaPib(r))])} />}>
            <Grafico opcao={opcaoCarga} />
          </CartaoGrafico>
        </div>
      )}
      {comVab && (
        <CartaoGrafico titulo={`Valor adicionado por setor · ${comVab.exercicio}`} desc="IBGE, R$ correntes">
          <Grafico opcao={opcaoVab} altura={200} />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <h3>Transferências às famílias</h3>
        <p className="desc">Painel da pesquisa LAPAM (2013–2021): Bolsa Família e benefícios do INSS.</p>
        <div className="rolagem">
          <table>
            <thead><tr><th>Ano</th><th>Famílias no Bolsa Família</th><th>Valor do Bolsa Família</th><th>Benefícios INSS</th></tr></thead>
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
        {a && a.bolsa_familia_valor === null && <p className="vazio">Sem dados do painel para os exercícios disponíveis.</p>}
      </section>
    </>
  );
}
