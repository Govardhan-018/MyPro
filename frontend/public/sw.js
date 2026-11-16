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
