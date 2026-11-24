import { useEffect, useState } from 'react';
import { USAR_MOTOR } from './clima_abertura';

export type Meta = {
  anos: number[]; anexos: Record<string, string[]>; baseIpca: number; geradoEm: string;
  ipcaUltimo: { exercicio: number; meses: number } | null;
  fontes: Record<string, Record<string, unknown>>;
  mapaIndicadores: Record<string, { chave?: string; descricao?: string; de?: number; ate?: number; anexo?: string; coluna?: string }[]>;
  politica: Record<string, unknown>;
};
export type Ente = { cod_ibge: number; nome: string; uf: string; esfera: 'M' | 'E' | 'D'; capital: boolean };
export type No = {
  chave: string; chave_pai: string | null; nivel: number; descricao: string; tipo: 'conta' | 'total' | 'atributo';
  valor: number | null; valor_comp: number | null; sintetico: boolean | null;
};
export type Arvore = { nos: No[]; populacao: number | null; entes: number; populacao_comp: number | null; comparador: string | null };
export type PontoSerie = {
  ano: number; valor: number | null; valor_real: number | null; populacao: number | null; entes: number;
  esperados: number | null; excluidos: number;
};
export type Linha = Record<string, number | string | null>;

export type Params = Record<string, string | number | null | undefined>;
const cache = new Map<string, Promise<unknown>>();

export function url(caminho: string, params: Params = {}) {
  const busca = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') busca.set(k, String(v));
  const q = busca.toString();
  return `/api/${caminho}${q ? `?${q}` : ''}`;
}

/** Consulta a camada de dados do navegador (DuckDB-WASM); o resultado fica em cache por URL lógica. */
export function buscar<T>(caminho: string, params: Params = {}): Promise<T> {
  const u = url(caminho, params);
  if (!cache.has(u)) {
    // clima_meta, clima_territorios e clima_painel (Clima) e saude_meta, saude_entes, saude_colunas, saude_serie e saude_siops (Saúde) abrem sem o
    // motor (pacotes de abertura); se não houver pacote ou falhar, o motor responde
    const p = (async () => {
      let r:unknown=USAR_MOTOR;
      if (['entes','trab_remuneracao','trab_serie','trab_caged','trab_setores','trab_perfis','munic_territorios','munic_painel','agregado','cobertura'].includes(caminho))
        r=await import('./abertura_paineis').then(m=>m.executarAberturaPaineis(caminho,params));
      if (r===USAR_MOTOR && caminho.startsWith('educacao_fin_')) {
        const m=await import('./educacao_financeira');
        r=await m.executarInicialEducacaoFinanceira(caminho,params);
        if(r===USAR_MOTOR)return import('./dados').then(d=>d.executar(m.fallbackEducacaoFinanceira(caminho),{...params,inclui_df:1}));
      }
      if (r===USAR_MOTOR && ['clima_meta','clima_territorios','clima_painel'].includes(caminho))
        r=await import('./aberturas_iniciais').then(m=>m.executarInicialClima(caminho,params));
      if (r===USAR_MOTOR && ['meta','colunas','entes','saude_meta','saude_entes','saude_colunas','saude_serie','saude_siops'].includes(caminho))
        r=await import('./aberturas_iniciais').then(m=>m.executarInicialSaude(caminho,params));
      return r===USAR_MOTOR?import('./dados').then(m=>m.executar(caminho==='trab_remuneracao'?'trab_consulta':caminho,params)):r;
    })();
    p.catch(() => cache.delete(u));
    cache.set(u, p);
  }
  return cache.get(u) as Promise<T>;
}

/** Busca com estado de carregamento; refaz quando os parâmetros mudam. Caminho null não busca. */
export function useApi<T>(caminho: string | null, params: Params = {}) {
  const chave = caminho ? url(caminho, params) : null;
  const [tentativa, setTentativa] = useState(0);
  const [estado, setEstado] = useState<{ chave: string | null; dados?: T; erro?: string }>({ chave: null });
  useEffect(() => {
    if (!caminho) return;
    let vivo = true;
    buscar<T>(caminho, params)
      .then((dados) => vivo && setEstado({ chave, dados }))
      .catch((e: Error) => vivo && setEstado({ chave, erro: e.message }));
    return () => {
      vivo = false;
    };
    // a chave já resume caminho + parâmetros
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, tentativa]);
  const atual = estado.chave === chave;
  const recarregar = () => {
    if (chave) cache.delete(chave);
    setEstado({ chave: null });
    setTentativa((n) => n + 1);
  };
  return { dados: atual ? estado.dados : undefined, erro: atual ? estado.erro : undefined, carregando: !!chave && !atual, recarregar };
}
