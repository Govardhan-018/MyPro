import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../common/supabase.service';
import { CryptoService } from '../common/crypto.service';
import { AuditService } from '../common/audit.service';
import { OAuthStateService } from '../common/oauth-state.service';
import type { AuthUser } from '../common/auth.guard';
import { env } from '../config/env';

/**
 * Strava — Phase 20.5.
 *
 * **Read-only, and on render.** Read-only because the assistant has no
 * business creating or editing someone's training history; `activity:read`
 * is the whole grant. On render because the OAuth callback needs a stable
 * redirect URI and the laptop's tunnel URL changes on every start, and
 * because `TOKEN_ENCRYPTION_KEY` lives only here — the same reasoning that
 * keeps Gmail tokens on this side.
 *
 * The laptop asks for activities through `/internal/strava/activities`,
 * exactly as it asks render to send mail. One place to revoke, one to audit.
 */

const AUTH_ENDPOINT = 'https://www.strava.com/oauth/authorize';
const TOKEN_ENDPOINT = 'https://www.strava.com/oauth/token';
const API_BASE = 'https://www.strava.com/api/v3';

/** Read activities. Not `activity:write`, not `profile:write`. Ever. */
const SCOPES = 'read,activity:read';
const STATE_SCOPE = 'strava';
const REQUEST_TIMEOUT_MS = 15_000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_at?: number;
  athlete?: { id?: number; firstname?: string; lastname?: string };
}

interface AccountRow {
  id: string;
  athlete_id: string | null;
  athlete_name: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  scopes: string | null;
  created_at: string;
}

/** One session, as the agent sees it. Strava's own shape is much larger. */
export interface StravaActivity {
  id: string;
  name: string;
  type: string;
  start_date: string;
  distance_km: number;
  moving_minutes: number;
  elevation_m: number;
  average_hr?: number;
  suffer_score?: number;
}

@Injectable()
export class StravaService {
  private readonly logger = new Logger(StravaService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly state: OAuthStateService,
  ) {}

