/* OMS service worker — makes the app installable and adds a light offline layer.
 * Strategy: network-first with cache fallback for same-origin GET static assets
 * and navigations. NEVER caches /api (live data) or the Vite dev internals. */
// Bumping this name is what evicts a poisoned cache: `activate` deletes every
// cache whose key isn't the current one. Bump it whenever the caching rules
// below change, or to force stranded clients onto a fresh copy.
// v13: a rebuild replaced every content-hashed chunk, so any client still
// holding the v12 shell was pointing at chunk names that no longer exist
// ("Importing a module script failed"). Bumping evicts that shell on activate,
// so the next navigation is fetched fresh instead of being served the poisoned
// snapshot from cache.
const CACHE = 'oms-v13';

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

const NEVER_CACHE = [/^\/api\//, /\/@vite/, /\/@react-refresh/, /\/node_modules\//, /^\/src\//, /hot-update/];
// Vite's build output is content-hashed (a new build always gets new
// filenames), so these are safe to serve straight from cache forever —
// no need to hit the network first on every single app open.
const IMMUTABLE = [/^\/assets\//];

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.some((re) => re.test(url.pathname))) return;
  // The client's "is a new build deployed?" probe (lib/pwa-update.ts) — always
  // straight to the network, and never stored (its URL is unique every time).
  if (url.searchParams.has('_v')) return;

  // App navigations (the SPA shell): NETWORK-FIRST with a short timeout, so a
  // reload always picks up the freshly-deployed shell (and thus the new
  // content-hashed chunks) right away — this is what makes "update, then reload"
  // work on mobile, iOS especially, instead of showing yesterday's build.
  // The timeout keeps the old slow-link win: if the network doesn't answer
  // within a couple of seconds (phone on the router's OpenVPN), fall back to the
  // cached shell fast so a cold open still paints instantly instead of hanging
  // on a black screen. Navigations to real files (e.g. /oms-rootCA.crt) keep
  // the default handling below.
  if (req.mode === 'navigate' && !/\.[a-z0-9]+$/i.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 2500);
          // `no-store` matters: without it this revalidation can be answered
          // from the HTTP cache, so the shell we store — and then serve to
          // every future load — can be older than what the server has. Paired
          // with the cache-first rule for /assets/ below, one stale snapshot
          // pins the app to a build whose chunks the next deploy deletes, and
          // the app stops booting entirely.
          const res = await fetch('/', { signal: controller.signal, cache: 'no-store' });
          clearTimeout(timer);
          if (res && res.ok) {
            cache.put('/', res.clone()).catch(() => {});
            return res;
          }
          throw new Error('shell fetch not ok');
        } catch {
          // Slow / offline / aborted → serve the last cached shell; if there is
          // none yet (first-ever open), fall back to a plain network fetch.
          const hit = await cache.match('/');
          return hit || fetch('/');
        }
      })(),
    );
    return;
  }

  if (IMMUTABLE.some((re) => re.test(url.pathname))) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        });
      }),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'default')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        // offline navigation → last cached shell
        if (req.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});

// Web Push — fires even when the app is fully closed; the browser wakes this
// worker in its own background process to handle it.
self.addEventListener('push', (event) => {
  let data = { title: 'OMS notification', body: '' };
  try {
    data = event.data.json();
  } catch {
    /* non-JSON or missing payload — use the default above */
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: data.data ?? {},
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const d = event.notification.data ?? {};
  // followupId is checked first: CRM reminders also carry a `kind`, but theirs is
  // 'PAYMENT' / 'DELIVERY', never 'dispatch'.
  const url = d.followupId
    ? `/${d.kind === 'PAYMENT' ? 'crm/payments' : 'crm'}?followup=${d.followupId}`
    : d.kind === 'dispatch'
      ? '/dispatch'
      : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client && 'navigate' in client) {
          client.focus();
          return client.navigate(new URL(url, self.location.origin).href);
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});
