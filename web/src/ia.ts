/**
 * Perguntas à base (página /ia): conversa com o Worker (/api/ia, com login do Cloudflare Access) e
 * execução, aqui no navegador, das consultas SQL que o Claude propõe.
 *
 * Cada pergunta leva o contexto da página (território com os códigos em cada formato, ano de referência,
 * modo de resposta) e termina com a ferramenta "responder": uma resposta estruturada (conclusão,
 * destaques, tabelas, gráficos, ressalvas). As tabelas são montadas pela página com o resultado das
 * consultas (ia_tabelas.ts). Antes de mostrá-la, a página a confere (revisarResposta): cada destaque
 * precisa estar na tabela citada, cada gráfico precisa de colunas que existem, cada leitura precisa de
 * colunas que a sustentem e toda comparação que atravessa uma quebra de série da RAIS precisa dizer isso
 * na conclusão; o que falhar volta ao modelo para ser corrigido. Antes de rodar uma consulta, a página
 * confere os códigos de território (conferirCodigos); lugares citados pelo nome passam pela ferramenta
 * "localizar", que usa o cadastro de entes.
 */
import { consultaLivre, manifestoDados, tabelaLrf, tabelasEducacaoSaude, tabelasIaTrabalho } from './dados';
import { t } from './idioma';
import {
  competenciasNoTexto, formatarValor, periodoDasConsultas, periodoDe, rotuloCompetencia, rotuloPeriodo, tiposDoResultado,
  unidadeLimpa, type Formato, type Periodo,
} from './ia_formato';
import { citaQuebra, leRais, notasDasFontes, quebrasNoPeriodo, versaoDasBases, type NotaMetodologica } from './ia_notas';
import { montarTabela, tabelaTem, type CoberturaFonte, type EspecTabela, type TabelaAnalitica } from './ia_tabelas';
import {
  cadastro, codigosDaUf, codigosDoDf, codigosDoMunicipio, conferirCodigos, executarLocalizacao, nomeDaUf, territoriosNasConsultas,
  UF_NOMES, type Cadastro,
} from './ia_territorio';

export { formatarValor, type Formato } from './ia_formato';
export { nomeDaUf } from './ia_territorio';
export type { EspecTabela, TabelaAnalitica } from './ia_tabelas';

export type Bloco = { type: string; id?: string; name?: string; input?: unknown; text?: string; [k: string]: unknown };
export type Mensagem = { role: 'user' | 'assistant'; content: string | Bloco[] };
/** pode_conferir: o e-mail pode pedir a conferência das respostas pelo especialista RAIS (ia_conferencia.ts). */
export type EstadoIa = { email: string; restantes: number; limite: number; configurada: boolean; modelo?: string; pode_conferir?: boolean };
export type RespostaIa = { conteudo: Bloco[]; parada: string; recusa?: string | null; restantes: number };
/** Resultado de uma consulta; bloqueada = a página recusou a consulta antes de rodá-la (SQL ou códigos). */
export type Resultado = { colunas: string[]; linhas: (string | number | boolean | null)[][]; total: number } | { erro: string; bloqueada?: boolean };

/** Linhas da consulta mostradas na página e enviadas ao modelo. */
export const LINHAS_TELA = 2000;
/** Linhas da exportação de uma tabela maior do que a tela: a consulta roda de novo, inteira, até este limite. */
export const LINHAS_EXPORTACAO = 200_000;
const LINHAS_MODELO = 200;
const TAMANHO_MODELO = 40_000; // caracteres do resultado enviado ao modelo
/** Iguais aos do Worker (worker/src/ia.js). */
export const MAX_RODADAS = 12;
export const MAX_PERGUNTA = 2000;
/** Tabelas por resposta (o esquema da ferramenta responder, no Worker, diz o mesmo). */
export const MAX_TABELAS = 10;
/** Vezes que uma resposta com problemas volta ao modelo; depois disso, a página a mostra com os avisos. */
const MAX_REVISOES = 2;

// ---------------- Worker ----------------

let servidor = '';
/** Testes de ponta a ponta: endereço do Worker local (ex.: http://localhost:8787). */
export function usarServidorIaNoTeste(endereco: string) {
  servidor = endereco.replace(/\/$/, '');
}
const emLocalhost = () => (typeof location === 'undefined' ? /\/\/localhost[:/]/.test(`${servidor}/`) : location.hostname === 'localhost');
/** Endereço de uma rota do Worker da IA (ex.: /api/ia/conversas). */
export const enderecoIa = (caminho: string) => `${servidor}${caminho}`;

/** Falta de acesso, separada das falhas técnicas: sem login ou sessão expirada (entrar de novo) e e-mail sem autorização. */
export class ErroAcesso extends Error {
  constructor(mensagem: string, readonly tipo: 'sessao' | 'negado') {
    super(mensagem);
  }
}
const negado = (corpo: { erro?: string } | null) => new ErroAcesso(corpo?.erro
  ? `${corpo.erro}. ${t('Peça a inclusão do seu e-mail ao LAPAM.', 'Ask LAPAM to add your email.')}`
  : t('seu e-mail não está autorizado a usar a IA. Peça a inclusão ao LAPAM.', 'your email is not authorized to use the AI. Ask LAPAM to add it.'), 'negado');

/** Endereço do login: passa pelo Access e volta para esta página, com os filtros (território, ano, painéis). */
export const urlEntrar = () => `/api/ia/entrar${typeof location === 'undefined' ? '' : `?volta=${encodeURIComponent(location.pathname + location.search)}`}`;

/** Login e perguntas restantes; null quando não há login (o Access redireciona para a tela de entrada). */
export async function estadoIa(): Promise<EstadoIa | null> {
  const r = await fetch(`${servidor}/api/ia/estado`, { redirect: 'manual', credentials: 'same-origin' });
  if (r.status === 403) throw negado(await r.json().catch(() => null));
  if (r.type === 'opaqueredirect' || r.status === 401) return null;
  // no computador local, 502/504 = o Vite não achou o Worker da IA (npx wrangler dev, porta 8787)
  if ((r.status === 502 || r.status === 504) && emLocalhost()) {
    throw new Error(t('O servidor local da IA não está ligado (em worker/: npx wrangler dev, com a chave em worker/.dev.vars).',
      'The local AI server is not running (in worker/: npx wrangler dev, with the key in worker/.dev.vars).'));
  }
  if (!r.ok) throw new Error(`${t('serviço indisponível', 'service unavailable')} (${r.status})`);
  return r.json();
}

/** Painéis que a IA pode consultar (aba "Pergunte aos dados"); cada um tem tabelas e instruções próprias. */
export type Painel = 'financas' | 'trabalho';
export const PAINEIS: Painel[] = ['financas', 'trabalho'];

export async function chamarIa(mensagens: Mensagem[], idioma: string, paineis: Painel[] = PAINEIS, sinal?: AbortSignal): Promise<RespostaIa> {
  const contexto = paineis.includes('trabalho') ? await tabelasIaTrabalho() : undefined;
  // o manifesto só é usado pelo Worker local (wrangler dev), que não tem o do R2
  const manifesto = emLocalhost() && paineis.includes('financas') ? await manifestoDados() : undefined;
  const enviar = () => fetch(`${servidor}/api/ia`, {
    method: 'POST',
    redirect: 'manual',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idioma, mensagens, paineis, contexto, manifesto }),
    signal: sinal,
  });
  // falha de rede antes de qualquer resposta (ex.: conexão reaproveitada que o servidor fechou enquanto as
  // consultas longas rodavam no navegador): uma nova tentativa; o histórico vai inteiro, então repetir é seguro
  const r = await enviar().catch(async (e: unknown) => {
    if (sinal?.aborted || foiCancelado(e) || !(e instanceof TypeError)) throw e;
    await new Promise((ok) => setTimeout(ok, 800));
    return enviar();
  });
  // o Access redireciona (sessão do Access vencida) ou o Worker recusa o token: entrar de novo, sem perder a pergunta
  if (r.type === 'opaqueredirect' || r.status === 401) throw new ErroAcesso(t('sessão expirada: entre de novo', 'session expired: sign in again'), 'sessao');
  const corpo = await r.json().catch(() => null);
  if (r.status === 403) throw negado(corpo);
  if (!r.ok) throw new Error(corpo?.erro ?? `${t('falha', 'failure')} (${r.status})`);
  return corpo;
}

export const foiCancelado = (e: unknown) => (e as { name?: string } | null)?.name === 'AbortError';
const cancelado = () => new DOMException(t('pergunta cancelada', 'question cancelled'), 'AbortError');

// ---------------- contexto da página ----------------

/** Modo de resposta: rápida (o essencial) ou análise para pesquisa (tabelas completas, análise, metodologia). */
export type Modo = 'rapida' | 'pesquisa';
export const MODOS: Modo[] = ['rapida', 'pesquisa'];
export type Territorio =
  | { tipo: 'brasil' }
  | { tipo: 'uf'; uf: string; nome: string; cod: number }
  | { tipo: 'municipio'; uf: string; nome: string; cod: number }
  | { tipo: 'df' };
/** O que acompanha cada pergunta: painéis, território e ano escolhidos na página e o modo de resposta. */
export type ContextoIa = { paineis: Painel[]; territorio: Territorio; ano: number | null; modo: Modo };

/** "Brasil", "Goiás (GO)", "Goiânia (GO)", "Distrito Federal". */
export function rotuloTerritorio(tr: Territorio) {
  if (tr.tipo === 'brasil') return t('Brasil', 'Brazil');
  if (tr.tipo === 'df') return t('Distrito Federal', 'Federal District');
  return `${tr.tipo === 'uf' ? nomeDaUf(tr.uf) : tr.nome} (${tr.uf})`;
}

export const rotuloModo = (m: Modo) => (m === 'pesquisa' ? t('Análise para pesquisa', 'Research analysis') : t('Resposta rápida', 'Quick answer'));
export const descricaoModo = (m: Modo) => (m === 'pesquisa'
  ? t('Tabelas completas, análise detalhada, fontes e metodologia.', 'Complete tables, detailed analysis, sources and methodology.')
  : t('Resumo dos resultados, com os dados essenciais.', 'Summary of the results, with the essential data.'));
/** Modo guardado no navegador; o antigo "estilo técnico" vira análise para pesquisa. */
export const lerModo = (v: string | null): Modo => (v === 'pesquisa' || v === 'tecnica' ? 'pesquisa' : 'rapida');
/** Ano escolhido na página; sem ele, vale o período que a pergunta pedir (e a resposta mostra o consultado). */
export const rotuloAno = (ano: number | null) => (ano ? t(`Ano de referência ${ano}`, `Reference year ${ano}`) : t('Sem ano de referência', 'No reference year'));

export const mesmoContexto = (a: ContextoIa, b: ContextoIa) =>
  rotuloTerritorio(a.territorio) === rotuloTerritorio(b.territorio) && a.ano === b.ano && a.modo === b.modo && a.paineis.join() === b.paineis.join();

/**
 * Texto do contexto que acompanha a pergunta, para o modelo (em português, como as instruções), com os
 * códigos do território em cada formato das tabelas dos painéis marcados. Sem território, o modelo não
 * deve presumir um: responde para o Brasil, dizendo isso, ou pede esclarecimento.
 */
/**
 * Fontes com e sem dado no ano de referência, para o modelo não supor que todas o têm (ex.: 2026 só no Novo
 * CAGED, até o último mês; o PIB municipal sai com cerca de dois anos de atraso).
 */
