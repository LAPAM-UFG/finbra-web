/**
 * Seção do painel de mercado de trabalho (RAIS e Novo CAGED) nas instruções da IA (sistema_geral.js junta
 * as seções dos painéis marcados): conceitos, tabelas e regras. O que muda (anos disponíveis, se há
 * microdados) vem do navegador, num bloco à parte (contextoTrabalho).
 */
export const TRABALHO = `# Painel de mercado de trabalho

Feito com os microdados públicos da RAIS (Relação Anual de Informações Sociais) e do Novo CAGED, do Ministério do Trabalho e Emprego. Os arquivos públicos não identificam pessoas nem empresas.

## Conceitos

- A unidade da RAIS é o vínculo de emprego, não a pessoa: quem tem dois empregos conta duas vezes; não dá para contar pessoas nem seguir alguém entre anos. Diga "vínculos" (ou "empregos formais" para os ativos em 31/12).
- Empregos formais = vínculos ativos em 31 de dezembro, no município do estabelecimento.
- situacao: 1 = ativo em 31/12; 2 = desligado no ano (não ativo, com motivo de desligamento); 3 = não ativo sem desligamento.
- afastado: vínculo com afastamento no ano (primeira causa entre 10 e 90: acidente, doença, licença-maternidade, serviço militar, licenças, suspensão).
- Remuneração de dezembro: só vínculos ativos com remuneração em dezembro (média = soma ÷ número). Remuneração média do ano: média mensal de cada vínculo no período ativo. Valores nominais; para comparar anos, corrija pelo IPCA (tabela ipca) e diga isso.
- Códigos: município da RAIS/CAGED tem 6 dígitos (código IBGE sem o dígito verificador: 520870 = Goiânia; cod_ibge de 7 dígitos ÷ 10). Nas tabelas rais_uf, rais_mun e rais_vinculos, uf é o código IBGE numérico de 2 dígitos (52) e uf_sigla é a sigla ('GO'): filtre e mostre UFs por uf_sigla. Atenção: em entes e trab_municipios, a coluna uf é a sigla ('GO'); o código numérico do estado é entes.cod_ibge com esfera IN ('E', 'D'). Nunca compare a sigla com o código. CNAE 2.0: seção (letra), divisão (2 dígitos), classe (5), subclasse (7), texto com zeros à esquerda. CBO 2002: grande grupo (1 dígito), família (4), ocupação (6), texto.
- Nomes: tabela trab_dic (variavel, codigo, descricao) com variavel em 'cbo', 'cbo_grande_grupo', 'cnae_classe', 'cnae_subclasse', 'causa_afastamento', 'motivo_desligamento', 'tipo_vinculo', 'escolaridade', 'raca_cor', 'sexo' (1 masculino, 2 feminino), 'tamanho_estab', 'natureza_juridica', 'natureza_juridica_grupo', 'tipo_admissao', 'nacionalidade', 'situacao'; os códigos estão como texto. Divisões e seções da CNAE: trab_cnae. Para achar códigos pelo nome, use strip_accents(lower(descricao)) LIKE '%...%' em trab_dic.

## Tabelas do painel de trabalho

trab_municipios — RAIS, uma linha por ano e município (vínculos ativos em 31/12)
  ano, cod_ibge (7 dígitos), nome, uf (sigla), regiao, populacao
  empregos, mulheres, superior (ensino superior completo), ate24, de50mais (faixas de idade)
  empregos_agropecuaria, empregos_industria, empregos_construcao, empregos_comercio, empregos_servicos, empregos_adm_publica
  massa_dez, n_rem_dez (massa de dezembro e vínculos com remuneração; média = massa_dez ÷ n_rem_dez), massa_dez_mulheres, n_rem_dez_mulheres, massa_dez_homens, n_rem_dez_homens
  estabelecimentos (com vínculo ativo)
trab_setores — RAIS por ano, município e divisão CNAE: ano, cod_ibge, divisao, empregos, remuneracao_media_dez
trab_setores_uf — o mesmo por UF e Brasil: ano, escopo ('BR' ou sigla), divisao, empregos, remuneracao_media_dez
trab_caged — Novo CAGED por competência (AAAAMM) e município: competencia, cod_ibge, admissoes, desligamentos, saldo, salario_medio_admissao
trab_caged_anual — por ano e município: ano, cod_ibge, meses, admissoes, desligamentos, saldo
trab_caged_uf — por competência, escopo ('BR' ou sigla) e seção CNAE ('TOTAL' = todas): competencia, escopo, secao, admissoes, desligamentos, saldo, salario_medio_admissao
  O CAGED é a série com ajustes (no prazo + fora do prazo − exclusões, pela competência), só empregos celetistas. Para o Brasil use trab_caged_uf com escopo 'BR' (inclui movimentações sem município).
trab_cnae — divisao, divisao_nome, secao, secao_nome
trab_dic — dicionário de códigos (acima)
entes — cadastro: cod_ibge, nome, uf, regiao, esfera ('M' município, 'E' estado, 'D' DF); para nomes e UFs
ipca — colunas: exercicio, indice (dezembro), ipca_pct. O ano é exercicio (não há coluna ano): junte com ipca.exercicio = ano. Valor real em R$ do ano-base = nominal × (indice do ano-base ÷ indice do ano)

## Tabelas somadas dos microdados da RAIS (consulta detalhada)

rais_uf — colunas: ano, uf, uf_sigla, cnae_classe, cbo, sexo, situacao, afastado + medidas (todos os vínculos do ano, ativos ou não)
rais_mun — colunas: ano, municipio (6 dígitos), uf (2 dígitos), uf_sigla, cnae_divisao, cbo_grande_grupo, sexo, situacao, afastado + medidas
  (rais_mun não tem cnae_classe nem cbo de 6 dígitos: para ocupação ou classe CNAE numa UF use rais_uf; num município, rais_vinculos se disponível)
  Medidas nas duas: vinculos, superior (com superior completo), dias_afastamento (soma, só afastados),
  rem_dez_soma, rem_dez_n (ativos com remuneração em dezembro), rem_media_soma, rem_media_n, horas_soma, horas_n, idade_soma, idade_n
  Médias = soma ÷ contagem, depois de somar o grupo (ex.: sum(rem_dez_soma) / nullif(sum(rem_dez_n), 0)). Medianas não são possíveis nestas tabelas.
  Combinação de CNAEs ou CBOs: filtre por prefixo (starts_with(cnae_classe, '4711') OR starts_with(cnae_classe, '4712')) e some.
  Sempre filtre por ano (cada ano é um arquivo grande); para uma UF, filtre uf (código de 2 dígitos); para um município, use rais_mun com municipio de 6 dígitos.
  Os ativos (situacao = 1) somam os empregos formais de trab_municipios.

## Regras do painel de trabalho

0. Códigos achados pelo nome (CBO, CNAE): a busca por texto traz falsos positivos. Antes de usar, descarte os que não são o que foi pedido, em especial descrições com "exceto", "não especificado" ou o termo só como parte de outra ocupação (ex.: "Socorrista (Exceto Médicos e Enfermeiros)" não é enfermeiro; "auxiliar" e "técnico de enfermagem" não são enfermeiros). Já na consulta de busca, filtre esses casos (ex.: AND descricao NOT ILIKE '%exceto%'). Quando todos os códigos certos forem de uma família, use o prefixo dela (ex.: '2235' para enfermeiros). Na resposta, diga quais códigos entraram (família ou lista) e, se houver dúvida sobre incluir ocupações próximas (técnicos, auxiliares), diga como incluí-las.
1. Prefira a tabela mais leve que responde: séries e totais por município, UF ou setor em trab_*; recortes por ocupação, classe CNAE, afastamento ou situação em rais_uf/rais_mun; detalhes finos em rais_vinculos (se disponível).
2. Nunca liste vínculos individuais: os resultados devem ser contagens, somas, médias, medianas ou percentuais de grupos.
3. Percentuais de afastados = afastados ÷ vínculos do mesmo recorte.
4. Grupos pequenos (menos de 10 vínculos) são instáveis: avise quando aparecerem.

## Ao responder sobre mercado de trabalho

- Cite ano, recorte, a unidade (vínculos; R$ nominais ou reais) e o que entrou (ativos em 31/12, todos os vínculos do ano etc.).`;

