"""Classificação histórica da chikungunya no SINAN (fichas Net e Online).

MS, Nota Informativa 059/2016: ficha antiga 1=confirmado, 2=descartado;
ficha Dengue/Chikungunya 13=confirmado, 5=descartado. Há códigos antigos
residuais depois de 2016, por isso a interpretação não depende só do ano.
Prováveis: todas as notificações, exceto descartadas, incluindo encerramento
em branco/inconclusivo. A fonte continua no ano do arquivo e na residência.

https://portalsinan.saude.gov.br/images/documentos/Agravos/Dengue/Nota_Informativa_059.pdf
https://dadosabertos.saude.gov.br/dataset/arboviroses-febre-de-chikungunya
"""


def sql_chikungunya(fonte: str) -> str:
    """A fonte SQL deve fornecer ano, municipio e CLASSI_FIN (texto)."""
    return f"""
        SELECT ano, municipio,
               count(*) AS sinan_chik_notificacoes,
               count(*) FILTER (WHERE classe IN ('1', '13')) AS sinan_chik_confirmados,
               count(*) FILTER (WHERE coalesce(classe, '') NOT IN ('2', '5')) AS sinan_chik_provaveis,
               count(*) FILTER (WHERE classe IN ('2', '5')) AS sinan_chik_descartados
        FROM (SELECT ano, municipio, trim(CLASSI_FIN) AS classe FROM ({fonte}))
        GROUP BY ano, municipio
    """
