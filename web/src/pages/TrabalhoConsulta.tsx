import { useState } from 'react';
import { useApi, type Linha, type Params } from '../api';
import { Dica } from '../components/Dica';
import { BotoesExportar } from '../components/Exportar';
import { Estado, Kpi } from '../components/Kpi';
import { BarraFiltros, useDados, useFiltros } from '../contexto';
import { fonteConsulta, gruposDaFonte, LIMITES_CONSULTA } from '../dados';
import { div, numero, pct, reaisExato } from '../format';
import { num } from '../hooks';
import { t } from '../idioma';

type Resultado = { fonte: 'micro' | 'cubo'; linhas: Linha[] };

const AGRUPAMENTOS = (): [string, string][] => [
  ['total', t('Sem agrupar (total)', 'No grouping (total)')],
  ['cnae_secao', t('CNAE: seção', 'CNAE: section')],
  ['cnae_divisao', t('CNAE: divisão (2 dígitos)', 'CNAE: division (2 digits)')],
  ['cnae_classe', t('CNAE: classe (5 dígitos)', 'CNAE: class (5 digits)')],
  ['cnae_subclasse', t('CNAE: subclasse (7 dígitos)', 'CNAE: subclass (7 digits)')],
  ['cbo_grande_grupo', t('CBO: grande grupo', 'CBO: major group')],
  ['cbo_familia', t('CBO: família (4 dígitos)', 'CBO: family (4 digits)')],
  ['cbo', t('CBO: ocupação (6 dígitos)', 'CBO: occupation (6 digits)')],
  ['situacao', t('Situação no fim do ano', 'Status at year end')],
  ['causa_afastamento', t('Causa do afastamento', 'Reason for leave')],
  ['motivo_desligamento', t('Motivo do desligamento', 'Reason for separation')],
  ['sexo', t('Sexo', 'Sex')],
  ['faixa_idade', t('Faixa de idade', 'Age group')],
  ['escolaridade', t('Escolaridade', 'Education')],
  ['raca_cor', t('Raça/cor', 'Race/colour')],
  ['tipo_vinculo', t('Tipo de vínculo', 'Type of contract')],
  ['natureza_juridica_grupo', t('Natureza jurídica (grupo)', 'Legal nature (group)')],
  ['tamanho_estab', t('Tamanho do estabelecimento', 'Establishment size')],
  ['uf', 'UF'],
  ['municipio', t('Município', 'Municipality')],
];

const SITUACOES = (): [string, string][] => [
  ['', t('Todos os vínculos do ano', 'All jobs in the year')],
  ['ativos', t('Ativos em 31/12', 'Active on Dec 31')],
  ['nao_ativos', t('Não ativos em 31/12', 'Not active on Dec 31')],
  ['desligados', t('Desligados no ano', 'Separated during the year')],
  ['afastados', t('Afastados no ano', 'On leave during the year')],
];

const notaFonte = () => t(
  'RAIS, Ministério do Trabalho e Emprego, microdados públicos sem identificação. A unidade é o vínculo: quem tem dois empregos conta duas vezes. Processamento: LAPAM/UFG.',
  'RAIS, Ministry of Labour and Employment, public de-identified microdata. The unit is the job: a person with two jobs counts twice. Processing: LAPAM/UFG.',
);
const notaDefinicoes = () => t(
  'Ativo: vínculo ativo em 31/12. Desligado: não ativo em 31/12, com motivo de desligamento no ano. Afastado: com afastamento no ano (acidente, doença, licença etc.; primeira causa informada). Remuneração de dezembro: só vínculos ativos com remuneração no mês. Remuneração média do ano: média mensal de cada vínculo no período em que esteve ativo. Valores nominais.',
  'Active: job active on Dec 31. Separated: not active on Dec 31, with a separation reason in the year. On leave: with a leave of absence in the year (accident, illness, parental leave etc.; first reason reported). December pay: active jobs with pay that month only. Average pay for the year: monthly average of each job while active. Nominal values.',
);

