import { useEffect, useMemo, useState } from 'react';
import { BotoesExportar } from '../components/Exportar';
import { useDados } from '../contexto';
import {
  chamarIa, estadoIa, executarConsulta, paraModelo, LINHAS_TELA,
  type Bloco, type EstadoIa, type Mensagem, type Resultado,
} from '../ia';
import { idioma, local, t } from '../idioma';

const MAX_RODADAS = 8;
const LINHAS_INICIAIS = 25;

const exemplos = () => [
  t('Quais os 10 municípios de Goiás com maior receita per capita em 2024?', 'Which 10 municipalities in Goiás had the highest revenue per capita in 2024?'),
  t('Como evoluiu a dependência do FPM dos municípios do Nordeste de 2015 a 2024, em termos reais?', 'How did FPM dependency of Northeast municipalities evolve from 2015 to 2024?'),
  t('Qual a despesa com saúde por habitante em cada faixa populacional em 2023?', 'What was health spending per inhabitant in each population bracket in 2023?'),
  t('Quantos municípios tiveram alertas de inconsistência em 2025, e quais?', 'How many municipalities had inconsistency alerts in 2025, and which ones?'),
];

type Item = { tipo: 'texto'; texto: string } | { tipo: 'consulta'; id: string; sql: string; objetivo: string };
type Turno = { pergunta: string; itens: Item[] };

/** Conversa da API (perguntas, textos e chamadas da ferramenta) organizada por pergunta, na ordem. */
function turnos(mensagens: Mensagem[]): Turno[] {
  const r: Turno[] = [];
  for (const m of mensagens) {
    if (m.role === 'user' && typeof m.content === 'string') r.push({ pergunta: m.content, itens: [] });
    else if (m.role === 'assistant' && Array.isArray(m.content) && r.length) {
      for (const b of m.content) {
        if (b.type === 'text' && b.text?.trim()) r.at(-1)!.itens.push({ tipo: 'texto', texto: b.text.trim() });
        if (b.type === 'tool_use' && b.id) {
          const e = (b.input ?? {}) as { sql?: string; objetivo?: string };
          r.at(-1)!.itens.push({ tipo: 'consulta', id: b.id, sql: String(e.sql ?? ''), objetivo: String(e.objetivo ?? '') });
        }
      }
    }
  }
  return r;
}

const SEM_SEPARADOR = /^(exercicio|ano|cod_ibge|cod_\w+|grupo|faixa_grupo|mes|aaaamm)$/i;
function celula(coluna: string, v: unknown) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') {
    if (SEM_SEPARADOR.test(coluna)) return String(v);
    return v.toLocaleString(local(), { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 4 });
  }
  if (typeof v === 'boolean') return v ? t('sim', 'yes') : t('não', 'no');
  return String(v);
}

