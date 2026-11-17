"""Snapshots públicos para a revisão das comparações, sem alterar dados de origem."""

import argparse, concurrent.futures, hashlib, json
from pathlib import Path
import requests

URL = "https://finbra-web.luanviniciusbernardelli.workers.dev/dados/"
PONTEIROS = {
    "global": "gold/manifesto.json",
    "abertura": "gold/abertura/manifesto.json",
    "downloads": "gold/downloads/manifesto.json",
    "educacao": "gold/educacao/manifesto.json",
    "saneamento": "gold/saneamento/manifesto.json",
    "mapas_trabalho": "gold/mapas/trabalho_manifesto.json",
    "mapas_saneamento": "gold/mapas/saneamento_manifesto.json",
    "mapas_saude": "gold/mapas/saude_manifesto.json",
    "mapas_educacao": "gold/mapas/educacao_manifesto.json",
}


def sha(b):
    return hashlib.sha256(b).hexdigest()


class Fontes:
    def __init__(self, revisao, bases):
        self.rev = Path(revisao).resolve()
        self.bases = [Path(p).resolve() for p in bases]
        self.rev.mkdir(parents=True, exist_ok=True)
        self.refs = {}
        self.raizes = {}

    def snapshot(self, item):
        nome, key = item
        r = requests.get(URL + key, timeout=90)
        r.raise_for_status()
        b = r.content
        p = self.rev / (nome + "_base.json")
        if p.exists():
            assert p.read_bytes() == b, "Fonte atualizada; use uma revisão nova: " + key
        else:
            p.write_bytes(b)
        self.raizes[key] = dict(sha256=sha(b), bytes=len(b))
        return nome, json.loads(b)

    def resolver(self, ref):
        key = ref["caminho"]
        assert key.startswith("gold/") and ".." not in key
        for base in self.bases + [self.rev / "fontes"]:
            p = base / key
            if (
                p.is_file()
                and p.stat().st_size == ref["bytes"]
                and sha(p.read_bytes()) == ref["sha256"]
            ):
                self.refs[key] = dict(ref, local=str(p))
                return p
        r = requests.get(URL + key, timeout=180)
        r.raise_for_status()
        b = r.content
        assert len(b) == ref["bytes"] and sha(b) == ref["sha256"], key
        p = self.rev / "fontes" / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b)
        self.refs[key] = dict(ref, local=str(p))
        return p

    def mapa(self, m):
        self.resolver(m["cadastro"])
        indices = [
            json.loads(self.resolver(i["indice"]).read_bytes())
            for i in m["indicadores"]
        ]
        arquivos = {x["arquivo"]["caminho"]: x["arquivo"] for x in indices}
        for x in arquivos.values():
            self.resolver(x)

    def parquet_publicado(self, key):
        # Esses arquivos antigos não têm nomes por conteúdo. GET fixa a edição e
        # HEAD posterior garante que o objeto não mudou durante a aquisição.
        head = requests.head(URL + key, timeout=60)
        head.raise_for_status()
        etag = head.headers.get("ETag")
        size = int(head.headers.get("Content-Length", 0))
        p = None
        for base in self.bases:
            pp = base / key
            if (
                pp.is_file()
                and pp.stat().st_size == size
                and '"' + hashlib.md5(pp.read_bytes()).hexdigest() + '"' == etag
            ):
                p = pp
                break
        if p is None:
            r = requests.get(URL + key, timeout=180)
            r.raise_for_status()
            assert r.headers.get("ETag") == etag and len(r.content) == size
            p = self.rev / "fontes" / key
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(r.content)
        h = requests.head(URL + key, timeout=60)
        h.raise_for_status()
        assert h.headers.get("ETag") == etag
        ref = dict(
            caminho=key, bytes=size, sha256=sha(p.read_bytes()), local=str(p), etag=etag
        )
        self.refs[key] = ref
        return p

    def oficial(self, nome, url):
        p = self.rev / nome
        if not p.exists():
            r = requests.get(url, timeout=120)
            r.raise_for_status()
            p.write_bytes(r.content)
        b = p.read_bytes()
        json.loads(b)
        self.refs["oficial:" + nome] = dict(
            caminho=url, bytes=len(b), sha256=sha(b), local=str(p)
        )
        return json.loads(b)

    def preparar(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
            metas = dict(pool.map(self.snapshot, PONTEIROS.items()))
        social = json.loads(
            self.resolver(
                metas["global"]["fontes"]["assistencia"]["abertura"]
            ).read_bytes()
        )
        (self.rev / "assistencia_base.json").write_bytes(
            json.dumps(social, ensure_ascii=False, separators=(",", ":")).encode()
        )
        self.resolver(social["arquivo"])
        for area in ["trabalho", "saneamento", "saude", "educacao"]:
            m = metas["mapas_" + area]
            self.mapa(m)
            for ref in m.get("redes", {}).values():
                self.mapa(json.loads(self.resolver(ref).read_bytes()))
        dl = metas["downloads"]
        self.resolver(dl["dicionario"])
        self.resolver(
            next(
                x
                for x in dl["arquivos"]
                if x.get("area") == "financas" and x["formato"] == "parquet"
            )
        )
        for key in [
            "gold/clima/anual.parquet",
            "gold/clima/mensal.parquet",
            "gold/clima/normal.parquet",
            "gold/clima/territorio.parquet",
            "gold/clima/catalogo.parquet",
            "gold/munic/painel_respostas.parquet",
            "gold/ipca.parquet",
            "gold/saude/municipios.parquet",
            "gold/saude/vacinacao.parquet",
            "gold/saude/vacinacao_catalogo.parquet",
            "gold/saude/fns_municipios.parquet",
        ]:
            self.parquet_publicado(key)
        self.oficial(
            "ibge_localidades.json",
            "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome",
        )
        self.oficial(
            "ibge_populacao_2026.json",
            "https://apisidra.ibge.gov.br/values/t/6579/n6/all/v/9324/p/2026",
        )
        self.oficial(
            "ipca_mensal.json",
            "https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/all?formato=json",
        )
        pop = next(
            (
                base / "silver/ibge_populacao.parquet"
                for base in self.bases
                if (base / "silver/ibge_populacao.parquet").is_file()
            ),
            None,
        )
        assert pop is not None
        self.refs["populacao_historica"] = dict(
            local=str(pop),
            bytes=pop.stat().st_size,
            sha256=sha(pop.read_bytes()),
            caminho="IBGE · silver/ibge_populacao.parquet (pipeline/externos.py)",
        )
        out = dict(raizes=self.raizes, arquivos=self.refs)
        (self.rev / "fontes_comparacoes.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(
            json.dumps(
                dict(
                    ok=True,
                    arquivos=len(self.refs),
                    bytes=sum(r["bytes"] for r in self.refs.values()),
                )
            ),
            flush=True,
        )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--revisao", required=True, type=Path)
    p.add_argument("--bases", required=True, nargs="+", type=Path)
    a = p.parse_args()
    Fontes(a.revisao, a.bases).preparar()
