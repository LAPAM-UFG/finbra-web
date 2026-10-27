/**
 * Perguntas à base (página /ia): conversa com o Worker (/api/ia, com login do Cloudflare Access) e
 * execução, aqui no navegador, das consultas SQL que o Claude propõe.
 */
import { consultaLivre, manifestoDados, tabelaLrf, tabelasIaTrabalho } from './dados';
import { t } from './idioma';

export type Bloco = { type: string; id?: string; name?: string; input?: unknown; text?: string; [k: string]: unknown };
export type Mensagem = { role: 'user' | 'assistant'; content: string | Bloco[] };
export type EstadoIa = { email: string; restantes: number; limite: number; configurada: boolean; modelo?: string };
export type RespostaIa = { conteudo: Bloco[]; parada: string; recusa?: string | null; restantes: number };
export type Resultado = { colunas: string[]; linhas: (string | number | boolean | null)[][]; total: number } | { erro: string };

/** Linhas da consulta mostradas na página e enviadas ao modelo. */
export const LINHAS_TELA = 2000;
const LINHAS_MODELO = 200;
const TAMANHO_MODELO = 40_000; // caracteres do resultado enviado ao modelo

/** Login e perguntas restantes; null quando não há login (o Access redireciona para a tela de entrada). */
export async function estadoIa(): Promise<EstadoIa | null> {
  const r = await fetch('/api/ia/estado', { redirect: 'manual', credentials: 'same-origin' });
  if (r.type === 'opaqueredirect' || r.status === 401 || r.status === 403) return null;
  // no computador local, 502/504 = o Vite não achou o Worker da IA (npx wrangler dev, porta 8787)
  if ((r.status === 502 || r.status === 504) && location.hostname === 'localhost') {
    throw new Error(t('O servidor local da IA não está ligado (em worker/: npx wrangler dev, com a chave em worker/.dev.vars).',
      'The local AI server is not running (in worker/: npx wrangler dev, with the key in worker/.dev.vars).'));
  }
  if (!r.ok) throw new Error(`${t('serviço indisponível', 'service unavailable')} (${r.status})`);
  return r.json();
}

/** Painéis que a IA pode consultar (aba "Pergunte aos dados"); cada um tem tabelas e instruções próprias. */
export type Painel = 'financas' | 'trabalho';
export const PAINEIS: Painel[] = ['financas', 'trabalho'];

export async function chamarIa(mensagens: Mensagem[], idioma: string, paineis: Painel[] = PAINEIS): Promise<RespostaIa> {
  const contexto = paineis.includes('trabalho') ? await tabelasIaTrabalho() : undefined;
  // o manifesto só é usado pelo Worker local (wrangler dev), que não tem o do R2
  const manifesto = location.hostname === 'localhost' && paineis.includes('financas') ? await manifestoDados() : undefined;
  const r = await fetch('/api/ia', {
    method: 'POST',
    redirect: 'manual',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idioma, mensagens, paineis, contexto, manifesto }),
  });
  if (r.type === 'opaqueredirect' || r.status === 401) throw new Error(t('sessão expirada: entre de novo', 'session expired: sign in again'));
  const corpo = await r.json().catch(() => null);
  if (!r.ok) throw new Error(corpo?.erro ?? `${t('falha', 'failure')} (${r.status})`);
  return corpo;
}

// ---------------- SQL somente leitura ----------------

const PROIBIDAS = /\b(attach|detach|copy|install|load|pragma|set|reset|create|insert|update|delete|drop|alter|export|import|call|checkpoint|vacuum|use|begin|commit|rollback|truncate|grant|secret)\b/i;
const FUNCOES_PROIBIDAS = /\b(read_\w+|parquet_\w+|glob|sniff_csv|getenv|query|query_table|iceberg_\w+|delta_scan|sqlite_\w+|postgres_\w+|mysql_\w+|duckdb_\w+|pragma_\w+|current_setting|which_secret)\s*\(/i;
const LITERAL = /'(?:[^']|'')*'/g;

