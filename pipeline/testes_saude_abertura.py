"""Pacote de abertura da saúde: empacotamento completo contra as cinco origens, offsets em bytes UTF-8, nulos e zeros, soma de BR/UF com cod_ibge nulo,
DF (5300108 na saúde, 53 no SIOPS), cadastro igual à rota `entes`, SIOPS por ente e agregado (soma ÷ soma), corrupção, objetos imutáveis, manifesto por
último e proteção dos destinos (inclui links/junções). Dados sintéticos em pasta temporária. Uso:  py pipeline/testes_saude_abertura.py
Com --real <base>, gera também o pacote sobre a base real (somente leitura; a saída vai para uma pasta temporária).
"""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

import duckdb

import saude_abertura as sa
import testes_clima_abertura as tc  # criar_link, estado, esperar

UFS = sa.UFS
ANOS = (2013, 2014)


def parquet(con, caminho: Path, ddl: str, linhas: list) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    con.execute(f"CREATE OR REPLACE TABLE t ({ddl})")
    for r in linhas:
        con.execute("INSERT INTO t VALUES (" + ",".join(["?"] * len(r)) + ")", r)
    con.execute(f"COPY t TO '{caminho.as_posix()}' (FORMAT parquet)")


def cod_uf(i: int, uf: str) -> int:
    return 5208707 if uf == "GO" else 5300108 if uf == "DF" else 2000000 + i * 1000


def linhas_municipios() -> list:
    out = []
    for i, uf in enumerate(UFS):
        for ano in ANOS:
            go = uf == "GO"
            out.append([ano, cod_uf(i, uf), 100000 + i, "Goiânia ação" if go else f"Muni {uf}", uf, 1000.0 + i, 0 if go else i,
                        None if ano == 2013 else 1.5 * (i + 1), (None if ano == 2013 else 80.0) if go else None])
    # registros sem município válido: somam em UF e Brasil, não contam em `municipios` nem têm grupo próprio
    out.append([2014, None, None, "Ignorado GO", "GO", 5.0, 2, 0.25, None])
    out.append([2014, None, None, "Ignorado PE", "PE", 7.0, 3, None, None])
    out.append([2014, None, None, "Sem UF", None, 3.0, 1, 0.5, None])
    return out


DDL_MUN = "ano BIGINT, cod_ibge BIGINT, municipio BIGINT, nome VARCHAR, uf VARCHAR, populacao DOUBLE, obitos BIGINT, int_valor_real DOUBLE, ab_cobertura DOUBLE"
COLS_SE = ["ano", "cod_ibge", "uf", "esfera", "populacao_siops", *sa.SE_REAIS]
DDL_SE = "ano BIGINT, cod_ibge BIGINT, uf VARCHAR, esfera VARCHAR, populacao_siops DOUBLE, " + ", ".join(f"{c} DOUBLE" for c in sa.SE_REAIS)


def linha_se(ano, cod, uf, esfera, pop, **v):
    return [ano, cod, uf, esfera, pop] + [v.get(c) for c in sa.SE_REAIS]


def linhas_se() -> list:
    return [
        linha_se(2013, 5208707, "GO", "M", 100.0, saude_total=1000.0, saude_proprios=600.0, saude_hab=10.0, saude_proprios_hab=6.0),
        linha_se(2014, 5208707, "GO", "M", 100.0, saude_total=None, saude_proprios=0.0, saude_hab=None, saude_proprios_hab=0.0),  # zero ≠ null
        linha_se(2013, 5208900, "GO", "M", 200.0, saude_total=3000.0, saude_proprios=None, saude_hab=15.0, saude_proprios_hab=None),
        linha_se(2013, 5208800, "GO", "M", 0.0, saude_total=10.0, saude_proprios=10.0, saude_hab=1.0, saude_proprios_hab=1.0),  # população 0: fora da soma
        linha_se(2013, 52, "GO", "E", 1000.0, saude_total=99999.0, saude_proprios=99999.0, saude_hab=99.0, saude_proprios_hab=99.0),  # estado: nunca no agregado municipal
        linha_se(2013, 53, "DF", "D", 50.0, saude_total=500.0, saude_proprios=250.0, saude_hab=10.0, saude_proprios_hab=5.0),
        linha_se(2014, 53, "DF", "D", 50.0, saude_total=600.0, saude_proprios=300.0, saude_hab=12.0, saude_proprios_hab=6.0),
        linha_se(2014, 2001000, "AC", "M", 10.0, saude_total=100.0, saude_proprios=50.0, saude_hab=10.0, saude_proprios_hab=5.0),
    ]


