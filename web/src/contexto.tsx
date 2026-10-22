import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, type Ente, type Meta, type Params } from './api';

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
  if (meta.erro || entes.erro) return <p className="vazio erro">Não foi possível carregar os dados: {meta.erro ?? entes.erro}</p>;
  if (!valor) return <p className="carregando">Carregando o motor de consultas e a lista de entes…</p>;
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useDados = () => useContext(Ctx)!;

export const UFS = 'AC AL AM AP BA CE DF ES GO MA MG MS MT PA PB PE PI PR RJ RN RO RR RS SC SE SP TO'.split(' ');
const ESFERA = { M: 'Município', E: 'Estado', D: 'Distrito Federal' } as const;

/** Filtros globais guardados na URL (ano, uf, ente), para links compartilháveis. */
export function useFiltros() {
  const { meta, porCodigo } = useDados();
  const [busca, setBusca] = useSearchParams();
  const anoUrl = Number(busca.get('ano'));
  const ano = meta.anos.includes(anoUrl) ? anoUrl : meta.anos.at(-1)!;
  const ente = porCodigo.get(Number(busca.get('ente'))) ?? null;
  const uf = ente?.uf ?? (UFS.includes(busca.get('uf') ?? '') ? busca.get('uf')! : null);

  const definir = (novo: { ano?: number; uf?: string | null; ente?: number | null }) => {
    const p = new URLSearchParams(busca);
    for (const [k, v] of Object.entries(novo)) {
      if (v === null || v === undefined || v === '') p.delete(k);
      else p.set(k, String(v));
    }
    setBusca(p, { replace: true });
  };

  /** Parâmetros de escopo para a API: o ente, ou os municípios da UF, ou do Brasil. */
  const escopo: Params = ente ? { ente: ente.cod_ibge } : { uf: uf ?? undefined, esfera: 'M' };
  const rotulo = ente
    ? `${ente.nome}${ente.esfera === 'M' ? ` (${ente.uf})` : ''}`
    : uf
      ? `Municípios de ${uf}`
      : 'Todos os municípios';
  const rotuloComparador = ente ? (ente.esfera === 'M' ? `Municípios de ${ente.uf}` : 'Todos os estados') : uf ? 'Brasil' : null;
  /** Escopo do comparador (para séries): UF do município, ou Brasil. */
  const escopoComparador: Params | null = ente
    ? ente.esfera === 'M'
      ? { uf: ente.uf, esfera: 'M' }
      : { esfera: ente.esfera }
    : uf
      ? { esfera: 'M' }
      : null;

  return { ano, uf, ente, definir, escopo, rotulo, rotuloComparador, escopoComparador, anos: meta.anos };
}

export type Alerta = {
  exercicio: number; cod_ibge: number; nome: string; uf: string; esfera: string;
  indicador: string; valor: number | null; mediana: number | null; razao: number | null; motivo: string;
};

const ROTULO_INDICADOR: Record<string, string> = { receita_bruta: 'receita bruta', despesa_empenhada: 'despesa empenhada' };

export function BarraFiltros({ semAno = false }: { semAno?: boolean }) {
  const f = useFiltros();
  const alertas = useApi<Alerta[]>(f.ente ? 'alertas' : null, { ente: f.ente?.cod_ibge });
  const doAno = (alertas.dados ?? []).filter((a) => a.exercicio === f.ano);
  return (
    <>
      <Filtros semAno={semAno} />
      {doAno.length > 0 && (
        <p className="aviso" role="status">
          ⚠ Declaração atípica em {f.ano}:{' '}
          {doAno.map((a) => `${ROTULO_INDICADOR[a.indicador] ?? a.indicador} ${a.motivo}${a.razao ? ` (${a.razao.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}× a mediana do ente)` : ''}`).join('; ')}.
          Os valores aparecem como o ente declarou, mas este ano fica fora dos totais de UF, Brasil e rankings.
        </p>
      )}
    </>
  );
}

function Filtros({ semAno }: { semAno: boolean }) {
  const { entes } = useDados();
  const f = useFiltros();
  return (
    <div className="filtros">
      {!semAno && (
        <div className="campo">
          <label htmlFor="f-ano">Exercício</label>
          <select id="f-ano" value={f.ano} onChange={(e) => f.definir({ ano: Number(e.target.value) })}>
            {[...f.anos].reverse().map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
      )}
      <div className="campo">
        <label htmlFor="f-uf">UF</label>
        <select id="f-uf" value={f.uf ?? ''} onChange={(e) => f.definir({ uf: e.target.value || null, ente: null })}>
          <option value="">Brasil</option>
          {UFS.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </div>
      <BuscaEnte entes={entes} uf={f.uf} atual={f.ente} aoEscolher={(e) => f.definir({ ente: e?.cod_ibge ?? null, uf: e?.uf ?? f.uf })} />
    </div>
  );
}

function normalizar(s: string) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function BuscaEnte({ entes, uf, atual, aoEscolher }: {
  entes: Ente[]; uf: string | null; atual: Ente | null; aoEscolher: (e: Ente | null) => void;
}) {
  const [texto, setTexto] = useState('');
  const [aberto, setAberto] = useState(false);
  const [foco, setFoco] = useState(0);
  const opcoes = useMemo(() => {
    const t = normalizar(texto.trim());
    return entes
      .filter((e) => (!uf || e.uf === uf) && (!t || normalizar(e.nome).includes(t) || String(e.cod_ibge).startsWith(t)))
      .slice(0, 60);
  }, [entes, uf, texto]);

  const escolher = (e: Ente | null) => {
    aoEscolher(e);
    setTexto('');
    setAberto(false);
  };

  return (
    <div className="campo combo">
      <label htmlFor="f-ente">
        Ente (município, estado ou DF)
        {atual && (
          <button className="limpar" style={{ padding: '0 0 0 8px', textTransform: 'none' }} onClick={() => escolher(null)}>
            limpar
          </button>
        )}
      </label>
      <input
        id="f-ente"
        role="combobox"
        aria-expanded={aberto}
        aria-controls="f-ente-lista"
        placeholder={atual ? `${atual.nome} — ${ESFERA[atual.esfera]}` : 'Buscar por nome ou código IBGE…'}
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
              role="option"
              aria-selected={i === foco}
              className={i === foco ? 'foco' : undefined}
              onMouseDown={() => escolher(e)}
            >
              <span>{e.nome}</span>
              <small>{e.esfera === 'M' ? e.uf : ESFERA[e.esfera]}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
