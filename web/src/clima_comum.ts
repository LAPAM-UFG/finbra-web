/**
 * Regras do painel de clima, em funções puras (sem React nem consulta): nomes e unidades, escolha do recorte pela URL,
 * cobertura e lacunas, acumulados e ano em curso, mapa de calor, posições com empate e tabelas exportadas.
 * A tela (pages/Clima.tsx) e os testes (testes/clima.test.ts) usam as mesmas funções.
 */
import type { Tabela } from './exportar';
import { local, t } from './idioma';

export type LinhaClima = Record<string, unknown>;
export const UFS_CLIMA = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'];
export const NORMAL_CLIMA: [number, number] = [1991, 2020];

// ---------------- as seis medidas ----------------

export type Medida = {
  codigo: string; unidade: string; soma: boolean; relativa: boolean; chuva: boolean;
  nome: () => string; curto: () => string; ajuda: () => string; fonte: 'CHIRPS' | 'ERA5-Land';
};
const nm = (pt: string, en: string) => () => t(pt, en);
/** Ordem dos cartões. `relativa`: a comparação com o habitual é percentual (chuva, evaporação); nas demais é uma diferença. */
export const MEDIDAS: Medida[] = [
  { codigo: 'chuva_mm', unidade: 'mm', soma: true, relativa: true, chuva: true, fonte: 'CHIRPS',
    nome: nm('Chuva', 'Rainfall'), curto: nm('chuva', 'rainfall'),
    ajuda: nm('Quanto choveu, em milímetros: soma dos 12 meses. Estimativa de satélite com estações, não uma medição no município.',
      'How much rain fell, in millimetres: the sum of the 12 months. A satellite-and-station estimate, not a measurement in the municipality.') },
  { codigo: 'temperatura_c', unidade: '°C', soma: false, relativa: false, chuva: false, fonte: 'ERA5-Land',
    nome: nm('Temperatura do ar', 'Air temperature'), curto: nm('temperatura', 'temperature'),
    ajuda: nm('Temperatura média do ar a 2 m do chão: média dos 12 meses, dia e noite. É média, não a máxima nem a mínima.',
      'Mean air temperature 2 m above ground: the mean of the 12 months, day and night. It is a mean, not the maximum or the minimum.') },
  { codigo: 'orvalho_c', unidade: '°C', soma: false, relativa: false, chuva: false, fonte: 'ERA5-Land',
    nome: nm('Umidade do ar (ponto de orvalho)', 'Air humidity (dew point)'), curto: nm('ponto de orvalho', 'dew point'),
    ajuda: nm('Ponto de orvalho é a temperatura em que o ar fica saturado e o vapor vira orvalho. Quanto mais perto da temperatura do ar, mais úmido o ar; quanto maior o ponto de orvalho, mais vapor há no ar.',
      'The dew point is the temperature at which the air becomes saturated and vapour turns into dew. The closer it is to the air temperature, the more humid the air; the higher the dew point, the more vapour in the air.') },
  { codigo: 'umid_solo_pct', unidade: '%', soma: false, relativa: false, chuva: false, fonte: 'ERA5-Land',
    nome: nm('Umidade do solo (superfície)', 'Soil moisture (surface)'), curto: nm('umidade do solo', 'soil moisture'),
    ajuda: nm('Quanta água há na camada de 0 a 7 cm do solo, em % do volume. A diferença para o habitual é dada em pontos percentuais (p.p.), não em %.',
      'How much water is in the 0–7 cm soil layer, as % of volume. The difference from the usual is given in percentage points (p.p.), not in %.') },
  { codigo: 'evap_mm', unidade: 'mm', soma: true, relativa: true, chuva: false, fonte: 'ERA5-Land',
    nome: nm('Evaporação', 'Evaporation'), curto: nm('evaporação', 'evaporation'),
    ajuda: nm('Água que o modelo estima que sai do solo, das plantas e da superfície, em mm: soma dos 12 meses. Não é a demanda de água da atmosfera (evapotranspiração de referência, ET0).',
      'Water the model estimates leaves soil, plants and surfaces, in mm: the sum of the 12 months. It is not the atmospheric water demand (reference evapotranspiration, ET0).') },
  { codigo: 'radiacao_wm2', unidade: 'W/m²', soma: false, relativa: false, chuva: false, fonte: 'ERA5-Land',
    nome: nm('Radiação solar', 'Solar radiation'), curto: nm('radiação solar', 'solar radiation'),
    ajuda: nm('Energia do sol que chega à superfície, em watts por m²: média dos 12 meses, incluindo a noite.',
      'Energy from the sun reaching the surface, in watts per m²: the mean of the 12 months, night included.') },
];
export const medidaDe = (codigo: string | null | undefined) => MEDIDAS.find((m) => m.codigo === codigo) ?? null;
export const CODIGOS_MEDIDAS = MEDIDAS.map((m) => m.codigo);

