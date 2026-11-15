# Educação — Inep

Painel `/educacao`, desde 2013, com 85 indicadores pré-calculados e oito condições de publicação do Saeb. O SIOPE permanece em `/educacao/financiamento` e `/educacao/profissionais`.

## Fontes e significado

- Censo Escolar: tabelas agregadas por escola, no catálogo público do Inep. Até 2024 a tabela é única; em 2025, versão 2, escola, matrícula, docente e turma são unidas por `CO_ENTIDADE`, com validação um a um. Não se coletam registros pessoais de alunos ou professores.
- Perfil: sexo feminino/masculino e seis categorias de cor/raça, incluindo a categoria não declarada. São matrículas, não pessoas únicas; a categoria não declarada é diferente de uma célula ausente.
- Oito percentuais do perfil: contagem da categoria / todas as matrículas da educação básica × 100, no mesmo ano e território. Cor/raça não declarada continua no denominador e tem seu próprio percentual; não se calcula somente entre declarações válidas. UF/Brasil usam suas contagens somadas, nunca a média dos percentuais municipais. Numerador/denominador ausente ou denominador zero produz ausência; numerador zero com denominador positivo produz zero. A interface alterna Percentuais/Matrículas e os atalhos acompanham a medida selecionada. A apresentação usa duas casas; valores positivos abaixo de 0,01% aparecem como `<0,01%` e valores entre 99,99% e 100% como `>99,99%`. As exportações preservam a precisão numérica.
- Inclusão: matrículas de educação especial em classes comuns e exclusivas. Participação em classes comuns = comuns / (comuns + exclusivas) × 100; denominador zero ou ausente permanece indefinido. Não é taxa de deficiência da população.
- Docentes: soma dos docentes por escola, na educação básica, infantil, fundamental e médio regular. Um professor em duas escolas conta duas vezes; não se apresentam esses totais como pessoas únicas. As etapas podem se sobrepor. Turmas são contagens nas mesmas escolas. Uma resposta ausente invalida o agregado das contagens adicionais; não se publica uma soma parcial.
- Infraestrutura adicional: água potável, ligação à rede de esgoto, energia da rede, coleta de lixo, alimentação escolar PNAE/FNDE, internet para os alunos e rampas. São razões das contagens de escolas públicas com resposta válida, com numerador e denominador no pacote. Não ter internet implica não oferecê-la aos alunos; as demais ausências continuam ausentes.
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
python pipeline/educacao_redes.py --brutos E:/finbra/educacao_brutos --base E:/finbra/data --saida E:/finbra/candidato_educacao_saeb_20261115 --trabalho E:/finbra/trabalho_educacao_saeb_redes_20261115
python pipeline/educacao_downloads.py --base E:/finbra/data --educacao E:/finbra/candidato_educacao_saeb_20261115 --saida E:/finbra/candidato_downloads_educacao_saeb_20261115 --stata "C:/Program Files/Stata18/StataBE-64.exe" --rscript "C:/Program Files/R/R-4.6.1/bin/Rscript.exe"
```

A coleta usa Range para extrair apenas as tabelas agregadas e o dicionário dos ZIP públicos. Valida CRC e registra URL, membro, tamanho e SHA-256. A origem de download do Inep também oferece HTTP, usado quando seu endpoint HTTPS não aceita a conexão do ambiente. Não há informação privada nem credenciais na coleta.

A candidata não pode sobrepor as pastas de origem. Gold publicado e manifesto global ficam intactos. O painel tem manifesto próprio em `gold/educacao/manifesto.json`, para preservar os pacotes rápidos dos outros painéis.

Para acrescentar somente indicadores derivados, pode-se usar `--publicado E:/finbra/data` em `educacao.py`. A opção exige que o manifesto de Educação corresponda ao SHA registrado nos downloads e que a coleta seja idêntica. Confere os hashes do arquivo de séries, trechos e cadastros e reutiliza as contagens, acrescentando as razões. A auditoria independente dos CSVs continua obrigatória. Se as fontes mudaram, reconstruir sem essa opção.

O catálogo de abertura contém os 93 metadados, os trechos de Brasil/UF e referências aos cadastros municipais por UF. A abertura baixa só o catálogo e o trecho do território; municípios e rankings são carregados sob demanda, sem DuckDB/WASM. A busca nacional tem índice próprio compacto `[código,nome,UF]`, carregado somente ao digitar pelo menos dois caracteres. Nome sem acento, código IBGE e termos com UF são aceitos; nomes repetidos aparecem com UF/código e exigem escolha explícita. Selecionar um município infere sua UF. O estado é opcional e sua lista continua disponível.

Downloads: a seleção principal e seus pacotes mantêm exatamente os mesmos arquivos imutáveis, com 297 indicadores + seis identificadores. O arquivo de Educação nacional/por UF tem 85 indicadores + oito condições do Saeb + seis identificadores, incluindo os 43 da seleção principal. Os indicadores já publicados do arquivo de Educação também são comparados integralmente antes da ampliação. Os demais temas são reutilizados. RDS é produzido e relido no R; Stata verifica chaves e declara `xtset cod_ibge ano`. Educação não recebe valores em 2026, sem fonte final disponível.

O dicionário geral contém 353 entradas; `arquivo_principal=true` identifica as 303 colunas da seleção principal e `false` os 50 variáveis adicionais do arquivo de Educação. A busca encontra os adicionais e indica o arquivo. A listagem principal e os dicionários JSON/R sem tema mantêm 303 entradas; com `tema=educacao`, retornam 99 entradas. Os formatos brutos de dicionário (Excel, RDS, CSV) contêm todas as entradas e sua disponibilidade. Os dicionários já incluídos nos pacotes principais continuam descrevendo aqueles arquivos, que não mudaram.

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

Publicar objetos imutáveis primeiro, sem limpar o R2; guardar cópia dos manifestos anteriores. Publicar primeiro o código compatível com o catálogo anterior, aguardar o deploy e então trocar os manifestos próprios de Educação e downloads. Isso evita que clientes antigos interpretem os códigos de condição como indicadores. Conferir hashes, API, Stata/R e navegação em produção. O manifesto global e outros objetos permanecem iguais. Uma atualização de fonte exige repetir esta preparação e publicação; os pacotes são instantâneos identificados por SHA-256.

## Saeb, redes e abertura do SIOPE

O recorte `todas` preserva integralmente os 77 indicadores anteriores: Censo em todas as redes, taxas/Ideb/Saeb públicos, além das medidas explicitamente estaduais. As opções `publica`, `municipal`, `estadual`, `federal` e `privada` são pacotes separados, filtrados na fonte. Escola sem rede selecionada tem contagem zero somente quando o Censo do território foi observado; campo não coletado permanece ausente. Infraestrutura continua sendo de escolas públicas (na rede privada não se inventa resultado).

Português e Matemática: 5º ano, 9º ano e ensino médio, além da medida estadual do médio. Pontos da escala oficial, não percentuais nem Ideb. Cada variável tem uma `_nota` de 0 a 6, com rótulos no Stata/dicionário. As marcas oficiais numéricas `*` (avaliação estadual por extravio) e `**` (participação abaixo de 50% por extravio), ND*, ND e ND*** são preservadas. Nota marcada aparece com explicação e fica separada das séries/comparações regulares. Ano sem edição é explicado, mantendo lacunas reais de divulgação. A edição de 2021 exige atenção ao contexto pandêmico/participação. Fonte: planilhas oficiais do Ideb e notas nelas publicadas; agregados UF/BR são os oficiais.

Cada arquivo conserva a chave município × ano; rede seleciona outro arquivo, sem criar linhas duplicadas. API: `painel/GO/educacao.dta?rede=municipal`. R: `finbra(uf="GO",tema="educacao",rede="municipal")`. Sem `rede`, o contrato anterior é mantido. São 99 colunas no arquivo temático, e a seleção principal mantém 303.

`educacao_financeiro.py --base E:/finbra/data --saida <candidata_financeira>` prepara séries, tabelas e remuneração de dezembro. `educacao_redes.py --financeiro <candidata_financeira>` incorpora o pacote ao manifesto próprio. O cliente compara SIOPE/IPCA/ano-base com o manifesto global; fonte alterada, falta ou corrupção faz voltar às consultas originais, sem mostrar dados antigos silenciosamente. Estados incluem DF neste painel. Soma de profissionais é explicitamente contagem de registros por governo/categoria/situação, sem deduplicação global de pessoas. A IA abre `educacao_inep` só quando consultada; a página normal não inicia WASM.
