"""Proteções e escrita atômica da carga candidata de Assistência social."""
import json
import os
from pathlib import Path


def destino_isolado(saida: Path, base: Path | None = None) -> Path:
    target = saida.expanduser().resolve()
    protected = [Path(__file__).resolve().parent.parent, Path('E:/finbra/data'),
                 Path('D:/LVBERNARDELLI/Dropbox/Meu Drive/ARTIGOS CIENTÍFICOS/Current/Artigo 261 - DashFin/finbra-web')]
    if base is not None:
        protected.append(base)
    for entry in protected:
        source = entry.resolve()
        if target == source or target.is_relative_to(source) or source.is_relative_to(target):
            raise ValueError(f'Destino deve ser isolado da origem: {target}')
    # Um candidato separado também não pode conter uma junction que redirecione a escrita para outra árvore.
    paths = [target/'gold/manifesto.json']
    for layer in ['gold','silver','landing']:
        parent=target/layer
        paths.extend([parent,parent/'assistencia'])
        if (parent/'assistencia').exists():
            paths.extend((parent/'assistencia').iterdir())
    for path in paths:
        resolved=path.resolve()
        if not resolved.is_relative_to(target):
            raise ValueError(f'Destino redirecionado para fora do candidato: {path}')
    return target


def salvar_json(path: Path, value) -> None:
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False), encoding='utf-8')
    os.replace(temporary, path)


def sql_texto(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"
