import type { ReactNode } from 'react';
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
export function Estado({ carregando, erro, vazio, mensagem, tentarNovamente }: {
  carregando?: boolean; erro?: string; vazio?: boolean | string; mensagem?: string; tentarNovamente?: () => void;
}) {
  if (carregando) return <p className="carregando" role="status">{t('Carregando…', 'Loading…')}</p>;
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
