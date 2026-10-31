import { useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useApi, type Linha, type Params } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { numero } from '../format';
import { num } from '../hooks';
import { local, t } from '../idioma';
import { calcular, CAPITULOS, fonteSaude, formatar, indicador, INDICADORES, nomeContagem, type Indicador } from '../saude_comum';

/** Escopo das páginas de saúde a partir dos filtros: município, UF (municípios dela) ou Brasil. */
function useSaude() {
  const { meta } = useDados();
  const f = useFiltros();
  const sim = meta.fontes.sim as { anos?: number[] } | undefined;
  const anos = sim?.anos ?? [];
  const ano = anos.includes(f.ano) ? f.ano : anos.at(-1);
  let escopo: Params;
  let rotulo: string;
  let municipio = false;
  if (f.alvo && f.alvo.esfera !== 'E') {
    escopo = { ente: f.alvo.cod_ibge };
    rotulo = f.alvo.esfera === 'D' ? 'Brasília (DF)' : f.rotulo;
    municipio = true;
  } else if (f.alvo?.esfera === 'E' || f.uf) {
    const uf = f.alvo?.uf ?? f.uf!;
    escopo = { uf };
    rotulo = t(`Municípios de ${uf}`, `Municipalities in ${uf}`);
  } else {
    escopo = {};
    rotulo = t('Brasil', 'Brazil');
  }
  const uf = f.alvo?.uf ?? f.uf ?? null;
  return { f, meta, anos, ano, escopo, rotulo, municipio, uf, temDados: anos.length > 0 };
}

function SemDados() {
  return <p className="vazio">{t('Os dados do SIM e do SINASC ainda não foram publicados.', 'SIM and SINASC data have not been published yet.')}</p>;
}

function AvisoAno({ ano }: { ano?: number }) {
  const f = useFiltros();
  if (!f.anoForaDaBase || !ano) return null;
  return (
    <p className="aviso" role="status">
      {t(`O ano de ${f.anoForaDaBase} ainda não está disponível no SIM; a página mostra ${ano}, o mais recente.`,
        `${f.anoForaDaBase} is not available in SIM yet; the page shows ${ano}, the latest year.`)}
    </p>
  );
}

const notaResidencia = () => t(
  'Óbitos e nascimentos contados pelo município de residência (da pessoa falecida ou da mãe), não pelo de ocorrência. Em municípios pequenos, poucos casos mudam muito as taxas: veja o numerador e o denominador ao lado.',
  'Deaths and births are counted by municipality of residence (of the deceased or of the mother), not of occurrence. In small municipalities, a few cases change rates a lot: see the numerator and denominator alongside.',
);

/** Aviso de número pequeno: o denominador abaixo do mínimo do indicador. */
const pequeno = (ind: Indicador, r: Linha | undefined) => {
  const d = num(r?.[ind.denominador]);
  return d !== null && d < ind.minimo;
};

function KpiIndicador({ ind, r, extra }: { ind: Indicador; r?: Linha; extra?: string }) {
  const v = calcular(ind, r);
  const n = num(r?.[ind.numerador]);
  const d = num(r?.[ind.denominador]);
  return (
    <Kpi rotulo={ind.nome()} valor={formatar(ind, v)}
      nota={<>{ind.tipo === 'proporcao' ? `${numero(n)} ${t('de', 'of')} ${numero(d)}` : `${ind.unidade()} · ${numero(n)} ${t('casos', 'cases')}`}
        {extra ? ` · ${extra}` : ''}{pequeno(ind, r) ? ` · ${t('poucos casos: oscila muito', 'few cases: very volatile')}` : ''}</>}
      dica={<Dica rotulo={t('Fórmula', 'Formula')}>{ind.nota()}</Dica>} />
  );
}

// ---------------- visão geral ----------------

