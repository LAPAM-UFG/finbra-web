import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { ProvedorDados } from './contexto';
import { Demonstrativos } from './pages/Demonstrativos';
import { DespesasEvolucao, DespesasVisaoGeral } from './pages/Despesas';
import { Fpm, FpmFaixas } from './pages/Fpm';
import { Deflatores, Qualidade } from './pages/Metodologia';
import { Rankings } from './pages/Rankings';
import { ReceitasEvolucao, ReceitasVisaoGeral } from './pages/Receitas';
import { Socioeconomico } from './pages/Socioeconomico';

const MENU: [string, [string, string][]][] = [
  ['Receitas', [['/receitas', 'Visão geral'], ['/receitas/evolucao', 'Evolução']]],
  ['FPM', [['/fpm', 'Evolução e dependência'], ['/fpm/faixas', 'Faixas populacionais']]],
  ['Despesas', [['/despesas', 'Visão geral'], ['/despesas/evolucao', 'Evolução']]],
  ['Análises', [['/demonstrativos', 'Demonstrativos (7 anexos)'], ['/socioeconomico', 'Socioeconômico'], ['/rankings', 'Rankings']]],
  ['Metodologia', [['/deflatores', 'Deflatores'], ['/qualidade', 'Qualidade e fontes']]],
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
      {escuro ? 'Tema claro' : 'Tema escuro'}
    </button>
  );
}

export function App() {
  const { search } = useLocation();
  // os filtros globais acompanham a navegação; o anexo é só da página de demonstrativos
  const filtros = new URLSearchParams(search);
  filtros.delete('anexo');
  const busca = filtros.toString() ? `?${filtros}` : '';

  return (
    <>
      <header className="topo">
        <img className="logo" src="/logo_lapam.png" alt="LAPAM" />
        <h1>Finanças municipais · SICONFI</h1>
        <span className="espaco" />
        <AlternarTema />
      </header>
      <div className="casca">
        <nav className="menu" aria-label="Páginas">
          {MENU.map(([grupo, itens]) => (
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
        <main>
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
              <Route path="/deflatores" element={<Deflatores />} />
              <Route path="/qualidade" element={<Qualidade />} />
              <Route path="*" element={<p className="vazio">Página não encontrada.</p>} />
            </Routes>
          </ProvedorDados>
        </main>
      </div>
    </>
  );
}
