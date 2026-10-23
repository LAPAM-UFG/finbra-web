import { useMemo, useState } from 'react';
import type { Arvore, No } from '../api';
import { div, pct, reais, reaisExato } from '../format';
import { dado, t } from '../idioma';

/**
 * Matriz hierárquica (como a do Power BI): valor informado pelo ente em cada nó,
 * % da análise vertical, per capita e as mesmas medidas no comparador (UF ou Brasil).
 */
export function ArvoreTabela({ arvore, nivelInicial = 1 }: { arvore: Arvore; nivelInicial?: number }) {
  const { nos, populacao, populacao_comp, comparador } = arvore;
  const contas = useMemo(() => nos.filter((n) => n.tipo === 'conta'), [nos]);
  const totais = useMemo(() => nos.filter((n) => n.tipo === 'total'), [nos]);

  const filhos = useMemo(() => {
    const m = new Map<string | null, No[]>();
    const presentes = new Set(contas.map((c) => c.chave));
    for (const n of contas) {
      const pai = n.chave_pai && presentes.has(n.chave_pai) ? n.chave_pai : null;
      m.set(pai, [...(m.get(pai) ?? []), n]);
    }
    return m;
  }, [contas]);

  // Base da análise vertical: soma das raízes (sem o detalhamento intra "DI", já contido em "DO")
  const raizes = (filhos.get(null) ?? []).filter((n) => !n.chave.startsWith('DI'));
  const base = raizes.reduce((s, n) => s + (n.valor ?? 0), 0);
  const baseComp = raizes.reduce((s, n) => s + (n.valor_comp ?? 0), 0);

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

  const linhas: { no: No; profundidade: number }[] = [];
  const visitar = (pai: string | null, profundidade: number) => {
    for (const no of filhos.get(pai) ?? []) {
      linhas.push({ no, profundidade });
      if (abertos.has(no.chave)) visitar(no.chave, profundidade + 1);
    }
  };
  visitar(null, 0);

  const abrirTudo = () => setAbertos(new Set(contas.map((n) => n.chave)));
  const fecharTudo = () => setAbertos(new Set());

  if (!contas.length) return <p className="vazio">{t('Sem dados para este filtro.', 'No data for this filter.')}</p>;
  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="limpar" onClick={abrirTudo}>{t('expandir tudo', 'expand all')}</button>
        <button className="limpar" onClick={fecharTudo}>{t('recolher tudo', 'collapse all')}</button>
      </div>
      <div className="rolagem">
        <table className="arvore">
          <thead>
            <tr>
              <th>{t('Conta', 'Account')}</th>
              <th>{t('Valor', 'Value')}</th>
              <th className="dica" title={t('Análise vertical: participação no total da coluna', 'Vertical analysis: share of the column total')}>
                {t('% AV', '% VA')}
              </th>
              <th>Per capita</th>
              {comparador && <th>Per capita · {comparador}</th>}
              {comparador && <th>{t('% AV', '% VA')} · {comparador}</th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map(({ no, profundidade }) => {
              const temFilhos = filhos.has(no.chave);
              const av = div(no.valor, base);
              return (
                <tr key={no.chave} className={profundidade === 0 ? 'n1' : undefined}>
                  <td style={{ paddingLeft: 8 + profundidade * 18 }}>
                    {temFilhos ? (
                      <button className="abrir" onClick={() => alternar(no.chave)} aria-expanded={abertos.has(no.chave)}
                        aria-label={abertos.has(no.chave) ? t('Recolher', 'Collapse') : t('Expandir', 'Expand')}>
                        {abertos.has(no.chave) ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span style={{ display: 'inline-block', width: 18 }} />
                    )}
                    {no.chave.startsWith('RI') || no.chave.startsWith('DI') ? 'Intra · ' : ''}
                    {dado(no.descricao)}
                    {no.sintetico && (
                      <span className="sint" title={t('O ente não informou esta conta; valor = soma das subcontas.', 'The government did not report this account; value = sum of sub-accounts.')}>
                        {t('(soma)', '(sum)')}
                      </span>
                    )}
                  </td>
                  <td title={reaisExato(no.valor)}>{reais(no.valor)}</td>
                  <td>
                    {av !== null && <span className="barra-av" style={{ width: Math.max(1, Math.min(60, Math.abs(av) * 60)) }} />}
                    {pct(av)}
                  </td>
                  <td>{reaisExato(div(no.valor, populacao))}</td>
                  {comparador && <td>{reaisExato(div(no.valor_comp, populacao_comp))}</td>}
                  {comparador && <td>{pct(div(no.valor_comp, baseComp))}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
