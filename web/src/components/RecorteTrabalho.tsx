import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type RefObject } from 'react';
import { useApi, type Linha } from '../api';
import { useDados, useFiltros } from '../contexto';
import { t } from '../idioma';
import { FILTROS_AVANCADOS, paramsDoRecorte, type Recorte } from '../trabalho_comum';
import { codigosInvalidos } from '../trabalho_orientacao';
import { BotaoEscolherLocal } from './AjudaTrabalho';
import { Dica } from './Dica';

export const SITUACOES = (): [string, string][] => [
  ['', t('Todos os contratos do ano', 'All job contracts in the year')],
  ['ativos', t('Contratos ativos no fim do ano (31/12)', 'Contracts active at year end (Dec 31)')],
  ['nao_ativos', t('Não ativos em 31/12', 'Not active on Dec 31')],
  ['desligados', t('Desligados no ano', 'Separated during the year')],
  ['afastados', t('Afastados no ano', 'On leave during the year')],
];

const AJUDA_SITUACAO = (): Record<string, string> => ({
  '': t('Conta todos os contratos que existiram no ano, inclusive os encerrados antes de 31/12.', 'Counts every contract that existed in the year, including those ended before Dec 31.'),
  ativos: t('Contratos em vigor no fim do ano: os empregos existentes em 31/12. É o retrato mais usado.', 'Contracts in force at year end: the jobs existing on Dec 31. It is the most used snapshot.'),
  nao_ativos: t('Contratos que já não estavam em vigor em 31/12.', 'Contracts no longer in force on Dec 31.'),
  desligados: t('Contratos encerrados durante o ano, com o motivo do desligamento.', 'Contracts ended during the year, with the separation reason.'),
  afastados: t('Contratos com afastamento (licença, doença etc.) em algum momento do ano.', 'Contracts with a leave (sick leave etc.) at some point in the year.'),
});

const NIVEIS: Record<string, string> = {
  cbo_grande_grupo: 'grande grupo', cbo_subgrupo_principal: 'subgrupo principal', cbo_subgrupo: 'subgrupo', cbo_familia: 'família', cbo: 'ocupação',
};
const nivel = (n: unknown) => t(NIVEIS[String(n)] ?? String(n), ({
  cbo_grande_grupo: 'major group', cbo_subgrupo_principal: 'sub-major group', cbo_subgrupo: 'minor group', cbo_familia: 'family', cbo: 'occupation',
} as Record<string, string>)[String(n)] ?? String(n));

const separar = (v: string) => v.split(/[\s,;]+/).filter(Boolean);
const juntar = (l: string[]) => l.join(', ');

const SEM_NOME = () => t('código sem nome exato no dicionário (vale como prefixo)', 'code without an exact name in the dictionary (counts as a prefix)');

/** Nome (e nível) de um código da CBO já escolhido. */
function NomeOcupacao({ codigo }: { codigo: string }) {
  const grande = codigo.length === 1;
  const porTexto = useApi<Linha[]>(!grande && /^\d{2,}$/.test(codigo) ? 'trab_busca_ocupacao' : null, { texto: codigo });
  const porGrupo = useApi<Linha[]>(grande && /^\d$/.test(codigo) ? 'trab_codigos' : null, { variavel: 'cbo_grande_grupo', prefixo: codigo });
  const r = (grande ? porGrupo.dados : porTexto.dados)?.find((x) => String(x.codigo) === codigo);
  if (r) return <>{String(r.descricao)} <small>· {nivel(r.nivel ?? 'cbo_grande_grupo')}</small></>;
  return <small>{porTexto.carregando || porGrupo.carregando ? '…' : SEM_NOME()}</small>;
}

// 4 dígitos (ex.: 4711) é um prefixo: não há nome exato para ele e nenhuma descrição é inventada
const VARIAVEL_CNAE: Record<number, string> = { 2: 'cnae_divisao', 5: 'cnae_classe', 7: 'cnae_subclasse' };

/** Nome de um código da CNAE já escolhido (divisão, classe ou subclasse). */
function NomeAtividade({ codigo }: { codigo: string }) {
  const variavel = /^\d+$/.test(codigo) ? VARIAVEL_CNAE[codigo.length] : undefined;
  const r = useApi<Linha[]>(variavel ? 'trab_dicionario' : null, { variavel, texto: codigo });
  const x = (r.dados ?? []).find((a) => String(a.codigo) === codigo);
  if (x) return <>{String(x.descricao)}</>;
  return <small>{r.carregando ? '…' : SEM_NOME()}</small>;
}

