import { useMemo, useState } from 'react';
import { buscar, useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar, type Tabela } from '../components/Exportar';
import { Estado, Kpi } from '../components/Kpi';
import { FormularioRecorte, paramsConsulta, SITUACOES, useAnosConsulta, useTerritorioTrabalho } from '../components/RecorteTrabalho';
import { BarraFiltros, useDados } from '../contexto';
import { cancelarConsultasTrabalho, fonteConsulta, gruposDaFonte, LIMITES_CONSULTA } from '../dados';
import { div, numero, numero1, pct, reaisExato } from '../format';
import { num } from '../hooks';
import { idioma, t } from '../idioma';
import { baixarPacote, FILTROS_AVANCADOS, pequeno, useRecorte, type Recorte } from '../trabalho_comum';

export type ResultadoConsulta = {
  fonte: 'micro' | 'cubo_uf' | 'cubo_mun'; linhas: Linha[]; ano: number; base_ipca: number; fator_real: number | null; sql: string;
};

export const AGRUPAMENTOS = (): [string, string][] => [
  ['total', t('Sem agrupar (total)', 'No grouping (total)')],
  ['cnae_secao', t('Atividade (CNAE): seção', 'Activity (CNAE): section')],
  ['cnae_divisao', t('Atividade (CNAE): divisão (2 dígitos)', 'Activity (CNAE): division (2 digits)')],
  ['cnae_classe', t('Atividade (CNAE): classe (5 dígitos)', 'Activity (CNAE): class (5 digits)')],
  ['cnae_subclasse', t('Atividade (CNAE): subclasse (7 dígitos)', 'Activity (CNAE): subclass (7 digits)')],
  ['cbo_grande_grupo', t('Ocupação (CBO): grande grupo', 'Occupation (CBO): major group')],
  ['cbo_familia', t('Ocupação (CBO): família (4 dígitos)', 'Occupation (CBO): family (4 digits)')],
  ['cbo', t('Ocupação (CBO): ocupação (6 dígitos)', 'Occupation (CBO): occupation (6 digits)')],
  ['setor_institucional', t('Setor institucional (natureza jurídica)', 'Institutional sector (legal nature)')],
  ['esfera_adm', t('Esfera administrativa', 'Level of government')],
  ['natureza_juridica_grupo', t('Natureza jurídica: grupo', 'Legal nature: group')],
  ['natureza_juridica', t('Natureza jurídica: detalhada', 'Legal nature: detailed')],
  ['vinculo_mte', t('Tipo de vínculo (agregação do MTE)', 'Type of contract (MTE grouping)')],
  ['tipo_vinculo', t('Tipo de vínculo (detalhado)', 'Type of contract (detailed)')],
  ['situacao', t('Situação no fim do ano', 'Status at year end')],
  ['causa_afastamento', t('Causa do afastamento', 'Reason for leave')],
  ['motivo_desligamento', t('Motivo do desligamento', 'Reason for separation')],
  ['sexo', t('Sexo', 'Sex')],
  ['faixa_idade', t('Faixa de idade', 'Age group')],
  ['escolaridade', t('Escolaridade', 'Education')],
  ['raca_cor', t('Raça/cor', 'Race/colour')],
  ['tamanho_estab', t('Tamanho do estabelecimento', 'Establishment size')],
  ['faixa_horas', t('Jornada contratual semanal', 'Contracted weekly hours')],
  ['faixa_tempo', t('Tempo no emprego', 'Job tenure')],
  ['uf', 'UF'],
  ['municipio', t('Município', 'Municipality')],
];

export const notaFonte = () => t(
  'RAIS, Ministério do Trabalho e Emprego, microdados públicos sem identificação. A unidade é o vínculo: quem tem dois empregos conta duas vezes. Processamento: LAPAM/UFG.',
  'RAIS, Ministry of Labour and Employment, public de-identified microdata. The unit is the job: a person with two jobs counts twice. Processing: LAPAM/UFG.',
);
export const notaDefinicoes = () => t(
  'Ativo: vínculo ativo em 31/12. Desligado: não ativo em 31/12, com motivo de desligamento no ano. Afastado: com afastamento no ano (primeira causa informada). Remuneração de dezembro: só vínculos ativos em 31/12 com valor maior que zero; média = massa ÷ esses vínculos. Ficam fora do cálculo, e são contados à parte, os ativos com remuneração ausente (em branco no arquivo, desde 2023), zero (como a falta vinha até 2022) ou negativa. Remuneração média do ano: média mensal de cada vínculo enquanto ativo (não é renda anual). Mediana e percentis: dos vínculos válidos, só com os microdados. Remuneração por hora contratada: aproximação = remuneração de dezembro ÷ (horas semanais contratadas × 52 ÷ 12), só com jornada de 1 a 44 horas; não mede horas efetivamente trabalhadas. Diferenças entre grupos (sexo, raça/cor) são observadas: não provam, sozinhas, discriminação ou efeito causal.',
  'Active: job active on Dec 31. Separated: not active on Dec 31, with a separation reason in the year. On leave: with a leave in the year (first reason reported). December pay: only jobs active on Dec 31 with a value above zero; average = payroll ÷ those jobs. Active jobs with missing pay (blank in the file since 2023), zero (how missing values came until 2022) or negative pay are left out and counted separately. Average pay for the year: monthly average of each job while active (not annual income). Median and percentiles: of valid jobs, microdata only. Pay per contracted hour: approximation = December pay ÷ (contracted weekly hours × 52 ÷ 12), only for 1 to 44 hours; it does not measure hours actually worked. Differences between groups (sex, race/colour) are observed: on their own they do not prove discrimination or a causal effect.',
);