export function disponibilidadeNoAno(ano: number, paineis: Painel[], c: Cobertura): string {
  const tem: string[] = [];
  const nao: string[] = [];
  const marcar = (nome: string, ok: boolean, detalhe = '') => (ok ? tem : nao).push(`${nome}${detalhe}`);
  if (paineis.includes('trabalho')) {
    marcar('RAIS', c.rais.includes(ano), c.rais.length ? ` (${c.rais[0]}–${c.rais.at(-1)})` : '');
    if (c.caged) {
      const de = Math.max(c.caged.de, ano * 100 + 1);
      const ate = Math.min(c.caged.ate, ano * 100 + 12);
      marcar('Novo CAGED', de <= ate, de <= ate ? ` (${rotuloCompetencia(de)} a ${rotuloCompetencia(ate)}${ate % 100 < 12 ? ', ano incompleto' : ''})` : '');
    }
  }
  if (paineis.includes('financas')) {
    marcar('DCA', c.dca.includes(ano), c.dca.length ? ` (${c.dca[0]}–${c.dca.at(-1)})` : '');
    if (c.pib) marcar('PIB municipal', ano >= c.pib.de && ano <= c.pib.ate, ` (${c.pib.de}–${c.pib.ate})`);
    if (c.siope?.length) marcar('SIOPE', c.siope.includes(ano));
    if (c.siops?.length) marcar('SIOPS', c.siops.includes(ano));
  }
  return [tem.length ? `com dados nesse ano: ${tem.join('; ')}` : 'nenhuma fonte tem dados nesse ano', nao.length ? `sem dados nesse ano: ${nao.join('; ')}` : '']
    .filter(Boolean).join('. ');
}

export function contextoParaModelo(c: ContextoIa, cobertura?: Cobertura | null): string {
  const tr = c.territorio;
  const territorio = tr.tipo === 'brasil'
    ? 'nenhum. Não presuma um território: se a pergunta não indicar um, responda para o Brasil e diga isso; se ela depender de um lugar que não foi dito (ex.: "meu município"), peça esse esclarecimento.'
    : tr.tipo === 'df'
      ? `Distrito Federal. ${codigosDoDf(c.paineis)}`
      : tr.tipo === 'uf'
        ? `${nomeDaUf(tr.uf)} (UF ${tr.uf}). ${codigosDaUf(tr.uf, tr.cod, c.paineis)}`
        : `${tr.nome} (${tr.uf}), município. ${codigosDoMunicipio(tr.cod, c.paineis)}`;
  return [
    'Contexto da página nesta pergunta (vale só para o que a pergunta não especificar; o que ela disser prevalece):',
    `- Território selecionado: ${territorio}`,
    `- Ano de referência: ${c.ano
      ? `${c.ano}${cobertura ? ` (${disponibilidadeNoAno(c.ano, c.paineis, cobertura)})` : ''}`
      : 'não definido. Use o período que a pergunta pedir; sem período, use o ano mais recente disponível e diga qual.'}`,
    `- Modo de resposta: ${c.modo === 'pesquisa' ? 'pesquisa (análise para pesquisa)' : 'rápida (resposta rápida)'}.`,
  ].join('\n');
}

// ---------------- sugestões da tela inicial ----------------

/**
 * Anos e meses com dados em cada fonte (do manifesto): para as sugestões só pedirem o que existe, para o quadro
 * "Dados disponíveis" e para marcar nas tabelas o período pedido que a fonte não tem.
 */
export type Cobertura = {
  rais: number[]; caged: { de: number; ate: number } | null; microdados: boolean; dca: number[];
  pib?: { de: number; ate: number; setorial_ate?: number } | null; siope?: number[]; siopeRemuneracao?: number[]; siops?: number[];
  lrf?: { de: number; ate: number } | null; bolsa?: { de: number; ate: number; mes: number } | null; inss?: number[];
};
export type Sugestao = { categoria: string; texto: string };

/** Formas do território nas frases: "em Goiás" / "no Pará"; sujeito "o Pará"; "de Goiás" / "do Pará". */
function formas(tr: Territorio) {
  if (tr.tipo === 'brasil') return { em: t('no Brasil', 'in Brazil'), sujeito: t('o Brasil', 'Brazil'), de: t('do Brasil', 'in Brazil') };
  if (tr.tipo === 'df') return { em: t('no Distrito Federal', 'in the Federal District'), sujeito: t('o Distrito Federal', 'the Federal District'), de: t('do Distrito Federal', 'in the Federal District') };
  if (tr.tipo === 'municipio') return { em: t(`em ${tr.nome} (${tr.uf})`, `in ${tr.nome} (${tr.uf})`), sujeito: `${tr.nome} (${tr.uf})`, de: t(`de ${tr.nome} (${tr.uf})`, `in ${tr.nome} (${tr.uf})`) };
  const [nome, prep] = UF_NOMES[tr.uf] ?? [tr.nome, 'em'];
  return {
    em: t(`${prep} ${nome}`, `in ${nome}`),
    sujeito: t(`${prep === 'no' ? 'o ' : prep === 'na' ? 'a ' : ''}${nome}`, nome),
    de: t(`${prep === 'no' ? 'do' : prep === 'na' ? 'da' : 'de'} ${nome}`, `in ${nome}`),
  };
}
/** Os municípios do recorte, nas finanças ("dos municípios de Goiás"; o próprio município ou o DF). */
function escopoFinancas(tr: Territorio) {
  if (tr.tipo === 'brasil') return t('dos municípios brasileiros', 'of Brazilian municipalities');
  if (tr.tipo === 'df') return t('do Distrito Federal', 'of the Federal District');
  if (tr.tipo === 'municipio') return t(`de ${tr.nome} (${tr.uf})`, `of ${tr.nome} (${tr.uf})`);
  return t(`dos municípios ${formas(tr).de}`, `of municipalities ${formas(tr).de}`);
}

/**
 * Até quatro perguntas para começar, com os anos que existem nos dados e o território escolhido na página
 * (sem território, o Brasil): evolução, remuneração, comparação e composição, conforme os painéis marcados.
 */
export function sugestoes(paineis: Painel[], tr: Territorio, c: Cobertura, ano: number | null): Sugestao[] {
  const trabalho = paineis.includes('trabalho') && c.rais.length > 0;
  const financas = paineis.includes('financas') && c.dca.length > 0;
  const ult = (anos: number[]) => (ano && anos.includes(ano) ? ano : anos.at(-1)!);
  const recuo = (anos: number[], n: number) => Math.max(anos[0], ult(anos) - n);
  const f = formas(tr);
  const uf = tr.tipo === 'municipio' ? formas({ tipo: 'uf', uf: tr.uf, nome: nomeDaUf(tr.uf), cod: 0 }) : null;
  const cat = {
    evolucao: t('Evolução', 'Trends'), remuneracao: t('Remuneração', 'Pay'), comparacao: t('Comparação', 'Comparison'),
    composicao: t('Composição', 'Composition'), dependencia: t('Dependência', 'Dependency'), cruzamento: t('Entre painéis', 'Across dashboards'),
  };
  const lista: Sugestao[] = [];
  if (trabalho) {
    const a = ult(c.rais);
    const a10 = recuo(c.rais, 10);
    const a5 = recuo(c.rais, 5);
    const comparacao = tr.tipo === 'brasil'
      ? t(`Quais UFs tiveram o maior crescimento percentual do emprego formal entre ${a5} e ${a}?`, `Which states had the largest percentage growth in formal jobs between ${a5} and ${a}?`)
      : tr.tipo === 'municipio'
        ? t(`Como ${f.sujeito} se compara com os demais municípios ${uf!.de} em empregos formais por mil habitantes em ${a}?`,
          `How does ${f.sujeito} compare with other municipalities ${uf!.de} in formal jobs per thousand inhabitants in ${a}?`)
        : t(`Como ${f.sujeito} se compara com o Brasil em empregos formais por mil habitantes e remuneração média em ${a}?`,
          `How does ${f.sujeito} compare with Brazil in formal jobs per thousand inhabitants and average pay in ${a}?`);
    const itens = [
      { categoria: cat.evolucao, texto: t(`Como evoluiu o número de empregos formais ${f.em} de ${a10} a ${a}?`, `How did the number of formal jobs ${f.em} change from ${a10} to ${a}?`) },
      { categoria: cat.remuneracao, texto: t(`Qual era a remuneração média de dezembro ${f.em} em ${a} e como ela variou em termos reais desde ${a5}?`, `What was average December pay ${f.em} in ${a}, and how did it change in real terms since ${a5}?`) },
      { categoria: cat.comparacao, texto: comparacao },
      { categoria: cat.composicao, texto: t(`Como se distribuem os vínculos ativos ${f.em} em ${a} entre os grandes setores da economia e por sexo?`, `How are active jobs ${f.em} in ${a} distributed across broad economic sectors and by sex?`) },
    ];
    lista.push(...(financas ? itens.slice(0, 2) : itens));
  }
  if (financas) {
    const a = ult(c.dca);
    const a10 = recuo(c.dca, 10);
    const esc = escopoFinancas(tr);
    const comparacao = tr.tipo === 'brasil'
      ? t(`Quais os 10 municípios com maior receita corrente per capita em ${a}?`, `Which 10 municipalities had the highest current revenue per capita in ${a}?`)
      : tr.tipo === 'uf'
        ? t(`Quais os 10 municípios ${f.de} com maior receita corrente per capita em ${a}?`, `Which 10 municipalities ${f.de} had the highest current revenue per capita in ${a}?`)
        : tr.tipo === 'municipio'
          ? t(`Como ${f.sujeito} se compara com os demais municípios ${uf!.de} em receita e despesa per capita em ${a}?`, `How does ${f.sujeito} compare with other municipalities ${uf!.de} in revenue and expenditure per capita in ${a}?`)
          : t(`Como o Distrito Federal se compara com os estados em receita corrente per capita em ${a}?`, `How does the Federal District compare with the states in current revenue per capita in ${a}?`);
    const itens = [
      { categoria: cat.evolucao, texto: t(`Como evoluiu a receita corrente per capita ${esc} de ${a10} a ${a}, em valores reais?`, `How did current revenue per capita ${esc} change from ${a10} to ${a}, in real terms?`) },
      { categoria: cat.composicao, texto: t(`Quanto da despesa empenhada ${esc} em ${a} foi para pessoal, saúde e educação?`, `How much of the committed expenditure ${esc} in ${a} went to personnel, health and education?`) },
      { categoria: cat.comparacao, texto: comparacao },
      { categoria: cat.dependencia, texto: t(`Quanto a receita corrente ${esc} depende de transferências, e como isso mudou desde ${a10}?`, `How much does the current revenue ${esc} depend on transfers, and how has that changed since ${a10}?`) },
    ];
    lista.push(...(trabalho ? itens.slice(0, 1) : itens));
  }
  if (trabalho && financas) {
    const a = Math.min(ult(c.rais), ult(c.dca));
    const texto = tr.tipo === 'brasil'
      ? t(`Nas capitais, qual a relação entre a despesa com pessoal e os empregos formais na administração pública em ${a}?`, `In state capitals, how does personnel spending relate to formal public-administration jobs in ${a}?`)
      : tr.tipo === 'uf'
        ? t(`Nos municípios ${f.de}, qual a relação entre a despesa com pessoal e os empregos formais na administração pública em ${a}?`, `In municipalities ${f.de}, how does personnel spending relate to formal public-administration jobs in ${a}?`)
        : t(`Como evoluíram juntos a despesa com pessoal e os empregos formais na administração pública ${f.em} até ${a}?`, `How did personnel spending and formal public-administration jobs ${f.em} evolve together up to ${a}?`);
    lista.push({ categoria: cat.cruzamento, texto });
  }
  return lista.slice(0, 4);
}

/** Exemplo do campo de pergunta, no contexto da página. */
export function exemploPergunta(paineis: Painel[], tr: Territorio, c: Cobertura): string {
  const f = formas(tr);
  if (paineis.includes('trabalho') && c.caged) {
    return t(`Ex.: qual foi o saldo de empregos com carteira ${f.em} nos últimos 12 meses do Novo CAGED?`, `E.g. what was the net change in formal (CLT) jobs ${f.em} over the last 12 months of New CAGED?`);
  }
  if (paineis.includes('trabalho') && c.rais.length) {
    return t(`Ex.: quantos empregos formais havia ${f.em} em ${c.rais.at(-1)}?`, `E.g. how many formal jobs were there ${f.em} in ${c.rais.at(-1)}?`);
  }
  if (c.dca.length) {
    return t(`Ex.: qual foi a receita corrente per capita ${escopoFinancas(tr)} em ${c.dca.at(-1)}?`, `E.g. what was the current revenue per capita ${escopoFinancas(tr)} in ${c.dca.at(-1)}?`);
  }
  return t('Escreva sua pergunta…', 'Type your question…');
}

