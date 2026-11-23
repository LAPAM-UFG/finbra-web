import { Link } from 'react-router-dom';
import { t } from '../idioma';

export function PaginaNaoEncontrada() {
  return <><header className="topo"><Link to="/raio-x"><img className="logo" src="/logo_lapam.png" alt="LAPAM"/></Link></header><main id="conteudo" className="pagina-naoencontrada" tabIndex={-1}><h1>{t('Página não encontrada','Page not found')}</h1><p>{t('Este endereço não corresponde a uma página do painel. Você pode escolher um território no Raio X ou acessar os downloads.','This address does not match a dashboard page. You can select a territory in the X-ray or open the downloads.')}</p><nav aria-label={t('Continuar no painel','Continue browsing')}><Link className="botao" to="/raio-x">{t('Abrir o Raio X','Open the territory X-ray')}</Link> <Link to="/downloads">{t('Baixar dados','Download data')}</Link></nav></main></>;
}
