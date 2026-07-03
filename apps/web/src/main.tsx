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

// PWA: register the service worker so the app is installable (desktop/Android)
// and keeps a light offline cache. /api is never cached — data stays live.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* e.g. plain-HTTP LAN access — install still possible via Add to Home Screen */
    });
  });
}