/** O que cada painel marcado tem, em uma linha por fonte. */
export function descreverCobertura(paineis: Painel[], c: Cobertura): string[] {
  const linhas: string[] = [];
  const faixa = (de: number, ate: number) => (de === ate ? String(de) : `${de}–${ate}`);
  // anos seguidos viram intervalos: 2017, 2019–2025
  const anosLista = (a: number[]) => {
    const partes: string[] = [];
    for (let i = 0; i < a.length; i++) {
      let j = i;
      while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
      partes.push(faixa(a[i], a[j]));
      i = j;
    }
    return partes.join(', ');
  };
  if (paineis.includes('trabalho') && c.rais.length) {
    linhas.push(t(`RAIS ${c.rais[0]}–${c.rais.at(-1)}: vínculos de emprego formal${c.microdados ? ', com microdados por vínculo' : ''}`,
      `RAIS ${c.rais[0]}–${c.rais.at(-1)}: formal employment records${c.microdados ? ', with job-level microdata' : ''}`));
  }
  if (paineis.includes('trabalho') && c.caged) {
    linhas.push(t(`Novo CAGED ${rotuloCompetencia(c.caged.de)}–${rotuloCompetencia(c.caged.ate)}: admissões e desligamentos mensais`,
      `New CAGED ${rotuloCompetencia(c.caged.de)}–${rotuloCompetencia(c.caged.ate)}: monthly hirings and separations`));
  }
  if (paineis.includes('financas') && c.dca.length) {
    linhas.push(t(`DCA ${c.dca[0]}–${c.dca.at(-1)}: receitas, despesas e patrimônio de municípios, estados e DF, com PIB, IPCA, Bolsa Família e INSS`,
      `DCA ${c.dca[0]}–${c.dca.at(-1)}: revenue, expenditure and balance sheets of municipalities, states and DF, with GDP, IPCA, Bolsa Família and INSS`));
  }
  if (paineis.includes('financas') && c.pib) {
    linhas.push(t(`PIB municipal (IBGE) ${faixa(c.pib.de, c.pib.ate)}${c.pib.setorial_ate ? `, valor adicionado por setor até ${c.pib.setorial_ate}` : ''}: anos posteriores ainda não publicados`,
      `Municipal GDP (IBGE) ${faixa(c.pib.de, c.pib.ate)}${c.pib.setorial_ate ? `, value added by sector up to ${c.pib.setorial_ate}` : ''}: later years not yet published`));
  }
  if (paineis.includes('financas') && (c.bolsa || c.inss?.length)) {
    const partes = [
      c.bolsa && t(`Bolsa Família ${faixa(c.bolsa.de, c.bolsa.ate)} (até ${rotuloCompetencia(c.bolsa.mes)})`, `Bolsa Família ${faixa(c.bolsa.de, c.bolsa.ate)} (up to ${rotuloCompetencia(c.bolsa.mes)})`),
      c.inss?.length && t(`benefícios do INSS ${anosLista(c.inss)}`, `INSS benefits ${anosLista(c.inss)}`),
    ].filter(Boolean);
    linhas.push(t(`${partes.join('; ')}: municípios e DF`, `${partes.join('; ')}: municipalities and DF`));
  }
  if (paineis.includes('financas') && c.siope?.length) {
    const rem = c.siopeRemuneracao?.length ? c.siopeRemuneracao.map(rotuloCompetencia).join(', ') : '';
    linhas.push(t(`SIOPE (educação) ${anosLista(c.siope)}: indicadores, receitas e despesas declarados por municípios, estados e DF${rem ? `; remuneração dos profissionais em ${rem}` : ''}`,
      `SIOPE (education) ${anosLista(c.siope)}: indicators, revenue and expenditure reported by municipalities, states and DF${rem ? `; staff pay in ${rem}` : ''}`));
  }
  if (paineis.includes('financas') && c.siops?.length) {
    linhas.push(t(`SIOPS (saúde) ${anosLista(c.siops)}: indicadores declarados pelos municípios (sem estados nem DF)`,
      `SIOPS (health) ${anosLista(c.siops)}: indicators reported by municipalities (no states or DF)`));
  }
  if (paineis.includes('financas')) {
    linhas.push(c.lrf
      ? t(`RREO e RGF (LRF) ${faixa(c.lrf.de, c.lrf.ate)}: RCL, pessoal, dívida e mínimos de saúde e educação`, `RREO and RGF (LRF) ${faixa(c.lrf.de, c.lrf.ate)}: net current revenue, personnel, debt and health and education minimums`)
      : t('RREO e RGF (LRF): em preparação, ainda não consultáveis pela IA', 'RREO and RGF (LRF): in preparation, not yet available to the AI'));
  }
  return linhas;
}

// ---------------- histórico ----------------

/** Pergunta = mensagem do usuário com texto (as que só trazem resultados de ferramenta não são). */
export const ehPergunta = (m: Mensagem) => m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text'));
/** A pergunta é sempre o último texto da mensagem; antes dele vem o contexto da página. */
export const textoDaPergunta = (m: Mensagem) =>
  typeof m.content === 'string' ? m.content : (m.content.filter((b) => b.type === 'text').at(-1)?.text ?? '');

/**
 * Acrescenta a pergunta ao histórico. Se a resposta anterior terminou numa chamada de ferramenta (a de
 * "responder", ou consultas que não chegaram a rodar), os resultados dela vão no começo da mesma mensagem,
 * como a API exige; se ele termina em resultados (a pergunta anterior parou no limite de consultas), a
 * pergunta entra nessa mensagem.
 */
export function comPergunta(hist: Mensagem[], pergunta: string, contexto: string): Mensagem[] {
  const textos: Bloco[] = [{ type: 'text', text: contexto }, { type: 'text', text: pergunta }];
  const ultima = hist.at(-1);
  if (ultima?.role === 'user' && Array.isArray(ultima.content)) {
    return [...hist.slice(0, -1), { role: 'user', content: [...ultima.content, ...textos] }];
  }
  const pendentes: Bloco[] = ultima?.role === 'assistant' && Array.isArray(ultima.content)
    ? ultima.content.filter((b) => b.type === 'tool_use' && b.id).map((b) => ({
      type: 'tool_result',
      tool_use_id: b.id,
      content: b.name === 'responder' ? 'Resposta exibida ao usuário.' : 'Consulta não executada: a pergunta anterior foi encerrada.',
    }))
    : [];
  return [...hist, { role: 'user', content: [...pendentes, ...textos] }];
}

/**
 * Tira a última pergunta (para editá-la) e o que veio depois dela. Resultados de ferramenta que estavam
 * na mesma mensagem continuam no histórico, para a próxima pergunta não perdê-los.
 */
export function semUltimaPergunta(hist: Mensagem[]): Mensagem[] {
  const i = hist.findLastIndex(ehPergunta);
  if (i < 0) return hist;
  const m = hist[i];
  const resultados = Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result') : [];
  return [...hist.slice(0, i), ...(resultados.length ? [{ role: 'user' as const, content: resultados }] : [])];
}

/** Identificadores das consultas da conversa (C1, C2…), na ordem em que o modelo as pediu. */
export function rotulosConsultas(mensagens: Mensagem[]): Map<string, string> {
  const r = new Map<string, string>();
  for (const m of mensagens) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (b.type === 'tool_use' && b.name === 'consultar' && b.id && !r.has(b.id)) r.set(b.id, `C${r.size + 1}`);
  }
  return r;
}

/** Uma consulta da conversa: identificador, SQL, objetivo, a que ela refaz (se refaz) e o resultado. */
export type ConsultaFeita = { id: string; rotulo: string; sql: string; objetivo: string; substitui: string; resultado?: Resultado };

/** Consultas da conversa pelo identificador (C1…), com os resultados que a página guardou. */
export function consultasDaConversa(mensagens: Mensagem[], resultados: Record<string, Resultado>): Map<string, ConsultaFeita> {
  const rotulos = rotulosConsultas(mensagens);
  const r = new Map<string, ConsultaFeita>();
  for (const m of mensagens) {
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_use' || b.name !== 'consultar' || !b.id) continue;
      const e = (b.input ?? {}) as { sql?: unknown; objetivo?: unknown; substitui?: unknown };
      const rotulo = rotulos.get(b.id)!;
      r.set(rotulo, { id: b.id, rotulo, sql: String(e.sql ?? ''), objetivo: String(e.objetivo ?? ''), substitui: linha(e.substitui, 12), resultado: resultados[b.id] });
    }
  }
  return r;
}

// ---------------- resposta estruturada ----------------

const FORMATOS: Formato[] = ['inteiro', 'decimal', 'reais', 'percentual'];
export type Destaque = { rotulo: string; valor: number; formato: Formato; unidade: string; consulta: string; coluna: string; de: string; ate: string };
/** Leitura dos dados que vai além da descrição, com a consulta e as colunas que a sustentam. */
export type Leitura = { texto: string; consulta: string; colunas: string[] };
export type GraficoIa = { consulta: string; tipo: 'linha' | 'barras'; titulo: string; x: string; y: string[]; serie: string; formato: Formato };
export type RespostaFinal = {
  tipo: 'resposta' | 'esclarecimento' | 'fora_da_cobertura';
  conclusao: string;
  destaques: Destaque[];
  explicacao: string;
  interpretacao: Leitura[];
  hipoteses: string;
  limitacoes: string;
  recorte: { territorio: string; periodo_solicitado: string; periodo: string; unidade: string; filtros: string; agrupamentos: string };
  metodologia: string;
  tabelas: EspecTabela[];
  /** Tabelas pedidas além de MAX_TABELAS: não entram na página e voltam ao modelo como problema. */
  tabelasAlem?: number;
  graficos: GraficoIa[];
  aprofundar: string[];
};

/**
 * Texto de um campo da resposta. Desfaz escapes que o modelo às vezes repete dentro do JSON (a partir da
 * segunda pergunta, "Remuneração" e "\n" chegavam como texto); em prosa, essas sequências não ocorrem.
 * Competências escritas como número ("202509") viram "set/2025".
 */
const texto = (v: unknown, max = 6000) => (typeof v === 'string'
  ? competenciasNoTexto(v.replace(/\\u([0-9a-fA-F]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, '\n').trim().slice(0, max))
  : '');
/** Rótulos e campos curtos ficam numa linha só. */
const linha = (v: unknown, max: number) => texto(v, max).replace(/\s*\n\s*/g, ' ');
const umFormato = (v: unknown): Formato => (FORMATOS.includes(v as Formato) ? (v as Formato) : 'decimal');
function lista<T>(v: unknown, ler: (x: Record<string, unknown>) => T | null, max: number): T[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => (x && typeof x === 'object' ? ler(x as Record<string, unknown>) : null)).filter((x): x is T => x !== null).slice(0, max);
}
const colunasDe = (v: unknown) => (Array.isArray(v) ? v.map((c) => linha(c, 120)).filter(Boolean).slice(0, 6) : []);

/** Marcação da chamada de ferramenta que vazou para dentro de um texto: sinal de resposta malformada. */
const MARCACAO = /<\/?(parameter|invoke|conclusao|destaques|explicacao|interpretacao|hipoteses|limitacoes|recorte|metodologia|tabelas|graficos|aprofundar)\b/i;

/**
 * Entrada da ferramenta "responder" (os campos vêm no objeto "resposta"), conferida campo a campo.
 * null se não houver conclusão ou se algum texto trouxer marcação da chamada (campos misturados).
 */
