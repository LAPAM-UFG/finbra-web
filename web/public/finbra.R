# Cliente Finbra: usa somente o R base. Nenhum pacote \u00e9 instalado ao carregar.
# source("https://finbra-web.luanviniciusbernardelli.workers.dev/finbra.R")
# dados <- finbra(uf = "GO", tema = "saude", anos = 2019:2024)

.finbra_base <- "https://finbra-web.luanviniciusbernardelli.workers.dev/api/dados/v1"
.finbra_ufs <- c("11"="RO","12"="AC","13"="AM","14"="RR","15"="PA","16"="AP","17"="TO","21"="MA","22"="PI","23"="CE","24"="RN","25"="PB","26"="PE","27"="AL","28"="SE","29"="BA","31"="MG","32"="ES","33"="RJ","35"="SP","41"="PR","42"="SC","43"="RS","50"="MS","51"="MT","52"="GO","53"="DF")

finbra_url <- function(uf = NULL, tema = NULL, formato = "rds", base_url = .finbra_base, rede = "todas") {
  if (is.null(uf)) uf <- "BR"
  if (is.null(tema)) tema <- "todos"
  if (!is.character(uf) || length(uf) != 1L || is.na(uf)) stop("uf deve ser uma sigla ou BR.")
  uf <- toupper(trimws(uf))
  if (!uf %in% c("BR", unname(.finbra_ufs))) stop("UF inv\u00e1lida.")
  if (!is.character(tema) || length(tema) != 1L || is.na(tema)) stop("tema deve ser um nome de tema.")
  tema <- tolower(iconv(trimws(tema), to = "ASCII//TRANSLIT"))
  if (is.na(tema) || !tema %in% c("todos","financas","saude","educacao","saneamento","trabalho","gestao","clima","assistencia")) stop("Tema inv\u00e1lido.")
  if (!is.character(formato) || length(formato) != 1L || !formato %in% c("rds","dta","parquet","csv.zip")) stop("Formato inv\u00e1lido.")
  if (!is.character(base_url) || length(base_url) != 1L || is.na(base_url) || !grepl("^https?://",base_url)) stop("base_url deve ser um endere\u00e7o HTTP(S).")
  if (!is.character(rede) || length(rede)!=1L || is.na(rede) || !rede %in% c("todas","publica","municipal","estadual","federal","privada") || (rede!="todas" && tema!="educacao")) stop("Rede de ensino invalida para este tema.")
  paste0(sub("/+$","",base_url),"/painel.",formato,"?uf=",uf,"&tema=",tema,if(rede!="todas") paste0("&rede=",rede) else "")
}

.finbra_ler_rds <- function(endereco, quiet = TRUE) {
  file <- tempfile(fileext = ".rds")
  on.exit(unlink(file), add = TRUE)
  old_timeout <- getOption("timeout")
  options(timeout = max(300, old_timeout))
  on.exit(options(timeout = old_timeout), add = TRUE)
  status <- tryCatch(utils::download.file(endereco,file,mode="wb",quiet=quiet,method="libcurl"),error=function(e) stop("N\u00e3o foi poss\u00edvel obter os dados da API: ",conditionMessage(e),call.=FALSE))
  if (!identical(status,0L) && !identical(status,0)) stop("O download n\u00e3o terminou.")
  readRDS(file)
}

finbra <- function(uf = NULL, tema = NULL, municipio = NULL, anos = NULL, variaveis = NULL, quiet = TRUE, base_url = .finbra_base, rede = "todas") {
  if (!is.null(municipio)) {
    if (!is.numeric(municipio) && !is.character(municipio)) stop("municipio deve conter c\u00f3digos IBGE de sete d\u00edgitos.")
    codes <- as.character(municipio)
    if (!length(codes) || anyNA(codes) || any(!grepl("^[1-9][0-9]{6}$",codes))) stop("C\u00f3digo IBGE inv\u00e1lido: use sete d\u00edgitos.")
    prefixes <- unique(unname(.finbra_ufs[substr(codes,1,2)]))
    if (anyNA(prefixes)) stop("Prefixo de UF inv\u00e1lido no c\u00f3digo IBGE.")
    if (is.null(uf) && length(prefixes)==1L) uf <- prefixes
    if (!is.null(uf) && toupper(uf)!="BR" && any(prefixes!=toupper(uf))) stop("Munic\u00edpio fora da UF escolhida.")
  }
  if (!is.null(anos) && (!is.numeric(anos) || !length(anos) || anyNA(anos) || any(!is.finite(anos) | anos<2013 | anos!=floor(anos)))) stop("anos deve conter anos inteiros desde 2013.")
  if (!is.null(variaveis) && (!is.character(variaveis) || !length(variaveis) || anyNA(variaveis))) stop("variaveis deve conter os nomes das colunas.")
  dados <- .finbra_ler_rds(finbra_url(uf,tema,"rds",base_url,rede),quiet)
  if (!is.data.frame(dados) || !all(c("cod_ibge","ano") %in% names(dados))) stop("Resposta da API n\u00e3o \u00e9 um painel municipal.")
  info <- attr(dados,"finbra")
  if (!is.null(municipio)) dados <- dados[dados$cod_ibge %in% as.numeric(codes),,drop=FALSE]
  if (!is.null(anos)) dados <- dados[dados$ano %in% anos,,drop=FALSE]
  if (!is.null(variaveis)) {
    missing <- setdiff(variaveis,names(dados))
    if (length(missing)) stop("Vari\u00e1veis ausentes no tema: ",paste(missing,collapse=", "))
    keys <- c("cod_ibge","municipio","uf","regiao","tipo_territorio","ano")
    dados <- dados[,unique(c(keys,variaveis)),drop=FALSE]
  }
  if (!is.null(info)) {
    info$filtros_cliente <- list(municipio=municipio,anos=anos,variaveis=variaveis)
    info$dicionario <- info$dicionario[match(names(dados),info$dicionario$variavel),,drop=FALSE]
    for (k in names(dados)) {
      d <- info$dicionario[info$dicionario$variavel==k,,drop=FALSE]
      attr(dados[[k]],"label") <- d$nome[[1]]
      attr(dados[[k]],"unidade") <- d$unidade[[1]]
      attr(dados[[k]],"fonte") <- d$fonte[[1]]
      if("stata_rotulos" %in% names(d)) attr(dados[[k]],"rotulos") <- d$stata_rotulos[[1]]
    }
    attr(dados,"finbra") <- info
  }
  if (!nrow(dados)) warning("Nenhuma observa\u00e7\u00e3o para os filtros escolhidos.",call.=FALSE)
  rownames(dados) <- NULL
  dados
}

finbra_dicionario <- function(tema = NULL, base_url = .finbra_base, quiet = TRUE) {
  d <- .finbra_ler_rds(paste0(sub("/+$","",base_url),"/dicionario.rds"),quiet)
  if (!is.data.frame(d) || !"variavel" %in% names(d)) stop("Dicion\u00e1rio inv\u00e1lido.")
  tema_normalizado <- "todos"
  if (!is.null(tema)) {
    finbra_url(tema=tema,base_url=base_url) # valida o nome sem fazer uma requisi\u00e7\u00e3o
    tema <- tolower(iconv(trimws(tema),to="ASCII//TRANSLIT"))
    tema_normalizado <- tema
    if (tema!="todos") d <- d[d$area %in% c(tema,"identificacao"),,drop=FALSE]
  }
  if (tema_normalizado=="todos" && "arquivo_principal" %in% names(d)) d <- d[is.na(d$arquivo_principal) | d$arquivo_principal,,drop=FALSE]
  d
}
