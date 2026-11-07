/**
 * Continuidade das conversas da IA: consultas partidas por ano (com cache e cobertura parcial), resultados
 * já apurados que as perguntas seguintes reaproveitam (tabelas res_C1…) e compactação do histórico enviado
 * ao modelo. Nada aqui chama o modelo nem o banco: as funções recebem o que precisam.
 */
import { t } from './idioma';
import type { Bloco, Mensagem, Resultado } from './ia';
import { ehPergunta, rotulosConsultas, textoDaPergunta, turnos } from './ia';

type Certo = Exclude<Resultado, { erro: string }>;

// ---------------- consultas partidas por ano ----------------

export const MARCADOR_ANO = '{ano}';
/**
 * Anos simultâneos. Uma conexão do DuckDB-WASM tem um só fluxo de resultado aberto: uma segunda consulta
 * na mesma conexão derruba a primeira (as linhas dela se perdem), então os anos rodam em fila, um de cada vez.
 */
export const CONCORRENCIA = 1;
/** Tempo total de uma consulta partida; os anos que não começaram até lá ficam como faltantes. */
export const LIMITE_PARTIDA_MS = 12 * 60_000;

export type Particao = { anos: number[] };

/** Campo particao de "consultar": null se ausente; texto com o problema se mal formado. */
export function lerParticao(v: unknown, sql: string): Particao | string | null {
  const bruto = Array.isArray(v) ? v : (v && typeof v === 'object' ? (v as { anos?: unknown }).anos : null);
  if (!Array.isArray(bruto) || !bruto.length) return null;
  const anos = [...new Set(bruto.map(Number))].sort((a, b) => a - b);
  if (anos.some((a) => !Number.isInteger(a) || a < 1900 || a > 2100)) return 'particao: use uma lista de anos (ex.: [2011, 2012, 2013])';
  if (anos.length > 40) return 'particao: no máximo 40 anos por consulta';
  if (!sql.includes(MARCADOR_ANO)) return `particao: o SQL precisa do marcador ${MARCADOR_ANO} no filtro do ano (ex.: WHERE ano = ${MARCADOR_ANO})`;
  return { anos };
}

export const sqlDoAno = (sql: string, ano: number) => sql.split(MARCADOR_ANO).join(String(ano));

/** Partes concluídas, por versão dos dados e SQL do ano: uma nova tentativa só roda o que faltou. */
const cacheDePartes = new Map<string, Certo>();
export const limparCacheDePartes = () => cacheDePartes.clear();

export type Parcial = { pedidos: number[]; concluidos: number[]; reaproveitados: number[]; faltam: { ano: number; motivo: string }[] };

