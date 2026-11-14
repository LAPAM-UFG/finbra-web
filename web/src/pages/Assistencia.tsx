import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import '../assistencia.css';
import {
  linhaIndicadorSocial, mesSocial, obterGrupoSocial, obterMetaSocial, obterRankingSocial, useSocial,
  type FonteSocial, type GrupoSocial, type IndicadorSocial, type LinhaSocial, type MetaSocial, type TerritorioSocial,
} from '../assistencia_dados';
import { CartaoGrafico, Grafico, barras, linhas } from '../components/Grafico';
import { Estado } from '../components/Kpi';
import { exportar, type Celula, type Tabela } from '../exportar';
import { numero, reais, reaisCurto, reaisExato } from '../format';
import { idioma, local, t } from '../idioma';

/* ============================== básicos ============================== */

const PATH = {
  painel: '/assistencia', evolucao: '/assistencia/evolucao', rankings: '/assistencia/rankings',
  tabela: '/assistencia/tabela', metodologia: '/assistencia/metodologia',
};
const FONTES: FonteSocial[] = ['cadunico', 'pbf', 'bpc'];
const en = () => idioma() === 'en';
const nomeFonte = (f: FonteSocial) => (f === 'cadunico' ? 'CadÚnico' : f === 'pbf' ? 'Bolsa Família' : 'BPC');
const descFonte = (f: FonteSocial) => f === 'cadunico'
  ? t('Famílias e pessoas registradas para acesso a políticas sociais.', 'Families and people registered for access to social policies.')
  : f === 'pbf'
    ? t('Famílias na folha de pagamento do programa e pagamentos efetivos da CGU, em séries diferentes.', 'Families on the programme payroll and actual CGU payments, as different series.')
    : t('Benefícios de prestação continuada (BPC) com pagamento em cada mês.', 'Continuous cash benefits (BPC) with a payment in each month.');
const nomeInd = (i: IndicadorSocial) => (en() ? i.nome_en || i.nome : i.nome);
const temaInd = (i: IndicadorSocial) => (en() ? i.tema_en || i.tema : i.tema);
const descInd = (i: IndicadorSocial) => (en() ? i.descricao_en || i.descricao : i.descricao);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const mesValido = (n: number) => Number.isInteger(n) && n >= 200001 && n <= 210012 && n % 100 >= 1 && n % 100 <= 12;
const proxMes = (n: number) => (n % 100 === 12 ? (Math.floor(n / 100) + 1) * 100 + 1 : n + 1);
const mesIso = (n: number) => `${Math.floor(n / 100)}-${String(n % 100).padStart(2, '0')}`;
const curto = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const baseTxt = (m: MetaSocial) => (m.base_ipca > 9999 ? mesSocial(m.base_ipca) : t(`dezembro de ${m.base_ipca}`, `December ${m.base_ipca}`));
const decimalCsv = () => (en() ? '.' : ',');

const CONDICOES: Record<string, [string, string]> = {
  suprimido: ['Protegido pela fonte (valor omitido)', 'Protected by the source (value withheld)'],
  protegido_ou_ausente: ['Protegido ou não informado pela fonte', 'Protected or not reported by the source'],
  ausente: ['Não informado pela fonte', 'Not reported by the source'],
  indisponivel_ipca: ['Sem índice IPCA para este mês', 'No IPCA index for this month'],
  indisponivel: ['Indisponível', 'Unavailable'],
  sem_dado: ['Sem dado', 'No data'],
  nao_disponivel: ['Não disponível', 'Not available'],
  nao_aplicavel: ['Não se aplica', 'Not applicable'],
  parcial: ['Valor parcial', 'Partial value'],
  sem_competencia: ['Sem registro na fonte neste mês', 'Not recorded in the source this month'],
  nao_agregavel: ['Não agregável como pessoas únicas ou média', 'Not aggregable as unique people or average'],
  zero_registrado: ['Zero registrado pela fonte', 'Zero recorded by the source'],
  registrado: ['Registrado pela fonte', 'Recorded by the source'],
};
const condTxt = (c: string) => {
  const x = CONDICOES[c];
  return x ? t(x[0], x[1]) : c.replace(/_/g, ' ');
};

