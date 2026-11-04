import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Ente, Meta } from '../api';
import { BotoesExportar } from '../components/Exportar';
import { Icone } from '../components/Icone';
import { Dialogo, Popover } from '../components/IaPaineis';
import { barrasAgrupadas, Grafico, graficoSvg, linhas, type Marca } from '../components/Grafico';
import { BuscaEnte, UFS, useDados, useFiltros } from '../contexto';
import { tabelasIaTrabalho } from '../dados';
import { baixarArquivo, nomeArquivo, paraXlsxAbas, type Celula, type Planilha } from '../exportar';
import { idioma, local, t } from '../idioma';
import {
  avisoFaltantes, coberturaPorAno, consultasDaConversa, contextoParaModelo, descreverCobertura, descricaoModo, ErroAcesso, estadoIa, executarConsulta, exemploPergunta, foiCancelado,
  fontesConsultadas, lerEscolhaModelo, lerModo, LINHAS_TELA, MAX_PERGUNTA, mesmoContexto, MODELO_PADRAO, MODOS, nomeDaUf, nomeDoModelo, PAINEIS, perguntarIa, prepararResposta,
  periodosDiferem, recorteDe, rotuloAno, rotuloModo, rotuloTerritorio, semUltimaPergunta, sugestoes, tabelaInteira, textoDaResposta, textoPeriodosPorFonte, turnos, urlEntrar,
  type Cobertura, type ConsultaFeita, type ContextoIa, type EscolhaModelo, type DadosGrafico, type DestaquePronto, type Etapa, type EstadoIa, type GraficoIa,
  type GraficoPronto, type ItemTurno, type Mensagem, type Modo, type Painel, type Progresso, type RespostaPronta, type Resultado,
  type Sugestao, type TabelaPronta, type Territorio, type TurnoIa,
} from '../ia';
import { blocosDeTexto, contar, formatarTabela, formatarValor, rotuloCompetencia, tiposDoResultado, type TabelaFormatada } from '../ia_formato';
import {
  dataHora, desatualizada, exportarConversa, FORMATO_CONVERSA, guardarNota, historico, lerNota, novaVersaoComDadosAtuais, novoId, tituloAutomatico, useHistorico,
  VERSAO_CONVERSA, versoesDosDados, type Conversa, type MetaTurno, type RegistroTurno,
} from '../ia_historico';
import { dataDaNota, type NotaMetodologica } from '../ia_notas';
import {
  ehTexto, formatarCelulaT, rodapeTabela, tabelaExportavel, tabelaHtml, tabelaTsv, type TabelaAnalitica,
} from '../ia_tabelas';
import { pedidoConferencia } from '../ia_conferencia';
import { linhasDaVerificacao } from '../ia_verificacao';
import { cadastro as carregarCadastro, type Cadastro } from '../ia_territorio';

const LINHAS_INICIAIS = 25;

const NOMES_PAINEIS = (): Record<Painel, string> => ({
  financas: t('Finanças públicas', 'Public finances'),
  trabalho: t('Mercado de trabalho', 'Labour market'),
  saude: t('Saúde', 'Health'),
});

type ItemConsulta = Extract<ItemTurno, { tipo: 'consulta' }>;
/** Conversa aberta sem o conteúdo (mensagens, contexto das perguntas e resultados ficam no estado da página). */
type Cabecalho = Omit<Conversa, 'mensagens' | 'metas' | 'resultados'>;
const cabecalho = ({ mensagens: _m, metas: _c, resultados: _r, ...resto }: Conversa): Cabecalho => resto;

/**
 * Versão dos dados de uma resposta: a da pergunta (ou a da nova versão, com as consultas refeitas) e se é a
 * publicada agora. Só com a mesma versão a exportação roda a consulta de novo para trazer todas as linhas.
 */
type VersaoDados = { geradoEm: string; atual: boolean };
const VersaoDaResposta = createContext<VersaoDados | null>(null);
const versaoDoTurno = (m: MetaTurno | undefined, atual: string): VersaoDados => {
  const v = m?.reexecucao?.dados ?? m?.dados ?? atual;
  return { geradoEm: v, atual: v === atual };
};
function useVersaoDados(): VersaoDados {
  const { meta } = useDados();
  return useContext(VersaoDaResposta) ?? { geradoEm: meta.geradoEm, atual: true };
}

/** Filtros da página com o recorte de uma pergunta (painéis, ano, território): o seguimento usa o mesmo contexto. */
function paramsDoContexto(atual: URLSearchParams, c: ContextoIa, id: string) {
  const b = new URLSearchParams(atual);
  b.set('conversa', id);
  b.delete('nova');
  if (c.paineis.length === PAINEIS.length) b.delete('paineis');
  else b.set('paineis', c.paineis.join(','));
  if (c.ano) b.set('ano', String(c.ano));
  else b.delete('ano');
  b.delete('uf');
  b.delete('ente');
  if (c.territorio.tipo === 'uf') b.set('uf', c.territorio.uf);
  else if (c.territorio.tipo === 'municipio') b.set('ente', String(c.territorio.cod));
  else if (c.territorio.tipo === 'df') b.set('uf', 'DF');
  return b;
}

// preferências e rascunho ficam só neste navegador; sem armazenamento, valem nesta visita
function lerGuardado(chave: string, sessao = false): string | null {
  try {
    return (sessao ? sessionStorage : localStorage).getItem(chave);
  } catch {
    return null;
  }
}
function guardar(chave: string, valor: string | null, sessao = false) {
  try {
    const a = sessao ? sessionStorage : localStorage;
    if (valor) a.setItem(chave, valor);
    else a.removeItem(chave);
  } catch {
    /* armazenamento indisponível */
  }
}

// rascunhos por conversa (só nesta aba): sair de uma conversa com texto no campo o guarda nela, e ele volta ao reabri-la
const RASCUNHOS = 'ia-rascunhos';
function lerRascunhos(): Record<string, string> {
  try {
    const r = JSON.parse(lerGuardado(RASCUNHOS, true) ?? '{}');
    return r && typeof r === 'object' ? r : {};
  } catch {
    return {};
  }
}
function guardarRascunhoDe(id: string, texto: string) {
  const r = lerRascunhos();
  if (texto.trim()) r[id] = texto;
  else delete r[id];
  guardar(RASCUNHOS, Object.keys(r).length ? JSON.stringify(r) : null, true);
}

/** Cobertura de cada fonte, do manifesto dos dados (o mesmo catálogo que o Worker passa ao modelo). */
function coberturaDe(meta: Meta, microdados: boolean): Cobertura {
  const f = meta.fontes as Record<string, Record<string, unknown> | undefined>;
  const anos = (v: unknown) => (Array.isArray(v) ? v.filter(Number.isInteger) as number[] : []);
  const par = (v: unknown) => {
    const a = anos(v);
    return a.length >= 2 ? { de: a[0], ate: a.at(-1)! } : null;
  };
  const caged = f.caged as { de?: number; ate?: number } | undefined;
  const pib = par(f.ibge_pib?.anos);
  const bolsa = par(f.bolsa_familia?.anos);
  return {
    rais: anos(f.rais?.anos), caged: caged?.de && caged?.ate ? { de: caged.de, ate: caged.ate } : null, microdados, dca: meta.anos,
    pib: pib && { ...pib, setorial_ate: Number(f.ibge_pib?.setorial_ate) || undefined },
    siope: anos(f.siope?.anos), siopeRemuneracao: anos(f.siope?.remuneracao), siops: anos(f.siops?.anos),
    lrf: par(f.siconfi_lrf?.anos) && { ...par(f.siconfi_lrf?.anos)!, parciais: anos(f.siconfi_lrf?.parciais) }, bolsa: bolsa && { ...bolsa, mes: Number(f.bolsa_familia?.ultimo_mes) || bolsa.ate * 100 + 12 },
    inss: anos(f.inss?.exercicios),
    sim: anos(f.sim?.anos), sinasc: anos(f.sinasc?.anos), sih: anos(f.sih?.anos), cnes: anos(f.cnes?.anos), popSvs: anos(f.populacao_svs?.anos),
  };
}

/**
 * Ano do seletor: os que só têm fontes mensais incompletas (ex.: o ano corrente) dizem quais e até que mês, do mesmo
 * manifesto da ajuda (antes só o Novo CAGED era citado, e o Bolsa Família do mesmo ano ficava de fora).
 */
function rotuloDoAno(a: number, c: Cobertura, paineis: Painel[]) {
  const e = coberturaPorAno(c, paineis).get(a);
  if (!e || e.fechado || !e.parciais.length) return String(a);
  return t(`${a} (parcial: ${e.parciais.join('; ')})`, `${a} (partial: ${e.parciais.join('; ')})`);
}

/** Território dos filtros globais (?uf=, ?ente=): município, UF, DF ou nenhum (Brasil). */
function territorioDe(alvo: Ente | null, uf: string | null, entes: Ente[]): Territorio {
  if (alvo?.esfera === 'D' || (!alvo && uf === 'DF')) return { tipo: 'df' };
  if (alvo?.esfera === 'M') return { tipo: 'municipio', uf: alvo.uf, nome: alvo.nome, cod: alvo.cod_ibge };
  const sigla = alvo?.esfera === 'E' ? alvo.uf : uf;
  if (!sigla) return { tipo: 'brasil' };
  const estado = alvo?.esfera === 'E' ? alvo : entes.find((e) => e.esfera === 'E' && e.uf === sigla);
  return { tipo: 'uf', uf: sigla, nome: estado?.nome ?? nomeDaUf(sigla), cod: estado?.cod_ibge ?? 0 };
}

/** Temas dos painéis marcados, no subtítulo ("finanças, emprego e saúde"). */
const TEMAS = (): Record<Painel, string> => ({
  financas: t('finanças', 'public finances'), trabalho: t('emprego', 'employment'), saude: t('saúde', 'health'),
});
const subtitulo = (p: Painel[]) => {
  const temas = p.map((x) => TEMAS()[x]).join(', ').replace(/, ([^,]*)$/, t(' e $1', ' and $1'));
  return t(`Explore dados públicos de ${temas}.`, `Explore public data on ${temas}.`);
};

const descricao = (p: Painel[]) => (p.length > 1
  ? t('Pergunte em linguagem natural, inclusive cruzando os painéis. A IA consulta as bases aqui no seu navegador, faz os cálculos com SQL e explica o resultado, com as consultas à vista para conferência.',
    'Ask in plain language, including across dashboards. The AI queries the datasets here in your browser, does the calculations in SQL and explains the result, with the queries in view for checking.')
  : p[0] === 'trabalho'
    ? t('Pergunte em linguagem natural sobre emprego formal, remuneração, setores, ocupações, afastamentos e movimentações. A IA consulta a RAIS e o Novo CAGED aqui no seu navegador, faz os cálculos com SQL e explica o resultado, com as consultas à vista para conferência.',
      'Ask in plain language about formal employment, pay, sectors, occupations, leave and job flows. The AI queries RAIS and New CAGED here in your browser, does the calculations in SQL and explains the result, with the queries in view for checking.')
    : p[0] === 'saude'
      ? t('Pergunte em linguagem natural sobre mortalidade, causas de morte, nascimentos, internações hospitalares do SUS e a rede de saúde (leitos, médicos, estabelecimentos). A IA consulta o SIM, o SINASC, o SIH, o CNES e a população da SVS/MS aqui no seu navegador, faz os cálculos com SQL e explica o resultado, com as consultas à vista para conferência.',
        'Ask in plain language about mortality, causes of death, births, SUS hospital admissions and the health network (beds, physicians, facilities). The AI queries SIM, SINASC, SIH, CNES and the SVS/MS population here in your browser, does the calculations in SQL and explains the result, with the queries in view for checking.')
      : t('Pergunte em linguagem natural sobre receitas, despesas, transferências e indicadores fiscais de municípios, estados e DF. A IA consulta as declarações do SICONFI aqui no seu navegador, faz os cálculos com SQL e explica o resultado, com as consultas à vista para conferência.',
        'Ask in plain language about revenue, expenditure, transfers and fiscal indicators of municipalities, states and DF. The AI queries the SICONFI filings here in your browser, does the calculations in SQL and explains the result, with the queries in view for checking.'));

const FONTES = (): Record<Painel, string> => ({
  financas: t('finanças públicas (SICONFI/Tesouro Nacional, IBGE, Banco Central, Portal da Transparência, Previdência)', 'public finances (SICONFI/National Treasury, IBGE, Central Bank, Transparency Portal, Social Security)'),
  trabalho: t('mercado de trabalho (RAIS e Novo CAGED, Ministério do Trabalho e Emprego)', 'labour market (RAIS and New CAGED, Ministry of Labour and Employment)'),
  saude: t('saúde (SIM, SINASC, SIH e CNES, Ministério da Saúde/DATASUS; população da SVS/MS)', 'health (SIM, SINASC, SIH and CNES, Ministry of Health/DATASUS; SVS/MS population)'),
});
const fonteIa = (paineis: Painel[]) => t(
  `Painéis LAPAM/UFG: ${paineis.map((p) => FONTES()[p]).join('; ')}. Respostas e consultas geradas por IA (Claude, da Anthropic): confira antes de usar.`,
  `LAPAM/UFG dashboards: ${paineis.map((p) => FONTES()[p]).join('; ')}. Answers and queries generated by AI (Claude, by Anthropic): check before use.`,
);
/** Rótulo do período: o consultado (depois da resposta) ou o ano de referência da página. */
const rotuloDoPeriodo = (c: ContextoIa, periodo?: string | null) => (periodo ? t(`Período consultado: ${periodo}`, `Period queried: ${periodo}`) : rotuloAno(c.ano));
const descreverContexto = (c: ContextoIa, periodo?: string | null, comModo = true) =>
  [c.paineis.map((p) => NOMES_PAINEIS()[p]).join(' + '), rotuloTerritorio(c.territorio), rotuloDoPeriodo(c, periodo), ...(comModo ? [rotuloModo(c.modo)] : [])].join(' · ');

const consultasDoTurno = (turno: TurnoIa) => turno.itens.filter((i): i is ItemConsulta => i.tipo === 'consulta');
/** Pergunta sem acentos, maiúsculas, pontuação e UF entre parênteses: para não sugerir de novo o que já foi perguntado. */
const chavePergunta = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const anosDas = (notas: NotaMetodologica[]) => notas.map((n) => n.quebra).filter(Boolean).join(t(' e ', ' and '));

/** Situação de cada consulta no histórico: executando, bloqueada antes de rodar, falhou, sem resultado ou com linhas. */
function estadoConsulta(r?: Resultado): { classe: string; texto: string } {
  if (!r) return { classe: 'rodando', texto: t('executando', 'running') };
  if ('erro' in r) return r.bloqueada ? { classe: 'erro', texto: t('bloqueada antes de executar', 'blocked before running') } : { classe: 'erro', texto: t('falhou', 'failed') };
  if (!r.linhas.length) return { classe: 'vazia', texto: t('sem resultado (0 linhas)', 'no results (0 rows)') };
  return { classe: 'ok', texto: contar(r.total, t('linha', 'row'), t('linhas', 'rows')) };
}

/**
 * Consulta que refez cada consulta sem resultado, recusada ou com erro: a que o modelo indicou em
 * "substitui" ou, sem isso, a seguinte com o mesmo objetivo.
 */
function refeitas(consultas: ItemConsulta[], resultados: Record<string, Resultado>): Map<string, string> {
  const r = new Map<string, string>();
  consultas.forEach((c, i) => {
    const res = resultados[c.id];
    const problema = !res || 'erro' in res || !res.linhas.length;
    const depois = consultas.slice(i + 1);
    const nova = depois.find((d) => d.substitui === c.rotulo)
      ?? (problema ? depois.find((d) => d.objetivo.trim().toLowerCase() === c.objetivo.trim().toLowerCase()) : undefined);
    if (nova) r.set(c.rotulo, nova.rotulo);
  });
  return r;
}

/** Texto de uma localização (resultado da ferramenta "localizar"). */
function textoLocalizacao(r?: Resultado): string {
  if (!r) return t('procurando…', 'searching…');
  if ('erro' in r || !r.linhas.length) return t('nenhum lugar com esse nome', 'no place with that name');
  return r.linhas.map((l) => `${l[0]} (${l[1]}): IBGE ${l[2]}${l[3] ? ` · RAIS ${l[3]}` : ''}`).join('; ');
}

/** Gráfico da resposta em opção do ECharts, com as quebras de série marcadas no eixo dos anos. */
function opcaoDoGrafico(g: GraficoIa, dados: DadosGrafico, quebras: NotaMetodologica[]) {
  const fmt = (v: number) => formatarValor(v, g.formato);
  // todas as séries (ex.: os dois anos de uma comparação), não só a primeira
  if (g.tipo === 'barras') return barrasAgrupadas(dados.rotulos, dados.series, fmt);
  // um rótulo só, na primeira linha: os anos vizinhos (2022 e 2023) se sobreporiam; a legenda diz os dois
  const marcas: Marca[] = quebras.filter((n) => dados.rotulos.includes(String(n.quebra)))
    .map((n, i) => ({ x: String(n.quebra), rotulo: i === 0 ? 'eSocial' : '' }));
  return linhas(dados.rotulos, dados.series, fmt, marcas);
}
const alturaDoGrafico = (g: GraficoIa, dados: DadosGrafico) => (g.tipo === 'barras'
  ? Math.max(160, dados.categorias.length * (dados.series.length > 1 ? 18 * dados.series.length + 10 : 26) + 40)
  : 260);
/** Motivo de um gráfico recusado, sem a lista de colunas (que vai só para o modelo; a tabela está logo abaixo). */
const motivoCurto = (motivo: string) => motivo.replace(/\s*\((colunas|columns): [^)]*\)/, '');
const legendaQuebras = (notas: NotaMetodologica[]) => t(
  `Linha tracejada: mudança de captação da RAIS para o eSocial (${anosDas(notas)}). Anos dos dois lados não são diretamente comparáveis (MTE).`,
  `Dashed line: RAIS capture moved to eSocial (${anosDas(notas)}). Years on either side are not directly comparable (MTE).`,
);
/** Gráficos mostrados: na resposta rápida, um (o primeiro que pode ser montado). */
const graficosVisiveis = (p: RespostaPronta, modo: Modo) =>
  (modo === 'rapida' ? [p.graficos.find((g) => g.validacao.ok) ?? p.graficos[0]].filter((g): g is GraficoPronto => !!g) : p.graficos);
/** Fonte legível de um gráfico ou tabela: as bases que a consulta leu (sem o identificador interno). */
const fonteDaConsulta = (c?: ConsultaFeita) => (c ? fontesConsultadas([c.sql]).join('; ') : '');
const ROTULO_PAPEL = (): Record<TabelaPronta['espec']['papel'], string> => ({
  principal: '',
  alternativa: t('Alternativa: outro recorte, não atende integralmente ao pedido', 'Alternative: a different scope, does not fully meet the request'),
  complemento: t('Complemento', 'Supplement'),
});

// ---------------- exportação da conversa inteira ----------------

const LINHAS_PDF = 200;
/**
 * Modelo e consumo de uma resposta, para os detalhes e as exportações: "Haiku 5.5 (claude-haiku-5-5) · 3 chamadas,
 * 41.200 tokens de entrada e 2.100 de saída". Sem registro (conversas antigas): "Modelo não registrado".
 */
const textoModelo = (m?: MetaTurno) => {
  if (!m?.modelo) return nomeDoModelo(null);
  const u = m.uso;
  const n = (x: number) => x.toLocaleString(local());
  // a API separa os tokens novos dos de cache (lidos e gravados): a entrada total é a soma das três partes
  const entrada = u ? u.entrada + u.cache_lido + u.cache_escrito : 0;
  const uso = u?.chamadas
    ? ` · ${t(`${contar(u.chamadas, 'chamada', 'chamadas')}, ${n(entrada)} tokens de entrada${u.cache_lido ? ` (${n(u.cache_lido)} lidos do cache)` : ''} e ${n(u.saida)} de saída`,
      `${contar(u.chamadas, 'call', 'calls')}, ${n(entrada)} input tokens${u.cache_lido ? ` (${n(u.cache_lido)} read from cache)` : ''} and ${n(u.saida)} output tokens`)}`
    : '';
  return `${nomeDoModelo(m.modelo)} (${m.modelo})${uso}`;
};

const html = (s: unknown) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const limiteCelula = (s: string) => s.slice(0, 32_000); // limite de uma célula do Excel
const ROTULO_APENDICE = () => t('apêndice de reprodução (SQL e histórico das consultas)', 'reproduction appendix (SQL and query history)');

/** Linhas de uma consulta para o Excel: valores completos, com a competência também em "set/2025" ao lado. */
function linhasExcel(r: Extract<Resultado, { colunas: string[] }>, sql: string): Celula[][] {
  const tipos = tiposDoResultado(r, sql);
  const extra = tipos.map((tipo) => tipo === 'competencia');
  const cabecalho = r.colunas.flatMap((c, j) => (extra[j] ? [c, `${c}_mes`] : [c]));
  return [cabecalho, ...r.linhas.map((l) => l.flatMap((v, j) => (extra[j] ? [v, typeof v === 'number' ? rotuloCompetencia(v) : v] : [v])))];
}

/** A resposta tem alguma tabela montada? Sem nenhuma, as consultas usadas vão no lugar delas. */
const temTabelas = (p: RespostaPronta | null) => !!p?.tabelas.some((x) => x.tabela);

