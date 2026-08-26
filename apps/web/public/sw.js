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
// v14: the shell fetch used to be ABORTED after 2.5s, which on a phone over the
// router's VPN meant it usually lost the race — and because an aborted fetch
// never reaches `cache.put`, the stored shell was never refreshed either. The
// app then booted the old bundle forever, on every reload, with no way out
// short of clearing site data. It now answers from cache when the network is
// slow but lets that fetch finish in the background, so the next open is
// current. See the navigation handler below.
// v15: notificationclick now leaves its target in this cache for the page to
// pick up on boot (see the handler at the bottom), so the key has to survive
// into the version the page reads it from.
const CACHE = 'oms-v18';

/** Retry pauses (ms) before a navigation with no cached shell gives up.
 *  Sized against a real restart: restart.bat bounces the API in about 3s, and
 *  stop/start takes a few seconds more. Anything inside that window should look
 *  like a slow load, not a dead site. */
const SHELL_RETRIES = [400, 900, 1800, 3000];

/**
 * A real Response for the case where the shell cannot be fetched at all.
 *
 * `event.respondWith()` rejecting — or resolving to undefined — is what Chrome
 * renders as "This site can't be reached / ERR_FAILED". That is the worst
 * possible answer during a 3-second server restart: it looks like the app is
 * gone, and a reload is the only way out. This page says what is happening and
 * retries itself, so a bounce heals with no user action.
 */
function retryingShell() {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>OMS — reconnecting…</title>` +
      `<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f172a;color:#e2e8f0}` +
      `div{text-align:center}h1{font-size:1.05rem;font-weight:600;margin:0 0 .4rem}p{font-size:.85rem;color:#94a3b8;margin:0}` +
      `s{display:block;width:26px;height:26px;margin:0 auto 1rem;border:3px solid #334155;border-top-color:#38bdf8;border-radius:50%;animation:r .8s linear infinite}` +
      `@keyframes r{to{transform:rotate(360deg)}}</style></head>` +
      `<body><div><s></s><h1>Reconnecting to OMS…</h1><p>The server is starting up. This page will continue on its own.</p></div>` +
      `<script>setTimeout(function(){location.reload()},2000)<\/script></body></html>`,
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

/** How long a navigation waits for the live shell before falling back to cache.
 *  Generous compared with the old 2.5s: a phone resuming on cellular or the
 *  router's OpenVPN routinely needs more than that, and losing this race used to
 *  be permanent. The fallback still keeps a cold open instant. */
const SHELL_TIMEOUT_MS = 6000;

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
        // Start the real fetch and — crucially — never abort it. The old code
        // cancelled this after 2.5s, and a cancelled fetch never reaches
        // `cache.put`, so a phone that lost the race every time kept the same
        // stale shell for good. Letting it run means even a slow link refreshes
        // the shell, so the NEXT open boots the new build.
        //
        // `no-store` matters: without it this revalidation can be answered from
        // the HTTP cache, so the shell we store — and then serve to every future
        // load — can be older than what the server has. Paired with the
        // cache-first rule for /assets/ below, one stale snapshot pins the app to
        // a build whose chunks the next deploy deletes, and it stops booting.
        const network = fetch('/', { cache: 'no-store' }).then((res) => {
          if (res && res.ok) cache.put('/', res.clone()).catch(() => {});
          return res;
        });
        // Keeps this worker alive until the fetch lands, even though the
        // response below may already have been served from cache.
        event.waitUntil(network.catch(() => {}));

        const cached = await cache.match('/');
        if (cached) {
          // Prefer the live shell, but don't hang on it — a slow link gets the
          // cached one now and the fresh one on the next open.
          const timeout = new Promise((resolve) => setTimeout(() => resolve(null), SHELL_TIMEOUT_MS));
          const winner = await Promise.race([network.catch(() => null), timeout]);
          return winner && winner.ok ? winner : cached;
        }

        /*
         * Nothing cached, so the network is the only source — and this is where
         * the app used to die. The old code awaited the fetch and, on failure,
         * fell back to a SECOND bare fetch('/'); when the server was briefly
         * unreachable that one rejected too, the whole handler rejected, and
         * Chrome rendered ERR_FAILED. It read as "the site is broken" when the
         * server was merely mid-restart, and it was intermittent precisely
         * because it needed an empty cache and a bounce to line up — which is
         * exactly what a cache-version bump followed by a restart produces.
         *
         * Retry across a realistic restart window, then answer with a real
         * Response either way. Never reject: a rejection is the one outcome the
         * user cannot recover from without knowing to reload.
         */
        let res = await network.catch(() => null);
        if (res && res.ok) return res;
        for (const wait of SHELL_RETRIES) {
          await new Promise((r) => setTimeout(r, wait));
          res = await fetch('/', { cache: 'no-store' }).catch(() => null);
          if (res && res.ok) {
            cache.put('/', res.clone()).catch(() => {});
            return res;
          }
        }
        return retryingShell();
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
        // offline navigation → last cached shell, else the retrying page.
        // Response.error() surfaces as ERR_FAILED, which for a navigation is a
        // dead end; for sub-resources it stays the honest answer.
        if (req.mode === 'navigate') {
          const shell = await caches.match('/');
          return shell || retryingShell();
        }
        return Response.error();
      }),
  );
});

