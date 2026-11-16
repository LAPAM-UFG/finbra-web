/** Coteja cada célula dos mapas com as fontes e com calcular() do próprio site. */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { INDICADORES, anosDoIndicador, calcular, fonteDaColuna, motivoSemValor } from '../src/saude_comum';

const [revisao, base, saida] = process.argv.slice(2);
const json = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
type Ref = { caminho: string; bytes: number; sha256: string };
const validar = (b: Buffer, r: Ref) => { assert.equal(b.length, r.bytes); assert.equal(sha(b), r.sha256); };
const origem = (r: Ref) => {
  for (const raiz of [base, path.join(revisao, 'fontes')]) { const p = path.join(raiz, r.caminho); if (fs.existsSync(p)) { const b = fs.readFileSync(p); if (b.length === r.bytes && sha(b) === r.sha256) return { p, b }; } }
  throw new Error('Origem ausente: ' + r.caminho);
};
const objeto = (r: Ref) => { const b = fs.readFileSync(path.join(saida, r.caminho)); validar(b, r); return JSON.parse(b.toString('utf8')); };
const globalMeta = json(path.join(revisao, 'global_base.json'));
const saude = json(path.join(saida, 'gold/mapas/saude_manifesto.json'));
const edu = json(path.join(saida, 'gold/mapas/educacao_manifesto.json'));
const cadastro = objeto(saude.cadastro).municipios as [number, string, string][];
assert.equal(cadastro.length, 5571); assert.equal(saude.cadastro.sha256, edu.cadastro.sha256);
const pos = new Map(cadastro.map((r, k) => [r[0], k]));
const porUF = new Map([...new Set(cadastro.map(r => r[2]))].sort().map(u => [u, cadastro.filter(r => r[2] === u)]));
const anos = [...new Set(INDICADORES.flatMap(i => anosDoIndicador(i, globalMeta.fontes)))].sort((a, b) => a - b);
const anoPos = new Map(anos.map((a, k) => [a, k]));
const nCelulas = cadastro.length * anos.length * INDICADORES.length;
const val = new Float64Array(nCelulas).fill(NaN), num = new Float64Array(nCelulas).fill(NaN), den = new Float64Array(nCelulas).fill(NaN);
const cond = new Uint8Array(nCelulas).fill(2);
const a = globalMeta.aberturas.saude;
const idx = JSON.parse(origem({ caminho: a.indice, bytes: a.indice_bytes, sha256: a.indice_sha256 }).b.toString());
const linhas = readline.createInterface({ input: fs.createReadStream(origem({ caminho: a.arquivo, bytes: a.bytes, sha256: a.sha256 }).p), crlfDelay: Infinity });
for await (const line of linhas) {
  const g = JSON.parse(line); const cod = Number(g.g); const cp = pos.get(cod); if (cp === undefined) continue;
  g.a.forEach((ano: number, k: number) => {
    const yp = anoPos.get(ano); if (yp === undefined) return;
    const r = Object.fromEntries(idx.serie.map((c: string, j: number) => [c, g.r[k][j]]));
    INDICADORES.forEach((i, ip) => {
      const p = (ip * anos.length + yp) * cadastro.length + cp;
      const n = r[i.numerador] as number | null, d = r[i.denominador] as number | null;
      const v = calcular(i, r); num[p] = n ?? NaN; den[p] = d ?? NaN; val[p] = v ?? NaN;
      const motivo = motivoSemValor(i, r);
      cond[p] = motivo === 'sem_registro' ? 2 : motivo === 'denominador_ausente' ? 3 : motivo === 'denominador_zero' ? 4 : globalMeta.fontes[fonteDaColuna(i.numerador)]?.preliminares?.includes(ano) ? 6 : v === 0 ? 1 : 0;
    });
  });
}
const aprox = (atual: number | null, esperado: number) => { if (Number.isNaN(esperado)) assert.equal(atual, null); else { assert.notEqual(atual, null); assert(Math.abs(atual! - esperado) <= 1e-12 * Math.max(1, Math.abs(esperado)), `${atual} != ${esperado}`); } };
let arquivoAtual = '', dados = Buffer.alloc(0);
const buffer = (r: Ref) => { if (r.caminho !== arquivoAtual) { dados = fs.readFileSync(path.join(saida, r.caminho)); validar(dados, r); arquivoAtual = r.caminho; } return dados; };
const reporte = { ok: true, territorios: cadastro.length, recortes: 0, celulas: 0, zeros: 0, ressalvas: 0, casos: [] as unknown[] };
function verificar(m: any, aoConferir: (i: any, ano: number, cod: number, p: number, c: any) => void) {
  for (const i of m.indicadores) {
    const index = objeto(i.indice); const b = buffer(index.arquivo);
    assert.equal(index.cadastro, m.cadastro.sha256);
    for (const ano of i.anos) {
      const br = index.recortes[`${ano}:BR`]; assert(br);
      const inteiro = b.subarray(br[0], br[0] + br[1]); assert.equal(sha(inteiro), br[2]);
      let proximo = br[0];
      for (const [uf, municipios] of porUF) {
        const tr = index.recortes[`${ano}:${uf}`]; assert.equal(tr[0], proximo); proximo += tr[1];
        const bloco = b.subarray(tr[0], tr[0] + tr[1]); assert.equal(sha(bloco), tr[2]); const c = JSON.parse(bloco.toString());
        assert.equal(c.area, m.area); assert.equal(c.rede, m.rede); assert.equal(c.indicador, i.id); assert.equal(c.ano, ano); assert.equal(c.uf, uf); assert.equal(c.quantidade, municipios.length); assert.equal(c.cadastro, m.cadastro.sha256);
        if (c.valores !== null) assert.equal(c.valores.length, municipios.length);
        municipios.forEach(([cod], p) => { aoConferir(i, ano, cod, p, c); reporte.celulas++; if (c.valores?.[p] === 0) reporte.zeros++; if ([1, 2].includes(c.marcadores?.[p])) reporte.ressalvas++; });
        reporte.recortes++;
      }
      assert.equal(proximo, br[0] + br[1]);
    }
  }
}
const indicesInd = new Map(INDICADORES.map((i, k) => [i.id, k]));
for (const i of saude.indicadores) assert.deepEqual(i.anos, anosDoIndicador(INDICADORES[indicesInd.get(i.id)!], globalMeta.fontes));
const codGoias = cadastro.find(r => r[1] === 'Goiás' && r[2] === 'GO')![0];
verificar(saude, (i, ano, cod, p, c) => {
  const ip = indicesInd.get(i.id)!;
  const z = (ip * anos.length + anoPos.get(ano)!) * cadastro.length + pos.get(cod)!;
  aprox(c.valores?.[p] ?? null, val[z]); aprox(c.numeradores[p], num[z]); aprox(c.denominadores[p], den[z]);
  assert.equal(c.condicoes[p], cond[z]);
  if (cod === codGoias && ano === 2024 && i.id === 'mortalidade_infantil' || cod === 1504752 && ano === 2013 && i.id === 'icsap_proporcao' || cod === 5101837 && ano === 2025 && i.id === 'icsap_taxa') reporte.casos.push({ indicador: i.id, ano, cod, valor: c.valores?.[p] ?? null, numerador: c.numeradores[p], denominador: c.denominadores[p], condicao: c.condicoes[p] });
});
const originalEdu = json(path.join(revisao, 'educacao_base.json'));
for (const m of [edu, ...Object.values(edu.redes).map((r: any) => objeto(r))]) {
  const fonte = m.rede === 'todas' ? originalEdu : JSON.parse(origem(originalEdu.redes[m.rede]).b.toString());
  const porAno = new Map<number, Map<number, any[]>>();
  for (const ano of fonte.anos) { const f = JSON.parse(origem(fonte.rankings[ano]).b.toString()); porAno.set(ano, new Map(f.linhas.map((r: any[]) => [r[0], r]))); }
  const campos = new Map<string, number>(fonte.indicadores.map((x: any, k: number) => [x.id, k]));
  const flags = new Map<string, number>(fonte.indicadores.flatMap((x: any, k: number) => x.associado ? [[x.associado, k]] : []));
  for (const i of m.indicadores) assert.deepEqual(i.escala, edu.indicadores.find((x: any) => x.id === i.id).escala);
  verificar(m, (i, ano, cod, p, c) => {
    const campo = campos.get(i.id)!; assert(campo >= 0);
    const r = porAno.get(ano)?.get(cod); const esperado = r?.[campo + 3] ?? null;
    assert.equal(c.valores?.[p] ?? null, esperado);
    const flag = flags.get(i.id);
    if (flag !== undefined) assert.equal(c.marcadores[p], r?.[flag + 3] ?? null);
  });
  console.log(JSON.stringify({ etapa: 'educacao', rede: m.rede, celulas: reporte.celulas }));
}
fs.writeFileSync(path.join(revisao, 'auditoria_mapas.json'), JSON.stringify(reporte, null, 2));
console.log(JSON.stringify(reporte));