type Coluna = { id: string; titulo: string; dinheiro?: boolean; valor: (r: Linha, total: Linha | undefined) => number | null; formato: (v: number | null) => string; n?: (r: Linha) => number | null; padrao?: boolean; soMicro?: boolean };

/** Colunas da tabela de grupos. Valores em reais saem já multiplicados pelo fator (nominal: 1). */
export function colunasConsulta(fator: number): Coluna[] {
  const r$ = (v: number | null) => reaisExato(v);
  const m = (v: unknown) => (num(v) === null ? null : num(v)! * fator);
  return [
    { id: 'vinculos', titulo: t('Vínculos', 'Jobs'), valor: (r) => num(r.vinculos), formato: numero, padrao: true },
    { id: 'part', titulo: t('% do total', '% of total'), valor: (r, tot) => div(num(r.vinculos), num(tot?.vinculos)), formato: (v) => pct(v), padrao: true },
    { id: 'ativos', titulo: t('Ativos 31/12', 'Active Dec 31'), valor: (r) => num(r.ativos), formato: numero, padrao: true },
    { id: 'desligados', titulo: t('Desligados', 'Separated'), valor: (r) => num(r.desligados), formato: numero },
    { id: 'afastados', titulo: t('% afastados', '% on leave'), valor: (r) => div(num(r.afastados), num(r.vinculos)), formato: (v) => pct(v), n: (r) => num(r.vinculos) },
    { id: 'dias', titulo: t('Dias de afast. (média)', 'Days of leave (avg)'), valor: (r) => num(r.dias_afastamento_medio), formato: numero, n: (r) => num(r.afastados) },
    { id: 'rem_dez', titulo: t('Rem. dezembro (média)', 'December pay (avg)'), dinheiro: true, valor: (r) => m(r.rem_dez_media), formato: r$, n: (r) => num(r.n_rem_dez), padrao: true },
    { id: 'n_rem_dez', titulo: t('N válido (rem. dez.)', 'Valid N (Dec pay)'), valor: (r) => num(r.n_rem_dez), formato: numero, padrao: true },
    { id: 'fora', titulo: t('% dos ativos fora do cálculo', '% of active jobs left out'), valor: (r) => div((num(r.ativos) ?? 0) - (num(r.n_rem_dez) ?? 0), num(r.ativos)), formato: (v) => pct(v), padrao: true },
    { id: 'rem_dez_med', titulo: t('Rem. dezembro (mediana)', 'December pay (median)'), dinheiro: true, valor: (r) => m(r.rem_dez_mediana), formato: r$, n: (r) => num(r.n_rem_dez), padrao: true, soMicro: true },
    { id: 'p10', titulo: 'P10', dinheiro: true, valor: (r) => m(r.rem_dez_p10), formato: r$, n: (r) => num(r.n_rem_dez), soMicro: true },
    { id: 'p25', titulo: 'P25', dinheiro: true, valor: (r) => m(r.rem_dez_p25), formato: r$, n: (r) => num(r.n_rem_dez), soMicro: true },
    { id: 'p75', titulo: 'P75', dinheiro: true, valor: (r) => m(r.rem_dez_p75), formato: r$, n: (r) => num(r.n_rem_dez), soMicro: true },
    { id: 'p90', titulo: 'P90', dinheiro: true, valor: (r) => m(r.rem_dez_p90), formato: r$, n: (r) => num(r.n_rem_dez), soMicro: true },
    { id: 'rem_hora', titulo: t('Rem. por hora contratada (aprox.)', 'Pay per contracted hour (approx.)'), dinheiro: true, valor: (r) => m(r.rem_hora_media), formato: r$, n: (r) => num(r.n_rem_hora), soMicro: true },
    { id: 'rem_media', titulo: t('Rem. média mensal do ano', 'Average monthly pay (year)'), dinheiro: true, valor: (r) => m(r.rem_media_media), formato: r$, n: (r) => num(r.n_rem_media) },
    { id: 'mulheres', titulo: t('% mulheres', '% women'), valor: (r) => div(num(r.mulheres), num(r.vinculos)), formato: (v) => pct(v), n: (r) => num(r.vinculos), padrao: true },
    { id: 'superior', titulo: t('% superior completo', '% college degree'), valor: (r) => div(num(r.superior), num(r.vinculos)), formato: (v) => pct(v), n: (r) => num(r.vinculos), padrao: true },
    { id: 'horas', titulo: t('Horas semanais (média)', 'Weekly hours (avg)'), valor: (r) => num(r.horas_media), formato: numero1 },
    { id: 'idade', titulo: t('Idade média', 'Average age'), valor: (r) => num(r.idade_media), formato: numero1 },
  ];
}

