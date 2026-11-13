/**
 * Regressão do painel automático de clima: só funções puras (src/clima_comum.ts), sem arquivos de dados.
 * As rotas e o resumo contra os gold ficam em testes/consultas.test.ts ("painel de clima").
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acumulados, anosCompletos, anosDaLacuna, buscaClima, buscarMunicipios, cabecalhoAnomalia, comUnidade, comparacaoTxt, diferencaTxt, fraseHabitual, lerEscolhaClima, lerResumo, medidaDe,
  montarMapaCalor, periodoDoAcumulado, posicoesCompetitivas, resolverAno, semUnidade, serieAnualContinua, tabelaAnualClima, tabelaMensalClima, tomDe, unidadeDiferenca, variacaoTxt,
  anomaliaExportada, MEDIDAS, type Territorio,
} from '../src/clima_comum';

const TERR: Territorio[] = [
  { cod: 2605459, nome: 'Fernando de Noronha', uf: 'PE' }, { cod: 5208707, nome: 'Goiânia', uf: 'GO' }, { cod: 5208905, nome: 'Goiás', uf: 'GO' },
  { cod: 5208004, nome: 'Goianápolis', uf: 'GO' }, { cod: 2202505, nome: 'Caracol', uf: 'PI' }, { cod: 3550308, nome: 'São Paulo', uf: 'SP' }, { cod: 4101101, nome: 'Andirá', uf: 'PR' },
];
const sp = (q: string) => new URLSearchParams(q);

test('as seis medidas, na ordem dos cartões, com unidade e tipo de comparação corretos', () => {
  assert.deepEqual(MEDIDAS.map((m) => m.codigo), ['chuva_mm', 'temperatura_c', 'orvalho_c', 'umid_solo_pct', 'evap_mm', 'radiacao_wm2']);
  assert.deepEqual(MEDIDAS.filter((m) => m.relativa).map((m) => m.codigo), ['chuva_mm', 'evap_mm']); // % só na chuva e na evaporação
  assert.deepEqual(MEDIDAS.filter((m) => m.soma).map((m) => m.codigo), ['chuva_mm', 'evap_mm']);
  assert.equal(medidaDe('orvalho_c')!.unidade, '°C');
  assert.match(medidaDe('orvalho_c')!.ajuda(), /úmido|humid/i); // explica a umidade do ar
  assert.match(medidaDe('evap_mm')!.ajuda(), /ET0/); // evaporação não é ET0
  assert.equal(medidaDe('xx'), null);
});

test('escolha pela URL: município, UF, medida e ano válidos passam intactos', () => {
  const e = lerEscolhaClima(sp('variavel=temperatura_c&uf=GO&cod=5208707&ano=2024'), TERR);
  assert.equal(e.uf, 'GO');
  assert.equal(e.cod, 5208707);
  assert.equal(e.municipio?.nome, 'Goiânia');
  assert.equal(e.variavel, 'temperatura_c');
  assert.equal(e.ano, 2024);
  assert.deepEqual(e.avisos, []);
  assert.equal(e.bloqueio, null);
  // só o código: a UF vem do município, sem aviso
  assert.equal(lerEscolhaClima(sp('cod=5208707'), TERR).uf, 'GO');
});

test('código inexistente bloqueia o município: não vira UF nem Brasil em silêncio', () => {
  for (const q of ['cod=9999999&uf=GO', 'cod=abc&uf=GO', 'cod=123']) {
    const e = lerEscolhaClima(sp(q), TERR);
    assert.ok(e.bloqueio, q);
    assert.equal(e.municipio, null);
    assert.equal(e.cod, null);
    assert.ok(e.avisos.some((a) => a.tipo === 'cod_desconhecido'));
  }
});

test('Fernando de Noronha existe no cadastro; a falta de cobertura é conferida pelo resumo, e a UF não substitui o município', () => {
  const e = lerEscolhaClima(sp('uf=PE&cod=2605459'), TERR);
  assert.equal(e.municipio?.nome, 'Fernando de Noronha');
  assert.equal(e.cod, 2605459); // continua sendo Noronha: a tela vê o resumo vazio e mostra "sem dados", não os números de PE
  assert.equal(e.bloqueio, null);
});

test('UF divergente do município: o município vale e há aviso; UF inexistente: aviso, Brasil', () => {
  const e = lerEscolhaClima(sp('uf=PE&cod=5208707'), TERR);
  assert.equal(e.uf, 'GO');
  assert.deepEqual(e.avisos.map((a) => a.tipo), ['uf_diverge']);
  const u = lerEscolhaClima(sp('uf=XX'), TERR);
  assert.equal(u.uf, '');
  assert.deepEqual(u.avisos, [{ tipo: 'uf_invalida', valor: 'XX' }]);
  assert.equal(lerEscolhaClima(sp('uf=go'), TERR).uf, 'GO');
});

test('medida e ano inválidos viram aviso com o valor pedido; ano de lacuna não é trocado', () => {
  const e = lerEscolhaClima(sp('variavel=xx&ano=abc'), TERR);
  assert.equal(e.variavel, null);
  assert.equal(e.ano, null);
  assert.deepEqual(e.avisos.map((a) => a.tipo), ['variavel_invalida', 'ano_invalido']);
  // ano 2023 é um ano válido na URL; a cobertura é que diz se há dado
  assert.equal(lerEscolhaClima(sp('variavel=evap_mm&ano=2023'), TERR).ano, 2023);
});

test('território ainda carregando: o município fica pendente (não é tratado como inexistente)', () => {
  const e = lerEscolhaClima(sp('cod=5208707&uf=GO'), null);
  assert.equal(e.pendente, true);
  assert.equal(e.bloqueio, null);
  assert.equal(e.cod, 5208707);
});

test('o menu e os links carregam variavel, uf, cod e ano (e só eles); mudanças aplicam por cima', () => {
  assert.equal(buscaClima('?variavel=evap_mm&uf=GO&cod=5208707&ano=2023&ordem=menor&lang=en&ente=1'), '?variavel=evap_mm&uf=GO&cod=5208707&ano=2023');
  assert.equal(buscaClima(''), '');
  assert.equal(buscaClima('?uf=GO&cod=5208707', { variavel: 'temperatura_c', cod: null }), '?uf=GO&variavel=temperatura_c');
  // o link do ranking mantém o ano do ranking
  assert.equal(buscaClima('?variavel=temperatura_c&ano=2010', { cod: '5208707', uf: 'GO' }), '?variavel=temperatura_c&ano=2010&cod=5208707&uf=GO');
});

test('cobertura efetiva dos anos: a lacuna 2022–2024 sai da lista e o ano pedido nunca é trocado', () => {
  const evap = { ano_de: 1979, ano_ate: 2025, anos_lacuna: '2022,2023,2024' };
  const anos = anosCompletos(evap);
  assert.equal(anos.length, 44);
  assert.equal(anos[0], 2025);
  assert.equal(anos[anos.length - 1], 1979);
  assert.ok(![2022, 2023, 2024].some((a) => anos.includes(a)));
  assert.ok(anos.includes(2021) && anos.includes(2025));
  assert.deepEqual(anosDaLacuna(evap), [2022, 2023, 2024]);
  assert.equal(anosCompletos({ ano_de: 1981, ano_ate: 2025, anos_lacuna: null }).length, 45);
  assert.deepEqual(anosCompletos(null), []);
  // ano 2023 de evaporação: guardado, marcado como ausente, com vizinhos sugeridos; nada de "2026"
  const r = resolverAno(2023, anos, anos[0]);
  assert.equal(r.ano, 2023);
  assert.equal(r.ausente, true);
  assert.deepEqual(r.sugestoes, [2025, 2021, 2020]);
  assert.deepEqual(resolverAno(2021, anos, 2025), { ano: 2021, ausente: false, sugestoes: [] });
  assert.deepEqual(resolverAno(null, anos, 2025), { ano: 2025, ausente: false, sugestoes: [] });
});

test('o eixo anual é contínuo: o ano sem total fica no eixo com valor nulo (não liga 2021 a 2025)', () => {
  const linhas = [...Array(43)].map((_, i) => ({ ano: 1979 + i })).concat([{ ano: 2025 }]).filter((l) => l.ano !== 2022); // 1979–2021 e 2025
  const eixo = serieAnualContinua(linhas, 1979, 2025);
  assert.equal(eixo.length, 47);
  assert.deepEqual(eixo.filter((e) => e.linha === null).map((e) => e.ano), [2022, 2023, 2024]);
  assert.equal(eixo[eixo.length - 1].linha?.ano, 2025);
});

test('acumulados de chuva só valem com todos os meses; ausência nunca vira zero; zero real conta', () => {
  const base = { variavel: 'chuva_mm', ano_de: 1981, ano_ate: 2025, n_anos: 45, anos_lacuna: null, ate: 202609, valor: 1500, normal: 1600, anomalia_pct: -0.06, anomalia: null,
    parcial_meses: 9, parcial_valor: 1200, parcial_normal: 1300, parcial_anomalia_pct: -0.07, parcial_anomalia: null, acum_fim: 202609 };
  const completo = lerResumo({ ...base, acum3_cob: 3, acum3_valor: 120, acum3_normal: 100, acum6_cob: 6, acum6_valor: 0, acum6_normal: 250, acum12_cob: 12, acum12_valor: 1500, acum12_normal: 1600 });
  const [a3, a6, a12] = acumulados(completo);
  assert.deepEqual([a3.meses, a6.meses, a12.meses], [3, 6, 12]);
  assert.equal(a3.completo, true);
  assert.ok(Math.abs(a3.variacao! - 0.2) < 1e-12);
  assert.equal(a6.valor, 0); // zero real: acumulado completo com zero
  assert.equal(a6.completo, true);
  assert.equal(a6.variacao, -1);
  const falta = acumulados(lerResumo({ ...base, acum3_cob: 3, acum3_valor: 120, acum3_normal: 100, acum6_cob: 6, acum6_valor: 80, acum6_normal: 250, acum12_cob: 11, acum12_valor: null, acum12_normal: null }));
  assert.equal(falta[2].valor, null);
  assert.equal(falta[2].completo, false);
  assert.equal(falta[2].cobertura, 11);
  assert.equal(falta[2].variacao, null);
  assert.deepEqual(acumulados(null), []);
  assert.equal(periodoDoAcumulado(202609, 3), 'jul–set/2026');
  assert.equal(periodoDoAcumulado(202609, 12), 'out/2025–set/2026');
  assert.equal(periodoDoAcumulado(null, 3), '–');
});

test('precisão adaptativa: a normal de 0,43 mm não vira 0 mm, e +7.615,7% (Caracol/PI, 06/1985) não é cortado', () => {
  assert.equal(comUnidade(0.4262385, 'mm'), '0,43 mm');
  assert.equal(comUnidade(32.8874, 'mm'), '33 mm');
  assert.equal(comUnidade(3.24, 'mm'), '3,2 mm');
  assert.equal(comUnidade(0, 'mm'), '0 mm'); // zero real
  assert.equal(semUnidade(null, 'mm'), '–');
  assert.equal(variacaoTxt(32.8874 / 0.4262385 - 1), '+7.615,7%');
  assert.equal(comparacaoTxt(32.8874, 0.4262385, true, 'mm'), '+7.615,7% (+32,5 mm)');
  assert.equal(comparacaoTxt(10, 0, true, 'mm'), '+10,0 mm'); // normal zero: só a diferença em mm, sem dividir por zero
  assert.equal(comparacaoTxt(null, 5, true, 'mm'), '–');
});

test('solo: diferença em pontos percentuais (nunca %), nível em %; temperatura em °C', () => {
  assert.equal(unidadeDiferenca('%'), 'p.p.');
  assert.equal(unidadeDiferenca('°C'), '°C');
  assert.equal(diferencaTxt(34.1305 - 36.4266, '%'), '−2,3 p.p.');
  assert.equal(comUnidade(34.1305, '%'), '34,1 %');
  assert.equal(comparacaoTxt(34.1305, 36.4266, false, '%'), '−2,3 p.p.');
  assert.equal(diferencaTxt(0.47, '°C'), '+0,5 °C');
  assert.equal(fraseHabitual(-0.0551, true, 'mm'), '5,5% abaixo do habitual');
  assert.equal(fraseHabitual(-2.2961, false, '%'), '2,3 p.p. abaixo do habitual');
  assert.equal(fraseHabitual(null, true, 'mm'), 'sem normal para comparar');
  assert.equal(tomDe(0.1), 'acima');
  assert.equal(tomDe(-1), 'abaixo');
  assert.equal(tomDe(null), 'sem');
});

test('exportação: percentual em escala 100 com cabeçalho explícito; p.p. no solo', () => {
  assert.ok(Math.abs(anomaliaExportada(-0.097866637, true)! - -9.7866637) < 1e-9);
  assert.equal(anomaliaExportada(-2.2961, false), -2.2961);
  assert.equal(anomaliaExportada(null, true), null);
  assert.equal(cabecalhoAnomalia(true, 'mm'), 'Variação sobre a normal (%)');
  assert.equal(cabecalhoAnomalia(false, '%'), 'Diferença para a normal (p.p.)');
  assert.equal(cabecalhoAnomalia(false, '°C'), 'Diferença para a normal (°C)');
});

test('exportação anual: o ano sem total aparece vazio e explicado; período e tipo declarados', () => {
  const chuva = medidaDe('chuva_mm')!;
  const evap = medidaDe('evap_mm')!;
  const tab = tabelaAnualClima({ medida: evap, rotuloMedida: 'Evaporação', de: 2021, ate: 2025, metadados: [['Recorte', 'Brasil']],
    anos: [{ ano: 2021, valor: 1084, normal: 1116, anomalia: -0.029 }, { ano: 2025, valor: 1071, normal: 1116, anomalia: -0.0405 }] });
  assert.equal(tab.linhas.length, 5);
  const l2023 = tab.linhas.find((l) => l[0] === 2023)!;
  assert.deepEqual(l2023.slice(1, 4), [null, null, null]);
  assert.match(String(l2023[4]), /sem total anual/);
  assert.ok(Math.abs(Number(tab.linhas.find((l) => l[0] === 2025)![3]) - -4.05) < 1e-9); // −4,05 e não −0,0405
  assert.equal(tab.colunas[3], 'Variação sobre a normal (%)');
  assert.ok(tab.metadados.some(([k, v]) => k === 'Período exportado' && v === '2021–2025'));
  assert.ok(tab.metadados.some(([k, v]) => k === 'Tipo de comparação' && /relativa/.test(v)));
  assert.equal(tabelaAnualClima({ medida: chuva, rotuloMedida: 'Chuva', de: 1, ate: 0, anos: [], metadados: [] }).linhas.length, 0);
});

test('exportação mensal: ano exibido ou série toda, com período, anomalia, condição e meses sem dado', () => {
  const chuva = medidaDe('chuva_mm')!;
  const linhas: { ano: number; mes: number; valor: number | null; normal: number | null }[] = [];
  for (let ano = 2023; ano <= 2024; ano++) for (let mes = 1; mes <= 12; mes++) if (!(ano === 2024 && mes === 5)) linhas.push({ ano, mes, valor: mes === 6 ? 0 : 10 + mes, normal: 10 });
  linhas.push({ ano: 2025, mes: 1, valor: 5, normal: 0.4262 });
  const serie = tabelaMensalClima({ medida: chuva, rotuloMedida: 'Chuva', linhas, escopo: 'serie', ano: 2024, ate: 202501, metadados: [] });
  assert.equal(serie.linhas.length, 25); // 24 + jan/2025, com a lacuna de mai/2024 como linha explícita
  const lacuna = serie.linhas.find((l) => l[0] === 2024 && l[1] === 5)!;
  assert.equal(lacuna[2], null);
  assert.match(String(lacuna[5]), /sem dado/);
  assert.ok(serie.metadados.some(([k, v]) => k === 'Meses sem dado no período' && v === '1'));
  assert.ok(serie.metadados.some(([k, v]) => k === 'Período exportado' && v === '01/2023 a 01/2025'));
  const ano = tabelaMensalClima({ medida: chuva, rotuloMedida: 'Chuva', linhas, escopo: 'ano', ano: 2024, ate: 202501, metadados: [] });
  assert.equal(ano.linhas.length, 12);
  assert.ok(ano.linhas.every((l) => l[0] === 2024));
  assert.ok(ano.metadados.some(([k, v]) => k === 'Período exportado' && v === '01/2024 a 12/2024'));
  // o zero real de junho é dado, com variação −100%, e a condição diz "dado"
  const zero = ano.linhas.find((l) => l[1] === 6)!;
  assert.equal(zero[2], 0);
  assert.equal(zero[4], -100);
  assert.equal(zero[5], 'dado');
  assert.equal(ano.colunas[4], 'Variação sobre a normal (%)');
  // ano em curso: só até o último mês publicado, sem inventar meses futuros
  const curso = tabelaMensalClima({ medida: chuva, rotuloMedida: 'Chuva', linhas, escopo: 'ano', ano: 2025, ate: 202501, metadados: [] });
  assert.equal(curso.linhas.length, 1);
  assert.equal(curso.linhas[0][4], (5 / 0.4262 - 1) * 100);
});

test('mapa de calor: lacuna explícita, zero real preservado, meses futuros fora e escala simétrica', () => {
  const linhas: { ano: number; mes: number; valor: number | null; normal: number | null }[] = [];
  for (let ano = 2020; ano <= 2022; ano++) for (let mes = 1; mes <= 12; mes++) {
    if (ano === 2021 && mes >= 9) continue; // lacuna (evap/radiação: 09/2021–… no exemplo)
    if (ano === 2022 && mes > 3) continue; // futuro (último mês publicado: 03/2022)
    linhas.push({ ano, mes, valor: ano === 2020 && mes === 7 ? 0 : 100 + mes, normal: 100 });
  }
  const mapa = montarMapaCalor(linhas, true, 202203);
  assert.deepEqual(mapa.anos, [2020, 2021, 2022]);
  assert.equal(mapa.lacunas, 4); // set–dez/2021
  assert.equal(mapa.celulas.filter((c) => c.ano === 2022).length, 3); // só jan–mar/2022: nada de mês futuro
  const zero = mapa.celulas.find((c) => c.ano === 2020 && c.mes === 7)!;
  assert.equal(zero.tipo, 'dado'); // zero real é dado, não lacuna
  assert.equal(zero.anomalia, -1);
  const gap = mapa.celulas.find((c) => c.ano === 2021 && c.mes === 10)!;
  assert.equal(gap.tipo, 'lacuna');
  assert.equal(gap.valor, null);
  assert.equal(gap.anomalia, null);
  assert.ok(mapa.limite > 0 && Number.isFinite(mapa.limite));
  // diferença absoluta (temperatura): sem percentual; normal ausente = "sem normal", não lacuna
  const abs = montarMapaCalor([{ ano: 2020, mes: 1, valor: 26, normal: 25 }, { ano: 2020, mes: 2, valor: 26, normal: null }], false, 202002);
  assert.equal(abs.celulas[0].anomalia, 1);
  assert.equal(abs.celulas[1].tipo, 'sem_normal');
  assert.equal(abs.semNormal, 1);
  assert.deepEqual(montarMapaCalor([], true, null), { anos: [], celulas: [], limite: 1, lacunas: 0, semNormal: 0 });
  // um mês extremo (+7.615%) não define a escala sozinho (percentil 95): a escala não explode
  const extremo = montarMapaCalor([...Array(40)].map((_, i) => ({ ano: 2000 + Math.floor(i / 12), mes: (i % 12) + 1, valor: 110, normal: 100 })).concat([{ ano: 2003, mes: 5, valor: 32.9, normal: 0.43 }]), true, 200305);
  assert.ok(extremo.limite < 1, `limite ${extremo.limite}`);
});

test('posições com empate competitivo (1, 2, 2, 4), como nos demais painéis', () => {
  assert.deepEqual(posicoesCompetitivas([10, 9, 9, 7]), [1, 2, 2, 4]);
  assert.deepEqual(posicoesCompetitivas([5, 5, 5]), [1, 1, 1]);
  assert.deepEqual(posicoesCompetitivas([]), []);
});

test('busca de município pelo nome: sem acento, começo do nome primeiro, restrita à UF', () => {
  assert.deepEqual(buscarMunicipios(TERR, 'goian').map((m) => m.nome), ['Goiânia', 'Goianápolis']);
  assert.deepEqual(buscarMunicipios(TERR, 'GOIAS').map((m) => m.nome), ['Goiás']);
  assert.deepEqual(buscarMunicipios(TERR, 'noronha').map((m) => m.cod), [2605459]); // contém: entra
  assert.deepEqual(buscarMunicipios(TERR, 'go', 'PE'), []);
  assert.deepEqual(buscarMunicipios(TERR, 'g'), []); // mínimo de 2 letras
  assert.deepEqual(buscarMunicipios(TERR, 'sao paulo').map((m) => m.nome), ['São Paulo']);
});
