"""Coletores oficiais dos painéis temáticos; saída sempre em pasta candidata."""
import importlib
import json
import re
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from assistencia_utils import salvar_json
from atualizacao_artefatos import sha
from automacao_contexto import REPO


def ler(p):return json.loads(Path(p).read_bytes())


def fatos(refs):
    """Datas de consulta e cabeçalhos voláteis não alteram os valores da fonte."""
    return sorted([{k:r[k]for k in ('arquivo','url','ano','tipo','sha256','bytes')if k in r}for r in refs],key=lambda r:r.get('arquivo',r.get('url','')))


def guardar(ctx,names):
    ctx.insumos=[ctx.fontes/n for n in names]
    absent=[str(p)for p in ctx.insumos if not p.is_file()]
    if absent:raise ValueError('Insumos incompletos: '+str(absent))


def construir(ctx,area):
    ctx.preparar_painel(area)
    if area in ('internet','energia','comex'):ctx.populacao()
    if area=='energia':ctx.grafo(ler(ctx.fontes/'gold/energia/manifesto.json'))
    if area=='mobilidade':ctx.ref(ler(ctx.fontes/'gold/mobilidade/manifesto.json')['catalogo'])
    out=ctx.raiz/'painel'
    importlib.import_module(area).gerar(ctx.fontes,out)
    ctx.aplicar(out)
    ctx.painel=out
    return True


def energia(ctx):
    import energia_fontes as f
    refs=[]
    for slug,names in f.RECURSOS.items():
        ctx.obter_oficial('https://dadosabertos.aneel.gov.br/api/3/action/package_show?id='+slug,slug+'.json')
        package=ler(ctx.fontes/(slug+'.json'))
        if package.get('success')is not True:raise ValueError('Catálogo ANEEL inválido')
        for name in names:
            resource=next(x for x in package['result']['resources']if x['name']==name)
            refs.append(dict(arquivo=name,url=resource['url'],recurso=resource['id'],modificado=resource.get('last_modified'),hash=resource.get('hash')))
    # Verifica os objetos, pois nem toda retificação altera o package_show.
    from automacao_contexto import versao_http
    versions=[dict(r,versao=versao_http(r['url']))for r in refs]
    snapshot=dict(versoes=versions,normalizador=sha(REPO/'pipeline/energia_fontes.py'))
    unstable=any(r['versao']is None for r in versions)
    changed=ctx.mudou(snapshot,codigo=('energia.py','energia_fontes.py','energia_definicoes.py'))or unstable
    names=['energia_normalizada.json','mmgd_municipios.parquet','mmgd_referencias.parquet','mmgd_coortes.parquet','siga_usinas.parquet','siga_localizacoes.parquet']
    if changed:
        if unstable or(ctx.anterior or {}).get('fatos')!=snapshot or not all((ctx.fontes/n).is_file()for n in names):
            f.adquirir(ctx.fontes);ctx.preparar_painel();f.normalizar(ctx.fontes)
        construir(ctx,'energia')
    ctx.fatos=snapshot;guardar(ctx,names)
    return changed


def comex(ctx):
    import comex_fontes as f
    # Inclui anos antigos: o MDIC também retifica exercícios encerrados.
    ctx.revalidar(list(ctx.fontes.glob('*.fonte.json')))
    for name in ('pagina_mdic.html','atualizacao_api.json'):
        ctx.excluir_copia(ctx.fontes/name);ctx.excluir_copia(ctx.fontes/(name+'.fonte.json'))
    f.adquirir(ctx.fontes);meta=ler(ctx.fontes/'fontes_comex.json')
    changed=ctx.mudou(dict(periodos=meta['periodos'],arquivos=fatos(meta['arquivos'])),codigo=('comex.py','comex_fontes.py','comex_extra.py','comex_artefatos.py','comex_definicoes.py'))
    if changed:construir(ctx,'comex')
    guardar(ctx,['fontes_comex.json',*[r['arquivo']for r in meta['arquivos']],*[p.name for p in ctx.fontes.glob('*.fonte.json')]])
    return changed


def agropecuaria(ctx):
    import agropecuaria_fontes as f
    ctx.preparar_painel('agropecuaria')
    # As chamadas SIDRA são refixadas em cada rodada para captar retificações.
    for p in list((ctx.fontes/'sidra').glob('*'))+list(ctx.fontes.glob('unidades_*.json'))+list(ctx.fontes.glob('metadados_*.json')):ctx.excluir_copia(p)
    f.adquirir(ctx.fontes,ctx.fontes/'geografia.json',workers=4)
    meta=ler(ctx.fontes/'fontes.json');changed=ctx.mudou(dict(anos=meta['anos'],lotes=fatos(meta['lotes'])),codigo=('agropecuaria.py','agropecuaria_fontes.py'))
    if changed:construir(ctx,'agropecuaria')
    guardar(ctx,['fontes.json',*[str(p.relative_to(ctx.fontes)).replace('\\','/')for p in ctx.fontes.glob('metadados_*.json')],*[str(p.relative_to(ctx.fontes)).replace('\\','/')for p in ctx.fontes.glob('unidades_*.json')],*[r['arquivo']for r in meta['lotes']]])
    return changed


