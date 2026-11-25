"""Compatibiliza a dengue do SINAN-Windows (2000-2006) e Net/Online.

Provaveis: notificacoes exceto descartadas (5) e classificadas como chikungunya
(13). Na dengue antiga, 2 significa dengue com complicacoes, nao descarte.
CON_CLASSI/CON_EVOLUC sao os nomes antigos de CLASSI_FIN/EVOLUCAO.

Definicoes: https://dadosabertos.saude.gov.br/dataset/arboviroses-dengue
Transicao: https://sistemas.saude.rj.gov.br/tabnetbd/Sinan/NT_dengue_chik_zika.pdf
"""
from pathlib import Path

CONFIRMADOS = "('1', '2', '3', '4', '10', '11', '12')"


def fonte_dengue(con, base: Path) -> str:
    """Le apenas as variantes existentes; funciona com arquivos antigos ou atuais."""
    consultas=[]
    for arquivo in sorted(Path(base).glob('DENGBR*.parquet')):
        origem = "read_parquet('" + arquivo.as_posix().replace("'", "''") + "', filename=true)"
        colunas = {r[0] for r in con.execute('DESCRIBE SELECT * FROM ' + origem).fetchall()}

        def campo(*nomes):
            partes = [f'nullif(trim(cast("{n}" AS VARCHAR)), \'\')' for n in nomes if n in colunas]
            if not partes:
                return 'NULL::VARCHAR'
            return partes[0] if len(partes) == 1 else 'coalesce(' + ','.join(partes) + ')'

        consultas.append(f"""SELECT 2000 + try_cast(regexp_extract(filename, 'DENGBR([0-9]{{2}})[.]parquet$', 1) AS INTEGER) AS ano,
        try_cast(left(ID_MN_RESI, 6) AS INTEGER) AS municipio,
        {campo('CLASSI_FIN', 'CON_CLASSI')} AS classe,
        {campo('EVOLUCAO', 'CON_EVOLUC')} AS evolucao,
        {'true' if colunas.intersection(('CLASSI_FIN', 'CON_CLASSI')) else 'false'} AS tem_classificacao,
        {'true' if colunas.intersection(('EVOLUCAO', 'CON_EVOLUC')) else 'false'} AS tem_evolucao
        FROM {origem}""")
    if not consultas:
        raise FileNotFoundError(Path(base) / 'DENGBR*.parquet')
    return ' UNION ALL '.join(consultas)


def sql_dengue(fonte: str) -> str:
    """Preserva zeros observados e NULL quando a coluna de origem nao existe."""
    return f"""SELECT ano, municipio, count(*) AS sinan_dengue_notificacoes,
        CASE WHEN bool_or(tem_classificacao) THEN count(*) FILTER (WHERE coalesce(classe, '') NOT IN ('5', '13')) END AS sinan_dengue_provaveis,
        CASE WHEN bool_or(tem_classificacao) THEN count(*) FILTER (WHERE classe IN {CONFIRMADOS}) END AS sinan_dengue_confirmados,
        CASE WHEN bool_or(tem_classificacao) THEN count(*) FILTER (WHERE classe IN ('3', '4', '12')) END AS sinan_dengue_graves,
        CASE WHEN bool_or(tem_classificacao AND tem_evolucao) THEN count(*) FILTER (WHERE classe IN {CONFIRMADOS} AND evolucao = '2') END AS sinan_dengue_obitos
        FROM ({fonte}) GROUP BY ano, municipio"""
