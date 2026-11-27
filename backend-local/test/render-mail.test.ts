import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { RenderMailService } from '../src/gmail/render-mail.service';
import { forgetRenderApiBase } from '../src/common/render-api';

/**
 * The agent → core hop for sending mail (where "Render refused the send
 * (404)" came from). Real RenderMailService; the core's HTTP endpoint is
 * captured. Checks the address it calls, the secret it sends, and how each
 * kind of failure is classified (retry / don't / may have sent).
 */

beforeAll(() => {
  Object.assign(process.env, {
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
    SUPABASE_SECRET_KEY: 'sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxx',
    INTERNAL_SERVICE_TOKEN: 's'.repeat(40),
    RENDER_API_URL: 'https://wrong-service.onrender.com',
    GROQ_API_KEY: 'gsk_test_xxxxxxxxxxxx',
    CORS_ORIGINS: 'https://app.test',
  });
});
beforeEach(() => forgetRenderApiBase());
afterEach(() => vi.unstubAllGlobals());

/** The core announced itself at its real address. */
const supabase = {
  admin: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { detail: { api_url: 'https://mypro-km2k.onrender.com/api/v1' } } }),
        }),
      }),
    }),
  },
} as never;

const request = { userId: 'u1', to: 'govardhanhegde05@gmail.com', subject: 'Hi', body: 'Text' };

function core(handler: () => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return handler();
    }),
  );
  return calls;
}

describe('RenderMailService.send', () => {
  it('calls the core at the address it announced (not the misconfigured env), with the secret', async () => {
    const calls = core(() => new Response(JSON.stringify({ ok: true, id: 'gm1', from: 'me@gmail.com' })));
    const out = await new RenderMailService(supabase).send(request);
    expect(out).toEqual({ ok: true, id: 'gm1', from: 'me@gmail.com' });
    expect(calls[0].url).toBe('https://mypro-km2k.onrender.com/api/v1/internal/gmail/send');
    expect(calls[0].headers['x-internal-token']).toBe('s'.repeat(40));
    expect(calls[0].body).toEqual({ user_id: 'u1', to: request.to, subject: 'Hi', body: 'Text' });
  });

  it('a refusal carries the core’s own message and is not retried', async () => {
    core(() => new Response(JSON.stringify({ message: 'me@gmail.com is connected read-only.' }), { status: 400 }));
    expect(await new RenderMailService(supabase).send(request)).toEqual({
      ok: false,
      reason: 'me@gmail.com is connected read-only.',
      retryable: false,
    });
  });

  it('an edge 404 names the host and is safe to retry (nothing was sent)', async () => {
    core(() => new Response('Not Found', { status: 404 }));
    const out = await new RenderMailService(supabase).send(request);
    expect(out).toMatchObject({ ok: false, retryable: true });
    expect((out as { reason: string }).reason).toMatch(/mypro-km2k\.onrender\.com answered 404/);
  });

  it('a waking server (503) is retryable; a connection that failed outright too', async () => {
    core(() => new Response('', { status: 503 }));
    expect(await new RenderMailService(supabase).send(request)).toMatchObject({ ok: false, retryable: true });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    expect(await new RenderMailService(supabase).send(request)).toMatchObject({
      ok: false,
      retryable: true,
      ambiguous: false,
    });
  });

  it('a timeout may have sent: flagged ambiguous, never retried', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))),
    );
    expect(await new RenderMailService(supabase).send(request)).toMatchObject({
      ok: false,
      retryable: false,
      ambiguous: true,
    });
  });
});
