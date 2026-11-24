import io,json,hashlib,tempfile,unittest
from pathlib import Path
import numpy as np
import duckdb
from comparacoes_base import Quadro
from curadoria_catalogos import curar_definicao,curar_mobilidade,unidade_en
from versoes_dados import arquivar,publicar_indice,versao_manifesto
from remuneracao_pronta import por_uf,gerar as gerar_remuneracao
from abertura_paineis import manter_remuneracao,compatibilidade

class Falha(Exception):
    def __init__(self):self.response={'Error':{'Code':'NoSuchKey'}}

class S3:
    def __init__(self):self.objetos={};self.copias=[]
    def put_object(self,Key,Body,Metadata=None,IfNoneMatch=None,**kw):
        if IfNoneMatch=='*'and Key in self.objetos:raise ValueError('Já existe')
        raw=Body if isinstance(Body,bytes)else Body.read();self.objetos[Key]=(raw,Metadata or{})
    def head_object(self,Key,**kw):
        if Key not in self.objetos:raise Falha()
        raw,meta=self.objetos[Key];return {'ContentLength':len(raw),'ETag':'"'+hashlib.md5(raw).hexdigest()+'"','Metadata':meta}
    def get_object(self,Key,**kw):
        h=self.head_object(Key);return {**h,'Body':io.BytesIO(self.objetos[Key][0])}
    def copy_object(self,Key,CopySource,CopySourceIfMatch,Metadata,**kw):
        assert self.head_object(CopySource['Key'])['ETag']==CopySourceIfMatch
        self.objetos[Key]=(self.objetos[CopySource['Key']][0],Metadata);self.copias.append(Key)

