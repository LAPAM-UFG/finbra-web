import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigationType } from 'react-router-dom';
import { HistoricoIa } from './components/HistoricoIa';
import { ProvedorDados } from './contexto';
import { definirIdioma, t, useIdioma } from './idioma';
import { Demonstrativos } from './pages/Demonstrativos';
import { DespesasEvolucao, DespesasNaturezaEvolucao, DespesasNaturezaVisaoGeral, DespesasVisaoGeral } from './pages/Despesas';
import { Fpm, FpmFaixas } from './pages/Fpm';
import { Ia } from './pages/Ia';
import { MunicEvolucao, MunicMetodologia, MunicTerritorio, MunicVisaoGeral } from './pages/Munic';
import { ClimaMetodologia, ClimaRankings, ClimaVisaoGeral } from './pages/Clima';
import { LrfDemonstrativos, LrfIndicadores } from './pages/Lrf';
import { Deflatores, Qualidade } from './pages/Metodologia';
import { Rankings } from './pages/Rankings';
import { SaudeEvolucao, SaudeMetodologia, SaudeRankings, SaudeTabela, SaudeVisaoGeral } from './pages/SaudeDatasus';
import { SaudeAmbulatorial } from './pages/SaudeAmbulatorial';
import { SaudeVacinacao } from './pages/SaudeVacinacao';
import { SaudeRede } from './pages/SaudeRede';
import { SaudeFinanciamento } from './pages/SaudeFinanciamento';
import { ReceitasEvolucao, ReceitasVisaoGeral } from './pages/Receitas';
import { Educacao, RemuneracaoEducacao, Saude } from './pages/SaudeEducacao';
import { Socioeconomico } from './pages/Socioeconomico';
import { TrabalhoCaged, TrabalhoEvolucao, TrabalhoRankings } from './pages/Trabalho';
import { TrabalhoPainel } from './pages/TrabalhoPainel';
import { MunicEntrada } from './pages/MunicPainel';
import { contextoMunic, edicoesCuradas, type Destino } from './munic_painel';
import { CURADORIA } from './munic_curadoria';
import { TrabalhoConsulta } from './pages/TrabalhoConsulta';
import { TrabalhoEstabelecimentos } from './pages/TrabalhoEstabelecimentos';
import { TrabalhoRemuneracao } from './pages/TrabalhoRemuneracao';
import { TrabalhoMetodologia } from './pages/TrabalhoMetodologia';
import { TrabalhoPerfil } from './pages/TrabalhoPerfil';
import { PARAMS_TRABALHO } from './trabalho_comum';

