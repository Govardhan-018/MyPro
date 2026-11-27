import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { env } from '../config/env';

/**
 * Guards node→node routes (`/internal/*`). These are never called by a
 * browser — only by the other node. Uses a shared secret compared in
 * constant time.
 *
 * The traffic runs both ways: render reaches the laptop for generated text,
 * and since Phase 7.6 the laptop reaches render to send mail, because render
 * is the only half holding the Gmail tokens and the key that decrypts them.
 */
/** Said to the calling node (never the secret itself), so the fix is obvious. */
export const INTERNAL_TOKEN_MISMATCH =
  'The agent and the core have different INTERNAL_SERVICE_TOKEN values. Copy the value from ' +
  'mypro-core → Environment into mypro-agent → Environment exactly, then redeploy the agent.';

@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const raw = req.headers['x-internal-token'];
    // Whitespace around a pasted secret (a trailing newline from the Render
    // dashboard) is the usual reason two "identical" values do not match.
    const provided = typeof raw === 'string' ? raw.trim() : '';
    const expected = env().INTERNAL_SERVICE_TOKEN.trim();

    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (!provided || a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException(INTERNAL_TOKEN_MISMATCH);
    }
    return true;
  }
}
