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
@Injectable()
export class InternalAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const provided = req.headers['x-internal-token'];
    const expected = env().INTERNAL_SERVICE_TOKEN;

    if (typeof provided !== 'string' || provided.length !== expected.length) {
      throw new UnauthorizedException();
    }
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
