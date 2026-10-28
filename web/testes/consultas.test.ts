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
import { consultaLivre, executar, tabelasIaTrabalho, usarMicrodadosNoTeste, usarMotorDeTeste } from '../src/dados';
import {
  comPergunta, conferir, consultasDaConversa, contextoParaModelo, dadosDoGrafico, executarConsulta, fontesConsultadas, lerResposta, paraModelo,
  perguntarIa, prepararResposta, revisarResposta, rotulosConsultas, semUltimaPergunta, sugestoes, textoDaResposta, turnos, usarServidorIaNoTeste,
  validarGrafico, validarSql, type ConsultaFeita, type ContextoIa, type GraficoIa, type Mensagem, type Resultado,
} from '../src/ia';
import {
  competenciasNoTexto, contar, formatarCelula, formatarTabela, formatarValor, periodoDasConsultas, rotuloPeriodo, tipoColuna, unidadeLimpa,
} from '../src/ia_formato';
import { citaQuebra } from '../src/ia_notas';
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
  const ctx = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'brasil' }, ano: null, estilo: 'direta' });
  const responder = (id: string, input: unknown) => ({ role: 'assistant' as const, content: [{ type: 'tool_use', id, name: 'responder', input }] });
  const consultar = (id: string, sql = 'SELECT 1 AS n') => ({ role: 'assistant' as const, content: [{ type: 'tool_use', id, name: 'consultar', input: { sql, objetivo: 'teste' } }] });
  const entrada = (o: Record<string, unknown> = {}) => ({
    tipo: 'resposta', conclusao: 'São 10.', destaques: [], explicacao: '', interpretacao: '', hipoteses: '', limitacoes: '',
    recorte: { territorio: 'Brasil', periodo: '2025', unidade: 'vínculos', filtros: '' }, metodologia: '', graficos: [], aprofundar: [], ...o,
  });

  test('contexto sem território manda não presumir lugar e o estilo vai junto', () => {
    assert.match(ctx, /Território selecionado: nenhum\. Não presuma/);
    assert.match(ctx, /Estilo de resposta: direta/);
    const go = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'municipio', uf: 'GO', nome: 'Goiânia', cod: 5208707 }, ano: 2023, estilo: 'tecnica' });
    assert.match(go, /Goiânia \(GO\), município\. Códigos: cod_ibge = 5208707 \(7 dígitos\) em trab_municipios, trab_grandes_setores, trab_setores, trab_caged/);
    assert.match(go, /municipio = 520870 \(6 dígitos\) só em rais_mun e rais_vinculos/);
    assert.match(go, /Ano de referência: 2023/);
    assert.match(go, /técnica/);
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
    const c = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'municipio', uf: 'PR', nome: 'Andirá', cod: ANDIRA }, ano: null, estilo: 'direta' });
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
    const contexto = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'uf', uf: 'GO', nome: 'Goiás', cod: 52 }, ano: null, estilo: 'direta' });
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
    const ctx: ContextoIa = { paineis: ['trabalho'], territorio: { tipo: 'municipio', uf: 'PR', nome: 'Andirá', cod: ANDIRA }, ano: null, estilo: 'direta' };
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
    const contexto = contextoParaModelo({ paineis: ['trabalho'], territorio: { tipo: 'brasil' }, ano: null, estilo: 'direta' });
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
