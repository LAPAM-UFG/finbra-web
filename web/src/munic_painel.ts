/**
 * Painel automático de gestão pública (MUNIC e ESTADIC, IBGE): tipos, escolhas da URL e cálculos puros sobre as linhas já
 * publicadas (gold/munic/agregados e respostas). Nada aqui consulta dados nem formata texto de tela.
 *
 * Regras:
 *  - cada indicador aponta para pares exatos pesquisa/edição/variável da curadoria (munic_curadoria.ts); sem ligação por
 *    código parecido ou texto parecido;
 *  - indicador binário: só as respostas listadas em `sim` e `nao` entram na base; "Não informou", "Recusa", "Não sabe
 *    informar" e "–" (valida = falso) ficam à parte, e quem não respondeu nunca vira "Não" nem zero;
 *  - numérico: soma e média só das respostas numéricas válidas, com a cobertura (quantos territórios têm valor); o 0
 *    registrado é valor, a ausência é ausência;
 *  - resposta válida fora do que a curadoria prevê torna o indicador "inesperado": não se calcula percentual sobre ela;
 *  - nada de média de percentuais, de total derivado de bases diferentes nem de nota ou ranking de gestão.
 */
import type { Pesquisa } from './munic_comum';

export type Texto = { pt: string; en: string };
export type FonteMunic = { ano: number; var: string; aba: string; tema: string; rotulo: string };
export type BlocoMunic = 'pessoal' | 'transparencia' | 'planejamento' | 'habitacao' | 'inclusao';
export const BLOCOS_MUNIC: BlocoMunic[] = ['pessoal', 'transparencia', 'planejamento', 'habitacao', 'inclusao'];

export type IndicadorMunic = {
  id: string;
  bloco: BlocoMunic;
  pesquisa: Pesquisa;
  tipo: 'binario' | 'numerico';
  titulo: Texto;
  /** edições em que a pergunta existe, da mais recente para a mais antiga */
  fontes: FonteMunic[];
  sim?: string[];
  nao?: string[];
  unidade?: Texto;
  /** a que universo e a que quadro o número se refere (ex.: administração direta × indireta), mostrado no cartão */
  contexto?: Texto;
};

// ---------------- escolhas da URL ----------------

export const UFS_MUNIC = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const;
/** Código IBGE de cada UF: é o `cod` das respostas da ESTADIC (conferido contra gold/munic/territorio em testes/munic_painel.test.ts). */
export const COD_UF: Record<string, number> = {
  RO: 11, AC: 12, AM: 13, RR: 14, PA: 15, AP: 16, TO: 17, MA: 21, PI: 22, CE: 23, RN: 24, PB: 25, PE: 26, AL: 27, SE: 28, BA: 29,
  MG: 31, ES: 32, RJ: 33, SP: 35, PR: 41, SC: 42, RS: 43, MS: 50, MT: 51, GO: 52, DF: 53,
};

export type Modo = { tipo: 'ultima' } | { tipo: 'edicao'; ano: number };
export type Escopo =
  | { tipo: 'brasil' }
  | { tipo: 'uf'; uf: string } // MUNIC: prefeituras da UF
  | { tipo: 'territorio'; cod: number; uf: string | null }; // MUNIC: um município (uf conhecida só depois de achá-lo); ESTADIC: o governo de uma UF

export type Escolhas =
  | { ok: true; pesquisa: Pesquisa; modo: Modo; escopo: Escopo }
  | { ok: false; erro: 'pesquisa' | 'edicao' | 'uf' | 'cod'; valor: string };

const vazio = (v: string | null | undefined) => v === null || v === undefined || v === '';

/**
 * Lê pesq, ano, uf e cod do endereço. Valor informado e inválido é erro — nunca vira Brasil nem a última edição em silêncio.
 * `edicoes`: anos com indicadores curados para a pesquisa. ESTADIC: `uf` escolhe o governo estadual (cod = código IBGE da UF).
 */
