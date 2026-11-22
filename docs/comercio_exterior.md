# Comércio exterior municipal

Fonte: [MDIC/Secex — Comex Stat, dados brutos municipais](https://www.gov.br/mdic/pt-br/assuntos/comercio-exterior/estatisticas/base-de-dados-bruta).

O painel `/comex` utiliza arquivos municipais de exportação e importação desde 2013, as tabelas oficiais de municípios, países e SH4 e os totais de conferência do MDIC. Os dados são agregados antes da publicação: a primeira abertura baixa só o catálogo e pequenos trechos do território, sem carregar microdados ou DuckDB.

## Interpretação

- Bens, em **US$ correntes FOB** e peso líquido declarado em kg. Não se aplica IPCA nem conversão para reais.
- Município é o **domicílio fiscal da empresa declarante**. Não identifica necessariamente o local da produção, nem permite contar empresas distintas.
- Produtos são posições SH4; mercados são códigos MDIC, incluindo países, territórios e destinos estatísticos. Classificações podem mudar.
- A edição de 6/11/2026 cobre janeiro–outubro/2026. Os totais observados preservam os 12 meses dos anos anteriores; os indicadores comparáveis usam janeiro–outubro em **todos os anos**. Variação anual usa os mesmos meses no ano anterior; não há taxa quando a base anterior é zero.
- Saldo = exportações menos importações; corrente de comércio = exportações mais importações.
- HHI = soma dos quadrados dos valores FOB por produto/mercado, dividida pelo quadrado do valor total, vezes 10.000. Participações e HHI são indefinidos sem comércio de valor positivo.
- Referências regionais, estaduais e nacionais reúnem produtos e mercados antes de calcular concentração e contagens distintas. Não são médias de HHI ou somas de contagens municipais.
- A tabela MDIC tem códigos diferentes dos IBGE em algumas UFs. A correspondência exige nome oficial e UF, código IBGE existente ou um dos três aliases históricos documentados. Não há aproximação textual. Exterior e Não declarado permanecem no Brasil, sem distribuir valores aos municípios.
- Zero significa ausência de operações nos arquivos do período, não dado substituído nem ausência de atividade econômica geral. Municípios ausentes da tabela MDIC ficam indisponíveis, inclusive nos arquivos anuais e mensais. Nesta edição são Aroeiras do Itaim/PI, Figueirão/MS e Boa Esperança do Norte/MT. Referências que os incluem identificam cobertura incompleta, mantendo os totais oficiais observados. Um ajuste FOB negativo de US$ 1 na fonte de importações é preservado; os pesos líquidos agregados de concentração são conferidos como não negativos.

São 63 medidas base e 15 comparáveis, com condições separadas. A seleção nacional enxuta de 297 variáveis permanece igual. O download temático anual tem 78 medidas, suas 78 condições e seis identificadores. O mensal tem município × mês, cinco medidas e condições, além dos identificadores e mês/período.

## Reprodução

Use diretórios candidatos novos e separados das fontes. `comex_fontes.py` baixa e fixa fontes por SHA-256, incluindo os totais oficiais de controle. Downloads interrompidos só continuam com ETag e Content-Range conferidos, com TLS validado.

```powershell
python pipeline/comex_fontes.py --fontes E:/finbra/fontes_comex_NOVA
python pipeline/comex.py --fontes E:/finbra/fontes_comex_NOVA --saida E:/finbra/candidato_comex_NOVO
python pipeline/comex_downloads.py --base E:/finbra/fontes_comex_NOVA --painel E:/finbra/candidato_comex_NOVO --saida E:/finbra/candidato_downloads_comex_NOVO --stata 'C:/Program Files/Stata18/StataBE-64.exe' --rscript 'C:/Program Files/R/R-4.6.1/bin/Rscript.exe'
```

`comex_integrar.py` fixa os grafos anteriores e acrescenta as séries novas ao Raio X, sem alterar séries existentes. `raio_x.py` gera a edição v11 quando há Comex. Valide todos os artefatos antes da ativação dos manifestos no R2. As edições antigas do Raio X devem permanecer disponíveis. Publique a permissão do tema `comex` no cliente R antes de ativar o catálogo novo.

## API

```r
base <- "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1"
source(paste0(base, "/cliente.R"))
x <- finbra(uf="GO", tema="comex")
m <- read.csv(paste0(base, "/comex/mensal/GO.csv"), sep=";", encoding="UTF-8")
```

```stata
use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/comex.dta", clear
xtset cod_ibge ano
import delimited "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/comex/mensal/GO.csv", delimiter(";") encoding("UTF-8") asdouble clear
gen mensal = ym(ano, mes)
format mensal %tm
xtset cod_ibge mensal
```

Substitua GO pela UF ou BR para todos os municípios. O dicionário anual está em `/api/dados/v1/dicionario.json?tema=comex`; o mensal em `/api/dados/v1/comex/dicionario-mensal.csv`. As rotas aceitam GET/HEAD, Range, ETag e CORS. UF e tema selecionam arquivos prontos; demais filtros são aplicados pelo cliente.
