/*
 * Cuadre service worker — app shell only.
 *
 * It caches the things that make the app *open* offline: the built JS/CSS
 * (content-hashed, so a stale one is impossible) and the icons. It never caches
 * a financial read. A validation and a balance are always network — a cached
 * "pago confirmado" would be a fraud waiting to happen, so any request the app
 * makes for data falls straight through to the network with no cache in front
 * of it.
 */
const SHELL_CACHE = 'cuadre-shell-v1';

self.addEventListener('install', (event) => {
  // Nothing to pre-cache: the shell is content-hashed and populated lazily on
  // first fetch. Activate immediately so the first load is also the first one
  // protected.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from older shell versions, then take control of open pages.
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Only the shell is cached: hashed build assets and the icons. Everything
  // else — every page render, every server action, every data read — is network
  // only, on purpose.
  const isShell = url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
  if (!isShell) return;

  // Stale-while-revalidate: answer from cache instantly, refresh in the
  // background. Safe here precisely because these URLs are immutable.
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cached = await cache.match(request);
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached ?? network;
    })(),
  );
});
