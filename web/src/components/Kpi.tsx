export function Kpi({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="kpi">
      <div className="rotulo">{rotulo}</div>
      <div className="valor">{valor}</div>
      {nota && <div className="nota">{nota}</div>}
    </div>
  );
}

export function Estado({ carregando, erro, vazio }: { carregando?: boolean; erro?: string; vazio?: boolean }) {
  if (carregando) return <p className="carregando">Carregando…</p>;
  if (erro) return <p className="vazio erro">Erro: {erro}</p>;
  if (vazio) return <p className="vazio">Sem dados para este filtro.</p>;
  return null;
}
