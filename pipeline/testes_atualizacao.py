"""Proteções da atualização automática, com fontes e R2 simulados."""
import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import duckdb
import pandas as pd
from botocore.exceptions import ClientError

from atualizacao_artefatos import Snapshot, instalar_overlay,referencias
from atualizacao_fontes import anterior, clima_disponivel, gestao_disponivel
from caged_atualizar import gravar_cbo
from munic import grupos_comparaveis
from comparacoes_fontes import Fontes
import gold
import publicacao_lote as pub


class R2:
    def __init__(self,objetos):self.objetos=dict(objetos);self.escritas=[];self.falhar=None
    def get_paginator(self,name):return self
    def paginate(self,Bucket,Prefix):
        yield dict(Contents=[dict(Key=k,Size=len(v),ETag=self.etag(v)) for k,v in self.objetos.items() if k.startswith(Prefix)])
    @staticmethod
    def etag(raw):return '"'+hashlib.md5(raw).hexdigest()+'"'
    def head_object(self,Bucket,Key):
        if Key not in self.objetos:raise ClientError({'Error':{'Code':'404'}},'HeadObject')
        raw=self.objetos[Key];return dict(ContentLength=len(raw),ETag=self.etag(raw),Metadata={'md5':hashlib.md5(raw).hexdigest()})
    def get_object(self,Bucket,Key,**kwargs):return dict(self.head_object(Bucket,Key),Body=io.BytesIO(self.objetos[Key]))
    def put_object(self,**kw):
        key=kw['Key'];old=self.objetos.get(key)
        if kw.get('IfNoneMatch')=='*' and old is not None:raise ValueError('precondição')
        if 'IfMatch' in kw and (old is None or kw['IfMatch']!=self.etag(old)):raise ValueError('precondição')
        if key==self.falhar:raise RuntimeError('interrupção simulada')
        raw=kw['Body'].read();self.objetos[key]=raw;self.escritas.append(key)


