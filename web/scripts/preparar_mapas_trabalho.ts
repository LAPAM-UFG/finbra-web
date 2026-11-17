/** Extrai somente os pacotes publicados, aplicando os helpers originais do painel. */
import { readFileSync, writeFileSync, mkdirSync, openSync, writeSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { celulasPrincipaisTrabalho, definicaoCategoriaTrabalho, definicoesPrincipaisTrabalho } from '../src/trabalho_mapa';
import { DICIONARIO, VARIAVEIS_PERFIL, disponibilidadePerfis, distribuicao, lerPerfil } from '../src/trabalho_perfis';
const tarefa = process.argv[2]; if (!tarefa) throw Error('Informe a pasta de revisão.');
const ler = (nome: string) => JSON.parse(readFileSync(join(tarefa, nome), 'utf8'));
const global = ler('global_base.json'), abertura = ler('abertura_base.json'), edu = ler('educacao_base.json'), fontes = ler('fontes_resolvidas.json');
const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const canonico = (x: any): any => Array.isArray(x) ? x.map(canonico) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, canonico(x[k])])) : x;
function arquivo(ref: any): Buffer { const b = readFileSync(fontes[ref.caminho].caminho_local); if (b.length !== ref.bytes || sha(b) !== ref.sha256) throw Error('Fonte diferente: ' + ref.caminho); return b; }
function indice(ref: any) { return JSON.parse(gunzipSync(arquivo(ref)).toString('utf8')); }
function partes(ref: any) {
  const i = indice(ref), b = arquivo(i.arquivo); const out = new Map<string, any>();
  for (const [cod, p] of Object.entries(i.grupos) as [string, [number, number, string]][]) {
    const trecho = b.subarray(p[0], p[0] + p[1]); if (sha(trecho) !== p[2]) throw Error('Trecho incompleto: ' + cod);
    const g = JSON.parse(gunzipSync(trecho).toString('utf8')); if (g.chave !== cod || !g.dados) throw Error('Grupo trocado'); out.set(cod, g.dados);
  }
  return out;
}
function linhas(t: any): Record<string, unknown>[] { return t ? t.linhas.map((l: unknown[]) => Object.fromEntries(t.colunas.map((c: string, j: number) => [c, l[j]]))) : []; }
const cadastro: [string, string, string][] = JSON.parse(arquivo(edu.busca_municipios).toString('utf8'));
const rais: number[] = global.fontes.rais.anos;
const caged = global.fontes.caged;
const anos: number[] = [...new Set([...rais, ...Array.from({ length: Math.floor(caged.ate / 100) - Math.floor(caged.de / 100) + 1 }, (_, k) => Math.floor(caged.de / 100) + k)])].sort((a, b) => a - b);
const principais = definicoesPrincipaisTrabalho(global.base_ipca);
const categorias = Object.fromEntries(VARIAVEIS_PERFIL.map(v => [v, new Set([...DICIONARIO[v].map(x => x.codigo), '_ausente'])])) as Record<(typeof VARIAVEIS_PERFIL)[number], Set<string>>;
const dest = join(tarefa, 'intermediarios'); mkdirSync(dest, { recursive: true });
const auditoria = { ok: true, registros: 0, perfis: 0, sem_perfil: 0, zeros: 0, negativos: 0, vinculos_conciliados: 0 };
for (const uf of [...new Set(cadastro.map(x => x[2]))].sort()) {
  const hist = partes(abertura.trabalho.historico[uf]); const municipios = cadastro.filter(x => x[2] === uf);
  const historicos = new Map(municipios.map(([cod]) => [cod, { serie: linhas(hist.get(cod)?.trab_serie), caged: linhas(hist.get(cod)?.trab_caged) }]));
  const fd = openSync(join(dest, `trabalho_${uf}.ndjson`), 'wx');
  try {
    for (const ano of anos) {
      const fontePerfil = abertura.trabalho.anos[String(ano)]?.[uf]; const perfis = fontePerfil ? partes(fontePerfil) : new Map();
      for (const [cod] of municipios) {
        const h = historicos.get(cod)!; const celulas = celulasPrincipaisTrabalho(h.serie, h.caged, ano, caged.de, caged.ate);
        if (celulas.length !== principais.length) throw Error('Catálogo e células divergentes.');
        const p = fontePerfil ? lerPerfil(linhas(perfis.get(cod)?.trab_perfis), ano) : { estado: 'sem_escopo' as const };
        if (p.estado === 'inconsistente') throw Error(`${cod}/${ano}: ${p.problemas.join('; ')}`);
        const itens: unknown[][] = [];
        if (p.estado === 'ok') {
          const totalSerie = h.serie.find(x => x.ano === ano)?.empregos;
          if (typeof totalSerie === 'number' && p.total !== totalSerie) throw Error('Perfil não fecha com RAIS do município/ano.');
          auditoria.vinculos_conciliados += p.total;
          for (const v of VARIAVEIS_PERFIL) for (const item of distribuicao(p, v, 'pt').itens) {
            categorias[v].add(item.codigo);
            itens.push([v, item.codigo, item.vinculos, item.pct, item.media, item.massaCentavos === null ? null : item.massaCentavos / 100, item.nRem]);
          }
          auditoria.perfis++;
        } else auditoria.sem_perfil++;
        writeSync(fd, JSON.stringify([Number(cod), ano, celulas, p.estado === 'ok' ? p.total : null, itens]) + '\n');
        auditoria.registros++; auditoria.zeros += celulas.filter(x => x[0] === 0).length; auditoria.negativos += celulas.filter(x => x[0] !== null && x[0] < 0).length;
      }
    }
  } finally { closeSync(fd); }
  console.log(uf, municipios.length, 'municípios');
}
const anosPerfil = disponibilidadePerfis(global.fontes.rais_perfis, rais.at(-1)).anos;
const defs: any[] = principais.map((d, k) => ({ ...d, source_index: k, anos: d.fonte_nome === 'Novo CAGED' ? anos.filter(y => y >= Math.floor(caged.de / 100) && y <= Math.floor(caged.ate / 100)) : d.id.startsWith('variacao') ? rais.filter(y => rais.includes(y - 1)) : rais, minimo: 0, numerador_nome: 'Componente ou numerador', numerador_nome_en: 'Component or numerator', denominador_nome: 'Base ou denominador', denominador_nome_en: 'Base or denominator', territorio: 'Município do estabelecimento; vínculos, não pessoas', territorio_en: 'Municipality of the establishment; jobs, not people' }));
for (const v of VARIAVEIS_PERFIL) for (const cod of [...categorias[v]].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))) for (const medida of ['n', 'pct', 'rem'] as const) defs.push({ ...definicaoCategoriaTrabalho(v, cod, medida), anos: anosPerfil, minimo: 0, numerador_nome: medida === 'rem' ? 'Massa de dezembro (R$)' : 'Vínculos da categoria', numerador_nome_en: medida === 'rem' ? 'December payroll (R$)' : 'Category jobs', denominador_nome: medida === 'rem' ? 'Vínculos da categoria (todos)' : 'Vínculos ativos do município', denominador_nome_en: medida === 'rem' ? 'Category jobs (all)' : 'Municipality active jobs', territorio: 'Município do estabelecimento; vínculos, não pessoas', territorio_en: 'Municipality of the establishment; jobs, not people' });
writeFileSync(join(tarefa, 'trabalho_definicoes.json'), JSON.stringify({ anos, indicadores: defs, origem: { tipo: 'trabalho', caminho: 'gold/abertura/manifesto.json', sha256: sha(JSON.stringify(canonico(abertura.trabalho))), gerado_em: global.gerado_em }, auditoria }));
writeFileSync(join(tarefa, 'preparacao_trabalho.json'), JSON.stringify(auditoria, null, 2));
console.log(JSON.stringify({ ...auditoria, indicadores: defs.length }));
