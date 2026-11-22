"""Caged incremental, com ajustes e ocupações prontos, sem recalcular a RAIS.

Preserva uma soma por arquivo de origem também para a CBO: as próximas cargas
podem substituir meses retificados sem precisar baixar o histórico de microdados.
"""
import argparse
import json
import re
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import trabalho
from assistencia_utils import destino_isolado


def agregar_cbo(con, rel, cols, mes, tipo, destino):
    col = lambda *names: trabalho.coluna(cols, *names)
    comp = trabalho.inteiro(col('competenciamov'))
    uf = trabalho.inteiro(col('uf'))
    cbo = col('cbo2002ocupacao')
    s = trabalho.inteiro(col('saldomovimentacao'))
    sal = trabalho.num(col('salario', 'valorsalariofixo'))
    query = f"SELECT {comp} competencia,{uf} uf,substr(trim(cast({cbo} AS VARCHAR)),1,4) cbo_familia,{s} s,{sal} sal FROM {rel}"
    gravar_cbo(con, query, mes, tipo, destino)


def gravar_cbo(con, query, mes, tipo, destino):
    destino.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"""COPY (
      SELECT {mes} arquivo,'{tipo}' tipo,x.competencia,x.uf,coalesce(nullif(x.cbo_familia,''),'????') cbo_familia,
        sum(1) FILTER(WHERE s=1) admissoes,sum(1) FILTER(WHERE s=-1) desligamentos,sum(s) saldo,
        sum(sal) FILTER(WHERE s=1 AND sal BETWEEN .3*sm.valor AND 150*sm.valor) salario_adm_soma,
        count(*) FILTER(WHERE s=1 AND sal BETWEEN .3*sm.valor AND 150*sm.valor) salario_adm_n,
        count(*) FILTER(WHERE s=1 AND NOT coalesce(sal BETWEEN .3*sm.valor AND 150*sm.valor,false)) salario_adm_fora
      FROM ({query}) x LEFT JOIN salario_minimo sm ON sm.aaaamm=x.competencia
      GROUP BY ALL ORDER BY competencia,uf,cbo_familia
    ) TO ? (FORMAT parquet,COMPRESSION zstd)""", [str(destino)])


def gerar(base, brutos, saida, micro_base=None):
    base, brutos = Path(base).resolve(), Path(brutos).resolve()
    saida = destino_isolado(Path(saida), base)
    destino_isolado(saida, brutos)
    if micro_base:
        micro_base = Path(micro_base).resolve()
        destino_isolado(saida,micro_base)
    recent = sorted((brutos/'caged').glob('*/CAGED*.7z'))
    if not recent:
        raise ValueError('nenhum arquivo Caged adquirido')
    for sub in ['caged','caged_cbo']:
        orig=base/'silver/trabalho'/sub
        if orig.exists():
            for src in orig.glob('*.parquet'):
                dst=saida/'silver/trabalho'/sub/src.name;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src,dst)
    for key in ['silver/entes.parquet','gold/manifesto.json']:
        dst=saida/key;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(base/key,dst)
    trabalho.SILVER=saida/'silver';trabalho.SILVER_T=saida/'silver/trabalho';trabalho.GOLD=saida/'gold';trabalho.GOLD_T=saida/'gold/trabalho'
    # fonte_trabalho lê estas constantes do módulo gold quando atualiza o manifesto.
    import gold
    gold.GOLD=trabalho.GOLD;gold.SILVER=trabalho.SILVER
    con=duckdb.connect();con.execute("SET threads=2; SET memory_limit='3GB'; SET preserve_insertion_order=false")
    try:
        trabalho.processar_caged(con,brutos,True,conferir=False)
        # Migração única: a publicação antiga só tinha o total por CBO.
        if micro_base:
            for src in sorted((micro_base/'silver/trabalho/micro/caged').glob('arquivo=*/*.parquet')):
                mes=int(src.parent.name.split('=')[1]);tipo=src.stem;dst=saida/f'silver/trabalho/caged_cbo/{mes}_{tipo}.parquet'
                if dst.exists():continue
                query="SELECT competencia_mov competencia,uf,substr(cbo,1,4) cbo_familia,saldo_movimentacao s,salario::DOUBLE sal FROM read_parquet('"+src.as_posix().replace("'","''")+"')"
                gravar_cbo(con,query,mes,tipo,dst)
                print('CBO histórico '+str(mes)+' '+tipo,flush=True)
        for arq in recent:
            m=re.fullmatch(r'CAGED(MOV|FOR|EXC)(\d{6})\.7z',arq.name,re.I)
            if not m:continue
            tipo,mes=m[1],int(m[2]);dst=saida/f'silver/trabalho/caged_cbo/{mes}_{tipo}.parquet'
            with tempfile.TemporaryDirectory(dir=saida) as tmp:
                txt=trabalho.descompactar(arq,Path(tmp));rel,cols=trabalho.ler_csv(con,txt,'utf-8');agregar_cbo(con,rel,cols,mes,tipo,dst)
            print('CBO recente '+str(mes)+' '+tipo,flush=True)
        regular={p.name for p in (saida/'silver/trabalho/caged').glob('*.parquet')}
        occupation={p.name for p in (saida/'silver/trabalho/caged_cbo').glob('*.parquet')}
        if regular!=occupation:
            raise ValueError('CBO por origem incompleta: '+str(sorted(regular-occupation)))
        trabalho.gerar_gold(con,somente_caged=True)
        source=(saida/'silver/trabalho/caged_cbo/*.parquet').as_posix()
        con.execute(f"""COPY (
          WITH m AS (SELECT x.*,u.uf sigla,CASE WHEN tipo='EXC' THEN -1 ELSE 1 END sinal FROM read_parquet('{source}') x LEFT JOIN estados u ON u.cod=x.uf)
          SELECT competencia,CASE WHEN grouping(sigla)=1 THEN 'BR' ELSE sigla END escopo,cbo_familia,
            sum(sinal*admissoes) admissoes,sum(sinal*desligamentos) desligamentos,sum(sinal*saldo) saldo,
            sum(salario_adm_soma) FILTER(WHERE tipo<>'EXC') salario_adm_soma,
            sum(salario_adm_n) FILTER(WHERE tipo<>'EXC') salario_adm_n,
            sum(salario_adm_fora) FILTER(WHERE tipo<>'EXC') salario_adm_fora
          FROM m GROUP BY GROUPING SETS((competencia,sigla,cbo_familia),(competencia,cbo_familia))
          HAVING escopo IS NOT NULL ORDER BY escopo,cbo_familia,competencia
        ) TO ? (FORMAT parquet,COMPRESSION zstd,ROW_GROUP_SIZE 50000)""",[str(saida/'gold/trabalho/caged_cbo.parquet')])
        trabalho.atualizar_manifesto(con,fontes=['caged','caged_cbo'])
        last=con.execute('SELECT max(competencia) FROM read_parquet(?)',[str(saida/'gold/trabalho/caged.parquet')]).fetchone()[0]
        report=dict(ok=True,ate=last,particoes=len(regular),atualizados=[p.name for p in recent],processado_em=datetime.now(timezone.utc).isoformat())
        (saida/'auditoria_caged.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
        return report
    finally:con.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['base','brutos','saida']:p.add_argument('--'+name,type=Path,required=True)
    p.add_argument('--micro-base',type=Path)
    a=p.parse_args();print(json.dumps(gerar(a.base,a.brutos,a.saida,a.micro_base),ensure_ascii=False))
