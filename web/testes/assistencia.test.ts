import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { injetarManifesto, type ManifestoBruto } from '../src/manifesto';
import { linhaSocial, linhaIndicadorSocial, obterGrupoSocial, obterMetaSocial, obterRankingSocial, type GrupoSocial, type IndicadorSocial, type MetaSocial } from '../src/assistencia_dados';
import { buscaEntreAreas } from '../src/navegacao';
import { contextoAssistencia, ASSISTENCIA } from '../../worker/src/sistema_assistencia.js';
import { compararPib, obterEconomia, type AnoEconomia, type MetaEconomia } from '../src/assistencia_economia';
import { conceitoSocial } from '../src/assistencia_ajuda';

const money = { id: 'pbf_cgu_valor', fonte: 'pbf' } as IndicadorSocial;
const family = { id: 'pbf_familias_atendidas', fonte: 'pbf' } as IndicadorSocial;
const group: GrupoSocial = { grupo: 'BR', series: { cadunico: [], bpc: [], pbf: [
  { competencia: 202603, valores: { pbf_familias_atendidas: 10, pbf_cgu_valor: 100 }, condicoes: {} },
  { competencia: 202606, valores: { pbf_cgu_valor: 0 }, condicoes: {} },
  { competencia: 202609, valores: { pbf_cgu_valor: null }, condicoes: { pbf_cgu_valor: 'suprimido' } },
] } };
test('Último de cada indicador mantém datas diferentes, zero e supressão recente', () => {
  const p = linhaSocial(group, 'pbf')!;
  assert.equal(p.valores.pbf_familias_atendidas, 10);
  assert.equal(p.referencias?.pbf_familias_atendidas, 202603);
  assert.equal(p.valores.pbf_cgu_valor, null);
  assert.equal(p.condicoes.pbf_cgu_valor, 'suprimido');
  assert.equal(p.referencias?.pbf_cgu_valor, 202609);
  assert.equal(linhaIndicadorSocial(group, family)?.competencia, 202603);
  assert.equal(linhaIndicadorSocial(group, money)?.valores.pbf_cgu_valor, null);
  assert.equal(linhaIndicadorSocial(group, money, 202606)?.valores.pbf_cgu_valor, 0);
});
test('Mês explícito não usa folha antiga nem inventa um zero', () => {
  assert.equal(linhaIndicadorSocial(group, family, 202609), undefined);
  assert.equal(linhaSocial(group, 'bpc', 202609), undefined);
  assert.equal(linhaSocial(group, 'pbf', 202604), undefined);
});
test('Navegação traduz território e mantém o mês só dentro da assistência', () => {
  assert.equal(buscaEntreAreas('?uf=GO&ente=5208707&ano=2024','saude','assistencia'), '?uf=GO&cod=5208707&ano=2024');
  assert.equal(buscaEntreAreas('?uf=GO&cod=5208707&mes=202609&indicador=abc','assistencia','assistencia'), '?uf=GO&cod=5208707&mes=202609');
  assert.equal(buscaEntreAreas('?uf=GO&cod=5208707&mes=202609','assistencia','trabalho'), '?uf=GO&cod=5208707');
});

