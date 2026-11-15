import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

export interface SendRequest {
  userId: string;
  to: string;
  subject: string;
  body: string;
  accountId?: string;
}

export type SendOutcome =
  | { ok: true; id: string; from: string }
  | { ok: false; reason: string };

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

  configured(): boolean {
    return Boolean(env().RENDER_API_URL);
  }

  async send(request: SendRequest): Promise<SendOutcome> {
    const base = env().RENDER_API_URL;
    if (!base) {
      return {
        ok: false,
        reason:
          'Sending is not wired up on this machine — set RENDER_API_URL in backend-local/.env.',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/internal/gmail/send`, {
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
      const parsed: unknown = text ? JSON.parse(text) : null;

      if (!res.ok) {
        const message =
          parsed && typeof parsed === 'object' && 'message' in parsed
            ? String((parsed as { message: unknown }).message)
            : `Render refused the send (${res.status})`;
        return { ok: false, reason: message };
      }

      const body = parsed as { id?: string; from?: string } | null;
      if (!body?.id) return { ok: false, reason: 'Render reported no message id' };
      return { ok: true, id: body.id, from: body.from ?? '' };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`send via render failed: ${reason}`);
      // Render's free instance sleeps; a cold start can outlast the timeout.
      return {
        ok: false,
        reason: 'Could not reach the mail service just now — try approving again in a moment.',
      };
    }
  }
}
