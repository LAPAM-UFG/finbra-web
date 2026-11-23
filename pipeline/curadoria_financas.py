"""Rótulos e proveniência compartilhados pelo download e comparações financeiras."""
import json
import re
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def definicoes():
    return json.loads((Path(__file__).resolve().parents[1] / 'shared/indicadores_financas.json').read_bytes())


def curar(campo, entrada):
    definicao = definicoes().get(campo) or definicoes().get(entrada.get('variavel',''))
    if not definicao:
        return dict(entrada)
    out={**entrada, **{k: v for k, v in definicao.items() if k != 'url'},'descricao_en':definicao['nome_en']+'. Official source: '+definicao['fonte']+'. Source values, units, period and coverage are preserved; see the indicator method for derived measures.'}
    if 'SIOPE'in definicao['fonte']and'aluno'in (campo+' '+entrada.get('variavel','')):
        out['descricao']=definicao['nome']+'. Indicador publicado pelo FNDE/SIOPE, preservado sem dividir novamente pelas matrículas do Censo Escolar. Não inferir participação dos gastos com professores a partir de razões com universos não confirmados.'
        out['descricao_en']=definicao['nome_en']+'. Indicator published by FNDE/SIOPE, retained without dividing again by School Census enrolments. Do not infer the share of teacher expenditure from ratios whose population scopes have not been confirmed.'
    return out


def fontes(campo):
    d = definicoes().get(campo)
    return [dict(nome=d['fonte'], url=d['url'])] if d else []


def rotulo_preco(nome, base, ingles=False):
    """Uma única indicação da base, inclusive para salários já publicados em reais."""
    if not re.search(r'\bnomina(?:l|is)\b', nome, re.I) and re.search(r'(?:IPCA|\breal\b|\breais\b|Dec|dez).*'+str(base), nome, re.I):
        return nome
    nome = re.sub(r'\s*\bnomina(?:l|is)\b', '', nome, flags=re.I)
    return nome + (f' (Dec/{base} IPCA)' if ingles else f' (IPCA dez/{base})')
