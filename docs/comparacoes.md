# Comparações territoriais e temporais

As oito áreas têm uma página `/comparar` (Finanças usa `/comparar`; Saúde,
`/datasus/comparar`; Gestão, `/munic/comparar`). Assistência, Educação, Trabalho e
Saneamento também usam essa camada em seus rankings principais. As consultas
originais, exportações e análises especializadas continuam disponíveis.
Nas análises avançadas da RAIS, contagens e variações absolutas mostram apenas
o próprio recorte. Referências territoriais usam médias, proporções, crescimento
percentual ou índices. O perfil da ocupação mantém contagens no download como
contexto e exclui a referência Brasil quando faltam os filtros avançados usados.

## Unidades e universos

* Contagens: por 1.000 habitantes, com população anual do IBGE e ano da base
  explícito. Em 2023, usa-se o Censo 2022. Famílias por 1.000 pessoas **não** é
  percentual de famílias atendidas. Local de trabalho/escola difere de residência.
* Razões: soma de numeradores ÷ soma de denominadores dos mesmos municípios e
  período; nunca média simples de taxas. Ausências e denominadores zero não
  viram valores observados. A cobertura pode mudar no tempo.
* RAIS: remuneração ponderada pelos vínculos, preservando no denominador os
  vínculos sem remuneração válida quando o componente é conhecido. Grupo sem
  qualquer remuneração válida continua sem valor. Mudanças de 2022/2023 sinalizadas.
  Essas quebras não são aplicadas ao CAGED. Anos parciais não produzem variação
  contra anos completos e interrompem a linha do gráfico, mantendo o ponto e a tabela.
* Sem componentes publicados para agregação (alguns resultados do Inep e médias):
  **mediana municipal**, identificada como referência descritiva; não é índice,
  proficiência ou totalizador oficial da UF/Brasil. Ressalvas do Inep e fiscais
  ficam fora da referência padrão e são incluídas somente por opção explícita.
* Valores monetários: preços de dezembro de 2025 (IPCA), sem projetar índices
  ausentes. Totais originais e suas unidades permanecem nos arquivos da fonte.
* Clima: anos completos e ponderação pela área municipal. Anomalias relativas
  usam razão de somas ponderadas; meses e acumulados parciais ficam na página
  detalhada. Não se divide temperatura, chuva ou remuneração pela população.
* MUNIC: pessoal por 1.000 habitantes. Respostas binárias individuais são Sim/Não;
  nas referências, percentual entre respostas efetivas. Não há nota composta de
  gestão nem ranking dessas respostas. ESTADIC mantém governos estaduais em
  universo próprio; seus quadros não são distribuídos por regiões municipais.
* Saúde: denominadores próprios de cada indicador. APS até 2020 e desde 2021 são
  séries separadas. PNI mantém métodos por dose/por indivíduo e imunobiológicos
  separados, usa nascidos vivos SINASC e preserva valores acima de 100% e dados
  preliminares. Referências regionais derivam dos componentes municipais, sem se
  apresentar como totalizadores oficiais. FNS usa destinatários municipais e
  distritais comprovados e a população anual SVS/MS; fundos estaduais ficam fora.
* Assistência: os perfis do CadÚnico têm somente o retrato 10/2026 nesta edição;
  não se inventou histórico. PBF e BPC mantêm suas séries e transições de programa.
  A razão municipal de pessoas por família pode ser publicada mesmo com uma
  contagem protegida. Ela é preservada sem reconstruir a contagem; referências
  agregadas exigem ambos os componentes e excluem esses casos.

Regiões imediatas/intermediárias: associação atual da API oficial do IBGE, divisão
de 2017, aplicada à série. Não se reconstruíram limites históricos. Rankings de
municípios, estados e regiões usam medidas relativas/intensivas, empates e base
mínima explícitos. A posição não é uma classificação de qualidade.

## Dados prontos e publicação

`comparacoes_fontes.py` fixa manifestos, objetos por conteúdo, população e IPCA
oficiais. Os Parquet antigos sem nome por conteúdo são conferidos por HEAD/ETag.
O catálogo original dos indicadores de Saúde é exportado por
`web/scripts/catalogo_mapas.ts`, com o manifesto fixado da revisão.

`comparacoes.py --revisao REVISAO --saida CANDIDATO` gera exclusivamente um
candidato novo. `--areas` permite preparar áreas isoladas. `unir_comparacoes.py`
compõe candidatos já preparados em outro diretório novo, exigindo fontes e
geografia idênticas. Nenhum desses comandos publica ou altera a origem.

`auditar_comparacoes.py --base CANDIDATO --revisao REVISAO` confere todos os hashes,
índices, células, listas e referências. Recalcula a agregação sem usar o agregador
da geração e coteja todos os brutos dos quatro mapas publicados. Testes de regras:
`python pipeline/testes_comparacoes.py` e `cd web; npm run test:comparacoes`.

Os objetos ficam em `gold/comparacoes/`, com nomes por conteúdo. Só o manifesto
desse prefixo é um ponteiro mutável e deve ser enviado **por último**, depois da
validação. Não é necessário alterar manifestos antigos ou sincronizar/limpar o
gold. A publicação deve verificar que todo objeto anterior permaneceu idêntico.

No navegador, um índice pequeno localiza a série do território ou a lista de um
indicador/período. Cada leitura Range exige HTTP 206, tamanho, Content-Range e
SHA-256 corretos. O motor SQL e os microdados não são iniciados nessas páginas.
Fonte atualizada exige preparar uma nova edição; caches nunca misturam catálogos.
