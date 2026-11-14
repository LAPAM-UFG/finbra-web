import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import '../downloads.css';
import {
  COD_BRASILIA, COD_NORONHA, faixaAnos, filtrarArquivos, filtrarDicionario, filtroVazio, formatoDisponivel, formatosBase, indexarDicionario, POR_PAGINA, tamanho, urlArquivo, validarDicionario, validarManifesto,
  type ArquivoDl, type AreaDl, type EntradaDic, type Filtro, type Formato, type FormatoBase, type IndiceDic, type ManifestoDl,
} from '../downloads';
import { Estado } from '../components/Kpi';
import { numero } from '../format';
import { idioma, local, t, useIdioma } from '../idioma';
import { nomeDaUf } from '../ia_territorio';
import { BASE_DADOS } from '../manifesto';

const URL_MANIFESTO = `${BASE_DADOS}gold/downloads/manifesto.json`;

/** Busca um JSON só quando `ativo`; "recarregar" repete (Tentar de novo). Nada aqui usa o motor de consultas. */
function useJson<T>(url: string, ativo: boolean, ler: (bruto: unknown) => T) {
  const [estado, setEstado] = useState<{ dados?: T; erro?: string }>({});
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    const ctl = new AbortController();
    setEstado({});
    fetch(url, { signal: ctl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((bruto) => setEstado({ dados: ler(bruto) }))
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setEstado({ erro: e instanceof Error ? e.message : String(e) });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ativo, tentativa]);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return { ...estado, carregando: ativo && !estado.dados && !estado.erro, recarregar };
}

const pick = (pt: string, en: string) => (idioma() === 'en' && en ? en : pt);

const FORMATO: Record<Formato, { nome: () => string; dica: () => string }> = {
  dta: { nome: () => 'Stata (.dta)', dica: () => t('Abre direto no Stata 14 ou mais recente, com rótulos', 'Opens directly in Stata 14 or later, with labels') },
  'csv.zip': { nome: () => 'CSV (.zip)', dica: () => t('Extraia para importar. No Excel, prefira um recorte por UF ou tema.', 'Extract to import. For Excel, prefer a state or topic subset.') },
  parquet: { nome: () => 'Parquet', dica: () => t('Formato compacto para R e Python', 'Compact format for R and Python') },
  xlsx: { nome: () => 'Excel (.xlsx)', dica: () => t('Abre direto no Excel', 'Opens directly in Excel') },
  zip: { nome: () => 'ZIP', dica: () => t('Pacote compactado', 'Compressed package') },
  json: { nome: () => 'JSON', dica: () => t('Para programas e buscas', 'For programs and search') },
  txt: { nome: () => t('Texto', 'Text'), dica: () => t('Documento de texto', 'Text document') },
  do: { nome: () => 'Stata (.do)', dica: () => t('Exemplo de comandos para usar após abrir o .dta', 'Example commands to use after opening the .dta') },
};

const rotuloUf = (uf: string) => (uf === 'DF' ? `DF · ${t('Brasília', 'Brasília')} (${COD_BRASILIA})` : `${nomeDaUf(uf)} (${uf})`);

