import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pagina } from './carregar_pagina';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
const HistoricoIa = pagina(() => import('./components/HistoricoIa').then(m => ({default:m.HistoricoIa})));
import { ProvedorDados } from './contexto';
import { definirIdioma, t, useIdioma } from './idioma';
import { buscaClima } from './clima_comum';
import { contextoMunic, edicoesCuradas, type Destino } from './munic_painel';
import { CURADORIA } from './munic_curadoria';
import { PARAMS_TRABALHO } from './trabalho_comum';
import { buscaEntreAreas, buscaIaLegada, buscaParaDownloads, type Area } from './navegacao';

const Demonstrativos = pagina(() => import('./pages/Demonstrativos').then(m => ({default:m.Demonstrativos})));
const Downloads = pagina(() => import('./pages/Downloads').then(m => ({default:m.Downloads})));
const EducacaoPainel = pagina(() => import('./pages/EducacaoPainel').then(m => ({default:m.EducacaoPainel})));
const EducacaoEvolucao = pagina(() => import('./pages/EducacaoPainel').then(m => ({default:m.EducacaoEvolucao})));
const EducacaoRankings = pagina(() => import('./pages/EducacaoPainel').then(m => ({default:m.EducacaoRankings})));
const EducacaoTabela = pagina(() => import('./pages/EducacaoPainel').then(m => ({default:m.EducacaoTabela})));
const EducacaoMetodologia = pagina(() => import('./pages/EducacaoPainel').then(m => ({default:m.EducacaoMetodologia})));
const DespesasEvolucao = pagina(() => import('./pages/Despesas').then(m => ({default:m.DespesasEvolucao})));
const DespesasNaturezaEvolucao = pagina(() => import('./pages/Despesas').then(m => ({default:m.DespesasNaturezaEvolucao})));
const DespesasNaturezaVisaoGeral = pagina(() => import('./pages/Despesas').then(m => ({default:m.DespesasNaturezaVisaoGeral})));
const DespesasVisaoGeral = pagina(() => import('./pages/Despesas').then(m => ({default:m.DespesasVisaoGeral})));
const Fpm = pagina(() => import('./pages/Fpm').then(m => ({default:m.Fpm})));
const FpmFaixas = pagina(() => import('./pages/Fpm').then(m => ({default:m.FpmFaixas})));
const Ia = pagina(() => import('./pages/Ia').then(m => ({default:m.Ia})));
const MunicEvolucao = pagina(() => import('./pages/Munic').then(m => ({default:m.MunicEvolucao})));
const MunicMetodologia = pagina(() => import('./pages/Munic').then(m => ({default:m.MunicMetodologia})));
const MunicTerritorio = pagina(() => import('./pages/Munic').then(m => ({default:m.MunicTerritorio})));
const MunicVisaoGeral = pagina(() => import('./pages/Munic').then(m => ({default:m.MunicVisaoGeral})));
const ClimaMetodologia = pagina(() => import('./pages/Clima').then(m => ({default:m.ClimaMetodologia})));
const ClimaRankings = pagina(() => import('./pages/Clima').then(m => ({default:m.ClimaRankings})));
const ClimaVisaoGeral = pagina(() => import('./pages/Clima').then(m => ({default:m.ClimaVisaoGeral})));
const AssistenciaPainel = pagina(() => import('./pages/Assistencia').then(m => ({default:m.AssistenciaPainel})));
const AssistenciaEvolucao = pagina(() => import('./pages/Assistencia').then(m => ({default:m.AssistenciaEvolucao})));
const AssistenciaRankings = pagina(() => import('./pages/Assistencia').then(m => ({default:m.AssistenciaRankings})));
const AssistenciaTabela = pagina(() => import('./pages/Assistencia').then(m => ({default:m.AssistenciaTabela})));
const AssistenciaMetodologia = pagina(() => import('./pages/Assistencia').then(m => ({default:m.AssistenciaMetodologia})));
const LrfDemonstrativos = pagina(() => import('./pages/Lrf').then(m => ({default:m.LrfDemonstrativos})));
const LrfIndicadores = pagina(() => import('./pages/Lrf').then(m => ({default:m.LrfIndicadores})));
const Deflatores = pagina(() => import('./pages/Metodologia').then(m => ({default:m.Deflatores})));
const Qualidade = pagina(() => import('./pages/Metodologia').then(m => ({default:m.Qualidade})));
const Rankings = pagina(() => import('./pages/Rankings').then(m => ({default:m.Rankings})));
const SaudeEvolucao = pagina(() => import('./pages/SaudeDatasus').then(m => ({default:m.SaudeEvolucao})));
const SaudeMetodologia = pagina(() => import('./pages/SaudeDatasus').then(m => ({default:m.SaudeMetodologia})));
const SaudeRankings = pagina(() => import('./pages/SaudeDatasus').then(m => ({default:m.SaudeRankings})));
const SaudeTabela = pagina(() => import('./pages/SaudeDatasus').then(m => ({default:m.SaudeTabela})));
const SaudeVisaoGeral = pagina(() => import('./pages/SaudeDatasus').then(m => ({default:m.SaudeVisaoGeral})));
const SaudeAmbulatorial = pagina(() => import('./pages/SaudeAmbulatorial').then(m => ({default:m.SaudeAmbulatorial})));
const SaudeVacinacao = pagina(() => import('./pages/SaudeVacinacao').then(m => ({default:m.SaudeVacinacao})));
const SaudeRede = pagina(() => import('./pages/SaudeRede').then(m => ({default:m.SaudeRede})));
const SaudeFinanciamento = pagina(() => import('./pages/SaudeFinanciamento').then(m => ({default:m.SaudeFinanciamento})));
const ReceitasEvolucao = pagina(() => import('./pages/Receitas').then(m => ({default:m.ReceitasEvolucao})));
const ReceitasVisaoGeral = pagina(() => import('./pages/Receitas').then(m => ({default:m.ReceitasVisaoGeral})));
const Educacao = pagina(() => import('./pages/SaudeEducacao').then(m => ({default:m.Educacao})));
const RemuneracaoEducacao = pagina(() => import('./pages/SaudeEducacao').then(m => ({default:m.RemuneracaoEducacao})));
const Saude = pagina(() => import('./pages/SaudeEducacao').then(m => ({default:m.Saude})));
const Socioeconomico = pagina(() => import('./pages/Socioeconomico').then(m => ({default:m.Socioeconomico})));
const TrabalhoCaged = pagina(() => import('./pages/Trabalho').then(m => ({default:m.TrabalhoCaged})));
const TrabalhoEvolucao = pagina(() => import('./pages/Trabalho').then(m => ({default:m.TrabalhoEvolucao})));
const TrabalhoRankings = pagina(() => import('./pages/Trabalho').then(m => ({default:m.TrabalhoRankings})));
const TrabalhoPainel = pagina(() => import('./pages/TrabalhoPainel').then(m => ({default:m.TrabalhoPainel})));
const MunicEntrada = pagina(() => import('./pages/MunicPainel').then(m => ({default:m.MunicEntrada})));
const TrabalhoConsulta = pagina(() => import('./pages/TrabalhoConsulta').then(m => ({default:m.TrabalhoConsulta})));
const TrabalhoEstabelecimentos = pagina(() => import('./pages/TrabalhoEstabelecimentos').then(m => ({default:m.TrabalhoEstabelecimentos})));
const TrabalhoRemuneracao = pagina(() => import('./pages/TrabalhoRemuneracao').then(m => ({default:m.TrabalhoRemuneracao})));
const TrabalhoMetodologia = pagina(() => import('./pages/TrabalhoMetodologia').then(m => ({default:m.TrabalhoMetodologia})));
const TrabalhoPerfil = pagina(() => import('./pages/TrabalhoPerfil').then(m => ({default:m.TrabalhoPerfil})));

