import { Link, useLocation } from 'react-router-dom';
import type { Params } from '../api';
import { useDados, useFiltros } from '../contexto';
import { EtiquetasRecorte } from '../components/RecorteTrabalho';
import { t } from '../idioma';
import { quebrasEntre, temFiltrosDeRecorte, useRecorte } from '../trabalho_comum';

export const SETORES = (): [string, string][] => [
  ['agropecuaria', t('Agropecuária', 'Agriculture')],
  ['industria', t('Indústria', 'Industry')],
  ['construcao', t('Construção', 'Construction')],
  ['comercio', t('Comércio', 'Trade')],
  ['servicos', t('Serviços', 'Services')],
  ['adm_publica', t('Adm. pública, defesa e seguridade (CNAE 84)', 'Public adm., defence and social security (CNAE 84)')],
];

export const fonteRais = () => t(
  'RAIS (Relação Anual de Informações Sociais), Ministério do Trabalho e Emprego, microdados públicos sem identificação: vínculos formais ativos em 31 de dezembro, por município do estabelecimento. Processamento: LAPAM/UFG.',
  'RAIS (Annual Social Information Report), Ministry of Labour and Employment, public de-identified microdata: formal jobs active on December 31, by municipality of the establishment. Processing: LAPAM/UFG.',
);
export const fonteCaged = () => t(
  'Novo CAGED, Ministério do Trabalho e Emprego: admissões e desligamentos de empregos formais celetistas, mês a mês. Série com ajustes: declarações no prazo, mais as fora do prazo, menos as exclusões, pela competência da movimentação.',
  'New CAGED, Ministry of Labour and Employment: monthly hirings and separations of formal CLT jobs. Adjusted series: on-time filings, plus late filings, minus exclusions, by the month of the movement.',
);
export const notaSetores = () => t(
  'Grandes setores pela divisão da CNAE 2.0 (atividade do estabelecimento): agropecuária (01–03), indústria (05–39, inclui extrativa, energia e saneamento), construção (41–43), comércio (45–47), administração pública, defesa e seguridade social (84) e serviços (demais). A divisão 84 é uma atividade: não reúne todo o setor público, que também aparece em educação, saúde e outras atividades. Para o setor público pela natureza jurídica, use a Consulta personalizada (setor institucional).',
  'Broad sectors by CNAE 2.0 division (establishment activity): agriculture (01–03), industry (05–39, including mining, energy and sanitation), construction (41–43), trade (45–47), public administration, defence and social security (84) and services (all others). Division 84 is an activity: it does not cover the whole public sector, which also appears in education, health and other activities. For the public sector by legal nature, use the Custom query (institutional sector).',
);
export const notaRemuneracao = () => t(
  'Remuneração média de dezembro: soma das remunerações nominais positivas dos vínculos ativos em 31/12 ÷ número desses vínculos com valor válido. Ausentes, zero e negativos ficam fora da média e aparecem na cobertura salarial; o total de empregos é preservado. Grupos e agregados somam massas e vínculos com remuneração válida, nunca médias de médias. A remuneração real usa IPCA de dezembro: índice do ano-base ÷ índice do ano. A massa de dezembro não é renda anual.',
  'Average December pay: sum of positive nominal December pay for jobs active on Dec 31 ÷ number of those jobs with valid pay. Missing, zero and negative values are excluded from the average and shown in pay coverage; total jobs are preserved. Groups and aggregates sum payroll and jobs with valid pay, never averages of averages. Real pay uses December IPCA: base-year index ÷ year index. December payroll is not annual income.',
);
export const notaPorMil = (ano: number | undefined) => t(
  `Vínculos ativos em 31/12 no município do estabelecimento ÷ população residente do mesmo ano (${ano ?? ''}) × 1.000. A população é a do painel de finanças desde 2013 e a do IBGE antes (Censo 2010 e estimativas). Não é taxa de ocupação, de formalização ou de desemprego: uma pessoa pode ter mais de um vínculo e trabalhar fora do município onde mora, e o valor pode passar de 1.000.`,
  `Jobs active on Dec 31 in the establishment’s municipality ÷ resident population of the same year (${ano ?? ''}) × 1,000. Population is the finance dashboard’s from 2013 and IBGE’s before (2010 Census and estimates). It is not an employment, formality or unemployment rate: a person may hold more than one job and work outside the municipality where they live, and the value can exceed 1,000.`,
);

