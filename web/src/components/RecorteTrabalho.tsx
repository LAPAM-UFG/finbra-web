import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useApi, type Linha } from '../api';
import { useDados, useFiltros } from '../contexto';
import { t } from '../idioma';
import { FILTROS_AVANCADOS, paramsDoRecorte, type Recorte } from '../trabalho_comum';
import { Dica } from './Dica';

export const SITUACOES = (): [string, string][] => [
  ['', t('Todos os vínculos do ano', 'All jobs in the year')],
  ['ativos', t('Ativos em 31/12', 'Active on Dec 31')],
  ['nao_ativos', t('Não ativos em 31/12', 'Not active on Dec 31')],
  ['desligados', t('Desligados no ano', 'Separated during the year')],
  ['afastados', t('Afastados no ano', 'On leave during the year')],
];

const NIVEIS: Record<string, string> = {
  cbo_grande_grupo: 'grande grupo', cbo_subgrupo_principal: 'subgrupo principal', cbo_subgrupo: 'subgrupo', cbo_familia: 'família', cbo: 'ocupação',
};
const nivel = (n: unknown) => t(NIVEIS[String(n)] ?? String(n), ({
  cbo_grande_grupo: 'major group', cbo_subgrupo_principal: 'sub-major group', cbo_subgrupo: 'minor group', cbo_familia: 'family', cbo: 'occupation',
} as Record<string, string>)[String(n)] ?? String(n));

const separar = (v: string) => v.split(/[\s,;]+/).filter(Boolean);
const juntar = (l: string[]) => l.join(', ');

