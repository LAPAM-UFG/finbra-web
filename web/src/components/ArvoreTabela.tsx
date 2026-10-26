import { useMemo, useState } from 'react';
import type { Arvore, No } from '../api';
import { basesAV, caminho, codigoConta } from '../calculos';
import { div, pct, reais, reaisExato } from '../format';
import { dado, t } from '../idioma';
import { Dica } from './Dica';
import { BotoesExportar, useMetadados, type Celula } from './Exportar';

/** Texto da base da análise vertical por anexo (cabeçalho e exportação). */
export function textoBaseAV(anexo: string) {
  if (anexo === 'I-AB') {
    return t(
      'Cada lado do balanço é a sua própria base: as contas do Ativo são % do Ativo total; as do Passivo e do Patrimônio Líquido, % do Passivo + PL. Os dois lados não são somados.',
      'Each side of the balance sheet is its own base: Asset accounts are % of total Assets; Liability and Equity accounts, % of Liabilities + Equity. The two sides are not added together.',
    );
  }
  if (anexo === 'I-HI') {
    return t(
      'Variações aumentativas e diminutivas: cada grupo é a sua própria base (contas de VPA em % do total de VPA; de VPD em % do total de VPD).',
      'Increasing and decreasing variations: each group is its own base (VPA accounts as % of total VPA; VPD accounts as % of total VPD).',
    );
  }
  if (anexo === 'I-D' || anexo === 'I-F') {
    return t(
      'Base: total da coluna (despesas correntes + de capital). As linhas “Intra” detalham operações intraorçamentárias já contidas nesse total e não entram de novo na base.',
      'Base: column total (current + capital expenditure). “Intra” lines detail intra-budgetary operations already included in that total and are not added to the base again.',
    );
  }
  if (anexo === 'I-C') {
    return t(
      'Base: total da coluna, incluindo as receitas intraorçamentárias (linhas “Intra”).',
      'Base: column total, including intra-budgetary revenue (“Intra” lines).',
    );
  }
  return t(
    'Base: soma das funções da coluna, que exclui as despesas intraorçamentárias.',
    'Base: sum of the functions in the column, which excludes intra-budgetary expenditure.',
  );
}

/**
 * Matriz hierárquica: valor informado pelo ente em cada nó, % da análise vertical na base do anexo,
 * per capita e as mesmas medidas no comparador (UF ou Brasil).
 */
