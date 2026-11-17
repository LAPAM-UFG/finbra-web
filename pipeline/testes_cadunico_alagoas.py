"""Recusa de universos diferentes, fontes divergentes e agregados falsos."""
import copy
import tempfile
import unittest
from pathlib import Path
import numpy as np
import pandas as pd
from cadunico_alagoas import normalizar, validar_totais, juntar_mensais
from cadunico_historico import QuadroHistorico, gerar


def fonte():
    return pd.DataFrame([dict(co_mun=c, ano=2013, variavel='Cadastro Único',
        inf_categoria=f'Número total de {m} cadastradas no Cadastro Único', inf_subcategoria='Janeiro', valor=v)
        for c,f,p in [(2700102,10,20),(2700201,20,60)] for m,v in [('famílias',f),('pessoas',p)]])


class Alagoas(unittest.TestCase):
    def test_contagens_e_zero_sem_inferencias(self):
        d=fonte();d.loc[d.co_mun==2700102,'valor']=0
        x=normalizar(d,'municipio',[2700102,2700201])
        self.assertEqual(x.iloc[0].familias,0)
        self.assertEqual(x.iloc[1].pessoas,60)
        self.assertEqual(set(x.competencia),{201301})

    def test_rejeita_duplicata_ausencia_universo_e_contagem_invalida(self):
        for tipo in ['duplicata','ausencia','universo','fracao','negativo','pessoas']:
            with self.subTest(tipo=tipo):
                d=fonte()
                if tipo=='duplicata':d=pd.concat([d,d.iloc[:1]])
                elif tipo=='ausencia':d=d.iloc[1:]
                elif tipo=='universo':d['inf_categoria']='Famílias com cadastro atualizado'
                elif tipo=='fracao':d['valor']=d.valor.astype(float);d.loc[0,'valor']=0.5
                elif tipo=='negativo':d.loc[0,'valor']=-1
                else:d.loc[1,'valor']=1
                with self.assertRaises(AssertionError):normalizar(d,'municipio',[2700102,2700201])

    def test_totais_completos_brasil_nunca_e_alagoas(self):
        m=normalizar(fonte(),'municipio',[2700102,2700201])
        u=pd.DataFrame([dict(codigo=27,competencia=201301,familias=30,pessoas=80),dict(codigo=52,competencia=201301,familias=70,pessoas=120)])
        r=pd.DataFrame([dict(codigo=1,competencia=201301,familias=100,pessoas=200)])
        cotejo={'referencias':[dict(competencia=201301,familias=100)]}
        br,n=validar_totais(m,u,r,cotejo)
        self.assertEqual((br.loc[201301,'familias'],n),(100,1))
        for campo in ['familias','pessoas']:
            alterada=u.copy();alterada.loc[0,campo]+=1
            with self.assertRaises(AssertionError):validar_totais(m,alterada,r,cotejo)
        with self.assertRaises(AssertionError):validar_totais(m,u.iloc[:1],r,cotejo)
        with self.assertRaisesRegex(AssertionError,'Brasil diverge'):validar_totais(m,u,r,{'referencias':[dict(competencia=201301,familias=30)]})

    def test_unificar_so_sobreposicoes_iguais_e_ausencias_preservadas(self):
        a=pd.DataFrame([dict(territorio='BR',municipio='Brasil',uf='',ano=2018,mes=1,familias=100.,pessoas=np.nan,fonte='Seade'),
                        dict(territorio='BR',municipio='Brasil',uf='',ano=2025,mes=4,familias=np.nan,pessoas=np.nan,fonte='Seade')])
        b=a.iloc[:1].copy();b['pessoas']=200.;b['fonte']='SEPLAG/AL'
        d=juntar_mensais([a,b]);self.assertEqual(len(d),2)
        self.assertEqual(d.iloc[0].pessoas_por_familia,2)
        self.assertTrue(pd.isna(d.iloc[1].familias))
        b['familias']=99
        with self.assertRaisesRegex(AssertionError,'divergentes'):juntar_mensais([a,b])

    def test_df_nao_propaga_agregado_uf_a_regiao_com_mesmos_membros(self):
        v=np.array([[2.,np.nan]])
        q=QuadroHistorico(dict(metodo_referencia='razao',fator=1),[201301],v,np.array([[20.,np.nan]]),np.array([[10.,np.nan]]),np.array([[0,5]]))
        original=dict(v=[10.],n=[100.],d=[10.],c=[22],q=[0])
        q.agregados_publicados={'DF':copy.deepcopy(original)}
        self.assertEqual(q.grupo_territorio('DF',[0]),original)
        self.assertEqual(q.grupo_territorio('I:530001',[0])['c'],[0])
        self.assertEqual(q.grupo_territorio('5300108',[0],municipio=True)['q'],[1])
        q.grupo_territorio('DF',[0])['v'][0]=999
        self.assertEqual(q.agregados_publicados['DF'],original)

    def test_nova_origem_sobreposta_recusada_antes_de_escrever(self):
        with tempfile.TemporaryDirectory() as tmp:
            d=Path(tmp);al=d/'alagoas';al.mkdir();p=al/'intacto';p.write_bytes(b'intacto')
            with self.assertRaises(ValueError):gerar(d/'sp',d/'rev',al/'novo',d,alagoas=al)
            self.assertEqual(list(al.iterdir()),[p]);self.assertEqual(p.read_bytes(),b'intacto')


if __name__=='__main__':unittest.main()
