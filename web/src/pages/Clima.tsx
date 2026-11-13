import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { CartaoGrafico, Grafico, linhas, mapaCalor } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { useDados } from '../contexto';
import type { ResumoClimaFonte } from '../dados';
import { numero } from '../format';
import { t } from '../idioma';
import {
  MEDIDAS, NORMAL_CLIMA, UFS_CLIMA, acumulados, anomaliaDoResumo, anomaliaParcial, anosCompletos, anosDaLacuna, buscaClima, buscarMunicipios, comUnidade, comparacaoTxt,
  diferencaTxt, faixaMeses, fraseHabitual, lerEscolhaClima, lerResumo, medidaDe, mesAnoTxt, mesCurto, mesLongo, montarMapaCalor, num, periodoDoAcumulado, posicoesCompetitivas,
  resolverAno, semUnidade, serieAnualContinua, tabelaAnualClima, tabelaMensalClima, tomDe, unidadeDiferenca, variacaoTxt, type EscolhaClima, type Medida, type ResumoClima, type Territorio,
} from '../clima_comum';

const texto = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const FONTE_CHIRPS = () => t(
  'CHIRPS v3 (Climate Hazards Center, UC Santa Barbara): chuva estimada por satélite e estações, grade de 0,05° (cerca de 5 km). Média dentro de cada município pela malha municipal de 2022 do IBGE. Processamento: LAPAM/UFG',
  'CHIRPS v3 (Climate Hazards Center, UC Santa Barbara): rainfall estimated from satellites and stations, 0.05° grid (about 5 km). Averaged inside each municipality using the IBGE 2022 municipal boundaries. Processing: LAPAM/UFG',
);
const FONTE_ERA5 = () => t(
  'ERA5-Land (Copernicus Climate Change Service / ECMWF): reanálise de variáveis de superfície, grade de 0,1° (cerca de 11 km), médias mensais. Média dentro de cada município pela malha municipal de 2022 do IBGE. Processamento: LAPAM/UFG',
  'ERA5-Land (Copernicus Climate Change Service / ECMWF): land-surface reanalysis, 0.1° grid (about 11 km), monthly means. Averaged inside each municipality using the IBGE 2022 municipal boundaries. Processing: LAPAM/UFG',
);
const fonteDe = (m: Medida) => (m.fonte === 'CHIRPS' ? FONTE_CHIRPS() : FONTE_ERA5());

/** "2022–2024" para anos seguidos; "2019, 2022–2024" quando há mais de um trecho. */
export function anosTxt(anos: number[]): string {
  const o = [...anos].sort((a, b) => a - b);
  const partes: string[] = [];
  for (let i = 0; i < o.length; ) {
    let j = i;
    while (j + 1 < o.length && o[j + 1] === o[j] + 1) j++;
    partes.push(j > i ? `${o[i]}–${o[j]}` : String(o[i]));
    i = j + 1;
  }
  return partes.join(', ');
}

/** Escolhas da página no endereço: variavel, uf, cod e ano. Nada vem dos filtros de outros painéis. */
function useEscolhaUrl() {
  const [sp, setSp] = useSearchParams();
  const definir = (mudancas: Record<string, string | null>) => {
    const novo = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null || v === '') novo.delete(k);
      else novo.set(k, v);
    }
    setSp(novo, { replace: true });
  };
  return { sp, definir };
}

function useMetaClima() {
  const { meta } = useDados();
  const f = meta.fontes.clima as { anos?: number[]; ate?: number; normal?: number[]; processado_em?: string } | undefined;
  return { anos: f?.anos ?? [], ate: f?.ate, normal: (f?.normal ?? NORMAL_CLIMA) as [number, number], processadoEm: f?.processado_em, geradoEm: meta.geradoEm };
}

function useTerritorios(ativo: boolean) {
  const r = useApi<Linha[]>(ativo ? 'clima_territorios' : null, {});
  const lista = useMemo<Territorio[] | null>(() => (r.dados ? r.dados.map((l) => ({ cod: Number(l.cod), nome: texto(l.nome), uf: texto(l.uf) })) : null), [r.dados]);
  return { lista, erro: r.erro, recarregar: r.recarregar };
}

const SemDados = () => <p className="vazio">{t('Os dados de clima ainda não foram publicados.', 'Climate data have not been published yet.')}</p>;

// ---------------- avisos da escolha (nunca troca o recorte em silêncio) ----------------

function Avisos({ escolha, definir }: { escolha: EscolhaClima; definir: (m: Record<string, string | null>) => void }) {
  const itens = escolha.avisos.map((a, i) => {
    switch (a.tipo) {
      case 'uf_invalida':
        return <div key={i} className="cl-aviso" role="status"><p>{t(`A UF “${a.valor}” não existe. Mostrando o Brasil inteiro.`, `The state “${a.valor}” does not exist. Showing the whole country.`)}</p>
          <button className="botao-leve" onClick={() => definir({ uf: null })}>{t('Limpar a UF do endereço', 'Clear the state from the address')}</button></div>;
      case 'uf_diverge':
        return <div key={i} className="cl-aviso" role="status"><p>{t(`${a.municipio} fica em ${a.uf}, não em ${a.valor}. O município vale mais que a UF do endereço.`, `${a.municipio} is in ${a.uf}, not in ${a.valor}. The municipality takes precedence over the state in the address.`)}</p></div>;
      case 'variavel_invalida':
        return <div key={i} className="cl-aviso" role="status"><p>{t(`A medida “${a.valor}” não existe. O detalhe abaixo mostra a chuva; escolha outra nos cartões.`, `The measure “${a.valor}” does not exist. The detail below shows rainfall; pick another on the cards.`)}</p>
          <button className="botao-leve" onClick={() => definir({ variavel: null })}>{t('Limpar do endereço', 'Clear from the address')}</button></div>;
      case 'ano_invalido':
        return <div key={i} className="cl-aviso" role="status"><p>{t(`O ano “${a.valor}” não é válido. Mostrando o ano mais recente do detalhe.`, `The year “${a.valor}” is not valid. Showing the latest year in the detail.`)}</p>
          <button className="botao-leve" onClick={() => definir({ ano: null })}>{t('Limpar o ano do endereço', 'Clear the year from the address')}</button></div>;
      default:
        return null;
    }
  });
  return <>{itens}</>;
}

/** Bloqueio: código sem município no cadastro, ou município sem nenhum dado de clima. Oferece caminhos explícitos, sem trocar sozinho. */
function SemRecorte({ titulo, texto: corpo, uf, definir }: { titulo: string; texto: string; uf: string; definir: (m: Record<string, string | null>) => void }) {
  return (
    <div className="cl-aviso forte" role="alert">
      <p><strong>{titulo}</strong></p>
      <p>{corpo}</p>
      <div className="acoes">
        {uf && <button className="botao-leve" onClick={() => definir({ cod: null })}>{t(`Ver o estado ${uf}`, `See the state ${uf}`)}</button>}
        <button className="botao-leve" onClick={() => definir({ cod: null, uf: null })}>{t('Ver o Brasil', 'See Brazil')}</button>
      </div>
    </div>
  );
}

// ---------------- filtros: UF e busca de município pelo nome ----------------