def montar(base: Path) -> None:
    con = duckdb.connect()
    g = base / "gold"
    parquet(con, g / "saude" / "municipios.parquet", DDL_MUN, linhas_municipios())
    parquet(con, g / "saude_educacao.parquet", DDL_SE, linhas_se())
    parquet(con, g / "ipca.parquet", "exercicio BIGINT, indice DOUBLE", [[2013, 1.0], [2014, 1.25]])
    entes = [[5208707, "Goiânia", "GO", "Centro-Oeste", "M", True, "1"], [5208900, "Aparecida de Goiânia", "GO", "Centro-Oeste", "M", False, "2"],
             [5208800, "Ábaeté", "GO", "Centro-Oeste", "M", False, "3"], [2001000, "Acrelândia", "AC", "Norte", "M", False, "4"],
             [52, "Goiás", "GO", "Centro-Oeste", "E", False, "5"], [53, "Distrito Federal", "DF", "Centro-Oeste", "D", False, "6"],
             [1, "União", "BR", "BR", "U", False, "7"], [9999999, "Sem declaração", "XX", "Norte", "M", False, "8"]]
    parquet(con, base / "silver" / "entes.parquet", "cod_ibge BIGINT, nome VARCHAR, uf VARCHAR, regiao VARCHAR, esfera VARCHAR, capital BOOLEAN, cnpj VARCHAR", entes)
    parquet(con, g / "indicadores.parquet", "cod_ibge INTEGER, exercicio SMALLINT", [[c, 2014] for c in (5208707, 5208900, 5208800, 2001000, 52, 53, 1)] + [[5208707, 2013]])
    con.close()
    man = {"gerado_em": "2026-01-01T00:00:00+00:00", "anos": [2013, 2014], "base_ipca": 2014, "colunas": {"2014": {"A": ["x"]}},
           "fontes": {"siconfi": {"x": 1}, "clima": {"anos": [1979, 2026], "ate": 202609, "abertura": {"versao": 1, "indice": "gold/clima/x.json"}}, "sim": {"anos": [2013, 2014]}},
           "aberturas": {"outra": {"x": 1}}}
    (g / "manifesto.json").write_text(json.dumps(man), encoding="utf-8")


def ler(saida: Path, ent: dict):
    idx = json.loads((saida / ent["indice"]).read_text(encoding="utf-8"))
    dados = (saida / ent["arquivo"]).read_bytes()
    out, off = {}, 0
    for g, n in zip(idx["grupos"], idx["tamanhos"]):
        out[g] = json.loads(dados[off:off + n].decode("utf-8"))
        off += n
    return idx, dados, out


