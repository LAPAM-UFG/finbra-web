"""Atualização incremental de anos completos do DATASUS, sem publicar microdados."""
import argparse
import ftplib
import json
import os
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import duckdb
import pandas as pd

from assistencia_utils import salvar_json
from atualizacao_artefatos import sha
from automacao_temas import guardar,ler
from automacao_insumos import caminho_relativo
from config import UF_POR_CODIGO

UFS=set(UF_POR_CODIGO.values())
RAIZ='/dissemin/publicos/'
PASTAS={
 'sim':['SIM/CID10/DORES','SIM/CID10/DOFET'],
 'sinasc':['SINASC/1996_/Dados/DNRES'],
 'populacao_svs':['IBGE/POPSVS'],
 'sih':['SIHSUS/200801_/Dados'],
 'cnes':['CNES/200508_/Dados/'+v for v in ('ST','LT','PF')],
 'sia':['SIASUS/200801_/Dados'],
 'sinan':['SINAN/DADOS/FINAIS'],
 'resp':['RESP/DADOS'],
 'siscan':['SISCAN/SISCAN'],
 'oncologia':['painel_oncologia/Dados'],
}
GRUPOS={
 'saude_sim':['sim','sinasc','populacao_svs'],
 'saude_sih':['sih'],'saude_cnes':['cnes'],'saude_sia':['sia'],
 'saude_agravos':['sinan','resp'],'saude_cancer':['siscan','oncologia'],
}
ARQUIVOS={'sim':['obitos','obitos_fetais'],'sinasc':['nascimentos'],'populacao_svs':['populacao'],'sih':['internacoes','internacoes_atend','icsap'],'cnes':['cnes'],'sia':['ambulatorial','ambulatorial_subgrupo'],'sinan':['sinan'],'resp':['resp'],'siscan':['siscan'],'oncologia':['oncologia'],'aps':['aps_cobertura']}


def listar(pasta):
    from saude_baixar import conectar,arquivos
    ftp=conectar()
    try:
        refs=[]
        for path,size in arquivos(ftp,pasta,False):refs.append(dict(arquivo=caminho_relativo(path),bytes=size))
        return refs
    finally:ftp.quit()


def completos(refs,fonte,ultimo,ano_fechado,primeira=False):
    """Seleciona os dois últimos anos e novas edições somente com todos os arquivos."""
    by={};start=2013 if primeira and fonte=='sim'else max(ultimo-1,2000)
    patterns={
      'sim':r'(DO)([A-Z]{2})(20\d{2})\.dbc',
      'sinasc':r'(DN)([A-Z]{2})(20\d{2})\.dbc',
      'sih':r'(RD)([A-Z]{2})(\d{2})(\d{2})\.dbc',
      'sia':r'(PA)([A-Z]{2})(\d{2})(\d{2})[a-z]?\.dbc',
      'cnes':r'(ST|LT|PF)([A-Z]{2})(\d{2})(12)\.dbc',
    }
    if fonte in patterns:
        for r in refs:
            name=Path(r['arquivo']).name;m=re.fullmatch(patterns[fonte],name,re.I)
            if not m or m[2]not in UFS:continue
            year=int(m[3]);year+=2000 if year<100 else 0
            if not start<=year<=ano_fechado:continue
            by.setdefault(year,[]).append((r,m))
        selected=[]
        for year,rows in sorted(by.items()):
            if fonte in ('sim','sinasc'):ok={m[2]for r,m in rows if '/DOFET/'not in r['arquivo']}==UFS
            elif fonte=='cnes':ok={(m[1],m[2])for r,m in rows}=={(kind,uf)for kind in ('ST','LT','PF')for uf in UFS}
            else:ok={(m[2],int(m[4]))for r,m in rows}=={(uf,month)for uf in UFS for month in range(1,13)}
            if not ok:
                if year<=ultimo:raise ValueError(f'{fonte} {year}: edição publicada perdeu arquivos oficiais')
                continue
            selected.extend(r for r,_ in rows)
        if not selected or ultimo not in by:raise ValueError('Fonte anual sem o último ano publicado: '+fonte)
        if fonte=='sim':
            # Os fetais são um arquivo nacional por ano, diferente dos 27 DORES.
            years={int(Path(r['arquivo']).stem[-4:])for r in selected}
            fetal=[r for r in refs if '/DOFET/'in r['arquivo']and re.fullmatch(r'DOFET(\d{2})\.dbc',Path(r['arquivo']).name)and 2000+int(Path(r['arquivo']).stem[-2:])in years]
            if {2000+int(Path(r['arquivo']).stem[-2:])for r in fetal}!=years:raise ValueError('SIM fetal sem todos os anos definitivos')
            selected += fetal
        return selected
    if fonte=='populacao_svs':
        selected=[r for r in refs if (m:=re.fullmatch(r'POPSBR(\d{2})\.zip',Path(r['arquivo']).name,re.I))and 2000+int(m[1])<=ano_fechado]
        if not selected:raise ValueError('População SVS sem arquivos anuais')
        return selected
    if fonte=='siscan':
        for r in refs:
            m=re.fullmatch(r'SISCAN_(CITO_COLO|MAMOGRAFIA|HISTO_COLO|HISTO_MAMA)_(20\d{2})\.csv',Path(r['arquivo']).name,re.I)
            if m and start<=int(m[2])<=ano_fechado:by.setdefault(int(m[2]),[]).append((r,m))
        return [r for y,rows in by.items()if len(rows)==4 for r,m in rows]
    prefixes={'sinan':['DENG','CHIK','TUBE','HANS','VIOL'],'resp':['RESP'],'oncologia':['PO']}[fonte]
    for prefix in prefixes:
        rows=[]
        for r in refs:
            m=re.fullmatch(prefix+r'BR(\d{4}|\d{2})\.dbc',Path(r['arquivo']).name,re.I)
            if m:
                y=int(m[1]);y+=2000 if y<100 else 0
                if y<=ano_fechado+(1 if fonte=='oncologia'else 0):rows.append((y,r))
        if not rows:raise ValueError('Série oficial ausente: '+prefix)
        # Cada agravo tem cobertura própria; não estende tuberculose artificialmente.
        last=max(y for y,r in rows);minimum=2000 if fonte in ('sinan','oncologia')else max(last-1,start)
        by[prefix]=[r for y,r in rows if y>=minimum]
    return [r for rows in by.values()for r in rows]


