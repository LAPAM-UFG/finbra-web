# FINBRA-web · Finanças municipais (LAPAM)

Site com receitas, despesas e demonstrativos contábeis de municípios, estados e DF, a partir da
**Declaração de Contas Anuais (DCA)** que os entes enviam ao Tesouro Nacional (SICONFI).
Cobre os 7 anexos da DCA de 2013 em diante, mais PIB municipal (IBGE) e IPCA (Banco Central).

**Site:** <!-- endereço preenchido após a primeira publicação --> _em publicação_

## Como funciona

```
                 todo dia 5 (GitHub Actions)
API do Tesouro ──► pipeline Python ──► Cloudflare R2 (bucket privado, Parquet)
                                              │
                    a cada push (GitHub Actions)│ leitura por Range
web/ (React) ──► build ──► Cloudflare Worker ◄─┘
                                │  site + /dados/*
                                ▼
                    navegador: DuckDB-WASM consulta os Parquet
```

- **Não há servidor de banco de dados.** O site roda o DuckDB dentro do navegador (WebAssembly) e
  lê os arquivos Parquet por requisições HTTP com *Range*: ao abrir um município, baixa só o trecho
  do arquivo onde ele está.
- **O R2 continua privado.** Quem entrega os arquivos é o Worker, que tem uma ligação interna com o
  bucket e só expõe as camadas `silver/` e `gold/` em `/dados/`.
- **Duas automações no GitHub:** uma atualiza os dados todo mês; a outra publica o site quando o
  código muda.

| Pasta | O que tem |
|---|---|
| `pipeline/` | extração da API, tratamento em camadas e sincronização com o R2 (Python) |
| `web/` | site em React + Vite + ECharts, com a camada de consultas em `src/dados.ts` |
| `worker/` | Worker da Cloudflare: entrega o site e serve `/dados/*` a partir do R2 |
| `.github/workflows/` | as duas automações |
| `data/` | arquivos de dados locais (fora do git) |

---

## Montar o ambiente local

### 1. Pré-requisitos

