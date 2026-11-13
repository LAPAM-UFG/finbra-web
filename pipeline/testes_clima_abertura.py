"""Pacote de abertura do clima: empacotamento completo contra o painel.parquet, offsets em bytes UTF-8, nulos e zeros, município sem cobertura,
corrupção, objetos imutáveis e proteção dos destinos. Dados sintéticos em pasta temporária. Uso:  py pipeline/testes_clima_abertura.py
Com --real <base>, confere também o pacote gerado sobre a base real (somente leitura; a saída vai para uma pasta temporária).
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import duckdb

import clima_abertura as ab

VARS = ["chuva_mm", "temperatura_c", "orvalho_c", "umid_solo_pct", "evap_mm", "radiacao_wm2"]


def montar(base: Path) -> None:
    c = base / "gold" / "clima"
    c.mkdir(parents=True)
    con = duckdb.connect()
    cols = ", ".join(f"{k} {tp}" for k, tp in zip(ab.COLUNAS_PAINEL, [
        "VARCHAR", "VARCHAR", "INTEGER", "INTEGER", "BIGINT", "VARCHAR", "INTEGER", "DOUBLE", "DOUBLE", "DOUBLE", "DOUBLE", "BIGINT", "DOUBLE", "DOUBLE",
        "DOUBLE", "DOUBLE", "INTEGER", "BIGINT", "DOUBLE", "DOUBLE", "BIGINT", "DOUBLE", "DOUBLE", "BIGINT", "DOUBLE", "DOUBLE"]))
    con.execute(f"CREATE TABLE p ({cols})")
    for g in ("BR", "XX", "1000001", "1000002", "2000003"):
        for i, v in enumerate(VARS):
            chuva = v == "chuva_mm"
            zero = g == "1000002" and chuva  # zero real: precisa chegar como 0, não como null
            acum = (g != "1000002") and chuva
            con.execute("INSERT INTO p VALUES (" + ",".join(["?"] * 26) + ")", [
                g, v, 1981, 2025, 45, "2022,2023" if v == "evap_mm" else None, 202609,
                0.0 if zero else 100.5 + i, 98.25, None if v == "temperatura_c" else 0.0123456789012345, -1.5 if v == "temperatura_c" else None,
                9 if chuva else None, 12.5 if chuva else None, 11.0 if chuva else None, 0.136 if chuva else None, None,
                202609 if chuva else None, 3 if chuva else None, 30.25 if acum else None, 28.0 if acum else None,
                6 if chuva else None, 60.0 if acum else None, 55.5 if acum else None, 12 if chuva else None, None, None])
    con.execute("INSERT INTO p (grupo, variavel, ano_de, valor) VALUES ('2000003', 'ação_ç', 1981, 7.5)")  # multibyte no pacote
    con.execute(f"COPY p TO '{(c / 'painel.parquet').as_posix()}' (FORMAT parquet)")
    con.execute("CREATE TABLE t AS SELECT * FROM (VALUES (1000001::BIGINT,'São Luís do Paraitinga','SP','Sudeste',1.0),(1000002,'Ilhéu \"Aspas\"','RJ','Sudeste',1.0),"
                "(2000003,'Zé','PE','Nordeste',1.0),(2000004,'Sem cobertura','PE','Nordeste',1.0)) x(cod,nome,uf,regiao,area_km2)")
    con.execute(f"COPY t TO '{(c / 'territorio.parquet').as_posix()}' (FORMAT parquet)")
    con.execute("CREATE TABLE k AS SELECT * FROM (VALUES " + ",".join(
        f"('{v}','Rótulo ção {v}','mm','soma','Fonte','pct',1981::BIGINT,2025::BIGINT,202609::BIGINT)" for v in VARS) + ") x(variavel,rotulo,unidade,resumo_anual,fonte,anomalia,ano_de,ano_ate,ate)")
    con.execute(f"COPY k TO '{(c / 'catalogo.parquet').as_posix()}' (FORMAT parquet)")
    con.close()
    man = {"gerado_em": "2026-01-01T00:00:00+00:00", "anos": [2020], "fontes": {"siconfi": {"x": 1}, "clima": {
        "anos": [1979, 2026], "ate": 202609, "normal": [1991, 2020], "processado_em": "2026-01-01",
        "painel": {"versao": 1, "arquivo": "gold/clima/painel.parquet", "sha256": ab.sha_arquivo(c / "painel.parquet"), "ate": 202609}}}}
    (base / "gold" / "manifesto.json").write_text(json.dumps(man), encoding="utf-8")


def criar_link(link: Path, alvo: Path, diretorio: bool) -> bool:
    """Link simbólico ou, no Windows, junção (sem privilégio). False se o ambiente não permite criar links."""
    try:
        os.symlink(alvo, link, target_is_directory=diretorio)
        return True
    except (OSError, NotImplementedError):
        pass
    if diretorio and os.name == "nt":
        r = subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(alvo)], capture_output=True)
        return r.returncode == 0 and link.exists()
    return False


def estado(raiz: Path) -> dict:
    return {str(p): p.read_bytes() for p in raiz.rglob("*") if p.is_file() and not p.is_symlink()}


def testar_links(raiz: Path, base: Path, ent: dict) -> None:
    """Links/junções na saída não alcançam a origem; nada é gravado e origem e arquivos antigos ficam intactos. Sem delete recursivo."""
    antes = estado(base)
    nome_arq = ent["arquivo"].split("/")[-1]
    # 1) pasta gold/clima da saída é junção/link para a pasta de clima da ORIGEM
    s1 = raiz / "s_link_dir"
    (s1 / "gold").mkdir(parents=True)
    if criar_link(s1 / "gold" / "clima", base / "gold" / "clima", True):
        try:
            ab.gerar(base, s1)
            raise AssertionError("link de diretório para a origem deveria falhar")
        except ValueError as e:
            assert "base" in str(e) or "link" in str(e), e
        assert estado(base) == antes, "origem alterada via link de diretório"
    else:
        print("aviso: sem permissão para criar link/junção de diretório; caso 1 não exercitado")
    # 2) link de diretório para fora da origem (outra pasta qualquer): também recusado (a saída não passa por links)
    s2, fora = raiz / "s_link_fora", raiz / "fora"
    (s2 / "gold").mkdir(parents=True)
    fora.mkdir()
    if criar_link(s2 / "gold" / "clima", fora, True):
        try:
            ab.gerar(base, s2)
            raise AssertionError("link de diretório para fora deveria falhar")
        except ValueError as e:
            assert "escapa" in str(e) or "link" in str(e), e
        assert not any(fora.iterdir()), "gravou através do link"
    # 3) o ARQUIVO final é um link simbólico para um arquivo da origem; o temporário/final nunca o segue
    s3 = raiz / "s_link_arq"
    (s3 / "gold" / "clima").mkdir(parents=True)
    alvo = base / "gold" / "clima" / "painel.parquet"
    link3 = s3 / "gold" / "clima" / nome_arq
    ok3 = criar_link(link3, alvo, False)
    if not ok3:  # sem privilégio para link simbólico: hard link (mesmo volume), que também aponta para o inode da origem
        try:
            os.link(alvo, link3)
            ok3 = True
        except OSError:
            pass
    if ok3:
        try:
            ab.gerar(base, s3)
            raise AssertionError("arquivo final linkado para a origem deveria falhar")
        except ValueError as e:
            assert "link" in str(e) or "base" in str(e) or "imutáveis" in str(e), e
        assert estado(base) == antes, "origem alterada via link de arquivo"
        assert not (s3 / "gold" / "manifesto.json").exists()
    else:
        print("aviso: não foi possível criar link de arquivo; caso 3 não exercitado")
    # 4) falha no meio: destinos antigos intactos e nenhum temporário sobra
    s4 = raiz / "s_falha"
    ab.gerar(base, s4)
    antigo = estado(s4)
    trocar = os.replace
    chamadas = []

    def falha(a, b):
        chamadas.append(a)
        if len(chamadas) == 2:
            raise OSError("falha simulada na troca")
        return trocar(a, b)

    ab.os.replace = falha
    try:
        try:
            ab.gerar(base, s4, substituir=True)
            raise AssertionError("falha simulada deveria propagar")
        except OSError:
            pass
    finally:
        ab.os.replace = trocar
    sobras = [p.name for p in (s4 / "gold" / "clima").iterdir() if p.name.endswith((".tmp", ".parcial"))]
    assert not sobras, sobras
    # a primeira troca (objeto imutável, mesmo conteúdo) pode ter ocorrido; o manifesto antigo e os bytes dos objetos continuam como estavam
    assert estado(s4) == antigo, "arquivo antigo alterado após falha"
    assert estado(base) == antes
    # 5) sucesso: só os três arquivos esperados, sem temporários
    nomes = sorted(p.name for p in (s4 / "gold" / "clima").iterdir())
    assert nomes == sorted([nome_arq, ent["indice"].split("/")[-1]]), nomes


def esperar(erro_trecho, fn):
    try:
        fn()
    except ValueError as e:
        assert erro_trecho in str(e), f"mensagem inesperada: {e}"
        return
    raise AssertionError(f"deveria falhar com: {erro_trecho}")


def base2_ou(raiz: Path, base: Path) -> Path:
    """A base do teste de links precisa estar completa (a primeira foi mutilada nos testes de base incompleta)."""
    b = raiz / "base_links"
    montar(b)
    return b


def main() -> None:
    raiz = Path(tempfile.mkdtemp(prefix="clima_abertura_"))
    try:
        base, saida = raiz / "base", raiz / "saida"
        montar(base)
        antes = {p: p.read_bytes() for p in base.rglob("*") if p.is_file()}
        ent = ab.gerar(base, saida)
        # a base não foi tocada
        assert antes == {p: p.read_bytes() for p in base.rglob("*") if p.is_file()}, "a base foi alterada"
        clima = saida / "gold" / "clima"
        idx = json.loads((base.parent / "saida" / ent["indice"]).read_text(encoding="utf-8"))
        dados = (saida / ent["arquivo"]).read_bytes()
        assert hashlib.sha256(dados).hexdigest() == ent["sha256"] == idx["sha256"] and len(dados) == ent["bytes"] == idx["bytes"]
        assert hashlib.sha256((saida / ent["indice"]).read_bytes()).hexdigest() == ent["indice_sha256"]
        assert ent["arquivo"].endswith(f"{idx['snapshot']}.ndjson") and ent["indice"].endswith(ent["indice_sha256"][:12] + ".json")
        # manifesto: novo gerado_em, outras fontes e clima.painel preservados, base intacta
        novo = json.loads((saida / "gold" / "manifesto.json").read_text(encoding="utf-8"))
        velho = json.loads((base / "gold" / "manifesto.json").read_text(encoding="utf-8"))
        assert novo["gerado_em"] != velho["gerado_em"] and novo["fontes"]["siconfi"] == velho["fontes"]["siconfi"]
        assert novo["fontes"]["clima"]["painel"] == velho["fontes"]["clima"]["painel"] and "abertura" not in velho["fontes"]["clima"]
        assert {k: v for k, v in novo["fontes"]["clima"].items() if k != "abertura"} == velho["fontes"]["clima"]
        # ordem: BR, UF, municípios por código; offsets pelos bytes UTF-8 (acentos e aspas nos nomes, nenhuma contagem por caractere)
        assert idx["grupos"] == ["BR", "XX", "1000001", "1000002", "2000003"], idx["grupos"]
        assert idx["tamanhos"] == [len(x) for x in dados.splitlines(keepends=True)] and sum(idx["tamanhos"]) == len(dados)
        assert {t[1] for t in idx["territorios"]} == {"São Luís do Paraitinga", 'Ilhéu "Aspas"', "Zé", "Sem cobertura"}
        assert any(t[1] == "Sem cobertura" for t in idx["territorios"]) and "2000004" not in idx["grupos"]  # sem grupo = sem dados, nunca zeros
        assert len(dados.decode("utf-8")) < len(dados), "o teste exige caracteres multibyte no pacote (offsets em bytes, não em caracteres)"
        # leitura por offset (como o navegador): um Range por grupo
        off = 0
        lidos = {}
        for g, n in zip(idx["grupos"], idx["tamanhos"]):
            o = json.loads(dados[off:off + n].decode("utf-8"))
            assert o["g"] == g and o["s"] == idx["snapshot"] and [r[0] for r in o["r"]] == sorted(VARS + (["ação_ç"] if g == "2000003" else []))
            lidos[g] = o["r"]
            off += n
        # zero real continua 0, nulo continua null, números idênticos
        chuva = {r[0]: r for r in lidos["1000002"]}["chuva_mm"]
        col = {k: i for i, k in enumerate(idx["colunas"])}
        assert chuva[col["valor"]] == 0 and chuva[col["valor"]] is not None and chuva[col["acum3_valor"]] is None
        assert {r[0]: r for r in lidos["1000001"]}["temperatura_c"][col["anomalia_pct"]] is None
        assert {r[0]: r for r in lidos["1000001"]}["chuva_mm"][col["anomalia_pct"]] == 0.0123456789012345
        assert {r[0]: r for r in lidos["BR"]}["evap_mm"][col["anos_lacuna"]] == "2022,2023"
        assert ab.conferir(base / "gold" / "clima", dados, idx) == {"linhas": 31, "grupos": 5}
        # determinístico: nova geração em outra pasta produz o MESMO pacote e índice
        saida2 = raiz / "saida2"
        ent2 = ab.gerar(base, saida2)
        assert ent2["arquivo"] == ent["arquivo"] and ent2["sha256"] == ent["sha256"] and ent2["indice"] == ent["indice"]
        # corrupção: um byte alterado, tamanho trocado, snapshot misturado, grupo trocado
        esperar("diferem do painel", lambda: ab.conferir(base / "gold" / "clima", dados.replace(b"100.5", b"100.6", 1), idx))
        esperar("tamanho total", lambda: ab.conferir(base / "gold" / "clima", dados + b"\n", idx))
        ruim = dict(idx, tamanhos=[idx["tamanhos"][0] + 1, idx["tamanhos"][1] - 1] + idx["tamanhos"][2:])
        try:
            ab.decodificar(dados, ruim)
            raise AssertionError("offset deslocado deveria falhar")
        except (ValueError, json.JSONDecodeError):
            pass
        esperar("não corresponde", lambda: ab.decodificar(dados, dict(idx, snapshot="000000000000")))
        esperar("não corresponde", lambda: ab.decodificar(dados, dict(idx, grupos=["XX", "BR"] + idx["grupos"][2:])))
        # painel que o manifesto não anuncia (hash diferente), sem painel anunciado, base incompleta
        m = json.loads((base / "gold" / "manifesto.json").read_text(encoding="utf-8"))
        m["fontes"]["clima"]["painel"]["sha256"] = "0" * 64
        (base / "gold" / "manifesto.json").write_text(json.dumps(m), encoding="utf-8")
        esperar("não corresponde ao que o manifesto anuncia", lambda: ab.gerar(base, raiz / "s3"))
        assert not (raiz / "s3").exists(), "criou pasta antes de validar"
        del m["fontes"]["clima"]["painel"]
        (base / "gold" / "manifesto.json").write_text(json.dumps(m), encoding="utf-8")
        esperar("não anuncia fontes.clima.painel", lambda: ab.gerar(base, raiz / "s4"))
        shutil.copy(raiz / "saida" / "gold" / "manifesto.json", base / "gold" / "manifesto.json")
        (base / "gold" / "clima" / "catalogo.parquet").unlink()
        esperar("base incompleta", lambda: ab.gerar(base, raiz / "s5"))
        assert not (raiz / "s5").exists()
        # destinos: saída sobre/dentro/contendo a base, e saída já existente sem --substituir; nada é criado
        for alvo in (base, base / "gold", base / "novo", raiz):
            esperar("sobre a base", lambda a=alvo: ab.gerar(base, a))
        assert not (base / "novo").exists()
        esperar("já existe", lambda: ab.gerar(base, saida))
        # objetos imutáveis: mesmo nome com outro conteúdo não é sobrescrito
        montar(raiz / "base2")
        (saida2 / "gold" / "clima" / ent["arquivo"].split("/")[-1]).write_bytes(b"adulterado")
        esperar("imutáveis", lambda: ab.gerar(raiz / "base2", saida2, substituir=True))
        testar_links(raiz, base2_ou(raiz, base), ent)
        print("ok: testes sintéticos do pacote de abertura")
        if "--real" in sys.argv:
            real = Path(sys.argv[sys.argv.index("--real") + 1])
            r = ab.gerar(real, raiz / "real")
            print("ok: base real", {k: r[k] for k in ("grupos", "bytes", "snapshot")})
    finally:
        print("pasta temporária mantida (sem delete recursivo):", raiz)


if __name__ == "__main__":
    main()