export function lerResposta(v: unknown): RespostaFinal | null {
  if (!v || typeof v !== 'object') return null;
  const bruto = v as Record<string, unknown>;
  // sem o modo estrito (o Worker repete sem ele quando a API recusa a gramática) o objeto pode vir como texto JSON
  let dentro = bruto.resposta;
  if (typeof dentro === 'string') try { dentro = JSON.parse(dentro); } catch { /* fica o texto: sem conclusão, volta null */ }
  const o = (dentro && typeof dentro === 'object' ? dentro : bruto) as Record<string, unknown>;
  const conclusao = texto(o.conclusao, 2000);
  if (!conclusao || MARCACAO.test(JSON.stringify(o))) return null;
  const r = (o.recorte && typeof o.recorte === 'object' ? o.recorte : {}) as Record<string, unknown>;
  return {
    tipo: o.tipo === 'esclarecimento' || o.tipo === 'fora_da_cobertura' ? o.tipo : 'resposta',
    conclusao,
    destaques: lista(o.destaques, (d) => (typeof d.valor === 'number' && Number.isFinite(d.valor) && texto(d.rotulo)
      ? {
        rotulo: linha(d.rotulo, 120), valor: d.valor, formato: umFormato(d.formato), unidade: linha(d.unidade, 80),
        consulta: linha(d.consulta, 12), coluna: linha(d.coluna, 120), de: linha(d.de, 20), ate: linha(d.ate, 20),
      }
      : null), 4),
    explicacao: texto(o.explicacao),
    // um texto solto (formato antigo) vira uma leitura sem colunas de apoio, que a conferência aponta
    interpretacao: Array.isArray(o.interpretacao)
      ? lista(o.interpretacao, (x) => (texto(x.texto) ? { texto: texto(x.texto, 1500), consulta: linha(x.consulta, 12), colunas: colunasDe(x.colunas) } : null), 5)
      : texto(o.interpretacao) ? [{ texto: texto(o.interpretacao, 1500), consulta: '', colunas: [] }] : [],
    hipoteses: texto(o.hipoteses),
    limitacoes: texto(o.limitacoes),
    recorte: {
      territorio: linha(r.territorio, 300), periodo_solicitado: linha(r.periodo_solicitado, 300), periodo: linha(r.periodo, 300),
      unidade: linha(r.unidade, 300), filtros: linha(r.filtros, 600), agrupamentos: linha(r.agrupamentos, 600),
    },
    metodologia: texto(o.metodologia, 8000),
    tabelas: lista(o.tabelas, (x) => (texto(x.consulta)
      ? {
        consulta: linha(x.consulta, 12),
        papel: x.papel === 'alternativa' || x.papel === 'complemento' ? x.papel : 'principal',
        tipo: x.tipo === 'serie' || x.tipo === 'comparacao' ? x.tipo : 'tabela',
        titulo: linha(x.titulo, 200), grupo: linha(x.grupo, 120), periodo: linha(x.periodo, 120), valor: linha(x.valor, 120),
        colunas: Array.isArray(x.colunas) ? x.colunas.map((c) => linha(c, 120)).filter(Boolean).slice(0, 20) : [],
        de: linha(x.de, 20), ate: linha(x.ate, 20), total: x.total === true, participacao: x.participacao === true,
        formato: umFormato(x.formato), unidade: linha(x.unidade, 120), nota: texto(x.nota, 600).replace(/\s*\n\s*/g, ' '),
      } satisfies EspecTabela
      : null), MAX_TABELAS),
    tabelasAlem: Array.isArray(o.tabelas) ? Math.max(0, o.tabelas.length - MAX_TABELAS) : 0,
    graficos: lista(o.graficos, (g) => {
      const y = Array.isArray(g.y) ? g.y.map((c) => linha(c, 120)).filter(Boolean).slice(0, 3) : [];
      return texto(g.consulta) && texto(g.x) && y.length
        ? { consulta: linha(g.consulta, 12), tipo: g.tipo === 'barras' ? 'barras' : 'linha', titulo: linha(g.titulo, 200), x: linha(g.x, 120), y, serie: linha(g.serie, 120), formato: umFormato(g.formato) }
        : null;
    }, 2),
    aprofundar: Array.isArray(o.aprofundar) ? o.aprofundar.map((p) => linha(p, 300)).filter(Boolean).slice(0, 3) : [],
  };
}

export type Conferencia = 'conferido' | 'divergente' | 'sem_consulta';
const casas = (x: number) => {
  const s = String(x);
  const i = s.indexOf('.');
  return i < 0 || s.includes('e') ? 0 : Math.min(s.length - i - 1, 10);
};

/**
 * O destaque está na tabela da consulta citada? Vale o mesmo número na coluna indicada (ou em qualquer
 * coluna, se o nome não bater), com a precisão em que o modelo o escreveu ou com a mesma forma na tela;
 * percentuais também contra colunas em fração (0,453 = 45,3%).
 */
export function conferir(d: Destaque, r?: Resultado): Conferencia {
  if (!r || 'erro' in r) return 'sem_consulta';
  const j = r.colunas.indexOf(d.coluna);
  const colunas = j >= 0 ? [j] : r.colunas.map((_, i) => i);
  const tolerancia = 0.5 * 10 ** -casas(d.valor) + 1e-9;
  const mostrado = formatarValor(d.valor, d.formato);
  const bate = (v: number) => Math.abs(v - d.valor) <= tolerancia || formatarValor(v, d.formato) === mostrado;
  for (const l of r.linhas) {
    for (const k of colunas) {
      const v = l[k];
      if (typeof v === 'number' && (bate(v) || (d.formato === 'percentual' && bate(v * 100)))) return 'conferido';
    }
  }
  return 'divergente';
}

/** Tabelas → fontes, na ordem em que aparecem na ficha da resposta. */
const FONTES_TABELAS: [RegExp, () => string][] = [
  [/\brais_vinculos\b/, () => t('RAIS (MTE): microdados por vínculo', 'RAIS (MTE): job-level microdata')],
  [/\brais_(uf|mun)\b/, () => t('RAIS (MTE): tabelas somadas dos microdados', 'RAIS (MTE): tables summed from the microdata')],
  [/\btrab_(municipios|setores|setores_uf|grandes_setores)\b/, () => t('RAIS (MTE): séries do painel', 'RAIS (MTE): dashboard series')],
  [/\btrab_caged(_anual|_uf)?\b/, () => t('Novo CAGED (MTE)', 'New CAGED (MTE)')],
  [/\btrab_(dic|cnae)\b/, () => t('Classificações CBO 2002 e CNAE 2.0', 'CBO 2002 and CNAE 2.0 classifications')],
  [/\bindicadores\b/, () => t('SICONFI/Tesouro Nacional: DCA', 'SICONFI/National Treasury: DCA')],
  [/\blrf\b/, () => t('SICONFI/Tesouro Nacional: RREO e RGF', 'SICONFI/National Treasury: RREO and RGF')],
  [/\bsiope_[a-z_]+/, () => t('FNDE: SIOPE (declarações de educação)', 'FNDE: SIOPE (education filings)')],
  [/\bsiops_[a-z_]+/, () => t('Ministério da Saúde: SIOPS (declarações de saúde)', 'Ministry of Health: SIOPS (health filings)')],
  [/\b(pib|vab_[a-z_]+)\b/, () => t('IBGE: PIB dos municípios', 'IBGE: municipal GDP')],
  [/\bpopulacao\b/, () => t('IBGE: estimativas de população', 'IBGE: population estimates')],
  [/\bbolsa_familia_[a-z]+/, () => t('Portal da Transparência: Bolsa Família', 'Transparency Portal: Bolsa Família')],
  [/\binss_[a-z]+/, () => t('Previdência Social: benefícios do INSS', 'Social Security: INSS benefits')],
  [/\bipca\b/, () => t('IPCA (Banco Central, SGS 433)', 'IPCA (Central Bank of Brazil, SGS 433)')],
  [/\b(alertas|escopos)\b/, () => t('LAPAM/UFG: avaliação de qualidade das declarações', 'LAPAM/UFG: quality review of filings')],
  [/\bfaixas\b/, () => t('LAPAM/UFG: faixas populacionais', 'LAPAM/UFG: population brackets')],
  [/\bentes\b/, () => t('SICONFI: cadastro de entes', 'SICONFI: registry of governments')],
];

/** Fontes das tabelas que as consultas (as que deram certo) leram de fato; textos entre aspas não contam. */
export function fontesConsultadas(sqls: string[]): string[] {
  const limpas = sqls.map((s) => s.replace(/'(?:[^']|'')*'/g, "''").toLowerCase());
  return FONTES_TABELAS.filter(([re]) => limpas.some((s) => re.test(s))).map(([, nome]) => nome());
}

// ---------------- gráficos ----------------

export type DadosGrafico = { categorias: (string | number)[]; rotulos: string[]; series: { nome: string; valores: (number | null)[] }[] };
export type ValidacaoGrafico = { ok: true; dados: DadosGrafico } | { ok: false; motivo: string };

/**
 * Confere e monta um gráfico pedido pela IA, só com o resultado da consulta (nunca com números do modelo):
 * as colunas precisam existir, y precisa ser numérico, cada categoria aparece uma vez por série e há
 * valores. Uma tabela de uma linha só não vira gráfico de categorias: precisa de uma linha por categoria.
 * Em formato longo (coluna "serie"), uma série por valor dela, até 3.
 */
export function validarGrafico(g: GraficoIa, r?: Resultado, sql = ''): ValidacaoGrafico {
  const nao = (motivo: string): ValidacaoGrafico => ({ ok: false, motivo });
  if (!r || 'erro' in r) return nao(t(`a consulta ${g.consulta} não existe ou falhou`, `query ${g.consulta} does not exist or failed`));
  if (!r.linhas.length) return nao(t(`a consulta ${g.consulta} não trouxe linhas`, `query ${g.consulta} returned no rows`));
  const faltam = [g.x, ...g.y, ...(g.serie ? [g.serie] : [])].filter((c) => !r.colunas.includes(c));
  if (faltam.length) {
    return nao(t(`${faltam.length === 1 ? 'a coluna' : 'as colunas'} ${faltam.join(', ')} não ${faltam.length === 1 ? 'existe' : 'existem'} em ${g.consulta} (colunas: ${r.colunas.join(', ')})`,
      `column${faltam.length === 1 ? '' : 's'} ${faltam.join(', ')} not found in ${g.consulta} (columns: ${r.colunas.join(', ')})`));
  }
  const ix = r.colunas.indexOf(g.x);
  const iy = g.y.map((c) => r.colunas.indexOf(c));
  const is = g.serie ? r.colunas.indexOf(g.serie) : -1;
  const semNumeros = g.y.filter((_, k) => !r.linhas.some((l) => typeof l[iy[k]] === 'number'));
  if (semNumeros.length) return nao(t(`${semNumeros.join(', ')} não ${semNumeros.length === 1 ? 'é numérica' : 'são numéricas'}`, `${semNumeros.join(', ')} is not numeric`));
  if (r.linhas.length === 1) {
    return nao(t(`${g.consulta} tem uma linha só; para comparar categorias, a consulta precisa de uma linha por categoria (ex.: setor, vinculos, participacao_pct)`,
      `${g.consulta} has a single row; to compare categories the query needs one row per category (e.g. sector, jobs, share_pct)`));
  }
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const unicos = <T,>(xs: T[]) => [...new Set(xs)];
  if (is < 0 && unicos(r.linhas.map((l) => l[ix])).length < r.linhas.length) {
    return nao(t(`os valores de ${g.x} se repetem em ${g.consulta}: indique a coluna serie ou agregue a consulta`, `values of ${g.x} repeat in ${g.consulta}: set the serie column or aggregate the query`));
  }
  let categorias = unicos(r.linhas.map((l) => l[ix])).filter((v): v is string | number => typeof v === 'string' || typeof v === 'number');
  // anos, competências e outros números no eixo x ficam em ordem crescente (a linha do tempo da esquerda para a direita)
  if (g.tipo === 'linha' && categorias.every((v) => typeof v === 'number')) categorias = [...categorias].sort((a, b) => Number(a) - Number(b));
  if (g.tipo === 'barras' && categorias.length > 30) return nao(t('mais de 30 categorias: limite a consulta às principais', 'more than 30 categories: limit the query to the main ones'));
  if (g.tipo === 'linha' && categorias.length < 2) return nao(t('um gráfico de linha precisa de pelo menos dois pontos', 'a line chart needs at least two points'));
  categorias = categorias.slice(0, 200);
  let series: DadosGrafico['series'];
  if (is >= 0) {
    const nomes = unicos(r.linhas.map((l) => String(l[is] ?? '—')));
    if (nomes.length > 3) return nao(t(`mais de 3 séries em ${g.serie}`, `more than 3 series in ${g.serie}`));
    series = nomes.map((nome) => ({
      nome,
      valores: categorias.map((c) => num(r.linhas.find((l) => l[ix] === c && String(l[is] ?? '—') === nome)?.[iy[0]])),
    }));
  } else {
    // barras com mais de uma coluna em y (ex.: vinculos_2013 e vinculos_2021): barras agrupadas, uma série por coluna
    const linhaDe = new Map(r.linhas.map((l) => [l[ix], l]));
    series = iy.map((i) => ({
      nome: r.colunas[i].replace(/_/g, ' '),
      valores: categorias.map((c) => num(linhaDe.get(c)?.[i])),
    }));
  }
  if (!series.some((s) => s.valores.some((v) => v !== null))) return nao(t('sem valores numéricos', 'no numeric values'));
  const tipoX = tiposDoResultado(r, sql)[ix];
  const rotulos = categorias.map((c) => (tipoX === 'competencia' && typeof c === 'number' ? rotuloCompetencia(c) : String(c)));
  return { ok: true, dados: { categorias, rotulos, series } };
}

