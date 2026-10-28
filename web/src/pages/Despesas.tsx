import { useMemo, useState } from 'react';
import { useApi, type Arvore, type Linha } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { Dica } from '../components/Dica';
import { barras, CartaoGrafico, Grafico, linhas } from '../components/Grafico';
import { Estado, Kpi } from '../components/Kpi';
import { TabelaSerie } from '../components/TabelaSerie';
import { BarraFiltros, Cobertura, useDados, useFiltros } from '../contexto';
import { div, numero, pct, reais, reaisCurto, reaisExato } from '../format';
import { num, useColuna, useSerie } from '../hooks';
import { dado, t } from '../idioma';
import { codigoConta } from '../calculos';
import { textoReferencia } from './Receitas';

export const textoIntra = () =>
  t(
    'Padrão das páginas de despesa: total exceto intraorçamentárias (Anexo I-E). As operações intraorçamentárias são pagamentos entre órgãos do próprio ente (ex.: contribuição patronal ao regime próprio); somá-las ao total contaria o mesmo recurso duas vezes no ente. O valor intraorçamentário aparece à parte.',
    'Standard on expenditure pages: total excluding intra-budgetary (Annex I-E). Intra-budgetary operations are payments between bodies of the same government (e.g. employer contributions to its own pension scheme); adding them to the total would count the same money twice. The intra-budgetary amount is shown separately.',
  );

export function DespesasVisaoGeral() {
  const f = useFiltros();
  const { coluna, setColuna, opcoes } = useColuna('I-E', f.ano, 'Despesas Empenhadas');
  const arvore = useApi<Arvore>(coluna ? 'arvore' : null, { anexo: 'I-E', ano: f.ano, coluna, ...f.escopo });
  const kpi = useApi<Linha[]>('agregado', {
    por: 'exercicio',
    campos: 'despesa_empenhada_sem_intra,despesa_liquidada_sem_intra,despesa_paga_sem_intra,despesa_intra,despesa_empenhada',
    pares: 'despesa_saude/despesa_empenhada_sem_intra,despesa_educacao/despesa_empenhada_sem_intra',
    ano: f.ano, ...f.escopo,
  });
  const k = kpi.dados?.[0];
  const funcoes = useMemo(
    () => (arvore.dados?.nos ?? []).filter((n) => n.tipo === 'conta' && n.nivel === 1 && n.valor)
      .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0)).slice(0, 12),
    [arvore.dados],
  );
  const opcao = useMemo(() => barras(funcoes.map((n) => dado(n.descricao)), funcoes.map((n) => n.valor), reaisCurto), [funcoes]);
  const empenhada = num(k?.despesa_empenhada_sem_intra);
  const participacao = (campo: string) => {
    const n = num(k?.[`${campo}__despesa_empenhada_sem_intra_num`]);
    const d = num(k?.[`${campo}__despesa_empenhada_sem_intra_den`]);
    return { v: div(n, d), n };
  };
  const saude = participacao('despesa_saude');
  const educacao = participacao('despesa_educacao');
  const dicaParticipacao = (
    <Dica rotulo={t('Base do percentual', 'Percentage base')}>
      {t(
        'Participação da função (10 Saúde ou 12 Educação, despesa empenhada) na despesa empenhada exceto intraorçamentárias, no mesmo conjunto de entes. Não é a apuração dos mínimos constitucionais (ASPS e MDE), que usa receitas de impostos como base e regras próprias de cômputo.',
        'Share of the function (10 Health or 12 Education, committed expenditure) in committed expenditure excluding intra-budgetary, in the same set of governments. It is not the calculation of the constitutional minimums (health and education), which use tax revenue as the base and their own counting rules.',
      )}
    </Dica>
  );

  return (
    <>
      <h2 className="titulo-pagina">{t('Visão geral das despesas', 'Expenditure overview')}</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · {t('DCA Anexo I-E (despesas por função)', 'DCA Annex I-E (expenditure by function)')}</p>
      <BarraFiltros />
      <Cobertura dominio="despesa" />
      <p className="nota-base">{textoIntra()}</p>
      <Estado carregando={kpi.carregando} erro={kpi.erro} tentarNovamente={kpi.recarregar} />
      <div className="kpis">
        <Kpi rotulo={t('Despesa empenhada', 'Committed expenditure')} valor={reais(empenhada)}
          nota={t('exceto intraorçamentárias', 'excluding intra-budgetary')} />
        <Kpi rotulo={t('Liquidada', 'Accrued')} valor={reais(num(k?.despesa_liquidada_sem_intra))} nota={t('exceto intra', 'excluding intra')} />
        <Kpi rotulo={t('Paga', 'Paid')} valor={reais(num(k?.despesa_paga_sem_intra))} nota={t('exceto intra', 'excluding intra')} />
        <Kpi rotulo={t('Intraorçamentárias (empenhadas)', 'Intra-budgetary (committed)')} valor={reais(num(k?.despesa_intra))}
          nota={`${t('total com intra (Anexo I-D)', 'total with intra (Annex I-D)')}: ${reais(num(k?.despesa_empenhada))}`} />
        <Kpi rotulo={t('Empenhada per capita', 'Committed per capita')}
          valor={reaisExato(div(empenhada, num(k?.populacao_despesa_empenhada_sem_intra)))}
          dica={f.alvo ? undefined : <Dica rotulo={t('Como é calculado', 'How it is calculated')}>{textoReferencia()}</Dica>} />
        <Kpi rotulo={t('Saúde: participação na despesa', 'Health: share of expenditure')} valor={pct(saude.v)} nota={reais(saude.n)} dica={dicaParticipacao} />
        <Kpi rotulo={t('Educação: participação na despesa', 'Education: share of expenditure')} valor={pct(educacao.v)} nota={reais(educacao.n)} dica={dicaParticipacao} />
      </div>
      {funcoes.length > 0 && (
        <CartaoGrafico titulo={t('Maiores funções', 'Largest functions')}
          desc={`${dado(coluna ?? '')} · ${t('exceto intraorçamentárias', 'excluding intra-budgetary')}`}
          tabela={<TabelaSerie nome="maiores_funcoes" anos={funcoes.map((n) => dado(n.descricao))}
            colunas={[{ titulo: t('Valor (R$ correntes)', 'Value (current R$)'), valores: funcoes.map((n) => n.valor), formato: reais }]} />}>
          <Grafico opcao={opcao} altura={Math.max(220, funcoes.length * 30)} nome="maiores_funcoes" />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t('Despesas por função e subfunção', 'Expenditure by function and subfunction')}</h3>
            <p className="desc">
              {t(
                'As funções somam a despesa exceto intraorçamentária; o total intra aparece nas linhas de total.',
                'Functions add up to expenditure excluding intra-budgetary; the intra-budgetary total appears in the total lines.',
              )}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="col-ie">{t('Coluna', 'Column')}</label>
            <select id="col-ie" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)}>
              {opcoes.map((c) => <option key={c} value={c}>{dado(c)}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={arvore.carregando} erro={arvore.erro} tentarNovamente={arvore.recarregar} />
        {arvore.dados && coluna && <ArvoreTabela key={`${f.ano}-${coluna}`} arvore={arvore.dados} anexo="I-E" coluna={coluna} />}
      </section>
    </>
  );
}

