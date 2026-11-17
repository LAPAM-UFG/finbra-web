"""Compõe catálogos imutáveis já gerados, em um candidato novo e separado.

O último candidato prevalece por área/rede. Toda referência é conferida antes de
ser copiada; fontes compartilhadas e geografia precisam ser idênticas. Não envia
arquivos, não remove nada e não altera os candidatos de entrada.
"""

import argparse, hashlib, json, shutil
from pathlib import Path


def digest(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def unir(entradas, saida):
    entradas = [Path(p).resolve() for p in entradas]
    saida = Path(saida).resolve()
    assert not saida.exists() or not any(saida.iterdir()), "Use candidato novo/vazio"
    assert all(
        not saida.is_relative_to(p) and not p.is_relative_to(saida) for p in entradas
    ), "Destinos sobrepostos"
    catalogos = {}
    origens = {}
    geo = None
    for base in entradas:
        m = json.loads((base / "gold/comparacoes/manifesto.json").read_bytes())
        assert m["versao"] == 1
        if geo is None:
            geo = m["geografia"]
        else:
            assert geo == m["geografia"], "Geografias distintas"
        for k, v in m["origens"].items():
            assert k not in origens or origens[k] == v, "Fonte divergente: " + k
            origens[k] = v
        for k, r in m["catalogos"].items():
            catalogos[k] = (base, r)
    copiados = {}

    def copiar(base, r):
        k = r["caminho"]
        assert k.startswith("gold/comparacoes/") and ".." not in k
        p = (base / k).resolve()
        assert p.is_relative_to(base / "gold/comparacoes")
        if k in copiados:
            assert copiados[k] == (r["bytes"], r["sha256"]), k
            return
        assert p.stat().st_size == r["bytes"] and digest(p) == r["sha256"], k
        dest = saida / k
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(p, dest)
        copiados[k] = (r["bytes"], r["sha256"])
        if p.suffix == ".json":
            percorrer(base, json.loads(p.read_bytes()))

    def percorrer(base, x):
        if isinstance(x, dict):
            if all(k in x for k in ["caminho", "bytes", "sha256"]):
                copiar(base, x)
            else:
                for v in x.values():
                    percorrer(base, v)
        elif isinstance(x, list):
            for v in x:
                percorrer(base, v)

    for base, r in catalogos.values():
        copiar(base, r)
    from datetime import datetime, timezone

    out = dict(
        versao=1,
        gerado_em=datetime.now(timezone.utc).isoformat(),
        geografia=geo,
        catalogos={k: r for k, (_, r) in catalogos.items()},
        origens=origens,
        observacoes=[
            "Referências derivadas das mesmas bases municipais, com cobertura explícita.",
            "Regiões IBGE de 2017, associação atual aplicada à série.",
            "Ausência não é zero; métodos distintos não são emendados.",
        ],
    )
    (saida / "gold/comparacoes/manifesto.json").write_text(
        json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    return dict(
        ok=True,
        catalogos=len(catalogos),
        objetos=len(copiados) + 1,
        bytes=sum(p.stat().st_size for p in (saida / "gold/comparacoes").iterdir()),
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--entradas", nargs="+", type=Path, required=True)
    p.add_argument("--saida", type=Path, required=True)
    a = p.parse_args()
    print(json.dumps(unir(a.entradas, a.saida)), flush=True)