export function SaudeVisaoGeral() {
  const { ano, escopo, rotulo, temDados, meta } = useSaude();
  const serie = useApi<Linha[]>(temDados ? 'saude_serie' : null, escopo);
  const a = serie.dados?.find((r) => r.ano === ano);
  const temNasc = num(a?.nascidos) !== null;
  const caps = CAPITULOS().map(([k, n]) => [n, num(a?.[k])] as const).filter(([, v]) => v !== null && v > 0).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0));
  const opcaoCaps = useMemo(() => barras(caps.map(([n]) => n), caps.map(([, v]) => v), (v) => numero(v), true), [serie.dados, ano]); // eslint-disable-line react-hooks/exhaustive-deps
  const infantil = indicador('mortalidade_infantil');
  const anosS = (serie.dados ?? []).map((r) => Number(r.ano));
  const opcaoInf = useMemo(() => linhas(anosS, [
    { nome: t('Infantil', 'Infant'), valores: (serie.dados ?? []).map((r) => calcular(infantil, r)) },
    { nome: t('Neonatal', 'Neonatal'), valores: (serie.dados ?? []).map((r) => calcular(indicador('mortalidade_neonatal'), r)) },
    { nome: t('Pós-neonatal', 'Post-neonatal'), valores: (serie.dados ?? []).map((r) => calcular(indicador('mortalidade_pos_neonatal'), r)) },
  ], (v) => numero1Local(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!temDados) return <><h2 className="titulo-pagina">{t('Saúde', 'Health')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Saúde: visão geral', 'Health: overview')}</h2>
      <p className="subtitulo">{rotulo} · {ano} · {t('nascimentos e óbitos por residência', 'births and deaths by residence')} <Dica rotulo={t('Fonte', 'Source')}>{fonteSaude()}</Dica></p>
      <BarraFiltros />
      <AvisoAno ano={ano} />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !a && t('Sem registros para este recorte.', 'No records for this scope.')} />
      {a && (
        <>
          <div className="kpis kpis-4">
            <Kpi rotulo={t('Nascidos vivos', 'Live births')} valor={numero(num(a.nascidos))}
              nota={t(`natalidade: ${formatar(indicador('natalidade'), calcular(indicador('natalidade'), a))} por mil hab.`, `birth rate: ${formatar(indicador('natalidade'), calcular(indicador('natalidade'), a))} per 1,000`)} />
            <Kpi rotulo={t('Óbitos (não fetais)', 'Deaths (non-fetal)')} valor={numero(num(a.obitos))}
              nota={t(`taxa bruta: ${formatar(indicador('mortalidade_geral'), calcular(indicador('mortalidade_geral'), a))} por mil hab. · fetais: ${numero(num(a.obitos_fetais))}`,
                `crude rate: ${formatar(indicador('mortalidade_geral'), calcular(indicador('mortalidade_geral'), a))} per 1,000 · fetal: ${numero(num(a.obitos_fetais))}`)}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{indicador('mortalidade_geral').nota()}</Dica>} />
            <KpiIndicador ind={infantil} r={a} extra={t(`neonatal ${formatar(infantil, calcular(indicador('mortalidade_neonatal'), a))}`, `neonatal ${formatar(infantil, calcular(indicador('mortalidade_neonatal'), a))}`)} />
            <KpiIndicador ind={indicador('mortalidade_materna')} r={a} />
            <KpiIndicador ind={indicador('baixo_peso')} r={a} />
            <KpiIndicador ind={indicador('cesareas')} r={a} />
            <KpiIndicador ind={indicador('pre_natal')} r={a} />
            <KpiIndicador ind={indicador('mal_definidas')} r={a} />
          </div>
          {!temNasc && <p className="aviso">{t('Sem nascimentos registrados para este recorte e ano: os indicadores por nascidos vivos ficam vazios.', 'No births recorded for this scope and year: indicators per live birth are empty.')}</p>}
          <p className="nota-base">{notaResidencia()}</p>
        </>
      )}
      {a && (
        <div className="grade-2">
          <CartaoGrafico titulo={t('Óbitos por capítulo da CID-10 (causa básica)', 'Deaths by ICD-10 chapter (underlying cause)')} desc={`${rotulo} · ${ano}`}
            tabela={<TabelaCapitulos linha={a} ano={ano!} rotulo={rotulo} versao={meta.geradoEm} />}>
            <Grafico opcao={opcaoCaps} nome="saude_capitulos" altura={420} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Mortalidade infantil e componentes', 'Infant mortality and components')} desc={`${rotulo} · ${t('por mil nascidos vivos', 'per 1,000 live births')}`}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{infantil.nota()}</Dica>}
            tabela={<TabelaSerie nome="saude_mortalidade_infantil" anos={anosS} colunas={[
              { titulo: t('Nascidos vivos', 'Live births'), valores: (serie.dados ?? []).map((r) => num(r.nascidos)), formato: numero },
              { titulo: t('Óbitos infantis', 'Infant deaths'), valores: (serie.dados ?? []).map((r) => num(r.infantis)), formato: numero },
              { titulo: t('Infantil (‰)', 'Infant (‰)'), valores: (serie.dados ?? []).map((r) => calcular(infantil, r)), formato: numero1Local },
              { titulo: t('Neonatal (‰)', 'Neonatal (‰)'), valores: (serie.dados ?? []).map((r) => calcular(indicador('mortalidade_neonatal'), r)), formato: numero1Local },
              { titulo: t('Pós-neonatal (‰)', 'Post-neonatal (‰)'), valores: (serie.dados ?? []).map((r) => calcular(indicador('mortalidade_pos_neonatal'), r)), formato: numero1Local },
            ]} metadados={[[t('Recorte', 'Scope'), rotulo], [t('Fórmula', 'Formula'), infantil.nota()], [t('Fonte', 'Source'), fonteSaude()]]} />}>
            <Grafico opcao={opcaoInf} nome="saude_mortalidade_infantil" />
          </CartaoGrafico>
        </div>
      )}
    </>
  );
}