def saude(ctx):
    fontes=GRUPOS[ctx.rotina.id];manifest=ler(ctx.base/'gold/manifesto.json');closed=datetime.now(ZoneInfo('America/Sao_Paulo')).year-1
    selected={}
    for source in fontes:
        refs=[]
        for folder in PASTAS[source]:refs+=listar(folder)
        selected[source]=completos(refs,source,max(manifest['fontes'][source]['anos']),closed,primeira=not ctx.anterior)
    # Consulta a versão só dos arquivos escolhidos, evitando milhares de MDTM
    # de outros sistemas/anos presentes no mesmo diretório público.
    from saude_baixar import conectar
    ftp=conectar()
    try:
        for rows in selected.values():
            for ref in rows:
                try:ref['modificado']=ftp.sendcmd('MDTM '+RAIZ+ref['arquivo'])
                except ftplib.error_perm:ref['modificado']=None
    finally:ftp.quit()
    # Sem MDTM, sempre baixa: tamanho igual não comprova mesma versão.
    evidence=selected if all(r.get('modificado')for rows in selected.values()for r in rows)else dict(arquivos=selected,consulta=datetime.now().isoformat())
    changed=ctx.mudou(evidence,codigo=('automacao_saude.py','saude.py','chikungunya.py','icsap.py','mobilidade_sim.py','seguranca_sim.py'))
    if not changed:guardar(ctx,[str(p.relative_to(ctx.fontes))for p in ctx.fontes.glob('*.json')]+[str(p.relative_to(ctx.fontes))for p in ctx.fontes.glob('*.parquet')]);return False
    from saude_baixar import baixar
    raw=ctx.raiz/'brutos/saude';micro=ctx.raiz/'micro'
    def fetch(r):
        n=baixar(r['arquivo'],r['bytes'],raw)
        p=raw/r['arquivo']
        if not p.is_file()or p.stat().st_size!=r['bytes']:raise ValueError('Download DATASUS incompleto: '+r['arquivo'])
        if r.get('modificado'):
            from saude_baixar import _conexao
            if _conexao().sendcmd('MDTM '+RAIZ+r['arquivo'])!=r['modificado']:raise ValueError('Fonte DATASUS mudou durante a aquisição')
        return dict(r,sha256=sha(p))
    with ThreadPoolExecutor(max_workers=3)as pool:rows=list(pool.map(fetch,[r for v in selected.values()for r in v]))
    salvar_json(ctx.fontes/'fontes_saude.json',dict(fontes=fontes,arquivos=rows))
    # Cada arquivo é convertido/agregado uma vez; o original é descartado após uso.
    for ref in rows:
        p=raw/ref['arquivo']
        if p.suffix.lower()!='.dbc':continue
        target=(micro/ref['arquivo']).with_suffix('.parquet')
        if ref['arquivo'].startswith('SIASUS/'):
            from sia import agregar
            year=2000+int(p.name[4:6]);target=ctx.raiz/f'sia/{year}/{p.stem}.parquet';result=agregar(str(p),str(target));error=result[-1]
        else:
            from saude_micro import converter
            result=converter(str(p),str(target));error=result[-1]
        if error:raise ValueError(error)
        p.unlink() # somente o arquivo efêmero recém-baixado desta rotina
    parsed=ctx.raiz/'processado';ctx.executar('automacao_saude.py','processar','--base',ctx.base,'--saida',parsed,'--micro',micro,'--brutos',raw,'--sia',ctx.raiz/'sia','--fontes',*fontes,data_dir=ctx.base)
    for source in fontes:
        for name in ARQUIVOS[source]:mesclar(ctx.base/f'gold/saude/{name}.parquet',parsed/f'{name}.parquet')
    ctx.executar('automacao_saude.py','recompor','--base',ctx.base,'--fontes',*fontes,data_dir=ctx.base)
    if 'sim'in fontes:
        ctx.preparar_painel()
        do=micro/'SIM/CID10/DORES';anos=sorted({int(p.stem[-4:])for p in do.glob('*.parquet')})
        for area,meta,parq in [('mobilidade','sim.json','sim_normalizado.parquet'),('seguranca','sim_seguranca.json','sim_seguranca.parquet')]:
            old=ctx.fontes/parq;backup=ctx.raiz/('anterior_'+parq)
            if old.exists():shutil.copy2(old,backup)
            __import__(area+'_sim').gerar(do,ctx.fontes,anos_selecionados=anos)
            if backup.exists():
                mesclar(backup,ctx.fontes/parq);shutil.copy2(backup,ctx.fontes/parq)
                m=ler(ctx.fontes/meta);m['anos']=sorted(pd.read_parquet(ctx.fontes/parq).ano.unique().tolist());m['agregado'].update(sha256=sha(ctx.fontes/parq),bytes=(ctx.fontes/parq).stat().st_size);salvar_json(ctx.fontes/meta,m)
    guardar(ctx,['fontes_saude.json',*(['sim.json','sim_normalizado.parquet','sim_seguranca.json','sim_seguranca.parquet']if 'sim'in fontes else[])])
    return True


