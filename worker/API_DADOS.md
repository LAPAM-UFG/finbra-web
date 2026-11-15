# API pública de dados municipais — v1

A API serve a edição municipal preparada em **Baixar dados**, desde 2013. Oferece endereços estáveis para a edição atual e URLs imutáveis/SHA-256 para reproduzir uma análise. Não exige login ou chave. A API autenticada da IA continua separada em `/api/ia`.

Base: `https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1`

## Stata

```stata
use "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO/saude.dta", clear
keep if inrange(ano, 2019, 2024)
```

Alternativa nativa, sem instalar complementos:

```stata
webuse set https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/painel/GO
webuse saude, clear
```

O `.dta` preserva rótulos, precisão, nulos e painel `cod_ibge ano`. `clear` substitui o conjunto em memória. Os comandos foram conferidos no Stata 18 com `datasignature` igual ao arquivo publicado.

## R

```r
source("https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1/cliente.R")
dados <- finbra(uf = "GO", tema = "saude", anos = 2019:2024)

# Infere GO pelo código IBGE e mantém os seis identificadores:
goiania <- finbra(municipio = 5208707, tema = "saude",
                 anos = 2019:2024,
                 variaveis = c("sau_ind_mortalidade_infantil", "sau_icsap_int"))
dicionario <- finbra_dicionario(tema = "saude")
attr(dados, "finbra") # fonte, hash do Parquet, chaves, dicionário e filtros locais
```

O cliente usa somente R base: baixa temporariamente e lê o RDS nativo, sem instalar pacotes. O endpoint `cliente.R` ajusta o endereço ao próprio servidor; `web/public/finbra.R` também pode ser salvo e carregado localmente, com `base_url` para um espelho. O código público é ASCII para funcionar também em sessões Windows com locale C, preservando mensagens Unicode por escapes. Os dados mantêm UTF-8.

Os RDS são gerados no R e comparados integralmente com os Parquet; os relatórios de preparação registram os arquivos e as células conferidas. A serialização é versão 2, gzip e `data.frame` base. Não há dependências de Arrow/haven para consumir. Lógicos mantêm TRUE/FALSE/NA; categorias textuais permanecem texto, com rótulos/unidades/fontes por coluna. O dicionário inclui a codificação usada no Stata. Inteiros de 64 bits só são convertidos em double após verificar representabilidade exata; valores acima de 2^53 são recusados na preparação.

## Rotas

| Rota | Conteúdo |
|---|---|
| `GET /catalogo.json?uf=GO&tema=saude` | Formatos, linhas, variáveis, anos, tamanho, SHA-256 e URL imutável do recorte |
| `GET /painel/GO/saude.dta` | Stata direto |
| `GET /painel/GO/saude.rds` | R nativo |
| `GET /painel/GO/saude.parquet` | Parquet |
| `GET /painel/GO/saude.csv.zip` | CSV compactado |
| `GET /painel.rds?uf=GO&tema=saude` | Forma equivalente com parâmetros |
| `GET /dicionario.json?tema=saude` | Metadados JSON, com identificadores |
| `GET /dicionario.rds` | Dicionário nativo para R |
| `GET /dicionario.xlsx` ou `/dicionario.csv.zip` | Dicionário nos outros formatos |
| `GET /amostra.json?uf=GO&tema=saude` | Até cinco linhas reais, **não a base completa** |
| `GET /cliente.R` | Cliente R, apenas código; não carrega dados ao ser executado |

`uf`: BR ou uma das 27 siglas. `tema`: todos, financas, saude, educacao, trabalho, gestao, clima, assistencia. O padrão é BR/todos. Não se troca um recorte ausente por Brasil silenciosamente. Parâmetros inválidos, repetidos ou não suportados são recusados com 400, não ignorados.

UF e tema selecionam arquivos pré-calculados e reduzem a transferência. Ano, município e coluna são filtros **no programa cliente**, depois da leitura; não são consultas SQL executadas no Worker. MUNIC/DCA completas permanecem na central de downloads; a API de painel expõe a seleção integrada de 297 indicadores e seis identificadores.

Educação usa `tema="educacao"` no R e `/painel/GO/educacao.dta` no Stata. Seus 43 indicadores abrangem as referências publicadas desde 2013, preservando lacunas e o calendário bienal do Ideb. Percentuais usam escala 0–100 e Ideb, 0–10; cada variável indica a rede e o universo no dicionário. Preparação em `pipeline/EDUCACAO.md`.

GET/HEAD/OPTIONS, CORS público, ETag e Range são suportados. URLs estáveis são revalidadas (`no-cache`), com cabeçalhos `X-Finbra-SHA256` e `X-Finbra-Edicao`. HEAD da API responde 200; `/dados/*` mantém seu HEAD 206 para compatibilidade com DuckDB. Erros retornam JSON/400, 404, 405 ou 503, sem detalhes internos. O catálogo informa as datas da fonte e dos arquivos separadamente.

## Arquitetura e publicação

O servidor permanece no Cloudflare Worker; R é usado na preparação dos arquivos e como cliente de análise. Hospedar o próprio servidor em R é outra implantação (por exemplo, Plumber), não necessária para ler estes dados no R.

`pipeline/downloads_r.py` lê uma candidata já publicada de navegação e acrescenta RDS/dicionário/pacote R, em saída isolada. Reusa todos os objetos anteriores sem alteração. `pipeline/downloads_r.R` exige Arrow/jsonlite **só para preparação**. A auditoria nativa lê cada RDS de volta e exporta Parquet temporário para comparação independente em Python.

```powershell
python pipeline/downloads_r.py --origem E:/finbra/candidato_downloads_ux_20261114 --saida E:/finbra/candidato_api_stata_r_20261114 --base E:/finbra/data --rscript "C:/Program Files/R/R-4.6.1/bin/Rscript.exe"
```

Todos os objetos alcançáveis devem ser obtidos com `downloads_navegacao.objetos`, inclusive os catálogos de UF e prévias. Enviar somente os novos objetos, sem `--limpar`; fazer o deploy compatível antes de trocar o manifesto próprio, por último e com backup. Não alterar o manifesto global nem as fontes dos outros painéis. Atualizar a fonte não atualiza esse instantâneo automaticamente: repetir a preparação/publicação.

Validação: `npm run test:dados` e `npm test` em worker; `npm run test:downloads` e `npm run build` em web; `wrangler deploy --dry-run`; testes nativos Stata/R contra servidor local e produção; conferir painel em 1280/390 px.