/**
 * Confere que a consulta só lê as tabelas do painel: uma instrução SELECT/WITH, sem comandos, sem
 * funções que leem arquivos ou URLs e sem textos que pareçam caminhos. Devolve o motivo da recusa ou null.
 * A consulta ainda roda dentro de SELECT * FROM (...), o que impede qualquer outro tipo de instrução.
 */
export function validarSql(sql: string): string | null {
  const s = sql.trim().replace(/;\s*$/, '');
  if (!s) return 'consulta vazia';
  if (s.length > 20_000) return 'consulta longa demais';
  for (const lit of s.match(LITERAL) ?? []) {
    // só o que parece endereço ou arquivo (URL, caminho absoluto, barra invertida, extensão de dados);
    // rótulos como 'homens/mulheres: …' são livres (ler arquivos ainda exige read_* ou FROM '…', barrados abaixo)
    if (/:\/\/|^'([a-z]:)?[/\\]|\\|\.\.[/\\]|\.(parquet|csv|tsv|json|txt|db|duckdb|xlsx|sqlite)\b/i.test(lit)) {
      return `texto não permitido na consulta: ${lit.slice(0, 60)}`;
    }
  }
  const semTextos = s.replace(LITERAL, "''").replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  if (semTextos.includes(';')) return 'só uma instrução por consulta';
  if (!/^\s*\(*\s*(select|with)\b/i.test(semTextos)) return 'só SELECT ou WITH';
  const palavra = PROIBIDAS.exec(semTextos);
  if (palavra) return `comando não permitido: ${palavra[1]}`;
  const funcao = FUNCOES_PROIBIDAS.exec(semTextos);
  if (funcao) return `função não permitida: ${funcao[1]}`;
  if (/\b(from|join)\s*\(?\s*''/i.test(semTextos)) {
    return 'só as tabelas do painel podem ser lidas';
  }
  // aliases entre aspas são livres ("receita per capita (R$ mi.)", "mulheres/total (%)"); só barra o que parece
  // arquivo ou endereço: começa com / ou C:, tem :// ou \, ou termina numa extensão de dados
  if (/"(?:[a-z]:)?[/\\][^"]*"|"[^"]*(:\/\/|\\|\.(parquet|csv|tsv|json|jsonl|ndjson|txt|db|duckdb|xlsx|sqlite|gz|zst|arrow|avro)\b)[^"]*"/i.test(semTextos)) {
    return 'identificador não permitido';
  }
  return null;
}

/** Roda a consulta proposta pelo modelo (entrada da ferramenta "consultar"). */
export async function executarConsulta(entrada: unknown, paineis: Painel[] = PAINEIS): Promise<Resultado> {
  const e = entrada as { sql?: unknown };
  if (!e || typeof e.sql !== 'string') return { erro: 'entrada inválida: falta o campo sql' };
  const motivo = validarSql(e.sql);
  if (motivo) return { erro: motivo };
  try {
    if (paineis.includes('trabalho')) await tabelasIaTrabalho();
    // a tabela da LRF só é baixada quando alguma consulta a usa
    if (paineis.includes('financas') && /\blrf\b/i.test(e.sql)) await tabelaLrf();
    return await consultaLivre(e.sql, LINHAS_TELA);
  } catch (err) {
    return { erro: err instanceof Error ? err.message : String(err) };
  }
}

/** Resultado em JSON para o modelo: até 200 linhas, encurtado se passar do tamanho máximo. */
export function paraModelo(r: Resultado): string {
  if ('erro' in r) return JSON.stringify({ erro: r.erro });
  let n = Math.min(LINHAS_MODELO, r.linhas.length);
  for (;;) {
    const texto = JSON.stringify({ colunas: r.colunas, linhas: r.linhas.slice(0, n), total_linhas: r.total, linhas_enviadas: n });
    if (texto.length <= TAMANHO_MODELO || n <= 5) return texto;
    n = Math.floor(n / 2);
  }
}
