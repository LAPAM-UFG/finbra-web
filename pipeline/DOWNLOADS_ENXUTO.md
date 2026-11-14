# Downloads municipais desde 2013

`/downloads` usa a edição enxuta: **254 variáveis principais e seis identificadores**, somente desde 2013. Brasil, 27 UFs e seis temas têm os mesmos nomes em Stata, CSV e Parquet. MUNIC/DCA completas ficam recolhidas em uma seção opcional; edições anteriores a 2013 não entram na lista.

A abertura lê apenas `gold/downloads/manifesto.json`. A busca carrega o dicionário das 260 colunas principais; o dicionário grande dos complementos é separado. Não se inicia DuckDB. O manifesto global e os pacotes rápidos dos outros painéis são preservados.

## Seleção e interpretação

`downloads_selecao.json` registra cada coluna de origem e seu nome curto, sem colisões e com até 32 caracteres. A seleção prioriza medidas anuais de uso geral e cobertura: saem centenas de recortes de cargo/CNAE, contas individuais e perguntas de uma única edição. Permanecem quantidades e remunerações por raça/cor, escolaridade e três grupos de vínculo da RAIS. PIB e INSS usam suas séries históricas, em vez de cópias condicionadas à entrega da DCA.

Os vazios são preservados. CadÚnico e MUNIC aparecem só nos retratos/edições observados. Não se interpolam pesquisas, não se deduzem células protegidas nem se substituem ausências por zero. O ano em curso pode ser parcial. Meses e condições acompanham estoques sociais; pagamentos anuais têm o número de meses, inclusive nos valores com IPCA. Famílias, pessoas, benefícios e programas são universos distintos.

AB/APS/ACS e metodologias de vacinação ficam separadas. Clima usa o anual e as lacunas publicados; desvios relativos são frações (0,01=1%), e o desvio de umidade do solo é em pontos percentuais. Na DCA, não somar totais e componentes; `_sintetico` sinaliza total reconstruído. Brasília e Noronha são identificadas; ESTADIC e governo DF/código 53 não são replicados como municípios.

## Stata

O `.dta` é formato 118 (Stata 14+), com Unicode e rótulos de variáveis/categorias. `cod_ibge` é inteiro numérico de sete dígitos, `ano` é o ano civil e ambos identificam a linha. CSV/Parquet da base enxuta também usam o código numérico; os complementos conservam os tipos da fonte.

Com `--stata`, uma instância em lote e sem janela executa `isid`, `xtset cod_ibge ano, yearly`, `compress` e `saveold, version(14)` nos 34 arquivos. `compress` altera armazenamento sem perda, sem arredondar remunerações. O manifesto indica painel declarado só após conclusão nativa. Sem executável, o `.dta` é válido e o exemplo `.do` declara o painel.

Strings categóricas dos indicadores recebem códigos com rótulos no Stata; CSV/Parquet mantêm o texto. O dicionário registra a codificação. Nulos lógicos continuam missing, diferentes de falso/zero. Rótulos Stata têm até 80 caracteres; o significado completo fica no dicionário. No pandas, use `convert_dates=False` para ler os números de `ano` sem converter `%ty` em datas.

## Preparação isolada

A entrada é uma **candidata ampla arquivada**, produzida por `painel_municipal.py` e `finalizar_downloads.py` (ver [PAINEL_MUNICIPAL.md](PAINEL_MUNICIPAL.md)). Preserve essa fonte interna para reproduzir a seleção. A saída deve ser outra pasta, sem sobreposição com origem, projeto ou base publicada.

```powershell
python pipeline/downloads_enxuto.py gerar --origem E:/finbra/candidato_downloads_20261114 --saida E:/finbra/candidato_downloads_enxutos_20261114 --base E:/finbra/data --stata "C:/Program Files/Stata18/StataBE-64.exe"
python pipeline/downloads_enxuto.py finalizar --raiz E:/finbra/candidato_downloads_enxutos_20261114 --excel caminho/dicionario_enxuto.xlsx
python pipeline/validar_downloads_enxuto.py --raiz E:/finbra/candidato_downloads_enxutos_20261114 --origem E:/finbra/candidato_downloads_20261114 --relatorio caminho/auditoria.json
python pipeline/testes_downloads_enxuto.py
```

O Excel usa os registros de `trabalho_downloads/dicionario_principal.json`; código e unidade são conferidos antes de registrar. O ZIP principal contém Brasil nos três formatos, dicionário e instruções, sem os complementos grandes. CSV é UTF-8/BOM, ponto e vírgula e decimal com vírgula; texto que poderia virar fórmula recebe apóstrofo. Parquet preserva o original.

## Validação e publicação

O validador compara as colunas principais com a fonte ampla, os recortes com o Brasil e todos os valores dos 34 `.dta` com os Parquet. Confere Unicode, rótulos, datas, chaves, meses, zeros/missings, hashes, cabeçalhos CSV e ZIP. Complementos reutilizados precisam começar em 2013 ou depois.

Publique só os objetos referenciados no manifesto, sem `--limpar` ou upload genérico de gold. Envie arquivos imutáveis primeiro. Como há formatos novos, publique o código compatível e espere o deploy antes de substituir o **manifesto próprio** por último, guardando cópia do anterior. Não altere `gold/manifesto.json` nem os outros dados. Confira links, downloads reais, interface 390/1280 PT/EN claro/escuro e abertura sem motor. A edição é um instantâneo: atualizar dados exige repetir a preparação.
