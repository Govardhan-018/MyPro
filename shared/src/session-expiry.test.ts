import { describe, it, expect, vi } from 'vitest';
import { createAuth, type AuthSession } from './auth';
import { createApi, ApiError } from './api';
import type { AuthStorage, EnvConfig } from './platform';

/**
 * Session expiry, detected centrally (session-management audit).
 *
 * Before: the API layer ignored a 401 entirely, so a token the server rejected
 * (revoked on another device, `expires_at` unknown, clock skew) left the user
 * on an authenticated screen where every call failed and nothing redirected.
 */

const env: EnvConfig = { apiUrl: 'https://api.test', agentUrl: '' };
const KEY = 'mypro.session';

function memStorage(): AuthStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    getItem: (k) => raw.get(k) ?? null,
    setItem: (k, v) => void raw.set(k, v),
    removeItem: (k) => void raw.delete(k),
  };
}

function session(access: string, refresh: string, expiresInS = 3600): AuthSession {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: Math.floor(Date.now() / 1000) + expiresInS,
    user: { id: 'u1', email: 'a@b.c' },
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fake Render: `/auth/refresh` per `refresh`, everything else per `api`. */
function fakeServer(handlers: {
  refresh: (token: string) => Response;
  api: (bearer: string, url: string) => Response;
}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/refresh')) {
      const { refresh_token } = JSON.parse(String(init?.body)) as { refresh_token: string };
      return handlers.refresh(refresh_token);
    }
    if (url.endsWith('/auth/logout')) return new Response(null, { status: 204 });
    const bearer = String((init?.headers as Record<string, string>).Authorization).slice(7);
    return handlers.api(bearer, url);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe('central 401 handling', () => {
  it('refreshes once on a 401 and retries the request with the new token', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a1', 'r1')));
    const fetch = fakeServer({
      refresh: () => json(200, { session: session('a2', 'r2') }),
      api: (bearer) => (bearer === 'a2' ? json(200, { ok: true }) : json(401, { message: 'Invalid token' })),
    });
    const auth = createAuth(env, { storage, fetch });
    const { api } = createApi(env, auth, fetch);

    await expect(api.profile.get()).resolves.toEqual({ ok: true });
    expect((await auth.getSession())?.access_token).toBe('a2');
  });

  it('a dead refresh token clears the session and fires the expiry event exactly once', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a1', 'r1')));
    const fetch = fakeServer({
      refresh: () => json(401, { message: 'Session expired' }),
      api: () => json(401, { message: 'Invalid token' }),
    });
    const auth = createAuth(env, { storage, fetch });
    const expired = vi.fn();
    auth.onSessionExpired(expired);
    const { api } = createApi(env, auth, fetch);

    // Five screens load at once after the app resumes.
    const results = await Promise.allSettled([
      api.profile.get(),
      api.library.list(),
      api.schedules.list(),
      api.notifications.list(),
      api.profile.get(),
    ]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    for (const r of results) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(ApiError);
      expect(((r as PromiseRejectedResult).reason as ApiError).status).toBe(401);
    }
    expect(expired).toHaveBeenCalledTimes(1);
    expect(await auth.getSession()).toBeNull();
    expect(storage.raw.has(KEY)).toBe(false);
    // Only one refresh round-trip for all five concurrent 401s.
    const refreshCalls = fetch.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('after expiry no request reaches the network until the user signs in again', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a1', 'r1')));
    const fetch = fakeServer({
      refresh: () => json(401, {}),
      api: () => json(401, {}),
    });
    const auth = createAuth(env, { storage, fetch });
    const { api } = createApi(env, auth, fetch);
    await api.profile.get().catch(() => undefined);
    const before = fetch.mock.calls.length;

    await expect(api.library.list()).rejects.toMatchObject({ status: 401 });
    expect(fetch.mock.calls.length).toBe(before);
  });

  it('a transient refresh failure keeps the session and reports a connection problem, not a logout', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a1', 'r1')));
    const fetch = fakeServer({
      refresh: () => json(503, {}),
      api: () => json(401, {}),
    });
    const auth = createAuth(env, { storage, fetch });
    const expired = vi.fn();
    auth.onSessionExpired(expired);
    const { api } = createApi(env, auth, fetch);

    await expect(api.profile.get()).rejects.toMatchObject({ status: 503 });
    expect(expired).not.toHaveBeenCalled();
    expect(await auth.getSession()).not.toBeNull();
  });

  it('a 401 on a token another request already replaced retries without refreshing again', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a2', 'r2')));
    const fetch = fakeServer({
      refresh: () => json(500, {}),
      api: () => json(200, {}),
    });
    const auth = createAuth(env, { storage, fetch });
    await auth.getSession();
    await expect(auth.handleUnauthorized('a1')).resolves.toBe('a2');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('an explicit sign-out is not reported as an expiry, and revokes server-side', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a1', 'r1')));
    const fetch = fakeServer({ refresh: () => json(200, {}), api: () => json(200, {}) });
    const auth = createAuth(env, { storage, fetch });
    const expired = vi.fn();
    auth.onSessionExpired(expired);
    await auth.signOut();
    expect(expired).not.toHaveBeenCalled();
    expect(await auth.getSession()).toBeNull();
    expect(fetch.mock.calls.some(([u]) => String(u).endsWith('/auth/logout'))).toBe(true);
  });
});

describe('refresh races', () => {
  it('a refresh still in flight when the user signs out does not resurrect the session', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a1', 'r1', -10)));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/auth/refresh')) {
        await gate;
        return json(200, { session: session('a2', 'r2') });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof globalThis.fetch;
    const auth = createAuth(env, { storage, fetch });

    const pending = auth.getAccessToken();
    await new Promise((r) => setTimeout(r, 0));
    await auth.signOut();
    release();
    await pending;

    expect(await auth.getSession()).toBeNull();
    expect(storage.raw.has(KEY)).toBe(false);
  });

  it('adopts a session another tab already rotated instead of reusing the stale refresh token', async () => {
    const storage = memStorage();
    storage.setItem(KEY, JSON.stringify(session('a1', 'r1', -10)));
    const fetch = vi.fn(async () => json(401, {})) as unknown as typeof globalThis.fetch;
    const auth = createAuth(env, { storage, fetch });
    await auth.getSession(); // this tab caches r1

    // Another tab refreshed: storage now holds a fresh, rotated session.
    storage.setItem(KEY, JSON.stringify(session('b2', 'r2')));

    await expect(auth.getAccessToken()).resolves.toBe('b2');
    expect(fetch).not.toHaveBeenCalled();
  });
});