export const textoIntraNatureza = () =>
  t(
    'Neste anexo (I-D), o total inclui as despesas intraorçamentárias: elas já estão nas despesas correntes e de capital, e as linhas “Intra” só as detalham. Por isso o total é maior que o das páginas de despesa por função, que excluem as intraorçamentárias.',
    'In this annex (I-D), the total includes intra-budgetary expenditure: it is already within current and capital expenditure, and the “Intra” lines only detail it. That is why the total is larger than on the expenditure-by-function pages, which exclude intra-budgetary items.',
  );

/** Grupos de natureza da despesa (GND), na ordem da classificação; os códigos são os mesmos desde 2013. */
const GRUPOS_NATUREZA = ['DO3.1', 'DO3.2', 'DO3.3', 'DO4.4', 'DO4.5', 'DO4.6'];

export function DespesasNaturezaVisaoGeral() {
  const f = useFiltros();
  const { coluna, setColuna, opcoes } = useColuna('I-D', f.ano, 'Despesas Empenhadas');
  const arvore = useApi<Arvore>(coluna ? 'arvore' : null, { anexo: 'I-D', ano: f.ano, coluna, ...f.escopo });
  const kpi = useApi<Linha[]>('agregado', {
    por: 'exercicio',
    campos: 'despesa_empenhada,despesa_liquidada,despesa_paga',
    pares: 'despesa_pessoal/despesa_empenhada,investimentos/despesa_empenhada',
    ano: f.ano, ...f.escopo,
  });
  const k = kpi.dados?.[0];
  const grupos = useMemo(
    () => GRUPOS_NATUREZA.map((c) => arvore.dados?.nos.find((n) => n.chave === c)).filter((n) => !!n?.valor).map((n) => n!),
    [arvore.dados],
  );
  const opcao = useMemo(() => barras(grupos.map((n) => dado(n.descricao)), grupos.map((n) => n.valor), reaisCurto), [grupos]);
  const empenhada = num(k?.despesa_empenhada);
  const participacao = (campo: string) => {
    const n = num(k?.[`${campo}__despesa_empenhada_num`]);
    const d = num(k?.[`${campo}__despesa_empenhada_den`]);
    return { v: div(n, d), n };
  };
  const pessoal = participacao('despesa_pessoal');
  const investimentos = participacao('investimentos');
  const dicaParticipacao = (
    <Dica rotulo={t('Base do percentual', 'Percentage base')}>
      {t(
        'Participação do grupo de natureza (1 Pessoal e encargos sociais ou 4 Investimentos, despesa empenhada) na despesa empenhada total do Anexo I-D, com as intraorçamentárias, no mesmo conjunto de entes. Não é o limite de pessoal da LRF, que usa a receita corrente líquida como base (veja Responsabilidade fiscal).',
        'Share of the expenditure group (1 Personnel and social charges or 4 Investments, committed expenditure) in total committed expenditure in Annex I-D, including intra-budgetary items, in the same set of governments. It is not the Fiscal Responsibility Law personnel limit, which uses net current revenue as the base (see Fiscal responsibility).',
      )}
    </Dica>
  );

  return (
    <>
      <h2 className="titulo-pagina">{t('Visão geral das despesas orçamentárias', 'Budget expenditure overview')}</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · {t('DCA Anexo I-D (despesas orçamentárias por natureza)', 'DCA Annex I-D (budget expenditure by economic category)')}</p>
      <BarraFiltros />
      <Cobertura dominio="despesa" />
      <p className="nota-base">{textoIntraNatureza()}</p>
      <Estado carregando={kpi.carregando} erro={kpi.erro} tentarNovamente={kpi.recarregar} />
      <div className="kpis">
        <Kpi rotulo={t('Despesa empenhada', 'Committed expenditure')} valor={reais(empenhada)}
          nota={t('inclui intraorçamentárias', 'includes intra-budgetary')} />
        <Kpi rotulo={t('Liquidada', 'Accrued')} valor={reais(num(k?.despesa_liquidada))} nota={t('inclui intra', 'includes intra')} />
        <Kpi rotulo={t('Paga', 'Paid')} valor={reais(num(k?.despesa_paga))} nota={t('inclui intra', 'includes intra')} />
        <Kpi rotulo={t('Empenhada per capita', 'Committed per capita')}
          valor={reaisExato(div(empenhada, num(k?.populacao_despesa_empenhada)))}
          dica={f.alvo ? undefined : <Dica rotulo={t('Como é calculado', 'How it is calculated')}>{textoReferencia()}</Dica>} />
        <Kpi rotulo={t('Pessoal: participação na despesa', 'Personnel: share of expenditure')} valor={pct(pessoal.v)} nota={reais(pessoal.n)} dica={dicaParticipacao} />
        <Kpi rotulo={t('Investimentos: participação na despesa', 'Investments: share of expenditure')} valor={pct(investimentos.v)} nota={reais(investimentos.n)} dica={dicaParticipacao} />
      </div>
      {grupos.length > 0 && (
        <CartaoGrafico titulo={t('Grupos de natureza da despesa', 'Expenditure groups')}
          desc={`${dado(coluna ?? '')} · ${t('inclui intraorçamentárias', 'includes intra-budgetary')}`}
          tabela={<TabelaSerie nome="grupos_natureza_despesa" anos={grupos.map((n) => dado(n.descricao))}
            colunas={[{ titulo: t('Valor (R$ correntes)', 'Value (current R$)'), valores: grupos.map((n) => n.valor), formato: reais }]} />}>
          <Grafico opcao={opcao} altura={Math.max(220, grupos.length * 36)} nome="grupos_natureza_despesa" />
        </CartaoGrafico>
      )}
      <section className="cartao">
        <div className="cabeca-cartao">
          <div>
            <h3>{t('Despesas por natureza', 'Expenditure by economic category')}</h3>
            <p className="desc">
              {t(
                'Categoria econômica, grupo de natureza, modalidade de aplicação e elemento, como informados pelo ente; cada nível já contém os de baixo. As linhas “Intra” detalham as intraorçamentárias, já contidas nas despesas correntes e de capital.',
                'Economic category, expenditure group, application modality and element, as reported by the government; each level already contains the ones below. The “Intra” lines detail intra-budgetary items, already included in current and capital expenditure.',
              )}
            </p>
          </div>
          <div className="campo">
            <label htmlFor="col-id">{t('Coluna', 'Column')}</label>
            <select id="col-id" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)}>
              {opcoes.map((c) => <option key={c} value={c}>{dado(c)}</option>)}
            </select>
          </div>
        </div>
        <Estado carregando={arvore.carregando} erro={arvore.erro} tentarNovamente={arvore.recarregar} />
        {arvore.dados && coluna && <ArvoreTabela key={`${f.ano}-${coluna}`} arvore={arvore.dados} anexo="I-D" coluna={coluna} />}
      </section>
    </>
  );
}

