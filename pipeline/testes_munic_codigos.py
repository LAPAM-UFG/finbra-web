"""Regressão da divergência real de códigos dos quadros de RH nas planilhas do IBGE."""
from munic import codigo_do_dicionario, ler_dicionario

for prefix in ('mreh','ereh'):
    headers={f'{prefix}01{i}' for i in range(1,7)}
    for i in range(1,7):
        assert codigo_do_dicionario(f'{prefix.upper()}011{i}',headers)==f'{prefix}01{i}'
    assert codigo_do_dicionario(f'{prefix}0111',headers|{f'{prefix}0111'})==f'{prefix}0111'
    assert codigo_do_dicionario(f'{prefix}0117',headers) is None
    assert codigo_do_dicionario(f'{prefix}0311',headers) is None
    assert codigo_do_dicionario('MREH0111',set()) is None

class Livro:
    abas=['Dicionário']
    def linhas(self,aba):
        return iter([
            ['1. Composição do quadro de pessoal da administração direta'],
            ['', 'Estatutários','','','','MREH0111'],
            ['Total (1)','','','','','MREH0116'],
            ['2. Composição do quadro de pessoal da administração indireta'],
            ['', 'Estatutários','','','','MREH031'],
        ])

d=ler_dicionario(Livro(),{'mreh011','mreh016','mreh031'})
assert d['mreh011']['rotulo']=='Estatutários'
assert d['mreh016']['rotulo']=='Total'
assert 'direta' in d['mreh016']['tema'] and 'indireta' not in d['mreh016']['tema']
assert 'indireta' in d['mreh031']['tema']
print('Códigos de RH: aliases estritos, prioridade exata, campos ausentes e contextos validados.')
