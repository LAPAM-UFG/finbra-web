import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { buscar, useApi } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar, useMetadados } from '../components/Exportar';
import { barras, CartaoGrafico, Grafico } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { BarraFiltros, useFiltros } from '../contexto';
import { numero, reais, reaisCurto, reaisExato } from '../format';
import { t } from '../idioma';

const indicadores = (): Record<string, string> => ({
  receita_bruta: t('Receita bruta', 'Gross revenue'),
  receita_corrente: t('Receita corrente', 'Current revenue'),
  receita_impostos_taxas: t('Impostos, taxas e contribuições de melhoria', 'Taxes, fees and betterment levies'),
  fpm: 'FPM',
  icms: t('Cota-parte do ICMS', 'ICMS share'),
  iptu: 'IPTU',
  iss: 'ISS',
  itbi: 'ITBI',
  despesa_empenhada_sem_intra: t('Despesa empenhada (exceto intra)', 'Committed expenditure (excl. intra)'),
  despesa_saude: t('Despesa com saúde (função 10)', 'Health expenditure (function 10)'),
  despesa_educacao: t('Despesa com educação (função 12)', 'Education expenditure (function 12)'),
  investimentos: t('Investimentos', 'Investments'),
  despesa_pessoal: t('Despesa com pessoal', 'Personnel expenditure'),
  pib: t('PIB', 'GDP'),
});

type Item = {
  cod_ibge: number; nome: string; uf: string; populacao: number | null; valor: number; indicador: number;
  posicao_br: number; posicao_uf: number; total_br: number; total_uf: number;
};
type Ranking = {
  itens: Item[]; elegiveis: number; com_dca: number; sem_valor: number; fora: number; zeros: number; negativos: number;
  ente: Item | null; pagina: number; limite: number;
};

const POR_PAGINA = 50;

