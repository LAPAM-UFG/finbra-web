"""Malha IBGE 2025 simplificada e versionada, independente dos dados econômicos.

Requer Node.js e mapshaper 0.6.113 (instalado separadamente); não lê credenciais.
Exemplo no documento GEOGRAFIA_MUNICIPAL.md.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

FONTE = 'https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais/15774-malhas.html'
ARQUIVO = 'https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/malhas_municipais/municipio_2025/Brasil/BR_Municipios_2025.zip'
SHA_ORIGEM = '840bbe6f73726ef9d1460ce49fdfe01a278935c41180d3c893e25ca21db083bd'
UFS = set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split())


def gerar(arquivo: Path, ferramenta: Path, saida: Path):
    original = arquivo.read_bytes()
    if hashlib.sha256(original).hexdigest() != SHA_ORIGEM:
        raise ValueError('Edição da fonte diferente da revisada; revisar proveniência antes de gerar.')
    pacote = json.loads((ferramenta.parent.parent / 'package.json').read_text(encoding='utf-8'))
    if pacote['name'] != 'mapshaper' or pacote['version'] != '0.6.113':
        raise ValueError('Use mapshaper 0.6.113 para reproduzir esta edição.')
    dest = saida.resolve() / 'gold/geografia'
    if dest.exists() and any(dest.iterdir()):
        raise ValueError('O destino deve ser novo ou vazio, sem sobrescrever uma edição anterior.')
    with tempfile.TemporaryDirectory(prefix='finbra_malha_') as temp:
        raiz = Path(temp)
        with zipfile.ZipFile(arquivo) as z:
            for ext in ('.shp', '.shx', '.dbf', '.cpg', '.prj'):
                nome = 'BR_Municipios_2025' + ext
                (raiz / nome).write_bytes(z.read(nome))
        comando = ['node', '--max-old-space-size=6144', str(ferramenta), str(raiz / 'BR_Municipios_2025.shp'),
                   '-filter-fields', 'CD_MUN,NM_MUN,SIGLA_UF', '-filter', 'CD_MUN != "4300001" && CD_MUN != "4300002"',
                   '-each', 'name=CD_MUN,nome=NM_MUN,uf=SIGLA_UF', '-filter-fields', 'name,nome,uf',
                   '-simplify', 'resolution=1800', 'keep-shapes', '-clean',
                   '-o', 'format=topojson', 'quantization=100000', str(raiz / 'br.json')]
        subprocess.run(comando, check=True)
        (raiz / 'ufs').mkdir()
        subprocess.run(['node', str(ferramenta), str(raiz / 'br.json'), '-split', 'uf', '-o', 'singles',
                        'format=topojson', 'quantization=100000', str(raiz / 'ufs')], check=True)
        recortes = {}
        for uf, caminho in [('BR', raiz / 'br.json')] + [(u, raiz / 'ufs' / (u + '.json')) for u in sorted(UFS)]:
            topo = json.loads(caminho.read_bytes())
            obj = next(iter(topo['objects'].values()))
            topo['objects'] = {'municipios': obj}
            codigos = {g['properties']['name'] for g in obj['geometries']}
            assert len(codigos) == len(obj['geometries']) and codigos
            assert all(g['type'] in ('Polygon', 'MultiPolygon') and g['arcs'] for g in obj['geometries'])
            assert all(g['properties']['uf'] in UFS and (uf == 'BR' or g['properties']['uf'] == uf) for g in obj['geometries'])
            if uf == 'BR':
                assert len(codigos) == 5571 and {'5101837', '5300108', '2605459'} <= codigos
            dados = json.dumps(topo, ensure_ascii=False, separators=(',', ':')).encode()
            sha = hashlib.sha256(dados).hexdigest()
            nome = f'municipios_2025_{uf.lower()}_{sha[:16]}.json'
            dest.mkdir(parents=True, exist_ok=True)
            (dest / nome).write_bytes(dados)
            recortes[uf] = dict(caminho='gold/geografia/' + nome, bytes=len(dados), sha256=sha, territorios=len(codigos))
        manifesto = dict(versao=1, ano_malha=2025, gerado_em=datetime.now(timezone.utc).isoformat(), fonte=FONTE,
                         arquivo_origem=ARQUIVO, sha256_origem=SHA_ORIGEM, crs_origem='EPSG:4674 (SIRGAS 2000)',
                         processamento='mapshaper 0.6.113; simplify resolution=1800 keep-shapes; clean; TopoJSON quantization=100000',
                         exclusoes={'4300001': 'Área Operacional Lagoa Mirim', '4300002': 'Área Operacional Lagoa dos Patos'},
                         nota='Limites de 2025 usados em todos os anos. Generalização cartográfica, sem remanejamento de valores e sem reconstrução de fronteiras históricas.', recortes=recortes)
        (dest / 'manifesto.json').write_text(json.dumps(manifesto, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
        print(json.dumps(dict(ok=True, territorios=5571, arquivos=len(recortes) + 1, bytes_brasil=recortes['BR']['bytes'], bytes_ufs=sum(v['bytes'] for k, v in recortes.items() if k != 'BR'))))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--arquivo-zip', type=Path, required=True)
    p.add_argument('--mapshaper', type=Path, required=True, help='Caminho ao bin/mapshaper da versão 0.6.113')
    p.add_argument('--saida', type=Path, required=True, help='Pasta candidata nova, sem gold/geografia anterior')
    a = p.parse_args()
    gerar(a.arquivo_zip, a.mapshaper, a.saida)
