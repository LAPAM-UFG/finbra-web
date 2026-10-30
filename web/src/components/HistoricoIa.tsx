import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { baixarArquivo, nomeArquivo } from '../exportar';
import { contar } from '../ia_formato';
import { dataHora, exportarConversa, filtrarResumos, historico, useHistorico, type ResumoConversa } from '../ia_historico';
import { t } from '../idioma';

/**
 * Lateral da aba da IA: nova conversa, busca e conversas anteriores (título e data), com renomear, exportar e
 * excluir, e a importação de um arquivo exportado. Com login, mostra as conversas da conta e oferece levar para ela
 * as que estão só neste navegador. No celular, fica recolhida.
 */
export function HistoricoIa() {
  const h = useHistorico();
  const [busca] = useSearchParams();
  const navegar = useNavigate();
  const atual = busca.get('conversa');
  const [termo, setTermo] = useState('');
  const [editando, setEditando] = useState<{ id: string; titulo: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aberto, setAberto] = useState(() => typeof matchMedia === 'undefined' || !matchMedia('(max-width: 800px)').matches);
  const arquivo = useRef<HTMLInputElement>(null);
  // a lista espera a página saber se há login (conta ou só este navegador)
  useEffect(() => {
    if (h.verificado && !h.carregado) void historico.recarregar();
  }, [h.verificado, h.carregado]);
  const soAqui = h.conta ? h.resumos.filter((r) => !r.conta).length : 0;
  const [levando, setLevando] = useState(false);

  const lista = filtrarResumos(h.resumos, termo);
  const abrir = (id: string) => navegar({ pathname: '/ia', search: `?conversa=${encodeURIComponent(id)}` });
  // a conversa aberta fica no histórico; a nova herda os filtros da página (painéis, ano, território)
  const nova = () => {
    const b = new URLSearchParams();
    for (const k of ['paineis', 'ano', 'uf', 'ente']) if (busca.get(k)) b.set(k, busca.get(k)!);
    b.set('nova', String(Date.now()));
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

  return (
    <details className="ia-historico" open={aberto} onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary>{t('Conversas', 'Conversations')}{h.resumos.length ? ` (${h.resumos.length})` : ''}</summary>
      <button type="button" className="botao ia-historico-nova" onClick={nova}>{t('+ Nova conversa', '+ New conversation')}</button>
      <input type="search" className="ia-historico-busca" value={termo} onChange={(e) => setTermo(e.target.value)}
        placeholder={t('Buscar nas conversas', 'Search conversations')} aria-label={t('Buscar no título, nas perguntas e nas conclusões', 'Search titles, questions and conclusions')} />
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
                    onKeyDown={(e) => e.key === 'Escape' && setEditando(null)} maxLength={200} />
                  <button type="submit" className="botao-leve">{t('Salvar', 'Save')}</button>
                  <button type="button" className="botao-leve" onClick={() => setEditando(null)}>{t('Cancelar', 'Cancel')}</button>
                </form>
              ) : (
                <a href={`/ia?conversa=${encodeURIComponent(r.id)}`} aria-current={r.id === atual ? 'page' : undefined}
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
              )}
              {editando?.id !== r.id && (
                <span className="ia-historico-acoes">
                  <button type="button" className="botao-leve" onClick={() => setEditando({ id: r.id, titulo: r.titulo })} aria-label={t(`Renomear “${r.titulo}”`, `Rename “${r.titulo}”`)}>{t('Renomear', 'Rename')}</button>
                  <button type="button" className="botao-leve" onClick={() => void exportar(r)} aria-label={t(`Exportar “${r.titulo}” em JSON`, `Export “${r.titulo}” as JSON`)}>{t('Exportar', 'Export')}</button>
                  <button type="button" className="botao-leve" onClick={() => void excluir(r)} aria-label={t(`Excluir “${r.titulo}”`, `Delete “${r.titulo}”`)}>{t('Excluir', 'Delete')}</button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className="botao-leve ia-historico-importar">
        {t('Importar conversa (JSON)', 'Import conversation (JSON)')}
        <input ref={arquivo} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void importar(e.target.files?.[0])} />
      </label>
      {aviso && <p className="ia-nota" role="status">{aviso}</p>}
      <p className="ia-nota ia-historico-nota">
        {h.conta
          ? t(`As conversas ficam na sua conta (${h.conta}), no servidor do LAPAM, e abrem em qualquer computador em que você entrar com este e-mail. Cada pessoa só vê as próprias conversas, mas quem administra o servidor do LAPAM tem acesso a elas. Excluir apaga do servidor de vez. Uma cópia fica neste navegador para a lista abrir rápido. As perguntas à IA seguem o caminho de sempre (servidor do LAPAM e Anthropic).`,
            `Conversations are kept in your account (${h.conta}), on the LAPAM server, and open on any computer where you sign in with this email. Each person only sees their own conversations, but LAPAM server administrators can access them. Deleting erases them from the server for good. A copy stays in this browser so the list opens fast. Questions to the AI follow the usual path (LAPAM server and Anthropic).`)
          : t('Sem login, as conversas ficam só neste navegador: o endereço de uma conversa não abre em outro computador, e limpar os dados de navegação apaga o histórico (exporte em JSON as importantes). Entre com seu e-mail para guardá-las na sua conta. As perguntas à IA seguem o caminho de sempre (servidor do LAPAM e Anthropic).',
            'Without signing in, conversations are kept only in this browser: a conversation address does not open on another computer, and clearing browsing data erases the history (export the important ones as JSON). Sign in with your email to keep them in your account. Questions to the AI follow the usual path (LAPAM server and Anthropic).')}
      </p>
    </details>
  );
}
