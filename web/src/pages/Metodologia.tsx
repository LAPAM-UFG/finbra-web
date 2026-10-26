import { Fragment, useState } from 'react';
import { useApi } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar, useMetadados } from '../components/Exportar';
import { Estado } from '../components/Kpi';
import { rotuloCategoria, rotuloIndicador, useDados, type Alerta } from '../contexto';
import { numero, pct, reais } from '../format';
import { dado, idioma, local, t } from '../idioma';

type Ipca = { ano: number; ipca_pct: number; completo: boolean; meses: number; fator: number };
type Validacao = {
  teste: string; exercicio: number; anexo: string; casos: number; ok: number; reprovados: number; pct_ok: number;
  maior_divergencia: number; tipo: 'estrutural' | 'informativo'; tolerancia: number;
};
type Divergencia = { teste: string; exercicio: number; anexo: string; cod_ibge: number; nome: string; uf: string; coluna: string;
  calculado: number; declarado: number | null; diferenca: number };

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const MESES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const mes = (m: number) => (idioma() === 'en' ? MESES_EN : MESES)[m - 1] ?? '';
const data = (iso?: unknown) => (typeof iso === 'string' ? new Date(iso).toLocaleDateString(local()) : '–');

export function Deflatores() {
  const { meta } = useDados();
  const r = useApi<Ipca[]>('ipca');
  return (
    <>
      <h2 className="titulo-pagina">{t('Deflatores', 'Deflators')}</h2>
      <p className="subtitulo">
        {t(
          `Valores reais em R$ de dezembro de ${meta.baseIpca} (último ano completo do IPCA).`,
          `Real values in December ${meta.baseIpca} R$ (latest complete IPCA year).`,
        )}
      </p>
      <section className="cartao">
        <h3>{t('Método', 'Method')}</h3>
        <ul>
          <li>{t('Fonte: IPCA mensal do IBGE, pela série SGS 433 do Banco Central.', 'Source: IBGE monthly IPCA, through Central Bank of Brazil SGS series 433.')}</li>
          <li>{t(
            'Índice acumulado: produto de (1 + IPCA mensal) desde janeiro de 2010. O índice do ano é o acumulado até dezembro (ou até o último mês divulgado, em ano parcial).',
            'Cumulative index: product of (1 + monthly IPCA) since January 2010. The year’s index is the cumulative value through December (or through the latest published month, in a partial year).',
          )}</li>
          <li>{t(
            `Fator do exercício = índice de dez/${meta.baseIpca} ÷ índice do exercício. Valor real = valor nominal × fator.`,
            `Year factor = Dec/${meta.baseIpca} index ÷ index of the year. Real value = nominal value × factor.`,
          )}</li>
          <li>{t(
            'Convenção: o valor anual do exercício é tratado como se estivesse a preços de dezembro do próprio ano (IPCA dez/dez). Como receitas e despesas se distribuem ao longo do ano, essa convenção subestima levemente a correção de quem arrecada ou gasta mais no início do ano; o painel não usa a média anual do índice.',
            'Convention: the annual value of the year is treated as being in December prices of the same year (Dec/Dec IPCA). Since revenue and spending are spread over the year, this slightly understates the adjustment for those who collect or spend more early in the year; the dashboard does not use the annual average index.',
          )}</li>
          {meta.ipcaUltimo && meta.ipcaUltimo.meses < 12 && (
            <li>{t(
              `${meta.ipcaUltimo.exercicio} é parcial: o IPCA vai até ${mes(meta.ipcaUltimo.meses)}/${meta.ipcaUltimo.exercicio}, e o ano não é usado como base.`,
              `${meta.ipcaUltimo.exercicio} is partial: the IPCA runs through ${mes(meta.ipcaUltimo.meses)}/${meta.ipcaUltimo.exercicio}, and the year is not used as the base.`,
            )}</li>
          )}
        </ul>
      </section>
      <section className="cartao">
        <Estado carregando={r.carregando} erro={r.erro} tentarNovamente={r.recarregar} />
        <div className="cabeca-cartao">
          <h3>{t('Fatores', 'Factors')}</h3>
          <BotoesExportar nome="deflatores" obter={() => ({
            colunas: [t('Exercício', 'Fiscal year'), t('IPCA no ano (%)', 'IPCA for the year (%)'), t('Meses', 'Months'), t('Fator', 'Factor')],
            linhas: (r.dados ?? []).map((l) => [l.ano, l.ipca_pct, l.meses, l.fator]),
            metadados: [[t('Base', 'Base'), t(`R$ de dezembro de ${meta.baseIpca}`, `December ${meta.baseIpca} R$`)], [t('Fonte', 'Source'), 'IBGE/BCB SGS 433']],
          })} />
        </div>
        <div className="rolagem">
          <table>
            <thead><tr><th>{t('Exercício', 'Fiscal year')}</th><th>{t('IPCA no ano', 'IPCA for the year')}</th><th>{t(`Fator para R$ de dez/${meta.baseIpca}`, `Factor to Dec/${meta.baseIpca} R$`)}</th></tr></thead>
            <tbody>
              {(r.dados ?? []).map((l) => (
                <tr key={l.ano}>
                  <td>{l.ano}{!l.completo && ` ${t(`(parcial, até ${mes(l.meses)})`, `(partial, through ${mes(l.meses)})`)}`}</td>
                  <td>{pct(l.ipca_pct / 100, 2)}</td>
                  <td>{l.fator.toLocaleString(local(), { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Casos({ teste, ano, anexo }: { teste: string; ano: number; anexo: string }) {
  const r = useApi<Divergencia[]>('divergencias', { teste, ano, anexo });
  const metadados = useMetadados();
  return (
    <div className="casos">
      <Estado carregando={r.carregando} erro={r.erro} tentarNovamente={r.recarregar} vazio={!r.carregando && !r.dados?.length} />
      {!!r.dados?.length && (
        <>
          <BotoesExportar nome={`casos_${teste}_${ano}_${anexo}`} obter={() => ({
            colunas: [t('Código IBGE', 'IBGE code'), t('Ente', 'Government'), 'UF', t('Coluna', 'Column'), t('Calculado', 'Computed'), t('Declarado', 'Reported'), t('Diferença', 'Difference')],
            linhas: r.dados!.map((d) => [d.cod_ibge, d.nome, d.uf, d.coluna, d.calculado, d.declarado, d.diferenca]),
            metadados: metadados([[t('Teste', 'Test'), dado(teste)], [t('Exercício', 'Fiscal year'), String(ano)], [t('Anexo', 'Annex'), anexo]]),
          })} />
          <table>
            <thead><tr><th>{t('Ente', 'Government')}</th><th>UF</th><th>{t('Coluna', 'Column')}</th><th>{t('Soma/valor calculado', 'Computed')}</th><th>{t('Total declarado', 'Reported total')}</th><th>{t('Diferença', 'Difference')}</th></tr></thead>
            <tbody>
              {r.dados.map((d) => (
                <tr key={`${d.cod_ibge}-${d.coluna}`}>
                  <td>{d.nome ?? d.cod_ibge}</td><td>{d.uf}</td><td>{dado(d.coluna)}</td>
                  <td>{reais(d.calculado)}</td><td>{d.declarado === null ? '–' : reais(d.declarado)}</td><td>{reais(d.diferenca)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export function Qualidade() {
  const { meta } = useDados();
  const r = useApi<Validacao[]>('validacao');
  const alertas = useApi<Alerta[]>('alertas');
  const [aberto, setAberto] = useState<string | null>(null);
  const [categoria, setCategoria] = useState<string>('');
  const metadados = useMetadados();
  const politica = meta.politica as { limite_suspeita?: number; min_observacoes?: number; limite_inconsistencia?: number };
  const fontes = meta.fontes as Record<string, { anos?: number[] | null; processado_em?: string; url?: string; setorial_ate?: number; ultimo?: number; meses?: number; registros?: number }>;
  const listaAlertas = (alertas.dados ?? []).filter((a) => !categoria || a.categoria === categoria);
  const regra = (a: Alerta) => ({
    ausente: t('total do indicador nulo ou ≤ 0 na DCA', 'indicator total null or ≤ 0 in the DCA'),
    suspeita: t(`valor real fora de 1/${politica.limite_suspeita ?? 5} a ${politica.limite_suspeita ?? 5}× a mediana real do ente`, `real value outside 1/${politica.limite_suspeita ?? 5} to ${politica.limite_suspeita ?? 5}× the government’s real median`),
    inconsistente: t(`valor real > ${politica.limite_inconsistencia ?? 10}× a mediana real e acima do PIB municipal do ano`, `real value > ${politica.limite_inconsistencia ?? 10}× the real median and above the municipal GDP for the year`),
    validado: t('revisão manual: valor atípico conferido como legítimo', 'manual review: outlier checked as legitimate'),
    confirmado: t('revisão manual: erro confirmado', 'manual review: confirmed error'),
  })[a.categoria];
  const nomesIndicador: Record<string, string> = {
    fpm: 'FPM', icms: t('Cota-parte do ICMS', 'ICMS share'), ipva: t('Cota-parte do IPVA', 'IPVA share'), iptu: 'IPTU', iss: 'ISS', itbi: 'ITBI',
  };

  return (
    <>
      <h2 className="titulo-pagina">{t('Qualidade dos dados e fontes', 'Data quality and sources')}</h2>
      <p className="subtitulo">{t('Testes que o pipeline roda a cada atualização.', 'Tests the pipeline runs on every update.')} {t('Dados processados em', 'Data processed on')} {data(meta.geradoEm)}.</p>
      <section className="cartao">
        <h3>{t('Fontes', 'Sources')}</h3>
        <ul>
          <li><strong>{t('SICONFI / Tesouro Nacional', 'SICONFI / National Treasury')}</strong> —{' '}
            {t('Declaração de Contas Anuais (DCA), anexos I-AB a I-HI, pela API pública', 'Annual Accounts Statement (DCA), annexes I-AB to I-HI, through the public API')}{' '}
            (<a href={fontes.siconfi?.url ?? 'https://apidatalake.tesouro.gov.br/docs/siconfi/'} target="_blank" rel="noreferrer">apidatalake.tesouro.gov.br</a>).{' '}
            {t('Exercícios', 'Years')} {fontes.siconfi?.anos?.join('–')} · {t('processado em', 'processed on')} {data(fontes.siconfi?.processado_em)}.{' '}
            {t('Os dois últimos exercícios fechados são extraídos de novo todo mês, porque os entes retificam declarações.', 'The two latest closed years are re-extracted every month, because governments amend their filings.')}</li>
          <li><strong>IBGE</strong> — {t('PIB dos Municípios', 'Municipal GDP')} (<a href={fontes.ibge_pib?.url ?? 'https://sidra.ibge.gov.br/tabela/5938'} target="_blank" rel="noreferrer">{t('tabela SIDRA 5938', 'SIDRA table 5938')}</a>),{' '}
            {fontes.ibge_pib?.anos?.join('–')}; {t('setores até', 'sectors through')} {fontes.ibge_pib?.setorial_ate} · {t('processado em', 'processed on')} {data(fontes.ibge_pib?.processado_em)}.</li>
          <li><strong>{t('Banco Central', 'Central Bank of Brazil')}</strong> — {t('IPCA mensal', 'Monthly IPCA')} (<a href={fontes.ipca?.url ?? 'https://www3.bcb.gov.br/sgspub/'} target="_blank" rel="noreferrer">SGS 433</a>),{' '}
            {t('até', 'through')} {fontes.ipca?.meses ? `${mes(fontes.ipca.meses)}/${fontes.ipca.ultimo}` : '–'} · {t('processado em', 'processed on')} {data(fontes.ipca?.processado_em)}.</li>
          <li><strong>{t('Portal da Transparência (CGU)', 'Transparency Portal (CGU)')}</strong> —{' '}
            {t('pagamentos do Bolsa Família, Auxílio Brasil e Novo Bolsa Família, arquivos mensais em lote', 'Bolsa Família, Auxílio Brasil and New Bolsa Família payments, monthly bulk files')}{' '}
            (<a href={fontes.bolsa_familia?.url ?? 'https://portaldatransparencia.gov.br/download-de-dados'} target="_blank" rel="noreferrer">portaldatransparencia.gov.br</a>),{' '}
            {fontes.bolsa_familia?.anos ? fontes.bolsa_familia.anos.join('–') : '–'}
            {fontes.bolsa_familia && 'ultimo_mes' in fontes.bolsa_familia && (fontes.bolsa_familia as { ultimo_mes?: number }).ultimo_mes
              ? `; ${t('último mês', 'latest month')} ${String((fontes.bolsa_familia as { ultimo_mes: number }).ultimo_mes).replace(/(\d{4})(\d{2})/, '$2/$1')}` : ''}
            {' '}· {t('processado em', 'processed on')} {data(fontes.bolsa_familia?.processado_em)}.{' '}
            {t('O município vem pelo código SIAFI, convertido ao código IBGE (pipeline/siafi_ibge.csv).', 'The municipality comes as a SIAFI code, converted to the IBGE code (pipeline/siafi_ibge.csv).')}</li>
          <li><strong>{t('Ministério da Previdência Social', 'Ministry of Social Security')}</strong> —{' '}
            {t('benefícios emitidos pelo INSS por município, dezembro de cada ano', 'benefits issued by INSS by municipality, December of each year')}{' '}
            (<a href={fontes.inss?.url ?? 'https://www.gov.br/previdencia/'} target="_blank" rel="noreferrer">gov.br/previdencia</a>),{' '}
            {(fontes.inss as { exercicios?: number[] } | undefined)?.exercicios?.join(', ') || '–'}{' '}
            ({t('não há planilha publicada para os demais anos', 'no spreadsheet is published for the other years')}) · {t('processado em', 'processed on')} {data(fontes.inss?.processado_em)}.</li>
          <li>{t('População: a declarada pelo ente na DCA do exercício (SICONFI).', 'Population: the one reported by the government in the year’s DCA (SICONFI).')}</li>
        </ul>
        <h3 style={{ marginTop: 14 }}>{t('Como os valores são montados', 'How the values are built')}</h3>
        <ul>
          <li>{t(
            'Cada linha mostra o valor que o ente declarou naquela conta. Nada é obtido somando as contas do último nível, o que preserva contas redutoras e evita perder valores quando o ente detalha só parte de uma conta.',
            'Each line shows the value the government reported for that account. Nothing is obtained by adding up the lowest-level accounts, which preserves contra accounts and avoids losing values when a government details only part of an account.',
          )}</li>
          <li>{t(
            'A hierarquia segue os segmentos do código (o 5º segmento tem dois dígitos). Se um ente informa uma subconta mas não a conta-mãe, a mãe é criada com a soma das subcontas e marcada como “(soma)”.',
            'The hierarchy follows the code segments (the 5th segment has two digits). If a government reports a sub-account but not its parent account, the parent is created as the sum of the sub-accounts and marked “(sum)”.',
          )}</li>
          <li>{t(
            'Contas redutoras (marcadas “(-)” no balanço) vêm com valor positivo e já estão subtraídas no grupo pelo próprio ente; o painel não troca o sinal. Deduções da receita declaradas com sinal negativo são usadas pelo valor absoluto na receita líquida (ver teste “sinal das deduções”).',
            'Contra accounts (marked “(-)” in the balance sheet) come with a positive value and are already subtracted in the group by the government; the dashboard does not flip the sign. Revenue deductions reported with a negative sign are used as absolute values in net revenue (see the “sign of deductions” test).',
          )}</li>
          {idioma() === 'en' && (
            <li>Account names come from the National Treasury in Portuguese; the English names were translated by LAPAM for reference.</li>
          )}
        </ul>
        <h3 style={{ marginTop: 14 }}>{t('Correspondência dos indicadores ao longo do tempo', 'Indicator mapping over time')}</h3>
        <p className="desc">{t(
          'Os códigos de receita mudaram em 2018 e em 2022. FPM, ICMS, IPVA, IPTU, ISS e ITBI são localizados pela descrição da conta, e só a conta mais alta que casa entra no indicador (sem somar conta-mãe e subcontas).',
          'Revenue codes changed in 2018 and 2022. FPM, ICMS, IPVA, IPTU, ISS and ITBI are located by account description, and only the highest matching account enters the indicator (parent and sub-accounts are not added together).',
        )}</p>
        <div className="rolagem">
          <table>
            <thead><tr><th>{t('Indicador', 'Indicator')}</th><th>{t('Período', 'Period')}</th><th>{t('Conta', 'Account')}</th><th>{t('Descrição', 'Description')}</th></tr></thead>
            <tbody>
              {Object.entries(meta.mapaIndicadores).filter(([k]) => k in nomesIndicador).flatMap(([k, lista]) => lista.map((m) => (
                <tr key={`${k}-${m.chave}-${m.de}`}>
                  <td>{nomesIndicador[k]}</td><td>{m.de}–{m.ate}</td><td className="codigo">{m.chave?.replace(/^RO/, '')}</td><td>{dado(m.descricao ?? '')}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cartao">
        <h3>{t('Testes automáticos', 'Automated tests')}</h3>
        <p className="desc">
          {t(
            '“Árvore × total”: as contas de primeiro nível somam o total que o próprio ente declarou. “Ativo = passivo + PL”: fechamento do balanço. Tolerância de R$ 1,00 por caso. Testes estruturais falham o pipeline quando mais de 1% dos casos de um grupo diverge (indício de erro de processamento); abaixo disso, a divergência é tratada como da declaração de origem e fica registrada para consulta. Testes informativos não falham o pipeline.',
            '“Tree × total”: first-level accounts add up to the total the government itself reported. “Assets = liabilities + equity”: the balance sheet closes. Tolerance of R$ 1.00 per case. Structural tests fail the pipeline when more than 1% of a group’s cases diverge (a sign of a processing error); below that, the divergence is treated as coming from the original filing and is recorded for consultation. Informational tests do not fail the pipeline.',
          )}
        </p>
        <Estado carregando={r.carregando} erro={r.erro} tentarNovamente={r.recarregar} vazio={!r.carregando && !r.dados?.length} />
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('Teste', 'Test')}</th><th>{t('Tipo', 'Type')}</th><th>{t('Exercício', 'Fiscal year')}</th><th>{t('Anexo', 'Annex')}</th>
                <th>{t('Avaliados', 'Evaluated')}</th><th>{t('Aprovados', 'Passed')}</th><th>{t('Reprovados', 'Failed')}</th>
                <th>{t('Maior divergência', 'Largest divergence')}</th><th>{t('Casos', 'Cases')}</th>
              </tr>
            </thead>
            <tbody>
              {(r.dados ?? []).map((l) => {
                const chave = `${l.teste}|${l.exercicio}|${l.anexo}`;
                const reprovados = l.reprovados ?? l.casos - l.ok;
                return (
                  <Fragment key={chave}>
                    <tr>
                      <td>{dado(l.teste)}</td>
                      <td>{l.tipo === 'estrutural' ? t('estrutural', 'structural') : t('informativo', 'informational')}</td>
                      <td>{l.exercicio}</td><td>{l.anexo}</td><td>{numero(l.casos)}</td>
                      <td className={reprovados === 0 ? 'ok' : undefined}>{reprovados === 0 ? '✓ ' : ''}{numero(l.ok)}</td>
                      <td className={reprovados > 0 ? (l.tipo === 'estrutural' ? 'falha' : 'atencao') : undefined}>
                        {numero(reprovados)}{reprovados > 0 ? ` (${pct(reprovados / l.casos, 2)})` : ''}
                      </td>
                      <td>{reprovados > 0 ? reais(l.maior_divergencia) : '–'}</td>
                      <td>{reprovados > 0 && (
                        <button className="limpar" aria-expanded={aberto === chave} onClick={() => setAberto(aberto === chave ? null : chave)}>
                          {aberto === chave ? t('ocultar', 'hide') : t('ver casos', 'see cases')}
                        </button>
                      )}</td>
                    </tr>
                    {aberto === chave && (
                      <tr><td colSpan={9}><Casos teste={l.teste} ano={l.exercicio} anexo={l.anexo} /></td></tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t('Sinalizações de valores atípicos', 'Outlier flags')}</h3>
            <p className="desc">
              {t(
                `Política: o valor real (IPCA) de receita bruta e despesa empenhada de cada ente-ano é comparado com a mediana real do próprio ente (mínimo de ${politica.min_observacoes ?? 5} anos com valor). Fora de 1/${politica.limite_suspeita ?? 5} a ${politica.limite_suspeita ?? 5}× a mediana: suspeita estatística, que pode ser erro ou crescimento legítimo (royalties, receitas extraordinárias, mudanças estruturais) e por isso continua nos totais, só sinalizada. Acima de ${politica.limite_inconsistencia ?? 10}× a mediana e do PIB do município no ano: inconsistência por regra objetiva, que sai dos totais de UF, Brasil, faixas e rankings, só no domínio afetado (receita ou despesa). Casos revisados manualmente (pipeline/alertas_revisados.csv) ficam como validados (permanecem nos totais) ou confirmados (saem), com evidência. Ao escolher o ente, os valores aparecem sempre como declarados.`,
                `Policy: the real (IPCA) value of gross revenue and committed expenditure of each government-year is compared with the government’s own real median (at least ${politica.min_observacoes ?? 5} years with a value). Outside 1/${politica.limite_suspeita ?? 5} to ${politica.limite_suspeita ?? 5}× the median: statistical flag, which may be an error or legitimate growth (royalties, extraordinary revenue, structural changes) and therefore remains in totals, only flagged. Above ${politica.limite_inconsistencia ?? 10}× the median and above the municipality’s GDP in the year: inconsistency by objective rule, excluded from state, national, bracket and ranking totals, only in the affected domain (revenue or expenditure). Manually reviewed cases (pipeline/alertas_revisados.csv) become validated (stay in totals) or confirmed (excluded), with evidence. When a government is selected, values are always shown as reported.`,
              )}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="cat">{t('Categoria', 'Category')}</label>
            <select id="cat" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">{t('Todas', 'All')}</option>
              {(['suspeita', 'inconsistente', 'confirmado', 'validado', 'ausente'] as const).map((c) => <option key={c} value={c}>{rotuloCategoria(c)}</option>)}
            </select>
          </div>
          <BotoesExportar nome="sinalizacoes" obter={() => ({
            colunas: [t('Exercício', 'Fiscal year'), t('Código IBGE', 'IBGE code'), t('Ente', 'Government'), 'UF', t('Indicador', 'Indicator'),
              t('Categoria', 'Category'), t('Declarado (R$ correntes)', 'Reported (current R$)'), t('Declarado real', 'Reported, real'),
              t('Mediana real do ente', 'Government real median'), t('Razão', 'Ratio'), t('Anos na mediana', 'Years in median'),
              t('Regra', 'Rule'), t('Evidência', 'Evidence'), t('Sai dos totais', 'Left out of totals')],
            linhas: listaAlertas.map((a) => [a.exercicio, a.cod_ibge, a.nome, a.uf, rotuloIndicador(a.indicador), rotuloCategoria(a.categoria),
              a.valor, a.valor_real, a.mediana_real, a.razao, a.n_obs, a.regra, a.evidencia ?? '', a.exclui ? t('sim', 'yes') : t('não', 'no')]),
            metadados: metadados([[t('Preços dos valores reais', 'Prices of real values'), t(`R$ de dez/${meta.baseIpca}`, `Dec/${meta.baseIpca} R$`)]]),
          })} />
        </div>
        <Estado carregando={alertas.carregando} erro={alertas.erro} tentarNovamente={alertas.recarregar} />
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('Ente', 'Government')}</th><th>{t('UF', 'State')}</th><th>{t('Exercício', 'Fiscal year')}</th><th>{t('Indicador', 'Indicator')}</th>
                <th>{t('Categoria', 'Category')}</th><th>{t('Declarado', 'Reported')}</th>
                <th>{t('Mediana real do ente', 'Government real median')} <Dica rotulo={t('Mediana', 'Median')}>{t(`Mediana dos valores reais (R$ de dez/${meta.baseIpca}) do próprio ente nos anos com valor positivo.`, `Median of the government’s own real values (Dec/${meta.baseIpca} R$) in years with a positive value.`)}</Dica></th>
                <th>{t('Razão real', 'Real ratio')}</th><th>{t('Regra', 'Rule')}</th>
              </tr>
            </thead>
            <tbody>
              {listaAlertas.map((a) => (
                <tr key={`${a.exercicio}-${a.cod_ibge}-${a.indicador}`}>
                  <td>{a.nome}</td><td>{a.uf}</td><td>{a.exercicio}</td>
                  <td>{rotuloIndicador(a.indicador)}</td>
                  <td>{rotuloCategoria(a.categoria)}{a.exclui ? ` (${t('fora dos totais', 'out of totals')})` : ''}</td>
                  <td>{a.categoria === 'ausente' ? t('não declarado', 'not reported') : reais(a.valor)}</td>
                  <td>{reais(a.mediana_real)}</td>
                  <td>{a.razao === null ? '–' : `${a.razao.toLocaleString(local(), { maximumFractionDigits: 1 })}×`}</td>
                  <td className="regra">{regra(a)}{a.evidencia ? ` — ${a.evidencia}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
