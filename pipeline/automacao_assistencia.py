"""Atualiza agregados públicos sem apagar séries já recuperadas do CadÚnico."""
import copy
import hashlib
import json
import os
from datetime import datetime,timezone
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from assistencia import compacto,gravar_hash_json,hash_arquivo,objeto
from assistencia_utils import salvar_json
from automacao_temas import guardar,ler


def combinar(base,parcial,saida):
    """Substitui indicador × competência completos, preservando as demais fontes."""
    m=ler(base/'gold/manifesto.json');source=m['fontes']['assistencia'];pm=ler(parcial/'gold/manifesto.json')['fontes']['assistencia']
    before=ler(base/source['abertura']['caminho']);after=ler(parcial/pm['abertura']['caminho'])
    if {t['grupo']for t in before['territorios']}!={t['grupo']for t in after['territorios']}:raise ValueError('Mudança de universo territorial na assistência')
    dest=saida/'gold/assistencia';dest.mkdir(parents=True)
    catalog={i['id']:copy.deepcopy(i)for i in before['indicadores']}
    for i in after['indicadores']:
        if i['id']in catalog:
            old=catalog[i['id']]
            if(old['unidade'],old['fonte'])!=(i['unidade'],i['fonte']):raise ValueError('Conceito social alterado')
            old['competencias']=sorted(set(old['competencias'])|set(i['competencias']))
        else:catalog[i['id']]=copy.deepcopy(i)
    updated={};objects=copy.deepcopy(source['arquivos'])
    for program in ('cadunico','pbf','bpc'):
        incoming=parcial/pm['arquivos'][program]['caminho'];new=pq.read_table(incoming)
        pairs=set(zip(new['indicador'].to_pylist(),new['competencia'].to_pylist()))
        updated[program]=pairs
        previous=base/source['arquivos'][program]['caminho'];schema=pq.read_schema(previous)
        temp=dest/(program+'_temporario.parquet')
        with pq.ParquetWriter(temp,schema,compression='zstd')as writer:
            for batch in pq.ParquetFile(previous).iter_batches(batch_size=65536):
                keep=[(i,c)not in pairs for i,c in zip(batch.column('indicador').to_pylist(),batch.column('competencia').to_pylist())]
                writer.write_table(pa.Table.from_batches([batch]).filter(pa.array(keep)))
            writer.write_table(new.cast(schema))
        target=dest/(program+'_'+hash_arquivo(temp)[:12]+'.parquet');os.replace(temp,target);objects[program]=objeto(target,saida)
    cp=dest/'catalogo_temporario.parquet';rows=[{**i,'competencias':json.dumps(i['competencias'])}for i in catalog.values()]
    pq.write_table(pa.Table.from_pylist(rows),cp,compression='zstd');target=dest/('catalogo_'+hash_arquivo(cp)[:12]+'.parquet');os.replace(cp,target);objects['catalogo']=objeto(target,saida)
    # A abertura é reconstruída em streaming. Só o lote parcial fica na memória.
    patches={}
    with(parcial/after['arquivo']['caminho']).open('rb')as f:
        for line in f:record=json.loads(line);patches[record['grupo']]=record['series']
    rankings=copy.deepcopy(before['rankings']);rank_rows={p:{c:[]for _,c in pairs}for p,pairs in updated.items()}
    offsets={};temp=dest/'abertura_temporaria.ndjson';territories={t['grupo']:t for t in before['territorios']}
    with(base/before['arquivo']['caminho']).open('rb')as src,temp.open('wb')as out:
        for line in src:
            record=json.loads(line);group=record['grupo']
            for program,pairs in updated.items():
                records={r['competencia']:copy.deepcopy(r)for r in record['series'][program]}
                # Remove a versão anterior inclusive quando a nova célula é protegida.
                for comp,r in records.items():
                    for id in list(r['valores']):
                        if(id,comp)in pairs:r['valores'].pop(id,None);r['condicoes'].pop(id,None)
                for r in patches[group][program]:
                    row=records.setdefault(r['competencia'],dict(competencia=r['competencia'],valores={},condicoes={}))
                    row['valores'].update(r['valores']);row['condicoes'].update(r['condicoes'])
                record['series'][program]=[r for _,r in sorted(records.items())]
                if territories[group]['nivel']!='BR':
                    for comp,bucket in rank_rows[program].items():
                        row=records.get(comp,dict(valores={},condicoes={}))
                        bucket.append(dict(grupo=group,valores=row['valores'],condicoes=row['condicoes']))
            raw=compacto(record)+b'\n';offsets[group]=[out.tell(),len(raw),hashlib.sha256(raw).hexdigest()];out.write(raw)
    target=dest/('abertura_'+hash_arquivo(temp)[:12]+'.ndjson');os.replace(temp,target)
    for program,months in rank_rows.items():
        for comp,rows in months.items():rankings[program][str(comp)]=gravar_hash_json(saida,f'ranking_{program}_{comp}',dict(fonte=program,competencia=comp,linhas=rows))
    fontes=copy.deepcopy(before['fontes'])
    for name,partial in after['fontes'].items():
        periods=sorted(set(fontes[name]['competencias'])|set(partial['competencias']))
        fontes[name]={**partial,'competencias':periods}
    stamp=datetime.now(timezone.utc).isoformat();index=gravar_hash_json(saida,'indice',{**before,'gerado_em':stamp,'indicadores':list(catalog.values()),'arquivo':objeto(target,saida),'grupos':offsets,'rankings':rankings,'fontes':fontes})
    quality=ler(base/source['qualidade']);partialq=ler(parcial/pm['qualidade'])
    quality.update(gerado_em=stamp,abertura=index,arquivos=objects,bytes_abertura=target.stat().st_size,indicadores=len(catalog))
    quality['atualizacao']={'fontes':partialq['fontes'],'politica':'Retificações por indicador e competência; séries anteriores preservadas sem interpolação'}
    salvar_json(dest/'qualidade.json',quality)
    m['fontes']['assistencia']={**source,'atualizado_em':stamp,'indicadores':len(catalog),'fontes':fontes,'arquivos':objects,'abertura':index}
    salvar_json(dest/'fonte.json',m['fontes']['assistencia']);salvar_json(saida/'gold/manifesto.json',m)
    return dict(ok=True,competencias={p:sorted({c for _,c in pairs})for p,pairs in updated.items()},territorios=len(offsets))