// ---------------- números e textos ----------------

export const numeroValido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const num = (v: unknown) => (numeroValido(v) ? v : null);
const sinal = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');

/** Casas decimais: °C e % com uma; W/m² sem casas; mm adaptativo (0,43 mm, 3,2 mm, 33 mm) para a normal pequena não virar "0 mm". */
export function casas(unidade: string, v: number): number {
  if (unidade === '°C' || unidade === '%') return 1;
  if (unidade === 'mm') {
    const a = Math.abs(v);
    return a === 0 ? 0 : a < 1 ? 2 : a < 10 ? 1 : 0;
  }
  return 0;
}
const fmt = (v: number, c: number) => v.toLocaleString(local(), { minimumFractionDigits: c, maximumFractionDigits: c });
export const semUnidade = (v: unknown, unidade: string) => (numeroValido(v) ? fmt(v, casas(unidade, v)) : '–');
export const comUnidade = (v: unknown, unidade: string) => (numeroValido(v) ? `${fmt(v, casas(unidade, v))} ${unidade}` : '–');
/** Unidade da DIFERENÇA: a do solo é ponto percentual, não %. */
export const unidadeDiferenca = (unidade: string) => (unidade === '%' ? 'p.p.' : unidade);
export function diferencaTxt(v: unknown, unidade: string): string {
  if (!numeroValido(v)) return '–';
  const c = unidade === 'mm' ? Math.max(1, casas(unidade, v)) : 1;
  return `${sinal(v)}${fmt(Math.abs(v), c)} ${unidadeDiferenca(unidade)}`;
}
/** Variação relativa (fração) com sinal: +12,3% / −5,0%. Nunca corta o percentual: +7.615,7% é uma conta válida. */
export const variacaoTxt = (v: unknown) => (numeroValido(v) ? `${sinal(v)}${fmt(Math.abs(v * 100), 1)}%` : '–');

/** Comparação com o habitual: variação % (chuva, evaporação) acompanhada da diferença na unidade; diferença simples nas demais. */
export function comparacaoTxt(valor: unknown, normal: unknown, relativa: boolean, unidade: string): string {
  if (!numeroValido(valor) || !numeroValido(normal)) return '–';
  if (!relativa) return diferencaTxt(valor - normal, unidade);
  const dif = diferencaTxt(valor - normal, unidade);
  return normal > 0 ? `${variacaoTxt(valor / normal - 1)} (${dif})` : dif;
}
export type Tom = 'acima' | 'abaixo' | 'igual' | 'sem';
export function tomDe(anomalia: unknown): Tom {
  if (!numeroValido(anomalia)) return 'sem';
  return anomalia > 0 ? 'acima' : anomalia < 0 ? 'abaixo' : 'igual';
}

/** Frase simples do cartão: "5,5% abaixo do habitual (1991–2020)" ou "0,5 °C acima do habitual". */
export function fraseHabitual(anomalia: unknown, relativa: boolean, unidade: string): string {
  if (!numeroValido(anomalia)) return t('sem normal para comparar', 'no normal to compare with');
  const abs = Math.abs(anomalia);
  const quanto = relativa ? `${fmt(abs * 100, 1)}%` : `${fmt(abs, 1)} ${unidadeDiferenca(unidade)}`;
  if (abs === 0) return t('igual ao habitual', 'same as usual');
  return anomalia > 0 ? t(`${quanto} acima do habitual`, `${quanto} above usual`) : t(`${quanto} abaixo do habitual`, `${quanto} below usual`);
}

