O comparador usa os pagamentos anuais já publicados, com três referências:

- Por habitante: pagamentos / população residente de referência do IBGE.
- RAIS: 100 × pagamentos / (12 × massa nominal de dezembro). É uma estimativa,
  sem 13º imputado, informalidade ou trabalho autônomo sem vínculo. Usa o local
  do estabelecimento. Remuneração não informada não é imputada: acompanham
  vínculos ativos, vínculos com remuneração e percentual de cobertura. As
  mudanças do eSocial em 2022/2023 continuam explicitadas.
- PIB: 100 × pagamentos / PIB nominal do mesmo ano. Preserva valores, posições
  e arquivos da comparação anterior; não é medida de impacto causal.

Os pagamentos exigem 12 competências válidas distintas e não são estimados. O
total exige os dois programas completos. Zero observado permanece zero; ausência,
ano parcial e denominador zero ficam sem valor. Valores acima de 100% são
possíveis: a RAIS cobre somente os salários formais observados. A série PBF/
Auxílio Brasil não inclui o Benefício Extraordinário (2021–2023). BPC inclui os
retroativos já contidos no total original. Valores monetários são nominais.

A população usa o mesmo ano, exceto 2023: não houve estimativa publicada nessa
edição, e usa-se o Censo 2022, com o ano da base visível. UF/Brasil usam somas de
componentes; não médias de razões, com DF contado uma vez. Municípios ainda não
existentes podem ficar sem denominador. A entrega mantém todos os anos desde
2013 e abre no último ano com comparação completa: população/RAIS 2025, PIB 2023.

`assistencia_referencias.py --fontes FONTES_FIXADAS --saida CANDIDATO_NOVO`
exige a proveniência com hashes, os arquivos publicados e as bases demográficas.
Valida origem e destino antes de escrever. Gera séries por município/UF/Brasil,
rankings prontos por programa/referência/ano/UF, CSV, Parquet, Stata 118 UTF-8 e
dicionário conciso. Preserva os primeiros seis campos de cada série anterior.

O novo ponteiro é `gold/assistencia/referencias_manifesto.json`. Os arquivos
imutáveis usam `economia_referencias_*`. A publicação não precisa alterar o
manifesto global, os catálogos de downloads existentes nem a comparação PIB.
Os downloads próprios contêm as novas variáveis; os arquivos da API temática
anterior permanecem com a seleção publicada. CSV e DTA também podem ser lidos
diretamente por R e Stata usando seus endereços HTTP.

O cliente carrega pequenos intervalos HTTP com SHA-256 e rejeita respostas que
enviem o bundle inteiro. A troca de referência nos cartões reutiliza a mesma
série. O mapa só baixa código e malha quando escolhido; os limites de cor são
fixos dentro de cada referência, com unidades próprias. O endereço antigo
`/assistencia/rankings-pib` mantém PIB como padrão; a navegação usa
`/assistencia/comparacoes-pagamentos`, com população como padrão.

Validação: `python -m unittest discover -s pipeline -p 'testes_assistencia_*.py'`,
`npm test` e `npm run build` em web. A auditoria do candidato confere componentes
diretamente com as fontes, todos os grupos e rankings, e igualdade dos formatos.