const menu = (): [string, [string, string][]][] => [
  [t('Receitas', 'Revenue'), [['/receitas', t('Visão geral', 'Overview')], ['/receitas/evolucao', t('Evolução', 'Trends')]]],
  ['FPM', [['/fpm', t('Evolução e dependência', 'Trends and dependency')], ['/fpm/faixas', t('Faixas populacionais', 'Population brackets')]]],
  [t('Despesas orçamentárias', 'Budget expenditure'), [['/despesas-orcamentarias', t('Visão geral', 'Overview')], ['/despesas-orcamentarias/evolucao', t('Evolução', 'Trends')]]],
  [t('Despesas por função', 'Expenditure by function'), [['/despesas', t('Visão geral', 'Overview')], ['/despesas/evolucao', t('Evolução', 'Trends')]]],
  [t('Responsabilidade fiscal', 'Fiscal responsibility'), [['/lrf', t('Indicadores da LRF', 'LRF indicators')], ['/lrf/demonstrativos', t('Demonstrativos RREO e RGF', 'RREO and RGF statements')]]],
  [t('Saúde e educação', 'Health and education'), [
    ['/educacao', t('Educação (SIOPE)', 'Education (SIOPE)')],
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
  [t('Indicadores de saúde', 'Health indicators'), [['/datasus', t('Visão geral', 'Overview')], ['/datasus/evolucao', t('Evolução', 'Trends')],
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

type Area = 'financas' | 'trabalho' | 'saude' | 'munic' | 'clima' | 'ia';
const areaDe = (pathname: string): Area => (pathname === '/ia' ? 'ia' : pathname.startsWith('/trabalho') ? 'trabalho'
  : pathname.startsWith('/datasus') ? 'saude' : pathname.startsWith('/munic') ? 'munic' : pathname.startsWith('/clima') ? 'clima' : 'financas');

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
  const busca = filtros.toString() ? `?${filtros}` : '';
  const buscaArea = dentro.toString() ? `?${dentro}` : '';
  // a aba da IA abre com o tema da área de onde se veio (só ordena os exemplos): território e ano dos filtros do painel não
  // vão junto, porque a pergunta diz o recorte e a IA escolhe as fontes
  const filtrosIa = new URLSearchParams(area === 'ia' ? atuais : undefined);
  if (area !== 'ia' && area !== 'munic' && area !== 'clima') filtrosIa.set('paineis', area);
  const buscaIa = `?${filtrosIa}`;

  return (
    <>
      <a className="pular" href="#conteudo">{t('Pular para o conteúdo', 'Skip to content')}</a>
      <header className="topo">
        <img className="logo" src="/logo_lapam.png" alt="LAPAM" />
        <h1 className="sr-only">{{
          financas: `${t('Finanças municipais', 'Municipal finances')} · SICONFI`,
          trabalho: t('Mercado de trabalho · RAIS e CAGED', 'Labour market · RAIS and CAGED'),
          saude: t('Saúde · DATASUS', 'Health · DATASUS'),
          munic: t('Gestão pública · MUNIC e ESTADIC', 'Public management · MUNIC and ESTADIC'),
          clima: t('Clima · CHIRPS e ERA5-Land', 'Climate · CHIRPS and ERA5-Land'),
          ia: t('Pergunte aos dados · LAPAM/UFG', 'Ask the data · LAPAM/UFG'),
        }[area]}</h1>
        <nav className="areas" aria-label={t('Áreas', 'Areas')}>
          <Link to={{ pathname: '/ia', search: buscaIa }} className={area === 'ia' ? 'ativo' : ''} aria-current={area === 'ia' ? 'page' : undefined}>{t('Pergunte aos dados (IA)', 'Ask the data (AI)')}</Link>
          <Link to={{ pathname: '/receitas', search: busca }} className={area === 'financas' ? 'ativo' : ''} aria-current={area === 'financas' ? 'page' : undefined}>{t('Finanças públicas', 'Public finances')}</Link>
          <Link to={{ pathname: '/trabalho', search: busca }} className={area === 'trabalho' ? 'ativo' : ''} aria-current={area === 'trabalho' ? 'page' : undefined}>{t('Mercado de trabalho', 'Labour market')}</Link>
          <Link to={{ pathname: '/datasus', search: busca }} className={area === 'saude' ? 'ativo' : ''} aria-current={area === 'saude' ? 'page' : undefined}>{t('Saúde', 'Health')}</Link>
          <Link to={{ pathname: '/munic', search: '' }} className={area === 'munic' ? 'ativo' : ''} aria-current={area === 'munic' ? 'page' : undefined}>{t('Gestão pública', 'Public management')}</Link>
          <Link to={{ pathname: '/clima', search: '' }} className={area === 'clima' ? 'ativo' : ''} aria-current={area === 'clima' ? 'page' : undefined}>{t('Clima', 'Climate')}</Link>
        </nav>
        <div className="topo-controles">
          <AlternarIdioma />
          <AlternarTema />
        </div>
      </header>
      <div className={`casca${area === 'ia' ? ' casca-ia' : ''}`}>
        <nav className={`menu${area === 'ia' ? ' menu-ia' : ''}`} aria-label={t('Páginas', 'Pages')}>
          {({ financas: menu, trabalho: menuTrabalho, saude: menuSaude, munic: menuMunic, clima: menuClima, ia: menuIa }[area])().map(([grupo, itens]) => (
            <div key={grupo} style={{ display: 'contents' }}>
              <h4>{grupo}</h4>
              {itens.map(([para, rotulo]) => (
                <NavLink key={para} to={{ pathname: para, search: area === 'ia' ? buscaIa : area === 'munic' ? contextoMunic(search, DESTINO_MUNIC[para] ?? 'avancado', EDICOES_MUNIC) : area === 'clima' ? '' : buscaArea }} end className={({ isActive }) => (isActive ? 'ativo' : '')}>
                  {rotulo}
                </NavLink>
              ))}
            </div>
          ))}
          {area === 'ia' && <HistoricoIa />}
        </nav>
        {/* a chave refaz as páginas ao trocar o idioma: gráficos e textos memorizados são recalculados */}
        <main key={idioma} id="conteudo" tabIndex={-1}>
          <ProvedorDados>
            <Routes>
              <Route path="/" element={<Navigate to="/ia" replace />} />
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
              <Route path="/educacao" element={<Educacao />} />
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
              <Route path="/trabalho/ia" element={<Navigate to="/ia?paineis=trabalho" replace />} />
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
              <Route path="/deflatores" element={<Deflatores />} />
              <Route path="/qualidade" element={<Qualidade />} />
              <Route path="*" element={<p className="vazio">{t('Página não encontrada.', 'Page not found.')}</p>} />
            </Routes>
          </ProvedorDados>
        </main>
      </div>
    </>
  );
}
