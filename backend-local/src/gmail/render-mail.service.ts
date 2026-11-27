import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';
import { SupabaseService } from '../common/supabase.service';
import { forgetRenderApiBase, resolveRenderApiBase } from '../common/render-api';

export interface SendRequest {
  userId: string;
  to: string;
  subject: string;
  body: string;
  accountId?: string;
}

export type SendOutcome =
  | { ok: true; id: string; from: string }
  /**
   * `retryable` is true only when the message *certainly* was not sent — the
   * request never reached the mail service. A timeout is never retryable:
   * Gmail may have sent it, and sending twice is worse than reporting once.
   */
  | {
      ok: false;
      reason: string;
      retryable?: boolean;
      /** The request may have reached Gmail (a timeout): do not resend blindly. */
      ambiguous?: boolean;
    };

const SEND_TIMEOUT_MS = 20_000;

/**
 * Sending mail, from the laptop's side — Phase 7.6.
 *
 * The laptop never holds a Gmail token. Render does, along with
 * `TOKEN_ENCRYPTION_KEY`, so this asks render to send rather than carrying a
 * second copy of the most dangerous credential in the system. One place to
 * revoke, one place to audit.
 *
 * Every failure is returned rather than thrown. This is called from an
 * approval the user just gave, and "it didn't send, here's why" is a far
 * better outcome than a stack trace and a pending action stuck forever.
 */
@Injectable()
export class RenderMailService {
  private readonly logger = new Logger(RenderMailService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Sending is possible when the core's address is known (announced or configured). */
  configured(): boolean {
    return true;
  }

  async send(request: SendRequest): Promise<SendOutcome> {
    const base = await resolveRenderApiBase(this.supabase.admin);
    if (!base) {
      return {
        ok: false,
        reason:
          'Sending is not wired up on this machine — set RENDER_API_URL in backend-local/.env.',
        retryable: false,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const res = await fetch(`${base}/internal/gmail/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': env().INTERNAL_SERVICE_TOKEN,
        },
        body: JSON.stringify({
          user_id: request.userId,
          to: request.to,
          subject: request.subject,
          body: request.body,
          ...(request.accountId ? { account_id: request.accountId } : {}),
        }),
        signal: controller.signal,
      });

      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = null;
      }

      if (!res.ok) {
        // 502/503/504 come from Render's edge while the instance wakes: the
        // request never reached the app, so nothing was sent.
        const waking = res.status === 502 || res.status === 503 || res.status === 504;
        const message =
          parsed && typeof parsed === 'object' && 'message' in parsed
            ? String((parsed as { message: unknown }).message)
            : waking
              ? 'The mail service is waking up.'
              : `The mail service at ${new URL(base).host} answered ${res.status}${
                  res.status === 404 ? ' — that host has no MyPro API (check the core service URL)' : ''
                }`;
        if (res.status === 404) forgetRenderApiBase();
        // A 404 from the edge means the request never reached MyPro: nothing
        // was sent, so it is safe to try again once the address is re-read.
        return { ok: false, reason: message, retryable: waking || res.status === 404 };
      }

      const body = parsed as { id?: string; from?: string } | null;
      if (!body?.id) return { ok: false, reason: 'Render reported no message id' };
      return { ok: true, id: body.id, from: body.from ?? '' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`send via render failed: ${reason}`);
      const timedOut = err instanceof Error && err.name === 'AbortError';
      // Render's free instance sleeps; a cold start can outlast the timeout.
      return {
        ok: false,
        reason: timedOut
          ? 'The mail service did not answer in time, so it is unclear whether it sent. Check your Sent folder before retrying.'
          : 'Could not reach the mail service just now — try again in a moment.',
        // A connection that failed outright sent nothing; a timeout might have.
        retryable: !timedOut,
        ambiguous: timedOut,
      };
    }
  }

  /** When each user's mailbox was last refreshed through render. */
  private readonly lastSync = new Map<string, number>();

  /**
   * Ask render to pull new mail into `email_messages` before the assistant
   * reads it. The assistant only ever reads that local copy, which used to be
   * filled solely by "Sync now" in Settings — so "what's my last email?"
   * answered from an empty table. Throttled per user (incremental syncs are
   * cheap, but not free), bounded in time, and never throws: on failure the
   * assistant still reads whatever is already stored.
   */
  async refresh(userId: string, maxAgeMs = 2 * 60_000): Promise<{ ok: boolean; note?: string }> {
    const base = await resolveRenderApiBase(this.supabase.admin);
    if (!base) return { ok: false, note: 'Mail sync is not wired up on this machine (RENDER_API_URL).' };
    const last = this.lastSync.get(userId) ?? 0;
    if (Date.now() - last < maxAgeMs) return { ok: true };
    try {
      const res = await fetch(`${base}/internal/gmail/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-token': env().INTERNAL_SERVICE_TOKEN,
        },
        body: JSON.stringify({ user_id: userId }),
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        if (res.status === 404) forgetRenderApiBase();
        return { ok: false, note: `Mail could not be refreshed (${res.status} from ${new URL(base).host}).` };
      }
      this.lastSync.set(userId, Date.now());
      const body = (await res.json().catch(() => null)) as { results?: { error?: string }[] } | null;
      const failed = body?.results?.find((r) => r.error);
      return failed ? { ok: false, note: failed.error } : { ok: true };
    } catch (err) {
      this.logger.warn(`mail refresh failed: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, note: 'Mail could not be refreshed just now; showing what was last synced.' };
    }
  }
}
