"""Proteções que permitem automatizar fontes sem publicar uma edição incompleta."""
import copy
import hashlib
import io
import json
import tempfile
import unittest
from datetime import datetime,timezone
from pathlib import Path

import pandas as pd
from botocore.exceptions import ClientError
from automacao_catalogo import ROTINAS,selecionar,validar_cobertura,EXISTENTES,DERIVADAS
from automacao_insumos import Insumos,PREFIXO,caminho_relativo
from saneamento_downloads import declarar_stata


class Bucket:
    def __init__(self):self.data={};self.meta={};self.writes=[]
    def head_object(self,Bucket,Key):
        if Key not in self.data:raise ClientError({'Error':{'Code':'404'}},'HeadObject')
        raw=self.data[Key]
        return dict(ContentLength=len(raw),ETag='"'+hashlib.md5(raw).hexdigest()+'"',Metadata=self.meta.get(Key,{}))
    def get_object(self,Bucket,Key):return dict(self.head_object(Bucket,Key),Body=io.BytesIO(self.data[Key]))
    def put_object(self,**kw):
        key=kw['Key'];old=self.data.get(key)
        if kw.get('IfNoneMatch')=='*'and old is not None:raise ValueError('conflito')
        if 'IfMatch'in kw and (old is None or self.head_object(kw['Bucket'],key)['ETag']!=kw['IfMatch']):raise ValueError('conflito')
        raw=kw['Body'];raw=raw if isinstance(raw,bytes)else raw.read()
        self.data[key]=raw;self.meta[key]=kw.get('Metadata',{});self.writes.append(key)


