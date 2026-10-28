import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Ente, Meta } from '../api';
import { BotoesExportar } from '../components/Exportar';
import { barrasAgrupadas, Grafico, graficoSvg, linhas, type Marca } from '../components/Grafico';
import { BuscaEnte, UFS, useDados, useFiltros } from '../contexto';
import { tabelasIaTrabalho } from '../dados';
import { baixarArquivo, nomeArquivo, paraXlsxAbas, type Celula, type Planilha } from '../exportar';
import { idioma, local, t } from '../idioma';
import {
  avisoFaltantes, consultasDaConversa, contextoParaModelo, descreverCobertura, descricaoModo, estadoIa, exemploPergunta, foiCancelado,
  fontesConsultadas, lerModo, LINHAS_TELA, MAX_PERGUNTA, mesmoContexto, MODOS, nomeDaUf, PAINEIS, perguntarIa, prepararResposta,
  recorteDe, rotuloAno, rotuloModo, rotuloTerritorio, semUltimaPergunta, sugestoes, textoDaResposta, turnos,
  type Cobertura, type ConsultaFeita, type ContextoIa, type DadosGrafico, type Desfecho, type EstadoIa, type GraficoIa,
  type GraficoPronto, type ItemTurno, type Mensagem, type Modo, type Painel, type Progresso, type RespostaPronta, type Resultado,
  type Sugestao, type TabelaPronta, type Territorio, type TurnoIa,
} from '../ia';
import { contar, formatarTabela, formatarValor, rotuloCompetencia, tiposDoResultado, type TabelaFormatada } from '../ia_formato';
import { dataDaNota, type NotaMetodologica } from '../ia_notas';
import {
  ehTexto, formatarCelulaT, rodapeTabela, tabelaExportavel, tabelaHtml, tabelaTsv, type TabelaAnalitica,
} from '../ia_tabelas';
import { cadastro as carregarCadastro, type Cadastro } from '../ia_territorio';

const LINHAS_INICIAIS = 25;

const NOMES_PAINEIS = (): Record<Painel, string> => ({
  financas: t('Finanças públicas', 'Public finances'),
  trabalho: t('Mercado de trabalho', 'Labour market'),
});

/** Contexto de cada pergunta, guardado com ela: as respostas anteriores mantêm o recorte que usaram. */
type MetaTurno = { contexto: ContextoIa; inicio: number; fim?: number; desfecho?: Desfecho; detalhe?: string | null };
type ItemConsulta = Extract<ItemTurno, { tipo: 'consulta' }>;

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