const numero1Local = (v: number | null) => (v === null ? '–' : v.toLocaleString(local(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

function TabelaCapitulos({ linha, ano, rotulo, versao }: { linha: Linha; ano: number; rotulo: string; versao: string }) {
  const total = num(linha.obitos) ?? 0;
  const caps = CAPITULOS().map(([k, n]) => [n, num(linha[k])] as const);
  return (
    <>
      <div className="rolagem">
        <table>
          <thead><tr><th>{t('Capítulo', 'Chapter')}</th><th>{t('Óbitos', 'Deaths')}</th><th>%</th></tr></thead>
          <tbody>{caps.map(([n, v]) => <tr key={n}><td>{n}</td><td>{numero(v)}</td><td>{total ? `${numero1Local(100 * (v ?? 0) / total)}%` : '–'}</td></tr>)}</tbody>
        </table>
      </div>
      <BotoesExportar nome={`saude_capitulos_${ano}`} obter={() => ({
        colunas: [t('Capítulo da CID-10', 'ICD-10 chapter'), t('Óbitos', 'Deaths'), t('Participação', 'Share')],
        linhas: caps.map(([n, v]) => [n, v, total ? (v ?? 0) / total : null]),
        metadados: [[t('Recorte', 'Scope'), rotulo], [t('Ano', 'Year'), String(ano)], [t('Total de óbitos', 'Total deaths'), String(total)],
          [t('Fonte', 'Source'), fonteSaude()], [t('Versão da base', 'Data version'), versao]],
      })} />
    </>
  );
}

// ---------------- evolução ----------------

function SeletorIndicador({ valor, mudar }: { valor: string; mudar: (id: string) => void }) {
  const grupos = [...new Set(INDICADORES.map((i) => i.grupo()))];
  return (
    <div className="campo">
      <label htmlFor="s-ind">{t('Indicador', 'Indicator')}</label>
      <select id="s-ind" value={valor} onChange={(e) => mudar(e.target.value)}>
        {grupos.map((g) => (
          <optgroup key={g} label={g}>
            {INDICADORES.filter((i) => i.grupo() === g).map((i) => <option key={i.id} value={i.id}>{i.nome()}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export function SaudeEvolucao() {
  const { escopo, rotulo, temDados, uf, municipio, meta } = useSaude();
  const [params, setParams] = useSearchParams();
  const ind = indicador(params.get('ind'));
  const mudar = (id: string) => {
    const b = new URLSearchParams(params);
    b.set('ind', id);
    setParams(b, { replace: true });
  };
  const principal = useApi<Linha[]>(temDados ? 'saude_serie' : null, escopo);
  const refUf = useApi<Linha[]>(temDados && municipio && uf ? 'saude_serie' : null, { uf: uf ?? undefined });
  const refBr = useApi<Linha[]>(temDados && Object.keys(escopo).length ? 'saude_serie' : null, {});
  const anosS = (principal.dados ?? []).map((r) => Number(r.ano));
  const alinhar = (d?: Linha[]) => {
    const m = new Map((d ?? []).map((r) => [Number(r.ano), calcular(ind, r)]));
    return anosS.map((a) => m.get(a) ?? null);
  };
  const series = [
    { nome: rotulo, valores: (principal.dados ?? []).map((r) => calcular(ind, r)) },
    ...(refUf.dados ? [{ nome: uf!, valores: alinhar(refUf.dados) }] : []),
    ...(refBr.dados ? [{ nome: t('Brasil', 'Brazil'), valores: alinhar(refBr.dados) }] : []),
  ];
  const formato = (v: number) => formatar(ind, v);
  const marcas = ind.id === 'prematuros' && anosS.includes(2011) ? [{ x: '2011', rotulo: t('método', 'method') }] : [];
  const opcao = useMemo(() => linhas(anosS, series, formato, marcas), [principal.dados, refUf.dados, refBr.dados, ind.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!temDados) return <><h2 className="titulo-pagina">{t('Saúde: evolução', 'Health: trends')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Saúde: evolução', 'Health: trends')}</h2>
      <p className="subtitulo">{rotulo} <Dica rotulo={t('Fonte', 'Source')}>{fonteSaude()}</Dica></p>
      <BarraFiltros semAno />
      <section className="cartao">
        <div className="filtros"><SeletorIndicador valor={ind.id} mudar={mudar} /></div>
        <p className="desc">{ind.nota()}</p>
      </section>
      <Estado carregando={principal.carregando} erro={principal.erro} tentarNovamente={principal.recarregar} />
      {principal.dados && (
        <CartaoGrafico titulo={ind.nome()} desc={`${rotulo} · ${ind.unidade()}`}
          tabela={<TabelaSerie nome={`saude_${ind.id}`} anos={anosS} colunas={[
            { titulo: `${nomeContagem(ind.numerador)} (${rotulo})`, valores: (principal.dados ?? []).map((r) => num(r[ind.numerador])), formato: numero },
            { titulo: `${nomeContagem(ind.denominador)} (${rotulo})`, valores: (principal.dados ?? []).map((r) => num(r[ind.denominador])), formato: numero },
            ...series.map((s) => ({ titulo: `${s.nome} (${ind.unidade()})`, valores: s.valores, formato: (v: number | null) => formatar(ind, v) })),
          ]} metadados={[[t('Indicador', 'Indicator'), ind.nome()], [t('Fórmula', 'Formula'), ind.nota()], [t('Numerador', 'Numerator'), nomeContagem(ind.numerador)],
            [t('Denominador', 'Denominator'), nomeContagem(ind.denominador)], [t('Fonte', 'Source'), fonteSaude()], [t('Versão da base', 'Data version'), meta.geradoEm]]} />}>
          <Grafico opcao={opcao} nome={`saude_${ind.id}`} />
        </CartaoGrafico>
      )}
      <p className="nota-base">{notaResidencia()} {t('A população da SVS/MS começa em 2000: antes disso, as taxas por habitante ficam vazias; as por nascidos vivos começam em 1996.',
        'SVS/MS population starts in 2000: before that, rates per inhabitant are empty; rates per live birth start in 1996.')}</p>
    </>
  );
}

// ---------------- rankings ----------------

type LinhaRanking = Linha & { _valor: number | null };

export function SaudeRankings() {
  const { ano, temDados, f, uf, meta } = useSaude();
  const [params, setParams] = useSearchParams();
  const { search } = useLocation();
  const ind = indicador(params.get('ind'));
  const minimo = params.get('min') !== null ? Number(params.get('min')) : ind.minimo;
  const desc = params.get('ord') !== 'asc';
  const definir = (mudancas: Record<string, string | null>) => {
    const b = new URLSearchParams(params);
    for (const [k, v] of Object.entries(mudancas)) if (v === null) b.delete(k); else b.set(k, v);
    setParams(b, { replace: true });
  };
  const dados = useApi<Linha[]>(temDados && ano ? 'saude_municipios' : null, { uf: uf ?? undefined, ano });
  const [buscaNome, setBuscaNome] = useState('');
  const [todos, setTodos] = useState(false);
  const universo = useMemo(() => (dados.dados ?? [])
    .map((r) => ({ ...r, _valor: calcular(ind, r) }) as LinhaRanking)
    .filter((r) => r._valor !== null && (num(r[ind.denominador]) ?? 0) >= minimo), [dados.dados, ind.id, minimo]); // eslint-disable-line react-hooks/exhaustive-deps
  const ordenados = useMemo(() => [...universo].sort((x, y) => ((x._valor ?? 0) - (y._valor ?? 0)) * (desc ? -1 : 1)), [universo, desc]);
  const posicao = new Map(ordenados.map((r, i) => [r.cod_ibge, i + 1]));
  const termo = buscaNome.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtrados = termo ? ordenados.filter((r) => String(r.nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo)) : ordenados;
  const visiveis = todos || termo ? filtrados : filtrados.slice(0, 50);
  const escolhido = f.alvo && f.alvo.esfera !== 'E' ? ordenados.find((r) => r.cod_ibge === (f.alvo!.esfera === 'D' ? 5300108 : f.alvo!.cod_ibge)) : undefined;
  const escopoNome = uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil');
  const valores = universo.map((r) => r._valor!).sort((a, b) => a - b);
  const mediana = valores.length ? (valores.length % 2 ? valores[(valores.length - 1) / 2] : (valores[valores.length / 2 - 1] + valores[valores.length / 2]) / 2) : null;
  const opcoesMin = [0, 100, 1000, 5000, 10000, 20000, 100000];
  if (!opcoesMin.includes(ind.minimo)) opcoesMin.push(ind.minimo);

  if (!temDados) return <><h2 className="titulo-pagina">{t('Rankings de saúde', 'Health rankings')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Rankings de saúde', 'Health rankings')}</h2>
      <p className="subtitulo">{escopoNome} · {ano} <Dica rotulo={t('Fonte', 'Source')}>{fonteSaude()}</Dica></p>
      <BarraFiltros semEnte={t('O município escolhido define a UF do ranking e aparece destacado, com a sua posição.', 'The chosen municipality sets the state of the ranking and is highlighted, with its position.')} />
      <AvisoAno ano={ano} />
      {escolhido && (
        <div className="destaque-ente" role="status">
          <strong>{String(escolhido.nome)}</strong>: {t(`posição ${posicao.get(escolhido.cod_ibge)} de ${ordenados.length}`, `rank ${posicao.get(escolhido.cod_ibge)} of ${ordenados.length}`)} ({formatar(ind, escolhido._valor)}; {t('mediana dos municípios', 'municipal median')}: {formatar(ind, mediana)}){' · '}
          <Link to={`/datasus${search}`}>{t('ver o município na visão geral', 'see the municipality in the overview')}</Link>
        </div>
      )}
      {f.alvo && f.alvo.esfera === 'M' && !escolhido && dados.dados && (
        <p className="aviso" role="status">{t(`${f.rotulo} não entra no ranking com o denominador mínimo escolhido.`, `${f.rotulo} is not in the ranking with the chosen minimum denominator.`)}</p>
      )}
      <section className="cartao">
        <div className="filtros">
          <SeletorIndicador valor={ind.id} mudar={(id) => definir({ ind: id, min: null })} />
          <div className="campo">
            <label htmlFor="s-min">{t(`Mínimo: ${nomeContagem(ind.denominador).toLowerCase()}`, `Minimum: ${nomeContagem(ind.denominador).toLowerCase()}`)}</label>
            <select id="s-min" value={minimo} onChange={(e) => definir({ min: e.target.value })}>
              {opcoesMin.sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v ? `≥ ${numero(v)}` : t('todos', 'all')}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="s-ord">{t('Ordem', 'Order')}</label>
            <select id="s-ord" value={desc ? 'desc' : 'asc'} onChange={(e) => definir({ ord: e.target.value === 'asc' ? 'asc' : null })}>
              <option value="desc">{t('maiores primeiro', 'highest first')}</option>
              <option value="asc">{t('menores primeiro', 'lowest first')}</option>
            </select>
          </div>
          <div className="campo">
            <label htmlFor="s-busca">{t('Buscar município', 'Search municipality')}</label>
            <input id="s-busca" value={buscaNome} onChange={(e) => setBuscaNome(e.target.value)} placeholder={t('nome…', 'name…')} />
          </div>
        </div>
        <div className="cabeca-cartao">
          <p className="desc">{ind.nota()} {t(`Universo: ${numero(universo.length)} municípios${minimo ? ` com denominador de pelo menos ${numero(minimo)}` : ''}; com menos, as taxas oscilam demais para comparar.`,
            `Universe: ${numero(universo.length)} municipalities${minimo ? ` with a denominator of at least ${numero(minimo)}` : ''}; below that, rates are too volatile to compare.`)}</p>
          <BotoesExportar nome={`saude_ranking_${ind.id}_${ano}`} obter={() => ({
            colunas: [t('Posição', 'Rank'), 'cod_ibge', t('Município', 'Municipality'), 'UF', `${ind.nome()} (${ind.unidade()})`, nomeContagem(ind.numerador), nomeContagem(ind.denominador), t('População', 'Population')],
            linhas: ordenados.map((r, i) => [i + 1, String(r.cod_ibge), r.nome, r.uf, r._valor, r[ind.numerador], r[ind.denominador], r.populacao]),
            metadados: [[t('Recorte', 'Scope'), escopoNome], [t('Ano', 'Year'), String(ano)], [t('Indicador', 'Indicator'), ind.nome()], [t('Fórmula', 'Formula'), ind.nota()],
              [t('Universo', 'Universe'), t(`${ordenados.length} municípios, denominador mínimo ${minimo}`, `${ordenados.length} municipalities, minimum denominator ${minimo}`)],
              [t('Residência', 'Residence'), notaResidencia()], [t('Fonte', 'Source'), fonteSaude()], [t('Versão da base', 'Data version'), meta.geradoEm], [t('Endereço', 'Address'), location.href]],
          })} />
        </div>
        <Estado carregando={dados.carregando} erro={dados.erro} tentarNovamente={dados.recarregar}
          vazio={!dados.carregando && dados.dados && !ordenados.length && t('Nenhum município com dados para este indicador e ano.', 'No municipality with data for this indicator and year.')} />
        {ordenados.length > 0 && (
          <>
            <div className="rolagem">
              <table className="tabela-fixa">
                <thead><tr><th>{t('Município', 'Municipality')}</th><th>#</th><th>{ind.nome()}</th><th>{nomeContagem(ind.numerador)}</th><th>{nomeContagem(ind.denominador)}</th></tr></thead>
                <tbody>
                  {visiveis.map((r) => (
                    <tr key={String(r.cod_ibge)} className={escolhido?.cod_ibge === r.cod_ibge ? 'destaque' : undefined}>
                      <td><Link to={`/datasus?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(search)), ente: String(r.cod_ibge), uf: String(r.uf) })}`}>{String(r.nome)}{uf ? '' : ` (${r.uf})`}</Link></td>
                      <td>{(posicao.get(r.cod_ibge) ?? 0).toLocaleString(local())}</td>
                      <td>{formatar(ind, r._valor)}</td>
                      <td>{numero(num(r[ind.numerador]))}</td>
                      <td>{numero(num(r[ind.denominador]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="legenda-tabela">
              {!todos && !termo && ordenados.length > 50 ? t(`Mostrando 50 de ${numero(ordenados.length)}. `, `Showing 50 of ${numero(ordenados.length)}. `) : ''}
              {ordenados.length > 50 && !termo && <button className="limpar" onClick={() => setTodos(!todos)}>{todos ? t('mostrar menos', 'show fewer') : t('mostrar todos', 'show all')}</button>}
              {' '}{t(`Mediana dos municípios: ${formatar(ind, mediana)}. Clique no município para abrir a visão geral.`, `Municipal median: ${formatar(ind, mediana)}. Click a municipality to open the overview.`)}
            </p>
          </>
        )}
      </section>
    </>
  );
}

// ---------------- metodologia ----------------

export function SaudeMetodologia() {
  const { meta } = useDados();
  const fonte = (k: string) => meta.fontes[k] as { anos?: number[]; processado_em?: string } | undefined;
  const faixa = (k: string) => {
    const a = fonte(k)?.anos;
    return a?.length ? `${a[0]}–${a.at(-1)}` : t('não publicado', 'not published');
  };
  return (
    <>
      <h2 className="titulo-pagina">{t('Saúde: fontes e metodologia', 'Health: sources and methodology')}</h2>
      <section className="cartao texto">
        <h3>{t('Fontes', 'Sources')}</h3>
        <ul>
          <li><strong>SIM</strong> ({faixa('sim')}): {t('declarações de óbito, microdados públicos do DATASUS (arquivos DORES de cada UF; o arquivo do Brasil repete os mesmos registros e fica de fora). Óbitos fetais à parte (DOFET).', 'death certificates, DATASUS public microdata (DORES files of each state; the national file repeats the same records and is left out). Fetal deaths separately (DOFET).')}</li>
          <li><strong>SINASC</strong> ({faixa('sinasc')}): {t('declarações de nascido vivo, pelo município de residência da mãe; os nascidos de mães residentes no exterior ficam de fora.', 'live birth certificates, by the mother’s municipality of residence; births to mothers living abroad are left out.')}</li>
          <li><strong>{t('População', 'Population')}</strong> ({faixa('populacao_svs')}): {t('estimativas da SVS/MS por município, sexo e idade simples, as mesmas do TABNET para as taxas de saúde.', 'SVS/MS estimates by municipality, sex and single year of age, the same used by TABNET for health rates.')}</li>
        </ul>
        <h3>{t('Como as taxas são calculadas', 'How rates are calculated')}</h3>
        <p>{t('Todas as taxas são razões de somas: para uma UF ou o Brasil, soma-se o numerador e o denominador de todos os municípios (inclusive os registros com município ignorado, que só entram nesses totais) e só então divide-se. Nunca é a média das taxas municipais.',
          'All rates are ratios of sums: for a state or Brazil, numerator and denominator are summed over all municipalities (including records with unknown municipality, which only enter these totals) and only then divided. Never an average of municipal rates.')}</p>
        <div className="rolagem">
          <table>
            <thead><tr><th>{t('Indicador', 'Indicator')}</th><th>{t('Unidade', 'Unit')}</th><th>{t('Definição', 'Definition')}</th></tr></thead>
            <tbody>{INDICADORES.map((i) => <tr key={i.id}><td>{i.nome()}</td><td>{i.unidade()}</td><td>{i.nota()}</td></tr>)}</tbody>
          </table>
        </div>
        <h3>{t('Cuidados na leitura', 'Reading with care')}</h3>
        <ul>
          <li>{notaResidencia()}</li>
          <li>{t('Cálculo direto: o Ministério da Saúde corrige a mortalidade infantil e a materna em UFs com subnotificação; os números daqui são os registrados e podem ficar abaixo das estimativas oficiais nessas UFs, sobretudo nos anos mais antigos.',
            'Direct calculation: the Ministry of Health corrects infant and maternal mortality in states with under-reporting; the numbers here are as recorded and may be below official estimates in those states, especially in earlier years.')}</li>
          <li>{t('A causa básica segue a CID-10 desde 1996. A proporção de causas mal definidas mede a qualidade: onde ela é alta, as taxas por causa ficam subestimadas.', 'The underlying cause follows ICD-10 since 1996. The share of ill-defined causes measures quality: where it is high, cause-specific rates are underestimated.')}</li>
          <li>{t('Prematuridade: em 2011 o SINASC mudou o cálculo da idade gestacional e o indicador subiu de patamar.', 'Preterm births: in 2011 SINASC changed how gestational age is computed, and the indicator rose.')}</li>
          <li>{t('O ano mais recente pode ser preliminar no DATASUS e mudar após a investigação dos óbitos.', 'The latest year may be preliminary at DATASUS and change after death investigations.')}</li>
          <li>{t('Taxas por habitante não são padronizadas por idade.', 'Rates per inhabitant are not age-standardised.')}</li>
        </ul>
        <p className="nota-base">{t('Versão da base', 'Data version')}: {meta.geradoEm} · {t('processado em', 'processed on')} {fonte('sim')?.processado_em ?? '–'}</p>
      </section>
    </>
  );
}
