O histórico recuperado é um conjunto separado, acessível em Assistência social →
Comparações → Conjunto de dados → CadÚnico: históricos oficiais. Não substitui nem
emenda o retrato público de outubro de 2026. Cobertura mensal: 645 municípios de
São Paulo, de janeiro de 2018 a agosto de 2026; para Brasil, somente famílias.
Cobertura anual adicional: 144 municípios do Pará (famílias, 2013–2024) e 853 de
Minas Gerais (percentual de pessoas, 2014–2024). Total: 1.642 municípios, com
indicadores, períodos e conceitos próprios. Os demais estados e os perfis do
retrato atual continuam sem histórico recuperado.

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

Fontes anuais alternativas: anuários da Fapespa 2018, 2020 e 2024 (SAGI/MDS),
e IMRS da Fundação João Pinheiro (MDS/SAGI). `cadunico_estaduais.py --saida
PASTA_NOVA` adquire apenas as distribuições públicas, registra URLs, método da
consulta, tamanho e hashes; usa TLS verificado. Não utiliza os cadastros ou
microdados pessoais, nem APIs de administração. Para incluir estas fontes,
acrescente `--estaduais PASTA_ADQUIRIDA_ESTADUAIS` ao comando `gerar`.

No Pará, edições sobrepostas precisam ter valores idênticos, e a soma dos
municípios deve conferir com o total estadual publicado. Duas grafias antigas
(Santa Isabel do Pará e Eldorado dos Carajás) têm correspondência explícita com
os códigos IBGE atuais; hífens e acentos são normalizados. Mojuí dos Campos em
2013 traz traço na origem e permanece ausente. Não se preenche esse valor com
zero. O mês das observações até 2023 não é informado pela Fapespa; 2024 refere-se
a julho, conforme a nota original. São estoques anuais observados, nunca somas
de meses, médias anuais ou observações de dezembro presumidas. As referências
regionais usam famílias / população IBGE dos mesmos municípios com dados.

Em MG, publica-se o percentual original `AS_POPCADUNICO` (ID 90), da distribuição
pública de consultas do IMRS. A fórmula usa a população total estimada como
denominador. Preserva-se o conceito publicado no IMRS. Não se recuperam contagens de pessoas ou
famílias a partir de percentuais arredondados. A distribuição não informa o mês
da observação anual nem os componentes exatos. Por isso, as referências de
região e MG são **medianas municipais**, identificadas na interface e exportação;
não são percentuais agregados oficiais. Percentuais publicados acima de 100%
não são truncados. Nenhuma destas séries estaduais vira referência Brasil.

As séries são servidas por intervalos HTTP com verificação de tamanho e SHA-256.
Não iniciam o DuckDB nem carregam os arquivos completos. CSV, Parquet e Stata 118,
com observações mensais/anuais e dicionário JSON, são baixados apenas quando
solicitados. O campo `frequencia` distingue as fontes; `mes` fica ausente quando
a fonte não o informou. `percentual_pessoas_fjp` preserva o percentual publicado,
separado das contagens. CSV/Parquet/Stata mantêm ausências e zeros distintos.
O catálogo histórico deve ser substituído no manifesto de comparações preservando
todos os outros catálogos, origens e descritores de compatibilidade publicados. A
geração não faz upload; arquivos imutáveis precedem a troca condicional do ponteiro.

Validações: `python -m unittest discover -s pipeline -p 'testes_cadunico_*.py'`
e, em `web`, `npm run test:cadunico-historico` (incluído em `npm test`).