export function lerEscolhas(sp: URLSearchParams, edicoes: Record<Pesquisa, number[]>): Escolhas {
  const pq = sp.get('pesq');
  if (!vazio(pq) && pq !== 'munic' && pq !== 'estadic') return { ok: false, erro: 'pesquisa', valor: String(pq) };
  const pesquisa: Pesquisa = pq === 'estadic' ? 'estadic' : 'munic';
  const ano = sp.get('ano');
  let modo: Modo = { tipo: 'ultima' };
  if (!vazio(ano)) {
    const n = /^\d{4}$/.test(String(ano)) ? Number(ano) : NaN;
    if (!edicoes[pesquisa].includes(n)) return { ok: false, erro: 'edicao', valor: String(ano) };
    modo = { tipo: 'edicao', ano: n };
  }
  const uf = sp.get('uf');
  const cod = sp.get('cod');
  if (!vazio(uf) && !(UFS_MUNIC as readonly string[]).includes(String(uf))) return { ok: false, erro: 'uf', valor: String(uf) };
  if (pesquisa === 'estadic') {
    if (!vazio(cod)) {
      const c = Number(cod);
      const sigla = Object.entries(COD_UF).find(([, v]) => v === c)?.[0];
      if (!/^\d{2}$/.test(String(cod)) || !sigla) return { ok: false, erro: 'cod', valor: String(cod) };
      if (!vazio(uf) && uf !== sigla) return { ok: false, erro: 'cod', valor: String(cod) };
      return { ok: true, pesquisa, modo, escopo: { tipo: 'territorio', cod: c, uf: sigla } };
    }
    return { ok: true, pesquisa, modo, escopo: vazio(uf) ? { tipo: 'brasil' } : { tipo: 'territorio', cod: COD_UF[String(uf)], uf: String(uf) } };
  }
  if (!vazio(cod)) {
    if (!/^\d{7}$/.test(String(cod))) return { ok: false, erro: 'cod', valor: String(cod) };
    return { ok: true, pesquisa, modo, escopo: { tipo: 'territorio', cod: Number(cod), uf: vazio(uf) ? null : String(uf) } };
  }
  return { ok: true, pesquisa, modo, escopo: vazio(uf) ? { tipo: 'brasil' } : { tipo: 'uf', uf: String(uf) } };
}

/** Links antigos do explorador (/munic?var=…, ?aba=…) abrem o explorador em /munic/perguntas, com a pergunta preservada. */
export const ehLinkDoExplorador = (search: string): boolean => {
  const sp = new URLSearchParams(search);
  return sp.has('var') || sp.has('aba');
};

// ---------------- edição de cada indicador ----------------

export type Selecionado = { ind: IndicadorMunic; fonte: FonteMunic | null };

/** Última informação de cada tema (modo padrão) ou só a edição pedida; sem a pergunta na edição, `fonte` é null (não disponível). */
export function selecionar(curadoria: IndicadorMunic[], pesquisa: Pesquisa, modo: Modo): Selecionado[] {
  return curadoria.filter((i) => i.pesquisa === pesquisa).map((ind) => ({
    ind,
    fonte: modo.tipo === 'ultima' ? ind.fontes[0] ?? null : ind.fontes.find((f) => f.ano === modo.ano) ?? null,
  }));
}

/** Edições com ao menos um indicador curado, da mais recente para a mais antiga. */
export function edicoesCuradas(curadoria: IndicadorMunic[]): Record<Pesquisa, number[]> {
  const por = (p: Pesquisa) => [...new Set(curadoria.filter((i) => i.pesquisa === p).flatMap((i) => i.fontes.map((f) => f.ano)))].sort((a, b) => b - a);
  return { munic: por('munic'), estadic: por('estadic') };
}

/** Pares (edição, variável) a pedir, agrupados por edição: uma consulta só para todos os cartões. */
export function paresPedidos(sel: Selecionado[]): Map<number, string[]> {
  const m = new Map<number, Set<string>>();
  for (const { fonte } of sel) if (fonte) (m.get(fonte.ano) ?? m.set(fonte.ano, new Set()).get(fonte.ano)!).add(fonte.var);
  return new Map([...m.entries()].sort((a, b) => a[0] - b[0]).map(([a, s]) => [a, [...s].sort()]));
}

// ---------------- linhas publicadas ----------------

export type LinhaAgg = { ano: number; var: string; corte: string; grupo: string; valor_txt: string | null; valida: boolean; n: number; soma: number | null; media: number | null };
export type LinhaResp = { ano: number; var: string; valor_txt: string | null; valor_num: number | null; valida: boolean };
export type Universo = { ano: number; territorios: number; territorios_uf: number };

const noEscopo = (l: LinhaAgg, f: FonteMunic, corte: string, grupo: string) => l.ano === f.ano && l.var === f.var && l.corte === corte && l.grupo === grupo;

