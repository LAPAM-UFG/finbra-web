"""Sincroniza as camadas de dados (data/bronze, silver, gold) com o bucket do Cloudflare R2.

Credenciais (variáveis de ambiente ou arquivo .env na raiz do projeto, fora do git):
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (padrão: lapam-finbra)

Uso:
    py pipeline/r2.py testar                     # confere as credenciais e lista o bucket
    py pipeline/r2.py enviar                     # envia bronze, silver e gold (só o que mudou)
    py pipeline/r2.py enviar --camadas gold
    py pipeline/r2.py enviar --camadas gold --limpar   # também apaga do bucket o que não existe mais localmente
    py pipeline/r2.py enviar --ignorar 'silver/lrf/*' gold/lrf.parquet   # sem os arquivos ainda incompletos
    py pipeline/r2.py enviar --raiz E:/finbra/micro --camadas silver   # microdados (no HD externo)
    py pipeline/r2.py baixar --camadas silver gold   # monta o data/ local a partir do R2 (sem os microdados)
    py pipeline/r2.py baixar --camadas silver --com-micro --raiz E:/finbra/micro
"""
import argparse
import hashlib
import os
from fnmatch import fnmatch
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

from config import DATA, ROOT
from versoes_dados import arquivar,publicar_indice

CAMADAS = ("bronze", "silver", "gold")
TRANSFERENCIA = TransferConfig(multipart_threshold=64 * 1024**2, multipart_chunksize=64 * 1024**2)


def carregar_env():
    """Lê ROOT/.env (KEY=VALOR por linha) sem sobrescrever variáveis já definidas."""
    arquivo = ROOT / ".env"
    if not arquivo.exists():
        return
    for linha in arquivo.read_text(encoding="utf-8").splitlines():
        linha = linha.strip()
        if linha and not linha.startswith("#") and "=" in linha:
            chave, _, valor = linha.partition("=")
            os.environ.setdefault(chave.strip(), valor.strip().strip('"').strip("'"))


def cliente():
    carregar_env()
    faltando = [v for v in ("R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY") if not os.environ.get(v)]
    if faltando:
        sys.exit(f"Faltam credenciais: {', '.join(faltando)}. Veja o .env.example na raiz do projeto.")
    s3 = boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
        config=Config(retries={"max_attempts": 8, "mode": "adaptive"}),
    )
    return s3, os.environ.get("R2_BUCKET", "lapam-finbra")


def md5(caminho):
    h = hashlib.md5()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1024 * 1024), b""):
            h.update(bloco)
    return h.hexdigest()


def remotos(s3, bucket, prefixo):
    """{chave: md5 guardado nos metadados} dos objetos sob o prefixo."""
    out = {}
    for pagina in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=prefixo):
        for obj in pagina.get("Contents", []):
            out[obj["Key"]] = obj
    return out


def enviar(s3, bucket, camadas, limpar=False, ignorar=(), raiz=DATA):
    locais = [p for c in camadas for p in sorted((raiz / c).rglob("*")) if p.is_file() and (
        p.suffix in (".parquet", ".csv", ".json") or
        (p.is_relative_to(raiz / "gold/saneamento") and p.suffix == ".ndjson") or
        (p.is_relative_to(raiz / "gold/comparacoes") and p.suffix == ".ndjson") or
        (p.is_relative_to(raiz / "gold/abertura") and p.suffix in (".bin", ".gz"))
    )]
    # caminhos que não sobem (ex.: dados ainda incompletos): padrões como silver/lrf/* ou gold/lrf.parquet
    locais = [p for p in locais if not any(fnmatch(p.relative_to(raiz).as_posix(), g) for g in ignorar)]
    existentes = {k: v for c in camadas for k, v in remotos(s3, bucket, f"{c}/").items()}
    if 'gold/manifesto.json'in existentes:
        import json
        from publicacao_lote import inventario
        antigo=s3.get_object(Bucket=bucket,Key='gold/manifesto.json',IfMatch=existentes['gold/manifesto.json']['ETag'])
        try:publicar_indice(s3,bucket,json.loads(antigo['Body'].read()),inventario(s3,bucket))
        finally:antigo['Body'].close()

    def um(caminho):
        chave = caminho.relative_to(raiz).as_posix()
        soma = md5(caminho)
        if chave in existentes and existentes[chave]["Size"] == caminho.stat().st_size:
            cabecalho = s3.head_object(Bucket=bucket, Key=chave)
            meta = cabecalho.get("Metadata", {})
            if meta.get("md5") == soma or (chave.startswith("gold/comparacoes/") and cabecalho.get("ETag") == '"' + soma + '"'):
                return "igual", chave, 0
        extras = {"Metadata": {"md5": soma}}
        if chave.startswith("gold/comparacoes/"):
            extras["CacheControl"] = "no-cache" if chave == "gold/comparacoes/manifesto.json" else "public, max-age=31536000, immutable"
        if chave in existentes:arquivar(s3,bucket,chave,existentes[chave]['ETag'])
        if chave=='gold/manifesto.json':
            import json
            from publicacao_lote import inventario
            previsto=inventario(s3,bucket);previsto[chave]=dict(bytes=caminho.stat().st_size,etag='"'+soma+'"')
            publicar_indice(s3,bucket,json.loads(caminho.read_bytes()),previsto)
        s3.upload_file(str(caminho), bucket, chave, Config=TRANSFERENCIA, ExtraArgs=extras)
        return "enviado", chave, caminho.stat().st_size

    # os .json (manifesto, índice dos microdados) apontam para os outros arquivos: sobem depois deles
    with ThreadPoolExecutor(max_workers=6) as pool:
        resultados = list(pool.map(um, [p for p in locais if p.suffix != ".json"]))
        resultados += list(pool.map(um, [p for p in locais if p.suffix == ".json" and p.relative_to(raiz).as_posix() not in ["gold/comparacoes/manifesto.json","gold/manifesto.json"]]))
    # O ponteiro das comparações só pode aparecer depois de todos os seus índices.
    resultados += [um(p) for p in locais if p.relative_to(raiz).as_posix() == "gold/comparacoes/manifesto.json"]
    resultados += [um(p) for p in locais if p.relative_to(raiz).as_posix() == "gold/manifesto.json"]
    enviados = [r for r in resultados if r[0] == "enviado"]
    for _, chave, tamanho in enviados:
        print(f"  enviado  {chave}  ({tamanho / 1e6:.1f} MB)")
    print(f"{len(enviados)} enviados, {len(resultados) - len(enviados)} já estavam iguais "
          f"({sum(r[2] for r in enviados) / 1e6:.1f} MB transferidos)")
    if limpar:
        locais_chaves = {c.relative_to(raiz).as_posix() for c in locais}
        sobrando = [k for k in existentes if k not in locais_chaves and not k.startswith('gold/versoes/')]
        for i in range(0, len(sobrando), 1000):
            s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in sobrando[i:i + 1000]]})
        for k in sobrando:
            print(f"  removido {k}")
        print(f"{len(sobrando)} arquivos removidos do bucket")


