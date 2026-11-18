# Raio X territorial

`/raio-x` reúne os indicadores publicados das oito áreas. A busca nacional
distingue municípios, UFs, DF e Brasil, sem exigir uma UF antes do município.
O endereço preserva território, ano, rede de ensino, tema, busca e indicador aberto.

O catálogo tem 1.267 definições e variações: 775 por município e 842 por UF na
rede de ensino padrão. As cinco redes alternativas permanecem selecionáveis.
Contagens do território e valores comparáveis são preservados, sem uma nota
composta de qualidade. Os downloads CSV/Excel contêm todos os resultados dos
filtros, inclusive áreas recolhidas; o dicionário explica unidade, fonte e método.

## Edição e cálculos

`pipeline/raio_x.py --fontes FONTES_FIXADAS --saida CANDIDATO_NOVO` valida
origem/destino e SHA-256 antes de escrever. A proveniência contém `arquivos`,
com chave pública, bytes, SHA-256 e caminho local opcional. São necessários os
catálogos, índices e bundles das comparações e das referências de pagamentos.
As fontes nunca são modificadas. O gerador não publica.

Os retratos copiam os componentes e condições das séries auditadas. MUNIC e
ESTADIC mantêm universos separados: uma UF recebe a resposta de seu próprio
governo e os resultados municipais em indicadores distintos. Finanças da
comparação são municipais; medianas não viram consolidados oficiais. DF e
Brasília não são somados. Valores protegidos não são reconstruídos.

O padrão usa a última observação local de cada indicador, inclusive uma ressalva
recente identificada, sem trocá-la silenciosamente por ano anterior. Valores com
ressalva fiscal/Inep exigem opção explícita para exibição. Um ano escolhido não
usa observações de outro ano. Para estoques mensais, escolhe-se a última
observação dentro do ano; não se somam meses. Ausências permanecem sem valor.

As referências adicionais usam os pagamentos e denominadores da edição
publicada: por habitante, massa RAIS de dezembro × 12 (estimativa, com cobertura
de remuneração) e PIB do mesmo ano. Pagamentos anuais exigem 12 competências.
A população de 2023 usa o Censo 2022, identificado somente nos indicadores que
usam esse denominador. RAIS não representa toda a renda dos moradores.

## Carregamento

`gold/raiox/manifesto.json` aponta para objetos por conteúdo. Catálogo e cadastro
territorial têm gzip com hashes antes e depois da descompressão, limite de
tamanho e alternativas JSON para navegadores sem `DecompressionStream`.
Índices por UF e intervalos HTTP trazem somente o retrato escolhido (até 68 KB
nesta edição). Não se inicia o contexto SQL/DuckDB nessa rota.

Históricos e gráficos são carregados ao abrir um indicador, a partir dos
mesmos objetos imutáveis que originaram o retrato. Referências regionais,
estaduais e nacionais usam a mesma data e unidade; governos estaduais são
comparados no universo ESTADIC. Mudanças da RAIS usam pontilhados; lacunas
reais e anos parciais não são preenchidos. Falhas podem ser repetidas e uma
resposta atrasada de outro recorte não substitui a escolha atual.

## Validação e publicação

Executar `python -m unittest discover -s pipeline -p 'testes_raio_x.py'`,
`npm test`, `npm run build` em `web` e `git diff --check`. A auditoria confronta
retratos e fontes, verifica todas as referências/hashes e a separação ESTADIC.
Conferir computador e celular, ano sem dado, busca nacional, rede, histórico,
condições, download completo e recuperação de falha.

Publicar somente `gold/raiox/*`: objetos imutáveis primeiro e o novo ponteiro
por último. Preservar os manifestos e objetos existentes das outras áreas.
Dados antes do código são compatíveis com o site anterior. Ao atualizar as
fontes, preparar uma nova edição fixada e repetir a auditoria; os históricos
jamais misturam objetos de edições diferentes dentro de um retrato.
