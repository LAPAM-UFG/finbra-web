"""Regressões de conceitos, ausências e agregação do histórico público."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
from cadunico_historico import normalizar, QuadroHistorico, gerar


def amostra():
    cotejo = json.loads(Path(__file__).with_name('referencias').joinpath('cadunico_brasil_cotejo_20261117.json').read_bytes())
    br = {r['competencia']: r['familias'] for r in cotejo['referencias']}
    br.update({202504: br[202505], 202605:42645714, 202606:42876617, 202607:43043156, 202608:43218806})
    meses = [a*100+m for a in range(2018,2027) for m in range(1,13) if a*100+m<=202608]
    mun = pd.DataFrame([{'Cod_Mun':cod,'Referência':f'{p//100}-{p%100:02}-01','Fam_Cad':50,'Pes_Cad':ppl}
        for p in meses for cod,ppl in [(3500105,120),(3500204,180)]])
    nacional = pd.DataFrame([{'Anomes':f'{p//100}-{p%100:02}','BR_CAD_F':br[p]-100 if p<=202104 else br[p],'SP_CAD_F':100} for p in meses])
    return mun,nacional,[3500105,3500204]


class Historico(unittest.TestCase):
    def test_brasil_muda_conceito_sem_duplicar_sp(self):
        m,b,pp=normalizar(*amostra())
        self.assertEqual(b.loc[201801],27294911)
        self.assertEqual(b.loc[202104],29847849)
        self.assertEqual(b.loc[202105],30087195)
        self.assertEqual(b.loc[202608],43218806)
        self.assertEqual(len(pp),104)
        self.assertTrue(pd.isna(b.loc[202504]))
        self.assertTrue(m[m.competencia==202504][['familias','pessoas']].isna().all().all())
        self.assertTrue(m[m.competencia==202505].familias.notna().all())

    def test_zero_publicado_continua_zero(self):
        m,b,c=amostra()
        k=(m['Referência']=='2018-01-01') & (m.Cod_Mun==c[0])
        m.loc[k,['Fam_Cad','Pes_Cad']]=0
        b.loc[b.Anomes=='2018-01','SP_CAD_F']=50
        b.loc[b.Anomes=='2018-01','BR_CAD_F']+=50
        dados,_,_=normalizar(m,b,c)
        self.assertEqual(dados.iloc[0].familias,0)
        self.assertEqual(dados.iloc[0].pessoas,0)

    def test_rejeita_duplicata(self):
        m,b,c=amostra()
        with self.assertRaisesRegex(AssertionError,'repetido'): normalizar(pd.concat([m,m.iloc[:1]]),b,c)

    def test_rejeita_cobertura_municipal_incompleta(self):
        m,b,c=amostra()
        with self.assertRaisesRegex(AssertionError,'incompleta'): normalizar(m.iloc[1:],b,c)

    def test_rejeita_mes_inteiro_ausente(self):
        m,b,c=amostra()
        with self.assertRaisesRegex(AssertionError,'faltam meses'): normalizar(m[m['Referência']!='2019-03-01'],b[b.Anomes!='2019-03'],c)

    def test_rejeita_negativos_fracoes_e_ausencias(self):
        for v in [-1,0.5,np.nan,float('inf')]:
            with self.subTest(valor=v):
                m,b,c=amostra();m['Fam_Cad']=m.Fam_Cad.astype(float);m.loc[0,'Fam_Cad']=v
                with self.assertRaises(AssertionError): normalizar(m,b,c)

    def test_rejeita_pessoas_menores_que_familias(self):
        m,b,c=amostra();m.loc[0,'Pes_Cad']=1
        with self.assertRaisesRegex(AssertionError,'Pessoas menores'): normalizar(m,b,c)

    def test_rejeita_total_nacional_incompativel_com_mds(self):
        m,b,c=amostra();b.loc[b.Anomes=='2021-05','BR_CAD_F']-=100
        with self.assertRaisesRegex(AssertionError,'Total Brasil não confere'): normalizar(m,b,c)

    def test_rejeita_total_sp_incompativel_com_municipios(self):
        m,b,c=amostra();b.loc[0,'SP_CAD_F']+=1
        with self.assertRaisesRegex(AssertionError,'Total SP difere'): normalizar(m,b,c)

    def test_nao_normaliza_mes_nao_publicado_automaticamente(self):
        m,b,c=amostra();m.loc[(m['Referência']=='2025-04-01') & (m.Cod_Mun==c[0]),'Pes_Cad']+=1
        with self.assertRaisesRegex(AssertionError,'04/2025 mudou'): normalizar(m,b,c)

    def test_rejeita_datas_fora_do_primeiro_dia(self):
        m,b,c=amostra();m.loc[0,'Referência']='2018-01-02'
        with self.assertRaises(AssertionError): normalizar(m,b,c)

    def test_regiao_razao_das_somas_brasil_nao_e_soma_de_sp(self):
        v=np.array([[3.,1.,np.nan]])
        n=np.array([[30.,20.,np.nan]])
        d=np.array([[10.,20.,np.nan]])
        c=np.array([[0,0,2]],dtype=np.uint8)
        q=QuadroHistorico(dict(metodo_referencia='razao',fator=1),[202608],v,n,d,c)
        publicado=dict(v=[5.],n=[500.],d=[100.],c=[22],q=[0])
        q.brasil_publicado=copy.deepcopy(publicado)
        self.assertAlmostEqual(q.grupo([0,1])['v'][0],50/30)
        self.assertEqual(q.grupo([0,1,2]),publicado)
        self.assertEqual(q.grupo([0],municipio=True)['v'],[3.])
        retornado=q.grupo([0,1,2]);retornado['v'][0]=999
        self.assertEqual(q.brasil_publicado,publicado)

    def test_destino_sobreposto_recusado_antes_de_escrita(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);fontes=base/'origem';fontes.mkdir();(fontes/'intacto.txt').write_text('preservar')
            antes={p.relative_to(base).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()}
            with self.assertRaises(ValueError): gerar(fontes,base/'revisao',fontes/'novo',Path(__file__).parent.parent)
            self.assertEqual(antes,{p.relative_to(base).as_posix():p.read_bytes() for p in base.rglob('*') if p.is_file()})
            self.assertFalse((fontes/'novo').exists())


if __name__=='__main__': unittest.main()
