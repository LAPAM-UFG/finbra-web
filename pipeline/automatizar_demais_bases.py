"""Atualização mensal coordenada das demais fontes. Sem --publicar, só candidata."""
import argparse
import importlib
import json
import shutil
from datetime import datetime,timezone
from pathlib import Path

from assistencia_utils import destino_isolado,salvar_json
from atualizacao_artefatos import instalar_overlay,Snapshot,sha
from automacao_catalogo import ROTINAS,POR_ID,selecionar,validar_cobertura
from automacao_contexto import Contexto

EXECUTORAS={
    'rais':('automacao_nucleo','rais'),'ibge':('automacao_nucleo','ibge'),
    'previdencia':('automacao_nucleo','previdencia'),
    'siope':('automacao_nucleo','educacao_saude'),'siops':('automacao_nucleo','educacao_saude'),
    'saude':('automacao_saude','saude'),
    'aps':('automacao_saude_outros','aps'),'fns':('automacao_saude_outros','fns'),'vacinacao':('automacao_saude_outros','vacinacao'),
    'assistencia':('automacao_assistencia','assistencia'),'saneamento':('automacao_saneamento','saneamento'),
    **{x:('automacao_temas',x)for x in ['educacao','agropecuaria','mobilidade','seguranca','internet','energia','comex']},
}


def validar_executoras():
    for r in ROTINAS:
        mod,fn=EXECUTORAS[r.executora]
        if not callable(getattr(importlib.import_module(mod),fn)):raise ValueError('Executora não implementada: '+r.id)


