import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useApi, type Ente, type Meta, type Params } from './api';
import { Dica } from './components/Dica';
import { Estado } from './components/Kpi';
import { numero, pct, reais } from './format';
import { dado, local, t } from './idioma';
import { anosSaude, type FontesMeta } from './saude_comum';
import { cadastroEfetivoSaude, COD_NORONHA, ENTE_NORONHA, focoValido, lerFiltros, rolagemParaOpcao, teclaBusca, tipoDeEnte, UFS_BR, type AvisoUrl } from './filtros_url';

type Contexto = { meta: Meta; entes: Ente[]; porCodigo: Map<number, Ente> };
const Ctx = createContext<Contexto | null>(null);

/**
 * Meta e lista de entes usam o catálogo do pacote de abertura, idêntico ao do motor, com fallback DuckDB.
 * As páginas de /clima abrem sem esse contexto: o resumo vem do pacote de abertura
 * (api.ts → clima_abertura.ts). O que precisa do motor (histórico, rankings, exportações) se envolve em <ProvedorDados sobDemanda>,
 * que só então o inicia. Se o motor já foi carregado por outra página, o contexto é aproveitado.
 * Em /datasus, o contexto completo (meta e entes) vem das rotas saude_meta e saude_entes, atendidas pelo pacote de abertura da saúde
 * (saude_abertura.ts) ou, sem ele, pelo motor com o mesmo resultado.
 */
