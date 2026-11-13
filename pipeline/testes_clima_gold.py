"""gold_clima(): validação dos dois silver antes de escrever, preparo em diretório separado, troca atômica e saída candidata.
Dados sintéticos em pasta temporária; o gold real (E:/finbra/data) não é lido nem gravado.

Uso:  py pipeline/testes_clima_gold.py
"""
import json
import os
import subprocess
import tempfile
from pathlib import Path

import duckdb
import pandas as pd

import clima


def silver(pasta: Path, *, sem_era5=False, duplicar=False, nulo=False, defeituoso=False, sem_variavel=None, cod_extra=True) -> None:
    pasta.mkdir(parents=True, exist_ok=True)
    cods = [1000001, 1000002] + ([1000003] if cod_extra else [])
    linhas_chuva, linhas_era5 = [], []
    for cod in cods:
        for ano in range(1991, 2022):
            for mes in range(1, 13):
                linhas_chuva.append((cod, ano, mes, "chuva_mm", float(cod % 10 + mes)))
                for v in ("temperatura_c", "orvalho_c", "umid_solo_pct", "evap_mm", "radiacao_wm2"):
                    if v == sem_variavel:
                        continue
                    linhas_era5.append((cod, ano, mes, v, 20.0 + mes * 0.1))
    if defeituoso:
        linhas_era5.append((1000001, 2023, 1, "evap_mm", 20.0))  # mês defeituoso do ECMWF
    if duplicar:
        linhas_era5.append(linhas_era5[0])
    if nulo:
        linhas_era5[0] = (linhas_era5[0][0], linhas_era5[0][1], linhas_era5[0][2], linhas_era5[0][3], None)
    cols = ["cod", "ano", "mes", "variavel", "valor"]
    pd.DataFrame(linhas_chuva, columns=cols).astype({"valor": "float32"}).to_parquet(pasta / "chirps.parquet", index=False)
    if not sem_era5:
        pd.DataFrame(linhas_era5, columns=cols).astype({"valor": "float32"}).to_parquet(pasta / "era5.parquet", index=False)


def malha_falsa():
    return pd.DataFrame({"CD_MUN": ["1000001", "1000002", "1000003"], "NM_MUN": ["A", "B", "C"], "SIGLA_UF": ["XX", "XX", "YY"], "AREA_KM2": [100.0, 300.0, 50.0]})


def esperar_erro(f, trecho: str):
    try:
        f()
    except ValueError as e:
        assert trecho in str(e), str(e)
    else:
        raise AssertionError(f"aceitou: {trecho}")


def conteudo(pasta: Path) -> dict:
    return {p.name: p.read_bytes() for p in sorted(pasta.glob("*")) if p.is_file()}


