# Saneamento municipal desde 2013

O catálogo `saneamento_fontes.json` fixa os arquivos oficiais do Ministério das
Cidades por URL e SHA-256: SNIS 2013–2022 e SINISA 2023–2024. O ano é a referência
da informação, não o nome da edição. Drenagem começa em 2015 e não tem 2016.

Execute em pastas candidatas separadas. Nunca aponte a saída para `data`, a
origem ou uma pasta que as contenha. Requer pandas, pyarrow, DuckDB, requests,
python-calamine e 7-Zip para os arquivos RAR oficiais.

```powershell
python pipeline/saneamento_baixar.py --saida E:/finbra/fontes_saneamento --extrair E:/finbra/planilhas_saneamento
python pipeline/saneamento_ler.py --planilhas E:/finbra/planilhas_saneamento --cadastro E:/finbra/data/silver/entes.parquet --saida E:/finbra/normalizado_saneamento
python pipeline/saneamento.py --normalizado E:/finbra/normalizado_saneamento --cadastro E:/finbra/data/silver/entes.parquet --saida E:/finbra/candidato_saneamento
python pipeline/testes_saneamento.py
```

As planilhas são lidas como dados, sem executar macros. Arquivos e membros
compactados são identificados por hash. Totais de prestadores regionais sem
identificação municipal são descartados. No SINISA de água/esgoto, usa-se a
Base Municipal; não se concatena a cópia de prestadores locais e regionais.
As retificações oficiais de esgoto de 2023 são aplicadas explicitamente.

As 28 definições estão em `saneamento_indicadores.py`. Não se preenchem nulos
com zero. A população residente repetida entre prestadores é considerada uma
única vez. As fórmulas físicas exigem componentes dos mesmos prestadores;
dados incompletos não podem formar uma razão artificial. Percentuais de UF e
Brasil são razões das somas dos mesmos municípios válidos. O número de
municípios com valor acompanha cada indicador; o cadastro é atual e não deve
ser confundido com o universo histórico da pesquisa.

Os códigos de condição distinguem valor observado, ausência, denominador
ausente, denominador zero, inconsistência e período sem pesquisa. Percentuais
contraditórios com o índice oficial além de 0,1 ponto percentual recebem a
condição de inconsistência; componentes permanecem no Parquet detalhado.
O gráfico separa SNIS e SINISA, inclusive pela alteração da fórmula de perdas.

O candidato contém `gold/saneamento/manifesto.json`, objetos imutáveis, um
Parquet detalhado, um municipal largo e pacotes territoriais lidos com Range.
A abertura automática não usa DuckDB nem baixa o Parquet nacional. Rankings
são carregados por indicador/ano. A IA abre `saneamento_indicadores` apenas
quando a consulta cita a tabela.

## Downloads e API

`saneamento_downloads.py` recebe um snapshot íntegro do catálogo publicado,
seus catálogos de UF, dicionário e Parquet principal. Gera o tema separado com
28 medidas, 28 condições e seis identificadores, Brasil e 27 UFs. Preserva as
referências imutáveis da seleção principal de 297 indicadores e dos demais
temas; não é necessário copiar esses objetos para o novo candidato.

```powershell
python pipeline/saneamento_downloads.py --base E:/finbra/snapshot_downloads --painel E:/finbra/candidato_saneamento --saida E:/finbra/candidato_downloads_saneamento --stata "C:/Program Files/Stata18/StataBE-64.exe" --rscript "C:/Program Files/R/R-4.6.1/bin/Rscript.exe"
```

Para gerar e conferir os arquivos nativos, requer Stata instalado e R com
arrow e jsonlite. O consumidor do RDS usa apenas R base. As chaves e `xtset`
são conferidas no Stata; todos os valores retornados de Stata e R são
comparados com o Parquet. Os novos catálogos e arquivos são validados antes
de se publicar seus ponteiros.

API existente, sem autenticação:

```text
/api/dados/v1/catalogo.json?tema=saneamento&uf=GO
/api/dados/v1/painel.dta?tema=saneamento&uf=GO
/api/dados/v1/painel.rds?tema=saneamento&uf=GO
/api/dados/v1/dicionario.json?tema=saneamento
```

No R, carregue `/api/dados/v1/cliente.R` e use
`finbra(tema="saneamento", municipio=5208707, anos=2024)`.
No Stata, use a URL completa do endpoint `.dta` com `use "URL", clear`.

Na publicação, envie somente os objetos referenciados dos candidatos,
conferindo hashes e tamanho. Guarde o manifesto anterior dos downloads;
publique os manifestos por último. Não use exclusão/sincronização destrutiva.
O manifesto global e os outros dados não são alterados por este lote.
