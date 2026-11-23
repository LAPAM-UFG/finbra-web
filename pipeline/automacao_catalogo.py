"""Calendário e dependências das fontes que ainda eram atualizadas à mão."""
from dataclasses import dataclass, asdict
from datetime import datetime
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Rotina:
    id: str
    dia: int
    fontes: tuple[str, ...]
    areas: tuple[str, ...]
    executora: str


ROTINAS = (
    Rotina('rais', 1, ('rais', 'rais_micro', 'rais_perfis'), ('trabalho', 'assistencia'), 'rais'),
    Rotina('ibge', 2, ('ibge_populacao', 'ibge_pib'), ('financas', 'assistencia', 'territoriais'), 'ibge'),
    Rotina('previdencia', 3, ('inss',), ('financas', 'assistencia'), 'previdencia'),
    Rotina('siope', 4, ('siope',), ('educacao', 'trabalho', 'financas'), 'siope'),
    Rotina('siops', 6, ('siops',), ('saude', 'financas'), 'siops'),
    Rotina('saude_sim', 7, ('sim', 'sinasc', 'populacao_svs'), ('saude', 'mobilidade', 'seguranca'), 'saude'),
    Rotina('saude_sih', 8, ('sih', 'icsap'), ('saude',), 'saude'),
    Rotina('saude_cnes', 9, ('cnes',), ('saude',), 'saude'),
    Rotina('saude_sia', 10, ('sia',), ('saude',), 'saude'),
    Rotina('saude_agravos', 11, ('sinan', 'resp'), ('saude',), 'saude'),
    Rotina('saude_cancer', 12, ('siscan', 'oncologia'), ('saude',), 'saude'),
    Rotina('aps', 13, ('aps',), ('saude',), 'aps'),
    Rotina('fns', 14, ('fns',), ('saude',), 'fns'),
    Rotina('vacinacao', 16, ('vacinacao',), ('saude',), 'vacinacao'),
    Rotina('assistencia', 17, ('cadunico', 'bpc', 'pbf_mds'), ('assistencia',), 'assistencia'),
    Rotina('educacao', 18, ('censo', 'rendimento', 'distorcao', 'ideb', 'saeb'), ('educacao',), 'educacao'),
    Rotina('saneamento', 19, ('snis', 'sinisa'), ('saneamento',), 'saneamento'),
    Rotina('agropecuaria', 20, ('pam', 'ppm', 'pevs'), ('agropecuaria',), 'agropecuaria'),
    Rotina('mobilidade', 21, ('senatran',), ('mobilidade',), 'mobilidade'),
    Rotina('seguranca', 22, ('sinesp',), ('seguranca',), 'seguranca'),
    Rotina('internet', 23, ('anatel_scm', 'anatel_smp'), ('internet',), 'internet'),
    Rotina('energia', 24, ('aneel_mmgd', 'aneel_siga'), ('energia',), 'energia'),
    Rotina('comex', 25, ('comexstat',), ('comex',), 'comex'),
)
POR_ID = {r.id: r for r in ROTINAS}
EXISTENTES = {'siconfi', 'siconfi_lrf', 'ipca', 'bolsa_familia', 'caged', 'caged_cbo', 'munic', 'estadic', 'clima'}
DERIVADAS = {'populacao_declarada', 'assistencia', 'munic_painel'}


def selecionar(ids=None, agora=None):
    if ids:
        if ids == ['todas']:return list(ROTINAS)
        desconhecidas = set(ids) - POR_ID.keys()
        if desconhecidas:raise ValueError('Rotinas desconhecidas: ' + ', '.join(sorted(desconhecidas)))
        return [r for r in ROTINAS if r.id in ids]
    agora = agora or datetime.now(ZoneInfo('America/Sao_Paulo'))
    if agora.tzinfo is None:raise ValueError('O calendário exige uma data com fuso horário')
    dia = agora.astimezone(ZoneInfo('America/Sao_Paulo')).day
    return [r for r in ROTINAS if r.dia == dia]


def validar_cobertura(manifesto):
    registradas = EXISTENTES | DERIVADAS | {f for r in ROTINAS for f in r.fontes}
    ausentes = set(manifesto['fontes']) - registradas
    if ausentes:raise ValueError('Fontes sem rotina: ' + ', '.join(sorted(ausentes)))
    return dict(ok=True, rotinas=[asdict(r) for r in ROTINAS], fontes_globais=len(manifesto['fontes']))


if __name__=='__main__':
    import argparse,json
    p=argparse.ArgumentParser();p.add_argument('--rotinas',nargs='*');args=p.parse_args()
    print(json.dumps([r.id for r in selecionar(args.rotinas)]))
