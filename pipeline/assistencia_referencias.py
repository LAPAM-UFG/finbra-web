"""Compara pagamentos anuais com população, massa formal estimada e PIB.

Gera catálogo independente e imutáveis em candidato novo. Preserva a comparação
PIB e todos os dados publicados. RAIS: 12 × massa nominal observada em dezembro,
sem 13º imputado, com cobertura de remuneração explícita. Nunca estima pagamentos.
"""
import argparse
import copy
import hashlib
import json
import math
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import numpy as np
import pandas as pd
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado
from assistencia_economia import compacto, gravar, sha, razao
from assistencia_economia_rankings import ordenar

BASES = ('populacao', 'rais', 'pib')
PROGRAMAS = ('pbf', 'bpc', 'total')
NOTA_RAIS = ('Estimativa anual = 12 × massa salarial nominal observada em dezembro dos vínculos ativos em 31/12. '
             'Não é soma observada dos salários do ano; não inclui 13º imputado. Informais e trabalho autônomo '
             'sem vínculo ficam fora. Local do estabelecimento, não de residência. Remunerações não informadas '
             'podem reduzir o denominador; conferir cobertura. Quebras do eSocial em 2022/2023.')
NOTA_RAIS_EN = ('Annual estimate = 12 × observed nominal December payroll for jobs active on December 31. '
                'Not the observed sum of yearly wages; no imputed 13th salary. Excludes informal and self-employed '
                'work without an employment contract. Employer location, not residence. Unreported pay may lower '
                'the denominator; check coverage. eSocial series breaks in 2022/2023.')


def comparar(pago, meses, base, fator=100):
    v, c = razao(pago, meses, base)
    return (v * fator / 100 if v is not None else None), c


def massa_rais(massa, ativos, informados):
    assert massa is None or math.isfinite(massa) and massa >= 0, 'Massa salarial inválida'
    if ativos is None or informados is None or not math.isfinite(ativos) or not math.isfinite(informados):
        return None, None
    assert ativos >= 0 and 0 <= informados <= ativos and int(ativos) == ativos and int(informados) == informados
    cobertura = 100 * informados / ativos if ativos > 0 else None
    if ativos == 0:
        return 0., cobertura
    if massa is None or not math.isfinite(massa) or massa <= 0 or informados == 0:
        return None, cobertura
    return 12 * massa, cobertura


def carregar(fontes):
    root = Path(fontes).resolve()
    prov = json.loads((root / 'proveniencia.json').read_bytes())
    for key, ref in prov['arquivos'].items():
        p = (root / key).resolve()
        assert p.is_relative_to(root) and p.stat().st_size == ref['bytes'] and sha(p) == ref['sha256'], 'Fonte alterada: ' + key
    m = json.loads((root / 'gold/manifesto.json').read_bytes())
    legado = json.loads((root / 'gold/assistencia/economia_manifesto.json').read_bytes())
    refs = m['fontes']['assistencia']['arquivos']
    assert legado['versao'] == 1
    for key in ['pbf', 'bpc']:
        assert all(legado['fontes'][key][k] == refs[key][k] for k in ['caminho','bytes','sha256'])
    return root, m, legado, refs, prov