const menu = (): [string, [string, string][]][] => [
  [t('Receitas', 'Revenue'), [['/receitas', t('Visão geral', 'Overview')], ['/receitas/evolucao', t('Evolução', 'Trends')]]],
  ['FPM', [['/fpm', t('Evolução e dependência', 'Trends and dependency')], ['/fpm/faixas', t('Faixas populacionais', 'Population brackets')]]],
  [t('Despesas orçamentárias', 'Budget expenditure'), [['/despesas-orcamentarias', t('Visão geral', 'Overview')], ['/despesas-orcamentarias/evolucao', t('Evolução', 'Trends')]]],
  [t('Despesas por função', 'Expenditure by function'), [['/despesas', t('Visão geral', 'Overview')], ['/despesas/evolucao', t('Evolução', 'Trends')]]],
  [t('Responsabilidade fiscal', 'Fiscal responsibility'), [['/lrf', t('Indicadores da LRF', 'LRF indicators')], ['/lrf/demonstrativos', t('Demonstrativos RREO e RGF', 'RREO and RGF statements')]]],
  [t('Saúde e educação', 'Health and education'), [
    ['/educacao/financiamento', t('Educação (SIOPE)', 'Education (SIOPE)')],
    ['/educacao/profissionais', t('Profissionais da educação', 'Education staff')],
    ['/saude', t('Saúde (SIOPS)', 'Health (SIOPS)')],
  ]],
  [t('Análises', 'Analysis'), [
    ['/demonstrativos', t('Demonstrativos (7 anexos)', 'Financial statements (7 annexes)')],
    ['/socioeconomico', t('Socioeconômico', 'Socioeconomic')],
    ['/rankings', 'Rankings'],
  ]],
  [t('Metodologia', 'Methodology'), [['/deflatores', t('Deflatores', 'Deflators')], ['/qualidade', t('Qualidade e fontes', 'Quality and sources')]]],
];

