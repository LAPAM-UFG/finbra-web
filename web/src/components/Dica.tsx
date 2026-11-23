import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Ajuda acessível: botão "?" que abre a explicação com clique, toque ou teclado (Enter/Espaço) e
 * fecha com Esc ou clicando fora. Substitui o atributo title, que não aparece em telas de toque.
 */
export function Dica({ rotulo, children, indicador }: { rotulo: string; children: ReactNode; indicador?: string }) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
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
    const fora = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberta(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberta(false); };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberta]);
  return (
    <span className="dica-caixa" ref={ref}>
      <button type="button" className="dica-botao" aria-label={(indicador||contexto)&&!rotulo.includes(indicador??contexto)?`${rotulo}: ${indicador??contexto}`:rotulo} aria-expanded={aberta} aria-controls={id}
        onClick={(e) => { e.stopPropagation(); setAberta((v) => !v); }}>
        ?
      </button>
      {aberta && (
        <span id={id} role="tooltip" className="dica-texto">{children}</span>
      )}
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
