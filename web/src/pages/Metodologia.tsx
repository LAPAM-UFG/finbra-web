import { useApi } from '../api';
import { Estado } from '../components/Kpi';
import { rotuloIndicador, useDados, type Alerta } from '../contexto';
import { numero, pct, reais } from '../format';
import { dado, idioma, local, t } from '../idioma';

type Ipca = { ano: number; ipca_pct: number; completo: boolean; fator: number };
type Validacao = { teste: string; exercicio: number; anexo: string; casos: number; ok: number; pct_ok: number };

export function Deflatores() {
  const { meta } = useDados();
  const r = useApi<Ipca[]>('ipca');
  return (
    <>
      <h2 className="titulo-pagina">{t('Deflatores', 'Deflators')}</h2>
      <p className="subtitulo">
        {t(
          `Valores reais em R$ de ${meta.baseIpca}: valor nominal × fator. IPCA de dezembro a dezembro (Banco Central, série SGS 433).`,
          `Real values in ${meta.baseIpca} R$: nominal value × factor. December-to-December IPCA (Central Bank of Brazil, SGS series 433).`,
        )}
      </p>
      <section className="cartao">
        <Estado carregando={r.carregando} erro={r.erro} />
        <table>
          <thead>
            <tr>
              <th>{t('Exercício', 'Fiscal year')}</th><th>{t('IPCA no ano', 'IPCA for the year')}</th>
              <th>{t(`Fator para R$ de ${meta.baseIpca}`, `Factor to ${meta.baseIpca} R$`)}</th>
            </tr>
          </thead>
          <tbody>
            {(r.dados ?? []).map((l) => (
              <tr key={l.ano}>
                <td>{l.ano}{!l.completo && ` ${t('(parcial)', '(partial)')}`}</td>
                <td>{pct(l.ipca_pct / 100, 2)}</td>
                <td>{l.fator.toLocaleString(local(), { minimumFractionDigits: 4, maximumFractionDigits: 4 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

export function Qualidade() {
  const r = useApi<Validacao[]>('validacao');
  const alertas = useApi<Alerta[]>('alertas');
  return (
    <>
      <h2 className="titulo-pagina">{t('Qualidade dos dados e fontes', 'Data quality and sources')}</h2>
      <p className="subtitulo">{t('Testes que o pipeline roda a cada atualização.', 'Tests the pipeline runs on every update.')}</p>
      <section className="cartao">
        <h3>{t('Fontes', 'Sources')}</h3>
        <ul>
          <li><strong>{t('SICONFI / Tesouro Nacional', 'SICONFI / National Treasury')}</strong> —{' '}
            {t(
              'Declaração de Contas Anuais (DCA), anexos I-AB a I-HI, pela API pública',
              'Annual Accounts Statement (DCA), annexes I-AB to I-HI, through the public API',
            )}
            <code> apidatalake.tesouro.gov.br/ords/siconfi/tt/dca</code>.</li>
          <li><strong>IBGE</strong> — {t('PIB dos Municípios (tabela SIDRA 5938).', 'Municipal GDP (SIDRA table 5938).')}</li>
          <li><strong>{t('Banco Central', 'Central Bank of Brazil')}</strong> — {t('IPCA mensal (SGS 433).', 'Monthly IPCA (SGS 433).')}</li>
          <li><strong>{t('Painel da pesquisa LAPAM', 'LAPAM research panel')}</strong> —{' '}
            {t(
              'área, distância, Bolsa Família, benefícios do INSS (2013–2021, fixo).',
              'area, distance, Bolsa Família, INSS benefits (2013–2021, fixed).',
            )}
          </li>
        </ul>
        <h3 style={{ marginTop: 14 }}>{t('Como os valores são montados', 'How the values are built')}</h3>
        <ul>
          <li>
            {t(
              'Cada linha mostra o valor que o ente declarou naquela conta. Nada é obtido somando as contas do último nível, o que preserva contas redutoras e evita perder valores quando o ente detalha só parte de uma conta.',
              'Each line shows the value the government reported for that account. Nothing is obtained by adding up the lowest-level accounts, which preserves contra accounts and avoids losing values when a government details only part of an account.',
            )}
          </li>
          <li>
            {t(
              'A hierarquia segue os segmentos do código (o 5º segmento tem dois dígitos). Se um ente informa uma subconta mas não a conta-mãe, a mãe é criada com a soma das subcontas e marcada como “(soma)”.',
              'The hierarchy follows the code segments (the 5th segment has two digits). If a government reports a sub-account but not its parent account, the parent is created as the sum of the sub-accounts and marked “(sum)”.',
            )}
          </li>
          <li>
            {t(
              'FPM, ICMS, IPVA, IPTU, ISS e ITBI mudaram de código em 2018 e 2022; são identificados pela descrição da conta.',
              'FPM, ICMS, IPVA, IPTU, ISS and ITBI changed codes in 2018 and 2022; they are identified by the account description.',
            )}
          </li>
          {idioma() === 'en' && (
            <li>Account names come from the National Treasury in Portuguese; the English names were translated by LAPAM for reference.</li>
          )}
        </ul>
      </section>
      <section className="cartao">
        <h3>{t('Testes automáticos', 'Automated tests')}</h3>
        <p className="desc">
          {t(
            '“Árvore × total”: as contas de primeiro nível somam o total que o próprio ente declarou. “Ativo = passivo + PL”: fechamento do balanço. As comparações com o painel de pesquisa são informativas: o painel soma receita bruta e deduções.',
            '“Tree × total”: first-level accounts add up to the total the government itself reported. “Assets = liabilities + equity”: the balance sheet closes. Comparisons with the research panel are informational: the panel adds gross revenue and deductions.',
          )}
        </p>
        <Estado carregando={r.carregando} erro={r.erro} vazio={!r.carregando && !r.dados?.length} />
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('Teste', 'Test')}</th><th>{t('Exercício', 'Fiscal year')}</th><th>{t('Anexo', 'Annex')}</th>
                <th>{t('Casos', 'Cases')}</th><th>{t('Conferem', 'Pass')}</th>
              </tr>
            </thead>
            <tbody>
              {(r.dados ?? []).map((l) => (
                <tr key={`${l.teste}-${l.exercicio}-${l.anexo}`}>
                  <td>{dado(l.teste)}</td><td>{l.exercicio}</td><td>{l.anexo}</td><td>{numero(l.casos)}</td>
                  <td className={l.ok === l.casos ? 'ok' : 'falha'}>{l.ok === l.casos ? '✓ ' : '✗ '}{pct(l.pct_ok / 100, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="cartao">
        <h3>{t('Declarações atípicas', 'Atypical filings')}</h3>
        <p className="desc">
          {t(
            'Ente-anos cuja receita bruta ou despesa empenhada não foi declarada ou está mais de 5 vezes acima ou abaixo da mediana do próprio ente nos 13 anos (ex.: erro de digitação na declaração ao SICONFI). Ficam fora dos totais de UF, Brasil e rankings; ao escolher o ente, os valores aparecem como declarados, com aviso.',
            'Government-years whose gross revenue or committed expenditure was not reported or is more than 5 times above or below the government’s own median over the 13 years (e.g. a typing error in the SICONFI filing). They are excluded from state and national totals and from rankings; when the government is selected, values are shown as filed, with a warning.',
          )}
        </p>
        <div className="rolagem">
          <table>
            <thead>
              <tr>
                <th>{t('Ente', 'Government')}</th><th>{t('UF', 'State')}</th><th>{t('Exercício', 'Fiscal year')}</th>
                <th>{t('Indicador', 'Indicator')}</th><th>{t('Declarado', 'Reported')}</th>
                <th>{t('Mediana do ente', 'Government median')}</th><th>{t('Situação', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {(alertas.dados ?? []).map((a) => (
                <tr key={`${a.exercicio}-${a.cod_ibge}-${a.indicador}`}>
                  <td>{a.nome}</td><td>{a.uf}</td><td>{a.exercicio}</td>
                  <td>{rotuloIndicador(a.indicador)}</td>
                  <td>{reais(a.valor)}</td><td>{reais(a.mediana)}</td><td>{dado(a.motivo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
