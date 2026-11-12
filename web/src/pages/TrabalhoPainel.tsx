import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useApi, type Linha } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { AjudaTrabalho } from '../components/AjudaTrabalho';
import { TodasAnalises } from '../components/PerguntasTrabalho';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros } from '../contexto';
import { fonteConsulta } from '../dados';
import { div, numero, numero1, pct, reais, reaisCurto, reaisExato } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';
import { concentracao, marcasQuebra, notaComparabilidade, quebrasEntre, useRecorte } from '../trabalho_comum';
import {
  calcularRais, faixaMeses, GRANDES_SETORES, somarCagedAno, valorExportado, type CagedAno, type Condicao, type PainelRais,
} from '../trabalho_painel';
import { IndiceSaude } from './SaudeDatasus';
import { PerfisRais } from './TrabalhoPerfisRais';
import {
  AvisoAno, AvisoRecorte, fonteCaged, fonteRais, MESES, NotaQuebra, notaPorMil, notaRemuneracao, notaSetores, SemDados, SETORES, useTrabalho,
} from './Trabalho';

type Bloco = 'empregos' | 'remuneracao' | 'perfil' | 'atividades' | 'caged';
type Un = 'vinculos' | 'estabelecimentos' | 'pct' | 'por_mil' | 'razao' | 'reais' | 'reais_massa' | 'media';

/** Indicador do painel: o cartão da tela e a linha do arquivo exportado saem do mesmo objeto. */
type Indicador = {
  bloco: Bloco; id: string; rotulo: string; valor: number | null; un: Un; fonte: 'RAIS' | 'CAGED'; ano: number;
  texto?: string;      // valor já formatado quando não é só o número (ex.: "fora da cobertura")
  nota: string; dica?: ReactNode; condicao: Condicao | 'observado';
};

const UNIDADE = (): Record<Un, string> => ({
  vinculos: t('vínculos', 'jobs'), estabelecimentos: t('estabelecimentos', 'establishments'), pct: '%',
  por_mil: t('vínculos por mil habitantes', 'jobs per thousand inhabitants'), razao: t('% (mulheres ÷ homens)', '% (women ÷ men)'),
  reais: 'R$', reais_massa: 'R$', media: t('vínculos por estabelecimento', 'jobs per establishment'),
});
const CONDICAO = (): Record<Condicao | 'observado', string> => ({
  ok: t('observado', 'observed'), observado: t('observado; atravessa quebra de série', 'observed; crosses a series break'),
  ausente: t('sem dado', 'no data'), parcial: t('parcial', 'partial'), sem_registros: t('sem registros', 'no records'), fora_cobertura: t('fora da cobertura', 'outside coverage'),
});

const formatar = (i: Indicador): string => {
  if (i.texto) return i.texto;
  switch (i.un) {
    case 'pct': return pct(i.valor);
    case 'razao': return pct(i.valor, 0);
    case 'reais': return reaisExato(i.valor);
    case 'reais_massa': return reais(i.valor);
    case 'por_mil': return i.valor === null ? '–' : numero(i.valor);
    case 'media': return numero1(i.valor);
    default: return numero(i.valor);
  }
};
const comSinal = (v: number | null) => (v === null ? '–' : `${v > 0 ? '+' : ''}${numero(v)}`);

const BLOCOS = (): { id: Bloco; titulo: string; desc: string }[] => [
  { id: 'empregos', titulo: t('Empregos e estabelecimentos', 'Jobs and establishments'), desc: t('Vínculos formais ativos em 31/12 (RAIS): contratos, não pessoas.', 'Formal jobs active on Dec 31 (RAIS): contracts, not people.') },
  { id: 'remuneracao', titulo: t('Remuneração', 'Pay'), desc: t('Remuneração de dezembro dos vínculos ativos; a massa de dezembro não é renda nem massa anual.', 'December pay of active jobs; December payroll is neither income nor annual payroll.') },
  { id: 'perfil', titulo: t('Perfil dos vínculos', 'Job profile'), desc: t('Quem ocupa os vínculos ativos: sexo, idade e escolaridade, como declarados na RAIS.', 'Who holds the active jobs: sex, age and education, as declared in RAIS.') },
  { id: 'atividades', titulo: t('Atividades econômicas', 'Economic activities'), desc: t('Vínculos pela atividade (CNAE 2.0) do estabelecimento.', 'Jobs by the establishment’s activity (CNAE 2.0).') },
  { id: 'caged', titulo: t('Contratações e saídas (CAGED)', 'Hirings and exits (CAGED)'), desc: t('Movimentação do ano-calendário dos empregos celetistas: fluxo, distinto do estoque da RAIS em 31/12.', 'Calendar-year movements of CLT jobs: a flow, distinct from the RAIS stock on Dec 31.') },
];

