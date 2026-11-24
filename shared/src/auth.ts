import type { AuthStorage, EnvConfig } from './platform';

/**
 * Thin-client auth. The client holds no Supabase credentials — it posts
 * email/password to Render's `/auth/*` broker, stores the returned session, and
 * sends the access token as the Bearer on every render + agent call. Tokens are
 * refreshed through Render when they near expiry. The session is persisted via
 * the platform storage adapter (localStorage on web, AsyncStorage on RN).
 */

export interface AuthUser {
  id: string;
  email: string | null;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  /** Unix seconds; null when unknown. */
  expires_at: number | null;
  user: AuthUser;
}

export interface Auth {
  getSession(): Promise<AuthSession | null>;
  /**
   * Adopt a session minted elsewhere, persisting it and notifying listeners.
   *
   * The native WebView shell signs in *inside the web app*, then posts the
   * resulting session out to the shell; the shell hands it here so the native
   * client (which arms the clock and registers for push) carries a live token
   * without a second login. Passing null clears the session, same as signOut.
   */
  setSession(session: AuthSession | null): Promise<void>;
  /** Fresh access token (refreshes through Render if the current one expired). */
  getAccessToken(): Promise<string | null>;
  signInWithPassword(email: string, password: string): Promise<AuthSession | null>;
  /** Returns null when the project requires email confirmation. */
  signUpWithPassword(email: string, password: string): Promise<AuthSession | null>;
  /** Not available in the thin-client model yet; throws a friendly message. */
  signInWithOAuth(provider: 'google' | 'apple'): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (session: AuthSession | null) => void): () => void;
  /**
   * Central recovery for a request the server answered 401.
   *
   * `usedToken` is the bearer that was rejected. If another request has
   * already refreshed past it, the current token is returned without a second
   * round-trip; otherwise one (shared) refresh is attempted. Returns the token
   * to retry with, or null when the session is gone — in which case the
   * session has been cleared and {@link onSessionExpired} listeners fired
   * exactly once.
   */
  handleUnauthorized(usedToken: string): Promise<string | null>;
  /**
   * Fired once when a session ends *involuntarily* (refresh token rejected),
   * never on an explicit sign-out — so the UI can say "your session expired"
   * rather than silently dropping the user on the sign-in page.
   */
  onSessionExpired(cb: () => void): () => void;
}

export interface AuthOptions {
  storage?: AuthStorage;
  fetch?: typeof fetch;
  /**
   * How this client keeps the token fresh.
   *
   *  - `'self'` (default) — the client refreshes through Render when the access
   *    token nears expiry. This is the web app and a standalone phone build.
   *  - `'follower'` — the client never calls `/auth/refresh` itself. It only
   *    uses sessions handed to it via `setSession`. The native WebView shell is
   *    a follower: the web app it hosts owns the single refresh loop and posts
   *    each fresh session out (`frontend/src/lib/shell.ts`). If *both* clients
   *    refreshed, they would race on the same refresh token — Supabase rotates
   *    it, so whichever refreshed second would be rejected and sign the user
   *    out. One refresher, posted outward, is what keeps the session alive.
   */
  refreshMode?: 'self' | 'follower';
  /**
   * Revoke the server-side session on sign-out (`POST /auth/logout`). Default
   * true. Followers never revoke: the primary owns the session.
   */
  revokeOnSignOut?: boolean;
}

/** A refresh attempt's outcome, so a transient failure never clears a session. */
type RefreshResult =
  | { kind: 'ok'; session: AuthSession }
  /** Render/Supabase explicitly rejected the refresh token — it is dead. */
  | { kind: 'invalid' }
  /** Network down, server asleep, 5xx — the token may still be good later. */
  | { kind: 'transient' };

const STORAGE_KEY = 'mypro.session';
const REFRESH_SKEW_MS = 60_000;

function memoryStorage(): AuthStorage {
  const store = new Map<string, string>();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
  };
}

