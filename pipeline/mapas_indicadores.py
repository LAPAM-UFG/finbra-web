"""Recortes leves para mapas, derivados apenas das edições publicadas de Saúde/Educação.

Não altera gold de origem; não lê credenciais nem publica. Usa as definições
exportadas por web/scripts/catalogo_mapas.ts e os arquivos originais do painel.
"""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import requests

# Frações: 0,05%, 0,1%, 0,5% e 1%. Faixas fixas permitem comparar anos
# sem comprimir praticamente toda a letalidade na faixa genérica de 0–20%.
ESCALAS_SAUDE = {k: [.0005, .001, .005, .01]
                 for k in ('dengue_letalidade', 'dengue_letalidade_prov')}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def compacto(v):
    return json.dumps(v, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode()


def numeros(a):
    return [None if not math.isfinite(float(x)) else float(x) for x in a]


def escala(valores, formato):
    if formato == 'fracao':
        return [.2, .4, .6, .8]
    if formato == 'percentual':
        return [20, 40, 60, 80]
    if formato == 'indice':
        return [2, 4, 6, 8]
    if formato == 'pontos':
        return [150, 200, 250, 300]
    positivos = valores[np.isfinite(valores) & (valores > 0)]
    if not len(positivos):
        return [1, 2, 5, 10]
    ordem = 10 ** math.floor(math.log10(float(np.median(positivos))))
    return [float(x * ordem) for x in [.5, 1, 2, 5]]


class Gerador:
    def __init__(self, base, revisao, saida):
        self.base, self.revisao, self.saida = base.resolve(), revisao.resolve(), saida.resolve()
        if self.saida.is_relative_to(self.base) or self.base.is_relative_to(self.saida):
            raise ValueError('A pasta candidata deve ficar separada da origem.')
        self.dest = self.saida / 'gold/mapas'
        if self.dest.exists() and any(self.dest.iterdir()):
            raise ValueError('Use uma pasta candidata nova ou vazia.')
        self.audit = dict(ok=True, origens={}, recortes=0, valores=0, zeros=0, ausentes=0, indicadores={})
        self.global_meta = json.loads((self.revisao / 'global_base.json').read_bytes())
        self.edu_meta = json.loads((self.revisao / 'educacao_base.json').read_bytes())
        self.registro = json.loads(self.fonte(self.edu_meta['busca_municipios']).read_bytes())
        self.municipios = sorted([[int(c), n, u] for c, n, u in self.registro])
        assert len(self.municipios) == 5571 and len({r[0] for r in self.municipios}) == 5571
        self.codes = [r[0] for r in self.municipios]
        self.pos = {c: i for i, c in enumerate(self.codes)}
        self.ufs = {u: [i for i, r in enumerate(self.municipios) if r[2] == u] for u in sorted({r[2] for r in self.municipios})}
        self.cadastro = self.objeto('cadastro', dict(versao=1, municipios=self.municipios))
        self.agora = datetime.now(timezone.utc).isoformat()

    def fonte(self, ref):
        key = ref['caminho']
        if not key.startswith(('gold/educacao/', 'gold/saude/')) or '..' in key:
            raise ValueError('Origem fora do catálogo permitido.')
        origem = self.base / key
        if not origem.exists() or origem.stat().st_size != ref['bytes'] or sha(origem.read_bytes()) != ref['sha256']:
            origem = self.revisao / 'fontes' / key
            if not origem.exists():
                r = requests.get('https://finbra-web.luanviniciusbernardelli.workers.dev/dados/' + key, timeout=120)
                r.raise_for_status()
                if len(r.content) != ref['bytes'] or sha(r.content) != ref['sha256']:
                    raise ValueError('Origem remota diferente da edição revisada: ' + key)
                origem.parent.mkdir(parents=True, exist_ok=True)
                origem.write_bytes(r.content)
        assert origem.stat().st_size == ref['bytes'] and sha(origem.read_bytes()) == ref['sha256'], key
        self.audit['origens'][key] = ref
        return origem

    def objeto(self, nome, valor):
        b = compacto(valor)
        h = sha(b)
        self.dest.mkdir(parents=True, exist_ok=True)
        key = f'gold/mapas/{nome}_{h[:16]}.json'
        (self.saida / key).write_bytes(b)
        return dict(caminho=key, bytes=len(b), sha256=h)

    def catalogo(self, area, rede, indicadores, matriz, anos, origem, definicoes=None, escalas=None):
        prefixo = f'{area}_{rede}'
        temporario = self.dest / (prefixo + '_dados.ndjson')
        indices = []
        with temporario.open('wb') as f:
            for j, ind in enumerate(indicadores):
                if area == 'saude':
                    n = matriz[:, :, definicoes.index(ind['numerador'])]
                    d = matriz[:, :, definicoes.index(ind['denominador'])]
                    with np.errstate(invalid='ignore', divide='ignore'):
                        valores = n / d * ind['fator']
                    valores[~np.isfinite(n) | ~np.isfinite(d) | (d == 0)] = np.nan
                    validos = ind['anos']
                    flags = None
                else:
                    valores = matriz[:, :, j]
                    n = d = None
                    validos = ind['anos']
                    flag_pos = next((k for k, x in enumerate(indicadores) if x['id'] == ind['id'] + '_nota'), None)
                    flags = None if flag_pos is None else matriz[:, :, flag_pos]
                if ind.get('unidade_original') == 'condicao':
                    continue
                assert np.all(valores[np.isfinite(valores)] >= 0), 'Valor negativo precisa de revisão: ' + ind['id']
                anos_efetivos = [a for k, a in enumerate(anos) if a in validos and (np.isfinite(valores[k]).any() or (flags is not None and np.isfinite(flags[k]).any()))]
                # Mantém a cobertura original; a ausência de valores continua identificada.
                ind['anos'] = validos
                ind['anos_com_valor'] = anos_efetivos
                ind['escala'] = (escalas or {}).get(ind['id']) or escala(valores, ind['formato'])
                trechos = {}
                for k, ano in enumerate(anos):
                    if ano not in validos:
                        continue
                    inicio_br = f.tell()
                    hash_br = hashlib.sha256()
                    for uf, pos in self.ufs.items():
                        vals = numeros(valores[k, pos])
                        carga = dict(versao=1, area=area, rede=rede, indicador=ind['id'], ano=ano, uf=uf,
                                     cadastro=self.cadastro['sha256'], quantidade=len(pos), valores=vals if any(x is not None for x in vals) else None)
                        if area == 'saude':
                            ns, ds = numeros(n[k, pos]), numeros(d[k, pos])
                            estados = [2 if nv is None else 3 if dv is None else 4 if dv == 0 else 6 if ano in ind['preliminares'] else 1 if v == 0 else 0 for nv, dv, v in zip(ns, ds, vals)]
                            carga.update(numeradores=ns, denominadores=ds, condicoes=estados)
                        elif flags is not None:
                            carga['marcadores'] = [None if not math.isfinite(x) else int(x) for x in flags[k, pos]]
                        b = compacto(carga) + b'\n'
                        trechos[f'{ano}:{uf}'] = [f.tell(), len(b), sha(b)]
                        f.write(b)
                        hash_br.update(b)
                        self.audit['recortes'] += 1
                        self.audit['valores'] += sum(v is not None for v in vals)
                        self.audit['zeros'] += sum(v == 0 for v in vals)
                        self.audit['ausentes'] += sum(v is None for v in vals)
                    trechos[f'{ano}:BR'] = [inicio_br, f.tell() - inicio_br, hash_br.hexdigest()]
                indices.append((ind, dict(versao=1, area=area, rede=rede, indicador=ind['id'], cadastro=self.cadastro['sha256'], recortes=trechos)))
        b = temporario.read_bytes()
        h = sha(b)
        destino = self.dest / f'{prefixo}_dados_{h[:16]}.ndjson'
        assert destino.resolve().is_relative_to(self.dest.resolve())
        temporario.rename(destino)
        arquivo = dict(caminho='gold/mapas/' + destino.name, bytes=len(b), sha256=h)
        medidas = []
        for ind, idx in indices:
            idx['arquivo'] = arquivo
            meta = dict(ind)
            for campo in ['numerador', 'denominador', 'fator', 'preliminares', 'unidade_original', 'variavel']:
                meta.pop(campo, None)
            meta['indice'] = self.objeto(prefixo + '_' + ind['id'] + '_indice', idx)
            medidas.append(meta)
        catalogo = dict(versao=1, area=area, rede=rede, gerado_em=self.agora, cadastro=self.cadastro, origem=origem, indicadores=medidas)
        self.audit['indicadores'][prefixo] = dict(total=len(medidas), bytes_dados=len(b))
        print(json.dumps(dict(catalogo=prefixo, indicadores=len(medidas), bytes_dados=len(b))), flush=True)
        return catalogo

    def saude(self):
        a = self.global_meta['aberturas']['saude']
        i = json.loads(self.fonte(dict(caminho=a['indice'], bytes=a['indice_bytes'], sha256=a['indice_sha256'])).read_bytes())
        caminho = self.fonte(dict(caminho=a['arquivo'], bytes=a['bytes'], sha256=a['sha256']))
        definicoes = json.loads((self.revisao / 'saude_catalogo_origem.json').read_bytes())['indicadores']
        anos = sorted({a for ind in definicoes for a in ind['anos']})
        anos_pos = {a: k for k, a in enumerate(anos)}
        matriz = np.full((len(anos), len(self.codes), len(i['serie'])), np.nan)
        vistos = set()
        with caminho.open('r', encoding='utf-8') as f:
            for line in f:
                g = json.loads(line)
                if not g['g'].isdigit() or int(g['g']) not in self.pos:
                    continue
                cod = int(g['g'])
                assert cod not in vistos and g['s'] == a['snapshot']
                vistos.add(cod)
                for ano, r in zip(g['a'], g['r']):
                    if ano in anos_pos:
                        matriz[anos_pos[ano], self.pos[cod], :] = np.asarray(r, dtype=float)
        esperados = {int(c) for c in i['grupos'] if str(c).isdigit() and int(c) in self.pos}
        assert vistos == esperados
        # O cadastro cartográfico também inclui territórios sem grupo na fonte;
        # permanecem sem registro, em vez de receber um zero inventado.
        self.audit['territorios_sem_grupo_saude'] = sorted(set(self.codes) - vistos)
        origem = dict(tipo='saude', caminho='gold/manifesto.json', sha256=a['sha256'], indice_sha256=a['indice_sha256'], snapshot=a['snapshot'], gerado_em=a['gerado_em'])
        m = self.catalogo('saude', 'todas', definicoes, matriz, anos, origem, i['serie'], escalas=ESCALAS_SAUDE)
        (self.dest / 'saude_manifesto.json').write_bytes(compacto(m))

    def educacao(self):
        redes = [('todas', self.edu_meta)] + [(r, json.loads(self.fonte(o).read_bytes())) for r, o in self.edu_meta.get('redes', {}).items()]
        origem = dict(tipo='educacao', caminho='gold/educacao/manifesto.json', sha256=sha((self.revisao / 'educacao_base.json').read_bytes()), gerado_em=self.edu_meta['gerado_em'])
        principal, refs, escalas = None, {}, {}
        for rede, meta in redes:
            anos = meta['anos']
            matriz = np.full((len(anos), len(self.codes), len(meta['indicadores'])), np.nan)
            for k, ano in enumerate(anos):
                g = json.loads(self.fonte(meta['rankings'][str(ano)]).read_bytes())
                assert g['ano'] == ano
                vistos = set()
                for r in g['linhas']:
                    cod = int(r[0])
                    assert cod in self.pos and cod not in vistos and len(r) == len(meta['indicadores']) + 3
                    assert r[2] == self.municipios[self.pos[cod]][2]
                    vistos.add(cod)
                    matriz[k, self.pos[cod], :] = np.asarray(r[3:], dtype=float)
            inds = []
            for i in meta['indicadores']:
                unidade = i['unidade']
                legenda = '%' if unidade == 'percentual' else 'índice 0–10' if unidade == 'indice' else 'pontos na escala Saeb' if unidade == 'pontos' else 'condição do resultado' if unidade == 'condicao' else 'vínculos docente–escola' if i['id'].startswith('doc_') else 'turmas' if i['id'].startswith('tur_') else 'escolas' if i['id'].startswith('escolas') else 'matrículas'
                legenda_en = '%' if unidade == 'percentual' else '0–10 index' if unidade == 'indice' else 'Saeb scale points' if unidade == 'pontos' else 'result status' if unidade == 'condicao' else 'school teaching positions' if i['id'].startswith('doc_') else 'classes' if i['id'].startswith('tur_') else 'schools' if i['id'].startswith('escolas') else 'enrolments'
                flag = next((f for f in meta['indicadores'] if f.get('associado') == i['id']), None)
                inds.append(dict(id=i['id'], nome=i['nome'], nome_en=i['nome_en'], descricao=i['descricao'], descricao_en=i['descricao_en'], tema=i['tema'], tema_en=i['tema'],
                                 formato=unidade, unidade_original=unidade, unidade=legenda, unidade_en=legenda_en, minimo=0, anos=i['anos'],
                                 fonte_nome=meta['fontes'][i['fonte']]['nome'], fonte_nome_en=meta['fontes'][i['fonte']]['nome'],
                                 fontes=[meta['fontes'][i['fonte']]], edicoes=self.edu_meta.get('edicoes_avaliacao', []),
                                 avaliacao=i['fonte'] in ('ideb', 'saeb'), marcador=flag and flag.get('rotulos'),
                                 territorio='Escolas localizadas no território', territorio_en='Schools located in the territory'))
            m = self.catalogo('educacao', rede, inds, matriz, anos, origem, escalas=escalas)
            if rede == 'todas':
                principal = m
                escalas = {i['id']: i['escala'] for i in m['indicadores']}
            else:
                refs[rede] = self.objeto('educacao_' + rede + '_catalogo', m)
        principal['redes'] = refs
        (self.dest / 'educacao_manifesto.json').write_bytes(compacto(principal))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, required=True)
    p.add_argument('--revisao', type=Path, required=True, help='Snapshot dos manifestos e catálogo exportado do TypeScript')
    p.add_argument('--saida', type=Path, required=True)
    a = p.parse_args()
    g = Gerador(a.base, a.revisao, a.saida)
    g.saude()
    g.educacao()
    (g.revisao / 'geracao_mapas.json').write_bytes(compacto(g.audit))
    print(json.dumps({k: v for k, v in g.audit.items() if k != 'origens'}), flush=True)
