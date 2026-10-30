import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { aoMudarEtapa, etapaAtual } from '../dados';
import { t } from '../idioma';

export function Kpi({ rotulo, valor, nota, dica }: { rotulo: ReactNode; valor: string; nota?: ReactNode; dica?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}{dica}</div>
      <div className="valor">{valor}</div>
      {nota && <div className="nota">{nota}</div>}
    </div>
  );
}

/** Mensagem do erro sem detalhes de implementação; o detalhe técnico fica recolhido. */
export function Estado({ carregando, erro, vazio, mensagem, tentarNovamente, cancelar }: {
  carregando?: boolean; erro?: string; vazio?: boolean | string; mensagem?: string; tentarNovamente?: () => void;
  /** Consultas de microdados: mostra a etapa em andamento e o tempo, com o botão Cancelar. */
  cancelar?: () => void;
}) {
  if (carregando) return cancelar ? <Andamento cancelar={cancelar} /> : <p className="carregando" role="status">{t('Carregando…', 'Loading…')}</p>;
  if (erro && /cancelad|cancelled/i.test(erro)) {
    return (
      <div className="vazio" role="status">
        <p>{t('Consulta cancelada. Os filtros continuam como estavam.', 'Query cancelled. The filters are unchanged.')}</p>
        {tentarNovamente && <button className="botao" onClick={tentarNovamente}>{t('Consultar de novo', 'Run again')}</button>}
      </div>
    );
  }
  if (erro) {
    return (
      <div className="vazio erro" role="alert">
        <p>{mensagem ?? t('Não foi possível carregar esta consulta.', 'This query could not be loaded.')}</p>
        {tentarNovamente && <button className="botao" onClick={tentarNovamente}>{t('Tentar novamente', 'Try again')}</button>}
        <details><summary>{t('Detalhe técnico', 'Technical detail')}</summary><code>{erro}</code></details>
      </div>
    );
  }
  if (vazio) return <p className="vazio">{typeof vazio === 'string' ? vazio : t('Sem dados para este filtro.', 'No data for this filter.')}</p>;
  return null;
}

/** Etapa real da consulta (a que o motor está fazendo), segundos decorridos e Cancelar; sem barra de progresso, que não é mensurável. */
function Andamento({ cancelar }: { cancelar: () => void }) {
  const etapa = useSyncExternalStore(aoMudarEtapa, etapaAtual);
  const [inicio] = useState(() => Date.now());
  const [, setAgora] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const s = Math.round((Date.now() - inicio) / 1000);
  return (
    <div className="carregando andamento" role="status" aria-live="polite">
      <span>{etapa ?? t('Preparando o motor de consultas e o dicionário de códigos…', 'Preparing the query engine and the code dictionary…')}</span>
      <span className="tempo">{s >= 2 ? `${s} s` : ''}</span>
      <button className="botao-leve" onClick={cancelar}>{t('Cancelar', 'Cancel')}</button>
    </div>
  );
}