export const mesAnoTxt = (aaaamm: unknown) => (numeroValido(aaaamm) && aaaamm > 190000 ? `${String(aaaamm % 100).padStart(2, '0')}/${Math.floor(aaaamm / 100)}` : '–');
export const mesCurto = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString(local(), { month: 'short' }).replace('.', '');
export const mesLongo = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString(local(), { month: 'long' });
/** "jan–set" para o ano em curso com k meses. */
export const faixaMeses = (k: number) => (k <= 1 ? mesCurto(1) : `${mesCurto(1)}–${mesCurto(k)}`);

// ---------------- resumo (linha do painel.parquet ou do cálculo equivalente) ----------------

export type ResumoClima = {
  variavel: string; ano_de: number; ano_ate: number; n_anos: number; anos_lacuna: string | null; ate: number | null;
  valor: number | null; normal: number | null; anomalia_pct: number | null; anomalia: number | null;
  parcial_meses: number | null; parcial_valor: number | null; parcial_normal: number | null; parcial_anomalia_pct: number | null; parcial_anomalia: number | null;
  acum_fim: number | null;
  acum3_cob: number | null; acum3_valor: number | null; acum3_normal: number | null;
  acum6_cob: number | null; acum6_valor: number | null; acum6_normal: number | null;
  acum12_cob: number | null; acum12_valor: number | null; acum12_normal: number | null;
};
export const lerResumo = (l: LinhaClima): ResumoClima => {
  const n = (k: string) => num(l[k]);
  return {
    variavel: String(l.variavel), ano_de: Number(l.ano_de), ano_ate: Number(l.ano_ate), n_anos: Number(l.n_anos),
    anos_lacuna: l.anos_lacuna === null || l.anos_lacuna === undefined || l.anos_lacuna === '' ? null : String(l.anos_lacuna), ate: n('ate'),
    valor: n('valor'), normal: n('normal'), anomalia_pct: n('anomalia_pct'), anomalia: n('anomalia'),
    parcial_meses: n('parcial_meses'), parcial_valor: n('parcial_valor'), parcial_normal: n('parcial_normal'),
    parcial_anomalia_pct: n('parcial_anomalia_pct'), parcial_anomalia: n('parcial_anomalia'), acum_fim: n('acum_fim'),
    acum3_cob: n('acum3_cob'), acum3_valor: n('acum3_valor'), acum3_normal: n('acum3_normal'),
    acum6_cob: n('acum6_cob'), acum6_valor: n('acum6_valor'), acum6_normal: n('acum6_normal'),
    acum12_cob: n('acum12_cob'), acum12_valor: n('acum12_valor'), acum12_normal: n('acum12_normal'),
  };
};
export const anomaliaDoResumo = (r: ResumoClima, relativa: boolean) => (relativa ? r.anomalia_pct : r.anomalia);
export const anomaliaParcial = (r: ResumoClima, relativa: boolean) => (relativa ? r.parcial_anomalia_pct : r.parcial_anomalia);

