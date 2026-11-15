/*
 * MyPro service worker — Web Push (Phase 6.2).
 *
 * This exists for exactly one reason: to receive a notification when no tab
 * is open. Supabase Realtime already covers the app while you are looking at
 * it; this is the half that reaches a closed browser.
 *
 * Deliberately not a caching service worker. Caching the app shell would mean
 * reasoning about stale bundles on every Vercel deploy, and offline reading is
 * already solved where it matters (the reader keeps extracted PDF text in
 * IndexedDB). Adding a cache here would buy a new class of bug for nothing.
 */

/* Take over without waiting for every tab to close, so a fresh deploy's
 * worker is the one handling pushes. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

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

  const title = payload.title || 'MyPro';
  const body = payload.body || '';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/mypro-logo-light.png',
      badge: '/favicon.png',
      /* Same tag ⇒ a replaced notification rather than a stack of five.
       * The id keeps distinct notifications distinct. */
      tag: payload.id ? `mypro-${payload.id}` : 'mypro',
      data: {
        deeplink: payload.deeplink || '/',
        id: payload.id || null,
        kind: payload.kind || null,
      },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const deeplink = (event.notification.data && event.notification.data.deeplink) || '/';

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
          client.postMessage({ type: 'mypro:navigate', deeplink });
          return;
        }
      }
      await self.clients.openWindow(deeplink);
    })(),
  );
});