def componentes(fontes, m, refs, legado):
    terras = pq.read_table(fontes / refs['territorios']['caminho']).to_pylist()
    cadastro = {t['grupo']:t for t in terras}
    municipal = {int(t['cod_ibge']):t for t in terras if t['nivel'] == 'M'}
    pop = pq.read_table(fontes / 'silver/ibge_populacao.parquet').to_pandas()
    if 'ano' not in pop: pop = pop.rename(columns={'exercicio':'ano'})
    assert not pop.duplicated(['cod_ibge','ano']).any()
    populacao = {(str(int(r.cod_ibge)),int(r.ano)):float(r.populacao) for r in pop.itertuples() if pd.notna(r.populacao) and r.populacao > 0}
    for row in json.loads((fontes / 'ibge_populacao_2026.json').read_bytes())[1:]:
        populacao[str(int(row['D1C'])),int(row['D3C'])] = int(row['V'])
    anos_pop = {ano for _,ano in populacao}
    base_pop = {a:a if a in anos_pop else 2022 if a == 2023 else None for a in legado['anos']}
    rais = pq.read_table(fontes / 'gold/trabalho/municipios.parquet', columns=['cod_ibge','ano','massa_dez','n_rem_dez','empregos']).to_pandas()
    assert not rais.duplicated(['cod_ibge','ano']).any()
    assert set(rais.ano) <= set(m['fontes']['rais']['anos'])
    rlookup = {(str(int(r.cod_ibge)),int(r.ano)):(float(r.massa_dez) if pd.notna(r.massa_dez) else None,
        float(r.empregos) if pd.notna(r.empregos) else None,float(r.n_rem_dez) if pd.notna(r.n_rem_dez) else None) for r in rais.itertuples() if int(r.cod_ibge) in municipal}
    # Referências agregam componentes, sem tirar média de taxas nem duplicar DF.
    for ano in legado['anos']:
        for grupo in [k for k,t in cadastro.items() if t['nivel'] != 'M']:
            codigos = [str(c) for c,t in municipal.items() if grupo == 'BR' or t['uf'] == grupo]
            bp = base_pop[ano]
            valores = [populacao.get((c,bp)) for c in codigos]
            conhecidos = [v for v in valores if v is not None]
            populacao[grupo,bp] = sum(conhecidos) if conhecidos else None
            registros = [rlookup[c,ano] for c in codigos if (c,ano) in rlookup]
            if registros:
                soma = lambda j: sum(r[j] for r in registros if r[j] is not None)
                rlookup[grupo,ano] = (soma(0) if any(r[0] is not None for r in registros) else None,soma(1),soma(2))
    return cadastro, municipal, populacao, base_pop, rlookup


