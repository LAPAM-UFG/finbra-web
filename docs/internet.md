# Internet e conectividade

Painel de banda larga fixa (SCM) e telefonia móvel (SMP) da Anatel. São 77 medidas originais e 48
calculadas, desde 2013. Os números ficam prontos no pipeline; o navegador lê
apenas um trecho do território escolhido, sem DuckDB/WASM.

## Referências e unidades

- Anos encerrados: estoque de dezembro. Em 2026: setembro, último mês da edição.
  `int_mes_ref` acompanha cada linha anual. Os estoques mensais não são somáveis.
- Acessos são assinaturas, não pessoas ou domicílios únicos. A densidade é
  acessos / população × 100; não é percentual de domicílios conectados.
- O universo é o SCM publicado pela Anatel, incluindo os produtos presentes
  no total oficial. Não se aplica retrospectivamente um filtro de produto que
  não existia nas edições antigas.
- Fibra e demais meios descrevem a última milha. Velocidades são contratadas,
  não medidas. As faixas históricas são preservadas; a faixa acima de 34 Mbps
  não permite inferir quantos contratos têm 100 Mbps.
- 1 Gbps ou mais é subconjunto de 100 Mbps ou mais. Não somar esses recortes.
- Pessoa física/jurídica identifica o titular. Campos não coletados nos anos
  antigos permanecem ausentes. Zero observado e ausência têm condições distintas.
- Prestadoras são CNPJs declarantes com acessos positivos. UF, Brasil e regiões
  reúnem acessos por CNPJ antes de contar, calcular a maior participação e o HHI.
  Não somar contagens de prestadoras nem tirar médias municipais desses índices.
- População: mesma referência SVS/IBGE da Saúde até 2025; estimativa municipal
  de julho de 2026 da tabela SIDRA 6579 para 2026. Não se interpola população.
- Totais originais incluem registros sem município identificado. Razões usuais
  usam pares municipais válidos e informam cobertura; a concentração usa os
  acessos agrupados por declarante do território. Não somar totais e taxas.

## Fontes

- [Anatel: banda larga fixa](https://informacoes.anatel.gov.br/paineis/acessos/banda-larga-fixa)
- [Arquivo SCM](https://www.anatel.gov.br/dadosabertos/paineis_de_dados/acessos/acessos_banda_larga_fixa.zip)
- [IBGE: estimativas municipais](https://sidra.ibge.gov.br/tabela/6579)

A edição de novembro de 2026 tem uma divergência entre as representações longa
e em colunas de janeiro a março de 2026. Usa-se o arquivo longo de 2026, que
fecha com os totais mensais oficiais. Nos outros anos usa-se a representação
em colunas, sem somar a sua duplicata longa. Todos os meses são cotejados com
`Acessos_Banda_Larga_Fixa_Total.csv`. Mudança de edição exige novo cotejo.

## Reprodução em pastas novas

1. `python pipeline/internet_fontes.py --fontes <fontes>` adquire o ZIP oficial,
   fixa fontes publicadas por SHA-256, obtém a população de 2026 e normaliza.
2. Para a ampliação, `python pipeline/internet_smp_fontes.py --fontes <fontes-novas>
   --fixa <fontes-SCM-normalizadas>` preserva a edição SCM e acrescenta tecnologias,
   limiares de velocidade e o SMP. Os manifestos publicados, geografia, dicionário,
   catálogos UF e o Parquet principal precisam estar fixados por hash nas fontes
   novas, assim como na etapa 1. Os arquivos novos são preparados fora do gold ativo.
3. `python pipeline/internet.py --fontes <fontes> --saida <candidato>` gera
   painel, comparações, rankings, mapas e Parquet de trabalho.
4. `python pipeline/internet_downloads.py --base <fontes> --painel <candidato>
   --saida <downloads> --stata <StataBE-64.exe> --rscript <Rscript.exe>` gera
   28 recortes (Brasil e UFs) em Parquet, CSV, DTA e RDS, com dicionário.
5. `python pipeline/internet_integrar.py --anterior <fontes-raiox-anteriores>
   --base <fontes> --painel <candidato> --downloads <downloads>
   --saida <fontes-raiox>` fixa a integração preservando as demais áreas.
6. `python pipeline/raio_x.py --fontes <fontes-raiox> --saida <raiox>` gera v8 na edição com SMP,
   preservando os ponteiros das edições anteriores.

Os comandos não publicam. Destinos sobrepostos são recusados. As saídas nativas
são relidas e comparadas célula a célula. A seleção principal de 297 variáveis
fica preservada; Internet tem arquivo próprio com 125 medidas, 125 condições e
seis chaves, de 2013 a 2026.

## Acesso direto

Stata: `use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/internet.dta", clear`

R: carregar `https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/cliente.R`
e chamar `finbra(uf="GO", tema="internet", municipio=5208905, anos=2013:2026)`.
Os filtros de município, ano e variável do cliente R são aplicados após baixar
o recorte temático da UF; não há consulta de microdados no servidor.


## Ampliação: telefonia móvel

- Série municipal desde 2019. A fonte alerta para a validação do primeiro ano da
  nova coleta. O painel não distribui totais estaduais anteriores entre municípios.
- Uso padrão reúne os produtos VOZ, DADOS, VOZ+DADOS e a antiga categoria OCIOSO,
  em concordância com o resumo nacional. M2M, inclusive categorias históricas,
  pontos de serviço e produtos não classificáveis ficam separados.
- As participações de geração, plano e titular usam apenas o padrão como base.
  A composição dos tipos de assinatura usa todas as assinaturas móveis.
- 5G tem coleta desde agosto de 2021 e pode incluir DSS; não é uma medida restrita
  a 5G SA. Antes da coleta permanece ausente. Gerações não medem cobertura do sinal.
- Assinaturas por 100 habitantes não são percentual de pessoas conectadas;
  pessoas e equipamentos podem ter múltiplas linhas. Não somar SCM e SMP.
- A aquisição do SMP lê por HTTP Range apenas os membros necessários do ZIP,
  com ETag fixada, limites, tamanho, CRC32 e SHA-256 de cada CSV. O resumo nacional
  traz apenas o uso padrão e termina em agosto de 2026; os CSVs detalhados chegam
  a setembro. 89 dos 92 meses comuns fecham com o resumo. Janeiro e julho de 2019 e junho de 2022 ainda divergem entre as fontes oficiais. Mantém-se o detalhado, com aviso no gráfico mensal, nas exportações e no campo auxiliar int_smp_meses_divergentes; as diferenças não são rateadas entre municípios. Os retratos de dezembro conferem. Setembro é conferido no
  arquivo longo, e o mês de referência acompanha cada medida.
- Em 2019, as representações longa e em colunas não são equivalentes. Junho de 2022
  também foi cotejado no arquivo longo; sua diferença com o resumo permanece.
  O pipeline usa os longos desses semestres, além do último semestre de
  2026, e impede a sobreposição de meses entre as representações.
- Os arquivos de assinaturas continuam distintos de pesquisas domiciliares,
  medições de velocidade ou mapas de área coberta.

Fonte: [Anatel · Telefonia móvel](https://informacoes.anatel.gov.br/paineis/acessos/telefonia-movel).
