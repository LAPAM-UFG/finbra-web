import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useApi, type Linha, type Params } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar, useMetadados } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { AlternarVista, EvolucaoPosicao } from '../components/EvolucaoPosicao';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import type { Classificacao } from '../dados';
import { numero, reais } from '../format';
import { num } from '../hooks';
import { local, t } from '../idioma';
import {
  anosDaColuna, anosDoIndicador, avisoPreliminarNaoIncluido, calcular, calcularJanela, CAPITULOS, condicaoDado, faixaAnos, fonteCurta, fonteSaude, formatar,
  disponivelNosDados, fonteDaColuna, indicador, INDICADORES, metadadosIndicador, nomeContagem, NOME_FONTE, processadoEm, rotuloCondicao, territorioDoIndicador,
  type FonteChave, type FontesMeta, type Indicador,
} from '../saude_comum';

/** Ano mostrado de um dado: o último ano coberto (modo "último de cada fonte") ou o ano escolhido, se a fonte o cobre. */
export const referencia = (cobertos: number[], ano: number, ultimo: boolean): number | null =>
  ultimo ? cobertos.at(-1) ?? null : cobertos.includes(ano) ? ano : null;

/** Colunas que a versão dos dados carregada tem (null enquanto carrega): código novo com gold antigo esconde o que falta. */
export function useColunasSaude(): Set<string> | null {
  const r = useApi<Linha[]>('saude_colunas');
  return useMemo(() => (r.dados ? new Set(r.dados.map((x) => String(x.column_name))) : null), [r.dados]);
}
/** A série carregada tem a coluna? (sem linhas não dá para saber: considera disponível) */
const temColuna = (serie: Linha[], coluna: string) => serie.length === 0 || coluna in serie[0];
const TEXTO_INDISPONIVEL = () => t('indisponível nesta versão dos dados', 'unavailable in this data version');

/** Escopo das páginas de saúde a partir dos filtros: município, UF (municípios dela) ou Brasil. */
export function useSaude() {
  const { meta } = useDados();
  const f = useFiltros();
  const fontes = meta.fontes as unknown as FontesMeta;
  // os anos oferecidos são os de qualquer fonte; cada indicador tem a sua cobertura (fonte do numerador e do denominador)
  const anos = f.anos;
  const ano = f.ano;
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
  /** sem ano na URL (ou ano=ultimo): cada dado aparece no último ano da sua fonte */
  const semAno = f.ultimo || f.semAnoUrl;
  return { f, meta, fontes, anos, ano, semAno, escopo, rotulo, municipio, uf, temDados: anos.length > 0 };
}

function SemDados() {
  return <p className="vazio">{t('Os dados de saúde ainda não foram publicados.', 'Health data have not been published yet.')}</p>;
}

export function AvisoAno({ ano }: { ano?: number }) {
  const f = useFiltros();
  if (!f.anoForaDaBase || !ano) return null;
  return (
    <p className="aviso" role="status">
      {t(`O ano de ${f.anoForaDaBase} não está em nenhuma fonte de saúde do painel; a página mostra ${ano}, o mais recente.`,
        `${f.anoForaDaBase} is not in any health source of the panel; the page shows ${ano}, the latest year.`)}
    </p>
  );
}

export const notaResidencia = () => t(
  'Óbitos e nascimentos contados pelo município de residência (da pessoa falecida ou da mãe), não pelo de ocorrência. Em municípios pequenos, poucos casos mudam muito as taxas: veja o numerador e o denominador ao lado.',
  'Deaths and births are counted by municipality of residence (of the deceased or of the mother), not of occurrence. In small municipalities, a few cases change rates a lot: see the numerator and denominator alongside.',
);

/** Aviso de número pequeno: o denominador abaixo do mínimo do indicador. */
const pequeno = (ind: Indicador, r: Linha | undefined) => {
  const d = num(r?.[ind.denominador]);
  return d !== null && d < ind.minimo;
};

/** Atalhos de um cartão, com o recorte (município ou UF), o indicador e o ano de referência no link: série, tabela do próprio recorte e ranking entre municípios. */
export function Atalhos({ ind, ano }: { ind: Indicador; ano?: number | null }) {
  const { search } = useLocation();
  const para = (caminho: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams(search);
    p.set('ind', ind.id);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${caminho}?${p}`;
  };
  return (
    <span className="atalhos">
      {' · '}<Link to={para('/datasus/evolucao')}>{t('série', 'series')}</Link>
      {' · '}<Link to={para('/datasus/tabela', ano ? { ano: String(ano) } : {})}>{t('tabela', 'table')}</Link>
      {' · '}<Link to={para('/datasus/rankings', ano ? { ano: String(ano) } : {})}>{t('ranking', 'ranking')}</Link>
    </span>
  );
}

/**
 * Cartão de um indicador no ano de referência da sua fonte: o ano escolhido (se a fonte o cobre) ou o último disponível.
 * Distingue fora da cobertura, sem registro, zero registrado e dado preliminar; o ano aparece sempre.
 */
export function KpiIndicador({ ind, serie, ano, ultimo, fontes, extra }: {
  ind: Indicador; serie: Linha[]; ano: number; ultimo: boolean; fontes: FontesMeta; extra?: ReactNode;
}) {
  const cob = anosDoIndicador(ind, fontes);
  const ref = referencia(cob, ano, ultimo);
  const dica = <Dica rotulo={t('Fórmula', 'Formula')}>{ind.nota()} {t('Fonte', 'Source')}: {fonteCurta(ind)}.{ind.alerta ? ` ${ind.alerta()}` : ''}</Dica>;
  if (!temColuna(serie, ind.numerador) || !temColuna(serie, ind.denominador)) {
    return <Kpi rotulo={ind.nome()} valor={t('indisponível', 'unavailable')} nota={TEXTO_INDISPONIVEL()} dica={dica} />;
  }
  if (ref === null) {
    const prel = avisoPreliminarNaoIncluido(ind.numerador, ano, fontes) ?? avisoPreliminarNaoIncluido(ind.denominador, ano, fontes);
    return (
      <Kpi rotulo={ind.nome()} valor={t('fora da cobertura', 'outside coverage')} dica={dica}
        nota={<>{fonteCurta(ind)}: {faixaAnos(cob)}{prel ? ` · ${prel}` : ''}</>} />
    );
  }
  const r = serie.find((x) => Number(x.ano) === ref);
  const n = num(r?.[ind.numerador]);
  const d = num(r?.[ind.denominador]);
  const v = calcular(ind, r);
  const cond = condicaoDado(ind.numerador, n, ref, fontes);
  const detalhe = v === null ? rotuloCondicao('ausente')
    : ind.monetario ? `${reais(n)} ${t('÷', '÷')} ${numero(d)} ${nomeContagem(ind.denominador).toLowerCase()}`
    : ind.tipo === 'proporcao' ? `${numero(n)} ${t('de', 'of')} ${numero(d)}`
    : `${ind.unidade()} · ${nomeContagem(ind.numerador)}: ${numero(n)} · ${nomeContagem(ind.denominador)}: ${numero(d)}`;
  const marcas = [
    ...(cond === 'zero_registrado' ? [rotuloCondicao('zero_registrado')] : []),
    ...(cond === 'preliminar' ? [rotuloCondicao('preliminar')] : []),
    ...(v !== null && pequeno(ind, r) ? [t('poucos casos: oscila muito', 'few cases: very volatile')] : []),
    ...(ind.alerta ? [ind.alerta()] : []),
  ];
  return (
    <Kpi rotulo={ind.nome()} valor={v === null ? t('sem registro', 'no record') : formatar(ind, v)} dica={dica}
      nota={<>{ref} · {detalhe}{extra ? <> · {extra}</> : null}{marcas.length ? ` · ${marcas.join(' · ')}` : ''}<Atalhos ind={ind} ano={ref} /></>} />
  );
}

/** Cartão de uma contagem (sem fórmula): ano de referência da fonte e condição do dado. */
function KpiContagem({ rotulo, coluna, serie, ano, ultimo, fontes, nota, dica, monetario }: {
  rotulo: string; coluna: string; serie: Linha[]; ano: number; ultimo: boolean; fontes: FontesMeta; nota?: (r: Linha | undefined, ref: number) => ReactNode;
  dica?: ReactNode; monetario?: boolean;
}) {
  if (!temColuna(serie, coluna)) return <Kpi rotulo={rotulo} valor={t('indisponível', 'unavailable')} nota={TEXTO_INDISPONIVEL()} dica={dica} />;
  const chave = fonteDaColuna(coluna);
  const cobertos = anosDaColuna(coluna, fontes); // a cobertura da própria medida (ex.: médicos só desde 2007)
  const ref = referencia(cobertos, ano, ultimo);
  if (ref === null) return <Kpi rotulo={rotulo} valor={t('fora da cobertura', 'outside coverage')} nota={`${NOME_FONTE[chave as FonteChave]()}: ${faixaAnos(cobertos)}`} dica={dica} />;
  const r = serie.find((x) => Number(x.ano) === ref);
  const v = num(r?.[coluna]);
  const cond = condicaoDado(coluna, v, ref, fontes);
  return (
    <Kpi rotulo={rotulo} valor={v === null ? t('sem registro', 'no record') : monetario ? reais(v) : numero(v)} dica={dica}
      nota={<>{ref}{nota ? <> · {nota(r, ref)}</> : null}{cond === 'zero_registrado' ? ` · ${rotuloCondicao(cond)}` : ''}{cond === 'preliminar' ? ` · ${rotuloCondicao(cond)}` : ''}</>} />
  );
}

/** Título de um bloco da visão geral, com o ano de referência de cada fonte que o compõe. */
function BlocoTitulo({ titulo, refs, id }: { titulo: string; refs: [FonteChave, number | null][]; id?: string }) {
  // com id, o bloco é um título (h3) que o índice da página encontra e para onde o foco vai ao seguir o link
  const Raiz = id ? 'h3' : 'p';
  return (
    <Raiz className={id ? 'nota-base bloco-saude' : 'nota-base'} {...(id ? { id, 'data-indice': titulo, tabIndex: -1 } : {})}>
      <strong>{titulo}</strong> · {refs.map(([k, a]) => `${NOME_FONTE[k]()}: ${a ?? t('fora da cobertura', 'outside coverage')}`).join(' · ')}
    </Raiz>
  );
}

/** Despesa em saúde por habitante (SIOPS): bloco à parte dos valores pagos pelo SUS (SIH e SIA), com fonte e ano explícitos. */
function BlocoSiops({ ano, ultimo }: { ano: number; ultimo: boolean }) {
  const { f, meta } = useSaude();
  const cod = f.alvo && f.alvo.esfera !== 'E' ? f.alvo.cod_ibge : null;
  const ente = useApi<Linha[]>(cod ? 'se_ente' : null, { ente: cod ?? undefined });
  const grupo = useApi<Linha[]>(cod ? null : 'se_grupo', { esfera: 'M', uf: f.uf ?? undefined });
  const dados = (cod ? ente.dados : grupo.dados) ?? [];
  const validos = dados.filter((r) => num(r.saude_hab) !== null);
  if ((cod ? ente.carregando : grupo.carregando) || !validos.length) return null;
  const cobertos = validos.map((r) => Number(r.ano));
  const ref = referencia(cobertos, ano, ultimo);
  const r = ref === null ? undefined : validos.find((x) => Number(x.ano) === ref);
  const escopo = cod ? f.rotulo : f.uf ? t(`municípios de ${f.uf}`, `municipalities in ${f.uf}`) : t('municípios do Brasil', 'municipalities in Brazil');
  return (
    <>
      <h3 className="nota-base bloco-saude" id="saude-despesas" data-indice={t('Despesa em saúde (SIOPS)', 'Health spending (SIOPS)')} tabIndex={-1}>
        <strong>{t('Despesa em saúde (SIOPS)', 'Health spending (SIOPS)')}</strong> · SIOPS: {ref ?? t('fora da cobertura', 'outside coverage')} · {escopo} ·{' '}
        {t(`em reais do ano-base do IPCA (${meta.baseIpca}); é a despesa declarada pela prefeitura, separada dos valores pagos pelo SUS (SIH e SIA)`,
          `in reais of the IPCA base year (${meta.baseIpca}); it is the spending declared by the municipality, separate from the amounts paid by SUS (SIH and SIA)`)}
      </h3>
      <div className="kpis kpis-4">
        <Kpi rotulo={t('Despesa total com saúde por habitante', 'Total health spending per inhabitant')}
          valor={r ? reais(num(r.saude_hab)) : t('fora da cobertura', 'outside coverage')}
          nota={r ? `SIOPS ${ref}` : `SIOPS: ${faixaAnos(cobertos)}`}
          dica={<Dica rotulo={t('Fonte', 'Source')}>{t('Despesa total com saúde (todas as fontes de recurso) ÷ população declarada no SIOPS, em reais do ano-base do IPCA. Não é o valor pago pelo SUS por procedimento ou internação.', 'Total health spending (all resource sources) ÷ population declared in SIOPS, in reais of the IPCA base year. It is not the amount SUS paid per procedure or admission.')}</Dica>} />
        <Kpi rotulo={t('Recursos próprios por habitante', 'Own resources per inhabitant')}
          valor={r ? reais(num(r.saude_proprios_hab)) : t('fora da cobertura', 'outside coverage')}
          nota={r ? `SIOPS ${ref}` : `SIOPS: ${faixaAnos(cobertos)}`} />
      </div>
    </>
  );
}

/**
 * Índice da visão geral: links (âncoras) para os blocos que a página realmente exibe. Os blocos se anunciam no DOM
 * (`data-indice`), então o que chega depois (como a despesa do SIOPS, que carrega à parte) entra no índice quando aparece e
 * um bloco ausente nunca tem link. Com âncora no endereço (acesso direto ou recarga), a página rola até o bloco e leva o
 * foco a ele assim que existir, e refaz a rolagem se outro bloco carregar acima dele, até o usuário interagir.
 */
function IndiceSaude({ raiz }: { raiz: React.RefObject<HTMLElement | null> }) {
  const { hash, search, key } = useLocation(); // a chave muda a cada navegação, inclusive ao clicar de novo no mesmo link
  const [itens, setItens] = useState<{ id: string; rotulo: string }[]>([]);
  const interagiu = useRef(false);
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const ler = () => {
      const novos = [...el.querySelectorAll<HTMLElement>('[data-indice]')].map((e) => ({ id: e.id, rotulo: e.dataset.indice ?? '' }));
      setItens((a) => (JSON.stringify(a) === JSON.stringify(novos) ? a : novos));
    };
    ler();
    const o = new MutationObserver(ler);
    o.observe(el, { childList: true, subtree: true });
    return () => o.disconnect();
  }, [raiz]);
  useEffect(() => {
    const marcar = () => { interagiu.current = true; };
    const eventos = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    return () => eventos.forEach((e) => window.removeEventListener(e, marcar));
  }, []);
  useEffect(() => { interagiu.current = false; }, [hash, key]);
  useEffect(() => {
    if (!hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return; // âncora malformada (ex.: %E0%A4%A): ignorada, a página segue normal
    }
    const alvo = document.getElementById(id);
    if (!alvo || !alvo.hasAttribute('data-indice') || interagiu.current) return;
    alvo.scrollIntoView({ block: 'start' }); // a margem de rolagem (scroll-padding-top) desconta o cabeçalho fixo, que muda de altura
    alvo.focus({ preventScroll: true });
  }, [hash, key, itens]);
  if (itens.length < 2) return null;
  return (
    <nav className="indice-saude" aria-label={t('Nesta página', 'On this page')}>
      <span className="indice-rotulo">{t('Ir para', 'Jump to')}</span>
      <ul>
        {itens.map((i) => (
          <li key={i.id}><Link to={{ search, hash: `#${i.id}` }}>{i.rotulo}</Link></li>
        ))}
      </ul>
    </nav>
  );
}

