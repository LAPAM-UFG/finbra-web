import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { t } from '../idioma';
import { Icone } from './Icone';

/**
 * Painel que abre de um botão (exportar, detalhes da conversa): fecha com Esc, com um clique fora ou no próprio
 * botão, e devolve o foco ao botão.
 */
export function Popover({ rotulo, rotuloAcessivel, conteudo, alinhar = 'fim', classe }: {
  rotulo: ReactNode; rotuloAcessivel?: string; conteudo: (fechar: () => void) => ReactNode; alinhar?: 'inicio' | 'fim'; classe?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    // Esc fecha mesmo com o foco fora do painel (ex.: depois de um clique numa área sem foco)
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        setAberto(false);
        botao.current?.focus();
      }
    };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto]);
  const fechar = () => {
    setAberto(false);
    botao.current?.focus();
  };
  return (
    <div ref={raiz} className={`ia-pop${classe ? ` ${classe}` : ''}`}
      onKeyDown={(e) => {
        if (aberto && e.key === 'Escape') {
          e.preventDefault();
          fechar();
        }
      }}>
      <button ref={botao} type="button" className="ia-botao-leve" aria-expanded={aberto} aria-controls={id} aria-label={rotuloAcessivel}
        onClick={() => setAberto(!aberto)}>
        {rotulo}
      </button>
      {aberto && <div id={id} className={`ia-pop-painel ${alinhar}`}>{conteudo(fechar)}</div>}
    </div>
  );
}

/**
 * Janela modal (exemplos, ajuda) com <dialog>: o foco fica dentro dela, Esc e o fundo fecham, e o foco volta ao
 * controle que a abriu (a menos que quem fechou o tenha levado a outro lugar, como o campo da pergunta).
 */
export function Dialogo({ aberto, aoFechar, titulo, children, rodape, retorno }: {
  aberto: boolean; aoFechar: () => void; titulo: string; children: ReactNode; rodape?: ReactNode;
  /** controle que abriu a janela: recebe o foco ao fechá-la (cliques não focam botões no Safari) */
  retorno?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const antes = useRef<HTMLElement | null>(null);
  const idTitulo = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) {
      antes.current = document.activeElement as HTMLElement | null;
      d.showModal();
    } else if (!aberto && d.open) d.close();
  }, [aberto]);
  return (
    <dialog ref={ref} className="ia-dialogo" aria-labelledby={idTitulo}
      onClose={() => {
        aoFechar();
        requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body) (retorno?.current ?? antes.current)?.focus();
        });
      }}
      onClick={(e) => {
        // clique no fundo (fora da caixa) fecha
        if (e.target === ref.current) ref.current.close();
      }}>
      <div className="ia-dialogo-caixa">
        <div className="ia-dialogo-cabeca">
          <h2 id={idTitulo}>{titulo}</h2>
          <button type="button" className="ia-icone-botao" onClick={() => ref.current?.close()} aria-label={t('Fechar', 'Close')} title={t('Fechar', 'Close')}>
            <Icone nome="fechar" />
          </button>
        </div>
        <div className="ia-dialogo-corpo">{aberto && children}</div>
        {rodape && <div className="ia-dialogo-rodape">{rodape}</div>}
      </div>
    </dialog>
  );
}
