import { useDados } from '../contexto';
import { local, t } from '../idioma';
import { QUEBRAS_RAIS } from '../trabalho_comum';

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
        <h3>{t('Classificações: quatro conceitos diferentes', 'Classifications: four different concepts')}</h3>
        <ul>
          <li><strong>{t('Ocupação (CBO 2002)', 'Occupation (CBO 2002)')}</strong>: {t('o que a pessoa faz no vínculo, declarado pelo empregador. Níveis: grande grupo (1 dígito), subgrupo principal (2), subgrupo (3), família (4) e ocupação (6); nomes da estrutura oficial do MTE. Não é formação acadêmica, registro em conselho nem o universo de diplomados.',
            'what the person does in the job, as reported by the employer. Levels: major group (1 digit), sub-major group (2), minor group (3), family (4) and occupation (6); names from the Ministry’s official structure. It is not academic training, professional registration or the universe of graduates.')}</li>
          <li><strong>{t('Atividade do estabelecimento (CNAE 2.0)', 'Establishment activity (CNAE 2.0)')}</strong>: {t('atividade econômica principal do estabelecimento onde está o vínculo. A divisão 84 é a atividade Administração pública, defesa e seguridade social: não é todo o setor público, que também aparece em educação, saúde e outras atividades.',
            'main economic activity of the establishment where the job is. Division 84 is the activity Public administration, defence and social security: it is not the whole public sector, which also appears in education, health and other activities.')}</li>
          <li><strong>{t('Natureza jurídica do estabelecimento', 'Legal nature of the establishment')}</strong>: {t('Tabela de Natureza Jurídica 2021 (CONCLA/IBGE e Receita Federal), cinco grupos: 1 administração pública, 2 entidades empresariais, 3 entidades sem fins lucrativos, 4 pessoas físicas e 5 organizações internacionais. O grupo 2 inclui empresas estatais (201-1 empresa pública e 203-8 sociedade de economia mista): não é sinônimo de empresas privadas. 9999 e códigos fora da tabela ficam como "ignorado".',
            '2021 Legal Nature Table (CONCLA/IBGE and Federal Revenue), five groups: 1 public administration, 2 business entities, 3 non-profit entities, 4 individuals and 5 international organisations. Group 2 includes state-owned companies (201-1 public company and 203-8 mixed-capital company): it is not the same as private companies. 9999 and codes outside the table are kept as "ignored".')}</li>
          <li><strong>{t('Tipo de vínculo', 'Type of contract')}</strong>: {t('celetista, estatutário, temporário, aprendiz etc., no detalhe do PDET ou na agregação da nota técnica da RAIS 2023 (contratos por lei estadual ou municipal entram em estatutários).',
            'CLT, statutory, temporary, apprentice etc., in PDET detail or in the RAIS 2023 technical note grouping (state or municipal law contracts count as statutory).')}</li>
        </ul>
        <h4>{t('Mapeamento do setor institucional e da esfera (natureza jurídica)', 'Mapping of institutional sector and level of government (legal nature)')}</h4>
        <table>
          <thead><tr><th>{t('Categoria', 'Category')}</th><th>{t('Códigos', 'Codes')}</th></tr></thead>
          <tbody>
            <tr><td>{t('Administração pública', 'Public administration')}</td><td>1000–1999 ({t('grupo 1', 'group 1')})</td></tr>
            <tr><td>{t('Empresas estatais', 'State-owned companies')}</td><td>2011 ({t('empresa pública', 'public company')}), 2038 ({t('sociedade de economia mista', 'mixed-capital company')})</td></tr>
            <tr><td>{t('Empresas privadas', 'Private companies')}</td><td>{t('demais códigos 2000–2999', 'other codes 2000–2999')}</td></tr>
            <tr><td>{t('Entidades sem fins lucrativos', 'Non-profit entities')}</td><td>3000–3999</td></tr>
            <tr><td>{t('Pessoas físicas empregadoras', 'Individual employers')}</td><td>4000–4999</td></tr>
            <tr><td>{t('Organizações internacionais', 'International organisations')}</td><td>5000–5999</td></tr>
            <tr><td>{t('Ignorado', 'Ignored')}</td><td>9999, {t('vazio ou fora da tabela', 'blank or outside the table')}</td></tr>
            <tr><td>{t('Esfera federal', 'Federal level')}</td><td>1015, 1040, 1074, 1104, 1139, 1163, 1252, 1287, 1317, 1341</td></tr>
            <tr><td>{t('Esfera estadual ou distrital', 'State or district level')}</td><td>1023, 1058, 1082, 1112, 1147, 1171, 1236, 1260, 1295, 1325</td></tr>
            <tr><td>{t('Esfera municipal', 'Municipal level')}</td><td>1031, 1066, 1120, 1155, 1180, 1244, 1279, 1309, 1333</td></tr>
            <tr><td>{t('Interfederativa ou sem esfera', 'Inter-federal or no level')}</td><td>{t('demais do grupo 1 (consórcios públicos, comissão polinacional, fundo público)', 'rest of group 1 (public consortia, multinational commission, public fund)')}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="cartao">
        <h3>{t('Remuneração, denominadores e grupos pequenos', 'Pay, denominators and small groups')}</h3>
        <ul>
          <li>{t('Remuneração de dezembro válida: vínculo ativo em 31/12 com valor maior que zero. Até a RAIS 2022, a falta de valor vem como 0 no arquivo; desde 2023, em branco. Ausentes, zeros e negativos ficam fora da média e aparecem contados à parte (N válido e % fora do cálculo), nunca substituídos por zero. A nota técnica da RAIS 2023 registra subdeclaração da remuneração de estatutários (cerca de 70% a 75% com remuneração a cada mês).',
            'Valid December pay: job active on Dec 31 with a value above zero. Until RAIS 2022, missing values come as 0 in the file; since 2023, blank. Missing, zero and negative values are left out of the average and counted separately (valid N and % left out), never replaced by zero. The RAIS 2023 technical note reports under-reporting of statutory pay (about 70% to 75% with pay each month).')}</li>
          <li>{t('Médias de grupos: massa salarial ÷ N válido do grupo (nunca média das médias de municípios, setores ou ocupações). Medianas e percentis (P10, P25, P50, P75, P90) só a partir dos registros (microdados); nas tabelas pré-somadas aparecem como indisponíveis.',
            'Group averages: payroll ÷ the group’s valid N (never an average of municipal, sector or occupation averages). Medians and percentiles (P10, P25, P50, P75, P90) only from the records (microdata); in pre-aggregated tables they show as unavailable.')}</li>
          <li>{t('Remuneração de dezembro, remuneração média mensal do ano (média de cada vínculo enquanto ativo) e salário de admissão do CAGED são medidas diferentes; a média do ano não é renda anual.',
            'December pay, average monthly pay for the year (each job’s average while active) and the CAGED hiring wage are different measures; the yearly average is not annual income.')}</li>
          <li>{t(`Valores reais: nominal × (índice do IPCA de dezembro de ${meta.baseIpca} ÷ índice de dezembro do ano). O salário de admissão do CAGED aparece nominal: a correção mês a mês precisa do IPCA mensal, ainda não carregado no painel.`,
            `Real values: nominal × (December ${meta.baseIpca} IPCA index ÷ December index of the year). The CAGED hiring wage is shown nominal: month-by-month adjustment needs monthly IPCA, not yet loaded in the dashboard.`)}</li>
          <li>{t('Remuneração por hora contratada: aproximação = remuneração de dezembro ÷ (horas semanais contratadas × 52 ÷ 12), só com jornada de 1 a 44 horas; não mede horas efetivamente trabalhadas.',
            'Pay per contracted hour: approximation = December pay ÷ (contracted weekly hours × 52 ÷ 12), only for 1 to 44 hours; it does not measure hours actually worked.')}</li>
          <li>{t('Grupos pequenos: valores com menos de 30 vínculos no denominador saem marcados (‡), com o N à vista; o limite pode ser mudado na consulta e vai no endereço e nas exportações.',
            'Small groups: values with fewer than 30 jobs in the denominator are flagged (‡), with N shown; the threshold can be changed in the query and goes in the address and exports.')}</li>
          <li>{t('Diferenças por sexo e raça/cor são diferenças observadas: não demonstram, sozinhas, discriminação ou efeito causal.', 'Differences by sex and race/colour are observed differences: on their own they do not show discrimination or a causal effect.')}</li>
          <li>{t('Vínculos por mil habitantes: vínculos ativos no município do estabelecimento ÷ população residente do mesmo ano × 1.000. Não é taxa de ocupação, de formalização ou de desemprego (há múltiplos vínculos e deslocamento entre casa e trabalho) e pode passar de 1.000.',
            'Jobs per thousand inhabitants: active jobs in the establishment’s municipality ÷ resident population of the same year × 1,000. It is not an employment, formality or unemployment rate (there are multiple jobs and commuting) and it can exceed 1,000.')}</li>
          <li>{t('Códigos de ocupação ou atividade contidos em outro da mesma lista (ex.: 2512 e 251205) não contam duas vezes: dentro de um filtro vale a união; filtros diferentes se combinam por interseção.',
            'Occupation or activity codes contained in another code in the same list (e.g. 2512 and 251205) are not counted twice: within a filter, union applies; different filters combine by intersection.')}</li>
        </ul>
      </section>

      <section className="cartao">
        <h3>{t('Comparabilidade: quebras de série da RAIS', 'Comparability: RAIS series breaks')}</h3>
        <ul>
          {QUEBRAS_RAIS().map((q) => <li key={q.ano}>{q.texto} <a href={q.url} target="_blank" rel="noreferrer">{t('Nota técnica do MTE', 'MTE technical note')}</a>.</li>)}
          <li>{t('Gráficos marcam esses anos com linhas tracejadas; tabelas e exportações que os atravessam levam a nota. Uma variação que cruza a quebra é observada: não é, automaticamente, geração de empregos ou ganho salarial comparável. O painel não atribui ao eSocial o salto de uma variável sem evidência específica para ela.',
            'Charts mark these years with dashed lines; tables and exports that cross them carry the note. A change across a break is observed: it is not automatically job creation or a comparable pay gain. The dashboard does not attribute a jump in a variable to eSocial without specific evidence for it.')}</li>
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
          <li>{t('Cobertura: só empregos celetistas. O estoque da RAIS inclui estatutários e outros vínculos; somar o saldo do CAGED a um estoque da RAIS mistura universos diferentes, e o painel não faz isso. Indicadores de rotatividade só com denominador do mesmo universo celetista, território, ocupação e período.',
            'Coverage: CLT jobs only. The RAIS stock includes statutory and other jobs; adding the CAGED balance to a RAIS stock mixes different universes, and the dashboard does not do it. Turnover indicators only with a denominator from the same CLT universe, territory, occupation and period.')}</li>
          <li>{t('O Novo CAGED informa a ocupação (CBO), a atividade (subclasse CNAE) e o perfil de cada movimentação; os microdados estão processados, mas o painel ainda carrega só os totais por município e por seção. Os recortes por ocupação e perfil no CAGED dependem de uma nova tabela somada (em preparação).',
            'New CAGED reports the occupation (CBO), activity (CNAE subclass) and profile of each movement; the microdata are processed, but the dashboard still loads only totals by municipality and section. Occupation and profile breakdowns in CAGED depend on a new summed table (in preparation).')}</li>
          <li>{t('Movimentações sem município identificado entram no total do Brasil; as de códigos fora do cadastro (como Fernando de Noronha) entram na UF pelo prefixo do código.',
            'Movements without an identified municipality count in the national total; those with codes outside the register (such as Fernando de Noronha) count in the state by the code prefix.')}</li>
        </ul>
      </section>
    </>
  );
}