/** Área de mercado de trabalho (RAIS e Novo CAGED), em /trabalho. */
const menuTrabalho = (): [string, [string, string][]][] => [
  [t('Painel', 'Dashboard'), [['/trabalho', t('Painel de indicadores', 'Indicator dashboard')]]],
  [t('Exploração avançada', 'Advanced exploration'), [['/trabalho/evolucao', t('Evolução', 'Trends')], ['/trabalho/rankings', 'Rankings'],
    ['/trabalho/estabelecimentos', t('Estabelecimentos', 'Establishments')], ['/trabalho/consulta', t('Consulta personalizada', 'Custom query')],
    ['/trabalho/perfil', t('Perfil do recorte', 'Scope profile')], ['/trabalho/remuneracao', t('Remuneração e desigualdades', 'Pay and inequality')],
    ['/trabalho/caged', t('CAGED mês a mês', 'CAGED month by month')]]],
  [t('Metodologia', 'Methodology'), [['/trabalho/metodologia', t('Fontes e metodologia', 'Sources and methodology')]]],
];

/** Área de saúde (SIM, SINASC e população da SVS/MS), em /datasus; o /saude das finanças é o SIOPS. */
const menuSaude = (): [string, [string, string][]][] => [
  [t('Indicadores de saúde', 'Health indicators'), [['/datasus', t('Visão geral', 'Overview')], ['/datasus/evolucao', t('Evolução', 'Trends')], ['/datasus/tabela', t('Tabela e exportações', 'Table and downloads')],
    ['/datasus/rankings', 'Rankings'], ['/datasus/rede', t('Rede e acesso', 'Network and access')],
    ['/datasus/ambulatorial', t('Produção ambulatorial', 'Outpatient output')],
    ['/datasus/vacinacao', t('Vacinação', 'Vaccination')],
    ['/datasus/financiamento', t('Financiamento federal', 'Federal funding')]]],
  [t('Metodologia', 'Methodology'), [['/datasus/metodologia', t('Fontes e metodologia', 'Sources and methodology')]]],
];

/** Menu da área MUNIC: só pesq, uf, cod e ano (válidos) acompanham de página em página; a escolha de pergunta do explorador (aba, var, grupo) não. */
const EDICOES_MUNIC = edicoesCuradas(CURADORIA);
const DESTINO_MUNIC: Record<string, Destino> = { '/munic': 'painel', '/munic/territorio': 'ficha' };

