"""Comparações prontas, relativas ao universo correto, a partir de fontes fixadas.

Não modifica fontes nem publica. Lê fontes_comparacoes.json; grava apenas candidato
novo e separado. Os dados absolutos originais permanecem nos arquivos da fonte.
"""

import argparse, json, math
from pathlib import Path
import duckdb, numpy as np
from comparacoes_base import Quadro, Territorios, Gravador, por_base, sha, compacto


class Comparacoes:
    def __init__(self, revisao, saida, repo):
        self.rev = Path(revisao).resolve()
        self.saida = Path(saida).resolve()
        self.repo = Path(repo).resolve()
        self.fontes = json.loads((self.rev / "fontes_comparacoes.json").read_bytes())
        self.refs = self.fontes["arquivos"]
        self.con = duckdb.connect()
        self.verificados = set()
        for r in self.refs.values():
            p = Path(r["local"]).resolve()
            assert not self.saida.is_relative_to(p.parent) and not p.is_relative_to(
                self.saida
            ), "Destino sobreposto à origem"
        self.geo = Territorios(
            json.loads((self.rev / "ibge_localidades.json").read_bytes())
        )
        self.m = self.geo.municipios
        self.pos = self.geo.pos
        self.uf = {
            u: np.array(p)
            for u, p in self.geo.grupos.items()
            if self.geo.territorios[u]["nivel"] == "UF"
        }
        self.pop = {}
        self.pop_anos = {}
        self.audit = {}
        self._preparar_populacao()
        self._preparar_ipca()
        origens = {
            **self.fontes["raizes"],
            **{
                k: {c: r[c] for c in ["bytes", "sha256", "etag"]}
                for k, r in self.refs.items()
                if "etag" in r
            },
        }
        self.writer = Gravador(self.saida, self.geo, self.rev, origens)

    def ler(self, n):
        return json.loads((self.rev / n).read_bytes())

    def arquivo(self, key):
        p = Path(self.refs[key]["local"])
        assert p.stat().st_size == self.refs[key]["bytes"]
        if key not in self.verificados:
            assert sha(p.read_bytes()) == self.refs[key]["sha256"], (
                "Fonte alterada: " + key
            )
            self.verificados.add(key)
        return p

    def objeto(self, r):
        p = self.arquivo(r["caminho"])
        b = p.read_bytes()
        assert len(b) == r["bytes"] and sha(b) == r["sha256"]
        return json.loads(b)

    def sql(self, key):
        return "read_parquet('" + self.arquivo(key).as_posix().replace("'", "''") + "')"

    def _preparar_populacao(self):
        p = Path(self.refs["populacao_historica"]["local"])
        assert sha(p.read_bytes()) == self.refs["populacao_historica"]["sha256"]
        for ano, cod, pop in self.con.execute(
            "SELECT ano,cod_ibge,populacao FROM read_parquet(?)", [str(p)]
        ).fetchall():
            if int(cod) in self.pos and pop is not None and pop > 0:
                self.pop.setdefault(int(ano), np.full(len(self.m), np.nan))[
                    self.pos[int(cod)]
                ] = pop
        oficial=self.ler('ibge_populacao_2026.json')[1:]
        anos_oficiais={int(x['D3C']) for x in oficial}
        assert len(anos_oficiais)==1,'Publicação de população mistura anos'
        ano_atual=next(iter(anos_oficiais))
        atual = {int(x['D1C']):int(x['V']) for x in oficial}
        assert set(atual) == set(self.pos)
        for cod, v in atual.items():
            antigo = self.pop.get(ano_atual, np.full(len(self.m), np.nan))[self.pos[cod]]
            assert (
                not np.isfinite(antigo) or antigo == v
            ), "População local diferente da publicação atual"
            self.pop.setdefault(ano_atual, np.full(len(self.m), np.nan))[self.pos[cod]] = v
        for y in range(1990,max([ano_atual,*self.pop])+1):
            # Mesma regra do painel original: em 2023 não houve estimativa, utiliza-se
            # o Censo 2022, com o ano da base explícito. Não se cria população 2023.
            self.pop_anos[y] = (
                y if y in self.pop else 2022 if y == 2023 and 2022 in self.pop else None
            )

    def populacao(self, periodos):
        anos = [p // 100 if p > 10000 else p for p in periodos]
        base = np.array(
            [
                self.pop.get(self.pop_anos.get(y), np.full(len(self.m), np.nan))
                for y in anos
            ]
        )
        return base, {str(p): self.pop_anos.get(y) for p, y in zip(periodos, anos)}

    def _preparar_ipca(self):
        raw = self.ler("ipca_mensal.json")
        self.ipca = {}
        for r in raw[1:]:
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
                    v = float(r["V"])
                except (ValueError, TypeError):
                    continue
                if v > 0:
                    self.ipca[periodo] = v
        self.base_ipca = self.ler("global_base.json")["base_ipca"]
        assert self.base_ipca * 100 + 12 in self.ipca

    def fatores(self, periodos):
        return np.array(
            [
                (
                    self.ipca[self.base_ipca * 100 + 12]
                    / self.ipca[p if p > 10000 else p * 100 + 12]
                    if (p if p > 10000 else p * 100 + 12) in self.ipca
                    else np.nan
                )
                for p in periodos
            ]
        )

    def densidade(self, i, periodos, v, c, *, monetario=False):
        p, anos = self.populacao(periodos)
        d = dict(i)
        unidade_original = i.get("unidade_original", i.get("unidade", "número"))
        d.update(
            unidade_original=unidade_original,
            nome_original=i.get("nome_original", i["nome"]),
            nome_original_en=i.get("nome_original_en", i["nome_en"]),
        )
        if monetario:
            titulo_pt = " por habitante"
            titulo_en = " per inhabitant"
            fator = 1
            un = "R$ por habitante"
            une = "R$ per inhabitant"
        else:
            titulo_pt = " por 1.000 habitantes"
            titulo_en = " per 1,000 inhabitants"
            fator = 1000
            un = unidade_original + " por 1.000 habitantes"
            une = i.get("unidade_en", unidade_original) + " per 1,000 inhabitants"
        d.update(
            nome=i["nome"] + titulo_pt,
            nome_en=i["nome_en"] + titulo_en,
            unidade=un,
            unidade_en=une,
            formato="moeda" if monetario else "numero",
            normalizacao="Valor observado dividido pela população residente de referência do IBGE. Não é taxa de cobertura, elegibilidade ou qualidade.",
            normalizacao_en="Observed value divided by the IBGE reference resident population. This is not a coverage, eligibility or quality rate.",
            denominador_nome="População residente (IBGE)",
            denominador_nome_en="Resident population (IBGE)",
            numerador_nome=i["nome"],
            numerador_nome_en=i["nome_en"],
            ranking=True,
        )
        return por_base(d, periodos, v, c, p, fator=fator, base_anos=anos)

    def mapa(self, area, rede="todas"):
        base = self.ler("mapas_" + area + "_base.json")
        m = base if rede == "todas" else self.objeto(base["redes"][rede])
        cad = self.objeto(m["cadastro"])["municipios"]
        assert [c[0] for c in cad] == [r[0] for r in self.m]
        indices = {i["id"]: self.objeto(i["indice"]) for i in m["indicadores"]}
        arq = next(iter(indices.values()))["arquivo"]
        quadros = {}
        for i in m["indicadores"]:
            shape = (len(i["anos"]), len(self.m))
            quadros[i["id"]] = dict(
                meta=dict(i),
                periodos=i["anos"],
                v=np.full(shape, np.nan),
                n=np.full(shape, np.nan),
                d=np.full(shape, np.nan),
                c=np.full(shape, 2, dtype=np.uint8),
                pay=np.full(shape, np.nan),
                anos={a: k for k, a in enumerate(i["anos"])},
            )
        with self.arquivo(arq["caminho"]).open(encoding="utf-8") as f:
            for line in f:
                x = json.loads(line)
                q = quadros[x["indicador"]]
                a = q["anos"][x["ano"]]
                pos = self.uf[x["uf"]]
                assert x["quantidade"] == len(pos)
                vals = x["valores"] if x["valores"] is not None else [None] * len(pos)
                q["v"][a, pos] = np.asarray(vals, dtype=float)
                q["n"][a, pos] = np.asarray(
                    x.get("numeradores", [None] * len(pos)), dtype=float
                )
                q["d"][a, pos] = np.asarray(
                    x.get("denominadores", [None] * len(pos)), dtype=float
                )
                q["pay"][a, pos] = np.asarray(
                    x.get("rem_validas", [None] * len(pos)), dtype=float
                )
                q["c"][a, pos] = x.get(
                    "condicoes",
                    [
                        (
                            2
                            if v is None
                            else (
                                8
                                if x.get("marcadores", [None] * len(pos))[k] in [1, 2]
                                else 1 if v == 0 else 0
                            )
                        )
                        for k, v in enumerate(vals)
                    ],
                )
        saude = (
            {x["id"]: x for x in self.ler("saude_catalogo_origem.json")["indicadores"]}
            if area == "saude"
            else {}
        )
        out = []
        for id, q in quadros.items():
            i = q["meta"]
            periodos = q["periodos"]
            v, n, d, c = q["v"], q["n"], q["d"], q["c"]
            orig = v.copy()
            i.update(
                unidade_original=(
                    "fração (×100 = %)" if i["formato"] == "fracao" else i["unidade"]
                ),
                nome_original=i["nome"],
                nome_original_en=i["nome_en"],
                ranking=True,
                frequencia="anual",
                fator=1,
                metodo_referencia="mediana",
                normalizacao="Mediana dos valores municipais válidos, sem produzir um índice oficial regional.",
                normalizacao_en="Median of valid municipal values; this does not create an official regional index.",
            )
            for campo in ["indice", "escala", "anos_com_valor", "anos", "redes"]:
                i.pop(campo, None)
            if area == "saneamento" and i["formato"] == "numero":
                out.append(self.densidade(i, periodos, v, c))
                continue
            if area == "educacao" and i["formato"] == "numero":
                out.append(self.densidade(i, periodos, v, c))
                continue
            if (
                area == "trabalho"
                and i["formato"] == "numero"
                and id not in ["por_mil", "vinculos_por_estab"]
            ):
                out.append(self.densidade(i, periodos, v, c))
                continue
            if area == "trabalho" and id in ["massa", "massa_real"]:
                if id == "massa":
                    v = v * self.fatores(periodos)[:, None]
                i.update(
                    precos="reais",
                    base_ipca=self.base_ipca,
                    nome=i["nome"].replace(" (nominal)", "")
                    + f" (IPCA dez/{self.base_ipca})",
                    nome_en=i["nome_en"].replace(" (nominal)", "")
                    + f" (Dec/{self.base_ipca} IPCA)",
                )
                qout = self.densidade(i, periodos, v, c, monetario=True)
                qout.originais = orig
                vagas = quadros["empregos"]["v"]
                validas = vagas - quadros["sem_rem"]["v"]
                eleg = (
                    np.isfinite(validas)
                    & (validas >= 0)
                    & np.isfinite(qout.denominadores)
                    & (qout.denominadores > 0)
                )
                qout.numeradores[eleg & (validas == 0)] = 0
                qout.elegiveis = eleg
                qout.validacao_extra = validas
                out.append(qout)
                continue
            formato = i["formato"]
            fator = 100 if formato == "fracao" else 1
            if formato == "fracao":
                v = v * 100
                i.update(formato="percentual", unidade="%", unidade_en="%")
            if area == "saude":
                fator = saude[id]["fator"] * (100 if formato == "fracao" else 1)
                i["metodo_referencia"] = "razao"
            elif area == "saneamento":
                fator = 100
                i["metodo_referencia"] = "razao"
            elif area == "trabalho" and id not in [
                "razao_mh",
                "rem_mulheres",
                "rem_homens",
            ]:
                i["metodo_referencia"] = "razao"
                fator = 1000 if id == "por_mil" else fator
            elif area == "educacao" and id.startswith("mat_") and id.endswith("_pct"):
                rawid = id[:-4]
                if rawid in quadros:
                    nn = quadros[rawid]
                    baseq = quadros["mat_total"]
                    n = np.array(
                        [
                            (
                                nn["v"][nn["anos"][a]]
                                if a in nn["anos"]
                                else np.full(len(self.m), np.nan)
                            )
                            for a in periodos
                        ]
                    )
                    d = np.array(
                        [
                            (
                                baseq["v"][baseq["anos"][a]]
                                if a in baseq["anos"]
                                else np.full(len(self.m), np.nan)
                            )
                            for a in periodos
                        ]
                    )
                    i["metodo_referencia"] = "razao"
                    fator = 100
            if i["metodo_referencia"] == "razao":
                i.update(
                    normalizacao="Soma dos numeradores dividida pela soma dos denominadores dos mesmos municípios e período.",
                    normalizacao_en="Sum of numerators divided by the sum of denominators for the same municipalities and period.",
                )
            i["fator"] = fator
            qout = Quadro(i, periodos, v, n, d, c, originais=orig)
            if area == "trabalho" and id in ["rem_media", "rem_media_real"]:
                validas = quadros["empregos"]["v"] - quadros["sem_rem"]["v"]
                eleg = np.isfinite(validas) & (validas >= 0) & np.isfinite(d)
                qout.numeradores = n.copy()
                qout.numeradores[eleg & (validas == 0)] = 0
                qout.elegiveis = eleg
                qout.validacao_extra = validas
                i["aceita_denominador_zero_agregado"] = True
                c[eleg & (validas == 0) & (quadros['empregos']['v'] > 0)] = 13
                c[eleg & (quadros['empregos']['v'] == 0)] = 14
            if area == "trabalho" and i.get("categoria", {}).get("medida") == "rem":
                eleg = np.isin(c, [0, 1, 13, 14]) & np.isfinite(d)
                n = n.copy()
                n[np.isin(c, [13, 14])] = 0
                qout.numeradores = n
                qout.elegiveis = eleg
                qout.validacao_extra = q["pay"]
                i["aceita_denominador_zero_agregado"] = True
            if area == "trabalho" and id == "variacao_pct":
                qout.elegiveis = (
                    np.isfinite(n) & np.isfinite(d) & np.isin(c, [0, 1, 4, 12])
                )
                i["aceita_denominador_zero_agregado"] = True
            if area == "saude" and formato == "moeda":
                fat = self.fatores(periodos)
                qout.valores = v * fat[:, None]
                qout.numeradores = n * fat[:, None]
                qout.condicoes[np.isfinite(v) & ~np.isfinite(qout.valores)] = 21
                i.update(
                    nome=i["nome"] + f" (IPCA dez/{self.base_ipca})",
                    nome_en=i["nome_en"] + f" (Dec/{self.base_ipca} IPCA)",
                    precos="reais",
                    base_ipca=self.base_ipca,
                )
            if area == "trabalho" and formato == "moeda":
                # Só rem_media_real já está deflacionada. Os perfis são nominais.
                if id != "rem_media_real":
                    fat = self.fatores(periodos)
                    qout.valores = v * fat[:, None]
                    qout.numeradores = qout.numeradores * fat[:, None]
                    qout.condicoes[np.isfinite(v) & ~np.isfinite(qout.valores)] = 21
                i.update(
                    precos="reais",
                    base_ipca=self.base_ipca,
                    nome=i["nome"] + f" (IPCA dez/{self.base_ipca})",
                    nome_en=i["nome_en"] + f" (Dec/{self.base_ipca} IPCA)",
                )
                i[
                    "descricao"
                ] += " Na comparação, o valor e a massa são corrigidos pelo IPCA para a base indicada."
                i[
                    "descricao_en"
                ] += " Comparisons adjust both pay and payroll by IPCA to the indicated price base."
            out.append(qout)
        if area == "saude":
            from comparacoes_saude import complementos

            out.extend(complementos(self))
        origem = dict(
            tipo="mapa",
            caminho="gold/mapas/" + area + "_manifesto.json",
            sha256=self.fontes["raizes"]["gold/mapas/" + area + "_manifesto.json"][
                "sha256"
            ],
        )
        self.writer.area(area, out, origem, rede=rede)
        self.audit[area + "_" + rede] = dict(
            indicadores=len(out),
            valores=sum(int(np.isfinite(q.valores).sum()) for q in out),
        )
        print(area, rede, self.audit[area + "_" + rede], flush=True)

    def financas(self):
        dl = self.ler("downloads_base.json")
        ref = next(
            x
            for x in dl["arquivos"]
            if x.get("area") == "financas" and x["formato"] == "parquet"
        )
        path = self.arquivo(ref["caminho"])
        dic = self.objeto(dl["dicionario"])
        defs = {i["variavel"]: i for i in dic}
        df = self.con.execute("SELECT * FROM read_parquet(?)", [str(path)]).fetchdf()
        anos = sorted(map(int, df.ano.unique()))
        py = {a: k for k, a in enumerate(anos)}
        shape = (len(anos), len(self.m))
        cols = [
            c
            for c in df.columns
            if c in defs
            and defs[c]["area"] == "financas"
            and c
            not in [
                "fin_populacao_ibge",
                "fin_populacao_ibge_ano",
                "lrf_rreo_tipo",
                "lrf_rgf_tipo",
                "lrf_pessoal_limite_pct",
            ]
            and not c.startswith("fin_alerta")
        ]
        out = []
        # DuckDB/pandas pode trazer BooleanDtype e pd.NA; mantém ausências como None,
        # inclusive nos sinalizadores, sem atribuir valor zero às observações.
        df = df.astype(object).where(df.notna(), None)
        for campo in cols:
            desc = defs[campo]
            v = np.full(shape, np.nan)
            c = np.full(shape, 2, dtype=np.uint8)
            for r in df[
                [
                    "cod_ibge",
                    "ano",
                    campo,
                    "fin_alerta_receita_exclui",
                    "fin_alerta_despesa_exclui",
                ]
            ].itertuples(index=False, name=None):
                cod, a, x, are, ade = r
                if int(cod) not in self.pos or x is None or not np.isfinite(x):
                    continue
                k = py[int(a)]
                p = self.pos[int(cod)]
                v[k, p] = x
                c[k, p] = (
                    18
                    if (
                        (
                            campo.startswith("fin_receita")
                            or campo
                            in [
                                "fin_fpm",
                                "fin_icms",
                                "fin_ipva",
                                "fin_iptu",
                                "fin_iss",
                                "fin_itbi",
                            ]
                        )
                        and are == 1
                    )
                    or (
                        (
                            campo.startswith("fin_despesa")
                            or campo == "fin_investimentos"
                        )
                        and ade == 1
                    )
                    else 1 if x == 0 else 0
                )
            i = dict(
                id=campo,
                nome=desc["nome"],
                nome_en=desc.get("nome_en", desc["nome"]),
                descricao=desc.get("descricao", desc["nome"]),
                descricao_en=desc.get(
                    "descricao_en", desc.get("descricao", desc["nome"])
                ),
                unidade=desc["unidade"],
                unidade_en=desc["unidade"],
                formato="numero",
                fonte_nome=desc["fonte"],
                fontes=[
                    dict(nome="STN · Siconfi", url="https://siconfi.tesouro.gov.br/"),
                    dict(nome="IBGE · SIDRA", url="https://sidra.ibge.gov.br/"),
                ],
                tema="Finanças e economia",
                tema_en="Finance and economy",
                frequencia="anual",
                ranking=True,
                minimo=0,
                metodo_referencia="mediana",
                fator=1,
            )
            percentual = campo.endswith("_pct")
            intensivo = (
                percentual
                or campo.endswith("_hab")
                or campo.startswith("se_aluno")
                or campo == "fin_pib_per_capita"
            )
            if not percentual:
                orig = v.copy()
                v = v * self.fatores(anos)[:, None]
                c[np.isfinite(orig) & ~np.isfinite(v)] = 21
                i.update(
                    formato="moeda",
                    precos="reais",
                    base_ipca=self.base_ipca,
                    nome=i["nome"] + f" (IPCA dez/{self.base_ipca})",
                    nome_en=i["nome_en"] + f" (Dec/{self.base_ipca} IPCA)",
                )
            else:
                orig = v.copy()
                i.update(formato="percentual", unidade="%", unidade_en="%")
            if intensivo:
                i.update(
                    normalizacao="Referência: mediana dos indicadores municipais publicados; não é percentual ou média oficial agregada.",
                    normalizacao_en="Reference: median of published municipal indicators; not an official aggregate percentage or mean.",
                )
                out.append(
                    Quadro(
                        i,
                        anos,
                        v,
                        np.full(shape, np.nan),
                        np.full(shape, np.nan),
                        c,
                        originais=orig,
                    )
                )
            else:
                i.update(unidade="R$", unidade_en="R$")
                q = self.densidade(i, anos, v, c, monetario=True)
                q.originais = orig
                out.append(q)
        self.writer.area(
            "financas",
            out,
            dict(
                tipo="downloads",
                caminho="gold/downloads/manifesto.json",
                sha256=self.fontes["raizes"]["gold/downloads/manifesto.json"]["sha256"],
            ),
        )
        print("financas", len(out), flush=True)

    def assistencia(self):
        m = self.ler("assistencia_base.json")
        qs = {}
        status = {
            "registrado": 0,
            "zero_registrado": 1,
            "sem_registro": 2,
            "denominador_ausente": 3,
            "denominador_zero": 4,
            "suprimido": 20,
            "protegido_ou_ausente": 20,
            "indisponivel_ipca": 21,
            "parcial": 11,
            "nao_aplicavel": 5,
            "inconsistente": 9,
        }
        for i in m["indicadores"]:
            periodos = i.get("competencias") or m["fontes"][i["fonte"]]["competencias"]
            shape = (len(periodos), len(self.m))
            qs[i["id"]] = dict(
                meta=dict(i),
                periodos=periodos,
                py={p: k for k, p in enumerate(periodos)},
                v=np.full(shape, np.nan),
                c=np.full(shape, 2, dtype=np.uint8),
            )
        with self.arquivo(m["arquivo"]["caminho"]).open(encoding="utf-8") as f:
            for linha in f:
                g = json.loads(linha)
                if not g["grupo"].isdigit() or int(g["grupo"]) not in self.pos:
                    continue
                p = self.pos[int(g["grupo"])]
                for serie in g["series"].values():
                    for row in serie:
                        for id, x in row["valores"].items():
                            q = qs.get(id)
                            if q is None or row["competencia"] not in q["py"]:
                                continue
                            k = q["py"][row["competencia"]]
                            q["v"][k, p] = np.nan if x is None else x
                            cond = row.get("condicoes", {}).get(id)
                            q["c"][k, p] = (
                                status.get(cond, 2)
                                if x is None
                                else status.get(cond, 1 if x == 0 else 0)
                            )
        out = []
        for id, q in qs.items():
            i = q["meta"]
            pp = q["periodos"]
            v = q["v"]
            c = q["c"]
            orig = v.copy()
            unit = i["unidade"]
            i.update(
                formato=(
                    "percentual"
                    if unit == "razao"
                    else unit if unit in ["moeda", "indice"] else "numero"
                ),
                unidade=(
                    "%"
                    if unit == "razao"
                    else (
                        "R$"
                        if unit == "moeda"
                        else (
                            "número"
                            if unit == "numero"
                            else (
                                "índice 0–1"
                                if unit == "indice"
                                else "pessoas por família"
                            )
                        )
                    )
                ),
                unidade_en=(
                    "%"
                    if unit == "razao"
                    else (
                        "R$"
                        if unit == "moeda"
                        else (
                            "number"
                            if unit == "numero"
                            else (
                                "0–1 index" if unit == "indice" else "people per family"
                            )
                        )
                    )
                ),
                frequencia="mensal",
                ranking=True,
                minimo=0,
                fator=1,
                metodo_referencia="mediana",
                fonte_nome=m["fontes"][i["fonte"]]["nome"],
                fontes=[
                    dict(
                        nome=m["fontes"][i["fonte"]]["nome"],
                        url=m["fontes"][i["fonte"]]["url"],
                    )
                ],
                alerta=" ".join(m["fontes"][i["fonte"]]["avisos"]),
                alerta_en=" ".join(m["fontes"][i["fonte"]]["avisos_en"]),
            )
            if unit == "numero":
                if id in ["cad_qtd_familias", "cad_qtd_pessoas"]:
                    pt, en = (
                        ("famílias", "families")
                        if id == "cad_qtd_familias"
                        else ("pessoas", "people")
                    )
                    i.update(unidade=pt, unidade_en=en)
                out.append(self.densidade(i, pp, v, c))
                continue
            if unit == "moeda" and i.get("precos") != "reais":
                fatores = self.fatores(pp)
                v = v * fatores[:, None]
                c[np.isfinite(orig) & ~np.isfinite(v)] = 21
                i.update(
                    precos="reais",
                    base_ipca=self.base_ipca,
                    nome=i["nome"] + f" (IPCA dez/{self.base_ipca})",
                    nome_en=i["nome_en"] + f" (Dec/{self.base_ipca} IPCA)",
                )
            if unit == "moeda" and i["acumulavel"]:
                qout = self.densidade(i, pp, v, c, monetario=True)
                qout.originais = orig
                out.append(qout)
                continue
            if unit == "razao":
                v = v * 100
            i.update(
                normalizacao="Referência: mediana municipal dos valores publicados, não um índice oficial regional.",
                normalizacao_en="Reference: municipal median of published values, not an official regional index.",
            )
            n = np.full(v.shape, np.nan)
            d = n.copy()
            if id == "cad_pessoas_por_familia":
                n = qs["cad_qtd_pessoas"]["v"].copy()
                d = qs["cad_qtd_familias"]["v"].copy()
                i.update(
                    metodo_referencia="razao",
                    fator=1,
                    preserva_razao_publicada_sem_componentes=True,
                    normalizacao="Pessoas cadastradas divididas pelas famílias cadastradas, no mesmo retrato. Se a fonte protege um dos componentes, mantém-se somente a razão municipal publicada, sem reconstruir a contagem protegida; o município fica fora das referências agregadas.",
                    normalizacao_en="Registered people divided by registered families in the same snapshot. When a component is protected, only the published municipal ratio is retained, without reconstructing the protected count; that municipality is excluded from aggregated references.",
                )
            out.append(Quadro(i, pp, v, n, d, c, originais=orig))
        origem = self.ler("global_base.json")["fontes"]["assistencia"]["abertura"]
        self.writer.area(
            "assistencia",
            out,
            dict(tipo="objeto", caminho=origem["caminho"], sha256=origem["sha256"]),
        )
        print("assistencia", len(out), flush=True)

    def clima(self):
        cat = (
            self.con.execute("SELECT * FROM " + self.sql("gold/clima/catalogo.parquet"))
            .fetchdf()
            .to_dict("records")
        )
        out = []
        areas = np.full(len(self.m), np.nan)
        for cod, area in self.con.execute(
            "SELECT cod,area_km2 FROM " + self.sql("gold/clima/territorio.parquet")
        ).fetchall():
            if cod in self.pos and area is not None and area > 0:
                areas[self.pos[cod]] = area
        nomes = {
            "chuva_mm": ("Chuva", "Rainfall", "mm"),
            "temperatura_c": (
                "Temperatura do ar a 2 m",
                "Air temperature at 2 m",
                "°C",
            ),
            "orvalho_c": ("Ponto de orvalho a 2 m", "Dew point at 2 m", "°C"),
            "umid_solo_pct": ("Umidade do solo", "Soil moisture", "%"),
            "evap_mm": ("Evapotranspiração", "Evapotranspiration", "mm"),
            "radiacao_wm2": ("Radiação solar", "Solar radiation", "W/m²"),
        }
        for meta in cat:
            id = meta["variavel"]
            linhas = self.con.execute(
                "SELECT cod,ano,valor,normal,anomalia_pct,anomalia FROM "
                + self.sql("gold/clima/anual.parquet")
                + " WHERE variavel=?",
                [id],
            ).fetchall()
            anos = sorted({int(r[1]) for r in linhas})
            py = {a: k for k, a in enumerate(anos)}
            shape = (len(anos), len(self.m))
            v = np.full(shape, np.nan)
            normal = v.copy()
            for cod, ano, x, b, _, _ in linhas:
                if cod in self.pos:
                    v[py[ano], self.pos[cod]] = np.nan if x is None else x
                    normal[py[ano], self.pos[cod]] = np.nan if b is None else b
            area = np.broadcast_to(areas, shape).copy()
            unit = nomes[id][2]
            prefixo = (
                "Acumulado anual: "
                if meta["resumo_anual"] == "soma"
                else "Média anual: "
            )
            prefixoen = (
                "Annual total: " if meta["resumo_anual"] == "soma" else "Annual mean: "
            )
            i = dict(
                id=id,
                nome=prefixo + nomes[id][0],
                nome_en=prefixoen + nomes[id][1],
                descricao="Anos com 12 meses. A referência espacial pondera cada município pela área em km², e não pela população.",
                descricao_en="Years with 12 months. Spatial references weight each municipality by its area in km², not by population.",
                tema="Clima anual",
                tema_en="Annual climate",
                unidade=unit,
                unidade_en=unit,
                formato="numero",
                frequencia="anual",
                ranking=True,
                minimo=0,
                metodo_referencia="area",
                fator=1,
                normalizacao="Média espacial ponderada pela área dos municípios com valor válido. Somente anos completos; os meses e acumulados parciais continuam no painel de clima.",
                normalizacao_en="Spatial mean weighted by the area of municipalities with valid data. Complete years only; months and partial totals remain on the climate dashboard.",
                fonte_nome=meta["fonte"],
                fontes=[
                    dict(
                        nome=meta["fonte"],
                        url=(
                            "https://www.chc.ucsb.edu/data/chirps3"
                            if id == "chuva_mm"
                            else "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-land-monthly-means"
                        ),
                    )
                ],
                com_sinal=True,
            )
            c = np.where(np.isfinite(v), np.where(v == 0, 1, 0), 2).astype(np.uint8)
            out.append(Quadro(i, anos, v, v * area, area, c))
            pct = meta["anomalia"] == "pct"
            with np.errstate(invalid="ignore", divide="ignore"):
                an = (v / normal - 1) * 100 if pct else v - normal
            if pct:
                an[normal <= 0] = np.nan
            cc = np.where(
                np.isfinite(an), np.where(an == 0, 1, 0), np.where(np.isfinite(v), 3, 2)
            ).astype(np.uint8)
            d = area * normal if pct else area
            n = (v - normal) * area
            ni = {
                **i,
                "id": id + "_anomalia",
                "nome": nomes[id][0] + ": desvio da normal 1991–2020",
                "nome_en": nomes[id][1] + ": deviation from the 1991–2020 normal",
                "unidade": "%" if pct else unit,
                "unidade_en": "%" if pct else unit,
                "fator": 100 if pct else 1,
                "formato": "percentual" if pct else "numero",
                "normalizacao": "Diferença em relação à normal 1991–2020, sobre a mesma área com valor e normal disponíveis; em %, razão das somas ponderadas, sem média de percentuais municipais.",
                "normalizacao_en": "Difference from the 1991–2020 normal over the same area with both values available; percentages use the ratio of weighted sums, not an average of municipal percentages.",
            }
            out.append(Quadro(ni, anos, an, n, d, cc))
        self.writer.area(
            "clima",
            out,
            dict(
                tipo="parquet",
                caminho="gold/clima/anual.parquet",
                sha256=self.refs["gold/clima/anual.parquet"]["sha256"],
            ),
        )
        print("clima", len(out), flush=True)

    def gestao(self):
        s = (self.repo / "web/src/munic_curadoria.ts").read_text(encoding="utf-8")
        cur = json.JSONDecoder().raw_decode(s[s.index("= [") + 2 :])[0]
        res = self.con.execute(
            "SELECT pesquisa,ano,cod,var,valor_txt,valor_num,valida FROM "
            + self.sql("gold/munic/painel_respostas.parquet")
        ).fetchall()
        por = {
            (p, int(a), int(c), var): (txt, num, valida)
            for p, a, c, var, txt, num, valida in res
        }
        out = []
        est = []
        pest = {int(x[0][2:]): k for k, x in enumerate(self.geo.governos)}
        for ind in cur:
            estadual = ind["pesquisa"] == "estadic"
            pos = pest if estadual else self.pos
            anos = sorted({f["ano"] for f in ind["fontes"]})
            shape = (len(anos), len(pos))
            v = np.full(shape, np.nan)
            n = v.copy()
            d = v.copy()
            c = np.full(shape, 2, dtype=np.uint8)
            binario = ind["tipo"] == "binario"
            sim = set(ind.get("sim", []))
            nao = set(ind.get("nao", []))
            for k, ano in enumerate(anos):
                f = next(f for f in ind["fontes"] if f["ano"] == ano)
                for cod, p in pos.items():
                    r = por.get((ind["pesquisa"], ano, cod, f["var"]))
                    if not r or not r[2]:
                        continue
                    txt, num, _ = r
                    if binario:
                        if txt not in sim | nao:
                            c[k, p] = 17
                            continue
                        n[k, p] = 1 if txt in sim else 0
                        d[k, p] = 1
                        v[k, p] = n[k, p] * 100
                        c[k, p] = 1 if v[k, p] == 0 else 0
                    elif num is not None and np.isfinite(num) and num >= 0:
                        v[k, p] = num
                        c[k, p] = 1 if num == 0 else 0
                    else:
                        c[k, p] = 17
            contexto = ind.get("contexto", {})
            i = dict(
                id=ind["id"],
                nome=ind["titulo"]["pt"],
                nome_en=ind["titulo"]["en"],
                descricao=contexto.get(
                    "pt",
                    "Resposta à pergunta da edição indicada do IBGE; não é nota de qualidade da gestão.",
                ),
                descricao_en=contexto.get(
                    "en",
                    "Answer to the IBGE question in the specified edition; this is not a management-quality score.",
                ),
                tema=ind["bloco"],
                tema_en=ind["bloco"],
                frequencia="anual",
                fonte_nome=ind["pesquisa"].upper() + " · IBGE",
                fontes=[
                    dict(
                        nome="IBGE · " + ind["pesquisa"].upper(),
                        url="https://www.ibge.gov.br/estatisticas/sociais/administracao-publica-e-participacao-politica.html",
                    )
                ],
                edicoes=ind["fontes"],
                ranking=not binario,
                binario=binario,
                minimo=0,
                recusar_inesperadas=True,
                fator=100 if binario else 1,
                metodo_referencia="resposta" if binario else "razao",
                unidade="%" if binario else ind["unidade"]["pt"],
                unidade_en="%" if binario else ind["unidade"]["en"],
                formato="percentual" if binario else "numero",
                normalizacao="No território individual, Sim ou Não. Nas referências, percentual das respostas efetivas Sim ÷ (Sim + Não), sem transformar ausência em Não.",
                normalizacao_en="For an individual territory, Yes or No. References show the share of effective answers Yes ÷ (Yes + No), without treating missing answers as No.",
            )
            if binario:
                q = Quadro(i, anos, v, n, d, c)
            elif not estadual:
                q = self.densidade(i, anos, v, c)
            else:
                base, _ = self.populacao(anos)
                popuf = np.array(
                    [
                        [
                            (
                                np.nansum(base[k, self.uf[uf]])
                                if np.all(np.isfinite(base[k, self.uf[uf]]))
                                else np.nan
                            )
                            for _, _, uf in self.geo.governos
                        ]
                        for k in range(len(anos))
                    ]
                )
                i.update(
                    nome=i["nome"] + " por 1.000 habitantes",
                    nome_en=i["nome_en"] + " per 1,000 inhabitants",
                    unidade="servidores por 1.000 habitantes",
                    unidade_en="staff per 1,000 inhabitants",
                    normalizacao="Quadro do governo estadual dividido pela população da UF. Não é a soma das prefeituras e não se reparte entre regiões.",
                    normalizacao_en="State government staff divided by the state population. This is not the sum of city governments and is not allocated to regions.",
                )
                q = por_base(i, anos, v, c, popuf)
            (est if estadual else out).append(q)
        origem = dict(
            tipo="parquet",
            caminho="gold/munic/painel_respostas.parquet",
            sha256=self.refs["gold/munic/painel_respostas.parquet"]["sha256"],
        )
        self.writer.area("gestao", out, origem)
        groups = {key: [k] for k, (key, _, _) in enumerate(self.geo.governos)}
        groups["E:BR"] = list(range(27))
        self.writer.area(
            "gestao", est, origem, rede="estadic", grupos=groups, dimensao=27
        )
        print("gestao", len(out), len(est), flush=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--revisao", type=Path, required=True)
    p.add_argument("--saida", type=Path, required=True)
    p.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    p.add_argument(
        "--areas",
        nargs="+",
        default=[
            "trabalho",
            "saneamento",
            "saude",
            "educacao",
            "financas",
            "assistencia",
            "clima",
            "gestao",
        ],
    )
    a = p.parse_args()
    g = Comparacoes(a.revisao, a.saida, a.repo)
    for area in a.areas:
        if area in ["trabalho", "saneamento", "saude"]:
            g.mapa(area)
        elif area == "educacao":
            g.mapa(area)
            for rede in g.ler("mapas_educacao_base.json").get("redes", {}):
                g.mapa(area, rede)
        else:
            getattr(g, area)()
    g.writer.concluir()
    print(json.dumps(dict(ok=True, areas=g.writer.stats)), flush=True)
