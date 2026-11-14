"""Perfis públicos do Cadastro Único, com as mesmas medidas protegidas do Observatório externo."""
import argparse
import hashlib
import json
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq
from assistencia_cadunico import QlikPublico, celula, geografia, APP_PUBLICO
from assistencia_utils import destino_isolado, salvar_json

DIMENSOES = ['DS_FAIXA_RENDA_PER_CAPITA','DS_FAIXA_RENDA_PER_CAPITA_SM','DS_MESES_ATUALIZACAO',
             'DS_SITUACAO_DOMICILIO','DS_ESPECIE_DOMICILIO','DS_ARRANJO_FAMILIAR','DS_ARRANJO_QTD_MEMBRO']

def carregar(saida):
    root=destino_isolado(saida); dest=root/'silver/assistencia/cadunico';dest.mkdir(parents=True,exist_ok=True)
    client=QlikPublico()
    try:
        before=client.call(client.doc,'GetAppLayout')
        privacy,_=client.cube(['v_usar_restricao_lgpd','qtd_fam_lgpd','qtd_pes_lgpd'],[])
        assert len(privacy)==1 and [x['qText'] for x in privacy[0]]==['1','100','200'],'A proteção pública deve permanecer habilitada'
        dates,_=client.cube(['anomes','tipo_publicacao'],[])
        months={r[0]['qText'] for r in dates if r[0].get('qElemNumber',-2)>=0}
        assert len(months)==1 and {r[1]['qText'] for r in dates}=={'EXTERNA_PUBLICA'}
        month=int(months.pop().replace('/',''));rows=[]
        for dim in DIMENSOES:
            for level,geo in [('BR',[]),('UF',['sigla_uf']),('M',['codigo_ibge7','sigla_uf','nome_municipio'])]:
                data,_=client.cube(geo+[dim],['JBmfU','PJycVt'])
                for r in data:
                    fam,fc=celula(r[-2]);pes,pc=celula(r[-1])
                    rows.append({'competencia':month,**geografia(geo,r[:len(geo)]),'dimensao':dim,
                                 'categoria':r[len(geo)].get('qText') or 'Não informado','valor_familias':fam,
                                 'condicao_familias':fc,'valor_pessoas':pes,'condicao_pessoas':pc})
            print(json.dumps({'dimensao':dim,'linhas_acumuladas':len(rows)}),flush=True)
        assert len({(r['grupo'],r['dimensao'],r['categoria']) for r in rows})==len(rows)
        assert before==client.call(client.doc,'GetAppLayout'),'App atualizado durante a extração'
        path=dest/f'{month}_perfis.parquet';pq.write_table(pa.Table.from_pylist(rows),path,compression='zstd')
        catalog={d:sorted({r['categoria'] for r in rows if r['dimensao']==d}) for d in DIMENSOES}
        salvar_json(dest/f'{month}_perfis.json',{'competencia':month,'dimensoes':catalog,'app_publico':APP_PUBLICO,
                    'linhas':len(rows),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    finally:client.close()

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--saida',type=Path,required=True)
    carregar(p.parse_args().saida)