/** Dados do gráfico ou null quando ele não pode ser montado (ver validarGrafico). */
export function dadosDoGrafico(g: GraficoIa, r?: Resultado): DadosGrafico | null {
  const v = validarGrafico(g, r);
  return v.ok ? v.dados : null;
}

// ---------------- resposta pronta para mostrar (e conferência antes de mostrar) ----------------

export type DestaquePronto = {
  d: Destaque; valor: string; unidade: string; conferencia: Conferencia;
  periodo: Periodo | null; rotuloPeriodo: string; quebras: NotaMetodologica[];
};
export type GraficoPronto = { g: GraficoIa; validacao: ValidacaoGrafico; quebras: NotaMetodologica[]; consulta?: ConsultaFeita };
export type LeituraPronta = Leitura & { motivo: string | null };
/** Tabela pedida pelo modelo: montada com o resultado da consulta, ou o motivo de não poder ser montada. */
export type TabelaPronta = { espec: EspecTabela; tabela: TabelaAnalitica | null; motivo: string | null; consulta?: ConsultaFeita };

/**
 * A tabela com todas as linhas da consulta, para exportar: se a página carregou só parte do resultado, roda a
 * consulta de novo sem o limite da tela (até LINHAS_EXPORTACAO) e monta a tabela outra vez.
 */
export async function tabelaInteira(x: TabelaPronta, cobertura?: Cobertura | null): Promise<TabelaAnalitica | null> {
  const tab = x.tabela;
  if (!tab || !x.consulta || tab.registros <= tab.carregados) return tab;
  const r = await executarConsulta({ sql: x.consulta.sql }, PAINEIS, undefined, Math.min(tab.registros, LINHAS_EXPORTACAO));
  if ('erro' in r) throw new Error(r.erro);
  const m = montarTabela(x.espec, { rotulo: x.consulta.rotulo, sql: x.consulta.sql, resultado: r }, coberturaDaFonte(x.consulta.sql, cobertura));
  if (!m.ok) throw new Error(m.motivo);
  return { ...m.tabela, fonte: tab.fonte };
}
export type RespostaPronta = {
  r: RespostaFinal;
  destaques: DestaquePronto[];
  tabelas: TabelaPronta[];
  /** Períodos pedidos que não vieram nas tabelas principais (ex.: 2011 numa comparação 2011–2021). */
  faltantes: string[];
  graficos: GraficoPronto[];
  leituras: LeituraPronta[];
  /** Hipóteses mostradas: só quando a pergunta pede explicações (as demais ficam no apêndice, marcadas). */
  hipoteses: string;
  hipotesesOmitidas: boolean;
  /** Quebras de série que os números da resposta atravessam (alerta junto da conclusão). */
  alertas: NotaMetodologica[];
  /** Notas verificadas da resposta: as quebras e as das fontes lidas. */
  notas: NotaMetodologica[];
  fontes: string[];
  bases: string[];
  territorios: string[];
  /** Intervalo efetivamente consultado ("2015–2025", "set/2025–ago/2026 (últimos 12 meses)"). */
  periodo: string | null;
  /** Consultas citadas na resposta (destaques, gráficos e leituras). */
  usadas: Set<string>;
  /** Códigos de CBO e CNAE filtrados nas consultas, como foram executados (o recorte real, não o descrito). */
  codigos: string[];
};

const CLASSIFICACOES: Record<string, string> = {
  cbo: 'CBO', cbo_grande_grupo: 'CBO (grande grupo)', cnae_classe: 'CNAE (classe)', cnae_subclasse: 'CNAE (subclasse)',
  cnae_divisao: 'CNAE (divisão)', divisao: 'CNAE (divisão)', cnae_secao: 'CNAE (seção)', secao: 'CNAE (seção)',
};

const EXATOS = ' exatos';

/**
 * Filtros de CBO e CNAE das consultas, lidos do SQL: prefixos (starts_with, LIKE '…%'), listas (IN, =) e
 * limites (<, >, BETWEEN). Ex.: "CBO: começa com 2235; menor que 223570". Os códigos exatos de todas as
 * consultas (IN e =) saem numa lista só, ordenada e sem repetição.
 */
export function codigosDoSql(sqls: string[]): string[] {
  const porVar = new Map<string, { itens: Set<string>; exatos: Set<string> }>();
  const grupo = (v: string) => {
    const k = CLASSIFICACOES[v.toLowerCase()];
    if (!k) return null;
    if (!porVar.has(k)) porVar.set(k, { itens: new Set(), exatos: new Set() });
    return porVar.get(k)!;
  };
  const pos = (v: string, x: string) => grupo(v)?.itens.add(x);
  const exatos = (v: string, codigos: string[]) => {
    const g = grupo(v);
    if (!g) return;
    g.itens.add(EXATOS);
    for (const c of codigos) g.exatos.add(c);
  };
  const col = String.raw`(?:cast\s*\(\s*)?(?:\w+\.)?(cbo|cbo_grande_grupo|cnae_classe|cnae_subclasse|cnae_divisao|divisao|cnae_secao|secao)\b(?:\s+as\s+\w+\s*\))?`;
  for (const sql of sqls) {
    for (const m of sql.matchAll(new RegExp(String.raw`starts_with\s*\(\s*${col}\s*,\s*'([0-9A-Z]+)'\s*\)`, 'gi'))) pos(m[1], t(`começa com ${m[2]}`, `starts with ${m[2]}`));
    for (const m of sql.matchAll(new RegExp(String.raw`${col}\s+i?like\s+'([0-9A-Z]+)%'`, 'gi'))) pos(m[1], t(`começa com ${m[2]}`, `starts with ${m[2]}`));
    for (const m of sql.matchAll(new RegExp(String.raw`${col}\s+(not\s+)?in\s*\(([^)]*)\)`, 'gi'))) {
      const lista = [...m[3].matchAll(/'([0-9A-Z]+)'/gi)].map((x) => x[1]);
      if (lista.length && !m[2]) exatos(m[1], lista);
      else if (lista.length) pos(m[1], `${t('exceto ', 'except ')}${lista.join(', ')}`);
    }
    for (const m of sql.matchAll(new RegExp(String.raw`${col}\s*(<>|!=|=)\s*'([0-9A-Z]+)'`, 'gi'))) {
      if (m[3].toUpperCase() === 'TOTAL') continue; // 'TOTAL' = todas as seções
      if (m[2] === '=') exatos(m[1], [m[3]]);
      else pos(m[1], `${t('exceto ', 'except ')}${m[3]}`);
    }
    for (const m of sql.matchAll(new RegExp(String.raw`${col}\s*(<=|>=|<|>)\s*'([0-9A-Z]+)'`, 'gi'))) {
      const nome = { '<': t('menor que', 'below'), '<=': t('até', 'up to'), '>': t('maior que', 'above'), '>=': t('a partir de', 'from') }[m[2]];
      pos(m[1], `${nome} ${m[3]}`);
    }
    for (const m of sql.matchAll(new RegExp(String.raw`${col}\s+between\s+'([0-9A-Z]+)'\s+and\s+'([0-9A-Z]+)'`, 'gi'))) pos(m[1], t(`de ${m[2]} a ${m[3]}`, `${m[2]} to ${m[3]}`));
  }
  return [...porVar].map(([k, g]) => `${k}: ${[...g.itens].map((x) => (x === EXATOS ? [...g.exatos].sort().join(', ') : x)).join('; ')}`);
}

/** A pergunta pede a tabela com uma linha por município (ex.: "apresente tabela municipal")? */
export const pedeTabelaMunicipal = (pergunta: string) =>
  /\btabela\s+(municipal|por\s+munic[ií]pio|dos\s+munic[ií]pios|com\s+(os|todos\s+os)\s+munic[ií]pios)|\blista\s+(dos|de)\s+munic[ií]pios|\bcada\s+munic[ií]pio\b/i.test(pergunta);

/** Caracteres de controle no meio do texto: o modelo errou o escape de um acento ("Goi\ts" no lugar de "Goiás"). */
const CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\t]/;

const unicas = (notas: NotaMetodologica[]) => [...new Map(notas.map((n) => [n.id, n])).values()];

/** Cobertura da fonte que a consulta lê (RAIS, Novo CAGED, DCA, PIB, SIOPE, SIOPS), para explicar um período pedido que não veio. */
export function coberturaDaFonte(sql: string, c?: Cobertura | null): CoberturaFonte | null {
  if (!c) return null;
  const s = sql.toLowerCase();
  if (/\btrab_caged/.test(s)) return c.caged ? { nome: 'Novo CAGED', meses: c.caged } : null;
  if (/\brais_(uf|mun|vinculos)\b|\btrab_(municipios|setores|setores_uf|grandes_setores)\b/.test(s)) return { nome: 'RAIS', anos: c.rais };
  if (/\bsiops_/.test(s)) return c.siops ? { nome: 'SIOPS', anos: c.siops } : null;
  if (/\bsiope_/.test(s)) return c.siope ? { nome: 'SIOPE', anos: c.siope } : null;
  // PIB e valor adicionado: só os anos publicados pelo IBGE que também têm DCA
  if (/\bindicadores\b/.test(s) && /\b(pib|vab_\w+)\b/.test(s) && c.pib) {
    const pib = c.pib;
    return { nome: t('PIB municipal (IBGE)', 'Municipal GDP (IBGE)'), anos: c.dca.filter((a) => a >= pib.de && a <= pib.ate) };
  }
  if (/\blrf\b/.test(s) && c.lrf) {
    const lrf = c.lrf;
    return { nome: 'RREO/RGF', anos: c.dca.filter((a) => a >= lrf.de && a <= lrf.ate) };
  }
  if (/\b(indicadores|lrf)\b/.test(s)) return { nome: t('DCA (SICONFI)', 'DCA (SICONFI)'), anos: c.dca };
  return null;
}

/** "Nominal" e "real" só fazem sentido em valores monetários: saem do rótulo e da unidade das contagens. */
export const semNominal = (s: string, f: Formato) => (f === 'reais' || /R\$/.test(s)
  ? s
  : s.replace(/\s*\b(nominal|nominais|em termos reais|real|reais)\b/gi, '').replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim());

/** Período das consultas ampliado pelos períodos dos destaques (anos com anos, competências com competências). */
function juntarPeriodos(c: { anos: Periodo | null; meses: Periodo | null }, extras: (Periodo | null)[]) {
  const r = { ...c };
  for (const x of extras) {
    if (!x) continue;
    const k = x.tipo === 'ano' ? 'anos' : 'meses';
    const atual = r[k];
    r[k] = atual ? { tipo: x.tipo, de: Math.min(atual.de, x.de), ate: Math.max(atual.ate, x.ate) } : x;
  }
  return r;
}

/** Período a que o destaque se refere: o informado (de, ate); sem ele, os anos no nome da coluna ou a linha da tabela. */
function periodoDoDestaque(d: Destaque, c?: ConsultaFeita): Periodo | null {
  const p = periodoDe(d.de, d.ate);
  if (p) return p;
  const anos = [...d.coluna.matchAll(/(?:^|_)((?:19|20)\d{2})(?=_|$)/g)].map((m) => Number(m[1]));
  if (anos.length) return { tipo: 'ano', de: Math.min(...anos), ate: Math.max(...anos) };
  const r = c?.resultado;
  if (!r || 'erro' in r) return null;
  const j = r.colunas.indexOf(d.coluna);
  const tipos = tiposDoResultado(r, c!.sql);
  const k = tipos.findIndex((x) => x === 'ano' || x === 'competencia');
  if (j < 0 || k < 0) return null;
  const achada = r.linhas.filter((l) => typeof l[j] === 'number' && conferir(d, { ...r, linhas: [l] }) === 'conferido');
  const v = achada.length === 1 ? achada[0][k] : null;
  return typeof v === 'number' ? { tipo: tipos[k] === 'ano' ? 'ano' : 'mes', de: v, ate: v } : null;
}

