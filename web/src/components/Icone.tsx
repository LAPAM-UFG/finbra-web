/**
 * Ícones de traço (mesma família, 24×24, traço 2), decorativos: quem usa dá o nome acessível ao botão
 * (texto visível, aria-label ou title).
 */
const TRACOS = {
  enviar: <><path d="m5 12 7-7 7 7" /><path d="M12 19V5" /></>,
  descer: <><path d="M12 5v14" /><path d="m19 12-7 7-7-7" /></>,
  fechar: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  mais: <><path d="M5 12h14" /><path d="M12 5v14" /></>,
  ajustes: <><path d="M21 4h-7" /><path d="M10 4H3" /><path d="M21 12h-9" /><path d="M8 12H3" /><path d="M21 20h-5" /><path d="M12 20H3" /><path d="M14 2v4" /><path d="M8 10v4" /><path d="M16 18v4" /></>,
  lateral: <><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M9 3v18" /></>,
  busca: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
  ajuda: <><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><path d="M12 17h.01" /></>,
  baixar: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></>,
  acoes: <><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /><circle cx="5" cy="12" r="1" /></>,
  parar: <rect width="12" height="12" x="6" y="6" rx="2" />,
  info: <><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></>,
  ideia: <><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6" /><path d="M10 22h4" /></>,
  dados: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></>,
  entrar: <><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="m10 17 5-5-5-5" /><path d="M15 12H3" /></>,
  copiar: <><rect width="14" height="14" x="8" y="8" rx="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></>,
} as const;

export type NomeIcone = keyof typeof TRACOS;

export function Icone({ nome, tamanho = 18 }: { nome: NomeIcone; tamanho?: number }) {
  return (
    <svg className="icone" width={tamanho} height={tamanho} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {TRACOS[nome]}
    </svg>
  );
}
