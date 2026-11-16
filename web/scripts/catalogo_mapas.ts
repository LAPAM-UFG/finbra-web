/** Exporta a definição original dos indicadores; não recria fórmulas do painel. */
import fs from 'node:fs';
import { INDICADORES, anosDoIndicador, fonteCurta, fonteDaColuna, nomeContagem, territorioDoIndicador, type FontesMeta } from '../src/saude_comum';
import { definirIdioma } from '../src/idioma';
const [arquivo, destino] = process.argv.slice(2);
const original = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
const fontes = original.fontes as FontesMeta;
// Apenas o exportador Node usa o objeto de documento mínimo para as traduções.
Object.assign(globalThis, { document: { documentElement: { lang: 'pt-BR' }, title: '' } });
const textos: Record<string, Record<string, unknown>> = {};
for (const lang of ['pt', 'en'] as const) {
  await definirIdioma(lang);
  for (const i of INDICADORES) {
    const campo = lang === 'en' ? '_en' : '';
    textos[i.id] ??= {};
    Object.assign(textos[i.id], {
      ['nome' + campo]: i.nome(), ['unidade' + campo]: i.unidade(),
      ['descricao' + campo]: i.nota(), ['tema' + campo]: i.grupo(),
      ['alerta' + campo]: i.alerta?.() ?? '', ['territorio' + campo]: territorioDoIndicador(i),
      ['numerador_nome' + campo]: nomeContagem(i.numerador), ['denominador_nome' + campo]: nomeContagem(i.denominador),
      ['fonte_nome' + campo]: fonteCurta(i),
    });
  }
}
const indicadores = INDICADORES.map(i => ({ id: i.id, ...textos[i.id],
  numerador: i.numerador, denominador: i.denominador, fator: i.fator,
  formato: i.monetario ? 'moeda' : i.tipo === 'proporcao' ? 'fracao' : 'numero', minimo: i.minimo,
  anos: anosDoIndicador(i, fontes), preliminares: fontes[fonteDaColuna(i.numerador)]?.preliminares ?? [],
  fontes: [...new Set([i.numerador, i.denominador].map(fonteDaColuna))].map(k => ({ nome: k.toUpperCase(), url: fontes[k]?.url })).filter(f => f.url),
}));
fs.writeFileSync(destino, JSON.stringify({ versao: 1, indicadores }));
console.log(JSON.stringify({ indicadores: indicadores.length, destino }));