def internet(ctx):
    import internet_fontes as f
    import internet_smp_fontes as s
    from automacao_contexto import versao_http
    scm='https://www.anatel.gov.br/dadosabertos/paineis_de_dados/acessos/acessos_banda_larga_fixa.zip'
    versions=[versao_http(u)for u in (scm,s.URL)]
    snapshot=dict(versoes=versions,normalizadores={name:sha(REPO/'pipeline'/name)for name in ('internet_fontes.py','internet_smp_fontes.py')})
    # Sem validador confiável, coleta novamente e compara o conteúdo.
    stable=all(versions)and snapshot==(ctx.anterior or {}).get('fatos')
    names=['anatel_normalizado.json','municipio_mensal.parquet','mercado_referencias.parquet','smp_normalizado.json','smp_municipio_mensal.parquet','smp_fonte.json']
    if not stable or not all((ctx.fontes/n).is_file()for n in names):
        ctx.preparar_painel('internet')
        f.adquirir(ctx.fontes);f.normalizar(ctx.fontes,fixar_base=False)
        expanded=ctx.raiz/'fixa_ampliada';s.ampliar_fixa(ctx.fontes,expanded)
        for n in names[:3]:shutil.copy2(expanded/n,ctx.fontes/n)
        meta=s.adquirir(ctx.fontes);s.normalizar(ctx.fontes,meta)
    evidence=dict(versoes=versions,scm=ler(ctx.fontes/names[0])['fonte']['sha256'],smp=fatos(ler(ctx.fontes/'smp_fonte.json')['membros']))
    changed=ctx.mudou(evidence,codigo=('internet.py','internet_fontes.py','internet_smp_fontes.py'))
    if changed:construir(ctx,'internet')
    ctx.fatos=snapshot;guardar(ctx,names)
    # O cache guarda somente agregados. Libera os CSV e DuckDB volumosos antes
    # de gerar os downloads, especialmente quando uma população nova afeta temas.
    for name in ('banda_larga.zip','csv','trabalho','csv_smp','trabalho_smp','telefonia_movel.zip.parcial'):
        ctx.descartar_temporario(ctx.fontes/name)
    return changed


def educacao(ctx):
    import educacao_baixar as f
    from educacao_redes import gerar
    page=f.pagina(f.PAGINAS['censo']);years=sorted({int(m[1])for u,_ in f.links(page)if(m:=re.search(r'microdados_censo_escolar_(\d{4})_?\.zip$',u))and int(m[1])>=2013})
    if not years or years!=list(range(2013,max(years)+1)):raise ValueError('Catálogo do Censo Escolar incompleto')
    ctx.preparar_painel('educacao');old=ler(ctx.fontes/'gold/educacao/manifesto.json')
    previous={k:max((max(i['anos'])for i in old['indicadores']if i['fonte']==k and i.get('anos')),default=2013)for k in ('rendimento','distorcao')}
    # Arquivos municipais de rendimento, distorção e Ideb também são revalidados.
    for kind in ('rendimento','distorcao','ideb'):
        for p in(ctx.fontes/kind).glob('*'):
            if p.is_file():ctx.excluir_copia(p)
    m=f.coletar(ctx.fontes,2013,max(years),revalidar=True,cobertura_anterior=previous)
    changed=ctx.mudou(dict(censo=[dict(ano=r['ano'],url=r['url'],arquivos=fatos(r['arquivos']))for r in m['censo']],indicadores=fatos(m['indicadores'])),codigo=('educacao.py','educacao_baixar.py','educacao_redes.py'))
    if changed:
        out=ctx.raiz/'painel';gerar(ctx.fontes,ctx.base,out,ctx.raiz/'redes',fontes_atualizadas=True)
        # O bloco financeiro é independente do Censo e deve acompanhar o SIOPE.
        from educacao_redes import incorporar_financeiro
        if old.get('financeiro'):
            ctx.grafo(old['financeiro']);fin=ctx.ref(old['financeiro']);target=ctx.fontes/'gold/educacao/financeiro_manifesto.json';shutil.copy2(fin,target)
            incorporar_financeiro(out,ctx.fontes)
        ctx.aplicar(out);ctx.painel=out
    # Somente registros agregados por escola, sem alunos ou docentes individuais.
    names=['coleta.json']+[str(p.relative_to(ctx.fontes)).replace('\\','/')for p in ctx.fontes.rglob('*')if p.is_file()and (p.relative_to(ctx.fontes).parts[0].isdigit()or p.relative_to(ctx.fontes).parts[0]in ['rendimento','distorcao','ideb'])]
    guardar(ctx,names);return changed