// ---------------- visão geral ----------------

const CARTOES = {
  materno: ['mortalidade_materna', 'baixo_peso', 'cesareas', 'pre_natal'],
  mortalidade: ['mortalidade_geral', 'mal_definidas', 'dcnt_prematura', 'homicidios'],
  rede: ['internacoes_fora', 'mortalidade_hospitalar', 'leitos_sus_mil', 'medicos_mil'],
  vigilancia: ['dengue_incidencia', 'dengue_letalidade', 'chik_incidencia', 'tb_incidencia', 'hans_deteccao'],
  oncologia: ['cito_25_64', 'cito_alterados', 'mamo_50_69', 'cancer_registros'],
};

export function SaudeVisaoGeral() {
  const { ano, semAno, escopo, rotulo, temDados, meta, fontes } = useSaude();
  const { search } = useLocation();
  const serie = useApi<Linha[]>(temDados ? 'saude_serie' : null, escopo);
  const dados = serie.dados ?? [];
  const refDe = (k: FonteChave) => referencia(fontes[k]?.anos ?? [], ano, semAno);
  const anoSim = refDe('sim');
  const a = dados.find((r) => Number(r.ano) === anoSim);
  const caps = CAPITULOS().map(([k, n]) => [n, num(a?.[k])] as const).filter(([, v]) => v !== null && v > 0).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0));
  const opcaoCaps = useMemo(() => barras(caps.map(([n]) => n), caps.map(([, v]) => v), (v) => numero(v), true), [serie.dados, anoSim]); // eslint-disable-line react-hooks/exhaustive-deps
  const infantil = indicador('mortalidade_infantil');
  const anosS = dados.map((r) => Number(r.ano));
  const opcaoInf = useMemo(() => linhas(anosS, [
    { nome: t('Infantil', 'Infant'), valores: dados.map((r) => calcular(infantil, r)) },
    { nome: t('Neonatal', 'Neonatal'), valores: dados.map((r) => calcular(indicador('mortalidade_neonatal'), r)) },
    { nome: t('Pós-neonatal', 'Post-neonatal'), valores: dados.map((r) => calcular(indicador('mortalidade_pos_neonatal'), r)) },
  ], (v) => numero1Local(v)), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const cartoes = (ids: string[]) => ids.map((id) => <KpiIndicador key={id} ind={indicador(id)} serie={dados} ano={ano} ultimo={semAno} fontes={fontes} />);

  // mortalidade infantil no triênio terminando no ano de referência: soma dos óbitos ÷ soma dos nascidos, com os dois totais
  const cobInf = anosDoIndicador(infantil, fontes);
  const refInf = referencia(cobInf, ano, semAno);
  const tri = refInf !== null && cobInf.includes(refInf - 2) && cobInf.includes(refInf - 1) ? calcularJanela(infantil, dados, refInf - 2, refInf) : null;
  const notaTri = tri && tri.valor !== null
    ? t(`triênio ${refInf! - 2}–${refInf}: ${formatar(infantil, tri.valor)} (${numero(tri.numerador)} óbitos ÷ ${numero(tri.denominador)} nascidos)`,
      `three years ${refInf! - 2}–${refInf}: ${formatar(infantil, tri.valor)} (${numero(tri.numerador)} deaths ÷ ${numero(tri.denominador)} births)`)
    : null;
  const refNasc = refDe('sinasc');
  const natalidade = indicador('natalidade');
  const blocos = useRef<HTMLDivElement>(null);

  if (!temDados) return <><h2 className="titulo-pagina">{t('Saúde', 'Health')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Saúde: visão geral', 'Health: overview')}</h2>
      <p className="subtitulo">{rotulo} · {semAno ? t('último ano de cada fonte', 'latest year of each source') : ano} · {t('nascimentos, óbitos, internações e rede de saúde', 'births, deaths, admissions and health network')} <Dica rotulo={t('Fonte', 'Source')}>{fonteSaude()}</Dica></p>
      <BarraFiltros comUltimo ultimoPadrao />
      <AvisoAno ano={ano} />
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
        vazio={!serie.carregando && !serie.dados?.length && t('Sem registros para este recorte.', 'No records for this scope.')} />
      <IndiceSaude raiz={blocos} />
      <div ref={blocos}>
      {serie.dados && serie.dados.length > 0 && (
        <>
          <BlocoTitulo id="saude-maternidade" titulo={t('Maternidade e infância', 'Maternity and childhood')} refs={[['sinasc', refNasc], ['sim', anoSim]]} />
          <div className="kpis kpis-4">
            <KpiContagem rotulo={t('Nascidos vivos', 'Live births')} coluna="nascidos" serie={dados} ano={ano} ultimo={semAno} fontes={fontes}
              nota={(r) => t(`natalidade: ${formatar(natalidade, calcular(natalidade, r))} por mil hab.`, `birth rate: ${formatar(natalidade, calcular(natalidade, r))} per 1,000`)} />
            <KpiIndicador ind={infantil} serie={dados} ano={ano} ultimo={semAno} fontes={fontes}
              extra={[notaTri, t(`neonatal ${formatar(infantil, calcular(indicador('mortalidade_neonatal'), dados.find((r) => Number(r.ano) === refInf)))}`, `neonatal ${formatar(infantil, calcular(indicador('mortalidade_neonatal'), dados.find((r) => Number(r.ano) === refInf)))}`)].filter(Boolean).join(' · ')} />
            {cartoes(CARTOES.materno)}
          </div>

          <BlocoTitulo id="saude-mortalidade" titulo={t('Mortalidade', 'Mortality')} refs={[['sim', anoSim], ['populacao_svs', refDe('populacao_svs')]]} />
          <div className="kpis kpis-4">
            <KpiContagem rotulo={t('Óbitos (não fetais)', 'Deaths (non-fetal)')} coluna="obitos" serie={dados} ano={ano} ultimo={semAno} fontes={fontes}
              nota={(r) => t(`taxa bruta: ${formatar(indicador('mortalidade_geral'), calcular(indicador('mortalidade_geral'), r))} por mil hab. · fetais: ${numero(num(r?.obitos_fetais))}`,
                `crude rate: ${formatar(indicador('mortalidade_geral'), calcular(indicador('mortalidade_geral'), r))} per 1,000 · fetal: ${numero(num(r?.obitos_fetais))}`)}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{indicador('mortalidade_geral').nota()}</Dica>} />
            {cartoes(CARTOES.mortalidade)}
          </div>

          <BlocoTitulo id="saude-rede" titulo={t('Rede e acesso', 'Network and access')} refs={[['sih', refDe('sih')], ['cnes', refDe('cnes')], ['sia', refDe('sia')]]} />
          <div className="kpis kpis-4">
            <KpiContagem rotulo={t('Internações (SUS)', 'Admissions (SUS)')} coluna="int_total" serie={dados} ano={ano} ultimo={semAno} fontes={fontes}
              nota={(r) => t(`${formatar(indicador('internacoes_mil'), calcular(indicador('internacoes_mil'), r))} por mil hab. · moradores do município`, `${formatar(indicador('internacoes_mil'), calcular(indicador('internacoes_mil'), r))} per 1,000 · residents`)}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{indicador('internacoes_mil').nota()}</Dica>} />
            <KpiContagem rotulo={t('Valor pago nas internações (total)', 'Amount paid for admissions (total)')} coluna="int_valor_real" monetario serie={dados} ano={ano} ultimo={semAno} fontes={fontes}
              nota={() => t('R$ de 2025, tabela do SUS', 'R$ of 2025, SUS table')}
              dica={<Dica rotulo={t('Fórmula', 'Formula')}>{indicador('valor_por_internacao').nota()}</Dica>} />
            <KpiIndicador ind={indicador('valor_por_internacao')} serie={dados} ano={ano} ultimo={semAno} fontes={fontes} />
            {cartoes(CARTOES.rede)}
            <KpiContagem rotulo={t('Procedimentos ambulatoriais (SIA)', 'Outpatient procedures (SIA)')} coluna="amb_qtd" serie={dados} ano={ano} ultimo={semAno} fontes={fontes}
              nota={() => <>{t('procedimentos aprovados, pelo município do estabelecimento', 'approved procedures, by municipality of the facility')} · <Link to={`/datasus/ambulatorial${search}`}>{t('produção ambulatorial', 'outpatient output')}</Link></>} />
          </div>
          <p className="nota-base">
            <Link to={`/datasus/rede${search}`}>{t('Ver rede e acesso: moradores × hospitais do município, leitos, UBS e profissionais', 'See network and access: residents × municipal hospitals, beds, primary care units and staff')}</Link>
          </p>
          <BlocoSiops ano={ano} ultimo={semAno} />

          <BlocoTitulo id="saude-vigilancia" titulo={t('Vigilância', 'Surveillance')} refs={[['sinan', refDe('sinan')], ['populacao_svs', refDe('populacao_svs')]]} />
          <div className="kpis kpis-4">{cartoes(CARTOES.vigilancia)}</div>

          <BlocoTitulo id="saude-oncologia" titulo={t('Oncologia', 'Oncology')} refs={[['siscan', refDe('siscan')], ['oncologia', refDe('oncologia')]]} />
          <div className="kpis kpis-4">
            {cartoes(CARTOES.oncologia)}
            <DetalheTratamento serie={dados} ano={ano} ultimo={semAno} fontes={fontes} />
          </div>

          <p className="nota-base">{notaResidencia()}</p>
        </>
      )}
      {a && (
        <div className="grade-2" id="saude-graficos" data-indice={t('Gráficos: causas de morte e mortalidade infantil', 'Charts: causes of death and infant mortality')} tabIndex={-1}>
          <CartaoGrafico titulo={t('Óbitos por capítulo da CID-10 (causa básica)', 'Deaths by ICD-10 chapter (underlying cause)')} desc={`${rotulo} · ${anoSim}`}
            tabela={<TabelaCapitulos linha={a} ano={anoSim!} rotulo={rotulo} versao={meta.geradoEm} />}>
            <Grafico opcao={opcaoCaps} nome="saude_capitulos" altura={420} />
          </CartaoGrafico>
          <CartaoGrafico titulo={t('Mortalidade infantil e componentes', 'Infant mortality and components')} desc={`${rotulo} · ${t('por mil nascidos vivos', 'per 1,000 live births')}`}
            acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{infantil.nota()}</Dica>}
            tabela={<TabelaSerie nome="saude_mortalidade_infantil" anos={anosS} colunas={[
              { titulo: t('Nascidos vivos', 'Live births'), valores: dados.map((r) => num(r.nascidos)), formato: numero },
              { titulo: t('Óbitos infantis', 'Infant deaths'), valores: dados.map((r) => num(r.infantis)), formato: numero },
              { titulo: t('Infantil (‰)', 'Infant (‰)'), valores: dados.map((r) => calcular(infantil, r)), formato: numero1Local },
              { titulo: t('Neonatal (‰)', 'Neonatal (‰)'), valores: dados.map((r) => calcular(indicador('mortalidade_neonatal'), r)), formato: numero1Local },
              { titulo: t('Pós-neonatal (‰)', 'Post-neonatal (‰)'), valores: dados.map((r) => calcular(indicador('mortalidade_pos_neonatal'), r)), formato: numero1Local },
            ]} metadados={metadadosIndicador(infantil, fontes, rotulo)} />}>
            <Grafico opcao={opcaoInf} nome="saude_mortalidade_infantil" />
          </CartaoGrafico>
        </div>
      )}
      </div>
    </>
  );
}

