import { describe, it, expect, beforeAll } from 'vitest';

/**
 * Scheduled emails failed with "Unauthorized": the agent's
 * INTERNAL_SERVICE_TOKEN did not match the core's. Whitespace from pasting
 * (a trailing newline) must not count as a difference; a real difference must
 * say exactly what to fix — without revealing the secret.
 */
const SECRET = 'a'.repeat(40);

beforeAll(() => {
  Object.assign(process.env, {
    CORS_ORIGINS: 'https://app.test',
    SUPABASE_URL: 'https://proj.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_xxxxxxxxxxxxxxxxxxxx',
    SUPABASE_SECRET_KEY: 'sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxx',
    INTERNAL_SERVICE_TOKEN: `${SECRET}\n`, // pasted with a trailing newline
    TOKEN_ENCRYPTION_KEY: 'k'.repeat(64),
  });
});

async function check(header: unknown) {
  const { InternalAuthGuard } = await import('../src/common/internal-auth.guard');
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-internal-token': header } }) }),
  } as never;
  return () => new InternalAuthGuard().canActivate(ctx);
}

describe('InternalAuthGuard', () => {
  it('accepts the same secret even with whitespace around either copy', async () => {
    expect((await check(SECRET))()).toBe(true);
    expect((await check(`  ${SECRET}  `))()).toBe(true);
  });

  it('a different secret is refused with the fix, never the secret', async () => {
    const run = await check('b'.repeat(40));
    expect(run).toThrow(/different INTERNAL_SERVICE_TOKEN values.*mypro-agent/);
    try {
      run();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain(SECRET);
    }
  });

  it('a missing header is refused', async () => {
    expect(await check(undefined)).toThrow(/INTERNAL_SERVICE_TOKEN/);
  });
});
