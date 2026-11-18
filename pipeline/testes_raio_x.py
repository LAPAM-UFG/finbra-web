import tempfile, unittest
from pathlib import Path
from raio_x import validar_destino, retrato, extras_series


class RaioXTests(unittest.TestCase):
    def test_destinos_recusados_antes_de_escrita(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t);fonte=root/'origem';fonte.mkdir();(fonte/'dado').write_bytes(b'original')
            antes=sorted((str(p.relative_to(root)),p.read_bytes()) for p in root.rglob('*') if p.is_file())
            for saida in [fonte,fonte/'dentro',root,fonte/'x/../..']:
                with self.assertRaises(ValueError):validar_destino(fonte,saida,[fonte/'dado'])
            self.assertEqual(antes,sorted((str(p.relative_to(root)),p.read_bytes()) for p in root.rglob('*') if p.is_file()))
            self.assertEqual(validar_destino(fonte,root/'candidato'),(root/'candidato').resolve())

    def test_ultimo_zero_observado_nao_vira_missing(self):
        i={'periodos':[2023,2024,2025]}
        s=dict(v=[4,0,None],n=[4,0,None],d=[1,1,None],c=[0,1,2],q=[1,1,0])
        self.assertEqual(retrato(i,s),[2024,0,0,1,1,1,None])

    def test_ressalva_recente_nao_e_substituida_silenciosamente_por_ano_antigo(self):
        i={'periodos':[2023,2024]}
        s=dict(v=[2,None],n=[2,None],d=[1,None],c=[0,8],q=[1,0])
        s['com_ressalvas']=dict(v=[2,3],n=[2,3],d=[1,1],c=[0,8],q=[1,1])
        p=retrato(i,s)
        self.assertEqual(p[0],2024);self.assertIsNone(p[1]);self.assertEqual(p[7][0],3)

    def test_agregado_vazio_nao_inventa_componentes_zero(self):
        i={'periodos':[2025]};s=dict(v=[None],n=[0],d=[0],c=[2],q=[0])
        self.assertEqual(retrato(i,s,True),[2025,None,None,None,2,0,None])
        oficial=dict(v=[50],n=[100],d=[200],c=[22],q=[0])
        self.assertEqual(retrato(i,oficial,True)[1:4],[50,100,200])

    def test_comparacoes_anuais_nao_estimam_pagamentos_incompletos(self):
        linhas=[[2025,1000,120,60,12,12,100,600,9,10,2025],[2026,None,90,45,9,9,110,None,None,None,2026]]
        s=extras_series(linhas)
        self.assertEqual(len(s),13)
        self.assertEqual(s[4]['v'],[1.2,None]);self.assertEqual(s[5]['v'],[20,None])
        self.assertEqual(s[12]['v'],[18,None]);self.assertEqual(s[4]['c'][1],11)

    def test_denominador_zero_sem_infinito_e_numerador_ausente_prioritario(self):
        s=extras_series([[2025,0,None,0,0,12,100,0,0,0,2025]])
        self.assertEqual(s[5]['c'],[2]);self.assertEqual(s[8]['c'],[4]);self.assertIsNone(s[8]['v'][0])


if __name__=='__main__':unittest.main()
