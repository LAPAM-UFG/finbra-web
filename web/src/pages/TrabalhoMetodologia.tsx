import { useDados } from '../contexto';
import { local, t } from '../idioma';

const data = (iso?: unknown) => (typeof iso === 'string' ? new Date(iso).toLocaleDateString(local()) : '–');
const mesAno = (aaaamm?: unknown) => String(aaaamm ?? '').replace(/(\d{4})(\d{2})/, '$2/$1');

/** Fontes e conceitos da área de mercado de trabalho (RAIS e Novo CAGED), sem nada das finanças públicas. */
export function TrabalhoMetodologia() {
  const { meta } = useDados();
  const rais = meta.fontes.rais as { anos?: number[]; processado_em?: string } | undefined;
  const caged = meta.fontes.caged as { de?: number; ate?: number; processado_em?: string } | undefined;
  const micro = meta.fontes.rais_micro as { anos?: number[]; processado_em?: string } | undefined;
  return (
    <>
      <h2 className="titulo-pagina">{t('Mercado de trabalho: fontes e metodologia', 'Labour market: sources and methodology')}</h2>
      <section className="cartao">
        <h3>{t('Fontes', 'Sources')}</h3>
        <ul>
          <li><strong>{t('RAIS (Relação Anual de Informações Sociais)', 'RAIS (Annual Social Information Report)')}</strong>, {t('Ministério do Trabalho e Emprego', 'Ministry of Labour and Employment')} —{' '}
            {t('microdados públicos de vínculos e estabelecimentos, do', 'public microdata on jobs and establishments, from the')}{' '}
            <a href="ftp://ftp.mtps.gov.br/pdet/microdados/RAIS/" target="_blank" rel="noreferrer">{t('FTP do PDET', 'PDET FTP')}</a>.{' '}
            {t('Anos', 'Years')} {rais?.anos?.join(', ') ?? '–'} · {t('processado em', 'processed on')} {data(rais?.processado_em)}.</li>
          <li><strong>{t('Novo CAGED', 'New CAGED')}</strong>, {t('Ministério do Trabalho e Emprego', 'Ministry of Labour and Employment')} —{' '}
            {t('movimentações mensais de empregos celetistas (admissões e desligamentos), do', 'monthly movements of CLT jobs (hirings and separations), from the')}{' '}
            <a href="ftp://ftp.mtps.gov.br/pdet/microdados/NOVO%20CAGED/" target="_blank" rel="noreferrer">{t('FTP do PDET', 'PDET FTP')}</a>.{' '}
            {caged?.de ? `${mesAno(caged.de)}–${mesAno(caged.ate)}` : '–'} · {t('processado em', 'processed on')} {data(caged?.processado_em)}.</li>
          {micro?.anos && (
            <li><strong>{t('Consulta personalizada', 'Custom query')}</strong> —{' '}
              {t('microdados da RAIS (uma linha por vínculo, sem identificação de pessoas ou empresas) e tabelas somadas a partir deles, anos', 'RAIS microdata (one row per job, with no identification of people or firms) and tables summed from them, years')} {micro.anos.join(', ')}.{' '}
              {t('Para UFs e municípios a consulta lê os microdados; para o Brasil, as tabelas somadas.', 'For states and municipalities the query reads the microdata; for Brazil, the summed tables.')}</li>
          )}
          <li><strong>{t('Banco Central', 'Central Bank of Brazil')}</strong> — {t('IPCA mensal (SGS 433), para a remuneração real, e salário mínimo (SGS 1619), para o filtro do salário de admissão do CAGED.', 'monthly IPCA (SGS 433), for real pay, and minimum wage (SGS 1619), for the CAGED hiring-wage filter.')}</li>
          <li><strong>IBGE</strong> — {t('nomes das seções e divisões da CNAE 2.0 e população dos municípios, para empregos por mil habitantes: a mesma do painel de finanças desde 2013; antes, a do IBGE (Censo de 2010, tabela 1378, e estimativas de 2011 e 2012, tabela 6579 do SIDRA).', 'names of CNAE 2.0 sections and divisions and municipal population, for jobs per thousand inhabitants: the same as the finance dashboard from 2013; before that, IBGE’s (2010 Census, table 1378, and 2011–2012 estimates, SIDRA table 6579).')}</li>
        </ul>
        <p className="nota-base">{t(
          'Os arquivos públicos não identificam pessoas nem empresas (sem CPF, PIS, nome ou CNPJ). Processamento: LAPAM/UFG.',
          'The public files identify neither people nor companies (no CPF, PIS, name or CNPJ). Processing: LAPAM/UFG.',
        )}</p>
      </section>

      <section className="cartao">
        <h3>{t('RAIS: conceitos', 'RAIS: concepts')}</h3>
        <ul>
          <li>{t('A unidade é o vínculo de emprego, não a pessoa: quem tem dois empregos conta duas vezes, e não há como seguir o mesmo trabalhador entre anos.',
            'The unit is the job, not the person: someone with two jobs counts twice, and the same worker cannot be followed across years.')}</li>
          <li>{t('Empregos formais: vínculos ativos em 31 de dezembro, no município do estabelecimento. Os totais conferem com os divulgados pelo Ministério.',
            'Formal jobs: jobs active on December 31, in the municipality of the establishment. Totals match those published by the Ministry.')}</li>
          <li>{t('Remuneração média de dezembro: soma das remunerações nominais de dezembro ÷ vínculos ativos com remuneração no mês. Em grupos, média ponderada (massa ÷ vínculos).',
            'Average December pay: sum of nominal December pay ÷ active jobs with pay that month. For groups, weighted average (payroll ÷ jobs).')}</li>
          <li>{t(`Remuneração real: nominal × fator do IPCA para R$ de dezembro de ${meta.baseIpca} (índice de dez/${meta.baseIpca} ÷ índice de dezembro do ano).`,
            `Real pay: nominal × IPCA factor to December ${meta.baseIpca} R$ (Dec/${meta.baseIpca} index ÷ December index of the year).`)}</li>
          <li>{t('Grandes setores pela divisão da CNAE 2.0: agropecuária (01–03), indústria (05–39, inclui extrativa, energia e saneamento), construção (41–43), comércio (45–47), administração pública (84) e serviços (demais).',
            'Broad sectors by CNAE 2.0 division: agriculture (01–03), industry (05–39, including mining, energy and sanitation), construction (41–43), trade (45–47), public administration (84) and services (all others).')}</li>
          <li>{t('Brasília aparece como o Distrito Federal (a RAIS registra os vínculos do DF no código de Brasília).', 'Brasília stands for the Federal District (RAIS records DF jobs under Brasília’s code).')}</li>
        </ul>
        <h3 style={{ marginTop: 14 }}>{t('Consulta personalizada', 'Custom query')}</h3>
        <ul>
          <li>{t('Todos os vínculos do ano: ativos em 31/12 e os que terminaram no ano.', 'All jobs in the year: active on Dec 31 and those that ended during the year.')}</li>
          <li>{t('Desligado: não ativo em 31/12, com motivo de desligamento informado (demissão, pedido, fim de contrato, aposentadoria, falecimento etc.).',
            'Separated: not active on Dec 31, with a separation reason reported (dismissal, resignation, end of contract, retirement, death etc.).')}</li>
          <li>{t('Afastado: vínculo com afastamento no ano — acidente ou doença (do trabalho ou não), licença-maternidade, serviço militar, licenças com ou sem vencimentos, suspensão do contrato; conta a primeira causa informada. Dias de afastamento: total do ano.',
            'On leave: job with a leave of absence in the year — accident or illness (work-related or not), maternity leave, military service, paid or unpaid leave, contract suspension; the first reason reported counts. Days of leave: total for the year.')}</li>
          <li>{t('Remuneração média do ano: média mensal de cada vínculo no período em que esteve ativo. Medianas só com os microdados completos.',
            'Average pay for the year: monthly average of each job while active. Medians only with the full microdata.')}</li>
          <li>{t('Códigos CNAE e CBO funcionam como prefixos: "47" pega toda a divisão 47; vários códigos separados por vírgula são somados. Nomes das ocupações (CBO 2002) e das subclasses da CNAE vêm dos dicionários do PDET.',
            'CNAE and CBO codes work as prefixes: "47" takes the whole division 47; several comma-separated codes are added up. Names of occupations (CBO 2002) and CNAE subclasses come from the PDET dictionaries.')}</li>
        </ul>
      </section>

      <section className="cartao">
        <h3>{t('Novo CAGED: conceitos', 'New CAGED: concepts')}</h3>
        <ul>
          <li>{t('Série com ajustes, como a divulgada pelo Ministério: declarações no prazo, mais as fora do prazo, menos as exclusões, todas pela competência (mês) da movimentação.',
            'Adjusted series, as published by the Ministry: on-time filings, plus late filings, minus exclusions, all by the month (competência) of the movement.')}</li>
          <li>{t('Saldo = admissões − desligamentos. Saldo em 12 meses: soma dos últimos 12 meses.', 'Net balance = hirings − separations. 12-month balance: sum of the last 12 months.')}</li>
          <li>{t('Salário médio de admissão: só salários entre 0,3 e 150 salários mínimos do mês (fora disso, erros de digitação).',
            'Average hiring wage: only wages between 0.3 and 150 minimum wages of the month (outside that range, typing errors).')}</li>
          <li>{t('Movimentações sem município identificado entram no total do Brasil; as de códigos fora do cadastro (como Fernando de Noronha) entram na UF pelo prefixo do código.',
            'Movements without an identified municipality count in the national total; those with codes outside the register (such as Fernando de Noronha) count in the state by the code prefix.')}</li>
        </ul>
      </section>
    </>
  );
}
