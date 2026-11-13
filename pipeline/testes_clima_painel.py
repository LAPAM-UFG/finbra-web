"""Gerador do resumo do painel de clima: acumulados, ano em curso, lacunas, zeros reais, ausência e proteção dos destinos.

Dados sintéticos em pasta temporária (nenhum arquivo de E:/ é lido nem gravado). Uso:  py pipeline/testes_clima_painel.py
"""
import json
import shutil
import tempfile
from pathlib import Path

import duckdb

from clima_painel import ORIGENS, gerar, sha, validar_destinos


def montar(base: Path) -> None:
    c = base / "gold" / "clima"
    c.mkdir(parents=True)
    con = duckdb.connect()
    # chuva: município 1 (A) tem tudo; município 2 (B) tem zero real em jul/2025 e ausência em mai/2025.
    # temperatura: A e B; evaporação: ano de 2022 sem total (lacuna) e 2025 completo.
    con.execute("CREATE TABLE m (cod BIGINT, ano BIGINT, mes BIGINT, variavel VARCHAR, valor FLOAT)")
    for cod, k in ((1000001, 1.0), (1000002, 2.0)):
        for ano in range(1991, 2027):
            for mes in range(1, 13):
                if ano == 2026 and mes > 9:
                    continue  # ano em curso: janeiro a setembro
                chuva = 10.0 * k + mes + (ano - 2000) * 0.1
                if cod == 1000002 and (ano, mes) == (2026, 8):
                    chuva = 0.0  # zero real
                if cod == 1000002 and (ano, mes) == (2026, 2):
                    pass  # ausência (linha omitida abaixo)
                else:
                    con.execute("INSERT INTO m VALUES (?,?,?,?,?)", [cod, ano, mes, "chuva_mm", chuva])
                con.execute("INSERT INTO m VALUES (?,?,?,?,?)", [cod, ano, mes, "temperatura_c", 20.0 + k + mes * 0.1 + (ano - 2000) * 0.01])
                if not (ano == 2022):
                    con.execute("INSERT INTO m VALUES (?,?,?,?,?)", [cod, ano, mes, "evap_mm", 50.0 + mes])
    con.execute("CREATE TABLE terr AS SELECT 1000001::BIGINT cod, 'A' nome, 'XX' uf, 'Norte' regiao, 100.0 area_km2 "
                "UNION ALL SELECT 1000002, 'B', 'XX', 'Norte', 300.0")
    con.execute("CREATE TABLE agr AS SELECT * FROM (VALUES ('chuva_mm','soma','pct'),('temperatura_c','media','abs'),('evap_mm','soma','pct')) t(variavel, agregacao, tipo)")
    con.execute("CREATE TABLE normal AS SELECT cod, mes, variavel, avg(valor) normal FROM m WHERE ano BETWEEN 1991 AND 2020 GROUP BY ALL")
    con.execute("""CREATE TABLE anual AS SELECT m.cod, m.ano, m.variavel, CASE WHEN a.agregacao='soma' THEN sum(m.valor) ELSE avg(m.valor) END valor
                   FROM m JOIN agr a USING (variavel) GROUP BY m.cod, m.ano, m.variavel, a.agregacao HAVING count(*) = 12""")
    con.execute("""CREATE TABLE normal_anual AS SELECT n.cod, n.variavel, CASE WHEN a.agregacao='soma' THEN sum(n.normal) ELSE avg(n.normal) END normal
                   FROM normal n JOIN agr a USING (variavel) GROUP BY n.cod, n.variavel, a.agregacao""")
    con.execute("""CREATE TABLE anual_f AS SELECT a.cod, a.ano, a.variavel, a.valor, n.normal,
                   CASE WHEN g.tipo='pct' AND n.normal > 0 THEN a.valor / n.normal - 1 END anomalia_pct,
                   CASE WHEN g.tipo='abs' THEN a.valor - n.normal END anomalia
                   FROM anual a JOIN agr g USING (variavel) LEFT JOIN normal_anual n USING (cod, variavel)""")
    # agregado: ponderado pela ÁREA (100 e 300), nunca média simples
    con.execute("""CREATE TABLE am AS SELECT 'BR' grupo, m.ano, m.mes, m.variavel, sum(m.valor * t.area_km2) / sum(t.area_km2) valor
                   FROM m JOIN terr t USING (cod) GROUP BY ALL""")
    con.execute("""CREATE TABLE ag AS SELECT * FROM am UNION ALL
                   SELECT g.grupo, g.ano, 0, g.variavel, CASE WHEN a.agregacao='soma' THEN sum(g.valor) ELSE avg(g.valor) END
                   FROM am g JOIN agr a USING (variavel) GROUP BY g.grupo, g.ano, g.variavel, a.agregacao HAVING count(*) = 12""")
    con.execute("""CREATE TABLE agregado AS SELECT g.grupo, g.ano, g.mes, g.variavel, g.valor,
                   CASE WHEN t.tipo='pct' AND n.normal > 0 THEN g.valor / n.normal - 1 END anomalia_pct,
                   CASE WHEN t.tipo='abs' THEN g.valor - n.normal END anomalia
                   FROM ag g JOIN agr t USING (variavel)
                   LEFT JOIN (SELECT grupo, mes, variavel, avg(valor) normal FROM ag WHERE ano BETWEEN 1991 AND 2020 GROUP BY ALL) n USING (grupo, mes, variavel)""")
    con.execute("""CREATE TABLE catalogo AS SELECT variavel, variavel rotulo, 'u' unidade, agregacao resumo_anual, 'f' fonte, tipo anomalia,
                   1991 ano_de, 2025 ano_ate, 202609 ate FROM agr""")
    saidas = {"mensal": "SELECT cod, ano, mes, variavel, valor FROM m ORDER BY variavel, cod, ano, mes", "anual": "SELECT cod, ano, variavel, valor, normal, anomalia_pct, anomalia FROM anual_f",
              "normal": "SELECT * FROM normal", "agregado": "SELECT * FROM agregado", "territorio": "SELECT * FROM terr", "catalogo": "SELECT * FROM catalogo"}
    for nome, sql in saidas.items():
        con.execute(f"COPY ({sql}) TO '{(c / (nome + '.parquet')).as_posix()}' (FORMAT parquet)")
    (base / "gold" / "manifesto.json").write_text(json.dumps({"fontes": {"clima": {"ate": 202609, "anos": [1991, 2026]}, "outra": {"preservar": True}}, "gerado_em": "antes"}), encoding="utf-8")
    assert all((c / f"{n}.parquet").exists() for n in ORIGENS)