with tempfile.TemporaryDirectory() as d:
    raiz = Path(d)
    clima.malha = malha_falsa
    clima.GOLD = raiz / "gold"
    clima.GOLD_C = clima.GOLD / "clima"
    clima.SILVER_C = raiz / "silver" / "clima"
    clima.GOLD.mkdir()
    (clima.GOLD / "manifesto.json").write_text(json.dumps({"fontes": {"outra": {"x": 1}, "clima": {"antigo": True, "painel": {"versao": 1}}}, "gerado_em": "antes"}), encoding="utf-8")
    manifesto0 = (clima.GOLD / "manifesto.json").read_bytes()

    # 1) silver ausente ou problemático: nada é criado nem escrito
    silver(clima.SILVER_C, sem_era5=True)
    esperar_erro(clima.gold_clima, "falta silver/clima/era5.parquet")
    assert not clima.GOLD_C.exists() and not (clima.GOLD / "clima.novo").exists()
    for kw, trecho in [({"duplicar": True}, "repetidas"), ({"nulo": True}, "nulo"), ({"defeituoso": True}, "defeituosos do ECMWF"), ({"sem_variavel": "radiacao_wm2"}, "variáveis ausentes")]:
        silver(clima.SILVER_C, **kw)
        esperar_erro(clima.gold_clima, trecho)
        assert not clima.GOLD_C.exists() and not (clima.GOLD / "clima.novo").exists(), kw
    assert (clima.GOLD / "manifesto.json").read_bytes() == manifesto0
    # cobertura de municípios muito diferente entre variáveis (silver parcial)
    silver(clima.SILVER_C)
    con = duckdb.connect()
    ruim = clima.SILVER_C / "era5.parquet"
    df = pd.read_parquet(ruim)
    df[~((df.variavel == "evap_mm") & (df.cod != 1000001))].to_parquet(ruim, index=False)  # evap só em 1 de 3 municípios
    esperar_erro(clima.gold_clima, "silver parcial")
    assert not clima.GOLD_C.exists()

    # 2) saída candidata: protege o gold real e não sobrescreve sem --substituir
    silver(clima.SILVER_C)
    for destino in (clima.GOLD, clima.GOLD / "dentro", raiz):
        esperar_erro(lambda destino=destino: clima.gold_clima(destino), "não pode tocar os dados de origem")
    assert not (clima.GOLD / "dentro").exists() and not clima.GOLD_C.exists()
    if os.name == "nt":
        # O nome da candidata é separado, mas um filho é uma junção para a origem.
        for nome, origem in (("gold", clima.GOLD), ("clima", clima.SILVER_C)):
            candidata = raiz / f"alias-{nome}"
            link = candidata / "gold" if nome == "gold" else candidata / "gold" / "clima"
            link.parent.mkdir(parents=True)
            q = lambda p: "'" + str(p).replace("'", "''") + "'"
            antes_alias = conteudo(origem)
            subprocess.run(["powershell", "-NoProfile", "-Command", f"New-Item -ItemType Junction -Path {q(link)} -Value {q(origem)} | Out-Null"], check=True)
            try:
                esperar_erro(lambda: clima.gold_clima(candidata, substituir=True), "não pode tocar os dados de origem")
                assert conteudo(origem) == antes_alias
            finally:
                assert link.parent.resolve().is_relative_to(raiz.resolve()) and os.path.isjunction(link)
                os.rmdir(link)  # remove apenas a junção, sem percorrer a origem
    saida = raiz / "candidato"
    clima.gold_clima(saida)
    arquivos = sorted(p.name for p in (saida / "gold" / "clima").iterdir())
    assert arquivos == sorted(f"{n}.parquet" for n in clima.ARQUIVOS_GOLD), arquivos
    man = json.loads((saida / "gold" / "manifesto.json").read_text(encoding="utf-8"))
    assert man["fontes"]["outra"] == {"x": 1}
    assert "painel" not in man["fontes"]["clima"] and man["fontes"]["clima"]["ate"] == 202112  # o resumo leve antigo deixa de ser anunciado
    assert sorted(man["fontes"]["clima"]["variaveis"]) == sorted(["chuva_mm", "temperatura_c", "orvalho_c", "umid_solo_pct", "evap_mm", "radiacao_wm2"])
    assert (clima.GOLD / "manifesto.json").read_bytes() == manifesto0 and not clima.GOLD_C.exists(), "o gold real foi tocado"
    esperar_erro(lambda: clima.gold_clima(saida), "use --substituir")
    clima.gold_clima(saida, substituir=True)
    assert not (saida / "gold" / "clima.novo").exists()

    # 3) valores: o agregado do Brasil é ponderado pela área (100, 300 e 50 km²), não média simples
    c = duckdb.connect()
    br = c.execute(f"SELECT valor FROM read_parquet('{(saida / 'gold/clima/agregado.parquet').as_posix()}') WHERE grupo = 'BR' AND ano = 2000 AND mes = 1 AND variavel = 'chuva_mm'").fetchone()[0]
    pesado = (1 * 100 + 2 * 300 + 3 * 50) / 450 + 1  # (cod % 10) + mes
    assert abs(br - pesado) < 1e-6, br
    anual = c.execute(f"SELECT count(*) FROM read_parquet('{(saida / 'gold/clima/anual.parquet').as_posix()}') WHERE variavel = 'evap_mm'").fetchone()[0]
    assert anual == 3 * 31

    # 4) geração no lugar: troca atômica e sem sobras; falha no meio deixa o destino como estava
    clima.gold_clima()
    assert sorted(p.name for p in clima.GOLD_C.iterdir()) == sorted(f"{n}.parquet" for n in clima.ARQUIVOS_GOLD)
    assert not (clima.GOLD / "clima.novo").exists()
    antes = conteudo(clima.GOLD_C)
    man_antes = (clima.GOLD / "manifesto.json").read_bytes()
    original = clima.malha
    clima.malha = lambda: (_ for _ in ()).throw(RuntimeError("malha indisponível"))
    try:
        clima.gold_clima()
    except RuntimeError:
        pass
    else:
        raise AssertionError("falha engolida")
    finally:
        clima.malha = original
    assert conteudo(clima.GOLD_C) == antes and (clima.GOLD / "manifesto.json").read_bytes() == man_antes and not (clima.GOLD / "clima.novo").exists()
    # sobra de uma geração interrompida: recusa em vez de misturar
    (clima.GOLD / "clima.novo").mkdir()
    esperar_erro(clima.gold_clima, "sobra de uma geração interrompida")
    assert conteudo(clima.GOLD_C) == antes
    manifesto_final = json.loads((clima.GOLD / "manifesto.json").read_text(encoding="utf-8"))
    assert "painel" not in manifesto_final["fontes"]["clima"]
print("testes_clima_gold: ok")