/** Metadados de uma exportação da consulta: tudo o que é preciso para reproduzir e ler a tabela. */
export function metadadosConsulta(o: {
  rotulo: string; ano: number | string; recorte: Recorte; fonte: string; total?: Linha; moeda: string; geradoEm: string; processado?: string;
  sql?: string; extra?: [string, string][];
}): [string, string][] {
  const tot = o.total;
  const fora = tot ? (num(tot.ativos) ?? 0) - (num(tot.n_rem_dez) ?? 0) : null;
  const listas = FILTROS_AVANCADOS().filter((f) => o.recorte.listas[f.chave]).map((f) => `${f.rotulo}: ${o.recorte.listas[f.chave]}`);
  return [
    [t('Fonte', 'Source'), notaFonte()],
    [t('Base', 'Data'), o.fonte === 'micro' ? t('microdados da RAIS (um registro por vínculo)', 'RAIS microdata (one record per job)') : t('tabelas pré-somadas dos microdados (sem medianas e percentis)', 'tables pre-aggregated from the microdata (no medians or percentiles)')],
    [t('Território', 'Territory'), o.rotulo], [t('Ano', 'Year'), String(o.ano)],
    [t('Universo', 'Universe'), SITUACOES().find(([k]) => k === o.recorte.situacao)?.[1] ?? ''],
    [t('Unidade', 'Unit'), t('vínculos de emprego (não pessoas)', 'jobs (not people)')],
    [t('Ocupação (CBO, prefixos)', 'Occupation (CBO, prefixes)'), o.recorte.cbo || t('todas', 'all')],
    [t('Atividade (CNAE, prefixos)', 'Activity (CNAE, prefixes)'), o.recorte.cnae || t('todas', 'all')],
    [t('Sexo', 'Sex'), o.recorte.sexo === '1' ? t('Masculino', 'Male') : o.recorte.sexo === '2' ? t('Feminino', 'Female') : t('ambos', 'both')],
    [t('Outros filtros (códigos)', 'Other filters (codes)'), listas.join(' | ') || t('nenhum', 'none')],
    [t('Referência monetária', 'Monetary reference'), o.moeda],
    ...(tot ? [
      [t('N vínculos no recorte', 'N jobs in the recorte'), String(num(tot.vinculos))],
      [t('N ativos em 31/12', 'N active on Dec 31'), String(num(tot.ativos))],
      [t('N com remuneração de dezembro válida', 'N with valid December pay'), String(num(tot.n_rem_dez))],
      [t('Ativos fora do cálculo da remuneração', 'Active jobs left out of pay'), `${fora}${num(tot.rem_dez_ausente) !== null ? ` (${t('ausente', 'missing')} ${num(tot.rem_dez_ausente)}; ${t('zero', 'zero')} ${num(tot.rem_dez_zero)}; ${t('negativa', 'negative')} ${num(tot.rem_dez_negativa)})` : ''}`],
    ] as [string, string][] : []),
    [t('Definições e fórmulas', 'Definitions and formulas'), notaDefinicoes()],
    [t('Versão da base (manifesto)', 'Data version (manifest)'), o.geradoEm],
    ...(o.processado ? [[t('Microdados processados em', 'Microdata processed on'), o.processado] as [string, string]] : []),
    [t('Exportado em', 'Exported on'), new Date().toISOString()],
    [t('Endereço da consulta', 'Query address'), typeof location === 'undefined' ? '' : location.href],
    ...(o.extra ?? []),
    ...(o.sql ? [['SQL', o.sql] as [string, string]] : []),
  ];
}

