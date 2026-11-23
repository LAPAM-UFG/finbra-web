"""Audita hashes, todos os recortes e a agregação a partir das células municipais.

Só lê o candidato e a revisão. Não usa o agregador de comparacoes_base para
recalcular as referências; confirma também os valores brutos dos mapas-fonte.
"""

import argparse, hashlib, json
from pathlib import Path
import numpy as np
import duckdb


def digest(p):
    h = hashlib.sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def arr(x):
    return np.array(x, dtype=float)


def iguais(a, b, rotulo):
    a, b = arr(a), arr(b)
    assert a.shape == b.shape and np.allclose(
        a, b, equal_nan=True, rtol=2e-11, atol=1e-9
    ), rotulo


class Auditor:
    def __init__(self, base, revisao):
        self.base = Path(base)
        self.rev = Path(revisao)
        self.checados = set()
        self.stats = {}
        self.m = self.ler(self.base / "gold/comparacoes/manifesto.json")
        self.geo = self.objeto(self.m["geografia"])
        self.muns = self.geo["municipios"]
        self.pos = {str(x[0]): k for k, x in enumerate(self.muns)}
        self.ufpos = {
            uf: [j for j, m in enumerate(self.muns) if m[2] == uf]
            for uf in {m[2] for m in self.muns}
        }
        assert len(self.muns) == 5571
        oficial = json.loads((self.rev / "ibge_localidades.json").read_bytes())
        assert {str(x["id"]) for x in oficial} == set(self.pos)
        for x in oficial:
            t = self.geo["territorios"][str(x["id"])]
            assert t["imediata"] == "I:" + str(x["regiao-imediata"]["id"]) and t[
                "intermediaria"
            ] == "T:" + str(x["regiao-imediata"]["regiao-intermediaria"]["id"])

    def ler(self, p):
        return json.loads(p.read_bytes())

    def caminho(self, o):
        p = (self.base / o["caminho"]).resolve()
        assert p.is_relative_to((self.base / "gold/comparacoes").resolve())
        if o["sha256"] not in self.checados:
            assert p.stat().st_size == o["bytes"] and digest(p) == o["sha256"]
            self.checados.add(o["sha256"])
        return p

    def objeto(self, o):
        return self.ler(self.caminho(o))

    def indices(self, ref, campo):
        idx = self.objeto(ref)
        p = self.caminho(idx["arquivo"])
        with p.open("rb") as f:
            for k, (off, n, sha) in idx[campo].items():
                f.seek(off)
                b = f.read(n)
                assert (
                    len(b) == n
                    and b.endswith(b"\n")
                    and hashlib.sha256(b).hexdigest() == sha
                ), (p, k)
        return idx, p

    def auditar(self, chave, ref):
        cat = self.objeto(ref)
        defs = cat["indicadores"]
        n = len(self.muns) if cat["rede"] != "estadic" else 27
        ownkeys = (
            list(self.pos) if n == 5571 else [k for k, _, _ in self.geo["governos"]]
        )
        ownpos = {k: j for j, k in enumerate(ownkeys)}
        qs = []
        refs = {}
        celulas = 0
        for i in defs:
            shape = (len(i["periodos"]), n)
            qs.append(
                {campo: np.full(shape, np.nan) for campo in ["v", "n", "d", "c", "r"]}
            )
        arquivo = None
        for rr in cat["indices"].values():
            idx, p = self.indices(rr, "grupos")
            assert arquivo is None or arquivo == p
            arquivo = p
        with arquivo.open("rb") as f:
            for raw in f:
                x = json.loads(raw)
                assert (
                    x["indicadores"] == [i["id"] for i in defs]
                    and x["area"] == cat["area"]
                    and x["rede"] == cat["rede"]
                )
                k = x["grupo"]
                assert x["quantidade"] == cat["quantidades"][k]
                assert len(x["dados"]) == len(defs)
                for j, (i, s) in enumerate(zip(defs, x["dados"])):
                    t = len(i["periodos"])
                    assert all(
                        len(s[campo]) == t for campo in ["v", "n", "d", "c", "q"]
                    )
                    vv = arr(s["v"])
                    cc = arr(s["c"])
                    assert not np.isinf(vv).any()
                    assert np.all((cc != 1) | (vv == 0))
                    assert not np.any(
                        np.isnan(vv) & np.isin(cc, [0, 1, 6, 11, 12, 16, 18])
                    )
                    assert all(0 <= q <= x["quantidade"] for q in s["q"])
                    celulas += t
                    if k in ownpos:
                        assert x["quantidade"] == 1
                        for campo in qs[j]:
                            qs[j][campo][:, ownpos[k]] = arr(s.get(campo, s["v"]))
                if k not in ownpos:
                    refs[k] = x["dados"]
        porid = {i["id"]: (i, q) for i, q in zip(defs, qs)}
        componentes_cache = {}

        def componentes(id, periodos, campo="r"):
            key = (id, tuple(periodos), campo)
            if key in componentes_cache:
                return componentes_cache[key]
            i, q = porid[id]
            py = {p: j for j, p in enumerate(i["periodos"])}
            valor = np.array(
                [q[campo][py[p]] if p in py else np.full(n, np.nan) for p in periodos]
            )
            componentes_cache[key] = valor
            return valor

        # Confere as unidades sem recorrer ao gerador: razões usam os mesmos
        # componentes; densidades usam a população oficial e o IPCA fixado.
        fontes = self.ler(self.rev / "fontes_comparacoes.json")["arquivos"]
        pop = {}
        for ano, cod, valor in (
            duckdb.connect()
            .execute(
                "SELECT ano,cod_ibge,populacao FROM read_parquet(?)",
                [fontes["populacao_historica"]["local"]],
            )
            .fetchall()
        ):
            if str(cod) in self.pos and valor is not None and valor > 0:
                pop.setdefault(int(ano), np.full(5571, np.nan))[
                    self.pos[str(cod)]
                ] = valor
        ipca = {}
        for r in self.ler(self.rev / "ipca_mensal.json")[1:]:
            periodo = next(
                (
                    int(v)
                    for k, v in r.items()
                    if k.endswith("C")
                    and isinstance(v, str)
                    and len(v) == 6
                    and v.isdigit()
                    and 198001 <= int(v) <= 210012
                ),
                None,
            )
            if periodo is not None:
                try:
                    ipca[periodo] = float(r["V"])
                except (ValueError, TypeError):
                    pass
        ipca_anual = dict(duckdb.connect().execute(
            'SELECT exercicio,fator_real FROM read_parquet(?)',
            [fontes['gold/ipca.parquet']['local']],
        ).fetchall())
        social = {
            i["id"]: i
            for i in self.ler(self.rev / "assistencia_base.json")["indicadores"]
        }
        for i, q in zip(defs, qs):
            if i["metodo_referencia"] != "mediana":
                with np.errstate(divide="ignore", invalid="ignore"):
                    esperado = q["n"] / q["d"] * i.get("fator", 1)
                mask = np.isfinite(q["v"])
                if i.get("preserva_razao_publicada_sem_componentes"):
                    assert (
                        cat["area"] == "assistencia"
                        and i["id"] == "cad_pessoas_por_familia"
                    )
                    iguais(
                        q["v"], q["r"], (chave, i["id"], "razao-publicada-preservada")
                    )
                    mask &= np.isfinite(q["n"]) & np.isfinite(q["d"]) & (q["d"] > 0)
                iguais(q["v"][mask], esperado[mask], (chave, i["id"], "unidade-razao"))
            if i.get("anos_base_demografica"):
                base = np.array(
                    [
                        pop.get(
                            i["anos_base_demografica"][str(p)], np.full(5571, np.nan)
                        )
                        for p in i["periodos"]
                    ]
                )
                iguais(base, q["d"], (chave, i["id"], "populacao-IBGE"))
                numerador = q["r"].copy()
                if i["formato"] == "moeda":
                    ja_real = i.get('precos_original') == 'reais' or (
                        cat["area"] == "trabalho"
                        and i["id"] == "massa_real"
                        or cat["area"] == "assistencia"
                        and social[i["id"]].get("precos") == "reais"
                    )
                    if not ja_real:
                        ff = np.array(
                            [
                                (
                                    (ipca_anual[p] if ipca_anual[p] is not None else np.nan)
                                    if p <= 10000 and p in ipca_anual
                                    else ipca[202512]
                                    / ipca[p if p > 10000 else p * 100 + 12]
                                    if (p if p > 10000 else p * 100 + 12) in ipca
                                    else np.nan
                                )
                                for p in i["periodos"]
                            ]
                        )
                        numerador = numerador * ff[:, None]
                with np.errstate(divide="ignore", invalid="ignore"):
                    esperado = numerador / base * i["fator"]
                esperado[~np.isfinite(base) | (base <= 0)] = np.nan
                iguais(esperado, q["v"], (chave, i["id"], "normalizacao-independente"))

        for k, ss in refs.items():
            ter = self.geo["territorios"][k]
            if n == 27:
                pos = list(range(27))
            else:
                pos = [
                    j
                    for j, x in enumerate(self.muns)
                    if k == "BR"
                    or ter["nivel"] == "UF"
                    and x[2] == k
                    or ter["nivel"] == "imediata"
                    and "I:" + x[3] == k
                    or ter["nivel"] == "intermediaria"
                    and "T:" + x[4] == k
                ]
            assert len(pos) == cat["quantidades"][k]
            for i, q, s in zip(defs, qs, ss):
                for ressalvas in [False, True] if "com_ressalvas" in s else [False]:
                    esperado = s["com_ressalvas"] if ressalvas else s
                    v, nn, dd, c = [q[campo][:, pos] for campo in ["v", "n", "d", "c"]]
                    ok = np.isfinite(v) & (ressalvas | ~np.isin(c, [8, 18]))
                    met = i["metodo_referencia"]
                    extra = None
                    if cat["area"] == "trabalho" and i["id"] in [
                        "rem_media",
                        "rem_media_real",
                        "massa",
                        "massa_real",
                    ]:
                        extra = (
                            componentes("empregos", i["periodos"])
                            - componentes("sem_rem", i["periodos"])
                        )[:, pos]
                        ok = np.isfinite(extra) & (extra >= 0) & np.isfinite(dd)
                    elif (
                        cat["area"] == "trabalho"
                        and i.get("categoria", {}).get("medida") == "rem"
                    ):
                        ok = np.isin(c, [0, 1, 13, 14]) & np.isfinite(dd)
                        extra = np.where(np.isfinite(v), 1, 0)
                    elif cat["area"] == "trabalho" and i["id"] == "variacao_pct":
                        ok = (
                            np.isfinite(nn)
                            & np.isfinite(dd)
                            & np.isin(c, [0, 1, 4, 12])
                        )
                    if met != "mediana":
                        ok &= (
                            np.isfinite(nn)
                            & np.isfinite(dd)
                            & (
                                dd >= 0
                                if i.get("aceita_denominador_zero_agregado")
                                else dd > 0
                            )
                        )
                        ns = np.where(ok, nn, 0).sum(axis=1)
                        ds = np.where(ok, dd, 0).sum(axis=1)
                        with np.errstate(invalid="ignore", divide="ignore"):
                            valor = ns / ds * i.get("fator", 1)
                        valor[ds <= 0] = np.nan
                        if extra is not None:
                            valor[np.where(ok, extra, 0).sum(axis=1) <= 0] = np.nan
                        iguais(ns, esperado["n"], (chave, k, i["id"], "numerador"))
                        iguais(ds, esperado["d"], (chave, k, i["id"], "denominador"))
                    else:
                        valor = np.array(
                            [
                                np.median(vv[oo]) if oo.any() else np.nan
                                for vv, oo in zip(v, ok)
                            ]
                        )
                    if i.get("recusar_inesperadas"):
                        valor[(c == 17).any(axis=1)] = np.nan
                    iguais(valor, esperado["v"], (chave, k, i["id"], "agregacao"))
                    iguais(
                        ok.sum(axis=1), esperado["q"], (chave, k, i["id"], "cobertura")
                    )
        listas = set()
        for j, i in enumerate(defs):
            if not i.get("indice_lista"):
                continue
            idx, p = self.indices(i["indice_lista"], "recortes")
            listas.add(p)
        for p in listas:
            with p.open("rb") as f:
                for raw in f:
                    x = json.loads(raw)
                    i, q = porid[x["indicador"]]
                    pidx = i["periodos"].index(x["periodo"])
                    if "nivel" in x:
                        assert all(
                            self.geo["territorios"][key]["nivel"] == x["nivel"]
                            for key in x["grupos"]
                        )
                        for campo in ["v", "n", "d", "c", "q"]:
                            iguais(
                                x[campo],
                                [
                                    refs[key][defs.index(i)][campo][pidx]
                                    for key in x["grupos"]
                                ],
                                (chave, i["id"], campo, "lista-referencias"),
                            )
                    else:
                        pos = self.ufpos[x["uf"]]
                        assert len(pos) == x["quantidade"], (
                            chave,
                            x["indicador"],
                            x["periodo"],
                            x["uf"],
                            len(pos),
                            x["quantidade"],
                        )
                        for campo in ["v", "n", "d", "c", "r"]:
                            iguais(
                                x[campo],
                                q[campo][pidx, pos],
                                (chave, i["id"], campo, "lista-municipal"),
                            )
        # Cotejo independente dos brutos: todos os municípios, indicadores e anos dos
        # quatro mapas publicados, inclusive valores ausentes e protegidos.
        if cat["area"] in ["trabalho", "saneamento", "saude", "educacao"]:
            fontes = self.ler(self.rev / "fontes_comparacoes.json")["arquivos"]
            m = self.ler(self.rev / ("mapas_" + cat["area"] + "_base.json"))
            if cat["rede"] != "todas":
                m = self.ler(Path(fontes[m["redes"][cat["rede"]]["caminho"]]["local"]))
            ii = self.ler(
                Path(fontes[m["indicadores"][0]["indice"]["caminho"]]["local"])
            )
            src = Path(fontes[ii["arquivo"]["caminho"]]["local"])
            with src.open("rb") as f:
                for raw in f:
                    x = json.loads(raw)
                    i, q = porid[x["indicador"]]
                    k = i["periodos"].index(x["ano"])
                    pos = self.ufpos[x["uf"]]
                    vv = x["valores"] or [None] * len(pos)
                    iguais(vv, q["r"][k, pos], (chave, i["id"], "bruto-fonte"))
        if cat["area"] == "assistencia":
            # A razão publicada pode existir quando a contagem de famílias é
            # protegida. Confere todos os brutos diretamente com a fonte, sem
            # inferir o componente suprimido a partir dessa razão.
            meta = self.ler(self.rev / "assistencia_base.json")
            src = Path(fontes[meta["arquivo"]["caminho"]]["local"])
            vistos = set()
            brutos = {id: np.full(q["r"].shape, np.nan) for id, (_, q) in porid.items()}
            periodos = {
                id: {p: k for k, p in enumerate(i["periodos"])}
                for id, (i, _) in porid.items()
            }
            with src.open("rb") as f:
                for raw in f:
                    x = json.loads(raw)
                    if x["grupo"] not in self.pos:
                        continue
                    col = self.pos[x["grupo"]]
                    vistos.add(x["grupo"])
                    for serie in x["series"].values():
                        for row in serie:
                            for id, v in row["valores"].items():
                                if id not in porid:
                                    continue
                                k = periodos[id].get(row["competencia"])
                                if k is not None:
                                    brutos[id][k, col] = np.nan if v is None else v
            assert len(vistos) == len(self.muns)
            for id, (_, q) in porid.items():
                iguais(brutos[id], q["r"], (chave, id, "bruto-fonte"))
        self.stats[chave] = dict(
            indicadores=len(defs),
            celulas=celulas,
            territorios=len(cat["quantidades"]),
            indices=len(cat["indices"]),
        )
        print(chave, self.stats[chave], flush=True)

    def executar(self):
        for k, r in self.m["catalogos"].items():
            self.auditar(k, r)
        out = dict(ok=True, objetos_verificados=len(self.checados), areas=self.stats)
        (self.rev / "auditoria_comparacoes.json").write_text(
            json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(json.dumps(out), flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--base", required=True, type=Path)
    p.add_argument("--revisao", required=True, type=Path)
    a = p.parse_args()
    Auditor(a.base, a.revisao).executar()
