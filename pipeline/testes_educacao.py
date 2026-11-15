"""Casos com risco de mudar o significado: agregação, nulos e denominadores."""
import tempfile
import json
import hashlib
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

from assistencia_utils import destino_isolado
from educacao import agregar_escolas, csv_escola, ler_indicadores, tabela_legada, CONTAGENS, INFRA, INDICADORES, NOMES_UF, percentuais_perfil, ler_publicado
from educacao_baixar import sha


def escolas():
    rows=[]
    for code,uf,nome,dep,mat,internet in [(5208707,'GO','Goiânia',3,100,1),(5208707,'GO','Goiânia',2,200,0),(5200050,'GO','Abadia de Goiás',3,50,1),(5300108,'DF','Brasília',4,90,1)]:
        row=dict(CO_MUNICIPIO=code,NO_MUNICIPIO=nome,SG_UF=uf,TP_DEPENDENCIA=dep,TP_LOCALIZACAO=1)
        for k,(col,_,_) in CONTAGENS.items():row[col]=0
        row.update(QT_MAT_BAS=mat,QT_MAT_INF=mat,QT_MAT_FUND=0,QT_MAT_MED=0,QT_MAT_INF_INT=10,QT_MAT_FUND_INT=0,QT_MAT_MED_INT=0)
        for k,(col,_,_) in INFRA.items():row[col]=internet
        row.update(IN_BIBLIOTECA=internet,IN_SALA_LEITURA=0)
        rows.append(row)
    return pd.DataFrame(rows)


