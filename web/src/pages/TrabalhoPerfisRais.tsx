import { useMemo, type ReactNode } from 'react';
import { useApi, type Meta, type Params } from '../api';
import { DistribuicaoBarras, TabelaDistribuicao } from '../components/DistribuicaoPerfil';
import { BotoesExportar } from '../components/Exportar';
import { Estado } from '../components/Kpi';
import type { Tabela } from '../exportar';
import { numero, pct } from '../format';
import { idioma, t } from '../idioma';
import {
  colunasExportacao, disponibilidadePerfis, distribuicao, escopoDoPerfil, grupoMte, lerPerfil, linhasExportacao, PAGINAS_NOTA_MTE,
  superiorSomado, URL_NOTA_MTE, VARIAVEIS_PERFIL, type Linha, type PerfilLido, type VariavelPerfil,
} from '../trabalho_perfis';
import { fonteRais } from './Trabalho';

type Ok = Extract<PerfilLido, { estado: 'ok' }>;

const faixaAnos = (anos: number[]) => {
  if (!anos.length) return '–';
  const seguidos = anos.every((a, i) => i === 0 || a === anos[i - 1] + 1);
  return seguidos ? (anos.length === 1 ? String(anos[0]) : `${anos[0]}–${anos[anos.length - 1]}`) : anos.join(', ');
};

const GRUPO_CURTO = (): Record<string, string> => ({ '1': t('celetistas', 'CLT'), '2': t('estatutários', 'statutory'), '3': t('outros', 'other') });

/**
 * Três seções do painel de trabalho — Raça/cor, Escolaridade e Tipos de vínculo — com contagens e participações já
 * calculadas, lidas de UM Parquet pequeno (o do ano exibido) para o recorte atual. Carregam à parte dos indicadores:
 * a fonte é opcional (manifesto: fontes.rais_perfis), e sem ela, sem o ano ou com erro a seção diz isso, sem zeros e sem ano substituto.
 */
