/*
 * MyPro service worker — Web Push (Phase 6.2) and offline launch.
 *
 * Push: receives a notification when no tab is open.
 *
 * Offline launch: downloaded books are useless if the app itself cannot open
 * without a connection (on the web, and in the Android app, whose WebView
 * loads the deployed site). The cache is shaped to avoid stale-bundle bugs:
 *
 *  - Pages (navigations) are NETWORK-FIRST. Online you always get the newest
 *    deploy; the cached copy is only used when the network fails.
 *  - Built assets under /assets/ have content hashes in their names, so they
 *    never change — CACHE-FIRST is exactly right, and an old page always finds
 *    its own matching bundle.
 *  - Other same-origin static files (logos, animation data) are
 *    stale-while-revalidate. Fonts from Google are cached the same way.
 *  - API calls go to other origins and are never cached — data freshness is
 *    the outbox's and the app's job, not the worker's.
 */

const SHELL_CACHE = 'mypro-shell-v1';
const ASSET_CACHE = 'mypro-assets-v1';
const KEEP = new Set([SHELL_CACHE, ASSET_CACHE]);
/** Old hashed bundles accumulate across deploys; keep the newest this many. */
const MAX_ASSETS = 80;

/* Take over without waiting for every tab to close, so a fresh deploy's
 * worker is the one handling pushes. */
async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  await shell.add(new Request('/', { cache: 'reload' }));
  // Every built file, so lazily-loaded parts (the reader, the PDF worker) work
  // offline too. The manifest is written by the build (vite.config.ts).
  const res = await fetch('/asset-manifest.json', { cache: 'reload' });
  if (!res.ok) return;
  const files = await res.json();
  const assets = await caches.open(ASSET_CACHE);
  await Promise.all(
    files.map((file) =>
      assets.match('/' + file, { ignoreVary: true }).then((hit) => hit || assets.add('/' + file).catch(() => undefined)),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precache()
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  ),
);

async function trimAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  for (const request of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  // App navigations: network first, the last good page when offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => (await caches.match('/', { ignoreVary: true })) || Response.error()),
    );
    return;
  }

  // Hashed build output: immutable, so the cache is always right.
  if (sameOrigin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      // ignoreVary: a module script is requested with an Origin header the
      // precached copy was stored without; the bytes are identical.
      caches.match(request, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(ASSET_CACHE)
                .then((cache) => cache.put(request, copy))
                .then(trimAssets);
            }
            return response;
          }),
      ),
    );
    return;
  }

  // The worker itself and dev-server internals are never cached.
  if (sameOrigin && (url.pathname === '/sw.js' || url.pathname.startsWith('/@') || url.pathname.startsWith('/src/'))) return;

  // Everything else static: serve the cached copy, refresh it behind.
  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const hit = await cache.match(request, { ignoreVary: true });
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok || response.type === 'opaque') void cache.put(request, response.clone());
          return response;
        })
        .catch(() => hit || Response.error());
      return hit || refresh;
    }),
  );
});

/* Quick actions by notification kind, mirroring the in-app controls. The
 * Android shade renders these as tappable buttons; `resume` carries a
 * dedicated deeplink so "Resume" lands on the exact book/episode. */
const KIND_ACTIONS = {
  reading: [{ action: 'resume', title: 'Resume' }],
  podcast: [{ action: 'resume', title: 'Resume' }],
  schedule: [{ action: 'open', title: 'Open MyPro' }],
  medication: [{ action: 'open', title: 'Open MyPro' }],
};

self.addEventListener('push', (event) => {
  /* A push with no body still deserves to arrive — some push services send a
   * bare wake-up. Fall back to something truthful rather than dropping it. */
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { body: event.data.text() };
    }
  }

  const kind = payload.kind || null;
  const title = payload.title || 'MyPro';
  const body = payload.body || '';
  const actions = KIND_ACTIONS[kind] || [];

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/mypro-logo-light.png',
      badge: '/favicon.png',
      /* An optional artwork/cover enriches the expanded notification. */
      image: payload.image || undefined,
      /* Group by kind when there's no explicit id, so a second reading
       * reminder replaces the first rather than stacking; distinct ids stay
       * distinct. `renotify` lets an updated one re-alert. */
      tag: payload.id ? `mypro-${payload.id}` : kind ? `mypro-${kind}` : 'mypro',
      renotify: true,
      timestamp: payload.timestamp || Date.now(),
      actions,
      data: {
        deeplink: payload.deeplink || '/',
        /* Where "Resume" should land (falls back to the plain deeplink). */
        resumeDeeplink: payload.resumeDeeplink || payload.deeplink || '/',
        id: payload.id || null,
        kind,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  /* "Resume" uses the resume target; the body tap and "Open MyPro" use the
   * plain deeplink. */
  const deeplink =
    event.action === 'resume' ? data.resumeDeeplink || data.deeplink || '/' : data.deeplink || '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });

      /* Prefer focusing a tab that is already open — opening a second copy of
       * a single-page app loses whatever the user was in the middle of. */
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          /* The app listens for this and routes without a reload. */
          client.postMessage({ type: 'mypro:navigate', deeplink, action: event.action || null });
          return;
        }
      }
      await self.clients.openWindow(deeplink);
    })(),
  );
});
