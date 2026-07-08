/* OMS service worker — makes the app installable and adds a light offline layer.
 * Strategy: network-first with cache fallback for same-origin GET static assets
 * and navigations. NEVER caches /api (live data) or the Vite dev internals. */
const CACHE = 'oms-v2';

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
  const url = d.followupId
    ? `/${d.kind === 'PAYMENT' ? 'crm/payments' : 'crm'}?followup=${d.followupId}`
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