/** Ocupações (CBO 2002): busca em todos os níveis, com o nível de cada código e a expansão de uma família. */
function CampoOcupacao({ valor, mudar }: { valor: string; mudar: (v: string) => void }) {
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const achados = useApi<Linha[]>(busca.trim().length >= 2 ? 'trab_busca_ocupacao' : null, { texto: busca.trim() });
  const contidos = useApi<Linha[]>(aberta ? 'trab_codigos' : null, { variavel: 'cbo', prefixo: aberta ?? '' });
  const atuais = separar(valor);
  const acrescentar = (c: string) => {
    // um código dentro de outro já escolhido não acrescenta nada (o vínculo conta uma vez)
    if (atuais.some((a) => c.startsWith(a))) return;
    mudar(juntar([...atuais.filter((a) => !a.startsWith(c)), c]));
  };
  return (
    <div className="campo campo-codigos">
      <label htmlFor="q-cbo">
        {t('Ocupação (CBO 2002)', 'Occupation (CBO 2002)')}
        <Dica rotulo={t('O que é a CBO', 'What CBO is')}>{t(
          'Classificação Brasileira de Ocupações: a ocupação exercida no vínculo, declarada pelo empregador. Não é formação acadêmica, registro profissional nem o universo de diplomados: um economista que trabalha como gerente aparece como gerente. Níveis: grande grupo (1 dígito), subgrupo principal (2), subgrupo (3), família (4) e ocupação (6). Códigos são prefixos: 2512 inclui todas as ocupações da família.',
          'Brazilian Classification of Occupations: the occupation performed in the job, as reported by the employer. It is not academic training, professional registration or the universe of graduates: an economist working as a manager appears as a manager. Levels: major group (1 digit), sub-major group (2), minor group (3), family (4) and occupation (6). Codes are prefixes: 2512 includes every occupation in the family.',
        )}</Dica>
      </label>
      <input id="q-cbo" value={valor} onChange={(e) => mudar(e.target.value)} placeholder={t('ex.: 2512 (família), 251205', 'e.g. 2512 (family), 251205')} />
      <input aria-label={t('Buscar ocupação pelo nome ou código', 'Search occupation by name or code')} value={busca}
        onChange={(e) => setBusca(e.target.value)} placeholder={t('buscar ocupação pelo nome…', 'search occupation by name…')} />
      {busca.trim().length >= 2 && (achados.dados ?? []).length > 0 && (
        <ul className="sugestoes">
          {(achados.dados ?? []).map((r) => (
            <li key={`${r.nivel}${r.codigo}`}>
              <button className="limpar" onClick={() => acrescentar(String(r.codigo))}>
                <code>{String(r.codigo)}</code> {String(r.descricao)} <small>· {nivel(r.nivel)}{r.familia ? ` · ${t('família', 'family')} ${String(r.codigo).slice(0, 4)} ${r.familia}` : ''}</small>
              </button>
              {r.nivel === 'cbo_familia' && (
                <button className="limpar" aria-expanded={aberta === r.codigo} onClick={() => setAberta(aberta === r.codigo ? null : String(r.codigo))}>
                  {aberta === r.codigo ? t('esconder códigos', 'hide codes') : t('ver códigos', 'show codes')}
                </button>
              )}
              {aberta === r.codigo && (
                <ul className="codigos-familia">
                  {(contidos.dados ?? []).map((c) => (
                    <li key={String(c.codigo)}><button className="limpar" onClick={() => acrescentar(String(c.codigo))}><code>{String(c.codigo)}</code> {String(c.descricao)}</button></li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Atividade (CNAE 2.0), com busca por nome no dicionário. */
function CampoAtividade({ valor, mudar }: { valor: string; mudar: (v: string) => void }) {
  const [busca, setBusca] = useState('');
  const achados = useApi<Linha[]>(busca.trim().length >= 3 ? 'trab_dicionario' : null, { variavel: 'cnae_classe', texto: busca.trim() });
  return (
    <div className="campo campo-codigos">
      <label htmlFor="q-cnae">
        {t('Atividade do estabelecimento (CNAE 2.0)', 'Establishment activity (CNAE 2.0)')}
        <Dica rotulo={t('O que é a CNAE', 'What CNAE is')}>{t(
          'Atividade econômica principal do estabelecimento onde está o vínculo, não a ocupação da pessoa. Um contador de um hospital está na CNAE de saúde. A divisão 84 é a atividade Administração pública, defesa e seguridade social; ela não reúne todos os vínculos do setor público, que também está em educação, saúde e outras atividades (para isso, use o setor institucional, nos filtros avançados).',
          'Main economic activity of the establishment where the job is, not the person’s occupation. An accountant at a hospital is in the health CNAE. Division 84 is the activity Public administration, defence and social security; it does not cover every public-sector job, which also appears in education, health and other activities (for that, use the institutional sector in the advanced filters).',
        )}</Dica>
      </label>
      <input id="q-cnae" value={valor} onChange={(e) => mudar(e.target.value)} placeholder={t('ex.: 4711, 56 (prefixos)', 'e.g. 4711, 56 (prefixes)')} />
      <input aria-label={t('Buscar atividade pelo nome', 'Search activity by name')} value={busca}
        onChange={(e) => setBusca(e.target.value)} placeholder={t('buscar atividade pelo nome…', 'search activity by name…')} />
      {busca.trim().length >= 3 && (achados.dados ?? []).length > 0 && (
        <ul className="sugestoes">
          {(achados.dados ?? []).map((r) => (
            <li key={String(r.codigo)}>
              <button className="limpar" onClick={() => !separar(valor).includes(String(r.codigo)) && mudar(juntar([...separar(valor), String(r.codigo)]))}>
                <code>{String(r.codigo)}</code> {String(r.descricao)} <small>· {t('classe', 'class')}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Caixas de seleção com os códigos de uma variável (nomes do dicionário). */
function ListaCodigos({ variavel, rotulo, valor, mudar }: { variavel: string; rotulo: string; valor: string; mudar: (v: string) => void }) {
  const codigos = useApi<Linha[]>('trab_codigos', { variavel });
  const marcados = new Set(separar(valor));
  return (
    <fieldset className="lista-codigos">
      <legend>{rotulo}</legend>
      {(codigos.dados ?? []).map((c) => {
        const k = String(c.codigo);
        return (
          <label key={k}>
            <input type="checkbox" checked={marcados.has(k)} onChange={(e) => {
              const n = new Set(marcados);
              if (e.target.checked) n.add(k); else n.delete(k);
              mudar(juntar([...n].sort((a, b) => Number(a) - Number(b))));
            }} /> {String(c.descricao)}
          </label>
        );
      })}
    </fieldset>
  );
}

type Rascunho = { cbo: string; cnae: string; sit: string; sexo: string; listas: Record<string, string> };
const doRecorte = (r: Recorte): Rascunho => ({ cbo: r.cbo, cnae: r.cnae, sit: r.situacao, sexo: r.sexo, listas: { ...r.listas } });
const igual = (a: Rascunho, b: Rascunho) => JSON.stringify(a) === JSON.stringify(b);

/** Nomes curtos dos códigos de uma lista (para as etiquetas). */
function useNomes(variavel: string) {
  const r = useApi<Linha[]>('trab_codigos', { variavel });
  return useMemo(() => new Map((r.dados ?? []).map((c) => [String(c.codigo), String(c.descricao)])), [r.dados]);
}

function Etiqueta({ rotulo, valor, remover }: { rotulo: string; valor: string; remover: () => void }) {
  return (
    <span className="etiqueta">
      <span><strong>{rotulo}:</strong> {valor}</span>
      <button className="limpar" aria-label={t(`Remover filtro ${rotulo}`, `Remove filter ${rotulo}`)} onClick={remover}>×</button>
    </span>
  );
}

function EtiquetaLista({ chave, variavel, rotulo, valor, remover }: { chave: string; variavel: string; rotulo: string; valor: string; remover: () => void }) {
  const nomes = useNomes(variavel);
  return <Etiqueta key={chave} rotulo={rotulo} valor={separar(valor).map((c) => nomes.get(c) ?? c).join('; ')} remover={remover} />;
}

/** Etiquetas removíveis dos filtros já aplicados (os da URL). */
export function EtiquetasRecorte({ recorte, definir }: { recorte: Recorte; definir: (n: Record<string, string | null>) => void }) {
  const itens: ReactNode[] = [];
  if (recorte.cbo) itens.push(<Etiqueta key="cbo" rotulo="CBO" valor={recorte.cbo} remover={() => definir({ cbo: null })} />);
  if (recorte.cnae) itens.push(<Etiqueta key="cnae" rotulo="CNAE" valor={recorte.cnae} remover={() => definir({ cnae: null })} />);
  if (recorte.situacao) itens.push(<Etiqueta key="sit" rotulo={t('Vínculos', 'Jobs')} valor={SITUACOES().find(([k]) => k === recorte.situacao)?.[1] ?? recorte.situacao} remover={() => definir({ sit: null })} />);
  if (recorte.sexo) itens.push(<Etiqueta key="sexo" rotulo={t('Sexo', 'Sex')} valor={recorte.sexo === '2' ? t('Feminino', 'Female') : t('Masculino', 'Male')} remover={() => definir({ sexo: null })} />);
  if (recorte.muns) itens.push(<Etiqueta key="muns" rotulo={t('Municípios', 'Municipalities')} valor={recorte.muns} remover={() => definir({ muns: null })} />);
  for (const f of FILTROS_AVANCADOS()) {
    if (recorte.listas[f.chave]) itens.push(<EtiquetaLista key={f.chave} chave={f.chave} variavel={f.variavel} rotulo={f.rotulo} valor={recorte.listas[f.chave]} remover={() => definir({ [f.chave]: null })} />);
  }
  if (!itens.length) return <p className="nota-base">{t('Nenhum filtro aplicado: todos os vínculos do território e do ano.', 'No filters applied: every job in the territory and year.')}</p>;
  return <div className="etiquetas" aria-label={t('Filtros aplicados', 'Applied filters')}>{itens}</div>;
}

/**
 * Formulário do recorte: o rascunho (o que está nos campos) só vale depois de Aplicar, que grava na URL;
 * as etiquetas mostram o que já está aplicado. `extra` recebe campos próprios da página (agrupamentos…).
 */
export function FormularioRecorte({ recorte, definir, micro, extra, rotuloAplicar, aplicarExtra }: {
  recorte: Recorte; definir: (n: Record<string, string | null>) => void; micro: boolean;
  extra?: ReactNode; rotuloAplicar?: string; aplicarExtra?: Record<string, string | null>;
}) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => doRecorte(recorte));
  const aplicado = doRecorte(recorte);
  // a URL mudou por fora (etiqueta removida, link aberto, voltar do navegador): os campos acompanham
  const chaveAplicada = JSON.stringify(aplicado);
  useEffect(() => setRascunho(doRecorte(recorte)), [chaveAplicada]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendente = !igual(rascunho, aplicado);
  const avancados = Object.keys(rascunho.listas).length;
  const aplicar = () => {
    const novo: Record<string, string | null> = {
      cbo: rascunho.cbo.trim() || null, cnae: rascunho.cnae.trim() || null, sit: rascunho.sit || null, sexo: rascunho.sexo || null,
      ...Object.fromEntries(FILTROS_AVANCADOS().map((f) => [f.chave, rascunho.listas[f.chave] || null])),
      ...aplicarExtra,
    };
    definir(novo);
  };
  const lista = (k: string) => (v: string) => setRascunho({ ...rascunho, listas: Object.fromEntries(Object.entries({ ...rascunho.listas, [k]: v }).filter(([, x]) => x)) });
  return (
    <section className="cartao formulario-recorte">
      <div className="filtros">
        <CampoOcupacao valor={rascunho.cbo} mudar={(v) => setRascunho({ ...rascunho, cbo: v })} />
        <CampoAtividade valor={rascunho.cnae} mudar={(v) => setRascunho({ ...rascunho, cnae: v })} />
        <div className="campo">
          <label htmlFor="q-sit">{t('Vínculos', 'Jobs')}</label>
          <select id="q-sit" value={rascunho.sit} onChange={(e) => setRascunho({ ...rascunho, sit: e.target.value })}>
            {SITUACOES().map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="q-sexo">{t('Sexo', 'Sex')}</label>
          <select id="q-sexo" value={rascunho.sexo} onChange={(e) => setRascunho({ ...rascunho, sexo: e.target.value })}>
            <option value="">{t('Ambos', 'Both')}</option>
            <option value="1">{t('Masculino', 'Male')}</option>
            <option value="2">{t('Feminino', 'Female')}</option>
          </select>
        </div>
        {extra}
        <button className="botao" onClick={aplicar}>{rotuloAplicar ?? t('Consultar', 'Run query')}</button>
      </div>
      <details className="avancados">
        <summary>{t('Filtros avançados', 'Advanced filters')}{avancados ? ` (${avancados})` : ''}{!micro ? ` · ${t('só com microdados: escolha uma UF ou um município', 'microdata only: choose a state or municipality')}` : ''}</summary>
        <div className="grade-filtros">
          {FILTROS_AVANCADOS().map((f) => (
            <ListaCodigos key={f.chave} variavel={f.variavel} rotulo={f.rotulo} valor={rascunho.listas[f.chave] ?? ''} mudar={lista(f.chave)} />
          ))}
        </div>
        <p className="nota-base">{t(
          'Dentro de um filtro, as opções marcadas se somam (união); filtros diferentes se combinam (interseção). Códigos de ocupação ou atividade contidos em outro da lista não contam duas vezes.',
          'Within a filter, the checked options add up (union); different filters combine (intersection). Occupation or activity codes contained in another code in the list are not counted twice.',
        )}</p>
      </details>
      <EtiquetasRecorte recorte={recorte} definir={definir} />
      {pendente && (
        <p className="aviso" role="status">{t('Há alterações nos campos que ainda não foram aplicadas: os resultados abaixo são do recorte das etiquetas.', 'Some field changes have not been applied yet: the results below are for the recorte in the tags.')}</p>
      )}
    </section>
  );
}

/** Território das páginas de trabalho a partir dos filtros globais: município (ente), UF ou Brasil. */
export function useTerritorioTrabalho() {
  const f = useFiltros();
  if (f.alvo && f.alvo.esfera !== 'E') {
    return { f, escopo: { ente: f.alvo.cod_ibge } as Record<string, string | number>, rotulo: f.alvo.esfera === 'D' ? 'Brasília (DF)' : f.rotulo, tipo: 'municipio' as const };
  }
  if (f.alvo?.esfera === 'E' || f.uf) {
    const uf = f.alvo?.uf ?? f.uf!;
    return { f, escopo: { uf } as Record<string, string | number>, rotulo: uf, tipo: 'uf' as const };
  }
  return { f, escopo: {} as Record<string, string | number>, rotulo: t('Brasil', 'Brazil'), tipo: 'brasil' as const };
}

/** Parâmetros completos de uma rota de consulta: território, ano e recorte. */
export const paramsConsulta = (escopo: Record<string, string | number>, recorte: Recorte, extra: Record<string, string | number | undefined> = {}) =>
  ({ ...escopo, ...paramsDoRecorte(recorte), ...extra });

/** Anos com microdados (ou tabelas somadas) da consulta. */
export function useAnosConsulta() {
  const { meta } = useDados();
  return ((meta.fontes.rais_micro as { anos?: number[] } | undefined)?.anos ?? []).filter(Number.isInteger);
}
