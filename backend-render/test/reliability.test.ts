import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Reliability audit — Render's side.
 *
 *  - Session: a Supabase *outage* during refresh must not be reported as a dead
 *    session (it used to be a 401 → every client signed out on a hiccup).
 *  - Scheduler: the phone arms only "Remind me"; an AI message / email never
 *    pings at the minute claiming something happened. One-offs in the past and
 *    empty AI/email schedules are refused with a reason.
 *  - Gmail: the OAuth state carries where to return (web vs app), signed; the
 *    app-return page cannot be used to inject markup.
 */

beforeAll(() => {
  // The minimum env() needs, for the services that sign OAuth state.
  Object.assign(process.env, {
    CORS_ORIGINS: 'https://app.test',
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
    SUPABASE_SECRET_KEY: 'sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxx',
    INTERNAL_SERVICE_TOKEN: 'x'.repeat(40),
    TOKEN_ENCRYPTION_KEY: 'y'.repeat(64),
  });
});

describe('auth refresh classification', async () => {
  const { refreshErrorIsFatal } = await import('../src/auth/auth.module');

  it('an invalid/revoked refresh token is fatal (401 → sign in again)', () => {
    expect(refreshErrorIsFatal({ status: 400, name: 'AuthApiError' })).toBe(true);
    expect(refreshErrorIsFatal({ status: 401, name: 'AuthApiError' })).toBe(true);
  });

  it('Supabase unreachable or erroring is transient (503 → keep the session)', () => {
    expect(refreshErrorIsFatal({ status: 0, name: 'AuthRetryableFetchError' })).toBe(false);
    expect(refreshErrorIsFatal({ status: 502, name: 'AuthRetryableFetchError' })).toBe(false);
    expect(refreshErrorIsFatal({ status: 500, name: 'AuthApiError' })).toBe(false);
    expect(refreshErrorIsFatal({ name: 'AuthUnknownError' })).toBe(false);
  });
});

describe('scheduler rules on write', async () => {
  const { armsOnPhone, contentProblem, oneOffInPast } = await import(
    '../src/schedules/schedules.service'
  );

  it('the phone arms reminders (and the legacy brief) only', () => {
    expect(armsOnPhone('notify')).toBe(true);
    expect(armsOnPhone('report')).toBe(true);
    expect(armsOnPhone('chat_message')).toBe(false);
    expect(armsOnPhone('email')).toBe(false);
  });

  it('refuses a one-off whose time has passed, tolerating a minute of clock skew', () => {
    const now = Date.parse('2026-11-24T10:00:00Z');
    expect(oneOffInPast({ recurrence: 'once', run_at: '2026-11-24T09:00:00Z' }, now)).toBe(true);
    expect(oneOffInPast({ recurrence: 'once', run_at: '2026-11-24T09:59:30Z' }, now)).toBe(false);
    expect(oneOffInPast({ recurrence: 'once', run_at: '2026-11-24T11:00:00Z' }, now)).toBe(false);
    expect(oneOffInPast({ recurrence: 'daily' }, now)).toBe(false);
  });

  it('an AI message needs instructions; an email needs a valid address and instructions', () => {
    expect(contentProblem({ action_type: 'chat_message', action_payload: {} })).toMatch(/AI/);
    expect(contentProblem({ action_type: 'chat_message', action_payload: { prompt: 'news' } })).toBeNull();
    expect(contentProblem({ action_type: 'email', action_payload: { to: 'nope', prompt: 'hi' } })).toMatch(
      /email address/,
    );
    expect(contentProblem({ action_type: 'email', action_payload: { to: 'a@b.co' } })).toMatch(/say/);
    expect(
      contentProblem({ action_type: 'email', action_payload: { to: 'a@b.co', prompt: 'thanks' } }),
    ).toBeNull();
    // A reminder can always fall back to its name — legacy rows stay editable.
    expect(contentProblem({ action_type: 'notify', action_payload: {} })).toBeNull();
  });
});

describe('Gmail connect returns to where it started', async () => {
  const { GoogleOAuthService } = await import('../src/gmail/google-oauth.service');
  const { appReturnPage } = await import('../src/gmail/gmail.module');
  const oauth = new GoogleOAuthService();

  it('the signed state round-trips the user and the return target', () => {
    expect(oauth.verifyState(oauth.signState('u1', 'app'))).toEqual({ userId: 'u1', returnTo: 'app' });
    expect(oauth.verifyState(oauth.signState('u1'))).toEqual({ userId: 'u1', returnTo: 'web' });
  });

  it('a tampered state is rejected (the return target cannot be flipped)', () => {
    const state = oauth.signState('u1', 'web');
    const [encoded, sig] = state.split('.');
    const flipped = Buffer.from(
      Buffer.from(encoded, 'base64url').toString('utf8').replace(/web$/, 'app'),
    ).toString('base64url');
    expect(oauth.verifyState(`${flipped}.${sig}`)).toBeNull();
  });

  it('the consent URL carries the server-owned redirect, never one from the client', () => {
    const url = new URL(
      oauth.authUrl(
        { clientId: 'cid', clientSecret: 's', redirectUri: 'https://api.test/api/v1/gmail/callback' },
        'u1',
        'send',
        'app',
      ),
    );
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.test/api/v1/gmail/callback');
    expect(url.searchParams.get('scope')).toContain('gmail.send');
  });

  it('the app-return page escapes what it is given', () => {
    const html = appReturnPage('gmail=connected&email=%22%3E%3Cscript%3E');
    expect(html).toContain('mypro://gmail?gmail=connected&amp;email=');
    expect(html).not.toMatch(/<script/i);
    const injected = appReturnPage('x="><script>alert(1)</script>');
    expect(injected).not.toContain('<script>');
  });
});

describe('the core announces its own API address', async () => {
  const { selfApiUrl } = await import('../src/nodes/node-status.service');
  it('from Render’s RENDER_EXTERNAL_URL, with the /api/v1 prefix', () => {
    expect(selfApiUrl({ RENDER_EXTERNAL_URL: 'https://mypro-km2k.onrender.com' })).toBe(
      'https://mypro-km2k.onrender.com/api/v1',
    );
  });
  it('PUBLIC_API_URL wins, tolerating a trailing prefix or slash', () => {
    expect(selfApiUrl({ PUBLIC_API_URL: 'https://api.example.com/api/v1/', RENDER_EXTERNAL_URL: 'https://x.onrender.com' })).toBe(
      'https://api.example.com/api/v1',
    );
  });
  it('unknown when neither is set', () => {
    expect(selfApiUrl({})).toBeNull();
  });
});
