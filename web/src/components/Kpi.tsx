import { t } from '../idioma';

export function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
      {nota && <div className="nota">{nota}</div>}
    </div>
  );
}

export function Estado({ carregando, erro, vazio }: { carregando?: boolean; erro?: string; vazio?: boolean }) {
  if (carregando) return <p className="carregando">{t('Carregando…', 'Loading…')}</p>;
  if (erro) return <p className="vazio erro">{t('Erro', 'Error')}: {erro}</p>;
  if (vazio) return <p className="vazio">{t('Sem dados para este filtro.', 'No data for this filter.')}</p>;
  return null;
}
