# Atualização das demais bases

O workflow `atualizar-demais-bases.yml` consulta o calendário às 07h de Brasília.
Cada grupo tem um dia do mês; fontes com rotinas semanais/fiscais continuam nos
workflows existentes. Todos compartilham a fila `atualizar-dados`, sem cancelar
uma execução que já começou. A execução manual aceita um grupo ou `todas` (um
job por grupo, em sequência). Por padrão, a execução manual só gera candidatos.

| Dia | Grupo |
| --- | --- |
| 1 | RAIS: estoque, remuneração, setores, perfis e cubos da consulta/IA |
| 2 | IBGE: população e PIB municipal |
| 3 | Previdência: benefícios emitidos em dezembro |
| 4 | SIOPE e bloco financeiro da Educação |
| 6 | SIOPS |
| 7 | SIM, SINASC e população SVS; repercussões em Mobilidade e Segurança |
| 8 | SIH e ICSAP |
| 9 | CNES: estabelecimentos, leitos e profissionais |
| 10 | SIA: produção ambulatorial |
| 11 | SINAN e RESP |
| 12 | SISCAN e Oncologia |
| 13 | APS, preservando a quebra de metodologia |
| 14 | Repasses do FNS |
| 16 | Coberturas oficiais de vacinação |
| 17 | CadÚnico público, BPC/CGU e folha PBF/MDS |
| 18 | Educação: Censo, rendimento, distorção, Ideb e Saeb |
| 19 | SNIS e resultados publicados do SINISA |
| 20 | PAM, PPM e PEVS |
| 21 | Frota Senatran e perfis de espécie/eixos |
| 22 | Sinesp |
| 23 | Anatel: banda larga fixa e telefonia móvel |
| 24 | ANEEL: MMGD, detalhes técnicos e SIGA |
| 25 | Comex Stat |

## Execução

```sh
python pipeline/automacao_catalogo.py --rotinas todas
python pipeline/automatizar_demais_bases.py --rotinas energia --raiz /tmp/finbra-energia --rscript /usr/bin/Rscript
```

Adicionar `--publicar` só depois de conferir os coletores e a edição candidata.
O agendamento passa essa opção automaticamente e mantém as mesmas validações.
Usar uma pasta nova para uma nova consulta. `--caches` pode apontar para snapshots
anteriores, somente como entradas: tamanho e hash são conferidos antes do uso.

## O que fecha uma edição

1. O snapshot fixa ETags do R2. As fontes oficiais são conferidas por catálogo,
   período, tamanho, versão HTTP/FTP, SHA-256 e CRC dos membros de ZIP.
2. Os coletores trabalham em pastas isoladas. Arquivos anuais exigem o conjunto
   completo de UFs/meses aplicável. SIM/SINASC preliminares e anos ainda abertos
   ficam de fora; SINISA usa o ano de referência, não o ano de coleta.
   RAIS e componentes volumosos da Saúde revisitam os dois últimos anos e as
   edições novas. A primeira captura do SIM inclui desde 2013 para os perfis de
   Mobilidade e Segurança. Históricos anteriores são preservados.
   Uma execução isolada de Mobilidade ou Segurança prepara o SIM quando ainda
   não há agregados no cache, inclusive no modo candidato, sem publicação.
   Oncologia lê também o arquivo corrente para captar tratamentos de diagnósticos antigos,
   mantendo só anos de diagnóstico fechados. Outras revisões históricas podem
   ser refeitas com os coletores originais, em outra candidata isolada.
3. A RAIS mantém a remuneração calculada com vínculos de remuneração positiva.
   SIH e ICSAP usam os mesmos registros e são atualizados juntos. Categorias
   sobrepostas, células protegidas e denominadores ausentes permanecem explícitos.
4. A seleção principal continua com 297 variáveis desde 2013. Anos novos podem
   acrescentar linhas sem preencher ausências de outros temas com zero.
5. Regera os formatos CSV, Parquet, Stata e RDS, dicionários, prévias e pacotes.
   Downloads e API usam o mesmo manifesto. RDS é validado no R; Stata é relido
   com igualdade de valores e chaves. `--stata` acrescenta a validação no programa
   nativo, disponível no Windows do laboratório.
6. Regera aberturas, referências sociais, mapas afetados, comparações e Raio X.
   A IA lê os mesmos arquivos e catálogos, sem uma cópia independente dos valores.
   População/PIB repercutem nas referências e temas por habitante; SIM repercute
   em Saúde, Mobilidade e Segurança. As séries históricas recuperadas permanecem
   disponíveis com a cobertura e as ressalvas de cada fonte, sem extrapolação.
7. O validador percorre o grafo completo, confere hashes, geografia, indicadores,
   cobertura e correspondência entre manifestos. Uma perda de dados publicados,
   formato desconhecido ou divergência de total interrompe a rodada.
8. Só então prepara os objetos e ativa os manifestos; o global é o último.
   Substituições usam a condição de ETag, backup e reversão em caso de falha.

## Cache e falhas

`pipeline/automacao/` guarda insumos permitidos por SHA-256 e estados com versão
condicional. A rota pública `/dados/` só atende `gold/` e `silver/`. Não armazena
nesse cache os arquivos individuais do BPC, nomes/CPF do CNES ou microdados de
saúde; essas entradas são efêmeras. O estado só é confirmado depois da ativação
dos dados. Uma interrupção força nova conferência, sem pular uma edição.

O navegador continua usando arquivos previamente calculados, índices por
território, leitura por trecho e mapas carregados sob demanda. Nenhum coletor
roda durante a abertura de uma página.

O artefato de cada Action contém `resultado.json`, snapshot, auditorias, plano e
backups das substituições. Uma falha mantém a edição publicada e sinaliza erro
na Action; não registra como atualizada uma fonte que não foi conferida.

## Verificações

```sh
python -m unittest discover -s pipeline -p 'testes_atualizacao*.py'
python -m unittest discover -s pipeline -p 'testes_automacao*.py'
python -m compileall -q pipeline
npm run build --prefix web
```
