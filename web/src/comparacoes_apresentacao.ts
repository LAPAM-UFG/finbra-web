import type {
  AreaComparacao,
  DefComparacao,
  GeografiaComparacao,
  LinhaComparacao,
  SerieComparacao,
} from "./comparacoes_dados";
import { idioma, local, t } from "./idioma";
import { nomeDaUf } from "./ufs";

export const normComparacao = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export const textoComparacao = (i: DefComparacao, campo: string) =>
  String(
    (i as unknown as Record<string, unknown>)[
      campo + (idioma() === "en" ? "_en" : "")
    ] ??
      (i as unknown as Record<string, unknown>)[campo] ??
      "",
  );
export const periodoComparacao = (p: number) =>
  !p
    ? t("sem período disponível", "no available period")
    : p > 10000
      ? `${String(p % 100).padStart(2, "0")}/${Math.floor(p / 100)}`
      : String(p);
export function formatoComparacao(
  i: DefComparacao,
  v: number | null,
  municipio = false,
): string {
  if (v === null) return "—";
  if (i.binario && municipio)
    return v === 100 ? t("Sim", "Yes") : v === 0 ? t("Não", "No") : "—";
  const percentual = i.formato === "percentual" || i.unidade === "%";
  if (percentual && v > 99.99 && v < 100)
    return ">" + (99.99).toLocaleString(local()) + "%";
  if (percentual && v > 100 && v < 100.01) return ">100%";
  if (v !== 0 && Math.abs(v) < (i.formato === "indice" ? 0.001 : 0.01))
    return (
      v.toLocaleString(local(), { maximumSignificantDigits: 2 }) +
      (percentual ? "%" : "")
    );
  return (
    v.toLocaleString(local(), {
      minimumFractionDigits: i.formato === "indice" ? 3 : 1,
      maximumFractionDigits: i.formato === "indice" ? 3 : 2,
    }) + (i.formato === "percentual" || i.unidade === "%" ? "%" : "")
  );
}
const condicoes: Record<number, [string, string]> = {
  0: ["Registrado", "Recorded"],
  1: ["Zero registrado", "Recorded zero"],
  2: ["Sem registro", "No record"],
  3: ["Denominador ou normal ausente", "Missing denominator or normal"],
  4: ["Denominador zero", "Zero denominator"],
  5: ["Fora da cobertura / não se aplica", "Outside coverage / not applicable"],
  6: ["Preliminar", "Preliminary"],
  7: ["Sem edição da avaliação", "No assessment edition"],
  8: ["Ressalva do Inep", "Flagged by Inep"],
  9: ["Inconsistente", "Inconsistent"],
  10: ["Sem módulo publicado", "No published module"],
  11: ["Ano ou valor parcial", "Partial year or value"],
  12: ["Quebra de série da RAIS", "RAIS series break"],
  13: ["Sem remuneração válida", "No valid pay"],
  14: ["Sem vínculos na categoria", "No jobs in this category"],
  15: ["Remuneração não publicada", "Pay not published"],
  16: ["Cobertura incompleta", "Incomplete coverage"],
  17: ["Resposta fora do previsto", "Unexpected response"],
  18: ["Ressalva de qualidade fiscal", "Fiscal data quality flag"],
  20: [
    "Protegido ou não informado pela fonte",
    "Protected or not reported by source",
  ],
  21: [
    "Valor real ou IPCA indisponível nesta edição",
    "Real amount or IPCA unavailable in this edition",
  ],
};
export const condicaoComparacao = (c: number) =>
  t(...(condicoes[c] ?? [String(c), String(c)]));
