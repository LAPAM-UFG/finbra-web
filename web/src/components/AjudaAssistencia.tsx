import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Explicação junto ao indicador, fora da área rolável da tabela e dentro da tela. */
export function AjudaAssistencia({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const id = useId();
  const botao = useRef<HTMLButtonElement>(null); const balao = useRef<HTMLDivElement>(null);
  const [posicao, setPosicao] = useState<CSSProperties | null>(null);
  useEffect(() => {
    if (!posicao) return;
    const fora = (e: Event) => { if (!botao.current?.contains(e.target as Node) && !balao.current?.contains(e.target as Node)) setPosicao(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setPosicao(null); };
    const fechar = () => setPosicao(null);
    const rolar = (e: Event) => { if (!balao.current?.contains(e.target as Node)) fechar(); };
    document.addEventListener('pointerdown', fora); document.addEventListener('keydown', esc); window.addEventListener('resize', fechar);
    document.addEventListener('scroll', rolar, true);
    return () => { document.removeEventListener('pointerdown', fora); document.removeEventListener('keydown', esc); window.removeEventListener('resize', fechar); document.removeEventListener('scroll', rolar, true); };
  }, [posicao]);
  const alternar = () => {
    if (posicao) { setPosicao(null); return; }
    const r = botao.current!.getBoundingClientRect(); const largura = document.documentElement.clientWidth; const w = Math.min(340, largura - 32);
    const abaixo = window.innerHeight - r.bottom - 16; const acima = r.top - 16; const baixo = abaixo >= Math.min(220, acima);
    setPosicao({ width: w, left: Math.max(16, Math.min(r.left, largura - w - 16)),
      ...(baixo ? { top: r.bottom + 6 } : { bottom: window.innerHeight - r.top + 6 }), maxHeight: Math.max(80, (baixo ? abaixo : acima) - 6) });
  };
  return <>
    <button ref={botao} type="button" className="dica-botao as-ajuda-botao" aria-label={rotulo} aria-expanded={!!posicao} aria-controls={posicao ? id : undefined} aria-describedby={posicao ? id : undefined}
      onClick={e => { e.stopPropagation(); alternar(); }}>?</button>
    {posicao && createPortal(<div ref={balao} id={id} role="tooltip" className="as-ajuda-balao" style={posicao}>{children}</div>, document.body)}
  </>;
}
