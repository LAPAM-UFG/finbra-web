"""Coletores do clima: identidade do pedido, período aberto, troca segura e CHIRPS recente. Tudo em pasta temporária, com
NetCDF sintético e downloads simulados: nenhuma requisição real ao CDS ou ao CHC, nenhum arquivo de E:/ lido ou apagado.

Uso:  py pipeline/testes_clima_coleta.py
"""
import tempfile
import zipfile
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import xarray as xr

import clima_baixar as cb
import clima_era5 as ce

CONJ = "reanalysis-era5-land-monthly-means"


def pedido(ano: int, meses=range(1, 13), variaveis=("2m_temperature",)) -> dict:
    return {"product_type": "monthly_averaged_reanalysis", "variable": list(variaveis), "year": [str(ano)], "time": ["00:00"], "month": [f"{m:02d}" for m in meses]}


def nc(caminho: Path, ano: int, meses, zip_=False, valor: float = 1.0) -> Path:
    tempos = pd.to_datetime([f"{ano}-{m:02d}-01" for m in meses])
    ds = xr.Dataset({"t2m": (("valid_time", "latitude", "longitude"), np.full((len(tempos), 2, 2), valor))},
                    coords={"valid_time": tempos, "latitude": [0.0, -0.1], "longitude": [-50.0, -49.9]})
    caminho.parent.mkdir(parents=True, exist_ok=True)
    if not zip_:
        ds.to_netcdf(caminho)
    else:
        interno = caminho.parent / "membro.nc"
        ds.to_netcdf(interno)
        with zipfile.ZipFile(caminho, "w") as z:
            z.write(interno, "data_stream-mnth.nc")
        interno.unlink()
    return caminho


def falso(ano: int, meses, valor=1.0):
    """Downloader simulado: grava o NetCDF dos meses dados em vez de chamar o CDS."""
    chamadas = []

    def baixar(conjunto, ped, alvo):
        chamadas.append(alvo.name)
        nc(alvo, ano, meses, valor=valor)
        return True
    baixar.chamadas = chamadas
    return baixar


def sem_arquivos_extras(pasta: Path) -> None:
    sobras = [p.name for p in pasta.iterdir() if p.name.endswith((".novo", ".parte", ".parcial"))]
    assert not sobras, sobras


# 1) identidade: muda com variáveis, meses, conjunto e área; não muda com a ordem das chaves
a = pedido(2024)
assert ce.identidade(CONJ, a) == ce.identidade(CONJ, dict(reversed(list(a.items()))))
assert ce.identidade(CONJ, a) != ce.identidade(CONJ, pedido(2024, variaveis=("2m_temperature", "total_evaporation")))
assert ce.identidade(CONJ, a) != ce.identidade(CONJ, pedido(2024, meses=range(1, 7)))
assert ce.identidade(CONJ, a) != ce.identidade("outro-conjunto", a)
area0 = list(ce.AREA)
ce.AREA[0] = 7
ce.AREA[:] = area0
assert ce.meses_do_pedido(pedido(2024, meses=[1, 2])) == [(2024, 1), (2024, 2)]

# 2) período aberto: os últimos 4 meses (e o futuro) são preliminares
hoje = date(2026, 11, 13)
assert ce.periodo_aberto([(2026, 3)], hoje) is False  # mar/2026: fechado
assert ce.periodo_aberto([(2026, 7)], hoje) is True  # jul/2026: dentro da janela de 4 meses
assert ce.periodo_aberto([(2025, m) for m in range(1, 13)], hoje) is False  # 2025 fechado
assert ce.periodo_aberto([(2026, m) for m in range(1, 13)], hoje) is True  # ano corrente
assert ce.periodo_aberto([(2027, 1)], hoje) is True  # futuro