/** Área de gestão pública (MUNIC e ESTADIC, do IBGE), em /munic. */
const menuMunic = (): [string, [string, string][]][] => [
  [t('Gestão pública', 'Public management'), [['/munic', t('Painel automático', 'Automatic dashboard')]]],
  [t('Exploração avançada', 'Advanced exploration'), [['/munic/perguntas', t('Explorar por pergunta', 'Explore by question')], ['/munic/evolucao', t('Evolução entre edições', 'Change across editions')],
    ['/munic/territorio', t('Ficha do município ou estado', 'Municipality or state profile')]]],
  [t('Metodologia', 'Methodology'), [['/munic/metodologia', t('Fontes e metodologia', 'Sources and methodology')]]],
];

/** Área de clima (chuva do CHIRPS; temperatura e outras variáveis do ERA5-Land; por município e mês), em /clima. */
const menuClima = (): [string, [string, string][]][] => [
  [t('Variáveis climáticas', 'Climate variables'), [['/clima', t('Visão geral', 'Overview')], ['/clima/rankings', 'Rankings']]],
  [t('Metodologia', 'Methodology'), [['/clima/metodologia', t('Fontes e metodologia', 'Sources and methodology')]]],
];

/** Aba geral da IA (/ia), que consulta os painéis marcados na página. */
// a aba da IA tem uma página só: a lateral fica para o histórico de conversas (o nome já está no topo e nas abas)
const menuIa = (): [string, [string, string][]][] => [];

const menuAssistencia = (): [string, [string, string][]][] => [
  [t('Assistência social', 'Social assistance'), [['/assistencia', t('Painel de indicadores', 'Indicator dashboard')]]],
  [t('Explorar os dados', 'Explore the data'), [['/assistencia/evolucao', t('Evolução', 'Trends')], ['/assistencia/rankings', 'Rankings'], ['/assistencia/tabela', t('Tabela e exportações', 'Table and downloads')]]],
  [t('Metodologia', 'Methodology'), [['/assistencia/metodologia', t('Fontes e metodologia', 'Sources and methodology')]]],
];

/** Central de downloads (/downloads): só metadados na abertura, sem filtros globais nem motor de consultas. */
const menuDownloads = (): [string, [string, string][]][] => [
  [t('Dados abertos', 'Open data'), [['/downloads', t('Baixar dados municipais', 'Download municipal data')]]],
];

const menuEducacao = (): [string, [string, string][]][] => [
  [t('Educação', 'Education'), [['/educacao', t('Painel de indicadores', 'Indicator dashboard')]]],
  [t('Explorar os dados', 'Explore the data'), [['/educacao/evolucao', t('Evolução', 'Trends')], ['/educacao/rankings', 'Rankings'], ['/educacao/tabela', t('Tabela e exportações', 'Table and downloads')]]],
  [t('Financiamento', 'Funding'), [['/educacao/financiamento', t('Gastos e aplicação · SIOPE', 'Expenditure and allocation · SIOPE')], ['/educacao/profissionais', t('Profissionais da educação', 'Education staff')]]],
  [t('Metodologia', 'Methodology'), [['/educacao/metodologia', t('Fontes e metodologia', 'Sources and methodology')]]],
];

const areaDe = (pathname: string): Area => (pathname === '/ia' ? 'ia' : pathname === '/downloads' || pathname.startsWith('/downloads/') ? 'downloads' : pathname.startsWith('/trabalho') ? 'trabalho'
  : pathname.startsWith('/datasus') ? 'saude' : pathname.startsWith('/educacao') ? 'educacao' : pathname.startsWith('/munic') ? 'munic' : pathname.startsWith('/clima') ? 'clima' : pathname.startsWith('/assistencia') ? 'assistencia' : 'financas');

function lerTema(): string | null {
  try {
    return localStorage.getItem('tema');
  } catch {
    return null;
  }
}

function AlternarTema() {
  const [tema, setTema] = useState<string | null>(lerTema);
  const [sistemaEscuro, setSistemaEscuro] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const consulta = matchMedia('(prefers-color-scheme: dark)');
    const acompanharSistema = () => setSistemaEscuro(consulta.matches);
    consulta.addEventListener('change', acompanharSistema);
    return () => consulta.removeEventListener('change', acompanharSistema);
  }, []);
  useEffect(() => {
    if (tema) document.documentElement.dataset.theme = tema;
    else delete document.documentElement.dataset.theme;
    try {
      if (tema) localStorage.setItem('tema', tema);
      else localStorage.removeItem('tema');
    } catch {
      /* armazenamento indisponível: o tema vale só nesta visita */
    }
  }, [tema]);
  const escuro = tema ? tema === 'dark' : sistemaEscuro;
  return (
    <button className="tema" onClick={() => setTema(escuro ? 'light' : 'dark')}>
      {escuro ? t('Tema claro', 'Light theme') : t('Tema escuro', 'Dark theme')}
    </button>
  );
}

