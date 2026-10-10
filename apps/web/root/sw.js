/* Retires the OMS service worker that was registered at scope "/" before the
 * app moved to /oms/. Browsers re-check /sw.js on navigation, find this, and
 * install it in place of the old one; it then removes itself and reloads its
 * pages, which the root page sends on to /oms/. The live worker is /oms/sw.js. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
    })(),
  );
});