const bytes = (x: unknown) => new TextEncoder().encode(JSON.stringify(x));
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
test('Leitor nativo valida bytes UTF-8, Range, hash, território e recuperação após erro', async () => {
  const original = globalThis.fetch;
  const groups = ['BR','GO','SP','RJ'];
  const slices = groups.map(g => bytes({ ...group, grupo: g === 'RJ' ? 'BR' : g }));
  let offset = 0;
  const ranges: Record<string, [number, number, string]> = {};
  groups.forEach((g, i) => { ranges[g] = [offset, slices[i].byteLength, hash(slices[i])]; offset += slices[i].byteLength; });
  const ranking = bytes({ fonte: 'pbf', competencia: 202609, linhas: [{ grupo: 'GO', valores: { pbf_cgu_valor: 0 }, condicoes: {} }] });
  const rankObject = { caminho: 'gold/assistencia/ranking_pbf_202609_abcdef012345.json', sha256: hash(ranking), bytes: ranking.byteLength };
  const meta = { versao: 1, indicadores: [money,family], territorios: groups.map(g => ({ grupo:g,nome:g,nivel:g==='BR'?'BR':'UF',uf:g==='BR'?null:g,cod_ibge:null })),
    fontes: { cadunico:{competencias:[]},pbf:{competencias:[202603,202609]},bpc:{competencias:[]} },
    arquivo: { caminho: 'gold/assistencia/abertura_abcdef012345.ndjson',sha256:'a'.repeat(64),bytes:offset }, grupos:ranges,
    rankings: { cadunico:{},bpc:{},pbf:{202609:rankObject} } } as unknown as MetaSocial;
  const index = bytes(meta);
  injetarManifesto({gerado_em:'2026-11-14T00:00:00Z',fontes:{assistencia:{abertura:{caminho:'gold/assistencia/indice_abcdef012345.json',sha256:hash(index),bytes:index.byteLength}}}} as ManifestoBruto);
  let badBR=true,badGO=true,badSP=true,badRank=true;
  const requests:string[]=[];
  globalThis.fetch = (async (url, init) => {
    const u=String(url);requests.push(u);
    if (u.includes('indice_')) return new Response(index);
    if (u.includes('ranking_')) return new Response(badRank ? new Uint8Array(ranking.length) : ranking);
    const range = new Headers(init?.headers).get('Range');
    const g=groups.find(g=>range===`bytes=${ranges[g][0]}-${ranges[g][0]+ranges[g][1]-1}`)!;
    assert.ok(g,'Só o trecho exato pode ser pedido');
    const s=slices[groups.indexOf(g)], [start,size]=ranges[g];
    if(g==='GO'&&badGO)return new Response(s,{status:200});
    return new Response(g==='BR'&&badBR ? new Uint8Array(s.length) : s,{status:206,
      headers:{'Content-Range':g==='SP'&&badSP ? 'bytes 0-0/1' : `bytes ${start}-${start+size-1}/${offset}`}});
  }) as typeof fetch;
  try {
    assert.equal((await obterMetaSocial()).territorios.length,4);
    await assert.rejects(obterGrupoSocial('BR'), /incompleto/);
    badBR=false;assert.equal((await obterGrupoSocial('BR')).grupo,'BR');
    await assert.rejects(obterGrupoSocial('GO'), /trecho/);
    badGO=false;assert.equal((await obterGrupoSocial('GO')).grupo,'GO');
    await assert.rejects(obterGrupoSocial('SP'), /trecho/);
    badSP=false;assert.equal((await obterGrupoSocial('SP')).grupo,'SP');
    await assert.rejects(obterGrupoSocial('RJ'), /outro território/);
    await assert.rejects(obterRankingSocial('pbf',202609), /diferem/);
    badRank=false;assert.equal((await obterRankingSocial('pbf',202609)).linhas[0].valores.pbf_cgu_valor,0);
    assert.equal(requests.filter(u=>u.includes('indice_')).length,1,'Catálogo compartilhado');
    await assert.rejects(obterGrupoSocial('0000000'), /ausente/);
  } finally { globalThis.fetch = original; }
});
test('Contexto da IA explicita sobreposição, datas e ausência de modalidades do BPC', () => {
  assert.match(contextoAssistencia({}),/ainda não publicados/);
  assert.match(ASSISTENCIA,/não pessoas únicas/);
  assert.match(ASSISTENCIA,/não infira/);
  assert.match(ASSISTENCIA,/Datas são POR INDICADOR E TERRITÓRIO/);
});