class Atualizacao(unittest.TestCase):
    def test_snapshot_http_confere_bytes_originais_e_recusa_mudanca_real(self):
        from requests import Response
        raw=b'{}';tag='"'+hashlib.md5(raw).hexdigest()+'"'
        def resposta(etag):
            r=Response();r.status_code=200;r._content=raw;r._content_consumed=True
            r.headers.update({'Content-Length':str(len(raw)),'ETag':etag});return r
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)
            with patch('atualizacao_artefatos.requests.head',return_value=resposta(tag)) as head,patch('atualizacao_artefatos.requests.get',return_value=resposta(tag)) as get:
                result=Snapshot(root/'ok').obter('gold/a.json');self.assertEqual(result.read_bytes(),raw)
                self.assertEqual(head.call_args.kwargs['headers'],{'Accept-Encoding':'identity'})
                self.assertEqual(get.call_args.kwargs['headers'],{'Accept-Encoding':'identity'})
            with patch('atualizacao_artefatos.requests.head',return_value=resposta(tag)),patch('atualizacao_artefatos.requests.get',return_value=resposta('"outra-versao"')):
                with self.assertRaisesRegex(ValueError,'origem mudou'):Snapshot(root/'mudou').obter('gold/a.json')
                self.assertFalse((root/'mudou/gold/a.json').exists())

    def test_comparacoes_guardam_etag_do_parquet_candidato(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);p=root/'base/gold/munic/painel_respostas.parquet';p.parent.mkdir(parents=True);p.write_bytes(b'candidato')
            f=Fontes(root/'revisao',[root/'base'],overlay=root/'base');f.parquet_publicado('gold/munic/painel_respostas.parquet')
            self.assertEqual(f.refs['gold/munic/painel_respostas.parquet']['etag'],'"'+hashlib.md5(b'candidato').hexdigest()+'"')

    def test_curadoria_liga_tema_renomeado_sem_duplicar_par(self):
        rows=[dict(pesquisa='munic',ano=y,var='P',tipo='categorica',aba=aba,tema=aba,rotulo='Plano diretor')for y,aba in [(2021,'Planejamento'),(2025,'Plano Diretor')]]
        curated=[dict(id='m_plano',pesquisa='munic',fontes=[{k:r[k]for k in ['ano','var','aba','tema','rotulo']}for r in rows])]
        out=grupos_comparaveis(rows,curated);self.assertEqual(len(out),2);self.assertEqual({x['grupo']for x in out},{'curado-m_plano'})
        self.assertEqual(grupos_comparaveis(rows[:1],curated),[])
        curated[0]['fontes'][1]['tema']='Outro'
        with self.assertRaises(ValueError):grupos_comparaveis(rows,curated)

    def test_grafo_inclui_arquivo_e_indice_das_aberturas_clima_e_saude(self):
        refs=list(referencias(dict(clima=dict(arquivo='gold/clima/abertura.ndjson',bytes=4,sha256='a'*64,indice='gold/clima/indice.json',indice_bytes=2,indice_sha256='b'*64))))
        self.assertEqual([r['caminho'] for r in refs],['gold/clima/abertura.ndjson','gold/clima/indice.json'])
        self.assertEqual(list(referencias(dict(arquivo='bruto-local',bytes=1,sha256='a'*64))),[])

    def test_snapshot_multipart_confere_md5_e_nao_rebaixa_cache_valido(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);p=root/'cache/gold/a.parquet';p.parent.mkdir(parents=True);p.write_bytes(b'conteudo')
            client=R2({'gold/a.parquet':b'conteudo'})
            with patch.object(client,'etag',return_value='"multipart-2"'),patch.object(client,'get_object') as get:
                snap=Snapshot(root/'base',[root/'cache']);out=snap.obter_r2(client,'b','gold/a.parquet',dict(bytes=8,etag='"multipart-2"'));self.assertEqual(out.read_bytes(),b'conteudo');get.assert_not_called()

    def test_mesmo_rotulo_nunca_mistura_pessoal_direto_e_indireto(self):
        rows=[dict(pesquisa='munic',aba='RH',tema=tema,rotulo='Total',ano=y,var=var,tipo='numerica') for tema,var in [('Direta','D'),('Indireta','I')] for y in [2024,2025]]
        result=grupos_comparaveis(rows)
        groups={x['var']:x['grupo'] for x in result}
        self.assertEqual(len(result),4);self.assertNotEqual(groups['D'],groups['I'])
        self.assertEqual(sorted(result,key=lambda x:(x['var'],x['ano'])),sorted(grupos_comparaveis(list(reversed(rows))),key=lambda x:(x['var'],x['ano'])))

    def test_janelas_atravessam_ano_sem_mes_zero(self):
        self.assertEqual(anterior(202601,3),[202511,202512,202601])
        self.assertEqual(anterior(202602,1),[202602])
        for m,n in [(202600,3),(202613,3),(202601,0)]:
            with self.assertRaises(ValueError):anterior(m,n)

    def test_snapshot_recusa_traversal_e_chave_vazia(self):
        with tempfile.TemporaryDirectory() as t:
            snap=Snapshot(Path(t)/'base')
            for key in ['', '../gold/a','gold/../../a','/gold/a','landing/a']:
                with self.assertRaises(ValueError):snap.obter(key)
            self.assertEqual(list(Path(t).iterdir()),[])

    def test_snapshot_nao_aceita_cache_corrompido(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);p=root/'gold/a.json';p.parent.mkdir();p.write_bytes(b'alterado')
            with patch('atualizacao_artefatos.requests.get') as net:
                with self.assertRaises(ValueError):Snapshot(root).obter('gold/a.json',dict(bytes=8,sha256='0'*64))
                net.assert_not_called()
            self.assertEqual(p.read_bytes(),b'alterado')

    def test_snapshot_copia_sem_hardlink_e_confere_hash(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);p=root/'cache/gold/a.json';p.parent.mkdir(parents=True);p.write_bytes(b'{}')
            dest=Snapshot(root/'base',[root/'cache']).obter('gold/a.json',dict(bytes=2,sha256=hashlib.sha256(b'{}').hexdigest()))
            dest.write_bytes(b'[]');self.assertEqual(p.read_bytes(),b'{}')

    def test_leitura_sem_copia_conserva_hash_e_evita_duplicar_series(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);p=root/'cache/gold/a.ndjson';p.parent.mkdir(parents=True);p.write_bytes(b'{}\n')
            snap=Snapshot(root/'snapshot',[root/'cache'],copiar_cache=False)
            result=snap.obter('gold/a.ndjson',dict(bytes=3,sha256=hashlib.sha256(b'{}\n').hexdigest()))
            self.assertEqual(result,p);self.assertFalse((root/'snapshot').exists())

    def test_overlay_nao_pode_sobrescrever_origem(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t)/'origem';root.mkdir();p=root/'sentinela';p.write_bytes(b'preservar')
            for dst in [root,root/'sub',root.parent]:
                with self.assertRaises(ValueError):instalar_overlay(root,dst)
            self.assertEqual(list(root.iterdir()),[p])

    def test_base_de_precos_nao_muda_no_fechamento_de_outro_ano(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);(root/'gold').mkdir();(root/'silver').mkdir()
            (root/'gold/manifesto.json').write_text('{"base_ipca":2025}')
            pd.DataFrame(dict(exercicio=[2025,2026],completo=[True,True],indice=[1.,1.1])).to_parquet(root/'silver/ipca.parquet')
            con=duckdb.connect()
            try:
                with patch.object(gold,'GOLD',root/'gold'),patch.object(gold,'SILVER',root/'silver'),patch.dict('os.environ',{},clear=True):
                    self.assertEqual(gold.ano_base_ipca(con),2025)
                    with patch.dict('os.environ',{'FINBRA_BASE_IPCA':'2026'}):self.assertEqual(gold.ano_base_ipca(con),2026)
                    with patch.dict('os.environ',{'FINBRA_BASE_IPCA':'2027'}):
                        with self.assertRaises(ValueError):gold.ano_base_ipca(con)
            finally:con.close()

    def test_cbo_preserva_sinais_e_exclui_salarios_ausentes(self):
        with tempfile.TemporaryDirectory() as t:
            con=duckdb.connect()
            try:
                con.execute('CREATE TABLE salario_minimo(aaaamm INTEGER,valor DOUBLE);INSERT INTO salario_minimo VALUES(202609,1000)')
                query="SELECT * FROM (VALUES(202609,52,'2512',1,2000.),(202609,52,'2512',-1,NULL),(202609,52,'2512',1,0.)) x(competencia,uf,cbo_familia,s,sal)"
                path=Path(t)/'exclusoes.parquet';gravar_cbo(con,query,202609,'EXC',path)
                row=con.execute('SELECT tipo,admissoes,desligamentos,saldo,salario_adm_soma,salario_adm_n,salario_adm_fora FROM read_parquet(?)',[str(path)]).fetchall()[0]
                self.assertEqual(row,('EXC',2,1,1,2000.,1,1))
            finally:con.close()

    def test_fonte_gestao_erro_de_servidor_nao_vira_edicao_anterior(self):
        from requests import Response,HTTPError
        response=Response();response.status_code=503
        with patch('atualizacao_fontes.requests.head',return_value=response):
            with self.assertRaises(HTTPError):gestao_disponivel('munic',2026)

    def test_chuva_em_erro_nao_e_tratada_como_mes_ainda_nao_publicado(self):
        from requests import Response,HTTPError
        catalog=Response();catalog.status_code=200;catalog._content=b'{"extent":{"temporal":{"interval":[[null,"2026-10-31"]]}}}'
        failed=Response();failed.status_code=503;failed._content_consumed=True
        with patch('atualizacao_fontes.requests.get',side_effect=[catalog,failed]):
            with self.assertRaises(HTTPError):clima_disponivel()


