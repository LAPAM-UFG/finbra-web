# Mobilidade e segurança no trânsito

O painel `/mobilidade` abre com números prontos por município, UF e Brasil.
Cada território é lido por HTTP Range: menos de 50 KB para a série completa.
Não se inicia SQL ou WebAssembly. Mapas e comparações usam arquivos próprios.

A edição ampliada contém **142 medidas originais e 54 relativas (196)**:

- Senatran/Renavam: retratos de **dezembro, 2013–2025**, por tipo, combustível
  e fabricação. Estoques não são somados entre meses ou anos.
  Espécie/eixos acrescenta 19 medidas originais e dez percentuais; o arquivo de
  dezembro de 2018 não está disponível. Esse recorte fica sem valor em 2018,
  sem substituir por agosto. Os demais recortes de frota continuam disponíveis.
- SIM: óbitos não fetais de **residentes, 2013–2024**, somente dados definitivos,
  causa básica CID-10 **V01–V89**. Inclui transporte terrestre fora de via pública.
  Não identifica o município do acidente. DOBR e prévias não são incluídos.
  Os perfis adicionais incluem raça/cor, escolaridade em anos de estudo (ESC)
  entre pessoas de 15+, local do falecimento, marcação de acidente de trabalho e
  mês da data do óbito. Categorias ignoradas são preservadas. Escola não informada
  não é nenhuma escolaridade. Não se convertem códigos ESC2010 em anos.
- População: SVS/MS, referência IBGE, a mesma série publicada na Saúde.

O filtro padrão mostra o último ano de cada fonte, indicado em cada número.
Selecionar 2025 mantém os óbitos indisponíveis; não há substituição silenciosa
por 2024. Zero do SIM significa nenhum óbito registrado, não ausência de risco.
Fernando de Noronha não tem população nessa edição: contagens são mantidas e
as taxas permanecem sem valor. Boa Esperança do Norte não recebe zeros antes
da implantação do município em 2025.

## Medidas relativas e cobertura

Mapas e rankings usam taxas, proporções e médias, com referências de região
imediata, intermediária, UF e Brasil. Referências usam **razões das somas dos
mesmos pares municipais válidos**, sem média de taxas e sem redistribuir casos
sem município. A divisão regional atual do IBGE é usada em todos os anos.
As taxas de mortalidade são brutas, sem padronização por idade; pequenas
contagens variam bastante. Não há ranking de segurança baseado em contagens.

Os totais originais UF/Brasil incluem os registros sem município identificado,
indicados nos metadados do recorte. Por isso, a base das taxas pode ser menor
que o total da fonte. Numerador, denominador e cobertura do cálculo são
pré-computados e apresentados na série selecionada.
Nas tabelas de perfil, contagens são os totais da fonte e percentuais usam pares
municipais válidos com base positiva. Em UF/Brasil, os componentes do percentual
aparecem ao lado do valor. Municípios sem óbitos têm participações indefinidas.

Percentuais de raça/cor descrevem a composição dos registros, incluindo
ignorados; não são taxas de mortalidade específicas dos grupos raciais.
Escolaridade usa todos os óbitos de 15+, incluindo escolaridade ignorada;
menores de 15 e idades ignoradas ficam fora deste perfil. LOCOCOR indica onde a
pessoa faleceu, não onde sofreu o acidente; não permite inferir resgate ou
qualidade do atendimento. ACIDTRAB preserva sim, não e ignorado. A participação
de sim usa sim + não como denominador, acompanhada de cobertura do campo. Não
é contagem exaustiva de mortes de trabalhadores. Meses são da data do óbito,
não necessariamente do acidente; doze meses mais mês inválido somam o total.

Idade média **estimada**: ano da referência menos fabricação, sem mês. Entram
anos entre 1900 e a referência; ano-modelo não substitui fabricação. Fabricação
ausente ou futura é mostrada separadamente. Percentuais de idade usam o
cadastro de fabricação; percentuais de combustível usam seu próprio cadastro.

