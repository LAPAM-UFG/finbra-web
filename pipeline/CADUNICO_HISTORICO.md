O histórico recuperado é um conjunto separado, acessível em Assistência social →
Comparações → Conjunto de dados → CadÚnico: histórico parcial. Não substitui nem
emenda o retrato público de outubro de 2026. Cobertura: 645 municípios de São
Paulo, suas regiões IBGE e estado, de janeiro de 2018 a agosto de 2026. Para Brasil,
somente famílias. Outros municípios e perfis continuam sem histórico recuperado.

Origem: distribuições públicas CSV e dicionários da Fundação Seade, com dados do
MDS/Sagicad. `cadunico_historico.py baixar --saida PASTA_NOVA` preserva os arquivos
e registra URL, data, bytes e SHA-256. Não usa microdados pessoais nem reconstrói
contagens protegidas a partir de razões ou datas de inclusão.

Há duas inconsistências na distribuição adquirida em 17/11/2026. A coluna
`BR_CAD_F` exclui SP até abril de 2021 e já inclui SP desde maio de 2021, embora
o dicionário a descreva como Brasil sem SP em toda a série. A transformação soma
SP somente no primeiro período, cotejada com 99 meses da tabela oficial do MDS e
com o total CECAD de agosto de 2026. As referências e sua procedência estão em
`referencias/cadunico_brasil_cotejo_20261117.json`; a tabela oficial foi consultada
pelo índice público de busca, pois o acesso direto redirecionava à manutenção.
Além disso, abril de 2025 não existe na série original do MDS e repete os valores
de maio no CSV Seade. Esse mês permanece ausente nos três indicadores e arquivos.
Os arquivos originais são preservados. Uma nova edição exige nova revisão.

`gerar --fontes PASTA_ADQUIRIDA --revisao PASTA_REFERENCIAS --saida CANDIDATO_NOVO`
usa a mesma população IBGE e geografia fixadas nas comparações, incluindo Censo
2022 como base explicitada em 2023. Requer os cinco arquivos de referência usados
por `comparacoes.py`. Destinos sobrepostos são recusados antes de qualquer escrita.

Comparações e rankings usam famílias/pessoas por mil habitantes ou pessoas por
família. As referências de região/estado são razões das somas com cobertura
explícita. Brasil usa seu total nacional publicado e população nacional, nunca a
soma paulista como substituto do país; condição 22 distingue esse caso e não
inventa uma cobertura municipal. Estoques mensais não são somados no tempo.

As séries são servidas por intervalos HTTP com verificação de tamanho e SHA-256.
Não iniciam o DuckDB nem carregam os arquivos completos. CSV, Parquet e Stata 118,
com contagens mensais e dicionário JSON, são baixados apenas quando solicitados.
O catálogo novo deve ser acrescentado ao manifesto de comparações preservando
todos os catálogos, origens e descritores de compatibilidade já publicados. A
geração não faz upload; arquivos imutáveis precedem a troca condicional do ponteiro.

Validações: `python -m unittest discover -s pipeline -p testes_cadunico_historico.py`
e, em `web`, `npm run test:cadunico-historico` (incluído em `npm test`).
