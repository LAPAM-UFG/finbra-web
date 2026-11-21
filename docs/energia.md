# Energia elétrica e geração

Fontes oficiais: [MMGD](https://dadosabertos.aneel.gov.br/dataset/relacao-de-empreendimentos-de-geracao-distribuida) e [SIGA](https://dadosabertos.aneel.gov.br/dataset/siga-sistema-de-informacoes-de-geracao-da-aneel), ANEEL. O painel separa os dois cadastros. Potência instalada/fiscalizada/outorgada é capacidade em MW, não produção ou consumo em MWh. Não se somam MMGD e SIGA para criar um total nacional.

## Retratos e séries

- MMGD: cadastro de 19/11/2026, referência 11/2026; SIGA: edição diária de 21/11/2026.
- Os retratos só têm valor em 2026 nesta edição. Não se estima o estoque de 2013–2025 com o cadastro atual. Essas células ficam ausentes, condição 5.
- A série de 2013–2026 é uma coorte retrospectiva das instalações presentes no cadastro atual, agrupadas pela data de conexão dos arquivos técnicos. Não inclui registros retirados da base. O último ano está incompleto. Não se atribui a potência atual a anos passados.
- Cada data técnica é associada ao empreendimento e à tecnologia atual. Datas de outra tecnologia não substituem a correta. O sentinela 1900-01-01 é ausência, e a atualização cadastral nunca é usada como conexão.
- 4.745.133 instalações MMGD; datas recuperadas para 4.744.887. Os 246 registros sem data ficam identificados, assim como conexões anteriores a 2013. A soma dessas duas categorias com as coortes de 2013–2026 fecha com o cadastro atual.
- Classes públicas e categorias não classificáveis permanecem em "outras classes". As fontes e os portes têm categorias residuais explícitas. Zero significa zero de registros no cadastro, sem inferir ausência de eletrificação.
- A soma de unidades receptoras de créditos não é número de beneficiários únicos: uma unidade pode aparecer em várias instalações e em outro município.

## SIGA e geografia

- A chave de usina é a CEG. Quatro repetições da mesma CEG decorrem de espécies diferentes de outorga. Só se deduplicam após conferir que todos os outros atributos são idênticos; divergência em potência, fase ou município interrompe a preparação.
- São 24.837 CEGs, em operação, construção ou construção não iniciada. Usinas em operação usam potência fiscalizada; obras/projetos usam potência outorgada.
- Municípios usam a associação nominal declarada no SIGA, com variantes ortográficas explícitas confrontadas com o cadastro IBGE. Há 531 usinas que abrangem vários municípios. Cada uma aparece uma vez em cada município associado. Essas contagens não são somáveis.
- UF e Brasil contam CEGs distintas; a UF é a principal informada pela ANEEL. Quando uma categoria municipal contém usina compartilhada, sua potência fica indisponível, sem rateio. Outras categorias não afetadas continuam com valor.
- Seis CEGs sem município resolvido continuam nos totais nacionais e da UF principal. Não se atribuem automaticamente distritos ou descrições incompletas a um município. Novos nomes não resolvidos exigem revisão.
- Comparações, rankings e mapas usam densidades e participações da MMGD. Referências regionais são razões das somas dos mesmos componentes válidos, sem média simples de percentuais.
- População: referência SVS/IBGE do painel até 2025; estimativa municipal de julho/2026, SIDRA 6579, em 2026. Não é número de clientes, instalações ou domicílios.

## Artefatos e reprodução

150 medidas (97 medidas do cadastro, incluindo a matriz SIGA calculada, e 53 relativas da MMGD), com condições separadas e dicionário. Downloads temáticos com seis chaves, 150 valores e 150 condições, em Parquet, CSV, DTA e RDS, para Brasil e 27 UFs. A seleção principal de 297 variáveis e os arquivos das outras áreas permanecem preservados.

1. `python pipeline/energia_fontes.py --fontes <fontes-novas> --cache <cache-publicado>` adquire e fixa fontes por SHA-256, prepara geografia, população e normalizações. Pode repetir `--cache`; destinos sobrepostos são recusados antes de escrever.
2. `python pipeline/energia.py --fontes <fontes> --saida <painel-novo>` prepara séries parciais por território, comparações e mapas.
3. `python pipeline/energia_downloads.py --base <fontes> --painel <painel> --saida <downloads-novos> --stata <StataBE-64.exe> --rscript <Rscript.exe>` gera e relê todos os arquivos nativos, conferindo cada célula.
4. `python pipeline/energia_integrar.py --anterior <fontes-raiox-anteriores> --base <fontes> --painel <painel> --downloads <downloads> --saida <fontes-raiox-novas> --cache-previo <cache>` fixa o grafo de dependências.
5. `python pipeline/raio_x.py --fontes <fontes-raiox> --saida <raiox-novo>` prepara v10, mantendo edições anteriores para clientes já abertos.

Esses comandos não publicam. Fontes brutas ficam fora do gold e não são exportadas. O navegador recebe apenas o trecho do território, com tamanho e SHA-256 conferidos, sem carregar DuckDB/WASM.

Stata:
```stata
use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/energia.dta", clear
isid cod_ibge ano
xtset cod_ibge ano
```

R:
```r
source("https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/cliente.R")
x <- finbra(uf="GO", tema="energia", municipio=5208905)
```


## Ampliação dos perfis

- Modalidades: geração na própria unidade consumidora, autoconsumo remoto, geração compartilhada, condomínio e categoria residual. Tipo de titular: pessoa física, pessoa jurídica e residual. Contagens e potência dessas partições fecham com o cadastro, inclusive os casos sem informação. Não são titulares únicos nem famílias atendidas.
- Poder público, serviço público e iluminação pública detalham Outras classes. Seus percentuais têm como base o total da MMGD e não podem ser somados novamente ao perfil geral.
- SIGA: CGH, PCH e UHE detalham a fonte hídrica. A matriz usa potência fiscalizada de usinas em operação. Renováveis = solar + eólica + hídrica + biomassa; não é produção em MWh.
- Percentuais SIGA usam numerador e denominador do mesmo recorte e de CEGs distintas. Denominador zero fica sem valor, condição 4. Se o denominador municipal contém usina compartilhada, todas as participações ficam sem valor, condição 2, mesmo quando o numerador é zero. Não há rateio nem média simples de participações municipais. Estas medidas não entram em rankings ou agregações regionais da MMGD.
- O Raio X v10 preserva v9 e todas as edições anteriores. Séries e valores dos 90 indicadores anteriores permanecem idênticos. Todos os downloads temáticos têm 306 colunas: seis chaves, 150 valores e 150 condições. A seleção principal de 297 variáveis permanece igual.