def testar_conteudo(base: Path, saida: Path, ent: dict) -> None:
    idx, dados, g = ler(saida, ent)
    col = {c: i for i, c in enumerate(idx["serie"])}
    assert idx["colunas"] == ["ano", "cod_ibge", "municipio", "nome", "uf", "populacao", "obitos", "int_valor_real", "ab_cobertura"]
    assert idx["serie"] == ["populacao", "obitos", "int_valor_real", "ab_cobertura"] and idx["aliases"] == {"saude": {"53": "5300108"}}
    # ordem: BR, as 27 UFs, depois os entes por código crescente (a saúde e o SIOPS na mesma linha quando o código coincide)
    assert idx["grupos"][0] == "BR" and idx["grupos"][1:28] == sorted(UFS)
    resto = idx["grupos"][28:]
    assert resto == sorted(resto, key=int) and "53" in resto and "5300108" in resto and "52" in resto and "9999999" not in resto
    assert idx["tamanhos"] == [len(x) for x in dados.splitlines(keepends=True)] and sum(idx["tamanhos"]) == len(dados) == ent["bytes"]
    # Brasil 2014: soma com os registros de cod_ibge nulo (inclusive o sem UF); `municipios` só conta os que têm código
    br = g["BR"]
    k = br["a"].index(2014)
    assert br["m"][k] == 27
    assert br["r"][k][col["populacao"]] == sum(1000.0 + i for i in range(27)) + 5 + 7 + 3
    assert br["r"][k][col["obitos"]] == sum(i for i in range(27) if UFS[i] != "GO") + 0 + 2 + 3 + 1
    assert br["r"][k][col["ab_cobertura"]] == 80.0 and br["r"][br["a"].index(2013)][col["ab_cobertura"]] is None  # tudo nulo → null, nunca 0
    # UF GO: o registro ignorado soma, mas não conta; PE idem; DF não tem municípios nulos
    go = g["GO"]
    assert go["m"] == [1, 1] and go["r"][1][col["populacao"]] == 1000.0 + UFS.index("GO") + 5 and go["r"][1][col["obitos"]] == 2
    assert g["PE"]["m"] == [1, 1] and g["DF"]["r"][1][col["int_valor_real"]] == 1.5 * (UFS.index("DF") + 1)
    # município: ignora as linhas de cod nulo; zero real continua 0 e ausência continua null; inteiro sem ".0"
    m = g["5208707"]
    assert m["a"] == [2013, 2014] and m["m"] == [1, 1]
    assert m["r"][0][col["obitos"]] == 0 and m["r"][0][col["obitos"]] is not None and m["r"][0][col["ab_cobertura"]] is None and m["r"][1][col["ab_cobertura"]] == 80
    assert b"80.0" not in dados.split(b"\n")[idx["grupos"].index("5208707")]
    # DF: a saúde está em 5300108 e o SIOPS no ente 53; nenhum dos dois grupos empresta o outro
    assert g["5300108"]["a"] == [2013, 2014] and g["5300108"]["p"] == []
    assert g["53"]["a"] == [] and g["53"]["r"] == [] and [p[0] for p in g["53"]["p"]] == [2013, 2014]
    assert g["52"]["a"] == [] and g["52"]["p"][0][1] == 99.0 * 1.25  # estado: SIOPS próprio, deflacionado (valor × base ÷ índice do ano)
    # SIOPS por ente: deflação valor * indice_base / indice_ano (2013: 1,25/1; 2014: 1,25/1,25); null e zero distintos
    p = {x[0]: x for x in g["5208707"]["p"]}
    assert p[2013] == [2013, 12.5, 7.5] and p[2014] == [2014, None, 0]
    assert p[2014][2] is not None
    assert {x[0]: x for x in g["53"]["p"]}[2013][1] == 10.0 * 1.25
    # SIOPS agregado: só municípios (esfera M), soma ÷ soma das linhas com valor e população > 0; nunca média dos valores por habitante
    go_p = {x[0]: x for x in g["GO"]["p"]}
    assert go_p[2013][1] == (1000.0 * 1.25 + 3000.0 * 1.25) / (100.0 + 200.0)  # o ente de população 0 e o estado ficam de fora
    assert go_p[2013][2] == 600.0 * 1.25 / 100.0  # próprios: só quem tem o dado (e o denominador acompanha)
    assert go_p[2014][1] is None and go_p[2014][2] == 0 and go_p[2014][2] is not None  # sem valor → null; zero real → 0
    assert g["DF"]["p"] == [], "o DF não tem município no SIOPS (o ente 53 tem esfera D)"
    br_p = {x[0]: x for x in g["BR"]["p"]}
    assert br_p[2013][1] == (4000.0 * 1.25) / 300.0 and br_p[2014][1] == 100.0 / 10.0
    # cadastro = rota entes (sem a União e sem quem não tem indicadores), na ordem esfera DESC, uf, nome (bytes), código
    assert idx["entes"] == [[2001000, "Acrelândia", "AC", "M", False], [5208900, "Aparecida de Goiânia", "GO", "M", False], [5208707, "Goiânia", "GO", "M", True],
                            [5208800, "Ábaeté", "GO", "M", False], [52, "Goiás", "GO", "E", False], [53, "Distrito Federal", "DF", "D", False]]
    nomes = [(e[3], e[2], e[1]) for e in idx["entes"]]
    assert [e[0] for e in idx["entes"]].count(1) == 0 and 9999999 not in [e[0] for e in idx["entes"]]
    assert [e[3] for e in idx["entes"]] == ["M"] * 4 + ["E", "D"], nomes
    assert [(e[2], e[1].encode()) for e in idx["entes"][:4]] == sorted((e[2], e[1].encode()) for e in idx["entes"][:4])
    assert len(dados.decode("utf-8")) <= len(dados) and len((saida / ent["indice"]).read_bytes().decode("utf-8")) < len((saida / ent["indice"]).read_bytes()), "o índice tem multibyte"


def estado_arquivos(raiz: Path) -> dict:
    return tc.estado(raiz)