/** Quebras de série que a linha do tempo de um gráfico da RAIS atravessa (marcadas no ano da mudança). */
function quebrasDoGrafico(v: ValidacaoGrafico, c?: ConsultaFeita): NotaMetodologica[] {
  if (!v.ok || !c || !leRais(c.sql)) return [];
  const anos = v.dados.categorias.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 1900 && x <= 2100);
  return anos.length >= 2 ? quebrasNoPeriodo({ tipo: 'ano', de: Math.min(...anos), ate: Math.max(...anos) }) : [];
}

function conferirLeitura(l: Leitura, consultas: Map<string, ConsultaFeita>): string | null {
  if (!l.consulta || !l.colunas.length) return t('não cita a consulta e as colunas que a sustentam', 'it does not cite the query and columns that support it');
  const r = consultas.get(l.consulta)?.resultado;
  if (!r || 'erro' in r) return t(`a consulta ${l.consulta} não existe ou falhou`, `query ${l.consulta} does not exist or failed`);
  const faltam = l.colunas.filter((c) => !r.colunas.includes(c));
  return faltam.length ? t(`as colunas ${faltam.join(', ')} não existem em ${l.consulta}`, `columns ${faltam.join(', ')} not found in ${l.consulta}`) : null;
}

/**
 * Resposta pronta para a página, a cópia e o PDF: destaques formatados e conferidos, com período e quebras
 * de série; gráficos validados; leituras com o motivo de recusa; hipóteses só se a pergunta pede
 * explicações; período, território e fontes tirados das consultas (não do texto do modelo).
 * `doTurno`: identificadores das consultas da pergunta; `pergunta`: o texto dela.
 */
export function prepararResposta(r: RespostaFinal, consultas: Map<string, ConsultaFeita>, o: {
  doTurno?: string[]; pergunta?: string; cadastro?: Cadastro | null; ultimaCompetencia?: number | null; fontes?: Record<string, Record<string, unknown>>;
  cobertura?: Cobertura | null;
} = {}): RespostaPronta {
  const hipotesesOmitidas = !!r.hipoteses && o.pergunta !== undefined && !pedeExplicacao(o.pergunta);
  // tabelas montadas pela página com o resultado das consultas (totais, variações e participações calculados aqui)
  const tabelas = r.tabelas.map((espec): TabelaPronta => {
    const c = consultas.get(espec.consulta);
    if (!c) return { espec, tabela: null, motivo: t(`a consulta ${espec.consulta || '(vazia)'} não existe`, `query ${espec.consulta || '(empty)'} does not exist`) };
    const m = montarTabela(espec, c, coberturaDaFonte(c.sql, o.cobertura));
    if (!m.ok) return { espec, tabela: null, motivo: m.motivo, consulta: c };
    return { espec, tabela: { ...m.tabela, fonte: fontesConsultadas([c.sql]).join('; ') }, motivo: null, consulta: c };
  });
  const destaques = r.destaques.map((d): DestaquePronto => {
    const c = consultas.get(d.consulta);
    const periodo = periodoDoDestaque(d, c);
    let conferencia = conferir(d, c?.resultado);
    // números calculados pela página nas tabelas da mesma consulta (total, variação) também valem
    if (conferencia === 'divergente' && tabelas.some((x) => x.tabela && x.espec.consulta === d.consulta && tabelaTem(x.tabela, d.valor, 0.5 * 10 ** -casas(d.valor) + 1e-9))) {
      conferencia = 'conferido';
    }
    return {
      d: { ...d, rotulo: semNominal(d.rotulo, d.formato) }, valor: formatarValor(d.valor, d.formato), unidade: semNominal(unidadeLimpa(d.unidade, d.formato), d.formato),
      conferencia, periodo, rotuloPeriodo: periodo ? rotuloPeriodo(periodo, o.ultimaCompetencia) : '', quebras: c && leRais(c.sql) ? quebrasNoPeriodo(periodo) : [],
    };
  });
  const graficos = r.graficos.map((g): GraficoPronto => {
    const c = consultas.get(g.consulta);
    const validacao = validarGrafico(g, c?.resultado, c?.sql);
    return { g, validacao, quebras: quebrasDoGrafico(validacao, c), consulta: c };
  });
  const leituras = r.interpretacao.map((l): LeituraPronta => ({ ...l, motivo: conferirLeitura(l, consultas) }));
  const usadas = new Set([...r.destaques.map((d) => d.consulta), ...r.tabelas.map((x) => x.consulta), ...r.graficos.map((g) => g.consulta),
    ...r.interpretacao.map((l) => l.consulta)].filter((x) => consultas.has(x)));
  const ok = (c?: ConsultaFeita): c is ConsultaFeita => !!c?.resultado && !('erro' in c.resultado);
  const doTurno = (o.doTurno ?? []).map((x) => consultas.get(x)).filter(ok);
  const citadas = [...usadas].map((x) => consultas.get(x)).filter(ok);
  // consultas de perguntas anteriores citadas num destaque entram só com o período do destaque (o total de
  // 2025 tirado da série 2015–2025 é de 2025), não com o intervalo inteiro da consulta
  const proprias = o.doTurno ? citadas.filter((c) => o.doTurno!.includes(c.rotulo)) : citadas;
  const base = proprias.length ? proprias : citadas.length ? [] : doTurno;
  // com tabelas montadas, o período utilizado é o que tinha dado nelas (consultas auxiliares com o filtro do pedido
  // não contam); sem tabelas, o das consultas
  const intervalos = tabelas.flatMap((x) => (x.tabela?.intervalo ? [x.tabela.intervalo] : []));
  const p = juntarPeriodos(intervalos.length ? { anos: null, meses: null } : periodoDasConsultas(base), [...intervalos, ...destaques.map((d) => d.periodo)]);
  // números da RAIS lidos ao longo de anos que atravessam uma mudança de captação, mesmo sem destaque de variação
  const doPeriodo = quebrasNoPeriodo(periodoDasConsultas(base.filter((c) => leRais(c.sql))).anos);
  const alertas = unicas([...destaques.flatMap((d) => d.quebras), ...graficos.flatMap((g) => g.quebras), ...doPeriodo])
    .sort((a, b) => (a.quebra ?? 0) - (b.quebra ?? 0));
  const sqls = (doTurno.length ? doTurno : citadas).map((c) => c.sql);
  const faltantes = [...new Set(tabelas.filter((x) => x.espec.papel === 'principal').flatMap((x) => x.tabela?.faltantes ?? []))];
  return {
    r, destaques, tabelas, faltantes, graficos, leituras, alertas, hipoteses: hipotesesOmitidas ? '' : r.hipoteses, hipotesesOmitidas,
    notas: unicas([...alertas, ...notasDasFontes(sqls)]),
    // só as consultas que sustentam a resposta: as de exploração (achar os códigos, testar um filtro) não são o recorte
    codigos: codigosDoSql((citadas.length ? citadas : doTurno).map((c) => c.sql)),
    fontes: fontesConsultadas(sqls),
    bases: versaoDasBases(sqls, o.fontes),
    territorios: territoriosNasConsultas((base.length ? base : citadas).map((c) => c.sql), o.cadastro ?? null),
    periodo: [p.anos && rotuloPeriodo(p.anos), p.meses && rotuloPeriodo(p.meses, o.ultimaCompetencia)].filter(Boolean).join(' · ') || null,
    usadas,
  };
}

const resumo = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
/** A pergunta pede explicações (por quê, causas, fatores)? Só então a resposta leva hipóteses. */
export const pedeExplicacao = (pergunta: string) =>
  /(por ?qu[eê]|porqu[eê]|causa|explica|motivo|fator|raz[ãõ]|o que levou|why|cause|explain|reason|driver|factor)/i.test(pergunta);

/** A pergunta pede dados que pedem tabela (tabela, série, comparação, ranking, distribuição, valores e variações)? */
export const pedeTabela = (pergunta: string) =>
  /(tabela|s[ée]rie|compar|ranking|classifica[çc][ãa]o|distribui|evolu|varia[çc][ãa]o|valores absolutos|totais|\b(19|20)\d{2}\s*,?\s+(e|a|até)\s+(19|20)\d{2}\b|table|series|ranking|distribution|trend|\bchange\b)/i.test(pergunta);

/**
 * Anos pedidos na pergunta: intervalo ("de 2011 a 2021", "2011–2021": todos os anos) ou pontos ("em 2011 e
 * 2021", "entre 2011 e 2021": os dois anos comparados).
 */
export function anosPedidos(pergunta: string): { tipo: 'intervalo' | 'pontos'; de: number; ate: number } | null {
  const ano = '((?:19|20)\\d{2})';
  const intervalo = new RegExp(`\\b(?:de|desde|from)\\s+${ano}\\s+(?:a|até|ate|to|until|through)\\s+${ano}\\b`, 'i').exec(pergunta)
    ?? new RegExp(`\\b${ano}\\s*[–-]\\s*${ano}\\b`).exec(pergunta);
  if (intervalo) return { tipo: 'intervalo', de: Math.min(+intervalo[1], +intervalo[2]), ate: Math.max(+intervalo[1], +intervalo[2]) };
  const pontos = new RegExp(`\\b${ano}\\s*,?\\s+(?:e|and)\\s+${ano}\\b`, 'i').exec(pergunta);
  return pontos ? { tipo: 'pontos', de: Math.min(+pontos[1], +pontos[2]), ate: Math.max(+pontos[1], +pontos[2]) } : null;
}

const INDISPONIVEL = /indispon|não est[áa]|não h[áa]|não tem|não t[êe]m|não consta|não inclui|não p[ôo]de|não foi poss|sem dados|ausen|fora da cobertura|não cobre|não existe|começa em|not available|unavailable|no data|missing|outside|does not (have|include)|could not/i;

/**
 * Problemas que impedem mostrar a resposta como está (cada um vira um item da devolução ao modelo):
 * destaque fora da tabela citada, tabela ou gráfico que não podem ser montados, tabela ausente quando a
 * pergunta (ou o modo de pesquisa) a pede, anos pedidos trocados por outros, período pedido indisponível
 * sem aviso na conclusão, título de gráfico com anos que ele não mostra, leitura sem colunas que a
 * sustentem, hipóteses numa pergunta que não pede explicações e comparação que atravessa uma quebra de
 * série da RAIS sem dizer isso na conclusão.
 */
