import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';

/**
 * Email sending, end to end on the server — everything real except Supabase
 * (in memory) and Google's HTTP endpoint (captured). The test decodes the
 * exact bytes Gmail's `messages.send` would receive.
 *
 * The bugs this pins: non-ASCII subjects (an AI-written "—", "’", emoji,
 * Indian scripts) were sent unencoded and arrived as mojibake; the body had no
 * transfer encoding; and every Gmail failure read "Gmail request failed (400)".
 */

beforeAll(() => {
  Object.assign(process.env, {
    CORS_ORIGINS: 'https://app.test',
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
    SUPABASE_SECRET_KEY: 'sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxx',
    INTERNAL_SERVICE_TOKEN: 'x'.repeat(40),
    TOKEN_ENCRYPTION_KEY: 'k'.repeat(64),
  });
});

afterEach(() => vi.unstubAllGlobals());

const SEND = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

/** Decode a base64url RFC 2822 message into headers + decoded body text. */
function decodeRaw(raw: string) {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const [head, ...rest] = text.split('\r\n\r\n');
  const headers: Record<string, string> = {};
  for (const line of head.replace(/\r\n /g, ' ').split('\r\n')) {
    const i = line.indexOf(':');
    headers[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  const decodeWords = (v: string) =>
    v.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_, b64) => Buffer.from(b64, 'base64').toString('utf8'));
  const body = Buffer.from(rest.join('\r\n\r\n').replace(/\r\n/g, ''), 'base64').toString('utf8');
  return { text, headers, subject: decodeWords(headers.Subject ?? ''), body };
}

async function build(scopes = SEND) {
  const { CryptoService } = await import('../src/common/crypto.service');
  const { GmailApiService } = await import('../src/gmail/gmail-api.service');
  const { GmailService } = await import('../src/gmail/gmail.module');
  const crypto = new CryptoService();
  const account = {
    id: 'acc1',
    user_id: 'u1',
    email: 'me@gmail.com',
    scopes,
    access_token_enc: crypto.encrypt('live-access-token'),
    refresh_token_enc: crypto.encrypt('refresh'),
    token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    history_id: null,
    created_at: '2026-11-01T00:00:00Z',
  };
  const query = () => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: account, error: null });
    q.then = (resolve: (v: unknown) => void) => resolve({ data: [account], error: null });
    return q;
  };
  const supabase = { admin: { from: query } } as never;
  const audit = { record: vi.fn(async () => undefined) };
  const api = new GmailApiService(supabase, crypto, {} as never, {} as never);
  const service = new GmailService(supabase, crypto, {} as never, {} as never, api, {} as never, audit as never);
  return { service, audit };
}

function captureGmail(response: { status: number; body: unknown }) {
  const calls: { url: string; auth: string; raw?: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url,
        auth: String((init.headers as Record<string, string>).Authorization),
        raw: init.body ? (JSON.parse(String(init.body)) as { raw?: string }).raw : undefined,
      });
      return new Response(JSON.stringify(response.body), { status: response.status });
    }),
  );
  return calls;
}

