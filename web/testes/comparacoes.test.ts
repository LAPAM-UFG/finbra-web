import test from "node:test";
import assert from "node:assert/strict";
import {
  condicaoComparacao,
  efetivoComparacao,
  formatoComparacao,
  ranquearComparacao,
  referenciasComparacao,
  serieEfetivaComparacao,
  variacaoComparacao,
  periodosComparaveis,
  rupturaComparacao,
  pontePontilhadaRais,
} from "../src/comparacoes_apresentacao";
test('pontilhado da RAIS preserva lacunas, valores negativos e anos sem quebra', () => {
  assert.equal(pontePontilhadaRais(2021,2022,100,120),true);
  assert.equal(pontePontilhadaRais(2022,2023,-5,0),true);
  assert.equal(pontePontilhadaRais(2021,2022,null,120),false);
  assert.equal(pontePontilhadaRais(2022,2023,120,null),false);
  assert.equal(pontePontilhadaRais(2021,2023,100,150),false);
  assert.equal(pontePontilhadaRais(2023,2024,100,150),false);
});
test("fluxo anual parcial não é apresentado como crescimento contra um ano completo", () => {
  const d = {
    id: "caged_saldo",
    notas_anos: {
      "2026": ["Ano parcial: 9/12 meses", "Partial year: 9/12 months"],
    },
  } as DefComparacao;
  assert.equal(periodosComparaveis(d, 2025, 2026), false);
  assert.equal(periodosComparaveis(d, 2024, 2025), true);
  assert.equal(variacaoComparacao(d, 100, 50, false, false).diferenca, null);
});
import {
  validarSerieComparacao,
  fontesGlobaisCompativeis,
  type DefComparacao,
  type GeografiaComparacao,
  type LinhaComparacao,
} from "../src/comparacoes_dados";

test("atualização fiscal, ordem das chaves e datas de processamento não invalidam outra área", () => {
  const fontes = {
    rais: { anos: [2024], processado_em: "antes" },
    caged: { ate: 202609 },
    rais_perfis: {
      indice: { caminho: "gold/perfil.json", sha256: "original" },
    },
  };
  const ref = {
    fontes: Object.keys(fontes),
    json_referencia: JSON.stringify(fontes),
  };
  const atual = {
    gerado_em: "depois",
    base_ipca: 2026,
    fontes: {
      siconfi: { anos: [2025] },
      rais_perfis: fontes.rais_perfis,
      caged: fontes.caged,
      rais: { processado_em: "depois", anos: [2024] },
    },
  };
  assert.equal(fontesGlobaisCompativeis(atual, ref), true);
  assert.equal(
    fontesGlobaisCompativeis(
      {
        ...atual,
        fontes: {
          ...atual.fontes,
          rais_perfis: {
            indice: { caminho: "gold/perfil.json", sha256: "novo" },
          },
        },
      },
      ref,
    ),
    false,
  );
});

test("fonte ausente e referência de compatibilidade inválida continuam recusadas", () => {
  const ref = {
    fontes: ["assistencia"],
    json_referencia: JSON.stringify({
      assistencia: { versao: 1, abertura: { sha256: "original" } },
    }),
  };
  assert.equal(fontesGlobaisCompativeis({ fontes: {} }, ref), false);
  assert.equal(
    fontesGlobaisCompativeis(
      { fontes: {} },
      { fontes: [], json_referencia: "{}" },
    ),
    false,
  );
  assert.equal(
    fontesGlobaisCompativeis(
      { fontes: {} },
      { ...ref, json_referencia: "truncado" },
    ),
    false,
  );
});

test("o gráfico separa anos parciais e aplica as quebras da RAIS somente à RAIS", () => {
  const caged = {
    id: "caged_saldo",
    frequencia: "anual",
    notas_anos: { "2026": ["8/12 meses", "8/12 months"] },
  } as DefComparacao;
  const rais = { id: "por_mil", frequencia: "anual" } as DefComparacao;
  assert.equal(rupturaComparacao("trabalho", caged, 2021, 2022), null);
  assert.equal(rupturaComparacao("trabalho", rais, 2021, 2022), "metodo");
  assert.equal(rupturaComparacao("trabalho", caged, 2025, 2026), "parcial");
  assert.equal(
    rupturaComparacao("financas", rais, 2024, 2025, true),
    "parcial",
  );
  assert.equal(rupturaComparacao("saneamento", rais, 2022, 2024), "metodo");
});

