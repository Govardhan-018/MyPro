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
  /** Fresh access token (refreshes through Render if the current one expired). */
  getAccessToken(): Promise<string | null>;
  signInWithPassword(email: string, password: string): Promise<AuthSession | null>;
  /** Returns null when the project requires email confirmation. */
  signUpWithPassword(email: string, password: string): Promise<AuthSession | null>;
  /** Not available in the thin-client model yet; throws a friendly message. */
  signInWithOAuth(provider: 'google' | 'apple'): Promise<void>;
  signOut(): Promise<void>;
  onAuthChange(cb: (session: AuthSession | null) => void): () => void;
}

export interface AuthOptions {
  storage?: AuthStorage;
  fetch?: typeof fetch;
}

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
  const listeners = new Set<(session: AuthSession | null) => void>();

  let cached: AuthSession | null | undefined;
  let refreshing: Promise<AuthSession | null> | null = null;

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
    const parsed: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) {
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

  async function refresh(session: AuthSession): Promise<AuthSession | null> {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        const out = await post('/auth/refresh', { refresh_token: session.refresh_token });
        await save(out.session);
        return out.session;
      } catch {
        await save(null);
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
    async getAccessToken() {
      const session = await load();
      if (!session) return null;
      if (isExpired(session)) {
        const next = await refresh(session);
        return next?.access_token ?? null;
      }
      return session.access_token;
    },
    async signInWithPassword(email, password) {
      const out = await post('/auth/login', { email, password });
      await save(out.session);
      return out.session;
    },
    async signUpWithPassword(email, password) {
      const out = await post('/auth/signup', { email, password });
      if (out.session) await save(out.session);
      return out.session;
    },
    async signInWithOAuth() {
      throw new Error('Social sign-in is not available yet — use email and password.');
    },
    async signOut() {
      await save(null);
    },
    onAuthChange(cb) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
  };
}