export async function executarPartida(
  sql: string, p: Particao, rodar: (sqlDoAno: string) => Promise<Resultado>,
  o: { sinal?: AbortSignal; versao?: string; limite: number; aoParte?: (feitas: number, total: number) => void; agora?: () => number },
): Promise<Resultado> {
  const agora = o.agora ?? Date.now;
  const inicio = agora();
  const partes = new Map<number, Certo>();
  const faltam = new Map<number, string>();
  const reaproveitados: number[] = [];
  const fila = [...p.anos];
  const avisar = () => o.aoParte?.(partes.size + faltam.size, p.anos.length);
  const chave = (ano: number) => `${o.versao ?? ''}|${sqlDoAno(sql, ano).replace(/\s+/g, ' ').trim()}`;
  avisar();
  const trabalhador = async () => {
    for (;;) {
      if (o.sinal?.aborted) return;
      const ano = fila.shift();
      if (ano === undefined) return;
      if (agora() - inicio > LIMITE_PARTIDA_MS) {
        faltam.set(ano, t('o tempo total da consulta se esgotou antes de começar este ano', 'the total query time ran out before this year started'));
        avisar();
        continue;
      }
      const guardado = cacheDePartes.get(chave(ano));
      if (guardado) {
        partes.set(ano, guardado);
        reaproveitados.push(ano);
        avisar();
        continue;
      }
      const r = await rodar(sqlDoAno(sql, ano));
      if (o.sinal?.aborted) return;
      if ('erro' in r) faltam.set(ano, r.erro);
      else if (r.linhas.length < r.total) faltam.set(ano, t('resultado truncado (mais linhas do que a página carrega)', 'truncated result (more rows than the page loads)'));
      else {
        partes.set(ano, r);
        cacheDePartes.set(chave(ano), r);
      }
      avisar();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCORRENCIA, p.anos.length) }, trabalhador));
  if (o.sinal?.aborted) throw new DOMException(t('pergunta cancelada', 'question cancelled'), 'AbortError');

  const concluidos = [...partes.keys()].sort((a, b) => a - b);
  if (!concluidos.length) {
    const motivo = [...faltam.values()][0] ?? t('nenhum ano foi concluído', 'no year was completed');
    return { erro: t(`nenhum dos ${p.anos.length} anos foi concluído (${motivo})`, `none of the ${p.anos.length} years completed (${motivo})`), tempoEsgotado: [...faltam.values()].some(esgotou) };
  }
  // todas as partes têm de ter as mesmas colunas: uma parte diferente conta como falha
  const colunas = partes.get(concluidos[0])!.colunas;
  for (const ano of concluidos.slice(1)) {
    if (partes.get(ano)!.colunas.join('\u0000') !== colunas.join('\u0000')) {
      partes.delete(ano);
      faltam.set(ano, t('colunas diferentes das dos outros anos', 'columns differ from the other years'));
    }
  }
  const ok = [...partes.keys()].sort((a, b) => a - b);
  const linhas = ok.flatMap((a) => partes.get(a)!.linhas);
  const total = ok.reduce((s, a) => s + partes.get(a)!.total, 0);
  const parcial: Parcial | undefined = faltam.size
    ? { pedidos: p.anos, concluidos: ok, reaproveitados: reaproveitados.filter((a) => ok.includes(a)).sort((a, b) => a - b), faltam: [...faltam].sort((a, b) => a[0] - b[0]).map(([ano, motivo]) => ({ ano, motivo })) }
    : undefined;
  return { colunas, linhas: linhas.slice(0, o.limite), total, ...(parcial ? { parcial } : {}) };
}

export const esgotou = (msg: string) => /passou de \d+ minutos|ran for over|tempo total/i.test(msg);

/** Texto para a página e para o modelo sobre uma cobertura parcial. */
export function descreverParcial(p: Parcial): string {
  const anos = (l: number[]) => l.join(', ');
  return t(
    `Resultado PARCIAL: ${p.concluidos.length} de ${p.pedidos.length} anos concluídos (${anos(p.concluidos)}). Faltam ${anos(p.faltam.map((f) => f.ano))}: ${p.faltam[0].motivo}. `
    + 'Não trate o total como completo. Refaça a mesma consulta com a mesma particao: os anos concluídos são reaproveitados e só os que faltam rodam de novo.',
    `PARTIAL result: ${p.concluidos.length} of ${p.pedidos.length} years completed (${anos(p.concluidos)}). Missing ${anos(p.faltam.map((f) => f.ano))}: ${p.faltam[0].motivo}. `
    + 'Do not treat the total as complete. Rerun the same query with the same particao: completed years are reused and only the missing ones run again.');
}

// ---------------- resultados já apurados (tabelas res_C1…) ----------------

export const MARCA_RESULTADOS = '[RESULTADOS DA CONVERSA]';
export const MARCA_RESUMO = '[RESUMO DA CONVERSA]';
const MAX_CATALOGO = 3800;

export type ResultadoGuardado = { rotulo: string; id: string; sql: string; objetivo: string; definicao: string; res: Certo };

/**
 * Resultados da conversa que as perguntas seguintes podem usar como tabela: completos (todas as linhas), sem erro,
 * sem cobertura parcial e da mesma versão dos dados. Ficam só na conversa de quem perguntou (nada é compartilhado).
 */
export function resultadosReaproveitaveis(hist: Mensagem[], resultados: Record<string, Resultado>, versao?: string): Map<string, ResultadoGuardado> {
  const rotulos = rotulosConsultas(hist);
  const r = new Map<string, ResultadoGuardado>();
  for (const m of hist) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_use' || b.name !== 'consultar' || !b.id) continue;
      const res = resultados[b.id];
      const rotulo = rotulos.get(b.id);
      if (!res || !rotulo || 'erro' in res || res.parcial || res.linhas.length < res.total) continue;
      if (versao && res.dados && res.dados !== versao) continue;
      const e = (b.input ?? {}) as { sql?: unknown; objetivo?: unknown; definicao?: unknown; regressao?: unknown };
      if (e.regressao && typeof e.regressao === 'object' && (e.regressao as { y?: unknown }).y) continue;
      r.set(rotulo, { rotulo, id: b.id, sql: String(e.sql ?? ''), objetivo: String(e.objetivo ?? ''), definicao: String(e.definicao ?? ''), res });
    }
  }
  return r;
}

