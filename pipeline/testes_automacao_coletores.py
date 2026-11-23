"""Casos que poderiam publicar cobertura parcial, dados antigos ou perder séries."""
import io
import json
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import pandas as pd

from automacao_saude import completos,UFS,mesclar
from automacao_derivados import perdas
from automacao_contexto import Contexto


class TestFontes(unittest.TestCase):
    def test_temporario_so_pode_ser_descartado_dentro_da_rotina(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);ctx=Contexto.__new__(Contexto);ctx.raiz=root/'rotina';ctx.fontes=ctx.raiz/'fontes';ctx.fontes.mkdir(parents=True)
            outside=root/'original';outside.mkdir();(outside/'dados').write_bytes(b'intacto')
            for p in [outside,ctx.raiz,ctx.fontes]:
                with self.assertRaises(ValueError):ctx.descartar_temporario(p)
            self.assertEqual((outside/'dados').read_bytes(),b'intacto')
            temp=ctx.fontes/'csv';temp.mkdir();(temp/'a.csv').write_bytes(b'temporario');ctx.descartar_temporario(temp);self.assertFalse(temp.exists())

    def test_api_siops_vazia_nao_apaga_arquivo_publicado(self):
        import siops
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);p=root/'ano=2025/uf=GO.parquet';p.parent.mkdir();pd.DataFrame(dict(valor=[1.])).to_parquet(p,index=False);before=p.read_bytes()
            with patch.object(siops,'SILVER_S',root),patch.object(siops,'UFS',['GO']),patch.object(siops,'consultar',return_value=[]):
                with self.assertRaisesRegex(ValueError,'já publicados'):siops.baixar([2025],True)
            self.assertEqual(p.read_bytes(),before)

    def test_api_siope_vazia_nao_apaga_arquivo_publicado(self):
        import siope
        with tempfile.TemporaryDirectory()as d:
            root=Path(d);p=root/'indicadores/ano=2025/uf=GO.parquet';p.parent.mkdir(parents=True);pd.DataFrame(dict(valor=[1.])).to_parquet(p,index=False);before=p.read_bytes()
            def vazio(con,path):con.execute('CREATE TABLE r AS SELECT 1 AS valor WHERE false')
            with patch.object(siope,'SILVER_E',root),patch.object(siope,'baixar'),patch.object(siope,'ler',side_effect=vazio):
                with self.assertRaisesRegex(ValueError,'dados publicados'):siope.uma('indicadores',2025,'GO',True)
            self.assertEqual(p.read_bytes(),before)

    def test_series_mensais_nao_ocultam_lacunas_ao_virar_ano(self):
        from internet_fontes import validar_periodos
        full={202600+m for m in range(1,13)}|{202701,202702}
        validar_periodos(full)
        for month in [202612,202601,202701]:
            with self.assertRaises(ValueError):validar_periodos(full-{month})

    def test_sih_ano_novo_incompleto_fica_fora(self):
        refs=[dict(arquivo=f'SIHSUS/200801_/Dados/RD{uf}{y%100:02}{m:02}.dbc',bytes=1)for y in [2025,2026]for uf in UFS for m in range(1,13)]
        refs.remove(next(r for r in refs if r['arquivo'].endswith('RDGO2612.dbc')))
        got=completos(refs,'sih',2025,2026)
        self.assertEqual(len(got),27*12);self.assertTrue(all('25'in Path(r['arquivo']).name[4:6]for r in got))
        refs.remove(next(r for r in refs if r['arquivo'].endswith('RDGO2512.dbc')))
        with self.assertRaisesRegex(ValueError,'perdeu arquivos'):completos(refs,'sih',2025,2026)

    def test_sim_definitivo_nao_duplica_brasil_exige_fetais(self):
        refs=[dict(arquivo=f'SIM/CID10/DORES/DO{uf}2025.dbc',bytes=1)for uf in UFS]
        refs += [dict(arquivo='SIM/CID10/DORES/DOBR2025.dbc',bytes=1),dict(arquivo='SIM/PRELIM/DORES/DOGO2026.dbc',bytes=1)]
        with self.assertRaisesRegex(ValueError,'fetal'):completos(refs,'sim',2025,2026)
        refs.append(dict(arquivo='SIM/CID10/DOFET/DOFET25.dbc',bytes=1))
        got=completos(refs,'sim',2025,2026)
        self.assertEqual(len(got),28);self.assertNotIn('DOBR2025.dbc',[Path(r['arquivo']).name for r in got])

    def test_cnes_requer_tres_medidas_em_todas_ufs(self):
        refs=[dict(arquivo=f'CNES/200508_/Dados/{kind}/{kind}{uf}2512.dbc',bytes=1)for kind in ['ST','LT','PF']for uf in UFS]
        self.assertEqual(len(completos(refs,'cnes',2025,2025)),81)
        refs.pop()
        with self.assertRaises(ValueError):completos(refs,'cnes',2025,2025)

    def test_mescla_retificacao_so_do_ano_coletado(self):
        with tempfile.TemporaryDirectory()as d:
            a,b=Path(d)/'a.parquet',Path(d)/'b.parquet'
            pd.DataFrame(dict(ano=[2023,2024],municipio=[1,1],valor=[10,20])).to_parquet(a,index=False)
            pd.DataFrame(dict(ano=[2024,2025],municipio=[1,1],valor=[21,30])).to_parquet(b,index=False)
            mesclar(a,b);self.assertEqual(pd.read_parquet(a).valor.tolist(),[10,21,30])
            pd.DataFrame(dict(ano=[2025],municipio=[1])).to_parquet(b,index=False)
            with self.assertRaisesRegex(ValueError,'colunas perdidas'):mesclar(a,b)

    def test_guarda_recusa_perda_de_celula_e_de_coluna(self):
        with tempfile.TemporaryDirectory()as d:
            a,b=Path(d)/'a.parquet',Path(d)/'b.parquet'
            before=pd.DataFrame(dict(cod_ibge=[5208905,5208707],ano=[2024,2024],valor=[10.,20.]))
            before.to_parquet(a,index=False);after=before.copy();after.loc[0,'valor']=None;after.to_parquet(b,index=False)
            with self.assertRaisesRegex(ValueError,'perderam valores'):perdas(a,b,['cod_ibge','ano'])
            after=before.copy();after.loc[0,'valor']=11.;after.to_parquet(b,index=False)
            self.assertEqual(perdas(a,b,['cod_ibge','ano']),0)
            before[['cod_ibge','ano']].to_parquet(b,index=False)
            with self.assertRaisesRegex(ValueError,'Colunas'):perdas(a,b,['cod_ibge','ano'])

    def test_smp_descobre_semestre_futuro_e_refaz_csv_retificado(self):
        import internet_smp_fontes as s
        data=io.BytesIO()
        names=['Acessos_Telefonia_Movel_Total.csv','Densidade_Telefonia_Movel.csv','Acessos_Telefonia_Movel_2027_1S.csv','Acessos_Telefonia_Movel_2027_1S_Colunas.csv']
        with zipfile.ZipFile(data,'w')as z:
            for n in names:z.writestr(n,'conteudo oficial')
        class Remote(io.BytesIO):
            def __init__(self):
                super().__init__(data.getvalue());self.size=len(data.getvalue());self.etag='v2';self.modificado='agora';self.s=types.SimpleNamespace(close=lambda:None)
            def membro(self,item,dest):
                with zipfile.ZipFile(io.BytesIO(data.getvalue()))as z:dest.write_bytes(z.read(item.filename))
            def membro_longo(self,item,dest,prefixo=None):self.membro(item,dest)
        with tempfile.TemporaryDirectory()as d,patch.object(s,'ZipRemoto',Remote):
            root=Path(d);(root/'csv_smp').mkdir();target=root/'csv_smp'/names[2];target.write_text('arquivo antigo!')
            meta=s.adquirir(root);files=[r['arquivo']for r in meta['membros']]
            self.assertIn('csv_smp/'+names[2],files);self.assertNotIn('csv_smp/'+names[3],files)
            self.assertEqual(target.read_text(),'conteudo oficial')

    def test_todas_rotinas_possuem_executora_importavel(self):
        from automatizar_demais_bases import validar_executoras
        validar_executoras()

    def test_get_condicional_so_reusa_copia_com_hash_valido(self):
        class Response:
            status_code=200;headers={'Content-Length':'4','ETag':'novo'}
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def raise_for_status(self):pass
            def iter_content(self,*args):yield b'novo'
        with tempfile.TemporaryDirectory()as d:
            ctx=Contexto.__new__(Contexto);ctx.fontes=Path(d)
            path=Path(d)/'dados.csv';path.write_text('ruim')
            (Path(d)/'dados.csv.oficial.json').write_text(json.dumps(dict(url='https://example.org/dados',bytes=4,sha256='f'*64,etag='antigo')))
            with patch('automacao_contexto.HTTP.get',return_value=Response())as get:
                ref=ctx.obter_oficial('https://example.org/dados','dados.csv')
            self.assertNotIn('If-None-Match',get.call_args.kwargs['headers']);self.assertEqual(path.read_bytes(),b'novo');self.assertEqual(ref['bytes'],4)


if __name__=='__main__':unittest.main()
