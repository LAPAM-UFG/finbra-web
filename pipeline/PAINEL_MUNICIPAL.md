# Downloads municipais

`/downloads` entrega arquivos já calculados. A abertura lê apenas `gold/downloads/manifesto.json`; dicionário e bases grandes só são baixados quando solicitados. Esse manifesto é independente do global: a geração/publicação não invalida os pacotes rápidos de Saúde e Clima.

A base integrada tem uma linha por `cod_ibge` (texto, sete dígitos) e `ano`. Inclui as seis áreas; as perguntas integrais da MUNIC ficam por edição e as contas DCA por anexo, com a mesma chave. Estado e Brasil não são copiados em municípios. Brasília e Noronha são unidades especiais identificadas. Dados de governo do DF/código53 não são transplantados para Brasília/código5300108.

## Regras

- Vazio não é zero. CadÚnico mantém proteção/ausência; não há reconstrução de células protegidas. MUNIC usa somente a edição observada, sem interpolar. O código da pergunta integral leva a edição para evitar equivalência falsa entre perguntas homônimas.
- Assistência: último registro de cada indicador no ano, inclusive se o último for nulo, acompanhado de mês e condição. Dinheiro tem também `_soma_ano` e `_meses`: soma parcial não vira total completo. Famílias, pessoas, benefícios e programas não são somados como um universo único.
- RAIS: contratos ativos em31/12, não pessoas. Média de dezembro dos perfis usa todos os contratos do grupo no denominador; sem valor positivo continua ausente. Categoria não observada só é zero se a dimensão estiver completamente tabulada ou se o total de contratos for zero.
- Clima usa o anual completo e as normais publicadas, na malha fixa. `anomalia_pct` é fração relativa:0,01=1%. APS mantém AB/APS/ACS e o CNES mantém cobertura por medida.
- DCA conserva valores e sinais do tratamento publicado. `_sintetico` identifica totais reconstruídos por hierarquia; não somar indiscriminadamente contas totais e componentes. Alertas de qualidade ficam no núcleo, sem apagar as declarações.
- Valores nominais e reais são identificados no dicionário; SIOPE por aluno é dinheiro por aluno, e INSS são quantidades de benefícios emitidos em dezembro. Populações de referência podem ter ano próprio, preservado nas respectivas colunas.
- CSV é UTF-8/BOM, `;`, decimal vírgula e proteção contra interpretação de texto como fórmula no Excel. Parquet mantém tipos e textos originais. Arquivos nacionais são grandes: para Excel, preferir UF ou tema; para análises nacionais, usar Parquet com seleção de colunas.

## Geração isolada

Use uma candidata fora da base de origem (a validação ocorre antes de qualquer escrita). Requer a venv do pipeline, dependências web para extrair o catálogo e memória livre para a geração offline. Os detalhes DCA são processados por UF para limitar memória. Os caches são conferidos contra consultas, fontes e hashes.

```powershell
python pipeline/insumos_painel_municipal.py --base E:/finbra/data --saida E:/finbra/candidato_downloads
cd web
npm run catalogo:downloads
node testes/.saida/catalogos_downloads/catalogos_downloads.js E:/finbra/candidato_downloads/trabalho_downloads/inventario_catalogos.json ../pipeline/painel_municipal_catalogos.json
cd ..
python pipeline/painel_municipal.py --base E:/finbra/data --saida E:/finbra/candidato_downloads
python pipeline/finalizar_downloads.py --base E:/finbra/data --raiz E:/finbra/candidato_downloads
python pipeline/validar_painel_municipal.py --base E:/finbra/data --raiz E:/finbra/candidato_downloads --relatorio E:/finbra/candidato_downloads/validacao.json
python pipeline/testes_painel_municipal.py
```

O catálogo reutiliza nomes/fórmulas/coberturas de Saúde, curadoria MUNIC e dicionário de perfis RAIS do cliente. A versão do manifesto é conferida para não mascarar anos novos com um catálogo antigo. Ao atualizar os conceitos do cliente, gere e revise o catálogo novamente.

`--sem-detalhes` é somente de desenvolvimento. Seu manifesto é parcial, recusado pela interface e pela validação de entrega. Para a publicação, sempre completar MUNIC e DCA.

O finalizador calcula os anos efetivamente observados por variável, completa os nomes clínicos/CNAE e pode registrar um dicionário Excel produzido com os mesmos registros (`--excel caminho.xlsx`). Com esse arquivo, prepara também o ZIP completo: núcleo nacional CSV, complementos, dicionário e instruções. O JSON/CSV do dicionário sempre existe. O núcleo não depende do Excel.

## Publicação

Não enviar toda a pasta candidata: ela pode conter saídas antigas e temporárias. Conferir a base e publicar somente os objetos referenciados em `gold/downloads/manifesto.json`, verificando tamanho/hash. Enviar esse manifesto próprio por último. Não alterar nem reescrever `gold/manifesto.json`, dados anteriores, silver ou microdados. Nunca usar `--limpar`.

Validar tipos/build, testes dos helpers, números contra as fontes e navegador390/1280PT/EN/claro/escuro. Conferir CSV/Parquet e dicionário, inclusive proteção, zeros, lacunas, meses parciais, limites do Excel e arquivos porUF/tema. A página deve abrir sem DuckDB e sem baixar dados grandes. O instantâneo tem sua própria data: atualizá-lo exige repetir a geração, não só republicar o código.
