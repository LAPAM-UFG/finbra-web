"""Regressões da curadoria e, com AUDITORIA_BASE, da edição pronta para publicar.

AUDITORIA_CACHES aceita lista JSON de raízes verificadas; nenhuma fonte é alterada
ou baixada. Integridade do grafo completo é verificada por validar_atualizacao.py.
"""
import gzip
import hashlib
import json
import math
import os
import sys
import unittest
import tempfile
from functools import lru_cache
from pathlib import Path

from curadoria_financas import curar, fontes, rotulo_preco
from curadoria_catalogos import curar_definicao, diferenciar_raiox, unidade


class Curadoria(unittest.TestCase):
    @unittest.skipUnless(os.name=='nt','Aliases de namespace do Windows')
    def test_namespace_windows_equivalente_sem_relaxar_contencao(self):
        from atualizacao_artefatos import caminho_resolvido
        with tempfile.TemporaryDirectory()as d:
            raiz=caminho_resolvido(d)
            self.assertEqual(caminho_resolvido('\\\\?\\'+str(raiz)),raiz)
            self.assertTrue(caminho_resolvido(raiz/'arquivo').is_relative_to(raiz))
            self.assertFalse(caminho_resolvido(raiz/'..'/'fora').is_relative_to(raiz))

    def test_ano_usa_fator_publicado_sem_substituir_por_razao_mensal(self):
        from comparacoes import Comparacoes
        c=Comparacoes.__new__(Comparacoes)
        c.base_ipca=2025;c.ipca_anual={2013:1.959,2025:1.0,2026:None}
        c.ipca={201312:50,202511:99,202512:100}
        f=c.fatores([2013,2025,2026,202511])
        self.assertEqual(f[0],1.959);self.assertEqual(f[1],1)
        self.assertTrue(math.isnan(f[2]));self.assertEqual(f[3],100/99)

    def test_precos_sem_base_repetida(self):
        self.assertEqual(rotulo_preco('Remuneração média real (R$ de dez/2025)',2025),'Remuneração média real (R$ de dez/2025)')
        self.assertEqual(rotulo_preco('PIB nominal',2025),'PIB (IPCA dez/2025)')
        self.assertEqual(rotulo_preco('GDP',2025,True),'GDP (Dec/2025 IPCA)')

    def test_fontes_financeiras_proprias(self):
        for campo,esperada in [('se_saude_proprios','SIOPS'),('se_aluno_basica','SIOPE'),('ibge_pib','IBGE')]:
            d=curar(campo,{'variavel':campo})
            self.assertIn(esperada,d['fonte'])
            self.assertIn(esperada,fontes(campo)[0]['nome'])
            self.assertTrue(fontes(campo)[0]['url'].startswith('https://'))
        self.assertNotIn('SIOPE',curar('se_saude_proprios',{})['fonte'])

    def test_intensivo_preserva_unidade_do_original(self):
        d=curar_definicao({'id':'se_aluno_basica','nome':'Investimento por aluno','nome_en':'Investment per pupil','tema':'Finanças e economia','metodo_referencia':'mediana','precos':'reais','unidade':'R$ de dez/2025 por aluno'})
        self.assertEqual(d['unidade_original'],'R$ nominais por aluno')
        self.assertNotIn('nominais',d['unidade'])
        self.assertIn('Não divide novamente',d['descricao'])

    def test_contexto_e_unidades(self):
        self.assertEqual(unidade('Quilogramas por Hectare'),'quilogramas por hectare')
        defs=[{'id':a,'nome':'População de referência','nome_en':'Reference population','area':a,'unidade':'habitantes','fonte_nome':'IBGE','tema':a} for a in ['mobilidade','energia']]
        out=diferenciar_raiox(defs)
        self.assertEqual(len(set(d['nome'] for d in out)),2)
        self.assertEqual([d['id'] for d in out],[d['id'] for d in defs])
        d=curar_definicao({'id':'pbf','nome':'Famílias atendidas no PBF','unidade':'número por 1.000 habitantes','unidade_en':'number per 1,000 residents','unidade_original':'número'})
        self.assertEqual(d['unidade'],'famílias por 1.000 habitantes')
        self.assertEqual(d['unidade_en'],'families per 1,000 residents')
        self.assertEqual(d['unidade_original'],'famílias')
        self.assertEqual(d['unidade_original_en'],'families')