def assistencia(ctx):
    import assistencia_cadunico as cad
    import assistencia_perfis as perfis
    import assistencia_download as download
    import assistencia_bpc as bpc
    import assistencia_pbf as pbf
    from assistencia import construir
    partial=ctx.raiz/'parcial';partial.mkdir()
    # Ambas as capturas usam o app EXTERNO com a proteção oficial habilitada.
    cad.carregar(partial,Path(cad.__file__).with_name('assistencia_cadunico_medidas.json'));perfis.carregar(partial)
    download.ipca(partial);months=download.competencias('bpc')[-2:]
    download.download_meses(partial,'bpc',months)
    for comp in months:
        raw=partial/f'landing/assistencia/bpc/{comp}_BPC.zip';bpc.agregar(raw,comp,partial);raw.unlink()
    year=datetime.now(timezone.utc).year
    pbf.baixar(partial,[year-1,year],list(pbf.UFS),forcar=True);pbf.normalizar(partial)
    refs={str(p.relative_to(partial)):hash_arquivo(p)for p in(partial/'silver').rglob('*.parquet')}
    changed=ctx.mudou(refs,vinculos={'assistencia':ler(ctx.base/'gold/manifesto.json')['fontes']['assistencia']},codigo=('assistencia.py','assistencia_cadunico.py','assistencia_perfis.py','assistencia_pbf.py','automacao_assistencia.py'))
    if changed:
        construir(ctx.base,partial,parcial=True)
        out=ctx.raiz/'painel';combinar(ctx.base,partial,out);ctx.aplicar(out,('assistencia',))
    salvar_json(ctx.fontes/'fontes_assistencia.json',refs);guardar(ctx,['fontes_assistencia.json'])
    return changed