function coberturaDe(meta: Meta, microdados: boolean): Cobertura {
  const rais = (meta.fontes.rais as { anos?: number[] } | undefined)?.anos ?? [];
  const caged = meta.fontes.caged as { de?: number; ate?: number } | undefined;
  return { rais, caged: caged?.de && caged?.ate ? { de: caged.de, ate: caged.ate } : null, microdados, dca: meta.anos };
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

const titulo = (p: Painel[]) => (p.length > 1
  ? t('O que você quer saber sobre finanças públicas e mercado de trabalho?', 'What would you like to know about public finances and the labour market?')
  : p[0] === 'trabalho'
    ? t('O que você quer saber sobre o mercado de trabalho?', 'What would you like to know about the labour market?')
    : t('O que você quer saber sobre as finanças públicas?', 'What would you like to know about public finances?'));

const descricao = (p: Painel[]) => (p.length > 1
  ? t('Pergunte em linguagem natural, inclusive cruzando os painéis. A IA consulta as bases aqui no seu navegador, faz os cálculos com SQL e explica o resultado, com as consultas à vista para conferência.',
    'Ask in plain language, including across dashboards. The AI queries the datasets here in your browser, does the calculations in SQL and explains the result, with the queries in view for checking.')
  : p[0] === 'trabalho'
    ? t('Pergunte em linguagem natural sobre emprego formal, remuneração, setores, ocupações, afastamentos e movimentações. A IA consulta a RAIS e o Novo CAGED aqui no seu navegador, faz os cálculos com SQL e explica o resultado, com as consultas à vista para conferência.',
      'Ask in plain language about formal employment, pay, sectors, occupations, leave and job flows. The AI queries RAIS and New CAGED here in your browser, does the calculations in SQL and explains the result, with the queries in view for checking.')
    : t('Pergunte em linguagem natural sobre receitas, despesas, transferências e indicadores fiscais de municípios, estados e DF. A IA consulta as declarações do SICONFI aqui no seu navegador, faz os cálculos com SQL e explica o resultado, com as consultas à vista para conferência.',
      'Ask in plain language about revenue, expenditure, transfers and fiscal indicators of municipalities, states and DF. The AI queries the SICONFI filings here in your browser, does the calculations in SQL and explains the result, with the queries in view for checking.'));

const FONTES = (): Record<Painel, string> => ({
  financas: t('finanças públicas (SICONFI/Tesouro Nacional, IBGE, Banco Central, Portal da Transparência, Previdência)', 'public finances (SICONFI/National Treasury, IBGE, Central Bank, Transparency Portal, Social Security)'),
  trabalho: t('mercado de trabalho (RAIS e Novo CAGED, Ministério do Trabalho e Emprego)', 'labour market (RAIS and New CAGED, Ministry of Labour and Employment)'),
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
function baixarExcel(lista: TurnoIa[], metas: MetaTurno[], prontas: (RespostaPronta | null)[], resultados: Record<string, Resultado>, paineis: Painel[], apendice: boolean) {
  const resumo: Planilha = {
    nome: t('Conversa', 'Conversation'),
    linhas: [
      [t('Fonte', 'Source'), fonteIa(paineis)],
      [t('Exportado em', 'Exported on'), new Date().toISOString()],
      [t('Conteúdo', 'Contents'), apendice ? `${t('respostas e tabelas, com', 'answers and tables, with')} ${ROTULO_APENDICE()}` : t('respostas e tabelas', 'answers and tables')],
      [],
      [t('Pergunta', 'Question'), t('Modo', 'Mode'), t('Contexto', 'Context'), t('Período utilizado', 'Period used'), t('Resposta', 'Answer'), t('Abas', 'Sheets')],
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
    for (const x of p?.tabelas ?? []) {
      if (!x.tabela) continue;
      n += 1;
      const e = tabelaExportavel(x.tabela, [[t('Pergunta', 'Question'), turno.pergunta]]);
      const nome = `${t('Tabela', 'Table')} ${n} ${x.tabela.titulo}`;
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
    resumo.linhas.push([turno.pergunta, modo, metas[i] ? descreverContexto(metas[i].contexto, p?.periodo) : '', p?.periodo ?? '', limiteCelula(resposta), nomes.join('; ')]);
  });
  const todas = apendice ? [resumo, ...abas, { nome: t('Histórico de execução', 'Execution history'), linhas: historico }] : [resumo, ...abas];
  baixarArquivo(`${nomeArquivo(t('pergunte_aos_dados', 'ask_the_data'))}.xlsx`, paraXlsxAbas(todas) as BlobPart,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
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
function respostaHtml(p: RespostaPronta, modo: Modo, n: Contador) {
  const r = p.r;
  const texto = (titulo: string, v: string) => (v ? `<h4>${html(titulo)}</h4><div class="texto">${html(v)}</div>` : '');
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
    + `<h3>${html(t('Análise dos resultados', 'Analysis of the results'))}</h3>${r.explicacao ? `<div class="texto">${html(r.explicacao)}</div>` : ''}`
    + `${leituras.length ? `<ul>${leituras.map((l) => `<li>${html(l.texto)}</li>`).join('')}</ul>` : ''}`
    + `${texto(t('Hipóteses (não testadas pelos dados)', 'Hypotheses (not tested by the data)'), p.hipoteses)}`
    + `${texto(t('Ressalvas', 'Caveats'), r.limitacoes)}`
    + `${metodo ? `<h3>${html(t('Metodologia e fontes', 'Methodology and sources'))}</h3>${metodo}` : ''}`;
}

/** Apêndice de reprodução de uma pergunta: textos do modelo, consultas com SQL e tabelas, e o histórico de execução. */
function apendiceHtml(turno: TurnoIa, p: RespostaPronta | null, resultados: Record<string, Resultado>) {
  const partes: string[] = [];
  if (p) {
    if (p.hipotesesOmitidas) partes.push(`<h4>${html(t('Hipóteses (omitidas da resposta: a pergunta não pedia explicações)', 'Hypotheses (left out of the answer: the question did not ask for explanations)'))}</h4><div class="texto">${html(p.r.hipoteses)}</div>`);
    const leituras = p.leituras.filter((l) => !l.motivo);
    if (leituras.length) partes.push(`<h4>${html(t('Leituras e colunas que as sustentam', 'Readings and supporting columns'))}</h4><ul>${leituras.map((l) => `<li>${html(l.texto)} <span class="nota">(${html(`${l.consulta}: ${l.colunas.join(', ')}`)})</span></li>`).join('')}</ul>`);
    const conferencia = p.destaques.map((x) => `<li>${html(x.d.rotulo)}: ${html(x.valor)} <span class="nota">(${html(x.conferencia === 'conferido' ? t(`conferido na consulta ${x.d.consulta}, coluna ${x.d.coluna}`, `checked in query ${x.d.consulta}, column ${x.d.coluna}`) : t(`não encontrado na consulta ${x.d.consulta}`, `not found in query ${x.d.consulta}`))})</span></li>`).join('');
    if (conferencia) partes.push(`<h4>${html(t('Conferência dos números principais', 'Check of the key numbers'))}</h4><ul>${conferencia}</ul>`);
    const origem = p.tabelas.filter((x) => x.tabela).map((x) => `<li>${html(x.tabela!.titulo)}: ${html(t(`consulta ${x.espec.consulta}`, `query ${x.espec.consulta}`))} (${html(x.espec.tipo)}${x.espec.grupo ? `, ${html(t('grupo', 'group'))} ${html(x.espec.grupo)}` : ''}${x.espec.periodo ? `, ${html(t('período', 'period'))} ${html(x.espec.periodo)}` : ''}${x.espec.valor ? `, ${html(t('valor', 'value'))} ${html(x.espec.valor)}` : ''})</li>`).join('');
    if (origem) partes.push(`<h4>${html(t('Origem das tabelas', 'Table sources'))}</h4><ul>${origem}</ul>`);
  } else if (turno.textoFinal) partes.push(`<div class="texto">${html(turno.textoFinal)}</div>`);
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
    const resposta = p ? respostaHtml(p, modo, n) : turno.textoFinal ? `<div class="texto">${html(turno.textoFinal)}</div>` : '';
    return `<section class="pergunta"><h2>${i + 1}. ${html(turno.pergunta)}</h2>`
      + `<p class="nota">${html(rotuloModo(modo))}${metas[i] ? ` · ${html(descreverContexto(metas[i].contexto, p?.periodo, false))}` : ''}</p>${resposta}</section>`;
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
      .texto { white-space: pre-wrap; margin: 4px 0; }
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
  const blocos: ReactNode[] = [];
  let itens: string[] = [];
  let paragrafo: string[] = [];
  const fecharItens = () => {
    if (itens.length) blocos.push(<ul key={blocos.length}>{itens.map((x, i) => <li key={i}>{x}</li>)}</ul>);
    itens = [];
  };
  const fecharParagrafo = () => {
    if (paragrafo.length) blocos.push(<p key={blocos.length}>{paragrafo.join(' ')}</p>);
    paragrafo = [];
  };
  for (const linha of texto.split('\n').map((l) => l.trim())) {
    if (!linha) {
      fecharItens();
      fecharParagrafo();
    } else if (/^[-•–]\s+/.test(linha)) {
      fecharParagrafo();
      itens.push(linha.replace(/^[-•–]\s+/, ''));
    } else {
      fecharItens();
      paragrafo.push(linha);
    }
  }
  fecharItens();
  fecharParagrafo();
  return <div className="ia-texto">{blocos}</div>;
}

function Chips({ contexto, rotulo, pequenos, periodo }: { contexto: ContextoIa; rotulo: string; pequenos?: boolean; periodo?: string | null }) {
  return (
    <ul className={`ia-chips${pequenos ? ' pequenos' : ''}`} aria-label={rotulo}>
      <li className="ia-chip" title={t('Painéis consultados', 'Dashboards queried')}>{contexto.paineis.map((p) => NOMES_PAINEIS()[p]).join(' + ')}</li>
      <li className="ia-chip" title={t('Território', 'Territory')}>{rotuloTerritorio(contexto.territorio)}</li>
      <li className="ia-chip" title={t('Período', 'Period')}>{rotuloDoPeriodo(contexto, periodo)}</li>
      <li className="ia-chip" title={t('Modo de resposta', 'Answer mode')}>{rotuloModo(contexto.modo)}</li>
    </ul>
  );
}

function BarraContexto({ rotulo, contexto, aberto, alternar }: { rotulo: string; contexto: ContextoIa; aberto: boolean; alternar: () => void }) {
  return (
    <div className="ia-contexto">
      <span className="ia-contexto-rotulo">{rotulo}</span>
      <Chips contexto={contexto} rotulo={rotulo} />
      <button type="button" className="ia-ajustar" aria-expanded={aberto} aria-controls="ia-ajustes" onClick={alternar}>
        {aberto ? t('Fechar ajustes', 'Close settings') : t('Ajustar contexto', 'Adjust context')}
      </button>
    </div>
  );
}

function Ajustes({ paineis, alternarPainel, travarPaineis, anos, ano, definirAno }: {
  paineis: Painel[]; alternarPainel: (p: Painel) => void; travarPaineis: boolean;
  anos: number[]; ano: number | null; definirAno: (a: number | null) => void;
}) {
  const { entes } = useDados();
  const f = useFiltros();
  return (
    <div id="ia-ajustes" className="ia-ajustes">
      <fieldset className="ia-grupo">
        <legend>{t('Painéis consultados', 'Dashboards queried')}</legend>
        <div className="ia-linha">
          {PAINEIS.map((p) => (
            <label key={p} className="caixa">
              <input type="checkbox" checked={paineis.includes(p)} disabled={travarPaineis || (paineis.length === 1 && paineis.includes(p))}
                onChange={() => alternarPainel(p)} /> {NOMES_PAINEIS()[p]}
            </label>
          ))}
        </div>
        {travarPaineis && (
          <p className="ia-nota">{t('Para mudar os painéis, comece uma nova conversa: cada painel traz tabelas e regras próprias.',
            'To change the dashboards, start a new conversation: each dashboard brings its own tables and rules.')}</p>
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
        <legend>{t('Ano de referência', 'Reference year')}</legend>
        <div className="campo">
          <label htmlFor="ia-ano" className="sr-only">{t('Ano de referência', 'Reference year')}</label>
          <select id="ia-ano" value={ano ?? ''} onChange={(e) => definirAno(e.target.value ? Number(e.target.value) : null)}>
            <option value="">{t('O da pergunta (sem ano, o mais recente)', 'From the question (otherwise the latest)')}</option>
            {[...anos].reverse().map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </fieldset>
      {f.temFiltros && (
        <button type="button" className="limpar" onClick={f.limpar}>{t('Limpar território e ano', 'Clear territory and year')}</button>
      )}
    </div>
  );
}

/** Escolha do modo de resposta, junto ao campo da pergunta; vale para as próximas perguntas e fica guardada. */
function SeletorModo({ modo, definir, travado }: { modo: Modo; definir: (m: Modo) => void; travado: boolean }) {
  return (
    <fieldset className="ia-modos">
      <legend className="sr-only">{t('Modo de resposta', 'Answer mode')}</legend>
      {MODOS.map((m) => (
        <label key={m} className={`ia-modo${modo === m ? ' ativo' : ''}`}>
          <input type="radio" name="ia-modo" value={m} checked={modo === m} disabled={travado} onChange={() => definir(m)} />
          <span className="ia-modo-nome">{rotuloModo(m)}</span>
          <span className="ia-modo-desc">{descricaoModo(m)}</span>
        </label>
      ))}
    </fieldset>
  );
}

function Compositor({ valor, mudar, enviar, cancelar, ocupado, bloqueio, exemplo, grande, campo }: {
  valor: string; mudar: (v: string) => void; enviar: (v: string) => void; cancelar: () => void; ocupado: boolean;
  bloqueio: string | null; exemplo: string; grande?: boolean; campo: RefObject<HTMLTextAreaElement | null>;
}) {
  // o campo cresce com o texto, até um limite (depois rola)
  useEffect(() => {
    const c = campo.current;
    if (!c) return;
    c.style.height = 'auto';
    c.style.height = `${Math.min(c.scrollHeight + 2, grande ? 280 : 220)}px`;
  }, [valor, grande, campo]);
  const restantes = MAX_PERGUNTA - valor.length;
  return (
    <form className={`ia-compositor${grande ? ' grande' : ''}`} onSubmit={(e) => { e.preventDefault(); enviar(valor); }}>
      <label htmlFor="ia-pergunta" className="sr-only">{t('Sua pergunta', 'Your question')}</label>
      <textarea
        id="ia-pergunta"
        ref={campo}
        value={valor}
        maxLength={MAX_PERGUNTA}
        rows={grande ? 3 : 2}
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
      <div className="ia-compositor-rodape">
        <span id="ia-dica" className="ia-dica">
          {ocupado ? t('Esc ou o botão Cancelar interrompem a análise', 'Esc or the Cancel button stop the analysis') : t('Enter envia · Shift+Enter quebra a linha', 'Enter sends · Shift+Enter adds a line')}
          {restantes < 300 && <> · <span className={restantes < 50 ? 'ia-alerta' : undefined}>{t(`${contar(restantes, 'caractere restante', 'caracteres restantes')}`, `${contar(restantes, 'character left', 'characters left')}`)}</span></>}
        </span>
        {ocupado
          ? <button type="button" className="botao ia-cancelar" onClick={cancelar}>{t('Cancelar', 'Cancel')}</button>
          : <button type="submit" className="botao ia-enviar" disabled={!!bloqueio || !valor.trim()}>{t('Perguntar', 'Ask')}</button>}
      </div>
      {bloqueio && <p className="ia-bloqueio" role="status">{bloqueio}</p>}
    </form>
  );
}

function Sugestoes({ lista, aoEscolher }: { lista: Sugestao[]; aoEscolher: (s: string) => void }) {
  if (!lista.length) return null;
  return (
    <section className="ia-sugestoes" aria-labelledby="ia-sugestoes-titulo">
      <h3 id="ia-sugestoes-titulo" className="ia-secao">{t('Sugestões para começar', 'Suggestions to get started')}</h3>
      <ul>
        {lista.map((s) => (
          <li key={s.texto}>
            <button type="button" className="ia-sugestao" onClick={() => aoEscolher(s.texto)}>
              <span className="ia-sugestao-cat">{s.categoria}</span>
              <span>{s.texto}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="ia-nota">{t('A sugestão vai para o campo de pergunta: revise ou complete antes de enviar.', 'The suggestion goes into the question box: review or complete it before sending.')}</p>
    </section>
  );
}

function Rodape({ estado, paineis, conta }: { estado: EstadoIa | null | undefined; paineis: Painel[]; conta: boolean }) {
  return (
    <footer className="ia-rodape-info">
      <p>
        {t('Respostas geradas por IA (Claude, da Anthropic) podem conter erros: confira as consultas antes de usar os números. Para a Anthropic vão só a pergunta, o contexto da página e os resultados resumidos das consultas, nunca os arquivos.',
          'AI-generated answers (Claude, by Anthropic) may contain errors: check the queries before using the numbers. Only the question, the page context and the summarized query results go to Anthropic, never the files.')}
        {paineis.includes('trabalho') && ` ${t('Na RAIS, a unidade é o vínculo, não a pessoa.', 'In RAIS, the unit is the job, not the person.')}`}
      </p>
      {conta && estado && <Conta estado={estado} />}
    </footer>
  );
}

function Conta({ estado }: { estado: EstadoIa }) {
  return (
    <p className="ia-conta">
      {estado.email} · {t(`${estado.restantes} de ${estado.limite} perguntas restantes hoje`, `${estado.restantes} of ${estado.limite} questions left today`)}
      {estado.modelo && <> · {t('modelo', 'model')} {estado.modelo.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2')}</>}
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
  const { meta } = useDados();
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
          return (
            <li key={c.id} className={s.classe}>
              <span className="ia-rotulo-consulta">{c.rotulo}</span> {c.objetivo} <span className={`ia-situacao ${s.classe}`}>{s.texto}</span>
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
  const [todas, setTodas] = useState(false);
  const [copiada, setCopiada] = useState<boolean | null>(null);
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
    <figure className={`ia-tab${x.espec.papel !== 'principal' ? ` papel-${x.espec.papel}` : ''}`}>
      {papel && <p className="ia-tab-papel">{papel}</p>}
      <div className="ia-tab-cabeca">
        <figcaption className="ia-tab-titulo"><span className="ia-tab-num">{t('Tabela', 'Table')} {numero}</span> {tab.titulo}</figcaption>
        <div className="ia-tab-acoes">
          <button type="button" className="botao-leve" onClick={copiar} title={t('Cola em linhas e colunas no Word e no Excel', 'Pastes as rows and columns in Word and Excel')}>
            {copiada === true ? t('Copiada ✓', 'Copied ✓') : copiada === false ? t('Não foi possível copiar', 'Could not copy') : t('Copiar tabela', 'Copy table')}
          </button>
          <BotoesExportar nome={`tabela_${numero}_${tab.titulo}`} obter={() => tabelaExportavel(tab, [
            [t('Pergunta', 'Question'), pergunta],
            [t('Dados processados em', 'Data processed on'), meta.geradoEm],
            [t('Exportado em', 'Exported on'), new Date().toISOString()],
          ])} />
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

const TEXTO_CONFERENCIA = (c: 'conferido' | 'divergente' | 'sem_consulta', consulta: string) => ({
  conferido: [t(`conferido em ${consulta}`, `checked in ${consulta}`), t(`O número está na tabela da consulta ${consulta}.`, `The number is in the table of query ${consulta}.`)],
  divergente: [t(`não encontrado em ${consulta}`, `not found in ${consulta}`), t(`O número não aparece na tabela da consulta ${consulta}: confira antes de usar.`, `The number does not appear in the table of query ${consulta}: check before using it.`)],
  sem_consulta: [t('sem consulta correspondente', 'no matching query'), t('A resposta cita uma consulta que não existe ou falhou: confira antes de usar.', 'The answer cites a query that does not exist or failed: check before using it.')],
})[c];

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

function NotasVerificadas({ notas }: { notas: NotaMetodologica[] }) {
  if (!notas.length) return null;
  return (
    <section className="ia-bloco">
      <h4>{t('Notas metodológicas verificadas', 'Verified methodological notes')}</h4>
      <ul className="ia-notas">
        {notas.map((n) => (
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
function Reproducao({ p, consultas, contexto }: { p: RespostaPronta; consultas: ItemConsulta[]; contexto?: ContextoIa }) {
  const { meta } = useDados();
  return (
    <details className="ia-metodo">
      <summary>{t('Detalhes para reprodução: parâmetros, bases e consultas SQL', 'Reproduction details: parameters, datasets and SQL queries')}</summary>
      <dl className="ia-ficha">
        {contexto && <div><dt>{t('Parâmetros', 'Parameters')}</dt><dd>{descreverContexto(contexto, p.periodo)}</dd></div>}
        {p.bases.length > 0 && <div><dt>{t('Versão das bases', 'Dataset versions')}</dt><dd>{p.bases.join('; ')}</dd></div>}
        <div><dt>{t('Dados processados em', 'Data processed on')}</dt><dd>{meta.geradoEm}</dd></div>
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

function Resposta({ p, modo, pergunta, consultas, contexto }: {
  p: RespostaPronta; modo: Modo; pergunta: string; consultas: ItemConsulta[]; contexto?: ContextoIa;
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
    <ul className="ia-destaques" aria-label={t('Números principais', 'Key numbers')}>
      {p.destaques.map((x, k) => {
        const [curto, longo] = TEXTO_CONFERENCIA(x.conferencia, x.d.consulta);
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
          </li>
        );
      })}
    </ul>
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
          {tabelas}
          {graficos}
          {ressalvas}
          {fonte && <p className="ia-fonte">{t('Fonte', 'Source')}: {fonte}</p>}
          {(r.explicacao || blocoLeituras || blocoHipoteses || p.notas.length > 0 || r.metodologia || recorteDe(p).length > 0) && (
            <details className="ia-metodo">
              <summary>{t('Detalhes da análise: dados observados, recorte, metodologia e notas', 'Analysis details: observed data, scope, methodology and notes')}</summary>
              {r.explicacao && <section className="ia-bloco"><h4>{t('Dados observados', 'Observed data')}</h4><TextoRico texto={r.explicacao} /></section>}
              {blocoLeituras}
              {blocoHipoteses}
              <Recorte p={p} />
              <NotasVerificadas notas={p.notas} />
              {r.metodologia && <section className="ia-bloco"><h4>{t('Metodologia', 'Methodology')}</h4><TextoRico texto={r.metodologia} /></section>}
            </details>
          )}
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
            <NotasVerificadas notas={p.notas} />
            <Reproducao p={p} consultas={consultas} contexto={contexto} />
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

function Turno({ i, turno, pronta, meta, resultados, ativo, progresso, ultimo, paineis, feitas, aoEditar, aoUsar, aoCopiar }: {
  i: number; turno: TurnoIa; pronta: RespostaPronta | null; meta?: MetaTurno; resultados: Record<string, Resultado>;
  ativo: boolean; progresso: Progresso | null; ultimo: boolean; paineis: Painel[]; feitas: Set<string>;
  aoEditar: () => void; aoUsar: (s: string) => void; aoCopiar: (texto: string) => Promise<boolean>;
}) {
  const [copiado, setCopiado] = useState(false);
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
  return (
    <article id={`ia-turno-${i}`} className="ia-turno" aria-labelledby={`ia-pergunta-${i}`} aria-busy={ativo}>
      <header className="ia-turno-cabeca">
        <h3 id={`ia-pergunta-${i}`} className="ia-pergunta">{turno.pergunta}</h3>
        {meta && <Chips contexto={meta.contexto} rotulo={t('Contexto usado nesta resposta', 'Context used for this answer')} pequenos periodo={pronta?.periodo} />}
      </header>
      {ativo && meta && <Andamento progresso={progresso} inicio={meta.inicio} />}
      {pronta ? (
        <Resposta p={pronta} modo={meta?.contexto.modo ?? 'rapida'} pergunta={turno.pergunta} contexto={meta?.contexto}
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
          {meta?.fim && (
            <span className="ia-tempo">
              {t(`Concluída em ${segundos} s`, `Finished in ${segundos} s`)} · {contar(nConsultas, t('consulta', 'query'), t('consultas', 'queries'))}
            </span>
          )}
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
  const anos = useMemo(() => [...new Set([
    ...(chavePaineis.includes('trabalho') ? cobertura.rais : []),
    ...(chavePaineis.includes('financas') ? cobertura.dca : []),
  ])].sort((a, b) => a - b), [cobertura, chavePaineis]);
  const anoUrl = Number(busca.get('ano'));
  const ano = anos.includes(anoUrl) ? anoUrl : null;
  const territorio = useMemo(() => territorioDe(f.alvo, f.uf, entes), [f.alvo, f.uf, entes]);
  // modo guardado no navegador (o antigo "estilo técnico" vira análise para pesquisa)
  const [modo, setModo] = useState<Modo>(() => lerModo(lerGuardado('ia-modo') ?? lerGuardado('ia-estilo')));
  const contexto = useMemo<ContextoIa>(() => ({ paineis: chavePaineis.split(',') as Painel[], territorio, ano, modo }), [chavePaineis, territorio, ano, modo]);

  const [estado, setEstado] = useState<EstadoIa | null | undefined>(undefined);
  const [falhaEstado, setFalhaEstado] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [metas, setMetas] = useState<MetaTurno[]>([]);
  const [resultados, setResultados] = useState<Record<string, Resultado>>({});
  const [texto, setTexto] = useState(() => lerGuardado('ia-rascunho', true) ?? '');
  const [rodando, setRodando] = useState<AbortController | null>(null);
  const [progresso, setProgresso] = useState<Progresso | null>(null);
  const [falha, setFalha] = useState<{ mensagem: string; pergunta: string } | null>(null);
  const [status, setStatus] = useState('');
  const [ajustes, setAjustes] = useState(false);
  const [apendice, setApendice] = useState(false);
  const campo = useRef<HTMLTextAreaElement>(null);

  const carregar = () => {
    setFalhaEstado(null);
    estadoIa().then(setEstado, (e) => setFalhaEstado(e instanceof Error ? e.message : String(e)));
  };
  useEffect(carregar, []);
  useEffect(() => guardar('ia-rascunho', texto, true), [texto]);

  const lista = useMemo(() => turnos(mensagens), [mensagens]);
  const feitas = useMemo(() => new Set(lista.map((x) => chavePergunta(x.pergunta))), [lista]);
  const consultas = useMemo(() => consultasDaConversa(mensagens, resultados), [mensagens, resultados]);
  const ultimaCompetencia = cobertura.caged?.ate ?? null;
  // cada resposta pronta para mostrar: conferida com as consultas, com período, território e notas das consultas
  const prontas = useMemo(() => lista.map((turno) => (turno.resposta
    ? prepararResposta(turno.resposta, consultas, {
      doTurno: consultasDoTurno(turno).map((c) => c.rotulo), pergunta: turno.pergunta, cadastro, ultimaCompetencia, fontes: meta.fontes, cobertura,
    })
    : null)), [lista, consultas, cadastro, ultimaCompetencia, meta.fontes, cobertura]);

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

  const bloqueio = estado === undefined
    ? (falhaEstado ? t('A IA está indisponível no momento.', 'The AI is unavailable right now.') : t('Verificando o acesso…', 'Checking access…'))
    : estado === null
      ? t('Entre com um e-mail autorizado para perguntar.', 'Sign in with an authorized email to ask.')
      : !estado.configurada
        ? t('A IA ainda não foi configurada no servidor (falta a chave da Anthropic).', 'The AI is not configured on the server yet (missing Anthropic key).')
        : estado.restantes <= 0
          ? t('Você usou as perguntas de hoje; o limite volta amanhã (horário de Brasília).', 'You have used today’s questions; the limit resets tomorrow (Brasília time).')
          : null;

  async function enviar(bruta: string) {
    const pergunta = bruta.trim();
    if (!pergunta || rodando || bloqueio) return;
    const antes = { mensagens, metas };
    const controle = new AbortController();
    setTexto('');
    setFalha(null);
    setAjustes(false);
    setMetas([...metas, { contexto, inicio: Date.now() }]);
    setRodando(controle);
    setStatus(t('Analisando a pergunta…', 'Analysing the question…'));
    focarCampo();
    try {
      const r = await perguntarIa({
        historico: mensagens, resultados, ultimaCompetencia, pergunta, contexto: contextoParaModelo(contexto), idioma: idioma(),
        paineis: contexto.paineis, sinal: controle.signal, modo: contexto.modo, cobertura,
        aoAtualizar: setMensagens,
        aoResultado: (id, res) => setResultados((m) => ({ ...m, [id]: res })),
        aoProgresso: setProgresso,
        aoRestantes: (n) => setEstado((e) => (e ? { ...e, restantes: n } : e)),
      });
      setMetas((ms) => ms.map((m, i) => (i === ms.length - 1 ? { ...m, fim: Date.now(), desfecho: r.desfecho, detalhe: r.detalhe } : m)));
      setStatus(r.desfecho === 'resposta' || r.desfecho === 'texto'
        ? t('Resposta pronta.', 'Answer ready.')
        : t('A pergunta terminou sem uma resposta completa.', 'The question ended without a complete answer.'));
    } catch (e) {
      // um histórico pela metade invalidaria as próximas perguntas: volta ao estado de antes
      setMensagens(antes.mensagens);
      setMetas(antes.metas);
      // a pergunta volta para o campo, sem apagar o que tenha sido escrito enquanto ela rodava
      setTexto((atual) => (atual.trim() ? atual : pergunta));
      if (foiCancelado(e)) setStatus(t('Pergunta cancelada. Ela voltou para o campo de texto.', 'Question cancelled. It is back in the text box.'));
      else setFalha({ mensagem: e instanceof Error ? e.message : String(e), pergunta });
    } finally {
      setRodando(null);
      setProgresso(null);
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
  const novaConversa = () => {
    if (rodando) return;
    setMensagens([]);
    setMetas([]);
    setResultados({});
    setFalha(null);
    setStatus(t('Nova conversa.', 'New conversation.'));
    focarCampo();
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
  const definirModo = (m: Modo) => {
    setModo(m);
    guardar('ia-modo', m);
    guardar('ia-estilo', null);
  };

  const conversa = lista.length > 0;
  const ultimoContexto = metas.at(-1)?.contexto;
  const contextoMudou = conversa && !rodando && !!ultimoContexto && !mesmoContexto(ultimoContexto, contexto);
  const exemplo = conversa ? t('Pergunte mais sobre isso…', 'Ask a follow-up…') : exemploPergunta(contexto.paineis, territorio, cobertura);
  const painelAjustes = ajustes && (
    <Ajustes paineis={paineis} alternarPainel={alternarPainel} travarPaineis={conversa || !!rodando} anos={anos} ano={ano}
      definirAno={definirAno} />
  );
  const seletorModo = <SeletorModo modo={modo} definir={definirModo} travado={!!rodando} />;
  const acesso = (
    <>
      {falhaEstado && (
        <p className="erro" role="alert">{falhaEstado} <button type="button" className="botao-leve" onClick={carregar}>{t('Tentar de novo', 'Try again')}</button></p>
      )}
      {estado === null && (
        <div className="cartao ia-entrar">
          <p>{t('O acesso é restrito a e-mails autorizados pelo LAPAM.', 'Access is restricted to emails authorized by LAPAM.')}</p>
          <a className="botao" href="/api/ia/entrar">{t('Entrar', 'Sign in')}</a>
        </div>
      )}
    </>
  );
  const compositor = (
    <Compositor valor={texto} mudar={setTexto} enviar={enviar} cancelar={cancelar} ocupado={!!rodando} bloqueio={bloqueio}
      exemplo={exemplo} grande={!conversa} campo={campo} />
  );
  const aviso = falha && (
    <div className="ia-falha" role="alert">
      <p><strong>{t('Não foi possível concluir a pergunta.', 'The question could not be completed.')}</strong> {falha.mensagem}</p>
      <p className="ia-nota">{t('A pergunta voltou para o campo de texto; nada foi perdido.', 'The question is back in the text box; nothing was lost.')}</p>
      <button type="button" className="botao" onClick={() => enviar(falha.pergunta)} disabled={!!bloqueio}>{t('Tentar de novo', 'Try again')}</button>
    </div>
  );

  return (
    <div className="ia">
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {!conversa ? (
        <section className="ia-inicio" aria-labelledby="ia-titulo">
          <p className="ia-sobretitulo">{t('Pergunte aos dados', 'Ask the data')} · {t('análise com IA', 'AI analysis')}</p>
          <h2 id="ia-titulo" className="ia-titulo">{titulo(contexto.paineis)}</h2>
          <p className="ia-descricao">{descricao(contexto.paineis)}</p>
          <BarraContexto rotulo={t('Contexto', 'Context')} contexto={contexto} aberto={ajustes} alternar={() => setAjustes(!ajustes)} />
          {painelAjustes}
          {acesso}
          {seletorModo}
          {compositor}
          {aviso}
          <Sugestoes lista={sugestoes(contexto.paineis, territorio, cobertura, ano)} aoEscolher={usarTexto} />
          {descreverCobertura(contexto.paineis, cobertura).length > 0 && (
            <section className="ia-cobertura" aria-labelledby="ia-cobertura-titulo">
              <h3 id="ia-cobertura-titulo" className="ia-secao">{t('Dados disponíveis', 'Available data')}</h3>
              <ul>{descreverCobertura(contexto.paineis, cobertura).map((l) => <li key={l}>{l}</li>)}</ul>
            </section>
          )}
          <Rodape estado={estado} paineis={contexto.paineis} conta />
        </section>
      ) : (
        <>
          <header className="ia-cabeca">
            <div>
              <h2 className="titulo-pagina">{t('Pergunte aos dados', 'Ask the data')}</h2>
              {estado && <Conta estado={estado} />}
            </div>
            <div className="ia-cabeca-acoes">
              <div className="ia-exportar" role="group" aria-label={t('Exportar a conversa', 'Export the conversation')}>
                <button type="button" className="botao-leve" disabled={!!rodando || !estado}
                  onClick={() => imprimirPdf(lista, metas, prontas, resultados, { email: estado?.email ?? '', paineis: contexto.paineis, apendice, geradoEm: meta.geradoEm })}
                  title={t('Abre a impressão do navegador; escolha "Salvar como PDF"', 'Opens the browser print dialog; choose "Save as PDF"')}>
                  {t('Exportar PDF', 'Export PDF')}
                </button>
                <button type="button" className="botao-leve" disabled={!!rodando} onClick={() => baixarExcel(lista, metas, prontas, resultados, contexto.paineis, apendice)}
                  title={t('Resumo da conversa e uma aba por tabela, com números e metadados', 'Conversation summary and one sheet per table, with numbers and metadata')}>
                  {t('Exportar Excel', 'Export Excel')}
                </button>
                <label className="caixa ia-apendice">
                  <input type="checkbox" checked={apendice} onChange={(e) => setApendice(e.target.checked)} />
                  {' '}{t('incluir apêndice de reprodução', 'include reproduction appendix')}
                </label>
              </div>
              <button type="button" className="botao-leve" disabled={!!rodando} onClick={novaConversa}>{t('Nova conversa', 'New conversation')}</button>
            </div>
            <p className="ia-nota ia-exportar-nota">
              {t('Cada resposta sai no modo em que foi feita: a resposta rápida com o essencial; a análise para pesquisa com recorte, tabelas completas, análise, metodologia e fontes.',
                'Each answer is exported in the mode it was made: the quick answer with the essentials; the research analysis with scope, complete tables, analysis, methodology and sources.')}
              {apendice && ` ${t('O apêndice de reprodução traz o SQL e o histórico de todas as consultas, inclusive as sem resultado e as refeitas.', 'The reproduction appendix adds the SQL and history of all queries, including empty and redone ones.')}`}
            </p>
          </header>
          <div className="ia-conversa">
            {lista.map((turno, i) => (
              <Turno key={i} i={i} turno={turno} pronta={prontas[i]} meta={metas[i]} resultados={resultados}
                ativo={!!rodando && i === lista.length - 1} progresso={progresso} ultimo={i === lista.length - 1} paineis={contexto.paineis}
                feitas={feitas} aoEditar={editarUltima} aoUsar={usarTexto} aoCopiar={copiar} />
            ))}
            {aviso}
          </div>
          <div className={`ia-rodape${ajustes ? ' aberto' : ''}`}>
            {contextoMudou && (
              <p className="ia-mudou" role="status">
                {t(`As próximas respostas vão usar: ${descreverContexto(contexto)}. As respostas anteriores mantêm o recorte que usaram.`,
                  `The next answers will use: ${descreverContexto(contexto)}. Previous answers keep the scope they used.`)}
              </p>
            )}
            <BarraContexto rotulo={t('Próximas respostas', 'Next answers')} contexto={contexto} aberto={ajustes} alternar={() => setAjustes(!ajustes)} />
            {painelAjustes}
            {acesso}
            {seletorModo}
            {compositor}
          </div>
          <Rodape estado={estado} paineis={contexto.paineis} conta={false} />
        </>
      )}
    </div>
  );
}
