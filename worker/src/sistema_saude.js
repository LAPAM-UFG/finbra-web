/**
 * Seção do painel de saúde (SIM, SINASC e população da SVS/MS) nas instruções da IA (sistema_geral.js junta
 * as seções dos painéis marcados): conceitos, a tabela e as regras. Os anos de cada fonte vêm do manifesto
 * dos dados, num bloco à parte (contextoSaude). As fórmulas são as do painel (web/src/saude_comum.ts).
 */
export const SAUDE = `# Painel de saúde

Feito com os microdados públicos do SIM (Sistema de Informações sobre Mortalidade), do SINASC (Sistema de Informações sobre Nascidos Vivos) e do SIH (Sistema de Informações Hospitalares do SUS), do Ministério da Saúde/DATASUS, e com as estimativas de população da SVS/MS. Os registros vêm somados por ano e município de residência: não há registros individuais.

## Tabela do painel de saúde

saude_municipios — uma linha por ano e município de residência
  ano; cod_ibge (7 dígitos, como nas tabelas dos outros painéis; NULL nas linhas "Município ignorado"); municipio (6 dígitos, como o SIM e o SINASC registram; cod_ibge // 10 = municipio); nome; uf (sigla, ex.: 'GO')
  Linhas "Município ignorado" (cod_ibge NULL): registros com o município de residência sem código válido, só com a UF. Entram nos totais da UF e do Brasil, nunca em rankings ou listas de municípios.
  População residente (estimativas da SVS/MS de 1º de julho, desde 2000; antes de 2000, NULL): populacao, pop_homens, pop_mulheres, pop_menor_1, pop_0_4, pop_30_69, pop_60_mais, pop_mulheres_10_49. Não é a mesma do IBGE usada nos outros painéis.
  Óbitos não fetais (SIM, pela causa básica, CID-10): obitos, obitos_homens, obitos_mulheres
    por idade: infantis (menos de 1 ano), neonatais (0 a 27 dias), neonatais_precoces (0 a 6 dias), pos_neonatais (28 dias a menos de 1 ano), menores_5, idosos_60_mais, idade_ignorada
    por causa: maternos (O00–O95, O98–O99 e A34; sem as tardias O96–O97), externas (V01–Y98), transito (acidentes de transporte, V01–V89), homicidios (agressões X85–Y09 e intervenção legal Y35–Y36), suicidios (X60–X84), mal_definidas (R00–R99), covid (B34.2, U07.1 e U07.2, de 2020 em diante), circulatorio (I00–I99), neoplasias (C00–D48), respiratorio (J00–J99), dcnt_30_69 (30 a 69 anos, por doenças do aparelho circulatório I00–I99, câncer C00–C97, respiratórias crônicas J30–J98 e diabetes E10–E14)
    capítulos da CID-10 pela causa básica: cap01 (I. infecciosas e parasitárias, A00–B99), cap02 (II. neoplasias, C00–D48), cap03 (III. sangue e imunidade), cap04 (IV. endócrinas, nutricionais e metabólicas), cap05 (V. transtornos mentais), cap06 (VI. sistema nervoso), cap07 (VII. olho), cap08 (VIII. ouvido), cap09 (IX. aparelho circulatório), cap10 (X. aparelho respiratório), cap11 (XI. aparelho digestivo), cap12 (XII. pele), cap13 (XIII. osteomuscular), cap14 (XIV. geniturinário), cap15 (XV. gravidez, parto e puerpério), cap16 (XVI. afecções perinatais), cap17 (XVII. malformações congênitas), cap18 (XVIII. mal definidas), cap19 (XIX. lesões, S00–T98: não é causa básica, fica quase sempre zero), cap20 (XX. causas externas), cap21 (XXI. contatos com serviços de saúde), cap22 (XXII. códigos especiais, inclui a COVID-19)
  Internações hospitalares do SUS (SIH, AIH tipo 1 aprovadas, por ano de competência), pelo município de residência do paciente:
    int_total (internações); int_fora (feitas em hospital de outro município); int_dias (soma dos dias de permanência); int_obitos (com saída por óbito); int_menores_5 e int_60_mais (por idade); int_valor (valor pago, R$ correntes do ano) e int_valor_real (R$ de 2025 pelo IPCA médio do ano: use este para comparar anos; NULL em 2008 e 2009, antes do IPCA da base)
    int_cap01 a int_cap22: internações por capítulo da CID-10 do diagnóstico principal (os mesmos 22 capítulos de cap01–cap22 dos óbitos, mas aqui com o 19, lesões e envenenamentos S00–T98, e o 21, Z00–Z99, que são frequentes em internação)
  Pelo município do hospital (onde o atendimento foi feito, não onde a pessoa mora): int_atendidas (internações atendidas por hospitais do município), int_atendidas_de_fora (as de residentes de outros municípios) e int_atendidas_valor_real. Uma linha de saude_municipios tem os dois pontos de vista; não os misture numa mesma razão sem dizer qual é qual.
  obitos_fetais: óbitos fetais (DOFET), que não entram em obitos
  Nascidos vivos (SINASC, pelo município de residência da mãe): nascidos
    baixo_peso (menos de 2.500 g) e peso_informado; prematuros (menos de 37 semanas) e gestacao_informada; cesareos e parto_informado; consultas_7_mais (7 ou mais consultas de pré-natal), sem_consulta e consultas_informadas; maes_10_19, maes_35_mais e idade_mae_informada
    Cada "_informado(a)" é o número de nascidos com a informação preenchida: é o denominador da proporção correspondente, não o total de nascidos.
  Contagem NULL: num ano coberto pela fonte, nenhum registro daquele município no ano; fora dos anos da fonte (ver "Dados disponíveis"), dado indisponível. Não troque NULL por zero numa taxa: sem denominador, a taxa não é calculada.

## Indicadores (as fórmulas do painel; use estas)

Em qualquer agregado (UF, Brasil, grupo de municípios, vários anos), a taxa é a razão das somas: 1000.0 * sum(infantis) / NULLIF(sum(nascidos), 0), nunca a média das taxas dos municípios. Para uma UF ou o Brasil, some todas as linhas da UF ou do país, inclusive as de município ignorado.
- Mortalidade infantil = infantis ÷ nascidos × 1.000 (por mil nascidos vivos); neonatal = neonatais ÷ nascidos × 1.000; pós-neonatal = pos_neonatais ÷ nascidos × 1.000; na infância = menores_5 ÷ nascidos × 1.000 (aproximação usual).
- Razão de mortalidade materna = maternos ÷ nascidos × 100.000 (por 100 mil nascidos vivos).
- Taxa bruta de mortalidade = obitos ÷ populacao × 1.000 (por mil habitantes); de natalidade = nascidos ÷ populacao × 1.000.
- Homicídios, suicídios, trânsito e demais causas por habitante = contagem ÷ populacao × 100.000 (por 100 mil habitantes).
- Mortalidade prematura por doenças crônicas = dcnt_30_69 ÷ pop_30_69 × 100.000 (por 100 mil habitantes de 30 a 69 anos).
- Proporções em % (0–100): mal definidas = mal_definidas ÷ obitos; baixo peso = baixo_peso ÷ peso_informado; prematuridade = prematuros ÷ gestacao_informada; cesáreas = cesareos ÷ parto_informado; 7 ou mais consultas = consultas_7_mais ÷ consultas_informadas; mães adolescentes = maes_10_19 ÷ idade_mae_informada.
- Participação de uma causa nos óbitos = causa ÷ obitos × 100 (% dos óbitos).
- Internações por mil habitantes = int_total ÷ populacao × 1.000; de idosos = int_60_mais ÷ pop_60_mais × 1.000; de menores de 5 = int_menores_5 ÷ pop_0_4 × 1.000.
- Internações fora do município (%) = int_fora ÷ int_total × 100; mortalidade hospitalar (%) = int_obitos ÷ int_total × 100; permanência média (dias) = int_dias ÷ int_total; valor médio por internação (R$ de 2025) = int_valor_real ÷ int_total; valor por habitante = int_valor_real ÷ populacao.
Em consultar, declare as taxas com unidade "razao" e rótulo com a base (ex.: "Mortalidade infantil (por mil nascidos vivos)"); proporções e participações em "percentual"; contagens em "contagem"; populacao em "habitantes".

## Regras do painel de saúde

1. Município de residência (da pessoa que morreu ou da mãe), não o de ocorrência: um hospital regional não aumenta as mortes da cidade onde fica. Diga isso quando comparar municípios.
2. Números pequenos oscilam muito: um único óbito muda a taxa de um município pequeno. Nos rankings e comparações de municípios, use os mesmos mínimos do painel no denominador (mortalidade infantil, neonatal, pós-neonatal e na infância: 1.000 nascidos; materna: 10.000 nascidos; taxas por mil habitantes: 5.000 habitantes; por 100 mil habitantes e DCNT: 20.000 habitantes ou 5.000 de 30 a 69 anos; proporções: 100 registros com a informação), diga o critério e quantos municípios ficaram de fora; ou junte vários anos (some numeradores e denominadores) e diga quais. Mostre o numerador e o denominador ao lado da taxa.
3. Cálculo direto, sem correção: o Ministério da Saúde corrige a mortalidade infantil e a materna em UFs com subnotificação (busca ativa e fatores de correção). Os números daqui são os registrados e podem ficar abaixo das estimativas oficiais nessas UFs, sobretudo nos anos mais antigos. Diga isso ao comparar com números oficiais ou entre regiões.
4. Qualidade da causa: onde a proporção de mal definidas é alta, as taxas por causa ficam subestimadas. Em comparações de causas entre lugares ou anos distantes, mostre a proporção de mal definidas.
5. Homicídios não incluem as mortes por intenção indeterminada (Y10–Y34), parte das quais são homicídios.
6. Taxas por habitante são brutas, não padronizadas por idade: lugares com população mais velha têm mais óbitos por doenças crônicas. Não diga que um lugar tem "mais risco" só pela taxa bruta.
7. Prematuridade: em 2011 o SINASC passou a calcular a idade gestacional pela data da última menstruação e o indicador subiu de patamar; comparações que atravessam 2011 mostram a mudança de método junto com a real (diga isso na conclusão).
8. O ano mais recente pode ser preliminar no DATASUS e mudar depois da investigação dos óbitos. Use obitos_fetais só nos anos do SIM.
9. COVID-19: só de 2020 em diante; está no capítulo XXII (cap22), não no capítulo das respiratórias.
10. Distrito Federal: o SIM, o SINASC e o SIH registram o DF como Brasília (cod_ibge 5300108, municipio 530010), que é o DF inteiro.
11. SIH só tem o SUS: internações da saúde suplementar (planos) e privadas não aparecem. Taxas de internação medem uso do SUS hospitalar, não necessidade de saúde; lugares com mais cobertura de plano privado aparecem com menos internações. Não use a taxa para dizer que um lugar é "mais saudável" ou "menos saudável".
12. Ano do SIH é o da competência de processamento da AIH, não o da internação ou da alta; as de longa permanência (tipo 5) ficam de fora para não contar a mesma internação duas vezes. Valores em reais: compare anos com int_valor_real (R$ de 2025), nunca com int_valor; o valor é o da tabela de procedimentos do SUS, não o custo do hospital.
13. Internações fora do município: municípios pequenos que dependem de um polo regional têm proporção alta, o que não é falha de gestão por si só; a mortalidade hospitalar depende da gravidade e do perfil do hospital e não mede qualidade. Hospitais de referência aparecem com muitas int_atendidas_de_fora: use o ponto de vista do hospital só quando a pergunta for sobre quem recebe pacientes.
14. Números pequenos: nos rankings de internações use o mesmo mínimo do painel (taxas por mil habitantes: 5.000 habitantes; proporções e médias: 500 internações; por idade: 1.000 habitantes na faixa).`;