export const nomeTabela = (rotulo: string) => `res_${rotulo}`;
const curto = (s: string, n: number) => (s.replace(/\s+/g, ' ').trim().length > n ? `${s.replace(/\s+/g, ' ').trim().slice(0, n - 1)}…` : s.replace(/\s+/g, ' ').trim());

/** Filtros do SQL (WHERE…GROUP BY), que dizem de qual recorte o resultado saiu. */
const filtrosDoSql = (sql: string) => /\bwhere\b([\s\S]*?)(?:\bgroup\s+by\b|\border\s+by\b|$)/i.exec(sql)?.[1] ?? '';

/** Bloco de contexto com os resultados disponíveis (os mais recentes primeiro), para o modelo saber o que já foi apurado. */
export function catalogoDeResultados(r: Map<string, ResultadoGuardado>): string {
  if (!r.size) return '';
  const cabeca = `${MARCA_RESULTADOS} Resultados já apurados nesta conversa, guardados na página como tabelas (FROM res_C1, res_C2…): `
    + 'use-as para participações, variações, totais e reorganizações sem apurar de novo, mas só quando território, período, filtros, CNAE e definição do indicador forem os mesmos da nova pergunta; '
    + 'se algo mudar, consulte as bases. Resultado parcial ou truncado não é oferecido.';
  const linhas: string[] = [];
  let tam = cabeca.length;
  for (const g of [...r.values()].reverse()) {
    const l = `- ${nomeTabela(g.rotulo)} (${g.res.total} linhas; colunas: ${curto(g.res.colunas.join(', '), 160)}): ${curto(g.objetivo, 140)}`
      + (g.definicao ? ` | definição: ${curto(g.definicao, 200)}` : '')
      + (filtrosDoSql(g.sql) ? ` | filtros: ${curto(filtrosDoSql(g.sql), 220)}` : '');
    if (tam + l.length > MAX_CATALOGO) break;
    linhas.push(l);
    tam += l.length + 1;
  }
  return [cabeca, ...linhas].join('\n');
}

/** Os res_Cn que o SQL cita. */
export const citadasNoSql = (sql: string) => [...new Set([...sql.matchAll(/\bres_(C\d+)\b/gi)].map((m) => m[1].toUpperCase()))];

// ---------------- compactação do histórico enviado ao modelo ----------------

/** Perguntas mais recentes que seguem inteiras; as anteriores perdem as tabelas e, passado o limite, viram um resumo. */
export const TURNOS_INTEIROS = 2;
const MAX_TURNOS_ANTES_DO_RESUMO = 5;
const MAX_BYTES_ANTES_DO_RESUMO = 250_000;
const MAX_RESUMO = 7500;

const semCatalogo = (b: Bloco): Bloco => (b.type === 'text' && typeof b.text === 'string' && b.text.includes(MARCA_RESULTADOS)
  ? { ...b, text: b.text.slice(0, b.text.indexOf(MARCA_RESULTADOS)).trimEnd() }
  : b);

/** Resultado de uma consulta antiga, no lugar da tabela inteira. */
function resumoDoResultado(conteudo: unknown, rotulo: string, guardado: ResultadoGuardado | undefined): string {
  if (guardado) {
    return JSON.stringify({
      consulta: rotulo, colunas: guardado.res.colunas, total_linhas: guardado.res.total,
      nota: t(`Tabela completa guardada na página como ${nomeTabela(rotulo)}; use FROM ${nomeTabela(rotulo)} para recalcular sem apurar de novo.`,
        `Full table kept by the page as ${nomeTabela(rotulo)}; use FROM ${nomeTabela(rotulo)} to recompute without gathering the data again.`),
    });
  }
  const s = typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo);
  return s.length <= 600 ? s : JSON.stringify({ consulta: rotulo, nota: t('resultado omitido do histórico enviado ao modelo', 'result omitted from the history sent to the model') });
}

