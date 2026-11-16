/** Estado leve do progresso; a interface não importa o motor de consultas. */
const etapas = new Map<number, string>();
const ouvintesEtapa = new Set<() => void>();
let ultimaEtapa: string | null = null;
export function avisarEtapa(id: number, texto: string | null) {
  if (texto === null) etapas.delete(id);
  else etapas.set(id, texto);
  ultimaEtapa = [...etapas.values()].at(-1) ?? null;
  for (const f of ouvintesEtapa) f();
}
export const etapaAtual = () => ultimaEtapa;
export function aoMudarEtapa(f: () => void) {
  ouvintesEtapa.add(f);
  return () => void ouvintesEtapa.delete(f);
}