def gerar(fontes, saida):
    fontes = Path(fontes).resolve()
    saida = destino_isolado(Path(saida), fontes)
    assert not saida.exists() or not any(saida.iterdir()), 'Use candidato novo/vazio'
    root, global_m, legado, refs, prov = carregar(fontes)
    cadastro, municipal, pop, base_pop, rais = componentes(root, global_m, refs, legado)
    antigo = pq.read_table(root / legado['parquet']['caminho']).to_pandas()
    assert not antigo.duplicated(['cod_ibge','ano']).any()
    # Conferência independente do acumulado: somente 12 competências válidas.
    db = duckdb.connect()
    for fonte, campo, id in [('pbf','as_pbf','pbf_cgu_valor'),('bpc','as_bpc','bpc_valor_pago')]:
        rows = db.execute("SELECT grupo,competencia//100 AS ano,count(*) AS total,count(DISTINCT competencia) AS distintos,count(*) FILTER(WHERE condicao IN ('registrado','zero_registrado') AND valor IS NOT NULL AND isfinite(valor) AND valor>=0) AS meses,sum(valor) FILTER(WHERE condicao IN ('registrado','zero_registrado') AND valor IS NOT NULL AND isfinite(valor) AND valor>=0) AS pago FROM read_parquet(?) WHERE indicador=? AND competencia>=201301 GROUP BY grupo,ano",[str(root/refs[fonte]['caminho']),id]).fetchall()
        assert all(r[2] == r[3] and r[2] <= 12 for r in rows)
        ref = {(r[0],int(r[1])):(round(float(r[5]),2) if r[4] == 12 else None,int(r[4])) for r in rows}
        for row in antigo.itertuples():
            pago,meses = ref.get((str(row.cod_ibge),int(row.ano)),(None,0))
            atual = getattr(row,campo+'_pago_ano')
            assert meses == getattr(row,campo+'_meses')
            assert pago is None and pd.isna(atual) or pago is not None and abs(pago-atual)<.011
    db.close()
    (saida/'gold/assistencia').mkdir(parents=True,exist_ok=True)
    bruto=bytearray(); grupos={}; ufs={}; wide=[]
    original_bundle = root / legado['arquivo']['caminho']
    for line in original_bundle.read_text(encoding='utf-8').splitlines():
        old=json.loads(line); grupo=old['grupo']; rows=[]
        assert grupo in cadastro
        for row in old['linhas']:
            ano=row[0]; bp=base_pop[ano]; populacao=pop.get((grupo,bp))
            massa,ativos,nrem=rais.get((grupo,ano),(None,None,None))
            anual,cobertura=massa_rais(massa,ativos,nrem)
            novo=row+[populacao,anual,nrem,ativos,bp]
            rows.append(novo)
            if cadastro[grupo]['nivel']=='M':
                ff=dict(cod_ibge=int(grupo),ano=ano,municipio=cadastro[grupo]['nome'],uf=cadastro[grupo]['uf'],
                    as_pib=row[1],as_pbf_pago_ano=row[2],as_bpc_pago_ano=row[3],as_pbf_meses=row[4],as_bpc_meses=row[5],
                    as_populacao=populacao,as_pop_ano_base=bp,as_rais_massa_dez=massa,as_rais_massa_ano_est=anual,
                    as_rais_n_rem_dez=nrem,as_rais_vinculos=ativos,as_rais_cobertura_pct=cobertura)
                ff['as_total_pago_ano']=row[2]+row[3] if row[2] is not None and row[3] is not None else None
                for programa in PROGRAMAS:
                    pago=ff['as_'+programa+'_pago_ano']; meses=row[4] if programa=='pbf' else row[5] if programa=='bpc' else min(row[4],row[5])
                    for base,denom,fator,sufixo in [('populacao',populacao,1,'percapita'),('rais',anual,100,'rais_pct'),('pib',row[1],100,'pib_pct')]:
                        v,c=comparar(pago,meses,denom,fator)
                        ff['as_'+programa+'_'+sufixo]=v;ff['as_'+programa+'_'+base+'_cond']=c
                wide.append(ff)
        body=compacto(dict(grupo=grupo,linhas=rows))+b'\n';trecho=[len(bruto),len(body),hashlib.sha256(body).hexdigest()];bruto.extend(body)
        if cadastro[grupo]['nivel']=='M':ufs.setdefault(cadastro[grupo]['uf'],{})[grupo]=trecho
        else:grupos[grupo]=trecho
    arquivo=gravar(saida,'economia_referencias_series',bytes(bruto),'ndjson')
    indices={u:gravar(saida,'economia_referencias_indice_'+u.lower(),dict(grupos=idx)) for u,idx in ufs.items()}
    df=pd.DataFrame(wide); rankrefs={'pib':copy.deepcopy(legado['rankings'])}; anos_validos={}
    for base,denom,fator,sufixo in [('populacao','as_populacao',1,'percapita'),('rais','as_rais_massa_ano_est',100,'rais_pct')]:
        rb=bytearray(); indexes={};validos=set()
        for programa in PROGRAMAS:
            recortes={};prog_anos=set()
            for ano in legado['anos']:
                sub=df[df.ano.eq(ano)]
                for uf in ['BR',*sorted(ufs)]:
                    local=sub if uf=='BR' else sub[sub.uf.eq(uf)]
                    coluna='as_'+programa+'_'+base+'_cond';contagens=Counter(local[coluna]);regs=[]
                    for r in local[local[coluna].eq(0)].to_dict('records'):
                        regs.append([r['cod_ibge'],r['municipio'],r['uf'],r['as_'+programa+'_pago_ano'],r[denom]])
                    linhas=ordenar(regs)
                    if fator==1:
                        for r in linhas:r[4]/=100
                    if linhas:prog_anos.add(ano);validos.add(ano)
                    b=compacto(dict(versao=1,base=base,medida=programa,ano=ano,uf=uf,linhas=linhas))+b'\n'
                    recortes[f'{ano}:{uf}']=dict(trecho=[len(rb),len(b),hashlib.sha256(b).hexdigest()],total=len(local),validos=len(linhas),condicoes=[int(contagens.get(c,0)) for c in range(6)])
                    rb.extend(b)
            indexes[programa]=dict(versao=1,base=base,medida=programa,anos=legado['anos'],anos_com_valor=sorted(prog_anos),recortes=recortes)
        arq=gravar(saida,'economia_referencias_'+base+'_rankings',bytes(rb),'ndjson');rankrefs[base]={}
        for programa,idx in indexes.items():
            idx['arquivo']=arq;rankrefs[base][programa]=gravar(saida,'economia_referencias_'+base+'_ranking_'+programa,idx)
        anos_validos[base]=sorted(validos)
    anos_validos['pib']=sorted({int(r.ano) for r in antigo.itertuples() if pd.notna(r.as_pbf_pib_pct) or pd.notna(r.as_bpc_pib_pct)})
    downloads=[]
    for formato in ['csv','parquet','dta']:
        p=saida/'gold/assistencia'/('temporario.'+formato)
        if formato=='csv':df.to_csv(p,index=False,na_rep='',encoding='utf-8-sig',float_format='%.17g')
        elif formato=='parquet':df.to_parquet(p,index=False,compression='zstd')
        else:df.to_stata(p,write_index=False,version=118,variable_labels={c:('Estimativa: pagamentos / (massa dezembro x 12) x 100' if c.endswith('_rais_pct') else 'Estimativa anual RAIS: dezembro x 12, sem 13o' if c=='as_rais_massa_ano_est' else c) for c in df.columns})
        body=p.read_bytes();p.unlink();r=gravar(saida,'economia_referencias_base',body,formato);downloads.append(dict(formato=formato,**r))
    variaveis={c:c for c in df.columns}
    variaveis.update(cod_ibge='Código IBGE do município; cadastro territorial atual.',ano='Ano dos pagamentos e da referência; desde 2013.',municipio='Nome do município.',uf='Sigla da UF.',
        as_populacao='População residente IBGE; conferir as_pop_ano_base. Em 2023 usa Censo 2022, sem criar estimativa 2023.',as_pop_ano_base='Ano da população usada; pode diferir do ano dos pagamentos em 2023.',
        as_rais_massa_dez='Soma nominal observada das remunerações de dezembro dos vínculos ativos em 31/12; sem remuneração declarada não é zero.',as_rais_massa_ano_est=NOTA_RAIS,
        as_rais_n_rem_dez='Vínculos ativos com remuneração positiva informada em dezembro.',as_rais_vinculos='Vínculos ativos em 31/12; não são pessoas únicas.',
        as_rais_cobertura_pct='100 × vínculos com remuneração positiva informada / vínculos ativos. Não ajusta nem imputa remuneração ausente.',as_pib='PIB nominal IBGE do mesmo ano, em reais; preservado da base publicada.')
    for prog in PROGRAMAS:
        variaveis['as_'+prog+'_pago_ano']='Pagamentos nominais nos 12 meses; ausente se ano incompleto. Total exige os dois programas completos.'
        for base,suf in [('populacao','percapita'),('rais','rais_pct'),('pib','pib_pct')]:
            variaveis['as_'+prog+'_'+suf]=('Pagamentos anuais / população residente: R$ por habitante.' if base=='populacao' else '100 × pagamentos anuais / '+('massa salarial formal anual ESTIMADA (dezembro × 12).' if base=='rais' else 'PIB nominal do mesmo ano.'))
            variaveis['as_'+prog+'_'+base+'_cond']='0 registrado; 1 sem pagamentos; 2 menos de 12 meses válidos; 3 denominador ausente; 4 denominador zero; 5 denominador inválido.'
    for prog in ['pbf','bpc']:variaveis['as_'+prog+'_meses']='Meses válidos no ano (0 a 12). Não se estima pagamento ausente.'
    dic=gravar(saida,'economia_referencias_dicionario',dict(variaveis=variaveis,nota_rais=NOTA_RAIS,nota_rais_en=NOTA_RAIS_EN,
        cobertura='PBF/Auxílio Brasil não inclui o Benefício Extraordinário (2021–2023). BPC inclui retroativos já presentes no total. Não mede impacto causal ou parcela da renda das famílias.'))
    meta=dict(versao=1,gerado_em=datetime.now(timezone.utc).isoformat(),anos=legado['anos'],anos_com_valor=anos_validos,
        arquivo=arquivo,grupos=grupos,indices_uf=indices,rankings=rankrefs,downloads=downloads,dicionario=dic,
        fontes=dict(adquirido_em=prov['adquirido_em'],arquivos={k:{a:b for a,b in ref.items() if a!='local'} for k,ref in prov['arquivos'].items()}),fontes_oficiais=dict(rais=global_m['fontes']['rais']['url'],populacao='https://sidra.ibge.gov.br/tabela/6579',pib='https://sidra.ibge.gov.br/tabela/5938',pagamentos='https://portaldatransparencia.gov.br'),legado_sha256=sha(root/'gold/assistencia/economia_manifesto.json'),nota_rais=NOTA_RAIS,nota_rais_en=NOTA_RAIS_EN)
    (saida/'gold/assistencia/referencias_manifesto.json').write_bytes(compacto(meta))
    report=dict(ok=True,municipios=len(municipal),grupos=len(cadastro),linhas=len(df),anos_com_valor=anos_validos,bytes_series=len(bruto),fontes_sha256=sha(root/'proveniencia.json'))
    (saida/'validacao_referencias.json').write_bytes(compacto(report))
    print(json.dumps(report,ensure_ascii=True),flush=True)
    return meta


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fontes',type=Path,required=True);p.add_argument('--saida',type=Path,required=True)
    a=p.parse_args();gerar(a.fontes,a.saida)
