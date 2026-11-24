import { useEffect, useId, useRef, useState, type MouseEvent } from 'react';
import { Link, type To } from 'react-router-dom';
import { t, useIdioma } from '../idioma';
import { nomePaginaMenu, type GrupoMenu } from '../menus_paineis';

interface Props {
  nome: string;
  grupos: GrupoMenu[];
  caminho: string;
  linkPagina: (caminho: string) => To;
}

/** Uma só lista de links; o celular a abre sem substituir o painel nem seus filtros. */
export function MenuPainel({ nome, grupos, caminho, linkPagina }: Props) {
  const [aberto, setAberto] = useState(false);
  const id = useId();
  const idioma = useIdioma();
  const nav = useRef<HTMLElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const atual = grupos.flatMap(([grupo, paginas]) => paginas.map(([p, rotulo]) => ({ p, nome: nomePaginaMenu(grupo, rotulo) }))).find(p => p.p === caminho);

  useEffect(() => {
    setAberto(false);
    const menu = nav.current;
    if (!menu) return;
    // Move apenas a lateral. A página e a restauração de Voltar/Avançar continuam livres.
    const mostrarAtivo = () => {
      const ativo = menu.querySelector<HTMLElement>('a[aria-current="page"]');
      if (!ativo || !matchMedia('(min-width: 801px)').matches) return;
      const m = menu.getBoundingClientRect(), a = ativo.getBoundingClientRect();
      if (a.top < m.top) menu.scrollTop += a.top - m.top - 12;
      else if (a.bottom > m.bottom) menu.scrollTop += a.bottom - m.bottom + 12;
    };
    mostrarAtivo();
    const observador = new ResizeObserver(mostrarAtivo);
    observador.observe(menu);
    return () => observador.disconnect();
  }, [caminho, idioma]);

  const fechar = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (matchMedia('(max-width: 800px)').matches) {
      setAberto(false);
      botao.current?.focus({ preventScroll: true });
    }
  };

  return <nav className={`menu menu-painel${aberto ? ' menu-aberto' : ''}`} ref={nav} aria-label={t(`Páginas de ${nome}`, `${nome} pages`)}
    onKeyDown={e => { if (e.key === 'Escape' && aberto) { setAberto(false); botao.current?.focus({ preventScroll: true }); } }}>
    <div className="menu-cabecalho"><span>{t('Neste painel', 'In this dashboard')}</span><h2>{nome}</h2></div>
    <button className="menu-abrir" type="button" ref={botao} aria-expanded={aberto} aria-controls={`${id}-paginas`} onClick={() => setAberto(!aberto)}>
      <span><span className="menu-abrir-rotulo">{aberto ? t('Fechar menu do painel', 'Close dashboard menu') : t('Abrir menu do painel', 'Open dashboard menu')}</span><strong>{atual?.nome ?? t('Escolher uma página', 'Choose a page')}</strong></span>
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 7 5 5 5-5" /></svg>
    </button>
    <div className="menu-grupos" id={`${id}-paginas`}>
      {grupos.map(([grupo, paginas], i) => <section className="menu-grupo" key={grupo} aria-labelledby={`${id}-${i}`}>
        <h3 id={`${id}-${i}`}>{grupo}</h3>
        {paginas.map(([para, rotulo]) => <Link key={para} to={linkPagina(para)} onClick={fechar}
          className={para === caminho ? 'ativo' : undefined} aria-current={para === caminho ? 'page' : undefined}
          title={nomePaginaMenu(grupo, rotulo)} aria-label={nomePaginaMenu(grupo, rotulo)}>{rotulo}</Link>)}
      </section>)}
    </div>
  </nav>;
}
