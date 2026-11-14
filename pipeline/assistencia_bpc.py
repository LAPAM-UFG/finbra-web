"""BPC/CGU: agregação mensal em memória, sem nomes/CPF/NIS nas tabelas intermediárias ou publicadas.

Número de benefícios = NB distintos com parcela na competência; não significa estoque de benefícios ativos
nem pessoas únicas. Competência é a folha; referência identifica a parcela, inclusive retroativos.
Os agregados BR/UF são calculados diretamente dos pagamentos, sem somar contagens municipais distintas.
"""
import argparse
import csv
import hashlib
import json
import os
import re
import time
import unicodedata
import zipfile
from pathlib import Path

import duckdb
import pyarrow.csv as arrow_csv
import pyarrow as pa

from assistencia_utils import destino_isolado, salvar_json, sql_texto

VERSAO = 2
MAPA = Path(__file__).with_name('siafi_ibge.csv')
# Grafias oficiais antigas/alternativas no Portal da Transparência. Pares revisados: não há novo fuzzy match.
GRAFIAS_REVISADAS = {
    ('CE', '1427'): 2306306, ('MG', '4177'): 3108909, ('MG', '4457'): 3122900,
    ('MG', '5303'): 3165206, ('MT', '9139'): 5107008, ('PA', '0377'): 1502954,
    ('PA', '0529'): 1506500, ('PE', '2331'): 2601607, ('PE', '2437'): 2606903,
    ('PE', '2469'): 2608503, ('RJ', '5875'): 3303807, ('RJ', '5917'): 3305901,
    ('RS', '8845'): 4317103, ('TO', '9321'): 1706001,
}


def mapa_siafi():
    result = []
    with MAPA.open(encoding='utf-8', newline='') as stream:
        for row in csv.DictReader(stream):
            code = int(row['cod_ibge'])
            if row['metodo'] == 'similaridade':
                assert GRAFIAS_REVISADAS.get((row['uf'], row['siafi'])) == code, row
            result.append({'uf': row['uf'], 'siafi': row['siafi'].zfill(4), 'cod_ibge': code, 'nome': row['nome_ibge']})
    # Distrito estadual presente no BPC, ausente do cadastro fiscal de declarantes utilizado pelo mapa antigo.
    result.append({'uf': 'PE', 'siafi': '3001', 'cod_ibge': 2605459, 'nome': 'Fernando de Noronha'})
    assert len({(r['uf'], r['siafi']) for r in result}) == len(result)
    return result


def normalizar(value):
    return re.sub(r'[^A-Z0-9]+', '_', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().upper()).strip('_')


def cabecalho(archive: zipfile.ZipFile, member):
    with archive.open(member) as stream:
        line = stream.readline()
    encoding = 'utf-8' if line.startswith(b'\xef\xbb\xbf') else 'latin1'
    names = next(csv.reader([line.decode(encoding).lstrip('\ufeff')], delimiter=';'))
    lookup = {normalizar(n): n for n in names}
    wanted = ['MES_COMPETENCIA', 'MES_REFERENCIA', 'UF', 'CODIGO_MUNICIPIO_SIAFI', 'NOME_MUNICIPIO',
              'NUMERO_BENEFICIO', 'BENEFICIO_CONCEDIDO_JUDICIALMENTE', 'VALOR_PARCELA']
    missing = set(wanted) - lookup.keys()
    if missing:
        raise ValueError(f'Cabeçalho BPC sem campos obrigatórios: {sorted(missing)}')
    return encoding, {key: lookup[key] for key in wanted}


