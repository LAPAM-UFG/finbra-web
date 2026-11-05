import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { useDados } from '../contexto';
import { numero } from '../format';
import { local, t } from '../idioma';
import { UFS } from '../munic_comum';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const FONTE_CHIRPS = () => t(
  'CHIRPS v3 (Climate Hazards Center, UC Santa Barbara): chuva estimada por satélite e estações, grade de 0,05° (cerca de 5 km). Média dentro de cada município pela malha municipal de 2022 do IBGE. Processamento: LAPAM/UFG',
  'CHIRPS v3 (Climate Hazards Center, UC Santa Barbara): rainfall estimated from satellites and stations, 0.05° grid (about 5 km). Averaged inside each municipality using the IBGE 2022 municipal boundaries. Processing: LAPAM/UFG',
);
const FONTE_ERA5 = () => t(
  'ERA5-Land (Copernicus Climate Change Service / ECMWF): reanálise de variáveis de superfície, grade de 0,1° (cerca de 9 km), médias mensais. Média dentro de cada município pela malha municipal de 2022 do IBGE. Processamento: LAPAM/UFG',
  'ERA5-Land (Copernicus Climate Change Service / ECMWF): land-surface reanalysis, 0.1° grid (about 9 km), monthly means. Averaged inside each municipality using the IBGE 2022 municipal boundaries. Processing: LAPAM/UFG',
);

/** Variável escolhida: unidade, como o ano resume os meses e se a anomalia é relativa (%) ou uma diferença na unidade. */
type Variavel = { codigo: string; rotulo: string; unidade: string; soma: boolean; relativa: boolean; fonte: string; de: number; ate: number; mesAte: number };

const casas = (u: string) => (u === '°C' || u === '%' ? 1 : 0);
const sinal = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
const valorTxt = (v: number | null | undefined, u: string) => (v === null || v === undefined || !Number.isFinite(v) ? '–'
  : `${v.toLocaleString(local(), { minimumFractionDigits: casas(u), maximumFractionDigits: casas(u) })} ${u}`);
const semUnidade = (v: number | null | undefined, u: string) => (v === null || v === undefined || !Number.isFinite(v) ? '–'
  : v.toLocaleString(local(), { minimumFractionDigits: casas(u), maximumFractionDigits: casas(u) }));