@unittest.skipUnless(os.environ.get('AUDITORIA_BASE'),'Defina AUDITORIA_BASE para validar os dados candidatos')
class Edicao(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base=Path(os.environ['AUDITORIA_BASE'])
        cls.caches=[Path(p) for p in json.loads(os.environ.get('AUDITORIA_CACHES','[]'))]
        import duckdb
        cls.con=duckdb.connect()

    @classmethod
    def tearDownClass(cls):
        cls.con.close()

    @classmethod
    @lru_cache(None)
    def arquivo(cls,key):
        return next((p/key for p in [cls.base,*cls.caches] if (p/key).is_file()),None)

    @classmethod
    def objeto(cls,ref):
        p=cls.arquivo(ref['caminho'])
        if not p:raise AssertionError('Referência local ausente: '+ref['caminho'])
        raw=p.read_bytes()
        if 'sha256'in ref:
            assert len(raw)==ref['bytes'] and hashlib.sha256(raw).hexdigest()==ref['sha256'],ref['caminho']
        return json.loads(gzip.decompress(raw)if ref['caminho'].endswith('.gz')else raw)

    @classmethod
    def raiz(cls,key):return json.loads(cls.arquivo(key).read_bytes())

    @classmethod
    def serie(cls,c,grupo,bucket):
        idx=cls.objeto(c['indices'][bucket]);off,size,digest=idx['grupos'][grupo]
        with cls.arquivo(idx['arquivo']['caminho']).open('rb')as stream:
            stream.seek(off);raw=stream.read(size)
        assert hashlib.sha256(raw).hexdigest()==digest
        return json.loads(raw)

    def test_todos_monetarios_iguais_a_nominal_vezes_fator(self):
        m=self.raiz('gold/comparacoes/manifesto.json');c=self.objeto(m['catalogos']['financas_todas'])
        dl=self.raiz('gold/downloads/manifesto.json')
        ref=next(r for r in dl['arquivos']if r.get('area')=='financas'and r['formato']=='parquet'and not r.get('uf'))
        rows=self.con.execute('SELECT * FROM read_parquet(?) WHERE cod_ibge IN (3509502,3507209,5208707,1400100,3304557)',[str(self.arquivo(ref['caminho']))]).fetchdf().astype(object)
        rows=rows.where(rows.notna(),None)
        orig={(str(int(r['cod_ibge'])),int(r['ano'])):r for r in rows.to_dict('records')}
        fatores=dict(self.con.execute('SELECT exercicio,fator_real FROM read_parquet(?)',[str(self.arquivo('gold/ipca.parquet'))]).fetchall())
        checked=0
        for cod,bucket in [('3509502','SP'),('3507209','SP'),('5208707','GO'),('1400100','RR'),('3304557','RJ')]:
            series=self.serie(c,cod,bucket)
            by_id=dict(zip(series['indicadores'],series['dados']))
            for i in c['indicadores']:
                if i.get('precos')!='reais':continue
                self.assertNotIn('nomina',i['unidade'].lower(),i['id'])
                self.assertTrue(i['fontes'],i['id'])
                s=by_id[i['id']]
                for k,ano in enumerate(i['periodos']):
                    nominal=orig.get((cod,ano),{}).get(i['id']);v=s['v'][k]
                    if nominal is None or fatores.get(ano) is None or v is None:continue
                    esperado=nominal*fatores[ano]
                    exibido=s['r'][k]if i.get('nome_original')else v
                    self.assertTrue(math.isclose(exibido,esperado,rel_tol=2e-10,abs_tol=1e-7),(cod,i['id'],ano,exibido,esperado))
                    if nominal:self.assertTrue(math.isclose(exibido/nominal,fatores[ano],rel_tol=2e-10),(i['id'],ano))
                    if s['n'][k]is not None and s['d'][k]not in [None,0]:self.assertTrue(math.isclose(v,s['n'][k]/s['d'][k]*i.get('fator',1),rel_tol=2e-10,abs_tol=1e-10),(i['id'],ano))
                    checked+=1
        self.assertGreater(checked,1800)
        print('Valores financeiros reais e razões conferidos:',checked,flush=True)

    def test_rotulos_raiox_sem_duplicatas_no_mesmo_universo(self):
        c=self.objeto(self.raiz('gold/raiox/v13_manifesto.json')['catalogo'])
        nomes={}
        for i in c['indicadores']:
            if i.get('rede','todas')not in ['todas','']:continue
            percentual=i.get('formato')=='percentual'or'%'in i['unidade']
            nome=(i.get('nome_original')if not percentual else None)or i['nome']
            nomes.setdefault(nome,[]).append(i['id'])
            if i.get('precos')=='reais':self.assertNotIn('nomina',i['unidade'].lower(),i['id'])
            for campo in ['unidade','unidade_original']:
                self.assertFalse(__import__('re').match(r'^número(?:$| por )',i.get(campo,'')),(i['id'],campo))
        duplicados={n:ids for n,ids in nomes.items()if len(ids)>1}
        self.assertEqual(duplicados,{})

    def test_massa_salarial_original_tem_os_precos_do_rotulo(self):
        c=self.objeto(self.raiz('gold/comparacoes/manifesto.json')['catalogos']['trabalho_todas'])
        s=self.serie(c,'3509502','SP');checked=0
        for i in c['indicadores']:
            if i['id']not in ['massa','massa_real']:continue
            self.assertEqual(i['precos_original'],'reais')
            self.assertNotIn('nomina',i['nome_original'].lower())
            self.assertIn('2025',i['unidade_original'])
            self.assertLessEqual(i['nome_original'].count('IPCA'),1)
            q=s['dados'][s['indicadores'].index(i['id'])]
            for r,n in zip(q['r'],q['n']):
                if r is not None and n is not None:
                    self.assertTrue(math.isclose(r,n,rel_tol=2e-10,abs_tol=1e-7),(i['id'],r,n));checked+=1
        self.assertGreater(checked,20)

    def test_ipca_e_fontes_preservados(self):
        taxa=self.con.execute('SELECT ipca_pct FROM read_parquet(?) WHERE exercicio=2022',[str(self.arquivo('gold/ipca.parquet'))]).fetchone()[0]
        self.assertEqual(taxa,5.79)
        fonte=self.con.execute('SELECT pib FROM read_parquet(?) WHERE cod_ibge=3509502 AND exercicio=2023',[str(self.arquivo('gold/indicadores.parquet'))]).fetchone()[0]
        self.assertEqual(fonte,91968328000)


if __name__=='__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    unittest.main(verbosity=2)
