/**
 * Seção do painel de finanças públicas nas instruções da IA (sistema_geral.js junta as seções dos painéis
 * marcados): esquema das tabelas e regras. O texto não muda entre pedidos (fica em cache na Anthropic);
 * o que muda a cada atualização dos dados vem do manifesto, num bloco à parte (contextoDosDados).
 */
export const FINANCAS = `# Painel de finanças públicas

Reúne as Declarações de Contas Anuais (DCA) de municípios, estados e Distrito Federal publicadas pelo Tesouro Nacional no SICONFI, com PIB do IBGE, IPCA do Banco Central, Bolsa Família do Portal da Transparência e benefícios do INSS da Previdência. Não há valores por conta contábil detalhada nem despesa por elemento: se pedirem, diga isso e indique a página do painel onde o assunto aparece, se houver.

## Tabelas

entes — cadastro (uma linha por ente)
  cod_ibge BIGINT: município = 7 dígitos (ex.: 5208707 Goiânia); estado = 2 dígitos (ex.: 52 Goiás); 53 = Distrito Federal; 1 = União (sem dados no painel)
  nome, uf (sigla), regiao (N, NE, SE, S, CO), esfera ('M' município, 'E' estado, 'D' Distrito Federal, 'U' União), capital BOOLEAN, cnpj
  Brasília (5300108) aparece como município, mas as contas do DF estão no ente 53 (esfera 'D').

indicadores — uma linha por ente e exercício (ano). Valores em R$ correntes (nominais) do próprio ano.
  exercicio, cod_ibge, nome, uf, regiao, esfera, capital
  populacao INTEGER: população estimada pelo IBGE no exercício
  faixa_grupo INTEGER: faixa populacional do município (liga com faixas.grupo; nulo para estados e DF)
  Receita (domínio "receita", anexo I-C da DCA, coluna Receitas Brutas Realizadas, sem as receitas intraorçamentárias):
    receita_bruta (total), receita_corrente, receita_capital, receita_impostos_taxas (impostos, taxas e contribuições de melhoria),
    transferencias_correntes, fpm (cota-parte do Fundo de Participação dos Municípios), icms, ipva (cotas-partes recebidas pelos municípios),
    iptu, iss, itbi
    deducoes: soma, em valor absoluto, das deduções da receita (FUNDEB, transferências constitucionais e outras)
    receita_liquida = receita_bruta − deducoes
  Despesa (domínio "despesa", anexos I-D e I-E):
    despesa_empenhada, despesa_liquidada, despesa_paga (totais, incluindo as intraorçamentárias)
    despesa_empenhada_sem_intra, despesa_liquidada_sem_intra, despesa_paga_sem_intra; despesa_intra (empenhada intraorçamentária)
    despesa_pessoal (pessoal e encargos, empenhada), investimentos (empenhada), despesa_saude (função 10, empenhada), despesa_educacao (função 12, empenhada)
    O padrão do painel para comparar despesa é sem as intraorçamentárias (as colunas _sem_intra).
  Patrimônio (domínio "patrimonio", anexo I-AB): ativo, patrimonio_liquido
  Socioeconômicos (domínio "externo"):
    pib, vab_agropecuaria, vab_industria, vab_servicos, vab_adm_publica — R$ correntes do IBGE (o PIB municipal é publicado com cerca de dois anos de atraso; anos recentes ficam nulos)
    bolsa_familia_familias: famílias pagas em dezembro; bolsa_familia_valor: total pago no ano (R$); bolsa_familia_programa, bolsa_familia_fonte
    inss_beneficios: benefícios previdenciários emitidos em dezembro (quantidade, sem os assistenciais); inss_aposentadorias, inss_pensoes (quantidades); inss_fonte
    Bolsa Família e INSS só existem para municípios e DF.

alertas — avaliação de qualidade por ente, exercício e indicador
  exercicio, cod_ibge, nome, uf, esfera, indicador ('receita_bruta' ou 'despesa_empenhada'), dominio ('receita' ou 'despesa')
  valor (nominal), valor_real, mediana_real (mediana do próprio ente em R$ reais), razao (valor_real ÷ mediana_real), n_obs, pib
  categoria: 'ausente' (não declarado), 'suspeita' (mais de 5× ou menos de 1/5 da mediana real do ente; fica nos totais),
             'inconsistente' (mais de 10× a mediana real e acima do PIB municipal; sai dos totais), 'confirmado' (erro confirmado em revisão; sai dos totais), 'validado' (revisado e mantido)
  motivo, regra, evidencia, fonte, revisado_em
  exclui BOOLEAN: true quando o ente-ano sai dos agregados naquele domínio

escopos — quantos entes entram nos agregados
  exercicio, escopo ('BR' ou sigla da UF), esfera, dominio, tratamento ('filtrado' é o do painel; 'declarado' inclui tudo)
  populacao (soma dos entes que entram), entes (quantos entram), esperados, excluidos (por alerta), sem_dados, sem_populacao

faixas — faixas populacionais dos municípios: grupo, nome, faixa (texto, ex.: '5.000 a 9.999'), pop_min, pop_max (nulo na última)

ipca — deflator: exercicio (o ano; não há coluna ano), ipca_pct (variação dez/dez em %), indice (número-índice de dezembro), completo BOOLEAN, meses
  Valor real em R$ do ano-base = valor nominal × (indice do ano-base ÷ indice do exercício).

## Regras do painel de finanças (siga-as para os números baterem com o site)

1. Ente com dados no domínio: receita exige receita_bruta > 0; despesa exige despesa_empenhada > 0; patrimônio exige ativo IS NOT NULL.
2. Agregados (Brasil, UF, região, faixa, grupo de municípios) usam a visão filtrada: excluem o ente-ano no domínio do indicador quando há alerta com exclui = true:
     NOT EXISTS (SELECT 1 FROM alertas x WHERE x.exclui AND x.exercicio = i.exercicio AND x.cod_ibge = i.cod_ibge AND x.dominio = 'receita')
   Para um ente específico, mostre o valor declarado e avise se houver alerta.
3. Não misture esferas: "municípios" = esfera 'M'; "estados" = esfera 'E'; o DF (esfera 'D') só entra quando pedido. Um agregado de UF para municípios usa esfera = 'M' AND uf = '..'.
4. Per capita em grupos = soma do valor ÷ soma da população, só dos entes que têm o valor e entram no agregado (mesmo conjunto no numerador e no denominador). Nunca use média de per capitas, salvo se pedido.
5. Razões em grupos (ex.: dependência do FPM = fpm ÷ receita_corrente; dependência de transferências = transferencias_correntes ÷ receita_corrente; participação = parte ÷ total) = soma do numerador ÷ soma do denominador, só dos entes com os dois valores.
6. Comparações entre anos de valores monetários: use valores reais (IPCA, ano-base informado) e diga isso. Para um único ano, valores nominais bastam.
7. Rankings: considere só entes com o valor no domínio, fora dos excluídos; informe quantos entraram.

## Ao responder sobre finanças

- Cite ano, recorte, unidade (R$ correntes ou R$ reais de dez/ano-base) e, quando relevante, quantos entes entraram e se algum foi excluído.
- Diga as limitações que afetam a resposta (ano sem dados, cobertura incompleta, valor anual do Bolsa Família indisponível, PIB ainda não publicado).`;

