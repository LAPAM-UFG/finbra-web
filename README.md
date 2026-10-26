# FINBRA-web · Finanças municipais (LAPAM)

Site com receitas, despesas e demonstrativos contábeis de municípios, estados e DF, a partir da
**Declaração de Contas Anuais (DCA)** que os entes enviam ao Tesouro Nacional (SICONFI).
Cobre os 7 anexos da DCA de 2013 em diante, mais PIB municipal (IBGE) e IPCA (Banco Central).

**Site:** https://finbra-web.luanviniciusbernardelli.workers.dev

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

- **Não há servidor de banco de dados.** O site roda o DuckDB dentro do navegador (WebAssembly).
  Na primeira visita, baixa de uma vez as tabelas pequenas (entes, indicadores, IPCA…, ~12 MB, que
  ficam em cache por 1 dia). As tabelas grandes são lidas por requisições HTTP com *Range*: ao abrir
  um município, só o trecho do arquivo onde ele está.
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

py pipeline/processar.py                           # camadas, PIB, IPCA, Bolsa Família, INSS e validação
```

> Na primeira vez, o Bolsa Família baixa os pagamentos de todos os meses desde 2013 (~300 MB por mês,
> ~4 h no total); depois, só os meses novos. Para acompanhar à parte: `py pipeline/familias.py --atualizar`.

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
pela ligação `DADOS`, com suporte a `Range`, `HEAD` e `ETag`, e só expõe `silver/` e `gold/`. O site
pede os arquivos como `/dados/v/<versão>/...`, com a versão tirada do `gold/manifesto.json`: o cache
dura 1 dia sem risco de mostrar dados antigos depois de uma atualização.

### Arquivos que o site lê

O navegador faz uma requisição por vez ao R2 (~250 ms cada), então os arquivos são organizados
para cada consulta caber em **um arquivo e poucos blocos**:

| Arquivo | Uso | Como é lido |
|---|---|---|
| `gold/manifesto.json` | exercícios, colunas, base do IPCA, versão dos dados | inteiro, sempre revalidado |
| `silver/entes.parquet`, `gold/indicadores.parquet`, `escopos`, `alertas`, `faixas`, `ipca` | listas, KPIs, rankings, FPM, faixas | inteiros, uma vez, em memória |
| `silver/contas/exercicio=AAAA.parquet` | plano de contas de cada ano | inteiro, na primeira vez que o ano é aberto |
| `gold/arvore.parquet` | árvore e séries de UF e Brasil | por Range (ordenado por escopo, conta e ano) |
| `gold/entes/uf=XX.parquet` | árvore e séries de um ente (todos os anos) | por Range (ordenado por ente e ano) |

Detalhes do DuckDB-WASM que fazem diferença (em `web/src/dados.ts`):

- `forceFullHTTPReads` vem ligado e baixa cada arquivo inteiro: o site desliga e exige leitura parcial.
- O navegador descarta o `Range` em requisições `HEAD`; por isso o Worker e o Vite respondem `206` a
  qualquer `HEAD`, que é o que o DuckDB exige para ler por partes.
- `?` numa URL é curinga para o DuckDB: a versão vai no caminho, não na query string.
- Parâmetros vindos do JavaScript são decimais: `cod_ibge = $ente::INTEGER` mantém o filtro nos
  metadados do Parquet (sem o cast, ele lê o arquivo todo).

Um arquivo removido localmente pode ser apagado do bucket com
`py pipeline/r2.py enviar --camadas gold --limpar`.

### Versão em inglês

O botão **English** no topo traduz o site inteiro; a escolha fica guardada no navegador.

- Textos da interface: cada um é escrito com as duas versões, `t('Receita bruta', 'Gross revenue')`
  (`web/src/idioma.ts`). Números passam a usar o formato inglês (`R$ 12.10 bn`).
- Nomes das contas: o Tesouro só publica o plano de contas em português. A tradução fica em
  `web/src/traducoes/contas.en.json` (descrição em português → inglês), que o navegador só baixa
  ao escolher o inglês. Colunas dos anexos, motivos de alerta e nomes de testes ficam em `TERMOS`,
  no mesmo `idioma.ts`.
- Conta nova sem tradução aparece em português. Depois de uma atualização dos dados, rode
  `py pipeline/contas_sem_traducao.py` para listar as que faltam e acrescente-as ao JSON.

### Perguntas com IA (página /ia)

Campo de perguntas em linguagem natural, só para e-mails autorizados.

1. O navegador envia a pergunta ao Worker (`/api/ia`, `worker/src/ia.js`), protegido pelo
   Cloudflare Access. O Worker confere o token do Access (`worker/src/acesso.js`) e o limite de
   **50 perguntas por pessoa e por dia** (horário de Brasília; contagem no R2, em `ia/uso/`, que
   não é servido em `/dados/`).
2. O Worker chama o Claude (`claude-sonnet-5-5`, SDK oficial `@anthropic-ai/sdk`) com o esquema das
   tabelas e as regras do painel (`worker/src/sistema.js`) e com os anos e a cobertura lidos do manifesto.
3. O Claude devolve consultas SQL. O navegador confere que são somente leitura (`validarSql`, em
   `web/src/ia.ts`) e as executa no DuckDB sobre as tabelas em memória (`entes`, `indicadores`,
   `alertas`, `escopos`, `faixas`, `ipca`). O resultado volta ao Claude, que escreve a resposta.
4. A página mostra a resposta, o SQL e a tabela de cada consulta, com exportação em CSV e Excel.

Se o modelo recusar um pedido por política de segurança, a API refaz o pedido no modelo reserva
indicado pela Anthropic (`fallbacks: "default"`).

Configuração (uma vez):

- Chave da Anthropic, como segredo do Worker: `cd worker; npx wrangler secret put ANTHROPIC_API_KEY`.
- Cloudflare Access (Zero Trust → Access → Applications → Self-hosted): aplicação no domínio do
  site com o caminho `api/ia`, e política *Allow* com a lista de e-mails. Copie o
  *Application Audience (AUD) Tag* e o domínio da equipe (`<equipe>.cloudflareaccess.com`) para
  `ACCESS_AUD` e `ACCESS_TEAM`, em `vars` do `worker/wrangler.jsonc`.
- Opcional: `IA_EMAILS` (lista separada por vírgulas), que o Worker confere além do Access.

Desenvolvimento local: crie `worker/.dev.vars` (fora do git) com `ANTHROPIC_API_KEY=...` e
`IA_DEV_EMAIL=seu@email`. Depois rode `npx wrangler dev` em `worker/` (porta 8787) e `npm run dev` em `web/`;
o Vite repassa `/api` ao Worker.

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
| gold | indicadores, árvore agregada por UF/Brasil, entes por UF, alertas, validação, manifesto | ~290 MB | R2, lida pelo site |

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
  identificados pela descrição da conta, e só a conta mais alta que casa entra (sem somar conta-mãe
  e subcontas). O FPM aceita a grafia "Participação do Municípios" do ementário (cota de 1% de
  dezembro, 2018–2021). A correspondência por período fica no `manifesto.json` e na página de fontes.
- **UF de estados e DF** vem do código IBGE (a lista de entes da API traz "BR" para eles). No site,
  escolher a UF "DF" mostra o ente Distrito Federal (Brasília não declara como município).
- **Deduções da receita** entram pelo valor absoluto na receita líquida (alguns entes as declaram
  negativas; o teste "sinal das deduções" conta os casos). A árvore mostra os valores como declarados.
- **Intraorçamentárias:** as páginas de despesa usam o total exceto intraorçamentárias (Anexo I-E) e
  mostram o valor intra à parte; saúde e educação são % dessa mesma base.
- **Valores reais** usam o IPCA de dezembro a dezembro, na base do último ano completo; o ano
  parcial (ex.: 2026) traz o número de meses no `manifesto.json`.

### Cobertura e tratamento dos agregados

Os agregados (UF, Brasil, faixas, rankings) somam só os entes com dados no domínio: receita (DCA com
receita bruta > 0), despesa (despesa empenhada > 0) ou patrimônio (balanço declarado). A população do
per capita é a desses mesmos entes. `escopos.parquet` guarda, por exercício, escopo e domínio, os entes
com dados, o universo do cadastro, os sem dados e os excluídos.

A política é única: os totais somam todas as declarações com dados, menos as **inconsistências
objetivas e os erros confirmados**, e só no domínio afetado. Suspeitas estatísticas continuam nos totais,
apenas sinalizadas. A gold guarda também a soma sem nenhuma exclusão (`tratamento = 'declarado'`), usada
para medir o impacto; o site usa `tratamento = 'filtrado'`.

### Validação e sinalizações

`pipeline/validate.py` roda a cada processamento e grava `data/gold/validacao.csv` (resumo com
avaliados, aprovados, reprovados, tolerância e maior divergência) e `validacao_divergencias.csv` (cada
caso reprovado, consultável no site):

- estrutural: as contas de primeiro nível somam o total que o próprio ente declarou;
- estrutural: no balanço, Ativo = Passivo + Patrimônio Líquido;
- informativo: sinal das deduções.

Divergências estruturais de até 1% por grupo são tratadas como da própria declaração; acima disso, o
pipeline para. `pipeline/testes.py` confere as regras da gold (categorias, populações, FPM, ausências).

`data/gold/alertas.parquet` sinaliza receita bruta e despesa empenhada de cada ente-ano:

| Categoria | Regra | Sai dos totais? |
|---|---|---|
| ausente | total nulo ou ≤ 0 na DCA | não é dado: não entra em nenhuma soma |
| suspeita | valor real fora de 1/5 a 5× a mediana real do próprio ente (mín. 5 anos) | não (só sinalizada) |
| inconsistente | > 10× a mediana real **e** acima do PIB municipal do ano | sim, só no domínio |
| validado | revisão manual: atípico legítimo | não |
| confirmado | revisão manual: erro confirmado, com evidência | sim, só no domínio |

Uma suspeita é heurística: pode ser erro ou crescimento legítimo (royalties, receitas extraordinárias),
por isso fica nos totais. Com os dados de 2013–2025, a regra de inconsistência pega 5 ente-anos
(ex.: São João de Meriti declarou R$ 366 bi de receita em 2023; Varginha, R$ 12,9 bi em 2022).
Para registrar uma revisão, acrescente uma linha em `pipeline/alertas_revisados.csv`
(`cod_ibge, exercicio, indicador, categoria, evidencia, fonte, revisado_em`, com categoria `validado`
ou `confirmado`) e rode o `gold.py`. Ao escolher o ente, os valores aparecem como declarados, com aviso.

### Testes

```bash
py pipeline/testes.py      # regras da gold (depois do gold.py)
cd web && npm test         # rotas do site sobre os dados locais (DuckDB-WASM no Node) e funções puras
```

> **Publicação:** o site e os dados mudam juntos. Depois de mudar o formato da gold (como a separação
> por domínio e tratamento), envie os dados ao R2 (`py pipeline/r2.py enviar`) **antes** de publicar
> o código; o site novo não funciona com a gold antiga.

---

## Fontes

- **SICONFI / Tesouro Nacional:** `https://apidatalake.tesouro.gov.br/ords/siconfi/tt/dca`
  ([documentação](https://apidatalake.tesouro.gov.br/docs/siconfi)), limite de 1 requisição por segundo.
- **IBGE:** PIB dos Municípios, tabela SIDRA 5938 (até 2023; setores até 2021).
- **Banco Central:** IPCA mensal, série SGS 433.
- **Portal da Transparência (CGU):** pagamentos do Bolsa Família (até nov/2021), Auxílio Brasil
  (nov/2021–fev/2023) e Novo Bolsa Família (desde mar/2023), arquivos mensais em lote, sem chave
  (`portaldatransparencia.gov.br/download-de-dados/<programa>/AAAAMM`, ~300 MB cada), desde jan/2013.
  `pipeline/familias.py` baixa para uma pasta temporária, soma por município e grava
  `silver/bolsa_familia_mensal/AAAAMM.parquet`; o município vem pelo código SIAFI, convertido ao IBGE por
  `pipeline/siafi_ibge.csv` (nome exato, similaridade revisável ou correspondência manual de municípios
  renomeados). Famílias = NIS distintos pagos em dezembro; valor = soma dos 12 meses do ano.
  Pendente: os arquivos do Auxílio Brasil trazem só o benefício regular, sem o Benefício Extraordinário
  (MP 1.076/2021) que completava o mínimo de R$ 400/R$ 600; por isso o valor anual de 2021 a 2023 fica
  vazio (as famílias estão completas) até haver uma fonte para esse complemento.
- **Ministério da Previdência:** benefícios emitidos pelo INSS por município, dezembro de cada ano
  (`ben_municipios_especie_AAAA.xlsx`), gravados em `silver/inss_municipios.parquet`. Publicados para 2017
  e 2019 em diante; os demais anos ficam em branco (os microdados do INSS começam em jul/2021).
- O painel da pesquisa LAPAM (`.dta`) não é usado pelo pipeline nem pelo site.