/** Tratamento em até 60 dias: o funil completo do indicador (diagnósticos, com tratamento, datas válidas, até 60 dias). */
function DetalheTratamento({ serie, ano, ultimo, fontes }: { serie: Linha[]; ano: number; ultimo: boolean; fontes: FontesMeta }) {
  const ind = indicador('cancer_60_dias');
  const cob = anosDoIndicador(ind, fontes);
  const ref = referencia(cob, ano, ultimo);
  if (ref === null) return <KpiIndicador ind={ind} serie={serie} ano={ano} ultimo={ultimo} fontes={fontes} />;
  const r = serie.find((x) => Number(x.ano) === ref);
  const casos = num(r?.onco_casos);
  const tratados = num(r?.onco_tratados);
  const validos = num(r?.onco_trat_validos);
  const ate60 = num(r?.onco_trat_60d);
  const v = calcular(ind, r);
  return (
    <Kpi rotulo={ind.nome()} valor={v === null ? t('sem registro', 'no record') : formatar(ind, v)}
      dica={<Dica rotulo={t('Fórmula', 'Formula')}>{ind.nota()}</Dica>}
      nota={<>
        {ref} · {numero(ate60)} {t('de', 'of')} {numero(validos)} {t('registros com datas válidas', 'records with valid dates')}
        <br />{t('Diagnósticos', 'Diagnoses')}: {numero(casos)} · {t('com tratamento registrado', 'with treatment recorded')}: {numero(tratados)} · {t('com datas válidas', 'with valid dates')}: {numero(validos)} · {t('em até 60 dias', 'within 60 days')}: {numero(ate60)}
        <Atalhos ind={ind} ano={ref} />
      </>} />
  );
}

const numero1Local = (v: number | null) => (v === null ? '–' : v.toLocaleString(local(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }));
export { numero1Local };

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

// ---------------- tabela do indicador ----------------

/**
 * Tabela de um indicador para o próprio recorte (município, UF ou Brasil): numerador, denominador, valor, unidade e ano de
 * referência em destaque, mesmo quando o município fica fora do ranking pelo mínimo do denominador.
 */