export const anosDaLacuna = (r: Pick<ResumoClima, 'anos_lacuna'> | null | undefined): number[] =>
  (r?.anos_lacuna ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
/** Anos com total anual de verdade: os da faixa menos as lacunas (a lista que o seletor oferece, não só os extremos). */
export function anosCompletos(r: Pick<ResumoClima, 'ano_de' | 'ano_ate' | 'anos_lacuna'> | null | undefined): number[] {
  if (!r || !Number.isInteger(r.ano_de) || !Number.isInteger(r.ano_ate)) return [];
  const fora = new Set(anosDaLacuna(r));
  const anos: number[] = [];
  for (let a = r.ano_ate; a >= r.ano_de; a--) if (!fora.has(a)) anos.push(a);
  return anos;
}
/** Ano pedido pela URL contra a cobertura: nunca troca por outro; se não existe, guarda o pedido e sugere os vizinhos. */
export function resolverAno(pedido: number | null, disponiveis: number[], padrao: number | null) {
  if (pedido === null) return { ano: padrao, ausente: false, sugestoes: [] as number[] };
  if (disponiveis.includes(pedido)) return { ano: pedido, ausente: false, sugestoes: [] as number[] };
  const perto = [...disponiveis].sort((a, b) => Math.abs(a - pedido) - Math.abs(b - pedido) || b - a).slice(0, 3).sort((a, b) => b - a);
  return { ano: pedido, ausente: true, sugestoes: perto };
}

export type Acumulado = { meses: 3 | 6 | 12; valor: number | null; normal: number | null; variacao: number | null; cobertura: number; completo: boolean; fim: number | null };
/** Acumulados de chuva do resumo: só com todos os meses; senão valor nulo e a cobertura (ex.: 11 de 12) explicada. */
export function acumulados(r: ResumoClima | null | undefined): Acumulado[] {
  if (!r) return [];
  const mk = (meses: 3 | 6 | 12, valor: number | null, normal: number | null, cob: number | null): Acumulado => ({
    meses, valor, normal, cobertura: cob ?? 0, completo: valor !== null && cob === meses, fim: r.acum_fim,
    variacao: valor !== null && normal !== null && normal > 0 ? valor / normal - 1 : null,
  });
  return [mk(3, r.acum3_valor, r.acum3_normal, r.acum3_cob), mk(6, r.acum6_valor, r.acum6_normal, r.acum6_cob), mk(12, r.acum12_valor, r.acum12_normal, r.acum12_cob)];
}
/** "jul–set/2026" para o acumulado de k meses que termina em `fim` (AAAAMM). */
export function periodoDoAcumulado(fim: number | null, k: number): string {
  if (fim === null) return '–';
  const ano = Math.floor(fim / 100), mes = fim % 100;
  const ini = ano * 12 + mes - 1 - (k - 1);
  const ai = Math.floor(ini / 12), mi = (ini % 12) + 1;
  return ai === ano ? `${mesCurto(mi)}–${mesCurto(mes)}/${ano}` : `${mesCurto(mi)}/${ai}–${mesCurto(mes)}/${ano}`;
}

// ---------------- escolha do recorte pela URL ----------------

export type Territorio = { cod: number; nome: string; uf: string };
export type AvisoEscolha =
  | { tipo: 'uf_invalida' | 'cod_desconhecido' | 'variavel_invalida' | 'ano_invalido'; valor: string }
  | { tipo: 'uf_diverge'; valor: string; municipio: string; uf: string };
export type EscolhaClima = {
  uf: string; cod: number | null; municipio: Territorio | null; variavel: string | null; ano: number | null;
  avisos: AvisoEscolha[]; bloqueio: { tipo: 'cod_desconhecido'; valor: string } | null; pendente: boolean;
};
/**
 * Lê uf, cod, variavel e ano da URL SEM trocar nenhum por outro valor: o que não vale vira aviso com o texto pedido, e um código
 * inexistente bloqueia a leitura do município (o painel nunca mostra a UF ou o Brasil como se fosse o município).
 * `territorios` null = ainda carregando (município pendente). Cobertura (município sem dado) é conferida depois, com o resumo.
 */
export function lerEscolhaClima(sp: URLSearchParams, territorios: Territorio[] | null): EscolhaClima {
  const avisos: AvisoEscolha[] = [];
  const ufPedida = (sp.get('uf') ?? '').trim().toUpperCase();
  let uf = '';
  if (ufPedida) {
    if (UFS_CLIMA.includes(ufPedida)) uf = ufPedida;
    else avisos.push({ tipo: 'uf_invalida', valor: sp.get('uf')! });
  }
  const codPedido = (sp.get('cod') ?? '').trim();
  let cod: number | null = null;
  let municipio: Territorio | null = null;
  let bloqueio: EscolhaClima['bloqueio'] = null;
  let pendente = false;
  if (codPedido) {
    if (!/^\d{7}$/.test(codPedido)) {
      bloqueio = { tipo: 'cod_desconhecido', valor: codPedido };
      avisos.push({ tipo: 'cod_desconhecido', valor: codPedido });
    } else if (!territorios) {
      cod = Number(codPedido);
      pendente = true;
    } else {
      municipio = territorios.find((x) => x.cod === Number(codPedido)) ?? null;
      if (!municipio) {
        bloqueio = { tipo: 'cod_desconhecido', valor: codPedido };
        avisos.push({ tipo: 'cod_desconhecido', valor: codPedido });
      } else {
        cod = municipio.cod;
        if (uf && uf !== municipio.uf) avisos.push({ tipo: 'uf_diverge', valor: uf, municipio: municipio.nome, uf: municipio.uf });
        uf = municipio.uf;
      }
    }
  }
  const varPedida = sp.get('variavel');
  let variavel: string | null = null;
  if (varPedida) {
    if (CODIGOS_MEDIDAS.includes(varPedida)) variavel = varPedida;
    else avisos.push({ tipo: 'variavel_invalida', valor: varPedida });
  }
  const anoPedido = (sp.get('ano') ?? '').trim();
  let ano: number | null = null;
  if (anoPedido) {
    if (/^\d{4}$/.test(anoPedido)) ano = Number(anoPedido);
    else avisos.push({ tipo: 'ano_invalido', valor: anoPedido });
  }
  return { uf, cod, municipio, variavel, ano, avisos, bloqueio, pendente };
}

const CHAVES_CLIMA = ['variavel', 'uf', 'cod', 'ano'] as const;
/** Parâmetros do próprio clima que acompanham o menu e os links entre telas (os de outros painéis não entram). */
export function buscaClima(search: string | URLSearchParams, mudancas: Record<string, string | number | null> = {}): string {
  const de = typeof search === 'string' ? new URLSearchParams(search) : search;
  const novo = new URLSearchParams();
  for (const k of CHAVES_CLIMA) {
    const v = de.get(k);
    if (v) novo.set(k, v);
  }
  for (const [k, v] of Object.entries(mudancas)) {
    if (v === null || v === '') novo.delete(k);
    else novo.set(k, String(v));
  }
  const s = novo.toString();
  return s ? `?${s}` : '';
}

/** Busca de município pelo nome, sem acento e sem diferenciar caixa: começa com o texto primeiro, depois contém. */
const sa = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
export function buscarMunicipios(todos: Territorio[], texto: string, uf = '', limite = 12): Territorio[] {
  const q = sa(texto);
  if (q.length < 2) return [];
  const pool = uf ? todos.filter((x) => x.uf === uf) : todos;
  const inicio: Territorio[] = [];
  const meio: Territorio[] = [];
  for (const x of pool) {
    const n = sa(x.nome);
    if (n.startsWith(q)) inicio.push(x);
    else if (n.includes(q)) meio.push(x);
  }
  return [...inicio, ...meio].slice(0, limite);
}

// ---------------- séries com lacunas ----------------

/** Eixo contínuo de anos: o ano ausente fica com valor nulo (a lacuna aparece no eixo), nunca é comprimido nem preenchido. */
export function serieAnualContinua<T extends { ano: number }>(linhas: T[], de: number, ate: number): { ano: number; linha: T | null }[] {
  const por = new Map(linhas.map((l) => [l.ano, l]));
  const saida: { ano: number; linha: T | null }[] = [];
  for (let a = de; a <= ate; a++) saida.push({ ano: a, linha: por.get(a) ?? null });
  return saida;
}

export type CelulaCalor = { a: number; m: number; ano: number; mes: number; tipo: 'dado' | 'lacuna' | 'sem_normal'; valor: number | null; normal: number | null; anomalia: number | null };
export type MapaCalor = { anos: number[]; celulas: CelulaCalor[]; limite: number; lacunas: number; semNormal: number };
/**
 * Mapa de calor ano × mês do desvio do habitual (variação % para chuva e evaporação; diferença nas demais), com TODOS os anos do
 * histórico. Mês sem linha dentro do período publicado é lacuna explícita (não zero); o zero real é dado; mês depois do último
 * publicado (`ate`, AAAAMM) não é lacuna, só futuro, e não aparece.
 */
export function montarMapaCalor(linhas: { ano: number; mes: number; valor: unknown; normal: unknown }[], relativa: boolean, ate: number | null): MapaCalor {
  const dados = new Map<number, { valor: number; normal: number | null }>();
  let de = Infinity;
  let fim = -Infinity;
  for (const l of linhas) {
    const v = num(l.valor);
    if (v === null) continue;
    dados.set(l.ano * 100 + l.mes, { valor: v, normal: num(l.normal) });
    de = Math.min(de, l.ano);
    fim = Math.max(fim, l.ano);
  }
  if (!Number.isFinite(de)) return { anos: [], celulas: [], limite: 1, lacunas: 0, semNormal: 0 };
  const ultimo = ate ?? fim * 100 + 12;
  const anos: number[] = [];
  for (let a = de; a <= Math.min(fim, Math.floor(ultimo / 100)); a++) anos.push(a);
  const celulas: CelulaCalor[] = [];
  let lacunas = 0;
  let semNormal = 0;
  anos.forEach((ano, a) => {
    for (let mes = 1; mes <= 12; mes++) {
      if (ano * 100 + mes > ultimo) continue;
      const d = dados.get(ano * 100 + mes);
      if (!d) {
        celulas.push({ a, m: mes - 1, ano, mes, tipo: 'lacuna', valor: null, normal: null, anomalia: null });
        lacunas++;
        continue;
      }
      const anom = d.normal === null ? null : relativa ? (d.normal > 0 ? d.valor / d.normal - 1 : null) : d.valor - d.normal;
      if (anom === null) semNormal++;
      celulas.push({ a, m: mes - 1, ano, mes, tipo: anom === null ? 'sem_normal' : 'dado', valor: d.valor, normal: d.normal, anomalia: anom });
    }
  });
  const abs = celulas.map((c) => (c.anomalia === null ? null : Math.abs(c.anomalia))).filter((x): x is number => x !== null).sort((x, y) => x - y);
  // escala simétrica pelo percentil 95: um mês extremo (+7.615%) não apaga o resto do mapa; a cor satura e o tooltip traz o valor exato
  const limite = abs.length ? Math.max(abs[Math.min(abs.length - 1, Math.floor(abs.length * 0.95))], relativa ? 0.01 : 0.01) : 1;
  return { anos, celulas, limite, lacunas, semNormal };
}

/** Posições com empate competitivo (1, 2, 2, 4), como no restante dos painéis: valores iguais dividem a posição. `chaves` já ordenadas. */
export function posicoesCompetitivas(chaves: number[]): number[] {
  const pos: number[] = [];
  chaves.forEach((c, i) => pos.push(i > 0 && c === chaves[i - 1] ? pos[i - 1] : i + 1));
  return pos;
}

// ---------------- exportação ----------------

export const cabecalhoAnomalia = (relativa: boolean, unidade: string) => (relativa
  ? t('Variação sobre a normal (%)', 'Change from normal (%)')
  : t(`Diferença para a normal (${unidadeDiferenca(unidade)})`, `Difference from normal (${unidadeDiferenca(unidade)})`));
/** Exporta a anomalia na escala da coluna: percentual ×100 (−9,79 e não −0,0979) ou diferença na unidade. */
export const anomaliaExportada = (anomalia: unknown, relativa: boolean) => (numeroValido(anomalia) ? (relativa ? anomalia * 100 : anomalia) : null);
export const tipoAnomalia = (relativa: boolean, unidade: string) => (relativa ? t('variação relativa (%)', 'relative change (%)')
  : unidade === '%' ? t('diferença em pontos percentuais (p.p.)', 'difference in percentage points (p.p.)') : t(`diferença em ${unidade}`, `difference in ${unidade}`));

export type MetaExport = [string, string][];
export function tabelaAnualClima(o: {
  medida: Medida; rotuloMedida: string; anos: { ano: number; valor: unknown; normal: unknown; anomalia: unknown }[]; de: number; ate: number; metadados: MetaExport;
}): Tabela {
  const { medida: m } = o;
  const por = new Map(o.anos.map((a) => [a.ano, a]));
  const linhas: Tabela['linhas'] = [];
  for (let ano = o.de; ano <= o.ate; ano++) {
    const a = por.get(ano);
    linhas.push(a
      ? [ano, num(a.valor), num(a.normal), anomaliaExportada(a.anomalia, m.relativa), t('ano completo (12 meses)', 'complete year (12 months)')]
      : [ano, null, null, null, t('sem total anual: meses ausentes na fonte', 'no annual total: months missing in the source')]);
  }
  return {
    colunas: [t('Ano', 'Year'), `${o.rotuloMedida} (${m.unidade})`, `${t('Normal', 'Normal')} (${m.unidade})`, cabecalhoAnomalia(m.relativa, m.unidade), t('Condição', 'Condition')],
    linhas,
    metadados: [...o.metadados, [t('Período exportado', 'Exported period'), `${o.de}–${o.ate}`], [t('Tipo de comparação', 'Type of comparison'), tipoAnomalia(m.relativa, m.unidade)],
      [t('Anos', 'Years'), t('só anos com os 12 meses; anos sem total aparecem vazios, sem preenchimento', 'only years with all 12 months; years without a total are left empty, not filled')]],
  };
}

export type EscopoExportMensal = 'ano' | 'serie';
export function tabelaMensalClima(o: {
  medida: Medida; rotuloMedida: string; linhas: { ano: number; mes: number; valor: unknown; normal: unknown }[]; escopo: EscopoExportMensal; ano: number | null;
  ate: number | null; metadados: MetaExport;
}): Tabela {
  const { medida: m } = o;
  const dentro = o.escopo === 'ano' && o.ano !== null ? o.linhas.filter((l) => l.ano === o.ano) : o.linhas;
  const por = new Map(dentro.map((l) => [l.ano * 100 + l.mes, l]));
  const chaves = [...por.keys()].sort((a, b) => a - b);
  const primeiro = o.escopo === 'ano' && o.ano !== null ? o.ano * 100 + 1 : chaves[0];
  const ultimoPub = o.ate ?? chaves.at(-1) ?? 0;
  const ultimo = o.escopo === 'ano' && o.ano !== null ? Math.min(o.ano * 100 + 12, ultimoPub) : chaves.at(-1) ?? 0;
  const linhas: Tabela['linhas'] = [];
  let sem = 0;
  if (primeiro !== undefined) {
    for (let ano = Math.floor(primeiro / 100); ano <= Math.floor(ultimo / 100); ano++) {
      for (let mes = 1; mes <= 12; mes++) {
        const k = ano * 100 + mes;
        if (k < primeiro || k > ultimo) continue;
        const l = por.get(k);
        const valor = l ? num(l.valor) : null;
        const normal = l ? num(l.normal) : null;
        const anom = valor !== null && normal !== null ? (m.relativa ? (normal > 0 ? valor / normal - 1 : null) : valor - normal) : null;
        if (valor === null) sem++;
        linhas.push([ano, mes, valor, normal, anomaliaExportada(anom, m.relativa),
          valor === null ? t('sem dado (lacuna na fonte)', 'no data (gap in the source)') : normal === null ? t('dado, sem normal', 'data, no normal') : t('dado', 'data')]);
      }
    }
  }
  const periodo = linhas.length ? `${String(linhas[0][1]).padStart(2, '0')}/${linhas[0][0]} a ${String(linhas.at(-1)![1]).padStart(2, '0')}/${linhas.at(-1)![0]}` : '–';
  return {
    colunas: [t('Ano', 'Year'), t('Mês', 'Month'), `${o.rotuloMedida} (${m.unidade})`, `${t('Normal do mês', 'Monthly normal')} (${m.unidade})`, cabecalhoAnomalia(m.relativa, m.unidade), t('Condição', 'Condition')],
    linhas,
    metadados: [...o.metadados, [t('Período exportado', 'Exported period'), periodo],
      [t('Conteúdo', 'Content'), o.escopo === 'ano' ? t(`só o ano exibido (${o.ano})`, `only the year shown (${o.ano})`) : t('série completa do recorte', 'full series of the scope')],
      [t('Meses sem dado no período', 'Months without data in the period'), String(sem)], [t('Tipo de comparação', 'Type of comparison'), tipoAnomalia(m.relativa, m.unidade)]],
  };
}