export function PerfisRais({ anoRais, escopo, rotulo, meta }: { anoRais: number | undefined; escopo: Params; rotulo: string; meta: Meta }) {
  const lang = idioma();
  const fonte = meta.fontes.rais_perfis;
  const disp = disponibilidadePerfis(fonte, anoRais);
  const esc = escopoDoPerfil(escopo);
  const pedir = disp.ok && esc !== null && anoRais !== undefined;
  // useApi só entrega dados da chave (rota + recorte + ano) atual: trocar filtro ou ano nunca mostra o resultado anterior
  const api = useApi<Linha[]>(pedir ? 'trab_perfis' : null, { ...escopo, ano: anoRais });
  const perfil = useMemo(() => (api.dados && anoRais !== undefined ? lerPerfil(api.dados, anoRais) : null), [api.dados, anoRais]);
  const pronto: Ok | null = perfil?.estado === 'ok' ? perfil : null;

  const motivo = (): ReactNode => {
    if (!disp.ok) {
      if (disp.motivo === 'sem_fonte') return t('Os perfis por raça/cor, escolaridade e tipo de vínculo ainda não foram publicados nesta versão dos dados. Os demais indicadores desta página não dependem deles.',
        'The race/colour, education and job-type profiles have not been published in this data version yet. The other indicators on this page do not depend on them.');
      if (disp.motivo === 'sem_ano') return t('Não há ano da RAIS selecionado.', 'No RAIS year is selected.');
      return t(`Os perfis da RAIS ${anoRais} ainda não foram publicados (disponíveis: ${faixaAnos(disp.anos)}). Não mostramos outro ano no lugar.`,
        `The RAIS ${anoRais} profiles have not been published yet (available: ${faixaAnos(disp.anos)}). No other year is shown in its place.`);
    }
    return null;
  };

  /** Estado da consulta: indisponível, carregando, erro, recorte ausente, inconsistente, sem vínculos; só então o conteúdo. */
  const corpo = (conteudo: (p: Ok) => ReactNode): ReactNode => {
    const m = motivo();
    if (m) return <p className="vazio" role="status">{m}</p>;
    if (esc === null) return <p className="vazio erro" role="alert">{t('Este recorte não tem identificação válida para os perfis da RAIS.', 'This scope has no valid identifier for the RAIS profiles.')}</p>;
    if (api.carregando || api.erro || !perfil) {
      return <Estado carregando={api.carregando || (!api.erro && !perfil)} erro={api.erro} tentarNovamente={api.recarregar}
        mensagem={t('Não foi possível carregar os perfis da RAIS deste recorte.', 'The RAIS profiles for this scope could not be loaded.')} />;
    }
    if (perfil.estado === 'sem_escopo') return <p className="vazio" role="status">{t(`Este recorte não consta nos perfis da RAIS ${anoRais}; isso não significa zero vínculos.`, `This scope is not in the RAIS ${anoRais} profiles; that does not mean zero jobs.`)}</p>;
    if (perfil.estado === 'inconsistente') {
      return (
        <div className="vazio erro" role="alert">
          <p>{t('Os perfis deste recorte não passaram na conferência (a soma das categorias não fecha com o total) e por isso não são exibidos nem exportados.',
            'The profiles for this scope failed the consistency check (the categories do not add up to the total), so they are neither shown nor exported.')}</p>
          <details><summary>{t('Detalhe técnico', 'Technical detail')}</summary><code>{perfil.problemas.join('; ')}</code></details>
        </div>
      );
    }
    if (perfil.total === 0) return <p className="vazio" role="status">{t(`Nenhum vínculo ativo em 31/12 de ${anoRais} neste recorte; participações não se aplicam.`, `No jobs active on Dec 31, ${anoRais}, in this scope; shares do not apply.`)}</p>;
    return conteudo(perfil);
  };

  const cobertura = (p: Ok) => (
    <p className="cobertura">
      RAIS {p.ano} · {rotulo} · <strong>{numero(p.total)}</strong> {t('vínculos ativos em 31/12 (contratos, não pessoas)', 'jobs active on Dec 31 (contracts, not people)')}
      {disp.ok && <> · {t('perfis publicados para', 'profiles published for')} {faixaAnos(disp.anos)}</>}
    </p>
  );

  const processado = typeof (fonte as { processado_em?: unknown } | undefined)?.processado_em === 'string' ? String((fonte as { processado_em?: unknown }).processado_em) : '';
  const tabela = (p: Ok, vars: readonly VariavelPerfil[]): Tabela => ({
    colunas: colunasExportacao(lang),
    linhas: linhasExportacao(p, vars, lang),
    metadados: [
      [t('Recorte', 'Scope'), rotulo], [t('Código do recorte no arquivo', 'Scope code in the file'), esc ?? ''], [t('Ano', 'Year'), String(p.ano)],
      [t('Universo', 'Universe'), t('vínculos formais ativos em 31/12 (contratos, não pessoas), nos municípios da base municipal da RAIS do ano; vínculos de município ignorado ou fora dessa base não entram',
        'formal jobs active on Dec 31 (contracts, not people), in the municipalities of the year’s RAIS municipal base; jobs in an unknown municipality or outside that base are not included')],
      [t('Unidades', 'Units'), t('vínculos = contagem; participação = % (0 a 100) sobre todos os vínculos ativos do recorte, incluindo campo vazio e códigos fora do dicionário',
        'jobs = count; share = % (0 to 100) of all active jobs in the scope, including empty fields and codes outside the dictionary')],
      [t('Categorias', 'Categories'), t('todas as do dicionário (0 quando não há vínculos), mais códigos desconhecidos e campo vazio quando observados',
        'every dictionary category (0 when there are no jobs), plus unknown codes and the empty field when observed')],
      [t('Agrupamento do MTE', 'Ministry grouping'), t(`agrupamento estatístico da nota técnica da RAIS 2023 (pp. ${PAGINAS_NOTA_MTE}), não o regime jurídico: contratos por lei estadual ou municipal em estatutários, aprendizes em outros. ${URL_NOTA_MTE}`,
        `statistical grouping from the RAIS 2023 technical note (pp. ${PAGINAS_NOTA_MTE}), not the legal regime: contracts under state or municipal law count as statutory, apprentices as other. ${URL_NOTA_MTE}`)],
      [t('Ensino superior', 'College'), t('superior completo, mestrado e doutorado são linhas separadas; o cartão "Ensino superior completo" soma as três', 'college degree, master’s and doctorate are separate rows; the "College degree" card adds the three')],
      [t('Fonte', 'Source'), fonteRais()],
      [t('Perfis pré-calculados em', 'Profiles computed on'), processado || meta.geradoEm], [t('Versão da base', 'Data version'), meta.geradoEm],
    ],
  });
  const exportar = (nome: string, vars: readonly VariavelPerfil[]) =>
    pronto && pronto.total > 0 ? <BotoesExportar nome={`${nome}_${pronto.ano}_${esc}`} obter={() => tabela(pronto, vars)} /> : null;

  const secao = (id: string, indice: string, desc: string) => (
    <>
      <h3 className="secao bloco-saude" id={id} data-indice={indice} tabIndex={-1}>{indice}</h3>
      <p className="nota-base">{desc}</p>
    </>
  );

  return (
    <>
      {secao('trabalho-raca', t('Raça/cor', 'Race/colour'),
        t('Vínculos ativos em 31/12 pela raça/cor declarada na RAIS: contratos, não pessoas; participação sobre todos os vínculos ativos do recorte.',
          'Jobs active on Dec 31 by the race/colour declared in RAIS: contracts, not people; share of all active jobs in the scope.'))}
      <section className="cartao" aria-label={t('Raça/cor', 'Race/colour')}>
        {corpo((p) => (
          <>
            {cobertura(p)}
            <DistribuicaoBarras itens={distribuicao(p, 'raca_cor', lang).itens} legenda={t('Vínculos ativos por raça/cor', 'Active jobs by race/colour')} />
            <p className="nota-base">{t('“Não identificada” é um código da própria RAIS; “Não informado” é o campo vazio (só aparece se houver). Ambos ficam no total e não são somados a nenhuma raça/cor. Percentuais arredondados em uma casa: a soma pode diferir de 100%.',
              '“Not identified” is a RAIS code; “Not reported” is the empty field (shown only if present). Both stay in the total and are not added to any race/colour. Percentages are rounded to one decimal: they may not add up to exactly 100%.')}</p>
            {exportar('trabalho_raca_cor', ['raca_cor'])}
          </>
        ))}
      </section>

      {secao('trabalho-escolaridade', t('Escolaridade', 'Education'),
        t('Vínculos ativos em 31/12 pelo grau de instrução declarado na RAIS, nos 11 níveis do arquivo.', 'Jobs active on Dec 31 by the education level declared in RAIS, in the file’s 11 levels.'))}
      <section className="cartao" aria-label={t('Escolaridade', 'Education')}>
        {corpo((p) => {
          const d = distribuicao(p, 'escolaridade', lang);
          const sup = superiorSomado(d);
          return (
            <>
              {cobertura(p)}
              <p className="nota-base"><strong>{pct(sup.pct)} · {numero(sup.vinculos)} {t('vínculos com superior completo, mestrado ou doutorado', 'jobs with a college degree, master’s or doctorate')}</strong></p>
              <DistribuicaoBarras itens={d.itens} legenda={t('Vínculos ativos por escolaridade', 'Active jobs by education level')} />
              <p className="nota-base">{t('O cartão “Ensino superior completo” do perfil acima soma superior completo, mestrado e doutorado; aqui os três níveis aparecem separados. Campo vazio ou código fora do dicionário, se houver, aparece à parte e fica no total.',
                'The “College degree” card in the profile above adds college degree, master’s and doctorate; here the three levels are shown separately. An empty field or a code outside the dictionary, if any, is shown apart and stays in the total.')}</p>
              {exportar('trabalho_escolaridade', ['escolaridade'])}
            </>
          );
        })}
      </section>

      {secao('trabalho-vinculos', t('Tipos de vínculo', 'Job types'),
        t('Vínculos ativos em 31/12 por tipo de vínculo: resumo em celetistas, estatutários e outros, com os tipos detalhados logo abaixo.',
          'Jobs active on Dec 31 by job type: a summary into CLT, statutory and other jobs, with the detailed types just below.'))}
      <section className="cartao" aria-label={t('Tipos de vínculo', 'Job types')}>
        {corpo((p) => {
          const resumo = distribuicao(p, 'vinculo_mte', lang);
          const det = distribuicao(p, 'tipo_vinculo', lang);
          const curto = GRUPO_CURTO();
          return (
            <>
              {cobertura(p)}
              <DistribuicaoBarras itens={resumo.itens} legenda={t('Vínculos ativos por grupo de tipo de vínculo', 'Active jobs by job-type group')} />
              <details className="dist-detalhe">
                <summary>{t('Ver tipos detalhados', 'View detailed types')}</summary>
                <TabelaDistribuicao itens={det.itens} grupo={(i) => { const g = grupoMte(i.codigo); return g ? `${t('Agrupado em', 'Grouped as')}: ${curto[g]}` : null; }} />
              </details>
              <p className="nota-base">{t('O agrupamento segue a ', 'The grouping follows the ')}
                <a href={URL_NOTA_MTE} target="_blank" rel="noreferrer">{t('nota técnica da RAIS 2023 do MTE', 'MTE’s RAIS 2023 technical note')}</a> (pp. {PAGINAS_NOTA_MTE}).{' '}
                {t('É estatístico e não determina o regime jurídico de cada vínculo: contratos por lei estadual ou municipal entram em estatutários, e aprendizes ficam em outros. Campo vazio, se houver, aparece à parte e fica no total.',
                  'It is statistical and does not determine each job’s legal regime: contracts under state or municipal law count as statutory, and apprentices stay in other. An empty field, if any, is shown apart and stays in the total.')}</p>
              {exportar('trabalho_vinculos', ['vinculo_mte', 'tipo_vinculo'])}
            </>
          );
        })}
      </section>

      {pronto && pronto.total > 0 && (
        <div className="perfis-tudo">
          <p className="nota-base">{t('Exportar: cada seção acima tem seus botões CSV e Excel; o arquivo traz todas as categorias, com contagem, total e participação (0 a 100). Os três perfis juntos:',
            'Export: each section above has its CSV and Excel buttons; the file has every category, with count, total and share (0 to 100). All three profiles together:')}</p>
          {exportar('trabalho_perfis', VARIAVEIS_PERFIL)}
        </div>
      )}
    </>
  );
}
