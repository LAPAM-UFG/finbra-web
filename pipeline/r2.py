"""Sincroniza as camadas de dados (data/bronze, silver, gold) com o bucket do Cloudflare R2.

Credenciais (variáveis de ambiente ou arquivo .env na raiz do projeto, fora do git):
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (padrão: lapam-finbra)

Uso:
    py pipeline/r2.py testar                     # confere as credenciais e lista o bucket
    py pipeline/r2.py enviar                     # envia bronze, silver e gold (só o que mudou)
    py pipeline/r2.py enviar --camadas gold
    py pipeline/r2.py enviar --camadas gold --limpar   # também apaga do bucket o que não existe mais localmente
    py pipeline/r2.py baixar --camadas silver gold   # monta o data/ local a partir do R2
"""
import argparse
import hashlib
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import boto3
from boto3.s3.transfer import TransferConfig
from botocore.config import Config

from config import DATA, ROOT

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


def enviar(s3, bucket, camadas, limpar=False):
    locais = [p for c in camadas for p in sorted((DATA / c).rglob("*")) if p.is_file() and p.suffix in (".parquet", ".csv", ".json")]
    existentes = {k: v for c in camadas for k, v in remotos(s3, bucket, f"{c}/").items()}

    def um(caminho):
        chave = caminho.relative_to(DATA).as_posix()
        soma = md5(caminho)
        if chave in existentes and existentes[chave]["Size"] == caminho.stat().st_size:
            meta = s3.head_object(Bucket=bucket, Key=chave).get("Metadata", {})
            if meta.get("md5") == soma:
                return "igual", chave, 0
        s3.upload_file(str(caminho), bucket, chave, Config=TRANSFERENCIA, ExtraArgs={"Metadata": {"md5": soma}})
        return "enviado", chave, caminho.stat().st_size

    with ThreadPoolExecutor(max_workers=6) as pool:
        resultados = list(pool.map(um, locais))
    enviados = [r for r in resultados if r[0] == "enviado"]
    for _, chave, tamanho in enviados:
        print(f"  enviado  {chave}  ({tamanho / 1e6:.1f} MB)")
    print(f"{len(enviados)} enviados, {len(resultados) - len(enviados)} já estavam iguais "
          f"({sum(r[2] for r in enviados) / 1e6:.1f} MB transferidos)")
    if limpar:
        locais_chaves = {c.relative_to(DATA).as_posix() for c in locais}
        sobrando = [k for k in existentes if k not in locais_chaves]
        for i in range(0, len(sobrando), 1000):
            s3.delete_objects(Bucket=bucket, Delete={"Objects": [{"Key": k} for k in sobrando[i:i + 1000]]})
        for k in sobrando:
            print(f"  removido {k}")
        print(f"{len(sobrando)} arquivos removidos do bucket")


def baixar(s3, bucket, camadas):
    objetos = {k: v for c in camadas for k, v in remotos(s3, bucket, f"{c}/").items()}

    def um(item):
        chave, obj = item
        destino = DATA / chave
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
    args = p.parse_args()
    s3, bucket = cliente()
    if args.acao == "testar":
        testar(s3, bucket)
    elif args.acao == "enviar":
        enviar(s3, bucket, args.camadas, args.limpar)
    else:
        baixar(s3, bucket, args.camadas)


if __name__ == "__main__":
    main()