def testar_links(raiz: Path, base: Path, ent: dict) -> None:
    antes = estado_arquivos(base)
    nome_arq = ent["arquivo"].split("/")[-1]
    s1 = raiz / "s_link_dir"
    (s1 / "gold").mkdir(parents=True)
    if tc.criar_link(s1 / "gold" / "saude", base / "gold" / "saude", True):
        try:
            sa.gerar(base, s1)
            raise AssertionError("link de diretório para a origem deveria falhar")
        except ValueError as e:
            assert "base" in str(e) or "link" in str(e), e
        assert estado_arquivos(base) == antes, "origem alterada via link de diretório"
    else:
        print("aviso: sem permissão para criar link/junção de diretório; caso 1 não exercitado")
    s2, fora = raiz / "s_link_fora", raiz / "fora"
    (s2 / "gold").mkdir(parents=True)
    fora.mkdir()
    if tc.criar_link(s2 / "gold" / "saude", fora, True):
        try:
            sa.gerar(base, s2)
            raise AssertionError("link de diretório para fora deveria falhar")
        except ValueError as e:
            assert "escapa" in str(e) or "link" in str(e), e
        assert not any(fora.iterdir()), "gravou através do link"
    s3 = raiz / "s_link_arq"
    (s3 / "gold" / "saude").mkdir(parents=True)
    alvo = base / "gold" / "saude" / "municipios.parquet"
    link3 = s3 / "gold" / "saude" / nome_arq
    ok3 = tc.criar_link(link3, alvo, False)
    if not ok3:
        try:
            os.link(alvo, link3)
            ok3 = True
        except OSError:
            pass
    if ok3:
        try:
            sa.gerar(base, s3)
            raise AssertionError("arquivo final linkado para a origem deveria falhar")
        except ValueError as e:
            assert "link" in str(e) or "base" in str(e) or "imutáveis" in str(e), e
        assert estado_arquivos(base) == antes, "origem alterada via link de arquivo"
        assert not (s3 / "gold" / "manifesto.json").exists()
    else:
        print("aviso: não foi possível criar link de arquivo; caso 3 não exercitado")
    # falha no meio da publicação: destinos antigos intactos, sem temporários, sem spool
    s4 = raiz / "s_falha"
    ent4 = sa.gerar(base, s4)
    antigo = estado_arquivos(s4)
    spools = lambda: sorted(Path(tempfile.gettempdir()).glob("saude_abertura_*.spool"))  # noqa: E731
    spools_antes = spools()
    trocar, chamadas = os.replace, []

    def falha(a, b):
        chamadas.append(a)
        if len(chamadas) == 2:
            raise OSError("falha simulada na troca")
        return trocar(a, b)

    sa.os.replace = falha
    try:
        try:
            sa.gerar(base, s4, substituir=True)
            raise AssertionError("falha simulada deveria propagar")
        except OSError:
            pass
    finally:
        sa.os.replace = trocar
    assert not [p.name for p in (s4 / "gold" / "saude").iterdir() if p.name.endswith((".tmp", ".parcial"))]
    assert estado_arquivos(s4) == antigo and estado_arquivos(base) == antes and spools() == spools_antes
    assert sorted(p.name for p in (s4 / "gold" / "saude").iterdir()) == sorted([nome_arq, ent4["indice"].split("/")[-1]])  # sem objeto novo órfão