MICRO = "silver/trabalho/micro/"  # microdados da RAIS e do CAGED (~33 GB): só descem com --com-micro


def baixar(s3, bucket, camadas, com_micro=False, raiz=DATA, ignorar=()):
    objetos = {k: v for c in camadas for k, v in remotos(s3, bucket, f"{c}/").items()
               if (com_micro or not k.startswith(MICRO)) and not any(fnmatch(k, g) for g in ignorar)}

    def um(item):
        chave, obj = item
        destino = raiz / chave
        if destino.exists() and destino.stat().st_size == obj["Size"]:
            return 0
        destino.parent.mkdir(parents=True, exist_ok=True)
        s3.download_file(bucket, chave, str(destino), Config=TRANSFERENCIA)
        return obj["Size"]

    with ThreadPoolExecutor(max_workers=6) as pool:
        tamanhos = list(pool.map(um, objetos.items()))
    baixados = [t for t in tamanhos if t]
    print(f"{len(baixados)} arquivos baixados ({sum(baixados) / 1e6:.1f} MB), "
          f"{len(tamanhos) - len(baixados)} já estavam atualizados")


def testar(s3, bucket):
    total = remotos(s3, bucket, "")
    por_camada = {}
    for chave, obj in total.items():
        c = chave.split("/")[0]
        n, t = por_camada.get(c, (0, 0))
        por_camada[c] = (n + 1, t + obj["Size"])
    print(f"Conexão ok com o bucket '{bucket}': {len(total)} objetos")
    for c, (n, t) in sorted(por_camada.items()):
        print(f"  {c}: {n} arquivos, {t / 1e6:.1f} MB")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("acao", choices=["testar", "enviar", "baixar"])
    p.add_argument("--camadas", nargs="+", choices=CAMADAS, default=list(CAMADAS))
    p.add_argument("--limpar", action="store_true",
                   help="com enviar: apaga do bucket os arquivos dessas camadas que não existem localmente")
    p.add_argument("--ignorar", nargs="+", default=[], help="padrões de caminho que não são baixados nem enviados (ex.: 'silver/lrf/*')")
    p.add_argument("--raiz", type=Path, default=DATA,
                   help="pasta com as camadas (ex.: E:/finbra/micro para os microdados)")
    p.add_argument("--com-micro", action="store_true",
                   help=f"com baixar: inclui os microdados ({MICRO}, ~33 GB); use com --raiz no HD externo")
    args = p.parse_args()
    if args.limpar and args.ignorar:
        sys.exit("--limpar com --ignorar apagaria do bucket os arquivos ignorados; use um ou outro")
    if args.limpar and args.raiz != DATA:
        sys.exit("--limpar com --raiz apagaria do bucket os arquivos da data/ que não estão nessa pasta")
    s3, bucket = cliente()
    if args.acao == "testar":
        testar(s3, bucket)
    elif args.acao == "enviar":
        enviar(s3, bucket, args.camadas, args.limpar, args.ignorar, args.raiz)
    else:
        baixar(s3, bucket, args.camadas, args.com_micro, args.raiz, ignorar=args.ignorar)


if __name__ == "__main__":
    main()
