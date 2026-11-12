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


def montar_origens(raiz: Path, ano=2024, empregos=None, ufs=(33, 35, 52)):
    micro = raiz / "pasta com espaço" / "micro"
    base = raiz / "base"
    pasta = micro / "silver" / "trabalho" / "micro" / "rais_vinculos" / f"ano={ano}"
    pasta.mkdir(parents=True)
    (base / "gold" / "trabalho").mkdir(parents=True)
    con = duckdb.connect()
    for uf in ufs:
        con.execute("CREATE OR REPLACE TABLE t (uf TINYINT, municipio INTEGER, ativo_31_12 TINYINT, raca_cor TINYINT, "
                    "escolaridade TINYINT, tipo_vinculo SMALLINT, outra VARCHAR)")
        for l in LINHAS:
            if l[0] == uf:
                con.execute("INSERT INTO t VALUES (?, ?, ?, ?, ?, ?, 'x')", list(l))
        con.execute(f"COPY t TO '{(pasta / f'uf={uf:02d}.parquet').as_posix()}' (FORMAT parquet)")
    json.dump({"rais_vinculos": {str(ano): list(ufs)}}, open(micro / "silver" / "trabalho" / "micro" / "indice.json", "w"))
    empregos = empregos or ESPERADO_MUN
    con.execute("CREATE TABLE g (ano INTEGER, cod_ibge BIGINT, nome VARCHAR, uf VARCHAR, empregos DOUBLE)")
    for cod, uf in GOLD:
        con.execute("INSERT INTO g VALUES (?, ?, 'x', ?, ?)", [ano, cod, uf, float(empregos[str(cod)])])
    # outro ano no gold não pode interferir
    con.execute("INSERT INTO g VALUES (2023, 5208707, 'x', 'GO', 999)")
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
        r = m.executar(micro, base, saida, [2024], threads=1, memoria="1GB", log=lambda *_: None)
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
        m.executar(micro, base, saida, [2024], threads=1, log=msgs.append)
        confere("retomada mantém ano validado", arq.stat().st_mtime_ns == mt and any("mantido" in x for x in msgs), str(msgs))
        # arquivo adulterado não é confiado: regenera
        with open(arq, "ab") as f:
            f.write(b"lixo")
        msgs = []
        m.executar(micro, base, saida, [2024], threads=1, log=msgs.append)
        confere("arquivo adulterado é regerado", any("gerando" in x for x in msgs) and
                m._sha256(arq) == json.loads((saida / "gold/trabalho/perfis/indice.json").read_text())["arquivos"]["2024"]["sha256"], str(msgs))


def teste_inativos_e_fora_do_gold():
    # inativos e fora do gold não entram (já coberto acima pelos totais); aqui: ativo NULL também fica de fora
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        saida = t / "c"
        m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None)
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
                lambda: m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None))
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
                lambda: m.executar(micro, base, t / "c", [2024], threads=1, log=lambda *_: None))


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
                    lambda alvo=alvo: m.executar(micro, base, alvo, [2024], threads=1, log=lambda *_: None))
        # link para dentro da origem
        link = t / "link"
        try:
            os.symlink(base, link, target_is_directory=True)
            levanta("destino recusado: link para a base", m.ErroDestino,
                    lambda: m.executar(micro, base, link / "saida", [2024], threads=1, log=lambda *_: None))
        except OSError:
            print("(symlink indisponível neste sistema; caso de link pulado)")
        depois = sorted((p.relative_to(t), p.stat().st_size) for p in t.rglob("*") if p.is_file() and p.name != "link")
        confere("nenhuma escrita/mkdir nas origens", [x for x in depois if "link" not in str(x[0])] ==
                [x for x in antes if "link" not in str(x[0])], str(set(depois) ^ set(antes)))
        confere("nenhum diretório criado dentro das origens", not (base / "gold" / "novo").exists() and not (micro / "silver" / "x").exists())
        # destino legítimo (irmão) funciona
        m.executar(micro, base, t / "ok", [2024], threads=1, log=lambda *_: None)
        confere("destino irmão aceito", (t / "ok" / "gold/trabalho/perfis/ano=2024.parquet").exists())


def teste_indice_real_e_ano_ausente():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t, ufs=(35, 52))  # índice sem UF 33 -> não assume; só lê o que o índice diz
        # Rio (33) só tem inativos; conciliação continua fechando
        m.executar(micro, base, t / "c", [2024], threads=1, log=lambda *_: None)
        # arquivo do índice ausente
        os.remove(micro / "silver/trabalho/micro/rais_vinculos/ano=2024/uf=35.parquet")
        levanta("arquivo do índice ausente recusa", m.ErroPerfis,
                lambda: m.executar(micro, base, t / "d", [2024], threads=1, log=lambda *_: None))
        levanta("ano fora do índice recusa", m.ErroPerfis,
                lambda: m.executar(micro, base, t / "e", [2019], threads=1, log=lambda *_: None))
        confere("falha cedo não cria saída", not (t / "d").exists() and not (t / "e").exists())


def teste_validacao_detecta_arquivo_ruim():
    with tempfile.TemporaryDirectory() as t:
        t = Path(t)
        micro, base = montar_origens(t)
        saida = t / "c"
        m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None)
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
        m.executar(micro, base, saida, [2024], threads=1, log=lambda *_: None)
        perfis = saida / "gold/trabalho/perfis"
        f = m.fonte_perfis(perfis)["rais_perfis"]
        confere("fonte_perfis", f["anos"] == [2024] and f["total_br"] == {"2024": 10} and f["variaveis"][-1] == "total", str(f)[:200])
        os.remove(perfis / "ano=2024.parquet")
        confere("arquivo sumido não é anunciado", m.fonte_perfis(perfis) == {})


if __name__ == "__main__":
    for nome, fn in list(globals().items()):
        if nome.startswith("teste_") and callable(fn):
            fn()
    print(f"{executados} verificações, {len(falhas)} falha(s)")
    sys.exit(1 if falhas else 0)
