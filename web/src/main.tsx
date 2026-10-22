import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import './styles.css';

try {
  const tema = localStorage.getItem('tema');
  if (tema) document.documentElement.dataset.theme = tema;
} catch {
  /* sem armazenamento: segue o tema do sistema */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
