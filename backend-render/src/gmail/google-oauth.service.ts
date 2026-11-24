import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import type { GoogleCreds } from './google-creds.service';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * The access a mailbox is connected with.
 *
 *  - `'read'` — read mail only (`gmail.readonly`). The assistant can summarise
 *    and surface, never send.
 *  - `'send'` — read **and** send as the user (`gmail.readonly` + `gmail.send`).
 *    `gmail.send` is deliberately *not* `gmail.modify`: the assistant never
 *    needs to archive, label or delete, and a scope you cannot use is a scope
 *    that cannot be abused.
 *
 * The choice is per-mailbox and made at connect time. `gmail.readonly` and
 * `gmail.send` are both **restricted** scopes — see the trap in the module doc.
 */
export type GmailAccessLevel = 'read' | 'send';

const READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
const IDENTITY_SCOPES = ['openid', 'email'];

/** The scopes requested for a given access level. */
export function scopesForLevel(level: GmailAccessLevel): string[] {
  return level === 'send'
    ? [READONLY_SCOPE, SEND_SCOPE, ...IDENTITY_SCOPES]
    : [READONLY_SCOPE, ...IDENTITY_SCOPES];
}

/** Whether a stored scope string actually grants send. */
export function scopesGrantSend(scopes: string | null | undefined): boolean {
  return (scopes ?? '').split(/\s+/).filter(Boolean).includes(SEND_SCOPE);
}

/** The access level a stored scope string represents, for display. */
export function levelFromScopes(scopes: string | null | undefined): GmailAccessLevel {
  return scopesGrantSend(scopes) ? 'send' : 'read';
}

/** Back-compat default (read + send), used only as a token-response fallback. */
export const GMAIL_SCOPES = scopesForLevel('send');

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

  /**
   * The consent URL, with a signed `state`.
   *
   * `state` carries the user id so the callback — which arrives from Google
   * with no session cookie and no Authorization header — knows whose mailbox
   * is being connected. It is HMAC-signed and timestamped so a stranger
   * cannot attach their mailbox to someone else's account by crafting a
   * callback URL, which is the whole CSRF surface of an OAuth connect flow.
   */
  authUrl(
    creds: GoogleCreds,
    userId: string,
    level: GmailAccessLevel = 'send',
    returnTo: 'web' | 'app' = 'web',
  ): string {
    const { clientId, redirectUri } = creds;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: scopesForLevel(level).join(' '),
      // Without both of these Google returns no refresh token on a repeat
      // connect, and the mailbox dies at the first access-token expiry.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state: this.signState(userId, returnTo),
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  signState(userId: string, returnTo: 'web' | 'app' = 'web'): string {
    const nonce = randomBytes(8).toString('hex');
    // returnTo is inside the signed payload, so it cannot be flipped to send a
    // web user's browser into an app link (or the other way round).
    const payload = `${userId}.${Date.now()}.${nonce}.${returnTo}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.sign(payload)}`;
  }

  /**
   * @returns who the state was issued for and where the flow returns to, or
   * null if it is not ours or has expired.
   */
  verifyState(state: string): { userId: string; returnTo: 'web' | 'app' } | null {
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

    const [userId, issuedAt, , returnTo] = payload.split('.');
    if (!userId || !issuedAt) return null;
    if (Date.now() - Number(issuedAt) > STATE_TTL_MS) return null;
    return { userId, returnTo: returnTo === 'app' ? 'app' : 'web' };
  }

  /**
   * Signed with the node-to-node secret rather than a new env var: it is
   * already a high-entropy server-only value, and one fewer secret to rotate
   * is one fewer secret to get wrong.
   */
  private sign(payload: string): string {
    return createHmac('sha256', env().INTERNAL_SERVICE_TOKEN).update(payload).digest('base64url');
  }

  async exchangeCode(creds: GoogleCreds, code: string): Promise<GoogleTokens> {
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: creds.redirectUri,
    });
  }

  async refresh(creds: GoogleCreds, refreshToken: string): Promise<GoogleTokens> {
    return this.tokenRequest({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
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
