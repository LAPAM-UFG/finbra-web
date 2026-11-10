/**
 * Guardas da IA para o financiamento federal (FNS): fns_municipios (ano × município, com a população SVS/MS uma vez por linha),
 * fns_composicao (bloco, grupo e estratégia por município e ano) e fns_anos (auditoria). Duas armadilhas viram erro antes de rodar:
 *
 *   1. denominador repetido: juntar fns_composicao a fns_municipios (ou à população de saude_municipios) repete o total e a população do
 *      município em cada linha da composição, e qualquer soma ou per capita sai multiplicada;
 *   2. soma com receita ou despesa: o repasse do FNS é o fluxo visto por quem transfere; a receita de transferências (SICONFI) e a despesa em
 *      saúde (SIOPS) são o mesmo fluxo visto por quem recebe e gasta. Somar as duas pontas, ou empilhá-las e somar, conta duas vezes.
 *
 * Devolve o problema (para o modelo corrigir) ou null. É conservadora: só recusa o que é soma/junção inequívoca; comparar lado a lado,
 * em colunas separadas, passa.
 */
const FNS = /\bfns_(municipios|composicao|anos)\b/;
const COMPOSICAO = /\bfns_composicao\b/;
const OUTRA_COM_POPULACAO = /\b(fns_municipios|saude_municipios)\b/;
const POPULACAO = /\b(populacao|pop_[a-z0-9_]+)\b/;
const FINANCAS = /\b(indicadores|lrf|despesa_funcao|alertas|siops_[a-z0-9_]+|siope_[a-z0-9_]+)\b/;
const COLUNA_FNS = /\b(liquido|bruto|liquido_real)\b/;
// pedaços de nomes (receita_corrente, siops_receita_sus, despesa_saude_liquidada): valem dentro de nomes com sublinhado, por isso sem \b no começo da maioria
const COLUNA_FINANCAS = /(receita|despesa|rcl|transferencia|fpm|\bsus_|saude_total|saude_proprios|empenhad|liquidad|pag[oa]s?\b)/;

/** SQL sem textos entre aspas e comentários, em minúsculas. */
const limpar = (sql: string) => sql.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').toLowerCase();

/** Trechos separados por vírgula em cada nível de parênteses (o trecho inclui o que está aninhado): onde uma soma de colunas aparece. */
function segmentos(s: string): string[] {
  const out: string[] = [];
  const pilha: number[] = [0];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') pilha.push(i + 1);
    else if (c === ')') {
      const ini = pilha.pop() ?? 0;
      out.push(s.slice(ini, i));
      if (!pilha.length) pilha.push(0);
    } else if (c === ',') {
      out.push(s.slice(pilha[pilha.length - 1], i));
      pilha[pilha.length - 1] = i + 1;
    }
  }
  out.push(s.slice(pilha[pilha.length - 1]));
  return out;
}

/** Separa subconsultas/CTEs do SELECT externo; uma tabela pré-agregada não é um join com as linhas cruas. */
function escoposSql(s: string): string[] {
  const filhos: string[] = [];
  let externo = '', inicio = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '(') continue;
    let fim = i + 1, nivel = 1;
    for (; fim < s.length && nivel; fim++) {
      if (s[fim] === '(') nivel++;
      else if (s[fim] === ')') nivel--;
    }
    const dentro = s.slice(i + 1, fim - 1);
    if (/^\s*(select|with)\b/.test(dentro)) {
      filhos.push(...escoposSql(dentro));
      const uniao = /\bunion\b/.test(dentro) && FNS.test(dentro) && FINANCAS.test(dentro);
      externo += s.slice(inicio, i) + (uniao ? ' (__uniao_fns_financas__) ' : ' (__subconsulta__) ');
      inicio = fim;
      i = fim - 1;
    }
  }
  return [...filhos, externo + s.slice(inicio)];
}

export function guardaFns(sql: string): string | null {
  const s = limpar(sql);
  if (!FNS.test(s)) return null;
  const escopos = escoposSql(s);
  if (escopos.some((e) => COMPOSICAO.test(e) && OUTRA_COM_POPULACAO.test(e))) {
    return 'fns_composicao tem uma linha por bloco, grupo e estratégia: juntá-la a fns_municipios ou a saude_municipios repete o total e a população do município em cada linha e multiplica qualquer soma ou per capita. Faça duas consultas (participação da composição em fns_composicao; per capita em fns_municipios, que tem a população SVS/MS uma vez por município e ano).';
  }
  if (escopos.some((e) => COMPOSICAO.test(e) && POPULACAO.test(e))) {
    return 'fns_composicao não tem população: o per capita se calcula em fns_municipios (população SVS/MS uma vez por município e ano), nunca somando população sobre as linhas da composição.';
  }
  if (FINANCAS.test(s)) {
    if (escopos.some((e) => /__uniao_fns_financas__/.test(e) && /\bsum\s*\(/.test(e))) {
      return 'o repasse do FNS e a receita (SICONFI) ou a despesa (SIOPS) são o mesmo fluxo visto por quem transfere e por quem recebe e gasta: não os empilhe (UNION) para somar. Mostre-os em colunas separadas, sem somá-los.';
    }
    for (const seg of segmentos(s)) {
      if (seg.includes('+') && COLUNA_FNS.test(seg) && COLUNA_FINANCAS.test(seg)) {
        return 'o repasse do FNS (liquido, bruto) não se soma à receita de transferências (SICONFI) nem à despesa em saúde (SIOPS): são perspectivas do mesmo fluxo, e somar conta duas vezes. Mostre cada um em sua coluna e compare lado a lado.';
      }
    }
  }
  return null;
}
