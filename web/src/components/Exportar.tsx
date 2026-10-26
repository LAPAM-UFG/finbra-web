import { useState } from 'react';
import { useDados, useFiltros } from '../contexto';
import { exportar, type Celula, type Tabela } from '../exportar';
import { idioma, t } from '../idioma';

/** Metadados comuns às exportações: fonte, recorte, tratamento, preços e datas. */
export function useMetadados() {
  const { meta } = useDados();
  const f = useFiltros();
  return (extra: [string, string][] = []): [string, string][] => [
    [t('Fonte', 'Source'), t('SICONFI/Tesouro Nacional (DCA); IBGE (PIB); Banco Central (IPCA). Processamento: LAPAM/UFG', 'SICONFI/National Treasury (DCA); IBGE (GDP); Central Bank of Brazil (IPCA). Processing: LAPAM/UFG')],
    [t('Recorte', 'Scope'), f.rotulo],
    [t('Exercício selecionado', 'Selected fiscal year'), String(f.ano)],
    [t('Tratamento dos agregados', 'Aggregate treatment'), f.alvo
      ? t('valores do ente como declarados', 'the government’s values as reported')
      : t('totais sem as inconsistências objetivas (> 10× a mediana real do ente e acima do PIB municipal) e erros confirmados, só no domínio afetado; suspeitas estatísticas incluídas', 'totals without objective inconsistencies (> 10× the government’s real median and above municipal GDP) and confirmed errors, only in the affected domain; statistical flags included')],
    [t('Unidade', 'Unit'), t('R$ correntes (nominal), salvo colunas marcadas como reais', 'current R$ (nominal), except columns marked as real')],
    [t('Preços dos valores reais', 'Prices of real values'), t(`R$ de dezembro de ${meta.baseIpca} (IPCA dez/dez)`, `December ${meta.baseIpca} R$ (Dec/Dec IPCA)`)],
    [t('Dados processados em', 'Data processed on'), meta.geradoEm],
    [t('Exportado em', 'Exported on'), new Date().toISOString()],
    ...extra,
  ];
}

/** Botões CSV/Excel. `obter` monta a tabela completa da consulta (não só a parte visível). */
export function BotoesExportar({ nome, obter }: { nome: string; obter: () => Promise<Tabela> | Tabela }) {
  const [ocupado, setOcupado] = useState(false);
  const decimal = idioma() === 'en' ? '.' : ',';
  const acionar = async (formato: 'csv' | 'xlsx') => {
    setOcupado(true);
    try {
      exportar(nome, formato, await obter(), decimal);
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="exportar" role="group" aria-label={t('Exportar', 'Export')}>
      <button className="botao-leve" disabled={ocupado} onClick={() => acionar('csv')}>CSV</button>
      <button className="botao-leve" disabled={ocupado} onClick={() => acionar('xlsx')}>Excel</button>
    </div>
  );
}

export type { Celula, Tabela };