export function ProvedorDados({ children, sobDemanda = false, silencioso = false }: { children: ReactNode; sobDemanda?: boolean; silencioso?: boolean }) {
  const caminho = useLocation().pathname;
  const precisa = sobDemanda || !(caminho === '/clima' || caminho.startsWith('/clima/'));
  // /datasus: contexto completo pelo pacote de abertura da saúde (saude_meta e saude_entes devolvem o mesmo que meta e entes; sem pacote, o motor responde)
  const saude = !sobDemanda && (caminho === '/datasus' || caminho.startsWith('/datasus/'));
  const meta = useApi<Meta>(precisa ? (saude ? 'saude_meta' : 'meta') : null);
  const entes = useApi<Ente[]>(precisa ? (saude ? 'saude_entes' : 'entes') : null);
  const valor = useMemo(
    () =>
      meta.dados && entes.dados
        ? { meta: meta.dados, entes: entes.dados, porCodigo: new Map(entes.dados.map((e) => [e.cod_ibge, e])) }
        : null,
    [meta.dados, entes.dados],
  );
  if (!precisa) return <Ctx.Provider value={null}>{children}</Ctx.Provider>;
  if (meta.erro || entes.erro) {
    return (
      <Estado
        erro={meta.erro ?? entes.erro}
        mensagem={t('Não foi possível carregar os dados.', 'Could not load the data.')}
        tentarNovamente={() => { meta.recarregar(); entes.recarregar(); }}
      />
    );
  }
  if (!valor) return silencioso ? null : <p className="carregando" role="status">{saude ? t('Carregando os dados de saúde…', 'Loading the health data…') : t('Carregando o catálogo e a lista de territórios…', 'Loading the catalogue and the list of territories…')}</p>;
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useDados = () => useContext(Ctx)!;

export const UFS = UFS_BR;
/** UFs sem municípios próprios: o escopo da UF é o próprio ente (DF). */
const UF_SEM_MUNICIPIOS = new Set(['DF']);
export const esfera = (e: Ente['esfera']) =>
  ({ M: t('Município', 'Municipality'), E: t('Estado', 'State'), D: t('Distrito Federal', 'Federal District') })[e];
/** Fernando de Noronha, só no cadastro efetivo de /datasus (ver filtros_url.ts). Esfera M por compatibilidade com o FNS; a tela não o chama de município. */
const NORONHA: Ente = ENTE_NORONHA;
/** Tipo do ente para a tela: Noronha é distrito estadual, nunca município. */
export const tipoEnte = (e: Ente) =>
  ({ municipio: t('Município', 'Municipality'), estado: t('Estado', 'State'), df: t('Distrito Federal', 'Federal District'), distrito_estadual: t('Distrito estadual', 'State district') })[tipoDeEnte(e)];
/**
 * Política única dos agregados: saem só as inconsistências objetivas e os erros confirmados
 * (alertas.parquet, exclui = true), e só no domínio sinalizado. Suspeitas estatísticas ficam nos totais.
 */
const TRATAMENTO = 'filtrado';

/** Filtros globais guardados na URL (ano, uf, ente), para links compartilháveis. */
export function useFiltros() {
  const { meta, porCodigo, entes } = useDados();
  const [busca, setBusca] = useSearchParams();
  // a área de trabalho usa os anos da RAIS (2010 em diante); a de saúde, os do SIM; as finanças, os do SICONFI
  const caminho = useLocation().pathname;
  const trabalho = caminho.startsWith('/trabalho');
  const saude = caminho.startsWith('/datasus');
  const anosRais = (meta.fontes.rais as { anos?: number[] } | undefined)?.anos;
  // saúde: os anos de qualquer fonte; cada página mostra a disponibilidade efetiva do que pede (fonte do numerador e do denominador)
  const anosDasFontes = anosSaude(meta.fontes as FontesMeta);
  const anos = trabalho && anosRais?.length ? anosRais : saude && anosDasFontes.length ? anosDasFontes : meta.anos;
  const semAnoUrl = !busca.get('ano')?.trim();
  // leitura única e tolerante do endereço (filtros_url.ts): UF em qualquer caixa, Brasília = DF, ano nunca vira NaN; o que não vale
  // volta em `avisos` (BarraFiltros mostra), e o recorte exibido segue o mesmo de antes (ente > UF > Brasil)
  const lidos = lerFiltros(
    { ano: busca.get('ano'), uf: busca.get('uf'), ente: busca.get('ente') },
    // trabalho e saúde já avisam sozinhas de um ano numérico fora da base (anoForaDaBase)
    { anos, aceitaUltimo: saude, avisoProprioDeAnoNumerico: trabalho || saude },
    // /datasus: o cadastro efetivo inclui Fernando de Noronha (dados no FNS); as demais áreas usam o cadastro publicado
    (cod) => porCodigo.get(cod) ?? (saude && cod === COD_NORONHA ? NORONHA : undefined),
  );
  const { ano, ultimo, anoForaDaBase, ente, uf } = lidos;
  const tratamento = TRATAMENTO;
  // DF: a UF é o próprio ente Distrito Federal
  const enteDaUf = !ente && uf && UF_SEM_MUNICIPIOS.has(uf) ? entes.find((e) => e.uf === uf && e.esfera === 'D') ?? null : null;
  const alvo = ente ?? enteDaUf;

  const definir = (novo: { ano?: number | 'ultimo' | null; uf?: string | null; ente?: number | null }) => {
    const p = new URLSearchParams(busca);
    for (const [k, v] of Object.entries(novo)) {
      if (v === null || v === undefined || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    setBusca(p, { replace: true });
  };
  const limpar = () => {
    const p = new URLSearchParams(busca);
    for (const k of ['ano', 'uf', 'ente']) p.delete(k);
    setBusca(p, { replace: true });
  };

  /** Parâmetros de escopo para a API: o ente, ou os municípios da UF, ou do Brasil. */
  const escopo: Params = alvo ? { ente: alvo.cod_ibge, tratamento } : { uf: uf ?? undefined, esfera: 'M', tratamento };
  const rotulo = alvo
    ? `${alvo.nome}${alvo.esfera === 'M' ? ` (${alvo.uf})` : alvo.esfera === 'E' ? ` · ${t('estado', 'state')}` : ''}`
    : uf
      ? t(`Municípios de ${uf} com dados`, `Municipalities in ${uf} with data`)
      : t('Municípios com dados disponíveis', 'Municipalities with available data');
  const rotuloComparador = alvo
    ? alvo.esfera === 'M' ? t(`Municípios de ${alvo.uf}`, `Municipalities in ${alvo.uf}`) : alvo.esfera === 'E' ? t('Todos os estados', 'All states') : null
    : uf ? t('Brasil', 'Brazil') : null;
  /** Escopo do comparador (para séries): UF do município, ou Brasil. */
  const escopoComparador: Params | null = alvo
    ? alvo.esfera === 'M'
      ? { uf: alvo.uf, esfera: 'M', tratamento }
      : alvo.esfera === 'E' ? { esfera: 'E', tratamento } : null
    : uf
      ? { esfera: 'M', tratamento }
      : null;

  return {
    ano, uf, ente, alvo, definir, limpar, escopo, rotulo, rotuloComparador, escopoComparador, tratamento, anos, anoForaDaBase, ultimo, semAnoUrl,
    avisosUrl: lidos.avisos,
    temFiltros: !!(busca.get('ano') || busca.get('uf') || busca.get('ente')),
  };
}

export type Alerta = {
  exercicio: number; cod_ibge: number; nome: string; uf: string; esfera: string; indicador: string; dominio: string;
  valor: number | null; valor_real: number | null; mediana_real: number | null; razao: number | null; n_obs: number;
  categoria: 'ausente' | 'suspeita' | 'inconsistente' | 'validado' | 'confirmado'; motivo: string; regra: string;
  evidencia: string | null; fonte: string | null; exclui: boolean;
};

export const rotuloIndicador = (indicador: string) =>
  ({ receita_bruta: t('receita bruta', 'gross revenue'), despesa_empenhada: t('despesa empenhada', 'committed expenditure') })[indicador] ?? indicador;

export const rotuloCategoria = (c: Alerta['categoria']) =>
  ({
    ausente: t('não declarado', 'not reported'),
    suspeita: t('suspeita estatística', 'statistical flag'),
    inconsistente: t('inconsistência (regra objetiva)', 'inconsistency (objective rule)'),
    validado: t('atípico validado', 'validated outlier'),
    confirmado: t('erro confirmado', 'confirmed error'),
  })[c];

/** semAno e semBuscaEnte: a página tem o próprio seletor (ex.: evolução das posições, com o período e o município). */
type Opcoes = {
  semAno?: boolean; semEnte?: string; semBuscaEnte?: boolean;
  /** saúde: oferece "o último ano de cada fonte" no seletor de ano */
  comUltimo?: boolean;
  /** com comUltimo: é o que vale quando a URL não traz ano */
  ultimoPadrao?: boolean;
  /** anos em que o dado pedido existe: os demais aparecem marcados como fora da cobertura */
  anosCobertos?: number[];
};

export function BarraFiltros(opcoes: Opcoes = {}) {
  const f = useFiltros();
  // as sinalizações são das declarações do SICONFI: não valem para as áreas de mercado de trabalho e de saúde
  const caminho = useLocation().pathname;
  const financas = !caminho.startsWith('/trabalho') && !caminho.startsWith('/datasus');
  const alertas = useApi<Alerta[]>(f.alvo && financas ? 'alertas' : null, { ente: f.alvo?.cod_ibge });
  const doAno = (alertas.dados ?? []).filter((a) => a.exercicio === f.ano);
  return (
    <>
      <Filtros {...opcoes} />
      <AvisosUrl semAno={opcoes.semAno} />
      {doAno.length > 0 && (
        <p className="aviso" role="status">
          ⚠ {t('Sinalização em', 'Flag in')} {f.ano}:{' '}
          {doAno.map((a) => `${rotuloIndicador(a.indicador)}: ${rotuloCategoria(a.categoria)}, ${dado(a.motivo)}${a.razao ? ` (${a.razao.toLocaleString(local(), { maximumFractionDigits: 1 })}× ${t('a mediana real do ente', 'the government’s real median')})` : ''}`).join('; ')}.{' '}
          {doAno.some((a) => a.exclui)
            ? t(
              'Os valores do ente aparecem como declarados, mas este ano fica fora dos totais de UF, Brasil e rankings no domínio da inconsistência (receita ou despesa).',
              'The government’s values are shown as reported, but this year is excluded from state and national totals and rankings in the domain of the inconsistency (revenue or expenditure).',
            )
            : t(
              'Os valores aparecem como declarados e continuam nos totais de UF, Brasil e rankings: a sinalização estatística não prova erro.',
              'Values are shown as reported and remain in state and national totals and rankings: a statistical flag does not prove an error.',
            )}
        </p>
      )}
    </>
  );
}

/** Parâmetro da URL a que cada aviso se refere (o que o botão do aviso remove). */
const PARAMETRO_DO_AVISO: Record<AvisoUrl['tipo'], 'ano' | 'uf' | 'ente' | null> = {
  uf_invalida: 'uf', ente_invalido: 'ente', uf_diverge: null, ano_fora: 'ano', ano_invalido: 'ano', ultimo_indisponivel: 'ano',
};

/**
 * Avisa, acima dos números, quando o endereço pede um recorte que a página não pôde aplicar (UF ou ente inexistente, UF em conflito
 * com o ente, ano fora da base ou sem sentido). O fallback é o de sempre; o aviso diz o pedido e o recorte exibido. O botão tira do
 * endereço só os parâmetros inválidos: os válidos e os da própria página ficam.
 * Páginas com seletor próprio de ano (semAno) não recebem o aviso de ano. A UF continua global
 * mesmo quando a página tem sua própria busca de municípios (evolução das posições).
 */
function AvisosUrl({ semAno }: { semAno?: boolean }) {
  const f = useFiltros();
  const lista = f.avisosUrl.filter((a) => {
    const p = PARAMETRO_DO_AVISO[a.tipo];
    return !(semAno && p === 'ano');
  });
  if (lista.length === 0) return null;
  const remover = [...new Set(lista.map((a) => PARAMETRO_DO_AVISO[a.tipo]).filter((p): p is 'ano' | 'uf' | 'ente' => p !== null))];
  const territorial = lista.some((a) => a.tipo === 'uf_invalida' || a.tipo === 'ente_invalido' || a.tipo === 'uf_diverge');
  const frases = lista.map((a) => {
    switch (a.tipo) {
      case 'uf_invalida':
        return t(`A UF “${a.valor}” do endereço não existe.`, `The state “${a.valor}” in the address does not exist.`);
      case 'ente_invalido':
        return t(`O código de ente “${a.valor}” do endereço não está no cadastro.`, `The government code “${a.valor}” in the address is not in the registry.`);
      case 'uf_diverge':
        return t(`O endereço pede a UF ${a.uf}, mas ${f.ente?.nome ?? 'o ente escolhido'} fica em ${a.enteUf}: prevalece o ente.`,
          `The address asks for state ${a.uf}, but ${f.ente?.nome ?? 'the chosen government'} is in ${a.enteUf}: the government takes precedence.`);
      case 'ano_fora':
        return t(`O exercício ${a.pedido} do endereço está fora da base (${f.anos[0]}–${f.anos.at(-1)}); o filtro de ano usa ${a.usado}, o último disponível.`,
          `The year ${a.pedido} in the address is outside the data (${f.anos[0]}–${f.anos.at(-1)}); the year filter uses ${a.usado}, the latest available.`);
      case 'ano_invalido':
        return t(`O ano “${a.valor}” do endereço não é válido; o filtro de ano usa ${a.usado}, o último disponível.`,
          `The year “${a.valor}” in the address is not valid; the year filter uses ${a.usado}, the latest available.`);
      case 'ultimo_indisponivel':
        return t(`“Último ano de cada fonte” só existe na Saúde; nesta página o filtro de ano usa ${a.usado}, o último disponível.`,
          `“Latest year of each source” only exists in Health; on this page the year filter uses ${a.usado}, the latest available.`);
    }
  });
  const anoAviso = lista.some((a) => PARAMETRO_DO_AVISO[a.tipo] === 'ano');
  return (
    <p className="aviso" role="status">
      ⚠ {frases.join(' ')}
      {territorial && <> {t('Recorte exibido', 'Scope shown')}: {f.rotulo}.</>}
      {anoAviso && <> {t('Fontes com menos anos podem aparecer sem dado nesse ano.', 'Sources with fewer years may show no data for that year.')}</>}
      {remover.length > 0 && (
        <>
          {' '}
          <button type="button" className="limpar" onClick={() => {
            const novo: Parameters<typeof f.definir>[0] = {};
            for (const p of remover) novo[p] = null;
            f.definir(novo);
          }}>
            {remover.length === 1 ? t('Remover do endereço o parâmetro inválido', 'Remove the invalid parameter from the address') : t('Remover do endereço os parâmetros inválidos', 'Remove the invalid parameters from the address')}
          </button>
        </>
      )}
    </p>
  );
}

function Filtros({ semAno, semEnte, semBuscaEnte, comUltimo, ultimoPadrao, anosCobertos }: Opcoes) {
  const { entes } = useDados();
  const f = useFiltros();
  const caminho = useLocation().pathname;
  const trabalho = caminho.startsWith('/trabalho');
  const saude = caminho.startsWith('/datasus');
  const entesBusca = useMemo(() => (saude ? cadastroEfetivoSaude(entes, NORONHA) : entes), [saude, entes]);
  return (
    <div className="filtros">
      {!semAno && (
        <div className="campo">
          <label htmlFor="f-ano">{trabalho ? t('Ano da RAIS', 'RAIS year') : saude ? t('Ano', 'Year') : t('Exercício', 'Fiscal year')}</label>
          <select id="f-ano" value={comUltimo && (f.ultimo || (ultimoPadrao && f.semAnoUrl)) ? 'ultimo' : f.ano}
            onChange={(e) => f.definir({ ano: e.target.value === 'ultimo' ? 'ultimo' : Number(e.target.value) })}>
            {comUltimo && <option value="ultimo">{t('Último ano de cada fonte', 'Latest year of each source')}</option>}
            {[...f.anos].reverse().map((a) => (
              <option key={a} value={a}>{anosCobertos && !anosCobertos.includes(a) ? `${a} (${t('fora da cobertura', 'outside coverage')})` : a}</option>
            ))}
          </select>
        </div>
      )}
      <div className="campo">
        <label htmlFor="f-uf">{t('UF', 'State')}</label>
        <select id="f-uf" value={f.uf ?? ''} onChange={(e) => f.definir({ uf: e.target.value || null, ente: null })}>
          <option value="">{t('Brasil', 'Brazil')}</option>
          {UFS.map((u) => (
            <option key={u} value={u}>{u === 'DF' ? t('DF (Distrito Federal)', 'DF (Federal District)') : u}</option>
          ))}
        </select>
      </div>
      {!semBuscaEnte && (
        <BuscaEnte entes={entesBusca} uf={f.uf} atual={f.ente} explicacao={semEnte}
          aoEscolher={(e) => f.definir({ ente: e?.cod_ibge ?? null, uf: e?.uf ?? f.uf })} />
      )}
      {f.temFiltros && (
        <button className="limpar limpar-tudo" onClick={f.limpar}>{t('Limpar todos os filtros', 'Clear all filters')}</button>
      )}
    </div>
  );
}

function normalizar(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** Ordem da busca: nome exato, começo do nome, palavra que começa com o termo, e só então "contém". */
export function ordenarBusca(entes: Ente[], termo: string, uf: string | null, limite = 60): Ente[] {
  const t0 = normalizar(termo);
  const lista = entes.filter((e) => !uf || e.uf === uf);
  if (!t0) return lista.slice(0, limite);
  const pontos = (e: Ente) => {
    if (/^\d+$/.test(t0)) return String(e.cod_ibge).startsWith(t0) ? 0 : 9;
    const n = normalizar(e.nome);
    if (n === t0) return 0;
    if (n.startsWith(t0)) return 1;
    if (n.split(/[\s-]+/).some((p) => p.startsWith(t0))) return 2;
    return n.includes(t0) ? 3 : 9;
  };
  return lista
    .map((e) => [pontos(e), e] as const)
    .filter(([p]) => p < 9)
    .sort((a, b) => a[0] - b[0] || a[1].nome.localeCompare(b[1].nome, local()) || (a[1].esfera === 'M' ? 1 : -1))
    .slice(0, limite)
    .map(([, e]) => e);
}

const descreverEnte = (e: Ente) => (e.esfera === 'M' ? `${e.nome} (${e.uf}) — ${tipoEnte(e)}` : `${e.nome} — ${tipoEnte(e)}`);

/** Busca de ente por nome ou código (usada nos filtros e no contexto da página da IA). */
export function BuscaEnte({ entes, uf, atual, aoEscolher, explicacao, rotulo, id = 'f-ente', semLimpar = false }: {
  entes: Ente[]; uf: string | null; atual: Ente | null; aoEscolher: (e: Ente | null) => void; explicacao?: string; rotulo?: string;
  /** id do campo (mais de uma busca na mesma página) */
  id?: string;
  /** sem o botão "limpar" (quando a página sempre precisa de um ente) */
  semLimpar?: boolean;
}) {
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  // navegou: as setas moveram a opção ativa; sem isso (e sem texto) o Enter não escolhe ninguém
  const [navegou, setNavegou] = useState(false);
  const opcoes = useMemo(() => ordenarBusca(entes, texto, uf), [entes, uf, texto]);
  const lista = useRef<HTMLUListElement>(null);
  // IDs da lista e opções únicos por instância; o id do campo é informado pelo chamador quando há duas buscas.
  const uid = useId();
  const idLista = `${uid}-lista`;
  const idAtual = `${uid}-atual`;
  const idOpcao = (cod: number) => `${uid}-op-${cod}`;
  const ativo = focoValido(foco, opcoes.length);

  // a opção ativa acompanha a rolagem DA LISTA (scrollTop do próprio ul; scrollIntoView poderia rolar a página)
  useEffect(() => {
    const ul = lista.current;
    const li = aberto && opcoes[ativo] ? document.getElementById(idOpcao(opcoes[ativo].cod_ibge)) : null;
    if (!ul || !li) return;
    ul.scrollTop = rolagemParaOpcao(li.offsetTop, li.offsetHeight, ul.scrollTop, ul.clientHeight);
    // idOpcao só depende do uid
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto, ativo, opcoes]);

  const escolher = (e: Ente | null) => {
    aoEscolher(e);
    setTexto('');
    setAberto(false);
    setNavegou(false);
    setFoco(0);
  };

  return (
    <div className="campo combo">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <label htmlFor={id}>{rotulo ?? t('Ente (município, estado ou DF)', 'Government (municipality, state or DF)')}</label>
        {explicacao && <Dica rotulo={t('Função do ente nesta página', 'Role of the government on this page')}>{explicacao}</Dica>}
      </div>
      <input
        id={id}
        role="combobox"
        aria-expanded={aberto}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-describedby={atual ? idAtual : undefined}
        aria-activedescendant={aberto && opcoes[ativo] ? idOpcao(opcoes[ativo].cod_ibge) : undefined}
        placeholder={atual ? descreverEnte(atual) : t('Buscar por nome ou código IBGE…', 'Search by name or IBGE code…')}
        value={texto}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberto(true);
          setFoco(0);
          setNavegou(false);
        }}
        onKeyDown={(e) => {
          const r = teclaBusca(e.key, { aberto, foco: ativo, total: opcoes.length, texto, navegou });
          if (r.impedir) e.preventDefault();
          setAberto(r.aberto);
          setFoco(r.foco);
          setNavegou(r.navegou);
          if (r.selecionar !== null) escolher(opcoes[r.selecionar]);
        }}
      />
      {atual && (
        <div style={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
          <small id={idAtual} style={{ color: 'var(--tinta-2)' }}>{t('Selecionado', 'Selected')}: {descreverEnte(atual)}</small>
          {!semLimpar && (
            <button type="button" className="limpar" style={{ padding: 0, fontSize: 12 }}
              aria-label={t(`Limpar o ente selecionado: ${atual.nome}`, `Clear the selected government: ${atual.nome}`)}
              onClick={() => escolher(null)}>
              {t('limpar', 'clear')}
            </button>
          )}
        </div>
      )}
      {aberto && opcoes.length > 0 && (
        <ul id={idLista} ref={lista} role="listbox" aria-label={rotulo ?? t('Entes encontrados', 'Governments found')}>
          {opcoes.map((e, i) => (
            <li
              key={e.cod_ibge}
              id={idOpcao(e.cod_ibge)}
              role="option"
              aria-selected={i === ativo}
              className={i === ativo ? 'foco' : undefined}
              onMouseDown={() => escolher(e)}
            >
              <span>{e.nome}{e.esfera === 'M' ? ` (${e.uf})` : ''}</span>
              <small>{tipoEnte(e)} · {e.cod_ibge}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type LinhaCobertura = {
  exercicio: number; entes: number; esperados: number | null; excluidos: number; sem_dados: number | null;
  populacao: number | null; sinalizados: number; valor_excluido: number | null;
};

/**
 * Cobertura do agregado: quantos entes têm dados no domínio, quantos faltam no cadastro, quantos
 * o filtro tirou e quanto valor ficou de fora. Para um ente, não mostra nada (os valores são os dele).
 */
export function Cobertura({ dominio, ano }: { dominio: 'receita' | 'despesa' | 'patrimonio'; ano?: number }) {
  const f = useFiltros();
  const r = useApi<LinhaCobertura[]>(f.alvo ? null : 'cobertura', { ...f.escopo, dominio, ano: ano ?? f.ano });
  const c = r.dados?.[0];
  if (f.alvo || !c) return null;
  const nome = { receita: t('receitas', 'revenue'), despesa: t('despesas', 'expenditure'), patrimonio: t('balanço', 'balance sheet') }[dominio];
  return (
    <p className="cobertura" role="note">
      <strong>{t('Cobertura', 'Coverage')} ({nome}, {c.exercicio}):</strong>{' '}
      {numero(c.entes)} {t('de', 'of')} {numero(c.esperados)} {t('municípios do cadastro', 'municipalities in the registry')}
      {c.esperados ? ` (${pct(c.entes / c.esperados)})` : ''} · {numero(c.sem_dados)} {t('sem declaração utilizável', 'without a usable filing')}
      {c.excluidos > 0 && (
        <> · {numero(c.excluidos)} {t('excluídos por inconsistência', 'excluded for inconsistency')}
          {c.valor_excluido ? ` (${reais(c.valor_excluido)} ${t('declarados fora do total', 'reported, left out of the total')})` : ''}</>
      )}
      {' '}· {t('população dos incluídos', 'population of those included')}: {numero(c.populacao)}.
      {' '}<Dica rotulo={t('Como ler a cobertura', 'How to read coverage')}>
        {t(
          'O universo é o cadastro de entes do SICONFI (atual). “Sem declaração utilizável”: o município não entregou a DCA do exercício ou entregou sem o total do domínio. “Excluídos por inconsistência”: valor real mais de 10× a mediana do próprio ente e acima do PIB do município no ano, ou erro confirmado em revisão; saem só do domínio afetado. Suspeitas estatísticas continuam no total. A população é a declarada na DCA e soma só os municípios incluídos, para o per capita usar o mesmo conjunto. Brasília consta no cadastro, mas as contas do DF são declaradas pelo ente Distrito Federal.',
          'The universe is the current SICONFI registry of governments. “Without a usable filing”: the municipality did not submit the year’s DCA or submitted it without the domain total. “Excluded for inconsistency”: real value more than 10× the government’s own median and above the municipality’s GDP in the year, or an error confirmed in review; excluded only from the affected domain. Statistical flags remain in the total. Population is the one reported in the DCA and adds up only the included municipalities, so per capita uses the same set. Brasília is in the registry, but the DF accounts are filed by the Federal District government.',
        )}
      </Dica>
    </p>
  );
}