type Item = { codigo: string; descricao: string; nivel?: string; familia?: boolean; detalhe?: string };

/** Ocupações que uma família da CBO contém (para escolher só uma delas). */
function CodigosDaFamilia({ codigo, escolher }: { codigo: string; escolher: (c: string, nome: string) => void }) {
  const contidos = useApi<Linha[]>('trab_codigos', { variavel: 'cbo', prefixo: codigo });
  if (contidos.carregando) return <p className="trabalho-status">{t('Carregando as ocupações da família…', 'Loading the family’s occupations…')}</p>;
  if (contidos.erro) return <p className="trabalho-status">{t('Não foi possível carregar.', 'Could not load.')} <button type="button" className="limpar" onClick={contidos.recarregar}>{t('tentar de novo', 'try again')}</button></p>;
  return (
    <ul className="codigos-familia">
      {(contidos.dados ?? []).map((c) => (
        <li key={String(c.codigo)}><button type="button" className="limpar" onClick={() => escolher(String(c.codigo), String(c.descricao))}><code>{String(c.codigo)}</code> {String(c.descricao)}</button></li>
      ))}
    </ul>
  );
}

/**
 * Campo de códigos (CBO ou CNAE) com a busca por NOME em primeiro plano: o resultado escolhido entra na lista de
 * seleções (com o nome e um × para remover), a busca é limpa e a mudança só vale ao aplicar. O código digitado à mão
 * fica num detalhe opcional e é o mesmo valor (listas, prefixos, vários códigos). Sem role combobox: os resultados
 * são botões comuns, alcançados com Tab; Enter escolhe o primeiro e Esc limpa a busca.
 */