test('PIB: pagamentos anuais completos, zero real e ausência não se confundem', () => {
  const l: AnoEconomia = [2023, 1000, 100, 200, 12, 12];
  assert.equal(compararPib(l, 'pbf').valor, 10);
  assert.equal(compararPib(l, 'bpc').valor, 20);
  assert.equal(compararPib(l, 'total').valor, 30);
  assert.equal(compararPib([2023, 1000, 0, 0, 12, 12], 'total').valor, 0);
  assert.equal(compararPib([2023, 1000, null, 200, 11, 12], 'total').condicao, 2);
  assert.equal(compararPib([2023, 1000, null, 200, 0, 12], 'pbf').condicao, 1);
  assert.equal(compararPib([2023, null, 100, 200, 12, 12], 'pbf').condicao, 3);
  assert.equal(compararPib([2023, 0, 100, 200, 12, 12], 'pbf').condicao, 4);
  assert.equal(compararPib([2023, -1, 100, 200, 12, 12], 'pbf').condicao, 5);
});

test('Ajuda distingue famílias, pessoas, benefícios individuais e valores pagos', () => {
  const ind = (id: string, nome: string, unidade = 'numero') => ({ id, nome, unidade }) as IndicadorSocial;
  assert.match(conceitoSocial(ind('cad_qtd_familias', 'Famílias no CadÚnico')), /Quem mora sozinho/);
  assert.match(conceitoSocial(ind('cad_qtd_pessoas', 'Pessoas no CadÚnico')), /crianças e adultos/);
  assert.match(conceitoSocial(ind('bpc_beneficios', 'Benefícios do BPC')), /individual/);
  assert.match(conceitoSocial(ind('pbf_cgu_valor', 'Valor pago: Bolsa Família/Auxílio Brasil', 'moeda')), /efetivamente pago/);
  assert.match(conceitoSocial(ind('pbf_cgu_responsaveis', 'Responsáveis com pagamento')), /pessoas únicas/);
});

test('Comparação anual carrega só o trecho e o índice da UF, valida integridade e permite repetir após falha', async () => {
  const original = globalThis.fetch; let ruim = true;
  const linhas: AnoEconomia[] = [[2023, 1000, 100, 200, 12, 12]];
  const br = bytes({ grupo: 'BR', linhas }), muni = bytes({ grupo: '5208707', linhas });
  const index = bytes({ grupos: { '5208707': [br.length, muni.length, hash(muni)] } });
  const indexRef = { caminho: 'gold/assistencia/economia_indice_go_abcdef.json', bytes: index.length, sha256: hash(index) };
  const meta: MetaEconomia = { versao: 1, gerado_em: '2026-11-16', anos: [2023], pib_ate: 2023,
    arquivo: { caminho: 'gold/assistencia/economia_series_abcdef.ndjson', bytes: br.length + muni.length, sha256: 'a'.repeat(64) },
    grupos: { BR: [0, br.length, hash(br)] }, indices_uf: { GO: indexRef } };
  const requests: string[] = [];
  globalThis.fetch = (async (url, init) => {
    const u = String(url); requests.push(u);
    if (u.endsWith('economia_manifesto.json')) return new Response(JSON.stringify(meta));
    if (u === indexRef.caminho) return new Response(index);
    const range = new Headers(init?.headers).get('Range');
    const municipal = range === `bytes=${br.length}-${br.length + muni.length - 1}`;
    assert.ok(municipal || range === `bytes=0-${br.length - 1}`, 'Só o intervalo exato pode ser pedido');
    const data = municipal ? muni : br;
    return new Response(ruim ? new Uint8Array(data.length) : data, { status: 206, headers: { 'Content-Range': `bytes ${municipal ? br.length : 0}-${municipal ? br.length + muni.length - 1 : br.length - 1}/${br.length + muni.length}` } });
  }) as typeof fetch;
  try {
    await assert.rejects(obterEconomia('BR', null), /incompletos/);
    ruim = false;
    assert.equal((await obterEconomia('BR', null)).linhas[0][1], 1000);
    assert.equal((await obterEconomia('5208707', 'GO')).grupo, '5208707');
    assert.equal(requests.filter(u => u.endsWith('economia_manifesto.json')).length, 1);
    assert.equal(requests.filter(u => u === indexRef.caminho).length, 1);
    await assert.rejects(obterEconomia('0000000', null), /ausente/);
  } finally { globalThis.fetch = original; }
});