Elétricos/híbridos: soma das categorias de combustível com a palavra ELÉTRICO,
incluindo fonte interna/externa e combinações híbridas. Não é classificação por
modelo, autonomia ou modo de recarga. Categorias ausentes em toda a classificação
de um ano permanecem sem valor. Se a categoria existe no ano, sua ausência na
tabela de frequências de um município que consta na fonte corresponde a zero.

O cruzamento territorial é exato após normalização de caixa, acentos e pontuação,
com correspondências explícitas em `pipeline/mobilidade_municipios.json`.
Não se usa aproximação automática. Ibitiúva/SP é incorporado a Pitangueiras
conforme a divisão distrital do IBGE; um veículo em 2024 aparece em linha própria
na Senatran. Registros sem município identificado ficam nos totais UF/Brasil.

Espécie é classificação do registro, distinta do tipo do veículo e do uso
efetivo. Eixos são valores declarados. A fonte contém zero, negativos e valores
como 20 ou 99; eles são preservados em grupos próprios, sem corrigir 20 para 2.
O recorte de 1 a 9 eixos é apenas descritivo, não certifica validade física.

## Preparação em pastas isoladas

```powershell
python pipeline/mobilidade_fontes.py --saida FONTES
python pipeline/mobilidade_normalizar.py --fontes FONTES
python pipeline/mobilidade_perfis_fontes.py --fontes FONTES
python pipeline/mobilidade_perfis.py --fontes FONTES
python pipeline/mobilidade_sim.py --micro MICRO/SIM/CID10/DORES --fontes FONTES
python pipeline/mobilidade.py --fontes FONTES --saida CANDIDATO
python pipeline/mobilidade_auditar.py --fontes FONTES --candidato CANDIDATO --saida auditoria.json
python pipeline/mobilidade_downloads.py --base FONTES --painel CANDIDATO --saida DOWNLOADS --stata STATA_EXE --rscript RSCRIPT_EXE
python pipeline/mobilidade_integrar.py --anterior FONTES_RAIO_ANTERIORES --base FONTES --painel CANDIDATO --downloads DOWNLOADS --saida FONTES_RAIO_NOVAS
python pipeline/raio_x.py --fontes FONTES_RAIO_NOVAS --saida RAIO_NOVO
```

FONTES também contém cópias conferidas dos manifestos publicados, geografia,
dicionário, catálogos de UF e Parquet principal. A aquisição conserva os arquivos
oficiais, URL, data e SHA-256. Dados Access de 2013/2014 usam pyodbc e o driver
Microsoft Access; RAR usa o leitor 7-Zip ou tar com suporte RAR. As conversões
escrevem apenas no cache novo. Os microdados SIM são lidos localmente; somente
agregados municipais são publicados.

Os arquivos temáticos Brasil e 27 UFs têm 196 medidas, 196 condições e seis
identificadores: **398 colunas**, em Stata, RDS, CSV e Parquet. Os formatos são
comparados célula a célula usando os programas nativos. A seleção principal de
297 indicadores e os arquivos dos outros temas continuam nos mesmos objetos.

O Raio X recebe as medidas relativas e originais; originais abrem sua série,
sem comparações absolutas entre lugares. A edição de dez áreas usa
`gold/raiox/v4_manifesto.json`; v3, v2 e legado permanecem disponíveis para
clientes anteriores. O cliente novo tenta v4, v3, v2 e legado, nessa ordem.

## R e Stata

```r
source("https://finbra-web.luanviniciusbernardelli.workers.dev/finbra.R")
mobilidade <- finbra(uf = "GO", tema = "mobilidade", anos = 2013:2025)
```

```stata
use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/mobilidade.dta", clear
xtset cod_ibge ano
```

Publicar objetos imutáveis antes dos cinco ponteiros: Mobilidade, mapa,
Raio X v4, downloads e comparações. V4 é novo; os outros quatro já existem e
somente são substituídos após
comparar a base remota e salvar cópias. Não excluir nem sincronizar o gold inteiro.

Fontes: [Senatran](https://www.gov.br/transportes/pt-br/assuntos/transito/conteudo-Senatran/frota-de-veiculos-2025),
[SIM](https://dadosabertos.saude.gov.br/dataset/sim),
[códigos do IBGE](https://www.ibge.gov.br/explica/codigos-dos-municipios.php).
