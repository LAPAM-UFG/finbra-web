/**
 * Conversão monetária determinística (valores reais em outro ano-base). Os fatores da tabela ipca (fator_real) são
 * referenciados ao ano-base do painel (R$ de dezembro de 2025). Para outro ano-base:
 *
 *   fator_para_alvo(ano) = fator_real(ano) / fator_real(alvo)
 *   valor_real_alvo(ano) = valor_nominal(ano) × fator_para_alvo(ano)
 *
 * Em SQL, a visão ipca_base (SQL_IPCA_BASE) entrega o mesmo cálculo para qualquer ano-base completo; estas funções
 * são a versão em TypeScript usada nos testes e para conferir os fatores.
 */
export type FatoresReais = Record<number, number>;

export const SQL_IPCA_BASE = `CREATE OR REPLACE VIEW ipca_base AS
  SELECT i.exercicio, a.exercicio AS ano_base_alvo, (i.fator_real / a.fator_real)::DOUBLE AS fator,
         i.indice::DOUBLE AS indice, a.indice::DOUBLE AS indice_alvo
  FROM ipca i CROSS JOIN ipca a WHERE a.completo`;

/** Fator para o ano-base escolhido; igual a 1 no próprio ano-base. */
export function fatorParaAno(fatores: FatoresReais, ano: number, alvo: number): number {
  const f = fatores[ano];
  const base = fatores[alvo];
  if (!Number.isFinite(f) || !Number.isFinite(base) || base === 0) throw new Error(`sem fator do IPCA para ${!Number.isFinite(f) ? ano : alvo}`);
  return f / base;
}

export const valorReal = (fatores: FatoresReais, ano: number, alvo: number, nominal: number) => nominal * fatorParaAno(fatores, ano, alvo);

/** Texto que acompanha qualquer valor real: índice, período dos preços e ano-base. */
export const notaDeValorReal = (alvo: number) =>
  `Valores reais: IPCA (IBGE), número-índice de dezembro (variação dezembro a dezembro), em R$ de dezembro de ${alvo}; `
  + 'valor real = valor nominal × (índice de dezembro do ano-base ÷ índice de dezembro do ano do valor). '
  + 'Remuneração média mensal do ano (rem_media) e remuneração de dezembro (rem_dez) são medidas diferentes e a nota diz qual foi usada.';
