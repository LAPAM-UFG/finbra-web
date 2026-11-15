import { useCallback, useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import '../downloads.css';
import {
  arquivoDoRecorte, ordenarDetalhados, validarCatalogo, validarPrevia, COD_BRASILIA, COD_NORONHA, faixaAnos, filtrarArquivos, filtrarDicionario, formatoDisponivel, formatosBase, indexarDicionario, POR_PAGINA, tamanho, urlArquivo, validarDicionario, validarManifesto,
  type PreviaDl, type ArquivoDl, type EntradaDic, type Formato, type FormatoBase, type IndiceDic, type ManifestoDl,
} from '../downloads';
import { Estado } from '../components/Kpi';
import { numero } from '../format';
import { idioma, local, t, useIdioma } from '../idioma';
import { nomeDaUf } from '../ia_territorio';
import { BASE_DADOS } from '../manifesto';

const URL_MANIFESTO = `${BASE_DADOS}gold/downloads/manifesto.json`;

/** Busca um JSON só quando `ativo`; "recarregar" repete (Tentar de novo). Nada aqui usa o motor de consultas. */
function useJson<T>(url: string, ativo: boolean, ler: (bruto: unknown) => T) {
  const [estado, setEstado] = useState<{ url?: string; dados?: T; erro?: string }>({});
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    const ctl = new AbortController();
    setEstado({ url });
    fetch(url, { signal: ctl.signal, cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((bruto) => { if (!ctl.signal.aborted) setEstado({ url, dados: ler(bruto) }); })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setEstado({ url, erro: e instanceof Error ? e.message : String(e) });
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ativo, tentativa]);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  const atual = estado.url === url ? estado : {};
  return { ...atual, carregando: ativo && !atual.dados && !atual.erro, recarregar };
}

const pick = (pt: string, en: string) => (idioma() === 'en' && en ? en : pt);

const FORMATO: Record<Formato, { nome: () => string; dica: () => string }> = {
  rds: { nome: () => 'R (.rds)', dica: () => t('Arquivo nativo do R, sem pacotes extras para ler', 'Native R file; no extra packages needed to read') },
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
          {['painel', 'area', 'detalhado', 'pacote'].includes(a.tipo) && <span className="dl-escopo">{a.uf ? rotuloUf(a.uf) : t('Brasil · todos os municípios', 'Brazil · all municipalities')}</span>}
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

function Previa({ arquivo, pedido }: { arquivo: ArquivoDl; pedido: number }) {
  const [aberta, setAberta] = useState(false);
  useEffect(() => { if (pedido > 0) setAberta(true); }, [pedido]);
  const [variavel, setVariavel] = useState('');
  const id = useId();
  const url = arquivo.previa ? urlArquivo(arquivo.previa.caminho, BASE_DADOS) ?? '' : '';
  const ler = useCallback((b: unknown) => validarPrevia(b, arquivo), [arquivo]);
  const dados = useJson<PreviaDl>(url, aberta && !!url, ler);
  const colunas = dados.dados?.colunas.filter((c) => !['cod_ibge','municipio','uf','regiao','tipo_territorio','ano'].includes(c.variavel)) ?? [];
  const coluna = colunas.find((c) => c.variavel === variavel) ?? colunas[0];
  const valor = (v: string | number | boolean | null | undefined) => {
    if (v === null || v === undefined) return t('Sem dado', 'Missing');
    if (typeof v === 'boolean') return v ? t('Sim','Yes') : t('Não','No');
    if (typeof v !== 'number') return v;
    return new Intl.NumberFormat(local(), v !== 0 && Math.abs(v) < 0.001 ? {notation:'scientific',maximumSignificantDigits:4} : {maximumFractionDigits:3}).format(v);
  };
  if (!url) return null;
  return <details className="dl-previa" open={aberta} onToggle={(e) => setAberta(e.currentTarget.open)}>
    <summary>{t('Prévia e cobertura dos dados', 'Preview and data coverage')}</summary>
    {dados.carregando && <p role="status">{t('Carregando uma pequena amostra…', 'Loading a small sample…')}</p>}
    {dados.erro && <Estado erro={dados.erro} mensagem={t('A prévia não carregou. O arquivo para baixar continua disponível.', 'Preview unavailable. The download remains available.')} tentarNovamente={dados.recarregar} />}
    {dados.dados && coluna && <>
      <p className="dl-intro">{t('Até cinco linhas reais de um município do arquivo escolhido. Os vazios foram preservados. Escolha uma variável para ver a unidade e a cobertura no arquivo inteiro.', 'Up to five actual rows from one municipality in the selected file. Missing values are preserved. Choose a variable to see its unit and coverage across the full file.')}</p>
      <div className="dl-campo"><label htmlFor={id}>{t('Variável da prévia', 'Preview variable')}</label><select id={id} value={coluna.variavel} onChange={(e) => setVariavel(e.target.value)}>{colunas.map((c) => <option key={c.variavel} value={c.variavel}>{c.nome} · {c.variavel}</option>)}</select></div>
      <p className="dl-cobertura"><strong>{coluna.nome}</strong><br />{coluna.unidade} · {faixaAnos({ano_de:null,ano_ate:null,anos_observados:coluna.anos}) ?? t('Sem valores observados','No observed values')}<br />{t(`${numero(coluna.preenchidas)} de ${numero(dados.dados.linhas_total)} células preenchidas neste arquivo.`, `${numero(coluna.preenchidas)} of ${numero(dados.dados.linhas_total)} cells filled in this file.`)}</p>
      <div className="dl-tabela-wrap"><table className="dl-amostra"><caption>{t('Amostra do recorte selecionado', 'Sample of the selected subset')}</caption><thead><tr><th>{t('Município','Municipality')}</th><th>UF</th><th>{t('Ano','Year')}</th><th>{coluna.nome}</th></tr></thead><tbody>{dados.dados.amostra.map((row,i) => <tr key={i}><th scope="row">{String(row.municipio)}</th><td>{String(row.uf)}</td><td>{String(row.ano)}</td><td>{valor(row[coluna.variavel])}</td></tr>)}</tbody></table></div>
      <p className="dl-ajuda">{t('Decimais são arredondados apenas nesta amostra; o download preserva os valores completos. Células preenchidas não substituem as condições e notas de cada indicador. O arquivo contém todas as linhas e variáveis do recorte.', 'Decimals are rounded only in this sample; downloads preserve full values. Filled cells do not replace each indicator’s status and notes. The file contains every row and variable in the subset.')}</p>
    </>}
  </details>;
}

function Dicionario({ indice, busca, area, m, onTodos, onEscolher }: { indice: IndiceDic; busca: string; area: string; m: ManifestoDl; onTodos: () => void; onEscolher: (area: string) => void }) {
  const [pagina, setPagina] = useState(0);
  const achadas = useMemo(() => filtrarDicionario(indice, busca, area), [indice,busca,area]);
  const paginas = Math.max(1,Math.ceil(achadas.length/POR_PAGINA));
  const atual = Math.min(pagina,paginas-1);
  const nomeArea = (id: string) => id === 'identificacao' ? t('Identificação','Identifiers') : (() => { const a=m.areas.find((a) => a.id===id); return a ? pick(a.nome,a.nome_en) : id; })();
  return <div className="dl-dic">
    <p className="dl-contagem" role="status" aria-live="polite">{t(`${numero(achadas.length)} campos encontrados`, `${numero(achadas.length)} fields found`)}{area && <> · {nomeArea(area)} <button type="button" className="botao-leve" onClick={onTodos}>{t('Ver todos os temas','See all topics')}</button></>}</p>
    {achadas.length === 0 ? <p className="dl-vazio">{t('Nenhuma variável da base principal com essa busca. Confira também os arquivos detalhados abaixo ou tente outra palavra.', 'No main-base variables match this search. Also check the detailed files below or try another word.')}</p> : <ul className="dl-vars">{achadas.slice(atual*POR_PAGINA,(atual+1)*POR_PAGINA).map((e) => <Variavel key={e.variavel} e={e} nomeArea={nomeArea} onEscolher={onEscolher} />)}</ul>}
    {paginas>1 && <nav className="dl-pag" aria-label={t('Páginas do dicionário','Dictionary pages')}><button type="button" className="botao-leve" disabled={atual===0} onClick={() => setPagina(atual-1)}>{t('Anterior','Previous')}</button><span>{t(`Página ${atual+1} de ${paginas}`,`Page ${atual+1} of ${paginas}`)}</span><button type="button" className="botao-leve" disabled={atual>=paginas-1} onClick={() => setPagina(atual+1)}>{t('Próxima','Next')}</button></nav>}
  </div>;
}

function Variavel({ e, nomeArea, onEscolher }: { e: EntradaDic; nomeArea: (id: string) => string; onEscolher: (area: string) => void }) {
  const anos = faixaAnos(e);
  const linhas: [string, string][] = ([
    [t('Descrição', 'Description'), e.descricao], [t('Fonte', 'Source'), e.fonte], [t('Tipo', 'Type'), e.tipo], [t('Regra para o ano', 'Annual rule'), e.regra_anual],
    [t('Tabela', 'Table'), e.tabela], [t('Disponibilidade','Availability'),e.arquivo_principal===false ? t('Arquivo do tema','Topic file') : t('Base principal','Main base')], [t('Observação', 'Note'), e.observacao],
    [t('Nome na fonte ampla', 'Name in the source base'), e.variavel_original && e.variavel_original !== e.variavel ? e.variavel_original : ''],
    [t('Códigos no Stata', 'Stata value labels'), e.stata_rotulos ? Object.entries(e.stata_rotulos).map(([k,v]) => `${k} = ${v}`).join('; ') : ''],
  ] as [string, string][]).filter(([, v]) => v);
  return (
    <li className="dl-var">
      <details>
        <summary>
          <span className="dl-var-nome">{e.nome || e.variavel}</span>
          <code>{e.variavel}</code>
          <span className="dl-var-meta">{[e.area && nomeArea(e.area), e.unidade, anos,e.arquivo_principal===false ? t('Arquivo do tema','Topic file') : ''].filter(Boolean).join(' · ')}</span>
        </summary>
        {linhas.length > 0 && <dl>{linhas.map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
        <button type="button" className="botao-leve dl-usar-variavel" onClick={() => onEscolher(e.area)}>{t('Ver arquivo com esta variável', 'See file containing this variable')}</button>
      </details>
    </li>
  );
}

function ApiDados({ uf, area }: { uf: string; area: string }) {
  const [mensagem, setMensagem] = useState('');
  const base = `${location.origin}/api/dados/v1`;
  const localEscolhido = uf || 'BR';
  const tema = area || 'todos';
  const stata = `use "${base}/painel/${localEscolhido}/${tema}.dta", clear`;
  const r = `source("${base}/cliente.R")\ndados <- finbra(uf = "${localEscolhido}", tema = "${tema}")`;
  const copiar = async (codigo: string) => {
    try { await navigator.clipboard.writeText(codigo); setMensagem(t('Código copiado.', 'Code copied.')); }
    catch { setMensagem(t('Selecione e copie o código abaixo.', 'Select and copy the code below.')); }
  };
  return <Secao id="dl-api" titulo={t('Usar direto no Stata e no R', 'Use directly in Stata and R')}
    intro={t('Execute os comandos para carregar os dados do site. Os exemplos acompanham o conteúdo e a localização escolhidos acima.', 'Run these commands to load data from the site. Examples follow the content and location chosen above.')}>
    <div className="dl-api-grade">
      <div className="dl-api-exemplo"><h4>Stata</h4><pre><code>{stata}</code></pre><button type="button" className="botao-leve" onClick={() => copiar(stata)}>{t('Copiar código Stata', 'Copy Stata code')}</button>
        <p className="dl-ajuda">{t('O arquivo mantém os rótulos e o painel declarado. A opção clear substitui os dados em memória. Para um período: keep if inrange(ano, 2019, 2024).', 'The file keeps labels and panel settings. The clear option replaces data in memory. For a period: keep if inrange(ano, 2019, 2024).')}</p>
      </div>
      <div className="dl-api-exemplo"><h4>R</h4><pre><code>{r}</code></pre><button type="button" className="botao-leve" onClick={() => copiar(r)}>{t('Copiar código R', 'Copy R code')}</button>
        <p className="dl-ajuda">{t('O cliente usa apenas R base e lê o formato nativo .rds. Também aceita municipio, anos e variaveis; por exemplo, anos = 2019:2024.', 'The client uses only base R and reads native .rds files. It also accepts municipio, anos and variaveis; for example, anos = 2019:2024.')}</p>
      </div>
    </div>
    <p className="dl-ajuda">{t('UF e tema reduzem o arquivo transferido. Filtros de ano, município e variável são aplicados no seu programa. As URLs entregam a edição atual; o catálogo registra também o endereço imutável e SHA-256 para reprodução.', 'State and topic reduce the transferred file. Year, municipality and variable filters run in your program. URLs serve the current edition; the catalog also records the immutable address and SHA-256 for reproducibility.')}</p>
    <p className="dl-acoes"><a href={`${base}/catalogo.json?uf=${localEscolhido}&tema=${tema}`} target="_blank" rel="noreferrer">{t('Catálogo da API (JSON)', 'API catalog (JSON)')}</a><a href={`${base}/dicionario.json${area ? '?tema='+area : ''}`} target="_blank" rel="noreferrer">{t('Dicionário pela API', 'Dictionary via API')}</a></p>
    <p role="status" aria-live="polite">{mensagem}</p>
  </Secao>;
}

function Guia({ m, metodologia, base }: { m: ManifestoDl; metodologia: ArquivoDl[]; base: number }) {
  const itens: [string, ReactNode][] = [
    ...(m.arquivos.some((a) => a.formato === 'rds') ? [[t('Abrir no R', 'Open in R'), t('Depois de baixar, use dados <- readRDS("arquivo.rds"). Para carregar direto do site, use os comandos da seção Stata / R (API). Nenhum pacote adicional é necessário.', 'After downloading, use dados <- readRDS("file.rds"). To load directly from the site, use the Stata / R (API) section. No extra packages are required.')] as [string, ReactNode]] : []),
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
  const en=idioma()==='en';
  const [area,setArea]=useState(() => { const a=new URLSearchParams(location.search).get('area'); return m.areas.some(x=>x.id===a) ? a! : ''; }); const [uf,setUf]=useState('');
  const [formato,setFormato]=useState<FormatoBase>('dta');
  const [busca,setBusca]=useState(''); const q=useDeferredValue(busca);
  const [dicAberto,setDicAberto]=useState(false); const [dicArea,setDicArea]=useState('');
  const [detalhesAbertos,setDetalhesAbertos]=useState(false);
  const [pedidoPrevia,setPedidoPrevia]=useState({area:'',uf:'',sequencia:0});
  const id=useId(); const r=m.resumo;
  const painel=m.arquivos.filter((a) => a.tipo==='painel');
  const formatos=formatosBase(painel); const fmt=formatoDisponivel(formato,painel);
  const refUf=uf ? m.recortes_uf?.[uf] : undefined;
  const catalogUrl=refUf ? urlArquivo(refUf.caminho,BASE_DADOS) ?? '' : '';
  const lerCatalogo=useCallback((b: unknown) => validarCatalogo(b,m,uf),[m,uf]);
  const catalogo=useJson<ArquivoDl[]>(catalogUrl,!!catalogUrl,lerCatalogo);
  const arquivos=[...m.arquivos,...(uf ? catalogo.dados ?? [] : [])];
  const escolhido=arquivoDoRecorte(arquivos,area,uf,fmt);
  const ufs=[...new Set(painel.map((a) => a.uf).filter((u): u is string => !!u))].sort();
  const lerDic=useCallback((b: unknown) => indexarDicionario(validarDicionario(b)),[]);
  const dic=useJson<IndiceDic>(urlArquivo(m.dicionario.caminho,BASE_DADOS) ?? '',dicAberto || !!q.trim(),lerDic);
  const matches=useMemo(() => dic.dados && q.trim() ? filtrarDicionario(dic.dados,q,'') : [],[dic.dados,q]);
  const areasBusca=new Set(matches.map((e) => e.area));
  const temas=arquivos.filter((a) => a.tipo==='area' && a.uf===(uf || null) && a.formato===fmt);
  const temasF=q.trim() ? temas.filter((a) => areasBusca.has(a.area ?? '') || filtrarArquivos([a],{texto:q,area:'',uf:''},en).length) : temas;
  const detalhes=ordenarDetalhados(filtrarArquivos(m.arquivos.filter((a) => a.tipo==='detalhado'),{texto:q,area:'',uf:''},en));
  const dicionarios=m.arquivos.filter((a) => a.tipo==='dicionario' && a.escopo!=='detalhado').sort((a,b) => ['xlsx','rds','csv.zip','json'].indexOf(a.formato)-['xlsx','rds','csv.zip','json'].indexOf(b.formato));
  const excel=dicionarios.find((a) => a.formato==='xlsx');
  const pacotes=m.arquivos.filter((a) => a.tipo==='pacote');
  const leve=pacotes.filter((a) => a.conteudo===fmt);
  const completos=pacotes.filter((a) => !a.conteudo);
  const metodologia=m.arquivos.filter((a) => a.tipo==='metodologia');
  const mostrarDic=(tema: string) => {setDicArea(tema);setDicAberto(true);setBusca('');requestAnimationFrame(() => rolar('dl-dicionario'));};
  const escolherArea=(tema: string, abrirPrevia=false) => {const nova=m.areas.some((a) => a.id===tema) ? tema : '';setArea(nova);if(abrirPrevia)setPedidoPrevia((p) => ({area:nova,uf,sequencia:p.sequencia+1}));rolar('dl-base');};
  const quando=new Date(m.gerado_em).toLocaleDateString(local(),{day:'numeric',month:'long',year:'numeric'});
  useEffect(() => {if (/munic|anexo|dca/i.test(q)) setDetalhesAbertos(true);},[q]);
  const grupos=m.areas.map((a) => ({area:a,itens:detalhes.filter((d) => d.area===a.id)})).filter((g) => g.itens.length);
  return <>
    {descartados>0 && <p className="dl-aviso" role="status">{t(`${descartados} arquivo(s) inválido(s) não foram exibidos.`,`${descartados} invalid file(s) were not displayed.`)}</p>}
    <Secao id="dl-base" titulo={t('Escolha e baixe','Choose and download')}>
      <div className="dl-escolhas">
        <div className="dl-campo"><label htmlFor={id+'-area'}>{t('Conteúdo','Content')}</label><select id={id+'-area'} value={area} onChange={(e) => setArea(e.target.value)}><option value="">{t('Todos os temas · seleção principal','All topics · core selection')}</option>{m.areas.map((a) => <option value={a.id} key={a.id}>{pick(a.nome,a.nome_en)}</option>)}</select></div>
        <div className="dl-campo"><label htmlFor={id+'-uf'}>{t('Localização','Location')}</label><select id={id+'-uf'} value={uf} onChange={(e) => setUf(e.target.value)}><option value="">{t('Brasil · todos os municípios','Brazil · all municipalities')}</option>{ufs.map((u) => <option key={u} value={u}>{rotuloUf(u)}</option>)}</select></div>
        <div className="dl-campo"><label htmlFor={id+'-fmt'}>{t('Formato','Format')}</label><select id={id+'-fmt'} value={fmt} onChange={(e) => setFormato(e.target.value as FormatoBase)}>{formatos.map((f) => <option key={f} value={f}>{f==='csv.zip' ? t('Excel: CSV (.zip)','Excel: CSV (.zip)') : f==='parquet' ? 'R / Python: Parquet' : f==='rds' ? 'R (.rds)' : 'Stata (.dta)'}</option>)}</select></div>
      </div>
      {escolhido ? <>
        <ul className="dl-lista"><Arquivo a={escolhido} base={BASE_DADOS} destaque /></ul>
        <div className="dl-acoes"><button type="button" className="botao-leve" onClick={() => mostrarDic(area)}>{t(area ? `Ver ${escolhido.variaveis} variáveis do tema` : `Ver ${escolhido.variaveis} indicadores e 6 identificadores`,area ? `View ${escolhido.variaveis} topic variables` : `View ${escolhido.variaveis} indicators and 6 identifiers`)}</button><span className="dl-ajuda">{fmt==='dta' ? m.stata?.painel_declarado ? t('Abre no Stata, com rótulos e painel declarado.','Opens in Stata, with labels and panel settings.') : t('Abre no Stata, com rótulos.','Opens in Stata, with labels.') : fmt==='rds' ? t('Formato nativo do R; usa apenas o R base.','Native R format; uses only base R.') : fmt==='csv.zip' ? t('Extraia o ZIP e importe o CSV no Excel.','Extract the ZIP and import the CSV in Excel.') : t('Formato compacto para R e Python.','Compact format for R and Python.')}</span></div>
        <Previa key={escolhido.previa?.caminho ?? escolhido.id} arquivo={escolhido} pedido={pedidoPrevia.area===area && pedidoPrevia.uf===uf ? pedidoPrevia.sequencia : 0} />
        {escolhido.ano_ate===new Date(m.gerado_em).getFullYear() && <p className="dl-ajuda">{t(`${escolhido.ano_ate} pode estar parcial. A prévia e o dicionário mostram a cobertura de cada variável.`,`${escolhido.ano_ate} may be partial. Preview and dictionary show each variable’s coverage.`)}</p>}
      </> : area && uf && catalogo.carregando ? <p role="status">{t('Carregando a lista de arquivos prontos desta UF…','Loading this state’s ready-to-download file list…')}</p> : <p className="dl-aviso">{t('Não há arquivo para essa combinação. Escolha outro tema ou a seleção principal desta UF.','No file is available for this combination. Choose another topic or this state’s core selection.')} <button type="button" className="botao-leve" onClick={() => setArea('')}>{t('Ver seleção principal da UF','See core state selection')}</button></p>}
      {catalogo.erro && <Estado erro={catalogo.erro} mensagem={t('A lista de temas desta UF não carregou.','This state’s topic list could not load.')} tentarNovamente={catalogo.recarregar} />}
    </Secao>
    <details className="dl-sobre"><summary>{t(`Sobre a base nacional: ${r.variaveis} indicadores + 6 identificadores`,`About the national base: ${r.variaveis} indicators + 6 identifiers`)}</summary>
      <ul className="dl-resumo" aria-label={t('Resumo nacional','National summary')}><li><strong>{numero(r.municipios)}</strong><span>{t('municípios e unidades especiais','municipalities and special territories')}</span></li><li><strong>{r.ano_de}–{r.ano_ate}</strong><span>{t('período total; varia por fonte','total period; varies by source')}</span></li><li><strong>{numero(r.variaveis)}</strong><span>{t('indicadores + 6 identificadores','indicators + 6 identifiers')}</span></li><li><strong>{numero(r.linhas)}</strong><span>{t('linhas de município × ano','municipality × year rows')}</span></li></ul>
    </details>
    <nav className="dl-ancoras" aria-label={t('Nesta página','On this page')}>{[['dl-base',t('Baixar','Download')],['dl-dicionario',t('Buscar / dicionário','Search / dictionary')],['dl-temas',t('Por tema','By topic')],['dl-api',t('Stata / R (API)','Stata / R (API)')],['dl-pacotes',t('Pacotes','Packages')],['dl-guia',t('Como usar','How to use')],['dl-detalhes',t('Dados detalhados','Detailed data')]].map(([id,nome]) => <button key={id} type="button" onClick={() => {if(id==='dl-detalhes')setDetalhesAbertos(true);requestAnimationFrame(() => rolar(id));}}>{nome}</button>)}</nav>
    <Secao id="dl-dicionario" titulo={t('Encontre indicadores e arquivos','Find indicators and files')} intro={t(`A base principal tem ${m.resumo.variaveis} indicadores e seis identificadores (${m.resumo.variaveis+6} colunas). Os arquivos por tema podem trazer mais variáveis: a busca também as encontra e indica o arquivo. As descrições das fontes estão em português.`,`The main base has ${m.resumo.variaveis} indicators and six identifiers (${m.resumo.variaveis+6} columns). Topic files may contain additional variables: search also finds them and identifies their file. Source descriptions are in Portuguese.`)}>
      <div className="dl-filtros"><div className="dl-campo dl-campo-larga"><label htmlFor={id+'-busca'}>{t('Buscar indicador ou arquivo','Search indicator or file')}</label><input type="search" id={id+'-busca'} value={busca} placeholder={t('Ex.: mortalidade, salário, PIB, MUNIC 2024','E.g. mortalidade, salário, PIB, MUNIC 2024')} onChange={(e) => {setBusca(e.target.value);setDicArea('');}} /></div>{busca && <button type="button" className="botao-leve" onClick={() => setBusca('')}>{t('Limpar busca','Clear search')}</button>}</div>
      <div className="dl-acoes">{!dicAberto && !q && <button type="button" className="botao-leve" onClick={() => setDicAberto(true)}>{t('Explorar todas as variáveis','Explore all variables')}</button>}{excel && <a className="botao-leve" href={urlArquivo(excel.caminho,BASE_DADOS) ?? undefined} download>{t('Baixar dicionário Excel','Download Excel dictionary')}</a>}</div>
      {(dicAberto || !!q) && <>{dic.carregando && <p role="status">{t('Buscando no dicionário leve…','Searching the compact dictionary…')}</p>}{dic.erro && <Estado erro={dic.erro} mensagem={t('A busca não carregou. Os downloads continuam disponíveis.','Search could not load. Downloads remain available.')} tentarNovamente={dic.recarregar} />}{dic.dados && <Dicionario key={q+'|'+dicArea} indice={dic.dados} busca={q} area={dicArea} m={m} onTodos={() => setDicArea('')} onEscolher={escolherArea} />}</>}
      <details className="dl-dic-downloads"><summary>{t('Outros formatos do dicionário: R, CSV e JSON','Other dictionary formats: R, CSV and JSON')}</summary><Lista arquivos={dicionarios.filter((a) => a.formato!=='xlsx')} base={BASE_DADOS} /></details>
    </Secao>
    <Secao id="dl-temas" titulo={t('Baixar por tema','Download by topic')} intro={uf ? t(`Arquivos dos municípios de ${rotuloUf(uf)}. O formato é o escolhido no início da página.`,`Municipal data for ${rotuloUf(uf)}. Format follows your selection at the top.`) : t('Arquivos nacionais (Brasil). Escolha uma UF no início para baixar os temas só daquele estado.','National files (Brazil). Choose a state at the top to download its topic subsets.')}>
      {uf && catalogo.carregando ? <p role="status">{t('Carregando os temas desta UF…','Loading this state’s topics…')}</p> : temasF.length ? <ul className="dl-lista dl-temas-grade">{temasF.map((a) => <li className="dl-tema" key={a.id}><ul className="dl-lista"><Arquivo a={a} base={BASE_DADOS} /></ul><button className="botao-leve" type="button" onClick={() => mostrarDic(a.area ?? '')}>{t(`Ver ${a.variaveis} variáveis do tema`,`View ${a.variaveis} topic variables`)}</button><button className="botao-leve" type="button" onClick={() => escolherArea(a.area ?? '',true)}>{t('Ver prévia e cobertura','See preview and coverage')}</button></li>)}</ul> : <p className="dl-vazio">{t('Nenhum tema com esse recorte e busca. Tente outra palavra ou escolha a seleção principal.','No topics match this subset and search. Try another word or choose the core selection.')}</p>}
    </Secao>
    <Secao id="dl-pacotes" titulo={t('Base nacional com dicionário','National base with dictionary')} intro={t('Brasil, todos os temas. O pacote inclui apenas o formato escolhido no início, mais dicionário e instruções.','Brazil, all topics. The package contains only the format chosen at the top, plus dictionary and instructions.')}>
      <Lista arquivos={leve} base={BASE_DADOS} />
      {completos.length>0 && <details className="dl-dic-downloads"><summary>{t('Pacote conjunto: Stata, CSV e Parquet','Combined package: Stata, CSV and Parquet')}</summary><Lista arquivos={completos} base={BASE_DADOS} /></details>}
    </Secao>
    <details id="dl-detalhes" className="dl-avancado" open={detalhesAbertos} onToggle={(e) => setDetalhesAbertos(e.currentTarget.open)}><summary>{t('Dados detalhados nacionais (opcional)','Detailed national data (optional)')}</summary><p className="dl-intro">{t('MUNIC completa e contas DCA, desde 2013, em CSV e Parquet. Estes arquivos são do Brasil inteiro, independentemente da UF escolhida acima. Edições mais recentes aparecem primeiro.','Full MUNIC and DCA accounts from 2013 onwards, in CSV and Parquet. These cover all of Brazil, regardless of the state selected above. Latest editions appear first.')}</p>{!grupos.length && <p className="dl-vazio">{t('Nenhum arquivo detalhado com essa busca.','No detailed files match this search.')}</p>}{grupos.map((g) => <div className="dl-grupo" key={g.area.id}><h4 className="dl-sub">{pick(g.area.nome,g.area.nome_en)}</h4><Lista arquivos={g.itens} base={BASE_DADOS} limite={q ? 50 : 6} /></div>)}<h4 className="dl-sub">{t('Dicionário dos complementos','Supplement dictionary')}</h4><Lista arquivos={m.arquivos.filter((a) => a.tipo==='dicionario' && a.escopo==='detalhado')} base={BASE_DADOS} /></details>
    <ApiDados uf={uf} area={area} />
    <Secao id="dl-guia" titulo={t('Como usar os arquivos','How to use the files')}><Guia m={m} metodologia={metodologia} base={m.base_ipca} /></Secao>
    <p className="dl-rodape">{t(`Arquivos gerados em ${quando}. Todos são pré-calculados; escolher e baixar não executa consultas.`,`Files generated on ${quando}. All files are pre-computed; choosing and downloading runs no queries.`)}</p>
    <Integridade m={{...m,arquivos}} />
  </>;
}

export function Downloads() {
  useIdioma();
  const lido=useCallback((b: unknown) => validarManifesto(b),[]);
  const man=useJson(URL_MANIFESTO,true,lido);
  return <div className="downloads-painel"><h2>{t('Baixar dados municipais','Download municipal data')}</h2><p className="dl-sub-titulo">{t('Desde 2013, com uma linha por município e ano. Escolha o conteúdo, o local e o formato.','From 2013 onwards, one row per municipality and year. Choose content, location and format.')}</p>{man.erro && <Estado erro={man.erro} mensagem={t('Não foi possível carregar a lista de arquivos.','Could not load the file list.')} tentarNovamente={man.recarregar} />}{man.carregando && <p role="status">{t('Carregando a lista de arquivos…','Loading the file list…')}</p>}{man.dados && <Conteudo m={man.dados.manifesto} descartados={man.dados.descartados} />}</div>;
}