/** "responder" de uma pergunta antiga, sem as tabelas e os gráficos: fica o que importa para a continuidade. */
function respostaEnxuta(entrada: unknown): unknown {
  const r = (entrada && typeof entrada === 'object' && 'resposta' in (entrada as object) ? (entrada as { resposta: unknown }).resposta : entrada) as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return entrada;
  const pega = (k: string, n: number) => (typeof r[k] === 'string' ? curto(r[k] as string, n) : '');
  return { resposta: { tipo: r.tipo ?? 'resposta', conclusao: pega('conclusao', 600), limitacoes: pega('limitacoes', 600), recorte: r.recorte ?? {}, metodologia: pega('metodologia', 500), compactada: true } };
}

/** Resumo em texto das perguntas antigas: perguntas, conclusões, recortes, consultas e as ressalvas metodológicas. */
export function resumoDoHistorico(antigas: Mensagem[], resultados: Record<string, Resultado>): string {
  const ts = turnos(antigas);
  const consultas = new Map<string, string[]>();
  const rotulos = rotulosConsultas(antigas);
  let n = -1;
  for (const m of antigas) {
    if (ehPergunta(m)) { n++; continue; }
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_use' || b.name !== 'consultar' || !b.id) continue;
      const e = (b.input ?? {}) as { objetivo?: unknown; definicao?: unknown };
      const ok = resultados[b.id] && !('erro' in resultados[b.id]);
      (consultas.get(String(n)) ?? consultas.set(String(n), []).get(String(n))!).push(
        `${rotulos.get(b.id)}${ok ? ` (${nomeTabela(rotulos.get(b.id)!)})` : ''}: ${curto(String(e.objetivo ?? ''), 90)}${e.definicao ? ` [${curto(String(e.definicao), 120)}]` : ''}`);
    }
  }
  const ressalvas = new Set<string>();
  const porTurno = Math.max(250, Math.floor(5000 / Math.max(1, ts.length)));
  const blocos = ts.map((x, i) => {
    const r = x.resposta;
    if (r?.limitacoes) ressalvas.add(curto(r.limitacoes, 400));
    const recorte = r ? Object.entries(r.recorte).filter(([, v]) => v).map(([k, v]) => `${k}: ${curto(v, 120)}`).join('; ') : '';
    return curto(`${i + 1}. Pergunta: ${curto(x.pergunta, 160)} | Conclusão: ${r ? curto(r.conclusao, 280) : curto(x.textoFinal ?? '(sem resposta)', 200)}`
      + (recorte ? ` | Recorte: ${recorte}` : '') + (consultas.get(String(i))?.length ? ` | Consultas: ${consultas.get(String(i))!.join('; ')}` : ''), porTurno);
  });
  const fim = ressalvas.size ? `\nRessalvas metodológicas mantidas: ${[...ressalvas].join(' ◆ ')}` : '';
  const texto = `${MARCA_RESUMO} Perguntas anteriores desta conversa, resumidas para caber no limite; as tabelas continuam na página (res_C1…). Antes de reaproveitar um resultado, confira se o recorte dele é o da nova pergunta.\n${blocos.join('\n')}${fim}`;
  return texto.length <= MAX_RESUMO ? texto : `${texto.slice(0, MAX_RESUMO - 1)}…`;
}

export type Envio = { mensagens: Mensagem[]; compactada: 'nenhuma' | 'tabelas' | 'resumo' };

/**
 * Histórico que vai ao modelo: as perguntas anteriores às últimas perdem as tabelas (ficam res_Cn na página) e, com
 * muitas perguntas ou corpo grande, viram um resumo. A conversa guardada não muda; só o que é enviado.
 */
