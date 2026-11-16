"""Rankings municipais prontos a partir da comparação anual já publicada.

Um bundle com trechos por programa/ano/UF e índices leves por programa.
Não altera pagamentos, PIB, arquivos de download ou o manifesto global.
"""
import argparse
import copy
import hashlib
import json
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from fractions import Fraction
from pathlib import Path

import pyarrow.parquet as pq

from assistencia_economia import compacto, gravar, sha
from assistencia_utils import destino_isolado

MEDIDAS = ('pbf', 'bpc', 'total')


def ordenar(registros):
    """Ordena razões exatas de valores monetários; empates usam 1, 2, 2, 4.

    Cada registro: código, nome, UF, pagamentos anuais nominais, PIB nominal.
    A posição nunca é determinada pelo percentual arredondado exibido.
    """
    validos = []
    for cod, nome, uf, pago, pib in registros:
        p = Decimal(str(pago)).quantize(Decimal('0.01'))
        g = Decimal(str(pib))
        if not p.is_finite() or not g.is_finite() or p < 0 or g <= 0:
            raise ValueError('Valor inválido em registro classificado')
        validos.append((Fraction(p) / Fraction(g), int(cod), nome, uf, float(p), float(g)))
    validos.sort(key=lambda r: (-r[0], r[1]))
    linhas = []; anterior = None; posicao = 0
    for n, (razao, cod, nome, uf, pago, pib) in enumerate(validos, 1):
        if razao != anterior:
            posicao = n
        linhas.append([cod, nome, uf, posicao, float(100 * razao), pago, pib])
        anterior = razao
    return linhas


def gerar(base, manifesto, origem, saida):
    base = Path(base).resolve(); manifesto = Path(manifesto).resolve(); origem = Path(origem).resolve()
    saida = destino_isolado(Path(saida), origem); destino_isolado(saida, base); destino_isolado(saida, manifesto)
    m = json.loads((origem / 'gold/assistencia/economia_manifesto.json').read_bytes())
    global_m = json.loads(manifesto.read_bytes()); refs = global_m['fontes']['assistencia']['arquivos']
    for f in ['pbf', 'bpc']:
        assert all(m['fontes'][f][k] == refs[f][k] for k in ['caminho', 'sha256', 'bytes']), 'A comparação anual usa outra edição de pagamentos'
    tr = refs['territorios']; cadastro = base / tr['caminho']
    assert sha(cadastro) == tr['sha256'] and cadastro.stat().st_size == tr['bytes'], 'Cadastro territorial divergente'
    pr = m['parquet']; path = origem / pr['caminho']
    assert sha(path) == pr['sha256'] and path.stat().st_size == pr['bytes'], 'Comparação anual divergente'
    terras = {int(t['cod_ibge']): t for t in pq.read_table(cadastro).to_pylist() if t['nivel'] == 'M'}
    dados = pq.read_table(path).to_pandas()
    assert not dados.duplicated(['cod_ibge', 'ano']).any(), 'Chaves repetidas na comparação anual'
    assert set(dados.cod_ibge) <= set(terras), 'Município fora do cadastro'
    return construir(m, terras, dados, saida)


def construir(m, terras, dados, saida):
    """Usado também pela carga anual, após sua validação do candidato isolado."""
    ufs = sorted({t['uf'] for t in terras.values()}); anos = sorted(dados.ano.unique().tolist())
    frame_uf = dados.cod_ibge.map({c: t['uf'] for c, t in terras.items()})
    # Todas as validações precedem qualquer escrita; a origem é apenas lida.
    (saida / 'gold/assistencia').mkdir(parents=True, exist_ok=True)
    bruto = bytearray(); indices = {}
    for medida in MEDIDAS:
        recortes = {}; anos_validos = set()
        for ano in anos:
            sub = dados[dados.ano.eq(ano)]
            for uf in ['BR', *ufs]:
                local = sub if uf == 'BR' else sub[frame_uf.loc[sub.index].eq(uf)]
                cond = local['as_' + medida + '_pib_cond']
                assert cond.notna().all() and set(cond) <= set(range(6)), 'Condição anual desconhecida'
                contagens = Counter(int(x) for x in cond)
                registros = []
                for r in local[cond.eq(0)].to_dict('records'):
                    t = terras[int(r['cod_ibge'])]
                    registros.append([r['cod_ibge'], t['nome'], t['uf'], r['as_' + medida + '_pago_ano'], r['as_pib']])
                linhas = ordenar(registros)
                if linhas:
                    anos_validos.add(int(ano))
                b = compacto(dict(versao=1, medida=medida, ano=int(ano), uf=uf, linhas=linhas)) + b'\n'
                recortes[f'{ano}:{uf}'] = dict(trecho=[len(bruto), len(b), hashlib.sha256(b).hexdigest()],
                    total=len(local), validos=len(linhas), condicoes=[contagens[i] for i in range(6)])
                bruto.extend(b)
        indices[medida] = dict(versao=1, medida=medida, anos=anos, anos_com_valor=sorted(anos_validos), recortes=recortes)
    bundle = gravar(saida, 'economia_rankings', bytes(bruto), 'ndjson')
    apontadores = {}
    for medida, idx in indices.items():
        idx['arquivo'] = bundle
        apontadores[medida] = gravar(saida, 'economia_ranking_' + medida, idx)
    novo = copy.deepcopy(m)
    novo['rankings'] = apontadores
    novo['rankings_atualizado_em'] = datetime.now(timezone.utc).isoformat()
    (saida / 'gold/assistencia/economia_manifesto.json').write_bytes(compacto(novo))
    report = dict(ok=True, origem_sha256=hashlib.sha256(compacto(m)).hexdigest(),
        manifesto_sha256=sha(saida / 'gold/assistencia/economia_manifesto.json'),
        arquivo=bundle, recortes=sum(len(x['recortes']) for x in indices.values()),
        anos_com_valor={k: v['anos_com_valor'] for k, v in indices.items()})
    (saida / 'auditoria_rankings.json').write_bytes(compacto(report))
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return novo


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    for k in ['base', 'manifesto', 'origem', 'saida']:
        p.add_argument('--' + k, required=True, type=Path)
    a = p.parse_args(); gerar(a.base, a.manifesto, a.origem, a.saida)