export function createAuth(env: EnvConfig, opts: AuthOptions = {}): Auth {
  const doFetch: typeof fetch =
    opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const storage = opts.storage ?? memoryStorage();
  const refreshMode = opts.refreshMode ?? 'self';
  const revokeOnSignOut = opts.revokeOnSignOut ?? true;
  const listeners = new Set<(session: AuthSession | null) => void>();

  const expiredListeners = new Set<() => void>();

  let cached: AuthSession | null | undefined;
  let refreshing: Promise<AuthSession | null> | null = null;
  /**
   * Bumped on every sign-in, sign-out and adopted session. A refresh that
   * started under an older epoch must not write its result: otherwise a
   * refresh in flight when the user signs out *resurrects* the session, and a
   * late "invalid" from a previous session signs out the new one.
   */
  let epoch = 0;

  async function load(): Promise<AuthSession | null> {
    if (cached !== undefined) return cached;
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      cached = raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      cached = null;
    }
    return cached;
  }

  /** Re-read the stored session, bypassing the in-memory cache. */
  async function readStored(): Promise<AuthSession | null> {
    try {
      const raw = await storage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as AuthSession) : null;
    } catch {
      return null;
    }
  }

  async function save(session: AuthSession | null): Promise<void> {
    cached = session;
    try {
      if (session) await storage.setItem(STORAGE_KEY, JSON.stringify(session));
      else await storage.removeItem(STORAGE_KEY);
    } catch {
      /* storage can be unavailable (private mode); keep the in-memory cache */
    }
    for (const listener of listeners) listener(session);
  }

  function isExpired(session: AuthSession): boolean {
    if (!session.expires_at) return false;
    return Date.now() >= session.expires_at * 1000 - REFRESH_SKEW_MS;
  }

  async function post(
    path: string,
    body: unknown,
  ): Promise<{ session: AuthSession | null; needs_confirmation?: boolean }> {
    const res = await doFetch(`${env.apiUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // An HTML error page from a waking Render instance or a proxy.
      if (res.ok) throw new Error('The server sent an unreadable response. Try again.');
    }
    if (!res.ok) {
      if (res.status >= 502 && res.status <= 504) {
        throw new Error('The server is waking up — try again in a few seconds.');
      }
      const message =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message: unknown }).message)
          : `Request failed (${res.status})`;
      throw new Error(message);
    }
    return (parsed ?? { session: null }) as {
      session: AuthSession | null;
      needs_confirmation?: boolean;
    };
  }

  /**
   * One refresh round-trip, classified so the caller can tell a dead token
   * (sign out) from a flaky network (keep the session, try again later).
   *
   * Render answers 401 when the refresh token itself is rejected; anything else
   * — offline, a cold Render instance, a 5xx — is transient, and clearing the
   * session on it is exactly the "logged out after a blink of no signal" bug.
   */
  async function refreshRequest(refreshToken: string): Promise<RefreshResult> {
    let res: Response;
    try {
      res = await doFetch(`${env.apiUrl}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
    } catch {
      return { kind: 'transient' };
    }
    if (res.status === 401 || res.status === 400 || res.status === 403) {
      return { kind: 'invalid' };
    }
    if (!res.ok) return { kind: 'transient' };
    try {
      const text = await res.text();
      const parsed = (text ? JSON.parse(text) : null) as { session?: AuthSession | null } | null;
      if (parsed?.session) return { kind: 'ok', session: parsed.session };
      return { kind: 'transient' };
    } catch {
      return { kind: 'transient' };
    }
  }

  /** Clear an involuntarily-ended session and tell the UI, exactly once. */
  async function expire(): Promise<void> {
    const hadSession = Boolean(await load());
    epoch += 1;
    await save(null);
    if (hadSession) for (const listener of expiredListeners) listener();
  }

  async function refresh(session: AuthSession): Promise<AuthSession | null> {
    // A follower never refreshes — it rides on sessions posted to setSession,
    // so it can't rotate the shared refresh token out from under the primary.
    if (refreshMode === 'follower') return session;
    if (refreshing) return refreshing;
    const startedAt = epoch;
    refreshing = (async () => {
      try {
        // Another tab (same localStorage) may already have rotated the
        // refresh token. Supabase treats reuse of a rotated token as theft and
        // revokes the whole session family, so adopt the newer stored session
        // instead of refreshing with the stale one we hold in memory.
        const stored = await readStored();
        if (
          stored &&
          stored.refresh_token !== session.refresh_token &&
          stored.user?.id === session.user?.id
        ) {
          cached = stored;
          if (!isExpired(stored)) return stored;
          session = stored;
        }

        const result = await refreshRequest(session.refresh_token);
        // Signed out / signed in as someone else meanwhile: drop the result.
        if (epoch !== startedAt) return (await load()) ?? null;
        if (result.kind === 'ok') {
          await save(result.session);
          return result.session;
        }
        if (result.kind === 'invalid') {
          await expire();
          return null;
        }
        // Transient: keep the stored session untouched so a later call can try
        // again once connectivity returns.
        return null;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  return {
    async getSession() {
      return (await load()) ?? null;
    },
    async setSession(session) {
      epoch += 1;
      await save(session);
    },
    async getAccessToken() {
      const session = await load();
      if (!session) return null;
      if (isExpired(session)) {
        // A follower does not refresh. Hand back whatever token it was last
        // given: usually the primary has already posted a fresh one, and if
        // not, a 401 on the call is caught by the caller (e.g. the clock's
        // arm loop) far more gracefully than signing the user out here would be.
        if (refreshMode === 'follower') return session.access_token;
        const next = await refresh(session);
        if (next) return next.access_token;
        // Refresh failed. If it cleared the session (a real rejection) the
        // cache is now null and we must report "no token". If the session
        // survived (a transient failure), hand back the stale token: the call
        // 401s and the caller recovers, which beats signing the user out.
        const surviving = await load();
        return surviving ? surviving.access_token : null;
      }
      return session.access_token;
    },
    async signInWithPassword(email, password) {
      const out = await post('/auth/login', { email, password });
      epoch += 1;
      await save(out.session);
      return out.session;
    },
    async signUpWithPassword(email, password) {
      const out = await post('/auth/signup', { email, password });
      if (out.session) {
        epoch += 1;
        await save(out.session);
      }
      return out.session;
    },
    async signInWithOAuth() {
      throw new Error('Social sign-in is not available yet — use email and password.');
    },
    async signOut() {
      const current = await load();
      epoch += 1;
      // Clear locally first: sign-out must never wait on (or fail because of)
      // the network. The server-side revoke is best effort.
      await save(null);
      if (current && revokeOnSignOut && refreshMode === 'self') {
        void doFetch(`${env.apiUrl}/auth/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${current.access_token}`,
          },
          body: JSON.stringify({ refresh_token: current.refresh_token }),
        }).catch(() => undefined);
      }
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    async handleUnauthorized(usedToken) {
      const session = await load();
      if (!session) return null;
      // Someone already refreshed past the rejected token: just retry.
      if (session.access_token !== usedToken) return session.access_token;
      // A follower cannot refresh; the primary will post a fresh session.
      if (refreshMode === 'follower') return null;
      const next = await refresh(session);
      return next ? next.access_token : null;
    },
    onSessionExpired(cb) {
      expiredListeners.add(cb);
      return () => void expiredListeners.delete(cb);
    },
  };
}