function CampoCodigos({ id, rotulo, dica, valor, mudar, busca, mudarBusca, minimo, estado, itens, Nome, combinar, comFamilia, exemploBusca, rotuloCodigo, placeholderCodigo, ajudaCodigo, entrada, invalido }: {
  id: string; rotulo: string; dica: ReactNode; valor: string; mudar: (v: string) => void;
  busca: string; mudarBusca: (v: string) => void; minimo: number;
  estado: { carregando: boolean; erro?: string; recarregar: () => void };
  itens: Item[]; Nome: ComponentType<{ codigo: string }>;
  /** como um código novo entra na lista (CBO: um código dentro de outro já escolhido não acrescenta nada) */
  combinar: (atuais: string[], novo: string) => string[];
  comFamilia?: boolean; exemploBusca: string; rotuloCodigo: string; placeholderCodigo: string; ajudaCodigo: string;
  entrada: RefObject<HTMLInputElement | null>;
  /** o código digitado à mão tem erro de sintaxe (a mensagem fica junto do botão principal) */
  invalido?: boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [anuncio, setAnuncio] = useState('');
  const atuais = separar(valor);
  const texto = busca.trim();
  const ativa = texto.length >= minimo;
  const escolher = (cod: string, nome: string) => {
    const novo = combinar(atuais, cod);
    const mudou = juntar(novo) !== juntar(atuais);
    if (mudou) mudar(juntar(novo));
    mudarBusca('');
    setAberta(null);
    setAnuncio(mudou
      ? t(`${nome} entrou na seleção. Use o botão principal para atualizar o resultado.`, `${nome} added to the selection. Use the main button to update the result.`)
      : t(`${nome} já está incluído na seleção.`, `${nome} is already included in the selection.`));
    entrada.current?.focus();
  };
  return (
    <div className="campo campo-codigos trabalho-campo">
      <div className="trabalho-rotulo">
        <label htmlFor={`q-${id}-busca`}>{rotulo}</label>
        {dica}
      </div>
      <input id={`q-${id}-busca`} ref={entrada} value={busca} autoComplete="off" aria-describedby={`q-${id}-status`}
        onChange={(e) => mudarBusca(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && busca) { e.preventDefault(); mudarBusca(''); }
          if (e.key === 'Enter' && ativa && itens[0]) { e.preventDefault(); escolher(itens[0].codigo, itens[0].descricao); }
        }}
        placeholder={exemploBusca} />
      <p id={`q-${id}-status`} className="trabalho-status" role="status">
        {anuncio && !texto && anuncio}
        {texto && !ativa && t(`Digite ao menos ${minimo} letras para buscar.`, `Type at least ${minimo} letters to search.`)}
        {ativa && estado.carregando && t('Buscando…', 'Searching…')}
        {ativa && !estado.carregando && estado.erro && <>{t('Não foi possível buscar.', 'Could not search.')} <button type="button" className="limpar" onClick={estado.recarregar}>{t('Tentar de novo', 'Try again')}</button></>}
        {ativa && !estado.carregando && !estado.erro && itens.length === 0 && t(`Nenhum resultado para “${texto}”. Tente outra palavra ou use o código, em “Já sei o código”.`, `No result for “${texto}”. Try another word or use the code, under “I know the code”.`)}
        {ativa && !estado.carregando && !estado.erro && itens.length > 0 && t(`${itens.length} resultado(s): escolha um para adicionar (Enter escolhe o primeiro).`, `${itens.length} result(s): choose one to add (Enter picks the first).`)}
      </p>
      {texto && <button type="button" className="limpar trabalho-limpar-busca" onClick={() => { mudarBusca(''); entrada.current?.focus(); }}>{t('Limpar busca', 'Clear search')}</button>}
      {ativa && itens.length > 0 && (
        <ul className="sugestoes">
          {itens.map((r) => (
            <li key={`${r.nivel ?? ''}${r.codigo}`}>
              <button type="button" className="limpar" onClick={() => escolher(r.codigo, r.descricao)}>
                {r.descricao} <small>· <code>{r.codigo}</code>{r.detalhe ? ` · ${r.detalhe}` : ''}</small>
              </button>
              {comFamilia && r.familia && (
                <button type="button" className="limpar" aria-expanded={aberta === r.codigo} onClick={() => setAberta(aberta === r.codigo ? null : r.codigo)}>
                  {aberta === r.codigo ? t('esconder ocupações da família', 'hide the family’s occupations') : t('ver ocupações da família', 'show the family’s occupations')}
                </button>
              )}
              {aberta === r.codigo && <CodigosDaFamilia codigo={r.codigo} escolher={escolher} />}
            </li>
          ))}
        </ul>
      )}
      {atuais.length > 0 && (
        <div className="trabalho-selecionados">
          <ul aria-label={t(`Selecionados: ${rotulo}`, `Selected: ${rotulo}`)}>
            {atuais.map((c, i) => (
              <li key={`${c}-${i}`}>
                <span><code>{c}</code> <Nome codigo={c} /></span>
                <button type="button" className="limpar" aria-label={t(`Remover ${c} da seleção`, `Remove ${c} from the selection`)}
                  onClick={() => mudar(juntar(atuais.filter((_, j) => j !== i)))}>×</button>
              </li>
            ))}
          </ul>
          {atuais.length > 1 && <button type="button" className="limpar" onClick={() => mudar('')}>{t('Limpar seleção', 'Clear selection')}</button>}
        </div>
      )}
      <details className="trabalho-codigo-manual">
        <summary>{t('Já sei o código (opcional)', 'I know the code (optional)')}</summary>
        <label htmlFor={`q-${id}`}>{rotuloCodigo}</label>
        <input id={`q-${id}`} value={valor} onChange={(e) => { mudar(e.target.value); mudarBusca(''); }} placeholder={placeholderCodigo}
          aria-invalid={invalido || undefined} aria-describedby={`q-${id}-ajuda`} />
        <p id={`q-${id}-ajuda`} className="nota-base">{ajudaCodigo}</p>
        {valor.trim() && <button type="button" className="limpar" onClick={() => { mudar(''); mudarBusca(''); }}>{t('Limpar códigos', 'Clear codes')}</button>}
      </details>
    </div>
  );
}

type CampoProps = { valor: string; mudar: (v: string) => void; busca: string; mudarBusca: (v: string) => void; entrada: RefObject<HTMLInputElement | null>; invalido?: boolean };

