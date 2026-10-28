import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useApi, type Ente, type Meta, type Params } from './api';
import { Dica } from './components/Dica';
import { Estado } from './components/Kpi';
import { numero, pct, reais } from './format';
import { dado, local, t } from './idioma';

type Contexto = { meta: Meta; entes: Ente[]; porCodigo: Map<number, Ente> };
const Ctx = createContext<Contexto | null>(null);

export function ProvedorDados({ children }: { children: ReactNode }) {
  const meta = useApi<Meta>('meta');
  const entes = useApi<Ente[]>('entes');
  const valor = useMemo(
    () =>
      meta.dados && entes.dados
        ? { meta: meta.dados, entes: entes.dados, porCodigo: new Map(entes.dados.map((e) => [e.cod_ibge, e])) }
        : null,
    [meta.dados, entes.dados],
  );
  if (meta.erro || entes.erro) {
    return (
      <Estado
        erro={meta.erro ?? entes.erro}
        mensagem={t('Não foi possível carregar os dados.', 'Could not load the data.')}
        tentarNovamente={() => { meta.recarregar(); entes.recarregar(); }}
      />
    );
  }
  if (!valor) return <p className="carregando" role="status">{t('Carregando o motor de consultas e a lista de entes…', 'Loading the query engine and the list of governments…')}</p>;
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useDados = () => useContext(Ctx)!;

export const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
/** UFs sem municípios próprios: o escopo da UF é o próprio ente (DF). */
const UF_SEM_MUNICIPIOS = new Set(['DF']);
export const esfera = (e: Ente['esfera']) =>
  ({ M: t('Município', 'Municipality'), E: t('Estado', 'State'), D: t('Distrito Federal', 'Federal District') })[e];
/**
 * Política única dos agregados: saem só as inconsistências objetivas e os erros confirmados
 * (alertas.parquet, exclui = true), e só no domínio sinalizado. Suspeitas estatísticas ficam nos totais.
 */
const TRATAMENTO = 'filtrado';

/** Filtros globais guardados na URL (ano, uf, ente), para links compartilháveis. */
export function useFiltros() {
  const { meta, porCodigo, entes } = useDados();
  const [busca, setBusca] = useSearchParams();
  const anoUrl = Number(busca.get('ano'));
  const ano = meta.anos.includes(anoUrl) ? anoUrl : meta.anos.at(-1)!;
  const ente = porCodigo.get(Number(busca.get('ente'))) ?? null;
  const ufUrl = UFS.includes(busca.get('uf') ?? '') ? busca.get('uf')! : null;
  const uf = ente?.uf ?? ufUrl;
  const tratamento = TRATAMENTO;
  // DF: a UF é o próprio ente Distrito Federal
  const enteDaUf = !ente && uf && UF_SEM_MUNICIPIOS.has(uf) ? entes.find((e) => e.uf === uf && e.esfera === 'D') ?? null : null;
  const alvo = ente ?? enteDaUf;

  const definir = (novo: { ano?: number; uf?: string | null; ente?: number | null }) => {
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
    ano, uf, ente, alvo, definir, limpar, escopo, rotulo, rotuloComparador, escopoComparador, tratamento, anos: meta.anos,
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

type Opcoes = { semAno?: boolean; semEnte?: string };

export function BarraFiltros(opcoes: Opcoes = {}) {
  const f = useFiltros();
  // as sinalizações são das declarações do SICONFI: não valem para a área de mercado de trabalho (RAIS e CAGED)
  const financas = !useLocation().pathname.startsWith('/trabalho');
  const alertas = useApi<Alerta[]>(f.alvo && financas ? 'alertas' : null, { ente: f.alvo?.cod_ibge });
  const doAno = (alertas.dados ?? []).filter((a) => a.exercicio === f.ano);
  return (
    <>
      <Filtros {...opcoes} />
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

function Filtros({ semAno, semEnte }: Opcoes) {
  const { entes } = useDados();
  const f = useFiltros();
  return (
    <div className="filtros">
      {!semAno && (
        <div className="campo">
          <label htmlFor="f-ano">{t('Exercício', 'Fiscal year')}</label>
          <select id="f-ano" value={f.ano} onChange={(e) => f.definir({ ano: Number(e.target.value) })}>
            {[...f.anos].reverse().map((a) => (
              <option key={a}>{a}</option>
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
      <BuscaEnte entes={entes} uf={f.uf} atual={f.ente} explicacao={semEnte}
        aoEscolher={(e) => f.definir({ ente: e?.cod_ibge ?? null, uf: e?.uf ?? f.uf })} />
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

const descreverEnte = (e: Ente) => (e.esfera === 'M' ? `${e.nome} (${e.uf}) — ${esfera(e.esfera)}` : `${e.nome} — ${esfera(e.esfera)}`);

/** Busca de ente por nome ou código (usada nos filtros e no contexto da página da IA). */
export function BuscaEnte({ entes, uf, atual, aoEscolher, explicacao, rotulo }: {
  entes: Ente[]; uf: string | null; atual: Ente | null; aoEscolher: (e: Ente | null) => void; explicacao?: string; rotulo?: string;
}) {
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  const opcoes = useMemo(() => ordenarBusca(entes, texto, uf), [entes, uf, texto]);

  const escolher = (e: Ente | null) => {
    aoEscolher(e);
    setTexto('');
    setAberto(false);
  };

  return (
    <div className="campo combo">
      <label htmlFor="f-ente">
        {rotulo ?? t('Ente (município, estado ou DF)', 'Government (municipality, state or DF)')}
        {explicacao && <Dica rotulo={t('Função do ente nesta página', 'Role of the government on this page')}>{explicacao}</Dica>}
        {atual && (
          <button className="limpar" style={{ padding: '0 0 0 8px', textTransform: 'none' }} onClick={() => escolher(null)}>
            {t('limpar', 'clear')}
          </button>
        )}
      </label>
      <input
        id="f-ente"
        role="combobox"
        aria-expanded={aberto}
        aria-controls="f-ente-lista"
        aria-autocomplete="list"
        aria-activedescendant={aberto && opcoes[foco] ? `f-ente-${opcoes[foco].cod_ibge}` : undefined}
        placeholder={atual ? descreverEnte(atual) : t('Buscar por nome ou código IBGE…', 'Search by name or IBGE code…')}
        value={texto}
        onFocus={() => setAberto(true)}
        onBlur={() => setTimeout(() => setAberto(false), 150)}
        onChange={(e) => {
          setTexto(e.target.value);
          setAberto(true);
          setFoco(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setFoco((i) => Math.min(i + 1, opcoes.length - 1));
          else if (e.key === 'ArrowUp') setFoco((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && opcoes[foco]) escolher(opcoes[foco]);
          else if (e.key === 'Escape') setAberto(false);
        }}
      />
      {aberto && opcoes.length > 0 && (
        <ul id="f-ente-lista" role="listbox">
          {opcoes.map((e, i) => (
            <li
              key={e.cod_ibge}
              id={`f-ente-${e.cod_ibge}`}
              role="option"
              aria-selected={i === foco}
              className={i === foco ? 'foco' : undefined}
              onMouseDown={() => escolher(e)}
            >
              <span>{e.nome}{e.esfera === 'M' ? ` (${e.uf})` : ''}</span>
              <small>{esfera(e.esfera)} · {e.cod_ibge}</small>
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