describe('test email — the real send path, approval bypassed', () => {
  it('sends to your own mailbox through Gmail messages.send, correctly encoded', async () => {
    const { service, audit } = await build();
    const calls = captureGmail({ status: 200, body: { id: 'gmail-msg-123' } });

    const result = await service.testSend({ id: 'u1', token: 't' } as never);

    expect(result).toEqual({ ok: true, id: 'gmail-msg-123', from: 'me@gmail.com' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(calls[0].auth).toBe('Bearer live-access-token'); // decrypted from storage
    const mail = decodeRaw(calls[0].raw!);
    expect(mail.headers.To).toBe('me@gmail.com');
    expect(mail.headers.From).toBe('me@gmail.com');
    expect(mail.subject).toBe('MyPro test email — sending works ✓');
    expect(mail.headers['Content-Transfer-Encoding']).toBe('base64');
    expect(mail.body).toContain('नमस्ते · ನಮಸ್ಕಾರ · café — “quotes” ✓');
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'email.send' }));
  });

  it('sends to another address when given one', async () => {
    const { service } = await build();
    const calls = captureGmail({ status: 200, body: { id: 'm2' } });
    await service.testSend({ id: 'u1', token: 't' } as never, 'govardhanhegde05@gmail.com');
    expect(decodeRaw(calls[0].raw!).headers.To).toBe('govardhanhegde05@gmail.com');
  });

  it('a read-only mailbox is refused before Gmail is called, with the fix', async () => {
    const { service } = await build('https://www.googleapis.com/auth/gmail.readonly');
    const calls = captureGmail({ status: 200, body: { id: 'x' } });
    await expect(service.testSend({ id: 'u1', token: 't' } as never)).rejects.toThrow(/read-only.*Read & send/);
    expect(calls).toHaveLength(0);
  });

  it('Gmail’s own reason comes back instead of a bare status code', async () => {
    const { service } = await build();
    captureGmail({ status: 400, body: { error: { message: 'Invalid To header' } } });
    await expect(service.testSend({ id: 'u1', token: 't' } as never, 'x@y.co')).rejects.toThrow(
      /Invalid To header/,
    );
  });

  it('missing send permission at Google says to reconnect with "Read & send"', async () => {
    const { service } = await build();
    captureGmail({ status: 403, body: { error: { message: 'Request had insufficient authentication scopes.' } } });
    await expect(service.testSend({ id: 'u1', token: 't' } as never)).rejects.toThrow(/Read & send/);
  });

  it('a revoked sign-in says the mailbox needs reconnecting', async () => {
    const { service } = await build();
    captureGmail({ status: 401, body: { error: { message: 'Invalid Credentials' } } });
    await expect(service.testSend({ id: 'u1', token: 't' } as never)).rejects.toThrow(/needs reconnecting/);
  });
});

describe('buildRawMessage', () => {
  it('encodes non-ASCII subjects (RFC 2047) and survives a round trip', async () => {
    const { buildRawMessage } = await import('../src/gmail/gmail-api.service');
    const subject = 'Re: Plan for Friday — let’s meet ☕ (ಶುಕ್ರವಾರ)';
    const body = 'Hi Priya,\nLine two.\n\n— Govardhan 🙏';
    const mail = decodeRaw(buildRawMessage({ to: 'a@b.co', subject, body }));
    expect(mail.subject).toBe(subject);
    expect(mail.body).toBe(body.replace(/\n/g, '\r\n'));
    // Every encoded-word stays within RFC 2047's 75-character limit.
    for (const word of mail.headers.Subject.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? []) {
      expect(word.length).toBeLessThanOrEqual(75);
    }
  });

  it('plain ASCII subjects stay readable', async () => {
    const { buildRawMessage } = await import('../src/gmail/gmail-api.service');
    expect(decodeRaw(buildRawMessage({ to: 'a@b.co', subject: 'Hello there', body: 'x' })).headers.Subject).toBe(
      'Hello there',
    );
  });

  it('a newline in a subject cannot inject a Bcc header', async () => {
    const { buildRawMessage } = await import('../src/gmail/gmail-api.service');
    const mail = decodeRaw(buildRawMessage({ to: 'a@b.co', subject: 'Hi\r\nBcc: evil@x.com', body: 'x' }));
    expect(mail.headers.Bcc).toBeUndefined();
  });

  it('long lines are wrapped by the base64 body, never exceeding the 998-char limit', async () => {
    const { buildRawMessage } = await import('../src/gmail/gmail-api.service');
    const mail = decodeRaw(buildRawMessage({ to: 'a@b.co', subject: 's', body: 'x'.repeat(5000) }));
    expect(Math.max(...mail.text.split('\r\n').map((l) => l.length))).toBeLessThanOrEqual(998);
    expect(mail.body).toBe('x'.repeat(5000));
  });
});