def executar(root,rotinas,publicar=False,stata=None,rscript=None,caches=()):
    import r2
    from atualizar_bases import fixar_base
    from automacao_derivados import core,exportar_temas,fechar,perdas,cobertura_downloads
    from atualizacao_derivados import aberturas
    root=destino_isolado(Path(root))
    if root.exists()and any(root.iterdir()):raise ValueError('Use uma pasta nova para cada consulta às fontes')
    root.mkdir(parents=True,exist_ok=True)
    validar_executoras();base,snap,expected=fixar_base(root,caches);validar_cobertura(json.loads((base/'gold/manifesto.json').read_bytes()))
    out=root/'candidato';instalar_overlay(base,out);client,bucket=r2.cliente();contexts=[];changes=[]
    report=dict(ok=False,publicado=False,rotinas=[r.id for r in rotinas],mudancas=changes)
    def rodar(r,pai=None):
        print('Rotina: '+r.id,flush=True);ctx=Contexto(r,out,snap,root/'rotinas'/r.id,client,bucket,caches)
        if pai and pai.rotina.id=='saude_sim':
            for name in ['sim.json','sim_normalizado.parquet','sim_seguranca.json','sim_seguranca.parquet']:
                if (pai.fontes/name).is_file():shutil.copy2(pai.fontes/name,ctx.fontes/name)
        mod,fn=EXECUTORAS[r.executora];changed=getattr(importlib.import_module(mod),fn)(ctx)
        contexts.append(ctx)
        if changed:changes.append(r.id)
        return ctx
    try:
        for r in rotinas:
            parent=next((c for c in contexts if c.rotina.id=='saude_sim'),None)
            if r.id in ('mobilidade','seguranca')and parent is None:
                from automacao_insumos import Insumos
                available=Insumos(client,bucket,'saude_sim',root/'verificar_sim').ler()
                if available is None:
                    print('Primeira execução: preparando os agregados do SIM necessários ao tema',flush=True)
                    parent=rodar(POR_ID['saude_sim'])
            rodar(r,parent if r.id in ('mobilidade','seguranca')else None)
        if not changes:
            report.update(ok=True,sem_mudanca=True);salvar_json(root/'resultado.json',report)
            return report
        m=json.loads((out/'gold/manifesto.json').read_bytes());m['gerado_em']=datetime.now(timezone.utc).isoformat();salvar_json(out/'gold/manifesto.json',m)
        # Primeiro atualiza os denominadores na seleção principal.
        aberturas(out,root/'aberturas_iniciais')
        core(base,out,snap,root/'downloads_iniciais',contexts,stata,rscript)
        dependencies=[]
        if 'ibge'in changes:dependencies += [(POR_ID[x],None)for x in ('internet','energia','comex')]
        if 'saude_sim'in changes:
            parent=next(c for c in contexts if c.rotina.id=='saude_sim')
            dependencies += [(POR_ID[x],parent)for x in ('mobilidade','seguranca')]
        existing={c.rotina.id for c in contexts}
        for r,parent in dependencies:
            if r.id not in existing:rodar(r,parent)
        if dependencies:
            # As novas edições temáticas podem acrescentar chaves município × ano.
            core(out,out,snap,root/'downloads_dependencias',contexts,stata,rscript)
        exportar_temas(out,snap,root/'downloads_tematicos',contexts,stata,rscript)
        from automacao_pacotes import atualizar as pacotes
        pacotes(out,snap,root/'pacotes')
        fechar(base,out,snap,root/'derivados')
        # Guarda de perda de cobertura nas tabelas canônicas efetivamente alteradas.
        import pyarrow.parquet as pq
        for p in(base/'gold/saude').glob('*.parquet'):
            target=out/p.relative_to(base)
            if target.is_file()and sha(p)!=sha(target):
                names=pq.read_schema(p).names
                keys=[k for k in ['ano','municipio','serie','mes','subgrupo','imunobiologico','nivel','grupo','destino','cod_ibge']if k in names]
                # Alguns componentes possuem chaves compostas próprias, validadas pelo ETL.
                if keys and p.name not in ['vacinacao_catalogo.parquet','fns_composicao.parquet','vacinacao_territorios.parquet','vacinacao.parquet']:perdas(p,target,keys)
        from validar_atualizacao import gerar as validar
        report['cobertura']=cobertura_downloads(base,out,snap,root/'cobertura_downloads')
        # Reusa as entradas já fixadas pelos geradores. O Snapshot confere cada
        # tamanho e SHA novamente, sem repetir downloads de temas preservados.
        locais=[p.parent for p in root.rglob('gold')if p.is_dir()]
        report['validacao']=validar(out,base,root/'validacao',[*locais,snap.raiz,*caches]);report['ok']=True
        states=[(c,c.estado(c.insumos))for c in contexts]
        salvar_json(root/'resultado.json',report)
        if publicar:
            from publicacao_lote import planejar,stage,ativar
            plan=planejar(client,bucket,out,expected);salvar_json(root/'plano_publicacao.json',plan)
            stage(client,bucket,plan)
            for c,state in states:c.cache.enviar(state)
            report['publicacao']=ativar(client,bucket,plan,root/'backup_r2');report['publicado']=True
            salvar_json(root/'resultado.json',report)
            for c,state in states:c.cache.confirmar(state)
        return report
    except BaseException as error:
        report.update(ok=False,erro=type(error).__name__+': '+str(error));salvar_json(root/'resultado.json',report);raise


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raiz',type=Path);p.add_argument('--rotinas',nargs='*');p.add_argument('--listar',action='store_true');p.add_argument('--publicar',action='store_true')
    p.add_argument('--stata',type=Path);p.add_argument('--rscript',type=Path);p.add_argument('--caches',type=Path,nargs='*',default=[]);a=p.parse_args();r=selecionar(a.rotinas)
    if a.listar:print(json.dumps([x.id for x in r]));return
    if not a.raiz:p.error('--raiz é obrigatório')
    if not r:print(json.dumps(dict(ok=True,sem_rotina_hoje=True)));return
    print(json.dumps(executar(a.raiz,r,a.publicar,a.stata,a.rscript,a.caches),ensure_ascii=False))


if __name__=='__main__':main()