export type SemResposta = { texto: string; n: number };
export type ResumoBinario = {
  estado: 'ok' | 'sem_dados' | 'inesperada';
  sim: number; nao: number;
  /** Sim + Não: respostas efetivas */
  base: number;
  /** participação de Sim na base (0 a 1); null sem base ou com categoria inesperada */
  pct: number | null;
  semResposta: number;
  semRespostaDetalhe: SemResposta[];
  /** respostas válidas que a curadoria não prevê (não entram em nenhuma conta) */
  inesperadas: SemResposta[];
};

/** Distribuição binária de um recorte (Brasil ou UF): Sim ÷ (Sim + Não), com o que ficou fora da base à parte. */
export function resumirBinario(linhas: LinhaAgg[], ind: IndicadorMunic, f: FonteMunic, corte: string, grupo: string): ResumoBinario {
  const meus = linhas.filter((l) => noEscopo(l, f, corte, grupo));
  const sim = new Set(ind.sim ?? []);
  const nao = new Set(ind.nao ?? []);
  let s = 0, n = 0, fora = 0;
  const detalhe = new Map<string, number>();
  const inesperadas: SemResposta[] = [];
  for (const l of meus) {
    if (!l.valida) {
      fora += l.n;
      const k = l.valor_txt ?? '–';
      detalhe.set(k, (detalhe.get(k) ?? 0) + l.n);
    } else if (l.valor_txt !== null && sim.has(l.valor_txt)) s += l.n;
    else if (l.valor_txt !== null && nao.has(l.valor_txt)) n += l.n;
    else inesperadas.push({ texto: l.valor_txt ?? '(numérica)', n: l.n });
  }
  const base = s + n;
  const estado = !meus.length ? 'sem_dados' : inesperadas.length ? 'inesperada' : 'ok';
  return {
    estado, sim: s, nao: n, base, pct: estado === 'ok' && base > 0 ? s / base : null, semResposta: fora,
    semRespostaDetalhe: [...detalhe.entries()].map(([texto, k]) => ({ texto, n: k })).sort((a, b) => b.n - a.n), inesperadas,
  };
}

export type ResumoNumerico = {
  estado: 'ok' | 'sem_dados' | 'inesperada';
  /** territórios com valor numérico válido (o 0 registrado conta) */
  n: number;
  soma: number | null;
  media: number | null;
  semResposta: number;
  semRespostaDetalhe: SemResposta[];
};

/** Soma e média das respostas numéricas válidas de um recorte, com a cobertura em `n`; sem valor, soma e média são null (não zero). */
export function resumirNumerico(linhas: LinhaAgg[], f: FonteMunic, corte: string, grupo: string): ResumoNumerico {
  const meus = linhas.filter((l) => noEscopo(l, f, corte, grupo));
  let n = 0, fora = 0;
  let soma: number | null = null;
  let estranha = false;
  const detalhe = new Map<string, number>();
  for (const l of meus) {
    if (!l.valida) {
      fora += l.n;
      const k = l.valor_txt ?? '–';
      detalhe.set(k, (detalhe.get(k) ?? 0) + l.n);
    } else if (l.valor_txt === null && typeof l.soma === 'number' && Number.isFinite(l.soma)) {
      n += l.n;
      soma = (soma ?? 0) + l.soma;
    } else estranha = true;
  }
  return {
    estado: !meus.length ? 'sem_dados' : estranha ? 'inesperada' : 'ok', n, soma, media: soma !== null && n > 0 ? soma / n : null,
    semResposta: fora, semRespostaDetalhe: [...detalhe.entries()].map(([texto, k]) => ({ texto, n: k })).sort((a, b) => b.n - a.n),
  };
}

// ---------------- um território (município ou governo estadual) ----------------

export type RespostaTerritorio =
  | { estado: 'sim' | 'nao'; texto: string }
  | { estado: 'valor'; valor: number }
  | { estado: 'sem_resposta'; texto: string } // há registro, mas a resposta não é válida (Não informou, Recusa, "–")
  | { estado: 'sem_registro' } // o território não tem linha para a pergunta
  | { estado: 'inesperada'; texto: string };

