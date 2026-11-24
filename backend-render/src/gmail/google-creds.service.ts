import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { env } from '../config/env';

/** The OAuth app credentials a connect/refresh needs. */
export interface GoogleCreds {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Where a user's configured creds came from. */
export type GoogleCredsSource = 'settings' | 'env' | null;

/** The callback route, relative to the API's public origin (global prefix included). */
export const GMAIL_CALLBACK_PATH = '/api/v1/gmail/callback';

/**
 * The OAuth redirect URI this deployment answers on — owned by the server, never
 * typed by a user. Precedence: an explicit `GOOGLE_REDIRECT_URI` override, then
 * derived from the API's public origin (`PUBLIC_API_URL`, else Render's own
 * `RENDER_EXTERNAL_URL`). Null only when the server cannot know its own address.
 *
 * Pure (takes the env values) so the derivation is unit-tested.
 */
export function deriveRedirectUri(vars: {
  GOOGLE_REDIRECT_URI?: string;
  PUBLIC_API_URL?: string;
  RENDER_EXTERNAL_URL?: string;
}): string | null {
  if (vars.GOOGLE_REDIRECT_URI) return vars.GOOGLE_REDIRECT_URI;
  const origin = (vars.PUBLIC_API_URL || vars.RENDER_EXTERNAL_URL || '').trim();
  if (!origin) return null;
  let base: URL;
  try {
    base = new URL(origin);
  } catch {
    return null;
  }
  // Tolerate an origin given with the API prefix already on it.
  const path = base.pathname.replace(/\/+$/, '').replace(/\/api\/v1$/, '');
  return `${base.origin}${path}${GMAIL_CALLBACK_PATH}`;
}

/**
 * Resolves the Google OAuth app credentials for a user.
 *
 * The credentials can be stored **in the app** (Settings → Mail, encrypted in
 * `google_oauth_config`) or left in the **Render environment**. The app's own
 * copy wins; the env is the fallback, so an existing deployment that set the
 * env vars keeps working untouched.
 *
 * The client secret is only ever decrypted here, on the server, with the
 * environment-held key — it is never returned to a client (`status()` reports
 * only *whether* it is set, and from where).
 */
@Injectable()
export class GoogleCredsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
  ) {}

  /** Full creds for a connect/refresh, or null if neither source has them. */
  async forUser(userId: string): Promise<GoogleCreds | null> {
    const { data } = await this.supabase.admin
      .from('google_oauth_config')
      .select('client_id, client_secret_enc, redirect_uri')
      .eq('user_id', userId)
      .maybeSingle();

    if (data) {
      const row = data as {
        client_id: string;
        client_secret_enc: string;
        redirect_uri: string | null;
      };
      const secret = this.crypto.decrypt(row.client_secret_enc);
      // The server's own callback wins over whatever was typed in the past:
      // a stale or mistyped stored URI is exactly the redirect_uri_mismatch
      // users could not diagnose.
      const redirectUri = this.redirectUri() ?? row.redirect_uri;
      if (row.client_id && secret && redirectUri) {
        return { clientId: row.client_id, clientSecret: secret, redirectUri };
      }
    }

    return this.envCreds();
  }

  /** This deployment's OAuth callback URL, or null if it cannot be derived. */
  redirectUri(): string | null {
    // Read raw: blank values are treated as absent by deriveRedirectUri, and
    // this path must not require the rest of the env schema (it runs for
    // in-app credentials, which need no GOOGLE_* env vars at all).
    const read = (k: string) => (process.env[k] ?? '').trim() || undefined;
    return deriveRedirectUri({
      GOOGLE_REDIRECT_URI: read('GOOGLE_REDIRECT_URI'),
      PUBLIC_API_URL: read('PUBLIC_API_URL'),
      RENDER_EXTERNAL_URL: read('RENDER_EXTERNAL_URL'),
    });
  }

  /** Whether a connect flow can run for this user, and which source backs it. */
  async status(userId: string): Promise<{
    configured: boolean;
    source: GoogleCredsSource;
    /** The callback to register in Google Cloud — shown read-only for setup. */
    redirect_uri: string | null;
  }> {
    const redirect_uri = this.redirectUri();
    const { data } = await this.supabase.admin
      .from('google_oauth_config')
      .select('client_id, redirect_uri')
      .eq('user_id', userId)
      .maybeSingle();
    const row = data as { client_id?: string; redirect_uri?: string | null } | null;
    if (row?.client_id && (redirect_uri || row.redirect_uri)) {
      return { configured: true, source: 'settings', redirect_uri: redirect_uri ?? row.redirect_uri ?? null };
    }
    return this.envCreds()
      ? { configured: true, source: 'env', redirect_uri }
      : { configured: false, source: null, redirect_uri };
  }

  /** Save (or replace) the in-app credentials. The secret is encrypted here. */
  async save(
    userId: string,
    input: { clientId: string; clientSecret: string; redirectUri?: string | null },
  ): Promise<void> {
    const redirectUri = this.redirectUri() ?? input.redirectUri?.trim() ?? null;
    if (!redirectUri) {
      throw new Error(
        'This server cannot work out its own public address. Set PUBLIC_API_URL on the API.',
      );
    }
    const { error } = await this.supabase.admin.from('google_oauth_config').upsert(
      {
        user_id: userId,
        client_id: input.clientId.trim(),
        client_secret_enc: this.crypto.encrypt(input.clientSecret.trim()),
        redirect_uri: redirectUri,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
    if (error) throw error;
  }

  /** Remove the in-app credentials (connect then falls back to env, if any). */
  async remove(userId: string): Promise<void> {
    await this.supabase.admin.from('google_oauth_config').delete().eq('user_id', userId);
  }

  private envCreds(): GoogleCreds | null {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
    const redirectUri = this.redirectUri();
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && redirectUri) {
      return { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri };
    }
    return null;
  }
}