def seguranca(ctx):
    import seguranca_fontes as f
    import seguranca_sinesp as n
    ctx.preparar_painel('seguranca')
    # Catálogo público e arquivos estaduais; nenhum registro individual.
    if (ctx.fontes/'sinesp_fontes.json').exists():
        for r in ler(ctx.fontes/'sinesp_fontes.json')['arquivos']:
            ctx.obter_oficial(r['url'],r['arquivo'])
    f.adquirir(ctx.fontes);meta=ler(ctx.fontes/'sinesp_fontes.json')
    sim_publicado(ctx,'seguranca')
    changed=ctx.mudou(dict(sinesp=fatos(meta['arquivos']),sim=sha(ctx.fontes/'sim_seguranca.parquet')),codigo=('seguranca.py','seguranca_sinesp.py','seguranca_definicoes.py'))
    if changed:
        n.gerar(ctx.fontes);sim_publicado(ctx,'seguranca');construir(ctx,'seguranca')
    guardar(ctx,['sinesp_fontes.json','sinesp_normalizado.json','sinesp_anual.parquet','sinesp_mensal.parquet',*[r['arquivo']for r in meta['arquivos']]])
    return changed


def sim_publicado(ctx,area):
    """O job do SIM deixa estes agregados sem identificadores no cache privado."""
    from automacao_insumos import Insumos
    names=['sim.json','sim_normalizado.parquet']if area=='mobilidade'else['sim_seguranca.json','sim_seguranca.parquet']
    if all((ctx.fontes/n).is_file()for n in names):return
    cache=Insumos(ctx.cache.client,ctx.cache.bucket,'saude_sim',ctx.raiz/'sim');state=cache.restaurar()
    for name in names:
        p=cache.raiz/name
        if not p.is_file():raise ValueError('Execute saude_sim antes de '+area+': agregado protegido ausente')
        shutil.copy2(p,ctx.fontes/name)


def mobilidade(ctx):
    import mobilidade_fontes as f
    import mobilidade_perfis_fontes as pf
    import mobilidade_normalizar as n
    import mobilidade_perfis as p
    from datetime import datetime
    from zoneinfo import ZoneInfo
    from atualizacao_fontes import HTTP
    ctx.preparar_painel('mobilidade')
    # Só retratos de dezembro publicados; a página corrente não implica ano fechado.
    years=list(range(2013,datetime.now(ZoneInfo('America/Sao_Paulo')).year))
    for y in years:
        r=HTTP.get(f.BASE+f'frota-de-veiculos-{y}',timeout=(20,90))
        if r.status_code==404 and y>max(ler(ctx.fontes/'gold/mobilidade/manifesto.json')['anos']):break
        r.raise_for_status()
        try:f.descobrir(r.text,r.url,y)
        except (ValueError,AssertionError):
            if y>max(ler(ctx.fontes/'gold/mobilidade/manifesto.json')['anos']):break
            raise
        target=ctx.fontes/'senatran'/f'pagina_{y}.html';target.parent.mkdir(exist_ok=True);target.write_text(r.text,encoding='utf-8')
    else:y+=1
    f.ANOS[:]=list(range(2013,y))
    for folder in ['senatran','senatran_perfis']:
        for meta in(ctx.fontes/folder).glob('*.json'):
            old=ler(meta);ctx.obter_oficial(old['url'],old['arquivo'])
            old.update(sha256=sha(ctx.fontes/old['arquivo']),bytes=(ctx.fontes/old['arquivo']).stat().st_size);salvar_json(meta,old)
    f.adquirir(ctx.fontes);pf.adquirir(ctx.fontes)
    refs=ler(ctx.fontes/'senatran.json')['arquivos']+ler(ctx.fontes/'senatran_perfis.json')['arquivos']
    sim_publicado(ctx,'mobilidade')
    changed=ctx.mudou(dict(senatran=fatos(refs),sim=sha(ctx.fontes/'sim_normalizado.parquet')),codigo=('mobilidade.py','mobilidade_perfis.py','mobilidade_normalizar.py'))
    if changed:n.normalizar(ctx.fontes);p.normalizar(ctx.fontes);sim_publicado(ctx,'mobilidade');construir(ctx,'mobilidade')
    guardar(ctx,['senatran.json','senatran_perfis.json','normalizados.json','normalizados_perfis.json',*[r['arquivo']for r in refs],*[r['arquivo']for r in ler(ctx.fontes/'normalizados.json')['arquivos']],*[r['arquivo']for r in ler(ctx.fontes/'normalizados_perfis.json')['arquivos']]])
    return changed
