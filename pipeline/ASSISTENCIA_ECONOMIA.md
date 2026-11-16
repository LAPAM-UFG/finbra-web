# Assistência social: pagamentos anuais e PIB

O bloco anual é independente do filtro mensal. Reaproveita os pagamentos nominais
publicados (`pbf_cgu_valor` e `bpc_valor_pago`) e a silver `ibge_pib.parquet`.
Os Parquet sociais e o catálogo territorial precisam coincidir, em tamanho e
SHA-256, com um manifesto de produção fornecido explicitamente. A silver de PIB
é registrada por hash na candidata; `externos.py` já converte mil R$ em R$.

O percentual é `100 × soma dos pagamentos de 12 meses válidos / PIB do mesmo ano`.
Não se anualiza o último mês, não se usa PIB de outro ano e não se aplica IPCA.
UF e Brasil usam o próprio total de pagamentos e a soma do PIB municipal; nunca
uma média simples dos percentuais. O DF é contado uma vez em cada nível.
O percentual compara grandezas e não mede impacto causal ou contribuição
contábil ao PIB. A soma monetária não representa pessoas ou famílias únicas.

A série PBF/CGU inclui as mudanças Bolsa Família/Auxílio Brasil/Novo Bolsa Família
e não inclui o Benefício Extraordinário do Auxílio Brasil: manter a ressalva em
2021–2023. BPC inclui retroativos já presentes no total; não somá-los outra vez.
CadÚnico não tem pagamentos próprios. PIB ausente, PIB zero e pagamentos
incompletos são situações distintas; meses sem registro não são preenchidos.
Nos percentuais exportados, **2 significa 2%**, não uma fração.

```powershell
python pipeline/assistencia_economia.py --base E:/finbra/data --manifesto MANIFESTO_PUBLICADO.json --saida E:/finbra/CANDIDATO_ECONOMIA
python pipeline/testes_assistencia_economia.py
python pipeline/assistencia_economia_downloads.py --base SNAPSHOT_DOWNLOADS --painel E:/finbra/CANDIDATO_ECONOMIA --saida E:/finbra/CANDIDATO_DOWNLOADS --stata STATA.exe --rscript Rscript.exe
```

Os comandos só escrevem nas candidatas isoladas. O bloco usa um manifesto próprio,
um trecho NDJSON por território e índices municipais carregados por UF. O Brasil
e os estados não baixam os índices municipais. O leitor confere Range, tamanho,
SHA-256 e identidade do território. O complemento falhar não bloqueia os números
mensais nem exige inicializar DuckDB/WASM.

O gerador de downloads preserva os valores e colunas anteriores da Assistência,
as referências dos outros temas e a seleção principal de 297 indicadores. Pode
incluir uma chave município/ano antes ausente se o PIB ou os pagamentos trouxerem
informação real, usando os identificadores do cadastro existente. Cria Brasil e
27 UFs em CSV, Parquet, Stata e RDS, com prévias e dicionário. Abre os arquivos no
Stata e R e verifica seu conteúdo; a publicação no R2 é uma etapa separada.

Publicação: guardar os ponteiros anteriores, enviar somente os novos objetos
referenciados e depois `gold/assistencia/economia_manifesto.json` e
`gold/downloads/manifesto.json`. Não substituir objetos com nome de hash, não
excluir objetos anteriores, não alterar `gold/manifesto.json` ou os pagamentos
sociais publicados. Validar os dois ponteiros em produção antes do deploy.

As explicações de família seguem o MDS: uma ou mais pessoas que moram no mesmo
domicílio e compartilham renda ou despesas. Os balões distinguem cadastro, folha,
pagamento, pessoa, família, número de benefício e parcela. A ajuda abre por clique,
toque ou teclado e fecha com Escape ou ao clicar fora; não usa `title`.

Fontes: [definição de família (MDS)](https://www.gov.br/mds/pt-br/acesso-a-informacao/perguntas_frequentes/faq-2013-gst-novas-orientacoes-sobre-documentacao-e-novos-procedimentos-para-cadastramento-de-familias-unipessoais/13-o-que-e-uma),
[pagamentos CGU](https://portaldatransparencia.gov.br/download-de-dados/),
[PIB municipal, SIDRA 5938](https://sidra.ibge.gov.br/tabela/5938).
