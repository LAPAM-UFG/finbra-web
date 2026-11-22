"""Acrescenta meses do Clima em candidato isolado, preservando o histórico anterior.

Os brutos devem conter os meses a conferir e a mesma malha municipal da base.
Não baixa fontes nem publica. Falhas de cobertura interrompem a geração.
"""
import argparse
import json
import os
from pathlib import Path

import duckdb
import clima
from assistencia_utils import destino_isolado


def gerar(base, brutos, saida, desde):
    base, brutos = Path(base).resolve(), Path(brutos).resolve()
    saida = destino_isolado(Path(saida), base)
    destino_isolado(saida, brutos)
    if not 197901 <= desde <= 999912 or not 1 <= desde % 100 <= 12:
        raise ValueError('competência inicial inválida')
    for name in ['chirps', 'era5']:
        if not (base / f'silver/clima/{name}.parquet').is_file():
            raise ValueError('silver de origem ausente: ' + name)
    trabalho = saida / 'trabalho_clima'
    trabalho.mkdir(parents=True, exist_ok=True)
    clima.BRUTOS = brutos
    clima.SILVER_C = trabalho
    clima.chirps()
    clima.era5()
    reports = {}
    con = duckdb.connect()
    con.execute("SET threads=2; SET memory_limit='3GB'")
    try:
        for name in ['chirps', 'era5']:
            old, new = base / f'silver/clima/{name}.parquet', trabalho / f'{name}.parquet'
            con.execute('CREATE OR REPLACE TABLE anterior AS SELECT * FROM read_parquet(?)', [str(old)])
            con.execute('CREATE OR REPLACE TABLE recente AS SELECT * FROM read_parquet(?) WHERE ano*100+mes >= ?', [str(new), desde])
            periods = con.execute('SELECT DISTINCT ano,mes FROM recente').fetchall()
            if not periods:
                raise ValueError('nenhum mês novo em ' + name)
            if con.execute('SELECT count(*) FROM (SELECT cod,ano,mes,variavel FROM recente GROUP BY ALL HAVING count(*)<>1)').fetchall()[0][0]:
                raise ValueError('chaves repetidas em ' + name)
            expected = con.execute('SELECT variavel,count(DISTINCT cod) n FROM anterior GROUP BY variavel').fetchall()
            for variable, n in expected:
                counts = con.execute('SELECT ano,mes,count(DISTINCT cod) FROM recente WHERE variavel=? GROUP BY ano,mes', [variable]).fetchall()
                if len(counts) != len(periods) or any(k < n for _, _, k in counts):
                    raise ValueError('cobertura regrediu: ' + variable)
            # Só os períodos efetivamente entregues são substituídos; nenhuma lacuna é interpolada.
            con.execute('CREATE OR REPLACE TABLE unido AS SELECT a.* FROM anterior a ANTI JOIN (SELECT DISTINCT ano,mes FROM recente) n USING(ano,mes) UNION ALL SELECT * FROM recente')
            unchanged = con.execute('SELECT count(*) FROM (SELECT * FROM anterior WHERE ano*100+mes < ' + str(desde) + ' EXCEPT ALL SELECT * FROM unido WHERE ano*100+mes < ' + str(desde) + ')').fetchall()[0][0]
            if unchanged:
                raise ValueError('histórico anterior alterado: ' + name)
            dest = saida / f'silver/clima/{name}.parquet'
            dest.parent.mkdir(parents=True, exist_ok=True)
            con.execute('COPY (SELECT * FROM unido ORDER BY cod,ano,mes,variavel) TO ? (FORMAT parquet,COMPRESSION zstd)', [str(dest)])
            reports[name] = dict(periodos=sorted(y*100+m for y,m in periods),novas_linhas=con.execute('SELECT count(*) FROM recente').fetchall()[0][0],historico_preservado=True)
    finally:
        con.close()
    clima.SILVER_C = saida / 'silver/clima'
    clima.GOLD = base / 'gold'
    preparo = saida / 'trabalho_clima_gold'
    clima.gold_clima(preparo, substituir=True)
    for arquivo in (preparo / 'gold').rglob('*'):
        if arquivo.is_file():
            target = saida / arquivo.relative_to(preparo)
            target.parent.mkdir(parents=True, exist_ok=True)
            os.replace(arquivo, target)
    (saida / 'auditoria_clima.json').write_text(json.dumps(dict(ok=True,fontes=reports),ensure_ascii=False,indent=2),encoding='utf-8')
    return reports


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for key in ['base', 'brutos', 'saida']:
        p.add_argument('--'+key, type=Path, required=True)
    p.add_argument('--desde', type=int, required=True)
    a = p.parse_args()
    print(json.dumps(gerar(a.base,a.brutos,a.saida,a.desde),ensure_ascii=False))
