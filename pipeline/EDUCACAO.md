# Educação — Inep

Painel `/educacao`, desde 2013, com 43 indicadores pré-calculados. O SIOPE permanece em `/educacao/financiamento` e `/educacao/profissionais`.

## Fontes e significado

- Censo Escolar: tabelas de escolas e contagens de matrículas, no catálogo público do Inep. Até 2024 a tabela é única; em 2025, versão 2, escola e matrícula são unidas por `CO_ENTIDADE`, com validação um a um.
- Cadastro: uma escola de Sapiranga em 2025 tem nome municipal e sigla ausentes. A UF é conciliada pelo prefixo validado do código IBGE; o nome, pelo mesmo código nas demais escolas. Nenhum número é preenchido por esse tratamento.
- Taxas de rendimento (aprovação, reprovação e abandono) e distorção idade-série: arquivos municipais e Brasil/regiões/UF, rede **pública**, localização **total**.
- Ideb: os arquivos oficiais incluem o histórico bienal. Importam-se os anos desde 2013, rede pública, e uma medida separada da rede estadual no ensino médio. Os resultados estaduais e nacionais são os publicados, sem média municipal. O ensino médio municipal tem observações desde 2017; o dicionário dos downloads informa os anos realmente observados nas colunas municipais.
- Matrículas e escolas descrevem o local da escola, não a residência do aluno. Matrículas não representam pessoas únicas; educação especial e profissional podem se sobrepor às etapas.
- Escolas: em funcionamento (`TP_SITUACAO_FUNCIONAMENTO=1`) e com `QT_MAT_BAS>0`. A infraestrutura abrange somente as públicas (dependências 1, 2 e 3), entre respostas válidas ao item. Numeradores e denominadores acompanham o trecho do território.
- Banda larga: escola que declarou não ter internet conta como não tendo banda larga; uma escola com internet e resposta ausente de banda larga continua sem resposta para este item.
- Biblioteca/sala de leitura: campo combinado oficial; se ausente, combinação dos dois campos com lógica de três valores (um sim basta; dois não são necessários para não).
- Tempo integral: soma das etapas infantil, fundamental e médio. O denominador cobre exatamente as mesmas etapas. Não mistura EJA/profissional no denominador. Se faltar alguma parte, o total agregado e a participação ficam ausentes.
- Percentuais: escala **0–100**, Ideb **0–10**. Nulos nunca viram zero. A opção de último ano opera por indicador. Um ano dentro da cobertura global é respeitado, inclusive para Ideb não divulgado naquele ano. Para um ano ausente de todas as fontes, há aviso explícito e apresentação do ano mais recente, como no painel de Saúde.

## Preparação isolada

```powershell
python pipeline/educacao_baixar.py --saida E:/finbra/educacao_brutos
python pipeline/educacao.py --brutos E:/finbra/educacao_brutos --saida E:/finbra/candidato_educacao_20261115
python pipeline/educacao_downloads.py --base E:/finbra/data --educacao E:/finbra/candidato_educacao_20261115 --saida E:/finbra/candidato_downloads_educacao_20261115 --stata "C:/Program Files/Stata18/StataBE-64.exe" --rscript "C:/Program Files/R/R-4.6.1/bin/Rscript.exe"
```

A coleta usa Range para extrair apenas as tabelas agregadas e o dicionário dos ZIP públicos. Valida CRC e registra URL, membro, tamanho e SHA-256. A origem de download do Inep também oferece HTTP, usado quando seu endpoint HTTPS não aceita a conexão do ambiente. Não há informação privada nem credenciais na coleta.

A candidata não pode sobrepor as pastas de origem. Gold publicado e manifesto global ficam intactos. O painel tem manifesto próprio em `gold/educacao/manifesto.json`, para preservar os pacotes rápidos dos outros painéis.

O catálogo de abertura contém os 43 metadados, os trechos de Brasil/UF e referências aos cadastros municipais por UF. A abertura baixa só o catálogo e o trecho do território; municípios e rankings são carregados sob demanda, sem DuckDB/WASM.

Downloads: 297 indicadores + seis identificadores, mesmos nomes em Stata/R/CSV/Parquet. Há Educação nacional e por UF. As 260 colunas anteriores são comparadas integralmente; os demais recortes temáticos são reutilizados. RDS é produzido e relido no R; Stata verifica chaves e declara `xtset cod_ibge ano`. Os 43 novos indicadores não são preenchidos em 2026, sem fonte final disponível.

## API

```stata
use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/educacao.dta", clear
```

```r
source("https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/cliente.R")
dados <- finbra(uf = "GO", tema = "educacao", anos = 2013:2025)
dicionario <- finbra_dicionario(tema = "educacao")
```

## Validação e publicação

`python pipeline/testes_educacao.py`; `npm run test:educacao`, `npm run test:downloads`, `npm test` e `npm run build` em web; testes da API/Worker e dry-run do deploy. Conferir somas territoriais e os resultados oficiais; comparar arquivos nativos; navegar em 1280/390 px, incluindo referência explícita sem Ideb, UF/município/DF, exportações, inglês/tema escuro e navegação para SIOPE/Saúde.

Publicar objetos imutáveis primeiro, sem limpar o R2; guardar cópia dos manifestos anteriores. Disponibilizar o manifesto novo de educação antes do código que o utiliza. Fazer deploy compatível e trocar o manifesto próprio de downloads por último. Conferir hashes, API, Stata/R e navegação em produção. O manifesto global e outros objetos permanecem iguais. Uma atualização de fonte exige repetir esta preparação e publicação; os pacotes são instantâneos identificados por SHA-256.