def mesclar(old,new,coluna='ano'):
    """Substitui somente anos completos; uma coluna histórica nunca desaparece."""
    a=pd.read_parquet(old);b=pd.read_parquet(new)
    if b.empty or not set(a.columns)<=set(b.columns):raise ValueError('Agregado vazio ou com colunas perdidas: '+str(new))
    years=set(b[coluna].unique());out=pd.concat([a[~a[coluna].isin(years)],b],ignore_index=True)
    tmp=old.with_suffix('.novo.parquet');out.to_parquet(tmp,index=False,compression='zstd');os.replace(tmp,old)


def processar(args):
    import saude as s
    s.GOLD_S=args.saida;s.GOLD_S.mkdir(parents=True,exist_ok=True);c=s.conectar()
    try:
        for source in args.fontes:
            if source=='populacao_svs':s.populacao(c,args.brutos)
            elif source=='sih':s.internacoes(c,args.micro);s.agregar_icsap(c,args.micro,s.GOLD_S)
            elif source=='sia':s.ambulatorial(c,args.sia,s.GOLD_S)
            else:getattr(s,dict(sim='obitos',sinasc='nascimentos').get(source,source))(c,args.brutos if source=='siscan'else args.micro)
    finally:c.close()


def recompor(base,fontes=None):
    import saude as s
    s.GOLD=base/'gold';s.SILVER=base/'silver';s.GOLD_S=base/'gold/saude';c=s.conectar()
    try:
        for table in ['populacao','obitos','obitos_fetais','nascimentos','internacoes','internacoes_atend','cnes','sinan','siscan','oncologia','resp','ambulatorial','icsap']:
            c.read_parquet(str(s.GOLD_S/(table+'.parquet'))).create_view(table)
        c.read_parquet(str(s.GOLD_S/'aps_cobertura.parquet')).create_view('aps_cobertura')
        c.execute('CREATE VIEW atencao_primaria AS SELECT ano,municipio,max(cobertura)FILTER(WHERE serie=\'ab\')ab_cobertura,max(cobertura_sf)FILTER(WHERE serie=\'ab\')ab_cobertura_sf,max(equipes_esf)FILTER(WHERE serie=\'ab\')ab_equipes_esf,max(populacao)FILTER(WHERE serie=\'ab\')ab_populacao,max(cobertura)FILTER(WHERE serie=\'aps\')aps_cobertura,max(equipes_esf)FILTER(WHERE serie=\'aps\')aps_equipes_esf,max(equipes_eap)FILTER(WHERE serie=\'aps\')aps_equipes_eap,max(capacidade)FILTER(WHERE serie=\'aps\')aps_capacidade,max(populacao)FILTER(WHERE serie=\'aps\')aps_populacao,max(cobertura)FILTER(WHERE serie=\'acs\')acs_cobertura,max(agentes)FILTER(WHERE serie=\'acs\')acs_agentes,max(populacao)FILTER(WHERE serie=\'acs\')acs_populacao FROM aps_cobertura WHERE mes=12 GROUP BY ano,municipio')
        s.municipios(c)
        m=ler(base/'gold/manifesto.json');novas=s.fonte_saude(c);selected=set(fontes or novas)
        if 'sih'in selected:selected.add('icsap')
        m['fontes'].update({k:v for k,v in novas.items()if k in selected})
        m['gerado_em']=datetime.now(ZoneInfo('America/Sao_Paulo')).isoformat();salvar_json(base/'gold/manifesto.json',m)
    finally:c.close()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('acao',choices=['processar','recompor']);p.add_argument('--base',required=True,type=Path)
    for k in ['saida','micro','brutos','sia']:p.add_argument('--'+k,type=Path)
    p.add_argument('--fontes',nargs='+');a=p.parse_args();processar(a)if a.acao=='processar'else recompor(a.base,a.fontes)
