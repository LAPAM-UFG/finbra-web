"""Partições fiscais por UF, sem transformar qualquer célula da fonte."""
import hashlib
import json
from pathlib import Path
import pyarrow.compute as pc
import pyarrow.parquet as pq


def gerar(base,saida):
    base,saida=Path(base).resolve(),Path(saida).resolve()
    if base==saida or base.is_relative_to(saida)or saida.is_relative_to(base):raise ValueError('Destino deve ser isolado')
    origem=base/'gold/indicadores.parquet';table=pq.read_table(origem)
    raiz=saida/'gold/financas';raiz.mkdir(parents=True)
    refs={}
    for uf in sorted(set(table['uf'].to_pylist())):
        if not uf or len(uf)!=2:continue
        parte=table.filter(pc.equal(table['uf'],uf));tmp=raiz/f'uf_{uf}.parquet'
        pq.write_table(parte,tmp,compression='zstd',row_group_size=4096)
        assert pq.read_table(tmp).equals(parte),'Partição alterou células'
        digest=hashlib.sha256(tmp.read_bytes()).hexdigest();final=tmp.with_name(f'uf_{uf}_{digest[:16]}.parquet');tmp.rename(final)
        refs[uf]=dict(caminho=final.relative_to(saida).as_posix(),bytes=final.stat().st_size,sha256=digest,linhas=parte.num_rows)
    assert sum(x['linhas']for x in refs.values())==table.num_rows
    m=json.loads((base/'gold/manifesto.json').read_bytes())
    m['particoes_financas']=dict(versao=1,origem_sha256=hashlib.sha256(origem.read_bytes()).hexdigest(),ufs=refs)
    (saida/'gold/manifesto.json').write_text(json.dumps(m,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return dict(ok=True,ufs=len(refs),linhas=table.num_rows,bytes=sum(x['bytes']for x in refs.values()))
