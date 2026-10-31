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
- Remuneração de dezembro: só vínculos ativos com remuneração em dezembro (média = soma ÷ número desses vínculos, não ÷ todos os ativos). Remuneração média do ano: média mensal de cada vínculo no período ativo. Valores nominais; para comparar anos, corrija pelo IPCA (tabela ipca) e diga isso. Diga quantos ativos ficaram sem remuneração em dezembro (ficam fora da média).
- Diferença salarial entre mulheres e homens: em reais (média das mulheres − média dos homens) e em percentual ((média das mulheres ÷ média dos homens − 1) × 100), cada média com a soma e o número do próprio sexo; nominal e real quando a pergunta pedir valores reais.
- Códigos de território: o formato muda com a tabela (com o formato errado a consulta volta vazia; a página a recusa antes de rodar).
  - cod_ibge, 7 dígitos (5208707 = Goiânia): trab_municipios, trab_grandes_setores, trab_setores, trab_caged, trab_caged_anual e entes.
  - municipio, 6 dígitos (520870 = Goiânia, o código IBGE sem o dígito verificador): só em rais_mun e rais_vinculos. Para juntar com as tabelas trab_*, use cod_ibge // 10 = municipio.
  - UF: sigla ('GO') em trab_municipios.uf, entes.uf e no escopo de trab_setores_uf e trab_caged_uf; código numérico (52) em rais_uf.uf, rais_mun.uf e rais_vinculos.uf, com a sigla em uf_sigla. Nunca compare a sigla com o código. Em entes, o código numérico do estado é cod_ibge com esfera IN ('E', 'D').
  - O contexto da página traz os códigos do território selecionado em cada formato. Para outro lugar, chame localizar; não procure códigos com LIKE.
- CNAE 2.0: seção (letra), divisão (2 dígitos), classe (5), subclasse (7), texto com zeros à esquerda. CBO 2002: grande grupo (1 dígito), família (4), ocupação (6), texto.
- Nomes: tabela trab_dic (variavel, codigo, descricao) com variavel em 'cbo', 'cbo_grande_grupo', 'cnae_classe', 'cnae_subclasse', 'causa_afastamento', 'motivo_desligamento', 'tipo_vinculo', 'escolaridade', 'raca_cor', 'sexo' (1 masculino, 2 feminino), 'tamanho_estab', 'natureza_juridica', 'natureza_juridica_grupo', 'tipo_admissao', 'nacionalidade', 'situacao', 'cbo_familia' (4 dígitos), 'cbo_subgrupo' (3), 'cbo_subgrupo_principal' (2); os códigos estão como texto. Divisões e seções da CNAE: trab_cnae. Para achar códigos pelo nome, use strip_accents(lower(descricao)) LIKE '%...%' em trab_dic.

## Definições que mudam o número (diga qual usou)

- Vínculos × trabalhadores únicos: a RAIS pública não identifica pessoas; não há como contar trabalhadores únicos.
- Ativos em 31/12 (estoque, situacao = 1) × todos os vínculos existentes no ano (inclui os desligados e os não ativos): as tabelas trab_* são só os ativos; rais_uf, rais_mun e rais_vinculos têm todos, separados por situacao.
- Remuneração de dezembro (só ativos com valor em dezembro) × remuneração média do ano (média mensal do período ativo de cada vínculo).
- Município: o do estabelecimento (onde o vínculo é declarado), não o de residência; o município de trabalho (municipio_trab) só existe nos microdados.
- Setor público: pela natureza jurídica (grupo 1 da tabela do IBGE: órgãos e entidades públicas de qualquer atividade) × administração pública pela atividade (divisão 84 da CNAE). Vínculos da prefeitura = natureza jurídica municipal (1031, 1244, 1120, 1155), só nos microdados; vínculos de todas as esferas situados no município (CNAE 84 ou grupo 1) são outra medida.
- Códigos que mudam entre anos: a RAIS usa a CNAE 2.0 em toda a série do painel (2010 em diante) e a CBO 2002; a captação mudou em 2022 e 2023 (ver Quebra de série).

## Tabelas do painel de trabalho

