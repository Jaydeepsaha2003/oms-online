import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
// Self-hosted variable fonts (no external CDN, works offline).
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/montserrat';
import App from '@/App';
import { AppProviders } from '@/app/providers';
import { watchForAppUpdates } from '@/lib/pwa-update';
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
  // Was this page already controlled? If not, the very first install claiming
  // this client fires controllerchange too — reloading then is pointless churn
  // (nothing changed), so only reload when we're swapped OFF an older worker.
  const hadController = !!navigator.serviceWorker.controller;

  window.addEventListener('load', () => {
    // updateViaCache: 'none' — never answer the sw.js request from the HTTP
    // cache. Without it an iPhone can keep re-validating against a cached copy
    // of the worker and never notice a new build.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      /* e.g. plain-HTTP LAN access — install still possible via Add to Home Screen */
    });
  });
  // Once a new service worker takes over an already-open tab (a deploy shipped
  // while it was open, or the index.html recovery script unregistered a stuck
  // one), reload immediately so the tab reflects the fresh version instead of
  // silently running on whatever it had loaded before.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController) window.location.reload();
  });

  // iOS home-screen apps resume frozen instead of reloading, so nothing above
  // ever re-runs — this re-checks for a new build on every foreground.
  watchForAppUpdates();
}
