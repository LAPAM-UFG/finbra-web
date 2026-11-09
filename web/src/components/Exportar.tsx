import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useDados, useFiltros } from '../contexto';
import { exportar, type Celula, type Tabela } from '../exportar';
import { idioma, t } from '../idioma';

/**
 * Opções dos metadados (finanças e saúde): `anoSelecionado: false` quando o ano da navegação não restringe o arquivo; `periodo` é o que
 * ele de fato traz (série de anos); `precosReais` (saúde) diz se há valores monetários corrigidos pela inflação: true = todas as colunas
 * em reais, 'parcial' = algumas em reais e outras em R$ correntes; ausente = contagens, taxas ou valores nominais, sem nota de preços.
 */
export type OpcoesMetadados = {
  anoSelecionado?: boolean; periodo?: string; precosReais?: boolean | 'parcial';
  /** a tabela traz a própria fonte, recorte e unidade (ex.: CAGED): sem o texto padrão de finanças (SICONFI, R$ correntes, exercício) */
  proprios?: boolean;
};

/** Metadados comuns às exportações: fonte, recorte, tratamento, preços e datas. */
export function useMetadados() {
  const { meta } = useDados();
  const f = useFiltros();
  const saude = useLocation().pathname.startsWith('/datasus');
  // saúde: a fonte, a unidade e o período vêm dos metadados de cada tabela (saude_comum); só o que é comum entra aqui
  if (saude) {
    return (extra: [string, string][] = [], opcoes: OpcoesMetadados = {}): [string, string][] => {
      // o ano selecionado só entra quando restringe os dados exportados; numa série histórica, vale o período que o arquivo traz
      const anoSelecionado: [string, string][] = opcoes.anoSelecionado === false ? [] : [
        [t('Ano selecionado', 'Selected year'), f.ultimo || f.semAnoUrl ? t('último ano de cada fonte', 'latest year of each source') : String(f.ano)]];
      const base: [string, string][] = [
        [t('Recorte', 'Scope'), f.rotulo],
        ...anoSelecionado,
        ...(opcoes.periodo ? [[t('Período exportado', 'Exported period'), opcoes.periodo] as [string, string]] : []),
        // a referência de preços só entra quando a tabela tem valores monetários corrigidos pela inflação (informado pela tabela, não deduzido do título)
        ...(opcoes.precosReais ? [[t('Preços dos valores reais', 'Prices of real values'), t(`R$ de dezembro de ${meta.baseIpca} (IPCA dez/dez)`, `December ${meta.baseIpca} R$ (Dec/Dec IPCA)`)
          + (opcoes.precosReais === 'parcial' ? t(`; só nas colunas em R$ de ${meta.baseIpca}, as colunas em R$ correntes são nominais`, `; only in the columns in ${meta.baseIpca} R$, the current R$ columns are nominal`) : '')] as [string, string]] : []),
        [t('Dados processados em', 'Data processed on'), meta.geradoEm],
        [t('Exportado em', 'Exported on'), new Date().toISOString()],
      ];
      // o que a tabela informa (recorte, fonte, unidade) vale mais que o padrão: sem chave repetida
      const dela = new Set(extra.map(([k]) => k));
      return [...base.filter(([k]) => !dela.has(k)), ...extra];
    };
  }
  return (extra: [string, string][] = [], opcoes: OpcoesMetadados = {}): [string, string][] => opcoes.proprios ? [
    ...extra,
    ...(opcoes.periodo ? [[t('Período exportado', 'Exported period'), opcoes.periodo] as [string, string]] : []),
    [t('Exportado em', 'Exported on'), new Date().toISOString()],
  ] : [
    [t('Fonte', 'Source'), t('SICONFI/Tesouro Nacional (DCA); IBGE (PIB); Banco Central (IPCA). Processamento: LAPAM/UFG', 'SICONFI/National Treasury (DCA); IBGE (GDP); Central Bank of Brazil (IPCA). Processing: LAPAM/UFG')],
    [t('Recorte', 'Scope'), f.rotulo],
    // série de anos: vale o período do arquivo (o ano da navegação não restringe os dados); só uma tabela restrita ao exercício selecionado o identifica como tal
    ...(opcoes.anoSelecionado === false
      ? (opcoes.periodo ? [[opcoes.periodo.includes('–') ? t('Período exportado', 'Exported period') : t('Exercício', 'Fiscal year'), opcoes.periodo] as [string, string]] : [])
      : [[t('Exercício selecionado', 'Selected fiscal year'), String(f.ano)] as [string, string]]),
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
