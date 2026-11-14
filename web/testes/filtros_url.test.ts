/**
 * Filtros globais da URL (ano, uf, ente) e teclado da busca de ente: src/filtros_url.ts (as mesmas funções que contexto.tsx usa).
 * Executar:  npx vite build --ssr testes/filtros_url.test.ts --outDir testes/.saida/filtros_url --emptyOutDir --logLevel warn && node --test testes/.saida/filtros_url/filtros_url.test.js
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cadastroEfetivoSaude, COD_NORONHA, ENTE_NORONHA, focoValido, lerAno, lerEnte, lerFiltros, lerUf, rolagemParaOpcao, teclaBusca, tipoDeEnte, type Cenario, type EstadoBusca } from '../src/filtros_url';

type E = { cod_ibge: number; nome: string; uf: string; esfera: 'M' | 'E' | 'D' };
const CADASTRO: E[] = [
  { cod_ibge: 5208707, nome: 'Goiânia', uf: 'GO', esfera: 'M' },
  { cod_ibge: 3550308, nome: 'São Paulo', uf: 'SP', esfera: 'M' },
  { cod_ibge: 35, nome: 'São Paulo', uf: 'SP', esfera: 'E' },
  { cod_ibge: 53, nome: 'Distrito Federal', uf: 'DF', esfera: 'D' },
];
const buscar = (cod: number) => CADASTRO.find((e) => e.cod_ibge === cod);
const FINANCAS: Cenario = { anos: [2013, 2014, 2025], aceitaUltimo: false, avisoProprioDeAnoNumerico: false };
const SAUDE: Cenario = { anos: [2013, 2024], aceitaUltimo: true, avisoProprioDeAnoNumerico: true };
const ler = (ano: string | null, uf: string | null, ente: string | null, c = FINANCAS) => lerFiltros({ ano, uf, ente }, c, buscar);

test('UF: caixa e espaços são normalizados; vazio é ausência; o resto é inválido', () => {
  assert.deepEqual(lerUf(' go '), { uf: 'GO', invalida: null });
  assert.deepEqual(lerUf('   '), { uf: null, invalida: null });
  assert.deepEqual(lerUf(null), { uf: null, invalida: null });
  assert.deepEqual(lerUf('XX'), { uf: null, invalida: 'XX' });
  assert.deepEqual(lerUf('Goiás'), { uf: null, invalida: 'Goiás' });
});

test('ente: código inexistente ou com lixo é inválido; Brasília (5300108) resolve para o DF (53)', () => {
  assert.equal(lerEnte(' 5208707 ', buscar).ente?.nome, 'Goiânia');
  assert.deepEqual(lerEnte('999', buscar), { ente: null, invalido: '999' });
  assert.deepEqual(lerEnte('5208707abc', buscar), { ente: null, invalido: '5208707abc' });
  assert.deepEqual(lerEnte('', buscar), { ente: null, invalido: null });
  assert.equal(lerEnte('5300108', buscar).ente?.cod_ibge, 53);
  assert.equal(lerEnte('53', buscar).ente?.cod_ibge, 53);
  // sem o 53 no cadastro não se inventa ente: 5300108 continua inválido
  assert.equal(lerEnte('5300108', (c) => CADASTRO.find((e) => e.cod_ibge === c && c !== 53)).invalido, '5300108');
});

test('UF e ente inválidos: o fallback é o de antes, com aviso e só os parâmetros inválidos para remover', () => {
  const r = ler(null, 'XX', '999');
  assert.equal(r.ente, null);
  assert.equal(r.uf, null);
  assert.deepEqual(r.avisos.map((a) => a.tipo), ['uf_invalida', 'ente_invalido']);
  // ente válido com UF inválida: o ente vale e só a UF é avisada
  const v = ler(null, 'zz', '5208707');
  assert.equal(v.ente?.cod_ibge, 5208707);
  assert.equal(v.uf, 'GO');
  assert.deepEqual(v.avisos.map((a) => a.tipo), ['uf_invalida']);
  // UF válida em minúsculas com ente inválido: a UF segue valendo
  const w = ler(null, ' sp ', '123');
  assert.equal(w.uf, 'SP');
  assert.deepEqual(w.avisos, [{ tipo: 'ente_invalido', valor: '123' }]);
});

test('UF válida em conflito com o ente válido: prevalece o ente e o aviso explica; sem conflito não há aviso', () => {
  const c = ler(null, 'SP', '5208707');
  assert.equal(c.ente?.nome, 'Goiânia');
  assert.equal(c.uf, 'GO');
  assert.deepEqual(c.avisos, [{ tipo: 'uf_diverge', uf: 'SP', enteUf: 'GO' }]);
  assert.deepEqual(ler(null, 'go', '5208707').avisos, []);
  // Brasília no endereço com UF DF: mesmo recorte, sem conflito
  assert.deepEqual(ler(null, 'DF', '5300108').avisos, []);
  assert.equal(ler(null, 'DF', '5300108').ente?.cod_ibge, 53);
});

test('ano: numérico fora da base avisa em finanças com o pedido e o ano usado; dentro da base e ausente não avisam', () => {
  assert.deepEqual(ler('1999', null, null).avisos, [{ tipo: 'ano_fora', pedido: 1999, usado: 2025 }]);
  assert.equal(ler('1999', null, null).ano, 2025);
  assert.deepEqual(ler('2014', null, null).avisos, []);
  assert.equal(ler('2014', null, null).ano, 2014);
  assert.deepEqual(ler(null, null, null).avisos, []);
  assert.deepEqual(ler('  ', null, null).avisos, []);
});

test('ano não numérico nunca vira NaN: ano e anoForaDaBase ficam numéricos/nulos e o aviso traz o texto', () => {
  for (const ruim of ['abc', '20x4', '2023.5', '-2020', 'null', 'NaN']) {
    const r = ler(ruim, null, null);
    assert.equal(r.ano, 2025, ruim);
    assert.equal(r.anoForaDaBase, null, ruim);
    assert.ok(Number.isFinite(r.ano), ruim);
    assert.deepEqual(r.avisos, [{ tipo: 'ano_invalido', valor: ruim, usado: 2025 }], ruim);
  }
  // em todas as áreas (aqui, saúde, que tem aviso próprio só para ano numérico)
  assert.deepEqual(ler('abc', null, null, SAUDE).avisos, [{ tipo: 'ano_invalido', valor: 'abc', usado: 2024 }]);
  // valor enorme é cortado para a tela
  const longo = ler('x'.repeat(100), null, null).avisos[0];
  assert.ok(longo.tipo === 'ano_invalido' && longo.valor.length <= 33);
});

test('ano numérico fora da base em trabalho e saúde: sem aviso global (as páginas avisam), mas anoForaDaBase segue para elas', () => {
  const r = ler('2030', null, null, SAUDE);
  assert.deepEqual(r.avisos, []);
  assert.equal(r.anoForaDaBase, 2030);
  assert.equal(r.ano, 2024);
});

test('ano=ultimo: vale na saúde (também em caixa diferente e com espaços); em outro domínio vira aviso e usa o último ano', () => {
  const s = ler(' Ultimo ', null, null, SAUDE);
  assert.equal(s.ultimo, true);
  assert.deepEqual(s.avisos, []);
  const f = ler('ultimo', null, null);
  assert.equal(f.ultimo, false);
  assert.equal(f.ano, 2025);
  assert.deepEqual(f.avisos, [{ tipo: 'ultimo_indisponivel', usado: 2025 }]);
});

test('lerAno distingue os pedidos', () => {
  assert.deepEqual(lerAno('2020'), { tipo: 'ano', valor: 2020 });
  assert.deepEqual(lerAno('ultimo'), { tipo: 'ultimo' });
  assert.deepEqual(lerAno(null), { tipo: 'nenhum' });
  assert.deepEqual(lerAno('dois mil'), { tipo: 'texto', valor: 'dois mil' });
  assert.deepEqual(lerAno('0000'), { tipo: 'texto', valor: '0000' });
  assert.deepEqual(ler('0000', null, null, SAUDE).avisos, [{ tipo: 'ano_invalido', valor: '0000', usado: 2024 }]);
});

const estado = (p: Partial<EstadoBusca> = {}): EstadoBusca => ({ aberto: true, foco: 0, total: 5, texto: '', navegou: false, ...p });

test('teclado: Enter sem texto e sem navegação não escolhe ninguém, mesmo com a lista aberta', () => {
  const r = teclaBusca('Enter', estado());
  assert.equal(r.selecionar, null);
  assert.equal(r.impedir, false);
});

test('teclado: Enter escolhe com texto, ou depois de navegar com as setas, e só com a lista aberta', () => {
  assert.equal(teclaBusca('Enter', estado({ texto: 'goi' })).selecionar, 0);
  assert.equal(teclaBusca('Enter', estado({ texto: '  ' })).selecionar, null);
  const desceu = teclaBusca('ArrowDown', estado());
  assert.deepEqual([desceu.foco, desceu.navegou, desceu.impedir], [1, true, true]);
  const r = teclaBusca('Enter', estado({ foco: desceu.foco, navegou: desceu.navegou }));
  assert.equal(r.selecionar, 1);
  assert.equal(r.impedir, true);
  // lista fechada (Escape): nada é escolhido, nem com texto nem depois de navegar
  assert.equal(teclaBusca('Enter', estado({ aberto: false, texto: 'goi', navegou: true })).selecionar, null);
  // lista aberta mas sem opções
  assert.equal(teclaBusca('Enter', estado({ total: 0, texto: 'zzz' })).selecionar, null);
});

test('teclado: setas não rolam a página, abrem a lista fechada sem escolher e mantêm o índice válido', () => {
  const fechada = teclaBusca('ArrowDown', estado({ aberto: false, foco: 3 }));
  assert.deepEqual([fechada.aberto, fechada.foco, fechada.navegou, fechada.impedir, fechada.selecionar], [true, 3, false, true, null]);
  assert.equal(teclaBusca('ArrowUp', estado({ foco: 0 })).foco, 0);
  assert.equal(teclaBusca('ArrowDown', estado({ foco: 4 })).foco, 4);
  // índice antigo maior que a lista nova (o texto filtrou): volta para dentro dos limites
  assert.equal(teclaBusca('ArrowDown', estado({ foco: 40, total: 3 })).foco, 2);
  assert.equal(teclaBusca('ArrowUp', estado({ foco: 40, total: 3 })).foco, 1);
  const vazia = teclaBusca('ArrowDown', estado({ total: 0 }));
  assert.deepEqual([vazia.foco, vazia.impedir], [0, true]);
  assert.equal(focoValido(-3, 4), 0);
  assert.equal(focoValido(9, 0), 0);
});

test('teclado: Escape fecha e zera a navegação (a seleção seguinte exige navegar de novo); fechado, não engole a tecla', () => {
  const e = teclaBusca('Escape', estado({ foco: 2, navegou: true }));
  assert.deepEqual([e.aberto, e.navegou, e.impedir], [false, false, true]);
  assert.equal(teclaBusca('Enter', estado({ aberto: e.aberto, foco: e.foco, navegou: e.navegou, texto: '' })).selecionar, null);
  assert.equal(teclaBusca('Escape', estado({ aberto: false })).impedir, false);
  // outras teclas não mexem em nada
  const x = teclaBusca('a', estado({ foco: 2, navegou: true }));
  assert.deepEqual([x.aberto, x.foco, x.navegou, x.selecionar, x.impedir], [true, 2, true, null, false]);
});

test('rolagem da lista: ajusta só quando a opção está fora da janela visível', () => {
  assert.equal(rolagemParaOpcao(100, 30, 90, 200), 90); // visível
  assert.equal(rolagemParaOpcao(40, 30, 90, 200), 40); // acima: sobe até o topo da opção
  assert.equal(rolagemParaOpcao(300, 30, 90, 200), 130); // abaixo: desce até o fim da opção
});

test('Noronha: só o cadastro efetivo da saúde o inclui; resolve com UF PE sem conflito e nunca é "município" na interface', () => {
  const saudeCad = cadastroEfetivoSaude(CADASTRO, ENTE_NORONHA);
  const buscarSaude = (cod: number) => saudeCad.find((e) => e.cod_ibge === cod);
  assert.equal(saudeCad.length, CADASTRO.length + 1);
  assert.equal(CADASTRO.length, 4, 'a lista recebida não é alterada');
  assert.equal(CADASTRO.some((e) => e.cod_ibge === COD_NORONHA), false);
  const r = lerFiltros({ ano: '2024', uf: 'PE', ente: String(COD_NORONHA) }, SAUDE, buscarSaude);
  assert.equal(r.ente?.cod_ibge, COD_NORONHA);
  assert.equal(r.uf, 'PE');
  assert.equal(r.ente?.esfera, 'M'); // compatibilidade interna com o FNS
  assert.deepEqual(r.avisos, []);
  // com a UF errada vale o ente (e o aviso explica); sem o cadastro da saúde (outras áreas) o código segue inválido
  assert.deepEqual(lerFiltros({ ano: null, uf: 'SP', ente: String(COD_NORONHA) }, SAUDE, buscarSaude).avisos, [{ tipo: 'uf_diverge', uf: 'SP', enteUf: 'PE' }]);
  const fiscal = lerFiltros({ ano: null, uf: 'PE', ente: String(COD_NORONHA) }, FINANCAS, buscar);
  assert.equal(fiscal.ente, null);
  assert.deepEqual(fiscal.avisos, [{ tipo: 'ente_invalido', valor: String(COD_NORONHA) }]);
  // não duplica se o cadastro passar a trazê-lo
  assert.equal(cadastroEfetivoSaude(saudeCad, ENTE_NORONHA).length, saudeCad.length);
  assert.equal(tipoDeEnte(ENTE_NORONHA), 'distrito_estadual');
  assert.equal(tipoDeEnte(CADASTRO[0]), 'municipio');
  assert.equal(tipoDeEnte(CADASTRO[2]), 'estado');
  assert.equal(tipoDeEnte(CADASTRO[3]), 'df');
});
