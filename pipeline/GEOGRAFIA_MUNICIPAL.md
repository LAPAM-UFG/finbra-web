# Malha leve para o mapa de assistência / PIB

O mapa em `/assistencia/rankings-pib?vista=mapa` usa os mesmos pagamentos,
PIB, percentuais e posições já publicados pelo ranking anual. Não faz consultas
de microdados nem inicia DuckDB/WebAssembly. Programa, ano, estado e busca
continuam no endereço; a escolha do município também, pelo código IBGE.

A visualização e a malha só são carregadas ao escolher **Mapa**, em paralelo
ao carregamento dos percentuais, sem esperar que o ranking termine. Brasil e as
27 UFs têm arquivos separados. O cliente valida tamanho, SHA-256, quantidade,
códigos únicos e UF, mantém uma cópia por sessão e permite repetir falhas de rede.
A busca inclui municípios sem percentual; a lista do ranking mantém sua regra
de mostrar somente percentuais válidos. A busca no mapa localiza o território
sem retirar as cores dos demais. CSV/Excel continuam exportando o ranking
filtrado completo, com o mesmo cálculo e cobertura. Downloads gerais e API
para R/Stata permanecem nas bases anuais já publicadas.

## Fonte e significado territorial

- [IBGE — Malha Municipal Digital 2025](https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html).
- [SHP original](https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2025/Brasil/BR_Municipios_2025.zip),
  237.062.431 bytes, SHA-256 `840bbe6f73726ef9d1460ce49fdfe01a278935c41180d3c893e25ca21db083bd`.
- [Notas metodológicas 01/2026](https://biblioteca.ibge.gov.br/visualizacao/livros/liv102268.pdf),
  lidas para esta edição. Malha de finalidade estatística, com limites
  aproximados. O produto mostrado passou por generalização cartográfica.
- SIRGAS 2000, coordenadas geográficas (EPSG:4674). A malha é a de **2025 em
  todos os anos**, sem reconstrução de limites históricos nem redistribuição de
  pagamentos/PIB. Não deve ser utilizada para demarcações ou cálculos de área.
- 5.571 territórios: 5.569 municípios, Brasília/DF e Fernando de Noronha/PE.
  Boa Esperança do Norte/MT tem geometria, mas não recebe percentual nos anos
  sem dados. As áreas operacionais Lagoa Mirim (`4300001`) e Lagoa dos Patos
  (`4300002`) não são municípios e são excluídas explicitamente.

A escala é fixa: zero, mais de zero a menos de 2%, 2–<5%, 5–<10%, 10–<20%,
20% ou mais. Cinza significa percentual ausente, nunca zero. As classes usam o
valor completo, antes de arredondar. Cores não representam qualidade nem
impacto causal. Cada detalhe informa pagamentos nominais dos 12 meses, PIB
nominal do mesmo ano e posição no recorte completo. Continuam válidas todas
as ressalvas da série Bolsa Família/Auxílio Brasil e dos retroativos do BPC.

## Reprodução

Instale mapshaper 0.6.113 em uma pasta de ferramentas e use um destino candidato
novo, separado de qualquer gold existente:

```powershell
npm install --prefix C:/ferramentas/malha --save-exact mapshaper@0.6.113
python pipeline/geografia_municipal.py --arquivo-zip E:/fontes/BR_Municipios_2025.zip --mapshaper C:/ferramentas/malha/node_modules/mapshaper/bin/mapshaper --saida E:/finbra/candidato_malha_novo
```

O gerador valida edição/hash da fonte e versão da ferramenta. Usa simplificação
topológica `resolution=1800 keep-shapes`, limpeza e TopoJSON com quantização
100.000. Preserva geocódigos e polígonos pequenos. Produz 28 objetos com nomes
derivados do conteúdo e `gold/geografia/manifesto.json`. Brasil: 1.694.095 bytes
(533.248 com gzip); Goiás: 89.746 bytes (29.404 com gzip). O arquivo por UF
evita baixar e desenhar o país inteiro ao comparar apenas um estado.

## Validação e publicação

`npm test` inclui os testes do mapa. `npm run test:assistencia-mapa` cobre
zero/ausência, limites sem arredondamento, busca, cobertura/UF/códigos,
integridade/repetição de falhas e renderização real após zoom, reenquadramento
e mudança de tamanho. Confira também filtros, seleção, ida ao painel e Voltar,
tema/idioma, carregamento e ausência de rolagem horizontal em 1280 e 390 px.

Na edição inicial, a auditoria juntou por código todos os 233.804 registros
classificados dos 1.176 recortes, sem perda de registros ou alteração de valores.
As UFs particionam exatamente os 5.571 territórios da malha nacional.

Publique somente os 28 novos objetos sob `gold/geografia/`, verificando SHA e
ETag, e o manifesto da geografia por último. Não substitua objetos cujo nome
contém o hash. Preserve os manifestos global, econômico e de downloads e todos
os objetos econômicos já publicados. Faça inventário antes/depois e backup de
qualquer ponteiro anterior. Publique o código somente após validar os objetos.
