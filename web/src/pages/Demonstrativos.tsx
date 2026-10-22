import { useApi, type Arvore } from '../api';
import { ArvoreTabela } from '../components/ArvoreTabela';
import { Estado } from '../components/Kpi';
import { BarraFiltros, useFiltros } from '../contexto';
import { useColuna } from '../hooks';
import { useSearchParams } from 'react-router-dom';

export const ANEXOS: Record<string, string> = {
  'I-AB': 'Balanço patrimonial',
  'I-C': 'Receitas orçamentárias',
  'I-D': 'Despesas por natureza',
  'I-E': 'Despesas por função',
  'I-F': 'Restos a pagar por natureza',
  'I-G': 'Restos a pagar por função',
  'I-HI': 'Variações patrimoniais',
};

export function Demonstrativos() {
  const f = useFiltros();
  const [busca, setBusca] = useSearchParams();
  const anexo = ANEXOS[busca.get('anexo') ?? ''] ? busca.get('anexo')! : 'I-AB';
  const { coluna, setColuna, opcoes } = useColuna(anexo, f.ano);
  const arvore = useApi<Arvore>(coluna ? 'arvore' : null, { anexo, ano: f.ano, coluna, ...f.escopo });

  return (
    <>
      <h2 className="titulo-pagina">Demonstrativos da DCA</h2>
      <p className="subtitulo">{f.rotulo} · {f.ano} · Anexo {anexo} — {ANEXOS[anexo]}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="anexo">Anexo</label>
          <select id="anexo" value={anexo} onChange={(e) => {
            const p = new URLSearchParams(busca);
            p.set('anexo', e.target.value);
            setBusca(p, { replace: true });
          }}>
            {Object.entries(ANEXOS).map(([k, v]) => <option key={k} value={k}>{k} · {v}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="coluna">Coluna</label>
          <select id="coluna" value={coluna ?? ''} onChange={(e) => setColuna(e.target.value)} style={{ maxWidth: 420 }}>
            {opcoes.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {anexo === 'I-AB' && (
        <p className="aviso">Contas marcadas com “(-)” são redutoras: aparecem com valor positivo e são subtraídas do grupo.</p>
      )}
      {anexo === 'I-D' && (
        <p className="aviso">As linhas “Intra” detalham as despesas intra-orçamentárias, que já estão contidas nas despesas correntes e de capital.</p>
      )}
      <section className="cartao">
        <Estado carregando={arvore.carregando} erro={arvore.erro} />
        {arvore.dados && <ArvoreTabela key={`${anexo}-${f.ano}-${coluna}`} arvore={arvore.dados} />}
      </section>
    </>
  );
}
