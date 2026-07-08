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

// Fade out the instant welcome splash (index.html) once React has mounted, keeping
// it up for a minimum time so the animation is actually seen on fast reloads.
(() => {
  const SPLASH_MIN_MS = 900;
  const hide = () => {
    const el = document.getElementById('app-splash');
    if (!el) return;
    el.classList.add('app-splash--hide');
    window.setTimeout(() => el.remove(), 550);
  };
  const start = (window as unknown as { __APP_SPLASH_START__?: number }).__APP_SPLASH_START__ ?? Date.now();
  const wait = Math.max(0, SPLASH_MIN_MS - (Date.now() - start));
  requestAnimationFrame(() => window.setTimeout(hide, wait));
})();

// PWA: register the service worker so the app is installable (desktop/Android)
// and keeps a light offline cache. /api is never cached — data stays live.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* e.g. plain-HTTP LAN access — install still possible via Add to Home Screen */
    });
  });
}
