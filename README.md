# FINBRA-web · Finanças municipais (LAPAM)

Site com receitas, despesas e demonstrativos contábeis de municípios, estados e DF, a partir da
**Declaração de Contas Anuais (DCA)** que os entes enviam ao Tesouro Nacional (SICONFI).
Cobre os 7 anexos da DCA de 2013 em diante, mais PIB municipal (IBGE) e IPCA (Banco Central).

```
API SICONFI ─► pipeline (Python) ─► data/ (Parquet) ─► server (Node + DuckDB) ─► web (React)
               landing → bronze → silver → gold          /api/...                  páginas e gráficos
```

| Pasta | O que tem |
|---|---|
| `pipeline/` | extração da API e tratamento em camadas (Python) |
| `data/` | arquivos Parquet gerados pelo pipeline (fora do git) |
| `server/` | API em Node: Fastify + DuckDB lendo os Parquet direto, sem banco de dados |
| `web/` | site em React + Vite + ECharts |

---

## Montar o ambiente local

### 1. Pré-requisitos

| Programa | Versão | Para quê |
|---|---|---|
| [Git](https://git-scm.com/downloads) | qualquer recente | clonar o repositório |
| [Python](https://www.python.org/downloads/) | 3.12 ou mais novo | pipeline de dados |
| [Node.js](https://nodejs.org/) | 22 LTS (mínimo 20.19) | API e site |

Espaço em disco: ~2 GB para a carga completa (13 anos). Uma amostra de uma UF ocupa poucos MB.

> **Windows:** os comandos abaixo usam `py` (o lançador do Python no Windows). No Linux e no macOS, troque por `python3`.

### 2. Clonar e instalar as dependências

```bash
git clone https://github.com/LAPAM-UFG/finbra-web.git
cd finbra-web

# Python (recomendado usar um ambiente virtual)
py -m venv .venv
.venv\Scripts\activate          # Linux/macOS: source .venv/bin/activate
pip install -r pipeline/requirements.txt

# Node
cd server && npm install && cd ..
cd web && npm install && cd ..
```

### 3. Baixar os dados

A API do Tesouro aceita **1 requisição por segundo**, e cada ente leva uma requisição por ano.
A extração é **retomável**: se parar no meio (Ctrl+C, queda de internet, PC desligado), basta
rodar o mesmo comando de novo que ela continua de onde parou.

Escolha uma das opções:

```bash
# A) Amostra rápida para testar: só o Paraná, 2 anos (~15 min)
py pipeline/extract.py --anos 2024 2025 --uf PR

# B) Um ano do Brasil inteiro (~1h50)
py pipeline/extract.py --anos 2025

# C) Carga completa, 2013 a 2025 (~23 h; pode deixar rodando à noite)
py pipeline/extract.py --anos 2013-2025
```

Depois da extração, gere as camadas e rode os testes:

```bash
py pipeline/processar.py
```

O `processar.py` monta bronze, silver e gold, baixa o PIB (IBGE) e o IPCA (Banco Central) e roda
a validação. Ele termina mostrando a tabela de testes; um erro ali interrompe o processo.

> O painel da pesquisa LAPAM (arquivos `.dta`: Bolsa Família, INSS, área, renda) **não está no
> repositório**. Sem ele, o site funciona e essas colunas aparecem vazias. Quem tiver os arquivos
> pode incluí-los com `py pipeline/processar.py --dta "caminho/da/pasta/Revenue"`.

### 4. Subir a API e o site

Em dois terminais:

```bash
# terminal 1: API em http://localhost:3001
cd server
npm start

# terminal 2: site em http://localhost:5180
cd web
npm run dev
```

Abra **http://localhost:5180**. O site acessa a API pela porta 3001 automaticamente.

Para rodar como em produção (site compilado e API na mesma porta):

```bash
cd web && npm run build && cd ..
cd server && npm start           # site + API em http://localhost:3001
```

Variáveis opcionais do servidor: `PORT` (padrão 3001) e `DATA_DIR` (padrão `./data`).

### 5. Atualizar os dados

Os entes podem retificar declarações antigas. Para atualizar os anos recentes:

```bash
py pipeline/extract.py --anos 2024 2025 --atualizar
py pipeline/processar.py --anos 2024 2025
```

Depois, **reinicie a API**: ela guarda as respostas em memória.

---

## Problemas comuns

| Sintoma | Solução |
|---|---|
| `py` não é reconhecido | Instale o Python marcando *Add python.exe to PATH*, ou use `python`. |
| Erro de certificado SSL ao baixar o PIB do IBGE | O servidor do IBGE não envia o certificado intermediário. O pacote `truststore` (já no `requirements.txt`) resolve usando os certificados do sistema. |
| `npm install` falha com erro de *peer dependencies* | O arquivo `web/.npmrc` já liga `legacy-peer-deps`. Confira se rodou o comando dentro de `web/`. |
| `Port 5180 is already in use` / `EADDRINUSE 3001` | Outro processo usa a porta. Feche-o, ou rode a API com `PORT=3002` e ajuste o `proxy` em `web/vite.config.ts`. |
| O site não mostra os dados novos | Reinicie a API depois de rodar o `processar.py`. |
| Páginas vazias | Confira se o ano e a UF escolhidos foram extraídos (ex.: a amostra A só tem o Paraná). |

---

## Como os dados são tratados

### Camadas

| Camada | Conteúdo | Tamanho (13 anos) |
|---|---|---|
| landing | resposta da API por ente e exercício (`ndjson.gz`) | ~1 GB, pode ser apagada |
| bronze | um Parquet por exercício, fiel à API | ~280 MB |
| silver | colunas padronizadas, árvore de contas, população, PIB, IPCA | ~255 MB |
| gold | indicadores por ente e ano, alertas, validação | ~11 MB |

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
- **Valores reais** usam o IPCA de dezembro a dezembro, na base do último ano completo.

### Validação e alertas

`pipeline/validate.py` roda a cada processamento e grava `data/gold/validacao.csv`:

- as contas de primeiro nível somam o total que o próprio ente declarou;
- no balanço, Ativo = Passivo + Patrimônio Líquido.

Divergências de até 1% por grupo são tratadas como erro da própria declaração (ficam listadas em
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

## Próximos passos

- GitHub Actions mensal: rebaixar os dois últimos exercícios e enviar os Parquet ao Cloudflare R2.
- Publicação do site lendo os dados do R2.