def agregar(arquivo: Path, competencia: int, saida: Path, mapa=None):
    root = destino_isolado(saida)
    assert 201901 <= competencia <= 209912 and 1 <= competencia % 100 <= 12
    dest = root / 'silver/assistencia/bpc'
    dest.mkdir(parents=True, exist_ok=True)
    final = dest / f'{competencia}.parquet'
    temporary = final.with_suffix('.parquet.tmp')
    quality_path = dest / f'{competencia}.json'
    with arquivo.open('rb') as stream:
        sha = hashlib.file_digest(stream, 'sha256').hexdigest()
    mapa_sha=hashlib.sha256(MAPA.read_bytes()).hexdigest()
    if final.exists() and quality_path.exists():
        old = json.loads(quality_path.read_text(encoding='utf-8'))
        if mapa is None and old.get('sha256_origem') == sha and old.get('versao') == VERSAO and old.get('sha256_mapa') == mapa_sha:
            return old
    started = time.monotonic()
    con = duckdb.connect()
    con.execute("SET memory_limit = '3GB'")
    con.execute('SET threads = 2')
    scratch = dest / f'temp_{competencia}'
    scratch.mkdir(exist_ok=True)
    con.execute(f'SET temp_directory = {sql_texto(scratch.as_posix())}')
    map_table = pa.Table.from_pylist(mapa if mapa is not None else mapa_siafi())
    con.register('mapa', map_table)
    try:
        with zipfile.ZipFile(arquivo) as archive:
            members = [i for i in archive.infolist() if i.filename.lower().endswith('.csv')]
            assert len(members) == 1, 'BPC deve conter exatamente um CSV'
            encoding, names = cabecalho(archive, members[0])
            ident = lambda key: '"' + names[key].replace('"', '""') + '"'
            with archive.open(members[0]) as stream:
                reader = arrow_csv.open_csv(stream,
                    read_options=arrow_csv.ReadOptions(encoding=encoding, block_size=2**24, use_threads=False),
                    parse_options=arrow_csv.ParseOptions(delimiter=';'),
                    convert_options=arrow_csv.ConvertOptions(include_columns=list(names.values()), column_types={n: pa.string() for n in names.values()}))
                con.register('entrada', reader)
                # A seleção do Arrow nunca inclui CPF, NIS ou nomes de beneficiários/representantes.
                con.execute(f'''CREATE TABLE base AS SELECT
                    {ident('MES_COMPETENCIA')}::INTEGER AS competencia,
                    {ident('MES_REFERENCIA')}::INTEGER AS referencia,
                    upper(trim({ident('UF')})) AS uf,
                    lpad(trim({ident('CODIGO_MUNICIPIO_SIAFI')}), 4, '0') AS siafi,
                    {ident('NOME_MUNICIPIO')} AS nome_portal,
                    nullif(trim({ident('NUMERO_BENEFICIO')}), '') AS nb,
                    CASE upper(trim({ident('BENEFICIO_CONCEDIDO_JUDICIALMENTE')})) WHEN 'SIM' THEN true WHEN 'NÃO' THEN false WHEN 'NAO' THEN false ELSE null END AS judicial,
                    replace(replace(nullif(trim({ident('VALOR_PARCELA')}), ''), '.', ''), ',', '.')::DECIMAL(18,2) AS valor
                    FROM entrada''')
                con.unregister('entrada')
        assert con.sql('SELECT min(competencia),max(competencia) FROM base').fetchall()[0] == (competencia, competencia), 'Arquivo com competência divergente'
        con.execute('''CREATE VIEW linhas AS SELECT b.*,m.cod_ibge,coalesce(m.nome,b.nome_portal) AS nome,
            coalesce(m.cod_ibge::VARCHAR,'SIAFI:'||b.uf||':'||b.siafi) AS alvo
            FROM base b LEFT JOIN mapa m ON m.uf=b.uf AND m.siafi=b.siafi''')
        query = f'''SELECT {competencia}::INTEGER AS competencia,
            CASE WHEN grouping(uf)=1 THEN 'BR' WHEN grouping(alvo)=1 THEN uf ELSE alvo END AS grupo,
            CASE WHEN grouping(uf)=1 THEN 'BR' WHEN grouping(alvo)=1 THEN 'UF' ELSE 'M' END AS nivel,
            CASE WHEN grouping(uf)=1 THEN null ELSE uf END AS uf,
            CASE WHEN grouping(alvo)=1 THEN null ELSE cod_ibge END AS cod_ibge,
            CASE WHEN grouping(uf)=1 THEN 'Brasil' WHEN grouping(alvo)=1 THEN uf ELSE any_value(nome) END AS nome,
            count(*)::BIGINT AS pagamentos,
            CASE WHEN count(*) FILTER(WHERE nb IS NULL)>0 THEN null ELSE count(DISTINCT nb) END::BIGINT AS beneficios,
            count(DISTINCT nb)::BIGINT AS beneficios_com_identificador,
            count(*) FILTER(WHERE nb IS NULL)::BIGINT AS pagamentos_sem_identificador,
            CASE WHEN count(valor)=count(*) THEN sum(valor) ELSE null END::DECIMAL(20,2) AS valor_pago,
            sum(valor)::DECIMAL(20,2) AS valor_observado,
            count(*) FILTER(WHERE valor IS NULL)::BIGINT AS pagamentos_sem_valor,
            count(DISTINCT nb) FILTER(WHERE referencia={competencia})::BIGINT AS beneficios_referencia_mes,
            count(*) FILTER(WHERE referencia<{competencia})::BIGINT AS pagamentos_retroativos,
            CASE WHEN count(*) FILTER(WHERE referencia<{competencia} AND valor IS NULL)>0 THEN null
                 ELSE coalesce(sum(valor) FILTER(WHERE referencia<{competencia}),0) END::DECIMAL(20,2) AS valor_retroativo,
            count(*) FILTER(WHERE referencia>{competencia})::BIGINT AS pagamentos_referencia_futura,
            CASE WHEN count(judicial)=0 THEN null ELSE count(DISTINCT nb) FILTER(WHERE judicial) END::BIGINT AS beneficios_judiciais,
            count(DISTINCT nb) FILTER(WHERE judicial IS NULL)::BIGINT AS beneficios_judicial_nao_informado,
            CASE WHEN count(judicial)=0 OR count(*) FILTER(WHERE judicial AND valor IS NULL)>0 THEN null
                 ELSE coalesce(sum(valor) FILTER(WHERE judicial),0) END::DECIMAL(20,2) AS valor_judicial
            FROM linhas GROUP BY GROUPING SETS ((uf,alvo,cod_ibge),(uf),())
            ORDER BY nivel,grupo'''
        con.execute(f'COPY ({query}) TO {sql_texto(temporary.as_posix())} (FORMAT PARQUET, COMPRESSION ZSTD)')
        br = con.sql(f"SELECT * FROM read_parquet({sql_texto(temporary.as_posix())}) WHERE grupo='BR'").df().to_dict('records')[0]
        # Só contagens e totais públicos são guardados na qualidade; nenhum identificador individual sai da memória.
        stats = con.sql('''SELECT count(*) AS linhas,count(*) FILTER(WHERE cod_ibge IS NULL) AS linhas_sem_mapa,
                          count(DISTINCT alvo) AS municipios_portal,count(*) FILTER(WHERE judicial IS NULL) AS judicial_ausente,
                          count(*) FILTER(WHERE valor<0) AS parcelas_negativas FROM linhas''').df().to_dict('records')[0]
        unmapped = con.sql('''SELECT uf,siafi,any_value(nome_portal) AS nome,count(*) AS pagamentos
                             FROM linhas WHERE cod_ibge IS NULL GROUP BY uf,siafi ORDER BY uf,siafi''').df().to_dict('records')
        os.replace(temporary, final)
        quality = {'versao': VERSAO, 'competencia': competencia, 'sha256_origem': sha,
                   'sha256_mapa': mapa_sha,
                   'origem': str(arquivo), 'stats': stats, 'sem_correspondencia': unmapped,
                   'brasil': {k: (None if str(v)=='nan' else v) for k,v in br.items()},
                   'segundos': round(time.monotonic()-started,2)}
        salvar_json(quality_path, quality)
        return quality
    finally:
        con.close()
        if scratch.exists() and not any(scratch.iterdir()):
            scratch.rmdir()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--saida', type=Path, required=True)
    parser.add_argument('--mes', type=int, nargs='+')
    parser.add_argument('--acompanhar', action='store_true')
    args = parser.parse_args()
    root = destino_isolado(args.saida)
    wanted=None
    if args.acompanhar:
        catalog=root/'landing/assistencia/bpc/competencias.json'
        expected=args.mes or (json.loads(catalog.read_text(encoding='utf-8'))['competencias'] if catalog.exists() else None)
        if not expected:parser.error('--acompanhar exige --mes ou o catálogo de assistencia_download.py')
        wanted={f'{m}_BPC.zip' for m in expected}
    done = set()
    while True:
        found = sorted((root/'landing/assistencia/bpc').glob('*_BPC.zip'), reverse=True)
        for source in found:
            month = int(source.name[:6])
            if month in done or (args.mes and month not in args.mes):
                continue
            result = agregar(source, month, root)
            done.add(month)
            print(json.dumps({'mes':month,'stats':result['stats'],'brasil':result['brasil'],'segundos':result['segundos']},ensure_ascii=False),flush=True)
        if not args.acompanhar:
            break
        if wanted is not None and wanted.issubset(done):
            break
        time.sleep(4)
