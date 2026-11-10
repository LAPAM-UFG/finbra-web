import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros } from '../contexto';
import { numero } from '../format';
import { t } from '../idioma';
import { faixaAnos } from '../saude_comum';
import {
  anosDoImunobiologico, contraMeta, DENOMINADOR, DENOMINADOR_PEQUENO, doAno, metodoDoAno, nomeMetodo, nomeMetodoCurto, paraCatalogo, paraLinhaVac,
  pctRazao, situacao, textoCobertura, textoSituacao, unidadeNumerador, URL_FONTE_VACINACAO, URL_NT84, URL_NT87, URL_NT91,
  type CatalogoVac, type LinhaVac, type Metodo,
} from '../vacinacao_comum';
import { AvisoAno, referencia, useSaude } from './SaudeDatasus';

const PADRAO = 'bcg';
const LIMITE_LINHAS = 50;
const num2 = (v: number | null) => (v === null ? '–' : numero(v));
const pct = (r: LinhaVac | undefined, noCatalogo: boolean, casas = 2) => textoCobertura(r, noCatalogo, casas);
const metaTexto = (meta: number | null) => (meta === null ? t('sem meta oficial confirmada', 'no confirmed official target') : `${(100 * meta).toLocaleString(undefined, { maximumFractionDigits: 0 })}%`);

/**
 * Cobertura vacinal oficial por residência (PNI / InfoMS, 2015–2025): município, UF ou Brasil, por imunobiológico. A cobertura é razão
 * numerador ÷ denominador (nascidos vivos do SINASC); até 2022 é por tipo de dose e de 2023 em diante por indivíduo, e as duas séries
 * ficam em cartões separados. UF e Brasil são os totalizadores oficiais; vacinas diferentes nunca se somam.
 */
