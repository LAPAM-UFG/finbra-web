"""Resumo leve do painel de clima: gold/clima/painel.parquet (uma linha por grupo × variável), sem recalcular o gold publicado.

Uso:  py pipeline/clima_painel.py --base <raiz-com-gold> --saida <pasta-candidata> [--substituir]

  --base    raiz que contém gold/clima/{mensal,anual,normal,agregado,territorio,catalogo}.parquet e gold/manifesto.json
            (por exemplo E:/finbra/data). É SOMENTE LEITURA: nada é gravado lá, e a saída não pode ser a base, estar dentro
            dela nem conter a base (conferido antes de criar qualquer pasta).
  --saida   pasta candidata, separada. Recebe gold/clima/painel.parquet, gold/clima/painel_indice.json e uma CÓPIA do
            manifesto com fontes.clima.painel; o manifesto da base não é tocado.

O que entra por linha (grupo = 'BR', sigla da UF ou código IBGE de 7 dígitos): último ano completo com valor, normal 1991–2020
e anomalia (tirados do anual e do agregado publicados, sem recalcular), anos que não fecham, último mês, o ano em curso
contra a normal dos mesmos meses e, só para chuva, os acumulados de 3, 6 e 12 meses com cobertura. A regra está em
web/src/clima_painel.sql, a mesma que o site usa quando o arquivo leve não existe. Brasil e UF mantêm a ponderação por área
do agregado; este script nunca faz média simples nem usa população.

O arquivo só é anunciado se os hashes dos seis gold de origem não mudaram durante a geração e se a conferência contra o anual
e o agregado passou. Se gold_clima() rodar de novo, ele reescreve fontes.clima sem o campo painel e o site volta ao cálculo direto.
"""
import argparse
import copy
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import duckdb

RAIZ = Path(__file__).resolve().parent.parent
SQL = RAIZ / "web" / "src" / "clima_painel.sql"
ORIGENS = ("mensal", "anual", "normal", "agregado", "territorio", "catalogo")
NOME = "painel.parquet"
INDICE = "painel_indice.json"
VERSAO = 1
NORMAL = (1991, 2020)