export const mesAno = (aaaamm: number) => `${String(aaaamm % 100).padStart(2, '0')}/${Math.floor(aaaamm / 100)}`;
export const MESES = () => t('jan fev mar abr mai jun jul ago set out nov dez', 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec').split(' ');

/** Escopo das páginas de trabalho a partir dos filtros: município, UF (municípios dela) ou Brasil. */
export function useTrabalho() {
  const { meta } = useDados();
  const f = useFiltros();
  const rais = meta.fontes.rais as { anos?: number[] } | undefined;
  const caged = meta.fontes.caged as { de?: number; ate?: number; processado_em?: string } | undefined;
  const anos = rais?.anos ?? [];
  // o filtro de ano da área já usa os anos da RAIS (useFiltros)
  const anoRais = anos.includes(f.ano) ? f.ano : anos.at(-1);
  let escopo: Params;
  let rotulo: string;
  let municipio = false;
  if (f.alvo && f.alvo.esfera !== 'E') {
    escopo = { ente: f.alvo.cod_ibge };
    rotulo = f.alvo.esfera === 'D' ? t('Brasília (DF)', 'Brasília (DF)') : f.rotulo;
    municipio = true;
  } else if (f.alvo?.esfera === 'E' || f.uf) {
    const uf = f.alvo?.uf ?? f.uf!;
    escopo = { uf };
    rotulo = t(`Municípios de ${uf}`, `Municipalities in ${uf}`);
  } else {
    escopo = {};
    rotulo = t('Brasil', 'Brazil');
  }
  return { f, meta, anos, anoRais, caged, escopo, rotulo, municipio, temDados: anos.length > 0 };
}

export function SemDados() {
  return <p className="vazio">{t('Os dados da RAIS e do CAGED ainda não foram publicados.', 'RAIS and CAGED data have not been published yet.')}</p>;
}

export function AvisoAno({ anoRais }: { anoRais?: number }) {
  const f = useFiltros();
  if (!f.anoForaDaBase || !anoRais) return null;
  return (
    <p className="aviso" role="status">
      {t(`A RAIS de ${f.anoForaDaBase} ainda não foi publicada; a página mostra ${anoRais}, o ano mais recente disponível.`,
        `RAIS ${f.anoForaDaBase} has not been published yet; the page shows ${anoRais}, the latest year available.`)}
    </p>
  );
}

/** Esta página usa tabelas agregadas por município: o recorte (ocupação, atividade, perfil) não se aplica a ela, e a página diz isso em vez de ignorá-lo em silêncio. */
export function AvisoRecorte({ pagina }: { pagina: string }) {
  const { recorte, definir } = useRecorte();
  const { search } = useLocation();
  if (!temFiltrosDeRecorte(recorte)) return null;
  return (
    <div className="aviso" role="status">
      <p>{t(`O recorte abaixo está ativo, mas ${pagina} usa as tabelas somadas por município (todos os vínculos ativos), que não têm ocupação nem os demais filtros. Os números desta página não aplicam o recorte.`,
        `The recorte below is active, but ${pagina} uses tables summed by municipality (all active jobs), which have no occupation or the other filters. The numbers on this page do not apply the recorte.`)}{' '}
        <Link to={`/trabalho/evolucao${search}`}>{t('Evolução do recorte', 'Recorte over time')}</Link></p>
      <EtiquetasRecorte recorte={recorte} definir={definir} />
    </div>
  );
}

export function NotaQuebra({ anos }: { anos: number[] }) {
  const qs = anos.length ? quebrasEntre(Math.min(...anos), Math.max(...anos)) : [];
  if (!qs.length) return null;
  return (
    <p className="quebra-serie" role="note">
      <strong>{t('Quebras de série na RAIS', 'Breaks in the RAIS series')}:</strong>{' '}
      {qs.map((q) => <span key={q.ano}>{q.texto} <a href={q.url} target="_blank" rel="noreferrer">{t('Nota técnica do MTE', 'MTE technical note')}</a>. </span>)}
      {t('Nos gráficos, linhas tracejadas marcam esses anos; variações que os atravessam são observadas e podem refletir cobertura ou classificação, não só o mercado de trabalho.',
        'In the charts, dashed lines mark these years; changes across them are observed and may reflect coverage or classification, not only the labour market.')}
    </p>
  );
}