/** Todos os indicadores do painel, a partir só dos agregados já publicados. */
function montarIndicadores(r: PainelRais, c: CagedAno | null, baseIpca: unknown, quebra: boolean): Indicador[] {
  const ano = r.ano;
  const base = String(baseIpca ?? '');
  const o = (v: number | null): Condicao => (v === null ? 'ausente' : 'ok');
  const ind = (bloco: Bloco, id: string, rotulo: string, valor: number | null, un: Un, nota: string, extra: Partial<Indicador> = {}): Indicador =>
    ({ bloco, id, rotulo, valor, un, fonte: 'RAIS', ano, nota, condicao: o(valor), ...extra });
  const setorNome = new Map(SETORES());
  const lista: Indicador[] = [
    ind('empregos', 'empregos', t('Vínculos formais ativos (31/12)', 'Formal jobs active (Dec 31)'), r.empregos, 'vinculos', `RAIS ${ano}`),
    ind('empregos', 'variacao', t('Variação dos vínculos', 'Change in jobs'), r.variacaoAbs, 'vinculos',
      r.variacaoAbs === null ? t(`sem RAIS de ${ano - 1} para comparar`, `no ${ano - 1} RAIS to compare`)
        : t(`${pct(r.variacaoPct)} sobre ${ano - 1}${quebra ? ' · observada; atravessa quebra de série' : ''}`, `${pct(r.variacaoPct)} on ${ano - 1}${quebra ? ' · observed; crosses a series break' : ''}`),
      { texto: r.variacaoAbs === null ? undefined : comSinal(r.variacaoAbs), condicao: r.variacaoAbs === null ? 'ausente' : quebra ? 'observado' : 'ok' }),
    ind('empregos', 'por_mil', t('Vínculos por mil habitantes', 'Jobs per thousand inhabitants'), r.porMil, 'por_mil',
      t(`população de ${ano}; não é taxa de ocupação`, `${ano} population; not an employment rate`), { dica: <Dica rotulo={t('Fórmula', 'Formula')}>{notaPorMil(ano)}</Dica> }),
    ind('empregos', 'estabelecimentos', t('Estabelecimentos com vínculos ativos', 'Establishments with active jobs'), r.estabelecimentos, 'estabelecimentos',
      t('estabelecimentos que declararam ao menos um vínculo ativo', 'establishments that reported at least one active job')),
    ind('empregos', 'vinculos_por_estab', t('Vínculos por estabelecimento', 'Jobs per establishment'), r.vinculosPorEstab, 'media',
      t(`média: ${numero(r.empregos)} vínculos ÷ ${numero(r.estabelecimentos)} estabelecimentos`, `average: ${numero(r.empregos)} jobs ÷ ${numero(r.estabelecimentos)} establishments`)),

    ind('remuneracao', 'rem_media', t('Remuneração média de dezembro', 'Average December pay'), r.remMedia, 'reais',
      t('nominal; massa ÷ todos os ativos (regra do PDET)', 'nominal; payroll ÷ all active jobs (PDET rule)'), { dica: <Dica rotulo={t('Fórmula', 'Formula')}>{notaRemuneracao()}</Dica> }),
    ind('remuneracao', 'rem_media_real', t('Remuneração média real', 'Average real pay'), r.remMediaReal, 'reais',
      t(`R$ de dez/${base}, corrigida pelo IPCA`, `Dec/${base} R$, adjusted by IPCA`)),
    ind('remuneracao', 'massa', t('Massa de dezembro (nominal)', 'December payroll (nominal)'), r.massa, 'reais_massa',
      t('soma dos valores de dezembro; não é massa anual nem renda', 'sum of December values; not annual payroll or income')),
    ind('remuneracao', 'massa_real', t('Massa de dezembro (real)', 'December payroll (real)'), r.massaReal, 'reais_massa', t(`R$ de dez/${base}`, `Dec/${base} R$`)),
    ind('remuneracao', 'rem_mulheres', t('Remuneração média das mulheres', 'Women’s average pay'), r.remMulheres, 'reais',
      t('nominal; massa das mulheres ÷ vínculos de mulheres', 'nominal; women’s payroll ÷ women’s jobs')),
    ind('remuneracao', 'rem_homens', t('Remuneração média dos homens', 'Men’s average pay'), r.remHomens, 'reais',
      t('nominal; massa dos homens ÷ vínculos de homens', 'nominal; men’s payroll ÷ men’s jobs')),
    ind('remuneracao', 'razao_mh', t('Remuneração mulheres ÷ homens', 'Women ÷ men pay'), r.razaoMH, 'razao',
      t('diferença observada entre médias; não compara quem faz o mesmo trabalho', 'observed difference between averages; it does not compare people doing the same work')),
    ind('remuneracao', 'sem_rem', t('Ativos sem remuneração válida de dezembro', 'Active jobs without valid December pay'), r.semRem, 'vinculos',
      t(`${pct(r.pctSemRem)} dos ativos; contam como zero na média; ${numero(r.nRem)} têm o valor`, `${pct(r.pctSemRem)} of active jobs; counted as zero in the average; ${numero(r.nRem)} have the value`)),

    ind('perfil', 'mulheres', t('Mulheres', 'Women'), r.mulheres.pct, 'pct', t(`${numero(r.mulheres.n)} vínculos`, `${numero(r.mulheres.n)} jobs`)),
    ind('perfil', 'homens', t('Homens', 'Men'), r.homens.pct, 'pct',
      t(`${numero(r.homens.n)} vínculos${r.sexoIgnorado ? `; ${numero(r.sexoIgnorado)} sem sexo informado (fora dos dois grupos)` : ''}`,
        `${numero(r.homens.n)} jobs${r.sexoIgnorado ? `; ${numero(r.sexoIgnorado)} with sex not reported (in neither group)` : ''}`)),
    ind('perfil', 'ate24', t('Até 24 anos', 'Up to 24'), r.ate24.pct, 'pct', t(`${numero(r.ate24.n)} vínculos`, `${numero(r.ate24.n)} jobs`)),
    ind('perfil', 'de50mais', t('50 anos ou mais', '50 or older'), r.de50mais.pct, 'pct', t(`${numero(r.de50mais.n)} vínculos`, `${numero(r.de50mais.n)} jobs`)),
    ind('perfil', 'superior', t('Ensino superior completo', 'College degree'), r.superior.pct, 'pct', t(`${numero(r.superior.n)} vínculos`, `${numero(r.superior.n)} jobs`)),
    ...GRANDES_SETORES.map((s) => ind('atividades', `setor_${s}`, setorNome.get(s) ?? s, r.setores[s].pct, 'pct', t(`${numero(r.setores[s].n)} vínculos`, `${numero(r.setores[s].n)} jobs`),
      s === 'adm_publica' ? { dica: <Dica rotulo={t('Classificação', 'Classification')}>{notaSetores()}</Dica> } : {})),
  ];
  if (c) {
    const mes = MESES();
    const cob = c.condicao === 'fora_cobertura' || c.condicao === 'sem_registros' ? c.condicao : c.condicao === 'parcial' ? 'parcial' : 'ok';
    const nota = c.condicao === 'fora_cobertura' ? t(`${c.ano} fora do período publicado do CAGED`, `${c.ano} is outside the published CAGED period`)
      : c.condicao === 'sem_registros' ? t(`sem linhas em ${c.ano} neste recorte; não é o mesmo que zero`, `no rows in ${c.ano} for this scope; not the same as zero`)
        : t(`${faixaMeses(c.mesesCobertos, mes)}/${c.ano} · ${c.mesesCobertos.length} de 12 meses${c.condicao === 'parcial' ? ' (ano parcial)' : ''}`,
          `${faixaMeses(c.mesesCobertos, mes)}/${c.ano} · ${c.mesesCobertos.length} of 12 months${c.condicao === 'parcial' ? ' (partial year)' : ''}`);
    const cg = (id: string, rotulo: string, valor: number | null, extra = ''): Indicador => ({
      bloco: 'caged', id, rotulo, valor, un: 'vinculos', fonte: 'CAGED', ano: c.ano,
      // valor anual ausente num mês com registro: sem dado, mesmo com os 12 meses cobertos
      condicao: valor === null && (cob === 'ok' || cob === 'parcial') ? 'ausente' : cob, nota: nota + extra,
      texto: valor === null ? CONDICAO()[cob === 'ok' || cob === 'parcial' ? 'ausente' : cob] : undefined,
    });
    lista.push(cg('caged_admissoes', t('Admissões no ano', 'Hirings in the year'), c.admissoes), cg('caged_desligamentos', t('Desligamentos no ano', 'Separations in the year'), c.desligamentos),
      cg('caged_saldo', t('Saldo no ano', 'Net balance in the year'), c.saldo, ' · ' + t('admissões − desligamentos', 'hirings − separations')));
  }
  return lista;
}