/** Resposta de um território a um indicador: Sim, Não, valor numérico (0 incluído), sem resposta válida ou sem registro. */
export function respostaDoTerritorio(linhas: LinhaResp[], ind: IndicadorMunic, f: FonteMunic): RespostaTerritorio {
  const r = linhas.find((l) => l.ano === f.ano && l.var === f.var);
  if (!r) return { estado: 'sem_registro' };
  if (!r.valida) return { estado: 'sem_resposta', texto: r.valor_txt ?? '–' };
  if (ind.tipo === 'numerico') return typeof r.valor_num === 'number' && Number.isFinite(r.valor_num) ? { estado: 'valor', valor: r.valor_num } : { estado: 'inesperada', texto: r.valor_txt ?? '(sem valor)' };
  if (r.valor_txt !== null && (ind.sim ?? []).includes(r.valor_txt)) return { estado: 'sim', texto: r.valor_txt };
  if (r.valor_txt !== null && (ind.nao ?? []).includes(r.valor_txt)) return { estado: 'nao', texto: r.valor_txt };
  return { estado: 'inesperada', texto: r.valor_txt ?? '(numérica)' };
}

// ---------------- cartões ----------------

export type CartaoMunic = {
  ind: IndicadorMunic;
  fonte: FonteMunic | null;
  /** resumo do recorte (Brasil, ou UF no recorte de UF); null quando o recorte é um território */
  recorte: ResumoBinario | ResumoNumerico | null;
  /** o Brasil, para comparar com a UF ou com o território (null no próprio Brasil) */
  brasil: ResumoBinario | ResumoNumerico | null;
  /** a UF do município, para comparar (só no recorte de um município da MUNIC) */
  ufDoTerritorio: ResumoBinario | ResumoNumerico | null;
  territorio: RespostaTerritorio | null;
  /** territórios da edição no recorte (denominador de cobertura); 1 para um território */
  universo: number | null;
};

export type DadosPainel = { agregados: LinhaAgg[]; respostas: LinhaResp[]; universo: Universo[] };

/** Monta um cartão por indicador com os números já calculados; sem a edição, o cartão sai como não disponível. `ufDoMunicipio`: UF do município escolhido (MUNIC), para comparação. */
export function montarCartoes(sel: Selecionado[], dados: DadosPainel, escopo: Escopo, ufDoMunicipio: string | null = null): CartaoMunic[] {
  return sel.map(({ ind, fonte }) => {
    if (!fonte) return { ind, fonte: null, recorte: null, brasil: null, ufDoTerritorio: null, territorio: null, universo: null };
    const resumo = (corte: string, grupo: string) => (ind.tipo === 'binario' ? resumirBinario(dados.agregados, ind, fonte, corte, grupo) : resumirNumerico(dados.agregados, fonte, corte, grupo));
    const u = dados.universo.find((x) => x.ano === fonte.ano);
    return {
      ind, fonte,
      recorte: escopo.tipo === 'brasil' ? resumo('brasil', 'BR') : escopo.tipo === 'uf' ? resumo('uf', escopo.uf) : null,
      brasil: escopo.tipo === 'brasil' ? null : resumo('brasil', 'BR'),
      ufDoTerritorio: escopo.tipo === 'territorio' && ufDoMunicipio ? resumo('uf', ufDoMunicipio) : null,
      territorio: escopo.tipo === 'territorio' ? respostaDoTerritorio(dados.respostas, ind, fonte) : null,
      universo: escopo.tipo === 'territorio' ? 1 : u ? (escopo.tipo === 'uf' ? u.territorios_uf : u.territorios) : null,
    };
  });
}

/** Cobertura: respostas válidas ÷ territórios do recorte (null sem universo). */
export const cobertura = (validas: number, universo: number | null): number | null => (universo && universo > 0 ? validas / universo : null);

// ---------------- exportação ----------------

export type Lang = 'pt' | 'en';
export const COLUNAS_EXPORTACAO = (lang: Lang): string[] => (lang === 'en'
  ? ['Block', 'Indicator', 'Survey question (IBGE wording)', 'IBGE topic', 'Variable code', 'Survey', 'Edition', 'Scope', 'Indicator type', 'Answer of the municipality or state government',
    '"Yes" answers (numerator)', '"No" answers', 'Effective answers (Yes + No: denominator)', 'Share of "Yes"', 'Share unit', 'Without a valid answer (not in the base)', 'Territories in the scope (universe)',
    'Territories with a valid answer', 'Coverage of the universe (%)', 'Sum of numeric answers', 'Mean per territory with a value', 'Unit of the numeric answer', 'Brazil: share of "Yes"', 'Brazil: effective answers', 'Data condition']
  : ['Bloco', 'Indicador', 'Pergunta do questionário (enunciado do IBGE)', 'Tema do IBGE', 'Código da variável', 'Pesquisa', 'Edição', 'Recorte', 'Tipo do indicador', 'Resposta do município ou governo estadual',
    'Respostas "Sim" (numerador)', 'Respostas "Não"', 'Respostas efetivas (Sim + Não: denominador)', 'Participação de "Sim"', 'Unidade da participação', 'Sem resposta válida (fora da base)', 'Territórios do recorte (universo)',
    'Territórios com resposta válida', 'Cobertura do universo (%)', 'Soma das respostas numéricas', 'Média por território com valor', 'Unidade da resposta numérica', 'Brasil: participação de "Sim"', 'Brasil: respostas efetivas', 'Condição do dado']);