| Programa | Versão | Para quê |
|---|---|---|
| [Git](https://git-scm.com/downloads) | recente | clonar o repositório |
| [Python](https://www.python.org/downloads/) | 3.12 ou mais novo | pipeline de dados |
| [Node.js](https://nodejs.org/) | 22 LTS | site (o `wrangler`, da publicação, exige 22) |

> **Windows:** os comandos usam `py` (o lançador do Python no Windows). No Linux e no macOS, troque
> por `python3`.

### 2. Clonar e instalar

```bash
git clone https://github.com/LAPAM-UFG/finbra-web.git
cd finbra-web

py -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r pipeline/requirements.txt

cd web && npm install && cd ..
```

### 3. Trazer os dados

**Caminho rápido (membros do laboratório):** os dados processados ficam no bucket `lapam-finbra`.
Peça a um administrador uma chave do R2, copie `.env.example` para `.env`, preencha e rode:

```bash
py pipeline/r2.py baixar --camadas silver gold     # ~280 MB, menos de 1 minuto
```

O `.env` fica fora do git; **nunca faça commit dele**.

**Sem acesso ao R2:** gere os dados a partir da API do Tesouro. Ela aceita 1 requisição por segundo,
e a extração é **retomável** (se parar, rode o mesmo comando de novo).

```bash
py pipeline/extract.py --anos 2024 2025 --uf PR    # amostra: Paraná, 2 anos (~15 min)
py pipeline/extract.py --anos 2025                 # um ano do Brasil (~1h50)
py pipeline/extract.py --anos 2013-2025            # carga completa (~23 h)

py pipeline/processar.py                           # camadas, PIB, IPCA e validação
```

> O painel da pesquisa LAPAM (arquivos `.dta`: Bolsa Família, INSS, área, renda) **não está no
> repositório**. Sem ele, o site funciona e essas colunas aparecem vazias. Quem tiver os arquivos
> inclui com `py pipeline/processar.py --dta "caminho/da/pasta/Revenue"`.

### 4. Abrir o site

```bash
cd web
npm run dev                     # http://localhost:5180
```

O Vite serve a pasta `data/` em `/dados/`, do mesmo jeito que o Worker faz em produção. Para testar a
versão compilada: `npm run build && npm run preview`.

Na primeira visita, o navegador baixa o motor do DuckDB (alguns MB, da CDN jsDelivr); depois
ele fica em cache.

---

## Atualização automática dos dados

Workflow **Atualizar dados** (`.github/workflows/atualizar-dados.yml`):

| | |
|---|---|
| Quando | todo dia 5, às 03h de Brasília; ou manualmente |
| O que faz | baixa silver e gold do R2 → rebaixa da API os **dois últimos exercícios fechados** (os entes retificam declarações) → processa e valida → envia ao R2 só os arquivos que mudaram |
| Duração | ~4 h (a API aceita 1 requisição por segundo; ~5.600 entes por ano) |
| Resultado | o site mostra os dados novos sozinho, sem republicar |

**Rodar manualmente** (por exemplo, para incluir um exercício recém-entregue):
GitHub → aba **Actions** → **Atualizar dados** → **Run workflow** → no campo *Exercícios*, informe
os anos separados por espaço (ex.: `2025 2026`) ou deixe vazio.

Se a validação encontrar um problema estrutural, o workflow para **antes** de enviar ao R2, e o site
continua com os dados anteriores. Logs e tabelas de validação ficam em **Artifacts** na página da
execução, por 90 dias.

Para atualizar à mão, na sua máquina:

```bash
py pipeline/r2.py baixar --camadas silver gold
py pipeline/extract.py --anos 2024 2025 --atualizar
py pipeline/processar.py --anos 2024 2025
py pipeline/r2.py enviar
```

## Publicação do site

Workflow **Publicar site** (`.github/workflows/publicar-site.yml`): a cada push na `main` que altere
`web/` ou `worker/` (ou manualmente, em Actions → Publicar site → Run workflow), compila o React e
publica o Worker com `wrangler deploy`.

O Worker (`worker/src/index.js`) entrega os arquivos do site e responde `/dados/*` lendo o bucket
pela ligação `DADOS`, com suporte a `Range`, `HEAD` e `ETag`. Os arquivos são pedidos com
`?v=<data da atualização>`, tirada do `gold/manifesto.json`, então o cache dura 1 dia sem o risco de
mostrar dados antigos depois de uma atualização.

## Configuração inicial (uma vez só)

Já feita para o repositório `LAPAM-UFG/finbra-web`. Fica registrada aqui para refazer, se preciso.

**Cloudflare** (conta do laboratório):

1. **R2 → Create bucket:** `lapam-finbra` (localização automática, classe Standard).
2. **R2 → Manage API tokens → Create Account API token:** permissão *Object Read & Write*, só no
   bucket `lapam-finbra`, sem validade. Guarde o *Access Key ID*, o *Secret Access Key* e o
   *Account ID*.
3. **Workers & Pages:** na primeira visita, escolha o subdomínio `*.workers.dev`.
4. **Manage Account → Account API Tokens → Create Token**, modelo *Edit Cloudflare Workers*, na
   conta do laboratório.

**GitHub** (repositório → Settings → Secrets and variables → Actions → *New repository secret*):

| Secret | Valor | Usado por |
|---|---|---|
| `R2_ACCOUNT_ID` | Account ID da Cloudflare | as duas automações |
| `R2_ACCESS_KEY_ID` | Access Key ID do token do R2 | Atualizar dados |
| `R2_SECRET_ACCESS_KEY` | Secret Access Key do token do R2 | Atualizar dados |
| `R2_BUCKET` | `lapam-finbra` | Atualizar dados |
| `CLOUDFLARE_API_TOKEN` | token *Edit Cloudflare Workers* | Publicar site |

Com o `gh` (GitHub CLI) e um `.env` preenchido com essas mesmas variáveis:
`gh secret set -f .env -R LAPAM-UFG/finbra-web`.

**Trocar uma chave** (perdeu, vazou ou alguém saiu do projeto): gere outra no painel da Cloudflare,
apague a antiga e atualize o secret no GitHub e o seu `.env`.

---

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `py` não é reconhecido | Instale o Python marcando *Add python.exe to PATH*, ou use `python`. |
| Erro de certificado SSL ao baixar o PIB do IBGE | O servidor do IBGE não envia o certificado intermediário; o pacote `truststore` resolve no Windows. Se falhar (por exemplo, no Linux da Action), o pipeline mantém o PIB anterior e segue. |
| `npm install` falha com erro de *peer dependencies* | O `web/.npmrc` já liga `legacy-peer-deps`; rode o comando dentro de `web/`. |
| `Port 5180 is already in use` | Outro processo usa a porta. Feche-o ou mude `server.port` em `web/vite.config.ts`. |
| Site local mostra "Não foi possível carregar os dados" | Falta `data/gold/manifesto.json`: baixe do R2 ou rode o `processar.py`. |
| Páginas vazias no local | Confira se o ano e a UF foram extraídos (a amostra do passo 3 só tem o Paraná). |
| Workflow "Publicar site" falha com erro de autenticação | Confira o secret `CLOUDFLARE_API_TOKEN` e se o subdomínio `workers.dev` foi criado. |
| Workflow "Atualizar dados" passou de 6 h | O GitHub interrompe jobs longos; rode manualmente com um ano só por vez. |

---

## Como os dados são tratados

### Camadas

| Camada | Conteúdo | Tamanho (13 anos) | Onde fica |
|---|---|---|---|
| landing | resposta da API por ente e exercício (`ndjson.gz`) | ~1 GB | só local, pode ser apagada |
| bronze | um Parquet por exercício, fiel à API | ~300 MB | R2 |
| silver | colunas padronizadas, árvore de contas, população, PIB, IPCA | ~270 MB | R2, lida pelo site |
| gold | indicadores, árvore agregada por UF/Brasil, alertas, validação, manifesto | ~25 MB | R2, lida pelo site |

### Regras

- **Valor informado em cada nó.** Cada conta mostra o valor que o ente declarou. Nada é calculado
  somando só as contas do último nível, o que preserva contas redutoras (como depreciação) e evita
  perder valores quando o ente detalha só parte de uma conta.
- **Hierarquia pelos segmentos do código.** `1.1.1.2.53` (ITBI) é irmão de `1.1.1.2.50` (IPTU), não
  filho: o 5º segmento tem dois dígitos. Os zeros finais saem da chave, então `1.0.0.0.00.00.00`
  (2013) e `1.0.0.0.00.0.0` (2022) viram a mesma conta.
- **Anexos I-E e I-G** (por função) não têm código: a chave vem do texto (`F04`, `F04.122`; "Demais
  subfunções" vira `F04.999`).
- **Conta-mãe ausente** é criada com a soma das subcontas e aparece marcada como "(soma)".
- **Indicadores que mudaram de código** em 2018 e 2022 (FPM, ICMS, IPVA, IPTU, ISS, ITBI) são
  identificados pela descrição da conta.
- **UF de estados e DF** vem do código IBGE (a lista de entes da API traz "BR" para eles).
- **Valores reais** usam o IPCA de dezembro a dezembro, na base do último ano completo.

### Validação e alertas

`pipeline/validate.py` roda a cada processamento e grava `data/gold/validacao.csv`:

- as contas de primeiro nível somam o total que o próprio ente declarou;
- no balanço, Ativo = Passivo + Patrimônio Líquido.

Divergências de até 1% por grupo são tratadas como erro da própria declaração (listadas em
`data/gold/validacao_divergencias.csv`); acima disso, o pipeline para.

`data/gold/alertas.parquet` marca o ente-ano cuja receita ou despesa está mais de 5 vezes acima ou
abaixo da mediana do próprio ente, ou não foi declarada. Exemplo real: São João de Meriti (RJ)
declarou R$ 366 bilhões de receita em 2023. Esses casos ficam **fora dos totais de UF, Brasil e
rankings**; ao escolher o ente, os valores aparecem como declarados, com aviso.

---

## Fontes

- **SICONFI / Tesouro Nacional:** `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/dca`
  ([documentação](https://apidatalake.tesouro.gov.br/docs/siconfi)), limite de 1 requisição por segundo.
- **IBGE:** PIB dos Municípios, tabela SIDRA 5938 (até 2023; setores até 2021).
- **Banco Central:** IPCA mensal, série SGS 433.
- **Painel da pesquisa LAPAM** (opcional, fora do repositório): área, distância, Bolsa Família, INSS (2013–2021).