export function SaudeVacinacao() {
  const { ano, semAno, escopo, rotulo, municipio, uf, fontes, meta, temDados } = useSaude();
  const [busca, setBusca] = useSearchParams();
  const fonte = fontes.vacinacao;
  const cobertos = fonte?.anos ?? [];
  const ref = referencia(cobertos, ano, semAno);
  const imuno = busca.get('imuno') || PADRAO;

  const cat = useApi<Linha[]>(fonte ? 'vacinacao_catalogo' : null);
  const catalogo = useMemo<CatalogoVac[]>(() => (cat.dados ?? []).map(paraCatalogo), [cat.dados]);
  const doAnoRef = useMemo(() => (ref === null ? [] : doAno(catalogo, ref)), [catalogo, ref]);
  const noCatalogo = doAnoRef.some((c) => c.imunobiologico === imuno);
  const rotuloImuno = doAnoRef.find((c) => c.imunobiologico === imuno)?.rotulo ?? catalogo.find((c) => c.imunobiologico === imuno)?.rotulo ?? imuno;

  const pronto = !!fonte && catalogo.length > 0;
  const serie = useApi<Linha[]>(pronto ? 'vacinacao_serie' : null, { ...escopo, imuno });
  const doAnoEscopo = useApi<Linha[]>(pronto && ref !== null ? 'vacinacao_ano' : null, { ...escopo, ano: ref });
  // município: a UF e o Brasil oficiais do mesmo ano, para comparar (nunca recalculados a partir dos municípios)
  const daUf = useApi<Linha[]>(pronto && municipio && uf && ref !== null ? 'vacinacao_ano' : null, { uf, ano: ref });
  const doBr = useApi<Linha[]>(pronto && municipio && ref !== null ? 'vacinacao_ano' : null, { ano: ref });
  const municipios = useApi<Linha[]>(pronto && ref !== null && noCatalogo ? 'vacinacao_municipios' : null, { uf: uf ?? undefined, ano: ref, imuno });

  const linhasSerie = useMemo(() => (serie.dados ?? []).map(paraLinhaVac), [serie.dados]);
  const linhasAno = useMemo(() => (doAnoEscopo.dados ?? []).map(paraLinhaVac), [doAnoEscopo.dados]);
  const a = linhasSerie.find((r) => r.ano === ref);
  const doAnoDe = (d: Linha[] | undefined) => (d ?? []).map(paraLinhaVac).find((r) => r.imunobiologico === imuno);
  const disponiveis = anosDoImunobiologico(catalogo, imuno);

  const escolher = (id: string) => {
    const p = new URLSearchParams(busca);
    p.set('imuno', id);
    setBusca(p, { replace: true });
  };

  if (!temDados || !fonte) {
    return (
      <>
        <h2 className="titulo-pagina">{t('Cobertura vacinal', 'Vaccination coverage')}</h2>
        <p className="vazio">{t('A cobertura vacinal ainda não foi publicada nesta versão dos dados.', 'Vaccination coverage has not been published in this data version yet.')}</p>
      </>
    );
  }

  const comuns: [string, string][] = [
    [t('Recorte', 'Scope'), rotulo],
    [t('Fonte', 'Source'), `${t('Ministério da Saúde, PNI / InfoMS: cobertura vacinal do calendário nacional, por residência', 'Ministry of Health, PNI / InfoMS: national immunisation schedule coverage, by residence')} (${URL_FONTE_VACINACAO})`],
    [t('Cobertura', 'Coverage'), `${t('razão numerador ÷ denominador (a fonte entrega 0–1; o painel mostra em %)', 'ratio numerator ÷ denominator (the source delivers 0–1; the panel shows %)')}; ${t('pode passar de 100%, sem limite', 'may exceed 100%, uncapped')}`],
    [t('Denominador', 'Denominator'), `${DENOMINADOR()}; ${t('coortes de mais de um ano usam o SINASC do ano de nascimento da coorte; não é a população da SVS/IBGE', 'multi-year cohorts use the SINASC of the cohort’s birth year; it is not the SVS/IBGE population')} (${URL_NT87})`],
    [t('Método', 'Method'), `${t('até 2022, por tipo de dose; de 2023 em diante, por indivíduo', 'up to 2022, by dose type; from 2023, per individual')} (${URL_NT84}). ${t('As duas séries não são comparáveis', 'The two series are not comparable')}`],
    [t('Território', 'Territory'), municipio ? t('município de residência', 'municipality of residence') : t('totalizador oficial da fonte (UF ou Brasil), não a média dos municípios', 'official total from the source (state or Brazil), not an average of municipalities')],
    [t('Cobertura temporal', 'Time coverage'), faixaAnos(cobertos)],
    [t('Dados preliminares', 'Preliminary data'), t('As coberturas de 2025 são preliminares e podem mudar com a atualização dos denominadores do SINASC.', '2025 coverage is preliminary and may change when SINASC denominators are updated.')],
    [t('Versão da base', 'Data version'), meta.geradoEm],
  ];

  // ---- séries: um cartão por método, nunca uma linha atravessando 2022/2023
  const cartaoSerie = (m: Metodo) => {
    const anosMetodo = disponiveis[m];
    const titulo = t(`${rotuloImuno}: cobertura ${nomeMetodoCurto(m)}`, `${rotuloImuno}: coverage ${nomeMetodoCurto(m)}`);
    if (anosMetodo.length === 0) {
      return (
        <section className="cartao" key={m}>
          <div className="cabeca-cartao"><div><h3>{titulo}</h3><p className="desc">{nomeMetodo(m)}</p></div></div>
          <p className="vazio">{t('Este imunobiológico não consta no catálogo deste método (os rótulos mudam entre 2022 e 2023 e não são emendados). Procure o equivalente na lista do ano.', 'This immunobiological is not in the catalogue of this method (labels change between 2022 and 2023 and are not merged). Look for the equivalent in the year’s list.')}</p>
        </section>
      );
    }
    const doMetodo = linhasSerie.filter((r) => r.metodo === m);
    const por = (anoX: number) => doMetodo.find((r) => r.ano === anoX);
    const valores = anosMetodo.map((x) => { const r = por(x); return r && r.cobertura !== null ? 100 * r.cobertura : null; });
    const metas = anosMetodo.map((x) => { const v = por(x)?.meta ?? null; return v === null ? null : 100 * v; });
    const series = [{ nome: t('Cobertura (%)', 'Coverage (%)'), valores }, ...(metas.some((x) => x !== null) ? [{ nome: t('Meta (%)', 'Target (%)'), valores: metas }] : [])];
    const opcao = linhas(anosMetodo, series, (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`, [], true);
    return (
      <CartaoGrafico key={m} titulo={titulo} desc={`${rotulo} · ${nomeMetodo(m)} · ${faixaAnos(anosMetodo)}${anosMetodo.includes(2025) ? t(' · 2025 preliminar', ' · 2025 preliminary') : ''}`}
        tabela={<TabelaSerie nome={`saude_vacinacao_${imuno}_${m}`} anos={anosMetodo} metadadosProprios valoresReais={false} colunas={[
          { titulo: t('Cobertura (%)', 'Coverage (%)'), valores: anosMetodo.map((x) => { const r = por(x); return r ? (r.cobertura === null ? textoSituacao(situacao(r, true)) : 100 * r.cobertura) : textoSituacao('sem_registro'); }), formato: (v) => (v === null ? '–' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) },
          { titulo: unidadeNumerador(m), valores: anosMetodo.map((x) => por(x)?.numerador ?? null), formato: num2 },
          { titulo: DENOMINADOR(), valores: anosMetodo.map((x) => por(x)?.denominador ?? null), formato: num2 },
          { titulo: t('Meta (%)', 'Target (%)'), valores: metas, formato: (v) => (v === null ? '–' : String(v)) },
          { titulo: t('Rótulo oficial', 'Official label'), valores: anosMetodo.map((x) => por(x)?.rotulo ?? null) },
        ]} metadados={[...comuns, [t('Imunobiológico', 'Immunobiological'), `${rotuloImuno} (${imuno})`], [t('Método', 'Method'), nomeMetodo(m)]]} />}>
        {valores.every((v) => v === null)
          ? <p className="vazio">{municipio ? t('Sem cobertura calculável neste método para o município.', 'No computable coverage under this method for the municipality.') : t('Sem dados neste método.', 'No data under this method.')}</p>
          : <Grafico opcao={opcao} nome={`saude_vacinacao_${imuno}_${m}`} />}
      </CartaoGrafico>
    );
  };

  // ---- cartões do ano
  const s = situacao(a, noCatalogo);
  const metaAno = a?.meta ?? doAnoRef.find((c) => c.imunobiologico === imuno)?.meta ?? null;
  const cm = contraMeta(a);
  const metodoAno = ref === null ? null : metodoDoAno(ref);
  const uniUf = doAnoDe(daUf.dados);
  const uniBr = doAnoDe(doBr.dados);

  // ---- panorama do ano: todas as vacinas do catálogo no escopo (cada uma com a sua cobertura; nunca somadas)
  const panorama = doAnoRef.map((c) => ({ c, r: linhasAno.find((x) => x.imunobiologico === c.imunobiologico) }));
  const opcaoPanorama = barras(panorama.map((p) => p.c.rotulo), panorama.map((p) => (p.r?.cobertura == null ? null : 100 * p.r.cobertura)), (v) => `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`, true);

  return (
    <>
      <h2 className="titulo-pagina">{t('Cobertura vacinal', 'Vaccination coverage')}</h2>
      <p className="subtitulo">{rotulo} · {ref ?? t('fora da cobertura', 'outside coverage')} · {t('calendário nacional, por município de residência', 'national schedule, by municipality of residence')}{' '}
        <Dica rotulo={t('Fonte', 'Source')}>{t('Ministério da Saúde, PNI / InfoMS (cobertura vacinal por residência). Denominador: nascidos vivos do SINASC. Processamento: LAPAM/UFG.', 'Ministry of Health, PNI / InfoMS (coverage by residence). Denominator: SINASC live births. Processing: LAPAM/UFG.')}</Dica></p>
      <BarraFiltros comUltimo ultimoPadrao anosCobertos={cobertos} />
      <AvisoAno ano={ano} />
      <div className="filtros" style={{ marginTop: -8 }}>
        <div className="campo">
          <label htmlFor="f-imuno">{t('Imunobiológico', 'Immunobiological')}</label>
          <select id="f-imuno" value={imuno} onChange={(e) => escolher(e.target.value)}>
            {!noCatalogo && ref !== null && <option value={imuno}>{rotuloImuno} ({t(`indisponível em ${ref}`, `unavailable in ${ref}`)})</option>}
            {doAnoRef.map((c) => <option key={c.imunobiologico} value={c.imunobiologico}>{c.rotulo}</option>)}
          </select>
        </div>
      </div>
      <Estado carregando={cat.carregando || serie.carregando} erro={cat.erro ?? serie.erro} tentarNovamente={() => { cat.recarregar(); serie.recarregar(); }} />
      {ref === null && <p className="aviso" role="status">{t(`Ano fora da cobertura: a cobertura vacinal tem dados de ${faixaAnos(cobertos)}.`, `Year outside coverage: vaccination coverage has data for ${faixaAnos(cobertos)}.`)}</p>}
      {metodoAno && (
        <p className="aviso" role="status">
          {t(`${ref}: cobertura ${nomeMetodo(metodoAno)}. `, `${ref}: coverage ${nomeMetodo(metodoAno)}. `)}
          {t('Até 2022 conta doses por tipo de dose; de 2023 em diante conta pessoas vacinadas, com regras de idade, esquema e intervalo. Por isso as séries ficam separadas e não se comparam diretamente 2022 e 2023.',
            'Up to 2022 it counts doses by dose type; from 2023 it counts vaccinated people, with age, schedule and interval rules. The series are therefore kept apart and 2022 and 2023 are not directly comparable.')}{' '}
          <a href={URL_NT84} target="_blank" rel="noreferrer">NT 84/2026</a>
        </p>
      )}
      {ref === 2025 && (
        <p className="aviso" role="status">{t('2025: cobertura preliminar, sujeita à atualização dos denominadores do SINASC. Cada indicador usa a base oficial correspondente à sua faixa etária.', '2025: preliminary coverage, subject to updates to SINASC denominators. Each indicator uses the official base for its age group.')}</p>
      )}
      {ref !== null && !noCatalogo && !cat.carregando && catalogo.length > 0 && (
        <p className="aviso" role="status">{t(`${rotuloImuno} não consta no catálogo de ${ref} (o catálogo muda por ano; ausência não é zero). Escolha outro imunobiológico na lista.`, `${rotuloImuno} is not in the ${ref} catalogue (the catalogue changes by year; absence is not zero). Pick another immunobiological from the list.`)}</p>
      )}

      {ref !== null && noCatalogo && !serie.carregando && (
        <div className="kpis kpis-4">
          <Kpi rotulo={t(`Cobertura · ${rotuloImuno}`, `Coverage · ${rotuloImuno}`)} valor={pct(a, noCatalogo)}
            nota={`${ref} · ${nomeMetodoCurto(a?.metodo ?? metodoAno!)}${s === 'acima_100' ? ` · ${t('acima de 100%: observado', 'above 100%: observed')}` : ''}${a && a.denominador !== null && a.denominador > 0 && a.denominador < DENOMINADOR_PEQUENO ? ` · ${t('poucos nascidos: oscila muito', 'few births: very volatile')}` : ''}`}
            dica={<Dica rotulo={t('Fórmula', 'Formula')}>{t('Numerador ÷ denominador, como a fonte oficial entrega (razão de 0 a 1, mostrada em %). Não é limitada a 100%. Denominador zero: não calculável. Em UF e Brasil, é o totalizador oficial, não a média dos municípios.', 'Numerator ÷ denominator, as the official source delivers (a 0–1 ratio, shown as %). Not capped at 100%. Zero denominator: not computable. For states and Brazil it is the official total, not the average of municipalities.')}</Dica>} />
          <Kpi rotulo={unidadeNumerador(a?.metodo ?? metodoAno!)} valor={a ? num2(a.numerador) : textoSituacao(s)} nota={`${ref} · ${a?.metodo === 'individuo' ? t('cada pessoa conta uma vez', 'each person counts once') : t('doses do último tipo do esquema', 'doses of the last type of the schedule')}`} />
          <Kpi rotulo={DENOMINADOR()} valor={a ? num2(a.denominador) : textoSituacao(s)} nota={t('denominador oficial; não é a população da SVS/IBGE', 'official denominator; not the SVS/IBGE population')}
            dica={<Dica rotulo={t('Como ler', 'How to read')}>{t('Nascidos vivos do SINASC. Para coortes de mais de um ano, o SINASC do ano de nascimento da coorte (por exemplo, quem tem 4 anos em 2025 usa os nascidos de 2021).', 'SINASC live births. For multi-year cohorts, the SINASC of the cohort’s birth year (for example, those aged 4 in 2025 use 2021 births).')} <a href={URL_NT87} target="_blank" rel="noreferrer">NT 87/2026</a></Dica>} />
          <Kpi rotulo={t('Meta', 'Target')} valor={metaTexto(metaAno)}
            nota={metaAno === null ? t('só se mostra meta com regra oficial confirmada para o rótulo', 'a target is shown only with a confirmed official rule for the label') : cm === 'atingida' ? t('meta atingida', 'target reached') : cm === 'abaixo' ? t('abaixo da meta', 'below target') : t('cobertura não calculável: sem comparação', 'coverage not computable: no comparison')} />
        </div>
      )}
      {ref !== null && noCatalogo && municipio && (uniUf || uniBr) && (
        <p className="nota-base">
          {t('Mesmo ano e vacina, totalizadores oficiais', 'Same year and vaccine, official totals')}: {uf && `${uf} ${pct(uniUf, true, 1)} (${num2(uniUf?.numerador ?? null)} ÷ ${num2(uniUf?.denominador ?? null)})`} · {t('Brasil', 'Brazil')} {pct(uniBr, true, 1)} ({num2(uniBr?.numerador ?? null)} ÷ {num2(uniBr?.denominador ?? null)})
        </p>
      )}

      {pronto && <div className="grade-2">{METODOS_ORDEM.map(cartaoSerie)}</div>}

      {ref !== null && panorama.length > 0 && (
        <CartaoGrafico titulo={t(`Imunobiológicos em ${ref}: cada um com a sua cobertura`, `Immunobiologicals in ${ref}: each with its own coverage`)} desc={`${rotulo} · ${nomeMetodo(metodoDoAno(ref))}`}
          tabela={<TabelaSerie nome={`saude_vacinacao_${ref}`} anos={panorama.map((p) => p.c.rotulo)} primeiraColuna={t('Imunobiológico (rótulo oficial)', 'Immunobiological (official label)')} semAnoSelecionado metadadosProprios valoresReais={false}
            conteudo={t(`todos os imunobiológicos do catálogo de ${ref}, no escopo exibido`, `all immunobiologicals in the ${ref} catalogue, for the scope shown`)} colunas={[
              { titulo: t('Cobertura (%)', 'Coverage (%)'), valores: panorama.map((p) => (p.r?.cobertura == null ? textoSituacao(situacao(p.r, true)) : 100 * p.r.cobertura)), formato: (v) => (v === null ? '–' : v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })) },
              { titulo: t('Numerador', 'Numerator'), valores: panorama.map((p) => p.r?.numerador ?? null), formato: num2 },
              { titulo: t('Denominador', 'Denominator'), valores: panorama.map((p) => p.r?.denominador ?? null), formato: num2 },
              { titulo: t('Meta', 'Target'), valores: panorama.map((p) => (p.c.meta === null ? t('sem meta confirmada', 'no confirmed target') : `${Math.round(100 * p.c.meta)}%`)) },
            ]} metadados={[...comuns, [t('Ano exibido', 'Year shown'), String(ref)]]} />}>
          <Estado carregando={doAnoEscopo.carregando} erro={doAnoEscopo.erro} tentarNovamente={doAnoEscopo.recarregar} />
          {!doAnoEscopo.carregando && <Grafico opcao={opcaoPanorama} nome={`saude_vacinacao_panorama_${ref}`} altura={Math.max(240, 30 * panorama.length + 30)} />}
        </CartaoGrafico>
      )}
      {ref !== null && panorama.length > 0 && (
        <p className="nota-base">{t('Cada barra é uma vacina com a sua cobertura; vacinas diferentes não se somam nem se fazem média como se fossem cobertura geral. O catálogo varia por ano; imunobiológico fora dele não tem dado (ausência não é zero).', 'Each bar is one vaccine with its own coverage; different vaccines are not summed or averaged as if they were an overall coverage. The catalogue varies by year; an immunobiological outside it has no data (absence is not zero).')}</p>
      )}

      {ref !== null && noCatalogo && (
        <Ranking municipios={municipios} uf={uf} rotulo={rotulo} ref_={ref} imuno={imuno} rotuloImuno={rotuloImuno} metaAno={metaAno} comuns={comuns} cod={municipio ? escopo.ente : undefined} />
      )}

      {ref !== null && (
        <BotoesExportar nome={`saude_vacinacao_resumo_${ref}`} obter={() => ({
          colunas: [t('Imunobiológico (rótulo oficial)', 'Immunobiological (official label)'), t('Identificador', 'Identifier'), t('Ano', 'Year'), t('Método', 'Method'),
            t('Numerador', 'Numerator'), t('Denominador', 'Denominator'), t('Cobertura (razão 0–1)', 'Coverage (0–1 ratio)'), t('Cobertura (%)', 'Coverage (%)'), t('Situação', 'Status'),
            t('Meta (%)', 'Target (%)'), t('Meta', 'Target status')],
          linhas: panorama.map(({ c, r }) => [c.rotulo, c.imunobiologico, ref, c.metodo, r?.numerador ?? null, r?.denominador ?? null, r?.cobertura ?? null,
            r?.cobertura == null ? null : 100 * r.cobertura, textoSituacao(situacao(r, true)), c.meta === null ? null : 100 * c.meta,
            contraMeta(r) === 'atingida' ? t('atingida', 'reached') : contraMeta(r) === 'abaixo' ? t('abaixo', 'below') : t('sem comparação', 'no comparison')]),
          metadados: comuns,
        })} />
      )}

      <p className="nota-base">
        {t('Cobertura vacinal oficial do Ministério da Saúde (PNI), pelo município de residência. A cobertura é numerador ÷ denominador; o denominador é o de nascidos vivos do SINASC (coortes de mais de um ano usam o SINASC do ano de nascimento da coorte), não a população da SVS ou do IBGE. Até 2022 o numerador conta doses por tipo de dose; de 2023 em diante, pessoas vacinadas, com regras de idade, esquema e intervalo: as séries não são comparáveis e ficam em cartões separados. O catálogo de vacinas varia por ano e os rótulos oficiais são preservados, sem emendar nomes parecidos. Percentuais acima de 100% são valores observados (numerador maior que o denominador) e não são limitados. Com denominador zero, a cobertura não é calculável. UF e Brasil são os totalizadores oficiais, nunca a média dos percentuais dos municípios. Metas só aparecem onde a regra oficial foi confirmada para o rótulo. Fontes: ',
          'Official vaccination coverage from the Ministry of Health (PNI), by municipality of residence. Coverage is numerator ÷ denominator; the denominator is SINASC live births (multi-year cohorts use the SINASC of the cohort’s birth year), not the SVS or IBGE population. Up to 2022 the numerator counts doses by dose type; from 2023, vaccinated people, with age, schedule and interval rules: the series are not comparable and are kept in separate cards. The vaccine catalogue varies by year and the official labels are preserved, without merging similar names. Percentages above 100% are observed values (numerator greater than denominator) and are not capped. With a zero denominator, coverage is not computable. States and Brazil are the official totals, never the average of municipal percentages. Targets appear only where the official rule was confirmed for the label. Sources: ')}
        <a href={URL_FONTE_VACINACAO} target="_blank" rel="noreferrer">InfoMS</a>{' · '}
        <a href={URL_NT84} target="_blank" rel="noreferrer">NT 84/2026</a>{' · '}
        <a href={URL_NT87} target="_blank" rel="noreferrer">NT 87/2026</a>{' · '}
        <a href={URL_NT91} target="_blank" rel="noreferrer">NT 91/2026 ({t('idades do rotavírus', 'rotavirus ages')})</a>.
      </p>
    </>
  );
}

const METODOS_ORDEM: Metodo[] = ['tipo_de_dose', 'individuo'];

/** Municípios da UF (ou do Brasil) com a cobertura do imunobiológico no ano: ordem, denominador mínimo e exportação completa. */
function Ranking({ municipios, uf, rotulo, ref_, imuno, rotuloImuno, metaAno, comuns, cod }: {
  municipios: { dados?: Linha[]; carregando: boolean; erro?: string; recarregar: () => void }; uf: string | null; rotulo: string; ref_: number; imuno: string;
  rotuloImuno: string; metaAno: number | null; comuns: [string, string][]; cod?: string | number | null | undefined;
}) {
  const [ordem, setOrdem] = useState<'asc' | 'desc'>('asc');
  const [minimo, setMinimo] = useState(DENOMINADOR_PEQUENO);
  const todos = municipios.dados ?? [];
  const semCadastro = Number(todos[0]?.sem_cadastro ?? 0);
  const comNome = todos.filter((r) => r.cod_ibge !== null);
  const calculaveis = comNome.filter((r) => typeof r.cobertura === 'number' && Number(r.denominador) >= minimo);
  const ordenados = [...calculaveis].sort((x, y) => (ordem === 'asc' ? 1 : -1) * (Number(x.cobertura) - Number(y.cobertura)) || String(x.nome).localeCompare(String(y.nome)));
  const naoCalculaveis = comNome.filter((r) => typeof r.cobertura !== 'number').length;
  const escopoTxt = uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil');
  return (
    <section className="cartao">
      <div className="cabeca-cartao"><div>
        <h3>{t(`${escopoTxt}: ${rotuloImuno}, ${ref_}`, `${escopoTxt}: ${rotuloImuno}, ${ref_}`)}</h3>
        <p className="desc">{t('cada município com a sua cobertura oficial; não é média nem soma de percentuais', 'each municipality with its official coverage; not an average or a sum of percentages')}</p>
      </div></div>
      <div className="filtros">
        <div className="campo"><label htmlFor="v-ordem">{t('Ordem', 'Order')}</label>
          <select id="v-ordem" value={ordem} onChange={(e) => setOrdem(e.target.value as 'asc' | 'desc')}>
            <option value="asc">{t('menor cobertura primeiro', 'lowest coverage first')}</option>
            <option value="desc">{t('maior cobertura primeiro', 'highest coverage first')}</option>
          </select></div>
        <div className="campo"><label htmlFor="v-min">{t('Denominador mínimo', 'Minimum denominator')}</label>
          <select id="v-min" value={minimo} onChange={(e) => setMinimo(Number(e.target.value))}>
            <option value={0}>{t('todos (inclui municípios muito pequenos)', 'all (includes very small municipalities)')}</option>
            <option value={DENOMINADOR_PEQUENO}>{t(`${DENOMINADOR_PEQUENO} nascidos ou mais`, `${DENOMINADOR_PEQUENO} births or more`)}</option>
            <option value={100}>{t('100 nascidos ou mais', '100 births or more')}</option>
          </select></div>
      </div>
      <Estado carregando={municipios.carregando} erro={municipios.erro} tentarNovamente={municipios.recarregar} />
      {!municipios.carregando && !municipios.erro && (
        <>
          <p className="nota-base">
            {t(`${numero(ordenados.length)} municípios com cobertura calculada e denominador ≥ ${minimo}; ${numero(naoCalculaveis)} sem cobertura calculável (denominador zero ou sem valor)`, `${numero(ordenados.length)} municipalities with computed coverage and denominator ≥ ${minimo}; ${numero(naoCalculaveis)} with no computable coverage (zero denominator or no value)`)}
            {semCadastro > 0 && ` · ${t(`${semCadastro} linha(s) de município fora do cadastro ficam só na exportação do arquivo de dados`, `${semCadastro} municipality row(s) outside the registry are only in the data file`)}`}
          </p>
          <div className="rolagem">
            <table>
              <thead><tr><th>#</th><th>{t('Município', 'Municipality')}</th><th>UF</th><th>{t('Cobertura', 'Coverage')}</th><th>{t('Numerador', 'Numerator')}</th><th>{t('Denominador', 'Denominator')}</th><th>{t('Situação', 'Status')}</th></tr></thead>
              <tbody>
                {ordenados.slice(0, LIMITE_LINHAS).map((r, i) => {
                  const c = Number(r.cobertura);
                  return (
                    <tr key={String(r.cod_ibge)} style={String(r.cod_ibge) === String(cod) ? { fontWeight: 600 } : undefined}>
                      <td>{i + 1}</td><td>{String(r.nome)}</td><td>{String(r.uf)}</td><td>{pctRazao(c, 2)}</td><td>{numero(Number(r.numerador))}</td><td>{numero(Number(r.denominador))}</td>
                      <td>{c > 1 ? textoSituacao('acima_100') : metaAno !== null ? (c >= metaAno ? t('meta atingida', 'target reached') : t('abaixo da meta', 'below target')) : textoSituacao('calculada')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ordenados.length > LIMITE_LINHAS && <p className="nota-base">{t(`Mostrando ${LIMITE_LINHAS} de ${numero(ordenados.length)}; o arquivo exportado traz todos os municípios.`, `Showing ${LIMITE_LINHAS} of ${numero(ordenados.length)}; the exported file has every municipality.`)}</p>}
          <BotoesExportar nome={`saude_vacinacao_municipios_${imuno}_${ref_}`} obter={() => ({
            colunas: [t('Código IBGE', 'IBGE code'), t('Código de 6 dígitos (fonte)', '6-digit code (source)'), t('Município', 'Municipality'), 'UF', t('Numerador', 'Numerator'), t('Denominador', 'Denominator'),
              t('Cobertura (razão 0–1)', 'Coverage (0–1 ratio)'), t('Cobertura (%)', 'Coverage (%)'), t('Situação', 'Status'), t('Meta (%)', 'Target (%)')],
            linhas: todos.map((r) => [r.cod_ibge, r.municipio, r.nome, r.uf, r.numerador, r.denominador, r.cobertura, typeof r.cobertura === 'number' ? 100 * r.cobertura : null,
              r.status === 'denominador_zero' ? textoSituacao('denominador_zero') : typeof r.cobertura === 'number' ? (r.cobertura > 1 ? textoSituacao('acima_100') : textoSituacao('calculada')) : textoSituacao('sem_valor'),
              metaAno === null ? null : 100 * metaAno]),
            metadados: [...comuns, [t('Imunobiológico', 'Immunobiological'), `${rotuloImuno} (${imuno})`], [t('Ano exibido', 'Year shown'), String(ref_)], [t('Recorte exportado', 'Exported scope'), `${rotulo}: ${escopoTxt}`]],
          })} />
        </>
      )}
    </section>
  );
}
