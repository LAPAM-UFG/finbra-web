import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { definirIdioma, idioma } from './idioma';
import './styles.css';

try {
  const tema = localStorage.getItem('tema');
  if (tema) document.documentElement.dataset.theme = tema;
} catch {
  /* sem armazenamento: segue o tema do sistema */
}

// o idioma salvo (com o dicionário de contas, se for inglês) entra antes do primeiro render
definirIdioma(idioma()).finally(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  ),
);