/** Variação relativa (fração) com sinal: +12,3% / −5,0%. */
const variacao = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '–'
  : `${sinal(v)}${Math.abs(v * 100).toLocaleString(local(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const diferenca = (v: number | null | undefined, u: string) => (v === null || v === undefined || !Number.isFinite(v) ? '–'
  : `${sinal(v)}${Math.abs(v).toLocaleString(local(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${u}`);
/** Anomalia da linha, na forma da variável: relativa à normal (chuva, evaporação) ou diferença em unidade (temperatura). */
const anomaliaDe = (r: Linha | undefined, x: Variavel) => (x.relativa ? num(r?.anomalia_pct) : num(r?.anomalia));
const anomaliaTxt = (r: Linha | undefined, x: Variavel) => (x.relativa ? variacao(anomaliaDe(r, x)) : diferenca(anomaliaDe(r, x), x.unidade));
const mesCurto = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString(local(), { month: 'short' }).replace('.', '');
const minusculo = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const fonteDe = (x: Variavel | null) => (x && x.fonte.includes('CHIRPS') ? FONTE_CHIRPS() : FONTE_ERA5());
const ateTxt = (ate?: number) => (ate ? `${String(ate % 100).padStart(2, '0')}/${Math.floor(ate / 100)}` : '–');

/** Escolhas da página no endereço: variável, UF, município e ano. Nada vem dos filtros de outros painéis. */
function useEscolhas() {
  const [sp, setSp] = useSearchParams();
  const definir = (mudancas: Record<string, string | null>) => {
    const novo = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') novo.delete(k);
      else novo.set(k, v);
    }
    setSp(novo, { replace: true });
  };
  const uf = UFS.includes(sp.get('uf') ?? '') ? sp.get('uf')! : '';
  return { sp, uf, definir };
}

function useMetaClima() {
  const { meta } = useDados();
  const f = meta.fontes.clima as { anos?: number[]; ate?: number; normal?: number[]; processado_em?: string } | undefined;
  return { anos: f?.anos ?? [], ate: f?.ate, normal: f?.normal ?? [1991, 2020], processadoEm: f?.processado_em, geradoEm: meta.geradoEm };
}

/** Catálogo de variáveis e a escolhida (padrão: chuva). */
function useVariavel(sp: URLSearchParams, publicado: boolean) {
  const cat = useApi<Linha[]>(publicado ? 'clima_catalogo' : null, {});
  const lista: Variavel[] = useMemo(() => (cat.dados ?? []).map((r) => ({
    codigo: texto(r.variavel), rotulo: texto(r.rotulo), unidade: texto(r.unidade), soma: r.resumo_anual === 'soma', relativa: r.anomalia === 'pct',
    fonte: texto(r.fonte), de: Number(r.ano_de), ate: Number(r.ano_ate), mesAte: Number(r.ate),
  })), [cat.dados]);
  const atual = lista.find((x) => x.codigo === sp.get('variavel')) ?? lista.find((x) => x.codigo === 'chuva_mm') ?? lista[0] ?? null;
  return { lista, atual, carregando: cat.carregando, erro: cat.erro };
}

function SeletorVariavel({ id, lista, atual, definir }: { id: string; lista: Variavel[]; atual: Variavel | null; definir: (m: Record<string, string | null>) => void }) {
  return (
    <div className="campo">
      <label htmlFor={id}>{t('Variável', 'Variable')}</label>
      <select id={id} value={atual?.codigo ?? ''} onChange={(e) => definir({ variavel: e.target.value === 'chuva_mm' ? null : e.target.value, ano: null, cod: null, ordem: null })}>
        {lista.map((x) => <option key={x.codigo} value={x.codigo}>{x.rotulo} ({x.unidade})</option>)}
      </select>
    </div>
  );
}

const SemDados = () => <p className="vazio">{t('Os dados de clima ainda não foram publicados.', 'Climate data have not been published yet.')}</p>;

// ---------------- visão geral ----------------

export function ClimaVisaoGeral() {
  const { sp, uf, definir } = useEscolhas();
  const { anos: anosMeta, normal: periodo, geradoEm } = useMetaClima();
  const publicado = anosMeta.length > 0;
  const { lista, atual: x, erro: erroCat } = useVariavel(sp, publicado);
  const v = x?.codigo;
  const lugares = useApi<Linha[]>(x ? 'clima_lugares' : null, { uf, variavel: v });
  const cod = lugares.dados?.some((r) => String(r.cod) === sp.get('cod')) ? Number(sp.get('cod')) : null;
  const lugar = (lugares.dados ?? []).find((r) => num(r.cod) === cod);
  const escopo = lugar ? `${texto(lugar.nome)} (${texto(lugar.uf)})` : uf ? t(`Estado ${uf}`, `State ${uf}`) : t('Brasil', 'Brazil');
  const params = { cod, uf, variavel: v };
  const anual = useApi<Linha[]>(x ? 'clima_anual' : null, params);
  const mensal = useApi<Linha[]>(x ? 'clima_mensal' : null, params);
  const serie = useMemo(() => (anual.dados ?? []).filter((r) => num(r.valor) !== null), [anual.dados]);
  const anos = serie.map((r) => Number(r.ano));
  const normal = num(serie[0]?.normal);
  const ultimo = serie.at(-1);
  const maior = serie.reduce<Linha | null>((m, r) => (!m || Number(r.valor) > Number(m.valor) ? r : m), null);
  const menor = serie.reduce<Linha | null>((m, r) => (!m || Number(r.valor) < Number(m.valor) ? r : m), null);

  const mesesDoMensal = mensal.dados ?? [];
  const anosMensais = useMemo(() => [...new Set(mesesDoMensal.map((r) => Number(r.ano)))].sort((a, b) => b - a), [mesesDoMensal]);
  const pedido = Number(sp.get('ano'));
  const ano = anosMensais.includes(pedido) ? pedido : anosMensais[0];
  const doAno = mesesDoMensal.filter((r) => Number(r.ano) === ano);
  const valoresMes = (m: number) => num(doAno.find((r) => Number(r.mes) === m)?.valor);
  const normalMes = (m: number) => num(doAno.find((r) => Number(r.mes) === m)?.normal);
  const meses = Array.from({ length: 12 }, (_, i) => i + 1);
  const mesesCom = doAno.length;

  if (!publicado) return <><h2 className="titulo-pagina">{t('Clima', 'Climate')}</h2><SemDados /></>;
  if (!x) return <><h2 className="titulo-pagina">{t('Clima', 'Climate')}</h2><Estado carregando={!erroCat} erro={erroCat} tentarNovamente={() => location.reload()} /></>;

  const nome = minusculo(x.rotulo);
  const rot = (s: string) => `${s} (${x.unidade})`;
  const fonte = fonteDe(x);
  const metaBase = [[t('Recorte', 'Scope'), escopo], [t('Variável', 'Variable'), `${x.rotulo} (${x.unidade})`], [t('Normal', 'Normal'), `${periodo[0]}–${periodo[1]}`],
    [t('Fonte', 'Source'), fonte], [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]] as [string, string][];
  const exportarAnual = () => ({
    colunas: [t('Ano', 'Year'), rot(x.rotulo), rot(t('Normal', 'Normal')), x.relativa ? t('Variação sobre a normal', 'Change from normal') : rot(t('Diferença para a normal', 'Difference from normal'))],
    linhas: serie.map((r) => [Number(r.ano), num(r.valor), num(r.normal), anomaliaDe(r, x)]),
    metadados: [...metaBase, [t('Anos', 'Years'), t('só anos com os 12 meses', 'only years with all 12 months')] as [string, string]],
  });
  const exportarMensal = () => ({
    colunas: [t('Ano', 'Year'), t('Mês', 'Month'), rot(x.rotulo), rot(t('Normal do mês', 'Monthly normal'))],
    linhas: mesesDoMensal.map((r) => [Number(r.ano), Number(r.mes), num(r.valor), num(r.normal)]),
    metadados: metaBase,
  });
  const fmt = (n: number) => semUnidade(n, x.unidade);

  return (
    <>
      <h2 className="titulo-pagina">{t(`Clima: ${nome} por município`, `Climate: ${nome} by municipality`)}</h2>
      <p className="subtitulo">{escopo} <Dica rotulo={t('Fonte', 'Source')}>{fonte}</Dica></p>
      <section className="cartao">
        <div className="filtros">
          <SeletorVariavel id="c-var" lista={lista} atual={x} definir={definir} />
          <div className="campo">
            <label htmlFor="c-uf">UF</label>
            <select id="c-uf" value={uf} onChange={(e) => definir({ uf: e.target.value, cod: null, ano: null })}>
              <option value="">{t('Brasil', 'Brazil')}</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="c-mun">{t('Município', 'Municipality')}</label>
            <select id="c-mun" value={cod ?? ''} onChange={(e) => definir({ cod: e.target.value, ano: null })}>
              <option value="">{uf ? t('estado inteiro', 'whole state') : t('Brasil inteiro', 'whole country')}</option>
              {(lugares.dados ?? []).map((r) => <option key={texto(r.cod)} value={texto(r.cod)}>{texto(r.nome)}{uf ? '' : ` (${texto(r.uf)})`}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="c-ano">{t('Ano do gráfico mensal', 'Year of the monthly chart')}</label>
            <select id="c-ano" value={ano ?? ''} onChange={(e) => definir({ ano: e.target.value })}>
              {anosMensais.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={lugares.carregando || anual.carregando} erro={lugares.erro ?? anual.erro} tentarNovamente={anual.recarregar}
          vazio={!anual.carregando && !serie.length && t('Sem dados para este recorte.', 'No data for this scope.')} />
      </section>
      {serie.length > 0 && (
        <>
          <div className="kpis kpis-4">
            <Kpi rotulo={`${x.rotulo} ${t('em', 'in')} ${ultimo?.ano}`} valor={valorTxt(num(ultimo?.valor), x.unidade)}
              nota={x.soma ? t('soma dos 12 meses do último ano completo', 'sum of the 12 months of the latest complete year') : t('média dos 12 meses do último ano completo', 'mean of the 12 months of the latest complete year')} />
            <Kpi rotulo={t('Normal anual', 'Annual normal')} valor={valorTxt(normal, x.unidade)} nota={`${periodo[0]}–${periodo[1]}`} />
            <Kpi rotulo={t('Último ano contra a normal', 'Latest year vs normal')} valor={anomaliaTxt(ultimo, x)}
              nota={normal !== null ? (x.relativa ? t('diferença relativa à normal', 'relative to the normal') : t('diferença para a normal', 'difference from the normal')) : t('sem normal para este recorte', 'no normal for this scope')} />
            <Kpi rotulo={t('Maior · menor', 'Highest · lowest')} valor={`${maior?.ano} · ${menor?.ano}`}
              nota={`${valorTxt(num(maior?.valor), x.unidade)} · ${valorTxt(num(menor?.valor), x.unidade)}`} />
          </div>
          <CartaoGrafico titulo={t(`${x.rotulo} por ano`, `${x.rotulo} per year`)}
            desc={t(`${escopo}, ${x.soma ? 'soma' : 'média'} dos 12 meses; a segunda linha é a normal ${periodo[0]}–${periodo[1]}. Só entram anos completos.`,
              `${escopo}, ${x.soma ? 'sum' : 'mean'} of the 12 months; the second line is the ${periodo[0]}–${periodo[1]} normal. Only complete years.`)}
            acoes={<BotoesExportar nome={`clima_${x.codigo}_anual_${cod ?? (uf || 'BR')}`} obter={exportarAnual} />}
            tabela={<div className="rolagem"><table><thead><tr><th>{t('Ano', 'Year')}</th><th>{x.unidade}</th><th>{t('Normal', 'Normal')}</th><th>{x.relativa ? t('Variação', 'Change') : t('Diferença', 'Difference')}</th></tr></thead>
              <tbody>{[...serie].reverse().map((r) => <tr key={texto(r.ano)}><td>{texto(r.ano)}</td><td>{fmt(Number(r.valor))}</td><td>{fmt(Number(r.normal))}</td><td>{anomaliaTxt(r, x)}</td></tr>)}</tbody></table></div>}>
            <Grafico nome="clima_anual" opcao={linhas(anos, [
              { nome: rot(`${x.rotulo} ${t('no ano', 'in the year')}`), valores: serie.map((r) => num(r.valor)) },
              { nome: rot(t('Normal', 'Normal')), valores: serie.map(() => normal) },
            ], fmt, [], !x.relativa)} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Em relação à normal', 'Relative to the normal')}
            desc={x.relativa ? t('Diferença percentual do ano sobre a normal anual. Acima de zero: acima da normal.', 'Percentage difference of the year from the annual normal. Above zero: above normal.')
              : t(`Diferença do ano para a normal anual, em ${x.unidade}. Acima de zero: acima da normal.`, `Difference of the year from the annual normal, in ${x.unidade}. Above zero: above normal.`)}>
            <Grafico nome="clima_anomalia" altura={260}
              opcao={linhas(anos, [{ nome: x.relativa ? t('Variação sobre a normal', 'Change from normal') : rot(t('Diferença para a normal', 'Difference from normal')), valores: serie.map((r) => anomaliaDe(r, x)) }],
                (n) => (x.relativa ? variacao(n) : diferenca(n, x.unidade)))} />
          </CartaoGrafico>
        </>
      )}
      <Estado carregando={mensal.carregando} erro={mensal.erro} tentarNovamente={mensal.recarregar} />
      {mesesCom > 0 && (
        <CartaoGrafico titulo={t(`${x.rotulo} mês a mês em ${ano}`, `${x.rotulo} month by month in ${ano}`)}
          desc={t(`${escopo}, contra a normal de cada mês (${periodo[0]}–${periodo[1]}). Dados mensais até ${ateTxt(x.mesAte)}.`, `${escopo}, against the normal of each month (${periodo[0]}–${periodo[1]}). Monthly data up to ${ateTxt(x.mesAte)}.`)}
          acoes={<BotoesExportar nome={`clima_${x.codigo}_mensal_${cod ?? (uf || 'BR')}`} obter={exportarMensal} />}
          tabela={<div className="rolagem"><table><thead><tr><th>{t('Mês', 'Month')}</th><th>{x.unidade}</th><th>{t('Normal do mês', 'Monthly normal')}</th><th>{x.relativa ? t('Variação', 'Change') : t('Diferença', 'Difference')}</th></tr></thead>
            <tbody>{meses.filter((m) => valoresMes(m) !== null).map((m) => <tr key={m}><td>{mesCurto(m)}</td><td>{semUnidade(valoresMes(m), x.unidade)}</td><td>{semUnidade(normalMes(m), x.unidade)}</td>
              <td>{normalMes(m) === null ? '–' : x.relativa ? variacao(normalMes(m) ? Number(valoresMes(m)) / Number(normalMes(m)) - 1 : null) : diferenca(Number(valoresMes(m)) - Number(normalMes(m)), x.unidade)}</td></tr>)}</tbody></table></div>}>
          <Grafico nome="clima_mensal" opcao={linhas(meses.map(mesCurto), [
            { nome: rot(`${x.rotulo} ${t('em', 'in')} ${ano}`), valores: meses.map(valoresMes) },
            { nome: rot(t('Normal do mês', 'Monthly normal')), valores: meses.map(normalMes) },
          ], fmt, [], !x.relativa)} />
        </CartaoGrafico>
      )}
    </>
  );
}

// ---------------- rankings ----------------

type Ordem = 'maior' | 'menor' | 'acima' | 'abaixo';

export function ClimaRankings() {
  const { sp, uf, definir } = useEscolhas();
  const { anos: anosMeta, normal: periodo, geradoEm } = useMetaClima();
  const publicado = anosMeta.length > 0;
  const { lista: variaveis, atual: x, erro: erroCat } = useVariavel(sp, publicado);
  // o último ano da série pode ter menos de 12 meses (não entra no anual): a faixa vem do catálogo da variável
  const anos = useMemo(() => (x ? Array.from({ length: x.ate - x.de + 1 }, (_, i) => x.ate - i) : []), [x]);
  const pedido = Number(sp.get('ano'));
  const ano = anos.includes(pedido) ? pedido : anos[0];
  const ordem = (['maior', 'menor', 'acima', 'abaixo'] as Ordem[]).find((o) => o === sp.get('ordem')) ?? 'maior';
  const dados = useApi<Linha[]>(x && ano ? 'clima_ranking' : null, { ano, uf, variavel: x?.codigo });
  const lista = useMemo(() => {
    if (!x) return [];
    const base = (dados.dados ?? []).filter((r) => num(r.valor) !== null);
    const chave = (r: Linha) => (ordem === 'maior' || ordem === 'menor' ? Number(r.valor) : Number(anomaliaDe(r, x) ?? NaN));
    return base.filter((r) => Number.isFinite(chave(r))).sort((a, b) => (ordem === 'maior' || ordem === 'acima' ? chave(b) - chave(a) : chave(a) - chave(b)));
  }, [dados.dados, ordem, x]);
  const topo = lista.slice(0, 50);

  if (!publicado) return <><h2 className="titulo-pagina">{t('Clima: rankings', 'Climate: rankings')}</h2><SemDados /></>;
  if (!x) return <><h2 className="titulo-pagina">{t('Clima: rankings', 'Climate: rankings')}</h2><Estado carregando={!erroCat} erro={erroCat} tentarNovamente={() => location.reload()} /></>;
  const rotuloOrdem: Record<Ordem, string> = {
    maior: t('Maior valor no ano', 'Highest value in the year'), menor: t('Menor valor no ano', 'Lowest value in the year'),
    acima: t('Mais acima da normal', 'Furthest above normal'), abaixo: t('Mais abaixo da normal', 'Furthest below normal'),
  };
  const fonte = fonteDe(x);
  const colunaAnomalia = x.relativa ? t('Variação', 'Change') : t('Diferença', 'Difference');
  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: rankings de municípios', 'Climate: municipality rankings')}</h2>
      <p className="subtitulo">{x.rotulo} {t(x.soma ? 'por município (soma do ano)' : 'por município (média do ano)', x.soma ? 'by municipality (sum for the year)' : 'by municipality (mean for the year)')} <Dica rotulo={t('Fonte', 'Source')}>{fonte}</Dica></p>
      <section className="cartao">
        <div className="filtros">
          <SeletorVariavel id="r-var" lista={variaveis} atual={x} definir={definir} />
          <div className="campo">
            <label htmlFor="r-ano">{t('Ano', 'Year')}</label>
            <select id="r-ano" value={ano ?? ''} onChange={(e) => definir({ ano: e.target.value })}>{anos.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          </div>
          <div className="campo">
            <label htmlFor="r-uf">UF</label>
            <select id="r-uf" value={uf} onChange={(e) => definir({ uf: e.target.value })}>
              <option value="">{t('Brasil', 'Brazil')}</option>{UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="r-ordem">{t('Ordenar por', 'Sort by')}</label>
            <select id="r-ordem" value={ordem} onChange={(e) => definir({ ordem: e.target.value })}>
              {(Object.keys(rotuloOrdem) as Ordem[]).map((o) => <option key={o} value={o}>{rotuloOrdem[o]}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={dados.carregando} erro={dados.erro} tentarNovamente={dados.recarregar}
          vazio={!dados.carregando && !lista.length && t('Sem dados para este ano e recorte.', 'No data for this year and scope.')} />
      </section>
      {topo.length > 0 && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h3>{x.rotulo} · {rotuloOrdem[ordem]} · {ano}{uf ? ` · ${uf}` : ''}</h3>
              <p className="desc">{t(`Os 50 primeiros de ${numero(lista.length)} municípios. A normal é ${periodo[0]}–${periodo[1]}. Município pequeno cobre poucas células da grade: leia com cautela.`,
                `Top 50 of ${numero(lista.length)} municipalities. The normal is ${periodo[0]}–${periodo[1]}. A small municipality covers few grid cells: read with caution.`)}</p>
            </div>
            <BotoesExportar nome={`clima_${x.codigo}_ranking_${ano}_${uf || 'BR'}`} obter={() => ({
              colunas: [t('Posição', 'Rank'), t('Município', 'Municipality'), 'UF', `${x.rotulo} (${x.unidade})`, `${t('Normal', 'Normal')} (${x.unidade})`, x.relativa ? t('Variação sobre a normal', 'Change from normal') : `${t('Diferença para a normal', 'Difference from normal')} (${x.unidade})`],
              linhas: lista.map((r, i) => [i + 1, texto(r.nome), texto(r.uf), num(r.valor), num(r.normal), anomaliaDe(r, x)]),
              metadados: [[t('Variável', 'Variable'), `${x.rotulo} (${x.unidade})`], [t('Ano', 'Year'), String(ano)], [t('Recorte', 'Scope'), uf || t('Brasil', 'Brazil')], [t('Ordenação', 'Sort'), rotuloOrdem[ordem]],
                [t('Normal', 'Normal'), `${periodo[0]}–${periodo[1]}`], [t('Fonte', 'Source'), fonte], [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]],
            })} />
          </div>
          <div className="rolagem">
            <table className="tabela-fixa">
              <thead><tr><th>#</th><th style={{ textAlign: 'left' }}>{t('Município', 'Municipality')}</th><th>UF</th><th>{x.unidade}</th><th>{t('Normal', 'Normal')}</th><th>{colunaAnomalia}</th></tr></thead>
              <tbody>{topo.map((r, i) => (
                <tr key={texto(r.cod)}><td>{i + 1}</td>
                  <td style={{ textAlign: 'left' }}><Link to={`/clima?cod=${texto(r.cod)}&uf=${texto(r.uf)}${x.codigo === 'chuva_mm' ? '' : `&variavel=${x.codigo}`}`}>{texto(r.nome)}</Link></td><td>{texto(r.uf)}</td>
                  <td>{semUnidade(num(r.valor), x.unidade)}</td><td>{semUnidade(num(r.normal), x.unidade)}</td><td>{anomaliaTxt(r, x)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

// ---------------- metodologia ----------------

export function ClimaMetodologia() {
  const { anos, ate, normal, processadoEm, geradoEm } = useMetaClima();
  const publicado = anos.length > 0;
  const [sp] = useSearchParams();
  const { lista } = useVariavel(sp, publicado);
  const era5 = lista.filter((x) => x.fonte.includes('ERA5'));
  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: fontes e metodologia', 'Climate: sources and methodology')}</h2>
      <section className="cartao texto">
        <h3>{t('Fontes', 'Sources')}</h3>
        <ul>
          <li><strong>CHIRPS v3</strong> (Climate Hazards Center, UC Santa Barbara): {t('chuva mensal estimada a partir de satélites e de estações de superfície, em grade de 0,05° (cerca de 5 km), de 1981 em diante. É a fonte da chuva neste painel', 'monthly rainfall estimated from satellites and surface stations, on a 0.05° grid (about 5 km), from 1981 onwards. It is the rainfall source in this panel')}.</li>
          <li><strong>ERA5-Land</strong> (Copernicus Climate Change Service / ECMWF): {t('reanálise de variáveis de superfície, em grade de 0,1° (cerca de 9 km). O produto começa em 1950, mas aqui se publica de 1979 em diante: antes disso, no trecho retroativo anterior aos satélites, a série tem saltos sem sentido físico (a temperatura média do Brasil sobe 1,2 °C em 1961 e volta no ano seguinte)', 'land-surface reanalysis on a 0.1° grid (about 9 km). The product starts in 1950, but only 1979 onwards is published here: before that, in the back-extension stretch that precedes satellites, the series has jumps with no physical meaning (Brazil’s mean temperature rises 1.2 °C in 1961 and falls back the next year)')}.
            {era5.length ? ` ${t('Variáveis', 'Variables')}: ${era5.map((x) => `${minusculo(x.rotulo)} (${x.unidade})`).join(', ')}.` : ''}
            {publicado ? ` ${t('Publicado aqui', 'Published here')}: ${anos[0]}–${anos[1]}, ${t('com dados mensais até', 'monthly data up to')} ${ateTxt(ate)}.` : ''}</li>
        </ul>
        <h3>{t('Como o número de cada município é feito', 'How each municipality number is built')}</h3>
        <ul>
          <li>{t('A malha municipal do IBGE (2022) é sobreposta à grade. O valor do município é a média dos pixels que o cobrem, ponderada pela fração do município em cada pixel. Município menor que um pixel recebe o valor do pixel em que está.', 'The IBGE municipal boundaries (2022) are laid over the grid. The municipality value is the mean of the pixels that cover it, weighted by the share of the municipality in each pixel. A municipality smaller than a pixel gets the value of the pixel it is in.')}</li>
          <li>{t('Brasil e UF são médias dos municípios ponderadas pela área, não pela população.', 'Brazil and state values are municipality means weighted by area, not by population.')}</li>
          <li>{t(`O ano resume os 12 meses: soma para chuva e evaporação, média para as demais variáveis; só entra quando os 12 meses existem (o ano em curso fica de fora do gráfico anual). A normal é a média de ${normal[0]} a ${normal[1]}, o período de referência usual da Organização Meteorológica Mundial. A comparação com a normal é relativa (%) para chuva e evaporação, e uma diferença na própria unidade para temperatura, umidade do solo e radiação.`,
            `The year summarises the 12 months: a sum for rainfall and evaporation, a mean for the other variables; it only counts when all 12 months exist (the current year is left out of the annual chart). The normal is the ${normal[0]}–${normal[1]} mean, the usual World Meteorological Organization reference period. The comparison with the normal is relative (%) for rainfall and evaporation, and a difference in the variable’s own unit for temperature, soil moisture and radiation.`)}</li>
          <li>{t('No ERA5-Land, a evaporação vem em metros de água por dia e é convertida em milímetros no mês (valor do dia multiplicado pelos dias do mês); a radiação, em joules por m² por dia, vira watts por m² médios. Temperatura e ponto de orvalho vêm em kelvin e são convertidos para °C.', 'In ERA5-Land, evaporation comes as metres of water per day and is converted to millimetres per month (daily value times the days of the month); radiation, in joules per m² per day, becomes mean watts per m². Temperature and dew point come in kelvin and are converted to °C.')}</li>
        </ul>
        <h3>{t('Limites, para ler com cautela', 'Limits: read with caution')}</h3>
        <ul>
          <li>{t('Chuva por satélite é uma estimativa, não uma medição no município. Onde há poucas estações (Amazônia, interior do Nordeste) o erro é maior, e é maior em meses isolados do que em totais anuais ou de vários anos.', 'Satellite rainfall is an estimate, not a measurement in the municipality. Where stations are few (Amazon, interior Northeast) the error is larger, and it is larger for single months than for annual or multi-year totals.')}</li>
          <li>{t('O ERA5-Land é uma reanálise: um modelo de superfície alimentado pela atmosfera do ERA5, e não medições de estação. Temperatura e radiação são bem representadas em escala mensal; a evaporação e a umidade do solo dependem do modelo e têm erro maior, e devem ser lidas como tendência e comparação entre lugares, não como valor exato.', 'ERA5-Land is a reanalysis: a land-surface model driven by the ERA5 atmosphere, not station measurements. Temperature and radiation are well represented at monthly scale; evaporation and soil moisture depend on the model and have larger error, so read them as trends and comparisons between places, not as exact values.')}</li>
          <li>{t('No produto mensal do ERA5-Land, de setembro de 2022 a fevereiro de 2024, a evaporação e a radiação vêm com cerca de um terço do valor esperado, em todo o Brasil. Esses meses foram retirados das duas variáveis, e por isso os anos de 2022, 2023 e 2024 ficam sem total anual delas. Temperatura, ponto de orvalho e umidade do solo não são afetados.', 'In the ERA5-Land monthly product, from September 2022 to February 2024, evaporation and radiation come at about a third of the expected value, across Brazil. Those months were removed from both variables, so 2022, 2023 and 2024 have no annual total for them. Temperature, dew point and soil moisture are not affected.')}</li>
          <li>{t('A grade mistura o município com o entorno: em município pequeno ou de relevo acidentado a média pode refletir a vizinhança (principalmente nos 9 km do ERA5-Land); em município enorme, a média esconde diferenças internas.', 'The grid blends the municipality with its surroundings: in a small or rugged municipality the mean may reflect the neighbourhood (especially at ERA5-Land’s 9 km); in a huge one, it hides internal differences.')}</li>
          <li>{t('O ERA5-Land só tem pixels de terra: município litorâneo ou insular sem pixel de terra próprio usa o pixel de terra mais próximo, se estiver a cerca de 28 km ou menos; senão fica sem dado. A chuva do CHIRPS não cobre Fernando de Noronha e Trindade.', 'ERA5-Land only has land pixels: a coastal or island municipality without a land pixel of its own uses the nearest land pixel if it is about 28 km away or less; otherwise it has no data. CHIRPS rainfall does not cover Fernando de Noronha and Trindade.')}</li>
          <li>{t('Os meses mais recentes de ambas as fontes são preliminares e podem ser revisados.', 'The most recent months of both sources are preliminary and may be revised.')}</li>
          <li>{t('É clima físico, não impacto: um número de um ano não diz, sozinho, nada sobre seca, safra ou enchente.', 'This is physical climate, not impact: a single year’s number says nothing about drought, harvest or flood.')}</li>
        </ul>
        <p className="nota-base">{t('Versão da base', 'Data version')}: {geradoEm} · {t('processado em', 'processed on')} {processadoEm ?? '–'}</p>
      </section>
    </>
  );
}