const inteiros = (v) => (Array.isArray(v) ? v.filter((x) => Number.isInteger(x) && x > 1900 && x < 2100) : []);
const intervalo = (a) => (a.length ? `${a[0]} a ${a.at(-1)}` : '');

/** Bloco variável: anos de cada fonte, do manifesto (só números entram no texto). */
export function contextoSaude(manifesto) {
  const f = manifesto?.fontes ?? {};
  const sim = inteiros(f.sim?.anos);
  const sinasc = inteiros(f.sinasc?.anos);
  const pop = inteiros(f.populacao_svs?.anos);
  const sih = inteiros(f.sih?.anos);
  return [
    '# Dados disponíveis: saúde',
    sim.length ? `SIM (óbitos, inclusive fetais): ${intervalo(sim)}.` : 'SIM indisponível.',
    sinasc.length ? `SINASC (nascidos vivos): ${intervalo(sinasc)}.` : 'SINASC indisponível.',
    sih.length ? `SIH (internações do SUS, por ano de competência): ${intervalo(sih)}.` : 'SIH (internações) indisponível: não há colunas int_* nesta versão dos dados.',
    pop.length ? `População da SVS/MS: ${intervalo(pop)} (taxas por habitante só a partir de ${pop[0]}).` : 'População indisponível: sem taxas por habitante.',
  ].join('\n');
}
