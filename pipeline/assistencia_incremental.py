"""Acrescenta pagamentos CGU do PBF, preservando CadÚnico, BPC e folha MDS.

Lê a edição publicada, usa memória limitada a um território por vez e só grava
um candidato separado. Ausências e responsáveis não agregáveis são preservados.
"""
import argparse
import copy
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pyarrow as pa
import pyarrow.parquet as pq
from assistencia import compacto, gravar_hash_json, hash_arquivo, mapa_siafi, objeto
from assistencia_utils import destino_isolado, salvar_json


def ler_ref(base,ref):
    path=base/ref['caminho']
    if path.stat().st_size!=ref['bytes'] or hash_arquivo(path)!=ref['sha256']:
        raise ValueError('fonte não corresponde ao manifesto: '+ref['caminho'])
    return path


def gerar(base, entradas, indices_mensais, saida):
    base=Path(base).resolve();entradas=Path(entradas).resolve();indices_mensais=Path(indices_mensais).resolve()
    saida=destino_isolado(Path(saida),base);destino_isolado(saida,entradas)
    m=json.loads((base/'gold/manifesto.json').read_bytes());old=m['fontes']['assistencia']
    meta=json.loads(ler_ref(base,old['abertura']).read_bytes())
    anterior=ler_ref(base,meta['arquivo']);long=ler_ref(base,old['arquivos']['pbf'])
    quality=json.loads((base/old['qualidade']).read_bytes())
    ipca=json.loads(indices_mensais.read_bytes());indices={int(x['D3C']):float(x['V']) for x in ipca[1:] if x['V'] not in ['-','...','..','X']}
    base_indice=indices[int(m['base_ipca'])*100+12]
    files=sorted(entradas.glob('*.parquet'))
    if not files:raise ValueError('nenhum mês CGU normalizado')
    months=[int(p.stem) for p in files]
    # Primeira implementação só acrescenta meses: retificações precisam de uma
    # carga identificada, não de uma concatenação que duplique observações.
    known=set(next(i['competencias'] for i in meta['indicadores'] if i['id']=='pbf_cgu_valor'))
    if known.intersection(months):raise ValueError('competência já publicada; não concatenar retificação')
    if set(months)-set(indices):raise ValueError('IPCA mensal ausente para os novos pagamentos')
    catalog=copy.deepcopy(meta['indicadores']);ids={'pbf_cgu_valor','pbf_cgu_valor_real','pbf_cgu_parcelas','pbf_cgu_responsaveis'}
    if not ids<={x['id'] for x in catalog}:raise ValueError('catálogo PBF incompatível')
    for item in catalog:
        if item['id'] in ids:item['competencias']=sorted(set(item['competencias'])|set(months))
    territories={t['grupo']:t for t in meta['territorios']};new={};con=duckdb.connect();con.execute("SET threads=2;SET memory_limit='2GB'")
    con.register('mapa',pa.Table.from_pylist(mapa_siafi()))
    try:
        for path,mes in zip(files,months):
            con.execute("CREATE OR REPLACE TABLE pagamentos AS SELECT s.*,m.cod_ibge,coalesce(m.cod_ibge::VARCHAR,'SIAFI:'||s.uf||':'||s.siafi) grupo FROM read_parquet(?) s LEFT JOIN mapa m ON m.uf=s.uf AND m.siafi=lpad(s.siafi,4,'0')",[str(path)])
            records=con.execute("""SELECT CASE WHEN grouping(uf)=1 THEN 'BR' WHEN grouping(grupo)=1 THEN uf ELSE grupo END alvo,
              sum(valor::DECIMAL(18,2))::DOUBLE valor,sum(parcelas)::BIGINT parcelas,
              CASE WHEN grouping(grupo)=0 AND count(DISTINCT programa)=1 AND count(familias)=count(*) THEN sum(familias) ELSE null END::BIGINT responsaveis
              FROM pagamentos GROUP BY GROUPING SETS((uf,grupo),(uf),())""").to_arrow_table().to_pylist()
            entries={}
            for r in records:
                if r['alvo'] not in territories:continue
                values=dict(pbf_cgu_valor=r['valor'],pbf_cgu_valor_real=round(r['valor']*base_indice/indices[mes],2),pbf_cgu_parcelas=r['parcelas'],pbf_cgu_responsaveis=r['responsaveis'])
                entries[r['alvo']]=dict(competencia=mes,valores=values,condicoes={'pbf_cgu_responsaveis':'nao_agregavel'} if r['responsaveis'] is None else {})
            new[mes]=entries
    finally:con.close()
    dest=saida/'gold/assistencia';dest.mkdir(parents=True,exist_ok=True)
    # Longo: escreve os grupos de linhas existentes sem recalcular os valores.
    temp=dest/'pbf_temporario.parquet';pf=pq.ParquetFile(long)
    with pq.ParquetWriter(temp,pf.schema_arrow,compression='zstd') as writer:
        for batch in pf.iter_batches(batch_size=65536):writer.write_batch(batch)
        for mes,entries in new.items():
            rows=[]
            for group,row in entries.items():
                for id,value in row['valores'].items():
                    rows.append(dict(competencia=mes,**{k:territories[group][k] for k in ['grupo','nivel','uf','cod_ibge']},indicador=id,valor=value,condicao=row['condicoes'].get(id,'zero_registrado' if value==0 else 'registrado')))
            writer.write_table(pa.Table.from_pylist(rows,schema=pf.schema_arrow))
    target=dest/('pbf_'+hash_arquivo(temp)[:12]+'.parquet');os.replace(temp,target)
    objects={**old['arquivos'],'pbf':objeto(target,saida)}
    for item in ['cadunico','bpc','catalogo','territorios']:
        if item=='catalogo':
            rows=[{**{k:v for k,v in i.items() if k!='competencias'},'competencias':json.dumps(i['competencias'])} for i in catalog]
            p=dest/'catalogo_temporario.parquet';pq.write_table(pa.Table.from_pylist(rows),p,compression='zstd');t=dest/('catalogo_'+hash_arquivo(p)[:12]+'.parquet');os.replace(p,t);objects[item]=objeto(t,saida)
    rankings=copy.deepcopy(meta['rankings'])
    for mes,entries in new.items():
        rows=[dict(grupo=g,**{k:v for k,v in entries.get(g,dict(valores={},condicoes={})).items() if k!='competencia'}) for g,t in territories.items() if t['nivel']!='BR']
        rankings['pbf'][str(mes)]=gravar_hash_json(saida,f'ranking_pbf_{mes}',dict(fonte='pbf',competencia=mes,linhas=rows))
    temp=dest/'abertura_temporaria.ndjson';offsets={};count=0
    with anterior.open('rb') as src,temp.open('wb') as target_file:
        for line in src:
            record=json.loads(line);group=record['grupo']
            for mes,entries in new.items():
                if group in entries:record['series']['pbf'].append(entries[group])
            record['series']['pbf'].sort(key=lambda r:r['competencia'])
            raw=compacto(record)+b'\n';offsets[group]=[target_file.tell(),len(raw),hashlib.sha256(raw).hexdigest()];target_file.write(raw);count+=1
    if count!=old['territorios']:raise ValueError('universo territorial alterado')
    target=dest/('abertura_'+hash_arquivo(temp)[:12]+'.ndjson');os.replace(temp,target)
    timestamp=datetime.now(timezone.utc).isoformat();fontes=copy.deepcopy(meta['fontes']);fontes['pbf']['competencias']=sorted(set(fontes['pbf']['competencias'])|set(months))
    updated={**meta,'gerado_em':timestamp,'indicadores':catalog,'arquivo':objeto(target,saida),'grupos':offsets,'rankings':rankings,'fontes':fontes}
    index=gravar_hash_json(saida,'indice',updated)
    quality.update(gerado_em=timestamp,abertura=index,arquivos=objects,bytes_abertura=target.stat().st_size)
    quality['fontes']['pbf_cgu']['competencias']=sorted(set(quality['fontes']['pbf_cgu']['competencias'])|set(months))
    quality['fontes']['pbf_cgu']['arquivos'] += [dict(competencia=int(p.stem),sha256=hash_arquivo(p)) for p in files]
    salvar_json(dest/'qualidade.json',quality)
    m['fontes']['assistencia']={**old,'atualizado_em':timestamp,'fontes':fontes,'arquivos':objects,'abertura':index};m['gerado_em']=timestamp
    salvar_json(dest/'fonte.json',m['fontes']['assistencia']);salvar_json(saida/'gold/manifesto.json',m)
    report=dict(ok=True,competencias=months,territorios=count,base_ipca=m['base_ipca'],cadunico_bpc_folha_mds_preservados=True)
    salvar_json(saida/'auditoria_assistencia.json',report);return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for name in ['base','entradas','indices-mensais','saida']:p.add_argument('--'+name,type=Path,required=True)
    a=p.parse_args();print(json.dumps(gerar(a.base,a.entradas,a.indices_mensais,a.saida),ensure_ascii=False))