export function revisarResposta(p: RespostaPronta, o: { pergunta?: string; modo?: Modo } = {}): string[] {
  if (p.r.tipo !== 'resposta') return [];
  const problemas: string[] = [];
  for (const x of p.tabelas) if (x.motivo) problemas.push(`Tabela "${x.espec.titulo || x.espec.consulta}": ${x.motivo}.`);
  if (p.r.tabelasAlem) {
    problemas.push(`A resposta trouxe ${MAX_TABELAS + p.r.tabelasAlem} tabelas e a página mostra até ${MAX_TABELAS}: junte recortes na mesma tabela (ex.: uma distribuição em formato longo com a coluna do recorte) ou diga na conclusão quais ficaram de fora.`);
  }
  // texto com tabulação ou outro caractere de controle no lugar de letras acentuadas
  const textos: [string, string][] = [
    ['conclusao', p.r.conclusao], ['explicacao', p.r.explicacao], ['limitacoes', p.r.limitacoes], ['metodologia', p.r.metodologia],
    ['hipoteses', p.r.hipoteses], ...Object.entries(p.r.recorte).map(([k, v]): [string, string] => [`recorte.${k}`, v]),
    ...p.r.tabelas.flatMap((x): [string, string][] => [['tabelas.titulo', x.titulo], ['tabelas.nota', x.nota]]),
    ...p.r.destaques.flatMap((x): [string, string][] => [['destaques.rotulo', x.rotulo], ['destaques.unidade', x.unidade]]),
  ];
  const comControle = textos.filter(([, v]) => CONTROLE.test(v));
  if (comControle.length) {
    const [campo, v] = comControle[0];
    const i = v.search(CONTROLE);
    problemas.push(`Texto corrompido em ${comControle.map(([k]) => k).join(', ')}: há tabulação ou caractere de controle no lugar de letras (ex.: "${v.slice(Math.max(0, i - 12), i + 12).replace(/[\u0000-\u001F]/g, '⟨?⟩')}" em ${campo}). Reescreva esses campos com os acentos digitados diretamente (á, ã, õ, ç), sem sequências de escape.`);
  }
  // tabela montada com só uma parte do resultado (mais linhas do que a página carrega)
  for (const x of p.tabelas) {
    if (x.tabela && x.espec.papel === 'principal' && x.tabela.registros > x.tabela.carregados) {
      problemas.push(`Tabela "${x.tabela.titulo}": a consulta ${x.espec.consulta} tem ${x.tabela.registros} linhas e a página só carrega ${x.tabela.carregados}; a tabela principal não pode ser parcial. Agregue ou filtre a consulta para que o resultado venha inteiro.`);
    }
  }
  if (o.pergunta !== undefined && pedeTabelaMunicipal(o.pergunta)
    && !p.tabelas.some((x) => x.tabela && x.tabela.carregados >= 10 && x.tabela.colunas.some((c) => /^(nome|munic[ií]pio|cod[ _]ibge)/i.test(c.nome)))) {
    problemas.push('A pergunta pede a tabela municipal: inclua em tabelas uma tabela (tipo tabela) com uma linha por município, com o nome, o código e os indicadores pedidos. A página mostra a tabela inteira com paginação e a exporta completa (até 2.000 linhas por consulta); você vê só as primeiras linhas do resultado, mas isso não limita a tabela.');
  }
  if (!p.r.tabelas.length && o.modo === 'pesquisa') {
    problemas.push('Modo análise para pesquisa: a tabela é o centro da resposta. Inclua em tabelas a tabela completa que responde à pergunta (tipo serie, comparacao ou tabela, com a consulta e as colunas exatas).');
  } else if (!p.r.tabelas.length && o.pergunta !== undefined && pedeTabela(o.pergunta)) {
    problemas.push('A pergunta pede tabela, série, comparação, ranking, distribuição ou valores e variações: inclua em tabelas a tabela com esses dados, mesmo na resposta rápida.');
  }
  const pedido = o.pergunta !== undefined ? anosPedidos(o.pergunta) : null;
  if (pedido && p.r.tabelas.length) {
    const ano = (s: string) => (/^\d{4}$/.test(s.trim()) ? Number(s.trim()) : null);
    const atende = p.tabelas.some((x) => x.espec.papel === 'principal' && ano(x.espec.de) === pedido.de && ano(x.espec.ate) === pedido.ate
      && (pedido.tipo === 'pontos' || x.espec.tipo !== 'comparacao'));
    if (!atende) {
      problemas.push(pedido.tipo === 'intervalo'
        ? `A pergunta pede a série de ${pedido.de} a ${pedido.ate}: a tabela principal precisa ser do tipo serie (ou tabela com a coluna de período), com de = "${pedido.de}" e ate = "${pedido.ate}", mesmo que algum ano não esteja disponível (a página mostra cada ano do intervalo e marca as lacunas). Outro intervalo só numa tabela de papel "alternativa".`
        : `A pergunta pede ${pedido.de} e ${pedido.ate}: a tabela principal precisa usar de = "${pedido.de}" e ate = "${pedido.ate}", mesmo que um dos anos não esteja disponível (a página o marca como indisponível e não calcula a variação). Outra combinação de anos só numa tabela de papel "alternativa", dizendo que ela não atende integralmente ao pedido.`);
    }
  }
  if (p.faltantes.length) {
    const naoCitados = p.faltantes.filter((f) => !p.r.conclusao.includes(f));
    if (naoCitados.length || !INDISPONIVEL.test(p.r.conclusao)) {
      problemas.push(`${p.faltantes.length === 1 ? 'O período pedido' : 'Os períodos pedidos'} ${p.faltantes.join(', ')} não ${p.faltantes.length === 1 ? 'está' : 'estão'} nos dados: diga isso na própria conclusão (a comparação ou série pedida não pôde ser completada) e, se houver tabela alternativa, apresente-a como alternativa, não como resposta ao pedido.`);
    }
  }
  for (const g of p.graficos) {
    if (!g.validacao.ok) continue;
    const presentes = [...g.validacao.dados.rotulos, ...g.validacao.dados.series.map((s) => s.nome)].join(' ');
    const faltam = [...new Set([...g.g.titulo.matchAll(/\b(?:19|20)\d{2}\b/g)].map((m) => m[0]))].filter((a) => !presentes.includes(a));
    if (faltam.length) {
      problemas.push(`Gráfico "${g.g.titulo}": o título cita ${faltam.join(' e ')}, que não ${faltam.length === 1 ? 'aparece' : 'aparecem'} nos dados do gráfico. Para comparar anos, use uma série por ano (serie = coluna do ano, em formato longo) ou uma coluna por ano em y; ou corrija o título.`);
    }
  }
  if (p.r.hipoteses && o.pergunta !== undefined && !pedeExplicacao(o.pergunta)) {
    problemas.push('Hipóteses: a pergunta não pede explicações (por quê, causas, fatores); deixe hipoteses vazio e descreva só o que os dados mostram.');
  }
  for (const x of p.destaques) {
    if (x.conferencia === 'sem_consulta') problemas.push(`Destaque "${x.d.rotulo}": a consulta ${x.d.consulta || '(vazia)'} não existe ou falhou; cite a consulta de onde vem o número.`);
    else if (x.conferencia === 'divergente') problemas.push(`Destaque "${x.d.rotulo}": ${x.d.valor} não está na coluna ${x.d.coluna} de ${x.d.consulta}; use o valor exato da célula, com a consulta e a coluna certas.`);
  }
  for (const g of p.graficos) if (!g.validacao.ok) problemas.push(`Gráfico "${g.g.titulo || g.g.consulta}": ${g.validacao.motivo}.`);
  for (const l of p.leituras) {
    if (l.motivo) problemas.push(`Leitura "${resumo(l.texto)}": ${l.motivo}. Cite a consulta e as colunas do indicador e da referência da comparação, ou retire a leitura.`);
  }
  if (!citaQuebra(p.r.conclusao)) {
    const cruzam = p.destaques.filter((x) => x.quebras.length);
    // a conclusão compara anos dos dois lados de uma quebra (ex.: "passou de 3.821 em 2015 para 4.731 em 2025")
    const anos = [...p.r.conclusao.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
    const noTexto = anos.length >= 2 ? quebrasNoPeriodo({ tipo: 'ano', de: Math.min(...anos), ate: Math.max(...anos) }).filter((n) => p.alertas.includes(n)) : [];
    const notas = unicas([...cruzam.flatMap((x) => x.quebras), ...noTexto]);
    if (notas.length) {
      const quais = cruzam.length ? `${cruzam.map((x) => `"${x.d.rotulo}" (${x.rotuloPeriodo})`).join(', ')} compara` : 'A conclusão compara';
      problemas.push(`${quais} anos da RAIS antes e depois da mudança de captação para o eSocial (${notas.map((n) => n.quebra).join(' e ')}): diga isso na própria conclusão, junto ao número, como diferença observada que mistura emprego e ampliação da cobertura, não como criação de empregos.`);
    }
  }
  return problemas;
}

const CABECA_REVISAO = 'A resposta não foi mostrada: a página encontrou problemas. Corrija-os (com novas consultas, se precisar) e chame responder de novo, sozinha:';

/**
 * Recorte da análise (o mesmo na tela, no PDF e na cópia): território, período solicitado e o efetivamente
 * usado (das consultas), fontes, unidade, filtros e agrupamentos.
 */
export function recorteDe(p: RespostaPronta): [string, string][] {
  const r = p.r;
  return ([
    [t('Território', 'Territory'), p.territorios.join('; ') || r.recorte.territorio],
    [t('Período solicitado', 'Requested period'), r.recorte.periodo_solicitado],
    [t('Período utilizado', 'Period used'), p.periodo ?? r.recorte.periodo],
    [t('Fontes', 'Sources'), p.fontes.join('; ')],
    [t('Bases', 'Datasets'), p.bases.join('; ')],
    [t('Unidade', 'Unit'), semNominal(r.recorte.unidade, p.tabelas.some((x) => x.espec.formato === 'reais') || p.destaques.some((x) => x.d.formato === 'reais') ? 'reais' : 'inteiro')],
    [t('Filtros e definições', 'Filters and definitions'), r.recorte.filtros],
    [t('Códigos filtrados nas consultas', 'Codes filtered in the queries'), p.codigos.join(' · ')],
    [t('Agrupamentos', 'Groupings'), r.recorte.agrupamentos],
  ] as [string, string][]).filter(([, v]) => v);
}

/** Aviso de pedido não atendido por inteiro (períodos pedidos sem dados), para a tela, o PDF e a cópia. */
export const avisoFaltantes = (p: RespostaPronta) => (p.faltantes.length
  ? t(`O pedido não pôde ser atendido por inteiro: ${p.faltantes.join(', ')} sem dados na base. As tabelas marcam ${p.faltantes.length === 1 ? 'esse período' : 'esses períodos'} como indisponível e não calculam variações com ${p.faltantes.length === 1 ? 'ele' : 'eles'}.`,
    `The request could not be fully met: ${p.faltantes.join(', ')} not in the data. The tables mark ${p.faltantes.length === 1 ? 'this period' : 'these periods'} as unavailable and compute no changes with ${p.faltantes.length === 1 ? 'it' : 'them'}.`)
  : '');

/**
 * Texto analítico para copiar (sem identificadores internos das consultas): conclusão, avisos, números
 * principais, análise, leituras, hipóteses, ressalvas, recorte e metodologia. As tabelas têm cópia própria.
 */
export function textoDaResposta(p: RespostaPronta): string {
  const r = p.r;
  const partes = [r.conclusao];
  if (p.faltantes.length) partes.push(`⚠ ${avisoFaltantes(p)}`);
  if (p.alertas.length) partes.push(p.alertas.map((n) => `⚠ ${n.curta()} (${n.documento}: ${n.url})`).join('\n'));
  if (p.destaques.length) {
    partes.push(p.destaques.map((x) => `- ${x.d.rotulo}: ${x.valor}${x.unidade ? ` ${x.unidade}` : ''}${x.rotuloPeriodo ? ` (${x.rotuloPeriodo})` : ''}`).join('\n'));
  }
  if (r.explicacao) partes.push(r.explicacao);
  const leituras = p.leituras.filter((l) => !l.motivo);
  if (leituras.length) partes.push(`${t('Leitura dos dados', 'Reading the data')}:\n${leituras.map((l) => `- ${l.texto}`).join('\n')}`);
  if (p.hipoteses) partes.push(`${t('Hipóteses (não testadas)', 'Hypotheses (not tested)')}: ${p.hipoteses}`);
  if (r.limitacoes) partes.push(`${t('Ressalvas', 'Caveats')}: ${r.limitacoes}`);
  const ficha = recorteDe(p).map(([k, v]) => `${k}: ${v}`);
  if (ficha.length) partes.push(ficha.join('\n'));
  if (r.metodologia) partes.push(`${t('Metodologia', 'Methodology')}: ${r.metodologia}`);
  return partes.join('\n\n');
}

// ---------------- turnos (para a página) ----------------

export type ItemTurno =
  | { tipo: 'nota'; texto: string }
  | { tipo: 'consulta'; id: string; rotulo: string; sql: string; objetivo: string; substitui: string }
  | { tipo: 'localizacao'; id: string; nome: string; uf: string }
  | { tipo: 'revisao'; motivos: string[] };
export type TurnoIa = { pergunta: string; itens: ItemTurno[]; resposta: RespostaFinal | null; textoFinal: string | null };

/** Motivos de uma devolução de "responder" ao modelo (itens "- " da revisão, ou o texto inteiro). */
const motivosDe = (conteudo: unknown) => {
  const s = typeof conteudo === 'string' ? conteudo : '';
  const itens = s.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  return itens.length ? itens : [s.split('\n')[0]].filter(Boolean);
};

/**
 * Conversa da API organizada por pergunta: notas do modelo, localizações, consultas e revisões da resposta
 * na ordem, e a resposta (a última chamada de "responder"; sem ela, o texto da última mensagem do modelo que
 * não pediu consultas).
 */
export function turnos(mensagens: Mensagem[]): TurnoIa[] {
  const rotulos = rotulosConsultas(mensagens);
  const r: TurnoIa[] = [];
  const respostas = new Set<string>();
  let ultima: Bloco[] | null = null;
  const fechar = () => {
    const turno = r.at(-1);
    if (!turno || turno.resposta || !ultima || ultima.some((b) => b.type === 'tool_use')) return;
    const textos = ultima.filter((b) => b.type === 'text' && b.text?.trim()).map((b) => b.text!.trim());
    if (!textos.length) return;
    turno.textoFinal = textos.join('\n\n');
    turno.itens.splice(turno.itens.length - textos.length, textos.length);
  };
  for (const m of mensagens) {
    if (ehPergunta(m)) {
      fechar();
      r.push({ pergunta: textoDaPergunta(m), itens: [], resposta: null, textoFinal: null });
      ultima = null;
      continue;
    }
    if (!r.length || !Array.isArray(m.content)) continue;
    const turno = r.at(-1)!;
    if (m.role === 'user') {
      // "responder" devolvida ao modelo (resposta com problemas ou malformada): fica no histórico da pergunta
      // e deixa de valer como resposta, até o modelo refazê-la
      for (const b of m.content) {
        if (b.type === 'tool_result' && b.is_error && respostas.has(String(b.tool_use_id))) {
          turno.itens.push({ tipo: 'revisao', motivos: motivosDe(b.content) });
          turno.resposta = null;
        }
      }
      continue;
    }
    ultima = m.content;
    for (const b of m.content) {
      if (b.type === 'text' && b.text?.trim()) turno.itens.push({ tipo: 'nota', texto: b.text.trim() });
      else if (b.type === 'tool_use' && b.id && b.name === 'consultar') {
        const e = (b.input ?? {}) as { sql?: string; objetivo?: string; substitui?: string };
        turno.itens.push({ tipo: 'consulta', id: b.id, rotulo: rotulos.get(b.id) ?? '', sql: String(e.sql ?? ''), objetivo: String(e.objetivo ?? ''), substitui: linha(e.substitui, 12) });
      } else if (b.type === 'tool_use' && b.id && b.name === 'localizar') {
        const e = (b.input ?? {}) as { nome?: unknown; uf?: unknown };
        turno.itens.push({ tipo: 'localizacao', id: b.id, nome: linha(e.nome, 120), uf: linha(e.uf, 30) });
      } else if (b.type === 'tool_use' && b.name === 'responder') {
        if (b.id) respostas.add(b.id);
        turno.resposta = lerResposta(b.input) ?? turno.resposta;
      }
    }
  }
  fechar();
  return r;
}

// ---------------- uma pergunta, do envio à resposta ----------------

export type Progresso =
  | { fase: 'modelo'; rodada: number }
  | { fase: 'consulta'; rotulo: string; objetivo: string }
  | { fase: 'localizar'; nome: string }
  | { fase: 'revisao' };
export type Desfecho = 'resposta' | 'texto' | 'limite' | 'recusa' | 'longa';

/**
 * Faz a pergunta e conduz as rodadas: o modelo pede consultas e localizações, a página as roda e devolve
 * os resultados, até ele chamar "responder" (ou parar). A resposta é conferida antes de ser aceita; com
 * problemas, volta ao modelo (até MAX_REVISOES vezes). Cada passo é avisado pelos callbacks; o sinal
 * cancela a qualquer momento (pedido em andamento e consulta no DuckDB), com um AbortError.
 * `resultados`: os das perguntas anteriores, para conferir destaques que citam consultas delas.
 */
export async function perguntarIa(o: {
  historico: Mensagem[]; pergunta: string; contexto: string; idioma: string; paineis: Painel[]; sinal: AbortSignal;
  resultados?: Record<string, Resultado>; ultimaCompetencia?: number | null; modo?: Modo; cobertura?: Cobertura | null;
  aoAtualizar: (mensagens: Mensagem[]) => void;
  aoResultado: (id: string, r: Resultado) => void;
  aoProgresso?: (p: Progresso) => void;
  aoRestantes?: (n: number) => void;
}): Promise<{ mensagens: Mensagem[]; desfecho: Desfecho; detalhe?: string | null }> {
  let hist = comPergunta(o.historico, o.pergunta, o.contexto);
  const resultados: Record<string, Resultado> = { ...(o.resultados ?? {}) };
  const guardar = (id: string, res: Resultado) => {
    resultados[id] = res;
    o.aoResultado(id, res);
  };
  let revisoes = 0;
  o.aoAtualizar(hist);
  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    if (o.sinal.aborted) throw cancelado();
    o.aoProgresso?.({ fase: 'modelo', rodada });
    const r = await chamarIa(hist, o.idioma, o.paineis, o.sinal);
    o.aoRestantes?.(r.restantes);
    hist = [...hist, { role: 'assistant', content: r.conteudo }];
    o.aoAtualizar(hist);
    if (r.parada === 'refusal') return { mensagens: hist, desfecho: 'recusa', detalhe: r.recusa };
    if (r.parada === 'max_tokens') return { mensagens: hist, desfecho: 'longa' };
    const usos = r.conteudo.filter((b): b is Bloco & { id: string } => b.type === 'tool_use' && !!b.id);
    if (r.parada !== 'tool_use' || !usos.length) return { mensagens: hist, desfecho: 'texto' };
    const pedidos = usos.filter((u) => u.name === 'consultar' || u.name === 'localizar');
    const final = usos.find((u) => u.name === 'responder');
    let problemas: string[] = [];
    const resposta = final && !pedidos.length ? lerResposta(final.input) : null;
    if (resposta) {
      o.aoProgresso?.({ fase: 'revisao' });
      const cad = await cadastro().catch(() => null);
      const doTurno = turnos(hist).at(-1)?.itens.flatMap((i) => (i.tipo === 'consulta' ? [i.rotulo] : [])) ?? [];
      problemas = revisarResposta(prepararResposta(resposta, consultasDaConversa(hist, resultados), {
        doTurno, cadastro: cad, ultimaCompetencia: o.ultimaCompetencia, cobertura: o.cobertura,
      }), { pergunta: o.pergunta, modo: o.modo });
      // sem problemas, ou já devolvida o bastante (ou sem rodada para refazer): a página mostra com os avisos
      if (!problemas.length || revisoes >= MAX_REVISOES || rodada >= MAX_RODADAS - 1) return { mensagens: hist, desfecho: 'resposta' };
      revisoes++;
    }

    const rotulos = rotulosConsultas(hist);
    // a próxima chamada é a última que o Worker aceita nesta pergunta: o modelo precisa concluir nela
    const aviso = rodada === MAX_RODADAS - 2
      ? 'Limite de consultas desta pergunta: na próxima resposta, chame responder com os resultados que já tem.'
      : undefined;
    const devolver: Bloco[] = [];
    for (const u of usos) {
      if (o.sinal.aborted) throw cancelado();
      if (u.name === 'consultar') {
        const rotulo = rotulos.get(u.id) ?? '';
        o.aoProgresso?.({ fase: 'consulta', rotulo, objetivo: String((u.input as { objetivo?: unknown } | undefined)?.objetivo ?? '') });
        const res = await executarConsulta(u.input, o.paineis, o.sinal);
        guardar(u.id, res);
        devolver.push({ type: 'tool_result', tool_use_id: u.id, content: paraModelo(res, rotulo, aviso), ...('erro' in res ? { is_error: true } : {}) });
      } else if (u.name === 'localizar') {
        o.aoProgresso?.({ fase: 'localizar', nome: String((u.input as { nome?: unknown } | undefined)?.nome ?? '') });
        const cad = await cadastro().catch(() => null);
        const l = cad ? executarLocalizacao(u.input, cad, o.paineis) : { modelo: JSON.stringify({ erro: 'cadastro de entes indisponível' }), tabela: { erro: 'cadastro indisponível' }, erro: true };
        guardar(u.id, l.tabela);
        const conteudo = aviso ? JSON.stringify({ ...JSON.parse(l.modelo), aviso }) : l.modelo;
        devolver.push({ type: 'tool_result', tool_use_id: u.id, content: conteudo, ...(l.erro ? { is_error: true } : {}) });
      } else if (u.name === 'responder' && problemas.length) {
        devolver.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: [CABECA_REVISAO, ...problemas.map((x) => `- ${x}`), ...(aviso ? [aviso] : [])].join('\n') });
      } else {
        const motivo = u.name !== 'responder'
          ? `ferramenta desconhecida: ${u.name}`
          : pedidos.length
            ? 'Chame responder sozinha, depois de ver os resultados das consultas desta rodada.'
            : 'A chamada de responder não pôde ser lida. Chame responder de novo com todos os campos dentro do objeto "resposta", '
              + 'em JSON válido, com a conclusão preenchida e sem marcações (como <parameter> ou </conclusao>) dentro dos textos.';
        devolver.push({ type: 'tool_result', tool_use_id: u.id, content: aviso ? `${motivo} ${aviso}` : motivo, is_error: true });
      }
    }
    hist = [...hist, { role: 'user', content: devolver }];
    o.aoAtualizar(hist);
  }
  return { mensagens: hist, desfecho: 'limite' };
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

