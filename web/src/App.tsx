import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ProvedorDados } from './contexto';
import { definirIdioma, t, useIdioma } from './idioma';
import { Demonstrativos } from './pages/Demonstrativos';
import { DespesasEvolucao, DespesasVisaoGeral } from './pages/Despesas';
import { Fpm, FpmFaixas } from './pages/Fpm';
import { Ia } from './pages/Ia';
import { LrfDemonstrativos, LrfIndicadores } from './pages/Lrf';
import { Deflatores, Qualidade } from './pages/Metodologia';
import { Rankings } from './pages/Rankings';
import { ReceitasEvolucao, ReceitasVisaoGeral } from './pages/Receitas';
import { Socioeconomico } from './pages/Socioeconomico';
import { TrabalhoCaged, TrabalhoEvolucao, TrabalhoRankings, TrabalhoVisaoGeral } from './pages/Trabalho';

const menu = (): [string, [string, string][]][] => [
  [t('Receitas', 'Revenue'), [['/receitas', t('Visão geral', 'Overview')], ['/receitas/evolucao', t('Evolução', 'Trends')]]],
  ['FPM', [['/fpm', t('Evolução e dependência', 'Trends and dependency')], ['/fpm/faixas', t('Faixas populacionais', 'Population brackets')]]],
  [t('Despesas', 'Expenditure'), [['/despesas', t('Visão geral', 'Overview')], ['/despesas/evolucao', t('Evolução', 'Trends')]]],
  [t('Responsabilidade fiscal', 'Fiscal responsibility'), [['/lrf', t('Indicadores da LRF', 'LRF indicators')], ['/lrf/demonstrativos', t('Demonstrativos RREO e RGF', 'RREO and RGF statements')]]],
  [t('Análises', 'Analysis'), [
    ['/demonstrativos', t('Demonstrativos (7 anexos)', 'Financial statements (7 annexes)')],
    ['/socioeconomico', t('Socioeconômico', 'Socioeconomic')],
    ['/rankings', 'Rankings'],
    ['/ia', t('Pergunte aos dados (IA)', 'Ask the data (AI)')],
  ]],
  [t('Metodologia', 'Methodology'), [['/deflatores', t('Deflatores', 'Deflators')], ['/qualidade', t('Qualidade e fontes', 'Quality and sources')]]],
];

/** Área de mercado de trabalho (RAIS e Novo CAGED), em /trabalho. */
const menuTrabalho = (): [string, [string, string][]][] => [
  ['RAIS', [['/trabalho', t('Visão geral', 'Overview')], ['/trabalho/evolucao', t('Evolução', 'Trends')], ['/trabalho/rankings', 'Rankings']]],
  ['CAGED', [['/trabalho/caged', t('Empregos mês a mês', 'Jobs month by month')]]],
  [t('Metodologia', 'Methodology'), [['/deflatores', t('Deflatores', 'Deflators')], ['/qualidade', t('Qualidade e fontes', 'Quality and sources')]]],
];

function lerTema(): string | null {
  try {
    return localStorage.getItem('tema');
  } catch {
    return null;
  }
}

function AlternarTema() {
  const [tema, setTema] = useState<string | null>(lerTema);
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
  const escuro = tema ? tema === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
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
  const { search, pathname } = useLocation();
  const trabalho = pathname.startsWith('/trabalho');
  // só os filtros globais acompanham a navegação; as escolhas de cada página (anexo, indicador do ranking…) ficam nela
  const atuais = new URLSearchParams(search);
  const filtros = new URLSearchParams();
  for (const k of ['ano', 'uf', 'ente']) if (atuais.get(k)) filtros.set(k, atuais.get(k)!);
  const busca = filtros.toString() ? `?${filtros}` : '';

  return (
    <>
      <a className="pular" href="#conteudo">{t('Pular para o conteúdo', 'Skip to content')}</a>
      <header className="topo">
        <img className="logo" src="/logo_lapam.png" alt="LAPAM" />
        <h1>{trabalho ? t('Mercado de trabalho · RAIS e CAGED', 'Labour market · RAIS and CAGED') : `${t('Finanças municipais', 'Municipal finances')} · SICONFI`}</h1>
        <nav className="areas" aria-label={t('Áreas', 'Areas')}>
          <NavLink to={{ pathname: '/receitas', search: busca }} className={trabalho ? '' : 'ativo'}>{t('Finanças públicas', 'Public finances')}</NavLink>
          <NavLink to={{ pathname: '/trabalho', search: busca }} className={trabalho ? 'ativo' : ''}>{t('Mercado de trabalho', 'Labour market')}</NavLink>
        </nav>
        <span className="espaco" />
        <AlternarIdioma />
        <AlternarTema />
      </header>
      <div className="casca">
        <nav className="menu" aria-label={t('Páginas', 'Pages')}>
          {(trabalho ? menuTrabalho() : menu()).map(([grupo, itens]) => (
            <div key={grupo} style={{ display: 'contents' }}>
              <h4>{grupo}</h4>
              {itens.map(([para, rotulo]) => (
                <NavLink key={para} to={{ pathname: para, search: busca }} end className={({ isActive }) => (isActive ? 'ativo' : '')}>
                  {rotulo}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {/* a chave refaz as páginas ao trocar o idioma: gráficos e textos memorizados são recalculados */}
        <main key={idioma} id="conteudo" tabIndex={-1}>
          <ProvedorDados>
            <Routes>
              <Route path="/" element={<Navigate to="/receitas" replace />} />
              <Route path="/receitas" element={<ReceitasVisaoGeral />} />
              <Route path="/receitas/evolucao" element={<ReceitasEvolucao />} />
              <Route path="/fpm" element={<Fpm />} />
              <Route path="/fpm/faixas" element={<FpmFaixas />} />
              <Route path="/despesas" element={<DespesasVisaoGeral />} />
              <Route path="/despesas/evolucao" element={<DespesasEvolucao />} />
              <Route path="/demonstrativos" element={<Demonstrativos />} />
              <Route path="/socioeconomico" element={<Socioeconomico />} />
              <Route path="/rankings" element={<Rankings />} />
              <Route path="/ia" element={<Ia />} />
              <Route path="/lrf" element={<LrfIndicadores />} />
              <Route path="/lrf/demonstrativos" element={<LrfDemonstrativos />} />
              <Route path="/trabalho" element={<TrabalhoVisaoGeral />} />
              <Route path="/trabalho/evolucao" element={<TrabalhoEvolucao />} />
              <Route path="/trabalho/caged" element={<TrabalhoCaged />} />
              <Route path="/trabalho/rankings" element={<TrabalhoRankings />} />
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
