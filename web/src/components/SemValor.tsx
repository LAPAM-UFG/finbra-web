import { SEM_VALOR } from '../format';
import { t } from '../idioma';
export function SemValor({motivo}:{motivo?:string}) {
  return <span className="sem-valor" aria-label={motivo??t('Sem valor disponível','No available value')} title={motivo??t('Ausência de valor não significa zero.','A missing value does not mean zero.')}>{SEM_VALOR}</span>;
}