class Publicacao(unittest.TestCase):
    def preparar(self,root):
        old={k:b'{"edicao":1}' for k in pub.PONTEIROS}
        for key in pub.PONTEIROS:
            p=root/key;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b'{"edicao":2}')
        return R2(old)

    def test_plano_rejeita_origem_concorrente_antes_de_enviar(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);client=self.preparar(root);expected=pub.inventario(client,'b');client.objetos['gold/manifesto.json']=b'outro'
            with self.assertRaisesRegex(ValueError,'origem mudou'):pub.planejar(client,'b',root,expected)
            self.assertEqual(client.escritas,[])

    def test_falha_apos_primeiro_raiox_preserva_alias_da_edicao_anterior(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);client=self.preparar(root);del client.objetos['gold/raiox/v13_manifesto.json'];client.objetos['gold/raiox/v12_manifesto.json']=b'{"edicao":0}'
            plan=pub.planejar(client,'b',root,pub.inventario(client,'b'));client.falhar='gold/manifesto.json'
            with self.assertRaises(RuntimeError):pub.ativar(client,'b',plan,root/'backup')
            self.assertEqual(client.objetos['gold/raiox/v13_manifesto.json'],client.objetos['gold/raiox/v12_manifesto.json'])
            self.assertEqual(client.objetos['gold/comparacoes/manifesto.json'],b'{"edicao":1}')

    def test_plano_recusa_substituicao_de_imutavel(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);client=self.preparar(root);p=root/'gold/objeto.json';p.write_bytes(b'{}');client.objetos['gold/objeto.json']=b'[]'
            (root/'gold/manifesto.json').write_text(json.dumps(dict(ref=dict(caminho='gold/objeto.json',bytes=2,sha256=hashlib.sha256(b'{}').hexdigest()))))
            with self.assertRaisesRegex(ValueError,'imutável'):pub.planejar(client,'b',root,pub.inventario(client,'b'))

    def test_falha_restaura_todos_os_objetos_ja_substituidos(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);client=self.preparar(root);old=dict(client.objetos);plan=pub.planejar(client,'b',root,pub.inventario(client,'b'));client.falhar='gold/downloads/manifesto.json'
            with self.assertRaises(RuntimeError):pub.ativar(client,'b',plan,root/'backup')
            self.assertEqual(client.objetos,old)
            for key in old:self.assertEqual((root/'backup'/key).read_bytes(),old[key])

    def test_stage_repetivel_e_global_ativado_por_ultimo(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);client=self.preparar(root);path=root/'silver/trabalho/caged_cbo/202609_MOV.parquet';path.parent.mkdir(parents=True);path.write_bytes(b'novo')
            client.objetos['gold/nao_alterado.parquet']=b'intacto';plan=pub.planejar(client,'b',root,pub.inventario(client,'b'))
            pub.stage(client,'b',plan);pub.stage(client,'b',plan)
            self.assertEqual(client.escritas.count('silver/trabalho/caged_cbo/202609_MOV.parquet'),1)
            result=pub.ativar(client,'b',plan,root/'backup');self.assertTrue(result['ok']);self.assertEqual(client.escritas[-1],'gold/manifesto.json');self.assertEqual(client.objetos['gold/nao_alterado.parquet'],b'intacto')

    def test_concorrencia_na_ativacao_nao_recebe_escrita(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);client=self.preparar(root);plan=pub.planejar(client,'b',root,pub.inventario(client,'b'));client.objetos['gold/manifesto.json']=b'mudou'
            with self.assertRaisesRegex(ValueError,'concorrente'):pub.ativar(client,'b',plan,root/'backup')
            self.assertEqual(client.escritas,[])


if __name__=='__main__':unittest.main()
