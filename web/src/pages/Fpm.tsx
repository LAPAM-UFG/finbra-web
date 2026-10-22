import { useMemo, useState } from 'react';
import { useApi, type Linha } from '../api';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useIndicadores } from '../hooks';
import { TabelaSerie } from './Receitas';

const pctEixo = (v: number) => pct(v, 0);

export function Fpm() {
  const { meta } = useDados();
  const { alvo, comp, f } = useIndicadores(['fpm', 'receita_corrente']);
  const s = alvo.dados ?? [];
  const c = comp.dados ?? [];
  const anos = s.map((r) => r.exercicio as number);
  const noAno = (d: Linha[]) => d.find((r) => r.exercicio === f.ano);
  const a = noAno(s);
  const b = noAno(c);
  const dependencia = (r?: Linha) => div(num(r?.fpm), num(r?.receita_corrente));

  const opcaoFpm = useMemo(
    () => linhas(anos, [
      { nome: 'Nominal', valores: s.map((r) => num(r.fpm)) },
      { nome: `Real (R$ de ${meta.baseIpca})`, valores: s.map((r) => num(r.fpm_real)) },
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
      <h2 className="titulo-pagina">Fundo de Participação dos Municípios</h2>
      <p className="subtitulo">{f.rotulo} · FPM bruto (antes da dedução do FUNDEB)</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo={`FPM em ${f.ano}`} valor={reais(num(a?.fpm))} nota={`Real: ${reais(num(a?.fpm_real))}`} />
        <Kpi rotulo="FPM per capita" valor={reaisExato(div(num(a?.fpm), num(a?.populacao)))}
          nota={f.rotuloComparador ? `${f.rotuloComparador}: ${reaisExato(div(num(b?.fpm), num(b?.populacao)))}` : undefined} />
        <Kpi rotulo="Dependência fiscal" valor={pct(dependencia(a))}
          nota={f.rotuloComparador ? `${f.rotuloComparador}: ${pct(dependencia(b))}` : 'FPM ÷ receita corrente'} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} vazio={!alvo.carregando && !s.some((r) => r.fpm)} />
      {s.some((r) => r.fpm) && (
        <div className="grade-2">
          <CartaoGrafico titulo="FPM por exercício" desc="Nominal e corrigido pelo IPCA"
            tabela={<TabelaSerie colunas={['Ano', 'Nominal', 'Real']} linhas={s.map((r) => [r.exercicio as number, reais(num(r.fpm)), reais(num(r.fpm_real))])} />}>
            <Grafico opcao={opcaoFpm} />
          </CartaoGrafico>
          <CartaoGrafico titulo="Dependência fiscal" desc="FPM ÷ receita corrente"
            tabela={<TabelaSerie colunas={['Ano', 'Dependência']} linhas={s.map((r) => [r.exercicio as number, pct(dependencia(r))])} />}>
            <Grafico opcao={opcaoDep} />
          </CartaoGrafico>
        </div>
      )}
    </>
  );
}

type Faixa = { grupo: number; nome: string; faixa: string };

export function FpmFaixas() {
  const f = useFiltros();
  const faixas = useApi<Faixa[]>('faixas');
  const porFaixa = useApi<Linha[]>('agregado', {
    por: 'faixa_grupo', campos: 'fpm,receita_corrente', ano: f.ano, uf: f.uf ?? undefined, esfera: 'M',
  });
  const [faixa, setFaixa] = useState<number | ''>('');
  const porUf = useApi<Linha[]>('agregado', { por: 'uf', campos: 'fpm,receita_corrente', ano: f.ano, esfera: 'M', faixa });

  const linhasFaixa = (faixas.dados ?? []).map((fx) => {
    const r = porFaixa.dados?.find((l) => l.faixa_grupo === fx.grupo);
    return { ...fx, r, perCapita: div(num(r?.fpm), num(r?.populacao)) };
  });
  const opcao = useMemo(
    () => barras(linhasFaixa.map((l) => l.faixa), linhasFaixa.map((l) => l.perCapita), reaisCurto, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [porFaixa.dados, faixas.dados],
  );

  return (
    <>
      <h2 className="titulo-pagina">FPM por faixa populacional</h2>
      <p className="subtitulo">{f.uf ? `Municípios de ${f.uf}` : 'Todos os municípios'} · {f.ano}</p>
      <BarraFiltros />
      <Estado carregando={porFaixa.carregando} erro={porFaixa.erro} />
      <CartaoGrafico titulo="FPM per capita por faixa" desc="Municípios agrupados pela população do exercício">
        <Grafico opcao={opcao} altura={320} />
      </CartaoGrafico>
      <section className="cartao">
        <h3>Faixas populacionais</h3>
        <div className="rolagem">
          <table>
            <thead>
              <tr><th>Grupo</th><th>Habitantes</th><th>Municípios</th><th>População</th><th>FPM</th><th>FPM per capita</th><th>Dependência fiscal</th></tr>
            </thead>
            <tbody>
              {linhasFaixa.map((l) => (
                <tr key={l.grupo}>
                  <td>{l.nome}</td><td>{l.faixa}</td><td>{numero(num(l.r?.entes))}</td><td>{numero(num(l.r?.populacao))}</td>
                  <td>{reais(num(l.r?.fpm))}</td><td>{reaisExato(l.perCapita)}</td>
                  <td>{pct(div(num(l.r?.fpm), num(l.r?.receita_corrente)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cartao">
        <div className="cabeca-cartao">
          <h3>Por UF</h3>
          <div className="campo">
            <label htmlFor="faixa">Faixa</label>
            <select id="faixa" value={faixa} onChange={(e) => setFaixa(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Todas</option>
              {(faixas.dados ?? []).map((fx) => <option key={fx.grupo} value={fx.grupo}>{fx.nome} · {fx.faixa}</option>)}
            </select>
          </div>
        </div>
        <div className="rolagem">
          <table>
            <thead><tr><th>UF</th><th>Municípios</th><th>FPM</th><th>FPM real</th><th>FPM per capita</th><th>Dependência fiscal</th></tr></thead>
            <tbody>
              {(porUf.dados ?? []).map((r) => (
                <tr key={String(r.uf)}>
                  <td>{r.uf}</td><td>{numero(num(r.entes))}</td><td>{reais(num(r.fpm))}</td><td>{reais(num(r.fpm_real))}</td>
                  <td>{reaisExato(div(num(r.fpm), num(r.populacao)))}</td><td>{pct(div(num(r.fpm), num(r.receita_corrente)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