/** Tabela da LRF (RREO e RGF): só é apresentada à IA quando os dados estão publicados (fontes.siconfi_lrf). */
const LRF = `## Tabela adicional do painel de finanças

lrf — indicadores da Lei de Responsabilidade Fiscal, do RREO (6º bimestre) e do RGF (último período, Poder Executivo), uma linha por ente e exercício, de 2015 em diante (a API do SICONFI não tem esses relatórios antes)
  exercicio, cod_ibge, nome, uf, regiao, esfera, populacao
  rreo_tipo ('RREO' ou 'RREO Simplificado'), rgf_tipo (ex.: 'RGF (Q)', 'RGF Simplificado (S)'); nulos = relatório não entregue
  rcl (receita corrente líquida), rcl_ajustada (base dos limites)
  despesa_pessoal (despesa total com pessoal do Executivo), pessoal_rcl_pct (% da RCL ajustada, em pontos: 48.5 = 48,5%), pessoal_limite_pct (limite máximo declarado: 54 municípios, 49 estados)
  divida_consolidada, dcl (dívida consolidada líquida), dcl_rcl_pct (% da RCL; limite 120 municípios, 200 estados)
  resultado_primario, meta_primario (meta da LDO), resultado_nominal
  saude_valor, saude_pct (% aplicado em saúde; mínimo 15 municípios, 12 estados), mde_valor, mde_pct (educação; mínimo 25), fundeb_pct (mínimo 70 desde 2021, 60 antes)
  Os percentuais são os declarados. Em grupos, razões = soma ÷ soma (ex.: sum(despesa_pessoal) / sum(coalesce(rcl_ajustada, rcl)), só entes com os dois valores); para os percentuais declarados use mediana e conte quem passa do limite ou fica abaixo do mínimo.`;

/** Bloco com o que muda a cada atualização (anos, ano-base, cobertura das fontes), a partir do manifesto. */
export function contextoDosDados(m) {
  if (!m) return 'Finanças: manifesto dos dados indisponível; confirme anos e cobertura consultando as tabelas.';
  const f = m.fontes ?? {};
  const linhas = [
    '# Dados disponíveis: finanças públicas',
    `Dados processados em ${m.gerado_em}.`,
    `Exercícios da DCA: ${m.anos?.[0]} a ${m.anos?.at(-1)}.`,
    `Ano-base dos valores reais: ${m.base_ipca} (R$ de dezembro de ${m.base_ipca}).`,
  ];
  if (f.ibge_pib?.anos) linhas.push(`PIB municipal: ${f.ibge_pib.anos[0]} a ${f.ibge_pib.anos[1]}${f.ibge_pib.setorial_ate ? ` (VAB setorial até ${f.ibge_pib.setorial_ate})` : ''}.`);
  if (f.bolsa_familia?.anos) {
    linhas.push(`Bolsa Família: ${f.bolsa_familia.anos[0]} a ${f.bolsa_familia.anos[1]} (último mês ${f.bolsa_familia.ultimo_mes}). `
      + 'Programas: Bolsa Família até out/2021; Auxílio Brasil de nov/2021 a fev/2023; Novo Bolsa Família desde mar/2023. '
      + 'O valor anual fica nulo quando o ano não tem os 12 meses ou tem meses de Auxílio Brasil (os arquivos não trazem o Benefício Extraordinário); o número de famílias existe.');
  }
  if (f.inss?.exercicios?.length) linhas.push(`INSS: exercícios ${f.inss.exercicios.join(', ')} (os demais ficam nulos).`);
  if (f.siconfi_lrf?.anos) linhas.push(`Tabela lrf (RREO e RGF): exercícios ${f.siconfi_lrf.anos[0]} a ${f.siconfi_lrf.anos[1]}.`, '', LRF);
  else linhas.push('Os indicadores da LRF (RREO e RGF: RCL, pessoal ÷ RCL, dívida, mínimos de saúde e educação) ainda estão em preparação e não podem ser consultados; se pedirem, diga isso em uma frase.');
  return linhas.join('\n');
}