class Rodada2(unittest.TestCase):
    def test_candidata_de_remuneracao_nao_pode_ficar_dentro_da_fonte_micro(self):
        with tempfile.TemporaryDirectory(prefix='finbra-rem-destino-')as pasta:
            raiz=Path(pasta).resolve();micro=raiz/'micro';micro.mkdir();base=raiz/'base';base.mkdir()
            for saida in [micro,micro/'dentro',raiz]:
                with self.assertRaisesRegex(ValueError,'separada'):gerar_remuneracao(base,saida,micro,[2025],[])
            self.assertEqual(list(micro.iterdir()),[]);self.assertEqual(list(base.iterdir()),[])

    def test_cobertura_usa_instalacao_sem_descartar_observacao_reconstituida(self):
        q=Quadro({'metodo_referencia':'mediana'},[2024,2025],np.array([[10.,np.nan],[10.,20.]]),np.zeros((2,2)),np.ones((2,2)),np.zeros((2,2),dtype=np.uint8),inicios=np.array([1900,2025]))
        r=q.grupo([0,1]);self.assertEqual(r['c'],[0,0]);self.assertEqual(r['q'],[1,2]);self.assertEqual(r['e'],[1,2]);self.assertEqual(r['v'],[10.,15.])
        q.valores[0,1]=20.;r=q.grupo([0,1]);self.assertEqual(r['q'],[2,2]);self.assertEqual(r['e'],[2,2])

    def test_falta_real_nao_e_transformada_em_cobertura_completa(self):
        q=Quadro({'metodo_referencia':'mediana'},[2025],np.array([[10.,np.nan]]),np.zeros((1,2)),np.ones((1,2)),np.zeros((1,2),dtype=np.uint8),inicios=np.array([1900,2025]))
        r=q.grupo([0,1]);self.assertEqual(r['c'],[16]);self.assertEqual(r['q'],[1]);self.assertEqual(r['e'],[2])

    def test_original_inclui_registro_sem_populacao_sem_imputar_a_taxa(self):
        q=Quadro({'metodo_referencia':'razao','agregacao_original':'soma'},[2024],np.array([[2.,np.nan]]),np.array([[20.,3.]]),np.array([[10.,np.nan]]),np.zeros((1,2),dtype=np.uint8),originais=np.array([[20.,3.]]),inicios=np.array([1900,2025]))
        r=q.grupo([0,1]);self.assertEqual(r['r'],[23.]);self.assertEqual(r['v'],[2.]);self.assertEqual(r['n'],[20.]);self.assertEqual(r['c'],[0])

    def test_rotulos_publicos_historico_folha_e_unidades(self):
        h=curar_definicao({'id':'cad_hist_familias','historico_cadunico':True,'nome':'Famílias no CadÚnico','nome_en':'Registered families','nome_original':'Famílias no CadÚnico','unidade':'famílias'})
        self.assertIn('(série histórica)',h['nome']);self.assertIn('(série histórica)',h['nome_original']);self.assertEqual(curar_definicao(h),h)
        b=curar_definicao({'id':'pbf_valor_medio_planilha','nome':'Benefício médio informado na planilha','nome_en':'Average spreadsheet benefit','unidade':'R$'})
        self.assertNotIn('planilha',b['nome']);self.assertIn('MDS payroll',b['nome_en']);self.assertEqual(unidade_en('R$/tonelada'),'R$/tonne');self.assertEqual(unidade_en('veículo-anos'),'vehicle-years')

    def test_indice_congelado_nao_pode_ser_reescrito(self):
        s=S3();s.put_object(Key='gold/ipca.parquet',Body=b'bytes antigos');h=s.head_object('gold/ipca.parquet');inv={'gold/ipca.parquet':{'bytes':h['ContentLength'],'etag':h['ETag']}};m={'gerado_em':'2026-11-24T00:00:00Z'}
        publicar_indice(s,'b',m,inv);publicar_indice(s,'b',m,inv)
        self.assertEqual(len(s.copias),0)
        key='gold/versoes/20261124000000.json';original=s.objetos[key][0]
        publicar_indice(s,'b',m,{**inv,'gold/artefato_futuro.json':{'bytes':1,'etag':'"'+'b'*32+'"'}})
        self.assertEqual(s.objetos[key][0],original);self.assertNotIn('gold/artefato_futuro.json',json.loads(original)['arquivos'])
        with self.assertRaises(ValueError):publicar_indice(s,'b',m,{'gold/ipca.parquet':{'bytes':1,'etag':'"'+'a'*32+'"'}})

    def test_reprocessar_rotulos_nao_duplica_a_limite_da_frota(self):
        c={'indicadores':[{'id':'mob_frota','nome':'Frota','descricao':'Origem.','fonte':'senatran','unidade':'veículos'}],'derivados':[]}
        uma=curar_mobilidade(c);self.assertEqual(curar_mobilidade(uma),uma)

    def test_arquivo_anterior_e_preservado_somente_antes_de_substituir(self):
        s=S3();s.put_object(Key='gold/ipca.parquet',Body=b'original');h=s.head_object('gold/ipca.parquet');arquivar(s,'b','gold/ipca.parquet',h['ETag']);arquivar(s,'b','gold/ipca.parquet',h['ETag']);self.assertEqual(len(s.copias),1)
        s.put_object(Key='gold/ipca.parquet',Body=b'novo');self.assertEqual(s.objetos[s.copias[0]][0],b'original')

    def test_versao_extra_so_vale_para_a_base_a_que_pertence(self):
        m={'gerado_em':'2026-11-23','cache_http':{'versao':'20261124012345','manifesto_gerado_em':'2026-11-23'}}
        self.assertEqual(versao_manifesto(m),'20261124012345');m['gerado_em']='2026-11-25';self.assertEqual(versao_manifesto(m),'20261125')

    def test_atualizacao_de_outro_tema_conserva_estatisticas_compativeis(self):
        m={'gerado_em':'hoje','base_ipca':2025,'fontes':{'rais_micro':{'anos':[2025]},'ipca':{'base':2025}}};b={'compatibilidade':compatibilidade(m,['rais_micro'],True),'anos':{2025:{}}}
        m['gerado_em']='amanhã';self.assertEqual(manter_remuneracao(b,m)['compatibilidade']['gerado_em'],'amanhã')
        m['fontes']['rais_micro']={'anos':[2025,2026]};self.assertIsNone(manter_remuneracao(b,m))

    def test_quantis_prontos_sao_dos_microdados_e_nao_media_de_medias(self):
        with tempfile.TemporaryDirectory(prefix='finbra-rodada2-')as pasta:
            p=Path(pasta).resolve();self.assertTrue(p.name.startswith('finbra-rodada2-'))
            con=duckdb.connect();con.execute('CREATE TABLE dados(municipio INTEGER,sexo INTEGER,raca_cor INTEGER,escolaridade INTEGER,idade INTEGER,rem_dezembro_nom DECIMAL(12,2),ativo_31_12 INTEGER)')
            con.executemany('INSERT INTO dados VALUES(?,?,?,?,?,?,?)',[(350950,1,1,9,30,100,1),(350950,1,1,9,30,200,1),(350950,1,None,9,None,0,1),(350970,1,2,8,50,900,1),(350970,2,2,8,50,-5,1),(350970,2,2,8,50,None,1),(350950,1,1,9,30,999,0)])
            arq=p/'micro.parquet';con.execute('COPY dados TO ? (FORMAT PARQUET)',[str(arq)])
            nomes={'municipios':{350950:3509502,350970:3509700},'dimensoes':{}}
            rec=dict(por_uf(con,arq,'SP',2025,nomes));uf=next(r for r in rec['uf:SP']['dimensoes']['sexo']if r['grupo']=='1');mun=next(r for r in rec['ente:3509502']['dimensoes']['sexo']if r['grupo']=='1')
            self.assertEqual(uf['rem_dez_mediana'],200);self.assertAlmostEqual(uf['rem_dez_p10'],120);self.assertAlmostEqual(uf['rem_dez_p90'],760)
            self.assertEqual(mun['vinculos'],3);self.assertEqual(mun['n_rem_dez'],2);self.assertEqual(mun['rem_dez_zero'],1);self.assertEqual(mun['rem_dez_media'],150)
            sem=next(r for r in rec['uf:SP']['dimensoes']['sexo']if r['grupo']=='2');self.assertIsNone(sem['rem_dez_media']);self.assertIsNone(sem['rem_dez_mediana']);self.assertEqual(sem['rem_dez_negativa'],1);self.assertEqual(sem['rem_dez_ausente'],1)
            con.close()

if __name__=='__main__':unittest.main()
