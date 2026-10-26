import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * Ajuda acessível: botão "?" que abre a explicação com clique, toque ou teclado (Enter/Espaço) e
 * fecha com Esc ou clicando fora. Substitui o atributo title, que não aparece em telas de toque.
 */
export function Dica({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  const [aberta, setAberta] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
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
      <button type="button" className="dica-botao" aria-label={rotulo} aria-expanded={aberta} aria-controls={id}
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
      {texto} <Dica rotulo={rotulo ?? texto}>{dica}</Dica>
    </>
  );
}
