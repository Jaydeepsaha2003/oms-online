import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Self-hosted variable fonts (no external CDN, works offline).
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import App from '@/App';
import { AppProviders } from '@/app/providers';
import '@/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProviders>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppProviders>
  </StrictMode>,
);
