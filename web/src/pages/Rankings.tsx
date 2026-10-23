import { useMemo, useState } from 'react';
import { useApi } from '../api';
import { barras, CartaoGrafico, Grafico } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { BarraFiltros, useFiltros } from '../contexto';
import { numero, reais, reaisCurto, reaisExato } from '../format';
import { t } from '../idioma';

const indicadores = (): Record<string, string> => ({
  receita_bruta: t('Receita bruta', 'Gross revenue'),
  receita_corrente: t('Receita corrente', 'Current revenue'),
  receita_impostos_taxas: t('Impostos, taxas e contribuições', 'Taxes, fees and contributions'),
  fpm: 'FPM',
  icms: t('Cota-parte do ICMS', 'ICMS share'),
  iptu: 'IPTU',
  iss: 'ISS',
  itbi: 'ITBI',
  despesa_empenhada: t('Despesa empenhada', 'Committed expenditure'),
  despesa_saude: t('Despesa com saúde', 'Health expenditure'),
  despesa_educacao: t('Despesa com educação', 'Education expenditure'),
  investimentos: t('Investimentos', 'Investments'),
  despesa_pessoal: t('Despesa com pessoal', 'Personnel expenditure'),
  pib: t('PIB', 'GDP'),
});

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
  const nomes = indicadores();
  const opcao = useMemo(
    () => barras(itens.map((i) => `${i.nome} (${i.uf})`), itens.map((i) => i.indicador), reaisCurto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [r.dados],
  );
  const maiores = t('Maiores', 'Highest');
  const menores = t('Menores', 'Lowest');

  return (
    <>
      <h2 className="titulo-pagina">{t('Rankings de municípios', 'Municipal rankings')}</h2>
      <p className="subtitulo">{f.uf ? t(`Municípios de ${f.uf}`, `Municipalities in ${f.uf}`) : t('Todos os municípios', 'All municipalities')} · {f.ano}</p>
      <BarraFiltros />
      <div className="filtros">
        <div className="campo">
          <label htmlFor="ind">{t('Indicador', 'Indicator')}</label>
          <select id="ind" value={campo} onChange={(e) => setCampo(e.target.value)}>
            {Object.entries(nomes).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="alternar" role="group" aria-label={t('Medida', 'Measure')}>
          <button className={perCapita ? 'ativo' : ''} onClick={() => setPerCapita(true)}>Per capita</button>
          <button className={!perCapita ? 'ativo' : ''} onClick={() => setPerCapita(false)}>Total</button>
        </div>
        <div className="alternar" role="group" aria-label={t('Ordem', 'Order')}>
          <button className={ordem === 'desc' ? 'ativo' : ''} onClick={() => setOrdem('desc')}>{maiores}</button>
          <button className={ordem === 'asc' ? 'ativo' : ''} onClick={() => setOrdem('asc')}>{menores}</button>
        </div>
      </div>
      <Estado carregando={r.carregando} erro={r.erro} vazio={!r.carregando && !itens.length} />
      {itens.length > 0 && (
        <CartaoGrafico
          titulo={`${ordem === 'desc' ? maiores : menores} · ${nomes[campo]}${perCapita ? ' per capita' : ''}`}
          tabela={
            <table>
              <thead>
                <tr>
                  <th>{t('Município', 'Municipality')}</th><th>{t('UF', 'State')}</th><th>{t('População', 'Population')}</th>
                  <th>{t('Valor', 'Value')}</th><th>Per capita</th>
                </tr>
              </thead>
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
          <p className="desc" style={{ marginTop: 8 }}>
            {perCapita ? t('Valores em R$ por habitante.', 'Values in R$ per inhabitant.') : t('Valores em R$.', 'Values in R$.')}
          </p>
        </CartaoGrafico>
      )}
    </>
  );
}