/** Profissão (CBO 2002): busca em todos os níveis, com o nível de cada código e a expansão de uma família. */
function CampoOcupacao({ valor, mudar, busca, mudarBusca, entrada, invalido }: CampoProps) {
  const achados = useApi<Linha[]>(busca.trim().length >= 2 ? 'trab_busca_ocupacao' : null, { texto: busca.trim() });
  const itens: Item[] = (achados.dados ?? []).map((r) => ({
    codigo: String(r.codigo), descricao: String(r.descricao), nivel: String(r.nivel), familia: r.nivel === 'cbo_familia',
    detalhe: `${nivel(r.nivel)}${r.familia ? ` · ${t('família', 'family')} ${String(r.codigo).slice(0, 4)} ${r.familia}` : ''}`,
  }));
  return (
    <CampoCodigos id="cbo" rotulo={t('Profissão (CBO)', 'Occupation (CBO)')} valor={valor} mudar={mudar} busca={busca} mudarBusca={mudarBusca} minimo={2}
      estado={achados} itens={itens} Nome={NomeOcupacao} comFamilia entrada={entrada} invalido={invalido}
      // um código dentro de outro já escolhido não acrescenta nada (o vínculo conta uma vez)
      combinar={(atuais, c) => (atuais.some((a) => c.startsWith(a)) ? atuais : [...atuais.filter((a) => !a.startsWith(c)), c])}
      exemploBusca={t('Digite o nome, ex.: enfermeiro, motorista', 'Type the name, e.g. nurse, driver')}
      dica={(
        <Dica rotulo={t('O que é a CBO', 'What CBO is')}>{t(
          'Classificação Brasileira de Ocupações: a ocupação exercida no vínculo, declarada pelo empregador. Não é formação acadêmica, registro profissional nem o universo de diplomados: um economista que trabalha como gerente aparece como gerente. Níveis: grande grupo (1 dígito), subgrupo principal (2), subgrupo (3), família (4) e ocupação (6). Códigos são prefixos: 2512 inclui todas as ocupações da família.',
          'Brazilian Classification of Occupations: the occupation performed in the job, as reported by the employer. It is not academic training, professional registration or the universe of graduates: an economist working as a manager appears as a manager. Levels: major group (1 digit), sub-major group (2), minor group (3), family (4) and occupation (6). Codes are prefixes: 2512 includes every occupation in the family.',
        )}</Dica>
      )}
      rotuloCodigo={t('Códigos da CBO 2002', 'CBO 2002 codes')} placeholderCodigo={t('ex.: 2512 (família), 251205', 'e.g. 2512 (family), 251205')}
      ajudaCodigo={t('Separe vários códigos por vírgula. Um código curto vale como prefixo: 2512 inclui todas as ocupações da família. Vazio: todas as profissões.', 'Separate several codes with commas. A short code works as a prefix: 2512 includes every occupation in the family. Empty: all occupations.')} />
  );
}

/** Atividade do estabelecimento (CNAE 2.0), com busca por nome no dicionário. */
function CampoAtividade({ valor, mudar, busca, mudarBusca, entrada, invalido }: CampoProps) {
  const achados = useApi<Linha[]>(busca.trim().length >= 3 ? 'trab_dicionario' : null, { variavel: 'cnae_classe', texto: busca.trim() });
  const itens: Item[] = (achados.dados ?? []).map((r) => ({ codigo: String(r.codigo), descricao: String(r.descricao), detalhe: t('classe', 'class') }));
  return (
    <CampoCodigos id="cnae" rotulo={t('Atividade do estabelecimento (CNAE)', 'Establishment activity (CNAE)')} valor={valor} mudar={mudar} busca={busca} mudarBusca={mudarBusca} minimo={3}
      estado={achados} itens={itens} Nome={NomeAtividade} entrada={entrada} invalido={invalido}
      combinar={(atuais, c) => (atuais.includes(c) ? atuais : [...atuais, c])}
      exemploBusca={t('Digite o ramo, ex.: hospital, restaurante', 'Type the line of business, e.g. hospital, restaurant')}
      dica={(
        <Dica rotulo={t('O que é a CNAE', 'What CNAE is')}>{t(
          'Atividade econômica principal do estabelecimento onde está o vínculo, não a ocupação da pessoa. Um contador de um hospital está na CNAE de saúde. A divisão 84 é a atividade Administração pública, defesa e seguridade social; ela não reúne todos os vínculos do setor público, que também está em educação, saúde e outras atividades (para isso, use o setor institucional, nos filtros avançados).',
          'Main economic activity of the establishment where the job is, not the person’s occupation. An accountant at a hospital is in the health CNAE. Division 84 is the activity Public administration, defence and social security; it does not cover every public-sector job, which also appears in education, health and other activities (for that, use the institutional sector in the advanced filters).',
        )}</Dica>
      )}
      rotuloCodigo={t('Códigos da CNAE 2.0', 'CNAE 2.0 codes')} placeholderCodigo={t('ex.: 4711, 56 (prefixos)', 'e.g. 4711, 56 (prefixes)')}
      ajudaCodigo={t('Separe vários códigos por vírgula. Um código curto vale como prefixo: 56 inclui toda a divisão. Vazio: todas as atividades.', 'Separate several codes with commas. A short code works as a prefix: 56 includes the whole division. Empty: all activities.')} />
  );
}