function fmt(i: IndicadorSocial, v: number | null | undefined, longo = false): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '–';
  switch (i.unidade) {
    case 'moeda': return longo ? reaisExato(v) : reais(v);
    case 'razao': return `${(v * 100).toLocaleString(local(), { maximumFractionDigits: 1 })}%`;
    case 'indice': return v.toLocaleString(local(), { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    case 'decimal': return v.toLocaleString(local(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    default: return Number.isInteger(v) ? numero(v) : v.toLocaleString(local(), { maximumFractionDigits: 2 });
  }
}
const fmtEixo = (i: IndicadorSocial) => (v: number) => (i.unidade === 'moeda' ? reaisCurto(v) : fmt(i, v));
const unidadeTxt = (i: IndicadorSocial, m: MetaSocial) => {
  switch (i.unidade) {
    case 'moeda': return i.precos === 'reais' ? t(`R$ de ${baseTxt(m)} (IPCA)`, `R$ of ${baseTxt(m)} (IPCA)`) : t('R$ nominais', 'nominal R$');
    case 'razao': return t('% (razão)', '% (ratio)');
    case 'indice': return t('índice 0–1', 'index 0–1');
    case 'decimal': return t('decimal', 'decimal');
    default: return t('número', 'count');
  }
};
/** Unidade explícita nos arquivos exportados (valor bruto). */
const unidadeBruta = (i: IndicadorSocial, m: MetaSocial) => {
  switch (i.unidade) {
    case 'moeda': return i.precos === 'reais' ? t(`R$ de ${baseTxt(m)} (IPCA)`, `R$ of ${baseTxt(m)} (IPCA)`) : t('R$ nominais', 'nominal R$');
    case 'razao': return t('razão (fração; ×100 = %)', 'ratio (fraction; ×100 = %)');
    case 'indice': return t('índice de 0 a 1', 'index from 0 to 1');
    case 'decimal': return t('decimal', 'decimal');
    default: return t('número', 'count');
  }
};
const condDe = (l: LinhaSocial | undefined, id: string) => l?.condicoes[id];
const valDe = (l: LinhaSocial | undefined, id: string) => { const v = l?.valores[id]; return v === undefined ? null : v; };

function Val({ i, v, cond, longo }: { i: IndicadorSocial; v: number | null | undefined; cond?: string; longo?: boolean }) {
  if (v === null || v === undefined) return <span className="as-nulo">{cond ? condTxt(cond) : t('sem valor', 'no value')}</span>;
  return <>{fmt(i, v, longo)}{cond && <small className="as-cond"> · {condTxt(cond)}</small>}</>;
}

/* ============================== filtros ============================== */

type Terr = { grupo: string; nome: string; nivel: 'BR' | 'UF' | 'M'; uf: string | null; cod: number | null };
type Aviso = { texto: string; limpar?: 'territorio' | 'ano' };
type Filtro = { terr: Terr; ufSel: string | null; mes: number | null; avisos: Aviso[] };
type Ctx = {
  meta: MetaSocial; f: Filtro; mapa: Map<string, IndicadorSocial>; territorios: Map<string, TerritorioSocial>;
  alterar: (m: Record<string, string | null>) => void; sp: URLSearchParams;
  link: (caminho: string, extra?: Record<string, string | null>) => { pathname: string; search: string };
};

const NORONHA = 2605459;
const rotuloTerr = (x: { nome: string; nivel: string; uf: string | null; grupo?: string; cod_ibge?: number | null; cod?: number | null }) => {
  const cod = x.cod_ibge ?? x.cod;
  if (cod === NORONHA) return `${x.nome} (${t('distrito estadual de PE', 'state district of PE')})`;
  if (x.grupo === 'DF') return `${x.nome} (${t('ente único: UF e município', 'single entity: state and municipality')})`;
  return x.nivel === 'M' && x.uf ? `${x.nome} (${x.uf})` : x.nome;
};

function resolver(meta: MetaSocial, sp: URLSearchParams): Filtro {
  const avisos: Aviso[] = [];
  const ufs = meta.territorios.filter(x => x.nivel === 'UF');
  const porGrupo = new Map(meta.territorios.map(x => [x.grupo, x]));
  const paraTerr = (x: TerritorioSocial): Terr => ({ grupo: x.grupo, nome: x.nome, nivel: x.nivel, uf: x.uf ?? (x.nivel === 'UF' ? x.grupo : null), cod: x.cod_ibge });
  const brasil: Terr = { grupo: 'BR', nome: t('Brasil', 'Brazil'), nivel: 'BR', uf: null, cod: null };
  const ufRaw = (sp.get('uf') ?? '').trim();
  const codRaw = (sp.get('cod') ?? '').trim();
  let uf: string | null = null;
  let invalido = false;
  if (ufRaw) {
    const u = ufRaw.toUpperCase();
    if (ufs.some(x => x.grupo === u)) uf = u; else invalido = true;
  }
  let alvo: TerritorioSocial | 'BR' | null = null;
  if (codRaw) {
    const c = codRaw.toUpperCase();
    if (c === 'BR') alvo = 'BR';
    else if (/^[A-Z]{2}$/.test(c)) alvo = ufs.find(x => x.grupo === c) ?? null;
    else if (c === '53' || c === '5300108') alvo = porGrupo.get('DF') ?? null;
    else if (/^\d{7}$/.test(c)) alvo = meta.territorios.find(x => x.nivel === 'M' && x.cod_ibge === Number(c)) ?? null;
    if (!alvo) invalido = true;
  }
  let conflito = false;
  if (!invalido && alvo && uf) {
    const ufAlvo = alvo === 'BR' ? null : alvo.nivel === 'UF' ? alvo.grupo : alvo.uf;
    if (ufAlvo !== uf) conflito = true;
  }
  let terr = brasil;
  let ufSel: string | null = null;
  if (invalido || conflito) {
    avisos.push({
      texto: invalido
        ? t(`O endereço traz um território que não existe nos dados (uf=${curto(ufRaw, 12)} cod=${curto(codRaw, 12)}). Mostrando o Brasil; escolha o recorte abaixo.`,
          `The link has a territory that does not exist in the data (uf=${curto(ufRaw, 12)} cod=${curto(codRaw, 12)}). Showing Brazil; choose the area below.`)
        : t(`UF e município do endereço não combinam (uf=${curto(ufRaw, 12)} cod=${curto(codRaw, 12)}). Mostrando o Brasil; escolha o recorte abaixo.`,
          `The state and municipality in the link do not match (uf=${curto(ufRaw, 12)} cod=${curto(codRaw, 12)}). Showing Brazil; choose the area below.`),
      limpar: 'territorio',
    });
  } else if (alvo) {
    if (alvo === 'BR') terr = brasil;
    else { terr = paraTerr(alvo); ufSel = alvo.nivel === 'UF' ? alvo.grupo : alvo.uf; }
  } else if (uf) {
    const x = ufs.find(y => y.grupo === uf)!;
    terr = paraTerr(x); ufSel = uf;
  }
  let mes: number | null = null;
  const mesRaw = (sp.get('mes') ?? '').trim();
  const anoRaw = (sp.get('ano') ?? '').trim();
  if (mesRaw) {
    if (/^\d{6}$/.test(mesRaw) && mesValido(Number(mesRaw))) mes = Number(mesRaw);
    else avisos.push({ texto: t(`O mês "${curto(mesRaw, 12)}" do endereço não é válido (use AAAAMM). Mostrando o último mês de cada indicador.`, `The month "${curto(mesRaw, 12)}" in the link is not valid (use YYYYMM). Showing the latest month of each indicator.`) });
  } else if (anoRaw) {
    if (/^\d{4}$/.test(anoRaw) && mesValido(Number(anoRaw) * 100 + 12)) {
      mes = Number(anoRaw) * 100 + 12;
      avisos.push({
        texto: t(`O endereço pedia o ano ${anoRaw}. Este painel é mensal: estamos mostrando dezembro de ${anoRaw} e cada indicador só aparece se tiver exatamente esse mês. Escolha outro mês abaixo, se preferir.`,
          `The link asked for the year ${anoRaw}. This panel is monthly: showing December ${anoRaw}, and each indicator only appears if it has exactly that month. Pick another month below if you prefer.`),
        limpar: 'ano',
      });
    } else avisos.push({ texto: t(`O ano "${curto(anoRaw, 12)}" do endereço não é válido. Mostrando o último mês de cada indicador.`, `The year "${curto(anoRaw, 12)}" in the link is not valid. Showing the latest month of each indicator.`), limpar: 'ano' });
  }
  if (mes && !FONTES.some(f => meta.fontes[f]?.competencias.includes(mes))) {
    avisos.push({ texto: t(`Nenhuma fonte tem dados em ${mesSocial(mes)}. Escolha um dos meses disponíveis.`, `No source has data for ${mesSocial(mes)}. Choose one of the available months.`) });
  }
  return { terr, ufSel, mes, avisos };
}

function mesesUniao(meta: MetaSocial): [number, FonteSocial[]][] {
  const m = new Map<number, FonteSocial[]>();
  for (const f of FONTES) for (const c of meta.fontes[f]?.competencias ?? []) (m.get(c) ?? m.set(c, []).get(c)!).push(f);
  return [...m.entries()].sort((a, b) => b[0] - a[0]);
}

function BuscaMunicipio({ ctx, onEscolher }: { ctx: Ctx; onEscolher: (x: TerritorioSocial) => void }) {
  const id = useId();
  const [texto, setTexto] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const { meta, f } = ctx;
  const indice = useMemo(() => meta.territorios.filter(x => x.nivel === 'M' && x.cod_ibge !== 5300108).map(x => ({ x, n: norm(x.nome) })), [meta]);
  const atualNome = f.terr.nivel === 'M' ? f.terr.nome : '';
  const q = norm((texto ?? '').trim());
  const opcoes = useMemo(() => {
    if (!aberto || texto === null || q.length < (f.ufSel ? 1 : 2)) return [];
    const digitos = /^\d+$/.test(q);
    return indice
      .filter(({ x, n }) => (!f.ufSel || x.uf === f.ufSel) && (digitos ? String(x.cod_ibge).startsWith(q) : n.includes(q)))
      .sort((a, b) => Number(b.n.startsWith(q)) - Number(a.n.startsWith(q)) || a.n.localeCompare(b.n))
      .slice(0, 12).map(o => o.x);
  }, [indice, q, f.ufSel, aberto, texto]);
  const escolher = (x: TerritorioSocial) => { onEscolher(x); setTexto(null); setAberto(false); };
  const lista = `${id}-lista`;
  return (
    <div className="as-campo as-campo-larga as-combo">
      <label htmlFor={`${id}-in`}>{t('Município (digite o nome)', 'Municipality (type the name)')}</label>
      <input id={`${id}-in`} type="text" role="combobox" autoComplete="off" aria-expanded={aberto && texto !== null && q.length > 0}
        aria-controls={lista} aria-autocomplete="list" aria-activedescendant={opcoes[ativo] ? `${id}-o${ativo}` : undefined}
        placeholder={f.ufSel ? t('Todos os municípios de ', 'All municipalities in ') + f.ufSel : t('Ex.: Campinas', 'E.g. Campinas')}
        value={texto ?? atualNome}
        onChange={e => { setTexto(e.target.value); setAberto(true); setAtivo(0); }}
        onFocus={e => e.currentTarget.select()}
        onBlur={() => { setAberto(false); setTexto(null); }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAberto(true); setAtivo(a => Math.min(a + 1, Math.max(opcoes.length - 1, 0))); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo(a => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter' && opcoes[ativo]) { e.preventDefault(); escolher(opcoes[ativo]); }
          else if (e.key === 'Escape') { setAberto(false); setTexto(null); }
        }} />
      {aberto && texto !== null && q.length >= (f.ufSel ? 1 : 2) && (
        <ul id={lista} role="listbox" aria-label={t('Municípios encontrados', 'Matching municipalities')}>
          {opcoes.length === 0 && <li className="as-vazio" role="presentation">{t('Nenhum município encontrado', 'No municipality found')}</li>}
          {opcoes.map((x, k) => (
            <li key={x.grupo} id={`${id}-o${k}`} role="option" aria-selected={k === ativo}
              onMouseDown={e => { e.preventDefault(); escolher(x); }} onMouseEnter={() => setAtivo(k)}>
              {x.nome}<small>{x.uf}{x.cod_ibge === NORONHA ? ` · ${t('distrito estadual', 'state district')}` : ''}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BarraFiltros({ ctx, mes }: { ctx: Ctx; mes: boolean }) {
  const { meta, f, alterar } = ctx;
  const ufs = useMemo(() => meta.territorios.filter(x => x.nivel === 'UF').sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')), [meta]);
  const meses = useMemo(() => mesesUniao(meta), [meta]);
  const fora = f.mes && !meses.some(([m]) => m === f.mes);
  const idUf = useId(); const idMes = useId();
  return (
    <form className="as-filtros" role="search" aria-label={t('Recorte do painel', 'Panel filters')} onSubmit={e => e.preventDefault()}>
      <div className="as-campo">
        <label htmlFor={idUf}>{t('Brasil ou estado', 'Brazil or state')}</label>
        <select id={idUf} value={f.ufSel ?? ''} onChange={e => alterar({ uf: e.target.value || null, cod: null })}>
          <option value="">{t('Brasil', 'Brazil')}</option>
          {ufs.map(u => <option key={u.grupo} value={u.grupo}>{u.nome} ({u.grupo})</option>)}
        </select>
      </div>
      <BuscaMunicipio ctx={ctx} onEscolher={x => alterar({ uf: x.uf, cod: String(x.cod_ibge) })} />
      {f.terr.nivel === 'M' && (
        <button type="button" className="botao-leve" onClick={() => alterar({ cod: null })}>{t('Limpar município', 'Clear municipality')}</button>
      )}
      {mes && (
        <div className="as-campo">
          <label htmlFor={idMes}>{t('Mês de referência', 'Reference month')}</label>
          <select id={idMes} value={f.mes ?? ''} onChange={e => alterar({ mes: e.target.value || null, ano: null })}>
            <option value="">{t('Último de cada indicador', 'Latest of each indicator')}</option>
            {fora && f.mes && <option value={f.mes}>{mesSocial(f.mes)} ({t('sem dados', 'no data')})</option>}
            {meses.map(([m, fs]) => <option key={m} value={m}>{mesSocial(m)} · {fs.map(nomeFonte).join(', ')}</option>)}
          </select>
        </div>
      )}
    </form>
  );
}

const ABAS: [keyof typeof PATH, string, string][] = [
  ['painel', 'Painel', 'Overview'], ['evolucao', 'Evolução', 'Trends'], ['rankings', 'Rankings', 'Rankings'],
  ['tabela', 'Tabela', 'Table'], ['metodologia', 'Metodologia', 'Methodology'],
];

function Casca({ titulo, sub, mes = true, atual, children }: {
  titulo: string; sub: string; mes?: boolean; atual: keyof typeof PATH; children: (c: Ctx) => ReactNode;
}) {
  const m = useSocial('meta', obterMetaSocial);
  return (
    <div className="assistencia-painel">
      <h2 className="titulo-pagina">{titulo}</h2>
      <p className="as-sub">{sub}</p>
      {m.carregando && <Estado carregando />}
      {m.erro && <Estado erro={m.erro} mensagem={t('Não foi possível carregar o painel de assistência social.', 'The social assistance panel could not be loaded.')} tentarNovamente={m.recarregar} />}
      {m.dados && <Corpo meta={m.dados} mes={mes} atual={atual}>{children}</Corpo>}
    </div>
  );
}

function Corpo({ meta, mes, atual, children }: { meta: MetaSocial; mes: boolean; atual: keyof typeof PATH; children: (c: Ctx) => ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const f = useMemo(() => resolver(meta, sp), [meta, sp]);
  const mapa = useMemo(() => new Map(meta.indicadores.map(i => [i.id, i])), [meta]);
  const territorios = useMemo(() => new Map(meta.territorios.map(x => [x.grupo, x])), [meta]);
  const alterar = (m: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(m)) { if (v === null) n.delete(k); else n.set(k, v); }
    setSp(n, { replace: true });
  };
  const link = (caminho: string, extra: Record<string, string | null> = {}) => {
    const p = new URLSearchParams();
    if (f.ufSel) p.set('uf', f.ufSel);
    if (f.terr.nivel === 'M' && f.terr.cod) p.set('cod', String(f.terr.cod));
    if (f.mes) p.set('mes', String(f.mes));
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
    const s = p.toString();
    return { pathname: caminho, search: s ? `?${s}` : '' };
  };
  const ctx: Ctx = { meta, f, mapa, territorios, alterar, sp, link };
  return (
    <>
      <nav className="as-nav" aria-label={t('Seções de assistência social', 'Social assistance sections')}>
        {ABAS.map(([k, pt, e]) => (
          <Link key={k} to={link(PATH[k], { indicador: k === 'painel' || k === 'metodologia' ? null : sp.get('indicador') })} aria-current={k === atual ? 'page' : undefined}>{t(pt, e)}</Link>
        ))}
      </nav>
      {f.avisos.map((a, k) => (
        <div key={k} className="as-aviso" role="status">
          <p>{a.texto}</p>
          {a.limpar === 'territorio' && <button className="botao-leve" onClick={() => alterar({ uf: null, cod: null })}>{t('Limpar recorte', 'Clear area')}</button>}
          {a.limpar === 'ano' && <button className="botao-leve" onClick={() => alterar({ ano: null, mes: null })}>{t('Usar o último mês de cada indicador', 'Use the latest month of each indicator')}</button>}
        </div>
      ))}
      {atual !== 'metodologia' && <BarraFiltros ctx={ctx} mes={mes} />}
      {atual !== 'metodologia' && <p className="as-recorte" role="status">{rotuloTerr(f.terr)} · {f.mes ? mesSocial(f.mes) : t('Última referência de cada indicador', 'Latest reference of each indicator')}</p>}
      {children(ctx)}
    </>
  );
}

/* ============================== exportação ============================== */

function Baixar({ nome, obter, rotulo }: { nome: string; obter: () => Tabela; rotulo?: string }) {
  return (
    <span className="as-baixar">
      {rotulo ?? t('Baixar:', 'Download:')}
      <button className="botao-leve" onClick={() => exportar(nome, 'csv', obter(), decimalCsv())}>CSV</button>
      <button className="botao-leve" onClick={() => exportar(nome, 'xlsx', obter(), decimalCsv())}>XLSX</button>
    </span>
  );
}
function metadadosBase(c: Ctx, extra: [string, string][] = []): [string, string][] {
  const { meta, f } = c;
  return [
    [t('Painel', 'Panel'), t('Assistência social: CadÚnico, Bolsa Família e BPC', 'Social assistance: CadÚnico, Bolsa Família and BPC')],
    [t('Território', 'Territory'), rotuloTerr(f.terr)],
    [t('Mês escolhido', 'Chosen month'), f.mes ? mesSocial(f.mes) : t('último de cada indicador', 'latest of each indicator')],
    ...FONTES.map((x): [string, string] => [`${t('Fonte', 'Source')} ${nomeFonte(x)}`, `${meta.fontes[x]?.nome ?? ''} · ${meta.fontes[x]?.url ?? ''}`]),
    ...FONTES.flatMap(x => (en() ? meta.fontes[x]?.avisos_en : meta.fontes[x]?.avisos ?? []).map((nota, k): [string, string] => [`${t('Nota', 'Note')} ${nomeFonte(x)} ${k + 1}`, nota])),
    [t('Gerado em', 'Generated on'), meta.gerado_em],
    [t('Valores', 'Values'), t(`Valores em branco não são zero: a coluna Condição explica a ausência. Razões saem como fração (valor bruto). Valores em R$ nominais, exceto indicadores marcados como R$ de ${baseTxt(meta)} (IPCA).`,
      `Blank values are not zero: the Condition column explains the absence. Ratios are exported as raw fractions. Amounts are nominal R$ unless marked as R$ of ${baseTxt(meta)} (IPCA).`)],
    [t('Aviso', 'Notice'), t('Os três programas medem coisas diferentes e as pessoas podem estar em mais de um: não some os totais.', 'The three programmes measure different things and people may be in more than one: do not add the totals.')],
    ...extra,
  ];
}

/* ============================== comuns de página ============================== */

function Paginacao({ total, pagina, tam, onPag }: { total: number; pagina: number; tam: number; onPag: (p: number) => void }) {
  const ultima = Math.max(0, Math.ceil(total / tam) - 1);
  if (total <= tam) return null;
  return (
    <div className="as-pag">
      <span>{t(`Linhas ${pagina * tam + 1}–${Math.min(total, (pagina + 1) * tam)} de ${numero(total)}`, `Rows ${pagina * tam + 1}–${Math.min(total, (pagina + 1) * tam)} of ${numero(total)}`)}</span>
      <span>
        <button className="botao-leve" disabled={pagina <= 0} onClick={() => onPag(0)}>{t('Início', 'First')}</button>{' '}
        <button className="botao-leve" disabled={pagina <= 0} onClick={() => onPag(pagina - 1)}>{t('Anterior', 'Previous')}</button>{' '}
        <button className="botao-leve" disabled={pagina >= ultima} onClick={() => onPag(pagina + 1)}>{t('Próxima', 'Next')}</button>
      </span>
    </div>
  );
}

function useGrupo(grupo: string | null) {
  return useSocial<GrupoSocial>(grupo ? `g:${grupo}` : null, () => obterGrupoSocial(grupo!));
}
function defaultInd(meta: MetaSocial): IndicadorSocial {
  return meta.indicadores.find(i => i.destaque && i.fonte === 'cadunico') ?? meta.indicadores.find(i => i.destaque) ?? meta.indicadores[0];
}
function indSelecionado(c: Ctx): IndicadorSocial | undefined {
  const id = c.sp.get('indicador');
  return (id && c.mapa.get(id)) || defaultInd(c.meta);
}

/** Terr + comparadores (UF e Brasil) lidos dos agregados da fonte, nunca somando municípios. */
function useRecorte(c: Ctx, comparar = true) {
  const { terr } = c.f;
  const g = useGrupo(terr.grupo);
  const ufGrupo = comparar && terr.nivel === 'M' && terr.uf ? terr.uf : null;
  const gu = useGrupo(ufGrupo);
  const gb = useGrupo(comparar && terr.nivel !== 'BR' ? 'BR' : null);
  return { g, gu, gb, ufGrupo };
}

/* ============================== PAINEL ============================== */

/** Linha real do indicador no território: última com o id publicado, ou o mês exato pedido. */
const linInd = (gr: GrupoSocial | undefined, i: IndicadorSocial, mes?: number | null) => linhaIndicadorSocial(gr, i, mes ?? undefined);
const refTxt = (l: LinhaSocial | undefined) => (l ? mesSocial(l.competencia) : '–');
const SEM_DADO = () => t('sem dado publicado', 'no data published');
const SEM_COMPARAVEL = () => t('sem dado comparável nesse mês', 'no comparable data for that month');

/** Valor de comparação (UF ou Brasil) exatamente na mesma competência do território. */
function CelulaComp({ i, gr, ref0 }: { i: IndicadorSocial; gr: GrupoSocial | undefined; ref0: LinhaSocial | undefined }) {
  if (!ref0) return <span className="as-nulo">–</span>;
  const l = linInd(gr, i, ref0.competencia);
  return l ? <Val i={i} v={valDe(l, i.id)} cond={condDe(l, i.id)} longo /> : <span className="as-nulo">{SEM_COMPARAVEL()}</span>;
}

/** Natureza da medida: unidades diferentes (famílias, pessoas, benefícios, valores) nunca dividem o mesmo gráfico. */
const sujeito = (i: IndicadorSocial) => {
  const s = norm(i.nome);
  if (i.unidade === 'moeda') return /medi/.test(s) ? 'vm' : 'vt';
  if (/responsave/.test(s)) return 'r';
  if (/beneficio/.test(s)) return 'b';
  if (/famil|domicilio/.test(s)) return 'f';
  if (/pessoa|crianca|adolescente|idos|jovem|mulher|homem|trabalhador|adult/.test(s)) return 'p';
  return 'o';
};
const sujeitoTxt = (k: string) => ({
  f: t('famílias', 'families'), p: t('pessoas', 'people'), b: t('benefícios', 'benefits'), r: t('responsáveis pagos (NIS distintos)', 'paid guardians (distinct NIS)'),
  vm: t('valores médios', 'average amounts'), vt: t('valores totais (soma)', 'total amounts (sum)'), o: t('outras medidas', 'other measures'),
}[k] ?? k);

function GraficoTema({ itens, gT, mes, meta }: { itens: IndicadorSocial[]; gT: GrupoSocial | undefined; mes: number | null; meta: MetaSocial }) {
  const [k, setK] = useState('');
  const grupos = useMemo(() => {
    const m = new Map<string, { i: IndicadorSocial; v: number }[]>();
    for (const i of itens) {
      const l = linInd(gT, i, mes); const v = valDe(l, i.id);
      if (!l || v === null) continue;
      const chave = `${i.unidade}|${i.precos ?? ''}|${sujeito(i)}|${i.id.startsWith('pbf_cgu_') ? 'cgu' : i.fonte}|${l.competencia}`;
      (m.get(chave) ?? m.set(chave, []).get(chave)!).push({ i, v });
    }
    return [...m.entries()].filter(([, a]) => a.length >= 2);
  }, [itens, gT, mes]);
  const atual = grupos.find(([x]) => x === k) ?? grupos[0];
  const dados = useMemo(() => {
    if (!atual) return null;
    const ord = [...atual[1]].sort((a, b) => b.v - a.v).slice(0, 12);
    return { ord, opcao: barras(ord.map(o => curto(nomeInd(o.i), 46)), ord.map(o => o.v), fmtEixo(ord[0].i)) };
  }, [atual]);
  const rotulo = (x: string, a: { i: IndicadorSocial }[]) => {
    const p = x.split('|');
    return `${sujeitoTxt(p[2])} · ${unidadeTxt(a[0].i, meta)} · ${p[3] === 'cgu' ? t('pagamentos CGU', 'CGU payments') : nomeFonte(p[3] as FonteSocial)} · ${mesSocial(Number(p[4]))}`;
  };
  if (!atual || !dados) {
    return <p className="as-resumo">{t('Este tema não tem duas ou mais medidas do mesmo tipo e do mesmo mês para um gráfico; use a tabela, que mostra a referência de cada indicador.', 'This theme has no two or more measures of the same type and month for a chart; use the table, which shows each indicator reference.')}</p>;
  }
  const [chave, lista] = atual;
  return (
    <>
      {grupos.length > 1 && (
        <div className="as-campo" style={{ maxWidth: 520 }}>
          <label>{t('Medidas no gráfico (mesmo tipo e mesmo mês)', 'Measures in the chart (same type and month)')}
            <select value={chave} onChange={e => setK(e.target.value)} style={{ width: '100%' }}>
              {grupos.map(([x, a]) => <option key={x} value={x}>{rotulo(x, a)}</option>)}
            </select>
          </label>
        </div>
      )}
      <CartaoGrafico
        titulo={rotulo(chave, lista)}
        desc={t('Cada barra é uma medida independente, todas do mesmo mês. Podem se sobrepor (as mesmas pessoas ou famílias entram em várias) e não somam um total.',
          'Each bar is an independent measure, all from the same month. They may overlap (the same people or families appear in several) and do not add up to a total.')}
        tabela={<table className="as-tabela"><thead><tr><th>{t('Indicador', 'Indicator')}</th><th className="as-num">{t('Referência', 'Reference')}</th><th className="as-num">{t('Valor', 'Value')}</th></tr></thead>
          <tbody>{dados.ord.map(o => <tr key={o.i.id}><td>{nomeInd(o.i)}</td><td className="as-num">{mesSocial(Number(chave.split('|')[4]))}</td><td className="as-num">{fmt(o.i, o.v, true)}</td></tr>)}</tbody></table>}>
        <Grafico opcao={dados.opcao} altura={Math.max(170, dados.ord.length * 34 + 24)} nome={`assistencia_${chave.split('|')[0]}`}
          descricao={t('Gráfico de barras das medidas do tema; os valores estão na opção Tabela', 'Bar chart of the theme measures; values are in the Table option')} />
      </CartaoGrafico>
      {lista.length > 12 && <p className="as-resumo">{t('O gráfico limita-se às 12 maiores medidas; as demais estão na tabela do tema.', 'The chart shows the 12 largest measures; the others are in the theme table.')}</p>}
    </>
  );
}

function TemaCorpo({ itens, gT, gU, gB, sel, onSel, c }: {
  itens: IndicadorSocial[]; gT: GrupoSocial | undefined; gU: GrupoSocial | undefined; gB: GrupoSocial | undefined;
  sel: string | undefined; onSel: (id: string) => void; c: Ctx;
}) {
  const [grafico, setGrafico] = useState(false);
  const mostraU = !!gU; const mostraB = !!gB;
  return (
    <div className="as-tema-corpo">
      <div className="as-acoes">
        <button className="botao-leve" aria-pressed={grafico} onClick={() => setGrafico(x => !x)}>{grafico ? t('Ocultar gráfico', 'Hide chart') : t('Ver gráfico de barras', 'Show bar chart')}</button>
      </div>
      {grafico && <GraficoTema itens={itens} gT={gT} mes={c.f.mes} meta={c.meta} />}
      <div className="as-tabela-rolagem">
        <table className="as-tabela">
          <caption className="sr-only">{t('Indicadores do tema, cada um com sua data de referência', 'Theme indicators, each with its reference date')}</caption>
          <thead><tr>
            <th>{t('Indicador', 'Indicator')}</th>
            <th className="as-num">{t('Referência', 'Reference')}</th>
            <th className="as-num">{c.f.terr.nome}</th>
            {mostraU && <th className="as-num">{c.f.terr.uf}</th>}
            {mostraB && <th className="as-num">{t('Brasil', 'Brazil')}</th>}
          </tr></thead>
          <tbody>
            {itens.map(i => {
              const l = linInd(gT, i, c.f.mes);
              return (
                <tr key={i.id} className={sel === i.id ? 'as-destaque' : undefined}>
                  <td>
                    <button className="as-ind" aria-pressed={sel === i.id} onClick={() => onSel(i.id)}>{nomeInd(i)}</button>
                    <span className="as-tag">{unidadeTxt(i, c.meta)}</span>
                    <span className="as-descr">{descInd(i)}</span>
                  </td>
                  <td className="as-num">{l ? mesSocial(l.competencia) : '–'}</td>
                  <td className="as-num">{l ? <Val i={i} v={valDe(l, i.id)} cond={condDe(l, i.id)} longo /> : <span className="as-nulo">{c.f.mes ? t(`sem dado em ${mesSocial(c.f.mes)}`, `no data for ${mesSocial(c.f.mes)}`) : SEM_DADO()}</span>}</td>
                  {mostraU && <td className="as-num"><CelulaComp i={i} gr={gU} ref0={l} /></td>}
                  {mostraB && <td className="as-num"><CelulaComp i={i} gr={gB} ref0={l} /></td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Perfil pronto do CadÚnico: só medidas em famílias de um tema, na referência de cada indicador; tabela sempre disponível. */
function PerfilCad({ g, c, tema, titulo, desc }: { g: GrupoSocial; c: Ctx; tema: string; titulo: string; desc: string }) {
  const { meta, f } = c;
  const linhasP = useMemo(() => meta.indicadores
    .filter(i => i.fonte === 'cadunico' && i.tema === tema && i.nome.startsWith('Famílias:'))
    .map(i => {
      const l = linInd(g, i, f.mes);
      return { i, l, v: valDe(l, i.id), cond: condDe(l, i.id), rot: nomeInd(i).replace(/^(Famílias|Families):\s*/i, '') };
    }), [meta, g, tema, f.mes]);
  const com = linhasP.filter(x => x.v !== null);
  const datas = [...new Set(linhasP.filter(x => x.l).map(x => mesSocial(x.l!.competencia)))];
  const opcao = useMemo(() => barras(com.map(x => curto(x.rot, 50)), com.map(x => x.v), v => numero(v)), [com]);
  const tabela = (
    <table className="as-tabela">
      <caption className="sr-only">{titulo}</caption>
      <thead><tr><th>{t('Categoria', 'Category')}</th><th className="as-num">{t('Famílias', 'Families')}</th></tr></thead>
      <tbody>{linhasP.map(x => <tr key={x.i.id}><td>{x.rot}</td><td className="as-num">{x.l ? <Val i={x.i} v={x.v} cond={x.cond} longo /> : <span className="as-nulo">{f.mes ? t(`sem dado em ${mesSocial(f.mes)}`, `no data for ${mesSocial(f.mes)}`) : SEM_DADO()}</span>}</td></tr>)}</tbody>
    </table>
  );
  return (
    <section className="as-perfil" aria-label={titulo}>
      {com.length >= 2 ? (
        <CartaoGrafico titulo={titulo} desc={desc} tabela={tabela}>
          <Grafico opcao={opcao} altura={Math.max(150, com.length * 36 + 24)} nome={`assistencia_perfil_${tema}`}
            descricao={t('Barras de famílias por categoria; os valores estão na opção Tabela', 'Bars of families by category; values are in the Table option')} />
        </CartaoGrafico>
      ) : (
        <div className="cartao"><h3>{titulo}</h3><p className="desc">{desc}</p>
          <p className="as-resumo">{linhasP.length ? t('Poucos valores disponíveis para o gráfico; veja a tabela.', 'Too few values for a chart; see the table.') : t('Sem medidas neste recorte.', 'No measures in this selection.')}</p>
          {linhasP.length > 0 && <div className="as-tabela-rolagem">{tabela}</div>}</div>
      )}
      <p className="as-resumo">{t('CadÚnico, referência', 'CadÚnico, reference')} {datas.join(', ') || '–'}. {com.length < linhasP.length && t('Valores protegidos pela fonte não entram no gráfico e nunca valem zero. ', 'Source-protected values are left out of the chart and never count as zero. ')}{t('Cada barra é uma medida independente de famílias, sem soma e sem misturar com pessoas.', 'Each bar is an independent measure of families, not added up and not mixed with people.')}</p>
    </section>
  );
}

function PainelCorpo({ c }: { c: Ctx }) {
  const { meta, f } = c;
  const { g, gu, gb } = useRecorte(c);
  const [busca, setBusca] = useState('');
  const [fonteF, setFonteF] = useState<'todas' | FonteSocial>('todas');
  const [abertos, setAbertos] = useState<Set<string>>(new Set());
  const sel = indSelecionado(c);
  const alvo = useMemo(() => new Map(meta.indicadores.map(i => [i.id, norm([i.id, i.nome, i.nome_en, i.tema, i.tema_en, i.descricao, i.descricao_en, nomeFonte(i.fonte)].join(' '))])), [meta]);
  const temas = useMemo(() => {
    const m = new Map<string, { fonte: FonteSocial; tema: string; itens: IndicadorSocial[] }>();
    for (const i of meta.indicadores) {
      const k = `${i.fonte}|${i.tema}`;
      if (!m.has(k)) m.set(k, { fonte: i.fonte, tema: i.tema, itens: [] });
      m.get(k)!.itens.push(i);
    }
    return [...m.entries()];
  }, [meta]);
  const tokens = norm(busca).split(/\s+/).filter(Boolean);
  const casa = (i: IndicadorSocial) => tokens.every(x => alvo.get(i.id)!.includes(x));
  const visiveis = temas
    .filter(([, x]) => fonteF === 'todas' || x.fonte === fonteF)
    .map(([k, x]) => ({ k, ...x, filtrados: tokens.length ? x.itens.filter(casa) : x.itens }))
    .filter(x => x.filtrados.length);
  const selecionar = (id: string) => c.alterar({ indicador: id });
  const abrir = (k: string) => {
    setAbertos(p => new Set(p).add(k));
    setTimeout(() => { const el = document.getElementById(`as-tema-${k.replace(/[^a-z0-9]/gi, '_')}`); el?.scrollIntoView({ block: 'start' }); el?.querySelector('summary')?.focus(); }, 30);
  };

  if (g.carregando || gu.carregando || gb.carregando) return <Estado carregando />;
  const erro = g.erro ?? gu.erro ?? gb.erro;
  if (erro || !g.dados) return <Estado erro={erro ?? ''} tentarNovamente={() => { g.recarregar(); gu.recarregar(); gb.recarregar(); }} />;

  const resumoExportar = (): Tabela => ({
    colunas: [t('Território', 'Territory'), t('Fonte', 'Source'), t('Mês de referência do indicador', 'Indicator reference month'), t('Tema', 'Theme'), t('Indicador', 'Indicator'), t('Valor', 'Value'), t('Unidade', 'Unit'), t('Condição', 'Condition')],
    linhas: meta.indicadores.map((i): Celula[] => {
      const l = linInd(g.dados, i, f.mes);
      const v = valDe(l, i.id); const cd = condDe(l, i.id);
      return [rotuloTerr(f.terr), nomeFonte(i.fonte), l ? mesIso(l.competencia) : '', temaInd(i), nomeInd(i), v, unidadeBruta(i, meta),
        cd ? condTxt(cd) : (!l ? (f.mes ? t('sem dado no mês escolhido', 'no data for the chosen month') : SEM_DADO()) : v === null ? t('sem valor', 'no value') : '')];
    }),
    metadados: metadadosBase(c),
  });

  return (
    <>
      <h3 className="sr-only">{t('Números em destaque', 'Key figures')}</h3>
      <div className="as-fontes">
        {FONTES.map(fo => {
          const dest = meta.indicadores.filter(i => i.fonte === fo && i.destaque).slice(0, 4);
          const linhasD = dest.map(i => linInd(g.dados, i, f.mes));
          const datas = [...new Set(linhasD.filter((l): l is LinhaSocial => !!l).map(l => l.competencia))];
          const comps = meta.fontes[fo]?.competencias ?? [];
          const cabeca = fo !== 'pbf' && datas.length === 1 ? t(`Dados de ${mesSocial(datas[0])}`, `Data for ${mesSocial(datas[0])}`)
            : datas.length === 0 ? (f.mes ? t(`Sem dados em ${mesSocial(f.mes)}`, `No data for ${mesSocial(f.mes)}`) : t('Sem dados publicados', 'No data published'))
              : t('Referências por indicador', 'References by indicator');
          return (
            <section key={fo} className={`as-fonte as-${fo}`} aria-labelledby={`as-h-${fo}`}>
              <h3 id={`as-h-${fo}`}>{nomeFonte(fo)}</h3>
              <p className="as-fonte-desc">{descFonte(fo)}</p>
              <span className={`as-data${datas.length ? '' : ' as-sem'}`}>{cabeca}</span>
              {datas.length === 0 && f.mes && comps.length > 0 && (
                <p className="as-retrato">{t(`Esta fonte tem dados de ${mesSocial(comps[0])} a ${mesSocial(comps[comps.length - 1])}.`, `This source has data from ${mesSocial(comps[0])} to ${mesSocial(comps[comps.length - 1])}.`)}</p>
              )}
              <div className="as-kpis">
                {dest.map((i, k) => {
                  const l = linhasD[k]; const v = valDe(l, i.id);
                  const comp = (gr: GrupoSocial | undefined, rot: string) => {
                    if (!gr || !l) return null;
                    const lc = linInd(gr, i, l.competencia);
                    return lc ? `${rot}: ${valDe(lc, i.id) === null ? (condDe(lc, i.id) ? condTxt(condDe(lc, i.id)!) : '–') : fmt(i, valDe(lc, i.id))}` : `${rot}: ${SEM_COMPARAVEL()}`;
                  };
                  const cmp = [comp(gu.dados, f.terr.uf ?? ''), comp(gb.dados, t('Brasil', 'Brazil'))].filter(Boolean);
                  return (
                    <button key={i.id} className="as-kpi" aria-pressed={sel?.id === i.id} onClick={() => selecionar(i.id)}>
                      <span className="as-kpi-rot">{nomeInd(i)}</span>
                      <span className="as-kpi-val">{l ? <Val i={i} v={v} cond={condDe(l, i.id)} /> : <span className="as-nulo">{f.mes ? t('sem dado no mês', 'no data for the month') : SEM_DADO()}</span>}</span>
                      {l && <span className="as-kpi-cmp">{t('Referência', 'Reference')} {refTxt(l)}</span>}
                      {cmp.length > 0 && <span className="as-kpi-cmp">{cmp.join(' · ')}</span>}
                    </button>
                  );
                })}
              </div>
              {fo === 'cadunico' && comps.length <= 1 && <p className="as-retrato">{t('Retrato cadastral; histórico ainda indisponível.', 'Registry snapshot; history not yet available.')}</p>}
              {fo === 'pbf' && <p className="as-retrato">{t('Reúne a folha mensal do MDS e os pagamentos da CGU, que são séries diferentes, com datas próprias. Famílias da folha não são os responsáveis pagos nos pagamentos CGU.', 'Combines the MDS monthly payroll and CGU payments, which are different series with their own dates. Families in the payroll are not the guardians paid in the CGU payments.')}</p>}
              {fo === 'bpc' && <p className="as-retrato">{t('Idosos e pessoas com deficiência: tipos indisponíveis (a fonte não traz a espécie do benefício e eles não são inferidos).', 'Older adults and people with disabilities: types unavailable (the source does not carry the benefit type and they are not inferred).')}</p>}
            </section>
          );
        })}
      </div>

      {sel && (() => {
        const ls = linInd(g.dados, sel, f.mes);
        return (
          <section className="as-sel" aria-label={t('Indicador selecionado', 'Selected indicator')}>
            <div>
              <h3>{nomeInd(sel)} <span className="as-tag">{nomeFonte(sel.fonte)}</span></h3>
              <p className="as-grande">{ls ? <Val i={sel} v={valDe(ls, sel.id)} cond={condDe(ls, sel.id)} longo /> : <span className="as-nulo">{f.mes ? t(`sem dado em ${mesSocial(f.mes)}`, `no data for ${mesSocial(f.mes)}`) : SEM_DADO()}</span>}</p>
              <p>{unidadeTxt(sel, meta)} · {t('Referência', 'Reference')} {refTxt(ls)}</p>
              <p>{descInd(sel)}</p>
            </div>
            <div className="as-atalhos">
              <Link to={c.link(PATH.evolucao, { indicador: sel.id })}>{t('Evolução', 'Trend')}</Link>
              <Link to={c.link(PATH.rankings, { indicador: sel.id })}>{t('Ranking', 'Ranking')}</Link>
              <Link to={c.link(PATH.tabela, { indicador: sel.id, fonte: sel.fonte })}>{t('Tabela', 'Table')}</Link>
            </div>
          </section>
        );
      })()}

      <div className="as-perfis">
        <PerfilCad g={g.dados} c={c} tema="Renda por pessoa" titulo={t('Renda das famílias cadastradas', 'Income of registered families')}
          desc={t('Famílias do CadÚnico por faixa de renda por pessoa.', 'CadÚnico families by income-per-person band.')} />
        <PerfilCad g={g.dados} c={c} tema="Arranjo familiar" titulo={t('Como as famílias são formadas', 'How families are formed')}
          desc={t('Famílias do CadÚnico por tipo de arranjo familiar.', 'CadÚnico families by family arrangement.')} />
      </div>

      <section className="cartao as-indice" aria-labelledby="as-ind-h">
        <h3 id="as-ind-h">{t('Todos os indicadores, por tema', 'All indicators, by theme')}</h3>
        <p className="desc">{t('Pesquise por palavra (ex.: criança, renda, deficiência) ou abra um tema. Cada tema tem tabela, com a data de cada indicador, e gráfico de barras.', 'Search by word (e.g. child, income, disability) or open a theme. Each theme has a table, with each indicator date, and a bar chart.')}</p>
        <div className="as-filtros" style={{ margin: 0, padding: 0, border: 0, background: 'none' }}>
          <div className="as-campo as-campo-larga">
            <label htmlFor="as-busca">{t('Buscar indicador', 'Search indicator')}</label>
            <input id="as-busca" type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder={t('Ex.: renda, mulheres, deficiência', 'E.g. income, women, disability')} />
          </div>
          <div className="as-campo">
            <span className="as-rotulo" id="as-fonte-rot">{t('Programa', 'Programme')}</span>
            <div className="as-seg" role="group" aria-labelledby="as-fonte-rot">
              {(['todas', ...FONTES] as const).map(x => (
                <button key={x} aria-pressed={fonteF === x} onClick={() => setFonteF(x)}>{x === 'todas' ? t('Todos', 'All') : nomeFonte(x)}</button>
              ))}
            </div>
          </div>
        </div>
        <p className="as-resumo" role="status" aria-live="polite">
          {tokens.length
            ? t(`${visiveis.reduce((s, x) => s + x.filtrados.length, 0)} indicadores em ${visiveis.length} temas`, `${visiveis.reduce((s, x) => s + x.filtrados.length, 0)} indicators in ${visiveis.length} themes`)
            : t(`${meta.indicadores.length} indicadores em ${temas.length} temas`, `${meta.indicadores.length} indicators in ${temas.length} themes`)}
        </p>
        <nav aria-label={t('Índice de temas', 'Theme index')} className="as-chips">
          {visiveis.map(x => (
            <button key={x.k} className="as-chip" onClick={() => abrir(x.k)}>
              {x.itens[0] && temaInd(x.itens[0])}<small>{nomeFonte(x.fonte)} · {x.filtrados.length}</small>
            </button>
          ))}
        </nav>
        {visiveis.length === 0 && <p className="vazio">{t('Nenhum indicador encontrado para essa busca.', 'No indicator matches this search.')}</p>}
      </section>

      {visiveis.map(x => {
        const aberto = abertos.has(x.k) || tokens.length > 0;
        return (
          <details key={x.k} className="as-tema" id={`as-tema-${x.k.replace(/[^a-z0-9]/gi, '_')}`} open={aberto}
            onToggle={e => {
              if (tokens.length) return;
              const o = (e.currentTarget as HTMLDetailsElement).open;
              setAbertos(p => { if (p.has(x.k) === o) return p; const n = new Set(p); if (o) n.add(x.k); else n.delete(x.k); return n; });
            }}>
            <summary>{temaInd(x.itens[0])} <small>{nomeFonte(x.fonte)} · {x.filtrados.length} {t('indicadores', 'indicators')}</small></summary>
            {aberto && <TemaCorpo itens={x.filtrados} gT={g.dados} gU={gu.dados} gB={gb.dados} sel={sel?.id} onSel={selecionar} c={c} />}
          </details>
        );
      })}

      <section className="cartao" style={{ marginTop: 18 }}>
        <h3>{t('Antes de comparar os números', 'Before comparing the numbers')}</h3>
        <ul className="as-notas">
          <li>{t('Cadastro, folha e pagamento são coisas diferentes: o CadÚnico registra famílias e pessoas (estar no cadastro não significa ser elegível nem receber); a folha do Bolsa Família (MDS) conta famílias previstas para o mês; os pagamentos da CGU e o BPC contam o que foi efetivamente pago.', 'Registry, payroll and payment are different things: CadÚnico registers families and people (being registered does not mean being eligible or receiving); the Bolsa Família payroll (MDS) counts families scheduled for the month; the CGU payments and BPC count what was actually paid.')}</li>
          <li>{t('Uma pessoa ou família pode estar nos três programas ao mesmo tempo: por isso o painel não soma CadÚnico, Bolsa Família e BPC em um total único.', 'A person or family can be in all three programmes at once, which is why the panel does not add them into a single total.')}</li>
          <li>{t('Cada indicador tem sua data de referência; indicadores do mesmo bloco podem ser de meses diferentes. Comparações com estado e Brasil só aparecem na mesma data do indicador.', 'Each indicator has its own reference date; indicators in the same block may be from different months. State and Brazil comparisons only appear for the same date as the indicator.')}</li>
          <li>{t('Valores em branco indicam dado ausente ou protegido pela fonte; nunca significam zero. Um indicador que a fonte não publicou naquele mês aparece sem dado, não como zero.', 'Blank values mean missing or source-protected data; they never mean zero. An indicator the source did not publish that month appears without data, not as zero.')}</li>
          <li>{t('Estado e Brasil dependem da fonte: o CadÚnico usa totais próprios do MDS (com a proteção de valores pequenos preservada); o BPC agrega direto os pagamentos; a folha do Bolsa Família soma municípios só quando a cobertura do mês é completa (sem média); nos pagamentos da CGU, valores em dinheiro são somáveis, mas responsáveis municipais não viram pessoas únicas de estado ou Brasil. Sem cobertura, fica sem dado. Detalhes na Metodologia.', 'State and Brazil depend on the source: CadÚnico uses MDS own totals (with small-value protection preserved); BPC aggregates payments directly; the Bolsa Família payroll adds municipalities only when the month has complete coverage (never averages); in CGU payments, money amounts can be added, but municipal guardians do not become unique people for a state or Brazil. Without coverage, it is left blank. Details in Methodology.')}</li>
        </ul>
        <div className="as-acoes"><Baixar nome={`assistencia_resumo_${f.terr.grupo}`} obter={resumoExportar} rotulo={t('Baixar resumo (um valor por indicador, com sua data):', 'Download summary (one value per indicator, with its date):')} /></div>
      </section>
    </>
  );
}

export function AssistenciaPainel() {
  return (
    <Casca atual="painel" titulo={t('Assistência social', 'Social assistance')}
      sub={t('Quantas famílias estão no CadÚnico, quantas recebem o Bolsa Família e quantos benefícios do BPC são pagos, no Brasil, no seu estado ou no seu município.',
        'How many families are in CadÚnico, how many receive Bolsa Família and how many BPC benefits are paid, in Brazil, your state or your municipality.')}>
      {c => <PainelCorpo c={c} />}
    </Casca>
  );
}

/* ============================== EVOLUÇÃO ============================== */

function SeletorIndicador({ c, valor, onEscolher, fonte, rotulo }: { c: Ctx; valor: string; onEscolher: (i: IndicadorSocial) => void; fonte?: FonteSocial; rotulo?: string }) {
  const [busca, setBusca] = useState('');
  const idB = useId(); const idS = useId();
  const q = norm(busca).split(/\s+/).filter(Boolean);
  const lista = c.meta.indicadores.filter(i => (!fonte || i.fonte === fonte) && (i.id === valor || q.every(x => norm(`${i.nome} ${i.nome_en} ${i.tema} ${i.tema_en}`).includes(x))));
  const grupos = new Map<string, IndicadorSocial[]>();
  for (const i of lista) { const k = `${nomeFonte(i.fonte)} · ${temaInd(i)}`; (grupos.get(k) ?? grupos.set(k, []).get(k)!).push(i); }
  return (
    <>
      <div className="as-campo as-campo-larga">
        <label htmlFor={idB}>{t('Buscar indicador', 'Search indicator')}</label>
        <input id={idB} type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder={t('Digite para reduzir a lista', 'Type to narrow the list')} />
      </div>
      <div className="as-campo as-campo-larga">
        <label htmlFor={idS}>{rotulo ?? t('Indicador', 'Indicator')} ({lista.length})</label>
        <select id={idS} value={valor} onChange={e => { const i = c.mapa.get(e.target.value); if (i) onEscolher(i); }}>
          {[...grupos.entries()].map(([k, a]) => <optgroup key={k} label={k}>{a.map(i => <option key={i.id} value={i.id}>{nomeInd(i)}</option>)}</optgroup>)}
        </select>
      </div>
    </>
  );
}

type Serie = { rot: string; valores: (number | null)[]; conds: (string | undefined)[] };
function sequencia(comps: number[]): number[] {
  if (!comps.length) return [];
  const a: number[] = [];
  for (let m = Math.min(...comps); m <= Math.max(...comps); m = proxMes(m)) a.push(m);
  return a;
}
function serieDe(g: GrupoSocial | undefined, fonte: FonteSocial, id: string, meses: number[], rot: string): Serie | null {
  if (!g) return null;
  const map = new Map(g.series[fonte].map(l => [l.competencia, l]));
  return {
    // mês sem linha, ou linha que não publicou o indicador, é ausência estrutural: lacuna, nunca zero
    rot, valores: meses.map(m => valDe(map.get(m), id)),
    conds: meses.map(m => { const l = map.get(m); return l && id in l.valores ? condDe(l, id) : 'sem_competencia'; }),
  };
}

function EvolucaoCorpo({ c }: { c: Ctx }) {
  const { meta, f } = c;
  const ind = indSelecionado(c)!;
  const fonte = ind.fonte;
  const cmp = (c.sp.get('cmp') ?? '').split(',');
  const podeUf = f.terr.nivel === 'M' && !!f.terr.uf;
  const podeBr = f.terr.nivel !== 'BR';
  const usaUf = podeUf && cmp.includes('uf'); const usaBr = podeBr && cmp.includes('br');
  const g = useGrupo(f.terr.grupo);
  const gu = useGrupo(usaUf ? f.terr.uf : null);
  const gb = useGrupo(usaBr ? 'BR' : null);
  const comps = useMemo(() => [...(ind.competencias?.length ? ind.competencias : meta.fontes[fonte]?.competencias ?? [])].sort((a, b) => a - b), [ind, meta, fonte]);
  const todos = useMemo(() => sequencia(comps), [comps]);
  const ini = Number(c.sp.get('ini')); const fim = Number(c.sp.get('fim'));
  const i0 = comps.includes(ini) ? ini : comps[0]; const f0 = comps.includes(fim) && fim >= i0 ? fim : comps[comps.length - 1];
  const meses = todos.filter(m => m >= i0 && m <= f0);
  const unico = comps.length < 2;

  const dados = useMemo(() => {
    const ss: Serie[] = [];
    const a = serieDe(g.dados, fonte, ind.id, meses, f.terr.nome); if (a) ss.push(a);
    const b = usaUf ? serieDe(gu.dados, fonte, ind.id, meses, f.terr.uf ?? '') : null; if (b) ss.push(b);
    const d = usaBr ? serieDe(gb.dados, fonte, ind.id, meses, t('Brasil', 'Brazil')) : null; if (d) ss.push(d);
    return ss;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.dados, gu.dados, gb.dados, ind.id, fonte, i0, f0, usaUf, usaBr, f.terr.nome, f.terr.uf]);
  const opcao = useMemo(
    () => linhas(meses.map(mesSocial), dados.map(s => ({ nome: s.rot, valores: s.valores })), fmtEixo(ind),
      ind.id.startsWith('pbf_cgu_') ? [['11/2021', 'Auxílio Brasil'], ['03/2023', 'Bolsa Família']].filter(([x]) => meses.map(mesSocial).includes(x)).map(([x, rotulo]) => ({ x, rotulo })) : [], true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dados, ind.id],
  );
  const acum = useMemo(() => {
    if (!ind.acumulavel || !dados[0]) return [];
    const anos = new Map<number, { soma: number; n: number }>();
    meses.forEach((m, k) => {
      const v = dados[0].valores[k]; const a = Math.floor(m / 100);
      const x = anos.get(a) ?? anos.set(a, { soma: 0, n: 0 }).get(a)!;
      if (v !== null) { x.soma += v; x.n += 1; }
    });
    return [...anos.entries()].filter(([, x]) => x.n > 0).map(([ano, x]) => ({ ano, ...x, parcial: x.n < 12 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dados, ind.acumulavel]);
  const opcaoAcum = useMemo(
    () => barras(acum.map(a => (a.parcial ? `${a.ano} (${a.n}/12)*` : String(a.ano))), acum.map(a => a.soma), fmtEixo(ind), false),
    [acum, ind],
  );

  const alternar = (k: string) => {
    const n = new Set(cmp.filter(Boolean)); if (n.has(k)) n.delete(k); else n.add(k);
    c.alterar({ cmp: n.size ? [...n].join(',') : null });
  };
  const exportarSerie = (): Tabela => ({
    colunas: [t('Data', 'Date'), t('Território', 'Territory'), t('Fonte', 'Source'), t('Indicador', 'Indicator'), t('Valor', 'Value'), t('Unidade', 'Unit'), t('Condição', 'Condition')],
    linhas: dados.flatMap(s => meses.map((m, k): Celula[] => {
      const cd = s.conds[k];
      return [mesIso(m), s.rot, nomeFonte(fonte), nomeInd(ind), s.valores[k], unidadeBruta(ind, meta), cd ? condTxt(cd) : (s.valores[k] === null ? t('sem valor', 'no value') : '')];
    })),
    metadados: metadadosBase(c, [[t('Indicador', 'Indicator'), `${ind.id}: ${descInd(ind)}`], [t('Período', 'Period'), `${meses.length ? mesSocial(meses[0]) : ''} – ${meses.length ? mesSocial(meses[meses.length - 1]) : ''}`]]),
  });
  const exportarAcum = (): Tabela => ({
    colunas: [t('Ano', 'Year'), t('Acumulado no ano', 'Year total'), t('Meses com valor', 'Months with value'), t('Parcial', 'Partial'), t('Unidade', 'Unit')],
    linhas: acum.map((a): Celula[] => [a.ano, a.soma, `${a.n}/12`, a.parcial ? t('sim', 'yes') : t('não', 'no'), unidadeBruta(ind, meta)]),
    metadados: metadadosBase(c, [[t('Indicador', 'Indicator'), `${ind.id}: ${descInd(ind)}`]]),
  });

  const carregando = g.carregando || gu.carregando || gb.carregando;
  const erro = g.erro ?? gu.erro ?? gb.erro;
  const ultimo = g.dados ? linhaIndicadorSocial(g.dados, ind) : undefined;
  const transicao = ind.id.startsWith('pbf_cgu_') && meses.some(m => m >= 202111 && m <= 202302);


  return (
    <>
      <div className="as-filtros">
        <SeletorIndicador c={c} valor={ind.id} onEscolher={i => c.alterar({ indicador: i.id, ini: null, fim: null })} />
        {!unico && (
          <>
            <div className="as-campo"><label htmlFor="as-ini">{t('De', 'From')}</label>
              <select id="as-ini" value={i0} onChange={e => c.alterar({ ini: e.target.value })}>{comps.map(m => <option key={m} value={m}>{mesSocial(m)}</option>)}</select></div>
            <div className="as-campo"><label htmlFor="as-fim">{t('Até', 'To')}</label>
              <select id="as-fim" value={f0} onChange={e => c.alterar({ fim: e.target.value })}>{comps.filter(m => m >= i0).map(m => <option key={m} value={m}>{mesSocial(m)}</option>)}</select></div>
          </>
        )}
        {(podeUf || podeBr) && (
          <fieldset className="as-campo" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="as-rotulo" style={{ fontSize: 13, padding: 0 }}>{t('Comparar com (opcional)', 'Compare with (optional)')}</legend>
            {podeUf && <label className="as-check"><input type="checkbox" checked={usaUf} onChange={() => alternar('uf')} /> {t('Estado', 'State')} {f.terr.uf}</label>}
            {podeBr && <label className="as-check"><input type="checkbox" checked={usaBr} onChange={() => alternar('br')} /> {t('Brasil', 'Brazil')}</label>}
          </fieldset>
        )}
      </div>

      <section className="cartao">
        <h3>{nomeInd(ind)} <span className="as-tag">{nomeFonte(fonte)}</span><span className="as-tag">{unidadeTxt(ind, meta)}</span></h3>
        <p className="desc">{descInd(ind)}</p>
        {ind.precos === 'reais' && <p className="as-resumo">{t(`Valor já corrigido pelo IPCA para reais de ${baseTxt(meta)}; é um indicador próprio, calculado na origem. Meses sem índice ficam em branco.`, `Amount already adjusted by IPCA to ${baseTxt(meta)} reais; it is its own indicator, computed at source. Months without an index are left blank.`)}</p>}
        {ind.unidade === 'moeda' && ind.precos !== 'reais' && <p className="as-resumo">{t('Valores nominais: não corrigidos pela inflação. Compare meses distantes com cuidado.', 'Nominal values: not adjusted for inflation. Compare distant months with care.')}</p>}
        {f.mes && !comps.includes(f.mes) && <p className="as-resumo">{t(`Este indicador não tem dado em ${mesSocial(f.mes)} (o mês do endereço); a série mostra todo o período disponível, de ${comps.length ? mesSocial(comps[0]) : '–'} a ${comps.length ? mesSocial(comps[comps.length - 1]) : '–'}.`, `This indicator has no data for ${mesSocial(f.mes)} (the month in the link); the chart shows the whole available period, from ${comps.length ? mesSocial(comps[0]) : '–'} to ${comps.length ? mesSocial(comps[comps.length - 1]) : '–'}.`)}</p>}
        {transicao && <p className="as-resumo"><strong>{t('Mudança de programa:', 'Programme change:')}</strong> {t('os pagamentos desta série passam do Bolsa Família para o Auxílio Brasil e voltam ao Bolsa Família (marcas no gráfico). Em nov/2021 os arquivos têm os dois programas, e entre nov/2021 e fev/2023 falta o Benefício Extraordinário do Auxílio Brasil. Não leia a linha como uma única série contínua do Bolsa Família.', 'the payments in this series move from Bolsa Família to Auxílio Brasil and back (marks on the chart). In Nov/2021 the files contain both programmes, and between Nov/2021 and Feb/2023 the Auxílio Brasil Extraordinary Benefit is missing. Do not read the line as one continuous Bolsa Família series.')}</p>}
        {carregando && <Estado carregando />}
        {erro && <Estado erro={erro} tentarNovamente={() => { g.recarregar(); gu.recarregar(); gb.recarregar(); }} />}
        {!carregando && !erro && g.dados && (
          unico ? (
            <>
              <p className="as-resumo"><strong>{fonte === 'cadunico' ? t('Retrato cadastral; histórico ainda indisponível.', 'Registry snapshot; history not yet available.') : t('Este indicador tem um único mês publicado.', 'This indicator has a single published month.')}</strong>{' '}
                {ultimo ? t(`Único mês disponível: ${mesSocial(ultimo.competencia)}.`, `Only month available: ${mesSocial(ultimo.competencia)}.`) : ''}</p>
              {ultimo && <p className="as-grande" style={{ fontSize: 26, fontWeight: 650, margin: '4px 0' }}><Val i={ind} v={valDe(ultimo, ind.id)} cond={condDe(ultimo, ind.id)} longo /></p>}
            </>
          ) : (
            <>
              {(usaUf || usaBr) && <p className="as-resumo">{t('Atenção: estado e Brasil têm valores muito maiores que um município; a linha do território pode parecer achatada.', 'Note: states and Brazil have much larger values than a municipality; the territory line may look flat.')}</p>}
              <Grafico opcao={opcao} altura={320} nome={`assistencia_${ind.id}`}
                descricao={t('Gráfico de linha mensal; lacunas indicam meses sem valor. Os valores estão na tabela abaixo.', 'Monthly line chart; gaps mean months without a value. Values are in the table below.')} />
              <p className="as-resumo">{t('Meses sem valor aparecem como lacunas na linha, não como zero.', 'Months without a value appear as gaps in the line, not as zero.')}</p>
            </>
          )
        )}
      </section>

      {!carregando && !erro && g.dados && !unico && (
        ind.acumulavel ? (
          <CartaoGrafico titulo={t('Acumulado por ano', 'Total by year')}
            desc={t('Soma dos meses com valor em cada ano (somente para indicadores de fluxo). Anos incompletos estão marcados com * e mostram quantos meses entraram (N/12).', 'Sum of months with a value in each year (flow indicators only). Incomplete years are marked * and show how many months were included (N/12).')}
            tabela={<AcumTabela acum={acum} ind={ind} />}
            acoes={<Baixar nome={`assistencia_acumulado_${ind.id}`} obter={exportarAcum} rotulo="" />}>
            {acum.length ? <Grafico opcao={opcaoAcum} altura={260} nome={`assistencia_acum_${ind.id}`} descricao={t('Barras do acumulado anual; valores na opção Tabela', 'Bars of the yearly total; values in the Table option')} />
              : <p className="vazio">{t('Sem meses com valor no período.', 'No months with a value in the period.')}</p>}
          </CartaoGrafico>
        ) : (
          <p className="as-resumo">{t('Este indicador é um estoque, proporção ou média mensal: não faz sentido somar os meses em um total anual.', 'This indicator is a monthly stock, ratio or average: adding months into a yearly total would not make sense.')}</p>
        )
      )}

      {!carregando && !erro && g.dados && (
        <section className="cartao">
          <h3>{t('Tabela da série', 'Series table')}</h3>
          <div className="as-acoes"><Baixar nome={`assistencia_evolucao_${ind.id}`} obter={exportarSerie} /></div>
          <div className="rolagem as-tabela-rolagem">
            <table className="as-tabela">
              <thead><tr>
                <th>{t('Mês', 'Month')}</th>
                {dados.map(s => <th key={s.rot} className="as-num">{s.rot}</th>)}
                <th className="as-txt">{t('Condição', 'Condition')}</th>
              </tr></thead>
              <tbody>
                {[...meses.keys()].reverse().map(k => (
                  <tr key={meses[k]}>
                    <td>{mesSocial(meses[k])}</td>
                    {dados.map(s => <td key={s.rot} className="as-num"><Val i={ind} v={s.valores[k]} cond={s.valores[k] === null ? s.conds[k] : undefined} longo /></td>)}
                    <td className="as-txt">{dados[0]?.conds[k] ? condTxt(dados[0].conds[k]!) : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="as-atalhos">
        <Link to={c.link(PATH.rankings, { indicador: ind.id })}>{t('Ver ranking deste indicador', 'See this indicator ranking')}</Link>
        <Link to={c.link(PATH.tabela, { indicador: ind.id, fonte })}>{t('Ver na tabela longa', 'See in the long table')}</Link>
        <Link to={c.link(PATH.painel, { indicador: ind.id })}>{t('Voltar ao painel', 'Back to the overview')}</Link>
      </div>
    </>
  );
}
function AcumTabela({ acum, ind }: { acum: { ano: number; soma: number; n: number; parcial: boolean }[]; ind: IndicadorSocial }) {
  return (
    <table className="as-tabela">
      <thead><tr><th>{t('Ano', 'Year')}</th><th className="as-num">{t('Acumulado', 'Total')}</th><th className="as-num">{t('Meses', 'Months')}</th><th className="as-txt">{t('Situação', 'Status')}</th></tr></thead>
      <tbody>{acum.map(a => <tr key={a.ano}><td>{a.ano}</td><td className="as-num">{fmt(ind, a.soma, true)}</td><td className="as-num">{a.n}/12</td><td className="as-txt">{a.parcial ? t('parcial', 'partial') : t('completo', 'complete')}</td></tr>)}</tbody>
    </table>
  );
}

export function AssistenciaEvolucao() {
  return (
    <Casca atual="evolucao" mes={false} titulo={t('Assistência social: evolução', 'Social assistance: trends')}
      sub={t('Veja como um indicador muda mês a mês. Escolha o indicador, o período e, se quiser, compare com o estado ou o Brasil.', 'See how an indicator changes month by month. Pick the indicator, the period and, if you wish, compare with the state or Brazil.')}>
      {c => <EvolucaoCorpo c={c} />}
    </Casca>
  );
}

/* ============================== RANKINGS ============================== */

function RankingsCorpo({ c }: { c: Ctx }) {
  const { meta, f } = c;
  const ind = indSelecionado(c)!;
  const fonte = ind.fonte;
  const nivel = c.sp.get('nivel') === 'UF' ? 'UF' : 'M';
  const dir = c.sp.get('ordem') === 'asc' ? 'asc' : 'desc';
  const modo = c.sp.get('mostrar') === 'todos' ? 'todos' : 'top50';
  const comps = useMemo(() => Object.keys(meta.rankings[fonte] ?? {}).map(Number).filter(n => Number.isFinite(n) && (!ind.competencias?.length || ind.competencias.includes(n))).sort((a, b) => b - a), [meta, fonte, ind]);
  const mesPedido = f.mes;
  const comp = mesPedido ? (comps.includes(mesPedido) ? mesPedido : null) : (comps[0] ?? null);
  const r = useSocial(comp ? `r:${fonte}:${comp}` : null, () => obterRankingSocial(fonte, comp!));
  const [busca, setBusca] = useState('');
  const [pag, setPag] = useState<{ chave: string; p: number }>({ chave: '', p: 0 });
  const chavePag = `${fonte}${ind.id}${comp}${nivel}${dir}${modo}${f.ufSel}${busca}`;
  const pagina = pag.chave === chavePag ? pag.p : 0;

  const todas = useMemo(() => {
    if (!r.dados) return null;
    // um único arquivo traz municípios e UFs; Brasília (município) sai quando o DF já está como UF, para não duplicar
    const temDF = r.dados.linhas.some(l => l.grupo === 'DF');
    const linhasR = r.dados.linhas.map(l => ({ te: c.territorios.get(l.grupo), v: l.valores[ind.id] ?? null, cond: l.condicoes[ind.id], publicado: ind.id in l.valores }))
      .filter(x => x.te && x.te.nivel === nivel && !(temDF && x.te.cod_ibge === 5300108) && (nivel === 'UF' || !f.ufSel || x.te.uf === f.ufSel)) as { te: TerritorioSocial; v: number | null; cond?: string; publicado: boolean }[];
    const com = linhasR.filter(x => x.v !== null).sort((a, b) => (dir === 'asc' ? a.v! - b.v! : b.v! - a.v!) || a.te.nome.localeCompare(b.te.nome, 'pt-BR'));
    let pos = 0;
    const ranq = com.map((x, k) => { if (k === 0 || x.v !== com[k - 1].v) pos = k + 1; return { ...x, pos }; });
    const sem = linhasR.filter(x => x.v === null).sort((a, b) => a.te.nome.localeCompare(b.te.nome, 'pt-BR'));
    const porCond = new Map<string, number>();
    for (const x of sem) { const k = x.cond ? condTxt(x.cond) : x.publicado ? t('sem valor informado', 'no value reported') : t('indicador não publicado neste território/mês', 'indicator not published for this territory/month'); porCond.set(k, (porCond.get(k) ?? 0) + 1); }
    return { ranq, sem, porCond, total: linhasR.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.dados, ind.id, nivel, dir, f.ufSel, c.territorios]);

  const q = norm(busca.trim());
  const filtrada = todas ? (q ? todas.ranq.filter(x => norm(x.te.nome).includes(q) || String(x.te.cod_ibge).startsWith(q)) : todas.ranq) : [];
  const tam = 50;
  const visiveis = modo === 'top50' ? filtrada.slice(0, tam) : filtrada.slice(pagina * tam, (pagina + 1) * tam);
  const exportarTudo = (): Tabela => ({
    colunas: [t('Posição', 'Rank'), t('Território', 'Territory'), t('Tipo', 'Type'), 'UF', t('Código IBGE', 'IBGE code'), t('Valor', 'Value'), t('Unidade', 'Unit'), t('Condição', 'Condition'), t('Competência', 'Period'), t('Indicador', 'Indicator'), t('Fonte', 'Source')],
    linhas: [...todas!.ranq.map(x => ({ ...x, p: x.pos as number | null })), ...todas!.sem.map(x => ({ ...x, p: null as number | null }))].map((x): Celula[] => [
      x.p, x.te.nome, x.te.nivel === 'UF' ? (x.te.grupo === 'DF' ? t('Distrito Federal (ente único)', 'Federal District (single entity)') : t('UF', 'State')) : x.te.cod_ibge === NORONHA ? t('Distrito estadual', 'State district') : t('Município', 'Municipality'),
      x.te.uf ?? x.te.grupo, x.te.cod_ibge, x.v, unidadeBruta(ind, meta), x.cond ? condTxt(x.cond) : (x.v === null ? (x.publicado ? t('sem valor', 'no value') : t('não publicado', 'not published')) : ''), comp ? mesIso(comp) : '', nomeInd(ind), nomeFonte(fonte)]),
    metadados: metadadosBase(c, [
      [t('Indicador', 'Indicator'), `${ind.id}: ${descInd(ind)}`],
      [t('Recorte', 'Selection'), `${nivel === 'UF' ? t('Estados', 'States') : t('Municípios', 'Municipalities')}${nivel === 'M' && f.ufSel ? ` · ${f.ufSel}` : ''}`],
      [t('Ordem', 'Order'), dir === 'asc' ? t('crescente', 'ascending') : t('decrescente', 'descending')],
      [t('Posição', 'Rank'), t('Empates têm a mesma posição; linhas sem valor ficam sem posição. A posição só ordena valores, não indica melhor ou pior.', 'Ties share the same rank; rows without a value have no rank. Rank only orders values and does not mean better or worse.')],
    ]),
  });

  const trocarFonte = (fo: FonteSocial) => {
    const i = meta.indicadores.find(x => x.fonte === fo && x.destaque) ?? meta.indicadores.find(x => x.fonte === fo);
    c.alterar({ indicador: i?.id ?? null, mes: null });
  };
  return (
    <>
      <div className="as-filtros">
        <div className="as-campo">
          <label htmlFor="as-rf">{t('Programa', 'Programme')}</label>
          <select id="as-rf" value={fonte} onChange={e => trocarFonte(e.target.value as FonteSocial)}>{FONTES.map(x => <option key={x} value={x}>{nomeFonte(x)}</option>)}</select>
        </div>
        <SeletorIndicador c={c} valor={ind.id} fonte={fonte} onEscolher={i => c.alterar({ indicador: i.id })} />
        <div className="as-campo">
          <label htmlFor="as-rc">{t('Competência', 'Period')}</label>
          <select id="as-rc" value={comp ?? ''} onChange={e => c.alterar({ mes: e.target.value || null, ano: null })} disabled={!comps.length}>
            {!comp && <option value="">{mesPedido ? `${mesSocial(mesPedido)} (${t('indisponível', 'unavailable')})` : t('Sem ranking', 'No ranking')}</option>}
            {comps.map(m => <option key={m} value={m}>{mesSocial(m)}</option>)}
          </select>
        </div>
        <div className="as-campo">
          <label htmlFor="as-rn">{t('Comparar', 'Compare')}</label>
          <select id="as-rn" value={nivel} onChange={e => c.alterar({ nivel: e.target.value === 'UF' ? 'UF' : null })}>
            <option value="M">{t('Municípios', 'Municipalities')}</option><option value="UF">{t('Estados (e DF)', 'States (and DF)')}</option>
          </select>
        </div>
        <div className="as-campo">
          <label htmlFor="as-ro">{t('Ordem', 'Order')}</label>
          <select id="as-ro" value={dir} onChange={e => c.alterar({ ordem: e.target.value === 'asc' ? 'asc' : null })}>
            <option value="desc">{t('Maior para menor', 'Highest to lowest')}</option><option value="asc">{t('Menor para maior', 'Lowest to highest')}</option>
          </select>
        </div>
      </div>

      <section className="cartao">
        <h3>{nomeInd(ind)} <span className="as-tag">{nomeFonte(fonte)}</span><span className="as-tag">{unidadeTxt(ind, meta)}</span></h3>
        <p className="desc">{descInd(ind)}</p>
        <p className="as-resumo">{t('A posição só ordena os valores; não diz se um lugar está melhor ou pior. Indicadores em número absoluto crescem com o tamanho da população: prefira proporções para comparar lugares.',
          'Rank only orders values; it does not say whether a place is better or worse. Absolute counts grow with population size: prefer ratios to compare places.')}</p>
        {nivel === 'M' && f.ufSel === 'DF' && <p className="as-resumo">{t('O Distrito Federal é um ente único e aparece no nível Estados.', 'The Federal District is a single entity and appears at the States level.')}</p>}
        {nivel === 'UF' && f.ufSel && <p className="as-resumo">{t('No nível Estados o filtro de UF não se aplica: aparecem todas as UFs.', 'At the States level the state filter does not apply: all states are shown.')}</p>}
        {!comps.length && <p className="vazio">{t('Esta fonte ainda não tem ranking publicado.', 'This source has no published ranking yet.')}</p>}
        {comps.length > 0 && !comp && <p className="vazio">{t(`Este indicador não tem ranking para ${mesPedido ? mesSocial(mesPedido) : 'o mês pedido'}; o mês do endereço não foi trocado. Escolha uma competência disponível para ele.`, `This indicator has no ranking for ${mesPedido ? mesSocial(mesPedido) : 'the requested month'}; the month in the link was not changed. Choose a period available for it.`)}</p>}
        {r.carregando && <Estado carregando />}
        {r.erro && <Estado erro={r.erro} tentarNovamente={r.recarregar} />}
        {todas && (
          <>
            <p className="as-resumo" role="status">
              {t(`${numero(todas.ranq.length)} com valor`, `${numero(todas.ranq.length)} with a value`)}
              {todas.sem.length > 0 && ` · ${t(`${numero(todas.sem.length)} sem valor`, `${numero(todas.sem.length)} without a value`)} (${[...todas.porCond.entries()].map(([k, n]) => `${k}: ${numero(n)}`).join('; ')})`}
              {todas.total === 0 && ` ${t('Nenhum território neste recorte.', 'No territory in this selection.')}`}
            </p>
            <div className="as-filtros" style={{ margin: 0, padding: 0, border: 0, background: 'none' }}>
              <div className="as-campo as-campo-larga">
                <label htmlFor="as-rb">{t('Buscar território na lista', 'Find a territory in the list')}</label>
                <input id="as-rb" type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder={t('Nome ou código IBGE', 'Name or IBGE code')} />
              </div>
              <div className="as-campo">
                <label htmlFor="as-rm">{t('Mostrar', 'Show')}</label>
                <select id="as-rm" value={modo} onChange={e => c.alterar({ mostrar: e.target.value === 'todos' ? 'todos' : null })}>
                  <option value="top50">{t('Os 50 primeiros', 'Top 50')}</option><option value="todos">{t('Todos (50 por página)', 'All (50 per page)')}</option>
                </select>
              </div>
              <Baixar nome={`assistencia_ranking_${ind.id}`} obter={exportarTudo} rotulo={t('Baixar tudo, com sem-valor:', 'Download all, incl. no-value:')} />
            </div>
            <div className="as-tabela-rolagem">
              <table className="as-tabela">
                <caption className="sr-only">{t('Ranking', 'Ranking')}</caption>
                <thead><tr><th className="as-num">{t('Posição', 'Rank')}</th><th className="as-txt">{t('Território', 'Territory')}</th><th className="as-num">{nomeInd(ind)}</th></tr></thead>
                <tbody>
                  {visiveis.map(x => (
                    <tr key={x.te.grupo} className={x.te.grupo === f.terr.grupo ? 'as-destaque' : undefined}>
                      <td className="as-num">{x.pos}º</td>
                      <td className="as-txt">{rotuloTerr(x.te)}</td>
                      <td className="as-num"><Val i={ind} v={x.v} cond={x.cond} longo /></td>
                    </tr>
                  ))}
                  {visiveis.length === 0 && <tr><td colSpan={3} className="as-txt">{t('Nada para mostrar.', 'Nothing to show.')}</td></tr>}
                </tbody>
              </table>
            </div>
            {modo === 'todos' && <Paginacao total={filtrada.length} pagina={pagina} tam={tam} onPag={p => setPag({ chave: chavePag, p })} />}
            {modo === 'top50' && filtrada.length > tam && <p className="as-resumo">{t(`Mostrando as ${tam} primeiras de ${numero(filtrada.length)}. Escolha “Todos” para ver o resto ou baixe a lista completa.`, `Showing the first ${tam} of ${numero(filtrada.length)}. Choose “All” to see the rest or download the full list.`)}</p>}
          </>
        )}
      </section>
      <div className="as-atalhos">
        <Link to={c.link(PATH.evolucao, { indicador: ind.id })}>{t('Evolução deste indicador', 'Trend of this indicator')}</Link>
        <Link to={c.link(PATH.painel, { indicador: ind.id })}>{t('Voltar ao painel', 'Back to the overview')}</Link>
      </div>
    </>
  );
}

export function AssistenciaRankings() {
  return (
    <Casca atual="rankings" mes={false} titulo={t('Assistência social: rankings', 'Social assistance: rankings')}
      sub={t('Compare municípios ou estados em um indicador, em uma competência de cada programa.', 'Compare municipalities or states on one indicator, in one period of each programme.')}>
      {c => <RankingsCorpo c={c} />}
    </Casca>
  );
}

/* ============================== TABELA ============================== */

function TabelaCorpo({ c }: { c: Ctx }) {
  const { meta, f } = c;
  const g = useGrupo(f.terr.grupo);
  const fonteP = c.sp.get('fonte');
  const fonteSel: FonteSocial | '' = FONTES.includes(fonteP as FonteSocial) ? (fonteP as FonteSocial) : '';
  const indP = c.sp.get('indicador');
  const indSel = indP ? c.mapa.get(indP) : undefined;
  const fonteEf = indSel ? indSel.fonte : fonteSel;
  const soMes = c.sp.get('somes') === '1' && !!f.mes;
  const [txt, setTxt] = useState('');
  const [pag, setPag] = useState<{ chave: string; p: number }>({ chave: '', p: 0 });
  const tam = 50;

  const rows = useMemo(() => {
    if (!g.dados) return [];
    const q = norm(txt.trim()).split(/\s+/).filter(Boolean);
    const out: { m: number; fo: FonteSocial; i: IndicadorSocial; v: number | null; cond?: string; ordem: number }[] = [];
    meta.indicadores.forEach((i, ordem) => {
      if (fonteEf && i.fonte !== fonteEf) return;
      if (indSel && i.id !== indSel.id) return;
      if (q.length && !q.every(x => norm(`${i.nome} ${i.nome_en} ${i.tema} ${i.tema_en}`).includes(x))) return;
      for (const l of g.dados!.series[i.fonte]) {
        if (soMes && l.competencia !== f.mes) continue;
        if (!(i.id in l.valores) && !(i.id in l.condicoes)) continue;
        out.push({ m: l.competencia, fo: i.fonte, i, v: valDe(l, i.id), cond: condDe(l, i.id), ordem });
      }
    });
    return out.sort((a, b) => b.m - a.m || FONTES.indexOf(a.fo) - FONTES.indexOf(b.fo) || a.ordem - b.ordem);
  }, [g.dados, meta, fonteEf, indSel, txt, soMes, f.mes]);

  const chave = `${f.terr.grupo}|${fonteEf}|${indSel?.id}|${txt}|${soMes}`;
  const pagina = pag.chave === chave ? pag.p : 0;
  const exportarTudo = (): Tabela => ({
    colunas: [t('Data', 'Date'), t('Território', 'Territory'), t('Fonte', 'Source'), t('Indicador', 'Indicator'), t('Valor', 'Value'), t('Unidade', 'Unit'), t('Condição', 'Condition'), t('Descrição do indicador', 'Indicator description')],
    linhas: rows.map((x): Celula[] => [mesIso(x.m), rotuloTerr(f.terr), nomeFonte(x.fo), nomeInd(x.i), x.v, unidadeBruta(x.i, meta), x.cond ? condTxt(x.cond) : (x.v === null ? t('sem valor', 'no value') : ''), descInd(x.i)]),
    metadados: metadadosBase(c, [[t('Linhas', 'Rows'), String(rows.length)], [t('Filtros', 'Filters'), `${fonteEf ? nomeFonte(fonteEf) : t('todas as fontes', 'all sources')} · ${indSel ? nomeInd(indSel) : t('todos os indicadores', 'all indicators')}${txt ? ` · "${txt}"` : ''}${soMes ? ` · ${mesSocial(f.mes!)}` : ''}`]]),
  });
  return (
    <>
      <div className="as-filtros">
        <div className="as-campo">
          <label htmlFor="as-tf">{t('Programa', 'Programme')}</label>
          <select id="as-tf" value={fonteEf} onChange={e => c.alterar({ fonte: e.target.value || null, indicador: null })}>
            <option value="">{t('Todos', 'All')}</option>{FONTES.map(x => <option key={x} value={x}>{nomeFonte(x)}</option>)}
          </select>
        </div>
        <div className="as-campo as-campo-larga">
          <label htmlFor="as-ti">{t('Indicador', 'Indicator')}</label>
          <select id="as-ti" value={indSel?.id ?? ''} onChange={e => { const i = c.mapa.get(e.target.value); c.alterar({ indicador: i?.id ?? null, fonte: i ? i.fonte : fonteSel || null }); }}>
            <option value="">{t('Todos os indicadores', 'All indicators')}</option>
            {meta.indicadores.filter(i => !fonteEf || i.fonte === fonteEf).map(i => <option key={i.id} value={i.id}>{curto(nomeInd(i), 90)}</option>)}
          </select>
        </div>
        <div className="as-campo as-campo-larga">
          <label htmlFor="as-tt">{t('Filtrar por palavra', 'Filter by word')}</label>
          <input id="as-tt" type="search" value={txt} onChange={e => setTxt(e.target.value)} placeholder={t('Ex.: renda', 'E.g. income')} />
        </div>
        {f.mes && (
          <label className="as-check"><input type="checkbox" checked={soMes} onChange={e => c.alterar({ somes: e.target.checked ? '1' : null })} /> {t(`Somente ${mesSocial(f.mes)}`, `Only ${mesSocial(f.mes)}`)}</label>
        )}
      </div>
      <section className="cartao">
        <h3>{t('Série mensal de ', 'Monthly series for ')}{rotuloTerr(f.terr)}</h3>
        {g.carregando && <Estado carregando />}
        {g.erro && <Estado erro={g.erro} tentarNovamente={g.recarregar} />}
        {g.dados && (
          <>
            <p className="as-resumo">{t(`${numero(rows.length)} linhas.`, `${numero(rows.length)} rows.`)} {t('Um registro por mês, programa e indicador. Em branco = sem valor (veja a condição).', 'One record per month, programme and indicator. Blank = no value (see the condition).')}</p>
            {indSel && <p className="as-resumo"><strong>{t('Como é calculado:', 'How it is computed:')}</strong> {descInd(indSel)}</p>}
            <div className="as-acoes"><Baixar nome={`assistencia_tabela_${f.terr.grupo}`} obter={exportarTudo} rotulo={t('Baixar todas as linhas deste recorte:', 'Download all rows of this selection:')} /></div>
            <div className="as-tabela-rolagem">
              <table className="as-tabela">
                <caption className="sr-only">{t('Série mensal em formato longo', 'Monthly series in long format')}</caption>
                <thead><tr>
                  <th>{t('Data', 'Date')}</th><th className="as-txt">{t('Fonte', 'Source')}</th><th className="as-txt">{t('Indicador', 'Indicator')}</th>
                  <th className="as-num">{t('Valor', 'Value')}</th><th className="as-txt">{t('Unidade', 'Unit')}</th><th className="as-txt">{t('Condição', 'Condition')}</th>
                </tr></thead>
                <tbody>
                  {rows.slice(pagina * tam, (pagina + 1) * tam).map(x => (
                    <tr key={`${x.m}${x.i.id}`}>
                      <td>{mesSocial(x.m)}</td><td className="as-txt">{nomeFonte(x.fo)}</td><td className="as-txt">{nomeInd(x.i)}</td>
                      <td className="as-num">{x.v === null ? <span className="as-nulo">–</span> : fmt(x.i, x.v, true)}</td>
                      <td className="as-txt">{unidadeTxt(x.i, meta)}</td>
                      <td className="as-txt">{x.cond ? condTxt(x.cond) : x.v === null ? t('sem valor', 'no value') : ''}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && <tr><td colSpan={6} className="as-txt">{t('Nenhuma linha para estes filtros.', 'No rows for these filters.')}</td></tr>}
                </tbody>
              </table>
            </div>
            <Paginacao total={rows.length} pagina={pagina} tam={tam} onPag={p => setPag({ chave, p })} />
          </>
        )}
      </section>
      <div className="as-atalhos">
        {indSel && <Link to={c.link(PATH.evolucao, { indicador: indSel.id })}>{t('Gráfico da evolução', 'Trend chart')}</Link>}
        <Link to={c.link(PATH.painel, { indicador: indSel?.id ?? null })}>{t('Voltar ao painel', 'Back to the overview')}</Link>
      </div>
    </>
  );
}

export function AssistenciaTabela() {
  return (
    <Casca atual="tabela" titulo={t('Assistência social: tabela', 'Social assistance: table')}
      sub={t('Todos os números da série mensal do território escolhido, em uma tabela que você pode filtrar e baixar.', 'All numbers of the chosen territory monthly series, in a table you can filter and download.')}>
      {c => <TabelaCorpo c={c} />}
    </Casca>
  );
}

/* ============================== METODOLOGIA ============================== */

function MetodologiaCorpo({ c }: { c: Ctx }) {
  const { meta } = c;
  const data = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(local()); };
  return (
    <>
      <section className="as-metodos" aria-label={t('Fontes', 'Sources')}>
        {FONTES.map(fo => {
          const x = meta.fontes[fo]; const comps = x?.competencias ?? [];
          return (
            <section key={fo} className="cartao">
              <h3>{nomeFonte(fo)}</h3>
              <ul>
                <li><strong>{t('Fonte oficial:', 'Official source:')}</strong> {x?.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.nome || x.url}</a> : x?.nome}</li>
                <li><strong>{t('Cobertura:', 'Coverage:')}</strong> {comps.length ? `${mesSocial(comps[0])} ${t('a', 'to')} ${mesSocial(comps[comps.length - 1])} (${comps.length} ${t(comps.length === 1 ? 'mês' : 'meses', comps.length === 1 ? 'month' : 'months')})` : t('sem dados publicados', 'no data published')}</li>
                {(en() ? x?.avisos_en ?? x?.avisos : x?.avisos)?.map((a, k) => <li key={k}>{a}</li>)}
              </ul>
            </section>
          );
        })}
      </section>
      <section className="cartao">
        <h3>{t('Datas por indicador', 'Dates by indicator')}</h3>
        <ul className="as-lista">
          <li>{t('Cada indicador tem sua própria cobertura: dentro de um mesmo programa, indicadores podem ter datas diferentes, e meses sem publicação ficam sem dado (nunca zero).', 'Each indicator has its own coverage: within the same programme, indicators may have different dates, and months without publication have no data (never zero).')}</li>
          {FONTES.map(fo => {
            const todos = meta.indicadores.filter(i => i.fonte === fo).flatMap(i => i.competencias ?? []);
            return <li key={fo}><strong>{nomeFonte(fo)}:</strong> {todos.length ? t(`indicadores com dados de ${mesSocial(Math.min(...todos))} a ${mesSocial(Math.max(...todos))}.`, `indicators with data from ${mesSocial(Math.min(...todos))} to ${mesSocial(Math.max(...todos))}.`) : t('datas na tabela de cada tema.', 'dates in each theme table.')}</li>;
          })}
          <li>{t('Estados e Brasil: no CadÚnico são totais próprios do MDS, não reconstruídos; no BPC, agregação direta dos pagamentos, sem duplicar municípios; na folha do Bolsa Família, soma dos municípios apenas com cobertura completa do mês, nunca médias; nos pagamentos da CGU, valores monetários somam, mas responsáveis (NIS distintos) não são pessoas únicas em estado ou Brasil.', 'States and Brazil: in CadÚnico they are MDS own totals, not rebuilt; in BPC, direct aggregation of payments without duplicating municipalities; in the Bolsa Família payroll, the sum of municipalities only with complete coverage for the month, never averages; in CGU payments, money amounts add up, but guardians (distinct NIS) are not unique people in a state or Brazil.')}</li>
          <li>{t('Comparações com estado e Brasil só usam a mesma data do indicador do território; sem total daquele mês, aparece “sem dado comparável”.', 'Comparisons with state and Brazil only use the same date as the territory indicator; with no total for that month, “no comparable data” is shown.')}</li>
        </ul>
      </section>
      <section className="cartao">
        <h3>{t('CadÚnico', 'CadÚnico')}</h3>
        <ul className="as-lista">
          <li>{t('Vem do Observatório público do CadÚnico, do Ministério do Desenvolvimento e Assistência Social (MDS), um serviço externo. É um retrato de outubro de 2026; o marcador de famílias que recebem Bolsa Família tem referência de novembro de 2026.', 'Comes from the public CadÚnico Observatory of the Ministry of Social Development (MDS), an external service. It is a snapshot of October 2026; the marker for families receiving Bolsa Família refers to November 2026.')}</li>
          <li>{t('A própria fonte protege células positivas pequenas (menos de 100 famílias ou menos de 200 pessoas). Esses valores aparecem como protegidos, nunca como zero.', 'The source itself protects small positive cells (fewer than 100 families or fewer than 200 people). These appear as protected, never as zero.')}</li>
          <li>{t('Os totais de estados e do Brasil são os oficiais da fonte; não são reconstruídos somando municípios.', 'State and Brazil totals are the official ones from the source; they are not rebuilt by adding municipalities.')}</li>
          <li>{t('O marcador de famílias do CadÚnico que recebem Bolsa Família é diferente de famílias pagas no mês pelo programa.', 'The CadÚnico marker for families receiving Bolsa Família is different from families paid in the month by the programme.')}</li>
          <li>{t('A API histórica do MDS está em manutenção: por ora há só o retrato atual, sem série histórica.', 'The MDS historical API is under maintenance: for now there is only the current snapshot, with no historical series.')}</li>
        </ul>
      </section>
      <section className="cartao">
        <h3>{t('Bolsa Família: duas séries diferentes', 'Bolsa Família: two different series')}</h3>
        <ul className="as-lista">
          <li><strong>{t('Folha do MDS', 'MDS payroll')}:</strong> {t('planilhas oficiais por mês e por UF, com arquivos válidos de junho de 2023 a junho de 2026, com lacunas. Alguns meses têm UFs inválidas e foram descartados; tipos de benefício com fonte de agosto de 2025 e o total incorreto foram excluídos. Os componentes em dinheiro são a soma da planilha, não o valor dos pagamentos da CGU.', 'official spreadsheets by month and state, with valid files from June 2023 to June 2026, with gaps. Some months have invalid states and were discarded; benefit types sourced from August 2025 and the incorrect total were excluded. Money components are the spreadsheet sum, not the CGU payment amount.')}</li>
          <li>{t('Em junho de 2026 falta a Paraíba, então não há total do Brasil da folha nesse mês: o último total completo do Brasil é de março de 2026. A Paraíba tem sua própria última folha, de outra data.', 'In June 2026 Paraíba is missing, so there is no Brazil payroll total for that month: the last complete Brazil total is March 2026. Paraíba has its own last payroll, from a different date.')}</li>
          <li><strong>{t('Pagamentos da CGU (indicadores pbf_cgu_*)', 'CGU payments (pbf_cgu_* indicators)')}:</strong> {t('outra série, de janeiro de 2013 a setembro de 2026, no mesmo programa. Conta responsáveis pagos (NIS distintos) no município, que não são as famílias da folha. Para estados e Brasil os responsáveis distintos estão indisponíveis, pois não podem ser somados como pessoas únicas (condição “não agregável”).', 'another series, from January 2013 to September 2026, under the same programme. It counts guardians paid (distinct NIS) in the municipality, who are not the payroll families. For states and Brazil distinct guardians are unavailable because they cannot be added as unique people (condition “not aggregable”).')}</li>
          <li>{t('Transição de programa: em novembro de 2021 os arquivos têm Bolsa Família e Auxílio Brasil; entre novembro de 2021 e fevereiro de 2023 há mudança de programa e falta o Benefício Extraordinário do Auxílio Brasil. O Auxílio Brasil não é emendado como se fosse a mesma série do Bolsa Família; os gráficos marcam a transição.', 'Programme transition: in November 2021 the files contain Bolsa Família and Auxílio Brasil; between November 2021 and February 2023 the programme changes and the Auxílio Brasil Extraordinary Benefit is missing. Auxílio Brasil is not spliced in as the same series as Bolsa Família; charts mark the transition.')}</li>
        </ul>
      </section>
      <section className="cartao">
        <h3>BPC</h3>
        <ul className="as-lista">
          <li>{t('Vem dos dados da Controladoria-Geral da União (CGU), competências de janeiro de 2019 a setembro de 2026.', 'Comes from Controladoria-Geral da União (CGU) data, periods from January 2019 to September 2026.')}</li>
          <li>{t('Conta benefícios distintos com pagamento (por número de benefício) no mês. Não são pessoas únicas nem o estoque de benefícios ativos.', 'Counts distinct benefits with a payment (by benefit number) in the month. These are not unique people nor the stock of active benefits.')}</li>
          <li>{t('Competência e mês de referência do pagamento podem diferir (pagamentos retroativos).', 'The payment period and the reference month may differ (retroactive payments).')}</li>
          <li>{t('Estados e Brasil são calculados dos microdados sem duplicar municípios.', 'States and Brazil are computed from the microdata without duplicating municipalities.')}</li>
          <li>{t('O arquivo não traz a espécie do benefício: idosos e pessoas com deficiência não podem ser separados e não são inferidos. Nome, CPF, NIS e número do benefício não chegam ao site.', 'The file does not carry the benefit type: older adults and people with disabilities cannot be separated and are not inferred. Names, CPF, NIS and benefit numbers never reach the site.')}</li>
          <li>{t('Parte dos benefícios por decisão judicial pode não estar informada, então os números podem não ser interpretados como proporção do total.', 'Part of the court-ordered benefits may not be reported, so the figures may not be read as a share of the total.')}</li>
        </ul>
      </section>
      <section className="cartao">
        <h3>{t('Valores em reais e outros cuidados', 'Amounts in reais and other cautions')}</h3>
        <ul className="as-lista">
          <li>{t(`Indicadores em R$ nominais mostram o valor da época. Indicadores marcados como reais usam o IPCA mensal do IBGE com base ${baseTxt(meta)}, só onde há índice; o último mês não é projetado.`, `Nominal R$ indicators show the amount of the time. Indicators marked as real use the IBGE monthly IPCA with base ${baseTxt(meta)}, only where an index exists; the last month is not projected.`)}</li>
          <li>{t('Razões aparecem em porcentagem (fração × 100); nos arquivos baixados saem como fração, com a unidade escrita.', 'Ratios appear as percentages (fraction × 100); in downloaded files they are raw fractions, with the unit written out.')}</li>
          <li>{t('Somas anuais só existem para indicadores de fluxo (por exemplo, valores pagos). Famílias, pessoas e benefícios não se somam entre meses.', 'Yearly totals only exist for flow indicators (for example, amounts paid). Families, people and benefits are not added across months.')}</li>
          <li>{t('Os três programas não são somados: a mesma pessoa ou família pode estar em mais de um.', 'The three programmes are not added: the same person or family may be in more than one.')}</li>
          <li>{t('Brasília e o Distrito Federal são o mesmo território (ente único). Fernando de Noronha aparece como distrito estadual de Pernambuco.', 'Brasília and the Federal District are the same territory (single entity). Fernando de Noronha appears as a state district of Pernambuco.')}</li>
          <li>{t(`Catálogo gerado em ${data(meta.gerado_em)} com ${numero(meta.indicadores.length)} indicadores e ${numero(meta.territorios.length)} territórios.`, `Catalogue generated on ${data(meta.gerado_em)} with ${numero(meta.indicadores.length)} indicators and ${numero(meta.territorios.length)} territories.`)}</li>
        </ul>
      </section>
    </>
  );
}

export function AssistenciaMetodologia() {
  return (
    <Casca atual="metodologia" mes={false} titulo={t('Assistência social: fontes e metodologia', 'Social assistance: sources and methodology')}
      sub={t('De onde vêm os números, até que mês vão e o que eles não dizem.', 'Where the numbers come from, how recent they are and what they do not say.')}>
      {c => <MetodologiaCorpo c={c} />}
    </Casca>
  );
}