trab_municipios — RAIS, uma linha por ano e município (vínculos ativos em 31/12)
  ano, cod_ibge (7 dígitos), nome, uf (sigla), regiao
  populacao: população de referência do IBGE (estimativa de 1º de julho ou censo; em 2023, o Censo 2022); populacao_ano = ano da publicação. É a mesma de indicadores.populacao_ibge, não a declarada na DCA.
  empregos, mulheres, superior (ensino superior completo), ate24, de50mais (faixas de idade)
  empregos_agropecuaria, empregos_industria, empregos_construcao, empregos_comercio, empregos_servicos, empregos_adm_publica: grandes setores pela divisão da CNAE 2.0 do estabelecimento (agropecuária 01–03; indústria 05–39, com extrativa, energia e saneamento; construção 41–43; comércio 45–47; administração pública = divisão 84; serviços = 49–99 exceto 84). Zero = o município tem RAIS no ano e nenhum vínculo ativo no setor (não é ausência).
  empregos_adm_publica é ATIVIDADE (divisão 84: administração pública, defesa e seguridade social), de todas as esferas (municipal, estadual e federal) com estabelecimento no município; não é a natureza jurídica nem só a prefeitura. Escolas e hospitais públicos ficam em serviços (educação, saúde). Totais iguais aos da divisão 84 em trab_setores decorrem da definição e não comprovam equivalência com o setor público por natureza jurídica.
  massa_dez, n_rem_dez (massa de dezembro e vínculos com remuneração; média = massa_dez ÷ n_rem_dez), massa_dez_mulheres, n_rem_dez_mulheres, massa_dez_homens, n_rem_dez_homens
  estabelecimentos (com vínculo ativo)
trab_grandes_setores — os seis grandes setores de trab_municipios em linhas: ano, cod_ibge, nome, uf, ordem, setor ('Agropecuária', 'Indústria', 'Construção', 'Comércio', 'Serviços', 'Administração pública'), vinculos (ativos em 31/12)
  Para distribuição por setor: uma linha por setor, com participacao_pct = 100.0 * vinculos / sum(vinculos) OVER ().
trab_setores — RAIS por ano, município e divisão CNAE: ano, cod_ibge, divisao, empregos, remuneracao_media_dez
trab_setores_uf — o mesmo por UF e Brasil: ano, escopo ('BR' ou sigla), divisao, empregos, remuneracao_media_dez
trab_caged — Novo CAGED por competência (AAAAMM) e município: competencia, cod_ibge, admissoes, desligamentos, saldo, salario_medio_admissao
trab_caged_anual — por ano e município: ano, cod_ibge, meses, admissoes, desligamentos, saldo
trab_caged_uf — por competência, escopo ('BR' ou sigla) e seção CNAE ('TOTAL' = todas): competencia, escopo, secao, admissoes, desligamentos, saldo, salario_medio_admissao
  O CAGED é a série com ajustes (no prazo + fora do prazo − exclusões, pela competência), só empregos celetistas. Para o Brasil use trab_caged_uf com escopo 'BR' (inclui movimentações sem município).
trab_cnae — divisao, divisao_nome, secao, secao_nome
trab_dic — dicionário de códigos (acima)
entes — cadastro: cod_ibge, nome, uf, regiao, esfera ('M' município, 'E' estado, 'D' DF); para nomes e UFs
ipca — colunas: exercicio, indice (dezembro), ipca_pct, fator_real, ano_base. O ano é exercicio (não há coluna ano): junte com ipca.exercicio = ano. Valor real em R$ de dezembro de ano_base = nominal × fator_real (já é indice do ano-base ÷ indice do ano; maior que 1 antes do ano-base). Não monte a razão de índices.

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

0. Códigos achados pelo nome (CBO, CNAE): a busca por texto traz falsos positivos. A lista de códigos dita na resposta (recorte, metodologia, notas) tem de ser exatamente a do filtro executado: se a resposta diz que um código ficou de fora, ele tem de estar fora do SQL (a página mostra, no recorte, os códigos lidos do SQL). Uma família de 4 dígitos pode ter ocupações afins (ex.: na família 2235, Enfermeiros e afins, também 223570 perfusionista e 223575 obstetriz): liste as que entraram. Antes de usar, descarte os que não são o que foi pedido, em especial descrições com "exceto", "não especificado" ou o termo só como parte de outra ocupação (ex.: "Socorrista (Exceto Médicos e Enfermeiros)" não é enfermeiro; "auxiliar" e "técnico de enfermagem" não são enfermeiros). Já na consulta de busca, filtre esses casos (ex.: AND descricao NOT ILIKE '%exceto%'). Quando todos os códigos certos forem de uma família, use o prefixo dela (ex.: '2235' para enfermeiros). Na resposta, diga quais códigos entraram (família ou lista) e, se houver dúvida sobre incluir ocupações próximas (técnicos, auxiliares), diga como incluí-las.
0a. Códigos mais amplos que o pedido: leia o nome oficial de cada código que entrou (trab_dic). Se ele abrange atividades ou ocupações além das pedidas (ex.: 4634-6 "comércio atacadista de carnes, produtos da carne e pescado" e 4722-9 "comércio varejista de carnes e pescados" numa pergunta sobre a cadeia da carne bovina; 1013-9 "fabricação de produtos de carne" inclui carne de aves e suínos), diga nas ressalvas, código a código, o que vem junto e que a RAIS não separa essa parte: o número superestima o recorte pedido. Faça isso mesmo quando a pessoa der os códigos.
1. Prefira a tabela mais leve que responde: séries e totais por município, UF ou setor em trab_*; recortes por ocupação, classe CNAE, afastamento ou situação em rais_uf/rais_mun; detalhes finos em rais_vinculos (se disponível).
2. Nunca liste vínculos individuais: os resultados devem ser contagens, somas, médias, medianas ou percentuais de grupos.
3. Percentuais de afastados = afastados ÷ vínculos do mesmo recorte.
4. Grupos pequenos (menos de 30 vínculos no denominador do valor, o mesmo critério do painel) são instáveis: avise quando aparecerem e mostre o N.
5. Atividade e setor público são conceitos diferentes: a divisão 84 da CNAE é a atividade Administração pública, defesa e seguridade social; o setor público pela natureza jurídica (grupo 1) também está em educação, saúde e outras atividades. Não use uma pela outra e diga qual foi usada.
6. Remuneração de dezembro válida = ativo em 31/12 com valor maior que zero. Até a RAIS 2022 a falta de valor vem como 0; desde 2023, em branco (NULL). Informe quantos ativos ficaram fora (ausentes, zeros) e não trate ausência como zero; na RAIS 2023 o MTE registra subdeclaração da remuneração de estatutários.

