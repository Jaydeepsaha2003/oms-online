import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Self-hosted variable fonts (no external CDN, works offline).
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/montserrat';
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
  // Once a new service worker takes over an already-open tab (a deploy shipped
  // while it was open, or the index.html recovery script unregistered a stuck
  // one), reload immediately so the tab reflects the fresh version instead of
  // silently running on whatever it had loaded before.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}
