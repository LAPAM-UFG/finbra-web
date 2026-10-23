import { useMemo, useState } from 'react';
import { useApi, type Linha } from '../api';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useIndicadores } from '../hooks';
import { faixa, t } from '../idioma';
import { TabelaSerie } from './Receitas';

const pctEixo = (v: number) => pct(v, 0);
const formulaDependencia = () =>
  t(
    'Dependência fiscal = soma do FPM ÷ soma da receita corrente dos municípios do grupo. Ficam de fora os ente-anos com alerta.',
    'Fiscal dependency = sum of FPM ÷ sum of current revenue of the municipalities in the group. Government-years with alerts are excluded.',
  );

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
  const fpmReceita = t('FPM ÷ receita corrente', 'FPM ÷ current revenue');

  const opcaoFpm = useMemo(
    () => linhas(anos, [
      { nome: 'Nominal', valores: s.map((r) => num(r.fpm)) },
      { nome: t(`Real (R$ de ${meta.baseIpca})`, `Real (${meta.baseIpca} R$)`), valores: s.map((r) => num(r.fpm_real)) },
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
      <p className="subtitulo">{f.rotulo} · {t('FPM bruto (antes da dedução do FUNDEB)', 'Gross FPM (before the FUNDEB deduction)')}</p>
      <BarraFiltros />
      <div className="kpis">
        <Kpi rotulo={t(`FPM em ${f.ano}`, `FPM in ${f.ano}`)} valor={reais(num(a?.fpm))} nota={`Real: ${reais(num(a?.fpm_real))}`} />
        <Kpi rotulo={t('FPM per capita', 'FPM per capita')} valor={reaisExato(div(num(a?.fpm), num(a?.populacao)))}
          nota={f.rotuloComparador ? `${f.rotuloComparador}: ${reaisExato(div(num(b?.fpm), num(b?.populacao)))}` : undefined} />
        <Kpi rotulo={t('Dependência fiscal', 'Fiscal dependency')} valor={pct(dependencia(a))}
          nota={f.rotuloComparador ? `${f.rotuloComparador}: ${pct(dependencia(b))}` : fpmReceita} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} vazio={!alvo.carregando && !s.some((r) => r.fpm)} />
      {s.some((r) => r.fpm) && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('FPM por exercício', 'FPM by fiscal year')} desc={t('Nominal e corrigido pelo IPCA', 'Nominal and adjusted by the IPCA')}
            tabela={<TabelaSerie colunas={[t('Ano', 'Year'), 'Nominal', 'Real']} linhas={s.map((r) => [r.exercicio as number, reais(num(r.fpm)), reais(num(r.fpm_real))])} />}>
            <Grafico opcao={opcaoFpm} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Dependência fiscal', 'Fiscal dependency')} desc={fpmReceita}
            tabela={<TabelaSerie colunas={[t('Ano', 'Year'), t('Dependência', 'Dependency')]} linhas={s.map((r) => [r.exercicio as number, pct(dependencia(r))])} />}>
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
  const [grupo, setGrupo] = useState<number | ''>('');
  const porUf = useApi<Linha[]>('agregado', { por: 'uf', campos: 'fpm,receita_corrente', ano: f.ano, esfera: 'M', faixa: grupo });

  const linhasFaixa = (faixas.dados ?? []).map((fx) => {
    const r = porFaixa.dados?.find((l) => l.faixa_grupo === fx.grupo);
    return { ...fx, r, perCapita: div(num(r?.fpm), num(r?.populacao)) };
  });
  const opcao = useMemo(
    () => barras(linhasFaixa.map((l) => faixa(l.faixa)), linhasFaixa.map((l) => l.perCapita), reaisCurto, false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [porFaixa.dados, faixas.dados],
  );
  const colDependencia = <th className="dica" title={formulaDependencia()}>{t('Dependência fiscal', 'Fiscal dependency')}</th>;

  return (
    <>
      <h2 className="titulo-pagina">{t('FPM por faixa populacional', 'FPM by population bracket')}</h2>
      <p className="subtitulo">{f.uf ? t(`Municípios de ${f.uf}`, `Municipalities in ${f.uf}`) : t('Todos os municípios', 'All municipalities')} · {f.ano}</p>
      <BarraFiltros />
      <Estado carregando={porFaixa.carregando} erro={porFaixa.erro} />
      <CartaoGrafico titulo={t('FPM per capita por faixa', 'FPM per capita by bracket')}
        desc={t('Municípios agrupados pela população do exercício', 'Municipalities grouped by population in the fiscal year')}>
        <Grafico opcao={opcao} altura={320} />
      </CartaoGrafico>
      <section className="cartao">
        <h3>{t('Faixas populacionais', 'Population brackets')}</h3>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('Grupo', 'Group')}</th><th>{t('Habitantes', 'Inhabitants')}</th><th>{t('Municípios', 'Municipalities')}</th>
                <th>{t('População', 'Population')}</th><th>FPM</th><th>{t('FPM per capita', 'FPM per capita')}</th>{colDependencia}
              </tr>
            </thead>
            <tbody>
              {linhasFaixa.map((l) => (
                <tr key={l.grupo}>
                  <td>{faixa(l.nome)}</td><td>{faixa(l.faixa)}</td><td>{numero(num(l.r?.entes))}</td><td>{numero(num(l.r?.populacao))}</td>
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
          <h3>{t('Por UF', 'By state')}</h3>
          <div className="campo">
            <label htmlFor="faixa">{t('Faixa', 'Bracket')}</label>
            <select id="faixa" value={grupo} onChange={(e) => setGrupo(e.target.value ? Number(e.target.value) : '')}>
              <option value="">{t('Todas', 'All')}</option>
              {(faixas.dados ?? []).map((fx) => <option key={fx.grupo} value={fx.grupo}>{faixa(fx.nome)} · {faixa(fx.faixa)}</option>)}
            </select>
          </div>
        </div>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('UF', 'State')}</th><th>{t('Municípios', 'Municipalities')}</th><th>FPM</th><th>{t('FPM real', 'Real FPM')}</th>
                <th>{t('FPM per capita', 'FPM per capita')}</th>{colDependencia}
              </tr>
            </thead>
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