export function TrabalhoPainel() {
  const { anoRais, escopo, rotulo, temDados, meta, caged } = useTrabalho();
  const { busca } = useRecorte();
  const raiz = useRef<HTMLDivElement>(null);
  const serie = useApi<Linha[]>(temDados ? 'trab_serie' : null, escopo);
  const setores = useApi<Linha[]>(temDados && anoRais ? 'trab_setores' : null, { ...escopo, ano: anoRais });
  const cagedApi = useApi<Linha[]>(caged ? 'trab_caged' : null, escopo);
  const [todos, setTodos] = useState(false);
  const s = serie.dados ?? [];
  const anos = s.map((r) => Number(r.ano));
  const rais = useMemo(() => calcularRais(s.find((r) => Number(r.ano) === anoRais), s.find((r) => Number(r.ano) === (anoRais ?? 0) - 1), anoRais ?? 0), [serie.dados, anoRais]); // eslint-disable-line react-hooks/exhaustive-deps
  const cagedAno = useMemo(() => (caged && anoRais && cagedApi.dados ? somarCagedAno(cagedApi.dados, anoRais, caged.de, caged.ate) : null), [cagedApi.dados, caged, anoRais]);
  const quebra = anoRais ? quebrasEntre(anoRais - 1, anoRais)[0] : undefined;
  const indicadores = useMemo(() => (rais ? montarIndicadores(rais, cagedAno, meta.baseIpca, !!quebra) : []), [rais, cagedAno, meta.baseIpca, quebra]);
  // o resumo exportado só existe completo: depende das divisões e do CAGED, que carregam à parte dos cartões da RAIS
  const resumoErro = !!(setores.erro || (caged && cagedApi.erro));
  const resumoCompleto = !!rais && !!setores.dados && (!caged || (!!cagedApi.dados && !!cagedAno));
  const lista = setores.dados ?? [];
  const totalSet = lista.reduce((x, r) => x + (num(r.empregos) ?? 0), 0);
  const conc = useMemo(() => (setores.dados ? concentracao(setores.dados.map((r) => ({ nome: `${r.divisao} · ${String(r.divisao_nome ?? r.divisao)}`, valor: num(r.empregos) }))) : null), [setores.dados]);
  const micro = fonteConsulta(escopo) === 'micro';
  const marcas = marcasQuebra(anos);
  const base = String(meta.baseIpca);
  const nomeSetor = (k: string) => SETORES().find(([c]) => c === k)?.[1] ?? k;

  const opcaoEmpregos = useMemo(() => linhas(anos, [{ nome: t('Vínculos ativos em 31/12', 'Jobs active on Dec 31'), valores: s.map((r) => num(r.empregos)) }], (v) => numero(v), marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoRem = useMemo(() => linhas(anos, [
    { nome: t(`Real (R$ dez/${base})`, `Real (Dec/${base} R$)`), valores: s.map((r) => num(r.remuneracao_media_real)) },
    { nome: 'Nominal', valores: s.map((r) => num(r.remuneracao_media)) },
  ], reaisCurto, marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoPerfil = useMemo(() => linhas(anos, [
    { nome: t('Mulheres', 'Women'), valores: s.map((r) => div(num(r.mulheres), num(r.empregos))) },
    { nome: t('Ensino superior', 'College degree'), valores: s.map((r) => div(num(r.superior), num(r.empregos))) },
    { nome: t('Até 24 anos', 'Up to 24'), valores: s.map((r) => div(num(r.ate24), num(r.empregos))) },
    { nome: t('50 anos ou mais', '50 or older'), valores: s.map((r) => div(num(r.de50mais), num(r.empregos))) },
  ], (v) => pct(v, 0), marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoSetoresSerie = useMemo(() => linhas(anos, GRANDES_SETORES.map((k) => ({ nome: nomeSetor(k), valores: s.map((r) => num(r[`empregos_${k}`])) })), (v) => numero(v), marcas), [serie.dados]); // eslint-disable-line react-hooks/exhaustive-deps
  const opcaoSetoresAno = useMemo(() => barras(SETORES().map(([, n]) => n), GRANDES_SETORES.map((k) => rais?.setores[k].n ?? null), (v) => numero(v), true), [rais]);

  if (!temDados) return <><h2 className="titulo-pagina">{t('Mercado de trabalho', 'Labour market')}</h2><SemDados /></>;
  const anosTabela = anos.map((a) => (quebrasEntre(a - 1, a).length ? `${a} †` : String(a)));
  const nota = notaComparabilidade(anos);
  const meta2: [string, string][] = [[t('Recorte', 'Scope'), rotulo], [t('Universo', 'Universe'), t('vínculos ativos em 31/12 (todos)', 'jobs active on Dec 31 (all)')],
    [t('Fonte', 'Source'), fonteRais()], ...(nota ? [[t('Comparabilidade', 'Comparability'), nota] as [string, string]] : [])];
  const cartoes = (b: Bloco) => indicadores.filter((i) => i.bloco === b).map((i) => (
    <Kpi key={i.id} rotulo={i.rotulo} valor={formatar(i)} nota={i.nota} dica={i.dica} />
  ));
  const cobCaged = caged ? `${caged.de ? `${String(caged.de % 100).padStart(2, '0')}/${Math.floor(caged.de / 100)}` : '–'}–${caged.ate ? `${String(caged.ate % 100).padStart(2, '0')}/${Math.floor(caged.ate / 100)}` : '–'}` : '';
  const titulo = (b: Bloco) => {
    const x = BLOCOS().find((y) => y.id === b)!;
    return (
      <>
        <h3 className="secao bloco-saude" id={`trabalho-${b}`} data-indice={x.titulo} tabIndex={-1}>{x.titulo}</h3>
        <p className="nota-base">{x.desc}</p>
      </>
    );
  };

  return (
    <>
      <h2 className="titulo-pagina">{t('Mercado de trabalho: painel de indicadores', 'Labour market: indicator dashboard')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {anoRais} <Dica rotulo={t('Fonte', 'Source')}>{fonteRais()}</Dica></p>
      <BarraFiltros />
      <AvisoAno anoRais={anoRais} />
      <AvisoRecorte pagina={t('o painel de indicadores', 'the indicator dashboard')} />
      <div ref={raiz}>
        <IndiceSaude raiz={raiz} />
        <Estado carregando={serie.carregando} erro={serie.erro} tentarNovamente={serie.recarregar}
          vazio={!serie.carregando && !serie.erro && !rais && t('Sem vínculos na RAIS para este recorte e ano.', 'No RAIS jobs for this scope and year.')} />
        {rais && (
          <>
            {titulo('empregos')}
            <div className="kpis kpis-4">{cartoes('empregos')}</div>
            {quebra && <NotaQuebra anos={[anoRais! - 1, anoRais!]} />}

            {titulo('remuneracao')}
            <div className="kpis kpis-4">{cartoes('remuneracao')}</div>

            {titulo('perfil')}
            <div className="kpis kpis-4">{cartoes('perfil')}</div>
            <p className="nota-base">{t('Percentuais sobre todos os vínculos ativos. Sexo, idade e escolaridade são os declarados na RAIS; vínculos com informação ausente continuam no denominador.',
              'Percentages over all active jobs. Sex, age and education are as declared in RAIS; jobs with missing information stay in the denominator.')}</p>
          </>
        )}

        {/* raça/cor, escolaridade e tipos de vínculo: carregam à parte (um Parquet pequeno do ano), sem esperar nem travar os indicadores */}
        <PerfisRais anoRais={anoRais} escopo={escopo} rotulo={rotulo} meta={meta} />

        {rais && (
          <>
            {titulo('atividades')}
            <div className="kpis kpis-4">{cartoes('atividades')}</div>
            <div className="grade-2">
              <CartaoGrafico titulo={t('Vínculos por grande setor (atividade do estabelecimento)', 'Jobs by broad sector (establishment activity)')} desc={`RAIS ${anoRais}`}
                acoes={<Dica rotulo={t('Classificação', 'Classification')}>{notaSetores()}</Dica>}>
                <Grafico opcao={opcaoSetoresAno} nome="trabalho_painel_setores" />
              </CartaoGrafico>
              <section className="cartao">
                <div className="cabeca-cartao">
                  <div>
                    <h3>{t('Todas as divisões da CNAE 2.0', 'All CNAE 2.0 divisions')}</h3>
                    <p className="desc">RAIS {anoRais} · {rotulo}</p>
                  </div>
                  <BotoesExportar nome={`trabalho_setores_${anoRais}`} obter={() => ({
                    colunas: [t('Divisão', 'Division'), t('Atividade', 'Activity'), t('Seção', 'Section'), t('Vínculos ativos', 'Active jobs'), t('Participação', 'Share'), t('Remuneração média (dez, nominal)', 'Average pay (Dec, nominal)')],
                    linhas: lista.map((r) => [r.divisao, r.divisao_nome, r.secao_nome, r.empregos, div(num(r.empregos), totalSet), r.remuneracao_media]),
                    metadados: [[t('Recorte', 'Scope'), rotulo], [t('Ano', 'Year'), String(anoRais)], [t('Linhas', 'Rows'), t(`todas as ${lista.length} divisões`, `all ${lista.length} divisions`)],
                      [t('Fórmula', 'Formula'), notaRemuneracao()], [t('Fonte', 'Source'), fonteRais()], [t('Versão da base', 'Data version'), meta.geradoEm]],
                  })} />
                </div>
                <Estado carregando={setores.carregando} erro={setores.erro} tentarNovamente={setores.recarregar} />
                {lista.length > 0 && (
                  <div className="rolagem">
                    <table className="tabela-fixa">
                      <thead><tr><th>{t('Atividade', 'Activity')}</th><th>{t('Vínculos', 'Jobs')}</th><th>%</th><th>{t('Remuneração', 'Pay')}</th></tr></thead>
                      <tbody>
                        {(todos ? lista : lista.slice(0, 12)).map((r) => (
                          <tr key={String(r.divisao)}>
                            <td title={`${r.divisao} · ${r.secao_nome ?? ''}`}>{r.divisao} · {String(r.divisao_nome ?? r.divisao)}</td>
                            <td>{numero(num(r.empregos))}</td><td>{pct(div(num(r.empregos), totalSet))}</td><td>{reaisExato(num(r.remuneracao_media))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {lista.length > 12 && (
                  <p className="legenda-tabela"><button className="limpar" onClick={() => setTodos(!todos)}>
                    {todos ? t('mostrar menos', 'show fewer') : t(`mostrar as ${lista.length} atividades`, `show all ${lista.length} activities`)}
                  </button></p>
                )}
              </section>
            </div>
            {conc && (
              <>
                <div className="kpis kpis-4">
                  <Kpi rotulo={t('3 maiores divisões', 'Top 3 divisions')} valor={pct(conc.parteTop3)} nota={conc.top3.map((x) => `${x.nome.split(' · ')[0]} ${pct(x.parte)}`).join(' · ')} />
                  <Kpi rotulo="HHI (0 – 10.000)" valor={numero(Math.round(conc.hhi * 10000))} nota={t('soma dos quadrados das participações × 10.000', 'sum of squared shares × 10,000')} />
                  <Kpi rotulo={t('Número efetivo de atividades', 'Effective number of activities')} valor={numero1(conc.efetivo)} nota={t(`1 ÷ HHI; de ${conc.n} divisões com vínculos`, `1 ÷ HHI; out of ${conc.n} divisions with jobs`)} />
                </div>
                <details className="trabalho-ajuda">
                  <summary>{t('Como se mede a concentração das atividades', 'How activity concentration is measured')}</summary>
                  <p>{t(`Participação de cada divisão = vínculos ativos da divisão ÷ vínculos ativos de todas as divisões do território (${conc.n} divisões com vínculos, ${numero(conc.total)} vínculos). HHI = soma dos quadrados das participações (de 0 a 1; aqui ×10.000). Número efetivo de atividades = 1 ÷ HHI: quantas divisões do mesmo tamanho teriam a mesma concentração. Mede como os vínculos se distribuem entre atividades do estabelecimento; não diz se a economia local é mais ou menos diversificada em valor, produção ou empresas. A divisão 84 é uma atividade e não equivale ao setor público.`,
                    `Share of each division = active jobs in the division ÷ active jobs in all divisions of the territory (${conc.n} divisions with jobs, ${numero(conc.total)} jobs). HHI = sum of squared shares (0 to 1; here ×10,000). Effective number of activities = 1 ÷ HHI: how many equal-sized divisions would give the same concentration. It measures how jobs are spread across establishment activities; it does not say whether the local economy is more or less diversified in value, output or firms. Division 84 is an activity and is not the public sector.`)}</p>
                </details>
              </>
            )}

            {titulo('caged')}
            {!caged && <p className="vazio">{t('Os dados do CAGED ainda não foram publicados.', 'CAGED data have not been published yet.')}</p>}
            {caged && (
              <>
                <Estado carregando={cagedApi.carregando} erro={cagedApi.erro} tentarNovamente={cagedApi.recarregar} />
                {cagedAno && <div className="kpis kpis-4">{cartoes('caged')}</div>}
                <p className="nota-base">{t(`Novo CAGED, empregos celetistas (não inclui estatutários), pela competência da movimentação; período publicado ${cobCaged}. Soma só os meses de ${anoRais}: é um fluxo do ano, não o estoque da RAIS em 31/12, e a diferença entre os dois não fecha por definição (cobertura, ajustes e outras formas de contrato).`,
                  `New CAGED, CLT jobs (statutory jobs not included), by month of movement; published period ${cobCaged}. It sums only the months of ${anoRais}: a flow for the year, not the RAIS stock on Dec 31, and the two are not expected to reconcile (coverage, adjustments and other contract types).`)}
                {cagedAno && cagedAno.condicao !== 'fora_cobertura' && cagedAno.mesesComRegistro.length < cagedAno.mesesCobertos.length && cagedAno.mesesComRegistro.length > 0
                  ? ` ${t(`Meses com linhas na tabela: ${cagedAno.mesesComRegistro.length} de ${cagedAno.mesesCobertos.length} cobertos; em município, mês sem movimentação pode não ter linha.`, `Months with rows in the table: ${cagedAno.mesesComRegistro.length} of ${cagedAno.mesesCobertos.length} covered; for a municipality, a month with no movements may have no row.`)}` : ''}
                {' '}<Dica rotulo={t('Fonte', 'Source')}>{fonteCaged()}</Dica></p>
              </>
            )}

            <h3 className="secao">{t('Séries históricas', 'Historical series')}</h3>
            <div className="grade-2">
              <CartaoGrafico titulo={t('Vínculos formais ativos em 31/12', 'Formal jobs active on Dec 31')}
                tabela={<TabelaSerie nome="trabalho_painel_empregos" anos={anosTabela} colunas={[
                  { titulo: t('Vínculos ativos', 'Active jobs'), valores: s.map((r) => num(r.empregos)), formato: numero },
                  { titulo: t('Estabelecimentos', 'Establishments'), valores: s.map((r) => num(r.estabelecimentos)), formato: numero },
                  { titulo: t('Massa de dezembro (nominal)', 'December payroll (nominal)'), valores: s.map((r) => num(r.massa_dez)), formato: reais },
                ]} metadados={meta2} />}>
                <Grafico opcao={opcaoEmpregos} nome="trabalho_painel_empregos" />
              </CartaoGrafico>
              <CartaoGrafico titulo={t('Remuneração média de dezembro', 'Average December pay')} desc={t('Nominal e real (IPCA de dezembro)', 'Nominal and real (December IPCA)')}
                acoes={<Dica rotulo={t('Fórmula', 'Formula')}>{notaRemuneracao()}</Dica>}
                tabela={<TabelaSerie nome="trabalho_painel_remuneracao" anos={anosTabela} colunas={[
                  { titulo: 'Nominal', valores: s.map((r) => num(r.remuneracao_media)), formato: reaisExato },
                  { titulo: t(`Real (R$ dez/${base})`, `Real (Dec/${base} R$)`), valores: s.map((r) => num(r.remuneracao_media_real)), formato: reaisExato },
                  { titulo: t('Mulheres (nominal)', 'Women (nominal)'), valores: s.map((r) => num(r.remuneracao_mulheres)), formato: reaisExato },
                  { titulo: t('Homens (nominal)', 'Men (nominal)'), valores: s.map((r) => num(r.remuneracao_homens)), formato: reaisExato },
                  { titulo: t('Com remuneração informada', 'With pay reported'), valores: s.map((r) => num(r.n_rem_dez)), formato: numero },
                ]} metadados={meta2} />}>
                <Grafico opcao={opcaoRem} nome="trabalho_painel_remuneracao" />
              </CartaoGrafico>
              <CartaoGrafico titulo={t('Perfil dos vínculos', 'Job profile')} desc={t('Participação sobre os vínculos ativos', 'Share of active jobs')}
                tabela={<TabelaSerie nome="trabalho_painel_perfil" anos={anosTabela} colunas={[
                  { titulo: t('Mulheres', 'Women'), valores: s.map((r) => div(num(r.mulheres), num(r.empregos))), formato: (v) => pct(v) },
                  { titulo: t('Homens', 'Men'), valores: s.map((r) => div(num(r.homens), num(r.empregos))), formato: (v) => pct(v) },
                  { titulo: t('Ensino superior', 'College degree'), valores: s.map((r) => div(num(r.superior), num(r.empregos))), formato: (v) => pct(v) },
                  { titulo: t('Até 24 anos', 'Up to 24'), valores: s.map((r) => div(num(r.ate24), num(r.empregos))), formato: (v) => pct(v) },
                  { titulo: t('50 anos ou mais', '50 or older'), valores: s.map((r) => div(num(r.de50mais), num(r.empregos))), formato: (v) => pct(v) },
                ]} metadados={meta2} />}>
                <Grafico opcao={opcaoPerfil} nome="trabalho_painel_perfil" />
              </CartaoGrafico>
              <CartaoGrafico titulo={t('Vínculos por grande setor', 'Jobs by broad sector')} acoes={<Dica rotulo={t('Classificação', 'Classification')}>{notaSetores()}</Dica>}
                tabela={<TabelaSerie nome="trabalho_painel_setores_serie" anos={anosTabela}
                  colunas={GRANDES_SETORES.map((k) => ({ titulo: nomeSetor(k), valores: s.map((r) => num(r[`empregos_${k}`])), formato: numero }))} metadados={meta2} />}>
                <Grafico opcao={opcaoSetoresSerie} nome="trabalho_painel_setores_serie" />
              </CartaoGrafico>
            </div>
            <p className="legenda-tabela">† {t('ano com quebra de série apontada pelo MTE (nas tabelas e exportações).', 'year with a series break reported by the Ministry (in tables and exports).')}</p>

            <section className="cartao" aria-labelledby="trabalho-resumo-t">
              <h3 id="trabalho-resumo-t">{t('Exportar resumo dos indicadores', 'Export indicator summary')}</h3>
              <p className="nota-base">{t('Um arquivo com os 30 indicadores principais (valor, unidade, ano, fonte e condição do dado). Percentuais saem em pontos percentuais, como na tela. As distribuições de raça/cor, escolaridade e tipo de vínculo têm exportação própria em cada seção. Os botões dos gráficos e da tabela de divisões exportam outros arquivos.',
                'One file with the 30 main indicators (value, unit, year, source and data condition). Percentages come out in percentage points, as on screen. The race/colour, education and job-type distributions have their own export in each section. The chart and division-table buttons export other files.')}</p>
              {resumoCompleto ? (
            <BotoesExportar nome={`trabalho_painel_${anoRais}`} obter={() => ({
              colunas: [t('Bloco', 'Block'), t('Indicador', 'Indicator'), t('Valor', 'Value'), t('Unidade', 'Unit'), t('Ano', 'Year'), t('Fonte', 'Source'), t('Condição do dado', 'Data condition'), t('Nota', 'Note')],
              linhas: [
                ...indicadores.map((i) => [BLOCOS().find((b) => b.id === i.bloco)?.titulo ?? i.bloco, i.rotulo, valorExportado(i.valor, i.un), UNIDADE()[i.un], i.ano, i.fonte, CONDICAO()[i.condicao], i.nota]),
                ...(conc ? [[t('Atividades econômicas', 'Economic activities'), t('3 maiores divisões (participação)', 'Top 3 divisions (share)'), valorExportado(conc.parteTop3, 'pct'), '%', anoRais, 'RAIS', CONDICAO().ok, conc.top3.map((x) => x.nome).join(' · ')],
                  [t('Atividades econômicas', 'Economic activities'), 'HHI (0–10.000)', Math.round(conc.hhi * 10000), t('índice', 'index'), anoRais, 'RAIS', CONDICAO().ok, ''],
                  [t('Atividades econômicas', 'Economic activities'), t('Número efetivo de atividades', 'Effective number of activities'), conc.efetivo, t('divisões equivalentes', 'equivalent divisions'), anoRais, 'RAIS', CONDICAO().ok, `${conc.n} ${t('divisões com vínculos', 'divisions with jobs')}`]] : []),
              ],
              metadados: [[t('Recorte', 'Scope'), rotulo], [t('Ano do painel', 'Dashboard year'), String(anoRais)], [t('Fonte RAIS', 'RAIS source'), fonteRais()], [t('Fonte CAGED', 'CAGED source'), fonteCaged()],
                [t('Valores monetários', 'Monetary values'), t(`nominais, exceto os "reais" (R$ de dez/${base}, IPCA)`, `nominal, except the "real" ones (Dec/${base} R$, IPCA)`)],
                [t('Fórmula da remuneração', 'Pay formula'), notaRemuneracao()], [t('Versão da base', 'Data version'), meta.geradoEm]],
            })} />
              ) : (
                <p className="aviso" role="status">{resumoErro
                  ? t('O resumo completo não está disponível: uma das fontes (divisões da CNAE ou CAGED) falhou ao carregar. Os cartões já prontos continuam válidos.', 'The complete summary is unavailable: one of the sources (CNAE divisions or CAGED) failed to load. The cards already shown remain valid.')
                  : t('O resumo fica disponível quando as divisões da CNAE e o CAGED terminarem de carregar.', 'The summary becomes available when the CNAE divisions and CAGED finish loading.')}</p>
              )}
            </section>
          </>
        )}
      </div>
      <AjudaTrabalho />
      <details className="cartao trabalho-avancado">
        <summary>{t('Exploração avançada: consulta personalizada, perfil e demais recortes', 'Advanced exploration: custom query, profile and other cuts')}</summary>
        <TodasAnalises busca={busca} micro={micro} />
      </details>
    </>
  );
}
