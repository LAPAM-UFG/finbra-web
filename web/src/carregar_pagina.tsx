import { lazy, useEffect, type ComponentType } from 'react';
import { t } from './idioma';

/** Uma aba antiga pode pedir um chunk removido pelo deploy. Atualiza uma vez,
 * mantendo uma saída visível se a rede continuar indisponível. */
function FalhaPagina() {
  useEffect(() => {
    try {
      const chave = 'finbra:ultima-recuperacao-pagina';
      const anterior = Number(sessionStorage.getItem(chave) ?? 0);
      if (navigator.onLine && Date.now() - anterior > 60_000) {
        sessionStorage.setItem(chave, String(Date.now()));
        location.reload();
      }
    } catch { /* Sem armazenamento, o botão continua disponível. */ }
  }, []);
  return <section className="cartao" role="alert">
    <h2>{t('Não foi possível abrir esta página', 'This page could not be opened')}</h2>
    <p>{t('Confira a conexão e atualize para carregar a versão atual do painel.', 'Check your connection and refresh to load the current dashboard version.')}</p>
    <button onClick={() => location.reload()}>{t('Atualizar página', 'Refresh page')}</button>
  </section>;
}

export function pagina<T extends ComponentType<any>>(abrir: () => Promise<{ default: T }>) {
  return lazy(() => abrir().catch(() => ({ default: FalhaPagina as ComponentType<any> })));
}