export function compactarParaEnvio(hist: Mensagem[], resultados: Record<string, Resultado>, versao?: string): Envio {
  const idx = hist.flatMap((m, i) => (ehPergunta(m) ? [i] : []));
  if (idx.length <= TURNOS_INTEIROS) return { mensagens: hist, compactada: 'nenhuma' };
  const corte = idx[idx.length - TURNOS_INTEIROS];
  const guardados = resultadosReaproveitaveis(hist, resultados, versao);
  const porId = new Map([...guardados.values()].map((g) => [g.id, g]));
  const rotulos = rotulosConsultas(hist);
  const consultasIds = new Set(rotulos.keys());
  const respondeIds = new Set<string>();
  for (const m of hist.slice(0, corte)) {
    if (m.role === 'assistant' && Array.isArray(m.content)) for (const b of m.content) if (b.type === 'tool_use' && b.name === 'responder' && b.id) respondeIds.add(b.id);
  }
  const antigas = hist.slice(0, corte).map((m): Mensagem => {
    if (!Array.isArray(m.content)) return m;
    if (m.role === 'user') {
      return { ...m, content: m.content.map((b) => {
        if (b.type === 'tool_result' && consultasIds.has(String(b.tool_use_id))) return { ...b, content: resumoDoResultado(b.content, rotulos.get(String(b.tool_use_id))!, porId.get(String(b.tool_use_id))) };
        return semCatalogo(b);
      }) };
    }
    return { ...m, content: m.content.map((b) => (b.type === 'tool_use' && b.name === 'responder' ? { ...b, input: respostaEnxuta(b.input) } : b)) };
  });
  const comTabelasEnxutas = [...antigas, ...hist.slice(corte)];
  if (idx.length - TURNOS_INTEIROS <= MAX_TURNOS_ANTES_DO_RESUMO && JSON.stringify(comTabelasEnxutas).length <= MAX_BYTES_ANTES_DO_RESUMO) {
    return { mensagens: comTabelasEnxutas, compactada: 'tabelas' };
  }
  const resumo = resumoDoHistorico(hist.slice(0, corte), resultados);
  return {
    mensagens: [
      { role: 'user', content: [{ type: 'text', text: resumo }] },
      { role: 'assistant', content: [{ type: 'text', text: t('Resumo registrado. Sigo com as perguntas seguintes.', 'Summary noted. Continuing with the next questions.') }] },
      ...hist.slice(corte),
    ],
    compactada: 'resumo',
  };
}

export const perguntaAtual = (hist: Mensagem[]) => textoDaPergunta(hist.filter(ehPergunta).at(-1) ?? { role: 'user', content: '' });

// ---------------- erros que o modelo corrige sozinho ----------------

/** Dica para erros de execução que têm conserto conhecido (o texto volta ao modelo junto do erro). */
export function dicaDoErro(msg: string): string {
  if (/overflow|out of range|decimal/i.test(msg) && /decimal|numeric|overflow/i.test(msg)) {
    return t(`${msg}. Estouro de DECIMAL: converta as colunas monetárias com CAST(coluna AS DOUBLE) (ou ::DOUBLE) antes de multiplicar, dividir ou somar valores reais; some e só depois aplique o fator (rais_uf e rais_mun já trazem DOUBLE).`,
      `${msg}. DECIMAL overflow: cast monetary columns with CAST(column AS DOUBLE) (or ::DOUBLE) before multiplying, dividing or summing real values.`);
  }
  return msg;
}

// ---------------- coerência entre pergunta, filtros executados e texto ----------------

const TEMAS: [string, RegExp][] = [
  ['bovinos', /\b(bovin\w*|gado|frigor[ií]fic\w*)\b/i],
  ['aves', /\b(avicult\w*|aves|frango\w*|galin\w*)\b/i],
  ['suínos', /\b(su[ií]n\w*|porc\w*)\b/i],
  ['pescados', /\b(pescad\w*|pesca|aquicult\w*)\b/i],
];

/**
 * Problemas de coerência: tema citado na conclusão ou nos títulos que não está na pergunta nem nos filtros executados
 * (ex.: cadeia bovina numa resposta sobre avicultura), e classe e subclasse CNAE no mesmo filtro (a subclasse já está na classe).
 */
export function incoerenciasDoRecorte(pergunta: string, o: { conclusao: string; titulos: string; sqls: string[]; objetivos: string[] }): string[] {
  const problemas: string[] = [];
  const naPergunta = TEMAS.filter(([, re]) => re.test(pergunta)).map(([n]) => n);
  const nosFiltros = `${o.sqls.join('\n')}\n${o.objetivos.join('\n')}`;
  if (naPergunta.length) {
    const fora = TEMAS.filter(([n, re]) => !naPergunta.includes(n) && re.test(`${o.conclusao}\n${o.titulos}`) && !re.test(nosFiltros)).map(([n]) => n);
    if (fora.length) {
      problemas.push(`A conclusão ou os títulos citam ${fora.join(', ')}, tema que não está na pergunta nem nos filtros executados. Mantenha tema, território, período e filtros do texto iguais aos das consultas; se a menção é uma ressalva sobre o que um código CNAE abrange, ponha-a em limitações, não na conclusão ou no título.`);
    }
  }
  for (const sql of o.sqls) {
    const s = sql.replace(/--[^\n]*/g, ' ');
    if (!/cnae/i.test(s) || /\bcase\b/i.test(s)) continue;
    const codigos = [...new Set([...s.matchAll(/'(\d{5}|\d{7})'/g)].map((m) => m[1]))];
    const classes = codigos.filter((c) => c.length === 5);
    const dentro = codigos.filter((c) => c.length === 7 && classes.includes(c.slice(0, 5)));
    if (dentro.length) {
      problemas.push(`CNAE: a subclasse ${dentro.join(', ')} já está dentro da classe ${[...new Set(dentro.map((c) => c.slice(0, 5)))].join(', ')} usada no mesmo filtro; combinar as duas conta os mesmos vínculos em dobro. Use só a classe ou só a subclasse.`);
    }
  }
  return problemas;
}

