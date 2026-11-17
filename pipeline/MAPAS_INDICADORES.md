# Mapas de Saúde e Educação

Rotas: `/datasus/mapa` e `/educacao/mapa`. Indicador, ano, UF, município,
visualização e rede de ensino acompanham o endereço. Os atalhos dos cartões
abrem o mapa com o mesmo indicador e referência. A tabela usa ordem alfabética,
inclui ausências e oferece CSV/Excel de todos os municípios encontrados.

## Fontes e definições

Os 48 indicadores do catálogo da visão geral de Saúde reutilizam as definições
de `saude_comum.ts`: numerador, denominador, fator, cobertura por medida,
fonte, unidade e ressalvas. Os valores vêm da edição publicada do pacote de
abertura de Saúde. A exportação do catálogo usa o TypeScript original; a
auditoria aplica `calcular()` do site a cada célula. O detalhe preserva
numerador/denominador, zero registrado, ausência de registro, denominador
ausente ou zero, preliminares e o aviso de bases pequenas. Profissionais do
CNES começam em 2007; leitos e estabelecimentos podem ter dados em 2006.

- [DATASUS — informações de Saúde](https://datasus.saude.gov.br/informacoes-de-saude-tabnet/).
- [Inep — indicadores educacionais](https://www.gov.br/inep/pt-br/acesso-a-informacao/dados-abertos/indicadores-educacionais).
- [Inep — resultados do Ideb e planilhas do Saeb](https://www.gov.br/inep/pt-br/areas-de-atuacao/pesquisas-estatisticas-e-indicadores/ideb/resultados).

Educação usa os valores prontos da edição publicada: 85 indicadores numéricos,
nas seis redes já disponíveis (todas, pública, municipal, estadual, federal e
privada). Os oito campos auxiliares de condição do Saeb permanecem associados
às proficiências. Marcadores 1/2 são identificados no detalhe, tabela e arquivos;
suas cores só aparecem se a pessoa marcar a opção de incluir as ressalvas.
Anos sem edição, valores não divulgados e valores ausentes ficam sem número.
As descrições originais informam a unidade, etapa e rede abrangidas por medida.

As cores representam intervalos numéricos, constantes para o mesmo indicador
entre anos, UFs e redes. Percentuais usam faixas fixas; índices e proficiências
mantêm suas unidades. Para contagens e taxas, as faixas seguem a ordem de
grandeza dos valores disponíveis. O detalhe e os arquivos conservam a precisão
original; a apresentação arredonda somente o texto e protege os extremos dos
percentuais para não transformar valores próximos dos limites em 0% ou 100%.

## Territórios

Reutiliza a [malha IBGE 2025](https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html)
da publicação do mapa de assistência: 5.571 territórios, incluindo Brasília/DF
uma vez e Fernando de Noronha/PE. Limites simplificados de 2025 em todos os
anos, sem reconstrução de fronteiras históricas. Associação por código IBGE.
O cadastro cartográfico inclui territórios sem grupo na fonte de Saúde; nesses
casos o mapa preserva a ausência. Na edição inicial, Fernando de Noronha não
tem grupo nem linhas no Parquet de Saúde conferido.

## Carregamento

`gold/mapas/saude_manifesto.json` e `educacao_manifesto.json` anunciam índices
por indicador e um cadastro compartilhado. As redes adicionais têm catálogos
imutáveis. Cada índice aponta offsets UTF-8 e SHA-256 de um pacote NDJSON.
Um ano/UF é uma linha; Brasil é a concatenação das 27 UFs, sem duplicação de
registros e sem calcular médias entre municípios. O cliente pede somente esse
Range e verifica HTTP 206, Content-Range, bytes, SHA, contexto e cobertura.

Na edição inicial, o trecho de matrículas totais do Brasil/2025 ocupa 43.967
bytes. A história completa permanece no armazenamento; não é baixada na
abertura. Malha e biblioteca do mapa carregam em paralelo aos números. A
abertura direta da tabela dispensa a malha e o renderizador. As rotas dos mapas
dispensam o contexto SQL; Saúde recebe uma exceção restrita a `/datasus/mapa`.

O cliente também confere a edição de origem: snapshot de abertura da Saúde e
hash do manifesto de Educação. Se as fontes mudarem antes de preparar novos
mapas, informa a necessidade de atualização, sem misturar edições.

## Reprodução e validação

Prepare uma pasta de revisão com `global_base.json` e `educacao_base.json`
baixados da produção. Na pasta `web`:

```powershell
npx vite build --ssr scripts/catalogo_mapas.ts --outDir testes/.saida/catalogo_mapas --emptyOutDir
node testes/.saida/catalogo_mapas/catalogo_mapas.js C:/revisao/global_base.json C:/revisao/saude_catalogo_origem.json
```

Na raiz, gere para uma pasta nova, separada da origem:

```powershell
python pipeline/mapas_indicadores.py --base E:/finbra/data --revisao C:/revisao --saida E:/finbra/candidato_mapas_novo
```

Requer NumPy/requests. O gerador confere hashes das fontes; faltantes são
baixados da URL publicada para `revisao/fontes`, preservando a origem. Recusa
destino sobreposto ou uma edição candidata já preenchida.

Em `web`, compile `scripts/auditar_mapas.ts` como SSR e execute passando pasta
de revisão, base e candidato. A edição inicial conferiu 38.478.897 células,
incluindo 8.459.700 zeros, 186.489 recortes UF/ano/indicador e os marcadores
originais do Inep. Rode `npm test`, `npm run build` e `git diff --check`;
valide também busca, filtros, zoom, retorno, exportações, temas, idioma e
larguras de 1280 e 390 px. `npm run test:mapas` cobre o protocolo e a semântica
de apresentação, com falhas, repetição e proteção contra dados de outro recorte.

## Publicação e atualizações

O candidato inicial tem 573 arquivos (aproximadamente 438,5 MB), todos sob
`gold/mapas/`. Publique somente os objetos referenciados pelos dois catálogos,
com verificação de conteúdo e os dois ponteiros por último. Preserve todos os
objetos e manifestos anteriores, inclusive geografia, downloads e API. Não use
sincronização com exclusão. Novas edições de Saúde/Educação devem preparar os
mapas correspondentes antes da atualização final dos seus ponteiros.

## Mercado de Trabalho e Saneamento

Rotas adicionais: `/trabalho/mapa` e `/saneamento/mapa`, com atalhos nos
cartões e nos menus. Reutilizam o cadastro, a cartografia, a busca, o mapa,
a tabela e as exportações. A exceção ao contexto SQL se restringe também a
`/trabalho/mapa`; as outras rotas de Trabalho continuam com seu contexto.

Trabalho oferece 166 escolhas: 28 indicadores gerais de RAIS/CAGED e
contagem, participação e remuneração nominal de dezembro nas categorias de
raça/cor, escolaridade, agrupamento MTE e vínculo detalhado. Inclui categorias
não informadas e códigos observados fora do dicionário. Usa os pacotes de
abertura publicados e os helpers originais `calcularRais`, `somarCagedAno`,
`lerPerfil` e `distribuicao`. Perfis fecham em cada total municipal da RAIS;
remuneração divide a massa por todos os vínculos ativos da categoria. Categoria
com zero vínculos e categoria sem remuneração válida continuam sem média.

RAIS cobre 2010–2025; o mapa anual do Novo CAGED cobre 2020–2026, com oito
meses em 2026 nesta edição. Cada indicador tem seu próprio último ano.
Valores negativos de variação/saldo usam faixas roxas, positivas usam azuis,
zero e ausência têm cores próprias. A variação em 2022/2023 sinaliza a quebra
de série; as notas técnicas estão nos links da fonte. O mapa usa números
municipais gerais; os filtros da consulta personalizada têm página própria.

Saneamento inclui os 56 indicadores da edição publicada (2013–2024), com
referência SNIS até 2022 e SINISA desde 2023. A drenagem não interpola 2016.
O detalhe e os arquivos preservam os componentes; o CSV/Excel conserva também
o código original da condição e seu dicionário: 0 observado, 1 sem registro,
2 denominador ausente, 3 denominador zero, 4 inconsistência na origem,
5 fora da cobertura e 6 sem resposta ao módulo. Nenhuma ausência vira zero.

- [MTE — RAIS](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/rais).
- [MTE — Novo CAGED](https://www.gov.br/trabalho-e-emprego/pt-br/assuntos/estatisticas-trabalho/novo-caged).
- [Ministério das Cidades — SNIS](https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/snis).
- [Ministério das Cidades — SINISA](https://www.gov.br/cidades/pt-br/acesso-a-informacao/acoes-e-programas/saneamento/sinisa).

Para preparar uma revisão nova, na raiz:

```powershell
python pipeline/mapas_trabalho_fontes.py --revisao C:/revisao/mapas_novos --bases E:/finbra/data
```

Esse comando grava os snapshots dos quatro manifestos, confere os hashes e
reutiliza arquivos locais idênticos. Somente fontes faltantes são baixadas
para `revisao/fontes`. Recusa reusar um snapshot cujo manifesto mudou. Na
pasta `web`, compile `scripts/preparar_mapas_trabalho.ts` como SSR e execute
com a pasta de revisão. O extrator aplica os helpers originais e escreve os
intermediários, o catálogo e o relatório de conciliação; exige intermediários
novos para evitar mistura de execuções. Depois, na raiz:

```powershell
python pipeline/mapas_trabalho_saneamento.py --revisao C:/revisao/mapas_novos --saida E:/finbra/candidato_mapas_novos
```

O gerador recusa destino sobreposto às fontes/revisão e candidato preenchido.
Compile e execute `scripts/auditar_mapas_trabalho.ts` com a pasta de revisão
e o candidato. Para Saneamento:

```powershell
python pipeline/auditar_mapas_saneamento.py --revisao C:/revisao/mapas_novos --candidato E:/finbra/candidato_mapas_novos
```

A auditoria inicial conferiu 14.635.017 valores de Trabalho com os helpers
originais e o leitor real do site, e 3.270.177 valores de Saneamento com o
NDJSON original, incluindo componentes, condições, 70.737 valores negativos
e todos os offsets e hashes. Os novos testes cobrem cores negativas, ano
parcial, quebras de série, remuneração ausente, condição original e recusa de
abertura desatualizada. Rode também a suíte completa, build e navegador.

O candidato contém 227 arquivos (488,6 MB) sob `gold/mapas/`, incluindo o
cadastro idêntico já publicado. Envie somente referências dos novos catálogos
e seus dois manifestos por último. Preserve Saúde, Educação, geografia,
downloads, APIs e os demais objetos. O histórico inteiro fica no R2: o
cliente pede apenas indicador/ano/UF, ou a concatenação das 27 UFs. Abertura
direta de tabela dispensa malha e renderizador. O catálogo de Trabalho
confere a impressão digital do bloco de abertura e sua compatibilidade com
RAIS/CAGED/perfis/IPCA atuais; Saneamento confere o hash do manifesto temático.
