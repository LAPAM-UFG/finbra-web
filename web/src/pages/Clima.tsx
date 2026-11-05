import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { useDados } from '../contexto';
import { numero, numero1 } from '../format';
import { local, t } from '../idioma';
import { UFS } from '../munic_comum';

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const fonteClima = () => t(
  'CHIRPS v3 (Climate Hazards Center, UC Santa Barbara): chuva estimada por satélite e estações, grade de 0,05° (cerca de 5 km). Média dentro de cada município pela malha municipal de 2022 do IBGE. Processamento: LAPAM/UFG',
  'CHIRPS v3 (Climate Hazards Center, UC Santa Barbara): rainfall estimated from satellites and stations, 0.05° grid (about 5 km). Averaged inside each municipality using the IBGE 2022 municipal boundaries. Processing: LAPAM/UFG',
);

const mm = (v: number | null | undefined) => (v === null || v === undefined ? '–' : `${numero(Math.round(v))} mm`);
/** Variação relativa (fração) com sinal: +12,3% / −5,0%. */
const variacao = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '–'
  : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toLocaleString(local(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const mesCurto = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString(local(), { month: 'short' }).replace('.', '');

/** Escolhas da página no endereço: UF, município e ano. Nada vem dos filtros de outros painéis. */
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

const SemDados = () => <p className="vazio">{t('Os dados de clima ainda não foram publicados.', 'Climate data have not been published yet.')}</p>;

const ateTxt = (ate?: number) => (ate ? `${String(ate % 100).padStart(2, '0')}/${Math.floor(ate / 100)}` : '–');

// ---------------- visão geral ----------------

export function ClimaVisaoGeral() {
  const { sp, uf, definir } = useEscolhas();
  const { anos: anosMeta, ate, normal: periodo, geradoEm } = useMetaClima();
  const lugares = useApi<Linha[]>(anosMeta.length ? 'clima_lugares' : null, { uf });
  const cod = lugares.dados?.some((r) => String(r.cod) === sp.get('cod')) ? Number(sp.get('cod')) : null;
  const lugar = (lugares.dados ?? []).find((r) => num(r.cod) === cod);
  const escopo = lugar ? `${texto(lugar.nome)} (${texto(lugar.uf)})` : uf ? t(`Estado ${uf}`, `State ${uf}`) : t('Brasil', 'Brazil');
  const params = { cod, uf };
  const anual = useApi<Linha[]>(anosMeta.length ? 'clima_anual' : null, params);
  const mensal = useApi<Linha[]>(anosMeta.length ? 'clima_mensal' : null, params);
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

  if (!anosMeta.length) return <><h2 className="titulo-pagina">{t('Clima', 'Climate')}</h2><SemDados /></>;

  const exportarAnual = () => ({
    colunas: [t('Ano', 'Year'), t('Chuva (mm)', 'Rainfall (mm)'), t('Normal (mm)', 'Normal (mm)'), t('Variação sobre a normal', 'Change from normal')],
    linhas: serie.map((r) => [Number(r.ano), num(r.valor), num(r.normal), num(r.anomalia_pct)]),
    metadados: [[t('Recorte', 'Scope'), escopo], [t('Normal', 'Normal'), `${periodo[0]}–${periodo[1]}`],
      [t('Anos', 'Years'), t('só anos com os 12 meses', 'only years with all 12 months')], [t('Fonte', 'Source'), fonteClima()],
      [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]] as [string, string][],
  });
  const exportarMensal = () => ({
    colunas: [t('Ano', 'Year'), t('Mês', 'Month'), t('Chuva (mm)', 'Rainfall (mm)'), t('Normal do mês (mm)', 'Monthly normal (mm)')],
    linhas: mesesDoMensal.map((r) => [Number(r.ano), Number(r.mes), num(r.valor), num(r.normal)]),
    metadados: [[t('Recorte', 'Scope'), escopo], [t('Normal', 'Normal'), `${periodo[0]}–${periodo[1]}`], [t('Fonte', 'Source'), fonteClima()],
      [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]] as [string, string][],
  });

  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: chuva por município', 'Climate: rainfall by municipality')}</h2>
      <p className="subtitulo">{escopo} <Dica rotulo={t('Fonte', 'Source')}>{fonteClima()}</Dica></p>
      <section className="cartao">
        <div className="filtros">
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
            <Kpi rotulo={t(`Chuva em ${ultimo?.ano}`, `Rainfall in ${ultimo?.ano}`)} valor={mm(num(ultimo?.valor))}
              nota={t('último ano com os 12 meses', 'latest year with all 12 months')} />
            <Kpi rotulo={t('Normal anual', 'Annual normal')} valor={mm(normal)} nota={`${periodo[0]}–${periodo[1]}`} />
            <Kpi rotulo={t('Último ano contra a normal', 'Latest year vs normal')} valor={variacao(num(ultimo?.anomalia_pct))}
              nota={normal ? t('diferença relativa à normal', 'relative to the normal') : t('sem normal para este recorte', 'no normal for this scope')} />
            <Kpi rotulo={t('Mais chuvoso · mais seco', 'Wettest · driest')} valor={`${maior?.ano} · ${menor?.ano}`}
              nota={`${mm(num(maior?.valor))} · ${mm(num(menor?.valor))}`} />
          </div>
          <CartaoGrafico titulo={t('Chuva por ano', 'Rainfall per year')}
            desc={t(`${escopo}, soma dos 12 meses; a segunda linha é a normal ${periodo[0]}–${periodo[1]}. Só entram anos completos.`, `${escopo}, sum of the 12 months; the second line is the ${periodo[0]}–${periodo[1]} normal. Only complete years.`)}
            acoes={<BotoesExportar nome={`clima_anual_${cod ?? (uf || 'BR')}`} obter={exportarAnual} />}
            tabela={<div className="rolagem"><table><thead><tr><th>{t('Ano', 'Year')}</th><th>mm</th><th>{t('Normal', 'Normal')}</th><th>{t('Variação', 'Change')}</th></tr></thead>
              <tbody>{[...serie].reverse().map((r) => <tr key={texto(r.ano)}><td>{texto(r.ano)}</td><td>{numero(Math.round(Number(r.valor)))}</td><td>{numero(Math.round(Number(r.normal)))}</td><td>{variacao(num(r.anomalia_pct))}</td></tr>)}</tbody></table></div>}>
            <Grafico nome="clima_anual" opcao={linhas(anos, [
              { nome: t('Chuva no ano (mm)', 'Rainfall in the year (mm)'), valores: serie.map((r) => num(r.valor)) },
              { nome: t('Normal (mm)', 'Normal (mm)'), valores: serie.map(() => normal) },
            ], (v) => numero(Math.round(v)))} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Quanto choveu em relação à normal', 'Rainfall relative to the normal')}
            desc={t('Diferença percentual do ano sobre a normal anual. Acima de zero: ano mais chuvoso que a normal.', 'Percentage difference of the year from the annual normal. Above zero: wetter than normal.')}>
            <Grafico nome="clima_anomalia" altura={260}
              opcao={linhas(anos, [{ nome: t('Variação sobre a normal', 'Change from normal'), valores: serie.map((r) => num(r.anomalia_pct)) }], (v) => variacao(v))} />
          </CartaoGrafico>
        </>
      )}
      <Estado carregando={mensal.carregando} erro={mensal.erro} tentarNovamente={mensal.recarregar} />
      {mesesCom > 0 && (
        <CartaoGrafico titulo={t(`Chuva mês a mês em ${ano}`, `Rainfall month by month in ${ano}`)}
          desc={t(`${escopo}, contra a normal de cada mês (${periodo[0]}–${periodo[1]}). Dados mensais até ${ateTxt(ate)}.`, `${escopo}, against the normal of each month (${periodo[0]}–${periodo[1]}). Monthly data up to ${ateTxt(ate)}.`)}
          acoes={<BotoesExportar nome={`clima_mensal_${cod ?? (uf || 'BR')}`} obter={exportarMensal} />}
          tabela={<div className="rolagem"><table><thead><tr><th>{t('Mês', 'Month')}</th><th>mm</th><th>{t('Normal do mês', 'Monthly normal')}</th><th>{t('Variação', 'Change')}</th></tr></thead>
            <tbody>{meses.filter((m) => valoresMes(m) !== null).map((m) => <tr key={m}><td>{mesCurto(m)}</td><td>{numero1(valoresMes(m))}</td><td>{numero1(normalMes(m))}</td>
              <td>{normalMes(m) ? variacao(Number(valoresMes(m)) / Number(normalMes(m)) - 1) : '–'}</td></tr>)}</tbody></table></div>}>
          <Grafico nome="clima_mensal" opcao={linhas(meses.map(mesCurto), [
            { nome: t(`Chuva em ${ano} (mm)`, `Rainfall in ${ano} (mm)`), valores: meses.map(valoresMes) },
            { nome: t('Normal do mês (mm)', 'Monthly normal (mm)'), valores: meses.map(normalMes) },
          ], (v) => numero(Math.round(v)))} />
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
  const anos = useMemo(() => {
    const [a, b] = [anosMeta[0], anosMeta[1]];
    return a && b ? Array.from({ length: b - a + 1 }, (_, i) => b - i) : [];
  }, [anosMeta]);
  // o último ano da série pode ter menos de 12 meses (não entra no anual): o ano padrão é o mais recente com dado
  const pedido = Number(sp.get('ano'));
  const ano = anos.includes(pedido) ? pedido : anos[1] ?? anos[0];
  const ordem = (['maior', 'menor', 'acima', 'abaixo'] as Ordem[]).find((o) => o === sp.get('ordem')) ?? 'maior';
  const dados = useApi<Linha[]>(anosMeta.length && ano ? 'clima_ranking' : null, { ano, uf });
  const lista = useMemo(() => {
    const base = (dados.dados ?? []).filter((r) => num(r.valor) !== null);
    const chave = (r: Linha) => (ordem === 'maior' || ordem === 'menor' ? Number(r.valor) : Number(r.anomalia_pct ?? NaN));
    return base.filter((r) => Number.isFinite(chave(r))).sort((a, b) => (ordem === 'maior' || ordem === 'acima' ? chave(b) - chave(a) : chave(a) - chave(b)));
  }, [dados.dados, ordem]);
  const topo = lista.slice(0, 50);

  if (!anosMeta.length) return <><h2 className="titulo-pagina">{t('Clima: rankings', 'Climate: rankings')}</h2><SemDados /></>;
  const rotuloOrdem: Record<Ordem, string> = {
    maior: t('Mais chuva no ano (mm)', 'Most rainfall in the year (mm)'), menor: t('Menos chuva no ano (mm)', 'Least rainfall in the year (mm)'),
    acima: t('Mais acima da normal', 'Furthest above normal'), abaixo: t('Mais abaixo da normal', 'Furthest below normal'),
  };
  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: rankings de municípios', 'Climate: municipality rankings')}</h2>
      <p className="subtitulo">{t('Chuva anual por município', 'Annual rainfall by municipality')} <Dica rotulo={t('Fonte', 'Source')}>{fonteClima()}</Dica></p>
      <section className="cartao">
        <div className="filtros">
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
              <h3>{rotuloOrdem[ordem]} · {ano}{uf ? ` · ${uf}` : ''}</h3>
              <p className="desc">{t(`Os 50 primeiros de ${numero(lista.length)} municípios. A normal é ${periodo[0]}–${periodo[1]}. Município pequeno pega poucos pixels de 5 km: leia com cautela.`, `Top 50 of ${numero(lista.length)} municipalities. The normal is ${periodo[0]}–${periodo[1]}. A small municipality covers few 5 km pixels: read with caution.`)}</p>
            </div>
            <BotoesExportar nome={`clima_ranking_${ano}_${uf || 'BR'}`} obter={() => ({
              colunas: [t('Posição', 'Rank'), t('Município', 'Municipality'), 'UF', t('Chuva no ano (mm)', 'Rainfall in the year (mm)'), t('Normal (mm)', 'Normal (mm)'), t('Variação sobre a normal', 'Change from normal')],
              linhas: lista.map((r, i) => [i + 1, texto(r.nome), texto(r.uf), num(r.valor), num(r.normal), num(r.anomalia_pct)]),
              metadados: [[t('Ano', 'Year'), String(ano)], [t('Recorte', 'Scope'), uf || t('Brasil', 'Brazil')], [t('Ordenação', 'Sort'), rotuloOrdem[ordem]],
                [t('Normal', 'Normal'), `${periodo[0]}–${periodo[1]}`], [t('Fonte', 'Source'), fonteClima()], [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]],
            })} />
          </div>
          <div className="rolagem">
            <table className="tabela-fixa">
              <thead><tr><th>#</th><th style={{ textAlign: 'left' }}>{t('Município', 'Municipality')}</th><th>UF</th><th>{t('Chuva (mm)', 'Rainfall (mm)')}</th><th>{t('Normal (mm)', 'Normal (mm)')}</th><th>{t('Variação', 'Change')}</th></tr></thead>
              <tbody>{topo.map((r, i) => (
                <tr key={texto(r.cod)}><td>{i + 1}</td>
                  <td style={{ textAlign: 'left' }}><Link to={`/clima?cod=${texto(r.cod)}&uf=${texto(r.uf)}`}>{texto(r.nome)}</Link></td><td>{texto(r.uf)}</td>
                  <td>{numero(Math.round(Number(r.valor)))}</td><td>{numero(Math.round(Number(r.normal)))}</td><td>{variacao(num(r.anomalia_pct))}</td></tr>
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
  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: fontes e metodologia', 'Climate: sources and methodology')}</h2>
      <section className="cartao texto">
        <h3>{t('Fonte', 'Source')}</h3>
        <ul>
          <li><strong>CHIRPS v3</strong> (Climate Hazards Center, UC Santa Barbara): {t('chuva mensal estimada a partir de satélites e de estações de superfície, em grade de 0,05° (cerca de 5 km), de 1981 em diante', 'monthly rainfall estimated from satellites and surface stations, on a 0.05° grid (about 5 km), from 1981 onwards')}.
            {anos.length ? ` ${t('Publicado aqui', 'Published here')}: ${anos[0]}–${anos[1]}, ${t('com dados mensais até', 'monthly data up to')} ${ateTxt(ate)}.` : ''}</li>
        </ul>
        <h3>{t('Como o número de cada município é feito', 'How each municipality number is built')}</h3>
        <ul>
          <li>{t('A malha municipal do IBGE (2022) é sobreposta à grade. O valor do município é a média da chuva dos pixels que o cobrem, ponderada pela fração do município em cada pixel. Município menor que um pixel recebe o valor do pixel em que está.', 'The IBGE municipal boundaries (2022) are laid over the grid. The municipality value is the mean rainfall of the pixels that cover it, weighted by the share of the municipality in each pixel. A municipality smaller than a pixel gets the value of the pixel it is in.')}</li>
          <li>{t('Brasil e UF são médias dos municípios ponderadas pela área, não pela população.', 'Brazil and state values are municipality means weighted by area, not by population.')}</li>
          <li>{t(`O ano é a soma dos 12 meses e só entra quando os 12 meses existem (o ano em curso fica de fora do gráfico anual). A normal é a média de ${normal[0]} a ${normal[1]}, o período de referência usual da Organização Meteorológica Mundial; a variação é a diferença relativa à normal.`, `The year is the sum of the 12 months and only counts when all 12 exist (the current year is left out of the annual chart). The normal is the ${normal[0]}–${normal[1]} mean, the usual World Meteorological Organization reference period; the change is the relative difference from the normal.`)}</li>
        </ul>
        <h3>{t('Limites, para ler com cautela', 'Limits: read with caution')}</h3>
        <ul>
          <li>{t('Chuva por satélite é uma estimativa, não uma medição no município. Onde há poucas estações (Amazônia, interior do Nordeste) o erro é maior, e é maior em meses isolados do que em totais anuais ou de vários anos.', 'Satellite rainfall is an estimate, not a measurement in the municipality. Where stations are few (Amazon, interior Northeast) the error is larger, and it is larger for single months than for annual or multi-year totals.')}</li>
          <li>{t('A grade de 5 km mistura o município com o entorno: em município pequeno ou de relevo acidentado a média pode refletir a vizinhança; em município enorme, a média esconde diferenças internas.', 'The 5 km grid blends the municipality with its surroundings: in a small or rugged municipality the mean may reflect the neighbourhood; in a huge one, it hides internal differences.')}</li>
          <li>{t('Fernando de Noronha fica fora da grade usada e não tem dados. Os meses mais recentes do CHIRPS são preliminares e podem ser revisados.', 'Fernando de Noronha is outside the grid used and has no data. The most recent CHIRPS months are preliminary and may be revised.')}</li>
          <li>{t('É clima físico, não impacto: a chuva de um ano não diz, sozinha, nada sobre seca, safra ou enchente.', 'This is physical climate, not impact: a year’s rainfall alone says nothing about drought, harvest or flood.')}</li>
          <li>{t('Temperatura e outras variáveis ainda não estão publicadas.', 'Temperature and other variables are not published yet.')}</li>
        </ul>
        <p className="nota-base">{t('Versão da base', 'Data version')}: {geradoEm} · {t('processado em', 'processed on')} {processadoEm ?? '–'}</p>
      </section>
    </>
  );
}