export type CondicaoMunic = 'observado' | 'sem_resposta_valida' | 'sem_dados' | 'nao_disponivel_edicao' | 'inesperada' | 'sem_registro';
export const rotuloCondicao = (c: CondicaoMunic, lang: Lang): string => ({
  observado: ['observado', 'observed'], sem_resposta_valida: ['sem resposta válida', 'no valid answer'], sem_dados: ['sem dados no recorte', 'no data in the scope'],
  nao_disponivel_edicao: ['não disponível nesta edição', 'not available in this edition'], inesperada: ['resposta fora do previsto: não calculada', 'unexpected answer: not computed'],
  sem_registro: ['sem resposta registrada', 'no answer recorded'],
} as Record<CondicaoMunic, [string, string]>)[c][lang === 'en' ? 1 : 0];

export function condicaoDoCartao(c: CartaoMunic): CondicaoMunic {
  if (!c.fonte) return 'nao_disponivel_edicao';
  if (c.territorio) {
    if (c.territorio.estado === 'sem_registro') return 'sem_registro';
    if (c.territorio.estado === 'sem_resposta') return 'sem_resposta_valida';
    if (c.territorio.estado === 'inesperada') return 'inesperada';
    return 'observado';
  }
  const r = c.recorte;
  if (!r || r.estado === 'sem_dados') return 'sem_dados';
  if (r.estado === 'inesperada') return 'inesperada';
  if ('pct' in r ? r.base === 0 : r.n === 0) return 'sem_resposta_valida';
  return 'observado';
}

export type ContextoExportacao = { lang: Lang; pesquisa: string; recorte: string; blocos: Record<BlocoMunic, string> };

/**
 * Uma linha por indicador do painel, inclusive os "não disponíveis nesta edição" (com a condição dita, sem número). Números saem
 * como números; participação e cobertura de 0 a 100; o território mostra a resposta, e os agregados, numerador e denominador.
 */
export function linhasExportacao(cartoes: CartaoMunic[], c: ContextoExportacao): (string | number | null)[][] {
  const en = c.lang === 'en';
  return cartoes.map((k) => {
    const { ind, fonte } = k;
    const base: (string | number | null)[] = [
      c.blocos[ind.bloco], en ? ind.titulo.en : ind.titulo.pt, fonte?.rotulo ?? null, fonte?.tema ?? null, fonte?.var ?? null, c.pesquisa, fonte?.ano ?? null, c.recorte,
      ind.tipo === 'binario' ? (en ? 'yes/no' : 'sim/não') : (en ? 'numeric' : 'numérico'),
    ];
    const t = k.territorio;
    const resposta = !t ? null : t.estado === 'valor' ? t.valor : t.estado === 'sem_registro' ? null : t.texto;
    const r = k.recorte;
    const bin = r && 'pct' in r ? r : null;
    const num = r && 'soma' in r ? r : null;
    const validas = t ? (t.estado === 'sim' || t.estado === 'nao' || t.estado === 'valor' ? 1 : 0) : bin ? bin.base : num ? num.n : null;
    const cob = !t && k.universo && validas !== null ? (validas / k.universo) * 100 : null;
    const br = k.brasil && 'pct' in k.brasil ? k.brasil : null;
    return [
      ...base, resposta,
      bin ? bin.sim : null, bin ? bin.nao : null, bin ? bin.base : null, bin?.pct != null ? bin.pct * 100 : null, bin ? '%' : null,
      (bin ?? num)?.semResposta ?? null, fonte ? k.universo : null, fonte ? validas : null, cob,
      num ? num.soma : null, num ? num.media : null, ind.tipo === 'numerico' ? (en ? ind.unidade?.en : ind.unidade?.pt) ?? null : null,
      br?.pct != null ? br.pct * 100 : null, br ? br.base : null, rotuloCondicao(condicaoDoCartao(k), c.lang),
    ];
  });
}

// ---------------- arquivos leves do painel ----------------