class Educacao(unittest.TestCase):
    def test_estados_e_ideb_observado_sem_confundir_metas(self):
        self.assertEqual(NOMES_UF['SP'],'São Paulo')
        self.assertEqual(NOMES_UF['SE'],'Sergipe')
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'ideb.xlsx';rows=[[None]*4 for _ in range(12)]
            rows[6]=['Região/Unidade da Federação','Rede','IDEB\n2023','IDEB\n2025']
            rows[9]=[None,None,'VL_OBSERVADO_2023','VL_PROJECAO_2025']
            rows[10]=['São Paulo','Pública',6.2,6.8]
            rows[11]=['Sergipe','Pública',4.9,5.5]
            pd.DataFrame(rows).to_excel(path,index=False,header=False,sheet_name='Anos Iniciais')
            values={};ler_indicadores([dict(caminho=str(path),sha256=sha(path),fonte='ideb',ano=2025)],values)
            self.assertEqual(values[('SP',2023)]['ideb_ai'],6.2)
            self.assertEqual(values[('SE',2023)]['ideb_ai'],4.9)
            self.assertNotIn(('SP',2025),values)

    def test_contagens_sem_duplicar_distrito_federal(self):
        groups,_=agregar_escolas(escolas())
        self.assertEqual(groups['BR'][0]['mat_total'],440)
        self.assertEqual(groups['GO'][0]['mat_total'],350)
        self.assertEqual(groups['DF'][0]['mat_total'],90)
        self.assertEqual(groups['5300108'][0]['mat_total'],90)

    def test_percentuais_sao_razao_das_somas(self):
        groups,_=agregar_escolas(escolas())
        self.assertAlmostEqual(groups['GO'][0]['internet_pct'],200/3)
        self.assertAlmostEqual(groups['GO'][0]['integral_pct'],100*30/350)
        self.assertNotEqual(groups['GO'][0]['internet_pct'],75)

    def test_privada_nao_entra_na_infra_publica(self):
        groups,_=agregar_escolas(escolas())
        self.assertAlmostEqual(groups['BR'][0]['internet_pct'],200/3)
        self.assertIsNone(groups['DF'][0]['internet_pct'])
        self.assertEqual(groups['DF'][0]['escolas_publicas'],0)

    def test_resposta_ausente_nao_vira_zero(self):
        frame=escolas();frame.loc[0,'IN_INTERNET']=np.nan
        groups,_=agregar_escolas(frame)
        self.assertEqual(groups['GO'][1]['internet_pct'],[1,2])
        self.assertEqual(groups['GO'][0]['internet_pct'],50)

    def test_zero_registrado_preservado(self):
        frame=escolas();frame['IN_INTERNET']=0
        groups,_=agregar_escolas(frame)
        self.assertEqual(groups['GO'][0]['internet_pct'],0)
        self.assertEqual(groups['GO'][0]['mat_eja'],0)

    def test_banda_larga_condicional(self):
        frame=escolas();frame.loc[1,'IN_BANDA_LARGA']=np.nan
        groups,_=agregar_escolas(frame)
        self.assertEqual(groups['GO'][1]['banda_larga_pct'],[2,3])
        frame.loc[0,'IN_BANDA_LARGA']=np.nan
        groups,_=agregar_escolas(frame)
        self.assertEqual(groups['GO'][1]['banda_larga_pct'],[1,2])

    def test_integral_nao_usa_eja_como_denominador(self):
        frame=escolas();frame['QT_MAT_EJA']=9000
        groups,_=agregar_escolas(frame)
        self.assertAlmostEqual(groups['GO'][0]['integral_pct'],100*30/350)

    def test_integral_incompleto_nao_mostra_total_parcial(self):
        frame=escolas();frame.loc[0,'QT_MAT_INF_INT']=np.nan
        groups,_=agregar_escolas(frame)
        self.assertIsNone(groups['GO'][0]['mat_integral'])
        self.assertIsNone(groups['GO'][0]['integral_pct'])

    def test_denominador_zero_nao_vira_zero_porcento(self):
        frame=escolas();frame[['QT_MAT_INF','QT_MAT_FUND','QT_MAT_MED']]=0
        groups,_=agregar_escolas(frame)
        self.assertIsNone(groups['GO'][0]['integral_pct'])

    def test_destinos_sobre_a_origem_sao_recusados(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'data';source.mkdir()
            for output in [source,source/'gold',source.parent,source/'x'/'..']:
                with self.assertRaises(ValueError):destino_isolado(output,source)
            self.assertFalse(any(source.iterdir()))

    def test_contrato_das_variaveis(self):
        self.assertEqual(len(INDICADORES),93)
        self.assertEqual(sum(i['principal'] for i in INDICADORES),43)
        self.assertEqual(len({i['variavel'] for i in INDICADORES}),93)
        self.assertTrue(all(len(i['variavel'])<=32 for i in INDICADORES))

    def test_cadastro_ausente_e_conciliado_por_codigo_sem_mudar_contagens(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            frame=pd.DataFrame([dict(NU_ANO_CENSO=2013,CO_ENTIDADE=1,CO_MUNICIPIO=4319901,NO_MUNICIPIO='Sapiranga',SG_UF='RS',TP_DEPENDENCIA=3,TP_LOCALIZACAO=1,TP_SITUACAO_FUNCIONAMENTO=1,QT_MAT_BAS=10),
                dict(NU_ANO_CENSO=2013,CO_ENTIDADE=2,CO_MUNICIPIO=4319901,NO_MUNICIPIO=None,SG_UF=None,TP_DEPENDENCIA=3,TP_LOCALIZACAO=1,TP_SITUACAO_FUNCIONAMENTO=1,QT_MAT_BAS=3)])
            frame.to_csv(folder/'microdados_ed_basica_2013.csv',sep=';',index=False)
            result=csv_escola(folder,2013)
            self.assertEqual(result.QT_MAT_BAS.tolist(),[10,3])
            self.assertEqual(result.SG_UF.tolist(),['RS','RS'])
            self.assertEqual(result.NO_MUNICIPIO.tolist(),['Sapiranga','Sapiranga'])
            frame.loc[0,'SG_UF']='SP';frame.to_csv(folder/'microdados_ed_basica_2013.csv',sep=';',index=False)
            with self.assertRaises(ValueError):csv_escola(folder,2013)

    def test_inclusao_usa_somas_e_denominador_zero_fica_indefinido(self):
        frame=escolas();frame['QT_MAT_ESP_CC']=[9,0,1,0];frame['QT_MAT_ESP_CE']=[1,0,89,0]
        groups,_=agregar_escolas(frame)
        self.assertEqual(groups['GO'][0]['esp_comum_pct'],10)
        self.assertEqual(groups['GO'][0]['mat_esp_comum'],10)
        self.assertIsNone(groups['DF'][0]['esp_comum_pct'])

    def test_perfil_percentual_e_razao_das_somas(self):
        frame=escolas();frame['QT_MAT_BAS_FEM']=[20,100,45,30];frame['QT_MAT_BAS_MASC']=[80,100,5,60]
        groups,_=agregar_escolas(frame)
        self.assertAlmostEqual(groups['GO'][0]['mat_feminino_pct'],100*165/350)
        self.assertAlmostEqual(groups['BR'][0]['mat_feminino_pct'],100*195/440)
        self.assertNotEqual(groups['GO'][0]['mat_feminino_pct'],65)
        self.assertAlmostEqual(groups['GO'][0]['mat_feminino_pct']+groups['GO'][0]['mat_masculino_pct'],100)

    def test_perfil_preserva_zero_ausencia_e_cor_raca_nao_declarada(self):
        rec=dict(mat_total=10,mat_feminino=0,mat_masculino=None,mat_raca_preta=3,mat_raca_nd=7)
        pct=percentuais_perfil(rec)
        self.assertEqual(pct['mat_feminino_pct'],0)
        self.assertIsNone(pct['mat_masculino_pct'])
        self.assertEqual(pct['mat_raca_preta_pct'],30)
        self.assertEqual(pct['mat_raca_nd_pct'],70)
        for denominator in [0,None]:self.assertTrue(all(v is None for v in percentuais_perfil({**rec,'mat_total':denominator}).values()))
        with self.assertRaises(ValueError):percentuais_perfil(dict(mat_total=2,mat_feminino=3))

    def test_snapshot_e_reutilizado_somente_com_hashes_e_coleta_corretos(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'publicado';brutos=Path(tmp)/'brutos'
            (root/'gold/educacao').mkdir(parents=True);(root/'gold/downloads').mkdir();brutos.mkdir()
            (brutos/'coleta.json').write_text('{}',encoding='utf-8')
            def write(name,value):
                path=root/name;path.write_text(json.dumps(value,ensure_ascii=False),encoding='utf-8')
                return dict(caminho=name,bytes=path.stat().st_size,sha256=sha(path))
            ids=[i['id'] for i in INDICADORES[:69]];rec={k:None for k in ids};rec.update(mat_total=10,mat_feminino=4,mat_masculino=6,mat_raca_nd=10)
            payload=b'';territories=[]
            for g,n,uf,level in [('BR','Brasil',None,'BR'),('GO','Goiás','GO','UF'),('5208707','Goiânia','GO','M')]:
                raw=(json.dumps(dict(grupo=g,linhas=[[2025,*[rec[k] for k in ids]]],cobertura={}))+'\n').encode()
                territories.append(dict(grupo=g,nome=n,uf=uf,nivel=level,trecho=[len(payload),len(raw),hashlib.sha256(raw).hexdigest()]))
                payload+=raw
            file=root/'gold/educacao/series_teste.ndjson';file.write_bytes(payload)
            ref=dict(caminho='gold/educacao/series_teste.ndjson',bytes=len(payload),sha256=sha(file))
            cities=write('gold/educacao/municipios_go.json',territories[2:])
            write('gold/educacao/manifesto.json',dict(indicadores=INDICADORES[:69],coleta_sha256=sha(brutos/'coleta.json'),arquivo=ref,municipios=dict(GO=cities),territorios=territories[:2]))
            write('gold/downloads/manifesto.json',dict(fontes_complementares=dict(educacao=dict(sha256=sha(root/'gold/educacao/manifesto.json')))))
            values,_,_,_=ler_publicado(root,brutos)
            self.assertEqual(values[('5208707',2025)]['mat_feminino_pct'],40)
            self.assertEqual(values[('BR',2025)]['mat_raca_nd_pct'],100)
            self.assertEqual(file.read_bytes(),payload)
            file.write_bytes(payload+b' ')
            with self.assertRaises(ValueError):ler_publicado(root,brutos)
            file.write_bytes(payload);(brutos/'coleta.json').write_text('{"alterada":true}',encoding='utf-8')
            with self.assertRaises(ValueError):ler_publicado(root,brutos)

    def test_contagens_adicionais_recusam_total_parcial(self):
        frame=escolas();frame['QT_DOC_BAS']=[3,np.nan,5,0]
        frame['QT_MAT_BAS_ND']=[0,0,2,0]
        groups,_=agregar_escolas(frame)
        self.assertIsNone(groups['GO'][0]['doc_bas'])
        self.assertIsNone(groups['5208707'][0]['doc_bas'])
        self.assertEqual(groups['5200050'][0]['doc_bas'],5)
        self.assertEqual(groups['GO'][0]['mat_raca_nd'],2)
        self.assertEqual(groups['DF'][0]['mat_raca_nd'],0)

    def test_internet_alunos_preserva_ausencia_e_zero_condicional(self):
        frame=escolas();frame['IN_INTERNET_ALUNOS']=[np.nan,np.nan,1,1]
        groups,_=agregar_escolas(frame)
        self.assertEqual(groups['GO'][1]['internet_alunos_pct'],[1,2])
        self.assertEqual(groups['GO'][0]['internet_alunos_pct'],50)

    def test_tabelas_2025_juntam_por_escola_e_recusam_duplicatas(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder=Path(tmp)
            pd.DataFrame([dict(NU_ANO_CENSO=2025,CO_ENTIDADE=1,CO_MUNICIPIO=5208707,NO_MUNICIPIO='Goiânia',SG_UF='GO',TP_SITUACAO_FUNCIONAMENTO=1)]).to_csv(folder/'Tabela_Escola_2025.csv',sep=';',index=False)
            pd.DataFrame([dict(CO_ENTIDADE=1,QT_MAT_BAS=20)]).to_csv(folder/'Tabela_Matricula_2025.csv',sep=';',index=False)
            pd.DataFrame([dict(CO_ENTIDADE=1,QT_DOC_BAS=3)]).to_csv(folder/'Tabela_Docente_2025.csv',sep=';',index=False)
            pd.DataFrame([dict(CO_ENTIDADE=1,QT_TUR_BAS=2)]).to_csv(folder/'Tabela_Turma_2025.csv',sep=';',index=False)
            frame=csv_escola(folder,2025)
            self.assertEqual(frame.QT_MAT_BAS.tolist(),[20])
            self.assertEqual(frame.QT_DOC_BAS.tolist(),[3])
            self.assertEqual(frame.QT_TUR_BAS.tolist(),[2])
            pd.DataFrame([dict(CO_ENTIDADE=1,QT_DOC_BAS=3)]*2).to_csv(folder/'Tabela_Docente_2025.csv',sep=';',index=False)
            with self.assertRaises(ValueError):csv_escola(folder,2025)

    def test_ensino_medio_legado_nao_confunde_total_com_nao_seriado(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'legado.xlsx';rows=[[None]*9 for _ in range(10)]
            rows[6]=['Ano','Brasil','Localização','Rede','Taxa de Aprovação - Ensino Fundamental',None,None,'Taxa de Aprovação - Ensino Médio',None]
            rows[7]=[None,None,None,None,'Total Fundamental','Aprovação - Anos Iniciais','Aprovação - Anos Finais','Total Aprovação Médio','Total Aprovação Médio Não-Seriado']
            rows[9]=[2013,'Brasil','Total','Publico',90,95,85,80,55]
            pd.DataFrame(rows).to_excel(path,index=False,header=False)
            book=pd.ExcelFile(path,engine='calamine');top=pd.read_excel(book,header=None,nrows=16)
            frame,_=tabela_legada(book,book.sheet_names[0],top,'rendimento')
            self.assertFalse(frame.columns.duplicated().any())
            self.assertEqual(frame['1_CAT_MED'].iloc[0],80)
            book.close()

    def test_ideb_ano_com_rotulo_legivel_e_cabecalho_tecnico_vazio(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'ideb.xlsx';rows=[[None]*4 for _ in range(11)]
            rows[6]=['Brasil','Rede','IDEB\n2023\n(N x P)','IDEB\n2013\n(N x P)']
            rows[9]=['BRASIL','REDE',None,'VL_OBSERVADO_2013']
            rows[10]=['Brasil','Pública',4.7,4.0]
            pd.DataFrame(rows).to_excel(path,index=False,header=False,sheet_name='Brasil (Anos Finais)')
            values={};report=ler_indicadores([dict(caminho=str(path),sha256=sha(path),fonte='ideb',ano=2025)],values)
            self.assertEqual(values[('BR',2023)]['ideb_af'],4.7)
            self.assertEqual(values[('BR',2013)]['ideb_af'],4)
            self.assertEqual(len(report['arquivos'][0]['cabecalhos_legiveis']),1)

    def test_saeb_preserva_notas_e_ressalvas_por_rede(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'saeb.xlsx';rows=[[None]*6 for _ in range(14)]
            rows[6]=['Brasil','Rede','Ideb',None,None,None]
            rows[9]=['BRASIL','REDE','VL_OBSERVADO_2025','VL_NOTA_PORTUGUES_2025','VL_NOTA_MATEMATICA_2025','VL_NOTA_PORTUGUES_2023']
            rows[10]=['Brasil','Pública',6, '205.58*','244,28**','ND***']
            rows[11]=['Brasil','Municipal',5.5, 201.77,'ND*','ND']
            rows[12]=['Brasil','Privada',7, 251.22,260.33,'-']
            rows[13]=['Brasil','Estadual',6,240,250,230]
            pd.DataFrame(rows).to_excel(path,index=False,header=False,sheet_name='Anos Iniciais')
            source=[dict(caminho=str(path),sha256=sha(path),fonte='ideb',ano=2025)]
            values={};ler_indicadores(source,values)
            r=values[('BR',2025)];self.assertEqual(r['saeb_lp_ai'],205.58);self.assertEqual(r['saeb_lp_ai_nota'],1)
            self.assertEqual(r['saeb_mat_ai'],244.28);self.assertEqual(r['saeb_mat_ai_nota'],2)
            self.assertIsNone(values[('BR',2023)]['saeb_lp_ai']);self.assertEqual(values[('BR',2023)]['saeb_lp_ai_nota'],6)
            values={};ler_indicadores(source,values,'municipal')
            self.assertEqual(values[('BR',2025)]['saeb_lp_ai'],201.77);self.assertEqual(values[('BR',2025)]['saeb_lp_ai_nota'],0)
            self.assertIsNone(values[('BR',2025)]['saeb_mat_ai']);self.assertEqual(values[('BR',2025)]['saeb_mat_ai_nota'],3)
            self.assertEqual(values[('BR',2023)]['saeb_lp_ai_nota'],4)
            values={};ler_indicadores(source,values,'privada');self.assertEqual(values[('BR',2025)]['saeb_lp_ai'],251.22)
            self.assertEqual(values[('BR',2023)]['saeb_lp_ai_nota'],5)
            rows[10][3]='205.58***';pd.DataFrame(rows).to_excel(path,index=False,header=False,sheet_name='Anos Iniciais')
            source[0]['sha256']=sha(path)
            with self.assertRaises(ValueError):ler_indicadores(source,{})


if __name__=='__main__':unittest.main()