// ---------------- afirmações de tendência ----------------

const CONTINUO_SOBE = /(crescimento|aumento|alta|expans[ãa]o)\s+(cont[íi]nu[oa]|ininterrupt[oa]|constante|sistem[áa]tic[oa])|cresc(eu|eram)\s+(continuamente|ininterruptamente|todos\s+os\s+anos|a\s+cada\s+ano|ano\s+a\s+ano)|sem\s+(nenhuma\s+)?queda/i;
const CONTINUO_CAI = /(queda|redu[çc][ãa]o|diminui[çc][ãa]o|decl[íi]nio)\s+(cont[íi]nu[oa]|ininterrupt[oa]|constante)|(caiu|ca[íi]ram|diminuiu|diminu[íi]ram|reduziu|reduziram)\s+(continuamente|ininterruptamente|todos\s+os\s+anos|a\s+cada\s+ano|ano\s+a\s+ano)|sem\s+(nenhum\s+)?aumento/i;

/**
 * "Crescimento contínuo" ou "queda contínua" no texto contra as séries anuais calculadas (uma linha por ano, três anos
 * ou mais): se nenhuma coluna numérica das consultas usadas é monótona na direção afirmada, a afirmação não tem suporte
 * nos números. Sem série anual nas consultas, nada a conferir.
 */
export function tendenciasSemSuporte(texto: string, consultas: { rotulo: string; colunas: string[]; linhas: unknown[][] }[]): string[] {
  const sobe = CONTINUO_SOBE.test(texto);
  const cai = CONTINUO_CAI.test(texto);
  if (!sobe && !cai) return [];
  let temSerie = false;
  let sobeEmAlguma = false;
  let caiEmAlguma = false;
  for (const c of consultas) {
    const iAno = c.colunas.findIndex((x) => /^(ano|exercicio)$/i.test(x));
    if (iAno < 0) continue;
    const anos = c.linhas.map((l) => l[iAno]);
    if (anos.length < 3 || new Set(anos).size !== anos.length || !anos.every((a) => typeof a === 'number')) continue;
    const ordem = c.linhas.map((l, i) => i).sort((a, b) => Number(anos[a]) - Number(anos[b]));
    for (const [j, nome] of c.colunas.entries()) {
      if (j === iAno || /^(uf|cod|codigo|municipio|cnae|cbo)/i.test(nome)) continue;
      const v = ordem.map((i) => c.linhas[i][j]);
      if (!v.every((x) => typeof x === 'number' && Number.isFinite(x))) continue;
      temSerie = true;
      const d = v.slice(1).map((x, k) => (x as number) - (v[k] as number));
      if (d.every((x) => x >= 0) && d.some((x) => x > 0)) sobeEmAlguma = true;
      if (d.every((x) => x <= 0) && d.some((x) => x < 0)) caiEmAlguma = true;
    }
  }
  if (!temSerie) return [];
  const problemas: string[] = [];
  if (sobe && !sobeEmAlguma) problemas.push('O texto afirma crescimento contínuo (ou ausência de queda), mas nenhuma série anual calculada nas consultas é crescente em todos os anos. Confira os números ano a ano e descreva a trajetória real (altas e quedas, ou o crescimento entre os extremos).');
  if (cai && !caiEmAlguma) problemas.push('O texto afirma queda contínua (ou ausência de aumento), mas nenhuma série anual calculada nas consultas é decrescente em todos os anos. Confira os números ano a ano e descreva a trajetória real.');
  return problemas;
}