function Consulta({ item, resultado, pergunta }: { item: Extract<Item, { tipo: 'consulta' }>; resultado?: Resultado; pergunta: string }) {
  const { meta } = useDados();
  const [todas, setTodas] = useState(false);
  return (
    <div className="ia-consulta">
      <div className="cabeca-cartao">
        <strong>{item.objetivo || t('Consulta', 'Query')}</strong>
        {resultado && !('erro' in resultado) && (
          <BotoesExportar
            nome="consulta_ia"
            obter={() => ({
              colunas: resultado.colunas,
              linhas: resultado.linhas,
              metadados: [
                [t('Fonte', 'Source'), t('Tabelas do painel LAPAM/UFG (SICONFI, IBGE, Banco Central, Portal da Transparência, Previdência)', 'LAPAM/UFG dashboard tables (SICONFI, IBGE, Central Bank, Transparency Portal, Social Security)')],
                [t('Pergunta', 'Question'), pergunta],
                [t('Consulta SQL (proposta pela IA)', 'SQL query (proposed by AI)'), item.sql],
                [t('Linhas', 'Rows'), `${resultado.linhas.length} / ${resultado.total}`],
                [t('Dados processados em', 'Data processed on'), meta.geradoEm],
                [t('Exportado em', 'Exported on'), new Date().toISOString()],
              ],
            })}
          />
        )}
      </div>
      <details>
        <summary>SQL</summary>
        <pre className="ia-sql">{item.sql}</pre>
      </details>
      {!resultado ? (
        <p className="carregando">{t('Executando a consulta…', 'Running the query…')}</p>
      ) : 'erro' in resultado ? (
        <p className="erro">{t('A consulta falhou', 'The query failed')}: {resultado.erro}</p>
      ) : resultado.linhas.length === 0 ? (
        <p className="sem-obs">{t('Nenhuma linha.', 'No rows.')}</p>
      ) : (
        <>
          <div className="rolagem">
            <table>
              <thead><tr>{resultado.colunas.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {resultado.linhas.slice(0, todas ? LINHAS_TELA : LINHAS_INICIAIS).map((l, i) => (
                  <tr key={i}>{l.map((v, j) => <td key={j} className={typeof v === 'number' ? undefined : 'ia-txt'}>{celula(resultado.colunas[j], v)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="legenda-tabela">
            {resultado.total > resultado.linhas.length
              ? t(`${resultado.total.toLocaleString(local())} linhas; a página mostra as primeiras ${resultado.linhas.length.toLocaleString(local())}.`,
                `${resultado.total.toLocaleString(local())} rows; the page shows the first ${resultado.linhas.length.toLocaleString(local())}.`)
              : t(`${resultado.total.toLocaleString(local())} linhas.`, `${resultado.total.toLocaleString(local())} rows.`)}
            {resultado.linhas.length > LINHAS_INICIAIS && (
              <> <button className="limpar" onClick={() => setTodas(!todas)}>{todas ? t('mostrar menos', 'show fewer') : t('mostrar todas', 'show all')}</button></>
            )}
          </p>
        </>
      )}
    </div>
  );
}

export function Ia() {
  const [estado, setEstado] = useState<EstadoIa | null | undefined>(undefined);
  const [falhaEstado, setFalhaEstado] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = () => {
    setFalhaEstado(null);
    estadoIa().then(setEstado, (e) => setFalhaEstado(e instanceof Error ? e.message : String(e)));
  };
  useEffect(carregar, []);

  const lista = useMemo(() => turnos(mensagens), [mensagens]);

  async function perguntar(pergunta: string) {
    pergunta = pergunta.trim();
    if (!pergunta || ocupado) return;
    const antes = mensagens;
    let hist: Mensagem[] = [...mensagens, { role: 'user', content: pergunta }];
    setMensagens(hist);
    setTexto('');
    setAviso(null);
    setOcupado(true);
    try {
      for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
        const r = await chamarIa(hist, idioma());
        setEstado((e) => (e ? { ...e, restantes: r.restantes } : e));
        hist = [...hist, { role: 'assistant', content: r.conteudo }];
        setMensagens(hist);
        if (r.parada === 'refusal') {
          setAviso(t('A IA não respondeu a esta pergunta.', 'The AI declined to answer this question.') + (r.recusa ? ` ${r.recusa}` : ''));
          break;
        }
        if (r.parada === 'max_tokens') {
          setAviso(t('A resposta foi interrompida por ser longa demais.', 'The answer was cut off for being too long.'));
          break;
        }
        const usos = r.conteudo.filter((b): b is Bloco & { id: string } => b.type === 'tool_use' && !!b.id);
        if (r.parada !== 'tool_use' || !usos.length) break;
        const devolver: Bloco[] = [];
        for (const u of usos) {
          const res = await executarConsulta(u.input);
          setResultados((m) => ({ ...m, [u.id]: res }));
          devolver.push({ type: 'tool_result', tool_use_id: u.id, content: paraModelo(res), ...('erro' in res ? { is_error: true } : {}) });
        }
        hist = [...hist, { role: 'user', content: devolver }];
        setMensagens(hist);
        if (rodada === MAX_RODADAS - 1) setAviso(t('A IA fez consultas demais sem concluir; tente reformular a pergunta.', 'The AI ran too many queries without finishing; try rephrasing.'));
      }
    } catch (e) {
      // volta ao estado anterior à pergunta: um histórico pela metade invalidaria as próximas
      setMensagens(antes);
      setTexto(pergunta);
      setAviso(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }

  const novaConversa = () => {
    setMensagens([]);
    setResultados({});
    setAviso(null);
  };

  return (
    <>
      <h2 className="titulo-pagina">{t('Pergunte aos dados', 'Ask the data')}</h2>
      <p className="subtitulo">
        {t('Perguntas em linguagem natural sobre as tabelas do painel. A IA escreve consultas SQL, que rodam aqui no seu navegador, e explica o resultado.',
          'Natural-language questions about the dashboard tables. The AI writes SQL queries, which run here in your browser, and explains the result.')}
      </p>
      <div className="aviso">
        {t('Respostas geradas por IA (Claude, da Anthropic) podem conter erros. Confira a consulta e a tabela antes de usar os números. Não há dados por conta contábil detalhada nesta página.',
          'AI-generated answers (Claude, by Anthropic) may contain errors. Check the query and the table before using the numbers. Detailed account-level data is not available on this page.')}
      </div>

      {estado === undefined && !falhaEstado && <p className="carregando">{t('Verificando o acesso…', 'Checking access…')}</p>}
      {falhaEstado && (
        <p className="erro">{falhaEstado} <button className="botao-leve" onClick={carregar}>{t('Tentar de novo', 'Try again')}</button></p>
      )}
      {estado === null && (
        <div className="cartao">
          <p>{t('O acesso é restrito a e-mails autorizados pelo LAPAM.', 'Access is restricted to emails authorized by LAPAM.')}</p>
          <a className="botao" href="/api/ia/entrar">{t('Entrar', 'Sign in')}</a>
        </div>
      )}

      {estado && (
        <>
          <p className="ia-conta">
            {estado.email} · {t(`${estado.restantes} de ${estado.limite} perguntas restantes hoje`, `${estado.restantes} of ${estado.limite} questions left today`)}
            {' · '}<a href="/cdn-cgi/access/logout">{t('Sair', 'Sign out')}</a>
          </p>
          {!estado.configurada && (
            <p className="erro">{t('A IA ainda não foi configurada no servidor (falta a chave da Anthropic).', 'The AI is not configured on the server yet (missing Anthropic key).')}</p>
          )}

          {lista.map((turno, i) => (
            <section key={i} className="cartao ia-turno">
              <p className="ia-pergunta">{turno.pergunta}</p>
              {turno.itens.map((item, j) =>
                item.tipo === 'texto'
                  ? <div key={j} className="ia-texto">{item.texto}</div>
                  : <Consulta key={item.id} item={item} resultado={resultados[item.id]} pergunta={turno.pergunta} />,
              )}
              {ocupado && i === lista.length - 1 && <p className="carregando">{t('Pensando…', 'Thinking…')}</p>}
            </section>
          ))}
          {aviso && <p className="erro">{aviso}</p>}

          {!lista.length && (
            <div className="ia-exemplos">
              {exemplos().map((e) => (
                <button key={e} className="botao-leve" disabled={ocupado || estado.restantes <= 0} onClick={() => perguntar(e)}>{e}</button>
              ))}
            </div>
          )}

          <form
            className="ia-form"
            onSubmit={(ev) => {
              ev.preventDefault();
              perguntar(texto);
            }}
          >
            <label className="sr-only" htmlFor="ia-pergunta">{t('Pergunta', 'Question')}</label>
            <textarea
              id="ia-pergunta"
              value={texto}
              maxLength={2000}
              rows={3}
              placeholder={lista.length ? t('Pergunte mais sobre isso…', 'Ask a follow-up…') : t('Escreva sua pergunta…', 'Type your question…')}
              onChange={(ev) => setTexto(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' && !ev.shiftKey) {
                  ev.preventDefault();
                  perguntar(texto);
                }
              }}
            />
            <div className="ia-acoes">
              <button className="botao" type="submit" disabled={ocupado || !texto.trim() || estado.restantes <= 0}>
                {ocupado ? t('Aguarde…', 'Please wait…') : t('Perguntar', 'Ask')}
              </button>
              {!!lista.length && <button type="button" className="botao-leve" disabled={ocupado} onClick={novaConversa}>{t('Nova conversa', 'New conversation')}</button>}
            </div>
          </form>
        </>
      )}
    </>
  );
}