class Automacao(unittest.TestCase):
    def test_calendario_usa_dia_de_brasilia_e_nao_dia_utc(self):
        self.assertEqual([r.id for r in selecionar(agora=datetime(2026,5,2,1,tzinfo=timezone.utc))],['rais'])
        self.assertEqual([r.id for r in selecionar(agora=datetime(2026,5,2,5,tzinfo=timezone.utc))],['ibge'])
        with self.assertRaises(ValueError):selecionar(agora=datetime(2026,5,2))
        self.assertEqual(len(selecionar(['todas'])),len(ROTINAS))
        with self.assertRaises(ValueError):selecionar(['nao_existe'])

    def test_nenhuma_fonte_nova_fica_sem_rotina(self):
        fontes={x:{} for r in ROTINAS for x in r.fontes}
        fontes.update({x:{} for x in EXISTENTES|DERIVADAS})
        self.assertTrue(validar_cobertura(dict(fontes=fontes))['ok'])
        fontes['nova_fonte']={}
        with self.assertRaisesRegex(ValueError,'nova_fonte'):validar_cobertura(dict(fontes=fontes))

    def test_caminho_de_cache_nao_escapa_da_pasta(self):
        for name in ['','../a','/a','gold/../../a','C:/a','a\\b']:
            with self.assertRaises(ValueError):caminho_relativo(name)

    def test_cache_so_confirma_estado_depois_da_ativacao(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);root.mkdir(exist_ok=True);file=root/'agregado.parquet';file.write_bytes(b'agregado')
            client=Bucket();cache=Insumos(client,'b','internet',root)
            self.assertIsNone(cache.ler())
            state=cache.preparar([file],{'fonte':'v1'},{'gold/internet/manifesto.json':'hash'})
            cache.enviar(state)
            self.assertNotIn(cache.chave,client.data)
            self.assertTrue(all(k.startswith(PREFIXO+'objetos/') for k in client.writes))
            cache.enviar(state) # idempotente
            cache.confirmar(state)
            other=Insumos(client,'b','internet',root/'restaurado');self.assertEqual(other.ler(),state)
            other.restaurar();self.assertEqual((root/'restaurado/agregado.parquet').read_bytes(),b'agregado')
            client.data[cache.chave]=b'{"concorrente":true}'
            with self.assertRaises(ValueError):other.confirmar(state)

    def test_cache_corrompido_nao_vira_entrada_valida(self):
        with tempfile.TemporaryDirectory() as t:
            client=Bucket();cache=Insumos(client,'b','saude_sim',Path(t))
            ref=dict(nome='municipios.parquet',bytes=2,sha256=hashlib.sha256(b'{}').hexdigest())
            client.data[PREFIXO+'objetos/'+ref['sha256']]=b'[]'
            with self.assertRaisesRegex(ValueError,'corrompido'):cache.obter(ref)
            self.assertFalse((Path(t)/ref['nome']).exists())

    def test_insumo_modificado_depois_da_validacao_nao_e_enviado(self):
        with tempfile.TemporaryDirectory()as t:
            client=Bucket();root=Path(t);path=root/'dados.parquet';path.write_bytes(b'versao valida')
            cache=Insumos(client,'b','internet',root);state=cache.preparar([path],'assinatura',{})
            path.write_bytes(b'alterada')
            with self.assertRaisesRegex(ValueError,'depois da validação'):cache.enviar(state)
            self.assertEqual(client.writes,[])

    def test_stata_sem_executavel_ainda_recusa_chave_duplicada(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);p=root/'a.dta'
            pd.DataFrame(dict(cod_ibge=[5208707],ano=[2025],valor=[1.5])).to_stata(p,write_index=False,version=118)
            declarar_stata([dict(path=str(p))],root,None)
            pd.DataFrame(dict(cod_ibge=[5208707,5208707],ano=[2025,2025])).to_stata(p,write_index=False,version=118)
            with self.assertRaisesRegex(ValueError,'Chave'):declarar_stata([dict(path=str(p))],root,None)

    def test_assistencia_preserva_historico_e_respeita_celula_protegida_nova(self):
        import pyarrow as pa
        import pyarrow.parquet as pq
        from assistencia import objeto,compacto
        from assistencia_utils import salvar_json
        from automacao_assistencia import combinar
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);base,partial,out=[root/x for x in ('base','partial','out')]
            programs=('cadunico','pbf','bpc')
            for path,revised in ((base,False),(partial,True)):
                dest=path/'gold/assistencia';dest.mkdir(parents=True)
                objects={}
                for program in programs:
                    rows=[dict(indicador=program,competencia=m,valor=v)for m,v in ([(201301,1.),(202610,10.)]if not revised else[(202610,None),(202611,12.)])]
                    p=dest/(program+'.parquet');pq.write_table(pa.Table.from_pylist(rows),p);objects[program]=objeto(p,path)
                record=dict(grupo='M1',series={p:[dict(competencia=m,valores={p:v,**({'outro':99}if not revised else{})},condicoes={p:'protegido'if v is None else'registrado'})for m,v in ([(201301,1.),(202610,10.)]if not revised else[(202610,None),(202611,12.)])]for p in programs})
                series=dest/'abertura.ndjson';series.write_bytes(compacto(record)+b'\n')
                index=dict(territorios=[dict(grupo='M1',nivel='M')],indicadores=[dict(id=p,unidade='número',fonte=p,competencias=[202610,202611]if revised else[201301,202610])for p in programs],arquivo=objeto(series,path),fontes={p:dict(competencias=[202610,202611]if revised else[201301,202610])for p in programs},rankings={p:{}for p in programs})
                ip=dest/'indice.json';salvar_json(ip,index);salvar_json(dest/'qualidade.json',dict(fontes={p:{}for p in programs}))
                salvar_json(path/'gold/manifesto.json',dict(fontes=dict(assistencia=dict(arquivos=objects,abertura=objeto(ip,path),qualidade='gold/assistencia/qualidade.json'))))
            self.assertTrue(combinar(base,partial,out)['ok'])
            source=json.loads((out/'gold/manifesto.json').read_bytes())['fontes']['assistencia']
            idx=json.loads((out/source['abertura']['caminho']).read_bytes())
            record=json.loads((out/idx['arquivo']['caminho']).read_bytes())
            for p in programs:
                rows=record['series'][p]
                self.assertEqual([r['competencia']for r in rows],[201301,202610,202611])
                self.assertEqual(rows[0]['valores'][p],1)
                self.assertIsNone(rows[1]['valores'][p]);self.assertEqual(rows[1]['condicoes'][p],'protegido')
                self.assertEqual(rows[1]['valores']['outro'],99)
                self.assertEqual(rows[2]['valores'][p],12)
                self.assertEqual(pq.read_table(out/source['arquivos'][p]['caminho']).num_rows,3)

    def test_rais_ano_novo_requer_todas_as_ufs_nos_dois_componentes(self):
        import duckdb
        from automacao_nucleo import validar_rais
        ufs=[11,12,13,14,15,16,17,21,22,23,24,25,26,27,28,29,31,32,33,35,41,42,43,50,51,52,53]
        with tempfile.TemporaryDirectory()as d:
            root=Path(d)
            for table in ('rais_vinculos','rais_estab'):
                path=root/f'silver/trabalho/{table}/ano=2027.parquet';path.parent.mkdir(parents=True)
                pd.DataFrame(dict(ano=[2027]*27,municipio=[uf*10000+1 for uf in ufs])).to_parquet(path,index=False)
            with duckdb.connect()as con:
                validar_rais(con,root,[2027])
                path=root/'silver/trabalho/rais_estab/ano=2027.parquet'
                data=pd.read_parquet(path);data.iloc[:-1].to_parquet(path,index=False)
                with self.assertRaisesRegex(ValueError,'UFs ausentes'):validar_rais(con,root,[2027])

    def test_aps_ano_novo_com_mes_ausente_nao_entra_no_cache_nem_no_processamento(self):
        from types import SimpleNamespace
        from unittest.mock import patch
        from automacao_saude_outros import aps
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);base=root/'base';(base/'gold').mkdir(parents=True)
            (base/'gold/manifesto.json').write_text(json.dumps(dict(fontes=dict(aps=dict(anos=[2025])))))
            ctx=SimpleNamespace(base=base,fontes=root/'fontes',mudou=lambda *a,**k:False)
            ctx.fontes.mkdir();ctx.excluir_copia=lambda p:p.unlink(missing_ok=True)
            with patch('automacao_saude_outros.datetime')as clock,patch('aps.pedir',side_effect=lambda serie,comp:[]if comp==202612 else[dict(valor=1)]):
                clock.now.return_value=SimpleNamespace(year=2027)
                self.assertFalse(aps(ctx))
            self.assertEqual(len(ctx.insumos),48)
            self.assertFalse(list(ctx.fontes.rglob('2026*.json')))
            self.assertTrue(all(p.exists()for p in ctx.insumos))

    def test_integridade_em_lotes_recusa_corrupcao_e_referencias_contraditorias(self):
        from atualizacao_artefatos import Snapshot
        from validar_atualizacao import conferir_referencias
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);(root/'gold').mkdir();leaf=root/'gold/dados.parquet';leaf.write_bytes(b'dados corretos')
            ref=dict(caminho='gold/dados.parquet',bytes=leaf.stat().st_size,sha256=hashlib.sha256(leaf.read_bytes()).hexdigest())
            meta=root/'gold/indice.json';meta.write_text(json.dumps(dict(arquivo=ref,repetida=ref)))
            first=dict(caminho='gold/indice.json',bytes=meta.stat().st_size,sha256=hashlib.sha256(meta.read_bytes()).hexdigest())
            snapshot=Snapshot(root/'cache')
            self.assertEqual(len(conferir_referencias(root,snapshot,[first],set(),None)),2)
            leaf.write_bytes(b'dados alterados')
            with self.assertRaisesRegex(ValueError,'corrompido'):conferir_referencias(root,snapshot,[first],set(),None)
            leaf.write_bytes(b'dados corretos')
            meta.write_text(json.dumps(dict(arquivo=ref,repetida={**ref,'sha256':'f'*64})))
            first.update(bytes=meta.stat().st_size,sha256=hashlib.sha256(meta.read_bytes()).hexdigest())
            with self.assertRaisesRegex(ValueError,'incompatíveis'):conferir_referencias(root,snapshot,[first],set(),None)


if __name__=='__main__':unittest.main()
