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
import { consultaLivre, executar, tabelasEducacaoSaude, tabelasIaTrabalho, usarMicrodadosNoTeste, usarMotorDeTeste } from '../src/dados';
import {
  anosPedidos, chamarIa, coberturaDaFonte, codigosDoSql, comPergunta, conferir, consultasDaConversa, contextoParaModelo, descreverCobertura, disponibilidadeNoAno, pedeTabelaMunicipal, dadosDoGrafico, executarConsulta, fontesConsultadas, lerModo, lerResposta,
  paraModelo, pedeTabela, perguntarIa, prepararResposta, recorteDe, revisarResposta, rotulosConsultas, semNominal, semUltimaPergunta, sugestoes,
  textoDaResposta, turnos, usarServidorIaNoTeste, validarGrafico, validarSql, type ConsultaFeita, type ContextoIa, type GraficoIa, type Mensagem,
  type Bloco, type Resultado,
} from '../src/ia';
import { formatarCelulaT, montarTabela, tabelaExportavel, tabelaHtml, tabelaTsv, type EspecTabela } from '../src/ia_tabelas';
import {
  blocosDeTexto, competenciasNoTexto, contar, formatarCelula, formatarTabela, formatarValor, periodoDasConsultas, periodosComoNumero, rotuloColuna, rotuloPeriodo, tipoColuna, tiposDoResultado, unidadeLimpa,
} from '../src/ia_formato';
import { citaQuebra, NOTAS } from '../src/ia_notas';
import {
  desatualizada, exportarConversa, filtrarResumos, FORMATO_CONVERSA, guardarNota, historico, lerConversaExportada, lerNota, novaVersaoComDadosAtuais, paraImportar,
  repositorioEmMemoria, resumoDe, tituloAutomatico, usarRepositorio, VERSAO_CONVERSA, versoesDosDados, type Conversa,
} from '../src/ia_historico';
import { cadastro, conferirCodigos, executarLocalizacao, localizar } from '../src/ia_territorio';
import { crc32, paraCsv, paraXlsx, paraXlsxAbas } from '../src/exportar';
import { ordenarBusca } from '../src/contexto';

const require = createRequire(import.meta.url);
const FETCH = globalThis.fetch; // alguns testes simulam o Worker trocando o fetch
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(AQUI, '..', '..', '..', 'data').replaceAll('\\', '/');
// microdados da RAIS (pipeline/microdados.py), fora do projeto
const MICRO = (process.env.TRABALHO_MICRO ?? 'D:/LVBERNARDELLI/finbra_micro').replaceAll('\\', '/');
const onde = (c: string) => (c.startsWith('silver/trabalho/micro/') ? `${MICRO}/${c}` : `${DATA}/${c}`);
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
  const manifesto = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
  for (const [nome, arq] of Object.entries({
    entes: 'silver/entes.parquet', indicadores: 'gold/indicadores.parquet', escopos: 'gold/escopos.parquet',
    alertas: 'gold/alertas.parquet', faixas: 'gold/faixas.parquet', ipca: 'gold/ipca.parquet',
  })) {
    await con.query(`CREATE TABLE ${nome} AS SELECT * FROM read_parquet('${DATA}/${arq}')`);
  }
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
    const ambos = sugestoes(['financas', 'trabalho'], { tipo: 'brasil' }, cob, null);
    assert.equal(ambos.length, 4);
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
    assert.deepEqual(c5.cabecalho, ['cod ibge', 'primeira (mês)', 'ultima (mês)', 'linhas']);
    const c7 = formatarTabela({
      colunas: ['de_competencia', 'ate_competencia', 'meses', 'admissoes_12m', 'saldo_12m', 'salario_medio_admissao_ponderado'],
      linhas: [[202509, 202608, 12, 1704, -61, 2169.45]], total: 1,
    });
    assert.deepEqual(c7.linhas[0], ['set/2025', 'ago/2026', '12', '1.704', '-61', '2.169,45']);
    assert.equal(c7.cabecalho[5], 'salario medio admissao ponderado (R$)');
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

  test('dicionário: busca de ocupação pelo nome, sem acento', { skip: semCubo }, async () => {
    const r = await rota<L[]>('trab_dicionario', { variavel: 'cbo', texto: 'medico clinico' });
    assert.ok(r.some((x) => x.codigo === '225125'), JSON.stringify(r));
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
      'Participação 2009 (%)', 'Participação 2021 (%)', 'Diferença de participação (p.p.)']);
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
    const p21 = tab.linhas.slice(0, 3).reduce((s, l) => s + (l[6].v as number), 0);
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
    const mun: Resultado = { colunas: ['nome', 'cod_ibge', 'pib_per_capita', 'rem_dez_media'], linhas: Array.from({ length: 246 }, (_, i) => [`M${i}`, 5200000 + i, 1000 + i, 2000 + i]), total: 246 };
    const consultas = new Map([feita('C1', 'SELECT 1', cor), feita('C2', 'SELECT 2', mun)]);
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
const AUDITORIA: [string, 'rapida' | 'pesquisa', string][] = [
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
  for (const [id, modo, pergunta] of AUDITORIA.filter(([id]) => !so || so.includes(id))) {
    test(`${id} (${modo})`, { timeout: 1_200_000 }, async () => {
      globalThis.fetch = FETCH;
      usarServidorIaNoTeste(process.env.IA_URL ?? 'http://localhost:8787');
      const m = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
      const cobertura = { rais: m.fontes.rais.anos, caged: { de: m.fontes.caged.de, ate: m.fontes.caged.ate }, microdados: false, dca: m.anos };
      const paineis: ('financas' | 'trabalho')[] = ['financas', 'trabalho'];
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
});
