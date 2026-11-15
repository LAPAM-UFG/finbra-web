# Geração nativa de RDS, a partir de Parquet já publicados e sem alterar fontes.
args <- commandArgs(trailingOnly = TRUE)
stopifnot(length(args) == 2L)
if (!requireNamespace("arrow", quietly = TRUE) || !requireNamespace("jsonlite", quietly = TRUE)) {
  stop("A preparação exige arrow e jsonlite. O usuário dos arquivos RDS não precisa desses pacotes.")
}
plan <- jsonlite::fromJSON(args[[1]], simplifyVector = FALSE)
dictionary <- jsonlite::fromJSON(plan$dicionario, simplifyVector = FALSE)
by_name <- setNames(dictionary, vapply(dictionary, `[[`, "", "variavel"))
flat <- function(entries) {
  fields <- c("variavel", "nome", "descricao", "area", "fonte", "unidade", "tipo", "regra_anual", "observacao", "variavel_original")
  out <- as.data.frame(setNames(lapply(fields, function(k) vapply(entries, function(d) if (is.null(d[[k]])) "" else enc2utf8(as.character(d[[k]])), "")), fields), stringsAsFactors = FALSE)
  for (k in c("ano_de", "ano_ate")) out[[k]] <- vapply(entries, function(d) if (is.null(d[[k]])) NA_integer_ else as.integer(d[[k]]), integer(1))
  out$anos_observados <- I(lapply(entries, function(d) as.integer(unlist(d$anos_observados))))
  out$stata_rotulos <- I(lapply(entries, function(d) d$stata_rotulos))
  out
}
dict_frame <- flat(dictionary)
saveRDS(dict_frame, plan$saida_dicionario, version = 2, compress = "gzip")
stopifnot(identical(dict_frame, readRDS(plan$saida_dicionario)))
result <- vector("list", length(plan$arquivos))
for (i in seq_along(plan$arquivos)) {
  item <- plan$arquivos[[i]]
  data <- as.data.frame(arrow::read_parquet(item$parquet))
  # Base R não representa integer64 sem pacote auxiliar. Estes agregados são
  # exatamente representáveis em double; recusar qualquer conversão com perda.
  for (k in names(data)) {
    if (inherits(data[[k]], "integer64")) {
      numeric <- as.double(data[[k]])
      if (any(abs(numeric) > 2^53, na.rm = TRUE)) stop("Inteiro fora da precisão exata: ", k)
      data[[k]] <- numeric
    }
    d <- by_name[[k]]
    attr(data[[k]], "label") <- enc2utf8(d$nome)
    attr(data[[k]], "unidade") <- enc2utf8(d$unidade)
    attr(data[[k]], "fonte") <- enc2utf8(d$fonte)
  }
  stopifnot(!anyDuplicated(data[c("cod_ibge", "ano")]), all(data$ano >= 2013))
  attr(data, "finbra") <- list(api_versao = "v1", origem_parquet = item$origem, sha256_parquet = item$sha256, base_sha256 = plan$base_sha256, dados_gerados_em = plan$gerado_em, uf = item$uf, tema = item$tema, chave = c("cod_ibge", "ano"), dicionario = dict_frame[match(names(data), dict_frame$variavel), , drop = FALSE])
  saveRDS(data, item$rds, version = 2, compress = "gzip")
  restored <- readRDS(item$rds)
  stopifnot(identical(data, restored))
  # O Parquet de retorno permite uma comparação independente, coluna a coluna.
  plain <- restored
  attr(plain, "finbra") <- NULL
  for (k in names(plain)) attributes(plain[[k]]) <- NULL
  arrow::write_parquet(plain, item$retorno, compression = "zstd")
  result[[i]] <- list(id = item$id, linhas = nrow(data), colunas = ncol(data), tipos = as.list(vapply(data, typeof, "")), rds_bytes = file.info(item$rds)$size)
  cat(jsonlite::toJSON(list(conferido = i, total = length(plan$arquivos), id = item$id), auto_unbox = TRUE), "\n")
  flush.console()
}
jsonlite::write_json(list(ok = TRUE, arquivos = result, versao_r = R.version.string), args[[2]], pretty = TRUE, auto_unbox = TRUE, na = "null")
