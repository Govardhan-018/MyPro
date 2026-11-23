import { describe, it, expect } from 'vitest';
import { GoogleCredsService } from '../src/gmail/google-creds.service';

/**
 * Resolving the Google OAuth app credentials (Feature: credentials in Settings).
 * The in-app, encrypted copy must win over the env fallback, the client secret
 * must round-trip through encryption, and status must report the source without
 * ever handing back the secret.
 *
 * Supabase and the crypto are faked so this needs no database and no env key.
 */

type Row = { client_id: string; client_secret_enc: string; redirect_uri: string } | null;

function fakeSupabase(row: Row) {
  const writes: { upserted?: unknown; deleted?: boolean } = {};
  const admin = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: row }) };
            },
          };
        },
        async upsert(data: unknown) {
          writes.upserted = data;
          return { error: null };
        },
        delete() {
          return {
            async eq() {
              writes.deleted = true;
              return { error: null };
            },
          };
        },
      };
    },
  };
  return { supabase: { admin } as never, writes };
}

// A crypto that just brackets the value, so we can see encrypt/decrypt ran.
const fakeCrypto = {
  encrypt: (s: string) => `enc(${s})`,
  decrypt: (s: string | null | undefined) =>
    typeof s === 'string' && s.startsWith('enc(') ? s.slice(4, -1) : null,
} as never;

describe('GoogleCredsService.forUser', () => {
  it('returns the in-app credentials, decrypting the secret', async () => {
    const { supabase } = fakeSupabase({
      client_id: 'cid',
      client_secret_enc: 'enc(shh)',
      redirect_uri: 'https://x/api/v1/gmail/callback',
    });
    const svc = new GoogleCredsService(supabase, fakeCrypto);
    const creds = await svc.forUser('u1');
    expect(creds).toEqual({
      clientId: 'cid',
      clientSecret: 'shh',
      redirectUri: 'https://x/api/v1/gmail/callback',
    });
  });

  it('reports source "settings" when an in-app row exists', async () => {
    const { supabase } = fakeSupabase({
      client_id: 'cid',
      client_secret_enc: 'enc(shh)',
      redirect_uri: 'https://x',
    });
    const svc = new GoogleCredsService(supabase, fakeCrypto);
    expect(await svc.status('u1')).toEqual({ configured: true, source: 'settings' });
  });
});

describe('GoogleCredsService.save', () => {
  it('encrypts the client secret before writing, and never stores it in the clear', async () => {
    const { supabase, writes } = fakeSupabase(null);
    const svc = new GoogleCredsService(supabase, fakeCrypto);
    await svc.save('u1', {
      clientId: 'cid',
      clientSecret: 'topsecret',
      redirectUri: 'https://x',
    });
    const row = writes.upserted as Record<string, unknown>;
    // The secret is written only through encryption, under the _enc column...
    expect(row.client_secret_enc).toBe('enc(topsecret)');
    // ...and the raw plaintext field is never persisted.
    expect('client_secret' in row).toBe(false);
    expect(row.client_id).toBe('cid');
  });
});
