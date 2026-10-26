/**
 * Testes das regras do painel: as mesmas rotas e o mesmo SQL do site (src/dados.ts), executados
 * sobre os arquivos da pasta data/ local com o DuckDB-WASM para Node.
 *
 * Uso (em web/):  npm test
 * Requer data/silver e data/gold (py pipeline/r2.py baixar ... ou py pipeline/processar.py).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { basesAV, codigoConta, formatarPct } from '../src/calculos';
import { consultaLivre, executar, usarMotorDeTeste } from '../src/dados';
import { executarConsulta, paraModelo, validarSql } from '../src/ia';
import { crc32, paraCsv, paraXlsx } from '../src/exportar';
import { ordenarBusca } from '../src/contexto';

const require = createRequire(import.meta.url);
const AQUI = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(AQUI, '..', '..', '..', 'data').replaceAll('\\', '/');
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
  db.open({ query: { castBigIntToDouble: true } });
  const { db: adb, con } = adaptar(db);
  const manifesto = JSON.parse(await readFile(`${DATA}/gold/manifesto.json`, 'utf8'));
  for (const [nome, arq] of Object.entries({
    entes: 'silver/entes.parquet', indicadores: 'gold/indicadores.parquet', escopos: 'gold/escopos.parquet',
    alertas: 'gold/alertas.parquet', faixas: 'gold/faixas.parquet', ipca: 'gold/ipca.parquet',
  })) {
    await con.query(`CREATE TABLE ${nome} AS SELECT * FROM read_parquet('${DATA}/${arq}')`);
  }
  usarMotorDeTeste(adb as any, con as any, manifesto, (c) => `${DATA}/${c}`, async (c) => new Uint8Array(await readFile(`${DATA}/${c}`)));
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
});