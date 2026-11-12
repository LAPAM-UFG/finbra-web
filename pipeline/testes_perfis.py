"""Testes do gerador de perfis da RAIS (trabalho_perfis.py) com fixture pequena em diretório temporário.
Não usa dados reais.

Uso:
    py pipeline/testes_perfis.py
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import duckdb

sys.path.insert(0, str(Path(__file__).parent))
import trabalho_perfis as m  # noqa: E402

falhas = []
executados = 0


def ex1(*a, **k):
    """executar na versão 1 (formato antigo, só contagens): os testes V1 continuam valendo como fallback."""
    return m.executar(*a, versao=1, **k)


def confere(nome, cond, detalhe=""):
    global executados
    executados += 1
    if not cond:
        falhas.append(nome)
        print(f"FALHOU: {nome} {detalhe}")


def levanta(nome, exc, fn):
    global executados
    executados += 1
    try:
        fn()
    except exc:
        return
    except Exception as e:  # noqa: BLE001
        falhas.append(nome)
        print(f"FALHOU: {nome} (exceção errada: {type(e).__name__}: {e})")
        return
    falhas.append(nome)
    print(f"FALHOU: {nome} (não levantou {exc.__name__})")


# município (7 dígitos do gold) -> UF
GOLD = [(5208707, "GO"), (5201108, "GO"), (3550308, "SP"), (3304557, "RJ"), (1100015, "RO")]
# (uf_arquivo, municipio6, ativo, raca, esc, tipo_vinculo) — linhas da fixture
LINHAS = [
    # Goiânia (520870): ativos com NULL, raça 9, código fora do dicionário (77), esc 9/10/11 e tipos de vínculo variados
    (52, 520870, 1, 1, 9, 10), (52, 520870, 1, 2, 10, 30), (52, 520870, 1, 9, 11, 96), (52, 520870, 1, None, None, None),
    (52, 520870, 1, 77, 5, 55), (52, 520870, 1, 4, 7, 75), (52, 520870, 0, 1, 9, 10), (52, 520870, 0, 2, 9, 30),
    (52, 520870, None, 1, 9, 10),
    # Aparecida (520110): 1 ativo
    (52, 520110, 1, 1, 8, 31),
    # São Paulo (355030): 3 ativos
    (35, 355030, 1, 1, 9, 10), (35, 355030, 1, 1, 9, 10), (35, 355030, 1, 3, 4, 65),
    # Rio (330455): só inativos (total 0 no gold); RO (110001): sem nenhuma linha (total 0)
    (33, 330455, 0, 1, 1, 10),
    # fora do gold: município ignorado e município inexistente no gold, ambos ativos
    (35, 359999, 1, 1, 1, 10), (33, 999999, 1, 2, 2, 10),
]
ESPERADO_MUN = {"5208707": 6, "5201108": 1, "3550308": 3, "3304557": 0, "1100015": 0}
# rem_dezembro_nom (R$) de cada linha de LINHAS, na mesma ordem: positivos, zero, vazio, negativo; inativos, ativo vazio e
# fora do gold com valores altos, que não podem entrar em nenhum total
REM = ["1000.50", "2000.00", "0.00", None, "-50.00", "300.25", "9999.00", "9999.00", "9999.00",
       None,
       "5000.00", "100.10", "700.00",
       "1234.00",
       "8888.00", "7777.00"]
assert len(REM) == len(LINHAS)
# gold esperado por município (massa em R$, n de valores positivos): calculado à mão a partir de REM
GOLD_REM = {"5208707": (3300.75, 3), "5201108": (None, 0), "3550308": (5800.10, 3), "3304557": (None, 0), "1100015": (None, 0)}


def montar_origens(raiz: Path, ano=2024, empregos=None, ufs=(33, 35, 52), rem_tipo="DECIMAL(14,2)"):
    micro = raiz / "pasta com espaço" / "micro"
    base = raiz / "base"
    pasta = micro / "silver" / "trabalho" / "micro" / "rais_vinculos" / f"ano={ano}"
    pasta.mkdir(parents=True)
    (base / "gold" / "trabalho").mkdir(parents=True)
    con = duckdb.connect()
    for uf in ufs:
        con.execute("CREATE OR REPLACE TABLE t (uf TINYINT, municipio INTEGER, ativo_31_12 TINYINT, raca_cor TINYINT, "
                    f"escolaridade TINYINT, tipo_vinculo SMALLINT, outra VARCHAR, rem_dezembro_nom {rem_tipo})")
        for l, rem in zip(LINHAS, REM):
            if l[0] == uf:
                con.execute("INSERT INTO t VALUES (?, ?, ?, ?, ?, ?, 'x', ?)", list(l) + [rem])
        con.execute(f"COPY t TO '{(pasta / f'uf={uf:02d}.parquet').as_posix()}' (FORMAT parquet)")
    json.dump({"rais_vinculos": {str(ano): list(ufs)}}, open(micro / "silver" / "trabalho" / "micro" / "indice.json", "w"))
    empregos = empregos or ESPERADO_MUN
    con.execute("CREATE TABLE g (ano INTEGER, cod_ibge BIGINT, nome VARCHAR, uf VARCHAR, empregos DOUBLE, massa_dez DOUBLE, n_rem_dez DOUBLE)")
    for cod, uf in GOLD:
        massa, n_rem = GOLD_REM[str(cod)]
        con.execute("INSERT INTO g VALUES (?, ?, 'x', ?, ?, ?, ?)", [ano, cod, uf, float(empregos[str(cod)]), massa, float(n_rem)])
    # outro ano no gold não pode interferir
    con.execute("INSERT INTO g VALUES (2023, 5208707, 'x', 'GO', 999, 1.0, 1.0)")
    con.execute(f"COPY g TO '{(base / 'gold' / 'trabalho' / 'municipios.parquet').as_posix()}' (FORMAT parquet)")
    json.dump({"gerado_em": "2026-01-01T00:00:00+00:00", "fontes": {"rais": {"anos": [ano]}, "siconfi": {"x": 1}}},
              open(base / "gold" / "manifesto.json", "w"))
    return micro, base


def tabela(saida: Path, ano=2024):
    con = duckdb.connect()
    return con, f"read_parquet('{(saida / 'gold' / 'trabalho' / 'perfis' / f'ano={ano}.parquet').as_posix()}')"


def teste_geracao_completa():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        manif_antes = (base / "gold" / "manifesto.json").read_bytes()
        saida = t / "candidato"
        r = ex1(micro, base, saida, [2024], threads=1, memoria="1GB", log=lambda *_: None)
        con, src = tabela(saida)
        # colunas e ordenação
        cols = {x[0]: x[1] for x in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()}
        confere("colunas", cols == {"ano": "INTEGER", "escopo": "VARCHAR", "variavel": "VARCHAR", "codigo": "VARCHAR",
                                   "vinculos": "BIGINT", "total": "BIGINT"}, str(cols))
        linhas = con.execute(f"SELECT escopo, variavel, codigo FROM {src}").fetchall()
        confere("ordenado", linhas == sorted(linhas), "")
        # totais por escopo: municípios do gold, UF e BR somam só o gold (sem fora do gold, sem inativos)
        tot = dict(con.execute(f"SELECT escopo, vinculos FROM {src} WHERE variavel='total'").fetchall())
        confere("totais municipais", all(tot[k] == v for k, v in ESPERADO_MUN.items()), str(tot))
        confere("total GO/SP/RJ/RO", (tot["GO"], tot["SP"], tot["RJ"], tot["RO"]) == (7, 3, 0, 0), str(tot))
        confere("total BR", tot["BR"] == 10, str(tot))
        confere("escopos exatos", set(tot) == {str(c) for c, _ in GOLD} | {"GO", "SP", "RJ", "RO", "BR"}, str(set(tot)))
        # soma de todas as categorias = total, em todos os escopos com vínculos e em cada variável
        ruins = con.execute(f"""SELECT escopo, variavel FROM {src} WHERE variavel <> 'total' GROUP BY escopo, variavel
                                HAVING sum(vinculos) <> any_value(total)""").fetchall()
        confere("soma categorias = total", not ruins, str(ruins))
        # município sem vínculos: só linha total = 0 (sem categorias inventadas)
        confere("município zerado", con.execute(f"SELECT count(*) FROM {src} WHERE escopo='3304557'").fetchone()[0] == 1)
        # NULL e códigos inesperados preservados
        d = dict(con.execute(f"SELECT codigo, vinculos FROM {src} WHERE escopo='5208707' AND variavel='raca_cor'").fetchall())
        confere("raça: NULL, 9 e 77 separados", d == {"1": 1, "2": 1, "9": 1, "77": 1, "4": 1, "_ausente": 1}, str(d))
        e = dict(con.execute(f"SELECT codigo, vinculos FROM {src} WHERE escopo='5208707' AND variavel='escolaridade'").fetchall())
        confere("escolaridade 9/10/11 separadas e vazio à parte", e == {"9": 1, "10": 1, "11": 1, "5": 1, "7": 1, "_ausente": 1}, str(e))
        # superior = 9+10+11 (escolaridade >= 9) na UF GO: Goiânia 3 + Aparecida 0 (esc 8)
        sup = con.execute(f"""SELECT sum(vinculos) FROM {src} WHERE escopo='GO' AND variavel='escolaridade'
                              AND try_cast(codigo AS INT) >= 9""").fetchone()[0]
        confere("superior = 9+10+11", sup == 3, str(sup))
        tv = dict(con.execute(f"SELECT codigo, vinculos FROM {src} WHERE escopo='5208707' AND variavel='tipo_vinculo'").fetchall())
        confere("tipo_vinculo detalhado", tv == {"10": 1, "30": 1, "96": 1, "55": 1, "75": 1, "_ausente": 1}, str(tv))
        # vinculo_mte: 10,75 -> 1; 30,96 -> 2; 55 -> 3; NULL à parte
        mte = dict(con.execute(f"SELECT codigo, vinculos FROM {src} WHERE escopo='5208707' AND variavel='vinculo_mte'").fetchall())
        confere("vinculo_mte", mte == {"1": 2, "2": 2, "3": 1, "_ausente": 1}, str(mte))
        # índice
        ind = json.loads((saida / "gold" / "trabalho" / "perfis" / "indice.json").read_text(encoding="utf-8"))
        reg = ind["arquivos"]["2024"]
        confere("índice anos", ind["anos"] == [2024] and reg["total_br"] == 10 and reg["conciliacao"]["divergencias"] == 0)
        confere("índice fora do gold", reg["conciliacao"]["fora_do_gold"]["vinculos_ativos"] == 2, str(reg["conciliacao"]))
        confere("índice hash", reg["sha256"] == m._sha256(saida / "gold" / "trabalho" / "perfis" / "ano=2024.parquet"))
        confere("índice universo/dimensões", "universo" in ind and "vinculo_mte" in ind["dimensoes"])
        confere("sem arquivo parcial", not list((saida).rglob("*.parcial")))
        confere("tmp do duckdb removido", not (saida / "_tmp_duckdb").exists())
        # manifesto candidato: preserva as outras fontes e não mexe na origem
        man = json.loads((saida / "gold" / "manifesto.json").read_text(encoding="utf-8"))
        confere("manifesto: fonte nova", man["fontes"]["rais_perfis"]["anos"] == [2024])
        confere("manifesto: preserva fontes", man["fontes"]["rais"] == {"anos": [2024]} and man["fontes"]["siconfi"] == {"x": 1})
        confere("manifesto: gerado_em novo", man["gerado_em"] != "2026-01-01T00:00:00+00:00")
        confere("manifesto de origem intacto", (base / "gold" / "manifesto.json").read_bytes() == manif_antes)
        confere("retorno", r["anos"] == [2024])
        # retomada: segundo run mantém o ano validado (arquivo intocado)
        arq = saida / "gold" / "trabalho" / "perfis" / "ano=2024.parquet"
        mt = arq.stat().st_mtime_ns
        msgs = []
        ex1(micro, base, saida, [2024], threads=1, log=msgs.append)
        confere("retomada mantém ano validado", arq.stat().st_mtime_ns == mt and any("mantido" in x for x in msgs), str(msgs))
        # arquivo adulterado não é confiado: regenera
        with open(arq, "ab") as f:
            f.write(b"lixo")
        msgs = []
        ex1(micro, base, saida, [2024], threads=1, log=msgs.append)
        confere("arquivo adulterado é regerado", any("gerando" in x for x in msgs) and
                m._sha256(arq) == json.loads((saida / "gold/trabalho/perfis/indice.json").read_text())["arquivos"]["2024"]["sha256"], str(msgs))


def teste_inativos_e_fora_do_gold():
    # inativos e fora do gold não entram (já coberto acima pelos totais); aqui: ativo NULL também fica de fora
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        saida = t / "c"
        ex1(micro, base, saida, [2024], threads=1, log=lambda *_: None)
        con, src = tabela(saida)
        confere("ativo NULL/0 fora", con.execute(f"SELECT vinculos FROM {src} WHERE escopo='5208707' AND variavel='total'").fetchone()[0] == 6)


def teste_conciliacao_divergente():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        emp = dict(ESPERADO_MUN)
        emp["5201108"] = 2  # gold diz 2, microdados têm 1
        micro, base = montar_origens(t, empregos=emp)
        saida = t / "c"
        levanta("conciliação divergente recusa", m.ErroConciliacao,
                lambda: ex1(micro, base, saida, [2024], threads=1, log=lambda *_: None))
        confere("nenhum arquivo final nem índice anunciando o ano",
                not (saida / "gold/trabalho/perfis/ano=2024.parquet").exists() and
                not json.loads((saida / "gold/trabalho/perfis/indice.json").read_text())["anos"]
                and not (saida / "gold/manifesto.json").exists())
        confere("sem parcial", not list(saida.rglob("*.parcial")) or all(p.name.startswith("indice") for p in saida.rglob("*.parcial")))
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        emp = dict(ESPERADO_MUN)
        emp["3304557"] = 5  # gold diz 5; microdados: nenhum ativo (só inativo)
        micro, base = montar_origens(t, empregos=emp)
        levanta("município sem ativos mas com empregos no gold recusa", m.ErroConciliacao,
                lambda: ex1(micro, base, t / "c", [2024], threads=1, log=lambda *_: None))


def teste_limites_das_origens():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        antes = sorted((p.relative_to(t), p.stat().st_size) for p in t.rglob("*") if p.is_file())
        casos = {
            "igual à base": base, "igual ao micro": micro, "dentro da base": base / "gold" / "novo",
            "dentro do micro": micro / "silver" / "x", "ancestral (raiz do teste)": t,
            "ancestral do micro": micro.parent, "sobre arquivo de origem": base / "gold" / "manifesto.json",
            "com ..": base / "gold" / ".." / ".." / "base" / "x", "maiúsculas": Path(str(base).upper()) / "y",
        }
        for nome, alvo in casos.items():
            levanta(f"destino recusado: {nome}", m.ErroDestino,
                    lambda alvo=alvo: ex1(micro, base, alvo, [2024], threads=1, log=lambda *_: None))
        # link para dentro da origem
        link = t / "link"
        try:
            os.symlink(base, link, target_is_directory=True)
            levanta("destino recusado: link para a base", m.ErroDestino,
                    lambda: ex1(micro, base, link / "saida", [2024], threads=1, log=lambda *_: None))
        except OSError:
            print("(symlink indisponível neste sistema; caso de link pulado)")
        depois = sorted((p.relative_to(t), p.stat().st_size) for p in t.rglob("*") if p.is_file() and p.name != "link")
        confere("nenhuma escrita/mkdir nas origens", [x for x in depois if "link" not in str(x[0])] ==
                [x for x in antes if "link" not in str(x[0])], str(set(depois) ^ set(antes)))
        confere("nenhum diretório criado dentro das origens", not (base / "gold" / "novo").exists() and not (micro / "silver" / "x").exists())
        # destino legítimo (irmão) funciona
        ex1(micro, base, t / "ok", [2024], threads=1, log=lambda *_: None)
        confere("destino irmão aceito", (t / "ok" / "gold/trabalho/perfis/ano=2024.parquet").exists())


def teste_indice_real_e_ano_ausente():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t, ufs=(35, 52))  # índice sem UF 33 -> não assume; só lê o que o índice diz
        # Rio (33) só tem inativos; conciliação continua fechando
        ex1(micro, base, t / "c", [2024], threads=1, log=lambda *_: None)
        # arquivo do índice ausente
        os.remove(micro / "silver/trabalho/micro/rais_vinculos/ano=2024/uf=35.parquet")
        levanta("arquivo do índice ausente recusa", m.ErroPerfis,
                lambda: ex1(micro, base, t / "d", [2024], threads=1, log=lambda *_: None))
        levanta("ano fora do índice recusa", m.ErroPerfis,
                lambda: ex1(micro, base, t / "e", [2019], threads=1, log=lambda *_: None))
        confere("falha cedo não cria saída", not (t / "d").exists() and not (t / "e").exists())


def teste_validacao_detecta_arquivo_ruim():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        saida = t / "c"
        ex1(micro, base, saida, [2024], threads=1, log=lambda *_: None)
        arq = saida / "gold/trabalho/perfis/ano=2024.parquet"
        gold = base / "gold/trabalho/municipios.parquet"
        con = duckdb.connect()
        ruim = t / "ruim.parquet"
        con.execute(f"COPY (SELECT ano, escopo, variavel, codigo, CASE WHEN escopo='GO' AND variavel='raca_cor' AND codigo='1' "
                    f"THEN vinculos + 1 ELSE vinculos END AS vinculos, total FROM read_parquet('{arq.as_posix()}')) TO '{ruim.as_posix()}' (FORMAT parquet)")
        levanta("categoria alterada não fecha com o total", m.ErroPerfis, lambda: m.validar_arquivo(con, ruim, 2024, gold))
        sem_uf = t / "sem_uf.parquet"
        con.execute(f"COPY (SELECT * FROM read_parquet('{arq.as_posix()}') WHERE escopo <> 'SP') TO '{sem_uf.as_posix()}' (FORMAT parquet)")
        levanta("escopo ausente recusa", m.ErroPerfis, lambda: m.validar_arquivo(con, sem_uf, 2024, gold))


def teste_fonte_perfis():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        confere("sem índice -> {}", m.fonte_perfis(t / "nada") == {})
        micro, base = montar_origens(t)
        saida = t / "c"
        ex1(micro, base, saida, [2024], threads=1, log=lambda *_: None)
        perfis = saida / "gold/trabalho/perfis"
        f = m.fonte_perfis(perfis)["rais_perfis"]
        confere("fonte_perfis", f["anos"] == [2024] and f["total_br"] == {"2024": 10} and f["variaveis"][-1] == "total", str(f)[:200])
        os.remove(perfis / "ano=2024.parquet")
        confere("arquivo sumido não é anunciado", m.fonte_perfis(perfis) == {})


# =========================================================================== versão 2 (remuneração)

def tabela2(saida: Path, ano=2024):
    con = duckdb.connect()
    return con, f"read_parquet('{(saida / 'gold' / 'trabalho' / 'perfis_v2' / f'ano={ano}.parquet').as_posix()}')"


def ajustar_gold(base: Path, sql: str):
    """Altera o gold da fixture (só dentro do diretório temporário do teste)."""
    f = (base / "gold" / "trabalho" / "municipios.parquet").as_posix()
    con = duckdb.connect()
    con.execute(f"CREATE TABLE g AS SELECT * FROM read_parquet('{f}')")
    con.execute(sql)
    con.execute(f"COPY g TO '{f}' (FORMAT parquet)")


def linha2(con, src, escopo, variavel, codigo):
    return con.execute(f"SELECT vinculos, total, massa_dez_centavos, n_rem_dez, remuneracao_media_dez FROM {src} "
                       f"WHERE escopo = '{escopo}' AND variavel = '{variavel}' AND codigo = '{codigo}'").fetchone()


def perto(a, b, tol=1e-9):
    return a is not None and abs(a - b) <= tol * max(1, abs(b))


def teste_v2_geracao_e_regras_de_remuneracao():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        manif_antes = (base / "gold" / "manifesto.json").read_bytes()
        saida = t / "candidato"
        r = m.executar(micro, base, saida, [2024], threads=1, memoria="1GB", log=lambda *_: None)  # padrão: versão 2
        con, src = tabela2(saida)
        confere("v2 em perfis_v2", (saida / "gold/trabalho/perfis_v2/ano=2024.parquet").exists() and not (saida / "gold/trabalho/perfis").exists())
        cols = {x[0]: x[1] for x in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()}
        confere("colunas v2", cols == {"ano": "INTEGER", "escopo": "VARCHAR", "variavel": "VARCHAR", "codigo": "VARCHAR", "vinculos": "BIGINT",
                                       "total": "BIGINT", "massa_dez_centavos": "BIGINT", "n_rem_dez": "BIGINT", "remuneracao_media_dez": "DOUBLE"}, str(cols))
        linhas = con.execute(f"SELECT escopo, variavel, codigo FROM {src}").fetchall()
        confere("v2 ordenado", linhas == sorted(linhas))
        # total/total: centavos exatos, n e média (R$) com TODOS os vínculos no denominador
        goiania = linha2(con, src, "5208707", "total", "total")
        confere("Goiânia total", goiania[:4] == (6, 6, 330075, 3) and perto(goiania[4], 3300.75 / 6), str(goiania))
        confere("Goiânia: média usa os 6 vínculos, não os 3 com valor", not perto(goiania[4], 3300.75 / 3))
        ap = linha2(con, src, "5201108", "total", "total")
        confere("grupo todo sem remuneração: massa e média NULL (não R$ 0,00), n=0", ap == (1, 1, None, 0, None), str(ap))
        for z in ("3304557", "1100015"):
            confere(f"município sem vínculos {z}: massa e média NULL", linha2(con, src, z, "total", "total") == (0, 0, None, 0, None))
        sp = linha2(con, src, "3550308", "total", "total")
        confere("SP total", sp[:4] == (3, 3, 580010, 3) and perto(sp[4], 5800.10 / 3), str(sp))
        # inativo, ativo nulo e fora do gold não entram na massa nem em n
        confere("BR: massa e n só do universo", linha2(con, src, "BR", "total", "total")[:4] == (10, 10, 910085, 6))
        # UF/BR: numeradores e denominadores somados, média recalculada (nunca média de médias)
        go = linha2(con, src, "GO", "total", "total")
        confere("GO ponderada", go[:4] == (7, 7, 330075, 3) and perto(go[4], 3300.75 / 7), str(go))
        br = linha2(con, src, "BR", "total", "total")
        confere("BR ponderada", perto(br[4], 9100.85 / 10), str(br))
        # categoria: grupos de tamanhos diferentes; vínculo sem remuneração fica no denominador
        r1 = linha2(con, src, "GO", "raca_cor", "1")  # Goiânia (1000,50) + Aparecida (sem valor)
        confere("GO raça 1: 2 vínculos, 1 valor, média 500,25 (e não 1000,50)", r1[:4] == (2, 7, 100050, 1) and perto(r1[4], 500.25), str(r1))
        r1b = linha2(con, src, "BR", "raca_cor", "1")  # + SP (5000,00 e 100,10)
        confere("BR raça 1 ponderada", r1b[:4] == (4, 10, 610060, 3) and perto(r1b[4], 6100.60 / 4), str(r1b))
        medias = [linha2(con, src, e, "raca_cor", "1")[4] for e in ("5208707", "5201108", "3550308")]
        confere("a média de BR não é a média das médias", not perto(r1b[4], sum(x for x in medias if x is not None) / 2), str(medias))
        # zero, negativo, vazio: vínculo conta, valor não; categorias sem nenhum valor positivo ficam NULL
        goi = {c: linha2(con, src, "5208707", "raca_cor", c) for c in ("1", "2", "4", "9", "77", "_ausente")}
        confere("raça 9 (rem 0) separada, sem valor: NULL e n=0", goi["9"] == (1, 6, None, 0, None), str(goi["9"]))
        confere("raça 77 (rem negativa): NULL e n=0", goi["77"] == (1, 6, None, 0, None), str(goi["77"]))
        confere("ausente (rem vazia): NULL e n=0", goi["_ausente"] == (1, 6, None, 0, None), str(goi["_ausente"]))
        confere("raça 2 e 4 com valor", goi["2"][2:4] == (200000, 1) and goi["4"][2:4] == (30025, 1))
        # vinculo_mte: 96 em estatutários (rem 0), aprendiz (55, negativo) em outros
        mte = {c: linha2(con, src, "BR", "vinculo_mte", c) for c in ("1", "2", "3")}
        confere("MTE BR celetistas", mte["1"][:4] == (5, 10, 710085, 5), str(mte["1"]))
        confere("MTE BR estatutários: 3 vínculos, 1 valor", mte["2"][:4] == (3, 10, 200000, 1) and perto(mte["2"][4], 2000.0 / 3), str(mte["2"]))
        confere("MTE BR outros sem valor: NULL", mte["3"] == (1, 10, None, 0, None), str(mte["3"]))
        # categorias não observadas não existem (sem média inventada)
        confere("categoria não observada sem linha", linha2(con, src, "5208707", "raca_cor", "6") is None)
        # somas: massa e n_rem de todas as categorias = total, em todos os escopos e variáveis
        ruins = con.execute(f"""SELECT t.escopo, c.variavel FROM {src} t JOIN (SELECT escopo, variavel, sum(coalesce(massa_dez_centavos,0)) sm, sum(n_rem_dez) sn
                                FROM {src} WHERE variavel <> 'total' GROUP BY ALL) c USING (escopo)
                                WHERE t.variavel = 'total' AND (coalesce(t.massa_dez_centavos,0) <> c.sm OR t.n_rem_dez <> c.sn)""").fetchall()
        confere("massa e n_rem das categorias somam ao total", not ruins, str(ruins))
        confere("n_rem <= vínculos e nulidade coerente", con.execute(
            f"SELECT count(*) FROM {src} WHERE n_rem_dez > vinculos OR (massa_dez_centavos IS NULL) <> (n_rem_dez = 0)").fetchone()[0] == 0)
        # índice V2
        ind = json.loads((saida / "gold/trabalho/perfis_v2/indice.json").read_text(encoding="utf-8"))
        reg = ind["arquivos"]["2024"]
        confere("índice v2", ind["versao"] == 2 and ind["anos"] == [2024] and "remuneracao" in ind and "massa_dez_centavos" in ind["colunas"])
        confere("índice: conciliação de massa e n_rem", reg["conciliacao"]["massa_dez"]["maior_desvio_centavos"] == 0
                and reg["conciliacao"]["n_rem_dez"]["divergencias"] == 0 and reg["massa_br_centavos"] == 910085 and reg["n_rem_dez_br"] == 6)
        confere("índice: fórmula documentada", "TODOS os vínculos" in ind["remuneracao"]["formula"] and "BRL" in ind["remuneracao"]["referencia"])
        # manifesto candidato com a fonte V2 (e sem fallback quando a base não tinha V1)
        man = json.loads((saida / "gold/manifesto.json").read_text(encoding="utf-8"))
        f = man["fontes"]["rais_perfis"]
        confere("manifesto v2", f["versao"] == 2 and f["arquivos"] == "gold/trabalho/perfis_v2/ano={ano}.parquet" and f["anos"] == [2024]
                and f["indice"] == "gold/trabalho/perfis_v2/indice.json" and "fallback_v1" not in f and "remuneracao" in f)
        confere("manifesto preserva as demais fontes", man["fontes"]["rais"] == {"anos": [2024]} and man["fontes"]["siconfi"] == {"x": 1})
        confere("manifesto de origem intacto", (base / "gold" / "manifesto.json").read_bytes() == manif_antes)
        confere("retorno v2", r["anos"] == [2024])
        # retomada: mantém o ano validado; arquivo adulterado é regerado
        arq = saida / "gold/trabalho/perfis_v2/ano=2024.parquet"
        mt = arq.stat().st_mtime_ns
        msgs = []
        m.executar(micro, base, saida, [2024], threads=1, log=msgs.append)
        confere("v2 retomada mantém", arq.stat().st_mtime_ns == mt and any("mantido" in x for x in msgs), str(msgs))
        with open(arq, "ab") as fh:
            fh.write(b"lixo")
        msgs = []
        m.executar(micro, base, saida, [2024], threads=1, log=msgs.append)
        confere("v2 adulterado é regerado", any("gerando" in x for x in msgs))


def teste_v2_tolerancia_e_divergencias_do_gold():
    # 1 centavo de ruído de ponto flutuante: aceito e registrado, sem ajustar o dado
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        ajustar_gold(base, "UPDATE g SET massa_dez = 3300.76 WHERE cod_ibge = 5208707 AND ano = 2024")
        saida = t / "c"
        m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None)
        ind = json.loads((saida / "gold/trabalho/perfis_v2/indice.json").read_text(encoding="utf-8"))
        confere("desvio de 1 centavo registrado", ind["arquivos"]["2024"]["conciliacao"]["massa_dez"]["maior_desvio_centavos"] == 1
                and ind["maior_desvio_centavos"] == 1 and ind["arquivos"]["2024"]["conciliacao"]["massa_dez"]["municipios_com_desvio"] == 1)
        con, src = tabela2(saida)
        confere("o dado segue o microdado, não o gold", linha2(con, src, "5208707", "total", "total")[2] == 330075)
        # depois de gerado e validado, alterar a massa do gold além da tolerância: retomada recusa e regenera, a conciliação para
        ajustar_gold(base, "UPDATE g SET massa_dez = 3300.80 WHERE cod_ibge = 5208707 AND ano = 2024")
        levanta("massa do gold alterada (5 centavos) recusa na retomada", m.ErroConciliacao,
                lambda: m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None))
        confere("ano recusado não é anunciado", json.loads((saida / "gold/trabalho/perfis_v2/indice.json").read_text(encoding="utf-8"))["anos"] == [])
        confere("fonte_perfis não anuncia o ano", m.fonte_perfis(saida / "gold/trabalho/perfis_v2", versao=2) == {})
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        ajustar_gold(base, "UPDATE g SET massa_dez = massa_dez + 0.03 WHERE cod_ibge = 3550308 AND ano = 2024")
        levanta("massa 3 centavos acima da tolerância recusa", m.ErroConciliacao, lambda: m.executar(micro, base, t / "c", [2024], threads=1, log=lambda *_: None))
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        ajustar_gold(base, "UPDATE g SET n_rem_dez = 4 WHERE cod_ibge = 5208707 AND ano = 2024")
        levanta("n_rem_dez do gold diferente recusa", m.ErroConciliacao, lambda: m.executar(micro, base, t / "c", [2024], threads=1, log=lambda *_: None))
        confere("sem arquivo final", not (t / "c/gold/trabalho/perfis_v2/ano=2024.parquet").exists())
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        ajustar_gold(base, "UPDATE g SET massa_dez = NULL WHERE cod_ibge = 3550308 AND ano = 2024")
        levanta("massa nula no gold com valores nos microdados recusa", m.ErroConciliacao, lambda: m.executar(micro, base, t / "c", [2024], threads=1, log=lambda *_: None))
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t, rem_tipo="DOUBLE")
        levanta("rem_dezembro_nom que não é DECIMAL(p,2) é recusado", m.ErroPerfis, lambda: m.executar(micro, base, t / "c", [2024], threads=1, log=lambda *_: None))
    # o gold de V1 (sem massa_dez/n_rem_dez) não serve para a V2
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        ajustar_gold(base, "ALTER TABLE g DROP COLUMN massa_dez")
        levanta("gold sem massa_dez recusado na V2", m.ErroPerfis, lambda: m.executar(micro, base, t / "c", [2024], threads=1, log=lambda *_: None))
        ex1(micro, base, t / "c1", [2024], threads=1, log=lambda *_: None)  # a V1 segue funcionando sem essas colunas
        confere("V1 independe das colunas de remuneração", (t / "c1/gold/trabalho/perfis/ano=2024.parquet").exists())


def teste_v2_ausente_nao_e_arredondamento():
    con = duckdb.connect()
    con.execute("CREATE TEMP TABLE gm AS SELECT 5208707 AS cod7, 520870 AS mun6, 'GO' AS uf, 1.0 AS empregos, NULL::DOUBLE AS massa_dez, 1.0 AS n_rem_dez")
    con.execute("CREATE TEMP TABLE base AS SELECT 520870 AS mun6, 1::BIGINT AS n, 1::BIGINT AS massa, 1::BIGINT AS n_rem")
    levanta("massa gold ausente contra 1 centavo não é ruído", m.ErroConciliacao, lambda: m._conciliar(con, 2024, 2))
    con.execute("UPDATE gm SET massa_dez=-0.01")
    levanta("massa gold negativa contra 1 centavo não é ruído", m.ErroConciliacao, lambda: m._conciliar(con, 2024, 2))
    con.close()


def teste_v2_validacao_detecta_arquivo_ruim():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        saida = t / "c"
        m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None)
        arq = saida / "gold/trabalho/perfis_v2/ano=2024.parquet"
        gold = base / "gold/trabalho/municipios.parquet"
        con = duckdb.connect()

        def variante(nome, coluna_sql):
            dest = t / f"{nome}.parquet"
            con.execute(f"COPY (SELECT ano, escopo, variavel, codigo, vinculos, total, {coluna_sql} FROM read_parquet('{arq.as_posix()}')) "
                        f"TO '{dest.as_posix()}' (FORMAT parquet)")
            return dest

        base_cols = "massa_dez_centavos, n_rem_dez, remuneracao_media_dez"
        confere("arquivo íntegro valida", m.validar_arquivo(con, arq, 2024, gold, 2)["maior_desvio_centavos"] == 0)
        massa_uf = variante("massa_uf", "CASE WHEN escopo = 'GO' AND variavel = 'raca_cor' AND codigo = '1' THEN massa_dez_centavos + 100 ELSE massa_dez_centavos END AS massa_dez_centavos, n_rem_dez, remuneracao_media_dez")
        levanta("massa de categoria da UF alterada", m.ErroPerfis, lambda: m.validar_arquivo(con, massa_uf, 2024, gold, 2))
        media_zero = variante("media_zero", "massa_dez_centavos, n_rem_dez, CASE WHEN massa_dez_centavos IS NULL AND vinculos > 0 THEN 0.0 ELSE remuneracao_media_dez END AS remuneracao_media_dez")
        levanta("média R$ 0,00 no lugar de NULL", m.ErroPerfis, lambda: m.validar_arquivo(con, media_zero, 2024, gold, 2))
        media_errada = variante("media_errada", "massa_dez_centavos, n_rem_dez, remuneracao_media_dez * 2 AS remuneracao_media_dez")
        levanta("média diferente de massa ÷ vínculos", m.ErroPerfis, lambda: m.validar_arquivo(con, media_errada, 2024, gold, 2))
        n_maior = variante("n_maior", "massa_dez_centavos, CASE WHEN escopo = '5201108' AND variavel = 'total' THEN 5 ELSE n_rem_dez END AS n_rem_dez, remuneracao_media_dez")
        levanta("n_rem_dez maior que vínculos", m.ErroPerfis, lambda: m.validar_arquivo(con, n_maior, 2024, gold, 2))
        nula = variante("nula", "CASE WHEN escopo = '5201108' AND variavel = 'total' THEN 0 ELSE massa_dez_centavos END AS massa_dez_centavos, n_rem_dez, remuneracao_media_dez")
        levanta("massa 0 com n=0 (deveria ser NULL)", m.ErroPerfis, lambda: m.validar_arquivo(con, nula, 2024, gold, 2))
        ex1(micro, base, t / "c1", [2024], threads=1, log=lambda *_: None)
        levanta("arquivo V1 não valida como V2", m.ErroPerfis, lambda: m.validar_arquivo(con, t / "c1/gold/trabalho/perfis/ano=2024.parquet", 2024, gold, 2))


def teste_v2_fallback_v1_e_versoes_separadas():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        saida = t / "c"
        ex1(micro, base, saida, [2024], threads=1, log=lambda *_: None)
        v1 = saida / "gold/trabalho/perfis/ano=2024.parquet"
        v1_hash = m._sha256(v1)
        v1_indice = (saida / "gold/trabalho/perfis/indice.json").read_bytes()
        trabalho = saida / "gold/trabalho"
        # só a V1: gold.fonte_trabalho preserva a V1
        so1 = m.fonte_perfis_trabalho(trabalho)["rais_perfis"]
        confere("sem V2, preserva a V1", so1["versao"] == 1 and so1["anos"] == [2024] and so1["arquivos"] == "gold/trabalho/perfis/ano={ano}.parquet")
        m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None)  # V2 na mesma pasta de saída
        confere("V1 intacta depois de gerar a V2", m._sha256(v1) == v1_hash and (saida / "gold/trabalho/perfis/indice.json").read_bytes() == v1_indice)
        comb = m.fonte_perfis_trabalho(trabalho)["rais_perfis"]
        confere("prefere a V2 e leva a V1 como fallback", comb["versao"] == 2 and comb["arquivos"].endswith("perfis_v2/ano={ano}.parquet")
                and comb["fallback_v1"] == {"anos": [2024], "arquivos": "gold/trabalho/perfis/ano={ano}.parquet", "indice": "gold/trabalho/perfis/indice.json"}, str(comb)[:300])
        # a V2 não é anunciada se o arquivo some: volta para a V1
        os.remove(saida / "gold/trabalho/perfis_v2/ano=2024.parquet")
        volta = m.fonte_perfis_trabalho(trabalho)["rais_perfis"]
        confere("sem arquivo V2 validado, volta à V1", volta["versao"] == 1 and "fallback_v1" not in volta)
        # um índice não vale como o da outra versão
        confere("índice V2 não é lido como V1", m.ler_indice(saida / "gold/trabalho/perfis_v2", 1)["arquivos"] == {}
                and m.ler_indice(saida / "gold/trabalho/perfis", 2)["arquivos"] == {})
        # V2 nunca reaproveita um arquivo da V1: apagando só o V2, o índice V2 não aceita o V1 no lugar
        msgs = []
        m.executar(micro, base, saida, [2024], threads=1, log=msgs.append)
        confere("V2 regerada do zero (não reaproveita V1)", any("gerando" in x for x in msgs))
        # manifesto da base com a V1 já publicada: vira fallback_v1 no candidato V2
        man = json.loads((base / "gold/manifesto.json").read_text(encoding="utf-8"))
        man["fontes"]["rais_perfis"] = {"anos": [2023, 2024], "arquivos": "gold/trabalho/perfis/ano={ano}.parquet", "indice": "gold/trabalho/perfis/indice.json", "bytes": 1}
        (base / "gold/manifesto.json").write_text(json.dumps(man), encoding="utf-8")
        antes = (base / "gold/manifesto.json").read_bytes()
        saida2 = t / "c2"
        m.executar(micro, base, saida2, [2024], threads=1, log=lambda *_: None)
        cand = json.loads((saida2 / "gold/manifesto.json").read_text(encoding="utf-8"))["fontes"]
        confere("candidato V2 leva o fallback_v1 do manifesto de origem",
                cand["rais_perfis"]["versao"] == 2 and cand["rais_perfis"]["anos"] == [2024]
                and cand["rais_perfis"]["fallback_v1"] == {"anos": [2023, 2024], "arquivos": "gold/trabalho/perfis/ano={ano}.parquet", "indice": "gold/trabalho/perfis/indice.json"}
                and cand["siconfi"] == {"x": 1} and cand["rais"] == {"anos": [2024]}, str(cand["rais_perfis"])[:300])
        confere("manifesto de origem não alterado", (base / "gold/manifesto.json").read_bytes() == antes)


def teste_v2_limites_das_origens():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        antes = sorted((p.relative_to(t), p.stat().st_size) for p in t.rglob("*") if p.is_file())
        casos = {
            "igual à base": base, "igual ao micro": micro, "dentro da base": base / "gold" / "novo", "dentro do micro": micro / "silver" / "x",
            "ancestral": t, "ancestral do micro": micro.parent, "sobre arquivo de origem": base / "gold" / "manifesto.json",
            "com ..": base / "gold" / ".." / ".." / "base" / "x", "maiúsculas": Path(str(base).upper()) / "y",
        }
        for nome, alvo in casos.items():
            levanta(f"V2 destino recusado: {nome}", m.ErroDestino, lambda alvo=alvo: m.executar(micro, base, alvo, [2024], threads=1, log=lambda *_: None))
        depois = sorted((p.relative_to(t), p.stat().st_size) for p in t.rglob("*") if p.is_file())
        confere("V2: nenhuma escrita nas origens", depois == antes)
        confere("V2: nenhum diretório criado nas origens", not (base / "gold" / "novo").exists() and not (base / "gold/trabalho/perfis_v2").exists()
                and not (micro / "silver" / "x").exists())
        m.executar(micro, base, t / "ok", [2024], threads=1, log=lambda *_: None)
        confere("V2: destino irmão aceito", (t / "ok/gold/trabalho/perfis_v2/ano=2024.parquet").exists())
        # a CLI usa a V2 por padrão
        rc = m.main(["--micro", str(micro), "--base", str(base), "--saida", str(t / "cli"), "--anos", "2024"])
        confere("CLI gera perfis_v2 por padrão", rc == 0 and (t / "cli/gold/trabalho/perfis_v2/ano=2024.parquet").exists() and not (t / "cli/gold/trabalho/perfis").exists())
        confere("CLI recusa destino nas origens", m.main(["--micro", str(micro), "--base", str(base), "--saida", str(base / "gold" / "z"), "--anos", "2024"]) == 1)


if __name__ == "__main__":
    for nome, fn in list(globals().items()):
        if nome.startswith("teste_") and callable(fn):
            fn()
    print(f"{executados} verificações, {len(falhas)} falha(s)")
    sys.exit(1 if falhas else 0)