function Filtros({ escolha, territorios, definir }: { escolha: EscolhaClima; territorios: Territorio[] | null; definir: (m: Record<string, string | null>) => void }) {
  const [busca, setBusca] = useState('');
  const sugestoes = useMemo(() => (territorios ? buscarMunicipios(territorios, busca, escolha.uf) : []), [territorios, busca, escolha.uf]);
  return (
    <section className="cartao cl-filtros">
      <div className="filtros">
        <div className="campo">
          <label htmlFor="cl-uf">UF</label>
          <select id="cl-uf" value={escolha.uf} onChange={(e) => definir({ uf: e.target.value || null, cod: escolha.municipio && escolha.municipio.uf === e.target.value ? texto(escolha.cod) : null })}>
            <option value="">{t('Brasil', 'Brazil')}</option>{UFS_CLIMA.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div className="campo mp-busca">
          <label htmlFor="cl-mun">{t('Município', 'Municipality')}</label>
          <input id="cl-mun" value={busca} autoComplete="off" onChange={(e) => setBusca(e.target.value)} disabled={!territorios}
            placeholder={escolha.municipio ? `${escolha.municipio.nome} (${escolha.municipio.uf})` : escolha.uf ? t(`digite o nome (em ${escolha.uf})`, `type the name (in ${escolha.uf})`) : t('digite o nome', 'type the name')} />
          {busca.trim().length >= 2 && (
            <ul className="mp-sugestoes" aria-label={t('Municípios encontrados', 'Matching municipalities')}>
              {sugestoes.map((m) => (
                <li key={m.cod}><button type="button" onClick={() => { definir({ cod: String(m.cod), uf: m.uf }); setBusca(''); }}>{m.nome} ({m.uf})</button></li>
              ))}
              {!sugestoes.length && <li className="mp-sem">{t('Nenhum município com esse nome.', 'No municipality with that name.')}</li>}
            </ul>
          )}
          {escolha.cod !== null && <button type="button" className="limpar" onClick={() => definir({ cod: null })}>{escolha.uf ? t('ver a UF inteira', 'see the whole state') : t('ver o Brasil', 'see Brazil')}</button>}
        </div>
      </div>
    </section>
  );
}

// ---------------- cartões das seis medidas ----------------

function CartaoMedida({ m, r, periodo, selecionado, aoSelecionar }: { m: Medida; r: ResumoClima | undefined; periodo: [number, number]; selecionado: boolean; aoSelecionar: () => void }) {
  const lacunas = anosDaLacuna(r);
  const anom = r ? anomaliaDoResumo(r, m.relativa) : null;
  const parcial = r && r.parcial_meses ? anomaliaParcial(r, m.relativa) : null;
  return (
    <article className={`cl-cartao${selecionado ? ' sel' : ''}`} onClick={aoSelecionar}>
      <h4>{m.nome()}</h4>
      <p className="fonte">{m.fonte === 'CHIRPS' ? 'CHIRPS v3' : 'ERA5-Land'} · {t('estimativa de grade, não estação', 'grid estimate, not a station')}</p>
      <p className="cl-nota">{m.ajuda()}</p>
      {!r || r.valor === null ? <p className="cl-nota">{t(`Sem dados de ${m.curto()} neste recorte.`, `No ${m.curto()} data for this scope.`)}</p> : (
        <>
          <p className="cl-valor"><strong>{comUnidade(r.valor, m.unidade)}</strong> {t('em', 'in')} {r.ano_ate} ({m.soma ? t('soma dos 12 meses', 'sum of 12 months') : t('média dos 12 meses', 'mean of 12 months')})</p>
          <p className={`cl-frase ${tomDe(anom)}`}>{fraseHabitual(anom, m.relativa, m.unidade)}</p>
          <p className="cl-num">{t('Habitual', 'Usual')} {periodo[0]}–{periodo[1]}: {comUnidade(r.normal, m.unidade)} · {comparacaoTxt(r.valor, r.normal, m.relativa, m.unidade)}</p>
          {r.parcial_meses && r.parcial_valor !== null && (
            <p className="cl-parcial"><strong>{t('Ano em curso, parcial', 'Current year, partial')}</strong> ({r.ano_ate + 1}, {faixaMeses(r.parcial_meses)}): {comUnidade(r.parcial_valor, m.unidade)};{' '}
              {t('habitual desses mesmos meses', 'usual for those same months')}: {comUnidade(r.parcial_normal, m.unidade)}; {fraseHabitual(parcial, m.relativa, m.unidade)}.{' '}
              {t('Não compare com o total do ano fechado.', 'Do not compare with the closed-year total.')}</p>
          )}
          {lacunas.length > 0 && <p className="cl-nota">{t(`Sem total anual em ${anosTxt(lacunas)}: meses excluídos por erro da fonte.`, `No annual total in ${anosTxt(lacunas)}: months excluded because of a source error.`)}</p>}
          <p className="cl-nota">{t('Dados mensais até', 'Monthly data up to')} {mesAnoTxt(r.ate)} · {t('desde', 'since')} {r.ano_de}</p>
        </>
      )}
      <button type="button" className="botao-leve ver" aria-pressed={selecionado} onClick={(e) => { e.stopPropagation(); aoSelecionar(); }}>
        {selecionado ? t('Detalhe aberto abaixo', 'Detail open below') : t('Ver o detalhe', 'See the detail')}
      </button>
    </article>
  );
}

function AcumuladosChuva({ r, escopo, periodo }: { r: ResumoClima | undefined; escopo: string; periodo: [number, number] }) {
  const lista = acumulados(r);
  return (
    <section className="cartao">
      <div className="cabeca-cartao"><div>
        <h3>{t('Chuva acumulada nos últimos meses', 'Rainfall accumulated over the latest months')}</h3>
        <p className="desc">{t(`${escopo}. Soma da chuva (estimativa CHIRPS de grade, não de estação) nos 3, 6 e 12 meses que terminam em ${mesAnoTxt(r?.acum_fim)}, contra a soma das normais ${periodo[0]}–${periodo[1]} dos MESMOS meses. Só vale com todos os meses presentes: mês sem dado nunca vira zero.`,
          `${escopo}. Rainfall total (CHIRPS grid estimate, not a station) over the 3, 6 and 12 months ending ${mesAnoTxt(r?.acum_fim)}, against the sum of the ${periodo[0]}–${periodo[1]} normals of the SAME months. Valid only with every month present: a missing month never becomes zero.`)}</p>
      </div></div>
      {!lista.length ? <p className="vazio">{t('Sem chuva neste recorte.', 'No rainfall for this scope.')}</p> : (
        <div className="cl-acum">
          {lista.map((a) => (
            <div key={a.meses}>
              <h4>{t(`Últimos ${a.meses} meses`, `Latest ${a.meses} months`)} · {periodoDoAcumulado(a.fim, a.meses)}</h4>
              {a.completo ? (
                <>
                  <p className="cl-valor"><strong>{comUnidade(a.valor, 'mm')}</strong></p>
                  <p className={`cl-frase ${tomDe(a.variacao)}`}>{fraseHabitual(a.variacao, true, 'mm')}</p>
                  <p className="cl-num">{t('Normal dos mesmos meses', 'Normal for the same months')}: {comUnidade(a.normal, 'mm')} · {comparacaoTxt(a.valor, a.normal, true, 'mm')}</p>
                  <p className="cl-nota">{t(`Cobertura: ${a.cobertura} de ${a.meses} meses`, `Coverage: ${a.cobertura} of ${a.meses} months`)}</p>
                </>
              ) : (
                <p className="cl-nota">{t(`Indisponível: só ${a.cobertura} de ${a.meses} meses têm dado. Ausência não é chuva zero.`, `Unavailable: only ${a.cobertura} of ${a.meses} months have data. Missing is not zero rainfall.`)}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------- detalhe de uma medida (carregado depois dos cartões) ----------------

const PALETAS: Record<string, [string, string, string]> = {
  quente: ['#2166ac', '#f0efe9', '#b2182b'], // acima do habitual = vermelho (temperatura, radiação, evaporação)
  umido: ['#b35806', '#f0efe9', '#2166ac'], // acima do habitual = azul (chuva, ponto de orvalho, solo)
};
const paletaDe = (m: Medida): [string, string, string] => (['temperatura_c', 'radiacao_wm2', 'evap_mm'].includes(m.codigo) ? PALETAS.quente : PALETAS.umido);

function Detalhe({ m, escolha, escopo, r, periodo, geradoEm, definir }: {
  m: Medida; escolha: EscolhaClima; escopo: string; r: ResumoClima | undefined; periodo: [number, number]; geradoEm: string; definir: (x: Record<string, string | null>) => void;
}) {
  const params = { cod: escolha.cod, uf: escolha.uf, variavel: m.codigo };
  const anual = useApi<Linha[]>('clima_anual', params);
  const mensal = useApi<Linha[]>('clima_mensal', params);
  const fonte = fonteDe(m);
  const rotMedida = m.nome();
  const rot = (s: string) => `${s} (${m.unidade})`;
  const fmt = (n: number) => semUnidade(n, m.unidade);

  const anos = useMemo(() => (anual.dados ?? []).filter((l) => num(l.valor) !== null).map((l) => ({
    ano: Number(l.ano), valor: num(l.valor), normal: num(l.normal), anomalia: num(m.relativa ? l.anomalia_pct : l.anomalia),
  })), [anual.dados, m.relativa]);
  const de = r?.ano_de ?? anos[0]?.ano;
  const ate = r?.ano_ate ?? anos.at(-1)?.ano;
  const eixo = useMemo(() => (de !== undefined && ate !== undefined ? serieAnualContinua(anos, de, ate) : []), [anos, de, ate]);
  const normalAnual = anos.find((a) => a.normal !== null)?.normal ?? null;
  const lacunas = anosDaLacuna(r);

  const mesesLinhas = useMemo(() => (mensal.dados ?? []).map((l) => ({ ano: Number(l.ano), mes: Number(l.mes), valor: num(l.valor), normal: num(l.normal) })), [mensal.dados]);
  const anosMensais = useMemo(() => [...new Set(mesesLinhas.map((l) => l.ano))].sort((a, b) => b - a), [mesesLinhas]);
  const sel = resolverAno(escolha.ano, anosMensais, anosMensais[0] ?? null);
  const ultimoMes = r?.ate ?? (mesesLinhas.length ? Math.max(...mesesLinhas.map((l) => l.ano * 100 + l.mes)) : null);
  const doAno = mesesLinhas.filter((l) => l.ano === sel.ano);
  const valorMes = (mes: number) => doAno.find((l) => l.mes === mes)?.valor ?? null;
  // A referência do mês existe mesmo quando o ano selecionado ainda não publicou aquele mês.
  const normalMes = (mes: number) => mesesLinhas.find((l) => l.mes === mes && l.normal !== null)?.normal ?? null;
  const mesesVisiveis = Array.from({ length: 12 }, (_, i) => i + 1).filter((mes) => sel.ano !== null && (ultimoMes === null || sel.ano * 100 + mes <= ultimoMes));
  const parcialAno = sel.ano !== null && ate !== undefined && sel.ano > ate;

  const calor = useMemo(() => montarMapaCalor(mesesLinhas, m.relativa, ultimoMes), [mesesLinhas, m.relativa, ultimoMes]);
  const unidadeAnomalia = m.relativa ? '%' : m.unidade === '%' ? 'p.p.' : m.unidade;
  const escalaTxt = (v: number) => (m.relativa ? `${v >= 0 ? '+' : '−'}${semUnidade(Math.abs(v) * 100, '°C')}%` : `${v >= 0 ? '+' : '−'}${semUnidade(Math.abs(v), '°C')} ${unidadeAnomalia}`);
  const paleta = paletaDe(m);
  const dicaCalor = (mes: number, ai: number) => {
    const c = calor.celulas.find((x) => x.m === mes && x.a === ai);
    if (!c) return '';
    const cab = `<strong>${mesLongo(c.mes)}/${c.ano}</strong><br/>`;
    if (c.tipo === 'lacuna') return `${cab}${t('Sem dado neste mês (lacuna na fonte): não é zero.', 'No data this month (gap in the source): not zero.')}`;
    return `${cab}${rotMedida}: ${comUnidade(c.valor, m.unidade)}<br/>${t('Habitual do mês', 'Usual for the month')}: ${comUnidade(c.normal, m.unidade)}<br/>${c.anomalia === null ? t('Sem normal para comparar', 'No normal to compare with') : `${t('Desvio', 'Deviation')}: ${comparacaoTxt(c.valor, c.normal, m.relativa, m.unidade)}`}`;
  };

  const metaBase = (): [string, string][] => [[t('Recorte', 'Scope'), escopo], [t('Medida', 'Measure'), `${rotMedida} (${m.unidade})`], [t('Normal', 'Normal'), `${periodo[0]}–${periodo[1]}`],
    [t('Fonte', 'Source'), fonte], [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href], [t('Exportado em', 'Exported on'), new Date().toISOString()]];
  const exportarAnual = () => tabelaAnualClima({ medida: m, rotuloMedida: rotMedida, anos, de: de ?? 0, ate: ate ?? 0, metadados: metaBase() });
  const exportarMensal = (escopoExp: 'ano' | 'serie') => () => tabelaMensalClima({ medida: m, rotuloMedida: rotMedida, linhas: mesesLinhas, escopo: escopoExp, ano: sel.ano, ate: ultimoMes, metadados: metaBase() });
  const nomeBase = `clima_${m.codigo}_${escolha.cod ?? (escolha.uf || 'BR')}`;

  return (
    <>
      <h3 className="titulo-secao">{t('Detalhe', 'Detail')}: {rotMedida} · {escopo}</h3>
      <Estado carregando={anual.carregando} erro={anual.erro} tentarNovamente={anual.recarregar} vazio={!anual.carregando && !eixo.length && t('Sem série anual neste recorte.', 'No annual series for this scope.')} />
      {eixo.length > 0 && (
        <>
          <CartaoGrafico titulo={t(`${rotMedida} por ano`, `${rotMedida} per year`)}
            desc={t(`${escopo}: ${m.soma ? 'soma' : 'média'} dos 12 meses; a segunda linha é a normal ${periodo[0]}–${periodo[1]}. Só entram anos completos; anos sem total ficam em branco no eixo.`,
              `${escopo}: ${m.soma ? 'sum' : 'mean'} of the 12 months; the second line is the ${periodo[0]}–${periodo[1]} normal. Only complete years count; years without a total stay blank on the axis.`)}
            acoes={<BotoesExportar nome={`${nomeBase}_anual`} obter={exportarAnual} />}
            tabela={<table><thead><tr><th>{t('Ano', 'Year')}</th><th>{m.unidade}</th><th>{t('Normal', 'Normal')}</th><th>{t('Comparação com o habitual', 'Comparison with usual')}</th></tr></thead>
              <tbody>{[...eixo].reverse().map(({ ano, linha }) => <tr key={ano}><td>{ano}</td>
                {linha ? <><td>{fmt(Number(linha.valor))}</td><td>{fmt(Number(linha.normal))}</td><td>{comparacaoTxt(linha.valor, linha.normal, m.relativa, m.unidade)}</td></>
                  : <td colSpan={3}>{t('sem total anual (meses ausentes na fonte)', 'no annual total (months missing in the source)')}</td>}</tr>)}</tbody></table>}>
            {lacunas.length > 0 && <p className="cl-aviso">{t(`Sem total anual em ${anosTxt(lacunas)}: a fonte (ERA5-Land) trouxe valores incorretos de setembro/2022 a fevereiro/2024 para evaporação e radiação, e esses meses foram retirados em vez de preenchidos.`,
              `No annual total in ${anosTxt(lacunas)}: the source (ERA5-Land) carried incorrect evaporation and radiation values from September 2022 to February 2024, and those months were removed rather than filled.`)}</p>}
            <Grafico nome="clima_anual" descricao={t(`Gráfico anual de ${rotMedida}, ${de}–${ate}`, `Annual chart of ${rotMedida}, ${de}–${ate}`)}
              opcao={linhas(eixo.map((e) => e.ano), [
                { nome: rot(rotMedida), valores: eixo.map((e) => (e.linha ? num(e.linha.valor) : null)) },
                { nome: rot(t('Normal', 'Normal')), valores: eixo.map((e) => (e.linha ? normalAnual : null)) },
              ], fmt, [], !m.relativa)} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Em relação ao habitual', 'Relative to the usual')}
            desc={m.relativa ? t('Variação percentual do ano sobre a normal anual. Acima de zero: acima do habitual.', 'Percentage change of the year from the annual normal. Above zero: above usual.')
              : t(`Diferença do ano para a normal anual, em ${m.unidade === '%' ? 'pontos percentuais (p.p.)' : m.unidade}. Acima de zero: acima do habitual.`, `Difference of the year from the annual normal, in ${m.unidade === '%' ? 'percentage points (p.p.)' : m.unidade}. Above zero: above usual.`)}>
            <Grafico nome="clima_anomalia" altura={260} descricao={t(`Desvio anual de ${rotMedida}`, `Annual deviation of ${rotMedida}`)}
              opcao={linhas(eixo.map((e) => e.ano), [{ nome: m.relativa ? t('Variação sobre a normal', 'Change from normal') : `${t('Diferença para a normal', 'Difference from normal')} (${unidadeDiferenca(m.unidade)})`,
                valores: eixo.map((e) => (e.linha ? e.linha.anomalia : null)) }],
              (n) => (m.relativa ? variacaoTxt(n) : diferencaTxt(n, m.unidade)))} />
          </CartaoGrafico>
        </>
      )}
      <Estado carregando={mensal.carregando} erro={mensal.erro} tentarNovamente={mensal.recarregar} />
      {anosMensais.length > 0 && (
        <section className="cartao">
          <div className="cabeca-cartao"><div>
            <h3>{t(`${rotMedida} mês a mês em ${sel.ano}`, `${rotMedida} month by month in ${sel.ano}`)}</h3>
            <p className="desc">{t(`${escopo}, contra o habitual de cada mês (${periodo[0]}–${periodo[1]}). Dados mensais até ${mesAnoTxt(ultimoMes)}.`, `${escopo}, against the usual for each month (${periodo[0]}–${periodo[1]}). Monthly data up to ${mesAnoTxt(ultimoMes)}.`)}</p>
          </div>
          <div className="campo">
            <label htmlFor="cl-ano">{t('Ano', 'Year')}</label>
            <select id="cl-ano" value={sel.ano ?? ''} onChange={(e) => definir({ ano: e.target.value })}>
              {sel.ausente && sel.ano !== null && <option value={sel.ano}>{sel.ano} ({t('sem dados', 'no data')})</option>}
              {anosMensais.map((a) => <option key={a} value={a}>{a}{ate !== undefined && a > ate ? ` (${t('parcial', 'partial')})` : ''}</option>)}
            </select>
          </div></div>
          {sel.ausente && sel.ano !== null && (
            <div className="cl-aviso forte" role="status">
              <p><strong>{t(`${rotMedida} não tem dados mensais em ${sel.ano} para este recorte.`, `${rotMedida} has no monthly data in ${sel.ano} for this scope.`)}</strong>{' '}
                {lacunas.includes(sel.ano) || (sel.ano >= 2022 && sel.ano <= 2024 && (m.codigo === 'evap_mm' || m.codigo === 'radiacao_wm2'))
                  ? t('Evaporação e radiação têm uma lacuna de setembro/2022 a fevereiro/2024 por erro da fonte; nada foi preenchido.', 'Evaporation and radiation have a gap from September 2022 to February 2024 because of a source error; nothing was filled in.') : ''}</p>
              <div className="acoes">{sel.sugestoes.map((a) => <button key={a} className="botao-leve" onClick={() => definir({ ano: String(a) })}>{t(`Ver ${a}`, `See ${a}`)}</button>)}</div>
            </div>
          )}
          {!sel.ausente && parcialAno && <p className="cl-aviso">{t(`${sel.ano} está em curso: só há dados até ${mesAnoTxt(ultimoMes)}. Não compare esta soma parcial com o total de um ano fechado.`, `${sel.ano} is under way: data only up to ${mesAnoTxt(ultimoMes)}. Do not compare this partial figure with a closed-year total.`)}</p>}
          {!sel.ausente && (
            <>
              <div className="cl-exportar">
                <span>{t('Exportar o mensal:', 'Export the monthly data:')}</span>
                <span>{t('ano exibido', 'year shown')} <BotoesExportar nome={`${nomeBase}_mensal_${sel.ano}`} obter={exportarMensal('ano')} /></span>
                <span>{t('série completa', 'full series')} <BotoesExportar nome={`${nomeBase}_mensal_serie`} obter={exportarMensal('serie')} /></span>
              </div>
              <Grafico nome="clima_mensal" descricao={t(`Gráfico mensal de ${rotMedida} em ${sel.ano}`, `Monthly chart of ${rotMedida} in ${sel.ano}`)}
                opcao={linhas(Array.from({ length: 12 }, (_, i) => mesCurto(i + 1)), [
                  { nome: rot(`${rotMedida} ${t('em', 'in')} ${sel.ano}`), valores: Array.from({ length: 12 }, (_, i) => valorMes(i + 1)) },
                  { nome: rot(t('Habitual do mês', 'Usual for the month')), valores: Array.from({ length: 12 }, (_, i) => normalMes(i + 1)) },
                ], fmt, [], !m.relativa)} />
              <div className="rolagem">
                <table><thead><tr><th>{t('Mês', 'Month')}</th><th>{m.unidade}</th><th>{t('Habitual', 'Usual')}</th><th>{t('Comparação com o habitual', 'Comparison with usual')}</th></tr></thead>
                  <tbody>{mesesVisiveis.map((mes) => <tr key={mes}><td>{mesCurto(mes)}</td>
                    {valorMes(mes) === null ? <td colSpan={3}>{t('sem dado (lacuna na fonte)', 'no data (gap in the source)')}</td>
                      : <><td>{semUnidade(valorMes(mes), m.unidade)}</td><td>{semUnidade(normalMes(mes), m.unidade)}</td><td>{comparacaoTxt(valorMes(mes), normalMes(mes), m.relativa, m.unidade)}</td></>}</tr>)}</tbody></table>
              </div>
            </>
          )}
        </section>
      )}
      {calor.celulas.length > 0 && (
        <CartaoGrafico titulo={t(`Mapa de calor: ${rotMedida}, ano por mês`, `Heat map: ${rotMedida}, year by month`)}
          desc={t(`Cada quadrado é um mês de ${calor.anos[0]} a ${calor.anos.at(-1)}. A cor mostra o desvio do habitual do mesmo mês (normal ${periodo[0]}–${periodo[1]}): ${m.relativa ? 'quantos % acima ou abaixo' : `quanto acima ou abaixo, em ${unidadeAnomalia}`}. Quadrado cinza: sem dado (lacuna), nunca zero.`,
            `Each square is one month from ${calor.anos[0]} to ${calor.anos.at(-1)}. The colour shows the deviation from the usual for the same month (${periodo[0]}–${periodo[1]} normal): ${m.relativa ? 'how many % above or below' : `how far above or below, in ${unidadeAnomalia}`}. Grey square: no data (gap), never zero.`)}
          tabela={<table className="cl-tabela-calor"><caption>{t('Desvio do habitual por mês', 'Deviation from usual by month')} ({m.relativa ? '%' : unidadeAnomalia})</caption>
            <thead><tr><th>{t('Ano', 'Year')}</th>{Array.from({ length: 12 }, (_, i) => <th key={i}>{mesCurto(i + 1)}</th>)}</tr></thead>
            <tbody>{[...calor.anos].reverse().map((ano) => <tr key={ano}><td>{ano}</td>{Array.from({ length: 12 }, (_, i) => {
              const c = calor.celulas.find((x) => x.ano === ano && x.mes === i + 1);
              return <td key={i}>{!c ? '' : c.tipo === 'lacuna' ? t('sem dado', 'no data') : c.anomalia === null ? t('sem normal', 'no normal') : m.relativa ? variacaoTxt(c.anomalia) : diferencaTxt(c.anomalia, m.unidade)}</td>;
            })}</tr>)}</tbody></table>}>
          <Grafico nome="clima_mapa_calor" altura={Math.max(280, calor.anos.length * 12 + 40)}
            descricao={t(`Mapa de calor do desvio de ${rotMedida}; os valores estão na opção Tabela`, `Heat map of the deviation of ${rotMedida}; values are in the Table option`)}
            opcao={mapaCalor({
              anos: calor.anos, meses: Array.from({ length: 12 }, (_, i) => mesCurto(i + 1)),
              dados: calor.celulas.filter((c) => c.tipo === 'dado' && c.anomalia !== null).map((c) => [c.m, c.a, Math.max(-calor.limite, Math.min(calor.limite, c.anomalia as number))]),
              vazios: calor.celulas.filter((c) => c.tipo === 'lacuna').map((c) => [c.m, c.a]), semNormal: calor.celulas.filter((c) => c.tipo === 'sem_normal').map((c) => [c.m, c.a]),
              limite: calor.limite, paleta, dica: dicaCalor, cinza: '#8c8c8c', cinzaSemNormal: '#c9c4a9',
            })} />
          <div className="cl-escala" style={{ background: `linear-gradient(90deg, ${paleta[0]}, ${paleta[1]}, ${paleta[2]})` }} aria-hidden="true" />
          <div className="cl-escala-rotulos" aria-hidden="true"><span>{escalaTxt(-calor.limite)}</span><span>{t('habitual', 'usual')}</span><span>{escalaTxt(calor.limite)}</span></div>
          <ul className="cl-legenda">
            <li><i style={{ background: paleta[0] }} />{t('abaixo do habitual', 'below usual')}</li><li><i style={{ background: paleta[1] }} />{t('perto do habitual', 'close to usual')}</li>
            <li><i style={{ background: paleta[2] }} />{t('acima do habitual', 'above usual')}</li><li><i style={{ background: '#8c8c8c' }} />{t(`sem dado (${calor.lacunas} meses)`, `no data (${calor.lacunas} months)`)}</li>
            {calor.semNormal > 0 && <li><i style={{ background: '#c9c4a9' }} />{t('sem normal para comparar', 'no normal to compare with')}</li>}
          </ul>
          <p className="cl-mini">{t('A cor satura nos valores mais extremos (95% dos meses cabem na escala); o valor exato está no texto ao passar o mouse ou na opção Tabela.', 'The colour saturates at the most extreme values (95% of months fit the scale); the exact value is in the tooltip or in the Table option.')}</p>
        </CartaoGrafico>
      )}
    </>
  );
}

/** Séries grandes só entram quando o usuário chega ao histórico ou pede uma medida/ano pelo endereço. */
function DetalheSobDemanda({ forcar, ...props }: Parameters<typeof Detalhe>[0] & { forcar: boolean }) {
  const alvo = useRef<HTMLDivElement>(null);
  const pedido = forcar || props.escolha.variavel !== null || props.escolha.ano !== null;
  const [visivel, setVisivel] = useState(pedido);
  useEffect(() => {
    if (pedido) setVisivel(true);
  }, [pedido]);
  useEffect(() => {
    if (visivel || !alvo.current) return;
    if (!('IntersectionObserver' in window)) { setVisivel(true); return; }
    const obs = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) { setVisivel(true); obs.disconnect(); }
    }, { rootMargin: '200px' });
    obs.observe(alvo.current);
    return () => obs.disconnect();
  }, [visivel]);
  return <div ref={alvo} id="cl-historico">
    {visivel ? <Detalhe {...props} /> : <section className="cartao" style={{ minHeight: 160 }}>
      <h3>{t('Histórico e mapa de calor', 'History and heat map')}</h3>
      <p className="desc">{t('Explore a série anual, os meses e a comparação com o habitual.', 'Explore the annual series, months and comparison with the usual.')}</p>
    </section>}
  </div>;
}

// ---------------- visão geral ----------------

export function ClimaVisaoGeral() {
  const [forcarDetalhe, setForcarDetalhe] = useState(false);
  const { sp, definir } = useEscolhaUrl();
  const { anos: anosMeta, normal: periodo, geradoEm } = useMetaClima();
  const publicado = anosMeta.length > 0;
  const terr = useTerritorios(publicado);
  const escolha = lerEscolhaClima(sp, terr.lista);
  const pronto = publicado && !escolha.bloqueio && !escolha.pendente;
  const resumo = useApi<ResumoClimaFonte>(pronto ? 'clima_painel' : null, { cod: escolha.cod, uf: escolha.uf });
  const porVar = useMemo(() => new Map((resumo.dados?.linhas ?? []).map(lerResumo).map((r) => [r.variavel, r])), [resumo.dados]);
  const semCobertura = escolha.cod !== null && !!resumo.dados && porVar.size === 0;
  const municipio = escolha.municipio;
  const escopo = municipio ? `${municipio.nome} (${municipio.uf})` : escolha.uf ? t(`Estado ${escolha.uf}`, `State ${escolha.uf}`) : t('Brasil', 'Brazil');
  const detalhe = medidaDe(escolha.variavel) ?? MEDIDAS[0];

  if (!publicado) return <><h2 className="titulo-pagina">{t('Clima', 'Climate')}</h2><SemDados /></>;
  const ref = porVar.get('chuva_mm') ?? [...porVar.values()][0];
  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: o que mudou em relação ao habitual', 'Climate: how it compares with the usual')}</h2>
      <p className="subtitulo">{escopo} · {t('habitual = média de', 'usual = average of')} {periodo[0]}–{periodo[1]} · {t('estimativas de grade (satélite e reanálise), não medições de estação', 'grid estimates (satellite and reanalysis), not station measurements')}</p>
      <Filtros escolha={escolha} territorios={terr.lista} definir={definir} />
      <Avisos escolha={escolha} definir={definir} />
      {terr.erro && <Estado erro={terr.erro} tentarNovamente={terr.recarregar} />}
      {escolha.bloqueio && (
        <SemRecorte titulo={t(`Código de município não encontrado: ${escolha.bloqueio.valor}`, `Municipality code not found: ${escolha.bloqueio.valor}`)}
          texto={t('Este endereço pede um município que não existe no cadastro. Nada foi trocado: escolha um município pela busca ou veja um recorte maior.', 'This address asks for a municipality that is not in the register. Nothing was swapped: pick a municipality in the search or see a larger scope.')}
          uf={escolha.uf} definir={definir} />
      )}
      {semCobertura && (
        <SemRecorte titulo={t(`${municipio ? `${municipio.nome} (${municipio.uf})` : `Código ${escolha.cod}`} não tem dados de clima nesta base`, `${municipio ? `${municipio.nome} (${municipio.uf})` : `Code ${escolha.cod}`} has no climate data in this base`)}
          texto={t('A grade da fonte não cobre este município (por exemplo, uma ilha pequena). Os números do estado ou do Brasil não valem para ele e não são mostrados no lugar.', 'The source grid does not cover this municipality (for example, a small island). State or national figures do not apply to it and are not shown in its place.')}
          uf={escolha.uf} definir={definir} />
      )}
      {pronto && !semCobertura && (
        <>
          <Estado carregando={resumo.carregando} erro={resumo.erro} tentarNovamente={resumo.recarregar} />
          {resumo.dados && (
            <>
              <div className="cl-grade">
                {MEDIDAS.map((m) => (
                  <CartaoMedida key={m.codigo} m={m} r={porVar.get(m.codigo)} periodo={periodo} selecionado={detalhe.codigo === m.codigo}
                    aoSelecionar={() => { setForcarDetalhe(true); definir({ variavel: m.codigo === 'chuva_mm' ? null : m.codigo }); }} />
                ))}
              </div>
              <p className="cl-mini">{t('Cada cartão compara o último ano completo com o habitual de', 'Each card compares the latest complete year with the usual of')} {periodo[0]}–{periodo[1]}. {t('O ano em curso aparece à parte, só contra os mesmos meses. Clique num cartão para abrir a série anual, o mês a mês e o mapa de calor.', 'The current year is shown apart, only against the same months. Click a card to open the annual series, the monthly view and the heat map.')}</p>
              <AcumuladosChuva r={porVar.get('chuva_mm')} escopo={escopo} periodo={periodo} />
              <DetalheSobDemanda key={`${detalhe.codigo}|${escolha.cod ?? escolha.uf}`} forcar={forcarDetalhe} m={detalhe} escolha={escolha} escopo={escopo} r={porVar.get(detalhe.codigo)} periodo={periodo} geradoEm={geradoEm} definir={definir} />
              <p className="nota-base">{t('Fonte', 'Source')}: {fonteDe(detalhe)} · {t('versão da base', 'data version')} {geradoEm}{ref ? ` · ${t('dados mensais até', 'monthly data up to')} ${mesAnoTxt(ref.ate)}` : ''}.{' '}
                <Link to={{ pathname: '/clima/rankings', search: buscaClima(sp) }}>{t('Rankings de municípios', 'Municipality rankings')}</Link> · <Link to={{ pathname: '/clima/metodologia', search: buscaClima(sp) }}>{t('Fontes e metodologia', 'Sources and methodology')}</Link></p>
            </>
          )}
        </>
      )}
    </>
  );
}

// ---------------- rankings ----------------

type Ordem = 'maior' | 'menor' | 'acima' | 'abaixo';

export function ClimaRankings() {
  const { sp, definir } = useEscolhaUrl();
  const { anos: anosMeta, normal: periodo, geradoEm } = useMetaClima();
  const publicado = anosMeta.length > 0;
  const terr = useTerritorios(publicado);
  const escolha = lerEscolhaClima(sp, terr.lista);
  const m = medidaDe(escolha.variavel) ?? MEDIDAS[0];
  // a cobertura efetiva do Brasil (anos com total de verdade) define o seletor: nada de oferecer o ano da lacuna
  const cob = useApi<ResumoClimaFonte>(publicado ? 'clima_painel' : null, {});
  const resumoBr = useMemo(() => (cob.dados?.linhas ?? []).map(lerResumo).find((r) => r.variavel === m.codigo), [cob.dados, m.codigo]);
  const anos = useMemo(() => anosCompletos(resumoBr), [resumoBr]);
  const sel = resolverAno(escolha.ano, anos, anos[0] ?? null);
  const ordem = (['maior', 'menor', 'acima', 'abaixo'] as Ordem[]).find((o) => o === sp.get('ordem')) ?? 'maior';
  const dados = useApi<Linha[]>(publicado && sel.ano !== null && !sel.ausente ? 'clima_ranking' : null, { ano: sel.ano, uf: escolha.uf, variavel: m.codigo });
  const lista = useMemo(() => {
    const chave = (r: Linha) => (ordem === 'maior' || ordem === 'menor' ? num(r.valor) : num(m.relativa ? r.anomalia_pct : r.anomalia));
    const base = (dados.dados ?? []).filter((r) => chave(r) !== null);
    const ordenada = base.sort((a, b) => (ordem === 'maior' || ordem === 'acima' ? chave(b)! - chave(a)! : chave(a)! - chave(b)!));
    const pos = posicoesCompetitivas(ordenada.map((r) => chave(r)!));
    return ordenada.map((r, i) => ({ r, pos: pos[i] }));
  }, [dados.dados, ordem, m.relativa]);
  const topo = lista.slice(0, 50);
  const rotuloOrdem: Record<Ordem, string> = {
    maior: t('Maior valor no ano', 'Highest value in the year'), menor: t('Menor valor no ano', 'Lowest value in the year'),
    acima: t('Mais acima do habitual', 'Furthest above usual'), abaixo: t('Mais abaixo do habitual', 'Furthest below usual'),
  };
  if (!publicado) return <><h2 className="titulo-pagina">{t('Clima: rankings', 'Climate: rankings')}</h2><SemDados /></>;
  const fonte = fonteDe(m);
  const colunaAnomalia = m.relativa ? t('Variação', 'Change') : t('Diferença', 'Difference');
  const linkMun = (r: Linha) => `/clima${buscaClima(sp, { cod: texto(r.cod), uf: texto(r.uf), variavel: m.codigo === 'chuva_mm' ? null : m.codigo, ano: sel.ano })}`;
  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: rankings de municípios', 'Climate: municipality rankings')}</h2>
      <p className="subtitulo">{m.nome()} {m.soma ? t('por município (soma do ano)', 'by municipality (sum for the year)') : t('por município (média do ano)', 'by municipality (mean for the year)')} <Dica rotulo={t('Fonte', 'Source')}>{fonte}</Dica></p>
      <section className="cartao">
        <div className="filtros">
          <div className="campo">
            <label htmlFor="r-var">{t('Medida', 'Measure')}</label>
            <select id="r-var" value={m.codigo} onChange={(e) => definir({ variavel: e.target.value === 'chuva_mm' ? null : e.target.value })}>
              {MEDIDAS.map((x) => <option key={x.codigo} value={x.codigo}>{x.nome()} ({x.unidade})</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="r-ano">{t('Ano (completo)', 'Year (complete)')}</label>
            <select id="r-ano" value={sel.ano ?? ''} onChange={(e) => definir({ ano: e.target.value })}>
              {sel.ausente && sel.ano !== null && <option value={sel.ano}>{sel.ano} ({t('sem total anual', 'no annual total')})</option>}
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="r-uf">UF</label>
            <select id="r-uf" value={escolha.uf} onChange={(e) => definir({ uf: e.target.value || null, cod: null })}>
              <option value="">{t('Brasil', 'Brazil')}</option>{UFS_CLIMA.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="r-ordem">{t('Ordenar por', 'Sort by')}</label>
            <select id="r-ordem" value={ordem} onChange={(e) => definir({ ordem: e.target.value })}>
              {(Object.keys(rotuloOrdem) as Ordem[]).map((o) => <option key={o} value={o}>{rotuloOrdem[o]}</option>)}
            </select>
          </div>
        </div>
        <Avisos escolha={escolha} definir={definir} />
        {sel.ausente && sel.ano !== null && (
          <div className="cl-aviso forte" role="status">
            <p><strong>{t(`${m.nome()} não tem total anual em ${sel.ano}.`, `${m.nome()} has no annual total in ${sel.ano}.`)}</strong> {anosDaLacuna(resumoBr).includes(sel.ano) ? t('Os meses de setembro/2022 a fevereiro/2024 foram retirados por erro da fonte; nada foi preenchido.', 'The months from September 2022 to February 2024 were removed because of a source error; nothing was filled in.') : t('O ano está fora do período publicado ou é parcial.', 'The year is outside the published period or is partial.')}</p>
            <div className="acoes">{sel.sugestoes.map((a) => <button key={a} className="botao-leve" onClick={() => definir({ ano: String(a) })}>{t(`Ver ${a}`, `See ${a}`)}</button>)}</div>
          </div>
        )}
        <Estado carregando={cob.carregando || dados.carregando} erro={cob.erro ?? dados.erro} tentarNovamente={dados.recarregar}
          vazio={!sel.ausente && !!dados.dados && !dados.carregando && !lista.length && t('Sem dados para este ano e recorte.', 'No data for this year and scope.')} />
      </section>
      {topo.length > 0 && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <div>
              <h3>{m.nome()} · {rotuloOrdem[ordem]} · {sel.ano}{escolha.uf ? ` · ${escolha.uf}` : ''}</h3>
              <p className="desc">{t(`Os 50 primeiros de ${numero(lista.length)} municípios; valores iguais dividem a posição (1, 2, 2, 4). O habitual é a média ${periodo[0]}–${periodo[1]}. Município pequeno cobre poucas células da grade: leia com cautela.`,
                `Top 50 of ${numero(lista.length)} municipalities; equal values share a rank (1, 2, 2, 4). The usual is the ${periodo[0]}–${periodo[1]} average. A small municipality covers few grid cells: read with caution.`)}</p>
            </div>
            <BotoesExportar nome={`clima_${m.codigo}_ranking_${sel.ano}_${escolha.uf || 'BR'}`} obter={() => ({
              colunas: [t('Posição', 'Rank'), t('Município', 'Municipality'), 'UF', `${m.nome()} (${m.unidade})`, `${t('Normal', 'Normal')} (${m.unidade})`,
                m.relativa ? t('Variação sobre a normal (%)', 'Change from normal (%)') : t(`Diferença para a normal (${m.unidade === '%' ? 'p.p.' : m.unidade})`, `Difference from normal (${m.unidade === '%' ? 'p.p.' : m.unidade})`)],
              linhas: lista.map(({ r, pos }) => [pos, texto(r.nome), texto(r.uf), num(r.valor), num(r.normal), m.relativa ? (num(r.anomalia_pct) === null ? null : num(r.anomalia_pct)! * 100) : num(r.anomalia)]),
              metadados: [[t('Medida', 'Measure'), `${m.nome()} (${m.unidade})`], [t('Ano', 'Year'), String(sel.ano)], [t('Recorte', 'Scope'), escolha.uf || t('Brasil', 'Brazil')], [t('Ordenação', 'Sort'), rotuloOrdem[ordem]],
                [t('Posições', 'Ranks'), t('empates competitivos (1, 2, 2, 4)', 'competitive ties (1, 2, 2, 4)')], [t('Normal', 'Normal'), `${periodo[0]}–${periodo[1]}`], [t('Fonte', 'Source'), fonte], [t('Versão da base', 'Data version'), geradoEm], [t('Endereço', 'Address'), location.href]],
            })} />
          </div>
          <div className="rolagem">
            <table className="tabela-fixa">
              <thead><tr><th>#</th><th style={{ textAlign: 'left' }}>{t('Município', 'Municipality')}</th><th>UF</th><th>{m.unidade}</th><th>{t('Normal', 'Normal')}</th><th>{colunaAnomalia}</th></tr></thead>
              <tbody>{topo.map(({ r, pos }) => (
                <tr key={texto(r.cod)}><td>{pos}</td>
                  <td style={{ textAlign: 'left' }}><Link to={linkMun(r)}>{texto(r.nome)}</Link></td><td>{texto(r.uf)}</td>
                  <td>{semUnidade(num(r.valor), m.unidade)}</td><td>{semUnidade(num(r.normal), m.unidade)}</td><td>{comparacaoTxt(r.valor, r.normal, m.relativa, m.unidade)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}
      <p className="nota-base"><Link to={{ pathname: '/clima', search: buscaClima(sp) }}>{t('Voltar à visão geral', 'Back to the overview')}</Link></p>
    </>
  );
}

// ---------------- metodologia ----------------

export function ClimaMetodologia() {
  const { anos, ate, normal, processadoEm, geradoEm } = useMetaClima();
  const publicado = anos.length > 0;
  const [sp] = useSearchParams();
  return (
    <>
      <h2 className="titulo-pagina">{t('Clima: fontes e metodologia', 'Climate: sources and methodology')}</h2>
      <section className="cartao texto">
        <h3>{t('Fontes', 'Sources')}</h3>
        <ul>
          <li><strong>CHIRPS v3</strong> (Climate Hazards Center, UC Santa Barbara): {t('chuva mensal estimada a partir de satélites e de estações de superfície, em grade de 0,05° (cerca de 5 km), de 1981 em diante. É a fonte da chuva neste painel', 'monthly rainfall estimated from satellites and surface stations, on a 0.05° grid (about 5 km), from 1981 onwards. It is the rainfall source in this panel')}.</li>
          <li><strong>ERA5-Land</strong> (Copernicus Climate Change Service / ECMWF): {t('reanálise de variáveis de superfície, em grade de 0,1° (cerca de 11 km). O produto começa em 1950, mas aqui se publica de 1979 em diante: antes disso, no trecho retroativo anterior aos satélites, a série tem saltos sem sentido físico (a temperatura média do Brasil sobe 1,2 °C em 1961 e volta no ano seguinte)', 'land-surface reanalysis on a 0.1° grid (about 11 km). The product starts in 1950, but only 1979 onwards is published here: before that, in the back-extension stretch that precedes satellites, the series has jumps with no physical meaning (Brazil’s mean temperature rises 1.2 °C in 1961 and falls back the next year)')}.
            {publicado ? ` ${t('Publicado aqui', 'Published here')}: ${anos[0]}–${anos[1]}, ${t('com dados mensais até', 'monthly data up to')} ${mesAnoTxt(ate)}.` : ''}</li>
        </ul>
        <h3>{t('As seis medidas', 'The six measures')}</h3>
        <ul>{MEDIDAS.map((m) => <li key={m.codigo}><strong>{m.nome()} ({m.unidade})</strong>: {m.ajuda()}</li>)}</ul>
        <h3>{t('Como o número de cada município é feito', 'How each municipality number is built')}</h3>
        <ul>
          <li>{t('A malha municipal do IBGE (2022) é sobreposta à grade. O valor do município é a média dos pixels que o cobrem, ponderada pela fração do município em cada pixel (em subcélulas de coordenadas geográficas, sem corrigir a área física de cada subcélula). Município menor que um pixel recebe o valor do pixel em que está.', 'The IBGE municipal boundaries (2022) are laid over the grid. The municipality value is the mean of the pixels that cover it, weighted by the share of the municipality in each pixel (in geographic-coordinate sub-cells, without correcting each sub-cell’s physical area). A municipality smaller than a pixel gets the value of the pixel it is in.')}</li>
          <li>{t('Brasil e UF são médias dos municípios ponderadas pela área, não pela população e nunca média simples.', 'Brazil and state values are municipality means weighted by area, not by population and never a simple mean.')}</li>
          <li>{t(`O ano resume os 12 meses: soma para chuva e evaporação, média simples dos 12 meses (sem ponderar pelos dias) para as demais; só entra quando os 12 meses existem. O habitual (normal) é a média de ${normal[0]} a ${normal[1]}, o período de referência usual da Organização Meteorológica Mundial. A comparação é percentual (%) para chuva e evaporação, e uma diferença na própria unidade para temperatura, ponto de orvalho e radiação; para a umidade do solo é uma diferença em pontos percentuais (p.p.), não em %.`,
            `The year summarises the 12 months: a sum for rainfall and evaporation, a simple mean of the 12 months (not weighted by days) for the others; it only counts when all 12 months exist. The usual (normal) is the ${normal[0]}–${normal[1]} average, the usual World Meteorological Organization reference period. The comparison is a percentage (%) for rainfall and evaporation, and a difference in the variable’s own unit for temperature, dew point and radiation; for soil moisture it is a difference in percentage points (p.p.), not in %.`)}</li>
          <li>{t('Ano em curso: aparece à parte como parcial, de janeiro até o último mês publicado, comparado só com a normal dos mesmos meses; nunca com o total de um ano fechado.', 'Current year: shown apart as partial, from January to the latest published month, compared only with the normal of the same months; never with a closed-year total.')}</li>
          <li>{t('Chuva acumulada em 3, 6 e 12 meses: soma dos meses que terminam no último mês publicado, contra a soma das normais mensais dos mesmos meses. Só vale com todos os meses presentes; ausência nunca vira zero.', 'Rainfall accumulated over 3, 6 and 12 months: the sum of the months ending at the latest published month, against the sum of the monthly normals of the same months. Valid only with all months present; missing never becomes zero.')}</li>
          <li>{t('No ERA5-Land, a evaporação vem em metros de água por dia e é convertida em milímetros no mês (valor do dia multiplicado pelos dias do mês); a radiação, em joules por m² por dia, vira watts por m² médios. Temperatura e ponto de orvalho vêm em kelvin e são convertidos para °C.', 'In ERA5-Land, evaporation comes as metres of water per day and is converted to millimetres per month (daily value times the days of the month); radiation, in joules per m² per day, becomes mean watts per m². Temperature and dew point come in kelvin and are converted to °C.')}</li>
          <li>{t('Mapa de calor: o desvio de cada mês é calculado contra a normal do mesmo mês; a escala de cores é simétrica e satura nos meses mais extremos (um mês com +7.615% é uma conta válida, mas não apaga o resto do mapa). Quadrado cinza é mês sem dado.', 'Heat map: each month’s deviation is computed against the normal of the same month; the colour scale is symmetric and saturates at the most extreme months (a +7,615% month is a valid calculation, but does not wipe out the rest of the map). A grey square is a month with no data.')}</li>
        </ul>
        <h3>{t('Limites, para ler com cautela', 'Limits: read with caution')}</h3>
        <ul>
          <li>{t('Chuva por satélite é uma estimativa, não uma medição no município. Onde há poucas estações (Amazônia, interior do Nordeste) o erro é maior, e é maior em meses isolados do que em totais anuais ou de vários anos.', 'Satellite rainfall is an estimate, not a measurement in the municipality. Where stations are few (Amazon, interior Northeast) the error is larger, and it is larger for single months than for annual or multi-year totals.')}</li>
          <li>{t('O ERA5-Land é uma reanálise: um modelo de superfície alimentado pela atmosfera do ERA5, e não medições de estação. Temperatura e radiação são bem representadas em escala mensal; a evaporação e a umidade do solo dependem do modelo e têm erro maior, e devem ser lidas como tendência e comparação entre lugares, não como valor exato. A evaporação aqui é a evaporação total do modelo, não a evapotranspiração de referência (ET0), que mede a demanda da atmosfera e não está publicada.', 'ERA5-Land is a reanalysis: a land-surface model driven by the ERA5 atmosphere, not station measurements. Temperature and radiation are well represented at monthly scale; evaporation and soil moisture depend on the model and have larger error, so read them as trends and comparisons between places, not as exact values. Evaporation here is the model’s total evaporation, not reference evapotranspiration (ET0), which measures atmospheric demand and is not published.')}</li>
          <li>{t('No produto mensal do ERA5-Land, de setembro de 2022 a fevereiro de 2024, a evaporação e a radiação vêm com cerca de 37% do valor esperado, em todo o Brasil. O ECMWF documenta esse defeito, informa que o produto mensal não será substituído e indica como recuperar os acumulados (produto mensal por hora do dia, às 00h, só para evaporação e radiação). Até essa recuperação ser feita e validada, esses meses ficam de fora das duas variáveis (sem preenchimento nem interpolação) e os anos de 2022, 2023 e 2024 ficam sem total anual delas. Temperatura, ponto de orvalho e umidade do solo não são afetados.', 'In the ERA5-Land monthly product, from September 2022 to February 2024, evaporation and radiation come at about 37% of the expected value, across Brazil. ECMWF documents this defect, states that the monthly product will not be replaced, and indicates how to recover the accumulations (the monthly product by hour of day, at 00h, for evaporation and radiation only). Until that recovery is done and validated, these months are left out of both variables (no filling or interpolation), and 2022, 2023 and 2024 have no annual total for them. Temperature, dew point and soil moisture are not affected.')}</li>
          <li>{t('A grade mistura o município com o entorno: em município pequeno ou de relevo acidentado a média pode refletir a vizinhança (principalmente nos 11 km do ERA5-Land); em município enorme, a média esconde diferenças internas.', 'The grid blends the municipality with its surroundings: in a small or rugged municipality the mean may reflect the neighbourhood (especially at ERA5-Land’s 11 km); in a huge one, it hides internal differences.')}</li>
          <li>{t('O ERA5-Land só tem pixels de terra: município litorâneo ou insular sem pixel de terra próprio usa o pixel de terra mais próximo, se estiver a cerca de 28 km ou menos. Fernando de Noronha (PE) é o único município sem dado em nenhuma das seis medidas; os municípios chamados Trindade (em Goiás e em Pernambuco) têm dados. O painel não mostra os números do estado no lugar de Noronha.', 'ERA5-Land only has land pixels: a coastal or island municipality without a land pixel of its own uses the nearest land pixel if it is about 28 km away or less. Fernando de Noronha (PE) is the only municipality with no data in any of the six measures; the municipalities named Trindade (in Goiás and in Pernambuco) do have data. The panel does not show state figures in place of Noronha.')}</li>
          <li>{t('Os meses mais recentes de ambas as fontes são preliminares e podem ser revisados.', 'The most recent months of both sources are preliminary and may be revised.')}</li>
          <li>{t('É clima físico, não impacto: um número de um ano não diz, sozinho, nada sobre seca, safra ou enchente. Dois anos isolados não formam uma tendência climática.', 'This is physical climate, not impact: a single year’s number says nothing about drought, harvest or flood. Two isolated years do not make a climate trend.')}</li>
        </ul>
        <p className="nota-base">{t('Versão da base', 'Data version')}: {geradoEm} · {t('processado em', 'processed on')} {processadoEm ?? '–'} · <Link to={{ pathname: '/clima', search: buscaClima(sp) }}>{t('Voltar à visão geral', 'Back to the overview')}</Link></p>
      </section>
    </>
  );
}
