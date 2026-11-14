# CadÚnico, Bolsa Família e BPC

O painel `/assistencia` abre agregados prontos, sem DuckDB. Evolução, rankings, tabela, CSV/XLSX e gráficos usam o mesmo pacote; a IA lê os mesmos valores nos Parquet `social_*`.

## Fontes e definições

- **CadÚnico:** somente o app público externo do [Observatório do MDS](https://paineis.mds.gov.br/public/extensions/observatorio-do-cadastro-unico/index.html). Usa as medidas públicas originais, com as regras de supressão habilitadas. Totais BR/UF são consultados diretamente; não se reconstrói uma célula protegida por subtração. Os marcadores de PBF/BPC têm referências próprias e não são pagamentos. A API histórica estava em manutenção na primeira aquisição; o primeiro retrato é outubro/2026.
- **PBF/MDS:** [Bolsa em Números](https://www.gov.br/mds/pt-br/acoes-e-programas/bolsa-familia/paginas/bolsa-em-numeros). A competência vem do conteúdo, não só do nome do arquivo. Não se lê a aba auxiliar nacional desatualizada. Arquivos com UF/competência incorretas são rejeitados. Quantidades por tipo só entram quando o título e a fonte da aba confirmam o mês. O total monetário incorreto da planilha não entra. Médias são municipais; nunca média simples entre municípios. Totais UF/BR requerem cobertura municipal completa. Os meses e as UFs ausentes não são preenchidos por zero.
- **PBF/CGU:** pagamentos mensais da silver histórica `bolsa_familia_mensal`, somente lida, e novas competências do [Portal da Transparência](https://portaldatransparencia.gov.br/download-de-dados/novo-bolsa-familia). Inclui a transição Bolsa Família/Auxílio Brasil/Novo Bolsa Família. Novembro/2021 tem dois programas; o Benefício Extraordinário do Auxílio Brasil não está nesta série. Responsáveis distintos por município não são somados como pessoas únicas UF/BR.
- **BPC/CGU:** [arquivos mensais](https://portaldatransparencia.gov.br/download-de-dados/bpc), desde janeiro/2019. NB distintos com pagamento, não pessoas únicas ou estoque ativo. Parcelas retroativas já integram o total. Os dados não distinguem modalidade idoso/deficiência. Judicial ausente não equivale a não judicial. BR/UF têm `distinct` próprio, não soma dos municípios.
- **IPCA:** [SIDRA 1737, variável 2266](https://sidra.ibge.gov.br/tabela/1737), índice mensal. Valores reais são `nominal × índice_dezembro_base / índice_mês`. Sem índice, o real fica ausente. O `ipca.parquet` financeiro não é alterado.

Contagens de famílias, pessoas e benefícios são estoques mensais: não se somam entre meses. Só indicadores monetários explicitamente `acumulavel=true` têm acumulados anuais, com número de meses observado e aviso de parcial. CadÚnico/PBF/BPC se sobrepõem e nunca formam um total único de pessoas.

## Aquisição e preparação

Use a venv do projeto. `--saida` deve ser uma pasta candidata separada do código e da base publicada, inclusive após resolver junctions e `..`. Todos os downloads ficam nela. Não publique `landing/`, arquivos individuais nem os Parquet da quarentena.

```powershell
python pipeline/assistencia_download.py --saida E:/finbra/candidato_assistencia --bpc --ipca
python pipeline/assistencia_bpc.py --saida E:/finbra/candidato_assistencia
python pipeline/assistencia_cadunico.py --saida E:/finbra/candidato_assistencia
python pipeline/assistencia_perfis.py --saida E:/finbra/candidato_assistencia
python pipeline/assistencia_pbf.py tudo --saida E:/finbra/candidato_assistencia
python pipeline/assistencia_pbf_cgu.py --base E:/finbra/data --saida E:/finbra/candidato_assistencia
python pipeline/assistencia.py --base E:/finbra/data --saida E:/finbra/candidato_assistencia
python pipeline/testes_assistencia.py
python pipeline/testes_assistencia_pbf.py
python pipeline/validar_assistencia.py --raiz E:/finbra/candidato_assistencia
```

O parser PBF guarda catálogo, SHA-256, ETag, cobertura e rejeições. O cache evita baixar tudo de novo; para revisões de planilhas antigas, use `--forcar` no download PBF. Os aliases SIAFI antigos são revisados e fixos; não há novo fuzzy match. Se mudar regra de agregação BPC, aumente `VERSAO`. Alterações do CSV de correspondência invalidam o cache.

O catálogo de medidas do CadÚnico contém apenas medidas públicas com a proteção original. Se o MDS mudar o app/IDs/regras, revise o catálogo antes de substituir: nunca desligue variáveis LGPD nem consulte apps internos. As validações devem falhar em vez de contornar uma mudança da fonte.

Dois masters antigos do app usavam `IN_FAMILIA_INDIGENA_FAM`/`IN_FAMILIA_QUILOMBOLA_FAM`, campos ausentes que o Qlik ignorava silenciosamente, retornando o total de famílias. A coleta corrige somente essas referências para `DS_FAM_INDIGENA`/`DS_FAM_QUILOMBOLA`, conserva integralmente a proteção original e confere os resultados com os cubos públicos por categoria. Todo campo de set analysis deve existir. Nulos opacos do CadÚnico são `protegido_ou_ausente`: a resposta pública não permite separar as duas causas; não são zero e não são reconstruídos por subtração.

`assistencia.py --parcial` é exclusivamente de desenvolvimento e é recusado pelo validador de publicação. Nunca envie esse manifesto.

## Pacote e publicação

`gold/assistencia/` recebe Parquet longos por fonte, catálogo, territórios, um NDJSON por território com todas as séries, rankings mensais e índice. Os objetos levam hash no nome. O índice guarda offsets **em bytes UTF-8** e SHA-256 de cada território. O navegador exige Range 206, Content-Range, tamanho e hash corretos; erro não vira zero ou dado antigo. O retrato padrão mostra a última referência **de cada indicador**; comparadores usam o mesmo mês.

`fonte.json` permite a `gold.py` preservar este painel ao refazer as finanças. Não depende do `gerado_em` global: o pacote tem hashes próprios.

**Antes de publicar, gere a abertura de Saúde por último**, pois esse pacote exige o `gerado_em` global exato. Prepare na candidata cópias somente para leitura das cinco origens exigidas por `saude_abertura.py`, e rode-a com saída separada; use o manifesto resultante e o novo índice. Não reconstrua nem envie os cinco Parquet existentes.

Faça backup do manifesto remoto, confira se a base não avançou, e envie somente os objetos referenciados pelo índice/descritor novos, `fonte.json`, `qualidade.json` e o índice da abertura de Saúde. **Dados primeiro; manifesto por último.** Não use upload genérico da candidata, pois ela contém origens auxiliares e pacotes de desenvolvimento. Não use `--limpar`. Confira hashes remotos e objetos anteriores antes de publicar o código.

Validação do site: `npm run build`, `npm test`, `npm run test:assistencia`, `npm run test:saude-abertura`, navegador 1280/390, tema claro/escuro, PT/EN, recortes BR/UF/município/DF/Noronha, meses ausentes, células protegidas, datas diferentes, rankings, CSV/XLSX e consultas SQL da IA. Não faça perguntas pagas à IA só para testar; as consultas podem ser verificadas diretamente no motor.