export const comRessalvaComparacao = (c: number) => c === 8 || c === 18;
export const efetivoComparacao = (
  v: number | null,
  c: number,
  ressalvas: boolean,
) => (!ressalvas && comRessalvaComparacao(c) ? null : v);
export function serieEfetivaComparacao(
  s: SerieComparacao,
  ressalvas: boolean,
): SerieComparacao {
  const x = ressalvas && s.com_ressalvas ? s.com_ressalvas : s;
  return {
    ...x,
    v: x.v.map((v, k) => efetivoComparacao(v, x.c[k], ressalvas)),
  };
}
export function nomeTerritorioComparacao(
  g: GeografiaComparacao,
  chave: string,
): string {
  const x = g.territorios[chave];
  if (!x) return chave;
  if (x.nivel === "M")
    return (
      `${x.nome} (${x.uf})` +
      (Number(x.cod) === 2605459
        ? t(" · distrito estadual", " · state district")
        : "")
    );
  if (x.nivel === "imediata")
    return t("Região imediata: ", "Immediate region: ") + x.nome;
  if (x.nivel === "intermediaria")
    return t("Região intermediária: ", "Intermediate region: ") + x.nome;
  if (x.nivel === "UF") return t("Estado: ", "State: ") + nomeDaUf(chave);
  return chave === "BR"
    ? t("Brasil", "Brazil")
    : chave === "E:BR"
      ? t(
          "Governos estaduais e do DF",
          "State and Federal District governments",
        )
      : x.nome;
}
export function referenciasComparacao(
  g: GeografiaComparacao,
  chave: string,
): string[] {
  const x = g.territorios[chave];
  if (!x) return [];
  if (x.nivel === "E") return ["E:BR"];
  if (x.nivel === "E_BR" || chave === "BR") return [];
  const municipio =
    !x.intermediaria && x.nivel === "imediata"
      ? g.municipios.find((m) => `I:${m[3]}` === chave)
      : undefined;
  const intermediaria =
    x.intermediaria ?? (municipio ? `T:${municipio[4]}` : undefined);
  return [
    ...new Set(
      [x.imediata, intermediaria, x.uf, "BR"].filter(
        (k): k is string => !!k && k !== chave,
      ),
    ),
  ];
}
export function variacaoComparacao(
  i: DefComparacao,
  antes: number | null,
  depois: number | null,
  municipio = false,
  comparavel = true,
) {
  if (!comparavel)
    return {
      diferenca: null,
      relativa: null,
      texto: t(
        "Período parcial: diferença não calculada",
        "Partial period: difference not calculated",
      ),
    };
  if (antes === null || depois === null)
    return {
      diferenca: null,
      relativa: null,
      texto: t("Sem par comparável", "No comparable pair"),
    };
  if (i.binario && municipio)
    return {
      diferenca: null,
      relativa: null,
      texto: `${formatoComparacao(i, antes, true)} → ${formatoComparacao(i, depois, true)}`,
    };
  const diferenca = depois - antes;
  // Base negativa não admite uma variação percentual intuitiva (saldo CAGED,
  // temperatura e anomalias). A diferença continua visível na unidade correta.
  const percentual =
    i.formato === "percentual" || i.unidade === "%" || i.binario;
  const relativa =
    antes > 0 && depois >= 0 && !percentual && i.tema !== "Clima anual"
      ? (diferenca / antes) * 100
      : null;
  const unidade = percentual ? t("p.p.", "pp") : textoComparacao(i, "unidade");
  return {
    diferenca,
    relativa,
    texto: `${diferenca > 0 ? "+" : ""}${diferenca.toLocaleString(local(), { maximumFractionDigits: 2 })} ${unidade}`,
  };
}
export function periodosComparaveis(
  i: DefComparacao,
  inicio: number,
  fim: number,
  condAntes?: number,
  condDepois?: number,
) {
  return (
    condAntes !== 11 &&
    condDepois !== 11 &&
    !(
      i.id.startsWith("caged_") &&
      (i.notas_anos?.[String(inicio)] || i.notas_anos?.[String(fim)])
    )
  );
}
export function rupturaComparacao(
  area: AreaComparacao,
  i: DefComparacao,
  antes: number,
  depois: number,
  parcial = false,
): "parcial" | "metodo" | null {
  if (
    i.frequencia === "anual" &&
    (parcial || !periodosComparaveis(i, antes, depois))
  )
    return "parcial";
  if (
    (area === "saneamento" && antes <= 2022 && depois >= 2023) ||
    (area === "trabalho" &&
      !i.id.startsWith("caged_") &&
      [2022, 2023].some((ano) => antes < ano && depois >= ano))
  )
    return "metodo";
  return null;
}
export function ranquearComparacao(
  linhas: LinhaComparacao[],
  ordem: "maior" | "menor",
  ressalvas: boolean,
  minimo = 0,
) {
  const valido = (x: LinhaComparacao) =>
    efetivoComparacao(x.v, x.c, ressalvas) !== null &&
    !(minimo > 0 && (x.d === null || x.d < minimo));
  const com = linhas
    .filter(valido)
    .sort(
      (a, b) => (ordem === "maior" ? -1 : 1) * (a.v! - b.v!) || a.cod - b.cod,
    );
  let posicao = 0;
  return {
    com: com.map((x, k) => {
      if (k === 0 || x.v !== com[k - 1].v) posicao = k + 1;
      return { ...x, posicao };
    }),
    sem: linhas.filter((x) => !valido(x)),
  };
}
