"""Modelo de comparações: razões das mesmas bases, medianas explícitas e cobertura.

Não consulta nem publica dados. Ausências nunca viram zero. Os valores de entrada
são municipais, e os recortes regionais contêm os mesmos códigos em toda a série.
"""

from dataclasses import dataclass, field
from pathlib import Path
import hashlib, json, math
import numpy as np


def compacto(v):
    return json.dumps(
        v, ensure_ascii=False, separators=(",", ":"), allow_nan=False
    ).encode()


def sha(b):
    return hashlib.sha256(b).hexdigest()


FONTES_GLOBAIS_COMPARACOES = {
    "trabalho": ["rais", "caged", "rais_perfis"],
    "saude": [
        "cnes",
        "icsap",
        "oncologia",
        "populacao_svs",
        "resp",
        "sih",
        "sim",
        "sinan",
        "sinasc",
        "siscan",
        "aps",
        "fns",
        "vacinacao",
    ],
    "assistencia": ["assistencia"],
}


def compatibilidade_global(manifesto):
    """Descritores das fontes efetivamente usadas, sem depender do restante do gold.

    JSON como texto mantém os descritores de outros prefixos fora do grafo CAS
    das comparações. O cliente ignora datas de processamento e ordena as chaves.
    """
    return {
        area: dict(
            fontes=chaves,
            json_referencia=json.dumps(
                {k: manifesto["fontes"].get(k) for k in chaves},
                ensure_ascii=False,
                separators=(",", ":"),
                allow_nan=False,
            ),
        )
        for area, chaves in FONTES_GLOBAIS_COMPARACOES.items()
    }


def numeros(a):
    return [float(x) if math.isfinite(float(x)) else None for x in a]


