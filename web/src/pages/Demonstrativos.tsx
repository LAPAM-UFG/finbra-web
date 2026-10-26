import { useApi, type Arvore } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { Estado } from '../components/Kpi';
import { BarraFiltros, Cobertura, useFiltros } from '../contexto';
import { useColuna } from '../hooks';
import { dado, idioma, t } from '../idioma';
import { useSearchParams } from 'react-router-dom';

export const anexos = (): Record<string, string> => ({
  'I-AB': t('Balanço patrimonial', 'Balance sheet'),
  'I-C': t('Receitas orçamentárias', 'Budget revenue'),
  'I-D': t('Despesas por natureza', 'Expenditure by economic category'),
  'I-E': t('Despesas por função', 'Expenditure by function'),
  'I-F': t('Restos a pagar por natureza', 'Carry-over payables by economic category'),
  'I-G': t('Restos a pagar por função', 'Carry-over payables by function'),
  'I-HI': t('Variações patrimoniais', 'Changes in net equity'),
});

export function Demonstrativos() {
  const f = useFiltros();
  const [busca, setBusca] = useSearchParams();
  const nomes = anexos();
  const anexo = nomes[busca.get('anexo') ?? ''] ? busca.get('anexo')! : 'I-AB';
  const { coluna, setColuna, opcoes } = useColuna(anexo, f.ano);
  const arvore = useApi<Arvore>(coluna ? 'arvore' : null, { anexo, ano: f.ano, coluna, ...f.escopo });

  return (
    <>
      <h2 className="titulo-pagina">{t('Demonstrativos da DCA', 'DCA financial statements')}</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · {t('Anexo', 'Annex')} {anexo} — {nomes[anexo]}</p>
      <BarraFiltros />
      <Cobertura dominio={anexo === 'I-C' ? 'receita' : anexo === 'I-AB' || anexo === 'I-HI' ? 'patrimonio' : 'despesa'} />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="anexo">{t('Anexo', 'Annex')}</label>
          <select id="anexo" value={anexo} onChange={(e) => {
            const p = new URLSearchParams(busca);
            p.set('anexo', e.target.value);
            setBusca(p, { replace: true });
          }}>
            {Object.entries(nomes).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="coluna">{t('Coluna', 'Column')}</label>
          <select id="coluna" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)} style={{ maxWidth: 420 }}>
            {opcoes.map((c) => <option key={c} value={c}>{dado(c)}</option>)}
          </select>
        </div>
      </div>
      {idioma() === 'en' && (
        <p className="aviso">
          The National Treasury publishes the chart of accounts in Portuguese only. Account names were translated by LAPAM for
          reference; the official names are the Portuguese ones.
        </p>
      )}
      {anexo === 'I-AB' && (
        <p className="aviso">
          {t(
            'Contas marcadas com “(-)” são redutoras: aparecem com valor positivo e são subtraídas do grupo.',
            'Accounts marked “(-)” are contra accounts: they appear with a positive value and are subtracted from the group.',
          )}
        </p>
      )}
      {anexo === 'I-D' && (
        <p className="aviso">
          {t(
            'As linhas “Intra” detalham as despesas intra-orçamentárias, que já estão contidas nas despesas correntes e de capital.',
            'The “Intra” lines detail intra-budgetary expenditure, which is already included in current and capital expenditure.',
          )}
        </p>
      )}
      <section className="cartao">
        <Estado carregando={arvore.carregando} erro={arvore.erro} tentarNovamente={arvore.recarregar} />
        {arvore.dados && coluna && <ArvoreTabela key={`${anexo}-${f.ano}-${coluna}`} arvore={arvore.dados} anexo={anexo} coluna={coluna} />}
      </section>
    </>
  );
}