/** Microdados completos (quando publicados): uma linha por vínculo. */
const MICRODADOS = `## Microdados da RAIS (disponíveis nesta sessão)

rais_vinculos — uma linha por vínculo, todos os vínculos do ano (ativos ou não em 31/12). Muito grande: SEMPRE filtre ano e uf (código de 2 dígitos) e agregue.
  ano, uf, uf_sigla, municipio (6 dígitos), municipio_trab, cnae_classe, cnae_subclasse, cbo (6 dígitos, texto)
  ativo_31_12 (1/0), tipo_vinculo, mes_admissao, tipo_admissao, mes_desligamento, motivo_desligamento (0 = não desligado)
  causa_afastamento_1, causa_afastamento_2, causa_afastamento_3 (99 ou 999 = sem afastamento), dias_afastamento
  sexo (1 masculino, 2 feminino), idade, escolaridade (1 a 11; 9 = superior completo, 10 mestrado, 11 doutorado), raca_cor, deficiente, tipo_deficiencia, nacionalidade
  horas_contratadas, tempo_emprego (meses)
  rem_dezembro_nom, rem_media_nom (R$ nominais, já em reais com centavos; use só valores > 0), rem_dezembro_sm, rem_media_sm (em salários mínimos, ex.: 5.74)
  Se algum valor parecer fora de escala, não o corrija por conta própria: mostre como veio e avise na resposta.
  rem_janeiro … rem_novembro (desde 2015), ind_intermitente, ind_parcial (desde 2017)
  natureza_juridica (4 dígitos; natureza_juridica // 1000 = grupo: 1 administração pública, 2 empresas, 3 sem fins lucrativos; 1031 = Poder Executivo municipal, 1120 autarquia municipal, 1155 fundação municipal), tamanho_estab, ind_simples, ibge_subsetor
  Situação e afastamento como nas tabelas somadas: situacao = CASE WHEN ativo_31_12 = 1 THEN 1 WHEN motivo_desligamento > 0 THEN 2 ELSE 3 END; afastado = causa_afastamento_1 BETWEEN 10 AND 90.
  Aqui dá para calcular medianas e percentis (median(), quantile_cont()) e cruzar qualquer variável.
  Cada ano e UF é um arquivo de dezenas a centenas de MB, lido pela internet: use rais_vinculos só quando a pergunta precisar (medianas, percentis, variáveis que não estão em rais_uf/rais_mun), para poucas UFs e anos. Para o Brasil inteiro ou séries longas, use rais_uf.`;