export function ArvoreTabela({ arvore, anexo, coluna, nivelInicial = 1 }: {
  arvore: Arvore; anexo: string; coluna: string; nivelInicial?: number;
}) {
  const { nos, populacao, populacao_comp, comparador } = arvore;
  const contas = useMemo(() => nos.filter((n) => n.tipo === 'conta'), [nos]);
  const totais = useMemo(() => nos.filter((n) => n.tipo === 'total'), [nos]);
  const metadados = useMetadados();
  const [busca, setBusca] = useState('');
  const [soMovimento, setSoMovimento] = useState(false);
  const [exato, setExato] = useState<string | null>(null);

  const presentes = useMemo(() => new Set(contas.map((c) => c.chave)), [contas]);
  const paiDe = useMemo(
    () => new Map(contas.map((n) => [n.chave, n.chave_pai && presentes.has(n.chave_pai) ? n.chave_pai : null])),
    [contas, presentes],
  );
  const porChave = useMemo(() => new Map(contas.map((n) => [n.chave, n])), [contas]);
  const filhos = useMemo(() => {
    const m = new Map<string | null, No[]>();
    for (const n of contas) {
      const pai = paiDe.get(n.chave) ?? null;
      m.set(pai, [...(m.get(pai) ?? []), n]);
    }
    return m;
  }, [contas, paiDe]);
  const base = useMemo(
    () => basesAV(anexo, contas, (chave) => dado(porChave.get(chave)?.descricao ?? chave)),
    [anexo, contas, porChave],
  );

  const [abertos, setAbertos] = useState<Set<string>>(
    () => new Set(contas.filter((n) => n.nivel < nivelInicial).map((n) => n.chave)),
  );
  const alternar = (chave: string) =>
    setAbertos((a) => {
      const novo = new Set(a);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  const abrirAte = (nivel: number) => setAbertos(new Set(contas.filter((n) => n.nivel < nivel).map((n) => n.chave)));
  const niveis = Math.max(1, ...contas.map((n) => n.nivel));

  // Busca por código ou descrição: mostra as contas que casam e os ancestrais, para manter a hierarquia
  const termo = busca.trim().toLowerCase();
  const visiveisBusca = useMemo(() => {
    if (!termo) return null;
    const ok = new Set<string>();
    for (const n of contas) {
      const alvo = `${codigoConta(n.chave)} ${dado(n.descricao)} ${n.descricao}`.toLowerCase();
      if (alvo.includes(termo)) {
        ok.add(n.chave);
        for (const a of caminho(n.chave, paiDe)) ok.add(a);
      }
    }
    return ok;
  }, [termo, contas, paiDe]);
  const temMovimento = (n: No) => (n.valor !== null && n.valor !== 0) || (n.valor_comp !== null && n.valor_comp !== 0);

  const linhas: { no: No; profundidade: number }[] = [];
  const visitar = (pai: string | null, profundidade: number) => {
    for (const no of filhos.get(pai) ?? []) {
      if (visiveisBusca && !visiveisBusca.has(no.chave)) continue;
      if (soMovimento && !temMovimento(no)) continue;
      linhas.push({ no, profundidade });
      if (visiveisBusca || abertos.has(no.chave)) visitar(no.chave, profundidade + 1);
    }
  };
  visitar(null, 0);

  const obterTabela = () => {
    const cols = [t('Código', 'Code'), t('Chave', 'Key'), t('Conta', 'Account'), t('Conta-mãe', 'Parent account'), t('Nível', 'Level'),
      t('Valor (R$ correntes)', 'Value (current R$)'), t('Calculada pela soma das subcontas', 'Computed from sub-accounts'),
      t('Base da AV', 'VA base'), t('Valor da base', 'Base value'), t('% AV', '% VA'), t('Per capita', 'Per capita')];
    if (comparador) cols.push(`${t('Valor', 'Value')} · ${comparador}`, `Per capita · ${comparador}`, `${t('% AV', '% VA')} · ${comparador}`);
    const linhasCsv: Celula[][] = contas.map((n) => {
      const b = base(n);
      const l: Celula[] = [codigoConta(n.chave), n.chave, dado(n.descricao), paiDe.get(n.chave) ?? '', n.nivel, n.valor,
        n.sintetico ? t('sim', 'yes') : t('não', 'no'), b.rotulo || t('total da coluna', 'column total'), b.valor,
        div(n.valor, b.valor), div(n.valor, populacao)];
      if (comparador) l.push(n.valor_comp, div(n.valor_comp, populacao_comp), div(n.valor_comp, b.valor_comp));
      return l;
    });
    for (const n of totais) linhasCsv.push(['', n.chave, `${t('[linha de total]', '[total line]')} ${dado(n.descricao)}`, '', '', n.valor, '', '', '', '', '']);
    return {
      colunas: cols,
      linhas: linhasCsv,
      metadados: metadados([
        [t('Anexo', 'Annex'), anexo], [t('Coluna', 'Column'), dado(coluna)], [t('Base da análise vertical', 'Vertical analysis base'), textoBaseAV(anexo)],
        [t('Conteúdo', 'Content'), t('todas as contas da consulta (não só as expandidas); cada linha é o valor declarado naquele nível — não some níveis diferentes', 'every account in the query (not only expanded ones); each line is the value reported at that level — do not add different levels')],
        [t('População', 'Population'), String(populacao ?? '')],
      ]),
    };
  };

  if (!contas.length) return <p className="vazio">{t('Nenhuma conta declarada para este filtro.', 'No accounts reported for this filter.')}</p>;
  const valorCelula = (n: No, v: number | null, k: string) => (
    <button className="valor-exato" onClick={() => setExato(exato === k ? null : k)} aria-label={reaisExato(v)}>
      {exato === k ? reaisExato(v) : reais(v)}
    </button>
  );
  return (
    <>
      <div className="ferramentas-arvore">
        <div className="campo">
          <label htmlFor={`busca-${anexo}`}>{t('Buscar conta (código ou descrição)', 'Find account (code or description)')}</label>
          <input id={`busca-${anexo}`} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="1.7.1.1 / FPM…" />
        </div>
        <label className="caixa">
          <input type="checkbox" checked={soMovimento} onChange={(e) => setSoMovimento(e.target.checked)} />
          {t('Só contas com movimento (valor diferente de zero)', 'Only accounts with activity (non-zero value)')}
        </label>
        <div className="alternar" role="group" aria-label={t('Expandir até o nível', 'Expand to level')}>
          {Array.from({ length: Math.min(niveis, 6) }, (_, i) => (
            <button key={i} onClick={() => abrirAte(i + 1)}>{t('Nível', 'Level')} {i + 1}</button>
          ))}
          <button onClick={() => abrirAte(99)}>{t('Tudo', 'All')}</button>
        </div>
        <BotoesExportar nome={`${anexo}_${coluna}`} obter={obterTabela} />
      </div>
      <div className="rolagem">
        <table className="arvore">
          <caption className="sr-only">{t('Contas do demonstrativo', 'Statement accounts')}</caption>
          <thead>
            <tr>
              <th>{t('Código', 'Code')}</th>
              <th>{t('Conta', 'Account')}</th>
              <th>{t('Valor', 'Value')}</th>
              <th>{t('% AV', '% VA')} <Dica rotulo={t('Base da análise vertical', 'Vertical analysis base')}>{textoBaseAV(anexo)}</Dica></th>
              <th>Per capita</th>
              {comparador && <th>Per capita · {comparador}</th>}
              {comparador && <th>{t('% AV', '% VA')} · {comparador}</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ no, profundidade }) => {
              const temFilhos = filhos.has(no.chave);
              const b = base(no);
              const av = div(no.valor, b.valor);
              return (
                <tr key={no.chave} className={profundidade === 0 ? 'n1' : undefined}>
                  <td className="codigo">{codigoConta(no.chave)}</td>
                  <td style={{ paddingLeft: 8 + profundidade * 18 }}>
                    {temFilhos && !visiveisBusca ? (
                      <button className="abrir" onClick={() => alternar(no.chave)} aria-expanded={abertos.has(no.chave)}
                        aria-label={`${abertos.has(no.chave) ? t('Recolher', 'Collapse') : t('Expandir', 'Expand')}: ${dado(no.descricao)}`}>
                        {abertos.has(no.chave) ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span style={{ display: 'inline-block', width: 18 }} />
                    )}
                    {no.chave.startsWith('RI') || no.chave.startsWith('DI') ? 'Intra · ' : ''}
                    {dado(no.descricao)}
                    {no.sintetico && (
                      <span className="sint">
                        {t('(soma)', '(sum)')}
                        <Dica rotulo={t('Conta calculada', 'Computed account')}>
                          {t('O ente não informou esta conta; o valor é a soma das subcontas que ele informou.', 'The government did not report this account; the value is the sum of the sub-accounts it reported.')}
                        </Dica>
                      </span>
                    )}
                  </td>
                  <td>{no.valor === null ? <span title={t('não declarado', 'not reported')}>n.d.</span> : valorCelula(no, no.valor, no.chave)}</td>
                  <td>
                    {av !== null && <span className="barra-av" style={{ width: Math.max(1, Math.min(60, Math.abs(av) * 60)) }} />}
                    {pct(av)}
                  </td>
                  <td>{reaisExato(div(no.valor, populacao))}</td>
                  {comparador && <td>{no.valor_comp === null ? 'n.d.' : reaisExato(div(no.valor_comp, populacao_comp))}</td>}
                  {comparador && <td>{pct(div(no.valor_comp, b.valor_comp))}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="legenda-tabela">
        {t('n.d. = não declarado pelo ente; – = não se aplica ou sem base de cálculo. Toque no valor para ver o número completo.',
          'n.d. = not reported by the government; – = not applicable or no base for the calculation. Tap a value to see the full number.')}
        {visiveisBusca && ` ${t('Busca: contas encontradas e as contas-mãe delas.', 'Search: matching accounts and their parent accounts.')}`}
      </p>
      {totais.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--tinta-2)' }}>
            {t('Linhas de total declaradas no demonstrativo', 'Total lines reported in the statement')}
          </summary>
          <table style={{ marginTop: 6 }}>
            <tbody>
              {totais.map((n) => (
                <tr key={n.chave}>
                  <td>{dado(n.descricao)}</td>
                  <td>{reais(n.valor)}</td>
                  {comparador && <td>{reais(n.valor_comp)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