with tempfile.TemporaryDirectory() as d:
    raiz = Path(d)
    base = raiz / "base"
    montar(base)
    antes = {f.name: sha(f) for f in (base / "gold" / "clima").iterdir()}
    manifesto_antes = (base / "gold" / "manifesto.json").read_bytes()

    # 1) proteção dos destinos: base, dentro da base, pasta que contém a base; nada é criado
    for destino in (base, base / "dentro", raiz):
        try:
            gerar(base, destino)
        except ValueError:
            pass
        else:
            raise AssertionError(f"destino sobre a base aceito: {destino}")
    assert not (base / "dentro").exists()
    assert antes == {f.name: sha(f) for f in (base / "gold" / "clima").iterdir()}

    # 2) geração em candidato separado
    saida = raiz / "candidato"
    indice = gerar(base, saida)
    assert not (saida / "gold" / "clima" / "painel.parquet.parcial").exists()
    assert antes == {f.name: sha(f) for f in (base / "gold" / "clima").iterdir()}, "a base mudou"
    assert (base / "gold" / "manifesto.json").read_bytes() == manifesto_antes, "o manifesto da base mudou"
    novo = json.loads((saida / "gold" / "manifesto.json").read_text(encoding="utf-8"))
    assert novo["gerado_em"] != "antes", "o resumo não invalidou a versão HTTP dos dados"
    assert novo["gerado_em"] == indice["gerado_em"]
    assert novo["fontes"]["outra"] == {"preservar": True}
    assert novo["fontes"]["clima"]["painel"]["arquivo"] == "gold/clima/painel.parquet" and novo["fontes"]["clima"]["painel"]["ate"] == 202609
    assert novo["fontes"]["clima"]["painel"]["sha256"] == indice["arquivo"]["sha256"]

    # 3) não sobrescreve sem --substituir; com ele, sim
    try:
        gerar(base, saida)
    except ValueError:
        pass
    else:
        raise AssertionError("sobrescreveu sem --substituir")
    gerar(base, saida, substituir=True)

    # 4) conteúdo
    con = duckdb.connect()
    P = (saida / "gold" / "clima" / "painel.parquet").as_posix()

    def linha(grupo, variavel):
        r = con.execute("SELECT * FROM read_parquet(?) WHERE grupo = ? AND variavel = ?", [P, grupo, variavel])
        cols = [x[0] for x in r.description]
        rows = r.fetchall()
        assert len(rows) == 1, (grupo, variavel, rows)
        return dict(zip(cols, rows[0]))

    a = linha("1000001", "chuva_mm")
    assert a["ano_ate"] == 2025 and a["ano_de"] == 1991 and a["ate"] == 202609 and a["anos_lacuna"] is None
    # ano em curso: janeiro a setembro de 2026, contra a soma das normais de jan–set (não contra o ano inteiro)
    assert a["parcial_meses"] == 9
    esperado = sum(10.0 + m + 26 * 0.1 for m in range(1, 10))
    assert abs(a["parcial_valor"] - esperado) < 1e-3, a
    normal9 = con.execute("SELECT sum(normal) FROM read_parquet(?) WHERE cod = 1000001 AND variavel = 'chuva_mm' AND mes <= 9",
                          [(base / "gold/clima/normal.parquet").as_posix()]).fetchone()[0]
    assert abs(a["parcial_normal"] - normal9) < 1e-9 and abs(a["parcial_normal"] - a["normal"]) > 10, "parcial comparado com o ano inteiro"
    assert abs(a["parcial_anomalia_pct"] - (a["parcial_valor"] / a["parcial_normal"] - 1)) < 1e-12
    # acumulados que cruzam o ano: 3 = jul–set/2026, 6 = abr–set/2026, 12 = out/2025–set/2026
    assert a["acum_fim"] == 202609 and a["acum3_cob"] == 3 and a["acum6_cob"] == 6 and a["acum12_cob"] == 12
    v3 = sum(10.0 + m + 26 * 0.1 for m in (7, 8, 9))
    v12 = sum(10.0 + m + 25 * 0.1 for m in (10, 11, 12)) + sum(10.0 + m + 26 * 0.1 for m in range(1, 10))
    assert abs(a["acum3_valor"] - v3) < 1e-3 and abs(a["acum12_valor"] - v12) < 1e-3
    n3 = con.execute("SELECT sum(normal) FROM read_parquet(?) WHERE cod = 1000001 AND variavel = 'chuva_mm' AND mes IN (7, 8, 9)",
                     [(base / "gold/clima/normal.parquet").as_posix()]).fetchone()[0]
    assert abs(a["acum3_normal"] - n3) < 1e-9

    # ausência nunca vira zero: B não tem fev/2026, então o acumulado de 12 meses fica sem valor e mostra 11 de 12
    b = linha("1000002", "chuva_mm")
    assert b["acum12_cob"] == 11 and b["acum12_valor"] is None and b["acum12_normal"] is None, b
    assert b["acum6_valor"] is not None and b["acum3_valor"] is not None
    # o zero real de ago/2026 de B entra como zero no acumulado completo de 3 meses (não vira ausência)
    assert con.execute("SELECT valor FROM read_parquet(?) WHERE cod = 1000002 AND ano = 2026 AND mes = 8 AND variavel = 'chuva_mm'",
                       [(base / "gold/clima/mensal.parquet").as_posix()]).fetchone()[0] == 0.0
    esperado_b = (20.0 + 7 + 2.6) + 0.0 + (20.0 + 9 + 2.6)
    assert abs(b["acum3_valor"] - esperado_b) < 1e-3 and b["acum3_cob"] == 3, b
    # B tem 2025 completo; 2026 tem lacuna em fevereiro: sem parcial (os meses não são consecutivos a partir de janeiro)
    assert b["ano_ate"] == 2025 and b["parcial_meses"] is None, b
    # só chuva tem acumulados
    t = linha("1000001", "temperatura_c")
    assert t["acum3_cob"] is None and t["acum12_valor"] is None and t["acum_fim"] is None
    assert t["anomalia_pct"] is None and t["anomalia"] is not None  # diferença absoluta, nunca percentual
    assert t["parcial_anomalia_pct"] is None and t["parcial_anomalia"] is not None

    # lacuna: 2022 sem evaporação, e o painel diz isso
    e = linha("1000001", "evap_mm")
    assert e["anos_lacuna"] == "2022" and e["ano_ate"] == 2025
    assert e["acum3_cob"] is None

    # Brasil/UF ponderado pela área: o valor do grupo é o do agregado publicado (100 e 300 km2), não a média simples
    br = linha("BR", "temperatura_c")
    ponderado = con.execute("SELECT valor FROM read_parquet(?) WHERE grupo = 'BR' AND mes = 0 AND ano = 2025 AND variavel = 'temperatura_c'",
                            [(base / "gold/clima/agregado.parquet").as_posix()]).fetchone()[0]
    assert abs(br["valor"] - ponderado) < 1e-12
    simples = con.execute("SELECT avg(valor) FROM read_parquet(?) WHERE ano = 2025 AND variavel = 'temperatura_c'",
                          [(base / "gold/clima/anual.parquet").as_posix()]).fetchone()[0]
    assert abs(br["valor"] - simples) > 0.01, "média simples no lugar da ponderada por área"

    # código sem dado não ganha linha (no gold real: Fernando de Noronha)
    assert con.execute("SELECT count(*) FROM read_parquet(?) WHERE grupo = '9999999'", [P]).fetchone()[0] == 0

    # 5) origem alterada durante a geração invalida o anúncio: simula trocando o conteúdo antes de uma nova geração com manifesto defasado
    (base / "gold/manifesto.json").write_text(json.dumps({"fontes": {"clima": {"ate": 202608}}}), encoding="utf-8")
    try:
        gerar(base, raiz / "outro")
    except ValueError:
        pass
    else:
        raise AssertionError("manifesto defasado aceito")
    shutil.rmtree(raiz / "outro", ignore_errors=True)

    # 6) validar_destinos: destino existente sem --substituir
    try:
        validar_destinos(base, saida, False)
    except ValueError:
        pass
    else:
        raise AssertionError("destino existente aceito")
print("testes_clima_painel: ok")
