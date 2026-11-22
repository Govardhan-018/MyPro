import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

/**
 * The `state` parameter of an OAuth connect flow, signed.
 *
 * A provider's callback arrives as a top-level browser navigation from
 * *their* domain: no session cookie, no Authorization header. `state` is the
 * only thing carrying "whose account is being connected", so if it were
 * guessable a stranger could attach their account to someone else's profile
 * by crafting a callback URL. That is the entire CSRF surface of a connect
 * flow, and an HMAC plus a timestamp closes it.
 *
 * Signed with `INTERNAL_SERVICE_TOKEN` rather than a new secret: it is
 * already a high-entropy server-only value, and one fewer secret to rotate is
 * one fewer secret to get wrong.
 *
 * `GoogleOAuthService` predates this and carries its own identical copy. It
 * is left alone deliberately — the Gmail path works and is in production, and
 * "refactor the thing that is not broken" is how connect flows break.
 */

/** Long enough to read a consent screen, short enough to be useless later. */
const STATE_TTL_MS = 10 * 60_000;

@Injectable()
export class OAuthStateService {
  /** A state value that proves this connect was started by this user. */
  sign(userId: string, scope: string): string {
    const nonce = randomBytes(8).toString('hex');
    const payload = `${scope}.${userId}.${Date.now()}.${nonce}`;
    return `${Buffer.from(payload).toString('base64url')}.${this.hmac(payload)}`;
  }

  /**
   * @returns the user id the state was issued for, or null if it is not ours,
   * has expired, or was issued for a different provider.
   */
  verify(state: string, scope: string): string | null {
    const [encoded, signature] = state.split('.');
    if (!encoded || !signature) return null;

    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return null;
    }

    const expected = this.hmac(payload);
    if (
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      return null;
    }

    const [issuedScope, userId, issuedAt] = payload.split('.');
    if (issuedScope !== scope || !userId || !issuedAt) return null;
    if (Date.now() - Number(issuedAt) > STATE_TTL_MS) return null;
    return userId;
  }

  private hmac(payload: string): string {
    return createHmac('sha256', env().INTERNAL_SERVICE_TOKEN).update(payload).digest('base64url');
  }
}