export function SaudeTabela() {
  const { ano, semAno, escopo, rotulo, temDados, fontes, meta } = useSaude();
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const ind = indicador(params.get('ind'));
  const metadados = useMetadados();
  const mudar = (id: string) => {
    const b = new URLSearchParams(params);
    b.set('ind', id);
    setParams(b, { replace: true });
  };
  const colunas = useColunasSaude();
  const disponivel = disponivelNosDados(ind, colunas);
  const serie = useApi<Linha[]>(temDados && disponivel ? 'saude_serie' : null, escopo);
  const cob = anosDoIndicador(ind, fontes);
  const ref = referencia(cob, ano, semAno);
  const dados = (serie.dados ?? []).filter((r) => cob.includes(Number(r.ano)));
  const linhaRef = ref === null ? undefined : dados.find((r) => Number(r.ano) === ref);
  const n = num(linhaRef?.[ind.numerador]);
  const d = num(linhaRef?.[ind.denominador]);
  const v = calcular(ind, linhaRef);
  const cond = ref === null ? 'fora_cobertura' : condicaoDado(ind.numerador, n, ref, fontes);
  const link = (caminho: string) => {
    const p = new URLSearchParams(search);
    p.set('ind', ind.id);
    if (ref !== null) p.set('ano', String(ref));
    return `${caminho}?${p}`;
  };
  const condDaLinha = (r: Linha) => rotuloCondicao(condicaoDado(ind.numerador, num(r[ind.numerador]), Number(r.ano), fontes));

  if (!temDados) return <><h2 className="titulo-pagina">{t('Saúde: tabela do indicador', 'Health: indicator table')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Saúde: tabela do indicador', 'Health: indicator table')}</h2>
      <p className="subtitulo">{rotulo} <Dica rotulo={t('Fonte', 'Source')}>{fonteCurta(ind)}. {fonteSaude()}</Dica></p>
      <BarraFiltros comUltimo ultimoPadrao />
      <AvisoAno ano={ano} />
      <section className="cartao">
        <div className="filtros"><SeletorIndicador valor={ind.id} mudar={mudar} /></div>
        <p className="desc">{ind.nota()}</p>
      </section>
      {!disponivel && <p className="aviso" role="status">{t(`${ind.nome()}: ${TEXTO_INDISPONIVEL()}. Escolha outro indicador.`, `${ind.nome()}: ${TEXTO_INDISPONIVEL()}. Choose another indicator.`)}</p>}
      <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar} />
      {disponivel && serie.dados && (
        <>
          <div className="destaque-ente" role="status">
            {ref === null ? (
              <><strong>{ind.nome()}</strong> · {rotulo}: {t(`ano fora da cobertura (${fonteCurta(ind)}: ${faixaAnos(cob)}).`, `year outside coverage (${fonteCurta(ind)}: ${faixaAnos(cob)}).`)}</>
            ) : (
              <>
                <strong>{ind.nome()}</strong> · {rotulo} · {t('ano de referência', 'reference year')} <strong>{ref}</strong>
                <br />{nomeContagem(ind.numerador)}: <strong>{linhaRef ? numero(n) : '–'}</strong> · {nomeContagem(ind.denominador)}: <strong>{linhaRef ? numero(d) : '–'}</strong>
                {' · '}{t('valor', 'value')}: <strong>{v === null ? t('sem registro', 'no record') : formatar(ind, v)}</strong> ({ind.unidade()})
                <br />{rotuloCondicao(cond)}
                {linhaRef && d !== null && d < ind.minimo && (
                  <><br />{t(`Denominador de ${numero(d)}, abaixo do mínimo de ${numero(ind.minimo)} do ranking: o valor aparece aqui, mas este recorte não entra na comparação entre municípios, e poucos casos fazem a taxa oscilar muito.`,
                    `Denominator of ${numero(d)}, below the ranking minimum of ${numero(ind.minimo)}: the value appears here, but this scope is not in the comparison between municipalities, and few cases make the rate very volatile.`)}</>
                )}
              </>
            )}
          </div>
          <p className="nota-base">
            <Link to={link('/datasus/evolucao')}>{t('série', 'series')}</Link>{' · '}<Link to={link('/datasus/rankings')}>{t('ranking entre municípios', 'ranking between municipalities')}</Link>
          </p>
          <section className="cartao">
            <div className="rolagem">
              <table>
                <thead><tr><th>{t('Ano', 'Year')}</th><th>{nomeContagem(ind.numerador)}</th><th>{nomeContagem(ind.denominador)}</th><th>{t('Valor', 'Value')} ({ind.unidade()})</th><th>{t('Condição do dado', 'Data condition')}</th></tr></thead>
                <tbody>
                  {dados.map((r) => (
                    <tr key={String(r.ano)} className={Number(r.ano) === ref ? 'destaque' : undefined}>
                      <td>{r.ano}</td><td>{numero(num(r[ind.numerador]))}</td><td>{numero(num(r[ind.denominador]))}</td>
                      <td>{formatar(ind, calcular(ind, r))}</td><td>{condDaLinha(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <BotoesExportar nome={`saude_tabela_${ind.id}`} obter={() => ({
              colunas: [t('Ano', 'Year'), nomeContagem(ind.numerador), nomeContagem(ind.denominador), `${t('Valor', 'Value')} (${ind.unidade()})`, t('Condição do dado', 'Data condition'), t('Ano de referência', 'Reference year')],
              linhas: dados.map((r) => [Number(r.ano), num(r[ind.numerador]), num(r[ind.denominador]), calcular(ind, r), condDaLinha(r), Number(r.ano) === ref ? t('sim', 'yes') : '']),
              metadados: metadados([...metadadosIndicador(ind, fontes, rotulo), [t('Ano de referência', 'Reference year'), ref === null ? t('fora da cobertura', 'outside coverage') : String(ref)],
                [t('Numerador', 'Numerator'), nomeContagem(ind.numerador)], [t('Denominador', 'Denominator'), nomeContagem(ind.denominador)], [t('Versão da base', 'Data version'), meta.geradoEm]],
              { anoSelecionado: false, periodo: faixaAnos(dados.map((r) => Number(r.ano))), precosReais: !!ind.monetario }),
            })} />
          </section>
        </>
      )}
      <p className="nota-base">{notaResidencia()}</p>
    </>
  );
}

// ---------------- evolução ----------------

function SeletorIndicador({ valor, mudar }: { valor: string; mudar: (id: string) => void }) {
  const grupos = [...new Set(INDICADORES.map((i) => i.grupo()))];
  const colunas = useColunasSaude();
  return (
    <div className="campo">
      <label htmlFor="s-ind">{t('Indicador', 'Indicator')}</label>
      <select id="s-ind" value={valor} onChange={(e) => mudar(e.target.value)}>
        {grupos.map((g) => (
          <optgroup key={g} label={g}>
            {INDICADORES.filter((i) => i.grupo() === g).map((i) => {
              const disp = disponivelNosDados(i, colunas);
              return <option key={i.id} value={i.id} disabled={!disp}>{i.nome()}{disp ? '' : ` — ${TEXTO_INDISPONIVEL()}`}</option>;
            })}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

export function SaudeEvolucao() {
  const { escopo, rotulo, temDados, uf, municipio, meta, fontes } = useSaude();
  const [params, setParams] = useSearchParams();
  const ind = indicador(params.get('ind'));
  const mudar = (id: string) => {
    const b = new URLSearchParams(params);
    b.set('ind', id);
    setParams(b, { replace: true });
  };
  const principal = useApi<Linha[]>(temDados ? 'saude_serie' : null, escopo);
  const colunasEv = useColunasSaude();
  const disponivelEv = disponivelNosDados(ind, colunasEv);
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
  // a tabela e o arquivo trazem os anos que a fonte do indicador cobre; o gráfico mostra a faixa inteira
  const cobEv = anosDoIndicador(ind, fontes);
  const noPeriodo = (i: number) => cobEv.length === 0 || cobEv.includes(anosS[i]);
  const formato = (v: number) => formatar(ind, v);
  const marcas = ind.id === 'prematuros' && anosS.includes(2011) ? [{ x: '2011', rotulo: t('método', 'method') }] : [];
  const opcao = useMemo(() => linhas(anosS, series, formato, marcas), [principal.dados, refUf.dados, refBr.dados, ind.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!temDados) return <><h2 className="titulo-pagina">{t('Saúde: evolução', 'Health: trends')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Saúde: evolução', 'Health: trends')}</h2>
      <p className="subtitulo">{rotulo} <Dica rotulo={t('Fonte', 'Source')}>{fonteCurta(ind)}. {fonteSaude()}</Dica></p>
      <BarraFiltros semAno />
      <section className="cartao">
        <div className="filtros"><SeletorIndicador valor={ind.id} mudar={mudar} /></div>
        <p className="desc">{ind.nota()}</p>
      </section>
      {!disponivelEv && <p className="aviso" role="status">{t(`${ind.nome()}: ${TEXTO_INDISPONIVEL()}. Escolha outro indicador.`, `${ind.nome()}: ${TEXTO_INDISPONIVEL()}. Choose another indicator.`)}</p>}
      <Estado carregando={principal.carregando} erro={principal.erro} tentarNovamente={principal.recarregar} />
      {principal.dados && disponivelEv && (
        <CartaoGrafico titulo={ind.nome()} desc={`${rotulo} · ${ind.unidade()}`}
          tabela={<TabelaSerie nome={`saude_${ind.id}`} anos={anosS.filter((_, i) => noPeriodo(i))} valoresReais={!!ind.monetario} colunas={[
            { titulo: `${nomeContagem(ind.numerador)} (${rotulo})`, valores: (principal.dados ?? []).map((r) => num(r[ind.numerador])).filter((_, i) => noPeriodo(i)), formato: numero },
            { titulo: `${nomeContagem(ind.denominador)} (${rotulo})`, valores: (principal.dados ?? []).map((r) => num(r[ind.denominador])).filter((_, i) => noPeriodo(i)), formato: numero },
            ...series.map((s) => ({ titulo: `${s.nome} (${ind.unidade()})`, valores: s.valores.filter((_, i) => noPeriodo(i)), formato: (v: number | null) => formatar(ind, v) })),
          ]} metadados={[...metadadosIndicador(ind, fontes, rotulo), [t('Numerador', 'Numerator'), nomeContagem(ind.numerador)],
            [t('Denominador', 'Denominator'), nomeContagem(ind.denominador)], [t('Versão da base', 'Data version'), meta.geradoEm]]} />}>
          <Grafico opcao={opcao} nome={`saude_${ind.id}`} />
        </CartaoGrafico>
      )}
      {principal.dados && disponivelEv && <NotaCondicoes ind={ind} dados={principal.dados} fontes={fontes} />}
      <p className="nota-base">{notaResidencia()} {t('A população da SVS/MS começa em 2000: antes disso, as taxas por habitante ficam vazias; as por nascidos vivos começam em 1996.',
        'SVS/MS population starts in 2000: before that, rates per inhabitant are empty; rates per live birth start in 1996.')}</p>
    </>
  );
}

/** O que cada ponto sem valor da série quer dizer: fora da cobertura, sem registro no ano ou zero registrado. */
function NotaCondicoes({ ind, dados, fontes }: { ind: Indicador; dados: Linha[]; fontes: FontesMeta }) {
  const cob = anosDoIndicador(ind, fontes);
  const dentro = dados.filter((r) => cob.includes(Number(r.ano)));
  const lista = (c: 'zero_registrado' | 'ausente' | 'preliminar') =>
    dentro.filter((r) => condicaoDado(ind.numerador, num(r[ind.numerador]), Number(r.ano), fontes) === c).map((r) => r.ano);
  const zeros = lista('zero_registrado');
  const ausentes = lista('ausente');
  const prelim = lista('preliminar');
  const preliminarNao = fontes[fonteDaColuna(ind.numerador)]?.preliminar_nao_incluido ?? [];
  return (
    <p className="nota-base" role="note">
      {t(`Cobertura da fonte (${fonteCurta(ind)}): ${faixaAnos(cob)}; os anos fora dela ficam sem valor. `, `Source coverage (${fonteCurta(ind)}): ${faixaAnos(cob)}; years outside it have no value. `)}
      {ausentes.length > 0 && t(`Sem registro no ano, dentro da cobertura: ${ausentes.join(', ')}. `, `No record in the year, within coverage: ${ausentes.join(', ')}. `)}
      {zeros.length > 0 && t(`Zero registrado: ${zeros.join(', ')}. `, `Recorded zero: ${zeros.join(', ')}. `)}
      {prelim.length > 0 && t(`Dado preliminar: ${prelim.join(', ')}. `, `Preliminary data: ${prelim.join(', ')}. `)}
      {preliminarNao.length > 0 && t(`O DATASUS só publica ${preliminarNao.join(' e ')} como preliminar e o painel usa apenas arquivos finais. `, `DATASUS publishes ${preliminarNao.join(' and ')} only as preliminary and the panel uses final files only. `)}
      {ind.alerta ? `${ind.alerta().charAt(0).toUpperCase()}${ind.alerta().slice(1)}.` : ''}
    </p>
  );
}

// ---------------- rankings ----------------

type LinhaRanking = Linha & { _valor: number | null };
type Janela = { valor: number | null; num: number; den: number };

/** Indicadores com o triênio (soma dos óbitos ÷ soma dos nascidos): os que têm nascidos vivos no denominador. */
const aceitaTrienio = (ind: Indicador) => ind.denominador === 'nascidos';

/** Posições com empates competitivos (1, 2, 2, 4) numa lista já ordenada pelo valor. */
function posicoesLocais(ordenados: LinhaRanking[]) {
  const m = new Map<unknown, number>();
  let pos = 0;
  ordenados.forEach((r, i) => {
    if (i === 0 || r._valor !== ordenados[i - 1]._valor) pos = i + 1;
    m.set(r.cod_ibge, pos);
  });
  return m;
}

export function SaudeRankings() {
  const { ano: anoFiltro, semAno, temDados, f, uf, meta, fontes } = useSaude();
  const [params, setParams] = useSearchParams();
  const { search } = useLocation();
  const ind = indicador(params.get('ind'));
  // disponibilidade efetiva: os anos cobertos pelas fontes do numerador e do denominador (não só os do SIM)
  const anosInd = anosDoIndicador(ind, fontes);
  const ano = semAno ? anosInd.at(-1) ?? anoFiltro : anoFiltro;
  const minimo = params.get('min') !== null ? Number(params.get('min')) : ind.minimo;
  const desc = params.get('ord') !== 'asc';
  const trienio = params.get('per') === 'trienio' && aceitaTrienio(ind);
  const janela = trienio ? 3 : 1;
  const definir = (mudancas: Record<string, string | null>) => {
    const b = new URLSearchParams(params);
    for (const [k, v] of Object.entries(mudancas)) if (v === null) b.delete(k); else b.set(k, v);
    setParams(b, { replace: true });
  };
  const anosJanela = Array.from({ length: janela }, (_, i) => ano - i).reverse();
  const colunas0 = useColunasSaude();
  const disponivel = disponivelNosDados(ind, colunas0);
  const coberto = disponivel && anosJanela.every((a) => anosInd.includes(a));
  const de = anosJanela[0];
  const vista = params.get('vista') === 'evolucao' ? 'evolucao' : 'anual';
  const colunas = `${ind.numerador},${ind.denominador}`;
  const dados = useApi<Linha[]>(temDados && coberto && !trienio && vista === 'anual' ? 'saude_municipios' : null, { uf: uf ?? undefined, ano });
  const atual = useApi<Linha[]>(temDados && coberto && trienio && vista === 'anual' ? 'saude_janela' : null, { uf: uf ?? undefined, de, ate: ano, colunas });
  const anterior = useApi<Linha[]>(temDados && coberto && trienio && vista === 'anual' && anosJanela.every((a) => anosInd.includes(a - 3)) ? 'saude_janela' : null,
    { uf: uf ?? undefined, de: de - 3, ate: ano - 3, colunas });
  const [buscaNome, setBuscaNome] = useState('');
  const [todos, setTodos] = useState(false);

  /** Um município no período: a razão das somas, só com todos os anos da janela registrados e o denominador mínimo. */
  const janelaDe = (r: Linha, n: number): Janela | null => {
    const ns = num(r[ind.numerador]);
    const ds = num(r[ind.denominador]);
    if (num(r[`n_${ind.numerador}`]) !== n || num(r[`n_${ind.denominador}`]) !== n || ns === null || ds === null || ds <= 0) return null;
    return { valor: (ns / ds) * ind.fator, num: ns, den: ds };
  };
  const anteriores = useMemo(() => {
    const m = new Map<unknown, Janela>();
    for (const r of anterior.dados ?? []) {
      const j = janelaDe(r, janela);
      if (j && j.den >= minimo) m.set(r.cod_ibge, j);
    }
    return m;
  }, [anterior.dados, ind.id, minimo, janela]); // eslint-disable-line react-hooks/exhaustive-deps
  const universo = useMemo(() => {
    if (trienio) {
      return (atual.dados ?? []).flatMap((r) => {
        const j = janelaDe(r, janela);
        return j && j.den >= minimo ? [{ ...r, [ind.numerador]: j.num, [ind.denominador]: j.den, _valor: j.valor } as LinhaRanking] : [];
      });
    }
    return (dados.dados ?? [])
      .map((r) => ({ ...r, _valor: calcular(ind, r) }) as LinhaRanking)
      .filter((r) => r._valor !== null && (num(r[ind.denominador]) ?? 0) >= minimo);
  }, [dados.dados, atual.dados, ind.id, minimo, trienio]); // eslint-disable-line react-hooks/exhaustive-deps
  const ordenados = useMemo(() => [...universo].sort((x, y) => ((x._valor ?? 0) - (y._valor ?? 0)) * (desc ? -1 : 1)), [universo, desc]);
  // posições da classificação comum dos rankings (empates com a mesma posição: 1, 2, 2, 4), as mesmas da evolução
  const classificacao = useApi<Classificacao>(temDados && coberto && !trienio && vista === 'anual' ? 'ranking_posicoes' : null, {
    dominio: 'saude', ind: ind.id, ordem: desc ? 'desc' : 'asc', de: ano, ate: ano, uf: uf ?? undefined, min: minimo, lista: 1,
  });
  const posicaoApi = useMemo(() => new Map<unknown, number | null>((classificacao.dados?.lista ?? []).map((r) => [r.cod_ibge, uf ? r.posicao_uf : r.posicao_br])), [classificacao.dados, uf]);
  const posicaoTri = useMemo(() => posicoesLocais(ordenados), [ordenados]);
  const posicao = trienio ? posicaoTri : posicaoApi;
  const enteFiltros = f.alvo && f.alvo.esfera !== 'E' ? (f.alvo.esfera === 'D' ? 5300108 : f.alvo.cod_ibge) : null;
  const termo = buscaNome.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filtrados = termo ? ordenados.filter((r) => String(r.nome).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(termo)) : ordenados;
  const visiveis = todos || termo ? filtrados : filtrados.slice(0, 50);
  const escolhido = f.alvo && f.alvo.esfera !== 'E' ? ordenados.find((r) => r.cod_ibge === (f.alvo!.esfera === 'D' ? 5300108 : f.alvo!.cod_ibge)) : undefined;
  const escopoNome = uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios do Brasil', 'Municipalities in Brazil');
  const valores = universo.map((r) => r._valor!).sort((a, b) => a - b);
  const mediana = valores.length ? (valores.length % 2 ? valores[(valores.length - 1) / 2] : (valores[valores.length / 2 - 1] + valores[valores.length / 2]) / 2) : null;
  const opcoesMin = [0, 100, 1000, 5000, 10000, 20000, 100000];
  if (!opcoesMin.includes(ind.minimo)) opcoesMin.push(ind.minimo);
  const periodoTexto = trienio ? `${de}–${ano}` : String(ano);
  const carregandoDados = trienio ? atual.carregando || anterior.carregando : dados.carregando;
  const erroDados = trienio ? atual.erro ?? anterior.erro : dados.erro;
  const recarregarDados = trienio ? atual.recarregar : dados.recarregar;
  const elegiveisAmbos = trienio ? ordenados.filter((r) => anteriores.has(r.cod_ibge)).length : 0;
  const avisoPrel = avisoPreliminarNaoIncluido(ind.numerador, ano, fontes) ?? avisoPreliminarNaoIncluido(ind.denominador, ano, fontes);
  const metadadosBase = (extra: [string, string][] = []): [string, string][] => [
    ...metadadosIndicador(ind, fontes, escopoNome),
    [t('Período do ranking', 'Ranking period'), trienio ? t(`triênio ${de}–${ano}: soma dos ${nomeContagem(ind.numerador).toLowerCase()} ÷ soma de ${nomeContagem(ind.denominador).toLowerCase()} nos três anos`, `three years ${de}–${ano}: sum of ${nomeContagem(ind.numerador).toLowerCase()} ÷ sum of ${nomeContagem(ind.denominador).toLowerCase()} over the three years`) : String(ano)],
    ...extra,
    [t('Residência', 'Residence'), notaResidencia()], [t('Versão da base', 'Data version'), meta.geradoEm],
  ];
  const variacao = (r: LinhaRanking) => {
    const a = anteriores.get(r.cod_ibge);
    if (!a || a.valor === null || r._valor === null) return null;
    return { abs: r._valor - a.valor, rel: a.valor ? (r._valor - a.valor) / a.valor : null, anterior: a };
  };
  const textoVar = (v: ReturnType<typeof variacao>) => (v
    ? `${v.abs > 0 ? '+' : ''}${formatar(ind.tipo === 'proporcao' ? { ...ind, tipo: 'taxa' } : ind, v.abs)}${ind.tipo === 'proporcao' ? ' p.p.' : ''}${v.rel !== null && ind.tipo !== 'proporcao' ? ` (${v.rel > 0 ? '+' : ''}${(v.rel * 100).toLocaleString(local(), { maximumFractionDigits: 1 })}%)` : ''}`
    : '–');
  const opcoesPeriodo = aceitaTrienio(ind) && (
    <div className="campo">
      <label htmlFor="s-per">{t('Período', 'Period')}</label>
      <select id="s-per" value={trienio ? 'trienio' : 'ano'} onChange={(e) => definir({ per: e.target.value === 'trienio' ? 'trienio' : null })}>
        <option value="ano">{t('um ano', 'one year')}</option>
        <option value="trienio">{t('triênio (soma de três anos)', 'three years (sum over three years)')}</option>
      </select>
    </div>
  );

  if (!temDados) return <><h2 className="titulo-pagina">{t('Rankings de saúde', 'Health rankings')}</h2><SemDados /></>;
  return (
    <>
      <h2 className="titulo-pagina">{t('Rankings de saúde', 'Health rankings')}</h2>
      <p className="subtitulo">{escopoNome}{vista === 'evolucao' ? '' : ` · ${periodoTexto}`} <Dica rotulo={t('Fonte', 'Source')}>{fonteCurta(ind)}. {fonteSaude()}</Dica></p>
      <BarraFiltros semAno={vista === 'evolucao'} semBuscaEnte={vista === 'evolucao'} anosCobertos={anosInd} semEnte={t('O município escolhido define a UF do ranking e aparece destacado, com a sua posição.', 'The chosen municipality sets the state of the ranking and is highlighted, with its position.')} />
      <AvisoAno ano={ano} />
      <AlternarVista vista={vista} mudar={(v) => definir({ vista: v === 'evolucao' ? v : null })} />
      {vista === 'evolucao' && !disponivel && <p className="aviso" role="status">{t(`${ind.nome()}: ${TEXTO_INDISPONIVEL()}.`, `${ind.nome()}: ${TEXTO_INDISPONIVEL()}.`)}</p>}
      {vista === 'evolucao' && disponivel && (
        <>
          <EvolucaoPosicao dominio="saude" ind={ind.id} nomeIndicador={ind.nome()} unidade={ind.unidade()} formato={(v) => formatar(ind, v)} monetario={false}
            percentual={ind.tipo === 'proporcao'}
            fonte={fonteCurta(ind)}
            atualizadoEm={String(processadoEm(ind, fontes) ?? meta.geradoEm)}
            minimo={`${nomeContagem(ind.denominador).toLowerCase()} (${numero(minimo)})`}
            indicador={<SeletorIndicador valor={ind.id} mudar={(id) => definir({ ind: id, min: null, per: null })} />}
            opcoes={
              <>
                <div className="campo">
                  <label htmlFor="s-min-ev">{t(`Mínimo: ${nomeContagem(ind.denominador).toLowerCase()}`, `Minimum: ${nomeContagem(ind.denominador).toLowerCase()}`)}</label>
                  <select id="s-min-ev" value={minimo} onChange={(e) => definir({ min: e.target.value })}>
                    {opcoesMin.sort((a, b) => a - b).map((v) => <option key={v} value={v}>{v ? `≥ ${numero(v)}` : t('todos', 'all')}</option>)}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="s-ord-ev">{t('Ordem', 'Order')}</label>
                  <select id="s-ord-ev" value={desc ? 'desc' : 'asc'} onChange={(e) => definir({ ord: e.target.value === 'asc' ? 'asc' : null })}>
                    <option value="desc">{t('maiores primeiro', 'highest first')}</option>
                    <option value="asc">{t('menores primeiro', 'lowest first')}</option>
                  </select>
                </div>
              </>
            }
            ativas={[...(desc ? [] : [t('menores primeiro', 'lowest first')]), ...(minimo !== ind.minimo ? [t(`mínimo de ${numero(minimo)}`, `minimum ${numero(minimo)}`)] : [])]}
            params={{ min: minimo }} ordem={desc ? 'desc' : 'asc'} anos={anosInd} uf={uf} ente={enteFiltros}
            nota={(deNota, ateNota) => ({ curta: [
              ind.id === 'prematuros' && deNota < 2011 && ateNota >= 2011
                ? t('Prematuridade: em 2011 o SINASC mudou o cálculo da idade gestacional e o indicador subiu de patamar; posições e valores antes e depois de 2011 não se comparam diretamente.', 'Preterm births: in 2011 SINASC changed how gestational age is computed and the indicator rose; positions and values before and after 2011 are not directly comparable.') : '',
              ind.denominador.startsWith('pop') && deNota < 2000
                ? t('A população da SVS/MS começa em 2000: antes disso, as taxas por habitante não são calculadas (anos sem posição).', 'SVS/MS population starts in 2000: before that, rates per inhabitant are not computed (unranked years).') : '',
              ind.alerta ? `${ind.alerta().charAt(0).toUpperCase()}${ind.alerta().slice(1)}.` : '',
              t('O ano mais recente pode ser preliminar no DATASUS.', 'The latest year may be preliminary at DATASUS.'),
            ].filter(Boolean).join(' ') })}
            definicoes={[...metadadosIndicador(ind, fontes), [t('Critérios', 'Criteria'), t(`municípios do cadastro com denominador (${nomeContagem(ind.denominador).toLowerCase()}) positivo e de pelo menos ${minimo}, e com o numerador registrado; ${territorioTexto(ind)}`, `municipalities in the registry with a positive denominator (${nomeContagem(ind.denominador).toLowerCase()}) of at least ${minimo}, and a recorded numerator; ${territorioTexto(ind)}`)],
              [t('Residência', 'Residence'), notaResidencia()]]}
            arquivo={`saude_${ind.id}`} />
        </>
      )}
      {vista === 'anual' && escolhido && (
        <div className="destaque-ente" role="status">
          <strong>{String(escolhido.nome)}</strong>: {t(`posição ${posicao.get(escolhido.cod_ibge) ?? '–'} de ${ordenados.length}`, `rank ${posicao.get(escolhido.cod_ibge) ?? '–'} of ${ordenados.length}`)} ({formatar(ind, escolhido._valor)}; {t('mediana dos municípios', 'municipal median')}: {formatar(ind, mediana)}){' · '}
          <Link to={`/datasus${search}`}>{t('ver o município na visão geral', 'see the municipality in the overview')}</Link>
        </div>
      )}
      {vista === 'anual' && f.alvo && f.alvo.esfera === 'M' && !escolhido && coberto && (dados.dados || atual.dados) && (
        <p className="aviso" role="status">{t(`${f.rotulo} não entra no ranking com o denominador mínimo escolhido.`, `${f.rotulo} is not in the ranking with the chosen minimum denominator.`)}</p>
      )}
      {vista === 'anual' && <section className="cartao">
        <div className="filtros">
          <SeletorIndicador valor={ind.id} mudar={(id) => definir({ ind: id, min: null, per: null })} />
          {opcoesPeriodo}
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
          <p className="desc">{ind.nota()} {coberto ? t(`Universo: ${numero(universo.length)} municípios${minimo ? ` com denominador de pelo menos ${numero(minimo)}${trienio ? ' na soma dos três anos' : ''}` : ''}; com menos, as taxas oscilam demais para comparar.`,
            `Universe: ${numero(universo.length)} municipalities${minimo ? ` with a denominator of at least ${numero(minimo)}${trienio ? ' in the three-year sum' : ''}` : ''}; below that, rates are too volatile to compare.`) : ''}</p>
          {coberto && ordenados.length > 0 && (
            <BotoesExportar nome={`saude_ranking_${ind.id}_${trienio ? `${de}_${ano}` : ano}`} obter={() => ({
              colunas: [t('Posição', 'Rank'), 'cod_ibge', t('Município', 'Municipality'), 'UF', `${ind.nome()} (${ind.unidade()})`,
                `${nomeContagem(ind.numerador)} (${t('numerador', 'numerator')}${trienio ? `, ${t('soma do triênio', 'three-year sum')}` : ''})`,
                `${nomeContagem(ind.denominador)} (${t('denominador', 'denominator')}${trienio ? `, ${t('soma do triênio', 'three-year sum')}` : ''})`,
                t('Anos cobertos', 'Years covered'), t('Condição do dado', 'Data condition'),
                ...(trienio ? [`${ind.nome()} ${de - 3}–${ano - 3}`, t('Variação', 'Change')] : [t('População', 'Population')])],
              linhas: ordenados.map((r) => [posicao.get(r.cod_ibge) ?? null, String(r.cod_ibge), r.nome, r.uf, r._valor, r[ind.numerador], r[ind.denominador], periodoTexto,
                rotuloCondicao(condicaoDado(ind.numerador, num(r[ind.numerador]), ano, fontes)),
                ...(trienio ? [anteriores.get(r.cod_ibge)?.valor ?? null, variacao(r)?.abs ?? null] : [r.populacao])]),
              metadados: metadadosBase([
                [t('Recorte', 'Scope'), escopoNome], [t('Ano', 'Year'), periodoTexto],
                [t('Universo', 'Universe'), t(`${ordenados.length} municípios, denominador mínimo ${minimo}${trienio ? `; ${elegiveisAmbos} também elegíveis em ${de - 3}–${ano - 3}` : ''}`, `${ordenados.length} municipalities, minimum denominator ${minimo}${trienio ? `; ${elegiveisAmbos} also eligible in ${de - 3}–${ano - 3}` : ''}`)],
                [t('Posição', 'Rank'), t('classificação comum dos rankings: empates com a mesma posição (1, 2, 2, 4)', 'common ranking rule: ties share a position (1, 2, 2, 4)')],
                [t('Endereço', 'Address'), location.href]]),
            })} />
          )}
        </div>
        {!disponivel && <p className="aviso" role="status">{t(`${ind.nome()}: ${TEXTO_INDISPONIVEL()}. Escolha outro indicador.`, `${ind.nome()}: ${TEXTO_INDISPONIVEL()}. Choose another indicator.`)}</p>}
        {disponivel && !coberto && (
          <p className="aviso" role="status">
            {t(`Ano fora da cobertura: ${ind.nome()} só tem dados de ${faixaAnos(anosInd)} (${fonteCurta(ind)})${trienio ? '; o triênio precisa dos três anos cobertos' : ''}.`,
              `Year outside coverage: ${ind.nome()} only has data for ${faixaAnos(anosInd)} (${fonteCurta(ind)})${trienio ? '; the three-year window needs all three years covered' : ''}.`)}
            {avisoPrel ? ` ${avisoPrel}` : ''}
          </p>
        )}
        {coberto && <Estado carregando={carregandoDados} erro={erroDados} tentarNovamente={recarregarDados}
          vazio={!carregandoDados && (dados.dados || atual.dados) && !ordenados.length && t(
            `Ano coberto, sem municípios elegíveis: nenhum município tem o numerador registrado e denominador (${nomeContagem(ind.denominador).toLowerCase()}) de pelo menos ${numero(minimo)} em ${periodoTexto}. Reduza o mínimo para ver mais municípios.`,
            `Covered year, no eligible municipalities: no municipality has a recorded numerator and a denominator (${nomeContagem(ind.denominador).toLowerCase()}) of at least ${numero(minimo)} in ${periodoTexto}. Lower the minimum to see more municipalities.`)} />}
        {coberto && ordenados.length > 0 && (
          <>
            {trienio && (
              <p className="nota-base">{t(`Triênio ${de}–${ano}: soma dos ${nomeContagem(ind.numerador).toLowerCase()} dividida pela soma de ${nomeContagem(ind.denominador).toLowerCase()} nos três anos, e não a média das três taxas. Comparação com o triênio anterior (${de - 3}–${ano - 3}): ${numero(elegiveisAmbos)} dos ${numero(ordenados.length)} municípios são elegíveis nos dois períodos; os demais aparecem sem variação.`,
                `Three years ${de}–${ano}: the sum of ${nomeContagem(ind.numerador).toLowerCase()} divided by the sum of ${nomeContagem(ind.denominador).toLowerCase()} over the three years, not the mean of the three rates. Comparison with the previous three years (${de - 3}–${ano - 3}): ${numero(elegiveisAmbos)} of the ${numero(ordenados.length)} municipalities are eligible in both periods; the others appear without a change.`)}</p>
            )}
            <div className="rolagem">
              <table className="tabela-fixa">
                <thead><tr><th>{t('Município', 'Municipality')}</th><th>#</th>
                  {/* taxa e contagens com o papel de cada coluna: em homicídios, suicídios e trânsito o nome do indicador e o da contagem coincidem */}
                  <th>{ind.nome()}<br /><small>{ind.unidade()}{trienio ? ` · ${de}–${ano}` : ''}</small></th>
                  <th>{nomeContagem(ind.numerador)}<br /><small>{trienio ? t('numerador (soma dos três anos)', 'numerator (sum of three years)') : t('numerador (casos no ano)', 'numerator (cases in the year)')}</small></th>
                  <th>{nomeContagem(ind.denominador)}<br /><small>{trienio ? t('denominador (soma dos três anos)', 'denominator (sum of three years)') : t('denominador', 'denominator')}</small></th>
                  {trienio && <><th>{t('Triênio anterior', 'Previous three years')}<br /><small>{de - 3}–{ano - 3}</small></th><th>{t('Variação', 'Change')}</th></>}</tr></thead>
                <tbody>
                  {visiveis.map((r) => {
                    const v = trienio ? variacao(r) : null;
                    return (
                      <tr key={String(r.cod_ibge)} className={escolhido?.cod_ibge === r.cod_ibge ? 'destaque' : undefined}>
                        <td><Link to={`/datasus?${new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(search)), ente: String(r.cod_ibge), uf: String(r.uf) })}`}>{String(r.nome)}{uf ? '' : ` (${r.uf})`}</Link></td>
                        <td>{posicao.get(r.cod_ibge)?.toLocaleString(local()) ?? '–'}</td>
                        <td>{formatar(ind, r._valor)}</td>
                        <td>{numero(num(r[ind.numerador]))}</td>
                        <td>{numero(num(r[ind.denominador]))}</td>
                        {trienio && <><td>{formatar(ind, anteriores.get(r.cod_ibge)?.valor ?? null)}</td><td>{textoVar(v)}</td></>}
                      </tr>
                    );
                  })}
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
      </section>}
    </>
  );
}

const territorioTexto = (ind: Indicador) => (ind.numerador.startsWith('cnes_') ? t('município do estabelecimento', 'municipality of the facility') : t('município de residência', 'municipality of residence'));

// ---------------- metodologia ----------------

export function SaudeMetodologia() {
  const { meta } = useDados();
  const fontes = meta.fontes as unknown as FontesMeta;
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
          <li><strong>SIH</strong> ({faixa('sih')}): {t('Sistema de Informações Hospitalares do SUS, AIH reduzida (tipo 1 aprovadas e pagas; as de longa permanência, tipo 5, são continuação e não contam), por município de residência do paciente e por ano de competência da AIH. Só o SUS: não inclui a saúde suplementar nem a privada. O valor é o da tabela do SUS, em reais de 2025 pelo IPCA acumulado (dez/dez) (de 2008 em diante).',
            'SUS Hospital Information System, reduced AIH (approved and paid type 1; long-stay type 5 are continuations and do not count), by the patient’s municipality of residence and AIH competence year. SUS only: it excludes supplementary and private care. The value is the SUS table value, in 2025 reais using the accumulated IPCA (Dec/Dec) (from 2008).')}</li>
          <li><strong>ICSAP</strong> ({faixa('icsap')}): {t('internações por condições sensíveis à atenção primária, calculadas sobre o SIH (AIH tipo 1, por município de residência e ano de competência) com a Lista Brasileira da Portaria SAS/MS nº 221/2008, em 19 grupos de causas da CID-10, pelo diagnóstico principal. Entrada da lista com 3 caracteres vale para qualquer subcategoria; entrada com subcategoria (como N39.0) exige a subcategoria. A participação nas internações tem como denominador as internações pagas pelo SUS de residentes, exceto partos (CID-10 O80–O84), como na ficha do PROADESS/Fiocruz; a taxa usa a população residente por 10 mil habitantes. Em UF e Brasil, somam-se numeradores e denominadores antes de calcular. É uma medida indireta, relacionada à atenção primária e ao uso hospitalar: não avalia, isoladamente, a qualidade da gestão.',
            'ambulatory care-sensitive hospitalisations, computed on the SIH (type-1 AIH, by municipality of residence and competence year) with the Brazilian List of Ordinance SAS/MS 221/2008, in 19 ICD-10 cause groups, by principal diagnosis. A 3-character list entry covers any subcategory; an entry with a subcategory (such as N39.0) requires the subcategory. The share of admissions uses SUS-paid admissions of residents, excluding deliveries (ICD-10 O80–O84), as the denominator, as in the PROADESS/Fiocruz sheet; the rate uses the resident population per 10,000 inhabitants. For states and Brazil, numerators and denominators are summed before computing. It is an indirect measure related to primary care and hospital use: on its own it does not assess management quality.')}</li>
          <li><strong>{t('Atenção primária', 'Primary care')}</strong> ({faixa('aps')}): {t('relatórios públicos da atenção primária do Ministério da Saúde (SAPS): cobertura das equipes de Saúde da Família e atenção primária e dos agentes comunitários de saúde, por município, valor de dezembro de cada ano. A cobertura é a capacidade das equipes cadastradas em relação à população, não a população efetivamente atendida. Duas metodologias: até 2020 (atenção básica) e de 2021 em diante (atenção primária, sem limite de 100%); as séries não são comparáveis.', 'public primary care reports from the Ministry of Health (SAPS): coverage by family health and primary care teams and by community health agents, by municipality, December value of each year. Coverage is the capacity of registered teams relative to the population, not the population actually served. Two methodologies: up to 2020 (basic care) and from 2021 (primary care, not capped at 100%); the series are not comparable.')}</li>
          <li><strong>SIA</strong> ({faixa('sia')}): {t('Sistema de Informações Ambulatoriais do SUS, produção aprovada (grupo PA), pelo município do estabelecimento e por ano de apresentação. Conta procedimentos (consultas, exames, sessões), não pessoas. Só o SUS. O valor é o da tabela do SUS, em reais de 2025 pelo IPCA acumulado (dez/dez); não é o gasto do município.', 'SUS Outpatient Information System, approved output (PA group), by the facility’s municipality and submission year. It counts procedures (visits, tests, sessions), not people. SUS only. The value is the SUS table value, in 2025 reais using the accumulated IPCA (Dec/Dec); it is not municipal spending.')}</li>
          <li><strong>CNES</strong> ({faixa('cnes')}): {t('Cadastro Nacional de Estabelecimentos de Saúde, retrato de dezembro de cada ano (arquivos ST, LT e PF): estabelecimentos, leitos por tipo e profissionais (médicos, enfermeiros e dentistas, de 2007 em diante). A contagem é do município onde fica o estabelecimento, não o de residência de quem o usa; cada profissional é contado uma só vez no ano, no município do vínculo de maior carga horária, para que UF e Brasil somem pessoas distintas. Os arquivos de profissionais trazem nome e CPF; só as contagens por município são publicadas.',
            'National Registry of Health Facilities, December snapshot of each year (ST, LT and PF files): facilities, beds by type and staff (physicians, nurses and dentists, from 2007 on). Counts are by the municipality where the facility is, not the residence of its users; each professional is counted once a year, in the municipality of their link with the most weekly hours, so states and Brazil add up distinct people. The staff files carry names and CPF; only municipal counts are published.')}</li>
          <li><strong>SINAN</strong> ({faixa('sinan')}): {t('Sistema de Informação de Agravos de Notificação, arquivos finais do DATASUS, por município de residência e ano do arquivo: dengue (casos prováveis, confirmados, graves e óbitos; os arquivos públicos já excluem os descartados), chikungunya, tuberculose (casos novos; os arquivos finais só vão até 2019), hanseníase (casos novos) e violência interpessoal e autoprovocada notificada. Cada agravo tem a sua cobertura e fora dela não há dado. Os números podem diferir dos boletins do Ministério, que aplicam exclusões e atualizações próprias.',
            'Notifiable Diseases Information System, DATASUS final files, by municipality of residence and file year: dengue (probable, confirmed, severe cases and deaths; the public files already exclude discarded ones), chikungunya, tuberculosis (new cases; the final files only go to 2019), leprosy (new cases) and notified interpersonal and self-harm violence. Each disease has its own coverage and outside it there is no data. Numbers may differ from the Ministry’s bulletins, which apply their own exclusions and updates.')}</li>
          <li><strong>SISCAN</strong> ({faixa('siscan')}): {t('Sistema de Informação do Câncer, exames lançados no SUS por município de residência da paciente e ano de liberação: citopatológicos do colo do útero (total, em mulheres de 25 a 64 anos e alterados), mamografias (total e em mulheres de 50 a 69 anos) e histopatológicos. Conta exames, não mulheres, e só o que foi lançado no sistema.',
            'Cancer Information System, tests entered in the SUS by municipality of residence of the patient and year of release: cervical Pap smears (total, in women aged 25–64 and abnormal), mammograms (total and in women aged 50–69) and histopathology. It counts tests, not women, and only what was entered in the system.')}</li>
          <li><strong>{t('Painel de Oncologia', 'Oncology Panel')}</strong> ({faixa('oncologia')}): {t('diagnósticos de câncer (CID-10 C) registrados nos sistemas do SUS, por município de residência e ano do diagnóstico, com os que iniciaram tratamento e os que iniciaram em até 60 dias. Antes de 2019 o painel cobria bem menos casos e não entra.',
            'cancer diagnoses (ICD-10 C) recorded in SUS systems, by municipality of residence and year of diagnosis, with those that started treatment and those that started within 60 days. Before 2019 the panel covered far fewer cases and is left out.')}</li>
          <li><strong>RESP</strong> ({faixa('resp')}): {t('Registro de Eventos em Saúde Pública, notificações de microcefalia e alterações do sistema nervoso central (síndrome congênita ligada ao vírus Zika), por município de residência e ano da notificação, sem as excluídas.',
            'Public Health Events Registry, notifications of microcephaly and central nervous system changes (congenital syndrome linked to Zika virus), by municipality of residence and year of notification, excluding removed ones.')}</li>
          <li><strong>{t('População', 'Population')}</strong> ({faixa('populacao_svs')}): {t('estimativas da SVS/MS por município, sexo e idade simples, as mesmas do TABNET para as taxas de saúde.', 'SVS/MS estimates by municipality, sex and single year of age, the same used by TABNET for health rates.')}</li>
        </ul>
        <h3>{t('Como as taxas são calculadas', 'How rates are calculated')}</h3>
        <p>{t('Todas as taxas são razões de somas: para uma UF ou o Brasil, soma-se o numerador e o denominador de todos os municípios (inclusive os registros com município ignorado, que só entram nesses totais) e só então divide-se. Nunca é a média das taxas municipais.',
          'All rates are ratios of sums: for a state or Brazil, numerator and denominator are summed over all municipalities (including records with unknown municipality, which only enter these totals) and only then divided. Never an average of municipal rates.')}</p>
        <div className="rolagem">
          <table>
            <thead><tr><th>{t('Indicador', 'Indicator')}</th><th>{t('Unidade', 'Unit')}</th><th>{t('Recorte territorial', 'Territorial scope')}</th><th>{t('Período', 'Period')}</th><th>{t('Fonte', 'Source')}</th><th>{t('Definição', 'Definition')}</th></tr></thead>
            <tbody>{INDICADORES.map((i) => <tr key={i.id}><td>{i.nome()}</td><td>{i.unidade()}</td><td>{territorioDoIndicador(i)}</td><td>{faixaAnos(anosDoIndicador(i, fontes))}</td><td>{fonteCurta(i)}</td><td>{i.nota()}</td></tr>)}</tbody>
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
          <li>{t('Agravos (SINAN): são notificações, não pessoas doentes. Onde se notifica menos, aparece menos, e surtos fazem a incidência oscilar muito de um ano para outro; um ano de surto não é tendência. A violência notificada mede a notificação, não a ocorrência: lugares com mais serviços notificadores parecem mais violentos. Letalidade com poucos casos confirmados oscila muito (mínimo de 100 casos nos rankings).',
            'Diseases (SINAN): these are notifications, not sick people. Where less is reported, less appears, and outbreaks make incidence swing from year to year; an outbreak year is not a trend. Notified violence measures notification, not occurrence: places with more reporting services look more violent. Case fatality with few confirmed cases swings widely (minimum of 100 cases in the rankings).')}</li>
          <li>{t('Câncer (SISCAN e Painel de Oncologia): exames lançados no SUS e diagnósticos registrados não são cobertura de rastreamento nem incidência: o que foi feito fora do SUS e não lançado não aparece. O tempo até o tratamento só existe para quem iniciou tratamento (cerca de 40% dos diagnósticos não têm tratamento registrado), e os dois últimos anos ainda estão incompletos.',
            'Cancer (SISCAN and Oncology Panel): tests entered in the SUS and recorded diagnoses are neither screening coverage nor incidence: what was done outside the SUS and not entered does not appear. Time to treatment only exists for those who started treatment (about 40% of diagnoses have no treatment recorded), and the last two years are still incomplete.')}</li>
          <li>{t('Rede (CNES): leitos, médicos e estabelecimentos por habitante comparam o que há no município com a população que mora nele; municípios com hospital regional têm valores altos porque atendem moradores de outros, e municípios pequenos que dependem de profissionais itinerantes ficam subestimados (o profissional entra só no município do vínculo principal). É retrato de dezembro, não média do ano, e não há parâmetro único de "leitos ideais" nos dados.',
            'Network (CNES): beds, physicians and facilities per inhabitant compare what is in the municipality with the people who live in it; municipalities with a regional hospital have high values because they serve residents of others, and small municipalities that rely on itinerant professionals are understated (a professional counts only in the municipality of their main link). It is a December snapshot, not a yearly average, and there is no single "ideal beds" benchmark in the data.')}</li>
          <li>{t('Internações (SIH): medem o uso do SUS hospitalar, não a necessidade de saúde; quem tem plano privado aparece menos. A proporção de internações fora do município reflete a rede regional (municípios pequenos próximos de polos têm valores altos sem que isso seja falha de gestão), e a mortalidade hospitalar depende da gravidade e do perfil do hospital: não mede qualidade. O valor em reais de 2025 cobre todo o período do SIH (o IPCA da base começa em 2006).',
            'Admissions (SIH): they measure use of SUS hospitals, not health need; people with private insurance appear less. The share of admissions outside the municipality reflects the regional network (small municipalities near hubs have high values without any management failure), and in-hospital mortality depends on severity and hospital profile: it does not measure quality. The 2025-reais value covers the whole SIH period (the IPCA in the data starts in 2006).')}</li>
          <li>{t('Produção ambulatorial (SIA): conta procedimentos aprovados pelo SUS, não pessoas, pelo município do estabelecimento e pela competência de apresentação. O valor é o da tabela do SUS (SIGTAP), não o gasto do município: a despesa em saúde por habitante (SIOPS) aparece à parte, com fonte e ano próprios. A proporção de procedimentos de pacientes de outro município só será publicada quando houver um denominador com município de residência válido e a completude puder ser informada.', 'Outpatient output (SIA): counts procedures approved by SUS, not people, by municipality of the facility and submission competence. The value is the SUS table value (SIGTAP), not municipal spending: health spending per inhabitant (SIOPS) appears separately, with its own source and year. The share of procedures for patients from another municipality will only be published once there is a denominator with a valid residence municipality and completeness can be reported.')}</li>
          <li>{t('Médicos (CNES): três medidas diferentes. Médicos que atuam no município contam a mesma pessoa em cada município onde há vínculo (não se soma por UF ou Brasil); médicos atribuídos pelo vínculo principal contam cada pessoa uma vez, no município do vínculo de maior carga horária (soma por UF e Brasil são pessoas distintas); vínculos médicos contam vínculos, não pessoas.', 'Physicians (CNES): three different measures. Physicians who work in the municipality count the same person in every municipality with a link (not summed by state or Brazil); physicians assigned by main link count each person once, in the municipality of the link with the most weekly hours (sums by state and Brazil are distinct people); physician links count links, not people.')}</li>
          <li>{t('Tuberculose: a série do painel termina em 2019 (arquivos finais do SINAN) e usa a definição mais restrita (só a entrada "caso novo"). A definição do Caderno de indicadores da tuberculose (caso novo, "não sabe" e pós-óbito, por ano de diagnóstico e município de residência) está calculada à parte e só substitui a série depois da validação dos totais por ano e UF.', 'Tuberculosis: the panel series ends in 2019 (SINAN final files) and uses the narrower definition (only the "new case" entry). The definition of the tuberculosis indicators handbook (new case, "unknown" and post-mortem, by year of diagnosis and municipality of residence) is computed separately and only replaces the series after totals are validated by year and state.')}</li>
          <li>{t('Rastreamento do câncer: o SUS está em transição do exame citopatológico para o teste de DNA-HPV oncogênico (incorporação decidida em 2024, com implantação gradual), então a série de citopatológicos é o volume de exames registrados, não a cobertura do rastreamento. As mamografias de 50 a 69 anos são o recorte histórico; o recorte de 50 a 74 anos segue a nota técnica nº 626/2025 do Ministério da Saúde.', 'Cancer screening: the SUS is moving from the Pap smear to the oncogenic DNA-HPV test (incorporation decided in 2024, with gradual rollout), so the Pap smear series is the volume of tests recorded, not screening coverage. Mammograms for ages 50–69 are the historical band; the 50–74 band follows Ministry of Health technical note no. 626/2025.')}</li>
          <li>{t('Dados ausentes: o painel distingue período fora da cobertura da fonte (sem valor), ausência de registro dentro da cobertura (sem registro), zero registrado e dado preliminar. Cada indicador tem a cobertura das fontes do seu numerador e do seu denominador; os anos preliminares que o DATASUS publica e o painel não usa (só arquivos finais) são avisados.', 'Missing data: the panel distinguishes a period outside the source coverage (no value), absence of a record within coverage (no record), recorded zero and preliminary data. Each indicator has the coverage of the sources of its numerator and denominator; preliminary years that DATASUS publishes and the panel does not use (final files only) are flagged.')}</li>
          <li>{t('Rankings: só municípios do cadastro (residência), com o denominador mínimo escolhido; empates com a mesma posição (1, 2, 2, 4). O ranking anual e a evolução das posições usam a mesma classificação; na evolução, o universo pode ser o de cada ano ou constante (os mesmos municípios em todo o período). A taxa de cada município é a dele (numerador ÷ denominador), nunca a média de outras taxas.',
            'Rankings: only municipalities in the registry (residence), with the chosen minimum denominator; ties share the same position (1, 2, 2, 4). The annual ranking and positions over time use the same classification; over time, the universe can be each year’s or constant (the same municipalities throughout). Each municipality’s rate is its own (numerator ÷ denominator), never an average of other rates.')}</li>
        </ul>
        <p className="nota-base">{t('Versão da base', 'Data version')}: {meta.geradoEm} · {t('processado em', 'processed on')} {fonte('sim')?.processado_em ?? '–'}</p>
      </section>
    </>
  );
}