/** Caixas de seleção com os códigos de uma variável (nomes do dicionário). */
function ListaCodigos({ variavel, rotulo, valor, mudar, bloqueado }: { variavel: string; rotulo: string; valor: string; mudar: (v: string) => void; bloqueado?: boolean }) {
  const codigos = useApi<Linha[]>('trab_codigos', { variavel });
  const marcados = new Set(separar(valor));
  return (
    <fieldset className="lista-codigos" aria-describedby={bloqueado ? 'avancados-bloqueio' : undefined}>
      <legend>{rotulo}</legend>
      {(codigos.dados ?? []).map((c) => {
        const k = String(c.codigo);
        return (
          <label key={k}>
            <input type="checkbox" checked={marcados.has(k)} disabled={bloqueado && !marcados.has(k)} onChange={(e) => {
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

function Etiqueta({ rotulo, valor, remover }: { rotulo: string; valor: ReactNode; remover: () => void }) {
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

/** Etiqueta de profissão ou atividade: o nome de cada código ao lado do código. */
function EtiquetaCodigos({ rotulo, valor, Nome, remover }: { rotulo: string; valor: string; Nome: ComponentType<{ codigo: string }>; remover: () => void }) {
  return (
    <Etiqueta rotulo={rotulo} remover={remover}
      valor={separar(valor).map((c, i) => <span key={`${c}-${i}`}>{i > 0 && '; '}<code>{c}</code> <Nome codigo={c} /></span>)} />
  );
}

/** Etiquetas removíveis dos filtros já aplicados (os da URL). */
export function EtiquetasRecorte({ recorte, definir }: { recorte: Recorte; definir: (n: Record<string, string | null>) => void }) {
  const itens: ReactNode[] = [];
  if (recorte.cbo) itens.push(<EtiquetaCodigos key="cbo" rotulo={t('Profissão (CBO)', 'Occupation (CBO)')} valor={recorte.cbo} Nome={NomeOcupacao} remover={() => definir({ cbo: null })} />);
  if (recorte.cnae) itens.push(<EtiquetaCodigos key="cnae" rotulo={t('Atividade (CNAE)', 'Activity (CNAE)')} valor={recorte.cnae} Nome={NomeAtividade} remover={() => definir({ cnae: null })} />);
  if (recorte.situacao) itens.push(<Etiqueta key="sit" rotulo={t('Vínculos', 'Jobs')} valor={SITUACOES().find(([k]) => k === recorte.situacao)?.[1] ?? recorte.situacao} remover={() => definir({ sit: null })} />);
  if (recorte.sexo) itens.push(<Etiqueta key="sexo" rotulo={t('Sexo', 'Sex')} valor={recorte.sexo === '2' ? t('Feminino', 'Female') : t('Masculino', 'Male')} remover={() => definir({ sexo: null })} />);
  if (recorte.muns) itens.push(<Etiqueta key="muns" rotulo={t('Municípios', 'Municipalities')} valor={recorte.muns} remover={() => definir({ muns: null })} />);
  for (const f of FILTROS_AVANCADOS()) {
    if (recorte.listas[f.chave]) itens.push(<EtiquetaLista key={f.chave} chave={f.chave} variavel={f.variavel} rotulo={f.rotulo} valor={recorte.listas[f.chave]} remover={() => definir({ [f.chave]: null })} />);
  }
  if (!itens.length) return <p className="nota-base">{t('Nenhum filtro aplicado: todos os vínculos do território e do ano.', 'No filters applied: every job in the territory and year.')}</p>;
  return <div className="etiquetas" role="group" aria-label={t('Filtros aplicados', 'Applied filters')}>{itens}</div>;
}

/**
 * Formulário do recorte, em passos: 1) o que consultar (profissão e atividade pelo nome, vínculos, sexo, filtros
 * avançados); 2) como mostrar o resultado (`extra`, campos próprios da página); 3) o botão principal, com o resumo do
 * que vai ser consultado. O rascunho (o que está nos campos) só vale depois de aplicar, que grava na URL; as etiquetas
 * mostram o que já está aplicado. Busca digitada e não escolhida bloqueia a consulta (não consulta tudo por acidente).
 */
export function FormularioRecorte({ recorte, definir, micro, extra, rotuloAplicar, aplicarExtra, tituloExtra, resumoExtra, extraPendente, sincronizar }: {
  recorte: Recorte; definir: (n: Record<string, string | null>) => void; micro: boolean;
  extra?: ReactNode; rotuloAplicar?: string; aplicarExtra?: Record<string, string | null>;
  /** título do passo 2 (padrão: "Como mostrar o resultado") */
  tituloExtra?: string;
  /** o que os campos do passo 2 pedem, em texto curto, para o resumo */
  resumoExtra?: string;
  /** os campos do passo 2 mudaram e ainda não foram aplicados */
  extraPendente?: boolean;
  /** muda quando a URL muda por fora (Voltar, link, preset): campos e buscas não aplicadas voltam ao que está na URL */
  sincronizar?: string;
}) {
  const [rascunho, setRascunho] = useState<Rascunho>(() => doRecorte(recorte));
  const [buscas, setBuscas] = useState({ cbo: '', cnae: '' });
  const [bloqueio, setBloqueio] = useState<'cbo' | 'cnae' | null>(null);
  const [invalidos, setInvalidos] = useState<{ campo: 'cbo' | 'cnae'; codigos: string[] } | null>(null);
  const entradaCbo = useRef<HTMLInputElement | null>(null);
  const entradaCnae = useRef<HTMLInputElement | null>(null);
  const aplicado = doRecorte(recorte);
  // a URL mudou por fora (etiqueta removida, link aberto, voltar do navegador): os campos acompanham
  const chaveAplicada = JSON.stringify(aplicado);
  // (moeda, N mínimo e período não entram na chave: mudá-los não descarta o que está sendo editado)
  useEffect(() => {
    setRascunho(doRecorte(recorte));
    setBuscas({ cbo: '', cnae: '' });
    setBloqueio(null);
    setInvalidos(null);
  }, [chaveAplicada, sincronizar]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendente = !igual(rascunho, aplicado) || !!extraPendente;
  const avancados = Object.keys(rascunho.listas).length;
  const mudarBusca = (k: 'cbo' | 'cnae') => (v: string) => { setBuscas((b) => ({ ...b, [k]: v })); setBloqueio(null); };
  const mudarCodigos = (k: 'cbo' | 'cnae') => (v: string) => { setRascunho((r) => ({ ...r, [k]: v })); setInvalidos(null); setBloqueio(null); };
  const semMicro = !micro;
  const aplicar = () => {
    // texto de busca que não virou seleção: orienta em vez de consultar tudo
    const solta = (['cbo', 'cnae'] as const).find((k) => buscas[k].trim());
    if (solta) {
      setBloqueio(solta);
      (solta === 'cbo' ? entradaCbo : entradaCnae).current?.focus();
      return;
    }
    // erro de digitação (letras, símbolos) não pode virar "todas": o valor fica no campo para corrigir e nada é consultado
    for (const [campo, max] of [['cbo', 6], ['cnae', 7]] as const) {
      const ruins = codigosInvalidos(rascunho[campo], max);
      if (ruins.length) {
        setInvalidos({ campo, codigos: ruins });
        const el = document.getElementById(`q-${campo}`) as HTMLInputElement | null;
        const det = el?.closest('details');
        if (det) det.open = true;
        el?.focus();
        return;
      }
    }
    const novo: Record<string, string | null> = {
      cbo: rascunho.cbo.trim() || null, cnae: rascunho.cnae.trim() || null, sit: rascunho.sit || null, sexo: rascunho.sexo || null,
      ...Object.fromEntries(FILTROS_AVANCADOS().map((f) => [f.chave, rascunho.listas[f.chave] || null])),
      ...aplicarExtra,
    };
    definir(novo);
  };
  const lista = (k: string) => (v: string) => setRascunho({ ...rascunho, listas: Object.fromEntries(Object.entries({ ...rascunho.listas, [k]: v }).filter(([, x]) => x)) });
  const qtd = (v: string) => separar(v).length;
  const resumo = [
    `${t('Profissão', 'Occupation')}: ${rascunho.cbo.trim() ? t(`${qtd(rascunho.cbo)} escolhida(s)`, `${qtd(rascunho.cbo)} chosen`) : t('todas', 'all')}`,
    `${t('Atividade', 'Activity')}: ${rascunho.cnae.trim() ? t(`${qtd(rascunho.cnae)} escolhida(s)`, `${qtd(rascunho.cnae)} chosen`) : t('todas', 'all')}`,
    SITUACOES().find(([k]) => k === rascunho.sit)?.[1] ?? '',
    rascunho.sexo ? (rascunho.sexo === '2' ? t('mulheres', 'women') : t('homens', 'men')) : t('homens e mulheres', 'men and women'),
    ...(avancados ? [t(`${avancados} filtro(s) avançado(s)`, `${avancados} advanced filter(s)`)] : []),
    ...(resumoExtra ? [resumoExtra] : []),
  ].join(' · ');
  const nomeBloqueio = bloqueio === 'cbo' ? t('Profissão', 'Occupation') : t('Atividade', 'Activity');
  return (
    <section className="cartao formulario-recorte trabalho-form" aria-label={t('Montar a consulta', 'Build the query')}>
      <div className="trabalho-passo" role="group" aria-labelledby="passo-1">
        <h3 id="passo-1"><span className="trabalho-passo-n" aria-hidden="true">1</span> {t('O que consultar', 'What to look at')} <small>{t('(tudo é opcional: sem escolha, conta todos os vínculos)', '(everything is optional: with no choice, every job is counted)')}</small></h3>
        <div className="filtros">
          <CampoOcupacao valor={rascunho.cbo} mudar={mudarCodigos('cbo')} busca={buscas.cbo} mudarBusca={mudarBusca('cbo')} entrada={entradaCbo} invalido={invalidos?.campo === 'cbo'} />
          <CampoAtividade valor={rascunho.cnae} mudar={mudarCodigos('cnae')} busca={buscas.cnae} mudarBusca={mudarBusca('cnae')} entrada={entradaCnae} invalido={invalidos?.campo === 'cnae'} />
          <div className="campo">
            <label htmlFor="q-sit">{t('Empregos/contratos considerados', 'Jobs/contracts considered')}</label>
            <select id="q-sit" value={rascunho.sit} aria-describedby="q-sit-ajuda" onChange={(e) => setRascunho({ ...rascunho, sit: e.target.value })}>
              {SITUACOES().map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
            <small id="q-sit-ajuda" className="trabalho-dica-campo">{AJUDA_SITUACAO()[rascunho.sit] ?? ''}</small>
          </div>
          <div className="campo">
            <label htmlFor="q-sexo">{t('Sexo', 'Sex')}</label>
            <select id="q-sexo" value={rascunho.sexo} onChange={(e) => setRascunho({ ...rascunho, sexo: e.target.value })}>
              <option value="">{t('Ambos', 'Both')}</option>
              <option value="1">{t('Masculino', 'Male')}</option>
              <option value="2">{t('Feminino', 'Female')}</option>
            </select>
          </div>
        </div>
        <details className="avancados">
          <summary>{t('Filtros avançados', 'Advanced filters')}{avancados ? ` (${avancados})` : ''}{!micro ? ` · ${t('só com microdados: escolha uma UF ou um município', 'microdata only: choose a state or municipality')}` : ''}</summary>
          {semMicro && <p id="avancados-bloqueio" className="nota-base">{t('Estes filtros precisam dos microdados de uma UF ou município e ficam desativados aqui (os já marcados podem ser desmarcados). ', 'These filters need the microdata of a state or municipality and are disabled here (those already checked can be unchecked). ')}<BotaoEscolherLocal /></p>}
          <div className="grade-filtros">
            {FILTROS_AVANCADOS().map((f) => (
              <ListaCodigos key={f.chave} variavel={f.variavel} rotulo={f.rotulo} valor={rascunho.listas[f.chave] ?? ''} mudar={lista(f.chave)} bloqueado={semMicro} />
            ))}
          </div>
          <p className="nota-base">{t(
            'Dentro de um filtro, as opções marcadas se somam (união); filtros diferentes se combinam (interseção). Códigos de ocupação ou atividade contidos em outro da lista não contam duas vezes.',
            'Within a filter, the checked options add up (union); different filters combine (intersection). Occupation or activity codes contained in another code in the list are not counted twice.',
          )}</p>
        </details>
        {semMicro && avancados > 0 && (
          <p className="aviso" role="status">{t(
            'Há filtros avançados marcados ou vindos do endereço, mas eles precisam dos microdados e a consulta falharia aqui. Escolha uma UF ou município ou remova-os (também pelas etiquetas ×).',
            'Advanced filters are checked or came from the address, but they need the microdata and the query would fail here. Choose a state or municipality or remove them (also with the × tags).',
          )} <BotaoEscolherLocal />{' '}
            <button type="button" className="limpar" onClick={() => setRascunho((r) => ({ ...r, listas: {} }))}>{t('Remover filtros avançados do rascunho', 'Remove advanced filters from the draft')}</button></p>
        )}
      </div>
      {extra && (
        <div className="trabalho-passo" role="group" aria-labelledby="passo-2">
          <h3 id="passo-2"><span className="trabalho-passo-n" aria-hidden="true">2</span> {tituloExtra ?? t('Como mostrar o resultado', 'How to show the result')}</h3>
          <div className="filtros">{extra}</div>
        </div>
      )}
      <div className="trabalho-passo trabalho-acao" role="group" aria-labelledby="passo-3">
        <h3 id="passo-3"><span className="trabalho-passo-n" aria-hidden="true">{extra ? 3 : 2}</span> {t('Consultar', 'Run')}</h3>
        <p className="trabalho-resumo"><strong>{t('Vai consultar', 'Will query')}:</strong> {resumo}</p>
        <div className="acoes-cartao">
          <button type="button" className={`botao${pendente ? ' trabalho-pendente-botao' : ''}`} onClick={aplicar}>{rotuloAplicar ?? t('Consultar', 'Run query')}</button>
          {pendente && <span className="trabalho-pendente" role="status">{t('Alterações ainda não aplicadas: os resultados abaixo são os da consulta anterior.', 'Changes not applied yet: the results below are from the previous query.')}</span>}
        </div>
        {invalidos && (
          <p className="aviso" role="alert">{t(
            `Código inválido em ${invalidos.campo === 'cbo' ? 'Profissão (CBO)' : 'Atividade (CNAE)'}: ${invalidos.codigos.slice(0, 4).join(', ')}. Use só números (CBO de 1 a 6 dígitos, CNAE de 1 a 7), separados por vírgula, ponto e vírgula ou espaço. Corrija em “Já sei o código”; nada foi consultado.`,
            `Invalid code in ${invalidos.campo === 'cbo' ? 'Occupation (CBO)' : 'Activity (CNAE)'}: ${invalidos.codigos.slice(0, 4).join(', ')}. Use digits only (CBO 1 to 6 digits, CNAE 1 to 7), separated by commas, semicolons or spaces. Fix it under “I know the code”; nothing was queried.`,
          )}</p>
        )}
        {bloqueio && (
          <p className="aviso" role="alert">{t(
            `Você digitou “${buscas[bloqueio].trim()}” em ${nomeBloqueio}, mas não escolheu um resultado. Escolha um da lista (ou use Enter) ou clique em “Limpar busca”; depois consulte de novo. Assim a consulta não conta tudo sem querer.`,
            `You typed “${buscas[bloqueio].trim()}” in ${nomeBloqueio} but did not choose a result. Pick one from the list (or press Enter) or click “Clear search”, then run again. This way the query does not count everything by accident.`,
          )}</p>
        )}
      </div>
      <EtiquetasRecorte recorte={recorte} definir={definir} />
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
