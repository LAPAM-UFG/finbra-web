# Internet e conectividade

Painel de banda larga fixa (SCM) da Anatel. São 39 medidas originais e 24
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
2. `python pipeline/internet.py --fontes <fontes> --saida <candidato>` gera
   painel, comparações, rankings, mapas e Parquet de trabalho.
3. `python pipeline/internet_downloads.py --base <fontes> --painel <candidato>
   --saida <downloads> --stata <StataBE-64.exe> --rscript <Rscript.exe>` gera
   28 recortes (Brasil e UFs) em Parquet, CSV, DTA e RDS, com dicionário.
4. `python pipeline/internet_integrar.py --anterior <fontes-raiox-anteriores>
   --base <fontes> --painel <candidato> --downloads <downloads>
   --saida <fontes-raiox>` fixa a integração preservando as demais áreas.
5. `python pipeline/raio_x.py --fontes <fontes-raiox> --saida <raiox>` gera v7,
   preservando os ponteiros das edições anteriores.

Os comandos não publicam. Destinos sobrepostos são recusados. As saídas nativas
são relidas e comparadas célula a célula. A seleção principal de 297 variáveis
fica preservada; Internet tem arquivo próprio com 63 medidas, 63 condições e
seis chaves, de 2013 a 2026.

## Acesso direto

Stata: `use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/internet.dta", clear`

R: carregar `https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/cliente.R`
e chamar `finbra(uf="GO", tema="internet", municipio=5208905, anos=2013:2026)`.
Os filtros de município, ano e variável do cliente R são aplicados após baixar
o recorte temático da UF; não há consulta de microdados no servidor.