const ESTAGIOS = ['Despesas Empenhadas', 'Despesas Liquidadas', 'Despesas Pagas'];
const RECUO = '   ';

/** Classificação da despesa nas páginas de evolução: por função (I-E) ou por natureza (I-D). */
type Classificacao = {
  anexo: string; total: string; nome: string; titulo: () => string; rotuloTotal: () => string; rotuloConta: () => string;
  incluir: (chave: string) => boolean; codigo: (chave: string) => string; nota: () => string; intra: () => string;
};

const POR_FUNCAO: Classificacao = {
  anexo: 'I-E', total: 'TotalExcetoIntra', nome: 'despesa',
  titulo: () => t('Evolução das despesas', 'Expenditure trends'),
  rotuloTotal: () => t('Total (exceto intraorçamentárias)', 'Total (excluding intra-budgetary)'),
  rotuloConta: () => t('Função / subfunção', 'Function / subfunction'),
  incluir: () => true, codigo: (c) => c.replace(/^F/, ''), nota: textoIntra,
  intra: () => t('exceto intraorçamentárias', 'excluding intra-budgetary'),
};

const POR_NATUREZA: Classificacao = {
  anexo: 'I-D', total: 'TotalDespesas', nome: 'despesa_natureza',
  titulo: () => t('Evolução das despesas orçamentárias', 'Budget expenditure trends'),
  rotuloTotal: () => t('Total (inclui intraorçamentárias)', 'Total (includes intra-budgetary)'),
  rotuloConta: () => t('Categoria / grupo de natureza', 'Category / expenditure group'),
  // as linhas DI só detalham a parte intra, já contida nas DO
  incluir: (c) => c.startsWith('DO'), codigo: codigoConta, nota: textoIntraNatureza,
  intra: () => t('inclui intraorçamentárias', 'includes intra-budgetary'),
};