/** Cruzamento de duas dimensões: valores absolutos, % da linha ou % da coluna (só para contagens). */
function Cruzamento({ linhas, nome1, nome2, pctModo, mudarPct, nmin }: {
  linhas: Linha[]; nome1: string; nome2: string; pctModo: 'abs' | 'linha' | 'coluna'; mudarPct: (v: string) => void; nmin: number;
}) {
  const rotulo = (g: unknown, n: unknown) => (g === null || g === undefined ? t('(não informado)', '(not reported)') : n ? `${g} · ${n}` : String(g));
  const { lin, col, cel, totLin, totCol, total } = useMemo(() => {
    const totLin = new Map<string, number>();
    const totCol = new Map<string, number>();
    const cel = new Map<string, number>();
    const nomeL = new Map<string, string>();
    const nomeC = new Map<string, string>();
    let total = 0;
    for (const r of linhas) {
      const a = String(r.grupo);
      const b = String(r.grupo2);
      const v = num(r.vinculos) ?? 0;
      nomeL.set(a, rotulo(r.grupo, r.nome));
      nomeC.set(b, rotulo(r.grupo2, r.nome2));
      cel.set(`${a}|${b}`, v);
      totLin.set(a, (totLin.get(a) ?? 0) + v);
      totCol.set(b, (totCol.get(b) ?? 0) + v);
      total += v;
    }
    const ordem = (m: Map<string, number>) => [...m.keys()].sort((x, y) => m.get(y)! - m.get(x)!);
    return { lin: ordem(totLin).map((k) => [k, nomeL.get(k)!] as const), col: ordem(totCol).slice(0, 40).map((k) => [k, nomeC.get(k)!] as const), cel, totLin, totCol, total };
  }, [linhas]);
  const fmt = (v: number, a: string, b: string | null) => {
    if (pctModo === 'linha') return pct(div(v, totLin.get(a) ?? null));
    if (pctModo === 'coluna') return pct(div(v, b ? totCol.get(b) ?? null : total));
    return numero(v);
  };
  return (
    <>
      <div className="filtros">
        <div className="campo">
          <label htmlFor="q-pct">{t('Mostrar', 'Show')}</label>
          <select id="q-pct" value={pctModo} onChange={(e) => mudarPct(e.target.value)}>
            <option value="abs">{t('Vínculos (valores absolutos)', 'Jobs (absolute values)')}</option>
            <option value="linha">{t('% da linha (cada linha soma 100%)', '% of row (each row adds to 100%)')}</option>
            <option value="coluna">{t('% da coluna (cada coluna soma 100%)', '% of column (each column adds to 100%)')}</option>
          </select>
        </div>
      </div>
      {totCol.size > 40 && <p className="nota-base">{t(`Mostrando as 40 colunas com mais vínculos de ${totCol.size}; a exportação traz todas.`, `Showing the 40 columns with most jobs out of ${totCol.size}; the export has all.`)}</p>}
      <div className="rolagem">
        <table className="tabela-fixa">
          <thead>
            <tr><th>{nome1} \ {nome2}</th>{col.map(([k, n]) => <th key={k}>{n}</th>)}<th>Total</th></tr>
          </thead>
          <tbody>
            {lin.map(([a, n]) => (
              <tr key={a}>
                <td>{n}</td>
                {col.map(([b]) => {
                  const v = cel.get(`${a}|${b}`) ?? 0;
                  return <td key={b} className={pequeno(v, nmin) && v > 0 ? 'n-pequeno' : undefined}>{fmt(v, a, b)}</td>;
                })}
                <td><strong>{pctModo === 'coluna' ? fmt(totLin.get(a)!, a, null) : pctModo === 'linha' ? '100%' : numero(totLin.get(a)!)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function TrabalhoConsulta() {
  const { meta } = useDados();
  const { f, escopo, rotulo, tipo } = useTerritorioTrabalho();
  const anos = useAnosConsulta();
  const ano = anos.includes(f.ano) ? f.ano : ([...anos].reverse().find((a) => a <= f.ano) ?? anos.at(-1));
  const { recorte, definir } = useRecorte();
  const fonte = fonteConsulta(escopo);
  const micro = fonte === 'micro';
  const limites = LIMITES_CONSULTA[fonte];
  const disponiveis = gruposDaFonte(fonte);
  const agrupamentos = AGRUPAMENTOS().filter(([k]) => disponiveis.includes(k) && !(k === 'municipio' && tipo === 'municipio') && !(k === 'uf' && tipo !== 'brasil'));
  const valido = (k: string) => agrupamentos.some(([x]) => x === k);
  const aplicada = !!recorte.agrupar;
  const agrupar = valido(recorte.agrupar) ? recorte.agrupar : 'total';
  const agrupar2 = recorte.agrupar2 && valido(recorte.agrupar2) && recorte.agrupar2 !== agrupar && agrupar !== 'total' ? recorte.agrupar2 : '';
  const [agrRasc, setAgrRasc] = useState(recorte.agrupar || 'cnae_divisao');
  const [agr2Rasc, setAgr2Rasc] = useState(recorte.agrupar2);
  const [busca, setBusca] = useState('');
  const [ordem, setOrdem] = useState<{ id: string; desc: boolean } | null>(null);

  const params = aplicada && ano ? paramsConsulta(escopo, recorte, { ano }) : null;
  const total = useApi<ResultadoConsulta>(params ? 'trab_consulta' : null, { ...params, agrupar: 'total' });
  const grupos = useApi<ResultadoConsulta>(params && agrupar !== 'total' ? 'trab_consulta' : null, { ...params, agrupar, agrupar2: agrupar2 || undefined });
  const tot = total.dados?.linhas[0];
  const fator = recorte.moeda === 'real' ? total.dados?.fator_real ?? null : 1;
  const moedaTexto = recorte.moeda === 'real'
    ? t(`R$ de dezembro de ${meta.baseIpca} (IPCA, razão entre os índices de dezembro)`, `December ${meta.baseIpca} R$ (IPCA, ratio of December indices)`)
    : t(`R$ nominais de ${ano}`, `${ano} nominal R$`);
  const colunas = colunasConsulta(fator ?? 1).filter((c) => micro || !c.soMicro);
  // num recorte só de ativos, "vínculos" e "ativos" são o mesmo universo: a coluna repetida sai
  const repetidas = recorte.situacao === 'ativos' ? new Set(['ativos', 'desligados']) : new Set<string>();
  const visiveis = colunas.filter((c) => !repetidas.has(c.id) && (recorte.cols ? recorte.cols.includes(c.id) : c.padrao));
  const nomeAgrupar = AGRUPAMENTOS().find(([k]) => k === agrupar)?.[1] ?? '';
  const nomeAgrupar2 = AGRUPAMENTOS().find(([k]) => k === agrupar2)?.[1] ?? '';
  const processado = (meta.fontes.rais_micro as { processado_em?: string } | undefined)?.processado_em;

  const linhas = useMemo(() => {
    const l = grupos.dados?.linhas ?? [];
    const b = busca.trim().toLowerCase();
    const filtradas = b ? l.filter((r) => `${r.grupo} ${r.nome ?? ''}`.toLowerCase().includes(b)) : l;
    if (!ordem) return filtradas;
    const c = colunas.find((x) => x.id === ordem.id);
    if (!c) return filtradas;
    return [...filtradas].sort((x, y) => {
      const a = c.valor(x, tot);
      const d = c.valor(y, tot);
      if (a === null) return 1;
      if (d === null) return -1;
      return (a - d) * (ordem.desc ? -1 : 1);
    });
  }, [grupos.dados, busca, ordem, fator]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!anos.length) {
    return (
      <>
        <h2 className="titulo-pagina">{t('Consulta personalizada', 'Custom query')}</h2>
        <p className="vazio">{t('Os microdados da RAIS ainda não foram publicados.', 'RAIS microdata have not been published yet.')}</p>
      </>
    );
  }

  const meta0 = (extra: [string, string][] = [], sql?: string) => metadadosConsulta({
    rotulo, ano: ano!, recorte, fonte, total: tot, moeda: moedaTexto, geradoEm: meta.geradoEm, processado, sql, extra,
  });
  /** Tabela completa dos grupos (não só as linhas da tela): refaz a consulta sem o corte de 3.000 se preciso. */
  const tabelaGrupos = async (): Promise<Tabela> => {
    let r = grupos.dados!;
    const existentes = num(r.linhas[0]?.grupos_total) ?? r.linhas.length;
    if (existentes > r.linhas.length) r = await buscar<ResultadoConsulta>('trab_consulta', { ...params, agrupar, agrupar2: agrupar2 || undefined, limite: 200000 });
    const cols = colunas.filter((c) => !repetidas.has(c.id));
    return {
      colunas: [t('Código', 'Code'), t('Nome', 'Name'), ...(agrupar2 ? [t('Código 2', 'Code 2'), t('Nome 2', 'Name 2')] : []), ...cols.map((c) => c.titulo),
        ...cols.filter((c) => c.n).map((c) => `N · ${c.titulo}`)],
      linhas: r.linhas.map((x) => [x.grupo === null ? null : String(x.grupo), x.nome, ...(agrupar2 ? [x.grupo2 === null ? null : String(x.grupo2), x.nome2] : []),
        ...cols.map((c) => c.valor(x, tot)), ...cols.filter((c) => c.n).map((c) => c.n!(x))]),
      metadados: meta0([[t('Agrupamento', 'Grouping'), agrupar2 ? `${nomeAgrupar} × ${nomeAgrupar2}` : nomeAgrupar],
        [t('Linhas', 'Rows'), t(`todas as ${r.linhas.length} (a tela pode mostrar menos, com busca e ordenação)`, `all ${r.linhas.length} (the screen may show fewer, with search and sorting)`)],
        [t('Grupos pequenos', 'Small groups'), t(`N abaixo de ${recorte.nmin} é marcado na tela; as colunas N trazem o denominador de cada valor`, `N below ${recorte.nmin} is flagged on screen; the N columns give each value’s denominator`)]], r.sql),
    };
  };
  const tabelaTotal = (): Tabela => ({
    colunas: [t('Indicador', 'Indicator'), t('Valor', 'Value'), 'N'],
    linhas: colunas.map((c) => [c.titulo, tot ? c.valor(tot, tot) : null, c.n && tot ? c.n(tot) : null]),
    metadados: meta0([], total.dados?.sql),
  });

  const nRem = num(tot?.n_rem_dez);
  const ativos = num(tot?.ativos);
  const foraRem = ativos !== null && nRem !== null ? ativos - nRem : null;
  const m = (v: unknown) => (num(v) === null || fator === null ? null : num(v)! * fator);
  const p10 = m(tot?.rem_dez_p10);
  const p90 = m(tot?.rem_dez_p90);

  return (
    <>
      <h2 className="titulo-pagina">{t('Consulta personalizada (RAIS)', 'Custom query (RAIS)')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {ano} <Dica rotulo={t('Fonte', 'Source')}>{notaFonte()}</Dica></p>
      <BarraFiltros />
      {f.anoForaDaBase && <p className="aviso" role="status">{t(`A RAIS de ${f.anoForaDaBase} ainda não foi publicada; a consulta usa ${ano}.`, `RAIS ${f.anoForaDaBase} has not been published yet; the query uses ${ano}.`)}</p>}
      <p className={`cobertura capacidade ${micro ? '' : 'limitada'}`} role="note">
        <strong>{t('O que esta consulta oferece aqui', 'What this query offers here')}:</strong>{' '}
        {micro
          ? t(`microdados de ${rotulo} (um registro por vínculo): todos os agrupamentos e filtros, medianas, percentis e remuneração por hora. UFs grandes (SP, MG, RJ) podem levar alguns minutos.`,
            `microdata for ${rotulo} (one record per job): every grouping and filter, medians, percentiles and pay per hour. Large states (SP, MG, RJ) may take a few minutes.`)
          : t(`tabelas pré-somadas (${tipo === 'brasil' ? 'Brasil' : 'município'}): CNAE até ${limites.cnae} dígitos, CBO até ${limites.cbo} dígito(s), sexo e situação; sem medianas, percentis e filtros avançados, que precisam dos microdados de uma UF ou município.`,
            `pre-aggregated tables (${tipo === 'brasil' ? 'Brazil' : 'municipality'}): CNAE up to ${limites.cnae} digits, CBO up to ${limites.cbo} digit(s), sex and status; no medians, percentiles or advanced filters, which need the microdata of a state or municipality.`)}
      </p>
      <FormularioRecorte recorte={recorte} definir={(n) => { cancelarConsultasTrabalho(); definir(n); }} micro={micro}
        aplicarExtra={{ agr: agrRasc || 'total', agr2: agr2Rasc || null }}
        extra={(
          <>
            <div className="campo">
              <label htmlFor="q-agr">{t('Agrupar por', 'Group by')}</label>
              <select id="q-agr" value={agrRasc} onChange={(e) => setAgrRasc(e.target.value)}>
                {agrupamentos.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </div>
            <div className="campo">
              <label htmlFor="q-agr2">{t('Cruzar com', 'Cross with')}</label>
              <select id="q-agr2" value={agr2Rasc} onChange={(e) => setAgr2Rasc(e.target.value)} disabled={agrRasc === 'total'}>
                <option value="">{t('(sem cruzamento)', '(no cross-tab)')}</option>
                {agrupamentos.filter(([k]) => k !== 'total' && k !== agrRasc).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
              </select>
            </div>
          </>
        )} />

      {!aplicada && <p className="vazio">{t('Escolha os filtros e clique em Consultar.', 'Choose the filters and click Run query.')}</p>}
      {aplicada && (
        <>
          <div className="filtros opcoes-resultado">
            <div className="campo">
              <label htmlFor="q-moeda">{t('Valores em reais', 'Values in R$')}</label>
              <select id="q-moeda" value={recorte.moeda} onChange={(e) => definir({ moeda: e.target.value === 'real' ? 'real' : null })}>
                <option value="nominal">{t(`Nominais (R$ de ${ano})`, `Nominal (${ano} R$)`)}</option>
                <option value="real">{t(`Reais (R$ de dez/${meta.baseIpca}, IPCA)`, `Real (Dec/${meta.baseIpca} R$, IPCA)`)}</option>
              </select>
            </div>
            <div className="campo">
              <label htmlFor="q-nmin">{t('Marcar grupos com N abaixo de', 'Flag groups with N below')}</label>
              <input id="q-nmin" type="number" min={0} max={10000} value={recorte.nmin} style={{ width: 90 }}
                onChange={(e) => definir({ nmin: Number(e.target.value) === 30 ? null : Math.max(0, Number(e.target.value) || 0) })} />
            </div>
          </div>
          <Estado carregando={total.carregando} erro={total.erro} tentarNovamente={total.recarregar} cancelar={cancelarConsultasTrabalho}
            vazio={!total.carregando && !total.erro && !num(tot?.vinculos) && t('Nenhum vínculo com esses filtros.', 'No jobs match these filters.')} />
          {tot && num(tot.vinculos) ? (
            <>
              <div className="kpis kpis-4">
                <Kpi rotulo={t('Vínculos no recorte', 'Jobs in the recorte')} valor={numero(num(tot.vinculos))}
                  nota={recorte.situacao === 'ativos' ? t('ativos em 31/12', 'active on Dec 31')
                    : t(`${numero(ativos)} ativos em 31/12 · ${numero(num(tot.desligados))} desligados`, `${numero(ativos)} active on Dec 31 · ${numero(num(tot.desligados))} separated`)} />
                <Kpi rotulo={t('Remuneração de dezembro (média)', 'December pay (average)')} valor={reaisExato(m(tot.rem_dez_media))}
                  nota={<>{t(`N válido: ${numero(nRem)} de ${numero(ativos)} ativos`, `Valid N: ${numero(nRem)} of ${numero(ativos)} active`)}{pequeno(nRem, recorte.nmin) && <span className="n-pequeno"> · {t('N pequeno', 'small N')}</span>}</>}
                  dica={<Dica rotulo={t('Definições', 'Definitions')}>{notaDefinicoes()}</Dica>} />
                <Kpi rotulo={t('Fora do cálculo salarial', 'Left out of pay')} valor={`${numero(foraRem)} (${pct(div(foraRem, ativos))})`}
                  nota={num(tot.rem_dez_ausente) !== null
                    ? t(`ausente ${numero(num(tot.rem_dez_ausente))} · zero ${numero(num(tot.rem_dez_zero))} · negativa ${numero(num(tot.rem_dez_negativa))}`, `missing ${numero(num(tot.rem_dez_ausente))} · zero ${numero(num(tot.rem_dez_zero))} · negative ${numero(num(tot.rem_dez_negativa))}`)
                    : t('ativos sem remuneração válida em dezembro (as tabelas pré-somadas não separam ausente e zero)', 'active jobs without valid December pay (the pre-aggregated tables do not split missing and zero)')} />
                <Kpi rotulo={t('Mediana de dezembro', 'December median')} valor={micro ? reaisExato(m(tot.rem_dez_mediana)) : t('indisponível', 'unavailable')}
                  nota={micro ? `P10 ${reaisExato(p10)} · P90 ${reaisExato(p90)}${p10 && p90 ? ` · P90/P10 ${numero1(p90 / p10)}` : ''}` : t('precisa dos microdados: escolha uma UF ou um município', 'needs the microdata: choose a state or municipality')} />
                <Kpi rotulo={t('Remuneração por hora contratada', 'Pay per contracted hour')} valor={micro ? reaisExato(m(tot.rem_hora_media)) : t('indisponível', 'unavailable')}
                  nota={micro ? t(`aproximação; N ${numero(num(tot.n_rem_hora))} com jornada de 1 a 44 h`, `approximation; N ${numero(num(tot.n_rem_hora))} with 1–44 weekly hours`) : t('precisa dos microdados', 'needs the microdata')} />
                <Kpi rotulo={t('Remuneração média mensal do ano', 'Average monthly pay for the year')} valor={reaisExato(m(tot.rem_media_media))}
                  nota={`N ${numero(num(tot.n_rem_media))}${micro ? ` · ${t('mediana', 'median')} ${reaisExato(m(tot.rem_media_mediana))}` : ''} · ${t('não é renda anual', 'not annual income')}`} />
                <Kpi rotulo={t('Mulheres', 'Women')} valor={pct(div(num(tot.mulheres), num(tot.vinculos)))}
                  nota={t(`${numero(num(tot.mulheres))} de ${numero(num(tot.vinculos))} vínculos`, `${numero(num(tot.mulheres))} of ${numero(num(tot.vinculos))} jobs`)} />
                <Kpi rotulo={t('Superior completo', 'College degree')} valor={pct(div(num(tot.superior), num(tot.vinculos)))}
                  nota={t(`${numero(num(tot.superior))} vínculos · afastados no ano: ${pct(div(num(tot.afastados), num(tot.vinculos)))}`, `${numero(num(tot.superior))} jobs · on leave in the year: ${pct(div(num(tot.afastados), num(tot.vinculos)))}`)} />
              </div>
              <div className="nota-base acoes-cartao">{moedaTexto}. {t('Percentuais: numerador e denominador nas notas de cada cartão.', 'Percentages: numerator and denominator in each card’s note.')}{' '}
                <BotoesExportar nome={`rais_consulta_${ano}_total`} obter={tabelaTotal} />
              </div>
            </>
          ) : null}
          {agrupar !== 'total' && (
            <section className="cartao">
              <div className="cabeca-cartao">
                <div>
                  <h3>{agrupar2 ? `${nomeAgrupar} × ${nomeAgrupar2}` : t(`Por ${nomeAgrupar.toLowerCase()}`, `By ${nomeAgrupar.toLowerCase()}`)}</h3>
                  <p className="desc">{rotulo} · RAIS {ano} · {moedaTexto}
                    {(num(grupos.dados?.linhas[0]?.grupos_total) ?? 0) > (grupos.dados?.linhas.length ?? 0)
                      ? t(` · a tela mostra os ${numero(grupos.dados?.linhas.length)} maiores de ${numero(num(grupos.dados?.linhas[0]?.grupos_total))} grupos; a exportação traz todos`,
                        ` · showing the ${numero(grupos.dados?.linhas.length)} largest of ${numero(num(grupos.dados?.linhas[0]?.grupos_total))} groups; the export has all`) : ''}</p>
                </div>
                <div className="acoes-cartao">
                  <BotoesExportar nome={`rais_consulta_${ano}_${agrupar}${agrupar2 ? `_x_${agrupar2}` : ''}`} obter={tabelaGrupos} />
                  <button className="botao-leve" disabled={!grupos.dados} onClick={async () => baixarPacote(`rais_consulta_${ano}_${agrupar}`, [
                    { nome: t('total do recorte', 'recorte total'), tabela: tabelaTotal(), sql: total.dados?.sql },
                    { nome: agrupar2 ? `${agrupar}_x_${agrupar2}` : agrupar, tabela: await tabelaGrupos(), sql: grupos.dados?.sql },
                  ], { painel: 'mercado de trabalho (RAIS)', territorio: { rotulo, ...escopo }, ano, recorte, endereco: location.href, versao_base: meta.geradoEm }, idioma() === 'en' ? '.' : ',')}>
                    {t('Pacote de pesquisa (zip)', 'Research package (zip)')}
                  </button>
                </div>
              </div>
              <Estado carregando={grupos.carregando} erro={grupos.erro} tentarNovamente={grupos.recarregar} cancelar={cancelarConsultasTrabalho} />
              {grupos.dados && agrupar2 && (
                <Cruzamento linhas={grupos.dados.linhas} nome1={nomeAgrupar} nome2={nomeAgrupar2} pctModo={recorte.pct}
                  mudarPct={(v) => definir({ pct: v === 'abs' ? null : v })} nmin={recorte.nmin} />
              )}
              {grupos.dados && !agrupar2 && (
                <>
                  <div className="filtros">
                    <div className="campo">
                      <label htmlFor="q-busca">{t('Buscar na tabela', 'Search the table')}</label>
                      <input id="q-busca" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={t('código ou nome…', 'code or name…')} />
                    </div>
                    <details className="colunas">
                      <summary>{t('Colunas', 'Columns')} ({visiveis.length})</summary>
                      <div className="lista-codigos">
                        {colunas.filter((c) => !repetidas.has(c.id)).map((c) => (
                          <label key={c.id}>
                            <input type="checkbox" checked={visiveis.includes(c)} onChange={(e) => {
                              const ids = new Set(visiveis.map((v) => v.id));
                              if (e.target.checked) ids.add(c.id); else ids.delete(c.id);
                              definir({ cols: colunas.filter((x) => ids.has(x.id)).map((x) => x.id).join(',') });
                            }} /> {c.titulo}
                          </label>
                        ))}
                        <button className="limpar" onClick={() => definir({ cols: null })}>{t('colunas padrão', 'default columns')}</button>
                      </div>
                    </details>
                  </div>
                  <div className="rolagem">
                    <table className="tabela-fixa">
                      <thead>
                        <tr>
                          <th>{nomeAgrupar}</th>
                          {visiveis.map((c) => (
                            <th key={c.id} aria-sort={ordem?.id === c.id ? (ordem.desc ? 'descending' : 'ascending') : 'none'}>
                              <button className="valor-exato" onClick={() => setOrdem({ id: c.id, desc: ordem?.id === c.id ? !ordem.desc : true })}>
                                {c.titulo}{ordem?.id === c.id ? (ordem.desc ? ' ▼' : ' ▲') : ''}
                              </button>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map((r) => (
                          <tr key={String(r.grupo)}>
                            <td title={String(r.grupo ?? '')}>{r.grupo === null ? t('(não informado)', '(not reported)') : r.nome ? `${r.grupo} · ${r.nome}` : `${r.grupo} · ${t('código sem nome no dicionário', 'code without a name in the dictionary')}`}</td>
                            {visiveis.map((c) => {
                              const n = c.n?.(r);
                              const marca = pequeno(n, recorte.nmin) && c.valor(r, tot) !== null;
                              return <td key={c.id} className={marca ? 'n-pequeno' : undefined} title={n !== undefined && n !== null ? `N = ${numero(n)}` : undefined}>{c.formato(c.valor(r, tot))}{marca ? ' ‡' : ''}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="legenda-tabela">
                    ‡ {t(`N abaixo de ${recorte.nmin} vínculos no denominador do valor (passe o mouse para ver o N): leia com cautela.`, `N below ${recorte.nmin} jobs in the value’s denominator (hover to see N): read with caution.`)}{' '}
                    {t('Valores ausentes aparecem como "–", nunca como zero.', 'Missing values show as "–", never as zero.')}
                  </p>
                </>
              )}
              {grupos.dados?.sql && (
                <details className="sql"><summary>{t('SQL desta tabela (DuckDB, sobre os arquivos publicados)', 'SQL for this table (DuckDB, over the published files)')}</summary><pre>{grupos.dados.sql}</pre></details>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