function Ico({ nome }: { nome: 'baixar' | 'busca' }) {
  return (
    <svg className="dl-ico" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {nome === 'baixar' ? <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 16h12" /> : <path d="M9 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12Zm7 2-3.2-3.2" />}
    </svg>
  );
}

function Arquivo({ a, base, destaque = false }: { a: ArquivoDl; base: string; destaque?: boolean }) {
  const href = urlArquivo(a.caminho, base);
  const f = FORMATO[a.formato];
  const nome = pick(a.nome, a.nome_en);
  const descricao = pick(a.descricao, a.descricao_en);
  const anos = faixaAnos(a);
  const tam = tamanho(a.bytes, local());
  return (
    <li className={`dl-arq${destaque ? ' dl-arq-destaque' : ''}`}>
      <div className="dl-arq-texto">
        <h4>{nome}</h4>
        {descricao && descricao !== nome && <p className="dl-arq-desc">{descricao}</p>}
        <p className="dl-arq-meta">
          <span className="dl-fmt" title={f.dica()}>{f.nome()}</span>
          {a.linhas !== null && <span>{numero(a.linhas)} {t('linhas', 'rows')}</span>}
          {a.variaveis !== null && <span>{numero(a.variaveis)} {t('variáveis', 'variables')}</span>}
          {anos && <span>{anos}</span>}
          {a.uf && <span>{a.uf}</span>}
          {typeof a.bytes_extraido === 'number' && <span>{t(`${tamanho(a.bytes_extraido, local())} após extrair`, `${tamanho(a.bytes_extraido, local())} extracted`)}</span>}
        </p>
      </div>
      {href && (
        <a className="botao dl-baixar" href={href} download aria-label={`${t('Baixar', 'Download')} ${nome}, ${f.nome()}, ${tam}`}>
          <Ico nome="baixar" />
          <span>{t('Baixar', 'Download')}</span>
          <small>{tam}</small>
        </a>
      )}
    </li>
  );
}

function Lista({ arquivos, base, limite = 12, vazio }: { arquivos: ArquivoDl[]; base: string; limite?: number; vazio?: string }) {
  const [tudo, setTudo] = useState(false);
  const mostrar = tudo ? arquivos : arquivos.slice(0, limite);
  if (!arquivos.length) return vazio ? <p className="dl-vazio">{vazio}</p> : null;
  return (
    <>
      <ul className="dl-lista">{mostrar.map((a) => <Arquivo key={a.id} a={a} base={base} />)}</ul>
      {arquivos.length > limite && (
        <button type="button" className="botao-leve" onClick={() => setTudo(!tudo)}>
          {tudo ? t('Mostrar menos', 'Show fewer') : t(`Mostrar todos os ${arquivos.length}`, `Show all ${arquivos.length}`)}
        </button>
      )}
    </>
  );
}

function Secao({ id, titulo, intro, children }: { id: string; titulo: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="dl-secao" id={id} aria-labelledby={`${id}-t`}>
      <h3 id={`${id}-t`}>{titulo}</h3>
      {intro && <p className="dl-intro">{intro}</p>}
      {children}
    </section>
  );
}

function BaseIntegrada({ arquivos, base }: { arquivos: ArquivoDl[]; base: string }) {
  const [uf, setUf] = useState('');
  const idUf = useId();
  const nacionais = arquivos.filter((a) => !a.uf);
  const porUf = arquivos.filter((a) => a.uf);
  const ufs = [...new Set(porUf.map((a) => a.uf!))].sort((x, y) => x.localeCompare(y));
  return (
    <>
      <p className="dl-aviso">{t('Uma linha por município e ano. Você pode baixar o Brasil inteiro ou escolher uma UF. Os formatos têm as mesmas variáveis.', 'One row per municipality and year. Download all of Brazil or choose a state. Formats contain the same variables.')}</p>
      {nacionais.length ? (
        <ul className="dl-lista dl-grade">{nacionais.map((a) => <Arquivo key={a.id} a={a} base={base} destaque />)}</ul>
      ) : (
        <p className="dl-vazio">{t('A base integrada nacional não está disponível agora.', 'The national integrated base is not available right now.')}</p>
      )}
      {ufs.length > 0 && (
        <div className="dl-uf">
          <div className="dl-campo">
            <label htmlFor={idUf}>{t('Prefere só um estado?', 'Prefer a single state?')}</label>
            <select id={idUf} value={uf} onChange={(e) => setUf(e.target.value)}>
              <option value="">{t('Escolha a UF…', 'Choose a state…')}</option>
              {ufs.map((u) => <option key={u} value={u}>{rotuloUf(u)}</option>)}
            </select>
          </div>
          {uf && <ul className="dl-lista">{porUf.filter((a) => a.uf === uf).map((a) => <Arquivo key={a.id} a={a} base={base} />)}</ul>}
        </div>
      )}
    </>
  );
}

function Dicionario({ m, base }: { m: ManifestoDl; base: string }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState('');
  const [area, setArea] = useState('');
  const [pagina, setPagina] = useState(0);
  const idBusca = useId();
  const idArea = useId();
  const url = urlArquivo(m.dicionario.caminho, base) ?? '';
  const dic = useJson<IndiceDic>(url, aberto && url !== '', (b) => indexarDicionario(validarDicionario(b)));
  const adiado = useDeferredValue(busca);
  const nomeArea = useCallback((id: string) => { if (id === 'identificacao') return t('Identificação', 'Identifiers'); const a = m.areas.find((x) => x.id === id); return a ? pick(a.nome, a.nome_en) : id; }, [m.areas]);
  const areas = useMemo(() => [...new Set((dic.dados?.entradas ?? []).map((e) => e.area).filter(Boolean))].sort((x, y) => nomeArea(x).localeCompare(nomeArea(y), local())), [dic.dados, nomeArea]);
  const achadas = useMemo(() => (dic.dados ? filtrarDicionario(dic.dados, adiado, area) : []), [dic.dados, adiado, area]);
  const paginas = Math.max(1, Math.ceil(achadas.length / POR_PAGINA));
  const atual = Math.min(pagina, paginas - 1);
  const ver = achadas.slice(atual * POR_PAGINA, (atual + 1) * POR_PAGINA);

  if (!aberto) {
    return (
      <button type="button" className="botao dl-abrir" onClick={() => setAberto(true)} disabled={!url}>
        <Ico nome="busca" /> {t('Pesquisar variáveis', 'Search variables')} <small>({tamanho(m.dicionario.bytes, local())})</small>
      </button>
    );
  }
  return (
    <div className="dl-dic">
      {dic.erro && <Estado erro={dic.erro} mensagem={t('Não foi possível carregar o dicionário.', 'Could not load the dictionary.')} tentarNovamente={dic.recarregar} />}
      {dic.carregando && <p className="carregando" role="status">{t('Carregando o dicionário…', 'Loading the dictionary…')}</p>}
      {dic.dados && (
        <>
          <div className="dl-filtros">
            <div className="dl-campo dl-campo-larga">
              <label htmlFor={idBusca}>{t('Buscar variável', 'Search variable')}</label>
              <input id={idBusca} type="search" value={busca} placeholder={t('Nome, código ou descrição (ex.: saneamento)', 'Name, code or description (e.g. saneamento)')}
                onChange={(e) => { setBusca(e.target.value); setPagina(0); }} />
            </div>
            <div className="dl-campo">
              <label htmlFor={idArea}>{t('Tema', 'Theme')}</label>
              <select id={idArea} value={area} onChange={(e) => { setArea(e.target.value); setPagina(0); }}>
                <option value="">{t('Todos', 'All')}</option>
                {areas.map((a) => <option key={a} value={a}>{nomeArea(a)}</option>)}
              </select>
            </div>
          </div>
          <p className="dl-contagem" role="status" aria-live="polite">
            {t(`${numero(achadas.length)} de ${numero(dic.dados.entradas.length)} variáveis`, `${numero(achadas.length)} of ${numero(dic.dados.entradas.length)} variables`)}
          </p>
          {ver.length === 0 ? <p className="dl-vazio">{t('Nenhuma variável encontrada. Tente outra palavra ou limpe o tema.', 'No variables found. Try another word or clear the theme.')}</p> : (
            <ul className="dl-vars">{ver.map((e, i) => <Variavel key={`${atual}-${i}`} e={e} nomeArea={nomeArea} />)}</ul>
          )}
          {paginas > 1 && (
            <nav className="dl-pag" aria-label={t('Páginas do dicionário', 'Dictionary pages')}>
              <button type="button" className="botao-leve" disabled={atual === 0} onClick={() => setPagina(atual - 1)}>{t('Anterior', 'Previous')}</button>
              <span>{t(`Página ${atual + 1} de ${paginas}`, `Page ${atual + 1} of ${paginas}`)}</span>
              <button type="button" className="botao-leve" disabled={atual >= paginas - 1} onClick={() => setPagina(atual + 1)}>{t('Próxima', 'Next')}</button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

function Variavel({ e, nomeArea }: { e: EntradaDic; nomeArea: (id: string) => string }) {
  const anos = faixaAnos(e);
  const linhas: [string, string][] = ([
    [t('Descrição', 'Description'), e.descricao], [t('Fonte', 'Source'), e.fonte], [t('Tipo', 'Type'), e.tipo], [t('Regra para o ano', 'Annual rule'), e.regra_anual],
    [t('Tabela', 'Table'), e.tabela], [t('Observação', 'Note'), e.observacao],
    [t('Nome na fonte ampla', 'Name in the source base'), e.variavel_original && e.variavel_original !== e.variavel ? e.variavel_original : ''],
    [t('Códigos no Stata', 'Stata value labels'), e.stata_rotulos ? Object.entries(e.stata_rotulos).map(([k,v]) => `${k} = ${v}`).join('; ') : ''],
  ] as [string, string][]).filter(([, v]) => v);
  return (
    <li className="dl-var">
      <details>
        <summary>
          <span className="dl-var-nome">{e.nome || e.variavel}</span>
          <code>{e.variavel}</code>
          <span className="dl-var-meta">{[e.area && nomeArea(e.area), e.unidade, anos].filter(Boolean).join(' · ')}</span>
        </summary>
        {linhas.length > 0 && (
          <dl>{linhas.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
        )}
      </details>
    </li>
  );
}

function Guia({ m, metodologia, base }: { m: ManifestoDl; metodologia: ArquivoDl[]; base: number }) {
  const itens: [string, ReactNode][] = [
    [t('Abrir no Excel', 'Open in Excel'), t(
      'Extraia o .zip e use Dados › De texto/CSV. Os CSV estão em UTF-8 com BOM, separador ponto e vírgula e decimal com vírgula.',
      'Extract the .zip and use Data › From Text/CSV. CSV files are UTF-8 with BOM, semicolon-separated, with decimal commas.')],
    ...(m.arquivos.some((a) => a.formato === 'dta') ? [[t('Abrir no Stata', 'Open in Stata'), m.stata?.painel_declarado ? t(
      'Abra o .dta no Stata 14 ou mais recente. Ele traz rótulos das variáveis e categorias; cod_ibge e ano já declaram o painel municipal. Há também um exemplo de comandos .do.',
      'Open the .dta in Stata 14 or later. It includes variable and value labels; cod_ibge and ano already declare the municipal panel. A .do command example is also available.') : t(
      'Abra o .dta no Stata 14 ou mais recente e use xtset cod_ibge ano para declarar o painel. Há também um exemplo de comandos .do.',
      'Open the .dta in Stata 14 or later and use xtset cod_ibge ano to declare the panel. A .do command example is also available.') ] as [string, ReactNode]] : []),
    [t('Parquet: R e Python', 'Parquet: R and Python'), t(
      'Parquet é um formato compacto para programação e estatística. Os nomes e os valores correspondem aos da base para Stata e CSV.',
      'Parquet is a compact format for programming and statistics. Names and values correspond to the Stata and CSV base.')],
    [t('Identificadores', 'Identifiers'), t(
      'O município é identificado pelo código IBGE de 7 dígitos. Use-o, e não o nome, para cruzar com outras bases.',
      'Municipalities are identified by the 7-digit IBGE code. Use it, not the name, to join other datasets.')],
    [t('Células vazias', 'Empty cells'), t(
      'Vazio significa que não há dado naquele município e ano (por exemplo, pesquisas que não ocorreram naquele ano). Nunca é zero.',
      'Empty means there is no data for that municipality and year (for example, surveys not run that year). It is never zero.')],
    [t('Valores em reais', 'Values in reais'), t(
      `Consulte a unidade no dicionário: valores nominais ou reais (R$ de dez/${base}, corrigidos pelo IPCA). Colunas de condição e de mês acompanham os dados.`,
      `Check the dictionary unit: nominal values or real values (Dec/${base} R$, IPCA-adjusted). Data status and month columns accompany the values.`)],
    [t('Dados mensais no ano', 'Monthly data by year'), t(
      'Na assistência social, a coluna sem sufixo guarda o valor do último mês disponível, com mês e condição. _soma_ano acumula os pagamentos e _meses indica quantos meses entraram; menos de 12 é parcial. Pesquisas aparecem só no ano da edição, sem interpolação. Para as demais fontes, consulte a regra anual do dicionário.',
      'For social assistance, the column without a suffix keeps the last available monthly value, with month and status. _soma_ano sums payments and _meses counts observed months; fewer than 12 is partial. Surveys appear only in their edition year, never interpolated. For other sources, check the dictionary annual rule.')],
    [t('Brasília e Noronha', 'Brasília and Noronha'), t(
      `Em DF, a linha é Brasília (${COD_BRASILIA}), que reúne as funções estadual e municipal; não é um estado repetido como município. Fernando de Noronha (${COD_NORONHA}) é distrito de Pernambuco e vem identificado à parte.`,
      `For DF, the row is Brasília (${COD_BRASILIA}), which combines state and municipal functions; it is not a state repeated as a municipality. Fernando de Noronha (${COD_NORONHA}) is a district of Pernambuco and is identified separately.`)],
    [t('Só municípios', 'Municipalities only'), t(
      'Estes arquivos são municipais. A ESTADIC, pesquisa dos estados, não está incluída.',
      'These files are municipal. ESTADIC, the survey of states, is not included.')],
  ];
  return (
    <>
      <ul className="dl-guia">{itens.map(([k, v]) => <li key={k}><h4>{k}</h4><p>{v}</p></li>)}</ul>
      {m.notas.length > 0 && (
        <div className="dl-notas">
          <h4>{t('Notas desta edição', 'Notes on this edition')}</h4>
          <ul>{m.notas.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
      {metodologia.length > 0 && (
        <ul className="dl-lista">{metodologia.map((a) => <Arquivo key={a.id} a={a} base={BASE_DADOS} />)}</ul>
      )}
    </>
  );
}

function Integridade({ m }: { m: ManifestoDl }) {
  const [aberto, setAberto] = useState(false);
  return (
    <details className="dl-integridade" onToggle={(e) => setAberto((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{t('Conferir a integridade dos arquivos (SHA-256)', 'Check file integrity (SHA-256)')}</summary>
      {aberto && (
        <ul>
          {m.arquivos.map((a) => <li key={a.id}><span>{pick(a.nome, a.nome_en)} · {FORMATO[a.formato].nome()}{a.uf ? ` · ${a.uf}` : ''}</span><code>{a.sha256}</code></li>)}
          <li><span>{t('Dicionário (JSON)', 'Dictionary (JSON)')}</span><code>{m.dicionario.sha256}</code></li>
        </ul>
      )}
    </details>
  );
}

const rolar = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });

function Conteudo({ m, descartados }: { m: ManifestoDl; descartados: number }) {
  const en = idioma() === 'en';
  const [filtro, setFiltro] = useState<Filtro>(filtroVazio);
  const [formato, setFormato] = useState<FormatoBase>('dta');
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  const adiado = useDeferredValue(filtro);
  const idFormato = useId();
  const idTexto = useId();
  const idTema = useId();
  const idUf = useId();
  const por = (tipo: ArquivoDl['tipo']) => m.arquivos.filter((a) => a.tipo === tipo);
  const painel = por('painel');
  const opcoesFormato = formatosBase(painel);
  const formatoAtual = formatoDisponivel(formato, painel);
  const temas = por('area').filter((a) => a.formato === formatoAtual);
  const detalhes = por('detalhado');
  const pacotes = por('pacote');
  const dicionarios = por('dicionario').filter((a) => a.escopo !== 'detalhado');
  const dicionariosDetalhados = por('dicionario').filter((a) => a.escopo === 'detalhado');
  const metodologia = por('metodologia');
  const explorar = [...temas, ...detalhes];
  const areasUsadas = m.areas.filter((a) => explorar.some((f) => f.area === a.id));
  const ufsUsadas = [...new Set(explorar.map((f) => f.uf).filter((u): u is string => !!u))].sort();
  const filtrado = adiado.texto || adiado.area || adiado.uf;
  const temasF = filtrarArquivos(temas, adiado, en);
  const detalhesF = filtrarArquivos(detalhes, adiado, en);
  const r = m.resumo;
  const quando = (() => { const d = new Date(m.gerado_em); return Number.isNaN(d.getTime()) ? m.gerado_em : d.toLocaleDateString(local(), { day: 'numeric', month: 'long', year: 'numeric' }); })();
  useEffect(() => { if (/munic|anexo|dca/i.test(adiado.texto)) setDetalhesAbertos(true); }, [adiado.texto]);

  // detalhados agrupados pelo tema, na ordem do manifesto
  const grupos: { area: AreaDl | null; itens: ArquivoDl[] }[] = [];
  for (const f of detalhesF) {
    const area = m.areas.find((x) => x.id === f.area) ?? null;
    const g = grupos.find((x) => x.area === area);
    if (g) g.itens.push(f);
    else grupos.push({ area, itens: [f] });
  }
  const secoes: [string, string, boolean][] = [
    ['dl-base', t('Base principal', 'Main base'), painel.length > 0],
    ['dl-temas', t('Por tema', 'By theme'), temas.length > 0], ['dl-dicionario', t('Dicionário', 'Dictionary'), true], ['dl-guia', t('Como usar', 'How to use'), true],
    ['dl-detalhes', t('Dados detalhados', 'Detailed data'), detalhes.length > 0],
  ];

  return (
    <>
      <ul className="dl-resumo" aria-label={t('Resumo da base', 'Base summary')}>
        <li><strong>{numero(r.municipios)}</strong><span>{t('municípios e unidades especiais', 'municipalities and special territories')}</span></li>
        <li><strong>{r.ano_de}–{r.ano_ate}</strong><span>{t('período total; varia por fonte', 'total period; varies by source')}</span></li>
        <li><strong>{numero(r.variaveis)}</strong><span>{t('variáveis na base integrada', 'variables in the integrated base')}</span></li>
        <li><strong>{numero(r.linhas)}</strong><span>{t('linhas (município × ano)', 'rows (municipality × year)')}</span></li>
      </ul>
      <nav className="dl-ancoras" aria-label={t('Nesta página', 'On this page')}>
        {secoes.filter(([, , ok]) => ok).map(([id, nome]) => <button key={id} type="button" onClick={() => { if (id === 'dl-detalhes') { setDetalhesAbertos(true); requestAnimationFrame(() => rolar(id)); } else rolar(id); }}>{nome}</button>)}
      </nav>
      {descartados > 0 && (
        <p className="dl-aviso" role="status">
          {t(`${descartados} arquivo(s) da lista falharam na verificação e não aparecem aqui.`, `${descartados} file(s) in the list failed verification and are not shown.`)}
        </p>
      )}

      <Secao id="dl-base" titulo={m.edicao === 'enxuta_2013' ? t('Base enxuta', 'Compact base') : t('Base integrada', 'Integrated base')}
        intro={t('Uma linha por município e ano, com indicadores selecionados dos seis temas. Os cálculos estão prontos e os vazios foram preservados.', 'One row per municipality and year, with selected indicators from the six themes. Calculations are ready and missing values are preserved.')}>
        {opcoesFormato.length > 0 && <fieldset className="dl-formatos"><legend>{t('Escolha o formato', 'Choose a format')}</legend>
          {opcoesFormato.map((f) => <label key={f}><input type="radio" name={idFormato} value={f} checked={f === formatoAtual} onChange={() => setFormato(f)} />{FORMATO[f].nome()}</label>)}
        </fieldset>}
        {formatoAtual === 'dta' && m.stata?.painel_declarado && <p className="dl-intro">{t('Abre diretamente no Stata, com rótulos e o painel município × ano já declarado.', 'Opens directly in Stata, with labels and the municipality × year panel already declared.')}</p>}
        <BaseIntegrada arquivos={painel.filter((a) => a.formato === formatoAtual)} base={BASE_DADOS} />
        {pacotes.length > 0 && (
          <>
            <h4 className="dl-sub">{t('Pacote da base principal e dicionário', 'Main base and dictionary package')}</h4>
            <ul className="dl-lista">{pacotes.map((a) => <Arquivo key={a.id} a={a} base={BASE_DADOS} />)}</ul>
          </>
        )}
      </Secao>

      {explorar.length > 0 && (
        <div className="dl-filtros" role="search" aria-label={t('Procurar arquivos', 'Find files')}>
          <div className="dl-campo dl-campo-larga">
            <label htmlFor={idTexto}>{t('Procurar arquivos', 'Find files')}</label>
            <input id={idTexto} type="search" value={filtro.texto} placeholder={t('Ex.: saúde, MUNIC 2021, anexo I-C', 'E.g. health, MUNIC 2021, annex I-C')}
              onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} />
          </div>
          {areasUsadas.length > 1 && (
            <div className="dl-campo">
              <label htmlFor={idTema}>{t('Tema', 'Theme')}</label>
              <select id={idTema} value={filtro.area} onChange={(e) => setFiltro({ ...filtro, area: e.target.value })}>
                <option value="">{t('Todos', 'All')}</option>
                {areasUsadas.map((a) => <option key={a.id} value={a.id}>{pick(a.nome, a.nome_en)}</option>)}
              </select>
            </div>
          )}
          {ufsUsadas.length > 0 && (
            <div className="dl-campo">
              <label htmlFor={idUf}>UF</label>
              <select id={idUf} value={filtro.uf} onChange={(e) => setFiltro({ ...filtro, uf: e.target.value })}>
                <option value="">{t('Todas', 'All')}</option>
                {ufsUsadas.map((u) => <option key={u} value={u}>{rotuloUf(u)}</option>)}
              </select>
            </div>
          )}
          {filtrado && <button type="button" className="botao-leve" onClick={() => setFiltro(filtroVazio)}>{t('Limpar', 'Clear')}</button>}
        </div>
      )}

      {temas.length > 0 && (
        <Secao id="dl-temas" titulo={t('Por tema', 'By theme')}
          intro={t('A mesma chave (município × ano), mas só com as variáveis de um assunto. Cada arquivo mostra os anos e o número de variáveis que de fato contém.', 'The same key (municipality × year), with only the variables of one subject. Each file shows the years and the number of variables it actually contains.')}>
          <Lista arquivos={temasF} base={BASE_DADOS} limite={filtrado ? 50 : 8} vazio={t('Nenhum arquivo com esse filtro.', 'No files match this filter.')} />
        </Secao>
      )}

      <Secao id="dl-dicionario" titulo={t('Dicionário de variáveis', 'Variable dictionary')}
        intro={<>{t('Nome, descrição, fonte, unidade, anos disponíveis e regra de agregação anual de cada variável.', 'Name, description, source, unit, available years and annual aggregation rule for each variable.')}{' '}
          {t('As descrições das fontes estão em português.', 'Source descriptions are in Portuguese.')}</>}>
        {dicionarios.length > 0 && <ul className="dl-lista">{dicionarios.map((a) => <Arquivo key={a.id} a={a} base={BASE_DADOS} />)}</ul>}
        <Dicionario m={m} base={BASE_DADOS} />
      </Secao>

      {detalhes.length > 0 && <details id="dl-detalhes" className="dl-avancado" open={detalhesAbertos} onToggle={(e) => setDetalhesAbertos(e.currentTarget.open)}>
        <summary>{t('Dados detalhados (opcional)', 'Detailed data (optional)')}</summary>
        <p className="dl-intro">{t('Questionários completos da MUNIC e contas anuais DCA, em CSV e Parquet. Também estão limitados aos anos desde 2013. São arquivos separados, com mais variáveis que a base principal.', 'Full MUNIC questionnaires and DCA annual accounts, in CSV and Parquet. Also restricted to years from 2013 onwards. These are separate files, with more variables than the main base.')}</p>
        {grupos.length === 0 ? <p className="dl-vazio">{t('Nenhum arquivo com esse filtro.', 'No files match this filter.')}</p> : grupos.map((g) => (
          <div key={g.area?.id ?? 'outros'} className="dl-grupo"><h4 className="dl-sub">{g.area ? pick(g.area.nome, g.area.nome_en) : t('Outros', 'Other')}</h4>
            <Lista arquivos={g.itens} base={BASE_DADOS} limite={filtrado ? 50 : 6} />
          </div>
        ))}
        {dicionariosDetalhados.length > 0 && <><h4 className="dl-sub">{t('Dicionário dos complementos', 'Supplement dictionary')}</h4><Lista arquivos={dicionariosDetalhados} base={BASE_DADOS} /></>}
      </details>}

      <Secao id="dl-guia" titulo={t('Como usar os arquivos', 'How to use the files')}>
        <Guia m={m} metodologia={metodologia} base={m.base_ipca} />
      </Secao>

      <p className="dl-rodape">{t(`Arquivos gerados em ${quando}. Eles são pré-calculados: baixar não executa nenhuma consulta.`, `Files generated on ${quando}. They are pre-computed: downloading runs no query.`)}</p>
      <Integridade m={m} />
    </>
  );
}

export function Downloads() {
  useIdioma();
  const lido = useCallback((b: unknown) => validarManifesto(b), []);
  const man = useJson(URL_MANIFESTO, true, lido);
  return (
    <div className="downloads-painel">
      <h2>{t('Baixar dados municipais', 'Download municipal data')}</h2>
      <p className="dl-sub-titulo">
        {man.dados?.manifesto.edicao === 'enxuta_2013' ? t('Base enxuta desde 2013: finanças, saúde, trabalho, gestão pública, clima e assistência. Disponível em Stata, CSV e Parquet, com um dicionário curto.',
          'A compact base from 2013 onwards: finance, health, labour, public management, climate and social assistance. Available in Stata, CSV and Parquet, with a short dictionary.') : t('Finanças, saúde, trabalho, gestão pública, clima e assistência, com uma linha por município e ano e dicionário.', 'Finance, health, labour, public management, climate and social assistance, with one row per municipality and year and a dictionary.')}
      </p>
      {man.erro && <Estado erro={man.erro} mensagem={t('Não foi possível carregar a lista de arquivos.', 'Could not load the file list.')} tentarNovamente={man.recarregar} />}
      {man.carregando && <p className="carregando" role="status">{t('Carregando a lista de arquivos…', 'Loading the file list…')}</p>}
      {man.dados && <Conteudo m={man.dados.manifesto} descartados={man.dados.descartados} />}
    </div>
  );
}