export const DespesasEvolucao = () => <Evolucao c={POR_FUNCAO} />;
export const DespesasNaturezaEvolucao = () => <Evolucao c={POR_NATUREZA} />;

function Evolucao({ c: cl }: { c: Classificacao }) {
  const f = useFiltros();
  const { meta } = useDados();
  const [chave, setChave] = useState(cl.total);
  const [coluna, setColuna] = useState(ESTAGIOS[0]);
  const contas = useApi<{ chave: string; nivel: number; descricao: string; tipo: string }[]>('contas', {
    anexo: cl.anexo, ano: meta.anos.at(-1), nivel_max: 2,
  });
  const opcoes = useMemo(
    () => [{ chave: cl.total, descricao: cl.rotuloTotal() }, ...(contas.dados ?? [])
      .filter((c) => c.tipo === 'conta' && cl.incluir(c.chave))
      .map((c) => ({ chave: c.chave, descricao: `${c.nivel > 1 ? RECUO : ''}${cl.codigo(c.chave)} ${dado(c.descricao)}` }))],
    [contas.dados, cl],
  );
  const { alvo, comp } = useSerie({ anexo: cl.anexo, coluna, chave });
  const s = alvo.dados ?? [];
  const anos = s.map((p) => p.ano);
  const ponto = s.find((p) => p.ano === f.ano);
  const perCapita = (d = s) => d.map((p) => div(p.valor_real, p.populacao));
  const periodo = anos.length ? `${anos[0]}–${anos.at(-1)}` : '';

  const opcaoValores = useMemo(
    () => linhas(anos, [
      { nome: 'Nominal', valores: s.map((p) => p.valor) },
      { nome: t(`Real (R$ de dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((p) => p.valor_real) },
    ], reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados],
  );
  const opcaoPerCapita = useMemo(
    () => linhas(anos, [
      { nome: f.rotulo, valores: perCapita() },
      ...(comp.dados && f.rotuloComparador ? [{ nome: f.rotuloComparador, valores: perCapita(comp.dados) }] : []),
    ], reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [alvo.dados, comp.dados],
  );

  return (
    <>
      <h2 className="titulo-pagina">{cl.titulo()}</h2>
      <p className="subtitulo">{f.rotulo} · {opcoes.find((o) => o.chave === chave)?.descricao.trim()} · {dado(coluna)}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="funcao">{cl.rotuloConta()}</label>
          <select id="funcao" value={chave} onChange={(e) => setChave(e.target.value)} style={{ maxWidth: 420 }}>
            {opcoes.map((o) => <option key={o.chave} value={o.chave}>{o.descricao}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="estagio">{t('Estágio', 'Stage')}</label>
          <select id="estagio" value={coluna} onChange={(e) => setColuna(e.target.value)}>
            {ESTAGIOS.map((c) => <option key={c} value={c}>{dado(c)}</option>)}
          </select>
        </div>
      </div>
      <p className="nota-base">{cl.nota()}</p>
      <h3 className="secao">{t(`Exercício de referência: ${f.ano}`, `Reference year: ${f.ano}`)}</h3>
      <div className="kpis">
        <Kpi rotulo={t(`Valor nominal em ${f.ano}`, `Nominal value in ${f.ano}`)} valor={reais(ponto?.valor)} />
        <Kpi rotulo={t(`Real (R$ de dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`)} valor={reais(ponto?.valor_real)} />
        <Kpi rotulo={t('Per capita (real)', 'Per capita (real)')} valor={reaisExato(div(ponto?.valor_real, ponto?.populacao))}
          nota={f.alvo || !ponto ? undefined : `${numero(ponto.entes)} ${t('entes no exercício', 'governments in the year')}`} />
      </div>
      <Estado carregando={alvo.carregando} erro={alvo.erro} tentarNovamente={alvo.recarregar} />
      {s.length > 0 && (
        <>
          <h3 className="secao">{t(`Série completa: ${periodo}`, `Full series: ${periodo}`)}</h3>
          <div className="grade-2">
            <CartaoGrafico titulo={t('Valor por exercício', 'Value by fiscal year')} desc={t('Nominal e corrigido pelo IPCA', 'Nominal and adjusted by the IPCA')}
              tabela={<TabelaSerie nome={`${cl.nome}_${chave}`} anos={anos} colunas={[
                { titulo: t('Nominal (R$ correntes)', 'Nominal (current R$)'), valores: s.map((p) => p.valor), formato: reais },
                { titulo: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((p) => p.valor_real), formato: reais },
                ...(f.alvo ? [] : [
                  { titulo: t('Entes com dados', 'Governments with data'), valores: s.map((p) => p.entes), formato: numero },
                  { titulo: t('Excluídos pelo filtro', 'Excluded by filter'), valores: s.map((p) => p.excluidos), formato: numero },
                ]),
              ]} metadados={[[t('Intraorçamentárias', 'Intra-budgetary'), cl.intra()]]} />}>
              <Grafico opcao={opcaoValores} nome={`${cl.nome}_${chave}`} />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Per capita (real)', 'Per capita (real)')}
              desc={f.rotuloComparador ? t(`Comparado com ${f.rotuloComparador}`, `Compared with ${f.rotuloComparador}`) : undefined}
              acoes={f.rotuloComparador ? <Dica rotulo={t('Referência', 'Reference')}>{textoReferencia()}</Dica> : undefined}
              tabela={<TabelaSerie nome={`${cl.nome}_per_capita_${chave}`} anos={anos} colunas={[
                { titulo: f.rotulo, valores: perCapita(), formato: reaisExato },
                { titulo: f.rotuloComparador ?? '', valores: comp.dados ? perCapita(comp.dados) : [], formato: reaisExato },
              ]} />}>
              <Grafico opcao={opcaoPerCapita} nome={`${cl.nome}_per_capita_${chave}`} />
            </CartaoGrafico>
          </div>
        </>
      )}
    </>
  );
}