/**
 * Roda a consulta proposta pelo modelo (entrada da ferramenta "consultar"); o sinal a cancela. Antes, confere
 * o SQL e os códigos de território: o que for recusado volta como erro "bloqueada", sem rodar.
 */
export async function executarConsulta(entrada: unknown, paineis: Painel[] = PAINEIS, sinal?: AbortSignal, limite = LINHAS_TELA): Promise<Resultado> {
  const e = entrada as { sql?: unknown };
  if (!e || typeof e.sql !== 'string') return { erro: 'entrada inválida: falta o campo sql', bloqueada: true };
  const motivo = validarSql(e.sql);
  if (motivo) return { erro: motivo, bloqueada: true };
  try {
    const cad = await cadastro().catch(() => null);
    const codigos = cad && conferirCodigos(e.sql, cad);
    if (codigos) return { erro: codigos, bloqueada: true };
    if (paineis.includes('trabalho')) await tabelasIaTrabalho();
    // a tabela da LRF só é baixada quando alguma consulta a usa; as do SIOPE e do SIOPS, idem
    if (paineis.includes('financas') && /\blrf\b/i.test(e.sql)) await tabelaLrf();
    if (paineis.includes('financas') && /\bsiop[es]_/i.test(e.sql)) await tabelasEducacaoSaude();
    return await consultaLivre(e.sql, limite, sinal);
  } catch (err) {
    if (sinal?.aborted || foiCancelado(err)) throw cancelado();
    return { erro: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resultado em JSON para o modelo: o identificador da consulta (C1…), até 200 linhas, encurtado se passar
 * do tamanho máximo, e um aviso opcional (ex.: última rodada da pergunta).
 */
export function paraModelo(r: Resultado, consulta?: string, aviso?: string): string {
  const extra = { ...(consulta ? { consulta } : {}) };
  const fim = aviso ? { aviso } : {};
  if ('erro' in r) return JSON.stringify({ ...extra, erro: r.erro, ...(r.bloqueada ? { bloqueada: 'a página recusou a consulta antes de rodá-la' } : {}), ...fim });
  let n = Math.min(LINHAS_MODELO, r.linhas.length);
  for (;;) {
    const json = JSON.stringify({ ...extra, colunas: r.colunas, linhas: r.linhas.slice(0, n), total_linhas: r.total, linhas_enviadas: n, ...fim });
    if (json.length <= TAMANHO_MODELO || n <= 5) return json;
    n = Math.floor(n / 2);
  }
}
