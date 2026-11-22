/** Auditoria da saída usando as funções originais da RAIS/perfis e o leitor real do site. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { calcularRais, somarCagedAno, type Linha } from '../src/trabalho_painel';
import { lerPerfil, distribuicao, VARIAVEIS_PERFIL } from '../src/trabalho_perfis';
import { validarCargaMapa } from '../src/mapas_dados';
const [tarefa, candidato] = process.argv.slice(2);
const ler = (n: string) => JSON.parse(readFileSync(join(tarefa, n), 'utf8'));
const global = ler('global_base.json'), ab = ler('abertura_base.json'), fontes = ler('fontes_resolvidas.json');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
function original(ref: any): Buffer { const b = readFileSync(fontes[ref.caminho].caminho_local); assert.equal(b.length, ref.bytes); assert.equal(sha(b), ref.sha256); return b; }
function partes(ref: any) { const i = JSON.parse(gunzipSync(original(ref)).toString()); const b = original(i.arquivo); const out = new Map<string, any>(); for (const [cod, p] of Object.entries(i.grupos) as any[]) { const t = b.subarray(p[0], p[0] + p[1]); assert.equal(sha(t), p[2]); const g = JSON.parse(gunzipSync(t).toString()); assert.equal(g.chave, cod); out.set(cod, g.dados); } return out; }
function linhas(t: any): Linha[] { return t ? t.linhas.map((l: unknown[]) => Object.fromEntries(t.colunas.map((c: string, k: number) => [c, l[k]]))) : []; }
function objeto(ref: any) { const b = readFileSync(join(candidato, ref.caminho)); assert.equal(b.length, ref.bytes); assert.equal(sha(b), ref.sha256); return JSON.parse(b.toString()); }
const m = JSON.parse(readFileSync(join(candidato, 'gold/mapas/trabalho_manifesto.json'), 'utf8'));
const cadastro = objeto(m.cadastro).municipios as [number, string, string][];
const indices = new Map<string, any>(m.indicadores.map((i: any) => [i.id, objeto(i.indice)]));
const ref = indices.get(m.indicadores[0].id).arquivo; const dados = readFileSync(join(candidato, ref.caminho)); assert.equal(dados.length, ref.bytes); assert.equal(sha(dados), ref.sha256);
const anos = [...new Set(m.indicadores.flatMap((i: any) => i.anos))].sort() as number[];
const stats = { ok: true, celulas: 0, zeros: 0, negativos: 0, recortes: 0, exemplos: {} as Record<string, any> };
for (const uf of [...new Set(cadastro.map(r => r[2]))].sort()) {
 const municipios = cadastro.filter(r => r[2] === uf), hist = partes(ab.trabalho.historico[uf]);
 const hs = new Map(municipios.map(([cod]) => [cod, { serie: linhas(hist.get(String(cod))?.trab_serie), caged: linhas(hist.get(String(cod))?.trab_caged) }]));
 for (const ano of anos) {
  const refPerfil = ab.trabalho.anos[ano]?.[uf], ps = refPerfil ? partes(refPerfil) : new Map();
  const saidas = new Map<string, any[]>();
  for (const i of m.indicadores) {
   if (!i.anos.includes(ano)) continue;
   const idx = indices.get(i.id), p = idx.recortes[`${ano}:${uf}`]; const b = dados.subarray(p[0], p[0] + p[1]); assert.equal(sha(b), p[2]); assert.equal(b.at(-1), 10);
   const c = JSON.parse(b.toString()); const rows = validarCargaMapa(c, m, i, ano, uf, municipios); saidas.set(i.id, rows); stats.recortes++;
  }
  for (const [pos, [cod]] of municipios.entries()) {
   const h = hs.get(cod)!; const r = calcularRais(h.serie.find(a => a.ano === ano), h.serie.find(a => a.ano === ano - 1), ano);
   const principal: Record<string, number | null | undefined> = r ? { empregos: r.empregos, variacao: r.variacaoAbs, variacao_pct: r.variacaoPct, por_mil: r.porMil, estabelecimentos: r.estabelecimentos, vinculos_por_estab: r.vinculosPorEstab, rem_media: r.remMedia, rem_media_real: r.remMediaReal, massa: r.massa, massa_real: r.massaReal, rem_mulheres: r.remMulheres, rem_homens: r.remHomens, razao_mh: r.razaoMH, sem_rem: r.semRem, mulheres: r.mulheres.pct, homens: r.homens.pct, ate24: r.ate24.pct, de50mais: r.de50mais.pct, superior: r.superior.pct, ...Object.fromEntries(Object.entries(r.setores).map(([k, s]) => ['setor_' + k, s.pct])) } : {};
   const c = somarCagedAno(h.caged, ano, global.fontes.caged.de, global.fontes.caged.ate); Object.assign(principal, { caged_admissoes: c.admissoes, caged_desligamentos: c.desligamentos, caged_saldo: c.saldo });
   const p = lerPerfil(linhas(ps.get(String(cod))?.trab_perfis), ano); assert.notEqual(p.estado, 'inconsistente');
   const dims = p.estado === 'ok' ? Object.fromEntries(VARIAVEIS_PERFIL.map(v => [v, new Map(distribuicao(p, v, 'pt').itens.map(x => [x.codigo, x]))])) : null;
   for (const i of m.indicadores) {
    const l = saidas.get(i.id)?.[pos]; if (!l) continue;
    let esperado = principal[i.id] ?? null;
    if (i.categoria) {
     const x = dims?.[i.categoria.variavel]?.get(i.categoria.codigo);
     esperado = !dims ? null : i.categoria.medida === 'n' ? x?.vinculos ?? 0 : i.categoria.medida === 'pct' ? x?.pct ?? (p.estado === 'ok' && p.total > 0 ? 0 : null) : x?.media ?? null;
     if (dims) {
      assert.equal(l.denominador, i.categoria.medida === 'rem' ? x?.nRem ?? 0 : p.estado === 'ok' ? p.total : null);
      assert.equal(l.numerador, i.categoria.medida === 'rem' ? x?.massaCentavos != null ? x.massaCentavos / 100 : null : x?.vinculos ?? 0);
      if (i.categoria.medida === 'rem') assert.equal(l.rem_validas, x?.nRem ?? 0);
     }
    }
    assert.equal(l.cod, cod); assert.equal(l.valor, esperado, `${cod}/${ano}/${i.id}`); stats.celulas++; if (esperado === 0) stats.zeros++; if (esperado !== null && esperado < 0) stats.negativos++;
    const chave = String(l.condicao); if (!(chave in stats.exemplos)) stats.exemplos[chave] = { cod, ano, indicador: i.id, valor: l.valor, numerador: l.numerador, denominador: l.denominador, condicao: l.condicao };
   }
  }
 }
 console.log(uf, 'auditado');
}
writeFileSync(join(tarefa, 'auditoria_trabalho.json'), JSON.stringify(stats, null, 2)); console.log(JSON.stringify(stats));