@dataclass
class Quadro:
    definicao: dict
    periodos: list
    valores: np.ndarray
    numeradores: np.ndarray
    denominadores: np.ndarray
    condicoes: np.ndarray
    originais: np.ndarray | None = None
    # True apenas para componentes que têm interpretação explícita de zero na fonte
    # (ex.: vínculos sem remuneração válida permanecem no denominador da RAIS).
    elegiveis: np.ndarray | None = None
    validacao_extra: np.ndarray | None = None
    inicios: np.ndarray | None = None

    def validar(self, nmunicipios):
        shape = (len(self.periodos), nmunicipios)
        assert self.periodos == sorted(set(self.periodos))
        assert all(
            a.shape == shape
            for a in [
                self.valores,
                self.numeradores,
                self.denominadores,
                self.condicoes,
            ]
        )
        assert self.definicao["metodo_referencia"] in [
            "razao",
            "mediana",
            "area",
            "resposta",
        ]
        assert (
            self.definicao["unidade"]
            and self.definicao["nome"]
            and self.definicao["nome_en"]
        )
        if self.originais is not None:
            assert self.originais.shape == shape
        if self.elegiveis is not None:
            assert self.elegiveis.shape == shape
        if self.validacao_extra is not None:
            assert self.validacao_extra.shape == shape

    def grupo_territorio(self, key, pos, municipio=False, incluir_ressalvas=False):
        """Permite distinguir um agregado oficial de regiões com os mesmos membros."""
        return self.grupo(pos, municipio, incluir_ressalvas)

    def cobertura_esperada(self, pos, observados):
        anos=np.array([p//100 if p>10000 else p for p in self.periodos])[:,None]
        exigiveis=np.ones_like(observados,dtype=bool) if self.inicios is None else anos>=self.inicios[pos][None,:]
        # Observações reconstruídas para limites atuais continuam elegíveis.
        return (exigiveis|observados).sum(axis=1)

    def grupo(self, pos, municipio=False, incluir_ressalvas=False):
        v = self.valores[:, pos]
        n = self.numeradores[:, pos]
        d = self.denominadores[:, pos]
        c = self.condicoes[:, pos]
        if municipio:
            assert len(pos) == 1
            return dict(
                v=numeros(v[:, 0]),
                n=numeros(n[:, 0]),
                d=numeros(d[:, 0]),
                c=c[:, 0].astype(int).tolist(),
                q=np.isfinite(v[:, 0]).astype(int).tolist(),
                r=numeros(
                    (self.originais if self.originais is not None else self.valores)[
                        :, pos[0]
                    ]
                ),
            )
        # Ressalvas do Inep não desaparecem dos dados, mas ficam fora das referências
        # padrão; uma referência alternativa é gerada se o usuário optar por incluí-las.
        sem_ressalva = ~np.isin(c, [8, 18])
        ok = np.isfinite(v) & (incluir_ressalvas | sem_ressalva)
        if self.elegiveis is not None:
            ok = self.elegiveis[:, pos] & (incluir_ressalvas | sem_ressalva)
        metodo = self.definicao["metodo_referencia"]
        fator = self.definicao.get("fator", 1)
        if metodo in ["razao", "area", "resposta"]:
            ok = ok & np.isfinite(n) & np.isfinite(d) & (d >= 0)
            if not self.definicao.get("aceita_denominador_zero_agregado"):
                ok = ok & (d > 0)
            nn = np.where(ok, n, 0).sum(axis=1)
            dd = np.where(ok, d, 0).sum(axis=1)
            with np.errstate(invalid="ignore", divide="ignore"):
                vv = nn / dd * fator
            vv[dd <= 0] = np.nan
            if self.validacao_extra is not None:
                aux = np.where(ok, self.validacao_extra[:, pos], 0).sum(axis=1)
                vv[aux <= 0] = np.nan
        else:
            # Mediana dos resultados municipais, identificada como tal. Não é índice
            # oficial da região nem média de percentuais ou proficiências agregadas.
            vv = np.array(
                [
                    np.median(row[mask]) if mask.any() else np.nan
                    for row, mask in zip(v, ok)
                ]
            )
            nn = np.full(len(vv), np.nan)
            dd = np.full(len(vv), np.nan)
        # O cadastro atual inclui municípios instalados depois de parte da série.
        # Não exigir resposta de um município ainda não instalado naquele ano.
        esperados=self.cobertura_esperada(pos,ok)
        q = ok.sum(axis=1)
        cc = np.where(
            ~np.isfinite(vv), 2, np.where(q < esperados, 16, np.where(vv == 0, 1, 0))
        )
        if self.validacao_extra is not None:
            cc[(q > 0) & (dd == 0)] = 14
            cc[(q > 0) & (dd > 0) & (aux <= 0)] = 13
        if self.definicao.get("recusar_inesperadas"):
            inesperadas = (c == 17).any(axis=1)
            vv[inesperadas] = np.nan
            cc[inesperadas] = 17
        resultado = dict(
            v=numeros(vv),
            n=numeros(nn),
            d=numeros(dd),
            c=cc.astype(int).tolist(),
            q=q.astype(int).tolist(),
            e=esperados.astype(int).tolist(),
        )
        if self.definicao.get('agregacao_original')=='soma'and self.originais is not None:
            origem=self.originais[:,pos];validas=np.isfinite(origem)&(incluir_ressalvas|sem_ressalva)
            total=np.where(validas,origem,0).sum(axis=1);total[~validas.any(axis=1)]=np.nan
            resultado['r']=numeros(total)
        return resultado


def por_base(
    definicao, periodos, originais, condicoes, base, *, fator=1000, base_anos=None
):
    """Densidade com base declarada: população não é família, matrícula ou usuário."""
    n = originais.copy()
    d = base.copy()
    ok = np.isfinite(n) & np.isfinite(d) & (d > 0)
    with np.errstate(invalid="ignore", divide="ignore"):
        v = n / d * fator
    v[~ok] = np.nan
    c = condicoes.copy()
    c[np.isfinite(n) & ~np.isfinite(d)] = 3
    c[np.isfinite(n) & (d == 0)] = 4
    c[ok & (v == 0) & ~np.isin(c, [6, 8, 11, 12, 18])] = 1
    definicao = {**definicao, "metodo_referencia": "razao", "fator": fator}
    if base_anos is not None:
        definicao["anos_base_demografica"] = base_anos
    return Quadro(definicao, periodos, v, n, d, c, originais=originais)


class Territorios:
    def __init__(self, localidades):
        self.municipios = sorted(
            [
                [
                    x["id"],
                    x["nome"],
                    x["regiao-imediata"]["regiao-intermediaria"]["UF"]["sigla"],
                    str(x["regiao-imediata"]["id"]),
                    str(x["regiao-imediata"]["regiao-intermediaria"]["id"]),
                ]
                for x in localidades
            ]
        )
        assert (
            len(self.municipios) == 5571
            and len({x[0] for x in self.municipios}) == 5571
        )
        self.pos = {x[0]: k for k, x in enumerate(self.municipios)}
        vigencia=json.loads((Path(__file__).resolve().parents[1]/'shared/vigencia_municipios.json').read_bytes())['inicio']
        self.inicios=np.array([vigencia.get(str(m[0]),1900)for m in self.municipios])
        self.grupos = {}
        self.territorios = {}
        self.buckets = {}
        for k, (cod, nome, uf, im, inter) in enumerate(self.municipios):
            code = str(cod)
            self.grupos[code] = [k]
            self.territorios[code] = dict(
                nome=nome,
                nivel="M",
                uf=uf,
                cod=cod,
                imediata="I:" + im,
                intermediaria="T:" + inter,
            )
            self.buckets[code] = uf
        nomes_im = {
            str(x["regiao-imediata"]["id"]): x["regiao-imediata"]["nome"]
            for x in localidades
        }
        nomes_in = {
            str(x["regiao-imediata"]["regiao-intermediaria"]["id"]): x[
                "regiao-imediata"
            ]["regiao-intermediaria"]["nome"]
            for x in localidades
        }
        for codigo, nivel, coluna, nomes in [
            ("I:", "imediata", 3, nomes_im),
            ("T:", "intermediaria", 4, nomes_in),
        ]:
            for r in sorted(nomes):
                pos = [k for k, x in enumerate(self.municipios) if x[coluna] == r]
                key = codigo + r
                ufs = {self.municipios[k][2] for k in pos}
                assert len(ufs) == 1
                self.grupos[key] = pos
                self.territorios[key] = dict(
                    nome=nomes[r],
                    nivel=nivel,
                    uf=next(iter(ufs)),
                    cod=r,
                    **(
                        {"intermediaria": "T:" + self.municipios[pos[0]][4]}
                        if nivel == "imediata"
                        else {}
                    ),
                )
                self.buckets[key] = "referencias"
        for uf in sorted({x[2] for x in self.municipios}):
            self.grupos[uf] = [k for k, x in enumerate(self.municipios) if x[2] == uf]
            self.territorios[uf] = dict(nome=uf, nivel="UF", uf=uf, cod=uf)
            self.buckets[uf] = "referencias"
        self.grupos["BR"] = list(range(len(self.municipios)))
        self.territorios["BR"] = dict(nome="Brasil", nivel="BR", uf=None, cod="BR")
        self.buckets["BR"] = "referencias"
        self.governos = []
        for x in localidades:
            u = x["regiao-imediata"]["regiao-intermediaria"]["UF"]
            key = "E:" + str(u["id"])
            if key not in self.territorios:
                self.territorios[key] = dict(
                    nome="Governo de " + u["nome"],
                    nivel="E",
                    uf=u["sigla"],
                    cod=u["id"],
                )
                self.buckets[key] = "referencias"
                self.governos.append([key, u["nome"], u["sigla"]])
        self.governos.sort()
        self.territorios["E:BR"] = dict(
            nome="Governos estaduais e do DF", nivel="E_BR", uf=None, cod="BR"
        )
        self.buckets["E:BR"] = "referencias"
        assert len(nomes_im) == 510 and len(nomes_in) == 133


class Gravador:
    def __init__(self, saida, geografia, revisao, origens):
        self.saida = Path(saida).resolve()
        self.rev = Path(revisao).resolve()
        self.geo = geografia
        self.origens = origens
        self.dest = self.saida / "gold/comparacoes"
        assert not self.saida.is_relative_to(self.rev) and not self.rev.is_relative_to(
            self.saida
        ), "Destino sobreposto à revisão"
        assert not self.dest.exists() or not any(
            self.dest.iterdir()
        ), "Use um candidato novo/vazio"
        self.dest.mkdir(parents=True, exist_ok=True)
        self.georef = self.objeto(
            "territorios",
            dict(
                versao=1,
                municipios=self.geo.municipios,
                governos=self.geo.governos,
                territorios=self.geo.territorios,
                fonte="https://servicodados.ibge.gov.br/api/v1/localidades/municipios",
                ano_divisao=2017,
                observacao="Associação atual aplicada à série, sem reconstruir limites históricos.",
            ),
        )
        self.catalogos = {}
        self.stats = {}

    def objeto(self, nome, v):
        b = compacto(v)
        h = sha(b)
        p = self.dest / f"{nome}_{h[:16]}.json"
        p.write_bytes(b)
        return dict(caminho="gold/comparacoes/" + p.name, bytes=len(b), sha256=h)

    def area(self, area, quadros, origem, rede="todas", grupos=None, dimensao=None):
        from curadoria_catalogos import curar_definicao
        for q in quadros:q.definicao=curar_definicao(q.definicao)
        for q in quadros:
            if q.valores.shape[1]==len(self.geo.municipios):q.inicios=getattr(self.geo,'inicios',None)
        for q in quadros:
            q.validar(dimensao or len(self.geo.municipios))
        prefixo = area + "_" + rede
        temp = self.dest / (prefixo + "_temporario.ndjson")
        indices = {}
        referencias = {}
        groups = grupos or self.geo.grupos
        quantidades = {k: len(pos) for k, pos in groups.items()}
        ids = [q.definicao["id"] for q in quadros]
        assert len(set(ids)) == len(ids)
        with temp.open("xb") as f:
            for key, pos in groups.items():
                dados = []
                for q in quadros:
                    unitario = (
                        len(key) == 7
                        and key.isdigit()
                        or self.geo.territorios.get(key, {}).get("nivel") == "E"
                    )
                    g = q.grupo_territorio(key, pos, municipio=unitario)
                    if not unitario and np.any(np.isin(q.condicoes[:, pos], [8, 18])):
                        g["com_ressalvas"] = q.grupo_territorio(key, pos, incluir_ressalvas=True)
                    dados.append(g)
                if self.geo.territorios[key]["nivel"] in [
                    "UF",
                    "imediata",
                    "intermediaria",
                ]:
                    referencias[key] = dados
                g = dict(
                    versao=1,
                    area=area,
                    rede=rede,
                    grupo=key,
                    indicadores=ids,
                    quantidade=len(pos),
                    dados=dados,
                )
                b = compacto(g) + b"\n"
                bucket = self.geo.buckets.get(key, "referencias")
                indices.setdefault(bucket, {})[key] = [f.tell(), len(b), sha(b)]
                f.write(b)
        h = hashlib.sha256()
        with temp.open("rb") as f:
            for b in iter(lambda: f.read(1 << 20), b""):
                h.update(b)
        p = self.dest / (prefixo + "_series_" + h.hexdigest()[:16] + ".ndjson")
        assert p.resolve().is_relative_to(self.dest.resolve())
        temp.rename(p)
        ref = dict(
            caminho="gold/comparacoes/" + p.name,
            bytes=p.stat().st_size,
            sha256=h.hexdigest(),
        )
        refs = {}
        for bucket, grupos_idx in indices.items():
            refs[bucket] = self.objeto(
                prefixo + "_indice_" + bucket.lower(),
                dict(versao=1, area=area, rede=rede, arquivo=ref, grupos=grupos_idx),
            )
        rankings = (
            self.rankings(prefixo, area, rede, quadros, referencias)
            if dimensao is None
            else {}
        )
        cat = dict(
            versao=1,
            area=area,
            rede=rede,
            origem=origem,
            geografia=self.georef,
            indicadores=[
                dict(
                    q.definicao,
                    periodos=q.periodos,
                    periodos_com_valor=[
                        p
                        for k, p in enumerate(q.periodos)
                        if np.isfinite(q.valores[k]).any()
                    ],
                    indice_lista=rankings.get(q.definicao["id"]),
                )
                for q in quadros
            ],
            indices=refs,
            quantidades=quantidades,
        )
        self.catalogos[prefixo] = self.objeto(prefixo + "_catalogo", cat)
        self.stats[prefixo] = dict(
            indicadores=len(quadros), bytes=ref["bytes"], grupos=len(groups)
        )
        return cat

    def rankings(self, prefixo, area, rede, quadros, referencias):
        temp = self.dest / (prefixo + "_lista_temporario.ndjson")
        indices = []
        ufs = {
            k: p
            for k, p in self.geo.grupos.items()
            if self.geo.territorios[k]["nivel"] == "UF"
        }
        with temp.open("xb") as f:
            for j, q in enumerate(quadros):
                if not q.definicao.get("ranking", True):
                    continue
                trechos = {}
                for k, periodo in enumerate(q.periodos):
                    inicio = f.tell()
                    hbr = hashlib.sha256()
                    for uf, pos in sorted(ufs.items()):
                        r = q.originais if q.originais is not None else q.valores
                        x = dict(
                            versao=1,
                            area=area,
                            rede=rede,
                            indicador=q.definicao["id"],
                            periodo=periodo,
                            uf=uf,
                            quantidade=len(pos),
                            v=numeros(q.valores[k, pos]),
                            n=numeros(q.numeradores[k, pos]),
                            d=numeros(q.denominadores[k, pos]),
                            c=q.condicoes[k, pos].astype(int).tolist(),
                            r=numeros(r[k, pos]),
                        )
                        b = compacto(x) + b"\n"
                        trechos[str(periodo) + ":" + uf] = [f.tell(), len(b), sha(b)]
                        f.write(b)
                        hbr.update(b)
                    trechos[str(periodo) + ":BR"] = [
                        inicio,
                        f.tell() - inicio,
                        hbr.hexdigest(),
                    ]
                    for nivel in ["UF", "imediata", "intermediaria"]:
                        keys = sorted(
                            k
                            for k in referencias
                            if self.geo.territorios[k]["nivel"] == nivel
                        )
                        sr = [referencias[key][j] for key in keys]
                        x = dict(
                            versao=1,
                            area=area,
                            rede=rede,
                            indicador=q.definicao["id"],
                            periodo=periodo,
                            nivel=nivel,
                            grupos=keys,
                            quantidade=len(keys),
                            v=[s["v"][k] for s in sr],
                            n=[s["n"][k] for s in sr],
                            d=[s["d"][k] for s in sr],
                            c=[s["c"][k] for s in sr],
                            q=[s["q"][k] for s in sr],
                        )
                        alt = [s.get("com_ressalvas", s) for s in sr]
                        if any("com_ressalvas" in s for s in sr):
                            x["com_ressalvas"] = {
                                campo: [s[campo][k] for s in alt]
                                for campo in ["v", "n", "d", "c", "q"]
                            }
                        b = compacto(x) + b"\n"
                        trechos[str(periodo) + ":" + nivel] = [f.tell(), len(b), sha(b)]
                        f.write(b)
                indices.append((q.definicao["id"], trechos))
        h = hashlib.sha256()
        with temp.open("rb") as f:
            for b in iter(lambda: f.read(1 << 20), b""):
                h.update(b)
        p = self.dest / (prefixo + "_listas_" + h.hexdigest()[:16] + ".ndjson")
        assert p.resolve().is_relative_to(self.dest.resolve())
        temp.rename(p)
        ref = dict(
            caminho="gold/comparacoes/" + p.name,
            bytes=p.stat().st_size,
            sha256=h.hexdigest(),
        )
        return {
            id: self.objeto(
                prefixo + "_" + id + "_lista_indice",
                dict(
                    versao=1,
                    area=area,
                    rede=rede,
                    indicador=id,
                    arquivo=ref,
                    recortes=rec,
                ),
            )
            for id, rec in indices
        }

    def concluir(self):
        from datetime import datetime, timezone

        m = dict(
            versao=1,
            gerado_em=datetime.now(timezone.utc).isoformat(),
            geografia=self.georef,
            catalogos=self.catalogos,
            origens=self.origens,
            compatibilidade_global=compatibilidade_global(
                json.loads((self.rev / "global_base.json").read_bytes())
            ),
            observacoes=[
                "Valores relativos ou intensivos, conforme a definição de cada indicador.",
                "Associação regional atual do IBGE (divisão 2017), aplicada à série sem reconstruir limites históricos.",
                "Não se interpola nem se preenche ausência por zero.",
                "Referências municipais têm cobertura explícita; não são os governos estaduais nem notas de gestão.",
            ],
        )
        (self.dest / "manifesto.json").write_bytes(compacto(m))
        (self.rev / "geracao_comparacoes.json").write_bytes(
            compacto(dict(ok=True, areas=self.stats))
        )
        return m
