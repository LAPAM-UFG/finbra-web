"""Pagamentos anuais / PIB do mesmo ano, em candidato isolado e sem upload.

O PIB da silver já está em reais correntes (externos.py converte mil R$).
Reutiliza exclusivamente os pagamentos nominais publicados, sem somar pessoas,
folha MDS, parcelas retroativas separadas ou valores corrigidos pelo IPCA.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import duckdb
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq

from assistencia_utils import destino_isolado

CONDICOES = {0: 'Registrado', 1: 'Sem pagamentos informados', 2: 'Ano incompleto: menos de 12 meses válidos',
             3: 'PIB do mesmo ano indisponível', 4: 'PIB igual a zero', 5: 'PIB inválido'}
VARIAVEIS = {
    'as_pib': ('PIB a preços correntes', 'R$ nominais', 'PIB municipal do IBGE. A silver já está convertida de mil reais para reais; não multiplicar novamente. UF e Brasil: soma dos municípios, sem duplicar o DF.'),
    'as_pbf_pago_ano': ('Bolsa Família/Auxílio Brasil: pagamentos no ano completo', 'R$ nominais', 'Soma de pbf_cgu_valor nos 12 meses do ano. Só pagamentos efetivos CGU; não inclui o Benefício Extraordinário do Auxílio Brasil (ressalva em 2021–2023). Ano incompleto fica sem valor.'),
    'as_bpc_pago_ano': ('BPC: pagamentos no ano completo', 'R$ nominais', 'Soma de bpc_valor_pago nos 12 meses do ano de pagamento, incluindo retroativos já presentes no total. Ano incompleto fica sem valor.'),
    'as_total_pago_ano': ('Bolsa Família/Auxílio Brasil e BPC: pagamentos anuais', 'R$ nominais', 'Soma dos valores pagos pelos dois programas, apenas quando ambos têm 12 meses válidos. Não é soma de beneficiários e não inclui outros programas.'),
    'as_pbf_pib_pct': ('Bolsa Família/Auxílio Brasil: pagamentos / PIB', '% do PIB (100 = PIB)', '100 × pagamentos nominais em 12 meses / PIB nominal do mesmo ano e território. Relação de grandeza, não contribuição contábil ao PIB nem impacto causal. Ressalva de cobertura em 2021–2023: falta o Benefício Extraordinário do Auxílio Brasil.'),
    'as_bpc_pib_pct': ('BPC: pagamentos / PIB', '% do PIB (100 = PIB)', '100 × pagamentos nominais em 12 meses / PIB nominal do mesmo ano e território. Relação de grandeza, não contribuição contábil ao PIB nem impacto causal.'),
    'as_total_pib_pct': ('Bolsa Família/Auxílio Brasil e BPC: pagamentos / PIB', '% do PIB (100 = PIB)', '100 × soma dos pagamentos dos dois programas / PIB do mesmo ano e território. Ambos precisam de 12 meses válidos. Não mede participação de beneficiários ou impacto causal.'),
    'as_pbf_meses': ('Meses válidos de pagamentos Bolsa Família/Auxílio Brasil', 'meses', 'Número de meses distintos com valor nominal válido no ano, entre 0 e 12. Não se estima mês ausente.'),
    'as_bpc_meses': ('Meses válidos de pagamentos BPC', 'meses', 'Número de meses distintos com valor nominal válido no ano, entre 0 e 12. Não se estima mês ausente.'),
}


def compacto(x):
    return json.dumps(x, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf-8')


def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def objeto(p, root):
    return dict(caminho=p.relative_to(root).as_posix(), bytes=p.stat().st_size, sha256=sha(p))


def gravar(root, prefix, x, ext='json'):
    data = x if isinstance(x, bytes) else compacto(x)
    p = root / 'gold/assistencia' / f'{prefix}_{hashlib.sha256(data).hexdigest()[:12]}.{ext}'
    p.write_bytes(data)
    return objeto(p, root)


def anual(rows):
    """Exige 12 competências distintas e válidas; zero informado continua válido."""
    meses = {}
    ano = None
    for mes, valor, condicao in rows:
        if mes in meses:
            raise ValueError('Competência duplicada nos pagamentos')
        if not 1 <= mes % 100 <= 12:
            raise ValueError('Competência inválida')
        if ano is not None and mes // 100 != ano:
            raise ValueError('Competências de anos diferentes')
        ano = mes // 100
        meses[mes] = valor if condicao in ('registrado', 'zero_registrado') and valor is not None and math.isfinite(valor) and valor >= 0 else None
    validos = [v for v in meses.values() if v is not None]
    return (round(sum(validos), 2) if len(validos) == 12 else None), len(validos)


def razao(pago, meses, pib):
    if meses == 0:
        return None, 1
    if meses != 12 or pago is None:
        return None, 2
    if pib is None or pd.isna(pib):
        return None, 3
    if pib == 0:
        return None, 4
    if pib < 0 or not pd.notna(pib) or pib == float('inf'):
        return None, 5
    return 100 * pago / pib, 0


def gerar(base, manifesto, saida):
    base = Path(base).resolve(); manifesto = Path(manifesto).resolve()
    saida = destino_isolado(Path(saida), base)
    destino_isolado(saida, manifesto)
    m = json.loads(manifesto.read_bytes()); fonte = m['fontes']['assistencia']; refs = fonte['arquivos']
    paths = {k: base / refs[k]['caminho'] for k in ['pbf', 'bpc', 'territorios']}
    for k, p in paths.items():
        if sha(p) != refs[k]['sha256'] or p.stat().st_size != refs[k]['bytes']:
            raise ValueError('Fonte local diverge da publicação: ' + k)
    pibpath = base / 'silver/ibge_pib.parquet'
    # Todas as validações de origem/destino precedem qualquer escrita.
    (saida / 'gold/assistencia').mkdir(parents=True, exist_ok=True)
    terras = pq.read_table(paths['territorios']).to_pylist()
    porgrupo = {t['grupo']: t for t in terras}
    db = duckdb.connect(); db.execute("SET threads=2; SET memory_limit='2GB'")
    payments = {}; anos = set(); fontes = {}
    for f, id in [('pbf', 'pbf_cgu_valor'), ('bpc', 'bpc_valor_pago')]:
        rows = db.execute('SELECT grupo,competencia,valor,condicao FROM read_parquet(?) WHERE indicador=? ORDER BY grupo,competencia', [str(paths[f]), id]).fetchall()
        grupos = {}
        for grupo, mes, valor, cond in rows:
            ano = mes // 100
            if ano < 2013:
                continue
            grupos.setdefault((grupo, ano), []).append((mes, valor, cond)); anos.add(ano)
        payments[f] = {k: anual(v) for k, v in grupos.items()}
        fontes[f] = dict(refs[f], indicador=id)
    pib = pq.read_table(pibpath, columns=['cod_ibge', 'exercicio', 'pib']).to_pandas()
    if pib.duplicated(['cod_ibge', 'exercicio']).any():
        raise ValueError('PIB com chaves repetidas')
    pib = pib[pib.exercicio >= 2013].copy()
    pib['uf'] = pib.cod_ibge.map({t['cod_ibge']: t['uf'] for t in terras if t['nivel'] == 'M'})
    if pib.uf.isna().any():
        raise ValueError('PIB municipal fora do cadastro territorial')
    gdps = {(str(r.cod_ibge), int(r.exercicio)): None if pd.isna(r.pib) else float(r.pib) for r in pib.itertuples()}
    # Agrega cada município uma única vez. Não tira média dos percentuais.
    for ano, g in pib.groupby('exercicio'):
        gdps['BR', int(ano)] = float(g.pib.sum()) if g.pib.notna().all() else None
        for uf, sub in g.groupby('uf'):
            gdps[uf, int(ano)] = float(sub.pib.sum()) if sub.pib.notna().all() else None
    anos = sorted(anos); indices = {}; ufindices = {}; bruto = bytearray(); wide = []
    for grupo, t in sorted(porgrupo.items()):
        lines = []
        for ano in anos:
            pbf, mp = payments['pbf'].get((grupo, ano), (None, 0)); bpc, mb = payments['bpc'].get((grupo, ano), (None, 0)); p = gdps.get((grupo, ano))
            total = pbf + bpc if pbf is not None and bpc is not None else None
            vp, cp = razao(pbf, mp, p); vb, cb = razao(bpc, mb, p); vt, ct = razao(total, min(mp, mb), p)
            lines.append([ano, p, pbf, bpc, mp, mb])
            if t['nivel'] == 'M':
                wide.append(dict(cod_ibge=t['cod_ibge'], ano=ano, as_pib=p, as_pbf_pago_ano=pbf, as_bpc_pago_ano=bpc, as_total_pago_ano=total,
                                 as_pbf_pib_pct=vp, as_bpc_pib_pct=vb, as_total_pib_pct=vt, as_pbf_meses=mp, as_bpc_meses=mb,
                                 as_pbf_pib_cond=cp, as_bpc_pib_cond=cb, as_total_pib_cond=ct))
        data = compacto(dict(grupo=grupo, linhas=lines)) + b'\n'
        ref = [len(bruto), len(data), hashlib.sha256(data).hexdigest()]; bruto.extend(data)
        if t['nivel'] == 'M':
            ufindices.setdefault(t['uf'], {})[grupo] = ref
        else:
            indices[grupo] = ref
    bundle = gravar(saida, 'economia_series', bytes(bruto), 'ndjson')
    cats = {uf: gravar(saida, 'economia_indice_' + uf.lower(), dict(grupos=idx)) for uf, idx in ufindices.items()}
    parquet = saida / 'gold/assistencia/economia_temporario.parquet'
    pq.write_table(pa.Table.from_pylist(wide), parquet, compression='zstd')
    target = parquet.with_name('economia_' + sha(parquet)[:12] + '.parquet'); parquet.replace(target)
    meta = dict(versao=1, gerado_em=datetime.now(timezone.utc).isoformat(), anos=anos, pib_ate=int(pib.exercicio.max()),
                manifesto_origem_sha256=sha(manifesto), fontes=fontes, pib_origem_sha256=sha(pibpath),
                pib_url='https://sidra.ibge.gov.br/tabela/5938', arquivo=bundle, grupos=indices, indices_uf=cats,
                parquet=objeto(target, saida), condicoes=CONDICOES, indicadores=[dict(variavel=k, nome=v[0], unidade=v[1], descricao=v[2]) for k, v in VARIAVEIS.items()])
    (saida / 'gold/assistencia/economia_manifesto.json').write_bytes(compacto(meta))
    db.close(); print(json.dumps(dict(ok=True, territorios=len(terras), linhas=len(wide), anos=anos, pib_ate=meta['pib_ate'], bytes=len(bruto))), flush=True)
    return meta


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ['base', 'manifesto', 'saida']:
        parser.add_argument('--' + key, required=True, type=Path)
    args = parser.parse_args(); gerar(args.base, args.manifesto, args.saida)
