"""Arquivos leves para o painel de gestão pública, copiados sem transformação dos gold da MUNIC/ESTADIC.

Uso: py pipeline/munic_painel_dados.py --base <raiz-com-gold> --saida <candidato-separado>
O catálogo exato de perguntas é o mesmo do frontend. A fonte só é anunciada enquanto os gold de origem
e os dois arquivos preparados conservam seus hashes. Novas curadorias podem usar o gold completo como fallback.
"""
import argparse
import copy
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
import duckdb

NOMES=('painel_respostas.parquet','painel_agregados.parquet')
ORIGENS=('respostas.parquet','agregados.parquet','catalogo.parquet')

def sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for chunk in iter(lambda:f.read(1<<20),b''):h.update(chunk)
    return h.hexdigest()

def lit(path):return "'"+Path(path).as_posix().replace("'","''")+"'"

def ler_curadoria(path):
    path=Path(path);s=path.read_text(encoding='utf-8-sig')
    if path.suffix=='.json':return json.loads(s)
    m=re.search(r'export const CURADORIA\s*:\s*IndicadorMunic\[\]\s*=\s*(\[.*?\])\s*(?:as\s+IndicadorMunic\[\])?;\s*$',s,re.S)
    if not m:raise ValueError('A curadoria TypeScript precisa ser um array JSON literal; não executamos código na geração.')
    return json.loads(m[1])

def guardar(path,data):
    temp=Path(str(path)+'.parcial')
    temp.write_text(json.dumps(data,ensure_ascii=False,indent=1),encoding='utf-8')
    os.replace(temp,path)

def validar_destinos(base,curadoria,saida):
    origins=[Path(base).resolve(),Path(curadoria).resolve()]
    out=Path(saida).resolve()
    targets=[out,out/'gold',out/'gold/munic',out/'gold/manifesto.json',out/'gold/manifesto.json.parcial',out/'gold/munic/painel_indice.json',out/'gold/munic/painel_indice.json.parcial']
    for name in NOMES:targets += [out/'gold/munic'/name,out/'gold/munic'/(name+'.parcial')]
    for t in targets:
        t=t.resolve()
        for o in origins:
            if t==o or t.is_relative_to(o) or o.is_relative_to(t):raise ValueError(f'destino sobre origem: {t}')

def fonte_painel(pasta):
    """Metadata opcional; dados modificados ou incompletos invalidam o atalho, preservando leitura do gold completo."""
    root=Path(pasta)
    try:
        ind=json.loads((root/'painel_indice.json').read_text(encoding='utf-8'))
        if ind.get('versao')!=1:return {}
        for name in ORIGENS:
            if sha(root/name)!=ind['origem'][name]:return {}
        for name in NOMES:
            if sha(root/name)!=ind['arquivos'][name]['sha256']:return {}
        return {'munic_painel':{'versao':1,'pares':ind['pares'],'indice':'gold/munic/painel_indice.json','processado_em':ind['gerado_em'],
                'arquivos':{name:'gold/munic/'+name for name in NOMES}}}
    except (OSError,ValueError,KeyError,TypeError):return {}

def gerar(base,saida,curadoria):
    base,saida,curadoria=Path(base),Path(saida),Path(curadoria)
    validar_destinos(base,curadoria,saida)
    cfg=ler_curadoria(curadoria)
    refs={}
    for ind in cfg:
        p=ind['pesquisa']
        if p not in ('munic','estadic'):raise ValueError('pesquisa inválida')
        for f in ind['fontes']:
            y,v=f['ano'],f['var']
            if not isinstance(y,int) or not re.fullmatch(r'[A-Za-z0-9_:]+',v):raise ValueError('referência inválida')
            key=(p,y,v)
            if key in refs and refs[key]!=f:raise ValueError('referência ambígua')
            refs[key]=f
    source=base/'gold/munic'
    con=duckdb.connect(config={'threads':2,'memory_limit':'2GB'})
    try:
        cats={(p,y,v):(a,t,r) for p,y,v,a,t,r in con.execute(f'SELECT pesquisa,ano,var,aba,tema,rotulo FROM read_parquet({lit(source/"catalogo.parquet")})').fetchall()}
        for key,f in refs.items():
            if cats.get(key)!=(f['aba'],f['tema'],f['rotulo']):raise ValueError(f'pergunta diferente do catálogo: {key}')
        groups={}
        for p,y,v in refs:groups.setdefault((p,y),[]).append(v)
        where=' OR '.join(f"(pesquisa='{p}' AND ano={y} AND var IN ({','.join(repr(v) for v in sorted(vs))}))" for (p,y),vs in sorted(groups.items()))
        if not where:raise ValueError('curadoria vazia')
        out=saida/'gold/munic';out.mkdir(parents=True,exist_ok=True)
        index={'versao':1,'gerado_em':datetime.now(timezone.utc).isoformat(timespec='seconds'),'curadoria_sha256':sha(curadoria),
               'origem':{n:sha(source/n) for n in ORIGENS},'pares':{},'arquivos':{}}
        for (p,y),vs in sorted(groups.items()):index['pares'].setdefault(p,{})[str(y)]=sorted(vs)
        for name,original,order in [(NOMES[0],'respostas.parquet','pesquisa,cod,ano,var'),(NOMES[1],'agregados.parquet','pesquisa,corte,grupo,ano,var')]:
            temp=out/(name+'.parcial')
            con.execute(f'COPY (SELECT * FROM read_parquet({lit(source/original)}) WHERE {where} ORDER BY {order}) TO {lit(temp)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 2048)')
            fields=[r[0] for r in con.execute(f'DESCRIBE SELECT * FROM read_parquet({lit(temp)})').fetchall()]
            fingerprint=f"count(*),sum(hash({','.join(fields)})::HUGEINT)"
            expected=con.execute(f'SELECT {fingerprint} FROM read_parquet({lit(source/original)}) WHERE {where}').fetchone()
            actual=con.execute(f'SELECT {fingerprint} FROM read_parquet({lit(temp)})').fetchone()
            if actual!=expected:raise ValueError('cópia divergente: '+name)
            os.replace(temp,out/name)
            index['arquivos'][name]={'sha256':sha(out/name),'bytes':(out/name).stat().st_size,'linhas':actual[0]}
        guardar(out/'painel_indice.json',index)
        # A origem pode estar separada da saída: verifica os hashes de ambos antes de anunciar a fonte.
        assert all(sha(source/n)==h for n,h in index['origem'].items())
        manifest=json.loads((base/'gold/manifesto.json').read_text(encoding='utf-8'))
        merged=copy.deepcopy(manifest)
        merged['fontes']['munic_painel']={'versao':1,'pares':index['pares'],'indice':'gold/munic/painel_indice.json','processado_em':index['gerado_em'],
            'arquivos':{name:'gold/munic/'+name for name in NOMES}}
        merged['gerado_em']=index['gerado_em']
        guardar(saida/'gold/manifesto.json',merged)
        return index
    finally:con.close()

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base',required=True);p.add_argument('--saida',required=True)
    p.add_argument('--curadoria',default=str(Path(__file__).resolve().parent.parent/'web/src/munic_curadoria.ts'))
    a=p.parse_args();r=gerar(a.base,a.saida,a.curadoria)
    print(json.dumps(r['arquivos'],ensure_ascii=False))

if __name__=='__main__':main()
