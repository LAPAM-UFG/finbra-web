import { useMemo, useState } from 'react';
import { useApi } from '../api';
import { barras, CartaoGrafico, Grafico } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { BarraFiltros, useFiltros } from '../contexto';
import { numero, reais, reaisCurto, reaisExato } from '../format';

const INDICADORES: Record<string, string> = {
  receita_bruta: 'Receita bruta',
  receita_corrente: 'Receita corrente',
  receita_impostos_taxas: 'Impostos, taxas e contribuições',
  fpm: 'FPM',
  icms: 'Cota-parte do ICMS',
  iptu: 'IPTU',
  iss: 'ISS',
  itbi: 'ITBI',
  despesa_empenhada: 'Despesa empenhada',
  despesa_saude: 'Despesa com saúde',
  despesa_educacao: 'Despesa com educação',
  investimentos: 'Investimentos',
  despesa_pessoal: 'Despesa com pessoal',
  pib: 'PIB',
};

type Item = { cod_ibge: number; nome: string; uf: string; populacao: number; valor: number; indicador: number };

export function Rankings() {
  const f = useFiltros();
  const [campo, setCampo] = useState('receita_bruta');
  const [perCapita, setPerCapita] = useState(true);
  const [ordem, setOrdem] = useState<'desc' | 'asc'>('desc');
  const r = useApi<Item[]>('ranking', {
    campo, ano: f.ano, uf: f.uf ?? undefined, esfera: 'M', per_capita: perCapita ? 1 : 0, ordem, limite: 20,
  });
  const itens = r.dados ?? [];
  const fmt = perCapita ? reaisExato : reaisCurto;
  const opcao = useMemo(
    () => barras(itens.map((i) => `${i.nome} (${i.uf})`), itens.map((i) => i.indicador), perCapita ? reaisCurto : reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r.dados],
  );

  return (
    <>
      <h2 className="titulo-pagina">Rankings de municípios</h2>
      <p className="subtitulo">{f.uf ? `Municípios de ${f.uf}` : 'Todos os municípios'} · {f.ano}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="ind">Indicador</label>
          <select id="ind" value={campo} onChange={(e) => setCampo(e.target.value)}>
            {Object.entries(INDICADORES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="alternar" role="group" aria-label="Medida">
          <button className={perCapita ? 'ativo' : ''} onClick={() => setPerCapita(true)}>Per capita</button>
          <button className={!perCapita ? 'ativo' : ''} onClick={() => setPerCapita(false)}>Total</button>
        </div>
        <div className="alternar" role="group" aria-label="Ordem">
          <button className={ordem === 'desc' ? 'ativo' : ''} onClick={() => setOrdem('desc')}>Maiores</button>
          <button className={ordem === 'asc' ? 'ativo' : ''} onClick={() => setOrdem('asc')}>Menores</button>
        </div>
      </div>
      <Estado carregando={r.carregando} erro={r.erro} vazio={!r.carregando && !itens.length} />
      {itens.length > 0 && (
        <CartaoGrafico
          titulo={`${ordem === 'desc' ? 'Maiores' : 'Menores'} · ${INDICADORES[campo]}${perCapita ? ' per capita' : ''}`}
          tabela={
            <table>
              <thead><tr><th>Município</th><th>UF</th><th>População</th><th>Valor</th><th>Per capita</th></tr></thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.cod_ibge}>
                    <td>{i.nome}</td><td>{i.uf}</td><td>{numero(i.populacao)}</td><td>{reais(i.valor)}</td>
                    <td>{reaisExato(i.valor / i.populacao)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <Grafico opcao={opcao} altura={itens.length * 28 + 20} />
          <p className="desc" style={{ marginTop: 8 }}>Valores em {fmt === reaisExato ? 'R$ por habitante' : 'R$'}.</p>
        </CartaoGrafico>
      )}
    </>
  );
}
