"""Valida a edição completa e seu grafo de arquivos antes de ativar os manifestos."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

import duckdb
from atualizacao_artefatos import Snapshot,referencias,sha
from comparacoes_base import compatibilidade_global
from publicacao_lote import PONTEIROS


def gerar(base,publicado,trabalho,caches=()):
    base,publicado,trabalho=map(lambda p:Path(p).resolve(),[base,publicado,trabalho])
    trabalho.mkdir(parents=True,exist_ok=True)
    m=json.loads((base/'gold/manifesto.json').read_bytes());old=json.loads((publicado/'gold/manifesto.json').read_bytes())
    if m['base_ipca']!=old['base_ipca']:raise ValueError('base de preços mudou em atualização parcial')
    downloads=json.loads((base/'gold/downloads/manifesto.json').read_bytes())
    if downloads['base_sha256']!=sha(base/'gold/manifesto.json'):raise ValueError('downloads de outra edição')
    old_dl=json.loads((publicado/'gold/downloads/manifesto.json').read_bytes())
    if downloads['resumo']['variaveis']!=old_dl['resumo']['variaveis']:raise ValueError('quantidade de variáveis principais mudou')
    if downloads['resumo']['ano_de']!=2013:raise ValueError('download principal anterior a 2013')
    opening=json.loads((base/'gold/abertura/manifesto.json').read_bytes())
    work=json.loads((base/'gold/mapas/trabalho_manifesto.json').read_bytes())
    work_hash=hashlib.sha256(json.dumps(opening['trabalho'],sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
    if work['origem']['sha256']!=work_hash:raise ValueError('mapa de trabalho de outra edição')
    for key in ['gold/mapas/trabalho_manifesto.json','gold/mapas/saude_manifesto.json']:
        novo=json.loads((base/key).read_bytes());anterior=json.loads((publicado/key).read_bytes())
        if {x['id'] for x in novo['indicadores']}!={x['id'] for x in anterior['indicadores']}:raise ValueError('indicadores de mapa alterados: '+key)
    cmp=json.loads((base/'gold/comparacoes/manifesto.json').read_bytes());cmp_old=json.loads((publicado/'gold/comparacoes/manifesto.json').read_bytes())
    if not set(cmp_old['catalogos'])<=set(cmp['catalogos']):raise ValueError('catálogo de comparações perdido')
    if cmp['compatibilidade_global']!=compatibilidade_global(m):raise ValueError('comparações de outra edição')
    catalogos={ref['caminho'] for ref in cmp['catalogos'].values()}
    rx=json.loads((base/'gold/raiox/v13_manifesto.json').read_bytes())
    previous='gold/raiox/v13_manifesto.json' if (publicado/'gold/raiox/v13_manifesto.json').is_file() else 'gold/raiox/v12_manifesto.json'
    rxold=json.loads((publicado/previous).read_bytes())
    if rx['indicadores']<rxold['indicadores'] or rx['territorios']<rxold['territorios']:raise ValueError('Raio X perdeu informação')
    if rx['fontes']['comparacoes']['sha256']!=sha(base/'gold/comparacoes/manifesto.json'):raise ValueError('Raio X não acompanha comparações')
    snap=Snapshot(trabalho/'cache',[base,publicado,*caches],copiar_cache=False);pending=[];checked={}
    for key in PONTEIROS:
        p=base/key
        if not p.is_file():raise ValueError('manifesto candidato ausente: '+key)
        pending.append(dict(caminho=key,bytes=p.stat().st_size,sha256=sha(p)))
    for entry in m.get('aberturas',{}).values():
        for key,size,h in [('arquivo','bytes','sha256'),('indice','indice_bytes','indice_sha256')]:
            if isinstance(entry.get(key),str):pending.append(dict(caminho=entry[key],bytes=entry[size],sha256=entry[h]))
    while pending:
        ref=pending.pop();key=ref['caminho']
        if key in checked:
            if checked[key]!=(ref['bytes'],ref['sha256']):raise ValueError('referências incompatíveis: '+key)
            continue
        local=base/key
        if local.is_file():
            if local.stat().st_size!=ref['bytes'] or sha(local)!=ref['sha256']:raise ValueError('candidato corrompido: '+key)
            path=local
        else:path=snap.obter(key,ref)
        checked[key]=(ref['bytes'],ref['sha256'])
        if len(checked)%100==0:print(f'Integridade: {len(checked)} arquivos conferidos',flush=True)
        if key.endswith(('.json','.json.gz')):
            raw=path.read_bytes();obj=json.loads(gzip.decompress(raw) if key.endswith('.gz') else raw)
            if key in catalogos and obj['geografia']!=cmp['geografia']:raise ValueError('catálogo com geografia divergente: '+key)
            pending.extend(referencias(obj))
    con=duckdb.connect()
    try:
        latest=con.execute('SELECT max(competencia) FROM read_parquet(?)',[str(base/'gold/trabalho/caged.parquet')]).fetchall()[0][0]
        if latest!=m['fontes']['caged']['ate']:raise ValueError('Caged não corresponde ao manifesto')
        climate=con.execute('SELECT variavel,max(ano*100+mes) FROM read_parquet(?) GROUP BY 1',[str(base/'gold/clima/mensal.parquet')]).fetchall()
        if len(climate)!=6 or any(x[1]!=m['fontes']['clima']['ate'] for x in climate):raise ValueError('cobertura das seis variáveis do clima divergente')
        for research in ['munic','estadic']:
            year=con.execute('SELECT max(ano) FROM read_parquet(?) WHERE pesquisa=?',[str(base/'gold/munic/catalogo.parquet'),research]).fetchall()[0][0]
            if year!=max(m['fontes'][research]['anos']):raise ValueError('edição de gestão divergente: '+research)
        ambiguous=con.execute('SELECT count(*) FROM (SELECT grupo,ano FROM read_parquet(?) GROUP BY ALL HAVING count(*)<>1)',[str(base/'gold/munic/comparaveis.parquet')]).fetchall()[0][0]
        if ambiguous:raise ValueError('ligação temporal da MUNIC ambígua na mesma edição')
    finally:con.close()
    report=dict(ok=True,manifesto_sha256=sha(base/'gold/manifesto.json'),arquivos_conferidos=len(checked),bytes_conferidos=sum(v[0] for v in checked.values()),base_ipca=m['base_ipca'],caged_ate=latest,clima_ate=m['fontes']['clima']['ate'],variaveis_principais=downloads['resumo']['variaveis'],indicadores_raiox=rx['indicadores'],catalogos_comparacoes=len(cmp['catalogos']))
    (trabalho/'auditoria_edicao.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ['base','publicado','trabalho']:p.add_argument('--'+key,type=Path,required=True)
    a=p.parse_args();print(json.dumps(gerar(a.base,a.publicado,a.trabalho),ensure_ascii=False))
