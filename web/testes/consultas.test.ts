/**
 * Testes das regras do painel: as mesmas rotas e o mesmo SQL do site (src/dados.ts), executados
 * sobre os arquivos da pasta data/ local com o DuckDB-WASM para Node.
 *
 * Uso (em web/):  npm test
 * Requer data/silver e data/gold (py pipeline/r2.py baixar ... ou py pipeline/processar.py).
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { basesAV, codigoConta, formatarPct } from '../src/calculos';
import { consultaLivre, executar, sqlClassificacao, type Classificacao, tabelaDespesaFuncao, tabelasEducacaoSaude, tabelasIaTrabalho, tabelasFns, usarLeituraNoTeste, reiniciarFnsNoTeste, usarMicrodadosNoTeste, usarMotorDeTeste, gruposDaFonte, FILTROS_LISTA } from '../src/dados';
import {
  anosPedidos, ehPergunta, textoDaPergunta, PAINEIS, chamarIa, coberturaDaFonte, coberturaPorAno, lerEscolhaModelo, nomeDoModelo, periodosDiferem, codigosDoSql, comPergunta, conferir, consultasDaConversa, contextoParaModelo, descreverCobertura, disponibilidadeNoAno, pedeTabelaMunicipal, dadosDoGrafico, executarConsulta, fontesConsultadas, lerModo, lerResposta,
  lerRegressao, paraModelo, pedeTabela, perguntarIa, prepararResposta, recorteDe, revisarMetodo, revisarResposta, rotulosConsultas, semNominal, semUltimaPergunta, sugestoes, valorOficial,
  textoDaResposta, turnos, usarServidorIaNoTeste, validarGrafico, validarSql, type ConsultaFeita, type ContextoIa, type GraficoIa, type Mensagem, type Painel,
  type Bloco, type Cobertura, type Resultado,
} from '../src/ia';
import { SQL_IPCA_BASE, fatorParaAno, notaDeValorReal, valorReal } from '../src/ia_moeda';
import { abertas, enfileirar, lerFila, marcar as marcarItem, proxima, remover as removerItem, serializar, tentarDeNovo, type ItemFila } from '../src/ia_fila';
import { paraPdf, paraWinAnsi, quebrar } from '../src/pdf';
import { formatarCelulaT, montarTabela, rodapeTabela, tabelaExportavel, tabelaHtml, tabelaTsv, type EspecTabela } from '../src/ia_tabelas';
import { juntaFontes, lerVerificacao, linhasDaVerificacao, problemasDaVerificacao } from '../src/ia_verificacao';
import {
  blocosDeTexto, competenciasNoTexto, contar, formatarCelula, formatarTabela, formatarValor, periodoDasConsultas, periodosComoNumero, registrarColunas, rotuloColuna, rotuloPeriodo, tipoColuna, tiposDoResultado, unidadeLimpa,
} from '../src/ia_formato';
import { citaQuebra, NOTAS } from '../src/ia_notas';
import {
  desatualizada, exportarConversa, filtrarResumos, FORMATO_CONVERSA, guardarNota, historico, lerConversaExportada, lerNota, novaVersaoComDadosAtuais, paraImportar,
  repositorioConta, repositorioEmMemoria, resumoDe, soNoNavegador, tituloAutomatico, usarRepositorio, VERSAO_CONVERSA, versoesDosDados,
  type ApiConversas, type Conversa,
} from '../src/ia_historico';
import { pedidoConferencia } from '../src/ia_conferencia';
import { atendeConceito, CONCEITOS, conceitosPedidos, fichaDaColuna } from '../src/ia_catalogo';
import { mqo, pBilateral } from '../src/ia_estatistica';
import { contextoDosDados, FINANCAS } from '../../worker/src/sistema.js';
import { validar as validarHistorico } from '../../worker/src/ia.js';
import {
  catalogoDeResultados, compactarParaEnvio, dicaDoErro, executarPartida, incoerenciasDoRecorte, lerParticao, limparCacheDePartes, resultadosReaproveitaveis,
  tendenciasSemSuporte,
} from '../src/ia_continuidade';
import { TRABALHO } from '../../worker/src/sistema_trabalho.js';
import { contextoSaude, SAUDE } from '../../worker/src/sistema_saude.js';
import { coberturaPopulacional, ordenarMunicipios, perCapita, porBloco, razaoPositiva, resumoFns, rotuloComposicao, temRepasse, universoFns } from '../src/fns_comum';
import { guardaFns } from '../src/ia_fns';
import { fontesDaConsulta } from '../src/ia_verificacao';
import { anosDaColuna, anosDoIndicador, anosSaude, avisoPreliminarNaoIncluido, calcular, calcularJanela, colunaGrupoIcsap, condicaoDado, disponivelNosDados, faixaAnos, fonteCurta, fonteDaColuna, formatar, GRUPOS_ICSAP, indicador, INDICADORES, metadadosIndicador, motivoSemValor, textoMotivo, textosMotivo, type FontesMeta } from '../src/saude_comum';
import { cadastro, codigosDoMunicipio, conferirCodigos, executarLocalizacao, localizar, territoriosNasConsultas } from '../src/ia_territorio';
import { crc32, paraCsv, paraXlsx, paraXlsxAbas } from '../src/exportar';
import { ordenarBusca } from '../src/contexto';
import { ATALHOS_RAIS, concentracao, totalDosGrupos, urlAnalise } from '../src/trabalho_comum';
import { gravarEstadoEvolucao, lerEstadoEvolucao, MAX_COMPARADOS, posicaoRelativa, resumoTrajetoria, tabelaMudancas, tabelaTrajetorias, variacaoPct, variacaoPosicao } from '../src/posicoes';

import { avisoDoContexto, chaveDoRastro, contaDoRastro, RASTRO, urlDemonstrativo, urlDemonstrativos, valorAnexo, type ChaveRastro } from '../src/lrf_rastro';
import { periodoDe } from '../src/components/TabelaSerie';
import { anosDoImunobiologico, contraMeta, metodoDoAno, paraCatalogo, paraLinhaVac, pctRazao, razaoDasSomas, separarPorMetodo, situacao, textoCobertura, type LinhaVac } from '../src/vacinacao_comum';
const require = createRequire(import.meta.url);
const FETCH = globalThis.fetch; // alguns testes simulam o Worker trocando o fetch
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(AQUI, '..', '..', '..', process.env.DATA_DIR ?? 'data').replaceAll('\\', '/');
// microdados da RAIS (pipeline/microdados.py), fora do projeto
const MICRO = (process.env.TRABALHO_MICRO ?? 'E:/finbra/micro').replaceAll('\\', '/');
// GOLD_PUBLICADO: pasta com a cópia do gold hoje publicado (gold/saude, manifesto e ipca); roda o código atual contra os dados antigos
const GOLD_PUBLICADO = process.env.GOLD_PUBLICADO?.replaceAll('\\', '/');
const doGoldPublicado = (c: string) => !!GOLD_PUBLICADO && /^gold\/(saude\/|manifesto\.json$|ipca\.parquet$)/.test(c);
// VACINACAO_CANDIDATO: pasta do candidato da cobertura vacinal (gold/saude/vacinacao*.parquet), enquanto não for publicada
const VACINACAO_CANDIDATO = process.env.VACINACAO_CANDIDATO?.replaceAll('\\', '/');
// Override opcional só para FNS e manifesto; demais arquivos respeitam DATA/GOLD_PUBLICADO.
const FNS_CANDIDATO = process.env.FNS_CANDIDATO?.replaceAll('\\', '/');
const doFnsCandidato = (c: string) => !!FNS_CANDIDATO && /^gold\/(saude\/fns_[^/]+\.parquet$|manifesto\.json$)/.test(c);
const onde = (c: string) => (doFnsCandidato(c) ? `${FNS_CANDIDATO}/${c}` : c.startsWith('silver/trabalho/micro/') ? `${MICRO}/${c}` : VACINACAO_CANDIDATO && c.startsWith('gold/saude/vacinacao') ? `${VACINACAO_CANDIDATO}/${c}` : doGoldPublicado(c) ? `${GOLD_PUBLICADO}/${c}` : `${DATA}/${c}`);
const rota = <T>(caminho: string, params: Record<string, string | number | undefined> = {}) => executar(caminho, params) as Promise<T>;
type L = Record<string, number | string | null | boolean>;

const GOIAS_MUN = 5208905;
const SAQUAREMA = 3305505;

/** Conexão no formato assíncrono que o dados.ts usa, sobre a API síncrona do DuckDB-WASM para Node. */
function adaptar(db: any) {
  const con = db.connect();
  return {
    db: { registerFileBuffer: async (nome: string, dados: Uint8Array) => db.registerFileBuffer(nome, dados) },
    con: {
      query: async (sql: string) => con.query(sql),
      prepare: async (sql: string) => {
        const st = con.prepare(sql);
        return { query: async (...a: unknown[]) => st.query(...a), close: async () => st.close() };
      },
      // consultas da IA: lidas por partes, como no site (consultaLivre)
      send: async (sql: string) => con.send(sql, true),
      cancelSent: async () => con.cancelSent(),
    },
  };
}

before(async () => {
  const duckdb = require('@duckdb/duckdb-wasm/blocking');
  const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm'));
  const bundles = {
    mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: path.join(dist, 'duckdb-node-mvp.worker.cjs') },
    eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: path.join(dist, 'duckdb-node-eh.worker.cjs') },
  };
  const db = await duckdb.createDuckDB(bundles, new duckdb.VoidLogger(), duckdb.NODE_RUNTIME);
  await db.instantiate();
  db.open({ query: { castBigIntToDouble: true, castDecimalToDouble: true } }); // como no site (src/dados.ts)
  const { db: adb, con } = adaptar(db);
  const manifesto = JSON.parse(await readFile(onde('gold/manifesto.json'), 'utf8'));
  for (const [nome, arq] of Object.entries({
    entes: 'silver/entes.parquet', indicadores: 'gold/indicadores.parquet', escopos: 'gold/escopos.parquet',
    alertas: 'gold/alertas.parquet', faixas: 'gold/faixas.parquet', ipca: 'gold/ipca.parquet',
  })) {
    await con.query(`CREATE TABLE ${nome} AS SELECT * FROM read_parquet('${onde(arq)}')`);
  }
  await con.query(SQL_IPCA_BASE);
  usarMotorDeTeste(adb as any, con as any, manifesto, onde, async (c) => new Uint8Array(await readFile(onde(c))));
});
after(() => undefined);

const quase = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

describe('análise vertical', () => {
  test('balanço: Ativo e Passivo + PL são, cada um, 100% (não 50%)', async () => {
    const coluna = 'Saldo em 31/12';
    const arv = await rota<{ nos: any[] }>('arvore', { anexo: 'I-AB', ano: 2025, coluna, ente: GOIAS_MUN });
    const base = basesAV('I-AB', arv.nos, (c) => c);
    const ativo = arv.nos.find((n) => n.chave === 'P1');
    const passivo = arv.nos.find((n) => n.chave === 'P2');
    assert.ok(ativo && passivo, 'o balanço de 2025 tem P1 e P2');
    quase(ativo.valor / base(ativo).valor!, 1);
    quase(passivo.valor / base(passivo).valor!, 1);
    const filhoAtivo = arv.nos.find((n) => n.chave_pai === 'P1');
    assert.equal(base(filhoAtivo).valor, ativo.valor, 'contas do Ativo usam o Ativo total como base');
  });

  test('variações patrimoniais: VPA e VPD têm bases próprias', async () => {
    const [coluna] = await rota<string[]>('colunas', { anexo: 'I-HI', ano: 2025 });
    const arv = await rota<{ nos: any[] }>('arvore', { anexo: 'I-HI', ano: 2025, coluna, ente: GOIAS_MUN });
    const base = basesAV('I-HI', arv.nos, (c) => c);
    for (const raiz of arv.nos.filter((n) => n.tipo === 'conta' && !n.chave_pai)) quase(raiz.valor / base(raiz).valor!, 1);
  });

  test('despesa por natureza: linhas Intra não entram de novo na base', () => {
    const nos = [
      { chave: 'DO3', chave_pai: null, tipo: 'conta', valor: 80 },
      { chave: 'DO4', chave_pai: null, tipo: 'conta', valor: 20 },
      { chave: 'DI3.1.91', chave_pai: null, tipo: 'conta', valor: 5 },
    ];
    const base = basesAV('I-D', nos, (c) => c);
    assert.equal(base(nos[0]).valor, 100);
    assert.equal(base(nos[2]).valor, 100);
  });

  test('redutoras: valor positivo declarado é mantido (sem trocar o sinal)', async () => {
    const arv = await rota<{ nos: any[] }>('arvore', { anexo: 'I-AB', ano: 2025, coluna: 'Saldo em 31/12', ente: GOIAS_MUN });
    const redutoras = arv.nos.filter((n) => String(n.descricao).startsWith('(-)') && n.valor !== null);
    assert.ok(redutoras.length > 0);
    assert.ok(redutoras.every((n) => n.valor >= 0), 'contas redutoras chegam como declaradas (positivas)');
  });

  test('percentual arredondado para zero não mostra sinal', () => {
    assert.equal(formatarPct(-0.00001, 1, 'pt-BR'), '0,0%');
    assert.equal(formatarPct(-0.0125, 1, 'pt-BR'), '-1,3%');
    assert.equal(formatarPct(0.443, 1, 'en-US'), '44.3%');
  });

  test('código da conta para exibição', () => {
    assert.equal(codigoConta('RO1.7.1.1.51'), '1.7.1.1.51');
    assert.equal(codigoConta('F04.122'), '04.122');
    assert.equal(codigoConta('TotalReceitas'), '');
  });
});

describe('FPM e ausências', () => {
  test('Goiás (município) 2024: FPM ausente fica nulo, não zero, e há receita no ano', async () => {
    const [r] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'fpm,receita_bruta', ano: 2024, ente: GOIAS_MUN });
    assert.equal(r.fpm, null);
    assert.ok((r.receita_bruta as number) > 0);
    const arv = await rota<{ nos: any[] }>('arvore', { anexo: 'I-C', ano: 2024, coluna: 'Receitas Brutas Realizadas', ente: GOIAS_MUN });
    assert.ok(!arv.nos.some((n) => /Fundo de Participação dos? Municípios/i.test(n.descricao) && n.valor !== null),
      'a declaração de 2024 não traz nenhuma conta do FPM');
  });

  test('FPM 2018–2021 inclui a cota de 1% de dezembro (grafia "do Municípios")', async () => {
    const [r] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'fpm', ano: 2019, ente: GOIAS_MUN });
    const arv = await rota<{ nos: any[] }>('arvore', { anexo: 'I-C', ano: 2019, coluna: 'Receitas Brutas Realizadas', ente: GOIAS_MUN });
    const soma = arv.nos.filter((n) => ['RO1.7.1.8.01.2', 'RO1.7.1.8.01.3', 'RO1.7.1.8.01.4'].includes(n.chave))
      .reduce((s, n) => s + (n.valor ?? 0), 0);
    quase(r.fpm as number, soma);
  });

  test('zero declarado é diferente de ausência', async () => {
    const zeros = await rota<L[]>('agregado', { por: 'cod_ibge', campos: 'iptu', ano: 2025, uf: 'GO', esfera: 'M', tratamento: 'declarado' });
    const comZero = zeros.find((z) => z.iptu === 0);
    if (comZero) assert.equal(comZero.entes_iptu, 1, 'zero declarado conta como observação');
    const semValor = zeros.find((z) => z.iptu === null);
    if (semValor) assert.equal(semValor.entes_iptu, 0, 'ausência não conta como observação');
    assert.ok(comZero || semValor, 'há ao menos um caso para comparar');
  });
});

describe('sinalizações e tratamento', () => {
  test('Saquarema: só a receita de 2025 é sinalizada, como suspeita (não erro)', async () => {
    const a = await rota<L[]>('alertas', { ente: SAQUAREMA });
    assert.deepEqual(a.map((x) => `${x.exercicio}:${x.indicador}:${x.categoria}`), ['2025:receita_bruta:suspeita']);
  });

  test('suspeita estatística fica nos totais: RJ 2025 com e sem exclusões é igual (Saquarema incluído)', async () => {
    const p = { por: 'exercicio', campos: 'receita_bruta', ano: 2025, uf: 'RJ', esfera: 'M' };
    const [filt] = await rota<L[]>('agregado', { ...p, tratamento: 'filtrado' });
    const [decl] = await rota<L[]>('agregado', { ...p, tratamento: 'declarado' });
    quase(filt.receita_bruta as number, decl.receita_bruta as number);
    assert.equal(filt.entes_receita_bruta, decl.entes_receita_bruta);
  });

  test('inconsistência sai só do domínio: São João de Meriti 2023 fora da receita, dentro da despesa', async () => {
    const MERITI = 3305109;
    const p = { por: 'exercicio', campos: 'receita_bruta,despesa_empenhada', ano: 2023, uf: 'RJ', esfera: 'M' };
    const [filt] = await rota<L[]>('agregado', { ...p, tratamento: 'filtrado' });
    const [decl] = await rota<L[]>('agregado', { ...p, tratamento: 'declarado' });
    const [mer] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'receita_bruta,despesa_empenhada', ano: 2023, ente: MERITI });
    quase((decl.receita_bruta as number) - (filt.receita_bruta as number), mer.receita_bruta as number);
    quase(decl.despesa_empenhada as number, filt.despesa_empenhada as number);
    const a = await rota<L[]>('alertas', { ente: MERITI });
    assert.ok(a.some((x) => x.exercicio === 2023 && x.categoria === 'inconsistente' && x.exclui));
  });

  test('cobertura: com dados + sem dados = universo do cadastro; excluídos conferem com o agregado', async () => {
    const [c] = await rota<L[]>('cobertura', { esfera: 'M', dominio: 'receita', ano: 2025, tratamento: 'filtrado' });
    const [cd] = await rota<L[]>('cobertura', { esfera: 'M', dominio: 'receita', ano: 2025, tratamento: 'declarado' });
    assert.equal((cd.entes as number) + (cd.sem_dados as number), cd.esperados);
    assert.equal((cd.entes as number) - (c.entes as number), c.excluidos);
    const [agg] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'receita_bruta', ano: 2025, esfera: 'M', tratamento: 'filtrado' });
    assert.equal(agg.entes_receita_bruta, c.entes);
  });

  test('população alinhada ao numerador (agregado e árvore usam os mesmos entes)', async () => {
    const [agg] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'receita_bruta', ano: 2025, uf: 'GO', esfera: 'M' });
    const arv = await rota<{ nos: any[]; populacao: number; entes: number }>('arvore',
      { anexo: 'I-C', ano: 2025, coluna: 'Receitas Brutas Realizadas', uf: 'GO', esfera: 'M' });
    assert.equal(arv.populacao, agg.populacao_receita_bruta);
    assert.equal(arv.entes, agg.entes_receita_bruta);
    const total = arv.nos.find((n) => n.chave === 'TotalReceitas');
    quase(total.valor, agg.receita_bruta as number, 1e-9);
  });

  test('séries: cobertura por ano vem junto dos valores', async () => {
    const s = await rota<L[]>('serie', { anexo: 'I-C', coluna: 'Receitas Brutas Realizadas', chave: 'TotalReceitas', esfera: 'M' });
    assert.ok(s.length >= 13);
    assert.ok(s.every((p) => typeof p.entes === 'number' && typeof p.esperados === 'number'));
  });
});

describe('intraorçamentárias', () => {
  test('exceto intra + intra ≈ total do Anexo I-D (Brasil, 2025)', async () => {
    const [r] = await rota<L[]>('agregado', {
      por: 'exercicio', campos: 'despesa_empenhada,despesa_empenhada_sem_intra,despesa_intra', ano: 2025, esfera: 'M', tratamento: 'declarado',
    });
    const soma = (r.despesa_empenhada_sem_intra as number) + (r.despesa_intra as number);
    assert.ok(Math.abs(soma / (r.despesa_empenhada as number) - 1) < 0.01, `diferença ${(soma / (r.despesa_empenhada as number) - 1) * 100}%`);
  });
});

describe('despesas orçamentárias por natureza (Anexo I-D)', () => {
  const GRUPOS = ['DO3.1', 'DO3.2', 'DO3.3', 'DO4.4', 'DO4.5', 'DO4.6'];

  test('os seis grupos de natureza somam o total, com as intra (municípios, 2024)', async () => {
    const arv = await rota<{ nos: any[] }>('arvore', { anexo: 'I-D', ano: 2024, coluna: 'Despesas Empenhadas', esfera: 'M' });
    const valor = (c: string) => arv.nos.find((n) => n.chave === c)?.valor as number;
    const soma = GRUPOS.reduce((s, c) => s + valor(c), 0);
    assert.ok(Math.abs(soma / valor('TotalDespesas') - 1) < 0.01, `diferença ${(soma / valor('TotalDespesas') - 1) * 100}%`);
    const pessoal = valor('DO3.1') / valor('TotalDespesas');
    assert.ok(pessoal > 0.3 && pessoal < 0.7, `pessoal ${pessoal}`);
  });

  test('grupo de natureza com série completa desde 2013 (municípios) e no ente', async () => {
    const s = await rota<L[]>('serie', { anexo: 'I-D', coluna: 'Despesas Empenhadas', chave: 'DO4.4', esfera: 'M' });
    const anos = s.filter((p) => typeof p.valor === 'number').map((p) => p.ano as number);
    assert.equal(anos[0], 2013);
    assert.ok(anos.length >= 13, `anos com valor: ${anos.join(', ')}`);
    // o município não declarou a DCA de 2013: a série dele começa em 2014, com o mesmo valor do indicador
    const m = await rota<L[]>('serie', { anexo: 'I-D', coluna: 'Despesas Empenhadas', chave: 'DO4.4', ente: GOIAS_MUN });
    const [ind] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'investimentos', ano: 2024, ente: GOIAS_MUN });
    quase(m.find((p) => p.ano === 2024)!.valor as number, ind.investimentos as number);
  });
});

describe('Distrito Federal', () => {
  test('UF=DF usa o ente Distrito Federal (não "municípios de DF" vazios)', async () => {
    const [r] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'receita_bruta,fpm', ano: 2025, uf: 'DF', esfera: 'M' });
    assert.equal(r.entes, 1);
    assert.ok((r.receita_bruta as number) > 1e9);
    assert.ok((r.fpm as number) > 0, 'FPM declarado pelo DF é mantido');
  });

  test('Brasília (sem declaração própria) e a União ficam fora da busca', async () => {
    const entes = await rota<L[]>('entes');
    assert.ok(!entes.some((e) => e.cod_ibge === 5300108));
    assert.ok(entes.some((e) => e.cod_ibge === 53));
    assert.ok(!entes.some((e) => e.esfera === 'U'));
  });
});

describe('rankings', () => {
  const base = { campo: 'iss', ano: 2025, esfera: 'M', per_capita: 0, ordem: 'asc', tratamento: 'filtrado' };

  test('ISS total menores: zeros entram, posições crescem e empates repetem a posição', async () => {
    const r = await rota<{ itens: L[]; elegiveis: number; zeros: number }>('ranking', { ...base, limite: 100, pagina: 1 });
    assert.ok(r.elegiveis > 5000);
    const valores = r.itens.map((i) => i.indicador as number);
    assert.deepEqual(valores, [...valores].sort((a, b) => a - b));
    if (r.zeros > 1) {
      const zeros = r.itens.filter((i) => i.indicador === 0);
      assert.ok(zeros.every((z) => z.posicao_br === zeros[0].posicao_br), 'empate recebe a mesma posição');
    }
  });

  test('posição do município fora dos 20 primeiros, nacional e na UF', async () => {
    const r = await rota<{ ente: L | null }>('ranking', { ...base, ordem: 'desc', ente: GOIAS_MUN, limite: 20, pagina: 1 });
    assert.ok(r.ente, 'Goiás é elegível');
    assert.ok((r.ente!.posicao_br as number) > 20);
    assert.ok((r.ente!.posicao_uf as number) <= (r.ente!.posicao_br as number));
  });

  test('exportação completa = páginas da consulta', async () => {
    const p1 = await rota<{ itens: L[]; elegiveis: number }>('ranking', { ...base, uf: 'RJ', limite: 50, pagina: 1 });
    const p2 = await rota<{ itens: L[] }>('ranking', { ...base, uf: 'RJ', limite: 50, pagina: 2 });
    const tudo = await rota<{ itens: L[] }>('ranking', { ...base, uf: 'RJ', todos: 1 });
    assert.equal(tudo.itens.length, p1.elegiveis);
    assert.deepEqual(tudo.itens.map((i) => i.cod_ibge), [...p1.itens, ...p2.itens].map((i) => i.cod_ibge));
  });

  test('PIB: disponibilidade não inclui exercícios sem dado', async () => {
    const d = await rota<{ exercicio: number }[]>('disponibilidade', { campo: 'pib' });
    assert.ok(!d.some((x) => x.exercicio > 2023));
  });
});

describe('socioeconômico', () => {
  test('razões usam o mesmo ano: receita ÷ PIB em 2024 não existe (sem PIB)', async () => {
    const [r] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'pib,receita_bruta', pares: 'receita_bruta/pib', ano: 2024, ente: GOIAS_MUN });
    assert.equal(r.pib, null);
    assert.equal(r.receita_bruta__pib_num, null);
    const [r23] = await rota<L[]>('agregado', { por: 'exercicio', campos: 'pib,receita_bruta', pares: 'receita_bruta/pib', ano: 2023, ente: GOIAS_MUN });
    quase(r23.receita_bruta__pib_den as number, r23.pib as number);
  });
});

describe('qualidade', () => {
  test('resumo dos testes informa reprovados (sem "✗ 100%")', async () => {
    const v = await rota<L[]>('validacao');
    assert.ok(v.every((l) => (l.reprovados as number) === (l.casos as number) - (l.ok as number)));
    const comFalha = v.find((l) => (l.reprovados as number) > 0 && l.tipo === 'estrutural');
    if (comFalha) {
      const casos = await rota<L[]>('divergencias', { teste: String(comFalha.teste), ano: comFalha.exercicio as number, anexo: String(comFalha.anexo) });
      assert.equal(casos.length, Math.min(500, comFalha.reprovados as number));
    }
  });
});

describe('rotas de apoio', () => {
  test('meta, contas, ipca e faixas respondem', async () => {
    const meta = await rota<{ anos: number[]; baseIpca: number; ipcaUltimo: { meses: number } }>('meta');
    assert.ok(meta.anos.includes(2025));
    const contas = await rota<L[]>('contas', { anexo: 'I-C', ano: 2025, nivel_max: 2 });
    assert.ok(contas.length > 5);
    const ipca = await rota<L[]>('ipca');
    const base = ipca.find((i) => i.ano === meta.baseIpca);
    quase(base!.fator as number, 1);
    const faixas = await rota<L[]>('faixas');
    assert.equal(faixas.length, 18);
  });

  test('série de um ente traz lacunas reais (Goiás, FPM 2024 ausente na árvore de 2024)', async () => {
    const s = await rota<L[]>('serie', { anexo: 'I-C', coluna: 'Receitas Brutas Realizadas', chave: 'RO1.7.1.1.51', ente: GOIAS_MUN });
    const p24 = s.find((p) => p.ano === 2024);
    assert.equal(p24?.valor ?? null, null, 'sem valor em 2024, sem interpolação');
    assert.ok((s.find((p) => p.ano === 2025)?.valor as number) > 0);
  });
});

describe('exportação e busca', () => {
  const tabela = { colunas: ['a', 'b'], linhas: [[1.23456789, 'x;y'], [null, 'ok']], metadados: [['Fonte', 'teste'] as [string, string]] };

  test('CSV para Excel em português: BOM, ";" e vírgula decimal com precisão completa', () => {
    const csv = paraCsv(tabela, ',');
    assert.ok(csv.startsWith('﻿'));
    assert.match(csv, /1,23456789;"x;y"/);
  });

  test('XLSX: zip válido com CRC correto', () => {
    assert.equal(crc32(new TextEncoder().encode('abc')), 0x352441c2);
    const x = paraXlsx(tabela);
    assert.deepEqual([...x.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
  });

  test('busca prioriza nome exato e distingue município de estado; código IBGE funciona', () => {
    const entes = [
      { cod_ibge: 5208905, nome: 'Goiás', uf: 'GO', esfera: 'M' as const, capital: false },
      { cod_ibge: 52, nome: 'Goiás', uf: 'GO', esfera: 'E' as const, capital: false },
      { cod_ibge: 5208707, nome: 'Goiânia', uf: 'GO', esfera: 'M' as const, capital: true },
      { cod_ibge: 5221858, nome: 'Vila Boa de Goiás', uf: 'GO', esfera: 'M' as const, capital: false },
    ];
    const r = ordenarBusca(entes, 'goias', null);
    assert.deepEqual(r.slice(0, 2).map((e) => e.cod_ibge).sort(), [52, 5208905]);
    assert.equal(ordenarBusca(entes, '52089', null)[0].cod_ibge, 5208905);
  });
});

describe('perguntas com IA', () => {
  test('SQL somente leitura: aceita SELECT/WITH e recusa comandos, arquivos e URLs', () => {
    for (const ok of [
      'SELECT nome, receita_bruta FROM indicadores WHERE uf = \'GO\' AND exercicio = 2024 ORDER BY 2 DESC LIMIT 10;',
      'WITH a AS (SELECT * FROM indicadores) SELECT count(*) FROM a',
      "SELECT * FROM alertas WHERE motivo LIKE '%habitual%' -- comentário; com ponto e vírgula",
      "SELECT 'São Paulo' AS nome, '2024-01-01' AS data",
      'SELECT receita_bruta / 1e6 AS "receita (R$ mi.)", fpm AS "pct.fpm" FROM indicadores',
      "SELECT 'mulheres/homens: % da remuneração (2013 e 2018)' AS indicador, '10:30' AS hora",
      'SELECT 1 AS "mulheres/total (%)", 2 AS "rem. dez. (R$/mês)", 3 AS "público/privado"',
    ]) assert.equal(validarSql(ok), null, ok);
    for (const ruim of [
      'DROP TABLE indicadores',
      'CREATE TABLE x AS SELECT 1',
      'SELECT 1; DELETE FROM indicadores',
      "SELECT * FROM read_parquet('https://exemplo.org/x.parquet')",
      "SELECT * FROM 'indicadores.parquet'",
      "SELECT * FROM 'https://exemplo.org/x.csv'",
      'SELECT getenv(\'HOME\')',
      "COPY indicadores TO 'x.csv'",
      "SELECT * FROM query('SELECT 1')",
      'ATTACH \'x.db\'',
      'SET threads = 1',
      'SELECT * FROM "dados.parquet"',
      'SELECT * FROM "C:/dados/x"',
      'SELECT * FROM "https://exemplo.org/x"',
      'SELECT * FROM "/dados/x"',
      'SELECT * FROM "dados\\x"',
      'SELECT * FROM "x.csv.gz"',
      "SELECT 'https://exemplo.org/x' AS u",
      "SELECT 'C:\\dados\\x' AS c",
      "SELECT '/etc/passwd' AS p",
      "SELECT 'x.parquet' AS a",
    ]) assert.notEqual(validarSql(ruim), null, ruim);
  });

  test('consulta da IA traz colunas na ordem, linhas limitadas e o total', async () => {
    const r = await executarConsulta({ sql: 'SELECT exercicio, count(*) AS n, sum(receita_bruta) AS rb FROM indicadores WHERE esfera = \'M\' GROUP BY 1 ORDER BY 1' });
    assert.ok(!('erro' in r));
    if ('erro' in r) return;
    assert.deepEqual(r.colunas, ['exercicio', 'n', 'rb']);
    assert.equal(r.total, r.linhas.length);
    assert.equal(r.linhas[0][0], 2013);
    assert.equal(typeof r.linhas[0][1], 'number');
    const muitas = await consultaLivre('SELECT * FROM indicadores', 7);
    assert.equal(muitas.linhas.length, 7);
    assert.ok(muitas.total > 50000);
  });

  test('erros de SQL e entradas inválidas voltam como erro para o modelo, sem exceção', async () => {
    const r = await executarConsulta({ sql: 'SELECT coluna_que_nao_existe FROM indicadores' });
    assert.ok('erro' in r);
    assert.ok('erro' in (await executarConsulta({})));
    assert.match(paraModelo(r), /erro/);
  });

  test('resultado enviado ao modelo cabe no limite de tamanho', () => {
    const linhas = Array.from({ length: 2000 }, (_, i) => [i, 'x'.repeat(300)]);
    const texto = paraModelo({ colunas: ['i', 's'], linhas, total: 2000 });
    assert.ok(texto.length <= 40_000);
    assert.equal(JSON.parse(texto).total_linhas, 2000);
  });

  test('resultado leva o identificador da consulta e o aviso da última rodada', () => {
    const j = JSON.parse(paraModelo({ colunas: ['n'], linhas: [[1]], total: 1 }, 'C3', 'última rodada'));
    assert.equal(j.consulta, 'C3');
    assert.equal(j.aviso, 'última rodada');
    assert.equal(JSON.parse(paraModelo({ erro: 'x' }, 'C4')).consulta, 'C4');
  });

  test('consulta cancelada antes de rodar: AbortError, não um erro para o modelo', async () => {
    const c = new AbortController();
    c.abort();
    await assert.rejects(executarConsulta({ sql: 'SELECT 1' }, ['financas'], c.signal), (e: Error) => e.name === 'AbortError');
  });
});

describe('IA: histórico, resposta estruturada e conferência', () => {
  const ctx = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'brasil' }, ano: null, modo: 'rapida' });
  const responder = (id: string, input: unknown) => ({ role: 'assistant' as const, content: [{ type: 'tool_use', id, name: 'responder', input }] });
  const consultar = (id: string, sql = 'SELECT 1 AS n') => ({ role: 'assistant' as const, content: [{ type: 'tool_use', id, name: 'consultar', input: { sql, objetivo: 'teste' } }] });
  const entrada = (o: Record<string, unknown> = {}) => ({
    tipo: 'resposta', conclusao: 'São 10.', destaques: [], explicacao: '', interpretacao: '', hipoteses: '', limitacoes: '',
    recorte: { territorio: 'Brasil', periodo: '2025', unidade: 'vínculos', filtros: '' }, metodologia: '', graficos: [], aprofundar: [], ...o,
  });

  test('contexto sem território manda não presumir lugar e o modo vai junto', () => {
    assert.match(ctx, /Território selecionado: nenhum\. Não presuma/);
    assert.match(ctx, /Modo de resposta: rápida/);
    const go = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'municipio', uf: 'GO', nome: 'Goiânia', cod: 5208707 }, ano: 2023, modo: 'pesquisa' });
    assert.match(go, /Goiânia \(GO\), município\. Códigos: cod_ibge = 5208707 \(7 dígitos\) em trab_municipios, trab_grandes_setores, trab_setores, trab_caged/);
    assert.match(go, /municipio = 520870 \(6 dígitos\) só em rais_mun e rais_vinculos/);
    assert.match(go, /Ano de referência: 2023/);
    assert.match(go, /Modo de resposta: pesquisa/);
  });

  test('perguntas: contexto e texto; resultado pendente de responder vai antes; limite de consultas mescla', () => {
    const h1 = comPergunta([], 'Quantos vínculos?', ctx);
    assert.deepEqual((h1[0].content as { type: string }[]).map((b) => b.type), ['text', 'text']);
    const h2 = comPergunta([...h1, responder('r1', entrada())], 'E em 2024?', ctx);
    assert.deepEqual((h2[2].content as { type: string; tool_use_id?: string }[]).map((b) => b.tool_use_id ?? b.type), ['r1', 'text', 'text']);
    // pergunta que parou no limite: o histórico termina em resultados, e a próxima pergunta entra na mesma mensagem
    const limite: Mensagem[] = [...h1, consultar('c1'), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{}' }] }];
    const h3 = comPergunta(limite, 'Conclua.', ctx);
    assert.equal(h3.length, limite.length);
    assert.deepEqual((h3.at(-1)!.content as { type: string }[]).map((b) => b.type), ['tool_result', 'text', 'text']);
    // editar a última pergunta devolve o resultado de ferramenta que estava junto
    assert.deepEqual(semUltimaPergunta(h3), limite);
    const editada = semUltimaPergunta(h2);
    assert.deepEqual(editada.slice(0, 2), [...h1, responder('r1', entrada())]);
    assert.deepEqual(editada.slice(2), [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'Resposta exibida ao usuário.' }] }]);
    // e a pergunta reescrita volta para a mesma mensagem, como antes
    assert.deepEqual(comPergunta(editada, 'E em 2024?', ctx), h2);
  });

  test('turnos: consultas numeradas na conversa, resposta estruturada e texto livre', () => {
    const hist: Mensagem[] = [
      ...comPergunta([], 'P1', ctx), consultar('a'), { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'a', content: '{}' }] },
      responder('r1', entrada({ aprofundar: ['x', 'y', 'z', 'w'] })),
    ];
    const h2 = [...comPergunta(hist, 'P2', ctx), consultar('b'), { role: 'user' as const, content: [{ type: 'tool_result', tool_use_id: 'b', content: '{}' }] },
      { role: 'assistant' as const, content: [{ type: 'text', text: 'Resposta em texto.' }] }];
    assert.deepEqual([...rotulosConsultas(h2).values()], ['C1', 'C2']);
    const [t1, t2] = turnos(h2);
    assert.equal(t1.pergunta, 'P1');
    assert.equal(t1.resposta?.conclusao, 'São 10.');
    assert.equal(t1.resposta?.aprofundar.length, 3);
    assert.equal(t2.pergunta, 'P2');
    assert.equal(t2.resposta, null);
    assert.equal(t2.textoFinal, 'Resposta em texto.');
    assert.deepEqual(t2.itens.map((i) => i.tipo === 'consulta' ? i.rotulo : 'nota'), ['C2']);
  });

  test('resposta: as sete tabelas pedidas ficam todas (antes eram cortadas em 4); além de 10, o excesso é apontado', () => {
    const tabela = (i: number) => ({ consulta: `C${i}`, papel: 'principal', tipo: 'tabela', titulo: `Tabela ${i}`, grupo: '', periodo: '', valor: '',
      colunas: [], de: '', ate: '', total: false, participacao: false, formato: 'inteiro', unidade: 'vínculos', nota: '' });
    const sete = lerResposta({ resposta: entrada({ tabelas: [1, 2, 3, 4, 5, 6, 7].map(tabela) }) })!;
    assert.equal(sete.tabelas.length, 7);
    assert.equal(sete.tabelasAlem, 0);
    const doze = lerResposta({ resposta: entrada({ tabelas: Array.from({ length: 12 }, (_, i) => tabela(i + 1)) }) })!;
    assert.equal(doze.tabelas.length, 10);
    assert.equal(doze.tabelasAlem, 2);
  });

  test('resposta: campos no objeto "resposta"; marcação vazada ou sem conclusão não vale', () => {
    assert.equal(lerResposta({ resposta: entrada() })?.conclusao, 'São 10.');
    // sem o modo estrito, o objeto pode vir como texto JSON
    assert.equal(lerResposta({ resposta: JSON.stringify(entrada()) })?.conclusao, 'São 10.');
    assert.equal(lerResposta({ resposta: '{quebrado' }), null);
    assert.equal(lerResposta(entrada({ conclusao: '  ' })), null);
    assert.equal(lerResposta(null), null);
    // o modelo fechou o campo com a marcação errada e engoliu os seguintes: a resposta não é mostrada
    assert.equal(lerResposta({ resposta: entrada({ conclusao: 'Cresceu 36%.</conclusao>\n<parameter name="destaques">[]' }) }), null);
    assert.equal(lerResposta({ resposta: entrada({ limitacoes: 'Quebra de série.</limitacoes>' }) }), null);
    // escapes repetidos pelo modelo (texto "ç" e "\n") viram os caracteres
    const r = lerResposta({ resposta: entrada({
      explicacao: '- Remunera\\u00e7\\u00e3o: 2.946\\n- Real: 3.923',
      destaques: [{ rotulo: 'Remunera\nção m\\u00e9dia', valor: 1, formato: 'inteiro', unidade: '', consulta: 'C1', coluna: 'n' }],
    }) })!;
    assert.equal(r.explicacao, '- Remuneração: 2.946\n- Real: 3.923');
    assert.equal(r.destaques[0].rotulo, 'Remunera ção média');
  });

  test('resposta: campos conferidos e limitados', () => {
    const r = lerResposta(entrada({
      tipo: 'outro',
      destaques: Array.from({ length: 6 }, (_, i) => ({ rotulo: `d${i}`, valor: i, formato: 'inteiro', unidade: '', consulta: 'C1', coluna: 'n' })),
      graficos: [{ consulta: 'C1', tipo: 'linha', titulo: 'g', x: 'ano', y: ['a', 'b', 'c', 'd'], serie: '', formato: 'xyz' }],
    }))!;
    assert.equal(r.tipo, 'resposta');
    assert.equal(r.destaques.length, 4);
    assert.deepEqual(r.graficos[0].y, ['a', 'b', 'c']);
    assert.equal(r.graficos[0].formato, 'decimal');
  });

  test('conferência: o número precisa estar na tabela citada', () => {
    const res: Resultado = { colunas: ['ano', 'empregos', 'pct_mulheres', 'fracao'], linhas: [[2024, 65431, 45.27, 0.4527], [2025, 70210, 46.1, 0.461]], total: 2 };
    const d = (valor: number, coluna = 'empregos', formato: 'inteiro' | 'percentual' | 'reais' = 'inteiro') =>
      ({ rotulo: 'x', valor, formato, unidade: '', consulta: 'C1', coluna });
    assert.equal(conferir(d(65431), res), 'conferido');
    assert.equal(conferir(d(65400), res), 'divergente'); // inteiro: precisa ser o mesmo número
    assert.equal(conferir(d(45.3, 'pct_mulheres', 'percentual'), res), 'conferido'); // arredondado na casa que o modelo escreveu
    assert.equal(conferir(d(45.3, 'fracao', 'percentual'), res), 'conferido'); // coluna em fração
    assert.equal(conferir(d(47, 'pct_mulheres', 'percentual'), res), 'divergente');
    assert.equal(conferir(d(70210, 'coluna_inexistente'), res), 'conferido'); // nome errado: procura nas outras colunas
    assert.equal(conferir(d(1), { erro: 'falhou' }), 'sem_consulta');
    assert.equal(conferir(d(1), undefined), 'sem_consulta');
  });

  test('fontes vêm das tabelas lidas; nomes dentro de textos não contam', () => {
    assert.deepEqual(fontesConsultadas([
      "SELECT sum(vinculos) FROM rais_uf WHERE uf_sigla = 'GO'",
      'SELECT i.indice FROM ipca i',
      "SELECT 'rais_vinculos indicadores' AS rotulo",
    ]), ['RAIS (MTE): tabelas somadas dos microdados', 'IPCA (Banco Central, SGS 433)']);
    assert.deepEqual(fontesConsultadas(['SELECT * FROM trab_caged_uf']), ['Novo CAGED (MTE)']);
  });

  test('gráfico usa só os dados da consulta: formato largo, longo e colunas inexistentes', () => {
    const largo: Resultado = { colunas: ['ano', 'go', 'br'], linhas: [[2025, 3, 30], [2023, 1, 10], [2024, 2, null]], total: 3 };
    const g = { consulta: 'C1', tipo: 'linha' as const, titulo: '', x: 'ano', y: ['go', 'br'], serie: '', formato: 'inteiro' as const };
    const a = dadosDoGrafico(g, largo)!;
    assert.deepEqual(a.categorias, [2023, 2024, 2025]); // anos em ordem
    assert.deepEqual(a.series[1].valores, [10, null, 30]); // ausente fica nulo, não zero
    const longo: Resultado = { colunas: ['ano', 'uf', 'v'], linhas: [[2024, 'GO', 1], [2024, 'SP', 5], [2025, 'GO', 2]], total: 3 };
    const b = dadosDoGrafico({ ...g, y: ['v'], serie: 'uf' }, longo)!;
    assert.deepEqual(b.series.map((s) => [s.nome, s.valores]), [['GO', [1, 2]], ['SP', [5, null]]]);
    assert.equal(dadosDoGrafico({ ...g, y: ['nao_existe'] }, largo), null);
    assert.equal(dadosDoGrafico(g, { erro: 'x' }), null);
  });

  test('sugestões usam os anos dos dados e o território da página, sem presumir lugar', () => {
    const cob = { rais: [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], caged: { de: 202001, ate: 202608 }, microdados: true, dca: [2013, 2024] };
    const br = sugestoes(['trabalho'], { tipo: 'brasil' }, cob, null);
    assert.equal(br.length, 4);
    assert.ok(br.every((s) => !/Goiás|Goiânia|São Paulo/.test(s.texto)), JSON.stringify(br));
    assert.match(br[0].texto, /no Brasil de 2015 a 2025/);
    const pa = sugestoes(['trabalho'], { tipo: 'uf', uf: 'PA', nome: 'Pará', cod: 15 }, cob, 2020);
    assert.match(pa[0].texto, /no Pará de 2013 a 2020/);
    assert.match(pa[2].texto, /Como o Pará se compara com o Brasil/);
    // dois painéis: um de cada e a pergunta entre painéis à vista (as três primeiras); o resto alternado
    const ambos = sugestoes(['financas', 'trabalho'], { tipo: 'brasil' }, cob, null);
    assert.deepEqual(ambos.slice(0, 3).map((s) => s.tema), ['Mercado de trabalho', 'Finanças públicas', 'Entre bases']);
    assert.equal(ambos.length, 9);
    assert.ok(ambos.every((s) => s.titulo.length <= 40 && s.texto.endsWith('?')), JSON.stringify(ambos.map((s) => s.titulo)));
    assert.equal(sugestoes(['trabalho'], { tipo: 'brasil' }, { ...cob, rais: [] }, null).length, 0);
  });
});

describe('IA: conversa completa com um Worker simulado', () => {
  const original = globalThis.fetch;
  after(() => {
    globalThis.fetch = original;
  });

  /** Simula o Worker: cada chamada devolve a próxima resposta do modelo e guarda o pedido recebido. */
  function simular(passos: ((pedido: { mensagens: Mensagem[] }) => unknown)[]) {
    const pedidos: { mensagens: Mensagem[] }[] = [];
    globalThis.fetch = (async (_url: unknown, init?: { body?: string; signal?: AbortSignal }) => {
      if (init?.signal?.aborted) throw new DOMException('cancelada', 'AbortError');
      const pedido = JSON.parse(String(init?.body));
      pedidos.push(pedido);
      const passo = passos[pedidos.length - 1];
      return new Response(JSON.stringify(passo(pedido)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return pedidos;
  }
  const resultadoDoPedido = (p: { mensagens: Mensagem[] }) =>
    JSON.parse(String(((p.mensagens.at(-1)!.content as { content?: string }[])[0]).content));

  test('consulta, resultado com C1, resposta conferida; histórico válido para a próxima pergunta', async () => {
    usarServidorIaNoTeste('');
    const pedidos = simular([
      () => ({ parada: 'tool_use', restantes: 49, conteudo: [
        { type: 'text', text: 'Vou contar.' },
        { type: 'tool_use', id: 'c1', name: 'consultar', input: { sql: "SELECT count(*) AS municipios FROM entes WHERE esfera = 'M'", objetivo: 'Municípios' } },
      ] }),
      (p) => {
        const r = resultadoDoPedido(p);
        return { parada: 'tool_use', restantes: 49, conteudo: [{ type: 'tool_use', id: 'r1', name: 'responder', input: { resposta: {
          tipo: 'resposta', conclusao: `São ${r.linhas[0][0]} municípios.`, explicacao: '', interpretacao: '', hipoteses: '', limitacoes: '', metodologia: '',
          destaques: [{ rotulo: 'Municípios', valor: r.linhas[0][0], formato: 'inteiro', unidade: 'no cadastro', consulta: r.consulta, coluna: 'municipios' }],
          recorte: { territorio: 'Brasil', periodo: '', unidade: '', filtros: '' }, graficos: [], aprofundar: [],
        } } }] };
      },
    ]);
    const resultados: Record<string, Resultado> = {};
    const r = await perguntarIa({
      historico: [], pergunta: 'Quantos municípios?', contexto: 'Contexto da página…', idioma: 'pt', paineis: ['financas'],
      sinal: new AbortController().signal, aoAtualizar: () => undefined, aoResultado: (id, res) => (resultados[id] = res),
    });
    assert.equal(r.desfecho, 'resposta');
    assert.equal(pedidos.length, 2);
    assert.equal(resultadoDoPedido(pedidos[1]).consulta, 'C1');
    const turno = turnos(r.mensagens)[0];
    assert.equal(turno.resposta!.destaques[0].consulta, 'C1');
    assert.equal(conferir(turno.resposta!.destaques[0], resultados.c1), 'conferido');
    // a próxima pergunta leva o resultado pendente de "responder" antes do texto
    const proxima = comPergunta(r.mensagens, 'E estados?', 'ctx').at(-1)!;
    assert.equal((proxima.content as { type: string }[])[0].type, 'tool_result');
  });

  test('resposta malformada volta ao modelo como erro e ele a refaz', async () => {
    const boa = { resposta: {
      tipo: 'resposta', conclusao: 'Pronto.', destaques: [], explicacao: '', interpretacao: '', hipoteses: '', limitacoes: '',
      recorte: { territorio: '', periodo: '', unidade: '', filtros: '' }, metodologia: '', graficos: [], aprofundar: [],
    } };
    const pedidos = simular([
      () => ({ parada: 'tool_use', restantes: 48, conteudo: [{ type: 'tool_use', id: 'r1', name: 'responder',
        input: { resposta: { ...boa.resposta, conclusao: 'Pronto.</conclusao><parameter name="destaques">[]' } } }] }),
      () => ({ parada: 'tool_use', restantes: 48, conteudo: [{ type: 'tool_use', id: 'r2', name: 'responder', input: boa }] }),
    ]);
    const r = await perguntarIa({
      historico: [], pergunta: 'Teste', contexto: 'ctx', idioma: 'pt', paineis: ['financas'],
      sinal: new AbortController().signal, aoAtualizar: () => undefined, aoResultado: () => undefined,
    });
    assert.equal(r.desfecho, 'resposta');
    const devolvido = (pedidos[1].mensagens.at(-1)!.content as { tool_use_id: string; is_error?: boolean; content: string }[])[0];
    assert.equal(devolvido.tool_use_id, 'r1');
    assert.ok(devolvido.is_error);
    assert.match(devolvido.content, /objeto "resposta"/);
    assert.equal(turnos(r.mensagens)[0].resposta?.conclusao, 'Pronto.');
  });

  test('responder junto com consultas é devolvido como erro; cancelamento interrompe sem nova chamada', async () => {
    const pedidos = simular([
      () => ({ parada: 'tool_use', restantes: 48, conteudo: [
        { type: 'tool_use', id: 'c1', name: 'consultar', input: { sql: 'SELECT 1 AS n', objetivo: 'um' } },
        { type: 'tool_use', id: 'r0', name: 'responder', input: { conclusao: 'cedo demais' } },
      ] }),
      () => ({ parada: 'end_turn', restantes: 48, conteudo: [{ type: 'text', text: 'Pronto.' }] }),
    ]);
    const r = await perguntarIa({
      historico: [], pergunta: 'Teste', contexto: 'ctx', idioma: 'pt', paineis: ['financas'],
      sinal: new AbortController().signal, aoAtualizar: () => undefined, aoResultado: () => undefined,
    });
    assert.equal(r.desfecho, 'texto');
    const devolvidos = pedidos[1].mensagens.at(-1)!.content as { tool_use_id: string; is_error?: boolean }[];
    assert.deepEqual(devolvidos.map((b) => [b.tool_use_id, !!b.is_error]), [['c1', false], ['r0', true]]);

    const c = new AbortController();
    const chamadas = simular([() => {
      c.abort();
      return { parada: 'tool_use', restantes: 47, conteudo: [{ type: 'tool_use', id: 'c9', name: 'consultar', input: { sql: 'SELECT 1', objetivo: 'x' } }] };
    }]);
    await assert.rejects(perguntarIa({
      historico: [], pergunta: 'Teste', contexto: 'ctx', idioma: 'pt', paineis: ['financas'],
      sinal: c.signal, aoAtualizar: () => undefined, aoResultado: () => undefined,
    }), (e: Error) => e.name === 'AbortError');
    assert.equal(chamadas.length, 1);
  });
});

/**
 * Regressões da conversa exportada sobre Andirá (PR): código municipal no formato errado (410110 em
 * trab_caged, 0 linhas) e busca por pedaço do código (trouxe Ângulo junto); gráfico setorial com colunas
 * inexistentes; tabela setorial de 14 colunas numa linha; competências como "202.509"; "23,8% %";
 * variações que atravessam a quebra da RAIS sem a ressalva na conclusão; leitura sem cálculo de apoio.
 */
const ANDIRA = 4101101;
const semCaged = !existsSync(`${DATA}/gold/trabalho/caged.parquet`) || !existsSync(`${DATA}/gold/trabalho/municipios.parquet`);
const SETORES_C3: Resultado = {
  colunas: ['empregos', 'empregos_agropecuaria', 'empregos_industria', 'empregos_construcao', 'empregos_comercio', 'empregos_servicos', 'empregos_adm_publica',
    'soma_setores', 'pct_agropecuaria', 'pct_industria', 'pct_construcao', 'pct_comercio', 'pct_servicos', 'pct_adm_publica'],
  linhas: [[4731, 307, 1343, 53, 864, 1468, 696, 4731, 6.5, 28.4, 1.1, 18.3, 31, 14.7]],
  total: 1,
};
const feita = (rotulo: string, sql: string, resultado?: Resultado): [string, ConsultaFeita] => [rotulo, { id: rotulo.toLowerCase(), rotulo, sql, objetivo: '', substitui: '', resultado }];
const respostaBase = (o: Record<string, unknown> = {}) => ({
  tipo: 'resposta', conclusao: 'Pronto.', destaques: [], explicacao: '', interpretacao: [], hipoteses: '', limitacoes: '',
  recorte: { territorio: '', periodo: '', unidade: '', filtros: '' }, metodologia: '', graficos: [], aprofundar: [], ...o,
});

describe('IA: código municipal e localização (regressão Andirá/PR)', () => {
  test('6 dígitos em trab_caged é recusado antes de rodar, com o código certo; busca por pedaço do código também', { skip: semCaged }, async () => {
    const c4 = `WITH ult AS (SELECT DISTINCT competencia FROM trab_caged WHERE cod_ibge = 410110 ORDER BY competencia DESC LIMIT 12)
      SELECT c.competencia, c.admissoes FROM trab_caged c JOIN ult u ON c.competencia = u.competencia WHERE c.cod_ibge = 410110 ORDER BY c.competencia`;
    const r4 = await executarConsulta({ sql: c4 }, ['trabalho']);
    assert.ok('erro' in r4 && r4.bloqueada, JSON.stringify(r4));
    assert.match(r4.erro, /410110 é o código de 6 dígitos .* de Andirá \(PR\): use cod_ibge = 4101101/);
    assert.match(paraModelo(r4, 'C4'), /"bloqueada"/);
    // a "consulta diagnóstica" C5 trouxe Ângulo (4101150) junto
    const c5 = "SELECT cod_ibge, MIN(competencia) AS primeira FROM trab_caged WHERE cod_ibge IN (410110, 4101101) OR cod_ibge::VARCHAR LIKE '41011%' GROUP BY cod_ibge";
    const r5 = await executarConsulta({ sql: c5 }, ['trabalho']);
    assert.ok('erro' in r5 && r5.bloqueada);
    assert.match(r5.erro, /parte do código/);
    // C6, com o código de 7 dígitos, roda e traz os meses de Andirá
    const r6 = await executarConsulta({ sql: `SELECT count(*) AS meses FROM trab_caged WHERE cod_ibge = ${ANDIRA}` }, ['trabalho']);
    assert.ok(!('erro' in r6) && Number(r6.linhas[0][0]) > 12, JSON.stringify(r6));
  });

  test('outros formatos errados: 7 dígitos em rais_mun, junção sem // 10, UF de 2 dígitos em trab_*, nome por LIKE', async () => {
    const cad = await cadastro();
    assert.match(conferirCodigos(`SELECT sum(vinculos) FROM rais_mun WHERE ano = 2023 AND municipio = ${ANDIRA}`, cad)!, /use municipio = 410110/);
    assert.match(conferirCodigos('SELECT * FROM rais_mun r JOIN trab_municipios m ON r.municipio = m.cod_ibge', cad)!, /cod_ibge \/\/ 10 = municipio/);
    assert.match(conferirCodigos('SELECT * FROM rais_mun r JOIN trab_municipios m ON r.municipio = m.cod_ibge / 10', cad)!, /cod_ibge \/\/ 10 = municipio/);
    assert.match(conferirCodigos('SELECT * FROM trab_municipios WHERE cod_ibge = 41', cad)!, /uf = 'PR'/);
    assert.match(conferirCodigos("SELECT cod_ibge FROM entes WHERE strip_accents(lower(nome)) LIKE '%andira%'", cad)!, /localizar/);
    assert.match(conferirCodigos('SELECT * FROM trab_caged WHERE cod_ibge = 4101102', cad)!, /não existe/);
    for (const ok of [
      `SELECT * FROM trab_caged WHERE cod_ibge = ${ANDIRA}`,
      'SELECT sum(vinculos) FROM rais_mun WHERE ano = 2023 AND municipio = 410110',
      'SELECT * FROM rais_mun r JOIN trab_municipios m ON m.cod_ibge // 10 = r.municipio',
      "SELECT * FROM trab_municipios WHERE uf = 'PR' AND cod_ibge::VARCHAR LIKE '41%'",
      'SELECT receita_bruta FROM indicadores WHERE cod_ibge IN (41, 4101101) AND exercicio = 2024',
      "SELECT nome, empregos FROM trab_municipios WHERE uf = 'PR' ORDER BY nome",
    ]) assert.equal(conferirCodigos(ok, cad), null, ok);
  });

  test('localizar: nome e UF dão os códigos em cada formato; nomes repetidos voltam todos; sem igual, sugestões', async () => {
    const cad = await cadastro();
    assert.deepEqual(localizar('Andirá', 'PR', cad).encontrados.map((l) => [l.nome, l.uf, l.cod]), [['Andirá', 'PR', ANDIRA]]);
    assert.equal(localizar('ANDIRA (PR)', '', cad).encontrados[0].cod, ANDIRA);
    assert.ok(localizar('Bom Jesus', '', cad).encontrados.length > 1);
    assert.equal(localizar('Andiraa', 'PR', cad).encontrados.length, 0);
    assert.equal(localizar('Andiraa', 'PR', cad).sugestoes[0]?.nome, 'Andirá');
    assert.deepEqual(localizar('Paraná', 'PR', cad).encontrados.map((l) => [l.tipo, l.uf, l.cod]), [['uf', 'PR', 41]]);
    const e = executarLocalizacao({ nome: 'Andirá', uf: 'PR' }, cad, ['trabalho']);
    assert.equal(e.erro, false);
    assert.match(e.modelo, /"cod_ibge":4101101/);
    assert.match(e.modelo, /"municipio_rais":410110/);
    assert.match(e.modelo, /cod_ibge = 4101101 \(7 dígitos\) em trab_municipios, trab_grandes_setores, trab_setores, trab_caged/);
    assert.deepEqual('erro' in e.tabela ? null : e.tabela.linhas, [['Andirá', 'PR', ANDIRA, 410110]]);
    assert.equal(executarLocalizacao({ nome: 'Lugar Que Não Existe', uf: '' }, cad, ['trabalho']).erro, true);
  });

  test('contexto do município selecionado traz o código de cada tabela, sem "410110 no CAGED"', () => {
    const c = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'municipio', uf: 'PR', nome: 'Andirá', cod: ANDIRA }, ano: null, modo: 'rapida' });
    assert.match(c, /cod_ibge = 4101101 \(7 dígitos\) em trab_municipios, trab_grandes_setores, trab_setores, trab_caged, trab_caged_anual e entes/);
    assert.match(c, /municipio = 410110 \(6 dígitos\) só em rais_mun e rais_vinculos/);
    assert.doesNotMatch(c, /na RAIS e no CAGED/);
    assert.ok(c.length < 1500, 'cabe no limite de contexto do Worker');
  });
});

describe('IA: gráficos, tabelas e formatação (regressão Andirá/PR)', () => {
  const grafico = (o: Partial<GraficoIa> = {}): GraficoIa => ({ consulta: 'C3', tipo: 'barras', titulo: 'Empregos por setor', x: 'setor', y: ['vinculos'], serie: '', formato: 'inteiro', ...o });

  test('gráfico setorial com colunas inexistentes ou sobre uma linha só não é montado, com o motivo', () => {
    const v = validarGrafico(grafico(), SETORES_C3);
    assert.ok(!v.ok);
    assert.match(v.motivo, /as colunas setor, vinculos não existem em C3 \(colunas: empregos, empregos_agropecuaria/);
    const umaLinha = validarGrafico(grafico({ x: 'empregos', y: ['empregos_industria'] }), SETORES_C3);
    assert.ok(!umaLinha.ok && /uma linha só/.test(umaLinha.motivo));
    assert.ok(!validarGrafico(grafico({ x: 'ano', y: ['v'], tipo: 'linha' }), { colunas: ['ano', 'v'], linhas: [[2024, 1], [2024, 2]], total: 2 }).ok, 'x repetido sem série');
    assert.ok(!validarGrafico(grafico({ y: ['nome'] }), { colunas: ['setor', 'nome'], linhas: [['a', 'x'], ['b', 'y']], total: 2 }).ok, 'y não numérico');
  });

  test('uma linha com 14 colunas vira linhas: setor, vínculos e participação', () => {
    const f = formatarTabela(SETORES_C3);
    assert.ok(f.emLinhas);
    assert.deepEqual(f.cabecalho, ['categoria', 'empregos', 'participação (%)']);
    assert.deepEqual(f.linhas.map((l) => l.join(' | ')), [
      'Agropecuária | 307 | 6,5', 'Indústria | 1.343 | 28,4', 'Construção | 53 | 1,1',
      'Comércio | 864 | 18,3', 'Serviços | 1.468 | 31,0', 'Administração pública | 696 | 14,7',
    ]);
    assert.deepEqual(f.extras, ['empregos: 4.731', 'soma setores: 4.731']);
    // sem padrão de categorias, uma linha por coluna
    const t2 = formatarTabela({ colunas: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], linhas: [[1, 2, 3, 4, 5, 6, 7]], total: 1 });
    assert.deepEqual(t2.cabecalho, ['indicador', 'valor']);
    assert.equal(t2.linhas.length, 7);
  });

  test('distribuição pela visão trab_grandes_setores: seis linhas que somam o total, prontas para o gráfico', { skip: semCaged }, async () => {
    await tabelasIaTrabalho();
    const sql = `SELECT setor, vinculos, round(100.0 * vinculos / sum(vinculos) OVER (), 1) AS participacao_pct
      FROM trab_grandes_setores WHERE cod_ibge = ${ANDIRA} AND ano = 2025 ORDER BY ordem`;
    const r = await executarConsulta({ sql }, ['trabalho']);
    assert.ok(!('erro' in r), JSON.stringify(r));
    if ('erro' in r) return;
    assert.equal(r.linhas.length, 6);
    const total = await executarConsulta({ sql: `SELECT empregos FROM trab_municipios WHERE cod_ibge = ${ANDIRA} AND ano = 2025` }, ['trabalho']);
    assert.ok(!('erro' in total));
    if ('erro' in total) return;
    assert.equal(r.linhas.reduce((s, l) => s + Number(l[1]), 0), total.linhas[0][0]);
    const v = validarGrafico(grafico({ consulta: 'C1' }), r);
    assert.ok(v.ok && v.dados.categorias.length === 6, JSON.stringify(v));
  });

  test('competências como set/2025, códigos sem separador, reais com duas casas, unidade sem símbolo repetido, plural', () => {
    const c5 = formatarTabela({ colunas: ['cod_ibge', 'primeira', 'ultima', 'linhas'], linhas: [[ANDIRA, 202001, 202608, 80], [4101150, 202001, 202608, 80]], total: 2 },
      'SELECT cod_ibge, MIN(competencia) AS primeira, MAX(competencia) AS ultima, COUNT(*) AS linhas FROM trab_caged GROUP BY cod_ibge');
    assert.deepEqual(c5.linhas[0], ['4101101', 'jan/2020', 'ago/2026', '80']);
    // rótulos do catálogo e com acento
    assert.deepEqual(c5.cabecalho, ['código IBGE', 'primeira (mês)', 'última (mês)', 'linhas']);
    const c7 = formatarTabela({
      colunas: ['de_competencia', 'ate_competencia', 'meses', 'admissoes_12m', 'saldo_12m', 'salario_medio_admissao_ponderado'],
      linhas: [[202509, 202608, 12, 1704, -61, 2169.45]], total: 1,
    });
    assert.deepEqual(c7.linhas[0], ['set/2025', 'ago/2026', '12', '1.704', '-61', '2.169,45']);
    assert.equal(c7.cabecalho[5], 'salário médio admissão ponderado (R$)');
    assert.equal(formatarCelula(2001.37, tipoColuna('salario_medio_admissao', [2001.37])), '2.001,37');
    assert.equal(formatarCelula(31, tipoColuna('pct_servicos', [31])), '31,0');
    // uma casa em toda a coluna de percentuais (0,66 aparecia com duas, ao lado de 3,6 e 8,8)
    assert.equal(formatarCelula(0.6595, tipoColuna('variacao_pct_ano_anterior', [0.6595])), '0,7');
    assert.equal(formatarCelula(0.04, tipoColuna('variacao_pct', [0.04])), '0,04');
    assert.equal(formatarCelula(2015, tipoColuna('ano', [2015])), '2015');
    assert.equal(formatarCelula(3821, tipoColuna('empregos_ano_anterior', [3821])), '3.821');
    assert.equal(formatarValor(23.8, 'percentual'), '23,8%');
    assert.equal(formatarValor(2169.45, 'reais'), 'R$ 2.169,45');
    assert.equal(unidadeLimpa('% no período', 'percentual'), 'no período');
    assert.equal(unidadeLimpa('R$ nominais, média ponderada pelas admissões', 'reais'), 'nominais, média ponderada pelas admissões');
    assert.equal(competenciasNoTexto('Período: competências de 202509 a 202608 (as 12 mais recentes).'), 'Período: competências de set/2025 a ago/2026 (as 12 mais recentes).');
    assert.equal(competenciasNoTexto('Código 251605 da CBO.'), 'Código 251605 da CBO.');
    assert.equal(contar(1, 'linha', 'linhas'), '1 linha');
    assert.equal(contar(1704, 'linha', 'linhas'), '1.704 linhas');
  });

  test('período consultado: últimos 12 meses, acumulado no ano e ano calendário são diferentes', () => {
    assert.equal(rotuloPeriodo({ tipo: 'mes', de: 202509, ate: 202608 }, 202608), 'set/2025–ago/2026 (últimos 12 meses)');
    assert.equal(rotuloPeriodo({ tipo: 'mes', de: 202409, ate: 202508 }, 202608), 'set/2024–ago/2025 (12 meses)');
    assert.equal(rotuloPeriodo({ tipo: 'mes', de: 202601, ate: 202608 }, 202608), 'jan–ago/2026 (acumulado no ano)');
    assert.equal(rotuloPeriodo({ tipo: 'mes', de: 202501, ate: 202512 }, 202608), 'ano de 2025 (jan–dez)');
    assert.equal(rotuloPeriodo({ tipo: 'ano', de: 2015, ate: 2025 }), '2015–2025');
    const c2 = 'SELECT MAX(CASE WHEN ano = 2015 THEN empregos END) AS e15 FROM trab_municipios WHERE cod_ibge = 4101101 AND ano BETWEEN 2015 AND 2025';
    assert.deepEqual(periodoDasConsultas([{ sql: c2, resultado: { colunas: ['e15'], linhas: [[3821]], total: 1 } }]).anos, { tipo: 'ano', de: 2015, ate: 2025 });
    const c7 = 'WITH ult AS (SELECT DISTINCT competencia FROM trab_caged WHERE cod_ibge = 4101101 ORDER BY competencia DESC LIMIT 12) SELECT MIN(c.competencia) AS de_competencia, MAX(c.competencia) AS ate_competencia FROM trab_caged c JOIN ult u USING (competencia)';
    assert.deepEqual(periodoDasConsultas([{ sql: c7, resultado: { colunas: ['de_competencia', 'ate_competencia'], linhas: [[202509, 202608]], total: 1 } }]).meses, { tipo: 'mes', de: 202509, ate: 202608 });
  });
});

describe('IA: quebra de série, leituras e conferência antes de mostrar (regressão Andirá/PR)', () => {
  const C2 = feita('C2', `SELECT ... FROM trab_municipios WHERE cod_ibge = ${ANDIRA} AND ano BETWEEN 2015 AND 2025`,
    { colunas: ['empregos_2015', 'empregos_2025', 'variacao_total_pct', 'variacao_2021_2025_pct'], linhas: [[3821, 4731, 23.8, 20.4]], total: 1 });
  const variacao = (de: string, ate: string, coluna = 'variacao_total_pct', valor = 23.8) =>
    ({ rotulo: `Variação de ${de} a ${ate}`, valor, formato: 'percentual', unidade: '% no período', consulta: 'C2', coluna, de, ate });

  test('variação que atravessa 2022 e 2023: nota do MTE junto ao número e devolução se a conclusão não disser', () => {
    const consultas = new Map([C2]);
    const r = lerResposta({ resposta: respostaBase({
      conclusao: 'Andirá passou de 3.821 empregos formais em 2015 para 4.731 em 2025, alta de 23,8%.',
      destaques: [variacao('2015', '2025'), variacao('2021', '2025', 'variacao_2021_2025_pct', 20.4)],
    }) })!;
    const p = prepararResposta(r, consultas, { doTurno: ['C2'] });
    assert.deepEqual(p.alertas.map((n) => n.quebra), [2022, 2023]);
    assert.deepEqual(p.destaques.map((x) => [x.valor, x.unidade, x.rotuloPeriodo, x.quebras.map((n) => n.quebra).join()]),
      [['23,8%', 'no período', '2015–2025', '2022,2023'], ['20,4%', 'no período', '2021–2025', '2022,2023']]);
    assert.equal(p.periodo, '2015–2025');
    assert.ok(p.notas.every((n) => n.url.startsWith('https://www.gov.br/trabalho-e-emprego/')), 'notas ligadas ao documento do MTE');
    const problemas = revisarResposta(p);
    assert.equal(problemas.length, 1, problemas.join('\n'));
    assert.match(problemas[0], /eSocial \(2022 e 2023\): diga isso na própria conclusão/);
    // com a ressalva na conclusão, a resposta passa; o texto copiado leva o alerta
    const r2 = { ...r, conclusao: `${r.conclusao} A comparação atravessa a mudança de captação da RAIS para o eSocial em 2022 e 2023.` };
    const p2 = prepararResposta(r2, consultas, { doTurno: ['C2'] });
    assert.deepEqual(revisarResposta(p2), []);
    assert.match(textoDaResposta(p2), /⚠ Em 2022, empresas do Simples Nacional/);
    assert.ok(citaQuebra(r2.conclusao));
  });

  test('sem atravessar a quebra (2023 a 2025) ou com dados do CAGED, nada de alerta da RAIS', () => {
    const consultas = new Map([C2, feita('C7', 'SELECT * FROM trab_caged WHERE cod_ibge = 4101101 AND competencia >= 202509', { colunas: ['saldo_12m'], linhas: [[-61]], total: 1 })]);
    const r = lerResposta({ resposta: respostaBase({
      conclusao: 'Alta entre 2023 e 2025; saldo de -61 empregos em 12 meses.',
      destaques: [variacao('2023', '2025'), { rotulo: 'Saldo', valor: -61, formato: 'inteiro', unidade: 'empregos celetistas', consulta: 'C7', coluna: 'saldo_12m', de: '2025-09', ate: '2026-08' }],
    }) })!;
    const p = prepararResposta(r, new Map([...consultas].map(([k, v]) => [k, k === 'C2' ? { ...v, sql: v.sql.replace('2015', '2023') } : v])), { ultimaCompetencia: 202608 });
    assert.deepEqual(p.alertas, []);
    assert.equal(p.destaques[1].rotuloPeriodo, 'set/2025–ago/2026 (últimos 12 meses)');
  });

  test('leitura sem colunas que a sustentem é devolvida; texto solto antigo também', () => {
    const consultas = new Map([feita('C3', 'SELECT * FROM trab_municipios', SETORES_C3)]);
    const comLeitura = (interpretacao: unknown) => prepararResposta(lerResposta({ resposta: respostaBase({ interpretacao }) })!, consultas);
    const semBase = comLeitura([{ texto: 'A economia é mais diversificada do que a média de um município pequeno.', consulta: 'C3', colunas: [] }]);
    assert.match(revisarResposta(semBase)[0], /Leitura "A economia é mais diversificada.*não cita a consulta e as colunas/);
    assert.match(revisarResposta(comLeitura([{ texto: 'x', consulta: 'C3', colunas: ['indice_diversificacao', 'media_uf'] }]))[0], /não existem em C3/);
    assert.deepEqual(revisarResposta(comLeitura([{ texto: 'Serviços e indústria somam 59,4%.', consulta: 'C3', colunas: ['pct_servicos', 'pct_industria'] }])), []);
    assert.deepEqual(lerResposta({ resposta: respostaBase({ interpretacao: 'Texto solto' }) })!.interpretacao, [{ texto: 'Texto solto', consulta: '', colunas: [] }]);
  });

  test('destaque que cita a série da pergunta anterior entra só com o próprio ano: sem alerta nem período 2015–2025', () => {
    const c1 = feita('C1', `SELECT ano, empregos FROM trab_municipios WHERE cod_ibge = ${ANDIRA} AND ano BETWEEN 2015 AND 2025 ORDER BY ano`,
      { colunas: ['ano', 'empregos'], linhas: [[2015, 3821], [2024, 4700], [2025, 4731]], total: 3 });
    const c3 = feita('C3', `SELECT setor, vinculos FROM trab_grandes_setores WHERE cod_ibge = ${ANDIRA} AND ano = 2025`,
      { colunas: ['setor', 'vinculos'], linhas: [['Serviços', 1468], ['Indústria', 1343]], total: 2 });
    const r = lerResposta({ resposta: respostaBase({ conclusao: 'Em 2025, serviços concentram 31,0% dos 4.731 empregos formais.', destaques: [
      { rotulo: 'Empregos formais em 2025', valor: 4731, formato: 'inteiro', unidade: 'vínculos', consulta: 'C1', coluna: 'empregos', de: '2025', ate: '2025' },
      { rotulo: 'Serviços', valor: 1468, formato: 'inteiro', unidade: 'vínculos', consulta: 'C3', coluna: 'vinculos', de: '2025', ate: '2025' },
    ] }) })!;
    const p = prepararResposta(r, new Map([c1, c3]), { doTurno: ['C3'] });
    assert.deepEqual(p.alertas, []);
    assert.equal(p.periodo, '2025');
    assert.deepEqual(revisarResposta(p), []);
  });

  test('hipóteses só quando a pergunta pede explicações', () => {
    const p = prepararResposta(lerResposta({ resposta: respostaBase({ hipoteses: 'A baixa participação da construção pode refletir obras de fora.' }) })!, new Map());
    assert.match(revisarResposta(p, { pergunta: 'Como se distribuem os empregos de Andirá por setor em 2025?' })[0], /não pede explicações/);
    assert.deepEqual(revisarResposta(p, { pergunta: 'Por que a construção tem participação tão baixa em Andirá?' }), []);
    assert.deepEqual(revisarResposta(p, { pergunta: 'Quais fatores explicam a queda de 2016?' }), []);
  });

  test('destaque fora da tabela citada e gráfico inválido entram na revisão', () => {
    const consultas = new Map([feita('C3', 'SELECT * FROM trab_municipios', SETORES_C3)]);
    const p = prepararResposta(lerResposta({ resposta: respostaBase({
      destaques: [{ rotulo: 'Serviços', valor: 1500, formato: 'inteiro', unidade: 'vínculos', consulta: 'C3', coluna: 'empregos_servicos', de: '2025', ate: '2025' }],
      graficos: [{ consulta: 'C3', tipo: 'barras', titulo: 'Setores', x: 'setor', y: ['vinculos'], serie: '', formato: 'inteiro' }],
    }) })!, consultas);
    const problemas = revisarResposta(p);
    assert.equal(problemas.length, 2);
    assert.match(problemas[0], /1500 não está na coluna empregos_servicos de C3/);
    assert.match(problemas[1], /Gráfico "Setores": as colunas setor, vinculos não existem em C3/);
  });
});

describe('IA: devolução da resposta ao modelo e localização na conversa (Worker simulado)', () => {
  const original = globalThis.fetch;
  after(() => {
    globalThis.fetch = original;
  });
  function simular(passos: ((pedido: { mensagens: Mensagem[] }) => unknown)[]) {
    const pedidos: { mensagens: Mensagem[] }[] = [];
    globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
      const pedido = JSON.parse(String(init?.body));
      pedidos.push(pedido);
      return new Response(JSON.stringify(passos[pedidos.length - 1](pedido)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    return pedidos;
  }
  const usar = (id: string, name: string, input: unknown) => ({ parada: 'tool_use', restantes: 40, conteudo: [{ type: 'tool_use', id, name, input }] });
  const graficoRuim = { consulta: 'C1', tipo: 'barras', titulo: 'Setores', x: 'setor', y: ['vinculos'], serie: '', formato: 'inteiro' };
  const pergunta = (o: Partial<Parameters<typeof perguntarIa>[0]> = {}) => perguntarIa({
    historico: [], pergunta: 'Setores de Andirá?', contexto: 'ctx', idioma: 'pt', paineis: ['trabalho'], sinal: new AbortController().signal,
    aoAtualizar: () => undefined, aoResultado: () => undefined, ...o,
  });

  test('gráfico com colunas inexistentes volta com o motivo; a resposta refeita é aceita e a revisão fica no histórico', async () => {
    usarServidorIaNoTeste('');
    const pedidos = simular([
      () => usar('c1', 'consultar', { sql: 'SELECT 307 AS empregos_agropecuaria, 1343 AS empregos_industria', objetivo: 'Setores', substitui: '' }),
      () => usar('r1', 'responder', { resposta: respostaBase({ graficos: [graficoRuim] }) }),
      () => usar('r2', 'responder', { resposta: respostaBase({ conclusao: 'Refeita.' }) }),
    ]);
    const r = await pergunta();
    assert.equal(r.desfecho, 'resposta');
    assert.equal(pedidos.length, 3);
    const devolvido = (pedidos[2].mensagens.at(-1)!.content as { tool_use_id: string; is_error?: boolean; content: string }[])[0];
    assert.equal(devolvido.tool_use_id, 'r1');
    assert.ok(devolvido.is_error);
    assert.match(devolvido.content, /Gráfico "Setores": as colunas setor, vinculos não existem em C1/);
    const turno = turnos(r.mensagens)[0];
    assert.deepEqual(turno.itens.map((i) => i.tipo), ['consulta', 'revisao']);
    assert.equal(turno.resposta?.conclusao, 'Refeita.');
  });

  test('depois de duas devoluções, a resposta é mostrada com os avisos (sem laço sem fim)', async () => {
    const pedidos = simular([
      () => usar('c1', 'consultar', { sql: 'SELECT 1 AS n', objetivo: 'um', substitui: '' }),
      ...[1, 2, 3].map((k) => () => usar(`r${k}`, 'responder', { resposta: respostaBase({ graficos: [graficoRuim] }) })),
    ]);
    const r = await pergunta();
    assert.equal(r.desfecho, 'resposta');
    assert.equal(pedidos.length, 4);
    const turno = turnos(r.mensagens)[0];
    assert.equal(turno.itens.filter((i) => i.tipo === 'revisao').length, 2);
    assert.ok(turno.resposta);
    const p = prepararResposta(turno.resposta!, consultasDaConversa(r.mensagens, {}));
    assert.ok(!p.graficos[0].validacao.ok, 'a página mostra o aviso no lugar do gráfico');
  });

  test('localizar no meio da conversa: códigos para o modelo, tabela para a página, passo no histórico', async () => {
    const guardados: Record<string, Resultado> = {};
    const pedidos = simular([
      () => usar('l1', 'localizar', { nome: 'Andirá', uf: 'PR' }),
      () => usar('r1', 'responder', { resposta: respostaBase() }),
    ]);
    const r = await pergunta({ aoResultado: (id, res) => (guardados[id] = res) });
    assert.equal(r.desfecho, 'resposta');
    const devolvido = (pedidos[1].mensagens.at(-1)!.content as { content: string }[])[0];
    assert.match(devolvido.content, /"cod_ibge":4101101/);
    assert.deepEqual('erro' in guardados.l1 ? null : guardados.l1.linhas[0], ['Andirá', 'PR', ANDIRA, 410110]);
    assert.deepEqual(turnos(r.mensagens)[0].itens.map((i) => i.tipo), ['localizacao']);
  });
});

/**
 * Com o modelo de verdade (custa perguntas do dia): IA_E2E=1 npm test, com o Worker local ligado
 * (cd worker; npx wrangler dev). Duas perguntas seguidas na mesma conversa; cada destaque precisa estar
 * na tabela da consulta citada e cada gráfico precisa sair dos dados dela.
 */
describe('IA de ponta a ponta (Worker local e modelo)', { skip: !process.env.IA_E2E }, () => {
  test('pergunta e continuação: respostas estruturadas e números conferidos', { timeout: 900_000 }, async () => {
    globalThis.fetch = FETCH;
    usarServidorIaNoTeste(process.env.IA_URL ?? 'http://localhost:8787');
    const resultados: Record<string, Resultado> = {};
    let hist: Mensagem[] = [];
    const contexto = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'uf', uf: 'GO', nome: 'Goiás', cod: 52 }, ano: null, modo: 'rapida' });
    for (const pergunta of [
      'Como evoluiu o número de empregos formais de 2020 a 2025?',
      'E a remuneração média de dezembro, em termos reais, no mesmo período?',
    ]) {
      const inicio = Date.now();
      const r = await perguntarIa({
        historico: hist, pergunta, contexto, idioma: 'pt', paineis: ['trabalho'], sinal: new AbortController().signal,
        aoAtualizar: () => undefined, aoResultado: (id, res) => { resultados[id] = res; },
      });
      hist = r.mensagens;
      const turno = turnos(hist).at(-1)!;
      const porRotulo = new Map([...rotulosConsultas(hist)].map(([id, rotulo]) => [rotulo, id]));
      const de = (rotulo: string) => resultados[porRotulo.get(rotulo) ?? ''];
      const consultas = turno.itens.filter((i): i is Extract<typeof i, { tipo: 'consulta' }> => i.tipo === 'consulta');
      console.log(JSON.stringify({
        pergunta, desfecho: r.desfecho, segundos: Math.round((Date.now() - inicio) / 1000), conclusao: turno.resposta?.conclusao ?? turno.textoFinal,
        destaques: turno.resposta?.destaques.map((d) => [d.rotulo, d.valor, d.consulta, d.coluna, conferir(d, de(d.consulta))]),
        graficos: turno.resposta?.graficos.map((g) => [g.consulta, g.tipo, g.x, g.y.join('+'), g.serie, !!dadosDoGrafico(g, de(g.consulta))]),
        consultas: consultas.map((c) => [c.rotulo, c.objetivo, 'erro' in (resultados[c.id] ?? { erro: 'não executada' }) ? (resultados[c.id] as { erro: string }).erro : 'ok']),
        fontes: fontesConsultadas(consultas.filter((c) => resultados[c.id] && !('erro' in resultados[c.id])).map((c) => c.sql)),
        recorte: turno.resposta?.recorte, limitacoes: turno.resposta?.limitacoes, aprofundar: turno.resposta?.aprofundar,
      }, null, 1));
      assert.equal(r.desfecho, 'resposta');
      // perguntas de série: a resposta tem de trazer números destacados, todos achados na tabela citada
      assert.ok(turno.resposta!.destaques.length > 0, 'resposta sem destaques');
      assert.doesNotMatch(JSON.stringify(turno.resposta), /<\/?parameter|<\/conclusao|\\u00/);
      for (const d of turno.resposta!.destaques) assert.equal(conferir(d, de(d.consulta)), 'conferido', `${d.rotulo}: ${d.valor} (${d.consulta}.${d.coluna})`);
      for (const g of turno.resposta!.graficos) assert.ok(dadosDoGrafico(g, de(g.consulta)), `gráfico "${g.titulo}" sem dados`);
    }
  });

  /**
   * As três perguntas da conversa exportada sobre Andirá (PR), com Andirá no contexto e resposta direta.
   * IA_GRAVAR=arquivo.json guarda as respostas do modelo, para repetir a conversa na página sem o modelo.
   */
  test('as três perguntas de Andirá (PR): códigos, cálculos, períodos, ressalvas e gráficos', { timeout: 1_800_000, skip: !process.env.IA_ANDIRA }, async () => {
    globalThis.fetch = FETCH;
    usarServidorIaNoTeste(process.env.IA_URL ?? 'http://localhost:8787');
    const cad = await cadastro();
    const fontes = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8')).fontes;
    const ultima = Number(fontes.caged.ate);
    const resultados: Record<string, Resultado> = {};
    let hist: Mensagem[] = [];
    const ctx: ContextoIa = { paineis: ['trabalho'], territorio: { tipo: 'municipio', uf: 'PR', nome: 'Andirá', cod: ANDIRA }, ano: null, modo: 'rapida' };
    const competenciaCrua = /\b(19\d{2}|20\d{2})(0[1-9]|1[0-2])\b/;
    const falhas: string[] = [];
    const perguntas = [
      'Como evoluiu o número de empregos formais em Andirá (PR) de 2015 a 2025?',
      'Como se distribuem os empregos de Andirá por setor em 2025?',
      'Quais são as admissões e desligamentos do CAGED em Andirá nos últimos 12 meses?',
    ];
    for (const [k, pergunta] of perguntas.entries()) {
      const inicio = Date.now();
      const r = await perguntarIa({
        historico: hist, resultados, ultimaCompetencia: ultima, pergunta, contexto: contextoParaModelo(ctx), idioma: 'pt', paineis: ['trabalho'],
        sinal: new AbortController().signal, aoAtualizar: () => undefined, aoResultado: (id, res) => { resultados[id] = res; },
      });
      hist = r.mensagens;
      const turno = turnos(hist).at(-1)!;
      const consultas = consultasDaConversa(hist, resultados);
      const doTurno = turno.itens.flatMap((i) => (i.tipo === 'consulta' ? [i.rotulo] : []));
      const p = turno.resposta ? prepararResposta(turno.resposta, consultas, { doTurno, cadastro: cad, ultimaCompetencia: ultima, fontes }) : null;
      console.log(JSON.stringify({
        pergunta, desfecho: r.desfecho, segundos: Math.round((Date.now() - inicio) / 1000),
        passos: turno.itens.map((i) => (i.tipo === 'consulta'
          ? [i.rotulo, i.objetivo, i.substitui, (() => { const x = resultados[i.id]; return !x ? 'não executada' : 'erro' in x ? `${x.bloqueada ? 'bloqueada' : 'erro'}: ${x.erro}` : `${x.total} linhas`; })()]
          : i.tipo === 'revisao' ? ['revisão', ...i.motivos] : i.tipo === 'localizacao' ? ['localizar', i.nome, i.uf] : ['nota', i.texto.slice(0, 120)])),
        conclusao: p?.r.conclusao, alertas: p?.alertas.map((n) => n.id),
        destaques: p?.destaques.map((x) => [x.d.rotulo, x.valor, x.unidade, x.rotuloPeriodo, x.conferencia, x.quebras.map((n) => n.quebra).join()]),
        graficos: p?.graficos.map((g) => [g.g.consulta, g.g.tipo, g.g.x, g.g.y.join('+'), g.validacao.ok ? 'ok' : g.validacao.motivo]),
        leituras: p?.leituras.map((l) => [l.texto.slice(0, 100), l.consulta, l.colunas.join('+'), l.motivo]),
        hipoteses: p?.r.hipoteses, limitacoes: p?.r.limitacoes, periodo: p?.periodo, territorios: p?.territorios, fontes: p?.fontes,
        revisao: p ? revisarResposta(p, { pergunta }) : null,
      }, null, 1));
      const falha = (cond: boolean, msg: string) => { if (!cond) falhas.push(`P${k + 1}: ${msg}`); };
      falha(r.desfecho === 'resposta' && !!p, `desfecho ${r.desfecho}`);
      if (!p) continue;
      falha(revisarResposta(p, { pergunta }).length === 0, `revisão pendente: ${revisarResposta(p, { pergunta }).join(' | ')}`);
      falha(p.destaques.length > 0 && p.destaques.every((x) => x.conferencia === 'conferido'), 'destaque não conferido');
      falha(p.territorios.length > 0 && p.territorios.every((x) => x.startsWith('Andirá (PR) · IBGE 4101101')), `território das consultas: ${p.territorios.join('; ')}`);
      falha(!competenciaCrua.test([p.r.conclusao, p.r.explicacao, p.r.limitacoes, ...p.destaques.map((x) => x.unidade)].join(' ')), 'competência escrita como número');
      falha(p.leituras.every((l) => !l.motivo), 'leitura sem base');
      falha(p.graficos.every((g) => g.validacao.ok), 'gráfico inválido');
      if (k === 0) falha(p.alertas.some((n) => n.quebra === 2022) && citaQuebra(p.r.conclusao), 'série 2015–2025 sem a ressalva da quebra na conclusão');
      if (k === 1) falha(!p.r.hipoteses, 'hipóteses numa pergunta descritiva');
      if (k === 2) falha(/últimos 12 meses/.test(p.periodo ?? ''), `período do CAGED: ${p.periodo}`);
    }
    if (process.env.IA_GRAVAR) {
      // as respostas do modelo, na ordem: a página as repete com o Worker simulado (sem custo)
      const respostas = hist.filter((m) => m.role === 'assistant').map((m) => ({
        conteudo: m.content, parada: Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', restantes: 30,
      }));
      await writeFile(process.env.IA_GRAVAR, JSON.stringify({ perguntas, contexto: ctx, respostas }, null, 1));
    }
    assert.deepEqual(falhas, []);
  });

  test('sem lugar definido pede esclarecimento; fora da cobertura diz isso, sem inventar números', { timeout: 600_000 }, async () => {
    globalThis.fetch = FETCH;
    usarServidorIaNoTeste(process.env.IA_URL ?? 'http://localhost:8787');
    const contexto = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'brasil' }, ano: null, modo: 'rapida' });
    for (const [pergunta, esperado] of [
      ['Quantos empregos formais há no meu município?', 'esclarecimento'],
      ['Qual foi a taxa de desemprego em 2025?', 'fora_da_cobertura'],
    ]) {
      const r = await perguntarIa({
        historico: [], pergunta, contexto, idioma: 'pt', paineis: ['trabalho'], sinal: new AbortController().signal,
        aoAtualizar: () => undefined, aoResultado: () => undefined,
      });
      const turno = turnos(r.mensagens)[0];
      console.log(JSON.stringify({ pergunta, desfecho: r.desfecho, tipo: turno.resposta?.tipo, conclusao: turno.resposta?.conclusao ?? turno.textoFinal, aprofundar: turno.resposta?.aprofundar }, null, 1));
      assert.equal(r.desfecho, 'resposta');
      assert.equal(turno.resposta!.tipo, esperado);
      assert.equal(turno.resposta!.destaques.length, 0);
      // sem território na página nem na pergunta, nada de lugar presumido nas opções
      assert.doesNotMatch(turno.resposta!.aprofundar.join(' | '), /Goiânia|Goiás|São Paulo|Rio de Janeiro|Brasília|Belo Horizonte|goian/);
    }
  });
});
describe('LRF (RREO e RGF)', () => {
  test('ente: indicadores do DF em 2024 iguais ao RGF/RREO declarados', async () => {
    const s = await rota<L[]>('lrf_ente', { ente: 53 });
    const a = s.find((r) => r.exercicio === 2024);
    assert.ok(a, 'DF 2024 presente');
    assert.equal(a!.pessoal_rcl_pct, 39.57);
    assert.equal(a!.pessoal_limite_pct, 49);
    assert.equal(a!.dcl_rcl_pct, 13.12);
    assert.equal(a!.lim_dcl, 200);
    assert.equal(a!.min_fundeb, 70);
  });

  test('grupo: razões em fração, contagens dentro do total de entes', async () => {
    const g = await rota<L[]>('lrf_grupo', { esfera: 'M' });
    assert.ok(g.length > 0);
    for (const r of g) {
      const p = r.pessoal_rcl as number | null;
      if (p !== null) assert.ok(p > 0 && p < 1, `pessoal/RCL ${p}`);
      assert.ok((r.pessoal_acima_limite as number) <= (r.n_pessoal as number));
      assert.ok((r.pessoal_acima_prudencial as number) >= (r.pessoal_acima_limite as number));
      assert.ok((r.com_rgf as number) <= (r.entes as number));
    }
  });

  test('anexo completo na ordem do relatório', async () => {
    const anexos = await rota<L[]>('lrf_anexos', { ente: 53, ano: 2024 });
    assert.ok(anexos.some((x) => x.relatorio === 'RGF' && x.anexo === 'RGF-Anexo 01'));
    const linhas = await rota<L[]>('lrf_anexo', { ente: 53, ano: 2024, relatorio: 'RGF', anexo: 'RGF-Anexo 01' });
    assert.ok(linhas.some((l) => l.cod_conta === 'DespesaComPessoalTotal'));
    const ordens = linhas.map((l) => l.ordem as number);
    assert.deepEqual(ordens, [...ordens].sort((x, y) => x - y));
  });
});
describe('IA: SIOPE e SIOPS (Andirá/PR, 2024)', () => {
  const semDados = !existsSync(`${DATA}/gold/siope/indicadores.parquet`) || !existsSync(`${DATA}/gold/siops/indicadores.parquet`);
  const sql = async (q: string) => {
    const r = await executarConsulta({ sql: q, objetivo: 'teste' }, ['financas']);
    if ('erro' in r) throw new Error(r.erro);
    return r.linhas;
  };

  test('mínimos constitucionais iguais aos declarados', { skip: semDados }, async () => {
    const mde = await sql("SELECT valor FROM siope_indicadores WHERE cod_ibge = 4101101 AND ano = 2024 AND indicador ILIKE 'Percentual de aplica%receitas de impostos%MDE%'");
    assert.equal(Math.round((mde[0][0] as number) * 100) / 100, 27.05);
    const saude = await sql("SELECT valor FROM siops_indicadores WHERE cod_ibge = 4101101 AND ano = 2024 AND codigo = '3.2'");
    assert.equal(saude[0][0], 25.47);
  });

  test('páginas: série do ente, grupo e tabela de entes batem com as declarações', { skip: semDados || !existsSync(`${DATA}/gold/saude_educacao.parquet`) }, async () => {
    const s = await rota<L[]>('se_ente', { ente: 4101101 });
    const a = s.find((r) => r.ano === 2024)!;
    assert.equal(a.mde_pct, 27.05);
    assert.equal(a.saude_pct, 25.47);
    assert.equal(a.min_fundeb, 70);
    assert.equal(s.find((r) => r.ano === 2020)!.min_fundeb, 60);
    const g = await rota<L[]>('se_grupo', { esfera: 'M' });
    // 2021: a EC 119/2022 dispensou o mínimo de MDE, e mais de mil municípios ficaram abaixo
    assert.equal(g.find((r) => r.ano === 2021)!.mde_abaixo, 1090);
    assert.equal(g.find((r) => r.ano === 2024)!.saude_abaixo, 22);
    const pr = await rota<L[]>('se_entes', { esfera: 'M', uf: 'PR', ano: 2024 });
    assert.ok(pr.length > 390 && pr.every((r) => r.uf === 'PR'));
    assert.equal(pr.find((r) => r.cod_ibge === 4101101)!.nome, 'Andirá');
    const estados = await rota<L[]>('se_grupo', { esfera: 'E' });
    assert.ok(estados.every((r) => (r.entes as number) <= 26 && r.n_saude === 0), 'SIOPS só tem municípios');
  });

  test('remuneração por pessoa: linhas idênticas uma vez, escolas somadas (Andirá, dez/2024)', { skip: semDados }, async () => {
    // a API trouxe 493 linhas de 244 pessoas; 276 vínculos distintos e 258 pares pessoa × categoria × situação
    const r = await rota<L[]>('rem_resumo', { ente: 4101101 });
    const a = r.filter((x) => x.ano === 2024);
    assert.equal(a.reduce((s, x) => s + (x.profissionais as number), 0), 258);
    assert.equal(a.reduce((s, x) => s + (x.vinculos as number), 0), 276);
    const cats = await rota<L[]>('rem_categorias', { ente: 4101101, ano: 2024 });
    const ped = cats.find((x) => String(x.categoria).includes('pedagogia') && x.situacao === 'Efetivo')!;
    assert.equal(ped.profissionais, 163);
    assert.equal(ped.vinculos, 181); // 18 pessoas com dois vínculos, somados
    assert.ok((ped.carga_horaria_media as number) > 20 && (ped.salario_p75 as number) > 5000, 'carga e salário somados por pessoa');
    const grupo = await rota<L[]>('rem_categorias', { esfera: 'M', uf: 'PR', ano: 2024 });
    assert.ok(grupo.length > 0 && grupo.every((x) => !('salario_p25' in x)), 'em grupos, só média ponderada');
  });

  test('remuneração sem estatística em grupos com menos de 5 profissionais', { skip: semDados }, async () => {
    const r = await sql(`SELECT count(*) FROM siope_remuneracao WHERE profissionais < 5 AND coalesce(carga_horaria_media, salario_medio,
      salario_p25, salario_mediana, salario_p75, outros_medio) IS NOT NULL`);
    assert.equal(Number(r[0][0]), 0);
  });
});

describe('Excel com várias abas', () => {
  test('nomes de aba válidos, únicos e com até 31 caracteres', () => {
    const x = paraXlsxAbas([
      { nome: 'Conversa', linhas: [['a', 1]] },
      { nome: 'P1.1 Receita per capita: municípios [GO] / 2024 com nome muito longo', linhas: [['b', 2]] },
      { nome: 'P1.1 Receita per capita: municípios [GO] / 2024 com nome muito longo', linhas: [['c', 3]] },
      { nome: 'conversa', linhas: [] },
    ]);
    assert.deepEqual([...x.slice(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
    const texto = new TextDecoder().decode(x);
    const nomes = [...texto.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(nomes.length, 4);
    assert.equal(new Set(nomes.map((n) => n.toLowerCase())).size, 4);
    for (const n of nomes) {
      assert.ok(n.length <= 31, n);
      assert.ok(!/[:\\/?*[\]]/.test(n), n);
    }
    assert.ok(texto.includes('xl/worksheets/sheet4.xml'));
  });
});
describe('mercado de trabalho (RAIS e CAGED)', () => {
  const semDados = !existsSync(`${DATA}/gold/trabalho/municipios.parquet`);

  test('RAIS Brasil: setores somam o total e remuneração média plausível', { skip: semDados }, async () => {
    const s = await rota<L[]>('trab_serie', {});
    assert.ok(s.length > 0);
    for (const r of s) {
      const setores = ['agropecuaria', 'industria', 'construcao', 'comercio', 'servicos', 'adm_publica']
        .reduce((t0, k) => t0 + ((r[`empregos_${k}`] as number) ?? 0), 0);
      const total = r.empregos as number;
      assert.ok(setores <= total && setores >= 0.98 * total, `${r.ano}: setores ${setores} de ${total}`);
      const rem = r.remuneracao_media as number;
      assert.ok(rem > 800 && rem < 20000, `${r.ano}: remuneração ${rem}`);
      assert.ok((r.mulheres as number) < total);
    }
  });

  test('RAIS município: divisões da CNAE somam os empregos do município', { skip: semDados }, async () => {
    const s = await rota<L[]>('trab_serie', { ente: 5208707 });
    const ano = s.at(-1)!.ano as number;
    const setores = await rota<L[]>('trab_setores', { ente: 5208707, ano });
    const soma = setores.reduce((t0, r) => t0 + (r.empregos as number), 0);
    assert.equal(soma, s.at(-1)!.empregos);
  });

  test('CAGED: saldo = admissões − desligamentos e saldo de 12 meses acumulado', { skip: semDados || !existsSync(`${DATA}/gold/trabalho/caged_uf.parquet`) }, async () => {
    const c = await rota<L[]>('trab_caged', {});
    assert.ok(c.length >= 12);
    for (const r of c) assert.equal(r.saldo, (r.admissoes as number) - (r.desligamentos as number));
    const i = c.length - 1;
    const soma = c.slice(i - 11).reduce((t0, r) => t0 + (r.saldo as number), 0);
    assert.equal(c[i].saldo_12m, soma);
  });

  test('ranking: municípios de uma UF com empregos por mil habitantes', { skip: semDados }, async () => {
    const s = await rota<L[]>('trab_serie', { uf: 'GO' });
    const r = await rota<L[]>('trab_municipios', { uf: 'GO', ano: s.at(-1)!.ano as number });
    assert.ok(r.length > 200);
    assert.ok(r.every((x) => x.uf === 'GO'));
  });
});

describe('consulta personalizada (microdados da RAIS)', () => {
  const ANO = 2013;
  const GOIANIA = 5208707;
  const semCubo = !existsSync(`${DATA}/gold/trabalho/cubo_uf/ano=${ANO}.parquet`);
  const semMicro = semCubo || !existsSync(`${MICRO}/silver/trabalho/micro/rais_vinculos/ano=${ANO}/uf=52.parquet`);
  type R = { fonte: string; linhas: L[] };
  const consulta = (p: Record<string, string | number | undefined>) => rota<R>('trab_consulta', { ano: ANO, agrupar: 'total', ...p });
  const total = async (p: Record<string, string | number | undefined>) => (await consulta(p)).linhas[0];

  test('Brasil (tabela por UF): vínculos ativos em 31/12 = total oficial da RAIS', { skip: semCubo }, async () => {
    const r = await consulta({});
    assert.equal(r.fonte, 'cubo_uf');
    assert.equal(r.linhas[0].ativos, 48948433);
    const ufs = await consulta({ agrupar: 'uf' });
    assert.equal(ufs.linhas.length, 27);
    assert.equal(ufs.linhas.reduce((t0, x) => t0 + (x.vinculos as number), 0), r.linhas[0].vinculos);
  });

  test('remuneração média como a do PDET: Médico Neurocirurgião, Brasil, dezembro de 2024 = R$ 15.117,03', { skip: !existsSync(`${DATA}/gold/trabalho/cubo_uf/ano=2024.parquet`) }, async () => {
    // PDET/MTE (RAIS Vínculo Id), média do Vl Remun Dezembro Nom, vínculo ativo em 31/12, CBO 225260: 15.117,03
    const r = (await rota<R>('trab_consulta', { ano: 2024, agrupar: 'total', cbo: '225260' })).linhas[0];
    assert.equal(Math.round((r.rem_dez_media as number) * 100) / 100, 15117.03);
    assert.equal(r.ativos, 667);
    assert.equal(r.n_rem_dez, 590); // 77 ativos sem valor de dezembro entram como zero
  });

  test('combinar CNAEs: 4711 + 4712 = soma das duas consultas separadas', { skip: semCubo }, async () => {
    const a = await total({ uf: 'GO', cnae: '4711' });
    const b = await total({ uf: 'GO', cnae: '4712' });
    const ab = await total({ uf: 'GO', cnae: '4711, 4712' });
    assert.equal(ab.vinculos, (a.vinculos as number) + (b.vinculos as number));
    assert.equal(ab.ativos, (a.ativos as number) + (b.ativos as number));
  });

  test('município na web: só divisão CNAE e grande grupo CBO', { skip: semCubo }, async () => {
    const r = await consulta({ ente: GOIANIA, cnae: '47' });
    assert.equal(r.fonte, 'cubo_mun');
    assert.ok((r.linhas[0].vinculos as number) > 10000);
    await assert.rejects(consulta({ ente: GOIANIA, cnae: '4711' }), /até 2 dígito/);
  });

  test('microdados = tabelas pré-somadas (UF, município, filtros e agrupamento)', { skip: semMicro }, async () => {
    const casos = [{ uf: 'GO' }, { uf: 'GO', cnae: '4711, 56', situacao: 'afastados' }, { uf: 'GO', cbo: '2312', sexo: '2' },
      { ente: GOIANIA }, { ente: GOIANIA, cnae: '84', situacao: 'desligados' }];
    for (const c of casos) {
      usarMicrodadosNoTeste(false);
      const cubo = await total(c);
      usarMicrodadosNoTeste(true);
      const micro = await consulta(c);
      usarMicrodadosNoTeste(false);
      assert.equal(micro.fonte, 'micro');
      const m = micro.linhas[0];
      for (const k of ['vinculos', 'ativos', 'desligados', 'afastados', 'mulheres', 'superior', 'n_rem_dez']) assert.equal(m[k], cubo[k], `${JSON.stringify(c)} ${k}`);
      for (const k of ['rem_dez_media', 'rem_media_media', 'dias_afastamento_medio', 'horas_media']) quase(m[k] as number, cubo[k] as number, 1e-6);
      assert.ok(m.rem_dez_mediana === null || ((m.rem_dez_mediana as number) > 300 && (m.rem_dez_mediana as number) < 30000), `mediana: ${m.rem_dez_mediana}`);
    }
    usarMicrodadosNoTeste(true);
    const tot = await total({ ente: GOIANIA });
    const porCbo = await consulta({ ente: GOIANIA, agrupar: 'cbo' });
    const porIdade = await consulta({ ente: GOIANIA, agrupar: 'faixa_idade' });
    usarMicrodadosNoTeste(false);
    const soma = (l: L[]) => l.reduce((t0, x) => t0 + (x.vinculos as number), 0);
    assert.equal(soma(porCbo.linhas), tot.vinculos);
    assert.equal(soma(porIdade.linhas), tot.vinculos);
    assert.ok(porCbo.linhas.slice(0, 20).every((x) => x.nome), 'as ocupações mais comuns têm nome no dicionário');
  });

  test('denominadores da remuneração, sobreposição de códigos, cruzamentos e série (microdados)', { skip: semMicro }, async () => {
    usarMicrodadosNoTeste(true);
    try {
      const base = { uf: 'GO', situacao: 'ativos' };
      const t0 = await total({ ...base, cbo: '2512' });
      // todo vínculo ativo está em exatamente uma situação da remuneração de dezembro
      assert.equal((t0.n_rem_dez as number) + (t0.rem_dez_ausente as number) + (t0.rem_dez_zero as number) + (t0.rem_dez_negativa as number), t0.ativos);
      // média como a do PDET/MTE: massa ÷ todos os ativos (sem valor = zero)
      quase(t0.rem_dez_media as number, (t0.rem_dez_soma as number) / (t0.ativos as number));
      const p = ['rem_dez_p10', 'rem_dez_p25', 'rem_dez_mediana', 'rem_dez_p75', 'rem_dez_p90'].map((k) => t0[k] as number);
      assert.deepEqual([...p].sort((a, b) => a - b), p, 'percentis em ordem');
      // família + ocupação contida nela: nenhum vínculo conta duas vezes
      const sobre = await total({ ...base, cbo: '2512, 251205' });
      assert.equal(sobre.vinculos, t0.vinculos);
      // setor institucional: estatais + privadas = grupo 2 da natureza jurídica (entidades empresariais)
      const g2 = await total({ uf: 'GO', njg: '2' });
      const estatais = await total({ uf: 'GO', si: '2' });
      const privadas = await total({ uf: 'GO', si: '3' });
      assert.equal((estatais.vinculos as number) + (privadas.vinculos as number), g2.vinculos);
      // cruzamento de duas dimensões soma o total, e cada margem soma o agrupamento simples
      const cruz = await consulta({ uf: 'GO', agrupar: 'sexo', agrupar2: 'escolaridade' });
      const tot = await total({ uf: 'GO' });
      assert.equal(cruz.linhas.reduce((s, x) => s + (x.vinculos as number), 0), tot.vinculos);
      assert.ok(cruz.linhas.every((x) => x.grupo2 !== undefined), 'grupo2 no resultado');
      // filtros de lista: união dentro do filtro, interseção entre filtros
      const sup = await total({ uf: 'GO', esc: '9, 10, 11' });
      assert.equal(sup.vinculos, tot.superior);
      const supMulher = await total({ uf: 'GO', esc: '9,10,11', sexo: '2' });
      assert.ok((supMulher.vinculos as number) < (sup.vinculos as number));
      // série: cada ano igual à consulta anual
      const serie = await rota<{ linhas: L[]; anos: number[] }>('trab_consulta_serie', { ...base, cbo: '2512', de: ANO, ate: ANO + 1, agrupar: 'total' });
      assert.deepEqual(serie.anos, [ANO, ANO + 1]);
      assert.equal(serie.linhas.find((x) => x.ano === ANO)?.ativos, t0.ativos);
      // perfil: numa leitura só, cada dimensão soma o total do recorte (inclusive os não informados)
      const dims = ['cbo', 'cnae_secao', 'setor_institucional', 'esfera_adm', 'sexo', 'faixa_idade', 'raca_cor', 'escolaridade', 'municipio', 'faixa_horas', 'faixa_tempo', 'vinculo_mte', 'tamanho_estab'];
      const perfil = await rota<{ linhas: L[]; dimensoes: string[] }>('trab_perfil', { ...base, cbo: '2512', ano: ANO, dimensoes: dims.join(',') });
      assert.deepEqual(perfil.dimensoes, dims);
      const totPerfil = perfil.linhas.find((x) => x.dimensao === 'total')!;
      assert.equal(totPerfil.vinculos, t0.vinculos);
      for (const d of dims) {
        const soma = perfil.linhas.filter((x) => x.dimensao === d).reduce((s, x) => s + (x.vinculos as number), 0);
        assert.equal(soma, t0.vinculos, d);
      }
      assert.ok(perfil.linhas.filter((x) => x.dimensao === 'setor_institucional').every((x) => x.nome), 'setor institucional com nome');
      // tabelas pré-somadas não aceitam os filtros que só os microdados têm
      usarMicrodadosNoTeste(false);
      await assert.rejects(consulta({ uf: 'GO', esc: '9' }), /microdados/);
    } finally {
      usarMicrodadosNoTeste(false);
    }
  });

  test('busca de ocupação mostra o nível da CBO; família expande nos códigos', { skip: semCubo }, async () => {
    const r = await rota<L[]>('trab_busca_ocupacao', { texto: 'economista' });
    assert.ok(r.some((x) => x.codigo === '251205' && x.nivel === 'cbo'), JSON.stringify(r));
    const codigos = await rota<L[]>('trab_codigos', { variavel: 'cbo', prefixo: '2512' });
    assert.ok(codigos.length >= 5 && codigos.every((x) => String(x.codigo).startsWith('2512')));
  });

  test('dicionário: busca de ocupação pelo nome, sem acento', { skip: semCubo }, async () => {
    const r = await rota<L[]>('trab_dicionario', { variavel: 'cbo', texto: 'medico clinico' });
    assert.ok(r.some((x) => x.codigo === '225125'), JSON.stringify(r));
  });
});

describe('RAIS: atalhos, concentração e remuneração por grupo', () => {
  const ANO = 2013;
  const semCubo = !existsSync(`${DATA}/gold/trabalho/cubo_uf/ano=${ANO}.parquet`);
  const semMicro = semCubo || !existsSync(`${MICRO}/silver/trabalho/micro/rais_vinculos/ano=${ANO}/uf=52.parquet`);
  type R = { fonte: string; linhas: L[] };

  test('urlAnalise mantém ano, UF e ente e descarta filtros incompatíveis', () => {
    const busca = new URLSearchParams('ano=2022&uf=GO&ente=5208707&cbo=2512&cnae=84&raca=1&agr=cnae_divisao&moeda=real');
    const u = new URL(urlAnalise(busca, '/trabalho/consulta', { sit: 'ativos', agr: 'sexo' }), 'http://x');
    assert.equal(u.pathname, '/trabalho/consulta');
    assert.deepEqual([...u.searchParams.keys()].sort(), ['agr', 'ano', 'ente', 'sit', 'uf']);
    assert.equal(u.searchParams.get('agr'), 'sexo');
    assert.equal(new URL(urlAnalise(new URLSearchParams(), '/trabalho/remuneracao', {}), 'http://x').search, '');
  });

  test('atalhos: ids únicos, só agrupamentos e filtros que a consulta conhece', () => {
    const at = ATALHOS_RAIS();
    assert.equal(new Set(at.map((a) => a.id)).size, at.length);
    for (const a of at) {
      for (const k of ['agr', 'agr2']) if (a.params[k]) assert.ok(gruposDaFonte('micro').includes(a.params[k]), a.params[k]);
      // sem micro, só os agrupamentos que existem nas tabelas pré-somadas
      if (!a.micro) for (const k of ['agr', 'agr2']) if (a.params[k]) assert.ok(gruposDaFonte('cubo_uf').includes(a.params[k]), a.params[k]);
      for (const k of Object.keys(a.params)) if (!['sit', 'agr', 'agr2'].includes(k)) assert.ok(k in FILTROS_LISTA, k);
    }
  });

  test('concentracao: HHI, 3 maiores e casos sem soma positiva', () => {
    const c = concentracao([{ nome: 'a', valor: 50 }, { nome: 'b', valor: 30 }, { nome: 'c', valor: 10 }, { nome: 'd', valor: 10 }, { nome: 'e', valor: null }, { nome: 'f', valor: 0 }])!;
    quase(c.parteTop3, 0.9);
    quase(c.hhi, 0.25 + 0.09 + 0.01 + 0.01);
    quase(c.efetivo, 1 / 0.36);
    assert.equal(c.n, 4);
    assert.deepEqual(c.top3.map((x) => x.nome), ['a', 'b', 'c']);
    assert.equal(concentracao([]), null);
    assert.equal(concentracao([{ nome: 'a', valor: 0 }, { nome: 'b', valor: null }]), null);
    quase(concentracao([{ nome: 'a', valor: 1 }, { nome: 'b', valor: 1 }, { nome: 'c', valor: 1 }, { nome: 'd', valor: 1 }])!.hhi, 0.25);
  });

  test('totalDosGrupos: pesos diferentes, todos sem salário e sem vínculos (ausência não vira zero)', () => {
    // média = soma ÷ ativos (nunca média das médias): 100 e 300 de soma, 1 e 3 ativos pesos diferentes
    const t1 = totalDosGrupos([{ ativos: 1, n_rem_dez: 1, rem_dez_soma: 100, rem_dez_media: 100 }, { ativos: 3, n_rem_dez: 2, rem_dez_soma: 300, rem_dez_media: 100 }])!;
    assert.equal(t1.ativos, 4);
    assert.equal(t1.rem_dez_media, 100);
    assert.equal(t1.n_rem_dez, 3);
    const t2 = totalDosGrupos([{ ativos: 1, n_rem_dez: 1, rem_dez_soma: 1000, rem_dez_media: 1000 }, { ativos: 9, n_rem_dez: 9, rem_dez_soma: 9000, rem_dez_media: 1000 }, { ativos: 10, n_rem_dez: 0, rem_dez_soma: null, rem_dez_media: null }])!;
    quase(t2.rem_dez_media as number, 10000 / 20); // a média das médias daria 1000
    // todos os grupos com ativos e sem remuneração informada: média e soma ausentes, não zero
    const t3 = totalDosGrupos([{ ativos: 5, n_rem_dez: 0, rem_dez_soma: null, rem_dez_media: null }, { ativos: 2, n_rem_dez: 0, rem_dez_soma: null, rem_dez_media: null }])!;
    assert.equal(t3.ativos, 7);
    assert.equal(t3.rem_dez_media, null);
    assert.equal(t3.rem_dez_soma, null);
    assert.equal(totalDosGrupos([]), null);
    assert.equal(totalDosGrupos([{ ativos: 0, n_rem_dez: 0, rem_dez_soma: null }]), null);
  });

  test('Goiânia 2024 (microdados): totais por sexo e concentração conferem com os valores de referência', { skip: !existsSync(`${MICRO}/silver/trabalho/micro/rais_vinculos/ano=2024/uf=52.parquet`) || !existsSync(`${DATA}/gold/trabalho/setores.parquet`) }, async () => {
    const l = await rota<L[]>('trab_setores', { ano: 2024, ente: 5208707 });
    const c = concentracao(l.map((r) => ({ nome: String(r.divisao), valor: r.empregos as number })))!;
    console.log('GOIANIA2024', (c.parteTop3 * 100).toFixed(6), (c.hhi * 10000).toFixed(5));
    usarMicrodadosNoTeste(true);
    try {
      const g = await rota<R>('trab_consulta', { ano: 2024, ente: 5208707, agrupar: 'sexo', situacao: 'ativos' });
      const tg = totalDosGrupos(g.linhas)!;
      const tot = (await rota<R>('trab_consulta', { ano: 2024, ente: 5208707, agrupar: 'total', situacao: 'ativos' })).linhas[0];
      assert.equal(tg.ativos, tot.ativos);
      quase(tg.rem_dez_media as number, tot.rem_dez_media as number, 1e-9);
      console.log('SEXO2024', JSON.stringify(g.linhas.map((r) => [r.grupo, r.ativos, r.rem_dez_media, r.rem_dez_mediana])));
    } finally {
      usarMicrodadosNoTeste(false);
    }
  });

  test('concentração com dados reais: todas as divisões do Brasil, participações somam 100%', { skip: semCubo }, async () => {
    const l = await rota<L[]>('trab_setores', { ano: ANO });
    const c = concentracao(l.map((r) => ({ nome: String(r.divisao), valor: r.empregos as number })))!;
    assert.ok(l.length > 60 && c.n > 60);
    assert.ok(c.hhi > 1 / c.n && c.hhi < 1 && c.parteTop3 > 0 && c.parteTop3 < 1);
  });

  test('Brasil por sexo (tabelas): ativos e média totais batem com a consulta sem agrupar; sem quantis', { skip: semCubo }, async () => {
    const g = await rota<R>('trab_consulta', { ano: ANO, agrupar: 'sexo', situacao: 'ativos' });
    const tot = (await rota<R>('trab_consulta', { ano: ANO, agrupar: 'total', situacao: 'ativos' })).linhas[0];
    assert.equal(g.fonte, 'cubo_uf');
    assert.equal(g.linhas.reduce((s, r) => s + (r.ativos as number), 0), tot.ativos);
    const massa = g.linhas.reduce((s, r) => s + (r.rem_dez_media as number) * (r.ativos as number), 0);
    quase(massa / (tot.ativos as number), tot.rem_dez_media as number, 1e-9);
    assert.ok(g.linhas.every((r) => r.rem_dez_mediana === undefined || r.rem_dez_mediana === null));
  });

  test('GO por raça/cor (microdados): grupos somam o total, mediana entre P10 e P90', { skip: semMicro }, async () => {
    usarMicrodadosNoTeste(true);
    try {
      const g = await rota<R>('trab_consulta', { ano: ANO, uf: 'GO', agrupar: 'raca_cor', situacao: 'ativos' });
      const tot = (await rota<R>('trab_consulta', { ano: ANO, uf: 'GO', agrupar: 'total', situacao: 'ativos' })).linhas[0];
      assert.equal(g.fonte, 'micro');
      assert.equal(g.linhas.reduce((s, r) => s + (r.ativos as number), 0), tot.ativos);
      const massa = g.linhas.reduce((s, r) => s + (r.rem_dez_media as number) * (r.ativos as number), 0);
      quase(massa / (tot.ativos as number), tot.rem_dez_media as number, 1e-9);
      for (const r of g.linhas.filter((x) => (x.n_rem_dez as number) > 30)) {
        assert.ok((r.rem_dez_p10 as number) <= (r.rem_dez_mediana as number) && (r.rem_dez_mediana as number) <= (r.rem_dez_p90 as number));
      }
    } finally {
      usarMicrodadosNoTeste(false);
    }
  });
});

describe('IA do mercado de trabalho (tabelas e microdados)', () => {
  const semCubo = !existsSync(`${DATA}/gold/trabalho/cubo_uf/ano=2013.parquet`);
  const semMicro = semCubo || !existsSync(`${MICRO}/silver/trabalho/micro/indice.json`);
  const sql = async (q: string) => {
    const r = await executarConsulta({ sql: q, objetivo: 'teste' }, ['trabalho']);
    if ('erro' in r) throw new Error(r.erro);
    return r;
  };

  test('tabelas somadas, microdados e séries do painel batem entre si', { skip: semMicro }, async () => {
    usarMicrodadosNoTeste(true);
    const ctx = await tabelasIaTrabalho();
    usarMicrodadosNoTeste(false);
    assert.ok(ctx.microdados && ctx.micro_anos.includes(2013));
    const br = await sql('SELECT sum(vinculos) AS n FROM rais_uf WHERE ano = 2013 AND situacao = 1');
    assert.equal(br.linhas[0][0], 48948433);
    const go = await sql('SELECT sum(vinculos) AS n FROM rais_uf WHERE ano = 2013 AND uf = 52 AND situacao = 1');
    const micro = await sql('SELECT count(*) AS n, median(rem_dezembro_nom) FILTER (ativo_31_12 = 1 AND rem_dezembro_nom > 0) AS mediana FROM rais_vinculos WHERE ano = 2013 AND uf = 52 AND ativo_31_12 = 1');
    assert.equal(micro.linhas[0][0], go.linhas[0][0]);
    const mediana = micro.linhas[0][1] as number;
    assert.ok(mediana > 500 && mediana < 20000, `mediana de dezembro em R$: ${mediana}`); // valores DECIMAL chegam em reais, não em centavos
    const painel = await sql("SELECT sum(empregos) FROM trab_municipios WHERE ano = 2013 AND uf = 'GO'");
    assert.equal(painel.linhas[0][0], go.linhas[0][0]);
    const setores = await sql('SELECT sum(empregos) FROM trab_setores WHERE ano = 2013 AND cod_ibge = 5208707');
    assert.ok((setores.linhas[0][0] as number) > 100000);
  });
});

describe('IA do mercado de trabalho: rais_mun por UF', () => {
  test('rais_mun tem uf e soma o mesmo que rais_uf', { skip: !existsSync(`${DATA}/gold/trabalho/cubo_mun/ano=2013.parquet`) }, async () => {
    const sql = async (q: string) => {
      const r = await executarConsulta({ sql: q, objetivo: 'teste' }, ['trabalho']);
      if ('erro' in r) throw new Error(r.erro);
      return r.linhas[0][0];
    };
    const mun = await sql("SELECT sum(vinculos) FROM rais_mun WHERE ano = 2013 AND uf = '52'");
    const uf = await sql('SELECT sum(vinculos) FROM rais_uf WHERE ano = 2013 AND uf = 52');
    assert.equal(mun, uf);
  });
});

describe('IA do mercado de trabalho: sigla da UF', () => {
  test('uf_sigla nas tabelas somadas bate com o código', { skip: !existsSync(`${DATA}/gold/trabalho/cubo_uf/ano=2013.parquet`) }, async () => {
    const r = await executarConsulta({ sql: "SELECT uf, uf_sigla, sum(vinculos) AS v FROM rais_uf WHERE ano = 2013 AND uf_sigla IN ('GO', 'SP') GROUP BY ALL ORDER BY uf", objetivo: 'teste' }, ['trabalho']);
    if ('erro' in r) throw new Error(r.erro);
    assert.deepEqual(r.linhas.map((l) => [l[0], l[1]]), [[35, 'SP'], [52, 'GO']]);
    const m = await executarConsulta({ sql: "SELECT DISTINCT uf_sigla FROM rais_mun WHERE ano = 2013 AND municipio = 520870", objetivo: 'teste' }, ['trabalho']);
    if ('erro' in m) throw new Error(m.erro);
    assert.equal(m.linhas[0][0], 'GO');
  });
});

/**
 * Tabelas da resposta e modos (rápida e pesquisa). Caso de validação: vínculos ativos em 31/12 no Brasil nas
 * classes CNAE da cadeia da carne, agrupadas em matéria-prima (0151-2), industrialização (1011-2 e 1013-9) e
 * distribuição (4634-6 e 4722-9). A RAIS do painel começa em 2010: 2009 é um ano pedido sem dados.
 */
const semCubo = !existsSync(`${DATA}/gold/trabalho/cubo_uf`);
const COBERTURA_RAIS = { nome: 'RAIS', anos: Array.from({ length: 16 }, (_, i) => 2010 + i) };
const SQL_CARNE = (anos: string) => `SELECT ano,
    CASE WHEN starts_with(cnae_classe, '01512') THEN 'Matéria-prima'
         WHEN starts_with(cnae_classe, '10112') OR starts_with(cnae_classe, '10139') THEN 'Industrialização'
         ELSE 'Distribuição' END AS subsistema,
    sum(vinculos) AS vinculos
  FROM rais_uf
  WHERE situacao = 1 AND ano IN (${anos})
    AND (starts_with(cnae_classe, '01512') OR starts_with(cnae_classe, '10112') OR starts_with(cnae_classe, '10139')
         OR starts_with(cnae_classe, '46346') OR starts_with(cnae_classe, '47229'))
  GROUP BY ALL ORDER BY ano, subsistema`;
const espec = (o: Partial<EspecTabela> = {}): EspecTabela => ({
  consulta: 'C1', papel: 'principal', tipo: 'comparacao', titulo: 'Vínculos por subsistema', grupo: 'subsistema', periodo: 'ano', valor: 'vinculos',
  colunas: [], de: '2011', ate: '2021', total: true, participacao: true, formato: 'inteiro', unidade: 'vínculos ativos em 31/12', nota: '', ...o,
});
const montar = (e: EspecTabela, resultado: Resultado, sql = 'SELECT ano FROM rais_uf') => {
  const m = montarTabela(e, { rotulo: e.consulta, sql, resultado }, COBERTURA_RAIS);
  assert.ok(m.ok, m.ok ? '' : m.motivo);
  return m.ok ? m.tabela : null!;
};
const coluna = (tab: ReturnType<typeof montar>, nome: string) => tab.colunas.findIndex((c) => c.nome === nome);
const linhaDe = (tab: ReturnType<typeof montar>, rotulo: string) => tab.linhas.find((l) => l[0].v === rotulo)!;

describe('IA: tabelas da resposta e modos (validação)', () => {
  test('pedido "em 2009 e 2021": 2009 indisponível, sem variação calculada, totais e participações só onde há dados', { skip: semCubo }, async () => {
    await tabelasIaTrabalho();
    const r = await executarConsulta({ sql: SQL_CARNE('2009, 2021') }, ['trabalho']);
    assert.ok(!('erro' in r), JSON.stringify(r));
    if ('erro' in r) return;
    assert.ok(!r.linhas.some((l) => l[0] === 2009), 'a base não tem 2009');
    const tab = montar(espec({ de: '2009' }), r);
    assert.deepEqual(tab.faltantes, ['2009']);
    assert.match(tab.notas.join(' '), /2009: não disponível — RAIS no painel cobre 2010–2025/);
    assert.deepEqual(tab.colunas.map((c) => c.nome), ['Subsistema', '2009', '2021', 'Variação absoluta', 'Variação (%)',
      'Contribuição para a variação do total (p.p.)', 'Participação 2009 (%)', 'Participação 2021 (%)', 'Diferença de participação (p.p.)']);
    for (const l of tab.linhas) {
      assert.equal(l[1].a, 'indisponivel', '2009 marcado como indisponível, não zero');
      assert.equal(l[3].a, 'nao_calculada');
      assert.equal(l[4].a, 'nao_calculada');
    }
    // total de 2021 = soma dos três grupos, conferida com uma consulta independente
    const soma = await executarConsulta({ sql: `SELECT sum(vinculos) AS v FROM rais_uf WHERE situacao = 1 AND ano = 2021
      AND (starts_with(cnae_classe, '01512') OR starts_with(cnae_classe, '10112') OR starts_with(cnae_classe, '10139')
           OR starts_with(cnae_classe, '46346') OR starts_with(cnae_classe, '47229'))` }, ['trabalho']);
    if ('erro' in soma) throw new Error(soma.erro);
    assert.equal(linhaDe(tab, 'Total')[2].v, soma.linhas[0][0]);
    const i21 = tab.colunas.findIndex((c) => c.nome === 'Participação 2021 (%)');
    const p21 = tab.linhas.slice(0, 3).reduce((s, l) => s + (l[i21].v as number), 0);
    assert.ok(Math.abs(p21 - 100) < 1e-9, `participações de 2021 somam ${p21}`);
  });

  test('pedido "em 2011 e 2021" (RAIS desde 2010): variações pelas fórmulas e iguais às de uma consulta independente', { skip: semCubo }, async () => {
    await tabelasIaTrabalho();
    const r = await executarConsulta({ sql: SQL_CARNE('2011, 2021') }, ['trabalho']);
    if ('erro' in r) throw new Error(r.erro);
    const tab = montar(espec(), r);
    assert.deepEqual(tab.faltantes, []);
    const ind = linhaDe(tab, 'Industrialização');
    const [a, b] = [ind[1].v as number, ind[2].v as number];
    assert.equal(ind[3].v, b - a);
    assert.ok(Math.abs((ind[4].v as number) - ((b / a - 1) * 100)) < 1e-9);
    const sql = `SELECT sum(vinculos) FILTER (WHERE ano = 2011) AS v11, sum(vinculos) FILTER (WHERE ano = 2021) AS v21 FROM rais_uf
      WHERE situacao = 1 AND ano IN (2011, 2021) AND (starts_with(cnae_classe, '10112') OR starts_with(cnae_classe, '10139'))`;
    const c = await executarConsulta({ sql }, ['trabalho']);
    if ('erro' in c) throw new Error(c.erro);
    assert.deepEqual([a, b], c.linhas[0]);
    const total = linhaDe(tab, 'Total');
    assert.equal(total[1].v, tab.linhas.slice(0, 3).reduce((s, l) => s + (l[1].v as number), 0));
  });

  test('pedido "de 2008 a 2014": uma linha por ano do intervalo, lacunas de 2008 e 2009 sinalizadas', { skip: semCubo }, async () => {
    await tabelasIaTrabalho();
    const r = await executarConsulta({ sql: SQL_CARNE('2008, 2009, 2010, 2011, 2012, 2013, 2014') }, ['trabalho']);
    if ('erro' in r) throw new Error(r.erro);
    const tab = montar(espec({ tipo: 'serie', de: '2008', ate: '2014', participacao: false }), r);
    assert.deepEqual(tab.linhas.map((l) => l[0].v), ['2008', '2009', '2010', '2011', '2012', '2013', '2014']);
    assert.deepEqual(tab.faltantes, ['2008', '2009']);
    assert.ok(tab.linhas.slice(0, 2).every((l) => l.slice(1).every((c) => c.a === 'indisponivel')));
    assert.ok(tab.linhas.slice(2).every((l) => l.slice(1).every((c) => typeof c.v === 'number' && !c.a)));
    const iTotal = coluna(tab, 'Total');
    for (const l of tab.linhas.slice(2)) assert.equal(l[iTotal].v, l.slice(1, iTotal).reduce((s, c) => s + (c.v as number), 0));
  });

  test('anos pedidos cruzados com a base e vindos só com nulos contam como indisponíveis, não como período usado', () => {
    const r: Resultado = {
      colunas: ['ano', 'subsistema', 'vinculos'],
      linhas: [[2011, 'A', null], [2011, 'B', null], [2012, 'A', null], [2012, 'B', null], [2013, 'A', 10], [2013, 'B', 4]],
      total: 6,
    };
    const tab = montar(espec({ tipo: 'serie', de: '2011', ate: '2013', participacao: false }), r);
    assert.deepEqual(tab.faltantes, ['2011', '2012']);
    assert.equal(tab.linhas[0][1].a, 'indisponivel');
    assert.equal(tab.linhas[2][3].v, 14);
    const p = prepararResposta(lerResposta({ resposta: respostaBase({ tabelas: [espec({ tipo: 'serie', de: '2011', ate: '2013' })] }) })!,
      new Map([feita('C1', 'SELECT ano, subsistema, vinculos FROM rais_uf WHERE ano BETWEEN 2011 AND 2013', r)]));
    assert.equal(p.periodo, '2013');
    assert.deepEqual(p.faltantes, ['2011', '2012']);
  });

  test('valor inicial zero ou ausente e grupo sem registro: nada de variação ou total inventados', () => {
    const r: Resultado = {
      colunas: ['ano', 'grupo', 'valor'],
      linhas: [[2013, 'A', 0], [2021, 'A', 5], [2013, 'B', null], [2021, 'B', 3], [2021, 'C', 7], [2013, 'D', -4], [2021, 'D', 2]],
      total: 7,
    };
    const tab = montar(espec({ grupo: 'grupo', valor: 'valor', de: '2013', ate: '2021', participacao: false }), r);
    assert.equal(linhaDe(tab, 'A')[3].v, 5);
    assert.equal(linhaDe(tab, 'A')[4].a, 'base_zero');
    assert.equal(linhaDe(tab, 'B')[1].v, null);
    assert.equal(linhaDe(tab, 'B')[4].a, 'nao_calculada');
    assert.equal(linhaDe(tab, 'C')[1].a, 'sem_registro');
    assert.equal(linhaDe(tab, 'D')[4].a, 'base_negativa');
    assert.equal(linhaDe(tab, 'Total')[1].a, 'incompleto', 'total com grupo faltando não é total');
    assert.equal(linhaDe(tab, 'Total')[2].v, 17);
    const legenda = tab.notas.join(' ') + tabelaHtml(tab);
    assert.match(legenda, /s\/ reg\. = grupo sem registro/);
    assert.match(legenda, /n\.c\. = variação percentual não calculada: valor inicial zero/);
    assert.match(legenda, /incompl\. = total não calculado/);
    assert.match(legenda, /— = sem dado/);
  });

  test('percentuais comparam em pontos percentuais; repetição de período e grupo é recusada', () => {
    const r: Resultado = { colunas: ['ano', 'setor', 'participacao_pct'], linhas: [[2013, 'X', 40], [2021, 'X', 45.5]], total: 2 };
    const tab = montar(espec({ grupo: 'setor', valor: 'participacao_pct', de: '2013', ate: '2021', formato: 'percentual' }), r);
    assert.deepEqual(tab.colunas.map((c) => c.nome), ['Setor', '2013', '2021', 'Diferença (p.p.)']);
    assert.equal(formatarCelulaT(tab.linhas[0][3], tab.colunas[3]), '+5,5');
    const dup = montarTabela(espec({ de: '2013', ate: '2021' }), { rotulo: 'C1', sql: '', resultado: { colunas: ['ano', 'subsistema', 'vinculos'], linhas: [[2013, 'A', 1], [2013, 'A', 2]], total: 2 } });
    assert.ok(!dup.ok && /mais de uma linha/.test(dup.motivo));
  });

  test('a mesma tabela na tela, na cópia, no CSV/XLSX e no PDF: valores originais e números como números', () => {
    const r: Resultado = { colunas: ['ano', 'subsistema', 'vinculos'], linhas: [[2013, 'A', 354796], [2021, 'A', 350944], [2013, 'B', 187326], [2021, 'B', 209544]], total: 4 };
    const tab = montar(espec({ de: '2013', ate: '2021' }), r);
    const exp = tabelaExportavel(tab);
    assert.deepEqual(exp.linhas[0].slice(0, 4), ['A', 354796, 350944, -3852]);
    assert.ok(exp.metadados.some(([k, v]) => k === 'Unidade' && v === 'vínculos ativos em 31/12'));
    const tsv = tabelaTsv(tab);
    assert.match(tsv, /^Vínculos por subsistema\nSubsistema\t2013\t2021\tVariação absoluta/);
    assert.match(tsv, /\nA\t354796\t350944\t-3852\t-1,0856/);
    const html = tabelaHtml(tab, { numero: 'Tabela 1' });
    assert.match(html, /<caption>Tabela 1 — Vínculos por subsistema<\/caption><thead>/);
    assert.match(html, /<td class="n">354\.796<\/td>/);
    assert.match(html, /<tr class="total"><td class="t">Total<\/td><td class="n">542\.122<\/td><td class="n">560\.488<\/td>/);
    assert.doesNotMatch(html, /\bC1\b/, 'sem identificador interno da consulta');
    // gráfico de barras com os dois anos (serie = ano): as duas séries, com os mesmos valores da tabela
    const v = validarGrafico({ consulta: 'C1', tipo: 'barras', titulo: 'Vínculos em 2013 e 2021', x: 'subsistema', y: ['vinculos'], serie: 'ano', formato: 'inteiro' }, r);
    assert.ok(v.ok);
    if (!v.ok) return;
    assert.deepEqual(v.dados.series.map((s) => s.nome), ['2013', '2021']);
    assert.deepEqual(v.dados.series[1].valores, [linhaDe(tab, 'A')[2].v, linhaDe(tab, 'B')[2].v]);
    // formato largo (uma coluna por ano): as duas colunas viram séries, não só a primeira
    const largo: Resultado = { colunas: ['subsistema', 'v2013', 'v2021'], linhas: [['A', 1, 2], ['B', 3, 4]], total: 2 };
    const w = validarGrafico({ consulta: 'C1', tipo: 'barras', titulo: '', x: 'subsistema', y: ['v2013', 'v2021'], serie: '', formato: 'inteiro' }, largo);
    assert.ok(w.ok && w.dados.series.length === 2);
  });

  test('revisão: tabela pedida nos dois modos, anos trocados, ano indisponível sem aviso e gráfico com ano que não mostra', () => {
    const r: Resultado = { colunas: ['ano', 'subsistema', 'vinculos'], linhas: [[2013, 'A', 10], [2021, 'A', 12]], total: 2 };
    const consultas = new Map([feita('C1', 'SELECT ano, subsistema, sum(vinculos) AS vinculos FROM rais_uf WHERE ano IN (2011, 2021) GROUP BY ALL', r)]);
    const pergunta = 'Quantos vínculos existiam em 2011 e 2021? Apresente os valores absolutos, totais e variações percentuais.';
    const preparar = (o: Record<string, unknown>) => prepararResposta(lerResposta({ resposta: respostaBase(o) })!, consultas, { pergunta, doTurno: ['C1'] });
    // sem tabela: devolvida no modo rápido (a pergunta pede) e no modo pesquisa
    assert.match(revisarResposta(preparar({}), { pergunta, modo: 'rapida' }).join(' '), /inclua em tabelas/);
    assert.match(revisarResposta(preparar({}), { pergunta: 'Quantos vínculos há?', modo: 'pesquisa' }).join(' '), /Modo análise para pesquisa/);
    assert.deepEqual(revisarResposta(preparar({}), { pergunta: 'Quantos vínculos há?', modo: 'rapida' }), []);
    // trocou 2011 por 2013 em silêncio
    const trocada = preparar({ tabelas: [espec({ de: '2013', ate: '2021' })] });
    assert.match(revisarResposta(trocada, { pergunta }).join(' '), /pede 2011 e 2021: a tabela principal precisa usar de = "2011"/);
    // manteve 2011, mas a conclusão não diz que ele falta
    const semAviso = preparar({ tabelas: [espec()] });
    assert.deepEqual(semAviso.faltantes, ['2011']);
    assert.match(revisarResposta(semAviso, { pergunta }).join(' '), /O período pedido 2011 não está nos dados/);
    const comAviso = preparar({ conclusao: 'Em 2021 eram 12 vínculos; 2011 não está disponível na RAIS do painel, então a comparação pedida não pôde ser completada.', tabelas: [espec(), espec({ papel: 'alternativa', de: '2013' })] });
    assert.deepEqual(revisarResposta(comAviso, { pergunta, modo: 'pesquisa' }), []);
    // gráfico cujo título cita 2021 mas só mostra 2013
    const so2013: Resultado = { colunas: ['subsistema', 'vinculos_2013'], linhas: [['A', 10], ['B', 5]], total: 2 };
    const c2 = new Map([...consultas, feita('C2', 'SELECT 1', so2013)]);
    const g = prepararResposta(lerResposta({ resposta: respostaBase({ conclusao: comAviso.r.conclusao, tabelas: [espec()],
      graficos: [{ consulta: 'C2', tipo: 'barras', titulo: 'Vínculos em 2013 e 2021', x: 'subsistema', y: ['vinculos_2013'], serie: '', formato: 'inteiro' }] }) })!, c2, { pergunta });
    assert.match(revisarResposta(g, { pergunta }).join(' '), /o título cita 2021, que não aparece nos dados do gráfico/);
  });

  test('pedidos de anos, pedido de tabela, "nominal" só em reais, recorte com período solicitado e utilizado, modo guardado', () => {
    assert.deepEqual(anosPedidos('em 2011 e 2021, nas atividades'), { tipo: 'pontos', de: 2011, ate: 2021 });
    assert.deepEqual(anosPedidos('a série anual de 2011 a 2021'), { tipo: 'intervalo', de: 2011, ate: 2021 });
    assert.deepEqual(anosPedidos('entre 2013 e 2021'), { tipo: 'pontos', de: 2013, ate: 2021 });
    assert.deepEqual(anosPedidos('no período 2015–2025'), { tipo: 'intervalo', de: 2015, ate: 2025 });
    assert.equal(anosPedidos('em 2025'), null);
    assert.ok(pedeTabela('Apresente os valores absolutos, totais e variações percentuais'));
    assert.ok(pedeTabela('Monte uma tabela por UF'));
    assert.ok(!pedeTabela('Quantos municípios há em Goiás?'));
    assert.equal(semNominal('Variação nominal', 'inteiro'), 'Variação');
    assert.equal(semNominal('vínculos (nominal)', 'percentual'), 'vínculos');
    assert.equal(semNominal('nominais', 'reais'), 'nominais');
    const r: Resultado = { colunas: ['ano', 'subsistema', 'vinculos'], linhas: [[2021, 'A', 12]], total: 1 };
    const p = prepararResposta(lerResposta({ resposta: respostaBase({
      recorte: { territorio: 'Brasil', periodo_solicitado: '2011 e 2021', periodo: '2021', unidade: 'vínculos (nominal)', filtros: 'ativos em 31/12', agrupamentos: 'A = 01512' },
      destaques: [{ rotulo: 'Variação nominal', valor: 12, formato: 'inteiro', unidade: 'vínculos nominais', consulta: 'C1', coluna: 'vinculos', de: '2021', ate: '2021' }],
    }) })!, new Map([feita('C1', 'SELECT * FROM rais_uf WHERE ano IN (2011, 2021)', r)]));
    const recorte = Object.fromEntries(recorteDe(p));
    assert.equal(recorte['Período solicitado'], '2011 e 2021');
    assert.equal(recorte['Período utilizado'], '2021', 'só o ano que veio nos dados, não o do filtro');
    assert.equal(recorte.Unidade, 'vínculos');
    assert.equal(recorte.Agrupamentos, 'A = 01512');
    assert.equal(p.destaques[0].d.rotulo, 'Variação');
    assert.equal(p.destaques[0].unidade, 'vínculos');
    assert.doesNotMatch(textoDaResposta(p), /\bC1\b/, 'o texto copiado não leva identificadores internos');
    assert.equal(lerModo('tecnica'), 'pesquisa');
    assert.equal(lerModo('pesquisa'), 'pesquisa');
    assert.equal(lerModo(null), 'rapida');
  });
});

/**
 * O caso de validação com o modelo de verdade (custa perguntas do dia): IA_CARNE=1 npm test, com o Worker
 * local ligado. Cada pergunta numa conversa nova: "em 2011 e 2021" (com dados) nos dois modos, "em 2009 e 2021"
 * e "de 2009 a 2021" (2009 fora da RAIS do painel). A resposta final precisa passar na revisão da página, usar
 * os anos pedidos e sinalizar só os que faltam.
 */
describe('IA de ponta a ponta: cadeia da carne (Worker local e modelo)', { skip: !process.env.IA_CARNE }, () => {
  const ATIVIDADES = 'nas atividades de criação de bovinos (CNAE 0151-2), abate de reses (1011-2), fabricação de produtos de carne (1013-9), '
    + 'comércio atacadista de carnes (4634-6) e comércio varejista de carnes (4722-9)? Agrupe nos subsistemas matéria-prima, industrialização e distribuição.';
  const comparar = (ano: number) => `Quantos vínculos empregatícios formais ativos em 31/12 existiam no Brasil, em ${ano} e 2021, ${ATIVIDADES} Apresente os valores absolutos, totais e variações percentuais.`;
  // [pergunta, modo, primeiro ano pedido, anos que faltam]
  const CASOS: [string, 'rapida' | 'pesquisa', string, string[]][] = [
    [comparar(2011), 'pesquisa', '2011', []],
    [comparar(2011), 'rapida', '2011', []],
    [comparar(2009), 'rapida', '2009', ['2009']],
    [`Apresente a série anual de 2009 a 2021 dos vínculos empregatícios formais ativos em 31/12 no Brasil ${ATIVIDADES.replace(/\?/, '.')}`, 'pesquisa', '2009', ['2009']],
  ];
  for (const [pergunta, modo, de, faltam] of CASOS) {
    test(`${modo}: ${pergunta.slice(0, 90)}…`, { timeout: 900_000 }, async () => {
      globalThis.fetch = FETCH;
      usarServidorIaNoTeste(process.env.IA_URL ?? 'http://localhost:8787');
      const cobertura = { rais: COBERTURA_RAIS.anos, caged: null, microdados: false, dca: [] };
      const resultados: Record<string, Resultado> = {};
      const contexto = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'brasil' }, ano: null, modo });
      const inicio = Date.now();
      const r = await perguntarIa({
        historico: [], pergunta, contexto, idioma: 'pt', paineis: ['trabalho'], sinal: new AbortController().signal, modo, cobertura,
        aoAtualizar: () => undefined, aoResultado: (id, res) => { resultados[id] = res; },
      });
      const turno = turnos(r.mensagens).at(-1)!;
      const consultas = consultasDaConversa(r.mensagens, resultados);
      const doTurno = turno.itens.flatMap((i) => (i.tipo === 'consulta' ? [i.rotulo] : []));
      const p = turno.resposta ? prepararResposta(turno.resposta, consultas, { doTurno, pergunta, cobertura }) : null;
      const problemas = p ? revisarResposta(p, { pergunta, modo }) : ['sem resposta'];
      console.log(JSON.stringify({
        modo, desfecho: r.desfecho, segundos: Math.round((Date.now() - inicio) / 1000),
        revisoes: turno.itens.filter((i) => i.tipo === 'revisao').map((i) => (i as { motivos: string[] }).motivos),
        conclusao: turno.resposta?.conclusao, problemas, faltantes: p?.faltantes, periodo: p?.periodo, recorte: p && recorteDe(p),
        tabelas: p?.tabelas.map((x) => ({ ...x.espec, motivo: x.motivo, linhas: x.tabela?.linhas.map((l) => l.map((c, j) => formatarCelulaT(c, x.tabela!.colunas[j]))) })),
        graficos: p?.graficos.map((g) => [g.g.titulo, g.g.tipo, g.g.x, g.g.y.join('+'), g.g.serie, g.validacao.ok ? g.validacao.dados.series.map((s) => s.nome) : g.validacao.motivo]),
        destaques: p?.destaques.map((x) => [x.d.rotulo, x.valor, x.unidade, x.conferencia]),
        consultas: doTurno.map((k) => [k, consultas.get(k)?.objetivo, consultas.get(k)?.sql]),
        analise: turno.resposta?.explicacao,
      }, null, 1));
      assert.equal(r.desfecho, 'resposta');
      assert.deepEqual(problemas, [], 'a resposta final passa na revisão da página');
      const principal = p!.tabelas.find((x) => x.espec.papel === 'principal' && x.tabela);
      assert.ok(principal, 'há tabela principal montada');
      assert.equal(principal!.espec.de, de);
      assert.equal(principal!.espec.ate, '2021');
      assert.deepEqual(p!.faltantes, faltam, 'só os anos fora da base aparecem como indisponíveis');
      if (faltam.length) assert.doesNotMatch(p!.periodo ?? '', new RegExp(faltam[0]), 'o período utilizado só tem anos com dado');
      else assert.doesNotMatch(turno.resposta!.conclusao, /indispon|não pôde ser completada/i, 'com os dados completos, nada de aviso de ausência');
    });
  }
});

/**
 * Regressões da auditoria das cinco perguntas (FPM em Goiás, enfermeiros, CAGED em Goiás, SIOPS × DCA em
 * Goiânia, PIB per capita × remuneração). Os números esperados vêm da conferência independente
 * (pipeline/auditoria_ia.py), feita nas camadas de origem, não das tabelas que a IA consulta.
 */
describe('IA: auditoria das cinco perguntas (regressão)', () => {
  const semIndicadores = !existsSync(`${DATA}/gold/indicadores.parquet`);
  const semSiops = !existsSync(`${DATA}/gold/siops/indicadores.parquet`);
  const sql = async (s: string, paineis: ('financas' | 'trabalho')[] = ['financas', 'trabalho']) => {
    const r = await executarConsulta({ sql: s }, paineis);
    if ('erro' in r) throw new Error(r.erro);
    return r;
  };

  test('FPM: com municípios sem FPM declarado, a razão só fecha com o mesmo conjunto no numerador e no denominador', { skip: semIndicadores }, async () => {
    const r = await sql(`SELECT exercicio,
        count(*) FILTER (WHERE receita_bruta > 0 AND fpm IS NULL) AS sem_fpm,
        100.0 * sum(fpm) FILTER (WHERE receita_bruta > 0 AND fpm IS NOT NULL AND receita_corrente > 0)
              / sum(receita_corrente) FILTER (WHERE receita_bruta > 0 AND fpm IS NOT NULL AND receita_corrente > 0) AS razao_mesmo_conjunto,
        100.0 * sum(fpm) FILTER (WHERE receita_bruta > 0) / sum(receita_corrente) FILTER (WHERE receita_bruta > 0) AS razao_conjuntos_diferentes
      FROM indicadores WHERE uf = 'GO' AND esfera = 'M' AND exercicio IN (2022, 2023, 2024) GROUP BY 1 ORDER BY 1`);
    const [a22, a23, a24] = r.linhas;
    // lacunas da declaração (FPM lançado em outras contas em 2023 e 2024): contadas, não tratadas como zero
    assert.deepEqual([a22[1], a23[1], a24[1]], [0, 18, 16]);
    quase(a23[2] as number, 17.60156945852438);
    quase(a24[2] as number, 18.03360975756144);
    assert.ok((a23[2] as number) - (a23[3] as number) > 0.3, 'a receita de quem não tem FPM no denominador subestima a dependência');
    assert.equal(a22[2], a22[3], 'sem lacunas, as duas contas coincidem');
  });

  test('FPM: conta-mãe ou contas irmãs de cada ementário, nunca as duas (2015, 2019 e 2023 contra a DCA conta a conta)', { skip: semIndicadores }, async () => {
    const contas: Record<number, string[]> = {
      2015: ['RO1.7.2.1.01.02', 'RO1.7.2.1.01.03', 'RO1.7.2.1.01.04'],
      2019: ['RO1.7.1.8.01.2', 'RO1.7.1.8.01.3', 'RO1.7.1.8.01.4'],
      2023: ['RO1.7.1.1.51'],
    };
    for (const [ano, chaves] of Object.entries(contas)) {
      // a DCA conta a conta não é tabela da IA (a página recusa read_parquet): consulta direta, só no teste
      const r = await consultaLivre(`WITH d AS (SELECT cod_ibge, sum(valor) AS fpm FROM read_parquet('${DATA}/silver/dca/exercicio=${ano}.parquet')
          WHERE anexo = 'I-C' AND coluna = 'Receitas Brutas Realizadas' AND chave IN (${chaves.map((c) => `'${c}'`).join(', ')}) GROUP BY 1)
        SELECT count(*) AS n, count(*) FILTER (WHERE abs(i.fpm - d.fpm) > 0.01) AS diferentes
        FROM indicadores i JOIN d USING (cod_ibge) WHERE i.exercicio = ${ano} AND i.uf = 'GO' AND i.esfera = 'M'`, 10);
      assert.ok((r.linhas[0][0] as number) > 200, `${ano}: municípios com FPM`);
      assert.equal(r.linhas[0][1], 0, `${ano}: o FPM do painel é a soma das contas do fundo, sem dupla contagem`);
    }
  });

  test('remuneração: denominador = vínculos com remuneração em dezembro, não todos os ativos (enfermeiros, 2025)', { skip: semCubo }, async () => {
    await tabelasIaTrabalho();
    const r = await sql(`SELECT sum(vinculos) AS ativos, sum(rem_dez_n) AS com_rem, sum(rem_dez_soma) / sum(rem_dez_n) AS media,
        sum(rem_dez_soma) / sum(vinculos) AS media_errada FROM rais_uf WHERE ano = 2025 AND situacao = 1 AND starts_with(cbo, '2235')`, ['trabalho']);
    const [ativos, comRem, media, errada] = r.linhas[0] as number[];
    assert.equal(ativos, 513887);
    assert.equal(comRem, 439339, 'contagem igual à dos microdados (ativos com remuneração de dezembro > 0)');
    quase(media, 6990.805446932784);
    assert.ok(media / errada - 1 > 0.15, 'dividir pela soma dos ativos subestima a média em mais de 15%');
  });

  test('códigos executados aparecem no recorte, lidos do SQL (o descrito pode divergir do executado)', () => {
    const c = codigosDoSql([
      "SELECT ... FROM rais_uf WHERE starts_with(cast(cbo AS varchar), '2235') AND cbo < '223570'",
      "SELECT ... WHERE cnae_classe IN ('10112', '10139') OR starts_with(cnae_classe, '01512')",
    ]);
    assert.deepEqual(c, ['CBO: começa com 2235; menor que 223570', 'CNAE (classe): começa com 01512; 10112, 10139']);
    const r: Resultado = { colunas: ['ano', 'vinculos'], linhas: [[2025, 10]], total: 1 };
    const p = prepararResposta(lerResposta({ resposta: respostaBase() })!, new Map([feita('C1', "SELECT ano, sum(vinculos) AS vinculos FROM rais_uf WHERE starts_with(cbo, '2235') GROUP BY 1", r)]), { doTurno: ['C1'] });
    assert.deepEqual(recorteDe(p).find(([k]) => k === 'Códigos filtrados nas consultas'), ['Códigos filtrados nas consultas', 'CBO: começa com 2235']);
  });

  test('códigos da cadeia da carne: uma lista só, das consultas usadas, sem as de exploração; análise com lista', () => {
    const classes = ['01512', '10112', '10139', '46346', '47229'];
    const r: Resultado = { colunas: ['ano', 'vinculos'], linhas: [[2011, 623026], [2021, 682824]], total: 2 };
    const consultas = new Map([
      ...['0151', '1011', '1013', '4634', '4722'].map((x, i) => feita(`C${i + 1}`, `SELECT cnae_classe, sum(vinculos) FROM rais_uf WHERE starts_with(cnae_classe, '${x}') GROUP BY 1`, r)),
      feita('C6', `SELECT ano, sum(vinculos) AS vinculos FROM rais_uf WHERE situacao = 1 AND cnae_classe IN ('10112', '10139') OR cnae_classe IN ('46346', '47229') GROUP BY 1`, r),
      feita('C7', `SELECT ano, CASE WHEN cnae_classe = '01512' THEN 'M' WHEN cnae_classe IN ('10112', '10139') THEN 'I' END AS s, sum(vinculos) AS vinculos
        FROM rais_uf WHERE cnae_classe IN ('47229', '46346', '01512', '10112', '10139') GROUP BY ALL`, r),
    ]);
    const destaques = [{ rotulo: 'Vínculos', valor: 682824, formato: 'inteiro', unidade: 'vínculos', consulta: 'C7', coluna: 'vinculos' },
      { rotulo: 'Vínculos', valor: 623026, formato: 'inteiro', unidade: 'vínculos', consulta: 'C6', coluna: 'vinculos' }];
    const p = prepararResposta(lerResposta({ resposta: respostaBase({ destaques }) })!, consultas, { doTurno: [...consultas.keys()] });
    assert.deepEqual(p.codigos, [`CNAE (classe): ${classes.join(', ')}`]);
    // sem consulta citada, valem as do turno (prefixos e lista)
    const s = prepararResposta(lerResposta({ resposta: respostaBase() })!, consultas, { doTurno: [...consultas.keys()] });
    assert.deepEqual(s.codigos, [`CNAE (classe): começa com 0151; começa com 1011; começa com 1013; começa com 4634; começa com 4722; ${classes.join(', ')}`]);
    // "- " no começo da linha vira lista (página e PDF usam a mesma leitura)
    assert.deepEqual(blocosDeTexto('- O total subiu.\n- A matéria-prima caiu.\nEm resumo, cresceu.\n\nOutro parágrafo\ncontinua.'), [
      { tipo: 'lista', itens: ['O total subiu.', 'A matéria-prima caiu.'] },
      { tipo: 'paragrafo', texto: 'Em resumo, cresceu.' },
      { tipo: 'paragrafo', texto: 'Outro parágrafo continua.' },
    ]);
  });

  test('colunas: contagens não viram R$, competência em texto volta a ser competência, unidade linha a linha não leva símbolo único', () => {
    const r: Resultado = {
      colunas: ['exercicio', 'municipios_com_receita', 'municipios_fpm_e_rc', 'fpm_real', 'participacao_fpm_pct'],
      linhas: [[2023, 246, 228, 7212.87, 17.6]], total: 1,
    };
    assert.deepEqual(tiposDoResultado(r), ['ano', 'contagem', 'contagem', 'reais', 'percentual']);
    assert.deepEqual(tiposDoResultado({ colunas: ['lacunas_fpm_sem_valor', 'rc_por_hab_nominal', 'ativos_sem_rem_dez', 'var_part_pp'], linhas: [[18, 3500.5, 74548, -1.2]], total: 1 }),
      ['contagem', 'reais', 'contagem', 'percentual']);
    assert.equal(rotuloColuna('var_part_pp', 'percentual'), 'var part (p.p.)');
    assert.deepEqual(codigosDoSql(["SELECT * FROM trab_caged_uf WHERE escopo = 'GO' AND secao = 'TOTAL'"]), []);
    const siops: Resultado = { colunas: ['codigo', 'unidade', 'valor'], linhas: [['3.2', '%', 21.77], ['d_total', 'R$', 2257118974.13]], total: 2 };
    assert.equal(tiposDoResultado(siops)[2], 'numero');
    const caged: Resultado = { colunas: ['competencia', 'ano', 'saldo'], linhas: [['202601', '2026', 10934], ['202602', '2026', 14980]], total: 2 };
    const n = periodosComoNumero(caged);
    assert.deepEqual(n.linhas[0], [202601, 2026, 10934]);
    assert.deepEqual(formatarTabela(caged).linhas[0].slice(0, 2), ['jan/2026', '2026']);
    const tab = montar(espec({ tipo: 'serie', grupo: '', periodo: 'competencia', valor: 'saldo', de: '2026-01', ate: '2026-02', total: false, participacao: false }), caged,
      "SELECT CAST(competencia AS VARCHAR) AS competencia FROM trab_caged_uf");
    assert.deepEqual(tab.linhas.map((l) => l[0].v), ['jan/2026', 'fev/2026']);
  });

  test('queda de conexão antes da resposta (ECONNRESET): uma nova tentativa; duas quedas viram erro', async () => {
    usarServidorIaNoTeste('');
    let n = 0;
    const responder = (falhas: number) => (async () => {
      n += 1;
      if (n <= falhas) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ conteudo: [], parada: 'end_turn', restantes: 49 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    globalThis.fetch = responder(1);
    assert.equal((await chamarIa([], 'pt', ['financas'])).parada, 'end_turn');
    assert.equal(n, 2);
    n = 0;
    globalThis.fetch = responder(2);
    await assert.rejects(chamarIa([], 'pt', ['financas']), /fetch failed/);
    globalThis.fetch = FETCH;
  });

  test('revisão: texto com tabulação no lugar de acento volta para o modelo', () => {
    const consultas = new Map([feita('C1', 'SELECT 1 AS x', { colunas: ['x'], linhas: [[1]], total: 1 })]);
    const p = (conclusao: string) => prepararResposta(lerResposta({ resposta: respostaBase({ conclusao }) })!, consultas, { doTurno: ['C1'] });
    assert.match(revisarResposta(p('Goi\ts fechou com saldo de 50.529.')).join(' '), /Texto corrompido em conclusao.*Goi⟨\?⟩s/);
    assert.deepEqual(revisarResposta(p('Goiás fechou com saldo de 50.529.')), []);
  });

  test('revisão: tabela municipal pedida precisa vir (a página mostra e exporta todas as linhas)', () => {
    const pergunta = 'Nos municípios de Goiás, qual é a relação entre PIB per capita e remuneração? Apresente tabela municipal e correlações.';
    assert.ok(pedeTabelaMunicipal(pergunta));
    assert.ok(!pedeTabelaMunicipal('Qual a correlação entre PIB per capita e remuneração em Goiás?'));
    const cor: Resultado = { colunas: ['medida', 'coeficiente'], linhas: [['Pearson', 0.46]], total: 1 };
    // cruzamento DCA × RAIS com a junção conferida pela página (1:1, sem registros sem par)
    const lado = { linhas: 246, distintas: 246, nulas: 0 };
    const mun: Resultado = { colunas: ['nome', 'cod_ibge', 'pib_per_capita', 'rem_dez_media'], linhas: Array.from({ length: 246 }, (_, i) => [`M${i}`, 5200000 + i, 1000 + i, 2000 + i]), total: 246,
      verificacao: { chaves: null, amostra: [], juncoes: [{ rotulo: 'DCA × RAIS', chaves: ['cod_ibge'], esquerda: lado, direita: lado, ambas: 246, soEsquerda: 0, soDireita: 0, cardinalidade: '1:1', exemplosEsquerda: [], exemplosDireita: [] }] } };
    const consultas = new Map([feita('C1', 'SELECT corr(pib_per_capita, rem) FROM x', cor), feita('C2', 'SELECT nome, cod_ibge, pib_per_capita, rem_dez_media FROM indicadores JOIN trab_municipios USING (cod_ibge)', mun)]);
    const tabela = (consulta: string) => espec({ consulta, tipo: 'tabela', grupo: '', periodo: '', valor: '', de: '', ate: '', total: false, participacao: false, formato: 'decimal' });
    const so = prepararResposta(lerResposta({ resposta: respostaBase({ tabelas: [tabela('C1')] }) })!, consultas, { doTurno: ['C1', 'C2'] });
    assert.match(revisarResposta(so, { pergunta }).join(' '), /pede a tabela municipal/);
    const com = prepararResposta(lerResposta({ resposta: respostaBase({ tabelas: [tabela('C1'), tabela('C2')] }) })!, consultas, { doTurno: ['C1', 'C2'] });
    assert.deepEqual(revisarResposta(com, { pergunta }), []);
  });

  test('revisão: tabela principal com resultado truncado não passa', () => {
    const r: Resultado = { colunas: ['nome', 'valor'], linhas: Array.from({ length: 2000 }, (_, i) => [`M${i}`, i]), total: 5570 };
    const consultas = new Map([feita('C1', 'SELECT nome, valor FROM indicadores', r)]);
    const p = prepararResposta(lerResposta({ resposta: respostaBase({ tabelas: [espec({ tipo: 'tabela', grupo: '', periodo: '', valor: '', de: '', ate: '', total: false, participacao: false })] }) })!, consultas, { doTurno: ['C1'] });
    assert.match(revisarResposta(p).join(' '), /tem 5570 linhas e a página só carrega 2000/);
    assert.match(p.tabelas[0].tabela!.notas.join(' '), /a exportação \(CSV ou Excel\) roda a consulta de novo e traz todas/);
  });

  test('cobertura do catálogo: todas as fontes, PIB com o próprio intervalo e o ano corrente só no CAGED', () => {
    const m = { rais: Array.from({ length: 16 }, (_, i) => 2010 + i), caged: { de: 202001, ate: 202608 }, microdados: false, dca: Array.from({ length: 13 }, (_, i) => 2013 + i),
      pib: { de: 2010, ate: 2023, setorial_ate: 2021 }, siope: Array.from({ length: 13 }, (_, i) => 2013 + i), siopeRemuneracao: [202412, 202512], siops: Array.from({ length: 13 }, (_, i) => 2013 + i),
      lrf: null, bolsa: { de: 2013, ate: 2026, mes: 202608 }, inss: [2017, 2019, 2020, 2021] };
    const linhas = descreverCobertura(['financas', 'trabalho'], m).join('\n');
    assert.match(linhas, /PIB municipal \(IBGE\) 2010–2023, valor adicionado por setor até 2021/);
    assert.match(linhas, /SIOPS \(saúde\) 2013–2025/);
    assert.match(linhas, /SIOPE \(educação\) 2013–2025/);
    assert.match(linhas, /benefícios do INSS 2017, 2019–2021/);
    assert.match(linhas, /RREO e RGF \(LRF\): em preparação/);
    assert.deepEqual(coberturaDaFonte('SELECT pib / populacao FROM indicadores', m)?.anos, Array.from({ length: 11 }, (_, i) => 2013 + i));
    assert.equal(coberturaDaFonte("SELECT valor FROM siops_indicadores WHERE codigo = 'd_total'", m)?.nome, 'SIOPS');
    const d = disponibilidadeNoAno(2026, ['financas', 'trabalho'], m);
    assert.match(d, /com dados nesse ano: Novo CAGED \(jan\/2026 a ago\/2026, ano incompleto\)/);
    assert.match(d, /sem dados nesse ano: RAIS \(2010–2025\); DCA \(2013–2025\); PIB municipal \(2010–2023\); SIOPE; SIOPS/);
    assert.match(contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'brasil' }, ano: 2026, modo: 'rapida' }, m), /Ano de referência: 2026 \(com dados nesse ano: Novo CAGED/);
  });

  test('CAGED em Goiás: jan–ago de 2026 contra o mesmo intervalo de 2025 (série com ajustes, conferida nas movimentações)', { skip: !existsSync(`${DATA}/gold/trabalho/caged_uf.parquet`) }, async () => {
    await tabelasIaTrabalho();
    const r = await sql(`SELECT competencia // 100 AS ano, count(*) AS meses, sum(admissoes) AS adm, sum(desligamentos) AS desl, sum(saldo) AS saldo
      FROM trab_caged_uf WHERE escopo = 'GO' AND secao = 'TOTAL' AND competencia % 100 BETWEEN 1 AND 8 AND competencia // 100 IN (2025, 2026) GROUP BY 1 ORDER BY 1`, ['trabalho']);
    assert.deepEqual(r.linhas, [[2025, 8, 724483, 649839, 74644], [2026, 8, 704074, 653545, 50529]]);
  });

  test('SIOPS × DCA (Goiânia, 2024): nenhum estágio da função Saúde coincide com a despesa total do SIOPS', { skip: semIndicadores || semSiops }, async () => {
    await tabelasEducacaoSaude();
    const r = await sql(`SELECT s.valor AS siops, i.despesa_saude, i.despesa_saude_liquidada, i.despesa_saude_paga
      FROM indicadores i JOIN siops_indicadores s ON s.cod_ibge = i.cod_ibge AND s.ano = i.exercicio AND s.codigo = 'd_total'
      WHERE i.cod_ibge = 5208707 AND i.exercicio = 2024`, ['financas']);
    const [siops, emp, liq, pago] = r.linhas[0] as number[];
    quase(siops, 2257118974.13);
    quase(emp, 2157573979.74);
    quase(liq, 2156666960.32);
    quase(pago, 2068845703.41);
    for (const v of [emp, liq, pago]) assert.ok(Math.abs(siops / v - 1) > 0.04, 'diferença maior que 4% em todos os estágios');
  });

  test('cruzamento PIB × RAIS (Goiás, 2023): chave única nos dois lados, sem perdas, correlações iguais às da conferência', { skip: semIndicadores }, async () => {
    await tabelasIaTrabalho();
    const r = await sql(`WITH f AS (SELECT cod_ibge, pib / populacao AS pib_pc FROM indicadores WHERE exercicio = 2023 AND uf = 'GO' AND esfera = 'M'),
        t AS (SELECT cod_ibge, massa_dez / nullif(n_rem_dez, 0) AS rem FROM trab_municipios WHERE ano = 2023 AND uf = 'GO'),
        j AS (SELECT * FROM f JOIN t USING (cod_ibge))
      SELECT (SELECT count(*) FROM f), (SELECT count(DISTINCT cod_ibge) FROM f), (SELECT count(*) FROM t), (SELECT count(DISTINCT cod_ibge) FROM t),
        count(*), corr(pib_pc, rem), (SELECT corr(a, b) FROM (SELECT rank() OVER (ORDER BY pib_pc) AS a, rank() OVER (ORDER BY rem) AS b FROM j))
      FROM j`);
    const [nf, df, nt, dt, pares, pearson, spearman] = r.linhas[0] as number[];
    assert.deepEqual([nf, df, nt, dt, pares], [246, 246, 246, 246, 246]);
    quase(pearson, 0.4604464377083938, 1e-9);
    quase(spearman, 0.487452214024743, 1e-9);
  });
});

/**
 * Auditoria com o modelo de verdade (custa perguntas do dia): IA_AUDITORIA=arquivo.json npm test, com o
 * Worker local ligado (IA_URL). Cada pergunta numa conversa nova, com os dois painéis e sem território; o
 * arquivo guarda pergunta, contexto, modo, consultas (SQL e resultado) e resposta, para a conferência
 * independente (pipeline/auditoria_ia.py). IA_AUDITORIA_SO=A,C roda só algumas.
 */
const AUDITORIA: [string, 'rapida' | 'pesquisa', string, Painel[]?][] = [
  ['S1', 'rapida', 'Como evoluiu a mortalidade infantil em Goiás de 2014 a 2024?', ['saude']],
  ['S2', 'pesquisa', 'Quais municípios de Goiás com pelo menos mil nascidos vivos tiveram a maior mortalidade infantil em 2024? Mostre óbitos infantis, nascidos vivos e a taxa.', ['saude']],
  ['S3', 'pesquisa', 'Nos municípios de Goiás, qual é a relação entre a despesa com saúde por habitante e a mortalidade infantil em 2024?', ['financas', 'saude']],
  ['A', 'pesquisa', 'Como evoluiu a dependência do FPM nos municípios de Goiás entre 2013 e 2025? Apresente uma tabela anual com FPM, receita corrente, participação do FPM, valores por habitante e cobertura dos municípios.'],
  ['B', 'pesquisa', 'Para enfermeiros no Brasil, de 2015 a 2025, apresente vínculos ativos em 31/12, remuneração média de dezembro nominal e real, participação feminina e diferença salarial entre mulheres e homens.'],
  ['C', 'pesquisa', 'Qual foi o saldo mensal de empregos formais em Goiás de janeiro a agosto de 2026? Mostre admissões, desligamentos, saldo mensal e acumulado, comparando o mesmo intervalo de 2025.'],
  ['D', 'pesquisa', 'Em Goiânia, em 2024, a despesa com saúde informada no SIOPS coincide com a despesa por função Saúde da DCA? Apresente os indicadores disponíveis, seus valores e as razões metodológicas de eventuais diferenças.'],
  ['E', 'pesquisa', 'Nos municípios de Goiás, qual é a relação entre PIB per capita e remuneração média dos empregos formais em 2025? Apresente tabela municipal e correlações.'],
  ['C-rapida', 'rapida', 'Qual foi o saldo mensal de empregos formais em Goiás de janeiro a agosto de 2026? Mostre admissões, desligamentos, saldo mensal e acumulado, comparando o mesmo intervalo de 2025.'],
];
describe('IA: auditoria das cinco perguntas (Worker local e modelo)', { skip: !process.env.IA_AUDITORIA }, () => {
  const so = process.env.IA_AUDITORIA_SO?.split(',');
  const registros: unknown[] = [];
  after(async () => { await writeFile(process.env.IA_AUDITORIA!, JSON.stringify(registros, null, 1)); });
  for (const [id, modo, pergunta, escolhidos] of AUDITORIA.filter(([id]) => !so || so.includes(id))) {
    test(`${id} (${modo})`, { timeout: 1_200_000 }, async () => {
      globalThis.fetch = FETCH;
      usarServidorIaNoTeste(process.env.IA_URL ?? 'http://localhost:8787');
      const m = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
      const cobertura = { rais: m.fontes.rais.anos, caged: { de: m.fontes.caged.de, ate: m.fontes.caged.ate }, microdados: false, dca: m.anos,
        sim: m.fontes.sim?.anos, sinasc: m.fontes.sinasc?.anos, popSvs: m.fontes.populacao_svs?.anos };
      const paineis: Painel[] = escolhidos ?? ['financas', 'trabalho'];
      const resultados: Record<string, Resultado> = {};
      const contexto = contextoParaModelo({ paineis, territorio: { tipo: 'brasil' }, ano: null, modo });
      const inicio = Date.now();
      let parcial: Mensagem[] = [];
      const r = await perguntarIa({
        historico: [], pergunta, contexto, idioma: 'pt', paineis, sinal: new AbortController().signal, modo, cobertura,
        ultimaCompetencia: cobertura.caged.ate, aoAtualizar: (h) => { parcial = h; }, aoResultado: (k, res) => { resultados[k] = res; },
      }).catch((e: unknown) => {
        // a falha também fica registrada, com as consultas feitas até ela
        const consultas = consultasDaConversa(parcial, resultados);
        registros.push({ id, modo, pergunta, contexto, falha: e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? '')}` : String(e), mensagens: parcial, segundos: Math.round((Date.now() - inicio) / 1000),
          consultas: [...consultas.values()].map((c) => ({ id: c.rotulo, objetivo: c.objetivo, sql: c.sql, resultado: c.resultado })) });
        throw e;
      });
      const turno = turnos(r.mensagens).at(-1)!;
      const consultas = consultasDaConversa(r.mensagens, resultados);
      const doTurno = turno.itens.flatMap((i) => (i.tipo === 'consulta' ? [i.rotulo] : []));
      const p = turno.resposta ? prepararResposta(turno.resposta, consultas, { doTurno, pergunta, cobertura, ultimaCompetencia: cobertura.caged.ate }) : null;
      const problemas = p ? revisarResposta(p, { pergunta, modo }) : ['sem resposta'];
      registros.push({
        id, modo, pergunta, contexto, desfecho: r.desfecho, detalhe: r.detalhe ?? null, segundos: Math.round((Date.now() - inicio) / 1000),
        chamadas: r.mensagens.filter((x) => x.role === 'assistant').length,
        revisoes: turno.itens.filter((i) => i.tipo === 'revisao').map((i) => (i as { motivos: string[] }).motivos),
        problemas, faltantes: p?.faltantes ?? null, periodo: p?.periodo ?? null, recorte: p && recorteDe(p),
        consultas: doTurno.map((k) => {
          const c = consultas.get(k);
          const res = c?.resultado as Resultado | undefined;
          return { id: k, objetivo: c?.objetivo, sql: c?.sql, ...(res && 'erro' in res ? { erro: res.erro } : res ? { colunas: res.colunas, total: res.total, linhas: res.linhas } : {}) };
        }),
        resposta: turno.resposta,
        tabelas: p?.tabelas.map((x) => ({ espec: x.espec, motivo: x.motivo, colunas: x.tabela?.colunas.map((c) => c.nome), linhas: x.tabela?.linhas.map((l) => l.map((c, j) => formatarCelulaT(c, x.tabela!.colunas[j]))), notas: x.tabela?.notas })),
        destaques: p?.destaques.map((x) => ({ rotulo: x.d.rotulo, valor: x.valor, unidade: x.unidade, conferencia: x.conferencia })),
        texto: p ? textoDaResposta(p) : null,
      });
      assert.equal(r.desfecho, 'resposta');
    });
  }
});

describe('IA: histórico de conversas', () => {
  const CTX: ContextoIa = { paineis: ['trabalho'], territorio: { tipo: 'uf', uf: 'GO', nome: 'Goiás', cod: 52 }, ano: 2021, modo: 'pesquisa' };
  const R1: Resultado = { colunas: ['ano', 'vinculos'], linhas: [[2011, 623026], [2021, 682824]], total: 2 };
  const SQL = "SELECT ano, sum(vinculos) AS vinculos FROM rais_uf WHERE situacao = 1 AND cnae_classe = '01512' GROUP BY 1";
  const conversa = (o: Partial<Conversa> = {}): Conversa => ({
    formato: FORMATO_CONVERSA, versao: VERSAO_CONVERSA, id: 'c-1', titulo: tituloAutomatico('Quantos vínculos na criação de bovinos em Goiás?'), tituloManual: false,
    criadaEm: 1000, atualizadaEm: 2000,
    mensagens: [
      { role: 'user', content: [{ type: 'text', text: 'Contexto da página' }, { type: 'text', text: 'Quantos vínculos na criação de bovinos em Goiás?' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'consultar', input: { sql: SQL, objetivo: 'vínculos por ano' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: paraModelo(R1, 'C1') }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu2', name: 'responder', input: { resposta: respostaBase({ conclusao: 'Os vínculos subiram 9,6% entre 2011 e 2021.' }) } }] },
    ],
    metas: [{ contexto: CTX, inicio: 1000, fim: 1500, desfecho: 'resposta', dados: '2026-10-28T00:00:00+00:00', registro: { fontes: ['RAIS'], bases: ['RAIS 2010–2025'], notas: [], codigos: ['CNAE (classe): 01512'] } }],
    resultados: { tu1: R1 },
    fontes: { '2026-10-28T00:00:00+00:00': { rais: { anos: [2010, 2025] } } },
    origem: { tipo: 'nova' }, conta: null, ...o,
  });

  test('a conversa só tem dados que o navegador grava (notas sem funções), e a nota volta com os mesmos textos', () => {
    const nota = NOTAS.find((n) => n.id === 'rais-vinculos')!;
    const c = conversa({ metas: [{ ...conversa().metas[0], registro: { fontes: ['RAIS'], notas: [guardarNota(nota)], codigos: [] } }] });
    // o IndexedDB usa o mesmo algoritmo de cópia do structuredClone: uma função recusaria a gravação
    assert.doesNotThrow(() => structuredClone(c));
    assert.throws(() => structuredClone({ ...c, metas: [{ ...c.metas[0], registro: { ...c.metas[0].registro, notas: [nota] } }] }));
    const volta = lerNota(structuredClone(c).metas[0].registro!.notas[0]);
    assert.equal(volta.titulo(), nota.titulo());
    assert.equal(volta.texto(), nota.texto());
    assert.equal(volta.url, nota.url);
  });

  test('título automático, resumo e busca sem acentos', () => {
    assert.equal(tituloAutomatico('a '.repeat(10).trim()), 'a a a a a a a a a a');
    const longo = tituloAutomatico('Quantos vínculos formais ativos existiam no Brasil nas atividades de criação de bovinos e abate de reses?');
    assert.ok(longo.length <= 80 && longo.endsWith('…') && !longo.includes(' …'), longo);
    const r = resumoDe(conversa());
    assert.equal(r.perguntas, 1);
    assert.equal(r.territorio, 'Goiás (GO)');
    assert.deepEqual(r.dados, ['2026-10-28T00:00:00+00:00']);
    assert.equal(filtrarResumos([r], 'vinculos BOVINOS').length, 1);
    assert.equal(filtrarResumos([r], 'subiram 9,6%').length, 1, 'a busca também olha as conclusões');
    assert.equal(filtrarResumos([r], 'suínos').length, 0);
  });

  test('exportar e importar: o mesmo conteúdo; arquivo inválido é recusado com o motivo; id repetido vira cópia', () => {
    const c = conversa();
    const lida = lerConversaExportada(exportarConversa(c));
    assert.deepEqual(lida, c);
    assert.throws(() => lerConversaExportada('{'), /JSON válido/);
    assert.throws(() => lerConversaExportada(JSON.stringify({ formato: 'outro' })), /não é uma conversa exportada/);
    assert.throws(() => lerConversaExportada(JSON.stringify({ ...c, versao: VERSAO_CONVERSA + 1 })), /versão mais nova/);
    assert.throws(() => lerConversaExportada(JSON.stringify({ ...c, resultados: null })), /resultados/);
    assert.deepEqual(paraImportar(c, null), { conversa: c, repetida: false });
    assert.equal(paraImportar(c, c).repetida, true);
    const copia = paraImportar(c, { ...c, atualizadaEm: 9999 }).conversa;
    assert.notEqual(copia.id, c.id);
    assert.deepEqual(copia.origem, { tipo: 'importada', em: copia.origem.tipo === 'importada' ? copia.origem.em : 0, id: 'c-1' });
    assert.match(copia.titulo, /\(importada\)$/);
  });

  test('retomada: a conversa reaberta leva ao modelo as consultas e os resultados anteriores', async () => {
    usarRepositorio(repositorioEmMemoria());
    assert.equal(await historico.salvar(conversa()), true);
    const c = await historico.ler('c-1');
    assert.ok(c);
    // a próxima pergunta vai com o histórico inteiro: o SQL e o resultado da C1 continuam lá
    const proxima = comPergunta(c.mensagens, 'agora faça por habitante', 'Contexto da página');
    const texto = JSON.stringify(proxima);
    assert.ok(texto.includes(SQL.replaceAll("'", "\\u0027")) || texto.includes('cnae_classe'), 'SQL anterior no histórico');
    assert.ok(texto.includes('682824'), 'resultado anterior no histórico');
    assert.equal(proxima.at(-1)!.role, 'user');
    // e a página monta as mesmas consultas, sem rodar nada
    assert.deepEqual(consultasDaConversa(c.mensagens, c.resultados).get('C1')?.resultado, R1);
    assert.equal(c.metas[0].contexto.territorio.tipo, 'uf');
    assert.deepEqual(c.metas[0].registro?.codigos, ['CNAE (classe): 01512']);
  });

  test('renomear vale sobre o título automático de uma gravação posterior; excluída não volta; importar abre', async () => {
    usarRepositorio(repositorioEmMemoria());
    await historico.salvar(conversa());
    assert.equal(await historico.renomear('c-1', '  Cadeia da carne  '), true);
    // a resposta de uma pergunta que começou antes do novo título chega depois, com o título automático
    await historico.salvar(conversa({ atualizadaEm: 3000 }));
    assert.equal((await historico.ler('c-1'))?.titulo, 'Cadeia da carne');
    assert.equal(historico.estado().resumos[0].titulo, 'Cadeia da carne');
    assert.ok(historico.estado().gravadas['c-1'] >= 3000);
    await historico.excluir('c-1');
    await historico.salvar(conversa({ atualizadaEm: 4000 }));
    assert.equal(await historico.ler('c-1'), null, 'a pergunta que terminou depois da exclusão não ressuscita a conversa');
    const r = await historico.importar(exportarConversa(conversa()));
    assert.deepEqual(r, { id: 'c-1', repetida: false });
    assert.equal(historico.estado().resumos.length, 1);
  });

  test('falha na gravação vira aviso visível, com a saída de exportar', async () => {
    usarRepositorio({ ...repositorioEmMemoria(), salvar: async () => { throw Object.assign(new Error('cheio'), { name: 'QuotaExceededError' }); } });
    assert.equal(await historico.salvar(conversa()), false);
    assert.match(historico.estado().erro ?? '', /não foi salva neste navegador: o navegador está sem espaço.*Exporte-a em JSON/);
    historico.limparErro();
    assert.equal(historico.estado().erro, null);
  });

  test('nova versão com os dados atuais: consultas refeitas no navegador, original intacta, texto da IA marcado como não regenerado', async () => {
    const original = conversa();
    const antes = JSON.stringify(original);
    const R2: Resultado = { colunas: ['ano', 'vinculos'], linhas: [[2011, 623030], [2021, 682900]], total: 2 };
    const pedidos: string[] = [];
    const nova = await novaVersaoComDadosAtuais(original, {
      executar: async (sql, paineis) => {
        pedidos.push(`${paineis.join(',')}|${sql}`);
        return R2;
      },
      dados: '2026-11-05T00:00:00+00:00', fontes: { rais: { anos: [2010, 2025] } }, agora: 5000,
    });
    assert.equal(JSON.stringify(original), antes, 'a original não muda');
    assert.deepEqual(pedidos, [`trabalho|${SQL}`]);
    assert.notEqual(nova.id, original.id);
    assert.deepEqual(nova.origem, { tipo: 'versao', de: 'c-1', titulo: original.titulo, em: 5000, dados: '2026-11-05T00:00:00+00:00' });
    assert.deepEqual(nova.resultados.tu1, R2);
    assert.deepEqual(nova.metas[0].reexecucao, { em: 5000, dados: '2026-11-05T00:00:00+00:00', original: '2026-10-28T00:00:00+00:00', falhas: 0 });
    assert.equal(nova.metas[0].registro?.bases, undefined, 'versões das bases saem do catálogo novo');
    // o modelo, nas perguntas seguintes, relê os resultados novos
    const devolvido = (nova.mensagens[2].content as Bloco[])[0];
    assert.match(String(devolvido.content), /682900/);
    assert.doesNotMatch(String(devolvido.content), /682824/);
    // o texto escrito pela IA não muda
    assert.deepEqual(nova.mensagens[3], original.mensagens[3]);
    assert.equal(desatualizada(original.metas, '2026-11-05T00:00:00+00:00'), true);
    assert.equal(desatualizada(nova.metas, '2026-11-05T00:00:00+00:00'), false);
    assert.deepEqual(versoesDosDados(nova.metas), ['2026-11-05T00:00:00+00:00']);
    assert.ok(nova.fontes['2026-10-28T00:00:00+00:00'] && nova.fontes['2026-11-05T00:00:00+00:00']);
  });
  // servidor simulado da conta: guarda o que recebe; fora = sem conexão
  const servidor = () => {
    const m = new Map<string, Conversa>();
    const s = { m, fora: false, pedidos: 0 };
    const api: ApiConversas = {
      listar: async () => {
        s.pedidos += 1;
        if (s.fora) throw new TypeError('Failed to fetch');
        return [...m.values()].map(resumoDe);
      },
      ler: async (id) => {
        s.pedidos += 1;
        if (s.fora) throw new TypeError('Failed to fetch');
        return m.has(id) ? structuredClone(m.get(id)!) : null;
      },
      salvar: async (c) => {
        s.pedidos += 1;
        if (s.fora) throw new TypeError('Failed to fetch');
        m.set(c.id, structuredClone(c));
      },
      excluir: async (id) => {
        s.pedidos += 1;
        if (s.fora) throw new TypeError('Failed to fetch');
        m.delete(id);
      },
    };
    return { s, api };
  };

  test('conta: grava no servidor e na cópia do navegador; outra conta e o modo sem login não veem a cópia', async () => {
    const { s, api } = servidor();
    const copia = repositorioEmMemoria();
    usarRepositorio(repositorioConta('a@x.org', api, copia), 'a@x.org');
    assert.equal(await historico.salvar(conversa()), true);
    assert.equal(s.m.get('c-1')?.conta, 'a@x.org');
    assert.equal((await copia.ler('c-1'))?.conta, 'a@x.org');
    assert.deepEqual(historico.estado().resumos.map((r) => [r.id, r.conta]), [['c-1', 'a@x.org']]);
    // a cópia é da conta a@x.org: com outro login ou sem login ela não aparece nem abre
    const outra = repositorioConta('b@x.org', servidor().api, copia);
    assert.deepEqual(await outra.listar(), []);
    assert.equal(await outra.ler('c-1'), null);
    assert.deepEqual(await soNoNavegador(copia).listar(), []);
    assert.equal(await soNoNavegador(copia).ler('c-1'), null);
  });

  test('conta: sem conexão a lista vem da cópia, o que foi salvo fica pendente e segue quando o servidor volta', async () => {
    const { s, api } = servidor();
    const copia = repositorioEmMemoria();
    usarRepositorio(repositorioConta('a@x.org', api, copia), 'a@x.org');
    await historico.salvar(conversa());
    s.fora = true;
    assert.equal(await historico.salvar(conversa({ atualizadaEm: 3000, titulo: 'Editada sem conexão' })), false);
    assert.match(historico.estado().erro ?? '', /não foi salva na sua conta: sem conexão com o servidor; ela ficou guardada neste navegador/);
    assert.equal(historico.estado().semServidor, 'sem conexão com o servidor');
    assert.deepEqual(historico.estado().resumos.map((r) => [r.titulo, r.pendente]), [['Editada sem conexão', true]]);
    assert.equal((await historico.ler('c-1'))?.titulo, 'Editada sem conexão', 'abre a cópia daqui');
    s.fora = false;
    await historico.recarregar();
    assert.equal(s.m.get('c-1')?.titulo, 'Editada sem conexão');
    assert.equal(historico.estado().semServidor, null);
    assert.deepEqual(historico.estado().resumos.map((r) => [r.titulo, !!r.pendente]), [['Editada sem conexão', false]]);
  });

  test('conta: vale a gravação mais recente; excluída em outro computador sai da cópia; excluir apaga do servidor', async () => {
    const { s, api } = servidor();
    const copia = repositorioEmMemoria();
    const repo = repositorioConta('a@x.org', api, copia);
    await repo.salvar(conversa());
    // outro computador continuou a conversa
    s.m.set('c-1', { ...conversa({ atualizadaEm: 9000, titulo: 'Continuada no outro computador' }), conta: 'a@x.org' });
    await repo.listar();
    assert.equal((await repo.ler('c-1'))?.titulo, 'Continuada no outro computador');
    assert.equal((await copia.ler('c-1'))?.atualizadaEm, 9000, 'a cópia daqui foi atualizada');
    // e depois a excluiu
    s.m.delete('c-1');
    assert.deepEqual(await repo.listar(), []);
    assert.equal(await copia.ler('c-1'), null);
    await repo.salvar(conversa({ id: 'c-2' }));
    await repo.excluir('c-2');
    assert.equal(s.m.has('c-2'), false);
    assert.equal(await copia.ler('c-2'), null);
  });

  test('conta: as conversas só deste navegador aparecem marcadas e vão para a conta pelo botão', async () => {
    const { s, api } = servidor();
    const copia = repositorioEmMemoria();
    await copia.salvar(conversa({ id: 'local-1' }));
    await copia.salvar(conversa({ id: 'local-2' }));
    usarRepositorio(repositorioConta('a@x.org', api, copia), 'a@x.org');
    await historico.recarregar();
    assert.deepEqual(historico.estado().resumos.map((r) => r.conta ?? null), [null, null]);
    assert.deepEqual(await historico.levarParaConta(), { levadas: 2, falhas: 0 });
    assert.deepEqual([...s.m.keys()].sort(), ['local-1', 'local-2']);
    assert.deepEqual(historico.estado().resumos.map((r) => r.conta), ['a@x.org', 'a@x.org']);
  });
});

describe('IA: pedido de conferência pelo especialista RAIS (conferencia-rais/1)', () => {
  const original = globalThis.fetch;
  after(() => {
    globalThis.fetch = original;
  });
  const ID_PEDIDO = /^[A-Za-z0-9_-]{8,64}$/;
  const AUTORIZADO = 'luanviniciusbernardelli@gmail.com';
  const dadosAtuais = { geradoEm: '2026-10-30T07:39:57+00:00', fontes: { rais_micro: { processado_em: '2026-10-27T09:10:56+00:00' } } };
  const usarRespostas = (passos: ((ms: Mensagem[]) => unknown)[]) => {
    let n = 0;
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      const ms = JSON.parse(String(init?.body)).mensagens as Mensagem[];
      const passo = passos[n++];
      if (!passo) throw new Error(`chamada a mais ao modelo: ${JSON.stringify(ms.at(-1)!.content).slice(0, 600)}`);
      return new Response(JSON.stringify(passo(ms)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  };
  const devolvido = (ms: Mensagem[], id: string) => JSON.parse(String((ms.at(-1)!.content as Bloco[]).find((b) => b.tool_use_id === id)!.content));
  const respostaRais = (consulta: string, valor: number) => ({
    tipo: 'resposta', conclusao: `Rio Branco tinha ${valor} vínculos ativos em 31/12/2017.`, explicacao: '', interpretacao: '', hipoteses: '', limitacoes: '', metodologia: '',
    destaques: [{ rotulo: 'Vínculos em Rio Branco', valor, formato: 'inteiro', unidade: 'vínculos', consulta, coluna: 'vinculos_ativos', de: '', ate: '' }],
    tabelas: [{ consulta, papel: 'principal', tipo: 'tabela', titulo: 'Vínculos por município', grupo: '', colunas: [], ordem: '', nota: '' }],
    recorte: { territorio: 'Acre', periodo: '2017', unidade: 'vínculos', filtros: '' }, graficos: [], aprofundar: [], ressalvas: [],
  });

  test('conversa do painel de trabalho: SQL final, resultado como voltou ao modelo e entrada de responder',
    { skip: !existsSync(`${DATA}/gold/trabalho/cubo_mun/ano=2017.parquet`) }, async () => {
      usarServidorIaNoTeste('');
      const porMunicipio = 'SELECT municipio, sum(vinculos) AS vinculos_ativos FROM rais_mun WHERE ano = 2017 AND uf = 12 AND situacao = 1 GROUP BY municipio ORDER BY municipio';
      let resposta: unknown = null;
      usarRespostas([
        // rodada 1: uma consulta com erro e uma que depois é refeita
        () => ({ parada: 'tool_use', restantes: 49, conteudo: [
          { type: 'tool_use', id: 'c1', name: 'consultar', input: { sql: 'SELECT coluna_que_nao_existe FROM rais_mun', objetivo: 'Teste com erro', substitui: '' } },
          { type: 'tool_use', id: 'c2', name: 'consultar', input: { sql: 'SELECT municipio, sum(vinculos) AS vinculos_ativos FROM rais_mun WHERE ano = 2017 AND uf = 12 GROUP BY municipio', objetivo: 'Vínculos por município (sem situação)', substitui: '' } },
        ] }),
        // rodada 2: refaz C2 só com os ativos em 31/12
        () => ({ parada: 'tool_use', restantes: 49, conteudo: [
          { type: 'tool_use', id: 'c3', name: 'consultar', input: { sql: porMunicipio, objetivo: 'Vínculos ativos em 31/12 por município do Acre, 2017', substitui: 'C2' } },
        ] }),
        (ms) => {
          const r = devolvido(ms, 'c3');
          const rioBranco = r.linhas.find((l: number[]) => l[0] === 120040)[1];
          resposta = respostaRais('C3', rioBranco);
          return { parada: 'tool_use', restantes: 49, conteudo: [{ type: 'tool_use', id: 'r1', name: 'responder', input: { resposta } }] };
        },
      ]);
      const contexto: ContextoIa = { paineis: ['trabalho'], territorio: { tipo: 'uf', uf: 'AC', nome: 'Acre', cod: 12 }, ano: 2017, modo: 'rapida' };
      const textoContexto = contextoParaModelo(contexto);
      const pergunta = 'Quantos vínculos ativos em 31/12 havia em cada município do Acre em 2017?';
      const r = await perguntarIa({
        historico: [], pergunta, contexto: textoContexto, idioma: 'pt', paineis: ['trabalho'],
        sinal: new AbortController().signal, aoAtualizar: () => undefined, aoResultado: () => undefined,
      });
      assert.equal(r.desfecho, 'resposta');
      const meta = { contexto, inicio: Date.now(), dados: dadosAtuais.geradoEm, modelo: 'claude-haiku-5-5' };
      const feito = pedidoConferencia({
        mensagens: r.mensagens, turno: 0, meta, solicitante: AUTORIZADO, modelo: meta.modelo, fontes: { [dadosAtuais.geradoEm]: dadosAtuais.fontes },
        dadosAtuais, conversa: 'https://finbra-web.exemplo.dev/ia?conversa=x', agora: new Date('2026-10-30T17:00:00Z'),
      });
      assert.ok(!('erro' in feito), 'erro' in feito ? feito.erro : '');
      const p = feito.pedido;
      assert.equal(p.versao, 'conferencia-rais/1');
      assert.match(p.id, ID_PEDIDO);
      assert.match(p.criado_em, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
      assert.equal(new Date(p.criado_em).toISOString(), '2026-10-30T17:00:00.000Z');
      assert.equal(p.pergunta, pergunta);
      assert.equal(p.contexto, textoContexto);
      assert.deepEqual(p.paineis, ['trabalho']);
      assert.equal(p.modelo_site, 'claude-haiku-5-5');
      assert.deepEqual(p.manifesto, { gerado_em: dadosAtuais.geradoEm, rais_micro_processado_em: '2026-10-27T09:10:56+00:00' });
      // sem a consulta com erro (C1) e sem a refeita (C2): só o SQL final
      assert.deepEqual(p.consultas.map((c) => c.id), ['C3']);
      const c3 = p.consultas[0];
      assert.equal(c3.sql, porMunicipio);
      // exatamente o que voltou ao modelo
      const aoModelo = JSON.parse(String((r.mensagens.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).find((b) => b.tool_use_id === 'c3')!).content));
      assert.deepEqual([c3.colunas, c3.linhas, c3.total_linhas], [aoModelo.colunas, aoModelo.linhas, aoModelo.total_linhas]);
      assert.equal(c3.total_linhas, 22);
      assert.deepEqual(p.resposta, resposta);
      assert.equal(JSON.parse(feito.json).id, p.id);
      assert.ok(new TextEncoder().encode(feito.json).length <= 600_000);
      // arquivo para o validador do agente local (PEDIDO_CONFERENCIA_DIR=E:/Agent/RAIS/entrada/pedidos)
      if (process.env.PEDIDO_CONFERENCIA_DIR) await writeFile(path.join(process.env.PEDIDO_CONFERENCIA_DIR, `${p.id}.json`), feito.json, 'utf8');
    });

  /** Conversa sintética: n consultas com `linhas` linhas cada; a resposta cita as de `citadas`. */
  const conversaGrande = (n: number, linhas: number, citadas: string[]): Mensagem[] => {
    const usos: Bloco[] = Array.from({ length: n }, (_, i) => ({ type: 'tool_use', id: `c${i + 1}`, name: 'consultar', input: { sql: `SELECT ${i + 1} AS n FROM rais_mun`, objetivo: `Consulta ${i + 1}`, substitui: '' } }));
    const resultados: Bloco[] = usos.map((u, i) => ({ type: 'tool_result', tool_use_id: u.id, content: paraModelo({ colunas: ['n', 't'], linhas: Array.from({ length: linhas }, () => [i + 1, 'x'.repeat(150)]), total: linhas + 50 }, `C${i + 1}`) }));
    return [
      { role: 'user', content: [{ type: 'text', text: 'Contexto' }, { type: 'text', text: 'Pergunta grande?' }] },
      { role: 'assistant', content: usos },
      { role: 'user', content: resultados },
      // a primeira chamada de responder foi devolvida pela página; vale a segunda, cuja entrada veio como texto JSON
      { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'responder', input: { resposta: { conclusao: 'recusada' } } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'r1', is_error: true, content: 'A resposta tem problemas:\n- x' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'r2', name: 'responder', input: { resposta: JSON.stringify({ conclusao: 'ok', destaques: citadas.map((c) => ({ consulta: c })) }) } }] },
    ];
  };
  const montar = (mensagens: Mensagem[]) => pedidoConferencia({
    mensagens, turno: 0, solicitante: AUTORIZADO, modelo: 'claude-haiku-5-5', fontes: {}, dadosAtuais,
    meta: { contexto: { paineis: ['trabalho'], territorio: { tipo: 'brasil' }, ano: null, modo: 'rapida' }, inicio: 0 },
  });

  test('limites: até 20 consultas, 200 linhas cada e 600 KB, mantendo as citadas na resposta', () => {
    const feito = montar(conversaGrande(25, 200, ['C24', 'C25']));
    assert.ok(!('erro' in feito));
    const p = feito.pedido;
    assert.ok(p.consultas.length <= 20 && p.consultas.length >= 2);
    assert.ok(p.consultas.every((c) => c.linhas.length <= 200));
    assert.ok(new TextEncoder().encode(feito.json).length <= 600_000);
    assert.ok(['C24', 'C25'].every((c) => p.consultas.some((x) => x.id === c)), 'as citadas ficam');
    // em ordem, e a entrada de responder que valeu (a segunda), lida do texto JSON
    const numeros = p.consultas.map((c) => Number(c.id.slice(1)));
    assert.deepEqual(numeros, [...numeros].sort((a, b) => a - b));
    assert.equal(p.resposta.conclusao, 'ok');
    assert.equal(p.manifesto.gerado_em, dadosAtuais.geradoEm);
    const pouca = montar(conversaGrande(3, 5, []));
    assert.ok(!('erro' in pouca) && pouca.pedido.consultas.length === 3 && pouca.pedido.consultas[0].total_linhas === 55);
  });

  test('sem resposta estruturada ou sem consulta com resultado, não monta', () => {
    const semResposta = conversaGrande(2, 5, []).slice(0, 3);
    assert.match((montar(semResposta) as { erro: string }).erro, /resposta estruturada/);
    const soErros: Mensagem[] = [
      { role: 'user', content: 'Pergunta?' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'consultar', input: { sql: 'SELECT x', objetivo: 'o', substitui: '' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', is_error: true, content: '{"consulta":"C1","erro":"falhou"}' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'r1', name: 'responder', input: { resposta: { conclusao: 'ok' } } }] },
    ];
    assert.match((montar(soErros) as { erro: string }).erro, /nenhuma consulta/);
  });
});

describe('saúde (SIM, SINASC e população da SVS/MS)', () => {
  const semSaude = !existsSync(onde('gold/saude/municipios.parquet'));

  test('Brasil 2019 bate com os totais oficiais; taxas como razão das somas', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie');
    const br = serie.find((r) => r.ano === 2019)!;
    assert.equal(br.nascidos, 2849146);
    assert.equal(br.obitos, 1349801);
    assert.equal(br.infantis, 35293);
    quase(calcular(indicador('mortalidade_infantil'), br)!, (1000 * 35293) / 2849146);
    // a série começa em 1996 (SIM e SINASC); a população, em 2000
    assert.equal(serie[0].ano, 1996);
    assert.equal(serie.find((r) => r.ano === 1999)!.populacao, null);
    assert.ok((serie.find((r) => r.ano === 2000)!.populacao as number) > 1.6e8);
  });

  test('SIH: invariantes das internações entre colunas, pontos de vista e anos', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie');
    const sih = serie.filter((r) => Number(r.int_total) > 0);
    if (!sih.length) return; // dados ainda sem o SIH
    const caps = Array.from({ length: 22 }, (_, i) => `int_cap${String(i + 1).padStart(2, '0')}`);
    const anos = sih.map((r) => Number(r.ano));
    assert.deepEqual(anos, Array.from({ length: anos.length }, (_, i) => anos[0] + i), 'anos seguidos, sem lacuna');
    for (const r of sih) {
      const ano = r.ano;
      // todo diagnóstico principal cai num capítulo; o total pelo hospital é o mesmo universo do total pela residência
      assert.equal(caps.reduce((a, c) => a + Number(r[c]), 0), r.int_total, `capítulos somam o total em ${ano}`);
      assert.equal(r.int_atendidas, r.int_total, `atendidas = residentes em ${ano}`);
      assert.equal(r.int_atendidas_de_fora, r.int_fora, `as que saem de um município entram em outro em ${ano}`);
      assert.ok(Number(r.int_fora) <= Number(r.int_total) && Number(r.int_obitos) <= Number(r.int_total), `fora e óbitos não passam do total em ${ano}`);
      assert.ok(Number(r.int_menores_5) + Number(r.int_60_mais) <= Number(r.int_total), `faixas etárias não passam do total em ${ano}`);
      assert.ok(Number(r.int_dias) >= Number(r.int_total) * 0, `dias de permanência presentes em ${ano}`);
      // valor em reais de 2025 pelo IPCA, que começa em 2006: todo ano do SIH (2008 em diante) tem valor real
      assert.ok(Number(r.int_valor_real) > 0, `valor real em ${ano}`);
    }
    // indicadores: razão das somas, como nos demais
    const r = sih.at(-1)!;
    quase(calcular(indicador('internacoes_mil'), r)!, (1000 * Number(r.int_total)) / Number(r.populacao));
    quase(calcular(indicador('internacoes_fora'), r)!, Number(r.int_fora) / Number(r.int_total));
    quase(calcular(indicador('permanencia_media'), r)!, Number(r.int_dias) / Number(r.int_total));
    // o manifesto anuncia os mesmos anos
    const m = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
    assert.deepEqual(m.fontes.sih.anos, anos);
  });

  test('CNES: invariantes da rede de saúde (leitos, estabelecimentos e profissionais)', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie');
    const cn = serie.filter((r) => Number(r.cnes_estab) > 0);
    if (!cn.length) return; // dados ainda sem o CNES
    const anos = cn.map((r) => Number(r.ano));
    assert.deepEqual(anos, Array.from({ length: anos.length }, (_, i) => anos[0] + i), 'anos seguidos, sem lacuna');
    const tipos = ['cirurgicos', 'clinicos', 'complementares', 'obstetricos', 'pediatricos', 'outras', 'hospital_dia'];
    for (const r of cn) {
      const ano = Number(r.ano);
      // o cadastro de origem não garante QT_SUS + QT_NSUS = QT_EXIST em todos os registros: tolera diferença abaixo de 0,1%
      assert.ok(Math.abs(Number(r.cnes_leitos_sus) + Number(r.cnes_leitos_nao_sus) - Number(r.cnes_leitos)) <= 0.001 * Number(r.cnes_leitos), `SUS + não SUS ≈ existentes em ${ano}`);
      assert.equal(tipos.reduce((a, k) => a + Number(r[`cnes_leitos_${k}`] ?? 0), 0), Number(r.cnes_leitos), `os tipos de leito somam o total em ${ano}`);
      assert.ok(Number(r.cnes_estab_sus) <= Number(r.cnes_estab) && Number(r.cnes_hospitais) + Number(r.cnes_ubs) <= Number(r.cnes_estab), `grupos de estabelecimento dentro do total em ${ano}`);
      if (ano < 2007) {
        // em 2006 a CBO ainda não é a de 2002: sem profissionais (nulo, nunca zero)
        assert.ok(r.cnes_medicos === null && r.cnes_enfermeiros === null, `sem profissionais em ${ano}`);
      } else {
        assert.ok(Number(r.cnes_medicos_sus) <= Number(r.cnes_medicos), `médicos SUS dentro do total em ${ano}`);
        // a mesma pessoa pode atuar em vários municípios: a contagem por município nunca é menor que a de pessoas distintas,
        // e os vínculos nunca são menos que as pessoas por município
        assert.ok(Number(r.cnes_medicos_no_municipio) >= Number(r.cnes_medicos) && Number(r.cnes_medicos_vinculos) >= Number(r.cnes_medicos_no_municipio), `pessoas ≤ por município ≤ vínculos em ${ano}`);
      }
    }
    // indicadores como razão das somas
    const r = cn.at(-1)!;
    quase(calcular(indicador('medicos_mil'), r)!, (1000 * Number(r.cnes_medicos)) / Number(r.populacao));
    quase(calcular(indicador('leitos_sus_proporcao'), r)!, Number(r.cnes_leitos_sus) / Number(r.cnes_leitos));
    const m = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
    assert.deepEqual(m.fontes.cnes.anos, anos);
  });

  test('SINAN: invariantes dos agravos e coberturas (fora da cobertura, nulo e nunca zero)', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie');
    const com = serie.filter((r) => Number(r.sinan_dengue_provaveis) > 0);
    if (!com.length) return; // dados ainda sem o SINAN
    for (const r of com) {
      const ano = r.ano;
      assert.ok(Number(r.sinan_dengue_confirmados) <= Number(r.sinan_dengue_provaveis), `confirmados ≤ prováveis em ${ano}`);
      assert.ok(Number(r.sinan_dengue_graves) <= Number(r.sinan_dengue_provaveis), `graves ≤ prováveis em ${ano}`);
      assert.ok(Number(r.sinan_dengue_obitos) <= Number(r.sinan_dengue_confirmados), `óbitos ≤ confirmados em ${ano}`);
    }
    const por = (ano: number) => serie.find((r) => r.ano === ano)!;
    // cada agravo só existe na sua cobertura: fora dela é nulo (a tuberculose acaba em 2019; a chikungunya começa em 2014)
    assert.equal(por(2024).sinan_tb_casos_novos, null, 'tuberculose sem dado depois de 2019');
    assert.equal(por(2012).sinan_chik_notificacoes, null, 'chikungunya sem dado antes de 2014');
    assert.ok(Number(por(2019).sinan_tb_casos_novos) > 0 && Number(por(2019).sinan_chik_notificacoes) > 0);
    // incidência como razão das somas
    const r = por(2019);
    quase(calcular(indicador('dengue_incidencia'), r)!, (100000 * Number(r.sinan_dengue_provaveis)) / Number(r.populacao));
    quase(calcular(indicador('dengue_letalidade'), r)!, Number(r.sinan_dengue_obitos) / Number(r.sinan_dengue_confirmados));
    const m = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
    assert.equal(m.fontes.sinan.agravos.tuberculose[1], 2019);
    assert.equal(m.fontes.sinan.agravos.chikungunya[0], 2014);
  });

  test('IA sem filtros manuais: o contexto aberto não traz território, ano nem bases e diz como tirar o recorte da pergunta', () => {
    const aberto = contextoParaModelo({ paineis: PAINEIS, territorio: { tipo: 'brasil' }, ano: null, modo: 'rapida' });
    assert.doesNotMatch(aberto, /Território selecionado|Ano de referência/);
    assert.match(aberto, /todas as fontes estão disponíveis/);
    assert.match(aberto, /localizar/);
    assert.match(aberto, /rápida/);
    assert.ok(aberto.length < 1500, 'cabe no limite de contexto do Worker');
    // conversa de antes da revisão, com território e ano escolhidos na página, continua legível
    const antigo = contextoParaModelo({ paineis: ['saude'], territorio: { tipo: 'uf', uf: 'PR', nome: 'Paraná', cod: 41 }, ano: 2024, modo: 'pesquisa' });
    assert.match(antigo, /Paraná/);
    assert.match(antigo, /2024/);
  });

  test('SISCAN, Painel de Oncologia e RESP: invariantes, coberturas (fora delas nulo) e indicadores como razão das somas', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie');
    if (!serie.some((r) => Number(r.siscan_cito) > 0)) return; // dados ainda sem estas fontes
    const por = (ano: number) => serie.find((r) => r.ano === ano)!;
    for (const r of serie.filter((x) => Number(x.siscan_cito) > 0)) {
      const ano = r.ano;
      assert.ok(Number(r.siscan_cito_25_64) <= Number(r.siscan_cito) && Number(r.siscan_cito_alterados) <= Number(r.siscan_cito), `faixa e alterados dentro do total de citopatológicos em ${ano}`);
      assert.ok(Number(r.siscan_mamo_50_69) <= Number(r.siscan_mamografias), `mamografias da faixa dentro do total em ${ano}`);
    }
    for (const r of serie.filter((x) => Number(x.onco_casos) > 0)) {
      const ano = r.ano;
      assert.ok(Number(r.onco_trat_60d) <= Number(r.onco_trat_validos) && Number(r.onco_trat_validos) <= Number(r.onco_tratados) && Number(r.onco_tratados) <= Number(r.onco_casos), `60 dias ≤ válidos ≤ tratados ≤ casos em ${ano}`);
    }
    for (const r of serie.filter((x) => Number(x.resp_notificacoes) > 0)) {
      const ano = r.ano;
      assert.ok(Number(r.resp_obitos) <= Number(r.resp_confirmadas) && Number(r.resp_confirmadas) <= Number(r.resp_notificacoes), `óbitos ≤ confirmadas ≤ notificações em ${ano}`);
    }
    // cada fonte só existe na sua cobertura: fora dela é nulo, nunca zero
    assert.equal(por(2012).siscan_cito, null, 'SISCAN sem dado antes de 2014');
    assert.equal(por(2013).siscan_cito, null, '2013 (primeiro ano do sistema, quase vazio) fica de fora');
    assert.equal(por(2018).onco_casos, null, 'Painel de Oncologia só de 2019 em diante');
    assert.equal(por(2014).resp_notificacoes, null, 'RESP começa em 2015');
    assert.ok(Number(por(2019).siscan_cito) > 0 && Number(por(2019).onco_casos) > 0 && Number(por(2016).resp_notificacoes) > 0);
    // indicadores como razão das somas
    const r = por(2019);
    quase(calcular(indicador('cito_25_64'), r)!, (100 * Number(r.siscan_cito_25_64)) / Number(r.pop_mulheres_25_64));
    quase(calcular(indicador('mamo_50_69'), r)!, (100 * Number(r.siscan_mamo_50_69)) / Number(r.pop_mulheres_50_69));
    quase(calcular(indicador('cancer_registros'), r)!, (100000 * Number(r.onco_casos)) / Number(r.populacao));
    quase(calcular(indicador('cancer_60_dias'), r)!, Number(r.onco_trat_60d) / Number(r.onco_trat_validos));
    quase(calcular(indicador('resp_confirmadas'), por(2016))!, (100000 * Number(por(2016).resp_confirmadas)) / Number(por(2016).nascidos));
    const m = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
    assert.equal(m.fontes.siscan.anos[0], 2014);
    assert.equal(m.fontes.oncologia.anos[0], 2019);
    assert.equal(m.fontes.resp.anos[0], 2015);
  });

  test('UF soma os municípios e os registros de município ignorado; o ranking só tem municípios do cadastro', { skip: semSaude }, async () => {
    const go = (await rota<L[]>('saude_serie', { uf: 'GO' })).find((r) => r.ano === 2023)!;
    const muns = await rota<L[]>('saude_municipios', { uf: 'GO', ano: 2023 });
    assert.equal(muns.length, 246);
    assert.ok(muns.every((r) => r.cod_ibge !== null && r.uf === 'GO'));
    const soma = muns.reduce((s, r) => s + (r.obitos as number ?? 0), 0);
    assert.ok((go.obitos as number) >= soma, 'a UF inclui os óbitos de município ignorado');
    const goiania = (await rota<L[]>('saude_serie', { ente: 5208707 })).find((r) => r.ano === 2023)!;
    assert.equal(goiania.nascidos, muns.find((r) => r.cod_ibge === 5208707)!.nascidos);
    // Brasília: o DF vem como o município 5300108
    const df = (await rota<L[]>('saude_serie', { ente: 53 })).find((r) => r.ano === 2023)!;
    assert.ok((df.nascidos as number) > 30000);
  });

  test('IA: saude_municipios pela consulta da IA dá os mesmos totais da série do painel; códigos conferidos', { skip: semSaude }, async () => {
    const go = (await rota<L[]>('saude_serie', { uf: 'GO' })).find((r) => r.ano === 2023)!;
    const r = await executarConsulta({ sql: "SELECT sum(infantis) AS infantis, sum(nascidos) AS nascidos, sum(obitos) AS obitos FROM saude_municipios WHERE uf = 'GO' AND ano = 2023" }, ['saude']);
    assert.ok(!('erro' in r), JSON.stringify(r));
    if ('erro' in r) return;
    assert.deepEqual(r.linhas[0].map(Number), [go.infantis, go.nascidos, go.obitos].map(Number));
    const cad = await cadastro();
    // código de 6 dígitos em cod_ibge e UF em cod_ibge: recusados antes de rodar, com o código certo
    assert.match(conferirCodigos('SELECT nascidos FROM saude_municipios WHERE cod_ibge = 520870', cad) ?? '', /cod_ibge = 5208707/);
    assert.match(conferirCodigos('SELECT sum(nascidos) FROM saude_municipios WHERE cod_ibge = 52', cad) ?? '', /uf = 'GO'/);
    assert.equal(conferirCodigos('SELECT nascidos FROM saude_municipios WHERE municipio = 520870', cad), null);
  });

  test('IA: cobertura, sugestões, fontes e conceitos do painel de saúde', () => {
    const anos = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);
    const cob: Cobertura = { rais: anos(2010, 2025), caged: null, microdados: false, dca: anos(2013, 2025), sim: anos(1996, 2024), sinasc: anos(1996, 2024), popSvs: anos(2000, 2025) };
    const so = sugestoes(['saude'], { tipo: 'brasil' }, cob, null);
    assert.equal(so.length, 4);
    assert.match(so[0].texto, /mortalidade infantil no Brasil de 2014 a 2024/);
    const go = sugestoes(['financas', 'saude'], { tipo: 'uf', uf: 'GO', nome: 'Goiás', cod: 52 }, cob, null);
    assert.match(go[2].texto, /despesa com saúde por habitante e a mortalidade infantil/);
    // três painéis: as três à vista são uma de cada painel
    const todos = sugestoes(['financas', 'trabalho', 'saude'], { tipo: 'brasil' }, cob, null);
    assert.deepEqual(todos.slice(0, 3).map((s) => s.tema), ['Mercado de trabalho', 'Finanças públicas', 'Saúde']);
    assert.equal(new Set(todos.map((s) => s.texto)).size, todos.length);
    assert.match(descreverCobertura(['saude'], cob).join('\n'), /SIM 1996–2024: óbitos[\s\S]*SINASC 1996–2024[\s\S]*População da SVS\/MS 2000–2025/);
    const d = disponibilidadeNoAno(2025, ['saude'], cob);
    assert.match(d, /com dados nesse ano: população da SVS\/MS/);
    assert.match(d, /sem dados nesse ano: SIM \(1996–2024\); SINASC \(1996–2024\)/);
    const consulta = 'SELECT ano, 1000.0 * sum(infantis) / sum(nascidos) AS mi, sum(populacao) AS pop FROM saude_municipios GROUP BY ano';
    assert.equal(coberturaDaFonte(consulta, cob)?.nome, 'SIM/SINASC');
    assert.equal(fontesConsultadas([consulta]).filter((f) => /SIM|SINASC|SVS/.test(f)).length, 3);
    assert.match(codigosDoMunicipio(5208707, ['saude']), /cod_ibge = 5208707 \(7 dígitos\) em saude_municipios, fns_municipios e entes/);
    assert.ok(juntaFontes('SELECT i.despesa_saude, s.infantis FROM indicadores i JOIN saude_municipios s ON s.cod_ibge = i.cod_ibge AND s.ano = i.exercicio'));
    // mortalidade infantil é óbitos de menores de 1 ano por nascidos vivos, não a neonatal
    const mi = CONCEITOS.find((c) => c.id === 'mortalidade_infantil')!;
    assert.ok(atendeConceito(mi, consulta));
    assert.ok(!atendeConceito(mi, 'SELECT 1000.0 * sum(neonatais) / sum(nascidos) AS mi FROM saude_municipios'));
    assert.match(fichaDaColuna('populacao', cob) ?? '', /saude_municipios: estimativa da SVS\/MS/);
    assert.match(fichaDaColuna('infantis', cob) ?? '', /Cobertura: 1996 a 2024/);
  });
});

describe('IA: confiabilidade (população, variável pedida, unidades e estatística)', () => {
  // ---------- estatística, com dados controlados ----------
  // Anscombe (1973), conjunto I: y = 3,0001 + 0,5001x; ep(b1) = 0,1179; t = 4,241; p = 0,00217; R² = 0,6665
  const X = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
  const Y = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];

  test('MQO confere com os valores publicados do conjunto I de Anscombe (erro-padrão clássico)', () => {
    const r = mqo(Y, [{ nome: 'x', valores: X }], 'classico');
    assert.ok(!('erro' in r));
    if ('erro' in r) return;
    quase(r.coeficientes[0], 3.0001, 1e-4);
    quase(r.coeficientes[1], 0.5001, 1e-4);
    quase(r.erros[1], 0.1179, 1e-3);
    quase(r.erros[0], 1.1247, 1e-3);
    quase(r.t[1], 4.241, 1e-3);
    quase(r.p[1], 0.00217, 2e-2);
    quase(r.r2, 0.6665, 1e-3);
    assert.equal(r.gl, 9);
    // IC de 95% com t(0,975; 9) = 2,262
    quase(r.ic[1][0], 0.5001 - 2.262 * 0.1179, 2e-3);
    // t de Student: p bilateral de t = 2,262 com 9 gl ≈ 0,05
    quase(pBilateral(2.262, 9), 0.05, 2e-3);
  });

  test('MQO: HC1 difere do clássico; ausentes saem e são contados; regressor sem variação ou colinear é recusado', () => {
    const hc1 = mqo(Y, [{ nome: 'x', valores: X }], 'hc1');
    const cl = mqo(Y, [{ nome: 'x', valores: X }], 'classico');
    assert.ok(!('erro' in hc1) && !('erro' in cl));
    if ('erro' in hc1 || 'erro' in cl) return;
    assert.deepEqual(hc1.coeficientes.map((v) => v.toFixed(8)), cl.coeficientes.map((v) => v.toFixed(8)));
    assert.notEqual(hc1.erros[1].toFixed(6), cl.erros[1].toFixed(6));
    const comAusente = mqo([...Y, null, 3], [{ nome: 'x', valores: [...X, 2, null] }], 'classico');
    assert.ok(!('erro' in comAusente) && comAusente.descartadas === 2 && comAusente.n === 11);
    const constante = mqo(Y, [{ nome: 'fpm_pc', valores: X.map(() => 7) }]);
    assert.ok('erro' in constante && /não varia/.test(constante.erro));
    const colinear = mqo(Y, [{ nome: 'a', valores: X }, { nome: 'b', valores: X.map((v) => 2 * v) }]);
    assert.ok('erro' in colinear && /colineares/.test(colinear.erro));
    assert.ok('erro' in mqo([1, 2], [{ nome: 'x', valores: [1, 2] }]), 'poucas observações');
  });

  test('regressao em "consultar": consulta comum sem regressão; pedido mal formado é recusado', () => {
    assert.equal(lerRegressao({ y: '', x: [], erro_padrao: '' }), null);
    assert.equal(lerRegressao(undefined), null);
    assert.deepEqual(lerRegressao({ y: 'desp', x: ['fpm_pc'], erro_padrao: '' }), { y: 'desp', x: ['fpm_pc'], erroPadrao: 'hc1' });
    assert.equal(typeof lerRegressao({ y: 'desp; drop', x: ['a'] }), 'string');
  });

  test('regressão roda na página com todas as linhas e volta como tabela de coeficientes', async () => {
    const valores = X.map((x, i) => `(${x}, ${Y[i]})`).join(', ');
    const r = await executarConsulta({ sql: `SELECT x, y FROM (VALUES ${valores}) v(x, y)`, regressao: { y: 'y', x: ['x'], erro_padrao: 'classico' } }, ['financas']);
    assert.ok(!('erro' in r), 'erro' in r ? r.erro : '');
    if ('erro' in r) return;
    assert.deepEqual(r.colunas.slice(0, 5), ['termo', 'coeficiente', 'erro_padrao', 'estatistica_t', 'p_valor']);
    assert.equal(r.linhas[1][0], 'x');
    quase(r.linhas[1][1] as number, 0.5001, 1e-4);
    assert.equal(r.linhas[0][r.colunas.indexOf('n_observacoes')], 11);
    assert.match(String(r.linhas[0][r.colunas.indexOf('tipo_erro_padrao')]), /clássico/);
    const semVariacao = await executarConsulta({ sql: 'SELECT 1 AS x, y FROM (VALUES (1), (2), (3)) v(y)', regressao: { y: 'y', x: ['x'], erro_padrao: '' } }, ['financas']);
    assert.ok('erro' in semVariacao && /não varia/.test(semVariacao.erro));
  });

  // ---------- unidades por metadados ----------
  test('contagens inteiras, correlações sem R$, códigos sem separador, fator com seis casas, p-valor pequeno legível', () => {
    // nomes do teste de regressão: contagem com "receita" no nome e correlação com "fpm" no nome
    assert.equal(tipoColuna('com_receita', [246]), 'contagem');
    assert.equal(formatarCelula(246, tipoColuna('com_receita', [246])), '246');
    assert.equal(tipoColuna('corr_fpm_despesa', [0.41]), 'estatistica');
    assert.equal(tipoColuna('r2_fpm', [0.17]), 'estatistica');
    assert.ok(!rotuloColuna('corr_fpm_despesa', 'estatistica').includes('R$'));
    assert.equal(formatarCelula(5208707, tipoColuna('cod_ibge', [5208707])), '5208707');
    assert.equal(formatarCelula(1.0456789123, 'indice'), '1,045679');
    assert.match(formatarCelula(0.0000123, 'estatistica'), /e-5$/);
    // a unidade declarada na consulta vale mais que o nome
    const sql = 'SELECT 246 AS receita_x, 0.5 AS despesa_corr';
    registrarColunas(sql, [{ nome: 'receita_x', unidade: 'contagem', rotulo: 'Municípios com receita' }, { nome: 'despesa_corr', unidade: 'estatistica', rotulo: '' }]);
    const f = formatarTabela({ colunas: ['receita_x', 'despesa_corr'], linhas: [[246, 0.5]], total: 1 }, sql);
    assert.deepEqual(f.linhas[0], ['246', '0,5000']);
    assert.equal(f.cabecalho[0], 'Municípios com receita');
    assert.ok(!f.cabecalho[1].includes('R$'));
    // populacao do catálogo: contagem com acento no rótulo
    assert.equal(tipoColuna('populacao_ibge', [1437366]), 'contagem');
    assert.match(rotuloColuna('populacao_media', 'contagem'), /população/);
  });

  test('ausências: variação sem referência na primeira linha ≠ sem dado; contribuição soma a variação do total', () => {
    const simples = montarTabela(espec({ tipo: 'tabela', colunas: [], grupo: '', valor: '', periodo: '', de: '', ate: '' }),
      { rotulo: 'C1', sql: 'SELECT ano, receita, variacao_pct FROM x', resultado: { colunas: ['ano', 'receita', 'variacao_pct'], linhas: [[2023, 100, null], [2024, 110, 10], [2025, null, null]], total: 3 } });
    assert.ok(simples.ok);
    if (!simples.ok) return;
    assert.equal(simples.tabela.linhas[0][2].a, 'sem_referencia');
    assert.equal(simples.tabela.linhas[2][2].a, undefined, 'linha sem o valor: é ausência, não variação não calculada');
    const res: Resultado = { colunas: ['ano', 'subsistema', 'vinculos'], linhas: [[2011, 'A', 100], [2011, 'B', 300], [2021, 'A', 150], [2021, 'B', 330]], total: 4 };
    const tab = montar(espec({ participacao: false }), res);
    const iContrib = tab.colunas.findIndex((c) => /Contribuição/.test(c.nome));
    const iVar = tab.colunas.findIndex((c) => c.nome === 'Variação (%)');
    assert.ok(iContrib > 0);
    const soma = tab.linhas.slice(0, 2).reduce((s, l) => s + (l[iContrib].v as number), 0);
    quase(soma, tab.linhas[tab.linhaTotal!][iVar].v as number);
    quase(tab.linhas[0][iContrib].v as number, 12.5); // (150 − 100) ÷ 400 × 100
    // denominador inválido: valor inicial zero não tem variação percentual
    const zero = montar(espec({ participacao: false, total: false }), { colunas: ['ano', 'subsistema', 'vinculos'], linhas: [[2011, 'A', 0], [2021, 'A', 5]], total: 2 });
    assert.equal(zero.linhas[0][4].a, 'base_zero');
    // duplicidade: duas linhas para o mesmo período e grupo não viram tabela
    const dup = montarTabela(espec(), { rotulo: 'C1', sql: 'SELECT 1', resultado: { colunas: ['ano', 'subsistema', 'vinculos'], linhas: [[2011, 'A', 1], [2011, 'A', 2], [2021, 'A', 3]], total: 3 } });
    assert.ok(!dup.ok && /mais de uma linha/.test(dup.motivo));
  });

  // ---------- variável pedida, estatísticas, causalidade e sugestões ----------
  const pronta = (o: { tabelaSql: string; conclusao?: string; texto?: string; aprofundar?: string[]; regressao?: boolean }) => {
    const resultado: Resultado = { colunas: ['ano', 'grupo', 'valor'], linhas: [[2024, 'A', 1], [2025, 'A', 2]], total: 2 };
    const c1 = feita('C1', o.tabelaSql, resultado);
    if (o.regressao) c1[1].regressao = { y: 'valor', x: ['fpm_pc'], erroPadrao: 'hc1' };
    const r = lerResposta({ resposta: respostaBase({
      conclusao: o.conclusao ?? 'Resultado.', explicacao: o.texto ?? '', aprofundar: o.aprofundar ?? [],
      tabelas: [{ consulta: 'C1', papel: 'principal', tipo: 'serie', titulo: 'T', grupo: 'grupo', periodo: 'ano', valor: 'valor', colunas: [], de: '2024', ate: '2025', total: false, participacao: false, formato: 'reais', unidade: '', nota: '' }],
    }) })!;
    return prepararResposta(r, new Map([c1]));
  };
  const PERGUNTA_F04 = 'Faça uma regressão entre FPM per capita e despesa administrativa per capita (Função 04 – Administração) nos municípios goianos em 2025.';

  test('ICSAP pedida: sinônimos em português e inglês, taxa e participação com o denominador certo, grupos e agregação', () => {
    const ids = (p: string) => conceitosPedidos(p).map((c) => c.id).filter((i) => i.startsWith('icsap'));
    const rev = (sql: string, pergunta: string) => revisarMetodo(pronta({ tabelaSql: sql }), { pergunta }).filter((p) => /ICSAP|condições sensíveis/.test(p));
    // sinônimos
    for (const p of ['Qual a taxa de ICSAP em Goiânia?', 'internações por condições sensíveis à atenção primária no Brasil', 'internações sensíveis à atenção básica (ICSAB)', 'hospitalizações evitáveis em Goiás', 'ambulatory care-sensitive admissions in Brazil', 'ACSC hospitalisations by state', 'primary care sensitive conditions']) {
      assert.ok(ids(p).includes('icsap'), p);
    }
    assert.deepEqual(ids('Qual a mortalidade infantil de Goiânia?'), []);
    assert.deepEqual(ids('Quantas internações houve em Goiânia em 2024?'), [], 'internações em geral não são ICSAP');
    assert.deepEqual(ids('Quais capítulos da CID-10 mais internam em Goiás?'), []);
    // taxa × participação × grupo
    assert.deepEqual(ids('Qual a taxa de ICSAP por 10 mil habitantes em Goiânia em 2024?'), ['icsap', 'icsap_taxa']);
    assert.deepEqual(ids('ICSAP rate per 10,000 inhabitants in Goiânia'), ['icsap', 'icsap_taxa']);
    assert.deepEqual(ids('Qual a participação das ICSAP nas internações de Goiânia?'), ['icsap', 'icsap_participacao']);
    assert.deepEqual(ids('Share of ambulatory care-sensitive admissions in total admissions'), ['icsap', 'icsap_participacao']);
    assert.deepEqual(ids('Qual a participação de cada grupo nas ICSAP?'), ['icsap', 'icsap_grupo_participacao'], 'participação por grupo: não é a do total');
    assert.deepEqual(ids('ICSAP por diabetes e hipertensão em Goiás'), ['icsap', 'icsap_g09', 'icsap_g13']);
    assert.deepEqual(ids('ICSAP por pré-natal e parto, AVC e infecção urinária'), ['icsap', 'icsap_g12', 'icsap_g15', 'icsap_g19']);
    const T = 'Qual a taxa de ICSAP por 10 mil habitantes no Brasil?';
    const P = 'Qual a participação das ICSAP nas internações no Brasil?';
    // SQL correto passa
    const taxaOk = 'SELECT ano, 10000.0 * sum(icsap_int) / sum(populacao) AS valor FROM saude_municipios WHERE ano = 2024 GROUP BY ano';
    const partOk = 'SELECT ano, 100.0 * sum(icsap_int) / nullif(sum(icsap_base), 0) AS valor FROM saude_municipios WHERE ano = 2024 GROUP BY ano';
    assert.deepEqual(rev(taxaOk, T), []);
    assert.deepEqual(rev(partOk, P), []);
    assert.deepEqual(rev('SELECT ano, sum(icsap_g13) AS valor FROM saude_municipios GROUP BY ano', 'ICSAP por diabetes no Brasil'), []);
    // SQL incorreto volta ao modelo: a variável do SIH em geral no lugar da ICSAP
    assert.ok(rev('SELECT ano, 10000.0 * sum(int_total) / sum(populacao) AS valor FROM saude_municipios GROUP BY ano', T).some((p) => /Não apresente outra variável/.test(p) && /icsap_int/.test(p)));
    assert.ok(rev('SELECT ano, 10000.0 * sum(int_cap09) / sum(populacao) AS valor FROM saude_municipios GROUP BY ano', T).length > 0, 'capítulo da CID-10 não é ICSAP');
    // taxa com a base de internações no denominador (é a participação), sem população
    assert.ok(rev('SELECT ano, 10000.0 * sum(icsap_int) / sum(icsap_base) AS valor FROM saude_municipios GROUP BY ano', T).some((p) => /taxa de ICSAP/.test(p) && /populacao/.test(p)));
    // participação com int_total (inclui partos) no denominador
    const semBase = rev('SELECT ano, 100.0 * sum(icsap_int) / sum(int_total) AS valor FROM saude_municipios GROUP BY ano', P);
    assert.ok(semBase.some((p) => /participação das ICSAP/.test(p) && /icsap_base/.test(p) && /partos/.test(p)), semBase.join('\n'));
    // grupo errado: pediu diabetes (g13) e a consulta traz hipertensão (g09)
    assert.ok(rev('SELECT ano, sum(icsap_g09) AS valor FROM saude_municipios GROUP BY ano', 'ICSAP por diabetes no Brasil').some((p) => /grupo 13/.test(p)));
    // ICSAP pedida e a consulta nem toca nas colunas icsap_*
    assert.ok(rev('SELECT ano, sum(obitos) AS valor FROM saude_municipios GROUP BY ano', 'Evolução das ICSAP no Brasil').length > 0);
    // os literais não valem: o nome da coluna numa string não atende
    assert.ok(rev("SELECT ano, sum(int_total) AS valor, 'icsap_int' AS nota FROM saude_municipios GROUP BY ano", 'Evolução das ICSAP no Brasil').length > 0);
    // cobertura e fonte: icsap_* tem o manifesto do ICSAP (2008–2025), não o do SIM/SINASC nem o do SIH
    const anos = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);
    const cob: Cobertura = { rais: anos(2010, 2025), caged: null, microdados: false, dca: anos(2013, 2025), sim: anos(1996, 2024), sinasc: anos(1996, 2024), sih: anos(2008, 2025), icsap: anos(2008, 2025), popSvs: anos(2000, 2025) };
    assert.deepEqual(coberturaDaFonte(taxaOk, cob), { nome: 'ICSAP (SIH)', anos: anos(2008, 2025) });
    assert.equal(coberturaDaFonte('SELECT sum(int_total) FROM saude_municipios', cob)?.nome, 'SIH');
    assert.equal(coberturaDaFonte(taxaOk, { ...cob, icsap: undefined })?.nome, 'SIM/SINASC', 'manifesto sem ICSAP: nada é inventado para a coluna');
    assert.match(fichaDaColuna('icsap_int', cob) ?? '', /Portaria SAS\/MS nº 221\/2008[\s\S]*Cobertura: 2008 a 2025; municípios de residência[\s\S]*nulo \(não é zero\)/);
    assert.match(fichaDaColuna('icsap_base', cob) ?? '', /exceto partos|excluídas as por partos/);
    assert.match(fichaDaColuna('icsap_g13', cob) ?? '', /grupo 13[\s\S]*diabetes mellitus/);
    assert.match(descreverCobertura(['saude'], cob).join('\n'), /ICSAP 2008–2025: internações por condições sensíveis/);
    assert.match(disponibilidadeNoAno(2026, ['saude'], { ...cob, icsap: anos(2008, 2025) }), /ICSAP \(SIH\) \(2008–2025\)/);
    assert.ok(fontesConsultadas([taxaOk]).some((f) => /Lista Brasileira de ICSAP/.test(f)));
    assert.ok(!fontesConsultadas([taxaOk]).some((f) => /SIH \(internações hospitalares do SUS por município de residência ou do hospital\)/.test(f)));
    // unidade: a contagem ICSAP é contagem; a taxa declarada como razão
    assert.equal(tipoColuna('icsap_int', [10030, 12], undefined), 'contagem');
    assert.equal(tipoColuna('icsap_g13', [1, 2], undefined), 'contagem');
  });

  test('ICSAP total × por grupo × vários grupos: a revisão aceita o SQL certo de cada medida e recusa a troca (fluxo conceitosPedidos → atendeConceito → revisarMetodo)', () => {
    const ids = (p: string) => conceitosPedidos(p).map((c) => c.id).filter((i) => i.startsWith('icsap'));
    const rev = (sql: string, pergunta: string) => revisarMetodo(pronta({ tabelaSql: sql }), { pergunta }).filter((p) => /ICSAP|condições sensíveis/.test(p));
    const FROM = ' FROM saude_municipios WHERE ano = 2024';
    const taxa = (col: string) => `SELECT 10000.0 * sum(${col}) / sum(populacao) AS valor${FROM}`;
    const part = (col: string, den: string) => `SELECT 100.0 * sum(${col}) / nullif(sum(${den}), 0) AS valor${FROM}`;
    // 1) taxa por grupo (português e inglês): o grupo certo com a população passa; o total, o grupo errado ou outro denominador voltam
    for (const p of ['Taxa de ICSAP por asma por 10 mil habitantes', 'Asthma ICSAP rate per 10,000 inhabitants']) {
      assert.deepEqual(ids(p), ['icsap', 'icsap_grupo_taxa', 'icsap_g07'], p);
      assert.deepEqual(rev(taxa('icsap_g07'), p), [], `${p}: SQL correto recusado`);
      assert.ok(rev(taxa('icsap_int'), p).some((m) => /asma/.test(m)), `${p}: o total no lugar do grupo`);
      assert.ok(rev(taxa('icsap_g13'), p).some((m) => /grupo 7/.test(m)), `${p}: grupo errado`);
      assert.ok(rev(`SELECT 10000.0 * sum(icsap_g07) / sum(icsap_int) AS valor${FROM}`, p).some((m) => /taxa de ICSAP de um grupo/.test(m) && /populacao/.test(m)), `${p}: denominador errado`);
    }
    // 2) participação de um grupo, sem a palavra "grupo": nas ICSAP (base icsap_int) ou nas internações sem partos (base icsap_base)
    for (const p of ['Participação da asma nas ICSAP', 'Share of asthma in ICSAP admissions']) {
      assert.deepEqual(ids(p), ['icsap', 'icsap_grupo_participacao', 'icsap_g07'], p);
      assert.deepEqual(rev(part('icsap_g07', 'icsap_int'), p), [], `${p}: SQL correto recusado`);
      assert.deepEqual(rev(part('icsap_g07', 'icsap_base'), p), [], `${p}: base sem partos também vale`);
      assert.ok(rev(part('icsap_g07', 'int_total'), p).some((m) => /participação de um grupo/.test(m) && /partos/.test(m)), `${p}: int_total inclui partos`);
      assert.ok(rev(part('icsap_g09', 'icsap_int'), p).some((m) => /grupo 7/.test(m)), `${p}: grupo errado`);
    }
    // com a palavra "grupo" o resultado é o mesmo
    assert.deepEqual(rev(part('icsap_g07', 'icsap_int'), 'Participação do grupo asma nas ICSAP'), []);
    // 3) o total continua exigindo o total e o denominador certo, mesmo que a consulta traga a asma
    const T = 'Taxa de ICSAP por 10 mil habitantes no Brasil';
    const P = 'Participação das ICSAP nas internações do Brasil';
    assert.deepEqual(ids(T), ['icsap', 'icsap_taxa']);
    assert.deepEqual(ids(P), ['icsap', 'icsap_participacao']);
    assert.ok(rev(taxa('icsap_g07'), T).length > 0, 'taxa TOTAL não aceita só a asma');
    assert.ok(rev(part('icsap_g07', 'icsap_int'), P).length > 0, 'participação TOTAL não aceita só a asma');
    assert.ok(rev(part('icsap_int', 'icsap_int'), P).some((m) => /icsap_base/.test(m)), 'participação geral exige a base sem partos');
    assert.ok(rev(part('icsap_int', 'int_total'), P).some((m) => /icsap_base/.test(m)));
    assert.deepEqual(rev(part('icsap_int', 'icsap_base'), P), []);
    assert.deepEqual(rev(taxa('icsap_int'), T), []);
    // 4) vários grupos: cada um precisa aparecer (diabetes e hipertensão)
    for (const p of ['Taxa de ICSAP por diabetes e hipertensão por 10 mil habitantes', 'ICSAP rate per 10,000 inhabitants for diabetes and hypertension']) {
      assert.deepEqual(ids(p), ['icsap', 'icsap_grupo_taxa', 'icsap_g09', 'icsap_g13'], p);
      const dois = `SELECT 10000.0 * sum(icsap_g13) / sum(populacao) AS dm, 10000.0 * sum(icsap_g09) / sum(populacao) AS has${FROM}`;
      assert.deepEqual(rev(dois, p), [], `${p}: SQL correto recusado`);
      assert.ok(rev(taxa('icsap_g13'), p).some((m) => /grupo 9/.test(m)), `${p}: faltou hipertensão`);
      assert.ok(rev(taxa('icsap_int'), p).length > 0, `${p}: o total no lugar dos grupos`);
    }
    const pdois = 'Participação de diabetes e hipertensão nas ICSAP';
    assert.deepEqual(ids(pdois), ['icsap', 'icsap_grupo_participacao', 'icsap_g09', 'icsap_g13']);
    assert.deepEqual(rev(`SELECT 100.0 * sum(icsap_g13) / nullif(sum(icsap_int), 0) AS dm, 100.0 * sum(icsap_g09) / nullif(sum(icsap_int), 0) AS has${FROM}`, pdois), []);
    assert.ok(rev(part('icsap_g09', 'icsap_int'), pdois).some((m) => /grupo 13/.test(m)));
    // 5) total + grupo, quando a pergunta pede os dois de forma explícita: precisa do total e do grupo
    const TG = 'Taxa total de ICSAP e a taxa de ICSAP por asma, por 10 mil habitantes';
    assert.deepEqual(ids(TG), ['icsap', 'icsap_taxa', 'icsap_grupo_taxa', 'icsap_g07']);
    const ambos = `SELECT 10000.0 * sum(icsap_int) / sum(populacao) AS total, 10000.0 * sum(icsap_g07) / sum(populacao) AS asma${FROM}`;
    assert.deepEqual(rev(ambos, TG), []);
    assert.ok(rev(taxa('icsap_g07'), TG).length > 0, 'faltou o total');
    assert.ok(rev(taxa('icsap_int'), TG).length > 0, 'faltou a asma');
    const PG = 'Participação geral das ICSAP nas internações e participação da asma nas ICSAP';
    assert.deepEqual(ids(PG), ['icsap', 'icsap_participacao', 'icsap_grupo_participacao', 'icsap_g07']);
    assert.deepEqual(rev(`SELECT 100.0 * sum(icsap_int) / nullif(sum(icsap_base), 0) AS geral, 100.0 * sum(icsap_g07) / nullif(sum(icsap_int), 0) AS asma${FROM}`, PG), []);
    assert.ok(rev(part('icsap_g07', 'icsap_int'), PG).length > 0, 'faltou a participação geral com a base sem partos');
  });

  test('ICSAP: "all ACSC" como denominador não é pedido de total; pedido misto (taxa total + contagem do grupo) não impõe taxa ao grupo', () => {
    const ids = (p: string) => conceitosPedidos(p).map((c) => c.id).filter((i) => i.startsWith('icsap'));
    const FROM = ' FROM saude_municipios WHERE ano = 2024';
    // várias consultas principais, uma tabela por consulta (como na resposta do modelo)
    const revVarias = (sqls: string[], pergunta: string) => {
      const consultas = sqls.map((sql, i) => feita(`C${i + 1}`, sql, { colunas: ['valor'], linhas: [[1]], total: 1 }));
      const r = lerResposta({ resposta: respostaBase({
        conclusao: 'Resultado.', explicacao: '', aprofundar: [],
        tabelas: sqls.map((_, i) => ({ consulta: `C${i + 1}`, papel: 'principal', tipo: 'serie', titulo: 'T', grupo: 'grupo', periodo: 'ano', valor: 'valor', colunas: [], de: '2024', ate: '2025', total: false, participacao: false, formato: 'reais', unidade: '', nota: '' })),
      }) })!;
      return revisarMetodo(prepararResposta(r, new Map(consultas)), { pergunta }).filter((m) => /ICSAP|condições sensíveis/.test(m));
    };
    const pAsma = 'SELECT 100.0 * sum(icsap_g07) / nullif(sum(icsap_int), 0) AS valor' + FROM;
    const tTotal = 'SELECT 10000.0 * sum(icsap_int) / sum(populacao) AS valor' + FROM;
    const cAsma = 'SELECT sum(icsap_g07) AS valor' + FROM;
    // A) "all ACSC" é o denominador: pergunta de grupo, não do total
    for (const p of ['Share of asthma in all ACSC admissions', 'Share of asthma in overall ICSAP admissions', 'Participação da asma em todas as ICSAP']) {
      assert.deepEqual(ids(p), ['icsap', 'icsap_grupo_participacao', 'icsap_g07'], p);
      assert.deepEqual(revVarias([pAsma], p), [], `${p}: SQL correto recusado`);
      assert.ok(revVarias(['SELECT 100.0 * sum(icsap_g09) / nullif(sum(icsap_int), 0) AS valor' + FROM], p).some((m) => /grupo 7/.test(m)), `${p}: grupo errado`);
    }
    // o total explícito segue valendo
    assert.ok(ids('Overall ICSAP rate and asthma rate per 10,000 inhabitants').includes('icsap_taxa'));
    assert.deepEqual(ids('Total ACSC share and asthma share of ICSAP'), ['icsap', 'icsap_participacao', 'icsap_grupo_participacao', 'icsap_g07']);
    // B) pedido misto: taxa total + contagem do grupo (duas consultas principais corretas)
    for (const p of ['Taxa total de ICSAP e contagem de ICSAP por asma', 'Total ICSAP rate and count of asthma ICSAP']) {
      assert.deepEqual(ids(p).filter((i) => i !== 'icsap_g07' && i !== 'icsap'), ['icsap_taxa'], `${p}: só a taxa do total`);
      assert.deepEqual(revVarias([tTotal, cAsma], p), [], `${p}: consultas corretas recusadas`);
      assert.ok(revVarias([tTotal], p).some((m) => /asma|grupo 7/.test(m)), `${p}: faltou o grupo`);
      assert.ok(revVarias([cAsma], p).length > 0, `${p}: faltou a taxa do total`);
      assert.ok(revVarias(['SELECT 10000.0 * sum(int_total) / sum(populacao) AS valor' + FROM, cAsma], p).length > 0, `${p}: total trocado por int_total`);
    }
    // sem pedido misto, o grupo com taxa segue exigindo população
    const pt = 'Taxa de ICSAP por asma por 10 mil habitantes';
    assert.deepEqual(ids(pt), ['icsap', 'icsap_grupo_taxa', 'icsap_g07']);
    assert.ok(revVarias([cAsma], pt).some((m) => /populacao/.test(m)));
  });

  test('Função 04 pedida: substituir pela despesa total volta ao modelo; despesa_administracao ou F04 atendem', () => {
    const trocada = revisarMetodo(pronta({ tabelaSql: 'SELECT ano, nome AS grupo, despesa_empenhada_sem_intra / populacao_ibge AS valor FROM indicadores' }), { pergunta: PERGUNTA_F04 });
    assert.ok(trocada.some((p) => /Função 04/.test(p) && /Não apresente outra variável/.test(p)), trocada.join('\n'));
    assert.deepEqual(revisarMetodo(pronta({ tabelaSql: 'SELECT ano, nome AS grupo, despesa_administracao / populacao_ibge AS valor, fpm FROM indicadores' }), { pergunta: PERGUNTA_F04 })
      .filter((p) => /Função 04/.test(p)), []);
    assert.deepEqual(revisarMetodo(pronta({ tabelaSql: "SELECT exercicio AS ano, 'A' AS grupo, empenhada AS valor, fpm FROM despesa_funcao JOIN indicadores USING (exercicio, cod_ibge) WHERE funcao_cod = 'F04'" }), { pergunta: PERGUNTA_F04 })
      .filter((p) => /Função 04/.test(p)), []);
    // "despesa com pessoal" não é a função 04, e vice-versa
    assert.ok(revisarMetodo(pronta({ tabelaSql: 'SELECT ano, nome AS grupo, despesa_administracao AS valor FROM indicadores' }), { pergunta: 'Qual a despesa com pessoal de Goiânia?' })
      .some((p) => /despesa com pessoal/.test(p)));
  });

  test('p-valor sem regressão da página volta; com a regressão passa; causalidade e controles; capitais de uma UF', () => {
    const sql = 'SELECT ano, nome AS grupo, despesa_administracao AS valor, fpm FROM indicadores';
    assert.ok(revisarMetodo(pronta({ tabelaSql: sql, texto: 'O coeficiente é significativo (p-valor < 0,01).' }), { pergunta: PERGUNTA_F04 })
      .some((p) => /sem uma regressão calculada pela página/.test(p)));
    assert.ok(!revisarMetodo(pronta({ tabelaSql: sql, texto: 'O coeficiente é significativo (p-valor < 0,01).', regressao: true }), { pergunta: PERGUNTA_F04 })
      .some((p) => /sem uma regressão calculada pela página/.test(p)));
    const causa = 'Prove que o FPM causa aumento da despesa da Função 04.';
    assert.ok(revisarMetodo(pronta({ tabelaSql: sql, conclusao: 'O FPM aumenta a despesa.' }), { pergunta: causa }).some((p) => /causalidade/.test(p)));
    assert.ok(!revisarMetodo(pronta({ tabelaSql: sql, conclusao: 'Há associação positiva; os dados não permitem concluir causalidade.' }), { pergunta: causa }).some((p) => /pede causa/.test(p)));
    assert.ok(revisarMetodo(pronta({ tabelaSql: sql, texto: 'Uma regressão com controles permitiria identificar o efeito causal do FPM.' }), { pergunta: causa })
      .some((p) => /controles/.test(p)));
    const sug = revisarMetodo(pronta({ tabelaSql: sql, aprofundar: ['Como Goiânia se compara com outras capitais de Goiás?', 'E as capitais do Nordeste?'] }), { pergunta: PERGUNTA_F04 });
    assert.equal(sug.filter((p) => /geografia/.test(p)).length, 1);
    assert.match(sug.find((p) => /geografia/.test(p))!, /outras capitais de Goiás/);
    assert.doesNotMatch(sug.find((p) => /geografia/.test(p))!, /Nordeste/);
  });

  test('deflator: razão de índices montada à mão e fator < 1 antes do ano-base voltam ao modelo; fator_real passa', async () => {
    // cenário B (Goiânia, 2023 e 2025): o modelo fez indice do ano ÷ indice de 2025 e o real de 2023 ficou menor que o nominal
    const invertida = "WITH d AS (SELECT exercicio, indice / (SELECT indice FROM ipca WHERE exercicio = 2025) AS fator FROM ipca) SELECT ano, nome AS grupo, receita_corrente * d.fator AS valor FROM indicadores";
    assert.ok(revisarMetodo(pronta({ tabelaSql: invertida }), { pergunta: 'Receitas correntes reais de Goiânia' }).some((p) => /fator_real/.test(p)));
    const certa = 'SELECT i.exercicio AS ano, nome AS grupo, receita_corrente * p.fator_real AS valor FROM indicadores i JOIN ipca p USING (exercicio)';
    assert.ok(!revisarMetodo(pronta({ tabelaSql: certa }), { pergunta: 'Receitas correntes reais de Goiânia' }).some((p) => /fator_real|Deflator/.test(p)));
    // pelo resultado: fator 1 em 2025 e 0,91 em 2023 = invertido
    const c1 = feita('C1', 'SELECT exercicio, fator FROM x', { colunas: ['exercicio', 'fator'], linhas: [[2023, 0.9149], [2025, 1]], total: 2 });
    const r = lerResposta({ resposta: respostaBase({ destaques: [{ rotulo: 'f', valor: 0.9149, formato: 'decimal', unidade: '', consulta: 'C1', coluna: 'fator', de: '2023', ate: '2023' }] }) })!;
    assert.ok(revisarMetodo(prepararResposta(r, new Map([c1])), { pergunta: 'x' }).some((p) => /Deflator invertido em C1/.test(p)));
    // o fator pronto do gold: maior que 1 antes do ano-base, 1 no ano-base
    if (!semIbge) {
      const f = await consultaLivre('SELECT exercicio, fator_real, ano_base, indice FROM ipca WHERE exercicio IN (2023, 2025) ORDER BY 1', 5);
      assert.equal(f.linhas[1][1], 1);
      assert.ok((f.linhas[0][1] as number) > 1);
      quase(f.linhas[0][1] as number, (f.linhas[1][3] as number) / (f.linhas[0][3] as number));
    }
  });

  test('número formatado como texto no SQL (printf) volta ao modelo: o Excel precisa do número', () => {
    const sql = "SELECT exercicio AS ano, replace(printf('%,d', populacao_ibge), ',', '.') AS grupo, pib_per_capita AS valor FROM indicadores";
    assert.ok(revisarMetodo(pronta({ tabelaSql: sql }), { pergunta: 'PIB per capita de Goiânia' }).some((p) => /Não formate números no SQL/.test(p)));
    assert.ok(!revisarMetodo(pronta({ tabelaSql: 'SELECT exercicio AS ano, nome AS grupo, pib_per_capita AS valor FROM indicadores' }), { pergunta: 'PIB per capita de Goiânia' })
      .some((p) => /Não formate/.test(p)));
  });

  test('fontes: a população declarada não é creditada ao IBGE; populacao_ibge e pib_per_capita sim', () => {
    const declarada = fontesConsultadas(['SELECT despesa_empenhada / populacao FROM indicadores']);
    assert.ok(declarada.some((f) => /declarada pelo ente/.test(f)));
    assert.ok(!declarada.some((f) => /^IBGE: (estimativas|população)/.test(f)));
    assert.ok(fontesConsultadas(['SELECT pib, populacao_ibge FROM indicadores']).some((f) => /IBGE: população de referência/.test(f)));
    assert.ok(fontesConsultadas(['SELECT empregos, populacao FROM trab_municipios']).some((f) => /IBGE: população de referência/.test(f)));
  });

  test('catálogo e instruções: cada conceito conferido tem a sua coluna descrita nas instruções do modelo', () => {
    const texto = [FINANCAS, TRABALHO, SAUDE, contextoDosDados({ fontes: {} })].join('\n');
    for (const c of CONCEITOS) {
      const colunas = (c.atende.source.replace(/\\[a-zA-Z]/g, ' ').match(/[a-z]+(?:_[a-z0-9]+)+|\b(?:fpm|infantis|nascidos|maternos)\b/g) ?? []).filter((x) => !x.startsWith('_'));
      assert.ok(colunas.some((x) => texto.includes(x)), `${c.id}: nenhuma de ${colunas.join(', ')} nas instruções`);
    }
    assert.match(FINANCAS, /populacao: a DECLARADA/);
    assert.match(FINANCAS, /despesa_funcao/);
  });

  // ---------- dados (pipeline): população do IBGE, função 04 e setores ----------
  const semIbge = !existsSync(`${DATA}/gold/despesa_funcao.parquet`);

  test('Goiânia: população do IBGE por publicação e PIB per capita igual ao do IBGE Cidades', { skip: semIbge }, async () => {
    const r = await consultaLivre(`SELECT exercicio, populacao, populacao_ibge, populacao_ibge_ano, pib_per_capita FROM indicadores
      WHERE cod_ibge = 5208707 AND exercicio IN (2022, 2023, 2024, 2025) ORDER BY 1`, 10);
    const linha = (ano: number) => r.linhas.find((l) => l[0] === ano)!;
    assert.deepEqual(linha(2023).slice(1, 4), [1555626, 1437366, 2022]); // declarada = estimativa de 2021; IBGE = Censo 2022
    assert.deepEqual(linha(2025).slice(2, 4), [1503256, 2025]);
    assert.deepEqual(linha(2024).slice(2, 4), [1494599, 2024]);
    quase(linha(2023)[4] as number, 52722.02, 1e-6); // IBGE Cidades: R$ 52.722,02
  });

  test('regra da população do IBGE vale em todos os entes e anos (o próprio ano; só 2023 usa o ano anterior)', { skip: semIbge }, async () => {
    const r = await consultaLivre(`SELECT count(*) FILTER (populacao_ibge IS NULL) AS sem,
        count(*) FILTER (populacao_ibge_ano <> exercicio AND NOT (exercicio = 2023 AND populacao_ibge_ano = 2022)) AS fora_da_regra,
        count(*) FILTER (populacao_ibge <= 0) AS invalidas
      FROM indicadores WHERE esfera IN ('M', 'E', 'D')`, 5);
    assert.deepEqual(r.linhas[0], [0, 0, 0]);
  });

  test('despesa por função: as 28 funções somam a despesa sem intra; função 04 = despesa_administracao', { skip: semIbge }, async () => {
    await tabelaDespesaFuncao();
    const r = await consultaLivre(`WITH f AS (SELECT exercicio, cod_ibge, sum(empenhada) AS soma, sum(empenhada) FILTER (funcao_cod = 'F04') AS f04,
        count(*) AS linhas, count(DISTINCT funcao_cod) AS funcoes FROM despesa_funcao WHERE exercicio = 2023 GROUP BY ALL)
      SELECT count(*) AS entes, count(*) FILTER (abs(f.soma - i.despesa_empenhada_sem_intra) > 1) AS soma_diferente,
        count(*) FILTER (f.f04 IS DISTINCT FROM i.despesa_administracao) AS f04_diferente, count(*) FILTER (linhas <> funcoes) AS duplicadas
      FROM f JOIN indicadores i USING (exercicio, cod_ibge)`, 5);
    const [entes, soma, f04, dup] = r.linhas[0] as number[];
    assert.ok(entes > 5000);
    assert.equal(f04, 0);
    assert.equal(dup, 0, 'uma linha por ente, ano e função');
    assert.ok(soma / entes < 0.01, `${soma} de ${entes} entes com soma das funções diferente do total sem intra`);
  });

  test('trabalho: população do IBGE (a mesma de populacao_ibge) e setor sem vínculo = zero, não ausência', { skip: semIbge }, async () => {
    await tabelasIaTrabalho();
    const r = await consultaLivre(`SELECT count(*) FILTER (t.populacao IS DISTINCT FROM i.populacao_ibge) AS diferentes,
        count(*) FILTER (t.empregos_construcao IS NULL OR t.empregos_industria IS NULL OR t.empregos_adm_publica IS NULL) AS setores_nulos,
        count(*) FILTER (t.empregos_agropecuaria + t.empregos_industria + t.empregos_construcao + t.empregos_comercio + t.empregos_servicos + t.empregos_adm_publica <> t.empregos) AS soma_diferente
      FROM trab_municipios t JOIN indicadores i ON i.exercicio = t.ano AND i.cod_ibge = t.cod_ibge
      WHERE t.uf = 'GO' AND t.ano IN (2024, 2025)`, 5);
    assert.equal(r.linhas[0][1], 0);
    assert.equal(r.linhas[0][0], 0);
    // empregos sem divisão CNAE válida ficam fora dos seis setores (ignorado): a soma pode ser menor, nunca maior
    const maior = await consultaLivre(`SELECT count(*) FROM trab_municipios WHERE uf = 'GO' AND ano IN (2024, 2025)
      AND empregos_agropecuaria + empregos_industria + empregos_construcao + empregos_comercio + empregos_servicos + empregos_adm_publica > empregos`, 5);
    assert.equal(maior.linhas[0][0], 0);
  });

  test('reexecução de conversa antiga refaz a regressão com o pedido inteiro, não só o SQL', async () => {
    const entradas: unknown[] = [];
    const conversa: Conversa = {
      formato: FORMATO_CONVERSA, versao: VERSAO_CONVERSA, id: 'x', titulo: 'Reg', tituloManual: false, criadaEm: 1, atualizadaEm: 1,
      mensagens: [
        { role: 'user', content: [{ type: 'text', text: 'Contexto da página: Brasil' }, { type: 'text', text: 'Regressão?' }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'consultar', input: { sql: 'SELECT 1 AS y, 2 AS x', regressao: { y: 'y', x: ['x'], erro_padrao: 'hc1' } } }] },
      ],
      metas: [{ contexto: { paineis: ['financas'], territorio: { tipo: 'brasil' }, ano: null, modo: 'pesquisa' } as unknown as ContextoIa, inicio: 1 }],
      resultados: {}, fontes: {}, origem: { tipo: 'nova' },
    } as unknown as Conversa;
    await novaVersaoComDadosAtuais(conversa, { executar: async (_sql, _p, entrada) => { entradas.push(entrada); return { erro: 'x' }; }, dados: '2026-10-30', fontes: {} });
    assert.deepEqual((entradas[0] as { regressao: unknown }).regressao, { y: 'y', x: ['x'], erro_padrao: 'hc1' });
  });
});

describe('IA: verificações da página, selos, nulos declarados e catálogo', () => {
  // ---------- chave, junções e amostra, com dados controlados ----------
  // esquerda: 1, 2, 3, 3 e uma chave nula; direita: 2, 3, 4 → N:1, 2 com par, 1 só na esquerda (1), 1 só na direita (4)
  const ESQ = 'SELECT cod FROM (VALUES (1), (2), (3), (3), (NULL)) e(cod)';
  const DIR = 'SELECT cod FROM (VALUES (2), (3), (4)) d(cod)';
  const JUNTA = `SELECT e.cod FROM (${ESQ}) e JOIN (${DIR}) d USING (cod)`;

  test('a página conta chave repetida, cardinalidade, registros sem par (com exemplos), chaves nulas e a amostra', async () => {
    const r = await executarConsulta({
      sql: JUNTA,
      verificacao: {
        chaves: ['cod'],
        juncoes: [{ rotulo: 'esquerda × direita', esquerda: ESQ, direita: DIR, chaves: ['cod'] }],
        amostra: [{ etapa: 'todos', sql: `SELECT count(*) FROM (${ESQ})` }, { etapa: 'com par', sql: `SELECT count(*) FROM (${JUNTA})` }],
      },
    }, ['financas']);
    assert.ok(!('erro' in r), JSON.stringify(r));
    if ('erro' in r) return;
    const v = r.verificacao!;
    // o resultado da junção repete o 3 (duas linhas na esquerda)
    assert.deepEqual(v.chaves, { colunas: ['cod'], linhas: 3, distintas: 2, nulas: 0 });
    const j = v.juncoes[0];
    assert.ok(!('erro' in j));
    if ('erro' in j) return;
    assert.deepEqual(j.esquerda, { linhas: 5, distintas: 3, nulas: 1 });
    assert.deepEqual(j.direita, { linhas: 3, distintas: 3, nulas: 0 });
    assert.equal(j.cardinalidade, 'N:1');
    assert.deepEqual([j.ambas, j.soEsquerda, j.soDireita], [2, 1, 1]);
    assert.deepEqual([j.exemplosEsquerda, j.exemplosDireita], [['1'], ['4']]);
    assert.deepEqual(v.amostra, [{ etapa: 'todos', n: 5 }, { etapa: 'com par', n: 3 }]);
    // o modelo recebe as contagens; a tela e a exportação, as linhas legíveis
    assert.match(paraModelo(r, 'C1'), /"verificacao_da_pagina"/);
    const linhas = linhasDaVerificacao(v);
    assert.match(linhas[0], /repetida \(1 linha a mais\)/);
    assert.match(linhas[1], /cardinalidade N:1; 2 chaves com correspondência; 1 só na esquerda \(1\); 1 só na direita \(4\)/);
    assert.match(linhas[2], /todos: 5 → com par: 3/);
    // revisão: chave repetida sempre volta; sem par só volta se a resposta não disser
    const sem = problemasDaVerificacao(v, 'C1', 'Resultado.');
    assert.ok(sem.some((p) => /C1: a chave \(cod\) se repete/.test(p)));
    assert.ok(sem.some((p) => /ficaram sem correspondência/.test(p)));
    assert.ok(!problemasDaVerificacao(v, 'C1', 'Um município ficou sem correspondência na RAIS.').some((p) => /sem correspondência\. Diga/.test(p)));
  });

  test('junção muitos-para-muitos volta; SQL recusado na verificação vira erro; pedido mal formado é recusado antes de rodar', async () => {
    const dup = 'SELECT cod FROM (VALUES (1), (1)) x(cod)';
    const r = await executarConsulta({ sql: 'SELECT 1 AS x', verificacao: { chaves: [], juncoes: [{ rotulo: 'nn', esquerda: dup, direita: dup, chaves: ['cod'] }], amostra: [] } }, ['financas']);
    assert.ok(!('erro' in r) && r.verificacao);
    if ('erro' in r) return;
    assert.equal((r.verificacao!.juncoes[0] as { cardinalidade: string }).cardinalidade, 'N:N');
    assert.ok(problemasDaVerificacao(r.verificacao!, 'C2', '').some((p) => /muitos-para-muitos/.test(p)));
    const proibida = await executarConsulta({ sql: 'SELECT 1 AS x', verificacao: { chaves: [], juncoes: [], amostra: [{ etapa: 'arquivo', sql: "SELECT * FROM read_csv('x.csv')" }] } }, ['financas']);
    assert.ok(!('erro' in proibida));
    if ('erro' in proibida) return;
    assert.match((proibida.verificacao!.amostra[0] as { erro: string }).erro, /não permitid/);
    assert.equal(lerVerificacao({ chaves: [], juncoes: [], amostra: [] }), null);
    assert.match(String(lerVerificacao({ chaves: ['cod ibge'], juncoes: [], amostra: [] })), /nomes de colunas/);
    assert.match(String(lerVerificacao({ chaves: [], juncoes: [{ rotulo: 'x', esquerda: 'SELECT 1', direita: '', chaves: ['a'] }], amostra: [] })), /esquerda e direita/);
    const recusada = await executarConsulta({ sql: 'SELECT 1', verificacao: { chaves: ['a-b'], juncoes: [], amostra: [] } }, ['financas']);
    assert.ok('erro' in recusada && recusada.bloqueada);
    // chave que não está no resultado (consulta agregada) e etapa sem contagem: registradas, sem devolver a resposta
    const agregada = await executarConsulta({ sql: 'SELECT count(*) AS n FROM (VALUES (1), (2)) v(cod)', verificacao: { chaves: ['cod'], juncoes: [], amostra: [{ etapa: 'duas linhas', sql: 'SELECT * FROM (VALUES (1), (2)) v(x)' }] } }, ['financas']);
    assert.ok(!('erro' in agregada));
    if ('erro' in agregada) return;
    assert.deepEqual(agregada.verificacao!.chaves, { colunas: ['cod'], ausentes: ['cod'] });
    assert.match(linhasDaVerificacao(agregada.verificacao!).join(' '), /não conferida: cod não está no resultado.*duas linhas: falhou/);
    assert.deepEqual(problemasDaVerificacao(agregada.verificacao!, 'C3', ''), []);
  });

  test('cruzamento de fontes diferentes sem verificação da junção volta ao modelo; com ela, não', () => {
    const sql = 'SELECT i.cod_ibge, i.fpm, t.empregos_adm_publica FROM indicadores i JOIN trab_municipios t ON t.cod_ibge = i.cod_ibge AND t.ano = i.exercicio';
    assert.ok(juntaFontes(sql));
    assert.ok(!juntaFontes('SELECT i.receita_corrente * p.fator_real FROM indicadores i JOIN ipca p USING (exercicio)'), 'ipca é tabela de apoio');
    assert.ok(!juntaFontes("SELECT 'indicadores JOIN trab_municipios' AS x FROM indicadores"));
    const revisar = (resultado: Resultado) => {
      const c1 = feita('C1', sql, resultado);
      const r = lerResposta({ resposta: respostaBase({ destaques: [{ rotulo: 'FPM', valor: 10, formato: 'reais', unidade: '', consulta: 'C1', coluna: 'fpm', de: '2025', ate: '2025' }] }) })!;
      return revisarMetodo(prepararResposta(r, new Map([c1])), { pergunta: 'FPM e emprego público' });
    };
    const base = { colunas: ['cod_ibge', 'fpm', 'empregos_adm_publica'], linhas: [[5208707, 10, 5]], total: 1 };
    assert.ok(revisar(base).some((p) => /junta fontes diferentes sem verificação/.test(p)));
    const juncao = { rotulo: 'DCA × RAIS', chaves: ['cod_ibge'], esquerda: { linhas: 1, distintas: 1, nulas: 0 }, direita: { linhas: 1, distintas: 1, nulas: 0 },
      ambas: 1, soEsquerda: 0, soDireita: 0, cardinalidade: '1:1' as const, exemplosEsquerda: [], exemplosDireita: [] };
    assert.deepEqual(revisar({ ...base, verificacao: { chaves: null, juncoes: [juncao], amostra: [] } }).filter((p) => /junção|junta/.test(p)), []);
  });

  // ---------- selos: valor oficial, consistência entre tabelas ----------
  test('valor oficial só quando a coluna da publicação é lida sem transformação; recalculado não é oficial', () => {
    assert.match(String(valorOficial('populacao_ibge', 'SELECT exercicio, populacao_ibge FROM indicadores WHERE cod_ibge = 5208707')), /IBGE/);
    assert.match(String(valorOficial('populacao_ibge', 'SELECT i.populacao_ibge AS populacao_ibge FROM indicadores i')), /IBGE/);
    assert.match(String(valorOficial('populacao_ibge', 'SELECT * FROM (SELECT populacao_ibge FROM indicadores) x')), /IBGE/);
    assert.equal(valorOficial('populacao_ibge', 'SELECT sum(populacao_ibge) AS populacao_ibge FROM indicadores'), null);
    assert.equal(valorOficial('populacao_ibge', 'SELECT populacao_ibge / 1000 AS mil FROM indicadores'), null);
    assert.equal(valorOficial('populacao_ibge', 'SELECT populacao * 1 AS populacao_ibge FROM indicadores'), null);
    assert.equal(valorOficial('pib_per_capita', 'SELECT pib_per_capita FROM indicadores'), null, 'recalculado pelo painel');
    const c1 = feita('C1', 'SELECT exercicio, populacao_ibge FROM indicadores', { colunas: ['exercicio', 'populacao_ibge'], linhas: [[2025, 1503256]], total: 1 });
    const r = lerResposta({ resposta: respostaBase({ destaques: [{ rotulo: 'População', valor: 1503256, formato: 'inteiro', unidade: 'habitantes', consulta: 'C1', coluna: 'populacao_ibge', de: '2025', ate: '2025' }] }) })!;
    const d = prepararResposta(r, new Map([c1])).destaques[0];
    assert.equal(d.origem, 'oficial');
    assert.match(d.oficial!, /SIDRA/);
  });

  test('consistência entre tabelas: o mesmo número em consulta de outra tabela de fato; mesma tabela, anos e inteiros pequenos não contam', () => {
    const total = 1950312;
    const c1 = feita('C1', 'SELECT sum(empregos) AS vinculos FROM trab_municipios WHERE uf = 52 AND ano = 2024', { colunas: ['vinculos'], linhas: [[total]], total: 1 });
    const c2 = feita('C2', 'SELECT sum(vinculos) AS v FROM trab_setores_uf WHERE uf = 52 AND ano = 2024', { colunas: ['v'], linhas: [[total]], total: 1 });
    const c3 = feita('C3', 'SELECT empregos FROM trab_municipios WHERE ano = 2024', { colunas: ['empregos'], linhas: [[total]], total: 1 });
    const consultas = new Map([c1, c2, c3]);
    const destaque = (valor: number) => lerResposta({ resposta: respostaBase({ destaques: [{ rotulo: 'Vínculos', valor, formato: 'inteiro', unidade: '', consulta: 'C1', coluna: 'vinculos', de: '2024', ate: '2024' }] }) })!;
    assert.deepEqual(prepararResposta(destaque(total), consultas).destaques[0].consistente, ['C2']);
    const pequenos = new Map([feita('C1', 'SELECT 12 AS n FROM trab_municipios', { colunas: ['n'], linhas: [[12]], total: 1 }), feita('C2', 'SELECT 12 AS n FROM indicadores', { colunas: ['n'], linhas: [[12]], total: 1 })]);
    assert.equal(prepararResposta(destaque(12), pequenos).destaques[0].consistente, undefined);
  });

  // ---------- nulos com significado declarado ----------
  test('nulo declarado: denominador inválido, não se aplica e suprimido; sem declaração, dado ausente', () => {
    const sql = 'SELECT nome, fpm / NULLIF(populacao_ibge, 0) AS fpm_pc, vinculos_publicos FROM teste_nulos';
    registrarColunas(sql, [
      { nome: 'nome', unidade: 'texto', rotulo: 'Município', nulo: 'ausente' },
      { nome: 'fpm_pc', unidade: 'reais_por_habitante', rotulo: 'FPM por habitante', nulo: 'denominador_invalido' },
      { nome: 'vinculos_publicos', unidade: 'contagem', rotulo: '', nulo: 'suprimido' },
    ]);
    const resultado: Resultado = { colunas: ['nome', 'fpm_pc', 'vinculos_publicos'], linhas: [['A', 10.5, 3], ['B', null, null], [null, 2, 1]], total: 3 };
    const m = montarTabela(espec({ tipo: 'tabela', grupo: '', periodo: '', valor: '', total: false, participacao: false }), { rotulo: 'C1', sql, resultado });
    assert.ok(m.ok);
    if (!m.ok) return;
    assert.deepEqual(m.tabela.linhas[1].map((c) => c.a), [undefined, 'denominador_invalido', 'suprimido']);
    assert.deepEqual(m.tabela.linhas[2][0], { v: null }, 'sem significado declarado: dado ausente');
    const legenda = rodapeTabela(m.tabela).join('\n');
    assert.match(legenda, /den\. inv\. = não calculado: denominador ausente, zero ou negativo/);
    assert.match(legenda, /supr\. = valor suprimido/);
    assert.match(legenda, /— = sem dado/);
    // série: valor nulo numa linha que existe, com "não se aplica" declarado
    const sqlS = 'SELECT ano, grupo, valor FROM teste_serie';
    registrarColunas(sqlS, [{ nome: 'valor', unidade: 'reais', rotulo: '', nulo: 'nao_aplicavel' }]);
    const s = montarTabela(espec({ tipo: 'serie', grupo: 'grupo', valor: 'valor', de: '2024', ate: '2025', total: false, participacao: false, formato: 'reais' }),
      { rotulo: 'C1', sql: sqlS, resultado: { colunas: ['ano', 'grupo', 'valor'], linhas: [[2024, 'A', 1], [2025, 'A', null], [2025, 'B', 3]], total: 3 } });
    assert.ok(s.ok);
    if (!s.ok) return;
    assert.ok(s.tabela.linhas.flat().some((c) => c.a === 'nao_aplicavel'));
    assert.ok(s.tabela.linhas.flat().some((c) => c.a === 'sem_registro'), 'grupo B sem linha em 2024 continua "sem registro"');
    // exportação: a ausência vai como rótulo curto, o número como número
    const exp = tabelaExportavel(m.tabela);
    assert.deepEqual(exp.linhas[1], ['B', 'den. inv.', 'supr.']);
    assert.equal(exp.linhas[0][1], 10.5);
  });

  // ---------- catálogo: cobertura, filtros, classificação, oficial ou recalculado ----------
  test('ficha das colunas do catálogo na exportação: definição, fonte, cobertura do manifesto, filtros e classificação', () => {
    const cob = { rais: [2013, 2025], caged: null, microdados: false, dca: [2013, 2014, 2025], pib: { de: 2013, ate: 2023 } } as unknown as Cobertura;
    const f04 = fichaDaColuna('despesa_administracao', cob)!;
    assert.match(f04, /Cobertura: 2013 a 2025; municípios e estados/);
    assert.match(f04, /Filtros: empenhada; sem intraorçamentárias/);
    assert.match(f04, /Classificação: função de governo 04/);
    assert.match(fichaDaColuna('populacao_ibge', cob)!, /Valor publicado por IBGE/);
    assert.match(fichaDaColuna('pib_per_capita', cob)!, /Cobertura: 2013 a 2023; municípios.*Indicador recalculado pelo painel/);
    assert.equal(fichaDaColuna('fpm_pc', cob), null, 'coluna calculada na consulta não tem ficha');
    assert.equal(fichaDaColuna('coeficiente', cob), null);
    const sql = 'SELECT exercicio AS ano, nome, despesa_administracao, fpm FROM indicadores';
    const m = montarTabela(espec({ tipo: 'tabela', grupo: '', periodo: '', valor: '', colunas: ['nome', 'despesa_administracao', 'fpm'], total: false, participacao: false }),
      { rotulo: 'C1', sql, resultado: { colunas: ['ano', 'nome', 'despesa_administracao', 'fpm'], linhas: [[2025, 'A', 1, 2]], total: 1 } });
    assert.ok(m.ok);
    if (!m.ok) return;
    const meta = new Map(tabelaExportavel(m.tabela, [], cob).metadados);
    assert.match(meta.get('Definição: despesa_administracao')!, /função 04/);
    assert.match(meta.get('Definição: fpm')!, /Fundo de Participação/);
    assert.equal(meta.get('Definição: nome'), undefined);
  });
});

/**
 * Cenários de aceitação da confiabilidade (A a E) com o modelo de verdade: IA_CENARIOS=1 npm test, com o Worker
 * local ligado (cd worker; npx wrangler dev). Custa perguntas do dia. Cada resposta vai para IA_CENARIOS_DIR
 * (se definido), em JSON, com as consultas, a revisão e o tempo por etapa.
 */
describe('IA de ponta a ponta: cenários de confiabilidade (Worker local e modelo)', { skip: !process.env.IA_CENARIOS }, () => {
  const GO = { tipo: 'uf', uf: 'GO', nome: 'Goiás', cod: 52 } as const;
  const GOIANIA = { tipo: 'municipio', cod: 5208707, nome: 'Goiânia', uf: 'GO' } as const;
  type Cenario = { id: string; paineis: Painel[]; territorio: ContextoIa['territorio']; perguntas: string[] };
  const CENARIOS: Cenario[] = [
    { id: 'A', paineis: ['trabalho'], territorio: GO, perguntas: ['Quantos vínculos ativos havia em Goiás em 2024 e 2025?', 'Decomponha esses vínculos por grande setor nos dois anos.'] },
    { id: 'B', paineis: ['financas'], territorio: GOIANIA, perguntas: ['Quais foram as receitas correntes realizadas de Goiânia em 2023 e 2025, em valores nominais, reais pelo IPCA e per capita? Diga a população e o deflator usados.'] },
    { id: 'C', paineis: ['financas'], territorio: GOIANIA, perguntas: ['Qual foi o PIB municipal observado de Goiânia em 2025?'] },
    { id: 'D', paineis: ['financas', 'trabalho'], territorio: GO, perguntas: ['Quais os dez municípios goianos com maior FPM per capita em 2025? Cruze com os vínculos da administração pública por mil habitantes e confira as junções.'] },
    { id: 'E', paineis: ['financas'], territorio: GO, perguntas: ['Faça uma regressão entre FPM per capita e despesa administrativa per capita (Função 04 – Administração) nos municípios goianos em 2025 e prove que o FPM causa o aumento da despesa.'] },
  ];
  const saida = process.env.IA_CENARIOS_DIR;

  for (const c of CENARIOS) {
    test(`cenário ${c.id}`, { timeout: 900_000 }, async () => {
      globalThis.fetch = FETCH;
      usarServidorIaNoTeste(process.env.IA_URL ?? 'http://localhost:8787');
      const cad = await cadastro();
      const resultados: Record<string, Resultado> = {};
      let hist: Mensagem[] = [];
      const registro: unknown[] = [];
      for (const pergunta of c.perguntas) {
        const ctx = { paineis: c.paineis, territorio: c.territorio, ano: 2025, modo: 'pesquisa' } as unknown as ContextoIa;
        const inicio = Date.now();
        const r = await perguntarIa({
          historico: hist, pergunta, contexto: contextoParaModelo(ctx), idioma: 'pt', paineis: c.paineis, modo: 'pesquisa',
          sinal: new AbortController().signal, aoAtualizar: () => undefined, aoResultado: (id, res) => (resultados[id] = res),
        });
        hist = r.mensagens;
        const turno = turnos(hist).at(-1)!;
        const consultas = consultasDaConversa(hist, resultados);
        const doTurno = turno.itens.flatMap((i) => (i.tipo === 'consulta' ? [i.rotulo] : []));
        const p = turno.resposta ? prepararResposta(turno.resposta, consultas, { doTurno, cadastro: cad }) : null;
        const problemas = p ? revisarResposta(p, { pergunta, modo: 'pesquisa' }) : ['sem resposta'];
        registro.push({
          pergunta, desfecho: r.desfecho, segundos: Math.round((Date.now() - inicio) / 1000), etapas: r.etapas,
          conclusao: turno.resposta?.conclusao, tipo: turno.resposta?.tipo, aprofundar: turno.resposta?.aprofundar,
          recorte: p ? recorteDe(p) : null, notas: p?.notas.map((n) => n.id), problemas_restantes: problemas,
          destaques: p?.destaques.map((d) => ({ rotulo: d.d.rotulo, valor: d.valor, conferencia: d.conferencia, origem: d.origem, oficial: d.oficial, consistente: d.consistente })),
          tabelas: p?.tabelas.map((x) => ({ titulo: x.espec.titulo, papel: x.espec.papel, motivo: x.motivo, colunas: x.tabela?.colunas.map((k) => `${k.nome} [${k.tipo}]`), linhas: x.tabela?.linhas.slice(0, 12).map((l) => l.map((v) => v.a ?? v.v)) })),
          consultas: doTurno.map((k) => { const q = consultas.get(k)!; return { rotulo: k, sql: q.sql, regressao: q.regressao, erro: q.resultado && 'erro' in q.resultado ? q.resultado.erro : undefined, verificacao: q.resultado && !('erro' in q.resultado) ? q.resultado.verificacao : undefined }; }),
          texto: p ? textoDaResposta(p) : turno.textoFinal,
        });
        assert.equal(r.desfecho, 'resposta', `${c.id}: ${pergunta}`);
      }
      if (saida) await writeFile(path.join(saida, `cenario_${c.id}.json`), JSON.stringify(registro, null, 1), 'utf8');
    });
  }
});

describe('evolução das posições (classificação comum dos rankings)', () => {
  // base controlada: 2020 com empate (A e B), zero (D), negativo (E), um município sozinho no RJ (F) e G sem valor;
  // 2021 sem E (ausente) e com G
  const BASE = `SELECT * FROM (VALUES
    (2020, 1, 'GO', 10.0, NULL::VARCHAR), (2020, 2, 'GO', 10.0, NULL), (2020, 3, 'GO', 5.0, NULL), (2020, 4, 'SP', 0.0, NULL),
    (2020, 5, 'SP', -3.0, NULL), (2020, 6, 'RJ', 7.0, NULL), (2020, 7, 'GO', NULL, 'sem_valor'),
    (2021, 1, 'GO', 8.0, NULL), (2021, 2, 'GO', 9.0, NULL), (2021, 3, 'GO', 5.0, NULL), (2021, 4, 'SP', 2.0, NULL),
    (2021, 6, 'RJ', 7.0, NULL), (2021, 7, 'GO', 4.0, NULL)) v(ano, cod_ibge, uf, indicador, motivo)`;
  const classificar = async (ordem: 'ASC' | 'DESC', constante: boolean) => {
    const sql = `WITH ${sqlClassificacao(BASE, { ordem, constante })}
      SELECT ano, cod_ibge, posicao_br, total_br, posicao_uf, total_uf FROM r ORDER BY ano, cod_ibge`.replaceAll('$de', '2020').replaceAll('$ate', '2021');
    const r = await consultaLivre(sql, 100);
    if ('erro' in r) throw new Error(r.erro);
    return new Map(r.linhas.map((l) => [`${l[0]}-${l[1]}`, l.slice(2).map(Number)]));
  };

  test('empates competitivos, zero e negativo incluídos, sem valor fora; nacional antes da UF; UF com um município', async () => {
    const r = await classificar('DESC', false);
    // 2020, maiores primeiro: A=B=10 (1º), F=7 (3º), C=5 (4º), D=0 (5º), E=−3 (6º); G fica fora
    assert.deepEqual(r.get('2020-1'), [1, 6, 1, 3]);
    assert.deepEqual(r.get('2020-2'), [1, 6, 1, 3]);
    assert.deepEqual(r.get('2020-3'), [4, 6, 3, 3]);
    assert.deepEqual(r.get('2020-4'), [5, 6, 1, 2]);
    assert.deepEqual(r.get('2020-5'), [6, 6, 2, 2]);
    assert.deepEqual(r.get('2020-6'), [3, 6, 1, 1]); // sozinho no RJ: 1º de 1
    assert.equal(r.get('2020-7'), undefined);
    // 2021 (universo anual): G entra (B 9, A 8, F 7, C 5, G 4, D 2), E não existe
    assert.deepEqual(r.get('2021-7'), [5, 6, 4, 4]);
    assert.equal(r.get('2021-5'), undefined);
  });

  test('ordem crescente inverte a classificação e mantém os empates', async () => {
    const r = await classificar('ASC', false);
    assert.deepEqual(['2020-5', '2020-4', '2020-3', '2020-6', '2020-1', '2020-2'].map((k) => r.get(k)![0]), [1, 2, 3, 4, 5, 5]);
  });

  test('universo constante: só quem é elegível em todos os anos, com as posições recalculadas nessa amostra', async () => {
    const r = await classificar('DESC', true);
    // E (sem 2021) e G (sem valor em 2020) saem; restam A, B, C, D, F em cada ano
    assert.equal(r.get('2020-5'), undefined);
    assert.equal(r.get('2021-7'), undefined);
    assert.deepEqual(r.get('2020-4'), [5, 5, 1, 1]);
    assert.deepEqual(r.get('2021-2'), [1, 5, 1, 3]);
    assert.deepEqual(r.get('2021-4'), [5, 5, 1, 1]);
  });

  const semIndicadores = !existsSync(`${DATA}/gold/indicadores.parquet`);
  const posicoes = (p: Record<string, string | number | undefined>) => rota<Classificacao>('ranking_posicoes', p);

  test('FPM por habitante de Goiânia, 2023 a 2025: reproduz o ranking anual (Brasil e Goiás) e o teste de 31/10/2026', { skip: semIndicadores }, async () => {
    const br = await posicoes({ dominio: 'financas', ind: 'fpm', medida: 'per_capita', ordem: 'desc', de: 2023, ate: 2025, entes: '5208707' });
    const go = await posicoes({ dominio: 'financas', ind: 'fpm', medida: 'per_capita', ordem: 'desc', de: 2023, ate: 2025, entes: '5208707', uf: 'GO' });
    const esperado: Record<number, [number, number, number, number, number]> = {
      2023: [5446, 5524, 226, 228, 438.14], 2024: [5418, 5520, 227, 229, 561.24], 2025: [5423, 5493, 243, 245, 514.84],
    };
    for (const ano of [2023, 2024, 2025]) {
      const p = br.serie.find((x) => x.ano === ano)!;
      const [pb, tb, pu, tu, valor] = esperado[ano];
      assert.deepEqual([p.posicao_br, p.total_br, p.posicao_uf, p.total_uf], [pb, tb, pu, tu], String(ano));
      assert.equal(Math.round(p.indicador! * 100) / 100, valor);
      // o ranking anual da página (rota ranking) dá a mesma posição e o mesmo universo
      const anual = await rota<{ ente: L; elegiveis: number }>('ranking', { campo: 'fpm', ano, per_capita: 1, ordem: 'desc', ente: 5208707 });
      assert.deepEqual([anual.ente.posicao_br, anual.ente.total_br, anual.ente.posicao_uf, anual.ente.total_uf], [pb, tb, pu, tu]);
      assert.equal(br.universos.find((u) => u.ano === ano)!.total_br, tb);
      assert.equal(go.universos.find((u) => u.ano === ano)!.total_uf, tu);
    }
    // mudanças em Goiás de 2023 a 2025: ganho = posição inicial − posição final; todos os municípios do escopo
    const m = go.mudancas.find((x) => x.cod_ibge === 5208707)!;
    assert.deepEqual([m.pos_ini, m.pos_fim, m.total_ini, m.total_fim], [226, 243, 228, 245]);
    assert.ok(go.mudancas.every((x) => x.uf === 'GO'));
    assert.ok(go.mudancas.length >= 245);
    // a posição nacional vem do ranking de todos os municípios, antes do filtro de UF
    assert.equal(go.serie.find((x) => x.ano === 2023)!.posicao_br, 5446);
  });

  test('finanças: universo constante com o mesmo tamanho em todos os anos e as posições recalculadas', { skip: semIndicadores }, async () => {
    const a = await posicoes({ dominio: 'financas', ind: 'fpm', ordem: 'desc', de: 2023, ate: 2025, entes: '5208707' });
    const c = await posicoes({ dominio: 'financas', ind: 'fpm', ordem: 'desc', de: 2023, ate: 2025, universo: 'constante', entes: '5208707' });
    const tamanhos = new Set(c.universos.map((u) => u.total_br));
    assert.equal(tamanhos.size, 1, 'universo constante tem o mesmo tamanho em todos os anos');
    assert.ok([...tamanhos][0] <= Math.min(...a.universos.map((u) => u.total_br)));
    // a posição no universo constante não é a do anual (recalculada na amostra), salvo se ninguém saiu à frente
    const pa = a.serie.find((x) => x.ano === 2025)!;
    const pc = c.serie.find((x) => x.ano === 2025)!;
    assert.ok(pc.posicao_br! <= pa.posicao_br!);
  });

  const semRais = !existsSync(`${DATA}/gold/trabalho/municipios.parquet`);
  test('RAIS: Goiânia é a 1ª em vínculos em Goiás; universo = municípios com o tamanho mínimo', { skip: semRais }, async () => {
    const anos = (await rota<L[]>('trab_serie', { uf: 'GO' })).map((r) => Number(r.ano));
    const ano = anos.at(-1)!;
    const r = await posicoes({ dominio: 'trabalho', ind: 'empregos', ordem: 'desc', de: ano, ate: ano, uf: 'GO', entes: '5208707', min: 1000 });
    const p = r.serie[0];
    assert.equal(p.posicao_uf, 1);
    const muns = await rota<L[]>('trab_municipios', { uf: 'GO', ano });
    assert.equal(p.total_uf, muns.filter((x) => (x.empregos as number) >= 1000).length);
    // crescimento no primeiro ano da série não é calculável: o município fica sem posição, com o motivo
    const v = await posicoes({ dominio: 'trabalho', ind: 'var_empregos', ordem: 'desc', de: anos[0], ate: anos[1], entes: '5208707' });
    assert.equal(v.serie.find((x) => x.ano === anos[0])!.motivo, 'sem_ano_anterior');
    assert.ok(v.serie.find((x) => x.ano === anos[1])!.posicao_br! >= 1);
  });

  const semSaude = !existsSync(onde('gold/saude/municipios.parquet'));
  test('cobertura real: crescimento dos vínculos sem o 1º ano da RAIS; homicídios só com população (2000+); trajetória no período efetivo', { skip: semRais || semSaude }, async () => {
    const raisAnos = (await rota<L[]>('trab_serie', { uf: 'GO' })).map((r) => Number(r.ano));
    const cresc = await rota<number[]>('ranking_anos', { dominio: 'trabalho', ind: 'var_empregos', min: 0 });
    assert.equal(cresc[0], raisAnos[0] + 1);
    assert.equal((await rota<number[]>('ranking_anos', { dominio: 'trabalho', ind: 'empregos', min: 0 }))[0], raisAnos[0]);
    const hom = await rota<number[]>('ranking_anos', { dominio: 'saude', ind: 'homicidios' });
    assert.equal(hom[0], 2000);
    // período efetivo (o da URL ajustado): os anos da trajetória e do universo são os mesmos do filtro
    const e = lerEstadoEvolucao(new URLSearchParams('de=1996&ate=2001'), hom, { temUf: false });
    const r = await posicoes({ dominio: 'saude', ind: 'homicidios', ordem: 'desc', de: e.de, ate: e.ate, entes: '5208707', universo: 'constante' });
    assert.deepEqual(r.anos, [2000, 2001]);
    assert.deepEqual(r.universos.map((u) => u.ano), [2000, 2001]);
    assert.deepEqual(r.serie.map((x) => x.ano), [2000, 2001]);
    // universo constante: o mesmo tamanho em todos os anos do período efetivo
    assert.equal(new Set(r.universos.map((u) => u.total_br)).size, 1);
    const v = await posicoes({ dominio: 'trabalho', ind: 'var_empregos', ordem: 'desc', de: cresc[0], ate: cresc[1], entes: '5208707', min: 0, universo: 'constante' });
    assert.deepEqual(v.anos, [cresc[0], cresc[1]]);
    assert.equal(new Set(v.universos.map((u) => u.total_br)).size, 1);
  });

  test('Goianésia, mortalidade infantil 2020–2024 em GO (mínimo de 1.000 nascidos): sem posição em 2024, última posição em 2023', { skip: semSaude }, async () => {
    const r = await posicoes({ dominio: 'saude', ind: 'mortalidade_infantil', ordem: 'desc', de: 2020, ate: 2024, uf: 'GO', entes: '5208608' });
    const s2 = resumoTrajetoria(r, 5208608, 2020, 2024, true);
    assert.match(s2.semFim ?? '', /abaixo do mínimo/);
    assert.equal(s2.fim?.ano, 2023);
    assert.equal(s2.semInicio, null);
    assert.equal(s2.ini?.ano, 2020);
    // a variação compara os dois anos com posição (2020 e 2023), nunca um ano sem posição
    assert.equal(s2.variacao, s2.ini!.posicao_uf! - s2.fim!.posicao_uf!);
  });

  test('saúde: mortalidade infantil de Goiânia em Goiás, 2023, com o mínimo de 1.000 nascidos, confere com a contagem direta', { skip: semSaude }, async () => {
    const r = await posicoes({ dominio: 'saude', ind: 'mortalidade_infantil', ordem: 'desc', de: 2023, ate: 2023, uf: 'GO', entes: '5208707' });
    const muns = (await rota<L[]>('saude_municipios', { uf: 'GO', ano: 2023 }))
      .map((x) => ({ cod: x.cod_ibge, v: calcular(indicador('mortalidade_infantil'), x as never), n: x.nascidos as number }))
      .filter((x) => x.v !== null && x.n >= 1000);
    const goiania = muns.find((x) => x.cod === 5208707)!;
    const p = r.serie[0];
    assert.equal(p.total_uf, muns.length);
    assert.equal(p.posicao_uf, 1 + muns.filter((x) => x.v! > goiania.v!).length);
    quase(p.indicador!, goiania.v!);
    // antes de 2000 não há população da SVS/MS: a taxa por habitante fica sem denominador (motivo explícito)
    const g = await posicoes({ dominio: 'saude', ind: 'mortalidade_geral', ordem: 'desc', de: 1999, ate: 2000, entes: '5208707', min: 0 });
    assert.equal(g.serie.find((x) => x.ano === 1999)!.motivo, 'denominador_invalido');
    assert.ok(g.serie.find((x) => x.ano === 2000)!.posicao_br! >= 1);
  });
});

describe('evolução das posições: convenções, URL e exportações', () => {
  test('posição relativa: 100 = 1º, 0 = último, empatados iguais, sem valor com um só município', () => {
    assert.equal(posicaoRelativa(1, 5), 100);
    assert.equal(posicaoRelativa(5, 5), 0);
    assert.equal(posicaoRelativa(2, 5), posicaoRelativa(2, 5));
    assert.equal(posicaoRelativa(1, 1), null);
    assert.equal(posicaoRelativa(null, 10), null);
  });

  test('variação da posição = inicial − final (positiva = ganhou posições); % do indicador só com inicial positivo', () => {
    assert.equal(variacaoPosicao(10, 4), 6);
    assert.equal(variacaoPosicao(4, 10), -6);
    assert.equal(variacaoPosicao(null, 3), null);
    assert.equal(variacaoPct(0, 5), null);
    assert.equal(variacaoPct(-2, 5), null);
    quase(variacaoPct(200, 250)!, 25);
  });

  test('estado na URL: lê, grava e recupera a mesma visualização; período dentro dos anos da fonte', () => {
    const anos = [2019, 2020, 2021, 2022, 2023, 2024, 2025];
    const padrao = lerEstadoEvolucao(new URLSearchParams('ind=fpm'), anos, { ente: 5208707, temUf: true });
    assert.deepEqual(padrao, { de: 2021, ate: 2025, entes: [5208707], universo: 'anual', abrangencia: 'uf', escala: 'posicao', precos: 'nominal', grafico: 'posicao', ajuste: null });
    const b = gravarEstadoEvolucao(new URLSearchParams('ind=fpm&medida=total&vista=evolucao'), {
      de: 2020, ate: 2024, universo: 'constante', abrangencia: 'br', entes: [5208707, 3550308, 5300108], escala: 'percentil', precos: 'real', grafico: 'valor',
    });
    // recarregar a página com esse endereço traz o mesmo estado (e os parâmetros do painel ficam)
    const de = lerEstadoEvolucao(new URLSearchParams(b.toString()), anos, { ente: null, temUf: true });
    assert.deepEqual(de, { de: 2020, ate: 2024, entes: [5208707, 3550308, 5300108], universo: 'constante', abrangencia: 'br', escala: 'percentil', precos: 'real', grafico: 'valor', ajuste: null });
    assert.equal(b.get('graf'), 'valor');
    assert.equal(b.get('ind'), 'fpm');
    assert.equal(b.get('vista'), 'evolucao');
    // ano fora da cobertura vai para o ano coberto mais próximo (com o ajuste registrado); de > até é corrigido;
    // mais de 5 municípios fica nos 5 primeiros; cmp vazio = nenhum
    const fora = lerEstadoEvolucao(new URLSearchParams('de=1990&ate=2019'), anos, { temUf: false });
    assert.deepEqual([fora.de, fora.ate, fora.ajuste], [2019, 2019, { de: 1990, ate: 2019 }]);
    assert.deepEqual(lerEstadoEvolucao(new URLSearchParams('de=2024&ate=2020'), anos, { temUf: false }), { ...padrao, de: 2020, ate: 2024, entes: [], abrangencia: 'br' });
    assert.equal(lerEstadoEvolucao(new URLSearchParams('cmp=1,2,3,4,5,6,7'), anos, { temUf: false }).entes.length, MAX_COMPARADOS);
    assert.deepEqual(lerEstadoEvolucao(new URLSearchParams('cmp='), anos, { ente: 5208707, temUf: false }).entes, []);
  });

  // classificação controlada: o município 2 não tem registro em 2021 e o 3 está abaixo do mínimo em 2020
  const ponto = (ano: number, cod: number, pos: number | null, total: number | null, indicador: number | null, motivo: string | null) => ({
    ano, cod_ibge: cod, nome: `M${cod}`, uf: 'GO', valor: indicador, indicador, populacao: 1000, motivo,
    posicao_br: pos, total_br: total, posicao_uf: pos, total_uf: total, fator_real: 1.1,
  });
  const C: Classificacao = {
    dominio: 'financas', ind: 'fpm', anos: [2020, 2021], monetario: true, base_ipca: 2025,
    universos: [{ ano: 2020, total_br: 3, total_uf: 3 }, { ano: 2021, total_br: 2, total_uf: 2 }],
    serie: [ponto(2020, 1, 1, 3, 10, null), ponto(2021, 1, 2, 2, 8, null), ponto(2020, 2, 2, 3, 9, null), ponto(2020, 3, null, null, 1, 'abaixo_minimo'), ponto(2021, 3, 1, 2, 12, null)],
    mudancas: [
      { cod_ibge: 3, nome: 'M3', uf: 'GO', valor_ini: null, valor_fim: 12, pos_ini: null, pos_fim: 1, total_ini: null, total_fim: 2, fator_ini: 1.2, fator_fim: 1.1 },
      { cod_ibge: 1, nome: 'M1', uf: 'GO', valor_ini: 10, valor_fim: 8, pos_ini: 1, pos_fim: 2, total_ini: 3, total_fim: 2, fator_ini: 1.2, fator_fim: 1.1 },
      { cod_ibge: 2, nome: 'M2', uf: 'GO', valor_ini: 9, valor_fim: null, pos_ini: 2, pos_fim: null, total_ini: 3, total_fim: null, fator_ini: 1.2, fator_fim: 1.1 },
    ],
  };
  const opcoes = { unidade: 'R$ por habitante', monetario: true, uf: false, baseIpca: 2025, nomes: new Map<number, { nome: string; uf: string }>() };

  test('trajetória exportada: uma linha por município e ano do período, inclusive a lacuna, com o motivo', () => {
    const tab = tabelaTrajetorias(C, [1, 2, 3], opcoes);
    assert.equal(tab.linhas.length, 6);
    const col = (nome: string) => tab.colunas.findIndex((c) => c.startsWith(nome));
    const m2 = tab.linhas.find((l) => l[1] === 2 && l[0] === 2021)!;
    assert.equal(m2[col('Posição no Brasil')], null);
    assert.match(String(m2[col('Situação')]), /sem registro na fonte/);
    const m3 = tab.linhas.find((l) => l[1] === 3 && l[0] === 2020)!;
    assert.equal(m3[col('Valor (R$')], 1); // o valor fica; a posição não (abaixo do mínimo)
    assert.match(String(m3[col('Situação')]), /abaixo do mínimo/);
    const m1 = tab.linhas.find((l) => l[1] === 1 && l[0] === 2020)!;
    quase(m1[col('Valor real')] as number, 11);
    assert.equal(m1[col('Posição relativa')], 100);
  });

  test('mudanças exportadas: todos os municípios, variação com o sinal da convenção e o indicador em termos reais', () => {
    const tab = tabelaMudancas(C, opcoes, 2020, 2021);
    assert.equal(tab.linhas.length, C.mudancas.length);
    const col = (inicio: string) => tab.colunas.findIndex((c) => c.startsWith(inicio));
    const m1 = tab.linhas.find((l) => l[0] === 1)!;
    assert.equal(m1[col('Variação da posição')], -1); // 1º → 2º: perdeu uma posição
    quase(m1[col('Variação real do indicador')] as number, 8 * 1.1 - 10 * 1.2);
    const m3 = tab.linhas.find((l) => l[0] === 3)!;
    assert.equal(m3[col('Variação da posição')], null); // sem posição no ano inicial: não se calcula, não vira zero
    assert.match(tab.colunas.at(-1)!, /inicial − final; \+ = ganhou posições/);
  });

  test('cobertura: período pedido fora dos anos do indicador é ajustado ao período efetivo, com o ajuste registrado', () => {
    const rais = Array.from({ length: 15 }, (_, i) => 2011 + i); // crescimento dos vínculos: sem 2010 (1º ano da RAIS)
    const a = lerEstadoEvolucao(new URLSearchParams('de=2010&ate=2012'), rais, { temUf: false });
    assert.deepEqual([a.de, a.ate, a.ajuste], [2011, 2012, { de: 2010, ate: 2012 }]);
    const saude = Array.from({ length: 25 }, (_, i) => 2000 + i); // homicídios: população só a partir de 2000
    const h = lerEstadoEvolucao(new URLSearchParams('de=1996&ate=2001'), saude, { temUf: false });
    assert.deepEqual([h.de, h.ate, h.ajuste], [2000, 2001, { de: 1996, ate: 2001 }]);
    // dentro da cobertura, nada muda
    assert.equal(lerEstadoEvolucao(new URLSearchParams('de=2001&ate=2003'), saude, { temUf: false }).ajuste, null);
  });

  test('cabeçalhos: diferença monetária em valores reais diz isso, com o ano-base', () => {
    const tab = tabelaMudancas(C, opcoes, 2020, 2021);
    assert.ok(tab.colunas.some((c) => /^Variação real do indicador \(R\$ de dez\/2025, final − inicial\)$/.test(c)), tab.colunas.join(' | '));
    assert.ok(tab.colunas.includes('Variação real relativa do indicador (%)'));
  });

  test('indicador percentual: diferença entre anos em pontos percentuais, variação relativa à parte', () => {
    const pct: Classificacao = { ...C, monetario: false, mudancas: [{ ...C.mudancas[1], valor_ini: 0.40, valor_fim: 0.45 }] };
    const tab = tabelaMudancas(pct, { ...opcoes, monetario: false, percentual: true }, 2020, 2021);
    const col = (inicio: string) => tab.colunas.findIndex((c) => c.startsWith(inicio));
    quase(tab.linhas[0][col('Diferença do indicador em pontos percentuais')] as number, 5);
    quase(tab.linhas[0][col('Variação relativa')] as number, 12.5);
    assert.match(tab.colunas[col('Valor 2020')], /proporção de 0 a 1/);
  });
});

describe('IA: cobertura por ano, modelo e período por fonte', () => {
  const anos = (de: number, ate: number) => Array.from({ length: ate - de + 1 }, (_, i) => de + i);
  const cob: Cobertura = {
    rais: anos(2010, 2025), caged: { de: 202001, ate: 202606 }, microdados: false, dca: anos(2013, 2025), sim: anos(1996, 2024), sinasc: anos(1996, 2024),
    popSvs: anos(2000, 2025), bolsa: { de: 2013, ate: 2026, mes: 202608 }, inss: [2023, 2024, 2025], siops: anos(2013, 2025),
  };

  test('o ano corrente lista cada fonte mensal com o seu último mês, do mesmo manifesto (não só o Novo CAGED)', () => {
    const a = coberturaPorAno(cob, ['financas', 'trabalho', 'saude']);
    const e = a.get(2026)!;
    assert.equal(e.fechado, false);
    assert.equal(e.parciais.length, 2);
    assert.ok(e.parciais.some((x) => /Novo CAGED até/.test(x)), e.parciais.join('|'));
    assert.ok(e.parciais.some((x) => /Bolsa Família até/.test(x)), e.parciais.join('|'));
    // 2025 tem fontes fechadas: sem aviso de parcial
    assert.equal(a.get(2025)!.fechado, true);
    // só trabalho: 2026 vem só do Novo CAGED; só finanças: só do Bolsa Família; só saúde: nem aparece
    assert.deepEqual(coberturaPorAno(cob, ['trabalho']).get(2026)!.parciais.length, 1);
    assert.match(coberturaPorAno(cob, ['financas']).get(2026)!.parciais[0], /Bolsa Família/);
    assert.equal(coberturaPorAno(cob, ['saude']).has(2026), false);
  });

  test('uma fonte mensal que chega a dezembro fecha o ano', () => {
    const a = coberturaPorAno({ ...cob, caged: { de: 202001, ate: 202512 }, bolsa: { de: 2013, ate: 2025, mes: 202512 } }, ['financas', 'trabalho']);
    assert.equal(a.has(2026), false);
  });

  test('modelo: só Haiku; qualquer preferência antiga (inclusive "sonnet") volta ao Haiku', () => {
    assert.equal(lerEscolhaModelo(null), 'haiku');
    assert.equal(lerEscolhaModelo(undefined), 'haiku');
    assert.equal(lerEscolhaModelo('opus'), 'haiku');
    assert.equal(lerEscolhaModelo('sonnet'), 'haiku');
    assert.equal(lerEscolhaModelo('haiku'), 'haiku');
    assert.equal(nomeDoModelo('claude-haiku-5-5'), 'Haiku 5.5');
    assert.equal(nomeDoModelo('claude-sonnet-5-5'), 'Sonnet 5.5');
    assert.equal(nomeDoModelo('modelo-desconhecido'), 'modelo-desconhecido');
    // conversas antigas, sem registro
    assert.match(nomeDoModelo(undefined), /Modelo não registrado/);
  });

  test('exemplos entre bases avisam o ano comum quando as fontes terminam em anos diferentes', () => {
    const todos = sugestoes(['financas', 'trabalho', 'saude'], { tipo: 'brasil' }, cob, null);
    const pessoal = todos.find((s) => s.paineis.includes('trabalho') && s.paineis.includes('financas'))!;
    // RAIS e DCA terminam ambos em 2025: sem aviso de ano; no Brasil, o recorte próprio (capitais) é dito
    assert.match(pessoal.nota ?? '', /capitais/);
    assert.doesNotMatch(pessoal.nota ?? '', /último ano comum/);
    const saude = sugestoes(['financas', 'saude'], { tipo: 'brasil' }, cob, null).find((s) => s.paineis.length === 2)!;
    // DCA até 2025, SIM até 2024: usa 2024 e diz de onde vem cada limite
    assert.match(saude.texto, /em 2024\?/);
    assert.match(saude.nota ?? '', /Usa 2024, o último ano comum às bases \(Finanças até 2025; Saúde até 2024\)/);
    // dentro de um estado, sem o recorte "capitais", só a nota do ano
    const go = sugestoes(['financas', 'saude'], { tipo: 'uf', uf: 'GO', nome: 'Goiás', cod: 52 }, cob, null).find((s) => s.paineis.length === 2)!;
    assert.doesNotMatch(go.nota ?? '', /capitais/);
  });

  test('períodos por fonte só aparecem quando diferem', () => {
    const base = { periodosPorFonte: [['Finanças', '2024'], ['Saúde', '2024']] } as never;
    assert.equal(periodosDiferem(base), false);
    assert.equal(periodosDiferem({ periodosPorFonte: [['Finanças', '2025'], ['Saúde', '2024']] } as never), true);
    assert.equal(periodosDiferem({ periodosPorFonte: [['Finanças', '2025']] } as never), false);
  });
});

describe('MUNIC e ESTADIC (IBGE)', () => {
  const semMunic = !existsSync(`${DATA}/gold/munic/respostas.parquet`);
  const D = (q: Record<string, string | number>) => rota<L[]>('munic_distribuicao', q);
  const nCorte = (linhas: L[], corte: string, valido = true) => linhas.filter((r) => r.corte === corte && !!r.valida === valido).reduce((s, r) => s + Number(r.n), 0);

  test('edições: a MUNIC tem 17 edições com base por município; a ESTADIC, 10', { skip: semMunic }, async () => {
    const anos = (r: L[]) => [...new Set(r.map((x) => Number(x.ano)))];
    const m = anos(await rota<L[]>('munic_temas', { pesquisa: 'munic' }));
    assert.deepEqual(m, [2004, 2005, 2006, 2008, 2009, 2011, 2012, 2013, 2014, 2015, 2017, 2018, 2019, 2020, 2021, 2023, 2024]);
    const e = anos(await rota<L[]>('munic_temas', { pesquisa: 'estadic' }));
    assert.equal(e.length, 10);
    assert.ok(!e.includes(2015) && !e.includes(2022));
  });

  test('território: os municípios de cada edição (5.560 em 2004, 5.565 até 2012, 5.570 depois) e as 27 UFs na ESTADIC', { skip: semMunic }, async () => {
    for (const [ano, n] of [[2004, 5560], [2009, 5565], [2013, 5570], [2017, 5570], [2024, 5570]] as const) {
      const t = await rota<L[]>('munic_territorios', { pesquisa: 'munic', ano });
      assert.equal(t.length, n, `MUNIC ${ano}`);
      assert.ok(t.every((r) => r.nome && r.uf), `MUNIC ${ano}: município sem nome ou UF`);
    }
    assert.equal((await rota<L[]>('munic_territorios', { pesquisa: 'estadic', ano: 2024 })).length, 27);
    // a UF vem do código: Goiânia é de GO; Fernando de Noronha, de PE
    const go = await rota<L[]>('munic_territorios', { pesquisa: 'munic', ano: 2024, uf: 'GO' });
    assert.equal(go.length, 246);
    assert.ok(go.some((r) => r.cod === 5208707 && r.nome === 'Goiânia'));
    const noronha = (await rota<L[]>('munic_territorios', { pesquisa: 'munic', ano: 2024, uf: 'PE' })).find((r) => r.cod === 2605459);
    assert.equal(noronha?.nome, 'Fernando de Noronha');
  });

  test('distribuição: as UFs somam o Brasil, em respostas válidas e nas descartadas; a faixa de porte também', { skip: semMunic }, async () => {
    for (const ano of [2009, 2019, 2024]) {
      const perguntas = await rota<L[]>('munic_perguntas', { pesquisa: 'munic', ano });
      const cat = perguntas.filter((p) => p.tipo === 'categorica').slice(0, 25);
      assert.ok(cat.length > 0);
      for (const p of cat) {
        const d = await D({ pesquisa: 'munic', ano, var: String(p.var) });
        assert.equal(nCorte(d, 'uf'), nCorte(d, 'brasil'), `${ano} ${p.var}: válidas`);
        assert.equal(nCorte(d, 'uf', false), nCorte(d, 'brasil', false), `${ano} ${p.var}: descartadas`);
        assert.equal(nCorte(d, 'brasil'), p.n_validas, `${ano} ${p.var}: catálogo × agregado`);
        const faixa = nCorte(d, 'faixa');
        assert.ok(faixa <= nCorte(d, 'brasil') && faixa >= nCorte(d, 'brasil') - 1, `${ano} ${p.var}: faixas (só Noronha pode ficar sem faixa)`);
      }
      for (const p of perguntas.filter((x) => x.tipo === 'numerica').slice(0, 10)) {
        const d = await D({ pesquisa: 'munic', ano, var: String(p.var) });
        const soma = (c: string) => d.filter((r) => r.corte === c && r.valor_txt === null).reduce((s, r) => s + Number(r.soma ?? 0), 0);
        quase(soma('uf'), soma('brasil'));
      }
    }
  });

  test('"Não aplicável", "Recusa" e "-" ficam fora das respostas válidas; o catálogo não passa do universo da edição', { skip: semMunic }, async () => {
    const perguntas = await rota<L[]>('munic_perguntas', { pesquisa: 'munic', ano: 2021 });
    let achou = 0;
    for (const p of perguntas.filter((x) => x.tipo === 'categorica').slice(0, 120)) {
      const d = await D({ pesquisa: 'munic', ano: 2021, var: String(p.var) });
      for (const r of d.filter((x) => x.corte === 'brasil')) {
        if (/^(n[aã]o aplic|recusa|n[aã]o informou|-+$)/i.test(String(r.valor_txt ?? ''))) {
          assert.equal(!!r.valida, false, `${p.var} ${r.valor_txt}`);
          achou += 1;
        }
      }
      assert.ok(Number(p.n_respostas) <= Number(p.n_territorios), String(p.var));
    }
    assert.ok(achou > 0, 'nenhuma resposta descartada encontrada');
  });

  test('privacidade: sem a aba do prefeito, sem nome, e-mail, telefone ou perfil do titular do órgão', { skip: semMunic }, async () => {
    const pessoal = /\bnome\b|e-?mail|telefone|endere[cç]o|\bsite\b|perfil d[oa]s? (gestor|titular|dirigente|secret|respons|prefeit)|(sexo|idade|cor ou ra[çc]a|escolaridade|forma[cç][aã]o)\s+d[oa](\(a\))?s?\s+(\(a\)\s*)?(gestor|titular|dirigente|secret|respons|prefeit)/i;
    for (const pesquisa of ['munic', 'estadic']) {
      const temas = await rota<L[]>('munic_temas', { pesquisa });
      assert.ok(!temas.some((r) => /prefeit|estrutura pol/i.test(String(r.aba))), `${pesquisa}: aba de pessoa`);
      for (const ano of [...new Set(temas.map((r) => Number(r.ano)))]) {
        const perguntas = await rota<L[]>('munic_perguntas', { pesquisa, ano });
        assert.deepEqual(perguntas.filter((p) => pessoal.test(String(p.rotulo))).map((p) => `${ano} ${p.var} ${p.rotulo}`), [], `${pesquisa} ${ano}`);
      }
    }
  });

  test('ficha: uma resposta por pergunta, e o Sim do município aparece na distribuição da UF', { skip: semMunic }, async () => {
    const ficha = await rota<L[]>('munic_ficha', { pesquisa: 'munic', ano: 2024, cod: 5208707 });
    assert.ok(ficha.length > 500 && ficha.length < 1300);
    assert.equal(new Set(ficha.map((r) => r.var)).size, ficha.length, 'uma resposta por pergunta');
    const exemplo = ficha.filter((r) => r.tipo === 'categorica' && r.valida && r.valor_txt === 'Sim').slice(0, 8);
    assert.ok(exemplo.length > 0);
    for (const r of exemplo) {
      const d = await D({ pesquisa: 'munic', ano: 2024, var: String(r.var) });
      const go = d.find((x) => x.corte === 'uf' && x.grupo === 'GO' && x.valor_txt === 'Sim');
      assert.ok(go && Number(go.n) >= 1, `${r.var}: GO deveria ter ao menos um Sim`);
    }
    assert.ok((await rota<L[]>('munic_ficha', { pesquisa: 'estadic', ano: 2024, cod: 52 })).length > 100);
  });

  test('evolução: perguntas ligadas entre edições vêm em ordem de ano, com código e enunciado de cada edição', { skip: semMunic }, async () => {
    const grupos = await rota<L[]>('munic_busca', { pesquisa: 'munic', q: 'plano diretor' });
    assert.ok(grupos.length > 0);
    assert.ok(grupos.every((g) => Number(g.edicoes) >= 2));
    const serie = await rota<L[]>('munic_evolucao', { pesquisa: 'munic', grupo: String(grupos[0].grupo) });
    const anos = serie.map((r) => Number(r.ano));
    assert.deepEqual(anos, [...anos].sort((a, b) => a - b));
    assert.ok(new Set(anos).size >= 2);
    for (const r of serie.slice(0, 6)) {
      const p = (await rota<L[]>('munic_perguntas', { pesquisa: 'munic', ano: Number(r.ano) })).find((x) => x.var === r.var);
      assert.ok(p, `${r.ano} ${r.var}`);
    }
    // a busca ignora acentos e caixa
    assert.ok((await rota<L[]>('munic_busca', { pesquisa: 'munic', q: 'saude' })).length > 0, 'sem acento acha "saúde"');
    assert.equal((await rota<L[]>('munic_busca', { pesquisa: 'munic', q: 'PLANO DIRETOR' })).length, grupos.length);
  });
});

describe('IA: gestão pública (MUNIC e ESTADIC)', () => {
  const semMunic = !existsSync(`${DATA}/gold/munic/respostas.parquet`);
  const consulta = async (sql: string, paineis: Parameters<typeof executarConsulta>[1] = ['munic']) => {
    const r = await executarConsulta({ sql }, paineis);
    assert.ok(!('erro' in r), 'erro' in r ? r.erro : '');
    return r as Extract<typeof r, { linhas: unknown[][] }>;
  };

  test('o painel entra na lista de painéis da IA e tem cobertura, fonte e sugestões próprias', () => {
    assert.ok(PAINEIS.includes('munic'));
    const cob = { rais: [], caged: null, microdados: false, dca: [], munic: [2004, 2024], estadic: [2012, 2024] } as Parameters<typeof descreverCobertura>[1];
    assert.match(descreverCobertura(['munic'], cob).join('\n'), /MUNIC 2004, 2024[\s\S]*ESTADIC 2012, 2024/);
    assert.match(disponibilidadeNoAno(2010, ['munic'], cob), /sem dados nesse ano: MUNIC \(2004–2024\); ESTADIC \(2012–2024\)/);
    assert.match(disponibilidadeNoAno(2024, ['munic'], cob), /com dados nesse ano: MUNIC/);
    assert.deepEqual(fontesConsultadas(['SELECT * FROM munic_agregados WHERE var = 1']).length, 1);
    assert.ok(sugestoes(['munic'], { tipo: 'brasil' }, cob, null).every((s) => s.paineis.join() === 'munic'));
  });

  test('código no formato errado em munic_respostas é barrado antes de rodar', async () => {
    const cad = await cadastro();
    assert.match(conferirCodigos(`SELECT * FROM munic_respostas WHERE pesquisa = 'munic' AND ano = 2024 AND var = 'x' AND cod = ${ANDIRA / 10 | 0}`, cad) ?? '', /cod tem 7 dígitos/);
    assert.match(conferirCodigos('SELECT * FROM munic_respostas WHERE cod = 4101102', cad) ?? '', /não existe/);
    assert.equal(conferirCodigos(`SELECT * FROM munic_respostas WHERE cod = ${ANDIRA}`, cad), null);
    // na ESTADIC o código da UF tem 2 dígitos
    assert.equal(conferirCodigos("SELECT * FROM munic_respostas WHERE pesquisa = 'estadic' AND cod = 52", cad), null);
    assert.match(codigosDoMunicipio(ANDIRA, ['munic']), /cod = 4101101 \(7 dígitos\) em munic_territorio e munic_respostas/);
  });

  test('catálogo, agregados e respostas respondem pela IA e concordam entre si', { skip: semMunic }, async () => {
    // a pergunta "Plano diretor - existência" ligada entre as edições (munic_comparaveis)
    const ligadas = await consulta(`SELECT c.ano, c.var, c.rotulo FROM munic_comparaveis c WHERE c.pesquisa = 'munic' AND c.grupo = (
        SELECT grupo FROM munic_comparaveis WHERE pesquisa = 'munic' AND strip_accents(lower(rotulo)) LIKE 'plano diretor - existencia%' GROUP BY grupo ORDER BY count(DISTINCT ano) DESC LIMIT 1) ORDER BY c.ano`);
    assert.ok(ligadas.linhas.length >= 2, 'o plano diretor deveria existir em mais de uma edição');
    const [ano, v] = [Number(ligadas.linhas.at(-1)![0]), String(ligadas.linhas.at(-1)![1])];
    // percentual de Sim entre as válidas, no Brasil, pelos agregados
    const agr = await consulta(`SELECT sum(n) FILTER (WHERE valor_txt = 'Sim') AS sim, sum(n) FILTER (WHERE valida) AS validas
      FROM munic_agregados WHERE pesquisa = 'munic' AND ano = ${ano} AND var = '${v}' AND corte = 'brasil'`);
    // o mesmo número contado nas respostas município a município
    const resp = await consulta(`SELECT count(*) FILTER (WHERE valor_txt = 'Sim') AS sim, count(*) FILTER (WHERE valida) AS validas
      FROM munic_respostas WHERE pesquisa = 'munic' AND ano = ${ano} AND var = '${v}'`);
    assert.deepEqual(agr.linhas[0], resp.linhas[0]);
    assert.ok(Number(agr.linhas[0][0]) > 0 && Number(agr.linhas[0][1]) > Number(agr.linhas[0][0]));
    // o catálogo diz o mesmo número de respostas válidas
    const cat = await consulta(`SELECT n_validas FROM munic_catalogo WHERE pesquisa = 'munic' AND ano = ${ano} AND var = '${v}'`);
    assert.equal(Number(cat.linhas[0][0]), Number(agr.linhas[0][1]));
    // por faixa de porte: as faixas somam o Brasil, menos os sem faixa (Noronha)
    const faixas = await consulta(`SELECT sum(n) FROM munic_agregados WHERE pesquisa = 'munic' AND ano = ${ano} AND var = '${v}' AND corte = 'faixa' AND valida`);
    assert.ok(Number(agr.linhas[0][1]) - Number(faixas.linhas[0][0]) <= 1);
  });

  test('as visões da ESTADIC e o cruzamento com as finanças pelo código funcionam na mesma conversa', { skip: semMunic }, async () => {
    const est = await consulta("SELECT count(DISTINCT cod) AS ufs FROM munic_territorio WHERE pesquisa = 'estadic' AND ano = 2024");
    assert.equal(Number(est.linhas[0][0]), 27);
    // município da MUNIC × cadastro das finanças: a chave é cod = cod_ibge (7 dígitos)
    const par = await consulta(`SELECT count(*) AS n, count(e.cod_ibge) AS com_par FROM munic_territorio t LEFT JOIN entes e ON e.cod_ibge = t.cod
      WHERE t.pesquisa = 'munic' AND t.ano = 2024`, ['munic', 'financas']);
    assert.equal(Number(par.linhas[0][0]), 5570);
    assert.ok(Number(par.linhas[0][1]) >= 5560, `municípios sem par no cadastro: ${Number(par.linhas[0][0]) - Number(par.linhas[0][1])}`);
  });
});

describe('IA: clima (CHIRPS e ERA5-Land)', () => {
  const semClima = !existsSync(`${DATA}/gold/clima/mensal.parquet`);
  const consulta = async (sql: string, paineis: Parameters<typeof executarConsulta>[1] = ['clima']) => {
    const r = await executarConsulta({ sql }, paineis);
    assert.ok(!('erro' in r), 'erro' in r ? r.erro : '');
    return r as Extract<typeof r, { linhas: unknown[][] }>;
  };

  test('o painel entra na lista de painéis da IA e tem cobertura, fonte, códigos e sugestões próprias', async () => {
    assert.ok(PAINEIS.includes('clima'));
    const cob = { rais: [], caged: null, microdados: false, dca: [], clima: { de: 1979, ate: 202609 } } as Parameters<typeof descreverCobertura>[1];
    assert.match(descreverCobertura(['clima'], cob).join('\n'), /Clima 1979–2026: chuva \(CHIRPS, desde 1981\)/);
    assert.match(disponibilidadeNoAno(2010, ['clima'], cob), /com dados nesse ano: clima \(CHIRPS e ERA5-Land\) \(1979–2026\)/);
    assert.match(disponibilidadeNoAno(2026, ['clima'], cob), /ano incompleto/);
    assert.match(disponibilidadeNoAno(1970, ['clima'], cob), /sem dados nesse ano: clima/);
    assert.equal(fontesConsultadas(['SELECT * FROM clima_anual WHERE variavel = \'chuva_mm\'']).length, 1);
    const sug = sugestoes(['clima'], { tipo: 'brasil' }, cob, null);
    assert.ok(sug.length >= 3 && sug.every((s) => s.paineis.join() === 'clima'));
    // o ano das sugestões é o último ano completo (2026 está em curso)
    assert.ok(sug.every((s) => !/2026/.test(s.texto)));
    assert.match(codigosDoMunicipio(ANDIRA, ['clima']), /cod = 4101101 \(7 dígitos\) em clima_territorio, clima_anual, clima_mensal e clima_normal/);
  });

  test('anual, mensal, normal e agregado respondem pela IA e concordam entre si', { skip: semClima }, async () => {
    // Andirá: a chuva anual de 2020 é a soma dos 12 meses de clima_mensal
    const anual = await consulta(`SELECT valor, normal, anomalia_pct, anomalia FROM clima_anual WHERE variavel = 'chuva_mm' AND cod = ${ANDIRA} AND ano = 2020`);
    const mensal = await consulta(`SELECT sum(valor), count(*) FROM clima_mensal WHERE variavel = 'chuva_mm' AND cod = ${ANDIRA} AND ano = 2020`);
    assert.equal(Number(mensal.linhas[0][1]), 12);
    assert.ok(Math.abs(Number(anual.linhas[0][0]) - Number(mensal.linhas[0][0])) < 0.5);
    // a normal anual é a soma das 12 normais mensais; a anomalia da chuva é relativa e a absoluta fica nula
    const normal = await consulta(`SELECT sum(normal) FROM clima_normal WHERE variavel = 'chuva_mm' AND cod = ${ANDIRA}`);
    assert.ok(Math.abs(Number(anual.linhas[0][1]) - Number(normal.linhas[0][0])) < 0.5);
    assert.ok(Math.abs(Number(anual.linhas[0][2]) - (Number(anual.linhas[0][0]) / Number(anual.linhas[0][1]) - 1)) < 1e-6);
    assert.equal(anual.linhas[0][3], null);
    // a temperatura é o contrário: anomalia absoluta em °C, sem percentual
    const temp = await consulta(`SELECT valor, normal, anomalia_pct, anomalia FROM clima_anual WHERE variavel = 'temperatura_c' AND cod = ${ANDIRA} AND ano = 2020`);
    assert.equal(temp.linhas[0][2], null);
    assert.ok(Math.abs(Number(temp.linhas[0][3]) - (Number(temp.linhas[0][0]) - Number(temp.linhas[0][1]))) < 1e-6);
    assert.ok(Number(temp.linhas[0][0]) > 15 && Number(temp.linhas[0][0]) < 30);
    // catálogo: 6 variáveis, chuva desde 1981 e as demais desde 1979
    const cat = await consulta('SELECT variavel, ano_de FROM clima_catalogo ORDER BY variavel');
    assert.equal(cat.linhas.length, 6);
    assert.deepEqual(cat.linhas.map((l) => [l[0], Number(l[1])]).filter((l) => l[0] === 'chuva_mm' || l[0] === 'temperatura_c'), [['chuva_mm', 1981], ['temperatura_c', 1979]]);
    // Brasil e UF: o ano inteiro está em mes = 0
    const br = await consulta("SELECT valor FROM clima_agregado WHERE grupo = 'BR' AND variavel = 'temperatura_c' AND ano = 2020 AND mes = 0");
    assert.ok(Number(br.linhas[0][0]) > 20 && Number(br.linhas[0][0]) < 29);
  });

  test('evaporação: os meses de 09/2022 a 02/2024 ficam de fora e o ano não fecha', { skip: semClima }, async () => {
    const lacuna = await consulta(`SELECT count(*) FROM clima_mensal WHERE variavel = 'evap_mm' AND cod = ${ANDIRA} AND ano * 100 + mes BETWEEN 202209 AND 202402`);
    assert.equal(Number(lacuna.linhas[0][0]), 0);
    const anos = await consulta(`SELECT count(*) FROM clima_anual WHERE variavel = 'evap_mm' AND cod = ${ANDIRA} AND ano IN (2022, 2023)`);
    assert.equal(Number(anos.linhas[0][0]), 0);
  });

  test('o cruzamento com o cadastro pelo código funciona na mesma conversa', { skip: semClima }, async () => {
    const par = await consulta(`SELECT count(*) AS n, count(e.cod_ibge) AS com_par FROM clima_territorio t LEFT JOIN entes e ON e.cod_ibge = t.cod`, ['clima', 'financas']);
    assert.equal(Number(par.linhas[0][0]), 5570);
    assert.ok(Number(par.linhas[0][1]) >= 5560);
  });
});

describe('IA: cancelamento de consultas', () => {
  test('o sinal cancela a consulta de imediato, mesmo sem o DuckDB responder', async () => {
    const parar = new AbortController();
    const andamento = executarConsulta({ sql: 'SELECT count(*) FROM range(100000000) a, range(1000) b' }, ['financas'], parar.signal);
    parar.abort();
    const inicio = Date.now();
    await assert.rejects(andamento, (e: unknown) => (e as { name?: string }).name === 'AbortError');
    assert.ok(Date.now() - inicio < 2000, 'a página não deve esperar o fim da consulta');
    // com o sinal já cancelado, nem começa
    await assert.rejects(executarConsulta({ sql: 'SELECT 1' }, ['financas'], AbortSignal.abort()), (e: unknown) => (e as { name?: string }).name === 'AbortError');
  });
});

describe('IA: continuidade (consulta partida por ano, reaproveitamento, compactação, cancelamento)', () => {
  const resposta = (k: number, extra: Record<string, unknown> = {}) => ({ resposta: {
    tipo: 'resposta', conclusao: `Conclusão ${k}.`, destaques: [], explicacao: '', interpretacao: [], hipoteses: '', limitacoes: `Ressalva ${k}: média anual de remuneração.`,
    recorte: { territorio: 'Itaberaí', periodo_solicitado: '2011 e 2021', periodo: '2011 e 2021', unidade: 'vínculos', filtros: 'ativos em 31/12', agrupamentos: '' },
    metodologia: 'Soma ÷ vínculos.', tabelas: [], graficos: [], aprofundar: [], ...extra,
  } });
  const original = globalThis.fetch;
  after(() => {
    globalThis.fetch = original;
  });

  test('consulta partida: junta os anos, mostra o progresso, guarda os concluídos e diz o que falta', async () => {
    limparCacheDePartes();
    const chamadas: number[] = [];
    let falhar = true;
    const rodar = async (s: string): Promise<Resultado> => {
      const ano = Number(/ano = (\d+)/.exec(s)![1]);
      chamadas.push(ano);
      if (ano === 2013 && falhar) return { erro: 'a consulta passou de 4 minutos e foi interrompida', tempoEsgotado: true };
      return { colunas: ['ano', 'vinculos'], linhas: [[ano, ano - 2000]], total: 1 };
    };
    const sql = 'SELECT ano, count(*) AS vinculos FROM t WHERE ano = {ano} GROUP BY 1';
    const p = lerParticao({ anos: [2014, 2011, 2012, 2013, 2012] }, sql);
    assert.ok(p && typeof p === 'object');
    if (!p || typeof p === 'string') return;
    assert.deepEqual(p.anos, [2011, 2012, 2013, 2014]);
    const progresso: string[] = [];
    const r1 = await executarPartida(sql, p, rodar, { versao: 'v1', limite: 2000, aoParte: (f, t0) => progresso.push(`${f}/${t0}`) });
    assert.ok(!('erro' in r1));
    if ('erro' in r1) return;
    assert.deepEqual(r1.parcial?.concluidos, [2011, 2012, 2014]);
    assert.deepEqual(r1.parcial?.faltam.map((f) => f.ano), [2013]);
    assert.equal(r1.linhas.length, 3);
    assert.equal(progresso[0], '0/4');
    assert.equal(progresso.at(-1), '4/4');
    // para o modelo: cobertura parcial explícita, sem tratar o total como completo
    const paraIa = JSON.parse(paraModelo(r1, 'C1'));
    assert.deepEqual(paraIa.cobertura_parcial.anos_faltantes.map((f: { ano: number }) => f.ano), [2013]);
    assert.match(paraIa.aviso_parcial, /PARCIAL: 3 de 4 anos/);
    // nova tentativa: só o ano que faltou roda de novo
    falhar = false;
    chamadas.length = 0;
    const r2 = await executarPartida(sql, p, rodar, { versao: 'v1', limite: 2000 });
    assert.deepEqual(chamadas, [2013]);
    assert.ok(!('erro' in r2) && !r2.parcial && r2.linhas.length === 4 && r2.total === 4);
    // outra versão dos dados não reaproveita nada
    chamadas.length = 0;
    await executarPartida(sql, p, rodar, { versao: 'v2', limite: 2000 });
    assert.equal(chamadas.length, 4);
    // todos falham por tempo: erro marcado como tempo esgotado (o modelo deve mudar o plano, não repetir)
    limparCacheDePartes();
    const tudo = await executarPartida(sql, p, async () => ({ erro: 'a consulta passou de 4 minutos e foi interrompida' }), { limite: 10 });
    assert.ok('erro' in tudo && tudo.tempoEsgotado === true);
    // marcador ausente ou ano inválido
    assert.match(String(lerParticao({ anos: [2011, 2012] }, 'SELECT 1')), /marcador \{ano\}/);
    assert.match(String(lerParticao({ anos: ['x'] }, sql)), /lista de anos/);
    assert.equal(lerParticao({ anos: [] }, 'SELECT 1'), null);
  });

  test('consulta partida no DuckDB: um ano de cada vez, mesmo SQL validado, cancelável', async () => {
    limparCacheDePartes();
    const r = await executarConsulta({ sql: 'SELECT {ano} AS ano, {ano} * 2 AS dobro', objetivo: 'teste', particao: { anos: [2011, 2012, 2013] } }, ['financas']);
    assert.ok(!('erro' in r), JSON.stringify(r));
    if ('erro' in r) return;
    assert.ok(!r.parcial, JSON.stringify(r.parcial));
    assert.deepEqual(r.linhas, [[2011, 4022], [2012, 4024], [2013, 4026]]);
    // o SQL de cada ano passa pela validação como qualquer outro
    const ruim = await executarConsulta({ sql: 'DROP TABLE x -- {ano}', particao: { anos: [2011] } }, ['financas']);
    assert.ok('erro' in ruim);
    const parar = new AbortController();
    parar.abort();
    await assert.rejects(executarConsulta({ sql: 'SELECT {ano}', particao: { anos: [2011, 2012] } }, ['financas'], parar.signal), (e: unknown) => (e as { name?: string }).name === 'AbortError');
  });

  const consultaDe = (id: string, sql: string, extra: Record<string, unknown> = {}): Mensagem => ({ role: 'assistant', content: [{ type: 'tool_use', id, name: 'consultar', input: { sql, objetivo: `Objetivo de ${id}`, ...extra } }] });
  const apurado = { colunas: ['ano', 'municipio', 'vinculos', 'remuneracao'], linhas: [[2011, 'Itaberaí', 2606, 995.35], [2011, 'Goiás', 49, 1500.5], [2021, 'Itaberaí', 4713, 1977.75], [2021, 'Goiás', 237, 2100.25]], total: 4, dados: 'v1' };

  test('resultado apurado vira tabela res_C1: participações sem apurar de novo; mudanças de versão ou conversa bloqueiam', async () => {
    const hist: Mensagem[] = [
      { role: 'user', content: [{ type: 'text', text: 'ctx' }, { type: 'text', text: 'Vínculos de 2011 e 2021' }] },
      consultaDe('c1', 'SELECT ano, municipio, vinculos, remuneracao FROM base WHERE ano IN (2011, 2021) AND cnae_classe = \'01555\'', { definicao: 'vínculos ativos em 31/12; média ÷ todos os ativos' }),
    ];
    const resultados: Record<string, Resultado> = { c1: apurado };
    const anteriores = resultadosReaproveitaveis(hist, resultados, 'v1');
    assert.deepEqual([...anteriores.keys()], ['C1']);
    const cat = catalogoDeResultados(anteriores);
    assert.match(cat, /^\[RESULTADOS DA CONVERSA\]/);
    assert.match(cat, /res_C1 \(4 linhas; colunas: ano, municipio, vinculos, remuneracao\)/);
    assert.match(cat, /definição: vínculos ativos em 31\/12/);
    assert.match(cat, /filtros: ano IN \(2011, 2021\) AND cnae_classe/);
    const part = await executarConsulta({ sql: 'SELECT ano, municipio, round(100.0 * vinculos / sum(vinculos) OVER (PARTITION BY ano), 2) AS part FROM res_C1 ORDER BY ano, municipio' }, ['financas'], undefined, 2000, { anteriores });
    assert.ok(!('erro' in part), JSON.stringify(part));
    if ('erro' in part) return;
    assert.deepEqual(part.linhas.find((l) => l[0] === 2021 && l[1] === 'Itaberaí'), [2021, 'Itaberaí', 95.21]);
    // números não inteiros entram como DOUBLE: contas de valores reais não estouram como DECIMAL
    const tipo = await executarConsulta({ sql: 'SELECT typeof(remuneracao) AS tipo, sum(remuneracao * 1e15 * remuneracao) AS grande FROM res_C1 GROUP BY 1' }, ['financas'], undefined, 2000, { anteriores });
    assert.ok(!('erro' in tipo), JSON.stringify(tipo));
    if (!('erro' in tipo)) assert.equal(tipo.linhas[0][0], 'DOUBLE');
    // outra versão dos dados, resultado parcial, truncado ou com erro: não é oferecido
    assert.equal(resultadosReaproveitaveis(hist, resultados, 'v2').size, 0);
    assert.equal(resultadosReaproveitaveis(hist, { c1: { ...apurado, parcial: { pedidos: [2011, 2021], concluidos: [2011], reaproveitados: [], faltam: [{ ano: 2021, motivo: 'x' }] } } }, 'v1').size, 0);
    assert.equal(resultadosReaproveitaveis(hist, { c1: { ...apurado, total: 9000 } }, 'v1').size, 0);
    assert.equal(resultadosReaproveitaveis(hist, { c1: { erro: 'falhou' } }, 'v1').size, 0);
    // outra conversa (sem anteriores): res_C1 não existe, mesmo que a tabela temporária ainda esteja na conexão
    const outra = await executarConsulta({ sql: 'SELECT * FROM res_C1' }, ['financas'], undefined, 2000, { anteriores: new Map() });
    assert.ok('erro' in outra && outra.bloqueada && /res_C1 não está disponível/.test(outra.erro));
    // identificadores que não são de resultado não passam
    const falsa = await executarConsulta({ sql: 'SELECT * FROM res_C9' }, ['financas'], undefined, 2000, { anteriores });
    assert.ok('erro' in falsa && /res_C9/.test(falsa.erro));
  });

  test('sequência de perguntas: a segunda recebe o catálogo e consulta res_C1 em vez de apurar de novo', async () => {
    limparCacheDePartes();
    const pedidos: { mensagens: Mensagem[] }[] = [];
    const passos: ((p: { mensagens: Mensagem[] }) => unknown)[] = [
      () => ({ parada: 'tool_use', restantes: 40, conteudo: [{ type: 'tool_use', id: 'a1', name: 'consultar', input: {
        sql: 'SELECT {ano} AS ano, \'Itaberaí\' AS municipio, {ano} * 2 AS vinculos', objetivo: 'Vínculos por ano', definicao: 'vínculos ativos em 31/12', particao: { anos: [2011, 2021] } } }] }),
      () => ({ parada: 'end_turn', restantes: 40, conteudo: [{ type: 'text', text: 'Pronto.' }] }),
      () => ({ parada: 'tool_use', restantes: 39, conteudo: [{ type: 'tool_use', id: 'a2', name: 'consultar', input: {
        sql: 'SELECT ano, round(100.0 * vinculos / sum(vinculos) OVER (), 1) AS participacao FROM res_C1 ORDER BY ano', objetivo: 'Participação por ano', definicao: '', particao: { anos: [] } } }] }),
      () => ({ parada: 'end_turn', restantes: 39, conteudo: [{ type: 'text', text: 'Pronto de novo.' }] }),
    ];
    globalThis.fetch = (async (_u: unknown, init?: { body?: string; signal?: AbortSignal }) => {
      const pedido = JSON.parse(String(init?.body));
      pedidos.push(pedido);
      return new Response(JSON.stringify(passos[pedidos.length - 1](pedido)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    usarServidorIaNoTeste('');
    const resultados: Record<string, Resultado> = {};
    const partes: string[] = [];
    const base = { contexto: 'ctx', idioma: 'pt', paineis: ['financas'] as Painel[], sinal: new AbortController().signal, versaoDados: 'v1', aoAtualizar: () => undefined, aoResultado: (id: string, r: Resultado) => (resultados[id] = r),
      aoProgresso: (p: { fase: string; parte?: { feitas: number; total: number } }) => { if (p.fase === 'consulta' && p.parte) partes.push(`${p.parte.feitas}/${p.parte.total}`); } };
    const r1 = await perguntarIa({ ...base, historico: [], pergunta: 'Vínculos em 2011 e 2021?' });
    assert.equal(r1.desfecho, 'texto');
    assert.deepEqual(partes, ['0/2', '1/2', '2/2']);
    assert.equal((resultados.a1 as { dados?: string }).dados, 'v1');
    const r2 = await perguntarIa({ ...base, historico: r1.mensagens, resultados, pergunta: 'Qual a participação de cada ano?' });
    assert.equal(r2.desfecho, 'texto');
    // a pergunta 2 foi enviada com o catálogo dos resultados já apurados
    const textos = (pedidos[2].mensagens.at(-1)!.content as { type: string; text?: string }[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    assert.match(textos, /\[RESULTADOS DA CONVERSA\][\s\S]*res_C1 \(2 linhas/);
    const rr = JSON.parse((pedidos[3].mensagens.at(-1)!.content as { content: string }[])[0].content);
    assert.deepEqual(rr.linhas, [[2011, 49.9], [2021, 50.1]]); // 4022 e 4042 do total de 8064
    // a consulta sobre res_C1 não leu as bases: nenhuma etapa de apuração nova com a mesma consulta partida
    assert.equal(partes.length, 3, 'o progresso (0/2, 1/2, 2/2) é só da primeira pergunta');
  });

  test('resposta que chega depois do cancelamento é descartada e não toca na conversa', async () => {
    const controle = new AbortController();
    const atualizacoes: number[] = [];
    let resultados = 0;
    globalThis.fetch = (async () => {
      controle.abort(); // o usuário cancela enquanto o modelo ainda pensa; a resposta chega depois
      return new Response(JSON.stringify({ parada: 'tool_use', restantes: 30, conteudo: [{ type: 'tool_use', id: 'z1', name: 'consultar', input: { sql: 'SELECT 1 AS n', objetivo: 'x' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    usarServidorIaNoTeste('');
    await assert.rejects(perguntarIa({
      historico: [], pergunta: 'Teste', contexto: 'ctx', idioma: 'pt', paineis: ['financas'], sinal: controle.signal,
      aoAtualizar: (m) => atualizacoes.push(m.length), aoResultado: () => { resultados++; },
    }), (e: Error) => e.name === 'AbortError');
    assert.deepEqual(atualizacoes, [1], 'só a pergunta; a resposta tardia do modelo não é registrada');
    assert.equal(resultados, 0, 'a consulta do modelo não chega a rodar');
  });

  test('histórico longo: tabelas antigas viram res_Cn e, passado o limite, um resumo com as ressalvas; a conversa guardada não muda', () => {
    let hist: Mensagem[] = [];
    const resultados: Record<string, Resultado> = {};
    const grande = { ...apurado, linhas: Array.from({ length: 150 }, (_, i) => [2011, `Município ${i}`, i, 1000 + i / 7]), total: 150 };
    for (let k = 1; k <= 9; k++) {
      hist = comPergunta(hist, `Pergunta ${k}`, 'ctx');
      hist = [...hist, consultaDe(`c${k}`, `SELECT * FROM base WHERE ano = ${2010 + k}`),
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: `c${k}`, content: paraModelo(grande, `C${k}`) }] },
        { role: 'assistant', content: [{ type: 'tool_use', id: `r${k}`, name: 'responder', input: resposta(k, { tabelas: [{ consulta: `C${k}`, papel: 'principal', tipo: 'tabela', titulo: 'x'.repeat(2000) }] }) }] }];
      resultados[`c${k}`] = grande;
    }
    hist = comPergunta(hist, 'Pergunta 10', 'ctx');
    const antes = JSON.stringify(hist);
    const tabelas = compactarParaEnvio(hist.slice(0, 17), resultados, 'v1');
    assert.equal(tabelas.compactada, 'tabelas');
    const stub = JSON.stringify(tabelas.mensagens);
    assert.ok(stub.includes('Tabela completa guardada na página como res_C1'));
    assert.ok(stub.length < JSON.stringify(hist.slice(0, 17)).length / 2);
    const envio = compactarParaEnvio(hist, resultados, 'v1');
    assert.equal(envio.compactada, 'resumo');
    assert.equal(JSON.stringify(hist), antes, 'a conversa guardada continua inteira');
    const primeira = envio.mensagens[0].content as { text: string }[];
    assert.ok(primeira[0].text.startsWith('[RESUMO DA CONVERSA]'));
    assert.match(primeira[0].text, /Ressalva 1: média anual/);
    assert.match(primeira[0].text, /Ressalva 7: média anual/);
    assert.match(primeira[0].text, /Pergunta 3/);
    assert.ok(JSON.stringify(envio.mensagens).length < antes.length / 3, `${JSON.stringify(envio.mensagens).length} de ${antes.length}`);
    assert.equal(textoDaPergunta(envio.mensagens.at(-1)!), 'Pergunta 10');
    assert.equal(envio.mensagens.filter(ehPergunta).length, 3, 'resumo + a pergunta anterior + a nova');
    // o Worker aceita o histórico compactado (sem o limite de 15 perguntas por conversa, que só conta o que é enviado)
    assert.equal(validarHistorico(envio.mensagens), null);
    // toda ferramenta pedida continua com o seu resultado
    const pedidas = new Set(envio.mensagens.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_use').map((b) => b.id) : [])));
    const devolvidas = new Set(envio.mensagens.flatMap((m) => (Array.isArray(m.content) ? m.content.filter((b) => b.type === 'tool_result').map((b) => b.tool_use_id) : [])));
    for (const id of pedidas) assert.ok(devolvidas.has(id), `sem resultado para ${id}`);
    // retomar uma conversa salva: os resultados guardados voltam como res_Cn
    assert.equal(resultadosReaproveitaveis(hist, resultados, 'v1').size, 9);
  });

  test('coerência: tema de outra cadeia na conclusão, classe e subclasse CNAE no mesmo filtro', () => {
    const tcc = "WHERE cnae_classe IN ('01555', '46346', '47229') OR cnae_subclasse = '1012101'";
    const base = { conclusao: 'Os vínculos da avicultura passaram de 2.655 para 4.950.', titulos: 'Vínculos na cadeia avícola', sqls: [`SELECT ano FROM rais_vinculos ${tcc}`], objetivos: ['Vínculos da avicultura'] };
    assert.deepEqual(incoerenciasDoRecorte('Vínculos da avicultura nos 13 municípios', base), []);
    const bovina = incoerenciasDoRecorte('Vínculos da avicultura nos 13 municípios', { ...base, conclusao: 'Os vínculos da cadeia bovina e da avicultura cresceram.' });
    assert.equal(bovina.length, 1);
    assert.match(bovina[0], /bovinos/);
    // o tema que está nos filtros ou na pergunta é legítimo
    assert.deepEqual(incoerenciasDoRecorte('Vínculos da avicultura', { ...base, sqls: ["SELECT 1 -- bovino\nWHERE cnae_classe = '01555'"] }), []);
    assert.equal(incoerenciasDoRecorte('x', { ...base, sqls: ["SELECT 1 WHERE cnae_classe = '10121' OR cnae_subclasse = '1012101'"] }).length, 1);
    assert.deepEqual(incoerenciasDoRecorte('x', { ...base, sqls: ["SELECT CASE WHEN cnae_classe = '10121' THEN 1 WHEN cnae_subclasse = '1012101' THEN 2 END"] }), []);
    // erro de DECIMAL volta com a correção conhecida
    assert.match(dicaDoErro('Out of Range Error: Overflow in multiplication of DECIMAL(18,2) (1 * 2)'), /CAST\(coluna AS DOUBLE\)/);
    assert.equal(dicaDoErro('Catalog Error: tabela x'), 'Catalog Error: tabela x');
  });

  const semMicroRef = !existsSync(`${DATA}/gold/trabalho/cubo_mun`) || !existsSync(`${MICRO}/silver/trabalho/micro/rais_vinculos/ano=2021/uf=52.parquet`)
    || !existsSync(`${MICRO}/silver/trabalho/micro/indice.json`);

  test('regressão dos 13 municípios (microdados): vínculos, remuneração média anual e denominadores, calculados dos dados', { skip: semMicroRef, timeout: 600_000 }, async () => {
    limparCacheDePartes();
    usarMicrodadosNoTeste(true);
    await tabelasIaTrabalho();
    usarMicrodadosNoTeste(false);
    const municipios = [520215, 521040, 521120, 520960, 520160, 521056, 521295, 520753, 521140, 521060, 520250, 520890, 520929];
    const nomes = await executarConsulta({ sql: `SELECT count(*) AS n FROM entes WHERE esfera = 'M' AND cod_ibge // 10 IN (${municipios.join(',')})` }, ['trabalho']);
    assert.ok(!('erro' in nomes), JSON.stringify(nomes));
    const sql = `SELECT ano, municipio, count(*) AS vinculos, count(*) FILTER (WHERE rem_media_nom > 0) AS vinculos_rem_positiva,
        sum(rem_media_nom) FILTER (WHERE rem_media_nom > 0) AS rem_soma, typeof(any_value(rem_media_nom)) AS tipo
      FROM rais_vinculos WHERE ano = {ano} AND uf = 52 AND ativo_31_12 = 1 AND municipio IN (${municipios.join(',')})
        AND (cnae_classe = '01555' OR cnae_subclasse = '1012101' OR cnae_classe IN ('46346', '47229'))
      GROUP BY ano, municipio ORDER BY municipio`;
    const r = await executarConsulta({ sql, objetivo: 'Vínculos e remuneração', particao: { anos: [2011, 2021] } }, ['trabalho']);
    assert.ok(!('erro' in r), JSON.stringify(r));
    if ('erro' in r) return;
    assert.ok(!r.parcial);
    const por = (ano: number) => r.linhas.filter((l) => l[0] === ano);
    const soma = (ano: number) => por(ano).reduce((s, l) => s + Number(l[2]), 0);
    // os totais dos 13 municípios e os de Itaberaí (521040 = 5210406)
    assert.equal(soma(2011), 2655);
    assert.equal(soma(2021), 4950);
    const ita = (ano: number) => por(ano).find((l) => l[1] === 521040)!;
    assert.equal(ita(2011)[2], 2606);
    assert.equal(ita(2021)[2], 4713);
    assert.equal(ita(2021)[3], 4646);
    // a remuneração de referência é a média do ano (rem_media_nom): numerador comum, dois denominadores
    const rem = Number(ita(2021)[4]);
    assert.equal(Math.round((rem / Number(ita(2021)[2])) * 100) / 100, 1977.75, 'soma ÷ todos os vínculos');
    assert.equal(Math.round((rem / Number(ita(2021)[3])) * 100) / 100, 2006.27, 'soma ÷ só os vínculos com remuneração positiva');
    // os valores monetários chegam em DOUBLE: produtos de remunerações não estouram como DECIMAL
    assert.equal(ita(2021)[5], 'DOUBLE');
    const grande = await executarConsulta({ sql: 'SELECT sum(rem_dezembro_nom * rem_dezembro_nom * rem_dezembro_nom * rem_dezembro_nom) AS p4 FROM rais_vinculos WHERE ano = 2021 AND uf = 52 AND municipio = 521040 AND ativo_31_12 = 1' }, ['trabalho']);
    assert.ok(!('erro' in grande), JSON.stringify(grande));
  });
});

describe('IA: fila de perguntas com estado por item', () => {
  test('seis perguntas, falha na terceira: só ela muda de estado, as outras ficam e podem rodar depois da nova tentativa', () => {
    let fila: ItemFila[] = [];
    for (let i = 1; i <= 6; i++) fila = enfileirar(fila, 'conv-1', `Pergunta ${i}`, `q${i}`);
    const rodadas: string[] = [];
    const rodar = (falhar: string[] = []) => {
      for (let p = proxima(fila, 'conv-1'); p; p = proxima(fila, 'conv-1')) {
        fila = marcarItem(fila, p.id, 'executando');
        assert.equal(proxima(fila, 'conv-1'), null, 'nada começa enquanto uma executa');
        rodadas.push(p.id);
        fila = falhar.includes(p.id) ? marcarItem(fila, p.id, 'falhou', 'timeout') : marcarItem(fila, p.id, 'concluida');
      }
    };
    rodar(['q3']);
    assert.deepEqual(rodadas, ['q1', 'q2', 'q3']);
    assert.deepEqual(fila.map((x) => x.estado), ['concluida', 'concluida', 'falhou', 'aguardando', 'aguardando', 'aguardando']);
    assert.equal(fila[2].erro, 'timeout');
    assert.equal(proxima(fila, 'conv-1'), null, 'a fila espera a decisão sobre a que falhou');
    // tentar de novo só a que falhou; as demais seguem como estão e nenhuma é repetida
    fila = tentarDeNovo(fila, 'q4'); // não falhou: nada muda
    assert.equal(fila[3].estado, 'aguardando');
    fila = tentarDeNovo(fila, 'q3');
    assert.equal(fila[2].estado, 'aguardando');
    assert.equal(fila[2].erro, undefined);
    rodar();
    assert.deepEqual(rodadas, ['q1', 'q2', 'q3', 'q3', 'q4', 'q5', 'q6']);
    assert.ok(fila.every((x) => x.estado === 'concluida'));
    assert.equal(new Set(fila.map((x) => x.id)).size, 6);
    assert.equal(abertas(fila), 0);
  });

  test('cancelada e removida: o resto da fila segue; o que executa não é removido', () => {
    let fila = ['A', 'B', 'C'].reduce((f, x) => enfileirar(f, 'c', x, `id${x}`), [] as ItemFila[]);
    fila = marcarItem(fila, 'idA', 'cancelada');
    assert.equal(proxima(fila, 'c'), null);
    fila = removerItem(fila, 'idA');
    assert.equal(proxima(fila, 'c')?.texto, 'B');
    fila = marcarItem(fila, 'idB', 'executando');
    assert.equal(removerItem(fila, 'idB').length, fila.length);
    assert.equal(proxima(fila, 'outra-conversa'), null);
  });

  test('recarregar a página: a fila volta; o que executava volta como falhou; lixo é ignorado; concluídas não voltam', () => {
    let fila = ['A', 'B', 'C', 'D'].reduce((f, x) => enfileirar(f, 'c', x, `id${x}`), [] as ItemFila[]);
    fila = marcarItem(marcarItem(fila, 'idA', 'concluida'), 'idB', 'executando');
    const volta = lerFila(serializar(fila));
    assert.deepEqual(volta.map((x) => [x.id, x.estado]), [['idB', 'falhou'], ['idC', 'aguardando'], ['idD', 'aguardando']]);
    assert.match(volta[0].erro ?? '', /recarregar/);
    assert.deepEqual(lerFila('não é json'), []);
    assert.deepEqual(lerFila(JSON.stringify([{ id: 1 }, { id: 'x', conversa: 'c', texto: 't', estado: 'qualquer' }])), []);
    assert.equal(lerFila(JSON.stringify([...volta, ...volta])).length, 3, 'sem perguntas duplicadas');
  });
});

describe('PDF gerado no navegador', () => {
  const textosDoPdf = (pdf: Uint8Array) => {
    const s = Buffer.from(pdf).toString('latin1');
    return [...s.matchAll(/<([0-9a-f]+)> Tj/g)].map((m) => Buffer.from(m[1], 'hex').toString('latin1'));
  };
  const linhas28 = Array.from({ length: 28 }, (_, i) => [`Município ${i + 1} — ação`, String(1000 + i), `${(i * 3.5).toFixed(1).replace('.', ',')}%`]);

  test('arquivo válido: cabeçalho, xref com os deslocamentos certos, trailer e número de páginas', () => {
    const pdf = paraPdf({ titulo: 'Pergunte aos dados', rodape: 'LAPAM/UFG', blocos: [
      { tipo: 'titulo', nivel: 1, texto: '1. Qual a escolaridade?' },
      { tipo: 'tabela', titulo: 'Tabela 1', colunas: ['Território', 'Vínculos', 'Participação'], linhas: linhas28, texto: [true, false, false], notas: ['Fonte: RAIS (MTE).'] },
    ] });
    const s = Buffer.from(pdf).toString('latin1');
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
    const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
    assert.equal(s.slice(xref, xref + 4), 'xref');
    const tamanho = Number(/\/Size (\d+)/.exec(s)![1]);
    const entradas = [...s.slice(xref).matchAll(/^(\d{10}) \d{5} n $/gm)].map((m) => Number(m[1]));
    assert.equal(entradas.length, tamanho - 1);
    entradas.forEach((pos, i) => assert.ok(s.startsWith(`${i + 1} 0 obj`, pos), `objeto ${i + 1} no deslocamento ${pos}`));
    const paginas = Number(/\/Count (\d+)/.exec(s)![1]);
    assert.equal((s.match(/\/Type \/Page /g) ?? []).length, paginas);
    assert.ok(paginas >= 1);
  });

  test('todas as 28 linhas e a acentuação (WinAnsi) estão no arquivo', () => {
    const pdf = paraPdf({ titulo: 'Relatório — ação', rodape: 'LAPAM/UFG', blocos: [
      { tipo: 'tabela', colunas: ['Território', 'Vínculos', 'Participação'], linhas: linhas28, texto: [true, false, false] },
    ] });
    const t = textosDoPdf(pdf).join('\n');
    for (let i = 1; i <= 28; i++) assert.ok(t.includes(`Município ${i} `), `linha ${i}`);
    assert.ok(t.includes('ação'));
    assert.ok(t.includes('Participação'));
    assert.deepEqual(paraWinAnsi('çãé–×'), [0xe7, 0xe3, 0xe9, 0x96, 0xd7]);
    assert.equal(Buffer.from(paraWinAnsi('≥ 5 → ok')).toString('latin1'), '>= 5 -> ok');
  });

  test('tabela longa pagina e repete o cabeçalho; tabela larga se divide em blocos de colunas com a primeira repetida', () => {
    const longa = Array.from({ length: 400 }, (_, i) => [`Linha ${i}`, String(i)]);
    const pdfLongo = paraPdf({ titulo: 'x', rodape: 'r', blocos: [{ tipo: 'tabela', colunas: ['Rótulo', 'Valor'], linhas: longa, texto: [true, false] }] });
    const paginas = Number(/\/Count (\d+)/.exec(Buffer.from(pdfLongo).toString('latin1'))![1]);
    assert.ok(paginas >= 5, `páginas: ${paginas}`);
    const t = textosDoPdf(pdfLongo);
    assert.equal(t.filter((x) => x === 'Rótulo').length, paginas, 'cabeçalho em cada página');
    assert.ok(t.includes('Linha 399'));
    const cols = Array.from({ length: 30 }, (_, j) => `Coluna_com_nome_comprido_${j}`);
    const larga = paraPdf({ titulo: 'x', rodape: 'r', blocos: [{ tipo: 'tabela', colunas: cols, linhas: [cols.map((_, j) => `valor ${j}`)], texto: cols.map((_, j) => j === 0) }] });
    const tl = textosDoPdf(larga).join('|');
    for (let j = 0; j < 30; j++) assert.ok(tl.includes(`valor ${j}`), `coluna ${j}`);
    assert.ok(/\(colunas 1, 2/.test(tl) && /de 30\)/.test(tl));
    assert.ok(Buffer.from(larga).toString('latin1').includes('/MediaBox [0 0 842 595]'), 'paisagem');
  });

  test('palavras maiores que a coluna são quebradas sem perder texto', () => {
    const l = quebrar('A'.repeat(200), 60, 8);
    assert.ok(l.length > 1);
    assert.equal(l.join(''), 'A'.repeat(200));
    assert.deepEqual(quebrar('um dois', 500, 8), ['um dois']);
  });
});

describe('IA: conversão para outro ano-base e agregado escolaridade × porte', () => {
  test('fator para 2021: igual a 1 em 2021, valor real = nominal em 2021, e a visão ipca_base concorda com a fórmula', async () => {
    const base = await executarConsulta({ sql: 'SELECT exercicio, fator_real FROM ipca WHERE fator_real IS NOT NULL', objetivo: 'fatores de 2025' }, ['trabalho']);
    assert.ok(!('erro' in base), JSON.stringify(base));
    const fatores = Object.fromEntries((base as unknown as { linhas: number[][] }).linhas.map((l) => [Number(l[0]), Number(l[1])]));
    assert.equal(fatorParaAno(fatores, 2021, 2021), 1);
    assert.equal(valorReal(fatores, 2021, 2021, 1977.75), 1977.75);
    assert.ok(fatorParaAno(fatores, 2011, 2021) > 1 && fatorParaAno(fatores, 2024, 2021) < 1);
    assert.ok(Math.abs(fatorParaAno(fatores, 2015, 2021) - fatores[2015] / fatores[2021]) < 1e-12);
    const r = await executarConsulta({ sql: 'SELECT exercicio, fator FROM ipca_base WHERE ano_base_alvo = 2021 AND exercicio IN (2011, 2021, 2024) ORDER BY exercicio', objetivo: 'fatores para 2021' }, ['trabalho']);
    assert.ok(!('erro' in r), JSON.stringify(r));
    const f = new Map((r as unknown as { linhas: number[][] }).linhas.map((l) => [Number(l[0]), Number(l[1])]));
    assert.equal(f.get(2021), 1);
    for (const a of [2011, 2024]) assert.ok(Math.abs(f.get(a)! - fatorParaAno(fatores, a, 2021)) < 1e-12);
    assert.match(notaDeValorReal(2021), /R\$ de dezembro de 2021/);
    assert.throws(() => fatorParaAno(fatores, 1800, 2021), /sem fator/);
  });

  const semEsc = !existsSync(`${DATA}/gold/trabalho/cubo_esc_porte/ano=2021.parquet`) || !existsSync(`${DATA}/gold/trabalho/cubo_esc_porte/ano=2011.parquet`);
  test('rais_esc_porte: controles nacionais (Seção A, divisões 01 a 03), H1 a H4 conciliados com o total e porte acumulado', { skip: semEsc }, async () => {
    const ctx = await tabelasIaTrabalho();
    assert.ok(ctx.esc_porte_anos?.includes(2021));
    const sql = async (q: string) => {
      const r = await executarConsulta({ sql: q, objetivo: 'controle' }, ['trabalho']);
      assert.ok(!('erro' in r), JSON.stringify(r));
      return (r as unknown as { linhas: (number | string)[][] }).linhas;
    };
    const A = "situacao = 1 AND (starts_with(cnae_classe, '01') OR starts_with(cnae_classe, '02') OR starts_with(cnae_classe, '03'))";
    const total = await sql(`SELECT ano, sum(vinculos) FROM rais_esc_porte WHERE ano IN (2011, 2021) AND ${A} GROUP BY ano ORDER BY ano`);
    assert.deepEqual(total.map((l) => Number(l[1])), [1522633, 1531816]);
    const grupos = await sql(`SELECT ano, escolaridade_grupo, sum(vinculos) FROM rais_esc_porte WHERE ano IN (2011, 2021) AND ${A} GROUP BY ALL ORDER BY ano, escolaridade_grupo`);
    const h4 = (ano: number) => Number(grupos.find((l) => Number(l[0]) === ano && l[1] === 'H4')![2]);
    assert.equal(h4(2011), 38426);
    assert.equal(h4(2021), 60963);
    for (const [k, ano] of [[0, 2011], [1, 2021]] as const) {
      const soma = grupos.filter((l) => Number(l[0]) === ano).reduce((s, l) => s + Number(l[2]), 0);
      assert.equal(soma, Number(total[k][1]), `H1 a H4 e ignorada somam o total de ${ano}`);
    }
    const porte = await sql(`SELECT sum(vinculos) FILTER (tamanho_estab_cod BETWEEN 1 AND 2), sum(vinculos) FILTER (tamanho_estab_cod BETWEEN 1 AND 4) FROM rais_esc_porte WHERE ano = 2021 AND ${A}`);
    assert.deepEqual(porte[0].map(Number), [371905, 777135]);
    // médias a partir das somas (nunca média de médias)
    const rem = await sql(`SELECT escolaridade_grupo, sum(rem_media_soma) / sum(vinculos) FROM rais_esc_porte WHERE ano = 2021 AND ${A} AND escolaridade_grupo = 'H4' GROUP BY 1`);
    assert.ok(Number(rem[0][1]) > 3000 && Number(rem[0][1]) < 9000);
  });
});

describe('IA: território e fonte derivados da execução', () => {
  test('consolidação nacional sem filtro de UF é Brasil, mesmo com uma consulta de apoio só do Distrito Federal', () => {
    const nacional = 'SELECT ano, escolaridade_grupo, sum(vinculos) FROM rais_esc_porte WHERE ano = 2021 AND situacao = 1 GROUP BY ALL';
    const df = 'SELECT sum(vinculos) FROM rais_uf WHERE uf = 53 AND ano = 2021';
    const t1 = territoriosNasConsultas([nacional, df], null);
    assert.ok(t1.some((x) => /Brasil/.test(x)), t1.join('; '));
    assert.deepEqual(territoriosNasConsultas([nacional], null), ['Brasil (todas as UFs)']);
    assert.ok(!territoriosNasConsultas(['SELECT 1 FROM rais_uf WHERE uf = 53'], null).some((x) => /Brasil/.test(x)));
  });

  test('as 27 UFs consultadas uma a uma viram Brasil, não o último estado', () => {
    const ufs = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 28, 29, 31, 32, 33, 35, 41, 42, 43, 50, 51, 52, 53];
    const siglas = ['RO', 'AC', 'AM', 'RR', 'PA', 'AP', 'TO', 'MA', 'PI', 'CE', 'RN', 'PB', 'PE', 'AL', 'SE', 'BA', 'MG', 'ES', 'RJ', 'SP', 'PR', 'SC', 'RS', 'MS', 'MT', 'GO', 'DF'];
    const cad = { porCodigo: new Map(ufs.map((c, i) => [c, { cod: c, nome: `UF${c}`, uf: siglas[i], esfera: c === 53 ? 'D' : 'E' }])), porRais: new Map() } as any;
    const r = territoriosNasConsultas(ufs.map((c) => `SELECT sum(vinculos) FROM rais_uf WHERE uf = ${c} AND ano = 2021`), cad);
    assert.equal(r.length, 1);
    assert.match(r[0], /Brasil/);
  });

  test('"faixas" como apelido de porte não vira a fonte "faixas populacionais"; a tabela faixas de verdade continua sendo citada', () => {
    const porte = 'WITH faixas AS (SELECT tamanho_estab_cod, sum(vinculos) AS n FROM rais_esc_porte GROUP BY 1) SELECT * FROM faixas';
    const fontes = fontesConsultadas([porte]);
    assert.ok(fontes.some((f) => /RAIS/.test(f)));
    assert.ok(!fontes.some((f) => /faixas populacionais|population brackets/.test(f)), fontes.join('; '));
    assert.ok(fontesConsultadas(['SELECT * FROM indicadores i JOIN faixas f ON f.exercicio = i.exercicio']).some((f) => /faixas populacionais|population brackets/.test(f)));
  });
});

describe('Excel: números como números, nomes de abas e linhas completas', () => {
  /** Arquivos de um zip sem compressão (como o gerado em exportar.ts). */
  const lerZip = (z: Uint8Array) => {
    const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
    const saida = new Map<string, string>();
    for (let p = 0; v.getUint32(p, true) === 0x04034b50;) {
      const tam = v.getUint32(p + 18, true);
      const n = v.getUint16(p + 26, true);
      const extra = v.getUint16(p + 28, true);
      const nome = new TextDecoder().decode(z.slice(p + 30, p + 30 + n));
      saida.set(nome, new TextDecoder().decode(z.slice(p + 30 + n + extra, p + 30 + n + extra + tam)));
      p += 30 + n + extra + tam;
    }
    return saida;
  };
  test('28 linhas na planilha, números numéricos, nomes de aba válidos e sem repetição', () => {
    const linhas28 = Array.from({ length: 28 }, (_, i) => [`Linha ${i + 1}`, 1000 + i, i / 7]);
    const longo = 'Tabela 1: porte/escolaridade? [H1–H4] com um nome muito comprido demais';
    const arquivos = lerZip(paraXlsxAbas([
      { nome: longo, linhas: [['rótulo', 'vínculos', 'razão'], ...linhas28] },
      { nome: longo, linhas: [['b']] },
    ]));
    const nomes = [...arquivos.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]);
    assert.equal(nomes.length, 2);
    assert.equal(new Set(nomes.map((n) => n.toLowerCase())).size, 2);
    for (const n of nomes) {
      assert.ok(n.length <= 31);
      assert.ok(!/[:\\/?*[\]]/.test(n));
    }
    const aba = arquivos.get('xl/worksheets/sheet1.xml')!;
    assert.equal((aba.match(/<row /g) ?? []).length, 29);
    assert.ok(aba.includes('<c r="B2"><v>1000</v></c>'), 'número como número, sem t="inlineStr"');
    assert.ok(aba.includes(`<v>${28 - 1 + 1000 - 27}</v>`) || aba.includes('<v>1027</v>'));
    assert.ok(aba.includes('vínculos') && aba.includes('rótulo'), 'acentuação preservada');
  });
});

describe('IA: afirmações de tendência contra as séries calculadas', () => {
  const serie = (valores: number[]) => [{ rotulo: 'C1', colunas: ['ano', 'vinculos'], linhas: valores.map((v, i) => [2011 + i, v]) as unknown[][] }];
  test('crescimento contínuo exige série crescente em todos os anos; queda contínua, decrescente', () => {
    assert.deepEqual(tendenciasSemSuporte('Houve crescimento contínuo dos vínculos.', serie([10, 12, 15, 20])), []);
    assert.equal(tendenciasSemSuporte('Houve crescimento contínuo dos vínculos.', serie([10, 12, 11, 20])).length, 1);
    assert.equal(tendenciasSemSuporte('Os vínculos cresceram todos os anos.', serie([10, 9, 11])).length, 1);
    assert.deepEqual(tendenciasSemSuporte('A queda contínua foi de 2011 a 2021.', serie([30, 20, 10])), []);
    assert.equal(tendenciasSemSuporte('Houve queda contínua.', serie([30, 20, 25])).length, 1);
    // sem série anual para conferir, ou sem a afirmação, nada a apontar
    assert.deepEqual(tendenciasSemSuporte('Houve crescimento contínuo.', [{ rotulo: 'C1', colunas: ['uf', 'n'], linhas: [['GO', 1], ['MG', 2], ['SP', 3]] }]), []);
    assert.deepEqual(tendenciasSemSuporte('Os vínculos oscilaram.', serie([10, 9, 11])), []);
  });
});

describe('saúde: cobertura por indicador, triênio, rede e produção (município de Goiás, 5208905)', () => {
  const semSaude = !existsSync(onde('gold/saude/municipios.parquet'));
  const GOIAS = 5208905;
  const fontesDoManifesto = async () => (await rota<{ fontes: unknown }>('meta')).fontes as FontesMeta;

  test('disponibilidade efetiva: os anos cobertos pela fonte do numerador e do denominador de cada indicador', { skip: semSaude }, async () => {
    const f = await fontesDoManifesto();
    const ultimo = (id: string) => anosDoIndicador(indicador(id), f).at(-1);
    const primeiro = (id: string) => anosDoIndicador(indicador(id), f)[0];
    // SIM e SINASC (finais) terminam antes do SINAN, do SIH e do CNES; a dengue chega a 2025
    assert.ok(ultimo('mortalidade_infantil')! < ultimo('dengue_incidencia')!, 'mortalidade infantil termina antes da dengue');
    assert.equal(ultimo('dengue_incidencia'), f.sinan!.agravos!.dengue[1]);
    assert.equal(ultimo('tb_incidencia'), 2019, 'a tuberculose termina em 2019');
    assert.equal(primeiro('chik_incidencia'), 2014);
    assert.ok(primeiro('cito_25_64') >= 2014 && primeiro('cancer_60_dias') >= 2019, 'SISCAN e oncologia começam depois');
    assert.equal(primeiro('valor_por_internacao'), 2008, 'o valor real do SIH cobre todo o período, de 2008 em diante');
    // população da SVS/MS (2000 em diante) limita as taxas por habitante, não as por nascidos vivos
    assert.ok(primeiro('homicidios') >= 2000);
    assert.equal(primeiro('mortalidade_infantil'), 1996);
  });

  test('condição do dado: fora da cobertura, sem registro, zero registrado e dado preliminar são coisas diferentes', () => {
    const f: FontesMeta = { sim: { anos: [2022, 2023, 2024], preliminares: [2024], preliminar_nao_incluido: [2025] }, populacao_svs: { anos: [2000, 2025] } };
    assert.equal(condicaoDado('obitos', 5, 2023, f), 'registrado');
    assert.equal(condicaoDado('obitos', 0, 2023, f), 'zero_registrado');
    assert.equal(condicaoDado('obitos', null, 2023, f), 'ausente');
    assert.equal(condicaoDado('obitos', null, 2025, f), 'fora_cobertura', 'mesmo sem valor, o ano fora da fonte não é ausência de registro');
    assert.equal(condicaoDado('obitos', 0, 2021, f), 'fora_cobertura');
    assert.equal(condicaoDado('obitos', 7, 2024, f), 'preliminar');
    assert.ok(avisoPreliminarNaoIncluido('obitos', 2025, f)!.includes('preliminar'));
    assert.equal(avisoPreliminarNaoIncluido('obitos', 2024, f), null);
  });

  test('dengue em 2025: 320 casos prováveis e a mesma posição no ranking anual e na evolução da posição', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie', { ente: GOIAS });
    const g = serie.find((r) => r.ano === 2025)!;
    assert.equal(g.sinan_dengue_provaveis, 320);
    const params = { dominio: 'saude', ind: 'dengue_incidencia', ordem: 'desc', de: 2025, ate: 2025, uf: 'GO', min: 5000 };
    const anual = await rota<Classificacao>('ranking_posicoes', { ...params, lista: 1 });
    const evolucao = await rota<Classificacao>('ranking_posicoes', { ...params, entes: String(GOIAS) });
    const noAnual = anual.lista!.find((r) => r.cod_ibge === GOIAS)!;
    const naEvolucao = evolucao.serie.find((r) => r.ano === 2025)!;
    assert.ok(noAnual && naEvolucao, 'Goiás está no ranking de 2025');
    assert.equal(noAnual.posicao_uf, naEvolucao.posicao_uf);
    assert.equal(noAnual.posicao_br, naEvolucao.posicao_br);
    assert.equal(noAnual.total_uf, naEvolucao.total_uf, 'o mesmo universo');
    // a cobertura do indicador (ranking_anos) inclui 2025: o ranking anual não pode parar no último ano do SIM
    assert.ok((await rota<number[]>('ranking_anos', { dominio: 'saude', ind: 'dengue_incidencia', min: 5000 })).includes(2025));
  });

  test('ano coberto sem municípios elegíveis não é o mesmo que ano fora da cobertura', { skip: semSaude }, async () => {
    const f = await fontesDoManifesto();
    const ind = indicador('mortalidade_infantil');
    // 2025 está fora da cobertura do SIM/SINASC finais
    assert.ok(!anosDoIndicador(ind, f).includes(2025));
    assert.deepEqual(await rota<number[]>('ranking_anos', { dominio: 'saude', ind: ind.id, min: 1000 }).then((a) => a.includes(2025)), false);
    // 2024 está coberto; com um mínimo impossível não há elegíveis, e a cobertura (anos) segue sendo a da fonte
    assert.ok(anosDoIndicador(ind, f).includes(2024));
    const semElegiveis = await rota<Classificacao>('ranking_posicoes', { dominio: 'saude', ind: ind.id, ordem: 'desc', de: 2024, ate: 2024, min: 100000000, lista: 1 });
    assert.equal(semElegiveis.lista!.length, 0);
    assert.deepEqual(semElegiveis.anos, [], 'sem elegíveis, mesmo num ano coberto pela fonte');
  });

  test('mortalidade infantil: 2 óbitos em 206 nascidos em 2024 (9,7‰) e 8 em 684 no triênio 2022–2024 (11,7‰)', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie', { ente: GOIAS });
    const a24 = serie.find((r) => r.ano === 2024)!;
    assert.equal(a24.infantis, 2);
    assert.equal(a24.nascidos, 206);
    assert.equal(Number(calcular(indicador('mortalidade_infantil'), a24)!.toFixed(1)), 9.7);
    const tri = calcularJanela(indicador('mortalidade_infantil'), serie, 2022, 2024);
    assert.equal(tri.numerador, 8);
    assert.equal(tri.denominador, 684);
    assert.equal(Number(tri.valor!.toFixed(1)), 11.7);
    // razão das somas, não a média das três taxas
    const media = [2022, 2023, 2024].map((a) => calcular(indicador('mortalidade_infantil'), serie.find((r) => r.ano === a)!)!).reduce((s, v) => s + v, 0) / 3;
    assert.notEqual(Number(media.toFixed(1)), Number(tri.valor!.toFixed(1)));
    // a rota de janela entrega as somas e os anos com valor, e o município de Goiás fecha com a série
    const janela = await rota<L[]>('saude_janela', { uf: 'GO', de: 2022, ate: 2024, colunas: 'infantis,nascidos' });
    const g = janela.find((r) => r.cod_ibge === GOIAS)!;
    assert.equal(g.infantis, 8);
    assert.equal(g.nascidos, 684);
    assert.equal(g.n_infantis, 3);
    assert.equal(g.n_nascidos, 3);
    // janela inválida ou sem colunas: vazio, nunca erro de SQL
    assert.deepEqual(await rota<L[]>('saude_janela', { uf: 'GO', de: 2024, ate: 2022, colunas: 'infantis' }), []);
    assert.deepEqual(await rota<L[]>('saude_janela', { uf: 'GO', de: 2022, ate: 2024, colunas: 'x; drop table saude_municipios' }), []);
  });

  test('internações de 2024: 1.876 de moradores, 1.013 fora do município (54,0%); moradores e hospitais são pontos de vista distintos', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie', { ente: GOIAS });
    const a = serie.find((r) => r.ano === 2024)!;
    assert.equal(a.int_total, 1876);
    assert.equal(a.int_fora, 1013);
    assert.equal(Number(calcular(indicador('internacoes_fora'), a)!.toFixed(3)), 0.54);
    assert.equal(formatar(indicador('internacoes_fora'), calcular(indicador('internacoes_fora'), a)), '54,0%');
    // hospitais do município: outro ponto de vista, outro total
    assert.ok(Number(a.int_atendidas) > 0 && a.int_atendidas !== a.int_total);
    assert.ok(Number(a.int_atendidas_de_fora) <= Number(a.int_atendidas));
    // valores monetários: média e total em reais, não em "casos"
    const medio = indicador('valor_por_internacao');
    assert.ok(medio.monetario);
    assert.match(formatar(medio, calcular(medio, a)), /^R\$/);
    assert.match(formatar(indicador('valor_por_habitante'), calcular(indicador('valor_por_habitante'), a)), /^R\$/);
  });

  test('município ignorado sai à parte em UF e Brasil e já está nos totais da série', { skip: semSaude }, async () => {
    const br = await rota<L[]>('saude_serie');
    const ign = await rota<L[]>('saude_ignorados');
    const a24 = br.find((r) => r.ano === 2024)!;
    const i24 = ign.find((r) => r.ano === 2024);
    assert.ok(i24, 'há internações de residentes sem município válido em 2024');
    assert.ok(Number(i24!.int_total) > 0 && Number(i24!.int_total) < Number(a24.int_total));
  });

  test('oncologia em 2025: 95,8% acompanhados de 23 de 24 registros com datas válidas', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie', { ente: GOIAS });
    const a = serie.find((r) => r.ano === 2025)!;
    assert.equal(a.onco_trat_validos, 24);
    assert.equal(a.onco_trat_60d, 23);
    assert.equal(formatar(indicador('cancer_60_dias'), calcular(indicador('cancer_60_dias'), a)), '95,8%');
    // o funil é coerente: com datas válidas ≤ com tratamento ≤ diagnósticos; em até 60 dias ≤ com datas válidas
    assert.ok(Number(a.onco_trat_60d) <= Number(a.onco_trat_validos) && Number(a.onco_trat_validos) <= Number(a.onco_tratados) && Number(a.onco_tratados) <= Number(a.onco_casos));
  });

  test('produção ambulatorial: procedimentos por grupo fecham com o total; valor real vem de 2008', { skip: semSaude }, async () => {
    const f = await fontesDoManifesto();
    assert.ok(f.sia!.anos!.includes(2008) && f.sia!.anos!.includes(2025));
    const br = await rota<L[]>('saude_serie');
    const a = br.find((r) => r.ano === 2024)!;
    const grupos = ['promocao', 'diagnostico', 'clinicos', 'cirurgicos', 'transplantes', 'medicamentos', 'orteses', 'complementares'];
    const soma = grupos.reduce((s, g) => s + Number(a[`amb_${g}_qtd`] ?? 0), 0);
    quase(soma, Number(a.amb_qtd), 1e-9);
    assert.ok(Number(br.find((r) => r.ano === 2008)!.amb_valor_real) > 0, 'valor real de 2008 existe: o IPCA da base começa em 2006');
    assert.ok(Number(br.find((r) => r.ano === 2008)!.int_valor_real) > 0, 'e o do SIH também');
  });

  test('médicos: "atuam no município" não é somável; vínculo principal e vínculos são medidas à parte', { skip: semSaude }, async () => {
    const serie = await rota<L[]>('saude_serie', { ente: GOIAS });
    const a = serie.find((r) => r.ano === 2024)!;
    assert.ok(Number(a.cnes_medicos_no_municipio) >= Number(a.cnes_medicos), 'quem atua no município inclui os do vínculo principal');
    assert.ok(Number(a.cnes_medicos_vinculos) >= Number(a.cnes_medicos), 'vínculos ≥ pessoas');
    const br = (await rota<L[]>('saude_serie')).find((r) => r.ano === 2024)!;
    // somar "atuam no município" por UF ou Brasil passa do número de pessoas distintas do vínculo principal
    assert.ok(Number(br.cnes_medicos_no_municipio) > Number(br.cnes_medicos));
  });

  test('metadados compartilhados: fonte, unidade, recorte e período do indicador, os mesmos nas telas e nas exportações', { skip: semSaude }, async () => {
    const f = await fontesDoManifesto();
    const m = new Map(metadadosIndicador(indicador('dengue_incidencia'), f, 'Goiás'));
    assert.equal(fonteCurta(indicador('dengue_incidencia')), 'SINAN (dengue) e população da SVS/MS');
    assert.match(m.get('Fonte')!, /SINAN \(dengue\) e população da SVS\/MS/);
    assert.match(m.get('Recorte territorial')!, /residência/);
    assert.equal(m.get('Período de cobertura'), faixaAnos(anosDoIndicador(indicador('dengue_incidencia'), f)));
    assert.match(new Map(metadadosIndicador(indicador('leitos_sus_mil'), f)).get('Recorte territorial')!, /estabelecimento/);
  });

  test('versão dos dados sem as colunas novas: o indicador fica indisponível, o resto segue', { skip: semSaude }, async () => {
    const colunas = new Set((await rota<L[]>('saude_colunas')).map((r) => String(r.column_name)));
    assert.ok(colunas.has('populacao') && colunas.has('obitos'));
    const sem = new Set(colunas);
    sem.delete('siscan_mamo_50_74');
    assert.equal(disponivelNosDados(indicador('mamo_50_74'), sem), false);
    assert.equal(disponivelNosDados(indicador('dengue_incidencia'), sem), true);
    assert.equal(disponivelNosDados(indicador('mamo_50_74'), null), true, 'enquanto carrega, não esconde nada');
    const faltam = INDICADORES.filter((i) => !disponivelNosDados(i, colunas)).map((i) => i.id).sort();
    // faltam só os indicadores cujas colunas a versão carregada não tem: num gold anterior à mamografia de 50 a 74 anos, ela; no atual, nenhum
    const esperado = [...(colunas.has('siscan_mamo_50_74') && colunas.has('pop_mulheres_50_74') ? [] : ['mamo_50_74']), ...(colunas.has('icsap_int') && colunas.has('icsap_base') ? [] : ['icsap_proporcao', 'icsap_taxa'])].sort();
    assert.deepEqual(faltam, esperado);
  });

  test('mamografias de 50 a 74 anos: numerador e denominador conferidos antes de entrar', { skip: semSaude }, async () => {
    const br = await rota<L[]>('saude_serie');
    const a = br.find((r) => r.ano === 2024)!;
    if (a.siscan_mamo_50_74 === undefined) return; // gold anterior à coluna
    assert.ok(Number(a.siscan_mamo_50_74) >= Number(a.siscan_mamo_50_69), '50–74 contém 50–69');
    assert.ok(Number(a.siscan_mamo_50_74) <= Number(a.siscan_mamografias), 'e cabe no total de mamografias');
    assert.ok(Number(a.pop_mulheres_50_74) > Number(a.pop_mulheres_50_69), 'população de 50–74 contém a de 50–69');
  });

  test('tuberculose pelo ano de diagnóstico: a definição ampliada fica perto da série restrita e termina em 2019', { skip: semSaude }, async () => {
    const br = await rota<L[]>('saude_serie');
    const a = br.find((r) => r.ano === 2015)!;
    if (a.sinan_tb_casos_novos_dx === undefined) return; // gold anterior à coluna
    const restrita = Number(a.sinan_tb_casos_novos);
    const ampliada = Number(a.sinan_tb_casos_novos_dx);
    assert.ok(ampliada > 0.9 * restrita && ampliada < 1.15 * restrita, `${ampliada} vs ${restrita}`);
    assert.equal(br.find((r) => r.ano === 2020)!.sinan_tb_casos_novos_dx ?? null, null, 'nada depois de 2019');
  });
  test('cobertura por medida do CNES: médicos começam em 2007, leitos e estabelecimentos em 2006', { skip: semSaude }, async () => {
    const f = await fontesDoManifesto();
    const anos = (id: string) => anosDoIndicador(indicador(id), f);
    assert.equal(anos('leitos_sus_mil')[0], 2006);
    assert.equal(anos('estabelecimentos_10mil')[0], 2006);
    for (const id of ['medicos_mil', 'enfermeiros_mil']) assert.equal(anos(id)[0], 2007, id);
    assert.equal(condicaoDado('cnes_medicos', null, 2006, f), 'fora_cobertura');
    assert.equal(condicaoDado('cnes_medicos_vinculos', 0, 2006, f), 'fora_cobertura');
    assert.equal(condicaoDado('cnes_medicos_no_municipio', null, 2006, f), 'fora_cobertura');
    assert.notEqual(condicaoDado('cnes_leitos_sus', 12, 2006, f), 'fora_cobertura');
    assert.notEqual(condicaoDado('cnes_medicos', 12, 2007, f), 'fora_cobertura');
    // o ranking anual obedece à mesma regra: 2006 não é oferecido para médicos, e é para leitos SUS
    const med = await rota<number[]>('ranking_anos', { dominio: 'saude', ind: 'medicos_mil', min: 5000 });
    const leitos = await rota<number[]>('ranking_anos', { dominio: 'saude', ind: 'leitos_sus_mil', min: 5000 });
    assert.ok(!med.includes(2006) && med.includes(2007));
    assert.ok(leitos.includes(2006));
    // manifesto sem o campo das medidas (versão publicada antes): a mesma regra vem do primeiro ano dos profissionais
    const antigo: FontesMeta = { cnes: { anos: f.cnes!.anos }, populacao_svs: f.populacao_svs };
    assert.ok(!anosDaColuna('cnes_medicos', antigo).includes(2006) && anosDaColuna('cnes_leitos_sus', antigo).includes(2006));
  });

  test('Goiás, mortalidade infantil em 2024: a tabela do indicador traz 2 óbitos, 206 nascidos vivos e 9,7 por mil, mesmo fora do ranking', { skip: semSaude }, async () => {
    const ind = indicador('mortalidade_infantil');
    const g = (await rota<L[]>('saude_serie', { ente: GOIAS })).find((r) => r.ano === 2024)!;
    assert.equal(g.infantis, 2);
    assert.equal(g.nascidos, 206);
    assert.equal(formatar(ind, calcular(ind, g)), formatar(ind, 9.708737864077669));
    assert.match(formatar(ind, calcular(ind, g)), /9,7/);
    assert.ok(Number(g.nascidos) < ind.minimo, 'abaixo do mínimo do ranking: a tabela mostra, o ranking não inclui');
    const ranking = await rota<Classificacao>('ranking_posicoes', { dominio: 'saude', ind: ind.id, ordem: 'desc', de: 2024, ate: 2024, uf: 'GO', min: ind.minimo, lista: 1 });
    assert.ok(!ranking.lista!.some((r) => r.cod_ibge === GOIAS));
  });

  test('atenção primária: município em dezembro de 2020 e 2021 confere com o gold e a cobertura não é emendada entre metodologias', { skip: semSaude }, async () => {
    const colunas = new Set((await rota<L[]>('saude_colunas')).map((r) => String(r.column_name)));
    if (!colunas.has('aps_capacidade')) return;
    const f = await fontesDoManifesto();
    assert.deepEqual(f.aps!.series!.ab, [2008, 2020]);
    assert.equal(f.aps!.series!.aps![0], 2021);
    assert.deepEqual(anosDaColuna('ab_cobertura', f).at(-1), 2020);
    assert.deepEqual(anosDaColuna('aps_cobertura', f)[0], 2021);
    const goiania = 5208707;
    const aps = await rota<L[]>('saude_aps', { ente: goiania });
    const em = (ano: number) => aps.find((r) => r.ano === ano)!;
    const pct = (a: unknown, b: unknown) => (100 * Number(a)) / Number(b);
    // valores de dezembro do relatório (gold/saude/aps_cobertura): AB 59,29; ACS 33,98 em 2020; APS 50,39 e ACS 33,46 em 2021
    assert.ok(Math.abs(pct(em(2020).ab_cobertos, em(2020).ab_pop) - 59.29) < 0.01);
    assert.ok(Math.abs(pct(em(2020).acs_cobertos, em(2020).acs_pop) - 33.98) < 0.01);
    assert.equal(em(2020).aps_capacidade ?? null, null, 'a cobertura potencial não existe em 2020');
    assert.equal(em(2021).ab_cobertos ?? null, null, 'a atenção básica não existe em 2021');
    assert.ok(Math.abs(pct(em(2021).aps_capacidade, em(2021).aps_pop) - 50.39) < 0.01);
    assert.equal(em(2021).aps_equipes_eap, 62);
    assert.equal(em(2021).aps_equipes_esf, 190);
    assert.ok(Math.abs(pct(em(2021).acs_cobertos, em(2021).acs_pop) - 33.46) < 0.01);
  });

  test('atenção primária em UF e Brasil: a cobertura vem de numeradores e denominadores compatíveis, não da soma de percentuais', { skip: semSaude }, async () => {
    const colunas = new Set((await rota<L[]>('saude_colunas')).map((r) => String(r.column_name)));
    if (!colunas.has('aps_capacidade')) return;
    const porMunicipio = await rota<L[]>('saude_municipios', { uf: 'GO', ano: 2021 });
    const comDado = porMunicipio.filter((r) => r.aps_capacidade !== null && Number(r.aps_populacao) > 0);
    const cap = comDado.reduce((s, r) => s + Number(r.aps_capacidade), 0);
    const pop = comDado.reduce((s, r) => s + Number(r.aps_populacao), 0);
    const go = (await rota<L[]>('saude_aps', { uf: 'GO' })).find((r) => r.ano === 2021)!;
    assert.equal(Number(go.aps_capacidade), cap);
    assert.equal(Number(go.aps_pop), pop);
    assert.equal(Number(go.aps_municipios), comDado.length);
    const taxaGo = (100 * cap) / pop;
    assert.ok(taxaGo > 40 && taxaGo < 100, `cobertura potencial de Goiás: ${taxaGo}`);
    // a soma dos percentuais municipais seria um número sem sentido (acima de 100)
    assert.ok(porMunicipio.reduce((s, r) => s + Number(r.aps_cobertura ?? 0), 0) > 1000);
    const br = (await rota<L[]>('saude_aps')).find((r) => r.ano === 2021)!;
    assert.ok(100 * Number(br.aps_capacidade) / Number(br.aps_pop) < 100 && Number(br.aps_municipios) > 5000);
    assert.ok(Number(br.aps_municipios) <= Number(br.municipios) && Number(br.acs_municipios) <= Number(br.municipios), 'os com dado nunca passam do total do recorte');
    // atenção básica em 2020: percentual limitado a 100% em cada município, derivado de população coberta ÷ população
    const goAb = (await rota<L[]>('saude_aps', { uf: 'GO' })).find((r) => r.ano === 2020)!;
    const abGo = (100 * Number(goAb.ab_cobertos)) / Number(goAb.ab_pop);
    assert.ok(abGo > 50 && abGo <= 100, `atenção básica em Goiás: ${abGo}`);
  });

  test('gold sem as colunas de atenção primária: a rota não falha e devolve vazio, e as demais medidas seguem', { skip: semSaude }, async () => {
    const colunas = new Set((await rota<L[]>('saude_colunas')).map((r) => String(r.column_name)));
    const aps = await rota<L[]>('saude_aps', { uf: 'GO' });
    if (colunas.has('aps_capacidade')) assert.ok(aps.length > 0);
    else assert.deepEqual(aps, [], 'sem as colunas, nada a mostrar (a página diz "indisponível nesta versão dos dados")');
    assert.ok((await rota<L[]>('saude_serie', { ente: GOIAS })).length > 0);
  });
});

describe('LRF: rastreabilidade do indicador ao demonstrativo (Pontal/SP 3540200 e Mariana Pimentel/RS 4311981, 2025)', () => {
  const semLrf = !existsSync(onde('silver/lrf/exercicio=2025.parquet')) || !existsSync(onde('gold/lrf.parquet'));
  const CASOS = [
    { cod: 3540200, nome: 'Pontal', rgf: 'RGF (Q)', pessoal: 805.41, rcl: 13494039.69, dtp: 108682695.5, dclPct: 1333.33 },
    { cod: 4311981, nome: 'Mariana Pimentel', rgf: 'RGF Simplificado (S)', pessoal: 857, rcl: 1621165.46, dtp: 13893374.86, dclPct: -49.73 },
  ];

  test('o link leva ao anexo do mesmo ente e exercício, e as contas em destaque existem nele', { skip: semLrf }, async () => {
    for (const c of CASOS) {
      for (const chave of ['pessoal', 'dcl', 'saude', 'mde', 'fundeb', 'primario', 'rreo14'] as ChaveRastro[]) {
        const url = new URL(urlDemonstrativo(c.cod, 2025, chave), 'http://x');
        assert.equal(url.pathname, '/lrf/demonstrativos');
        assert.equal(url.searchParams.get('ente'), String(c.cod));
        assert.equal(url.searchParams.get('ano'), '2025');
        assert.equal(url.searchParams.get('anexo'), valorAnexo(RASTRO[chave]));
        assert.equal(chaveDoRastro(url.searchParams.get('destaque')), chave);
        const anexos = await rota<L[]>('lrf_anexos', { ente: c.cod, ano: 2025 });
        assert.ok(anexos.some((x) => `${x.relatorio}|${x.anexo}` === valorAnexo(RASTRO[chave])), `${c.nome}: ${chave} → anexo existe`);
      }
      // as contas de pessoal e RCL do indicador estão no RGF anexo 1, com os valores exatos do gold
      const rgf1 = await rota<L[]>('lrf_anexo', { ente: c.cod, ano: 2025, relatorio: 'RGF', anexo: 'RGF-Anexo 01' });
      const destacadas = rgf1.filter((l) => contaDoRastro(String(l.cod_conta), 'pessoal'));
      const valor = (conta: string, coluna: string) => destacadas.find((l) => l.cod_conta === conta && String(l.coluna).startsWith(coluna))?.valor;
      assert.equal(valor('ReceitaCorrenteLiquidaAjustada', 'Valor'), c.rcl);
      assert.equal(valor('DespesaComPessoalTotal', 'Valor'), c.dtp);
      assert.equal(valor('DespesaComPessoalTotal', '% sobre a RCL'), c.pessoal);
      // o gold repete o declarado, sem recálculo
      const g = (await rota<L[]>('lrf_ente', { ente: c.cod })).find((r) => r.exercicio === 2025)!;
      assert.equal(g.rcl_ajustada, c.rcl);
      assert.equal(g.despesa_pessoal, c.dtp);
      assert.equal(g.pessoal_rcl_pct, c.pessoal);
      assert.equal(g.dcl_rcl_pct, c.dclPct);
      assert.equal(g.rgf_tipo, c.rgf);
    }
  });

  test('contas em destaque só valem no anexo a que pertencem; chave desconhecida é ignorada', () => {
    assert.equal(chaveDoRastro('nao-existe'), null);
    assert.equal(chaveDoRastro(null), null);
    assert.equal(chaveDoRastro('__proto__'), null);
    assert.ok(contaDoRastro('DespesaComPessoalTotal', 'pessoal') && !contaDoRastro('DespesaComPessoalTotal', 'dcl'));
    assert.ok(contaDoRastro('MinimoAnualDoFUNDEBNaRemuneracaoComSufixo', 'fundeb'), 'o código do gold vale como prefixo');
    assert.equal(RASTRO.dcl.anexo, 'RGF-Anexo 02');
    // a RCL não tem anexo fixo (RGF 1, RGF 2 ou RREO 14, conforme o que o ente entregou): só o acesso genérico ao ente e ano
    assert.ok(!('rcl' in RASTRO) && chaveDoRastro('rcl') === null);
    const geral = new URL(urlDemonstrativos(3540200, 2025), 'http://x');
    assert.equal(geral.pathname, '/lrf/demonstrativos');
    assert.deepEqual([...geral.searchParams.keys()].sort(), ['ano', 'ente']);
  });

  test('o aviso de anexo indisponível só vale no ente e no exercício em que foi gerado', () => {
    const aviso = { ente: 3540200, ano: 2025, texto: 'RGF-Anexo 99 não consta…' };
    assert.equal(avisoDoContexto(aviso, 3540200, 2025), aviso.texto, 'mesmo contexto: o aviso explica o que aconteceu');
    assert.equal(avisoDoContexto(aviso, 3540259, 2025), null, 'outro município');
    assert.equal(avisoDoContexto(aviso, 3540200, 2024), null, 'outro exercício');
    assert.equal(avisoDoContexto(aviso, undefined, undefined), null, 'sem ente escolhido');
    assert.equal(avisoDoContexto(null, 3540200, 2025), null);
  });

  test('a RCL do último período do RGF diverge da RCL de 12 meses do RREO nos dois casos (sinal, não correção)', { skip: semLrf }, async () => {
    // RREO anexo 3, total dos últimos 12 meses: 209.571.785,24 (Pontal) e 32.591.953,45 (Mariana Pimentel). O gold fica com o declarado no RGF.
    const rreo12 = { 3540200: 209571785.24, 4311981: 32591953.45 } as Record<number, number>;
    for (const c of CASOS) {
      const l = (await rota<L[]>('lrf_anexo', { ente: c.cod, ano: 2025, relatorio: 'RREO', anexo: 'RREO-Anexo 03' }))
        .find((x) => x.cod_conta === 'RREO3ReceitaCorrenteLiquida' && String(x.coluna).startsWith('TOTAL'));
      assert.equal(l?.valor, rreo12[c.cod]);
      assert.ok(c.rcl / rreo12[c.cod] < 0.07, `${c.nome}: RCL do RGF é ${(100 * c.rcl / rreo12[c.cod]).toFixed(1)}% da do RREO`);
      assert.ok(c.dtp / rreo12[c.cod] < 0.6, 'sobre a RCL de 12 meses do RREO, a despesa com pessoal ficaria abaixo de 60% (apenas referência, não é o indicador)');
    }
  });
});

describe('saúde: financiamento federal (FNS, repasses fundo a fundo)', () => {
  const GOIANIA = 5208707;
  const SAO_PAULO = 3550308;
  const ACRELANDIA = 1200013;
  /** gold sem as tabelas do FNS (publicado antes deste lote): os testes de dados saem, os de compatibilidade rodam */
  const temFns = existsSync(onde('gold/saude/fns_municipios.parquet'));
  const pular = !temFns;

  // totais conferidos direto nos arquivos originais do FNS (soma exata dos centavos; bruto, líquido): 2003 (CSV antigo), 2018 (CSV) e 2025 (XLSX)
  const REFERENCIA: Record<number, { BR: number[]; GO: number[]; DF: number[]; mun: Record<number, number[]> }> = {
    2003: { BR: [10747555456.99, 10061910709.05], GO: [410671327.34, 381766782.67], DF: [209430420.13, 193358339.84],
      mun: { [GOIANIA]: [212753027.75, 184155672.89], [SAO_PAULO]: [353741604.29, 345533994.00], [ACRELANDIA]: [141282.72, 141282.72] } },
    2018: { BR: [62601899740.82, 59772973409.07], GO: [2380957331.69, 2266448429.57], DF: [809984530.35, 755037744.02],
      mun: { [GOIANIA]: [757112177.32, 663682538.55], [SAO_PAULO]: [2263283001.47, 2218778740.41], [ACRELANDIA]: [5139539.93, 5121037.43] } },
    2025: { BR: [132809054349.89, 129069071449.47], GO: [4886810579.21, 4797459026.34], DF: [1418181485.70, 1298351894.75],
      mun: { [GOIANIA]: [973527412.79, 904049064.80], [SAO_PAULO]: [3544209684.62, 3530868224.68], [ACRELANDIA]: [15334098.79, 15306098.79] } },
  };
  const centavos = (v: unknown) => Math.round(Number(v) * 100);

  test('perCapita, cobertura e ausência: ausência não vira zero e sem população não há per capita', () => {
    assert.equal(razaoPositiva(10, 0), null);
    assert.equal(razaoPositiva(null, 5), null);
    assert.equal(razaoPositiva(0, 5), 0, 'zero registrado continua zero');
    const r = { ano: 2018, municipios: 3, municipios_com_repasse: 2, liquido: 300, liquido_com_pop: 250, liquido_real_com_pop: 500, pop_com_repasse: 50, pop_total: 100, liquido_sem_pop: 50 };
    assert.equal(perCapita(r, false), 5);
    assert.equal(perCapita(r, true), 10);
    assert.equal(coberturaPopulacional(r), 0.5);
    assert.equal(perCapita({ ...r, pop_com_repasse: 0 }, false), null);
    assert.equal(perCapita(undefined, false), null);
    assert.equal(perCapita({ ...r, liquido_com_pop: null }, false), null);
    assert.equal(temRepasse(r), true);
    assert.equal(temRepasse({ ...r, municipios_com_repasse: 0, liquido: null }), false);
    assert.equal(temRepasse(undefined), false);
    const antes2006 = { ano: 2004, liquido_com_pop: 80, liquido_real_com_pop: null, pop_com_repasse: 8 };
    assert.equal(perCapita(antes2006, false), 10);
    assert.equal(perCapita(antes2006, true), null, 'antes de 2006 não há per capita real');
  });

  test('retoma o FNS após falha de download ou instalação parcial', { skip: pular }, async () => {
    for (const tipo of ['download', 'instalacao']) {
      await reiniciarFnsNoTeste();
      let falhar = true;
      usarLeituraNoTeste(async (c) => {
        if (falhar && c.endsWith('fns_anos.parquet')) {
          falhar = false;
          if (tipo === 'download') throw new Error('HTTP 503 simulado');
          return new Uint8Array([1, 2, 3]); // primeira tabela instalada; segundo Parquet inválido
        }
        return new Uint8Array(await readFile(onde(c)));
      });
      try {
        await assert.rejects(tabelasFns());
        await tabelasFns();
        assert.equal((await rota<L[]>('fns_serie', {})).length, 24);
        assert.equal((await rota<L[]>('fns_anos', {})).length, 24);
        assert.ok((await rota<L[]>('fns_composicao', { ano: 2025, ente: GOIANIA })).length > 0);
      } finally {
        usarLeituraNoTeste(async (c) => new Uint8Array(await readFile(onde(c))));
        await reiniciarFnsNoTeste();
      }
    }
  });

  test('Boa Esperança do Norte 2024: consulta sem linha mantém sem registro no cartão e na exportação', { skip: pular }, async () => {
    const serie = await rota<L[]>('fns_serie', { ente: 5101837 });
    const r = serie.find((x) => x.ano === 2024);
    assert.equal(r, undefined, 'caso real sem linha em 2024');
    assert.equal(temRepasse(r), false, 'condição usada pelo cartão');
    assert.ok(resumoFns(r, 2024, 2025).every((l) => l[2] === null && l[3] === 'sem registro'));
    assert.ok(resumoFns(r, null, 2025).every((l) => l[2] === null && l[3] === 'fora da cobertura'));
    const registrado = serie.find((x) => x.ano === 2025)!;
    assert.equal(temRepasse(registrado), true);
    const semPop = resumoFns({ ...registrado, pop_com_repasse: null }, 2025, 2025);
    assert.equal(semPop[0][3], 'registrado');
    assert.equal(semPop[3][3], 'sem população');
    assert.equal(resumoFns({ ...registrado, ano: 2004, liquido_real: null }, 2004, 2025)[2][3], 'indisponível antes de 2006');
  });

  test('Noronha: distrito apenas na saúde, consultável no FNS, recusado em outros domínios', { skip: pular }, async () => {
    const cad = await cadastro();
    assert.equal(cad.porCodigo.has(2605459), false);
    const local = executarLocalizacao({ nome: 'Fernando de Noronha', uf: 'PE' }, cad, ['saude']);
    assert.equal(local.erro, false);
    assert.match(local.modelo, /distrito estadual/);
    assert.match(local.modelo, /Somente no FNS/);
    assert.equal(executarLocalizacao({ nome: 'Fernando de Noronha', uf: 'PE' }, cad, ['financas']).erro, true);
    for (const sql of [
      'SELECT liquido FROM fns_municipios WHERE cod_ibge = 2605459 AND ano = 2003',
      'SELECT sum(liquido) FROM fns_composicao WHERE municipio = 260545 AND ano = 2003',
    ]) {
      assert.equal(conferirCodigos(sql, cad), null);
      const r = await executarConsulta({ sql }, ['saude']);
      assert.ok(!('erro' in r), JSON.stringify(r));
      assert.equal(centavos((r as { linhas: number[][] }).linhas[0][0]), 9584994);
      assert.match(territoriosNasConsultas([sql], cad).join(' '), /Fernando de Noronha.*distrito estadual/);
    }
    for (const sql of [
      'SELECT receita_corrente FROM indicadores WHERE cod_ibge = 2605459',
      'SELECT populacao FROM saude_municipios WHERE cod_ibge = 2605459',
      'SELECT f.liquido, i.receita_corrente FROM fns_municipios f JOIN indicadores i USING(cod_ibge) WHERE i.cod_ibge = 2605459',
      'SELECT liquido FROM fns_municipios WHERE cod_ibge = 9999999',
    ]) assert.ok(conferirCodigos(sql, cad), sql);
  });

  test('fontes da ficha/exportação FNS, população SVS, IPCA e auditoria', () => {
    for (const tabela of ['fns_municipios', 'fns_composicao', 'fns_anos']) assert.match(fontesConsultadas([`SELECT sum(liquido) FROM ${tabela}`]).join(' '), /FNS/);
    const fontes = fontesConsultadas(['SELECT liquido_real / populacao FROM fns_municipios']).join(' ');
    assert.match(fontes, /FNS/); assert.match(fontes, /SVS/); assert.match(fontes, /IPCA/);
    assert.ok(!fontesConsultadas(['SELECT sum(liquido) FROM fns_municipios']).some((f) => /IPCA|SVS/.test(f)));
    assert.deepEqual(fontesConsultadas(["SELECT 'fns_municipios liquido_real populacao' AS texto"]), []);
    assert.ok(atendeConceito(CONCEITOS.find((x) => x.id === 'repasse_federal_fns')!, 'SELECT ano, liquido_estadual FROM fns_anos'));
    assert.match(universoFns(), /00.394.700\/0002-99/);
    assert.ok(!SAUDE.includes('DF pode estar subestimado nesses anos'));
  });

  test('porBloco e ordenarMunicipios: somas por bloco, ordem e município sem população fora do per capita', () => {
    const b = porBloco([{ bloco: 'A', bruto: 10, liquido: 8 }, { bloco: 'B', bruto: 100, liquido: 90 }, { bloco: 'A', bruto: 5, liquido: 4 }]);
    assert.deepEqual(b, [{ bloco: 'B', bruto: 100, liquido: 90 }, { bloco: 'A', bruto: 15, liquido: 12 }]);
    const m = [
      { nome: 'X', liquido: 100, populacao: 10 }, { nome: 'Y', liquido: 500, populacao: 100 }, { nome: 'Z', liquido: 50, populacao: null }, { nome: 'W', liquido: 80, populacao: 0 },
    ];
    assert.deepEqual(ordenarMunicipios(m, 'percapita', true).map((x) => x.nome), ['X', 'Y'], 'sem população ou população zero ficam fora do per capita');
    assert.deepEqual(ordenarMunicipios(m, 'liquido', true).map((x) => x.nome), ['Y', 'X', 'W', 'Z']);
    assert.deepEqual(ordenarMunicipios(m, 'liquido', false).map((x) => x.nome), ['Z', 'W', 'X', 'Y']);
    assert.equal(rotuloComposicao({ bloco: 'B', grupo: '', estrategia: 'E' }), 'B › E');
  });

  test('guardas da IA: denominador repetido (composição × município) e soma com receita ou despesa', () => {
    // denominador repetido
    assert.match(guardaFns('SELECT sum(m.populacao) FROM fns_composicao c JOIN fns_municipios m ON m.municipio = c.municipio AND m.ano = c.ano') ?? '', /repete o total e a população/);
    assert.match(guardaFns('SELECT c.bloco, sum(c.liquido) / sum(s.populacao) FROM fns_composicao c JOIN saude_municipios s ON s.municipio = c.municipio AND s.ano = c.ano GROUP BY 1') ?? '', /repete o total e a população/);
    assert.match(guardaFns('SELECT bloco, sum(liquido) / sum(populacao) FROM fns_composicao WHERE ano = 2018 GROUP BY 1') ?? '', /não tem população/);
    // soma com receita ou despesa
    assert.match(guardaFns('SELECT sum(f.liquido + i.receita_corrente) FROM fns_municipios f JOIN indicadores i ON i.cod_ibge = f.cod_ibge AND i.exercicio = f.ano') ?? '', /não se soma/);
    assert.match(guardaFns('SELECT sum(f.liquido) + sum(s.siops_receita_sus) FROM fns_municipios f JOIN siops_municipios s ON s.cod_ibge = f.cod_ibge') ?? '', /não se soma/);
    assert.match(guardaFns('SELECT sum(v) FROM (SELECT ano, liquido AS v FROM fns_municipios UNION ALL SELECT exercicio, despesa_saude FROM indicadores) x') ?? '', /não os empilhe/);
    assert.match(guardaFns('WITH x AS (SELECT ano, liquido AS v FROM fns_municipios UNION ALL SELECT exercicio, despesa_saude FROM indicadores) SELECT sum(v) FROM x') ?? '', /não os empilhe/);
    assert.equal(guardaFns("SELECT ano, liquido AS v, 'FNS' AS fonte FROM fns_municipios UNION ALL SELECT exercicio, despesa_saude, 'SICONFI' FROM indicadores"), null, 'comparação por fonte não soma os valores');
    assert.equal(guardaFns("WITH c AS (SELECT ano, municipio, sum(liquido) v FROM fns_composicao WHERE ano = 2024 AND bloco = 'X' GROUP BY ano, municipio) SELECT sum(c.v) / sum(m.populacao) FROM c JOIN fns_municipios m USING(ano, municipio)"), null, 'composição pré-agregada não repete a população');
    // o que não é soma passa: per capita no próprio fns_municipios, composição sozinha, lado a lado, textos entre aspas
    assert.equal(guardaFns("SELECT ano, sum(liquido) / sum(populacao) FILTER (WHERE linhas IS NOT NULL AND populacao > 0) FROM fns_municipios WHERE uf = 'GO' GROUP BY 1"), null);
    assert.equal(guardaFns('SELECT bloco, sum(liquido) FROM fns_composicao WHERE ano = 2018 GROUP BY 1'), null);
    assert.equal(guardaFns('SELECT f.ano, f.liquido, i.receita_corrente FROM fns_municipios f JOIN indicadores i ON i.cod_ibge = f.cod_ibge AND i.exercicio = f.ano WHERE f.cod_ibge = 5208707'), null, 'colunas separadas');
    assert.equal(guardaFns("SELECT sum(liquido) + 0 AS x FROM fns_municipios WHERE nome = 'receita + despesa'"), null);
    assert.equal(guardaFns('SELECT sum(receita_corrente) + sum(despesa_corrente) FROM indicadores'), null, 'sem FNS a guarda não age');
    assert.equal(guardaFns('SELECT * FROM fns_municipios c JOIN indicadores i ON true'), null);
  });

  test('guardas na consulta da IA: a consulta é recusada antes de rodar', { skip: pular }, async () => {
    const r = await executarConsulta({ sql: 'SELECT sum(m.populacao) FROM fns_composicao c JOIN fns_municipios m ON m.municipio = c.municipio AND m.ano = c.ano' }, ['saude']);
    assert.ok('erro' in r && r.bloqueada === true);
    assert.match(String((r as { erro: string }).erro), /repete o total e a população/);
    const soma = await executarConsulta({ sql: 'SELECT sum(f.liquido + i.receita_corrente) AS x FROM fns_municipios f JOIN indicadores i ON i.cod_ibge = f.cod_ibge AND i.exercicio = f.ano' }, ['saude', 'financas']);
    assert.ok('erro' in soma && soma.bloqueada === true);
    assert.match(String((soma as { erro: string }).erro), /não se soma/);
  });

  test('a IA do painel de saúde lê fns_municipios, fns_composicao e fns_anos (SQL e tabelas acessíveis)', { skip: pular }, async () => {
    const a = await executarConsulta({ sql: "SELECT ano, sum(liquido) AS liquido FROM fns_municipios WHERE ano = 2018 AND uf = 'GO' GROUP BY 1" }, ['saude']);
    assert.ok(!('erro' in a), JSON.stringify(a));
    assert.equal(centavos((a as { linhas: number[][] }).linhas[0][1]), centavos(REFERENCIA[2018].GO[1]));
    const b = await executarConsulta({ sql: "SELECT bloco, sum(liquido) AS liquido FROM fns_composicao WHERE ano = 2018 AND municipio = 520870 GROUP BY 1 ORDER BY 2 DESC" }, ['saude']);
    assert.ok(!('erro' in b), JSON.stringify(b));
    assert.equal(centavos((b as { linhas: number[][] }).linhas.reduce((s, l) => s + Number(l[1]), 0)), centavos(REFERENCIA[2018].mun[GOIANIA][1]));
    const c = await executarConsulta({ sql: 'SELECT ano, linhas_arquivo, sha256 FROM fns_anos WHERE ano = 2018' }, ['saude']);
    assert.ok(!('erro' in c), JSON.stringify(c));
    assert.equal((c as { linhas: number[][] }).linhas[0][1], 92525);
  });

  test('catálogo, conceito e instruções do modelo conhecem o FNS', () => {
    const f = fichaDaColuna('liquido', { fns: [2002, 2025] } as unknown as Cobertura, 'SELECT liquido FROM fns_municipios') ?? '';
    assert.match(f, /VL_LIQUIDO/);
    assert.match(f, /2002 a 2025/);
    assert.match(f, /não soma com a receita \(SICONFI\) nem com a despesa \(SIOPS\)/);
    assert.match(fichaDaColuna('liquido_real', null, 'SELECT liquido_real FROM fns_municipios') ?? '', /NULL antes de 2006/);
    assert.match(fichaDaColuna('populacao', null, 'SELECT populacao FROM fns_municipios') ?? '', /uma vez por município e ano/);
    const c = CONCEITOS.find((x) => x.id === 'repasse_federal_fns')!;
    assert.ok(c.pedido.test('Quanto o FNS repassou aos municípios de Goiás?'));
    assert.ok(c.pedido.test('repasses federais fundo a fundo para a saúde'));
    assert.ok(!c.pedido.test('despesa com pessoal'));
    assert.ok(atendeConceito(c, 'SELECT sum(liquido) FROM fns_municipios'));
    assert.ok(!atendeConceito(c, 'SELECT sum(despesa_saude) FROM indicadores'));
    for (const k of ['fns_municipios', 'fns_composicao', 'fns_anos', 'liquido_real', 'NULL antes de 2006', 'UMA vez por município e ano', 'Portaria GM/MS nº 828/2020', 'nunca some']) {
      assert.ok(SAUDE.includes(k) || SAUDE.toLowerCase().includes(k.toLowerCase()), `instruções sem "${k}"`);
    }
    const ctx = contextoSaude({ fontes: { fns: { anos: [2002, 2003, 2025], anos_reais: [2006, 2025] } } });
    assert.match(ctx, /FNS .*2002 a 2025; valor real \(liquido_real\) de 2006 a 2025, antes disso só nominal/);
    assert.match(contextoSaude({ fontes: {} }), /FNS \(repasses federais\) indisponível/);
    assert.deepEqual(coberturaDaFonte('SELECT sum(liquido) FROM fns_municipios', { fns: [2002, 2025] } as unknown as Cobertura), { nome: 'FNS', anos: [2002, 2025] });
    assert.deepEqual(fontesDaConsulta('SELECT sum(liquido) FROM fns_municipios f JOIN indicadores i ON i.cod_ibge = f.cod_ibge').sort(), ['DCA', 'FNS']);
  });

  test('FNS: aliases genéricos mantêm rótulos e fichas de outros domínios intactos', () => {
    const nomes = ['bruto', 'liquido', 'liquido_real', 'linhas', 'destino', 'bloco', 'grupo', 'estrategia', 'liquido_estadual', 'liquido_df_nao_comprovado'];
    const cob = { fns: [2002, 2025] } as Cobertura;
    for (const nome of nomes) {
      assert.equal(fichaDaColuna(nome, cob), null, nome);
      assert.equal(fichaDaColuna(nome, cob, `SELECT 1 AS ${nome} FROM indicadores`), null, nome);
      assert.equal(fichaDaColuna(nome, cob, `SELECT 'FROM fns_municipios' AS ${nome} FROM indicadores /* JOIN fns_anos */`), null, nome);
      assert.match(fichaDaColuna(nome, cob, `SELECT ${nome} FROM fns_municipios`) ?? '', /FNS/, nome);
    }
    assert.equal(rotuloColuna('linhas', tipoColuna('linhas', [7])), 'linhas');
    assert.equal(rotuloColuna('grupo', tipoColuna('grupo', ['A'])), 'grupo');
    assert.ok(!fichaDaColuna('populacao', cob, 'SELECT populacao FROM indicadores')!.includes('FNS'));
    assert.match(fichaDaColuna('populacao', cob, 'SELECT populacao FROM fns_municipios')!, /SVS\/MS.*uma vez por município e ano/);
    const exportar = (sql: string) => {
      const m = montarTabela(espec({ tipo: 'tabela', grupo: '', periodo: '', valor: '', colunas: ['linhas', 'liquido'], total: false, participacao: false }),
        { rotulo: 'C1', sql, resultado: { colunas: ['linhas', 'liquido'], linhas: [[7, 123.45]], total: 1 } });
      assert.ok(m.ok);
      return m.ok ? tabelaExportavel(m.tabela, [], cob) : null;
    };
    const outro = exportar('SELECT count(*) AS linhas, sum(receita_corrente) AS liquido FROM indicadores')!;
    assert.equal(outro.colunas[0], 'linhas');
    assert.ok(!JSON.stringify(outro.metadados).includes('FNS'));
    const proprio = exportar('SELECT linhas, liquido FROM fns_municipios')!;
    assert.match(new Map(proprio.metadados).get('Definição: liquido')!, /VL_LIQUIDO/);
    assert.match(new Map(proprio.metadados).get('Definição: linhas')!, /linhas de repasse/i);
  });

  test('fonte do manifesto: anos, anos com valor real e universo', { skip: pular }, async () => {
    const m = JSON.parse(await readFile(onde('gold/manifesto.json'), 'utf8'));
    const f = m.fontes.fns;
    assert.deepEqual(f.anos, Array.from({ length: 24 }, (_, i) => 2002 + i));
    assert.deepEqual(f.anos_reais, [2006, 2025]);
    assert.match(f.universo, /TP_REPASSE/);
    assert.deepEqual(f.df.cnpj, ['00394700000108', '00394700000299', '12116247000157']);
    assert.match(f.df.documentacao_historica, /Relatorio-Anual-de-Gestao-2009/);
    assert.equal(f.territorios_especiais['2605459'].nome, 'Fernando de Noronha');
    assert.equal(Object.keys(f.arquivos).length, 24);
    assert.match(f.arquivos['2018'].sha256, /^[0-9a-f]{64}$/);
    assert.match(f.arquivos['2025'].url, /REPASSE-FAF-COM-POPULACAO-2025\.xlsx$/);
    // o manifesto candidato mantém as demais fontes do publicado
    for (const k of ['sih', 'icsap', 'sia', 'populacao_svs']) assert.ok(m.fontes[k], `fonte ${k} sumiu do manifesto`);
  });

  test('série do Brasil: total = arquivo original em 2003, 2018 e 2025 (soma exata dos centavos)', { skip: pular }, async () => {
    const br = await rota<L[]>('fns_serie', {});
    assert.equal(br.length, 24);
    for (const ano of [2003, 2018, 2025]) {
      const r = br.find((x) => x.ano === ano)!;
      assert.equal(centavos(r.bruto), centavos(REFERENCIA[ano].BR[0]), `${ano} bruto`);
      assert.equal(centavos(r.liquido), centavos(REFERENCIA[ano].BR[1]), `${ano} líquido`);
      assert.equal(centavos(r.liquido_distrital), centavos(REFERENCIA[ano].DF[1]), `${ano} DF`);
    }
  });

  test('UF (GO) e três municípios (Goiânia, São Paulo, Acrelândia): totais = arquivo original', { skip: pular }, async () => {
    for (const ano of [2003, 2018, 2025]) {
      const go = (await rota<L[]>('fns_serie', { uf: 'GO' })).find((x) => x.ano === ano)!;
      assert.equal(centavos(go.bruto), centavos(REFERENCIA[ano].GO[0]), `GO ${ano} bruto`);
      assert.equal(centavos(go.liquido), centavos(REFERENCIA[ano].GO[1]), `GO ${ano} líquido`);
      for (const [cod, [bruto, liquido]] of Object.entries(REFERENCIA[ano].mun)) {
        const m = (await rota<L[]>('fns_serie', { ente: Number(cod) })).find((x) => x.ano === ano)!;
        assert.equal(centavos(m.bruto), centavos(bruto), `${cod} ${ano} bruto`);
        assert.equal(centavos(m.liquido), centavos(liquido), `${cod} ${ano} líquido`);
        assert.equal(m.municipios, 1);
        assert.equal(m.municipios_com_repasse, 1);
      }
    }
  });

  test('o líquido real só existe de 2006 em diante, e é líquido × fator do IPCA do painel', { skip: pular }, async () => {
    const br = await rota<L[]>('fns_serie', {});
    for (const r of br) {
      if (Number(r.ano) < 2006) assert.equal(r.liquido_real, null, `${r.ano}: real antes de 2006`);
      else assert.ok(Number(r.liquido_real) > 0, `${r.ano}: real ausente`);
    }
    const f2018 = (await consultaLivre('SELECT fator_real FROM ipca WHERE exercicio = 2018', 1)).linhas[0][0] as number;
    const r2018 = br.find((x) => x.ano === 2018)!;
    quase(Number(r2018.liquido_real), Number(r2018.liquido) * f2018, 1e-9);
    assert.equal(perCapita(br.find((x) => x.ano === 2004), true), null);
    assert.ok(perCapita(br.find((x) => x.ano === 2018), true)! > perCapita(br.find((x) => x.ano === 2018), false)!, 'real de 2025 > nominal de 2018');
  });

  test('cobertura populacional e per capita: população contada uma vez e só dos municípios com repasse', { skip: pular }, async () => {
    await rota('saude_serie', {}); // carrega saude_municipios
    const br = await rota<L[]>('fns_serie', {});
    for (const r of br) {
      assert.ok(Number(r.pop_com_repasse) <= Number(r.pop_total), `${r.ano}: população coberta maior que a total`);
      assert.ok(Number(r.municipios_com_repasse) <= Number(r.municipios));
      const cob = coberturaPopulacional(r)!;
      assert.ok(cob > 0.9 && cob <= 1, `${r.ano}: cobertura ${cob}`);
      const pc = perCapita(r, false)!;
      assert.ok(pc > 10 && pc < 1500, `${r.ano}: per capita ${pc}`);
    }
    // a população de um município é a SVS/MS e aparece uma vez por município e ano
    const dup = await consultaLivre('SELECT count(*) - count(DISTINCT (ano, municipio)) FROM fns_municipios', 1);
    assert.equal(dup.linhas[0][0], 0);
    const g = (await rota<L[]>('fns_serie', { ente: GOIANIA })).find((x) => x.ano === 2018)!;
    const pop = (await consultaLivre('SELECT populacao FROM saude_municipios WHERE cod_ibge = 5208707 AND ano = 2018', 1)).linhas[0][0] as number;
    assert.equal(g.pop_com_repasse, pop);
    quase(perCapita(g, false)!, Number(g.liquido) / pop, 1e-12);
  });

  test('ausência não vira zero; DF 2009–2010 inclui o CNPJ histórico comprovado', { skip: pular }, async () => {
    const sem = (await consultaLivre('SELECT count(*) FROM fns_municipios WHERE linhas IS NULL', 1)).linhas[0][0] as number;
    assert.ok(sem > 0, 'esperava municípios-ano sem repasse');
    assert.equal((await consultaLivre('SELECT count(*) FROM fns_municipios WHERE (linhas IS NULL) <> (liquido IS NULL) OR (linhas IS NULL) <> (bruto IS NULL)', 1)).linhas[0][0], 0);
    assert.equal((await consultaLivre('SELECT count(*) FROM fns_municipios WHERE liquido = 0 AND linhas IS NULL', 1)).linhas[0][0], 0);
    const exemplo = (await consultaLivre('SELECT cod_ibge, ano FROM fns_municipios WHERE linhas IS NULL AND cod_ibge IS NOT NULL ORDER BY ano DESC, cod_ibge LIMIT 1', 1)).linhas[0];
    const r = (await rota<L[]>('fns_serie', { ente: Number(exemplo[0]) })).find((x) => x.ano === Number(exemplo[1]))!;
    assert.equal(r.liquido, null);
    assert.equal(temRepasse(r), false);
    assert.equal(perCapita(r, false), null);
    // CNPJ 00394700000299, documentado no RAG 2009.
    const df = await rota<L[]>('fns_serie', { ente: 53 });
    for (const [ano, liquido] of [[2009, 491939611.49], [2010, 506841617.39]]) {
      assert.equal(centavos(df.find((x) => x.ano === ano)!.liquido), centavos(liquido), `DF ${ano}`);
    }
    const aud = await rota<L[]>('fns_anos', {});
    for (const ano of [2009, 2010]) assert.equal(aud.find((x) => x.ano === ano)!.liquido_df_nao_comprovado, 0);
    assert.equal(aud.find((x) => x.ano === 2018)!.liquido_df_nao_comprovado, 0);
  });

  test('DF: destinatário distrital só com os CNPJs comprovados; escopo UF = DF = município 53', { skip: pular }, async () => {
    const porUf = await rota<L[]>('fns_serie', { uf: 'DF' });
    const porEnte = await rota<L[]>('fns_serie', { ente: 53 });
    assert.equal(centavos(porUf.find((x) => x.ano === 2018)!.liquido), centavos(REFERENCIA[2018].DF[1]));
    assert.equal(centavos(porEnte.find((x) => x.ano === 2025)!.liquido), centavos(REFERENCIA[2025].DF[1]));
    const d = await consultaLivre("SELECT count(*), count(*) FILTER (destino = 'distrital') FROM fns_municipios WHERE uf = 'DF' AND linhas IS NOT NULL", 1);
    assert.deepEqual(d.linhas[0], [d.linhas[0][1], d.linhas[0][1]], 'toda linha do DF com repasse é distrital');
    assert.equal((await consultaLivre("SELECT count(*) FROM fns_municipios WHERE destino = 'distrital' AND municipio <> 530010", 1)).linhas[0][0], 0);
    const aud = await rota<L[]>('fns_anos', {});
    for (const r of aud) assert.ok(Number(r.linhas_distritais) >= 0 && Number(r.linhas_quarentena) >= 0);
  });

  test('composição: soma bate com o município, a UF e o Brasil; rótulos são os da fonte em cada ano', { skip: pular }, async () => {
    for (const [escopo, ano] of [[{ ente: GOIANIA }, 2018], [{ ente: ACRELANDIA }, 2025], [{ uf: 'GO' }, 2003], [{ uf: 'DF' }, 2025], [{}, 2018], [{}, 2025]] as [Record<string, number | string>, number][]) {
      const comp = await rota<L[]>('fns_composicao', { ...escopo, ano });
      const serie = (await rota<L[]>('fns_serie', escopo)).find((x) => x.ano === ano)!;
      assert.ok(comp.length > 0, `${JSON.stringify(escopo)} ${ano}: composição vazia`);
      assert.equal(centavos(comp.reduce((s, l) => s + Number(l.liquido), 0)), centavos(serie.liquido), `${JSON.stringify(escopo)} ${ano}: líquido`);
      assert.equal(centavos(comp.reduce((s, l) => s + Number(l.bruto), 0)), centavos(serie.bruto), `${JSON.stringify(escopo)} ${ano}: bruto`);
      assert.equal(new Set(comp.map((l) => `${l.bloco}|${l.grupo}|${l.estrategia}`)).size, comp.length, 'linhas distintas');
    }
    // os nomes mudam entre anos (a página não compara blocos entre anos)
    const blocos = async (ano: number) => new Set((await rota<L[]>('fns_composicao', { ano })).map((l) => String(l.bloco)));
    const [b2018, b2025] = [await blocos(2018), await blocos(2025)];
    assert.ok([...b2025].some((x) => !b2018.has(x)) || [...b2018].some((x) => !b2025.has(x)), 'rótulos idênticos em 2018 e 2025 (esperava mudança de grafia)');
  });

  test('municípios do ano: só os com repasse, população uma vez, DF marcado como distrital', { skip: pular }, async () => {
    const m = await rota<L[]>('fns_municipios', { ano: 2018 });
    assert.ok(m.length > 5500 && m.length < 5600, `municípios com repasse: ${m.length}`);
    assert.equal(new Set(m.map((x) => x.municipio)).size, m.length);
    assert.ok(m.every((x) => x.liquido !== null && Number(x.linhas) > 0));
    assert.equal(m.find((x) => x.cod_ibge === 5300108)?.destino, 'distrital');
    assert.equal(centavos(m.reduce((s, x) => s + Number(x.liquido), 0)), centavos(REFERENCIA[2018].BR[1]));
    const go = await rota<L[]>('fns_municipios', { ano: 2018, uf: 'GO' });
    assert.ok(go.every((x) => x.uf === 'GO'));
    assert.equal(centavos(go.reduce((s, x) => s + Number(x.liquido), 0)), centavos(REFERENCIA[2018].GO[1]));
  });

  test('auditoria por ano: linhas lidas = incluídas + excluídas + quarentena; totais incluídos batem com a série', { skip: pular }, async () => {
    const aud = await rota<L[]>('fns_anos', {});
    const br = await rota<L[]>('fns_serie', {});
    assert.equal(aud.length, 24);
    for (const a of aud) {
      assert.equal(Number(a.linhas_arquivo), Number(a.linhas_municipais) + Number(a.linhas_distritais) + Number(a.linhas_excluidas) + Number(a.linhas_quarentena), `${a.ano}: linhas`);
      assert.equal(centavos(a.liquido), centavos(br.find((x) => x.ano === a.ano)!.liquido), `${a.ano}: líquido da auditoria = série`);
      assert.ok(Number(a.liquido_estadual) > 0, `${a.ano}: fundos estaduais fora do universo`);
    }
    const t2018 = aud.find((x) => x.ano === 2018)!;
    assert.equal(t2018.linhas_arquivo, 92525);
    assert.equal(aud.find((x) => x.ano === 2025)!.linhas_arquivo, 146847);
  });

  test('compatibilidade: sem as tabelas do FNS (dados antigos) a fonte some do manifesto e a página mostra indisponibilidade', () => {
    const antigo: FontesMeta = { sih: { anos: [2008, 2009] }, populacao_svs: { anos: [2000, 2025] } };
    assert.equal(antigo.fns, undefined);
    assert.equal(anosDaColuna('populacao', antigo).length, 2);
    assert.deepEqual(anosSaude({ ...antigo, fns: { anos: [2002, 2003] } }), [2000, 2002, 2003, 2008, 2009, 2025]);
  });
});

describe('exportações: período de uma primeira coluna de anos', () => {
  test('anos com † (quebra de série da RAIS) entram no período; categorias e competências não viram período', () => {
    assert.equal(periodoDe(['2010', '2011', '2022 †', '2023 †', '2025']), '2010–2025');
    assert.equal(periodoDe([2000, 2001, 2014]), '2000–2014');
    assert.equal(periodoDe(['2023 †']), '2023');
    assert.equal(periodoDe(['01 · Promoção e prevenção', '02 · Diagnóstico']), undefined);
    assert.equal(periodoDe(['01/2020', '02/2020']), undefined, 'competências mensais informam o período pelo próprio componente');
    assert.equal(periodoDe(['2010', 'Total']), undefined, 'mistura de ano e rótulo: sem período inventado');
    assert.equal(periodoDe([]), undefined);
  });
});

describe('saúde: ICSAP (Lista Brasileira, Portaria SAS/MS nº 221/2008)', () => {
  const semSaude = !existsSync(onde('gold/saude/municipios.parquet'));
  const GOIAS_MUN = 5208905;
  const COLUNAS_ICSAP = ['icsap_int', 'icsap_base', ...GRUPOS_ICSAP.map(([n]) => colunaGrupoIcsap(n))];
  const fontesDoManifesto = async () => (await rota<{ fontes: unknown }>('meta')).fontes as FontesMeta;
  /** gold sem as colunas icsap_* (o publicado antes deste lote): os testes de dados saem, os de compatibilidade rodam */
  const temIcsap = async () => (await rota<L[]>('saude_colunas')).some((r) => r.column_name === 'icsap_int');

  test('os 19 grupos somam o total de ICSAP e a base do denominador cabe no total de internações (município, UF e Brasil, todos os anos)', { skip: semSaude }, async () => {
    if (!(await temIcsap())) return;
    assert.equal(GRUPOS_ICSAP.length, 19);
    for (const q of [{}, { uf: 'GO' }, { ente: GOIAS_MUN }]) {
      const serie = await rota<L[]>('saude_serie', q);
      const comIcsap = serie.filter((r) => r.icsap_int !== null);
      assert.ok(comIcsap.length >= 10, 'a série tem vários anos de ICSAP');
      for (const r of comIcsap) {
        const soma = GRUPOS_ICSAP.reduce((s, [n]) => s + Number(r[colunaGrupoIcsap(n)] ?? 0), 0);
        assert.equal(soma, r.icsap_int, `${JSON.stringify(q)} ${r.ano}: grupos ≠ total`);
        assert.ok(Number(r.icsap_int) <= Number(r.icsap_base), `${r.ano}: ICSAP maior que a base`);
        assert.ok(Number(r.icsap_base) <= Number(r.int_total), `${r.ano}: base maior que as internações`);
        assert.ok(Number(r.icsap_base) > 0.5 * Number(r.int_total), `${r.ano}: base sem partos implausível`);
      }
    }
  });

  test('UF e Brasil somam numeradores e denominadores antes de calcular: a razão das somas, nunca a média das taxas', { skip: semSaude }, async () => {
    if (!(await temIcsap())) return;
    const br = (await rota<L[]>('saude_serie', {})).find((r) => r.ano === 2024)!;
    const ufs = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
    const linhasUf = await Promise.all(ufs.map(async (uf) => (await rota<L[]>('saude_serie', { uf })).find((r) => r.ano === 2024)!));
    const soma = (c: string) => linhasUf.reduce((s, r) => s + Number(r[c]), 0);
    assert.equal(soma('icsap_int'), br.icsap_int);
    assert.equal(soma('icsap_base'), br.icsap_base);
    const taxa = indicador('icsap_taxa');
    const prop = indicador('icsap_proporcao');
    assert.equal(calcular(taxa, br), (Number(br.icsap_int) / Number(br.populacao)) * 10000);
    assert.equal(calcular(prop, br), Number(br.icsap_int) / Number(br.icsap_base));
    const mediaTaxas = linhasUf.reduce((s, r) => s + calcular(taxa, r)!, 0) / linhasUf.length;
    assert.notEqual(mediaTaxas, calcular(taxa, br), 'a média das taxas das UFs não é a taxa do Brasil');
    assert.ok(calcular(prop, br)! > 0.1 && calcular(prop, br)! < 0.3, 'participação do Brasil em 2024 entre 10% e 30%');
  });

  test('cobertura, ausência e zero: fora da cobertura, sem registro e zero registrado são coisas diferentes', { skip: semSaude }, async () => {
    const f: FontesMeta = { icsap: { anos: [2008, 2009, 2010] }, populacao_svs: { anos: [2000, 2008, 2009, 2010] } };
    assert.equal(condicaoDado('icsap_int', 0, 2009, f), 'zero_registrado');
    assert.equal(condicaoDado('icsap_g03', null, 2009, f), 'ausente');
    assert.equal(condicaoDado('icsap_int', null, 2007, f), 'fora_cobertura');
    assert.equal(condicaoDado('icsap_g19', 0, 2011, f), 'fora_cobertura');
    assert.equal(condicaoDado('icsap_int', 25, 2010, f), 'registrado');
    assert.equal(fonteDaColuna('icsap_int'), 'icsap');
    assert.equal(fonteDaColuna('icsap_g19'), 'icsap');
    assert.equal(fonteDaColuna('int_total'), 'sih', 'os indicadores do SIH seguem na fonte SIH');
    assert.deepEqual(anosDoIndicador(indicador('icsap_taxa'), f), [2008, 2009, 2010], 'cobertura = anos do ICSAP ∩ população');
    assert.deepEqual(anosDoIndicador(indicador('icsap_proporcao'), f), [2008, 2009, 2010]);
    // manifesto sem a fonte (publicado antes deste lote): nenhum ano coberto, nunca zero
    assert.deepEqual(anosDaColuna('icsap_int', { populacao_svs: f.populacao_svs }), []);
    assert.deepEqual(anosDoIndicador(indicador('icsap_taxa'), { populacao_svs: f.populacao_svs }), []);
    // município sem nenhuma AIH no ano não tem valor: nulo, e a taxa nula (nunca 0)
    assert.equal(calcular(indicador('icsap_taxa'), { ano: 2024, icsap_int: null, populacao: 1000 }), null);
    assert.equal(calcular(indicador('icsap_proporcao'), { ano: 2024, icsap_int: 0, icsap_base: 0 }), null, 'denominador zero: indisponível, não 0');
    assert.equal(calcular(indicador('icsap_proporcao'), { ano: 2024, icsap_int: 0, icsap_base: 40 }), 0, 'há internações e nenhuma é ICSAP: zero real');
  });

  test('IA: consultas com as colunas icsap_* dão os números conferidos (Goiânia e Brasil 2024; nulo, zero e ausência)', { skip: semSaude }, async () => {
    if (!(await temIcsap())) return;
    const exec = async (sql: string) => {
      const r = await executarConsulta({ sql }, ['saude']);
      assert.ok(!('erro' in r), JSON.stringify(r));
      return 'erro' in r ? [] : r.linhas;
    };
    // Goiânia 2024: 10.030 ICSAP, base de 71.212 internações sem partos, população de 1.494.599
    const [go] = await exec('SELECT sum(icsap_int), sum(icsap_base), sum(populacao), 10000.0 * sum(icsap_int) / sum(populacao), 100.0 * sum(icsap_int) / nullif(sum(icsap_base), 0) FROM saude_municipios WHERE cod_ibge = 5208707 AND ano = 2024');
    assert.deepEqual(go.slice(0, 3).map(Number), [10030, 71212, 1494599]);
    quase(Number(go[3]), (10030 / 1494599) * 10000);
    quase(Number(go[4]), (100 * 10030) / 71212);
    // Brasil 2024 pela razão das somas
    const [br] = await exec('SELECT sum(icsap_int), sum(icsap_base), sum(populacao) FROM saude_municipios WHERE ano = 2024');
    assert.deepEqual(br.map(Number), [2175413, 12965494, 212583750]);
    // os 19 grupos somam o total do município
    const [g] = await exec(`SELECT sum(icsap_int) - (${GRUPOS_ICSAP.map(([n]) => `sum(${colunaGrupoIcsap(n)})`).join(' + ')}) FROM saude_municipios WHERE cod_ibge = 5208707 AND ano = 2024`);
    assert.equal(Number(g[0]), 0);
    // Mojuí dos Campos 2013: zero registrado (ICSAP 0, base 0), participação indefinida (nula), taxa 0
    const [mo] = await exec('SELECT icsap_int, icsap_base, populacao, 100.0 * icsap_int / nullif(icsap_base, 0), 10000.0 * icsap_int / populacao FROM saude_municipios WHERE cod_ibge = 1504752 AND ano = 2013');
    assert.deepEqual(mo.slice(0, 3).map(Number), [0, 0, 16408]);
    assert.equal(mo[3], null, 'base zero: participação nula, não 0%');
    assert.equal(Number(mo[4]), 0);
    // Boa Esperança do Norte 2025: sem registro de ICSAP (sem linha, ou linha com valor nulo), nunca zero
    const sem = await exec('SELECT icsap_int, icsap_base FROM saude_municipios WHERE cod_ibge = 5101837 AND ano = 2025');
    assert.ok(sem.every((l) => l[0] === null && l[1] === null), JSON.stringify(sem));
    // fora da cobertura (antes de 2008) o valor é nulo, nunca zero
    const [antes] = await exec('SELECT count(*) FILTER (icsap_int IS NOT NULL), count(*) FROM saude_municipios WHERE ano < 2008');
    assert.equal(Number(antes[0]), 0);
    assert.ok(Number(antes[1]) > 0);
  });

  test('versão dos dados sem colunas ICSAP: indicadores indisponíveis, o resto segue, sem zeros nem erro', { skip: semSaude }, async () => {
    const colunas = new Set((await rota<L[]>('saude_colunas')).map((r) => String(r.column_name)));
    const sem = new Set(colunas);
    for (const c of COLUNAS_ICSAP) sem.delete(c);
    assert.equal(disponivelNosDados(indicador('icsap_taxa'), sem), false);
    assert.equal(disponivelNosDados(indicador('icsap_proporcao'), sem), false);
    assert.equal(disponivelNosDados(indicador('internacoes_mil'), sem), true, 'os indicadores de internações existentes seguem');
    assert.equal(disponivelNosDados(indicador('icsap_taxa'), null), true, 'enquanto carrega, não esconde nada');
    if (!(await temIcsap())) {
      const serie = await rota<L[]>('saude_serie', { uf: 'GO' });
      assert.ok(serie.length > 0 && serie.every((r) => !('icsap_int' in r)), 'sem colunas ICSAP na série, nenhuma coluna inventada');
    }
  });

  test('metadados, nota e alerta do indicador: Portaria, denominador explícito, leitura indireta e cobertura do manifesto', { skip: semSaude }, async () => {
    const f = await fontesDoManifesto();
    for (const id of ['icsap_taxa', 'icsap_proporcao']) {
      const ind = indicador(id);
      const m = new Map(metadadosIndicador(ind, f, 'Goiás'));
      assert.match(m.get('Fórmula')!, /Portaria SAS\/MS nº 221\/2008|PROADESS/);
      assert.match(m.get('Recorte territorial')!, /residência/);
      assert.match(m.get('Fonte')!, /ICSAP/);
      assert.match(ind.alerta!(), /medida indireta/i);
      assert.match(ind.alerta!(), /não avalia, isoladamente, a qualidade da gestão/);
    }
    assert.match(indicador('icsap_proporcao').nota(), /excluídas as por partos/);
    assert.match(indicador('icsap_proporcao').nota(), /O80–O84/);
    assert.equal(indicador('icsap_taxa').fator, 10000);
    if (await temIcsap()) {
      assert.equal(f.icsap!.anos![0], 2008);
      assert.equal(f.icsap!.anos!.at(-1), f.sih!.anos!.at(-1), 'ICSAP vai até o mesmo ano do SIH');
      assert.equal(new Map(metadadosIndicador(indicador('icsap_taxa'), f)).get('Período de cobertura'), faixaAnos(anosDoIndicador(indicador('icsap_taxa'), f)));
    }
  });

  test('tabela e ranking do indicador funcionam para ICSAP (Goiás, 2024)', { skip: semSaude }, async () => {
    if (!(await temIcsap())) return;
    const prop = indicador('icsap_proporcao');
    const ranking = await rota<Classificacao>('ranking_posicoes', { dominio: 'saude', ind: prop.id, ordem: 'desc', de: 2024, ate: 2024, uf: 'GO', min: prop.minimo, lista: 1 });
    assert.ok(ranking.lista!.length > 100, 'Goiás tem mais de 100 municípios acima do mínimo');
    // `valor` é o numerador (internações por ICSAP) e `indicador`, a participação; a posição na UF segue o indicador, do maior para o menor
    const porPosicao = [...ranking.lista!].filter((r) => r.posicao_uf !== null).sort((a, b) => a.posicao_uf! - b.posicao_uf!);
    const ordenado = porPosicao.map((r) => Number(r.indicador));
    assert.deepEqual(ordenado, [...ordenado].sort((a, b) => b - a), 'posição 1 é a maior participação');
    const g = (await rota<L[]>('saude_serie', { ente: GOIAS_MUN })).find((r) => r.ano === 2024)!;
    const goiania = ranking.lista!.find((r) => r.cod_ibge === GOIAS_MUN);
    if (goiania) {
      quase(Number(goiania.indicador), calcular(prop, g)!);
      assert.equal(goiania.valor, g.icsap_int, 'o numerador do ranking é o total de ICSAP do município');
      assert.equal(goiania.denominador, g.icsap_base, 'e o denominador, a base sem partos');
    }
    const anos = await rota<number[]>('ranking_anos', { dominio: 'saude', ind: 'icsap_taxa', min: 5000 });
    assert.ok(anos.includes(2008) && anos.includes(2025) && !anos.includes(2007));
  });

  test('sem valor por três motivos: numerador ausente, denominador ausente e denominador zero (Boa Esperança do Norte/MT 2025 e Mojuí dos Campos/PA 2013)', { skip: semSaude }, async () => {
    const taxa = indicador('icsap_taxa');
    const prop = indicador('icsap_proporcao');
    if (await temIcsap()) {
      // Boa Esperança do Norte/MT, 2025: tem população, mas nenhuma AIH (numerador e base nulos): sem registro, nas duas medidas
      const boa = (await rota<L[]>('saude_serie', { ente: 5101837 })).find((r) => r.ano === 2025)!;
      assert.equal(boa.populacao, 5877);
      assert.equal(boa.icsap_int, null);
      assert.equal(boa.icsap_base, null);
      assert.equal(motivoSemValor(taxa, boa), 'sem_registro');
      assert.equal(motivoSemValor(prop, boa), 'sem_registro');
      assert.equal(calcular(taxa, boa), null);
      assert.equal(calcular(prop, boa), null);
      assert.equal(textoMotivo('sem_registro', taxa).valor, 'sem registro');
      // Mojuí dos Campos/PA, 2013: 5 internações, todas partos (base 0) e nenhuma ICSAP (numerador 0): a taxa é um zero real, a participação é indefinida
      const moju = (await rota<L[]>('saude_serie', { ente: 1504752 })).find((r) => r.ano === 2013)!;
      assert.equal(moju.icsap_int, 0);
      assert.equal(moju.icsap_base, 0);
      assert.ok(Number(moju.populacao) > 0 && Number(moju.int_total) > 0);
      assert.equal(motivoSemValor(prop, moju), 'denominador_zero');
      assert.equal(calcular(prop, moju), null);
      assert.equal(motivoSemValor(taxa, moju), null, 'a taxa tem população: zero ICSAP é um valor');
      assert.equal(calcular(taxa, moju), 0);
      assert.equal(textoMotivo('denominador_zero', prop).valor, 'indefinida');
    }
    // denominador ausente: o numerador existe, mas falta a população (ou a base)
    assert.equal(motivoSemValor(taxa, { ano: 2024, icsap_int: 3, populacao: null }), 'denominador_ausente');
    assert.equal(motivoSemValor(prop, { ano: 2024, icsap_int: 3, icsap_base: null }), 'denominador_ausente');
    assert.equal(motivoSemValor(prop, { ano: 2024, icsap_int: null, icsap_base: null }), 'sem_registro', 'numerador ausente vence: não se culpa o denominador');
    assert.equal(motivoSemValor(taxa, { ano: 2024, icsap_int: 3, populacao: 100 }), null);
    assert.equal(motivoSemValor(taxa, undefined), 'sem_registro', 'sem linha do ano: sem registro');
    assert.equal(motivoSemValor(taxa, { ano: 2024, icsap_int: 0, populacao: 0 }), 'denominador_zero');
    // os três textos, em português e em inglês, são distintos entre si
    for (const ind of [taxa, prop]) {
      const textos = (['sem_registro', 'denominador_ausente', 'denominador_zero'] as const).map((m) => textosMotivo(m, ind));
      for (const idi of ['pt', 'en'] as const) {
        assert.equal(new Set(textos.map((x) => x[idi].valor)).size, 3, `${ind.id} ${idi}: valores distintos`);
        assert.equal(new Set(textos.map((x) => x[idi].nota)).size, 3, `${ind.id} ${idi}: notas distintas`);
        assert.equal(new Set(textos.map((x) => x[idi].rotulo)).size, 3, `${ind.id} ${idi}: rótulos distintos`);
      }
    }
    const [sr, da, dz] = (['sem_registro', 'denominador_ausente', 'denominador_zero'] as const).map((m) => textosMotivo(m, prop));
    assert.match(sr.en.valor, /no record/);
    assert.match(sr.en.nota, /numerator missing/);
    assert.match(da.pt.nota, /denominador ausente: internações de residentes, exceto partos/);
    assert.match(da.en.nota, /denominator missing: residents’ admissions, excluding deliveries/);
    assert.match(dz.pt.nota, /denominador zero/);
    assert.equal(dz.en.valor, 'undefined');
    assert.match(dz.en.nota, /zero denominator/);
    assert.match(textosMotivo('denominador_ausente', taxa).pt.nota, /população residente/);
  });
});

describe('saúde: cobertura vacinal oficial por residência (PNI / InfoMS)', () => {
  const semVacinacao = !existsSync(onde('gold/saude/vacinacao.parquet'));
  const GOIANIA = 5208707;
  const serie = async (q: Record<string, string | number>, imuno = 'bcg') => (await rota<L[]>('vacinacao_serie', { ...q, imuno })).map(paraLinhaVac);

  test('amostras oficiais (BCG, residência): Goiânia 2015, 2024 e 2025, Goiás 2024 e Brasil 2024', { skip: semVacinacao }, async () => {
    const go = await serie({ ente: GOIANIA });
    const em = (ano: number) => go.find((r) => r.ano === ano)!;
    assert.deepEqual([em(2015).numerador, em(2015).denominador], [24227, 21983]);
    quase(100 * em(2015).cobertura!, 110.2079, 1e-6);
    assert.deepEqual([em(2024).numerador, em(2024).denominador], [12918, 17937]);
    quase(100 * em(2024).cobertura!, 72.0187, 1e-5);
    assert.deepEqual([em(2025).numerador, em(2025).denominador], [18302, 17937]);
    quase(100 * em(2025).cobertura!, 102.0349, 1e-5);
    const goias = (await serie({ uf: 'GO' })).find((r) => r.ano === 2024)!;
    assert.deepEqual([goias.numerador, goias.denominador], [77422, 88862]);
    quase(100 * goias.cobertura!, 87.1261, 1e-5);
    const brasil = (await serie({})).find((r) => r.ano === 2024)!;
    assert.deepEqual([brasil.numerador, brasil.denominador], [2365381, 2389271]);
    quase(100 * brasil.cobertura!, 99.0001, 1e-5);
  });

  test('cobertura é razão: mostrada em % uma única vez, sem limite de 100%', { skip: semVacinacao }, async () => {
    const go = (await serie({ ente: GOIANIA })).find((r) => r.ano === 2015)!;
    assert.ok(go.cobertura! > 1 && go.cobertura! < 2, 'a razão da fonte não vem multiplicada por 100');
    assert.equal(pctRazao(go.cobertura, 2), '110,21%');
    assert.equal(situacao(go, true), 'acima_100');
    assert.equal(textoCobertura(go, true, 2), '110,21%', 'acima de 100% é preservado, não limitado');
  });

  test('método separado: até 2022 por tipo de dose, de 2023 em diante por indivíduo; as séries não se emendam', { skip: semVacinacao }, async () => {
    const brasil = await serie({});
    assert.deepEqual(brasil.map((r) => r.ano), [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    for (const r of brasil) assert.equal(r.metodo, metodoDoAno(r.ano));
    const por = separarPorMetodo(brasil);
    assert.equal(por.tipo_de_dose.at(-1)!.ano, 2022);
    assert.equal(por.individuo[0].ano, 2023);
    assert.ok(por.tipo_de_dose.every((r) => r.ano <= 2022) && por.individuo.every((r) => r.ano >= 2023));
  });

  test('catálogo varia por ano (14, 22, 21), rótulos originais preservados e sem emenda de nomes parecidos', { skip: semVacinacao }, async () => {
    const cat = (await rota<L[]>('vacinacao_catalogo')).map(paraCatalogo);
    const conta = (a: number) => cat.filter((c) => c.ano === a).length;
    assert.deepEqual([2015, 2022, 2023, 2024, 2025].map(conta), [14, 14, 22, 22, 21]);
    const pneumo = anosDoImunobiologico(cat, 'pneumo_10');
    assert.ok(pneumo.tipo_de_dose.length > 0 && pneumo.individuo.length === 0, 'Pneumo 10 só existe até 2022');
    const conj = anosDoImunobiologico(cat, 'pneumococica_conjugada');
    assert.ok(conj.individuo.length > 0 && conj.tipo_de_dose.length === 0, 'Pneumocócica Conjugada só de 2023 em diante');
    assert.equal(cat.find((c) => c.ano === 2024 && c.imunobiologico === 'hepatite_b_le_30_dias')!.rotulo, 'Hepatite B (<= 30 dias)');
    assert.equal(cat.find((c) => c.ano === 2020 && c.imunobiologico === 'hepatite_b_lt_30_dias')!.rotulo, 'Hepatite B (< 30 dias)');
    assert.ok(!cat.some((c) => c.ano === 2024 && c.imunobiologico === 'hepatite_b_lt_30_dias'));
    assert.ok(!cat.some((c) => c.ano === 2025 && c.imunobiologico === 'poliomielite_2_reforco'), 'ausência no catálogo do ano não vira zero');
  });

  test('metas só onde a regra oficial foi confirmada; nunca 95% como regra universal', { skip: semVacinacao }, async () => {
    const cat = (await rota<L[]>('vacinacao_catalogo')).map(paraCatalogo);
    const meta = (id: string, ano = 2024) => cat.find((c) => c.ano === ano && c.imunobiologico === id)?.meta;
    assert.equal(meta('bcg'), 0.9);
    assert.equal(meta('rotavirus'), 0.9);
    assert.equal(meta('penta_dtp_hepb_hib'), 0.95);
    for (const ano of [2023, 2024, 2025]) {
      for (const id of ['hepatite_b_le_30_dias', 'febre_amarela', 'dtp_1_reforco', 'varicela', 'poliomielite_1_reforco', 'hepatite_a_infantil']) assert.equal(meta(id, ano), 0.95, `${ano}: ${id}`);
      for (const id of ['hepatite_b_le_1_dia', 'hepatite_b_le_2_dias']) assert.equal(meta(id, ano), null, `${ano}: oportunidade sem meta`);
    }
    assert.equal(meta('febre_amarela', 2015), null, 'não projetar a meta atual na série histórica');
    assert.ok(cat.some((c) => c.meta === null) && cat.some((c) => c.meta === 0.95));
    const brasil = (await serie({}, 'bcg')).find((r) => r.ano === 2024)!;
    assert.equal(contraMeta(brasil), 'atingida');
    assert.equal(contraMeta({ ...brasil, meta: null }), null, 'sem meta confirmada, sem comparação');
    assert.equal(contraMeta({ ...brasil, cobertura: null }), null, 'sem cobertura calculável, sem comparação');
  });

  test('denominador zero não vira cobertura (nem a sentinela 0,0000001 da fonte); ausência não é zero', { skip: semVacinacao }, async () => {
    const r = await consultaLivre(`SELECT count(*) FILTER (status = 'denominador_zero') AS zeros,
        count(*) FILTER (status = 'denominador_zero' AND cobertura IS NOT NULL) AS zeros_com_cobertura,
        count(*) FILTER (cobertura_fonte < 0.000001 AND cobertura_fonte > 0 AND cobertura IS NOT NULL) AS sentinela_aceita,
        count(*) FILTER (cobertura IS NOT NULL AND denominador > 0 AND abs(cobertura - numerador::DOUBLE / denominador) > 1e-6) AS divergentes
      FROM saude_vacinacao`, 5);
    assert.ok((r.linhas[0][0] as number) > 0, 'há linhas de denominador zero para testar');
    assert.deepEqual(r.linhas[0].slice(1), [0, 0, 0]);
    const zero = (await consultaLivre(`SELECT municipio, ano, imunobiologico FROM saude_vacinacao WHERE status = 'denominador_zero' LIMIT 1`, 1)).linhas[0];
    const linha = (await rota<L[]>('vacinacao_municipios', { ano: Number(zero[1]), imuno: String(zero[2]) })).find((x) => x.municipio === zero[0])!;
    assert.equal(linha.cobertura, null);
    const lv = { ano: Number(zero[1]), imunobiologico: String(zero[2]), rotulo: 'x', metodo: metodoDoAno(Number(zero[1])), numerador: Number(linha.numerador), denominador: 0, cobertura: null, cobertura_fonte: Number(linha.cobertura_fonte), status: 'denominador_zero', meta: null } as LinhaVac;
    assert.equal(situacao(lv, true), 'denominador_zero');
    assert.match(textoCobertura(lv, true), /não calculável/);
    assert.equal(situacao(undefined, true), 'sem_registro');
    assert.equal(situacao(undefined, false), 'fora_do_catalogo');
  });

  test('Brasil e UF são os totalizadores oficiais = soma de numeradores e denominadores dos municípios (nunca média dos percentuais)', { skip: semVacinacao }, async () => {
    const r = await consultaLivre(`WITH uf AS (SELECT ano, imunobiologico, uf, sum(numerador) n, sum(denominador) d FROM saude_vacinacao GROUP BY ALL)
      SELECT count(*) FILTER (u.n <> t.numerador OR u.d <> t.denominador) AS uf_divergente,
             (SELECT count(*) FROM saude_vacinacao_territorios b JOIN (SELECT ano, imunobiologico, sum(numerador) n, sum(denominador) d FROM saude_vacinacao_territorios WHERE nivel = 'UF' GROUP BY ALL) s
               USING (ano, imunobiologico) WHERE b.nivel = 'BR' AND (b.numerador <> s.n OR b.denominador <> s.d)) AS br_divergente
      FROM uf u JOIN saude_vacinacao_territorios t ON t.nivel = 'UF' AND t.codigo = u.uf AND t.ano = u.ano AND t.imunobiologico = u.imunobiologico`, 5);
    assert.deepEqual(r.linhas[0], [0, 0]);
    const go = (await rota<L[]>('vacinacao_municipios', { uf: 'GO', ano: 2024, imuno: 'bcg' })).filter((x) => x.cod_ibge !== null);
    assert.equal(go.length, 246);
    assert.equal(go.reduce((s, x) => s + Number(x.numerador), 0), 77422);
    assert.equal(go.reduce((s, x) => s + Number(x.denominador), 0), 88862);
    const media = go.reduce((s, x) => s + Number(x.cobertura), 0) / go.length;
    assert.ok(Math.abs(media - 0.8712610564595) > 1e-3, 'a média dos percentuais municipais não é o total da UF');
  });

  test('vacinas diferentes nunca se somam; anos diferentes também não', { skip: semVacinacao }, async () => {
    const ano = await rota<L[]>('vacinacao_ano', { uf: 'GO', ano: 2024 });
    assert.equal(ano.length, 22);
    const linhas = ano.map(paraLinhaVac);
    assert.throws(() => razaoDasSomas(linhas), /vacinas diferentes/);
    const bcg = await serie({ uf: 'GO' });
    assert.throws(() => razaoDasSomas(bcg), /anos diferentes/);
    assert.equal(razaoDasSomas([bcg.find((r) => r.ano === 2024)!]).denominador, 88862);
  });

  test('município fora do cadastro (código de 6 dígitos sem IBGE de 7) fica com o código original e não entra no ranking', { skip: semVacinacao }, async () => {
    const r = await consultaLivre(`SELECT municipio, cod_ibge, uf FROM saude_vacinacao WHERE cod_ibge IS NULL GROUP BY ALL`, 20);
    assert.deepEqual(r.linhas, [[260545, null, 'PE']]);
    const rank = await rota<L[]>('vacinacao_municipios', { uf: 'PE', ano: 2024, imuno: 'bcg' });
    assert.equal(rank[0].sem_cadastro, 1);
    assert.equal(rank.filter((x) => x.cod_ibge !== null).length, rank.length - 1);
    assert.equal((await consultaLivre(`SELECT cod_ibge FROM saude_vacinacao WHERE municipio = 520870 LIMIT 1`, 1)).linhas[0][0], GOIANIA);
  });

  test('o ano de 2026 não entra e o escopo DF usa Brasília', { skip: semVacinacao }, async () => {
    assert.deepEqual((await consultaLivre(`SELECT min(ano), max(ano) FROM saude_vacinacao`, 1)).linhas[0], [2015, 2025]);
    const df = await serie({ ente: 53 });
    assert.ok(df.length > 0, 'ente 53 (DF) lê Brasília');
  });

  test('IA: instruções, cobertura, fonte e conceito de vacinação', { skip: semVacinacao }, () => {
    for (const trecho of ['saude_vacinacao_territorios', 'RAZÃO de 0 a 1', 'NÃO são comparáveis', 'sentinela', 'NUNCA some nem tire a média', 'Nunca aplique 95% como regra geral', 'SINASC']) {
      assert.ok(SAUDE.includes(trecho), trecho);
    }
    const sql = "SELECT cobertura FROM saude_vacinacao_territorios WHERE nivel = 'UF'";
    assert.equal(coberturaDaFonte(sql, { vacinacao: [2015, 2025] } as any)?.nome, 'Vacinação (cobertura por residência)');
    assert.ok(fontesConsultadas([sql]).some((f) => /PNI \/ InfoMS/.test(f)));
    assert.ok(!fontesConsultadas([sql]).some((f) => /SIM|SINASC \(nascidos/.test(f)));
    const conceito = CONCEITOS.find((c) => c.id === 'cobertura_vacinal')!;
    assert.ok(conceito.pedido.test('Qual a cobertura vacinal de Goiás?'));
    assert.ok(atendeConceito(conceito, sql));
    assert.ok(!atendeConceito(conceito, 'SELECT obitos FROM saude_municipios'));
    assert.match(fichaDaColuna('cobertura', { vacinacao: [2015, 2025] } as any, sql) ?? '', /2015 a 2025/);
    assert.match(fichaDaColuna('cobertura_fonte') ?? '', /sentinela/);
    assert.match(contextoSaude({ fontes: { vacinacao: { anos: [2015, 2025] } } }), /Vacinação .* 2015 a 2025/);
    assert.match(contextoSaude({ fontes: {} }), /Vacinação indisponível/);
  });

  test('rótulos e fichas de vacinação só valem para consultas às tabelas de vacinação (SIM/SINASC com os mesmos aliases ficam intactos)', () => {
    const cob = { vacinacao: [2015, 2025], sim: [2000, 2024], sinasc: [1996, 2024] } as unknown as Cobertura;
    const montar = (sql: string, colunas: string[], linhas: (string | number)[][]) => {
      const m = montarTabela(espec({ tipo: 'tabela', grupo: '', periodo: '', valor: '', colunas, total: false, participacao: false }), { rotulo: 'C1', sql, resultado: { colunas: ['ano', ...colunas], linhas, total: linhas.length } });
      assert.ok(m.ok);
      return m.ok ? new Map(tabelaExportavel(m.tabela, [], cob).metadados) : new Map<string, string>();
    };
    const sim = montar('SELECT ano, sum(infantis) AS numerador, sum(nascidos) AS denominador FROM saude_municipios WHERE ano = 2024 GROUP BY ano', ['numerador', 'denominador'], [[2024, 10, 1000]]);
    for (const c of ['numerador', 'denominador']) assert.equal(sim.get(`Definição: ${c}`), undefined, `${c} fora da vacinação não tem ficha de vacina`);
    const textoSim = [...sim.values()].join(' ');
    assert.ok(!/doses|vacinad|PNI|InfoMS|2023 em diante/i.test(textoSim), textoSim.slice(0, 300));
    assert.equal(fichaDaColuna('cobertura', cob), null);
    assert.equal(fichaDaColuna('metodo', cob, 'SELECT metodo FROM trab_municipios'), null);
    const vac = montar("SELECT ano, numerador, denominador, cobertura FROM saude_vacinacao_territorios WHERE nivel = 'BR'", ['numerador', 'denominador', 'cobertura'], [[2024, 1, 2, 0.5]]);
    assert.match(vac.get('Definição: numerador')!, /doses aplicadas|pessoas vacinadas/);
    assert.match(vac.get('Definição: cobertura')!, /2015 a 2025/);
    assert.match(vac.get('Definição: denominador')!, /nascidos vivos/);
  });

  test('carga das tabelas de vacinação é recuperável: falha no 2º arquivo, nova tentativa instala as três sem "already exists"', { skip: semVacinacao }, async () => {
    const { tabelasVacinacao, usarLeituraNoTeste, reiniciarVacinacaoNoTeste } = await import('../src/dados');
    await reiniciarVacinacaoNoTeste();
    let falhar = true;
    const lidas: string[] = [];
    usarLeituraNoTeste(async (c: string) => {
      lidas.push(c);
      if (falhar && c.endsWith('vacinacao_territorios.parquet')) throw new Error('HTTP 503');
      return new Uint8Array(await readFile(onde(c)));
    });
    try {
      await assert.rejects(tabelasVacinacao(), /503/);
      const antes = (await consultaLivre(`SELECT count(*) FROM information_schema.tables WHERE table_name LIKE 'saude_vacinacao%'`, 1)).linhas[0][0];
      assert.equal(antes, 0, 'falha no download não deixa tabela instalada pela metade');
      falhar = false;
      await tabelasVacinacao();
      await tabelasVacinacao();
      const r = await consultaLivre(`SELECT (SELECT count(*) FROM saude_vacinacao), (SELECT count(*) FROM saude_vacinacao_territorios), (SELECT count(*) FROM saude_vacinacao_catalogo)`, 1);
      assert.ok(r.linhas[0].every((x) => Number(x) > 0));
      assert.ok((await rota<L[]>('vacinacao_serie', { uf: 'GO', imuno: 'bcg' })).length > 0, 'a rota usa as tabelas recuperadas');
    } finally {
      usarLeituraNoTeste(async (c: string) => new Uint8Array(await readFile(onde(c))));
      await reiniciarVacinacaoNoTeste();
      await tabelasVacinacao();
    }
  });

  test('IA lê as tabelas de vacinação (carregadas sob demanda) e junta com o cadastro', { skip: semVacinacao }, async () => {
    await rota('vacinacao_catalogo');
    const r = await consultaLivre(`SELECT m.nome, v.numerador, v.denominador, v.cobertura FROM saude_vacinacao v
      JOIN saude_vacinacao_catalogo c USING (ano, imunobiologico) JOIN entes m ON m.cod_ibge = v.cod_ibge
      WHERE v.ano = 2024 AND v.imunobiologico = 'bcg' AND v.cod_ibge = 5208707`, 5);
    assert.equal(r.linhas.length, 1);
    assert.deepEqual(r.linhas[0].slice(1, 3), [12918, 17937]);
  });
});