with tempfile.TemporaryDirectory() as d:
    raiz = Path(d)

    # 3) leitura da cobertura: NetCDF, ZIP de NetCDF e arquivo ilegível
    simples = nc(raiz / "a" / "2026.nc", 2026, range(1, 10))
    assert ce.meses_do_arquivo(simples) == {(2026, m) for m in range(1, 10)}
    zipado = nc(raiz / "z" / "2026-01.nc", 2026, range(1, 4), zip_=True)
    assert zipfile.is_zipfile(zipado)
    assert ce.meses_do_arquivo(zipado) == {(2026, 1), (2026, 2), (2026, 3)}
    lixo = raiz / "lixo.nc"
    lixo.write_bytes(b"isto nao e um netcdf")
    assert ce.meses_do_arquivo(lixo) is None

    # 4) decisões
    alvo = raiz / "m" / "2025.nc"
    assert ce.decidir(alvo, CONJ, pedido(2025), hoje) == ("baixar", "ausente")
    nc(alvo, 2025, range(1, 13))
    assert ce.decidir(alvo, CONJ, pedido(2025), hoje)[0] == "manter"  # legado fechado e completo
    nc(alvo, 2025, range(1, 10))
    assert ce.decidir(alvo, CONJ, pedido(2025), hoje)[0] == "baixar"  # legado fechado, mas incompleto (faltam meses)
    # legado do ano corrente: o período aberto NÃO pode ficar congelado (o 2026.nc com jan–set)
    corrente = nc(raiz / "m" / "2026.nc", 2026, range(1, 10))
    assert ce.decidir(corrente, CONJ, pedido(2026), hoje) == ("baixar", "arquivo sem registro e período aberto")
    lixo2 = raiz / "m" / "2024.nc"
    lixo2.write_bytes(b"truncado")
    assert ce.decidir(lixo2, CONJ, pedido(2024), hoje)[0] == "baixar"

    # 5) troca segura: primeiro download (sem arquivo) registra identidade e meses
    pasta = raiz / "seguro"
    alvo = pasta / "2026.nc"
    r = ce.baixar_seguro(CONJ, pedido(2026), alvo, falso(2026, range(1, 10)), hoje)
    assert r == "baixado"
    reg = ce.ler_registro(alvo)
    assert reg["identidade"] == ce.identidade(CONJ, pedido(2026)) and reg["meses"][0] == "2026-01" and len(reg["meses"]) == 9
    sem_arquivos_extras(pasta)
    # período aberto: nova execução traz outubro; o atual vira .anterior-AAAAMMDD e o novo assume
    assert ce.decidir(alvo, CONJ, pedido(2026), hoje) == ("baixar", "período aberto: conferir meses novos e revisões")
    antes_hash = ce.sha(alvo)
    r = ce.baixar_seguro(CONJ, pedido(2026), alvo, falso(2026, range(1, 11), valor=2.0), hoje)
    assert r == "baixado"
    assert ce.meses_do_arquivo(alvo) == {(2026, m) for m in range(1, 11)}
    backups = sorted(p for p in pasta.iterdir() if ".anterior-" in p.name)
    assert [p.name for p in backups] == ["2026.nc.anterior-20261113"]
    assert ce.sha(backups[0]) == antes_hash and len(ce.meses_do_arquivo(backups[0])) == 9  # o antigo foi preservado intacto
    sem_arquivos_extras(pasta)
    # conteúdo idêntico: nada é trocado e nenhum novo backup aparece
    atual = ce.sha(alvo)
    assert ce.baixar_seguro(CONJ, pedido(2026), alvo, falso(2026, range(1, 11), valor=2.0), hoje) == "igual"
    assert ce.sha(alvo) == atual and len([p for p in pasta.iterdir() if ".anterior-" in p.name]) == 1
    # download que falha: o atual não é tocado
    assert ce.baixar_seguro(CONJ, pedido(2026), alvo, lambda c, p, a: False, hoje) == "falhou"
    assert ce.sha(alvo) == atual
    # download que traz menos meses que o atual: rejeitado, o atual fica
    r = ce.baixar_seguro(CONJ, pedido(2026), alvo, falso(2026, range(1, 8), valor=3.0), hoje)
    assert r.startswith("rejeitado") and "perderia" in r, r
    assert ce.sha(alvo) == atual
    r = ce.baixar_seguro(CONJ, pedido(2026), alvo, falso(2026, range(1, 6), valor=3.0), hoje)  # faltam jun/2026, já fechado
    assert r.startswith("rejeitado") and "datas fechadas" in r, r
    assert ce.sha(alvo) == atual
    # download corrompido: rejeitado
    def corrompido(c, p, a):
        a.write_bytes(b"lixo")
        return True
    assert ce.baixar_seguro(CONJ, pedido(2026), alvo, corrompido, hoje).startswith("rejeitado")
    assert ce.sha(alvo) == atual
    sem_arquivos_extras(pasta)
    # ano fechado com meses faltando no download: rejeitado, e o anterior fica
    fechado = pasta / "2025.nc"
    nc(fechado, 2025, range(1, 13), valor=5.0)
    h = ce.sha(fechado)
    r = ce.baixar_seguro(CONJ, pedido(2025), fechado, falso(2025, range(1, 8)), hoje)
    assert r.startswith("rejeitado") and "datas fechadas" in r, r
    assert ce.sha(fechado) == h
    # meses não pedidos no arquivo novo: rejeitado
    r = ce.baixar_seguro(CONJ, pedido(2025, meses=[1, 2]), pasta / "x.nc", falso(2025, range(1, 5)), hoje)
    assert r.startswith("rejeitado") and "não foram pedidas" in r, r
    assert not (pasta / "x.nc").exists()

    # 6) pedido mudou: a identidade registrada manda baixar mesmo no período fechado
    fechado_ok = pasta / "2024.nc"
    assert ce.baixar_seguro(CONJ, pedido(2024), fechado_ok, falso(2024, range(1, 13)), hoje) == "baixado"
    assert ce.decidir(fechado_ok, CONJ, pedido(2024), hoje)[0] == "manter"  # fechado e idêntico: pula
    assert ce.decidir(fechado_ok, CONJ, pedido(2024, variaveis=("2m_temperature", "total_evaporation")), hoje)[0] == "baixar"  # outro pedido

    # 7) validação por variável e por data: o diário novo não pode perder dias nem variáveis; o mensal precisa de todas as variáveis pedidas
    import calendar as cal
    from unittest.mock import patch

    def nc_multi(caminho, datas, nomes, lat=(0.0, -0.1), lon=(-50.0, -49.9), coords=True):
        tempos = pd.to_datetime(list(datas))
        dados = {n: (("valid_time", "latitude", "longitude"), np.ones((len(tempos), len(lat), len(lon)))) for n in nomes}
        ds = xr.Dataset(dados, coords={"valid_time": tempos, "latitude": list(lat), "longitude": list(lon)} if coords else {"valid_time": tempos})
        caminho.parent.mkdir(parents=True, exist_ok=True)
        ds.to_netcdf(caminho)
        return caminho

    def dias(ano, mes, ate=None):
        return [f"{ano}-{mes:02d}-{d:02d}" for d in range(1, (ate or cal.monthrange(ano, mes)[1]) + 1)]

    def zip_de(caminho, membros):
        caminho.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(caminho, "w") as z:
            for nome, arq in membros:
                z.write(arq, nome)
        return caminho

    vd = ["2m_temperature", "total_evaporation"]
    pd_jan = {"variable": vd, "year": "2025", "month": ["01"], "day": [f"{d:02d}" for d in range(1, 32)], "daily_statistic": "daily_mean"}
    pasta7 = raiz / "v7"
    antigo = nc_multi(pasta7 / "antigo.nc", dias(2025, 1), ["t2m", "e"])
    # o caso do auditor: novo com 1 dia e só t2m, antigo com t2m+e
    ruim = nc_multi(pasta7 / "ruim.nc", ["2025-01-01"], ["t2m"])
    ok, motivo = ce.validar_novo(ruim, antigo, pd_jan, hoje)
    assert not ok and "faltam variáveis pedidas" in motivo, motivo
    # as duas variáveis, mas 'e' com só 20 dias de janeiro fechado
    incompleto = zip_de(pasta7 / "incompleto.nc", [("t2m.nc", nc_multi(pasta7 / "a.nc", dias(2025, 1), ["t2m"])), ("e.nc", nc_multi(pasta7 / "b.nc", dias(2025, 1, 20), ["e"]))])
    ok, motivo = ce.validar_novo(incompleto, None, pd_jan, hoje)
    assert not ok and "e: faltam 11 datas fechadas" in motivo, motivo
    # completo: aceito, também com os nomes longos do CDS
    bom = nc_multi(pasta7 / "bom.nc", dias(2025, 1), ["t2m", "e"])
    assert ce.validar_novo(bom, antigo, pd_jan, hoje) == (True, "ok")
    longo = nc_multi(pasta7 / "longo.nc", dias(2025, 1), ["2m_temperature", "total_evaporation"])
    assert ce.validar_novo(longo, None, pd_jan, hoje) == (True, "ok")
    # calendário: fevereiro de 2025 tem 28 dias; o pedido tem os dias 01 a 31 e só os 28 existentes são exigidos
    pd_fev = {**pd_jan, "month": ["02"]}
    assert ce.validar_novo(nc_multi(pasta7 / "fev.nc", dias(2025, 2), ["t2m", "e"]), None, pd_fev, hoje) == (True, "ok")
    ok, motivo = ce.validar_novo(nc_multi(pasta7 / "fev27.nc", dias(2025, 2, 27), ["t2m", "e"]), None, pd_fev, hoje)
    assert not ok and "faltam 1 datas" in motivo, motivo
    # período aberto: o novo não pode ter menos datas que o atual, por variável
    hoje_nov = date(2026, 11, 13)
    pd_out = {**pd_jan, "year": "2026", "month": ["11"]}
    velho = nc_multi(pasta7 / "velho.nc", dias(2026, 11, 10), ["t2m", "e"])
    menos = nc_multi(pasta7 / "menos.nc", dias(2026, 11, 5), ["t2m", "e"])
    ok, motivo = ce.validar_novo(menos, velho, pd_out, hoje_nov)
    assert not ok and "perderia" in motivo, motivo
    sem_e = nc_multi(pasta7 / "sem_e.nc", dias(2026, 11, 12), ["t2m"])
    ok, motivo = ce.validar_novo(sem_e, velho, pd_out, hoje_nov)
    assert not ok, motivo  # falta a variável pedida (e)
    mais = nc_multi(pasta7 / "mais.nc", dias(2026, 11, 12), ["t2m", "e"])
    assert ce.validar_novo(mais, velho, pd_out, hoje_nov) == (True, "ok")
    # grade diferente da do atual e arquivo sem coordenadas
    grade = nc_multi(pasta7 / "grade.nc", dias(2026, 11, 12), ["t2m", "e"], lat=(0.0, -0.1, -0.2))
    ok, motivo = ce.validar_novo(grade, velho, pd_out, hoje_nov)
    assert not ok and "grade diferente" in motivo, motivo
    sem_coord = nc_multi(pasta7 / "semcoord.nc", dias(2026, 11, 12), ["t2m", "e"], coords=False)
    assert ce.inspecionar(sem_coord) is None
    # ZIP diário real: 5 NetCDF (um por variável); com os 5 passa, sem um deles falha
    vars5 = ["t2m", "d2m", "swvl1", "u10", "v10"]
    pd5 = {**pd_jan, "variable": ["2m_temperature", "2m_dewpoint_temperature", "volumetric_soil_water_layer_1", "10m_u_component_of_wind", "10m_v_component_of_wind"]}
    membros = [(f"data_{v}.nc", nc_multi(pasta7 / "m" / f"{v}.nc", dias(2025, 1), [v])) for v in vars5]
    z5 = zip_de(pasta7 / "media.nc", membros)
    assert ce.validar_novo(z5, None, pd5, hoje) == (True, "ok")
    z4 = zip_de(pasta7 / "media4.nc", membros[:-1])
    ok, motivo = ce.validar_novo(z4, None, pd5, hoje)
    assert not ok and "v10" in motivo, motivo
    # membro com caminho malicioso: lido pelo nome-base em temporário, nada escrito fora dele
    trav = zip_de(pasta7 / "trav.nc", [("../../evil.nc", nc_multi(pasta7 / "m" / "t.nc", dias(2025, 1), ["t2m", "e"]))])
    assert ce.validar_novo(trav, None, pd_jan, hoje) == (True, "ok")
    assert not (raiz / "evil.nc").exists() and not (pasta7.parent / "evil.nc").exists() and not (pasta7 / "evil.nc").exists()
    assert ce._nome_seguro("../../x/evil.nc", 0) == "0_evil.nc" and ce._nome_seguro("..", 0) is None and ce._nome_seguro("dir/", 0) is None
    # mensal sem variável pedida: rejeitado
    pm = {"product_type": "monthly_averaged_reanalysis", "variable": ["2m_temperature", "total_evaporation"], "year": ["2025"], "month": [f"{m:02d}" for m in range(1, 13)], "time": ["00:00"]}
    so_t2m = nc_multi(pasta7 / "mensal_t2m.nc", [f"2025-{m:02d}-01" for m in range(1, 13)], ["t2m"])
    ok, motivo = ce.validar_novo(so_t2m, None, pm, hoje)
    assert not ok and "faltam variáveis pedidas" in motivo, motivo
    completo_m = nc_multi(pasta7 / "mensal_ok.nc", [f"2025-{m:02d}-01" for m in range(1, 13)], ["t2m", "e"])
    assert ce.validar_novo(completo_m, None, pm, hoje) == (True, "ok")

    # 8) registro com SHA-256: arquivo fechado truncado ou alterado depois do registro NÃO é 'manter'
    reg_alvo = raiz / "reg" / "2025.nc"
    todas = ["t2m", "d2m", "swvl1", "e", "pev", "ssrd"]
    pm6 = {**pm, "variable": ce.MENSAL}
    assert ce.baixar_seguro(CONJ, pm6, reg_alvo, lambda c, p, a: nc_multi(a, [f"2025-{m:02d}-01" for m in range(1, 13)], todas) is not None, hoje) == "baixado"
    assert ce.decidir(reg_alvo, CONJ, pm6, hoje) == ("manter", "fechado e idêntico ao registrado")
    inteiro = reg_alvo.read_bytes()
    reg_alvo.write_bytes(inteiro[: len(inteiro) // 2])
    acao, motivo = ce.decidir(reg_alvo, CONJ, pm6, hoje)
    assert acao == "baixar" and "diverge do registro" in motivo, (acao, motivo)
    reg_alvo.write_bytes(inteiro[:-1] + bytes([inteiro[-1] ^ 1]))  # mesmo tamanho, um bit trocado
    assert ce.decidir(reg_alvo, CONJ, pm6, hoje)[0] == "baixar"
    reg_alvo.write_bytes(inteiro)
    assert ce.decidir(reg_alvo, CONJ, pm6, hoje)[0] == "manter"

    # 9) instalação: o atual nunca sai do lugar; PermissionError na troca final deixa tudo como estava
    atual = raiz / "inst" / "2026.nc"
    hoje_d = date(2026, 11, 13)
    p_out = {**pm6, "year": ["2026"], "month": [f"{m:02d}" for m in range(1, 10)]}
    mk = lambda ate: (lambda c, p, a: nc_multi(a, [f"2026-{m:02d}-01" for m in range(1, ate + 1)], todas) is not None)  # noqa: E731
    assert ce.baixar_seguro(CONJ, p_out, atual, mk(9), hoje_d) == "baixado"
    bytes_antes = atual.read_bytes()
    registro_txt = ce.registro_de(atual).read_text(encoding="utf-8")
    p_out10 = {**p_out, "month": [f"{m:02d}" for m in range(1, 11)]}
    troca = ce.os.replace

    def falhar(src, dst):
        if str(src).endswith(".novo"):
            raise PermissionError("falha sintética na troca final")
        return troca(src, dst)
    with patch.object(ce.os, "replace", side_effect=falhar):
        assert ce.baixar_seguro(CONJ, p_out10, atual, mk(10), hoje_d) == "falhou"
    assert atual.exists() and atual.read_bytes() == bytes_antes
    assert ce.registro_de(atual).read_text(encoding="utf-8") == registro_txt
    assert not (atual.parent / "2026.nc.novo").exists() and not [p for p in atual.parent.iterdir() if ".anterior-" in p.name]
    # troca bem-sucedida em seguida: o backup é uma cópia do original e o novo entra
    assert ce.baixar_seguro(CONJ, p_out10, atual, mk(10), hoje_d) == "baixado"
    bk = [p for p in atual.parent.iterdir() if ".anterior-" in p.name]
    assert len(bk) == 1 and bk[0].read_bytes() == bytes_antes and ce.meses_do_arquivo(atual) == {(2026, m) for m in range(1, 11)}

    # 10) mensal() do ano corrente com 2026.nc parcial já existente e uma fonte que RECUSA meses futuros: nenhum pedido com meses futuros,
    # e a cobertura é ampliada até o que a fonte publica; se a fonte não publica nada novo, o atual fica
    ce.BRUTOS = raiz / "brutos"
    ano = 2026
    alvo_m = ce.BRUTOS / "mensal" / f"{ano}.nc"
    nc_multi(alvo_m, [f"{ano}-{m:02d}-01" for m in range(1, 10)], todas)  # legado parcial: jan–set, sem registro
    pedidos = []

    def fonte_ate(publicado):
        def f(conjunto, ped, alvo, **k):
            meses = [int(m) for m in ped["month"]]
            pedidos.append(max(meses))
            if max(meses) > publicado:  # o CDS recusa o mês que ainda não existe
                return False
            nc_multi(alvo, [f"{ano}-{m:02d}-01" for m in meses], todas)
            return True
        return f
    original = ce.pedir
    ce.cliente = lambda: (_ for _ in ()).throw(AssertionError("requisição real ao CDS"))
    try:
        ce.pedir = fonte_ate(10)
        ce.mensal(ano, hoje=date(2026, 11, 13))
        assert max(pedidos) <= 10, pedidos  # nem o mês em curso, nem meses futuros
        assert pedidos == [10], pedidos  # outubro é o último mês encerrado
        assert ce.meses_do_arquivo(alvo_m) == {(ano, m) for m in range(1, 11)}
        assert len([p for p in alvo_m.parent.iterdir() if ".anterior-" in p.name]) == 1
        assert not [p for p in alvo_m.parent.iterdir() if p.name.startswith(f"{ano}-")], "arquivos por mês não devem existir"
        h = ce.sha(alvo_m)
        pedidos.clear()
        ce.pedir = fonte_ate(9)  # a fonte só tem até setembro: tudo recusado ou rejeitado; o atual (jan–out) não é tocado
        ce.mensal(ano, hoje=date(2026, 11, 13))
        assert ce.sha(alvo_m) == h and max(pedidos) <= 10
        ce.mensal(2027, hoje=date(2026, 11, 13))  # ano futuro: nada
        pedidos.clear()
        ce.mensal(2027, hoje=date(2027, 1, 13))  # janeiro: nenhum mês encerrado no ano
        assert not pedidos
        # ano fechado: pede os 12 meses
        pedidos.clear()
        ce.pedir = lambda conjunto, ped, alvo, **k: (pedidos.append(len(ped["month"])), nc_multi(alvo, [f"2024-{m:02d}-01" for m in range(1, 13)], todas))[1] is not None
        ce.mensal(2024, hoje=date(2026, 11, 13))
        assert pedidos == [12]
    finally:
        ce.pedir = original


# 8) CHIRPS: arquivo recente é conferido por Last-Modified/ETag, não só por tamanho; o antigo fica por tamanho
assert cb.recente("chirps-v3.0.2026.09.tif", hoje) is True
assert cb.recente("chirps-v3.0.1995.03.tif", hoje) is False
with tempfile.TemporaryDirectory() as d:
    raiz = Path(d)
    tif = raiz / "chirps-v3.0.2026.09.tif"
    antigo = raiz / "chirps-v3.0.1995.03.tif"
    for arq in (tif, antigo):
        arq.write_bytes(b"II*\x00" + b"0" * 96)  # cabeçalho TIFF e 100 bytes
    remota = {"tamanho": 100, "modificado": "Mon, 02 Nov 2026 10:00:00 GMT", "etag": '"a"'}
    assert cb.decidir(antigo, remota, antigo.name, hoje) == "pular"  # antigo, mesmo tamanho: pula
    assert cb.decidir(antigo, {**remota, "tamanho": 101}, antigo.name, hoje) == "baixar"
    assert cb.decidir(tif, remota, tif.name, hoje) == "baixar"  # recente sem registro da versão: confere de novo
    cb.gravar_meta(tif, remota)
    assert cb.decidir(tif, remota, tif.name, hoje) == "pular"
    assert cb.decidir(tif, {**remota, "modificado": "Tue, 10 Nov 2026 08:00:00 GMT"}, tif.name, hoje) == "baixar"  # revisado com o mesmo tamanho
    assert cb.decidir(tif, {**remota, "etag": '"b"'}, tif.name, hoje) == "baixar"
    assert cb.decidir(raiz / "chirps-v3.0.2026.10.tif", remota, "chirps-v3.0.2026.10.tif", hoje) == "baixar"  # ausente
    assert cb.cabecalho_tiff_valido(tif) and not cb.cabecalho_tiff_valido(raiz / "ausente.tif")
    lixo = raiz / "lixo.tif"
    lixo.write_bytes(b"<html>erro</html>")
    assert not cb.cabecalho_tiff_valido(lixo)

    # troca atômica: o novo só entra se for TIFF; o antigo vira .anterior quando o conteúdo muda
    class Resp:
        def __init__(self, dados): self.dados, self.status_code, self.headers = dados, 200, {}
        def raise_for_status(self): pass
        def iter_content(self, n): yield self.dados
        def __enter__(self): return self
        def __exit__(self, *a): pass
    novo = b"II*\x00" + b"1" * 96
    ok = cb.trocar(tif, Resp(novo), 100, remota)
    assert ok and tif.read_bytes() == novo and (raiz / (tif.name + ".anterior")).read_bytes().startswith(b"II*\x000")
    antes = tif.read_bytes()
    assert not cb.trocar(tif, Resp(b"<html>erro</html>" + b"x" * 83), 100, remota)  # não é TIFF: o atual fica
    assert tif.read_bytes() == antes and not (raiz / (tif.name + ".parte")).exists()
    assert not cb.trocar(tif, Resp(novo[:50]), 100, remota)  # truncado (tamanho diferente do anunciado): o atual fica
    assert tif.read_bytes() == antes

    # 8b) falha na troca final ou na leitura da resposta: o destino e o registro ficam como estavam e o temporário some
    from unittest.mock import patch
    alvo2 = raiz / "chirps-v3.0.2026.08.tif"
    original_bytes = b"II*\x00" + b"A" * 96
    alvo2.write_bytes(original_bytes)
    cb.gravar_meta(alvo2, remota)
    meta_antes = cb.meta_de(alvo2).read_bytes()
    troca = cb.os.replace

    def falhar(src, dst):
        if str(src).endswith(".parte"):
            raise PermissionError("falha sintética na troca final")
        return troca(src, dst)
    with patch.object(cb.os, "replace", side_effect=falhar):
        try:
            cb.trocar(alvo2, Resp(b"II*\x00" + b"B" * 96), 100, remota)
        except PermissionError:
            pass
        else:
            raise AssertionError("a falha da troca final foi engolida")
    assert alvo2.exists() and alvo2.read_bytes() == original_bytes, "o destino sumiu ou mudou"
    assert cb.meta_de(alvo2).read_bytes() == meta_antes
    assert not (raiz / (alvo2.name + ".parte")).exists()

    class RespQuebrada(Resp):
        def iter_content(self, n):
            yield b"II*\x00" + b"C" * 10
            raise requests_exc("conexão caiu no meio")
    requests_exc = cb.requests.exceptions.ConnectionError
    try:
        cb.trocar(alvo2, RespQuebrada(b""), 100, remota)
    except cb.requests.exceptions.ConnectionError:
        pass
    else:
        raise AssertionError("a falha da leitura foi engolida")
    assert alvo2.read_bytes() == original_bytes and cb.meta_de(alvo2).read_bytes() == meta_antes
    assert not (raiz / (alvo2.name + ".parte")).exists()
    # troca bem-sucedida: o anterior é uma CÓPIA e o destino nunca ficou ausente
    assert cb.trocar(alvo2, Resp(b"II*\x00" + b"D" * 96), 100, remota)
    assert (raiz / (alvo2.name + ".anterior")).read_bytes() == original_bytes and alvo2.read_bytes().endswith(b"D" * 96)

print("testes_clima_coleta: ok")
