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
      const row = data as { client_id: string; client_secret_enc: string; redirect_uri: string };
      const secret = this.crypto.decrypt(row.client_secret_enc);
      if (row.client_id && secret && row.redirect_uri) {
        return { clientId: row.client_id, clientSecret: secret, redirectUri: row.redirect_uri };
      }
    }

    return this.envCreds();
  }

  /** Whether a connect flow can run for this user, and which source backs it. */
  async status(userId: string): Promise<{ configured: boolean; source: GoogleCredsSource }> {
    const { data } = await this.supabase.admin
      .from('google_oauth_config')
      .select('client_id')
      .eq('user_id', userId)
      .maybeSingle();
    if ((data as { client_id?: string } | null)?.client_id) {
      return { configured: true, source: 'settings' };
    }
    return this.envCreds()
      ? { configured: true, source: 'env' }
      : { configured: false, source: null };
  }

  /** Save (or replace) the in-app credentials. The secret is encrypted here. */
  async save(userId: string, input: GoogleCreds): Promise<void> {
    const { error } = await this.supabase.admin.from('google_oauth_config').upsert(
      {
        user_id: userId,
        client_id: input.clientId.trim(),
        client_secret_enc: this.crypto.encrypt(input.clientSecret.trim()),
        redirect_uri: input.redirectUri.trim(),
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
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env();
    if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI) {
      return {
        clientId: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        redirectUri: GOOGLE_REDIRECT_URI,
      };
    }
    return null;
  }
}
