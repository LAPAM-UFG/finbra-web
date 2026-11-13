/**
 * Regressão do painel automático de gestão pública (MUNIC e ESTADIC): só funções puras, sem arquivos de dados.
 * A conferência da curadoria contra o catálogo e as respostas reais fica em testes/consultas.test.ts.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CURADORIA } from '../src/munic_curadoria';
import {
  BLOCOS_MUNIC, COD_UF, COLUNAS_EXPORTACAO, cobertura, condicaoDoCartao, edicoesCuradas, ehLinkDoExplorador, lerEscolhas, linhasExportacao, montarCartoes, paresPedidos,
  resumirBinario, resumirNumerico, respostaDoTerritorio, selecionar, type DadosPainel, type FonteMunic, type IndicadorMunic, type LinhaAgg, type LinhaResp,
} from '../src/munic_painel';

const fonte = (ano: number, v: string): FonteMunic => ({ ano, var: v, aba: 'Aba', tema: 'Tema', rotulo: `Pergunta ${v}` });
const bin = (id: string, fontes: FonteMunic[], extra: Partial<IndicadorMunic> = {}): IndicadorMunic =>
  ({ id, bloco: 'transparencia', pesquisa: 'munic', tipo: 'binario', titulo: { pt: id, en: id }, fontes, sim: ['Sim'], nao: ['Não'], ...extra });
const numerico = (id: string, fontes: FonteMunic[]): IndicadorMunic =>
  ({ id, bloco: 'pessoal', pesquisa: 'munic', tipo: 'numerico', titulo: { pt: id, en: id }, fontes, unidade: { pt: 'servidores', en: 'staff' } });
const ag = (ano: number, v: string, corte: string, grupo: string, txt: string | null, valida: boolean, n: number, soma: number | null = null): LinhaAgg =>
  ({ ano, var: v, corte, grupo, valor_txt: txt, valida, n, soma, media: soma !== null && n ? soma / n : null });

const F24 = fonte(2024, 'X1');
const I = bin('i', [F24]);

test('falso "Não" por falta de resposta: quem não respondeu fica fora da base e nunca vira Não', () => {
  const l = [ag(2024, 'X1', 'brasil', 'BR', 'Sim', true, 60), ag(2024, 'X1', 'brasil', 'BR', 'Não', true, 30),
    ag(2024, 'X1', 'brasil', 'BR', 'Não informou', false, 7), ag(2024, 'X1', 'brasil', 'BR', 'Recusa', false, 3)];
  const r = resumirBinario(l, I, F24, 'brasil', 'BR');
  assert.equal(r.base, 90); // só Sim + Não
  assert.equal(r.pct, 60 / 90);
  assert.equal(r.nao, 30); // os 10 sem resposta válida não entram no Não
  assert.equal(r.semResposta, 10);
  assert.deepEqual(r.semRespostaDetalhe.map((d) => d.texto), ['Não informou', 'Recusa']);
  // território: sem linha ≠ Não; resposta inválida ≠ Não
  assert.deepEqual(respostaDoTerritorio([], I, F24), { estado: 'sem_registro' });
  const inval: LinhaResp[] = [{ ano: 2024, var: 'X1', valor_txt: 'Não informou', valor_num: null, valida: false }];
  assert.deepEqual(respostaDoTerritorio(inval, I, F24), { estado: 'sem_resposta', texto: 'Não informou' });
  assert.deepEqual(respostaDoTerritorio([{ ano: 2024, var: 'X1', valor_txt: 'Não', valor_num: null, valida: true }], I, F24), { estado: 'nao', texto: 'Não' });
  // a resposta de outra edição ou de outra variável não vale
  assert.deepEqual(respostaDoTerritorio([{ ano: 2023, var: 'X1', valor_txt: 'Sim', valor_num: null, valida: true }], I, F24), { estado: 'sem_registro' });
  // sem base válida: percentual indefinido, não 0%
  const so = resumirBinario([ag(2024, 'X1', 'brasil', 'BR', 'Recusa', false, 4)], I, F24, 'brasil', 'BR');
  assert.equal(so.pct, null);
  assert.equal(so.base, 0);
  assert.equal(condicaoDoCartao({ ind: I, fonte: F24, recorte: so, brasil: null, ufDoTerritorio: null, territorio: null, universo: 10 }), 'sem_resposta_valida');
});

test('resposta com mais de uma opção afirmativa: só as listadas em sim contam; categoria válida fora da curadoria impede o percentual', () => {
  const plano = bin('p', [F24], { sim: ['Sim, com legislação específica', 'Sim, como parte integrante do Plano Diretor'] });
  const l = [ag(2024, 'X1', 'brasil', 'BR', 'Sim, com legislação específica', true, 5), ag(2024, 'X1', 'brasil', 'BR', 'Sim, como parte integrante do Plano Diretor', true, 3), ag(2024, 'X1', 'brasil', 'BR', 'Não', true, 2)];
  const r = resumirBinario(l, plano, F24, 'brasil', 'BR');
  assert.equal(r.sim, 8);
  assert.equal(r.pct, 0.8);
  // "Em elaboração" não é Sim nem Não: o indicador não calcula percentual em vez de empurrá-la para um dos lados
  const com = resumirBinario([...l, ag(2024, 'X1', 'brasil', 'BR', 'Em elaboração', true, 4)], plano, F24, 'brasil', 'BR');
  assert.equal(com.estado, 'inesperada');
  assert.equal(com.pct, null);
  assert.deepEqual(com.inesperadas, [{ texto: 'Em elaboração', n: 4 }]);
  assert.equal(resumirBinario([], I, F24, 'brasil', 'BR').estado, 'sem_dados');
});

test('numérico: o 0 registrado é valor; ausência é ausência; cobertura e soma só dos territórios com valor', () => {
  const N = numerico('n', [fonte(2023, 'N1')]);
  const f = N.fontes[0];
  const zeros = resumirNumerico([ag(2023, 'N1', 'brasil', 'BR', null, true, 3, 0)], f, 'brasil', 'BR');
  assert.equal(zeros.soma, 0);
  assert.equal(zeros.media, 0);
  assert.equal(zeros.n, 3);
  const nada = resumirNumerico([ag(2023, 'N1', 'brasil', 'BR', '-', false, 5)], f, 'brasil', 'BR');
  assert.equal(nada.soma, null); // só havia "–": nenhum valor, não zero
  assert.equal(nada.media, null);
  assert.equal(nada.n, 0);
  assert.equal(nada.semResposta, 5);
  assert.equal(resumirNumerico([], f, 'brasil', 'BR').estado, 'sem_dados');
  const mista = resumirNumerico([ag(2023, 'N1', 'brasil', 'BR', null, true, 4, 100), ag(2023, 'N1', 'brasil', 'BR', 'Não informou', false, 2)], f, 'brasil', 'BR');
  assert.equal(mista.media, 25); // média sobre os 4 com valor, não sobre os 6
  assert.equal(cobertura(mista.n, 6), 4 / 6);
  assert.equal(cobertura(0, 6), 0);
  assert.equal(cobertura(3, null), null);
  assert.equal(cobertura(3, 0), null);
  // território
  assert.deepEqual(respostaDoTerritorio([{ ano: 2023, var: 'N1', valor_txt: null, valor_num: 0, valida: true }], N, f), { estado: 'valor', valor: 0 });
  assert.deepEqual(respostaDoTerritorio([{ ano: 2023, var: 'N1', valor_txt: '-', valor_num: null, valida: false }], N, f), { estado: 'sem_resposta', texto: '-' });
  assert.equal(respostaDoTerritorio([{ ano: 2023, var: 'N1', valor_txt: null, valor_num: null, valida: true }], N, f).estado, 'inesperada');
});

test('pesquisa e escopo separados: o recorte lê só o seu corte e grupo, e a ESTADIC nunca usa a UF dos municípios', () => {
  const dados: DadosPainel = {
    agregados: [ag(2024, 'X1', 'brasil', 'BR', 'Sim', true, 50), ag(2024, 'X1', 'brasil', 'BR', 'Não', true, 50),
      ag(2024, 'X1', 'uf', 'GO', 'Sim', true, 9), ag(2024, 'X1', 'uf', 'GO', 'Não', true, 1), ag(2024, 'X1', 'uf', 'SP', 'Sim', true, 1), ag(2024, 'X1', 'uf', 'SP', 'Não', true, 9)],
    respostas: [], universo: [{ ano: 2024, territorios: 5570, territorios_uf: 246 }],
  };
  const sel = selecionar([I], 'munic', { tipo: 'ultima' });
  const br = montarCartoes(sel, dados, { tipo: 'brasil' })[0];
  assert.equal((br.recorte as { pct: number }).pct, 0.5);
  assert.equal(br.brasil, null);
  assert.equal(br.universo, 5570);
  const go = montarCartoes(sel, dados, { tipo: 'uf', uf: 'GO' })[0];
  assert.equal((go.recorte as { pct: number }).pct, 0.9); // GO, não SP e não o Brasil
  assert.equal((go.brasil as { pct: number }).pct, 0.5); // o Brasil só como comparação, em campo à parte
  assert.equal(go.universo, 246);
  // a seleção da ESTADIC não traz indicador da MUNIC e vice-versa
  const E = { ...bin('e', [fonte(2024, 'E1')]), pesquisa: 'estadic' as const };
  assert.deepEqual(selecionar([I, E], 'estadic', { tipo: 'ultima' }).map((s) => s.ind.id), ['e']);
  assert.deepEqual(selecionar([I, E], 'munic', { tipo: 'ultima' }).map((s) => s.ind.id), ['i']);
  // município: respostas dele, com UF e Brasil como comparação separada
  const l: LinhaResp[] = [{ ano: 2024, var: 'X1', valor_txt: 'Sim', valor_num: null, valida: true }];
  const m = montarCartoes(sel, { ...dados, respostas: l }, { tipo: 'territorio', cod: 5208707, uf: 'GO' }, 'GO')[0];
  assert.equal(m.territorio?.estado, 'sim');
  assert.equal(m.recorte, null);
  assert.equal((m.ufDoTerritorio as { pct: number }).pct, 0.9);
  assert.equal(m.universo, 1);
});

test('endereço: UF, código, edição e pesquisa inválidos recusam e nunca viram Brasil nem a última edição', () => {
  const ed = edicoesCuradas(CURADORIA);
  const le = (q: string) => lerEscolhas(new URLSearchParams(q), ed);
  assert.deepEqual(le(''), { ok: true, pesquisa: 'munic', modo: { tipo: 'ultima' }, escopo: { tipo: 'brasil' } });
  assert.deepEqual(le('uf=GO'), { ok: true, pesquisa: 'munic', modo: { tipo: 'ultima' }, escopo: { tipo: 'uf', uf: 'GO' } });
  assert.deepEqual(le('cod=5208707&uf=GO'), { ok: true, pesquisa: 'munic', modo: { tipo: 'ultima' }, escopo: { tipo: 'territorio', cod: 5208707, uf: 'GO' } });
  for (const [q, erro] of [['uf=XX', 'uf'], ['uf=go', 'uf'], ['cod=abc', 'cod'], ['cod=520870', 'cod'], ['cod=52087070', 'cod'], ['ano=2019', 'edicao'], ['ano=abc', 'edicao'], ['pesq=foo', 'pesquisa'],
    ['pesq=estadic&cod=99', 'cod'], ['pesq=estadic&cod=5208707', 'cod'], ['pesq=estadic&uf=GO&cod=11', 'cod'], ['pesq=estadic&ano=2013', 'edicao']] as const) {
    const r = le(q);
    assert.equal(r.ok, false, q);
    assert.equal(!r.ok && r.erro, erro, q);
  }
  // ESTADIC: a UF escolhida é o governo estadual (código da UF), não "prefeituras da UF"
  assert.deepEqual(le('pesq=estadic&uf=GO'), { ok: true, pesquisa: 'estadic', modo: { tipo: 'ultima' }, escopo: { tipo: 'territorio', cod: 52, uf: 'GO' } });
  assert.deepEqual(le('pesq=estadic&cod=52'), { ok: true, pesquisa: 'estadic', modo: { tipo: 'ultima' }, escopo: { tipo: 'territorio', cod: 52, uf: 'GO' } });
  assert.deepEqual(le('pesq=estadic'), { ok: true, pesquisa: 'estadic', modo: { tipo: 'ultima' }, escopo: { tipo: 'brasil' } });
  assert.deepEqual(le('ano=2023').ok && (le('ano=2023') as { modo: unknown }).modo, { tipo: 'edicao', ano: 2023 });
  assert.equal(Object.keys(COD_UF).length, 27);
});

test('links antigos do explorador (?var=, ?aba=) são reconhecidos; o painel não os engole', () => {
  assert.equal(ehLinkDoExplorador('?var=Magr01&ano=2024&aba=Agropecu%C3%A1ria'), true);
  assert.equal(ehLinkDoExplorador('?pesq=estadic&var=Etic13'), true);
  assert.equal(ehLinkDoExplorador('?aba=Cultura'), true);
  assert.equal(ehLinkDoExplorador('?pesq=estadic&ano=2023&uf=GO'), false);
  assert.equal(ehLinkDoExplorador(''), false);
});

test('edição mista e explícita: sem a pergunta na edição, o cartão é "não disponível", nunca outro ano', () => {
  const A = bin('a', [fonte(2024, 'A24'), fonte(2023, 'A23')]);
  const B = bin('b', [fonte(2023, 'B23')]);
  const C = bin('c', [fonte(2021, 'C21')]);
  const ultima = selecionar([A, B, C], 'munic', { tipo: 'ultima' });
  assert.deepEqual(ultima.map((s) => s.fonte?.ano), [2024, 2023, 2021]); // cada indicador na sua última edição
  const e23 = selecionar([A, B, C], 'munic', { tipo: 'edicao', ano: 2023 });
  assert.deepEqual(e23.map((s) => s.fonte?.var ?? null), ['A23', 'B23', null]);
  assert.deepEqual(selecionar([A, B, C], 'munic', { tipo: 'edicao', ano: 2024 }).map((s) => s.fonte?.var ?? null), ['A24', null, null]);
  const p = paresPedidos(ultima);
  assert.deepEqual([...p.entries()], [[2021, ['C21']], [2023, ['B23']], [2024, ['A24']]]);
  // cartão sem edição: sem número e com a condição dita
  const cartoes = montarCartoes(e23, { agregados: [ag(2023, 'A23', 'brasil', 'BR', 'Sim', true, 1)], respostas: [], universo: [{ ano: 2023, territorios: 5570, territorios_uf: 1 }] }, { tipo: 'brasil' });
  const c = cartoes[2];
  assert.equal(c.fonte, null);
  assert.equal(c.recorte, null);
  assert.equal(condicaoDoCartao(c), 'nao_disponivel_edicao');
});

test('exportação: números como números, ano real e condição em todas as linhas, percentuais de 0 a 100', () => {
  const N = numerico('n', [fonte(2023, 'N1')]);
  const A = bin('a', [fonte(2024, 'X1')]);
  const D = bin('d', [fonte(2021, 'D1')]);
  const dados: DadosPainel = {
    agregados: [ag(2024, 'X1', 'brasil', 'BR', 'Sim', true, 3), ag(2024, 'X1', 'brasil', 'BR', 'Não', true, 1), ag(2024, 'X1', 'brasil', 'BR', 'Recusa', false, 2),
      ag(2023, 'N1', 'brasil', 'BR', null, true, 4, 100), ag(2023, 'N1', 'brasil', 'BR', '-', false, 1)],
    respostas: [], universo: [{ ano: 2024, territorios: 10, territorios_uf: 2 }, { ano: 2023, territorios: 10, territorios_uf: 2 }],
  };
  const sel = selecionar([A, N, D], 'munic', { tipo: 'edicao', ano: 2024 });
  const cartoes = montarCartoes(sel, dados, { tipo: 'brasil' });
  const blocos = Object.fromEntries(BLOCOS_MUNIC.map((b) => [b, `Bloco ${b}`])) as Record<(typeof BLOCOS_MUNIC)[number], string>;
  for (const lang of ['pt', 'en'] as const) {
    const cols = COLUNAS_EXPORTACAO(lang);
    const rows = linhasExportacao(cartoes, { lang, pesquisa: 'MUNIC', recorte: 'Brasil', blocos });
    assert.equal(rows.length, 3);
    assert.ok(rows.every((r) => r.length === cols.length), `${lang}: ${rows.map((r) => r.length)} vs ${cols.length}`);
  }
  const cols = COLUNAS_EXPORTACAO('pt');
  const i = (n: string) => cols.findIndex((c) => c.startsWith(n));
  const [a, n, d] = linhasExportacao(cartoes, { lang: 'pt', pesquisa: 'MUNIC', recorte: 'Brasil', blocos });
  assert.equal(a[i('Edição')], 2024);
  assert.equal(a[i('Respostas "Sim"')], 3);
  assert.equal(a[i('Respostas "Não"')], 1);
  assert.equal(a[i('Respostas efetivas')], 4); // denominador = Sim + Não
  assert.equal(a[i('Participação')], 75); // escala 0–100
  assert.equal(a[i('Unidade da participação')], '%');
  assert.equal(a[i('Sem resposta válida')], 2);
  assert.equal(a[i('Territórios do recorte')], 10);
  assert.equal(a[i('Cobertura')], 40); // 4 de 10
  assert.equal(a[i('Condição')], 'observado');
  // 2023 não está na edição pedida: o indicador numérico sai sem número e sem ano
  assert.equal(n[i('Edição')], null);
  assert.equal(n[i('Soma')], null);
  assert.equal(n[i('Condição')], 'não disponível nesta edição');
  assert.equal(d[i('Participação')], null); // 2021 também não existe em 2024
  // última informação: o ano de cada linha é o da pergunta, nunca 2024 por padrão
  const ult = montarCartoes(selecionar([A, N, D], 'munic', { tipo: 'ultima' }), dados, { tipo: 'brasil' });
  const linhas = linhasExportacao(ult, { lang: 'pt', pesquisa: 'MUNIC', recorte: 'Brasil', blocos });
  assert.deepEqual(linhas.map((r) => r[i('Edição')]), [2024, 2023, 2021]);
  assert.equal(linhas[1][i('Soma')], 100);
  assert.equal(linhas[1][i('Média')], 25);
  assert.equal(linhas[1][i('Unidade da resposta')], 'servidores');
});

test('curadoria: indicadores únicos, enunciado e tema exatos presentes, binários com Sim e Não, blocos cobertos, 30 a 50 por pesquisa', () => {
  const ids = CURADORIA.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const i of CURADORIA) {
    assert.ok(i.fontes.length > 0, i.id);
    assert.deepEqual(i.fontes.map((f) => f.ano), [...i.fontes.map((f) => f.ano)].sort((a, b) => b - a), `${i.id}: fontes da mais recente para a mais antiga`);
    for (const f of i.fontes) {
      assert.match(f.var, /^[A-Za-z0-9]+$/, i.id); // entra literal no SQL
      assert.ok(f.rotulo && f.aba && f.tema, `${i.id} ${f.ano}`);
    }
    if (i.tipo === 'binario') assert.ok((i.sim ?? []).length > 0 && (i.nao ?? []).length > 0, i.id);
    else assert.ok(i.unidade, i.id);
    assert.equal(i.pesquisa === 'munic', i.id.startsWith('m_'), i.id);
  }
  for (const p of ['munic', 'estadic'] as const) {
    const n = CURADORIA.filter((i) => i.pesquisa === p).length;
    assert.ok(n >= 25 && n <= (p === 'munic' ? 60 : 40), `${p}: ${n}`);
    for (const b of BLOCOS_MUNIC) assert.ok(CURADORIA.some((i) => i.pesquisa === p && i.bloco === b), `${p} sem o bloco ${b}`);
  }
  // as edições recentes aparecem em mais de um ano: nada de "tudo é 2024"
  assert.ok(new Set(CURADORIA.filter((i) => i.pesquisa === 'munic').map((i) => i.fontes[0].ano)).size >= 3);
  // pessoal: direta e indireta são quadros distintos, com nome explícito, contexto e tema coerentes em todas as edições do indicador
  for (const i of CURADORIA.filter((x) => x.tipo === 'numerico')) {
    const direta = /administração direta/i.test(i.fontes[0].tema);
    const indireta = /administração indireta/i.test(i.fontes[0].tema);
    assert.ok(direta !== indireta, `${i.id}: tema ${i.fontes[0].tema}`);
    assert.ok(i.fontes.every((f) => /administração direta/i.test(f.tema) === direta), `${i.id}: temas misturados entre edições`);
    assert.match(i.titulo.pt, direta ? /\(administração direta\)$/ : /\(administração indireta\)$/, i.id);
    assert.match(i.titulo.en, direta ? /\(direct administration\)$/ : /\(indirect administration\)$/, i.id);
    assert.ok(i.contexto?.pt && i.contexto?.en, `${i.id}: sem contexto`);
    if (indireta) {
      assert.match(i.contexto!.pt, /quadro distinto/, i.id);
      assert.doesNotMatch(i.contexto!.pt, /não se aplica|autarquias/i, `${i.id}: não inferir o motivo da ausência`);
    }
    assert.equal(i.id.includes('indireta'), indireta, i.id);
  }
  // as 6 categorias de pessoal direto e de indireto em cada pesquisa; o direto continua nas edições anteriores
  for (const p of ['munic', 'estadic'] as const) {
    const dir = CURADORIA.filter((i) => i.pesquisa === p && i.id.includes('_rh_direta_'));
    const ind = CURADORIA.filter((i) => i.pesquisa === p && i.id.includes('_rh_indireta_'));
    assert.equal(dir.length, 6, p);
    assert.equal(ind.length, 6, p);
    assert.ok(dir.every((i) => i.fontes.map((f) => f.ano).join() === '2024,2023,2021'), `${p}: direta 2024, 2023 e 2021`);
    assert.ok(ind.every((i) => i.fontes.map((f) => f.ano).join() === '2024'), `${p}: indireta só 2024`);
    assert.deepEqual(dir.map((i) => i.fontes[0].rotulo).sort(), ind.map((i) => i.fontes[0].rotulo).sort());
  }
  // nenhum indicador reaproveita a mesma variável em dois cartões
  const usadas = CURADORIA.map((i) => `${i.pesquisa}|${i.fontes[0].ano}|${i.fontes[0].var}`);
  assert.equal(new Set(usadas).size, usadas.length);
});

// ---------------- arquivos leves e contexto entre páginas ----------------

import { ARQUIVOS_PAINEL, contextoDoIndicador, contextoMunic, usarArquivosLeves } from '../src/munic_painel';

const FONTE_LEVE = (pares: Record<string, Record<string, string[]>>, extra: Record<string, unknown> = {}) => ({
  versao: 1, pares, arquivos: { 'painel_respostas.parquet': ARQUIVOS_PAINEL.respostas, 'painel_agregados.parquet': ARQUIVOS_PAINEL.agregados }, ...extra,
});

test('arquivos leves: só com a fonte válida e TODOS os pares pedidos; ausente, incompleta ou diferente cai nos gold completos', () => {
  const pedidos = paresPedidos(selecionar(CURADORIA, 'munic', { tipo: 'ultima' }));
  // como o gerador: TODOS os pares de todas as edições da curadoria, por pesquisa
  const todos = (p: 'munic' | 'estadic') => Object.fromEntries([...paresPedidos(CURADORIA.filter((i) => i.pesquisa === p).map((ind) => ({ ind, fonte: null as never })).flatMap(({ ind }) => ind.fontes.map((fonte) => ({ ind, fonte }))))].map(([a, v]) => [String(a), v]));
  const completa = FONTE_LEVE({ munic: todos('munic') });
  assert.equal(usarArquivosLeves(completa, pedidos, 'munic'), true);
  // a curadoria derivada da própria seleção cobre a ESTADIC também; a pesquisa pedida é a que conta
  assert.equal(usarArquivosLeves(completa, paresPedidos(selecionar(CURADORIA, 'estadic', { tipo: 'ultima' })), 'estadic'), false); // sem pares da ESTADIC
  // ausência
  for (const f of [undefined, null, {}, 'x', 1, [], { versao: 1 }]) assert.equal(usarArquivosLeves(f, pedidos, 'munic'), false, JSON.stringify(f));
  // versão e arquivos
  assert.equal(usarArquivosLeves({ ...completa, versao: 2 }, pedidos, 'munic'), false);
  assert.equal(usarArquivosLeves({ ...completa, versao: '1' }, pedidos, 'munic'), false);
  assert.equal(usarArquivosLeves({ ...completa, arquivos: { 'painel_respostas.parquet': ARQUIVOS_PAINEL.respostas } }, pedidos, 'munic'), false);
  assert.equal(usarArquivosLeves({ ...completa, arquivos: { ...completa.arquivos, 'painel_agregados.parquet': '../outro.parquet' } }, pedidos, 'munic'), false); // caminho do JSON nunca vai ao SQL
  // incompleto: uma variável, um ano inteiro ou a lista malformada
  const sem1 = structuredClone(completa) as ReturnType<typeof FONTE_LEVE>;
  const [ano0, vars0] = [...pedidos][0];
  sem1.pares.munic[String(ano0)] = vars0.slice(1);
  assert.equal(usarArquivosLeves(sem1, pedidos, 'munic'), false);
  const semAno = structuredClone(completa) as ReturnType<typeof FONTE_LEVE>;
  delete semAno.pares.munic[String(ano0)];
  assert.equal(usarArquivosLeves(semAno, pedidos, 'munic'), false);
  const ruim = structuredClone(completa) as ReturnType<typeof FONTE_LEVE>;
  (ruim.pares.munic as Record<string, unknown>)[String(ano0)] = 'MREH016';
  assert.equal(usarArquivosLeves(ruim, pedidos, 'munic'), false);
  // pares a mais no arquivo não atrapalham; e uma edição explícita pede menos pares
  const extra = structuredClone(completa) as ReturnType<typeof FONTE_LEVE>;
  extra.pares.munic[String(ano0)] = [...vars0, 'Outra1'];
  assert.equal(usarArquivosLeves(extra, pedidos, 'munic'), true);
  const so2023 = paresPedidos(selecionar(CURADORIA, 'munic', { tipo: 'edicao', ano: 2023 }));
  assert.equal(usarArquivosLeves(completa, so2023, 'munic'), true);
  // nada pedido: não há o que ler (não escolhe o leve por vazio)
  assert.equal(usarArquivosLeves(completa, new Map(), 'munic'), false);
  // um indicador novo na curadoria, fora dos pares do arquivo, desliga o atalho
  const nova = new Map(pedidos); nova.set(2024, [...(pedidos.get(2024) ?? []), 'MNOVA1']);
  assert.equal(usarArquivosLeves(completa, nova, 'munic'), false);
});

test('contexto entre as páginas da MUNIC: só pesq, uf, cod e ano válidos; aba, var e grupo não vão; ESTADIC com UF abre a ficha do governo', () => {
  const ed = edicoesCuradas(CURADORIA);
  const c = (q: string, d: 'painel' | 'ficha' | 'avancado') => contextoMunic(q, d, ed);
  assert.equal(c('?pesq=munic&uf=GO&cod=5208707&ano=2024&aba=Agropec&var=Magr01&grupo=x', 'painel'), '?uf=GO&cod=5208707&ano=2024');
  assert.equal(c('?uf=GO&aba=Cultura&var=Mcul10', 'avancado'), '?uf=GO'); // voltar ao painel não carrega a pergunta
  assert.equal(c('', 'painel'), '');
  // inválidos somem em vez de virar outra coisa
  assert.equal(c('?uf=XX&cod=abc&ano=abc', 'painel'), '');
  assert.equal(c('?cod=520870', 'ficha'), '');
  // o ano do explorador que não é edição do painel não vai para o painel (mas segue nas outras páginas)
  assert.equal(c('?pesq=munic&ano=2019', 'painel'), '');
  assert.equal(c('?pesq=munic&ano=2019', 'ficha'), '?ano=2019');
  assert.equal(c('?pesq=munic&ano=2023', 'painel'), '?ano=2023');
  // ESTADIC
  assert.equal(c('?pesq=estadic&uf=GO', 'ficha'), '?pesq=estadic&uf=GO&cod=52'); // governo de GO, não o primeiro da lista
  assert.equal(c('?pesq=estadic&uf=GO', 'painel'), '?pesq=estadic&uf=GO');
  assert.equal(c('?pesq=estadic&cod=52', 'painel'), '?pesq=estadic&uf=GO&cod=52'); // o código manda
  assert.equal(c('?pesq=estadic&uf=SP&cod=52', 'ficha'), '?pesq=estadic&uf=GO&cod=52');
  assert.equal(c('?pesq=estadic&cod=5208707', 'ficha'), '?pesq=estadic'); // código inválido para a ESTADIC some; a pesquisa fica
  assert.equal(c('?pesq=estadic', 'avancado'), '?pesq=estadic');
  assert.equal(c('?pesq=estadic&ano=2013', 'painel'), '?pesq=estadic');
  // link antigo do explorador continua sendo reconhecido como tal
  assert.equal(ehLinkDoExplorador('?pesq=estadic&aba=Cultura&ano=2021'), true);
});

test('pessoal indireto: o texto do cartão só diz que é quadro distinto e que o sem valor fica fora da soma', () => {
  const ind = CURADORIA.find((i) => i.id === 'm_rh_indireta_36')!;
  const dir = CURADORIA.find((i) => i.id === 'm_rh_direta_16')!;
  for (const lang of ['pt', 'en'] as const) {
    const texto = contextoDoIndicador(ind, lang)!;
    assert.ok(texto.length > 0);
    assert.doesNotMatch(texto, /não se aplica|not applicable|autarquias|agencies/i); // nada de inferência sobre o "–"
  }
  assert.match(contextoDoIndicador(ind, 'pt')!, /quadro distinto/);
  assert.match(contextoDoIndicador(ind, 'pt')!, /sem valor válido ficam fora da soma/);
  assert.match(contextoDoIndicador(dir, 'pt')!, /administração direta/i); // a direta segue o texto da curadoria
  assert.equal(contextoDoIndicador(CURADORIA.find((i) => i.id === 'm_tr_lai')!, 'pt'), null);
});

test('CSV do explorador: (%) em escala 0 a 100; categoria que ninguém deu vale 0 só onde há respostas válidas, senão vazio', async () => {
  const { celulasDaResposta, distribuicao: dist } = await import('../src/munic_comum');
  const linhas = [
    { corte: 'brasil', grupo: 'BR', valor_txt: 'Sim', valida: true, n: 30, soma: null }, { corte: 'brasil', grupo: 'BR', valor_txt: 'Não', valida: true, n: 10, soma: null },
    { corte: 'uf', grupo: 'GO', valor_txt: 'Sim', valida: true, n: 4, soma: null },
    { corte: 'uf', grupo: 'AC', valor_txt: 'Recusa', valida: false, n: 2, soma: null },
  ];
  const d = (corte: string, grupo: string) => dist(linhas as never, corte, grupo);
  assert.deepEqual(celulasDaResposta(d('brasil', 'BR'), 'Sim'), [30, 75]); // 75, não 0,75
  assert.deepEqual(celulasDaResposta(d('brasil', 'BR'), 'Não'), [10, 25]);
  assert.deepEqual(celulasDaResposta(d('uf', 'GO'), 'Não'), [0, 0]); // GO respondeu e ninguém disse Não: zero real
  assert.deepEqual(celulasDaResposta(d('uf', 'AC'), 'Sim'), [null, null]); // AC só tem resposta inválida: sem número, não zero
  assert.deepEqual(celulasDaResposta(d('uf', 'RR'), 'Sim'), [null, null]); // sem nenhuma linha
});