/** Caminhos FIXOS das cópias leves (nada vem do JSON do manifesto para dentro do SQL). */
export const ARQUIVOS_PAINEL = { respostas: 'gold/munic/painel_respostas.parquet', agregados: 'gold/munic/painel_agregados.parquet' } as const;

/**
 * Usa as cópias leves só quando o manifesto traz fontes.munic_painel com versao 1, declara os dois arquivos esperados e TODOS os
 * pares edição/variável pedidos estão em `pares` da pesquisa. Ausência, versão diferente, arquivo não declarado ou qualquer par
 * faltando: false, e a rota lê os gold completos (que têm as mesmas colunas e linhas).
 */
export function usarArquivosLeves(fonte: unknown, pedidos: Map<number, string[]>, pesquisa: Pesquisa): boolean {
  if (!fonte || typeof fonte !== 'object' || pedidos.size === 0) return false;
  const f = fonte as { versao?: unknown; pares?: unknown; arquivos?: unknown };
  if (f.versao !== 1 || !f.pares || typeof f.pares !== 'object' || !f.arquivos || typeof f.arquivos !== 'object') return false;
  const arq = f.arquivos as Record<string, unknown>;
  if (arq['painel_respostas.parquet'] !== ARQUIVOS_PAINEL.respostas || arq['painel_agregados.parquet'] !== ARQUIVOS_PAINEL.agregados) return false;
  const daPesquisa = (f.pares as Record<string, unknown>)[pesquisa];
  if (!daPesquisa || typeof daPesquisa !== 'object') return false;
  for (const [ano, vars] of pedidos) {
    const tem = (daPesquisa as Record<string, unknown>)[String(ano)];
    if (!Array.isArray(tem)) return false;
    const conjunto = new Set(tem.filter((v): v is string => typeof v === 'string'));
    if (!vars.every((v) => conjunto.has(v))) return false;
  }
  return true;
}

// ---------------- contexto entre as páginas da área ----------------

export type Destino = 'painel' | 'ficha' | 'avancado';

/**
 * Query que acompanha o menu e os links da área MUNIC: só pesq, uf, cod e ano, e só o que é válido (aba, var, grupo e outras escolhas
 * do explorador ficam para trás). No painel, o ano só segue se for uma edição curada. ESTADIC com UF e sem código abre a ficha do
 * governo dessa UF (código IBGE da UF), nunca o primeiro estado da lista.
 */
export function contextoMunic(search: string, destino: Destino, edicoes: Record<Pesquisa, number[]>): string {
  const sp = new URLSearchParams(search);
  const saida = new URLSearchParams();
  const pesquisa: Pesquisa = sp.get('pesq') === 'estadic' ? 'estadic' : 'munic';
  if (pesquisa === 'estadic') saida.set('pesq', 'estadic');
  let uf = sp.get('uf');
  if (uf !== null && !(UFS_MUNIC as readonly string[]).includes(uf)) uf = null;
  const cod = sp.get('cod');
  if (pesquisa === 'munic') {
    if (uf) saida.set('uf', uf);
    if (cod && /^\d{7}$/.test(cod)) saida.set('cod', cod);
  } else {
    const dono = cod && /^\d{2}$/.test(cod) ? Object.entries(COD_UF).find(([, v]) => v === Number(cod))?.[0] : undefined;
    const siglaUf = dono ?? uf; // o código manda quando existe
    if (siglaUf) {
      saida.set('uf', siglaUf);
      if (dono || destino === 'ficha') saida.set('cod', String(COD_UF[siglaUf]));
    }
  }
  const ano = sp.get('ano');
  if (ano && /^\d{4}$/.test(ano) && (destino !== 'painel' || edicoes[pesquisa].includes(Number(ano)))) saida.set('ano', ano);
  const q = saida.toString();
  return q ? `?${q}` : '';
}

/**
 * Contexto do cartão: o texto da curadoria, exceto no pessoal da administração indireta, que diz só o que se sabe do campo:
 * quadro distinto da direta, e quantidades sem valor válido ficam fora da soma.
 */
export function contextoDoIndicador(ind: IndicadorMunic, lang: Lang): string | null {
  if (ind.id.includes('_rh_indireta_')) {
    return lang === 'en'
      ? 'Indirect administration: a staff distinct from the direct administration’s. Counts without a valid value are left out of the sum.'
      : 'Administração indireta: quadro distinto do da administração direta. Quantidades sem valor válido ficam fora da soma.';
  }
  return ind.contexto ? (lang === 'en' ? ind.contexto.en : ind.contexto.pt) : null;
}