const i = {
  id: "t",
  nome: "Taxa",
  nome_en: "Rate",
  formato: "percentual",
  unidade: "%",
  unidade_en: "%",
} as DefComparacao;
const linha = (
  cod: number,
  v: number | null,
  c = 0,
  d = 100,
): LinhaComparacao => ({
  cod,
  nome: String(cod),
  uf: "GO",
  imediata: "I:520001",
  intermediaria: "T:5201",
  v,
  n: v,
  d,
  c,
  r: v,
});
test("diferença de percentuais usa pontos percentuais, não crescimento percentual", () => {
  const x = variacaoComparacao(i, 20, 30);
  assert.equal(x.diferenca, 10);
  assert.equal(x.relativa, null);
  assert.match(x.texto, /p\.p\./);
});
test("base zero, negativa ou ausência não inventa crescimento percentual", () => {
  const d = {
    ...i,
    formato: "numero",
    unidade: "por mil",
    unidade_en: "per thousand",
  };
  assert.equal(variacaoComparacao(d, 0, 5).relativa, null);
  assert.equal(variacaoComparacao(d, -3, 5).relativa, null);
  assert.equal(variacaoComparacao(d, null, 5).diferenca, null);
  assert.equal(variacaoComparacao(d, 10, 15).relativa, 50);
});
test("Sim/Não individual não vira crescimento nem nota municipal", () => {
  const d = { ...i, binario: true };
  assert.equal(formatoComparacao(d, 100, true), "Sim");
  assert.equal(formatoComparacao(d, 0, true), "Não");
  assert.equal(variacaoComparacao(d, 0, 100, true).diferenca, null);
  assert.match(variacaoComparacao(d, 0, 100, true).texto, /Não → Sim/);
});
test("empates compartilham posição; zero registrado entra; ausências, ressalvas e bases pequenas ficam à parte", () => {
  const x = ranquearComparacao(
    [
      linha(1, 5),
      linha(2, 5),
      linha(3, 0, 1),
      linha(4, null, 2),
      linha(5, 99, 8),
      linha(6, 10, 0, 2),
      { ...linha(7, 10), d: null },
    ],
    "maior",
    false,
    10,
  );
  assert.deepEqual(
    x.com.map((l) => [l.cod, l.posicao]),
    [
      [1, 1],
      [2, 1],
      [3, 3],
    ],
  );
  assert.equal(x.sem.length, 4);
});
test("incluir ressalvas conserva o valor original e não transforma nulo em zero", () => {
  assert.equal(efetivoComparacao(5, 8, false), null);
  assert.equal(efetivoComparacao(5, 8, true), 5);
  assert.equal(efetivoComparacao(null, 2, true), null);
  const s = {
    v: [2, null],
    n: [2, null],
    d: [1, null],
    c: [16, 2],
    q: [1, 0],
    com_ressalvas: {
      v: [5, null],
      n: [10, null],
      d: [2, null],
      c: [0, 2],
      q: [2, 0],
    },
  };
  assert.equal(serieEfetivaComparacao(s, true).v[0], 5);
  assert.equal(serieEfetivaComparacao(s, false).v[0], 2);
});
test("município oferece ambas as regiões; região imediata oferece a intermediária; ESTADIC não se reparte em municípios", () => {
  const g = {
    municipios: [[5208905, "Goiás", "GO", "520002", "5201"]],
    territorios: {
      "5208905": {
        nivel: "M",
        uf: "GO",
        imediata: "I:520002",
        intermediaria: "T:5201",
      },
      "I:520002": { nivel: "imediata", uf: "GO" },
      "E:52": { nivel: "E" },
      BR: { nivel: "BR" },
    },
  } as unknown as GeografiaComparacao;
  assert.deepEqual(referenciasComparacao(g, "5208905"), [
    "I:520002",
    "T:5201",
    "GO",
    "BR",
  ]);
  assert.deepEqual(referenciasComparacao(g, "I:520002"), [
    "T:5201",
    "GO",
    "BR",
  ]);
  assert.deepEqual(referenciasComparacao(g, "E:52"), ["E:BR"]);
  assert.deepEqual(referenciasComparacao(g, "BR"), []);
});
test("carga truncada, cobertura impossível e falso zero são recusados", () => {
  const s = { v: [0, null], n: [0, null], d: [100, 100], c: [1, 2], q: [1, 0] };
  validarSerieComparacao(s, 2, 1);
  assert.throws(() => validarSerieComparacao({ ...s, v: [0] }, 2, 1));
  assert.throws(() => validarSerieComparacao({ ...s, q: [2, 0] }, 2, 1));
  assert.throws(() => validarSerieComparacao({ ...s, c: [1, 1] }, 2, 1));
  assert.throws(() => validarSerieComparacao({ ...s, v: [NaN, null] }, 2, 1));
});
test("proteção da fonte e denominador zero continuam distinguíveis", () => {
  assert.notEqual(condicaoComparacao(20), condicaoComparacao(4));
  assert.notEqual(condicaoComparacao(2), condicaoComparacao(1));
});
test("valores pequenos positivos e limites percentuais não são arredondados para zero ou cem", () => {
  assert.notEqual(formatoComparacao(i, 0.00001), formatoComparacao(i, 0));
  assert.notEqual(formatoComparacao(i, 99.99999), formatoComparacao(i, 100));
  assert.notEqual(formatoComparacao(i, 100.0001), formatoComparacao(i, 100));
});