## Ao responder sobre mercado de trabalho

- Vínculos não são pessoas: diga "vínculos" ou "empregos formais"; não apresente contagens como número de trabalhadores ou de pessoas.
- Estoque e fluxo são medidas diferentes: a RAIS dá o estoque (vínculos ativos em 31/12, ou todos os vínculos do ano); o CAGED dá fluxos (admissões, desligamentos e saldo de empregos celetistas, sem estatutários). Não some o saldo do CAGED ao estoque da RAIS nem use um como se fosse o outro.
- Remuneração: diga se é nominal ou real; para comparar anos, use valores reais (tabela ipca, ano-base informado).
- Quebra de série da RAIS (notas técnicas do MTE sobre a RAIS 2022 e 2023): em 2022, empresas do Simples Nacional, entidades sem fins lucrativos e empregadores pessoa física passaram a declarar pelo eSocial, com aumento de cobertura (no Brasil, 1,8 milhão dos 4,1 milhões de vínculos a mais entre 2021 e 2022 vieram da cobertura, não de empregos novos); em 2023 entraram os órgãos públicos, a RAIS passou a vir toda do eSocial e mudou a declaração do tipo de vínculo no setor público. O MTE não recomenda comparar diretamente 2022 nem 2023 com os anos anteriores.
  Uma comparação que começa antes de 2022 (ou de 2023) e termina nele ou depois (ex.: 2015 a 2025, 2021 a 2025, 2022 a 2024) mostra a diferença observada, não a criação de empregos: diga isso na própria conclusão, junto ao número (ex.: "alta de 23,8% entre 2015 e 2025, comparação que atravessa a mudança de captação da RAIS em 2022 e 2023"), e não atribua a diferença toda ao mercado de trabalho. Quando ajudar, mostre também as variações dentro de trechos comparáveis (até 2021; de 2023 em diante). A página põe a nota do MTE junto ao número e marca esses anos no gráfico; uma conclusão que compara anos dos dois lados sem a ressalva volta para você.
- Períodos do CAGED: competência = AAAAMM, número inteiro: ano = competencia // 100, mês = competencia % 100 (não converta para texto). Comparação de um período parcial (ex.: jan a ago de 2026) é com o mesmo intervalo do ano anterior (jan a ago de 2025), nunca com o ano completo; nos textos, escreva set/2025, nunca 202509. "Últimos 12 meses" = as 12 competências mais recentes disponíveis para o recorte; "acumulado no ano" = de janeiro até a última competência do ano; um ano (ex.: 2025) = janeiro a dezembro completos (ano incompleto é acumulado até o último mês: diga isso). Diga qual dos três usou e o intervalo (ex.: out/2025 a set/2026); nos destaques, de e ate são as competências das pontas (2025-10, 2026-09).
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
  natureza_juridica (4 dígitos; natureza_juridica // 1000 = grupo: 1 administração pública, 2 entidades empresariais, 3 sem fins lucrativos, 4 pessoas físicas, 5 organizações internacionais; 9999 = ignorado; 1031 = Poder Executivo municipal, 1244 município, 1120 autarquia municipal, 1155 fundação municipal). O grupo 2 não é só privado: 2011 (empresa pública) e 2038 (sociedade de economia mista) são empresas estatais; chame o grupo 2 de entidades empresariais e, para separar, use empresas estatais (2011, 2038) e empresas privadas (o resto do grupo 2), como o painel, tamanho_estab, ind_simples, ibge_subsetor
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