/**
 * Conversa em Excel: uma aba de resumo (pergunta, modo, contexto, período utilizado, resposta) e uma aba por
 * tabela das respostas, com números como números e os metadados (unidade, fonte, notas, legenda) acima.
 * Respostas sem tabela levam as consultas usadas. Com o apêndice de reprodução: todas as consultas
 * (inclusive as sem resultado e as recusadas), com SQL e situação, e uma aba com o histórico de execução.
 */
async function baixarExcel(lista: TurnoIa[], metas: MetaTurno[], prontas: (RespostaPronta | null)[], resultados: Record<string, Resultado>, paineis: Painel[], apendice: boolean,
  cobertura: Cobertura, geradoEm: string) {
  // tabelas com mais linhas do que a tela: a consulta roda de novo para a planilha levar todas (só com os dados
  // da mesma versão; com outra, vão as linhas guardadas na conversa)
  const inteiras = await Promise.all(prontas.map((p, i) => Promise.all((p?.tabelas ?? []).map((x) => (versaoDoTurno(metas[i], geradoEm).atual
    ? tabelaInteira(x, cobertura).catch(() => x.tabela)
    : Promise.resolve(x.tabela))))));
  const resumo: Planilha = {
    nome: t('Conversa', 'Conversation'),
    linhas: [
      [t('Fonte', 'Source'), fonteIa(paineis)],
      [t('Exportado em', 'Exported on'), new Date().toISOString()],
      [t('Conteúdo', 'Contents'), apendice ? `${t('respostas e tabelas, com', 'answers and tables, with')} ${ROTULO_APENDICE()}` : t('respostas e tabelas', 'answers and tables')],
      [],
      [t('Pergunta', 'Question'), t('Modo', 'Mode'), t('Contexto', 'Context'), t('Período utilizado', 'Period used'), t('Resposta', 'Answer'), t('Abas', 'Sheets'), t('Modelo', 'Model')],
    ],
  };
  const abas: Planilha[] = [];
  const historico: Celula[][] = [[t('Pergunta', 'Question'), t('Passo', 'Step'), t('Situação', 'Status'), t('Objetivo ou motivo', 'Purpose or reason'), 'SQL']];
  let n = 0;
  lista.forEach((turno, i) => {
    const p = prontas[i];
    const consultas = consultasDoTurno(turno);
    const refeita = refeitas(consultas, resultados);
    const nomes: string[] = [];
    for (const [k, x] of (p?.tabelas ?? []).entries()) {
      const tab = inteiras[i][k] ?? x.tabela;
      if (!tab) continue;
      n += 1;
      const e = tabelaExportavel(tab, [[t('Pergunta', 'Question'), turno.pergunta], [t('Dados processados em', 'Data processed on'), versaoDoTurno(metas[i], geradoEm).geradoEm],
        [t('Modelo', 'Model'), textoModelo(metas[i])],
        ...(p ? recorteDe(p) : []), ...linhasGuardadas(tab, versaoDoTurno(metas[i], geradoEm))], cobertura);
      const nome = `${t('Tabela', 'Table')} ${n} ${tab.titulo}`;
      nomes.push(nome.slice(0, 31));
      abas.push({ nome, linhas: [...e.metadados.map(([k, v]): Celula[] => [k, v]), [], e.colunas, ...e.linhas] });
    }
    for (const item of turno.itens) {
      if (item.tipo === 'revisao') historico.push([turno.pergunta, t('revisão da resposta', 'answer review'), t('devolvida à IA', 'returned to the AI'), item.motivos.join(' | '), '']);
      if (item.tipo === 'localizacao') historico.push([turno.pergunta, t('localização', 'location'), '', `${item.nome} ${item.uf} → ${textoLocalizacao(resultados[item.id])}`, '']);
      if (item.tipo !== 'consulta') continue;
      const r = resultados[item.id];
      const usada = !!p?.usadas.has(item.rotulo);
      const situacao = [estadoConsulta(r).texto, usada ? t('usada na resposta', 'used in the answer') : '', refeita.has(item.rotulo) ? t(`refeita em ${refeita.get(item.rotulo)}`, `redone in ${refeita.get(item.rotulo)}`) : '']
        .filter(Boolean).join('; ');
      historico.push([turno.pergunta, item.rotulo, situacao, r && 'erro' in r ? `${item.objetivo} (${r.erro})` : item.objetivo, limiteCelula(item.sql)]);
      if (!apendice && !(usada && !temTabelas(p))) continue;
      const nome = `${item.rotulo} ${item.objetivo}`;
      nomes.push(nome.slice(0, 31));
      abas.push({
        nome,
        linhas: [
          [t('Pergunta', 'Question'), turno.pergunta],
          [t('Objetivo da consulta', 'Query purpose'), item.objetivo],
          [t('Fonte', 'Source'), fontesConsultadas([item.sql]).join('; ')],
          [t('Situação', 'Status'), situacao],
          ['SQL', limiteCelula(item.sql)],
          ...(r && 'erro' in r ? [[t('Erro', 'Error'), r.erro]] : [[t('Linhas', 'Rows'), r ? `${r.linhas.length} / ${r.total}` : '–']]),
          [],
          ...(r && !('erro' in r) ? linhasExcel(r, item.sql) : []),
        ],
      });
    }
    const resposta = p ? textoDaResposta(p) : turno.textoFinal ?? '';
    const modo = metas[i] ? rotuloModo(metas[i].contexto.modo) : '';
    resumo.linhas.push([turno.pergunta, modo, metas[i] ? descreverContexto(metas[i].contexto, p?.periodo) : '', p?.periodo ?? '', limiteCelula(resposta), nomes.join('; '), textoModelo(metas[i])]);
  });
  const todas = apendice ? [resumo, ...abas, { nome: t('Histórico de execução', 'Execution history'), linhas: historico }] : [resumo, ...abas];
  baixarArquivo(`${nomeArquivo(t('pergunte_aos_dados', 'ask_the_data'))}.xlsx`, paraXlsxAbas(todas) as BlobPart,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

/** Aviso na exportação de uma tabela cortada de uma resposta com dados de outra versão: vão só as linhas guardadas. */
function linhasGuardadas(tab: TabelaAnalitica, v: VersaoDados): [string, string][] {
  if (v.atual || tab.registros <= tab.carregados) return [];
  return [[t('Linhas exportadas', 'Exported rows'), t(`as ${tab.carregados.toLocaleString(local())} guardadas na conversa, de ${tab.registros.toLocaleString(local())}: os dados publicados agora são de outra versão, e a consulta não foi refeita`,
    `the ${tab.carregados.toLocaleString(local())} stored in the conversation, of ${tab.registros.toLocaleString(local())}: the data published now are a different version, so the query was not rerun`)]];
}

/** Tabela de consulta (apêndice e gráficos que não puderam ser montados), já formatada. */
function tabelaConsultaHtml(f: TabelaFormatada) {
  return `${f.extras.length ? `<p class="nota">${html(f.extras.join(' · '))}</p>` : ''}<table class="consulta-tab"><thead><tr>${f.cabecalho.map((c, j) => `<th class="${f.texto[j] ? 't' : ''}">${html(c)}</th>`).join('')}</tr></thead><tbody>`
    + f.linhas.map((l) => `<tr>${l.map((v, j) => `<td class="${f.texto[j] ? 't' : 'n'}">${html(v)}</td>`).join('')}</tr>`).join('')
    + '</tbody></table>';
}

/** Numeração de tabelas e gráficos ao longo do relatório (Tabela 1, Gráfico 1…). */
type Contador = { tabela: number; grafico: number };

/** Tabelas da resposta no relatório: título numerado, papel (alternativa, complemento), unidade, fonte e notas. */
function tabelasHtml(p: RespostaPronta, n: Contador) {
  return p.tabelas.map((x) => {
    if (!x.tabela) {
      const r = x.consulta?.resultado;
      const dados = r && !('erro' in r) && r.linhas.length ? tabelaConsultaHtml(formatarTabela(r, x.consulta!.sql, LINHAS_PDF)) : '';
      return `<div class="bloco-tabela"><p class="aviso">${html(t(`A tabela “${x.espec.titulo}” não pôde ser montada: ${x.motivo}.`, `Table “${x.espec.titulo}” could not be built: ${x.motivo}.`))}</p>${dados}</div>`;
    }
    n.tabela += 1;
    const papel = ROTULO_PAPEL()[x.espec.papel];
    return `<div class="bloco-tabela">${papel ? `<p class="papel">${html(papel)}</p>` : ''}${tabelaHtml(x.tabela, { numero: `${t('Tabela', 'Table')} ${n.tabela}` })}</div>`;
  }).join('');
}

/** Gráficos no relatório: título numerado e fonte legível (sem o identificador da consulta). */
function graficosHtml(p: RespostaPronta, modo: Modo, n: Contador) {
  return graficosVisiveis(p, modo).map((g) => {
    if (!g.validacao.ok) return '';
    n.grafico += 1;
    const svg = graficoSvg(opcaoDoGrafico(g.g, g.validacao.dados, g.quebras), 680, alturaDoGrafico(g.g, g.validacao.dados));
    const fonte = fonteDaConsulta(g.consulta);
    return `<figure class="grafico"><p class="titulo-grafico">${html(`${t('Gráfico', 'Chart')} ${n.grafico} — ${g.g.titulo || t('Gráfico', 'Chart')}`)}</p>${svg}`
      + `<figcaption class="nota">${html([fonte && `${t('Fonte', 'Source')}: ${fonte}; ${t('elaboração LAPAM/UFG', 'prepared by LAPAM/UFG')}.`, g.quebras.length ? legendaQuebras(g.quebras) : ''].filter(Boolean).join(' '))}</figcaption></figure>`;
  }).join('');
}

/** Alertas da resposta no relatório: pedido não atendido por inteiro e quebra de série da RAIS. */
function alertasHtml(p: RespostaPronta) {
  const faltas = p.faltantes.length ? `<div class="alerta"><strong>${html(avisoFaltantes(p))}</strong></div>` : '';
  const serie = p.alertas.length
    ? `<div class="alerta"><strong>${html(t(`Comparação entre anos com mudança de metodologia da RAIS (${anosDas(p.alertas)}).`, `Comparison across a RAIS methodology change (${anosDas(p.alertas)}).`))}</strong> `
      + `${html(t('A diferença observada mistura a variação do emprego com a ampliação da cobertura.', 'The observed difference mixes employment change with wider coverage.'))}`
      + `<ul>${p.alertas.map((x) => `<li>${html(x.curta())} <span class="nota">(${html(x.documento)})</span></li>`).join('')}</ul></div>`
    : '';
  return faltas + serie;
}

const fichaHtml = (linhas: [string, string][]) => (linhas.length
  ? `<table class="ficha">${linhas.map(([k, v]) => `<tr><th class="t">${html(k)}</th><td class="t">${html(v)}</td></tr>`).join('')}</table>` : '');

const notasHtml = (notas: NotaMetodologica[]) => (notas.length
  ? `<ul>${notas.map((x) => `<li><strong>${html(x.titulo())}.</strong> ${html(x.texto())}<br><span class="nota">${html(x.documento)}: ${html(x.url)}${x.trecho ? ` · ${html(t('trecho', 'excerpt'))}: “${html(x.trecho)}”` : ''} · ${html(t(`conferida em ${dataDaNota(x)}`, `checked on ${dataDaNota(x)}`))}</span></li>`).join('')}</ul>`
  : '');

/**
 * Uma resposta no relatório, conforme o modo em que foi feita. Rápida: conclusão, avisos, números
 * principais, tabelas, gráfico, ressalvas e fonte. Pesquisa: conclusão, avisos, recorte da análise, tabelas
 * completas, gráficos, análise dos resultados, ressalvas, metodologia e fontes. Sem identificadores internos.
 */
/** Texto da IA no PDF: os mesmos parágrafos e listas da página. */
const textoHtml = (v: string) => `<div class="texto">${blocosDeTexto(v).map((b) => (b.tipo === 'lista'
  ? `<ul>${b.itens.map((x) => `<li>${html(x)}</li>`).join('')}</ul>`
  : `<p>${html(b.texto)}</p>`)).join('')}</div>`;

function respostaHtml(p: RespostaPronta, modo: Modo, n: Contador) {
  const r = p.r;
  const texto = (titulo: string, v: string) => (v ? `<h4>${html(titulo)}</h4>${textoHtml(v)}` : '');
  const leituras = p.leituras.filter((l) => !l.motivo);
  const destaques = p.destaques.map((x) => `<div class="destaque"><span class="rotulo">${html(x.d.rotulo)}</span><strong>${html(x.valor)}</strong>`
    + `${x.unidade ? `<span class="unidade">${html(x.unidade)}</span>` : ''}${x.rotuloPeriodo ? `<span class="periodo">${html(x.rotuloPeriodo)}</span>` : ''}`
    + `${x.quebras.length ? `<span class="quebra">${html(t(`atravessa a quebra da RAIS (${anosDas(x.quebras)})`, `crosses the RAIS break (${anosDas(x.quebras)})`))}</span>` : ''}</div>`).join('');
  if (modo === 'rapida') {
    const fonte = [p.fontes.join('; '), p.territorios.join('; ') || r.recorte.territorio, p.periodo ?? r.recorte.periodo].filter(Boolean).join(' · ');
    return `<p class="conclusao">${html(r.conclusao)}</p>${alertasHtml(p)}${destaques ? `<div class="destaques">${destaques}</div>` : ''}`
      + `${tabelasHtml(p, n)}${graficosHtml(p, modo, n)}${texto(t('Ressalvas', 'Caveats'), r.limitacoes)}`
      + `${fonte ? `<p class="nota">${html(t('Fonte', 'Source'))}: ${html(fonte)}</p>` : ''}`;
  }
  const metodo = [
    texto(t('Metodologia', 'Methodology'), r.metodologia),
    p.fontes.length ? `<h4>${html(t('Fontes', 'Sources'))}</h4><ul>${p.fontes.map((f) => `<li>${html(f)}</li>`).join('')}</ul>` : '',
    p.bases.length ? `<p class="nota">${html(t('Versão das bases', 'Dataset versions'))}: ${html(p.bases.join('; '))}</p>` : '',
    p.notas.length ? `<h4>${html(t('Notas metodológicas verificadas', 'Verified methodological notes'))}</h4>${notasHtml(p.notas)}` : '',
  ].join('');
  return `<p class="conclusao">${html(r.conclusao)}</p>${alertasHtml(p)}`
    + `<h3>${html(t('Recorte da análise', 'Scope of the analysis'))}</h3>${fichaHtml(recorteDe(p))}`
    + `${p.tabelas.length ? `<h3>${html(t('Tabelas', 'Tables'))}</h3>${tabelasHtml(p, n)}` : ''}`
    + `${graficosHtml(p, modo, n)}`
    + `<h3>${html(t('Análise dos resultados', 'Analysis of the results'))}</h3>${r.explicacao ? textoHtml(r.explicacao) : ''}`
    + `${leituras.length ? `<ul>${leituras.map((l) => `<li>${html(l.texto)}</li>`).join('')}</ul>` : ''}`
    + `${texto(t('Hipóteses (não testadas pelos dados)', 'Hypotheses (not tested by the data)'), p.hipoteses)}`
    + `${texto(t('Ressalvas', 'Caveats'), r.limitacoes)}`
    + `${metodo ? `<h3>${html(t('Metodologia e fontes', 'Methodology and sources'))}</h3>${metodo}` : ''}`;
}

/** Apêndice de reprodução de uma pergunta: textos do modelo, consultas com SQL e tabelas, e o histórico de execução. */
function apendiceHtml(turno: TurnoIa, p: RespostaPronta | null, resultados: Record<string, Resultado>) {
  const partes: string[] = [];
  if (p) {
    if (p.hipotesesOmitidas) partes.push(`<h4>${html(t('Hipóteses (omitidas da resposta: a pergunta não pedia explicações)', 'Hypotheses (left out of the answer: the question did not ask for explanations)'))}</h4>${textoHtml(p.r.hipoteses)}`);
    const leituras = p.leituras.filter((l) => !l.motivo);
    if (leituras.length) partes.push(`<h4>${html(t('Leituras e colunas que as sustentam', 'Readings and supporting columns'))}</h4><ul>${leituras.map((l) => `<li>${html(l.texto)} <span class="nota">(${html(`${l.consulta}: ${l.colunas.join(', ')}`)})</span></li>`).join('')}</ul>`);
    const conferencia = p.destaques.map((x) => `<li>${html(x.d.rotulo)}: ${html(x.valor)} <span class="nota">(${html([
      x.conferencia !== 'conferido' ? t(`não encontrado na consulta ${x.d.consulta}`, `not found in query ${x.d.consulta}`)
        : x.origem === 'calculo' ? t(`calculado pela página a partir da consulta ${x.d.consulta}`, `computed by the page from query ${x.d.consulta}`)
          : x.origem === 'oficial' ? t(`valor oficial (${x.oficial}) no resultado da consulta ${x.d.consulta}, coluna ${x.d.coluna}, sem transformação`, `official value (${x.oficial}) in the result of query ${x.d.consulta}, column ${x.d.coluna}, unchanged`)
            : t(`localizado no resultado da consulta ${x.d.consulta}, coluna ${x.d.coluna}; sem comparação com referência oficial externa`, `found in the result of query ${x.d.consulta}, column ${x.d.coluna}; not compared with an external official reference`),
      x.consistente?.length ? textoConsistencia(x.consistente)[0] : '',
    ].filter(Boolean).join('; '))})</span></li>`).join('');
    if (conferencia) partes.push(`<h4>${html(t('Conferência dos números principais', 'Check of the key numbers'))}</h4><ul>${conferencia}</ul>`);
    const origem = p.tabelas.filter((x) => x.tabela).map((x) => `<li>${html(x.tabela!.titulo)}: ${html(t(`consulta ${x.espec.consulta}`, `query ${x.espec.consulta}`))} (${html(x.espec.tipo)}${x.espec.grupo ? `, ${html(t('grupo', 'group'))} ${html(x.espec.grupo)}` : ''}${x.espec.periodo ? `, ${html(t('período', 'period'))} ${html(x.espec.periodo)}` : ''}${x.espec.valor ? `, ${html(t('valor', 'value'))} ${html(x.espec.valor)}` : ''})</li>`).join('');
    if (origem) partes.push(`<h4>${html(t('Origem das tabelas', 'Table sources'))}</h4><ul>${origem}</ul>`);
  } else if (turno.textoFinal) partes.push(textoHtml(turno.textoFinal));
  const refeita = refeitas(consultasDoTurno(turno), resultados);
  const passos = turno.itens.map((item) => {
    if (item.tipo === 'nota') return `<p class="nota">${html(item.texto)}</p>`;
    if (item.tipo === 'localizacao') return `<p class="passo">${html(t('Localização', 'Location'))}: “${html(item.nome)}${item.uf ? ` (${html(item.uf)})` : ''}” → ${html(textoLocalizacao(resultados[item.id]))}</p>`;
    if (item.tipo === 'revisao') return `<div class="passo revisao"><strong>${html(t('Resposta devolvida à IA para correção', 'Answer returned to the AI for correction'))}</strong><ul>${item.motivos.map((m) => `<li>${html(m)}</li>`).join('')}</ul></div>`;
    const r = resultados[item.id];
    const marcas = [estadoConsulta(r).texto, item.substitui ? t(`refaz ${item.substitui}`, `redoes ${item.substitui}`) : '',
      refeita.has(item.rotulo) ? t(`refeita em ${refeita.get(item.rotulo)}`, `redone in ${refeita.get(item.rotulo)}`) : '',
      p?.usadas.has(item.rotulo) ? t('usada na resposta', 'used in the answer') : ''].filter(Boolean).join(' · ');
    let corpo = '';
    if (!r) corpo = `<p class="nota">${html(t('Consulta não executada.', 'Query not run.'))}</p>`;
    else if ('erro' in r) corpo = `<p class="nota">${html(r.bloqueada ? t('Recusada antes de executar', 'Refused before running') : t('A consulta falhou', 'The query failed'))}: ${html(r.erro)}</p>`;
    else if (!r.linhas.length) corpo = `<p class="nota">${html(t('Nenhum registro para este recorte.', 'No records for this scope.'))}</p>`;
    else {
      const f = formatarTabela(r, item.sql, LINHAS_PDF);
      corpo = `${tabelaConsultaHtml(f)}<p class="nota">${html(r.total > f.linhas.length && !f.emLinhas
        ? t(`${r.total.toLocaleString(local())} linhas; o relatório mostra as primeiras ${f.linhas.length} (todas as carregadas estão no Excel).`, `${r.total.toLocaleString(local())} rows; the report shows the first ${f.linhas.length} (all loaded rows are in the Excel file).`)
        : `${contar(r.total, t('linha', 'row'), t('linhas', 'rows'))}.`)}${r.linhas.some((l) => l.some((v) => v === null)) ? ` ${html(t('— = sem dado (ausente, não zero).', '— = no data (missing, not zero).'))}` : ''}</p>`;
    }
    const fonte = fontesConsultadas([item.sql]).join('; ');
    return `<div class="consulta"><h3>${html(item.rotulo)} · ${html(item.objetivo || t('Consulta', 'Query'))} <span class="nota">(${html(marcas)})</span></h3>${fonte ? `<p class="nota">${html(t('Tabelas de origem', 'Source tables'))}: ${html(fonte)}</p>` : ''}<pre>${html(item.sql)}</pre>${corpo}</div>`;
  }).join('');
  partes.push(`<h4>${html(t('Histórico de execução', 'Execution history'))}</h4>${passos || `<p class="nota">${html(t('Sem consultas.', 'No queries.'))}</p>`}`);
  return partes.join('');
}

/**
 * Relatório para impressão (o navegador salva em PDF): cada resposta no modo em que foi feita (resposta
 * rápida ou análise para pesquisa) e, se pedido, o apêndice de reprodução. Vai num iframe invisível, para
 * não depender de janelas pop-up.
 */
function imprimirPdf(lista: TurnoIa[], metas: MetaTurno[], prontas: (RespostaPronta | null)[], resultados: Record<string, Resultado>,
  o: { email: string; paineis: Painel[]; apendice: boolean; geradoEm: string }) {
  const n: Contador = { tabela: 0, grafico: 0 };
  const corpo = lista.map((turno, i) => {
    const p = prontas[i];
    const modo = metas[i]?.contexto.modo ?? 'rapida';
    const resposta = p ? respostaHtml(p, modo, n) : turno.textoFinal ? textoHtml(turno.textoFinal) : '';
    return `<section class="pergunta"><h2>${i + 1}. ${html(turno.pergunta)}</h2>`
      + `<p class="nota">${html(rotuloModo(modo))}${metas[i] ? ` · ${html(descreverContexto(metas[i].contexto, p?.periodo, false))}` : ''}</p>`
      + `<p class="nota">${html(t('Modelo', 'Model'))}: ${html(textoModelo(metas[i]))}</p>${resposta}</section>`;
  }).join('');
  const anexo = o.apendice
    ? `<section class="apendice"><h1>${html(t('Apêndice de reprodução', 'Reproduction appendix'))}</h1>`
      + `<p class="nota">${html(t('Consultas SQL executadas no navegador sobre os arquivos do painel, com os resultados e o histórico de cada pergunta.', 'SQL queries run in the browser on the dashboard files, with the results and the history of each question.'))}</p>`
      + lista.map((turno, i) => `<section><h2>${i + 1}. ${html(turno.pergunta)}</h2>${apendiceHtml(turno, prontas[i], resultados)}</section>`).join('') + '</section>'
    : '';
  const doc = `<!doctype html><html lang="${idioma() === 'en' ? 'en' : 'pt-BR'}"><head><meta charset="utf-8">
    <title>${html(t('Pergunte aos dados — LAPAM/UFG', 'Ask the data — LAPAM/UFG'))}</title>
    <style>
      @page { size: A4; margin: 16mm 14mm; }
      body { font: 10.5pt/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f1e2c; }
      header { border-bottom: 2px solid #002f51; margin-bottom: 12px; padding-bottom: 6px; }
      header h1, .apendice > h1 { font-size: 15pt; margin: 0; color: #002f51; }
      .apendice { break-before: page; }
      header p, .nota { font-size: 8.5pt; color: #4b5563; margin: 3px 0; }
      h2 { font-size: 12pt; color: #002f51; margin: 18px 0 4px; break-after: avoid; }
      h3 { font-size: 10.5pt; color: #002f51; margin: 14px 0 4px; break-after: avoid; }
      h4 { font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; color: #4b5563; margin: 10px 0 2px; break-after: avoid; }
      .pergunta + .pergunta { margin-top: 22px; }
      .conclusao { font-weight: 600; border-left: 3px solid #a4bc0b; padding-left: 8px; }
      .alerta { border: 1px solid #c98a1a; background: #fdf6e7; border-radius: 6px; padding: 6px 10px; margin: 8px 0; font-size: 9.5pt; break-inside: avoid; }
      .alerta ul { margin: 4px 0 0; padding-left: 16px; }
      .destaques { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; margin: 8px 0; }
      .destaque { background: #f1eee4; border-radius: 6px; padding: 6px 8px; display: flex; flex-direction: column; break-inside: avoid; }
      .destaque strong { font-size: 13pt; }
      .destaque .rotulo, .destaque .periodo, .destaque .unidade { font-size: 8.5pt; color: #44505f; }
      .destaque .quebra { font-size: 8pt; color: #8a5a00; font-weight: 600; }
      .grafico { margin: 10px 0; break-inside: avoid; }
      .grafico svg { max-width: 100%; height: auto; }
      .titulo-grafico { font-weight: 600; margin: 0 0 2px; font-size: 9.5pt; break-after: avoid; }
      .aviso { font-size: 9pt; color: #8a2a2a; }
      .papel { font-size: 8.5pt; font-weight: 600; color: #8a5a00; margin: 8px 0 0; break-after: avoid; }
      .texto { margin: 4px 0; }
      .texto p { margin: 0 0 6px; }
      .consulta, .passo { border-left: 3px solid #a4bc0b; padding-left: 8px; margin: 10px 0; }
      .revisao { border-left-color: #c98a1a; }
      pre { font: 8pt/1.35 Consolas, monospace; background: #f1eee4; padding: 6px 8px; white-space: pre-wrap; word-break: break-word; }
      table { border-collapse: collapse; width: 100%; margin: 4px 0; }
      thead { display: table-header-group; }
      tr { break-inside: avoid; }
      caption { caption-side: top; text-align: left; font-weight: 600; font-size: 9.5pt; padding: 0 0 4px; break-after: avoid; }
      .bloco-tabela { margin: 10px 0 12px; }
      table.analitica { font-size: 8.5pt; width: auto; min-width: 60%; max-width: 100%; }
      table.analitica th { background: #002f51; color: #fff; font-weight: 600; padding: 3px 7px; vertical-align: bottom; }
      table.analitica td { border-bottom: 1px solid #d9d4c6; padding: 2px 7px; }
      table.analitica td.n, table.analitica th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      table.analitica td.t, table.analitica th.t { text-align: left; }
      table.analitica tr.total td { font-weight: 700; border-top: 1.5px solid #002f51; }
      table.analitica + .nota { margin-top: 4px; }
      .consulta-tab { font-size: 8pt; }
      .consulta-tab th, .consulta-tab td { border-bottom: 1px solid #ddd; padding: 2px 6px; text-align: center; }
      .consulta-tab th { background: #002f51; color: #fff; }
      .consulta-tab td.n { font-variant-numeric: tabular-nums; }
      th.t, td.t { text-align: left; }
      .ficha { font-size: 9pt; }
      .ficha th { background: none; color: #44505f; width: 26%; vertical-align: top; padding: 2px 8px 2px 0; text-align: left; }
      .ficha td { padding: 2px 0; vertical-align: top; }
    </style></head><body>
    <header><h1>${html(t('Pergunte aos dados — LAPAM/UFG', 'Ask the data — LAPAM/UFG'))}</h1>
      <p>${html(o.email)} · ${html(new Date().toLocaleString(local()))} · ${html(t(`dados processados em ${o.geradoEm}`, `data processed on ${o.geradoEm}`))}${o.apendice ? ` · ${html(t('com', 'with'))} ${html(ROTULO_APENDICE())}` : ''}</p>
      <p>${html(fonteIa(o.paineis))}</p></header>
    ${corpo}${anexo}</body></html>`;
  const quadro = document.createElement('iframe');
  quadro.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
  document.body.append(quadro);
  const janela = quadro.contentWindow!;
  janela.document.open();
  janela.document.write(doc);
  janela.document.close();
  // espera o documento montar; remove o iframe depois que a janela de impressão fecha
  setTimeout(() => {
    janela.focus();
    janela.print();
    setTimeout(() => quadro.remove(), 1000);
  }, 300);
}

// ---------------- peças da página ----------------

/** Texto da IA em parágrafos e listas ("- " no começo da linha); nada de HTML vindo do modelo. */
function TextoRico({ texto }: { texto: string }) {
  if (!texto) return null;
  return (
    <div className="ia-texto">
      {blocosDeTexto(texto).map((b, i) => (b.tipo === 'lista'
        ? <ul key={i}>{b.itens.map((x, j) => <li key={j}>{x}</li>)}</ul>
        : <p key={i}>{b.texto}</p>))}
    </div>
  );
}

/** Nomes curtos das bases, no resumo do contexto. */
const NOMES_CURTOS = (): Record<Painel, string> => ({
  financas: t('Finanças', 'Finances'), trabalho: t('Trabalho', 'Labour'), saude: t('Saúde', 'Health'),
});
/** "Todas as bases · Brasil · Ano automático": o contexto em uma linha, no botão que abre os ajustes. */
const resumoContexto = (c: ContextoIa) => [
  c.paineis.length === PAINEIS.length ? t('Todas as bases', 'All datasets') : c.paineis.map((p) => NOMES_CURTOS()[p]).join(' + '),
  rotuloTerritorio(c.territorio),
  c.ano ? t(`Ano ${c.ano}`, `Year ${c.ano}`) : t('Ano automático', 'Automatic year'),
];

/** "modelo 41 s em 5 chamadas · consultas 9 s (1 reaproveitada) · revisão 0 s": onde foi o tempo da pergunta. */
function tempoPorEtapa(etapas: Etapa[]): string {
  const s = (ms: number) => `${Math.round(ms / 1000)} s`;
  const de = (tipo: Etapa['tipo']) => etapas.filter((e) => e.tipo === tipo);
  const soma = (xs: Etapa[]) => xs.reduce((a, e) => a + e.ms, 0);
  const modelo = de('modelo');
  const consultas = de('consulta');
  const reuso = consultas.filter((e) => e.reaproveitada).length;
  return [
    modelo.length && t(`modelo ${s(soma(modelo))} em ${contar(modelo.length, 'chamada', 'chamadas')}`, `model ${s(soma(modelo))} in ${modelo.length} calls`),
    consultas.length && t(`consultas ${s(soma(consultas))}${reuso ? ` (${reuso} reaproveitada${reuso > 1 ? 's' : ''})` : ''}`, `queries ${s(soma(consultas))}${reuso ? ` (${reuso} reused)` : ''}`),
    de('revisao').length && t(`conferência ${s(soma(de('revisao')))}`, `checks ${s(soma(de('revisao')))}`),
  ].filter(Boolean).join(' · ');
}

/**
 * Cabeçalho de cada resposta: o recorte que as consultas executaram de fato (território lido dos códigos no SQL,
 * período dos resultados, fontes lidas) e, à parte, o contexto da página quando ele não foi o usado.
 */
function RecorteExecutado({ contexto, pronta }: { contexto: ContextoIa; pronta: RespostaPronta | null }) {
  const territorio = pronta?.territorios.length ? pronta.territorios.join('; ') : null;
  const periodo = pronta?.periodo ?? null;
  const daPagina = rotuloTerritorio(contexto.territorio);
  const diferente = (territorio && territorio !== daPagina) || (periodo && contexto.ano && !periodo.includes(String(contexto.ano)));
  return (
    <div className="ia-recorte-executado">
      <ul className="ia-chips pequenos" aria-label={t('Recorte executado nesta resposta', 'Scope executed in this answer')}>
        <li className="ia-chip" title={t('Painéis consultados', 'Dashboards queried')}>{contexto.paineis.map((p) => NOMES_PAINEIS()[p]).join(' + ')}</li>
        <li className="ia-chip" title={t('Território das consultas executadas', 'Territory of the executed queries')}>{territorio ?? daPagina}</li>
        <li className="ia-chip" title={t('Período dos resultados', 'Period of the results')}>{periodo ?? rotuloDoPeriodo(contexto, null)}</li>
      </ul>
      {pronta && periodosDiferem(pronta) && (
        <p className="ia-nota ia-periodos-fonte">
          <strong>{t('Períodos diferentes por fonte: ', 'Different periods by source: ')}</strong>{textoPeriodosPorFonte(pronta)}.
        </p>
      )}
      {pronta && diferente && (
        <p className="ia-nota ia-contexto-pagina">
          {t(`Recorte lido das consultas executadas. Contexto da página quando a pergunta foi feita: ${daPagina}${contexto.ano ? `, ${contexto.ano}` : ''} (a pergunta especificou outro recorte).`,
            `Scope read from the executed queries. Page context when the question was asked: ${daPagina}${contexto.ano ? `, ${contexto.ano}` : ''} (the question specified another scope).`)}
        </p>
      )}
    </div>
  );
}

function Ajustes({ paineis, alternarPainel, travarPaineis, anos, ano, definirAno, rotulo, temAjustes, limpar, concluir }: {
  paineis: Painel[]; alternarPainel: (p: Painel) => void; travarPaineis: boolean;
  anos: number[]; ano: number | null; definirAno: (a: number | null) => void; rotulo: (a: number) => string;
  temAjustes: boolean; limpar: () => void; concluir: () => void;
}) {
  const { entes } = useDados();
  const f = useFiltros();
  return (
    <div id="ia-ajustes" className="ia-ajustes" role="group" aria-label={t('Contexto da pergunta', 'Question context')}
      onKeyDown={(e) => {
        // Esc fecha o painel (o Esc da lista de municípios só fecha a lista)
        if (e.key === 'Escape' && !e.defaultPrevented && !(e.target as HTMLElement).closest('[aria-expanded="true"]')) {
          e.preventDefault();
          concluir();
        }
      }}>
      <p className="ia-ajustes-intro">{t('Opcional. Bases, território e ano valem quando a pergunta não os disser; o que a pergunta disser prevalece.',
        'Optional. Datasets, territory and year apply when the question does not state them; what the question says takes priority.')}</p>
      <fieldset className="ia-grupo">
        <legend>{t('Bases consultadas', 'Datasets queried')}</legend>
        <div className="ia-linha">
          {PAINEIS.map((p) => (
            <label key={p} className="caixa">
              <input type="checkbox" checked={paineis.includes(p)} disabled={travarPaineis || (paineis.length === 1 && paineis.includes(p))}
                onChange={() => alternarPainel(p)} /> {NOMES_PAINEIS()[p]}
            </label>
          ))}
        </div>
        {travarPaineis && (
          <p className="ia-nota">{t('Para mudar as bases, comece uma nova conversa: cada base traz tabelas e regras próprias.',
            'To change the datasets, start a new conversation: each dataset brings its own tables and rules.')}</p>
        )}
      </fieldset>
      <fieldset className="ia-grupo">
        <legend>{t('Território', 'Territory')}</legend>
        <div className="filtros">
          <div className="campo">
            <label htmlFor="ia-uf">{t('UF', 'State')}</label>
            <select id="ia-uf" value={f.uf ?? ''} onChange={(e) => f.definir({ uf: e.target.value || null, ente: null })}>
              <option value="">{t('Nenhuma (Brasil)', 'None (Brazil)')}</option>
              {UFS.map((u) => <option key={u} value={u}>{`${u} · ${nomeDaUf(u)}`}</option>)}
            </select>
          </div>
          <BuscaEnte entes={entes} uf={f.uf} atual={f.ente} rotulo={t('Município ou estado', 'Municipality or state')}
            aoEscolher={(e) => f.definir({ ente: e?.cod_ibge ?? null, uf: e?.uf ?? f.uf })} />
        </div>
        <p className="ia-nota">{t('Vale quando a pergunta não disser o lugar. Sem território, a IA responde para o Brasil e avisa. É o mesmo filtro dos painéis.',
          'Used when the question does not name a place. With no territory, the AI answers for Brazil and says so. It is the same filter as the dashboards.')}</p>
      </fieldset>
      <fieldset className="ia-grupo">
        <legend>{t('Ano', 'Year')}</legend>
        <div className="campo">
          <label htmlFor="ia-ano" className="sr-only">{t('Ano', 'Year')}</label>
          <select id="ia-ano" value={ano ?? ''} onChange={(e) => definirAno(e.target.value ? Number(e.target.value) : null)} aria-describedby="ia-ano-nota">
            <option value="">{t('Automático', 'Automatic')}</option>
            {[...anos].reverse().map((a) => <option key={a} value={a}>{rotulo(a)}</option>)}
          </select>
        </div>
        <p id="ia-ano-nota" className="ia-nota">{t('Automático: vale o ano que a pergunta citar; se ela não citar nenhum, a IA usa o mais recente disponível em cada fonte. Um ano escolhido aqui vale só para as perguntas que não disserem o ano.',
          'Automatic: the year named in the question is used; if it names none, the AI uses the latest year available in each source. A year chosen here applies only to questions that do not name a year.')}</p>
      </fieldset>
      <div className="ia-ajustes-acoes">
        {temAjustes && <button type="button" className="ia-botao-leve" onClick={limpar}>{t('Limpar ajustes', 'Clear settings')}</button>}
        <button type="button" className="ia-botao-primario" onClick={concluir}>{t('Concluir', 'Done')}</button>
      </div>
    </div>
  );
}

/**
 * Modelo da próxima pergunta, junto do campo: "Modelo · Haiku" (padrão, mais rápido e barato) ou Sonnet (segue melhor as
 * regras, mas é mais lento e custa cerca de 20 vezes mais por token). Independe do modo de resposta (formato) e só
 * troca por escolha da pessoa: se o modelo falhar, a pergunta volta ao campo e nada muda sozinho.
 */
function SeletorModelo({ escolha, definir, travado }: { escolha: EscolhaModelo; definir: (m: EscolhaModelo) => void; travado: boolean }) {
  return (
    <label className="ia-modelo-seletor" title={descricaoModelo(escolha)}>
      <span>{t('Modelo', 'Model')} ·</span>
      <select value={escolha} disabled={travado} onChange={(e) => definir(lerEscolhaModelo(e.target.value))} aria-describedby="ia-modelo-desc">
        <option value="haiku">Haiku</option>
        <option value="sonnet">Sonnet</option>
      </select>
    </label>
  );
}
const descricaoModelo = (m: EscolhaModelo) => (m === 'sonnet'
  ? t('Sonnet: segue melhor regras complexas, mas é mais lento e custa cerca de 20 vezes mais por token. Vale para o próximo envio.',
    'Sonnet: follows complex rules better, but is slower and costs about 20 times more per token. Applies to the next send.')
  : t('Haiku (padrão): mais rápido e barato. Vale para o próximo envio.', 'Haiku (default): faster and cheaper. Applies to the next send.'));

/** Modo de resposta: alternância compacta no compositor; vale para as próximas perguntas e fica guardada. */
function SeletorModo({ modo, definir, travado }: { modo: Modo; definir: (m: Modo) => void; travado: boolean }) {
  return (
    <fieldset className="ia-modos" disabled={travado}>
      <legend className="sr-only">{t('Modo de resposta', 'Answer mode')}</legend>
      {MODOS.map((m) => (
        <label key={m} className={`ia-modo${modo === m ? ' ativo' : ''}`} title={descricaoModo(m)}>
          <input type="radio" className="sr-only" name="ia-modo" value={m} checked={modo === m} onChange={() => definir(m)} aria-describedby="ia-modo-desc" />
          {rotuloModo(m)}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * O compositor: campo da pergunta e, na faixa de baixo, o modo, o resumo do contexto (abre os ajustes) e o envio.
 * Sem login, o envio vira "Entrar para perguntar": a pergunta fica guardada (sessionStorage) e o contexto e o idioma
 * voltam com o login.
 */
function Compositor({ valor, mudar, enviar, cancelar, ocupado, bloqueio, exemplo, grande, campo, modo, descricaoDoModo, descricaoDoModelo, modeloAlterado, restaurarModelo,
  resumo, ajustesAbertos, alternarAjustes, botaoContexto, painelAjustes, entrar, verificando, aoComoAcesso, alerta }: {
  valor: string; mudar: (v: string) => void; enviar: (v: string) => void; cancelar: () => void; ocupado: boolean;
  bloqueio: string | null; exemplo: string; grande?: boolean; campo: RefObject<HTMLTextAreaElement | null>;
  modo: ReactNode; descricaoDoModo: string; descricaoDoModelo: string; modeloAlterado: boolean; restaurarModelo: () => void; resumo: string[]; ajustesAbertos: boolean; alternarAjustes: () => void;
  botaoContexto: RefObject<HTMLButtonElement | null>; painelAjustes: ReactNode; entrar: boolean; verificando: boolean;
  aoComoAcesso: (e: { currentTarget: HTMLElement }) => void; alerta: string | null;
}) {
  // o campo cresce com o texto, até um limite (depois rola)
  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = `${Math.min(c.scrollHeight + 2, grande ? 320 : 240)}px`;
  }, [valor, grande, campo]);
  const restantes = MAX_PERGUNTA - valor.length;
  return (
    <div className="ia-compositor-bloco">
      <form className={`ia-compositor${grande ? ' grande' : ''}`} onSubmit={(e) => { e.preventDefault(); enviar(valor); }}>
        <label htmlFor="ia-pergunta" className="sr-only">{t('Sua pergunta', 'Your question')}</label>
        <textarea
          id="ia-pergunta"
          ref={campo}
          value={valor}
          maxLength={MAX_PERGUNTA}
          rows={grande ? 3 : 1}
          placeholder={exemplo}
          aria-describedby="ia-dica"
          onChange={(e) => mudar(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (!ocupado) enviar(valor);
            } else if (e.key === 'Escape' && ocupado) {
              e.preventDefault();
              cancelar();
            }
          }}
        />
        <div className="ia-compositor-barra">
          {modo}
          <button ref={botaoContexto} type="button" className="ia-contexto-botao" aria-expanded={ajustesAbertos} aria-controls="ia-ajustes" onClick={alternarAjustes}
            title={t('Bases, território e ano usados quando a pergunta não os disser', 'Datasets, territory and year used when the question does not state them')}>
            <Icone nome="ajustes" tamanho={15} />
            <span className="sr-only">{t('Contexto: ', 'Context: ')}</span>
            {/* uma parte por informação: no celular quebram linha inteiras; no computador só o território encurta (com …) */}
            <span className="ia-contexto-resumo" title={resumo.join(' · ')}>
              {resumo.map((x, i) => <span key={i} className="ia-ctx-parte">{x}{i < resumo.length - 1 ? ' · ' : ''}</span>)}
            </span>
          </button>
          <span className="ia-compositor-espaco" />
          {ocupado
            ? <button type="button" className="ia-parar" onClick={cancelar}><Icone nome="parar" tamanho={15} /> {t('Cancelar', 'Cancel')}</button>
            : entrar
              ? <a className="ia-entrar-botao" href={urlEntrar()}><Icone nome="entrar" tamanho={16} /> {t('Entrar para perguntar', 'Sign in to ask')}</a>
              : (
                <button type="submit" className="ia-enviar" disabled={!!bloqueio || verificando || !valor.trim()}
                  aria-label={t('Enviar pergunta', 'Send question')} title={t('Enviar pergunta (Enter)', 'Send question (Enter)')}
                  aria-describedby={bloqueio ? 'ia-bloqueio' : undefined}>
                  <Icone nome="enviar" />
                </button>
              )}
        </div>
      </form>
      {painelAjustes}
      <p id="ia-dica" className="ia-dica">
        <span id="ia-modo-desc">{descricaoDoModo}</span>
        <span id="ia-modelo-desc" className="sr-only"> {descricaoDoModelo}</span>
        {modeloAlterado && <> · <button type="button" className="ia-link" onClick={restaurarModelo}>{t('Voltar ao modelo padrão (Haiku)', 'Back to the default model (Haiku)')}</button></>}
        {' · '}
        {ocupado ? t('Esc ou Cancelar interrompem a análise', 'Esc or Cancel stop the analysis')
          : verificando ? t('verificando o acesso…', 'checking access…')
            : t('Enter envia · Shift+Enter quebra a linha', 'Enter sends · Shift+Enter adds a line')}
        {alerta && <> · <span className="ia-alerta">{alerta}</span></>}
        {restantes < 300 && <> · <span className={restantes < 50 ? 'ia-alerta' : undefined}>{t(`${contar(restantes, 'caractere restante', 'caracteres restantes')}`, `${contar(restantes, 'character left', 'characters left')}`)}</span></>}
      </p>
      {entrar && (
        <p className="ia-dica ia-dica-entrar">
          {t('Você pode escrever agora: a pergunta e o contexto ficam guardados enquanto você entra com seu e-mail.',
            'You can write now: the question and the context are kept while you sign in with your email.')}{' '}
          <button type="button" className="ia-link" onClick={aoComoAcesso}>{t('Como funciona o acesso?', 'How does access work?')}</button>
        </p>
      )}
      {bloqueio && <p id="ia-bloqueio" className="ia-bloqueio" role="status">{bloqueio}</p>}
    </div>
  );
}

/** Três sugestões leves na tela inicial: o título curto no botão, a pergunta completa vai para o campo. */
function Sugestoes({ lista, aoEscolher }: { lista: Sugestao[]; aoEscolher: (s: Sugestao) => void }) {
  if (!lista.length) return null;
  return (
    <ul className="ia-sugestoes" aria-label={t('Sugestões para começar', 'Suggestions to get started')}>
      {lista.slice(0, 3).map((s) => (
        <li key={s.texto}>
          <button type="button" className="ia-sugestao" onClick={() => aoEscolher(s)} title={s.texto}>{s.titulo}</button>
        </li>
      ))}
    </ul>
  );
}

/** Anos citados na pergunta de um exemplo ("de 2014 a 2024"), para compará-los com o ano do contexto. */
const anosDoTexto = (texto: string) => [...new Set((texto.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number))];

/**
 * "Explorar exemplos": primeiro os das bases marcadas no contexto, por tema (as perguntas entre bases por último);
 * "Ver todos" mostra o catálogo inteiro. Cada exemplo diz o que ele muda no contexto antes de preencher o campo.
 */
function Exemplos({ lista, selecionados, ano, aoEscolher, fixo }: {
  lista: Sugestao[]; selecionados: Painel[]; ano: number | null; aoEscolher: (s: Sugestao) => void; fixo: boolean;
}) {
  const compativel = (s: Sugestao) => s.paineis.every((p) => selecionados.includes(p));
  const compativeis = lista.filter(compativel);
  const [todos, setTodos] = useState(false);
  const outros = lista.length - compativeis.length;
  const mostrarTodos = todos || !compativeis.length;
  const ordem = (xs: Sugestao[]) => [...xs.filter((x) => x.paineis.length === 1), ...xs.filter((x) => x.paineis.length > 1)];
  const grupos = new Map<string, Sugestao[]>();
  for (const s of ordem(mostrarTodos ? [...compativeis, ...lista.filter((x) => !compativel(x))] : compativeis)) {
    grupos.set(s.tema, [...(grupos.get(s.tema) ?? []), s]);
  }
  const avisos = (s: Sugestao) => {
    const itens: string[] = [];
    const novas = s.paineis.filter((p) => !selecionados.includes(p));
    if (novas.length) itens.push(t(`Acrescenta ao contexto: ${novas.map((p) => NOMES_PAINEIS()[p]).join(' + ')}.`, `Adds to the context: ${novas.map((p) => NOMES_PAINEIS()[p]).join(' + ')}.`));
    const anos = anosDoTexto(s.texto);
    if (ano && anos.length && !anos.every((a) => a === ano)) {
      itens.push(t(`Período da pergunta: ${anos.length > 1 ? `${anos[0]}–${anos.at(-1)}` : anos[0]}. O contexto tem ${ano}; vale o da pergunta.`,
        `Period of the question: ${anos.length > 1 ? `${anos[0]}–${anos.at(-1)}` : anos[0]}. The context has ${ano}; the question's period applies.`));
    }
    if (s.nota) itens.push(s.nota);
    return itens;
  };
  return (
    <>
      <p className="ia-nota ia-exemplos-intro">{t('O exemplo preenche o campo com a pergunta completa: revise antes de enviar. O que a pergunta diz (lugar, período) vale mais que o contexto.',
        'An example fills the box with the full question: review it before sending. What the question says (place, period) takes priority over the context.')}</p>
      {!fixo && outros > 0 && compativeis.length > 0 && (
        <p className="ia-exemplos-filtro">
          <span>{mostrarTodos
            ? t('Mostrando todos os exemplos.', 'Showing all examples.')
            : t(`Mostrando os das bases selecionadas (${selecionados.map((p) => NOMES_PAINEIS()[p]).join(' + ')}).`, `Showing those for the selected datasets (${selecionados.map((p) => NOMES_PAINEIS()[p]).join(' + ')}).`)}</span>
          <button type="button" className="ia-link" onClick={() => setTodos(!todos)} aria-pressed={todos}>
            {todos ? t('Ver só as bases selecionadas', 'Show selected datasets only') : t(`Ver todos (${lista.length})`, `See all (${lista.length})`)}
          </button>
        </p>
      )}
      {[...grupos].map(([tema, itens]) => (
        <section key={tema} className="ia-exemplos-grupo" aria-label={tema}>
          <h3>{tema}</h3>
          <ul>
            {itens.map((s) => {
              const dicas = avisos(s);
              return (
                <li key={s.texto}>
                  <button type="button" className="ia-exemplo" onClick={() => aoEscolher(s)}>
                    <span className="ia-exemplo-titulo">{s.titulo}</span>
                    <span className="ia-exemplo-texto">{s.texto}</span>
                    {dicas.length > 0 && <span className="ia-exemplo-aviso">{dicas.join(' ')}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}

export type SecaoAjuda = 'dados' | 'como' | 'acesso' | 'privacidade' | 'conferencia';

/** Os três passos para entrar (código por e-mail, sem senha); a numeração vem do CSS e não é lida duas vezes. */
function PassosAcesso() {
  return (
    <ol className="ia-entrar-passos" role="list">
      <li><strong>{t('E-mail', 'Email')}</strong>{t('Informe um e-mail autorizado pelo LAPAM na tela de login.', 'Enter an email authorized by LAPAM on the login screen.')}</li>
      <li><strong>{t('Código', 'Code')}</strong>{t('Digite o código de 6 dígitos recebido por e-mail (veja o spam se não chegar).', 'Type the 6-digit code you receive by email (check spam if it does not arrive).')}</li>
      <li><strong>{t('Revisar', 'Review')}</strong>{t('Você volta a esta página com a pergunta, o contexto e o idioma; revise e envie.', 'You return to this page with your question, context and language; review and send.')}</li>
    </ol>
  );
}

/** "Como funciona o acesso?": direto nas instruções de entrada, sem a ajuda inteira (que fica a um botão de distância). */
function AjudaEntrar({ entrar, aoVerTudo }: { entrar: boolean; aoVerTudo: () => void }) {
  return (
    <div className="ia-ajuda">
      <p>{t('Não há senha: o acesso é por um código enviado a um e-mail autorizado pelo LAPAM.', 'There is no password: access is by a code sent to an email authorized by LAPAM.')}</p>
      <PassosAcesso />
      <p className="ia-nota">{t('O código não chegou em alguns minutos? O e-mail pode não estar autorizado: peça a inclusão ao LAPAM. Cada conta tem um limite diário de perguntas.',
        'No code after a few minutes? The email may not be authorized: ask LAPAM to add it. Each account has a daily question limit.')}</p>
      <p className="ia-entrar-acoes">
        {entrar && <a className="ia-botao-primario" href={urlEntrar()}>{t('Entrar para perguntar', 'Sign in to ask')}</a>}
        <button type="button" className="ia-botao-leve" onClick={aoVerTudo}>{t('Ver toda a ajuda', 'See all help')}</button>
      </p>
    </div>
  );
}

const irParaSecao = (secao: SecaoAjuda) => {
  const h = document.getElementById(`ia-ajuda-${secao}`);
  h?.scrollIntoView({ block: 'start' });
  h?.focus({ preventScroll: true });
};

/** Ajuda da IA: dados disponíveis, funcionamento, acesso, privacidade e conferência, em seções; abre na pedida. */
function Ajuda({ secao, paineis, cobertura, estado, conta }: {
  secao: SecaoAjuda | null; paineis: Painel[]; cobertura: Cobertura; estado: EstadoIa | null | undefined; conta: string | null;
}) {
  useEffect(() => {
    if (secao) irParaSecao(secao);
  }, [secao]);
  const linhas = descreverCobertura(PAINEIS, cobertura);
  return (
    <div className="ia-ajuda">
      {/* botões, não âncoras: navegar dentro da ajuda não deve deixar fragmentos (#…) nem entradas no histórico */}
      <nav className="ia-ajuda-indice" aria-label={t('Seções da ajuda', 'Help sections')}>
        {([['dados', t('Dados disponíveis', 'Available data')], ['como', t('Como funciona', 'How it works')], ['acesso', t('Acesso', 'Access')],
          ['privacidade', t('Privacidade', 'Privacy')], ['conferencia', t('Conferência', 'Checking')]] as [SecaoAjuda, string][]).map(([id, nome]) => (
          <button key={id} type="button" onClick={() => irParaSecao(id)}>{nome}</button>
        ))}
      </nav>
      <section aria-labelledby="ia-ajuda-dados">
        <h3 id="ia-ajuda-dados" tabIndex={-1}>{t('Dados disponíveis', 'Available data')}</h3>
        {linhas.length ? <ul>{linhas.map((l) => <li key={l}>{l}</li>)}</ul> : <p>{t('Carregando a cobertura das bases…', 'Loading the dataset coverage…')}</p>}
      </section>
      <section aria-labelledby="ia-ajuda-como">
        <h3 id="ia-ajuda-como" tabIndex={-1}>{t('Como funciona', 'How it works')}</h3>
        <p>{descricao(paineis)}</p>
        <p>{t('Bases, território e ano do contexto valem quando a pergunta não os disser; a pergunta sempre tem prioridade. Cada resposta mostra o recorte que as consultas usaram de fato.',
          'The datasets, territory and year in the context apply when the question does not state them; the question always takes priority. Each answer shows the scope its queries actually used.')}</p>
        <p>{t('Na resposta rápida vem o essencial; na análise para pesquisa, tabelas completas, metodologia e fontes. As duas mostram as consultas (SQL) para conferência e podem ser exportadas em PDF, Excel ou JSON.',
          'The quick answer brings the essentials; the research analysis adds complete tables, methodology and sources. Both show the queries (SQL) for checking and can be exported as PDF, Excel or JSON.')}</p>
      </section>
      <section aria-labelledby="ia-ajuda-acesso">
        <h3 id="ia-ajuda-acesso" tabIndex={-1}>{t('Acesso', 'Access')}</h3>
        <p>{t('O acesso é restrito a e-mails autorizados pelo LAPAM. Não há senha: você entra com um código enviado ao seu e-mail.',
          'Access is restricted to emails authorized by LAPAM. There is no password: you sign in with a code sent to your email.')}</p>
        <PassosAcesso />
        <p>{t('O código não chegou em alguns minutos? O e-mail pode não estar autorizado: peça a inclusão ao LAPAM. Cada conta tem um limite diário de perguntas.',
          'No code after a few minutes? The email may not be authorized: ask LAPAM to add it. Each account has a daily question limit.')}</p>
        {estado && <Conta estado={estado} />}
      </section>
      <section aria-labelledby="ia-ajuda-privacidade">
        <h3 id="ia-ajuda-privacidade" tabIndex={-1}>{t('Privacidade e armazenamento', 'Privacy and storage')}</h3>
        <p>{t('As respostas são geradas pelo Claude, da Anthropic. Para a Anthropic vão só a pergunta, o contexto da página e os resultados resumidos das consultas, nunca os arquivos; as consultas rodam aqui no seu navegador.',
          'Answers are generated by Claude, by Anthropic. Only the question, the page context and the summarized query results go to Anthropic, never the files; the queries run here in your browser.')}</p>
        <p>{conta
          ? t(`As conversas ficam na sua conta (${conta}), no servidor do LAPAM, e abrem em qualquer computador em que você entrar com este e-mail. Cada pessoa só vê as próprias conversas, mas quem administra o servidor do LAPAM tem acesso a elas. Excluir apaga do servidor de vez.`,
            `Conversations are kept in your account (${conta}), on the LAPAM server, and open on any computer where you sign in with this email. Each person only sees their own conversations, but LAPAM server administrators can access them. Deleting erases them from the server for good.`)
          : t('Sem login, as conversas ficam só neste navegador: limpar os dados de navegação apaga o histórico (exporte em JSON as importantes). Com login, elas ficam na sua conta.',
            'Without signing in, conversations are kept only in this browser: clearing browsing data erases the history (export the important ones as JSON). When signed in, they are kept in your account.')}</p>
      </section>
      <section aria-labelledby="ia-ajuda-conferencia">
        <h3 id="ia-ajuda-conferencia" tabIndex={-1}>{t('Limitações e conferência', 'Limitations and checking')}</h3>
        <p>{t('Respostas geradas por IA podem conter erros. Antes de usar um número, confira a consulta (SQL) e as ressalvas da resposta; os números principais trazem a marca da conferência automática com a consulta.',
          'AI-generated answers may contain errors. Before using a number, check the query (SQL) and the caveats of the answer; key numbers carry the mark of the automatic check against the query.')}</p>
        <ul>
          <li>{t('Na RAIS, a unidade é o vínculo, não a pessoa.', 'In RAIS, the unit is the job, not the person.')}</li>
          <li>{t('Na saúde, as taxas são calculadas diretamente, pelo município de residência e sem correção de subnotificação.', 'In health, rates are computed directly, by municipality of residence and without under-reporting correction.')}</li>
          <li>{t('Nas finanças, os valores são os declarados pelos entes ao SICONFI; anos sem declaração ficam sem dado.', 'In public finances, values are those reported by governments to SICONFI; years without a filing have no data.')}</li>
        </ul>
      </section>
    </div>
  );
}

function Conta({ estado }: { estado: EstadoIa }) {
  return (
    <p className="ia-conta">
      {estado.email} · {t(`${estado.restantes} de ${estado.limite} perguntas restantes hoje`, `${estado.restantes} of ${estado.limite} questions left today`)}
      {estado.modelo && <> · {t('modelo padrão', 'default model')} {nomeDoModelo(estado.modelo)}</>}
      {' · '}<a href="/cdn-cgi/access/logout">{t('Sair', 'Sign out')}</a>
    </p>
  );
}

function useSegundos(inicio: number) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return Math.max(0, Math.round((agora - inicio) / 1000));
}

function Andamento({ progresso, inicio }: { progresso: Progresso | null; inicio: number }) {
  const s = useSegundos(inicio);
  const texto = progresso?.fase === 'consulta'
    ? t(`Executando ${progresso.rotulo}: ${progresso.objetivo}`, `Running ${progresso.rotulo}: ${progresso.objetivo}`)
    : progresso?.fase === 'localizar'
      ? t(`Localizando “${progresso.nome}” no cadastro de municípios…`, `Looking up “${progresso.nome}” in the municipality registry…`)
      : progresso?.fase === 'revisao'
        ? t('Conferindo a resposta com as consultas…', 'Checking the answer against the queries…')
        : progresso && progresso.rodada > 0
          ? t('Analisando os resultados…', 'Analysing the results…')
          : t('Entendendo a pergunta e escolhendo as tabelas…', 'Understanding the question and choosing the tables…');
  return (
    <p className="ia-andamento">
      <span className="ia-giro" aria-hidden="true" />
      <span>{texto}</span>
      <span className="ia-tempo">{s} s</span>
    </p>
  );
}

/** Verificações rodadas pela página junto com a consulta (chave, junções, amostra): números do DuckDB, não do modelo. */
function Verificacoes({ linhas }: { linhas: string[] }) {
  if (!linhas.length) return null;
  return (
    <div className="ia-verificacoes">
      <p className="ia-verificacoes-titulo">{t('Verificações da página (chaves, junções e amostra)', 'Page checks (keys, joins and sample)')}</p>
      <ul>{linhas.map((l, i) => <li key={i}>{l}</li>)}</ul>
    </div>
  );
}

/** Tabela já formatada (tela e PDF usam a mesma): uma linha só com muitas colunas aparece em linhas. */
function TabelaIa({ tabela }: { tabela: TabelaFormatada }) {
  return (
    <>
      {tabela.extras.length > 0 && <p className="ia-extras">{tabela.extras.join(' · ')}</p>}
      <div className="rolagem">
        <table className="ia-tabela">
          <thead><tr>{tabela.cabecalho.map((c, j) => <th key={j} scope="col" className={tabela.texto[j] ? 'ia-txt' : undefined}>{c}</th>)}</tr></thead>
          <tbody>
            {tabela.linhas.map((l, i) => (
              <tr key={i}>{l.map((v, j) => <td key={j} className={tabela.texto[j] ? 'ia-txt' : undefined}>{v}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Consulta({ item, resultado, pergunta, paineis, usada, refeitaEm }: {
  item: ItemConsulta; resultado?: Resultado; pergunta: string; paineis: Painel[]; usada: boolean; refeitaEm?: string;
}) {
  const versao = useVersaoDados();
  const [todas, setTodas] = useState(false);
  const situacao = estadoConsulta(resultado);
  const ok = resultado && !('erro' in resultado) ? resultado : null;
  const tabela = useMemo(() => (ok && ok.linhas.length ? formatarTabela(ok, item.sql, todas ? LINHAS_TELA : LINHAS_INICIAIS) : null), [ok, item.sql, todas]);
  const temAusentes = !!ok && ok.linhas.some((l) => l.some((v) => v === null));
  return (
    <div className="ia-consulta">
      <div className="cabeca-cartao">
        <div className="ia-consulta-titulo">
          <span className="ia-rotulo-consulta">{item.rotulo}</span>
          <strong>{item.objetivo || t('Consulta', 'Query')}</strong>
          <span className={`ia-situacao ${situacao.classe}`}>{situacao.texto}</span>
          {item.regressao && (
            <span className="ia-marca" title={t('Estimada pela página com todas as linhas da consulta (não pelo modelo)', 'Estimated by the page with all rows of the query (not by the model)')}>
              {t('regressão MQO calculada pela página', 'OLS regression computed by the page')}: {item.regressao.y} ~ {item.regressao.x.join(' + ')} ({item.regressao.erroPadrao === 'hc1' ? t('erro-padrão HC1', 'HC1 standard error') : t('erro-padrão clássico', 'classical standard error')})
            </span>
          )}
          {item.substitui && <span className="ia-marca">{t(`refaz ${item.substitui}`, `redoes ${item.substitui}`)}</span>}
          {refeitaEm && <span className="ia-marca">{t(`refeita em ${refeitaEm}`, `redone in ${refeitaEm}`)}</span>}
          {usada && <span className="ia-marca usada">{t('usada na resposta', 'used in the answer')}</span>}
        </div>
        {ok && (
          <BotoesExportar
            nome={`consulta_ia_${item.rotulo}`}
            obter={() => ({
              colunas: ok.colunas,
              linhas: ok.linhas,
              metadados: [
                [t('Fonte', 'Source'), fonteIa(paineis)],
                [t('Pergunta', 'Question'), pergunta],
                [t('Consulta', 'Query'), `${item.rotulo} · ${item.objetivo}`],
                [t('Consulta SQL (proposta pela IA)', 'SQL query (proposed by AI)'), item.sql],
                [t('Linhas', 'Rows'), `${ok.linhas.length} / ${ok.total}`],
                ...(ok.verificacao ? linhasDaVerificacao(ok.verificacao).map((l) => [t('Verificação', 'Check'), l] as [string, string]) : []),
                [t('Dados processados em', 'Data processed on'), versao.geradoEm],
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
      {ok?.verificacao && <Verificacoes linhas={linhasDaVerificacao(ok.verificacao)} />}
      {!resultado ? null : 'erro' in resultado ? (
        <p className="erro">{resultado.bloqueada ? t('Recusada antes de executar', 'Refused before running') : t('A consulta falhou', 'The query failed')}: {resultado.erro}</p>
      ) : !tabela ? (
        <p className="sem-obs">{t('Nenhum registro para este recorte.', 'No records for this scope.')}</p>
      ) : (
        <>
          <TabelaIa tabela={tabela} />
          <p className="legenda-tabela">
            {resultado.total > resultado.linhas.length
              ? t(`${resultado.total.toLocaleString(local())} linhas; a página mostra as primeiras ${resultado.linhas.length.toLocaleString(local())}.`,
                `${resultado.total.toLocaleString(local())} rows; the page shows the first ${resultado.linhas.length.toLocaleString(local())}.`)
              : `${contar(resultado.total, t('linha', 'row'), t('linhas', 'rows'))}.`}
            {tabela.emLinhas && ` ${t('Resultado de uma linha mostrado em linhas.', 'Single-row result shown as rows.')}`}
            {temAusentes && ` ${t('— = sem dado (ausente, não zero).', '— = no data (missing, not zero).')}`}
            {!tabela.emLinhas && resultado.linhas.length > LINHAS_INICIAIS && (
              <> <button className="limpar" onClick={() => setTodas(!todas)}>{todas ? t('mostrar menos', 'show fewer') : t('mostrar todas', 'show all')}</button></>
            )}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Passos da análise: ao vivo (lista curta) enquanto roda; depois, recolhidos, com as tabelas completas e a
 * situação de cada consulta (sem resultado, recusada, refeita, usada na resposta) e as revisões da resposta.
 */
function Processo({ itens, resultados, ativo, abertoPadrao, pergunta, paineis, usadas }: {
  itens: ItemTurno[]; resultados: Record<string, Resultado>; ativo: boolean; abertoPadrao: boolean; pergunta: string; paineis: Painel[]; usadas: Set<string>;
}) {
  const [aberto, setAberto] = useState(abertoPadrao);
  useEffect(() => {
    if (!ativo) setAberto(abertoPadrao);
  }, [ativo, abertoPadrao]);
  const consultas = itens.filter((i): i is ItemConsulta => i.tipo === 'consulta');
  const refeita = refeitas(consultas, resultados);
  if (ativo) {
    const vivos = itens.filter((i) => i.tipo === 'consulta' || i.tipo === 'localizacao' || i.tipo === 'revisao');
    if (!vivos.length) return null;
    return (
      <ol className="ia-passos ao-vivo" aria-label={t('Passos em andamento', 'Steps in progress')}>
        {vivos.map((c, k) => {
          if (c.tipo === 'localizacao') return <li key={c.id}>{t('Localização', 'Location')}: “{c.nome}”: {textoLocalizacao(resultados[c.id])}</li>;
          if (c.tipo === 'revisao') return <li key={`r${k}`} className="erro">{t('Resposta devolvida à IA para correção', 'Answer returned to the AI for correction')}</li>;
          if (c.tipo !== 'consulta') return null;
          const s = estadoConsulta(resultados[c.id]);
          const em = refeita.get(c.rotulo);
          return (
            <li key={c.id} className={em ? undefined : s.classe}>
              <span className="ia-rotulo-consulta">{c.rotulo}</span> {c.objetivo} <span className={`ia-situacao ${s.classe}`}>{s.texto}{em && ` · ${t(`refeita em ${em}`, `redone in ${em}`)}`}</span>
            </li>
          );
        })}
      </ol>
    );
  }
  if (!itens.length) return null;
  const situacoes = consultas.map((c) => resultados[c.id]);
  const vazias = situacoes.filter((r) => r && !('erro' in r) && !r.linhas.length).length;
  const bloqueadas = situacoes.filter((r) => r && 'erro' in r && r.bloqueada).length;
  const falhas = situacoes.filter((r) => r && 'erro' in r && !r.bloqueada).length;
  const revisoes = itens.filter((i) => i.tipo === 'revisao').length;
  const localizacoes = itens.filter((i) => i.tipo === 'localizacao').length;
  const detalhes = [
    vazias && t(`${vazias} sem resultado`, `${vazias} with no results`),
    bloqueadas && t(`${bloqueadas} ${bloqueadas === 1 ? 'recusada' : 'recusadas'} antes de executar`, `${bloqueadas} refused before running`),
    falhas && t(`${falhas} com erro`, `${falhas} with errors`),
    refeita.size && t(`${refeita.size} ${refeita.size === 1 ? 'refeita' : 'refeitas'}`, `${refeita.size} redone`),
  ].filter(Boolean).join(', ');
  return (
    <details className="ia-processo" open={aberto} onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary>
        {t('Como chegamos aqui', 'How we got here')}: {contar(consultas.length, t('consulta', 'query'), t('consultas', 'queries'))}
        {detalhes && ` (${detalhes})`}
        {localizacoes > 0 && ` · ${contar(localizacoes, t('localização', 'location'), t('localizações', 'locations'))}`}
        {revisoes > 0 && ` · ${contar(revisoes, t('revisão da resposta', 'answer review'), t('revisões da resposta', 'answer reviews'))}`}
      </summary>
      <ol className="ia-passos">
        {itens.map((it, k) => {
          if (it.tipo === 'nota') return <li key={k} className="ia-passo-nota">{it.texto}</li>;
          if (it.tipo === 'localizacao') {
            return (
              <li key={it.id} className="ia-passo-local">
                <strong>{t('Localização', 'Location')}</strong> “{it.nome}{it.uf ? ` (${it.uf})` : ''}”: {textoLocalizacao(resultados[it.id])}
              </li>
            );
          }
          if (it.tipo === 'revisao') {
            return (
              <li key={k} className="ia-passo-revisao">
                <strong>{t('Resposta devolvida à IA para correção', 'Answer returned to the AI for correction')}</strong>
                <ul>{it.motivos.map((m, j) => <li key={j}>{m}</li>)}</ul>
              </li>
            );
          }
          return (
            <li key={it.id}>
              <Consulta item={it} resultado={resultados[it.id]} pergunta={pergunta} paineis={paineis} usada={usadas.has(it.rotulo)} refeitaEm={refeita.get(it.rotulo)} />
            </li>
          );
        })}
      </ol>
    </details>
  );
}

const LINHAS_PAGINA = 25;

/** Copia a tabela em HTML (Word) e em texto com tabulações (Excel), preservando linhas e colunas. */
async function copiarTabela(tab: TabelaAnalitica): Promise<boolean> {
  const tsv = tabelaTsv(tab, idioma() === 'en' ? '.' : ',');
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([tabelaHtml(tab, { inline: true })], { type: 'text/html' }),
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
      })]);
    } else await navigator.clipboard.writeText(tsv);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tabela da resposta: montada pela página com o resultado da consulta (totais e variações calculados aqui),
 * com cópia para Word/Excel, CSV e Excel, paginação na tela (a exportação leva tudo) e o rodapé com
 * unidade, fonte, notas e legenda das ausências.
 */
function TabelaResposta({ x, numero, pergunta }: { x: TabelaPronta; numero: number; pergunta: string }) {
  const { meta } = useDados();
  const versao = useVersaoDados();
  const cobertura = coberturaDe(meta, false);
  const [todas, setTodas] = useState(false);
  const [copiada, setCopiada] = useState<boolean | null>(null);
  // tabela ampliada: ocupa a tela, com cabeçalho e primeira coluna fixos; Esc fecha
  const [ampliada, setAmpliada] = useState(false);
  useEffect(() => {
    if (!ampliada) return;
    const fechar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAmpliada(false); };
    window.addEventListener('keydown', fechar);
    return () => window.removeEventListener('keydown', fechar);
  }, [ampliada]);
  const tab = x.tabela;
  if (!tab) {
    const r = x.consulta?.resultado;
    const dados = r && !('erro' in r) && r.linhas.length ? formatarTabela(r, x.consulta!.sql, 30) : null;
    return (
      <div className="ia-grafico falhou" role="note">
        <p className="ia-grafico-titulo">{x.espec.titulo || t('Tabela', 'Table')}</p>
        <p className="ia-grafico-aviso">{t(`Não foi possível montar esta tabela: ${motivoCurto(x.motivo ?? '')}.`, `This table could not be built: ${motivoCurto(x.motivo ?? '')}.`)}
          {dados && ` ${t('Os dados da consulta estão abaixo, como vieram.', 'The query data are below, as returned.')}`}</p>
        {dados && <TabelaIa tabela={dados} />}
      </div>
    );
  }
  const visiveis = todas ? tab.linhas : tab.linhas.slice(0, LINHAS_PAGINA);
  const papel = ROTULO_PAPEL()[x.espec.papel];
  const copiar = async () => {
    setCopiada(await copiarTabela(tab));
    setTimeout(() => setCopiada(null), 2000);
  };
  return (
    <figure className={`ia-tab${x.espec.papel !== 'principal' ? ` papel-${x.espec.papel}` : ''}${ampliada ? ' ia-tab-ampliada' : ''}`}
      {...(ampliada ? { role: 'dialog', 'aria-modal': true, 'aria-label': tab.titulo } : {})}>
      {papel && <p className="ia-tab-papel">{papel}</p>}
      <div className="ia-tab-cabeca">
        <figcaption className="ia-tab-titulo"><span className="ia-tab-num">{t('Tabela', 'Table')} {numero}</span> {tab.titulo}</figcaption>
        <div className="ia-tab-acoes">
          <button type="button" className="botao-leve" aria-pressed={ampliada} onClick={() => { setAmpliada((a) => !a); if (!ampliada) setTodas(true); }}>
            {ampliada ? t('Fechar (Esc)', 'Close (Esc)') : t('Ampliar', 'Expand')}
          </button>
          <button type="button" className="botao-leve" onClick={copiar} title={t('Cola em linhas e colunas no Word e no Excel', 'Pastes as rows and columns in Word and Excel')}>
            {copiada === true ? t('Copiada ✓', 'Copied ✓') : copiada === false ? t('Não foi possível copiar', 'Could not copy') : t('Copiar tabela', 'Copy table')}
          </button>
          <BotoesExportar nome={`tabela_${numero}_${tab.titulo}`} obter={async () => tabelaExportavel((versao.atual ? await tabelaInteira(x, cobertura) : null) ?? tab, [
            [t('Pergunta', 'Question'), pergunta],
            [t('Dados processados em', 'Data processed on'), versao.geradoEm],
            ...linhasGuardadas(tab, versao),
            [t('Exportado em', 'Exported on'), new Date().toISOString()],
          ], cobertura)} />
        </div>
      </div>
      <div className="rolagem">
        <table className="ia-tab-tabela">
          <thead><tr>{tab.colunas.map((c, j) => <th key={j} scope="col" className={ehTexto(c) ? 'ia-txt' : 'ia-num'}>{c.nome}</th>)}</tr></thead>
          <tbody>
            {visiveis.map((l, i) => (
              <tr key={i} className={i === tab.linhaTotal ? 'ia-tab-total' : undefined}>
                {l.map((c, j) => (
                  <td key={j} className={`${ehTexto(tab.colunas[j]) ? 'ia-txt' : 'ia-num'}${c.a ? ' ia-ausente' : ''}`}>{formatarCelulaT(c, tab.colunas[j])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tab.linhas.length > LINHAS_PAGINA && (
        <p className="ia-tab-paginas">
          {t(`Exibindo ${visiveis.length.toLocaleString(local())} de ${tab.linhas.length.toLocaleString(local())} registros; a cópia e a exportação levam todos.`,
            `Showing ${visiveis.length.toLocaleString(local())} of ${tab.linhas.length.toLocaleString(local())} records; copy and export include all.`)}
          {' '}<button type="button" className="limpar" onClick={() => setTodas(!todas)}>{todas ? t('mostrar menos', 'show fewer') : t('mostrar todos', 'show all')}</button>
        </p>
      )}
      <div className="ia-tab-rodape">{rodapeTabela(tab).map((linha, k) => <p key={k}>{linha}</p>)}</div>
    </figure>
  );
}

function GraficoResposta({ p }: { p: GraficoPronto }) {
  const { g, validacao, quebras } = p;
  const opcao = useMemo(() => (validacao.ok ? opcaoDoGrafico(g, validacao.dados, quebras) : null), [g, validacao, quebras]);
  const fonte = fonteDaConsulta(p.consulta);
  const tituloG = <p className="ia-grafico-titulo">{g.titulo || t('Gráfico', 'Chart')} <span className="ia-nota ia-rastro">· {t(`dados de ${g.consulta}`, `data from ${g.consulta}`)}</span></p>;
  if (!validacao.ok || !opcao) {
    const r = p.consulta?.resultado;
    const tabela = r && !('erro' in r) && r.linhas.length ? formatarTabela(r, p.consulta!.sql, 30) : null;
    return (
      <div className="ia-grafico falhou" role="note">
        {tituloG}
        <p className="ia-grafico-aviso">
          {!validacao.ok && t(`Não foi possível montar este gráfico: ${motivoCurto(validacao.motivo)}.`, `This chart could not be drawn: ${motivoCurto(validacao.motivo)}.`)}
          {tabela && ` ${t(`Os dados válidos de ${g.consulta} estão na tabela abaixo.`, `The valid data from ${g.consulta} are in the table below.`)}`}
        </p>
        {tabela && <TabelaIa tabela={tabela} />}
      </div>
    );
  }
  return (
    <div className="ia-grafico">
      {tituloG}
      <Grafico opcao={opcao} altura={alturaDoGrafico(g, validacao.dados)} nome={g.titulo || 'grafico_ia'}
        descricao={t(`${g.titulo}. Os valores estão na tabela da consulta ${g.consulta}.`, `${g.titulo}. The values are in the table of query ${g.consulta}.`)} />
      {fonte && <p className="ia-nota">{t('Fonte', 'Source')}: {fonte}; {t('elaboração LAPAM/UFG', 'prepared by LAPAM/UFG')}.</p>}
      {quebras.length > 0 && <p className="ia-nota ia-legenda-quebra">{legendaQuebras(quebras)}</p>}
    </div>
  );
}

/**
 * Selo de cada número principal. Diz só o que foi verificado: que o número está no resultado da consulta (ou
 * foi calculado pela página a partir dele). Não é comparação com uma referência oficial externa.
 */
const TEXTO_CONFERENCIA = (c: 'conferido' | 'divergente' | 'sem_consulta', consulta: string, origem: DestaquePronto['origem'] = 'resultado', oficial = '') => ({
  conferido: origem === 'calculo'
    ? [t(`calculado pela página a partir de ${consulta}`, `computed by the page from ${consulta}`), t(`Total ou variação calculados pela página com o resultado da consulta ${consulta}. Não é comparação com uma referência oficial externa.`, `Total or change computed by the page from the result of query ${consulta}. Not a comparison with an external official reference.`)]
    : origem === 'oficial'
      ? [t(`valor oficial (${oficial}), em ${consulta}`, `official value (${oficial}), in ${consulta}`), t(`O número está no resultado da consulta ${consulta}, numa coluna que reproduz sem transformação a publicação ${oficial}; a página não o recalculou nem somou.`, `The number is in the result of query ${consulta}, in a column that reproduces the ${oficial} publication unchanged; the page did not recompute or sum it.`)]
      : [t(`localizado em ${consulta}`, `found in ${consulta}`), t(`O número está no resultado da consulta ${consulta} (localização no resultado, não validação externa: não foi comparado com uma referência oficial).`, `The number is in the result of query ${consulta} (located in the result, not an external validation: it was not compared with an official reference).`)],
  divergente: [t(`não encontrado em ${consulta}`, `not found in ${consulta}`), t(`O número não aparece na tabela da consulta ${consulta}: confira antes de usar.`, `The number does not appear in the table of query ${consulta}: check before using it.`)],
  sem_consulta: [t('sem consulta correspondente', 'no matching query'), t('A resposta cita uma consulta que não existe ou falhou: confira antes de usar.', 'The answer cites a query that does not exist or failed: check before using it.')],
})[c];

/** Selo de consistência entre tabelas: o mesmo número em consultas que leem outras tabelas. */
const textoConsistencia = (outras: string[]) => [
  t(`confere com ${outras.join(', ')} (outra tabela)`, `matches ${outras.join(', ')} (another table)`),
  t(`O mesmo número aparece em ${outras.join(', ')}, que lê outras tabelas. Tabelas geradas pelo mesmo processamento podem compartilhar um erro comum: a concordância não prova que o número está certo.`,
    `The same number appears in ${outras.join(', ')}, which reads other tables. Tables produced by the same processing may share a common error: agreement does not prove the number is right.`),
];

/** Alerta de comparabilidade junto à conclusão: a diferença atravessa uma mudança de captação da RAIS. */
function AlertaSerie({ notas }: { notas: NotaMetodologica[] }) {
  return (
    <aside className="ia-alerta-serie" aria-label={t('Comparabilidade da série', 'Series comparability')}>
      <p>
        <strong>{t(`Comparação entre anos com mudança de metodologia da RAIS (${anosDas(notas)}).`, `Comparison across a RAIS methodology change (${anosDas(notas)}).`)}</strong>{' '}
        {t('A diferença observada mistura a variação do emprego com a ampliação da cobertura; não equivale à criação de empregos no período.',
          'The observed difference mixes employment change with wider coverage; it is not the number of jobs created in the period.')}
      </p>
      <ul>
        {notas.map((n) => (
          <li key={n.id}>{n.curta()} <a href={n.url} target="_blank" rel="noreferrer">{t('Nota técnica do MTE', 'MTE technical note')}<span className="sr-only"> {t('(abre em nova aba)', '(opens in a new tab)')}</span></a></li>
        ))}
      </ul>
    </aside>
  );
}

/**
 * Notas verificadas da resposta. As que já apareceram em respostas anteriores da conversa (vistas) ficam numa
 * linha só, pelo título, para a leitura não repetir os mesmos parágrafos a cada pergunta.
 */
function NotasVerificadas({ notas, vistas }: { notas: NotaMetodologica[]; vistas?: Set<string> }) {
  if (!notas.length) return null;
  const novas = notas.filter((n) => !vistas?.has(n.id));
  const repetidas = notas.filter((n) => vistas?.has(n.id));
  return (
    <section className="ia-bloco">
      <h4>{t('Notas metodológicas verificadas', 'Verified methodological notes')}</h4>
      {repetidas.length > 0 && (
        <p className="ia-nota">{t('Valem também, como nas respostas anteriores', 'Also applicable, as in the previous answers')}: {repetidas.map((n) => n.titulo()).join('; ')}.</p>
      )}
      <ul className="ia-notas">
        {novas.map((n) => (
          <li key={n.id}>
            <strong>{n.titulo()}.</strong> {n.texto()}
            <span className="ia-nota">
              {' '}<a href={n.url} target="_blank" rel="noreferrer">{n.documento}</a>
              {n.trecho && <> · {t('trecho', 'excerpt')}: “{n.trecho}”</>}
              {' · '}{t(`conferida em ${dataDaNota(n)}`, `checked on ${dataDaNota(n)}`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Recorte da análise: território, período solicitado e utilizado, fontes, unidade, filtros e agrupamentos. */
function Recorte({ p }: { p: RespostaPronta }) {
  const linhas = recorteDe(p);
  if (!linhas.length) return null;
  return (
    <dl className="ia-ficha">
      {linhas.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

/**
 * Detalhes para reproduzir a análise: parâmetros da pergunta, versão das bases e, para cada consulta usada,
 * as tabelas de origem e o SQL. O histórico completo (consultas refeitas, revisões) fica em "Como chegamos aqui".
 */
function Reproducao({ p, consultas, contexto, modelo }: { p: RespostaPronta; consultas: ItemConsulta[]; contexto?: ContextoIa; modelo?: string }) {
  const versao = useVersaoDados();
  return (
    <details className="ia-metodo">
      <summary>{t('Detalhes para reprodução: parâmetros, bases e consultas SQL', 'Reproduction details: parameters, datasets and SQL queries')}</summary>
      <dl className="ia-ficha">
        {contexto && <div><dt>{t('Parâmetros', 'Parameters')}</dt><dd>{descreverContexto(contexto, p.periodo)}</dd></div>}
        {p.bases.length > 0 && <div><dt>{t('Versão das bases', 'Dataset versions')}</dt><dd>{p.bases.join('; ')}</dd></div>}
        <div><dt>{t('Dados processados em', 'Data processed on')}</dt><dd>{versao.geradoEm}</dd></div>
        {modelo && <div><dt>{t('Modelo', 'Model')}</dt><dd>{modelo}</dd></div>}
      </dl>
      {consultas.map((c) => (
        <div key={c.id} className="ia-bloco">
          <h4>{c.rotulo} · {c.objetivo || t('Consulta', 'Query')}</h4>
          <p className="ia-nota">{t('Tabelas de origem', 'Source tables')}: {fontesConsultadas([c.sql]).join('; ') || '—'}</p>
          <pre className="ia-sql">{c.sql}</pre>
        </div>
      ))}
      <p className="ia-nota">{t('O histórico completo, com consultas refeitas e revisões da resposta, está em “Como chegamos aqui”.', 'The full history, with redone queries and answer reviews, is under “How we got here”.')}</p>
    </details>
  );
}

function Resposta({ p, modo, pergunta, consultas, contexto, modelo, notasVistas }: {
  p: RespostaPronta; modo: Modo; pergunta: string; consultas: ItemConsulta[]; contexto?: ContextoIa; modelo?: string;
  /** Notas já mostradas em respostas anteriores da conversa. */
  notasVistas?: Set<string>;
}) {
  const r = p.r;
  const rapida = modo === 'rapida';
  const leituras = p.leituras.filter((l) => !l.motivo);
  const retiradas = p.leituras.length - leituras.length;
  const fonte = [p.fontes.join('; '), p.territorios.join('; ') || r.recorte.territorio, p.periodo ?? r.recorte.periodo].filter(Boolean).join(' · ');
  const blocoLeituras = (leituras.length > 0 || retiradas > 0) && (
    <section className="ia-bloco">
      <h4>{t('Leitura dos dados', 'Reading the data')}</h4>
      {leituras.length > 0 && (
        <ul className="ia-leituras">
          {leituras.map((l, k) => <li key={k}>{l.texto} <span className="ia-nota ia-rastro">({l.consulta}: {l.colunas.join(', ')})</span></li>)}
        </ul>
      )}
      {retiradas > 0 && (
        <p className="ia-nota">{t(`${contar(retiradas, 'leitura retirada', 'leituras retiradas')}: sem colunas calculadas que a sustentassem.`, `${contar(retiradas, 'reading removed', 'readings removed')}: no calculated columns supported it.`)}</p>
      )}
    </section>
  );
  const blocoHipoteses = p.hipoteses
    ? <section className="ia-bloco hipoteses"><h4>{t('Hipóteses (não testadas pelos dados)', 'Hypotheses (not tested by the data)')}</h4><TextoRico texto={p.hipoteses} /></section>
    : p.hipotesesOmitidas && (
      <p className="ia-nota">{t('Hipóteses omitidas: a pergunta não pede explicações (ficam no apêndice de reprodução da exportação).', 'Hypotheses left out: the question does not ask for explanations (they are in the export’s reproduction appendix).')}</p>
    );
  const destaques = p.destaques.length > 0 && (
    <>
    <ul className="ia-destaques" aria-label={t('Números principais', 'Key numbers')}>
      {p.destaques.map((x, k) => {
        const [curto, longo] = TEXTO_CONFERENCIA(x.conferencia, x.d.consulta, x.origem, x.oficial);
        const consistencia = x.consistente?.length ? textoConsistencia(x.consistente) : null;
        return (
          <li key={k} className="ia-destaque">
            <span className="ia-destaque-rotulo">{x.d.rotulo}</span>
            <span className="ia-destaque-valor">{x.valor}</span>
            {x.unidade && <span className="ia-destaque-unidade">{x.unidade}</span>}
            {x.rotuloPeriodo && <span className="ia-destaque-periodo">{x.rotuloPeriodo}</span>}
            {x.quebras.length > 0 && (
              <span className="ia-destaque-quebra" title={x.quebras.map((n) => n.curta()).join(' ')}>
                <span aria-hidden="true">⚠ </span>{t(`atravessa a quebra da RAIS (${anosDas(x.quebras)})`, `crosses the RAIS break (${anosDas(x.quebras)})`)}
              </span>
            )}
            <span className={`ia-conferencia ${x.conferencia}`} title={longo}>
              <span aria-hidden="true">{x.conferencia === 'conferido' ? '✓ ' : '⚠ '}</span>{curto}<span className="sr-only">. {longo}</span>
            </span>
            {consistencia && (
              <span className="ia-conferencia consistente" title={consistencia[1]}>
                <span aria-hidden="true">≡ </span>{consistencia[0]}<span className="sr-only">. {consistencia[1]}</span>
              </span>
            )}
          </li>
        );
      })}
    </ul>
    <p className="ia-nota ia-legenda-conferencia">
      {t('O selo ✓ confere a transcrição: o número aparece no resultado da consulta SQL indicada (ou foi calculado a partir dele). Ele não valida o método do cálculo nem compara com uma fonte oficial externa; para isso, veja as ressalvas e os detalhes.',
        'The ✓ mark checks the transcription: the number appears in the result of the indicated SQL query (or was computed from it). It does not validate the calculation method nor compare with an external official source; for that, see the caveats and the details.')}
    </p>
    </>
  );
  // numeração das tabelas montadas (as que não puderam ser montadas não contam)
  let numero = 0;
  const tabelas = p.tabelas.length > 0 && (
    <div className="ia-tabelas">
      {p.tabelas.map((x, k) => <TabelaResposta key={k} x={x} numero={x.tabela ? ++numero : 0} pergunta={pergunta} />)}
    </div>
  );
  const graficos = graficosVisiveis(p, modo).map((g, k) => <GraficoResposta key={k} p={g} />);
  const ressalvas = r.limitacoes && <section className="ia-bloco ressalvas"><h4>{t('Ressalvas', 'Caveats')}</h4><TextoRico texto={r.limitacoes} /></section>;
  return (
    <div className={`ia-resposta tipo-${r.tipo} modo-${modo}`}>
      <p className="ia-modo-resposta">{rotuloModo(modo)}</p>
      {r.tipo !== 'resposta' && (
        <p className="ia-tipo">{r.tipo === 'esclarecimento' ? t('A IA precisa de um esclarecimento', 'The AI needs a clarification') : t('Fora da cobertura dos dados', 'Outside the data coverage')}</p>
      )}
      <p className="ia-conclusao">{r.conclusao}</p>
      {p.faltantes.length > 0 && <aside className="ia-alerta-serie" role="note"><p><strong>{avisoFaltantes(p)}</strong></p></aside>}
      {p.alertas.length > 0 && <AlertaSerie notas={p.alertas} />}
      {rapida ? (
        <>
          {destaques}
          {ressalvas}
          {tabelas}
          {graficos}
          {fonte && <p className="ia-fonte">{t('Fonte', 'Source')}: {fonte}</p>}
          {(r.explicacao || blocoLeituras || blocoHipoteses || p.notas.length > 0 || r.metodologia || recorteDe(p).length > 0) && (
            <details className="ia-metodo">
              <summary>{t('Detalhes da análise: dados observados, recorte, metodologia e notas', 'Analysis details: observed data, scope, methodology and notes')}</summary>
              {r.explicacao && <section className="ia-bloco"><h4>{t('Dados observados', 'Observed data')}</h4><TextoRico texto={r.explicacao} /></section>}
              {blocoLeituras}
              {blocoHipoteses}
              <Recorte p={p} />
              <NotasVerificadas notas={p.notas} vistas={notasVistas} />
              {r.metodologia && <section className="ia-bloco"><h4>{t('Metodologia', 'Methodology')}</h4><TextoRico texto={r.metodologia} /></section>}
            </details>
          )}
          <Reproducao p={p} consultas={consultas} contexto={contexto} modelo={modelo} />
        </>
      ) : (
        <>
          <section className="ia-parte">
            <h4 className="ia-parte-titulo">{t('Recorte da análise', 'Scope of the analysis')}</h4>
            <Recorte p={p} />
          </section>
          {tabelas && (
            <section className="ia-parte">
              <h4 className="ia-parte-titulo">{t('Tabelas', 'Tables')}</h4>
              {tabelas}
            </section>
          )}
          {graficos.length > 0 && <section className="ia-parte">{graficos}</section>}
          {destaques && (
            <section className="ia-parte">
              <h4 className="ia-parte-titulo">{t('Números principais', 'Key numbers')}</h4>
              {destaques}
            </section>
          )}
          <section className="ia-parte">
            <h4 className="ia-parte-titulo">{t('Análise dos resultados', 'Analysis of the results')}</h4>
            <TextoRico texto={r.explicacao} />
            {blocoLeituras}
            {blocoHipoteses}
            {ressalvas}
          </section>
          <section className="ia-parte">
            <h4 className="ia-parte-titulo">{t('Metodologia e fontes', 'Methodology and sources')}</h4>
            <TextoRico texto={r.metodologia} />
            {p.fontes.length > 0 && <ul className="ia-notas">{p.fontes.map((f) => <li key={f}>{f}</li>)}</ul>}
            <NotasVerificadas notas={p.notas} vistas={notasVistas} />
            <Reproducao p={p} consultas={consultas} contexto={contexto} modelo={modelo} />
          </section>
        </>
      )}
    </div>
  );
}

function Incompleta({ meta, aoUsar }: { meta?: MetaTurno; aoUsar: (s: string) => void }) {
  const d = meta?.desfecho;
  const texto = d === 'limite'
    ? t('A IA usou o limite de consultas desta pergunta sem concluir.', 'The AI used up the query limit for this question without finishing.')
    : d === 'recusa'
      ? `${t('A IA não respondeu a esta pergunta.', 'The AI declined to answer this question.')}${meta?.detalhe ? ` ${meta.detalhe}` : ''}`
      : d === 'longa'
        ? t('A resposta foi interrompida por ser longa demais.', 'The answer was cut off for being too long.')
        : t('A pergunta terminou sem resposta.', 'The question ended without an answer.');
  return (
    <div className="ia-aviso-turno" role="note">
      <p>{texto}</p>
      {d === 'limite' && (
        <button type="button" className="botao-leve" onClick={() => aoUsar(t('Conclua com os resultados que você já obteve.', 'Conclude with the results you already have.'))}>
          {t('Pedir para concluir com o que já tem', 'Ask it to conclude with what it has')}
        </button>
      )}
      {d === 'longa' && (
        <button type="button" className="botao-leve" onClick={() => aoUsar(t('Responda de forma mais curta, só com o essencial.', 'Answer more briefly, with only the essentials.'))}>
          {t('Pedir uma resposta mais curta', 'Ask for a shorter answer')}
        </button>
      )}
    </div>
  );
}

function Turno({ i, turno, pronta, meta, resultados, ativo, progresso, ultimo, paineis, feitas, notasVistas, aoEditar, aoUsar, aoCopiar, aoPedirConferencia }: {
  i: number; turno: TurnoIa; pronta: RespostaPronta | null; meta?: MetaTurno; resultados: Record<string, Resultado>; notasVistas?: Set<string>;
  ativo: boolean; progresso: Progresso | null; ultimo: boolean; paineis: Painel[]; feitas: Set<string>;
  aoEditar: () => void; aoUsar: (s: string) => void; aoCopiar: (texto: string) => Promise<boolean>;
  /** Baixa o pedido de conferência (só para quem pode pedir); devolve o motivo se não der para montá-lo. */
  aoPedirConferencia?: () => string | null;
}) {
  const [copiado, setCopiado] = useState(false);
  const [falhaConferencia, setFalhaConferencia] = useState<string | null>(null);
  const aprofundar = (turno.resposta?.aprofundar ?? []).filter((p) => !feitas.has(chavePergunta(p)));
  const nConsultas = consultasDoTurno(turno).length;
  const respondida = !!(pronta || turno.textoFinal);
  const copiar = async () => {
    if (await aoCopiar(pronta ? textoDaResposta(pronta) : turno.textoFinal ?? '')) {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    }
  };
  const segundos = meta?.fim ? Math.round((meta.fim - meta.inicio) / 1000) : 0;
  const { meta: dados } = useDados();
  const re = meta?.reexecucao;
  return (
    <VersaoDaResposta.Provider value={versaoDoTurno(meta, dados.geradoEm)}>
    <article id={`ia-turno-${i}`} className="ia-turno" aria-labelledby={`ia-pergunta-${i}`} aria-busy={ativo}>
      <header className="ia-turno-cabeca">
        <h3 id={`ia-pergunta-${i}`} className="ia-pergunta">{turno.pergunta}</h3>
        {meta && <RecorteExecutado contexto={meta.contexto} pronta={pronta} />}
      </header>
      {re && (
        <div className="ia-reexecutada" role="note">
          <p><strong>{t('Tabelas e números recalculados', 'Tables and numbers recalculated')}</strong>{' '}
            {t(`em ${dataHora(re.em)}, com os dados processados em ${dataHora(re.dados)}. As consultas rodaram de novo aqui no navegador; a IA não foi chamada.`,
              `on ${dataHora(re.em)}, with the data processed on ${dataHora(re.dados)}. The queries ran again here in the browser; the AI was not called.`)}
            {re.falhas > 0 && ` ${t(`${contar(re.falhas, 'consulta falhou', 'consultas falharam')} com os dados novos.`, `${contar(re.falhas, 'query failed', 'queries failed')} with the new data.`)}`}</p>
          <p>{t(`Os textos escritos pela IA nesta resposta (conclusão, análise, ressalvas) são os originais, feitos com os dados de ${dataHora(re.original)}, e não foram regenerados: podem citar números que mudaram. Os números principais que não conferem com as consultas refeitas aparecem marcados.`,
            `The texts written by the AI in this answer (conclusion, analysis, caveats) are the originals, written with the data of ${dataHora(re.original)}, and were not regenerated: they may cite numbers that changed. Key numbers that do not match the rerun queries are flagged.`)}</p>
          {!ativo && (
            <button type="button" className="botao-leve" onClick={() => aoUsar(turno.pergunta)}>
              {t('Refazer esta pergunta com a IA (usa 1 pergunta do limite)', 'Ask this question again with the AI (uses 1 question of the limit)')}
            </button>
          )}
        </div>
      )}
      {ativo && meta && <Andamento progresso={progresso} inicio={meta.inicio} />}
      {pronta ? (
        <Resposta p={pronta} modo={meta?.contexto.modo ?? 'rapida'} pergunta={turno.pergunta} contexto={meta?.contexto} modelo={textoModelo(meta)} notasVistas={notasVistas}
          consultas={consultasDoTurno(turno).filter((c) => pronta.usadas.has(c.rotulo))} />
      ) : turno.textoFinal ? (
        <div className="ia-resposta texto-livre">
          <TextoRico texto={turno.textoFinal} />
          <p className="ia-nota">{t('Resposta em texto livre: os números não passaram pela conferência automática; confira nas consultas abaixo.',
            'Free-text answer: the numbers were not checked automatically; check them in the queries below.')}</p>
        </div>
      ) : !ativo ? <Incompleta meta={meta} aoUsar={aoUsar} /> : null}
      <Processo itens={turno.itens} resultados={resultados} ativo={ativo} abertoPadrao={!pronta} pergunta={turno.pergunta} paineis={paineis}
        usadas={pronta?.usadas ?? new Set()} />
      {!ativo && respondida && (
        <div className="ia-acoes-turno">
          <button type="button" className="botao-leve" onClick={copiar} title={t('Conclusão, análise, ressalvas, recorte e metodologia, em texto', 'Conclusion, analysis, caveats, scope and methodology, as text')}>
            {copiado ? t('Copiado ✓', 'Copied ✓') : t('Copiar texto da análise', 'Copy analysis text')}
          </button>
          {ultimo && <button type="button" className="botao-leve" onClick={aoEditar}>{t('Editar pergunta', 'Edit question')}</button>}
          {aoPedirConferencia && turno.resposta && (
            <button type="button" className="botao-leve" onClick={() => setFalhaConferencia(aoPedirConferencia())}
              title={t('Arquivo .json com a pergunta, as consultas e a resposta, para a conferência pelo especialista RAIS. Montado neste navegador; nada é enviado.',
                'A .json file with the question, queries and answer, for review by the RAIS specialist. Built in this browser; nothing is sent.')}>
              {t('Baixar pedido de conferência', 'Download review request')}
            </button>
          )}
          {meta?.fim && (
            <span className="ia-tempo" title={meta.etapas?.length ? t('Tempo por etapa', 'Time per step') : undefined}>
              {t(`Concluída em ${segundos} s`, `Finished in ${segundos} s`)} · {contar(nConsultas, t('consulta', 'query'), t('consultas', 'queries'))}
              {meta.etapas?.length ? ` (${tempoPorEtapa(meta.etapas)})` : ''}
            </span>
          )}
          {falhaConferencia && <p className="ia-nota" role="status">{t('Pedido de conferência não gerado', 'Review request not generated')}: {falhaConferencia}</p>}
        </div>
      )}
      {!ativo && ultimo && turno.resposta && aprofundar.length > 0 && (
        <section className="ia-aprofundar" aria-labelledby={`ia-aprofundar-${i}`}>
          <h4 id={`ia-aprofundar-${i}`} className="ia-secao">
            {turno.resposta.tipo === 'esclarecimento' ? t('Opções', 'Options') : t('Para aprofundar', 'To dig deeper')}
          </h4>
          <ul>
            {aprofundar.map((p) => (
              <li key={p}><button type="button" className="ia-chip-botao" onClick={() => aoUsar(p)}>{p}</button></li>
            ))}
          </ul>
        </section>
      )}
    </article>
    </VersaoDaResposta.Provider>
  );
}

// ---------------- página ----------------

/**
 * Aba geral "Pergunte aos dados" (/ia): uma IA para todos os painéis. Os marcados entram na conversa
 * (?paineis=financas,trabalho; nenhum = todos); território e ano vêm dos filtros globais (?uf=, ?ente=,
 * ?ano=) e acompanham cada pergunta, com o estilo de resposta escolhido.
 */
export function Ia() {
  const { meta, entes } = useDados();
  const f = useFiltros();
  const [busca, setBusca] = useSearchParams();
  const pedidos = (busca.get('paineis') ?? '').split(',');
  const marcados = PAINEIS.filter((p) => pedidos.includes(p));
  const paineis = marcados.length ? marcados : PAINEIS;
  const chavePaineis = paineis.join(',');

  // microdados de fato disponíveis (o navegador confere ao preparar as tabelas da IA, o que já adianta a 1ª pergunta)
  const [microdados, setMicrodados] = useState(false);
  useEffect(() => {
    if (!chavePaineis.includes('trabalho')) return;
    let vivo = true;
    tabelasIaTrabalho().then((c) => vivo && setMicrodados(c.microdados), () => undefined);
    return () => {
      vivo = false;
    };
  }, [chavePaineis]);
  // cadastro de entes: nomes dos territórios das consultas na ficha da resposta
  const [cadastro, setCadastro] = useState<Cadastro | null>(null);
  useEffect(() => {
    let vivo = true;
    carregarCadastro().then((c) => vivo && setCadastro(c), () => undefined);
    return () => {
      vivo = false;
    };
  }, []);
  const cobertura = useMemo(() => coberturaDe(meta, microdados), [meta, microdados]);
  // anos do seletor: os de todas as fontes das bases marcadas (fechadas e mensais), do mesmo manifesto da ajuda
  const anos = useMemo(
    () => [...coberturaPorAno(cobertura, chavePaineis.split(',').filter(Boolean) as Painel[]).keys()].sort((a, b) => a - b),
    [cobertura, chavePaineis],
  );
  const anoUrl = Number(busca.get('ano'));
  const ano = anos.includes(anoUrl) ? anoUrl : null;
  const territorio = useMemo(() => territorioDe(f.alvo, f.uf, entes), [f.alvo, f.uf, entes]);
  // modo guardado no navegador (o antigo "estilo técnico" vira análise para pesquisa)
  const [modo, setModo] = useState<Modo>(() => lerModo(lerGuardado('ia-modo') ?? lerGuardado('ia-estilo')));
  const contexto = useMemo<ContextoIa>(() => ({ paineis: chavePaineis.split(',') as Painel[], territorio, ano, modo }), [chavePaineis, territorio, ano, modo]);

  const [estado, setEstado] = useState<EstadoIa | null | undefined>(undefined);
  const [falhaEstado, setFalhaEstado] = useState<string | null>(null);
  const [estadoNegado, setEstadoNegado] = useState(false);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [metas, setMetas] = useState<MetaTurno[]>([]);
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [texto, setTexto] = useState(() => lerGuardado('ia-rascunho', true) ?? '');
  const [rodando, setRodando] = useState<AbortController | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [falha, setFalha] = useState<{ mensagem: string; pergunta: string; entrar?: boolean } | null>(null);
  const [status, setStatus] = useState('');
  const [ajustes, setAjustes] = useState(false);
  const [exemplos, setExemplos] = useState(false);
  const [ajuda, setAjuda] = useState<SecaoAjuda | 'inicio' | 'entrar' | null>(null);
  const botaoContexto = useRef<HTMLButtonElement>(null);
  const [apendice, setApendice] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);
  // trocar a pergunta por um exemplo com rascunho no campo pede confirmação; a substituída pode ser restaurada
  // modelo da próxima pergunta: Haiku sem preferência salva; Sonnet só por escolha explícita (guardada neste navegador)
  const [escolhaModelo, setEscolhaModelo] = useState<EscolhaModelo>(() => lerEscolhaModelo(lerGuardado('ia-modelo')));
  const [substituir, setSubstituir] = useState<{ texto: string; aplicar?: () => void } | null>(null);
  const [substituida, setSubstituida] = useState<string | null>(null);
  const textoAtual = useRef(texto);
  textoAtual.current = texto;
  // controle que abriu uma janela (exemplos, ajuda): o foco volta a ele ao fechá-la, mesmo onde o clique não o focou
  const origem = useRef<HTMLElement | null>(null);

  // conversa aberta (null = nova, ainda sem pergunta) e o histórico guardado neste navegador
  const h = useHistorico();
  const [aberta, setAberta] = useState<Cabecalho | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [naoAchada, setNaoAchada] = useState<string | null>(null);
  const [refazendo, setRefazendo] = useState(false);
  const [copiouEndereco, setCopiouEndereco] = useState(false);
  // a conversa na tela e se a página continua montada: uma pergunta que segue depois de sair da página (ou de trocar
  // de conversa) grava a resposta no histórico, mas não mexe na tela
  const idNaTela = useRef<string | null>(null);
  // trava síncrona contra envio duplo (dois cliques ou Enter antes de o estado "rodando" chegar à tela)
  const enviando = useRef(false);
  const montada = useRef(true);
  useEffect(() => {
    montada.current = true;
    return () => {
      montada.current = false;
    };
  }, []);
  const mostrar = (c: Conversa | null) => {
    idNaTela.current = c?.id ?? null;
    setMensagens(c?.mensagens ?? []);
    setMetas(c?.metas ?? []);
    setResultados(c?.resultados ?? {});
    setAberta(c ? cabecalho(c) : null);
    setRodando(null);
    setProgresso(null);
    setFalha(null);
    enviando.current = false;
  };

  // ?conversa=<id> abre a conversa guardada, sem rodar consultas nem chamar a IA; ?nova= começa outra (a anterior
  // fica no histórico); sem nenhum dos dois (voltando de outro painel), reabre a que estava aberta nesta aba
  const idUrl = busca.get('conversa');
  const nova = busca.get('nova');
  useEffect(() => {
    if (nova) {
      // só diz que a anterior está no histórico quando ela foi salva de fato (está na lista)
      const anterior = idNaTela.current;
      const salva = !!anterior && h.resumos.some((r) => r.id === anterior);
      // um rascunho não enviado fica na conversa de origem (volta quando ela for reaberta); sem conversa salva, a
      // confirmação já foi pedida antes de chegar aqui
      const rascunho = textoAtual.current;
      const guardado = salva && !!rascunho.trim();
      if (guardado) guardarRascunhoDe(anterior!, rascunho);
      mostrar(null);
      setNaoAchada(null);
      setTexto('');
      setSubstituida(null);
      guardar('ia-conversa-aberta', null, true);
      const b = new URLSearchParams(busca);
      b.delete('nova');
      b.delete('conversa');
      setBusca(b, { replace: true });
      setStatus(salva
        ? (guardado
          ? t('Nova conversa iniciada. A anterior está no histórico, com o seu rascunho.', 'New conversation started. The previous one is in the history, with your draft.')
          : t('Nova conversa iniciada. A anterior está no histórico.', 'New conversation started. The previous one is in the history.'))
        : t('Nova conversa iniciada.', 'New conversation started.'));
      focarCampo();
      return;
    }
    if (!idUrl) {
      const antes = lerGuardado('ia-conversa-aberta', true);
      if (antes && antes !== idNaTela.current) {
        const b = new URLSearchParams(busca);
        b.set('conversa', antes);
        setBusca(b, { replace: true });
      }
      return;
    }
    if (idUrl === idNaTela.current) return;
    setAbrindo(true);
    // sem saber ainda se há login, não dá para saber se a conversa está na conta
    if (!h.verificado) return;
    let vivo = true;
    historico.ler(idUrl).then((c) => {
      if (!vivo) return;
      const b = new URLSearchParams(busca);
      if (!c) {
        mostrar(null);
        setNaoAchada(idUrl);
        guardar('ia-conversa-aberta', null, true);
        b.delete('conversa');
        setBusca(b, { replace: true });
        return;
      }
      setNaoAchada(null);
      // trocar de conversa leva o rascunho junto para a de origem e traz o que estava guardado na que abre
      const saindo = idNaTela.current;
      if (saindo && saindo !== c.id && textoAtual.current.trim()) {
        guardarRascunhoDe(saindo, textoAtual.current);
        setTexto('');
      }
      mostrar(c);
      const rascunho = lerRascunhos()[c.id];
      if (rascunho) {
        setTexto(rascunho);
        guardarRascunhoDe(c.id, '');
      }
      guardar('ia-conversa-aberta', c.id, true);
      // o recorte da última pergunta volta para a página: o seguimento usa o mesmo contexto
      const ctx = c.metas.at(-1)?.contexto;
      if (ctx) {
        setModo(ctx.modo);
        setBusca(paramsDoContexto(b, ctx, c.id), { replace: true });
      }
    }, () => {
      if (vivo) setNaoAchada(idUrl);
    }).finally(() => {
      if (vivo) setAbrindo(false);
    });
    return () => {
      vivo = false;
    };
  }, [idUrl, nova, h.verificado, h.conta]);

  // a resposta de uma pergunta que continuou fora da tela (ou um título novo) foi gravada: a tela relê a conversa
  const gravadaEm = aberta ? h.gravadas[aberta.id] : undefined;
  useEffect(() => {
    if (!aberta || !gravadaEm || gravadaEm <= aberta.atualizadaEm || rodando) return;
    const id = aberta.id;
    historico.ler(id).then((c) => {
      if (c && idNaTela.current === id) mostrar(c);
    }, () => undefined);
  }, [gravadaEm, rodando]);

  // o login decide onde ficam as conversas: com e-mail, na conta; sem login, só neste navegador. Com o servidor fora
  // do ar, vale a cópia da última conta usada aqui
  const carregar = () => {
    setFalhaEstado(null);
    setEstadoNegado(false);
    estadoIa().then((e) => {
      setEstado(e);
      guardar('ia-conta', e?.email ?? null);
      historico.conectar(e?.email ?? null);
    }, (e) => {
      setFalhaEstado(e instanceof Error ? e.message : String(e));
      setEstadoNegado(e instanceof ErroAcesso && e.tipo === 'negado');
      historico.conectar(e instanceof ErroAcesso ? null : lerGuardado('ia-conta'));
    });
  };
  useEffect(carregar, []);
  useEffect(() => guardar('ia-rascunho', texto, true), [texto]);

  const lista = useMemo(() => turnos(mensagens), [mensagens]);
  const feitas = useMemo(() => new Set(lista.map((x) => chavePergunta(x.pergunta))), [lista]);
  const consultas = useMemo(() => consultasDaConversa(mensagens, resultados), [mensagens, resultados]);
  const ultimaCompetencia = cobertura.caged?.ate ?? null;
  // cada resposta pronta para mostrar: conferida com as consultas, com período, território e notas das consultas
  const prontas = useMemo(() => lista.map((turno, i) => {
    if (!turno.resposta) return null;
    const m = metas[i];
    const versao = m?.reexecucao?.dados ?? m?.dados;
    const p = prepararResposta(turno.resposta, consultas, {
      doTurno: consultasDoTurno(turno).map((c) => c.rotulo), pergunta: turno.pergunta, cadastro, ultimaCompetencia,
      fontes: (versao && aberta?.fontes[versao]) || meta.fontes, cobertura,
    });
    // fontes, versões das bases, notas e códigos como saíram na resposta, não como seriam calculados hoje
    const reg = m?.registro;
    return reg ? { ...p, fontes: reg.fontes, notas: reg.notas.map(lerNota), codigos: reg.codigos, bases: reg.bases ?? p.bases } : p;
  }), [lista, consultas, cadastro, ultimaCompetencia, meta.fontes, cobertura, metas, aberta?.fontes]);
  // notas já mostradas nas respostas anteriores de cada pergunta (as repetidas aparecem só pelo título)
  const notasVistas = useMemo(() => prontas.map((_, i) => new Set(prontas.slice(0, i).flatMap((p) => p?.notas.map((n) => n.id) ?? []))), [prontas]);
  // fontes, versões das bases, notas e códigos da resposta que acabou de chegar, para guardar com ela
  const registroDoTurno = (msgs: Mensagem[], res: Record<string, Resultado>, pergunta: string): RegistroTurno | undefined => {
    const ultimo = turnos(msgs).at(-1);
    if (!ultimo?.resposta) return undefined;
    const p = prepararResposta(ultimo.resposta, consultasDaConversa(msgs, res), {
      doTurno: consultasDoTurno(ultimo).map((c) => c.rotulo), pergunta, cadastro, ultimaCompetencia, fontes: meta.fontes, cobertura,
    });
    return { fontes: p.fontes, bases: p.bases, notas: p.notas.map(guardarNota), codigos: p.codigos };
  };

  // longe do fim (a pessoa subiu para ler): oferece voltar à última pergunta
  const [longeDoFim, setLongeDoFim] = useState(false);
  const temConversa = mensagens.length > 0;
  useEffect(() => {
    if (!temConversa) return;
    const medir = () => setLongeDoFim(document.documentElement.scrollHeight - (scrollY + innerHeight) > 700);
    medir();
    addEventListener('scroll', medir, { passive: true });
    addEventListener('resize', medir);
    return () => {
      removeEventListener('scroll', medir);
      removeEventListener('resize', medir);
    };
  }, [temConversa]);

  // nova pergunta: leva a página até ela (a margem do topo fixo está no CSS)
  const qtd = metas.length;
  useEffect(() => {
    if (!qtd) return;
    const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.getElementById(`ia-turno-${qtd - 1}`)?.scrollIntoView({ block: 'start', behavior: reduzir ? 'auto' : 'smooth' });
  }, [qtd]);

  // o campo muda de lugar ao sair da tela inicial: o foco vai para ele depois que a página se redesenha
  const focarCampo = () => requestAnimationFrame(() => {
    const c = campo.current;
    if (!c) return;
    c.focus({ preventScroll: true });
    c.setSelectionRange(c.value.length, c.value.length);
  });
  const usarTexto = (s: string) => {
    setTexto(s);
    setFalha(null);
    focarCampo();
  };
  // exemplos e sugestões preenchem o campo, mas nunca por cima de um rascunho sem perguntar
  const proporTexto = (novo: string, aplicar?: () => void) => {
    const atual = textoAtual.current.trim();
    if (atual && atual !== novo.trim()) {
      setSubstituir({ texto: novo, aplicar });
      return;
    }
    aplicar?.();
    usarTexto(novo);
  };
  const confirmarSubstituicao = () => {
    const s = substituir;
    if (!s) return;
    setSubstituir(null);
    setExemplos(false);
    setSubstituida(textoAtual.current);
    s.aplicar?.();
    usarTexto(s.texto);
  };
  const manterRascunho = () => {
    setSubstituir(null);
    setExemplos(false);
    focarCampo();
  };
  const abrirVista = (abrir: () => void) => (e: { currentTarget: HTMLElement }) => {
    origem.current = e.currentTarget;
    abrir();
  };

  const ocupadaFora = !!aberta && !rodando && h.emAndamento.includes(aberta.id);
  const bloqueio = ocupadaFora
    ? t('Uma pergunta desta conversa ainda está sendo respondida (ela continuou quando você saiu da página). A resposta aparece aqui quando terminar.',
      'A question in this conversation is still being answered (it kept running when you left the page). The answer will appear here when it finishes.')
    : estado === undefined
    ? (estadoNegado ? t('Entre com um e-mail autorizado para perguntar.', 'Sign in with an authorized email to ask.')
      : falhaEstado ? t('A IA está indisponível no momento.', 'The AI is unavailable right now.') : t('Verificando o acesso…', 'Checking access…'))
    : estado === null
      ? t('O botão Perguntar é liberado depois que você entra com seu e-mail.', 'The Ask button is enabled once you sign in with your email.')
      : !estado.configurada
        ? t('A IA ainda não foi configurada no servidor (falta a chave da Anthropic).', 'The AI is not configured on the server yet (missing Anthropic key).')
        : estado.restantes <= 0
          ? t('Você usou as perguntas de hoje; o limite volta amanhã (horário de Brasília).', 'You have used today’s questions; the limit resets tomorrow (Brasília time).')
          : null;

  async function enviar(bruta: string) {
    const pergunta = bruta.trim();
    if (!pergunta || rodando || enviando.current || bloqueio || refazendo) return;
    enviando.current = true;
    const antes = { mensagens, metas };
    // a primeira pergunta cria a conversa: identificador e endereço (?conversa=) desde já
    const base: Cabecalho = aberta ?? {
      formato: FORMATO_CONVERSA, versao: VERSAO_CONVERSA, id: novoId(), titulo: tituloAutomatico(pergunta), tituloManual: false,
      criadaEm: Date.now(), atualizadaEm: Date.now(), fontes: {}, origem: { tipo: 'nova' }, conta: h.conta,
    };
    const id = base.id;
    if (!aberta) {
      idNaTela.current = id;
      setAberta(base);
      setNaoAchada(null);
      guardar('ia-conversa-aberta', id, true);
      const b = new URLSearchParams(busca);
      b.set('conversa', id);
      setBusca(b, { replace: true });
    }
    const naTela = () => montada.current && idNaTela.current === id;
    const controle = new AbortController();
    const inicio: MetaTurno = { contexto, inicio: Date.now(), dados: meta.geradoEm, escolhaModelo };
    // resultados da conversa com os desta pergunta, para gravá-la mesmo que a página já não esteja nela
    const res: Record<string, Resultado> = { ...resultados };
    setTexto('');
    setSubstituida(null);
    setFalha(null);
    setAjustes(false);
    setMetas([...metas, inicio]);
    setRodando(controle);
    setStatus(t('Analisando a pergunta…', 'Analysing the question…'));
    focarCampo();
    historico.marcar(id, true);
    try {
      const r = await perguntarIa({
        historico: mensagens, resultados, ultimaCompetencia, pergunta, contexto: contextoParaModelo(contexto, cobertura), idioma: idioma(),
        paineis: contexto.paineis, sinal: controle.signal, modo: contexto.modo, cobertura, modelo: escolhaModelo,
        aoAtualizar: (m) => {
          if (naTela()) setMensagens(m);
        },
        aoResultado: (x, v) => {
          res[x] = v;
          if (naTela()) setResultados((m) => ({ ...m, [x]: v }));
        },
        aoProgresso: (pr) => {
          if (naTela()) setProgresso(pr);
        },
        aoRestantes: (n) => setEstado((e) => (e ? { ...e, restantes: n } : e)),
      });
      const feita: MetaTurno = {
        ...inicio, fim: Date.now(), desfecho: r.desfecho, detalhe: r.detalhe, etapas: r.etapas, registro: registroDoTurno(r.mensagens, res, pergunta),
        // o modelo que de fato respondeu (o ID devolvido pela API) e o consumo somado das chamadas desta resposta
        ...(r.modelo ? { modelo: r.modelo } : {}), uso: r.uso,
      };
      // com login, a conversa (inclusive uma que estava só neste navegador) é gravada na conta
      const conversa: Conversa = {
        ...base, conta: h.conta ?? base.conta, atualizadaEm: Date.now(), mensagens: r.mensagens, metas: [...antes.metas, feita], resultados: res,
        fontes: { ...base.fontes, [meta.geradoEm]: meta.fontes },
      };
      if (naTela()) {
        setMetas(conversa.metas);
        setAberta(cabecalho(conversa));
        setStatus(r.desfecho === 'resposta' || r.desfecho === 'texto'
          ? t('Resposta pronta.', 'Answer ready.')
          : t('A pergunta terminou sem uma resposta completa.', 'The question ended without a complete answer.'));
      }
      await historico.salvar(conversa);
    } catch (e) {
      if (naTela()) {
        // um histórico pela metade invalidaria as próximas perguntas: volta ao estado de antes
        setMensagens(antes.mensagens);
        setMetas(antes.metas);
        // a pergunta volta para o campo, sem apagar o que tenha sido escrito enquanto ela rodava
        setTexto((atual) => (atual.trim() ? atual : pergunta));
        if (foiCancelado(e)) setStatus(t('Pergunta cancelada. Ela voltou para o campo de texto.', 'Question cancelled. It is back in the text box.'));
        else setFalha({ mensagem: e instanceof Error ? e.message : String(e), pergunta, entrar: e instanceof ErroAcesso && e.tipo === 'sessao' });
        // sem nenhuma resposta, a conversa nem chegou a existir
        if (!aberta) {
          idNaTela.current = null;
          setAberta(null);
          guardar('ia-conversa-aberta', null, true);
          setBusca(new URLSearchParams(busca), { replace: true });
        }
      } else if (!lerGuardado('ia-rascunho', true)) {
        guardar('ia-rascunho', pergunta, true);
      }
    } finally {
      historico.marcar(id, false);
      if (naTela()) {
        enviando.current = false;
        setRodando(null);
        setProgresso(null);
      }
    }
  }

  const cancelar = () => rodando?.abort();
  const editarUltima = () => {
    if (rodando || !lista.length) return;
    const pergunta = lista.at(-1)!.pergunta;
    setMensagens((m) => semUltimaPergunta(m));
    setMetas((ms) => ms.slice(0, -1));
    usarTexto(pergunta);
  };
  const abrirConversa = (id: string) => setBusca(new URLSearchParams({ conversa: id }));
  const conversaAtual = (): Conversa | null => (aberta ? { ...aberta, mensagens, metas, resultados } : null);
  // pedido de conferência pelo especialista RAIS: só para os e-mails autorizados no Worker e respostas que usaram o
  // painel de trabalho; montado aqui, com o que a conversa já tem (nada vai ao servidor nem à Anthropic)
  const conferencia = (i: number) => {
    const m = metas[i];
    if (!estado?.pode_conferir || !aberta || !m?.contexto.paineis.includes('trabalho')) return undefined;
    return () => {
      const r = pedidoConferencia({
        mensagens, turno: i, meta: m, solicitante: estado.email, modelo: m.modelo ?? estado.modelo ?? '',
        fontes: aberta.fontes, dadosAtuais: { geradoEm: meta.geradoEm, fontes: meta.fontes },
        conversa: `${location.origin}/ia?conversa=${encodeURIComponent(aberta.id)}`,
      });
      if ('erro' in r) return r.erro;
      baixarArquivo(`${r.pedido.id}.json`, r.json, 'application/json');
      return null;
    };
  };
  const exportarJson = () => {
    const c = conversaAtual();
    if (c) baixarArquivo(`${nomeArquivo(c.titulo)}.json`, exportarConversa(c), 'application/json');
  };
  const salvarDeNovo = () => {
    const c = conversaAtual();
    if (!c) return;
    const nova = { ...c, atualizadaEm: Date.now() };
    void historico.salvar(nova).then((ok) => {
      if (ok && idNaTela.current === nova.id) setAberta(cabecalho(nova));
    });
  };
  // nova versão com os dados atuais: as consultas rodam de novo aqui; a IA não é chamada; a original fica como está
  const criarVersao = async () => {
    const c = conversaAtual();
    if (!c || rodando) return;
    setRefazendo(true);
    setStatus(t('Refazendo as consultas com os dados atuais, aqui no navegador…', 'Rerunning the queries with the current data, here in the browser…'));
    try {
      const nova = await novaVersaoComDadosAtuais(c, { executar: (sql, p, entrada) => executarConsulta(entrada ?? { sql }, p), dados: meta.geradoEm, fontes: meta.fontes });
      if (await historico.salvar(nova)) abrirConversa(nova.id);
    } finally {
      setRefazendo(false);
    }
  };
  const enderecoConversa = aberta ? `${location.origin}/ia?conversa=${encodeURIComponent(aberta.id)}` : '';
  const copiarEndereco = async () => {
    try {
      await navigator.clipboard.writeText(enderecoConversa);
      setCopiouEndereco(true);
      setTimeout(() => setCopiouEndereco(false), 2000);
    } catch {
      setStatus(t('O navegador não permitiu copiar.', 'The browser did not allow copying.'));
    }
  };
  const copiar = async (conteudo: string) => {
    try {
      await navigator.clipboard.writeText(conteudo);
      setStatus(t('Resposta copiada.', 'Answer copied.'));
      return true;
    } catch {
      setStatus(t('O navegador não permitiu copiar.', 'The browser did not allow copying.'));
      return false;
    }
  };
  const alternarPainel = (p: Painel) => {
    const novos = paineis.includes(p) ? paineis.filter((x) => x !== p) : PAINEIS.filter((x) => x === p || paineis.includes(x));
    if (!novos.length) return; // pelo menos um painel
    const b = new URLSearchParams(busca);
    if (novos.length === PAINEIS.length) b.delete('paineis');
    else b.set('paineis', novos.join(','));
    setBusca(b, { replace: true });
  };
  const definirAno = (a: number | null) => {
    const b = new URLSearchParams(busca);
    if (a) b.set('ano', String(a));
    else b.delete('ano');
    setBusca(b, { replace: true });
  };
  const definirModelo = (m: EscolhaModelo) => {
    setEscolhaModelo(m);
    guardar('ia-modelo', m);
  };
  const restaurarModelo = () => {
    setEscolhaModelo(MODELO_PADRAO);
    guardar('ia-modelo', null);
  };
  const definirModo = (m: Modo) => {
    setModo(m);
    guardar('ia-modo', m);
    guardar('ia-estilo', null);
  };

  const conversa = lista.length > 0;
  const ultimoContexto = metas.at(-1)?.contexto;
  const contextoMudou = conversa && !rodando && !!ultimoContexto && !mesmoContexto(ultimoContexto, contexto);
  const exemplo = conversa ? t('Pergunte mais sobre isso…', 'Ask a follow-up…') : exemploPergunta(contexto.paineis, territorio, cobertura);
  const temAjustes = paineis.length !== PAINEIS.length || !!busca.get('uf') || !!busca.get('ente') || !!ano;
  const limparAjustes = () => {
    const b = new URLSearchParams(busca);
    for (const k of ['uf', 'ente', 'ano']) b.delete(k);
    if (!conversa && !rodando) b.delete('paineis');
    setBusca(b, { replace: true });
  };
  const concluirAjustes = () => {
    setAjustes(false);
    botaoContexto.current?.focus();
  };
  // ao abrir o contexto, o foco vai ao primeiro filtro: o painel vem depois do botão de enviar na ordem do DOM, e o Tab
  // do botão do contexto cairia no envio. Esc ou "Concluir" devolvem o foco ao botão.
  useEffect(() => {
    if (!ajustes) return;
    const id = requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('#ia-ajustes input:not(:disabled), #ia-ajustes select')?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [ajustes]);
  const painelAjustes = ajustes && (
    <Ajustes paineis={paineis} alternarPainel={alternarPainel} travarPaineis={conversa || !!rodando} anos={anos} ano={ano}
      rotulo={(a) => rotuloDoAno(a, cobertura, contexto.paineis)} definirAno={definirAno}
      temAjustes={temAjustes} limpar={limparAjustes} concluir={concluirAjustes} />
  );
  // um exemplo de outra base, antes da 1ª pergunta, acrescenta a base ao contexto (depois as bases ficam fixas)
  const escolherExemplo = (s: Sugestao) => {
    proporTexto(s.texto, () => {
      if (!conversa && !rodando && !s.paineis.every((x) => paineis.includes(x))) {
        const novos = PAINEIS.filter((x) => paineis.includes(x) || s.paineis.includes(x));
        const b = new URLSearchParams(busca);
        if (novos.length === PAINEIS.length) b.delete('paineis');
        else b.set('paineis', novos.join(','));
        setBusca(b, { replace: true });
      }
      setExemplos(false);
    });
  };
  const listaExemplos = sugestoes(conversa ? paineis : PAINEIS, territorio, cobertura, ano)
    .filter((s) => !conversa || s.paineis.every((x) => paineis.includes(x)));
  // acesso: e-mail sem autorização ou falha ao verificar (o caso sem login fica no próprio compositor)
  const acesso = falhaEstado && (estadoNegado ? (
    <section className="ia-entrar-negado" role="alert" aria-labelledby="ia-negado-titulo">
      <p><strong id="ia-negado-titulo">{t('Este e-mail não tem acesso à IA.', 'This email does not have access to the AI.')}</strong>{' '}
        {falhaEstado.charAt(0).toUpperCase() + falhaEstado.slice(1)}.</p>
      <p className="ia-entrar-acoes">
        <a className="ia-botao-primario" href="/cdn-cgi/access/logout">{t('Sair e entrar com outro e-mail', 'Sign out and use another email')}</a>
        <button type="button" className="ia-botao-leve" onClick={carregar}>{t('Tentar de novo', 'Try again')}</button>
      </p>
    </section>
  ) : (
    <p className="erro" role="alert">{falhaEstado} <button type="button" className="ia-botao-leve" onClick={carregar}>{t('Tentar de novo', 'Try again')}</button></p>
  ));
  const poucas = estado && estado.restantes > 0 && estado.restantes <= 5
    ? t(`restam ${contar(estado.restantes, 'pergunta', 'perguntas')} hoje`, `${contar(estado.restantes, 'question', 'questions')} left today`) : null;
  const compositor = (
    <Compositor valor={texto} mudar={setTexto} enviar={enviar} cancelar={cancelar} ocupado={!!rodando}
      bloqueio={estado === null || (estado === undefined && !falhaEstado) ? null : bloqueio}
      exemplo={exemplo} grande={!conversa} campo={campo}
      modo={<><SeletorModo modo={modo} definir={definirModo} travado={!!rodando} /><SeletorModelo escolha={escolhaModelo} definir={definirModelo} travado={!!rodando} /></>}
      descricaoDoModo={descricaoModo(modo)} descricaoDoModelo={descricaoModelo(escolhaModelo)} modeloAlterado={escolhaModelo !== MODELO_PADRAO} restaurarModelo={restaurarModelo}
      resumo={resumoContexto(contexto)} ajustesAbertos={ajustes} alternarAjustes={() => setAjustes(!ajustes)} botaoContexto={botaoContexto}
      painelAjustes={painelAjustes} entrar={estado === null} verificando={estado === undefined && !falhaEstado}
      aoComoAcesso={abrirVista(() => setAjuda('entrar'))} alerta={poucas} />
  );
  const restaurar = substituida !== null && (
    <p className="ia-nota ia-restaurar" role="status">
      {t('Pergunta anterior substituída.', 'Previous question replaced.')}{' '}
      <button type="button" className="ia-link" onClick={() => { usarTexto(substituida); setSubstituida(null); }}>{t('Restaurar rascunho', 'Restore draft')}</button>
    </p>
  );
  const aviso = falha && (
    <div className="ia-falha" role="alert">
      <p><strong>{t('Não foi possível concluir a pergunta.', 'The question could not be completed.')}</strong> {falha.mensagem}</p>
      <p className="ia-nota">{falha.entrar
        ? t('A pergunta voltou para o campo de texto e fica guardada, com o território, o ano e os painéis, enquanto você entra de novo.', 'The question is back in the text box and is kept, with the territory, year and dashboards, while you sign in again.')
        : t('A pergunta voltou para o campo de texto; nada foi perdido.', 'The question is back in the text box; nothing was lost.')}</p>
      {falha.entrar
        ? <a className="botao" href={urlEntrar()}>{t('Entrar de novo', 'Sign in again')}</a>
        : <button type="button" className="botao" onClick={() => enviar(falha.pergunta)} disabled={!!bloqueio}>{t('Tentar de novo', 'Try again')}</button>}
    </div>
  );

  const versoes = versoesDosDados(metas);
  const velha = !!aberta && !rodando && desatualizada(metas, meta.geradoEm);
  const derivadas = aberta ? h.resumos.filter((r) => r.origem.tipo === 'versao' && r.origem.de === aberta.id) : [];
  const abrir = (id: string) => (e: { preventDefault: () => void }) => {
    e.preventDefault();
    abrirConversa(id);
  };
  const avisoHistorico = h.erro && (
    <div className="ia-falha" role="alert">
      <p><strong>{t('Histórico:', 'History:')}</strong> {h.erro}</p>
      {aberta && (
        <p>
          <button type="button" className="botao" onClick={salvarDeNovo}>{t('Tentar salvar de novo', 'Try saving again')}</button>{' '}
          <button type="button" className="botao-leve" onClick={exportarJson}>{t('Exportar conversa (JSON)', 'Export conversation (JSON)')}</button>
        </p>
      )}
    </div>
  );
  const avisoVersao = velha && (
    <section className="ia-versao" role="note" aria-label={t('Versão dos dados', 'Data version')}>
      <p><strong>{t('Resultados originais.', 'Original results.')}</strong>{' '}
        {t(`As respostas desta conversa usaram os dados processados em ${versoes.map(dataHora).join(', ')}; os publicados agora são de ${dataHora(meta.geradoEm)}. Nada foi refeito ao abrir: tabelas, números e textos estão como foram gerados.`,
          `The answers in this conversation used the data processed on ${versoes.map(dataHora).join(', ')}; the data published now are from ${dataHora(meta.geradoEm)}. Nothing was redone on opening: tables, numbers and texts are as they were generated.`)}</p>
      <p className="ia-nota">
        {t('“Criar nova versão” refaz as consultas (SQL) aqui no navegador, com os dados atuais: não chama a IA e não usa o limite de perguntas. A conversa original continua salva como está. Na nova versão, tabelas e números são recalculados, mas os textos escritos pela IA (conclusão, análise, ressalvas) continuam os originais e não são regenerados. Para textos novos, faça a pergunta de novo: isso chama a IA e usa 1 pergunta do limite.',
          '“Create new version” reruns the queries (SQL) here in the browser, with the current data: it does not call the AI and does not use the question limit. The original conversation stays saved as it is. In the new version, tables and numbers are recalculated, but the texts written by the AI (conclusion, analysis, caveats) remain the originals and are not regenerated. For new texts, ask the question again: that calls the AI and uses 1 question of the limit.')}
      </p>
      <p className="ia-versao-acoes">
        <button type="button" className="botao" onClick={() => void criarVersao()} disabled={refazendo}>
          {refazendo ? t('Refazendo as consultas…', 'Rerunning the queries…') : t('Criar nova versão com os dados atuais', 'Create new version with the current data')}
        </button>
        {derivadas.map((d) => (
          <a key={d.id} href={`/ia?conversa=${encodeURIComponent(d.id)}`} onClick={abrir(d.id)}>
            {t(`Abrir a versão criada em ${dataHora(d.criadaEm)}`, `Open the version created on ${dataHora(d.criadaEm)}`)}
          </a>
        ))}
      </p>
    </section>
  );

  const salva = aberta ? h.resumos.find((r) => r.id === aberta.id) : undefined;
  const situacaoSalva = !aberta ? '' : !salva
    ? t('Ainda não salva', 'Not saved yet')
    : salva.pendente
      ? t('Salva neste navegador; ainda não enviada à conta', 'Saved in this browser; not yet sent to the account')
      : h.conta && salva.conta
        ? t(`Salva na sua conta · ${dataHora(salva.atualizadaEm)}`, `Saved in your account · ${dataHora(salva.atualizadaEm)}`)
        : t(`Salva neste navegador · ${dataHora(salva.atualizadaEm)}`, `Saved in this browser · ${dataHora(salva.atualizadaEm)}`);
  const conferir = (
    <p className="ia-conferir">
      {t('Respostas geradas por IA podem conter erros: confira as consultas e as ressalvas antes de usar os números.',
        'AI-generated answers may contain errors: check the queries and caveats before using the numbers.')}
    </p>
  );
  const dialogos = (
    <>
      <Dialogo aberto={exemplos} aoFechar={() => setExemplos(false)} retorno={origem} titulo={t('Explorar exemplos', 'Explore examples')}>
        <Exemplos lista={listaExemplos} selecionados={paineis} ano={ano} aoEscolher={escolherExemplo} fixo={conversa} />
      </Dialogo>
      <Dialogo aberto={ajuda !== null} aoFechar={() => setAjuda(null)} retorno={origem}
        titulo={ajuda === 'entrar' ? t('Como funciona o acesso', 'How access works') : t('Ajuda', 'Help')}>
        {ajuda === 'entrar'
          ? <AjudaEntrar entrar={estado === null} aoVerTudo={() => setAjuda('acesso')} />
          : <Ajuda secao={ajuda === 'inicio' ? null : ajuda} paineis={contexto.paineis} cobertura={cobertura} estado={estado} conta={h.conta} />}
      </Dialogo>
      <Dialogo aberto={substituir !== null} aoFechar={() => setSubstituir(null)} titulo={t('Substituir a pergunta escrita?', 'Replace the question you wrote?')}
        rodape={(
          <>
            <button type="button" className="ia-botao-leve" onClick={manterRascunho}>{t('Manter rascunho', 'Keep draft')}</button>
            <button type="button" className="ia-botao-primario" onClick={confirmarSubstituicao}>{t('Substituir pergunta', 'Replace question')}</button>
          </>
        )}>
        <p>{t('O campo já tem um rascunho. Escolha o que fazer com ele:', 'The box already has a draft. Choose what to do with it:')}</p>
        <blockquote className="ia-rascunho-citado">{texto}</blockquote>
        <p className="ia-nota">{t('Ao substituir, você ainda pode restaurar o rascunho logo abaixo do campo.', 'If you replace it, you can still restore the draft just below the box.')}</p>
      </Dialogo>
    </>
  );

  return (
    <div className={`ia${conversa ? ' em-conversa' : ''}`}>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {abrindo && !conversa ? (
        <p className="vazio" role="status">{t('Abrindo a conversa…', 'Opening the conversation…')}</p>
      ) : !conversa ? (
        <section className="ia-inicio" aria-labelledby="ia-titulo">
          {naoAchada && (
            <div className="ia-falha" role="alert">
              {h.conta ? (
                <p><strong>{t(`Esta conversa não está na sua conta (${h.conta}) nem neste navegador.`, `This conversation is not in your account (${h.conta}) or in this browser.`)}</strong>{' '}
                  {t('Ela pode ter sido excluída, estar na conta de outro e-mail (cada pessoa só abre as próprias conversas) ou ter sido feita sem login em outro navegador; nesse caso, exporte-a em JSON lá e importe aqui, pelo histórico.',
                    'It may have been deleted, belong to another email’s account (each person only opens their own conversations) or have been made without signing in on another browser; in that case, export it as JSON there and import it here, from the history.')}</p>
              ) : (
                <p><strong>{t('Esta conversa não está neste navegador.', 'This conversation is not in this browser.')}</strong>{' '}
                  {t('Se ela foi salva numa conta, entre com o mesmo e-mail para abri-la. Sem login, o endereço só reabre a conversa no navegador em que ela foi feita; para levá-la a outro computador, exporte-a em JSON lá e importe aqui, pelo histórico.',
                    'If it was saved in an account, sign in with the same email to open it. Without signing in, the address only reopens the conversation in the browser where it was made; to move it to another computer, export it as JSON there and import it here, from the history.')}
                  {estado === null && <>{' '}<a href={urlEntrar()}>{t('Entrar', 'Sign in')}</a></>}</p>
              )}
            </div>
          )}
          {avisoHistorico}
          <h2 id="ia-titulo" className="ia-titulo">{t('O que você quer analisar?', 'What would you like to analyse?')}</h2>
          <p className="ia-descricao">{subtitulo(contexto.paineis)}</p>
          {acesso}
          {compositor}
          {restaurar}
          {aviso}
          <Sugestoes lista={sugestoes(contexto.paineis, territorio, cobertura, ano)} aoEscolher={escolherExemplo} />
          <p className="ia-links">
            <button type="button" className="ia-link" onClick={abrirVista(() => setExemplos(true))}><Icone nome="ideia" tamanho={15} /> {t('Explorar exemplos', 'Explore examples')}</button>
            <button type="button" className="ia-link" onClick={abrirVista(() => setAjuda('dados'))}><Icone nome="dados" tamanho={15} /> {t('Dados disponíveis', 'Available data')}</button>
            <button type="button" className="ia-link" onClick={abrirVista(() => setAjuda('inicio'))}><Icone nome="ajuda" tamanho={15} /> {t('Ajuda', 'Help')}</button>
          </p>
          {conferir}
        </section>
      ) : (
        <>
          <header className="ia-cabeca">
            <div className="ia-identificacao">
              <h2 className="ia-conversa-titulo">{aberta?.titulo ?? t('Pergunte aos dados', 'Ask the data')}</h2>
              {aberta && <p className="ia-nota ia-salva">{situacaoSalva}</p>}
              {aberta?.origem.tipo === 'versao' && (
                <p className="ia-nota">
                  {t(`Nova versão de “${aberta.origem.titulo}”, com as consultas refeitas nos dados de ${dataHora(aberta.origem.dados)}.`,
                    `New version of “${aberta.origem.titulo}”, with the queries rerun on the data of ${dataHora(aberta.origem.dados)}.`)}{' '}
                  <a href={`/ia?conversa=${encodeURIComponent(aberta.origem.de)}`} onClick={abrir(aberta.origem.de)}>{t('Abrir a original', 'Open the original')}</a>
                </p>
              )}
            </div>
            <div className="ia-cabeca-acoes">
              <Popover rotulo={<><Icone nome="baixar" tamanho={16} /> {t('Exportar', 'Export')}</>} conteudo={(fechar) => (
                <div className="ia-exportar" role="group" aria-label={t('Exportar a conversa', 'Export the conversation')}>
                  <button type="button" className="ia-menu-item" disabled={!!rodando || !estado}
                    onClick={() => {
                      imprimirPdf(lista, metas, prontas, resultados, { email: estado?.email ?? '', paineis: contexto.paineis, apendice, geradoEm: (versoes.length ? versoes : [meta.geradoEm]).join('; ') });
                      fechar();
                    }}
                    title={t('Abre a impressão do navegador; escolha "Salvar como PDF"', 'Opens the browser print dialog; choose "Save as PDF"')}>
                    {t('PDF', 'PDF')}<span className="ia-nota"> · {t('pela impressão do navegador', 'via the browser print dialog')}</span>
                  </button>
                  <button type="button" className="ia-menu-item" disabled={!!rodando}
                    onClick={() => {
                      void baixarExcel(lista, metas, prontas, resultados, contexto.paineis, apendice, cobertura, meta.geradoEm);
                      fechar();
                    }}>
                    Excel<span className="ia-nota"> · {t('resumo e uma aba por tabela', 'summary and one sheet per table')}</span>
                  </button>
                  <button type="button" className="ia-menu-item" disabled={!aberta}
                    onClick={() => {
                      exportarJson();
                      fechar();
                    }}>
                    JSON<span className="ia-nota"> · {t('conversa completa, para backup ou importar', 'full conversation, for backup or import')}</span>
                  </button>
                  <label className="caixa ia-apendice">
                    <input type="checkbox" checked={apendice} onChange={(e) => setApendice(e.target.checked)} />
                    {' '}{t('incluir apêndice de reprodução', 'include reproduction appendix')}
                  </label>
                  <p className="ia-nota">
                    {t('Cada resposta sai no modo em que foi feita.', 'Each answer is exported in the mode it was made.')}
                    {apendice && ` ${t('O apêndice traz o SQL e o histórico de todas as consultas, inclusive as sem resultado e as refeitas.', 'The appendix adds the SQL and history of all queries, including empty and redone ones.')}`}
                  </p>
                </div>
              )} />
              <Popover rotulo={<><Icone nome="info" tamanho={16} /> {t('Detalhes', 'Details')}</>} conteudo={() => (
                <div className="ia-detalhes-conversa">
                  {aberta && (
                    <>
                      <p>{t('Conversa', 'Conversation')} <code>{aberta.id}</code></p>
                      <p>{t(`Criada em ${dataHora(aberta.criadaEm)}.`, `Created on ${dataHora(aberta.criadaEm)}.`)} {situacaoSalva}.</p>
                      <p>{aberta.conta
                        ? t(`O endereço abre esta conversa em qualquer computador em que você entrar com ${aberta.conta}. Só você tem acesso a ela: para compartilhar, exporte.`,
                          `The address opens this conversation on any computer where you sign in with ${aberta.conta}. Only you can access it: to share it, export it.`)
                        : h.conta
                          ? t('Esta conversa está só neste navegador; ela vai para a sua conta na próxima pergunta ou pelo histórico.',
                            'This conversation is only in this browser; it goes to your account with the next question or from the history.')
                          : t('O endereço reabre esta conversa só neste navegador. Entre com seu e-mail para guardá-la na sua conta.',
                            'The address reopens this conversation only in this browser. Sign in with your email to keep it in your account.')}</p>
                      <button type="button" className="ia-botao-leve" onClick={() => void copiarEndereco()}>
                        <Icone nome="copiar" tamanho={14} /> {copiouEndereco ? t('Endereço copiado ✓', 'Address copied ✓') : t('Copiar endereço', 'Copy address')}
                      </button>
                    </>
                  )}
                  {estado && <Conta estado={estado} />}
                </div>
              )} />
            </div>
          </header>
          {avisoHistorico}
          {avisoVersao}
          <div className="ia-conversa">
            {lista.map((turno, i) => (
              <Turno key={i} i={i} turno={turno} pronta={prontas[i]} meta={metas[i]} resultados={resultados} notasVistas={notasVistas[i]}
                ativo={!!rodando && i === lista.length - 1} progresso={progresso} ultimo={i === lista.length - 1} paineis={contexto.paineis}
                feitas={feitas} aoEditar={editarUltima} aoUsar={(x) => proporTexto(x)} aoCopiar={copiar} aoPedirConferencia={conferencia(i)} />
            ))}
            {aviso}
          </div>
          <div className={`ia-rodape${ajustes ? ' aberto' : ''}`}>
            {longeDoFim && (
              <button type="button" className="ia-recente" onClick={() => {
                const reduzir = matchMedia('(prefers-reduced-motion: reduce)').matches;
                document.getElementById(`ia-turno-${lista.length - 1}`)?.scrollIntoView({ block: 'start', behavior: reduzir ? 'auto' : 'smooth' });
              }}>
                <Icone nome="descer" tamanho={15} /> {rodando ? t('Acompanhar a resposta', 'Follow the answer') : t('Ir para a última pergunta', 'Go to the latest question')}
              </button>
            )}
            {contextoMudou && (
              <p className="ia-mudou" role="status">
                {t(`As próximas respostas vão usar: ${descreverContexto(contexto, null, false)}. As respostas anteriores mantêm o recorte que usaram.`,
                  `The next answers will use: ${descreverContexto(contexto, null, false)}. Previous answers keep the scope they used.`)}
              </p>
            )}
            {acesso}
            {compositor}
            {restaurar}
            <p className="ia-links ia-links-rodape">
              <button type="button" className="ia-link" onClick={abrirVista(() => setExemplos(true))}><Icone nome="ideia" tamanho={14} /> {t('Exemplos', 'Examples')}</button>
              <button type="button" className="ia-link" onClick={abrirVista(() => setAjuda('inicio'))}><Icone nome="ajuda" tamanho={14} /> {t('Ajuda', 'Help')}</button>
              <span className="ia-nota">{t('Respostas geradas por IA podem conter erros: confira as consultas.', 'AI-generated answers may contain errors: check the queries.')}</span>
            </p>
          </div>
        </>
      )}
      {dialogos}
    </div>
  );
}
