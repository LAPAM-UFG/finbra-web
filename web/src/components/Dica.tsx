import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Ajuda acessível: botão "?" que abre a explicação com clique, toque ou teclado (Enter/Espaço) e
 * fecha com Esc ou clicando fora. Substitui o atributo title, que não aparece em telas de toque.
 */
export function Dica({ rotulo, children, indicador }: { rotulo: string; children: ReactNode; indicador?: string }) {
  const [posicao, setPosicao] = useState<CSSProperties | null>(null);
  const aberta = posicao !== null;
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const balao = useRef<HTMLSpanElement>(null);
  const [contexto,setContexto] = useState('');
  useEffect(() => {
    if(indicador)return;
    const pai=ref.current?.closest('.kpi, .rx-detalhe, .rx-destaque, .cartao, th, section') ?? ref.current?.closest('main');
    const cabecalho=pai?.querySelector('.rotulo, .rx-titulo, h1, h2, h3, h4')?.cloneNode(true) as HTMLElement|undefined;
    cabecalho?.querySelectorAll('.dica-caixa').forEach(x=>x.remove());
    const titulo=cabecalho?.textContent?.trim();
    if(titulo&&!rotulo.includes(titulo))setContexto(titulo);
  },[rotulo,indicador,children]);
  useEffect(() => {
    if (!aberta) return;
    const fechar = () => setPosicao(null);
    const fora = (e: Event) => { if (!ref.current?.contains(e.target as Node) && !balao.current?.contains(e.target as Node)) fechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') fechar(); };
    const rolar = (e: Event) => { if (!balao.current?.contains(e.target as Node)) fechar(); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', fechar);
    document.addEventListener('scroll', rolar, true);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', fechar);
      document.removeEventListener('scroll', rolar, true);
    };
  }, [aberta]);
  const alternar = () => {
    if (aberta) { setPosicao(null); return; }
    const r = ref.current!.getBoundingClientRect();
    const largura = document.documentElement.clientWidth, w = Math.min(340, largura - 32);
    const abaixo = window.innerHeight - r.bottom - 16, acima = r.top - 16;
    const baixo = abaixo >= Math.min(220, acima);
    setPosicao({ width: w, left: Math.max(16, Math.min(r.left, largura - w - 16)),
      ...(baixo ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }),
      maxHeight: Math.max(80, (baixo ? abaixo : acima) - 6) });
  };
  return (
    <span className="dica-caixa" ref={ref}>
      <button type="button" className="dica-botao" aria-label={(indicador||contexto)&&!rotulo.includes(indicador??contexto)?`${rotulo}: ${indicador??contexto}`:rotulo} aria-expanded={aberta} aria-controls={id} aria-describedby={aberta ? id : undefined}
        onClick={(e) => { e.stopPropagation(); alternar(); }}>
        ?
      </button>
      {posicao && createPortal(<span ref={balao} id={id} role="tooltip" className="dica-texto" style={posicao}>{children}</span>, document.body)}
    </span>
  );
}

/** Cabeçalho de coluna com explicação (fórmula, base do percentual). */
export function ComDica({ texto, dica, rotulo }: { texto: string; dica: ReactNode; rotulo?: string }) {
  return (
    <>
      {texto} <Dica rotulo={rotulo ?? texto} indicador={texto}>{dica}</Dica>
    </>
  );
}