def main() -> None:
    raiz = Path(tempfile.mkdtemp(prefix="saude_abertura_teste_"))
    try:
        base, saida = raiz / "base", raiz / "saida"
        montar(base)
        antes = {p: p.read_bytes() for p in base.rglob("*") if p.is_file()}
        ent = sa.gerar(base, saida)
        assert antes == {p: p.read_bytes() for p in base.rglob("*") if p.is_file()}, "a base foi alterada"
        idx, dados, _ = ler(saida, ent)
        assert hashlib.sha256(dados).hexdigest() == ent["sha256"] == idx["sha256"] and len(dados) == ent["bytes"] == idx["bytes"]
        assert hashlib.sha256((saida / ent["indice"]).read_bytes()).hexdigest() == ent["indice_sha256"]
        assert ent["arquivo"] == f"gold/saude/abertura_{ent['sha256'][:12]}.ndjson" and ent["indice"].endswith(ent["indice_sha256"][:12] + ".json")
        assert ent["conferido"]["entes"] == 6 and ent["conferido"]["grupos"] == len(idx["grupos"])
        # manifesto: gerado_em novo e IGUAL ao do pacote; as demais fontes (inclusive a abertura do clima) e outros ponteiros preservados
        novo = json.loads((saida / "gold" / "manifesto.json").read_text(encoding="utf-8"))
        velho = json.loads((base / "gold" / "manifesto.json").read_text(encoding="utf-8"))
        assert novo["gerado_em"] != velho["gerado_em"] and novo["gerado_em"] == idx["gerado_em"] == ent["gerado_em"] == novo["aberturas"]["saude"]["gerado_em"]
        assert novo["fontes"] == velho["fontes"] and "saude" not in novo["fontes"] and novo["aberturas"]["outra"] == velho["aberturas"]["outra"]
        assert {k: v for k, v in novo.items() if k not in ("gerado_em", "aberturas")} == {k: v for k, v in velho.items() if k not in ("gerado_em", "aberturas")}
        assert set(novo["aberturas"]["saude"]["origem"]) == set(sa.ORIGENS) and novo["aberturas"]["saude"]["origem"] == idx["origem"]
        testar_conteudo(base, saida, ent)
        # determinístico: nova geração em outra pasta produz o MESMO pacote e snapshot
        ent2 = sa.gerar(base, raiz / "saida2")
        assert ent2["arquivo"] == ent["arquivo"] and ent2["sha256"] == ent["sha256"] and ent2["snapshot"] == ent["snapshot"]
        # corrupção: um valor alterado, tamanho trocado, snapshot misturado, grupo trocado
        arq = saida / ent["arquivo"]
        i = json.loads((saida / ent["indice"]).read_text(encoding="utf-8"))
        ruim = raiz / "adulterado.ndjson"
        ruim.write_bytes(arq.read_bytes().replace(b"1015", b"1016", 1))
        tc.esperar("difere", lambda: sa.conferir(base, ruim, i, 2014))
        ruim.write_bytes(arq.read_bytes() + b"\n")
        tc.esperar("tamanhos", lambda: sa.conferir(base, ruim, i, 2014))
        ruim.write_bytes(arq.read_bytes().replace(i["snapshot"].encode(), b"0" * 12, 1))
        tc.esperar("não corresponde", lambda: sa.conferir(base, ruim, i, 2014))
        ruim.write_bytes(arq.read_bytes())
        tc.esperar("cadastro", lambda: sa.conferir(base, ruim, dict(i, entes=i["entes"][1:] + i["entes"][:1]), 2014))
        assert sa.conferir(base, ruim, i, 2014)["grupos"] == len(i["grupos"])
        # base e manifesto que não permitem gerar; nada é criado
        m = json.loads((base / "gold" / "manifesto.json").read_text(encoding="utf-8"))
        sem = {k: v for k, v in m.items() if k != "base_ipca"}
        (base / "gold" / "manifesto.json").write_text(json.dumps(sem), encoding="utf-8")
        tc.esperar("base_ipca", lambda: sa.gerar(base, raiz / "s3"))
        assert not (raiz / "s3").exists(), "criou pasta antes de validar"
        (base / "gold" / "manifesto.json").write_text(json.dumps(m), encoding="utf-8")
        (base / "gold" / "ipca.parquet").rename(raiz / "ipca_guardado.parquet")
        tc.esperar("base incompleta", lambda: sa.gerar(base, raiz / "s5"))
        assert not (raiz / "s5").exists()
        (raiz / "ipca_guardado.parquet").rename(base / "gold" / "ipca.parquet")
        # destinos: saída sobre/dentro/contendo a base, e saída já existente sem --substituir; nada é criado
        for alvo in (base, base / "gold", base / "novo", raiz):
            tc.esperar("sobre a base", lambda a=alvo: sa.gerar(base, a))
        assert not (base / "novo").exists()
        tc.esperar("já existe", lambda: sa.gerar(base, saida))
        # objetos imutáveis: mesmo nome com outro conteúdo não é sobrescrito
        (raiz / "saida2" / ent["arquivo"]).write_bytes(b"adulterado")
        tc.esperar("imutáveis", lambda: sa.gerar(base, raiz / "saida2", substituir=True))
        # origem alterada → outro conteúdo, outro nome; a saída antiga (outro manifesto) fica como está
        base_b = raiz / "base_links"
        montar(base_b)
        testar_links(raiz, base_b, ent)
        print("ok: testes sintéticos do pacote de abertura da saúde")
        if "--real" in sys.argv:
            real = Path(sys.argv[sys.argv.index("--real") + 1])
            r = sa.gerar(real, raiz / "real", progresso=lambda m: print(m, flush=True))
            print("ok: base real", {k: r[k] for k in ("grupos", "bytes", "snapshot", "conferido")})
    finally:
        print("pasta temporária mantida (sem delete recursivo):", raiz)


if __name__ == "__main__":
    main()
