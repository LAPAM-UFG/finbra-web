"""Mantem as notas metodologicas coerentes com a selecao da edicao atual."""
import re


def texto_metodologia(notas):
    return ('FINBRA — BASE MUNICIPAL ENXUTA\n\n'+'\n\n'.join(notas)+
            '\n\nStata: abra o .dta diretamente. O painel já está declarado quando indicado na página. '
            'Use xtset cod_ibge ano. CSV: UTF-8 BOM, separador ; e decimal vírgula.\n')


def notas_da_edicao(notas, quantidade):
    resultado=[]
    for texto in notas:
        texto=re.sub(r'(Base enxuta: )\d+( variáveis principais)',lambda m:m[1]+str(quantidade)+m[2],texto)
        texto=re.sub(r'(seleção principal de )\d+( indicadores)',lambda m:m[1]+str(quantidade)+m[2],texto)
        texto=re.sub(r'(que mantém )\d+( indicadores)',lambda m:m[1]+str(quantidade)+m[2],texto)
        # Estas frases eram notas da publicacao inicial, nao uma garantia para
        # edicoes futuras. Preserva os conceitos e aponta para a versao atual.
        frases=[f'A seleção principal de {quantidade} indicadores permanece no mesmo objeto imutável.',
                f'A seleção principal de {quantidade} indicadores e os outros temas permanecem nos mesmos objetos imutáveis.',
                f'Os demais temas e a seleção principal de {quantidade} indicadores permanecem nos mesmos objetos imutáveis.',
                f'Não muda os indicadores existentes, outros temas ou a seleção principal de {quantidade} indicadores.']
        for frase in frases:
            texto=texto.replace(frase,'Arquivos e versões de cada tema e da seleção principal estão identificados no dicionário.')
        resultado.append(texto)
    return resultado
