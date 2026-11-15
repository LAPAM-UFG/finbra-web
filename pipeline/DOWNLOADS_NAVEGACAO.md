# Downloads: navegação e arquivos prontos

A página começa com conteúdo, localização e formato, seguidos pelo arquivo exato. Há arquivos estáticos para Brasil, 27 UFs e seis temas em cada UF: nenhum filtro executa DuckDB ou varre microdados no navegador. O seletor nunca troca uma UF por Brasil silenciosamente. A seção detalhada identifica explicitamente seus arquivos nacionais.

Uma única busca encontra indicadores por nome/código/descrição, sinônimos usuais (salário/remuneração, Bolsa Família/PBF, PIB) e nomes dos arquivos detalhados. As variáveis encontradas direcionam ao arquivo do tema e UF atuais. Excel aparece primeiro no dicionário, preservado nos três formatos. São 254 indicadores e seis identificadores; escolher um tema mostra suas variáveis. MUNIC/DCA completas continuam disponíveis, da edição mais recente para a mais antiga.

O manifesto próprio mantém os arquivos anteriores, três novos ZIP nacionais (um formato + dicionário/instruções) e referências a 27 catálogos de UF. A abertura busca só esse manifesto (~125 KB sem compressão); um catálogo de UF (~13 KB) só é solicitado ao escolher o local. Prévias e dicionário são carregados sob demanda. Alterações rápidas de UF invalidam a resposta anterior antes de mostrar links.

Cada prévia contém até cinco observações reais de um município, todos os nomes/unidades e a cobertura por coluna no arquivo completo. A tabela mostra uma variável por vez para caber no celular; todos os indicadores podem ser selecionados. Contagens incluem zero/falso como preenchidos e preservam ausências. Cobertura não é um selo de qualidade: as condições e regras do indicador continuam no dicionário. Nenhuma informação dos downloads originais é descartada.

## Preparar e auditar

```powershell
python pipeline/downloads_navegacao.py --origem E:/finbra/candidato_downloads_enxutos_20261114 --saida E:/finbra/candidato_downloads_ux_20261114 --base E:/finbra/data --stata "C:/Program Files/Stata18/StataBE-64.exe"
python pipeline/validar_downloads_navegacao.py --raiz E:/finbra/candidato_downloads_ux_20261114 --origem E:/finbra/candidato_downloads_enxutos_20261114 --relatorio caminho/auditoria.json
python pipeline/testes_downloads_navegacao.py
cd web
npm run test:downloads
npm run build
```

A candidata anterior é apenas lida. A saída deve ser outra pasta, isolada da fonte e do gold publicado. Os novos Stata são declarados e comprimidos sem perda em um lote nativo oculto; os rótulos/códigos são os mesmos da base nacional. O auditor compara integralmente os recortes UF/tema com suas fontes e os Stata com os Parquet, incluindo zeros/nulos/rótulos. Também confere CSV, amostras, anos/cobertura de todas as prévias e conteúdo dos três pacotes.

## Publicar

`objetos(raiz, manifesto)` retorna todos os objetos alcançáveis, incluindo os catálogos e suas prévias; não basta enviar a lista principal `arquivos`. Nesta edição são 856 objetos, dos quais 144 arquivos anteriores são reutilizados. Não publicar pastas genéricas nem usar `--limpar`.

Enviar primeiro os objetos novos, conferir tamanhos/hashes e preservar os antigos. Fazer deploy do código compatível antes de substituir o manifesto próprio, guardando backup. O código também aceita o manifesto anterior durante essa passagem. Não alterar `gold/manifesto.json` nem outros dados. Conferir links públicos, downloads reais, busca, recortes e prévias em 1280/390 px, PT/EN e claro/escuro, incluindo repetição após falha e troca rápida de UF.
