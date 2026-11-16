import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { t } from '../idioma';

export function IndiceSaude({ raiz }: { raiz: RefObject<HTMLElement | null> }) {
  const navegar=useNavigate(),id=useId();
  const { hash, search, key } = useLocation(); // a chave muda a cada navegação, inclusive ao clicar de novo no mesmo link
  const [itens, setItens] = useState<{ id: string; rotulo: string }[]>([]);
  const [alturaRaiz, setAlturaRaiz] = useState(0);
  const interagiu = useRef(false);
  useEffect(() => {
    const el = raiz.current;
    if (!el) return;
    const ler = () => {
      // âncora ainda sem conteúdo (o bloco carrega à parte) não ganha link: ele aparece quando o bloco chega
      const novos = [...el.querySelectorAll<HTMLElement>('[data-indice]')].filter((e) => e.childElementCount > 0 || e.textContent).map((e) => ({ id: e.id, rotulo: e.dataset.indice ?? '' }));
      setItens((a) => (JSON.stringify(a) === JSON.stringify(novos) ? a : novos));
    };
    ler();
    const o = new MutationObserver(ler);
    o.observe(el, { childList: true, subtree: true });
    // blocos que carregam e gráficos que se montam mudam a altura da raiz: a rolagem até a âncora é refeita (até o primeiro gesto)
    const r = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => setAlturaRaiz(Math.round(el.getBoundingClientRect().height)));
    r?.observe(el);
    return () => { o.disconnect(); r?.disconnect(); };
  }, [raiz]);
  useEffect(() => {
    const marcar = () => { interagiu.current = true; };
    const eventos = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;
    eventos.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    return () => eventos.forEach((e) => window.removeEventListener(e, marcar));
  }, []);
  useEffect(() => { interagiu.current = false; }, [hash, key]);
  useEffect(() => {
    if (!hash) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return; // âncora malformada (ex.: %E0%A4%A): ignorada, a página segue normal
    }
    const alvo = document.getElementById(id);
    if (!alvo || !alvo.hasAttribute('data-indice') || interagiu.current) return;
    alvo.scrollIntoView({ block: 'start' }); // a margem de rolagem (scroll-padding-top) desconta o cabeçalho fixo, que muda de altura
    alvo.focus({ preventScroll: true });
  }, [hash, key, itens, alturaRaiz]);
  if (itens.length < 2) return null;
  return (
    <nav className="indice-saude" aria-label={t('Nesta página', 'On this page')}>
      <div className="indice-lista"><span className="indice-rotulo">{t('Ir para', 'Jump to')}</span>
      <ul>
        {itens.map((i) => (
          <li key={i.id}><Link to={{ search, hash: `#${i.id}` }}>{i.rotulo}</Link></li>
        ))}
      </ul></div>
      <div className="indice-select"><label className="sr-only" htmlFor={id}>{t('Ir para um tema','Jump to a topic')}</label><select id={id} value="" onChange={e=>navegar({search,hash:'#'+e.target.value})}>
       <option value="" disabled>{t(`Ir para um tema (${itens.length})`,`Jump to a topic (${itens.length})`)}</option>{itens.map(i=><option key={i.id} value={i.id}>{i.rotulo}</option>)}
      </select></div>
    </nav>
  );
}