/** Campo de códigos (CNAE ou CBO) com busca por nome no dicionário. */
function CampoCodigos({ id, rotulo, variavel, valor, mudar, exemplo }: {
  id: string; rotulo: string; variavel: string; valor: string; mudar: (v: string) => void; exemplo: string;
}) {
  const [busca, setBusca] = useState('');
  const achados = useApi<Linha[]>(busca.trim().length >= 3 ? 'trab_dicionario' : null, { variavel, texto: busca.trim() });
  const acrescentar = (codigo: string) => {
    const atuais = valor.split(/[\s,;]+/).filter(Boolean);
    if (!atuais.includes(codigo)) mudar([...atuais, codigo].join(', '));
  };
  return (
    <div className="campo campo-codigos">
      <label htmlFor={id}>{rotulo}</label>
      <input id={id} value={valor} onChange={(e) => mudar(e.target.value)} placeholder={exemplo} />
      <input aria-label={t(`Buscar ${rotulo} pelo nome`, `Search ${rotulo} by name`)} value={busca}
        onChange={(e) => setBusca(e.target.value)} placeholder={t('buscar pelo nome…', 'search by name…')} />
      {busca.trim().length >= 3 && (achados.dados ?? []).length > 0 && (
        <ul className="sugestoes">
          {(achados.dados ?? []).map((r) => (
            <li key={String(r.codigo)}>
              <button className="limpar" onClick={() => acrescentar(String(r.codigo))}>
                <code>{String(r.codigo)}</code> {String(r.descricao)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function TrabalhoConsulta() {
  const { meta } = useDados();
  const f = useFiltros();
  const micro = meta.fontes.rais_micro as { anos?: number[] } | undefined;
  const anos = micro?.anos ?? [];
  const ano = anos.includes(f.ano) ? f.ano : ([...anos].reverse().find((a) => a <= f.ano) ?? anos.at(-1));

  // escopo: município, UF (microdados) ou Brasil (cubo)
  let escopo: Params;
  let rotulo: string;
  if (f.alvo && f.alvo.esfera !== 'E') {
    escopo = { ente: f.alvo.cod_ibge };
    rotulo = f.alvo.esfera === 'D' ? 'Brasília (DF)' : f.rotulo;
  } else if (f.alvo?.esfera === 'E' || f.uf) {
    escopo = { uf: f.alvo?.uf ?? f.uf! };
    rotulo = String(escopo.uf);
  } else {
    escopo = {};
    rotulo = t('Brasil', 'Brazil');
  }
  const fonte = fonteConsulta(escopo);
  const limites = LIMITES_CONSULTA[fonte];

  const [rascunho, setRascunho] = useState({ cnae: '', cbo: '', situacao: '', sexo: '', agrupar: 'cnae_divisao' });
  const [pedido, setPedido] = useState<typeof rascunho | null>(null);
  const muda = (k: keyof typeof rascunho) => (v: string) => setRascunho({ ...rascunho, [k]: v });
  const disponiveis = gruposDaFonte(fonte);
  const agrupamentos = AGRUPAMENTOS().filter(([k]) => disponiveis.includes(k) && !(k === 'municipio' && escopo.ente) && !(k === 'uf' && escopo.uf));
  const agrupar = agrupamentos.some(([k]) => k === pedido?.agrupar) ? pedido!.agrupar : 'total';

  const params = pedido && ano ? { ...escopo, ano, cnae: pedido.cnae, cbo: pedido.cbo, situacao: pedido.situacao, sexo: pedido.sexo } : null;
  const total = useApi<Resultado>(params ? 'trab_consulta' : null, { ...params, agrupar: 'total' });
  const grupos = useApi<Resultado>(params && agrupar !== 'total' ? 'trab_consulta' : null, { ...params, agrupar });
  const tot = total.dados?.linhas[0];
  const linhas = grupos.dados?.linhas ?? [];
  const semMediana = fonte !== 'micro';
  const nomeAgrupar = AGRUPAMENTOS().find(([k]) => k === agrupar)?.[1] ?? '';

  if (!anos.length) {
    return (
      <>
        <h2 className="titulo-pagina">{t('Consulta personalizada', 'Custom query')}</h2>
        <p className="vazio">{t('Os microdados da RAIS ainda não foram publicados.', 'RAIS microdata have not been published yet.')}</p>
      </>
    );
  }
  const filtrosTexto: [string, string][] = [
    [t('Recorte', 'Scope'), rotulo], [t('Ano', 'Year'), String(ano)],
    ['CNAE', pedido?.cnae || t('todas', 'all')], ['CBO', pedido?.cbo || t('todas', 'all')],
    [t('Situação', 'Status'), SITUACOES().find(([k]) => k === pedido?.situacao)?.[1] ?? ''],
    [t('Sexo', 'Sex'), pedido?.sexo === '1' ? t('Masculino', 'Male') : pedido?.sexo === '2' ? t('Feminino', 'Female') : t('ambos', 'both')],
  ];
  const colunas: [string, string, (v: Linha) => string, (v: Linha) => number | string | null][] = [
    ['vinculos', t('Vínculos', 'Jobs'), (r) => numero(num(r.vinculos)), (r) => r.vinculos],
    ['ativos', t('Ativos 31/12', 'Active Dec 31'), (r) => numero(num(r.ativos)), (r) => r.ativos],
    ['desligados', t('Desligados', 'Separated'), (r) => numero(num(r.desligados)), (r) => r.desligados],
    ['afastados', t('% afastados', '% on leave'), (r) => pct(div(num(r.afastados), num(r.vinculos))), (r) => div(num(r.afastados), num(r.vinculos))],
    ['dias', t('Dias de afast. (média)', 'Days of leave (avg)'), (r) => numero(num(r.dias_afastamento_medio)), (r) => r.dias_afastamento_medio],
    ['rem_dez', t('Rem. dezembro (média)', 'December pay (avg)'), (r) => reaisExato(num(r.rem_dez_media)), (r) => r.rem_dez_media],
    ...(semMediana ? [] : [['rem_dez_med', t('Rem. dezembro (mediana)', 'December pay (median)'), (r: Linha) => reaisExato(num(r.rem_dez_mediana)), (r: Linha) => r.rem_dez_mediana] as [string, string, (v: Linha) => string, (v: Linha) => number | string | null]]),
    ['rem_media', t('Rem. média do ano', 'Average pay (year)'), (r) => reaisExato(num(r.rem_media_media)), (r) => r.rem_media_media],
    ['mulheres', t('% mulheres', '% women'), (r) => pct(div(num(r.mulheres), num(r.vinculos))), (r) => div(num(r.mulheres), num(r.vinculos))],
    ['superior', t('% superior completo', '% college degree'), (r) => pct(div(num(r.superior), num(r.vinculos))), (r) => div(num(r.superior), num(r.vinculos))],
    ['horas', t('Horas semanais', 'Weekly hours'), (r) => numero(num(r.horas_media)), (r) => r.horas_media],
  ];

  return (
    <>
      <h2 className="titulo-pagina">{t('Consulta personalizada (microdados da RAIS)', 'Custom query (RAIS microdata)')}</h2>
      <p className="subtitulo">{rotulo} · RAIS {ano} <Dica rotulo={t('Fonte', 'Source')}>{notaFonte()}</Dica></p>
      <BarraFiltros />
      {ano !== f.ano && (
        <p className="aviso" role="status">{t(
          `A consulta personalizada ainda não tem ${f.ano}: os anos prontos são ${anos.join(', ')}. Mostrando ${ano}; para outro ano, troque o filtro Ano acima.`,
          `The custom query does not have ${f.ano} yet: the years available are ${anos.join(', ')}. Showing ${ano}; for another year, change the Year filter above.`,
        )}</p>
      )}
      <section className="cartao">
        <div className="filtros">
          <CampoCodigos id="q-cnae" rotulo="CNAE" variavel="cnae_classe" valor={rascunho.cnae} mudar={muda('cnae')}
            exemplo={t('ex.: 4711, 56 (prefixos)', 'e.g. 4711, 56 (prefixes)')} />
          <CampoCodigos id="q-cbo" rotulo="CBO" variavel="cbo" valor={rascunho.cbo} mudar={muda('cbo')}
            exemplo={t('ex.: 2124, 3222 (prefixos)', 'e.g. 2124, 3222 (prefixes)')} />
          <div className="campo">
            <label htmlFor="q-sit">{t('Vínculos', 'Jobs')}</label>
            <select id="q-sit" value={rascunho.situacao} onChange={(e) => muda('situacao')(e.target.value)}>
              {SITUACOES().map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="q-sexo">{t('Sexo', 'Sex')}</label>
            <select id="q-sexo" value={rascunho.sexo} onChange={(e) => muda('sexo')(e.target.value)}>
              <option value="">{t('Ambos', 'Both')}</option>
              <option value="1">{t('Masculino', 'Male')}</option>
              <option value="2">{t('Feminino', 'Female')}</option>
            </select>
          </div>
          <div className="campo">
            <label htmlFor="q-agr">{t('Agrupar por', 'Group by')}</label>
            <select id="q-agr" value={rascunho.agrupar} onChange={(e) => muda('agrupar')(e.target.value)}>
              {agrupamentos.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
          </div>
          <button className="botao" onClick={() => setPedido({ ...rascunho })}>{t('Consultar', 'Run query')}</button>
        </div>
        <p className="nota-base">
          {t('Códigos são prefixos: "47" pega toda a divisão 47 da CNAE; "2124" pega a família 2124 da CBO. Separe vários por vírgula: o resultado soma todos.',
            'Codes are prefixes: "47" takes the whole CNAE division 47; "2124" takes CBO family 2124. Separate several with commas: the result adds them all.')}{' '}
          {fonte === 'micro'
            ? t('Microdados completos: todos os recortes e medianas. UFs grandes (SP, MG, RJ) podem levar alguns minutos.',
              'Full microdata: every breakdown and medians. Large states (SP, MG, RJ) may take a few minutes.')
            : t(`Tabela pré-somada (sem medianas): CNAE até ${limites.cnae} dígitos e CBO até ${limites.cbo} dígito(s) neste recorte.${fonte === 'cubo_mun' ? ' Para classes CNAE e ocupações, escolha a UF.' : ''}`,
              `Pre-aggregated table (no medians): CNAE up to ${limites.cnae} digits and CBO up to ${limites.cbo} digit(s) for this scope.${fonte === 'cubo_mun' ? ' For CNAE classes and occupations, choose the state.' : ''}`)}
        </p>
      </section>

      {!pedido && <p className="vazio">{t('Escolha os filtros e clique em Consultar.', 'Choose the filters and click Run query.')}</p>}
      {pedido && (
        <>
          <Estado carregando={total.carregando} erro={total.erro} tentarNovamente={total.recarregar}
            vazio={!total.carregando && !num(tot?.vinculos) && t('Nenhum vínculo com esses filtros.', 'No jobs match these filters.')} />
          {tot && num(tot.vinculos) ? (
            <div className="kpis">
              <Kpi rotulo={t('Vínculos no ano', 'Jobs in the year')} valor={numero(num(tot.vinculos))}
                nota={t(`${numero(num(tot.ativos))} ativos em 31/12 · ${numero(num(tot.desligados))} desligados`,
                  `${numero(num(tot.ativos))} active on Dec 31 · ${numero(num(tot.desligados))} separated`)} />
              <Kpi rotulo={t('Remuneração de dezembro', 'December pay')} valor={reaisExato(num(tot.rem_dez_media))}
                nota={semMediana ? t('média dos ativos', 'average of active jobs') : t(`média · mediana ${reaisExato(num(tot.rem_dez_mediana))}`, `average · median ${reaisExato(num(tot.rem_dez_mediana))}`)}
                dica={<Dica rotulo={t('Definições', 'Definitions')}>{notaDefinicoes()}</Dica>} />
              <Kpi rotulo={t('Remuneração média do ano', 'Average pay for the year')} valor={reaisExato(num(tot.rem_media_media))}
                nota={semMediana ? undefined : t(`mediana ${reaisExato(num(tot.rem_media_mediana))}`, `median ${reaisExato(num(tot.rem_media_mediana))}`)} />
              <Kpi rotulo={t('Afastados no ano', 'On leave during the year')} valor={pct(div(num(tot.afastados), num(tot.vinculos)))}
                nota={t(`${numero(num(tot.afastados))} vínculos · ${numero(num(tot.dias_afastamento_medio))} dias em média`,
                  `${numero(num(tot.afastados))} jobs · ${numero(num(tot.dias_afastamento_medio))} days on average`)} />
              <Kpi rotulo={t('Mulheres', 'Women')} valor={pct(div(num(tot.mulheres), num(tot.vinculos)))} />
              <Kpi rotulo={t('Com superior completo', 'With a college degree')} valor={pct(div(num(tot.superior), num(tot.vinculos)))} />
            </div>
          ) : null}
          {agrupar !== 'total' && (
            <section className="cartao">
              <div className="cabeca-cartao">
                <div>
                  <h3>{t(`Por ${nomeAgrupar.toLowerCase()}`, `By ${nomeAgrupar.toLowerCase()}`)}</h3>
                  <p className="desc">{rotulo} · RAIS {ano}{linhas.length >= 3000 ? t(' · os 3.000 maiores grupos', ' · the 3,000 largest groups') : ''}</p>
                </div>
                <BotoesExportar nome={`rais_consulta_${ano}_${agrupar}`} obter={() => ({
                  colunas: [t('Código', 'Code'), t('Nome', 'Name'), ...colunas.map((c) => c[1])],
                  linhas: linhas.map((r) => [r.grupo, r.nome, ...colunas.map((c) => c[3](r))]),
                  metadados: [...filtrosTexto, [t('Agrupamento', 'Grouping'), nomeAgrupar], [t('Definições', 'Definitions'), notaDefinicoes()], [t('Fonte', 'Source'), notaFonte()]],
                })} />
              </div>
              <Estado carregando={grupos.carregando} erro={grupos.erro} tentarNovamente={grupos.recarregar} />
              {linhas.length > 0 && (
                <div className="rolagem">
                  <table>
                    <thead><tr><th>{nomeAgrupar}</th>{colunas.map((c) => <th key={c[0]}>{c[1]}</th>)}</tr></thead>
                    <tbody>
                      {linhas.map((r) => (
                        <tr key={String(r.grupo)}>
                          <td title={String(r.grupo ?? '')}>{r.nome ? `${r.grupo} · ${r.nome}` : String(r.grupo ?? t('(não informado)', '(not reported)'))}</td>
                          {colunas.map((c) => <td key={c[0]}>{c[2](r)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}