def sha(caminho) -> str:
    h = hashlib.sha256()
    with Path(caminho).open("rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def lit(caminho) -> str:
    return "'" + Path(caminho).as_posix().replace("'", "''") + "'"


def destinos(saida: Path) -> list[Path]:
    g = saida / "gold"
    c = g / "clima"
    alvos = [saida, g, c, g / "manifesto.json", c / NOME, c / INDICE]
    return alvos + [Path(str(x) + ".parcial") for x in (g / "manifesto.json", c / NOME, c / INDICE)]


def validar_destinos(base: Path, saida: Path, substituir: bool) -> None:
    """Falha ANTES de qualquer mkdir ou escrita: a saída não pode tocar a base, e não substitui nada sem --substituir."""
    b, s = base.resolve(), saida.resolve()
    for alvo in destinos(s):
        t = alvo.resolve()
        if t == b or t.is_relative_to(b) or b.is_relative_to(t):
            raise ValueError(f"destino sobre a base (somente leitura): {t}")
    if not substituir:
        for alvo in (s / "gold" / "clima" / NOME, s / "gold" / "clima" / INDICE, s / "gold" / "manifesto.json"):
            if alvo.exists():
                raise ValueError(f"destino já existe (use --substituir só em pasta candidata): {alvo}")


def entradas(c: Path) -> str:
    """CTEs de entrada do SQL compartilhado, sobre os parquet da base."""
    p = lambda n: lit(c / f"{n}.parquet")  # noqa: E731
    n0, n1 = NORMAL
    return f"""
a AS (
  SELECT CAST(cod AS VARCHAR) AS grupo, variavel, CAST(ano AS INTEGER) AS ano, CAST(valor AS DOUBLE) AS valor, CAST(normal AS DOUBLE) AS normal,
         CAST(anomalia_pct AS DOUBLE) AS anomalia_pct, CAST(anomalia AS DOUBLE) AS anomalia
  FROM read_parquet({p('anual')})
  UNION ALL
  SELECT g.grupo, g.variavel, CAST(g.ano AS INTEGER), CAST(g.valor AS DOUBLE), nn.normal, CAST(g.anomalia_pct AS DOUBLE), CAST(g.anomalia AS DOUBLE)
  FROM read_parquet({p('agregado')}) g
  JOIN (SELECT grupo, variavel, avg(valor) AS normal FROM read_parquet({p('agregado')})
        WHERE mes = 0 AND ano BETWEEN {n0} AND {n1} GROUP BY ALL) nn USING (grupo, variavel)
  WHERE g.mes = 0
),
s AS (
  SELECT CAST(cod AS VARCHAR) AS grupo, variavel, CAST(ano AS INTEGER) AS ano, CAST(mes AS INTEGER) AS mes, CAST(valor AS DOUBLE) AS valor
  FROM read_parquet({p('mensal')})
  UNION ALL
  SELECT grupo, variavel, CAST(ano AS INTEGER), CAST(mes AS INTEGER), CAST(valor AS DOUBLE) FROM read_parquet({p('agregado')}) WHERE mes > 0
),
n AS (
  SELECT CAST(cod AS VARCHAR) AS grupo, variavel, CAST(mes AS INTEGER) AS mes, CAST(normal AS DOUBLE) AS normal FROM read_parquet({p('normal')})
  UNION ALL
  SELECT grupo, variavel, CAST(mes AS INTEGER), avg(valor) FROM read_parquet({p('agregado')})
  WHERE mes > 0 AND ano BETWEEN {n0} AND {n1} GROUP BY ALL
),
agr AS (SELECT variavel, resumo_anual AS agregacao, anomalia AS tipo FROM read_parquet({p('catalogo')})),
"""


def consulta(c: Path) -> str:
    return "WITH " + entradas(c) + SQL.read_text(encoding="utf-8")


def conferir(con, c: Path, painel: Path) -> dict:
    """O arquivo gerado tem de reproduzir o publicado: último ano completo, normal e anomalia do anual e do agregado."""
    p = lambda n: lit(c / f"{n}.parquet")  # noqa: E731
    q = lambda sql: con.execute(sql).fetchall()  # noqa: E731
    pn = lit(painel)
    esperado = q(f"""SELECT (SELECT count(*) FROM (SELECT DISTINCT cod, variavel FROM read_parquet({p('anual')})))
                          + (SELECT count(*) FROM (SELECT DISTINCT grupo, variavel FROM read_parquet({p('agregado')}) WHERE mes = 0))""")[0][0]
    linhas = q(f"SELECT count(*) FROM read_parquet({pn})")[0][0]
    if linhas != esperado:
        raise ValueError(f"linhas do painel ({linhas}) diferem dos grupos × variáveis publicados ({esperado})")
    if q(f"SELECT count(*) FROM (SELECT grupo, variavel FROM read_parquet({pn}) GROUP BY ALL HAVING count(*) > 1)")[0][0]:
        raise ValueError("grupo × variável duplicado no painel")
    dif = q(f"""SELECT count(*) FROM read_parquet({pn}) x JOIN read_parquet({p('anual')}) a
                ON x.grupo = CAST(a.cod AS VARCHAR) AND x.variavel = a.variavel AND x.ano_ate = a.ano
                WHERE abs(x.valor - a.valor) > 1e-9 OR abs(x.normal - a.normal) > 1e-9
                   OR coalesce(abs(x.anomalia_pct - a.anomalia_pct), 0) > 1e-9 OR coalesce(abs(x.anomalia - a.anomalia), 0) > 1e-9
                   OR (x.anomalia_pct IS NULL) <> (a.anomalia_pct IS NULL) OR (x.anomalia IS NULL) <> (a.anomalia IS NULL)""")[0][0]
    if dif:
        raise ValueError(f"{dif} linhas municipais divergem do anual publicado")
    dif = q(f"""SELECT count(*) FROM read_parquet({pn}) x JOIN read_parquet({p('agregado')}) g
                ON x.grupo = g.grupo AND x.variavel = g.variavel AND x.ano_ate = g.ano AND g.mes = 0
                WHERE abs(x.valor - g.valor) > 1e-9
                   OR (x.anomalia_pct IS NULL) <> (g.anomalia_pct IS NULL) OR (x.anomalia IS NULL) <> (g.anomalia IS NULL)
                   OR coalesce(abs(x.anomalia_pct - g.anomalia_pct), 0) > 1e-9 OR coalesce(abs(x.anomalia - g.anomalia), 0) > 1e-9""")[0][0]
    if dif:
        raise ValueError(f"{dif} linhas de UF/Brasil divergem do agregado publicado")
    # acumulados só com todos os meses; só chuva; ausência nunca vira zero
    if q(f"""SELECT count(*) FROM read_parquet({pn}) WHERE variavel <> 'chuva_mm' AND (acum3_cob IS NOT NULL OR acum12_valor IS NOT NULL)""")[0][0]:
        raise ValueError("acumulado fora da chuva")
    if q(f"""SELECT count(*) FROM read_parquet({pn}) WHERE (acum3_valor IS NOT NULL AND acum3_cob <> 3) OR (acum6_valor IS NOT NULL AND acum6_cob <> 6)
                    OR (acum12_valor IS NOT NULL AND acum12_cob <> 12)""")[0][0]:
        raise ValueError("acumulado sem todos os meses")
    return {"linhas": linhas, "grupos": q(f"SELECT count(DISTINCT grupo) FROM read_parquet({pn})")[0][0]}


def gerar(base, saida, substituir: bool = False) -> dict:
    base, saida = Path(base), Path(saida)
    validar_destinos(base, saida, substituir)
    c = base / "gold" / "clima"
    faltam = [n for n in ORIGENS if not (c / f"{n}.parquet").exists()]
    if faltam or not (base / "gold" / "manifesto.json").exists():
        raise ValueError(f"base incompleta (gold/clima e manifesto): {faltam}")
    manifesto = json.loads((base / "gold" / "manifesto.json").read_text(encoding="utf-8"))
    clima = manifesto.get("fontes", {}).get("clima")
    if not clima:
        raise ValueError("o manifesto da base não tem fontes.clima")
    origem = {n: sha(c / f"{n}.parquet") for n in ORIGENS}
    out = saida / "gold" / "clima"
    out.mkdir(parents=True, exist_ok=True)
    temp = out / (NOME + ".parcial")
    con = duckdb.connect(config={"threads": 2, "memory_limit": "3GB"})
    try:
        ate = con.execute(f"SELECT max(ano * 100 + mes) FROM read_parquet({lit(c / 'mensal.parquet')})").fetchone()[0]
        if clima.get("ate") != ate:
            raise ValueError(f"manifesto (ate={clima.get('ate')}) não corresponde ao mensal ({ate})")
        # ordenado por grupo e variável, em grupos pequenos: o navegador lê só o trecho do recorte pedido (Range)
        con.execute(f"COPY ({consulta(c)} ORDER BY r.grupo, r.variavel) TO {lit(temp)} (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 1200)")
        resumo = conferir(con, c, temp)
    except Exception:
        temp.unlink(missing_ok=True)
        raise
    finally:
        con.close()
    if any(sha(c / f"{n}.parquet") != h for n, h in origem.items()):
        temp.unlink(missing_ok=True)
        raise ValueError("a origem mudou durante a geração; nada foi anunciado")
    os.replace(temp, out / NOME)
    agora = datetime.now(timezone.utc).isoformat(timespec="seconds")
    indice = {"versao": VERSAO, "gerado_em": agora, "sql_sha256": sha(SQL), "normal": list(NORMAL), "origem": origem,
              "arquivo": {"nome": NOME, "sha256": sha(out / NOME), "bytes": (out / NOME).stat().st_size, **resumo}}
    guardar(out / INDICE, indice)
    novo = copy.deepcopy(manifesto)
    # A versão dos URLs HTTP vem de gerado_em: o resumo novo precisa invalidar o cache anterior.
    novo["gerado_em"] = agora
    novo["fontes"]["clima"]["painel"] = {"versao": VERSAO, "arquivo": f"gold/clima/{NOME}", "indice": f"gold/clima/{INDICE}",
                                         "sha256": indice["arquivo"]["sha256"], "linhas": resumo["linhas"], "ate": ate, "processado_em": agora}
    guardar(saida / "gold" / "manifesto.json", novo)
    return indice


def guardar(caminho: Path, dados: dict) -> None:
    parcial = Path(str(caminho) + ".parcial")
    parcial.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(parcial, caminho)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", required=True)
    ap.add_argument("--saida", required=True)
    ap.add_argument("--substituir", action="store_true", help="permite sobrescrever uma saída candidata anterior")
    a = ap.parse_args()
    r = gerar(a.base, a.saida, a.substituir)
    print(json.dumps(r["arquivo"], ensure_ascii=False))


if __name__ == "__main__":
    main()