/**
 * Escape hatch for a client that reloaded but still booted the old bundle —
 * see `hardRefresh()` in lib/pwa-update.ts. Without this the only cure was
 * clearing site data by hand, which is not something to ask of packing staff on
 * a phone.
 *   CLEAR_SHELL — drop the cached index.html so the next navigation must fetch it
 *   CLEAR_ALL   — drop every cache (shell + hashed assets)
 * Both reply on the supplied port so the page can wait before reloading.
 */
self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type !== 'CLEAR_SHELL' && type !== 'CLEAR_ALL') return;
  const reply = () => event.ports && event.ports[0] && event.ports[0].postMessage({ ok: true });
  const work =
    type === 'CLEAR_ALL'
      ? caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      : caches.open(CACHE).then((c) => c.delete('/'));
  event.waitUntil(work.then(reply).catch(reply));
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
      icon: '/icons/icon-192-v4.png',
      badge: '/icons/icon-192-v4.png',
      data: data.data ?? {},
    }),
  );
});

/** Where a tapped notification should land.
 *
 *  followupId is checked first: CRM reminders also carry a `kind`, but theirs is
 *  'PAYMENT' / 'DELIVERY', never 'dispatch'.
 *
 *  '/dispatch' is Modify Dispatch. Dispatch alerts carry the code of the row
 *  they are about, so the page can open showing that row rather than the whole
 *  list — `?search=` drives its search box, which matches the dispatch code and
 *  the order code among other fields. */
function notificationTarget(d) {
  if (d.followupId) return `/${d.kind === 'PAYMENT' ? 'crm/payments' : 'crm'}?followup=${d.followupId}`;
  if (d.kind !== 'dispatch') return '/';
  const code = d.dispatchCode || d.orderCode;
  return code ? `/dispatch?search=${encodeURIComponent(code)}` : '/dispatch';
}

/** Where the target waits for a client that does not exist yet. Read (and
 *  cleared) by lib/notification-target.ts on boot. */
const PENDING_TARGET_URL = '/__pending-notification';

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = notificationTarget(event.notification.data ?? {});
  event.waitUntil(
    // iOS launches an installed PWA at the manifest's start_url and ignores the
    // URL handed to openWindow() / client.navigate(), which is why a dispatch
    // alert landed on the dashboard however right this URL was. So the URL is
    // left here first and the app routes ITSELF there once it boots. Costs
    // nothing on Android/desktop, where the postMessage below wins the race and
    // the stash is simply cleared unused.
    caches
      .open(CACHE)
      .then((c) =>
        c.put(
          PENDING_TARGET_URL,
          new Response(JSON.stringify({ url, at: Date.now() }), { headers: { 'content-type': 'application/json' } }),
        ),
      )
      .catch(() => {})
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((clients) => {
        // An already-running client routes itself from this message. That is the
        // mechanism, not client.navigate() — navigate() is the half iOS ignores,
        // and it would cost a full reload everywhere else.
        for (const client of clients) client.postMessage({ type: 'NOTIFICATION_NAVIGATE', url });
        const focusable = clients.find((c) => 'focus' in c);
        if (focusable) return focusable.focus();
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
  );
});
