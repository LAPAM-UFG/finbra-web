import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { baixarArquivo, nomeArquivo } from '../exportar';
import { contar } from '../ia_formato';
import { dataHora, exportarConversa, filtrarResumos, historico, useHistorico, type ResumoConversa } from '../ia_historico';
import { t } from '../idioma';
import { Icone } from './Icone';

const CELULAR = '(max-width: 800px)';
const RECOLHIDA = 'ia-historico-recolhido';

function useCelular() {
  const [celular, setCelular] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(CELULAR).matches);
  useEffect(() => {
    const m = matchMedia(CELULAR);
    const mudar = () => setCelular(m.matches);
    m.addEventListener('change', mudar);
    return () => m.removeEventListener('change', mudar);
  }, []);
  return celular;
}

function lerRecolhida() {
  try {
    return localStorage.getItem(RECOLHIDA) === '1';
  } catch {
    return false;
  }
}

/** Menu "⋯" de uma conversa: abre por clique, toque ou teclado (setas, Home/End; Esc fecha e devolve o foco). */
function MenuConversa({ titulo, acoes }: { titulo: string; acoes: [string, () => void][] }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLSpanElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const itens = () => [...(raiz.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? [])];
  useEffect(() => {
    if (!aberto) return;
    itens()[0]?.focus();
    const fora = (e: PointerEvent) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [aberto]);
  const fechar = () => {
    setAberto(false);
    botao.current?.focus();
  };
  const teclas = (e: KeyboardEvent) => {
    const l = itens();
    const i = l.indexOf(document.activeElement as HTMLButtonElement);
    const ir = (j: number) => {
      e.preventDefault();
      l[(j + l.length) % l.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      fechar();
    } else if (e.key === 'ArrowDown') ir(i + 1);
    else if (e.key === 'ArrowUp') ir(i - 1);
    else if (e.key === 'Home') ir(0);
    else if (e.key === 'End') ir(l.length - 1);
    else if (e.key === 'Tab') setAberto(false);
  };
  return (
    <span ref={raiz} className="ia-historico-mais" onKeyDown={aberto ? teclas : undefined}>
      <button ref={botao} type="button" className="ia-historico-mais-botao" aria-haspopup="menu" aria-expanded={aberto}
        aria-label={t(`Ações da conversa “${titulo}”`, `Actions for “${titulo}”`)} title={t('Renomear, exportar ou excluir', 'Rename, export or delete')}
        onClick={() => setAberto(!aberto)}
        onKeyDown={(e) => {
          if (!aberto && e.key === 'ArrowDown') {
            e.preventDefault();
            setAberto(true);
          }
        }}>
        <Icone nome="acoes" />
      </button>
      {aberto && (
        <ul role="menu" className="ia-historico-menu" aria-label={t(`Ações da conversa “${titulo}”`, `Actions for “${titulo}”`)}>
          {acoes.map(([rotulo, fazer]) => (
            <li key={rotulo} role="none">
              <button type="button" role="menuitem" tabIndex={-1} onClick={() => {
                fechar();
                fazer();
              }}>{rotulo}</button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/**
 * Lateral da aba da IA: nova conversa, busca e conversas anteriores (título em até duas linhas e data), com
 * renomear, exportar e excluir no menu "⋯", e a importação de um arquivo exportado. Com login, mostra as conversas
 * da conta e oferece levar para ela as que estão só neste navegador. No computador, a lateral recolhe numa faixa
 * estreita (a escolha fica guardada); no celular, a lista abre num painel por cima da página.
 */
export function HistoricoIa() {
  const h = useHistorico();
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const atual = busca.get('conversa');
  const [termo, setTermo] = useState('');
  const [editando, setEditando] = useState<{ id: string; titulo: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const celular = useCelular();
  const [recolhida, setRecolhida] = useState(lerRecolhida);
  const [gaveta, setGaveta] = useState(false);
  const aberto = celular ? gaveta : !recolhida;
  const alternador = useRef<HTMLButtonElement>(null);
  const campoBusca = useRef<HTMLInputElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const alternar = () => {
    if (celular) {
      setGaveta(!gaveta);
      return;
    }
    setRecolhida(!recolhida);
    try {
      localStorage.setItem(RECOLHIDA, recolhida ? '0' : '1');
    } catch {
      /* sem armazenamento: vale nesta visita */
    }
  };
  const fecharGaveta = () => {
    setGaveta(false);
    alternador.current?.focus();
  };
  // no celular, o painel abre com o foco na busca e fecha com Esc (o Esc de um menu "⋯" aberto fecha só o menu)
  useEffect(() => {
    if (!celular || !gaveta) return;
    campoBusca.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        setGaveta(false);
        alternador.current?.focus();
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [celular, gaveta]);
  // a lista espera a página saber se há login (conta ou só este navegador)
  useEffect(() => {
    if (h.verificado && !h.carregado) void historico.recarregar();
  }, [h.verificado, h.carregado]);
  const soAqui = h.conta ? h.resumos.filter((r) => !r.conta).length : 0;
  const [levando, setLevando] = useState(false);

  const lista = filtrarResumos(h.resumos, termo);
  const abrir = (id: string) => {
    setGaveta(false);
    navegar({ pathname: '/ia', search: `?conversa=${encodeURIComponent(id)}` });
  };
  // a conversa aberta fica no histórico; a nova herda os filtros da página (painéis, ano, território)
  const nova = () => {
    const b = new URLSearchParams();
    for (const k of ['paineis', 'ano', 'uf', 'ente']) if (busca.get(k)) b.set(k, busca.get(k)!);
    b.set('nova', String(Date.now()));
    setGaveta(false);
    navegar({ pathname: '/ia', search: `?${b}` });
  };
  const renomear = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    if (!editando) return;
    if (editando.titulo.trim()) await historico.renomear(editando.id, editando.titulo);
    setEditando(null);
  };
  const exportar = async (r: ResumoConversa) => {
    const c = await historico.ler(r.id).catch(() => null);
    if (c) baixarArquivo(`${nomeArquivo(c.titulo)}.json`, exportarConversa(c), 'application/json');
    else setAviso(t('Não foi possível ler a conversa para exportar.', 'Could not read the conversation to export.'));
  };
  const excluir = async (r: ResumoConversa) => {
    if (!confirm(r.conta
      ? t(`Excluir a conversa “${r.titulo}” da sua conta? Ela é apagada do servidor e deste navegador, de vez: não dá para desfazer (a não ser importando uma cópia exportada).`,
        `Delete the conversation “${r.titulo}” from your account? It is erased from the server and from this browser for good: this cannot be undone (except by importing an exported copy).`)
      : t(`Excluir a conversa “${r.titulo}” deste navegador? Não dá para desfazer (a não ser importando uma cópia exportada).`,
        `Delete the conversation “${r.titulo}” from this browser? This cannot be undone (except by importing an exported copy).`))) return;
    if (await historico.excluir(r.id)) {
      setAviso(t('Conversa excluída.', 'Conversation deleted.'));
      if (r.id === atual) nova();
    }
  };
  const levar = async () => {
    setLevando(true);
    try {
      const { levadas, falhas } = await historico.levarParaConta();
      setAviso(falhas
        ? t(`${contar(levadas, 'conversa levada', 'conversas levadas')} para a sua conta; ${contar(falhas, 'não foi', 'não foram')} (tente de novo).`,
          `${contar(levadas, 'conversation moved', 'conversations moved')} to your account; ${contar(falhas, 'was not', 'were not')} (try again).`)
        : t(`${contar(levadas, 'conversa levada', 'conversas levadas')} para a sua conta.`, `${contar(levadas, 'conversation moved', 'conversations moved')} to your account.`));
    } finally {
      setLevando(false);
    }
  };
  const importar = async (f: File | undefined) => {
    if (!f) return;
    try {
      const { id, repetida } = await historico.importar(await f.text());
      setAviso(repetida ? t('Essa conversa já estava no histórico; ela foi aberta.', 'That conversation was already in the history; it was opened.') : t('Conversa importada.', 'Conversation imported.'));
      abrir(id);
    } catch (e) {
      setAviso(t(`Não foi possível importar: ${e instanceof Error ? e.message : String(e)}.`, `Could not import: ${e instanceof Error ? e.message : String(e)}.`));
    } finally {
      if (arquivo.current) arquivo.current.value = '';
    }
  };

  const total = h.resumos.length ? ` (${h.resumos.length})` : '';
  return (
    <section className={`ia-historico${aberto ? ' aberto' : ' recolhido'}${celular ? ' celular' : ''}`} aria-label={t('Conversas', 'Conversations')}>
      <div className="ia-historico-barra">
        <button ref={alternador} type="button" className="ia-historico-alternar" aria-expanded={aberto} aria-controls="ia-historico-painel" onClick={alternar}
          title={celular ? undefined : aberto ? t('Recolher a lista de conversas', 'Collapse the conversation list') : t('Mostrar a lista de conversas', 'Show the conversation list')}>
          <Icone nome="lateral" />
          {celular || aberto
            ? <span>{t('Conversas', 'Conversations')}{total}</span>
            : <span className="sr-only">{t('Mostrar conversas', 'Show conversations')}</span>}
          {!celular && aberto && <span className="sr-only">{t(': recolher', ': collapse')}</span>}
        </button>
        <button type="button" className="ia-historico-nova" onClick={nova} title={t('Nova conversa', 'New conversation')}>
          <Icone nome="mais" tamanho={16} />
          {!celular && !aberto ? <span className="sr-only">{t('Nova conversa', 'New conversation')}</span> : <span>{t('Nova conversa', 'New conversation')}</span>}
        </button>
      </div>
      {celular && gaveta && <div className="ia-historico-fundo" aria-hidden="true" onClick={fecharGaveta} />}
      <div id="ia-historico-painel" className="ia-historico-painel" hidden={!aberto}
        {...(celular ? { role: 'dialog', 'aria-modal': true, 'aria-label': t('Conversas', 'Conversations') } : {})}>
        {celular && (
          <div className="ia-historico-topo">
            <h2>{t('Conversas', 'Conversations')}{total}</h2>
            <button type="button" className="ia-icone-botao" onClick={fecharGaveta} aria-label={t('Fechar a lista de conversas', 'Close the conversation list')} title={t('Fechar', 'Close')}>
              <Icone nome="fechar" />
            </button>
          </div>
        )}
        {celular && (
          <button type="button" className="ia-historico-nova" onClick={nova}><Icone nome="mais" tamanho={16} /> {t('Nova conversa', 'New conversation')}</button>
        )}
        <div className="ia-historico-busca-caixa">
          <Icone nome="busca" tamanho={15} />
          <input ref={campoBusca} type="search" className="ia-historico-busca" value={termo} onChange={(e) => setTermo(e.target.value)}
            placeholder={t('Buscar nas conversas', 'Search conversations')} aria-label={t('Buscar no título, nas perguntas e nas conclusões', 'Search titles, questions and conclusions')} />
        </div>
        {h.erro && <p className="erro" role="alert">{h.erro}</p>}
        {h.semServidor && (
          <p className="ia-nota" role="status">{t(`Sem resposta do servidor (${h.semServidor}): a lista é a cópia deste navegador e o que for salvo segue para a conta quando a conexão voltar.`,
            `No answer from the server (${h.semServidor}): the list is this browser’s copy and what is saved goes to the account when the connection is back.`)}</p>
        )}
        {soAqui > 0 && (
          <p className="ia-historico-levar">
            <button type="button" className="botao-leve" onClick={() => void levar()} disabled={levando}>
              {levando ? t('Levando…', 'Moving…') : t(`Levar para a minha conta (${soAqui})`, `Move to my account (${soAqui})`)}
            </button>
            <span className="ia-nota">{t('conversas que estão só neste navegador', 'conversations that are only in this browser')}</span>
          </p>
        )}
        {!h.carregado ? (
          <p className="ia-nota">{t('Carregando o histórico…', 'Loading the history…')}</p>
        ) : !lista.length ? (
          <p className="ia-nota">{termo.trim() ? t('Nenhuma conversa com esses termos.', 'No conversation with these terms.') : t('Nenhuma conversa salva ainda.', 'No saved conversations yet.')}</p>
        ) : (
          <ul className="ia-historico-lista">
            {lista.map((r) => (
              <li key={r.id} className={r.id === atual ? 'ativa' : undefined}>
                {editando?.id === r.id ? (
                  <form className="ia-historico-renomear" onSubmit={(e) => void renomear(e)}>
                    <input value={editando.titulo} onChange={(e) => setEditando({ id: r.id, titulo: e.target.value })} aria-label={t('Novo título', 'New title')} autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditando(null);
                        }
                      }} maxLength={200} />
                    <button type="submit" className="botao-leve">{t('Salvar', 'Save')}</button>
                    <button type="button" className="botao-leve" onClick={() => setEditando(null)}>{t('Cancelar', 'Cancel')}</button>
                  </form>
                ) : (
                  <div className="ia-historico-item">
                    <a href={`/ia?conversa=${encodeURIComponent(r.id)}`} aria-current={r.id === atual ? 'page' : undefined} title={r.titulo}
                      onClick={(e) => {
                        e.preventDefault();
                        abrir(r.id);
                      }}>
                      <span className="ia-historico-titulo">{r.titulo}</span>
                      <span className="ia-historico-data">
                        {dataHora(r.atualizadaEm)} · {contar(r.perguntas, t('pergunta', 'question'), t('perguntas', 'questions'))}
                        {r.origem.tipo === 'versao' && ` · ${t('nova versão', 'new version')}`}
                        {h.conta && !r.conta && ` · ${t('só neste navegador', 'only in this browser')}`}
                        {r.pendente && ` · ${t('ainda não enviada à conta', 'not yet sent to the account')}`}
                        {h.emAndamento.includes(r.id) && ` · ${t('respondendo…', 'answering…')}`}
                      </span>
                    </a>
                    <MenuConversa titulo={r.titulo} acoes={[
                      [t('Renomear', 'Rename'), () => setEditando({ id: r.id, titulo: r.titulo })],
                      [t('Exportar (JSON)', 'Export (JSON)'), () => void exportar(r)],
                      [t('Excluir', 'Delete'), () => void excluir(r)],
                    ]} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="ia-historico-pe">
        {h.conta ? (
          <p className="ia-historico-conta">
            <span className="ia-nota">{t('Conectado como', 'Signed in as')}</span>
            <strong title={h.conta}>{h.conta}</strong>
            <a href="/cdn-cgi/access/logout">{t('Sair', 'Sign out')}</a>
          </p>
        ) : h.verificado && <p className="ia-historico-conta-fora">{t('Sem login: as conversas ficam neste navegador.', 'Not signed in: conversations stay in this browser.')}</p>}
        <label className="ia-historico-importar">
          {t('Importar conversa (JSON)', 'Import conversation (JSON)')}
          <input ref={arquivo} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void importar(e.target.files?.[0])} />
        </label>
        {aviso && <p className="ia-nota" role="status">{aviso}</p>}
        <details className="ia-historico-sobre">
          <summary>{t('Onde ficam as conversas?', 'Where are conversations kept?')}</summary>
          <p className="ia-nota">
            {h.conta
              ? t(`As conversas ficam na sua conta (${h.conta}), no servidor do LAPAM, e abrem em qualquer computador em que você entrar com este e-mail. Cada pessoa só vê as próprias conversas, mas quem administra o servidor do LAPAM tem acesso a elas. Excluir apaga do servidor de vez. Uma cópia fica neste navegador para a lista abrir rápido. As perguntas à IA seguem o caminho de sempre (servidor do LAPAM e Anthropic).`,
                `Conversations are kept in your account (${h.conta}), on the LAPAM server, and open on any computer where you sign in with this email. Each person only sees their own conversations, but LAPAM server administrators can access them. Deleting erases them from the server for good. A copy stays in this browser so the list opens fast. Questions to the AI follow the usual path (LAPAM server and Anthropic).`)
              : t('Sem login, as conversas ficam só neste navegador: o endereço de uma conversa não abre em outro computador, e limpar os dados de navegação apaga o histórico (exporte em JSON as importantes). Entre com seu e-mail para guardá-las na sua conta. As perguntas à IA seguem o caminho de sempre (servidor do LAPAM e Anthropic).',
                'Without signing in, conversations are kept only in this browser: a conversation address does not open on another computer, and clearing browsing data erases the history (export the important ones as JSON). Sign in with your email to keep them in your account. Questions to the AI follow the usual path (LAPAM server and Anthropic).')}
          </p>
        </details>
        </div>
      </div>
    </section>
  );
}
