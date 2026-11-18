# Agropecuária — PAM e PPM

O painel `/agropecuaria` abre com números prontos, sem executar consultas de
microdados. A edição inicial cobre 2013–2025, municípios, UFs, Distrito Federal
e Brasil. Usa estas tabelas oficiais do IBGE:

| SIDRA | Conteúdo |
| --- | --- |
| [5457](https://sidra.ibge.gov.br/tabela/5457) | Área plantada, área colhida, quantidade, rendimento e valor das lavouras |
| [3939](https://sidra.ibge.gov.br/tabela/3939) | Efetivos dos rebanhos |
| [74](https://sidra.ibge.gov.br/tabela/74) | Produtos de origem animal e valores |
| [94](https://sidra.ibge.gov.br/tabela/94) | Vacas ordenhadas |
| [3940](https://sidra.ibge.gov.br/tabela/3940) | Aquicultura, inclusive espécies e formas jovens |

São 130 categorias e 503 medidas originais. Totais e subgrupos permanecem
identificados; não se somam café total com suas variedades, galináceos com
galinhas, suínos com matrizes ou peixes com suas espécies. As duas medidas
inaplicáveis de quantidade/rendimento do total de todas as lavouras são omitidas.

Dinheiro é convertido de mil R$ para **R$ nominais do ano**. Não representa PIB,
valor adicionado ou renda e não foi deflacionado. As outras unidades permanecem
como publicadas: leite em mil litros, ovos em mil dúzias, aquicultura em kg ou
milheiros. A nota da PAM prevalece sobre a unidade genérica da API: abacaxi e
coco-da-baía têm quantidade em **mil frutos** e rendimento em **frutos/ha**,
conforme o [comunicado do IBGE](https://www.ibge.gov.br/comunicados/16980-ibge-disponibiliza-serie-historica-completa-da-pesquisa-agricola-municipal.html).

Traço no SIDRA significa zero; `..` é não aplicável, `...` é indisponível e `X`
é protegido. A falta de uma localidade na resposta não se transforma em zero.
Área colhida pode contar safras sucessivas na mesma terra. Rebanhos são estoques
em 31/12; vacas ordenhadas se referem ao ano. Sua relação com o rebanho bovino
não é uma participação medida no mesmo instante. Estoques não se somam entre anos.

Comparações, mapas e rankings usam 35 medidas relativas: produtividade, valor
por hectare, participações na área e relações entre subconjuntos de rebanhos.
Produtividade calculada pode diferir do rendimento arredondado publicado.
UF e Brasil usam componentes oficiais; regiões imediatas/intermediárias usam
somente pares municipais válidos e informam cobertura. A divisão regional atual
é aplicada a toda a série; não se reconstroem limites históricos.

## Preparação

Sempre usar destinos isolados e preservar o cache da aquisição. Os comandos
não publicam nada. Substituir as pastas de exemplo por diretórios novos:

```powershell
python pipeline/agropecuaria_fontes.py --saida FONTES --geografia GEOGRAFIA.json
python pipeline/agropecuaria.py --fontes FONTES --saida CANDIDATO
python pipeline/agropecuaria_auditar.py --candidato CANDIDATO --saida auditoria.json
python pipeline/agropecuaria_downloads.py --base BASE_PUBLICADA --painel CANDIDATO --saida DOWNLOADS --stata STATA_EXE --rscript RSCRIPT_EXE
python pipeline/agropecuaria_integrar.py --anterior FONTES_RAIO_X --base BASE_PUBLICADA --agro CANDIDATO --downloads DOWNLOADS --saida FONTES_RAIO_X_NOVAS
python pipeline/raio_x.py --fontes FONTES_RAIO_X_NOVAS --saida RAIO_X_NOVO
```

`BASE_PUBLICADA` contém os manifestos globais/comparações/downloads, dicionário,
catálogos de UF e Parquet principal conferidos contra a produção. A fonte do
Raio X usa o mesmo formato de `proveniencia.json` das edições anteriores.

Cada lote SIDRA registra URL, data e SHA-256 dos bytes oficiais. O painel usa
metadados gzip, índices por UF e leitura HTTP Range de apenas um território.
Séries inteiras não são carregadas para montar o mapa: cada indicador/ano/UF tem
seu recorte pronto. Os downloads são um arquivo temático com chave
`cod_ibge ano`, em CSV, Parquet, Stata e RDS, Brasil e 27 UFs. A seleção principal
de 297 indicadores e seus objetos são preservados. Os códigos de condição
acompanham cada medida no arquivo temático e no dicionário.

O Raio X inclui as 503 medidas originais e as 35 relativas. As originais abrem
somente a série do próprio território; as relativas oferecem comparação com
regiões, UF e Brasil. A edição com nove áreas usa
`gold/raiox/v2_manifesto.json`; o cliente novo aceita o manifesto antigo quando
o v2 ainda não existe. O ponteiro antigo permanece disponível para clientes que
reconhecem apenas oito áreas. A geração de uma edição com Agropecuária exige
também suas fontes originais fixadas por hash.

## Consumo

```r
source("https://finbra-web.luanviniciusbernardelli.workers.dev/finbra.R")
agro <- finbra(uf = "GO", tema = "agropecuaria", anos = 2013:2025)
```

```stata
use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/agropecuaria.dta", clear
xtset cod_ibge ano
```

Publicação: subir apenas os objetos gerados nos namespaces Agropecuária,
mapas, comparações, downloads e Raio X; conferir hashes e salvar os ponteiros
anteriores. Objetos imutáveis vêm antes dos ponteiros. Atualizar conjuntamente
downloads e a referência desse manifesto nas comparações, após conferir que
os dados principais continuam idênticos. Não usar sincronização com exclusão
nem enviar o gold local inteiro.
