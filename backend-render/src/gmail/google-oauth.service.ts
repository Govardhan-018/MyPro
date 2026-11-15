import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Read mail, and send as the user. `gmail.send` is deliberately *not*
 * `gmail.modify`: the assistant never needs to archive, label or delete, and
 * a scope you cannot use is a scope that cannot be abused.
 *
 * Both of these are **restricted** scopes. See the trap in the module doc.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'openid',
  'email',
];

export interface GoogleTokens {
  accessToken: string;
  /** Absent on a re-consent that Google decides not to re-issue. */
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string;
}

/** How long a connect link stays valid. Long enough to read the consent screen. */
const STATE_TTL_MS = 10 * 60_000;

/**
 * Google OAuth — Phase 7.1/7.2.
 *
 * ⚠️ **The 7-day trap.** An OAuth app left in *Testing* in the Google Cloud
 * console issues refresh tokens that expire after seven days, so the mailbox
 * silently disconnects every week and the only symptom is email quietly going
 * stale. Escaping it means publishing the app and passing Google's
 * verification review for the restricted `gmail.readonly` scope. That is free
 * but slow — start it early.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly logger = new Logger(GoogleOAuthService.name);

  configured(): boolean {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env();
    return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
  }

  private creds() {
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = env();
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
      throw new BadRequestException('Google OAuth is not configured on the server');
    }
    return {
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri: GOOGLE_REDIRECT_URI,
    };
  }

  /**
   * The consent URL, with a signed `state`.
   *
   * `state` carries the user id so the callback — which arrives from Google
   * with no session cookie and no Authorization header — knows whose mailbox
   * is being connected. It is HMAC-signed and timestamped so a stranger
   * cannot attach their mailbox to someone else's account by crafting a
   * callback URL, which is the whole CSRF surface of an OAuth connect flow.
   */
  authUrl(userId: string): string {
    const { clientId, redirectUri } = this.creds();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GMAIL_SCOPES.join(' '),
      // Without both of these Google returns no refresh token on a repeat
      // connect, and the mailbox dies at the first access-token expiry.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: this.signState(userId),
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  signState(userId: string): string {
    const nonce = randomBytes(8).toString('hex');
    const payload = `${userId}.${Date.now()}.${nonce}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
  }

  /** @returns the user id the state was issued for, or null if it is not ours. */
  verifyState(state: string): string | null {
    const [encoded, signature] = state.split('.');
    if (!encoded || !signature) return null;

    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    const expected = this.sign(payload);
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return null;
    }

    const [userId, issuedAt] = payload.split('.');
    if (!userId || !issuedAt) return null;
    if (Date.now() - Number(issuedAt) > STATE_TTL_MS) return null;
    return userId;
  }

  /**
   * Signed with the node-to-node secret rather than a new env var: it is
   * already a high-entropy server-only value, and one fewer secret to rotate
   * is one fewer secret to get wrong.
   */
  private sign(payload: string): string {
    return createHmac('sha256', env().INTERNAL_SERVICE_TOKEN).update(payload).digest('base64url');
  }

  async exchangeCode(code: string): Promise<GoogleTokens> {
    const { clientId, clientSecret, redirectUri } = this.creds();
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    });
  }

  async refresh(refreshToken: string): Promise<GoogleTokens> {
    const { clientId, clientSecret } = this.creds();
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
  }

  /** The signed-in address, so the row is labelled with the real mailbox. */
  async emailFor(accessToken: string): Promise<string | null> {
    const res = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { email?: string; sub?: string };
    return body.email ?? null;
  }

  private async tokenRequest(body: Record<string, string>): Promise<GoogleTokens> {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });

    const text = await res.text();
    if (!res.ok) {
      this.logger.warn(`google token request failed (${res.status})`);
      // Google's error bodies name the client id; keep them out of the
      // response the browser sees.
      throw new BadRequestException('Google rejected the sign-in. Try connecting again.');
    }

    const parsed = JSON.parse(text) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!parsed.access_token) throw new BadRequestException('Google returned no access token');

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? null,
      // 60s of slack so a token is never used in the second it expires.
      expiresAt: new Date(Date.now() + ((parsed.expires_in ?? 3600) - 60) * 1000),
      scopes: parsed.scope ?? GMAIL_SCOPES.join(' '),
    };
  }
}