  configured(): boolean {
    const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI } = env();
    return Boolean(STRAVA_CLIENT_ID && STRAVA_CLIENT_SECRET && STRAVA_REDIRECT_URI);
  }

  status() {
    return { configured: this.configured(), scopes: SCOPES };
  }

  private creds() {
    const { STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REDIRECT_URI } = env();
    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET || !STRAVA_REDIRECT_URI) {
      throw new BadRequestException('Strava is not configured on the server');
    }
    return {
      clientId: STRAVA_CLIENT_ID,
      clientSecret: STRAVA_CLIENT_SECRET,
      redirectUri: STRAVA_REDIRECT_URI,
    };
  }

  // ---- connect / disconnect --------------------------------------------

  connectUrl(user: AuthUser): { url: string } {
    const { clientId, redirectUri } = this.creds();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      approval_prompt: 'auto',
      scope: SCOPES,
      state: this.state.sign(user.id, STATE_SCOPE),
    });
    return { url: `${AUTH_ENDPOINT}?${params.toString()}` };
  }

  /** The callback has no session: the signed state is the authentication. */
  async handleCallback(code: string, state: string, grantedScope?: string): Promise<{ name: string }> {
    const userId = this.state.verify(state, STATE_SCOPE);
    if (!userId) throw new BadRequestException('That connect link is not valid any more.');

    // Strava lets the user untick scopes on the consent screen. Without
    // activity:read there is nothing to read, so say so now rather than
    // failing silently on every later fetch.
    if (grantedScope && !grantedScope.includes('activity:read')) {
      throw new BadRequestException('Activity access was not granted.');
    }

    const { clientId, clientSecret } = this.creds();
    const tokens = await this.tokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
    });

    const athlete = tokens.athlete;
    const name = [athlete?.firstname, athlete?.lastname].filter(Boolean).join(' ') || 'your Strava';

    await this.supabase.admin.from('strava_accounts').upsert(
      {
        user_id: userId,
        athlete_id: athlete?.id != null ? String(athlete.id) : null,
        athlete_name: name,
        access_token_enc: this.crypto.encrypt(tokens.access_token ?? ''),
        refresh_token_enc: tokens.refresh_token ? this.crypto.encrypt(tokens.refresh_token) : null,
        token_expires_at: tokens.expires_at
          ? new Date(tokens.expires_at * 1000).toISOString()
          : null,
        scopes: grantedScope ?? SCOPES,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );

    await this.audit.record({
      userId,
      actor: 'user',
      action: 'strava.connected',
      detail: { athlete_id: athlete?.id ?? null },
    });

    return { name };
  }

  async account(user: AuthUser) {
    const { data } = await this.supabase
      .forUser(user.token)
      .from('strava_accounts')
      .select('id, athlete_name, scopes, created_at, last_synced_at')
      .maybeSingle();
    return { configured: this.configured(), account: data ?? null };
  }

  /**
   * Disconnect. Strava is told to deauthorise *before* the row is deleted:
   * if that call fails we still hold the token to retry with, whereas
   * deleting first would leave a live grant nobody can revoke.
   */
  async disconnect(user: AuthUser): Promise<{ ok: boolean }> {
    const row = await this.rowFor(user.id);
    if (!row) return { ok: true };

    try {
      const access = await this.accessTokenFor(row);
      await fetch('https://www.strava.com/oauth/deauthorize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${access}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.warn(`strava deauthorise failed: ${err instanceof Error ? err.message : err}`);
    }

    await this.supabase.admin.from('strava_accounts').delete().eq('user_id', user.id);
    await this.audit.record({ userId: user.id, actor: 'user', action: 'strava.disconnected' });
    return { ok: true };
  }

  // ---- reading activities ----------------------------------------------

  /**
   * Recent activities for a user, by id — this is the node-to-node path, so
   * there is no JWT to scope by and `user_id` is filtered explicitly.
   */
  async activities(params: {
    userId: string;
    sinceDays: number;
    limit: number;
  }): Promise<{ connected: boolean; activities: StravaActivity[] }> {
    const row = await this.rowFor(params.userId);
    if (!row) return { connected: false, activities: [] };

    const access = await this.accessTokenFor(row);
    const after = Math.floor((Date.now() - params.sinceDays * 86_400_000) / 1000);

    const url = new URL(`${API_BASE}/athlete/activities`);
    url.searchParams.set('after', String(after));
    url.searchParams.set('per_page', String(Math.min(Math.max(params.limit, 1), 50)));

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${access}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      this.logger.warn(`strava activities failed (${res.status})`);
      throw new BadRequestException(
        res.status === 401
          ? 'Strava rejected the saved token. Reconnect Strava.'
          : 'Strava could not be reached right now.',
      );
    }

    const raw = (await res.json()) as Record<string, unknown>[];
    await this.supabase.admin
      .from('strava_accounts')
      .update({ last_synced_at: new Date().toISOString() })
      .eq('user_id', params.userId);

    return { connected: true, activities: raw.map((a) => this.toActivity(a)) };
  }

  /** Strava's activity shape, reduced to what a model should read. */
  private toActivity(a: Record<string, unknown>): StravaActivity {
    const num = (key: string): number => {
      const value = a[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : 0;
    };
    const optional = (key: string): number | undefined => {
      const value = a[key];
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };

    return {
      id: String(a.id ?? ''),
      name: typeof a.name === 'string' ? a.name : 'Activity',
      type: typeof a.sport_type === 'string' ? a.sport_type : String(a.type ?? 'Workout'),
      start_date: typeof a.start_date === 'string' ? a.start_date : '',
      distance_km: Math.round(num('distance') / 100) / 10,
      moving_minutes: Math.round(num('moving_time') / 60),
      elevation_m: Math.round(num('total_elevation_gain')),
      average_hr: optional('average_heartrate'),
      suffer_score: optional('suffer_score'),
    };
  }

  // ---- tokens -----------------------------------------------------------

  private async rowFor(userId: string): Promise<AccountRow | null> {
    const { data } = await this.supabase.admin
      .from('strava_accounts')
      .select('id, athlete_id, athlete_name, access_token_enc, refresh_token_enc, token_expires_at, scopes, created_at')
      .eq('user_id', userId)
      .maybeSingle();
    return (data as AccountRow | null) ?? null;
  }

  /**
   * A usable access token, refreshing when it is close to expiry.
   *
   * Strava rotates the refresh token on every refresh, so the new one must be
   * stored or the next refresh fails — this is the trap that silently
   * disconnects a Strava integration a few hours after it is set up.
   */
  private async accessTokenFor(row: AccountRow): Promise<string> {
    const expires = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
    const fresh = expires > Date.now() + 120_000;

    if (fresh && row.access_token_enc) {
      const current = this.crypto.decrypt(row.access_token_enc);
      // decrypt() returns null on a tampered or unreadable value; refreshing
      // is the right answer to that, not sending an empty bearer token.
      if (current) return current;
    }

    const refresh = this.crypto.decrypt(row.refresh_token_enc);
    if (!refresh) throw new BadRequestException('Strava needs reconnecting.');

    const { clientId, clientSecret } = this.creds();
    const tokens = await this.tokenRequest({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    });

    await this.supabase.admin
      .from('strava_accounts')
      .update({
        access_token_enc: this.crypto.encrypt(tokens.access_token ?? ''),
        // Rotated every time. Keep the old one only if none came back.
        ...(tokens.refresh_token
          ? { refresh_token_enc: this.crypto.encrypt(tokens.refresh_token) }
          : {}),
        token_expires_at: tokens.expires_at
          ? new Date(tokens.expires_at * 1000).toISOString()
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    if (!tokens.access_token) throw new BadRequestException('Strava returned no access token');
    return tokens.access_token;
  }

  private async tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!res.ok) {
      this.logger.warn(`strava token request failed (${res.status})`);
      // Strava's error bodies echo the client id; keep them out of the response.
      throw new BadRequestException('Strava rejected the sign-in. Try connecting again.');
    }
    return (await res.json()) as TokenResponse;
  }
}
