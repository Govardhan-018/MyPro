import { describe, it, expect, vi } from 'vitest';
import { createAuth, type AuthSession } from './auth';
import type { AuthStorage, EnvConfig } from './platform';

/**
 * Session durability (Feature: "mobile logs out too quickly").
 *
 * The old refresh wiped the session on *any* failure, so a single blink of no
 * signal at token-expiry time signed the user out for good. And in the native
 * WebView shell the web and native clients share one refresh token — if both
 * refreshed, Supabase's rotation would reject whichever went second. These
 * tests pin the two fixes: only a real rejection clears the session, and a
 * follower never refreshes.
 */

const env: EnvConfig = { apiUrl: 'https://api.test', agentUrl: '' };

function memStorage(): AuthStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** An already-expired session, so getAccessToken is forced down the refresh path. */
function expiredSession(): AuthSession {
  return {
    access_token: 'old-access',
    refresh_token: 'refresh-1',
    expires_at: Math.floor(Date.now() / 1000) - 10,
    user: { id: 'u1', email: 'a@b.c' },
  };
}

function seed(storage: AuthStorage, session: AuthSession) {
  void storage.setItem('mypro.session', JSON.stringify(session));
}

describe('auth refresh resilience', () => {
  it('keeps the session on a network error (transient), so a blink offline is not a logout', async () => {
    const storage = memStorage();
    seed(storage, expiredSession());
    const signedOut = vi.fn();
    const fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof globalThis.fetch;

    const auth = createAuth(env, { storage, fetch });
    auth.onAuthChange((s) => { if (s === null) signedOut(); });

    const token = await auth.getAccessToken();

    // No token to offer right now, but the session is untouched...
    expect(token).toBe('old-access');
    expect(signedOut).not.toHaveBeenCalled();
    expect(await auth.getSession()).not.toBeNull();
  });

  it('keeps the session on a 5xx (server asleep)', async () => {
    const storage = memStorage();
    seed(storage, expiredSession());
    const fetch = vi.fn().mockResolvedValue(
      new Response('', { status: 503 }),
    ) as unknown as typeof globalThis.fetch;

    const auth = createAuth(env, { storage, fetch });
    await auth.getAccessToken();

    expect(await auth.getSession()).not.toBeNull();
  });

  it('clears the session only on a real 401 (refresh token dead)', async () => {
    const storage = memStorage();
    seed(storage, expiredSession());
    const signedOut = vi.fn();
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'Session expired' }), { status: 401 }),
    ) as unknown as typeof globalThis.fetch;

    const auth = createAuth(env, { storage, fetch });
    auth.onAuthChange((s) => { if (s === null) signedOut(); });

    const token = await auth.getAccessToken();

    expect(token).toBeNull();
    expect(signedOut).toHaveBeenCalledTimes(1);
    expect(await auth.getSession()).toBeNull();
  });

  it('refreshes and stores the new session on success', async () => {
    const storage = memStorage();
    seed(storage, expiredSession());
    const next: AuthSession = {
      access_token: 'new-access',
      refresh_token: 'refresh-2',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u1', email: 'a@b.c' },
    };
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ session: next }), { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const auth = createAuth(env, { storage, fetch });
    const token = await auth.getAccessToken();

    expect(token).toBe('new-access');
    expect((await auth.getSession())?.refresh_token).toBe('refresh-2');
  });
});

describe('follower mode (native WebView shell)', () => {
  it('never calls /auth/refresh, and hands back its stored token', async () => {
    const storage = memStorage();
    seed(storage, expiredSession());
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;

    const auth = createAuth(env, { storage, fetch, refreshMode: 'follower' });
    const token = await auth.getAccessToken();

    expect(fetch).not.toHaveBeenCalled();
    expect(token).toBe('old-access');
    expect(await auth.getSession()).not.toBeNull();
  });

  it('adopts a session posted to setSession', async () => {
    const storage = memStorage();
    const auth = createAuth(env, { storage, refreshMode: 'follower' });
    const posted: AuthSession = {
      access_token: 'from-web',
      refresh_token: 'r',
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 'u1', email: 'a@b.c' },
    };
    await auth.setSession(posted);
    expect(await auth.getAccessToken()).toBe('from-web');
  });
});
