# Segurança pública e violência

`/seguranca` abre com números calculados por município, UF e Brasil, sem SQL ou
WebAssembly. Cada série territorial tem um índice com offset, tamanho e SHA-256;
somente o território solicitado é transferido. Gráficos leves mostram os anos
desde 2013; mapas, rankings e referências regionais usam taxas e proporções.

## Fontes e cobertura

- **SIM definitivo, 2013–2024**: arquivos DORES, 27 UFs, óbitos não fetais de
  residentes. DOBR, 2025 preliminar e prévias ficam fora. Causa básica CID-10:
  agressão X85–Y09; suicídio X60–X84; intenção indeterminada Y10–Y34; intervenção
  legal Y35. Armas de fogo: W32–W34, X72–X74, X93–X95, Y22–Y24 e Y35.0.
  Não somar grupos sobrepostos. Agressão não é classificação penal de homicídio
  ou feminicídio. Não se atribui a violência ao município do hospital.
- **Sinesp VDE/MJSP, 2015–2025**: abrangência Estadual, campo `total_vitima`,
  eventos com desagregação municipal. Não somar PF e PRF. Não completar 2013/2014
  com outra metodologia nem apresentar o ano de 2026 incompleto como ano cheio.
  A edição consultada apresenta roubos, furtos de veículos e estupros somente
  por UF; eles não são distribuídos pelos municípios. A lista e as notas dos
  gestores estão na fonte oficial, ligada no painel.
- **População**: SVS/MS, referência IBGE, a mesma edição de Saúde e downloads.
  Ausência de população não impede mostrar a contagem; impede calcular a taxa.
  Fernando de Noronha fica com taxas indisponíveis. Boa Esperança do Norte não
  recebe zeros nos anos anteriores à implantação do município em 2025.

As duas fontes medem universos diferentes, com definições, datas e locais
distintos. Permanecem identificadas na tela, nas exportações e no dicionário.

## Regras dos cálculos

Taxa bruta = numerador / população do mesmo ano × 100 mil, sem padronização
etária. Os percentuais descrevem a composição dos registros; não são riscos de
mortalidade por grupo. Ignorados entram nos respectivos denominadores. A
escolaridade usa ESC, em anos de estudo, entre óbitos de 15+, incluindo os de
escolaridade ignorada; não converte ESC2010. LOCOCOR é local do falecimento. Os
meses são da data do óbito; os 12 meses e a categoria ignorada somam o ano.

Taxa média do triênio encerrado no ano selecionado = soma dos óbitos dos três
anos / soma das populações dos mesmos três anos × 100 mil. Exige os três anos
completos. Não é taxa acumulada nem média simples das taxas anuais. Em 2013 e
2014, esse cálculo fica fora da cobertura. Médias e taxas não indicam, por si,
se uma cidade é segura.

Regiões imediatas/intermediárias, UFs e Brasil usam razões das somas dos mesmos
pares municipais válidos, com a divisão regional atual do IBGE em toda a série.
Não se somam taxas. Os totais das fontes incluem registros com município
ignorado; esses registros não são redistribuídos. A base das taxas pode diferir
do total da fonte e é mostrada junto ao valor e à cobertura.

Sinesp: linhas complementares do evento/mês são somadas. Qualquer componente
nulo impede considerar aquele mês completo. As contagens parciais permanecem
identificadas (condição 11), com o número de meses válidos; não geram taxa anual
(condição 24). Um evento zerado em toda uma UF/ano é preservado como zero da
fonte, com condição 23; a presença de zeros não prova preenchimento. Esses
zeros ficam fora das taxas e rankings, sem afirmar que são ausências ou erros.
Zeros municipais de uma UF que reporta casos seguem como zeros registrados.
Ausências nunca viram zero. Correspondências de nomes são exatas após remover
acentos/caixa/pontuação, com três variações explícitas documentadas no JSON.

## Preparação e validação

```powershell
python pipeline/seguranca_fontes.py --fontes FONTES
python pipeline/seguranca_sim.py --micro MICRO/SIM/CID10/DORES --fontes FONTES
python pipeline/seguranca_sinesp.py --fontes FONTES
python pipeline/seguranca.py --fontes FONTES --saida CANDIDATO
python pipeline/seguranca_auditar.py --fontes FONTES --candidato CANDIDATO --saida auditoria.json
python pipeline/seguranca_downloads.py --base FONTES --painel CANDIDATO --saida DOWNLOADS --stata STATA_EXE --rscript RSCRIPT_EXE
python pipeline/seguranca_integrar.py --anterior FONTES_RAIO_ANTERIORES --base FONTES --painel CANDIDATO --downloads DOWNLOADS --saida FONTES_RAIO_NOVAS
python pipeline/raio_x.py --fontes FONTES_RAIO_NOVAS --saida RAIO_NOVO
```

FONTES fixa por SHA-256 os manifestos publicados, geografia, dicionário,
catálogos de UF e Parquet principal. Downloads usa arquivos temáticos Brasil e
27 UFs em DTA, RDS, CSV ZIP e Parquet, com as condições de todas as medidas.
O dicionário descreve unidade, fonte, fórmula, período e ausência. A seleção
principal de 297 indicadores e os arquivos dos demais temas ficam intactos.
Stata e RDS são comparados célula a célula com o Parquet.

O integrador de fontes do Raio X fixa também o candidato, todos os catálogos
de comparações anteriores e as séries originais por suas referências. A
geração `pipeline/raio_x.py` grava `gold/raiox/v5_manifesto.json`. V4 e anteriores
permanecem intactos para clientes já abertos. O cliente tenta v5 e depois as
edições anteriores quando não há v5. Todas as séries anteriores são cotejadas
antes de publicar. Só agregados saem do disco, nunca microdados pessoais.

```r
source("https://finbra-web.luanviniciusbernardelli.workers.dev/finbra.R")
x <- finbra(uf="GO", tema="seguranca", anos=2013:2025)
```

```stata
use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/seguranca.dta", clear
xtset cod_ibge ano
```

Publicar primeiro os objetos imutáveis, conferidos por tamanho/MD5/SHA, e só
depois os ponteiros novos de Segurança, mapa e Raio X v5 e os dois ponteiros
existentes de downloads/comparações. Fazer cópia dos substituídos e comparar
com a base remota antes de ativar. Não excluir nem sincronizar o gold inteiro.