function AlternarIdioma() {
  const idioma = useIdioma();
  const [carregando, setCarregando] = useState(false);
  const outro = idioma === 'en' ? 'pt' : 'en';
  return (
    <button
      className="tema"
      lang={outro === 'en' ? 'en' : 'pt-BR'}
      disabled={carregando}
      onClick={() => {
        setCarregando(true);
        definirIdioma(outro).finally(() => setCarregando(false));
      }}
    >
      {outro === 'en' ? 'English' : 'Português'}
    </button>
  );
}

export function App() {
  const navegar = useNavigate();
  const idioma = useIdioma();
  const { search, pathname, hash } = useLocation();
  const navegacao = useNavigationType();
  const area = areaDe(pathname);
  // ao ir para outra página, ela abre no início; mudar só os filtros (mesmo caminho), seguir uma âncora (#...) e Voltar/Avançar
  // (POP, em que o navegador restaura a posição) não mexem na rolagem
  const caminhoAnterior = useRef(pathname);
  useEffect(() => {
    const mudou = caminhoAnterior.current !== pathname;
    caminhoAnterior.current = pathname;
    if (mudou && navegacao !== 'POP' && !hash) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, navegacao, hash]);
  // o cabeçalho é fixo e muda de altura (uma linha, duas ou três, conforme a largura e o idioma): a rolagem até uma âncora desconta essa altura
  useEffect(() => {
    const topo = document.querySelector('header.topo');
    if (!topo) return;
    const medir = () => document.documentElement.style.setProperty('--altura-topo', `${Math.ceil(topo.getBoundingClientRect().height)}px`);
    medir();
    const o = new ResizeObserver(medir);
    o.observe(topo);
    return () => o.disconnect();
  }, []);
  // a aba ativa fica à vista nos menus de rolagem horizontal (celular): ao trocar de área ou página e também quando a largura muda
  // (girar o aparelho, redimensionar a janela). Só o scrollLeft do próprio menu muda, nunca a rolagem da página nem o scrollTop do menu
  useLayoutEffect(() => {
    const navs = Array.from(document.querySelectorAll<HTMLElement>('header.topo nav.areas, .casca > nav.menu'));
    const mostrarAtiva = (nav: HTMLElement) => {
      const ativo = nav.querySelector<HTMLElement>('a.ativo');
      if (!ativo || nav.scrollWidth <= nav.clientWidth) return;
      const n = nav.getBoundingClientRect();
      const a = ativo.getBoundingClientRect();
      if (a.left < n.left + 8 || a.right > n.right - 8) nav.scrollTo({ left: nav.scrollLeft + (a.left - n.left) - (n.width - a.width) / 2, behavior: 'auto' });
    };
    navs.forEach(mostrarAtiva);
    const o = new ResizeObserver((entradas) => entradas.forEach((e) => mostrarAtiva(e.target as HTMLElement)));
    navs.forEach((nav) => o.observe(nav));
    return () => o.disconnect();
  }, [pathname, area, idioma]);
  // só os filtros globais acompanham a navegação; as escolhas de cada página (anexo, indicador do ranking…) ficam nela
  const atuais = new URLSearchParams(search);
  const filtros = new URLSearchParams();
  // o painel da MUNIC tem escolhas próprias (ano é a edição): nada dele vai para os outros painéis, nem o contrário
  for (const k of ['ano', 'uf', 'ente']) if (area !== 'munic' && area !== 'clima' && atuais.get(k)) filtros.set(k, atuais.get(k)!);
  // dentro da área de trabalho o recorte (ocupação, atividade, perfil, agrupamentos) segue entre as páginas
  const dentro = new URLSearchParams(filtros);
  if (area === 'trabalho') for (const k of PARAMS_TRABALHO) if (atuais.get(k)) dentro.set(k, atuais.get(k)!);
  const buscaArea = dentro.toString() ? `?${dentro}` : '';
  const paraArea = (destino: Exclude<Area, 'ia' | 'downloads'>) => buscaEntreAreas(search, area, destino);
  // a aba da IA abre com o tema da área de onde se veio (só ordena os exemplos): território e ano dos filtros do painel não
  // vão junto, porque a pergunta diz o recorte e a IA escolhe as fontes
  const filtrosIa = new URLSearchParams(area === 'ia' ? atuais : undefined);
  if (area !== 'ia' && area !== 'munic' && area !== 'clima' && area !== 'downloads') filtrosIa.set('paineis', area);
  const buscaIa = `?${filtrosIa}`;

  const gruposMenu = ({ financas: menu, trabalho: menuTrabalho, saude: menuSaude, educacao: menuEducacao, munic: menuMunic, clima: menuClima, assistencia: menuAssistencia, downloads: menuDownloads, ia: menuIa }[area])();
  const linkPagina = (para: string) => ({ pathname: para, search: area === 'downloads' ? search : area === 'ia' ? buscaIa : area === 'educacao' ? buscaEntreAreas(search, 'educacao', para.includes('/financiamento') || para.includes('/profissionais') ? 'financas' : 'educacao') : area === 'munic' ? contextoMunic(search, DESTINO_MUNIC[para] ?? 'avancado', EDICOES_MUNIC) : area === 'clima' ? buscaClima(search) : area === 'assistencia' ? buscaEntreAreas(search, 'assistencia', 'assistencia') : buscaArea });
  const areas: {id: Area; nome: string; caminho: string; busca: string}[] = [
    {id:'ia',nome:t('Pergunte aos dados (IA)','Ask the data (AI)'),caminho:'/ia',busca:buscaIa},
    {id:'financas',nome:t('Finanças públicas','Public finances'),caminho:'/receitas',busca:paraArea('financas')},
    {id:'trabalho',nome:t('Mercado de trabalho','Labour market'),caminho:'/trabalho',busca:paraArea('trabalho')},
    {id:'saude',nome:t('Saúde','Health'),caminho:'/datasus',busca:paraArea('saude')},
    {id:'educacao',nome:t('Educação','Education'),caminho:'/educacao',busca:paraArea('educacao')},
    {id:'munic',nome:t('Gestão pública','Public management'),caminho:'/munic',busca:paraArea('munic')},
    {id:'clima',nome:t('Clima','Climate'),caminho:'/clima',busca:paraArea('clima')},
    {id:'assistencia',nome:t('Assistência social','Social assistance'),caminho:'/assistencia',busca:paraArea('assistencia')},
    {id:'downloads',nome:t('Baixar dados','Download data'),caminho:'/downloads',busca:buscaParaDownloads(search,area)},
  ];
  useEffect(()=>{
    const nome=areas.find(a=>a.id===area)?.nome??'LAPAM';
    const pagina=gruposMenu.flatMap(([,itens])=>itens).find(([p])=>p===pathname)?.[1];
    document.title=`LAPAM · ${nome}${pagina?' · '+pagina:''}`;
  },[pathname,idioma,area]);



  return (
    <>
      <a className="pular" href="#conteudo">{t('Pular para o conteúdo', 'Skip to content')}</a>
      <header className="topo">
        <img className="logo" src="/logo_lapam.png" alt="LAPAM" />
        <h1 className="sr-only">{{
          financas: `${t('Finanças municipais', 'Municipal finances')} · SICONFI`,
          trabalho: t('Mercado de trabalho · RAIS e CAGED', 'Labour market · RAIS and CAGED'),
          saude: t('Saúde · DATASUS', 'Health · DATASUS'),
          educacao: t('Educação · Inep e SIOPE', 'Education · Inep and SIOPE'),
          munic: t('Gestão pública · MUNIC e ESTADIC', 'Public management · MUNIC and ESTADIC'),
          clima: t('Clima · CHIRPS e ERA5-Land', 'Climate · CHIRPS and ERA5-Land'),
          assistencia: t('Assistência social · CadÚnico, Bolsa Família e BPC', 'Social assistance · Cadastro Único, Bolsa Família and BPC'),
          downloads: t('Baixar dados municipais', 'Download municipal data'),
          ia: t('Pergunte aos dados · LAPAM/UFG', 'Ask the data · LAPAM/UFG'),
        }[area]}</h1>
        <nav className="areas" aria-label={t('Áreas', 'Areas')}>
          {areas.filter(a=>a.id!=='downloads').map(a=><Link key={a.id} to={{pathname:a.caminho,search:a.busca}} className={area===a.id?'ativo':''} aria-current={area===a.id?'page':undefined}>{a.nome}</Link>)}
        </nav>
        <div className="areas-mobile">
          <label className="sr-only" htmlFor="area-painel">{t('Área do painel','Dashboard area')}</label>
          <select id="area-painel" value={area} onChange={e=>{const a=areas.find(a=>a.id===e.target.value)!;navegar({pathname:a.caminho,search:a.busca});}}>
            {areas.map(a=><option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        </div>
        <div className="topo-controles">
          <Link to={{pathname:"/downloads",search:buscaParaDownloads(search,area)}} className="topo-baixar" aria-current={area === 'downloads' ? 'page' : undefined} aria-label={t('Baixar dados municipais', 'Download municipal data')}>
            <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 16h12" /></svg>
            <span>{t('Baixar dados', 'Download data')}</span>
          </Link>
          <AlternarIdioma />
          <AlternarTema />
        </div>
      </header>
      <div className={`casca${area === 'ia' ? ' casca-ia' : ''}`}>
        <nav className={`menu${area === 'ia' ? ' menu-ia' : ''}`} aria-label={t('Páginas', 'Pages')}>
          {area !== 'ia' && <div className="menu-mobile">
            <label className="sr-only" htmlFor="pagina-painel">{t('Página do painel','Dashboard page')}</label>
            <select id="pagina-painel" value={gruposMenu.some(([,xs])=>xs.some(([p])=>p===pathname))?pathname:''} onChange={e=>navegar(linkPagina(e.target.value))}>
              {!gruposMenu.some(([,xs])=>xs.some(([p])=>p===pathname)) && <option value="" disabled>{t('Escolha uma página','Choose a page')}</option>}
              {gruposMenu.map(([grupo,xs])=><optgroup key={grupo} label={grupo}>{xs.map(([para,rotulo])=><option key={para} value={para}>{area==='financas'?`${grupo} · ${rotulo}`:rotulo}</option>)}</optgroup>)}
            </select>
          </div>}
          <div className="menu-grupos">{gruposMenu.map(([grupo, itens]) => (
            <div key={grupo} style={{ display: 'contents' }}>
              <h4>{grupo}</h4>
              {itens.map(([para, rotulo]) => (
                <NavLink key={para} to={linkPagina(para)} end className={({ isActive }) => (isActive ? 'ativo' : '')}>
                  {rotulo}
                </NavLink>
              ))}
            </div>
          ))}
          </div>
          {area === 'ia' && <Suspense fallback={null}><HistoricoIa /></Suspense>}
        </nav>
        {/* a chave refaz as páginas ao trocar o idioma: gráficos e textos memorizados são recalculados */}
        <main key={idioma} id="conteudo" tabIndex={-1}>
          <Suspense fallback={<p className="carregando" role="status">{t('Abrindo o painel…', 'Opening the dashboard…')}</p>}><ProvedorDados>
            <Routes>
              <Route path="/" element={<Navigate to={{ pathname: '/ia', search: buscaIaLegada(search), hash }} replace />} />
              <Route path="/receitas" element={<ReceitasVisaoGeral />} />
              <Route path="/receitas/evolucao" element={<ReceitasEvolucao />} />
              <Route path="/fpm" element={<Fpm />} />
              <Route path="/fpm/faixas" element={<FpmFaixas />} />
              <Route path="/despesas" element={<DespesasVisaoGeral />} />
              <Route path="/despesas/evolucao" element={<DespesasEvolucao />} />
              <Route path="/despesas-orcamentarias" element={<DespesasNaturezaVisaoGeral />} />
              <Route path="/despesas-orcamentarias/evolucao" element={<DespesasNaturezaEvolucao />} />
              <Route path="/demonstrativos" element={<Demonstrativos />} />
              <Route path="/socioeconomico" element={<Socioeconomico />} />
              <Route path="/rankings" element={<Rankings />} />
              <Route path="/ia" element={<Ia />} />
              <Route path="/lrf" element={<LrfIndicadores />} />
              <Route path="/lrf/demonstrativos" element={<LrfDemonstrativos />} />
              <Route path="/educacao" element={<EducacaoPainel />} />
              <Route path="/educacao/evolucao" element={<EducacaoEvolucao />} />
              <Route path="/educacao/rankings" element={<EducacaoRankings />} />
              <Route path="/educacao/tabela" element={<EducacaoTabela />} />
              <Route path="/educacao/metodologia" element={<EducacaoMetodologia />} />
              <Route path="/educacao/financiamento" element={<Educacao />} />
              <Route path="/educacao/profissionais" element={<RemuneracaoEducacao />} />
              <Route path="/saude" element={<Saude />} />
              <Route path="/trabalho" element={<TrabalhoPainel />} />
              <Route path="/trabalho/evolucao" element={<TrabalhoEvolucao />} />
              <Route path="/trabalho/caged" element={<TrabalhoCaged />} />
              <Route path="/trabalho/rankings" element={<TrabalhoRankings />} />
              <Route path="/trabalho/consulta" element={<TrabalhoConsulta />} />
              <Route path="/trabalho/perfil" element={<TrabalhoPerfil />} />
              <Route path="/trabalho/remuneracao" element={<TrabalhoRemuneracao />} />
              <Route path="/trabalho/estabelecimentos" element={<TrabalhoEstabelecimentos />} />
              <Route path="/trabalho/metodologia" element={<TrabalhoMetodologia />} />
              <Route path="/trabalho/ia" element={<Navigate to={{ pathname: '/ia', search: buscaIaLegada(search, 'trabalho'), hash }} replace />} />
              <Route path="/datasus" element={<SaudeVisaoGeral />} />
              <Route path="/datasus/evolucao" element={<SaudeEvolucao />} />
              <Route path="/datasus/rankings" element={<SaudeRankings />} />
              <Route path="/datasus/tabela" element={<SaudeTabela />} />
              <Route path="/datasus/rede" element={<SaudeRede />} />
              <Route path="/datasus/ambulatorial" element={<SaudeAmbulatorial />} />
              <Route path="/datasus/vacinacao" element={<SaudeVacinacao />} />
              <Route path="/datasus/financiamento" element={<SaudeFinanciamento />} />
              <Route path="/datasus/metodologia" element={<SaudeMetodologia />} />
              <Route path="/munic" element={<MunicEntrada />} />
              <Route path="/munic/perguntas" element={<MunicVisaoGeral />} />
              <Route path="/munic/evolucao" element={<MunicEvolucao />} />
              <Route path="/munic/territorio" element={<MunicTerritorio />} />
              <Route path="/munic/metodologia" element={<MunicMetodologia />} />
              <Route path="/clima" element={<ClimaVisaoGeral />} />
              <Route path="/clima/rankings" element={<ClimaRankings />} />
              <Route path="/clima/metodologia" element={<ClimaMetodologia />} />
              <Route path="/assistencia" element={<AssistenciaPainel />} />
              <Route path="/assistencia/evolucao" element={<AssistenciaEvolucao />} />
              <Route path="/assistencia/rankings" element={<AssistenciaRankings />} />
              <Route path="/assistencia/tabela" element={<AssistenciaTabela />} />
              <Route path="/assistencia/metodologia" element={<AssistenciaMetodologia />} />
              <Route path="/downloads" element={<Downloads />} />
              <Route path="/deflatores" element={<Deflatores />} />
              <Route path="/qualidade" element={<Qualidade />} />
              <Route path="*" element={<p className="vazio">{t('Página não encontrada.', 'Page not found.')}</p>} />
            </Routes>
          </ProvedorDados></Suspense>
        </main>
      </div>
    </>
  );
}
