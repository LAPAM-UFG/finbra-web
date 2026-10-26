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

const TOTAL = 'TotalExcetoIntra';
const ESTAGIOS = ['Despesas Empenhadas', 'Despesas Liquidadas', 'Despesas Pagas'];

export function DespesasEvolucao() {
  const f = useFiltros();
  const { meta } = useDados();
  const [chave, setChave] = useState(TOTAL);
  const [coluna, setColuna] = useState(ESTAGIOS[0]);
  const contas = useApi<{ chave: string; nivel: number; descricao: string; tipo: string }[]>('contas', {
    anexo: 'I-E', ano: meta.anos.at(-1), nivel_max: 2,
  });
  const opcoes = useMemo(
    () => [{ chave: TOTAL, descricao: t('Total (exceto intraorçamentárias)', 'Total (excluding intra-budgetary)') }, ...(contas.dados ?? [])
      .filter((c) => c.tipo === 'conta')
      .map((c) => ({ chave: c.chave, descricao: `${c.nivel > 1 ? '   ' : ''}${c.chave.replace(/^F/, '')} ${dado(c.descricao)}` }))],
    [contas.dados],
  );
  const { alvo, comp } = useSerie({ anexo: 'I-E', coluna, chave });
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
      <h2 className="titulo-pagina">{t('Evolução das despesas', 'Expenditure trends')}</h2>
      <p className="subtitulo">{f.rotulo} · {opcoes.find((o) => o.chave === chave)?.descricao.trim()} · {dado(coluna)}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="funcao">{t('Função / subfunção', 'Function / subfunction')}</label>
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
      <p className="nota-base">{textoIntra()}</p>
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
              tabela={<TabelaSerie nome={`despesa_${chave}`} anos={anos} colunas={[
                { titulo: t('Nominal (R$ correntes)', 'Nominal (current R$)'), valores: s.map((p) => p.valor), formato: reais },
                { titulo: t(`Real (R$ dez/${meta.baseIpca})`, `Real (Dec/${meta.baseIpca} R$)`), valores: s.map((p) => p.valor_real), formato: reais },
                ...(f.alvo ? [] : [
                  { titulo: t('Entes com dados', 'Governments with data'), valores: s.map((p) => p.entes), formato: numero },
                  { titulo: t('Excluídos pelo filtro', 'Excluded by filter'), valores: s.map((p) => p.excluidos), formato: numero },
                ]),
              ]} metadados={[[t('Intraorçamentárias', 'Intra-budgetary'), t('exceto intraorçamentárias', 'excluding intra-budgetary')]]} />}>
              <Grafico opcao={opcaoValores} nome={`despesa_${chave}`} />
            </CartaoGrafico>
            <CartaoGrafico titulo={t('Per capita (real)', 'Per capita (real)')}
              desc={f.rotuloComparador ? t(`Comparado com ${f.rotuloComparador}`, `Compared with ${f.rotuloComparador}`) : undefined}
              acoes={f.rotuloComparador ? <Dica rotulo={t('Referência', 'Reference')}>{textoReferencia()}</Dica> : undefined}
              tabela={<TabelaSerie nome={`despesa_per_capita_${chave}`} anos={anos} colunas={[
                { titulo: f.rotulo, valores: perCapita(), formato: reaisExato },
                { titulo: f.rotuloComparador ?? '', valores: comp.dados ? perCapita(comp.dados) : [], formato: reaisExato },
              ]} />}>
              <Grafico opcao={opcaoPerCapita} nome={`despesa_per_capita_${chave}`} />
            </CartaoGrafico>
          </div>
        </>
      )}
    </>
  );
}