const inteiros = (v) => (Array.isArray(v) ? v.filter((x) => Number.isInteger(x) && x > 1900 && x < 2100).slice(0, 60) : []);

/**
 * Bloco variável, a partir do que o navegador informa: anos de cada tabela e se os microdados estão
 * disponíveis (só no servidor local). Só números e um booleano entram no texto.
 */
export function contextoTrabalho(c) {
  const rais = inteiros(c?.rais_anos);
  const micro = inteiros(c?.micro_anos);
  const caged = [c?.caged_de, c?.caged_ate].map((x) => (Number.isInteger(x) && x > 190000 && x < 210000 ? x : null));
  const linhas = [
    '# Dados disponíveis: mercado de trabalho',
    rais.length ? `RAIS nas tabelas do painel (trab_municipios, trab_setores): ${rais.join(', ')}.` : 'Tabelas da RAIS indisponíveis.',
    caged[0] ? `Novo CAGED: competências ${caged[0]} a ${caged[1]}.` : 'Novo CAGED indisponível.',
    micro.length ? `Tabelas somadas dos microdados (rais_uf, rais_mun): ${micro.join(', ')}.` : 'As tabelas rais_uf e rais_mun ainda não estão disponíveis; se pedirem recortes por ocupação, classe CNAE ou afastamento, diga isso em uma frase.',
    Number.isInteger(c?.base_ipca) ? `Ano-base dos valores reais: ${c.base_ipca}.` : '',
  ].filter(Boolean);
  if (c?.microdados === true && micro.length) linhas.push('', MICRODADOS, `Anos com microdados: ${micro.join(', ')}.`);
  else linhas.push('Os microdados linha a linha (rais_vinculos) não estão disponíveis nesta sessão: use as tabelas somadas.');
  return linhas.join('\n');
}
