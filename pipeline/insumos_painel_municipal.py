"""Extrai só metadados para o catálogo, sem escrever na base publicada."""
import argparse
import json
from pathlib import Path
import pyarrow.parquet as pq
from assistencia_utils import destino_isolado

if __name__=='__main__':
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--base',type=Path,required=True);ap.add_argument('--saida',type=Path,required=True);args=ap.parse_args()
 root=destino_isolado(args.saida,args.base);work=root/'trabalho_downloads';work.mkdir(parents=True,exist_ok=True)
 manifest=json.loads((args.base/'gold/manifesto.json').read_text(encoding='utf-8-sig'))
 schema=pq.ParquetFile(args.base/'gold/saude/municipios.parquet').schema_arrow
 out=work/'inventario_catalogos.json';out.write_text(json.dumps({'manifesto':manifest,'parquet':[{'path':'gold/saude/municipios.parquet','schema':{f.name:str(f.type) for f in schema}}]},ensure_ascii=False),encoding='utf-8')
 print(str(out))