export function Rankings() {
  const f = useFiltros();
  const metadados = useMetadados();
  const [busca, setBusca] = useSearchParams();
  const nomes = indicadores();
  const campo = nomes[busca.get('ind') ?? ''] ? busca.get('ind')! : 'receita_bruta';
  const perCapita = busca.get('medida') !== 'total';
  const ordem: 'desc' | 'asc' = busca.get('ordem') === 'asc' ? 'asc' : 'desc';
  const pagina = Math.max(1, Number(busca.get('pag')) || 1);
  const definir = (novo: Record<string, string | null>) => {
    const p = new URLSearchParams(busca);
    for (const [k, v] of Object.entries(novo)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    if (!('pag' in novo)) p.delete('pag');
    setBusca(p, { replace: true });
  };

  const uf = f.uf && f.uf !== 'DF' ? f.uf : undefined;
  const params = {
    campo, ano: f.ano, uf, esfera: 'M', per_capita: perCapita ? 1 : 0, ordem, tratamento: f.tratamento,
    ente: f.ente?.esfera === 'M' ? f.ente.cod_ibge : undefined,
  };
  const disp = useApi<{ exercicio: number; entes: number }[]>('disponibilidade', { campo });
  const anosDisp = (disp.dados ?? []).map((d) => d.exercicio);
  const disponivel = !disp.dados || anosDisp.includes(f.ano);
  const r = useApi<Ranking>(disponivel ? 'ranking' : null, { ...params, limite: POR_PAGINA, pagina });
  const top = useApi<Ranking>(disponivel ? 'ranking' : null, { ...params, limite: 20, pagina: 1 });
  const itens = r.dados?.itens ?? [];
  const destaque = r.dados?.ente;
  const fmt = perCapita ? reaisExato : reais;
  const opcao = useMemo(
    () => barras((top.dados?.itens ?? []).map((i) => `${i.posicao_br}º ${i.nome} (${i.uf})`), (top.dados?.itens ?? []).map((i) => i.indicador), reaisCurto),
    [top.dados],
  );
  const total = r.dados?.elegiveis ?? 0;
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const maiores = t('Maiores', 'Highest');
  const menores = t('Menores', 'Lowest');
  const posicao = (i: Item) => (uf ? i.posicao_uf : i.posicao_br);
  const irPara = (i: Item) => definir({ pag: String(Math.ceil(posicao(i) / POR_PAGINA)) });

  return (
    <>
      <h2 className="titulo-pagina">{t('Rankings de municípios', 'Municipal rankings')}</h2>
      <p className="subtitulo">
        {uf ? t(`Municípios de ${uf}`, `Municipalities in ${uf}`) : t('Municípios com dados no Brasil', 'Municipalities with data in Brazil')} · {f.ano}
      </p>
      <BarraFiltros semEnte={t(
        'Nos rankings, o município selecionado não restringe a lista: a posição dele (nacional e na UF) é destacada. A UF restringe a lista.',
        'In rankings, the selected municipality does not restrict the list: its position (national and within the state) is highlighted. The state restricts the list.',
      )} />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="ind">{t('Indicador', 'Indicator')}</label>
          <select id="ind" value={campo} onChange={(e) => definir({ ind: e.target.value })}>
            {Object.entries(nomes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="alternar" role="group" aria-label={t('Medida', 'Measure')}>
          <button aria-pressed={perCapita} className={perCapita ? 'ativo' : ''} onClick={() => definir({ medida: null })}>Per capita</button>
          <button aria-pressed={!perCapita} className={!perCapita ? 'ativo' : ''} onClick={() => definir({ medida: 'total' })}>Total</button>
        </div>
        <div className="alternar" role="group" aria-label={t('Ordem', 'Order')}>
          <button aria-pressed={ordem === 'desc'} className={ordem === 'desc' ? 'ativo' : ''} onClick={() => definir({ ordem: null })}>{maiores}</button>
          <button aria-pressed={ordem === 'asc'} className={ordem === 'asc' ? 'ativo' : ''} onClick={() => definir({ ordem: 'asc' })}>{menores}</button>
        </div>
      </div>
      {!disponivel && (
        <p className="aviso" role="status">
          {t(`${nomes[campo]} não está disponível para ${f.ano}.`, `${nomes[campo]} is not available for ${f.ano}.`)}{' '}
          {anosDisp.length > 0 && (
            <button className="limpar" onClick={() => f.definir({ ano: anosDisp.at(-1)! })}>
              {t(`Usar ${anosDisp.at(-1)} (último ano disponível)`, `Use ${anosDisp.at(-1)} (latest available year)`)}
            </button>
          )}
        </p>
      )}
      {r.dados && (
        <p className="cobertura" role="note">
          <strong>{t('Elegíveis', 'Eligible')}:</strong> {numero(total)} {t('municípios', 'municipalities')}
          {' '}({numero(r.dados.com_dca)} {t('com DCA no exercício', 'with a DCA in the year')}; {numero(r.dados.sem_valor)} {t('sem o valor', 'without the value')};{' '}
          {numero(r.dados.fora)} {t('fora por inconsistência, ausência do total do domínio ou sem população', 'left out for inconsistency, missing domain total or no population')})
          {' '}· {numero(r.dados.zeros)} {t('zeros declarados incluídos', 'reported zeros included')} · {numero(r.dados.negativos)} {t('negativos incluídos', 'negatives included')}.
          {' '}<Dica rotulo={t('Critérios do ranking', 'Ranking criteria')}>
            {t(
              'Entram os municípios com o valor declarado no exercício, inclusive zero e negativo, e com a DCA trazendo o total do domínio (receita ou despesa). Per capita exige população positiva (declarada na DCA). Saem as inconsistências objetivas (mais de 10× a mediana real do próprio ente e acima do PIB municipal) e erros confirmados; suspeitas estatísticas continuam no ranking. Empates recebem a mesma posição e a seguinte salta (1, 2, 2, 4). A posição nacional considera todos os municípios; a da UF, só os do estado.',
              'Municipalities enter with the value reported for the year, including zero and negative values, and with a DCA that has the domain total (revenue or expenditure). Per capita requires a positive population (reported in the DCA). Objective inconsistencies (more than 10× the government’s own real median and above municipal GDP) and confirmed errors are left out; statistical flags remain in the ranking. Ties share the same position and the next one skips (1, 2, 2, 4). The national position considers all municipalities; the state position, only those in the state.',
            )}
          </Dica>
        </p>
      )}
      {f.ente && f.ente.esfera !== 'M' && (
        <p className="nota-base">{t('Rankings são só de municípios; o ente selecionado não é município.', 'Rankings only cover municipalities; the selected government is not a municipality.')}</p>
      )}
      {f.ente?.esfera === 'M' && r.dados && (
        <p className="nota-base destaque-ente" role="status">
          {destaque
            ? <>
              <strong>{f.ente.nome} ({f.ente.uf})</strong>: {t('posição', 'position')} {numero(destaque.posicao_br)}º {t('de', 'of')} {numero(destaque.total_br)} {t('no Brasil', 'in Brazil')};{' '}
              {numero(destaque.posicao_uf)}º {t('de', 'of')} {numero(destaque.total_uf)} {t('em', 'in')} {destaque.uf} · {fmt(destaque.indicador)}{' '}
              {(!uf || destaque.uf === uf) && <button className="limpar" onClick={() => irPara(destaque)}>{t('ir para a posição na tabela', 'go to its row in the table')}</button>}
            </>
            : t(`${f.ente.nome} não é elegível neste ranking (sem o valor, sem população ou sinalizado).`, `${f.ente.nome} is not eligible for this ranking (no value, no population or flagged).`)}
        </p>
      )}
      <Estado carregando={r.carregando} erro={r.erro} tentarNovamente={r.recarregar} vazio={!r.carregando && disponivel && r.dados && !itens.length} />
      {(top.dados?.itens.length ?? 0) > 0 && (
        <CartaoGrafico titulo={`${ordem === 'desc' ? maiores : menores} 20 · ${nomes[campo]}${perCapita ? ' per capita' : ''} · ${f.ano}`}>
          <Grafico opcao={opcao} altura={(top.dados?.itens.length ?? 0) * 28 + 20} nome={`ranking_${campo}_${f.ano}`} />
          <p className="desc" style={{ marginTop: 8 }}>
            {perCapita ? t('Valores em R$ correntes por habitante.', 'Values in current R$ per inhabitant.') : t('Valores em R$ correntes.', 'Values in current R$.')}
          </p>
        </CartaoGrafico>
      )}
      {itens.length > 0 && (
        <section className="cartao">
          <div className="cabeca-cartao">
            <h3>{t('Tabela completa', 'Full table')}</h3>
            <BotoesExportar nome={`ranking_${campo}_${f.ano}`} obter={async () => {
              const tudo = await buscar<Ranking>('ranking', { ...params, todos: 1 });
              return {
                colunas: [t('Posição nacional', 'National position'), t('Posição na UF', 'State position'), t('Código IBGE', 'IBGE code'),
                  t('Município', 'Municipality'), 'UF', t('População', 'Population'), t('Valor (R$ correntes)', 'Value (current R$)'),
                  perCapita ? t('Per capita (R$)', 'Per capita (R$)') : t('Indicador (R$)', 'Indicator (R$)')],
                linhas: tudo.itens.map((i) => [i.posicao_br, i.posicao_uf, i.cod_ibge, i.nome, i.uf, i.populacao, i.valor, i.indicador]),
                metadados: metadados([
                  [t('Indicador', 'Indicator'), nomes[campo]], [t('Medida', 'Measure'), perCapita ? 'per capita' : 'total'],
                  [t('Ordem', 'Order'), ordem === 'desc' ? maiores : menores],
                  [t('Conteúdo', 'Content'), t('consulta completa filtrada (todas as páginas)', 'full filtered query (all pages)')],
                  [t('Elegíveis', 'Eligible'), String(tudo.elegiveis)],
                ]),
              };
            }} />
          </div>
          <div className="rolagem">
            <table>
              <thead>
                <tr>
                  <th>{uf ? t('Posição na UF', 'State position') : t('Posição', 'Position')}</th>
                  {uf && <th>{t('Posição nacional', 'National position')}</th>}
                  <th>{t('Município', 'Municipality')}</th><th>{t('UF', 'State')}</th><th>{t('População', 'Population')}</th>
                  <th>{t('Valor', 'Value')}</th><th>Per capita</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.cod_ibge} className={i.cod_ibge === f.ente?.cod_ibge ? 'destaque' : undefined}>
                    <td>{numero(posicao(i))}º</td>{uf && <td>{numero(i.posicao_br)}º</td>}
                    <td>{i.nome}</td><td>{i.uf}</td><td>{numero(i.populacao)}</td><td>{reais(i.valor)}</td>
                    <td>{i.populacao ? reaisExato(i.valor / i.populacao) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav className="paginacao" aria-label={t('Páginas do ranking', 'Ranking pages')}>
            <button disabled={pagina <= 1} onClick={() => definir({ pag: String(pagina - 1) })}>← {t('Anterior', 'Previous')}</button>
            <span>{t('Página', 'Page')} {pagina} {t('de', 'of')} {paginas}</span>
            <button disabled={pagina >= paginas} onClick={() => definir({ pag: String(pagina + 1) })}>{t('Próxima', 'Next')} →</button>
          </nav>
        </section>
      )}
    </>
  );
}
